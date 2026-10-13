// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;
const CENTER = SIZE / 2;
const ZOOM = 18;
/** Degrees of longitude per pixel at `ZOOM`; near the equator, also of latitude. */
const DEGREES_PER_PIXEL = 360 / (512 * 2 ** ZOOM);

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** The deck.gl sublayers that one line style layer draws for one tile of features. */
function styleSublayers(
  paint: Record<string, unknown>,
  features: unknown[],
  layout: Record<string, unknown> = {}
) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: ZOOM,
    styleDefinition: {
      version: 8,
      sources: {
        tiles: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
        }
      },
      layers: [
        {
          id: 'path',
          type: 'line',
          source: 'tiles',
          'source-layer': 'land',
          layout,
          paint: {'line-color': '#000000', ...paint}
        }
      ]
    } as any
  });
  const vectorLayer: any = layers.find(layer => layer.id === 'test-tiles');
  // Tile sublayers receive the tile layer's base props, defaults included.
  return vectorLayer.props
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
      id: 'test-tiles-tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: ZOOM}}
    })
    .flat();
}

/** A feature from pixel offsets east (x) and north (y) of the map center. */
function feature(type: string, pixels: number[][] | number[][][]) {
  const toLngLat = (point: any) => point.map((value: number) => value * DEGREES_PER_PIXEL);
  return {
    type: 'Feature',
    geometry: {
      type,
      coordinates:
        type === 'Polygon'
          ? (pixels as number[][][]).map(ring => ring.map(toLngLat))
          : pixels.map(toLngLat)
    },
    properties: {layerName: 'land'}
  };
}

/**
 * Renders layers on a white canvas and returns the first frame drawn after they load, at
 * `pixelRatio` device pixels per CSS pixel.
 */
function render(layers: unknown[], pixelRatio = 1) {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise<ImageData>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 10_000);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: pixelRatio === 1 ? false : pixelRatio,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new MapView({id: 'map'}),
      initialViewState: {longitude: 0, latitude: 0, zoom: ZOOM},
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
        // The drawing buffer takes the device pixel ratio after the first frames.
        if (deck!.getCanvas()!.width !== SIZE * pixelRatio) {
          return;
        }
        // Read the frame back in the render callback, before the drawing buffer is cleared.
        const size = SIZE * pixelRatio;
        const copy = document.createElement('canvas');
        copy.width = size;
        copy.height = size;
        const context = copy.getContext('2d')!;
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, size, size);
        context.drawImage(deck!.getCanvas()!, 0, 0);
        window.clearTimeout(timeout);
        resolve(context.getImageData(0, 0, size, size));
      },
      onError: error => {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
  });
}

const EASTWARD = [
  [-40, 0],
  [40, 0]
];

/**
 * The red channel down the center column, from `first` to `last` pixels below the center, in the
 * image's (device) pixels.
 */
function redColumn(image: ImageData, first: number, last: number): number[] {
  const size = image.width;
  const center = size / 2;
  const values: number[] = [];
  for (let row = center + first; row <= center + last; row++) {
    values.push(image.data[(row * size + center) * 4]);
  }
  return values;
}

/**
 * MapLibre's line alpha at `distance` CSS pixels from the line's center, with one device pixel
 * per CSS pixel: line.vertex.glsl's `outset`/`inset` and line.fragment.glsl's fade.
 */
function maplibreAlpha(distance: number, {width, gap = 0, blur}: Record<string, number>) {
  const antialiasing = 0.5;
  const halfGap = gap / 2;
  const inset = halfGap + (halfGap > 0 ? antialiasing : 0);
  const outset = halfGap + (width / 2) * (halfGap > 0 ? 2 : 1) + antialiasing;
  const blur2 = blur + 1;
  return Math.min(1, Math.max(0, Math.min(distance - (inset - blur2), outset - distance) / blur2));
}

/** Expects black-on-white pixel rows at `first`..`last` below the center to match MapLibre. */
function expectMapLibreFade(
  image: ImageData,
  first: number,
  last: number,
  paint: Record<string, number>,
  center = 0
) {
  const actual = redColumn(image, first, last);
  const expected = actual.map((_, index) => {
    const distance = Math.abs(first + index + 0.5 - center);
    return 255 * (1 - maplibreAlpha(distance, paint));
  });
  actual.forEach((value, index) => {
    expect(Math.abs(value - expected[index]), `row ${first + index}`).toBeLessThanOrEqual(8);
  });
}

