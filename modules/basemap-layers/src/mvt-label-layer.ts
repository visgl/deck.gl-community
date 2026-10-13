import {CompositeLayer} from '@deck.gl/core';
import type {DefaultProps, Layer, LayerContext, UpdateParameters} from '@deck.gl/core';
import {LabelCollisionFilterExtension} from './collision-extension';
import {GeoJsonLayer, IconLayer, _TextBackgroundLayer} from '@deck.gl/layers';
import {LabelTextLayer} from './label-text-layer';
import type {LabelTextJustify} from './label-text-layer';
import {SharedTextureSet} from './shared-texture';
import {getZoomBucket, withOpacity} from './style-accessor';
import {
  getCompiledStyleProperty,
  getStylePropertyDefault,
  type CompiledStyleProperty
} from './style-expression';
import {getSpriteImageNames, resolveSpriteIcon, warnMissingIcon} from './sprite';
import type {ResolvedSpriteIcon, SpriteAtlas} from './sprite';
import {GlobeHorizonExtension} from './globe-horizon-extension';
import {DEFAULT_TEXT_FONT, getTextLayerFontWeight, resolveLabelFont} from './text-font';
import {getHaloBlurGamma, TextHaloBlurExtension} from './text-halo-blur-extension';
import {
  allowsLetterSpacing,
  canMeasureText,
  forgetCharacterWidths,
  getCharacterWidthMeasurer,
  transformText,
  wrapText
} from './text-layout';
import type {WrapBudget} from './text-layout';
import {
  DEFAULT_POLE_SEARCH_SEGMENT_TESTS,
  getPoleOfInaccessibility,
  type PoleSearchBudget
} from './polylabel';
import type {LabelFont, LabelFontFamily} from './text-font';
import {getSymbolCollision} from './symbol-collision';
import type {SymbolPartCollision} from './symbol-collision';
import {
  DEFAULT_LINE_ANCHOR_STEPS,
  clipLine,
  getLineAnchors,
  getUprightAngle,
  mergeLines,
  type LineAnchorBudget
} from './line-placement';

type GeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | string;

type FeatureGeometry = {
  type: GeometryType;
  coordinates: any;
};

type FeatureLike = {
  geometry: FeatureGeometry;
  properties?: Record<string, any>;
};

type LabelRow = {
  position: number[];
  /** For labels along a line: the line's direction, in degrees counter-clockwise from east. */
  angle?: number;
};

type StyleLayerLike = {
  layout?: Record<string, any>;
  paint?: Record<string, any>;
};

type LabelConfig = {
  labels?: boolean;
};

/**
 * Props accepted by {@link MVTLabelLayer}.
 */
export type MVTLabelLayerProps = {
  /** Decoded vector-tile features or a feature-collection-like object. */
  data?: {features?: FeatureLike[]} | FeatureLike[];
  /** Label rendering enablement for the current basemap mode. */
  config: LabelConfig;
  /** Style layer that contributes label rules. */
  styleLayer?: StyleLayerLike;
  /** Zoom level used to evaluate style expressions. */
  zoom?: number;
  /** Text fill color. */
  textColor?: number[];
  /**
   * `[min, max)` collision priorities this layer's labels are mapped into. `BasemapLayer` gives
   * each symbol style layer its own band, so style order decides between layers. Default: deck.gl's
   * full range, -1000 to 1000.
   */
  collisionPriorityRange?: [number, number];
  /** Text size units forwarded to `TextLayer`. */
  labelSizeUnits?: 'pixels' | 'meters' | 'common';
  /**
   * Overrides the font derived from the style layer's `text-font`: a CSS family list, or a
   * function from the `text-font` names to a family list or {@link LabelFont} fields.
   */
  fontFamily?: LabelFontFamily | null;
  /** Enables billboard rendering in the text sublayer. */
  billboard?: boolean;
  /** When `true`, renders the source geometries for debugging. */
  renderGeometry?: boolean;
  /** Additional extension instances passed through to the text sublayer. */
  extensions?: any[];
  /** Active basemap mode. */
  mode?: 'map' | 'globe';
  /**
   * Sprites loaded for the style; `icon-image` names resolve against them. `null` while they are
   * loading: no icons are drawn, and text is placed as if each symbol had its icon, so labels do
   * not change placement rules when the sprites arrive.
   */
  spriteAtlases?: SpriteAtlas[] | null;
  /** Load options for the sprite atlas images, so they use the same fetch as the style. */
  iconLoadOptions?: Record<string, unknown> | null;
  /**
   * The tile's own bounding box, as deck.gl's `TileLayer` reports it. In longitude/latitude (globe
   * tiles), polygon labels outside it are dropped, so a polygon in two tiles' buffers is labelled
   * by one tile. Tile-local coordinates always use the tile's `[0, 1)` square.
   */
  tileBoundingBox?: {west: number; south: number; east: number; north: number} | null;
  /** The tile's zoom level, at which labels along lines are spaced. Default: the integer `zoom`. */
  tileZoom?: number | null;
  /** The tile's size in pixels at its own zoom. Default: 512. */
  tileSize?: number | null;
  /**
   * The label features of several tiles, labelled together in one layer instead of `data`: each
   * tile's anchors are placed as for a layer of its own (`tileBoundingBox`, `tileZoom` and
   * `tileSize` per tile), then drawn in longitude/latitude. Pass the same array while the tiles do
   * not change; a tile keeps its anchors while its features, and the inputs they depend on, do not
   * change. See {@link LabelTile}.
   */
  tiles?: LabelTile[] | null;
};

/** The label features of one tile, for {@link MVTLabelLayerProps.tiles}. */
export type LabelTile = {
  /** The tile's index, which places tile-local coordinates in the world. */
  index: {x: number; y: number; z: number};
  /** The tile's features of the style layer. */
  features: FeatureLike[];
  tileBoundingBox?: {
    west: number;
    south: number;
    east: number;
    north: number;
  } | null;
  tileZoom?: number | null;
  tileSize?: number | null;
  /** Returned as `info.tile` when a label of the tile is picked. */
  tile?: unknown;
};

/** The anchors of one tile of a {@link MVTLabelLayerProps.tiles} layer. */
type TileRows = {
  features: FeatureLike[];
  anchorKey: string;
  /** The tile the rows report when picked (see `LabelTile.tile`). */
  tile: unknown;
  rows: LabelRow[];
};

/** The tile-local `[0, 1)` square, as `ClipExtension` clips tile sublayers to it by anchor. */
const TILE_SQUARE = [0, 0, 1, 1];

/** `tileKey` of an index. */
function getTileKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * The rows of every tile of `tiles`, from `tileRows`, without those of a tile whose anchor lies in
 * a deeper tile of the set: while a tile's children load, the tile is drawn in their place, and
 * where a child has loaded, the child's labels replace the parent's. `geographic` says whether the
 * rows are in longitude/latitude; otherwise they are already converted, see `getTileRowsInWorld`.
 */
export function combineTileRows(tiles: LabelTile[], tileRows: LabelRow[][]): LabelRow[] {
  const keys = new Set(tiles.map(({index: {x, y, z}}) => getTileKey(x, y, z)));
  const maxZ = Math.max(...tiles.map(tile => tile.index.z));
  const combined: LabelRow[] = [];
  tiles.forEach((tile, tileIndex) => {
    const rows = tileRows[tileIndex];
    const {z} = tile.index;
    if (z >= maxZ) {
      combined.push(...rows);
      return;
    }
    for (const row of rows) {
      // Tile-local anchors keep their exact world position: one converted to longitude/latitude
      // and back can land on the wrong side of a tile edge.
      const [wx, wy] = (row as {world?: number[]}).world ?? lngLatToWorld(row.position);
      let covered = false;
      for (let childZ = z + 1; childZ <= maxZ && !covered; childZ++) {
        const scale = 2 ** childZ;
        covered = keys.has(getTileKey(Math.floor(wx * scale), Math.floor(wy * scale), childZ));
      }
      if (!covered) {
        combined.push(row);
      }
    }
  });
  return combined;
}

/**
 * Pixels around a label's anchor that the collision filter samples: deck.gl's
 * `CollisionFilterExtension` tests a 5x5 pixel area. Two more pixels absorb rasterization at the
 * box edge; with only one, a `top`-aligned label still misses a row of the samples and fades.
 */
const COLLISION_SAMPLE_RADIUS = 4;

/**
 * Draw parameters of the text, icon and anchor mark sublayers. Labels draw over the map without a depth test.
 * Their screen-space quads wind clockwise, so `GlobeView`'s default `cullMode: 'back'` would cull
 * every one of them; they are drawn with culling off, in every view.
 */
const LABEL_PARAMETERS = {depthTest: false, cullMode: 'none'} as const;

/** Collision group shared by every label and icon, so all symbols collide with each other. */
const LABEL_COLLISION_GROUP = 'basemap-labels';

/**
 * Collision priority of the rows that a sublayer holds but does not place: rows it does not draw,
 * and every row of a halo sublayer, which another sublayer places. `CollisionFilterExtension` maps
 * priorities from -1000 to 1000 onto the collision pass's depth range, so a row below it is clipped
 * there and leaves no mark in the collision map, while the draw pass still filters it.
 */
const MASKED_COLLISION_PRIORITY = -2000;

/**
 * Without a depth test, labels on the far side of a globe would draw through it. This extension
 * hides those whose anchor is beyond the horizon, and keeps them out of the collision pass.
 */
const GLOBE_HORIZON_EXTENSION = new GlobeHorizonExtension();

/** `text-anchor` / `icon-anchor` as a horizontal and vertical fraction from the center. */
const ANCHOR_FRACTIONS: Record<string, [number, number]> = {
  center: [0, 0],
  left: [-0.5, 0],
  right: [0.5, 0],
  top: [0, -0.5],
  bottom: [0, 0.5],
  'top-left': [-0.5, -0.5],
  'top-right': [0.5, -0.5],
  'bottom-left': [-0.5, 0.5],
  'bottom-right': [0.5, 0.5]
};

/** `text-anchor` as deck.gl `TextLayer` text anchor and alignment baseline. */
function getTextAnchorProps(anchor: unknown): {
  textAnchor: 'start' | 'middle' | 'end';
  alignmentBaseline: 'top' | 'center' | 'bottom';
} {
  const [x, y] = ANCHOR_FRACTIONS[String(anchor)] || ANCHOR_FRACTIONS.center;
  return {
    textAnchor: x < 0 ? 'start' : x > 0 ? 'end' : 'middle',
    alignmentBaseline: y < 0 ? 'top' : y > 0 ? 'bottom' : 'center'
  };
}

type MVTLabelLayerState = {
  /** Flattened label rows generated from the current tile data. */
  labelData?: LabelRow[];
  /**
   * `labelData` in reverse, the order every text, icon and anchor sublayer holds it in (see
   * `getRows`). In the collision pass, of labels with equal priority the one drawn last takes the
   * place; drawn in reverse, the first label wins, as in MapLibre.
   */
  textRows?: {source: LabelRow[]; rows: LabelRow[]};
  /** The non-data inputs `labelData` was computed with; a change recomputes it. */
  anchorKey?: string;
  /** The map bearing, in `BEARING_STEP` steps, that upright line labels were turned for. */
  bearingStep?: number;
  /** The CSS font of labels along lines last seen loading; see `isLineTextFontLoading`. */
  loadingFont?: string;
  /** The halos of the label rows: one entry per distinct halo, and each row's entry index. */
  halos?: LabelHalos;
  /** The `labelData` and style inputs `halos` was computed with; a change recomputes it. */
  haloKey?: [LabelRow[] | undefined, string];
  /**
   * Label text for the current text update trigger and label rows, per feature, and the wrap
   * budget left for them. deck.gl reads each label's text several times per update; the cache
   * keeps every read the same once the budget runs out, and wraps each label once.
   */
  labelText?: {
    /** The text trigger, the rows and the font the text was wrapped for. */
    key: [string, LabelRow[] | undefined, string];
    budget: WrapBudget;
    labels: WeakMap<FeatureLike, string | undefined>;
    /** Per label row, whether it has text (see `getRowsWithText`). */
    rowsWithText?: boolean[];
  };
  /** The sprite textures of the icon layers, shared with other label layers. */
  iconTextures?: SharedTextureSet;
  /** In a `tiles` layer: each tile's anchors, by tile index, and the tiles they were combined for. */
  tileRows?: Map<string, TileRows>;
  rowTiles?: LabelTile[];
};

