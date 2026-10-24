// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  CompositeLayer,
  type Accessor,
  type DefaultProps,
  createIterable,
  type LayerProps,
  type Layer,
  type PickingInfo,
  type Position,
  type UpdateParameters
} from '@deck.gl/core';
import {SplatEffect} from './splat-effect';
import {SplatPrimitiveLayer, type PreparedSplatProps} from './splat-primitive-layer';
import {
  getSplatBoundedPixelsPerMeter,
  getSplatCommonUnits,
  getSplatQueryViews,
  getSplatFocusWeight,
  getSplatProjectionKey,
  getSplatViewportLodWeight,
  getSplatCachedPosition,
  type SplatProjectedPosition
} from './splat-culling';
import {
  createSplatSpatialIndex,
  querySplatSpatialIndex,
  type SplatSpatialNode
} from './splat-spatial-index';
import {getSplatHorizon, getSplatTangentFrame, offsetSplatCommonPosition} from './splat-globe';
import type {SplatHierarchy} from './splat-hierarchy';
import {getSplatRadius, getSplatCenter} from './splat-source';
import {getSplatTransform, getSplatTransformScale} from './splat-transform';
import {getSplatDeformationRadius} from './splat-deformation';
import {budgetSplatSelections, getSplatLevelCounts, type SplatSelection} from './splat-budget';
import {SplatRefinementTransition} from './splat-refinement-transition';
import {retainSplatRows, getSplatChangedRanges, SplatRowSlots} from './splat-row-diff';
import {getSplatHighlightRow, updateSplatSourceHighlight} from './splat-source-highlight';
import {
  DEFAULT_GET_SOURCE,
  resolveSplatInput,
  type ResolvedSplatInput,
  type ResolvedSplatAsset,
  type SplatDataInput,
  type SplatInstance
} from './splat-input';
import {
  SETTLED_SPLAT_BUDGET_FRACTION,
  resolveSplatBudget,
  SplatRuntime,
  SplatSelectionEffect,
  type SplatBudgetGroup
} from './splat-runtime';
import type {SplatSource} from './splat-source';

const equalOwners = (a: Owner<unknown>, b: Owner<unknown>) =>
  a.object === b.object && a.index === b.index && a.weight === b.weight;
// Reuse the runtime demand until camera motion changes an LOD target or allocation priority meaningfully.
function retainSplatSelections<T>(
  previous: SplatSelection<T>[],
  next: SplatSelection<T>[]
): SplatSelection<T>[] {
  if (previous.length !== next.length) return next;
  for (let i = 0; i < next.length; i++) {
    const a = previous[i],
      b = next[i];
    if (
      a.owner !== b.owner ||
      a.level !== b.level ||
      Math.round(a.blend * 64) !== Math.round(b.blend * 64) ||
      Math.round(a.pixels * 4) !== Math.round(b.pixels * 4) ||
      Math.round((a.focus ?? 1) * 64) !== Math.round((b.focus ?? 1) * 64) ||
      a.retainedLevel !== b.retainedLevel
    )
      return next;
  }
  return previous;
}
/**
 * A child trigger that changes with the parent's trigger or a constant accessor value. deck.gl
 * compares the elements of an array trigger by identity, so a nested array from a composite parent
 * such as TreeLayer would read as changed on every render; flatten both, after the trigger length.
 */
function getWrappedTrigger(trigger: unknown, accessor: unknown): unknown[] {
  const elements = Array.isArray(trigger) ? trigger : [trigger];
  const constant =
    typeof accessor === 'function' ? [null] : Array.isArray(accessor) ? accessor : [accessor];
  return [elements.length, ...elements, ...constant];
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
  units: number[];
  scale: number;
  radius: number;
};
type _SplatLayerProps<DataT> = Omit<PreparedSplatProps<DataT>, 'data' | 'source'> & {
  /** One prepared asset, or application-owned instance rows. */
  data: DataT[] | SplatDataInput;
  /** Reusable asset per owner. Defaults to the row's splats field. */
  getSource?: Accessor<DataT, SplatDataInput>;
  /** Legacy constant-template input. Cannot be combined with explicit getSource. */
  source?: SplatSource;
  /** Weighted optical blending or globally depth-sorted prepared Gaussians. @default 'weighted' */
  transparency?: 'weighted' | 'sorted';
  /** Aggregate settled submission cap across visible SplatLayers on this deck/device. */
  maxTotalSplats?: number;
  /** @internal Shared cap inherited from a composing layer. */
  _splatBudgetGroup?: SplatBudgetGroup;
};

