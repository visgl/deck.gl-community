import {getTraceLayoutVerticalBounds} from '../../trace/index';

import type {TraceLayout} from '../../trace/index';
import type {Bounds} from '@deck.gl-community/infovis-layers';

const DEFAULT_TRACE_VERTICAL_PADDING = 0;

/**
 * Calculates a bounding box that contains every visible element in the trace layout between the
 * provided timestamps. Horizontal padding is derived from the requested fraction of the time span
 * while vertical padding defaults to 0 so the first rendered element aligns at y = 0 unless
 * overridden by `verticalPadding`.
 *
 * @param params.traceLayout - Layout information containing block, stream, and rank geometry.
 * @param params.minTimeMs - Inclusive minimum timestamp for the visible trace range.
 * @param params.maxTimeMs - Inclusive maximum timestamp for the visible trace range.
 * @param params.horizontalPaddingFraction - Optional fraction of the horizontal span to use as
 *   padding on the X axis. Defaults to 0.
 * @param params.verticalPadding - Optional constant padding applied to both the top and bottom of
 *   the bounds. Defaults to 0.
 * @returns Two points describing the lower-left and upper-right corners of the bounding box.
 */
export function getTraceBounds(params: {
  traceLayout: TraceLayout;
  verticalBounds?: [number, number];
  minTimeMs: number;
  maxTimeMs: number;
  horizontalPaddingFraction?: number;
  verticalPadding?: number;
}): Bounds {
  const {
    traceLayout,
    verticalBounds,
    minTimeMs,
    maxTimeMs,
    horizontalPaddingFraction = 0,
    verticalPadding = DEFAULT_TRACE_VERTICAL_PADDING
  } = params;

  const rawSpan = Math.max(maxTimeMs - minTimeMs, 0);
  const safeSpan = rawSpan === 0 ? 1 : rawSpan;
  const horizontalPadding = (safeSpan * horizontalPaddingFraction) / 2;
  let minX = horizontalPadding === 0 ? 0 : -horizontalPadding;
  let maxX = rawSpan + horizontalPadding;

  if (rawSpan === 0) {
    const halfSpan = safeSpan / 2;
    minX = -(halfSpan + horizontalPadding);
    maxX = halfSpan + horizontalPadding;
  }

  const [minY, maxY] = verticalBounds ?? getVerticalBounds(traceLayout);

  return [
    [minX, minY - verticalPadding],
    [maxX, maxY + verticalPadding]
  ];
}

/**
 * Derives the vertical extent of the trace layout from its structural Y layout.
 */
export function getVerticalBounds(traceLayout: TraceLayout): [number, number] {
  return getTraceLayoutVerticalBounds(traceLayout);
}
