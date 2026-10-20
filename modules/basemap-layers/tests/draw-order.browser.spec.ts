// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** Renders layers and returns the first frame drawn after they load. */
function render(layers: unknown[], viewState: Record<string, unknown>) {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new GlobeView({id: 'globe'}) as any,
      initialViewState: viewState as any,
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, SIZE, SIZE));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

/** Whether one channel dominates a pixel: the extrusion's lighting darkens its color. */
function isChannel(image: ImageData, x: number, y: number, channel: 0 | 1 | 2): boolean {
  const color = pixel(image, x, y);
  return color[channel] > 100 && color.every((value, i) => i === channel || value < 60);
}

const RED = 0;
const BLUE = 2;

describe('globe draw order in the browser', () => {
  test('a line after a fill-extrusion layer is hidden behind the buildings', async () => {
    const zoom = 16;
    const layers: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom,
      styleDefinition: {
        version: 8,
        sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
        layers: [
          {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
          {
            id: 'building-3d',
            type: 'fill-extrusion',
            source: 'tiles',
            'source-layer': 'building',
            paint: {'fill-extrusion-color': '#ff0000', 'fill-extrusion-height': 100}
          },
          {
            id: 'boundary',
            type: 'line',
            source: 'tiles',
            'source-layer': 'boundary',
            paint: {'line-color': '#0000ff', 'line-width': 12}
          }
        ]
      } as any
    });
    const background = layers.find(layer => layer.id === 'test-background');
    const tileLayer = layers.find(layer => layer.id === 'test-tiles');
    const feature = (layerName: string, type: string, coordinates: unknown) => ({
      type: 'Feature',
      geometry: {type, coordinates},
      properties: {layerName}
    });
    // A building in the middle of the view, and a line across it and beyond it.
    const subLayers = tileLayer.props
      .renderSubLayers({
        pickable: false,
        visible: true,
        opacity: 1,
        modelMatrix: null,
        coordinateSystem: 'default',
        coordinateOrigin: [0, 0, 0],
        extensions: [],
        highlightedObjectIndex: -1,
        highlightColor: [0, 0, 128, 128],
        wrapLongitude: false,
        parameters: tileLayer.props.parameters,
        id: 'test-tiles-tile',
        data: [
          feature('building', 'Polygon', [
            [
              [-0.00005, -0.00005],
              [0.00005, -0.00005],
              [0.00005, 0.00005],
              [-0.00005, 0.00005],
              [-0.00005, -0.00005]
            ]
          ]),
          feature('boundary', 'LineString', [
            [-0.0012, 0],
            [0.0012, 0]
          ])
        ],
        tile: {index: {x: 0, y: 0, z: zoom}}
      })
      .flat(Infinity);

    const image = await render([background, ...subLayers], {longitude: 0, latitude: 0, zoom});
    const middle = SIZE / 2;
    // The roof hides the line drawn after it.
    expect(isChannel(image, middle, middle, RED), String(pixel(image, middle, middle))).toBe(true);
    // Away from the building, the line still draws over the globe.
    expect(isChannel(image, 4, middle, BLUE), String(pixel(image, 4, middle))).toBe(true);
  });

  test('crossing lines stack by line-sort-key, not by their order in the tile', async () => {
    const zoom = 16;
    const layers: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'globe',
      zoom,
      styleDefinition: {
        version: 8,
        sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
        layers: [
          {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
          {
            id: 'roads',
            type: 'line',
            source: 'tiles',
            'source-layer': 'roads',
            layout: {'line-sort-key': ['get', 'key']},
            paint: {
              'line-color': ['match', ['get', 'color'], 'red', '#ff0000', '#0000ff'],
              'line-width': 12
            }
          }
        ]
      } as any
    });
    const background = layers.find(layer => layer.id === 'test-background');
    const tileLayer = layers.find(layer => layer.id === 'test-tiles');
    const road = (color: string, key: number, coordinates: number[][]) => ({
      type: 'Feature',
      geometry: {type: 'LineString', coordinates},
      properties: {layerName: 'roads', color, key}
    });
    // A red line across the view, then a blue one crossing it, with a lower key.
    const subLayers = tileLayer.props
      .renderSubLayers({
        pickable: false,
        visible: true,
        opacity: 1,
        modelMatrix: null,
        coordinateSystem: 'default',
        coordinateOrigin: [0, 0, 0],
        extensions: [],
        highlightedObjectIndex: -1,
        highlightColor: [0, 0, 128, 128],
        wrapLongitude: false,
        parameters: tileLayer.props.parameters,
        id: 'test-tiles-tile',
        data: [
          road('red', 1, [
            [-0.0012, 0],
            [0.0012, 0]
          ]),
          road('blue', 0, [
            [0, -0.0012],
            [0, 0.0012]
          ])
        ],
        tile: {index: {x: 0, y: 0, z: zoom}}
      })
      .flat(Infinity);

    const image = await render([background, ...subLayers], {longitude: 0, latitude: 0, zoom});
    const middle = SIZE / 2;
    // The red line has the higher key, so it draws over the blue one where they cross.
    expect(isChannel(image, middle, middle, RED), String(pixel(image, middle, middle))).toBe(true);
    expect(isChannel(image, middle, 4, BLUE), String(pixel(image, middle, 4))).toBe(true);
  });
});
