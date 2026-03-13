// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {BaseLayerOptions, Color, LayerDescriptor} from './types';

// ---------------------------------------------------------------------------
// ScatterplotLayer
// ---------------------------------------------------------------------------

/** Options for {@link createScatterplotLayer}. */
export type ScatterplotSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** Accessor that returns [longitude, latitude] for each datum. */
  getPosition: (d: D) => [number, number] | [number, number, number];
  /** Fill colour accessor or static colour. Defaults to [255, 140, 0]. */
  getFillColor?: ((d: D) => Color) | Color;
  /** Line colour accessor or static colour. Defaults to [255, 255, 255]. */
  getLineColor?: ((d: D) => Color) | Color;
  /** Radius accessor (metres) or static value. Defaults to 30. */
  getRadius?: ((d: D) => number) | number;
  /** Whether to stroke the circles. Defaults to false. */
  stroked?: boolean;
  /** Whether to fill the circles. Defaults to true. */
  filled?: boolean;
  /** Radius units: 'meters' | 'pixels' | 'common'. Defaults to 'meters'. */
  radiusUnits?: 'meters' | 'pixels' | 'common';
  /** Scale multiplier applied to getRadius. Defaults to 1. */
  radiusScale?: number;
  /** Minimum rendered radius in pixels. Defaults to 0. */
  radiusMinPixels?: number;
  /** Maximum rendered radius in pixels. Defaults to Infinity. */
  radiusMaxPixels?: number;
};

/**
 * Skill: create a ScatterplotLayer descriptor.
 *
 * @example
 * ```ts
 * const layer = createScatterplotLayer({
 *   data: cities,
 *   getPosition: d => [d.lng, d.lat],
 *   getRadius: d => d.population / 100,
 *   getFillColor: [255, 0, 128],
 * });
 * // → { id, type: 'ScatterplotLayer', props: { … } }
 * ```
 */
export function createScatterplotLayer<D>(options: ScatterplotSkillOptions<D>): LayerDescriptor {
  const {
    id = 'scatterplot-layer',
    opacity = 1,
    visible = true,
    pickable = false,
    data,
    getPosition,
    getFillColor = [255, 140, 0],
    getLineColor = [255, 255, 255],
    getRadius = 30,
    stroked = false,
    filled = true,
    radiusUnits = 'meters',
    radiusScale = 1,
    radiusMinPixels = 0,
    radiusMaxPixels = Infinity
  } = options;

  return {
    id,
    type: 'ScatterplotLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      getPosition,
      getFillColor,
      getLineColor,
      getRadius,
      stroked,
      filled,
      radiusUnits,
      radiusScale,
      radiusMinPixels,
      radiusMaxPixels
    }
  };
}

// ---------------------------------------------------------------------------
// PathLayer
// ---------------------------------------------------------------------------

/** Options for {@link createPathLayer}. */
export type PathSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** Accessor that returns an array of positions for each path. */
  getPath: (d: D) => ([number, number] | [number, number, number])[];
  /** Colour accessor or static colour. Defaults to [255, 255, 255]. */
  getColor?: ((d: D) => Color) | Color;
  /** Width accessor (units) or static value. Defaults to 2. */
  getWidth?: ((d: D) => number) | number;
  /** Width units: 'meters' | 'pixels' | 'common'. Defaults to 'meters'. */
  widthUnits?: 'meters' | 'pixels' | 'common';
  /** Minimum rendered width in pixels. Defaults to 0. */
  widthMinPixels?: number;
  /** Maximum rendered width in pixels. Defaults to Infinity. */
  widthMaxPixels?: number;
  /** Whether to cap the ends of paths. Defaults to true. */
  capRounded?: boolean;
  /** Whether to round path joints. Defaults to false. */
  jointRounded?: boolean;
};

/**
 * Skill: create a PathLayer descriptor.
 *
 * @example
 * ```ts
 * const layer = createPathLayer({
 *   data: routes,
 *   getPath: d => d.coordinates,
 *   getColor: [253, 128, 93],
 *   getWidth: 5,
 *   widthUnits: 'pixels',
 * });
 * ```
 */
export function createPathLayer<D>(options: PathSkillOptions<D>): LayerDescriptor {
  const {
    id = 'path-layer',
    opacity = 1,
    visible = true,
    pickable = false,
    data,
    getPath,
    getColor = [255, 255, 255],
    getWidth = 2,
    widthUnits = 'meters',
    widthMinPixels = 0,
    widthMaxPixels = Infinity,
    capRounded = true,
    jointRounded = false
  } = options;

  return {
    id,
    type: 'PathLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      getPath,
      getColor,
      getWidth,
      widthUnits,
      widthMinPixels,
      widthMaxPixels,
      capRounded,
      jointRounded
    }
  };
}

