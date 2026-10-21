// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {afterEach, describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer';

const SIZE = 128;
const FRAMES = 30;

let deck: Deck<any> | null = null;
let parent: HTMLDivElement | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  parent?.remove();
  parent = null;
});

/** A glyph store whose one range never loads. `loads` counts the calls to `load`. */
function createPendingGlyphStore() {
  const counts = {loads: 0};
  const store = {
    url: 'https://glyphs.example/{fontstack}/{range}.pbf',
    getGlyph: () => undefined,
    hasGlyphs: () => false,
    retain: () => true,
    retainOnly: () => {},
    onRetainedFreed: () => {},
    generation: 0,
    release: () => {},
    load() {
      counts.loads++;
      return new Promise<void>(() => {});
    }
  };
  return {counts, store};
}

function nextFrame(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

const feature = {type: 'Feature', geometry: {type: 'Point', coordinates: [0, 0]}, properties: {}};
const SOURCES = {
  'a layer of tiles': {
    tiles: [{index: {x: 0, y: 0, z: 0}, features: [feature], tile: {id: '0-0-0'}}]
  },
  'a layer of one tile': {data: [feature]}
};

describe.each(Object.entries(SOURCES))('the labels of %s waiting for glyphs', (_name, source) => {
  test('request them once and leave the map idle', async () => {
    const {counts, store} = createPendingGlyphStore();
    let frames = 0;
    parent = document.createElement('div');
    document.body.append(parent);
    deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      deviceProps: {adapters: [webgl2Adapter]},
      views: new OrthographicView({id: 'label-glyph-wait-test'}),
      initialViewState: {target: [0, 0, 0], zoom: 0},
      layers: [
        new MVTLabelLayer({
          id: 'labels',
          config: {labels: true},
          zoom: 8,
          styleLayer: {
            layout: {'text-field': 'A', 'text-font': ['literal', ['Noto Sans Regular']]}
          },
          glyphs: store,
          ...source
        } as any)
      ],
      onAfterRender: () => {
        frames++;
      }
    });
    for (let frame = 0; frame < FRAMES; frame++) {
      await nextFrame();
    }
    // Drawn at least once, so the layer has updated.
    expect(frames).toBeGreaterThan(0);
    expect(counts.loads).toBe(1);
    // An idle map is not drawn every frame while it waits.
    expect(frames).toBeLessThan(FRAMES / 2);
  });
});
