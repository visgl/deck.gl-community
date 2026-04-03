// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Viewport} from '@deck.gl/core';
import {Matrix4, equals, type NumericArray} from '@math.gl/core';

import {memoize} from '../utils/memoize';
import {getCullBounds, transformBox} from './utils';
import {STRATEGY_DEFAULT, STRATEGY_NEVER, STRATEGY_REPLACE} from './tileset-2d';
import type {Tile2DTileset} from './tileset-2d';
import {Tile2DHeader2} from './tile-2d-header';

/** Bit flag marking a tile as visited during refinement traversal. */
const TILE_STATE_VISITED = 1;
/** Bit flag marking a tile as visible during refinement traversal. */
const TILE_STATE_VISIBLE = 2;

/** Built-in placeholder refinement handlers keyed by strategy name. */
const STRATEGIES = {
  [STRATEGY_DEFAULT]: updateTileStateDefault,
  [STRATEGY_REPLACE]: updateTileStateReplace,
  [STRATEGY_NEVER]: () => {}
};

/** View-specific visibility state cached per tile. */
type TileViewState = {
  /** Whether the tile was selected directly for the current viewport. */
  isSelected: boolean;
  /** Whether the tile should render in this viewport after refinement. */
  isVisible: boolean;
  /** Bit field used by refinement helpers while traversing ancestors and children. */
  state: number;
};

/** Per-viewport traversal state for a shared {@link Tile2DTileset}. */
export class Tile2DView<DataT = any> {
  /** Unique consumer identifier used by the shared tileset cache. */
  readonly id = Symbol('tile-2d-view');

  /** Shared tileset queried by this view. */
  private _tileset: Tile2DTileset<DataT>;
  /** Tiles selected during the latest traversal. */
  private _selectedTiles: Tile2DHeader2<DataT>[] | null = null;
  /** Incremented whenever this view's visible tile set changes. */
  private _frameNumber = 0;
  /** Last viewport used to compute tile selection. */
  private _viewport: Viewport | null = null;
  /** Last z-range used during tile selection. */
  private _zRange: [number, number] | null = null;
  /** Last model matrix applied to tile selection. */
  private _modelMatrix = new Matrix4();
  /** Inverse of the current model matrix. */
  private _modelMatrixInverse = new Matrix4();
  /** Per-tile visibility and selection flags for this view. */
  private _state = new Map<Tile2DHeader2<DataT>, TileViewState>();

  /** Creates a viewport-specific view of a shared tileset. */
  constructor(tileset: Tile2DTileset<DataT>) {
    this._tileset = tileset;
    this._tileset.attachConsumer(this.id);
  }

  /** Releases this view and detaches it from the shared tileset. */
  finalize(): void {
    this._tileset.detachConsumer(this.id);
    this._selectedTiles = null;
    this._state.clear();
  }

  /** Tiles selected for the last viewport update. */
  get selectedTiles(): Tile2DHeader2<DataT>[] | null {
    return this._selectedTiles;
  }

  /** Indicates whether all selected tiles are fully loaded for this view. */
  get isLoaded(): boolean {
    return this._selectedTiles !== null && this._selectedTiles.every(tile => tile.isLoaded);
  }

  /** Indicates whether any selected tile needs to be re-requested. */
  get needsReload(): boolean {
    return this._selectedTiles !== null && this._selectedTiles.some(tile => tile.needsReload);
  }

