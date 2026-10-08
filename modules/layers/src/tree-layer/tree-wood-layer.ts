// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {CompositeLayer, createIterable, type DefaultProps} from '@deck.gl/core';
import {
  getSplatProjectionKey,
  getSplatCachedPosition,
  type SplatProjectedPosition,
  getSplatBoundedPixelsPerMeter,
  getSplatFocusWeight
} from '../splat-layer/splat-culling';
import {TreeMeshLayer} from './tree-mesh-layer';
import {SimpleMeshLayer} from '@deck.gl/mesh-layers';
import {getSplatTransform} from '../splat-layer/splat-transform';
import {getTreeWoodMesh} from './tree-wood';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from '../splat-layer/splat-spatial-index';
import {retainSplatRows, getSplatChangedRanges} from '../splat-layer/splat-row-diff';
import type {SplatShadowProjection} from '../splat-layer/splat-shadow-pass';
import type {Viewport} from '@deck.gl/core';
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
  radius: number;
};
/** Automatic woody refinement. The connected full branching mesh is retained for close views. */
export class TreeWoodLayer extends CompositeLayer<any> {
  static layerName = 'TreeWoodLayer';
  static defaultProps: DefaultProps = {
    ...SimpleMeshLayer.defaultProps,
    ...TreeMeshLayer.defaultProps,
    // SimpleMeshLayer's boolean metadata only compares material truthiness.
    material: {type: 'object', value: true, compare: 2},
    templateMesh: {type: 'object', value: null}
  };
  declare state: {
    near: Row[];
    nearWeights: Map<Row, number>;
    shadowWeights: Map<Row, number>;
    far: Row[];
    shadow: Row[];
    shadowNear: Row[];
    shadowFar: Row[];
    owners: Owner[];
    spatialIndex: SplatSpatialNode<Owner> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
    shadowKey: string;
    shadowProjections: SplatShadowProjection[] | null;
  };
  initializeState() {
    this.state = {
      near: [],
      nearWeights: new Map(),
      shadowWeights: new Map(),
      far: [],
      shadow: [],
      shadowNear: [],
      shadowFar: [],
      owners: [],
      spatialIndex: null,
      projectionKey: '',
      projectedPositions: new Map(),
      shadowKey: '',
      shadowProjections: null
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
    if (
      !rebuild &&
      !changeFlags.viewportChanged &&
      props.foveationStrength === oldProps.foveationStrength
    )
      return;
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
        const scale = get(props.getScale, row, objectInfo).map(value => value * props.sizeScale);
        const translation = get(props.getTranslation, row, objectInfo);
        const wind = get(props.getWind, row, objectInfo);
        const transform = getSplatTransform(
          get(props.getOrientation, row, objectInfo),
          scale,
          translation
        );
        const projected = getSplatCachedPosition(position, viewport, previous, next, point =>
          this.projectPosition(point, {viewport, autoOffset: false})
        );
        const common = projected.common,
          units = Math.max(...projected.units);
        owners.push({
          row,
          position,
          scale,
          common,
          center: [0, 1, 2].map(
            axis =>
              common[axis] + (translation[axis] + transform[axis + 6] * 0.6) * projected.units[axis]
          ),
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
    for (const owner of this.hasCustomMesh()
      ? owners
      : querySplatSpatialIndex(spatialIndex, projections)) {
      let pixelsPerMeter = 0;
      for (const view of views)
        pixelsPerMeter = Math.max(
          pixelsPerMeter,
          getSplatBoundedPixelsPerMeter(owner.center, owner.radius, view) *
            getSplatFocusWeight(owner.center, view, props.foveationStrength ?? 0)
        );
      const t = Math.max(
        0,
        Math.min(1, (Math.max(...owner.scale.map(Math.abs)) * pixelsPerMeter - 80) / 100)
      );
      const weight = t * t * (3 - 2 * t);
      nearWeights.set(owner.row, weight);
      if (weight > 0) near.push(owner.row);
      if (weight < 1) far.push(owner.row);
    }
    this.setState({
      near: retainSplatRows(this.state.near, near),
      nearWeights,
      far: retainSplatRows(this.state.far, far),
      owners,
      spatialIndex,
      projectionKey,
      // Ordinary LightingEffect has no prepareShadow callback. Keep conservative
      // casters until an optical host supplies a light volume; retain that volume on rebuild.
      ...(rebuild
        ? {
            shadowKey: '',
            ...(!this.state.shadowProjections
              ? {
                  shadow: owners.map(owner => owner.row),
                  shadowNear: owners.map(owner => owner.row),
                  shadowFar: [],
                  shadowWeights: new Map(owners.map(owner => [owner.row, 1]))
                }
              : {})
          }
        : {})
    });
    if (rebuild && this.state.shadowProjections)
      this.prepareShadow(this.state.shadowProjections, viewport);
  }
  private hasCustomMesh(): boolean {
    const row = this.props.data[0] as Row | undefined;
    return Boolean(row && this.props.mesh && this.props.mesh !== this.props.templateMesh);
  }
  prepareShadow(projections: SplatShadowProjection[], viewport: Viewport) {
    this.state.shadowProjections = projections;
    const key = projections
      .map(projection => [
        ...projection.matrix,
        ...projection.center,
        projection.width,
        projection.height
      ])
      .join(',');
    if (key === this.state.shadowKey) return;
    const first = this.state.owners[0];
    const relative = first ? this.projectPosition(first.position, {viewport}) : [0, 0, 0];
    const origin = first ? first.common.map((value, axis) => value - relative[axis]) : [0, 0, 0];
    const absoluteProjections = projections.map(projection => ({
      ...projection,
      center: projection.center.map(
        (value, axis) =>
          value -
          projection.matrix[axis] * origin[0] -
          projection.matrix[axis + 4] * origin[1] -
          projection.matrix[axis + 8] * origin[2]
      )
    }));
    const shadowWeights = new Map<Row, number>();
    const shadow: Row[] = [],
      shadowNear: Row[] = [],
      shadowFar: Row[] = [];
    const lightScales = absoluteProjections.map(
      projection =>
        0.5 *
        Math.max(
          Math.hypot(projection.matrix[0], projection.matrix[4], projection.matrix[8]) *
            projection.width,
          Math.hypot(projection.matrix[1], projection.matrix[5], projection.matrix[9]) *
            projection.height
        )
    );
    for (const owner of this.hasCustomMesh()
      ? this.state.owners
      : querySplatSpatialIndex(this.state.spatialIndex, absoluteProjections)) {
      shadow.push(owner.row);
      // Light-space footprint, never the camera's nominal map zoom. Small shadow branches
      // retain the connected coarse mesh rather than the entire fine skeleton.
      const pixels = owner.radius * Math.max(...lightScales);
      const t = Math.max(0, Math.min(1, (pixels - 80) / 100)),
        weight = t * t * (3 - 2 * t);
      shadowWeights.set(owner.row, weight);
      if (weight > 0) shadowNear.push(owner.row);
      if (weight < 1) shadowFar.push(owner.row);
    }
    this.setState({
      shadow: retainSplatRows(this.state.shadow, shadow),
      shadowWeights,
      shadowNear: retainSplatRows(this.state.shadowNear, shadowNear),
      shadowFar: retainSplatRows(this.state.shadowFar, shadowFar),
      shadowKey: key
    });
  }
  renderLayers() {
    const row = this.props.data[0] as Row | undefined;
    if (!row) return [];
    return (
      [
        ['near', this.state.near, false],
        ['far', this.state.far, true],
        ['shadow-near', this.state.shadowNear, false],
        ['shadow-far', this.state.shadowFar, true]
      ] as const
    ).flatMap(([id, data, aggregate]) =>
      data.length
        ? [
            new TreeMeshLayer({
              ...this.props,
              ...this.getSubLayerProps({id}),
              data,
              _dataDiff: getSplatChangedRanges,
              getCoverageRange: (owner: Row) => {
                const weight =
                  (id.startsWith('shadow-')
                    ? this.state.shadowWeights
                    : this.state.nearWeights
                  ).get(owner) ?? 0;
                return aggregate ? [weight, 1] : [0, weight];
              },
              updateTriggers: {
                ...this.props.updateTriggers,
                getCoverageRange: id.startsWith('shadow-')
                  ? this.state.shadowWeights
                  : this.state.nearWeights
              },
              operation: id.startsWith('shadow-') ? 'shadow' : 'draw',
              // Light-space children own casting; camera LoD children only receive shadows.
              shadowEnabled: id.startsWith('shadow-') && this.props.shadowEnabled !== false,
              pickable: !id.startsWith('shadow-') && this.props.pickable,
              woodMorph: !this.hasCustomMesh(),
              ...(this.hasCustomMesh() ? {getStemRadius: -1, getRootLength: -1} : {}),
              mesh: this.hasCustomMesh()
                ? this.props.mesh
                : getTreeWoodMesh(row.type, row.levels, aggregate, row.characteristics, true)
            })
          ]
        : []
    );
  }
}
