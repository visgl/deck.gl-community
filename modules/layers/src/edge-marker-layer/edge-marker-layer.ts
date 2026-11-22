// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  CompositeLayer,
  createIterable,
  type Accessor,
  type AccessorContext,
  type AccessorFunction,
  type Color,
  type DefaultProps,
  type LayerDataSource,
  type LayerProps,
  type Position,
  type UpdateParameters,
  type Viewport
} from '@deck.gl/core';
import {IconLayer, TextLayer, _MultiIconLayer as MultiIconLayer} from '@deck.gl/layers';
import {
  computeEdgeMarkers,
  DEFAULT_EDGE_MARKER_OPTIONS,
  EdgeMarkerState,
  type EdgeMarkerFrame,
  type EdgeMarkerMargins,
  type EdgeMarkerOptions
} from './compute-edge-markers';

/** Built-in icon atlas: an arrow that points to +x, and a ring. White masks, tinted by color. */
const ICON_ATLAS = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="64">' +
    '<path d="M60 32 L10 6 L22 32 L10 58 Z" fill="white"/>' +
    '<circle cx="96" cy="32" r="20" fill="none" stroke="white" stroke-width="8"/>' +
    '</svg>'
)}`;
const ICON_MAPPING = {
  arrow: {x: 0, y: 0, width: 64, height: 64, mask: true},
  ring: {x: 64, y: 0, width: 64, height: 64, mask: true}
};

type _EdgeMarkerLayerProps<DataT> = {
  data: LayerDataSource<DataT>;
  /** Target position, in the coordinates of the view. */
  getPosition?: Accessor<DataT, Position>;
  /** Marker color. */
  getColor?: Accessor<DataT, Color>;
  /** Optional label under (or above) the marker. `null` draws no labels. */
  getLabel?: AccessorFunction<DataT, string> | null;

  /** Inset of the docking rectangle from the viewport edges, in CSS pixels. */
  margins?: number | Partial<EdgeMarkerMargins>;
  /** Hide targets nearer than this to the camera, in meters. */
  minDistance?: number;
  /** Hide targets farther than this from the camera, in meters. */
  maxDistance?: number;
  /** Stretch of docked positions away from the horizontal center line. A game look; 1 = none. */
  yStretch?: number;
  /** Round marker positions to whole device pixels. */
  integerCoordinates?: boolean;
  /** Device pixels per CSS pixel. `null` reads the ratio from the canvas. */
  devicePixelRatio?: number | null;
  /** Targets behind the camera plane: dock them to the edge, or hide them. */
  behindCamera?: 'dock' | 'hide';
  /** GlobeView only. Targets that the globe hides: dock, hide, or draw them as on screen. */
  beyondHorizon?: 'dock' | 'hide' | 'ignore';
  /** Draw markers for targets that are on screen, inside the margins. */
  showOnScreen?: boolean;

  /** Icon atlas and mapping. The default atlas has `arrow` (points to +x) and `ring`. */
  iconAtlas?: string;
  iconMapping?: Record<
    string,
    {x: number; y: number; width: number; height: number; mask?: boolean}
  >;
  /** Icon for docked markers. It must point to +x: the layer turns it toward the target. */
  edgeIcon?: string;
  /** Icon for on-screen markers. */
  onScreenIcon?: string;
  /** Docked marker size, in CSS pixels. */
  edgeIconSize?: number;
  /** On-screen marker size, in CSS pixels. */
  onScreenIconSize?: number;

  /** Label size, in CSS pixels. */
  fontSize?: number;
  fontFamily?: string;
  labelColor?: Color;
};

export type EdgeMarkerLayerProps<DataT = unknown> = _EdgeMarkerLayerProps<DataT> & LayerProps;

const defaultProps: DefaultProps<EdgeMarkerLayerProps> = {
  getPosition: {type: 'accessor', value: (d: {position: Position}) => d.position},
  getColor: {type: 'accessor', value: [255, 255, 255, 255]},
  getLabel: {type: 'accessor', value: null},
  margins: 24,
  minDistance: 0,
  maxDistance: Infinity,
  yStretch: 1,
  integerCoordinates: true,
  devicePixelRatio: null,
  behindCamera: 'dock',
  beyondHorizon: 'dock',
  showOnScreen: true,
  iconAtlas: ICON_ATLAS,
  iconMapping: {type: 'object', value: ICON_MAPPING},
  edgeIcon: 'arrow',
  onScreenIcon: 'ring',
  edgeIconSize: 28,
  onScreenIconSize: 22,
  fontSize: 13,
  fontFamily: 'Monaco, monospace',
  labelColor: [255, 255, 255, 255]
};

/** Attributes that depend on the viewport, refreshed every time the viewport changes. */
const ICON_VIEW_ATTRIBUTES = [
  'instancePositions',
  'instancePixelOffset',
  'instanceAngles',
  'instanceColors',
  'instanceSizes',
  'instanceIconDefs'
];
const TEXT_VIEW_ATTRIBUTES = [
  'instancePositions',
  'instancePixelOffset',
  'instanceColors',
  'instanceSizes'
];

type IconLayerClass = typeof IconLayer;

/**
 * Subclass an icon layer so that it refreshes its viewport-dependent attributes in the same
 * frame as the viewport change. A composite layer updates one frame later, so the markers would
 * trail the camera.
 */
function withViewportRefresh<T extends IconLayerClass>(
  Base: T,
  attributes: string[],
  name: string
) {
  // @ts-expect-error TS2545: a mixin class must have a constructor with `...args: any[]`
  return class ViewportRefreshLayer extends Base {
    static layerName = name;

    shouldUpdateState(params: UpdateParameters<this>): boolean {
      return super.shouldUpdateState(params) || Boolean(params.changeFlags.viewportChanged);
    }

    updateState(params: UpdateParameters<this>): void {
      super.updateState(params);
      if (params.changeFlags.viewportChanged) {
        const attributeManager = this.getAttributeManager()!;
        for (const attribute of attributes) {
          attributeManager.invalidate(attribute);
        }
      }
    }
  } as unknown as T;
}

const EdgeIconLayer = withViewportRefresh(IconLayer, ICON_VIEW_ATTRIBUTES, 'EdgeMarkerIconLayer');
const EdgeCharactersLayer = withViewportRefresh(
  MultiIconLayer as unknown as IconLayerClass,
  TEXT_VIEW_ATTRIBUTES,
  'EdgeMarkerCharactersLayer'
);

type EdgeMarkerLayerState = {
  positions: Float64Array;
  labelLengths: Float32Array | null;
  count: number;
  frame: EdgeMarkerFrame | null;
  frameViewport: Viewport | null;
  frameKey: number;
  optionsKey: number;
  /** CPU time of the last `computeEdgeMarkers` call, in milliseconds. */
  lastComputeMs: number;
};

/**
 * Markers for targets, docked to the viewport edge when the target is off screen, behind the
 * camera, or beyond the globe horizon. A docked marker is an arrow turned toward the target.
 *
 * The layer computes positions on the CPU (see `computeEdgeMarkers`) and draws them in screen
 * space with an `IconLayer` and a `TextLayer`. It supports MapView, GlobeView and
 * FirstPersonView. Use it in one view only: the positions belong to one viewport.
 */
export class EdgeMarkerLayer<DataT = unknown, ExtraPropsT extends {} = {}> extends CompositeLayer<
  ExtraPropsT & Required<_EdgeMarkerLayerProps<DataT>>
> {
  static layerName = 'EdgeMarkerLayer';
  static defaultProps = defaultProps;

  declare state: EdgeMarkerLayerState;

  initializeState(): void {
    this.state = {
      positions: new Float64Array(0),
      labelLengths: null,
      count: 0,
      frame: null,
      frameViewport: null,
      frameKey: -1,
      optionsKey: 0,
      lastComputeMs: 0
    };
  }

  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    const triggers = changeFlags.updateTriggersChanged;
    if (
      changeFlags.dataChanged ||
      (triggers && (triggers.all || triggers.getPosition || triggers.getLabel))
    ) {
      this._extractPositions();
    }
    if (changeFlags.propsChanged) {
      const optionProps = [
        'margins',
        'minDistance',
        'maxDistance',
        'yStretch',
        'integerCoordinates',
        'devicePixelRatio',
        'behindCamera',
        'beyondHorizon'
      ] as const;
      if (optionProps.some(key => props[key] !== oldProps[key])) {
        this.setState({optionsKey: this.state.optionsKey + 1});
      }
    }
  }

  /** The marker frame for the current viewport. Shared by the sublayers; computed once per viewport. */
  getEdgeMarkerFrame(viewport: Viewport = this.context.viewport): EdgeMarkerFrame {
    const {state} = this;
    const key = state.optionsKey * 1e6 + state.count;
    if (state.frame && state.frameViewport === viewport && state.frameKey === key) {
      return state.frame;
    }
    const start = performance.now();
    state.frame = computeEdgeMarkers(
      viewport,
      state.positions,
      state.count,
      this._getOptions(),
      state.frame ?? undefined
    );
    state.lastComputeMs = performance.now() - start;
    state.frameViewport = viewport;
    state.frameKey = key;
    return state.frame;
  }

  renderLayers() {
    const {
      data,
      getLabel,
      iconAtlas,
      iconMapping,
      edgeIcon,
      onScreenIcon,
      edgeIconSize,
      onScreenIconSize,
      showOnScreen,
      fontSize,
      fontFamily,
      labelColor
    } = this.props;
    const getColor = this.props.getColor;
    const target: [number, number] = [0, 0];
    const color: [number, number, number, number] = [0, 0, 0, 0];

    const isDrawn = (state: number) =>
      state !== EdgeMarkerState.HIDDEN && (showOnScreen || state !== EdgeMarkerState.ON_SCREEN);
    const getFrame = () => this.getEdgeMarkerFrame();
    const getOffset = (index: number): [number, number] => {
      const frame = getFrame();
      target[0] = (frame.positions[index * 2] - frame.principalPoint[0]) * frame.pixelScale;
      target[1] = (frame.positions[index * 2 + 1] - frame.principalPoint[1]) * frame.pixelScale;
      return target;
    };
    const getMarkerColor = (object: DataT, info: AccessorContext<DataT>): Color => {
      const base = typeof getColor === 'function' ? getColor(object, info) : getColor;
      const drawn = isDrawn(getFrame().states[info.index]);
      color[0] = base[0];
      color[1] = base[1];
      color[2] = base[2];
      color[3] = drawn ? (base[3] ?? 255) : 0;
      return color;
    };

    const icons = new EdgeIconLayer(this.getSubLayerProps({id: 'icons'}), {
      data,
      iconAtlas,
      iconMapping,
      billboard: true,
      sizeUnits: 'pixels',
      // Screen-space overlay: draw on top of the scene.
      parameters: {depthCompare: 'always', depthWriteEnabled: false},
      getPosition: () => getFrame().anchor,
      getPixelOffset: (_: DataT, {index}: {index: number}) => getOffset(index),
      getAngle: (_: DataT, {index}: {index: number}) => getFrame().angles[index],
      getIcon: (_: DataT, {index}: {index: number}) =>
        getFrame().states[index] === EdgeMarkerState.ON_SCREEN ? onScreenIcon : edgeIcon,
      getSize: (_: DataT, {index}: {index: number}) => {
        const frame = getFrame();
        const state = frame.states[index];
        if (!isDrawn(state)) return 0;
        const size = state === EdgeMarkerState.ON_SCREEN ? onScreenIconSize : edgeIconSize;
        return size * frame.pixelScale;
      },
      getColor: getMarkerColor
    });

    if (!getLabel) {
      return [icons];
    }

    const labelOffset: [number, number] = [0, 0];
    const getLabelOffset = (_: DataT, {index}: {index: number}): [number, number] => {
      const frame = getFrame();
      const {width, height} = this.context.viewport;
      const x = frame.positions[index * 2];
      const y = frame.positions[index * 2 + 1];
      const state = frame.states[index];
      const size = state === EdgeMarkerState.ON_SCREEN ? onScreenIconSize : edgeIconSize;
      // Below the marker in the top half of the view, above it in the bottom half.
      const dy = size / 2 + fontSize * 0.75;
      const labelY = y < height / 2 ? y + dy : y - dy;
      // Keep the label inside the view: estimate its width from the character count.
      const halfWidth = ((this.state.labelLengths?.[index] ?? 0) * fontSize * 0.62) / 2 + 2;
      const labelX = Math.min(Math.max(x, halfWidth), width - halfWidth);
      labelOffset[0] = (labelX - frame.principalPoint[0]) * frame.pixelScale;
      labelOffset[1] = (labelY - frame.principalPoint[1]) * frame.pixelScale;
      return labelOffset;
    };

    const labels = new TextLayer(this.getSubLayerProps({id: 'labels'}), {
      data,
      billboard: true,
      sizeUnits: 'pixels',
      fontFamily,
      getSize: () => fontSize * getFrame().pixelScale,
      parameters: {depthCompare: 'always', depthWriteEnabled: false},
      getText: getLabel,
      getPosition: () => getFrame().anchor,
      getPixelOffset: getLabelOffset,
      getColor: (_: DataT, info: AccessorContext<DataT>): Color => {
        const drawn = isDrawn(getFrame().states[info.index]);
        color[0] = labelColor[0];
        color[1] = labelColor[1];
        color[2] = labelColor[2];
        color[3] = drawn ? (labelColor[3] ?? 255) : 0;
        return color;
      },
      _subLayerProps: {characters: {type: EdgeCharactersLayer}}
    });

    return [icons, labels];
  }

  private _extractPositions(): void {
    const {data, getPosition, getLabel} = this.props;
    const {iterable, objectInfo} = createIterable(data);
    const positions: number[] = [];
    const labelLengths: number[] = [];
    for (const object of iterable) {
      objectInfo.index++;
      const p = typeof getPosition === 'function' ? getPosition(object, objectInfo) : getPosition;
      positions.push(p[0], p[1], p[2] || 0);
      if (getLabel) {
        const label = typeof getLabel === 'function' ? getLabel(object, objectInfo) : getLabel;
        labelLengths.push(label ? String(label).length : 0);
      }
    }
    this.setState({
      positions: Float64Array.from(positions),
      labelLengths: getLabel ? Float32Array.from(labelLengths) : null,
      count: positions.length / 3,
      frame: null,
      frameViewport: null
    });
  }

  private _getOptions(): EdgeMarkerOptions {
    const {margins, devicePixelRatio} = this.props;
    const m =
      typeof margins === 'number'
        ? {top: margins, right: margins, bottom: margins, left: margins}
        : {...DEFAULT_EDGE_MARKER_OPTIONS.margins, ...margins};
    return {
      margins: m,
      minDistance: this.props.minDistance,
      maxDistance: this.props.maxDistance,
      yStretch: this.props.yStretch,
      integerCoordinates: this.props.integerCoordinates,
      devicePixelRatio: devicePixelRatio ?? this._getCanvasPixelRatio(),
      behindCamera: this.props.behindCamera,
      beyondHorizon: this.props.beyondHorizon
    };
  }

  private _getCanvasPixelRatio(): number {
    try {
      return this.context.device.getDefaultCanvasContext().cssToDeviceRatio() || 1;
    } catch {
      return 1;
    }
  }
}
