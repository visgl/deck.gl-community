// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, _GlobeView as GlobeView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';
import {toFixtureUrl} from './reference-render/fixtures';

// A hillshade draws on a globe as on a map. At zoom 10 the globe is nearly flat over the view.

const SIZE = 256;
const BACKGROUND = [242, 239, 233];
const VIEW_STATE = {
  longitude: -121.81640625,
  latitude: 46.8000594467873,
  zoom: 10 + Math.log2(300 / 256),
  pitch: 0,
  bearing: 0
};

const STYLE = {
  version: 8,
  sources: {
    terrain: {
      type: 'raster-dem',
      tiles: [
        toFixtureUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png')
      ],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 11
    }
  },
  layers: [
    {id: 'background', type: 'background', paint: {'background-color': '#f2efe9'}},
    {id: 'hillshade', type: 'hillshade', source: 'terrain'}
  ]
};

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** The pixels of the basemap drawn in `mode`, once every tile has loaded. */
function render(mode: 'map' | 'globe'): Promise<Uint8ClampedArray> {
  parent = document.createElement('div');
  document.body.append(parent);
  return new Promise((resolve, reject) => {
    let settled = 0;
    const timeout = window.setTimeout(() => reject(new Error('Timed out rendering')), 30_000);
    deck = new Deck({
      parent: parent!,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: mode === 'globe' ? new GlobeView({id: 'view'}) : new MapView({id: 'view'}),
      viewState: VIEW_STATE as any,
      layers: [new BasemapLayer({id: 'basemap', mode, style: structuredClone(STYLE) as any})],
      onAfterRender: () => {
        const layers = (deck as any)?.layerManager?.getLayers() || [];
        const tileLayers = layers.filter((layer: any) => layer.state?.tileset);
        if (
          tileLayers.length === 0 ||
          !tileLayers.every((layer: any) => layer.state.tileset.selectedTiles) ||
          layers.some((layer: any) => !layer.isLoaded)
        ) {
          return;
        }
        if (settled++ < 2) {
          window.requestAnimationFrame(() => deck?.redraw('settle'));
          return;
        }
        window.clearTimeout(timeout);
        const copy = document.createElement('canvas');
        copy.width = SIZE;
        copy.height = SIZE;
        const context = copy.getContext('2d')!;
        context.drawImage(deck!.getCanvas()!, 0, 0);
        resolve(context.getImageData(0, 0, SIZE, SIZE).data);
      },
      onError: error => reject(error)
    });
  });
}

/** The median of the pixels' summed RGB differences from `color`. */
function medianDifference(pixels: Uint8ClampedArray, color: number[]) {
  const differences: number[] = [];
  for (let index = 0; index < pixels.length; index += 4) {
    let difference = 0;
    for (let channel = 0; channel < 3; channel++) {
      difference += Math.abs(pixels[index + channel] - color[channel]);
    }
    differences.push(difference);
  }
  differences.sort((a, b) => a - b);
  return differences[Math.floor(differences.length / 2)];
}

function meanColor(pixels: Uint8ClampedArray): number[] {
  const sums = [0, 0, 0];
  for (let index = 0; index < pixels.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      sums[channel] += pixels[index + channel];
    }
  }
  return sums.map(sum => sum / (pixels.length / 4));
}

describe('hillshade on a globe', () => {
  test('draws as on a map', async () => {
    const map = await render('map');
    deck?.finalize();
    parent?.remove();
    const globe = await render('globe');
    // The hillshade is drawn: most pixels are shaded away from the background.
    expect(medianDifference(globe, BACKGROUND)).toBeGreaterThan(50);
    // `GlobeView` draws a zoom at another scale than `MapView`, so the pixels do not line up; the
    // shading's colors do.
    const mapMean = meanColor(map);
    const globeMean = meanColor(globe);
    for (let channel = 0; channel < 3; channel++) {
      expect(Math.abs(globeMean[channel] - mapMean[channel])).toBeLessThanOrEqual(4);
    }
  }, 60_000);
});
