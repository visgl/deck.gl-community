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
    await Promise.resolve();
    expect(state.glyphLoads).toBe(0);
    update({...props, zoom: 10}, state);
    expect(state.labelData).toHaveLength(1);
    expect(glyphs.requests).toEqual([request]);
  });
});
