export function generateFillLayer(sources, layer, properties, dataTransform) {
  const source = sources[layer.source];
  const minzoom = layer.minzoom || source.minzoom || 0;
  const maxzoom = layer.maxzoom || source.maxzoom || 0;

  return new MVTLayer({
    data: source.tiles,
    minzoom,
    maxzoom,
    dataTransform
  });
}

export function generateLineLayer(sources, layer) {}

export function generateCircleLayer(sources, layer) {}
