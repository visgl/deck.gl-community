import {CompositeLayer} from '@deck.gl/core';
import {isGlobeViewport} from '@deck.gl-community/geo-layers';
import type {DefaultProps, Layer, LayerContext, UpdateParameters, Viewport} from '@deck.gl/core';
import {
  acquireSharedLabelPlacement,
  getSharedLabelPlacementKey,
  LabelPlacement,
  LabelPlacementExtension,
  releaseSharedLabelPlacement,
  type PlacementLayer,
  type PlacementShape,
  type PlacementSymbol,
  PLACEMENT_VIEWPORT_PADDING,
  type SymbolPlacementRules
} from './label-placement';
import type {OverlapMode} from './grid-index';
import {GeoJsonLayer, IconLayer} from '@deck.gl/layers';
import {LabelTextLayer} from './label-text-layer';
import type {LabelTextJustify} from './label-text-layer';
import {SharedTextureSet} from './shared-texture';
import {isSameList} from './util';
import {getZoomBucket, withOpacity} from './style-accessor';
import {
  getCompiledStyleProperty,
  getStylePropertyDefault,
  type CompiledStyleProperty
} from './style-expression';
import {getSpriteImageNames, resolveSpriteIcon, warnMissingIcon} from './sprite';
import type {ResolvedSpriteIcon, SpriteAtlas} from './sprite';
import {GlobeHorizonExtension} from './globe-horizon-extension';
import {GlobeLineAngleExtension} from './globe-line-angle-extension';
import {DEFAULT_TEXT_FONT, getTextLayerFontWeight, resolveLabelFont} from './text-font';
import {getHaloBlurGamma, TextHaloBlurExtension} from './text-halo-blur-extension';
import {
  GLYPH_FONT_SETTINGS,
  getGlyphCharacterMeasurer,
  getGlyphFontRenderer
} from './glyph-font-renderer';
import type {GlyphStore} from './glyph-store';
import {
  getPathCircles,
  needsFlip,
  placeLineGlyphs,
  type LabelLine,
  type LineGlyphs
} from './line-glyphs';
import {
  allowsLetterSpacing,
  canMeasureText,
  forgetCharacterWidths,
  getCharacterWidthsRevision,
  getCharacterWidthMeasurer,
  orderBidirectionalText,
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
  /** For labels along a line: the line, along which their glyphs are placed (see `getLineGlyphs`). */
  line?: RowLine;
  /**
   * With `text-variable-anchor`, a point label has a row per anchor, in order, one after the other
   * in `labelData`: the index of this row's anchor (0, the default, for the first row, which also
   * draws the icon) and the number of anchors.
   */
  textAnchorIndex?: number;
  textAnchorCount?: number;
};

/**
 * The line a row's label is placed along: its vertices in pixels at the placement zoom (shared by
 * every row on the line), where the anchor lies on it, and that zoom.
 */
type RowLine = LabelLine & {zoom: number};

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
   * `[min, max)`: this layer's band in its style. `BasemapLayer` gives each symbol style layer its
   * own band, rising with style order; labels are placed from the highest band down (see
   * `LabelPlacement`).
   */
  collisionPriorityRange?: [number, number];
  /** Text size units forwarded to `TextLayer`. */
  labelSizeUnits?: 'pixels' | 'meters' | 'common';
  /**
   * Overrides the font derived from the style layer's `text-font`: a CSS family list, or a
   * function from the `text-font` names to a family list or {@link LabelFont} fields.
   */
  fontFamily?: LabelFontFamily | null;
  /**
   * The glyphs of the style's `glyphs` URL, which labels are drawn with, as in MapLibre GL JS. A
   * tile's labels are placed once the glyphs of their text have loaded. Without it, labels are
   * drawn with the browser's fonts that `text-font` maps to.
   */
  glyphs?: GlyphStore | null;
  /** Enables billboard rendering in the text sublayer. */
  billboard?: boolean;
  /** When `true`, renders the source geometries for debugging. */
  renderGeometry?: boolean;
  /** Additional extension instances passed through to the text sublayer. */
  extensions?: any[];
  /** Active basemap mode. */
  mode?: 'map' | 'globe';
  /**
   * The placement shared with the other label layers of the map, which decides which labels and
   * icons are drawn (see {@link LabelPlacement}). Label layers without one share one per deck.
   */
  labelPlacement?: LabelPlacement | null;
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
  /** The text and font the glyphs were loaded for (see `getGlyphKey`). */
  glyphKey: string;
  /** The tile the rows report when picked (see `LabelTile.tile`). */
  tile: unknown;
  rows: LabelRow[];
  /** The font stacks of the rows' text, which the layer retains in its glyph store. */
  fontStacks: ReadonlySet<string>;
  /**
   * The glyph store's `generation` when it refused to retain a font stack of the tile's text, whose
   * labels are then left out of the rows; the rows are placed again once it has changed.
   */
  refusedGeneration?: number;
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
 * Draw parameters of the text, icon and anchor mark sublayers. Labels draw over the map without a depth test.
 * Their screen-space quads wind clockwise, so `GlobeView`'s default `cullMode: 'back'` would cull
 * every one of them; they are drawn with culling off, in every view.
 */
const LABEL_PARAMETERS = {depthTest: false, cullMode: 'none'} as const;

/**
 * Without a depth test, labels on the far side of a globe would draw through it. This extension
 * hides those whose anchor is beyond the horizon (and `getPlacementSymbols` places none of them).
 */
const GLOBE_HORIZON_EXTENSION = new GlobeHorizonExtension();

/** Draws each label sublayer's objects where the shared placement placed them. */
const LABEL_PLACEMENT_EXTENSION = new LabelPlacementExtension();

/** `text-overlap` / `icon-overlap`, or `*-allow-overlap` where that is unset, as MapLibre reads them. */
function getOverlapMode(overlap: unknown, allowOverlap: unknown): OverlapMode {
  if (overlap === 'always' || overlap === 'never' || overlap === 'cooperative') {
    return overlap;
  }
  return allowOverlap ? 'always' : 'never';
}

/**
 * The box `[x1, y1, x2, y2]` around a box turned by `degrees` counter-clockwise about 0, 0, then
 * taken to the screen by `toScreen` (see `getMapPlaneToScreen`) when it is drawn in the map plane.
 */
function getTurnedBounds(box: number[], degrees: number, toScreen?: number[] | null): number[] {
  if (!degrees && !toScreen) {
    return box;
  }
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [ax, ay, bx, by] = toScreen || [1, 0, 0, 1];
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of [
    [box[0], box[1]],
    [box[2], box[1]],
    [box[0], box[3]],
    [box[2], box[3]]
  ]) {
    // Screen y points down, so a counter-clockwise turn is negative there.
    const mx = x * cos + y * sin;
    const my = -x * sin + y * cos;
    const tx = mx * ax + my * bx;
    const ty = mx * ay + my * by;
    x1 = Math.min(x1, tx);
    y1 = Math.min(y1, ty);
    x2 = Math.max(x2, tx);
    y2 = Math.max(y2, ty);
  }
  return [x1, y1, x2, y2];
}

/**
 * How a pixel offset in the map plane at common-space point `common` (on the screen at `sx, sy`)
 * lands on the screen, as deck.gl draws a layer with `billboard: false`: the offset is taken to
 * common space at the view's scale, with y up, and projected. Writes the screen step of a pixel to
 * the right and of a pixel down in the map plane, `[ax, ay, bx, by]`, to `out`.
 */
