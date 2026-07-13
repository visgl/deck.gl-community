import {Matrix4} from '@math.gl/core';

import {traceDependencyKeywordFlagsHasSubmit} from '../ingestion/trace-dependency-arrow-fields';
import {getHeapUsageProbeFields, log as traceLog} from '../log';
import {getActiveTraceGraphSpanStoreRow} from '../trace-graph-accessors';
import {buildCollapsedActivityByTraceGraphRows} from '../trace-graph/collapsed-activity';
import {
  encodeLocalSpanRef,
  encodeSameProcessDependencyRef,
  getProcessRefIndex
} from '../trace-graph/trace-id-encoder';
import {
  clamp,
  COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB,
  COLLAPSED_ACTIVITY_MIN_WIDTH_MS,
  getCollapsedActivityStep,
  toRgb
} from '../trace-graph/utils/collapsed-activity';
import {shouldShowSameProcessDependencyByModeFields} from '../trace-layout/same-process-dependency-filter';
import {
  buildTraceLayoutGeometryDerivationContext,
  fillTraceLayoutSpanGeometry
} from '../trace-layout/trace-derived-geometry';
import {
  getLaneIndexFromUserData,
  getLaneYPosition,
  getLayoutDensityPreset,
  isLaneVisible
} from '../trace-layout/trace-geometry-layout-common';
import {
  buildTraceLayoutRowOverflowLabels,
  getTraceLayoutProcessLayoutByRef
} from '../trace-layout/trace-layout';
import {DEFAULT_TRACE_COLOR_SCHEME} from '../trace-style/trace-color-scheme';
import {
  createTraceGraphColorResolver,
  getTraceThreadColor,
  TRACE_COLOR
} from '../trace-style/trace-colors';
import {getTraceViewChunkFilterMask} from '../trace-view-snapshot';
import {buildTraceArrowPrimaryEndpointPages} from './trace-arrow-endpoint-pages';
import {
  buildTraceDeckBinaryBlockData,
  buildTraceDeckBinaryCrossProcessDependencyLineData,
  buildTraceDeckBinaryDependencyLineData
} from './trace-deck-binary-data';
import {
  buildTraceOverviewBounds,
  buildTraceOverviewLoadedContentBounds
} from './trace-prepared-scene-paths';
import {estimateArrayOwnBytes, estimatePreparedLayoutInputsSize} from './trace-prepared-scene-size';
import {
  buildTraceDenseSameProcessDependencyRefSource,
  buildTraceDenseSpanRefSource,
  buildTraceVisibleCrossProcessDependencyRefSource
} from './trace-ref-source';
import {getTraceSelectedSpanFromRef} from './trace-view-selection';

import type {
  TraceCounterSource,
  TraceEventSource,
  TraceInstantSource
} from '../trace-graph-accessors';
import type {
  CollapsedActivityByProcessRef,
  TraceProcessActivityAggregation
} from '../trace-graph/collapsed-activity';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  TraceGraphPathBlockSource,
  TraceGraphPathDependencySource
} from '../trace-graph/trace-graph-types';
import type {
  CounterRef,
  EventRef,
  InstantRef,
  ProcessRef,
  SameProcessDependencyRef,
  ThreadRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceProcessId, TraceThread} from '../trace-graph/trace-types';
