import type {GlyphStore} from './glyph-store';
import {isGlobeViewport, SharedMVTLayer, SharedTileset2D} from '@deck.gl-community/geo-layers';
import {
  COORDINATE_SYSTEM,
  type Layer,
  type LayersList,
  type UpdateParameters,
  log
} from '@deck.gl/core';
import {PathStyleExtension} from '@deck.gl/extensions';
import {TileLayer} from '@deck.gl/geo-layers';
import {BitmapLayer, GeoJsonLayer, SolidPolygonLayer} from '@deck.gl/layers';
import {getGlobeAtmosphereLayer, getGlobeAtmosphereSkyLayer} from './atmosphere-layer';
import {createCircleSubLayer} from './circle-layer';
import {sortFeaturesByKey} from './sort-key';
import {getGeoJsonMaxZoom, getGeoJsonTileFeatures, isGeoJsonSource} from './geojson-source';
import {
  type FillPatternGroup,
  getFeaturesWithoutPattern,
  getFillPatternGroups,
  getFillPatternProps
} from './fill-pattern';
import {FillPatternExtension, FillTranslateExtension} from './fill-style-extensions';
import {FillOutlineExtension} from './fill-outline-extension';
import {LineBlurExtension, getBlurredLineWidth} from './line-blur-extension';
import {
  HillshadeTileLayer,
  createSharedDemTileset,
  getHillshadeParameters,
  type DemTile,
  type DemTilesetOwner
} from './hillshade-layer';
import type {LabelPlacement} from './label-placement';
import {MVTLabelLayer, type LabelTile} from './mvt-label-layer';
import {isSameList} from './util';
import {
  type RasterColorAdjustments,
  RasterColorExtension,
  hasRasterColorAdjustments
} from './raster-color-extension';
import {filterFeatures, parseProperties} from './map-style';
import {
  STYLE_ZOOM_STEP,
  type StyleAccessor,
  getFilterZoom,
  getStyleAccessor,
  getStyleZoomKey,
  getZoomBucket,
  withOpacity
} from './style-accessor';
import {evaluateStyleLight, getStylePropertyDefault} from './style-expression';
import {
  DEFAULT_FILL_EXTRUSION_LIGHT,
  type FillExtrusionLight,
  FillExtrusionLightingExtension
} from './fill-extrusion-lighting-extension';
import {
  MAX_ZOOM_PAINT_PARTS,
  ZOOM_PAINT_FILL_COLOR_ROW,
  ZOOM_PAINT_LINE_COLOR_ROW,
  ZOOM_PAINT_WIDTH_ROW,
  ZoomPaint,
  ZoomPaintExtension,
  type ZoomPaintValues,
  createZoomPaintValues,
  getZoomPaintOffset
} from './zoom-paint-extension';
import type {BasemapGlobeConfig, BasemapLayerProps} from './basemap-layer';
import type {SpriteAtlas} from './sprite';
import type {LabelFontFamily} from './text-font';
import type {
  BasemapLoadOptions,
  BasemapSource,
  ResolvedBasemapStyleLayer as BasemapStyleLayer,
  ResolvedBasemapStyle
} from './style-resolver';

type BasemapMode = NonNullable<BasemapLayerProps['mode']>;

type BasemapLayerConfig = {
  atmosphere: boolean;
  basemap: boolean;
  labels: boolean;
};

type BasemapLayerGroup = {
  idPrefix?: string;
  mode?: BasemapMode;
  globe?: {config?: BasemapGlobeConfig};
  styleDefinition: ResolvedBasemapStyle;
  zoom?: number;
  loadOptions?: BasemapLoadOptions;
  /**
   * Sprites loaded for the style; symbol layers draw `icon-image` from them. `null` means the
   * sprites are still loading: no icons are drawn, and labels are placed as if each symbol had its
   * icon. Omit it, or pass `[]`, for a style without sprites.
   */
  spriteAtlases?: SpriteAtlas[] | null;
  /** Overrides the label font that `text-font` maps to (see `BasemapLayerProps.fontFamily`). */
  fontFamily?: LabelFontFamily | null;
  /** The style's glyphs, which labels are drawn with (see `MVTLabelLayerProps.glyphs`). */
  glyphs?: GlyphStore | null;
  /** The label placement shared by the map's label layers (see `LabelPlacement`). */
  labelPlacement?: LabelPlacement | null;
  /** Externally owned source caches; BasemapLayer supplies and finalizes these. */
  tilesets?: Map<BasemapSource, SharedTileset2D>;
};

/**
 * Style layers that draw together, in style order: a background, raster or hillshade layer on its
 * own, or consecutive style layers of one vector source, which share one tile layer.
 */
export type StyleLayerRun = {
  type: 'background' | 'raster' | 'hillshade' | 'vector';
  /** The deck.gl layer id, without the basemap's id prefix. */
  id: string;
  sourceId?: string;
  source?: BasemapSource;
  styleLayers: BasemapStyleLayer[];
};

function logBasemapRuntimeEvent(message: string, details?: unknown): void {
  log.probe(1, `[BasemapLayer] ${message}`, details ?? '')();
}

function logBasemapRuntimeError(message: string, error: unknown, details?: unknown): void {
  log.error(`[BasemapLayer] ${message}`, details || '', error)();
}

function getBackgroundParameters(mode: BasemapMode) {
  return (
    mode === 'globe'
      ? {depthTest: true, depthWriteEnabled: true, depthCompare: 'less-equal', cullMode: 'back'}
      : {depthTest: false, cullMode: 'none'}
  ) as any;
}

/**
 * Flat map layers draw in style order without writing depth, but are depth-tested so that
 * extrusions hide the ground behind them. On the globe, layers tessellate the sphere differently,
 * so a later layer can lie behind an earlier one and fail a depth test: globe layers draw in style
 * order without depth, and back-face culling hides the far side. The globe background still
 * writes depth, so the globe hides what is drawn behind it.
 *
 * A flat globe layer drawn after an extrusion is `depthTested`, still without writing depth, so
 * that the buildings hide it. It is tested against the extrusions and the globe background only,
 * never against other flat layers, and extrusions draw at high zoom, where tiles lie close enough
 * to the sphere to pass the test against the background.
 */
function getTileParameters(mode: BasemapMode, depthTested = false) {
  if (mode === 'globe' && !depthTested) {
    return {depthTest: false, depthWriteEnabled: false, cullMode: 'back'} as any;
  }
  return {
    depthTest: true,
    depthWriteEnabled: false,
    depthCompare: 'less-equal',
    cullMode: mode === 'globe' ? 'back' : 'none'
  } as any;
}

const BACKGROUND_DATA = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, -90],
    [0, -90],
    [-180, -90]
  ]
];

const BACKGROUND_NORTH_POLE_DATA = [
  [
    [-180, 90],
    [0, 90],
    [180, 90],
    [180, 85],
    [0, 85],
    [-180, 85]
  ]
];

const SUPPORTED_TYPES = new Set([
  'background',
  'circle',
  'fill',
  'fill-extrusion',
  'line',
  'symbol',
  'raster',
  'hillshade'
]);
const DEFAULT_CONFIG: BasemapLayerConfig = {atmosphere: false, basemap: true, labels: true};
const DEFAULT_TEXT_COLOR = [0, 0, 0, 1];
// The style spec's default `line-color` and `fill-extrusion-color`.
const DEFAULT_COLOR = [0, 0, 0, 1];
const TRANSPARENT_COLOR: [number, number, number, number] = [0, 0, 0, 0];

/**
 * Dashes for `line-dasharray`, shared by every dashed sublayer so deck.gl does not see their
 * extensions change. `dashMode: 'path'` runs the pattern continuously along each line, as MapLibre
 * does, instead of restarting it at every vertex.
 */
const DASH_EXTENSION = new PathStyleExtension({dash: true, dashMode: 'path'});
/** The dash array of a solid line in a dashed sublayer: no gaps. */
const SOLID_DASH_ARRAY: StyleAccessor<[number, number]> = {value: [0, 0]};
/** `line-offset` and `line-gap-width`, alone and with dashes; shared for the same reason. */
const OFFSET_EXTENSION = new PathStyleExtension({offset: true});
const DASH_OFFSET_EXTENSION = new PathStyleExtension({dash: true, dashMode: 'path', offset: true});
/** `line-blur`, shared for the same reason: by layer, and per feature. */
const LINE_BLUR_EXTENSION = new LineBlurExtension();
const LINE_BLUR_PER_FEATURE_EXTENSION = new LineBlurExtension({perFeature: true});
/** A fill's outline, drawn as a line; shared for the same reason. */
const FILL_OUTLINE_EXTENSION = new FillOutlineExtension();

/** `fill-pattern` and `fill-translate`, shared by every fill that sets them. */
const FILL_PATTERN_EXTENSION = new FillPatternExtension();
const FILL_TRANSLATE_EXTENSION = new FillTranslateExtension();

/** Applies the `raster-*` color adjustments, shared by every raster layer that sets them. */
const RASTER_COLOR_EXTENSION = new RasterColorExtension();

/**
 * The texture filters of `raster-resampling: nearest`. MapLibre magnifies with the nearest texel
 * and keeps a linear filter for minification.
 */
const NEAREST_TEXTURE_PARAMETERS = {magFilter: 'nearest'} as const;

/** Extrusions are depth-tested against each other; flat layers draw in style order. */
const EXTRUSION_PARAMETERS = {
  depthTest: true,
  depthWriteEnabled: true,
  depthCompare: 'less-equal',
  cullMode: 'none'
} as any;

/** The latest evaluated paint per style layer, reused across tiles within one zoom step. */
const paintCache = new WeakMap<
  BasemapStyleLayer,
  {zoomBucket: number; paint: Record<string, any>}
>();

/**
 * Evaluates a style layer's paint at the stepped zoom (see `getZoomBucket`). Every tile
 * regenerated at one step gets the same result, so it is computed once per style layer and step.
 */
function getPaint(layer: BasemapStyleLayer, zoom: number): Record<string, any> {
  const zoomBucket = getZoomBucket(zoom);
  const cached = paintCache.get(layer);
  if (cached && cached.zoomBucket === zoomBucket) {
    return cached.paint;
  }
  const properties = parseProperties(layer, {zoom: zoomBucket});
  const paint = Object.fromEntries(
    properties.map(entry => [Object.keys(entry)[0], Object.values(entry)[0]])
  );
  paintCache.set(layer, {zoomBucket, paint});
  return paint;
}

type FilteredFeatures = {
  /** The filter's contents when the entry was made, so an in-place edit is detected. */
  filterSnapshot: string;
  sourceLayer: string | undefined;
  filterZoom: number | null;
  /** The tile content's length when it was filtered: content edited in place is filtered again. */
  length: number;
  features: any[];
};

/**
 * The latest filtered features per tile content and style layer. Tile sublayers regenerate at
 * every style zoom step; handing them the same array keeps deck.gl from seeing a data change, so
 * only zoom-dependent accessors recompute instead of every feature being re-tessellated. The
 * entry is reused while the contents of the style layer's `filter`, its `source-layer` and (for
 * filters that read `["zoom"]`) the integer zoom are unchanged, so a filter edited in place is
 * re-applied, as `compileStyleFilter` recompiles it.
 */
const filteredFeatureCache = new WeakMap<any[], WeakMap<BasemapStyleLayer, FilteredFeatures>>();

/**
 * The features of each tile content by source layer, in tile order, and the content's length when
 * they were split: content whose length changes, edited in place, is split again.
 */
const sourceLayerFeatureCache = new WeakMap<
  any[],
  {length: number; bySourceLayer: Map<unknown, any[]>}
>();

function getSourceLayerFeatures(features: any[], sourceLayer: string): any[] {
  const cached = sourceLayerFeatureCache.get(features);
  let bySourceLayer = cached?.length === features.length ? cached.bySourceLayer : undefined;
  if (!bySourceLayer) {
    bySourceLayer = new Map();
    for (const feature of features) {
      const layerName = feature.properties?.layerName;
      let group = bySourceLayer.get(layerName);
      if (!group) {
        group = [];
        bySourceLayer.set(layerName, group);
      }
      group.push(feature);
    }
    sourceLayerFeatureCache.set(features, {length: features.length, bySourceLayer});
  }
  return bySourceLayer.get(sourceLayer) || [];
}

/**
 * The contents of style layers' filters, as `filterTileFeatures` compares them. Taken once per
 * style layer each time the tile layers are generated, rather than once per tile.
 */
class FilterSnapshots {
  private snapshots = new Map<BasemapStyleLayer, string>();

  get(styleLayer: BasemapStyleLayer): string {
    let snapshot = this.snapshots.get(styleLayer);
    if (snapshot === undefined) {
      snapshot = styleLayer.filter === undefined ? '' : JSON.stringify(styleLayer.filter);
      this.snapshots.set(styleLayer, snapshot);
    }
    return snapshot;
  }
}

function filterTileFeatures(
  features: any[],
  styleLayer: BasemapStyleLayer,
  zoom: number,
  filterSnapshots: FilterSnapshots = new FilterSnapshots()
): any[] {
  const sourceLayer = styleLayer['source-layer'];
  const {filter} = styleLayer;
  if (!sourceLayer && !filter) {
    return features;
  }

  const filterSnapshot = filterSnapshots.get(styleLayer);
  // MapLibre evaluates `["zoom"]` in filters at integer zooms.
  const filterZoom = filterSnapshot.includes('["zoom"]') ? getFilterZoom(zoom) : null;
  let byStyleLayer = filteredFeatureCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    filteredFeatureCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (
    cached &&
    cached.filterSnapshot === filterSnapshot &&
    cached.sourceLayer === sourceLayer &&
    cached.filterZoom === filterZoom &&
    cached.length === features.length
  ) {
    return cached.features;
  }

  const sourceFeatures = sourceLayer ? getSourceLayerFeatures(features, sourceLayer) : features;
  const filtered = filter
    ? filterFeatures({
        features: sourceFeatures,
        filter: filter as unknown[],
        globalProperties: {zoom: getFilterZoom(zoom)}
      })
    : sourceFeatures;
  byStyleLayer.set(styleLayer, {
    filterSnapshot,
    sourceLayer,
    filterZoom,
    length: features.length,
    features: filtered
  });
  return filtered;
}

/** The `minzoom`/`maxzoom` limits that `isStyleLayerVisibleAtZoom` compares against. */
export function getStyleZoomLimits(styleLayers: BasemapStyleLayer[]): (number | undefined)[] {
  return styleLayers.flatMap(layer => [layer.minzoom, layer.maxzoom]);
}

/**
 * A style layer is visible unless its `layout.visibility` is `"none"`, and within its own
 * `minzoom`/`maxzoom` only, as in MapLibre. A source's `maxzoom` limits which tiles exist, not
 * which layers draw: past it, the tile layer overzooms. `visibility` is a constant in the style
 * spec, so it is read directly rather than evaluated.
 */
function isStyleLayerVisibleAtZoom(styleLayer: BasemapStyleLayer, zoom: number): boolean {
  if (styleLayer.layout?.visibility === 'none') {
    return false;
  }
  const {minzoom, maxzoom} = styleLayer;
  return (minzoom === undefined || zoom >= minzoom) && (maxzoom === undefined || zoom < maxzoom);
}

function getTileFeatures(data: unknown): any[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (
    data &&
    typeof data === 'object' &&
    Array.isArray((data as {features?: unknown[]}).features)
  ) {
    return (data as {features: unknown[]}).features as any[];
  }

  return [];
}

/** The prop that records which style layer of its run a tile sublayer draws. */
const STYLE_LAYER_INDEX = 'styleLayerIndex';
/** The view each label layer draws in, or `null` for every view (see `renderLabelLayers`). */
const labelLayerViews = new WeakMap<Layer, string | null>();

/** A view's key in `SharedTile2DLayer`'s per-view tileset views. */
function getViewKey(viewport: {id?: string} | null | undefined): string {
  return viewport?.id || 'default';
}

/** The prop that tells a tile's `renderSubLayers` whether its vector tile layer auto-highlights. */
const AUTO_HIGHLIGHT = 'styleAutoHighlight';

/**
 * The id of a style layer's sublayer in a tile. Style layer ids are arbitrary strings, and
 * generated layers append `-<suffix>` to it: deck.gl's own composite sublayers, the second side of
 * a `line-gap-width` and the per-feature line shape groups. Quoting the style layer id as a JSON
 * string ends it at an unescaped quote, so no suffix can turn one style layer's id into another's.
 * Consecutive style layers drawn in one sublayer are named by the JSON array of their ids, which
 * starts with `[` where a single id starts with `"`.
 */