function getMapPlaneToScreen(
  viewport: any,
  common: number[],
  sx: number,
  sy: number,
  out: number[]
): void {
  const m = viewport.pixelProjectionMatrix as number[];
  const step = 1 / (viewport.scale || 1);
  const project = (cx: number, cy: number, cz: number, index: number) => {
    const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
    out[index] = (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w - sx;
    out[index + 1] = (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w - sy;
  };
  project(common[0] + step, common[1], common[2], 0);
  project(common[0], common[1] - step, common[2], 2);
}

/**
 * The direction a globe view draws a direction on the map in, at `lngLat`: `radians`
 * counter-clockwise from east there, to counter-clockwise on the screen (y up), as
 * `GlobeLineAngleExtension` turns a billboard along a line to it. With `keepUpright`, a direction
 * that points left is turned by another half turn, as the extension keeps labels upright.
 */
function getGlobeDrawnAngle(
  viewport: any,
  lngLat: number[],
  radians: number,
  keepUpright: boolean
): number {
  const [lng, lat] = lngLat;
  const step = 1e-4;
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 1e-6);
  const [ax, ay] = viewport.project([lng, lat]);
  const [bx, by] = viewport.project([
    lng + (step * Math.cos(radians)) / cosLat,
    lat + step * Math.sin(radians)
  ]);
  const dx = bx - ax;
  const angle = Math.atan2(ay - by, dx);
  return keepUpright && dx < 0 ? angle + Math.PI : angle;
}

/** What placement needs of a label layer's rows that does not change with the view. */
type PlacementGeometry = {
  key: unknown[];
  rules: SymbolPlacementRules;
  /**
   * Indices into `labelData`, in placement order. A label with variable anchors is placed from its
   * first row, and its other rows follow it (see `LabelRow.textAnchorIndex`).
   */
  order: number[];
  textBoxes: Float64Array;
  /** Each row's `text-offset` in pixels, `x, y`, which its text box includes. */
  textOffsets: Float64Array;
  iconBoxes: Float64Array;
  textPadding: number;
  /** See `getPlacementCommons`. */
  commons?: {kind: string; positions: Float64Array};
};

/** A tile's place in MapLibre's placement order: deeper tiles first, then by x, then y. */
function compareTiles(a: any, b: any): number {
  const ia = a?.index;
  const ib = b?.index;
  if (!ia || !ib) {
    return 0;
  }
  return ib.z - ia.z || ia.x - ib.x || ia.y - ib.y;
}

/** Turn billboards along lines on a globe as the view draws the lines (`getLineAngleExtensions`). */
const GLOBE_LINE_ANGLE_EXTENSIONS = {
  upright: new GlobeLineAngleExtension({keepUpright: true}),
  free: new GlobeLineAngleExtension({keepUpright: false}),
  // Text kept upright turns around without its `text-offset` (see `withLineDirection`).
  uprightText: new GlobeLineAngleExtension({keepUpright: true, keepOffsetSide: true})
};

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

/**
 * MapLibre GL JS's shift of the vertical offset of variable anchors, in ems: the offset is to the
 * edge of the text box horizontally, but to the glyphs' baseline vertically, which MapLibre takes
 * to be 7 of the 24 units of an em from the box's edge (`variable_text_anchor.ts`).
 */
const VARIABLE_ANCHOR_BASELINE = 7 / 24;

/** A label anchor with variable anchors: the anchor, and its offset in ems of `text-size`. */
export type TextAnchorOffset = {anchor: string; offset: [number, number]};

/**
 * The offset of text at `anchor`, in ems, from `text-radial-offset` (`radial`) or from the size of
 * `text-offset`, as MapLibre GL JS's `evaluateVariableOffset`: away from the anchor point, in the
 * anchor's direction, with the vertical baseline shift.
 */
export function getVariableAnchorOffset(
  anchor: string,
  offset: number[],
  radial: boolean
): [number, number] {
  const [ax, ay] = ANCHOR_FRACTIONS[anchor] || ANCHOR_FRACTIONS.center;
  let x: number;
  let y: number;
  if (radial) {
    const distance = Math.max(0, Number(offset[0]) || 0);
    // A corner anchor is offset along the diagonal.
    const along = ax && ay ? distance / Math.SQRT2 : distance;
    x = ax ? along : 0;
    y = ay ? along : 0;
  } else {
    x = ax ? Math.abs(Number(offset[0]) || 0) : 0;
    y = ay ? Math.abs(Number(offset[1]) || 0) : 0;
  }
  // `left` (ax < 0) moves the text right of the point, `top` (ay < 0) below it.
  return [
    ax < 0 ? x : ax > 0 ? -x : 0,
    ay < 0 ? y - VARIABLE_ANCHOR_BASELINE : ay > 0 ? -y + VARIABLE_ANCHOR_BASELINE : 0
  ];
}

type MVTLabelLayerState = {
  /** The placement this layer registered with, and its own when it has none from its props. */
  placement?: LabelPlacement | null;
  /**
   * What the placement holds for this layer. deck.gl makes a new layer instance at each render
   * and hands it the same state, so the placement holds this object, which points at the
   * current instance.
   */
  placementHandle?: PlacementLayer & {layer: MVTLabelLayer};
  /** The deck whose shared placement this layer uses, without a `labelPlacement` prop. */
  sharedPlacementKey?: object | null;
  /** The shared placement of `sharedPlacementKey`. */
  sharedPlacement?: LabelPlacement | null;
  /** The first of this layer's placement slots, one per row in `getRows` order. */
  placementSlotBase?: number;
  /** Changes with every update, so a placement made before it is made again. */
  placementRevision?: number;
  /**
   * Changes whenever the rows change, and with them the slot of each symbol, so that the placement
   * places them at once (see `PlacementLayer.getPlacementSlotRevision`).
   */
  placementSlotRevision?: number;
  /** The rows `placementSlotRevision` was counted for. */
  placementSlotRows?: LabelRow[];
  /** See `getPlacementGeometry`. */
  placementGeometry?: PlacementGeometry;
  placementRowBoxes?: {key: unknown[]; boxes: WeakMap<LabelRow, Float64Array>};
  placementCommons?: {kind: string; positions: WeakMap<LabelRow, number[]>};
  /** The slot accessor of `getRows` from `placementSlotBase` (see `getPlacementSlotAccessor`). */
  placementSlots?: {rows: LabelRow[]; base: number; accessor: (row: LabelRow) => number};
  /** Flattened label rows generated from the current tile data. */
  labelData?: LabelRow[];
  /** `labelData` in reverse, the order every text and icon sublayer holds it in (see `getRows`). */
  textRows?: {source: LabelRow[]; rows: LabelRow[]};
  /** The non-data inputs `labelData` was computed with; a change recomputes it. */
  anchorKey?: string;
  /** The text and font `labelData`'s glyphs were loaded for (see `getGlyphKey`). */
  glyphKey?: string;
  /** The map bearing, in `BEARING_STEP` steps, that upright line labels were turned for. */
  bearingStep?: number;
  /** 1 while the layer waits for glyphs of the labels' text to load (see `hasLabelGlyphs`). */
  glyphLoads?: number;
  /** The glyph store the layer waits on while `glyphLoads` is 1. */
  glyphLoadStore?: unknown;
  /**
   * The glyph store's `generation` when it refused a font stack of `labelData`'s text, for a
   * layer of one tile's `data` (see `TileRows.refusedGeneration`).
   */
  refusedGeneration?: number;
  /** The CSS font of labels along lines last seen loading; see `isLineTextFontLoading`. */
  loadingFont?: string;
  /**
   * Each row's glyphs along its line, with what they were placed for, by the id of the view they
   * were placed in, the first view placed in first (see `getLineGlyphs`).
   */
  lineGlyphs?: Map<string, WeakMap<LabelRow, {key: string; placements: RowGlyphPlacements | null}>>;
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
  /**
   * Style property values by compiled property, for the zoom step they were evaluated at, by
   * feature (see `evaluateStyleProperty`).
   */
  styleValues?: WeakMap<
    CompiledStyleProperty,
    {zoom: number; values: WeakMap<FeatureLike, unknown>}
  >;
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

const GLYPH_FONT_RENDERER_FACTORIES = new WeakMap<GlyphStore, Map<string, () => unknown>>();

/** `TextLayer`'s `_getFontRenderer` for a font stack of a glyph store, the same each time. */
function getGlyphFontRendererFactory(glyphs: GlyphStore, fontStack: string): () => unknown {
  let factories = GLYPH_FONT_RENDERER_FACTORIES.get(glyphs);
  if (!factories) {
    factories = new Map();
    GLYPH_FONT_RENDERER_FACTORIES.set(glyphs, factories);
  }
  let factory = factories.get(fontStack);
  if (!factory) {
    factory = () => getGlyphFontRenderer(glyphs, fontStack);
    factories.set(fontStack, factory);
  }
  return factory;
}

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
 * pixels, in an atlas of `fontSize` pixels per em. An atlas pixel is `textSize / fontSize` screen pixels, so the same halo needs a wider
 * outline on smaller text. As in MapLibre, the halo is at most a quarter of the text size.
 */
export function getOutlineWidth(
  haloWidth: number,
  textSize: number,
  fontSize: number = LABEL_FONT_SETTINGS.fontSize
): number {
  const atlasPixels = (Math.min(haloWidth, textSize / 4) * fontSize) / textSize;
  // Rounded so that labels whose halos differ imperceptibly share one text sublayer.
  return Math.round((atlasPixels / SDF_OUTLINE_SCALE) * 100) / 100;
}

/**
 * Glyphs along lines are placed again whenever the zoom crosses a step of `1 / LINE_GLYPH_ZOOM_STEPS`:
 * between steps, the line is scaled by less than 0.6% under its text.
 */
const LINE_GLYPH_ZOOM_STEPS = 128;

/**
 * A row's glyphs along its line: `dx, dy, angle, mode` per character (see `LineGlyphPlacement`),
 * and the path its collision circles follow, `x, y` pixels from the anchor, or null when the text
 * does not fit on the line unturned. Text that must turn but does not fit turned keeps the unturned
 * path, with every glyph hidden.
 */
type RowLineGlyphs = {glyphs: Float32Array; path: number[] | null};

/**
 * A row's glyphs along its line at one zoom step, both ways round: `layout` is the unturned
 * placement (null when the text does not fit on the line), from which `getLineGlyphs` decides which
 * way the label reads; `turned` is null when `text-keep-upright` never turns it.
 */
type RowGlyphPlacements = {
  count: number;
  layout: LineGlyphs | null;
  unturned: RowLineGlyphs;
  turned: RowLineGlyphs | null;
};

/**
 * Work done placing glyphs along lines, for benchmarks: rows placed, cached placements reused and
 * collision paths taken to the screen.
 */
export const LINE_GLYPH_STATS = {rows: 0, cacheHits: 0, placementPaths: 0};

/** The most views a label layer keeps the glyphs along lines of, as a main map and a minimap. */
const MAX_LINE_GLYPH_VIEWS = 4;

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
 * `getPixelOffset` for text turned to the line it is placed along. MapLibre moves such text by
 * `text-offset` along and across the line's own direction, so the offset stays on the same side
 * of the line when `text-keep-upright` turns the text around. `TextLayer` adds the pixel offset
 * after turning the text, so the offset is turned here, by the line's direction.
 */
function withLineDirection(
  getPixelOffset: (row: LabelRow, info: {index: number}) => [number, number],
  turnsWithLine: boolean
): (row: LabelRow, info: {index: number}) => [number, number] {
  return turnsWithLine
    ? (row, info) => rotatePixelOffset(getPixelOffset(row, info), row.angle ?? 0)
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

/** The rows whose `part` (text or icon) is drawn by the same sublayers, with the same collision. */
type SymbolPartGroup = {
  /** Appended to the ids of the group's sublayers. */
  idSuffix: string;
  /** Per row, whether the row is in the group; `null` when every row is. */
  rows: boolean[] | null;
};

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
    fontFamily: null,
    glyphs: null
  };

  /** Current label-row state. */
  state: MVTLabelLayerState = undefined!;

  /** Not loaded while the glyphs of its labels load: their tiles are not labelled yet. */
  get isLoaded(): boolean {
    return super.isLoaded && !this.state?.glyphLoads;
  }

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
   * The image name `icon-image` gives a feature, with its tokens resolved: empty for none. While the
   * sprites load, an `["image", ...]` expression still names its image, which is not available yet.
   */
  getIconImageName(feature: FeatureLike): string {
    const iconImage = this.getStyleProperty('icon-image');
    if (!iconImage) {
      return '';
    }
    const value = iconImage.evaluate(
      getZoomBucket(this.props.zoom || 0),
      feature,
      getSpriteImageNames(this.props.spriteAtlases)
    );
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['icon-image']);
    return value === null || value === undefined
      ? ''
      : isExpression || iconImage.isFeatureDependent
        ? String(value)
        : resolveTokenString(String(value), feature.properties) || '';
  }

  /**
   * Resolves `icon-image` for a feature against the loaded sprites. Legacy `{token}` names are
   * resolved as in `text-field`. Returns `null`, and warns once per name, when no sprite has it.
   */
  getIcon(feature: FeatureLike): ResolvedSpriteIcon | null {
    const name = this.getIconImageName(feature);
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

  /**
   * Text pixel offset from `text-offset`, which is in ems of `text-size`, or from a non-zero
   * `text-radial-offset`, which MapLibre GL JS takes instead, in the direction of `text-anchor`.
   * A layer with variable anchors takes its offset from its anchor at placement, which MapLibre
   * does only for point labels, so its line labels have none.
   */
  getLabelPixelOffset(feature: FeatureLike): [number, number] {
    if (
      this.getStyleProperty('text-variable-anchor-offset') ||
      this.getStyleProperty('text-variable-anchor')
    ) {
      return [0, 0];
    }
    const size = this.getLabelSize(feature);
    const radial = Number(this.evaluateStyleProperty('text-radial-offset', feature)) || 0;
    if (radial) {
      const anchor = String(this.evaluateStyleProperty('text-anchor', feature) ?? 'center');
      const [x, y] = getVariableAnchorOffset(anchor, [radial], true);
      return [x * size, y * size];
    }
    const offset = this.evaluateStyleProperty('text-offset', feature) as number[] | undefined;
    if (!offset) {
      return [0, 0];
    }
    return [offset[0] * size, offset[1] * size];
  }

  /**
   * The anchors a point label tries, in order, with their offsets in ems, from
   * `text-variable-anchor-offset`, or from `text-variable-anchor` with `text-radial-offset` (when
   * the layer sets it) or `text-offset`, as MapLibre GL JS's `getTextVariableAnchorOffset`; `null`
   * without variable anchors or along lines.
   */
  getTextAnchors(feature: FeatureLike, placement?: string): TextAnchorOffset[] | null {
    if (
      (!this.getStyleProperty('text-variable-anchor-offset') &&
        !this.getStyleProperty('text-variable-anchor')) ||
      isLinePlacement(placement ?? this.getSymbolPlacement())
    ) {
      return null;
    }
    const anchorOffsets = this.evaluateStyleProperty('text-variable-anchor-offset', feature);
    if (Array.isArray(anchorOffsets) && anchorOffsets.length >= 2) {
      const result: TextAnchorOffset[] = [];
      for (let i = 0; i + 1 < anchorOffsets.length; i += 2) {
        const anchor = String(anchorOffsets[i]);
        const [x = 0, y = 0] = (anchorOffsets[i + 1] as number[]) || [];
        const baseline = anchor.startsWith('top')
          ? -VARIABLE_ANCHOR_BASELINE
          : anchor.startsWith('bottom')
            ? VARIABLE_ANCHOR_BASELINE
            : 0;
        result.push({anchor, offset: [Number(x) || 0, (Number(y) || 0) + baseline]});
      }
      return result;
    }
    const anchors = this.evaluateStyleProperty('text-variable-anchor', feature);
    if (!Array.isArray(anchors) || !anchors.length) {
      return null;
    }
    // The style spec says not to set both offsets; MapLibre takes the radial one when it is set.
    const radial = Boolean(this.getStyleProperty('text-radial-offset'));
    const offset = radial
      ? [Number(this.evaluateStyleProperty('text-radial-offset', feature)) || 0]
      : ((this.evaluateStyleProperty('text-offset', feature) as number[] | undefined) ?? [0, 0]);
    return anchors.map(anchor => ({
      anchor: String(anchor),
      offset: getVariableAnchorOffset(String(anchor), offset, radial)
    }));
  }

  /** The variable anchor a row's label is drawn at (see `LabelRow.textAnchorIndex`), or `null`. */
  getRowTextAnchor(row: LabelRow): TextAnchorOffset | null {
    const anchors = this.getTextAnchors((row as any).__source?.object ?? row);
    return anchors ? anchors[Math.min(row.textAnchorIndex ?? 0, anchors.length - 1)] : null;
  }

  /** The `text-anchor` a row's label is drawn at: its variable anchor, or the feature's. */
  getRowAnchor(row: LabelRow): string {
    const variable = this.getRowTextAnchor(row);
    return variable
      ? variable.anchor
      : String(this.evaluateStyleProperty('text-anchor', (row as any).__source?.object ?? row));
  }

  /** A row's text pixel offset: its variable anchor's, or the feature's (`getLabelPixelOffset`). */
  getRowPixelOffset(row: LabelRow): [number, number] {
    const feature = (row as any).__source?.object ?? row;
    const variable = this.getRowTextAnchor(row);
    if (!variable) {
      return this.getLabelPixelOffset(feature);
    }
    const size = this.getLabelSize(feature);
    // MapLibre GL JS shifts the text by half its padded box (`calculateVariableLayoutShift`), so
    // `text-padding` moves the text away from the point too.
    const [ax, ay] = ANCHOR_FRACTIONS[variable.anchor] || ANCHOR_FRACTIONS.center;
    const padding = 2 * this.getTextPadding();
    return [variable.offset[0] * size - ax * padding, variable.offset[1] * size - ay * padding];
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
   * an icon has the same row index, and so the same placement slot, as its own label. Rows whose
   * icon is in another sprite, or in none, draw nothing.
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
    const {props: angleProps, getAngle, extensions: angleExtensions} = this.getIconAngleProps();
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
    return groups.flatMap(({idSuffix, rows}) =>
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
            LABEL_PLACEMENT_EXTENSION,
            GLOBE_HORIZON_EXTENSION,
            ...angleExtensions
          ],
          ...this.getPlacementProps(1),
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
            getPlacementSlot: this.state.placementSlotBase,
            // The sprite list decides which rows `icon-image` resolves into this sprite, and which
            // rows have text decides the group's rows. The latter's change between split and
            // unsplit groups also refreshes the rows masked out before.
            all: [atlas, spriteAtlases, rows ? this.getLabelUpdateTriggers().getText : null]
          }
        });
        return [layer];
      })
    );
  }

  /**
   * The label rows in the order every text and icon sublayer holds them: `labelData` in reverse.
   * A symbol's placement slot follows its index here, so an icon and its label share it; every
   * per-row array that these sublayers index (row icons, rows with text) is in this order.
   * Placement walks `labelData`, in feature order (see `getPlacementSymbols`).
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
    // A label with variable anchors draws its icon from its first row only.
    return rows.map(row =>
      row.textAnchorIndex ? null : this.getIcon((row as any).__source?.object ?? row)
    );
  }

  /**
   * The groups of rows each part is drawn by: one group of every row, since placement decides per
   * symbol which parts draw (see `LabelPlacement`).
   */
  getSymbolPartGroups(_part: 'text' | 'icon', _hasOtherPart: () => boolean[]): SymbolPartGroup[] {
    // Placement decides per symbol; every row is drawn by one sublayer per part.
    return [{idSuffix: '', rows: null}];
  }

  /** Returns a compiled `layout` or `paint` property of the style layer, if it sets one. */
  private getStyleProperty(propertyName: string): CompiledStyleProperty | null {
    const {styleLayer} = this.props;
    return styleLayer ? getCompiledStyleProperty(styleLayer, propertyName) : null;
  }

  /**
   * Evaluates a style property for a feature at the stepped zoom (`getZoomBucket`). The value is
   * kept for the feature until the zoom step or the property changes: a `tiles` layer makes its
   * rows again whenever a tile is shown or hidden, and the rows of the other tiles keep their
   * features, so their values are not evaluated again.
   */
  private evaluateStyleProperty(propertyName: string, feature: FeatureLike): unknown {
    const property = this.getStyleProperty(propertyName);
    if (!property) {
      return undefined;
    }
    const zoom = getZoomBucket(this.props.zoom || 0);
    if (!this.state || !feature || typeof feature !== 'object') {
      return property.evaluate(zoom, feature);
    }
    this.state.styleValues ||= new WeakMap();
    let cache = this.state.styleValues.get(property);
    if (!cache || cache.zoom !== zoom) {
      cache = {zoom, values: new WeakMap()};
      this.state.styleValues.set(property, cache);
    }
    if (cache.values.has(feature)) {
      return cache.values.get(feature);
    }
    const value = property.evaluate(zoom, feature);
    cache.values.set(feature, value);
    return value;
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
   * The `text-font` stack of a feature's label as glyph URLs name it, its fonts joined by commas:
   * of the first label row's feature when none is given, as `getFont`.
   */
  getFontStack(feature?: FeatureLike): string {
    const textFont = this.getStyleProperty('text-font');
    const row = this.state?.labelData?.[0] as
      | (LabelRow & {__source?: {object: FeatureLike}})
      | undefined;
    const value = textFont?.evaluate(
      getZoomBucket(this.props.zoom || 0),
      feature || row?.__source?.object
    );
    return (Array.isArray(value) && value.length ? value.map(String) : DEFAULT_TEXT_FONT).join(',');
  }

  /** `TextLayer`'s font atlas settings: of the style's glyphs, or of the browser's fonts. */
  getFontSettings(): typeof LABEL_FONT_SETTINGS {
    return this.props.glyphs ? GLYPH_FONT_SETTINGS : LABEL_FONT_SETTINGS;
  }

  /** The advance of a character in ems, in the font or glyphs the labels are drawn with. */
  getCharacterMeasurer(): (character: string) => number {
    const {glyphs} = this.props;
    if (glyphs) {
      return getGlyphCharacterMeasurer(glyphs, this.getFontStack());
    }
    const font = this.getFont();
    return getCharacterWidthMeasurer(getTextLayerFontWeight(font), font.fontFamily);
  }

  /**
   * `TextLayer`'s font props: the style's glyphs of the layer's font stack, drawn by their own
   * font renderer into an atlas of their own, or the CSS font.
   */
  getFontProps(font: LabelFont = this.getFont()): Record<string, unknown> {
    const {glyphs} = this.props;
    if (glyphs) {
      const fontStack = this.getFontStack();
      return {
        // MapLibre GL JS samples its 24 px glyphs without mipmaps.
        atlasMipLevels: 1,
        // and smooths their edges over the same device pixels at every text size.
        edgeGammaCapped: false,
        fontSettings: GLYPH_FONT_SETTINGS,
        // The atlas's cache key: deck.gl keys font atlases by their font and settings, not by
        // `_getFontRenderer`. The store's id keeps a new store for the same URL from drawing with
        // the atlas of the old one; layers of one store share its atlases.
        fontFamily: `glyphs ${glyphs.id} ${glyphs.url} ${fontStack}`,
        fontWeight: 400,
        _getFontRenderer: getGlyphFontRendererFactory(glyphs, fontStack)
      };
    }
    return {
      fontSettings: LABEL_FONT_SETTINGS,
      fontFamily: font.fontFamily,
      fontWeight: getTextLayerFontWeight(font)
    };
  }

  /**
   * What the label text is drawn with: the font stack of the style's glyph store, or the CSS font.
   * A new store for the same URL may hold other glyphs, so text is measured again with it.
   */
  getFontKey(): string {
    const {glyphs} = this.props;
    return glyphs
      ? `${glyphs.id}|${glyphs.url}|${this.getFontStack()}`
      : JSON.stringify(this.getFont());
  }

  /**
   * The inputs that choose the glyphs of the label text: the glyph store, as a new one for the same
   * URL has none of the old one's glyphs loaded, the style's glyphs, and `text-field`,
   * `text-transform` and `text-font`, with the stepped zoom when any of them depends on zoom.
   * Point anchors do not depend on them, so rows kept for unchanged anchors check their glyphs
   * again when this changes: a zoom step can change the text to another glyph range or font stack.
   */
  getGlyphKey(): string {
    const {glyphs} = this.props;
    return glyphs
      ? `${glyphs.id}|${glyphs.url}|${this.getStyleUpdateTrigger('text-field', 'text-transform', 'text-font')}`
      : '';
  }

  /**
   * `features` without those whose label text is in a font stack of `refused` (see
   * `hasLabelGlyphs`). Their rows are left out rather than drawn without glyphs: `TextLayer` would
   * draw their characters into the font atlas as empty cells, and keep drawing them so once the
   * store retains the font stack and its glyphs load.
   */
  withoutRefusedLabels(features: FeatureLike[], refused: ReadonlySet<string>): FeatureLike[] {
    return refused.size
      ? features.filter(
          feature =>
            !this.getUnwrappedLabelText(feature) || !refused.has(this.getFontStack(feature))
        )
      : features;
  }

  /**
   * Whether the glyphs of the label text of `features` have loaded, with the style's glyphs. When
   * they have not, they are requested, and the layer updates once they have, as MapLibre GL JS
   * places a tile's symbols once their glyphs have loaded.
   *
   * The layer retains the font stack of each feature's text in the store, before it loads any,
   * and adds it to `fontStacks`: loading the glyphs of some font stacks then cannot drop those of
   * others that the layer draws or waits for. A feature whose font stack the store will not
   * retain (see `GlyphStore.retain`) is not waited for: its label is left undrawn, as that of a
   * glyph range that fails to load, so that the labels of the other features settle. Its font
   * stack is added to `refused`, and its row left out (see `withoutRefusedLabels`).
   */
  hasLabelGlyphs(
    features: FeatureLike[],
    fontStacks: Set<string>,
    refused: Set<string> = new Set()
  ): boolean {
    const {glyphs} = this.props;
    if (!glyphs || !this.getStyleProperty('text-field')) {
      return true;
    }
    const texts = new Map<string, string[]>();
    for (const feature of features) {
      const text = this.getUnwrappedLabelText(feature);
      if (text) {
        const fontStack = this.getFontStack(feature);
        if (!glyphs.retain(this.state, fontStack)) {
          refused.add(fontStack);
          continue;
        }
        fontStacks.add(fontStack);
        if (!glyphs.hasGlyphs(fontStack, text)) {
          texts.set(fontStack, [...(texts.get(fontStack) || []), text]);
        }
      }
    }
    if (!texts.size) {
      return true;
    }
    const loads: Promise<void>[] = [];
    for (const [fontStack, stackTexts] of texts) {
      const loading = glyphs.load(fontStack, stackTexts);
      if (loading) {
        loads.push(loading);
      }
    }
    // The layer waits for one load at a time: updates meanwhile request what they need, and the
    // update once it has loaded checks again. A new glyph store replaces the wait on the old one,
    // whose loads may never finish.
    const state = this.state;
    if (loads.length && !(state.glyphLoads && state.glyphLoadStore === glyphs)) {
      state.glyphLoads = 1;
      state.glyphLoadStore = glyphs;
      Promise.all(loads).then(() => {
        // Unless the layer was finalized, or given another store, meanwhile.
        if (state.glyphLoadStore !== glyphs) {
          return;
        }
        state.glyphLoads = 0;
        state.glyphLoadStore = undefined;
        if (this.state === state) {
          this.setNeedsUpdate();
        }
      });
    }
    return false;
  }

  /**
   * Extracts the visible label text for a decoded feature. Legacy `{token}` placeholders are
   * resolved only in literal and zoom-function values, as in the style specification.
   * Applies `text-transform` and Arabic shaping, balanced `text-max-width` wrapping for point
   * labels, and the reordering of right-to-left text into the order it is drawn.
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
    let label = this.getUnwrappedLabelText(feature);
    if (label) {
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
              measure = this.getCharacterMeasurer();
            }
            return measure(character) + spacing;
          },
          this.state?.labelText?.budget
        );
      } else {
        // As MapLibre, a label along a line is drawn along it in the order it is read.
        label = orderBidirectionalText(label);
      }
      labels?.set(feature, label);
    }
    return label || undefined;
  }

  /**
   * A feature's label text, with `text-transform` and Arabic shaping applied, before wrapping and
   * in logical order: its code points are those whose glyphs are drawn.
   */
  getUnwrappedLabelText(feature: FeatureLike): string | undefined {
    const textField = this.getStyleProperty('text-field');
    if (!textField) {
      return undefined;
    }
    const value = this.evaluateStyleProperty('text-field', feature);
    const text = value === null || value === undefined ? '' : String(value);
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['text-field']);
    const label =
      isExpression || textField.isFeatureDependent
        ? text.trim()
        : resolveTokenString(text, feature.properties)?.trim();
    return label
      ? transformText(label, this.evaluateStyleProperty('text-transform', feature))
      : undefined;
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
   * The font size a label's collision box is laid out at, as MapLibre GL JS lays it out: `text-size`
   * at the zoom after the tile's, the integer zoom (its `layoutTextSize`). Where `text-size`
   * changes with zoom, the box is that size and not the one drawn: at z3.6, a size that grows with
   * zoom collides at its z4 size.
   */
  getCollisionLabelSize(feature: FeatureLike): number {
    const property = this.getStyleProperty('text-size');
    if (!property?.isZoomDependent) {
      return this.getLabelSize(feature);
    }
    const size = property.evaluate(Math.floor(this.props.zoom || 0) + 1, feature);
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
      outlineWidth: getOutlineWidth(width, size, this.getFontSettings().fontSize),
      outlineBlur: getHaloBlurGamma(
        Math.round(blur / HALO_WIDTH_STEP) * HALO_WIDTH_STEP,
        size,
        this.getFontSettings()
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
      // A layer's slots move when it needs more of them.
      getPlacementSlot: String(this.state?.placementSlotBase ?? -1),
      // Text along a line turns its offset by the line (see `withLineDirection`).
      getPixelOffset: getTrigger(
        'text-offset',
        'text-radial-offset',
        'text-anchor',
        'text-variable-anchor',
        'text-variable-anchor-offset',
        // Labels with variable anchors are moved by their padding too (see `getRowPixelOffset`).
        'text-padding',
        'text-size',
        'text-rotation-alignment',
        'symbol-placement'
      ),
      getAngle: `${this.state?.bearingStep}|${getTrigger('text-keep-upright')}`,
      // Also lays out the lines of each label (see `LabelTextLayer`).
      getTextAnchor: getTrigger(
        'text-anchor',
        'text-variable-anchor',
        'text-variable-anchor-offset',
        'text-justify',
        'symbol-placement'
      ),
      getAlignmentBaseline: getTrigger(
        'text-anchor',
        'text-variable-anchor',
        'text-variable-anchor-offset',
        'symbol-placement'
      )
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
    geographic: boolean = isGlobeViewport(this.context?.viewport),
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
    if (!this.props.glyphs && (!canMeasureText() || this.isLineTextFontLoading())) {
      return getTextLengthEms;
    }
    const measure = this.getCharacterMeasurer();
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
   * measured in pixels at the tile's zoom (see `getLinePlacementScale`), where `symbol-spacing`,
   * `text-max-angle` and the label's `text-letter-spacing` are evaluated. As in MapLibre, the label's length, the window its bends
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
  ): {position: number[]; angle: number; line: RowLine}[] {
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
    // As MapLibre's shaping, the letter spacing follows every character but the last. MapLibre
    // lays symbols out at the tile's zoom, so the spacing is the one at the placement zoom, not
    // at the map's.
    const letterSpacing = text && allowsLetterSpacing(text) ? evaluate('text-letter-spacing') : 0;
    const textLength =
      text && featureBudget.steps > 0
        ? (context.measureText(text) +
            (Array.from(text).length - 1) * (Number.isFinite(letterSpacing) ? letterSpacing : 0)) *
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
        let points: Float64Array | null = null;
        return (
          getLineAnchors(pixels, {...options, isContinued, budget: featureBudget})
            .map(({segment, t, angle}) => {
              const [a, b] = [pixels[segment], pixels[segment + 1]];
              const pixel = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
              // Interpolated in Web Mercator, where the line was measured.
              const position = geographic
                ? worldToLngLat([pixel[0] / scale, pixel[1] / scale])
                : [pixel[0] / scale, pixel[1] / scale];
              // The line's vertices, shared by the rows on it.
              points ||= Float64Array.from(pixels.flat());
              return {position, angle, pixel, line: {points, segment, t, zoom}};
            })
            // Only anchors in the tile count as placed, as MapLibre's lie in the tile.
            .filter(({position}) => !bounds || isInsideBounds(position, bounds))
            .filter(
              ({pixel}) =>
                !repeatDistance || !isNearSameText(context.placed, text!, pixel, repeatDistance)
            )
            .map(({position, angle, line}) => ({position, angle, line}))
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
   * For `symbol-placement: line`, the line features with the same label text whose ends meet,
   * joined as MapLibre does (see `mergeLines`): per feature, the feature with the joined line to
   * place labels along, `null` for a feature joined into another, or `undefined` to place the
   * feature as it is. As in MapLibre, a `MultiLineString` joins by its first line only, and a
   * feature joined into another is dropped whole, with any other lines it has: MapLibre's
   * `mergeLines` takes each feature's `geometry[0]` and keeps the feature of the chain it joins.
   */
  getMergedLines(features: FeatureLike[]): (FeatureLike | null | undefined)[] {
    const lines = features.map(feature => {
      const {type, coordinates} = feature.geometry || {};
      const line =
        type === 'LineString' ? coordinates : type === 'MultiLineString' ? coordinates?.[0] : null;
      return line ? {text: this.getLabelText(feature), line} : {text: null, line: []};
    });
    return mergeLines(lines).map((line, index) => {
      if (line === null) {
        return null;
      }
      const feature = features[index];
      if (line === lines[index].line) {
        return undefined;
      }
      const {type, coordinates} = feature.geometry;
      return {
        ...feature,
        geometry: {
          ...feature.geometry,
          coordinates: type === 'MultiLineString' ? [line, ...coordinates.slice(1)] : line
        }
      };
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
        : this.getLabelAnchors(feature, geographic, placement, budget).flatMap(position => {
            // A row per variable anchor, so that each is laid out and drawn on its own, and
            // placement shows the one it places the label at (see `getPlacementSymbols`).
            const count = this.getTextAnchors(feature, placement)?.length ?? 0;
            if (count < 2) {
              return [this.getSubLayerRow({position}, feature, index)];
            }
            return Array.from({length: count}, (_, textAnchorIndex) =>
              this.getSubLayerRow(
                {position, textAnchorIndex, textAnchorCount: count} as LabelRow,
                feature,
                index
              )
            );
          })
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
      // The number of rows of a point label (see `getLabelData`).
      isLinePlacement(placement)
        ? null
        : this.getStyleUpdateTrigger('text-variable-anchor', 'text-variable-anchor-offset'),
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
              ? this.props.glyphs
                ? [this.getFontKey()]
                : [this.getFont(), this.isLineTextFontLoading()]
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
    viewport: {bearing?: number; projectionMode?: number} | undefined = this.context?.viewport
  ): number {
    if (!viewport || isGlobeViewport(viewport)) {
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
    const geographic = isGlobeViewport(this.context?.viewport);
    return {
      billboard: geographic ? this.props.billboard : false,
      getAngle: (row: LabelRow) => getUprightAngle(row.angle ?? 0, bearingStep, keepUpright)
    };
  }

  /**
   * Whether the glyphs of this layer's labels along lines are each placed on the line, as MapLibre
   * draws them: text turned to lines on a flat map (where it is drawn in the map plane), sized in
   * pixels, on WebGL. Otherwise labels are drawn straight, turned to their anchor's segment. On a
   * globe, labels are billboards turned on screen, and stay straight.
   */
  curvesLineText(viewport: any = this.context?.viewport): boolean {
    if (!viewport || isGlobeViewport(viewport) || this.context?.device?.type === 'webgpu') {
      return false;
    }
    if (this.props.labelSizeUnits !== 'pixels' || !this.getStyleProperty('text-field')) {
      return false;
    }
    const placement = this.getSymbolPlacement();
    const alignment = this.getStyleProperty('text-rotation-alignment')?.evaluate(
      getZoomBucket(this.props.zoom || 0)
    );
    return isLinePlacement(placement) && isAlignedToMap(alignment, placement);
  }

  /** The zoom glyphs along lines are placed at: the viewport's, in `LINE_GLYPH_ZOOM_STEPS`. */
  getGlyphZoom(viewport: any = this.context?.viewport): number {
    return Math.floor((viewport?.zoom || 0) * LINE_GLYPH_ZOOM_STEPS) / LINE_GLYPH_ZOOM_STEPS;
  }

  /**
   * The style inputs of glyphs along lines, besides the row's text and line: the style values,
   * and the revision of the label font's advances (`getCharacterWidthsRevision`).
   */
  getLineGlyphStyleKey(): string {
    return `${this.getLineGlyphStyleTrigger()}|${this.getLineGlyphWidthsRevision()()}`;
  }

  /** The style values glyphs along lines are placed by. */
  getLineGlyphStyleTrigger(): string {
    const triggers = this.getLabelUpdateTriggers();
    return `${triggers.getText}|${triggers.getSize}|${triggers.getPixelOffset}|${triggers.getTextAnchor}|${this.getStyleUpdateTrigger('text-keep-upright')}`;
  }

  /**
   * The revision of the label font's advances, read when called: it changes once the font has
   * loaded with other advances (`forgetCharacterWidths`), maybe as another layer found, without
   * this layer updating.
   */
  getLineGlyphWidthsRevision(): () => number {
    if (this.props.glyphs) {
      // A tile's labels are placed once their glyphs have loaded, which do not change.
      return () => 0;
    }
    const font = this.getFont();
    const fontWeight = getTextLayerFontWeight(font);
    return () => getCharacterWidthsRevision(fontWeight, font.fontFamily);
  }

  /**
   * The text sublayers' `getLineGlyphs` and `getLineGlyphKey` (see `LabelTextLayer`), null when the
   * layer draws its text straight, and the update trigger of the glyphs: the style. The glyphs also
   * change with the view's zoom and bearing steps, and with the label font's advances, which the
   * character layers check when they draw: placement reads the advances' revision anew, so the
   * glyphs drawn follow the glyphs placed without this layer updating.
   */
  getLineGlyphProps(): {
    getLineGlyphs: ((row: LabelRow, viewport: any) => Float32Array | null) | null;
    getLineGlyphKey: ((viewport: any) => string) | null;
    trigger: string;
  } {
    if (!this.curvesLineText()) {
      return {getLineGlyphs: null, getLineGlyphKey: null, trigger: 'straight'};
    }
    const styleTrigger = this.getLineGlyphStyleTrigger();
    const widthsRevision = this.getLineGlyphWidthsRevision();
    return {
      getLineGlyphs: (row, viewport) =>
        this.getLineGlyphs(
          row,
          viewport,
          this.getBearingStep(viewport),
          `${styleTrigger}|${widthsRevision()}`
        )?.glyphs ?? null,
      getLineGlyphKey: viewport =>
        `${this.getGlyphZoom(viewport)}|${this.getBearingStep(viewport)}|${widthsRevision()}`,
      trigger: styleTrigger
    };
  }

  /**
   * Where each glyph of `row`'s label is drawn along its line at `viewport`'s zoom, as MapLibre GL
   * JS's `placeGlyphsAlongLine`: each advance centre on the line, turned to the segment it lands on,
   * the whole label turned around to read upright at `bearingStep` (from its first and last glyph,
   * placed unturned). Null for a row drawn straight: not along a line, or multi-line text. The
   * placements are cached per row for the zoom step and style, both ways round, so that every text
   * sublayer and the placement share them, and a bearing step only checks which way each reads.
   * Each view keeps its own, so that views at different zooms, as a main map and a minimap, do not
   * place the glyphs again in turn.
   */
  getLineGlyphs(
    row: LabelRow,
    viewport: any,
    bearingStep: number,
    styleKey: string
  ): RowLineGlyphs | null {
    const {line} = row;
    if (!line) {
      return null;
    }
    const zoom = this.getGlyphZoom(viewport);
    const key = `${zoom}|${styleKey}`;
    if (!this.state.lineGlyphs) {
      this.state.lineGlyphs = new Map();
    }
    const views = this.state.lineGlyphs;
    const viewId = String(viewport?.id ?? '');
    let cache = views.get(viewId);
    if (!cache) {
      cache = new WeakMap();
      views.set(viewId, cache);
      // The view first placed in is forgotten.
      if (views.size > MAX_LINE_GLYPH_VIEWS) {
        views.delete(views.keys().next().value!);
      }
    }
    let entry = cache.get(row);
    if (entry && entry.key === key) {
      LINE_GLYPH_STATS.cacheHits++;
    } else {
      LINE_GLYPH_STATS.rows++;
      const feature = (row as any).__source?.object ?? row;
      const text = this.getLabel(feature);
      entry = {
        key,
        placements:
          text && !text.includes('\n') ? this.placeRowGlyphs(row, line, feature, text, zoom) : null
      };
      cache.set(row, entry);
    }
    const {placements} = entry;
    if (!placements) {
      return null;
    }
    if (!placements.unturned.path || !placements.turned) {
      return placements.unturned;
    }
    const flip =
      placements.count > 1
        ? needsFlip(placements.layout!, bearingStep)
        : // MapLibre turns a single glyph by its anchor's segment.
          getUprightAngle(row.angle ?? 0, bearingStep, true) !== (row.angle ?? 0);
    return flip ? placements.turned : placements.unturned;
  }

  /**
   * `row`'s glyphs placed along its line at `zoom` (see `getLineGlyphs`): unturned, and turned to
   * read the other way when `text-keep-upright` may turn the label (null otherwise).
   */
  placeRowGlyphs(
    row: LabelRow,
    line: RowLine,
    feature: FeatureLike,
    text: string,
    zoom: number
  ): RowGlyphPlacements {
    const characters = Array.from(text);
    const count = characters.length;
    const size = this.getLabelSize(feature);
    const spacing = this.getLetterSpacing(feature, text) * size;
    const measure = this.getCharacterMeasurer();
    // Advance centres from the anchor, as MapLibre's shaping places them: `text-anchor` across the
    // text, the letter spacing after every character but the last.
    const widths = characters.map(character => measure(character) * size);
    const width = widths.reduce((sum, w) => sum + w, 0) + Math.max(0, count - 1) * spacing;
    const [ax] =
      ANCHOR_FRACTIONS[String(this.evaluateStyleProperty('text-anchor', feature))] ||
      ANCHOR_FRACTIONS.center;
    const offsets = new Float64Array(count);
    let x = -(ax + 0.5) * width;
    for (let i = 0; i < count; i++) {
      offsets[i] = x + widths[i] / 2;
      x += widths[i] + spacing;
    }
    const [lineOffsetX, lineOffsetY] = this.getLabelPixelOffset(feature);
    const options = {offsets, lineOffsetX, lineOffsetY, scale: 2 ** (zoom - line.zoom)};
    const hidden: RowLineGlyphs = {glyphs: new Float32Array(count * 4), path: null};
    for (let i = 0; i < count; i++) {
      hidden.glyphs[i * 4 + 3] = -1;
    }
    const layout = placeLineGlyphs(line, {...options, flip: false});
    if (!layout) {
      return {count, layout: null, unturned: hidden, turned: null};
    }
    const keepUpright =
      (this.getStyleProperty('text-keep-upright')?.evaluate(getZoomBucket(this.props.zoom || 0)) ??
        getStylePropertyDefault('text-keep-upright')) !== false;
    const turned = keepUpright ? placeLineGlyphs(line, {...options, flip: true}) : null;
    // MapLibre's collision circles follow the unturned placement, whichever way the label reads.
    // A label that must turn but does not fit turned is not drawn, yet still takes the room of its
    // unturned circles: MapLibre places it by those, and hides its glyphs only when drawing.
    const toRow = (placed: LineGlyphs | null): RowLineGlyphs => {
      if (!placed) {
        return {glyphs: hidden.glyphs, path: layout.path};
      }
      const glyphs = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) {
        glyphs[i * 4] = placed.glyphs[i * 3];
        glyphs[i * 4 + 1] = placed.glyphs[i * 3 + 1];
        glyphs[i * 4 + 2] = placed.glyphs[i * 3 + 2];
        glyphs[i * 4 + 3] = 1;
      }
      return {glyphs, path: layout.path};
    };
    return {
      count,
      layout,
      unturned: toRow(layout),
      turned: keepUpright ? toRow(turned) : null
    };
  }

  /**
   * The extensions that keep billboards along lines on their lines on a globe. A globe draws them
   * in screen space, at angles taken from north up, so the shader turns them by the direction the
   * view draws the line in, at every frame, and upright with `keepUpright`: there the bearing
   * alone does not tell which way they read. A flat map draws them in the map plane. The shader
   * keeps an angle upright only when it is the line's direction: icons turned by `icon-rotate` are
   * kept upright from north up, by their angles. Text keeps its `text-offset` on its side of the
   * line as it turns around.
   */
  getLineAngleExtensions(
    turnsWithLine: boolean,
    keepUpright: 'text-keep-upright' | 'icon-keep-upright',
    isLineDirection = true
  ): GlobeLineAngleExtension[] {
    const isGlobeBillboard = isGlobeViewport(this.context?.viewport) && this.props.billboard;
    if (!turnsWithLine || !isGlobeBillboard) {
      return [];
    }
    const upright =
      (this.getStyleProperty(keepUpright)?.evaluate(getZoomBucket(this.props.zoom || 0)) ??
        getStylePropertyDefault(keepUpright)) === true;
    if (!upright || !isLineDirection) {
      return [GLOBE_LINE_ANGLE_EXTENSIONS.free];
    }
    return [
      keepUpright === 'text-keep-upright'
        ? GLOBE_LINE_ANGLE_EXTENSIONS.uprightText
        : GLOBE_LINE_ANGLE_EXTENSIONS.upright
    ];
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
    extensions: GlobeLineAngleExtension[];
  } {
    const placement = this.getSymbolPlacement();
    const zoom = getZoomBucket(this.props.zoom || 0);
    const alignment = this.getStyleProperty('icon-rotation-alignment')?.evaluate(zoom);
    const isMapAligned = isAlignedToMap(alignment, placement);
    const turnsWithLine = isLinePlacement(placement) && isMapAligned;
    const iconRotate = this.getStyleProperty('icon-rotate');
    const geographic = isGlobeViewport(this.context?.viewport);
    const props = isMapAligned ? {billboard: geographic ? this.props.billboard : false} : {};
    const extensions = this.getLineAngleExtensions(turnsWithLine, 'icon-keep-upright', !iconRotate);
    if (!turnsWithLine && !iconRotate) {
      return {props, getAngle: null, extensions};
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
    return {props, getAngle: (row: LabelRow) => getLineAngle(row) - getRotate(row), extensions};
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
      this.props.glyphs?.release(this.state);
      if (this.state.placementHandle) {
        this.state.placement?.unregister(this.state.placementHandle);
      }
      releaseSharedLabelPlacement(this.state.sharedPlacementKey);
      this.state.sharedPlacementKey = null;
      this.state.sharedPlacement = null;
    }
  }

  /**
   * Recomputes label anchor rows when the source tile data, or an input the anchors depend on,
   * changes.
   */
  updateState({oldProps, changeFlags}: UpdateParameters<this>): void {
    if (oldProps?.glyphs && oldProps.glyphs !== this.props.glyphs) {
      oldProps.glyphs.release(this.state);
    }
    const {data, tiles} = this.props;
    if (!data && !tiles) {
      return;
    }
    const geographic = isGlobeViewport(this.context?.viewport);
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
    const font = this.getFontKey();
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
    this.updatePlacement();
  }

  /** The rows of a layer of one tile's `data`. */
  updateDataRows(
    data: NonNullable<MVTLabelLayerProps['data']>,
    geographic: boolean,
    dataChanged: boolean
  ): void {
    const anchorKey = this.getAnchorKey(geographic);
    const glyphKey = this.getGlyphKey();
    // Rows placed while the glyph store refused font stacks are placed again once it may not.
    const {refusedGeneration} = this.state;
    const anchorsChanged =
      dataChanged ||
      anchorKey !== this.state.anchorKey ||
      (refusedGeneration !== undefined && refusedGeneration !== this.props.glyphs?.generation);
    if (anchorsChanged || glyphKey !== this.state.glyphKey) {
      const features = Array.isArray(data) ? data : data.features || [];
      const fontStacks = new Set<string>();
      const refused = new Set<string>();
      const ready = this.hasLabelGlyphs(features, fontStacks, refused);
      this.state.refusedGeneration = refused.size ? this.props.glyphs?.generation : undefined;
      this.retainGlyphs(fontStacks, refused.size > 0);
      if (!ready) {
        // Placed once the glyphs have loaded, when the layer updates again. Rows kept meanwhile
        // would draw the new text without its glyphs.
        this.setState({labelData: [], anchorKey: undefined, glyphKey: undefined});
        return;
      }
      // Rows are placed again when a font stack is refused, to leave its labels out, and when
      // they were placed while one was: the new text may be in font stacks the store retains.
      if (anchorsChanged || refused.size || refusedGeneration !== undefined) {
        const labelData = this.getLabelData(
          this.withoutRefusedLabels(features, refused),
          geographic
        );
        this.setState({labelData, anchorKey, glyphKey});
      } else {
        this.setState({glyphKey});
      }
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
    // The font stacks of tiles that wait for their glyphs.
    const waiting = new Set<string>();
    // Whether the glyph store refused a font stack of a tile (see `TileRows.refusedGeneration`).
    let refusedAny = false;
    const generation = this.props.glyphs?.generation;
    const tileRows = tiles.map(tile => {
      const {x, y, z} = tile.index;
      const tileKey = getTileKey(x, y, z);
      this.placingTile = tile;
      try {
        const anchorKey = this.getAnchorKey(geographic);
        const glyphKey = this.getGlyphKey();
        const cached = previous.get(tileKey);
        if (
          cached &&
          cached.features === tile.features &&
          cached.anchorKey === anchorKey &&
          cached.tile === tile.tile &&
          // Rows placed while the store refused font stacks are placed again once it may not.
          (cached.refusedGeneration === undefined || cached.refusedGeneration === generation)
        ) {
          refusedAny ||= cached.refusedGeneration !== undefined;
          if (cached.glyphKey === glyphKey) {
            next.set(tileKey, cached);
            return cached.rows;
          }
          // The same anchors, with text or a font whose glyphs may not have loaded. The rows are
          // kept, but the tile draws none until they have: they would draw the new text without
          // its glyphs. The layer updates again once they have loaded.
          changed = true;
          const fontStacks = new Set<string>();
          const refused = new Set<string>();
          if (!this.hasLabelGlyphs(tile.features, fontStacks, refused)) {
            fontStacks.forEach(fontStack => waiting.add(fontStack));
            next.set(tileKey, cached);
            return [];
          }
          // Unless a font stack is refused, or was when the rows were placed: they are placed again,
          // to leave out the labels of a refused font stack, and to place those of the others.
          if (!refused.size && cached.refusedGeneration === undefined) {
            const entry = {...cached, glyphKey, fontStacks, refusedGeneration: undefined};
            next.set(tileKey, entry);
            return entry.rows;
          }
        }
        changed = true;
        const fontStacks = new Set<string>();
        const refused = new Set<string>();
        if (!this.hasLabelGlyphs(tile.features, fontStacks, refused)) {
          fontStacks.forEach(fontStack => waiting.add(fontStack));
          // Placed once the glyphs have loaded, when the layer updates again; until then the tile
          // keeps the rows it had, if any. It draws them only while their text is the same: rows
          // kept across a change of text or font would draw the new text without its glyphs.
          if (cached) {
            next.set(tileKey, cached);
            return cached.glyphKey === glyphKey ? cached.rows : [];
          }
          return [];
        }
        let rows = this.getLabelData(this.withoutRefusedLabels(tile.features, refused), geographic);
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
        const entry = {
          features: tile.features,
          anchorKey,
          glyphKey,
          tile: tile.tile,
          rows,
          fontStacks,
          refusedGeneration: refused.size ? generation : undefined
        };
        refusedAny ||= refused.size > 0;
        next.set(tileKey, entry);
        return rows;
      } finally {
        this.placingTile = null;
      }
    });
    // The anchors of tiles no longer drawn are kept, most recently drawn first, up to as many as
    // are drawn: a tile hidden and shown again, as at the view's edge while it moves, keeps its
    // rows, and the values the sublayers computed for them.
    let hidden = 0;
    for (const [tileKey, entry] of previous) {
      if (hidden >= tiles.length) {
        break;
      }
      if (!next.has(tileKey)) {
        next.set(tileKey, entry);
        hidden++;
      }
    }
    // The layer retains the font stacks of the rows it keeps and of the tiles that wait.
    for (const entry of next.values()) {
      entry.fontStacks.forEach(fontStack => waiting.add(fontStack));
    }
    this.retainGlyphs(waiting, refusedAny);
    if (changed) {
      const combined = combineTileRows(tiles, tileRows);
      // A tile shown or hidden without rows of this layer leaves the rows as they are: the same
      // array keeps the sublayers' data, which deck.gl would otherwise update for every row.
      const previousRows = this.state.labelData;
      const labelData = isSameList(previousRows, combined) ? previousRows! : combined;
      this.setState({
        labelData,
        tileRows: next,
        rowTiles: tiles,
        anchorKey: undefined
      });
    }
  }

  /**
   * Gives back the font stacks the layer retains in its glyph store other than `fontStacks`, those
   * of the rows it keeps and of the tiles that wait for glyphs (see `GlyphStore.retain`).
   */
  retainGlyphs(fontStacks: ReadonlySet<string>, refused: boolean): void {
    const {glyphs} = this.props;
    if (!glyphs) {
      return;
    }
    // When the store refused font stacks, the layer updates again once stacks are given back, by
    // this layer or another, to place the rows of their labels again. Only then: an idle layer
    // does not update.
    const state = this.state;
    glyphs.onRetainedFreed(
      state,
      refused
        ? () => {
            Promise.resolve().then(() => {
              if (this.state === state && this.props.glyphs === glyphs) {
                this.setNeedsUpdate();
              }
            });
          }
        : null
    );
    glyphs.retainOnly(state, fontStacks);
  }

  /**
   * Renders the optional debug geometry and the text labels.
   */

  // --- Placement (see `LabelPlacement`) ---

  /** The placement this layer's labels take part in: its prop's, or its deck's shared one. */
  getLabelPlacement(): LabelPlacement {
    if (this.props.labelPlacement) {
      releaseSharedLabelPlacement(this.state.sharedPlacementKey);
      this.state.sharedPlacementKey = null;
      this.state.sharedPlacement = null;
      return this.props.labelPlacement;
    }
    // Label layers made without a placement, as by `getBasemapLayers` alone, place together.
    if (!this.state.sharedPlacementKey) {
      const key = getSharedLabelPlacementKey(this);
      this.state.sharedPlacementKey = key;
      this.state.sharedPlacement = acquireSharedLabelPlacement(key);
    }
    return this.state.sharedPlacement!;
  }

  /** Registers with the placement, for the current rows. */
  updatePlacement(): void {
    const placement = this.getLabelPlacement();
    let handle = this.state.placementHandle;
    if (!handle) {
      handle = {
        layer: this,
        getPlacementOrder: () => handle!.layer.getPlacementOrder(),
        getPlacementRevision: () => handle!.layer.getPlacementRevision(),
        getPlacementSlotRevision: () => handle!.layer.getPlacementSlotRevision(),
        getPlacementSlotCount: () => handle!.layer.getPlacementSlotCount(),
        isDrawnIn: viewport => handle!.layer.isDrawnIn(viewport),
        getPlacementSymbols: (viewport, base, out) =>
          handle!.layer.getPlacementSymbols(viewport, base, out),
        setNeedsRedraw: () => handle!.layer.setNeedsRedraw(),
        getPlacementRoot: () => handle!.layer.getPlacementRoot()
      };
      this.state.placementHandle = handle;
    }
    handle.layer = this;
    if (this.state.placement && this.state.placement !== placement) {
      this.state.placement.unregister(handle);
    }
    this.state.placement = placement;
    this.state.placementSlotBase = placement.register(handle);
    this.state.placementRevision = (this.state.placementRevision || 0) + 1;
    // Each row's slot is the slot base plus its index (see `getPlacementSlotAccessor`); the base
    // is the placement's to follow.
    if (this.state.labelData !== this.state.placementSlotRows) {
      this.state.placementSlotRows = this.state.labelData;
      this.state.placementSlotRevision = (this.state.placementSlotRevision || 0) + 1;
    }
  }

  /** Sublayer props that draw a part (0: text, 1: icons) where placement placed it. */
  getPlacementProps(part: 0 | 1): Record<string, unknown> {
    return {
      labelPlacement: this.state.placement || null,
      placementPart: part,
      getPlacementSlot: this.getPlacementSlotAccessor()
    };
  }

  /**
   * Each row's slot, by row: `TextLayer` does not hand its character layer the row's index in
   * `data`, so the slot is found from the row itself.
   */
  getPlacementSlotAccessor(): ((row: LabelRow) => number) | number {
    const base = this.state.placementSlotBase ?? -1;
    if (base < 0) {
      return -1;
    }
    const rows = this.getRows();
    const cached = this.state.placementSlots;
    if (cached?.rows !== rows || cached.base !== base) {
      const slots = new Map<LabelRow, number>();
      rows.forEach((row, index) => slots.set(row, base + index));
      this.state.placementSlots = {rows, base, accessor: (row: LabelRow) => slots.get(row) ?? -1};
    }
    return this.state.placementSlots!.accessor;
  }

  getPlacementOrder(): number {
    return this.props.collisionPriorityRange?.[0] ?? 0;
  }

  getPlacementRevision(): number {
    return this.state.placementRevision || 0;
  }

  getPlacementSlotRevision(): number {
    return this.state.placementSlotRevision || 0;
  }

  getPlacementSlotCount(): number {
    return this.getRows().length;
  }

  /**
   * `PlacementLayer.isDrawnIn`: whether deck.gl draws this layer in `viewport`, as its layers pass
   * decides: the layer and its parents are visible, and each parent's `filterSubLayer` keeps it.
   */
  isDrawnIn(viewport: Viewport): boolean {
    if (!this.props.visible) {
      return false;
    }
    // As deck.gl's screen pass asks.
    const context = {layer: this as Layer, viewport, isPicking: false, renderPass: 'screen'};
    for (let parent = this.parent; parent; parent = parent.parent) {
      if (!parent.props.visible || !(parent as CompositeLayer).filterSubLayer(context)) {
        return false;
      }
      context.layer = parent;
    }
    // The deck's `layerFilter`, which deck.gl asks of the topmost parent.
    const layerFilter = (this.context as {deck?: {props?: {layerFilter?: unknown}}})?.deck?.props
      ?.layerFilter;
    return typeof layerFilter === 'function' ? Boolean(layerFilter(context)) : true;
  }

  /**
   * `PlacementLayer.getPlacementRoot`: the deck layer this layer is drawn under, and the deck's
   * layers in draw order, so that the labels of a layer drawn over another (as a second
   * `BasemapLayer`) are placed first.
   */
  getPlacementRoot(): {root: Layer; layers: readonly Layer[]} | null {
    const layerManager = (this.context as {layerManager?: {getLayers?: () => Layer[]}})
      ?.layerManager;
    if (!layerManager?.getLayers) {
      return null;
    }
    let root: Layer = this;
    while (root.parent) {
      root = root.parent;
    }
    return {root, layers: layerManager.getLayers()};
  }

  /**
   * What placement needs of each row that does not change with the view, kept until the rows, the
   * label text, the sprites, the style's layout values, the font's measured widths or the zoom
   * step change: the rules, the placement order, and per row (in `labelData` order) its text box
   * (`x1, y1, w, h` in pixels from the anchor, before padding; `w` NaN without text) and its icon
   * box (`x1, y1, x2, y2` padded, before any turn; `x1` NaN without an icon).
   */
  getPlacementGeometry(): PlacementGeometry | null {
    const {config, spriteAtlases, styleLayer, fontFamily} = this.props;
    const labelData = this.state.labelData;
    if (!config.labels || !labelData?.length) {
      return null;
    }
    const zoom = getZoomBucket(this.props.zoom || 0);
    // Measured again once the label font has loaded (`forgetCharacterWidths`).
    const widthsRevision = this.getLineGlyphWidthsRevision()();
    const fontKey = this.getFontKey();
    // The layout values, so that a style layer edited in place is measured and ruled again, as
    // `getCompiledStyleProperty` compiles an edited value again.
    const layout = styleLayer?.layout ? Object.entries(styleLayer.layout).flat() : [];
    const shared = [
      spriteAtlases,
      styleLayer,
      fontFamily,
      fontKey,
      widthsRevision,
      zoom,
      ...layout
    ];
    const key = [labelData, this.state.labelText, ...shared];
    const cached = this.state.placementGeometry;
    if (cached && isSameList(cached.key, key)) {
      return cached;
    }
    // Each row's boxes are kept while the text, the sprites, the style, the font and the zoom step
    // are the same: a `tiles` layer makes its rows again whenever a tile is shown or hidden, and
    // the rows of the other tiles keep their objects.
    const rowKey = [this.state.labelText?.key[0], this.state.labelText?.key[2], ...shared];
    let rowBoxes = this.state.placementRowBoxes;
    if (!rowBoxes || !isSameList(rowBoxes.key, rowKey)) {
      rowBoxes = {key: rowKey, boxes: new WeakMap()};
      this.state.placementRowBoxes = rowBoxes;
    }
    const evaluate = (name: string) =>
      this.getStyleProperty(name)?.evaluate(zoom) ?? getStylePropertyDefault(name);
    const hasTextData = Boolean(this.getStyleProperty('text-field'));
    // While the sprites load (`null`), each symbol is taken to have its icon, so that its rules do
    // not change when they arrive (see `spriteAtlases`).
    const hasIconData =
      Boolean(this.getStyleProperty('icon-image')) &&
      (spriteAtlases === null || Boolean(spriteAtlases?.length));
    const rules: SymbolPlacementRules = {
      textOverlap: getOverlapMode(evaluate('text-overlap'), evaluate('text-allow-overlap')),
      iconOverlap: getOverlapMode(evaluate('icon-overlap'), evaluate('icon-allow-overlap')),
      textIgnorePlacement: Boolean(evaluate('text-ignore-placement')),
      iconIgnorePlacement: Boolean(evaluate('icon-ignore-placement')),
      textOptional: Boolean(evaluate('text-optional')),
      iconOptional: Boolean(evaluate('icon-optional')),
      hasTextData,
      hasIconData
    };
    const count = labelData.length;
    const rowsWithText = hasTextData ? this.getRowsWithText() : null;
    const icons = hasIconData ? this.getRowIcons() : null;
    const measure = this.getCharacterMeasurer();
    const lineHeight = this.getLineHeight();
    const linePlacement = isLinePlacement(this.getSymbolPlacement());
    const textBoxes = new Float64Array(count * 4).fill(Number.NaN);
    const textOffsets = new Float64Array(count * 2);
    const iconBoxes = new Float64Array(count * 4).fill(Number.NaN);
    const sortKey = this.getStyleProperty('symbol-sort-key');
    const keys = sortKey ? new Float64Array(count) : null;
    for (let i = 0; i < count; i++) {
      const row = labelData[i];
      const rowIndex = count - 1 - i;
      const feature = (row as any).__source?.object ?? row;
      if (keys) {
        keys[i] = Number(this.evaluateStyleProperty('symbol-sort-key', feature)) || 0;
      }
      const kept = rowBoxes.boxes.get(row);
      if (kept) {
        textBoxes.set(kept.subarray(0, 4), i * 4);
        iconBoxes.set(kept.subarray(4, 8), i * 4);
        textOffsets.set(kept.subarray(8, 10), i * 2);
        continue;
      }
      if (rowsWithText?.[rowIndex]) {
        const label = this.getLabel(feature) || '';
        const size = this.getLabelSize(feature);
        const spacing = this.getLetterSpacing(feature, label);
        const lines = label.split('\n');
        let textWidth = 0;
        for (const line of lines) {
          const characters = Array.from(line);
          let lineWidth = 0;
          for (const character of characters) {
            lineWidth += measure(character);
          }
          lineWidth += Math.max(0, characters.length - 1) * spacing;
          textWidth = Math.max(textWidth, lineWidth);
        }
        const w = textWidth * size;
        const h = lines.length * lineHeight * size;
        const [ax, ay] = ANCHOR_FRACTIONS[this.getRowAnchor(row)] || ANCHOR_FRACTIONS.center;
        const [dx, dy] = this.getRowPixelOffset(row);
        // A point label's box, offset included, is laid out at its collision size; text along a
        // line collides by circles along the text as drawn.
        const scale = linePlacement || !(size > 0) ? 1 : this.getCollisionLabelSize(feature) / size;
        // Variable anchors include a shift by the padded box. Padding stays in pixels when the
        // text and its em offsets are scaled to the collision size.
        const padding = this.getRowTextAnchor(row) ? 2 * this.getTextPadding() : 0;
        textBoxes.set(
          [
            (-(ax + 0.5) * w + dx + ax * padding) * scale - ax * padding,
            (-(ay + 0.5) * h + dy + ay * padding) * scale - ay * padding,
            w * scale,
            h * scale
          ],
          i * 4
        );
        textOffsets.set([dx, dy], i * 2);
      }
      const resolved = icons?.[rowIndex];
      if (resolved) {
        const scale = Number(this.evaluateStyleProperty('icon-size', feature) ?? 1);
        const w = (resolved.entry.width / resolved.entry.pixelRatio) * scale;
        const h = (resolved.entry.height / resolved.entry.pixelRatio) * scale;
        const [ox, oy] = this.getIconPixelOffset(feature);
        const [top, right, bottom, left] = (
          (this.evaluateStyleProperty('icon-padding', feature) as number[] | undefined) ??
          (getStylePropertyDefault('icon-padding') as number[])
        ).map(value => Math.max(0, Number(value)) || 0);
        iconBoxes.set(
          [ox - w / 2 - left, oy - h / 2 - top, ox + w / 2 + right, oy + h / 2 + bottom],
          i * 4
        );
      }
      const boxes = new Float64Array(10);
      boxes.set(textBoxes.subarray(i * 4, i * 4 + 4), 0);
      boxes.set(iconBoxes.subarray(i * 4, i * 4 + 4), 4);
      boxes.set(textOffsets.subarray(i * 2, i * 2 + 2), 8);
      rowBoxes.boxes.set(row, boxes);
    }
    // `labelData` order is feature order within each tile. The other anchors of a label with
    // variable anchors are placed with its first.
    const order: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!labelData[i].textAnchorIndex) {
        order.push(i);
      }
    }
    const tiles = labelData.map(row => (row as any).__tile);
    order.sort(
      (a, b) => (keys ? keys[a] - keys[b] : 0) || compareTiles(tiles[a], tiles[b]) || a - b
    );
    const geometry: PlacementGeometry = {
      key,
      rules,
      order,
      textBoxes,
      textOffsets,
      iconBoxes,
      textPadding: this.getTextPadding()
    };
    this.state.placementGeometry = geometry;
    return geometry;
  }

  /** `PlacementLayer.getPlacementSymbols`: this layer's symbols, in MapLibre's order. */
  getPlacementSymbols(
    viewport: any,
    slotBase: number,
    out: PlacementSymbol[]
  ): SymbolPlacementRules | null {
    const geometry = this.getPlacementGeometry();
    if (!geometry) {
      return null;
    }
    const labelData = this.state.labelData!;
    const {rules, order, textBoxes, textOffsets, iconBoxes, textPadding} = geometry;
    const count = labelData.length;
    const linePlacement = isLinePlacement(this.getSymbolPlacement());
    const lineProps = (linePlacement ? this.getLineLabelProps() : {}) as {
      billboard?: boolean;
      getAngle?: (row: LabelRow) => number;
    };
    const iconAngleProps = rules.hasIconData ? this.getIconAngleProps() : null;
    const getIconAngle = iconAngleProps?.getAngle;
    const padding = PLACEMENT_VIEWPORT_PADDING;
    const {width, height} = viewport;
    const isGlobe = isGlobeViewport(viewport);
    // Text along lines and icons aligned to the map are drawn in the map plane on a flat map: their
    // pixel offsets turn with the bearing and are foreshortened by the pitch.
    const textInMapPlane = !isGlobe && Boolean(lineProps.getAngle) && lineProps.billboard === false;
    const iconInMapPlane = !isGlobe && iconAngleProps?.props.billboard === false;
    const toScreen = [1, 0, 0, 1];
    // Glyphs placed along lines, as drawn (see `getLineGlyphProps`).
    const curves = textInMapPlane && this.curvesLineText(viewport);
    const bearingStep = curves ? this.getBearingStep(viewport) : 0;
    const styleKey = curves ? this.getLineGlyphStyleKey() : '';
    const spritesLoading = rules.hasIconData && this.props.spriteAtlases === null;
    // On a globe, billboards along lines are turned to their lines as the view draws them (see
    // `getLineAngleExtensions`): they collide along that direction.
    const textGlobeTurn = isGlobe
      ? this.getLineAngleExtensions(Boolean(lineProps.getAngle), 'text-keep-upright')[0]
      : undefined;
    const iconGlobeTurn = isGlobe ? iconAngleProps?.extensions[0] : undefined;

    // `tiles` rows are in longitude/latitude: their common-space positions, which do not change
    // with the view, are kept, and projected to the screen with the viewport's matrix.
    const commons = this.props.tiles ? this.getPlacementCommons(viewport, geometry) : null;
    const m = viewport.pixelProjectionMatrix as number[];
    const horizon = isGlobe ? this.getHorizonTest(viewport) : null;
    // The padded text box of row `j` at the grid point `x, y`.
    const getTextBox = (j: number, x: number, y: number): PlacementShape => {
      const x1 = textBoxes[j * 4];
      const y1 = textBoxes[j * 4 + 1];
      return {
        box: [
          x + x1 - textPadding,
          y + y1 - textPadding,
          x + x1 + textBoxes[j * 4 + 2] + textPadding,
          y + y1 + textBoxes[j * 4 + 3] + textPadding
        ]
      };
    };
    for (const i of order) {
      const row = labelData[i];
      let sx: number;
      let sy: number;
      let occluded = false;
      let common: number[] | null = null;
      if (commons) {
        const cx = commons[i * 3];
        const cy = commons[i * 3 + 1];
        const cz = commons[i * 3 + 2];
        const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
        sx = (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w;
        sy = (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w;
        occluded = horizon ? horizon(cx, cy, cz) : false;
        common = [cx, cy, cz];
      } else {
        [sx, sy] = this.project(row.position as any) as number[];
        occluded = isGlobe && this.isBeyondHorizon(viewport, row.position);
      }
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) {
        continue;
      }
      const x = sx + padding;
      const y = sy + padding;
      // Rows far outside the grid are not placed: MapLibre hides them until they come close.
      if (
        x < -width ||
        y < -height ||
        x > 3 * width + 2 * padding ||
        y > 3 * height + 2 * padding
      ) {
        continue;
      }
      const t = i * 4;
      const inMapPlane =
        (textInMapPlane && !Number.isNaN(textBoxes[t + 2])) ||
        (iconInMapPlane && !Number.isNaN(iconBoxes[t]));
      if (inMapPlane) {
        common ||= viewport.projectPosition(viewport.unproject([sx, sy])) as number[];
        getMapPlaneToScreen(viewport, common, sx, sy, toScreen);
      }
      let text: PlacementShape | null = null;
      let textAnchors: PlacementSymbol['textAnchors'];
      const w = textBoxes[t + 2];
      if (!Number.isNaN(w)) {
        const x1 = textBoxes[t];
        const y1 = textBoxes[t + 1];
        const h = textBoxes[t + 3];
        const curved = curves ? this.getLineGlyphs(row, viewport, bearingStep, styleKey) : null;
        if (curved && common) {
          // Circles along the line under the text, as MapLibre's: the path from its first glyph to
          // its last, taken to the screen vertex by vertex. As in MapLibre, they follow the line,
          // moved by `text-offset` only, whatever the `text-anchor`. Text that does not fit on the
          // line unturned has none, and is not drawn (see `LineGlyphPlacement`); text that fits
          // only unturned but must turn has its unturned circles, and is not drawn.
          const [ax, ay, bx, by] = toScreen;
          const screenRadius = (h / 2 + textPadding) * Math.sqrt(Math.abs(ax * by - ay * bx));
          const {path} = curved;
          if (!path) {
            text = {circles: []};
          } else {
            const step = 1 / (viewport.scale || 1);
            const screenPath: number[] = [];
            for (let k = 0; k < path.length; k += 2) {
              const cx = common[0] + path[k] * step;
              const cy = common[1] - path[k + 1] * step;
              const cz = common[2];
              const cw = m[3] * cx + m[7] * cy + m[11] * cz + m[15];
              screenPath.push(
                (m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / cw + padding,
                (m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / cw + padding
              );
            }
            LINE_GLYPH_STATS.placementPaths++;
            text = {circles: getPathCircles(screenPath, screenRadius)};
          }
        } else if (lineProps.getAngle) {
          // Circles along the turned label, as MapLibre's collision circles along a line, taken
          // to the screen when the text is drawn in the map plane.
          let angle = (lineProps.getAngle(row) * Math.PI) / 180;
          if (textGlobeTurn) {
            angle = getGlobeDrawnAngle(
              viewport,
              row.position as number[],
              angle,
              textGlobeTurn.opts.keepUpright
            );
          }
          const ux = Math.cos(angle);
          const uy = -Math.sin(angle);
          const radius = h / 2 + textPadding;
          // The text turns with its upright angle, and its offset with the line (see
          // `withLineDirection`), as drawn.
          const dx = textOffsets[i * 2];
          const dy = textOffsets[i * 2 + 1];
          // On a globe, along the line as the view draws it, never turned around.
          const [ex, ey] = rotatePixelOffset(
            [dx, dy],
            textGlobeTurn
              ? (getGlobeDrawnAngle(
                  viewport,
                  row.position as number[],
                  ((row.angle ?? 0) * Math.PI) / 180,
                  false
                ) *
                  180) /
                  Math.PI
              : (row.angle ?? 0)
          );
          const cx = x1 + w / 2 - dx;
          const cy = y1 + h / 2 - dy;
          // A label without height has a single circle.
          const n =
            radius > 0
              ? Math.max(1, Math.ceil(Math.max(0, w - 2 * radius) / (radius * 2.5)) + 1)
              : 1;
          const [ax, ay, bx, by] = textInMapPlane ? toScreen : [1, 0, 0, 1];
          const screenRadius = radius * Math.sqrt(Math.abs(ax * by - ay * bx));
          const circles: number[] = [];
          for (let k = 0; k < n; k++) {
            const along = n === 1 ? 0 : -w / 2 + radius + ((w - 2 * radius) * k) / (n - 1);
            const ox = cx + along;
            const mx = ox * ux - cy * uy + ex;
            const my = ox * uy + cy * ux + ey;
            circles.push(x + mx * ax + my * bx, y + mx * ay + my * by, screenRadius);
          }
          text = {circles};
        } else {
          text = getTextBox(i, x, y);
          const textAnchorCount = row.textAnchorCount ?? 0;
          if (textAnchorCount > 1) {
            // The label's text at each of its anchors, from the rows that follow (see
            // `getLabelData`), and the slot each is drawn from.
            const shapes: PlacementShape[] = [text];
            const slots = [slotBase + count - 1 - i];
            for (let k = 1; k < textAnchorCount; k++) {
              const j = i + k;
              if (labelData[j]?.textAnchorIndex !== k || Number.isNaN(textBoxes[j * 4 + 2])) {
                break;
              }
              shapes.push(getTextBox(j, x, y));
              slots.push(slotBase + count - 1 - j);
            }
            // A tile's rows are kept while it is drawn, so the first row names the label across
            // placements.
            textAnchors = {shapes, slots, key: row};
          }
        }
      }
      let icon: PlacementShape | null = null;
      if (!Number.isNaN(iconBoxes[t])) {
        let iconAngle = getIconAngle ? getIconAngle(row) : 0;
        if (iconGlobeTurn) {
          iconAngle =
            (getGlobeDrawnAngle(
              viewport,
              row.position as number[],
              (iconAngle * Math.PI) / 180,
              iconGlobeTurn.opts.keepUpright
            ) *
              180) /
            Math.PI;
        }
        const [bx1, by1, bx2, by2] = getTurnedBounds(
          [iconBoxes[t], iconBoxes[t + 1], iconBoxes[t + 2], iconBoxes[t + 3]],
          iconAngle,
          iconInMapPlane ? toScreen : null
        );
        icon = {box: [x + bx1, y + by1, x + bx2, y + by2]};
      }
      // While the sprites load, a row whose `icon-image` names an image waits for it.
      const iconPending =
        spritesLoading && Boolean(this.getIconImageName((row as any).__source?.object ?? row));
      if (text || icon || iconPending) {
        out.push({
          slot: slotBase + count - 1 - i,
          text,
          icon,
          occluded,
          iconPending,
          ...(textAnchors && {textAnchors})
        });
      }
    }
    return rules;
  }

  /**
   * The common-space position of each `labelData` row (in longitude/latitude), for the kind of
   * viewport: a globe's or a map's, which do not change with the view. Kept per row.
   */
  getPlacementCommons(viewport: any, geometry: PlacementGeometry): Float64Array {
    const kind = isGlobeViewport(viewport) ? 'globe' : 'map';
    if (geometry.commons?.kind === kind) {
      return geometry.commons.positions;
    }
    const labelData = this.state.labelData!;
    let cache = this.state.placementCommons;
    if (cache?.kind !== kind) {
      cache = {kind, positions: new WeakMap()};
      this.state.placementCommons = cache;
    }
    const positions = new Float64Array(labelData.length * 3);
    labelData.forEach((row, i) => {
      let common = cache!.positions.get(row);
      if (!common) {
        common = viewport.projectPosition([row.position[0], row.position[1], 0]) as number[];
        cache!.positions.set(row, common);
      }
      positions[i * 3] = common[0];
      positions[i * 3 + 1] = common[1];
      positions[i * 3 + 2] = common[2];
    });
    geometry.commons = {kind, positions};
    return positions;
  }

  /**
   * Whether a common-space point on a globe's surface is beyond its horizon in `viewport`, as
   * `GlobeHorizonExtension` tests it.
   */
  getHorizonTest(viewport: any): (x: number, y: number, z: number) => boolean {
    const m = viewport.viewProjectionMatrix as number[];
    if (m[3] === 0 && m[7] === 0 && m[11] === 0) {
      // Orthographic: hidden where the normal points away from the viewer (depth grows).
      return (x, y, z) => x * m[2] + y * m[6] + z * m[10] > 0;
    }
    const [cx, cy, cz] = viewport.cameraPosition as number[];
    // On the surface, a point's length is the globe's radius: dot(n, camera) < radius.
    return (x, y, z) => x * cx + y * cy + z * cz < x * x + y * y + z * z;
  }

  /** Whether a longitude/latitude lies beyond the horizon of a globe viewport. */
  isBeyondHorizon(viewport: any, position: number[]): boolean {
    // As `GlobeHorizonExtension` tests it in the shader.
    const common = viewport.projectPosition([position[0], position[1], 0]);
    const length = Math.hypot(common[0], common[1], common[2]);
    const m = viewport.viewProjectionMatrix;
    if (!length || !m) {
      return false;
    }
    const n = [common[0] / length, common[1] / length, common[2] / length];
    if (m[3] === 0 && m[7] === 0 && m[11] === 0) {
      // Orthographic: hidden where the normal points away from the viewer (depth grows).
      return n[0] * m[2] + n[1] * m[6] + n[2] * m[10] > 0;
    }
    const camera = viewport.cameraPosition;
    // The surface point is the globe's radius from its centre, the common space origin.
    return n[0] * camera[0] + n[1] * camera[1] + n[2] * camera[2] < length;
  }

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
      for (const {idSuffix, rows} of groups) {
        // Accessors over every row: `fallback` for rows outside the group.
        const forGroupRows = <T>(accessor: (feature: FeatureLike) => T, fallback: T) =>
          forRows(rows, this.getSubLayerAccessor(accessor) as any, fallback) as any;
        const updateTriggers = this.getLabelUpdateTriggers();
        const getText = forGroupRows((feature: FeatureLike) => this.getLabel(feature), undefined);
        // Which rows have an icon decides the group's rows. `all` is always set, so that a change
        // between split and unsplit groups refreshes the rows masked out before.
        const groupTrigger = rows
          ? [this.getStyleUpdateTrigger('icon-image'), this.props.spriteAtlases]
          : null;
        // `TextLayer` refreshes its glyphs with the `getText` trigger only, not with `all`: the
        // group's rows decide which rows have text, so they are part of it.
        const getTextTrigger = [updateTriggers.getText, ...(groupTrigger || [])];
        const lineLabelProps = this.getLineLabelProps();
        const lineGlyphs = this.getLineGlyphProps();
        updateTriggers.getLineGlyphs = lineGlyphs.trigger;
        const textProps = {
          data: this.getRows(),
          extensions: [
            ...(this.props.extensions || []),
            LABEL_PLACEMENT_EXTENSION,
            GLOBE_HORIZON_EXTENSION,
            TEXT_HALO_BLUR_EXTENSION,
            ...this.getLineAngleExtensions('getAngle' in lineLabelProps, 'text-keep-upright')
          ],
          ...this.getPlacementProps(0),
          parameters: LABEL_PARAMETERS,
          billboard,
          ...lineLabelProps,
          characterSet: 'auto',
          // Glyphs are signed distance fields, which `TextLayer` outlines for halos.
          ...this.getFontProps(font),
          sizeUnits: labelSizeUnits,
          lineHeight: this.getLineHeight(),
          // A transparent background box makes the whole label pickable.
          background: true,
          getBackgroundColor: [0, 0, 0, 0],
          getPosition: (d: LabelRow) => d.position,
          getSize: forGroupRows((feature: FeatureLike) => this.getLabelSize(feature), 0),
          getColor: forGroupRows(
            (feature: FeatureLike) => this.getLabelColor(feature),
            [0, 0, 0, 0]
          ),
          getPixelOffset: withLineDirection(
            forRows(rows, (row: LabelRow) => this.getRowPixelOffset(row), [0, 0]) as any,
            Boolean(lineLabelProps.getAngle)
          ),
          getLineGlyphs: lineGlyphs.getLineGlyphs,
          getLineGlyphKey: lineGlyphs.getLineGlyphKey,
          // A row of a label with variable anchors is drawn at its own anchor.
          getTextAnchor: forRows(
            rows,
            (row: LabelRow) => getTextAnchorProps(this.getRowAnchor(row)).textAnchor,
            'middle'
          ),
          getAlignmentBaseline: forRows(
            rows,
            (row: LabelRow) => getTextAnchorProps(this.getRowAnchor(row)).alignmentBaseline,
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
        if (halos.length <= 1) {
          // Every label has the same halo, or none: one sublayer draws them all.
          const halo = halos[0];
          layers.push(
            new LabelTextLayer({
              ...this.getSubLayerProps({id: `text${idSuffix}`}),
              ...textProps,
              outlineWidth: halo?.outlineWidth ?? 0,
              outlineColor: (halo?.outlineColor ?? [0, 0, 0, 0]) as any,
              textHaloBlurGamma: halo?.outlineBlur ?? 0,
              textHaloBlurCapped: !this.props.glyphs,
              getText,
              updateTriggers: {...updateTriggers, getText: getTextTrigger, all: groupTrigger}
            })
          );
        } else {
          // Several halos. `TextLayer` takes one outline per layer, so each halo is drawn by its
          // own sublayer. Every sublayer holds every row, in the order of `getRows`, so a row has
          // one placement slot. The invisible `text` sublayer draws the labels' picking boxes. The
          // number of halos is capped (see getLabelHalos), so the work stays linear in the rows.
          layers.push(
            new LabelTextLayer({
              ...this.getSubLayerProps({id: `text${idSuffix}`}),
              ...textProps,
              outlineWidth: 0,
              getColor: [0, 0, 0, 0],
              getText,
              updateTriggers: {...updateTriggers, getText: getTextTrigger, all: groupTrigger}
            }),
            ...halos.map(
              (halo, haloIndex) =>
                new LabelTextLayer({
                  ...this.getSubLayerProps({id: `text${idSuffix}-${haloIndex + 1}`}),
                  ...textProps,
                  outlineWidth: halo?.outlineWidth ?? 0,
                  outlineColor: (halo?.outlineColor ?? [0, 0, 0, 0]) as any,
                  textHaloBlurGamma: halo?.outlineBlur ?? 0,
                  textHaloBlurCapped: !this.props.glyphs,
                  // The placing sublayer's background box is the label's picking box.
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
      }
    }

    return layers;
  }
}
