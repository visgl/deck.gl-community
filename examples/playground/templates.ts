// deck.gl-community
// SPDX-License-Identifier: MIT
import type {PlaygroundTemplate} from '@deck.gl-community/playground';
import scatterplotExample from './examples/01-scatterplot.json';
import arcNetworkExample from './examples/02-arc-network.json';
import geojsonExample from './examples/03-geojson.json';
import heatmapExample from './examples/04-heatmap.json';
import markerLayerExample from './examples/05-marker-layer.json';
import globalGridExample from './examples/06-global-grid.json';
import infovisBlocksExample from './examples/07-infovis-blocks.json';
import horizonGraphExample from './examples/08-horizon-graph.json';
import pathMarkersExample from './examples/09-path-markers.json';
import communityMixExample from './examples/10-community-mix.json';
import skyboxMapExample from './examples/11-skybox-map.json';
import skyboxGlobeExample from './examples/12-skybox-globe.json';
import skyboxFirstPersonExample from './examples/13-skybox-first-person.json';
import graphLayerExample from './examples/14-graph-layer.json';
import editableGeojsonExample from './examples/15-editable-geojson.json';

export const TEMPLATES: Record<string, PlaygroundTemplate> = {
  scatterplot: scatterplotExample,
  arcs: arcNetworkExample,
  geojson: geojsonExample,
  heatmap: heatmapExample,
  'marker-layer': markerLayerExample,
  'global-grid': globalGridExample,
  'infovis-blocks': infovisBlocksExample,
  'horizon-graph': horizonGraphExample,
  'path-markers': pathMarkersExample,
  'community-mix': communityMixExample,
  'skybox-map': skyboxMapExample,
  'skybox-globe': skyboxGlobeExample,
  'skybox-first-person': skyboxFirstPersonExample,
  'graph-layer': graphLayerExample,
  'editable-geojson': editableGeojsonExample
};
