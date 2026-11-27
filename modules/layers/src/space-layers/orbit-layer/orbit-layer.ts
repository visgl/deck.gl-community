// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  type Accessor,
  type AccessorContext,
  type Color,
  type CompositeLayerProps,
  type DefaultProps,
  type GetPickingInfoParams,
  type Layer,
  type LayerContext,
  type PickingInfo,
  type UpdateParameters
} from '@deck.gl/core';
import {PathLayer, ScatterplotLayer} from '@deck.gl/layers';
import {OMMLoader, type OMMRow} from '@loaders.gl/scientific/omm';
import {TLELoader} from '@loaders.gl/scientific/tle';
import type {SatRec} from 'satellite.js';

import {createSatRec, type GpRecord} from './gp-records';
import {parseGpRecords, toGpRecords} from './load-gp-records';
import {getGroundTrack, getOrbitPath, interpolateLngLatAlt, type OrbitClass} from './orbit-math';
import {
  createOrbitPropagator,
  isCurrentGeneration,
  isWorkerLoadError,
  type OrbitInitResult,
  type OrbitPropagator,
  type OrbitSample
} from './orbit-propagator';
import {OrbitSampleClock} from './orbit-sample-clock';
import {
  getRows,
  getSatellites,
  getStaticAttributes,
  getVisibleRadii,
  isSameValue,
  type OrbitSatellite
} from './orbit-layer-attributes';

export type {OrbitSatellite};

/** GP element sets: a URL, OMM JSON or TLE text, or rows from `OMMLoader` or `TLELoader`. */
export type OrbitLayerData = string | OMMRow[];

type _OrbitLayerProps = {
  /**
   * A string that starts with `[` or `{` is OMM JSON text, and a string with a line break is TLE
   * text. Other strings are URLs, loaded with the `loaders` prop.
   */
  data: OrbitLayerData;
  /** Simulated time, in milliseconds since the Unix epoch. The app sets it on each frame. */
  currentTime?: number | null;
  /**
   * Where SGP4 runs. When the worker cannot load, the layer calls `onError` once and runs SGP4
   * on the main thread.
   */
  propagation?: 'worker' | 'main-thread';
  /** Samples per second of wall time. The layer interpolates between samples. */
  propagationRate?: number;
  /** Draws the orbit and the ground track of this satellite. */
  selectedNoradId?: number | null;
  showOrbit?: boolean;
  showGroundTrack?: boolean;
  /** Runs once per data load, on the static fields. */
  getColor?: Accessor<OrbitSatellite, Color>;
  /** Radius in pixels. Runs once per data load, on the static fields. */
  getRadius?: Accessor<OrbitSatellite, number>;
  radiusMinPixels?: number;
  radiusMaxPixels?: number;
  orbitColor?: Color;
  groundTrackColor?: Color;
  orbitWidthMinPixels?: number;
  /** Called after parsing and SGP4 initialization. */
  onDataLoad?: ((stats: {satellites: number; rejected: number}) => void) | null;
  /** Called after each interpolation while the selected satellite has a position. */
  onSelectedPositionChange?:
    | ((position: [number, number, number], satellite: OrbitSatellite) => void)
    | null;
  /** Parse, network and propagation errors. */
  onError?: ((error: Error) => boolean | void) | null;
};

export type OrbitLayerProps = _OrbitLayerProps &
  Omit<CompositeLayerProps, 'data' | 'onDataLoad' | 'onError'>;

const ORBIT_CLASS_COLORS: Record<OrbitClass, Color> = {
  LEO: [80, 200, 255, 230],
  MEO: [120, 230, 120, 230],
  GEO: [255, 170, 60, 230],
  HEO: [240, 100, 220, 230]
};

/** Above this count, the default radius is smaller, as in the satellite-orbits example. */
const LARGE_GROUP = 2000;

