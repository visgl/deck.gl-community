import {log} from '@deck.gl/core';
import {generateBackgroundLayer, generateRasterLayer} from './deck-layers/bitmap';
import {generateHeatmapLayer} from './deck-layers/heatmap';
import {generateSymbolLayer} from './deck-layers/icon';
import {generateCircleLayer, generateFillLayer, generateLineLayer} from './deck-layers/mvt';
import {PROPERTY_XW} from './deck-layers/properties';
import {findFeaturesStyledByLayer, parseProperties} from './style-spec';
import type {BasemapSource, BasemapStyle, BasemapStyleLayer} from './style-resolver';

type GlobalProperties = {
  zoom: number;
};

type StyleJson = BasemapStyle & {
  sources: Record<string, BasemapSource>;
  layers: BasemapStyleLayer[];
};

type DataTransform = ((data: unknown) => unknown) | undefined;

const DEFAULT_GLOBAL_PROPERTIES: GlobalProperties = {zoom: 0};
const FILTERABLE_LAYERS = ['fill', 'line', 'symbol', 'circle', 'fill-extrusion'];
const LAYER_GENERATORS = {
  background: generateBackgroundLayer,
  line: generateLineLayer,
  symbol: generateSymbolLayer,
  raster: generateRasterLayer,
  circle: generateCircleLayer,
  heatmap: generateHeatmapLayer,
  'fill-extrusion': generateFillExtrusionLayer
} as const;

/**
 * Generates deck.gl layers for every layer entry in a style document.
 *
 * This helper reflects the legacy style-parser surface and is intentionally
 * limited; unsupported style types are ignored.
 */
export function generateLayers(
  styleJson: StyleJson,
  globalProperties: GlobalProperties = DEFAULT_GLOBAL_PROPERTIES
) {
  const {sources, layers} = styleJson;
  return layers
    .map(layer => generateLayer(sources, layer, globalProperties))
    .filter(Boolean);
}

/**
 * Generates a deck.gl layer for a single style layer entry.
 */
function generateLayer(
  sources: Record<string, BasemapSource>,
  layer: BasemapStyleLayer,
  globalProperties: GlobalProperties
) {
  const {type} = layer;
  const directGenerator = LAYER_GENERATORS[type as keyof typeof LAYER_GENERATORS];
  if (directGenerator) {
    return directGenerator(sources, layer as never);
  }

  const properties = parseProperties(layer, globalProperties);

  const deckProperties: Record<string, unknown> = {};
  for (const property of properties) {
    const [key, value] = Object.entries(property)[0];
    const mappedKey = PROPERTY_XW[key];
    if (mappedKey) {
      deckProperties[mappedKey] = value;
    }
  }

  let dataTransform: DataTransform;
  if (FILTERABLE_LAYERS.includes(type)) {
    dataTransform = data =>
      findFeaturesStyledByLayer({
        features: data as Record<string, Record<string, unknown[]>>,
        layer,
        globalProperties
      });
  }

  if (type === 'fill') {
    return generateFillLayer(sources, layer, deckProperties, dataTransform);
  }

  log.warn(`Invalid/unsupported layer type: ${type}`)();
  return null;
}

/**
 * Placeholder fill-extrusion generator for the legacy parser surface.
 */
function generateFillExtrusionLayer(
  _sources: Record<string, BasemapSource>,
  _layer: BasemapStyleLayer
) {
  return null;
}
