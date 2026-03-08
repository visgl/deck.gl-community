// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * layer-factories — typed helper functions for the native-code path.
 *
 * Each factory returns a plain props object with sensible defaults that can be
 * spread directly into the corresponding deck.gl layer constructor:
 *
 *   import {ScatterplotLayer} from '@deck.gl/layers';
 *   import {scatterplotLayer} from '@deck.gl-community/ai-skills';
 *
 *   const layer = new ScatterplotLayer(scatterplotLayer({data: cities, ...}));
 *
 * This is the recommended path for LLM code generation: agents write native
 * TypeScript backed by full type-checking, guided by llms.txt.
 */

import type {ColorRGBA} from './types';

// ---------------------------------------------------------------------------
// Scatterplot
// ---------------------------------------------------------------------------

export interface ScatterplotLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getPosition?: ((d: D) => [number, number] | [number, number, number]) | string;
  getFillColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getRadius?: ((d: D) => number) | number;
  radiusScale?: number;
  radiusUnits?: 'pixels' | 'meters';
  stroked?: boolean;
  getLineColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getLineWidth?: ((d: D) => number) | number;
  opacity?: number;
  pickable?: boolean;
}

const SCATTERPLOT_DEFAULTS = {
  id: 'scatterplot-layer',
  getPosition: (d: unknown) => (d as {coordinates: [number, number]}).coordinates,
  getFillColor: [255, 140, 0] as ColorRGBA,
  getRadius: 100,
  radiusScale: 1,
  radiusUnits: 'meters' as const,
  stroked: false,
  getLineColor: [0, 0, 0, 200] as ColorRGBA,
  getLineWidth: 1,
  opacity: 0.8,
  pickable: true
};

export function scatterplotLayer<D = unknown>(options: ScatterplotLayerOptions<D>) {
  return {...SCATTERPLOT_DEFAULTS, ...options};
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

export interface PathLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getPath?: (d: D) => [number, number][];
  getColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getWidth?: ((d: D) => number) | number;
  widthScale?: number;
  widthUnits?: 'pixels' | 'meters';
  opacity?: number;
  pickable?: boolean;
}

export function pathLayer<D = unknown>(options: PathLayerOptions<D>) {
  return {
    id: options.id ?? 'path-layer',
    data: options.data,
    getPath: options.getPath ?? ((d: unknown) => (d as {path: [number, number][]}).path),
    getColor: options.getColor ?? ([255, 165, 0] as ColorRGBA),
    getWidth: options.getWidth ?? 5,
    widthScale: options.widthScale ?? 1,
    widthUnits: options.widthUnits ?? 'pixels',
    opacity: options.opacity ?? 0.8,
    pickable: options.pickable ?? true
  };
}

// ---------------------------------------------------------------------------
// Polygon
// ---------------------------------------------------------------------------

export interface PolygonLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getPolygon?: (d: D) => [number, number][];
  getFillColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getLineColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getLineWidth?: ((d: D) => number) | number;
  stroked?: boolean;
  filled?: boolean;
  extruded?: boolean;
  getElevation?: ((d: D) => number) | number;
  opacity?: number;
  pickable?: boolean;
}

const POLYGON_DEFAULTS = {
  id: 'polygon-layer',
  getPolygon: (d: unknown) => (d as {contour: [number, number][]}).contour,
  getFillColor: [0, 128, 255, 180] as ColorRGBA,
  getLineColor: [255, 255, 255] as ColorRGBA,
  getLineWidth: 1,
  stroked: true,
  filled: true,
  extruded: false,
  getElevation: 0,
  opacity: 0.8,
  pickable: true
};

export function polygonLayer<D = unknown>(options: PolygonLayerOptions<D>) {
  return {...POLYGON_DEFAULTS, ...options};
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export interface TextLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getText?: (d: D) => string;
  getPosition?: (d: D) => [number, number] | [number, number, number];
  getColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getSize?: ((d: D) => number) | number;
  sizeUnits?: 'pixels' | 'meters';
  getAngle?: ((d: D) => number) | number;
  getTextAnchor?: ((d: D) => string) | string;
  getAlignmentBaseline?: ((d: D) => string) | string;
  pickable?: boolean;
}

export function textLayer<D = unknown>(options: TextLayerOptions<D>) {
  return {
    id: options.id ?? 'text-layer',
    data: options.data,
    getText: options.getText ?? ((d: unknown) => String((d as {name: string}).name)),
    getPosition:
      options.getPosition ?? ((d: unknown) => (d as {coordinates: [number, number]}).coordinates),
    getColor: options.getColor ?? ([255, 255, 255] as ColorRGBA),
    getSize: options.getSize ?? 14,
    sizeUnits: options.sizeUnits ?? 'pixels',
    getAngle: options.getAngle ?? 0,
    getTextAnchor: options.getTextAnchor ?? 'middle',
    getAlignmentBaseline: options.getAlignmentBaseline ?? 'center',
    pickable: options.pickable ?? true
  };
}

// ---------------------------------------------------------------------------
// Arc
// ---------------------------------------------------------------------------

export interface ArcLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getSourcePosition?: (d: D) => [number, number];
  getTargetPosition?: (d: D) => [number, number];
  getSourceColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getTargetColor?: ((d: D) => ColorRGBA) | ColorRGBA;
  getWidth?: ((d: D) => number) | number;
  opacity?: number;
  pickable?: boolean;
}

export function arcLayer<D = unknown>(options: ArcLayerOptions<D>) {
  return {
    id: options.id ?? 'arc-layer',
    data: options.data,
    getSourcePosition:
      options.getSourcePosition ?? ((d: unknown) => (d as {source: [number, number]}).source),
    getTargetPosition:
      options.getTargetPosition ?? ((d: unknown) => (d as {target: [number, number]}).target),
    getSourceColor: options.getSourceColor ?? ([0, 128, 200] as ColorRGBA),
    getTargetColor: options.getTargetColor ?? ([200, 0, 80] as ColorRGBA),
    getWidth: options.getWidth ?? 2,
    opacity: options.opacity ?? 0.8,
    pickable: options.pickable ?? true
  };
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export interface HeatmapLayerOptions<D = unknown> {
  data: D[] | string;
  id?: string;
  getPosition?: (d: D) => [number, number];
  getWeight?: ((d: D) => number) | number;
  radiusPixels?: number;
  intensity?: number;
  threshold?: number;
  colorRange?: ColorRGBA[];
}

export function heatmapLayer<D = unknown>(options: HeatmapLayerOptions<D>) {
  return {
    id: options.id ?? 'heatmap-layer',
    data: options.data,
    getPosition:
      options.getPosition ?? ((d: unknown) => (d as {coordinates: [number, number]}).coordinates),
    getWeight: options.getWeight ?? 1,
    radiusPixels: options.radiusPixels ?? 30,
    intensity: options.intensity ?? 1,
    threshold: options.threshold ?? 0.03,
    colorRange: options.colorRange ?? [
      [255, 255, 178],
      [254, 217, 118],
      [254, 178, 76],
      [253, 141, 60],
      [240, 59, 32],
      [189, 0, 38]
    ]
  };
}
