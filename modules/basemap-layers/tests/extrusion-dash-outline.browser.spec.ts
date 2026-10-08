// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, OrthographicView} from '@deck.gl/core';
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

/** The deck.gl sublayer that one style layer draws for one tile of features. */
function styleSublayer(styleLayer: Record<string, unknown>, features: unknown[], zoom = 15) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [{source: 'tiles', 'source-layer': 'land', ...styleLayer}]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  // Tile sublayers receive the tile layer's base props, defaults included.
  const [sublayer] = vectorLayer.props.renderSubLayers({
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
    id: 'test-tiles-tile',
    data: features,
    tile: {index: {x: 0, y: 0, z: zoom}}
  });
  return sublayer;
}

function feature(type: string, coordinates: unknown, properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {type, coordinates},
    properties: {layerName: 'land', ...properties}
  };
}

/** Renders layers on a white canvas and returns the first frame drawn after they load. */
function render(layers: unknown[], view: unknown, viewState: Record<string, unknown>) {
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
      views: view as any,
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
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, SIZE, SIZE);
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

function renderFlat(layers: unknown[]) {
  return render(layers, new OrthographicView({id: 'flat'}), {target: [0, 0, 0], zoom: 0});
}

function pixel(image: ImageData, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

/** Whether a pixel is drawn, i.e. darker than the white background. */
function isInked(image: ImageData, x: number, y: number): boolean {
  const [r, g, b] = pixel(image, x, y);
  return r + g + b < 600;
}

function inkedCount(image: ImageData): number {
  let count = 0;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      count += isInked(image, x, y) ? 1 : 0;
    }
  }
  return count;
}

describe('line-dasharray in the browser', () => {
  /** The x of every dash start along the middle row. */
  function dashStarts(image: ImageData): number[] {
    const starts: number[] = [];
    for (let x = 1; x < SIZE; x++) {
      if (isInked(image, x, SIZE / 2) && !isInked(image, x - 1, SIZE / 2)) {
        starts.push(x);
      }
    }
    return starts;
  }

  const LINE = feature('LineString', [
    [-60, 0],
    [0, 0],
    [60, 0]
  ]);

  test('draws dashes with gaps, one period every (dash + gap) line widths', async () => {
    const image = await renderFlat([
      styleSublayer(
        {
          id: 'path',
          type: 'line',
          paint: {'line-color': '#000000', 'line-width': 4, 'line-dasharray': [2, 2]}
        },
        [LINE]
      )
    ]);

    const starts = dashStarts(image);
    expect(starts.length).toBeGreaterThan(4);
    // (2 + 2) line widths of 4 pixels: a 16 pixel period, continuous across the middle vertex.
    const periods = starts.slice(1).map((start, index) => start - starts[index]);
    for (const period of periods) {
      expect(period).toBeGreaterThanOrEqual(15);
      expect(period).toBeLessThanOrEqual(17);
    }
  });

  test('draws an undashed line solid', async () => {
    const image = await renderFlat([
      styleSublayer({id: 'path', type: 'line', paint: {'line-color': '#000000', 'line-width': 4}}, [
        LINE
      ])
    ]);
    expect(dashStarts(image).length).toBe(1);
  });
});

describe('fill-outline-color in the browser', () => {
  const SQUARE = feature('Polygon', [
    [
      [-30, -30],
      [30, -30],
      [30, 30],
      [-30, 30],
      [-30, -30]
    ]
  ]);

  /** Whether any pixel of the middle row near the square's right edge is blue. */
  function hasBlueEdge(image: ImageData): boolean {
    for (let x = SIZE / 2 + 26; x < SIZE / 2 + 34; x++) {
      // The 1 pixel outline can straddle two pixels, each partly blended with the red fill.
      const [r, , b] = pixel(image, x, SIZE / 2);
      if (b - r > 64) {
        return true;
      }
    }
    return false;
  }

  test('draws the outline in fill-outline-color at the polygon edge', async () => {
    const image = await renderFlat([
      styleSublayer(
        {
          id: 'land',
          type: 'fill',
          paint: {'fill-color': '#ff0000', 'fill-outline-color': '#0000ff'}
        },
        [SQUARE]
      )
    ]);
    expect(pixel(image, SIZE / 2, SIZE / 2)).toEqual([255, 0, 0]);
    expect(hasBlueEdge(image)).toBe(true);
  });

  test('draws no outline without fill-outline-color', async () => {
    const image = await renderFlat([
      styleSublayer({id: 'land', type: 'fill', paint: {'fill-color': '#ff0000'}}, [SQUARE])
    ]);
    expect(pixel(image, SIZE / 2, SIZE / 2)).toEqual([255, 0, 0]);
    expect(hasBlueEdge(image)).toBe(false);
  });
});

