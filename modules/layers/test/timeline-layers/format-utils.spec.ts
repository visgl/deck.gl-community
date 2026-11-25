// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  floatToStr,
  formatTraceTimeMs,
  formatTraceTimeRangeMs
} from '../../src/timeline-layers/utils/trace-format-utils';

describe('trace time formatting', () => {
  it('formats compact trace-style durations', () => {
    expect(formatTraceTimeMs(0)).toBe('0s');
    expect(formatTraceTimeMs(0.5)).toBe('500 µs');
    expect(formatTraceTimeMs(1500)).toBe('1.5 s');
    expect(formatTraceTimeMs(90_000)).toBe('1m30s');
    expect(formatTraceTimeMs(5_400_000)).toBe('1h30m');
    expect(formatTraceTimeMs(129_600_000)).toBe('1d12h');
    expect(formatTraceTimeMs(-119_400)).toBe('-1m59s');
  });

  it('supports compact labels and significant-digit rounding', () => {
    expect(formatTraceTimeMs(1500, {space: false})).toBe('1.5s');
    expect(formatTraceTimeMs(1500, {space: false, roundDigits: 1})).toBe('2s');
    expect(floatToStr(0.000123456, 5)).toBe('0.00012346');
  });

  it('formats ranges with the same duration labels', () => {
    expect(formatTraceTimeRangeMs(1500, 3000)).toBe('1.5 s - 3 s');
  });
});
