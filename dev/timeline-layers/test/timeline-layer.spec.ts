// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect, vi} from 'vitest';
import {
  assignClipsToSubtracks,
  calculateSubtrackCount
} from '../src/layers/timeline-layer/timeline-collision';
import {
  positionToTime,
  timeToPosition,
  timeAxisFormatters,
  generateTimelineTicks
} from '../src/layers/timeline-layer/timeline-utils';
import {TimelineLayer} from '../src/layers/timeline-layer/timeline-layer';
import type {TimelineClip, TimelineTrack} from '../src/layers/timeline-layer/timeline-types';

// ===== COLLISION DETECTION =====

describe('assignClipsToSubtracks', () => {
  it('returns empty array for no clips', () => {
    expect(assignClipsToSubtracks([])).toEqual([]);
  });

  it('assigns a single clip to subtrack 0', () => {
    const clips: TimelineClip[] = [{id: 'a', startMs: 0, endMs: 1000}];
    const result = assignClipsToSubtracks(clips);
    expect(result).toHaveLength(1);
    expect(result[0].subtrackIndex).toBe(0);
  });

  it('places non-overlapping clips on the same subtrack', () => {
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 500},
      {id: 'b', startMs: 500, endMs: 1000}
    ];
    const result = assignClipsToSubtracks(clips);
    const byId = Object.fromEntries(result.map((c) => [c.id, c.subtrackIndex]));
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(0);
  });

  it('places overlapping clips on different subtracks', () => {
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 1000},
      {id: 'b', startMs: 500, endMs: 1500}
    ];
    const result = assignClipsToSubtracks(clips);
    const byId = Object.fromEntries(result.map((c) => [c.id, c.subtrackIndex]));
    expect(byId.a).not.toBe(byId.b);
  });

  it('packs three clips into two subtracks when third fits in first lane', () => {
    // a: 0-500, b: 0-500 (overlaps a), c: 600-1000 (fits after a)
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 500},
      {id: 'b', startMs: 0, endMs: 500},
      {id: 'c', startMs: 600, endMs: 1000}
    ];
    const result = assignClipsToSubtracks(clips);
    const subtracks = result.map((c) => c.subtrackIndex);
    const uniqueSubtracks = new Set(subtracks);
    expect(uniqueSubtracks.size).toBe(2);
  });

  it('sorts clips by startMs before assigning subtracks', () => {
    // Provide clips in reverse order; the algorithm must still work correctly
    const clips: TimelineClip[] = [
      {id: 'b', startMs: 1000, endMs: 2000},
      {id: 'a', startMs: 0, endMs: 500}
    ];
    const result = assignClipsToSubtracks(clips);
    const byId = Object.fromEntries(result.map((c) => [c.id, c.subtrackIndex]));
    // Both fit on subtrack 0 since they don't overlap
    expect(byId.a).toBe(0);
    expect(byId.b).toBe(0);
  });

  it('preserves original clip properties', () => {
    const clip: TimelineClip = {
      id: 'x',
      startMs: 100,
      endMs: 200,
      label: 'hello',
      color: [1, 2, 3, 4]
    };
    const [result] = assignClipsToSubtracks([clip]);
    expect(result.id).toBe('x');
    expect(result.label).toBe('hello');
    expect(result.color).toEqual([1, 2, 3, 4]);
    expect(result.subtrackIndex).toBeTypeOf('number');
  });
});

describe('calculateSubtrackCount', () => {
  it('returns 1 for empty clips array', () => {
    expect(calculateSubtrackCount([])).toBe(1);
  });

  it('returns 1 for non-overlapping clips', () => {
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 500},
      {id: 'b', startMs: 500, endMs: 1000}
    ];
    expect(calculateSubtrackCount(clips)).toBe(1);
  });

  it('returns 2 for two fully overlapping clips', () => {
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 1000},
      {id: 'b', startMs: 0, endMs: 1000}
    ];
    expect(calculateSubtrackCount(clips)).toBe(2);
  });

  it('returns 3 for three mutually overlapping clips', () => {
    const clips: TimelineClip[] = [
      {id: 'a', startMs: 0, endMs: 1000},
      {id: 'b', startMs: 0, endMs: 1000},
      {id: 'c', startMs: 0, endMs: 1000}
    ];
    expect(calculateSubtrackCount(clips)).toBe(3);
  });
});

// ===== TIME / POSITION MATH =====

