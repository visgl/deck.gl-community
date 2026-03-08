// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** RGBA color as a 3- or 4-element tuple */
export type ColorRGBA = [number, number, number] | [number, number, number, number];

/** Supported layer types for the JSON descriptor path */
export type LayerType =
  | 'ScatterplotLayer'
  | 'PathLayer'
  | 'PolygonLayer'
  | 'TextLayer'
  | 'IconLayer'
  | 'HeatmapLayer'
  | 'ArcLayer'
  | 'ColumnLayer'
  | 'GeoJsonLayer';

/**
 * Web Mercator view state understood by deck.gl's MapView.
 */
export interface ViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  minZoom?: number;
  maxZoom?: number;
}

/**
 * Fully-serializable layer descriptor — the JSON IR ("noodle") approach.
 *
 * Accessor props may be dot-path strings (e.g. `"meta.size"`) that are
 * resolved to runtime functions by `hydrateDescriptor`.
 * This format is safe to store, transmit, and emit from LLMs that must not
 * produce executable code.
 */
export interface LayerDescriptor {
  /** deck.gl layer class name */
  type: LayerType;
  /** Stable id for reconciliation; defaults to `type` if omitted */
  id?: string;
  /** Layer props — accessor values may be dot-path strings or literals */
  props: Record<string, unknown>;
}

/**
 * Top-level deck.gl configuration returned by DeckBuilder.
 */
export interface DeckConfig {
  layers: LayerDescriptor[];
  viewState: ViewState;
  mapStyle?: string;
}

/**
 * Result of validating a LayerDescriptor before hydration.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}
