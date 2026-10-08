// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {smoothWindElevation} from './terrain-data';

describe('original wind showcase terrain', () => {
  it('smooths isolated elevation spikes into a continuous mountain surface', () => {
    const pixels = new Uint8ClampedArray(5 * 5 * 4);
    pixels[(2 * 5 + 2) * 4] = 255;

    const smoothed = smoothWindElevation(pixels, 5, 5);
    const peak = smoothed[2 * 5 + 2];

    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThan(80);
    expect(smoothed[2 * 5 + 1]).toBeGreaterThan(0);
    expect(smoothed[1 * 5 + 2]).toBeGreaterThan(0);
    expect(smoothed[1 * 5 + 1]).toBeGreaterThan(0);
  });

  it('preserves uniform elevation across image edges', () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = 96;
    }

    expect([...smoothWindElevation(pixels, 3, 3)]).toEqual(Array.from({length: 9}, () => 96));
  });

  it('rejects mismatched terrain image dimensions', () => {
    expect(() => smoothWindElevation(new Uint8ClampedArray(4), 2, 2)).toThrow(
      'match positive image dimensions'
    );
  });
});
