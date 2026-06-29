// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {floatToStr, formatTimeMs, formatTimeRangeMs} from '../src/utils/format-utils';

describe('infovis time formatting', () => {
  it('formats compact trace-style durations', () => {
    expect(formatTimeMs(0)).toBe('0s');
    expect(formatTimeMs(0.5)).toBe('500 µs');
    expect(formatTimeMs(1500)).toBe('1.5 s');
    expect(formatTimeMs(90_000)).toBe('1m30s');
    expect(formatTimeMs(5_400_000)).toBe('1h30m');
    expect(formatTimeMs(129_600_000)).toBe('1d12h');
    expect(formatTimeMs(-119_400)).toBe('-1m59s');
  });

  it('supports compact labels and significant-digit rounding', () => {
    expect(formatTimeMs(1500, {space: false})).toBe('1.5s');
    expect(formatTimeMs(1500, {space: false, roundDigits: 1})).toBe('2s');
    expect(floatToStr(0.000123456, 5)).toBe('0.00012346');
  });

  it('formats ranges with the same duration labels', () => {
    expect(formatTimeRangeMs(1500, 3000)).toBe('1.5 s - 3 s');
  });
});
