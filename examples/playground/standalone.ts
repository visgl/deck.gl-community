// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {ArcLayer, GeoJsonLayer, ScatterplotLayer} from '@deck.gl/layers';
import {HeatmapLayer} from '@deck.gl/aggregation-layers';
import {
  ArcLayerSchema,
  DeckPlayground,
  GeoJsonLayerSchema,
  HeatmapLayerSchema,
  PlaygroundDataSourceManager,
  ScatterplotLayerSchema
} from '@deck.gl-community/playground';
import scatterplot from './examples/01-scatterplot.json';
import arcs from './examples/02-arc-network.json';
import geojson from './examples/03-geojson.json';
import heatmap from './examples/04-heatmap.json';

const TEMPLATES = {
  'imported-points': {
    metadata: {
      title: 'Imported points',
      description: 'Replace the points source with JSON or Arrow rows containing position: [x, y].'
    },
    views: {'@@type': 'OrthographicView', id: 'plot'},
    initialViewState: {target: [0, 0, 0], zoom: 1},
    layers: [
      {
        '@@type': 'ScatterplotLayer',
        id: 'points',
        data: {'@@data': 'points'},
        getPosition: '@@=position',
        getRadius: 8,
        radiusUnits: 'pixels',
        getFillColor: [40, 120, 220],
        pickable: true
      }
    ]
  },
  scatterplot,
  arcs,
  geojson,
  heatmap
};

/** Mounts a page-owned editor, preview and browser tools with one shared source. */
export function mountStandalonePlayground(
  container: HTMLElement,
  {enableTools = true}: {enableTools?: boolean} = {}
): () => void {
  const root = container.ownerDocument.createElement('div');
  root.style.cssText = 'display:flex;flex-direction:column;width:100%;height:100%';
  root.innerHTML = `
    <header style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 12px;border-bottom:1px solid #d5dbe3;font:13px system-ui">
      <strong style="margin-right:auto">deck.gl Playground</strong>
      <output aria-live="polite">Browser tools disabled</output>
      <button type="button">Enable tools</button>
    </header>
    <div style="padding:4px 12px;font:12px system-ui">The points source accepts rows with position: [x, y]. Imported rows stay in this page until it closes or reloads.</div>
    <output data-error role="status" hidden style="padding:4px 12px;color:#b42318;font:12px system-ui"></output>
    <div data-preview style="position:relative;flex:1;min-height:0"></div>
  `;
  container.append(root);
  const status = root.querySelector('output')!;
  const errorStatus = root.querySelector<HTMLOutputElement>('[data-error]')!;
  const toggle = root.querySelector('button')!;
  const sources = new PlaygroundDataSourceManager();
  sources.add({
    dataSourceId: 'points',
    dataSource: {
      data: [
        {position: [-40, -20], label: 'West'},
        {position: [0, 20], label: 'Center'},
        {position: [40, -20], label: 'East'}
      ]
    }
  });
  const playground = new DeckPlayground({
    parentElement: root.querySelector<HTMLElement>('[data-preview]')!,
    templates: TEMPLATES,
    registry: {
      layers: {
        ArcLayer: {type: ArcLayer, schema: ArcLayerSchema},
        GeoJsonLayer: {type: GeoJsonLayer, schema: GeoJsonLayerSchema},
        HeatmapLayer: {type: HeatmapLayer, schema: HeatmapLayerSchema},
        ScatterplotLayer: {type: ScatterplotLayer, schema: ScatterplotLayerSchema}
      }
    },
    dataSources: sources,
    onChange() {
      errorStatus.hidden = true;
    },
    onError(error) {
      errorStatus.textContent = error.message.slice(0, 300);
      errorStatus.hidden = false;
    }
  });
  let active = true;
  let unregister: (() => void) | null = null;
  toggle.onclick = async () => {
    if (unregister) {
      unregister();
      unregister = null;
      status.textContent = 'Browser tools disabled';
      toggle.textContent = 'Enable tools';
      return;
    }
    toggle.disabled = true;
    status.textContent = 'Connecting browser tools…';
    try {
      unregister = await playground.registerWebMCP({
        templates: Object.keys(TEMPLATES),
        dataSources: {manager: sources, read: ['points'], write: ['points']}
      });
      if (!active) {
        unregister?.();
        return;
      }
      status.textContent = unregister ? 'Browser tools ready' : 'Browser tools unavailable';
      toggle.textContent = unregister ? 'Disable tools' : 'Enable tools';
      toggle.disabled = !unregister;
    } catch {
      if (!active) return;
      status.textContent = 'Browser tools could not connect';
      toggle.textContent = 'Retry tools';
      toggle.disabled = false;
    }
  };
  if (enableTools) toggle.click();

  return () => {
    active = false;
    playground.finalize();
    void sources.finalize();
    root.remove();
  };
}
