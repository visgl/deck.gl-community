// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {CompositeLayer, createIterable, type DefaultProps} from '@deck.gl/core';
import {
  getSplatProjectionKey,
  getSplatCachedPosition,
  getSplatCommonUnits,
  getSplatQueryViews,
  type SplatProjectedPosition,
  getSplatBoundedPixelsPerMeter
} from '../splat-layer/splat-culling';
import {
  getSplatHorizon,
  getSplatTangentFrame,
  offsetSplatCommonPosition
} from '../splat-layer/splat-globe';
import {TreeMeshLayer} from './tree-mesh-layer';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {getSplatBranchSwayRadius} from '../splat-layer/splat-deformation';
import {getSplatTransform, getSplatTransformScale} from '../splat-layer/splat-transform';
import {getTreeWoodMesh} from './tree-wood';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from '../splat-layer/splat-spatial-index';
import {getSplatChangedRanges, SplatRowSlots} from '../splat-layer/splat-row-diff';
import {getSplatHighlightRow} from '../splat-layer/splat-source-highlight';
import type {TreeType} from './tree-layer';
import type {TreeCharacteristics} from './tree-characteristics';
import {getLayerWindBound} from '../wind-effect/wind-effect';

type Row = {
  position: [number, number, number];
  scale: [number, number, number];
  translation: [number, number, number];
  type: TreeType;
  levels: number;
  characteristics: TreeCharacteristics;
  height: number;
  wind: [number, number, number];
};
type Owner = {
  row: Row;
  /** Data index, which keys the owner's stable instance slot. */
  index: number;
  position: number[];
  scale: number[];
  /** Largest absolute scale axis. */
  extent: number;
  common: number[];
  center: number[];
  units: number[];
  radius: number;
  /** Last near-wood blend weight. */
  weight: number;
};
const MIN_WOOD_PIXELS = 2;
/** Automatic woody refinement. The connected full branching mesh is retained for close views. */
export class TreeWoodLayer extends CompositeLayer<any> {
  static layerName = 'TreeWoodLayer';
  static defaultProps: DefaultProps = {
    ...SimpleMeshLayer.defaultProps,
    ...TreeMeshLayer.defaultProps,
    // SimpleMeshLayer's boolean metadata only compares material truthiness.
    material: {type: 'object', value: true, compare: 2},
    templateMesh: {type: 'object', value: null},
    farTrunkOnly: false,
    // Dense canopies retain their native branch lattice, but use a stable spatial coverage mask
    // so foliage can occupy the complementary samples rather than being cut out by opaque wood.
    nearBranchCoverage: {type: 'number', value: 1, min: 0, max: 1}
  };
  declare state: {
    near: Row[];
    far: Row[];
    nearSlots: SplatRowSlots<Row>;
    farSlots: SplatRowSlots<Row>;
    owners: Owner[];
    spatialIndex: SplatSpatialNode<Owner> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
    /** Peak wind and crown scale the owner radii cover; a `WindEffect` change rebuilds them. */
    windBound?: string;
    windKey?: string;
  };
  initializeState() {
    this.state = {
      near: [],
      far: [],
      nearSlots: new SplatRowSlots(),
      farSlots: new SplatRowSlots(),
      owners: [],
      spatialIndex: null,
      projectionKey: '',
      projectedPositions: new Map()
    };
  }
  shouldUpdateState({changeFlags}) {
    return changeFlags.somethingChanged;
  }
  updateState({changeFlags, props, oldProps}) {
    const viewport = this.context.viewport;
    const projectionKey = getSplatProjectionKey(viewport);
    const triggers = changeFlags.updateTriggersChanged;
    const accessorChanged = [
      'getPosition',
      'getScale',
      'getTranslation',
      'getOrientation',
      'getTransformMatrix',
      'getWind',
      'getRootLength',
      'getStemRadius'
    ].some(
      key =>
        (typeof props[key] !== 'function' && props[key] !== oldProps[key]) ||
        triggers === true ||
        triggers?.all ||
        triggers?.[key]
    );
    const wind = getLayerWindBound(this, props.windEnabled);
    const windBound = `${wind.peak}|${wind.turbulence}`;
    const windBoundChanged = windBound !== this.state.windBound;
    this.state.windBound = windBound;
    const rebuild =
      windBoundChanged ||
      accessorChanged ||
      props.mesh !== oldProps.mesh ||
      props.sizeScale !== oldProps.sizeScale ||
      Boolean(changeFlags.dataChanged) ||
      projectionKey !== this.state.projectionKey ||
      props.modelMatrix !== oldProps.modelMatrix ||
      props.coordinateSystem !== oldProps.coordinateSystem ||
      props.coordinateOrigin !== oldProps.coordinateOrigin;
    if (!rebuild && !changeFlags.viewportChanged) return;
    let {owners, spatialIndex} = this.state;
    if (rebuild) {
      const reset =
        projectionKey !== this.state.projectionKey ||
        props.modelMatrix !== oldProps.modelMatrix ||
        props.coordinateSystem !== oldProps.coordinateSystem ||
        props.coordinateOrigin !== oldProps.coordinateOrigin;
      const previous = reset
        ? new Map<string, SplatProjectedPosition>()
        : this.state.projectedPositions;
      const next = new Map<string, SplatProjectedPosition>();
      const get = (accessor, row, info) =>
        typeof accessor === 'function' ? accessor(row, info) : accessor;
      const {iterable, objectInfo} = createIterable(props.data);
      owners = [];
      for (const row of iterable as Iterable<Row>) {
        objectInfo.index++;
        const position = get(props.getPosition, row, objectInfo);
        const suppliedMatrix = get(props.getTransformMatrix, row, objectInfo);
        const matrix = suppliedMatrix?.length ? suppliedMatrix : undefined;
        const scale = matrix
          ? [1, 1, 1].map(() => getSplatTransformScale(matrix) * Math.abs(props.sizeScale))
          : get(props.getScale, row, objectInfo).map(value => value * props.sizeScale);
        const translation = matrix
          ? Array.from(matrix).slice(12, 15)
          : get(props.getTranslation, row, objectInfo);
        const windRow = get(props.getWind, row, objectInfo);
        const transform = getSplatTransform(
          get(props.getOrientation, row, objectInfo),
          scale,
          translation,
          matrix
        );
        if (matrix) for (let axis = 0; axis < 9; axis++) transform[axis] *= props.sizeScale;
        const projected = getSplatCachedPosition(position, viewport, previous, next, point =>
          this.projectPosition(point, {viewport, autoOffset: false})
        );
        const common = projected.common,
          units = Math.max(...projected.units);
        const center = offsetSplatCommonPosition(
          common,
          [0, 1, 2].map(axis => translation[axis] + transform[axis + 6] * 0.6),
          projected.units,
          getSplatTangentFrame(common, viewport)
        );
        owners.push({
          row,
          index: objectInfo.index,
          position,
          scale,
          extent: Math.max(...scale.map(Math.abs)),
          common,
          center,
          units: getSplatCommonUnits(center, viewport),
          radius:
            (Math.max(...scale.map(Math.abs)) * 2 +
              Math.hypot(...translation) +
              Math.max(0, get(props.getRootLength, row, objectInfo)) +
              Math.max(0, get(props.getStemRadius, row, objectInfo)) +
              // Trunk lean with sway (1.25 × |axis| < 1.5), the crown mode (0.35 × ‖mode‖ < 0.6)
              // and branch sway out to the wood's full lateral extent.
              wind.peak *
                Math.abs(windRow[2]) *
                (Math.abs(windRow[0]) * 1.5 +
                  Math.max(...scale.map(Math.abs)) * 0.6 * wind.turbulence +
                  getSplatBranchSwayRadius(
                    Math.max(...scale.map(Math.abs)) * 2 + Math.hypot(...translation),
                    Math.abs(windRow[0]),
                    wind.turbulence
                  ))) *
            units,
          weight: 0
        });
      }
      this.state.projectedPositions = next;
      spatialIndex = createSplatSpatialIndex(
        owners.map(owner => ({
          center: owner.common,
          radius: owner.radius,
          value: owner
        }))
      );
    }
    const views = getSplatQueryViews(viewport, this.context.deck.getViewports());
    const projections = views.map(view => ({
      matrix: view.viewProjectionMatrix,
      center: [0, 0, 0, 0],
      width: view.width,
      height: view.height,
      horizon: getSplatHorizon(view)
    }));

    // Cached owner metre scales hold for every view sharing this projection, including the newer
    // camera deck.gl reports while a composite layer updates with its last drawn viewport.
    const ownerUnits = views.map(
      view => view === viewport || getSplatProjectionKey(view) === projectionKey
    );
    const near: Row[] = [],
      far: Row[] = [],
      nearKeys: number[] = [],
      farKeys: number[] = [];
    const hasCustomMesh = this.hasCustomMesh();
    for (const owner of hasCustomMesh
      ? owners
      : querySplatSpatialIndex(spatialIndex, projections)) {
      let pixelsPerMeter = 0;
      for (let i = 0; i < views.length; i++)
        pixelsPerMeter = Math.max(
          pixelsPerMeter,
          getSplatBoundedPixelsPerMeter(
            owner.center,
            owner.radius,
            views[i],
            ownerUnits[i] ? owner.units : undefined
          )
        );
      const t = Math.max(0, Math.min(1, (owner.extent * pixelsPerMeter - 80) / 100));
      const weight = t * t * (3 - 2 * t);
      // A subpixel bole cannot add readable structure but costs a full instanced mesh draw. The
      // splat canopy remains present at every distance; restore wood once it spans two pixels.
      if (!hasCustomMesh && owner.extent * pixelsPerMeter < MIN_WOOD_PIXELS) continue;
      owner.weight = weight;
      if (weight >= 0.5) {
        near.push(owner.row);
        nearKeys.push(owner.index);
      } else {
        far.push(owner.row);
        farKeys.push(owner.index);
      }
    }
    // Rows keep their instance slots, so trees crossing the view edge upload only their slots.
    this.setState({
      near: this.state.nearSlots.update(near, nearKeys),
      far: this.state.farSlots.update(far, farKeys),
      owners,
      spatialIndex,
      projectionKey
    });
  }
  private hasCustomMesh(): boolean {
    const row = this.props.data[0] as Row | undefined;
    return Boolean(row && this.props.mesh && this.props.mesh !== this.props.templateMesh);
  }
  renderLayers() {
    const row = this.props.data[0] as Row | undefined;
    if (!row) return [];
    return (
      [
        ['near', this.state.near, false],
        ['far', this.state.far, true]
      ] as const
    ).flatMap(([id, data, aggregate]) =>
      data.length
        ? [
            new TreeMeshLayer({
              ...this.props,
              // Forward the parent's accessor triggers (getColor, getWind, ...). Without them
              // getSubLayerProps would replace this.props.updateTriggers with `all` alone.
              ...this.getSubLayerProps({id, updateTriggers: this.props.updateTriggers}),
              data,
              _dataDiff: getSplatChangedRanges,
              highlightedObjectIndex: getSplatHighlightRow(this, data),
              // Global coverage applies to every wood fragment. Dense near branch coverage is
              // independent so bole/root fades, picking and streamed replacement remain intact.
              getCoverageRange: [0, 1],
              branchCoverage: aggregate || this.hasCustomMesh() ? 1 : this.props.nearBranchCoverage,
              pickable: this.props.pickable,
              woodMorph: !this.hasCustomMesh(),
              ...(this.hasCustomMesh() ? {getStemRadius: -1, getRootLength: -1} : {}),
              mesh: this.hasCustomMesh()
                ? this.props.mesh
                : (() => {
                    const trunkOnly = aggregate && this.props.farTrunkOnly;
                    // Far native wood can simplify to a compact bole. Near wood always retains
                    // its connected branch lattice; dense canopies control its optical coverage
                    // above instead of replacing the structure.
                    return getTreeWoodMesh(
                      row.type,
                      row.levels,
                      aggregate,
                      row.characteristics,
                      true,
                      trunkOnly
                    );
                  })()
            })
          ]
        : []
    );
  }
}
