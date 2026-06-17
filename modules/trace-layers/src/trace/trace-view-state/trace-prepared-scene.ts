import {Matrix4} from '@math.gl/core';

import {getHeapUsageProbeFields, log as traceLog} from '../log';
import {buildCollapsedActivityByTraceGraphRows} from '../trace-graph/collapsed-activity';
import {shouldShowLocalDependencyByModeFields} from '../trace-layout/local-dependency-filter';
import {
  buildTraceLayoutGeometryDerivationContext,
  fillTraceLayoutLocalDependencyGeometry,
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
  createTraceColorResolver,
  createTraceGraphColorResolver,
  TRACE_COLOR
} from '../trace-style/trace-colors';
import {
  buildTraceOverviewBounds,
  buildTraceOverviewLoadedContentBounds,
  buildTracePreparedPathData
} from './trace-prepared-scene-paths';
import {estimateArrayOwnBytes, estimatePreparedLayoutInputsSize} from './trace-prepared-scene-size';

import type {
  TraceCounterSource,
  TraceCrossDependencySource,
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
  ThreadRef,
  TraceDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TracePath, TraceProcessId, TraceThread} from '../trace-graph/trace-types';
import type {TraceLayoutGeometryDerivationContext} from '../trace-layout/trace-derived-geometry';
import type {
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutGeometryTuple,
  TraceLayoutOverflowLabelDatum,
  TraceLayoutRow,
  TraceProcessActivityInterval
} from '../trace-layout/trace-layout';
import type {TraceColorScheme, TraceDeckColor} from '../trace-style/trace-color-scheme';
import type {TracePreparedSceneSizeContext} from './trace-prepared-scene-size';

export const DEFAULT_INSTANT_COLOR: TraceDeckColor = [94, 234, 212, 220];
export const DEFAULT_COUNTER_COLOR: TraceDeckColor = [251, 191, 36, 220];
const PROCESS_ACTIVITY_SUMMARY_ROW_MARGIN_FRACTION = 0.12;
const EMPTY_TRACE_PREPARED_ROW_SPAN_REFS: readonly SpanRef[] = [];

/** deck.gl binary attribute payload shared by row-local binary render data. */
export type TraceDeckBinaryAttributeData = {
  /** Number of logical rows represented by the binary attribute payload. */
  readonly length: number;
  /** deck.gl binary attributes keyed by accessor or shader attribute name. */
  readonly attributes: Readonly<
    Record<string, {readonly value: Float32Array | Uint8Array | Uint32Array; readonly size: number}>
  >;
};

/** deck.gl binary payload for span block rectangles. */
export type TraceDeckBinaryBlockData = {
  /** Binary attribute payload passed to the block rectangle layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Span refs keyed by binary row index for picking and debug access. */
  readonly spans: readonly SpanRef[];
};

/** deck.gl binary payload for process activity summary rectangles. */
export type TraceDeckBinaryProcessActivityData = {
  /** Binary attribute payload passed to the process activity summary block layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Activity intervals keyed by binary row index for picking and debug access. */
  readonly intervals: readonly TraceProcessActivityInterval[];
  /** Process rows keyed by process row index for picking and debug access. */
  readonly processRows: readonly TraceLayoutRow[];
  /** Process row indices keyed by binary row index for picking and debug access. */
  readonly processRowIndices: Uint32Array;
};

/** deck.gl binary payload for straight local dependency line segments. */
export type TraceDeckBinaryDependencyLineData = {
  /** Binary attribute payload passed to the straight dependency line layer. */
  readonly data: TraceDeckBinaryAttributeData;
  /** Visible dependency refs keyed by binary row index for picking and debug access. */
  readonly dependencyRefs: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[];
};

export type CounterSparkline = {
  readonly threadRef: ThreadRef;
  readonly path: readonly [number, number, number][];
  readonly color: TraceDeckColor;
};

export type InstantRenderData = {
  readonly visibleInstants: readonly TraceInstantSource[];
  readonly positionMap: ReadonlyMap<InstantRef, [number, number, number]>;
  readonly colorMap: ReadonlyMap<InstantRef, TraceDeckColor>;
  readonly sortedInstantsByThread: ReadonlyMap<ThreadRef, readonly TraceInstantSource[]>;
};

export type CounterRenderData = {
  readonly counterPoints: readonly TraceCounterSource[];
  readonly positionMap: ReadonlyMap<CounterRef, [number, number, number]>;
  readonly colorMap: ReadonlyMap<CounterRef, TraceDeckColor>;
  readonly sparklineData: readonly CounterSparkline[];
  readonly sortedCountersByThread: ReadonlyMap<ThreadRef, readonly TraceCounterSource[]>;
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

export function buildTraceDeckBinaryBlockData(params: {
  /** Visible span refs to render as block rectangles. */
  readonly spans: readonly SpanRef[];
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active visualization settings used for span colors. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme used for span colors. */
  readonly colorScheme?: TraceColorScheme;
  /** Highlighted span refs used by fade-aware span color resolution. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
}): TraceDeckBinaryBlockData {
  const colorScheme = params.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME;
  const graphColorResolver = createTraceGraphColorResolver({
    traceGraph: params.traceLayout.traceGraph,
    colorScheme,
    settings: params.settings,
    highlightedSpanRefs: params.highlightedSpanRefs
  });
  const positions = new Float32Array(params.spans.length * 3);
  const sizes = new Float32Array(params.spans.length * 2);
  const fillColors = new Uint8Array(params.spans.length * 4);
  const lineColors = new Uint8Array(params.spans.length * 4);
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);

  params.spans.forEach((spanRef, index) => {
    if (
      fillTraceLayoutSpanGeometry({
        traceLayout: params.traceLayout,
        spanRef,
        target: geometry,
        context: geometryContext
      })
    ) {
      positions[index * 3] = geometry.x1;
      positions[index * 3 + 1] = geometry.y1;
      positions[index * 3 + 2] = 0;
      sizes[index * 2] = geometry.x2 - geometry.x1;
      sizes[index * 2 + 1] = geometry.y2 - geometry.y1;
    }
    fillColors.set(graphColorResolver.getSpanFillColor(spanRef, 'any'), index * 4);
    lineColors.set(graphColorResolver.getSpanBorderColor(spanRef), index * 4);
  });

  return {
    data: {
      length: params.spans.length,
      attributes: {
        getPosition: {value: positions, size: 3},
        getSize: {value: sizes, size: 2},
        getFillColor: {value: fillColors, size: 4},
        getLineColor: {value: lineColors, size: 4}
      }
    },
    spans: params.spans
  };
}

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
    intervals,
    processRows,
    processRowIndices: Uint32Array.from(processRowIndices)
  };
}

export function buildTraceDeckBinaryDependencyLineData(params: {
  /** Local dependency refs to render as straight dependency lines. */
  readonly dependencyRefs: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[];
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  readonly geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active visualization settings used for dependency opacity and warning colors. */
  readonly settings: TraceVisSettings;
}): TraceDeckBinaryDependencyLineData {
  const sourcePositions = new Float32Array(params.dependencyRefs.length * 3);
  const targetPositions = new Float32Array(params.dependencyRefs.length * 3);
  const colors = new Uint8Array(params.dependencyRefs.length * 4);
  const opacityMultiplier = getTraceDependencyOpacityMultiplier(params.settings) * 0.75;
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);

  params.dependencyRefs.forEach((dependencyRef, index) => {
    if (
      fillTraceLayoutLocalDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        target: geometry,
        context: geometryContext
      })
    ) {
      sourcePositions[index * 3] = geometry.x1;
      sourcePositions[index * 3 + 1] = geometry.y1;
      sourcePositions[index * 3 + 2] = 0;
      targetPositions[index * 3] = geometry.x2;
      targetPositions[index * 3 + 1] = geometry.y2;
      targetPositions[index * 3 + 2] = 0;
    }
    colors.set(
      applyTraceDependencyLineOpacity(
        getTraceRenderLocalDependencyLineColor(params.traceLayout, dependencyRef),
        opacityMultiplier,
        getTraceRenderDependencyVisibilityOptions(params.traceLayout, dependencyRef)
      ),
      index * 4
    );
  });

  return {
    data: {
      length: params.dependencyRefs.length,
      attributes: {
        getSourcePosition: {value: sourcePositions, size: 3},
        getTargetPosition: {value: targetPositions, size: 3},
        getColor: {value: colors, size: 4}
      }
    },
    dependencyRefs: params.dependencyRefs
  };
}

export type DerivedTraceData = {
  readonly globalEvents: GlobalEventRenderData;
  readonly instants: InstantRenderData;
  readonly counters: CounterRenderData;
  readonly legendRows: readonly TraceLayoutRow[];
};

type CacheTree = WeakMap<
  Readonly<TraceGraph>,
  WeakMap<Readonly<TraceLayout>, WeakMap<TraceColorScheme, Map<string, DerivedTraceData>>>
>;

type ProcessRenderRowCache = WeakMap<
  Readonly<TraceLayout>,
  WeakMap<CollapsedActivityByProcessRef, readonly TraceLayoutRowEnrichment[]>
>;

let derivedTraceDataCache: CacheTree = new WeakMap();
let processRenderRowCache: ProcessRenderRowCache = new WeakMap();

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
function getTraceDependencyOpacityMultiplier(settings: TraceVisSettings): number {
  const dependencyOpacity = Number.isFinite(settings.dependencyOpacity)
    ? settings.dependencyOpacity
    : 1;
  return clampUnitInterval(dependencyOpacity * (settings.showPathsOnly ? 0.2 : 1));
}

/** Folds dependency opacity into an opaque color composited over the trace background. */
function applyTraceDependencyLineOpacity(
  color: readonly [number, number, number, number],
  opacityMultiplier: number,
  options?: {minimumVisibility?: number}
): TraceDeckColor {
  const opacity = clampUnitInterval(opacityMultiplier);
  const visibility = Math.max(
    Math.sqrt(opacity),
    clampUnitInterval(options?.minimumVisibility ?? 0)
  );
  const alphaVisibility = (color[3] / 255) * visibility;
  return [
    compositeChannelOverTraceBackground(color[0], alphaVisibility),
    compositeChannelOverTraceBackground(color[1], alphaVisibility),
    compositeChannelOverTraceBackground(color[2], alphaVisibility),
    255
  ];
}

/** Composites one foreground color channel over the white trace background. */
function compositeChannelOverTraceBackground(foregroundChannel: number, alpha: number): number {
  return Math.round(foregroundChannel * alpha + 255 * (1 - alpha));
}

/** Clamps a finite number into the inclusive unit interval. */
function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

/** Returns dependency visibility overrides for warning-level local dependencies. */
function getTraceRenderDependencyVisibilityOptions(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef
): {minimumVisibility?: number} | undefined {
  return shouldShowLocalDependencyByModeFields(
    'warnings',
    traceLayout.traceGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT'),
    traceLayout.traceGraph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
  )
    ? {minimumVisibility: 1}
    : undefined;
}

/** Resolves the base local-dependency line color before opacity compositing. */
function getTraceRenderLocalDependencyLineColor(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef
): TraceDeckColor {
  if (
    shouldShowLocalDependencyByModeFields(
      'warnings',
      traceLayout.traceGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT'),
      traceLayout.traceGraph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
    )
  ) {
    return TRACE_COLOR.WARNING_DEPENDENCY_LINE;
  }
  if (traceLayout.traceGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT')) {
    return TRACE_COLOR.SUBMIT_DEPENDENCY_LINE;
  }
  return TRACE_COLOR.DEPENDENCY_LINE;
}

const EMPTY_INSTANT_RENDER_DATA: InstantRenderData = {
  visibleInstants: [],
  positionMap: new Map(),
  colorMap: new Map(),
  sortedInstantsByThread: new Map()
};