/** Properties for prepared assets and their original owner rows in map, globe and planar views. */
export type SplatLayerProps<DataT = SplatInstance> = _SplatLayerProps<DataT> & LayerProps;

/** Counts submitted Gaussians independently from the number of owning instances. */
export type SplatLayerStats = {
  /** Resolved immutable source and hierarchy pairs. */
  sourceCount: number;
  /** Owner instances in the current camera selection. */
  visibleInstances: number;
  /** Camera Gaussian submissions, including fading representations. */
  renderedSplats: number;
  /** Cost of the coarsest retained camera representation of every owner. */
  coverageFloor: number;
  /** Camera owners whose optical detail mixture is still moving. */
  refiningInstances: number;
};
const defaultProps: DefaultProps<SplatLayerProps> = {
  ...SplatPrimitiveLayer.defaultProps,
  // Asset URLs must not fall through the ordinary JSON data loader.
  data: {type: 'data', value: [], async: false},
  getSource: {type: 'accessor', value: DEFAULT_GET_SOURCE},
  transparency: 'weighted',
  maxTotalSplats: Infinity,
  _splatBudgetGroup: null
};

/** Prepared Gaussian templates with shared instances, spatial visibility and screen-error refinement. */
export class SplatLayer<DataT = SplatInstance> extends CompositeLayer<
  Required<_SplatLayerProps<DataT>>
