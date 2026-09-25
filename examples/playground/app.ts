// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, FirstPersonView, MapView, OrthographicView, _GlobeView} from '@deck.gl/core';
import {
  ArcLayer,
  GeoJsonLayer,
  LineLayer,
  PolygonLayer,
  ScatterplotLayer,
  TextLayer
} from '@deck.gl/layers';
import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import {BasemapLayer} from '@deck.gl-community/basemap-layers';
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

const BASEMAP_STYLES = [
  {label: 'Positron', style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'},
  {label: 'Dark Matter', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'},
  {label: 'Voyager', style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'}
];

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
  if (type === 'MapView') {
    return new MapView(resolveValue({...document, '@@type': undefined}) as never);
  }
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

function addMapboxAccessTokenToUrl(url: string, accessToken: string): string {
  if (url.startsWith('mapbox://styles/')) {
    url = `https://api.mapbox.com/styles/v1/${url.slice('mapbox://styles/'.length)}`;
  } else if (url.startsWith('mapbox://sprites/')) {
    url = `https://api.mapbox.com/styles/v1/${url.slice('mapbox://sprites/'.length)}/sprite`;
  } else if (url.startsWith('mapbox://fonts/')) {
    url = `https://api.mapbox.com/fonts/v1/${url.slice('mapbox://fonts/'.length)}`;
  } else if (url.startsWith('mapbox://')) {
    url = `https://api.mapbox.com/v4/${url.slice('mapbox://'.length)}.json?secure`;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.hostname === 'api.mapbox.com') {
      parsedUrl.searchParams.set('access_token', accessToken);
      return parsedUrl.toString();
    }
  } catch {
    // Leave relative URLs and other non-URL values unchanged.
  }
  return url;
}

function resolveBasemapStyle(
  style: unknown,
  accessToken?: string
): string | Record<string, unknown> | null {
  if (style === null) {
    return null;
  }
  if (typeof style === 'string') {
    return accessToken ? addMapboxAccessTokenToUrl(style, accessToken) : style;
  }
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    throw new Error('mapStyle must be a URL, a style object, or null');
  }
  if (!accessToken) {
    return style as Record<string, unknown>;
  }
  const addToken = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return addMapboxAccessTokenToUrl(value, accessToken);
    }
    if (Array.isArray(value)) {
      return value.map(addToken);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, addToken(child)])
      );
    }
    return value;
  };
  return addToken(style) as Record<string, unknown>;
}

function getBasemapAttribution(style: unknown): string[] {
  if (style && typeof style === 'object' && !Array.isArray(style)) {
    const sources = (style as {sources?: Record<string, {attribution?: unknown}>}).sources;
    return Object.values(sources ?? {}).flatMap(source =>
      typeof source.attribution === 'string' ? [source.attribution] : []
    );
  }
  if (typeof style === 'string' && style.includes('mapbox')) {
    return ['© Mapbox'];
  }
  if (typeof style === 'string' && style.includes('cartocdn')) {
    return ['© CARTO', '© OpenStreetMap'];
  }
  return [];
}

function createMapboxLoadOptions(accessToken: unknown): Record<string, unknown> | null {
  if (typeof accessToken !== 'string') return null;
  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const response = await fetch(addMapboxAccessTokenToUrl(url, accessToken), init);
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('json')) return response;
      const json = await response.json();
      return new Response(JSON.stringify(rewriteMapboxUrls(json, accessToken)), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
  };
}

function rewriteMapboxUrls(value: unknown, accessToken: string): unknown {
  if (typeof value === 'string') return addMapboxAccessTokenToUrl(value, accessToken);
  if (Array.isArray(value)) return value.map(child => rewriteMapboxUrls(child, accessToken));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, rewriteMapboxUrls(child, accessToken)])
    );
  }
  return value;
}

