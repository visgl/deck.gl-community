import {describe, expect, it} from 'vitest';

import {encodeSpanRef} from '../../../trace/index';
import {buildTraceLayoutSpanGeometryChunksForTest} from '../../../trace/trace-graph/trace-graph-test-utils';
import {findTraceLayoutSpanAnchor, getTraceLayoutSpanAnchorDeltaY} from './trace-layout-anchors';

import type {SpanRef, TraceLayout} from '../../../trace/index';

const anchorSpanRef = encodeSpanRef(0, 7);

describe('trace layout anchors', () => {
  it('computes positive and negative span anchor deltas between layouts', () => {
    const lowerLayout = createTraceLayoutWithSpan(anchorSpanRef, [0, 30, 10, 50]);
    const higherLayout = createTraceLayoutWithSpan(anchorSpanRef, [0, 10, 10, 20]);

    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [higherLayout],
        nextTraceLayouts: [lowerLayout],
        spanRef: anchorSpanRef
      })
    ).toBe(25);
    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [lowerLayout],
        nextTraceLayouts: [higherLayout],
        spanRef: anchorSpanRef
      })
    ).toBe(-25);
  });

  it('returns null when either layout cannot resolve the anchor span', () => {
    const layoutWithSpan = createTraceLayoutWithSpan(anchorSpanRef, [0, 10, 10, 20]);
    const layoutWithoutSpan = createTraceLayoutWithSpan(encodeSpanRef(0, 8), [0, 30, 10, 50]);

    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [layoutWithSpan],
        nextTraceLayouts: [layoutWithoutSpan],
        spanRef: anchorSpanRef
      })
    ).toBeNull();
    expect(
      getTraceLayoutSpanAnchorDeltaY({
        previousTraceLayouts: [layoutWithoutSpan],
        nextTraceLayouts: [layoutWithSpan],
        spanRef: anchorSpanRef
      })
    ).toBeNull();
  });

  it('resolves span center anchors from span geometry chunks', () => {
    const layout = createTraceLayoutWithSpan(anchorSpanRef, [0, 10, 10, 24]);

    expect(findTraceLayoutSpanAnchor({traceLayouts: [layout], spanRef: anchorSpanRef})).toEqual({
      kind: 'span',
      spanRef: anchorSpanRef,
      centerY: 17
    });
  });
});

function createTraceLayoutWithSpan(
  spanRef: SpanRef,
  geometry: readonly [number, number, number, number]
): TraceLayout {
  return {
    spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([[spanRef, geometry]])
  } as unknown as TraceLayout;
}
