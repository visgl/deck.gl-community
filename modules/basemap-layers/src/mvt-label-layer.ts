import {CompositeLayer} from '@deck.gl/core';
import type {DefaultProps, Layer, UpdateParameters} from '@deck.gl/core';
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
import {getSymbolCollision} from './symbol-collision';
import type {SymbolPartCollision} from './symbol-collision';

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
};

/**
 * Pixels around a label's anchor that the collision filter samples: deck.gl's
 * `CollisionFilterExtension` tests a 5x5 pixel area. Two more pixels absorb rasterization at the
 * box edge; with only one, a `top`-aligned label still misses a row of the samples and fades.
 */
const COLLISION_SAMPLE_RADIUS = 4;

/** Collision group shared by every label and icon, so all symbols collide with each other. */
const LABEL_COLLISION_GROUP = 'basemap-labels';

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
};

/**
 * Work, in point-to-segment distance tests, that polygon label searches may spend per tile and
 * style layer. Tile geometry is untrusted; past this budget, remaining polygons get no label.
 */
const TILE_POLE_SEARCH_SEGMENT_TESTS = 2e7;

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
  // The footprint is not pickable, so picking resolves to the drawn copy only.
  return keepFootprint ? [placed, layer.clone({opacity: 0, pickable: false})] : [placed];
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
   * One `IconLayer` per sprite that this layer's icons come from. Each holds every label row, so
   * an icon has the same row index, and so the same collision-filter identity, as its own label:
   * the two are placed or hidden as one unit. Rows whose icon is in another sprite, or in none,
   * draw nothing.
   *
   * `icon-image` is evaluated once per row. Each sprite's layer evaluates the other style
   * properties only for its own rows and gives every other row constants, so the style evaluation
   * across all layers is linear in the rows. The instance count is rows times the sprites a tile
   * uses, and only the style's `sprite` list adds sprites: tile data cannot.
   */
  renderIconLayers(): any[] {
    const {spriteAtlases, iconLoadOptions, billboard} = this.props;
    const labelData = this.state.labelData || [];
    if (!spriteAtlases?.length || !this.getStyleProperty('icon-image') || !labelData.length) {
      return [];
    }
    const icons = labelData.map(row => this.getIcon((row as any).__source?.object ?? row));
    const atlases = new Set<SpriteAtlas>();
    for (const icon of icons) {
      if (icon) {
        atlases.add(icon.atlas);
      }
    }
    const {icon: collision} = this.getSymbolCollision();
    return [...atlases].flatMap(atlas => {
      // Accessors over every row: `fallback` for rows whose icon is not in this sprite.
      const forOwnRows = <T>(accessor: (feature: FeatureLike) => T, fallback: T) => {
        const getValue = this.getSubLayerAccessor(accessor) as any;
        return (row: LabelRow, info: {index: number}) =>
          icons[info.index]?.atlas === atlas ? getValue(row, info) : fallback;
      };
      const layer = new IconLayer({
        ...this.getSubLayerProps({id: `icons-${atlas.id}`}),
        data: labelData,
        iconAtlas: atlas.image,
        iconMapping: atlas.mapping,
        loadOptions: iconLoadOptions || undefined,
        billboard,
        sizeUnits: 'pixels',
        parameters: {depthTest: false},
        extensions: [...(this.props.extensions || []), new CollisionFilterExtension()],
        collisionEnabled: true,
        collisionGroup: LABEL_COLLISION_GROUP,
        getCollisionPriority: forOwnRows(
          feature => this.getLabelCollisionPriority(feature),
          0
        ) as any,
        // The icon's whole box collides, as in MapLibre, including its transparent pixels. An
        // icon that ignores placement draws nothing in the collision pass.
        collisionTestProps: collision.blocks ? {alphaCutoff: 0} : {alphaCutoff: 0, sizeScale: 0},
        getPosition: (d: LabelRow) => d.position,
        getIcon: ((_: LabelRow, {index}: {index: number}) =>
          icons[index]?.atlas === atlas ? icons[index]!.name : null) as any,
        getSize: forOwnRows(feature => this.getIconSize(feature), 0) as any,
        getColor: forOwnRows(feature => this.getIconColor(feature), [0, 0, 0, 0]) as any,
        getPixelOffset: forOwnRows(feature => this.getIconPixelOffset(feature), [0, 0] as [
          number,
          number
        ]) as any,
        updateTriggers: {
          ...this.getIconUpdateTriggers(),
          getCollisionPriority: this.getStyleUpdateTrigger('symbol-sort-key'),
          all: atlas
        }
      });
      return placeSymbolPart(layer, collision, collision.blocks);
    });
  }

  /**
   * How this layer's text and icons take part in collision (see `getSymbolCollision`), from its
   * placement properties at the stepped zoom. `*-overlap`, where set, takes precedence over
   * `*-allow-overlap`, as in MapLibre; its `cooperative` value is treated as `never`.
   */
  getSymbolCollision(): {text: SymbolPartCollision; icon: SymbolPartCollision} {
    const zoom = getZoomBucket(this.props.zoom || 0);
    const evaluate = (name: string) =>
      this.getStyleProperty(name)?.evaluate(zoom) ?? getStylePropertyDefault(name);
    const allowsOverlap = (part: string) => {
      const overlap = this.getStyleProperty(`${part}-overlap`)?.evaluate(zoom);
      return overlap ? overlap === 'always' : Boolean(evaluate(`${part}-allow-overlap`));
    };
    return getSymbolCollision({
      hasText: Boolean(this.getStyleProperty('text-field')),
      hasIcon: Boolean(this.getStyleProperty('icon-image')),
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
   * they are. Lines are labelled at the middle vertex of their first part, whatever the
   * `symbol-placement`. With `symbol-placement: point`, each polygon of a feature is labelled at
   * its pole of inaccessibility, as in MapLibre, if that point lies in this tile; polygons are not
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
   * Label rows for every anchor of `features`: `symbol-placement` is evaluated once, and one
   * search budget is shared by all polygons of the tile.
   */
  getLabelData(features: FeatureLike[], geographic: boolean): LabelRow[] {
    const placement = this.getSymbolPlacement();
    const budget = {segmentTests: TILE_POLE_SEARCH_SEGMENT_TESTS};
    return features.flatMap((feature, index) =>
      this.getLabelAnchors(feature, geographic, placement, budget).map(position =>
        this.getSubLayerRow({position}, feature, index)
      )
    );
  }

  /**
   * The inputs besides the tile data that the anchors depend on: `symbol-placement`, the
   * coordinate mode, the tile's extent and, for globe tiles, the search precision's zoom.
   */
  getAnchorKey(geographic: boolean): string {
    return JSON.stringify([
      this.getSymbolPlacement(),
      geographic,
      geographic ? Math.floor(this.props.zoom || 0) : null,
      this.getTileBounds(geographic)
    ]);
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
      const collision = this.getSymbolCollision();
      // The text's collision box also marks the anchor that the icon's collision test samples.
      const textLayers = placeSymbolPart(
        new TextLayer({
          ...this.getSubLayerProps({id: 'text'}),
          data: this.state.labelData,
          extensions: [...(this.props.extensions || []), new CollisionFilterExtension()],
          parameters: {
            depthTest: false
          },
          billboard,
          characterSet: 'auto',
          collisionEnabled: true,
          collisionGroup: LABEL_COLLISION_GROUP,
          getCollisionPriority: this.getSubLayerAccessor((feature: FeatureLike) =>
            this.getLabelCollisionPriority(feature)
          ) as any,
          fontFamily: font.fontFamily,
          fontWeight: getTextLayerFontWeight(font),
          sizeUnits: labelSizeUnits,
          // The collision filter keeps a label only where the label itself covers its anchor in
          // the collision map. The background box is always drawn (transparent without a halo)
          // and, in the collision pass, padded to reach the anchor (see getCollisionPadding).
          // Text that ignores placement keeps only that padding around its anchor.
          background: true,
          collisionTestProps: {
            padding: this.getCollisionPadding(),
            ...(collision.text.blocks ? {} : {sizeScale: 0})
          },
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
        }),
        collision.text,
        collision.text.blocks || collision.icon.tested
      );
      layers.push(...textLayers);
    }

    return layers;
  }
}
