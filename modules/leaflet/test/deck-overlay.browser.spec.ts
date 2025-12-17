// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {DeckOverlay} from '../src';
import {describe, it, expect} from 'vitest';

describe('exports', () => {
  it('contains public functions', () => {
    expect(DeckOverlay).toBeTruthy();
  });
});
