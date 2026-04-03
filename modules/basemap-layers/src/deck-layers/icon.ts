import type {BasemapSource, BasemapStyleLayer} from '../style-resolver';

/**
 * Placeholder symbol-layer generator for the legacy parser surface.
 */
export function generateSymbolLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
) {
  return null;
}

