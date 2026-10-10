import {CompositeLayer} from '@deck.gl/core';
import type {DefaultProps, UpdateParameters} from '@deck.gl/core';
import {CollisionFilterExtension} from '@deck.gl/extensions';
import {GeoJsonLayer, IconLayer, TextLayer} from '@deck.gl/layers';
import {getZoomBucket, withOpacity} from './style-accessor';
import {
  getCompiledStyleProperty,
  getStylePropertyDefault,
  type CompiledStyleProperty
} from './style-expression';
import {getSpriteImageNames, resolveSpriteIcon, warnMissingIcon} from './sprite';
import type {ResolvedSpriteIcon, SpriteAtlas} from './sprite';
import {DEFAULT_TEXT_FONT, getTextLayerFontWeight, resolveLabelFont} from './text-font';
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
  /** Optional text halo/background color. */
  labelBackground?: number[] | null;
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
  /** Sprites loaded for the style; `icon-image` names resolve against them. */
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
};

/**
 * Pixels around a label's anchor that the collision filter samples: deck.gl's
 * `CollisionFilterExtension` tests a 5x5 pixel area. Two more pixels absorb rasterization at the
 * box edge; with only one, a `top`-aligned label still misses a row of the samples and fades.
 */
const COLLISION_SAMPLE_RADIUS = 4;

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
  /** The non-data inputs `labelData` was computed with; a change recomputes it. */
  anchorKey?: string;
  /** The map bearing, in `BEARING_STEP` steps, that upright line labels were turned for. */
  bearingStep?: number;
};

/**
 * Bearing step, in degrees, at which labels along lines are re-checked for `text-keep-upright`
 * while the map rotates. A label may read upside down by up to this much before it turns.
 */
const BEARING_STEP = 5;

/**
 * Average glyph advance, in ems, used to estimate a label's length when placing it along a line.
 * The text is laid out by `TextLayer` only after placement, so its exact width is not known here.
 */
const LINE_LABEL_EM_PER_CHARACTER = 0.6;

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

const geoJsonDefaultProps = {...GeoJsonLayer.defaultProps} as Omit<
  typeof GeoJsonLayer.defaultProps,
  'data'
>;
delete (geoJsonDefaultProps as typeof GeoJsonLayer.defaultProps).data;

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

/**
 * The box lines are clipped to before labels are placed along them: the tile's own extent for
 * `line` placement, which MapLibre clips to, and a margin of one tile around it for `line-center`,
 * which measures the whole line.
 */
