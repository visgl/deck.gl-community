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
export type {RefinementStrategy, Tileset2DProps as Tile2DTilesetBaseProps} from './tileset-2d';
export {STRATEGY_DEFAULT, STRATEGY_NEVER, STRATEGY_REPLACE} from './tileset-2d';
export type {Tile2DTilesetProps} from './tileset-2d';
export {Tile2DTileset} from './tileset-2d';
export {Tile2DHeader2} from './tile-2d-header';
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
