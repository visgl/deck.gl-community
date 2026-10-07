import {describe, expect, it} from 'vitest';
import * as dom from '../index';
import * as mapbox from '../mapbox';
import * as maplibre from '../maplibre';

describe('native entrypoint export matrix', () => {
  it('exports standalone APIs from the shared root and /dom entrypoint', () => {
    // package.json maps both `.` and `/dom` to this module.
    expect(Object.keys(dom).sort()).toEqual(['DeckGL', 'createDeckGL']);
    expect(dom).not.toHaveProperty('Deckgl');
  });

  it('exports provider-bound roots without adding them to the default module', () => {
    expect(Object.keys(mapbox).sort()).toEqual(['DeckGL']);
    expect(Object.keys(maplibre).sort()).toEqual(['DeckGL']);
    expect(mapbox.DeckGL).not.toBe(dom.DeckGL);
    expect(maplibre.DeckGL).not.toBe(dom.DeckGL);
  });
});
