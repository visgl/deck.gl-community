// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {getBasemapLayers} from '../src/index';

const SIZE = 128;
/** The color of the test image. */
const COLOR = [200, 80, 40];

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** A canvas filled with one color per column. */
function createImage(columns: number[][]): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = columns.length;
  canvas.height = 1;
  const context = canvas.getContext('2d')!;
  columns.forEach(([r, g, b], x) => {
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.fillRect(x, 0, 1, 1);
  });
  return canvas;
}

/** The bitmap layer that a raster style layer draws for one tile covering the whole canvas. */
function rasterTile(paint: Record<string, unknown>, image: HTMLCanvasElement) {
  const layers = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 5,
    styleDefinition: {
      version: 8,
      sources: {raster: {type: 'raster', tiles: ['https://tiles.example.com/{z}/{x}/{y}.png']}},
      layers: [{id: 'imagery', type: 'raster', source: 'raster', paint}]
    } as any
  });
  const rasterLayer: any = layers.find(layer => layer.id === 'test-imagery');
  const half = SIZE / 2;
  // As in `TileLayer.renderLayers`, the tile receives the layer's props and its sublayer props.
  rasterLayer.context = {device: {type: 'webgl'}};
  return rasterLayer.props.renderSubLayers({
    ...rasterLayer.props,
    ...rasterLayer.getSubLayerProps({id: 'tile'}),
    id: 'test-imagery-tile',
    data: image,
    tile: {index: {x: 0, y: 0, z: 5}, bbox: {west: -half, south: -half, east: half, north: half}}
  });
}

