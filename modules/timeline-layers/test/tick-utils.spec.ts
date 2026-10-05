// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {formatDuration, getPrettyTicks, getTickStep, getZoomedRange} from '../src/utils/tick-utils';

describe('timeline tick utilities', () => {
  it('keeps the legacy numeric tick helpers working', () => {
    expect(getZoomedRange(10, 90, [0, 0, 100, 10])).toEqual([10, 90]);
    expect(getPrettyTicks(0, 1000, 3)).toEqual([0, 500, 1000]);
  });

  it('generates adaptive duration ticks', () => {
    expect(getTickStep(10_000, 5)).toBe(2000);
    expect(getPrettyTicks('duration', 0, 5000, 1000, 0).slice(0, 3)).toEqual([
      {type: 'major', x: 0, value: 0, stepStart: 0},
      {type: 'major', x: 1000, value: 1000, stepStart: 1000},
      {type: 'major', x: 2000, value: 2000, stepStart: 2000}
    ]);
  });

  it('formats zero-width short durations without undefined text', () => {
    expect(formatDuration(0, 'short')).toBe('.0');
  });
});