/** A label halo as deck.gl `TextLayer` draws it: an SDF outline color, width and blur. */
export type LabelHalo = {
  /** Halo color, RGBA with alpha in 0-255. */
  outlineColor: number[];
  /** `TextLayer` `outlineWidth` (see {@link getOutlineWidth}). */
  outlineWidth: number;
  /** `TextHaloBlurExtension` `textHaloBlurGamma` (see {@link getHaloBlurGamma}). */
  outlineBlur: number;
};

type LabelHalos = {
  /** Distinct halos, `null` for labels without one. */
  halos: (LabelHalo | null)[];
  /** For each label row, its index in `halos`. */
  rowHalos: number[];
};

/**
 * Font atlas settings for label text. Glyphs are drawn as signed distance fields, so `TextLayer`
 * can outline them for `text-halo-*`. The distance field reaches as far as the widest halo:
 * MapLibre caps `text-halo-width` at a quarter of the text size, 16 pixels of a 64-pixel glyph.
 * `TextLayer` outlines no further out than `(0.75 - smoothing) * radius` pixels, 15.6 here, and
 * its halo edge fades over another `smoothing * radius` pixels, which the `buffer` keeps.
 * `TextLayer` draws the glyph edge at a fixed distance value, so a `cutoff` below the default 0.25
 * moves the drawn edge `(0.25 - cutoff) * radius` pixels outward, and the halo with it. At 0.24,
 * small text matches the stroke weight of a plain bitmap atlas more closely.
 */
const LABEL_FONT_SETTINGS = {
  sdf: true,
  fontSize: 64,
  buffer: 18,
  radius: 24,
  cutoff: 0.24,
  smoothing: 0.1
};

/** Shared by every text sublayer, so deck.gl does not see their extensions change. */
const TEXT_HALO_BLUR_EXTENSION = new TextHaloBlurExtension();

/**
 * Most halos one label layer draws, each with its own text sublayer. Labels without a halo get
 * one more sublayer, and with more than one sublayer, another places the labels. Each sublayer
 * holds every label row (see `renderLayers`), so the cap bounds the work per tile when every
 * feature has its own halo.
 */
export const MAX_HALO_SUBLAYERS = 8;

/** `text-halo-width` is rounded to this step, in pixels, so that close widths share a sublayer. */
const HALO_WIDTH_STEP = 0.25;

/**
 * `TextLayer` draws an outline of width `w` at `0.75 * w` atlas pixels outside the drawn glyph
 * edge, whatever the `cutoff`.
 */
const SDF_OUTLINE_SCALE = 0.75;

/**
 * Converts a `text-halo-width`, in pixels, to `TextLayer`'s `outlineWidth` for text of `textSize`
 * pixels. An atlas pixel is `textSize / fontSize` screen pixels, so the same halo needs a wider
 * outline on smaller text. As in MapLibre, the halo is at most a quarter of the text size.
 */
export function getOutlineWidth(haloWidth: number, textSize: number): number {
  const atlasPixels = (Math.min(haloWidth, textSize / 4) * LABEL_FONT_SETTINGS.fontSize) / textSize;
  // Rounded so that labels whose halos differ imperceptibly share one text sublayer.
  return Math.round((atlasPixels / SDF_OUTLINE_SCALE) * 100) / 100;
}

/**
 * Bearing step, in degrees, at which labels along lines are re-checked for `text-keep-upright`
 * while the map rotates. A label may read upside down by up to this much before it turns.
 */
const BEARING_STEP = 5;

/**
 * Average glyph advance, in ems, used to estimate a label's length when placing it along a line
 * where the text cannot be measured: without a canvas, or while the label font loads.
 */
const LINE_LABEL_EM_PER_CHARACTER = 0.6;

/** Advance, in ems, of a wide character (CJK, Hangul, fullwidth forms), which is about square. */
const LINE_LABEL_EM_PER_WIDE_CHARACTER = 1;

/** Code point ranges of wide characters: East Asian scripts and fullwidth forms. */
const WIDE_CHARACTER_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x20000, 0x3fffd]
];

/** The estimated length of `text` in ems: about square for wide characters, narrower for others. */
export function getTextLengthEms(text: string): number {
  let ems = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    const wide = WIDE_CHARACTER_RANGES.some(([start, end]) => code >= start && code <= end);
    ems += wide ? LINE_LABEL_EM_PER_WIDE_CHARACTER : LINE_LABEL_EM_PER_CHARACTER;
  }
  return ems;
}

/**
 * Turns `offset`, `[x, y]` in pixels with y pointing down, by `angle` degrees counter-clockwise,
 * as deck.gl's `IconLayer` turns an icon by its `getAngle`.
 */
export function rotatePixelOffset([x, y]: number[], angle: number): [number, number] {
  if (!angle) {
    return [x, y];
  }
  const radians = (angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)];
  return [cos * x + sin * y, cos * y - sin * x];
}

/**
 * `getPixelOffset` for icons turned by `getAngle`. `IconLayer` turns an icon about its center and
 * then adds its pixel offset; MapLibre turns the whole icon, `icon-anchor` and `icon-offset`
 * included, about the anchor point. Turning the offset by the icon's angle does the same.
 */
function withIconAngle(
  getPixelOffset: (row: LabelRow, info: {index: number}) => [number, number],
  getAngle: ((row: LabelRow) => number) | null
): (row: LabelRow, info: {index: number}) => [number, number] {
  return getAngle
    ? (row, info) => rotatePixelOffset(getPixelOffset(row, info), getAngle(row))
    : getPixelOffset;
}

/**
 * Whether a symbol's text or icon turns with the line it is placed along: with
 * `*-rotation-alignment: map`, or `auto` (the default) under line placement, as in MapLibre.
 */
function isAlignedToMap(alignment: unknown, placement: string): boolean {
  return alignment === 'map' || ((alignment ?? 'auto') === 'auto' && isLinePlacement(placement));
}

/**
 * Work, in point-to-segment distance tests, that polygon label searches may spend per tile and
 * style layer. Tile geometry is untrusted; past this budget, remaining polygons get no label.
 */
const TILE_POLE_SEARCH_SEGMENT_TESTS = 2e7;

/**
 * Work, in steps along lines and vertices checked for bends, that labels along lines may spend
 * per tile and style layer. Past this budget, remaining placements on the tile are skipped.
 */
const TILE_LINE_ANCHOR_STEPS = 1e6;

/**
 * Line-breaking steps (see `WrapBudget`) that label wrapping may spend per tile and style layer
 * each time the labels' text is evaluated: about 60 labels of the longest wrapped length in
 * ideographs, far more than real labels need. Past it, labels are drawn unwrapped.
 */
const TILE_WRAP_BUDGET_STEPS = 2e6;

const geoJsonDefaultProps = {...GeoJsonLayer.defaultProps} as Omit<
  typeof GeoJsonLayer.defaultProps,
  'data'
>;
delete (geoJsonDefaultProps as typeof GeoJsonLayer.defaultProps).data;

const functionIds = new WeakMap<object, number>();
let lastFunctionId = 0;

/** A stable number per function object, so a replaced function changes an update trigger. */
function getFunctionId(value: object): number {
  let id = functionIds.get(value);
  if (id === undefined) {
    id = ++lastFunctionId;
    functionIds.set(value, id);
  }
  return id;
}

/**
 * Replaces style-spec token placeholders in a label template.
 */
function resolveTokenString(template: unknown, properties?: Record<string, any>): string | null {
  if (typeof template !== 'string') {
    return null;
  }

  return template.replace(/\{([^}]+)\}/g, (_, token) => {
    const value = properties?.[token];
    return value === null || value === undefined ? '' : String(value);
  });
}

/**
 * Returns a midpoint for a line geometry.
 */
function getLineMidpoint(coordinates: number[][]): number[] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  return coordinates[Math.floor(coordinates.length / 2)] || coordinates[0] || null;
}

/**
 * MapLibre places a point label on a polygon at its pole of inaccessibility, found to within 16
 * units of the tile's 8192-unit extent.
 */
const POLE_PRECISION_TILE_FRACTION = 16 / 8192;

/**
 * Returns one point-label anchor per polygon, at its pole of inaccessibility. Tile-local
 * coordinates are planar already; longitude/latitude (globe tiles) are searched in Web Mercator
 * world units, with the precision of a tile at `zoom`, and converted back. Each search draws on
 * the shared `budget`; once it is spent, the remaining polygons get no anchor. Anchors outside
 * `bounds` (`[minX, minY, maxX, maxY)`, the tile's own extent) are dropped, so a polygon that lies
 * in the buffer of two tiles is labelled once.
 */
function getPolygonAnchors(
  polygons: number[][][][],
  geographic: boolean,
  zoom: number,
  budget: PoleSearchBudget,
  bounds: number[] | null
): number[][] {
  const precision = geographic
    ? POLE_PRECISION_TILE_FRACTION / 2 ** Math.max(0, Math.floor(zoom))
    : POLE_PRECISION_TILE_FRACTION;
  const anchors: number[][] = [];
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      continue;
    }
    const rings = geographic ? polygon.map(ring => ring.map(lngLatToWorld)) : polygon;
    // One polygon may spend at most the single-search default, and never more than the tile has.
    const polygonBudget = {
      segmentTests: Math.min(DEFAULT_POLE_SEARCH_SEGMENT_TESTS, budget.segmentTests)
    };
    const start = polygonBudget.segmentTests;
    const pole = getPoleOfInaccessibility(rings, precision, polygonBudget);
    budget.segmentTests -= start - polygonBudget.segmentTests;
    if (!pole) {
      continue;
    }
    const anchor = geographic ? worldToLngLat(pole) : pole;
    if (!bounds || isInsideBounds(anchor, bounds)) {
      anchors.push(anchor);
    }
  }
  return anchors;
}

/** Half-open bounds test, so a point on a shared tile edge belongs to exactly one tile. */
function isInsideBounds([x, y]: number[], [minX, minY, maxX, maxY]: number[]): boolean {
  return x >= minX && x < maxX && y >= minY && y < maxY;
}

/** Whether a point lies strictly inside bounds, off their edges. */
function isStrictlyInsideBounds([x, y]: number[], [minX, minY, maxX, maxY]: number[]): boolean {
  return x > minX && x < maxX && y > minY && y < maxY;
}

/** Longitude/latitude to Web Mercator world units, `[0, 1]` across the world. */
function lngLatToWorld([lng, lat]: number[]): number[] {
  const latitude = Math.max(-85.051129, Math.min(85.051129, lat));
  const y = Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360));
  return [(lng + 180) / 360, 0.5 - y / (2 * Math.PI)];
}

function worldToLngLat([x, y]: number[]): number[] {
  const latitude = (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90;
  return [x * 360 - 180, latitude];
}

/**
 * What the line placements of one tile and style layer share: how label text is measured, in ems,
 * and the anchors placed so far per label text (see `isNearSameText`).
 */
type LinePlacementContext = {
  measureText: (text: string) => number;
  placed: Map<string, number[][]>;
};

/**
 * MapLibre's `anchorIsTooClose`: whether `point` lies within `distance` of an anchor already
 * placed for `text`; if not, the point is recorded. Anchors are kept in a grid of `distance`
 * cells, so each check reads a few cells, rather than every anchor of the same text.
 */
function isNearSameText(
  placed: Map<string, number[][]>,
  text: string,
  [x, y]: number[],
  distance: number
): boolean {
  if (!(distance > 0) || !Number.isFinite(x / distance) || !Number.isFinite(y / distance)) {
    return false;
  }
  const column = Math.floor(x / distance);
  const row = Math.floor(y / distance);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const [px, py] of placed.get(`${column + dx},${row + dy},${text}`) || []) {
        if (Math.hypot(px - x, py - y) < distance) {
          return true;
        }
      }
    }
  }
  const key = `${column},${row},${text}`;
  const cell = placed.get(key);
  if (cell) {
    cell.push([x, y]);
  } else {
    placed.set(key, [[x, y]]);
  }
  return false;
}

