import {describe, expect, it, vi} from 'vitest';

import {
  DeckTraceGraphController,
  widenBoundsForMinimumBlockWidth
} from './deck-trace-graph-controller';

import type {SpanBoundingBox} from '../../trace/index';

vi.mock('@deck.gl-community/infovis-layers', () => ({
  fitBoundsOrthographic: vi.fn(),
  getPaddedBlockBounds: vi.fn()
}));

describe('DeckTraceGraphController', () => {
  it('falls back to a one-pixel viewport width when deck dimensions are unavailable', () => {
    expect(
      widenBoundsForMinimumBlockWidth(
        [
          [0, -1],
          [100, 1]
        ],
        null,
        0.1,
        50
      )
    ).toEqual([
      [-5.555555555555557, -1],
      [105.55555555555556, 1]
    ]);
  });

  it('widens bounds to satisfy the minimum viewport fraction', () => {
    expect(
      widenBoundsForMinimumBlockWidth(
        [
          [0, -1],
          [100, 1]
        ],
        {width: 1000, height: 500},
        0.1,
        50
      )
    ).toEqual([
      [-450, -1],
      [550, 1]
    ]);
  });

  it('widens bounds to satisfy the minimum pixel width requirement', () => {
    expect(
      widenBoundsForMinimumBlockWidth(
        [
          [0, -1],
          [100, 1]
        ],
        {width: 200, height: 500},
        0.1,
        50
      )
    ).toEqual([
      [-150, -1],
      [250, 1]
    ]);
  });

  it('clamps reset-view X zoom to the configured minZoom while preserving the default Y zoom', async () => {
    const {fitBoundsOrthographic} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(fitBoundsOrthographic).mockReturnValue({
      target: [10, 0],
      zoomX: -20,
      zoomY: 1
    });

    const controller = new DeckTraceGraphController(() => ({
      target: [0, 0, 0],
      zoomX: -5,
      zoomY: 5,
      minZoomX: -12,
      maxZoomX: 6
    }));
    controller.width = 1200;
    controller.height = 800;

    const nextViewState = controller.fitToBounds(
      [
        [0, 0],
        [100, 100]
      ],
      true
    );

    expect(nextViewState).toBeTruthy();
    expect(fitBoundsOrthographic).toHaveBeenCalledWith(
      1050,
      800,
      [
        [0, 0],
        [100, 100]
      ],
      'per-axis'
    );
    expect(nextViewState?.zoomX).toEqual(-12);
    expect(nextViewState?.zoomY).toEqual(5);
    expect(nextViewState?.target).toEqual([10, 10.9375]);
  });

  it('fits entire bounds on both axes and clamps configured zoom limits', async () => {
    const {fitBoundsOrthographic} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(fitBoundsOrthographic).mockReturnValue({
      target: [10, 42],
      zoomX: -20,
      zoomY: -10
    });

    const controller = new DeckTraceGraphController(() => ({
      target: [5, 6, 7],
      zoomX: -1,
      zoomY: 2,
      minZoomX: -12,
      maxZoomX: 6,
      minZoomY: -6,
      maxZoomY: 4
    }));
    controller.width = 1200;
    controller.height = 800;

    const nextViewState = controller.fitEntireBounds(
      [
        [0, 0],
        [100, 1000]
      ],
      true
    );

    expect(fitBoundsOrthographic).toHaveBeenLastCalledWith(
      1050,
      800,
      [
        [0, 0],
        [100, 1000]
      ],
      'per-axis'
    );
    expect(nextViewState?.target).toEqual([10, 42, 7]);
    expect(nextViewState?.zoomX).toEqual(-12);
    expect(nextViewState?.zoomY).toEqual(-6);
    expect(nextViewState?.transitionDuration).toEqual(600);
    expect(nextViewState?.transitionInterpolator).toBeDefined();
  });

  it('does not fit entire bounds before viewport dimensions are available', () => {
    const controller = new DeckTraceGraphController(() => ({
      target: [5, 6, 7],
      zoomX: -1,
      zoomY: 2
    }));

    expect(
      controller.fitEntireBounds(
        [
          [0, 0],
          [100, 1000]
        ],
        true
      )
    ).toBeNull();
  });

  it('applies custom transition durations to imperative view updates', () => {
    const controller = new DeckTraceGraphController(() => ({
      target: [0, 0, 0],
      zoomX: 0,
      zoomY: 0
    }));

    const nextViewState = controller.panBy([16, 32], {
      transition: true,
      transitionDurationMs: 80
    });

    expect(nextViewState.target).toEqual([16, 32, 0]);
    expect(nextViewState.transitionDuration).toBe(80);
    expect(nextViewState.transitionInterpolator).toBeDefined();
  });

  it('places navigated spans 30% from the left and 30% from the top', async () => {
    const {getPaddedBlockBounds} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(getPaddedBlockBounds).mockReturnValue([
      [10, 20],
      [50, 60]
    ]);

    const controller = new DeckTraceGraphController(() => ({
      target: [0, 0, 7],
      zoomX: 1,
      zoomY: 2
    }));
    controller.width = 1000;
    controller.height = 600;

    const nextViewState = controller.centerOnSpan(
      new Float32Array([10, 20, 50, 60]) as SpanBoundingBox
    );

    expect(nextViewState?.target).toEqual([130, 70, 7]);
    expect(nextViewState?.transitionDuration).toBe(1200);
    expect(nextViewState?.transitionInterpolator).toBeDefined();
  });

  it('falls back to centering span navigation when viewport dimensions are unavailable', async () => {
    const {getPaddedBlockBounds} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(getPaddedBlockBounds).mockReturnValue([
      [10, 20],
      [50, 60]
    ]);

    const controller = new DeckTraceGraphController(() => ({
      target: [0, 0, 0],
      zoomX: 1,
      zoomY: Number.NaN
    }));

    const nextViewState = controller.centerOnSpan(
      new Float32Array([10, 20, 50, 60]) as SpanBoundingBox
    );

    expect(nextViewState?.target).toEqual([30, 40, 0]);
  });

  it('tracks time at the 75% viewport anchor while fitting vertical bounds', async () => {
    const {fitBoundsOrthographic} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(fitBoundsOrthographic).mockReturnValue({
      target: [10, 42],
      zoomX: -3,
      zoomY: -10
    });

    const controller = new DeckTraceGraphController(() => ({
      target: [5, 6, 0],
      zoomX: -1,
      zoomY: 2,
      minZoomY: -6,
      maxZoomY: 4
    }));
    controller.width = 1200;
    controller.height = 800;

    const nextViewState = controller.centerOnTimeAndFitY(1234, [
      [0, 0],
      [100, 1000]
    ]);

    expect(fitBoundsOrthographic).toHaveBeenCalledWith(
      1200,
      800,
      [
        [0, 0],
        [100, 1000]
      ],
      'per-axis'
    );
    expect(nextViewState?.target).toEqual([634, 42, 0]);
    expect(nextViewState?.zoomX).toEqual(-1);
    expect(nextViewState?.zoomY).toEqual(-6);
    expect(nextViewState?.transitionDuration).toEqual(0);
    expect(nextViewState?.transitionInterpolator).toBeUndefined();
  });

  it('tracks time without changing vertical state', () => {
    const controller = new DeckTraceGraphController(() => ({
      target: [5, 6, 0],
      zoomX: -1,
      zoomY: 2
    }));
    controller.width = 1200;

    const nextViewState = controller.trackTime(1234);

    expect(nextViewState?.target).toEqual([634, 6, 0]);
    expect(nextViewState?.zoomY).toEqual(2);
    expect(nextViewState?.transitionDuration).toEqual(0);
  });

  it('fits vertical bounds without changing horizontal state', async () => {
    const {fitBoundsOrthographic} = await import('@deck.gl-community/infovis-layers');
    vi.mocked(fitBoundsOrthographic).mockReturnValue({
      target: [10, 42],
      zoomX: -3,
      zoomY: -10
    });

    const controller = new DeckTraceGraphController(() => ({
      target: [5, 6, 0],
      zoomX: -1,
      zoomY: 2,
      minZoomY: -6
    }));
    controller.width = 1200;
    controller.height = 800;

    const nextViewState = controller.fitYToBounds([
      [0, 0],
      [100, 1000]
    ]);

    expect(nextViewState?.target).toEqual([5, 42, 0]);
    expect(nextViewState?.zoomX).toEqual(-1);
    expect(nextViewState?.zoomY).toEqual(-6);
  });
});
