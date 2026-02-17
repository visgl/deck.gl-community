import {findFeaturesStyledByLayer} from './mapbox-style';

// globalProperties' type:
// https://github.com/maplibre/maplibre-gl-js/blob/2112766af5d68a7ea885156c8c186c72a4e912ca/src/style-spec/expression/index.js#L41-L47
const globalProperties = {zoom: 0};

/**
 * Generate a new deck.gl layer for each StyleJSON layer
 *
 * @param  {object[]} layers StyleJSON layers
 * @return {object[]}        An array of deck.gl layers
 */
export function generateLayers(styleJson, globalProperties) {
  // TODO: a source can have a `url` argument, which means it has a hosted
  // TileJSON, whose properties need to be merged with the source defined in the
  // StyleJSON
  // In this case need to fetch the JSON
  const {sources, layers} = styleJson;
  const deckLayers = [];

  for (const layer of layers) {
    deckLayers.push(generateLayer(sources, layer, globalProperties));
  }

  return deckLayers;
}

const FILTERABLE_LAYERS = ['fill', 'line', 'symbol', 'circle', 'fill-extrusion'];

/**
 * Generate single deck.gl layer from Mapbox layer
 *
 * @param  {object} sources          sources object
 * @param  {object} layer            mapbox style layer
 * @param  {object} globalProperties object with current zoom level
 * @return {object}                  deck.gl layer
 */
function generateLayer(sources, layer, globalProperties) {
  const {type} = layer;

  // Parse property descriptions into values, resolving zoom
  const properties = parseProperties(layer, globalProperties);

  // Convert from Mapbox to Deck properties
  const deckProperties = {};
  for (const property of properties) {
    const key = Object.keys(property)[0];
    deckProperties[PROPERTY_XW[key]] = property[key];
  }

  // Make dataTransform function to filter data on each deck.gl layer
  let dataTransform;
  if (FILTERABLE_LAYERS.includes(type)) {
    dataTransform = (data) =>
      findFeaturesStyledByLayer({
        features: data,
        layer,
        globalProperties
      });
  }

  // Render deck.gl layers
  switch (type) {
    case 'background':
      return generateBackgroundLayer(sources, layer, deckProperties, dataTransform);
    case 'fill':
      return generateFillLayer(sources, layer, deckProperties, dataTransform);
    case 'line':
      return generateLineLayer(sources, layer, deckProperties, dataTransform);
    case 'symbol':
      return generateSymbolLayer(sources, layer, deckProperties, dataTransform);
    case 'raster':
      return generateRasterLayer(sources, layer, deckProperties, dataTransform);
    case 'circle':
      return generateCircleLayer(sources, layer, deckProperties, dataTransform);
    case 'fill-extrusion':
      return generateFillExtrusionLayer(sources, layer, deckProperties, dataTransform);
    case 'heatmap':
      return generateHeatmapLayer(sources, layer, deckProperties, dataTransform);
    // case "hillshade":
    //   return generateHillshadeLayer(sources, layer);
    default:
      console.warn(`Invalid/unsupported layer type: ${type}`);
  }
}
