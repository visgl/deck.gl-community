import {MVTLayer} from '@deck.gl/geo-layers';
import type {BasemapSource, BasemapStyleLayer} from '../style-resolver';

/**
 * Creates a legacy fill `MVTLayer` from a style layer definition.
 */
export function generateFillLayer(
  sources: Record<string, BasemapSource>,
  layer: BasemapStyleLayer,
  _properties?: Record<string, unknown>,
  dataTransform?: (data: unknown) => unknown
) {
  const source = sources[layer.source || ''];
  if (!source?.tiles) {
    return null;
  }

  const minZoom = layer.minzoom || source.minzoom || 0;
  const maxZoom = layer.maxzoom || source.maxzoom || 0;

  return new MVTLayer({
    data: source.tiles,
    minZoom,
    maxZoom,
    dataTransform
  });
}

/**
 * Placeholder line-layer generator for the legacy parser surface.
 */
export function generateLineLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
) {
  return null;
}

/**
 * Placeholder circle-layer generator for the legacy parser surface.
 */
export function generateCircleLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
) {
  return null;
}

