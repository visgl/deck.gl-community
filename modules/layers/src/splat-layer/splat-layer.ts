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
import {
  createSplatFrustum,
  intersectsSplatFrustum,
  getSplatBoundedPixelsPerMeter,
  getSplatFocusWeight,
  getSplatProjectionKey,
  getSplatCachedPosition,
  type SplatProjectedPosition
} from './splat-culling';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from './splat-spatial-index';
import type {SplatShadowProjection} from './splat-shadow-pass';
import type {SplatHierarchy} from './splat-hierarchy';
import {getSplatRadius, getSplatCenter} from './splat-source';
import {getSplatTransform} from './splat-transform';
import {getSplatDeformationRadius} from './splat-deformation';
import {budgetSplatSelections, type SplatSelection} from './splat-budget';
import {SplatRefinementTransition} from './splat-refinement-transition';
import {retainSplatRows, getSplatChangedRanges} from './splat-row-diff';

const equalOwners = (a: Owner<unknown>, b: Owner<unknown>) =>
  a.object === b.object && a.index === b.index && a.weight === b.weight;
type Owner<DataT> = {object: DataT; weight: number; index: number};
type PreparedOwner<DataT> = {
  key: string;
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
    members: Owner<DataT>[][];
    shadowMembers: Owner<DataT>[][];
    hierarchy: SplatHierarchy;
    owners: PreparedOwner<DataT>[];
    spatialIndex: SplatSpatialNode<PreparedOwner<DataT>> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
    refinement: SplatRefinementTransition<PreparedOwner<DataT>>;
    shadowRefinement: SplatRefinementTransition<PreparedOwner<DataT>>;
    shadowProjections: SplatShadowProjection[] | null;
    refinementRows: WeakMap<
      object,
      {owner: PreparedOwner<DataT>; revision: number; rows: (Owner<DataT> | undefined)[]}
    >;
  };
  private shadowKey = '';
  initializeState() {
    this.state = {
      groups: [],
      shadowGroups: [],
      members: [],
      shadowMembers: [],
      hierarchy: [],
      owners: [],
      spatialIndex: null,
      projectionKey: '',
      projectedPositions: new Map(),
      refinement: new SplatRefinementTransition(),
      shadowRefinement: new SplatRefinementTransition(),
      shadowProjections: null,
      refinementRows: new WeakMap()
    };
  }
  get isLoaded(): boolean {
    return (
      super.isLoaded &&
      !this.state.refinement.active &&
      (!this.props.shadowEnabled || !this.state.shadowRefinement.active)
    );
  }
  shouldUpdateState({changeFlags}) {
    return changeFlags.somethingChanged;
  }

  updateState({changeFlags, props, oldProps}: UpdateParameters<this>) {
    const keys = [
      'source',
      'hierarchy',
      'support',
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
    const refinementChanged =
      props.pixelError !== oldProps.pixelError ||
      props.foveationStrength !== oldProps.foveationStrength ||
      props.maxSplats !== oldProps.maxSplats ||
      props.maxShadowSplats !== oldProps.maxShadowSplats;
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
    const projectionKey = getSplatProjectionKey(viewport);
    const rebuild =
      Boolean(changeFlags.dataChanged || geometryChanged) ||
      this.state.projectionKey !== projectionKey;
    let {owners, spatialIndex} = this.state;
    if (props.hierarchy !== oldProps.hierarchy || props.source !== oldProps.source) {
      this.state.refinement = new SplatRefinementTransition();
      this.state.shadowRefinement = new SplatRefinementTransition();
    }
    if (rebuild) {
      owners = [];
      const duplicates = new Map<string, number>();
      const previous =
        geometryChanged || this.state.projectionKey !== projectionKey
          ? new Map<string, SplatProjectedPosition>()
          : this.state.projectedPositions;
      const next = new Map<string, SplatProjectedPosition>();
      const sourceCenter = getSplatCenter(props.source);
      const sourceRadius = Math.max(
        ...hierarchy.map(level => getSplatRadius(level.source, props.support, sourceCenter))
      );
      const get = (accessor, object, info) =>
        typeof accessor === 'function' ? accessor(object, info) : accessor;
      const {iterable, objectInfo} = createIterable(this.props.data);
      for (const object of iterable as Iterable<DataT>) {
        objectInfo.index++;
        const position = get(this.props.getPosition, object, objectInfo);
        const scale = get(this.props.getScale, object, objectInfo);
        const translation = get(this.props.getTranslation, object, objectInfo);
        const maximumScale = Math.max(...scale.map(Math.abs));
        const deformation = get(this.props.getDeformation, object, objectInfo);
        const strength = Math.abs(this.props.deformationStrength * deformation[2]);
        const transform = getSplatTransform(
          get(this.props.getOrientation, object, objectInfo),
          scale,
          translation
        );
        const {common, units} = getSplatCachedPosition(position, viewport, previous, next, point =>
          this.projectPosition(point, {viewport, autoOffset: false})
        );
        const localCenter = [0, 1, 2].map(
          axis =>
            transform[axis] * sourceCenter[0] +
            transform[axis + 3] * sourceCenter[1] +
            transform[axis + 6] * sourceCenter[2] +
            translation[axis]
        );
        const radius = getSplatDeformationRadius(
          localCenter,
          maximumScale * sourceRadius,
          deformation[0],
          strength
        );
        const center = localCenter.map((value, axis) => common[axis] + value * units[axis]);
        // Physical pose survives streamed wrapper/index replacement. Duplicate poses
        // remain separate owners; the template/hierarchy belongs to this layer.
        const pose = [...position, ...transform, ...deformation].join(',');
        const occurrence = duplicates.get(pose) ?? 0;
        duplicates.set(pose, occurrence + 1);
        owners.push({
          key: `${pose}/${occurrence}`,
          row: this.getSubLayerRow(
            {object, weight: 1, index: objectInfo.index},
            object,
            objectInfo.index
          ),
          position,
          common,
          center,
          scale: maximumScale,
          radius: radius * Math.max(...units)
        });
      }
      this.state.projectedPositions = next;
      spatialIndex = createSplatSpatialIndex(
        owners.map(owner => ({center: owner.center, radius: owner.radius, value: owner}))
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
    const pixelRatio = this.context.device.canvasContext?.cssToDeviceRatio() ?? 1;
    const candidates: SplatSelection<PreparedOwner<DataT>>[] = [];
    // Traverse persistent owner bounds. A camera move does not reread all accessors or rebuild the BVH.
    for (const owner of querySplatSpatialIndex(spatialIndex, projections)) {
      let metersToPixels = 0;
      for (const view of views)
        metersToPixels = Math.max(
          metersToPixels,
          getSplatBoundedPixelsPerMeter(owner.center, owner.radius, view) *
            getSplatFocusWeight(owner.center, view, props.foveationStrength)
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
      candidates.push({
        owner,
        pixels,
        level: selected,
        blend,
        retainedLevel: this.state.refinement.getLevel(owner.key)
      });
    }
    this.state.hierarchy = hierarchy;
    // deck.gl suppresses updateTriggers when dataChanged has partial ranges.
    // Authored transform changes must refresh every retained owner's attributes.
    if (geometryChanged) {
      this.state.groups = [];
      this.state.shadowGroups = [];
    }
    const membershipChanged = this.state.refinement.reconcile(
      budgetSplatSelections(candidates, hierarchy, props.maxSplats * 0.75),
      hierarchy.map(level => level.source.positions.length / 3),
      props.maxSplats,
      owner => owner.key
    );
    const groups =
      membershipChanged || geometryChanged
        ? this.getRefinementGroups(this.state.refinement)
        : this.state.groups;
    // A standalone layer has conservative casters before a host supplies a light volume.
    // Existing light selections survive streamed rebuilds instead of flashing back to the floor.
    if (
      !this.state.shadowProjections &&
      (rebuild || refinementChanged || !this.state.shadowRefinement.entries.size)
    )
      this.state.shadowRefinement.reconcile(
        owners.map(owner => ({owner, pixels: 0, level: hierarchy.length - 1, blend: 0})),
        hierarchy.map(level => level.source.positions.length / 3),
        props.maxShadowSplats,
        owner => owner.key
      );
    const shadowGroups =
      rebuild || !this.state.shadowGroups.length
        ? this.getRefinementGroups(this.state.shadowRefinement)
        : this.state.shadowGroups;
    if (rebuild || refinementChanged) this.shadowKey = '';
    this.setState({
      groups: rebuild
        ? groups
        : groups.map((rows, level) =>
            retainSplatRows(this.state.groups[level] ?? [], rows, equalOwners)
          ),
      shadowGroups,
      hierarchy,
      owners,
      spatialIndex,
      projectionKey,
      ...(rebuild ? {members: [], shadowMembers: []} : {})
    });
    if ((rebuild || refinementChanged) && this.state.shadowProjections)
      this.prepareShadow(this.state.shadowProjections, viewport);
  }

  /** Query light-space bounds and choose light-map refinement independently of the camera. */
  prepareShadow(projections: SplatShadowProjection[], viewport: Viewport) {
    this.state.shadowProjections = projections;
    const first = this.state.owners[0];
    // Light matrices use deck's precision-preserving common-space origin. The BVH uses absolute common space.
    const relative = first
      ? this.projectPosition(Array.from(first.position), {viewport})
      : [0, 0, 0];
    const origin = first ? first.common.map((value, axis) => value - relative[axis]) : [0, 0, 0];
    const key =
      origin.join(',') +
      ':' +
      viewport.distanceScales.unitsPerMeter[2] +
      ':' +
      projections
        .map(projection => [
          ...projection.matrix,
          ...projection.center,
          projection.width,
          projection.height
        ])
        .join(',');
    if (key === this.shadowKey) return;
    this.shadowKey = key;

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
    const frusta = absoluteProjections.map(createSplatFrustum);
    const lightPixels = absoluteProjections.map(
      projection =>
        Math.max(
          Math.hypot(projection.matrix[0], projection.matrix[4], projection.matrix[8]) *
            projection.width,
          Math.hypot(projection.matrix[1], projection.matrix[5], projection.matrix[9]) *
            projection.height
        ) *
        0.5 *
        viewport.distanceScales.unitsPerMeter[2]
    );
    const candidates: SplatSelection<PreparedOwner<DataT>>[] = [];
    for (const owner of querySplatSpatialIndex(this.state.spatialIndex, absoluteProjections)) {
      let pixels = 0;
      for (let light = 0; light < frusta.length; light++)
        if (intersectsSplatFrustum(owner.center, owner.radius, frusta[light]))
          pixels = Math.max(pixels, lightPixels[light] * owner.scale);
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
      candidates.push({
        owner,
        pixels,
        level,
        blend,
        retainedLevel: this.state.shadowRefinement.getLevel(owner.key)
      });
    }
    const membershipChanged = this.state.shadowRefinement.reconcile(
      budgetSplatSelections(candidates, this.state.hierarchy, this.props.maxShadowSplats * 0.75),
      this.state.hierarchy.map(level => level.source.positions.length / 3),
      this.props.maxShadowSplats,
      owner => owner.key
    );
    if (!membershipChanged) return;
    const shadowGroups = this.getRefinementGroups(this.state.shadowRefinement);

    this.setState({
      shadowGroups: shadowGroups.map((rows, level) =>
        retainSplatRows(this.state.shadowGroups[level] ?? [], rows, equalOwners)
      )
    });
  }

  /** Advance existing mixtures without reculling or rebuilding owner geometry. */
  updateRefinement(now: number) {
    const cameraChanged = this.state.refinement.sample(now);
    const shadowChanged = this.state.shadowRefinement.sample(now);
    if (cameraChanged || shadowChanged)
      this.setState({
        ...(cameraChanged ? {groups: this.getRefinementGroups(this.state.refinement)} : {}),
        ...(shadowChanged
          ? {shadowGroups: this.getRefinementGroups(this.state.shadowRefinement)}
          : {})
      });
    if (this.state.refinement.active || this.state.shadowRefinement.active) this.setNeedsRedraw();
  }
  private getRefinementGroups(transition: SplatRefinementTransition<PreparedOwner<DataT>>) {
    const groups = this.state.hierarchy.map(() => [] as Owner<DataT>[]);
    // The hierarchy is updated by updateState immediately after target reconciliation.
    if (!groups.length)
      for (let i = 0; i < (this.props.hierarchy?.length ?? 1); i++) groups.push([]);
    for (const entry of transition.entries.values()) {
      const {owner, weights} = entry;
      let cached = this.state.refinementRows.get(entry);
      if (!cached || cached.owner !== owner || cached.revision !== entry.revision) {
        const total = weights.reduce((sum, weight) => sum + weight * weight, 0);
        const rows = weights.map(value => {
          const weight = (value * value) / total;
          return weight > 0
            ? weight === 1
              ? owner.row
              : this.getSubLayerRow({...owner.row, weight}, owner.row.object, owner.row.index)
            : undefined;
        });
        cached = {owner, revision: entry.revision, rows};
        this.state.refinementRows.set(entry, cached);
      }
      for (let level = 0; level < cached.rows.length; level++) {
        const row = cached.rows[level];
        if (row) groups[level].push(row);
      }
    }
    return groups.map((rows, level) =>
      retainSplatRows(
        (transition === this.state.refinement ? this.state.groups : this.state.shadowGroups)[
          level
        ] ?? [],
        rows,
        equalOwners
      )
    );
  }

  renderLayers(): Layer[] {
    const makeLayer = (data: Owner<DataT>[], level: number, shadow: boolean) => {
      const memberGroups = shadow ? this.state.shadowMembers : this.state.members;
      // Coverage changes do not change ownership or transforms. Keep the data list stable
      // and invalidate only its coverage attribute instead of re-uploading every buffer.
      const members = retainSplatRows(
        memberGroups[level] ?? [],
        [...data],
        (a, b) => a.object === b.object && a.index === b.index
      );
      memberGroups[level] = members;

      const props = this.getSubLayerProps({
        id: shadow ? `shadow-casters-${level}` : `refinement-${level}`,
        updateTriggers: this.props.updateTriggers
      });
      const get = (accessor, row: Owner<DataT>, info) =>
        typeof accessor === 'function'
          ? accessor(row.object, {...info, index: row.index, data: this.props.data})
          : accessor;
      const wrappedTriggers = {...props.updateTriggers};
      for (const name of [
        'getPosition',
        'getScale',
        'getOrientation',
        'getTranslation',
        'getColor',
        'getDeformation'
      ] as const)
        wrappedTriggers[name] = [
          props.updateTriggers?.[name],
          typeof this.props[name] === 'function' ? null : this.props[name]
        ];
      return new SplatPrimitiveLayer<Owner<DataT>>({
        ...this.props,
        ...props,
        data: members,
        updateTriggers: {
          ...wrappedTriggers,
          getCoverageWeight: [props.updateTriggers?.getCoverageWeight, data]
        },
        _dataDiff: (next, previous) => {
          const ranges = getSplatChangedRanges(
            next as Owner<DataT>[],
            previous as Owner<DataT>[] | undefined
          );
          return ranges;
        },
        source: this.state.hierarchy[level].source,
        operation: shadow ? 'shadow' : 'draw',
        pickable: !shadow && this.props.pickable,
        getPosition: (row, info) => get(this.props.getPosition, row, info),
        getScale: (row, info) => get(this.props.getScale, row, info),
        getOrientation: (row, info) => get(this.props.getOrientation, row, info),
        getTranslation: (row, info) => get(this.props.getTranslation, row, info),
        getColor: (row, info) => get(this.props.getColor, row, info),
        getDeformation: (row, info) => get(this.props.getDeformation, row, info),
        getCoverageWeight: (row, info) =>
          get(this.props.getCoverageWeight, row, info) * data[info.index].weight
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
