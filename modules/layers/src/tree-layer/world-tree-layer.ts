// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  CompositeLayer,
  type DefaultProps,
  type Layer,
  type GetPickingInfoParams,
  type Accessor,
  type Color
} from '@deck.gl/core';
import {
  TileLayer,
  type TileLayerProps,
  type _TileLoadProps,
  type _Tileset2DProps,
  type _Tile2DHeader,
  type TileLayerPickingInfo
} from '@deck.gl/geo-layers';
import {retainSplatRows} from '../splat-layer/splat-row-diff';
import {SplatLayer} from '../splat-layer/splat-layer';
import {TREE_CLUSTER_SOURCE, TREE_CLUSTER_HIERARCHY} from './tree-canopy-clusters';
import {TreeLayer, type TreeLayerProps} from './tree-layer';
import {TreeTileset} from './tree-tileset';
import {TreeCoverageTransition} from './tree-coverage-transition';
import {TreeFrameBudget, TreeBudgetEffect} from './tree-frame-budget';
import {validateTreeTile, type TreeTileData, type TreeCanopyCluster} from './tree-tile-data';
export type {TreeTileData, TreeCanopyCluster} from './tree-tile-data';

/** Decoded residency and selected Gaussian work, independent of total source cardinality. */
export type TreeTileStats = {
  /** Decoded/request cache entries, including selected and fallback pages. */
  cachedTiles: number;
  /** Current geographic request frontier. */
  selectedTiles: number;
  /** Declared decoded bytes in the cache and retained transition history. */
  decodedBytes: number;
  /** Individual rows in resident pages; overlapping source levels may duplicate identities. */
  residentTrees: number;
  /** Deduplicated individual rows in the active visual batch. */
  visibleTrees: number;
  /** Source-built distant crown groups in the active visual batch. */
  distantCrowns: number;
  /** Pages whose optical replacement coverage is still moving. */
  transitioningPages: number;
  /** Camera-selected Gaussian submissions, including fading representations. */
  canopySplats: number;
  /** Prepared light-space Gaussian submissions; a host must draw its optical shadow pass. */
  shadowSplats: number;
  /** Coarsest visible representations exceed the current Gaussian quota. */
  coverageFloorExceeded: boolean;
  /** Selected work exceeds the current quota, including retained transitions. */
  budgetExceeded: boolean;
  /** Camera owners with an active optical detail transition. */
  refiningCrowns: number;
  /** Current fraction of Gaussian quotas selected by frame-time feedback. */
  budgetScale: number;
};
type WorldTreeProps<DataT> = {
  /** Abortable source adapter. Coarse tiles must contain summaries, not global inventories. */
  getTileData: (tile: _TileLoadProps) => TreeTileData<DataT> | Promise<TreeTileData<DataT>>;
  /** Optional seasonal tint of unresolved crown groups. Defaults to source tint. */
  getCanopyColor?: Accessor<TreeCanopyCluster, Color>;
  /** Wind bend fraction for unresolved crowns. Source templates and positions remain stable. @default 0 */
  canopyWindStrength?: number;
  /** Stable identity deduplicates the same tree across source levels during replacement. */
  getTreeKey?: (tree: DataT) => unknown;
  /** Milliseconds to blend loaded replacement coverage. Zero disables blending. @default 800 */
  transitionDuration?: number;
  /** Standard tree accessors, wind, season and material options, shared across loaded pages. */
  treeProps?: Omit<
    TreeLayerProps<DataT>,
    'data' | 'id' | 'maxCanopySplats' | 'maxShadowSplats' | 'maxCanopyPixels'
  >;
  /** Maximum requested frontier; overflow reduces geographic refinement without losing coverage. @default 32 */
  maxVisibleTiles?: number;
  /** Maximum individual rows plus distant crown groups in a decoded tile. @default 1024 */
  maxTileRecords?: number;
  /** Maximum decoded payload bytes in one tile. @default 1048576 */
  maxTileByteLength?: number;
  /** Target rendered-frame interval for automatic quality feedback. Zero disables feedback. @default 16.6667 */
  targetFrameTime?: number;
  /** Lowest fraction of Gaussian budgets feedback can select. Owners are never removed. @default 0.125 */
  minBudgetScale?: number;
  /** Maximum shared Gaussian accumulation pixels. Raster resolution stays fixed during geometry feedback. @default 4194304 */
  maxCanopyPixels?: number;
  /** One canopy budget for all visible tiles and species. @default 400000 */
  maxCanopySplats?: number;
  /** Independent light-map budget for all visible tiles. @default 50000 */
  maxShadowSplats?: number;
};
/** TileLayer's cache limits are eviction targets. Selected and fallback tiles are retained until replaced. */
export type WorldTreeLayerProps<DataT = unknown> = WorldTreeProps<DataT> &
  Omit<TileLayerProps<TreeTileData<DataT>>, 'getTileData' | 'renderSubLayers' | 'TilesetClass'>;