export function mountPlaygroundExample(container: HTMLElement): () => void {
  let deck: Deck | undefined;
  let selectedBasemap = BASEMAP_STYLES[0].style;
  const playground = new Playground({
    parentElement: container,
    templates: TEMPLATES,
    render: (previewElement, value) => {
      const document = value as {
        initialViewState?: Record<string, unknown>;
        layers?: unknown[];
        views?: unknown;
        mapStyle?: unknown;
        mapboxApiAccessToken?: string;
      };
      deck?.finalize();
      const views = Array.isArray(document.views)
        ? document.views
        : document.views
          ? [document.views]
          : [];
      const mapViewOnly =
        views.length === 0 ||
        views.every(view => (view as Record<string, unknown>)['@@type'] === 'MapView');
      const hasDocumentMapStyle = Object.hasOwn(document, 'mapStyle');
      const mapStyle = hasDocumentMapStyle
        ? resolveBasemapStyle(document.mapStyle, document.mapboxApiAccessToken)
        : selectedBasemap;
      const createLayers = () => [
        ...(mapViewOnly && mapStyle
          ? [
              new BasemapLayer({
                id: 'playground-basemap',
                style: mapStyle,
                loadOptions: createMapboxLoadOptions(document.mapboxApiAccessToken)
              })
            ]
          : []),
        ...(document.layers ?? []).map((layer, index) =>
          createLayer(layer as Record<string, unknown>, index)
        )
      ];
      deck = new Deck({
        parent: previewElement as HTMLDivElement,
        controller: true,
        initialViewState: document.initialViewState,
        ...(views.length
          ? {views: views.map(view => createView(view as Record<string, unknown>)).filter(Boolean)}
          : {}),
        layers: createLayers(),
        getTooltip: ({object}) => (object ? JSON.stringify(object) : null)
      });
      const controls = previewElement.ownerDocument.createElement('div');
      Object.assign(controls.style, {
        position: 'absolute',
        top: '12px',
        right: '12px',
        zIndex: '20',
        display: mapViewOnly ? 'grid' : 'none',
        gap: '4px',
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'rgba(255, 255, 255, 0.94)',
        color: '#172033',
        font: '12px/1.3 system-ui, sans-serif',
        boxShadow: '0 1px 5px rgba(0, 0, 0, 0.24)',
        pointerEvents: 'auto'
      });
      const basemapLabel = previewElement.ownerDocument.createElement('label');
      basemapLabel.textContent = 'Basemap';
      const basemapSelect = previewElement.ownerDocument.createElement('select');
      basemapSelect.setAttribute('aria-label', 'Basemap');
      for (const option of [...BASEMAP_STYLES, {label: 'None', style: ''}]) {
        const element = previewElement.ownerDocument.createElement('option');
        element.textContent = option.label;
        element.value = option.style;
        basemapSelect.append(element);
      }
      basemapSelect.value = selectedBasemap;
      basemapLabel.style.display = mapViewOnly && !hasDocumentMapStyle ? 'block' : 'none';
      basemapSelect.style.display = mapViewOnly && !hasDocumentMapStyle ? 'block' : 'none';
      const attribution = previewElement.ownerDocument.createElement('small');
      const attributionLabels = hasDocumentMapStyle
        ? getBasemapAttribution(document.mapStyle)
        : selectedBasemap
          ? ['© CARTO', '© OpenStreetMap']
          : [];
      attribution.textContent = attributionLabels.join(' · ');
      attribution.style.display = attributionLabels.length && mapViewOnly ? 'block' : 'none';
      controls.append(basemapLabel, basemapSelect, attribution);
      previewElement.append(controls);
      const handleBasemapChange = () => {
        selectedBasemap = basemapSelect.value;
        attribution.textContent = selectedBasemap ? '© CARTO · © OpenStreetMap' : '';
        attribution.style.display = selectedBasemap && mapViewOnly ? 'block' : 'none';
        deck?.setProps({layers: createLayers()});
      };
      basemapSelect.addEventListener('change', handleBasemapChange);
      return () => {
        basemapSelect.removeEventListener('change', handleBasemapChange);
        controls.remove();
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
