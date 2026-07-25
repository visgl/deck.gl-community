import {describe, expect, it} from 'vitest';

import {refineLaneAffinityPlacements} from './lane-affinity-refinement';

import type {LaneAffinityTimedSpan} from './lane-affinity-refinement';

/** Minimal affinity fixture consumed by the refinement tests. */
type TestAffinitySpan = {
  /** Optional raw lane-affinity key attached to the fixture span. */
  affinityKey?: string;
};

/** Creates one time-sorted affinity refinement fixture. */
function makeTimedSpan(
  startTimeMs: number,
  endTimeMs: number,
  affinityKey?: string
): LaneAffinityTimedSpan<TestAffinitySpan> {
  return {
    span: {affinityKey},
    timing: {startTimeMs, endTimeMs}
  };
}

describe('refineLaneAffinityPlacements', () => {
  it('splits disconnected raw-key activity into independent placements', () => {
    const spans = [makeTimedSpan(0, 4, 'trace-a'), makeTimedSpan(10, 12, 'trace-a')];

    refineLaneAffinityPlacements({
      sortedSpans: spans,
      getLaneAffinityKey: span => span.affinityKey,
      maxPreferredWidth: 30
    });

    expect(spans[0]?.affinityPlacement).toBeDefined();
    expect(spans[1]?.affinityPlacement).toBeDefined();
    expect(spans[0]?.affinityPlacement).not.toBe(spans[1]?.affinityPlacement);
  });

  it('keeps overlapping raw-key activity in one placement with bounded preferred width', () => {
    const spans = [
      makeTimedSpan(0, 10, 'trace-a'),
      makeTimedSpan(1, 9, 'trace-a'),
      makeTimedSpan(2, 8, 'trace-a')
    ];

    const placementState = refineLaneAffinityPlacements({
      sortedSpans: spans,
      getLaneAffinityKey: span => span.affinityKey,
      maxPreferredWidth: 2
    });
    const placement = spans[0]?.affinityPlacement;

    expect(placement).toBeDefined();
    expect(spans[1]?.affinityPlacement).toBe(placement);
    expect(spans[2]?.affinityPlacement).toBe(placement);
    expect(placementState.preferredWidthByPlacement.get(placement!)).toBe(2);
  });
});
