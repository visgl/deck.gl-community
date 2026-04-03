// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type {
  TileLoadProps,
  Bounds,
  ZRange,
  GeoBoundingBox,
  NonGeoBoundingBox,
  TileBoundingBox
} from './types';
export type {RefinementStrategy, Tileset2DProps as SharedTileset2DBaseProps} from './tileset-2d';
export {STRATEGY_DEFAULT, STRATEGY_NEVER, STRATEGY_REPLACE} from './tileset-2d';
export type {SharedTileset2DProps} from './tileset-2d';
export {SharedTileset2D} from './tileset-2d';
export {SharedTile2DHeader} from './tile-2d-header';
export type {URLTemplate} from './utils';
export {
  getURLFromTemplate,
  getCullBounds,
  isGeoBoundingBox,
  isURLTemplate,
  getTileIndices,
  tileToBoundingBox,
  transformBox
} from './utils';