const EMPTY_COUNTER_RENDER_DATA: CounterRenderData = {
  counterPoints: [],
  positionMap: new Map(),
  colorMap: new Map(),
  sparklineData: [],
  sortedCountersByThread: new Map()
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
  colorScheme,
  settings
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  colorScheme: TraceColorScheme;
  settings: TraceVisSettings;
}): InstantRenderData {
  const colorResolver = createTraceColorResolver({colorScheme, settings});
  const positionMap = new Map<InstantRef, [number, number, number]>();
  const colorMap = new Map<InstantRef, TraceDeckColor>();
  const sortedInstantsByThread = new Map<ThreadRef, readonly TraceInstantSource[]>();
  const visibleInstants: TraceInstantSource[] = [];

  traceGraph.getThreadRefs().forEach(threadRef => {
    const instants = traceGraph.getInstantSourcesByThreadRef(threadRef);
    const streamLayout = traceLayout.threadLayoutMapByRef.get(threadRef);
    if (!streamLayout?.visible || instants.length === 0) {
      return;
    }

    const sortedInstants = [...instants].sort((a, b) => a.atTimeMs - b.atTimeMs);
    sortedInstantsByThread.set(threadRef, sortedInstants);
    const thread = getThreadColorInput({traceGraph, threadRef});
    const streamColorSource =
      colorResolver.getThreadColor(thread ?? undefined) ??
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
    colorMap,
    sortedInstantsByThread
  };
}

function buildCounterRenderData({
  traceGraph,
  traceLayout,
  colorScheme,
  settings
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  colorScheme: TraceColorScheme;
  settings: TraceVisSettings;
}): CounterRenderData {
  const colorResolver = createTraceColorResolver({colorScheme, settings});
  const positionMap = new Map<CounterRef, [number, number, number]>();
  const colorMap = new Map<CounterRef, TraceDeckColor>();
  const sortedCountersByThread = new Map<ThreadRef, readonly TraceCounterSource[]>();
  const sparklineData: CounterSparkline[] = [];
  const counterPoints: TraceCounterSource[] = [];

  traceGraph.getThreadRefs().forEach(threadRef => {
    const counters = traceGraph.getCounterSourcesByThreadRef(threadRef);
    const streamLayout = traceLayout.threadLayoutMapByRef.get(threadRef);
    if (!streamLayout?.visible || counters.length === 0) {
      return;
    }

    const sortedCounters = [...counters].sort((a, b) => a.atTimeMs - b.atTimeMs);
    sortedCountersByThread.set(threadRef, sortedCounters);
    const extent = traceGraph.getCounterExtentByThreadRef(threadRef);
    const span = extent.max - extent.min;
    const thread = getThreadColorInput({traceGraph, threadRef});
    const baseColorSource =
      colorResolver.getThreadColor(thread ?? undefined) ??
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
      sparklineData.push({threadRef, path, color});
    }
  });

  return {
    counterPoints,
    positionMap,
    colorMap,
    sparklineData,
    sortedCountersByThread
  };
}

function getDerivedFlagsKey({
  buildGlobalEvents,
  buildInstants,
  buildCounters,
  globalEventYPosition
}: {
  buildGlobalEvents: boolean;
  buildInstants: boolean;
  buildCounters: boolean;
  globalEventYPosition?: number;
}): string {
  return `${buildGlobalEvents ? '1' : '0'}:${buildInstants ? '1' : '0'}:${buildCounters ? '1' : '0'}:${Number.isFinite(globalEventYPosition) ? globalEventYPosition : ''}`;
}

