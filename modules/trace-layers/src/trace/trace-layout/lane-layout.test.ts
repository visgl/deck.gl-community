import {describe, expect, it} from 'vitest';

import {brand, encodeSpanRef} from '../trace-graph';
import {
  kahnLaneLayout,
  layoutLanes,
  layoutLanesByOverlap,
  legacyLaneLayout,
  sortSpansByTime
} from './lane-layout';

import type {SpanRef, TraceSpan} from '../trace-graph';

/** Test user data with optional parent metadata. */
type TestSpanUserData = {
  /** Optional parent span ref used by lane parent-order fixtures. */
  parentSpanRef?: SpanRef;
  traceId?: string;
};

/** Creates a TraceSpan fixture for lane layout tests. */
const makeSpan = (
  id: number,
  startTimeMs: number,
  durationMs: number,
  parentId?: number,
  extraTimings?: TraceSpan['timings'],
  status: 'not-started' | 'not-finished' | 'finished' = 'finished',
  traceId?: string
): TraceSpan<TestSpanUserData> & {
  /** Canonical runtime span ref assigned to the fixture. */
  spanRef: SpanRef;
} => {
  const spanId = brand<'block', string>(`span:${id}`);
  const spanRef = encodeSpanRef(0, id);
  const endTimeMs = startTimeMs + durationMs;
  const userData =
    parentId || traceId
      ? {
          ...(parentId ? {parentSpanRef: encodeSpanRef(0, parentId)} : {}),
          ...(traceId ? {traceId} : {})
        }
      : undefined;
  return {
    type: 'trace-span',
    spanRef,
    spanId,
    threadId: brand<'stream', string>('stream:test'),
    processName: 'rank-1',
    name: `span-${id}`,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status,
        startTimeMs,
        endTimeMs,
        durationMs,
        durationMsAsString: `${durationMs}ms`
      },
      ...(extraTimings ?? {})
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData
  };
};

/** Retrieves a parent ref from test fixture user data. */
const getParentSpanRef = (span: TraceSpan<TestSpanUserData>) => span.userData?.parentSpanRef;

/** Retrieves a soft trace-affinity key from test fixture user data. */
const getLaneAffinityKey = (span: TraceSpan<TestSpanUserData>) => span.userData?.traceId;

describe('sortSpansByTime', () => {
  it('sorts by start time then longer duration first', () => {
    const spans = [makeSpan(1, 0, 4), makeSpan(2, 0, 10), makeSpan(3, 1, 2)];

    const sortedIds = sortSpansByTime(spans).map(span => span.spanId);
    expect(sortedIds).toEqual([
      brand<'block', string>('span:2'),
      brand<'block', string>('span:1'),
      brand<'block', string>('span:3')
    ]);
  });
});

