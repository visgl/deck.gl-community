import type {BasemapSource, BasemapStyleLayer} from '../style-resolver';

/**
 * Placeholder heatmap-layer generator for the legacy parser surface.
 */
export function generateHeatmapLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
) {
  return null;
}

