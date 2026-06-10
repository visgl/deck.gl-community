import {describe, expect, it} from 'vitest';

import {sliceMipmap} from './slice-mipmap';

describe('sliceMipmap', () => {
  it('selects the longest slice per depth bucket', () => {
    const rows = sliceMipmap(
      [
        {id: 1, ts: 0, dur: 2, depth: 0},
        {id: 2, ts: 1, dur: 8, depth: 0},
        {id: 3, ts: 12, dur: 1, depth: 0}
      ],
      0,
      20,
      10,
      {sortOutput: true}
    );

    expect(rows).toEqual([
      {
        id: 2,
        ts: 1,
        dur: 8,
        depth: 0,
        bucketIndex: 0,
        bucketStart: 0,
        bucketEnd: 10,
        sampleCount: 2
      },
      {
        id: 3,
        ts: 12,
        dur: 1,
        depth: 0,
        bucketIndex: 1,
        bucketStart: 10,
        bucketEnd: 20,
        sampleCount: 1
      }
    ]);
  });

  it('keeps one winner per depth for the same bucket', () => {
    const rows = sliceMipmap(
      [
        {id: 1, ts: 2, dur: 4, depth: 0},
        {id: 2, ts: 3, dur: 7, depth: 1}
      ],
      0,
      10,
      10,
      {sortOutput: true}
    );

    expect(rows).toEqual([
      {
        id: 1,
        ts: 2,
        dur: 4,
        depth: 0,
        bucketIndex: 0,
        bucketStart: 0,
        bucketEnd: 10,
        sampleCount: 1
      },
      {
        id: 2,
        ts: 3,
        dur: 7,
        depth: 1,
        bucketIndex: 0,
        bucketStart: 0,
        bucketEnd: 10,
        sampleCount: 1
      }
    ]);
  });

  it('includes a previous slice that overlaps the window start', () => {
    const rows = sliceMipmap(
      [
        {id: 1, ts: 0, dur: 6, depth: 0},
        {id: 2, ts: 10, dur: 1, depth: 0}
      ],
      5,
      20,
      10,
      {
        includeOverlappingPrev: true,
        perfettoOverlapHeuristic: false,
        sortOutput: true
      }
    );

    expect(rows[0]).toEqual({
      id: 1,
      ts: 0,
      dur: 6,
      depth: 0,
      bucketIndex: 0,
      bucketStart: 5,
      bucketEnd: 15,
      sampleCount: 2
    });
  });

  it('keeps long-running slices active across later buckets', () => {
    const rows = sliceMipmap([{id: 1, ts: 0, dur: 100, depth: 0}], 0, 30, 10, {
      sortOutput: true
    });

    expect(rows).toEqual([
      {
        id: 1,
        ts: 0,
        dur: 100,
        depth: 0,
        bucketIndex: 0,
        bucketStart: 0,
        bucketEnd: 10,
        sampleCount: 1
      },
      {
        id: 1,
        ts: 0,
        dur: 100,
        depth: 0,
        bucketIndex: 1,
        bucketStart: 10,
        bucketEnd: 20,
        sampleCount: 1
      },
      {
        id: 1,
        ts: 0,
        dur: 100,
        depth: 0,
        bucketIndex: 2,
        bucketStart: 20,
        bucketEnd: 30,
        sampleCount: 1
      }
    ]);
  });
});