export function getMemoizedDerivedTraceData(params: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  colorScheme?: TraceColorScheme;
  buildGlobalEvents?: boolean;
  buildInstants?: boolean;
  buildCounters?: boolean;
  /** Optional fixed trace-space Y position for graph-global event markers. */
  globalEventYPosition?: number;
}): DerivedTraceData {
  const {
    traceGraph,
    traceLayout,
    settings,
    colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
    buildGlobalEvents = true,
    buildInstants = true,
    buildCounters = true,
    globalEventYPosition
  } = params;
  let layoutCache = derivedTraceDataCache.get(traceGraph);
  if (!layoutCache) {
    layoutCache = new WeakMap();
    derivedTraceDataCache.set(traceGraph, layoutCache);
  }

  let colorSchemeCache = layoutCache.get(traceLayout);
  if (!colorSchemeCache) {
    colorSchemeCache = new WeakMap();
    layoutCache.set(traceLayout, colorSchemeCache);
  }

  let flagsCache = colorSchemeCache.get(colorScheme);
  if (!flagsCache) {
    flagsCache = new Map();
    colorSchemeCache.set(colorScheme, flagsCache);
  }

  const flagsKey = getDerivedFlagsKey({
    buildGlobalEvents,
    buildInstants,
    buildCounters,
    globalEventYPosition
  });
  const cached = flagsCache.get(flagsKey);
  if (cached) {
    return cached;
  }

  const buildStartTime = performance.now();
  const globalEventsStartTime = performance.now();
  const globalEvents = buildGlobalEvents
    ? buildGlobalEventRenderData({traceGraph, traceLayout, yPosition: globalEventYPosition})
    : EMPTY_GLOBAL_EVENT_RENDER_DATA;
  const globalEventsDurationMs = performance.now() - globalEventsStartTime;
  const instantsStartTime = performance.now();
  const instants = buildInstants
    ? buildInstantRenderData({traceGraph, traceLayout, colorScheme, settings})
    : EMPTY_INSTANT_RENDER_DATA;
  const instantsDurationMs = performance.now() - instantsStartTime;
  const countersStartTime = performance.now();
  const counters = buildCounters
    ? buildCounterRenderData({traceGraph, traceLayout, colorScheme, settings})
    : EMPTY_COUNTER_RENDER_DATA;
  const countersDurationMs = performance.now() - countersStartTime;

  const derived: DerivedTraceData = {
    globalEvents,
    instants,
    counters,
    legendRows: traceLayout.renderRows
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
  flagsCache.set(flagsKey, derived);
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
      collapsedActivityIntervals,
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

export function getMemoizedTraceLayoutRowEnrichments(params: {
  traceLayout: Readonly<TraceLayout>;
  /** Optional collapsed-process activity summaries keyed by process ref. */
  collapsedActivityByProcessRef?: CollapsedActivityByProcessRef;
  /** Optional batch-scoped direct geometry lookup state for overflow labels. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
}): readonly TraceLayoutRowEnrichment[] {
  const {traceLayout} = params;
  const collapsedActivityByProcessRef =
    params.collapsedActivityByProcessRef ?? EMPTY_COLLAPSED_ACTIVITY_BY_PROCESS_REF;

  let collapsedActivityCache = processRenderRowCache.get(traceLayout);
  if (!collapsedActivityCache) {
    collapsedActivityCache = new WeakMap();
    processRenderRowCache.set(traceLayout, collapsedActivityCache);
  }

  const cached = collapsedActivityCache.get(collapsedActivityByProcessRef);
  if (cached) {
    return cached;
  }

  const enrichments = buildTraceLayoutRowEnrichments({
    traceLayout,
    collapsedActivityByProcessRef,
    geometryContext: params.geometryContext
  });
  collapsedActivityCache.set(collapsedActivityByProcessRef, enrichments);
  return enrichments;
}

export function __resetDerivedTraceDataCacheForTests() {
  derivedTraceDataCache = new WeakMap() as CacheTree;
  processRenderRowCache = new WeakMap() as ProcessRenderRowCache;
}

/** Two-dimensional trace view bounds expressed as lower-left and upper-right coordinate pairs. */
export type TraceViewBounds = [[number, number], [number, number]];

/** Row-level prepared scene data that renderers consume without querying TraceGraph. */
type TracePreparedRowInputBase = {
  /** References the lightweight prepared layout row metadata. */
  readonly row: TraceLayoutRow;
  /** Carries the row-local spans needed by the foreground process renderer. */
  readonly spans: readonly SpanRef[];
  /** Carries row-local dependency refs needed by the foreground process renderer. */
  readonly dependencies: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[];
  /** Binary block attributes precomputed before renderer construction. */
  readonly binaryBlockData?: TraceDeckBinaryBlockData;
  /** Binary straight-line dependency attributes precomputed before renderer construction. */
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
  /** Stable marker id used by the minimap indicator renderer. */
  readonly id: string;
  /** Exact span ref represented by this minimap marker. */
  readonly spanRef: SpanRef;
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
  /** Optional marker fill override. */
  readonly fillColor?: readonly [number, number, number, number];
  /** Optional marker line override. */
  readonly lineColor?: readonly [number, number, number, number];
};

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

/** Reuse metadata attached to one row-level prepared process row. */
export type TracePreparedRowReuseInfo = {
  /** TraceGraph object identity that produced the row-local refs. */
  readonly traceGraph: object;
  /** Stable process ref used to match prepared rows across rank appends. */
  readonly processRef: ProcessRef;
  /** Rank/process id for the prepared row. */
  readonly processId: string;
  /** Process-table index encoded into span and local-dependency refs. */
  readonly processIndex: number | null;
  /** Whether row refs were projected while a span filter was active. */
  readonly hasActiveSpanFilter: boolean;
  /** Whether the process row was collapsed when this prepared-row metadata was captured. */
  readonly isCollapsed: boolean;
  /** Span table identity used to decide row-local span ref reuse. */
  readonly spanTable?: object | null;
  /** Span table row count used to validate append-only row ref reuse. */
  readonly spanTableRowCount: number;
  /** Process SpanRef table content generation used to reject stale global refs. */
  readonly spanTableGeneration: number | null;
  /** Snapshot of visible process SpanRefs used to build row-local span render data. */
  readonly renderSpanRefs: readonly SpanRef[];
  /** Number of visible process SpanRefs captured in {@link renderSpanRefs}. */
  readonly renderSpanRefCount: number;
  /** First visible process SpanRef captured in {@link renderSpanRefs}. */
  readonly firstRenderSpanRef: SpanRef | null;
  /** Last visible process SpanRef captured in {@link renderSpanRefs}. */
  readonly lastRenderSpanRef: SpanRef | null;
  /** Local dependency table identity used to decide dependency ref reuse. */
  readonly localDependencyTable?: object | null;
  /** Local dependency table row count used to validate append-only dependency ref reuse. */
  readonly localDependencyTableRowCount: number;
  /** Current process lane-layout object whose identity owns row-local Y coordinates. */
  readonly geometrySource: object;
  /** Small scalar key for timing origin and span height used by binary geometry derivation. */
  readonly geometryDerivationKey: string;
  /** Local dependency visibility mode used to build dependency refs. */
  readonly localDependencyMode: TraceVisSettings['localDependencyMode'];
  /** Scalar settings key for row-local binary block attributes. */
  readonly blockSettingsKey: string;
  /** Scalar settings key for row-local binary dependency attributes. */
  readonly dependencySettingsKey: string;
  /** Color scheme object used to build row-local binary block colors. */
  readonly colorScheme?: TraceColorScheme;
};

/** Row-level display input projected from TraceLayout rows and TraceGraph-visible data. */
export type TracePreparedProcessRow = TracePreparedRowInputBase & {
  /** Optional reuse metadata consumed only by prepared input builders. */
  readonly reuseInfo?: TracePreparedRowReuseInfo;
  /** Reuse metadata for row-local binary block data, which may outlive hidden collapsed layouts. */
  readonly binaryBlockReuseInfo?: TracePreparedRowReuseInfo;
  /** Reuse metadata for row-local binary dependency data, which may outlive hidden collapsed layouts. */
  readonly binaryDependencyReuseInfo?: TracePreparedRowReuseInfo;
};

/** Ref-only location of one span inside authoritative row-local binary block attributes. */
export type TracePreparedSpanBinaryLocation = {
  /** Prepared process row index containing the span's binary rectangle attributes. */
  readonly rowIndex: number;
  /** Binary block row index containing the span's rectangle attributes. */
  readonly spanIndex: number;
};

/** Layout-level prepared scene projected from one TraceLayout. */
export type TracePreparedGraphScene = {
  /** Trace graph associated with this prepared layout input. */
  readonly graph: TraceGraph;
  /** Trace layout whose rows and geometry back the prepared deck inputs. */
  readonly layout: TraceLayout;
  /** Row-aligned process inputs already projected from TraceGraph and TraceLayout. */
  readonly rows: readonly TracePreparedProcessRow[];
  /** Optional ref-only index into row-local authoritative binary span rectangle attributes. */
  readonly spanBinaryLocationByRef?: ReadonlyMap<SpanRef, TracePreparedSpanBinaryLocation>;
  /** Optional binary process activity summary used by lightweight overview renderers. */
  readonly processActivitySummaryData?: TraceDeckBinaryProcessActivityData;
  /** Already-materialized visible cross-process dependencies for this graph. */
  readonly visibleCrossDependencies: readonly TraceCrossDependencySource[];
  /** Optional deck layer id prefix for compare/minimap variants. */
  readonly layerIdPrefix?: string;
  /** Optional model matrix that positions this graph relative to the primary graph. */
  readonly modelMatrix?: Matrix4;
  /** Optional per-rank background color passed through to compatibility layer builders. */
  readonly rankBackgroundColor?: readonly [number, number, number, number];
  /** Selected and hovered span indicators preprojected into minimap layout coordinates. */
  readonly minimapSpanIndicators: readonly TracePreparedMinimapSpanIndicator[];
};

/** Copies one prepared binary span rectangle into a caller-owned target. */
export function fillTracePreparedSpanBinaryGeometry(params: {
  /** Prepared graph scene containing authoritative row-local binary block attributes. */
  readonly scene: Readonly<TracePreparedGraphScene>;
  /** Exact span ref whose prepared binary rectangle should be read. */
  readonly spanRef: SpanRef;
  /** Mutable target object that receives rectangle coordinates. */
  readonly target: TraceLayoutGeometryTuple;
}): boolean {
  const location = params.scene.spanBinaryLocationByRef?.get(params.spanRef);
  const binaryBlockData = location ? params.scene.rows[location.rowIndex]?.binaryBlockData : null;
  const positions = binaryBlockData?.data.attributes.getPosition?.value;
  const sizes = binaryBlockData?.data.attributes.getSize?.value;
  if (
    !location ||
    !(positions instanceof Float32Array) ||
    !(sizes instanceof Float32Array) ||
    binaryBlockData?.spans[location.spanIndex] !== params.spanRef
  ) {
    return fillPreparedSpanBinaryGeometryTuple(undefined, undefined, params.target);
  }
  const positionOffset = location.spanIndex * 3;
  const sizeOffset = location.spanIndex * 2;
  return fillPreparedSpanBinaryGeometryTuple(
    [positions[positionOffset], positions[positionOffset + 1]],
    [sizes[sizeOffset], sizes[sizeOffset + 1]],
    params.target
  );
}

/** Builds the ref-only index into authoritative row-local binary span attributes. */
function buildTracePreparedSpanBinaryLocationByRef(
  rows: readonly TracePreparedProcessRow[]
): ReadonlyMap<SpanRef, TracePreparedSpanBinaryLocation> {
  const spanBinaryLocationByRef = new Map<SpanRef, TracePreparedSpanBinaryLocation>();
  rows.forEach((row, rowIndex) => {
    row.binaryBlockData?.spans.forEach((spanRef, spanIndex) => {
      spanBinaryLocationByRef.set(spanRef, {rowIndex, spanIndex});
    });
  });
  return spanBinaryLocationByRef;
}

/** Copies one binary position/size pair into the shared rectangle tuple shape. */
function fillPreparedSpanBinaryGeometryTuple(
  position: readonly [number | undefined, number | undefined] | undefined,
  size: readonly [number | undefined, number | undefined] | undefined,
  target: TraceLayoutGeometryTuple
): boolean {
  const x = position?.[0];
  const y = position?.[1];
  const width = size?.[0];
  const height = size?.[1];
  target.x1 = Number.isFinite(x) ? x! : 0;
  target.y1 = Number.isFinite(y) ? y! : 0;
  target.x2 = Number.isFinite(x) && Number.isFinite(width) ? x! + width! : 0;
  target.y2 = Number.isFinite(y) && Number.isFinite(height) ? y! + height! : 0;
  return (
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(width) && Number.isFinite(height)
  );
}

/** Path highlight data projected from trace/layout state. */
export type TracePreparedPathData = {
  /** Critical-path block sources already projected from the primary TraceGraph. */
  readonly pathBlockSources: readonly TraceGraphPathBlockSource[];
  /** Critical-path dependency sources already filtered by local dependency mode. */
  readonly pathDependencySources: readonly TraceGraphPathDependencySource[];
};

/** Prepared trace scene projected from trace/layout state rather than transient selection state. */
export type TracePreparedScene = {
  /** Foreground graph scenes for the primary trace view. */
  readonly foreground: readonly TracePreparedGraphScene[];
  /** Overview/minimap graph scenes. */
  readonly overview: readonly TracePreparedGraphScene[];
  /** Critical-path sources already projected from the primary TraceGraph. */
  readonly paths: TracePreparedPathData;
};

/** Transient trace-layer data projected from hover, selection, and other overlay state. */
export type TraceSelectionPreparedScene = {
  /** Overview/minimap scenes decorated with selected and hovered span indicators. */
  readonly overview: readonly TracePreparedGraphScene[];
};

/** Parameters for decorating prepared scenes with transient selection overlay inputs. */
export type BuildTraceSelectionPreparedSceneParams = {
  /** Prepared scene whose minimap graph scenes should be decorated. */
  readonly preparedScene: TracePreparedScene;
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

/** Parameters for building all prepared trace scene inputs for a trace view. */
export type BuildTracePreparedSceneParams = {
  /** Primary filtered trace graph used for path highlighting. */
  readonly primaryTraceGraph: TraceGraph;
  /** All source trace graphs represented in the current deck view. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Filtered trace graphs aligned with traceLayouts. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Trace layouts whose render rows and geometry should be adapted for deck layers. */
  readonly traceLayouts: readonly TraceLayout[];
  /** Paths that should be highlighted in the deck view. */
  readonly paths: readonly TracePath[];
  /** Trace visualization settings that affect deck row projection. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used for collapsed-activity summaries. */
  readonly colorScheme: TraceColorScheme;
  /** Previously prepared scene that can be reused when rows are unchanged. */
  readonly previousPreparedScene?: TracePreparedScene | null;
  /** Whether collapsed process activity summaries should be projected for foreground rows. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation algorithm. Defaults to legacy density summaries. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Whether overview/minimap foreground layout inputs should be generated. */
  readonly isOverviewEnabled: boolean;
  /** Returns the model matrix for a graph index in compare mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
  /** Exact selected span refs to render as persistent minimap indicators. */
  readonly selectedSpanRefs?: readonly SpanRef[];
  /** Exact hovered span ref to render as a transient minimap indicator. */
  readonly hoveredSpanRef?: SpanRef | null;
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
  /** Filtered trace graphs aligned with traceLayouts. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Trace layouts whose rows should be projected for deck layers. */
  readonly traceLayouts: readonly TraceLayout[];
  /** Trace visualization settings that affect local dependency visibility. */
  readonly settings: TraceVisSettings;
  /** Trace color scheme used for collapsed-activity summaries. */
  readonly colorScheme: TraceColorScheme;
  /** Previously prepared foreground graph scenes aligned by graph index. */
  readonly previousScenes?: readonly TracePreparedGraphScene[] | null;
  /** Whether collapsed process activity summaries should be included. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation algorithm. Defaults to legacy density summaries. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Returns the model matrix for a graph index in compare mode. */
  readonly getTraceModelMatrixForGraph: (graphIndex: number) => Matrix4 | undefined;
};

/** Parameters for building row-level prepared deck inputs from one TraceLayout. */
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
  /** Whether visible local dependencies should be projected into each row. */
  readonly includeDependencies?: boolean;
  /** Whether overflow labels should be kept on each prepared row. */
  readonly includeOverflowLabels?: boolean;
  /** Active trace color scheme used for binary block colors. */
  readonly colorScheme?: TraceColorScheme;
  /** Previously prepared process rows from the same graph index. */
  readonly previousRows?: readonly TracePreparedProcessRow[] | null;
  /** Optional mutable probe counters filled while preparing row inputs. */
  readonly stats?: TracePreparedProcessRowsStats;
};

type TracePreparedProcessRowsStats = {
  /** Number of row span arrays projected from the current graph. */
  spanBuildCount: number;
  /** Number of row dependency arrays projected from the current graph. */
  dependencyBuildCount: number;
  /** Number of complete prepared rows whose row-local payloads were reused. */
  preparedRowReuseCount: number;
  /** Number of complete prepared rows that required any row-local payload rebuild. */
  preparedRowBuildCount: number;
  /** Number of row span arrays reused from previous prepared inputs. */
  spanReuseCount: number;
  /** Number of row dependency arrays reused from previous prepared inputs. */
  dependencyReuseCount: number;
  /** Number of binary block payloads reused from previous prepared inputs. */
  binaryBlockReuseCount: number;
  /** Number of binary block payloads rebuilt for current prepared inputs. */
  binaryBlockBuildCount: number;
  /** Number of binary block payloads translated from previous prepared inputs. */
  binaryBlockTranslateCount: number;
  /** Number of binary block payloads whose geometry changed while static attributes were reused. */
  binaryBlockGeometryRefreshCount: number;
  /** Number of binary dependency payloads reused from previous prepared inputs. */
  binaryDependencyReuseCount: number;
  /** Number of binary dependency payloads rebuilt for current prepared inputs. */
  binaryDependencyBuildCount: number;
  /** Number of binary dependency payloads translated from previous prepared inputs. */
  binaryDependencyTranslateCount: number;
  /** Number of binary dependency payloads whose geometry changed while colors were reused. */
  binaryDependencyGeometryRefreshCount: number;
  /** Number of span refs reused from previous prepared row arrays. */
  reusedSpanCount: number;
  /** Number of span refs rebuilt into current prepared row arrays. */
  builtSpanCount: number;
  /** Number of dependency refs reused from previous prepared row arrays. */
  reusedDependencyRefCount: number;
  /** Number of dependency refs rebuilt into current prepared row arrays. */
  builtDependencyRefCount: number;
  /** Number of span refs copied into row-level binary block attributes. */
  binaryBlockSpanCount: number;
  /** Number of dependency refs copied into row-level binary line attributes. */
  binaryDependencyRefCount: number;
  /** Time spent resolving row-local span refs from the TraceGraph. */
  spanRefBuildDurationMs: number;
  /** Time spent resolving row-local dependency refs from the TraceGraph or Arrow tables. */
  dependencyRefBuildDurationMs: number;
  /** Time spent building row-local binary block attribute buffers. */
  binaryBlockBuildDurationMs: number;
  /** Time spent building row-local binary dependency attribute buffers. */
  binaryDependencyBuildDurationMs: number;
  /** Time spent translating row-local binary block attribute buffers. */
  binaryBlockTranslateDurationMs: number;
  /** Time spent refreshing row-local binary span geometry while preserving static attributes. */
  binaryBlockGeometryRefreshDurationMs: number;
  /** Time spent translating row-local binary dependency attribute buffers. */
  binaryDependencyTranslateDurationMs: number;
  /** Time spent refreshing dependency endpoint geometry while preserving static attributes. */
  binaryDependencyGeometryRefreshDurationMs: number;
};

/** Parameters for building overview/minimap layout inputs. */
export type BuildTracePreparedOverviewGraphScenesParams = {
  /** Whether overview/minimap foreground layout inputs should be generated. */
  readonly isOverviewEnabled: boolean;
  /** Source trace graphs represented in the current deck view. */
  readonly sourceTraceGraphs: readonly TraceGraph[];
  /** Filtered trace graphs aligned with traceLayouts. */
  readonly traceGraphs: readonly TraceGraph[];
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
  /** Exact selected span refs to render as persistent minimap indicators. */
  readonly selectedSpanRefs?: readonly SpanRef[];
  /** Exact hovered span ref to render as a transient minimap indicator. */
  readonly hoveredSpanRef?: SpanRef | null;
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
 * Builds all TraceLayout-derived prepared scene data that previously required graph scans in React.
 */
export function buildTracePreparedScene(params: BuildTracePreparedSceneParams): TracePreparedScene {
  const previousScene = params.previousPreparedScene ?? null;
  return {
    foreground: buildTracePreparedGraphScenes({
      ...params,
      previousScenes: previousScene?.foreground ?? null
    }),
    overview: buildTracePreparedOverviewGraphScenes(params),
    paths: buildTracePreparedPathData(params)
  };
}

/**
 * Decorates prepared minimap scenes with selected and hovered span indicators.
 */
export function buildTraceSelectionPreparedScene(
  params: BuildTraceSelectionPreparedSceneParams
): TraceSelectionPreparedScene {
  return {
    overview: params.preparedScene.overview.map((scene, graphIndex) => ({
      ...scene,
      minimapSpanIndicators: buildTracePreparedMinimapSpanIndicators({
        graph: params.sourceTraceGraphs[graphIndex] ?? params.sourceTraceGraphs[0] ?? scene.graph,
        layout: scene.layout,
        settings: params.settings,
        colorScheme: params.colorScheme,
        selectedSpanRefs: params.selectedSpanRefs,
        hoveredSpanRef: params.hoveredSpanRef ?? null
      })
    }))
  };
}

/**
 * Estimates JS heap used by prepared deck inputs, including row arrays, ref arrays,
 * collapsed activity arrays, minimap indicators, paths, and row-local binary typed-array buffers.
 *
 * This intentionally uses shallow per-entry heuristics for object/array/map overhead so the
 * estimate stays cheap on large traces. Typed-array backing buffers are de-duplicated because
 * reused prepared rows can share binary payloads across rebuilds.
 */
export function estimateTracePreparedSceneSize(inputs: TracePreparedScene): number {
  const context: TracePreparedSceneSizeContext = {
    seenBuffers: new WeakSet<ArrayBufferLike>(),
    seenObjects: new WeakSet<object>()
  };
  let bytes = 0;
  bytes += estimatePreparedLayoutInputsSize(inputs.foreground, context);
  bytes += estimatePreparedLayoutInputsSize(inputs.overview, context);
  bytes += estimateArrayOwnBytes(inputs.paths.pathBlockSources.length, 80);
  bytes += estimateArrayOwnBytes(inputs.paths.pathDependencySources.length, 96);
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
  const previousScenes = params.previousScenes ?? params.previousScenes ?? null;
  traceLog.probe(0, 'buildTracePreparedGraphScenes start', {
    graphCount: params.traceLayouts.length,
    totalSpanCount: params.traceLayouts.reduce(
      (count, layout) => count + layout.traceGraph.stats.spanCount,
      0
    ),
    hasPreviousLayoutInputs: Boolean(previousScenes),
    showCollapsedActivitySummary: params.showCollapsedActivitySummary
  })();
  let collapsedActivityDurationMs = 0;
  let preparedRowsDurationMs = 0;
  let visibleCrossDependencyDurationMs = 0;
  let spanCount = 0;
  let localDependencyCount = 0;
  let visibleCrossDependencyCount = 0;
  const preparedRowsStats: TracePreparedProcessRowsStats = {
    spanBuildCount: 0,
    dependencyBuildCount: 0,
    preparedRowReuseCount: 0,
    preparedRowBuildCount: 0,
    spanReuseCount: 0,
    dependencyReuseCount: 0,
    binaryBlockReuseCount: 0,
    binaryBlockBuildCount: 0,
    binaryBlockTranslateCount: 0,
    binaryBlockGeometryRefreshCount: 0,
    binaryDependencyReuseCount: 0,
    binaryDependencyBuildCount: 0,
    binaryDependencyTranslateCount: 0,
    binaryDependencyGeometryRefreshCount: 0,
    reusedSpanCount: 0,
    builtSpanCount: 0,
    reusedDependencyRefCount: 0,
    builtDependencyRefCount: 0,
    binaryBlockSpanCount: 0,
    binaryDependencyRefCount: 0,
    spanRefBuildDurationMs: 0,
    dependencyRefBuildDurationMs: 0,
    binaryBlockBuildDurationMs: 0,
    binaryDependencyBuildDurationMs: 0,
    binaryBlockTranslateDurationMs: 0,
    binaryBlockGeometryRefreshDurationMs: 0,
    binaryDependencyTranslateDurationMs: 0,
    binaryDependencyGeometryRefreshDurationMs: 0
  };
  const result = params.traceLayouts.map((layout, graphIndex): TracePreparedGraphScene => {
    const graph = layout.traceGraph;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(layout);
    const graphBuildStartTime = performance.now();
    traceLog.probe(0, 'buildTracePreparedGraphScenes graph start', {
      graphIndex,
      graphName: graph.name,
      processCount: graph.processes.length,
      spanCount: graph.stats.spanCount,
      localDependencyCount: graph.stats.localDependencyCount,
      crossDependencyCount: graph.stats.crossDependencyCount,
      renderRowCount: layout.renderRows.length,
      hasPreviousLayoutInput: Boolean(previousScenes?.[graphIndex]),
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
    traceLog.probe(0, 'buildTracePreparedGraphScenes collapsed activity done', {
      graphIndex,
      graphName: graph.name,
      enabled: params.showCollapsedActivitySummary,
      processWithActivityCount: collapsedActivityByProcessRef?.size ?? 0,
      durationMs: performance.now() - collapsedActivityStartTime,
      ...getHeapUsageProbeFields()
    })();
    const preparedRowsStartTime = performance.now();
    traceLog.probe(0, 'buildTracePreparedGraphScenes prepared rows start', {
      graphIndex,
      graphName: graph.name,
      renderRowCount: layout.renderRows.length,
      hasPreviousRows: Boolean(previousScenes?.[graphIndex]?.rows),
      ...getHeapUsageProbeFields()
    })();
    const processRows = buildTracePreparedProcessRows({
      graph,
      layout,
      geometryContext,
      settings: params.settings,
      collapsedActivityByProcessRef,
      colorScheme: params.colorScheme,
      previousRows: previousScenes?.[graphIndex]?.rows ?? null,
      stats: preparedRowsStats
    });
    preparedRowsDurationMs += performance.now() - preparedRowsStartTime;
    traceLog.probe(0, 'buildTracePreparedGraphScenes prepared rows done', {
      graphIndex,
      graphName: graph.name,
      processRowCount: processRows.length,
      spanCount: processRows.reduce((sum, row) => sum + row.spans.length, 0),
      localDependencyCount: processRows.reduce((sum, row) => sum + row.dependencies.length, 0),
      durationMs: performance.now() - preparedRowsStartTime,
      ...getHeapUsageProbeFields()
    })();
    for (const row of processRows) {
      spanCount += row.spans.length;
      localDependencyCount += row.dependencies.length;
    }
    const visibleCrossDependencyStartTime = performance.now();
    traceLog.probe(0, 'buildTracePreparedGraphScenes visible cross dependencies start', {
      graphIndex,
      graphName: graph.name,
      crossDependencyCount: graph.stats.crossDependencyCount,
      ...getHeapUsageProbeFields()
    })();
    const visibleCrossDependencies = graph.getVisibleCrossDependencySources();
    visibleCrossDependencyDurationMs += performance.now() - visibleCrossDependencyStartTime;
    visibleCrossDependencyCount += visibleCrossDependencies.length;
    traceLog.probe(0, 'buildTracePreparedGraphScenes graph done', {
      graphIndex,
      graphName: graph.name,
      processRowCount: processRows.length,
      spanCount: processRows.reduce((sum, row) => sum + row.spans.length, 0),
      localDependencyCount: processRows.reduce((sum, row) => sum + row.dependencies.length, 0),
      visibleCrossDependencyCount: visibleCrossDependencies.length,
      visibleCrossDependencyDurationMs: performance.now() - visibleCrossDependencyStartTime,
      durationMs: performance.now() - graphBuildStartTime,
      ...getHeapUsageProbeFields()
    })();
    return {
      graph,
      layout,
      rows: processRows,
      spanBinaryLocationByRef: buildTracePreparedSpanBinaryLocationByRef(processRows),
      visibleCrossDependencies,
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
    localDependencyCount,
    visibleCrossDependencyCount,
    collapsedActivityDurationMs,
    preparedRowsDurationMs,
    visibleCrossDependencyDurationMs,
    spanBuildCount: preparedRowsStats.spanBuildCount,
    dependencyBuildCount: preparedRowsStats.dependencyBuildCount,
    preparedRowReuseCount: preparedRowsStats.preparedRowReuseCount,
    preparedRowBuildCount: preparedRowsStats.preparedRowBuildCount,
    spanReuseCount: preparedRowsStats.spanReuseCount,
    dependencyReuseCount: preparedRowsStats.dependencyReuseCount,
    binaryBlockReuseCount: preparedRowsStats.binaryBlockReuseCount,
    binaryBlockBuildCount: preparedRowsStats.binaryBlockBuildCount,
    binaryBlockTranslateCount: preparedRowsStats.binaryBlockTranslateCount,
    binaryBlockGeometryRefreshCount: preparedRowsStats.binaryBlockGeometryRefreshCount,
    binaryDependencyReuseCount: preparedRowsStats.binaryDependencyReuseCount,
    binaryDependencyBuildCount: preparedRowsStats.binaryDependencyBuildCount,
    binaryDependencyTranslateCount: preparedRowsStats.binaryDependencyTranslateCount,
    binaryDependencyGeometryRefreshCount: preparedRowsStats.binaryDependencyGeometryRefreshCount,
    reusedSpanCount: preparedRowsStats.reusedSpanCount,
    builtSpanCount: preparedRowsStats.builtSpanCount,
    reusedDependencyRefCount: preparedRowsStats.reusedDependencyRefCount,
    builtDependencyRefCount: preparedRowsStats.builtDependencyRefCount,
    binaryBlockSpanCount: preparedRowsStats.binaryBlockSpanCount,
    binaryDependencyRefCount: preparedRowsStats.binaryDependencyRefCount,
    spanRefBuildDurationMs: preparedRowsStats.spanRefBuildDurationMs,
    dependencyRefBuildDurationMs: preparedRowsStats.dependencyRefBuildDurationMs,
    binaryBlockBuildDurationMs: preparedRowsStats.binaryBlockBuildDurationMs,
    binaryDependencyBuildDurationMs: preparedRowsStats.binaryDependencyBuildDurationMs,
    binaryBlockTranslateDurationMs: preparedRowsStats.binaryBlockTranslateDurationMs,
    binaryBlockGeometryRefreshDurationMs: preparedRowsStats.binaryBlockGeometryRefreshDurationMs,
    binaryDependencyTranslateDurationMs: preparedRowsStats.binaryDependencyTranslateDurationMs,
    binaryDependencyGeometryRefreshDurationMs:
      preparedRowsStats.binaryDependencyGeometryRefreshDurationMs,
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
  const previousStats = params.stats
    ? {
        spanBuildCount: params.stats.spanBuildCount,
        dependencyBuildCount: params.stats.dependencyBuildCount,
        preparedRowReuseCount: params.stats.preparedRowReuseCount,
        preparedRowBuildCount: params.stats.preparedRowBuildCount,
        spanReuseCount: params.stats.spanReuseCount,
        dependencyReuseCount: params.stats.dependencyReuseCount,
        binaryBlockReuseCount: params.stats.binaryBlockReuseCount,
        binaryBlockBuildCount: params.stats.binaryBlockBuildCount,
        binaryBlockTranslateCount: params.stats.binaryBlockTranslateCount,
        binaryBlockGeometryRefreshCount: params.stats.binaryBlockGeometryRefreshCount,
        binaryDependencyReuseCount: params.stats.binaryDependencyReuseCount,
        binaryDependencyBuildCount: params.stats.binaryDependencyBuildCount,
        binaryDependencyTranslateCount: params.stats.binaryDependencyTranslateCount,
        binaryDependencyGeometryRefreshCount: params.stats.binaryDependencyGeometryRefreshCount,
        spanRefBuildDurationMs: params.stats.spanRefBuildDurationMs,
        dependencyRefBuildDurationMs: params.stats.dependencyRefBuildDurationMs,
        binaryBlockBuildDurationMs: params.stats.binaryBlockBuildDurationMs,
        binaryDependencyBuildDurationMs: params.stats.binaryDependencyBuildDurationMs,
        binaryBlockTranslateDurationMs: params.stats.binaryBlockTranslateDurationMs,
        binaryBlockGeometryRefreshDurationMs: params.stats.binaryBlockGeometryRefreshDurationMs,
        binaryDependencyTranslateDurationMs: params.stats.binaryDependencyTranslateDurationMs,
        binaryDependencyGeometryRefreshDurationMs:
          params.stats.binaryDependencyGeometryRefreshDurationMs
      }
    : null;
  const includeSpans = params.includeSpans ?? true;
  const includeDependencies = params.includeDependencies ?? true;
  const includeOverflowLabels = params.includeOverflowLabels ?? true;
  const geometryContext =
    params.geometryContext ??
    (includeSpans || includeDependencies || includeOverflowLabels
      ? buildTraceLayoutGeometryDerivationContext(params.layout)
      : undefined);
  traceLog.probe(0, 'buildTracePreparedProcessRows start', {
    graphName: params.graph.name,
    renderRowCount: params.layout.renderRows.length,
    includeSpans,
    includeDependencies,
    includeOverflowLabels,
    hasPreviousRows: Boolean(params.previousRows),
    previousRowCount: params.previousRows?.length ?? 0,
    ...getHeapUsageProbeFields()
  })();
  const previousRowsByIdentity = buildPreviousPreparedRowsByIdentity(params.previousRows);
  const rowEnrichments = includeOverflowLabels
    ? getMemoizedTraceLayoutRowEnrichments({
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
  const result = rowEnrichments.map(({row, collapsedActivityIntervals, overflowLabels}) => {
    const rowIsCollapsed = isTracePreparedProcessRowCollapsed(params.layout, row);
    const reuseInfo = buildTracePreparedRowReuseInfo({
      graph: params.graph,
      layout: params.layout,
      row,
      settings: params.settings,
      colorScheme: params.colorScheme,
      includeSpans,
      rowIsCollapsed
    });
    const previousRow = getPreviousPreparedRowByIdentity(previousRowsByIdentity, reuseInfo);
    let reusedSpans = false;
    let spans: readonly SpanRef[] = [];
    if (includeSpans) {
      if (canReusePreparedRowSpans(previousRow, reuseInfo)) {
        spans = previousRow?.spans ?? [];
        reusedSpans = true;
        if (params.stats) {
          params.stats.spanReuseCount += 1;
          params.stats.reusedSpanCount += spans.length;
        }
      } else {
        spans = getTracePreparedProcessRowSpans({
          reuseInfo,
          stats: params.stats
        });
      }
    }
    if (params.stats) {
      params.stats.binaryBlockSpanCount += spans.length;
    }
    let reusedDependencies = false;
    let dependencies: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[] = [];
    if (includeDependencies) {
      if (canReusePreparedRowDependencies(previousRow, reuseInfo)) {
        dependencies = previousRow?.dependencies ?? [];
        reusedDependencies = true;
        if (params.stats) {
          params.stats.dependencyReuseCount += 1;
          params.stats.reusedDependencyRefCount += dependencies.length;
        }
      } else {
        dependencies = getTracePreparedProcessRowDependencies({
          graph: params.graph,
          row,
          localDependencyMode: params.settings.localDependencyMode,
          stats: params.stats
        });
      }
    }
    if (params.stats) {
      params.stats.binaryDependencyRefCount += dependencies.length;
    }
    let reusedBinaryBlockData = false;
    let binaryBlockData: TraceDeckBinaryBlockData | undefined;
    let binaryBlockReuseInfo: TracePreparedRowReuseInfo | undefined;
    if (includeSpans) {
      if (canReusePreparedRowBinaryBlockData(previousRow, reuseInfo, spans)) {
        binaryBlockData = previousRow?.binaryBlockData;
        binaryBlockReuseInfo = getPreviousPreparedRowBinaryBlockReuseInfo(previousRow);
        reusedBinaryBlockData = true;
        if (params.stats) {
          params.stats.binaryBlockReuseCount += 1;
        }
      } else if (canRefreshPreparedRowBinaryBlockGeometry(previousRow, reuseInfo, spans)) {
        binaryBlockData = refreshTraceDeckBinaryBlockGeometry({
          previousData: previousRow!.binaryBlockData!,
          spans,
          traceLayout: params.layout,
          geometryContext,
          stats: params.stats
        });
        binaryBlockReuseInfo = reuseInfo;
        reusedBinaryBlockData = true;
      } else {
        binaryBlockData = getTracePreparedProcessRowBinaryBlockData({
          spans,
          traceLayout: params.layout,
          geometryContext,
          settings: params.settings,
          colorScheme: params.colorScheme,
          stats: params.stats
        });
        binaryBlockReuseInfo = reuseInfo;
      }
    }
    debugWarnIfExpandedPreparedRowHasInvalidBinarySpanOrLabelGeometry({
      graph: params.graph,
      layout: params.layout,
      row,
      rowIsCollapsed,
      previousRow,
      spans,
      binaryBlockData,
      reuseInfo,
      geometryContext
    });
    let reusedBinaryDependencyLineData = false;
    let binaryDependencyLineData: TraceDeckBinaryDependencyLineData | undefined;
    let binaryDependencyReuseInfo: TracePreparedRowReuseInfo | undefined;
    if (includeDependencies) {
      if (canReusePreparedRowBinaryDependencyLineData(previousRow, reuseInfo, dependencies)) {
        binaryDependencyLineData = previousRow?.binaryDependencyLineData;
        binaryDependencyReuseInfo = getPreviousPreparedRowBinaryDependencyReuseInfo(previousRow);
        reusedBinaryDependencyLineData = true;
        if (params.stats) {
          params.stats.binaryDependencyReuseCount += 1;
        }
      } else if (
        canRefreshPreparedRowBinaryDependencyGeometry(previousRow, reuseInfo, dependencies)
      ) {
        binaryDependencyLineData = refreshTraceDeckBinaryDependencyGeometry({
          previousData: previousRow!.binaryDependencyLineData!,
          dependencyRefs: dependencies,
          traceLayout: params.layout,
          geometryContext,
          stats: params.stats
        });
        binaryDependencyReuseInfo = reuseInfo;
        reusedBinaryDependencyLineData = true;
      } else {
        binaryDependencyLineData = getTracePreparedProcessRowBinaryDependencyLineData({
          dependencyRefs: dependencies,
          traceLayout: params.layout,
          geometryContext,
          settings: params.settings,
          stats: params.stats
        });
        binaryDependencyReuseInfo = reuseInfo;
      }
    }
    if (params.stats) {
      const reusedRow =
        (includeSpans ? reusedSpans && reusedBinaryBlockData : true) &&
        (includeDependencies ? reusedDependencies && reusedBinaryDependencyLineData : true);
      if (reusedRow) {
        params.stats.preparedRowReuseCount += 1;
      } else {
        params.stats.preparedRowBuildCount += 1;
      }
    }
    return {
      row,
      spans,
      dependencies,
      binaryBlockData,
      binaryBlockReuseInfo,
      binaryDependencyLineData,
      binaryDependencyReuseInfo,
      collapsedActivityIntervals,
      overflowLabels: includeOverflowLabels
        ? getMainTraceLayoutOverflowLabels(overflowLabels)
        : EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS,
      reuseInfo
    };
  });

  traceLog.probe(0, 'buildTracePreparedProcessRows done', {
    graphName: params.graph.name,
    processRowCount: result.length,
    spanCount: result.reduce((sum, row) => sum + row.spans.length, 0),
    dependencyCount: result.reduce((sum, row) => sum + row.dependencies.length, 0),
    spanBuildCount: params.stats
      ? params.stats.spanBuildCount - (previousStats?.spanBuildCount ?? 0)
      : undefined,
    dependencyBuildCount: params.stats
      ? params.stats.dependencyBuildCount - (previousStats?.dependencyBuildCount ?? 0)
      : undefined,
    preparedRowReuseCount: params.stats
      ? params.stats.preparedRowReuseCount - (previousStats?.preparedRowReuseCount ?? 0)
      : undefined,
    preparedRowBuildCount: params.stats
      ? params.stats.preparedRowBuildCount - (previousStats?.preparedRowBuildCount ?? 0)
      : undefined,
    spanReuseCount: params.stats
      ? params.stats.spanReuseCount - (previousStats?.spanReuseCount ?? 0)
      : undefined,
    dependencyReuseCount: params.stats
      ? params.stats.dependencyReuseCount - (previousStats?.dependencyReuseCount ?? 0)
      : undefined,
    binaryBlockReuseCount: params.stats
      ? params.stats.binaryBlockReuseCount - (previousStats?.binaryBlockReuseCount ?? 0)
      : undefined,
    binaryBlockBuildCount: params.stats
      ? params.stats.binaryBlockBuildCount - (previousStats?.binaryBlockBuildCount ?? 0)
      : undefined,
    binaryBlockTranslateCount: params.stats
      ? params.stats.binaryBlockTranslateCount - (previousStats?.binaryBlockTranslateCount ?? 0)
      : undefined,
    binaryBlockGeometryRefreshCount: params.stats
      ? params.stats.binaryBlockGeometryRefreshCount -
        (previousStats?.binaryBlockGeometryRefreshCount ?? 0)
      : undefined,
    binaryDependencyReuseCount: params.stats
      ? params.stats.binaryDependencyReuseCount - (previousStats?.binaryDependencyReuseCount ?? 0)
      : undefined,
    binaryDependencyBuildCount: params.stats
      ? params.stats.binaryDependencyBuildCount - (previousStats?.binaryDependencyBuildCount ?? 0)
      : undefined,
    binaryDependencyTranslateCount: params.stats
      ? params.stats.binaryDependencyTranslateCount -
        (previousStats?.binaryDependencyTranslateCount ?? 0)
      : undefined,
    binaryDependencyGeometryRefreshCount: params.stats
      ? params.stats.binaryDependencyGeometryRefreshCount -
        (previousStats?.binaryDependencyGeometryRefreshCount ?? 0)
      : undefined,
    spanRefBuildDurationMs: params.stats
      ? params.stats.spanRefBuildDurationMs - (previousStats?.spanRefBuildDurationMs ?? 0)
      : undefined,
    dependencyRefBuildDurationMs: params.stats
      ? params.stats.dependencyRefBuildDurationMs -
        (previousStats?.dependencyRefBuildDurationMs ?? 0)
      : undefined,
    binaryBlockBuildDurationMs: params.stats
      ? params.stats.binaryBlockBuildDurationMs - (previousStats?.binaryBlockBuildDurationMs ?? 0)
      : undefined,
    binaryDependencyBuildDurationMs: params.stats
      ? params.stats.binaryDependencyBuildDurationMs -
        (previousStats?.binaryDependencyBuildDurationMs ?? 0)
      : undefined,
    binaryBlockTranslateDurationMs: params.stats
      ? params.stats.binaryBlockTranslateDurationMs -
        (previousStats?.binaryBlockTranslateDurationMs ?? 0)
      : undefined,
    binaryBlockGeometryRefreshDurationMs: params.stats
      ? params.stats.binaryBlockGeometryRefreshDurationMs -
        (previousStats?.binaryBlockGeometryRefreshDurationMs ?? 0)
      : undefined,
    binaryDependencyTranslateDurationMs: params.stats
      ? params.stats.binaryDependencyTranslateDurationMs -
        (previousStats?.binaryDependencyTranslateDurationMs ?? 0)
      : undefined,
    binaryDependencyGeometryRefreshDurationMs: params.stats
      ? params.stats.binaryDependencyGeometryRefreshDurationMs -
        (previousStats?.binaryDependencyGeometryRefreshDurationMs ?? 0)
      : undefined,
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
    const sourceGraph = params.sourceTraceGraphs[graphIndex] ?? params.sourceTraceGraphs[0];
    const layout =
      (params.traceLayouts[graphIndex] ?? params.traceLayouts[0])?.minimapLayout?.traceLayout ??
      params.traceLayouts[0]?.minimapLayout?.traceLayout;
    if (!layout || !sourceGraph) {
      return [];
    }
    const graph = layout.traceGraph;
    const geometryLayout = params.traceLayouts[graphIndex] ?? params.traceLayouts[0] ?? layout;
    const geometryContext = buildTraceLayoutGeometryDerivationContext(geometryLayout);
    const collapsedActivityStartTime = performance.now();
    const collapsedActivityByProcessRef = buildTracePreparedCollapsedActivityByProcessRef({
      graph,
      layout,
      geometryLayout,
      geometryContext,
      colorScheme: params.colorScheme,
      settings: params.settings,
      aggregation: params.collapsedActivityAggregation
    });
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
    const processActivitySummaryData = buildTraceDeckBinaryProcessActivityData({
      rows: processRows,
      traceLayout: layout,
      settings: params.settings
    });
    preparedRowsDurationMs += performance.now() - preparedRowsStartTime;

    return {
      graph,
      layout,
      rows: processRows,
      spanBinaryLocationByRef: buildTracePreparedSpanBinaryLocationByRef(processRows),
      processActivitySummaryData,
      visibleCrossDependencies: [],
      layerIdPrefix:
        params.sourceTraceGraphs.length > 1 ? `minimap-trace-graph-${graphIndex}` : 'minimap-trace',
      modelMatrix: params.getTraceModelMatrixForGraph(graphIndex),
      rankBackgroundColor: getTraceDeckRankBackgroundColor(graphIndex),
      minimapSpanIndicators: buildTracePreparedMinimapSpanIndicators({
        graph: sourceGraph,
        layout,
        settings: params.settings,
        colorScheme: params.colorScheme,
        selectedSpanRefs: params.selectedSpanRefs ?? [],
        hoveredSpanRef: params.hoveredSpanRef ?? null
      })
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
  const colorResolver = createTraceColorResolver({colorScheme, settings});

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

/** Returns main-view overflow labels without allocating for empty or already-filtered inputs. */
function getMainTraceLayoutOverflowLabels(
  overflowLabels: readonly TraceLayoutOverflowLabelDatum[]
): readonly TraceLayoutOverflowLabelDatum[] {
  if (overflowLabels.length === 0) {
    return EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS;
  }

  let filteredLabels: TraceLayoutOverflowLabelDatum[] | undefined;
  for (let index = 0; index < overflowLabels.length; index += 1) {
    const overflowLabel = overflowLabels[index]!;
    if (overflowLabel.view === 'main') {
      filteredLabels?.push(overflowLabel);
    } else if (!filteredLabels) {
      filteredLabels = overflowLabels.slice(0, index);
    }
  }

  if (!filteredLabels) {
    return overflowLabels;
  }
  return filteredLabels.length > 0 ? filteredLabels : EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS;
}

/** Builds lookup maps for previous prepared rows keyed by stable process identities. */
function buildPreviousPreparedRowsByIdentity(
  previousRows: readonly TracePreparedProcessRow[] | null | undefined
): {
  readonly byProcessRef: ReadonlyMap<ProcessRef, TracePreparedProcessRow>;
} {
  const rowsByProcessRef = new Map<ProcessRef, TracePreparedProcessRow>();
  for (const row of previousRows ?? []) {
    const processRef = row.reuseInfo?.processRef ?? row.row.processRef;
    rowsByProcessRef.set(processRef, row);
  }
  return {byProcessRef: rowsByProcessRef};
}

/** Returns the previous prepared row for a process, tolerating rank-order insertions. */
function getPreviousPreparedRowByIdentity(
  previousRows: ReturnType<typeof buildPreviousPreparedRowsByIdentity>,
  reuseInfo: TracePreparedRowReuseInfo
): TracePreparedProcessRow | undefined {
  const row = previousRows.byProcessRef.get(reuseInfo.processRef);
  return row?.reuseInfo?.processId === reuseInfo.processId ? row : undefined;
}

function buildTracePreparedRowReuseInfo(params: {
  readonly graph: TraceGraph;
  readonly layout: TraceLayout;
  readonly row: TraceLayoutRow;
  readonly settings: TraceVisSettings;
  readonly colorScheme?: TraceColorScheme;
  /** Whether the prepared row should retain render span refs and binary span geometry. */
  readonly includeSpans: boolean;
  /** Whether the current layout keeps this process row collapsed. */
  readonly rowIsCollapsed: boolean;
}): TracePreparedRowReuseInfo {
  const geometrySource = getTraceLayoutProcessLayoutByRef(params.layout, params.row.processRef);
  const processId = params.row.processId as TraceProcessId;
  const spanTable = params.graph.processSpanTableMap[processId] ?? null;
  const localDependencyTable = params.graph.localDependencyTableMap[processId] ?? null;
  const processIndex = params.graph.processIdsByIndex.indexOf(processId);
  const renderSpanRefs = params.includeSpans
    ? getTracePreparedRowRenderSpanRefs(params.graph, params.row)
    : EMPTY_TRACE_PREPARED_ROW_SPAN_REFS;
  return {
    traceGraph: params.graph,
    processRef: params.row.processRef,
    processId: params.row.processId,
    processIndex: processIndex >= 0 ? processIndex : null,
    hasActiveSpanFilter: params.graph.hasActiveSpanFilter(),
    isCollapsed: params.rowIsCollapsed,
    spanTable,
    spanTableRowCount: spanTable?.numRows ?? 0,
    spanTableGeneration: spanTable?.generation ?? null,
    renderSpanRefs,
    renderSpanRefCount: renderSpanRefs.length,
    firstRenderSpanRef: renderSpanRefs[0] ?? null,
    lastRenderSpanRef: renderSpanRefs[renderSpanRefs.length - 1] ?? null,
    localDependencyTable,
    localDependencyTableRowCount: localDependencyTable?.numRows ?? 0,
    geometrySource: geometrySource ?? params.layout,
    geometryDerivationKey: buildTracePreparedRowGeometryDerivationKey(params.layout),
    localDependencyMode: params.settings.localDependencyMode,
    blockSettingsKey: buildTraceDeckBinaryBlockSettingsKey(params.settings),
    dependencySettingsKey: buildTraceDeckBinaryDependencySettingsKey(params.settings),
    colorScheme: params.colorScheme
  };
}

/** Returns row span refs, snapshotting mutable unfiltered process views before binary reuse. */
function getTracePreparedRowRenderSpanRefs(
  graph: TraceGraph,
  row: TraceLayoutRow
): readonly SpanRef[] {
  const spanRefs = graph.getVisibleProcessRenderSpanRefs(row.processRef);
  return graph.hasActiveSpanFilter() ? spanRefs : [...spanRefs];
}

function canReusePreparedRowSpans(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo
): boolean {
  const previousInfo = previousRow?.reuseInfo;
  return !!(
    previousInfo &&
    !previousInfo.hasActiveSpanFilter &&
    !reuseInfo.hasActiveSpanFilter &&
    previousInfo.processId === reuseInfo.processId &&
    canReusePreparedRowEncodedRefs(previousInfo, reuseInfo) &&
    canReusePreparedRowSpanRefs(previousInfo, reuseInfo)
  );
}

/** Returns whether captured visible process SpanRefs still describe the same row membership. */
function canReusePreparedRowSpanRefs(
  previousInfo: TracePreparedRowReuseInfo,
  reuseInfo: TracePreparedRowReuseInfo
): boolean {
  return (
    previousInfo.renderSpanRefCount === reuseInfo.renderSpanRefCount &&
    previousInfo.firstRenderSpanRef === reuseInfo.firstRenderSpanRef &&
    previousInfo.lastRenderSpanRef === reuseInfo.lastRenderSpanRef &&
    canReusePreparedRowTable(previousInfo, reuseInfo, 'span')
  );
}

function canReusePreparedRowDependencies(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo
): boolean {
  const previousInfo = previousRow?.reuseInfo;
  return !!(
    previousInfo &&
    !previousInfo.hasActiveSpanFilter &&
    !reuseInfo.hasActiveSpanFilter &&
    previousInfo.processId === reuseInfo.processId &&
    canReusePreparedRowEncodedRefs(previousInfo, reuseInfo) &&
    canReusePreparedRowTable(previousInfo, reuseInfo, 'local-dependency') &&
    previousInfo.localDependencyMode === reuseInfo.localDependencyMode
  );
}

/** Returns whether row refs encoded for the previous graph still address the same process. */
function canReusePreparedRowEncodedRefs(
  previousInfo: TracePreparedRowReuseInfo,
  reuseInfo: TracePreparedRowReuseInfo
): boolean {
  return (
    previousInfo.processIndex === reuseInfo.processIndex &&
    previousInfo.processIndex != null &&
    (previousInfo.traceGraph === reuseInfo.traceGraph ||
      previousInfo.processRef === reuseInfo.processRef)
  );
}

/** Returns whether the relevant row-local source table is unchanged or append-only stable. */
function canReusePreparedRowTable(
  previousInfo: TracePreparedRowReuseInfo,
  reuseInfo: TracePreparedRowReuseInfo,
  tableKind: 'span' | 'local-dependency'
): boolean {
  if (tableKind === 'span') {
    return (
      previousInfo.spanTable === reuseInfo.spanTable ||
      (previousInfo.traceGraph === reuseInfo.traceGraph &&
        previousInfo.spanTableRowCount === reuseInfo.spanTableRowCount &&
        previousInfo.spanTableGeneration === reuseInfo.spanTableGeneration)
    );
  }
  return (
    previousInfo.localDependencyTable === reuseInfo.localDependencyTable ||
    (previousInfo.traceGraph === reuseInfo.traceGraph &&
      previousInfo.localDependencyTableRowCount === reuseInfo.localDependencyTableRowCount)
  );
}

function canReusePreparedRowBinaryBlockData(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo,
  spans: readonly SpanRef[]
): boolean {
  const previousInfo = getPreviousPreparedRowBinaryBlockReuseInfo(previousRow);
  return !!(
    previousInfo &&
    previousRow?.binaryBlockData &&
    previousRow.spans === spans &&
    previousInfo.isCollapsed === reuseInfo.isCollapsed &&
    canReusePreparedRowGeometry(previousInfo, reuseInfo) &&
    previousInfo.blockSettingsKey === reuseInfo.blockSettingsKey &&
    previousInfo.colorScheme === reuseInfo.colorScheme
  );
}

function getPreviousPreparedRowBinaryBlockReuseInfo(
  previousRow: TracePreparedProcessRow | undefined
): TracePreparedRowReuseInfo | undefined {
  return previousRow?.binaryBlockReuseInfo ?? previousRow?.reuseInfo;
}

/**
 * Returns whether row-local binary span geometry can be regenerated while reusing static buffers.
 */
function canRefreshPreparedRowBinaryBlockGeometry(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo,
  spans: readonly SpanRef[]
): boolean {
  const previousInfo = getPreviousPreparedRowBinaryBlockReuseInfo(previousRow);
  return !!(
    previousInfo &&
    previousRow?.binaryBlockData &&
    previousRow.spans === spans &&
    previousInfo.processId === reuseInfo.processId &&
    previousInfo.blockSettingsKey === reuseInfo.blockSettingsKey &&
    previousInfo.colorScheme === reuseInfo.colorScheme
  );
}

function canReusePreparedRowBinaryDependencyLineData(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo,
  dependencies: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[]
): boolean {
  const previousInfo = getPreviousPreparedRowBinaryDependencyReuseInfo(previousRow);
  return !!(
    previousInfo &&
    previousRow?.binaryDependencyLineData &&
    previousRow.dependencies === dependencies &&
    canReusePreparedRowGeometry(previousInfo, reuseInfo) &&
    previousInfo.dependencySettingsKey === reuseInfo.dependencySettingsKey
  );
}

function getPreviousPreparedRowBinaryDependencyReuseInfo(
  previousRow: TracePreparedProcessRow | undefined
): TracePreparedRowReuseInfo | undefined {
  return previousRow?.binaryDependencyReuseInfo ?? previousRow?.reuseInfo;
}

/**
 * Returns whether dependency endpoint geometry can be regenerated while reusing static colors.
 */
function canRefreshPreparedRowBinaryDependencyGeometry(
  previousRow: TracePreparedProcessRow | undefined,
  reuseInfo: TracePreparedRowReuseInfo,
  dependencies: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[]
): boolean {
  const previousInfo = getPreviousPreparedRowBinaryDependencyReuseInfo(previousRow);
  return !!(
    previousInfo &&
    previousRow?.binaryDependencyLineData &&
    previousRow.dependencies === dependencies &&
    previousInfo.processId === reuseInfo.processId &&
    previousInfo.dependencySettingsKey === reuseInfo.dependencySettingsKey
  );
}

function canReusePreparedRowGeometry(
  previousInfo: TracePreparedRowReuseInfo,
  reuseInfo: TracePreparedRowReuseInfo
): boolean {
  return (
    previousInfo.geometrySource === reuseInfo.geometrySource &&
    previousInfo.geometryDerivationKey === reuseInfo.geometryDerivationKey
  );
}

function isTracePreparedProcessRowCollapsed(layout: TraceLayout, row: TraceLayoutRow): boolean {
  const processLayout = getTraceLayoutProcessLayoutByRef(layout, row.processRef);
  return processLayout ? processLayout.isCollapsed === true : Boolean(row.isCollapsed);
}

/** Warns when one process expansion leaves prepared binary span or label inputs invalid. */
function debugWarnIfExpandedPreparedRowHasInvalidBinarySpanOrLabelGeometry(params: {
  /** Trace graph owning the expanded process row. */
  graph: TraceGraph;
  /** Current expanded trace layout used to read process collapse state. */
  layout: TraceLayout;
  /** Current prepared process row metadata. */
  row: TraceLayoutRow;
  /** Whether the current row still resolves as collapsed. */
  rowIsCollapsed: boolean;
  /** Previously prepared row for the same process before the current rebuild. */
  previousRow: TracePreparedProcessRow | undefined;
  /** Span refs passed to both block and label renderer inputs for this row. */
  spans: readonly SpanRef[];
  /** Current row-local binary block payload used by rectangle and label geometry accessors. */
  binaryBlockData: TraceDeckBinaryBlockData | undefined;
  /** Current prepared-row reuse metadata used to identify the geometry source. */
  reuseInfo: TracePreparedRowReuseInfo;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
}): void {
  const previousRowWasCollapsed = Boolean(
    params.previousRow?.reuseInfo?.isCollapsed ?? params.previousRow?.row.isCollapsed
  );
  const binaryPositions = params.binaryBlockData?.data.attributes.getPosition?.value;
  const binarySizes = params.binaryBlockData?.data.attributes.getSize?.value;
  if (params.rowIsCollapsed || !previousRowWasCollapsed || params.spans.length === 0) {
    return;
  }

  const hasBinaryPositions = binaryPositions instanceof Float32Array;
  const hasBinarySizes = binarySizes instanceof Float32Array;
  const missingSpanThreadLayoutRefs: SpanRef[] = [];
  const missingSpanLaneAllocationRefs: SpanRef[] = [];
  const missingCurrentLayoutSpanGeometryRefs: SpanRef[] = [];
  const zeroHeightCurrentLayoutSpanGeometryRefs: SpanRef[] = [];
  const staleBinarySpanGeometryRefs: SpanRef[] = [];
  const zeroHeightSpanRefs: SpanRef[] = [];
  const invalidSpanLabelRows: {
    /** Span-label row index used by deck.gl objectInfo. */
    readonly spanIndex: number;
    /** Span ref passed through the prepared label data array. */
    readonly spanRef: SpanRef;
    /** Span ref carried by the binary rectangle row at the same index. */
    readonly binarySpanRef: SpanRef | undefined;
    /** Current display text resolved for the label row. */
    readonly spanName: string;
    /** X coordinate read by the binary label position accessor. */
    readonly x: number | undefined;
    /** Y coordinate read by the binary label position accessor. */
    readonly y: number | undefined;
    /** Width read by the binary label clip accessor. */
    readonly width: number | undefined;
    /** Height read by the binary label geometry guard. */
    readonly height: number | undefined;
    /** Runtime thread ref resolved from the current span ref. */
    readonly threadRef: ThreadRef | undefined;
    /** Whether the current expanded layout has a thread layout for the span. */
    readonly threadLayoutExists: boolean;
    /** Whether auto span layout assigned the current span ref into a lane. */
    readonly spanLaneAllocated: boolean | null;
    /** Whether current timing plus lane layout derives any span rectangle. */
    readonly currentLayoutHasSpanGeometry: boolean;
    /** Height derived directly from current timing plus lane layout. */
    readonly currentLayoutSpanHeight: number | undefined;
    /** Whether the prepared label row still matches the binary rectangle row. */
    readonly binarySpanRefMatches: boolean;
    /** Whether the label anchor can resolve to a finite trace position. */
    readonly labelPositionIsFinite: boolean;
    /** Whether the label clip rect keeps a non-empty content box. */
    readonly labelClipRectIsNonEmpty: boolean;
  }[] = [];
  let positiveHeightSpanCount = 0;
  let missingHeightSpanCount = 0;
  let emptySpanLabelTextCount = 0;
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.layout);
  for (let spanIndex = 0; spanIndex < params.spans.length; spanIndex += 1) {
    const spanRef = params.spans[spanIndex]!;
    const binarySpanRef = params.binaryBlockData?.spans[spanIndex];
    const x = hasBinaryPositions ? binaryPositions[spanIndex * 3] : undefined;
    const y = hasBinaryPositions ? binaryPositions[spanIndex * 3 + 1] : undefined;
    const width = hasBinarySizes ? binarySizes[spanIndex * 2] : undefined;
    const height = hasBinarySizes ? binarySizes[spanIndex * 2 + 1] : undefined;
    const threadRef = params.graph.getThreadRefBySpanRef(spanRef) ?? undefined;
    const threadLayout =
      threadRef == null ? undefined : params.layout.threadLayoutMapByRef.get(threadRef);
    const spanLaneAllocated =
      params.graph.spanLayout === 'auto'
        ? threadLayout?.spanLaneMap == null || threadLayout.spanLaneMap.has(spanRef)
        : null;
    const currentLayoutSpanGeometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    const currentLayoutHasSpanGeometry = fillTraceLayoutSpanGeometry({
      traceLayout: params.layout,
      spanRef,
      target: currentLayoutSpanGeometry,
      context: geometryContext
    });
    const currentLayoutSpanHeight = currentLayoutHasSpanGeometry
      ? currentLayoutSpanGeometry.y2 - currentLayoutSpanGeometry.y1
      : undefined;
    const spanName = params.graph.getSpanName(spanRef) ?? '';
    const binarySpanRefMatches = binarySpanRef === spanRef;
    const labelPositionIsFinite = Number.isFinite(x) && Number.isFinite(y);
    const labelClipRectIsNonEmpty =
      typeof width === 'number' &&
      Number.isFinite(width) &&
      width > 0 &&
      typeof height === 'number' &&
      Number.isFinite(height) &&
      height > 0;
    if (threadLayout == null) {
      missingSpanThreadLayoutRefs.push(spanRef);
    }
    if (spanLaneAllocated === false) {
      missingSpanLaneAllocationRefs.push(spanRef);
    }
    if (!currentLayoutHasSpanGeometry) {
      missingCurrentLayoutSpanGeometryRefs.push(spanRef);
    } else if (
      typeof currentLayoutSpanHeight !== 'number' ||
      !Number.isFinite(currentLayoutSpanHeight) ||
      currentLayoutSpanHeight <= 0
    ) {
      zeroHeightCurrentLayoutSpanGeometryRefs.push(spanRef);
    }
    if (spanName.length === 0) {
      emptySpanLabelTextCount += 1;
    }
    if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
      positiveHeightSpanCount += 1;
    } else {
      zeroHeightSpanRefs.push(spanRef);
      if (typeof height !== 'number' || !Number.isFinite(height)) {
        missingHeightSpanCount += 1;
      }
    }
    if (
      typeof currentLayoutSpanHeight === 'number' &&
      Number.isFinite(currentLayoutSpanHeight) &&
      currentLayoutSpanHeight > 0 &&
      !(typeof height === 'number' && Number.isFinite(height) && height > 0)
    ) {
      staleBinarySpanGeometryRefs.push(spanRef);
    }
    if (!binarySpanRefMatches || !labelPositionIsFinite || !labelClipRectIsNonEmpty) {
      invalidSpanLabelRows.push({
        spanIndex,
        spanRef,
        binarySpanRef,
        spanName,
        x,
        y,
        width,
        height,
        threadRef,
        threadLayoutExists: threadLayout != null,
        spanLaneAllocated,
        currentLayoutHasSpanGeometry,
        currentLayoutSpanHeight,
        binarySpanRefMatches,
        labelPositionIsFinite,
        labelClipRectIsNonEmpty
      });
    }
  }
  if (
    missingSpanThreadLayoutRefs.length === 0 &&
    missingSpanLaneAllocationRefs.length === 0 &&
    missingCurrentLayoutSpanGeometryRefs.length === 0 &&
    zeroHeightCurrentLayoutSpanGeometryRefs.length === 0 &&
    staleBinarySpanGeometryRefs.length === 0 &&
    zeroHeightSpanRefs.length === 0 &&
    invalidSpanLabelRows.length === 0
  ) {
    return;
  }

  const processLayout = getTraceLayoutProcessLayoutByRef(params.layout, params.row.processRef);
  console.warn(
    '%c[tracevis] Expanded trace process row has invalid binary span or label geometry after expansion',
    'color: #dc2626; font-weight: 700;',
    {
      graphName: params.graph.name,
      processId: params.row.processId,
      processRef: params.row.processRef,
      spanCount: params.spans.length,
      binarySpanCount: params.binaryBlockData?.spans.length ?? 0,
      hasBinaryPositions,
      hasBinarySizes,
      missingSpanThreadLayoutCount: missingSpanThreadLayoutRefs.length,
      missingSpanThreadLayoutRefs: missingSpanThreadLayoutRefs.slice(0, 16),
      missingSpanThreadLayoutRefsTruncated: missingSpanThreadLayoutRefs.length > 16,
      missingSpanLaneAllocationCount: missingSpanLaneAllocationRefs.length,
      missingSpanLaneAllocationRefs: missingSpanLaneAllocationRefs.slice(0, 16),
      missingSpanLaneAllocationRefsTruncated: missingSpanLaneAllocationRefs.length > 16,
      missingCurrentLayoutSpanGeometryCount: missingCurrentLayoutSpanGeometryRefs.length,
      missingCurrentLayoutSpanGeometryRefs: missingCurrentLayoutSpanGeometryRefs.slice(0, 16),
      missingCurrentLayoutSpanGeometryRefsTruncated:
        missingCurrentLayoutSpanGeometryRefs.length > 16,
      zeroHeightCurrentLayoutSpanGeometryCount: zeroHeightCurrentLayoutSpanGeometryRefs.length,
      zeroHeightCurrentLayoutSpanGeometryRefs: zeroHeightCurrentLayoutSpanGeometryRefs.slice(0, 16),
      zeroHeightCurrentLayoutSpanGeometryRefsTruncated:
        zeroHeightCurrentLayoutSpanGeometryRefs.length > 16,
      staleBinarySpanGeometryCount: staleBinarySpanGeometryRefs.length,
      staleBinarySpanGeometryRefs: staleBinarySpanGeometryRefs.slice(0, 16),
      staleBinarySpanGeometryRefsTruncated: staleBinarySpanGeometryRefs.length > 16,
      zeroHeightSpanCount: zeroHeightSpanRefs.length,
      positiveHeightSpanCount,
      missingHeightSpanCount,
      zeroHeightSpanRefs: zeroHeightSpanRefs.slice(0, 16),
      zeroHeightSpanRefsTruncated: zeroHeightSpanRefs.length > 16,
      invalidSpanLabelRowCount: invalidSpanLabelRows.length,
      invalidSpanLabelRows: invalidSpanLabelRows.slice(0, 16),
      invalidSpanLabelRowsTruncated: invalidSpanLabelRows.length > 16,
      emptySpanLabelTextCount,
      previousRowWasCollapsed,
      rowIsCollapsed: params.rowIsCollapsed,
      processLayoutIsCollapsed: processLayout?.isCollapsed ?? null,
      binaryBlockDataWasReused: params.previousRow?.binaryBlockData === params.binaryBlockData,
      binarySpanRefsArePreparedSpanRefs: params.binaryBlockData?.spans === params.spans,
      geometryDerivationKey: params.reuseInfo.geometryDerivationKey
    }
  );
}

/** Builds the small scalar inputs that affect derived row-local binary coordinates. */
function buildTracePreparedRowGeometryDerivationKey(layout: Readonly<TraceLayout>): string {
  const configuration = layout.layoutConfiguration;
  return [
    configuration?.timingKey ?? '',
    configuration?.minTimeMs ?? layout.traceGraph.minTimeMs,
    configuration?.spanHeight ?? 0.3
  ].join('|');
}

function buildTraceDeckBinaryBlockSettingsKey(settings: TraceVisSettings): string {
  return [
    settings.traceColorSchemeId,
    settings.showPathsOnly ? 1 : 0,
    settings.followCriticalPathAnimationMode ?? '',
    settings.minSpanTimeMs,
    settings.highlightFadeFactor ?? '',
    settings.extendedSelectionFadeOpacity ?? '',
    settings.useExtendedSelectionFadeOpacity === true ? 1 : 0
  ].join('|');
}

function buildTraceDeckBinaryDependencySettingsKey(settings: TraceVisSettings): string {
  return [settings.dependencyOpacity, settings.showPathsOnly ? 1 : 0].join('|');
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
  readonly colorResolver: ReturnType<typeof createTraceColorResolver>;
  readonly spanRef: SpanRef;
  readonly kind: TracePreparedMinimapSpanIndicator['kind'];
}): TracePreparedMinimapSpanIndicator | null {
  const span = graph.getTraceSpanCardModel(spanRef)?.span;
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

  const spanFillColor = colorResolver.getSpanFillColor(span);

  return {
    id: `${kind}-${spanRef}`,
    spanRef,
    kind,
    x: spanXRange.x,
    startX: spanXRange.startX,
    endX: spanXRange.endX,
    y,
    fillColor: getTracePreparedMinimapSpanIndicatorFillColor(spanFillColor, kind),
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
  readonly span: NonNullable<ReturnType<TraceGraph['getTraceSpanCardModel']>>['span'];
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

/** Returns the pin/dot fill color for a minimap span indicator using the span color hue. */
function getTracePreparedMinimapSpanIndicatorFillColor(
  spanColor: readonly [number, number, number, number],
  kind: TracePreparedMinimapSpanIndicator['kind']
): readonly [number, number, number, number] {
  return [spanColor[0], spanColor[1], spanColor[2], kind === 'selected' ? 245 : 205];
}

/** Returns the hairline color for a minimap span indicator using the span color hue. */
function getTracePreparedMinimapSpanIndicatorLineColor(
  spanColor: readonly [number, number, number, number],
  kind: TracePreparedMinimapSpanIndicator['kind']
): readonly [number, number, number, number] {
  return [spanColor[0], spanColor[1], spanColor[2], kind === 'selected' ? 190 : 130];
}

/** Returns row-local spans for the current graph. */
function getTracePreparedProcessRowSpans(params: {
  /** Row-local reuse metadata resolving the current prepared spans. */
  reuseInfo: TracePreparedRowReuseInfo;
  stats?: TracePreparedProcessRowsStats;
}): readonly SpanRef[] {
  if (params.stats) {
    params.stats.spanBuildCount += 1;
  }
  const buildStartTime = performance.now();
  const spanRefs = params.reuseInfo.renderSpanRefs;
  if (params.stats) {
    params.stats.spanRefBuildDurationMs += performance.now() - buildStartTime;
    params.stats.builtSpanCount += spanRefs.length;
  }
  return spanRefs;
}

/** Returns row-local local dependencies for the current graph. */
function getTracePreparedProcessRowDependencies(params: {
  graph: TraceGraph;
  row: TraceLayoutRow;
  localDependencyMode: TraceVisSettings['localDependencyMode'];
  stats?: TracePreparedProcessRowsStats;
}): readonly (TraceDependencyRef | VisibleLocalDependencyRef)[] {
  if (params.stats) {
    params.stats.dependencyBuildCount += 1;
  }
  const buildStartTime = performance.now();
  const dependencyRefs = getTracePreparedProcessRowDependencyRefs(params);
  if (params.stats) {
    params.stats.dependencyRefBuildDurationMs += performance.now() - buildStartTime;
    params.stats.builtDependencyRefCount += dependencyRefs.length;
  }
  return dependencyRefs;
}

/** Returns row-local binary block attributes. */
function getTracePreparedProcessRowBinaryBlockData(params: {
  /** Stable visible span refs represented by the row-local binary payload. */
  spans: readonly SpanRef[];
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active visualization settings used for span colors. */
  settings: TraceVisSettings;
  /** Active trace color scheme used for span colors. */
  colorScheme?: TraceColorScheme;
  /** Optional mutable probe counters filled while preparing row inputs. */
  stats?: TracePreparedProcessRowsStats;
}): TraceDeckBinaryBlockData {
  const buildStartTime = performance.now();
  const data = buildTraceDeckBinaryBlockData({
    spans: params.spans,
    traceLayout: params.traceLayout,
    geometryContext: params.geometryContext,
    settings: params.settings,
    colorScheme: params.colorScheme
  });
  if (params.stats) {
    params.stats.binaryBlockBuildCount += 1;
    params.stats.binaryBlockBuildDurationMs += performance.now() - buildStartTime;
  }
  return data;
}

/** Returns row-local binary straight dependency attributes. */
function getTracePreparedProcessRowBinaryDependencyLineData(params: {
  /** Stable visible dependency refs represented by the row-local binary payload. */
  dependencyRefs: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[];
  /** Layout containing current span timing, lane state, and TraceGraph accessors. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Active visualization settings used for dependency colors. */
  settings: TraceVisSettings;
  /** Optional mutable probe counters filled while preparing row inputs. */
  stats?: TracePreparedProcessRowsStats;
}): TraceDeckBinaryDependencyLineData {
  const buildStartTime = performance.now();
  const data = buildTraceDeckBinaryDependencyLineData({
    dependencyRefs: params.dependencyRefs,
    traceLayout: params.traceLayout,
    geometryContext: params.geometryContext,
    settings: params.settings
  });
  if (params.stats) {
    params.stats.binaryDependencyBuildCount += 1;
    params.stats.binaryDependencyBuildDurationMs += performance.now() - buildStartTime;
  }
  return data;
}

/**
 * Rebuilds span position/size buffers while retaining existing fill and outline color buffers.
 */
function refreshTraceDeckBinaryBlockGeometry(params: {
  /** Previously prepared binary span payload whose static color attributes remain valid. */
  previousData: TraceDeckBinaryBlockData;
  /** Stable visible span refs represented by the refreshed binary payload. */
  spans: readonly SpanRef[];
  /** Layout containing current span timing and lane state after aggregation changes. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated span resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional mutable probe counters filled while preparing row inputs. */
  stats?: TracePreparedProcessRowsStats;
}): TraceDeckBinaryBlockData {
  const buildStartTime = performance.now();
  const positions = new Float32Array(params.spans.length * 3);
  const sizes = new Float32Array(params.spans.length * 2);
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);

  params.spans.forEach((spanRef, index) => {
    if (
      fillTraceLayoutSpanGeometry({
        traceLayout: params.traceLayout,
        spanRef,
        target: geometry,
        context: geometryContext
      })
    ) {
      positions[index * 3] = geometry.x1;
      positions[index * 3 + 1] = geometry.y1;
      positions[index * 3 + 2] = 0;
      sizes[index * 2] = geometry.x2 - geometry.x1;
      sizes[index * 2 + 1] = geometry.y2 - geometry.y1;
    }
  });

  const refreshed = {
    data: {
      length: params.spans.length,
      attributes: {
        getPosition: {value: positions, size: 3},
        getSize: {value: sizes, size: 2},
        getFillColor: params.previousData.data.attributes.getFillColor!,
        getLineColor: params.previousData.data.attributes.getLineColor!
      }
    },
    spans: params.spans
  };
  if (params.stats) {
    params.stats.binaryBlockGeometryRefreshCount += 1;
    params.stats.binaryBlockGeometryRefreshDurationMs += performance.now() - buildStartTime;
  }
  return refreshed;
}

/**
 * Rebuilds dependency endpoint buffers while retaining existing dependency color buffers.
 */
function refreshTraceDeckBinaryDependencyGeometry(params: {
  /** Previously prepared dependency payload whose color attributes remain valid. */
  previousData: TraceDeckBinaryDependencyLineData;
  /** Stable visible dependency refs represented by the refreshed binary payload. */
  dependencyRefs: readonly (TraceDependencyRef | VisibleLocalDependencyRef)[];
  /** Layout containing current span timing and lane state after aggregation changes. */
  traceLayout: TraceLayout;
  /** Optional batch-scoped direct geometry lookup state for repeated dependency resolution. */
  geometryContext?: TraceLayoutGeometryDerivationContext;
  /** Optional mutable probe counters filled while preparing row inputs. */
  stats?: TracePreparedProcessRowsStats;
}): TraceDeckBinaryDependencyLineData {
  const buildStartTime = performance.now();
  const sourcePositions = new Float32Array(params.dependencyRefs.length * 3);
  const targetPositions = new Float32Array(params.dependencyRefs.length * 3);
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  const geometryContext =
    params.geometryContext ?? buildTraceLayoutGeometryDerivationContext(params.traceLayout);

  params.dependencyRefs.forEach((dependencyRef, index) => {
    if (
      fillTraceLayoutLocalDependencyGeometry({
        traceLayout: params.traceLayout,
        dependencyRef,
        target: geometry,
        context: geometryContext
      })
    ) {
      sourcePositions[index * 3] = geometry.x1;
      sourcePositions[index * 3 + 1] = geometry.y1;
      sourcePositions[index * 3 + 2] = 0;
      targetPositions[index * 3] = geometry.x2;
      targetPositions[index * 3 + 1] = geometry.y2;
      targetPositions[index * 3 + 2] = 0;
    }
  });

  const refreshed = {
    data: {
      length: params.dependencyRefs.length,
      attributes: {
        getSourcePosition: {value: sourcePositions, size: 3},
        getTargetPosition: {value: targetPositions, size: 3},
        getColor: params.previousData.data.attributes.getColor!
      }
    },
    dependencyRefs: params.dependencyRefs
  };
  if (params.stats) {
    params.stats.binaryDependencyGeometryRefreshCount += 1;
    params.stats.binaryDependencyGeometryRefreshDurationMs += performance.now() - buildStartTime;
  }
  return refreshed;
}

/** Returns row-local local dependency refs after applying Arrow-field visibility filters. */
function getTracePreparedProcessRowDependencyRefs(params: {
  graph: TraceGraph;
  row: TraceLayoutRow;
  localDependencyMode: TraceVisSettings['localDependencyMode'];
}): readonly (TraceDependencyRef | VisibleLocalDependencyRef)[] {
  if (!params.graph.hasActiveSpanFilter()) {
    return getUnfilteredLocalDependencyRefsFromArrowTable(params);
  }

  const dependencyRefs = params.graph.getVisibleLocalDependencyRefs(params.row.processRef);
  if (params.localDependencyMode === 'all') {
    return dependencyRefs;
  }

  const filteredDependencyRefs: (TraceDependencyRef | VisibleLocalDependencyRef)[] = [];
  for (const dependencyRef of dependencyRefs) {
    if (
      shouldShowLocalDependencyByModeFields(
        params.localDependencyMode,
        params.graph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT'),
        params.graph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
      )
    ) {
      filteredDependencyRefs.push(dependencyRef);
    }
  }
  return filteredDependencyRefs;
}

/** Returns unfiltered process-local dependency refs by scanning the Arrow dependency-ref column. */
function getUnfilteredLocalDependencyRefsFromArrowTable(params: {
  graph: TraceGraph;
  row: TraceLayoutRow;
  localDependencyMode: TraceVisSettings['localDependencyMode'];
}): readonly TraceDependencyRef[] {
  const table = params.graph.localDependencyTableMap[params.row.processId as TraceProcessId];
  const dependencyRefColumn = table?.getChild('dependencyRef');
  if (!table || !dependencyRefColumn) {
    return params.graph.getLocalDependencyRefs(params.row.processRef);
  }

  const dependencyRefs: TraceDependencyRef[] = [];
  const keywordsColumn = table.getChild('keywords');
  const waitTimeMsColumn = table.getChild('waitTimeMs');
  for (let rowIndex = 0; rowIndex < table.numRows; rowIndex += 1) {
    const dependencyRef = normalizeArrowRefNumber(dependencyRefColumn.get(rowIndex));
    if (dependencyRef == null) {
      continue;
    }
    if (
      params.localDependencyMode !== 'all' &&
      !shouldShowLocalDependencyByModeFields(
        params.localDependencyMode,
        dependencyKeywordListHas(keywordsColumn?.get(rowIndex), 'SUBMIT'),
        normalizeArrowNumber(waitTimeMsColumn?.get(rowIndex)) ?? 0
      )
    ) {
      continue;
    }
    dependencyRefs.push(dependencyRef as TraceDependencyRef);
  }
  return dependencyRefs;
}

/** Returns one Arrow numeric ref cell as a JavaScript safe integer. */
function normalizeArrowRefNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isSafeInteger(numberValue) ? numberValue : null;
}

/** Returns one Arrow numeric cell as a finite JavaScript number. */
function normalizeArrowNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isFinite(numberValue) ? numberValue : null;
}

/** Returns whether a raw Arrow keyword-list cell contains the target keyword. */
function dependencyKeywordListHas(value: unknown, keyword: string): boolean {
  if (value == null || typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    return false;
  }
  for (const candidate of value as Iterable<unknown>) {
    if (candidate === keyword) {
      return true;
    }
  }
  return false;
}

/** Builds prepared collapsed activity intervals keyed by exact graph-local process refs. */
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
  traceLog.probe(0, 'buildTracePreparedCollapsedActivityByProcessRef done', {
    aggregation: params.aggregation ?? 'density',
    rowCount: params.layout.renderRows.length,
    visibleBlockCount: params.graph.getVisibleBlockCount(),
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
