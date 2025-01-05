const BACKGROUND_XW = {
  // 'background-color': '',
  'background-opacity': 'opacity',
  // 'background-pattern': '',
  visibility: 'visible'
};

const FILL_XW = {
  // 'fill-antialias': '',
  'fill-color': 'getFillColor',
  'fill-opacity': 'opacity',
  'fill-outline-color': 'getLineColor',
  // 'fill-pattern': '',
  // 'fill-sort-key': '',
  // 'fill-translate': '',
  // 'fill-translate-anchor': '',
  visibility: 'visible'
};

const LINE_XW = {
  // 'line-blur': '',
  // 'line-cap': '',
  'line-color': 'getColor',
  // 'line-dasharray': '',
  // 'line-gap-width': '',
  // 'line-gradient': '',
  // 'line-join': '',
  // 'line-miter-limit': '',
  // 'line-offset': '',
  'line-opacity': 'opacity',
  // 'line-pattern': '',
  // 'line-round-limit': '',
  // 'line-sort-key': '',
  // 'line-translate': '',
  // 'line-translate-anchor': '',
  'line-width': 'getWidth',
  visibility: 'visible'
};

const SYMBOL_XW = {
  // 'icon-allow-overlap': '',
  // 'icon-anchor': '',
  // 'icon-color': '',
  // 'icon-halo-blur': '',
  // 'icon-halo-color': '',
  // 'icon-halo-width': '',
  // 'icon-ignore-placement': '',
  // 'icon-image': '',
  // 'icon-keep-upright': '',
  // 'icon-offset': '',
  // 'icon-opacity': 'opacity',
  // 'icon-optional': '',
  // 'icon-padding': '',
  // 'icon-pitch-alignment': '',
  // 'icon-rotate': '',
  // 'icon-rotation-alignment': '',
  // 'icon-size': '',
  // 'icon-text-fit': '',
  // 'icon-text-fit-padding': '',
  // 'icon-translate': '',
  // 'icon-translate-anchor': '',
  // 'symbol-avoid-edges': '',
  // 'symbol-placement': '',
  // 'symbol-sort-key': '',
  // 'symbol-spacing': '',
  // 'symbol-z-order': '',
  // 'text-allow-overlap': '',
  // 'text-anchor': '',
  // 'text-color': '',
  // 'text-field': '',
  // 'text-font': '',
  // 'text-halo-blur': '',
  // 'text-halo-color': '',
  // 'text-halo-width': '',
  // 'text-ignore-placement': '',
  // 'text-justify': '',
  // 'text-keep-upright': '',
  // 'text-letter-spacing': '',
  // 'text-line-height': '',
  // 'text-max-angle': '',
  // 'text-max-width': '',
  // 'text-offset': '',
  // 'text-opacity': 'opacity',
  // 'text-optional': '',
  // 'text-padding': '',
  // 'text-pitch-alignment': '',
  // 'text-radial-offset': '',
  // 'text-rotate': '',
  // 'text-rotation-alignment': '',
  // 'text-size': '',
  // 'text-transform': '',
  // 'text-translate': '',
  // 'text-translate-anchor': '',
  // 'text-variable-anchor': '',
  // 'text-writing-mode': '',
  visibility: 'visible'
};

const RASTER_XW = {
  // 'raster-brightness-max': '',
  // 'raster-brightness-min': '',
  // 'raster-contrast': '',
  // 'raster-fade-duration': '',
  // 'raster-hue-rotate': '',
  'raster-opacity': 'opacity',
  // 'raster-resampling': '',
  // 'raster-saturation': '',
  visibility: 'visible'
};

const CIRCLE_XW = {
  // 'circle-blur': '',
  // 'circle-color': '',
  'circle-opacity': 'opacity',
  // 'circle-pitch-alignment': '',
  // 'circle-pitch-scale': '',
  // 'circle-radius': '',
  // 'circle-sort-key': '',
  // 'circle-stroke-color': '',
  // 'circle-stroke-opacity': '',
  // 'circle-stroke-width': '',
  // 'circle-translate': '',
  // 'circle-translate-anchor': '',
  visibility: 'visible'
};

const FILL_EXTRUSTION_XW = {
  // 'fill-extrusion-base': '',
  'fill-extrusion-color': 'getColor',
  'fill-extrusion-height': 'getElevation',
  'fill-extrusion-opacity': 'opacity',
  // 'fill-extrusion-pattern': '',
  // 'fill-extrusion-translate': '',
  // 'fill-extrusion-translate-anchor': '',
  // 'fill-extrusion-vertical-gradient': '',
  visibility: 'visible'
};

const HEATMAP_XW = {
  // 'heatmap-color': '',
  // 'heatmap-intensity': '',
  'heatmap-opacity': 'opacity',
  // 'heatmap-radius': '',
  // 'heatmap-weight': '',
  visibility: 'visible'
};

const HILLSHADE_XW = {
  // 'hillshade-accent-color': '',
  // 'hillshade-exaggeration': '',
  // 'hillshade-highlight-color': '',
  // 'hillshade-illumination-anchor': '',
  // 'hillshade-illumination-direction': '',
  // 'hillshade-shadow-color': '',
  visibility: 'visible'
};

export const PROPERTY_XW = {
  ...BACKGROUND_XW,
  ...FILL_XW,
  ...LINE_XW,
  ...SYMBOL_XW,
  ...RASTER_XW,
  ...CIRCLE_XW,
  ...FILL_EXTRUSTION_XW,
  ...HEATMAP_XW,
  ...HILLSHADE_XW
};