// ---------------------------------------------------------------------------
// PolygonLayer
// ---------------------------------------------------------------------------

/** Options for {@link createPolygonLayer}. */
export type PolygonSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** Accessor that returns an array of positions (ring) or array of rings. */
  getPolygon: (d: D) => ([number, number] | [number, number, number])[];
  /** Fill colour accessor or static colour. Defaults to [80, 130, 200]. */
  getFillColor?: ((d: D) => Color) | Color;
  /** Line colour accessor or static colour. Defaults to [255, 255, 255]. */
  getLineColor?: ((d: D) => Color) | Color;
  /** Line width accessor or static value. Defaults to 1. */
  getLineWidth?: ((d: D) => number) | number;
  /** Extrusion height accessor or static value. Defaults to 0 (flat). */
  getElevation?: ((d: D) => number) | number;
  /** Whether to fill polygons. Defaults to true. */
  filled?: boolean;
  /** Whether to draw polygon outlines. Defaults to false. */
  stroked?: boolean;
  /** Whether to extrude polygons to 3D. Defaults to false. */
  extruded?: boolean;
  /** Line width units. Defaults to 'meters'. */
  lineWidthUnits?: 'meters' | 'pixels' | 'common';
};

/**
 * Skill: create a PolygonLayer descriptor.
 *
 * @example
 * ```ts
 * const layer = createPolygonLayer({
 *   data: districts,
 *   getPolygon: d => d.contour,
 *   getFillColor: d => [d.value * 255, 100, 100],
 *   stroked: true,
 * });
 * ```
 */
export function createPolygonLayer<D>(options: PolygonSkillOptions<D>): LayerDescriptor {
  const {
    id = 'polygon-layer',
    opacity = 0.8,
    visible = true,
    pickable = false,
    data,
    getPolygon,
    getFillColor = [80, 130, 200],
    getLineColor = [255, 255, 255],
    getLineWidth = 1,
    getElevation = 0,
    filled = true,
    stroked = false,
    extruded = false,
    lineWidthUnits = 'meters'
  } = options;

  return {
    id,
    type: 'PolygonLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      getPolygon,
      getFillColor,
      getLineColor,
      getLineWidth,
      getElevation,
      filled,
      stroked,
      extruded,
      lineWidthUnits
    }
  };
}

// ---------------------------------------------------------------------------
// TextLayer
// ---------------------------------------------------------------------------

/** Options for {@link createTextLayer}. */
export type TextSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** Accessor that returns [longitude, latitude] for each datum. */
  getPosition: (d: D) => [number, number] | [number, number, number];
  /** Accessor that returns the text string to display. */
  getText: (d: D) => string;
  /** Text colour accessor or static colour. Defaults to [255, 255, 255]. */
  getColor?: ((d: D) => Color) | Color;
  /** Text size accessor (pixels) or static value. Defaults to 12. */
  getSize?: ((d: D) => number) | number;
  /** Anchor point: 'start' | 'middle' | 'end'. Defaults to 'middle'. */
  getTextAnchor?: ((d: D) => string) | string;
  /** Alignment baseline. Defaults to 'center'. */
  getAlignmentBaseline?: ((d: D) => string) | string;
  /** Pixel offset [x, y]. Defaults to [0, 0]. */
  getPixelOffset?: ((d: D) => [number, number]) | [number, number];
  /** Font family. Defaults to 'Monaco, monospace'. */
  fontFamily?: string;
  /** Whether to render text as world units (vs. screen pixels). Defaults to false. */
  billboard?: boolean;
};

/**
 * Skill: create a TextLayer descriptor.
 *
 * @example
 * ```ts
 * const layer = createTextLayer({
 *   data: labels,
 *   getPosition: d => [d.lng, d.lat],
 *   getText: d => d.name,
 *   getSize: 14,
 * });
 * ```
 */
export function createTextLayer<D>(options: TextSkillOptions<D>): LayerDescriptor {
  const {
    id = 'text-layer',
    opacity = 1,
    visible = true,
    pickable = false,
    data,
    getPosition,
    getText,
    getColor = [255, 255, 255],
    getSize = 12,
    getTextAnchor = 'middle',
    getAlignmentBaseline = 'center',
    getPixelOffset = [0, 0],
    fontFamily = 'Monaco, monospace',
    billboard = false
  } = options;

  return {
    id,
    type: 'TextLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      getPosition,
      getText,
      getColor,
      getSize,
      getTextAnchor,
      getAlignmentBaseline,
      getPixelOffset,
      fontFamily,
      billboard
    }
  };
}