function getStyleSubLayerId(parentId: string, styleLayerId: string | string[]): string {
  return `${parentId}-${JSON.stringify(styleLayerId)}`;
}

/**
 * The prop that hands a tile's `renderSubLayers` the `ZoomPaintContext` of its tile layer, or
 * null where fills and lines cannot take their paint from `ZoomPaintExtension`, which needs WebGL.
 */
const ZOOM_PAINT_CONTEXT = 'zoomPaintContext';

/** Shared by every fill and line sublayer, so deck.gl does not see their extensions change. */
const ZOOM_PAINT_EXTENSION = new ZoomPaintExtension();

/** The paint properties `getGeometryPaint` reads. */
const GEOMETRY_PAINT_PROPERTIES = [
  'fill-color',
  'fill-opacity',
  'fill-pattern',
  'fill-outline-color',
  'fill-antialias',
  'line-color',
  'line-opacity',
  'line-width'
];

/**
 * Writes style layers' colors for `ZoomPaintExtension`, in 0-1, with an alpha of -1 where they are
 * per feature. deck.gl draws a color that is the same for a whole layer as it is, and per-object
 * colors in 8 bits: style layers that would have per-object colors in one sublayer have their
 * colors rounded to 8 bits, so that taking them from a texture changes no pixel.
 */
function setZoomPaintColors(
  values: ZoomPaintValues,
  row: number,
  colors: StyleAccessor<number[]>[]
): void {
  const isLayerConstant = colors.every(
    ({value}) =>
      typeof value !== 'function' && JSON.stringify(value) === JSON.stringify(colors[0].value)
  );
  colors.forEach(({value}, part) => {
    // Per-feature colors keep the alpha of -1 that takes them from the attribute.
    if (typeof value !== 'function') {
      const offset = getZoomPaintOffset(row, part);
      for (let channel = 0; channel < 4; channel++) {
        values[offset + channel] =
          (isLayerConstant ? value[channel] : toUnorm8(value[channel])) / 255;
      }
    }
  });
}

/** Rounds a 0-255 value as deck.gl stores it in an 8 bit color attribute. */
const unorm8 = new Uint8ClampedArray(1);
function toUnorm8(value: number): number {
  unorm8[0] = value;
  return unorm8[0];
}

/**
 * Evaluates the paint of style layers drawn by one sublayer for `ZoomPaintExtension`: a style
 * layer's width, or 1 where it is per feature, and its colors in 0-1, or an alpha of -1 where they
 * are per feature.
 */
export function getZoomPaintValues(
  styleLayers: BasemapStyleLayer[],
  mode: BasemapMode,
  zoom: number
): ZoomPaintValues {
  const values = createZoomPaintValues();
  const paints = styleLayers.map(styleLayer => getGeometryPaint(styleLayer, mode, zoom));
  paints.forEach(({lineWidth}, part) => {
    if (typeof lineWidth.value !== 'function') {
      values[getZoomPaintOffset(ZOOM_PAINT_WIDTH_ROW, part)] = lineWidth.value;
    }
  });
  setZoomPaintColors(
    values,
    ZOOM_PAINT_LINE_COLOR_ROW,
    paints.map(paint => paint.lineColor)
  );
  setZoomPaintColors(
    values,
    ZOOM_PAINT_FILL_COLOR_ROW,
    paints.map(paint => paint.fillColor)
  );
  return values;
}

/**
 * The paint of one tile layer's fill and line sublayers for `ZoomPaintExtension`: the zoom its
 * sublayers were generated at, and a `ZoomPaint` per sequence of style layers drawn by one
 * sublayer, shared by all tiles. Kept in the tile layer's state.
 */
export class ZoomPaintContext {
  /** The stepped zoom (see `getZoomBucket`) at which paint is evaluated. */
  zoom = 0;

  private zoomPaints = new Map<string, {styleLayers: BasemapStyleLayer[]; zoomPaint: ZoomPaint}>();

  /** The style the zoom paints were made for (see `setStyle`). */
  private style: unknown;

  /** The zoom paints no sublayer has asked for since the last style change. */
  private unused = new Set<string>();

  /**
   * Destroys the zoom paints of sequences of style layers that no sublayer drew with since the
   * previous style change. A new style keeps the zoom paints of the style layers it keeps, and its
   * tile sublayers, regenerated, ask for the others again, so at most one style's are left over.
   */
  setStyle(style: unknown): void {
    if (style === this.style) {
      return;
    }
    this.style = style;
    for (const key of this.unused) {
      this.zoomPaints.get(key)?.zoomPaint.destroy();
      this.zoomPaints.delete(key);
    }
    this.unused = new Set(this.zoomPaints.keys());
  }

  /**
   * The `ZoomPaint` of style layers drawn by one sublayer. Its values are evaluated once per zoom
   * step, and again when a paint property is replaced.
   */
  get(styleLayers: BasemapStyleLayer[], mode: BasemapMode): ZoomPaint {
    const key = `${mode} ${JSON.stringify(styleLayers.map(layer => layer.id))}`;
    this.unused.delete(key);
    const cached = this.zoomPaints.get(key);
    if (
      cached &&
      cached.styleLayers.length === styleLayers.length &&
      cached.styleLayers.every((layer, index) => layer === styleLayers[index])
    ) {
      return cached.zoomPaint;
    }
    // A new style: the sublayers that drew with the previous style layers are gone.
    cached?.zoomPaint.destroy();

    // The paint values the current values were evaluated from, compared at every draw.
    const inputs: unknown[] = [];
    const inputsChanged = () => {
      let index = 0;
      let changed = false;
      for (const layer of styleLayers) {
        for (const name of GEOMETRY_PAINT_PROPERTIES) {
          const input = layer.paint?.[name];
          if (inputs[index] !== input) {
            inputs[index] = input;
            changed = true;
          }
          index++;
        }
      }
      return changed;
    };
    let last: {zoom: number; values: ZoomPaintValues} | null = null;
    const zoomPaint = new ZoomPaint(() => {
      const {zoom} = this;
      if (inputsChanged() || !last || last.zoom !== zoom) {
        last = {zoom, values: getZoomPaintValues(styleLayers, mode, zoom)};
      }
      return last.values;
    });
    this.zoomPaints.set(key, {styleLayers: [...styleLayers], zoomPaint});
    return zoomPaint;
  }

  /** Releases the textures of every `ZoomPaint`. */
  destroy(): void {
    for (const {zoomPaint} of this.zoomPaints.values()) {
      zoomPaint.destroy();
    }
    this.zoomPaints.clear();
  }
}

function getSubLayerBaseProps(props: any) {
  const {
    pickable,
    visible,
    opacity,
    modelMatrix,
    coordinateSystem,
    coordinateOrigin,
    extensions,
    highlightedObjectIndex,
    highlightColor,
    parameters,
    wrapLongitude,
    [STYLE_LAYER_INDEX]: styleLayerIndex
  } = props;

  return {
    // Recorded for `sortTileSubLayers`, which orders all tiles' sublayers by style layer.
    [STYLE_LAYER_INDEX]: styleLayerIndex,
    pickable,
    visible,
    opacity,
    modelMatrix,
    coordinateSystem,
    coordinateOrigin,
    extensions,
    highlightedObjectIndex,
    highlightColor,
    parameters,
    wrapLongitude
  };
}

function getGlobeFillColor(color: [number, number, number, number], mode: BasemapMode) {
  if (mode !== 'globe') {
    return color;
  }

  return [color[0], color[1], color[2], 255] as [number, number, number, number];
}

function getConfig(globe?: {config?: BasemapGlobeConfig}): BasemapLayerConfig {
  return {...DEFAULT_CONFIG, ...(globe?.config || {})};
}

function createBackgroundLayer({
  idPrefix,
  layer,
  zoom,
  mode
}: {
  idPrefix: string;
  layer: BasemapStyleLayer;
  zoom: number;
  mode: BasemapMode;
}) {
  const paint = getPaint(layer, zoom);

  return new SolidPolygonLayer({
    id: `${idPrefix}-${layer.id}`,
    data: BACKGROUND_DATA,
    getPolygon: d => d,
    stroked: false,
    filled: true,
    // A `background-pattern` disables `background-color`. Patterns are not drawn, so a patterned
    // background draws nothing rather than its color or the default black.
    getFillColor:
      paint['background-pattern'] !== undefined
        ? TRANSPARENT_COLOR
        : withOpacity(
            (paint['background-color'] ?? getStylePropertyDefault('background-color')) as number[],
            paint['background-opacity'] ?? 1
          ),
    parameters: getBackgroundParameters(mode)
  });
}

/** A raster paint value, or the style specification's default when the layer does not set it. */
function getRasterPaintValue(paint: Record<string, any>, propertyName: string): any {
  return paint[propertyName] ?? getStylePropertyDefault(propertyName);
}

function getRasterColorAdjustments(paint: Record<string, any>): RasterColorAdjustments {
  return {
    brightnessMin: getRasterPaintValue(paint, 'raster-brightness-min'),
    brightnessMax: getRasterPaintValue(paint, 'raster-brightness-max'),
    saturation: getRasterPaintValue(paint, 'raster-saturation'),
    contrast: getRasterPaintValue(paint, 'raster-contrast'),
    hueRotate: getRasterPaintValue(paint, 'raster-hue-rotate')
  };
}

/** The bounds of the Web Mercator tile pyramid. */
const WORLD_TILE_EXTENT = [-180, -85.051129, 180, 85.051129];

/**
 * The `zoomOffset` of vector sources' tiles. MapLibre GL JS draws a vector source with the tiles
 * at the floor of the zoom (and a raster source with those at the rounded zoom, as deck.gl's
 * `TileLayer` does): its styles and labels are laid out for that. Half a zoom down before
 * rounding selects the same tiles.
 */
export const VECTOR_TILE_ZOOM_OFFSET = -0.5;

/**
 * The tile pyramid range of a source. `TileLayer` draws nothing at a view zoom below its `minZoom`,
 * unless it has an `extent`. On a globe, the view zoom goes below 0 near the poles: `GlobeView`
 * lowers the zoom with the latitude, so that the globe keeps its size on screen (zoom 0 at the
 * equator is zoom -2 at latitude 76). A source whose pyramid starts at zoom 0 draws its zoom 0
 * tiles at any lower zoom, as in MapLibre; the extent, the whole pyramid, selects them.
 */
export function getTilePyramidProps(source: BasemapSource): {
  minZoom: number;
  maxZoom: number;
  extent: number[] | null;
} {
  const minZoom = source.minzoom ?? 0;
  return {
    minZoom,
    maxZoom: source.type === 'geojson' ? getGeoJsonMaxZoom(source) : (source.maxzoom ?? 22),
    extent: minZoom <= 0 ? WORLD_TILE_EXTENT : null
  };
}

/**
 * Creates the tileset of a `raster-dem` source: each tile is fetched and decoded once, and shared by
 * every `hillshade` layer drawn from it. `BasemapLayer` creates and finalizes these itself. Direct
 * `getBasemapLayers` callers that call it on every render pass them in `tilesets`, keyed by source,
 * to keep the tiles across calls, and finalize them when done.
 */
export function createDemTileset(
  source: BasemapSource,
  loadOptions?: BasemapLoadOptions
): SharedTileset2D<DemTile | null> {
  return createSharedDemTileset(source, loadOptions, getTilePyramidProps(source));
}

function createRasterLayer({
  idPrefix,
  layer,
  source,
  zoom,
  mode,
  depthTested
}: {
  idPrefix: string;
  layer: BasemapStyleLayer;
  source: BasemapSource;
  zoom: number;
  mode: BasemapMode;
  /** Drawn after an extrusion, see `getTileParameters`. */
  depthTested?: boolean;
}) {
  const paint = getPaint(layer, zoom);
  const rasterColorAdjustments = getRasterColorAdjustments(paint);
  // A zoom-interpolated adjustment that crosses its default value adds or removes the extension
  // at that zoom step, which recompiles the tiles' shaders once.
  const isColorAdjusted = hasRasterColorAdjustments(rasterColorAdjustments);
  // MapLibre magnifies with nearest-neighbour sampling when either property is `nearest`.
  const isNearest =
    getRasterPaintValue(paint, 'raster-resampling') === 'nearest' ||
    getRasterPaintValue(paint, 'resampling') === 'nearest';

  return new TileLayer({
    id: `${idPrefix}-${layer.id}`,
    data: source.tiles,
    ...getTilePyramidProps(source),
    tileSize: source.tileSize || 512,
    // deck.gl draws with `opacity ** (1 / 2.2)`. Undo that, so the alpha is `raster-opacity`, as
    // in MapLibre.
    opacity: getRasterPaintValue(paint, 'raster-opacity') ** 2.2,
    // The color adjustments and texture filter are passed down to each tile's bitmap layer.
    ...(isColorAdjusted ? {extensions: [RASTER_COLOR_EXTENSION], rasterColorAdjustments} : {}),
    textureParameters: isNearest ? NEAREST_TEXTURE_PARAMETERS : null,
    renderSubLayers: props => {
      const {west, south, east, north} = (props.tile?.bbox || {}) as {
        west: number;
        south: number;
        east: number;
        north: number;
      };

      // Set by `RasterColorExtension` where its shader runs, which outputs premultiplied colors.
      const blendParameters = (props as {rasterColorBlendParameters?: object | null})
        .rasterColorBlendParameters;

      return new BitmapLayer({
        ...props,
        // A texture keeps the filter it was created with, so a filter change needs a new layer.
        id: isNearest ? `${props.id}-nearest` : props.id,
        _imageCoordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
        data: null,
        image: props.data,
        bounds: [west, south, east, north],
        parameters: blendParameters
          ? {...getTileParameters(mode, depthTested), ...blendParameters}
          : getTileParameters(mode, depthTested)
      } as any);
    },
    onTileError: error => {
      logBasemapRuntimeError('Raster tile failed to load', error, {
        layerId: layer.id,
        sourceId: layer.source
      });
    },
    parameters: getTileParameters(mode, depthTested)
  });
}

/**
 * A `hillshade` style layer over a `raster-dem` source. Its tiles are decoded on the main thread,
 * once for all of the source's hillshade layers, which share `tileset` (see `HillshadeTileLayer`).
 * MapLibre draws nothing at `hillshade-exaggeration: 0`.
 */
function createHillshadeLayer({
  idPrefix,
  layer,
  tileset,
  demTilesetOwner,
  source,
  zoom,
  mode,
  depthTested
}: {
  idPrefix: string;
  layer: BasemapStyleLayer;
  /** The source's decoded tiles (see `createDemTileset`). */
  tileset: SharedTileset2D;
  /** Set when the layer shares a tileset that no `BasemapLayer` owns. */
  demTilesetOwner?: DemTilesetOwner;
  source: BasemapSource;
  zoom: number;
  mode: BasemapMode;
  /** Drawn after an extrusion, see `getTileParameters`. */
  depthTested?: boolean;
}) {
  const hillshadeParameters = getHillshadeParameters(getPaint(layer, zoom));
  const isNearest = getRasterPaintValue(getPaint(layer, zoom), 'resampling') === 'nearest';
  const filter = isNearest ? 'nearest' : 'linear';

  return new HillshadeTileLayer({
    id: `${idPrefix}-${layer.id}`,
    data: tileset,
    demTilesetOwner,
    ...getTilePyramidProps(source),
    tileSize: source.tileSize || 512,
    visible: hillshadeParameters.exaggeration !== 0,
    hillshadeParameters,
    hillshadeSubLayerProps: {
      // MapLibre samples the slopes without mipmaps.
      textureParameters: {minFilter: filter, magFilter: filter, mipmapFilter: 'none'},
      parameters: getTileParameters(mode, depthTested)
    },
    onTileError: error => {
      logBasemapRuntimeError('DEM tile failed to load', error, {
        layerId: layer.id,
        sourceId: layer.source
      });
    },
    parameters: getTileParameters(mode, depthTested)
  });
}

/**
 * Orders the sublayers of all tiles of a tile layer by style layer, as MapLibre draws each style
 * layer across all tiles before the next: a tile's fills cannot paint over the labels of the tile
 * drawn before it. Within a style layer, tiles keep their order, and so do the sublayers of a tile.
 */