  /** Updates tile selection and visibility for a viewport and returns the current frame number. */
  update(
    viewport: Viewport,
    {
      zRange,
      modelMatrix
    }: {
      zRange: [number, number] | null;
      modelMatrix: NumericArray | null;
    } = {zRange: null, modelMatrix: null}
  ): number {
    const modelMatrixAsMatrix4 = modelMatrix ? new Matrix4(modelMatrix) : new Matrix4();
    const isModelMatrixNew = !modelMatrixAsMatrix4.equals(this._modelMatrix);

    if (
      !this._viewport ||
      !viewport.equals(this._viewport) ||
      !equals(this._zRange, zRange) ||
      isModelMatrixNew
    ) {
      if (isModelMatrixNew) {
        this._modelMatrixInverse = modelMatrixAsMatrix4.clone().invert();
        this._modelMatrix = modelMatrixAsMatrix4;
      }
      this._viewport = viewport;
      this._zRange = zRange;
      const tileIndices = this._tileset.getTileIndices({
        viewport,
        maxZoom: this._tileset.maxZoom,
        minZoom: this._tileset.minZoom,
        zRange,
        modelMatrix: this._modelMatrix,
        modelMatrixInverse: this._modelMatrixInverse
      });
      this._selectedTiles = tileIndices.map(index => this._tileset.getTile(index, true));
      this._tileset.prepareTiles();
    } else if (this.needsReload) {
      this._selectedTiles = (this._selectedTiles || []).map(tile => this._tileset.getTile(tile.index, true));
      this._tileset.prepareTiles();
    }

    const changed = this._updateTileStates();
    this._tileset.updateConsumer(this.id, this._selectedTiles || [], this._getVisibleTiles());

    if (changed) {
      this._frameNumber++;
    }
    return this._frameNumber;
  }

  /** Tests whether a tile should render in the current viewport and culling rectangle. */
  isTileVisible(
    tile: Tile2DHeader2<DataT>,
    cullRect?: {x: number; y: number; width: number; height: number},
    modelMatrix?: Matrix4 | null
  ): boolean {
    const state = this._state.get(tile);
    if (!state?.isVisible) {
      return false;
    }

    if (!cullRect || !this._viewport) {
      return true;
    }
    const boundsArr = this._getCullBounds({
      viewport: this._viewport,
      z: this._zRange,
      cullRect
    });
    return boundsArr.some(bounds => this._tileOverlapsBounds(tile, bounds, modelMatrix));
  }

  /** Collects tiles currently marked visible for this view. */
  private _getVisibleTiles(): Tile2DHeader2<DataT>[] {
    const result: Tile2DHeader2<DataT>[] = [];
    for (const tile of this._tileset.tiles) {
      if (this._state.get(tile)?.isVisible) {
        result.push(tile);
      }
    }
    return result;
  }

  /** Memoized screen-space culling bounds helper. */
  private _getCullBounds = memoize(getCullBounds);

  /** Recomputes selected and placeholder-visible tiles for the current view. */
  private _updateTileStates(): boolean {
    const refinementStrategy = this._tileset.refinementStrategy || STRATEGY_DEFAULT;
    const allTiles = this._tileset.tiles;
    const previousVisibility = new Map<Tile2DHeader2<DataT>, boolean>();

    for (const tile of allTiles) {
      const existing = this._state.get(tile);
      previousVisibility.set(tile, existing?.isVisible || false);
      this._state.set(tile, {isSelected: false, isVisible: false, state: 0});
    }

    for (const tile of this._selectedTiles || []) {
      const state = this._state.get(tile) || {isSelected: false, isVisible: false, state: 0};
      state.isSelected = true;
      state.isVisible = true;
      this._state.set(tile, state);
    }

    if (typeof refinementStrategy === 'function') {
      refinementStrategy(allTiles);
    } else {
      STRATEGIES[refinementStrategy](allTiles, this._state);
    }

    let changed = false;
    for (const tile of allTiles) {
      const state = this._state.get(tile);
      if (state && state.isVisible !== previousVisibility.get(tile)) {
        changed = true;
      }
    }
    return changed;
  }

  /** Tests one tile against one culling bounds rectangle. */
  private _tileOverlapsBounds(
    tile: Tile2DHeader2<DataT>,
    [minX, minY, maxX, maxY]: [number, number, number, number],
    modelMatrix?: Matrix4 | null
  ): boolean {
    const bbox = this._getTileBoundingBox(tile, modelMatrix);
    if ('west' in bbox) {
      return bbox.west < maxX && bbox.east > minX && bbox.south < maxY && bbox.north > minY;
    }
    const y0 = Math.min(bbox.top, bbox.bottom);
    const y1 = Math.max(bbox.top, bbox.bottom);
    return bbox.left < maxX && bbox.right > minX && y0 < maxY && y1 > minY;
  }