// ---------------------------------------------------------------------------
// IconLayer
// ---------------------------------------------------------------------------

/** Options for {@link createIconLayer}. */
export type IconSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** URL of the icon atlas image. */
  iconAtlas: string;
  /** Icon mapping object: { iconName: {x, y, width, height, mask?} }. */
  iconMapping: Record<
    string,
    {x: number; y: number; width: number; height: number; mask?: boolean}
  >;
  /** Accessor that returns [longitude, latitude] for each datum. */
  getPosition: (d: D) => [number, number] | [number, number, number];
  /** Accessor that returns the icon name for each datum. */
  getIcon: (d: D) => string;
  /** Size accessor (pixels) or static value. Defaults to 32. */
  getSize?: ((d: D) => number) | number;
  /** Colour accessor or static colour. Defaults to [255, 255, 255] (no tint). */
  getColor?: ((d: D) => Color) | Color;
  /** Pixel anchor offset [x, y]. Defaults to [0, 0]. */
  getPixelOffset?: ((d: D) => [number, number]) | [number, number];
};

/**
 * Skill: create an IconLayer descriptor.
 *
 * @example
 * ```ts
 * const layer = createIconLayer({
 *   data: markers,
 *   iconAtlas: '/icons.png',
 *   iconMapping: { pin: {x:0, y:0, width:32, height:32} },
 *   getPosition: d => [d.lng, d.lat],
 *   getIcon: () => 'pin',
 * });
 * ```
 */
export function createIconLayer<D>(options: IconSkillOptions<D>): LayerDescriptor {
  const {
    id = 'icon-layer',
    opacity = 1,
    visible = true,
    pickable = false,
    data,
    iconAtlas,
    iconMapping,
    getPosition,
    getIcon,
    getSize = 32,
    getColor = [255, 255, 255],
    getPixelOffset = [0, 0]
  } = options;

  return {
    id,
    type: 'IconLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      iconAtlas,
      iconMapping,
      getPosition,
      getIcon,
      getSize,
      getColor,
      getPixelOffset
    }
  };
}

// ---------------------------------------------------------------------------
// HeatmapLayer
// ---------------------------------------------------------------------------

/** Options for {@link createHeatmapLayer}. */
export type HeatmapSkillOptions<D> = BaseLayerOptions & {
  /** Source data array. */
  data: D[];
  /** Accessor that returns [longitude, latitude] for each datum. */
  getPosition: (d: D) => [number, number] | [number, number, number];
  /** Weight accessor or static value 0–1. Defaults to 1. */
  getWeight?: ((d: D) => number) | number;
  /** Intensity multiplier. Defaults to 1. */
  intensity?: number;
  /** Radius of influence in pixels. Defaults to 30. */
  radiusPixels?: number;
  /** Threshold 0–1 below which pixels are hidden. Defaults to 0.03. */
  threshold?: number;
  /** Color range array of RGBA colours. Defaults to a blue-to-red ramp. */
  colorRange?: Color[];
  /** Aggregation: 'SUM' | 'MEAN'. Defaults to 'SUM'. */
  aggregation?: 'SUM' | 'MEAN';
};

/** Default blue→red heatmap colour ramp. */
export const DEFAULT_HEATMAP_COLOR_RANGE: Color[] = [
  [0, 25, 0, 25],
  [0, 85, 80, 90],
  [0, 170, 160, 160],
  [0, 255, 255, 128],
  [200, 200, 0, 128],
  [255, 140, 0, 200],
  [255, 0, 0, 230]
];

/**
 * Skill: create a HeatmapLayer descriptor.
 *
 * Requires `@deck.gl/aggregation-layers` to be installed.
 *
 * @example
 * ```ts
 * const layer = createHeatmapLayer({
 *   data: events,
 *   getPosition: d => [d.lng, d.lat],
 *   getWeight: d => d.magnitude,
 *   radiusPixels: 60,
 * });
 * ```
 */
export function createHeatmapLayer<D>(options: HeatmapSkillOptions<D>): LayerDescriptor {
  const {
    id = 'heatmap-layer',
    opacity = 1,
    visible = true,
    pickable = false,
    data,
    getPosition,
    getWeight = 1,
    intensity = 1,
    radiusPixels = 30,
    threshold = 0.03,
    colorRange = DEFAULT_HEATMAP_COLOR_RANGE,
    aggregation = 'SUM'
  } = options;

  return {
    id,
    type: 'HeatmapLayer',
    props: {
      id,
      data,
      opacity,
      visible,
      pickable,
      getPosition,
      getWeight,
      intensity,
      radiusPixels,
      threshold,
      colorRange,
      aggregation
    }
  };
}