export function sortTileSubLayers<LayerT extends {props: Record<string, any>}>(
  tileSubLayers: (LayerT[] | null | undefined)[]
): LayerT[] {
  // `Array.prototype.sort` is stable.
  return tileSubLayers
    .flatMap(layers => layers || [])
    .sort((a, b) => (a.props[STYLE_LAYER_INDEX] ?? 0) - (b.props[STYLE_LAYER_INDEX] ?? 0));
}

/** The prop that hands a tile's `renderSubLayers` the map to record its label features in. */
const TILE_LABEL_FEATURES = 'tileLabelFeatures';

/** The features of a symbol style layer without any in a tile. */
const NO_FEATURES: any[] = [];

/**
 * Builds the label layers of a run from the label features of its drawn tiles, by style layer
 * index; `getSubLayerProps` gives a label layer the tile layer's props.
 */
type RenderLabelLayers = (
  tilesByStyleLayer: Map<number, LabelTile[]>,
  getSubLayerProps: (id: string) => Record<string, any>,
  /** The style layers whose label layers are kept hidden (see `renderViewLabelLayers`). */
  hidden: Set<number>
) => Layer[];

type SourceTilesetOwner = {tileset: SharedTileset2D; consumers: Set<StyledMVTLayer['state']>};

/** A tile of a shared tileset, as `SharedTile2DLayer` renders it. */
type SharedTile = {
  id: string;
  index: {x: number; y: number; z: number};
  bbox?: unknown;
  content?: unknown;
};

class StyledMVTLayer extends SharedMVTLayer {
  declare state: SharedMVTLayer['state'] & {
    sourceTilesetOwner?: SourceTilesetOwner;
    /** The sublayers last generated for each tile, by tile id. */
    keptTileLayers?: Map<string, Layer[]>;
    /** Hidden tiles whose sublayers were kept rather than regenerated, by tile id. */
    staleTiles?: Set<string>;
    /** The tile object each id stood for at the last render (see `forgetRemovedTiles`). */
    keptTiles?: Map<string, SharedTile>;
    /** The paint textures of the fill and line sublayers (see `ZoomPaintExtension`). */
    zoomPaintContext?: ZoomPaintContext;
    /**
     * The features of each symbol style layer in a tile, by tile id and the style layer's index in
     * its run, as `renderSubLayers` last filtered them. Labels are drawn for all tiles at once, see
     * `renderLabelLayers`. Kept per layer: the tiles are shared with the source's other runs.
     */
    tileLabelFeatures?: Map<string, Map<number, any[]>>;
    /**
     * The label tiles of each symbol style layer, by index, as `renderLabelLayers` last made them,
     * by view (see `getLabelViewKey`).
     */
    labelTiles?: Map<string, Map<number, {key: unknown[]; tiles: LabelTile[]}>>;
    /** The symbol style layers that have a label layer, by view (see `renderViewLabelLayers`). */
    labelStyleLayers?: Map<string, Set<number>>;
    /** The style layers `labelStyleLayers` indexes, and the tileset of their tiles. */
    labelStyle?: unknown;
    labelTileset?: unknown;
    /** The label layers last rendered, and the props and tiles they were rendered for, by view. */
    labelLayers?: Map<
      string,
      {
        props: unknown;
        byStyleLayer: Map<number, {tiles: LabelTile[]; isHidden: boolean; layers: Layer[]}>;
      }
    >;
  };

  updateState(params: UpdateParameters<this>): void {
    const owner = (this.props as any).sourceTilesetOwner as SourceTilesetOwner | undefined;
    const previous = this.state.sourceTilesetOwner;
    if (owner !== previous) {
      this.releaseSourceTileset();
      owner?.consumers.add(this.state);
      this.state.sourceTilesetOwner = owner;
    }
    const {geographic, tileset} = this.state;
    super.updateState(params);
    // A new tileset, or a switch between a map and a globe, makes every kept sublayer obsolete.
    if (this.state.geographic !== geographic || this.state.tileset !== tileset) {
      this.state.keptTileLayers?.clear();
      this.state.staleTiles?.clear();
      this.state.tileLabelFeatures?.clear();
    }
  }

  /** Whether a tile is drawn in any view of this layer; every tile is, before the first view. */
  isTileShown(tile: SharedTile): boolean {
    const views = this.state.tilesetViews;
    if (!views?.size) {
      return true;
    }
    for (const view of views.values()) {
      if (view.isTileVisible(tile as any)) {
        return true;
      }
    }
    return false;
  }

  /**
   * `SharedTile2DLayer` generates sublayers for every tile of the shared tileset, shown or not,
   * again whenever the update triggers change, which is at every style zoom step, and culls the
   * hidden ones: several times as many tiles as are shown. A hidden tile keeps the sublayers it
   * has instead, and regenerates them when it is shown again. Kept sublayers stay initialized, so
   * showing the tile again updates them rather than creating them.
   */
  renderLayers(): Layer | null | LayersList {
    const {tileset, tileLayers} = this.state;
    if (!this.state.keptTileLayers) {
      this.state.keptTileLayers = new Map();
      this.state.staleTiles = new Set();
    }
    const kept = this.state.keptTileLayers;
    const stale = this.state.staleTiles!;
    const tiles: SharedTile[] = (tileset?.tiles as SharedTile[] | undefined) || [];
    this.forgetRemovedTiles(tiles);
    for (const tile of tiles) {
      if (this.isTileShown(tile)) {
        if (stale.delete(tile.id)) {
          tileLayers.delete(tile.id);
        }
      } else if (!tileLayers.has(tile.id) && kept.has(tile.id)) {
        tileLayers.set(tile.id, kept.get(tile.id)!);
        stale.add(tile.id);
      }
    }
    const layers = super.renderLayers();
    for (const tile of tiles) {
      const generated = tileLayers.get(tile.id);
      if (generated && !stale.has(tile.id)) {
        kept.set(tile.id, generated);
      }
    }
    if (!Array.isArray(layers)) {
      return layers;
    }
    return [...sortTileSubLayers(layers as (Layer[] | null)[]), ...this.renderLabelLayers(tiles)];
  }

  /**
   * The labels of all drawn tiles, one label layer per symbol style layer, drawn after every
   * tile's sublayers: a run has no other style layer after its first symbol layer (see
   * `getStyleLayerRuns`). Each label layer keeps its tiles' list, and so its rows, until a tile is
   * shown or hidden, or its features change.
   */
  renderLabelLayers(tiles: SharedTile[]): Layer[] {
    const views = this.state.tilesetViews;
    // Each view draws the labels of the tiles it shows: a tile drawn in one view would otherwise
    // label, and hide the parent labels of, another.
    if (!views || views.size <= 1) {
      return this.renderViewLabelLayers(tiles, null, tile => this.isTileShown(tile));
    }
    return [...views].flatMap(([viewKey, view]) =>
      this.renderViewLabelLayers(tiles, viewKey, tile => view.isTileVisible(tile as any))
    );
  }

  /** The label layers of the tiles `isShown` accepts, for one view, or for all with `null`. */
  private renderViewLabelLayers(
    tiles: SharedTile[],
    viewKey: string | null,
    isShown: (tile: SharedTile) => boolean
  ): Layer[] {
    const render = (this.props as {renderLabelLayers?: RenderLabelLayers}).renderLabelLayers;
    if (!render) {
      return [];
    }
    const cacheKey = viewKey ?? '';
    this.state.labelTiles ||= new Map();
    this.state.labelLayers ||= new Map();
    const previous = this.state.labelTiles.get(cacheKey) || new Map();
    const next = new Map<number, {key: unknown[]; tiles: LabelTile[]}>();
    const tileSize = (this.props as {tileSize?: number}).tileSize ?? 512;
    for (const tile of tiles) {
      const byStyleLayer =
        tile.content && isShown(tile) ? this.state.tileLabelFeatures?.get(tile.id) : null;
      for (const [styleLayerIndex, features] of byStyleLayer || []) {
        let entry = next.get(styleLayerIndex);
        if (!entry) {
          entry = {key: [], tiles: []};
          next.set(styleLayerIndex, entry);
        }
        entry.key.push(tile, features);
        entry.tiles.push({
          index: tile.index,
          features,
          tileBoundingBox: (tile.bbox as LabelTile['tileBoundingBox']) ?? null,
          tileZoom: tile.index?.z ?? null,
          tileSize,
          tile
        });
      }
    }
    // A style layer without features in any drawn tile has no label layer, unless it has had one:
    // the drawn tiles change as the view moves, and a style layer whose features are only in
    // tiles at the view's edge loses and regains them. Its label layer is then kept, hidden, with
    // the tiles it last drew, so that neither hiding nor showing it again changes its data, while
    // the style layer is drawn at this zoom and its tiles are of the zoom drawn now or next to it.
    // A drawn tile's sublayers record every symbol layer drawn at its zoom, with or without
    // features, so one that a labelled tile leaves out is outside its zoom range, and is dropped.
    // While no drawn tile is labelled yet, as when they load, the label layer is kept too.
    // Style layer indices name other style layers in another style, and the kept tiles are gone
    // with their tileset: a new style or tileset forgets the label layers kept.
    const style = (this.props as {paintStyle?: unknown}).paintStyle;
    const {tileset} = this.state;
    if (
      !this.state.labelStyleLayers ||
      this.state.labelStyle !== style ||
      this.state.labelTileset !== tileset
    ) {
      this.state.labelStyleLayers = new Map();
      this.state.labelStyle = style;
      this.state.labelTileset = tileset;
    }
    const labelled = this.state.labelStyleLayers.get(cacheKey) || new Set<number>();
    const drawnTiles = tiles.filter(tile => tile.content && isShown(tile));
    const drawnFeatures = drawnTiles
      .map(tile => this.state.tileLabelFeatures?.get(tile.id))
      .filter((byStyleLayer): byStyleLayer is Map<number, any[]> => Boolean(byStyleLayer));
    // Only tiles of the zoom drawn now, or of the next zoom in or out, as across one tile zoom
    // step, are likely to return to the view and draw the kept rows again.
    const drawnZoom = drawnTiles.length ? Math.max(...drawnTiles.map(tile => tile.index.z)) : null;
    const isAtDrawnZoom = (entry: {tiles: LabelTile[]}) =>
      drawnZoom === null ||
      entry.tiles.length === 0 ||
      Math.abs(Math.max(...entry.tiles.map(tile => tile.index.z)) - drawnZoom) <= 1;
    const hidden = new Set<number>();
    for (const styleLayerIndex of labelled) {
      const entry = next.get(styleLayerIndex);
      const last = previous.get(styleLayerIndex);
      const isDrawnAtThisZoom = entry
        ? true
        : drawnFeatures.every(byStyleLayer => byStyleLayer.has(styleLayerIndex));
      if (
        last &&
        isDrawnAtThisZoom &&
        isAtDrawnZoom(last) &&
        (!entry || entry.tiles.every(tile => tile.features.length === 0))
      ) {
        next.set(styleLayerIndex, last);
        hidden.add(styleLayerIndex);
      }
    }
    for (const [styleLayerIndex, entry] of next) {
      if (hidden.has(styleLayerIndex)) {
        continue;
      }
      if (entry.tiles.every(tile => tile.features.length === 0)) {
        next.delete(styleLayerIndex);
        continue;
      }
      const last = previous.get(styleLayerIndex);
      if (last && isSameList(last.key, entry.key)) {
        next.set(styleLayerIndex, last);
      }
    }
    this.state.labelTiles.set(cacheKey, next);
    this.state.labelStyleLayers.set(cacheKey, new Set(next.keys()));
    // Each style layer's label layers stay the same instances while its tiles, whether it is
    // hidden, and this layer's props (with `render`, new at each style zoom step) do not change:
    // new instances would compare and update the label layers at every frame. A hidden label
    // layer keeps its tiles, and its instance, also across zoom steps: it is not drawn, and the
    // instance that shows it again is compared with this one, so it then takes every change made
    // meanwhile. A new style has no hidden label layers (see above).
    const lastLayers = this.state.labelLayers.get(cacheKey);
    const byStyleLayer = new Map<
      number,
      {tiles: LabelTile[]; isHidden: boolean; layers: Layer[]}
    >();
    const layers: Layer[] = [];
    // In style order, whichever tile first had a style layer.
    for (const [styleLayerIndex, entry] of [...next].sort(([a], [b]) => a - b)) {
      const isHidden = hidden.has(styleLayerIndex);
      const kept =
        lastLayers?.props === this.props || isHidden
          ? lastLayers?.byStyleLayer.get(styleLayerIndex)
          : undefined;
      let rendered = kept;
      if (!kept || kept.tiles !== entry.tiles || kept.isHidden !== isHidden) {
        const styleLayerLayers = render(
          new Map([[styleLayerIndex, entry.tiles]]),
          id => this.getSubLayerProps({id: viewKey === null ? id : `${id}-view-${viewKey}`}),
          hidden
        );
        for (const layer of styleLayerLayers) {
          labelLayerViews.set(layer, viewKey);
        }
        rendered = {tiles: entry.tiles, isHidden, layers: styleLayerLayers};
      }
      byStyleLayer.set(styleLayerIndex, rendered!);
      layers.push(...rendered!.layers);
    }
    this.state.labelLayers.set(cacheKey, {props: this.props, byStyleLayer});
    return layers;
  }

  /**
   * Label layers draw the labels of several tiles, and are not culled by tile; with several views,
   * each view draws its own.
   */
  filterSubLayer(context: any): boolean {
    const {layer} = context;
    if (layer.props.tile) {
      return super.filterSubLayer(context);
    }
    const viewKey = labelLayerViews.get(layer);
    return viewKey === null || viewKey === undefined || viewKey === getViewKey(context.viewport);
  }

  /**
   * A picked label reports the tile of its feature, which `SharedMVTLayer` converts from: on a map
   * the recorded features are tile-local, on a globe in longitude/latitude.
   */
  getPickingInfo(params: any): any {
    const {sourceLayer} = params;
    if (sourceLayer && !sourceLayer.props.tile) {
      const coordinateSystem = isGlobeViewport(this.context.viewport)
        ? COORDINATE_SYSTEM.LNGLAT
        : COORDINATE_SYSTEM.CARTESIAN;
      const info = super.getPickingInfo({
        ...params,
        sourceLayer: {props: {tile: params.info.tile, coordinateSystem}}
      });
      info.sourceTileSubLayer = sourceLayer;
      return info;
    }
    return super.getPickingInfo(params);
  }

  /**
   * A hidden tile that has no sublayers yet gets them when it is shown. A tile's new sublayers can
   * keep those it last rendered (see `getTileGeoJsonLayer`).
   */
  renderSubLayers(props: Parameters<SharedMVTLayer['renderSubLayers']>[0]) {
    if (!this.isTileShown(props.tile)) {
      this.state.staleTiles?.add(props.tile.id);
      return null;
    }
    this.state.zoomPaintContext ||= new ZoomPaintContext();
    const {zoomPaintContext} = this.state;
    zoomPaintContext.setStyle((this.props as {paintStyle?: unknown}).paintStyle);
    zoomPaintContext.zoom = getZoomBucket((this.props as {styleZoom?: number}).styleZoom ?? 0);
    // The tile's label features, recorded as `renderSubLayers` filters them.
    const labelFeatures = new Map<number, any[]>();
    this.state.tileLabelFeatures ||= new Map();
    this.state.tileLabelFeatures.set(props.tile.id, labelFeatures);
    (props as any)[TILE_LABEL_FEATURES] = labelFeatures;
    const previous = this.state.keptTileLayers?.get(props.tile.id);
    // `SharedMVTLayer` turns `autoHighlight` off for the tile sublayers, which it highlights itself.
    return super.renderSubLayers({
      ...props,
      [ZOOM_PAINT_CONTEXT]: this.context.device?.type === 'webgpu' ? null : zoomPaintContext,
      [PREVIOUS_TILE_LAYERS]: previous
        ? new Map(previous.map((layer: Layer) => [layer.id, layer]))
        : undefined,
      [AUTO_HIGHLIGHT]: Boolean(this.props.autoHighlight)
    } as typeof props);
  }

  _onTileLoad(tile: any): void {
    this.forgetTile(tile);
    super._onTileLoad(tile);
  }

  _onTileUnload(tile: any): void {
    this.forgetTile(tile);
    super._onTileUnload(tile);
  }

