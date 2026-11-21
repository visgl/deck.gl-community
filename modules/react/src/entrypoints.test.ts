// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'fs';
import {describe, expect, it} from 'vitest';
import * as deckCanvas from './deck-canvas';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('@deck.gl-community/react entry points', () => {
  it('exports DeckCanvas only from the deck-canvas subpath', () => {
    expect(Object.keys(deckCanvas)).toEqual(['DeckCanvas']);
    expect(packageJson.exports['./deck-canvas']).toEqual({
      types: './dist/deck-canvas.d.ts',
      require: './dist/deck-canvas.cjs',
      import: './dist/deck-canvas.js'
    });
  });

  it('keeps @deck.gl/core out of the root entry point', () => {
    const rootSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(rootSource).not.toMatch(/deck-canvas/);
    expect(packageJson.peerDependencies).not.toHaveProperty('@deck.gl/core');
  });
});
