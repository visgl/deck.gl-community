// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';

/**
 * A glyph store whose ranges load when `release` is called: the ranges of the font stacks in
 * `loaded` are there from the start. `requests` lists each font stack and range requested.
 */
function createGlyphStore(loaded: Record<string, number[]>) {
  const ranges = new Map(Object.entries(loaded).map(([stack, list]) => [stack, new Set(list)]));
  const requests: string[] = [];
  const pending: (() => void)[] = [];
  const getRange = (character: string) => Math.floor(character.codePointAt(0)! / 256) * 256;
  return {
    requests,
    release() {
      for (const resolve of pending.splice(0)) {
        resolve();
      }
    },
    store: {
      url: 'https://glyphs.example/{fontstack}/{range}.pbf',
      retain: () => true,
      retainOnly() {},
      onRetainedFreed() {},
      generation: 0,
      release() {},
      getGlyph(fontStack: string, codePoint: number) {
        return ranges.get(fontStack)?.has(Math.floor(codePoint / 256) * 256)
          ? {
              id: codePoint,
              bitmap: new Uint8Array(),
              width: 0,
              height: 0,
              left: 0,
              top: 0,
              advance: 12
            }
          : undefined;
      },
      hasGlyphs(fontStack: string, text: string) {
        return [...text].every(character => ranges.get(fontStack)?.has(getRange(character)));
      },
      load(fontStack: string, texts: Iterable<string>) {
        const missing = new Set<number>();
        for (const text of texts) {
          for (const character of text) {
            if (!ranges.get(fontStack)?.has(getRange(character))) {
              missing.add(getRange(character));
            }
          }
        }
        if (!missing.size) {
          return null;
        }
        for (const range of missing) {
          requests.push(`${fontStack} ${range}`);
        }
        return new Promise<void>(resolve => {
          pending.push(() => {
            const stack = ranges.get(fontStack) || new Set<number>();
            missing.forEach(range => stack.add(range));
            ranges.set(fontStack, stack);
            resolve();
          });
        });
      }
    }
  };
}

/** Runs `updateState` outside deck.gl, carrying state over as deck.gl does between updates. */
function update(props: Record<string, any>, state: Record<string, any>): void {
  const layer = new MVTLabelLayer({id: 'labels', config: {labels: true}, ...props} as any);
  (layer as any).context = {viewport: {}};
  (layer as any).state = state;
  (layer as any).setState = (partial: Record<string, any>) => Object.assign(state, partial);
  (layer as any).setNeedsUpdate = () => {};
  layer.updateState({changeFlags: {}} as any);
}

/** Resolves once the glyph loads released have settled. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve));
}

const feature = {geometry: {type: 'Point', coordinates: [0.5, 0.5]}, properties: {}};
const tile = {index: {x: 0, y: 0, z: 1}, features: [feature], tile: {id: '0-0-1'}};

const REGULAR = 'Noto Sans Regular';
const BOLD = 'Noto Sans Bold';

/** Text from the basic Latin range below zoom 10, and from Cyrillic from zoom 10. */
const RANGE_STEP = {
  layout: {'text-field': ['step', ['zoom'], 'A', 10, 'Ж'], 'text-font': ['literal', [REGULAR]]}
};
/** The same text, in the bold font stack from zoom 10. */
const FONT_STEP = {
  layout: {
    'text-field': 'A',
    'text-font': ['step', ['zoom'], ['literal', [REGULAR]], 10, ['literal', [BOLD]]]
  }
};

const PATHS = {
  'a layer of tiles': {tiles: [tile]},
  'a layer of one tile': {data: [feature]}
};

describe.each(Object.entries(PATHS))('the kept point labels of %s', (_name, source) => {
  test.each([
    ['a new glyph range', RANGE_STEP, `${REGULAR} 1024`],
    ['a new font stack', FONT_STEP, `${BOLD} 0`]
  ])('wait for %s at a zoom step', async (_case, styleLayer, request) => {
    const glyphs = createGlyphStore({[REGULAR]: [0]});
    const state: Record<string, any> = {};
    const props = {...source, styleLayer, glyphs: glyphs.store};

    update({...props, zoom: 9}, state);
    expect(state.labelData).toHaveLength(1);
    expect(glyphs.requests).toEqual([]);

    // The anchors are the same at zoom 10; the text or font is not.
    update({...props, zoom: 10}, state);
    expect(glyphs.requests).toEqual([request]);
    // The layer is not loaded until they have (see `isLoaded`).
    expect(state.glyphLoads).toBe(1);
    // Not drawn without its glyphs.
    expect(state.labelData).toEqual([]);

    glyphs.release();
    await settle();
    expect(state.glyphLoads).toBe(0);
    update({...props, zoom: 10}, state);
    expect(state.labelData).toHaveLength(1);
    expect(glyphs.requests).toEqual([request]);
  });
});

