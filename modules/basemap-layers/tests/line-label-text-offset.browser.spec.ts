// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';
import {FIXTURE_ROOT} from './reference-render/fixtures';

maplibregl.setWorkerUrl(maplibreWorkerUrl);

// A street label moved off its street by `text-offset`, on a globe turned to a bearing where the
// label reads along the street and to one where `text-keep-upright` turns it around. MapLibre GL
// JS moves the text along and across the street's own direction, so it stays on the same side of
// the street as it turns around. Which side is measured in the drawn pixels of both renderers.

const SIZE = 300;
/** About 14 degrees north of east, in the middle of the view. */
const TILE = {z: 9, x: 270, y: 241};
const STREET: [number, number][] = [
  [0.3, 0.55],
  [0.7, 0.45]
];
const CENTER: [number, number] = [0.5, 0.5];
const NAME = 'MMMMMM';
/** The street at 54 degrees on screen, reading along it; at 134 degrees, turned around. */
const BEARINGS = [40, 120];

function fromTile([u, v]: [number, number]): [number, number] {
  const scale = 2 ** TILE.z;
  const n = Math.PI - (2 * Math.PI * (TILE.y + v)) / scale;
  return [((TILE.x + u) / scale) * 360 - 180, (Math.atan(Math.sinh(n)) * 180) / Math.PI];
}

const LAYOUT = {
  'text-field': ['get', 'name'],
  'text-font': ['Noto Sans Regular'],
  'text-size': 14,
  'symbol-placement': 'line',
  // Two ems to the left of the street, as it runs.
  'text-offset': [0, -2]
};

const BACKGROUND = {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}};
const PAINT = {'text-color': '#000000'};

let deck: Deck<any> | null = null;
let map: maplibregl.Map | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  map?.remove();
  map = null;
  parent?.remove();
  parent = null;
});

function createParent(): HTMLDivElement {
  parent = document.createElement('div');
  parent.style.cssText = `position: absolute; left: 0; top: 0; width: ${SIZE}px; height: ${SIZE}px`;
  document.body.append(parent);
  return parent;
}

function readCanvas(canvas: HTMLCanvasElement): ImageData {
  const copy = document.createElement('canvas');
  copy.width = SIZE;
  copy.height = SIZE;
  const context = copy.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, SIZE, SIZE);
}

function frames(count: number): Promise<void> {
  return new Promise(resolve => {
    const step = () => (count-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
}

/**
 * Which side of the street the drawn text lies on, as the street runs from its first point to its
 * last on screen: 1 to the left, -1 to the right. `project` takes longitude and latitude to the
 * screen, y down.
 */
function getSide(image: ImageData, project: (lngLat: [number, number]) => number[]): number {
  let count = 0;
  let sx = 0;
  let sy = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4] < 128) {
        count++;
        sx += x;
        sy += y;
      }
    }
  }
  expect(count, 'drawn text').toBeGreaterThan(20);
  const [x0, y0] = project(fromTile(STREET[0]));
  const [x1, y1] = project(fromTile(STREET[1]));
  // With y up, the cross product of the street's direction and the ink is positive to the left.
  const cross = (x1 - x0) * -(sy / count - y0) - -(y1 - y0) * (sx / count - x0);
  return Math.sign(cross);
}

async function renderMapLibre(bearing: number): Promise<number> {
  const [lng, lat] = fromTile(CENTER);
  map = new maplibregl.Map({
    container: createParent(),
    style: {
      version: 8,
      glyphs: `${location.origin}/${FIXTURE_ROOT}/tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf`,
      projection: {type: 'globe'},
      sources: {
        street: {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {name: NAME},
            geometry: {type: 'LineString', coordinates: STREET.map(fromTile)}
          }
        }
      },
      layers: [
        BACKGROUND,
        {id: 'road-label', type: 'symbol', source: 'street', layout: LAYOUT, paint: PAINT}
      ]
    } as any,
    center: [lng, lat],
    zoom: TILE.z,
    bearing,
    pixelRatio: 1,
    fadeDuration: 0,
    interactive: false,
    attributionControl: false,
    canvasContextAttributes: {preserveDrawingBuffer: true}
  });
  await new Promise(resolve => map!.once('idle', resolve));
  const side = getSide(readCanvas(map.getCanvas()), lngLat => {
    const {x, y} = map!.project(lngLat);
    return [x, y];
  });
  map.remove();
  map = null;
  parent?.remove();
  return side;
}

async function renderBasemapLayer(bearing: number): Promise<number> {
  const [longitude, latitude] = fromTile(CENTER);
  let onFrame: ((image: ImageData) => void) | null = null;
  deck = new Deck({
    parent: createParent(),
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new GlobeView({id: 'view'}),
    viewState: {longitude, latitude, zoom: TILE.z, bearing},
    layers: [
      new BasemapLayer({
        id: 'basemap',
        mode: 'globe',
        fetch: async (url: string) => {
          const [z, x, y] = url
            .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
            .slice(1)
            .map(Number);
          return z === TILE.z && x === TILE.x && y === TILE.y
            ? [
                {
                  type: 'Feature',
                  properties: {layerName: 'road', name: NAME},
                  geometry: {type: 'LineString', coordinates: STREET}
                }
              ]
            : [];
        },
        style: {
          version: 8,
          sources: {
            tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}
          },
          layers: [
            BACKGROUND,
            {
              id: 'road-label',
              type: 'symbol',
              source: 'tiles',
              'source-layer': 'road',
              layout: LAYOUT,
              paint: PAINT
            }
          ]
        } as any
      })
    ],
    onAfterRender: () => onFrame?.(readCanvas(deck!.getCanvas()!))
  });
  for (let i = 0; ; i++) {
    await frames(2);
    const layers = (deck as any).layerManager.getLayers() as any[];
    const labels = layers.some(
      layer => !layer.isComposite && layer.id.includes('road-label') && layer.getNumInstances() > 0
    );
    if (layers.length > 1 && layers.every(layer => layer.isLoaded) && labels) {
      break;
    }
    if (i > 300) {
      throw new Error('Timed out loading');
    }
  }
  await frames(10);
  const image = await new Promise<ImageData>(resolve => {
    onFrame = resolve;
    deck!.redraw('read');
  });
  const viewport = (deck as any).getViewports()[0];
  const side = getSide(image, lngLat => viewport.project(lngLat));
  deck.finalize();
  deck = null;
  parent?.remove();
  return side;
}

describe('text-offset of a label along a line on a turned globe', () => {
  test('keeps the text on the side of the line MapLibre GL JS draws it on', async () => {
    const expected: Record<number, number> = {};
    const actual: Record<number, number> = {};
    for (const bearing of BEARINGS) {
      expected[bearing] = await renderMapLibre(bearing);
      actual[bearing] = await renderBasemapLayer(bearing);
    }
    expect(actual).toEqual(expected);
  }, 120_000);
});
