import {describe, expect, it} from 'vitest';
import * as dom from '../index';

describe('native entrypoint export matrix', () => {
  it('exports DeckGL, but not Deckgl, from the shared root and /dom entrypoint', () => {
    // package.json maps both `.` and `/dom` to this module.
    expect(Object.keys(dom).sort()).toEqual(['DeckGL', 'extend', 'useDeckgl']);
    expect(dom).not.toHaveProperty('Deckgl');
  });
});