function isLinePlacement(placement: string): boolean {
  return placement === 'line' || placement === 'line-center';
}

function isLineGeometry(feature: FeatureLike): boolean {
  const type = feature.geometry?.type;
  return type === 'LineString' || type === 'MultiLineString';
}

/**
 * Returns a coarse collision priority for a label feature.
 */
function getCollisionPriority(feature: FeatureLike): number {
  const properties = feature?.properties || {};

  if (properties.capital > 0 || properties.class === 'country') {
    return 1000;
  }
  if (properties.class === 'state' || properties.class === 'city') {
    return 750;
  }
  if (properties.layerName === 'water_name' || properties.layerName === 'waterway') {
    return 400;
  }

  return 100;
}

/**
 * The sublayers that draw one part of a symbol, from `layer`, which is built collision-tested. A
 * part that is always placed is drawn by a copy without the collision filter. While `keepFootprint`
 * is set, `layer` stays in the collision pass at zero opacity, so the part still hides other
 * symbols (or marks its anchor) without being drawn twice.
 */
function placeSymbolPart(
  layer: Layer<any>,
  collision: SymbolPartCollision,
  keepFootprint: boolean
): Layer<any>[] {
  if (collision.tested) {
    return [layer];
  }
  const placed = layer.clone({
    id: `${layer.id}-overlap`,
    collisionEnabled: false
  });
  if (!keepFootprint) {
    return [placed];
  }
  // The footprint is not pickable, so picking resolves to the drawn copy only, and not
  // highlighted, which would draw it over its zero opacity.
  return [
    placed,
    layer.clone({opacity: 0, pickable: false, autoHighlight: false, highlightedObjectIndex: -1})
  ];
}

/** How a symbol's text and icon take part in collision (see `getSymbolCollision`). */
type SymbolCollisionResult = {text: SymbolPartCollision; icon: SymbolPartCollision};

/** The rows whose `part` (text or icon) is drawn by the same sublayers, with the same collision. */
type SymbolPartGroup = {
  /** Appended to the ids of the group's sublayers. */
  idSuffix: string;
  collision: SymbolCollisionResult;
  /** Per row, whether the row is in the group; `null` when every row is. */
  rows: boolean[] | null;
};

/** The sublayers that `placeSymbolPart` builds for `part`, as a string, to compare two results. */
function getSymbolPartPlacementKey(
  collision: SymbolCollisionResult,
  part: 'text' | 'icon'
): string {
  const {tested, blocks} = collision[part];
  // Text keeps its anchor in the collision pass while the icon is tested (see `renderLayers`).
  const footprint = !tested && (blocks || (part === 'text' && collision.icon.tested));
  return `${tested}|${blocks}|${footprint}`;
}

/** `accessor` for the rows in `rows` and `fallback` for the others; `accessor` when `rows` is null. */
function forRows<T>(
  rows: boolean[] | null,
  accessor: (row: LabelRow, info: {index: number}) => T,
  fallback: T
): (row: LabelRow, info: {index: number}) => T {
  return rows ? (row, info) => (rows[info.index] ? accessor(row, info) : fallback) : accessor;
}

/**
 * Renders label text for decoded vector-tile features, with optional geometry
 * passthrough for debugging.
 */
export class MVTLabelLayer extends CompositeLayer<MVTLabelLayerProps> {
  /** Deck.gl layer name. */
  static layerName = 'MVTLabelLayer';

  /** Default props for {@link MVTLabelLayer}. */
  static defaultProps: DefaultProps<MVTLabelLayerProps> = {
    ...geoJsonDefaultProps,
    billboard: true,
    renderGeometry: false,
    labelSizeUnits: 'pixels',
    fontFamily: null
  };

  /** Current label-row state. */
  state: MVTLabelLayerState = undefined!;

  /** The tile whose anchors are being placed, in a `tiles` layer; see `getTileProps`. */
  private placingTile: LabelTile | null = null;

  /** The tile props that anchors are placed with: the tile being placed, or this layer's. */
  getTileProps(): Pick<MVTLabelLayerProps, 'tileBoundingBox' | 'tileZoom' | 'tileSize'> {
    return this.placingTile ?? this.props;
  }

  /** A picked label of a `tiles` layer reports its tile. */
  getPickingInfo(params: any): any {
    const row = params.info?.object;
    const info: any = super.getPickingInfo(params);
    if (row?.__tile) {
      info.tile = row.__tile;
    }
    return info;
  }