describe('fill-extrusion in the browser', () => {
  // About 45 by 45 meters at the equator.
  const D = 0.0002;
  const BUILDING = (properties: Record<string, unknown>) =>
    feature(
      'Polygon',
      [
        [
          [-D, -D],
          [D, -D],
          [D, D],
          [-D, D],
          [-D, -D]
        ]
      ],
      properties
    );

  function renderBuilding(properties: Record<string, unknown>, pitch: number) {
    const sublayer = styleSublayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {
          'fill-extrusion-color': '#3050c0',
          'fill-extrusion-height': ['get', 'h'],
          'fill-extrusion-base': ['get', 'b']
        }
      },
      [BUILDING(properties)]
    );
    return render([sublayer], new MapView({id: 'map'}), {
      longitude: 0,
      latitude: 0,
      zoom: 16,
      pitch,
      bearing: 0
    });
  }

  /** The topmost inked row: the higher a building reaches on screen, the smaller. */
  function topRow(image: ImageData): number {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (isInked(image, x, y)) {
          return y;
        }
      }
    }
    return SIZE;
  }

  test('draws the roof in a flat view', async () => {
    const image = await renderBuilding({h: 20, b: 0}, 0);
    expect(isInked(image, SIZE / 2, SIZE / 2)).toBe(true);
    expect(inkedCount(image)).toBeGreaterThan(400);
  });

  test('raises the building to its height under pitch', async () => {
    const low = await renderBuilding({h: 1, b: 0}, 60);
    deck?.finalize();
    parent?.remove();
    const tall = await renderBuilding({h: 30, b: 0}, 60);
    // The tall building's walls rise above the footprint on screen.
    expect(topRow(tall)).toBeLessThan(topRow(low) - 10);
    expect(inkedCount(tall)).toBeGreaterThan(inkedCount(low) * 1.5);
  });

  test('starts the walls at fill-extrusion-base', async () => {
    const grounded = await renderBuilding({h: 30, b: 0}, 60);
    deck?.finalize();
    parent?.remove();
    const floating = await renderBuilding({h: 30, b: 20}, 60);
    // Same roof, shorter walls: the same top, fewer pixels.
    expect(Math.abs(topRow(floating) - topRow(grounded))).toBeLessThanOrEqual(2);
    expect(inkedCount(floating)).toBeLessThan(inkedCount(grounded) * 0.8);
  });
});

describe('extrusions and flat layers from later tiles', () => {
  test('a flat fill drawn after a building does not paint over it', async () => {
    const D = 0.0002;
    const square = (d: number) => [
      [
        [-d, -d],
        [d, -d],
        [d, d],
        [-d, d],
        [-d, -d]
      ]
    ];
    const building = styleSublayer(
      {
        id: 'building-3d',
        type: 'fill-extrusion',
        paint: {'fill-extrusion-color': '#3050c0', 'fill-extrusion-height': 30}
      },
      [feature('Polygon', square(D))]
    );
    // A later tile's ground layer, covering the whole view.
    const ground = styleSublayer({id: 'ground', type: 'fill', paint: {'fill-color': '#ff0000'}}, [
      feature('Polygon', square(0.01))
    ]).clone({id: 'later-tile-ground'});
    const image = await render([building, ground], new MapView({id: 'map'}), {
      longitude: 0,
      latitude: 0,
      zoom: 16,
      pitch: 60,
      bearing: 0
    });
    let blue = 0;
    let red = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const [r, g, b] = pixel(image, x, y);
        blue += b > r ? 1 : 0;
        red += r > 200 && g < 50 && b < 50 ? 1 : 0;
      }
    }
    // The building stays in front, and the ground still draws around it.
    expect(blue).toBeGreaterThan(400);
    expect(red).toBeGreaterThan(SIZE * SIZE * 0.5);
  });
});