/** Renders layers on a white canvas and returns the first frame drawn after they load. */
function render(layers: unknown[]) {
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
      views: new OrthographicView({id: 'flat'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: layers as any,
      onAfterRender: () => {
        const loaded = (deck as any)?.layerManager?.getLayers() || [];
        if (!loaded.length || loaded.some((layer: any) => !layer.isLoaded)) {
          return;
        }
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

function pixel(image: ImageData, x: number, y: number): number[] {
  const i = (y * SIZE + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

type Paint = {
  opacity?: number;
  brightnessMin?: number;
  brightnessMax?: number;
  saturation?: number;
  contrast?: number;
  hueRotate?: number;
};

/**
 * An independent port of MapLibre GL JS's raster program and fragment shader: the color it draws
 * for an opaque texel of `color` (0-255), composited on a gray `background` (0-255).
 */
function referenceColor(color: number[], paint: Paint, background = 255): number[] {
  const {opacity = 1, brightnessMin = 0, brightnessMax = 1} = paint;
  const {saturation = 0, contrast = 0, hueRotate = 0} = paint;
  const angle = (hueRotate * Math.PI) / 180;
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const w = [(2 * c + 1) / 3, (-Math.sqrt(3) * s - c + 1) / 3, (Math.sqrt(3) * s - c + 1) / 3];
  const saturationFactor = saturation > 0 ? 1 - 1 / (1.001 - saturation) : -saturation;
  const contrastFactor = contrast > 0 ? 1 / (1 - contrast) : 1 + contrast;

  const [r, g, b] = color.map(value => value / 255);
  const dot = (x: number, y: number, z: number) => r * x + g * y + b * z;
  let rgb = [dot(w[0], w[1], w[2]), dot(w[2], w[0], w[1]), dot(w[1], w[2], w[0])];
  const average = (r + g + b) / 3;
  rgb = rgb.map(value => value + (average - value) * saturationFactor);
  rgb = rgb.map(value => (value - 0.5) * contrastFactor + 0.5);
  rgb = rgb.map(value => brightnessMin + (brightnessMax - brightnessMin) * value);
  // Premultiplied output, clamped by the framebuffer, then blended over the background.
  return rgb.map(
    value => Math.min(Math.max(value * opacity, 0), 1) * 255 + background * (1 - opacity)
  );
}

function expectColor(actual: number[], expected: number[]) {
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(2);
  }
}

describe('raster paint in the browser', () => {
  const center = (image: ImageData) => pixel(image, SIZE / 2, SIZE / 2);

  test('draws the image unchanged by default', async () => {
    const image = await render([rasterTile({}, createImage([COLOR]))]);
    expectColor(center(image), COLOR);
  });

  test('raster-opacity blends the image with what is below', async () => {
    const image = await render([rasterTile({'raster-opacity': 0.5}, createImage([COLOR]))]);
    expectColor(center(image), referenceColor(COLOR, {opacity: 0.5}));
  });

  test('raster-saturation -1 draws gray', async () => {
    const image = await render([rasterTile({'raster-saturation': -1}, createImage([COLOR]))]);
    const gray = (COLOR[0] + COLOR[1] + COLOR[2]) / 3;
    expectColor(center(image), [gray, gray, gray]);
  });

  test('raster-hue-rotate 120 turns red to green, green to blue and blue to red', async () => {
    const image = await render([rasterTile({'raster-hue-rotate': 120}, createImage([COLOR]))]);
    expectColor(center(image), [COLOR[2], COLOR[0], COLOR[1]]);
  });

  test.each<[string, Paint]>([
    ['brightness', {brightnessMin: 0.2, brightnessMax: 0.6}],
    ['positive saturation', {saturation: 0.6}],
    ['negative saturation', {saturation: -0.4}],
    ['positive contrast', {contrast: 0.5}],
    ['negative contrast', {contrast: -0.5}],
    ['hue rotation', {hueRotate: 47}],
    [
      'all adjustments with opacity',
      {
        opacity: 0.6,
        brightnessMin: 0.1,
        brightnessMax: 0.9,
        saturation: 0.3,
        contrast: 0.4,
        hueRotate: -70
      }
    ]
  ])('matches MapLibre for %s', async (_, paint) => {
    const style: Record<string, number> = {};
    const names: Record<keyof Paint, string> = {
      opacity: 'raster-opacity',
      brightnessMin: 'raster-brightness-min',
      brightnessMax: 'raster-brightness-max',
      saturation: 'raster-saturation',
      contrast: 'raster-contrast',
      hueRotate: 'raster-hue-rotate'
    };
    for (const [key, value] of Object.entries(paint)) {
      style[names[key as keyof Paint]] = value;
    }
    const image = await render([rasterTile(style, createImage([COLOR]))]);
    expectColor(center(image), referenceColor(COLOR, paint));
  });

  test('clamps an adjusted color after applying the opacity, as MapLibre does', async () => {
    const half = SIZE / 2;
    const black = new SolidPolygonLayer({
      id: 'black',
      data: [
        [
          [-half, -half],
          [half, -half],
          [half, half],
          [-half, half]
        ]
      ],
      getPolygon: (d: any) => d,
      getFillColor: [0, 0, 0]
    });
    // Contrast pushes red past 1; at half opacity MapLibre still draws it nearly at full red.
    const paint = {opacity: 0.5, contrast: 0.8};
    const image = await render([
      black,
      rasterTile({'raster-opacity': 0.5, 'raster-contrast': 0.8}, createImage([COLOR]))
    ]);
    expectColor(center(image), referenceColor(COLOR, paint, 0));
  });

  test('raster-resampling nearest magnifies with hard texel edges', async () => {
    const columns = [
      [0, 0, 0],
      [255, 255, 255]
    ];
    // 45% of the way across: between the two texel centers, closer to the black one.
    const x = Math.round(SIZE * 0.45);
    const linear = await render([rasterTile({}, createImage(columns))]);
    expect(pixel(linear, x, SIZE / 2)[0]).toBeGreaterThan(60);
    deck?.finalize();
    deck = null;
    parent?.remove();

    const nearest = await render([
      rasterTile({'raster-resampling': 'nearest'}, createImage(columns))
    ]);
    expect(pixel(nearest, x, SIZE / 2)[0]).toBeLessThan(5);
  });
});