> {
  static layerName = 'SplatLayer';
  static defaultProps = defaultProps;
  declare state: {
    groups: Owner<DataT>[][];
    members: Owner<DataT>[][];
    hierarchy: SplatHierarchy;
    input: ResolvedSplatInput<DataT>;
    candidates: SplatSelection<PreparedOwner<DataT>>[];
    runtime: SplatRuntime;
    renderPixelRatio?: number;
    requestedRenderPixelRatio?: number;
    owners: PreparedOwner<DataT>[];
    spatialIndex: SplatSpatialNode<PreparedOwner<DataT>> | null;
    projectionKey: string;
    projectedPositions: Map<string, SplatProjectedPosition>;
    refinement: SplatRefinementTransition<PreparedOwner<DataT>>;
    refinementRows: WeakMap<
      object,
      {owner: PreparedOwner<DataT>; revision: number; rows: (Owner<DataT> | undefined)[]}
    >;
    slots: SplatRowSlots<Owner<DataT>>[];
    coverage: {data: Owner<DataT>[]; ranges: {startRow: number; endRow: number}[]}[];
    awaitingInitialAllocation: boolean;
  };
  initializeState() {
    this.state = {
      groups: [],
      members: [],
      hierarchy: [],
      input: {data: [], assets: [], rowAssets: []},
      candidates: [],
      runtime: undefined!,
      owners: [],
      spatialIndex: null,
      projectionKey: '',
      projectedPositions: new Map(),
      refinement: new SplatRefinementTransition(),
      refinementRows: new WeakMap(),
      slots: [],
      coverage: [],
      awaitingInitialAllocation: false
    };
  }
  get isLoaded(): boolean {
    return super.isLoaded && !this.state.refinement.active;
  }
  shouldUpdateState({changeFlags}) {
    return (
      changeFlags.somethingChanged ||
      Boolean(
        this.state.runtime &&
          this.state.runtime !== SplatRuntime.get(this.context.deck, this.context.device)
      )
    );
  }

  updateState({changeFlags, props, oldProps}: UpdateParameters<this>) {
    // A repeated MapView selects owners in its primary frustum; SplatPrimitiveLayer composites
    // that copy alone, so wrapped world copies need no owner query of their own.
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
      props.kernelVariance !== oldProps.kernelVariance ||
      renderPixelRatio !== this.state.renderPixelRatio;
    if (
      !runtimeChanged &&
      !changeFlags.dataChanged &&
      !changeFlags.viewportChanged &&
      !geometryChanged &&
      !refinementChanged
    ) {
      this.publishDemand(this.state.candidates);
      return;
    }
    const inputChanged = Boolean(changeFlags.dataChanged || geometryChanged || runtimeChanged);
    const input = inputChanged ? resolveSplatInput(props) : this.state.input;
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
      Boolean(changeFlags.dataChanged || geometryChanged || runtimeChanged) ||
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
        // On the globe, owner metres point along the east-north-up frame at the anchor.
        const center = offsetSplatCommonPosition(
          common,
          localCenter,
          units,
          getSplatTangentFrame(common, viewport)
        );
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
          units: getSplatCommonUnits(center, viewport),
          scale: maximumScale,
          radius: radius * Math.max(...units)
        });
      }
      this.state.projectedPositions = next;
      spatialIndex = createSplatSpatialIndex(
        owners.map(owner => ({center: owner.center, radius: owner.radius, value: owner}))
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
    const pixelRatio = this.context.device.canvasContext?.cssToDeviceRatio() ?? 1;
    const candidates: SplatSelection<PreparedOwner<DataT>>[] = [];
    // Traverse persistent owner bounds. A camera move does not reread all accessors or rebuild the BVH.
    const filterPadding = (props.support * Math.sqrt(props.kernelVariance)) / renderPixelRatio;
    // Cached owner metre scales hold for every view sharing this projection, including the newer
    // camera deck.gl reports while a composite layer updates with its last drawn viewport.
    const ownerUnits = views.map(
      view => view === viewport || getSplatProjectionKey(view) === projectionKey
    );
    for (const owner of querySplatSpatialIndex(spatialIndex, projections, filterPadding)) {
      let metersToPixels = 0;
      let focus = 0;
      for (let i = 0; i < views.length; i++) {
        const view = views[i];
        const pixelsPerMeter = getSplatBoundedPixelsPerMeter(
          owner.center,
          owner.radius,
          view,
          ownerUnits[i] ? owner.units : undefined
        );
        const viewportWeight = getSplatViewportLodWeight(owner.center, owner.radius, view);
        metersToPixels = Math.max(metersToPixels, pixelsPerMeter * viewportWeight);
        if (viewportWeight > 0)
          focus = Math.max(
            focus,
            viewportWeight * getSplatFocusWeight(owner.center, view, props.foveationStrength)
          );
      }
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
        focus,
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
    if (changeFlags.dataChanged || geometryChanged || assetsChanged || rebuild) {
      this.state.slots = [];
    }
    let sharedBudget = props.maxTotalSplats;
    for (let group = props._splatBudgetGroup; group; group = group.parent)
      sharedBudget = Math.min(
        sharedBudget,
        resolveSplatBudget(group.maxSplats, this.context.device)
      );
    // Keep the local transition and the shared runtime on the same quantized demand. Otherwise a
    // sub-deadband camera move can retarget an optical fade locally before the runtime correctly
    // decides there is no meaningful allocation change.
    const demandCandidates = retainSplatSelections(this.state.candidates, candidates);
    // New registrations have not received their joint grant yet. Start from coverage,
    // including after source replacement, rather than uploading an unbounded first draw.
    const needsInitialCoverage =
      !this.state.refinement.entries.size && Number.isFinite(sharedBudget);
    const initialCandidates = needsInitialCoverage
      ? demandCandidates.map(row => ({
          ...row,
          level: row.owner.asset.hierarchy.length - 1,
          blend: 0
        }))
      : demandCandidates;
    // The shared runtime grants only changed demand. When quantized demand is retained, its last
    // budgeted grant still holds; a local unbudgeted retarget would refine every owner unseen.
    const demandRetained =
      demandCandidates === this.state.candidates &&
      props.maxSplats === oldProps.maxSplats &&
      !needsInitialCoverage;
    // Changed demand is granted jointly before this frame samples any fade. Locally, only admit
    // arriving and drop departed owners; the joint grant retargets the retained ones.
    const jointlyGranted = typeof this.context.deck._addDefaultEffect === 'function';
    const counts = (owner: PreparedOwner<DataT>) => getSplatLevelCounts(owner.asset.hierarchy);
    const membershipChanged =
      !demandRetained &&
      (jointlyGranted
        ? this.state.refinement.retain(initialCandidates, counts, owner => owner.key)
        : this.state.refinement.reconcile(
            budgetSplatSelections(
              initialCandidates,
              owner => owner.asset.hierarchy,
              props.maxSplats * SETTLED_SPLAT_BUDGET_FRACTION
            ),
            counts,
            props.maxSplats,
            owner => owner.key
          ));
    this.setState({
      groups:
        membershipChanged || changeFlags.dataChanged || geometryChanged || assetsChanged || rebuild
          ? this.getRefinementGroups(this.state.refinement)
          : this.state.groups,
      hierarchy,
      owners,
      candidates: demandCandidates,
      spatialIndex,
      projectionKey,
      awaitingInitialAllocation: this.state.awaitingInitialAllocation || needsInitialCoverage,
      ...(rebuild ? {members: [], coverage: []} : {})
    });
    this.publishDemand(demandCandidates);
  }

  private publishDemand(candidates: SplatSelection<PreparedOwner<DataT>>[]) {
    const runtime = this.state.runtime;
    if (!runtime) return;
    runtime.set(this.id, {
      rows: candidates,
      hierarchy: owner => owner.asset.hierarchy,
      maxSplats: this.props.maxSplats,
      maxTotalSplats: this.props.maxTotalSplats,
      group: this.props._splatBudgetGroup,
      tick: now => (this.getCurrentLayer() as this | null)?.updateRefinement(now),
      apply: (rows, budget) =>
        (this.getCurrentLayer() as this | null)?.applyAllocation(rows, budget)
    });
  }
  private applyAllocation(rows: SplatSelection<PreparedOwner<DataT>>[], budget: number) {
    const refinement = this.state.refinement;
    // A shared-cap registration has no existing presentation to preserve, so its first grant can
    // draw immediately. Every later allocation—also a broad wheel-zoom retarget—updates its
    // target now but retains the prior optical weights until the refinement fade completes.
    const immediate = this.state.awaitingInitialAllocation;
    const changed = refinement.reconcile(
      rows,
      owner => getSplatLevelCounts(owner.asset.hierarchy),
      budget,
      owner => owner.key,
      immediate
    );
    if (changed || immediate)
      this.setState({
        groups: this.getRefinementGroups(refinement),
        ...(immediate ? {awaitingInitialAllocation: false} : {})
      });
    if (changed || immediate || refinement.active) this.setNeedsRedraw();
  }
  finalizeState() {
    this.state.runtime?.delete(this.id);
  }
  /** Refinement levels hold different owner subsets; highlight the hovered owner in each. */
  protected _updateAutoHighlight(info: PickingInfo): void {
    updateSplatSourceHighlight(this, info);
  }
  /** Current submitted work and minimum retained coverage, including transition overlap. */
  get splatStats(): SplatLayerStats {
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
      renderedSplats: count(this.state.groups),
      coverageFloor: floor(this.state.refinement),
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

  /** Advance existing mixtures without reculling or rebuilding owner geometry. */
  updateRefinement(now: number) {
    if (this.state.refinement.sample(now))
      this.setState({groups: this.getRefinementGroups(this.state.refinement)});
    if (this.state.refinement.active) this.setNeedsRedraw();
  }
  private getRefinementGroups(transition: SplatRefinementTransition<PreparedOwner<DataT>>) {
    const groups = this.state.hierarchy.map(() => [] as Owner<DataT>[]);
    const keys = this.state.hierarchy.map(() => [] as number[]);
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
        if (row) {
          groups[owner.offset + level].push(row);
          keys[owner.offset + level].push(owner.row.index);
        }
      }
    }
    // Owners keep their instance slots, so edge membership changes upload only the slots they touch.
    const slots = this.state.slots;
    return groups.map((rows, level) => {
      slots[level] ||= new SplatRowSlots();
      return slots[level].update(rows, keys[level], equalOwners);
    });
  }

  renderLayers(): Layer[] {
    const makeLayer = (data: Owner<DataT>[], level: number) => {
      const memberGroups = this.state.members;
      // Coverage changes do not change ownership or transforms. Keep the data list stable
      // and invalidate only its coverage attribute instead of re-uploading every buffer.
      const members = retainSplatRows(
        memberGroups[level] ?? [],
        [...data],
        (a, b) => a.object === b.object && a.index === b.index
      );
      memberGroups[level] = members;
      // Weight-only changes keep members and rewrite only the coverage of the changed slots.
      const coverage = this.state.coverage;
      if (coverage[level]?.data !== data)
        coverage[level] = {data, ranges: getSplatChangedRanges(data, coverage[level]?.data)};

      const props = this.getSubLayerProps({
        id: `refinement-${level}`,
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
        wrappedTriggers[name] = getWrappedTrigger(props.updateTriggers?.[name], this.props[name]);
      return new SplatPrimitiveLayer<Owner<DataT>>({
        ...this.props,
        ...props,
        data: members,
        updateTriggers: {
          ...wrappedTriggers,
          getCoverageWeight: getWrappedTrigger(
            props.updateTriggers?.getCoverageWeight,
            this.props.getCoverageWeight
          )
        },
        _coverageRanges: coverage[level].ranges,
        _dataDiff: (next, previous) => {
          const ranges = getSplatChangedRanges(
            next as Owner<DataT>[],
            previous as Owner<DataT>[] | undefined
          );
          return ranges;
        },
        source: this.state.hierarchy[level].source,
        operation: 'draw',
        pickable: this.props.pickable,
        highlightedObjectIndex: getSplatHighlightRow(this, members),
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
    return this.state.groups.flatMap((data, level) =>
      data.length ? [makeLayer(data, level)] : []
    );
  }
}