  /**
   * Resolves `icon-image` for a feature against the loaded sprites. Legacy `{token}` names are
   * resolved as in `text-field`. Returns `null`, and warns once per name, when no sprite has it.
   */
  getIcon(feature: FeatureLike): ResolvedSpriteIcon | null {
    const iconImage = this.getStyleProperty('icon-image');
    if (!iconImage) {
      return null;
    }
    const value = iconImage.evaluate(
      getZoomBucket(this.props.zoom || 0),
      feature,
      getSpriteImageNames(this.props.spriteAtlases)
    );
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['icon-image']);
    const name =
      value === null || value === undefined
        ? ''
        : isExpression || iconImage.isFeatureDependent
          ? String(value)
          : resolveTokenString(String(value), feature.properties) || '';
    if (!name) {
      return null;
    }
    const icon = resolveSpriteIcon(this.props.spriteAtlases || undefined, name);
    if (!icon) {
      warnMissingIcon(name);
    }
    return icon;
  }

  /** On-screen icon height in pixels: the image's CSS-pixel height scaled by `icon-size`. */
  getIconSize(feature: FeatureLike): number {
    const icon = this.getIcon(feature);
    if (!icon) {
      return 0;
    }
    const scale = Number(this.evaluateStyleProperty('icon-size', feature) ?? 1);
    return (icon.entry.height / icon.entry.pixelRatio) * scale;
  }

  /**
   * Icon color: `icon-color` for SDF images, white otherwise (deck.gl draws unmasked icons in
   * their own colors), with `icon-opacity` as alpha.
   */
  getIconColor(feature: FeatureLike): number[] {
    const opacity = Number(this.evaluateStyleProperty('icon-opacity', feature) ?? 1);
    const icon = this.getIcon(feature);
    const color = icon?.entry.mask
      ? (this.evaluateStyleProperty('icon-color', feature) as number[] | undefined) || [0, 0, 0, 1]
      : [255, 255, 255, 1];
    return withOpacity(color, opacity);
  }

  /**
   * Icon pixel offset: `icon-anchor` places that edge or corner of the icon on the point, and
   * `icon-offset` shifts it by pixels scaled with `icon-size`, as in MapLibre.
   */
  getIconPixelOffset(feature: FeatureLike): [number, number] {
    const icon = this.getIcon(feature);
    if (!icon) {
      return [0, 0];
    }
    const scale = Number(this.evaluateStyleProperty('icon-size', feature) ?? 1);
    const width = (icon.entry.width / icon.entry.pixelRatio) * scale;
    const height = (icon.entry.height / icon.entry.pixelRatio) * scale;
    const [ax, ay] =
      ANCHOR_FRACTIONS[String(this.evaluateStyleProperty('icon-anchor', feature) ?? 'center')] ||
      ANCHOR_FRACTIONS.center;
    const offset = (this.evaluateStyleProperty('icon-offset', feature) as number[] | undefined) || [
      0, 0
    ];
    return [-ax * width + offset[0] * scale, -ay * height + offset[1] * scale];
  }

  /** Text pixel offset from `text-offset`, which is in ems of `text-size`. */
  getLabelPixelOffset(feature: FeatureLike): [number, number] {
    const offset = this.evaluateStyleProperty('text-offset', feature) as number[] | undefined;
    if (!offset) {
      return [0, 0];
    }
    const size = this.getLabelSize(feature);
    return [offset[0] * size, offset[1] * size];
  }

  /**
   * Padding, `[left, top, right, bottom]` in pixels, that makes each label's collision box cover
   * the area around its anchor that deck.gl's collision filter samples (5x5 pixels). Without it,
   * a label moved off its anchor by `text-offset` is always hidden, and one whose anchor is at its
   * edge (`text-anchor: left`, `top`, ...) is faded. The text box always lies on the far side of
   * its offset, so padding the box by the offset plus the sample radius reaches the anchor.
   * `text-padding` widens the box by that many more pixels on each side, so the label also hides
   * the symbols anchored within that margin of it.
   */
  getCollisionPadding(): [number, number, number, number] {
    const rows = this.state.labelData || [];
    const isPerFeature = ['text-offset', 'text-size'].some(
      name => this.getStyleProperty(name)?.isFeatureDependent
    );
    let [left, top, right, bottom] = [0, 0, 0, 0];
    for (const row of isPerFeature ? rows : rows.slice(0, 1)) {
      const [x, y] = this.getLabelPixelOffset((row as any).__source?.object ?? row);
      left = Math.max(left, x);
      top = Math.max(top, y);
      right = Math.max(right, -x);
      bottom = Math.max(bottom, -y);
    }
    const margin = COLLISION_SAMPLE_RADIUS + this.getTextPadding();
    return [left + margin, top + margin, right + margin, bottom + margin];
  }

  /** `text-padding` at the stepped zoom, in pixels. */
  getTextPadding(): number {
    const zoom = getZoomBucket(this.props.zoom || 0);
    const padding = Number(
      this.getStyleProperty('text-padding')?.evaluate(zoom) ??
        getStylePropertyDefault('text-padding')
    );
    return Math.max(0, padding) || 0;
  }

  /**
   * The size scale that widens the icon boxes of `rows` by `icon-padding` in the collision pass.
   * `IconLayer` takes one size scale per layer and scales each icon about its center, so the
   * scale fits the median icon, and the others are padded in proportion to their size. Both axes
   * grow by the larger of an icon's horizontal and vertical padding (left plus right, top plus
   * bottom), split evenly between the two sides.
   */
  getIconCollisionScale(rows: {row: LabelRow; icon: ResolvedSpriteIcon}[]): number {
    const defaultPadding = getStylePropertyDefault('icon-padding') as number[];
    const scales: number[] = [];
    for (const {row, icon} of rows) {
      const feature = (row as any).__source?.object ?? row;
      const padding =
        (this.evaluateStyleProperty('icon-padding', feature) as number[] | undefined) ??
        defaultPadding;
      const [top, right, bottom, left] = padding.map(value => Math.max(0, value) || 0);
      const size = Number(this.evaluateStyleProperty('icon-size', feature) ?? 1);
      const width = (icon.entry.width / icon.entry.pixelRatio) * size;
      const height = (icon.entry.height / icon.entry.pixelRatio) * size;
      if (width > 0 && height > 0) {
        scales.push(1 + Math.max((left + right) / width, (top + bottom) / height));
      }
    }
    if (!scales.length) {
      return 1;
    }
    scales.sort((a, b) => a - b);
    return scales[Math.floor((scales.length - 1) / 2)];
  }

  /**
   * Update trigger for accessors that read `propertyNames`: the properties' style values, plus the
   * stepped zoom when any of them depends on zoom. A value edited in place, or a new zoom step for a
   * zoom-dependent value, re-evaluates the accessor; other zoom changes do not.
   */
  getStyleUpdateTrigger(...propertyNames: string[]): string {
    const {styleLayer} = this.props;
    const values = propertyNames.map(name => {
      const value = styleLayer?.layout?.[name] ?? styleLayer?.paint?.[name];
      return value === undefined ? '' : JSON.stringify(value);
    });
    const isZoomDependent = propertyNames.some(
      name => this.getStyleProperty(name)?.isZoomDependent
    );
    return `${isZoomDependent ? getZoomBucket(this.props.zoom || 0) : ''}|${values.join('|')}`;
  }

  /** Update triggers for the icon accessors (see `getStyleUpdateTrigger`). */
  getIconUpdateTriggers(): Record<string, string> {
    const getTrigger = (...propertyNames: string[]) => this.getStyleUpdateTrigger(...propertyNames);
    const angle = `${this.state?.bearingStep}|${getTrigger(
      'icon-rotate',
      'icon-keep-upright',
      'icon-rotation-alignment'
    )}`;
    return {
      getIcon: getTrigger('icon-image'),
      getSize: getTrigger('icon-image', 'icon-size'),
      getColor: getTrigger('icon-image', 'icon-color', 'icon-opacity'),
      // Turned icons turn their offset too (see `withIconAngle`).
      getPixelOffset: `${angle}|${getTrigger('icon-image', 'icon-size', 'icon-anchor', 'icon-offset')}`,
      getAngle: angle
    };
  }

  /**
   * One `IconLayer` per sprite that this layer's icons come from. Each holds every label row, so
   * an icon has the same row index, and so the same collision-filter identity, as its own label:
   * the two are placed or hidden as one unit. Rows whose icon is in another sprite, or in none,
   * draw nothing. Icons with and without text follow different placement rules when the layout
   * makes them differ (see `getSymbolPartGroups`); each sprite then has a layer per rule.
   *
   * `icon-image` is evaluated once per row. Each sprite's layer evaluates the other style
   * properties only for its own rows and gives every other row constants, so the style evaluation
   * across all layers is linear in the rows. The instance count is rows times the sprites a tile
   * uses (twice that when the rules differ), and only the style's `sprite` list adds sprites: tile
   * data cannot.
   */
  renderIconLayers(icons: (ResolvedSpriteIcon | null)[] = this.getRowIcons()): any[] {
    const {iconLoadOptions, billboard, spriteAtlases} = this.props;
    const labelRows = this.getRows();
    const atlases = new Set<SpriteAtlas>();
    for (const icon of icons) {
      if (icon) {
        atlases.add(icon.atlas);
      }
    }
    this.retainIconAtlases(atlases);
    if (!atlases.size) {
      return [];
    }
    const groups = this.getSymbolPartGroups('icon', () => this.getRowsWithText());
    const {props: angleProps, getAngle} = this.getIconAngleProps();
    // Sprite ids are arbitrary strings, so `${id}${idSuffix}` (and a copy's `-overlap`) can repeat
    // another sprite's id; a repeated id gets a number.
    const ids = new Set<string>();
    const getUniqueId = (id: string) => {
      let unique = id;
      for (let n = 2; ids.has(unique) || ids.has(`${unique}-overlap`); n++) {
        unique = `${id}-${n}`;
      }
      ids.add(unique).add(`${unique}-overlap`);
      return unique;
    };
    return groups.flatMap(({idSuffix, collision: {icon: collision}, rows}) =>
      [...atlases].flatMap(atlas => {
        const isOwnRow = (index: number) => icons[index]?.atlas === atlas && (!rows || rows[index]);
        // Accessors over every row: `fallback` for rows whose icon is not in this layer.
        const forOwnRows = <T>(accessor: (feature: FeatureLike) => T, fallback: T) => {
          const getValue = this.getSubLayerAccessor(accessor) as any;
          return (row: LabelRow, info: {index: number}) =>
            isOwnRow(info.index) ? getValue(row, info) : fallback;
        };
        const layer = new IconLayer({
          ...this.getSubLayerProps({id: getUniqueId(`icons-${atlas.id}${idSuffix}`)}),
          data: labelRows,
          iconAtlas: this.getIconAtlas(atlas) as any,
          iconMapping: atlas.mapping,
          loadOptions: iconLoadOptions || undefined,
          billboard,
          ...angleProps,
          ...(getAngle ? {getAngle} : {}),
          sizeUnits: 'pixels',
          parameters: LABEL_PARAMETERS,
          extensions: [
            ...(this.props.extensions || []),
            new LabelCollisionFilterExtension(),
            GLOBE_HORIZON_EXTENSION
          ],
          collisionEnabled: true,
          collisionGroup: LABEL_COLLISION_GROUP,
          getCollisionPriority: forOwnRows(
            feature => this.getLabelCollisionPriority(feature),
            0
          ) as any,
          // The icon's whole box collides, as in MapLibre, including its transparent pixels,
          // widened by `icon-padding`. An icon that ignores placement draws nothing in the
          // collision pass.
          collisionTestProps: {
            alphaCutoff: 0,
            sizeScale: collision.blocks
              ? this.getIconCollisionScale(
                  labelRows.flatMap((row, index) =>
                    isOwnRow(index) ? [{row, icon: icons[index]!}] : []
                  )
                )
              : 0
          },
          getPosition: (d: LabelRow) => d.position,
          getIcon: ((_: LabelRow, {index}: {index: number}) =>
            isOwnRow(index) ? icons[index]!.name : null) as any,
          getSize: forOwnRows(feature => this.getIconSize(feature), 0) as any,
          getColor: forOwnRows(feature => this.getIconColor(feature), [0, 0, 0, 0]) as any,
          getPixelOffset: withIconAngle(
            forOwnRows(feature => this.getIconPixelOffset(feature), [0, 0] as [number, number]),
            getAngle
          ) as any,
          updateTriggers: {
            ...this.getIconUpdateTriggers(),
            // `icon-image` decides which rows this sprite's layer draws.
            getCollisionPriority: `${this.getStyleUpdateTrigger(
              'symbol-sort-key',
              'icon-image'
            )}|${this.getCollisionPriorityRangeKey()}`,
            // The sprite list decides which rows `icon-image` resolves into this sprite, and which
            // rows have text decides the group's rows. The latter's change between split and
            // unsplit groups also refreshes the rows masked out before.
            all: [atlas, spriteAtlases, rows ? this.getLabelUpdateTriggers().getText : null]
          }
        });
        return placeSymbolPart(layer, collision, collision.blocks);
      })
    );
  }

  /**
   * Marks each row's anchor in the collision pass with a box of `COLLISION_SAMPLE_RADIUS` pixels
   * on each side, for symbols whose text does not block: the text's own test, and its icon's,
   * sample there. It is the box `TextLayer` draws for an empty label, without the label's pixel
   * offset. The layer draws nothing visible, and its rows share the text's row indices, so its mark
   * is the text's (and the icon's) collision-filter identity.
   */
  renderAnchorLayer(
    idSuffix: string,
    getCollisionPriority: (row: LabelRow, info: {index: number}) => number,
    updateTriggers: Record<string, unknown>
  ): Layer<any> {
    return new _TextBackgroundLayer({
      ...this.getSubLayerProps({id: `anchors${idSuffix}`}),
      data: this.getRows(),
      extensions: [
        ...(this.props.extensions || []),
        new LabelCollisionFilterExtension(),
        GLOBE_HORIZON_EXTENSION
      ],
      parameters: LABEL_PARAMETERS,
      billboard: this.props.billboard,
      collisionEnabled: true,
      collisionGroup: LABEL_COLLISION_GROUP,
      getCollisionPriority: getCollisionPriority as any,
      getPosition: (d: LabelRow) => d.position,
      padding: [
        COLLISION_SAMPLE_RADIUS,
        COLLISION_SAMPLE_RADIUS,
        COLLISION_SAMPLE_RADIUS,
        COLLISION_SAMPLE_RADIUS
      ],
      getFillColor: [0, 0, 0, 0],
      opacity: 0,
      pickable: false,
      // Highlighting would draw the box over the opacity.
      autoHighlight: false,
      highlightedObjectIndex: -1,
      updateTriggers
    });
  }

  /**
   * The label rows in the order every text, icon and anchor sublayer holds them: `labelData` in
   * reverse, so that of labels with equal priority the first one wins its place (see `textRows`).
   * The collision filter identifies a symbol by its row index, so an icon, its label and its
   * anchor mark must have the same index; every per-row array that these sublayers index (row
   * icons, rows with text, the rows of a symbol part group) is in this order.
   */
  getRows(): LabelRow[] {
    const {labelData, textRows} = this.state;
    if (!labelData) {
      return [];
    }
    if (textRows?.source !== labelData) {
      this.state.textRows = {source: labelData, rows: [...labelData].reverse()};
    }
    return this.state.textRows!.rows;
  }

  /**
   * Per label row, whether it has text (see `getLabel`). The result is kept with the label text
   * cache, so it is evaluated once per text update trigger and label rows, not on every render.
   */
  getRowsWithText(): boolean[] {
    const rows = this.getRows();
    const labelText = this.state.labelText;
    if (labelText?.rowsWithText) {
      return labelText.rowsWithText;
    }
    const rowsWithText = rows.map(
      row => this.getLabel((row as any).__source?.object ?? row) !== undefined
    );
    if (labelText) {
      labelText.rowsWithText = rowsWithText;
    }
    return rowsWithText;
  }

  /**
   * The texture of a sprite's image, shared by the icon layers of every label layer, or its URL
   * while it is not decoded. deck.gl would otherwise upload the image for each icon layer.
   */
  getIconAtlas(atlas: SpriteAtlas): unknown {
    const {device} = this.context;
    if (typeof atlas.image === 'string' || !device) {
      return atlas.image;
    }
    if (!this.state.iconTextures) {
      this.state.iconTextures = new SharedTextureSet(device);
    }
    return this.state.iconTextures.get(atlas.image);
  }

  /** Releases the sprite textures that the icon layers no longer draw from. */
  retainIconAtlases(atlases: Set<SpriteAtlas>): void {
    this.state.iconTextures?.retainOnly([...atlases].map(atlas => atlas.image as object));
  }

  /**
   * Each label row's icon, resolved against the loaded sprites (see `getIcon`), or all `null`
   * while the layer has no `icon-image` or no sprites.
   */
  getRowIcons(): (ResolvedSpriteIcon | null)[] {
    const rows = this.getRows();
    if (!this.props.spriteAtlases?.length || !this.getStyleProperty('icon-image')) {
      return rows.map(() => null);
    }
    return rows.map(row => this.getIcon((row as any).__source?.object ?? row));
  }

  /**
   * Splits the label rows by how their `part`, text or icon, takes part in collision. MapLibre
   * combines the placement rules of a symbol's text and icon only when the symbol has both: a
   * symbol whose text is empty, or whose icon is empty or missing from the sprites, follows the
   * rules of its one part. `hasOtherPart` returns, per row, whether the row has the other part. It
   * is called only when the two cases follow different rules, so a layout whose rules do not
   * depend on it keeps one group of every row and evaluates nothing more per row.
   *
   * A row without text stays with the rows that have text and an icon: an empty text draws
   * nothing, and that group's text keeps the anchor in the collision pass whenever the row's own
   * icon is tested.
   */
  getSymbolPartGroups(part: 'text' | 'icon', hasOtherPart: () => boolean[]): SymbolPartGroup[] {
    const paired = this.getSymbolCollision();
    const alone = this.getSymbolCollision(part === 'text' ? {hasIcon: false} : {hasText: false});
    if (getSymbolPartPlacementKey(paired, part) === getSymbolPartPlacementKey(alone, part)) {
      return [{idSuffix: '', collision: paired, rows: null}];
    }
    const withOther = hasOtherPart();
    const withoutOther = withOther.map(has => !has);
    const groups: SymbolPartGroup[] = [];
    if (withOther.some(Boolean)) {
      groups.push({idSuffix: '', collision: paired, rows: withOther});
    }
    if (withoutOther.some(Boolean)) {
      groups.push({idSuffix: '-alone', collision: alone, rows: withoutOther});
    }
    // Every row in one group: no rows to mask.
    return groups.length > 1
      ? groups
      : [{idSuffix: '', collision: groups[0]?.collision ?? paired, rows: null}];
  }

  /**
   * How this layer's text and icons take part in collision (see `getSymbolCollision`), from its
   * placement properties at the stepped zoom. `*-overlap`, where set, takes precedence over
   * `*-allow-overlap`, as in MapLibre; its `cooperative` value is treated as `never`. `parts` set
   * to `false` leave out the text or icon, for symbols that lack it.
   */
  getSymbolCollision(parts: {hasText?: boolean; hasIcon?: boolean} = {}): SymbolCollisionResult {
    const zoom = getZoomBucket(this.props.zoom || 0);
    const evaluate = (name: string) =>
      this.getStyleProperty(name)?.evaluate(zoom) ?? getStylePropertyDefault(name);
    const allowsOverlap = (part: string) => {
      const overlap = this.getStyleProperty(`${part}-overlap`)?.evaluate(zoom);
      return overlap ? overlap === 'always' : Boolean(evaluate(`${part}-allow-overlap`));
    };
    return getSymbolCollision({
      hasText: (parts.hasText ?? true) && Boolean(this.getStyleProperty('text-field')),
      hasIcon: (parts.hasIcon ?? true) && Boolean(this.getStyleProperty('icon-image')),
      textAllowOverlap: allowsOverlap('text'),
      iconAllowOverlap: allowsOverlap('icon'),
      textIgnorePlacement: Boolean(evaluate('text-ignore-placement')),
      iconIgnorePlacement: Boolean(evaluate('icon-ignore-placement')),
      textOptional: Boolean(evaluate('text-optional')),
      iconOptional: Boolean(evaluate('icon-optional'))
    });
  }

  /** Returns a compiled `layout` or `paint` property of the style layer, if it sets one. */
  private getStyleProperty(propertyName: string): CompiledStyleProperty | null {
    const {styleLayer} = this.props;
    return styleLayer ? getCompiledStyleProperty(styleLayer, propertyName) : null;
  }

  /** Evaluates a style property for a feature at the stepped zoom (`getZoomBucket`). */
  private evaluateStyleProperty(propertyName: string, feature: FeatureLike): unknown {
    return this.getStyleProperty(propertyName)?.evaluate(
      getZoomBucket(this.props.zoom || 0),
      feature
    );
  }

  /**
   * The CSS font of this layer's labels, from `text-font` at the stepped zoom, or the style
   * spec's default font when the layer does not set it, with the `fontFamily` override applied.
   * `TextLayer` takes one font per layer, so a data-driven `text-font` is evaluated for the first
   * label feature only.
   */
  getFont(): LabelFont {
    const textFont = this.getStyleProperty('text-font');
    const row = this.state?.labelData?.[0] as
      | (LabelRow & {__source?: {object: FeatureLike}})
      | undefined;
    const value = textFont?.evaluate(getZoomBucket(this.props.zoom || 0), row?.__source?.object);
    const fontStack = Array.isArray(value) && value.length ? value.map(String) : DEFAULT_TEXT_FONT;
    return resolveLabelFont(fontStack, this.props.fontFamily);
  }

  /**
   * Extracts the visible label text for a decoded feature. Legacy `{token}` placeholders are
   * resolved only in literal and zoom-function values, as in the style specification.
   * Applies `text-transform` and balanced `text-max-width` wrapping for point labels.
   */
  getLabel(feature: FeatureLike): string | undefined {
    // A `text-size` of 0 hides the label.
    if (!(this.getLabelSize(feature) > 0)) {
      return undefined;
    }
    return this.getLabelText(feature);
  }

  /**
   * The label text of a feature as `getLabel` returns it, whatever its `text-size` at the map's
   * zoom. Labels along lines are placed at the tile's zoom, where the text may be visible.
   */
  getLabelText(feature: FeatureLike): string | undefined {
    const textField = this.getStyleProperty('text-field');
    if (!textField) {
      return undefined;
    }
    const value = this.evaluateStyleProperty('text-field', feature);
    const text = value === null || value === undefined ? '' : String(value);
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['text-field']);
    let label =
      isExpression || textField.isFeatureDependent
        ? text.trim()
        : resolveTokenString(text, feature.properties)?.trim();
    if (label) {
      label = transformText(label, this.evaluateStyleProperty('text-transform', feature));
      const labels = this.state?.labelText?.labels;
      const wrapped = labels?.get(feature);
      if (wrapped !== undefined) {
        return wrapped;
      }
      if (this.getSymbolPlacement() === 'point') {
        const maxWidth = Number(
          this.evaluateStyleProperty('text-max-width', feature) ??
            getStylePropertyDefault('text-max-width')
        );
        // As in MapLibre, each character's advance includes the letter spacing.
        const spacing = this.getLetterSpacing(feature, label);
        let measure: ((character: string) => number) | undefined;
        label = wrapText(
          label,
          maxWidth,
          character => {
            if (!measure) {
              const font = this.getFont();
              measure = getCharacterWidthMeasurer(getTextLayerFontWeight(font), font.fontFamily);
            }
            return measure(character) + spacing;
          },
          this.state?.labelText?.budget
        );
      }
      labels?.set(feature, label);
    }
    return label || undefined;
  }

  /**
   * `text-letter-spacing` of a feature's label `text`, in ems. As in MapLibre, text in a cursive
   * script is not letter-spaced.
   */
  getLetterSpacing(feature: FeatureLike, text: string): number {
    const spacing = Number(
      this.evaluateStyleProperty('text-letter-spacing', feature) ??
        getStylePropertyDefault('text-letter-spacing')
    );
    return Number.isFinite(spacing) && spacing && allowsLetterSpacing(text) ? spacing : 0;
  }

  /**
   * `text-justify` of a feature's label. MapLibre centers the lines of labels along lines.
   */
  getTextJustify(feature: FeatureLike): LabelTextJustify {
    if (isLinePlacement(this.getSymbolPlacement())) {
      return 'center';
    }
    const justify = this.evaluateStyleProperty('text-justify', feature);
    return justify === 'auto' || justify === 'left' || justify === 'right' ? justify : 'center';
  }

  /**
   * Returns the font size for a decoded feature label.
   */
  getLabelSize(feature: FeatureLike): number {
    const size = this.evaluateStyleProperty('text-size', feature);
    return Number(size ?? getStylePropertyDefault('text-size'));
  }

  /**
   * Returns the text color for a decoded feature label, from `text-color` and `text-opacity`.
   * Falls back to the `textColor` prop, then to the style spec's default black, when the style
   * layer does not set `text-color`.
   */
  getLabelColor(feature: FeatureLike): number[] {
    const textColor = this.evaluateStyleProperty('text-color', feature) as number[] | undefined;
    const opacity = this.evaluateStyleProperty('text-opacity', feature) as number | undefined;
    if (textColor) {
      return withOpacity(textColor, opacity ?? 1);
    }

    // The style spec's default `text-color` is black.
    const fallbackColor = this.props.textColor || [0, 0, 0, 255];
    return opacity === undefined ? fallbackColor : withOpacity(fallbackColor, opacity);
  }

  /**
   * Returns the halo of a decoded feature label from `text-halo-color`, `text-halo-width` and
   * `text-halo-blur`, or `null` when it has none: a width of 0 (the default) or a transparent color
   * (the default). The color is faded by the same `text-opacity` as the text, so a hidden or faded
   * label leaves no halo. Like the width, the blur is rounded to 0.25 px.
   */
  getLabelHalo(feature: FeatureLike): LabelHalo | null {
    const value = Number(this.evaluateStyleProperty('text-halo-width', feature) ?? 0);
    const size = this.getLabelSize(feature);
    if (!(value > 0) || !(size > 0)) {
      return null;
    }
    // Rounded to a step, but a positive width keeps at least one step.
    const width = Math.max(HALO_WIDTH_STEP, Math.round(value / HALO_WIDTH_STEP) * HALO_WIDTH_STEP);
    const color = this.evaluateStyleProperty('text-halo-color', feature) as number[] | undefined;
    const opacity = this.evaluateStyleProperty('text-opacity', feature) as number | undefined;
    const outlineColor = withOpacity(color, opacity ?? 1).map(Math.round);
    if (!(outlineColor[3] > 0)) {
      return null;
    }
    // WebGPU draws halos without blur (see `TextHaloBlurExtension`), so blur must not split halo
    // groups there: invisible differences would take places under the cap from other halos.
    const blur =
      this.context?.device?.type === 'webgpu'
        ? 0
        : Number(this.evaluateStyleProperty('text-halo-blur', feature) ?? 0);
    return {
      outlineColor,
      outlineWidth: getOutlineWidth(width, size),
      outlineBlur: getHaloBlurGamma(
        Math.round(blur / HALO_WIDTH_STEP) * HALO_WIDTH_STEP,
        size,
        LABEL_FONT_SETTINGS
      )
    };
  }

  /**
   * Groups the label rows by halo. `TextLayer` takes one outline color, width and blur per layer,
   * so each distinct halo is drawn by its own text sublayer. At most `MAX_HALO_SUBLAYERS` halos are
   * kept, the most common ones; labels with any other halo are drawn with the most common halo.
   * Labels without a halo are not counted in the cap and never get one: a hidden label stays
   * hidden. Kept halos are ordered by their first label, so sublayer ids stay stable.
   */
  getLabelHalos(rows: LabelRow[]): LabelHalos {
    const groups = new Map<string, {halo: LabelHalo | null; count: number; first: number}>();
    const rowKeys = rows.map((row, index) => {
      const halo = this.getLabelHalo((row as any).__source?.object ?? row);
      const key = halo
        ? `${halo.outlineColor.join(',')}|${halo.outlineWidth}|${halo.outlineBlur}`
        : '';
      const group = groups.get(key);
      if (group) {
        group.count++;
      } else {
        groups.set(key, {halo, count: 1, first: index});
      }
      return key;
    });
    // A stable sort: equally common halos keep the order of their first label.
    const byCount = [...groups].filter(([key]) => key).sort(([, a], [, b]) => b.count - a.count);
    const kept = byCount.slice(0, MAX_HALO_SUBLAYERS);
    const none = groups.get('');
    if (none) {
      kept.push(['', none]);
    }
    kept.sort(([, a], [, b]) => a.first - b.first);
    const indices = new Map(kept.map(([key], index) => [key, index]));
    const fallback = byCount.length ? indices.get(byCount[0][0])! : 0;
    return {
      halos: kept.map(([, group]) => group.halo),
      rowHalos: rowKeys.map(key => indices.get(key) ?? fallback)
    };
  }

  /**
   * Returns the collision priority of a label within `collisionPriorityRange`: ordered by
   * `symbol-sort-key` when the style layer sets one, otherwise by a coarse built-in priority.
   * Lower sort keys win in the style specification and higher priorities win in
   * `CollisionFilterExtension`, so the key is mapped through a decreasing function. That mapping
   * keeps every key inside the range, at the cost of compressing keys far from zero.
   */
  getLabelCollisionPriority(feature: FeatureLike): number {
    const [min, max] = this.props.collisionPriorityRange || [-1000, 1000];
    const fraction = this.getStyleProperty('symbol-sort-key')
      ? 0.5 -
        Math.atan(Number(this.evaluateStyleProperty('symbol-sort-key', feature)) || 0) / Math.PI
      : getCollisionPriority(feature) / 1001;
    return min + fraction * (max - min);
  }

  /** `collisionPriorityRange` as a string, for the collision priority update triggers. */
  getCollisionPriorityRangeKey(): string {
    return String(this.props.collisionPriorityRange || '');
  }

  /**
   * What the label text takes from `text-size`: a size of 0 hides the label (see `getLabel`). A size
   * that depends on zoom but not on the feature re-evaluates the text only when it reaches or leaves
   * 0, not at every zoom step, since the text and its wrapping do not depend on the size otherwise.
   */
  getLabelSizeTextTrigger(): string {
    const size = this.getStyleProperty('text-size');
    if (!size?.isZoomDependent || size.isFeatureDependent) {
      return this.getStyleUpdateTrigger('text-size');
    }
    const value = size.evaluate(getZoomBucket(this.props.zoom || 0));
    const isVisible = Number(value ?? getStylePropertyDefault('text-size')) > 0;
    return `${JSON.stringify(this.props.styleLayer?.layout?.['text-size'])}|${isVisible}`;
  }

  /** Update triggers for the text accessors (see `getStyleUpdateTrigger`). */
  getLabelUpdateTriggers(): Record<string, string> {
    const getTrigger = (...propertyNames: string[]) => this.getStyleUpdateTrigger(...propertyNames);
    const {fontFamily} = this.props;
    const fontFamilyKey =
      typeof fontFamily === 'function'
        ? `fn${getFunctionId(fontFamily)}`
        : JSON.stringify(fontFamily ?? null);

    return {
      getText: `${getTrigger(
        'text-field',
        'text-transform',
        'text-max-width',
        'text-letter-spacing',
        'symbol-placement',
        'text-font'
      )}|${this.getLabelSizeTextTrigger()}|${fontFamilyKey}`,
      getSize: getTrigger('text-size'),
      getColor: getTrigger('text-color', 'text-opacity'),
      // The priorities are mapped into `collisionPriorityRange`.
      getCollisionPriority: `${getTrigger('symbol-sort-key')}|${this.getCollisionPriorityRangeKey()}`,
      getPixelOffset: getTrigger('text-offset', 'text-size'),
      getAngle: `${this.state?.bearingStep}|${getTrigger('text-keep-upright')}`,
      // Also lays out the lines of each label (see `LabelTextLayer`).
      getTextAnchor: getTrigger('text-anchor', 'text-justify', 'symbol-placement'),
      getAlignmentBaseline: getTrigger('text-anchor')
    };
  }

  /**
   * The layer's `symbol-placement` at the stepped zoom. It is not data-driven, so it is evaluated
   * once per style layer rather than per feature.
   */
  getSymbolPlacement(): string {
    const placement = this.getStyleProperty('symbol-placement')?.evaluate(
      getZoomBucket(this.props.zoom || 0)
    );
    return typeof placement === 'string' ? placement : 'point';
  }

  /**
   * Line height in ems. It is not data-driven in the spec, so one value per style layer and
   * zoom step is exact.
   */
  getLineHeight(): number {
    return Number(
      this.getStyleProperty('text-line-height')?.evaluate(getZoomBucket(this.props.zoom || 0)) ??
        getStylePropertyDefault('text-line-height')
    );
  }

  /**
   * The tile's own extent in feature coordinates: the `[0, 1)` square for tile-local coordinates,
   * the tile's longitude/latitude box for globe tiles, or null when it is not known.
   */
  getTileBounds(geographic: boolean): number[] | null {
    if (!geographic) {
      return [0, 0, 1, 1];
    }
    const bbox = this.getTileProps().tileBoundingBox;
    return bbox && Number.isFinite(bbox.west)
      ? [bbox.west, bbox.south, bbox.east, bbox.north]
      : null;
  }

  /**
   * Extracts candidate label anchor positions from a feature geometry. Points are labelled where
   * they are. Lines are labelled at the middle vertex of their first part here; with
   * `symbol-placement: line` or `line-center`, `getLabelData` places them along the line instead
   * (see `getLineLabelPlacements`). With `symbol-placement: point`, each polygon of a feature is
   * labelled at its pole of inaccessibility, as in MapLibre, if that point lies in this tile;
   * polygons are not labelled along their outline. `geographic` says whether coordinates are
   * longitude/latitude (globe tiles) or tile-local. `budget` bounds the polygon searches; pass one
   * budget for all features of a tile.
   */
  getLabelAnchors(
    feature: FeatureLike,
    geographic: boolean = Boolean(this.context?.viewport?.resolution),
    placement: string = this.getSymbolPlacement(),
    budget: PoleSearchBudget = {segmentTests: TILE_POLE_SEARCH_SEGMENT_TESTS}
  ): number[][] {
    const {type, coordinates} = feature.geometry;
    const zoom = this.props.zoom || 0;
    switch (type) {
      case 'Point':
        return [coordinates];
      case 'MultiPoint':
        return coordinates;
      case 'LineString': {
        const midpoint = getLineMidpoint(coordinates);
        return midpoint ? [midpoint] : [];
      }
      case 'MultiLineString': {
        const midpoint = getLineMidpoint(coordinates[0]);
        return midpoint ? [midpoint] : [];
      }
      case 'Polygon':
        return placement === 'point'
          ? getPolygonAnchors(
              [coordinates],
              geographic,
              zoom,
              budget,
              this.getTileBounds(geographic)
            )
          : [];
      case 'MultiPolygon':
        return placement === 'point'
          ? getPolygonAnchors(coordinates, geographic, zoom, budget, this.getTileBounds(geographic))
          : [];
      default:
        return [];
    }
  }

  /**
   * The zoom at which labels along lines are placed, and the tile's size in pixels there. As in
   * MapLibre, placement uses the tile's own zoom, so labels stay put while the map zooms within a
   * tile; an overzoomed tile is placed at the integer map zoom. A tile's own zoom is the map zoom
   * at which it is drawn `tileSize` pixels wide: one less than its tile zoom for 256 px tiles.
   */
  getLinePlacementScale(): {zoom: number; tileZoom: number; tileSize: number} {
    const mapZoom = Math.floor(this.props.zoom || 0);
    const tileProps = this.getTileProps();
    const size = tileProps.tileSize || 512;
    const tileZoom = tileProps.tileZoom ?? mapZoom + Math.log2(512 / size);
    const ownZoom = tileZoom - Math.log2(512 / size);
    const zoom = Math.max(ownZoom, mapZoom);
    return {zoom, tileZoom, tileSize: size * 2 ** (zoom - ownZoom)};
  }

  /**
   * Measures the text of labels along lines, in ems, with the font `TextLayer` draws it in. Without
   * a canvas, or while that font is still loading (the browser would measure a fallback font), the
   * length is estimated from the character count instead (`getTextLengthEms`), and the layer
   * updates, placing the labels again, once the font has loaded.
   */
  getLineTextMeasurer(): (text: string) => number {
    const font = this.getFont();
    const fontWeight = getTextLayerFontWeight(font);
    if (!canMeasureText() || this.isLineTextFontLoading(font)) {
      return getTextLengthEms;
    }
    const measure = getCharacterWidthMeasurer(fontWeight, font.fontFamily);
    return text => {
      let ems = 0;
      for (const character of text) {
        ems += measure(character);
      }
      return ems;
    };
  }

  /**
   * Whether the label font is still loading in the document. The first time it is seen loading,
   * a load is requested, and the layer updates when it is done.
   */
  isLineTextFontLoading(font: LabelFont = this.getFont()): boolean {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    const fontWeight = getTextLayerFontWeight(font);
    const css = `${fontWeight} 16px ${font.fontFamily}`;
    if (!fonts || fonts.check(css)) {
      return false;
    }
    if (this.state && this.state.loadingFont !== css) {
      this.state.loadingFont = css;
      fonts.load(css).then(
        () => {
          // Widths measured meanwhile, as for wrapping, are of a fallback font.
          forgetCharacterWidths(fontWeight, font.fontFamily);
          // Unless the layer was finalized meanwhile (see `finalizeState`).
          if (this.state?.loadingFont === css) {
            this.setNeedsUpdate();
          }
        },
        () => {}
      );
    }
    return true;
  }

  /**
   * Label anchors along the lines of a `LineString` or `MultiLineString` feature, for
   * `symbol-placement: line` or `line-center`, with the direction of the line at each. Lines are
   * measured in pixels at the tile's zoom (see `getLinePlacementScale`), where `symbol-spacing`
   * and `text-max-angle` are evaluated. As in MapLibre, the label's length, the window its bends
   * are summed in and the first label's offset come from `text-size` at zoom 18, the same for
   * every tile; where that size is 0, the size at the tile's zoom is used. The text is measured by
   * `context.measureText`. Anchors outside the tile's own extent are left to the neighbouring tile.
   * With `line` placement, lines are clipped to the tile's extent first, as in MapLibre, and a
   * label is dropped within half a `symbol-spacing` of an earlier label with the same text on the
   * tile (`context.placed`); `line-center` measures the whole line. Each feature draws on the
   * shared `budget`, at most `DEFAULT_LINE_ANCHOR_STEPS` of it.
   */
  getLineLabelPlacements(
    feature: FeatureLike,
    geographic: boolean,
    placement: string,
    budget: LineAnchorBudget = {steps: TILE_LINE_ANCHOR_STEPS},
    context: LinePlacementContext = this.getLinePlacementContext()
  ): {position: number[]; angle: number}[] {
    const {type, coordinates} = feature.geometry;
    const lines: number[][][] =
      type === 'LineString' ? [coordinates] : type === 'MultiLineString' ? coordinates : [];
    if (!lines.length || !(budget.steps > 0)) {
      return [];
    }
    const {zoom, tileZoom, tileSize} = this.getLinePlacementScale();
    const evaluate = (name: string, at = zoom) =>
      Number(this.getStyleProperty(name)?.evaluate(at, feature) ?? getStylePropertyDefault(name));
    const maxTextSize = evaluate('text-size', 18);
    const textSize = maxTextSize > 0 ? maxTextSize : evaluate('text-size');
    const text = this.getLabelText(feature);
    // Icons are known once the sprites have loaded; the anchors are recomputed then.
    const icon = this.props.spriteAtlases?.length ? this.getIcon(feature) : null;
    // One feature may spend at most the single-feature default, and never more than the tile has.
    const featureBudget = {steps: Math.min(DEFAULT_LINE_ANCHOR_STEPS, budget.steps)};
    const start = featureBudget.steps;
    // Measuring the text costs a step per character.
    featureBudget.steps -= text?.length || 0;
    // As MapLibre's `getShapedLabelLength`: the longer of the text and the icon. A symbol with
    // neither has no length, and is not placed.
    // As MapLibre's shaping, the letter spacing follows every character but the last.
    const textLength =
      text && featureBudget.steps > 0
        ? (context.measureText(text) +
            (Array.from(text).length - 1) * this.getLetterSpacing(feature, text)) *
          textSize
        : 0;
    const iconLength = icon
      ? (icon.entry.width / icon.entry.pixelRatio) * evaluate('icon-size')
      : 0;
    const spacing = evaluate('symbol-spacing');
    const options = {
      placement: placement === 'line-center' ? ('line-center' as const) : ('line' as const),
      spacing,
      maxAngle: evaluate('text-max-angle'),
      textSize,
      hasText: Boolean(text),
      labelLength: Math.max(textLength, iconLength)
    };
    // `tileSize` is the tile's size at the placement zoom, so the world is `2 ** tileZoom` tiles
    // across: globe coordinates, `[0, 1]` across the world, take the overzoom factor only once.
    const scale = geographic ? tileSize * 2 ** tileZoom : tileSize;
    const bounds = this.getTileBounds(geographic);
    const clipBounds = options.placement === 'line' ? bounds : null;
    // MapLibre's `anchorIsTooClose`: labels of the same text repeat no closer than this.
    const repeatDistance = options.placement === 'line' && text ? spacing / 2 : 0;

    const placements = lines.flatMap(line => {
      if (!Array.isArray(line) || line.length < 2 || featureBudget.steps <= 0) {
        return [];
      }
      const parts = clipBounds ? clipLine(line, clipBounds) : [line];
      return parts.flatMap(part => {
        if (featureBudget.steps <= 0) {
          return [];
        }
        const pixels = part.map(point => {
          const [x, y] = geographic ? lngLatToWorld(point) : point;
          return [x * scale, y * scale];
        });
        const isContinued = Boolean(bounds) && !isStrictlyInsideBounds(part[0], bounds!);
        return (
          getLineAnchors(pixels, {...options, isContinued, budget: featureBudget})
            .map(({segment, t, angle}) => {
              const [a, b] = [pixels[segment], pixels[segment + 1]];
              const pixel = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
              // Interpolated in Web Mercator, where the line was measured.
              const position = geographic
                ? worldToLngLat([pixel[0] / scale, pixel[1] / scale])
                : [pixel[0] / scale, pixel[1] / scale];
              return {position, angle, pixel};
            })
            // Only anchors in the tile count as placed, as MapLibre's lie in the tile.
            .filter(({position}) => !bounds || isInsideBounds(position, bounds))
            .filter(
              ({pixel}) =>
                !repeatDistance || !isNearSameText(context.placed, text!, pixel, repeatDistance)
            )
            .map(({position, angle}) => ({position, angle}))
        );
      });
    });
    budget.steps -= start - Math.max(0, featureBudget.steps);
    return placements;
  }

  /** What the line placements of one tile and style layer share; see `getLineLabelPlacements`. */
  getLinePlacementContext(): LinePlacementContext {
    return {measureText: this.getLineTextMeasurer(), placed: new Map()};
  }

  /**
   * For `symbol-placement: line`, the `LineString` features with the same label text whose ends
   * meet, joined as MapLibre does (see `mergeLines`): per feature, the feature with the joined
   * line to place labels along, `null` for a feature joined into another, or `undefined` to place
   * the feature as it is.
   */
  getMergedLines(features: FeatureLike[]): (FeatureLike | null | undefined)[] {
    const lines = features.map(feature =>
      feature.geometry?.type === 'LineString'
        ? {text: this.getLabelText(feature), line: feature.geometry.coordinates}
        : {text: null, line: []}
    );
    return mergeLines(lines).map((line, index) => {
      if (line === null) {
        return null;
      }
      const feature = features[index];
      return line === lines[index].line
        ? undefined
        : {...feature, geometry: {...feature.geometry, coordinates: line}};
    });
  }

  /**
   * Label rows for every anchor of `features`: `symbol-placement` is evaluated once, and one
   * search budget is shared by all polygons of the tile. With `line` or `line-center` placement,
   * line features get rows along their lines, each with the line's direction.
   */
  getLabelData(features: FeatureLike[], geographic: boolean): LabelRow[] {
    const placement = this.getSymbolPlacement();
    const budget = {segmentTests: TILE_POLE_SEARCH_SEGMENT_TESTS};
    const lineBudget = {steps: TILE_LINE_ANCHOR_STEPS};
    const lineContext = isLinePlacement(placement) ? this.getLinePlacementContext() : undefined;
    const merged = placement === 'line' ? this.getMergedLines(features) : null;
    return features.flatMap((feature, index) =>
      isLinePlacement(placement) && isLineGeometry(feature)
        ? merged?.[index] === null
          ? []
          : this.getLineLabelPlacements(
              merged?.[index] || feature,
              geographic,
              placement,
              lineBudget,
              lineContext
            ).map(row => this.getSubLayerRow(row, feature, index))
        : this.getLabelAnchors(feature, geographic, placement, budget).map(position =>
            this.getSubLayerRow({position}, feature, index)
          )
    );
  }

  /**
   * The inputs besides the tile data that the anchors depend on: `symbol-placement`, the
   * coordinate mode, the tile's extent and, for globe tiles, the search precision's zoom. Labels
   * along lines also depend on the placement scale and on the style values that size and space
   * them.
   */
  getAnchorKey(geographic: boolean): string {
    const placement = this.getSymbolPlacement();
    return JSON.stringify([
      placement,
      geographic,
      geographic ? Math.floor(this.props.zoom || 0) : null,
      this.getTileBounds(geographic),
      isLinePlacement(placement)
        ? [
            this.getLinePlacementScale(),
            this.getStyleUpdateTrigger('text-field', 'text-transform', 'icon-image'),
            (this.props.spriteAtlases || []).map(atlas => atlas.id),
            // With the stepped zoom when any of them depends on zoom: placements measured at one
            // step do not fit the next.
            this.getStyleUpdateTrigger(
              'text-size',
              'icon-size',
              'symbol-spacing',
              'text-max-angle',
              'text-letter-spacing'
            ),
            // The text is measured in the label font, once it has loaded.
            ...(this.getStyleProperty('text-field')
              ? [this.getFont(), this.isLineTextFontLoading()]
              : [])
          ]
        : null
    ]);
  }

  /**
   * The map bearing in `BEARING_STEP` steps, against which upright line labels are turned. Globe
   * labels are billboards, drawn in screen space, so their bearing is 0.
   */
  getBearingStep(
    viewport: {bearing?: number; resolution?: number} = this.context?.viewport
  ): number {
    if (!viewport || viewport.resolution) {
      return 0;
    }
    return Math.round((viewport.bearing || 0) / BEARING_STEP) * BEARING_STEP;
  }

  /**
   * Labels along lines turn upright as the map rotates (`text-keep-upright`), so a layer of them
   * updates when the bearing crosses a `BEARING_STEP`.
   */
  shouldUpdateState(params: UpdateParameters<this>): boolean {
    return (
      super.shouldUpdateState(params) ||
      (params.changeFlags.viewportChanged &&
        this.turnsWithLines() &&
        this.getBearingStep(params.context.viewport) !== this.state.bearingStep)
    );
  }

  /**
   * Whether the text or icons of this layer turn with the lines they are placed along (see
   * `getLineLabelProps` and `getIconAngleProps`). Only then do they depend on the bearing. Text
   * needs a `text-field`, and icons an `icon-image` and loaded sprites.
   */
  turnsWithLines(): boolean {
    const placement = this.getSymbolPlacement();
    if (!isLinePlacement(placement)) {
      return false;
    }
    const zoom = getZoomBucket(this.props.zoom || 0);
    const turns = (name: string) =>
      isAlignedToMap(this.getStyleProperty(name)?.evaluate(zoom), placement);
    return (
      (Boolean(this.getStyleProperty('text-field')) && turns('text-rotation-alignment')) ||
      (Boolean(this.getStyleProperty('icon-image')) &&
        Boolean(this.props.spriteAtlases?.length) &&
        turns('icon-rotation-alignment'))
    );
  }

  /**
   * Text layer props for labels along lines: each label is turned to its line, upright when
   * `text-keep-upright` is set (the default). On a flat map they are drawn in the map plane, as
   * MapLibre does with the `auto` `text-rotation-alignment` and `text-pitch-alignment` of line
   * placement; on a globe they stay billboards, turned in screen space.
   */
  getLineLabelProps(): Record<string, unknown> {
    const placement = this.getSymbolPlacement();
    const zoom = getZoomBucket(this.props.zoom || 0);
    const alignment = this.getStyleProperty('text-rotation-alignment')?.evaluate(zoom);
    // With `text-rotation-alignment: viewport` the text stays upright on screen, as a billboard.
    if (!isLinePlacement(placement) || !isAlignedToMap(alignment, placement)) {
      return {};
    }
    const bearingStep = this.getBearingStep();
    // Recorded without setState: this only tracks what the angles were computed for.
    this.state.bearingStep = bearingStep;
    const keepUpright =
      (this.getStyleProperty('text-keep-upright')?.evaluate(getZoomBucket(this.props.zoom || 0)) ??
        getStylePropertyDefault('text-keep-upright')) !== false;
    const geographic = Boolean(this.context?.viewport?.resolution);
    return {
      billboard: geographic ? this.props.billboard : false,
      getAngle: (row: LabelRow) => getUprightAngle(row.angle ?? 0, bearingStep, keepUpright)
    };
  }

  /**
   * Icon layer props that turn icons, and the angle each row's icon is turned by, counter-clockwise
   * in degrees as deck.gl takes it (null when no icon turns). Icons along lines whose rotation is
   * aligned to the map (`icon-rotation-alignment: map`, or `auto`) are turned to the line's
   * direction, upright when `icon-keep-upright` is set (default false) as for text. Every icon then
   * adds `icon-rotate`, clockwise. Icons aligned to the map are drawn flat on a flat map, so they
   * turn with its bearing; the others are billboards, turned on screen. On a globe, icons stay
   * billboards.
   */
  getIconAngleProps(): {
    props: Record<string, unknown>;
    getAngle: ((row: LabelRow) => number) | null;
  } {
    const placement = this.getSymbolPlacement();
    const zoom = getZoomBucket(this.props.zoom || 0);
    const alignment = this.getStyleProperty('icon-rotation-alignment')?.evaluate(zoom);
    const isMapAligned = isAlignedToMap(alignment, placement);
    const turnsWithLine = isLinePlacement(placement) && isMapAligned;
    const iconRotate = this.getStyleProperty('icon-rotate');
    const geographic = Boolean(this.context?.viewport?.resolution);
    const props = isMapAligned ? {billboard: geographic ? this.props.billboard : false} : {};
    if (!turnsWithLine && !iconRotate) {
      return {props, getAngle: null};
    }
    const bearingStep = this.getBearingStep();
    if (turnsWithLine) {
      this.state.bearingStep = bearingStep;
    }
    const keepUpright =
      (this.getStyleProperty('icon-keep-upright')?.evaluate(zoom) ??
        getStylePropertyDefault('icon-keep-upright')) === true;
    const getLineAngle = (row: LabelRow) =>
      turnsWithLine ? getUprightAngle(row.angle ?? 0, bearingStep, keepUpright) : 0;
    const getRotate = (row: LabelRow) =>
      iconRotate
        ? Number(
            this.evaluateStyleProperty('icon-rotate', (row as any).__source?.object ?? row) ?? 0
          )
        : 0;
    // `icon-rotate` is clockwise; deck.gl angles are counter-clockwise.
    return {props, getAngle: (row: LabelRow) => getLineAngle(row) - getRotate(row)};
  }

  /**
   * Forgets a font load in flight, so that its completion does not update a finalized layer, and
   * releases the shared sprite textures.
   */
  finalizeState(context: LayerContext): void {
    super.finalizeState(context);
    if (this.state) {
      this.state.loadingFont = undefined;
      this.state.iconTextures?.releaseAll();
    }
  }

  /**
   * Recomputes label anchor rows when the source tile data, or an input the anchors depend on,
   * changes.
   */
  updateState({changeFlags}: UpdateParameters<this>): void {
    const {data, tiles} = this.props;
    if (!data && !tiles) {
      return;
    }
    const geographic = Boolean(this.context?.viewport?.resolution);
    const textTrigger = this.getLabelUpdateTriggers().getText;
    if (textTrigger !== this.state.labelText?.key[0]) {
      // Labels along lines are placed by their text's length, so they must not read text cached
      // for the previous trigger.
      this.setState({labelText: undefined});
    }
    if (tiles) {
      this.updateTileRows(tiles, geographic);
    } else if (data) {
      this.updateDataRows(data, geographic, Boolean(changeFlags.dataChanged));
    }
    const haloKey: [LabelRow[] | undefined, string] = [
      this.state.labelData,
      this.getStyleUpdateTrigger(
        'text-halo-color',
        'text-halo-width',
        'text-halo-blur',
        'text-opacity',
        'text-size'
      )
    ];
    if (haloKey[0] !== this.state.haloKey?.[0] || haloKey[1] !== this.state.haloKey?.[1]) {
      this.setState({halos: this.getLabelHalos(this.state.labelData || []), haloKey});
    }
    if (this.turnsWithLines()) {
      // The bearing the labels are turned for, so that `shouldUpdateState` updates the layer only
      // when it crosses a step, whichever of the text and icons turn.
      this.state.bearingStep = this.getBearingStep();
    }
    // deck.gl re-evaluates every label's text when the rows or the text trigger change; each
    // evaluation starts a new text cache with a fresh wrap budget.
    // The font, which a data-driven `text-font` takes from the first row: the rows of another
    // first tile can change it, and with it the text's wrapping.
    const font = JSON.stringify(this.getFont());
    const key: [string, LabelRow[] | undefined, string] = [textTrigger, this.state.labelData, font];
    const [lastTrigger, lastRows, lastFont] = this.state.labelText?.key || [];
    if (key[0] !== lastTrigger || key[1] !== lastRows || key[2] !== lastFont) {
      // A `tiles` layer wraps each tile's labels with a tile's budget. Its rows change whenever a
      // tile is added or removed; the text of features already wrapped is kept.
      const tileCount = tiles ? Math.max(tiles.length, 1) : 1;
      const labels =
        tiles && key[0] === lastTrigger && key[2] === lastFont && this.state.labelText
          ? this.state.labelText.labels
          : new WeakMap();
      this.setState({
        labelText: {
          key,
          budget: {steps: TILE_WRAP_BUDGET_STEPS * tileCount},
          labels
        }
      });
    }
  }

  /** The rows of a layer of one tile's `data`. */
  updateDataRows(
    data: NonNullable<MVTLabelLayerProps['data']>,
    geographic: boolean,
    dataChanged: boolean
  ): void {
    const anchorKey = this.getAnchorKey(geographic);
    if (dataChanged || anchorKey !== this.state.anchorKey) {
      const features = Array.isArray(data) ? data : data.features || [];
      const labelData = this.getLabelData(features, geographic);
      this.setState({labelData, anchorKey});
    }
  }

  /**
   * The rows of a `tiles` layer: each tile's anchors, placed as in a layer of the tile alone and
   * kept while its features and anchor inputs do not change, in longitude/latitude, combined by
   * `combineTileRows`. Tile-local anchors outside the tile's square are left out, as the tile's
   * own layer clips them; on a globe, tiles keep the rows they have.
   */
  updateTileRows(tiles: LabelTile[], geographic: boolean): void {
    const previous = this.state.tileRows || new Map<string, TileRows>();
    let changed = tiles !== this.state.rowTiles;
    const next = new Map<string, TileRows>();
    const tileRows = tiles.map(tile => {
      const {x, y, z} = tile.index;
      const tileKey = getTileKey(x, y, z);
      this.placingTile = tile;
      try {
        const anchorKey = this.getAnchorKey(geographic);
        const cached = previous.get(tileKey);
        if (
          cached &&
          cached.features === tile.features &&
          cached.anchorKey === anchorKey &&
          cached.tile === tile.tile
        ) {
          next.set(tileKey, cached);
          return cached.rows;
        }
        changed = true;
        let rows = this.getLabelData(tile.features, geographic);
        if (!geographic) {
          const scale = 2 ** z;
          rows = rows
            .filter(row => isInsideBounds(row.position, TILE_SQUARE))
            .map(row => {
              const world = [(x + row.position[0]) / scale, (y + row.position[1]) / scale];
              return {...row, position: worldToLngLat(world), world};
            });
        }
        if (tile.tile) {
          for (const row of rows) {
            (row as any).__tile = tile.tile;
          }
        }
        const entry = {features: tile.features, anchorKey, tile: tile.tile, rows};
        next.set(tileKey, entry);
        return rows;
      } finally {
        this.placingTile = null;
      }
    });
    if (changed) {
      const labelData = combineTileRows(tiles, tileRows);
      this.setState({
        labelData,
        tileRows: next,
        rowTiles: tiles,
        anchorKey: undefined
      });
    }
  }

  /**
   * Renders the optional debug geometry and the text labels.
   */
  renderLayers(): any {
    const {config, labelSizeUnits, billboard, renderGeometry} = this.props;
    const layers: any[] = [];

    if (renderGeometry) {
      layers.push(
        new GeoJsonLayer({
          ...this.props,
          ...this.getSubLayerProps({id: 'geojson'}),
          data: this.props.data
        })
      );
    }

    if (!config.labels) {
      // No icon layers draw from the shared sprite textures.
      this.retainIconAtlases(new Set());
    }
    if (config.labels) {
      // Icons draw under their labels.
      const icons = this.getRowIcons();
      layers.push(...this.renderIconLayers(icons));
      const font = this.getFont();
      // While the sprites load, every row is taken to have its icon (see `spriteAtlases`).
      const spritesLoading = this.props.spriteAtlases === null;
      const groups = this.getSymbolPartGroups('text', () =>
        spritesLoading ? icons.map(() => true) : icons.map(Boolean)
      );
      const {halos = [null], rowHalos = []} = this.state.halos || {};
      const rowCount = rowHalos.length;
      for (const {idSuffix, collision, rows} of groups) {
        // Accessors over every row: `fallback` for rows outside the group.
        const forGroupRows = <T>(accessor: (feature: FeatureLike) => T, fallback: T) =>
          forRows(rows, this.getSubLayerAccessor(accessor) as any, fallback) as any;
        const updateTriggers = this.getLabelUpdateTriggers();
        const getCollisionPriority = forGroupRows(
          (feature: FeatureLike) => this.getLabelCollisionPriority(feature),
          MASKED_COLLISION_PRIORITY
        );
        const getText = forGroupRows((feature: FeatureLike) => this.getLabel(feature), undefined);
        // Which rows have an icon decides the group's rows. `all` is always set, so that a change
        // between split and unsplit groups refreshes the rows masked out before.
        const groupTrigger = rows
          ? [this.getStyleUpdateTrigger('icon-image'), this.props.spriteAtlases]
          : null;
        const textBlocks = collision.text.blocks;
        // `TextLayer` refreshes its glyphs with the `getText` trigger only, not with `all`: the
        // group's rows decide which rows have text, so they are part of it.
        const getTextTrigger = [updateTriggers.getText, ...(groupTrigger || [])];
        const textProps = {
          data: this.getRows(),
          extensions: [
            ...(this.props.extensions || []),
            new LabelCollisionFilterExtension(),
            GLOBE_HORIZON_EXTENSION,
            TEXT_HALO_BLUR_EXTENSION
          ],
          parameters: LABEL_PARAMETERS,
          billboard,
          ...this.getLineLabelProps(),
          characterSet: 'auto',
          // Glyphs are signed distance fields, which `TextLayer` outlines for halos.
          fontSettings: LABEL_FONT_SETTINGS,
          collisionEnabled: true,
          collisionGroup: LABEL_COLLISION_GROUP,
          // Rows outside the group stay out of the collision pass.
          getCollisionPriority,
          fontFamily: font.fontFamily,
          fontWeight: getTextLayerFontWeight(font),
          sizeUnits: labelSizeUnits,
          lineHeight: this.getLineHeight(),
          // The collision filter keeps a label only where the label itself covers its anchor in
          // the collision map. A transparent background box is drawn for that and, in the
          // collision pass, padded to reach the anchor (see getCollisionPadding).
          background: true,
          collisionTestProps: textBlocks
            ? {padding: this.getCollisionPadding()}
            : {padding: [0, 0, 0, 0], sizeScale: 0},
          getBackgroundColor: [0, 0, 0, 0],
          getPosition: (d: LabelRow) => d.position,
          getSize: forGroupRows((feature: FeatureLike) => this.getLabelSize(feature), 0),
          getColor: forGroupRows(
            (feature: FeatureLike) => this.getLabelColor(feature),
            [0, 0, 0, 0]
          ),
          getPixelOffset: forGroupRows(
            (feature: FeatureLike) => this.getLabelPixelOffset(feature),
            [0, 0]
          ),
          getTextAnchor: forGroupRows(
            (feature: FeatureLike) =>
              getTextAnchorProps(this.evaluateStyleProperty('text-anchor', feature)).textAnchor,
            'middle'
          ),
          getAlignmentBaseline: forGroupRows(
            (feature: FeatureLike) =>
              getTextAnchorProps(this.evaluateStyleProperty('text-anchor', feature))
                .alignmentBaseline,
            'center'
          ),
          // Constant where the style layer leaves the property at its default.
          getLetterSpacing: this.getStyleProperty('text-letter-spacing')
            ? forGroupRows(
                (feature: FeatureLike) =>
                  this.getLetterSpacing(feature, this.getLabelText(feature) || ''),
                0
              )
            : 0,
          getTextJustify: this.getStyleProperty('text-justify')
            ? forGroupRows((feature: FeatureLike) => this.getTextJustify(feature), 'center')
            : 'center'
        };
        // A blocking text's collision box also marks the anchor that the icon's collision test
        // samples. Text that does not block draws nothing in the collision pass: deck.gl adds the
        // pixel offset to the collision box unscaled, so a `text-offset` would stretch it into a
        // strip that hides other symbols. Its anchor is marked by `renderAnchorLayer` instead.
        if (halos.length <= 1) {
          // Every label has the same halo, or none: one sublayer draws and places them all.
          const halo = halos[0];
          layers.push(
            ...placeSymbolPart(
              new LabelTextLayer({
                ...this.getSubLayerProps({id: `text${idSuffix}`}),
                ...textProps,
                outlineWidth: halo?.outlineWidth ?? 0,
                outlineColor: (halo?.outlineColor ?? [0, 0, 0, 0]) as any,
                textHaloBlurGamma: halo?.outlineBlur ?? 0,
                getText,
                updateTriggers: {...updateTriggers, getText: getTextTrigger, all: groupTrigger}
              }),
              collision.text,
              textBlocks
            )
          );
        } else {
          // Several halos. `TextLayer` takes one outline per layer, so each halo is drawn by its
          // own sublayer. Every sublayer holds every row, in the order of `getRows`: the collision
          // filter identifies a symbol by its row index. Labels are placed once, by the invisible
          // `text` sublayer; the halo sublayers are filtered by its marks but leave none of their
          // own, so a row outside a sublayer's halo cannot claim the place of another label. The
          // number of halos is capped (see getLabelHalos), so the work stays linear in the rows.
          layers.push(
            ...placeSymbolPart(
              new LabelTextLayer({
                ...this.getSubLayerProps({id: `text${idSuffix}`}),
                ...textProps,
                outlineWidth: 0,
                getColor: [0, 0, 0, 0],
                getText,
                updateTriggers: {...updateTriggers, getText: getTextTrigger, all: groupTrigger}
              }),
              collision.text,
              textBlocks
            ),
            ...halos.map(
              (halo, haloIndex) =>
                new LabelTextLayer({
                  ...this.getSubLayerProps({id: `text${idSuffix}-${haloIndex + 1}`}),
                  ...textProps,
                  outlineWidth: halo?.outlineWidth ?? 0,
                  outlineColor: (halo?.outlineColor ?? [0, 0, 0, 0]) as any,
                  textHaloBlurGamma: halo?.outlineBlur ?? 0,
                  // Text that ignores the collision map draws wherever it is; tested text is
                  // filtered by the placing sublayer's marks, without drawing into the map.
                  collisionEnabled: collision.text.tested,
                  getCollisionPriority: MASKED_COLLISION_PRIORITY,
                  // The background box is only drawn for the collision pass.
                  background: false,
                  // `rowHalos` is in `labelData` order, the reverse of `getRows`.
                  getText: (row: LabelRow, info: {index: number}) =>
                    rowHalos[rowCount - 1 - info.index] === haloIndex
                      ? getText(row, info)
                      : undefined,
                  updateTriggers: {
                    ...updateTriggers,
                    getText: [...getTextTrigger, this.state.haloKey?.[1]],
                    all: groupTrigger
                  }
                })
            )
          );
        }
        if (!textBlocks && (collision.text.tested || collision.icon.tested)) {
          layers.push(
            this.renderAnchorLayer(idSuffix, getCollisionPriority, {
              getCollisionPriority: updateTriggers.getCollisionPriority,
              all: groupTrigger
            })
          );
        }
      }
    }

    return layers;
  }
}
