// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Types
export type {
  LngLat,
  Color,
  BoundingBox,
  ViewState,
  LayerDescriptor,
  BaseLayerOptions
} from './types';

// Layer skills
export type {
  ScatterplotSkillOptions,
  PathSkillOptions,
  PolygonSkillOptions,
  TextSkillOptions,
  IconSkillOptions,
  HeatmapSkillOptions
} from './layer-skills';
export {
  createScatterplotLayer,
  createPathLayer,
  createPolygonLayer,
  createTextLayer,
  createIconLayer,
  createHeatmapLayer,
  DEFAULT_HEATMAP_COLOR_RANGE
} from './layer-skills';

// Viewport skills
export type {CreateViewStateOptions, FitViewportOptions} from './viewport-skills';
export {createViewState, getBoundingBox, fitViewport} from './viewport-skills';

// Data skills
export type {PointFeature, PointFeatureCollection} from './data-skills';
export {
  createColorAccessor,
  extractPositions,
  flattenGeoJSON,
  createRadiusAccessor
} from './data-skills';

// Noodles
export type {
  NoodleKind,
  NoodleAccessor,
  BaseNoodleProps,
  ScatterplotNoodle,
  PathNoodle,
  PolygonNoodle,
  TextNoodle,
  HeatmapNoodle,
  Noodle,
  NoodleValidationResult
} from './noodles';
export {createNoodle, hydrateNoodle, validateNoodle} from './noodles';

// DeckBuilder
export type {DeckConfig} from './deck-builder';
export {DeckBuilder} from './deck-builder';
