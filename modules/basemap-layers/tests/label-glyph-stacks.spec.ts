// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {
  GlyphStore,
  MAX_GLYPH_STACKS,
  MAX_RETAINED_GLYPH_STACKS,
  MAX_STORE_RETAINED_GLYPH_STACKS
} from '../src/glyph-store.ts';
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
  // Counted in `state.updatesNeeded`, as deck.gl would update the layer again.
  (layer as any).setNeedsUpdate = () => {
    state.updatesNeeded = (state.updatesNeeded || 0) + 1;
  };
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

/** The font stacks a store holds glyphs for. */
function getResidentStacks(store: GlyphStore): number {
  return (store as any).stacks.size;
}

test('labels in far more font stacks than a layer can retain settle, with bounded requests', async () => {
  const count = 10 * MAX_GLYPH_STACKS;
  const {store, urls} = createGlyphStore();
  const state: Record<string, any> = {};
  await updateUntilLoaded({tiles: [getTile(count)], styleLayer, glyphs: store}, state);
  expect(state.glyphLoads).toBeFalsy();
  // The labels of the font stacks past the bound are left undrawn, with no request.
  expect(urls).toHaveLength(MAX_RETAINED_GLYPH_STACKS);
  expect(getResidentStacks(store)).toBe(MAX_RETAINED_GLYPH_STACKS);
  // The same tile again loads nothing more.
  await updateUntilLoaded({tiles: [getTile(count)], styleLayer, glyphs: store}, state);
  expect(urls).toHaveLength(MAX_RETAINED_GLYPH_STACKS);
});

test('labels whose font stacks were refused draw once the layer gives back its old ones', async () => {
  const {store, urls} = createGlyphStore();
  const state: Record<string, any> = {};
  // The layer retains as many font stacks as it can.
  const old = {tiles: [getTile(MAX_RETAINED_GLYPH_STACKS, 'Old')], styleLayer, glyphs: store};
  await updateUntilLoaded(old, state);
  expect(urls).toHaveLength(MAX_RETAINED_GLYPH_STACKS);

  // The tile is loaded again with text in as many other font stacks: the store refuses them while
  // the layer holds the old ones, which it gives back at the end of the update.
  const next = {tiles: [getTile(MAX_RETAINED_GLYPH_STACKS, 'New')], styleLayer, glyphs: store};
  state.updatesNeeded = 0;
  update(next, state);
  await settle();
  // The layer asks to be updated again, once, as the old font stacks were given back.
  expect(state.updatesNeeded).toBe(1);
  await updateUntilLoaded(next, state);
  for (let i = 0; i < MAX_RETAINED_GLYPH_STACKS; i++) {
    expect(store.hasGlyphs(`New ${i}`, 'A')).toBe(true);
  }
  expect(urls).toHaveLength(2 * MAX_RETAINED_GLYPH_STACKS);
  expect(state.labelData).toHaveLength(MAX_RETAINED_GLYPH_STACKS);

  // Once the labels have settled, an idle layer asks for no more updates.
  state.updatesNeeded = 0;
  update(next, state);
  await settle();
  expect(state.updatesNeeded).toBe(0);
});

test('label layers sharing a store retain a bounded number of font stacks together', async () => {
  const {store, urls} = createGlyphStore();
  const layers = 2 * (MAX_STORE_RETAINED_GLYPH_STACKS / MAX_RETAINED_GLYPH_STACKS);
  for (let i = 0; i < layers; i++) {
    const state: Record<string, any> = {};
    await updateUntilLoaded(
      {tiles: [getTile(MAX_RETAINED_GLYPH_STACKS, `Layer ${i}`)], styleLayer, glyphs: store},
      state
    );
    expect(state.glyphLoads).toBeFalsy();
  }
  expect(urls).toHaveLength(MAX_STORE_RETAINED_GLYPH_STACKS);
  expect(getResidentStacks(store)).toBe(MAX_STORE_RETAINED_GLYPH_STACKS);
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

describe.each([
  ['a layer of tiles', (count: number) => ({tiles: [getTile(count)]})],
  ['a layer of one tile', (count: number) => ({data: getTile(count).features})]
])('%s given a new glyph store with the same URL', (_name, getSource) => {
  test('loads the glyphs of its labels from it', async () => {
    const first = createGlyphStore();
    const state: Record<string, any> = {};
    const source = getSource(2);
    await updateUntilLoaded({...source, styleLayer, glyphs: first.store}, state);
    expect(state.labelData).toHaveLength(2);

    // As after a style reload: a new store, empty, for the same `glyphs` URL.
    const second = createGlyphStore();
    update({...source, styleLayer, glyphs: second.store}, state);
    // The rows wait for the new store's glyphs, rather than drawing without them.
    expect(state.glyphLoads).toBe(1);
    expect(state.labelData).toEqual([]);
    await updateUntilLoaded({...source, styleLayer, glyphs: second.store}, state);
    expect(second.urls).toHaveLength(2);
    expect(state.labelData).toHaveLength(2);
  });
});

describe.each([
  ['a layer of tiles', (count: number) => ({tiles: [getTile(count)]})],
  ['a layer of one tile', (count: number) => ({data: getTile(count).features})]
])('%s given a new glyph store while the old one is still loading', (_name, getSource) => {
  test('waits for the new store, not the old one', async () => {
    // The old store's ranges never finish loading.
    const old = new GlyphStore({
      url: 'https://glyphs.example/{fontstack}/{range}.pbf',
      fetch: (() => new Promise(() => {})) as unknown as typeof globalThis.fetch
    });
    const state: Record<string, any> = {};
    const source = getSource(2);
    update({...source, styleLayer, glyphs: old}, state);
    expect(state.glyphLoads).toBe(1);

    const next = createGlyphStore();
    update({...source, styleLayer, glyphs: next.store}, state);
    await settle();
    // The new store's ranges have loaded: the layer asks to update, and then draws its labels.
    expect(state.updatesNeeded).toBe(1);
    await updateUntilLoaded({...source, styleLayer, glyphs: next.store}, state);
    expect(state.glyphLoads).toBeFalsy();
    expect(state.labelData).toHaveLength(2);
  });
});