describe('layoutLanes', () => {
  it('places nested spans on deeper lanes than parents when available', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 2, 4, 1),
      makeSpan(3, 3, 2, 2),
      makeSpan(4, 6, 3)
    ];

    const lanes = layoutLanes(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(1);
  });

  it('falls back to overlap packing when nested lane is spaned', () => {
    const spans = [makeSpan(1, 0, 10), makeSpan(2, 1, 10), makeSpan(3, 2, 2, 1)];

    const lanes = layoutLanes(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('recursively assigns a parent that sorts after its child', () => {
    const spans = [makeSpan(1, 10, 5), makeSpan(2, 0, 5, 1)];

    const lanes = layoutLanes(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('uses ordered lane windows when recursion assigns a later parent first', () => {
    const spans = [makeSpan(1, 10, 5), makeSpan(2, 0, 5, 1), makeSpan(3, 5, 5)];

    const lanes = layoutLanes(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(0);
  });

  it('keeps sequential tiny spans in one lane', () => {
    const spans = Array.from({length: 2_000}, (_, index) => makeSpan(index, index * 2, 1));

    const lanes = layoutLanes(spans);

    expect(lanes).toHaveLength(spans.length);
    expect(new Set(lanes.map(({lane}) => lane))).toEqual(new Set([0]));
  });

  it('assigns deeply nested spans without repeatedly scanning all occupied lanes', () => {
    const spans = Array.from({length: 5_000}, (_, index) => makeSpan(index, index, 10_000 - index));

    const lanes = layoutLanes(spans);

    expect(lanes).toHaveLength(spans.length);
    expect(lanes.at(0)?.lane).toBe(0);
    expect(lanes.at(-1)?.lane).toBe(spans.length - 1);
  });

  it('handles cyclic parent hints without infinite recursion', () => {
    const spans = [makeSpan(1, 0, 10, 2), makeSpan(2, 1, 8, 1)];

    const lanes = layoutLanes(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('assigns deep parent chains without exhausting the JavaScript call stack', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeSpan(index, index, 1, index + 1 < spanCount ? index + 1 : undefined)
    );

    const lanes = layoutLanes(spans, {getParentSpanRef});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(spanCount - 1);
    expect(lanes.at(-1)?.lane).toBe(0);
  });

  it('keeps spans with the same affinity key on nearby fitting lanes', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 10, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
  });

  it('prefers the most recently used legal lane for one affinity group', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 10, 5, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(4, 15, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(1);
  });

  it('keeps a new affinity group out of another trace lane when an unclaimed legal lane fits', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 1, 1),
      makeSpan(4, 3, 1, undefined, undefined, 'finished', 'trace-b'),
      makeSpan(5, 5, 1, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:5'))).toBe(1);
  });

  it('reserves a contiguous home band for one trace before its later overlapping spans arrive', () => {
    const spans = [
      makeSpan(1, 0, 20),
      makeSpan(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 1, 1),
      makeSpan(4, 1, 1),
      makeSpan(5, 3, 6, undefined, undefined, 'finished', 'trace-b'),
      makeSpan(6, 5, 5, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(7, 5, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:5'))).toBe(3);
    expect(lanesById.get(brand<'block', string>('span:6'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:7'))).toBe(2);
  });

  it('reuses a foreign affinity lane rather than creating an extra lane when it is the only legal fit', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 3, 1, undefined, undefined, 'finished', 'trace-b')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
    expect(lanes.reduce((maxLane, {lane}) => Math.max(maxLane, lane), -Infinity)).toBe(1);
  });

  it('does not let affinity override overlap safety', () => {
    const spans = [
      makeSpan(1, 0, 10),
      makeSpan(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(3, 4, 4, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('does not let affinity override parent depth', () => {
    const spans = [
      makeSpan(1, 0, 1, undefined, undefined, 'finished', 'trace-a'),
      makeSpan(2, 2, 8),
      makeSpan(3, 3, 1, 2, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getParentSpanRef, getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
  });
});

describe('kahnLaneLayout', () => {
  it('preorders parent-safe batches before lane assignment', () => {
    const spans = [makeSpan(1, 10, 5), makeSpan(2, 0, 5, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps the earliest ready span ahead of later roots when parent precedence unlocks it', () => {
    const spans = [makeSpan(1, 0, 10), makeSpan(2, 1, 2, 1), makeSpan(3, 1.5, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('keeps earlier ready roots ahead of later longer roots', () => {
    const spans = [makeSpan(1, 0, 5), makeSpan(2, 1, 20)];

    const lanes = kahnLaneLayout(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps cyclic residues deterministic by falling back to time order', () => {
    const spans = [makeSpan(1, 0, 10, 2), makeSpan(2, 1, 8, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('finishes dense overlapping affinity batches without rescanning every spaned lane', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeSpan(index, 0, 10, undefined, undefined, 'finished', 'trace-a')
    );

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(0);
    expect(lanes.at(-1)?.lane).toBe(spanCount - 1);
  });

  it('assigns deep parent chains without exhausting the JavaScript call stack', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeSpan(index, index, 1, index + 1 < spanCount ? index + 1 : undefined)
    );

    const lanes = kahnLaneLayout(spans, {getParentSpanRef});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(spanCount - 1);
    expect(lanes.at(-1)?.lane).toBe(0);
  });
});

describe('legacyLaneLayout', () => {
  it('preserves the historical parent-aware placement entry point', () => {
    const spans = [makeSpan(1, 10, 5), makeSpan(2, 0, 5, 1)];

    const lanes = legacyLaneLayout(spans, {getParentSpanRef});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });
});

describe('layoutLanesByOverlap', () => {
  it('packs overlapping intervals into the minimum number of lanes', () => {
    const spans = [makeSpan(1, 0, 5), makeSpan(2, 3, 4), makeSpan(3, 6, 2)];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(0);
  });

  it('considers all timings when determining overlap', () => {
    const spans = [
      makeSpan(1, 10, 1, undefined, {
        wide: {
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 20,
          durationMs: 20,
          durationMsAsString: '20ms'
        }
      }),
      makeSpan(2, 15, 1)
    ];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps non-finished spans occupying lanes while open', () => {
    const spans = [makeSpan(1, 0, 0, undefined, undefined, 'not-finished'), makeSpan(2, 10_000, 0)];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps unfinished top-level spans spaning subsequent overlaps', () => {
    const spans = [makeSpan(1, 0, 0, undefined, undefined, 'not-finished'), makeSpan(2, 500, 0)];

    const lanes = layoutLanes(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('extends not-finished spans with equal end time to max time for overlap checks', () => {
    const spans = [makeSpan(1, 0, 0, undefined, undefined, 'not-finished'), makeSpan(2, 0, 0)];

    const lanes = layoutLanes(spans, {maxTimeMs: 25_000});
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('treats zero-length spans as overlapping when inside unfinished spans', () => {
    const spans = [makeSpan(1, 0, 0, undefined, undefined, 'not-finished'), makeSpan(2, 500, 0)];

    const lanes = layoutLanes(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('prevents overlaps from not-started spans', () => {
    const spans = [makeSpan(1, 0, 0, undefined, undefined, 'not-started'), makeSpan(2, 0, 0)];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({span, lane}) => [span.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });
});
