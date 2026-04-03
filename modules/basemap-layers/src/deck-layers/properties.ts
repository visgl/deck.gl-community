/**
 * Mapping from supported style-spec property names to deck.gl prop names used
 * by the legacy style parser.
 */
export const PROPERTY_XW: Record<string, string> = {
  'background-opacity': 'opacity',
  visibility: 'visible',
  'fill-color': 'getFillColor',
  'fill-opacity': 'opacity',
  'fill-outline-color': 'getLineColor',
  'line-color': 'getColor',
  'line-opacity': 'opacity',
  'line-width': 'getWidth',
  'raster-opacity': 'opacity',
  'circle-opacity': 'opacity',
  'fill-extrusion-color': 'getColor',
  'fill-extrusion-height': 'getElevation',
  'fill-extrusion-opacity': 'opacity',
  'heatmap-opacity': 'opacity'
};

