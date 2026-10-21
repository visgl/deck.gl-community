// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {CompositeLayer, createIterable, type DefaultProps} from '@deck.gl/core';
import {
  getSplatProjectionKey,
  getSplatCachedPosition,
  getSplatCommonUnits,
  type SplatProjectedPosition,
  getSplatBoundedPixelsPerMeter
} from '../splat-layer/splat-culling';
import {TreeMeshLayer} from './tree-mesh-layer';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {getSplatTransform, getSplatTransformScale} from '../splat-layer/splat-transform';
import {getTreeWoodMesh} from './tree-wood';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from '../splat-layer/splat-spatial-index';
import {retainSplatRows, getSplatChangedRanges} from '../splat-layer/splat-row-diff';
import type {TreeType} from './tree-layer';
import type {TreeCharacteristics} from './tree-characteristics';

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
  position: number[];
  scale: number[];
  common: number[];
  center: number[];
  units: number[];
  radius: number;
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
    nearWeights: Map<Row, number>;
    far: Row[];
    owners: Owner[];
    spatialIndex: SplatSpatialNode<Owner> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
  };
  initializeState() {
    this.state = {
      near: [],
      nearWeights: new Map(),
      far: [],
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
    const rebuild =
      accessorChanged ||
      props.mesh !== oldProps.mesh ||
      props.sizeScale !== oldProps.sizeScale ||
      Boolean(changeFlags.dataChanged) ||
      projectionKey !== this.state.projectionKey ||
      props.windStrength !== oldProps.windStrength ||
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
        const wind = get(props.getWind, row, objectInfo);
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
        const center = [0, 1, 2].map(
          axis =>
            common[axis] + (translation[axis] + transform[axis + 6] * 0.6) * projected.units[axis]
        );
        owners.push({
          row,
          position,
          scale,
          common,
          center,
          units: getSplatCommonUnits(center, viewport),
          radius:
            (Math.max(...scale.map(Math.abs)) * 2 +
              Math.hypot(...translation) +
              Math.max(0, get(props.getRootLength, row, objectInfo)) +
              Math.max(0, get(props.getStemRadius, row, objectInfo)) +
              Math.abs(props.windStrength * wind[2]) *
                (Math.abs(wind[0]) * 1.5 + Math.max(...scale.map(Math.abs)) * 0.5)) *
            units
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
    const viewports = this.context.deck.getViewports();
    const views = viewports.length ? viewports : [viewport];
    const projections = views.map(view => ({
      matrix: view.viewProjectionMatrix,
      center: [0, 0, 0, 0],
      width: view.width,
      height: view.height
    }));

    const nearWeights = new Map<Row, number>();
    const near: Row[] = [],
      far: Row[] = [];
    const hasCustomMesh = this.hasCustomMesh();
    for (const owner of hasCustomMesh
      ? owners
      : querySplatSpatialIndex(spatialIndex, projections)) {
      let pixelsPerMeter = 0;
      for (const view of views)
        pixelsPerMeter = Math.max(
          pixelsPerMeter,
          getSplatBoundedPixelsPerMeter(
            owner.center,
            owner.radius,
            view,
            view === viewport ? owner.units : undefined
          )
        );
      const t = Math.max(
        0,
        Math.min(1, (Math.max(...owner.scale.map(Math.abs)) * pixelsPerMeter - 80) / 100)
      );
      const weight = t * t * (3 - 2 * t);
      // A subpixel bole cannot add readable structure but costs a full instanced mesh draw. The
      // splat canopy remains present at every distance; restore wood once it spans two pixels.
      if (
        !hasCustomMesh &&
        Math.max(...owner.scale.map(Math.abs)) * pixelsPerMeter < MIN_WOOD_PIXELS
      )
        continue;
      nearWeights.set(owner.row, weight);
      if (weight >= 0.5) near.push(owner.row);
      else far.push(owner.row);
    }
    this.setState({
      near: retainSplatRows(this.state.near, near),
      nearWeights,
      far: retainSplatRows(this.state.far, far),
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
              ...this.getSubLayerProps({id}),
              data,
              _dataDiff: getSplatChangedRanges,
              // Global coverage applies to every wood fragment. Dense near branch coverage is
              // independent so bole/root fades, picking and streamed replacement remain intact.
              getCoverageRange: [0, 1],
              branchCoverage: aggregate || this.hasCustomMesh() ? 1 : this.props.nearBranchCoverage,
              shadowEnabled: false,
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