const defaultProps: DefaultProps<OrbitLayerProps> = {
  // The layer loads `data` itself: deck.gl's async `data` would treat all strings as URLs
  // and call `onDataLoad` with the loaded table.
  data: {type: 'object', value: [], async: false} as any,
  currentTime: null,
  propagation: 'worker',
  propagationRate: {type: 'number', min: 0.01, value: 5},
  selectedNoradId: null,
  showOrbit: true,
  showGroundTrack: true,
  getColor: {type: 'accessor', value: (d: OrbitSatellite) => ORBIT_CLASS_COLORS[d.orbitClass]},
  getRadius: {
    type: 'accessor',
    value: (_d: OrbitSatellite, {data}: AccessorContext<OrbitSatellite>) =>
      (data as OrbitSatellite[]).length > LARGE_GROUP ? 1.5 : 3
  },
  radiusMinPixels: {type: 'number', min: 0, value: 0},
  radiusMaxPixels: {type: 'number', min: 0, value: Number.MAX_SAFE_INTEGER},
  orbitColor: {type: 'color', value: [255, 255, 255, 220]},
  groundTrackColor: {type: 'color', value: [255, 230, 120, 200]},
  orbitWidthMinPixels: {type: 'number', min: 0, value: 1.5},
  loaders: {type: 'array', value: [OMMLoader, TLELoader], optional: true, ignore: true} as any,
  onDataLoad: {type: 'function', value: null, optional: true},
  onSelectedPositionChange: {type: 'function', value: null, optional: true},
  onError: {type: 'function', value: null, optional: true}
};

/** The satellites of one generation that SGP4 accepted, with their static attributes. */
type Dataset = {
  generation: number;
  /** All parsed records; `recordIndices` points into it. */
  records: GpRecord[];
  recordIndices: Int32Array;
  satellites: OrbitSatellite[];
  colors: {value: Uint8Array; size: 4; normalized: true};
  radii: Float32Array;
};

type Selection = {
  index: number;
  satrec: SatRec;
  periodMs: number;
  pathTimeMs: number;
  orbit: number[][][];
  groundTrack: number[][][];
};

type OrbitLayerState = {
  propagator: OrbitPropagator;
  /** The `propagation` prop that the propagator was made for. */
  propagatorMode: 'worker' | 'main-thread';
  /** True after the worker failed to load and the layer moved SGP4 to the main thread. */
  workerFallback: boolean;
  clock: OrbitSampleClock;
  sampleIntervalMs: number;
  /** Incremented on every data or propagator change. Replies of other generations drop. */
  generation: number;
  /** The parsed records of the current data, kept to re-init after a propagator change. */
  records: GpRecord[] | null;
  /** The records that `onDataLoad` reported last. */
  reportedRecords: GpRecord[] | null;
  dataset: Dataset | null;
  sampleA: OrbitSample | null;
  sampleB: OrbitSample | null;
  /** Interpolation weight between `sampleA` and `sampleB` at `currentTime`. */
  weight: number;
  positions: Float64Array;
  positionAttribute: {value: Float64Array; size: 3};
  radiusAttribute: {value: Float32Array; size: 1};
  nextRequestId: number;
  /** The sample request in flight; 0 when none. Replies to other requests drop. */
  pendingRequestId: number;
  /** The latest time jump that came while a request was in flight; `null` when none. */
  queuedJumpMs: number | null;
  lastRequestWallMs: number;
  selectedNoradId: number | null;
  selection: Selection | null;
  currentTimeMs: number;
  recovering: boolean;
  errorReported: boolean;
  createdTimeMs: number;
};

/**
 * Draws satellites from GP element sets at `currentTime`. SGP4 runs in a worker (or on the main
 * thread) at `propagationRate`, and the layer interpolates between samples. For the selected
 * satellite it draws the orbit and the ground track. Experimental.
 */
