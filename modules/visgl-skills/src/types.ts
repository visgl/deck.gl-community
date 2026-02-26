// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Shared types for visgl-skills layer and viewport helpers.
 */

/** A geographic coordinate [longitude, latitude] or [longitude, latitude, altitude]. */
export type LngLat = [number, number] | [number, number, number];

/** An RGBA color tuple [r, g, b] or [r, g, b, a] where each component is 0-255. */
export type Color = [number, number, number] | [number, number, number, number];

/** A bounding box [minLng, minLat, maxLng, maxLat]. */
export type BoundingBox = [number, number, number, number];

/** deck.gl view-state used by MapView / OrthographicView. */
export type ViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch?: number;
  bearing?: number;
  minZoom?: number;
  maxZoom?: number;
};

/** Minimal deck.gl layer descriptor returned by layer skill factories. */
export type LayerDescriptor = {
  /** Unique layer identifier. */
  id: string;
  /** deck.gl layer class type (e.g. 'ScatterplotLayer'). */
  type: string;
  /** Props forwarded to the deck.gl layer constructor. */
  props: Record<string, unknown>;
};

/** Options shared by every layer skill factory. */
export type BaseLayerOptions = {
  /** Layer identifier – defaults to the layer type name. */
  id?: string;
  /** Layer opacity 0–1. Defaults to 1. */
  opacity?: number;
  /** Whether the layer is visible. Defaults to true. */
  visible?: boolean;
  /** Whether to pick on hover. Defaults to false. */
  pickable?: boolean;
};
