import {layoutLanes} from '../trace-layout/lane-layout';
import {
  buildTraceLayoutGeometryDerivationContext,
  fillTraceLayoutSpanGeometry
} from '../trace-layout/trace-derived-geometry';
import {createTraceColorResolver} from '../trace-style/trace-colors';
import {getPrimaryTiming} from './trace-types';
import {
  clamp,
  COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB,
  COLLAPSED_ACTIVITY_ICICLE_TOTAL_HEIGHT,
  COLLAPSED_ACTIVITY_MIN_WIDTH_MS,
  DEFAULT_COLLAPSED_ACTIVITY_ICICLE_BAND_COUNT,
  getCollapsedActivityStep,
  toRgb
} from './utils/collapsed-activity';
import {sliceMipmap} from './utils/slice-mipmap';

import type {TraceRenderSpan} from '../trace-graph-accessors';
import type {TraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import type {
  TraceLayout,
  TraceLayoutRow,
  TraceProcessActivityInterval
} from '../trace-layout/trace-layout';
import type {TraceColorScheme, TraceSpanColorSource} from '../trace-style/trace-color-scheme';
import type {TraceGraph} from './trace-graph';
import type {ProcessRef} from './trace-id-encoder';
import type {TraceThreadId, TraceVisSettings} from './trace-types';
import type {Slice} from './utils/slice-mipmap';

/** Process activity aggregation used for collapsed process overview summaries. */
export type TraceProcessActivityAggregation = 'density' | 'icicle';

/** Collapsed process activity intervals keyed by exact graph-local process refs. */
export type CollapsedActivityByProcessRef = ReadonlyMap<
  ProcessRef,
  readonly TraceProcessActivityInterval[]
>;

export type BuildTraceGraphCollapsedActivityOptions = {
  /** Aggregation algorithm used to build collapsed process activity summaries. */
  readonly aggregation?: TraceProcessActivityAggregation;
};

export type BuildCollapsedActivityByTraceGraphRowsParams = {
  /** Runtime TraceGraphData graph used to resolve visible spans after ingestion. */
  readonly graph: TraceGraph;
  /** Render rows whose visible process spans should be summarized. */
  readonly rows: readonly TraceLayoutRow[];
  /** Color scheme used to sample representative span colors. */
  readonly colorScheme: TraceColorScheme;
  /** Visualization settings that affect span coloring and summary density. */
  readonly settings: TraceVisSettings;
  /** Optional layout whose span geometry should drive icicle vertical bands. */
  readonly geometryLayout?: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for icicle aggregation. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional aggregation algorithm. Defaults to the legacy density summary. */
  readonly aggregation?: TraceProcessActivityAggregation;
};

/**
 * Builds collapsed-activity summaries from runtime TraceGraphData graph rows.
 */
export function buildCollapsedActivityByTraceGraphRows(
  params: BuildCollapsedActivityByTraceGraphRowsParams
): CollapsedActivityByProcessRef {
  const aggregation = params.aggregation ?? 'density';
  const intervalsByProcessRef = new Map<ProcessRef, readonly TraceProcessActivityInterval[]>();
  const defaultWindowEnd = Math.max(0, params.graph.maxTimeMs - params.graph.minTimeMs);
  const geometryContext =
    params.geometryContext ??
    (params.geometryLayout
      ? buildTraceLayoutGeometryDerivationContext(params.geometryLayout)
      : undefined);
  const colorResolver = createTraceColorResolver({
    colorScheme: params.colorScheme,
    settings: params.settings
  });

  for (const row of params.rows) {
    const spans = params.graph.getVisibleProcessDisplaySources(row.processRef);
    const spanColorMap = new Map<number, [number, number, number]>();
    spans.forEach((span, index) => {
      spanColorMap.set(
        index,
        toRgb(colorResolver.getSpanFillColor(span, 'any')) ?? [
          ...COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB
        ]
      );
    });

    const collapsedActivity =
      aggregation === 'icicle'
        ? buildIcicleCollapsedActivityForRow({
            spans,
            spanColorMap,
            geometryLayout: params.geometryLayout,
            geometryContext,
            minTimeMs: params.graph.minTimeMs,
            defaultWindowEnd
          })
        : buildDensityCollapsedActivityForRow({
            row,
            spans,
            spanColorMap,
            minTimeMs: params.graph.minTimeMs,
            defaultWindowEnd
          });
    intervalsByProcessRef.set(row.processRef, collapsedActivity.intervals);
  }

  return intervalsByProcessRef;
}

type CollapsedActivityBuildResult = {
  /** Collapsed process activity intervals ready for layout/rendering. */
  readonly intervals: TraceProcessActivityInterval[];
  /** Intermediate span slices used for build diagnostics. */
  readonly slices: Slice[];
  /** Number of density buckets or explicit icicle rectangles produced for the row. */
  readonly bucketCount: number;
};

/**
 * Builds the legacy density-based collapsed activity row for compatibility.
 */
function buildDensityCollapsedActivityForRow(params: {
  readonly row: TraceLayoutRow;
  readonly spans: readonly TraceRenderSpan[];
  /** Render colors keyed by visible span ref for dominant bucket color selection. */
  readonly spanColorMap: ReadonlyMap<number, [number, number, number]>;
  readonly minTimeMs: number;
  readonly defaultWindowEnd: number;
}): CollapsedActivityBuildResult {
  const streamDepthMap = new Map<TraceThreadId, number>();
  params.row.threads.forEach((thread, index) => {
    streamDepthMap.set(thread.threadId, index);
  });
  const {slices, windowEnd} = buildCollapsedActivitySlices({
    spans: params.spans,
    minTimeMs: params.minTimeMs,
    defaultWindowEnd: params.defaultWindowEnd,
    getDepth: span => streamDepthMap.get(span.threadId) ?? 0
  });
  const windowStart = 0;
  if (slices.length === 0 || !(windowEnd > windowStart)) {
    return {
      intervals: [],
      slices,
      bucketCount: 0
    };
  }

  const step = getCollapsedActivityStep(windowEnd - windowStart, streamDepthMap.size || 1);
  const rows = sliceMipmap(slices, windowStart, windowEnd, step, {
    includeOverlappingPrev: true,
    perfettoOverlapHeuristic: false,
    sortOutput: true
  });

  const bucketSummary = new Map<
    number,
    {
      bucketStart: number;
      bucketEnd: number;
      sampleCount: number;
      depthCount: number;
      dominantWeight: number;
      dominantColor: [number, number, number];
    }
  >();
  for (const row of rows) {
    const rowColor = params.spanColorMap.get(row.id) ?? [...COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB];
    const rowWeight = Math.max(0, row.sampleCount);
    const existing = bucketSummary.get(row.bucketIndex);
    if (!existing) {
      bucketSummary.set(row.bucketIndex, {
        bucketStart: row.bucketStart,
        bucketEnd: row.bucketEnd,
        sampleCount: Math.max(0, row.sampleCount),
        depthCount: 1,
        dominantWeight: rowWeight,
        dominantColor: rowColor
      });
      continue;
    }
    existing.sampleCount += Math.max(0, row.sampleCount);
    existing.depthCount += 1;
    if (rowWeight > existing.dominantWeight) {
      existing.dominantWeight = rowWeight;
      existing.dominantColor = rowColor;
    }
  }

  const intervals = [...bucketSummary.values()]
    .sort((a, b) => a.bucketStart - b.bucketStart)
    .reduce<TraceProcessActivityInterval[]>((next, bucket) => {
      const startX = clamp(bucket.bucketStart, windowStart, windowEnd);
      const endX = clamp(
        Math.max(bucket.bucketEnd, startX + COLLAPSED_ACTIVITY_MIN_WIDTH_MS),
        windowStart,
        windowEnd
      );
      if (!(endX > startX)) {
        return next;
      }
      next.push({
        startX,
        endX,
        activity: Math.max(1, bucket.sampleCount, bucket.depthCount),
        color: bucket.dominantColor
      });
      return next;
    }, []);

  return {
    intervals,
    slices,
    bucketCount: bucketSummary.size
  };
}

/**
 * Builds compact icicle-like collapsed activity rectangles from visible span timing and lanes.
 */
function buildIcicleCollapsedActivityForRow(params: {
  /** Visible spans summarized by the current process row. */
  readonly spans: readonly TraceRenderSpan[];
  /** Render colors keyed by visible span ref for icicle rectangle color selection. */
  readonly spanColorMap: ReadonlyMap<number, [number, number, number]>;
  /** Optional layout whose span lane state drives icicle vertical bands. */
  readonly geometryLayout?: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for icicle aggregation. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Trace-local minimum time used by activity slicing. */
  readonly minTimeMs: number;
  /** Trace-local fallback activity window end. */
  readonly defaultWindowEnd: number;
}): CollapsedActivityBuildResult {
  const bandCount = DEFAULT_COLLAPSED_ACTIVITY_ICICLE_BAND_COUNT;
  const bandHeight = COLLAPSED_ACTIVITY_ICICLE_TOTAL_HEIGHT / bandCount;
  const spanBandMap = buildIcicleBandMap({
    spans: params.spans,
    geometryLayout: params.geometryLayout,
    geometryContext: params.geometryContext,
    bandCount
  });
  const {slices, windowEnd} = buildCollapsedActivitySlices({
    spans: params.spans,
    minTimeMs: params.minTimeMs,
    defaultWindowEnd: params.defaultWindowEnd,
    getDepth: (_span, index) => spanBandMap.get(index) ?? 0
  });
  const windowStart = 0;
  if (slices.length === 0 || !(windowEnd > windowStart)) {
    return {
      intervals: [],
      slices,
      bucketCount: 0
    };
  }

  const intervals = slices
    .map<TraceProcessActivityInterval | null>(slice => {
      const startX = clamp(slice.ts, windowStart, windowEnd);
      const endX = clamp(
        Math.max(slice.ts + slice.dur, startX + COLLAPSED_ACTIVITY_MIN_WIDTH_MS),
        windowStart,
        windowEnd
      );
      if (!(endX > startX)) {
        return null;
      }
      return {
        startX,
        endX,
        activity: 1,
        color: params.spanColorMap.get(slice.id) ?? [...COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB],
        yOffset: slice.depth * bandHeight,
        height: bandHeight
      } satisfies TraceProcessActivityInterval;
    })
    .filter((interval): interval is TraceProcessActivityInterval => Boolean(interval))
    .sort(
      (left, right) =>
        (left.yOffset ?? 0) - (right.yOffset ?? 0) ||
        left.startX - right.startX ||
        compareCollapsedActivityColors(left.color, right.color)
    )
    .reduce<TraceProcessActivityInterval[]>((next, interval) => {
      const previous = next[next.length - 1];
      if (
        previous &&
        previous.yOffset === interval.yOffset &&
        previous.height === interval.height &&
        previous.endX >= interval.startX - COLLAPSED_ACTIVITY_MIN_WIDTH_MS &&
        colorsAreEqual(previous.color, interval.color)
      ) {
        next[next.length - 1] = {
          ...previous,
          endX: Math.max(previous.endX, interval.endX),
          activity: previous.activity + interval.activity
        };
        return next;
      }
      next.push(interval);
      return next;
    }, []);

  return {
    intervals,
    slices,
    bucketCount: intervals.length
  };
}

/**
 * Converts visible spans into time slices with caller-provided vertical depth assignment.
 */
function buildCollapsedActivitySlices(params: {
  readonly spans: readonly TraceSpanColorSource[];
  readonly minTimeMs: number;
  readonly defaultWindowEnd: number;
  readonly getDepth: (span: TraceSpanColorSource, index: number) => number;
}): {slices: Slice[]; windowEnd: number} {
  let maxSliceEnd = 0;
  const slices = params.spans
    .map((span, index) => {
      const timing = getPrimaryTiming(span);
      if (!Number.isFinite(timing.startTimeMs) || !Number.isFinite(timing.endTimeMs)) {
        return null;
      }
      const ts = Math.min(timing.startTimeMs, timing.endTimeMs) - params.minTimeMs;
      const end = Math.max(timing.startTimeMs, timing.endTimeMs) - params.minTimeMs;
      if (!Number.isFinite(ts) || !Number.isFinite(end)) {
        return null;
      }
      const dur = Math.max(COLLAPSED_ACTIVITY_MIN_WIDTH_MS, end - ts);
      maxSliceEnd = Math.max(maxSliceEnd, ts + dur);
      return {
        id: index,
        ts,
        dur,
        depth: params.getDepth(span, index)
      } satisfies Slice;
    })
    .filter((slice): slice is Slice => Boolean(slice));
  return {
    slices,
    windowEnd: Math.max(params.defaultWindowEnd, maxSliceEnd)
  };
}

/**
 * Resolves a compact visual icicle band for each visible span in a process row.
 */
function buildIcicleBandMap(params: {
  /** Visible spans summarized by the current process row. */
  readonly spans: readonly TraceRenderSpan[];
  /** Optional layout whose span lane state drives icicle vertical bands. */
  readonly geometryLayout?: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for icicle aggregation. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Number of compact icicle bands available for the summary. */
  readonly bandCount: number;
}): ReadonlyMap<number, number> {
  const geometryBandMap = buildGeometryIcicleBandMap(params);
  if (geometryBandMap) {
    return geometryBandMap;
  }

  const laneAssignments = layoutLanes(params.spans);
  return buildCompactBandMapFromAssignments(
    laneAssignments.map(({lane}, index) => ({index, value: lane})),
    params.bandCount
  );
}

/**
 * Resolves compact visual icicle bands from current timing and lane state when available.
 */
function buildGeometryIcicleBandMap(params: {
  /** Visible spans summarized by the current process row. */
  readonly spans: readonly TraceRenderSpan[];
  /** Optional layout whose span lane state drives icicle vertical bands. */
  readonly geometryLayout?: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for icicle aggregation. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Number of compact icicle bands available for the summary. */
  readonly bandCount: number;
}): ReadonlyMap<number, number> | null {
  const geometryLayout = params.geometryLayout;
  if (!geometryLayout) {
    return null;
  }

  const centers: Array<{index: number; y: number}> = [];
  const geometryScratch = {x1: 0, y1: 0, x2: 0, y2: 0};
  params.spans.forEach((span, index) => {
    if (
      !fillTraceLayoutSpanGeometry({
        traceLayout: geometryLayout,
        spanRef: span.spanRef,
        target: geometryScratch,
        context: params.geometryContext
      })
    ) {
      return;
    }
    const y0 = geometryScratch.y1;
    const y1 = geometryScratch.y2;
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
      return;
    }
    const centerY = (y0 + y1) / 2;
    centers.push({index, y: centerY});
  });

  if (centers.length === 0) {
    return null;
  }

  return buildCompactBandMapFromAssignments(
    centers.map(({index, y}) => ({index, value: y})),
    params.bandCount
  );
}