  /**
   * Drops what this layer kept for tiles that left the shared tileset, or were replaced in it by
   * another tile of the same id, including the sublayers `SharedTile2DLayer` holds for that id.
   * `reloadAll` removes tiles without an unload event, and deck.gl then finalizes their sublayers,
   * which must not be handed back.
   */
  private forgetRemovedTiles(tiles: SharedTile[]): void {
    let {keptTiles} = this.state;
    if (!keptTiles) {
      keptTiles = new Map();
      this.state.keptTiles = keptTiles;
    }
    const live = new Map(tiles.map(tile => [tile.id, tile]));
    for (const [id, tile] of keptTiles) {
      if (live.get(id) !== tile) {
        keptTiles.delete(id);
        this.forgetTile({id} as SharedTile);
        this.state.tileLayers.delete(id);
      }
    }
    for (const tile of tiles) {
      keptTiles.set(tile.id, tile);
    }
  }

  /** Drops a tile's kept sublayers, when its content is replaced or evicted. */
  private forgetTile(tile: SharedTile): void {
    this.state.keptTileLayers?.delete(tile.id);
    this.state.staleTiles?.delete(tile.id);
    this.state.tileLabelFeatures?.delete(tile.id);
  }

  /** Releases the shared tileset and the textures of `ZoomPaintExtension`. */
  finalizeState(): void {
    super.finalizeState();
    this.releaseSourceTileset();
    this.state.zoomPaintContext?.destroy();
  }

  private releaseSourceTileset(): void {
    const owner = this.state.sourceTilesetOwner;
    if (owner) {
      owner.consumers.delete(this.state);
      if (!owner.consumers.size) owner.tileset.finalize();
      this.state.sourceTilesetOwner = undefined;
    }
  }

  static layerName = 'StyledMVTLayer';
  static defaultProps = {
    ...SharedMVTLayer.defaultProps,
    // A new function at each update, as `renderSubLayers`: compared, it would regenerate every tile.
    renderLabelLayers: {type: 'function', optional: true, value: null, compare: false}
  } as any;
}

/**
 * A `GeoJsonLayer` that creates only the sublayers its style layer type draws. Fill, line and
 * fill-extrusion layers draw no points; a line layer draws polygons as their outlines only; and
 * `drawsLineStrings: false` leaves out line strings, which a fill without an outline would draw
 * zero pixels wide. Every sublayer left out would otherwise be updated and drawn at every frame.
 */
class StyledGeoJsonLayer extends GeoJsonLayer<any, {drawsLineStrings?: boolean}> {
  static layerName = 'StyledGeoJsonLayer';
  static defaultProps = {...GeoJsonLayer.defaultProps, drawsLineStrings: true};

  /**
   * `TileLayer` clones each tile sublayer to add the tile's own props. A sublayer kept from the
   * tile's previous sublayers has them already, and stays the same instance.
   */
  clone(newProps: Record<string, unknown>) {
    if (keptTileLayers.has(this)) {
      keptTileLayers.delete(this);
      const props = this.props as Record<string, unknown>;
      if (Object.keys(newProps).every(key => props[key] === newProps[key])) {
        return this;
      }
    }
    const layer = super.clone(newProps);
    const inputs = tileLayerInputs.get(this);
    if (inputs) {
      tileLayerInputs.set(layer, 'tile' in newProps ? inputs : {...inputs, ...newProps});
    }
    return layer;
  }

  protected shouldRenderSubLayer(subLayerId: string, data: any): boolean {
    if (
      subLayerId.startsWith('points-') ||
      (subLayerId === 'polygons-fill' && !this.props.filled) ||
      (subLayerId === 'polygons-stroke' && !this.props.stroked) ||
      (subLayerId === 'linestrings' && !this.props.drawsLineStrings)
    ) {
      return false;
    }
    return super.shouldRenderSubLayer(subLayerId, data);
  }
}

/** The prop that hands a tile's previous sublayers, by id, to `renderSubLayers`. */
const PREVIOUS_TILE_LAYERS = 'previousTileLayers';
/** The props each tile sublayer was created with, for `getTileGeoJsonLayer`. */
const tileLayerInputs = new WeakMap<object, Record<string, unknown>>();
/** Previous tile sublayers that `getTileGeoJsonLayer` has just kept, until `TileLayer` adds them. */
const keptTileLayers = new WeakSet<object>();

/**
 * Whether two prop values are the same to deck.gl: equal, or arrays and plain objects of the
 * same values, or objects that `equals` each other (deck.gl's layer extensions and matrices).
 */
function isSameValue(a: any, b: any, depth = 3): boolean {
  if (a === b) {
    return true;
  }
  if (depth === 0 || !a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) || ArrayBuffer.isView(a)) {
    if (!(Array.isArray(b) || ArrayBuffer.isView(b))) {
      return false;
    }
    const x = a as unknown as ArrayLike<unknown>;
    const y = b as unknown as ArrayLike<unknown>;
    if (x.length !== y.length) {
      return false;
    }
    for (let i = 0; i < x.length; i++) {
      if (!isSameValue(x[i], y[i], depth - 1)) {
        return false;
      }
    }
    return true;
  }
  if (Object.getPrototypeOf(a) !== Object.prototype) {
    return a.constructor === b.constructor && typeof a.equals === 'function' && a.equals(b);
  }
  // Functions in a nested object are not accessors: they must be the same.
  return Object.getPrototypeOf(b) === Object.prototype && isSameProps(a, b, depth - 1, false);
}

/**
 * Whether two sets of layer props are the same to deck.gl. Per-feature accessors (`get*`) that
 * are both functions count as the same, unless `accessors` is false: with the same data, deck.gl
 * reads them again only when their update trigger, compared with the other props, changes.
 */
export function isSameProps(
  a: Record<string, any>,
  b: Record<string, any>,
  depth = 3,
  accessors = true
): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (const key of keys) {
    if (!(key in b)) {
      return false;
    }
    const x = a[key];
    const y = b[key];
    const isAccessor =
      accessors && key.startsWith('get') && typeof x === 'function' && typeof y === 'function';
    // deck.gl compares data by identity, and recomputes every accessor for new data.
    if (key === 'data' ? x !== y : !isAccessor && !isSameValue(x, y, depth)) {
      return false;
    }
  }
  return true;
}

/**
 * A fill, line or fill-extrusion sublayer of a tile. Tile sublayers regenerate at every style
 * zoom step, while many of them, a constant fill or a line whose width does not change between
 * the two steps, get the same props as before. Such a sublayer keeps the instance the tile last
 * rendered, which deck.gl then neither diffs nor updates; a new one would be created, cloned by
 * `TileLayer`, matched and diffed, only to change nothing.
 */
function getTileGeoJsonLayer(tileProps: any, props: Record<string, any>): StyledGeoJsonLayer {
  const previous = (tileProps[PREVIOUS_TILE_LAYERS] as Map<string, any> | undefined)?.get(props.id);
  const inputs = previous && tileLayerInputs.get(previous);
  if (inputs && isSameProps(props, inputs)) {
    keptTileLayers.add(previous);
    return previous;
  }
  const layer = new StyledGeoJsonLayer(props);
  tileLayerInputs.set(layer, props);
  return layer;
}

/** Whether a style accessor is a constant, fully transparent color. */
function isTransparent(color: StyleAccessor<number[]>): boolean {
  return typeof color.value !== 'function' && !(color.value[3] > 0);
}

function createStyledVectorSubLayer({
  idPrefix,
  sourceId,
  styleLayer,
  features,
  props,
  zoom,
  config,
  mode,
  depthTested,
  collisionPriorityRange,
  spriteAtlases,
  loadOptions,
  fontFamily,
  glyphs,
  labelPlacement,
  light
}: {
  idPrefix: string;
  sourceId: string;
  styleLayer: BasemapStyleLayer;
  features: any[];
  props: any;
  zoom: number;
  config: BasemapLayerConfig;
  mode: BasemapMode;
  /** Drawn after an extrusion, see `getTileParameters`. */
  depthTested?: boolean;
  collisionPriorityRange?: [number, number];
  spriteAtlases?: SpriteAtlas[] | null;
  loadOptions?: BasemapLoadOptions;
  fontFamily?: LabelFontFamily | null;
  /** The style's glyphs, which labels are drawn with (see `MVTLabelLayerProps.glyphs`). */
  glyphs?: GlyphStore | null;
  /** The label placement shared by the map's label layers (see `LabelPlacement`). */
  labelPlacement?: LabelPlacement | null;
  /** The style's `light`, which shades `fill-extrusion` layers. */
  light?: FillExtrusionLight;
}) {
  if (features.length === 0) {
    return null;
  }

  if (styleLayer.type === 'symbol') {
    const paint = getPaint(styleLayer, zoom);
    return createSymbolSubLayer({
      props,
      styleLayer,
      features,
      config,
      mode,
      zoom,
      opacity: 1,
      paint,
      collisionPriorityRange,
      spriteAtlases,
      loadOptions,
      fontFamily,
      glyphs,
      labelPlacement
    });
  }

  if (styleLayer.type === 'circle') {
    return createCircleSubLayer({
      baseProps: getSubLayerBaseProps(props),
      id: getStyleSubLayerId(props.id, styleLayer.id),
      styleLayer,
      features,
      zoom,
      globe: mode === 'globe',
      // Depth-tested against the globe without writing depth: a circle's quad, blur and
      // antialiased edge included, would otherwise cut holes in the circles drawn after it.
      // Circles face the viewer, so back-face culling does not hide those on the far side.
      parameters: {
        ...getTileParameters(mode),
        depthTest: true,
        depthCompare: 'less-equal',
        depthWriteEnabled: false
      }
    });
  }

  if (styleLayer.type === 'fill-extrusion') {
    return createExtrusionSubLayer({props, styleLayer, features, zoom, light});
  }

  if (styleLayer.type === 'line') {
    return createLineSubLayers({props, styleLayer, features, mode, zoom, depthTested});
  }

  if (styleLayer.type === 'fill' && styleLayer.paint?.['fill-pattern'] !== undefined) {
    const groups = getFillPatternGroups(features, styleLayer, zoom, spriteAtlases);
    if (groups.length > 0) {
      const layers = groups.map(pattern =>
        createGeometrySubLayer({
          props,
          styles: [
            getGeometryStyle({
              styleLayer,
              features: pattern.features,
              mode,
              zoom,
              depthTested,
              pattern
            })
          ],
          mode,
          idSuffix: groups.length > 1 ? `-pattern-${pattern.atlasIndex}` : ''
        })
      );
      // Features whose image is missing draw no fill, but keep their outline, as in MapLibre.
      const unpatterned = getFeaturesWithoutPattern(features, groups);
      if (unpatterned.length > 0 && styleLayer.paint?.['fill-outline-color'] !== undefined) {
        layers.push(
          createGeometrySubLayer({
            props,
            styles: [
              getGeometryStyle({styleLayer, features: unpatterned, mode, zoom, depthTested})
            ],
            mode,
            idSuffix: '-missing-pattern'
          })
        );
      }
      return layers;
    }
  }

  return createGeometrySubLayer({
    props,
    styles: [getGeometryStyle({styleLayer, features, mode, zoom, depthTested})],
    mode
  });
}

function createVectorLayerGroup({
  idPrefix,
  id,
  sourceId,
  source,
  tileset,
  styleLayers,
  zoom,
  config,
  loadOptions,
  mode,
  sourceTilesetOwner,
  depthTestedFrom = -1,
  labelPriorityRanges,
  styleDefinition,
  spriteAtlases,
  fontFamily,
  glyphs,
  labelPlacement
}: {
  idPrefix: string;
  id: string;
  sourceId: string;
  source: BasemapSource;
  /** Shared with the source's other runs, if it has any. */
  tileset?: SharedTileset2D | null;
  sourceTilesetOwner?: SourceTilesetOwner;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
  config: BasemapLayerConfig;
  loadOptions?: BasemapLoadOptions;
  mode: BasemapMode;
  /** The first of `styleLayers` drawn after an extrusion, if any; see `getTileParameters`. */
  depthTestedFrom?: number;
  labelPriorityRanges?: Map<BasemapStyleLayer, [number, number]>;
  /** The resolved style, compared by identity to regenerate tiles when the style changes. */
  styleDefinition?: ResolvedBasemapStyle;
  /** Sprites for `icon-image`; tiles regenerate when they finish loading. */
  spriteAtlases?: SpriteAtlas[] | null;
  /** Label font override; tiles regenerate when it changes. */
  fontFamily?: LabelFontFamily | null;
  /** The style's glyphs, which labels are drawn with (see `MVTLabelLayerProps.glyphs`). */
  glyphs?: GlyphStore | null;
  /** The label placement shared by the map's label layers (see `LabelPlacement`). */
  labelPlacement?: LabelPlacement | null;
}) {
  const filterSnapshots = new FilterSnapshots();

  return new StyledMVTLayer({
    id: `${idPrefix}-${id}`,
    data: tileset || source.tiles,
    ...{sourceTilesetOwner},
    // The tile pyramid's range; style layers are gated by their own range in renderSubLayers.
    ...getTilePyramidProps(source),
    // The zoom at which `renderSubLayers` evaluates paint, which `ZoomPaintExtension` also uses.
    styleZoom: zoom,
    // The style layers whose paint `ZoomPaintExtension` draws (see `ZoomPaintContext.setStyle`).
    paintStyle: styleDefinition?.layers,
    tileSize: source.tileSize || 512,
    zoomOffset: VECTOR_TILE_ZOOM_OFFSET,
    loadOptions: {
      ...(loadOptions || {}),
      mvt: {
        ...((loadOptions?.mvt as Record<string, unknown> | undefined) || {}),
        shape: 'geojson-table'
      }
    },
    onTileError: error => {
      logBasemapRuntimeError('Vector tile layer failed', error, {
        sourceId
      });
    },
    onTileLoad: tile => {
      const features = Array.isArray(tile.content) ? tile.content : [];
      if (features.length === 0) {
        logBasemapRuntimeEvent('Loaded empty vector tile', {
          sourceId,
          tileIndex: tile.index
        });
      }
    },
    parameters: getTileParameters(mode),
    // `renderSubLayers` reads `zoom` and the style: regenerate tile sublayers at each style zoom
    // step (evaluation and filters), at fractional layer limits (visibility), and when the style
    // changes. Two styles can share a source id and so this layer's id; deck.gl compares the
    // style by identity.
    updateTriggers: {
      renderSubLayers: [
        getStyleZoomKey(zoom, getStyleZoomLimits(styleLayers)),
        // Changes when an extrusion in another run crosses its zoom limits.
        depthTestedFrom,
        styleDefinition,
        spriteAtlases,
        fontFamily,
        glyphs,
        labelPlacement
      ]
    },
    renderLabelLayers: ((tilesByStyleLayer, getSubLayerProps, hidden) =>
      [...tilesByStyleLayer].flatMap(([styleLayerIndex, tiles]) => {
        const styleLayer = styleLayers[styleLayerIndex];
        // An index the tile layer kept from another style has no style layer here.
        if (!styleLayer) {
          return [];
        }
        return createSymbolSubLayer({
          props: {
            ...getSubLayerProps(`labels-${JSON.stringify(styleLayer.id)}`),
            // A label layer kept without features (see `renderViewLabelLayers`) is not drawn.
            ...(hidden.has(styleLayerIndex) ? {visible: false} : {}),
            [STYLE_LAYER_INDEX]: styleLayerIndex
          },
          styleLayer,
          features: [],
          tiles,
          config,
          mode,
          zoom,
          opacity: 1,
          paint: getPaint(styleLayer, zoom),
          collisionPriorityRange: labelPriorityRanges?.get(styleLayer),
          spriteAtlases,
          loadOptions,
          fontFamily,
          glyphs,
          labelPlacement
        });
      })) as RenderLabelLayers,
    renderSubLayers: props => {
      const features = getTileFeatures(props.data);
      const layers: any[] = [];
      // Where the tile layer collects them, a tile's labels are drawn with the other tiles'.
      const labelFeatures = (props as any)[TILE_LABEL_FEATURES] as Map<number, any[]> | undefined;
      const highlights =
        Boolean(props[AUTO_HIGHLIGHT]) ||
        (props.highlightedFeatureId !== null && props.highlightedFeatureId !== undefined);
      // Fills and lines take zoom-dependent paint from a texture (see `createGeometrySubLayer`).
      const zoomPaintContext = props[ZOOM_PAINT_CONTEXT] as ZoomPaintContext | null | undefined;
      // Consecutive fills and lines that can share a sublayer (see `getBatchKey`), and the index
      // of the first, which places the batch among all tiles' sublayers (`sortTileSubLayers`).
      let batch: GeometryStyle[] = [];
      let batchIndex = 0;
      const flush = () => {
        if (batch.length > 0) {
          layers.push(
            createGeometrySubLayer({
              props: {...props, [STYLE_LAYER_INDEX]: batchIndex},
              styles: batch,
              mode
            })
          );
          batch = [];
        }
      };

      styleLayers.forEach((styleLayer, styleLayerIndex) => {
        if (!isStyleLayerVisibleAtZoom(styleLayer, zoom)) {
          return;
        }

        const filteredData = filterTileFeatures(features, styleLayer, zoom, filterSnapshots);

        if (features.length > 0 && filteredData.length === 0) {
          logBasemapRuntimeEvent('Vector tile rendered no matching features', {
            sourceId,
            layerId: styleLayer.id,
            sourceLayer: styleLayer['source-layer'],
            tileIndex: props.tile?.index
          });
        }
        if (filteredData.length === 0) {
          if (styleLayer.type === 'symbol' && labelFeatures) {
            // The tile still covers its parent's labels (see `combineTileRows`).
            labelFeatures.set(styleLayerIndex, NO_FEATURES);
            return;
          }
          // A fill or line without features in this tile does not separate its neighbours. Any
          // other style layer does, even here: it may draw in a neighbouring tile, and all tiles
          // draw it after this batch, as in MapLibre.
          if (styleLayer.type !== 'fill' && styleLayer.type !== 'line') {
            flush();
          }
          return;
        }

        const depthTested = depthTestedFrom >= 0 && styleLayerIndex >= depthTestedFrom;
        // A sublayer draws its features in order: a line layer's, in the order of their keys.
        const layerFeatures =
          styleLayer.type === 'line'
            ? sortFeaturesByKey(filteredData, styleLayer, 'line-sort-key', zoom)
            : filteredData;
        const style = getBatchableGeometryStyle(styleLayer, layerFeatures, mode, zoom, depthTested);
        if (style) {
          // A style layer that draws nothing in this tile does not separate its neighbours. A line
          // that draws nothing only because its width is 0 at this zoom step, and takes its width
          // from `ZoomPaintExtension`, is batched as at a step that gives it a width: its sublayer
          // and batch stay the same across the step, and are not made again (see
          // `createGeometrySubLayer`, which hides a sublayer that draws nothing).
          const isKeptAtZeroWidth = style.isZeroWidth && Boolean(zoomPaintContext);
          if (style.drawsFill || style.drawsLines || isKeptAtZeroWidth) {
            // A batch draws all of its style layers in one tile before the next tile. On a map,
            // tiles are clipped to their bounds, so that draws the same pixels as each style layer
            // across all tiles in turn; on the globe, tiles are not clipped, and where their
            // buffers overlap a tile's later style layer would draw under a neighbour's earlier one.
            // A highlight colors one object of a sublayer: in a batch, a feature drawn by two
            // style layers would be highlighted only under the second one's copy.
            const key = mode === 'globe' || highlights ? null : getBatchKey(style);
            if (!canBatch(batch, style, key)) {
              flush();
              batchIndex = styleLayerIndex;
            }
            batch.push(style);
            if (key === null) {
              flush();
            }
          }
          return;
        }

        if (styleLayer.type === 'symbol' && labelFeatures) {
          // Drawn with the labels of the other tiles, after all tiles' sublayers.
          labelFeatures.set(styleLayerIndex, filteredData);
          return;
        }
        flush();
        layers.push(
          createStyledVectorSubLayer({
            idPrefix,
            sourceId,
            styleLayer,
            features: layerFeatures,
            props: {...props, [STYLE_LAYER_INDEX]: styleLayerIndex},
            zoom,
            config,
            mode,
            depthTested,
            collisionPriorityRange: labelPriorityRanges?.get(styleLayer),
            spriteAtlases,
            loadOptions,
            fontFamily,
            glyphs,
            labelPlacement,
            light: getFillExtrusionLight(styleDefinition, zoom)
          })
        );
      });
      flush();

      return layers.flat().filter(layer => Boolean(layer)) as any;
    }
  } as any);
}

