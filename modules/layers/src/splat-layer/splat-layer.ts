// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  CompositeLayer,
  _GlobeViewport as GlobeViewport,
  COORDINATE_SYSTEM,
  type Accessor,
  type DefaultProps,
  createIterable,
  type LayerProps,
  type Layer,
  type Position,
  type UpdateParameters,
  type Viewport
} from '@deck.gl/core';
import {SplatEffect} from './splat-effect';
import {SplatPrimitiveLayer, type PreparedSplatProps} from './splat-primitive-layer';
import {
  createSplatFrustum,
  intersectsSplatFrustum,
  getSplatBoundedPixelsPerMeter,
  getSplatFocusWeight,
  getSplatProjectionKey,
  getSplatCachedPosition,
  getSplatCommonUnits,
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
import {getSplatTransform, getSplatTransformScale} from './splat-transform';
import {getSplatDeformationRadius} from './splat-deformation';
import {budgetSplatSelections, type SplatSelection} from './splat-budget';
import {SplatRefinementTransition} from './splat-refinement-transition';
import {retainSplatRows, getSplatChangedRanges} from './splat-row-diff';
import {
  DEFAULT_GET_SOURCE,
  isSplatSceneData,
  isSplatDataInput,
  resolveSplatInput,
  type ResolvedSplatInput,
  type ResolvedSplatAsset,
  type SplatDataInput,
  type SplatInstance
} from './splat-input';
import {SplatRuntime, SplatSelectionEffect, type SplatBudgetGroup} from './splat-runtime';
import type {SplatSource} from './splat-source';
import {SplatSceneLayer} from './scene/splat-scene-layer';
import {getSplatSceneProjectionError} from './scene/splat-scene-projection';
import type {SplatLayerStatus} from './scene/rad-scene';

const equalOwners = (a: Owner<unknown>, b: Owner<unknown>) =>
  a.object === b.object && a.index === b.index && a.weight === b.weight;

function hasSplatOpticalDepths(input: SplatDataInput): boolean {
  const source = input && typeof input === 'object' && 'source' in input ? input.source : input;
  return Boolean(
    source && typeof source === 'object' && 'opticalDepths' in source && source.opticalDepths
  );
}
type Owner<DataT> = {object: DataT; weight: number; index: number};
type PreparedOwner<DataT> = {
  key: string;
  row: Owner<DataT>;
  asset: ResolvedSplatAsset;
  offset: number;
  position: Position;
  common: number[];
  center: number[];
  scale: number;
  radius: number;
};
type _SplatLayerProps<DataT> = Omit<
  PreparedSplatProps<DataT>,
  'data' | 'source' | 'transparency'
> & {
  /** A Gaussian asset, scene URL/Blob, or application-owned instance rows. */
  data: DataT[] | SplatDataInput;
  /** Reusable asset per owner. Defaults to the row's splats field. */
  getSource?: Accessor<DataT, SplatDataInput>;
  /** Legacy constant-template input. Cannot be combined with explicit getSource. */
  source?: SplatSource;
  /**
   * Auto selects weighted prepared assets or sorted scenes; explicit sorted shares an ordering domain.
   * @default 'auto'
   */
  transparency?: 'auto' | 'weighted' | 'sorted';
  /** Optional worker factory for CommonJS or hosts that manage worker URLs explicitly. */
  workerFactory?: (type: 'rad' | 'static') => Worker;
  /** Coit compatibility alias for maxSplats. Conflicting finite values are rejected. */
  maxActiveSplats?: number;
  /** Maximum admitted source rows; scene refinement has bounded transition headroom. */
  maxResidentSplats?: number;
  /** Concurrent RAD downloads. Updates preserve active loads; shared sources use the lowest limit. */
  maxConcurrentLoads?: number;
  /** Independently ordered transparent domain. Layers in the same domain share one order. */
  sortDomain?: string;
  /** Source loading, residency and refinement diagnostics. */
  onStatusChange?: (status: SplatLayerStatus) => void;
  /** Aggregate settled submission cap across visible SplatLayers on this deck/device. */
  maxTotalSplats?: number;
  /** @internal Shared cap inherited from a composing layer. */
  _splatBudgetGroup?: SplatBudgetGroup;
};

/** Properties for prepared Gaussian assets, Cartesian scenes and their original owner rows. */
export type SplatLayerProps<DataT = SplatInstance> = _SplatLayerProps<DataT> & LayerProps;

/** Counts submitted Gaussians independently from the number of owning instances. */
export type SplatLayerStats = {
  /** Resolved immutable source and hierarchy pairs. */
  sourceCount: number;
  /** Owner instances in the current camera selection. */
  visibleInstances: number;
  /** Owner instances in the independent light-space selection. */
  shadowInstances: number;
  /** Camera Gaussian submissions, including fading representations. */
  renderedSplats: number;
  /** Light-space Gaussian submissions, including fading representations. */
  shadowSplats: number;
  /** Cost of the coarsest retained camera representation of every owner. */
  coverageFloor: number;
  /** Cost of the coarsest retained light-space representation of every owner. */
  shadowCoverageFloor: number;
  /** Camera owners whose optical detail mixture is still moving. */
  refiningInstances: number;
};
const defaultProps: DefaultProps<SplatLayerProps> = {
  ...SplatPrimitiveLayer.defaultProps,
  // Asset URLs must not fall through the ordinary JSON data loader.
  data: {type: 'data', value: [], async: false},
  getSource: {type: 'accessor', value: DEFAULT_GET_SOURCE},
  transparency: 'auto',
  workerFactory: {type: 'function', value: null, optional: true},
  maxActiveSplats: Infinity,
  maxResidentSplats: 8_000_000,
  maxConcurrentLoads: 8,
  sortDomain: 'default',
  onStatusChange: {type: 'function', value: null, optional: true},
  maxTotalSplats: Infinity,
  _splatBudgetGroup: null
};

/** Composite Gaussian assets and native scenes sharing instance ownership and host resources. */
export class SplatLayer<DataT = SplatInstance> extends CompositeLayer<
  Required<_SplatLayerProps<DataT>>
> {
  static layerName = 'SplatLayer';
  static defaultProps = defaultProps;
  declare state: {
    scene: boolean;
    sceneProjectionError: string | null;
    rowSources: SplatDataInput[] | null;
    groups: Owner<DataT>[][];
    shadowGroups: Owner<DataT>[][];
    members: Owner<DataT>[][];
    shadowMembers: Owner<DataT>[][];
    hierarchy: SplatHierarchy;
    input: ResolvedSplatInput<DataT>;
    candidates: SplatSelection<PreparedOwner<DataT>>[];
    shadowCandidates: SplatSelection<PreparedOwner<DataT>>[];
    runtime: SplatRuntime;
    renderPixelRatio?: number;
    requestedRenderPixelRatio?: number;
    owners: PreparedOwner<DataT>[];
    spatialIndex: SplatSpatialNode<PreparedOwner<DataT>> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
    refinement: SplatRefinementTransition<PreparedOwner<DataT>>;
    shadowRefinement: SplatRefinementTransition<PreparedOwner<DataT>>;
    shadowProjections: SplatShadowProjection[] | null;
    shadowKey: string;
    refinementRows: WeakMap<
      object,
      {owner: PreparedOwner<DataT>; revision: number; rows: (Owner<DataT> | undefined)[]}
    >;
  };
  initializeState() {
    this.state = {
      scene: false,
      sceneProjectionError: null,
      rowSources: null,
      groups: [],
      shadowGroups: [],
      members: [],
      shadowMembers: [],
      hierarchy: [],
      input: {data: [], assets: [], rowAssets: []},
      candidates: [],
      shadowCandidates: [],
      runtime: undefined!,
      owners: [],
      spatialIndex: null,
      projectionKey: '',
      projectedPositions: new Map(),
      refinement: new SplatRefinementTransition(),
      shadowRefinement: new SplatRefinementTransition(),
      shadowProjections: null,
      shadowKey: '',
      refinementRows: new WeakMap()
    };
  }
  get isLoaded(): boolean {
    return (
      super.isLoaded &&
      (this.state.scene ||
        (!this.state.refinement.active &&
          (!this.props.shadowEnabled || !this.state.shadowRefinement.active)))
    );
  }
  shouldUpdateState({changeFlags}) {
    return (
      changeFlags.somethingChanged ||
      (!this.state.scene &&
        Boolean(
          this.state.runtime &&
            this.state.runtime !== SplatRuntime.get(this.context.deck, this.context.device)
        ))
    );
  }

  updateState({changeFlags, props, oldProps}: UpdateParameters<this>) {
    const direct = isSplatDataInput(props.data);
    if (props.source && (direct || props.getSource !== DEFAULT_GET_SOURCE))
      throw new Error(
        'SplatLayer source cannot be combined with direct asset data or an explicit getSource.'
      );
    if (direct && props.getSource !== DEFAULT_GET_SOURCE)
      throw new Error('SplatLayer getSource applies to instance rows, not direct asset data.');
    const sourceTriggers = changeFlags.updateTriggersChanged;
    const sourceAccessorChanged =
      (typeof props.getSource !== 'function' || typeof oldProps.getSource !== 'function') &&
      props.getSource !== oldProps.getSource;
    if (
      Array.isArray(props.data) &&
      (!this.state.rowSources ||
        changeFlags.dataChanged ||
        sourceAccessorChanged ||
        props.source !== oldProps.source ||
        (sourceTriggers && (sourceTriggers.all || sourceTriggers.getSource)))
    ) {
      this.state.rowSources = props.data.map(
        (row, index) =>
          props.source ??
          (typeof props.getSource === 'function'
            ? props.getSource(row, {index, data: props.data as DataT[], target: []})
            : props.getSource)
      );
    }
    if (!Array.isArray(props.data)) this.state.rowSources = null;
    const sources = Array.isArray(props.data) ? (this.state.rowSources ?? []) : [props.data];
    const sceneSourceChanged = Boolean(
      changeFlags.dataChanged ||
        sourceAccessorChanged ||
        props.source !== oldProps.source ||
        (sourceTriggers && (sourceTriggers.all || sourceTriggers.getSource))
    );
    const sortedCartesian =
      props.transparency === 'sorted' &&
      !sources.some(hasSplatOpticalDepths) &&
      !props._splatBudgetGroup;
    // Cartesian prepared assets and rows in an unbudgeted sorted domain share ordering with RAD rows.
    const scene =
      isSplatSceneData(props.data) ||
      Boolean(this.state.rowSources?.some(isSplatSceneData)) ||
      (sortedCartesian &&
        (props.coordinateSystem === COORDINATE_SYSTEM.CARTESIAN ||
          (this.state.scene && !sceneSourceChanged)));
    if (scene) {
      if (
        Number.isFinite(props.maxActiveSplats) &&
        Number.isFinite(props.maxSplats) &&
        props.maxActiveSplats !== props.maxSplats
      )
        throw new Error('maxActiveSplats and maxSplats must agree when both are specified.');
      if (props.transparency === 'weighted')
        throw new Error('RAD scenes require sorted transparency.');
      const projectionError = getSplatSceneProjectionError(props.coordinateSystem);
      if (projectionError !== this.state.sceneProjectionError) {
        this.setState({sceneProjectionError: projectionError});
        if (projectionError)
          this.raiseError(new Error(projectionError), 'unsupported scene projection');
      }
      if (!this.state.scene) {
        this.state.runtime?.delete(this.id);
        this.setState({scene: true});
      }
      return;
    }
    const activeViewports = [this.context.viewport, ...this.context.deck.getViewports()];
    if (activeViewports.some(view => view instanceof GlobeViewport))
      throw new Error(
        'SplatLayer supports planar views; GlobeView requires globe-aligned covariance and bounds.'
      );
    if (activeViewports.some(view => view.subViewports?.some(copy => copy !== view)))
      throw new Error('SplatLayer does not support wrapped world copies; disable MapView.repeat.');
    const leavingScene = this.state.scene;
    if (leavingScene) this.setState({scene: false, sceneProjectionError: null});
    const runtime = SplatRuntime.get(this.context.deck, this.context.device);
    const runtimeChanged = runtime !== this.state.runtime;
    const renderPixelRatio =
      this.state.requestedRenderPixelRatio ??
      this.context.device.canvasContext?.cssToDeviceRatio() ??
      1;
    const keys = [
      'source',
      'getSource',
      'getTransformMatrix',
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
    const geometryChanged =
      sourceAccessorChanged ||
      keys.some(
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
      props.maxShadowSplats !== oldProps.maxShadowSplats ||
      props.kernelVariance !== oldProps.kernelVariance ||
      renderPixelRatio !== this.state.renderPixelRatio;
    if (
      !leavingScene &&
      !runtimeChanged &&
      !changeFlags.dataChanged &&
      !changeFlags.viewportChanged &&
      !geometryChanged &&
      !refinementChanged
    ) {
      this.publishDemand(false, this.state.candidates);
      this.publishDemand(true, this.state.shadowCandidates);
      return;
    }
    const inputChanged = Boolean(
      changeFlags.dataChanged || geometryChanged || leavingScene || runtimeChanged
    );
    const input = inputChanged
      ? resolveSplatInput({
          data: props.data,
          source: props.source,
          hierarchy: props.hierarchy,
          getSource: props.getSource,
          rowSources: this.state.rowSources ?? undefined
        })
      : this.state.input;
    const assetsChanged =
      input.assets.length !== this.state.input.assets.length ||
      input.assets.some((asset, i) => asset !== this.state.input.assets[i]);
    const hierarchy = input.assets.flatMap(asset => asset.hierarchy);
    const offsets = new Map<ResolvedSplatAsset, number>();
    let offset = 0;
    for (const asset of input.assets) {
      offsets.set(asset, offset);
      offset += asset.hierarchy.length;
    }
    if (runtimeChanged) {
      this.state.runtime?.delete(this.id);
      this.state.runtime = runtime;
      if (typeof this.context.deck._addDefaultEffect === 'function') {
        SplatSelectionEffect.get(this.context.deck);
        SplatEffect.get(this.context.deck);
      }
    }
    this.state.input = input;
    const viewport = this.context.viewport;
    const projectionKey = getSplatProjectionKey(viewport);
    const rebuild =
      Boolean(changeFlags.dataChanged || geometryChanged || leavingScene || runtimeChanged) ||
      this.state.projectionKey !== projectionKey;
    let {owners, spatialIndex} = this.state;
    if (rebuild) {
      owners = [];
      const duplicates = new Map<string, number>();
      const previous =
        geometryChanged || this.state.projectionKey !== projectionKey
          ? new Map<string, SplatProjectedPosition>()
          : this.state.projectedPositions;
      const next = new Map<string, SplatProjectedPosition>();

      const bounds = new Map(
        input.assets.map(asset => {
          const center = getSplatCenter(asset.source);
          return [
            asset,
            {
              center,
              radius: Math.max(
                ...asset.hierarchy.map(level => getSplatRadius(level.source, props.support, center))
              )
            }
          ] as const;
        })
      );
      const get = (accessor, object, info) =>
        typeof accessor === 'function' ? accessor(object, info) : accessor;
      const {iterable, objectInfo} = createIterable(input.data);
      for (const object of iterable as Iterable<DataT>) {
        objectInfo.index++;
        const asset = input.rowAssets[objectInfo.index];
        const {center: sourceCenter, radius: sourceRadius} = bounds.get(asset)!;
        const position = get(this.props.getPosition, object, objectInfo);
        const scale = get(this.props.getScale, object, objectInfo);
        const matrix = get(props.getTransformMatrix, object, objectInfo);
        const translation = matrix
          ? Array.from(matrix).slice(12, 15)
          : get(this.props.getTranslation, object, objectInfo);
        const maximumScale = matrix
          ? getSplatTransformScale(matrix)
          : Math.max(...scale.map(Math.abs));
        const deformation = get(this.props.getDeformation, object, objectInfo);
        const strength = Math.abs(this.props.deformationStrength * deformation[2]);
        const transform = getSplatTransform(
          get(this.props.getOrientation, object, objectInfo),
          scale,
          translation,
          matrix
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
        const pose = [asset.id, ...position, ...transform, ...deformation].join(',');
        const occurrence = duplicates.get(pose) ?? 0;
        duplicates.set(pose, occurrence + 1);
        owners.push({
          key: `${pose}/${occurrence}`,
          asset,
          offset: offsets.get(asset)!,
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
    const filterPadding = (props.support * Math.sqrt(props.kernelVariance)) / renderPixelRatio;
    for (const owner of querySplatSpatialIndex(spatialIndex, projections, filterPadding)) {
      let metersToPixels = 0;
      for (const view of views)
        metersToPixels = Math.max(
          metersToPixels,
          getSplatBoundedPixelsPerMeter(owner.center, owner.radius, view) *
            getSplatFocusWeight(owner.center, view, props.foveationStrength)
        );
      const pixels = metersToPixels * owner.scale * pixelRatio;
      const hierarchy = owner.asset.hierarchy;
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
    this.state.renderPixelRatio = renderPixelRatio;
    this.state.hierarchy = hierarchy;
    // deck.gl suppresses updateTriggers when dataChanged has partial ranges.
    // Changed data may reuse mutated owner objects. Refresh their row wrappers
    // so child attribute diffs upload the new values, while camera moves retain rows.
    if (changeFlags.dataChanged || geometryChanged || assetsChanged) {
      this.state.groups = [];
      this.state.shadowGroups = [];
    }
    let sharedBudget = props.maxTotalSplats;
    for (let group = props._splatBudgetGroup; group; group = group.parent)
      sharedBudget = Math.min(sharedBudget, group.maxSplats);
    // New registrations have not received their joint grant yet. Start from coverage,
    // including after source replacement, rather than uploading an unbounded first draw.
    const initialCandidates =
      !this.state.refinement.entries.size && Number.isFinite(sharedBudget)
        ? candidates.map(row => ({
            ...row,
            level: row.owner.asset.hierarchy.length - 1,
            blend: 0
          }))
        : candidates;
    const membershipChanged = this.state.refinement.reconcile(
      budgetSplatSelections(
        initialCandidates,
        owner => owner.asset.hierarchy,
        props.maxSplats * 0.75
      ),
      owner => owner.asset.hierarchy.map(level => level.source.positions.length / 3),
      props.maxSplats,
      owner => owner.key
    );
    const groups =
      membershipChanged || changeFlags.dataChanged || geometryChanged || assetsChanged
        ? this.getRefinementGroups(this.state.refinement)
        : this.state.groups;
    // A standalone layer has conservative casters before a host supplies a light volume.
    // Existing light selections survive streamed rebuilds instead of flashing back to the floor.
    if (
      !this.state.shadowProjections &&
      (rebuild || refinementChanged || !this.state.shadowRefinement.entries.size)
    )
      this.state.shadowRefinement.reconcile(
        owners.map(owner => ({
          owner,
          pixels: 0,
          level: owner.asset.hierarchy.length - 1,
          blend: 0
        })),
        owner => owner.asset.hierarchy.map(level => level.source.positions.length / 3),
        props.maxShadowSplats,
        owner => owner.key
      );
    if ((rebuild || refinementChanged) && this.state.shadowProjections) {
      // Reconcile retained light owners against the new hierarchy before regrouping:
      // removed assets can shorten it and shift every surviving owner's offset.
      this.state.spatialIndex = spatialIndex;
      this.state.owners = owners;
      this.state.shadowKey = '';
      this.prepareShadow(this.state.shadowProjections, viewport);
    }
    const shadowGroups =
      rebuild || !this.state.shadowGroups.length
        ? this.getRefinementGroups(this.state.shadowRefinement)
        : this.state.shadowGroups;
    this.setState({
      groups: rebuild
        ? groups
        : groups.map((rows, level) =>
            retainSplatRows(this.state.groups[level] ?? [], rows, equalOwners)
          ),
      shadowGroups,
      hierarchy,
      owners,
      candidates,
      spatialIndex,
      projectionKey,
      ...(rebuild ? {members: [], shadowMembers: []} : {})
    });
    this.publishDemand(false, candidates);
    if (!this.state.shadowProjections) {
      this.state.shadowCandidates = owners.map(owner => ({
        owner,
        pixels: 0,
        level: owner.asset.hierarchy.length - 1,
        blend: 0
      }));
      this.publishDemand(true, this.state.shadowCandidates);
    }
  }

  private publishDemand(shadow: boolean, candidates: SplatSelection<PreparedOwner<DataT>>[]) {
    const runtime = this.state.runtime;
    if (!runtime) return;
    runtime.set(this.id, shadow, {
      rows: shadow && !this.props.shadowEnabled ? [] : candidates,
      hierarchy: owner => owner.asset.hierarchy,
      maxSplats: shadow ? this.props.maxShadowSplats : this.props.maxSplats,
      maxTotalSplats: this.props.maxTotalSplats,
      group: this.props._splatBudgetGroup,
      tick: now => (this.getCurrentLayer() as this | null)?.updateRefinement(now),
      apply: (rows, budget) =>
        (this.getCurrentLayer() as this | null)?.applyAllocation(shadow, rows, budget)
    });
  }
  private applyAllocation(
    shadow: boolean,
    rows: SplatSelection<PreparedOwner<DataT>>[],
    budget: number
  ) {
    const refinement = shadow ? this.state.shadowRefinement : this.state.refinement;
    const changed = refinement.reconcile(
      rows,
      owner => owner.asset.hierarchy.map(level => level.source.positions.length / 3),
      budget,
      owner => owner.key
    );
    if (changed)
      this.setState(
        shadow
          ? {shadowGroups: this.getRefinementGroups(refinement)}
          : {groups: this.getRefinementGroups(refinement)}
      );
    if (changed || refinement.active) this.setNeedsRedraw();
  }
  finalizeState() {
    this.state.runtime?.delete(this.id);
  }
  /** Current submitted work and minimum retained coverage, including optical transition overlap. */
  get splatStats(): SplatLayerStats {
    if (this.state.scene)
      return (
        this.getSubLayers()
          .find(layer => layer instanceof SplatSceneLayer)
          ?.state.runtime.getStats(`${this.id}-scene`) ?? {
          sourceCount: 0,
          visibleInstances: 0,
          shadowInstances: 0,
          renderedSplats: 0,
          shadowSplats: 0,
          coverageFloor: 0,
          shadowCoverageFloor: 0,
          refiningInstances: 0
        }
      );
    const count = (groups: Owner<DataT>[][]) =>
      groups.reduce(
        (sum, rows, i) => sum + rows.length * (this.state.hierarchy[i].source.positions.length / 3),
        0
      );
    const floor = (transition: SplatRefinementTransition<PreparedOwner<DataT>>) =>
      [...transition.entries.values()].reduce(
        (sum, entry) => sum + entry.owner.asset.hierarchy.at(-1)!.source.positions.length / 3,
        0
      );
    return {
      sourceCount: this.state.input.assets.length,
      visibleInstances: this.state.refinement.entries.size,
      shadowInstances: this.props.shadowEnabled ? this.state.shadowRefinement.entries.size : 0,
      renderedSplats: count(this.state.groups),
      shadowSplats: this.props.shadowEnabled ? count(this.state.shadowGroups) : 0,
      coverageFloor: floor(this.state.refinement),
      shadowCoverageFloor: this.props.shadowEnabled ? floor(this.state.shadowRefinement) : 0,
      refiningInstances: this.state.refinement.activeCount
    };
  }

  /** @internal Request a raster density and return the density covered by current visibility. */
  requestSplatRenderPixelRatio(pixelRatio: number): number {
    if (this.state.requestedRenderPixelRatio !== pixelRatio) {
      this.state.requestedRenderPixelRatio = pixelRatio;
      if (this.state.renderPixelRatio !== pixelRatio) this.setNeedsUpdate();
    }
    return (
      this.state.renderPixelRatio ?? this.context.device.canvasContext?.cssToDeviceRatio() ?? 1
    );
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
      getSplatProjectionKey(viewport) +
      ':' +
      this.props.kernelVariance +
      ':' +
      projections
        .map(projection => [
          ...projection.matrix,
          ...projection.center,
          projection.width,
          projection.height
        ])
        .join(',');
    if (key === this.state.shadowKey) return;
    this.state.shadowKey = key;

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
    const filterPadding = this.props.support * Math.sqrt(this.props.kernelVariance);
    const frusta = absoluteProjections.map(projection =>
      createSplatFrustum(projection, filterPadding)
    );
    const lightPixels = absoluteProjections.map(
      projection =>
        Math.max(
          Math.hypot(projection.matrix[0], projection.matrix[4], projection.matrix[8]) *
            projection.width,
          Math.hypot(projection.matrix[1], projection.matrix[5], projection.matrix[9]) *
            projection.height
        ) * 0.5
    );
    const candidates: SplatSelection<PreparedOwner<DataT>>[] = [];
    for (const owner of querySplatSpatialIndex(
      this.state.spatialIndex,
      absoluteProjections,
      filterPadding
    )) {
      let pixels = 0;
      for (let light = 0; light < frusta.length; light++)
        if (intersectsSplatFrustum(owner.center, owner.radius, frusta[light]))
          pixels = Math.max(
            pixels,
            lightPixels[light] *
              Math.max(...getSplatCommonUnits(owner.center, viewport)) *
              owner.scale
          );
      const hierarchy = owner.asset.hierarchy;
      let level = 0;
      for (let i = 1; i < hierarchy.length; i++)
        if (hierarchy[i].error * pixels <= this.props.pixelError) level = i;
      const next = level + 1;
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
        level,
        blend,
        retainedLevel: this.state.shadowRefinement.getLevel(owner.key)
      });
    }
    let sharedBudget = this.props.maxTotalSplats;
    for (let group = this.props._splatBudgetGroup; group; group = group.parent)
      sharedBudget = Math.min(sharedBudget, group.maxShadowSplats);
    // Light-space membership is published before the host's joint allocation.
    // Retain existing mixtures, but introduce new shadow demand at coverage;
    // otherwise the first light pass can submit every child's uncapped detail.
    const initialCandidates = Number.isFinite(sharedBudget)
      ? candidates.map(row => {
          const retained = this.state.shadowRefinement.entries.get(row.owner.key);
          return {
            ...row,
            level: retained?.level ?? row.owner.asset.hierarchy.length - 1,
            blend: retained?.blend ?? 0
          };
        })
      : candidates;
    const membershipChanged = this.state.shadowRefinement.reconcile(
      budgetSplatSelections(
        initialCandidates,
        owner => owner.asset.hierarchy,
        this.props.maxShadowSplats * 0.75
      ),
      owner => owner.asset.hierarchy.map(level => level.source.positions.length / 3),
      this.props.maxShadowSplats,
      owner => owner.key
    );
    this.state.shadowCandidates = candidates;
    this.publishDemand(true, candidates);
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
        if (row) groups[owner.offset + level].push(row);
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
    if (this.state.sceneProjectionError) return [];
    if (this.state.scene) {
      // Scene shaders output straight RGB/alpha; deck defaults to premultiplied RGB.
      // Preserve defaults and parent settings beneath per-key Composite child overrides.
      const parameters = {
        depthWriteEnabled: false,
        blendColorSrcFactor: 'src-alpha' as const,
        ...this.props.parameters,
        ...this.props._subLayerProps?.scene?.parameters
      };
      return [
        new SplatSceneLayer({
          ...this.props,
          ...this.getSubLayerProps({
            id: 'scene',
            updateTriggers: this.props.updateTriggers,
            parameters
          }),
          parameters,
          data: this.props.data,
          maxSplats: Number.isFinite(this.props.maxActiveSplats)
            ? this.props.maxActiveSplats
            : this.props.maxSplats,
          _resolvedAssets: this.state.rowSources,
          onStatusChange: this.props.onStatusChange
        })
      ];
    }
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
          ? accessor(row.object, {...info, index: row.index, data: this.state.input.data})
          : accessor;
      const wrappedTriggers = {...props.updateTriggers};
      for (const name of [
        'getPosition',
        'getScale',
        'getOrientation',
        'getTranslation',
        'getTransformMatrix',
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
        transparency: this.props.transparency === 'sorted' ? 'sorted' : 'weighted',
        data: members,
        updateTriggers: {
          ...wrappedTriggers,
          getCoverageWeight: [
            props.updateTriggers?.getCoverageWeight,
            typeof this.props.getCoverageWeight === 'function'
              ? null
              : this.props.getCoverageWeight,
            data
          ]
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
        getTransformMatrix: (row, info) => get(this.props.getTransformMatrix, row, info),
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
