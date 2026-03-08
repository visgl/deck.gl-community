// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// Types
export type {
  ColorRGBA,
  LayerType,
  ViewState,
  LayerDescriptor,
  DeckConfig,
  ValidationResult
} from './types';

// Native-code path — typed factory functions
export type {
  ScatterplotLayerOptions,
  PathLayerOptions,
  PolygonLayerOptions,
  TextLayerOptions,
  ArcLayerOptions,
  HeatmapLayerOptions
} from './layer-factories';
export {
  scatterplotLayer,
  pathLayer,
  polygonLayer,
  textLayer,
  arcLayer,
  heatmapLayer
} from './layer-factories';

// JSON descriptor path — serializable IR + hydration
export {createDescriptor, validateDescriptor, hydrateDescriptor} from './layer-descriptors';

// Fluent builder
export {DeckBuilder} from './deck-builder';

// Viewport helpers
export {createViewState, getBoundingBox, fitViewport} from './viewport-skills';