function inferWaterColor(
  styleLayers: BasemapStyleLayer[],
  zoom: number
): [number, number, number, number] {
  const waterLayer = styleLayers.find(
    layer => layer.type === 'fill' && `${layer['source-layer'] || ''}`.includes('water')
  );

  if (!waterLayer) {
    return [20, 40, 68, 255];
  }

  const paint = getPaint(waterLayer, zoom);
  return withOpacity(paint['fill-color'], paint['fill-opacity'] ?? 1);
}

/** All style-layer `minzoom`/`maxzoom` limits in a style. */
export function getStyleDefinitionZoomLimits(
  styleDefinition: BasemapLayerGroup['styleDefinition']
): (number | undefined)[] {
  return getStyleZoomLimits(styleDefinition.layers || []);
}

export function getBasemapLayers({
  idPrefix = 'basemap',
  mode = 'map',
  globe,
  styleDefinition,
  zoom = 0,
  loadOptions,
  spriteAtlases,
  fontFamily,
  glyphs,
  labelPlacement,
  tilesets
}: BasemapLayerGroup) {
  const config = getConfig(globe);
  const styleLayers = (styleDefinition.layers || []).filter(layer =>
    SUPPORTED_TYPES.has(layer.type)
  );
  const layers: any[] = [];
  logBasemapRuntimeEvent('Generating basemap layers', {
    mode,
    styleLayerCount: styleLayers.length,
    sourceCount: Object.keys(styleDefinition.sources || {}).length
  });

  layers.push(...getGlobePreLayers({idPrefix, mode, config, styleLayers, zoom}));

  if (config.basemap) {
    layers.push(
      ...getStyleLayers({
        idPrefix,
        styleLayers,
        styleDefinition,
        zoom,
        config,
        loadOptions,
        mode,
        spriteAtlases,
        fontFamily,
        glyphs,
        labelPlacement,
        tilesets
      })
    );
  }

  layers.push(...getGlobePostLayers({idPrefix, mode, config, styleLayers, zoom}));

  return layers.filter(layer => Boolean(layer));
}

export function getGlobeBaseLayers({
  globe,
  styleDefinition,
  idPrefix = 'globe-basemap',
  zoom = 0,
  loadOptions,
  spriteAtlases,
  fontFamily,
  glyphs,
  labelPlacement
}: Omit<BasemapLayerGroup, 'mode'>) {
  return getBasemapLayers({
    idPrefix,
    mode: 'globe',
    globe,
    styleDefinition,
    zoom,
    loadOptions,
    spriteAtlases,
    fontFamily,
    glyphs,
    labelPlacement
  });
}

export function getGlobeTopLayers({globe}: {globe: {config: BasemapGlobeConfig}}) {
  const {config} = globe;
  return config.atmosphere ? [getGlobeAtmosphereLayer()] : [];
}

function createSymbolSubLayer({
  props,
  styleLayer,
  features,
  config,
  mode,
  zoom,
  opacity,
  paint,
  collisionPriorityRange,
  spriteAtlases,
  loadOptions,
  fontFamily,
  glyphs,
  labelPlacement,
  tiles
}: {
  props: any;
  styleLayer: BasemapStyleLayer;
  features: any[];
  /** The label features of several tiles, drawn together instead of `features`. */
  tiles?: LabelTile[];
  config: BasemapLayerConfig;
  mode: BasemapMode;
  zoom: number;
  opacity: number;
  paint: Record<string, any>;
  collisionPriorityRange?: [number, number];
  spriteAtlases?: SpriteAtlas[] | null;
  loadOptions?: BasemapLoadOptions;
  fontFamily?: LabelFontFamily | null;
  /** The style's glyphs, which labels are drawn with (see `MVTLabelLayerProps.glyphs`). */
  glyphs?: GlyphStore | null;
  /** The label placement shared by the map's label layers (see `LabelPlacement`). */
  labelPlacement?: LabelPlacement | null;
}) {
  return new MVTLabelLayer({
    ...getSubLayerBaseProps(props),
    id: tiles ? props.id : getStyleSubLayerId(props.id, styleLayer.id),
    ...(tiles ? {tiles} : {data: features}),
    config,
    mode,
    styleLayer,
    collisionPriorityRange,
    spriteAtlases,
    // The sprite atlas images load through the same fetch as the style and its tiles.
    iconLoadOptions: loadOptions,
    fontFamily,
    glyphs,
    labelPlacement,
    // Polygon labels outside the tile's own extent are left to the neighbouring tile.
    tileBoundingBox: props.tile?.bbox ?? null,
    // Labels along lines are spaced in pixels at the tile's own zoom.
    tileZoom: props.tile?.index?.z ?? null,
    tileSize: props.tileSize ?? null,
    zoom: getZoomBucket(zoom),
    // The style spec's default `text-color` is black.
    textColor: withOpacity(paint['text-color'] ?? DEFAULT_TEXT_COLOR, opacity),
    billboard: true
  });
}

/**
 * Converts a style `line-dasharray` into deck.gl's `[dash, gap]`. MapLibre measures dashes in line
 * widths; deck.gl's `widths` unit is half the line width, so lengths double. deck.gl draws one dash
 * and one gap per period, so a longer pattern keeps its period and total dash length, but merges
 * its dashes. In an odd-length pattern the last dash runs into the first, as in MapLibre. An empty
 * pattern, or one without gaps, draws a solid line.
 */
export function getDashArray(dasharray: unknown): [number, number] {
  if (!Array.isArray(dasharray)) {
    return [0, 0];
  }
  let dash = 0;
  let gap = 0;
  dasharray.forEach((value, index) => {
    const length = Math.max(0, Number(value) || 0);
    if (index % 2 === 0) {
      dash += length;
    } else {
      gap += length;
    }
  });
  return [dash * 2, gap * 2];
}

/** The least distance, in pixels, of a gap's line from the gap's center: see getLineOffset. */
export const MIN_GAP_LINE_CENTER = 0.01;

/**
 * Converts `line-offset` and `line-gap-width` into deck.gl's `getOffset`, which is in line widths.
 * A gap draws two lines of `width` with their centers `gapWidth / 2 + width / 2` either side of
 * the offset line: `side` is 1 or -1 for them. Without a gap, `side` is ignored. Positive is to
 * the right of the line's direction in both. Dividing by `width` assumes deck.gl draws the line
 * `width` pixels wide, that is, no `lineWidthMinPixels`/`lineWidthMaxPixels` clamp applies.
 *
 * deck.gl offsets by widening the stroke and masking it across the line, not by offsetting the
 * path, so the outside of a sharp corner breaks open and the two lines of a gap end in separate
 * stubs rather than one cap. Offsetting the path belongs in deck.gl's `PathStyleExtension`.
 */
export function getLineOffset(
  offset: number,
  gapWidth: number,
  width: number,
  side: number,
  blur = 0
): number {
  if (!(width > 0)) {
    return 0;
  }
  // A blurred gap's lines are drawn `blur` wider and `blur / 2` closer: see getBlurredLineWidth.
  const drawnWidth = getBlurredLineWidth(width, gapWidth, blur);
  let center = gapWidth > 0 ? gapWidth / 2 + width - drawnWidth / 2 : 0;
  // A line of a gap is never centered on the gap's center, where it would be as wide as
  // `line-blur` is `line-width` plus `line-gap-width`: LineBlurExtension clips only lines off
  // the center, since a line without a gap is centered on it.
  if (gapWidth > 0 && Math.abs(center) < MIN_GAP_LINE_CENTER) {
    center = MIN_GAP_LINE_CENTER;
  }
  return (offset + side * center) / drawnWidth;
}

/**
 * Scales a blurred gap's `getDashArray` by `width / drawnWidth` (see `getBlurredLineWidth`), so
 * that its dashes keep the pixel lengths MapLibre gives them in `line-width`s. `shape` is the
 * `[offset, gap, width, blur]` accessor of `getLineOffset`.
 */
export function getBlurredDashArray(
  dashArray: StyleAccessor<[number, number]>,
  shape: StyleAccessor<[number, number, number, number]>
): {value: [number, number] | ((feature: any) => [number, number]); updateTrigger?: unknown[]} {
  const scale = (
    [dash, gap]: [number, number],
    [, gapWidth, width, blur]: [number, number, number, number]
  ): [number, number] => {
    const drawnWidth = getBlurredLineWidth(width, gapWidth, blur);
    const ratio = drawnWidth > 0 ? width / drawnWidth : 1;
    return [dash * ratio, gap * ratio];
  };
  const dashValue = dashArray.value;
  const shapeValue = shape.value;
  if (typeof dashValue !== 'function' && typeof shapeValue !== 'function') {
    return {value: scale(dashValue, shapeValue)};
  }
  return {
    value: (feature: any) =>
      scale(
        typeof dashValue === 'function' ? dashValue(feature) : dashValue,
        typeof shapeValue === 'function' ? shapeValue(feature) : shapeValue
      ),
    // The parts that are constants change by value; the others have their triggers.
    updateTrigger: [
      ...(typeof dashValue === 'function' ? [dashArray.updateTrigger] : dashValue),
      ...(typeof shapeValue === 'function' ? [shape.updateTrigger] : shapeValue)
    ]
  };
}

/** deck.gl path props for a line's `line-cap`, `line-join` and `line-miter-limit`. */
export type LineShape = {
  lineCapRounded: boolean;
  lineJointRounded: boolean;
  lineMiterLimit: number;
};

/**
 * Converts `line-cap`, `line-join` and `line-miter-limit` into deck.gl path props.
 *
 * - `round` caps and joins are drawn round. `butt` caps end at the endpoint. deck.gl has no square
 *   cap, so `square` is drawn as `butt`: the line ends half its width short of MapLibre's.
 * - deck.gl cuts a joint flat at `miterLimit + 1` half widths from the vertex. MapLibre draws a
 *   `miter` join in full while its tip is within `line-miter-limit` half widths of the vertex, so
 *   passing `line-miter-limit - 1` draws the same joins in full. A sharper corner, which MapLibre
 *   bevels, is cut flat at that distance instead.
 * - deck.gl has no bevel join. A `bevel` join is cut flat half the line width from the vertex,
 *   which matches a bevel at shallow corners; at sharp corners a true bevel cuts closer.
 */
export function getLineShape([cap, join, miterLimit]: unknown[]): LineShape {
  const lineJoin = join ?? getStylePropertyDefault('line-join');
  const limit = Number(miterLimit ?? getStylePropertyDefault('line-miter-limit'));
  return {
    lineCapRounded: (cap ?? getStylePropertyDefault('line-cap')) === 'round',
    lineJointRounded: lineJoin === 'round',
    lineMiterLimit: lineJoin === 'miter' && Number.isFinite(limit) ? Math.max(0, limit - 1) : 0
  };
}

/** The sublayers for a `line` style layer: one, or one per shape when the shape is per feature. */
function createLineSubLayers({
  props,
  styleLayer,
  features,
  mode,
  zoom,
  depthTested
}: {
  props: any;
  styleLayer: BasemapStyleLayer;
  features: any[];
  mode: BasemapMode;
  zoom: number;
  depthTested?: boolean;
}) {
  const lineShape = getLineShapeAccessor(styleLayer, zoom);
  if (typeof lineShape.value !== 'function') {
    return createGeometrySubLayer({
      props,
      styles: [
        getGeometryStyle({
          styleLayer,
          features,
          mode,
          zoom,
          depthTested,
          lineShape: lineShape.value
        })
      ],
      mode
    });
  }

  return getLineShapeGroups(features, styleLayer, lineShape).map(group =>
    createGeometrySubLayer({
      props,
      styles: [
        getGeometryStyle({
          styleLayer,
          features: group.features,
          mode,
          zoom,
          depthTested,
          lineShape: group.shape
        })
      ],
      mode,
      idSuffix: `-${group.key}`
    })
  );
}

function getLineShapeAccessor(styleLayer: BasemapStyleLayer, zoom: number) {
  return getStyleAccessor(
    styleLayer,
    ['line-cap', 'line-join', 'line-miter-limit'],
    zoom,
    getLineShape
  );
}