describe.each(
  Object.entries(PATHS)
)('the point labels of %s in a refused font stack', (_name, source) => {
  test.each([
    ['placed', []],
    ['kept from another zoom', [9]]
  ])('are left out of the rows when %s, and placed once retained', (_case, zooms) => {
    const glyphs = createGlyphStore({[REGULAR]: [0], [BOLD]: [0]});
    // The store will not retain the bold font stack (see `GlyphStore.retain`).
    const refused = new Set([BOLD]);
    (glyphs.store as any).retain = (_owner: object, fontStack: string) => !refused.has(fontStack);
    const state: Record<string, any> = {};
    const props = {...source, styleLayer: FONT_STEP, glyphs: glyphs.store};

    for (const zoom of zooms) {
      update({...props, zoom}, state);
      expect(state.labelData).toHaveLength(1);
    }
    // Bold from zoom 10. A row drawn without the stack retained would put its text in the font
    // atlas as empty cells, which deck.gl keeps once the glyphs load.
    update({...props, zoom: 10}, state);
    expect(state.labelData).toEqual([]);

    // The store gives back font stacks of another layer, and retains bold now.
    refused.clear();
    glyphs.store.generation++;
    update({...props, zoom: 10}, state);
    expect(state.labelData).toHaveLength(1);
    expect(glyphs.requests).toEqual([]);
  });
});

describe.each(
  Object.entries(PATHS)
)('the point labels of %s placed while a font stack was refused', (_name, source) => {
  test('are placed again at a zoom step to a font stack the store retains', () => {
    const glyphs = createGlyphStore({[REGULAR]: [0], [BOLD]: [0]});
    const refused = new Set([BOLD]);
    (glyphs.store as any).retain = (_owner: object, fontStack: string) => !refused.has(fontStack);
    const state: Record<string, any> = {};
    const props = {...source, styleLayer: FONT_STEP, glyphs: glyphs.store};

    // Bold from zoom 10, refused: its label is left out.
    update({...props, zoom: 10}, state);
    expect(state.labelData).toEqual([]);

    // Regular below zoom 10, which the store retains, with no change of its generation. The
    // anchors are the same, but the rows left the label out.
    update({...props, zoom: 9}, state);
    expect(state.labelData).toHaveLength(1);
  });
});

const line = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [0.1, 0.5],
      [0.9, 0.5]
    ]
  },
  properties: {}
};
const lineTile = {index: {x: 0, y: 0, z: 1}, features: [line], tile: {id: '0-0-1'}};
const LINE_LAYOUT = {'symbol-placement': 'line', 'symbol-spacing': 50};

describe.each(
  Object.entries({
    'a layer of tiles': {tiles: [lineTile]},
    'a layer of one tile': {data: [line]}
  })
)('the line labels of %s', (_name, source) => {
  test.each([
    ['a new glyph range', RANGE_STEP, `${REGULAR} 1024`],
    ['a new font stack', FONT_STEP, `${BOLD} 0`]
  ])('wait for %s at a zoom step', async (_case, styleLayer, request) => {
    const glyphs = createGlyphStore({[REGULAR]: [0]});
    const state: Record<string, any> = {};
    const props = {
      ...source,
      styleLayer: {layout: {...styleLayer.layout, ...LINE_LAYOUT}},
      glyphs: glyphs.store
    };

    update({...props, zoom: 9}, state);
    expect(state.labelData.length).toBeGreaterThan(0);

    // Labels along lines are placed by their text, so the anchors change at zoom 10 too.
    update({...props, zoom: 10}, state);
    expect(glyphs.requests).toEqual([request]);
    // The rows placed for the old text are not drawn with the new text, which has no glyphs yet.
    expect(state.labelData).toEqual([]);

    glyphs.release();
    await settle();
    update({...props, zoom: 10}, state);
    expect(state.labelData.length).toBeGreaterThan(0);
  });
});

test('labels wait for one glyph load at a time', async () => {
  const glyphs = createGlyphStore({[REGULAR]: [0]});
  const state: Record<string, any> = {};
  const props = {tiles: [tile], styleLayer: RANGE_STEP, glyphs: glyphs.store, zoom: 10};
  // Tiles loading meanwhile update the layer again.
  for (let count = 0; count < 3; count++) {
    update({...props, tiles: [{...tile, features: [feature]}]}, state);
  }
  expect(state.glyphLoads).toBe(1);
  glyphs.release();
  await settle();
  expect(state.glyphLoads).toBe(0);
  update(props, state);
  expect(state.labelData).toHaveLength(1);
});
