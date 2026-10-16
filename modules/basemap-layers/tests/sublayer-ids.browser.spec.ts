// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

const FEATURES = [
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [-10, -10],
        [10, 10]
      ]
    },
    properties: {kind: 'a', name: 'n', height: 10}
  },
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [10, -10],
        [-10, 10]
      ]
    },
    properties: {kind: 'b', name: 'n', height: 10}
  },
  {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {name: 'n'}},
  {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-5, -5],
          [5, -5],
          [5, 5],
          [-5, -5]
        ]
      ]
    },
    properties: {height: 10}
  }
];

const line = (id: string, paint: Record<string, unknown> = {}) => ({
  id,
  type: 'line',
  source: 'tiles',
  paint
});

const STYLE_LAYERS = [
  {
    ...line('road', {'line-gap-width': 4}),
    layout: {'line-cap': ['match', ['get', 'kind'], 'a', 'round', 'butt']}
  },
  line('road-true-false-1-gap'),
  line('road-true-false-1-linestrings'),
  line('rail', {'line-gap-width': 4}),
  line('rail-gap'),
  line('rail-gap-linestrings'),
  {id: 'place', type: 'symbol', source: 'tiles', layout: {'text-field': '{name}'}},
  line('place-text'),
  line('place-geojson'),
  {
    id: 'building',
    type: 'fill-extrusion',
    source: 'tiles',
    paint: {'fill-extrusion-height': ['get', 'height']}
  },
  line('building-polygons-fill')
];

/** Draws one tile's style sublayers, without loading tiles. */
class TileSublayers extends CompositeLayer<{data: any[]}> {
  static layerName = 'TileSublayers';

  renderLayers() {
    // A layer after a label layer starts another tile layer of the source (see
    // `getStyleLayerRuns`); each tile layer names its tiles' sublayers after its own id.
    const vectorLayers: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 12,
      styleDefinition: {
        version: 8,
        sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
        layers: STYLE_LAYERS
      } as any
    }).filter(layer => layer.id.startsWith('test-tiles'));
    return vectorLayers.flatMap(vectorLayer =>
      vectorLayer.props
        .renderSubLayers({
          ...this.getSubLayerProps({id: `${vectorLayer.id}-tile`}),
          data: this.props.data,
          tile: {index: {x: 0, y: 0, z: 12}}
        })
        .flat(2)
    );
  }
}

/** The ids of every layer deck.gl draws, composite sublayers included, once all have loaded. */
function renderLayerIds(): Promise<string[]> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: 64,
      height: 64,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'sublayer-ids-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [new TileSublayers({id: 'tiles', data: FEATURES})],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        if (!layers.length || layers.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        window.clearTimeout(timeout);
        resolve(layers.map((layer: any) => layer.id));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

describe('tile sublayer ids in the browser', () => {
  test("no layer deck.gl draws shares an id, whatever the style layers' ids", async () => {
    const ids = await renderLayerIds();
    // Labels, lines with a gap and line shape groups, extrusions and their deck.gl sublayers.
    expect(ids.some(id => id.endsWith('-text-characters'))).toBe(true);
    expect(ids.some(id => id.endsWith('-gap-linestrings'))).toBe(true);
    expect(ids.some(id => id.endsWith('-polygons-fill'))).toBe(true);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});