  /** Applies model-matrix transforms to non-geospatial tile bounds when needed. */
  private _getTileBoundingBox(tile: Tile2DHeader2<DataT>, modelMatrix?: Matrix4 | null) {
    const {bbox} = tile;
    if ('west' in bbox || !modelMatrix || Matrix4.IDENTITY.equals(modelMatrix)) {
      return bbox;
    }
    const [left, top, right, bottom] = transformBox(
      [bbox.left, bbox.top, bbox.right, bbox.bottom],
      modelMatrix
    );
    return {left, top, right, bottom};
  }
}

/** Default refinement strategy that prefers best available loaded descendants. */
function updateTileStateDefault(allTiles: Tile2DHeader2[], stateMap: Map<Tile2DHeader2, TileViewState>) {
  for (const tile of allTiles) {
    getTileState(stateMap, tile).state = 0;
  }
  for (const tile of allTiles) {
    if (getTileState(stateMap, tile).isSelected && !getPlaceholderInAncestors(tile, stateMap)) {
      getPlaceholderInChildren(tile, stateMap);
    }
  }
  for (const tile of allTiles) {
    const state = getTileState(stateMap, tile);
    state.isVisible = Boolean(state.state & TILE_STATE_VISIBLE);
  }
}

/** Replacement refinement strategy that avoids visible overlap between ancestors and descendants. */
function updateTileStateReplace(allTiles: Tile2DHeader2[], stateMap: Map<Tile2DHeader2, TileViewState>) {
  for (const tile of allTiles) {
    getTileState(stateMap, tile).state = 0;
  }
  for (const tile of allTiles) {
    if (getTileState(stateMap, tile).isSelected) {
      getPlaceholderInAncestors(tile, stateMap);
    }
  }
  const sortedTiles = Array.from(allTiles).sort((t1, t2) => t1.zoom - t2.zoom);
  for (const tile of sortedTiles) {
    const tileState = getTileState(stateMap, tile);
    tileState.isVisible = Boolean(tileState.state & TILE_STATE_VISIBLE);

    if (tile.children && (tileState.isVisible || tileState.state & TILE_STATE_VISITED)) {
      for (const child of tile.children) {
        getTileState(stateMap, child).state = TILE_STATE_VISITED;
      }
    } else if (tileState.isSelected) {
      getPlaceholderInChildren(tile, stateMap);
    }
  }
}

/** Searches upward for a loaded ancestor that can stand in for an unavailable selected tile. */
function getPlaceholderInAncestors(
  startTile: Tile2DHeader2,
  stateMap: Map<Tile2DHeader2, TileViewState>
) {
  let tile: Tile2DHeader2 | null = startTile;
  while (tile) {
    if (tile.isLoaded || tile.content) {
      getTileState(stateMap, tile).state |= TILE_STATE_VISIBLE;
      return true;
    }
    tile = tile.parent;
  }
  return false;
}

/** Searches downward for loaded descendants that can stand in for an unavailable selected tile. */
function getPlaceholderInChildren(tile: Tile2DHeader2, stateMap: Map<Tile2DHeader2, TileViewState>) {
  for (const child of tile.children || []) {
    if (child.isLoaded || child.content) {
      getTileState(stateMap, child).state |= TILE_STATE_VISIBLE;
    } else {
      getPlaceholderInChildren(child, stateMap);
    }
  }
}

function getTileState(
  stateMap: Map<Tile2DHeader2, TileViewState>,
  tile: Tile2DHeader2
): TileViewState {
  const state = stateMap.get(tile);
  if (!state) {
    throw new Error(`Missing tile state for ${tile.id}`);
  }
  return state;
}