describe('positionToTime', () => {
  it('maps left edge to startMs', () => {
    expect(positionToTime(0, 0, 100, 0, 1000)).toBe(0);
  });

  it('maps right edge to endMs', () => {
    expect(positionToTime(100, 0, 100, 0, 1000)).toBe(1000);
  });

  it('maps midpoint correctly', () => {
    expect(positionToTime(50, 0, 100, 0, 1000)).toBe(500);
  });

  it('clamps to startMs when x is before timeline', () => {
    expect(positionToTime(-10, 0, 100, 0, 1000)).toBe(0);
  });

  it('clamps to endMs when x is beyond timeline', () => {
    expect(positionToTime(200, 0, 100, 0, 1000)).toBe(1000);
  });

  it('respects non-zero timelineX offset', () => {
    // Timeline starts at x=50, width=100 → x=100 is midpoint
    expect(positionToTime(100, 50, 100, 0, 1000)).toBe(500);
  });

  it('works with non-zero startMs', () => {
    expect(positionToTime(50, 0, 100, 5000, 6000)).toBe(5500);
  });
});

describe('timeToPosition', () => {
  it('maps startMs to left edge', () => {
    expect(timeToPosition(0, 0, 100, 0, 1000)).toBe(0);
  });

  it('maps endMs to right edge', () => {
    expect(timeToPosition(1000, 0, 100, 0, 1000)).toBe(100);
  });

  it('maps midpoint correctly', () => {
    expect(timeToPosition(500, 0, 100, 0, 1000)).toBe(50);
  });

  it('clamps when time is before startMs', () => {
    expect(timeToPosition(-100, 0, 100, 0, 1000)).toBe(0);
  });

  it('clamps when time is after endMs', () => {
    expect(timeToPosition(9000, 0, 100, 0, 1000)).toBe(100);
  });

  it('round-trips with positionToTime', () => {
    const timeMs = 750;
    const x = timeToPosition(timeMs, 0, 800, 0, 60000);
    expect(positionToTime(x, 0, 800, 0, 60000)).toBeCloseTo(timeMs);
  });
});

// ===== TIME AXIS FORMATTERS =====

describe('timeAxisFormatters', () => {
  describe('seconds', () => {
    it('formats 0ms as 0.0s', () => {
      expect(timeAxisFormatters.seconds(0)).toBe('0.0s');
    });

    it('formats 5000ms as 5.0s', () => {
      expect(timeAxisFormatters.seconds(5000)).toBe('5.0s');
    });

    it('formats 1500ms as 1.5s', () => {
      expect(timeAxisFormatters.seconds(1500)).toBe('1.5s');
    });
  });

  describe('minutesSeconds', () => {
    it('formats 0ms as 0:00', () => {
      expect(timeAxisFormatters.minutesSeconds(0)).toBe('0:00');
    });

    it('formats 90000ms as 1:30', () => {
      expect(timeAxisFormatters.minutesSeconds(90000)).toBe('1:30');
    });

    it('formats 3600000ms as 60:00', () => {
      expect(timeAxisFormatters.minutesSeconds(3600000)).toBe('60:00');
    });

    it('pads seconds with leading zero', () => {
      expect(timeAxisFormatters.minutesSeconds(65000)).toBe('1:05');
    });
  });

  describe('hoursMinutesSeconds', () => {
    it('formats 0ms as 0:00:00', () => {
      expect(timeAxisFormatters.hoursMinutesSeconds(0)).toBe('0:00:00');
    });

    it('formats 3661000ms as 1:01:01', () => {
      expect(timeAxisFormatters.hoursMinutesSeconds(3661000)).toBe('1:01:01');
    });

    it('pads minutes and seconds with leading zeros', () => {
      expect(timeAxisFormatters.hoursMinutesSeconds(3600000)).toBe('1:00:00');
    });
  });
});

// ===== TICK GENERATION =====

describe('generateTimelineTicks', () => {
  it('generates the requested number of ticks', () => {
    const ticks = generateTimelineTicks({
      startMs: 0,
      endMs: 1000,
      timelineX: 0,
      timelineWidth: 100,
      tickCount: 5,
      formatter: timeAxisFormatters.seconds
    });
    expect(ticks).toHaveLength(5);
  });

  it('first tick is at timelineX with startMs', () => {
    const ticks = generateTimelineTicks({
      startMs: 0,
      endMs: 1000,
      timelineX: 50,
      timelineWidth: 200,
      tickCount: 3,
      formatter: timeAxisFormatters.seconds
    });
    expect(ticks[0].position).toBe(50);
    expect(ticks[0].timeMs).toBe(0);
  });

  it('last tick is at timelineX + width with endMs', () => {
    const ticks = generateTimelineTicks({
      startMs: 0,
      endMs: 1000,
      timelineX: 50,
      timelineWidth: 200,
      tickCount: 3,
      formatter: timeAxisFormatters.seconds
    });
    expect(ticks[2].position).toBe(250);
    expect(ticks[2].timeMs).toBe(1000);
  });

  it('applies the formatter to produce labels', () => {
    const fmt = (ms: number) => `t=${ms}`;
    const ticks = generateTimelineTicks({
      startMs: 0,
      endMs: 1000,
      timelineX: 0,
      timelineWidth: 100,
      tickCount: 3,
      formatter: fmt
    });
    expect(ticks.map((t) => t.label)).toEqual(['t=0', 't=500', 't=1000']);
  });
});

