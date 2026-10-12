// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';

// A tile that is hidden while the style changes, then shown again, draws as a fresh basemap draws
// the same view: its kept sublayers are not drawn once it is shown.

const SIZE = 256;

type ViewState = {longitude: number; latitude: number; zoom: number};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;
let onFrame: ((image: ImageData) => void) | null = null;

function cleanup() {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
  onFrame = null;
}

afterEach(cleanup);

/** Each tile holds a square and four labelled points, in tile-local coordinates. */
const fetchTile = async (url: string) => {
  const [z, x, y] = url
    .match(/(\d+)\/(\d+)\/(\d+)\.mvt/)!
    .slice(1)
    .map(Number);
  return [
    {
      type: 'Feature',
      properties: {layerName: 'area'},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.9, 0.9],
            [0.1, 0.9],
            [0.1, 0.1]
          ]
        ]
      }
    },
    // A label near each corner, so that the tiles around the view center label it.
    ...[
      [0.15, 0.15],
      [0.85, 0.15],
      [0.15, 0.85],
      [0.85, 0.85]
    ].map(coordinates => ({
      type: 'Feature',
      properties: {layerName: 'place', name: `T${z}${x}${y}`},
      geometry: {type: 'Point', coordinates}
    }))
  ];
};

/** A style whose fill color and label size change at the 4.25 style zoom step. */
function style(fillColor: unknown) {
  return {
    version: 8,
    sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
    layers: [
      {id: 'background', type: 'background', paint: {'background-color': '#ffffff'}},
      {
        id: 'area',
        type: 'fill',
        source: 'tiles',
        'source-layer': 'area',
        paint: {'fill-color': fillColor}
      },
      {
        id: 'place',
        type: 'symbol',
        source: 'tiles',
        'source-layer': 'place',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 4, 12, 5, 24]
        },
        paint: {'text-color': '#000000'}
      }
    ]
  } as any;
}

const ZOOM_COLOR = ['step', ['zoom'], '#ff0000', 4.25, '#0000ff'];

function basemap(styleDefinition: unknown) {
  return new BasemapLayer({id: 'basemap', mode: 'map', fetch: fetchTile, style: styleDefinition});
}

/**
 * Resolves with the frame drawn once every sublayer has loaded and the frame has stopped changing:
 * a style resolves, and fonts load, over several frames.
 */
function nextFrame(): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    let previous: ImageData | null = null;
    let same = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    onFrame = image => {
      same = previous && countDifferent(previous, image) === 0 ? same + 1 : 0;
      previous = image;
      if (same < 10) {
        // `redraw` draws at once, so wait for the browser's next frame first.
        window.setTimeout(() => window.requestAnimationFrame(() => deck?.redraw('settle')), 20);
        return;
      }
      onFrame = null;
      window.clearTimeout(timeout);
      resolve(image);
    };
    window.requestAnimationFrame(() => deck?.redraw('frame'));
  });
}

function createDeck(layer: unknown, viewState: ViewState): Promise<ImageData> {
  parent = document.createElement('div');
  document.body.append(parent);
  const frame = nextFrame();
  deck = new Deck({
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    deviceProps: {adapters: [webgl2Adapter]},
    views: new MapView({id: 'map'}),
    viewState: viewState as any,
    layers: [layer as any],
    onAfterRender: () => {
      const layers = (deck as any)?.layerManager?.getLayers() || [];
      // A basemap draws no sublayers until its style resolves.
      if (!onFrame || layers.length < 2 || layers.some((l: any) => !l.isLoaded)) {
        return;
      }
      const copy = document.createElement('canvas');
      copy.width = SIZE;
      copy.height = SIZE;
      const context = copy.getContext('2d')!;
      context.drawImage(deck!.getCanvas()!, 0, 0);
      onFrame(context.getImageData(0, 0, SIZE, SIZE));
    },
    onError: error => {
      throw error;
    }
  });
  return frame;
}

function setProps(props: Record<string, unknown>): Promise<ImageData> {
  const frame = nextFrame();
  deck!.setProps(props);
  return frame;
}

/** The number of pixels whose channels differ by more than 8. */
function countDifferent(a: ImageData, b: ImageData): number {
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (
      Math.abs(a.data[i] - b.data[i]) > 8 ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > 8 ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > 8
    ) {
      count++;
    }
  }
  return count;
}

/** The number of pixels that are mostly red, mostly blue, and dark (label text). */
function countColors(image: ImageData) {
  let red = 0;
  let blue = 0;
  let dark = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    const [r, g, b] = [image.data[i], image.data[i + 1], image.data[i + 2]];
    if (r > b + 60 && r > g + 60) red++;
    if (b > r + 60 && b > g + 60) blue++;
    if (r < 60 && g < 60 && b < 60) dark++;
  }
  return {red, blue, dark};
}

const HERE = {longitude: 0, latitude: 0};
// Far enough that none of the tiles of HERE is shown, near enough that they stay in the tileset.
const AWAY = {longitude: 90, latitude: 0};

describe('a hidden tile shown again after a style change', () => {
  test.each([
    ['a style zoom step', ZOOM_COLOR, 4.05, ZOOM_COLOR, 4.3],
    ['a new style', '#ff0000', 4.05, '#0000ff', 4.05]
  ])(
    'after %s, draws as a fresh basemap of the same view, with its labels',
    async (_, before, zoomBefore, after, zoomAfter) => {
      const first = basemap(style(before));
      const initial = await createDeck(first, {...HERE, zoom: zoomBefore});
      // Hide the tiles, change the style while they are hidden, then show them again.
      await setProps({viewState: {...AWAY, zoom: zoomBefore}});
      const changed = after === before ? first : basemap(style(after));
      await setProps({viewState: {...AWAY, zoom: zoomAfter}, layers: [changed]});
      const shown = await setProps({viewState: {...HERE, zoom: zoomAfter}});
      cleanup();
      const expected = await createDeck(basemap(style(after)), {...HERE, zoom: zoomAfter});

      const colors = countColors(expected);
      // The fill turned from red to blue; the labels draw.
      expect(countColors(initial).red).toBeGreaterThan(1000);
      expect(colors.red).toBe(0);
      expect(colors.blue).toBeGreaterThan(1000);
      expect(colors.dark).toBeGreaterThan(20);
      expect(countDifferent(shown, expected)).toBe(0);
    },
    60_000
  );
});