export class OrbitLayer<ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_OrbitLayerProps>
> {
  static override layerName = 'OrbitLayer';
  static override defaultProps = defaultProps;

  declare state: OrbitLayerState;

  // `OrbitLayerProps` replaces the `onDataLoad` and `onError` types of `LayerProps`.
  constructor(...propObjects: Partial<ExtraPropsT & OrbitLayerProps>[]) {
    super(...(propObjects as Partial<OrbitLayer<ExtraPropsT>['props']>[]));
  }

  override initializeState(): void {
    const {propagation, propagationRate} = this.props;
    const sampleIntervalMs = 1000 / propagationRate;
    this.state = {
      propagator: createOrbitPropagator(propagation),
      propagatorMode: propagation,
      workerFallback: false,
      clock: new OrbitSampleClock(sampleIntervalMs),
      sampleIntervalMs,
      generation: 0,
      records: null,
      reportedRecords: null,
      dataset: null,
      sampleA: null,
      sampleB: null,
      weight: 1,
      positions: new Float64Array(0),
      positionAttribute: {value: new Float64Array(0), size: 3},
      radiusAttribute: {value: new Float32Array(0), size: 1},
      nextRequestId: 1,
      pendingRequestId: 0,
      queuedJumpMs: null,
      lastRequestWallMs: -Infinity,
      selectedNoradId: null,
      selection: null,
      currentTimeMs: Number.NaN,
      recovering: false,
      errorReported: false,
      createdTimeMs: Date.now()
    };
  }

  override updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    const {state} = this;
    let reinit = false;
    if (props.propagation !== state.propagatorMode) {
      state.propagator.destroy();
      state.propagator = createOrbitPropagator(props.propagation);
      state.propagatorMode = props.propagation;
      state.workerFallback = false;
      state.recovering = false;
      state.errorReported = false;
      reinit = true;
    }
    const sampleIntervalMs = 1000 / props.propagationRate;
    if (sampleIntervalMs !== state.sampleIntervalMs) {
      state.sampleIntervalMs = sampleIntervalMs;
      state.clock = new OrbitSampleClock(sampleIntervalMs);
    }

    if (changeFlags.dataChanged) {
      state.generation++;
      state.records = null;
      state.dataset = null;
      state.sampleA = state.sampleB = null;
      state.selection = null;
      state.pendingRequestId = 0;
      state.queuedJumpMs = null;
      this.loadData(props.data, state.generation);
    } else if (reinit && state.records) {
      this.reinit();
    }

    // Accessor functions rerun on `updateTriggers`; constant values rerun when they change.
    const triggers = changeFlags.updateTriggersChanged || {};
    const constantChanged = (name: 'getColor' | 'getRadius') =>
      typeof props[name] !== 'function' && !isSameValue(props[name], oldProps[name]);
    if (
      state.dataset &&
      (triggers.all ||
        triggers.getColor ||
        triggers.getRadius ||
        constantChanged('getColor') ||
        constantChanged('getRadius'))
    ) {
      Object.assign(
        state.dataset,
        getStaticAttributes(state.dataset.satellites, props.getColor, props.getRadius)
      );
      this.updateVisibleRadii();
    }

    if ((props.selectedNoradId ?? null) !== state.selectedNoradId) {
      this.updateSelection();
    }

    const currentTimeMs = this.getCurrentTime();
    if (currentTimeMs !== state.currentTimeMs) {
      state.currentTimeMs = currentTimeMs;
      this.onTimeChange(currentTimeMs);
    }
  }

  override finalizeState(context: LayerContext): void {
    this.state.propagator?.destroy();
    super.finalizeState(context);
  }

  override getPickingInfo({info, sourceLayer}: GetPickingInfoParams): PickingInfo {
    if (sourceLayer?.id === `${this.props.id}-satellites` && info.index >= 0) {
      info.object = this.getSatellite(info.index);
    }
    return info;
  }

  override renderLayers(): Layer[] {
    const {dataset, sampleB, selection, positions} = this.state;
    const {showOrbit, showGroundTrack, orbitColor, groundTrackColor, orbitWidthMinPixels} =
      this.props;
    const count = dataset && sampleB ? dataset.satellites.length : 0;
    const layers: Layer[] = [
      new ScatterplotLayer(this.getSubLayerProps({id: 'satellites'}), {
        data: {
          length: count,
          attributes: {
            getPosition: this.state.positionAttribute,
            getFillColor: dataset?.colors ?? {value: new Uint8Array(0), size: 4},
            getRadius: this.state.radiusAttribute
          }
        },
        billboard: true,
        radiusUnits: 'pixels',
        radiusMinPixels: this.props.radiusMinPixels,
        radiusMaxPixels: this.props.radiusMaxPixels
      } as any)
    ];
    if (!selection || !count) {
      return layers;
    }
    const i = selection.index * 3;
    const position = [positions[i], positions[i + 1], positions[i + 2]];
    if (position.every(Number.isFinite)) {
      layers.push(
        new ScatterplotLayer(this.getSubLayerProps({id: 'selected'}), {
          data: [position],
          getPosition: (d: number[]) => d as [number, number, number],
          pickable: false,
          billboard: true,
          radiusUnits: 'pixels',
          getRadius: 8,
          filled: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 2,
          getLineColor: [255, 255, 255]
        })
      );
    }
    const pathProps = {
      getPath: (d: number[][]) => d as any,
      pickable: false,
      widthUnits: 'pixels' as const,
      getWidth: 1,
      widthMinPixels: orbitWidthMinPixels
    };
    if (showGroundTrack && selection.groundTrack[0].length) {
      layers.push(
        new PathLayer(this.getSubLayerProps({id: 'ground-track'}), pathProps, {
          data: selection.groundTrack,
          getColor: groundTrackColor,
          // Cuts the track at ±180° on MapView.
          wrapLongitude: true
        })
      );
    }
    if (showOrbit && selection.orbit[0].length) {
      layers.push(
        new PathLayer(this.getSubLayerProps({id: 'orbit'}), pathProps, {
          data: selection.orbit,
          getColor: orbitColor,
          wrapLongitude: true,
          // GlobeView culls back faces by default. That drops the far half of a path in space.
          parameters: {cullMode: 'none'}
        })
      );
    }
    return layers;
  }

  /** Returns the satellite at `index`, with its position and speed at `currentTime`. */
  getSatellite(index: number): OrbitSatellite | null {
    const {dataset, sampleA, sampleB, positions, weight} = this.state;
    const satellite = dataset?.satellites[index];
    if (!satellite || !sampleA || !sampleB) {
      return null;
    }
    const i = index * 3;
    const position: [number, number, number] = [positions[i], positions[i + 1], positions[i + 2]];
    const speedA = sampleA.speedsKmS[index];
    return {
      ...satellite,
      position: position.every(Number.isFinite) ? position : null,
      speedKmS: speedA + (sampleB.speedsKmS[index] - speedA) * weight
    };
  }

  private getCurrentTime(): number {
    return this.props.currentTime ?? this.state.createdTimeMs;
  }

  // Data and initialization

  private async loadData(data: OrbitLayerData, generation: number): Promise<void> {
    const internalState = this.internalState!;
    let records: GpRecord[];
    try {
      records = await this.loadRecords(data);
    } catch (error) {
      const layer = internalState.layer as OrbitLayer | null;
      if (layer && layer.state.generation === generation) {
        layer.raiseError(error as Error, 'OrbitLayer could not load data');
      }
      return;
    }
    const layer = internalState.layer as OrbitLayer | null;
    if (layer && layer.state.generation === generation) {
      layer.state.records = records;
      layer.requestInit(records, generation);
    }
  }

  private async loadRecords(data: OrbitLayerData): Promise<GpRecord[]> {
    if (typeof data !== 'string') {
      return toGpRecords(getRows(data));
    }
    const text = data.trimStart();
    const isJson = text.startsWith('[') || text.startsWith('{');
    // TLE text has two or more lines, so a string without a line break is a URL.
    if (!isJson && !/[\r\n]/.test(text)) {
      const {fetch, loaders} = this.props;
      const loadOptions = this.getLoadOptions() ?? {};
      const result = await fetch(data, {
        propName: 'data',
        layer: this,
        loaders,
        // The layer reads rows, so both loaders return object-row tables.
        loadOptions: {
          ...loadOptions,
          omm: {...loadOptions.omm, shape: 'object-row-table'},
          tle: {...loadOptions.tle, shape: 'object-row-table'}
        }
      });
      return toGpRecords(getRows(result));
    }
    return parseGpRecords(data, isJson ? 'json' : 'tle');
  }

  /** Sends the current records to the propagator again, as a new generation. */
  private reinit(): void {
    const {state} = this;
    state.generation++;
    state.pendingRequestId = 0;
    state.queuedJumpMs = null;
    this.requestInit(state.records!, state.generation);
  }

  private requestInit(records: GpRecord[], generation: number): void {
    this.handleReply(this.state.propagator.init(generation, records), (layer, result) =>
      layer.onInit(result, records)
    );
  }

  /**
   * Calls `onReply` on the current layer instance (deck.gl replaces layer instances on each
   * render) when the reply comes from the current propagator, and handles its errors.
   */
  private handleReply<T>(promise: Promise<T>, onReply: (layer: OrbitLayer, reply: T) => void) {
    const internalState = this.internalState!;
    const {propagator} = this.state;
    const getLayer = () => {
      const layer = internalState.layer as OrbitLayer | null;
      return layer?.state.propagator === propagator ? layer : null;
    };
    promise
      .then(
        reply => {
          const layer = getLayer();
          if (layer) {
            onReply(layer, reply);
          }
        },
        error => getLayer()?.onPropagatorError(error)
      )
      // A user callback (`onDataLoad`, an accessor, `onSelectedPositionChange`) threw.
      .catch(error => getLayer()?.raiseError(error as Error, 'OrbitLayer callback failed'));
  }

  private onInit(result: OrbitInitResult, records: GpRecord[]): void {
    const {state} = this;
    if (!isCurrentGeneration(result, state.generation) || records !== state.records) {
      return;
    }
    const satellites = getSatellites(result, records);
    // A new propagator for the same records keeps the samples until its first sample.
    const sameRecords = state.dataset?.records === records;
    state.dataset = {
      generation: result.generation,
      records,
      recordIndices: result.recordIndices,
      satellites,
      ...getStaticAttributes(satellites, this.props.getColor, this.props.getRadius)
    };
    if (!sameRecords) {
      state.sampleA = state.sampleB = null;
      state.positions = new Float64Array(satellites.length * 3);
      state.positionAttribute = {value: state.positions, size: 3};
      state.radiusAttribute = {value: new Float32Array(satellites.length), size: 1};
    }
    this.updateSelection();
    state.queuedJumpMs = null;
    this.requestSample(this.getCurrentTime(), true);
    this.setNeedsUpdate();
    if (state.reportedRecords !== records) {
      state.reportedRecords = records;
      this.props.onDataLoad?.({
        satellites: satellites.length,
        rejected: records.length - satellites.length
      });
    }
  }

  // Sampling and interpolation

  private onTimeChange(currentTimeMs: number): void {
    const {state} = this;
    const wallMs = performance.now();
    const {jumped} = state.clock.update(currentTimeMs, wallMs);
    if (state.dataset?.generation === state.generation) {
      if (jumped) {
        // One request at a time: a scrubbed slider must not queue full SGP4 passes.
        if (state.pendingRequestId) {
          state.queuedJumpMs = currentTimeMs;
        } else {
          this.requestSample(currentTimeMs, true);
        }
      } else if (
        !state.pendingRequestId &&
        wallMs - state.lastRequestWallMs >= state.sampleIntervalMs
      ) {
        const timeMs = state.clock.getNextSampleTime(currentTimeMs);
        if (timeMs !== state.sampleB?.timeMs) {
          this.requestSample(timeMs, false);
        }
      }
    }
    this.interpolate();
    this.updatePaths(currentTimeMs);
  }

  /** Asks for a sample. `reset` drops the older samples when it arrives (a time jump). */
  private requestSample(timeMs: number, reset: boolean): void {
    const {state} = this;
    const {propagator, generation} = state;
    const requestId = state.nextRequestId++;
    state.pendingRequestId = requestId;
    state.lastRequestWallMs = performance.now();
    this.handleReply(propagator.propagate(generation, timeMs), (layer, sample) =>
      layer.onSample(sample, requestId, reset)
    );
  }

  private onSample(sample: OrbitSample, requestId: number, reset: boolean): void {
    const {state} = this;
    const {dataset} = state;
    if (
      requestId !== state.pendingRequestId ||
      !isCurrentGeneration(sample, state.generation) ||
      dataset?.generation !== sample.generation ||
      sample.positions.length !== dataset.satellites.length * 3
    ) {
      return;
    }
    state.pendingRequestId = 0;
    state.recovering = false;
    state.errorReported = false;
    const {queuedJumpMs} = state;
    state.queuedJumpMs = null;
    // A sample from before a queued jump is out of date; a jump sample is still closer.
    if (reset || queuedJumpMs === null) {
      state.sampleA = reset || !state.sampleB ? sample : state.sampleB;
      state.sampleB = sample;
      this.updateVisibleRadii();
      this.interpolate();
      this.setNeedsUpdate();
    }
    if (queuedJumpMs !== null) {
      this.requestSample(queuedJumpMs, true);
    }
  }

  /** Radius 0 hides satellites that SGP4 failed for, and keeps their index for picking. */
  private updateVisibleRadii(): void {
    const {dataset, sampleA, sampleB} = this.state;
    if (!dataset || !sampleA || !sampleB) {
      return;
    }
    this.state.radiusAttribute = {value: getVisibleRadii(dataset.radii, sampleA, sampleB), size: 1};
  }

  private interpolate(): void {
    const {state} = this;
    const {sampleA, sampleB, positions, selection} = state;
    if (!sampleA || !sampleB) {
      return;
    }
    const span = sampleB.timeMs - sampleA.timeMs;
    const t = span > 0 ? (this.getCurrentTime() - sampleA.timeMs) / span : 1;
    state.weight = Math.min(Math.max(t, 0), 1);
    interpolateLngLatAlt(sampleA.positions, sampleB.positions, state.weight, positions);
    // A new descriptor makes the ScatterplotLayer upload the positions again.
    state.positionAttribute = {value: positions, size: 3};

    const {onSelectedPositionChange} = this.props;
    if (selection && onSelectedPositionChange) {
      const satellite = this.getSatellite(selection.index);
      if (satellite?.position) {
        onSelectedPositionChange(satellite.position, satellite);
      }
    }
  }

  // Selection

  private updateSelection(): void {
    const {state} = this;
    const selectedNoradId = this.props.selectedNoradId ?? null;
    state.selectedNoradId = selectedNoradId;
    state.selection = null;
    const {dataset} = state;
    if (selectedNoradId === null || !dataset) {
      return;
    }
    const index = dataset.satellites.findIndex(d => d.noradId === selectedNoradId);
    const satrec = index >= 0 ? createSatRec(dataset.records[dataset.recordIndices[index]]) : null;
    if (!satrec) {
      return;
    }
    state.selection = {
      index,
      satrec,
      periodMs: dataset.satellites[index].periodMinutes * 60000,
      pathTimeMs: Number.NaN,
      orbit: [[]],
      groundTrack: [[]]
    };
    this.updatePaths(this.getCurrentTime());
  }

  /** Computes the paths on selection change and once per simulated orbit period. */
  private updatePaths(currentTimeMs: number): void {
    const {selection} = this.state;
    if (!selection || Math.abs(currentTimeMs - selection.pathTimeMs) < selection.periodMs) {
      return;
    }
    const date = new Date(currentTimeMs);
    selection.pathTimeMs = currentTimeMs;
    selection.orbit = [getOrbitPath(selection.satrec, date)];
    selection.groundTrack = [getGroundTrack(selection.satrec, date)];
  }

  // Errors

  /** Reports a propagator error once, and sends the current records again. */
  private onPropagatorError(error: Error): void {
    const {state} = this;
    // The next time change asks again; a re-init below also asks for a sample.
    state.pendingRequestId = 0;
    state.queuedJumpMs = null;
    if (isWorkerLoadError(error) && state.propagatorMode === 'worker' && !state.workerFallback) {
      this.fallBackToMainThread(error);
      return;
    }
    if (!state.errorReported) {
      state.errorReported = true;
      this.raiseError(error, 'OrbitLayer propagation failed');
    }
    if (!state.recovering && state.records) {
      state.recovering = true;
      this.reinit();
    }
  }

  /** Moves SGP4 to the main thread for this layer, after the worker failed to load. */
  private fallBackToMainThread(error: Error): void {
    const {state} = this;
    state.propagator.destroy();
    state.propagator = createOrbitPropagator('main-thread');
    // `propagatorMode` keeps 'worker', so `updateState` does not make a worker again.
    state.workerFallback = true;
    this.raiseError(
      error,
      'OrbitLayer could not load its propagation worker and runs SGP4 on the main thread. ' +
        "With the Vite dev server, add optimizeDeps: {exclude: ['@deck.gl-community/layers']} " +
        "to the Vite config. Set propagation: 'main-thread' to skip the worker"
    );
    if (state.records) {
      this.reinit();
    }
  }
}
