// @vitest-environment happy-dom

import {describe, expect, it} from 'vitest';

import {
  getTraceDragInteractionMode,
  getTraceDragZoomScale,
  getTraceWheelPanDelta,
  isTraceWheelPanEvent
} from './trace-orthographic-controller';

describe('trace orthographic controller helpers', () => {
  it('reads both axes from a trackpad wheel event for pan', () => {
    const event = new WheelEvent('wheel', {
      deltaX: 12,
      deltaY: -8,
      deltaMode: WheelEvent.DOM_DELTA_PIXEL
    });

    expect(getTraceWheelPanDelta(event)).toEqual([12, -8]);
  });

  it('normalizes line-based wheel deltas to viewport pixels', () => {
    const event = new WheelEvent('wheel', {
      deltaX: 2,
      deltaY: -3,
      deltaMode: WheelEvent.DOM_DELTA_LINE
    });

    expect(getTraceWheelPanDelta(event)).toEqual([80, -120]);
  });

  it('maps pressed upward swipes to temporal zoom-in', () => {
    expect(getTraceDragZoomScale(-180)).toBe(2);
  });

  it('maps pressed downward swipes to temporal zoom-out', () => {
    expect(getTraceDragZoomScale(180)).toBe(0.5);
  });

  it('treats unpressed wheel gestures as trace pans', () => {
    const event = new WheelEvent('wheel');
    Object.defineProperty(event, 'buttons', {value: 0});

    expect(isTraceWheelPanEvent(event)).toBe(true);
  });

  it('does not treat pressed wheel gestures as trace pans', () => {
    const event = new WheelEvent('wheel');
    Object.defineProperty(event, 'buttons', {value: 1});

    expect(isTraceWheelPanEvent(event)).toBe(false);
  });

  it('defaults invalid trace drag modes to drag-to-zoom', () => {
    expect(getTraceDragInteractionMode('invalid')).toBe('drag-to-zoom');
  });

  it('accepts drag-to-pan as a trace drag mode', () => {
    expect(getTraceDragInteractionMode('drag-to-pan')).toBe('drag-to-pan');
  });
});
