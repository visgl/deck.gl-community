import {TileLayer} from '@deck.gl/geo-layers';
import {BitmapLayer} from '@deck.gl/layers';
import type {BasemapSource, BasemapStyleLayer} from '../style-resolver';

/**
 * Creates a legacy raster tile layer from a style layer definition.
 */
export function generateRasterLayer(
  sources: Record<string, BasemapSource>,
  layer: BasemapStyleLayer
): any {
  const source = sources[layer.source || ''];
  if (!source?.tiles) {
    return null;
  }

  const tileSize = source.tileSize || 512;
  const minZoom = layer.minzoom || source.minzoom || 0;
  const maxZoom = layer.maxzoom || source.maxzoom || 0;

  return new TileLayer({
    data: source.tiles,
    minZoom,
    maxZoom,
    tileSize,
    renderSubLayers: props => {
      const {west, south, east, north} = (props.tile?.bbox || {}) as {
        west: number;
        south: number;
        east: number;
        north: number;
      };

      return new BitmapLayer({
        ...props,
        data: null,
        image: props.data,
        bounds: [west, south, east, north]
      } as any);
    }
  });
}

/**
 * Placeholder background-layer generator for the legacy parser surface.
 */
export function generateBackgroundLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
): null {
  return null;
}