/** Stream geographically bounded inventories, then batch visible trees into shared species draws.
 * Total source cardinality is never materialized or iterated by this layer.
 */
export class WorldTreeLayer<DataT = unknown> extends TileLayer<
  TreeTileData<DataT>,
  WorldTreeProps<DataT>
> {
  static layerName = 'WorldTreeLayer';
  static defaultProps: DefaultProps = {
    ...TileLayer.defaultProps,
    TilesetClass: TreeTileset,
    treeProps: {type: 'object', value: {}},
    getCanopyColor: {type: 'accessor', value: (canopy: TreeCanopyCluster) => canopy.color},
    canopyWindStrength: {type: 'number', value: 0, min: 0, max: 0.2},
    maxVisibleTiles: 32,
    transitionDuration: 800,
    maxTileRecords: 1024,
    maxTileByteLength: 1048576,
    targetFrameTime: 1000 / 60,
    minBudgetScale: 0.125,
    maxCanopyPixels: 4194304,
    maxCanopySplats: 400000,
    maxShadowSplats: 50000,
    maxCacheSize: 64,
    maxCacheByteSize: 33554432,
    maxRequests: 4,
    debounceTime: 35,
    refinementStrategy: 'no-overlap',
    minZoom: 0,
    maxZoom: 20,
    zRange: [0, 100]
  };
  declare state: TileLayer<TreeTileData<DataT>>['state'] & {
    frameBudget: TreeFrameBudget;
    coverage: TreeCoverageTransition<TreeTileData<DataT>>;
    pageTiles: Map<TreeTileData<DataT>, _Tile2DHeader<TreeTileData<DataT>>>;
    treePages: Map<DataT, TreeTileData<DataT>[]>;
    canopyPages: Map<TreeCanopyCluster, TreeTileData<DataT>>;
    batch: {
      treeKey?: (tree: DataT) => unknown;
      treeKeyTrigger?: unknown;
      tiles: _Tile2DHeader<TreeTileData<DataT>>[];
      contents: TreeTileData<DataT>[];
      trees: DataT[];
      rowTiles: _Tile2DHeader<TreeTileData<DataT>>[];
      canopies: TreeCanopyCluster[];
    };
  };
  initializeState() {
    super.initializeState();
    this.state.frameBudget = new TreeFrameBudget();
    this.state.coverage = new TreeCoverageTransition();
    this.state.pageTiles = new Map();
    this.state.treePages = new Map();
    this.state.canopyPages = new Map();
    this.state.batch = {tiles: [], contents: [], trees: [], rowTiles: [], canopies: []};
    TreeBudgetEffect.get(this.context.deck);
  }
  get isLoaded(): boolean {
    if (!super.isLoaded || !this.state?.coverage || this.state.coverage.active) return false;
    const visible = (this.state.tileset?.tiles ?? []).filter(
      tile => tile.isVisible && tile.content
    );
    return (
      visible.length === this.state.batch.contents.length &&
      visible.every(tile => this.state.batch.contents.includes(tile.content!))
    );
  }
  /** Called by the shared Deck effect; budget updates preserve resident data and source templates. */
  updateFrameBudget(now: number) {
    if (this.state.coverage.sample(now, this.props.transitionDuration ?? 800))
      this.setNeedsUpdate();
    if (this.state.coverage.active) this.setNeedsRedraw();
    if (!this.state.batch.trees.length && !this.state.batch.canopies.length) return;
    if (
      this.state.frameBudget.sample(
        now,
        this.props.targetFrameTime ?? 1000 / 60,
        this.props.minBudgetScale ?? 0.125,
        this.state.coverage.active ||
          (this.props.canopyWindStrength ?? 0) > 0 ||
          (this.props.treeProps?.windStrength ?? 0) > 0
      )
    )
      this.setNeedsUpdate();
  }
  _getTilesetOptions(): _Tileset2DProps & {maxVisibleTiles: number} {
    const options = super._getTilesetOptions();
    return {...options, maxVisibleTiles: this.props.maxVisibleTiles ?? 32};
  }

  async getTileData(tile: _TileLoadProps): Promise<TreeTileData<DataT>> {
    const {maxTileRecords, maxTileByteLength} = this.props;
    const data = await super.getTileData(tile);
    if (tile.signal?.aborted) throw new DOMException('Tree tile request aborted', 'AbortError');
    return validateTreeTile(data!, maxTileRecords ?? 1024, maxTileByteLength ?? 1048576);
  }

  renderLayers(): Layer[] {
    const tiles = (this.state.tileset?.tiles ?? []).filter(
      tile => tile.isVisible && tile.content
    ) as _Tile2DHeader<TreeTileData<DataT>>[];
    const now = performance.now(),
      coverage = this.state.coverage;
    for (const tile of tiles) this.state.pageTiles.set(tile.content!, tile);
    coverage.reconcile(
      tiles.map(tile => tile.content!),
      now,
      this.props.transitionDuration ?? 800
    );
    coverage.trim(
      Math.max(tiles.length, (this.props.maxVisibleTiles ?? 32) * 2),
      tiles.map(tile => tile.content!)
    );
    const pages = [...coverage.entries.keys()];
    if (
      this.state.batch.treeKey !== this.props.getTreeKey ||
      this.state.batch.treeKeyTrigger !== this.props.updateTriggers?.getTreeKey ||
      pages.length !== this.state.batch.contents.length ||
      pages.some((page, index) => page !== this.state.batch.contents[index])
    ) {
      this.state.batch.treeKey = this.props.getTreeKey;
      this.state.batch.treeKeyTrigger = this.props.updateTriggers?.getTreeKey;
      this.state.batch.tiles = pages.map(page => this.state.pageTiles.get(page)!);
      this.state.batch.contents = pages;
      const previousTrees = this.state.batch.trees;
      const retainedTrees = new Map(
        this.state.batch.trees.map(row => [this.props.getTreeKey?.(row) ?? row, row])
      );
      this.state.batch.trees = [];
      this.state.batch.rowTiles = [];
      this.state.batch.canopies = [];
      this.state.treePages.clear();
      this.state.canopyPages.clear();
      const keys = new Map<unknown, DataT>();
      for (const page of pages) {
        const tile = this.state.pageTiles.get(page)!;
        for (const canopy of page.canopies) {
          this.state.batch.canopies.push(canopy);
          this.state.canopyPages.set(canopy, page);
        }
        for (const row of page.trees) {
          const key = this.props.getTreeKey?.(row) ?? row;
          const existing = keys.get(key);
          if (existing !== undefined) this.state.treePages.get(existing)!.push(page);
          else {
            const retained = retainedTrees.get(key);
            // getTreeKey promises matching identities have the same authored pose/traits.
            const canonical = retained ?? row;
            keys.set(key, canonical);
            this.state.batch.trees.push(canonical);
            this.state.batch.rowTiles.push(tile);
            this.state.treePages.set(canonical, [page]);
          }
        }
      }
      this.state.batch.trees = retainSplatRows(previousTrees, this.state.batch.trees);
      for (const page of this.state.pageTiles.keys())
        if (!coverage.entries.has(page)) this.state.pageTiles.delete(page);
    }
    if (coverage.active) this.setNeedsRedraw();
    const layers: Layer[] = [];
    const canopyBudget = Math.floor(
      (this.props.maxCanopySplats ?? 400000) * this.state.frameBudget.scale
    );
    const distantCost = Math.min(
      (this.state.batch.canopies.length * TREE_CLUSTER_SOURCE.positions.length) / 3,
      Math.floor(canopyBudget * 0.3)
    );
    const pixelBudget = Math.floor(
      Math.min(
        this.props.maxCanopyPixels ?? 4194304,
        this.context.device
          .canvasContext!.getDrawingBufferSize()
          .reduce((area, dimension) => area * dimension, 1)
      )
    );
    if (this.state.batch.canopies.length)
      layers.push(
        new SplatLayer<TreeCanopyCluster>({
          ...this.getSubLayerProps({id: 'distant-crowns'}),
          data: this.state.batch.canopies,
          source: TREE_CLUSTER_SOURCE,
          hierarchy: TREE_CLUSTER_HIERARCHY,
          pixelError: 2.5,
          foveationStrength: 1,
          getPosition: canopy => canopy.position,
          getScale: canopy => canopy.scale,
          getColor: this.props.getCanopyColor,
          getOrientation: canopy => [
            0,
            (canopy.position[0] * 73856093 + canopy.position[1] * 19349663) % 360,
            0
          ],
          deformationStrength: this.props.canopyWindStrength,
          deformationTime: this.props.treeProps?.windTime ?? null,
          getDeformation: canopy => [
            canopy.scale[2],
            canopy.position[0] * 781 + canopy.position[1] * 173,
            1
          ],
          updateTriggers: {
            getColor: this.props.updateTriggers?.getCanopyColor,
            getCoverageWeight: coverage.revision
          },
          getCoverageWeight: canopy =>
            coverage.entries.get(this.state.canopyPages.get(canopy)!)?.weight ?? 0,
          maxSplats: distantCost,
          maxRenderPixels: pixelBudget,
          shadowEnabled: false
        })
      );
    if (this.state.batch.trees.length)
      layers.push(
        new TreeLayer<DataT>({
          ...this.getSubLayerProps({id: 'trees'}),
          foveationStrength: 1,
          ...this.props.treeProps,
          data: this.state.batch.trees,
          getCoverageWeight: row =>
            Math.min(
              1,
              (this.state.treePages.get(row) ?? []).reduce(
                (weight, page) => weight + (coverage.entries.get(page)?.weight ?? 0),
                0
              )
            ),
          updateTriggers: {
            ...this.props.treeProps?.updateTriggers,
            getCoverageWeight: coverage.revision
          },
          maxCanopyPixels: pixelBudget,
          maxCanopySplats: Math.max(0, canopyBudget - distantCost),
          maxShadowSplats: Math.floor(
            (this.props.maxShadowSplats ?? 50000) * this.state.frameBudget.scale
          )
        })
      );
    return layers;
  }

  /** Inspect current cache and submitted work. Cache limits retain selected/fallback coverage until replacement. */
  get streamingStats(): TreeTileStats {
    const tiles = this.state.tileset?.tiles ?? [];
    const pages = [
      ...new Set([
        ...tiles.flatMap(tile => (tile.content ? [tile.content] : [])),
        ...this.state.coverage.entries.keys()
      ])
    ];
    const stats: TreeTileStats = {
      cachedTiles: tiles.length,
      selectedTiles: this.state.tileset?.selectedTiles?.length ?? 0,
      decodedBytes: pages.reduce((sum, page) => sum + page.byteLength, 0),
      residentTrees: pages.reduce((sum, page) => sum + page.trees.length, 0),
      visibleTrees: this.state.batch.trees.length,
      distantCrowns: this.state.batch.canopies.length,
      transitioningPages: [...this.state.coverage.entries.values()].filter(
        entry => entry.weight !== entry.target
      ).length,
      canopySplats: 0,
      shadowSplats: 0,
      budgetScale: this.state.frameBudget.scale,
      coverageFloorExceeded: false,
      budgetExceeded: false,
      refiningCrowns: 0
    };
    let canopyFloor = 0,
      shadowFloor = 0;
    const visit = (layer: Layer) => {
      if (layer instanceof SplatLayer) {
        const count = (layer.state.hierarchy.at(-1)?.source.positions.length ?? 0) / 3;
        canopyFloor += layer.state.refinement.entries.size * count;
        if (layer.props.shadowEnabled)
          shadowFloor += layer.state.shadowRefinement.entries.size * count;
        stats.refiningCrowns += layer.state.refinement.activeCount;
      }
      if (layer instanceof CompositeLayer) {
        layer.getSubLayers().forEach(visit);
        return;
      }
      if ((layer.constructor as {layerName?: string}).layerName !== 'SplatPrimitiveLayer') return;
      const props = layer.props as unknown as {source: {positions: Float32Array}};
      const count = (layer.getNumInstances() * props.source.positions.length) / 3;
      if (layer.props.operation.includes('draw')) stats.canopySplats += count;
      else stats.shadowSplats += count;
    };
    this.getSubLayers().forEach(visit);
    stats.coverageFloorExceeded =
      canopyFloor > (this.props.maxCanopySplats ?? Infinity) * stats.budgetScale ||
      shadowFloor > (this.props.maxShadowSplats ?? Infinity) * stats.budgetScale;
    stats.budgetExceeded =
      stats.canopySplats > (this.props.maxCanopySplats ?? Infinity) * stats.budgetScale ||
      stats.shadowSplats > (this.props.maxShadowSplats ?? Infinity) * stats.budgetScale;
    return stats;
  }

  // The merged children already contain only deck-selected visible/fallback tiles.
  filterSubLayer() {
    return true;
  }

  getPickingInfo(params: GetPickingInfoParams): TileLayerPickingInfo<TreeTileData<DataT>> {
    const info = params.info as TileLayerPickingInfo<TreeTileData<DataT>>;
    if (params.sourceLayer?.id.includes('-distant-crowns-')) return info;
    const tile = this.state.batch.rowTiles[info.index];
    if (tile) {
      info.tile = tile;
      info.sourceTile = tile;
      info.sourceTileSubLayer = params.sourceLayer!;
    }
    return info;
  }
}
