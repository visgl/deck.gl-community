// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  CompositeLayer,
  createIterable,
  type LayerProps,
  type Layer,
  type Position,
  type UpdateParameters,
  type Viewport
} from '@deck.gl/core';
import {SplatPrimitiveLayer, type PreparedSplatProps} from './splat-primitive-layer';
import {intersectsSplatLightVolume, getSplatPixelsPerMeter} from './splat-culling';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from './splat-spatial-index';
import type {SplatShadowProjection} from './splat-shadow-pass';
import type {SplatHierarchy} from './splat-hierarchy';
import {getSplatRadius, getSplatCenter} from './splat-source';
import {getSplatTransform} from './splat-transform';

type Owner<DataT> = {object: DataT; weight: number; index: number};
type PreparedOwner<DataT> = {
  row: Owner<DataT>;
  position: Position;
  common: number[];
  center: number[];
  scale: number;
  radius: number;
};
export type SplatLayerProps<DataT = unknown> = PreparedSplatProps<DataT> & LayerProps;

/** Prepared Gaussian templates with shared instances, spatial visibility and screen-error refinement. */
export class SplatLayer<DataT = unknown> extends CompositeLayer<
  Required<PreparedSplatProps<DataT>>
> {
  static layerName = 'SplatLayer';
  static defaultProps = SplatPrimitiveLayer.defaultProps;
  declare state: {
    groups: Owner<DataT>[][];
    shadowGroups: Owner<DataT>[][];
    hierarchy: SplatHierarchy;
    owners: PreparedOwner<DataT>[];
    spatialIndex: SplatSpatialNode<PreparedOwner<DataT>> | null;
    projectionKey: string;
  };
  private shadowKey = '';
  initializeState() {
    this.state = {
      groups: [],
      shadowGroups: [],
      hierarchy: [],
      owners: [],
      spatialIndex: null,
      projectionKey: ''
    };
  }
  shouldUpdateState({changeFlags}) {
    return changeFlags.somethingChanged;
  }

  updateState({changeFlags, props, oldProps}: UpdateParameters<this>) {
    const keys = [
      'source',
      'hierarchy',
      'getPosition',
      'getScale',
      'getOrientation',
      'getTranslation',
      'deformationStrength',
      'getDeformation',
      'modelMatrix',
      'coordinateSystem',
      'coordinateOrigin'
    ] as const;
    const triggers = changeFlags.updateTriggersChanged;
    const geometryChanged = keys.some(
      key =>
        (typeof props[key] !== 'function' &&
          (Array.isArray(props[key]) && Array.isArray(oldProps[key])
            ? props[key].length !== oldProps[key].length ||
              props[key].some((value, index) => value !== oldProps[key][index])
            : props[key] !== oldProps[key])) ||
        (triggers && (triggers.all || triggers[key]))
    );
    const refinementChanged = props.pixelError !== oldProps.pixelError;
    if (
      !changeFlags.dataChanged &&
      !changeFlags.viewportChanged &&
      !geometryChanged &&
      !refinementChanged
    )
      return;
    const hierarchy = this.props.hierarchy ?? [{source: this.props.source, error: 0}];
    if (
      !hierarchy.length ||
      hierarchy[0].source !== props.source ||
      hierarchy[0].error !== 0 ||
      hierarchy.some(
        (level, i) =>
          !Number.isFinite(level.error) ||
          level.error < 0 ||
          (i > 0 && level.error <= hierarchy[i - 1].error)
      )
    )
      throw new Error(
        'Splat hierarchy must start with source at error zero, followed by increasing finite errors.'
      );
    const viewport = this.context.viewport;
    const projectionKey = [
      viewport.projectionMode,
      viewport.resolution,
      ...viewport.distanceScales.unitsPerMeter
    ].join(',');
    const rebuild =
      Boolean(changeFlags.dataChanged || geometryChanged) ||
      this.state.projectionKey !== projectionKey;
    let {owners, spatialIndex} = this.state;
    if (rebuild) {
      owners = [];
      const sourceRadius = Math.max(...hierarchy.map(level => getSplatRadius(level.source)));
      const sourceCenter = getSplatCenter(props.source);
      const get = (accessor, object, info) =>
        typeof accessor === 'function' ? accessor(object, info) : accessor;
      const {iterable, objectInfo} = createIterable(this.props.data);
      for (const object of iterable as Iterable<DataT>) {
        objectInfo.index++;
        const position = get(this.props.getPosition, object, objectInfo);
        const scale = get(this.props.getScale, object, objectInfo);
        const translation = get(this.props.getTranslation, object, objectInfo);
        const maximumScale = Math.max(...scale.map(Math.abs));
        const radius =
          maximumScale * sourceRadius +
          Math.hypot(...translation) +
          Math.abs(this.props.deformationStrength) *
            Math.abs(get(this.props.getDeformation, object, objectInfo)[0]) *
            1.5 +
          Math.abs(this.props.deformationStrength) * maximumScale * sourceRadius * 0.5;
        const transform = getSplatTransform(
          get(this.props.getOrientation, object, objectInfo),
          scale,
          translation
        );
        const common = this.projectPosition(position, {viewport, autoOffset: false});
        const center = [0, 1, 2].map(
          axis =>
            common[axis] +
            (transform[axis] * sourceCenter[0] +
              transform[axis + 3] * sourceCenter[1] +
              transform[axis + 6] * sourceCenter[2] +
              translation[axis]) *
              viewport.distanceScales.unitsPerMeter[axis]
        );
        owners.push({
          row: this.getSubLayerRow(
            {object, weight: 1, index: objectInfo.index},
            object,
            objectInfo.index
          ),
          position,
          common,
          center,
          scale: maximumScale,
          radius: radius * Math.max(...viewport.distanceScales.unitsPerMeter)
        });
      }
      spatialIndex = createSplatSpatialIndex(
        owners.map(owner => ({center: owner.common, radius: owner.radius, value: owner}))
      );
    }
    const groups = hierarchy.map(() => [] as Owner<DataT>[]);
    const viewports = this.context.deck.getViewports();
    const views = viewports.length ? viewports : [viewport];
    const projections = views.map(view => ({
      matrix: view.viewProjectionMatrix,
      center: [0, 0, 0, 0],
      width: view.width,
      height: view.height
    }));
    const pixelRatio = this.context.device.canvasContext?.cssToDeviceRatio() ?? 1;
    // Traverse persistent owner bounds. A camera move does not reread all accessors or rebuild the BVH.
    for (const owner of querySplatSpatialIndex(spatialIndex, projections)) {
      const metersToPixels = Math.max(
        ...views.map(view => getSplatPixelsPerMeter(owner.center, view))
      );
      const pixels = metersToPixels * owner.scale * pixelRatio;
      let selected = 0;
      for (let level = 1; level < hierarchy.length; level++)
        if (hierarchy[level].error * pixels <= this.props.pixelError) selected = level;
      const next = selected + 1;
      const error = hierarchy[next]?.error * pixels;
      const blend =
        next < hierarchy.length
          ? Math.max(
              0,
              Math.min(1, (this.props.pixelError * 1.25 - error) / (this.props.pixelError * 0.25))
            )
          : 0;
      const wrap = (weight: number) =>
        weight === 1
          ? owner.row
          : this.getSubLayerRow({...owner.row, weight}, owner.row.object, owner.row.index);
      if (blend < 1) groups[selected].push(wrap(1 - blend));
      if (blend > 0) groups[next].push(wrap(blend));
    }
    const shadowGroups = rebuild
      ? hierarchy.map((_, level) =>
          level === hierarchy.length - 1 ? owners.map(owner => owner.row) : []
        )
      : this.state.shadowGroups;
    this.shadowKey = '';
    this.setState({groups, shadowGroups, hierarchy, owners, spatialIndex, projectionKey});
  }

  /** Query light-space bounds and choose light-map refinement independently of the camera. */
  prepareShadow(projections: SplatShadowProjection[], viewport: Viewport) {
    const key = projections
      .map(projection => [...projection.matrix, ...projection.center])
      .join(',');
    if (key === this.shadowKey) return;
    this.shadowKey = key;
    const shadowGroups = this.state.hierarchy.map(() => [] as Owner<DataT>[]);
    const first = this.state.owners[0];
    // Light matrices use deck's precision-preserving common-space origin. The BVH uses absolute common space.
    const relative = first
      ? this.projectPosition(Array.from(first.position), {viewport})
      : [0, 0, 0];
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
    for (const owner of querySplatSpatialIndex(this.state.spatialIndex, absoluteProjections)) {
      const lights = absoluteProjections.filter(projection =>
        intersectsSplatLightVolume(owner.common, owner.radius, projection)
      );
      const pixels =
        Math.max(
          ...lights.map(projection =>
            Math.max(
              Math.hypot(projection.matrix[0], projection.matrix[4], projection.matrix[8]) *
                projection.width,
              Math.hypot(projection.matrix[1], projection.matrix[5], projection.matrix[9]) *
                projection.height
            )
          )
        ) *
        0.5 *
        owner.scale *
        viewport.distanceScales.unitsPerMeter[2];
      let level = 0;
      for (let i = 1; i < this.state.hierarchy.length; i++)
        if (this.state.hierarchy[i].error * pixels <= this.props.pixelError) level = i;
      const next = level + 1;
      const error = this.state.hierarchy[next]?.error * pixels;
      const blend =
        next < this.state.hierarchy.length
          ? Math.max(
              0,
              Math.min(1, (this.props.pixelError * 1.25 - error) / (this.props.pixelError * 0.25))
            )
          : 0;
      const wrap = (weight: number) =>
        weight === 1
          ? owner.row
          : this.getSubLayerRow({...owner.row, weight}, owner.row.object, owner.row.index);
      if (blend < 1) shadowGroups[level].push(wrap(1 - blend));
      if (blend > 0) shadowGroups[next].push(wrap(blend));
    }
    this.setState({shadowGroups});
  }

  renderLayers(): Layer[] {
    const makeLayer = (data: Owner<DataT>[], level: number, shadow: boolean) => {
      const props = this.getSubLayerProps({
        id: shadow ? `shadow-casters-${level}` : `refinement-${level}`,
        updateTriggers: this.props.updateTriggers
      });
      const get = (accessor, row: Owner<DataT>, info) =>
        typeof accessor === 'function'
          ? accessor(row.object, {...info, index: row.index, data: this.props.data})
          : accessor;
      return new SplatPrimitiveLayer<Owner<DataT>>({
        ...this.props,
        ...props,
        data,
        source: this.state.hierarchy[level].source,
        operation: shadow ? 'shadow' : 'draw',
        pickable: !shadow && this.props.pickable,
        getPosition: (row, info) => get(this.props.getPosition, row, info),
        getScale: (row, info) => get(this.props.getScale, row, info),
        getOrientation: (row, info) => get(this.props.getOrientation, row, info),
        getTranslation: (row, info) => get(this.props.getTranslation, row, info),
        getColor: (row, info) => get(this.props.getColor, row, info),
        getDeformation: (row, info) => get(this.props.getDeformation, row, info),
        getCoverageWeight: row => row.weight
      });
    };
    return [
      ...this.state.groups.flatMap((data, level) =>
        data.length ? [makeLayer(data, level, false)] : []
      ),
      ...(this.props.shadowEnabled
        ? this.state.shadowGroups.flatMap((data, level) =>
            data.length ? [makeLayer(data, level, true)] : []
          )
        : [])
    ];
  }
}
