// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {
  ArcLayer,
  GeoJsonLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer
} from '@deck.gl/layers';
import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import {MarkerLayer} from '@deck.gl-community/graph-layers';
import {GlobalGridLayer, H3Grid} from '@deck.gl-community/geo-layers';
import {PathMarkerLayer} from '@deck.gl-community/layers';
import {BlockLayer, FastTextLayer} from '@deck.gl-community/infovis-layers';
import {HorizonGraphLayer} from '@deck.gl-community/timeline-layers';
import {Playground, type PlaygroundTemplate} from '@deck.gl-community/playground';

const exampleFiles = import.meta.glob('./examples/*.json', {eager: true, import: 'default'});
const TEMPLATES: Record<string, PlaygroundTemplate> = Object.fromEntries(
  Object.entries(exampleFiles).map(([path, value]) => [
    path.split('/').pop()!.replace('.json', '').replace(/^\d+-/, ''),
    value as PlaygroundTemplate
  ])
);

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
  HorizonGraphLayer
};

function resolveValue(value: unknown): unknown {
  if (typeof value === 'string' && value.startsWith('@@#')) {
    return {H3Grid}[value.slice(3) as 'H3Grid'];
  }
  if (typeof value === 'string' && value.startsWith('@@=')) {
    const path = value.slice(3).trim().split('.');
    return (object: Record<string, unknown>) =>
      path.reduce(
        (current, key) => (current && typeof current === 'object' ? current[key] : undefined),
        object
      );
  }
  if (Array.isArray(value)) return value.map(resolveValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, resolveValue(child)])
    );
  }
  return value;
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
        views: views.map(view => createView(view as Record<string, unknown>)).filter(Boolean),
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