/**
 * The style of a fill, or of a line with one shape for all features: the style layers that can
 * share a sublayer with their neighbours (see `getBatchKey`). Null for other style layers.
 */
function getBatchableGeometryStyle(
  styleLayer: BasemapStyleLayer,
  features: any[],
  mode: BasemapMode,
  zoom: number,
  depthTested: boolean
): GeometryStyle | null {
  if (styleLayer.type === 'fill') {
    // A patterned fill draws a sublayer per sprite atlas of its images (see `getFillPatternGroups`).
    return styleLayer.paint?.['fill-pattern'] !== undefined
      ? null
      : getGeometryStyle({styleLayer, features, mode, zoom, depthTested});
  }
  if (styleLayer.type !== 'line') {
    return null;
  }
  const lineShape = getLineShapeAccessor(styleLayer, zoom);
  return typeof lineShape.value === 'function'
    ? null
    : getGeometryStyle({styleLayer, features, mode, zoom, depthTested, lineShape: lineShape.value});
}

type LineShapeGroup = {key: string; shape: LineShape; features: any[]};

/** The latest line shape groups per tile content and style layer. */
const lineShapeGroupCache = new WeakMap<
  any[],
  WeakMap<BasemapStyleLayer, {key: unknown[]; groups: LineShapeGroup[]}>
>();

/**
 * Splits features by their per-feature line shape, since deck.gl applies caps and joins to a
 * whole layer. Groups are in the order each shape first appears, so features draw group by group
 * rather than in source order. The groups, and so their feature arrays, are reused while the
 * layout values (and, when they depend on zoom, the style zoom) are unchanged, so deck.gl does not
 * re-tessellate the features at every zoom step.
 */
