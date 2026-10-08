import {describe, it, expect} from 'vitest';
import {
  HorizonGraphLayer,
  MultiHorizonGraphLayer,
  TimeAxisLayer,
  VerticalGridLayer,
  TimelineLayer,
  formatTimeMs,
  timeAxisFormatters,
  positionToTime,
  timeToPosition
} from '../src';

describe('@deck.gl-community/timeline-layers', () => {
  it('exports HorizonGraph layers', () => {
    expect(HorizonGraphLayer).toBeDefined();
    expect(MultiHorizonGraphLayer).toBeDefined();
  });

  it('exports timeline utilities', () => {
    expect(TimeAxisLayer).toBeDefined();
    expect(VerticalGridLayer).toBeDefined();
    expect(formatTimeMs).toBeTypeOf('function');
  });

  it('exports TimelineLayer', () => {
    expect(TimelineLayer).toBeDefined();
  });

  it('exports time axis formatters', () => {
    expect(timeAxisFormatters.seconds).toBeTypeOf('function');
    expect(timeAxisFormatters.seconds(5000)).toBe('5.0s');
    expect(timeAxisFormatters.minutesSeconds(90000)).toBe('1:30');
  });

  it('exports position/time conversion utilities', () => {
    expect(positionToTime).toBeTypeOf('function');
    expect(timeToPosition).toBeTypeOf('function');

    // positionToTime: x=0 maps to startMs, x=width maps to endMs
    expect(positionToTime(0, 0, 100, 0, 1000)).toBe(0);
    expect(positionToTime(100, 0, 100, 0, 1000)).toBe(1000);
    expect(positionToTime(50, 0, 100, 0, 1000)).toBe(500);

    // timeToPosition: startMs maps to x=0, endMs maps to x=width
    expect(timeToPosition(0, 0, 100, 0, 1000)).toBe(0);
    expect(timeToPosition(1000, 0, 100, 0, 1000)).toBe(100);
    expect(timeToPosition(500, 0, 100, 0, 1000)).toBe(50);
  });
});