describe('line antialiasing in the browser', () => {
  test('a line without line-blur fades its edges over a pixel, as MapLibre', async () => {
    const image = await render(
      styleSublayers({'line-width': 3}, [feature('LineString', EASTWARD)])
    );
    expectMapLibreFade(image, -4, 4, {width: 3, blur: 0});
  });

  test('a line narrower than a pixel draws as faint as in MapLibre', async () => {
    // Centered between two rows of pixels, and on a row.
    for (const [width, north] of [
      [0.25, 0],
      [0.5, 0],
      [0.25, 0.5],
      [0.5, 0.5]
    ]) {
      const path = EASTWARD.map(([x, y]) => [x, y + north]);
      const image = await render(
        styleSublayers({'line-width': width}, [feature('LineString', path)])
      );
      expectMapLibreFade(image, -3, 3, {width, blur: 0}, -north);
      deck?.finalize();
      deck = null;
      parent?.remove();
      parent = null;
    }
  });

  test('a dashed line keeps its dash lengths in line widths', async () => {
    // Dashes of 2 and gaps of 2 line widths, of a 4 pixel line: 16 pixel periods.
    const image = await render(
      styleSublayers({'line-width': 4, 'line-dasharray': [2, 2]}, [feature('LineString', EASTWARD)])
    );
    const size = image.width;
    const row = CENTER;
    const inked = [];
    for (let x = 0; x < size; x++) {
      inked.push(image.data[(row * size + x) * 4] < 128);
    }
    // The starts of dashes along the row.
    const starts = inked.flatMap((value, x) => (value && x > 0 && !inked[x - 1] ? [x] : []));
    const periods = starts.slice(1).map((x, index) => x - starts[index]);
    expect(periods.length).toBeGreaterThan(3);
    for (const period of periods) {
      expect(period).toBe(16);
    }
  });
});

