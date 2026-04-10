// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

describe('exports', () => {
  it('contains public functions', async () => {
    const {DeckOverlay} = await import('../src');

    expect(DeckOverlay).toBeTruthy();
  });
});
