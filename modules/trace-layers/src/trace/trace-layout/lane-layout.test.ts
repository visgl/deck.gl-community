import {describe, expect, it} from 'vitest';

import {brand} from '../trace-graph/index';
import {kahnLaneLayout, layoutLanes, layoutLanesByOverlap, sortBlocksByTime} from './lane-layout';

import type {TraceSpan, TraceSpanId} from '../trace-graph/index';

/** Test user data with optional parent metadata. */
type TestBlockUserData = {
  parentSpanId?: TraceSpanId;
  traceId?: string;
};

/** Creates a TraceSpan fixture for lane layout tests. */
const makeBlock = (
  id: number,
  startTimeMs: number,
  durationMs: number,
  parentId?: number,
  extraTimings?: TraceSpan['timings'],
  status: 'not-started' | 'not-finished' | 'finished' = 'finished',
  traceId?: string
): TraceSpan<TestBlockUserData> => {
  const spanId = brand<'block', string>(`span:${id}`);
  const endTimeMs = startTimeMs + durationMs;
  const userData =
    parentId || traceId
      ? {
          ...(parentId ? {parentSpanId: brand<'block', string>(`span:${parentId}`)} : {}),
          ...(traceId ? {traceId} : {})
        }
      : undefined;
  return {
    type: 'trace-span',
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

/** Retrieves a parent id from test fixture user data. */
const getParentSpanId = (span: TraceSpan<TestBlockUserData>) => span.userData?.parentSpanId;

/** Retrieves a soft trace-affinity key from test fixture user data. */
const getLaneAffinityKey = (span: TraceSpan<TestBlockUserData>) => span.userData?.traceId;

describe('sortBlocksByTime', () => {
  it('sorts by start time then longer duration first', () => {
    const spans = [makeBlock(1, 0, 4), makeBlock(2, 0, 10), makeBlock(3, 1, 2)];

    const sortedIds = sortBlocksByTime(spans).map(span => span.spanId);
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
      makeBlock(1, 0, 10),
      makeBlock(2, 2, 4, 1),
      makeBlock(3, 3, 2, 2),
      makeBlock(4, 6, 3)
    ];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(1);
  });

  it('falls back to overlap packing when nested lane is blocked', () => {
    const spans = [makeBlock(1, 0, 10), makeBlock(2, 1, 10), makeBlock(3, 2, 2, 1)];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('recursively assigns a parent that sorts after its child', () => {
    const spans = [makeBlock(1, 10, 5), makeBlock(2, 0, 5, 1)];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('uses ordered lane windows when recursion assigns a later parent first', () => {
    const spans = [makeBlock(1, 10, 5), makeBlock(2, 0, 5, 1), makeBlock(3, 5, 5)];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(0);
  });

  it('keeps sequential tiny spans in one lane', () => {
    const spans = Array.from({length: 2_000}, (_, index) => makeBlock(index, index * 2, 1));

    const lanes = layoutLanes(spans);

    expect(lanes).toHaveLength(spans.length);
    expect(new Set(lanes.map(({lane}) => lane))).toEqual(new Set([0]));
  });

  it('assigns deeply nested spans without repeatedly scanning all occupied lanes', () => {
    const spans = Array.from({length: 5_000}, (_, index) =>
      makeBlock(index, index, 10_000 - index)
    );

    const lanes = layoutLanes(spans);

    expect(lanes).toHaveLength(spans.length);
    expect(lanes.at(0)?.lane).toBe(0);
    expect(lanes.at(-1)?.lane).toBe(spans.length - 1);
  });

  it('handles cyclic parent hints without infinite recursion', () => {
    const spans = [makeBlock(1, 0, 10, 2), makeBlock(2, 1, 8, 1)];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('assigns deep parent chains without exhausting the JavaScript call stack', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeBlock(index, index, 1, index + 1 < spanCount ? index + 1 : undefined)
    );

    const lanes = layoutLanes(spans, {getParentSpanId});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(spanCount - 1);
    expect(lanes.at(-1)?.lane).toBe(0);
  });

  it('keeps spans with the same affinity key on nearby fitting lanes', () => {
    const spans = [
      makeBlock(1, 0, 10),
      makeBlock(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 10, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
  });

  it('prefers the most recently used legal lane for one affinity group', () => {
    const spans = [
      makeBlock(1, 0, 10),
      makeBlock(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 10, 5, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(4, 15, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(1);
  });

  it('keeps a new affinity group out of another trace lane when an unclaimed legal lane fits', () => {
    const spans = [
      makeBlock(1, 0, 10),
      makeBlock(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 1, 1),
      makeBlock(4, 3, 1, undefined, undefined, 'finished', 'trace-b'),
      makeBlock(5, 5, 1, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:4'))).toBe(2);
    expect(lanesById.get(brand<'block', string>('span:5'))).toBe(1);
  });

  it('reserves a contiguous home band for one trace before its later overlapping spans arrive', () => {
    const spans = [
      makeBlock(1, 0, 20),
      makeBlock(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 1, 1),
      makeBlock(4, 1, 1),
      makeBlock(5, 3, 6, undefined, undefined, 'finished', 'trace-b'),
      makeBlock(6, 5, 5, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(7, 5, 5, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:5'))).toBe(3);
    expect(lanesById.get(brand<'block', string>('span:6'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:7'))).toBe(2);
  });

  it('reuses a foreign affinity lane rather than creating an extra lane when it is the only legal fit', () => {
    const spans = [
      makeBlock(1, 0, 10),
      makeBlock(2, 1, 1, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 3, 1, undefined, undefined, 'finished', 'trace-b')
    ];

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
    expect(Math.max(...lanes.map(({lane}) => lane))).toBe(1);
  });

  it('does not let affinity override overlap safety', () => {
    const spans = [
      makeBlock(1, 0, 10),
      makeBlock(2, 1, 4, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(3, 4, 4, undefined, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('does not let affinity override parent depth', () => {
    const spans = [
      makeBlock(1, 0, 1, undefined, undefined, 'finished', 'trace-a'),
      makeBlock(2, 2, 8),
      makeBlock(3, 3, 1, 2, undefined, 'finished', 'trace-a')
    ];

    const lanes = layoutLanes(spans, {getParentSpanId, getLaneAffinityKey});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(1);
  });
});

describe('kahnLaneLayout', () => {
  it('preorders parent-safe batches before lane assignment', () => {
    const spans = [makeBlock(1, 10, 5), makeBlock(2, 0, 5, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps the earliest ready span ahead of later roots when parent precedence unlocks it', () => {
    const spans = [makeBlock(1, 0, 10), makeBlock(2, 1, 2, 1), makeBlock(3, 1.5, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(2);
  });

  it('keeps earlier ready roots ahead of later longer roots', () => {
    const spans = [makeBlock(1, 0, 5), makeBlock(2, 1, 20)];

    const lanes = kahnLaneLayout(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps cyclic residues deterministic by falling back to time order', () => {
    const spans = [makeBlock(1, 0, 10, 2), makeBlock(2, 1, 8, 1)];

    const lanes = kahnLaneLayout(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('finishes dense overlapping affinity batches without rescanning every blocked lane', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeBlock(index, 0, 10, undefined, undefined, 'finished', 'trace-a')
    );

    const lanes = kahnLaneLayout(spans, {getLaneAffinityKey});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(0);
    expect(lanes.at(-1)?.lane).toBe(spanCount - 1);
  });

  it('assigns deep parent chains without exhausting the JavaScript call stack', () => {
    const spanCount = 20_000;
    const spans = Array.from({length: spanCount}, (_, index) =>
      makeBlock(index, index, 1, index + 1 < spanCount ? index + 1 : undefined)
    );

    const lanes = kahnLaneLayout(spans, {getParentSpanId});

    expect(lanes).toHaveLength(spanCount);
    expect(lanes[0]?.lane).toBe(spanCount - 1);
    expect(lanes.at(-1)?.lane).toBe(0);
  });
});

describe('layoutLanes', () => {
  it('keeps parent-aware placement in the default entry point', () => {
    const spans = [makeBlock(1, 10, 5), makeBlock(2, 0, 5, 1)];

    const lanes = layoutLanes(spans, {getParentSpanId});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });
});

describe('layoutLanesByOverlap', () => {
  it('packs overlapping intervals into the minimum number of lanes', () => {
    const spans = [makeBlock(1, 0, 5), makeBlock(2, 3, 4), makeBlock(3, 6, 2)];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
    expect(lanesById.get(brand<'block', string>('span:3'))).toBe(0);
  });

  it('considers all timings when determining overlap', () => {
    const spans = [
      makeBlock(1, 10, 1, undefined, {
        wide: {
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 20,
          durationMs: 20,
          durationMsAsString: '20ms'
        }
      }),
      makeBlock(2, 15, 1)
    ];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps non-finished spans occupying lanes while open', () => {
    const spans = [
      makeBlock(1, 0, 0, undefined, undefined, 'not-finished'),
      makeBlock(2, 10_000, 0)
    ];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('keeps unfinished top-level spans blocking subsequent overlaps', () => {
    const spans = [makeBlock(1, 0, 0, undefined, undefined, 'not-finished'), makeBlock(2, 500, 0)];

    const lanes = layoutLanes(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('extends not-finished spans with equal end time to max time for overlap checks', () => {
    const spans = [makeBlock(1, 0, 0, undefined, undefined, 'not-finished'), makeBlock(2, 0, 0)];

    const lanes = layoutLanes(spans, {maxTimeMs: 25_000});
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('treats zero-length spans as overlapping when inside unfinished spans', () => {
    const spans = [makeBlock(1, 0, 0, undefined, undefined, 'not-finished'), makeBlock(2, 500, 0)];

    const lanes = layoutLanes(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });

  it('prevents overlaps from not-started spans', () => {
    const spans = [makeBlock(1, 0, 0, undefined, undefined, 'not-started'), makeBlock(2, 0, 0)];

    const lanes = layoutLanesByOverlap(spans);
    const lanesById = new Map(lanes.map(({block, lane}) => [block.spanId, lane]));

    expect(lanesById.get(brand<'block', string>('span:1'))).toBe(0);
    expect(lanesById.get(brand<'block', string>('span:2'))).toBe(1);
  });
});