describe('line-blur in the browser', () => {
  test('fades the edge over line-blur plus a pixel of antialiasing', async () => {
    const image = await render(
      styleSublayers({'line-width': 10, 'line-blur': 4}, [feature('LineString', EASTWARD)])
    );
    // Opaque at the center, then a linear fade to the background at half the width plus half a
    // pixel: 0, 51, 102, 153, 204, 255 on red down the rows.
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
  });

  test('a blur wider than the line keeps its middle translucent', async () => {
    // A pixel south, so that the line's middle falls between the two rows of a 2x2 pixel quad,
    // where the derivative of the distance from it is 0.
    const southward = [
      [-40, -1],
      [40, -1]
    ];
    const image = await render(
      styleSublayers({'line-width': 2, 'line-blur': 4}, [feature('LineString', southward)])
    );
    // A fifth of the color at most: MapLibre's fade spans the whole of the line.
    expectMapLibreFade(image, -3, 5, {width: 2, blur: 4}, 1);
  });

  test('fades over line-blur CSS pixels at a device pixel ratio of 2', async () => {
    const image = await render(
      styleSublayers({'line-width': 10, 'line-blur': 4}, [feature('LineString', EASTWARD)]),
      2
    );
    // In device pixels MapLibre's line is twice as wide and blurred, and still antialiased over
    // one device pixel.
    expectMapLibreFade(image, -16, 16, {width: 20, blur: 8});
  });

  test('keeps an overlapping offset gap undarkened at a device pixel ratio of 2', async () => {
    const paint = {
      'line-width': 4,
      'line-gap-width': 2,
      'line-blur': 4,
      'line-offset': 20
    };
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]), 2);
    expectMapLibreFade(image, 24, 56, {width: 8, gap: 4, blur: 8}, 40);
  });

  test('fades a round cap with the distance from the end of the line', async () => {
    const image = await render(
      styleSublayers({'line-width': 10, 'line-blur': 4}, [feature('LineString', EASTWARD)], {
        'line-cap': 'round'
      })
    );
    // Along the row half a pixel below the line, past its end 40 pixels east of the center.
    const row = CENTER;
    for (let column = CENTER + 34; column <= CENTER + 48; column++) {
      const along = column + 0.5 - (CENTER + 40);
      const distance = along > 0 ? Math.hypot(along, 0.5) : 0.5;
      const expected = 255 * (1 - maplibreAlpha(distance, {width: 10, blur: 4}));
      const actual = image.data[(row * SIZE + column) * 4];
      expect(Math.abs(actual - expected), `column ${column - CENTER}`).toBeLessThanOrEqual(8);
    }
  });

  test('fades a diagonal line over line-blur across it', async () => {
    const northEastward = [
      [-40, -40],
      [40, 40]
    ];
    const image = await render(
      styleSublayers({'line-width': 10, 'line-blur': 4}, [feature('LineString', northEastward)])
    );
    // Down the center column, the line runs up and to the right through the center: a pixel's
    // distance from it is the distance along the column divided by the square root of 2.
    const actual = redColumn(image, -12, 12);
    actual.forEach((value, index) => {
      const distance = Math.abs(-12 + index + 0.5 + 0.5) / Math.SQRT2;
      const expected = 255 * (1 - maplibreAlpha(distance, {width: 10, blur: 4}));
      expect(Math.abs(value - expected), `row ${-12 + index}`).toBeLessThanOrEqual(8);
    });
  });

  test('without line-blur the line stays sharp', async () => {
    const image = await render(
      styleSublayers({'line-width': 10}, [feature('LineString', EASTWARD)])
    );
    expect(redColumn(image, 0, 6)).toEqual([0, 0, 0, 0, 0, 255, 255]);
  });

  test('a data-driven line-blur is per feature', async () => {
    const line = feature('LineString', EASTWARD);
    const image = await render(
      styleSublayers({'line-width': 10, 'line-blur': ['get', 'blur']}, [
        {...line, properties: {...line.properties, blur: 4}}
      ])
    );
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
  });

  test('fades both lines of a gap as MapLibre does, the inner edges into the gap', async () => {
    const paint = {'line-width': 4, 'line-gap-width': 8, 'line-blur': 2};
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -10, 10, {width: 4, gap: 8, blur: 2});
  });

  test('does not darken the gap where a blur wider than half the gap overlaps its lines', async () => {
    // The inner fades reach 4 pixels into a gap of 2, so each line's covers the other's side.
    const paint = {'line-width': 4, 'line-gap-width': 2, 'line-blur': 4};
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -8, 8, {width: 4, gap: 2, blur: 4});
  });

  test('keeps an overlapping gap undarkened when offset', async () => {
    const paint = {
      'line-width': 4,
      'line-gap-width': 2,
      'line-blur': 4,
      'line-offset': 20
    };
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, 12, 28, {width: 4, gap: 2, blur: 4}, 20);
  });

  test('does not draw a gap twice where line-blur is line-width plus line-gap-width', async () => {
    // Each line is drawn 4 + 6 pixels wide, which would center both on the gap's center.
    const paint = {'line-width': 4, 'line-gap-width': 2, 'line-blur': 6};
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -8, 8, {width: 4, gap: 2, blur: 6});
  });

  test('does not draw a per-feature gap twice where line-blur is line-width plus line-gap-width', async () => {
    const paint = {
      'line-width': ['get', 'width'],
      'line-gap-width': ['get', 'gap'],
      'line-blur': ['get', 'blur']
    };
    const line = feature('LineString', EASTWARD);
    const image = await render(
      styleSublayers(paint, [
        {...line, properties: {...line.properties, width: 4, gap: 2, blur: 6}}
      ])
    );
    expectMapLibreFade(image, -8, 8, {width: 4, gap: 2, blur: 6});
  });

  test('draws a line whose line-gap-width is 0 whole', async () => {
    const paint = {'line-width': 10, 'line-gap-width': 0, 'line-blur': 4};
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
  });

  test('draws a line whole at a zoom where its line-gap-width is 0', async () => {
    const paint = {
      'line-width': 10,
      'line-gap-width': ['step', ['zoom'], 0, ZOOM + 1, 8],
      'line-blur': 4
    };
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
  });

  test('draws features whose per-feature line-gap-width is 0 whole, beside gapped ones', async () => {
    const paint = {'line-width': 10, 'line-gap-width': ['get', 'gap'], 'line-blur': 4};
    const line = feature('LineString', EASTWARD);
    // The gapped line 40 pixels north, which is up the rows.
    const north = feature('LineString', [
      [-40, 40],
      [40, 40]
    ]);
    const image = await render(
      styleSublayers(paint, [
        {...line, properties: {...line.properties, gap: 0}},
        {...north, properties: {...north.properties, gap: 8}}
      ])
    );
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
    expectMapLibreFade(image, -58, -22, {width: 10, gap: 8, blur: 4}, -40);
  });

  test('moves the fade with line-offset', async () => {
    const paint = {'line-width': 10, 'line-offset': 20, 'line-blur': 4};
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, 12, 28, {width: 10, blur: 4}, 20);
  });

  test('fades the edges of dashes', async () => {
    const paint = {
      'line-width': 10,
      'line-blur': 4,
      'line-dasharray': [100, 1]
    };
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    expectMapLibreFade(image, -8, 8, {width: 10, blur: 4});
  });

  test('keeps the dash lengths of a blurred gap in line-widths', async () => {
    // MapLibre dashes 2 and 1 line-widths of 4: 8 pixels on, 4 off, from the start of the line.
    const paint = {
      'line-width': 4,
      'line-gap-width': 8,
      'line-blur': 2,
      'line-dasharray': [2, 1]
    };
    const image = await render(styleSublayers(paint, [feature('LineString', EASTWARD)]));
    // Both lines, along the row where each is opaque: 5.5 pixels from the gap's center.
    for (const row of [CENTER - 6, CENTER + 5]) {
      const dashStarts: number[] = [];
      for (let x = CENTER - 38; x < CENTER + 38; x++) {
        const isDash = (column: number) => image.data[(row * SIZE + column) * 4] < 128;
        if (isDash(x) && !isDash(x - 1)) {
          dashStarts.push(x - (CENTER - 40));
        }
      }
      expect(dashStarts, `row ${row}`).toEqual([12, 24, 36, 48, 60, 72]);
    }
  });
});
