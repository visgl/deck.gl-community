// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, FirstPersonView, OrthographicView, _GlobeView} from '@deck.gl/core';
import {
  ArcLayer,
  GeoJsonLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer
} from '@deck.gl/layers';
import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import {GraphLayer, MarkerLayer, SimpleLayout} from '@deck.gl-community/graph-layers';
import {GlobalGridLayer, H3Grid} from '@deck.gl-community/geo-layers';
import {PathMarkerLayer, SkyboxLayer} from '@deck.gl-community/layers';
import {BlockLayer, FastTextLayer} from '@deck.gl-community/infovis-layers';
import {HorizonGraphLayer} from '@deck.gl-community/timeline-layers';
import {DrawPolygonMode, EditableGeoJsonLayer, ViewMode} from '@deck.gl-community/editable-layers';
import {Playground, type PlaygroundTemplate} from '@deck.gl-community/playground';
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

const TEMPLATES: Record<string, PlaygroundTemplate> = {
  scatterplot: scatterplotExample,
  'arc-network': arcNetworkExample,
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

const LAYERS = {
  ArcLayer,
  GeoJsonLayer,
  HeatmapLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer,
  MarkerLayer,
  GlobalGridLayer,
  PathMarkerLayer,
  BlockLayer,
  FastTextLayer,
  HorizonGraphLayer,
  GraphLayer,
  SkyboxLayer,
  EditableGeoJsonLayer
};

function resolveValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('@@#')) {
    return {H3Grid, SimpleLayout: new SimpleLayout(), DrawPolygonMode, ViewMode}[
      value.slice(3) as 'H3Grid'
    ];
  }
  if (typeof value === 'string' && value.startsWith('@@=')) {
    const expression = value.slice(3).trim();
    const arithmetic = expression.match(/^([\w$.]+)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)$/);
    if (arithmetic) {
      const [, path, operator, operandText] = arithmetic;
      const operand = Number(operandText);
      return (object: Record<string, unknown>) => {
        const source = getPath(object, path);
        if (typeof source !== 'number') return undefined;
        if (operator === '+') return source + operand;
        if (operator === '-') return source - operand;
        if (operator === '*') return source * operand;
        return source / operand;
      };
    }
    return (object: Record<string, unknown>) => getPath(object, expression);
  }
  if (Array.isArray(value)) return value.map(resolveValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveValue(child)])
    );
  }
  return value;
}

function getPath(object: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce(
      (current, key) =>
        current && typeof current === 'object'
          ? (current as Record<string, unknown>)[key]
          : undefined,
      object as unknown
    );
}

function createLayer(document: Record<string, unknown>, index: number) {
  const type = String(document['@@type']);
  const Layer = LAYERS[type as keyof typeof LAYERS];
  if (!Layer) throw new Error(`No playground layer registered for ${type}`);
  const props = resolveValue({...document, id: document.id ?? `${type.toLowerCase()}-${index}`});
  return new Layer(props as never);
}

function createView(document: Record<string, unknown>) {
  const type = document['@@type'];
  if (type === 'OrthographicView') {
    return new OrthographicView(resolveValue({...document, '@@type': undefined}) as never);
  }
  if (type === '_GlobeView') {
    return new _GlobeView(resolveValue({...document, '@@type': undefined}) as never);
  }
  if (type === 'FirstPersonView') {
    return new FirstPersonView(resolveValue({...document, '@@type': undefined}) as never);
  }
  return undefined;
}

export function mountPlaygroundExample(container: HTMLElement): () => void {
  let deck: Deck | undefined;
  const playground = new Playground({
    parentElement: container,
    templates: TEMPLATES,
    render: (previewElement, value) => {
      const document = value as {
        initialViewState?: Record<string, unknown>;
        layers?: unknown[];
        views?: unknown;
      };
      deck?.finalize();
      const views = Array.isArray(document.views)
        ? document.views
        : document.views
          ? [document.views]
          : [];
      deck = new Deck({
        parent: previewElement as HTMLDivElement,
        controller: true,
        initialViewState: document.initialViewState,
        ...(views.length
          ? {views: views.map(view => createView(view as Record<string, unknown>)).filter(Boolean)}
          : {}),
        layers: (document.layers ?? []).map((layer, index) =>
          createLayer(layer as Record<string, unknown>, index)
        ),
        getTooltip: ({object}) => (object ? JSON.stringify(object) : null)
      });
      return () => {
        deck?.finalize();
        deck = undefined;
      };
    }
  });

  return () => {
    playground.finalize();
    deck?.finalize();
  };
}