function getLineShapeGroups(
  features: any[],
  styleLayer: BasemapStyleLayer,
  lineShape: StyleAccessor<LineShape>
): LineShapeGroup[] {
  const key = [
    styleLayer.layout?.['line-cap'],
    styleLayer.layout?.['line-join'],
    styleLayer.layout?.['line-miter-limit'],
    lineShape.updateTrigger
  ];
  let byStyleLayer = lineShapeGroupCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    lineShapeGroupCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (cached && cached.key.every((entry, index) => entry === key[index])) {
    return cached.groups;
  }

  const getShape = lineShape.value as (feature: any) => LineShape;
  const groups = new Map<string, LineShapeGroup>();
  for (const feature of features) {
    const shape = getShape(feature);
    const groupKey = `${shape.lineCapRounded}-${shape.lineJointRounded}-${shape.lineMiterLimit}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {key: groupKey, shape, features: []};
      groups.set(groupKey, group);
    }
    group.features.push(feature);
  }
  const result = [...groups.values()];
  byStyleLayer.set(styleLayer, {key, groups: result});
  return result;
}

/**
 * The extensions and props of `fill-pattern` (with the features' images) and `fill-translate`
 * (when the layer sets it). `fill-translate` is evaluated at the stepped zoom; it cannot depend on
 * feature data.
 */
function getFillStyleProps(
  styleLayer: BasemapStyleLayer,
  zoom: number,
  extensions: any[] | undefined,
  pattern: FillPatternGroup | undefined
) {
  const hasTranslate = styleLayer.paint?.['fill-translate'] !== undefined;
  if (!pattern && !hasTranslate) {
    return {};
  }
  const paint = getPaint(styleLayer, zoom);
  return {
    extensions: [
      ...(extensions || []),
      ...(pattern ? [FILL_PATTERN_EXTENSION] : []),
      ...(hasTranslate ? [FILL_TRANSLATE_EXTENSION] : [])
    ],
    ...(pattern ? getFillPatternProps(pattern, zoom) : {}),
    ...(hasTranslate
      ? {
          fillTranslate: paint['fill-translate'] ?? getStylePropertyDefault('fill-translate'),
          fillTranslateAnchor:
            paint['fill-translate-anchor'] ?? getStylePropertyDefault('fill-translate-anchor')
        }
      : {})
  };
}

/** A fill or line style layer's evaluated paint for the features of one tile. */
type GeometryStyle = {
  styleLayer: BasemapStyleLayer;
  features: any[];
  /** The stepped zoom the paint was evaluated at. */
  zoom: number;
  isLine: boolean;
  isFill: boolean;
  drawsFill: boolean;
  drawsLines: boolean;
  /**
   * Whether the line draws nothing only because its width is 0 at this zoom step. With its paint
   * from `ZoomPaintExtension`, it keeps its place in its sublayer (see `renderSubLayers`).
   */
  isZeroWidth: boolean;
  fillColor: StyleAccessor<number[]>;
  lineColor: StyleAccessor<number[]>;
  lineWidth: StyleAccessor<number>;
  dashArray: StyleAccessor<[number, number]> | null;
  lineOffset: StyleAccessor<[number, number, number, number]> | null;
  gapWidth: StyleAccessor<number> | null;
  lineBlur: StyleAccessor<number> | null;
  /** The `line-offset` at a blurred gap's center, which each side of the gap is drawn from. */
  gapOffset: StyleAccessor<number> | null;
  /** Whether the line is blurred and has a gap, so it draws wider (see `getBlurredLineWidth`). */
  isBlurredGap: boolean;
  /** Whether the fill sets `fill-pattern` or `fill-translate`, which take their own extensions. */
  hasFillStyle: boolean;
  lineShape?: LineShape;
  /** The features' `fill-pattern` images; without it, a patterned fill draws no fill. */
  pattern?: FillPatternGroup;
  /** Whether the style layer draws after an extrusion (see `getTileParameters`). */
  depthTested?: boolean;
};

/** The paint of a fill or line style layer that `ZoomPaintExtension` can apply. */
type GeometryPaint = {
  fillColor: StyleAccessor<number[]>;
  lineColor: StyleAccessor<number[]>;
  lineWidth: StyleAccessor<number>;
  /** Whether a fill draws its outline. */
  hasOutline: boolean;
};

function getGeometryPaint(
  styleLayer: BasemapStyleLayer,
  mode: BasemapMode,
  zoom: number,
  pattern?: FillPatternGroup
): GeometryPaint {
  const isLine = styleLayer.type === 'line';
  const isFill = styleLayer.type === 'fill';

  // A `fill-pattern` disables `fill-color`: the image supplies the colors and `fill-opacity` the
  // opacity, also on a globe. Without its images (sprites loading, or missing) the fill draws
  // nothing rather than its color or the default black.
  const hasFillPattern = isFill && styleLayer.paint?.['fill-pattern'] !== undefined;
  const fillColor = hasFillPattern
    ? pattern
      ? getStyleAccessor(styleLayer, ['fill-opacity'], zoom, ([opacity]) =>
          withOpacity([255, 255, 255, 1], opacity ?? 1)
        )
      : {value: TRANSPARENT_COLOR}
    : getStyleAccessor(styleLayer, ['fill-color', 'fill-opacity'], zoom, ([color, opacity]) =>
        getGlobeFillColor(
          withOpacity(color ?? getStylePropertyDefault('fill-color'), opacity ?? 1),
          mode
        )
      );
  // MapLibre draws a fill's outline only with `fill-antialias`; without `fill-outline-color` the
  // outline is in `fill-color` and only antialiases the edge, which deck.gl's fill does not need.
  const hasOutline =
    isFill &&
    styleLayer.paint?.['fill-outline-color'] !== undefined &&
    getPaint(styleLayer, zoom)['fill-antialias'] !== false;
  const lineColor = isLine
    ? getStyleAccessor(styleLayer, ['line-color', 'line-opacity'], zoom, ([color, opacity]) =>
        withOpacity(color ?? DEFAULT_COLOR, opacity ?? 1)
      )
    : getStyleAccessor(
        styleLayer,
        ['fill-outline-color', 'fill-opacity'],
        zoom,
        ([color, opacity]) => withOpacity(color, opacity ?? 1)
      );
  // A fill's outline is MapLibre's 1 pixel antialiasing line.
  const lineWidth: StyleAccessor<number> = isLine
    ? getStyleAccessor(styleLayer, ['line-width'], zoom, ([width]) =>
        Math.max(0, Number(width ?? 1))
      )
    : {value: hasOutline ? 1 : 0};
  return {fillColor, lineColor, lineWidth, hasOutline};
}

function getGeometryStyle({
  styleLayer,
  features,
  mode,
  zoom,
  depthTested,
  lineShape,
  pattern
}: {
  styleLayer: BasemapStyleLayer;
  features: any[];
  mode: BasemapMode;
  zoom: number;
  depthTested?: boolean;
  lineShape?: LineShape;
  pattern?: FillPatternGroup;
}): GeometryStyle {
  const isLine = styleLayer.type === 'line';
  const isFill = styleLayer.type === 'fill';

  const paint = getGeometryPaint(styleLayer, mode, zoom, pattern);
  const {fillColor, lineColor, hasOutline} = paint;
  const hasDashArray = isLine && styleLayer.paint?.['line-dasharray'] !== undefined;
  const hasOffset =
    isLine &&
    (styleLayer.paint?.['line-offset'] !== undefined ||
      styleLayer.paint?.['line-gap-width'] !== undefined);
  const styleBlur =
    isLine && styleLayer.paint?.['line-blur'] !== undefined
      ? getStyleAccessor(styleLayer, ['line-blur'], zoom, ([blur]) =>
          Math.max(0, Number(blur) || 0)
        )
      : null;
  // A per-feature blur takes a vertex attribute, which a path with dashes and offsets has no room
  // for (see LineBlurExtension): such lines draw sharp.
  const lineBlur =
    styleBlur && (typeof styleBlur.value !== 'function' || !(hasDashArray && hasOffset))
      ? styleBlur
      : null;
  const hasBlur = lineBlur !== null;
  // A blurred gap's lines are drawn wider: see getBlurredLineWidth.
  const isBlurredGap = hasBlur && styleLayer.paint?.['line-gap-width'] !== undefined;
  const lineWidth = isBlurredGap
    ? getStyleAccessor(
        styleLayer,
        ['line-width', 'line-gap-width', 'line-blur'],
        zoom,
        ([width, gap, blur]) =>
          getBlurredLineWidth(
            Math.max(0, Number(width ?? 1)),
            Number(gap ?? 0),
            Math.max(0, Number(blur) || 0)
          )
      )
    : paint.lineWidth;
  // The style spec evaluates zoom in `line-dasharray` at integer zooms only.
  const dashArray: StyleAccessor<[number, number]> | null = hasDashArray
    ? getStyleAccessor(styleLayer, ['line-dasharray'], Math.floor(zoom), ([dasharray]) =>
        getDashArray(dasharray)
      )
    : null;
  const lineOffset = hasOffset
    ? getStyleAccessor<[number, number, number, number]>(
        styleLayer,
        ['line-offset', 'line-gap-width', 'line-width', 'line-blur'],
        zoom,
        ([offset, gap, width, blur]) => [
          Number(offset ?? 0),
          Math.max(0, Number(gap ?? 0)),
          Math.max(0, Number(width ?? 1)),
          hasBlur ? Math.max(0, Number(blur) || 0) : 0
        ]
      )
    : null;
  // Where a wide blur makes a gap's two lines overlap, each draws only its side of the gap's
  // center. That takes the center's `line-offset` for the whole layer.
  const gapOffset = isBlurredGap
    ? getStyleAccessor(styleLayer, ['line-offset'], zoom, ([offset]) => Number(offset ?? 0))
    : null;
  const gapWidth = hasOffset
    ? getStyleAccessor(styleLayer, ['line-gap-width'], zoom, ([gap]) => Number(gap ?? 0))
    : null;
  const hasFillStyle =
    isFill &&
    (styleLayer.paint?.['fill-pattern'] !== undefined ||
      styleLayer.paint?.['fill-translate'] !== undefined);

  // A constant transparent color or zero width draws nothing, so its sublayers are left out.
  const drawsFill = isFill && !isTransparent(fillColor);
  const drawsLines = (isLine || hasOutline) && !isTransparent(lineColor) && lineWidth.value !== 0;
  // A line whose width is 0 at this zoom step, and which draws at the next step or the previous
  // one, is kept for that step (see `renderSubLayers`). One that draws at neither, as many lines
  // do below the zoom where their width starts, or that stays transparent, is left out. Its color
  // at this step does not matter: at width 0 it draws nothing. Lines with an offset or a blur take
  // their width in attributes, not from `ZoomPaintExtension`.
  const isZeroWidth =
    isLine &&
    lineWidth.value === 0 &&
    !hasOffset &&
    !hasBlur &&
    [zoom - STYLE_ZOOM_STEP, zoom + STYLE_ZOOM_STEP].some(stepZoom => {
      const stepPaint = getGeometryPaint(styleLayer, mode, stepZoom);
      return stepPaint.lineWidth.value !== 0 && !isTransparent(stepPaint.lineColor);
    });

  return {
    styleLayer,
    features,
    zoom,
    isLine,
    isFill,
    drawsFill,
    drawsLines,
    isZeroWidth,
    fillColor,
    lineColor,
    lineWidth,
    dashArray,
    lineOffset,
    gapWidth,
    lineBlur,
    gapOffset,
    isBlurredGap,
    hasFillStyle,
    lineShape,
    pattern,
    depthTested
  };
}

/**
 * The key under which consecutive style layers can draw as one sublayer, or null when this one
 * draws alone. Style layers share a sublayer when everything deck.gl applies to a whole layer is
 * the same: a fill without an outline, or a line's cap, join and miter limit. Solid and dashed
 * lines share a sublayer: the solid ones draw with a dash array without gaps. Lines with an
 * offset, a gap or a blur, and fills with a pattern or a translation, draw alone.
 */
function getBatchKey(style: GeometryStyle): string | null {
  if (style.isFill) {
    return style.drawsLines || style.hasFillStyle ? null : 'fill';
  }
  if (style.lineOffset || style.lineBlur || !style.lineShape) {
    return null;
  }
  const {lineCapRounded, lineJointRounded, lineMiterLimit} = style.lineShape;
  return `line-${lineCapRounded}-${lineJointRounded}-${lineMiterLimit}`;
}

/** Whether features include polygons and lines, per tile content and style layer. */
const geometryKindCache = new WeakMap<any[], {polygons: boolean; lines: boolean; length: number}>();

function getGeometryKinds(features: any[]): {polygons: boolean; lines: boolean} {
  let kinds = geometryKindCache.get(features);
  // Content edited in place is looked at again.
  if (!kinds || kinds.length !== features.length) {
    kinds = {polygons: false, lines: false, length: features.length};
    for (const feature of features) {
      const type = feature.geometry?.type;
      kinds.polygons ||=
        type === 'Polygon' || type === 'MultiPolygon' || type === 'GeometryCollection';
      kinds.lines ||=
        type === 'LineString' || type === 'MultiLineString' || type === 'GeometryCollection';
    }
    geometryKindCache.set(features, kinds);
  }
  return kinds;
}

/**
 * Whether `style` can draw in the same sublayer as `batch`, after it. A sublayer draws its
 * features in order, so a batch draws each style layer's features after the previous one's, as
 * MapLibre draws the style layers in turn. The exception is a line sublayer, which draws polygon
 * outlines before line strings: a style layer's polygons cannot follow an earlier one's lines.
 */
function canBatch(batch: GeometryStyle[], style: GeometryStyle, key: string | null): boolean {
  if (batch.length === 0 || key === null || getBatchKey(batch[0]) !== key) {
    return false;
  }
  return !(
    style.isLine &&
    getGeometryKinds(style.features).polygons &&
    batch.some(part => getGeometryKinds(part.features).lines)
  );
}

type FeatureBatch = {
  parts: any[][];
  /** Each part's length when the batch was made: parts edited in place are batched again. */
  lengths: number[];
  data: any[];
  partIndices: Uint16Array;
};

/** The latest concatenated features per tile content and batch. */
const featureBatchCache = new WeakMap<any[], Map<string, FeatureBatch>>();

/**
 * The features of a batch's style layers, in order, and the index of the style layer each one
 * belongs to. The result is reused while every style layer's features are unchanged, so deck.gl
 * does not re-tessellate the batch at every zoom step.
 */
function getFeatureBatch(tileFeatures: any[], id: string, parts: any[][]): FeatureBatch {
  let byId = featureBatchCache.get(tileFeatures);
  if (!byId) {
    byId = new Map();
    featureBatchCache.set(tileFeatures, byId);
  }
  const cached = byId.get(id);
  if (
    cached &&
    cached.parts.length === parts.length &&
    cached.parts.every(
      (features, index) => features === parts[index] && cached.lengths[index] === features.length
    )
  ) {
    return cached;
  }
  const data = parts.flat();
  const partIndices = new Uint16Array(data.length);
  let start = 0;
  parts.forEach((features, index) => {
    partIndices.fill(index, start, start + features.length);
    start += features.length;
  });
  const batch = {parts, lengths: parts.map(features => features.length), data, partIndices};
  byId.set(id, batch);
  return batch;
}

/**
 * One accessor for the features of several style layers: a constant when every style layer's
 * value is the same constant, otherwise a function that applies each feature's own style layer's
 * accessor. Its update trigger changes when any style layer's value or trigger changes.
 */
export function mergeStyleAccessors<T>(
  accessors: StyleAccessor<T>[],
  partIndices: ArrayLike<number>
): {value: T | ((feature: any, info: {index: number}) => T); updateTrigger?: unknown} {
  if (accessors.length === 1) {
    return accessors[0];
  }
  const values = accessors.map(accessor => accessor.value);
  // Tagged, so that a constant and a per-feature trigger of the same text differ.
  const keys = accessors.map(accessor =>
    typeof accessor.value === 'function'
      ? `f:${JSON.stringify(accessor.updateTrigger ?? null)}`
      : `c:${JSON.stringify(accessor.value)}`
  );
  if (values.every(value => typeof value !== 'function') && keys.every(key => key === keys[0])) {
    return {value: values[0] as T};
  }
  return {
    value: (feature: any, {index}: {index: number}) => {
      const value = values[partIndices[index]];
      return typeof value === 'function' ? (value as (feature: any) => T)(feature) : value;
    },
    updateTrigger: keys.join('|')
  };
}

/**
 * The sublayer for one fill or line style layer, or for consecutive style layers that share a
 * batch key (see `getBatchKey`), drawn one after another. A line with a gap adds a second
 * sublayer for the other side of the gap.
 */
function createGeometrySubLayer({
  props,
  styles: allStyles,
  mode,
  idSuffix = ''
}: {
  props: any;
  styles: GeometryStyle[];
  mode: BasemapMode;
  idSuffix?: string;
}) {
  // Paint that is the same for all features of a style layer is taken from a texture (see
  // `ZoomPaintExtension`), except next to an offset: it is computed from the width on the CPU, and
  // with dashes leaves no vertex attribute for the extension. Blurred lines and patterned or
  // translated fills, which draw alone with their own extensions, keep their paint in attributes.
  const zoomPaintContext = props[ZOOM_PAINT_CONTEXT] as ZoomPaintContext | null | undefined;
  const takesZoomPaint = (list: GeometryStyle[]) =>
    Boolean(zoomPaintContext) &&
    !list[0].lineOffset &&
    !list[0].lineBlur &&
    !list[0].hasFillStyle &&
    list.length <= MAX_ZOOM_PAINT_PARTS;
  // Lines kept at width 0 (see `renderSubLayers`) draw nothing because the texture gives them
  // that width. Without the texture their width would be in attributes, so they are left out, as
  // other style layers that draw nothing are.
  const styles = takesZoomPaint(allStyles)
    ? allStyles
    : allStyles.filter(style => style.drawsFill || style.drawsLines);
  if (styles.length === 0) {
    return null;
  }
  const [first] = styles;
  // A batch draws lines when any of its style layers does, or keeps lines at width 0. A sublayer
  // of lines all kept at width 0 draws nothing; it is hidden, and adds no draw.
  const drawsFill = styles.some(style => style.drawsFill);
  const drawsLines = styles.some(style => style.drawsLines || style.isZeroWidth);
  const isHidden = !styles.some(style => style.drawsFill || style.drawsLines);
  const {
    isFill,
    lineShape,
    lineOffset,
    gapWidth,
    depthTested,
    lineBlur,
    gapOffset,
    isBlurredGap,
    hasFillStyle,
    pattern,
    zoom
  } = first;
  if (!drawsFill && !drawsLines) {
    return null;
  }
  const baseProps = getSubLayerBaseProps(props);
  const tileFeatures = getTileFeatures(props.data);
  // A batch is named after all of its style layers (see `getStyleSubLayerId`).
  const styleLayerIds =
    styles.length === 1 ? first.styleLayer.id : styles.map(style => style.styleLayer.id);
  const {data, partIndices} =
    styles.length === 1
      ? {data: first.features, partIndices: []}
      : getFeatureBatch(
          tileFeatures,
          JSON.stringify(styleLayerIds),
          styles.map(style => style.features)
        );
  const merge = <T>(get: (style: GeometryStyle) => StyleAccessor<T>) =>
    mergeStyleAccessors(styles.map(get), partIndices);
  const zoomPaint =
    zoomPaintContext && takesZoomPaint(styles)
      ? zoomPaintContext.get(
          styles.map(style => style.styleLayer),
          mode
        )
      : null;
  const perFeature = <T>(accessor: StyleAccessor<T>, constant: T): StyleAccessor<T> =>
    zoomPaint && typeof accessor.value !== 'function' ? {value: constant} : accessor;
  const fillColor = merge(style => perFeature(style.fillColor, TRANSPARENT_COLOR));
  const lineColor = merge(style => perFeature(style.lineColor, TRANSPARENT_COLOR));
  // The width attribute scales the texture's width of its style layer, which is 1 where it is per
  // feature.
  const lineWidth = merge(style => perFeature(style.lineWidth, 1));
  // A dash array without gaps draws a solid line.
  const dashArray = styles.some(style => style.dashArray)
    ? merge(style => style.dashArray ?? SOLID_DASH_ARRAY)
    : null;

  const offsetValue = lineOffset?.value;
  const getOffset = (side: number) => (feature: any) => {
    const [offset, gap, width, blur] =
      typeof offsetValue === 'function' ? offsetValue(feature) : offsetValue!;
    return getLineOffset(offset, gap, width, side, blur);
  };
  const getBlurGap = (side: number) =>
    gapOffset && typeof gapOffset.value !== 'function'
      ? {blurGapSide: side, blurGapOffset: gapOffset.value}
      : {};
  // deck.gl measures dashes in drawn widths and MapLibre in `line-width`s, so a blurred gap's
  // wider lines take dashes shortened by as much.
  const lineDashArray =
    dashArray && isBlurredGap && lineOffset
      ? getBlurredDashArray(dashArray as StyleAccessor<[number, number]>, lineOffset)
      : dashArray;
  // MapLibre fades a line's edges, over its blur and a device pixel, from half a device pixel past
  // the line: a line narrower than a pixel still draws, fainter. `LineBlurExtension` draws that
  // fade, without a blur too; deck.gl draws lines without antialiasing aliased, and drops most of
  // a line narrower than a pixel. A fill's outline is MapLibre's aliased 1 pixel line, drawn as
  // deck.gl draws lines without antialiasing and cut to a line's pixels by `FillOutlineExtension`.
  const fadesLines = drawsLines && !isFill;
  const drawsOutline = drawsLines && isFill;
  const geometryExtensions =
    dashArray || lineOffset || fadesLines || drawsOutline || zoomPaint
      ? [
          ...(baseProps.extensions || []),
          ...(dashArray ? [lineOffset ? DASH_OFFSET_EXTENSION : DASH_EXTENSION] : []),
          ...(!dashArray && lineOffset ? [OFFSET_EXTENSION] : []),
          // Before the fade, which widens the stroke once its width is final.
          ...(zoomPaint ? [ZOOM_PAINT_EXTENSION] : []),
          ...(fadesLines
            ? [
                typeof lineBlur?.value === 'function'
                  ? LINE_BLUR_PER_FEATURE_EXTENSION
                  : LINE_BLUR_EXTENSION
              ]
            : []),
          ...(drawsOutline ? [FILL_OUTLINE_EXTENSION] : [])
        ]
      : null;
  // `fill-pattern` and `fill-translate` add their extensions to these, so an outlined fill keeps
  // its outline's.
  const fillStyleProps =
    isFill && hasFillStyle
      ? getFillStyleProps(
          first.styleLayer,
          zoom,
          geometryExtensions ?? baseProps.extensions,
          pattern
        )
      : {};

  const layerProps = {
    ...baseProps,
    // Not drawn, picked or highlighted while all of its lines are kept at width 0.
    ...(isHidden ? {visible: false, pickable: false} : {}),
    id: `${getStyleSubLayerId(props.id, styleLayerIds)}${idSuffix}`,
    data,
    stroked: drawsLines,
    filled: drawsFill,
    // A fill's line strings draw only as its 1 pixel outline.
    drawsLineStrings: drawsLines,
    getFillColor: isFill ? (fillColor.value as any) : [0, 0, 0, 0],
    getLineColor: lineColor.value as any,
    getLineWidth: lineWidth.value as any,
    ...(geometryExtensions ? {extensions: geometryExtensions} : {}),
    ...(zoomPaint
      ? {
          zoomPaint,
          getStylePart:
            styles.length === 1
              ? 0
              : (_feature: any, {index}: {index: number}) => partIndices[index]
        }
      : {}),
    lineAntialiasing: fadesLines,
    ...(fadesLines ? {getBlur: lineBlur ? lineBlur.value : 0} : {}),
    ...getBlurGap(1),
    ...fillStyleProps,
    ...(offsetValue ? {getOffset: getOffset(1)} : {}),
    ...(lineDashArray
      ? {
          getDashArray: lineDashArray.value as any,
          dashJustified: false
        }
      : {}),
    updateTriggers: {
      getFillColor: isFill ? fillColor.updateTrigger : undefined,
      // The group's accessors change with its features, which are new data in that case.
      getFillPatternScale: pattern ? Math.floor(zoom) : undefined,
      getLineColor: lineColor.updateTrigger,
      getLineWidth: lineWidth.updateTrigger,
      getDashArray: lineDashArray?.updateTrigger,
      getOffset: typeof offsetValue === 'function' ? lineOffset?.updateTrigger : offsetValue,
      getBlur: lineBlur?.updateTrigger
    },
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 0,
    lineCapRounded: false,
    lineJointRounded: false,
    ...lineShape,
    getPointRadius: 0,
    pointRadiusMinPixels: 0,
    parameters: getTileParameters(mode, depthTested)
  };
  const layer = getTileGeoJsonLayer(props, layerProps);
  if (!gapWidth || (typeof gapWidth.value !== 'function' && !(gapWidth.value > 0))) {
    return layer;
  }

  // A gap draws a second line on the other side, from the same data so that tile data, picked
  // objects and indices stay those of the features. Features without a gap draw only once.
  const getGap = gapWidth.value;
  const getWidth = styles[0].lineWidth.value;
  return [
    layer,
    getTileGeoJsonLayer(props, {
      ...layerProps,
      id: `${layerProps.id}-gap`,
      getOffset: getOffset(-1),
      ...getBlurGap(-1),
      ...(typeof getGap === 'function'
        ? {
            getLineWidth: (feature: any) =>
              getGap(feature) > 0
                ? typeof getWidth === 'function'
                  ? getWidth(feature)
                  : getWidth
                : 0,
            updateTriggers: {
              ...layerProps.updateTriggers,
              // A width that is not per feature is a value with no trigger of its own.
              getLineWidth: [
                typeof getWidth === 'function' ? lineWidth.updateTrigger : getWidth,
                gapWidth.updateTrigger
              ]
            }
          }
        : {})
    })
  ];
}

/** The latest features raised to their `fill-extrusion-base`, per tile content and style layer. */
const raisedFeatureCache = new WeakMap<
  any[],
  WeakMap<BasemapStyleLayer, {key: unknown[]; features: any[]}>
>();

function raiseCoordinates(coordinates: any, base: number): any {
  return typeof coordinates[0] === 'number'
    ? [coordinates[0], coordinates[1], base]
    : coordinates.map((child: any) => raiseCoordinates(child, base));
}

/**
 * Returns the features with their polygons raised to `fill-extrusion-base`: deck.gl extrudes a
 * polygon from its own `z` by `getElevation`. Features with a base of 0 are returned as they are,
 * and so is the array when every base is 0. The result is reused while the base is unchanged.
 */
function getRaisedFeatures(
  features: any[],
  styleLayer: BasemapStyleLayer,
  base: StyleAccessor<number>
): any[] {
  const {value} = base;
  if (value === 0) {
    return features;
  }
  const key = [
    styleLayer.paint?.['fill-extrusion-base'],
    styleLayer.paint?.['fill-extrusion-height'],
    typeof value === 'function' ? base.updateTrigger : value
  ];
  let byStyleLayer = raisedFeatureCache.get(features);
  if (!byStyleLayer) {
    byStyleLayer = new WeakMap();
    raisedFeatureCache.set(features, byStyleLayer);
  }
  const cached = byStyleLayer.get(styleLayer);
  if (cached && cached.key.every((entry, index) => entry === key[index])) {
    return cached.features;
  }

  let raisedAny = false;
  const raised = features.map(feature => {
    const geometryType = feature.geometry?.type;
    const featureBase = typeof value === 'function' ? value(feature) : value;
    if (featureBase === 0 || (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon')) {
      return feature;
    }
    raisedAny = true;
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: raiseCoordinates(feature.geometry.coordinates, featureBase)
      }
    };
  });
  const result = raisedAny ? raised : features;
  byStyleLayer.set(styleLayer, {key, features: result});
  return result;
}

function getExtrusionBounds(height: unknown, base: unknown): [number, number] {
  const top = Math.max(0, Number(height ?? 0) || 0);
  return [Math.min(Math.max(0, Number(base ?? 0) || 0), top), top];
}

/**
 * Draws a `fill-extrusion` style layer as extruded polygons, from `fill-extrusion-base` to
 * `fill-extrusion-height`, in meters. `fill-extrusion-opacity` applies to the whole layer, as in
 * MapLibre, and the alpha of `fill-extrusion-color` is ignored.
 */
function createExtrusionSubLayer({
  props,
  styleLayer,
  features,
  zoom,
  light = DEFAULT_FILL_EXTRUSION_LIGHT
}: {
  props: any;
  styleLayer: BasemapStyleLayer;
  features: any[];
  zoom: number;
  light?: FillExtrusionLight;
}) {
  const paint = getPaint(styleLayer, zoom);
  const color = getStyleAccessor(styleLayer, ['fill-extrusion-color'], zoom, ([value]) =>
    withOpacity([...(value ?? DEFAULT_COLOR).slice(0, 3), 1])
  );
  const base = getStyleAccessor(
    styleLayer,
    ['fill-extrusion-height', 'fill-extrusion-base'],
    zoom,
    ([height, baseValue]) => getExtrusionBounds(height, baseValue)[0]
  );
  const elevation = getStyleAccessor(
    styleLayer,
    ['fill-extrusion-height', 'fill-extrusion-base'],
    zoom,
    ([height, baseValue]) => {
      const [bottom, top] = getExtrusionBounds(height, baseValue);
      return top - bottom;
    }
  );
  const baseProps = getSubLayerBaseProps(props);

  return getTileGeoJsonLayer(props, {
    ...baseProps,
    id: getStyleSubLayerId(props.id, styleLayer.id),
    data: getRaisedFeatures(features, styleLayer, base),
    opacity: (baseProps.opacity ?? 1) * (paint['fill-extrusion-opacity'] ?? 1),
    extruded: true,
    filled: true,
    stroked: false,
    drawsLineStrings: false,
    wireframe: false,
    getFillColor: color.value as any,
    getElevation: elevation.value as any,
    updateTriggers: {
      getFillColor: color.updateTrigger,
      getElevation: elevation.updateTrigger
    },
    getPointRadius: 0,
    pointRadiusMinPixels: 0,
    parameters: EXTRUSION_PARAMETERS,
    extensions: [...(baseProps.extensions || []), FILL_EXTRUSION_LIGHTING_EXTENSION],
    fillExtrusionLight: light,
    fillExtrusionVerticalGradient: paint['fill-extrusion-vertical-gradient'] ?? true
  });
}

/** Shared by every extrusion sublayer, so deck.gl does not see their extensions change. */
const FILL_EXTRUSION_LIGHTING_EXTENSION = new FillExtrusionLightingExtension();

/** The latest evaluated `light` per style `light` object, reused within one zoom step. */
const fillExtrusionLightCache = new WeakMap<
  object,
  {zoomBucket: number; light: FillExtrusionLight}
>();

/**
 * Returns a style's `light` at the stepped zoom, the same object while it is unchanged, so tile
 * sublayers are kept. A style without `light` takes the style spec's default.
 */
function getFillExtrusionLight(
  styleDefinition: ResolvedBasemapStyle | undefined,
  zoom: number
): FillExtrusionLight {
  const styleLight = styleDefinition?.light;
  if (!styleLight || typeof styleLight !== 'object') {
    return DEFAULT_FILL_EXTRUSION_LIGHT;
  }
  const zoomBucket = getZoomBucket(zoom);
  const cached = fillExtrusionLightCache.get(styleLight);
  if (cached && cached.zoomBucket === zoomBucket) {
    return cached.light;
  }
  const {anchor, position, color, intensity} = evaluateStyleLight(styleLight, zoomBucket);
  const isNumbers = (value: unknown, length: number): value is number[] =>
    Array.isArray(value) &&
    value.length >= length &&
    value.slice(0, length).every(entry => Number.isFinite(entry));
  const defaults = DEFAULT_FILL_EXTRUSION_LIGHT;
  // Values of the wrong type (the expression engine passes a constant through) take the default.
  const light: FillExtrusionLight = {
    anchor: anchor === 'map' ? 'map' : 'viewport',
    position: isNumbers(position, 3) ? [position[0], position[1], position[2]] : defaults.position,
    color: isNumbers(color, 3) ? [color[0] / 255, color[1] / 255, color[2] / 255] : defaults.color,
    intensity: Number.isFinite(intensity)
      ? Math.min(Math.max(intensity as number, 0), 1)
      : defaults.intensity
  };
  fillExtrusionLightCache.set(styleLight, {zoomBucket, light});
  return light;
}

/** deck.gl's `CollisionFilterExtension` supports priorities from -1000 to 1000. */
const COLLISION_PRIORITY_RANGE: [number, number] = [-1000, 1000];

/**
 * Splits the collision priority range into one band per symbol layer, in style order. All labels
 * share one collision group, so a later style layer's band is above an earlier one's: MapLibre
 * places symbol layers from the top of the style down, and `symbol-sort-key` only orders labels
 * within a layer.
 */
function getLabelPriorityRanges(
  styleLayers: BasemapStyleLayer[]
): Map<BasemapStyleLayer, [number, number]> {
  const symbolLayers = styleLayers.filter(layer => layer.type === 'symbol');
  const [min, max] = COLLISION_PRIORITY_RANGE;
  const width = (max - min) / Math.max(symbolLayers.length, 1);
  return new Map(
    symbolLayers.map((layer, index) => [layer, [min + index * width, min + (index + 1) * width]])
  );
}

/** Whether a style layer is drawn from vector tiles: a `symbol` layer only with labels on. */
function isVectorStyleLayer(layer: BasemapStyleLayer, config: BasemapLayerConfig): boolean {
  return layer.type === 'symbol'
    ? config.labels
    : layer.type === 'fill' ||
        layer.type === 'fill-extrusion' ||
        layer.type === 'line' ||
        layer.type === 'circle';
}

/**
 * Whether a source's layers draw from vector tiles: a vector source with tile templates, or a
 * GeoJSON source with data, which is cut into tiles on the client (see `getGeoJsonTileFeatures`).
 */
export function isVectorTileSource(source: BasemapSource | undefined): boolean {
  return source?.type === 'geojson'
    ? isGeoJsonSource(source)
    : Boolean(source?.tiles) && source?.type === 'vector';
}

/**
 * The `getTileData` of a vector tile source's tileset: `loader` fetches and decodes a vector
 * source's tiles, and a GeoJSON source's tiles are cut from its data, in the same tile-local
 * coordinates.
 */
export function getVectorTileLoader(
  source: BasemapSource,
  loader: SharedMVTLayer
): (tile: Parameters<SharedMVTLayer['getTileData']>[0]) => Promise<any> {
  return source.type === 'geojson'
    ? tile => getGeoJsonTileFeatures(source, tile.index)
    : tile => loader.getTileData(tile);
}

/**
 * The source layers drawn from each vector source, over all of its runs, sorted; `null` for a
 * source with a style layer that names none. Tiles decode only these: OpenMapTiles tiles, for
 * one, carry house numbers and peaks that few styles draw, and points of interest, most of a
 * street-level tile, that a style without them, or with labels off, does not draw.
 */
export function getRunSourceLayers(runs: StyleLayerRun[]): Map<BasemapSource, string[] | null> {
  const names = new Map<BasemapSource, Set<string> | null>();
  for (const run of runs) {
    if (run.type !== 'vector') {
      continue;
    }
    let set = names.has(run.source!) ? names.get(run.source!) : new Set<string>();
    for (const layer of run.styleLayers) {
      const sourceLayer = layer['source-layer'];
      if (typeof sourceLayer !== 'string') {
        set = null;
      }
      set?.add(sourceLayer as string);
    }
    names.set(run.source!, set ?? null);
  }
  return new Map([...names].map(([source, set]) => [source, set ? [...set].sort() : null]));
}

/**
 * The source layers each vector source of a style decodes (see `getRunSourceLayers`). With the
 * basemap off they are those it would draw, so that turning it off and on keeps the tiles.
 */
export function getStyleSourceLayers(
  styleDefinition: ResolvedBasemapStyle,
  globe?: {config?: BasemapGlobeConfig}
): Map<BasemapSource, string[] | null> {
  const config = getConfig(globe);
  const styleLayers = (styleDefinition.layers || []).filter(layer =>
    SUPPORTED_TYPES.has(layer.type)
  );
  return getRunSourceLayers(getStyleLayerRuns(styleLayers, styleDefinition, config));
}

/**
 * `loadOptions` for a vector source's tiles, decoding only `sourceLayers` when given. Source
 * layers set in `loadOptions.mvt.layers` are left as they are.
 */
export function getSourceLoadOptions(
  loadOptions: BasemapLoadOptions | undefined,
  sourceLayers: string[] | null | undefined
): BasemapLoadOptions | undefined {
  const mvt = (loadOptions as {mvt?: Record<string, unknown>} | undefined)?.mvt;
  if (!sourceLayers || mvt?.layers) {
    return loadOptions;
  }
  return {...loadOptions, mvt: {...mvt, layers: sourceLayers}} as BasemapLoadOptions;
}

/**
 * Splits the style into runs that draw in style order, as in MapLibre: each background, raster
 * and hillshade layer on its own, and consecutive layers of one vector source together, so that a
 * raster layer between two vector layers draws between them. Layers that cannot draw (a source
 * without tiles, labels turned off) do not split a run. Runs do not depend on zoom, so the tile
 * layers keep their ids and tiles when a layer leaves its zoom range. Background, raster and
 * hillshade runs have their style layer's id. The first run of a source has the source id as its
 * id, unless a background, raster or hillshade run already has that id; later runs, and a first run whose source id is
 * taken, add the quoted id of their first style layer.
 */
export function getStyleLayerRuns(
  styleLayers: BasemapStyleLayer[],
  styleDefinition: ResolvedBasemapStyle,
  config: BasemapLayerConfig = DEFAULT_CONFIG
): StyleLayerRun[] {
  const runs: StyleLayerRun[] = [];
  const sourceIds = new Set<string>();
  const reservedIds = new Set([
    ...Object.keys(styleDefinition.sources || {}),
    ...styleLayers.map(layer => layer.id)
  ]);
  const getSource = (layer: BasemapStyleLayer) =>
    layer.source ? styleDefinition.sources?.[layer.source as string] : undefined;
  // deck.gl matches layers by id, so a vector run must not take a background or raster run's id.
  const singleLayerRunIds = new Set(
    styleLayers
      .filter(
        layer =>
          layer.type === 'background' ||
          ((layer.type === 'raster' || layer.type === 'hillshade') && getSource(layer)?.tiles)
      )
      .map(layer => layer.id)
  );
  for (const layer of styleLayers) {
    const sourceId = layer.source as string | undefined;
    const source = getSource(layer);
    if (layer.type === 'background') {
      runs.push({type: 'background', id: layer.id, styleLayers: [layer]});
    } else if (layer.type === 'raster') {
      if (source?.tiles) {
        runs.push({type: 'raster', id: layer.id, sourceId, source, styleLayers: [layer]});
      } else {
        logBasemapRuntimeEvent('Skipping style layer without resolved tiles', {
          layerId: layer.id,
          sourceId
        });
      }
    } else if (layer.type === 'hillshade') {
      if (source?.tiles && source.type === 'raster-dem') {
        runs.push({type: 'hillshade', id: layer.id, sourceId, source, styleLayers: [layer]});
      } else {
        logBasemapRuntimeEvent('Skipping hillshade layer without a raster-dem source', {
          layerId: layer.id,
          sourceId
        });
      }
    } else if (isVectorStyleLayer(layer, config) && sourceId && isVectorTileSource(source)) {
      const last = runs[runs.length - 1];
      // Labels draw after all of their run's other layers, so a layer after a label starts a run.
      const followsLabel =
        layer.type !== 'symbol' &&
        last?.styleLayers.some(styleLayer => styleLayer.type === 'symbol');
      if (last?.type === 'vector' && last.sourceId === sourceId && !followsLabel) {
        last.styleLayers.push(layer);
      } else {
        let id = sourceId;
        if (sourceIds.has(sourceId) || singleLayerRunIds.has(sourceId)) {
          id = `${sourceId}-${JSON.stringify(layer.id)}`;
          while (reservedIds.has(id)) id += '-run';
          reservedIds.add(id);
        }
        runs.push({
          type: 'vector',
          id,
          sourceId,
          source,
          styleLayers: [layer]
        });
        sourceIds.add(sourceId);
      }
    }
  }
  return runs;
}

/**
 * The deck.gl layers of the style's background, raster and vector layers, in style order. A run
 * draws only while one of its layers is visible at `zoom`. A vector run keeps all of its style
 * layers, visible or not: its tile regeneration key must change when any of them crosses its own
 * limits, and `renderSubLayers` gates each layer by zoom.
 */
function getStyleLayers({
  idPrefix,
  styleLayers,
  styleDefinition,
  zoom,
  config,
  loadOptions,
  mode,
  spriteAtlases,
  fontFamily,
  glyphs,
  labelPlacement,
  tilesets
}: {
  idPrefix: string;
  styleLayers: BasemapStyleLayer[];
  styleDefinition: ResolvedBasemapStyle;
  zoom: number;
  config: BasemapLayerConfig;
  loadOptions?: BasemapLoadOptions;
  mode: BasemapMode;
  spriteAtlases?: SpriteAtlas[] | null;
  fontFamily?: LabelFontFamily | null;
  /** The style's glyphs, which labels are drawn with (see `MVTLabelLayerProps.glyphs`). */
  glyphs?: GlyphStore | null;
  /** The label placement shared by the map's label layers (see `LabelPlacement`). */
  labelPlacement?: LabelPlacement | null;
  tilesets?: Map<BasemapSource, SharedTileset2D>;
}) {
  const labelPriorityRanges = getLabelPriorityRanges(
    styleLayers.filter(layer => isVectorStyleLayer(layer, config))
  );
  const allRuns = getStyleLayerRuns(styleLayers, styleDefinition, config);
  const runs = allRuns.filter(run =>
    run.styleLayers.some(layer => isStyleLayerVisibleAtZoom(layer, zoom))
  );

  // On a globe, flat layers drawn after an extrusion are depth-tested against the buildings.
  const extrusionIndex =
    mode === 'globe'
      ? styleLayers.findIndex(
          layer => layer.type === 'fill-extrusion' && isStyleLayerVisibleAtZoom(layer, zoom)
        )
      : -1;
  const depthTested = new Set(extrusionIndex >= 0 ? styleLayers.slice(extrusionIndex + 1) : []);

  const ownedTilesets = new Map<BasemapSource, SourceTilesetOwner>();
  const ownedDemTilesets = new Map<BasemapSource, DemTilesetOwner>();
  let sourceLayers: Map<BasemapSource, string[] | null> | undefined;
  return runs.map(run => {
    const [layer] = run.styleLayers;
    if (run.type === 'background') {
      return createBackgroundLayer({idPrefix, layer, zoom, mode});
    }
    if (run.type === 'raster') {
      return createRasterLayer({
        idPrefix,
        layer,
        source: run.source!,
        zoom,
        mode,
        depthTested: depthTested.has(layer)
      });
    }
    if (run.type === 'hillshade') {
      // One tileset per raster-dem source, shared by its hillshade layers.
      let owner: DemTilesetOwner | undefined;
      let tileset = tilesets?.get(run.source!);
      if (!tileset) {
        owner = ownedDemTilesets.get(run.source!);
        if (!owner) {
          owner = {
            tileset: createDemTileset(run.source!, loadOptions),
            consumers: new Set()
          };
          ownedDemTilesets.set(run.source!, owner);
        }
        tileset = owner.tileset;
      }
      return createHillshadeLayer({
        idPrefix,
        layer,
        tileset,
        demTilesetOwner: owner,
        source: run.source!,
        zoom,
        mode,
        depthTested: depthTested.has(layer)
      });
    }
    let tileset = tilesets?.get(run.source!);
    let owner: SourceTilesetOwner | undefined;
    if (!tileset) {
      owner = ownedTilesets.get(run.source!);
      if (!owner) {
        // Tiles decode the source layers of all of the source's runs, at every zoom.
        sourceLayers ??= getRunSourceLayers(allRuns);
        const loader = new SharedMVTLayer({
          data: run.source!.tiles!,
          loadOptions: getSourceLoadOptions(loadOptions, sourceLayers.get(run.source!))
        });
        tileset = new SharedTileset2D({
          ...loader._getTilesetOptions(),
          ...getTilePyramidProps(run.source!),
          tileSize: run.source!.tileSize || 512,
          zoomOffset: VECTOR_TILE_ZOOM_OFFSET,
          getTileData: getVectorTileLoader(run.source!, loader)
        });
        owner = {tileset, consumers: new Set()};
        ownedTilesets.set(run.source!, owner);
      }
      tileset = owner.tileset;
    }
    return createVectorLayerGroup({
      idPrefix,
      id: run.id,
      sourceId: run.sourceId!,
      source: run.source!,
      tileset,
      sourceTilesetOwner: owner,
      styleLayers: run.styleLayers,
      depthTestedFrom: run.styleLayers.findIndex(styleLayer => depthTested.has(styleLayer)),
      zoom,
      config,
      loadOptions,
      mode,
      labelPriorityRanges,
      styleDefinition,
      spriteAtlases,
      fontFamily,
      glyphs,
      labelPlacement
    });
  });
}

function getGlobePreLayers({
  idPrefix,
  mode,
  config,
  styleLayers,
  zoom
}: {
  idPrefix: string;
  mode: BasemapMode;
  config: BasemapLayerConfig;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
}) {
  const layers = [];

  if (mode === 'globe' && config.atmosphere) {
    layers.push(getGlobeAtmosphereSkyLayer());
  }

  // A hidden or out-of-range background draws nothing, so it does not replace the fallback.
  const hasBackground = styleLayers.some(
    layer => layer.type === 'background' && isStyleLayerVisibleAtZoom(layer, zoom)
  );
  if (mode === 'globe' && !hasBackground) {
    layers.push(
      new SolidPolygonLayer({
        id: `${idPrefix}-background-fallback`,
        data: BACKGROUND_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: [10, 24, 46, 255],
        parameters: getBackgroundParameters(mode)
      })
    );
  }

  return layers;
}

function getGlobePostLayers({
  idPrefix,
  mode,
  config,
  styleLayers,
  zoom
}: {
  idPrefix: string;
  mode: BasemapMode;
  config: BasemapLayerConfig;
  styleLayers: BasemapStyleLayer[];
  zoom: number;
}) {
  const layers = [];

  if (mode === 'globe' && config.basemap) {
    layers.push(
      new SolidPolygonLayer({
        id: `${idPrefix}-background-north-pole`,
        data: BACKGROUND_NORTH_POLE_DATA,
        getPolygon: d => d,
        stroked: false,
        filled: true,
        getFillColor: inferWaterColor(styleLayers, zoom),
        parameters: getBackgroundParameters(mode)
      })
    );
  }

  if (mode === 'globe' && config.atmosphere) {
    layers.push(getGlobeAtmosphereLayer());
  }

  return layers;
}
