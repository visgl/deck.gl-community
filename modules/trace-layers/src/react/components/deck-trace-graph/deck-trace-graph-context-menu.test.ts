import {describe, expect, it} from 'vitest';

import {
  resolveDeckTraceGraphOverviewContextTimeMs,
  resolveDeckTraceGraphOverviewContextViewport
} from './deck-trace-graph-context-menu';

describe('resolveDeckTraceGraphOverviewContextTimeMs', () => {
  it('uses the pointer location instead of the picked object coordinate', () => {
    expect(
      resolveDeckTraceGraphOverviewContextTimeMs({
        originTimeMs: 1_000,
        overviewTimeRange: {startTimeMs: 900, endTimeMs: 2_000},
        pickInfo: {
          coordinate: [700, 0],
          viewport: {
            id: 'minimap',
            unproject: () => [250, 0]
          } as never,
          x: 10,
          y: 20
        }
      })
    ).toBe(1_250);
  });

  it('clamps the resolved time to the full overview range', () => {
    expect(
      resolveDeckTraceGraphOverviewContextTimeMs({
        originTimeMs: 1_000,
        overviewTimeRange: {startTimeMs: 1_100, endTimeMs: 1_500},
        pickInfo: {
          coordinate: [900, 0],
          viewport: {id: 'minimap'} as never,
          x: Number.NaN,
          y: Number.NaN
        }
      })
    ).toBe(1_500);
  });

  it('uses the live minimap viewport for an empty deck.gl pick', () => {
    const minimapViewport = {
      id: 'minimap',
      x: 0,
      y: 100,
      width: 200,
      height: 50,
      unproject: () => [250, 0]
    } as never;

    expect(
      resolveDeckTraceGraphOverviewContextViewport({
        pickInfo: {x: 10, y: 120},
        minimapViewport
      })
    ).toBe(minimapViewport);
    expect(
      resolveDeckTraceGraphOverviewContextTimeMs({
        originTimeMs: 1_000,
        overviewTimeRange: {startTimeMs: 900, endTimeMs: 2_000},
        pickInfo: {x: 10, y: 120},
        minimapViewport
      })
    ).toBe(1_250);
  });

  it('does not treat an empty main-canvas pick as a minimap gesture', () => {
    expect(
      resolveDeckTraceGraphOverviewContextViewport({
        pickInfo: {x: 10, y: 20},
        minimapViewport: {
          id: 'minimap',
          x: 0,
          y: 100,
          width: 200,
          height: 50,
          unproject: () => [250, 0]
        } as never
      })
    ).toBeNull();
  });

  it('requires a minimap pick and complete overview range', () => {
    expect(
      resolveDeckTraceGraphOverviewContextTimeMs({
        originTimeMs: 1_000,
        overviewTimeRange: {startTimeMs: 900, endTimeMs: 2_000},
        pickInfo: {
          coordinate: [250, 0],
          viewport: {id: 'main'} as never,
          x: Number.NaN,
          y: Number.NaN
        }
      })
    ).toBeNull();
    expect(
      resolveDeckTraceGraphOverviewContextTimeMs({
        originTimeMs: 1_000,
        overviewTimeRange: {startTimeMs: 900},
        pickInfo: {
          coordinate: [250, 0],
          viewport: {id: 'minimap'} as never,
          x: Number.NaN,
          y: Number.NaN
        }
      })
    ).toBeNull();
  });
});