/**
 * Packs occupied source lanes into adjacent output bands before quantizing large lane counts.
 */
function buildCompactBandMapFromAssignments(
  assignments: ReadonlyArray<{readonly index: number; readonly value: number}>,
  bandCount: number
): ReadonlyMap<number, number> {
  const finiteAssignments = assignments.filter(({value}) => Number.isFinite(value));
  const sortedValues = [...new Set(finiteAssignments.map(({value}) => value))].sort(
    (left, right) => left - right
  );
  const sourceLaneToBand = new Map<number, number>();
  sortedValues.forEach((value, ordinal) => {
    sourceLaneToBand.set(value, compactOrdinalToBand(ordinal, sortedValues.length, bandCount));
  });

  const result = new Map<number, number>();
  finiteAssignments.forEach(({index, value}) => {
    result.set(index, sourceLaneToBand.get(value) ?? 0);
  });
  return result;
}

/**
 * Maps an occupied lane ordinal into a compact output band.
 */
function compactOrdinalToBand(
  ordinal: number,
  occupiedLaneCount: number,
  bandCount: number
): number {
  if (occupiedLaneCount <= 1 || bandCount <= 1) {
    return 0;
  }
  if (occupiedLaneCount <= bandCount) {
    return ordinal;
  }
  return Math.min(bandCount - 1, Math.floor((ordinal * bandCount) / occupiedLaneCount));
}

/**
 * Sorts collapsed activity colors deterministically for stable interval coalescing.
 */
function compareCollapsedActivityColors(
  left: Readonly<[number, number, number]> | undefined,
  right: Readonly<[number, number, number]> | undefined
): number {
  return (
    (left?.[0] ?? 0) - (right?.[0] ?? 0) ||
    (left?.[1] ?? 0) - (right?.[1] ?? 0) ||
    (left?.[2] ?? 0) - (right?.[2] ?? 0)
  );
}

/**
 * Checks whether two collapsed activity colors are the same RGB triplet.
 */
function colorsAreEqual(
  left: Readonly<[number, number, number]> | undefined,
  right: Readonly<[number, number, number]> | undefined
): boolean {
  return left?.[0] === right?.[0] && left?.[1] === right?.[1] && left?.[2] === right?.[2];
}
