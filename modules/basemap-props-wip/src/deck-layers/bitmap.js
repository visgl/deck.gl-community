/**
 * Generate deck.gl layer for source type 'raster'
 *
 * @param  {object} sources sources object from style
 * @param  {object} layer   layer object from style
 * @return {object}         deck.gl BitmapLayer
 */
export function generateRasterLayer(sources, layer) {
  const source = sources[layer.source];
  const {tileSize} = source;

  const minzoom = layer.minzoom || source.minzoom || 0;
  const maxzoom = layer.maxzoom || source.maxzoom || 0;

  return new TileLayer({
    data: source.tiles,
    minzoom,
    maxzoom,
    tileSize,
    renderSubLayers: (props) => {
      const {
        bbox: {west, south, east, north}
      } = props.tile;

      return new BitmapLayer(props, {
        data: null,
        image: props.data,
        bounds: [west, south, east, north]
      });
    }
  });
}

export function generateBackgroundLayer(sources, layer) {
  // Render a tiled BitmapLayer of the given color
}