import type {TraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import type {
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutOverflowLabelDatum,
  TraceLayoutRow,
  TraceProcessActivityInterval
} from '../trace-layout/trace-layout';
import type {TraceColorScheme, TraceDeckColor} from '../trace-style/trace-color-scheme';
import type {TraceArrowPrimaryEndpointPages} from './trace-arrow-endpoint-pages';
import type {
  TraceDeckBinaryAttributeData,
  TraceDeckBinaryBlockData,
  TraceDeckBinaryCrossProcessDependencyLineData,
  TraceDeckBinaryDependencyLineData
} from './trace-deck-binary-data';
import type {TracePreparedRenderDataSizeContext} from './trace-prepared-scene-size';
import type {
  TraceCrossProcessDependencyRefSource,
  TraceSameProcessDependencyRefSource,
  TraceSpanRefSource
} from './trace-ref-source';

export const DEFAULT_INSTANT_COLOR: TraceDeckColor = [94, 234, 212, 220];
export const DEFAULT_COUNTER_COLOR: TraceDeckColor = [251, 191, 36, 220];
const PROCESS_ACTIVITY_SUMMARY_ROW_MARGIN_FRACTION = 0.12;
const EMPTY_TRACE_PREPARED_ROW_SPAN_REFS: TraceSpanRefSource = [];
const EMPTY_TRACE_PREPARED_ROW_DEPENDENCY_REFS: TraceSameProcessDependencyRefSource = [];
const EMPTY_TRACE_PREPARED_CROSS_PROCESS_DEPENDENCY_REFS: TraceCrossProcessDependencyRefSource = [];

/** deck.gl binary payload for process activity summary rectangles. */
export type TraceDeckBinaryProcessActivityData = {
  /** Binary attribute payload passed to the process activity summary block layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Process rows keyed by process row index for picking and debug access. */
  readonly processRows: readonly TraceLayoutRow[];
  /** Process row indices keyed by binary row index for picking and debug access. */
  readonly processRowIndices: Uint32Array;
};

export type CounterSparkline = {
  readonly path: readonly [number, number, number][];
  readonly color: TraceDeckColor;
};

export type InstantRenderData = {
  readonly visibleInstants: readonly TraceInstantSource[];
  readonly positionMap: ReadonlyMap<InstantRef, [number, number, number]>;
  readonly colorMap: ReadonlyMap<InstantRef, TraceDeckColor>;
};

export type CounterRenderData = {
  readonly counterPoints: readonly TraceCounterSource[];
  readonly positionMap: ReadonlyMap<CounterRef, [number, number, number]>;
  readonly colorMap: ReadonlyMap<CounterRef, TraceDeckColor>;
  readonly sparklineData: readonly CounterSparkline[];
};

export type GlobalEventRenderData = {
  readonly visibleEvents: readonly TraceEventSource[];
  readonly positionMap: ReadonlyMap<EventRef, [number, number, number]>;
  readonly colorMap: ReadonlyMap<EventRef, TraceDeckColor>;
};

export type TraceLayoutRowEnrichment = {
  /** References the stable layout row metadata being enriched. */
  readonly row: TraceLayoutRow;
  /** Stores collapsed-activity samples associated with the row. */
  readonly collapsedActivityIntervals: readonly TraceProcessActivityInterval[];
  /** Carries precomputed overflow/filter labels ready for rendering. */
  readonly overflowLabels: readonly TraceLayoutOverflowLabelDatum[];
};

/**
 * Builds binary block attributes for process activity summary rectangles.
 */
export function buildTraceDeckBinaryProcessActivityData(params: {
  /** Process rows whose collapsed activity intervals should be projected. */
  readonly rows: readonly TracePreparedProcessRow[];
  /** Layout containing process row geometry for the activity bands. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Active visualization settings used for density spacing. */
  readonly settings: Pick<TraceVisSettings, 'layoutDensity'>;
}): TraceDeckBinaryProcessActivityData {
  const layoutDensity = getLayoutDensityPreset(params.settings.layoutDensity);
  const intervals: TraceProcessActivityInterval[] = [];
  const processRows = params.rows.map(({row}) => row);
  const processRowIndices: number[] = [];
  const rowBandByInterval: {readonly y: number; readonly height: number}[] = [];

  for (const [processRowIndex, row] of params.rows.entries()) {
    const rankLayout = getTraceLayoutProcessLayoutByRef(params.traceLayout, row.row.processRef);
    if (!rankLayout || row.collapsedActivityIntervals.length === 0) {
      continue;
    }
    const compactRowHeight = Math.max(layoutDensity.laneSeparation, layoutDensity.spanHeight * 1.5);
    const rowMargin = Math.max(
      layoutDensity.spanHeight * 0.25,
      compactRowHeight * PROCESS_ACTIVITY_SUMMARY_ROW_MARGIN_FRACTION
    );
    const height = Math.max(layoutDensity.spanHeight, compactRowHeight - rowMargin * 2);
    const originY = rankLayout.yOffset + layoutDensity.overviewTopGap + rowMargin;
    for (const interval of row.collapsedActivityIntervals) {
      intervals.push(interval);
      processRowIndices.push(processRowIndex);
      rowBandByInterval.push({
        y: originY,
        height
      });
    }
  }

  const positions = new Float32Array(intervals.length * 3);
  const sizes = new Float32Array(intervals.length * 2);
  const fillColors = new Uint8Array(intervals.length * 4);
  const lineColors = new Uint8Array(intervals.length * 4);

  intervals.forEach((interval, index) => {
    const rowBand = rowBandByInterval[index];
    const x = interval.startX;
    const y = rowBand?.y ?? 0;
    const width = Math.max(0, interval.endX - interval.startX);
    const height = Math.max(0, rowBand?.height ?? interval.height ?? layoutDensity.spanHeight);
    const color = interval.color ?? [54, 54, 54];
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = 0;
    sizes[index * 2] = width;
    sizes[index * 2 + 1] = height;
    fillColors[index * 4] = color[0] ?? 54;
    fillColors[index * 4 + 1] = color[1] ?? 54;
    fillColors[index * 4 + 2] = color[2] ?? 54;
    fillColors[index * 4 + 3] = 220;
    lineColors[index * 4] = color[0] ?? 54;
    lineColors[index * 4 + 1] = color[1] ?? 54;
    lineColors[index * 4 + 2] = color[2] ?? 54;
    lineColors[index * 4 + 3] = 0;
  });

  return {
    data: {
      length: intervals.length,
      attributes: {
        getPosition: {value: positions, size: 3},
        getSize: {value: sizes, size: 2},
        getFillColor: {value: fillColors, size: 4},
        getLineColor: {value: lineColors, size: 4}
      }
    },
    processRows,
    processRowIndices: Uint32Array.from(processRowIndices)
  };
}

export type DerivedTraceData = {
  readonly globalEvents: GlobalEventRenderData;
  readonly instants: InstantRenderData;
  readonly counters: CounterRenderData;
};

const EMPTY_COLLAPSED_ACTIVITY_BY_PROCESS_REF = new Map() as CollapsedActivityByProcessRef;
const EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS = Object.freeze(
  []
) as readonly TraceProcessActivityInterval[];
const EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS = Object.freeze(
  []
) as readonly TraceLayoutOverflowLabelDatum[];

function toDeckColor(color: unknown, fallback: TraceDeckColor): TraceDeckColor {
  if (Array.isArray(color) && color.length >= 3) {
    const [r, g, b, a] = color as number[];
    return [
      Number.isFinite(r) ? (r as number) : fallback[0],
      Number.isFinite(g) ? (g as number) : fallback[1],
      Number.isFinite(b) ? (b as number) : fallback[2],
      Number.isFinite(a) ? (a as number) : fallback[3]
    ];
  }
  return fallback;
}

/** Returns the effective dependency opacity multiplier after path-only dimming. */
const EMPTY_INSTANT_RENDER_DATA: InstantRenderData = {
  visibleInstants: [],
  positionMap: new Map(),
  colorMap: new Map()
};

const EMPTY_COUNTER_RENDER_DATA: CounterRenderData = {
  counterPoints: [],
  positionMap: new Map(),
  colorMap: new Map(),
  sparklineData: []
};

const EMPTY_GLOBAL_EVENT_RENDER_DATA: GlobalEventRenderData = {
  visibleEvents: [],
  positionMap: new Map(),
  colorMap: new Map()
};

function getThreadColorInput(params: {
  traceGraph: Readonly<TraceGraph>;
  threadRef: ThreadRef;
}): TraceThread | undefined {
  const thread = params.traceGraph.getThreadSourceByRef(params.threadRef);
  if (!thread) {
    return undefined;
  }
  return {
    type: 'trace-thread',
    threadId: String(thread.threadRef) as TraceThread['threadId'],
    processId: String(thread.processRef) as TraceThread['processId'],
    name: thread.name,
    userData: thread.userData
  };
}

function buildGlobalEventRenderData({
  traceGraph,
  traceLayout,
  yPosition
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  yPosition?: number;
}): GlobalEventRenderData {
  const eventRow = traceLayout.globalEventRow;
  const eventY = Number.isFinite(yPosition) ? yPosition : eventRow?.yPosition;
  if (!Number.isFinite(eventY) || traceGraph.events.numRows === 0) {
    return EMPTY_GLOBAL_EVENT_RENDER_DATA;
  }

  const positionMap = new Map<EventRef, [number, number, number]>();
  const colorMap = new Map<EventRef, TraceDeckColor>();
  const visibleEvents: TraceEventSource[] = [];
  const defaultColor: TraceDeckColor = [250, 204, 21, 230];

  for (const event of traceGraph.getEventSources()) {
    if (!Number.isFinite(event.atTimeMs)) {
      continue;
    }
    const x = event.atTimeMs - traceGraph.minTimeMs;
    positionMap.set(event.eventRef, [x, eventY!, 0]);
    colorMap.set(event.eventRef, toDeckColor(event.userData?.color, defaultColor));
    visibleEvents.push(event);
  }

  visibleEvents.sort((left, right) => left.atTimeMs - right.atTimeMs);
  return {
    visibleEvents,
    positionMap,
    colorMap
  };
}

function buildInstantRenderData({
  traceGraph,
  traceLayout,
  colorScheme
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  colorScheme: TraceColorScheme;
}): InstantRenderData {
  const positionMap = new Map<InstantRef, [number, number, number]>();
  const colorMap = new Map<InstantRef, TraceDeckColor>();
  const visibleInstants: TraceInstantSource[] = [];

  traceGraph.getThreadRefs().forEach(threadRef => {
    const instants = traceGraph.getInstantSourcesByThreadRef(threadRef);
    const streamLayout = traceLayout.threadLayoutMapByRef.get(threadRef);
    if (!streamLayout?.visible || instants.length === 0) {
      return;
    }

    const sortedInstants = [...instants].sort((a, b) => a.atTimeMs - b.atTimeMs);
    const thread = getThreadColorInput({traceGraph, threadRef});
    const streamColorSource =
      getTraceThreadColor(thread ?? undefined, colorScheme) ??
      toDeckColor(thread?.userData?.color, DEFAULT_INSTANT_COLOR);
    const streamColor = [...streamColorSource] as TraceDeckColor;

    sortedInstants.forEach(instant => {
      const x = (instant.atTimeMs ?? traceGraph.minTimeMs) - traceGraph.minTimeMs;
      const laneIndex = getLaneIndexFromUserData(instant.userData as {lane?: number} | undefined);
      if (!isLaneVisible(streamLayout, laneIndex)) {
        return;
      }
      const y = getLaneYPosition(streamLayout, laneIndex);
      const position: [number, number, number] = [x, y, 0];
      positionMap.set(instant.instantRef, position);
      const color = toDeckColor(instant.userData?.color, streamColor);
      colorMap.set(instant.instantRef, color);
      visibleInstants.push(instant);
    });
  });

  return {
    visibleInstants,
    positionMap,
    colorMap
  };
}

function buildCounterRenderData({
  traceGraph,
  traceLayout,
  colorScheme
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  colorScheme: TraceColorScheme;
}): CounterRenderData {
  const positionMap = new Map<CounterRef, [number, number, number]>();
  const colorMap = new Map<CounterRef, TraceDeckColor>();
  const sparklineData: CounterSparkline[] = [];
  const counterPoints: TraceCounterSource[] = [];

  traceGraph.getThreadRefs().forEach(threadRef => {
    const counters = traceGraph.getCounterSourcesByThreadRef(threadRef);
    const streamLayout = traceLayout.threadLayoutMapByRef.get(threadRef);
    if (!streamLayout?.visible || counters.length === 0) {
      return;
    }

    const sortedCounters = [...counters].sort((a, b) => a.atTimeMs - b.atTimeMs);
    const extent = traceGraph.getCounterExtentByThreadRef(threadRef);
    const span = extent.max - extent.min;
    const thread = getThreadColorInput({traceGraph, threadRef});
    const baseColorSource =
      getTraceThreadColor(thread ?? undefined, colorScheme) ??
      toDeckColor(thread?.userData?.counterColor, DEFAULT_COUNTER_COLOR);
    const baseColor = [...baseColorSource] as TraceDeckColor;
    const path: [number, number, number][] = [];
    const amplitude = 0.3;

    sortedCounters.forEach(counter => {
      const normalized = span > 0 ? (counter.totalValue - extent.min) / span : 0.5;
      const ratio = Number.isFinite(normalized) ? normalized : 0.5;
      const laneIndex = getLaneIndexFromUserData(counter.userData as {lane?: number} | undefined);
      if (!isLaneVisible(streamLayout, laneIndex)) {
        return;
      }
      const laneBaseline = getLaneYPosition(streamLayout, laneIndex) + 0.45;
      const y = laneBaseline + (ratio - 0.5) * amplitude;
      const x = (counter.atTimeMs ?? traceGraph.minTimeMs) - traceGraph.minTimeMs;
      const position: [number, number, number] = [x, y, 0];
      positionMap.set(counter.counterRef, position);
      const color = toDeckColor(counter.userData?.color, baseColor);
      colorMap.set(counter.counterRef, color);
      path.push(position);
      counterPoints.push(counter);
    });

    if (path.length >= 2) {
      const lastCounter = sortedCounters[sortedCounters.length - 1];
      const color = toDeckColor(lastCounter?.userData?.color, baseColor);
      sparklineData.push({path, color});
    }
  });

  return {
    counterPoints,
    positionMap,
    colorMap,
    sparklineData
  };
}

/** Builds derived event, instant, and counter render data without retained caches. */
export function buildDerivedTraceData(params: {
  /** Trace graph whose event, instant, and counter rows are projected. */
  traceGraph: Readonly<TraceGraph>;
  /** Trace layout that supplies visible thread positions and event-row placement. */
  traceLayout: Readonly<TraceLayout>;
  /** Theme-owned colors used for instant and counter projections. */
  colorScheme?: TraceColorScheme;
  /** Whether graph-global event marker data should be projected. */
  buildGlobalEvents?: boolean;
  /** Whether instant marker data should be projected. */
  buildInstants?: boolean;
  /** Whether counter point and sparkline data should be projected. */
  buildCounters?: boolean;
  /** Optional fixed trace-space Y position for graph-global event markers. */
  globalEventYPosition?: number;
}): DerivedTraceData {
  const {
    traceGraph,
    traceLayout,
    colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
    buildGlobalEvents = true,
    buildInstants = true,
    buildCounters = true,
    globalEventYPosition
  } = params;
  const buildStartTime = performance.now();
  const globalEventsStartTime = performance.now();
  const globalEvents = buildGlobalEvents
    ? buildGlobalEventRenderData({traceGraph, traceLayout, yPosition: globalEventYPosition})
    : EMPTY_GLOBAL_EVENT_RENDER_DATA;
  const globalEventsDurationMs = performance.now() - globalEventsStartTime;
  const instantsStartTime = performance.now();
  const instants = buildInstants
    ? buildInstantRenderData({traceGraph, traceLayout, colorScheme})
    : EMPTY_INSTANT_RENDER_DATA;
  const instantsDurationMs = performance.now() - instantsStartTime;
  const countersStartTime = performance.now();
  const counters = buildCounters
    ? buildCounterRenderData({traceGraph, traceLayout, colorScheme})
    : EMPTY_COUNTER_RENDER_DATA;
  const countersDurationMs = performance.now() - countersStartTime;

  const derived: DerivedTraceData = {
    globalEvents,
    instants,
    counters
  };
  traceLog.probe(1, 'TraceGraph derived render data done', {
    buildGlobalEvents,
    buildInstants,
    buildCounters,
    globalEventCount: globalEvents.visibleEvents.length,
    instantCount: instants.visibleInstants.length,
    counterPointCount: counters.counterPoints.length,
    counterSparklineCount: counters.sparklineData.length,
    rowCount: traceLayout.renderRows.length,
    globalEventsDurationMs,
    instantsDurationMs,
    countersDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return derived;
}

/**
 * Builds row-level render enrichments without using the compatibility WeakMap cache.
 */
export function buildTraceLayoutRowEnrichments(params: {
  /** Layout whose render rows should be enriched for deck/render inputs. */
  traceLayout: Readonly<TraceLayout>;
  /** Optional collapsed activity samples keyed by exact graph-local process refs. */
  collapsedActivityByProcessRef?: CollapsedActivityByProcessRef;
  /** Optional batch-scoped direct geometry lookup state for overflow labels. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
}): readonly TraceLayoutRowEnrichment[] {
  const {traceLayout} = params;
  const collapsedActivityByProcessRef =
    params.collapsedActivityByProcessRef ?? EMPTY_COLLAPSED_ACTIVITY_BY_PROCESS_REF;
  const buildStartTime = performance.now();
  let collapsedActivitySortDurationMs = 0;
  let overflowLabelDurationMs = 0;
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(traceLayout);
  const enrichments = traceLayout.renderRows.map(row => {
    const collapsedActivitySortStartTime = performance.now();
    const collapsedActivitySource = collapsedActivityByProcessRef.get(row.processRef);
    const collapsedActivityIntervals =
      collapsedActivitySource && collapsedActivitySource.length > 0
        ? [...collapsedActivitySource].sort((left, right) => left.startX - right.startX)
        : EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS;
    collapsedActivitySortDurationMs += performance.now() - collapsedActivitySortStartTime;
    const overflowLabelStartTime = performance.now();
    const builtOverflowLabels = buildTraceLayoutRowOverflowLabels({
      traceLayout,
      row,
      geometryContext
    });
    const overflowLabels =
      builtOverflowLabels.length > 0 ? builtOverflowLabels : EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS;
    overflowLabelDurationMs += performance.now() - overflowLabelStartTime;
    return {
      row,
      collapsedActivityIntervals,
      overflowLabels
    } satisfies TraceLayoutRowEnrichment;
  });

  traceLog.probe(1, 'TraceGraph trace layout row enrichments done', {
    rowCount: enrichments.length,
    collapsedActivityProcessCount: collapsedActivityByProcessRef.size,
    collapsedActivitySortDurationMs,
    overflowLabelDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return enrichments;
}

/** Two-dimensional trace view bounds expressed as lower-left and upper-right coordinate pairs. */
export type TraceViewBounds = [[number, number], [number, number]];

/** Row-level prepared graph-scene data that renderers consume without querying TraceGraph. */
type TracePreparedRowInputBase = {
  /** References the lightweight prepared layout row metadata. */
  readonly row: TraceLayoutRow;
  /** Binary block attributes and their row-indexed span refs. */
  readonly binaryBlockData?: TraceDeckBinaryBlockData;
  /** Binary straight-line dependency attributes and their row-indexed refs. */
  readonly binaryDependencyLineData?: TraceDeckBinaryDependencyLineData;
  /** Stores collapsed-activity samples associated with the row. */
  readonly collapsedActivityIntervals: readonly TraceProcessActivityInterval[];
  /** Stores precomputed overflow/filter labels associated with the row. */
  readonly overflowLabels: readonly TraceLayoutOverflowLabelDatum[];
};

/** Minimap indicator kind used to style persistent selection separately from transient hover. */
export type TracePreparedMinimapSpanIndicatorKind = 'selected' | 'hovered';

/** Preprojected selected or hovered span marker rendered in minimap coordinates. */
export type TracePreparedMinimapSpanIndicator = {
  /** Whether the marker represents a persistent selection or transient hover. */
  readonly kind: TracePreparedMinimapSpanIndicatorKind;
  /** X position in minimap-local coordinates. */
  readonly x: number;
  /** Left X edge of the represented span in minimap-local coordinates. */
  readonly startX: number;
  /** Right X edge of the represented span in minimap-local coordinates. */
  readonly endX: number;
  /** Y position in minimap-local coordinates before any minimap activity model transform. */
  readonly y: number;
  /** Optional marker line override. */
  readonly lineColor?: readonly [number, number, number, number];
};

const EMPTY_TRACE_PREPARED_MINIMAP_SPAN_INDICATORS = Object.freeze(
  []
) as readonly TracePreparedMinimapSpanIndicator[];

/** Normalized transform applied to secondary trace graphs in comparison mode. */
export type TraceComparisonTransform = {
  /** Horizontal translation in trace layout coordinates, which are milliseconds. */
  readonly translation: number;
  /** Horizontal scale factor applied to secondary trace geometry. */
  readonly scale: number;
};

/**
 * Builds the model matrix that positions a secondary graph in comparison mode.
 */
export function createTraceComparisonModelMatrix(offsetMs?: number, scale?: number): Matrix4 {
  const {translation, scale: normalizedScale} = getTraceComparisonTransformParams(offsetMs, scale);
  const matrix = new Matrix4().identity();
  matrix.translate([translation, 0, 0]);
  matrix.scale([normalizedScale, 1, 1]);
  return matrix;
}

/** Row-level display input projected from TraceLayout rows and TraceGraph-visible data. */
export type TracePreparedProcessRow = TracePreparedRowInputBase;

/** Layout-level prepared graph scene projected from one TraceLayout. */
export type TracePreparedGraphScene = {
  /** Trace layout whose rows and geometry back the prepared deck inputs. */
  readonly layout: TraceLayout;
  /** Row-aligned process inputs already projected from TraceGraph and TraceLayout. */
  readonly rows: readonly TracePreparedProcessRow[];
  /** Optional binary process activity summary used by lightweight overview renderers. */
  readonly processActivitySummaryData?: TraceDeckBinaryProcessActivityData;
  /** Ref-native visible cross-process dependency rows for this graph. */
  readonly crossProcessDependencyRefs: TraceCrossProcessDependencyRefSource;
  /** Optional binary straight-line payload for visible cross-process dependencies. */
  readonly binaryCrossProcessDependencyLineData?: TraceDeckBinaryCrossProcessDependencyLineData;
  /** Optional deck layer id prefix for compare/minimap variants. */
  readonly layerIdPrefix?: string;
  /** Optional model matrix that positions this graph relative to the primary graph. */
  readonly modelMatrix?: Matrix4;
  /** Optional per-rank background color passed through to compatibility layer builders. */
  readonly rankBackgroundColor?: readonly [number, number, number, number];
  /** Selected and hovered span indicators preprojected into minimap layout coordinates. */
  readonly minimapSpanIndicators: readonly TracePreparedMinimapSpanIndicator[];
};

/** Path highlight data projected from trace/layout state. */
export type TracePreparedPathData = {
  /** Critical-path block sources already projected from the primary TraceGraph. */
  readonly pathBlockSources: readonly TraceGraphPathBlockSource[];
  /** Critical-path dependency sources already filtered by same-process dependency mode. */
  readonly pathDependencySources: readonly TraceGraphPathDependencySource[];
};

/** Parameters for decorating overview scenes with transient selection overlay inputs. */
export type BuildTraceSelectionOverviewScenesParams = {
  /** Prepared overview graph scenes to decorate. */
  readonly overviewScenes: readonly TracePreparedGraphScene[];
  /** Source trace graphs aligned with prepared overview scenes. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Trace visualization settings used to resolve indicator colors. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used to resolve indicator colors. */
  readonly colorScheme: TraceColorScheme;
  /** Exact selected span refs rendered as persistent minimap indicators. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Exact hovered span ref rendered as a transient minimap indicator. */
  readonly hoveredSpanRef?: SpanRef | null;
};

/** Absolute time range used to override or describe minimap-local X extents. */
export type TraceOverviewTimeRange = {
  /** Inclusive start timestamp, in absolute milliseconds. */
  readonly startTimeMs?: number;
  /** Exclusive end timestamp, in absolute milliseconds. */
  readonly endTimeMs?: number;
};

/** Loaded-content X extents expressed in minimap-local coordinates. */
export type TraceOverviewLoadedContentBounds = {
  /** Left X edge of the loaded minimap content window. */
  readonly minX: number;
  /** Right X edge of the loaded minimap content window. */
  readonly maxX: number;
};

/** Prepared minimap view state derived from layout bounds and optional time-range overrides. */
export type TracePreparedOverviewViewModel = {
  /** Bounds used to fit the minimap viewport and viewport highlight. */
  readonly bounds: TraceViewBounds;
  /** Optional loaded-content X extents expressed in minimap-local coordinates. */
  readonly loadedContentBounds?: TraceOverviewLoadedContentBounds;
};

/** Parameters for building the prepared minimap view model passed through DeckTraceGraph. */
export type BuildTracePreparedOverviewViewModelParams = {
  /** Whether the minimap should use dedicated minimap layout bounds. */
  readonly isOverviewEnabled: boolean;
  /** Main trace bounds used as the fallback minimap source when minimap layout is absent or disabled. */
  readonly mainBounds: TraceViewBounds;
  /** Optional minimap-specific bounds precomputed on the primary TraceLayout. */
  readonly minimapBounds?: TraceLayoutBounds;
  /** Absolute time origin used to translate overview ranges into local deck coordinates. */
  readonly originTimeMs: number;
  /** Optional absolute time range used to override minimap X extents. */
  readonly overviewTimeRange?: TraceOverviewTimeRange;
  /** Optional absolute time range describing the data currently loaded into the minimap. */
  readonly overviewLoadedTimeRange?: TraceOverviewTimeRange;
};

/** Parameters for building foreground graph scenes for the primary trace view. */
export type BuildTracePreparedGraphScenesParams = {
  /** Source trace graphs represented in the current deck view. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Trace layouts whose rows should be projected for deck layers. */
  readonly traceLayouts: readonly TraceLayout[];
  /** Trace visualization settings that affect same-process dependency visibility. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used for collapsed-activity summaries. */
  readonly colorScheme: TraceColorScheme;
  /** Whether collapsed process activity summaries should be included. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation algorithm. Defaults to legacy density summaries. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Returns the model matrix for a graph index in compare mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
};

/** Parameters for building row-level binary deck inputs from one TraceLayout. */
export type BuildTracePreparedProcessRowsParams = {
  /** Trace graph used to project row-local visible spans and dependencies. */
  readonly graph: TraceGraph;
  /** Trace layout that owns render rows, timing origin, and lane state. */
  readonly layout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state shared across prepared row builders. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Trace visualization settings that affect binary row projection and dependency visibility. */
  readonly settings: TraceVisSettings;
  /** Optional collapsed-activity samples keyed by exact graph-local process refs. */
  readonly collapsedActivityByProcessRef?: CollapsedActivityByProcessRef;
  /** Whether visible spans should be projected into each row. */
  readonly includeSpans?: boolean;
  /** Whether visible same-process dependencies should be projected into each row. */
  readonly includeDependencies?: boolean;
  /** Whether overflow labels should be kept on each prepared row. */
  readonly includeOverflowLabels?: boolean;
  /** Active trace color scheme used for binary block colors. */
  readonly colorScheme?: TraceColorScheme;
};

/** Parameters for building overview/minimap layout inputs. */
export type BuildTracePreparedOverviewGraphScenesParams = {
  /** Whether overview/minimap foreground layout inputs should be generated. */
  readonly isOverviewEnabled: boolean;
  /** Source trace graphs represented in the current deck view. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Trace layouts whose minimap layouts should be projected for deck layers. */
  readonly traceLayouts: readonly TraceLayout[];
  /** Trace visualization settings used for collapsed-activity summaries. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used for collapsed-activity summaries. */
  readonly colorScheme: TraceColorScheme;
  /** Collapsed process activity aggregation algorithm. Defaults to legacy density summaries. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Returns the model matrix for a graph index in compare mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
};

/**
 * Normalizes optional comparison transform settings before constructing a model matrix.
 */
function getTraceComparisonTransformParams(
  offsetMs?: number,
  scale?: number
): TraceComparisonTransform {
  const safeScale = Number.isFinite(scale) && scale !== 0 ? (scale as number) : 1;
  const safeOffset = Number.isFinite(offsetMs) ? (offsetMs as number) : 0;
  return {translation: safeOffset, scale: safeScale};
}

/**
 * Decorates overview scenes with selected and hovered span indicators.
 */
export function buildTraceSelectionOverviewScenes(
  params: BuildTraceSelectionOverviewScenesParams
): readonly TracePreparedGraphScene[] {
  return params.overviewScenes.map((scene, graphIndex) => ({
    ...scene,
    minimapSpanIndicators: buildTracePreparedMinimapSpanIndicators({
      graph:
        params.sourceTraceGraphs[graphIndex] ??
        params.sourceTraceGraphs[0] ??
        scene.layout.traceGraph,
      layout: scene.layout,
      settings: params.settings,
      colorScheme: params.colorScheme,
      selectedSpanRefs: params.selectedSpanRefs,
      hoveredSpanRef: params.hoveredSpanRef ?? null
    })
  }));
}

/**
 * Estimates JS heap used by prepared deck inputs, including row arrays, ref sources,
 * collapsed activity arrays, minimap indicators, paths, and row-local binary typed-array buffers.
 *
 * This intentionally uses shallow per-entry heuristics for object/array/map overhead so the
 * estimate stays cheap on large traces. Typed-array backing buffers are de-duplicated because
 * one render projection can reference the same buffer from multiple inputs.
 *
 * @param foregroundScenes - Foreground graph render snapshots.
 * @param overviewScenes - Overview graph render snapshots.
 * @param pathData - Critical-path render sources.
 */
export function estimateTracePreparedRenderDataSize(
  foregroundScenes: readonly TracePreparedGraphScene[],
  overviewScenes: readonly TracePreparedGraphScene[],
  pathData: TracePreparedPathData
): number {
  const context: TracePreparedRenderDataSizeContext = {
    seenBuffers: new WeakSet<ArrayBufferLike>(),
    seenObjects: new WeakSet<object>()
  };
  let bytes = 0;
  bytes += estimatePreparedLayoutInputsSize(foregroundScenes, context);
  bytes += estimatePreparedLayoutInputsSize(overviewScenes, context);
  bytes += estimateArrayOwnBytes(pathData.pathBlockSources.length, 80);
  bytes += estimateArrayOwnBytes(pathData.pathDependencySources.length, 96);
  return bytes;
}

/**
 * Builds the minimap view model used by DeckTraceGraph and DeckWithManagedViews.
 */
export function buildTracePreparedOverviewViewModel(
  params: BuildTracePreparedOverviewViewModelParams
): TracePreparedOverviewViewModel {
  const baseBounds = cloneTraceBounds(
    params.isOverviewEnabled ? (params.minimapBounds ?? params.mainBounds) : params.mainBounds
  );
  return {
    bounds: buildTraceOverviewBounds(baseBounds, params.overviewTimeRange, params.originTimeMs),
    loadedContentBounds: buildTraceOverviewLoadedContentBounds(
      params.overviewLoadedTimeRange,
      params.originTimeMs
    )
  };
}

/**
 * Builds foreground graph scenes from TraceLayout rows and TraceGraph-visible data.
 */
export function buildTracePreparedGraphScenes(
  params: BuildTracePreparedGraphScenesParams
): readonly TracePreparedGraphScene[] {
  const buildStartTime = performance.now();
  traceLog.probe(1, 'buildTracePreparedGraphScenes start', {
    graphCount: params.traceLayouts.length,
    totalSpanCount: params.traceLayouts.reduce(
      (count, layout) => count + layout.traceGraph.stats.spanCount,
      0
    ),
    showCollapsedActivitySummary: params.showCollapsedActivitySummary
  })();
  let collapsedActivityDurationMs = 0;
  let preparedRowsDurationMs = 0;
  let visibleCrossProcessDependencyDurationMs = 0;
  let spanCount = 0;
  let sameProcessDependencyCount = 0;
  let visibleCrossProcessDependencyCount = 0;
  const result = params.traceLayouts.map((layout, graphIndex): TracePreparedGraphScene => {
    const graph = layout.traceGraph;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(layout);
    const graphBuildStartTime = performance.now();
    traceLog.probe(1, 'buildTracePreparedGraphScenes graph start', {
      graphIndex,
      graphName: graph.name,
      processCount: graph.processes.length,
      spanCount: graph.stats.spanCount,
      sameProcessDependencyCount: graph.stats.sameProcessDependencyCount,
      crossProcessDependencyCount: graph.stats.crossProcessDependencyCount,
      renderRowCount: layout.renderRows.length,
      ...getHeapUsageProbeFields()
    })();
    const collapsedActivityStartTime = performance.now();
    const collapsedActivityByProcessRef = params.showCollapsedActivitySummary
      ? buildTracePreparedCollapsedActivityByProcessRef({
          graph,
          layout,
          geometryContext,
          colorScheme: params.colorScheme,
          settings: params.settings,
          aggregation: params.collapsedActivityAggregation
        })
      : undefined;
    collapsedActivityDurationMs += performance.now() - collapsedActivityStartTime;
    traceLog.probe(1, 'buildTracePreparedGraphScenes collapsed activity done', {
      graphIndex,
      graphName: graph.name,
      enabled: params.showCollapsedActivitySummary,
      processWithActivityCount: collapsedActivityByProcessRef?.size ?? 0,
      durationMs: performance.now() - collapsedActivityStartTime,
      ...getHeapUsageProbeFields()
    })();
    const preparedRowsStartTime = performance.now();
    traceLog.probe(1, 'buildTracePreparedGraphScenes prepared rows start', {
      graphIndex,
      graphName: graph.name,
      renderRowCount: layout.renderRows.length,
      ...getHeapUsageProbeFields()
    })();
    const processRows = buildTracePreparedProcessRows({
      graph,
      layout,
      geometryContext,
      settings: params.settings,
      collapsedActivityByProcessRef,
      colorScheme: params.colorScheme
    });
    preparedRowsDurationMs += performance.now() - preparedRowsStartTime;
    traceLog.probe(1, 'buildTracePreparedGraphScenes prepared rows done', {
      graphIndex,
      graphName: graph.name,
      processRowCount: processRows.length,
      spanCount: processRows.reduce((sum, row) => sum + (row.binaryBlockData?.data.length ?? 0), 0),
      sameProcessDependencyCount: processRows.reduce(
        (sum, row) => sum + (row.binaryDependencyLineData?.data.length ?? 0),
        0
      ),
      durationMs: performance.now() - preparedRowsStartTime,
      ...getHeapUsageProbeFields()
    })();
    for (const row of processRows) {
      spanCount += row.binaryBlockData?.data.length ?? 0;
      sameProcessDependencyCount += row.binaryDependencyLineData?.data.length ?? 0;
    }
    const visibleCrossProcessDependencyStartTime = performance.now();
    traceLog.probe(1, 'buildTracePreparedGraphScenes visible cross-process dependencies start', {
      graphIndex,
      graphName: graph.name,
      crossProcessDependencyCount: graph.stats.crossProcessDependencyCount,
      ...getHeapUsageProbeFields()
    })();
    const crossProcessDependencyRefs =
      graph.crossProcessDependencyTable.numRows > 0
        ? buildTraceVisibleCrossProcessDependencyRefSource(graph)
        : EMPTY_TRACE_PREPARED_CROSS_PROCESS_DEPENDENCY_REFS;
    const binaryCrossProcessDependencyLineData =
      params.settings.lineRoutingMode === 'straight' && crossProcessDependencyRefs.length > 0
        ? buildTraceDeckBinaryCrossProcessDependencyLineData({
            dependencyRefs: crossProcessDependencyRefs,
            traceLayout: layout,
            geometryContext,
            settings: params.settings
          })
        : undefined;
    visibleCrossProcessDependencyDurationMs +=
      performance.now() - visibleCrossProcessDependencyStartTime;
    visibleCrossProcessDependencyCount += crossProcessDependencyRefs.length;
    traceLog.probe(1, 'buildTracePreparedGraphScenes graph done', {
      graphIndex,
      graphName: graph.name,
      processRowCount: processRows.length,
      spanCount: processRows.reduce((sum, row) => sum + (row.binaryBlockData?.data.length ?? 0), 0),
      sameProcessDependencyCount: processRows.reduce(
        (sum, row) => sum + (row.binaryDependencyLineData?.data.length ?? 0),
        0
      ),
      visibleCrossProcessDependencyCount: crossProcessDependencyRefs.length,
      visibleCrossProcessDependencyDurationMs:
        performance.now() - visibleCrossProcessDependencyStartTime,
      durationMs: performance.now() - graphBuildStartTime,
      ...getHeapUsageProbeFields()
    })();
    return {
      layout,
      rows: processRows,
      crossProcessDependencyRefs,
      binaryCrossProcessDependencyLineData,
      layerIdPrefix: getTraceDeckLayerIdPrefix(params.sourceTraceGraphs.length, graphIndex),
      modelMatrix: params.getTraceModelMatrixForGraph(graphIndex),
      rankBackgroundColor: getTraceDeckRankBackgroundColor(graphIndex),
      minimapSpanIndicators: []
    };
  });

  traceLog.probe(0, 'buildTracePreparedGraphScenes done', {
    graphCount: result.length,
    rowCount: result.reduce((sum, scene) => sum + scene.rows.length, 0),
    spanCount,
    sameProcessDependencyCount,
    visibleCrossProcessDependencyCount,
    collapsedActivityDurationMs,
    preparedRowsDurationMs,
    visibleCrossProcessDependencyDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return result;
}

/**
 * Builds row-level prepared process rows from one TraceLayout without constructing renderer layers.
 */
export function buildTracePreparedProcessRows(
  params: BuildTracePreparedProcessRowsParams
): readonly TracePreparedProcessRow[] {
  const buildStartTime = performance.now();
  const includeSpans = params.includeSpans ?? true;
  const includeDependencies = params.includeDependencies ?? true;
  const includeOverflowLabels = params.includeOverflowLabels ?? true;
  const geometryContext =
    params.geometryContext ??
    (includeSpans || includeDependencies || includeOverflowLabels
      ? buildTraceLayoutGeometryDerivationContext(params.layout)
      : undefined);
  let primaryEndpointPages: TraceArrowPrimaryEndpointPages | null | undefined;
  const getPrimaryEndpointPages = (): TraceArrowPrimaryEndpointPages | null => {
    if (primaryEndpointPages === undefined) {
      primaryEndpointPages = buildTraceArrowPrimaryEndpointPages(params.layout, {
        allowRowLocalSnapshotFilters: true
      });
    }
    return primaryEndpointPages;
  };
  traceLog.probe(1, 'buildTracePreparedProcessRows start', {
    graphName: params.graph.name,
    renderRowCount: params.layout.renderRows.length,
    includeSpans,
    includeDependencies,
    includeOverflowLabels,
    ...getHeapUsageProbeFields()
  })();
  const rowEnrichments = includeOverflowLabels
    ? buildTraceLayoutRowEnrichments({
        traceLayout: params.layout,
        collapsedActivityByProcessRef: params.collapsedActivityByProcessRef,
        geometryContext
      })
    : params.layout.renderRows.map(row => ({
        row,
        collapsedActivityIntervals: getSortedCollapsedActivityIntervals(
          params.collapsedActivityByProcessRef?.get(row.processRef)
        ),
        overflowLabels: EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS
      }));
  const denseSpanRangesByProcessRef = includeSpans
    ? buildTracePreparedDenseSpanRangePlans(params.graph)
    : null;
  const result = rowEnrichments.map(({row, collapsedActivityIntervals, overflowLabels}) => {
    const processId = row.processId as TraceProcessId;
    const processName =
      params.graph.processes.find(process => process.processId === processId)?.name ?? '';
    const spans = includeSpans
      ? getTracePreparedProcessRowSpans({
          graph: params.graph,
          row,
          denseRanges: denseSpanRangesByProcessRef?.get(row.processRef)
        })
      : EMPTY_TRACE_PREPARED_ROW_SPAN_REFS;
    let dependencies = EMPTY_TRACE_PREPARED_ROW_DEPENDENCY_REFS;
    if (includeDependencies) {
      dependencies = getTracePreparedProcessRowDependencies({
        graph: params.graph,
        row,
        sameProcessDependencyMode: params.settings.sameProcessDependencyMode
      });
    }
    const binaryBlockData = includeSpans
      ? getTracePreparedProcessRowBinaryBlockData({
          spans,
          processName,
          traceLayout: params.layout,
          geometryContext,
          endpointPages: getPrimaryEndpointPages(),
          settings: params.settings,
          colorScheme: params.colorScheme
        })
      : undefined;
    const binaryDependencyLineData = includeDependencies
      ? getTracePreparedProcessRowBinaryDependencyLineData({
          dependencyRefs: dependencies,
          traceLayout: params.layout,
          geometryContext,
          endpointPages:
            dependencies.length === 0 ||
            (params.graph.hasActiveSpanFilter() && dependencies.denseVisibility == null)
              ? null
              : getPrimaryEndpointPages(),
          settings: params.settings
        })
      : undefined;
    return {
      row,
      binaryBlockData,
      binaryDependencyLineData,
      collapsedActivityIntervals,
      overflowLabels: includeOverflowLabels ? overflowLabels : EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS
    };
  });

  traceLog.probe(1, 'buildTracePreparedProcessRows done', {
    graphName: params.graph.name,
    processRowCount: result.length,
    spanCount: result.reduce((sum, row) => sum + (row.binaryBlockData?.data.length ?? 0), 0),
    dependencyCount: result.reduce(
      (sum, row) => sum + (row.binaryDependencyLineData?.data.length ?? 0),
      0
    ),
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();

  return result;
}

/**
 * Builds overview/minimap deck layout inputs while avoiding render-span and dependency row scans.
 */
export function buildTracePreparedOverviewGraphScenes(
  params: BuildTracePreparedOverviewGraphScenesParams
): readonly TracePreparedGraphScene[] {
  if (!params.isOverviewEnabled) {
    return [];
  }

  const buildStartTime = performance.now();
  let collapsedActivityDurationMs = 0;
  let preparedRowsDurationMs = 0;
  const result = params.sourceTraceGraphs.flatMap((_, graphIndex) => {
    const layout =
      (params.traceLayouts[graphIndex] ?? params.traceLayouts[0])?.minimapLayout?.traceLayout ??
      params.traceLayouts[0]?.minimapLayout?.traceLayout;
    if (!layout) {
      return [];
    }
    const graph = layout.traceGraph;
    const geometryLayout = params.traceLayouts[graphIndex] ?? params.traceLayouts[0] ?? layout;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(geometryLayout);
    const usesIcicleActivity = params.collapsedActivityAggregation === 'icicle';
    const collapsedActivityStartTime = performance.now();
    const collapsedActivityByProcessRef = usesIcicleActivity
      ? buildTracePreparedCollapsedActivityByProcessRef({
          graph,
          layout,
          geometryLayout,
          geometryContext,
          colorScheme: params.colorScheme,
          settings: params.settings,
          aggregation: params.collapsedActivityAggregation
        })
      : undefined;
    collapsedActivityDurationMs += performance.now() - collapsedActivityStartTime;
    const preparedRowsStartTime = performance.now();
    const processRows = buildTracePreparedProcessRows({
      graph,
      layout,
      settings: params.settings,
      collapsedActivityByProcessRef,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });
    preparedRowsDurationMs += performance.now() - preparedRowsStartTime;
    const activitySummaryStartTime = performance.now();
    const processActivitySummaryData = usesIcicleActivity
      ? buildTraceDeckBinaryProcessActivityData({
          rows: processRows,
          traceLayout: layout,
          settings: params.settings
        })
      : buildTraceDeckBinaryOverviewDensityActivityData({
          graph,
          rows: processRows,
          traceLayout: layout,
          settings: params.settings,
          colorScheme: params.colorScheme
        });
    collapsedActivityDurationMs += performance.now() - activitySummaryStartTime;

    return {
      layout,
      rows: processRows,
      processActivitySummaryData,
      crossProcessDependencyRefs: EMPTY_TRACE_PREPARED_CROSS_PROCESS_DEPENDENCY_REFS,
      layerIdPrefix:
        params.sourceTraceGraphs.length > 1 ? `minimap-trace-graph-${graphIndex}` : 'minimap-trace',
      modelMatrix: params.getTraceModelMatrixForGraph(graphIndex),
      rankBackgroundColor: getTraceDeckRankBackgroundColor(graphIndex),
      minimapSpanIndicators: EMPTY_TRACE_PREPARED_MINIMAP_SPAN_INDICATORS
    };
  });
  traceLog.probe(0, 'buildTracePreparedOverviewGraphScenes done', {
    graphCount: result.length,
    rowCount: result.reduce((sum, scene) => sum + scene.rows.length, 0),
    collapsedActivityDurationMs,
    preparedRowsDurationMs,
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return result;
}

/** Builds selected and hovered span indicators projected into a collapsed minimap layout. */
export function buildTracePreparedMinimapSpanIndicators({
  graph,
  layout,
  settings,
  colorScheme,
  selectedSpanRefs,
  hoveredSpanRef
}: {
  /** Trace graph used to resolve span timing and raw process identity. */
  readonly graph: TraceGraph;
  /** Collapsed minimap trace layout used to resolve process-row Y positions. */
  readonly layout: TraceLayout;
  /** Trace visualization settings used to resolve span colors. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used to resolve span colors. */
  readonly colorScheme: TraceColorScheme;
  /** Exact selected span refs rendered as persistent indicators. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Exact hovered span ref rendered as a transient indicator. */
  readonly hoveredSpanRef?: SpanRef | null;
}): readonly TracePreparedMinimapSpanIndicator[] {
  const indicators: TracePreparedMinimapSpanIndicator[] = [];
  const selectedSpanRefSet = new Set<SpanRef>();
  const colorResolver = createTraceGraphColorResolver({traceGraph: graph, colorScheme, settings});

  for (const spanRef of selectedSpanRefs) {
    selectedSpanRefSet.add(spanRef);
    const indicator = buildTracePreparedMinimapSpanIndicator({
      graph,
      layout,
      colorResolver,
      spanRef,
      kind: 'selected'
    });
    if (indicator) {
      indicators.push(indicator);
    }
  }

  if (hoveredSpanRef != null && !selectedSpanRefSet.has(hoveredSpanRef)) {
    const indicator = buildTracePreparedMinimapSpanIndicator({
      graph,
      layout,
      colorResolver,
      spanRef: hoveredSpanRef,
      kind: 'hovered'
    });
    if (indicator) {
      indicators.push(indicator);
    }
  }

  return indicators;
}

/** Returns sorted collapsed-activity intervals while preserving a stable empty array. */
function getSortedCollapsedActivityIntervals(
  intervals: readonly TraceProcessActivityInterval[] | undefined
): readonly TraceProcessActivityInterval[] {
  return intervals && intervals.length > 0
    ? [...intervals].sort((left, right) => left.startX - right.startX)
    : EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS;
}

/** Returns current visible row span refs without retaining a second snapshot array. */
function getTracePreparedRowRenderSpanRefs(
  graph: TraceGraph,
  row: TraceLayoutRow
): TraceSpanRefSource {
  return Array.from(graph.iterateVisibleSpanRefsByProcess(row.processRef));
}

function cloneTraceBounds(bounds: TraceViewBounds | TraceLayoutBounds): TraceViewBounds {
  return [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[1][1]]
  ];
}

/** Projects one span ref into a minimap indicator, including span-derived marker colors. */
function buildTracePreparedMinimapSpanIndicator({
  graph,
  layout,
  colorResolver,
  spanRef,
  kind
}: {
  readonly graph: TraceGraph;
  readonly layout: TraceLayout;
  readonly colorResolver: ReturnType<typeof createTraceGraphColorResolver>;
  readonly spanRef: SpanRef;
  readonly kind: TracePreparedMinimapSpanIndicator['kind'];
}): TracePreparedMinimapSpanIndicator | null {
  const span = getTraceSelectedSpanFromRef(graph, spanRef);
  const processRef = graph.getProcessRefBySpanRef(spanRef);
  if (!span || processRef == null) {
    return null;
  }

  const row = layout.renderRows.find(candidate => candidate.processRef === processRef);
  if (!row) {
    return null;
  }
  const rankLayout = getTraceLayoutProcessLayoutByRef(layout, row.processRef);
  if (!rankLayout) {
    return null;
  }

  const spanXRange = getTracePreparedMinimapSpanIndicatorXRange({
    graph,
    layout,
    span,
    spanRef
  });
  const y = Number.isFinite(rankLayout.collapsedActivityY)
    ? rankLayout.collapsedActivityY
    : rankLayout.yOffset + rankLayout.yHeight / 2;
  if (!Number.isFinite(spanXRange.x) || !Number.isFinite(y)) {
    return null;
  }

  const spanFillColor = colorResolver.getSpanFillColor(spanRef);

  return {
    kind,
    x: spanXRange.x,
    startX: spanXRange.startX,
    endX: spanXRange.endX,
    y,
    lineColor: getTracePreparedMinimapSpanIndicatorLineColor(spanFillColor, kind)
  };
}

/**
 * Returns minimap-local X bounds for a span, preferring rendered layout geometry when present.
 */
function getTracePreparedMinimapSpanIndicatorXRange({
  graph,
  layout,
  span,
  spanRef
}: {
  readonly graph: TraceGraph;
  readonly layout: TraceLayout;
  readonly span: NonNullable<ReturnType<typeof getTraceSelectedSpanFromRef>>;
  readonly spanRef: SpanRef;
}): {x: number; startX: number; endX: number} {
  const spanGeometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const hasSpanGeometry = fillTraceLayoutSpanGeometry({
    traceLayout: layout,
    spanRef,
    target: spanGeometry
  });
  const spanStartX = hasSpanGeometry ? spanGeometry.x1 : undefined;
  const spanEndX = hasSpanGeometry ? spanGeometry.x2 : undefined;
  if (Number.isFinite(spanStartX) && Number.isFinite(spanEndX)) {
    return {
      x: ((spanStartX as number) + (spanEndX as number)) / 2,
      startX: spanStartX as number,
      endX: spanEndX as number
    };
  }

  const layoutTimingKey = layout.layoutConfiguration?.timingKey;
  const timingKey =
    layoutTimingKey && span.timings[layoutTimingKey] ? layoutTimingKey : span.primaryTimingKey;
  const timing = span.timings[timingKey];
  const startTimeMs = timing?.startTimeMs;
  const endTimeMs = timing?.endTimeMs;
  if (!Number.isFinite(startTimeMs) || !Number.isFinite(endTimeMs)) {
    return {x: Number.NaN, startX: Number.NaN, endX: Number.NaN};
  }

  const startX = (startTimeMs as number) - graph.minTimeMs;
  const endX = (endTimeMs as number) - graph.minTimeMs;
  return {
    x: (startX + endX) / 2,
    startX,
    endX
  };
}

/** Returns the hairline color for a minimap span indicator using the span color hue. */
function getTracePreparedMinimapSpanIndicatorLineColor(
  spanColor: readonly [number, number, number, number],
  kind: TracePreparedMinimapSpanIndicator['kind']
): readonly [number, number, number, number] {
  return [spanColor[0], spanColor[1], spanColor[2], kind === 'selected' ? 190 : 130];
}

/** Returns row-local span refs for the current graph. */
function getTracePreparedProcessRowSpans(params: {
  /** Current graph owning the visible row span refs. */
  graph: TraceGraph;
  /** Current layout row whose process-local span refs should be read. */
  row: TraceLayoutRow;
  /** Optional batch-local dense chunk ranges discovered once for this process. */
  denseRanges?: readonly TracePreparedDenseSpanRange[] | null;
}): TraceSpanRefSource {
  return (
    tryBuildTracePreparedDenseSpanRefSource(params.graph, params.row, params.denseRanges) ??
    getTracePreparedRowRenderSpanRefs(params.graph, params.row)
  );
}

/**
 * Builds an O(chunks) span-ref source when one process owns whole canonical chunks.
 *
 * Text/source view masks stay columnar by borrowing their chunk-local typed masks. Shared or mixed
 * chunks keep the existing visible-ref path because their process-local order cannot be represented
 * by plain masked canonical ranges.
 */
function tryBuildTracePreparedDenseSpanRefSource(
  graph: TraceGraph,
  row: TraceLayoutRow,
  denseRanges: readonly TracePreparedDenseSpanRange[] | null | undefined
): TraceSpanRefSource | null {
  const expectedRowCount =
    graph.processSpanTableMap[row.processId as TraceProcessId]?.numRows ?? null;
  if (expectedRowCount == null) {
    return null;
  }
  if (expectedRowCount === 0) {
    return EMPTY_TRACE_PREPARED_ROW_SPAN_REFS;
  }

  if (!denseRanges || denseRanges.length === 0) {
    return null;
  }
  const rowCount = denseRanges.reduce((sum, range) => sum + range.rowCount, 0);
  return rowCount === expectedRowCount ? buildTraceDenseSpanRefSource(denseRanges) : null;
}

/** Numeric canonical chunk range discovered before one prepared-row pass. */
type TracePreparedDenseSpanRange = {
  /** Stable canonical chunk index encoded into the source range. */
  readonly chunkIndex: number;
  /** First canonical row represented by this whole-chunk range. */
  readonly rowStart: number;
  /** Number of canonical rows represented by this whole-chunk range. */
  readonly rowCount: number;
  /**
   * Optional borrowed text/source visibility mask aligned by canonical chunk-local row.
   *
   * The range plan keeps the snapshot's typed column by identity and never expands it into
   * process-local row indexes.
   */
  readonly filterMaskByRow?: Readonly<Uint8Array>;
};

/**
 * Discovers whole-process canonical chunk ranges once per prepared-row batch.
 *
 * This is an ephemeral O(chunks) assembly plan, not a retained cache. Any process touched by a
 * shared/mixed chunk is marked unsupported so its row stays on the visible-ref fallback path.
 */
function buildTracePreparedDenseSpanRangePlans(
  graph: TraceGraph
): ReadonlyMap<ProcessRef, readonly TracePreparedDenseSpanRange[] | null> {
  const plans = new Map<ProcessRef, TracePreparedDenseSpanRange[] | null>();
  for (const chunk of graph.chunks) {
    const chunkRowCount = chunk.spanTable.numRows;
    if (chunkRowCount === 0 || chunk.processRefs.length === 0) {
      continue;
    }
    if (chunk.processRefs.length !== 1) {
      for (const processRef of chunk.processRefs) {
        plans.set(processRef, null);
      }
      continue;
    }
    const processRef = chunk.processRefs[0];
    if (processRef == null || plans.get(processRef) === null) {
      continue;
    }
    const ranges = plans.get(processRef) ?? [];
    const filterMaskByRow =
      getTraceViewChunkFilterMask(graph.traceViewSnapshot, chunk.chunkIndex) ?? undefined;
    ranges.push(
      filterMaskByRow == null
        ? {
            chunkIndex: chunk.chunkIndex,
            rowStart: 0,
            rowCount: chunkRowCount
          }
        : {
            chunkIndex: chunk.chunkIndex,
            rowStart: 0,
            rowCount: chunkRowCount,
            filterMaskByRow
          }
    );
    plans.set(processRef, ranges);
  }
  for (const ranges of plans.values()) {
    ranges?.sort((left, right) => left.chunkIndex - right.chunkIndex);
  }
  return plans;
}

/** Returns row-local same-process dependencies for the current graph. */
function getTracePreparedProcessRowDependencies(params: {
  graph: TraceGraph;
  row: TraceLayoutRow;
  sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'];
}): TraceSameProcessDependencyRefSource {
  return getTracePreparedProcessRowDependencyRefs(params);
}

/** Returns row-local binary block attributes. */
function getTracePreparedProcessRowBinaryBlockData(params: {
  /** Stable visible span-ref source represented by the row-local binary payload. */
  spans: TraceSpanRefSource;
  /** Canonical owning process name shared by every span in the row-local payload. */
  processName: string;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional batch-local borrowed endpoint pages shared with dependency row builders. */
  endpointPages?: TraceArrowPrimaryEndpointPages | null;
  /** Active visualization settings used for span colors. */
  settings: TraceVisSettings;
  /** Active trace color scheme used for span colors. */
  colorScheme?: TraceColorScheme;
}): TraceDeckBinaryBlockData {
  return buildTraceDeckBinaryBlockData({
    spans: params.spans,
    processName: params.processName,
    traceLayout: params.traceLayout,
    geometryContext: params.geometryContext,
    endpointPages: params.endpointPages,
    settings: params.settings,
    colorScheme: params.colorScheme
  });
}

/** Returns row-local binary straight dependency attributes. */
function getTracePreparedProcessRowBinaryDependencyLineData(params: {
  /** Stable visible dependency-ref source represented by the row-local binary payload. */
  dependencyRefs: TraceSameProcessDependencyRefSource;
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional batch-local borrowed endpoint pages shared across sibling process rows. */
  endpointPages?: TraceArrowPrimaryEndpointPages | null;
  /** Active visualization settings used for dependency colors. */
  settings: TraceVisSettings;
}): TraceDeckBinaryDependencyLineData {
  return buildTraceDeckBinaryDependencyLineData({
    dependencyRefs: params.dependencyRefs,
    traceLayout: params.traceLayout,
    geometryContext: params.geometryContext,
    endpointPages: params.endpointPages,
    settings: params.settings
  });
}

/** Returns row-local same-process dependency refs after applying Arrow-field visibility filters. */
function getTracePreparedProcessRowDependencyRefs(params: {
  graph: TraceGraph;
  row: TraceLayoutRow;
  sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'];
}): TraceSameProcessDependencyRefSource {
  const maskedDenseDependencyRefs =
    tryBuildTracePreparedMaskedDenseSameProcessDependencyRefSource(params);
  if (maskedDenseDependencyRefs) {
    return maskedDenseDependencyRefs;
  }

  if (!params.graph.hasActiveSpanFilter()) {
    const table =
      params.graph.sameProcessDependencyTableMap[params.row.processId as TraceProcessId] ?? null;
    if (!table) {
      return params.graph.getSameProcessDependencyRefs(params.row.processRef);
    }
    if (table.numRows === 0) {
      return EMPTY_TRACE_PREPARED_ROW_DEPENDENCY_REFS;
    }

    const processIndex = getProcessRefIndex(params.row.processRef);
    if (params.sameProcessDependencyMode === 'all') {
      return buildTraceDenseSameProcessDependencyRefSource(processIndex, table.numRows);
    }

    const dependencyRefs: SameProcessDependencyRef[] = [];
    const keywordFlagsColumn = table.getChild('keywordFlags');
    const waitTimeMsColumn = table.getChild('waitTimeMs');
    for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
      const waitTimeMsValue = waitTimeMsColumn?.get(rowIndex);
      const waitTimeMs =
        typeof waitTimeMsValue === 'number' && Number.isFinite(waitTimeMsValue)
          ? waitTimeMsValue
          : 0;
      if (
        !shouldShowSameProcessDependencyByModeFields(
          params.sameProcessDependencyMode,
          traceDependencyKeywordFlagsHasSubmit(keywordFlagsColumn?.get(rowIndex)),
          waitTimeMs
        )
      ) {
        continue;
      }
      dependencyRefs.push(
        encodeSameProcessDependencyRef(encodeLocalSpanRef(processIndex, rowIndex))
      );
    }
    return dependencyRefs;
  }

  const dependencyRefs = Array.from(
    params.graph.iterateVisibleSameProcessDependencyRefsByProcess(params.row.processRef)
  );
  if (params.sameProcessDependencyMode === 'all') {
    return dependencyRefs;
  }

  const filteredDependencyRefs: SameProcessDependencyRef[] = [];
  for (const dependencyRef of dependencyRefs) {
    if (
      shouldShowSameProcessDependencyByModeFields(
        params.sameProcessDependencyMode,
        params.graph.getDependencyHasKeyword(dependencyRef, 'SUBMIT'),
        params.graph.getDependencyWaitTimeMs(dependencyRef) ?? 0
      )
    ) {
      filteredDependencyRefs.push(dependencyRef);
    }
  }
  return filteredDependencyRefs;
}

/**
 * Builds one snapshot-mask dependency source without materializing visible dependency refs.
 *
 * The safe route is intentionally narrow: canonical full-dataset rows and all-mode rendering.
 * Text/source filtering drops any dependency with a hidden canonical endpoint, including PARENT
 * rows, so the binary writer can apply the same chunk masks without a visible-ref rewrite pass.
 * Endpoint refs, ownership, and wait modes were already checked at the store-finalized dataset
 * boundary.
 */
function tryBuildTracePreparedMaskedDenseSameProcessDependencyRefSource(params: {
  /** Runtime graph whose immutable snapshot may hide dependency endpoints. */
  readonly graph: TraceGraph;
  /** Render row whose canonical process-local dependency table is considered. */
  readonly row: TraceLayoutRow;
  /** Current dependency display mode; only all-mode is row-local under this slice. */
  readonly sameProcessDependencyMode: TraceVisSettings['sameProcessDependencyMode'];
}): TraceSameProcessDependencyRefSource | null {
  const {graph} = params;
  if (
    !graph.hasActiveSpanFilter() ||
    graph.spanRefs != null ||
    params.sameProcessDependencyMode !== 'all'
  ) {
    return null;
  }

  const table = graph.sameProcessDependencyTableMap[params.row.processId as TraceProcessId] ?? null;
  if (!table) {
    return null;
  }
  if (table.numRows === 0) {
    return EMPTY_TRACE_PREPARED_ROW_DEPENDENCY_REFS;
  }

  return buildTraceDenseSameProcessDependencyRefSource(
    getProcessRefIndex(params.row.processRef),
    table.numRows,
    {
      dependencyTable: table,
      traceViewSnapshot: graph.traceViewSnapshot
    }
  );
}

type TraceOverviewActivityTimingColumn = {
  /** Reads one Arrow scalar without materializing a table row. */
  get(rowIndex: number): unknown;
};

type TraceOverviewActivityTable = {
  /** Resolves one Arrow child vector by canonical span timing field name. */
  getChild(name: string): TraceOverviewActivityTimingColumn | null | undefined;
};

type TraceOverviewActivityTimingColumns = {
  /** Canonical primary start-time vector. */
  readonly startTimeMs: TraceOverviewActivityTimingColumn | null;
  /** Canonical primary end-time vector. */
  readonly endTimeMs: TraceOverviewActivityTimingColumn | null;
};

type TraceOverviewDensityColumns = {
  /** Left edges of emitted density buckets. */
  readonly starts: number[];
  /** Right edges of emitted density buckets. */
  readonly ends: number[];
  /** Representative canonical span refs used only for final bucket colors. */
  readonly representativeSpanRefs: SpanRef[];
  /** Process-row ordinals aligned with emitted density buckets. */
  readonly processRowIndices: number[];
};

type TraceOverviewActivityBand = {
  /** Stable process-row Y origin for every density bucket in the row. */
  readonly y: number;
  /** Stable process-row height for every density bucket in the row. */
  readonly height: number;
};

/**
 * Builds the default minimap density payload from canonical visible refs and Arrow timing columns.
 *
 * The foreground collapsed-row path still owns object intervals because TraceProcessLayer consumes
 * them. The minimap only needs binary rectangles, so its default density path intentionally keeps
 * primitive numeric columns during aggregation and resolves colors only for the final buckets.
 */
function buildTraceDeckBinaryOverviewDensityActivityData(params: {
  /** Runtime graph whose canonical visible refs and Arrow rows are scanned. */
  readonly graph: TraceGraph;
  /** Prepared process rows retained only for picking/debug metadata. */
  readonly rows: readonly TracePreparedProcessRow[];
  /** Collapsed minimap layout that supplies process activity bands. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Active visualization settings used for density spacing and representative colors. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme used for representative bucket colors. */
  readonly colorScheme: TraceColorScheme;
}): TraceDeckBinaryProcessActivityData {
  const layoutDensity = getLayoutDensityPreset(params.settings.layoutDensity);
  const processRows = params.rows.map(({row}) => row);
  const activityBands = processRows.map(row =>
    getTraceOverviewActivityBand(params.traceLayout, row, layoutDensity)
  );
  const timingColumnsByTable = new Map<
    TraceOverviewActivityTable,
    TraceOverviewActivityTimingColumns
  >();
  const columns: TraceOverviewDensityColumns = {
    starts: [],
    ends: [],
    representativeSpanRefs: [],
    processRowIndices: []
  };

  params.rows.forEach(({row}, processRowIndex) => {
    if (!activityBands[processRowIndex]) {
      return;
    }
    appendTraceOverviewDensityColumns({
      graph: params.graph,
      row,
      processRowIndex,
      timingColumnsByTable,
      target: columns
    });
  });

  const positions = new Float32Array(columns.starts.length * 3);
  const sizes = new Float32Array(columns.starts.length * 2);
  const fillColors = new Uint8Array(columns.starts.length * 4);
  const lineColors = new Uint8Array(columns.starts.length * 4);
  const colorResolver = createTraceGraphColorResolver({
    traceGraph: params.graph,
    colorScheme: params.colorScheme,
    settings: params.settings
  });

  for (let index = 0; index < columns.starts.length; index += 1) {
    const processRowIndex = columns.processRowIndices[index] ?? 0;
    const activityBand = activityBands[processRowIndex];
    if (!activityBand) {
      continue;
    }
    const startX = columns.starts[index] ?? 0;
    const endX = columns.ends[index] ?? startX;
    const color =
      toRgb(colorResolver.getSpanFillColor(columns.representativeSpanRefs[index]!, 'any')) ??
      COLLAPSED_ACTIVITY_FALLBACK_COLOR_RGB;
    positions[index * 3] = startX;
    positions[index * 3 + 1] = activityBand.y;
    positions[index * 3 + 2] = 0;
    sizes[index * 2] = Math.max(0, endX - startX);
    sizes[index * 2 + 1] = activityBand.height;
    fillColors[index * 4] = color[0];
    fillColors[index * 4 + 1] = color[1];
    fillColors[index * 4 + 2] = color[2];
    fillColors[index * 4 + 3] = 220;
    lineColors[index * 4] = color[0];
    lineColors[index * 4 + 1] = color[1];
    lineColors[index * 4 + 2] = color[2];
    lineColors[index * 4 + 3] = 0;
  }

  return {
    data: {
      length: columns.starts.length,
      attributes: {
        getPosition: {value: positions, size: 3},
        getSize: {value: sizes, size: 2},
        getFillColor: {value: fillColors, size: 4},
        getLineColor: {value: lineColors, size: 4}
      }
    },
    processRows,
    processRowIndices: Uint32Array.from(columns.processRowIndices)
  };
}

/** Appends one process row's density buckets without allocating span or interval objects. */
function appendTraceOverviewDensityColumns(params: {
  /** Runtime graph whose snapshot mask owns visibility. */
  readonly graph: TraceGraph;
  /** Render row whose process-local visible spans are summarized. */
  readonly row: TraceLayoutRow;
  /** Render-row ordinal aligned with the overview scene's process rows. */
  readonly processRowIndex: number;
  /** Per-build Arrow timing vectors, retained only while this overview payload is built. */
  readonly timingColumnsByTable: Map<
    TraceOverviewActivityTable,
    TraceOverviewActivityTimingColumns
  >;
  /** Primitive output columns appended with final visible density buckets. */
  readonly target: TraceOverviewDensityColumns;
}): void {
  const threadDepthByRef = new Map<ThreadRef, number>();
  params.row.threadRefs.forEach((threadRef, index) => {
    threadDepthByRef.set(threadRef, index);
  });
  const depthCount = Math.max(1, threadDepthByRef.size);
  const spanRefs: SpanRef[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const depths: number[] = [];
  let maxSliceEnd = 0;

  for (const spanRef of params.graph.iterateVisibleSpanRefsByProcess(params.row.processRef)) {
    const spanRow = getActiveTraceGraphSpanStoreRow(params.graph, spanRef);
    if (!spanRow || spanRow.threadRef == null) {
      continue;
    }
    const timingColumns = getTraceOverviewActivityTimingColumns(
      spanRow.spanTable,
      params.timingColumnsByTable
    );
    const rawStartTimeMs = timingColumns.startTimeMs?.get(spanRow.rowIndex);
    const rawEndTimeMs = timingColumns.endTimeMs?.get(spanRow.rowIndex);
    if (
      typeof rawStartTimeMs !== 'number' ||
      !Number.isFinite(rawStartTimeMs) ||
      typeof rawEndTimeMs !== 'number' ||
      !Number.isFinite(rawEndTimeMs)
    ) {
      continue;
    }
    const start = Math.min(rawStartTimeMs, rawEndTimeMs) - params.graph.minTimeMs;
    const finiteEnd = Math.max(rawStartTimeMs, rawEndTimeMs) - params.graph.minTimeMs;
    if (!Number.isFinite(start) || !Number.isFinite(finiteEnd)) {
      continue;
    }
    const end = start + Math.max(COLLAPSED_ACTIVITY_MIN_WIDTH_MS, finiteEnd - start);
    if (!Number.isFinite(end)) {
      continue;
    }
    spanRefs.push(spanRef);
    starts.push(start);
    ends.push(end);
    depths.push(threadDepthByRef.get(spanRow.threadRef) ?? 0);
    maxSliceEnd = Math.max(maxSliceEnd, end);
  }

  const windowStart = 0;
  const windowEnd = Math.max(
    Math.max(0, params.graph.maxTimeMs - params.graph.minTimeMs),
    maxSliceEnd
  );
  if (spanRefs.length === 0 || !(windowEnd > windowStart)) {
    return;
  }

  const step = getCollapsedActivityStep(windowEnd - windowStart, depthCount);
  const bucketStarts: number[] = [];
  const bucketEnds: number[] = [];
  for (let bucketStart = windowStart; bucketStart < windowEnd; bucketStart += step) {
    bucketStarts.push(bucketStart);
    bucketEnds.push(bucketStart + step);
  }
  const sampleCounts = new Uint32Array(bucketStarts.length);
  const occupiedDepthCounts = new Uint16Array(bucketStarts.length);
  const dominantWeights = new Uint32Array(bucketStarts.length);
  const dominantSpanRefs = new Float64Array(bucketStarts.length);
  dominantSpanRefs.fill(-1);
  const spanIndicesByDepth = Array.from({length: depthCount}, () => [] as number[]);
  depths.forEach((depth, spanIndex) => {
    (spanIndicesByDepth[depth] ?? spanIndicesByDepth[0])!.push(spanIndex);
  });

  spanIndicesByDepth.forEach(spanIndices => {
    if (spanIndices.length === 0) {
      return;
    }
    spanIndices.sort((left, right) => (starts[left] ?? 0) - (starts[right] ?? 0));
    let nextSpanIndex = lowerBoundTraceOverviewStart(spanIndices, starts, windowStart);
    const activeSpanIndices: number[] = [];
    if (nextSpanIndex > 0) {
      let priorSpanIndex = nextSpanIndex - 1;
      while (priorSpanIndex >= 0) {
        const spanIndex = spanIndices[priorSpanIndex]!;
        if ((ends[spanIndex] ?? 0) <= windowStart) {
          break;
        }
        activeSpanIndices.push(spanIndex);
        priorSpanIndex -= 1;
      }
    }

    for (let bucketIndex = 0; bucketIndex < bucketStarts.length; bucketIndex += 1) {
      const bucketStart = bucketStarts[bucketIndex]!;
      const bucketEnd = bucketEnds[bucketIndex]!;
      while (
        nextSpanIndex < spanIndices.length &&
        (starts[spanIndices[nextSpanIndex]!] ?? Number.POSITIVE_INFINITY) < bucketEnd
      ) {
        activeSpanIndices.push(spanIndices[nextSpanIndex]!);
        nextSpanIndex += 1;
      }

      let activeCount = 0;
      let bestSpanIndex = -1;
      let bestDuration = Number.NEGATIVE_INFINITY;
      for (const spanIndex of activeSpanIndices) {
        const start = starts[spanIndex] ?? Number.POSITIVE_INFINITY;
        const end = ends[spanIndex] ?? Number.NEGATIVE_INFINITY;
        if (end <= bucketStart || start >= bucketEnd) {
          continue;
        }
        activeCount += 1;
        const duration = end - start;
        if (duration > bestDuration) {
          bestDuration = duration;
          bestSpanIndex = spanIndex;
        }
      }

      if (bestSpanIndex >= 0) {
        sampleCounts[bucketIndex] += activeCount;
        occupiedDepthCounts[bucketIndex] += 1;
        if (activeCount > dominantWeights[bucketIndex]!) {
          dominantWeights[bucketIndex] = activeCount;
          dominantSpanRefs[bucketIndex] = spanRefs[bestSpanIndex]!;
        }
      }

      if (activeSpanIndices.length > 0) {
        let writeIndex = 0;
        for (const spanIndex of activeSpanIndices) {
          if ((ends[spanIndex] ?? Number.NEGATIVE_INFINITY) > bucketEnd) {
            activeSpanIndices[writeIndex] = spanIndex;
            writeIndex += 1;
          }
        }
        activeSpanIndices.length = writeIndex;
      }
      if (nextSpanIndex >= spanIndices.length && activeSpanIndices.length === 0) {
        break;
      }
    }
  });

  for (let bucketIndex = 0; bucketIndex < bucketStarts.length; bucketIndex += 1) {
    if (occupiedDepthCounts[bucketIndex] === 0) {
      continue;
    }
    const startX = clamp(bucketStarts[bucketIndex]!, windowStart, windowEnd);
    const endX = clamp(
      Math.max(bucketEnds[bucketIndex]!, startX + COLLAPSED_ACTIVITY_MIN_WIDTH_MS),
      windowStart,
      windowEnd
    );
    const representativeSpanRef = dominantSpanRefs[bucketIndex];
    if (!(endX > startX) || representativeSpanRef == null || representativeSpanRef < 0) {
      continue;
    }
    params.target.starts.push(startX);
    params.target.ends.push(endX);
    params.target.representativeSpanRefs.push(representativeSpanRef as SpanRef);
    params.target.processRowIndices.push(params.processRowIndex);
  }
}

/** Returns canonical primary timing vectors for one table within one overview build. */
function getTraceOverviewActivityTimingColumns(
  table: TraceOverviewActivityTable,
  columnsByTable: Map<TraceOverviewActivityTable, TraceOverviewActivityTimingColumns>
): TraceOverviewActivityTimingColumns {
  const existing = columnsByTable.get(table);
  if (existing) {
    return existing;
  }
  const columns = {
    startTimeMs: table.getChild('start_time_ms') ?? null,
    endTimeMs: table.getChild('end_time_ms') ?? null
  } satisfies TraceOverviewActivityTimingColumns;
  columnsByTable.set(table, columns);
  return columns;
}

/** Returns the first time-sorted span ordinal whose start is not before the target. */
function lowerBoundTraceOverviewStart(
  spanIndices: readonly number[],
  starts: readonly number[],
  targetStart: number
): number {
  let low = 0;
  let high = spanIndices.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((starts[spanIndices[middle]!] ?? Number.POSITIVE_INFINITY) < targetStart) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/** Resolves one minimap process activity band from exact process refs. */
function getTraceOverviewActivityBand(
  traceLayout: Readonly<TraceLayout>,
  row: TraceLayoutRow,
  layoutDensity: ReturnType<typeof getLayoutDensityPreset>
): TraceOverviewActivityBand | null {
  const rankLayout = getTraceLayoutProcessLayoutByRef(traceLayout, row.processRef);
  if (!rankLayout) {
    return null;
  }
  const compactRowHeight = Math.max(layoutDensity.laneSeparation, layoutDensity.spanHeight * 1.5);
  const rowMargin = Math.max(
    layoutDensity.spanHeight * 0.25,
    compactRowHeight * PROCESS_ACTIVITY_SUMMARY_ROW_MARGIN_FRACTION
  );
  return {
    y: rankLayout.yOffset + layoutDensity.overviewTopGap + rowMargin,
    height: Math.max(layoutDensity.spanHeight, compactRowHeight - rowMargin * 2)
  };
}

/** Builds collapsed activity rows keyed by exact graph-local process refs. */
function buildTracePreparedCollapsedActivityByProcessRef(params: {
  /** Trace graph whose visible process rows should be summarized. */
  readonly graph: TraceGraph;
  /** Layout whose render rows receive collapsed activity intervals. */
  readonly layout: TraceLayout;
  /** Optional layout whose span lane state drives icicle vertical bands. */
  readonly geometryLayout?: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for icicle aggregation. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active trace color scheme used for representative span colors. */
  readonly colorScheme: TraceColorScheme;
  /** Active visualization settings used for representative span colors. */
  readonly settings: TraceVisSettings;
  /** Optional collapsed activity aggregation mode. */
  readonly aggregation?: TraceProcessActivityAggregation;
}): CollapsedActivityByProcessRef {
  const buildStartTime = performance.now();
  const geometryLayout = params.geometryLayout ?? params.layout;
  const result = buildCollapsedActivityByTraceGraphRows({
    graph: params.graph,
    rows: params.layout.renderRows,
    geometryLayout,
    geometryContext: params.geometryContext,
    colorScheme: params.colorScheme,
    settings: params.settings,
    aggregation: params.aggregation
  });
  traceLog.probe(1, 'buildTracePreparedCollapsedActivityByProcessRef done', {
    aggregation: params.aggregation ?? 'density',
    rowCount: params.layout.renderRows.length,
    visibleBlockCount:
      params.graph.stats.spanCount - params.graph.traceViewSnapshot.filteredSpanCount,
    intervalCount: [...result.values()].reduce((sum, intervals) => sum + intervals.length, 0),
    durationMs: performance.now() - buildStartTime,
    ...getHeapUsageProbeFields()
  })();
  return result;
}

function getTraceDeckLayerIdPrefix(
  sourceTraceGraphCount: number,
  graphIndex: number
): string | undefined {
  return sourceTraceGraphCount > 1 ? `trace-graph-${graphIndex}` : undefined;
}

function getTraceDeckRankBackgroundColor(
  graphIndex: number
): readonly [number, number, number, number] | undefined {
  return graphIndex > 0 ? TRACE_COLOR.SECOND_STEP_BACKGROUND : undefined;
}