// ===== TIMELINE LAYER =====

describe('TimelineLayer', () => {
  it('has correct static layerName', () => {
    expect(TimelineLayer.layerName).toBe('TimelineLayer');
  });

  it('has default props', () => {
    expect(TimelineLayer.defaultProps).toBeDefined();
    expect(TimelineLayer.defaultProps.x).toBe(150);
    expect(TimelineLayer.defaultProps.y).toBe(100);
    expect(TimelineLayer.defaultProps.width).toBe(800);
    expect(TimelineLayer.defaultProps.trackHeight).toBe(40);
    expect(TimelineLayer.defaultProps.trackSpacing).toBe(10);
    expect(TimelineLayer.defaultProps.showScrubber).toBe(true);
    expect(TimelineLayer.defaultProps.showAxis).toBe(true);
    expect(TimelineLayer.defaultProps.showClipLabels).toBe(true);
    expect(TimelineLayer.defaultProps.showTrackLabels).toBe(true);
    expect(TimelineLayer.defaultProps.showSubtrackSeparators).toBe(true);
  });
});

describe('TimelineLayer.zoomToPoint', () => {
  function makeLayer(
    overrides: Partial<Parameters<(typeof TimelineLayer)['prototype']['zoomToPoint']>> = {}
  ): {
    layer: TimelineLayer;
    viewportSpy: ReturnType<typeof vi.fn>;
    zoomSpy: ReturnType<typeof vi.fn>;
  } {
    const viewportSpy = vi.fn();
    const zoomSpy = vi.fn();

    const tracks: TimelineTrack[] = [];
    const layer = new TimelineLayer({
      id: 'test',
      data: tracks,
      timelineStart: 0,
      timelineEnd: 60000,
      x: 0,
      width: 600,
      onViewportChange: viewportSpy,
      onZoomChange: zoomSpy
    });

    return {layer, viewportSpy, zoomSpy};
  }

  it('fires onZoomChange with new zoom level', () => {
    const {layer, zoomSpy} = makeLayer();
    layer.zoomToPoint(2.0, 300, 1.0); // zoom in 2× from centre
    expect(zoomSpy).toHaveBeenCalledOnce();
    expect(zoomSpy.mock.calls[0][0]).toBeCloseTo(2.0);
  });

  it('clamps zoom level to a maximum of 100', () => {
    const {layer, zoomSpy} = makeLayer();
    layer.zoomToPoint(1000, 300, 50.0);
    expect(zoomSpy.mock.calls[0][0]).toBe(100);
  });

  it('clamps zoom level to a minimum of 1.0', () => {
    const {layer, zoomSpy} = makeLayer();
    layer.zoomToPoint(0.0001, 300, 1.0);
    expect(zoomSpy.mock.calls[0][0]).toBe(1.0);
  });

  it('fires onViewportChange when zooming in', () => {
    const {layer, viewportSpy} = makeLayer();
    layer.zoomToPoint(2.0, 300, 1.0);
    expect(viewportSpy).toHaveBeenCalledOnce();
    const [startMs, endMs] = viewportSpy.mock.calls[0];
    expect(endMs - startMs).toBeCloseTo(30000); // half the range
  });

  it('fires onViewportChange with full range when zooming back to 1×', () => {
    const {layer, viewportSpy} = makeLayer();
    // Force zoom back to exactly 1.0 (factor 0.5 × 2.0 = 1.0)
    layer.zoomToPoint(0.5, 300, 2.0);
    expect(viewportSpy).toHaveBeenCalledOnce();
    const [startMs, endMs] = viewportSpy.mock.calls[0];
    expect(startMs).toBe(0);
    expect(endMs).toBe(60000);
  });

  it('viewport stays within timeline bounds when zooming near left edge', () => {
    const {layer, viewportSpy} = makeLayer();
    layer.zoomToPoint(4.0, 0, 1.0); // zoom in 4× at left edge
    const [startMs] = viewportSpy.mock.calls[0];
    expect(startMs).toBeGreaterThanOrEqual(0);
  });

  it('viewport stays within timeline bounds when zooming near right edge', () => {
    const {layer, viewportSpy} = makeLayer();
    layer.zoomToPoint(4.0, 600, 1.0); // zoom in 4× at right edge
    const [, endMs] = viewportSpy.mock.calls[0];
    expect(endMs).toBeLessThanOrEqual(60000);
  });
});
