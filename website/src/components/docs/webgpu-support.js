const SUPPORTED_DOC_IDS = new Set([
  'modules/geo-layers/api-reference/delaunay-cover-layer',
  'modules/geo-layers/api-reference/global-grid-layer',
  'modules/geo-layers/api-reference/particle-layer',
  'modules/geo-layers/api-reference/tile-grid-layer',
  'modules/geo-layers/api-reference/wind-layer',
  'modules/graph-layers/api-reference/layers/edge-arrow-layer',
  'modules/graph-layers/api-reference/layers/path-edge-layer',
  'modules/graph-layers/api-reference/layers/path-rounded-rectangle-layer',
  'modules/graph-layers/api-reference/layers/rounded-rectangle-layer',
  'modules/infovis-layers/api-reference/block-layer',
  'modules/infovis-layers/api-reference/time-delta-layer',
  'modules/timeline-layers/api-reference/horizon-graph-layer',
  'modules/timeline-layers/api-reference/multi-horizon-graph-layer',
  'modules/timeline-layers/api-reference/vertical-grid-layer',
  'modules/trace-layers/api-reference/layers/trace-graph-layer',
  'modules/trace-layers/api-reference/layers/trace-prepared-state-layer'
]);

const UNSUPPORTED_DOC_IDS = new Set([
  'modules/geo-layers/api-reference/elevation-layer',
  'modules/graph-layers/api-reference/layers/flow-layer',
  'modules/graph-layers/api-reference/layers/flow-path-layer'
]);

const NOT_APPLICABLE_DOC_IDS = new Set([
  'modules/basemap-layers/api-reference/map-style',
  'modules/basemap-layers/api-reference/map-style-loader',
  'modules/geo-layers/api-reference/a5-grid',
  'modules/geo-layers/api-reference/delaunay-interpolation',
  'modules/geo-layers/api-reference/geohash-grid',
  'modules/geo-layers/api-reference/global-grid',
  'modules/geo-layers/api-reference/h3-grid',
  'modules/geo-layers/api-reference/quadkey-grid',
  'modules/geo-layers/api-reference/s2-grid',
  'modules/geo-layers/api-reference/shared-tileset-2d',
  'modules/geo-layers/api-reference/wind-field'
]);

const NOT_APPLICABLE_DOC_ID_PATTERNS = [
  /^modules\/editable-layers\/api-reference\/(?:edit-modes|widgets)\//,
  /^modules\/graph-layers\/api-reference\/(?:internal|layouts|loaders|styling)\//,
  /^modules\/graph-layers\/api-reference\/(?:classic-graph|edge|graph|node|tabular-graph)$/,
  /^modules\/trace-layers\/api-reference\/trace\//
];

const MODULE_STATUS = {
  'arrow-layers': 'partial',
  'basemap-layers': 'partial',
  'bing-maps': 'unsupported',
  'editable-layers': 'partial',
  experimental: 'unsupported',
  'geo-layers': 'partial',
  'graph-layers': 'partial',
  'infovis-layers': 'partial',
  layers: 'supported',
  leaflet: 'unsupported',
  panels: 'not-applicable',
  react: 'not-applicable',
  three: 'partial',
  'timeline-layers': 'partial',
  'trace-layers': 'partial',
  widgets: 'supported'
};

export const WEBGPU_STATUS = {
  supported: {
    label: 'supported',
    description: 'This API is verified on WebGL2 and WebGPU.'
  },
  partial: {
    label: 'partial',
    description: 'Some rendering paths are verified on WebGPU; see the compatibility matrix.'
  },
  unsupported: {
    label: 'not supported',
    description: 'This API currently requires WebGL2 or another host renderer.'
  },
  'not-applicable': {
    label: 'not applicable',
    description: 'This API does not own a graphics backend.'
  },
  mixed: {
    label: 'mixed',
    description: 'WebGPU support varies by module and layer; see the compatibility matrix.'
  }
};

/**
 * Returns the WebGPU status shown on a generated documentation page.
 *
 * Specific verified or blocked layer pages take precedence over their package's aggregate status.
 */
export function getDocWebGpuStatus(docId = '') {
  if (SUPPORTED_DOC_IDS.has(docId)) {
    return 'supported';
  }
  if (UNSUPPORTED_DOC_IDS.has(docId)) {
    return 'unsupported';
  }
  if (
    NOT_APPLICABLE_DOC_IDS.has(docId) ||
    NOT_APPLICABLE_DOC_ID_PATTERNS.some(pattern => pattern.test(docId))
  ) {
    return 'not-applicable';
  }

  const moduleName = /^modules\/([^/]+)/.exec(docId)?.[1];
  return MODULE_STATUS[moduleName] ?? 'mixed';
}