function getLineClipBounds([minX, minY, maxX, maxY]: number[], placement: string): number[] {
  if (placement !== 'line-center') {
    return [minX, minY, maxX, maxY];
  }
  const [width, height] = [maxX - minX, maxY - minY];
  return [minX - width, minY - height, maxX + width, maxY + height];
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
    labelBackground: {type: 'color', value: null, optional: true},
    fontFamily: null
  };

  /** Current label-row state. */
  state: MVTLabelLayerState = undefined!;

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
    return [
      left + COLLISION_SAMPLE_RADIUS,
      top + COLLISION_SAMPLE_RADIUS,
      right + COLLISION_SAMPLE_RADIUS,
      bottom + COLLISION_SAMPLE_RADIUS
    ];
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
    return {
      getIcon: getTrigger('icon-image'),
      getSize: getTrigger('icon-image', 'icon-size'),
      getColor: getTrigger('icon-image', 'icon-color', 'icon-opacity'),
      getPixelOffset: getTrigger('icon-image', 'icon-size', 'icon-anchor', 'icon-offset')
    };
  }

  /**
   * One `IconLayer` per sprite that this layer's icons come from. Rows whose `icon-image` no
   * sprite contains are left out, so they draw nothing.
   */
  renderIconLayers(): any[] {
    const {spriteAtlases, iconLoadOptions, billboard} = this.props;
    const labelData = this.state.labelData || [];
    if (!spriteAtlases?.length || !this.getStyleProperty('icon-image') || !labelData.length) {
      return [];
    }
    const rowsByAtlas = new Map<SpriteAtlas, LabelRow[]>();
    for (const row of labelData) {
      const icon = this.getIcon((row as any).__source?.object ?? row);
      if (icon) {
        const rows = rowsByAtlas.get(icon.atlas) || [];
        rows.push(row);
        rowsByAtlas.set(icon.atlas, rows);
      }
    }
    return [...rowsByAtlas].map(
      ([atlas, rows]) =>
        new IconLayer({
          ...this.getSubLayerProps({id: `icons-${atlas.id}`}),
          data: rows,
          iconAtlas: atlas.image,
          iconMapping: atlas.mapping,
          loadOptions: iconLoadOptions || undefined,
          billboard,
          sizeUnits: 'pixels',
          parameters: {depthTest: false},
          // Icons are not collision-filtered (see the module docs). The collision filter matches
          // entries by row index, and this layer holds only the rows its sprite has, so an icon
          // and its own label would not be recognized as one placement.
          extensions: this.props.extensions || [],
          getPosition: (d: LabelRow) => d.position,
          getIcon: this.getSubLayerAccessor(
            (feature: FeatureLike) => this.getIcon(feature)?.name
          ) as any,
          getSize: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getIconSize(feature)
          ) as any,
          getColor: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getIconColor(feature)
          ) as any,
          getPixelOffset: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getIconPixelOffset(feature)
          ) as any,
          updateTriggers: {...this.getIconUpdateTriggers(), all: atlas}
        })
    );
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
    const row = this.state.labelData?.[0] as
      | (LabelRow & {__source?: {object: FeatureLike}})
      | undefined;
    const value = textFont?.evaluate(getZoomBucket(this.props.zoom || 0), row?.__source?.object);
    const fontStack = Array.isArray(value) && value.length ? value.map(String) : DEFAULT_TEXT_FONT;
    return resolveLabelFont(fontStack, this.props.fontFamily);
  }

  /**
   * Extracts the visible label text for a decoded feature. Legacy `{token}` placeholders are
   * resolved only in literal and zoom-function values, as in the style specification.
   */
  getLabel(feature: FeatureLike): string | undefined {
    const textField = this.getStyleProperty('text-field');
    if (!textField) {
      return undefined;
    }

    // A `text-size` of 0 hides the label.
    if (!(this.getLabelSize(feature) > 0)) {
      return undefined;
    }
    const value = this.evaluateStyleProperty('text-field', feature);
    const text = value === null || value === undefined ? '' : String(value);
    const isExpression = Array.isArray(this.props.styleLayer?.layout?.['text-field']);
    const label =
      isExpression || textField.isFeatureDependent
        ? text.trim()
        : resolveTokenString(text, feature.properties)?.trim();
    return label || undefined;
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
   * Returns the halo (background) color for a decoded feature label: `labelBackground` faded by
   * the same `text-opacity` as the text, so a hidden or faded label leaves no halo box.
   */
  getLabelBackgroundColor(feature: FeatureLike): number[] {
    const opacity = this.evaluateStyleProperty('text-opacity', feature) as number | undefined;
    const background = this.props.labelBackground;
    if (!background) {
      return [0, 0, 0, 0];
    }
    // `labelBackground` is already RGBA with alpha in 0-255; scale that alpha directly.
    // (`withOpacity` would read a 0-255 alpha of 1 as fully opaque.)
    const alpha = background.length > 3 ? background[3] : 255;
    return [background[0], background[1], background[2], Math.round(alpha * (opacity ?? 1))];
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

  /** Update triggers for the text accessors (see `getStyleUpdateTrigger`). */
  getLabelUpdateTriggers(): Record<string, string> {
    const getTrigger = (...propertyNames: string[]) => this.getStyleUpdateTrigger(...propertyNames);

    return {
      getText: getTrigger('text-field', 'text-size'),
      getSize: getTrigger('text-size'),
      getColor: getTrigger('text-color', 'text-opacity'),
      // The halo color comes from `labelBackground` (evaluated per style layer and zoom step), so
      // its value is part of the trigger as well as a zoom-dependent `text-opacity`.
      getBackgroundColor: `${getTrigger('text-opacity')}|${
        this.props.labelBackground ? this.props.labelBackground.join(',') : ''
      }`,
      getCollisionPriority: getTrigger('symbol-sort-key'),
      getPixelOffset: getTrigger('text-offset', 'text-size'),
      getAngle: `${this.state?.bearingStep}|${getTrigger('text-keep-upright')}`,
      getTextAnchor: getTrigger('text-anchor'),
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
   * The tile's own extent in feature coordinates: the `[0, 1)` square for tile-local coordinates,
   * the tile's longitude/latitude box for globe tiles, or null when it is not known.
   */
  getTileBounds(geographic: boolean): number[] | null {
    if (!geographic) {
      return [0, 0, 1, 1];
    }
    const bbox = this.props.tileBoundingBox;
    return bbox && Number.isFinite(bbox.west)
      ? [bbox.west, bbox.south, bbox.east, bbox.north]
      : null;
  }

  /**
   * Extracts candidate label anchor positions from a feature geometry. Points are labelled where
   * they are. Lines are labelled at the middle vertex of their first part here; with
   * `symbol-placement: line` or `line-center`, `getLabelData` places them along the line instead
   * (see `getLineLabelPlacements`). With `symbol-placement: point`, each polygon of a feature is
   * labelled at its pole of inaccessibility, as in MapLibre, if that point lies in this tile; polygons are not
   * labelled along their outline. `geographic` says whether coordinates are longitude/latitude
   * (globe tiles) or tile-local. `budget` bounds the polygon searches; pass one budget for all
   * features of a tile.
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
   * tile; an overzoomed tile is placed at the integer map zoom.
   */
  getLinePlacementScale(): {zoom: number; tileZoom: number; tileSize: number} {
    const mapZoom = Math.floor(this.props.zoom || 0);
    const tileZoom = this.props.tileZoom ?? mapZoom;
    const zoom = Math.max(tileZoom, mapZoom);
    return {zoom, tileZoom, tileSize: (this.props.tileSize || 512) * 2 ** (zoom - tileZoom)};
  }

  /**
   * Label anchors along the lines of a `LineString` or `MultiLineString` feature, for
   * `symbol-placement: line` or `line-center`, with the direction of the line at each. Lines are
   * measured in pixels at the tile's zoom (see `getLinePlacementScale`); `symbol-spacing`,
   * `text-max-angle` and `text-size` are evaluated there too. The label's length is estimated from
   * its character count. Anchors outside the tile's own extent are left to the neighbouring tile.
   * With `line` placement, lines are clipped to the tile's extent first, as in MapLibre; with
   * `line-center`, to a margin of one tile around it, so a line's far reaches cost nothing. Each
   * feature draws on the shared `budget`, at most `DEFAULT_LINE_ANCHOR_STEPS` of it.
   */
  getLineLabelPlacements(
    feature: FeatureLike,
    geographic: boolean,
    placement: string,
    budget: LineAnchorBudget = {steps: TILE_LINE_ANCHOR_STEPS}
  ): {position: number[]; angle: number}[] {
    const {type, coordinates} = feature.geometry;
    const lines: number[][][] =
      type === 'LineString' ? [coordinates] : type === 'MultiLineString' ? coordinates : [];
    const text = this.getLabel(feature);
    if (!text || !lines.length) {
      return [];
    }
    const {zoom, tileSize} = this.getLinePlacementScale();
    const evaluate = (name: string) =>
      Number(this.getStyleProperty(name)?.evaluate(zoom, feature) ?? getStylePropertyDefault(name));
    const textSize = evaluate('text-size');
    const options = {
      placement: placement === 'line-center' ? ('line-center' as const) : ('line' as const),
      spacing: evaluate('symbol-spacing'),
      maxAngle: evaluate('text-max-angle'),
      textSize,
      labelLength: [...text].length * textSize * LINE_LABEL_EM_PER_CHARACTER
    };
    const scale = geographic ? tileSize * 2 ** zoom : tileSize;
    const bounds = this.getTileBounds(geographic);
    const clipBounds = bounds && getLineClipBounds(bounds, options.placement);
    // One feature may spend at most the single-feature default, and never more than the tile has.
    const featureBudget = {steps: Math.min(DEFAULT_LINE_ANCHOR_STEPS, budget.steps)};
    const start = featureBudget.steps;

    const placements = lines.flatMap(line => {
      if (!Array.isArray(line) || line.length < 2) {
        return [];
      }
      const parts = clipBounds ? clipLine(line, clipBounds) : [line];
      return parts.flatMap(part => {
        const pixels = part.map(point => {
          const [x, y] = geographic ? lngLatToWorld(point) : point;
          return [x * scale, y * scale];
        });
        const isContinued = Boolean(bounds) && !isStrictlyInsideBounds(part[0], bounds!);
        return getLineAnchors(pixels, {...options, isContinued, budget: featureBudget})
          .map(({segment, t, angle}) => {
            const [a, b] = [part[segment], part[segment + 1]];
            return {position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], angle};
          })
          .filter(({position}) => !bounds || isInsideBounds(position, bounds));
      });
    });
    budget.steps -= start - Math.max(0, featureBudget.steps);
    return placements;
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
    return features.flatMap((feature, index) =>
      isLinePlacement(placement) && isLineGeometry(feature)
        ? this.getLineLabelPlacements(feature, geographic, placement, lineBudget).map(row =>
            this.getSubLayerRow(row, feature, index)
          )
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
            this.getStyleUpdateTrigger('text-field'),
            ...['text-size', 'symbol-spacing', 'text-max-angle'].map(name =>
              JSON.stringify(this.props.styleLayer?.layout?.[name] ?? null)
            )
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
        isLinePlacement(this.getSymbolPlacement()) &&
        this.getBearingStep(params.context.viewport) !== this.state.bearingStep)
    );
  }

  /**
   * Text layer props for labels along lines: each label is turned to its line, upright when
   * `text-keep-upright` is set (the default). On a flat map they are drawn in the map plane, as
   * MapLibre does with the `auto` `text-rotation-alignment` and `text-pitch-alignment` of line
   * placement; on a globe they stay billboards, turned in screen space.
   */
  getLineLabelProps(): Record<string, unknown> {
    if (!isLinePlacement(this.getSymbolPlacement())) {
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
   * Recomputes label anchor rows when the source tile data, or an input the anchors depend on,
   * changes.
   */
  updateState({changeFlags}: UpdateParameters<this>): void {
    const {data} = this.props;
    if (!data) {
      return;
    }
    const geographic = Boolean(this.context?.viewport?.resolution);
    const anchorKey = this.getAnchorKey(geographic);
    if (changeFlags.dataChanged || anchorKey !== this.state.anchorKey) {
      const features = Array.isArray(data) ? data : data.features || [];
      this.setState({labelData: this.getLabelData(features, geographic), anchorKey});
    }
  }

  /**
   * Renders the optional debug geometry and the text labels.
   */
  renderLayers(): any {
    const {config, labelSizeUnits, labelBackground, billboard, renderGeometry} = this.props;
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

    if (config.labels) {
      // Icons draw under their labels.
      layers.push(...this.renderIconLayers());
      const hasBackground = Array.isArray(labelBackground) && labelBackground.length >= 3;
      const font = this.getFont();
      layers.push(
        new TextLayer({
          ...this.getSubLayerProps({id: 'text'}),
          data: this.state.labelData,
          extensions: [...(this.props.extensions || []), new CollisionFilterExtension()],
          parameters: {
            depthTest: false
          },
          billboard,
          ...this.getLineLabelProps(),
          characterSet: 'auto',
          collisionEnabled: true,
          collisionGroup: 'basemap-labels',
          getCollisionPriority: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelCollisionPriority(feature)
          ) as any,
          fontFamily: font.fontFamily,
          fontWeight: getTextLayerFontWeight(font),
          sizeUnits: labelSizeUnits,
          // The collision filter keeps a label only where the label itself covers its anchor in
          // the collision map. The background box is always drawn (transparent without a halo)
          // and, in the collision pass, padded to reach the anchor (see getCollisionPadding).
          background: true,
          collisionTestProps: {padding: this.getCollisionPadding()},
          getBackgroundColor: (hasBackground
            ? this.getSubLayerAccessor((feature: FeatureLike) =>
                this.getLabelBackgroundColor(feature)
              )
            : [0, 0, 0, 0]) as any,
          getPosition: (d: LabelRow) => d.position,
          getText: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabel(feature)
          ) as any,
          getSize: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelSize(feature)
          ) as any,
          getColor: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelColor(feature)
          ) as any,
          getPixelOffset: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelPixelOffset(feature)
          ) as any,
          getTextAnchor: this.getSubLayerAccessor(
            (feature: FeatureLike) =>
              getTextAnchorProps(this.evaluateStyleProperty('text-anchor', feature)).textAnchor
          ) as any,
          getAlignmentBaseline: this.getSubLayerAccessor(
            (feature: FeatureLike) =>
              getTextAnchorProps(this.evaluateStyleProperty('text-anchor', feature))
                .alignmentBaseline
          ) as any,
          updateTriggers: this.getLabelUpdateTriggers()
        })
      );
    }

    return layers;
  }
}
