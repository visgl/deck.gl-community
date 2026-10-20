// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {expect, test} from 'vitest';
import {GlyphStore, MAX_GLYPH_STACKS} from '../src/glyph-store.ts';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';

/** A glyph store whose ranges load at once, empty; `urls` lists each range requested. */
function createGlyphStore() {
  const urls: string[] = [];
  const fetch = async (url: string) => {
    urls.push(url);
    return new Response(new ArrayBuffer(0));
  };
  const store = new GlyphStore({
    url: 'https://glyphs.example/{fontstack}/{range}.pbf',
    fetch: fetch as unknown as typeof globalThis.fetch
  });
  return {store, urls};
}

/** Runs `updateState` outside deck.gl, carrying state over as deck.gl does between updates. */
function update(props: Record<string, any>, state: Record<string, any>): MVTLabelLayer {
  const layer = new MVTLabelLayer({id: 'labels', config: {labels: true}, ...props} as any);
  (layer as any).context = {viewport: {}};
  (layer as any).state = state;
  (layer as any).setState = (partial: Record<string, any>) => Object.assign(state, partial);
  (layer as any).setNeedsUpdate = () => {};
  layer.updateState({changeFlags: {}} as any);
  return layer;
}

/** Resolves once the glyph loads in flight have settled. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve));
  }
}

/** A tile of `count` point labels of the text "A", each in a font stack of its own. */
function getTile(count: number, prefix = 'Stack') {
  const features = Array.from({length: count}, (_, i) => ({
    geometry: {type: 'Point', coordinates: [0.5, 0.5]},
    properties: {fonts: [`${prefix} ${i}`]}
  }));
  return {index: {x: 0, y: 0, z: 1}, features, tile: {id: '0-0-1'}};
}

const styleLayer = {layout: {'text-field': 'A', 'text-font': ['get', 'fonts']}};

/** Updates the layer until its glyphs have loaded, as deck.gl does once they have. */
async function updateUntilLoaded(props: Record<string, any>, state: Record<string, any>) {
  for (let i = 0; i < 10; i++) {
    update(props, state);
    if (!state.glyphLoads) {
      return;
    }
    await settle();
  }
}

test(`labels in more than ${MAX_GLYPH_STACKS} font stacks load their glyphs once`, async () => {
  const count = MAX_GLYPH_STACKS + 1;
  const {store, urls} = createGlyphStore();
  const state: Record<string, any> = {};
  await updateUntilLoaded({tiles: [getTile(count)], styleLayer, glyphs: store}, state);
  expect(state.glyphLoads).toBeFalsy();
  expect({labels: state.labelData.length, requests: urls.length}).toEqual({
    labels: count,
    requests: count
  });
  // One range of each font stack, each requested once.
  expect(urls).toHaveLength(count);
});

test('two label layers sharing a glyph store keep the glyphs of both', async () => {
  const {store, urls} = createGlyphStore();
  const first: Record<string, any> = {};
  const second: Record<string, any> = {};
  const half = Math.ceil((MAX_GLYPH_STACKS + 1) / 2);
  const firstProps = {tiles: [getTile(half, 'First')], styleLayer, glyphs: store};
  const secondProps = {tiles: [getTile(half, 'Second')], styleLayer, glyphs: store};
  await updateUntilLoaded(firstProps, first);
  await updateUntilLoaded(secondProps, second);
  // The first layer's glyphs are still there: its tile's features, loaded again, need no request.
  await updateUntilLoaded({...firstProps, tiles: [getTile(half, 'First')]}, first);
  expect(first.labelData).toHaveLength(half);
  expect(second.labelData).toHaveLength(half);
  expect(urls).toHaveLength(2 * half);
});

test('the glyphs of font stacks no label layer uses are dropped', async () => {
  const count = MAX_GLYPH_STACKS + 1;
  const {store, urls} = createGlyphStore();
  const state: Record<string, any> = {};
  const layer = update({tiles: [getTile(count)], styleLayer, glyphs: store}, state);
  await settle();
  // Its tiles show other font stacks: the store drops those it held beyond its bound.
  await updateUntilLoaded({tiles: [getTile(count, 'Other')], styleLayer, glyphs: store}, state);
  expect(store.hasGlyphs('Stack 0', 'A')).toBe(false);
  // Finalized, the layer keeps none.
  (layer as any).context = {viewport: {}, resourceManager: {unsubscribe: () => {}}};
  layer.finalizeState({} as any);
  store.load('Unused', ['A']);
  expect(store.hasGlyphs('Other 0', 'A')).toBe(false);
  expect(urls.length).toBeGreaterThan(count);
});
