import {CompositeLayer, FilterContext, Layer, LayerProps, PickingInfo} from '@deck.gl/core';
import {LineLayer, PathLayer, TextLayer} from '@deck.gl/layers';
import {Matrix4} from '@math.gl/core';
import {BlockLayer, FastTextLayer} from '@deck.gl-community/infovis-layers';
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';

import {
  DEFAULT_TRACE_FONT_FAMILY,
  fillTraceLayoutSpanGeometry,
  getTraceGraphSpanNameUtf8,
  shouldShowLocalDependencyByModeFields
} from '../../trace/index';
import {getLayoutDensityPreset} from '../../trace/trace-layout/trace-geometry-layout-common';
import {
  createTraceColorResolver,
  createTraceGraphColorResolver,
  DEFAULT_TRACE_COLOR_SCHEME,
  getHighlightFadeMultiplier,
  TRACE_COLOR
} from '../../trace/trace-style/trace-colors';
import {
  combineBounds,
  expandBounds,
  getProcessLayoutBounds,
  getStreamLayoutBounds
} from './layer-bounds-utils';
import {
  applyDependencyLineOpacity,
  applyDependencyMarkerOpacity,
  getDependencyOpacityMultiplier,
  makeColorUpdateTriggers,
  makeGeometryUpdateTriggers,
  TRACE_SPAN_POSITION_TRANSITION
} from './trace-layer-utils';
import {
  getTraceLayoutSpanGeometryBySpanRef,
  getTraceLayoutVisibleDependencyGeometry
} from './trace-layout-geometry';

import type {
  ProcessLayout,
  SpanRef,
  TraceDeckBinaryBlockData,
  TraceDeckBinaryDependencyLineData,
  TraceDependencyRef,
  TraceGraphSelectedLocalDependencySource,
  TraceLayout,
  TraceLayoutOverflowLabelDatum,
  TraceLayoutRow,
  TraceLocalDependencySource,
  TraceProcessActivityInterval,
  TraceProcessInfoObject,
  TraceRenderSpan,
  TraceThread,
  TraceVisSettings,
  VisibleLocalDependencyRef
} from '../../trace/index';
import type {TraceColorScheme} from '../../trace/trace-style/trace-colors';
import type {DependencyVisibilityOptions} from './trace-layer-utils';
import type {GetPickingInfoParams, UpdateParameters} from '@deck.gl/core';

const DEFAULT_SPAN_WIDTH_MIN_PIXELS = 2;
const SPAN_HEIGHT_MIN_PIXELS = 0;
const SPAN_LINE_WIDTH_PX = 1;
const SPAN_BORDER_LINE_MIN_PIXELS = 0;
const INSIDE_BLOCK_LABEL_LEFT_INSET_PX = 6;
const HOVERED_BLOCK_FILL_COLOR = TRACE_COLOR.SPAN_FINISHED_FILL;
const HOVERED_BLOCK_LINE_COLOR = TRACE_COLOR.SPAN_FINISHED_LINE;
const COLLAPSED_ACTIVITY_COLOR_RGB = [54, 54, 54] as const;
// const COLLAPSED_ACTIVITY_MIN_ALPHA = 90;
// const COLLAPSED_ACTIVITY_MAX_ALPHA = 235;
const COLLAPSED_ACTIVITY_MIN_WIDTH_PX = 0.1;
const COLLAPSED_ACTIVITY_MAX_WIDTH_PX = 0.8;
const LOCAL_DEPENDENCY_LINE_WIDTH_PX = 1;
const LOCAL_DEPENDENCY_OPACITY_MULTIPLIER = 0.75;
const WARNING_DEPENDENCY_MIN_VISIBILITY = 1;
const PATH_DEPENDENCY_MARKER_SIZE = 3;
const FORWARD_DEPENDENCY_MARKER_PLACEMENTS = [1];
const BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS = [1];
/** Direction a collapsed activity summary grows from the process row activity origin. */
type CollapsedActivityDirection = 'up' | 'down';
type TraceRankSpanDatum = SpanRef | TraceRenderSpan;
/** Absolute geometry used to position and clip one span label. */
type TraceSpanLabelGeometry = readonly [x1: number, y1: number, x2: number, y2: number];
/** Dependency ref type accepted by one foreground rank row. */
type TraceRankLocalDependencyRef = TraceDependencyRef | VisibleLocalDependencyRef;
const EMPTY_TRACE_RENDER_SPANS: readonly SpanRef[] = [];
const EMPTY_HOVERED_TRACE_RENDER_SPANS: readonly TraceRenderSpan[] = [];
const EMPTY_SELECTED_SPAN_REFS: readonly SpanRef[] = [];
const EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS: readonly TraceProcessActivityInterval[] = [];
const EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS: readonly TraceLayoutOverflowLabelDatum[] = [];
const EMPTY_SPAN_LABEL_BOX = [0, 0, 0, 0] as [number, number, number, number];
const HIDDEN_SPAN_LABEL_POSITION = [0, -1_000_000] as [number, number];
const TRACE_PICKING_WARNING_REPEAT_MS = 1000;
let lastTracePickingWarningKey: string | null = null;
let lastTracePickingWarningAtMs = 0;

/** Returns whether collapsed process activity should dim with selection state in this rank. */
function shouldFadeCollapsedActivity(params: {
  /** Layer id used to avoid dimming overview/minimap summaries. */
  readonly layerId?: string;
  /** Global selected span refs for the rendered trace scene. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Highlighted span refs used by the shared span color resolver. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
}): boolean {
  const isMinimapLayer = params.layerId?.startsWith('minimap-') === true;
  if (isMinimapLayer) {
    return false;
  }
  return params.selectedSpanRefs.length > 0 || (params.highlightedSpanRefs?.size ?? 0) > 0;
}

/** Resolves collapsed process activity fill color with an alpha channel for selection fading. */
function getCollapsedActivityFillColor(
  interval: TraceProcessActivityInterval,
  opacityMultiplier: number
): [number, number, number, number] {
  const color = interval.color ?? COLLAPSED_ACTIVITY_COLOR_RGB;
  const alpha = Math.round(255 * Math.max(0, Math.min(1, opacityMultiplier)));
  return [color[0], color[1], color[2], alpha];
}

/** Returns the shared Y origin for collapsed activity in one process row. */
function getCollapsedActivityOriginY(
  rankLayout: ProcessLayout,
  settings: Pick<TraceVisSettings, 'layoutDensity'>
): number {
  return rankLayout.yOffset + getLayoutDensityPreset(settings.layoutDensity).overviewTopGap;
}

/** Returns the Y origin for one collapsed activity interval from the process row origin. */
function getCollapsedActivityIntervalY(params: {
  /** Process layout that owns the collapsed activity row. */
  readonly rankLayout: ProcessLayout;
  /** Trace settings that choose the collapsed activity row inset. */
  readonly settings: Pick<TraceVisSettings, 'layoutDensity'>;
  /** Activity interval to position. */
  readonly interval: TraceProcessActivityInterval;
}): number {
  return (
    getCollapsedActivityOriginY(params.rankLayout, params.settings) + (params.interval.yOffset ?? 0)
  );
}

/** Returns no-blend visibility options for local dependency warning states. */
function getLocalDependencyVisibilityOptions(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceRankLocalDependencyRef
): DependencyVisibilityOptions | undefined {
  return isSubmitWarningDependencyRef(traceLayout, dependencyRef)
    ? {minimumVisibility: WARNING_DEPENDENCY_MIN_VISIBILITY}
    : undefined;
}

/** Returns whether one local dependency ref should render with warning emphasis. */
function isSubmitWarningDependencyRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceRankLocalDependencyRef
): boolean {
  return shouldShowLocalDependencyByModeFields(
    'warnings',
    traceLayout.traceGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT'),
    traceLayout.traceGraph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
  );
}

/** Resolves one local dependency line color without materializing a dependency source. */
function getLocalDependencyLineColorByRef(
  traceLayout: Readonly<TraceLayout>,
  dependencyRef: TraceRankLocalDependencyRef
): readonly [number, number, number, number] {
  if (isSubmitWarningDependencyRef(traceLayout, dependencyRef)) {
    return TRACE_COLOR.WARNING_DEPENDENCY_LINE;
  }
  if (traceLayout.traceGraph.getVisibleDependencyHasKeyword(dependencyRef, 'SUBMIT')) {
    return TRACE_COLOR.SUBMIT_DEPENDENCY_LINE;
  }
  return TRACE_COLOR.DEPENDENCY_LINE;
}

function combineGeometryBounds(
  geometries: Iterable<ArrayLike<number> | null | undefined>
): [[number, number], [number, number]] | null {
  let combined: [[number, number], [number, number]] | null = null;

  for (const geometry of geometries) {
    if (!geometry || geometry.length < 2) {
      continue;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let hasValue = false;

    for (let index = 0; index < geometry.length; index += 2) {
      const x = geometry[index];
      const y = geometry[index + 1];
      if (
        typeof x !== 'number' ||
        typeof y !== 'number' ||
        !Number.isFinite(x) ||
        !Number.isFinite(y)
      ) {
        continue;
      }

      hasValue = true;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    if (!hasValue) {
      continue;
    }

    const bounds: [[number, number], [number, number]] = [
      [minX, minY],
      [maxX, maxY]
    ];
    combined =
      combined == null
        ? bounds
        : [
            [Math.min(combined[0][0], bounds[0][0]), Math.min(combined[0][1], bounds[0][1])],
            [Math.max(combined[1][0], bounds[1][0]), Math.max(combined[1][1], bounds[1][1])]
          ];
  }

  return combined;
}

/** Resolves the exact span ref carried by one render datum. */
function getTraceRenderSpanRef(span: TraceRankSpanDatum): SpanRef {
  return typeof span === 'number' ? span : span.spanRef;
}

/** Resolves one render span geometry by exact span ref. */
function getTraceRenderSpanGeometry(span: TraceRankSpanDatum, traceLayout: TraceLayout) {
  return getTraceLayoutSpanGeometryBySpanRef({
    traceLayout,
    spanRef: getTraceRenderSpanRef(span)
  });
}

/** Returns whether a label geometry can draw a non-empty label. */
function isValidTraceSpanLabelGeometry(
  geometry: ArrayLike<number> | undefined
): geometry is ArrayLike<number> {
  return (
    geometry != null &&
    Number.isFinite(geometry[0]) &&
    Number.isFinite(geometry[1]) &&
    Number.isFinite(geometry[2]) &&
    Number.isFinite(geometry[3]) &&
    geometry[2] > geometry[0] &&
    geometry[3] > geometry[1]
  );
}

/** Returns label geometry from the same row-local binary block buffers used by rectangles. */
function getTraceBinaryBlockSpanLabelGeometry(params: {
  /** Span being labeled. */
  readonly span: SpanRef;
  /** Binary block payload currently used by the row rectangle layer. */
  readonly binaryBlockData: TraceDeckBinaryBlockData | undefined;
  /** Accessor row index supplied by deck.gl for the span label row. */
  readonly objectInfo: {readonly index?: number} | undefined;
}): TraceSpanLabelGeometry | null {
  const rowIndex = params.objectInfo?.index;
  const positions = params.binaryBlockData?.data.attributes.getPosition?.value;
  const sizes = params.binaryBlockData?.data.attributes.getSize?.value;
  if (
    params.binaryBlockData == null ||
    typeof rowIndex !== 'number' ||
    rowIndex < 0 ||
    rowIndex >= params.binaryBlockData.spans.length ||
    params.binaryBlockData.spans[rowIndex] !== params.span ||
    positions == null ||
    sizes == null
  ) {
    return null;
  }

  const positionIndex = rowIndex * 3;
  const sizeIndex = rowIndex * 2;
  const x = positions[positionIndex];
  const y = positions[positionIndex + 1];
  const width = sizes[sizeIndex];
  const height = sizes[sizeIndex + 1];
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return [
    x as number,
    y as number,
    (x as number) + (width as number),
    (y as number) + (height as number)
  ];
}

/** Returns label geometry, preferring binary block buffers over layout geometry chunks. */
function getTraceSpanLabelGeometry(params: {
  /** Span being labeled. */
  readonly span: SpanRef;
  /** Layout containing span-ref geometry chunks for non-binary rows. */
  readonly traceLayout: TraceLayout;
  /** Binary block payload currently used by the row rectangle layer. */
  readonly binaryBlockData: TraceDeckBinaryBlockData | undefined;
  /** Accessor row index supplied by deck.gl for the span label row. */
  readonly objectInfo: {readonly index?: number} | undefined;
}): TraceSpanLabelGeometry | null {
  if (params.binaryBlockData) {
    return getTraceBinaryBlockSpanLabelGeometry({
      span: params.span,
      binaryBlockData: params.binaryBlockData,
      objectInfo: params.objectInfo
    });
  }

  const geometry = getTraceRenderSpanGeometry(params.span, params.traceLayout);
  return isValidTraceSpanLabelGeometry(geometry)
    ? [geometry[0], geometry[1], geometry[2], geometry[3]]
    : null;
}

/** Computes combined bounds for render spans by exact span ref. */
function getTraceRenderSpanBounds(
  spans: Iterable<TraceRankSpanDatum>,
  traceLayout: TraceLayout
): [[number, number], [number, number]] | null {
  return combineGeometryBounds(
    Array.from(spans, span => getTraceRenderSpanGeometry(span, traceLayout))
  );
}

/** Resolves a color/text source for one render datum at the deck-layer accessor boundary. */
function getTraceRenderSpanDisplaySource(
  span: TraceRankSpanDatum,
  traceLayout: Readonly<TraceLayout>
): TraceRenderSpan | null {
  if (typeof span !== 'number') {
    return span;
  }
  return traceLayout.traceGraph.getSpanDisplaySource(span);
}

/** Resolves the span label text without requiring prebuilt span objects. */
function getTraceRenderSpanName(
  span: TraceRankSpanDatum,
  traceLayout: Readonly<TraceLayout>
): string {
  return typeof span === 'number' ? (traceLayout.traceGraph.getSpanName(span) ?? '') : span.name;
}

/** Resolves the span fill color for a ref-native rank-layer datum. */
function getTraceRenderSpanFillColor(params: {
  /** Ref-native or compatibility span datum to color. */
  readonly span: TraceRankSpanDatum;
  /** Layout owning the canonical trace graph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Active span color resolver. */
  readonly colorResolver: ReturnType<typeof createTraceColorResolver>;
  /** Ref-native span color resolver. */
  readonly graphColorResolver: ReturnType<typeof createTraceGraphColorResolver>;
}): readonly [number, number, number, number] {
  if (typeof params.span === 'number') {
    return params.graphColorResolver.getSpanFillColor(params.span, 'any');
  }
  const source = getTraceRenderSpanDisplaySource(params.span, params.traceLayout);
  return source
    ? params.colorResolver.getSpanFillColor(source, 'any')
    : TRACE_COLOR.SPAN_FINISHED_FILL;
}

/** Resolves the span border color for a ref-native rank-layer datum. */
function getTraceRenderSpanBorderColor(params: {
  /** Ref-native or compatibility span datum to color. */
  readonly span: TraceRankSpanDatum;
  /** Layout owning the canonical trace graph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Active span color resolver. */
  readonly colorResolver: ReturnType<typeof createTraceColorResolver>;
  /** Ref-native span color resolver. */
  readonly graphColorResolver: ReturnType<typeof createTraceGraphColorResolver>;
}): readonly [number, number, number, number] {
  if (typeof params.span === 'number') {
    return params.graphColorResolver.getSpanBorderColor(params.span);
  }
  const source = getTraceRenderSpanDisplaySource(params.span, params.traceLayout);
  return source ? params.colorResolver.getSpanBorderColor(source) : TRACE_COLOR.SPAN_FINISHED_LINE;
}

/** Resolves the span label color for a ref-native rank-layer datum. */
function getTraceRenderSpanTextColor(params: {
  /** Ref-native or compatibility span datum to color. */
  readonly span: TraceRankSpanDatum;
  /** Layout owning the canonical trace graph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Active span color resolver. */
  readonly colorResolver: ReturnType<typeof createTraceColorResolver>;
  /** Ref-native span color resolver. */
  readonly graphColorResolver: ReturnType<typeof createTraceGraphColorResolver>;
  /** Whether the label is drawn inside the span fill. */
  readonly isInsideBlockText: boolean;
}): readonly [number, number, number, number] {
  if (typeof params.span === 'number') {
    return params.graphColorResolver.getSpanTextColor(
      params.span,
      'any',
      params.isInsideBlockText ? 'inside' : 'outside'
    );
  }
  const source = getTraceRenderSpanDisplaySource(params.span, params.traceLayout);
  return source
    ? params.colorResolver.getSpanTextColor(
        source,
        'any',
        params.isInsideBlockText ? 'inside' : 'outside'
      )
    : TRACE_COLOR.THREAD_TEXT;
}

type TraceRankDependencyDatum = {
  /** Exact local dependency ref represented by this rendered row datum. */
  readonly dependencyRef: TraceRankLocalDependencyRef;
  /** Precomputed dependency path geometry consumed by deck.gl attribute generation. */
  readonly path: Float32Array;
  /** Precomputed line color after mode-specific warning and opacity handling. */
  readonly color: readonly [number, number, number, number];
  /** Precomputed marker color after mode-specific warning and opacity handling. */
  readonly markerColor: readonly [number, number, number, number];
  /** Direction enum consumed by the dependency arrow layer. */
  readonly direction: PathDirection;
  /** Marker placements for directional arrow heads. */
  readonly markerPlacements: number[];
};

const EMPTY_TRACE_RANK_DEPENDENCY_DATA: readonly TraceRankDependencyDatum[] = [];

type TraceProcessLayerState = {
  /** Full-opacity visible spans used only by optional split-opacity base layers. */
  visibleFullOpacitySpans?: readonly TraceRankSpanDatum[];
  /** Faded visible spans used only by optional split-opacity base layers. */
  visibleFadedSpans?: readonly TraceRankSpanDatum[];
  /** Row-local dependency data precomputed once before deck.gl attribute generation. */
  visibleDependencyData: readonly TraceRankDependencyDatum[];
  /** Geometry trigger that produced visibleDependencyData. */
  visibleDependencyGeometryTrigger?: unknown;
  /** Hovered span retained as a stable single-item data array for the hover sublayer. */
  visibleHoveredBlockData: readonly TraceRenderSpan[];
  /** Hovered span retained for visibility decisions that should not allocate arrays in render. */
  visibleHoveredBlock?: TraceRenderSpan;
  /** Maximum collapsed-activity value used by the collapsed-process activity sublayer. */
  maxCollapsedActivity: number;
};

/** Returns true when one render span has non-zero geometry in the current layout. */
function isVisibleTraceRenderSpan(span: TraceRankSpanDatum, traceLayout: Readonly<TraceLayout>) {
  const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
  return (
    fillTraceLayoutSpanGeometry({
      traceLayout,
      spanRef: getTraceRenderSpanRef(span),
      target: geometry
    }) &&
    geometry.x2 > geometry.x1 &&
    geometry.y2 > geometry.y1
  );
}

/** Returns true when a picked dependency datum carries a visible dependency ref. */
function isTraceRankDependencyDatum(value: unknown): value is TraceRankDependencyDatum {
  return (
    typeof value === 'object' &&
    value != null &&
    typeof (value as Partial<TraceRankDependencyDatum>).dependencyRef === 'number'
  );
}

/** Logs a malformed hover-picking row without flooding the console for one repeated target. */
function logTraceProcessPickingDataWarning(params: {
  /** Stable key for the hovered bad row, used only to suppress immediate repeats. */
  readonly key: string;
  /** Short machine-readable reason for the data mismatch. */
  readonly reason: string;
  /** Debug payload with render-row and source-ref context. */
  readonly details: Record<string, unknown>;
}): void {
  const nowMs = performance.now();
  if (
    params.key === lastTracePickingWarningKey &&
    nowMs - lastTracePickingWarningAtMs < TRACE_PICKING_WARNING_REPEAT_MS
  ) {
    return;
  }
  lastTracePickingWarningKey = params.key;
  lastTracePickingWarningAtMs = nowMs;
  console.warn('[tracevis] Hover picked rendered trace data with no matching source data', {
    reason: params.reason,
    ...params.details
  });
}

/** Builds shared process-row context for hover-picking diagnostics. */
function getTraceProcessPickingContext(params: {
  /** Source sublayer id reported by deck.gl picking. */
  readonly sourceLayerId: string;
  /** Picked binary or object-data row index reported by deck.gl. */
  readonly pickedIndex: number;
  /** Process layer props that own the picked sublayer. */
  readonly props: Readonly<TraceProcessLayerProps>;
}): Record<string, unknown> {
  return {
    layerId: params.props.id,
    sourceLayerId: params.sourceLayerId,
    pickedIndex: params.pickedIndex,
    processId: params.props.processId,
    processName: params.props.processName,
    rankNum: params.props.rankNum,
    rankIndex: params.props.rankIndex
  };
}

/** Builds dependency-specific context for hover-picking diagnostics. */
function getTraceDependencyPickingContext(params: {
  /** Dependency ref that failed source resolution. */
  readonly dependencyRef: TraceRankLocalDependencyRef;
  /** Process layer props whose trace graph owns the dependency ref. */
  readonly props: Readonly<TraceProcessLayerProps>;
}): Record<string, unknown> {
  const traceGraph = params.props.traceLayout.traceGraph;
  return {
    dependencyRef: params.dependencyRef,
    dependencyId: traceGraph.getVisibleDependencyIdByRef(params.dependencyRef),
    startSpanRef: traceGraph.getVisibleDependencyStartSpan(params.dependencyRef),
    endSpanRef: traceGraph.getVisibleDependencyEndSpan(params.dependencyRef),
    startSpanId: traceGraph.getVisibleDependencyStartBlockId(params.dependencyRef),
    endSpanId: traceGraph.getVisibleDependencyEndBlockId(params.dependencyRef),
    binaryDependencyRefCount: params.props.binaryDependencyLineData?.dependencyRefs.length,
    binaryDependencyRowCount: params.props.binaryDependencyLineData?.data.length
  };
}

/** Builds span-specific context for hover-picking diagnostics. */
function getTraceSpanPickingContext(params: {
  /** Span ref that failed source resolution. */
  readonly spanRef: SpanRef;
  /** Process layer props whose trace graph owns the span ref. */
  readonly props: Readonly<TraceProcessLayerProps>;
}): Record<string, unknown> {
  const traceGraph = params.props.traceLayout.traceGraph;
  return {
    spanRef: params.spanRef,
    spanId: traceGraph.getSpanBlockId(params.spanRef),
    spanName: traceGraph.getSpanName(params.spanRef),
    binarySpanRefCount: params.props.binaryBlockData?.spans.length,
    binarySpanRowCount: params.props.binaryBlockData?.data.length
  };
}

/** Returns whether straight dependency rendering can use the prepared binary payload directly. */
function shouldUseBinaryStraightDependencyLineData(params: {
  /** Active visualization settings that choose line or curve dependency routing. */
  readonly settings: TraceVisSettings;
  /** Prepared binary dependency line payload, when available from row preparation. */
  readonly binaryDependencyLineData?: TraceDeckBinaryDependencyLineData;
}): boolean {
  return params.settings.lineRoutingMode === 'straight' && params.binaryDependencyLineData != null;
}

/** Builds deck-ready local dependency data so attribute accessors stay scalar/map-free. */
function getTraceRankDependencyData(params: {
  /** Local dependency refs for this rank row. */
  readonly dependencies: readonly TraceRankLocalDependencyRef[];
  /** Layout containing dependency geometry and the backing TraceGraph accessors. */
  readonly traceLayout: Readonly<TraceLayout>;
  /** Current opacity multiplier derived from trace settings. */
  readonly dependencyOpacityMultiplier: number;
}): readonly TraceRankDependencyDatum[] {
  const result: TraceRankDependencyDatum[] = [];
  for (const dependencyRef of params.dependencies) {
    const path = getTraceLayoutVisibleDependencyGeometry({
      traceLayout: params.traceLayout,
      dependencyRef
    });
    if (!path) {
      continue;
    }
    const visibilityOptions = getLocalDependencyVisibilityOptions(
      params.traceLayout,
      dependencyRef
    );
    const baseColor = getLocalDependencyLineColorByRef(params.traceLayout, dependencyRef);
    const isBidirectional =
      params.traceLayout.traceGraph.getVisibleDependencyBidirectional(dependencyRef) === true;
    result.push({
      dependencyRef,
      path,
      color: applyDependencyLineOpacity(
        baseColor,
        params.dependencyOpacityMultiplier,
        visibilityOptions
      ),
      markerColor: applyDependencyMarkerOpacity(
        baseColor,
        params.dependencyOpacityMultiplier,
        visibilityOptions
      ),
      direction: isBidirectional ? PathDirection.BOTH : PathDirection.FORWARD,
      markerPlacements: isBidirectional
        ? [...BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS]
        : [...FORWARD_DEPENDENCY_MARKER_PLACEMENTS]
    });
  }
  return result;
}

/** Returns the maximum activity value for collapsed process rendering. */
function getMaxCollapsedActivity(
  collapsedActivityIntervals: ReadonlyArray<TraceProcessActivityInterval>
) {
  return collapsedActivityIntervals.reduce(
    (max, interval) =>
      Number.isFinite(interval.activity) ? Math.max(max, interval.activity) : max,
    0
  );
}

/**
 * Composite layer that renders the primitives for a single trace rank.
 *
 * Sublayer identifiers:
 * - `${id}-block-rectangles`: block polygons with hover styling.
 * - `${id}-block-rectangle-hovered`: hovered block highlight.
 * - `${id}-dependency-lines`: dependency lines + chevrons.
 * - `${id}-block-names`: block labels.
 */
export type TraceProcessLayerProps = LayerProps & {
  threads: readonly TraceThread[];
  /** Span-ref keyed foreground payloads rendered as span rectangles and labels. */
  spans: readonly SpanRef[];
  /** Row-local dependency refs rendered as local dependency arrows. */
  dependencies: readonly TraceRankLocalDependencyRef[];
  /** Binary block attributes precomputed by prepared deck layer inputs. */
  binaryBlockData?: TraceDeckBinaryBlockData;
  /** Binary straight-line dependency attributes precomputed by prepared deck layer inputs. */
  binaryDependencyLineData?: TraceDeckBinaryDependencyLineData;
  /** Exact selected span refs shared across the current trace scene. */
  selectedSpanRefs?: readonly SpanRef[];
  /** Selected dependency sources before rank-layer state narrows them to visible dependency refs. */
  selectedDependencies: readonly (
    | TraceLocalDependencySource
    | TraceGraphSelectedLocalDependencySource
  )[];
  /** Hovered foreground span payload rendered above the normal row spans. */
  hoveredSpan?: TraceRenderSpan;
  onSpanClick: (info: PickingInfo, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean | void;
  rankIndex: number;
  processId: string;
  /** User-facing process label shown in process tooltips. */
  processName?: string;
  rankNum: number;
  /** Canonical runtime process ref for the rendered rank when available. */
  rankProcessRef?: TraceLayoutRow['processRef'];
  stepNum: number;
  updateTrigger?: number;
  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  colorScheme?: TraceColorScheme;
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
  rankBackgroundColor?: Readonly<[number, number, number, number]>;
  isCollapsed?: boolean;
  spanLabelPlacement?: 'start' | 'center';
  /** Vertical direction for collapsed activity bars relative to collapsedActivityY. */
  collapsedActivityDirection?: CollapsedActivityDirection;
  collapsedActivityIntervals?: ReadonlyArray<TraceProcessActivityInterval>;
  /** Precomputed overflow and filtered-span labels for this row. */
  overflowLabels?: readonly TraceLayoutOverflowLabelDatum[];
  /** Callback fired when the process row should toggle expansion. */
  onToggleProcess?: (processId: string, processRef?: TraceLayoutRow['processRef']) => void;
  /** CSS font stack used by deck text labels in this process row. */
  fontFamily?: string;
};

export class TraceProcessLayer extends CompositeLayer<TraceProcessLayerProps> {
  static layerName = 'TraceProcessLayer';

  static defaultProps: Required<Omit<TraceProcessLayerProps, keyof LayerProps>> = {
    threads: [],
    spans: [],
    dependencies: [],
    binaryBlockData: undefined!,
    binaryDependencyLineData: undefined!,
    selectedSpanRefs: [],
    selectedDependencies: [],
    hoveredSpan: undefined!,
    onSpanClick: () => false,
    rankIndex: 0,
    processId: '',
    processName: '',
    rankNum: 0,
    rankProcessRef: undefined!,
    stepNum: 0,
    updateTrigger: undefined!,
    traceLayout: undefined!,
    settings: undefined!,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
    highlightedSpanRefs: undefined!,
    rankBackgroundColor: undefined!,
    isCollapsed: false,
    spanLabelPlacement: 'start',
    collapsedActivityDirection: 'down',
    collapsedActivityIntervals: [],
    overflowLabels: [],
    onToggleProcess: undefined!,
    fontFamily: DEFAULT_TRACE_FONT_FAMILY
  };

  override updateState({props, oldProps}: UpdateParameters<this>) {
    const nextState: Partial<TraceProcessLayerState> = {};
    const geometryShapeTrigger = getTraceProcessLayerGeometryShapeTrigger(
      props.traceLayout,
      props.processId,
      props.rankIndex
    );
    const previousGeometryShapeTrigger = getTraceProcessLayerGeometryShapeTrigger(
      oldProps.traceLayout,
      oldProps.processId,
      oldProps.rankIndex
    );
    const geometryShapeChanged = geometryShapeTrigger !== previousGeometryShapeTrigger;

    const shouldBuildVisibleDependencyData = !shouldUseBinaryStraightDependencyLineData({
      settings: props.settings,
      binaryDependencyLineData: props.binaryDependencyLineData
    });
    const rankLayout = props.traceLayout.processLayouts?.[props.rankIndex];
    const effectiveIsCollapsed = rankLayout
      ? rankLayout.isCollapsed === true
      : Boolean(props.isCollapsed);
    const previousVisibleDependencyGeometryTrigger = (this.state as Partial<TraceProcessLayerState>)
      .visibleDependencyGeometryTrigger;
    if (
      props.dependencies !== oldProps.dependencies ||
      (!effectiveIsCollapsed &&
        geometryShapeTrigger !== previousVisibleDependencyGeometryTrigger) ||
      props.settings !== oldProps.settings ||
      props.binaryDependencyLineData !== oldProps.binaryDependencyLineData
    ) {
      nextState.visibleDependencyData = shouldBuildVisibleDependencyData
        ? getTraceRankDependencyData({
            dependencies: props.dependencies,
            traceLayout: props.traceLayout,
            dependencyOpacityMultiplier:
              getDependencyOpacityMultiplier(props.settings) * LOCAL_DEPENDENCY_OPACITY_MULTIPLIER
          })
        : EMPTY_TRACE_RANK_DEPENDENCY_DATA;
      nextState.visibleDependencyGeometryTrigger = geometryShapeTrigger;
    }

    if (props.hoveredSpan !== oldProps.hoveredSpan || geometryShapeChanged) {
      const visibleHoveredBlock =
        props.hoveredSpan && isVisibleTraceRenderSpan(props.hoveredSpan, props.traceLayout)
          ? props.hoveredSpan
          : undefined;
      nextState.visibleHoveredBlock = visibleHoveredBlock;
      nextState.visibleHoveredBlockData = visibleHoveredBlock
        ? [visibleHoveredBlock]
        : EMPTY_HOVERED_TRACE_RENDER_SPANS;
    }

    if (props.collapsedActivityIntervals !== oldProps.collapsedActivityIntervals) {
      nextState.maxCollapsedActivity = getMaxCollapsedActivity(
        props.collapsedActivityIntervals ?? []
      );
    }

    if (Object.keys(nextState).length > 0) {
      this.setState(nextState);
    }
  }

  /** Initializes derived state for direct renderLayers calls outside deck.gl's lifecycle. */
  private ensureDerivedState() {
    if (this.state) {
      return;
    }

    this.state = {};
    this.updateState({
      props: this.props,
      oldProps: {} as TraceProcessLayerProps
    } as UpdateParameters<this>);
  }

  override getBounds() {
    this.ensureDerivedState();
    const {
      spans,
      traceLayout,
      isCollapsed,
      collapsedActivityIntervals = EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS,
      rankIndex,
      threads
    } = this.props;
    const settings = this.props.settings;
    const aggregationMode = settings.trackAggregationMode;
    const rankLayout = traceLayout.processLayouts?.[rankIndex];
    const streamLayouts =
      aggregationMode !== 'separate-threads'
        ? (traceLayout.processLayouts?.[rankIndex]?.threadLayouts ?? [])
        : threads
            .map(thread => traceLayout.threadLayoutMap[thread.threadId])
            .filter((layout): layout is NonNullable<typeof layout> => Boolean(layout));
    const effectiveStreamLayouts =
      streamLayouts.length > 0 ? streamLayouts : (rankLayout?.threadLayouts ?? []);
    const effectiveIsCollapsed = rankLayout
      ? rankLayout.isCollapsed === true
      : Boolean(isCollapsed);
    const baseBounds = combineBounds([
      getTraceRenderSpanBounds(spans, traceLayout),
      getStreamLayoutBounds(effectiveStreamLayouts),
      getProcessLayoutBounds(rankLayout)
    ]) as [[number, number], [number, number]];

    if (effectiveIsCollapsed && collapsedActivityIntervals.length > 0) {
      if (!rankLayout) {
        return expandBounds(baseBounds);
      }
      let minX = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;
      collapsedActivityIntervals.forEach(interval => {
        const {startX, endX} = interval;
        if (Number.isFinite(startX)) {
          minX = Math.min(minX, startX);
        }
        if (Number.isFinite(endX)) {
          maxX = Math.max(maxX, endX);
        }
        const y0 = getCollapsedActivityIntervalY({rankLayout, settings, interval});
        const y1 =
          interval.height == null
            ? getCollapsedActivityOriginY(rankLayout, settings)
            : y0 + interval.height;
        if (Number.isFinite(y0) && Number.isFinite(y1)) {
          minY = Math.min(minY, y0, y1);
          maxY = Math.max(maxY, y0, y1);
        }
      });
      if (Number.isFinite(minX) && Number.isFinite(maxX)) {
        return expandBounds(
          combineBounds([
            baseBounds,
            [
              [minX, Number.isFinite(minY) ? minY : rankLayout.collapsedActivityY],
              [maxX, Number.isFinite(maxY) ? maxY : rankLayout.collapsedActivityY]
            ]
          ]) as [[number, number], [number, number]]
        );
      }
    }

    if (baseBounds) {
      return expandBounds(baseBounds);
    }
    return expandBounds(getProcessLayoutBounds(rankLayout));
  }

  /** By default layerFilter only apply to top-level layers
   * In this case we want TraceProcessLayer's sub layers to have per-view visibility as well
   */
  filterSubLayer(context: FilterContext): boolean {
    const layerFilter = this.context.deck?.props.layerFilter;
    if (layerFilter) {
      return layerFilter(context);
    }
    return true;
  }

  override getPickingInfo(
    params: GetPickingInfoParams
  ): PickingInfo<
    | TraceLocalDependencySource
    | TraceProcessActivityInterval
    | TraceProcessInfoObject
    | TraceRenderSpan
  > {
    const info = super.getPickingInfo(params) as PickingInfo<
      | TraceLocalDependencySource
      | TraceProcessActivityInterval
      | TraceProcessInfoObject
      | TraceRenderSpan
      | SpanRef
      | VisibleLocalDependencyRef
      | TraceRankDependencyDatum
    >;
    const sourceLayerId = params.sourceLayer?.id ?? '';
    if (sourceLayerId.includes('dependency-lines') && info.object == null && info.index >= 0) {
      const dependencyRef = this.props.binaryDependencyLineData?.dependencyRefs[info.index];
      const source = dependencyRef
        ? this.props.traceLayout.traceGraph.getVisibleDependencySourceByRef(dependencyRef)
        : null;
      if (dependencyRef == null) {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:missing-binary-dependency-ref`,
          reason: 'missing-binary-dependency-ref',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            binaryDependencyRefCount: this.props.binaryDependencyLineData?.dependencyRefs.length,
            binaryDependencyRowCount: this.props.binaryDependencyLineData?.data.length
          }
        });
      } else if (source?.type !== 'trace-local-dependency') {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:unresolved-dependency:${dependencyRef}`,
          reason: source == null ? 'missing-dependency-source' : 'unexpected-dependency-source',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            ...getTraceDependencyPickingContext({dependencyRef, props: this.props}),
            sourceType: source?.type
          }
        });
      }
      info.object = source?.type === 'trace-local-dependency' ? source : undefined;
    } else if (
      sourceLayerId.includes('dependency-lines') &&
      isTraceRankDependencyDatum(info.object)
    ) {
      const dependency = this.props.traceLayout.traceGraph.getVisibleDependencySourceByRef(
        info.object.dependencyRef
      );
      if (dependency?.type !== 'trace-local-dependency') {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:unresolved-dependency:${info.object.dependencyRef}`,
          reason: dependency == null ? 'missing-dependency-source' : 'unexpected-dependency-source',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            ...getTraceDependencyPickingContext({
              dependencyRef: info.object.dependencyRef,
              props: this.props
            }),
            sourceType: dependency?.type
          }
        });
      }
      info.object = dependency?.type === 'trace-local-dependency' ? dependency : undefined;
    } else if (sourceLayerId.includes('dependency-lines') && typeof info.object === 'number') {
      const dependency = this.props.traceLayout.traceGraph.getVisibleDependencySourceByRef(
        info.object as VisibleLocalDependencyRef
      );
      if (dependency?.type !== 'trace-local-dependency') {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:unresolved-dependency:${info.object}`,
          reason: dependency == null ? 'missing-dependency-source' : 'unexpected-dependency-source',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            ...getTraceDependencyPickingContext({
              dependencyRef: info.object as VisibleLocalDependencyRef,
              props: this.props
            }),
            sourceType: dependency?.type
          }
        });
      }
      info.object = dependency?.type === 'trace-local-dependency' ? dependency : undefined;
    } else if (
      sourceLayerId.includes('block-rectangles') &&
      info.object == null &&
      info.index >= 0
    ) {
      const spanRef = this.props.binaryBlockData?.spans[info.index];
      const source =
        spanRef != null ? getTraceRenderSpanDisplaySource(spanRef, this.props.traceLayout) : null;
      if (spanRef == null) {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:missing-binary-span-ref`,
          reason: 'missing-binary-span-ref',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            binarySpanRefCount: this.props.binaryBlockData?.spans.length,
            binarySpanRowCount: this.props.binaryBlockData?.data.length
          }
        });
      } else if (!source) {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:missing-span-source:${spanRef}`,
          reason: 'missing-span-source',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            ...getTraceSpanPickingContext({spanRef, props: this.props})
          }
        });
      }
      info.object = source ?? undefined;
    } else if (typeof info.object === 'number') {
      const spanRef = info.object as SpanRef;
      const source = getTraceRenderSpanDisplaySource(spanRef, this.props.traceLayout);
      if (!source) {
        logTraceProcessPickingDataWarning({
          key: `${this.props.id}:${sourceLayerId}:${info.index}:missing-span-source:${spanRef}`,
          reason: 'missing-span-source',
          details: {
            ...getTraceProcessPickingContext({
              sourceLayerId,
              pickedIndex: info.index,
              props: this.props
            }),
            ...getTraceSpanPickingContext({spanRef, props: this.props})
          }
        });
      }
      info.object = source ?? undefined;
    }
    if (sourceLayerId.includes('collapsed-activity') && info.object) {
      const {processId, processName, rankNum} = this.props;
      const resolvedRankName = processName || processId;
      info.object = {
        type: 'trace-process-info',
        processId,
        rankNum,
        processName: resolvedRankName,
        copyText: JSON.stringify(
          {
            processId,
            rankNum,
            processName: resolvedRankName
          },
          null,
          2
        )
      };
    }
    return info as PickingInfo<
      | TraceLocalDependencySource
      | TraceProcessActivityInterval
      | TraceProcessInfoObject
      | TraceRenderSpan
    >;
  }

  /** Returns base trace sublayers in their draw order. */
  private buildBaseTraceLayers(layers: readonly (Layer | null | undefined)[]): Layer[] {
    return layers.filter((layer): layer is Layer => Boolean(layer));
  }

  renderLayers() {
    const {
      // streams,
      onSpanClick,
      rankIndex,
      processId,
      settings,
      traceLayout,
      colorScheme,
      highlightedSpanRefs,
      selectedSpanRefs = EMPTY_SELECTED_SPAN_REFS,
      updateTrigger,
      binaryBlockData,
      binaryDependencyLineData,
      isCollapsed,
      spans,
      spanLabelPlacement,
      collapsedActivityDirection,
      collapsedActivityIntervals = EMPTY_TRACE_PROCESS_ACTIVITY_INTERVALS,
      overflowLabels = EMPTY_TRACE_LAYOUT_OVERFLOW_LABELS,
      onToggleProcess,
      fontFamily
    } = this.props;
    this.ensureDerivedState();
    const {
      maxCollapsedActivity = 0,
      visibleHoveredBlock,
      visibleHoveredBlockData = EMPTY_HOVERED_TRACE_RENDER_SPANS,
      visibleDependencyData = EMPTY_TRACE_RANK_DEPENDENCY_DATA,
      visibleDependencyGeometryTrigger
    } = this.state as Partial<TraceProcessLayerState>;
    const rankLayout = traceLayout.processLayouts?.[rankIndex];

    const effectiveIsCollapsed = rankLayout
      ? rankLayout.isCollapsed === true
      : Boolean(isCollapsed);

    const geometryShapeTrigger = getTraceProcessLayerGeometryShapeTrigger(
      traceLayout,
      processId,
      rankIndex
    );
    const geometryUpdateTriggers = makeGeometryUpdateTriggers(
      settings,
      traceLayout,
      updateTrigger,
      geometryShapeTrigger
    );
    const blockGeometryUpdateTriggers = makeGeometryUpdateTriggers(
      settings,
      traceLayout,
      updateTrigger,
      binaryBlockData ?? geometryShapeTrigger
    );
    const dependencyGeometryUpdateTriggers = makeGeometryUpdateTriggers(
      settings,
      traceLayout,
      updateTrigger,
      binaryDependencyLineData ?? visibleDependencyGeometryTrigger ?? geometryShapeTrigger
    );
    const spanLabelGeometryUpdateTriggers = makeGeometryUpdateTriggers(
      settings,
      traceLayout,
      updateTrigger,
      binaryBlockData ??
        getTraceProcessLayerSpanLabelGeometryTrigger(traceLayout, processId, rankIndex)
    );
    const colorUpdateTriggers = [
      ...makeColorUpdateTriggers(settings, highlightedSpanRefs),
      colorScheme
    ];
    const colorResolver = createTraceColorResolver({
      colorScheme,
      settings,
      highlightedSpanRefs
    });
    const minSpanWidthPixels = settings.minSpanWidthPixels ?? DEFAULT_SPAN_WIDTH_MIN_PIXELS;
    const graphColorResolver = createTraceGraphColorResolver({
      traceGraph: traceLayout.traceGraph,
      colorScheme,
      settings,
      highlightedSpanRefs
    });
    const collapsedActivityOpacityMultiplier = shouldFadeCollapsedActivity({
      layerId: this.props.id,
      selectedSpanRefs,
      highlightedSpanRefs
    })
      ? getHighlightFadeMultiplier(settings)
      : 1;
    const collapsedActivityOriginY = rankLayout
      ? getCollapsedActivityOriginY(rankLayout, settings)
      : 0;
    const layoutDensityKey = settings.layoutDensity ?? 'comfortable';
    const {spanLabelFontSize, spanLabelPosition} = getLayoutDensityPreset(layoutDensityKey);
    const isInsideBlockText = spanLabelPosition === 'inside';
    const currentBinaryGeometryOffset = getTraceProcessLayerBinaryGeometryOffset(
      traceLayout,
      processId,
      rankIndex
    );
    const blockBinaryModelMatrix = getTraceProcessLayerBinaryModelMatrix({
      baseModelMatrix: this.props.modelMatrix,
      currentGeometryXOffset: currentBinaryGeometryOffset.x,
      currentGeometryYOffset: currentBinaryGeometryOffset.y,
      encodedGeometryXOffset: binaryBlockData?.geometryXOffset,
      encodedGeometryYOffset: binaryBlockData?.geometryYOffset
    });
    const dependencyBinaryModelMatrix = getTraceProcessLayerBinaryModelMatrix({
      baseModelMatrix: this.props.modelMatrix,
      currentGeometryXOffset: currentBinaryGeometryOffset.x,
      currentGeometryYOffset: currentBinaryGeometryOffset.y,
      encodedGeometryXOffset: binaryDependencyLineData?.geometryXOffset,
      encodedGeometryYOffset: binaryDependencyLineData?.geometryYOffset
    });

    const showBaseDependencies =
      settings.showDependencies && !visibleHoveredBlock && !effectiveIsCollapsed;
    const dependencyLineLayer = !shouldUseBinaryStraightDependencyLineData({
      settings,
      binaryDependencyLineData
    })
      ? new DependencyArrowLayer<TraceRankDependencyDatum, {rankIndex: number}>(
          this.getSubLayerProps({
            id: 'dependency-lines',
            visible: showBaseDependencies
          }),
          {
            data: visibleDependencyData,
            modelMatrix: dependencyBinaryModelMatrix,
            positionFormat: 'XY',
            updateTriggers: {
              getPath: dependencyGeometryUpdateTriggers,
              getColor: colorUpdateTriggers,
              getMarkerColor: colorUpdateTriggers
            },
            ...(settings.transitions
              ? {
                  transitions: {
                    getPath: TRACE_SPAN_POSITION_TRANSITION
                  }
                }
              : {}),
            getPath: (dependency: TraceRankDependencyDatum) => dependency.path,
            getColor: (dependency: TraceRankDependencyDatum) => dependency.color,
            getMarkerColor: (dependency: TraceRankDependencyDatum) => dependency.markerColor,
            getDirection: (dependency: TraceRankDependencyDatum) => dependency.direction,
            getMarkerPlacements: (dependency: TraceRankDependencyDatum) =>
              dependency.markerPlacements,
            getMarkerSize: [2, 1],
            getWidth: LOCAL_DEPENDENCY_LINE_WIDTH_PX,
            markerSizeScale: LOCAL_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
            widthUnits: 'pixels',
            pickable: true,
            autoHighlight: true,
            highlightColor: TRACE_COLOR.DEPENDENCY_HIGHLIGHT as [number, number, number, number],
            mode: settings.lineRoutingMode === 'curve' ? 'arc' : 'line',
            getArcTilt: 90,
            getArcHeight: 0.3,
            rankIndex,
            parameters: {
              blend: false,
              depthWriteEnabled: false,
              depthCompare: 'always'
            }
          }
        )
      : new LineLayer<TraceRankDependencyDatum, {rankIndex: number}>({
          ...this.getSubLayerProps({
            id: 'dependency-lines',
            visible: showBaseDependencies
          }),
          data: (binaryDependencyLineData?.data ?? visibleDependencyData) as never,
          modelMatrix: dependencyBinaryModelMatrix,
          positionFormat: 'XY',
          getSourcePosition: (dependency: TraceRankDependencyDatum) => [
            dependency.path[0] ?? 0,
            dependency.path[1] ?? 0,
            0
          ],
          getTargetPosition: (dependency: TraceRankDependencyDatum) => [
            dependency.path[dependency.path.length - 2] ?? 0,
            dependency.path[dependency.path.length - 1] ?? 0,
            0
          ],
          getColor: (dependency: TraceRankDependencyDatum) => dependency.color,
          getWidth: LOCAL_DEPENDENCY_LINE_WIDTH_PX,
          widthUnits: 'pixels',
          pickable: true,
          autoHighlight: true,
          highlightColor: TRACE_COLOR.DEPENDENCY_HIGHLIGHT as [number, number, number, number],
          updateTriggers: {
            getSourcePosition: dependencyGeometryUpdateTriggers,
            getTargetPosition: dependencyGeometryUpdateTriggers,
            getColor: colorUpdateTriggers,
            getWidth: [LOCAL_DEPENDENCY_LINE_WIDTH_PX]
          },
          parameters: {
            blend: false,
            depthWriteEnabled: false,
            depthCompare: 'always'
          },
          rankIndex
        });

    const blockRectangleLayer = new BlockLayer<SpanRef, {rankIndex: number}>(
      this.getSubLayerProps({
        id: 'block-rectangles',
        visible: !visibleHoveredBlock && !effectiveIsCollapsed
      }),
      {
        data: (binaryBlockData?.data ?? spans) as never,
        modelMatrix: blockBinaryModelMatrix,
        opacity: settings.showPathsOnly ? 0.25 : 1,
        positionFormat: 'XY',
        getPosition: (span: SpanRef) => {
          const bbox = getTraceRenderSpanGeometry(span, traceLayout);
          if (!bbox) {
            return [0, 0];
          }
          return [bbox[0], bbox[1]];
        },
        getSize: (span: SpanRef) => {
          const bbox = getTraceRenderSpanGeometry(span, traceLayout);
          if (!bbox) {
            return [0, 0];
          }
          return [bbox[2] - bbox[0], bbox[3] - bbox[1]];
        },
        getFillColor: (span: SpanRef) =>
          getTraceRenderSpanFillColor({span, traceLayout, colorResolver, graphColorResolver}),
        getLineColor: (span: SpanRef) =>
          getTraceRenderSpanBorderColor({span, traceLayout, colorResolver, graphColorResolver}),
        getLineWidth: SPAN_LINE_WIDTH_PX,
        updateTriggers: {
          getPosition: blockGeometryUpdateTriggers,
          getSize: blockGeometryUpdateTriggers,
          getFillColor: colorUpdateTriggers,
          getLineColor: colorUpdateTriggers
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getSize: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        lineWidthUnits: 'pixels',
        widthMinPixels: minSpanWidthPixels,
        heightMinPixels: SPAN_HEIGHT_MIN_PIXELS,
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        onClick: onSpanClick,
        rankIndex
      }
    );

    const blockRectangleHoveredLayer = new BlockLayer<TraceRenderSpan, {rankIndex: number}>(
      this.getSubLayerProps({
        id: 'block-rectangle-hovered',
        visible: !!visibleHoveredBlock && !effectiveIsCollapsed
      }),
      {
        data: visibleHoveredBlockData,
        positionFormat: 'XY',
        getPosition: (span: TraceRenderSpan) => {
          const bbox = getTraceRenderSpanGeometry(span, traceLayout);
          if (!bbox) {
            return [0, 0];
          }
          return [bbox[0], bbox[1]];
        },
        getSize: (span: TraceRenderSpan) => {
          const bbox = getTraceRenderSpanGeometry(span, traceLayout);
          if (!bbox) {
            return [0, 0];
          }
          return [bbox[2] - bbox[0], bbox[3] - bbox[1]];
        },
        getFillColor: HOVERED_BLOCK_FILL_COLOR,
        getLineColor: HOVERED_BLOCK_LINE_COLOR,
        getLineWidth: 1.5,
        updateTriggers: {
          getPosition: geometryUpdateTriggers,
          getSize: geometryUpdateTriggers,
          getFillColor: colorUpdateTriggers,
          getLineColor: colorUpdateTriggers,
          getLineWidth: colorUpdateTriggers
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getSize: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        lineWidthUnits: 'pixels',
        widthMinPixels: minSpanWidthPixels,
        heightMinPixels: SPAN_HEIGHT_MIN_PIXELS,
        pickable: true,
        autoHighlight: true,
        highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
        parameters: {
          blend: false,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        onClick: onSpanClick,
        rankIndex
      }
    );

    const shouldRenderBlockRectangleBorders =
      binaryBlockData == null && !visibleHoveredBlock && !effectiveIsCollapsed;
    const blockRectangleBorderLayer = new PathLayer<SpanRef, {rankIndex: number}>({
      ...this.getSubLayerProps({
        id: 'block-rectangle-borders',
        visible: shouldRenderBlockRectangleBorders
      }),
      data: binaryBlockData == null ? spans : EMPTY_TRACE_RENDER_SPANS,
      modelMatrix: blockBinaryModelMatrix,
      positionFormat: 'XY',
      getPath: (span: SpanRef) => {
        const bbox = getTraceRenderSpanGeometry(span, traceLayout);
        if (!bbox || bbox[2] <= bbox[0] || bbox[3] <= bbox[1]) {
          return [];
        }
        return [
          [bbox[0], bbox[1]],
          [bbox[2], bbox[1]],
          [bbox[2], bbox[3]],
          [bbox[0], bbox[3]],
          [bbox[0], bbox[1]]
        ];
      },
      getColor: (span: SpanRef) =>
        getTraceRenderSpanBorderColor({span, traceLayout, colorResolver, graphColorResolver}),
      getWidth: SPAN_LINE_WIDTH_PX,
      updateTriggers: {
        getPath: geometryUpdateTriggers,
        getColor: colorUpdateTriggers
      },
      ...(settings.transitions
        ? {
            transitions: {
              getPath: TRACE_SPAN_POSITION_TRANSITION
            }
          }
        : {}),
      widthUnits: 'pixels',
      widthMinPixels: SPAN_BORDER_LINE_MIN_PIXELS,
      pickable: false,
      parameters: {
        blend: false,
        depthWriteEnabled: false,
        depthCompare: 'always'
      },
      rankIndex
    });

    const mergedOverflowLabelData = overflowLabels;

    const blockNameTextSize = isInsideBlockText ? spanLabelFontSize : 10;
    // If we are rendering text outside the block, we apply a minimum cutoff to avoid a cluttered view.
    const clipRectCutoffPixels: [number, number] = isInsideBlockText
      ? [0, blockNameTextSize]
      : [56, blockNameTextSize];
    const shouldRenderBlockLabels = !effectiveIsCollapsed;
    const spanLabelTextUpdateTriggers = [spans.length, updateTrigger ?? 0];
    const blockLabelLayerProps = this.getSubLayerProps({
      id: `block-labels-${isInsideBlockText ? 'inside' : 'above'}`,
      visible: shouldRenderBlockLabels
    });
    const spanLabelModelMatrix = binaryBlockData ? blockBinaryModelMatrix : this.props.modelMatrix;
    /** Returns the anchor position for one span label. */
    const getSpanLabelPosition = (
      span: SpanRef,
      objectInfo?: {readonly index?: number}
    ): [number, number] => {
      const bbox = getTraceSpanLabelGeometry({
        span,
        traceLayout,
        binaryBlockData,
        objectInfo
      });
      if (!bbox) {
        return HIDDEN_SPAN_LABEL_POSITION;
      }
      return isInsideBlockText ? [bbox[0], bbox[1]] : [bbox[0], bbox[1] + 0.025];
    };
    /** Returns the local content box used to hide labels that exceed their span. */
    const getSpanLabelContentBox = (
      span: SpanRef,
      objectInfo?: {readonly index?: number}
    ): [number, number, number, number] => {
      const bbox = getTraceSpanLabelGeometry({
        span,
        traceLayout,
        binaryBlockData,
        objectInfo
      });
      if (!bbox) {
        return EMPTY_SPAN_LABEL_BOX;
      }
      const width = bbox[2] - bbox[0];
      return isInsideBlockText ? [0, -0.5, width, 2] : [0, -1, width, 2];
    };
    /** Returns the 16-bit clip rectangle consumed by the experimental fast text path. */
    const getSpanLabelClipRect = (
      span: SpanRef,
      objectInfo?: {readonly index?: number}
    ): [number, number, number, number] => {
      const bbox = getTraceSpanLabelGeometry({
        span,
        traceLayout,
        binaryBlockData,
        objectInfo
      });
      if (!bbox) {
        return EMPTY_SPAN_LABEL_BOX;
      }
      return [0, -1, Math.min(32767, Math.max(0, bbox[2] - bbox[0])), 2];
    };
    /** Returns the resolved text color for one span label. */
    const getSpanLabelColor = (span: SpanRef) =>
      getTraceRenderSpanTextColor({
        span,
        traceLayout,
        colorResolver,
        graphColorResolver,
        isInsideBlockText
      });

    const blockNamesLayer =
      settings.enableFastTextLayer === true
        ? new FastTextLayer<SpanRef>(blockLabelLayerProps, {
            data: spans,
            modelMatrix: spanLabelModelMatrix,
            updateTriggers: {
              getText: spanLabelTextUpdateTriggers,
              getTextUtf8: spanLabelTextUpdateTriggers,
              getPosition: [...spanLabelGeometryUpdateTriggers, spanLabelPosition],
              getClipRect: [...spanLabelGeometryUpdateTriggers, spanLabelPosition],
              getColor: colorUpdateTriggers
            },
            pickable: false,
            getPosition: getSpanLabelPosition,
            getClipRect: getSpanLabelClipRect,
            getContentBox: getSpanLabelContentBox,
            contentCutoffPixels: clipRectCutoffPixels,
            getTextUtf8: (span: SpanRef, out) =>
              getTraceGraphSpanNameUtf8(traceLayout.traceGraph, span, out),
            singleLine: true,
            getText: (span: SpanRef) => getTraceRenderSpanName(span, traceLayout),
            pixelOffset: isInsideBlockText ? [INSIDE_BLOCK_LABEL_LEFT_INSET_PX, 0] : [0, 0],
            getPixelOffset: isInsideBlockText ? [INSIDE_BLOCK_LABEL_LEFT_INSET_PX, 0] : [0, 0],
            contentAlignHorizontal: spanLabelPlacement === 'start' ? 'start' : 'center',
            textAnchor: spanLabelPlacement === 'start' ? 'start' : 'middle',
            alignmentBaseline: isInsideBlockText ? 'top' : 'bottom',
            getColor: getSpanLabelColor,
            size: blockNameTextSize,
            fontFamily,
            parameters: {
              blend: true,
              depthWriteEnabled: false,
              depthCompare: 'always'
            }
          })
        : new TextLayer<SpanRef>(blockLabelLayerProps, {
            data: spans,
            modelMatrix: spanLabelModelMatrix,
            updateTriggers: {
              getPath: blockGeometryUpdateTriggers,
              getText: spanLabelTextUpdateTriggers,
              getPosition: [...spanLabelGeometryUpdateTriggers, spanLabelPosition],
              getClipRect: [...spanLabelGeometryUpdateTriggers, spanLabelPosition],
              getColor: colorUpdateTriggers
            },
            fontFamily,
            ...(settings.transitions
              ? {
                  transitions: {
                    getPosition: TRACE_SPAN_POSITION_TRANSITION,
                    getClipRect: TRACE_SPAN_POSITION_TRANSITION
                  }
                }
              : {}),
            getPosition: getSpanLabelPosition,
            getContentBox: getSpanLabelContentBox,
            contentCutoffPixels: clipRectCutoffPixels,
            getText: (span: SpanRef) => getTraceRenderSpanName(span, traceLayout),
            getPixelOffset: isInsideBlockText ? [INSIDE_BLOCK_LABEL_LEFT_INSET_PX, 0] : [0, 0],
            contentAlignHorizontal: spanLabelPlacement === 'start' ? 'start' : 'center',
            getTextAnchor: spanLabelPlacement === 'start' ? 'start' : 'middle',
            getAlignmentBaseline: isInsideBlockText ? 'top' : 'bottom',
            getColor: getSpanLabelColor,
            getSize: blockNameTextSize,
            pickable: false,
            parameters: {
              blend: true,
              depthWriteEnabled: false,
              depthCompare: 'always'
            }
          });

    const overflowLabelLayer = new TextLayer<TraceLayoutOverflowLabelDatum>(
      this.getSubLayerProps({
        id: 'overflow-labels',
        visible: mergedOverflowLabelData.length > 0
      }),
      {
        data: mergedOverflowLabelData,
        updateTriggers: {
          getPosition: [...geometryUpdateTriggers, effectiveIsCollapsed],
          getClipRect: [...geometryUpdateTriggers, effectiveIsCollapsed],
          getText: [mergedOverflowLabelData]
        },
        ...(settings.transitions
          ? {
              transitions: {
                getPosition: TRACE_SPAN_POSITION_TRANSITION,
                getClipRect: TRACE_SPAN_POSITION_TRANSITION
              }
            }
          : {}),
        getPosition: (datum: TraceLayoutOverflowLabelDatum) => [datum.x, datum.y],
        getContentBox: (datum: TraceLayoutOverflowLabelDatum) => [
          0,
          -1,
          Math.max(0, datum.maxX - datum.x),
          2
        ],
        contentCutoffPixels: [0, 10],
        getText: (datum: TraceLayoutOverflowLabelDatum) => datum.text,
        contentAlignHorizontal: 'start',
        getTextAnchor: 'start',
        getAlignmentBaseline: 'center',
        getPixelOffset: [6, 0],
        getColor: TRACE_COLOR.THREAD_TEXT,
        getSize: 10,
        sizeUnits: 'pixels',
        sizeMaxPixels: 14,
        fontFamily,
        fontWeight: 500,
        wordBreak: 'break-word',
        maxWidth: 400,
        pickable: false,
        parameters: {
          blend: true,
          depthWriteEnabled: false,
          depthCompare: 'always'
        }
      }
    );

    const collapsedActivityLayer = new BlockLayer<TraceProcessActivityInterval>(
      this.getSubLayerProps({
        id: 'collapsed-activity',
        visible:
          Boolean(rankLayout) && effectiveIsCollapsed && collapsedActivityIntervals.length > 0
      }),
      {
        data: collapsedActivityIntervals,
        positionFormat: 'XY',
        getPosition: interval => [
          interval.startX,
          rankLayout
            ? getCollapsedActivityIntervalY({rankLayout, settings, interval})
            : collapsedActivityOriginY
        ],
        getSize: interval => {
          if (interval.height != null && Number.isFinite(interval.height)) {
            return [interval.endX - interval.startX, interval.height];
          }
          const normalized =
            maxCollapsedActivity > 0 ? Math.min(1, interval.activity / maxCollapsedActivity) : 0;
          const h =
            COLLAPSED_ACTIVITY_MIN_WIDTH_PX +
            normalized * (COLLAPSED_ACTIVITY_MAX_WIDTH_PX - COLLAPSED_ACTIVITY_MIN_WIDTH_PX);
          return [interval.endX - interval.startX, collapsedActivityDirection === 'down' ? h : -h];
        },
        getFillColor: interval => {
          return getCollapsedActivityFillColor(interval, collapsedActivityOpacityMultiplier);
        },
        getLineWidth: 0,
        heightMinPixels: SPAN_HEIGHT_MIN_PIXELS,
        pickable: true,
        parameters: {
          blend: true,
          depthWriteEnabled: true,
          depthCompare: 'less-equal'
        },
        onClick: () => {
          if (effectiveIsCollapsed && rankLayout) {
            onToggleProcess?.(this.props.processId, this.props.rankProcessRef);
          }
        },
        updateTriggers: {
          getPosition: [collapsedActivityOriginY],
          getSize: [maxCollapsedActivity, collapsedActivityDirection],
          getFillColor: [collapsedActivityOpacityMultiplier],
          onClick: [effectiveIsCollapsed, onToggleProcess]
        }
      }
    );

    const baseTraceLayers = this.buildBaseTraceLayers([
      // backgroundColorLayer,
      collapsedActivityLayer,
      dependencyLineLayer,
      blockRectangleLayer,
      blockRectangleBorderLayer,
      blockRectangleHoveredLayer,
      blockNamesLayer,
      overflowLabelLayer
    ]);
    return baseTraceLayers;
  }
}

/** Returns a row-local geometry shape trigger so append-only layout objects do not invalidate old ranks. */
function getTraceProcessLayerGeometryShapeTrigger(
  traceLayout: Readonly<TraceLayout> | undefined,
  processId: string,
  rankIndex: number
): unknown {
  if (!traceLayout) {
    return '';
  }
  const geometryEntry = traceLayout.geometryCache?.processesById[processId];
  if (!geometryEntry) {
    return traceLayout;
  }
  const processLayout = traceLayout.processLayouts[rankIndex];
  return [geometryEntry.fastReuseKey ?? geometryEntry.reuseKey, processLayout?.yHeight ?? 0].join(
    '|'
  );
}

/** Returns a fallback span-label geometry trigger for non-binary rows. */
function getTraceProcessLayerSpanLabelGeometryTrigger(
  traceLayout: Readonly<TraceLayout>,
  processId: string,
  rankIndex: number
): unknown {
  const geometryShapeTrigger = getTraceProcessLayerGeometryShapeTrigger(
    traceLayout,
    processId,
    rankIndex
  );
  const currentGeometryOffset = getTraceProcessLayerBinaryGeometryOffset(
    traceLayout,
    processId,
    rankIndex
  );
  return [geometryShapeTrigger, currentGeometryOffset.x, currentGeometryOffset.y].join('|');
}

/** Returns the current absolute X/Y offset for binary attributes rendered by one process layer. */
function getTraceProcessLayerBinaryGeometryOffset(
  traceLayout: Readonly<TraceLayout>,
  processId: string,
  rankIndex: number
): {x: number; y: number} {
  const geometryEntry = traceLayout.geometryCache?.processesById[processId];
  const geometryXOffset = geometryEntry?.geometryXOffset;
  const geometryYOffset = geometryEntry?.geometryYOffset;
  const x =
    typeof geometryXOffset === 'number' && Number.isFinite(geometryXOffset) ? geometryXOffset : 0;
  if (typeof geometryYOffset === 'number' && Number.isFinite(geometryYOffset)) {
    return {x, y: geometryYOffset};
  }
  const layoutYOffset = traceLayout.processLayouts[rankIndex]?.yOffset;
  return {
    x,
    y: typeof layoutYOffset === 'number' && Number.isFinite(layoutYOffset) ? layoutYOffset : 0
  };
}

/** Returns a model matrix that moves reused binary buffers to the row's current X/Y offset. */
function getTraceProcessLayerBinaryModelMatrix({
  baseModelMatrix,
  currentGeometryXOffset,
  currentGeometryYOffset,
  encodedGeometryXOffset,
  encodedGeometryYOffset
}: {
  readonly baseModelMatrix?: TraceProcessLayerProps['modelMatrix'];
  readonly currentGeometryXOffset: number;
  readonly currentGeometryYOffset: number;
  readonly encodedGeometryXOffset?: number;
  readonly encodedGeometryYOffset?: number;
}): TraceProcessLayerProps['modelMatrix'] {
  const xDelta =
    currentGeometryXOffset -
    (typeof encodedGeometryXOffset === 'number' && Number.isFinite(encodedGeometryXOffset)
      ? encodedGeometryXOffset
      : currentGeometryXOffset);
  const yDelta =
    currentGeometryYOffset -
    (typeof encodedGeometryYOffset === 'number' && Number.isFinite(encodedGeometryYOffset)
      ? encodedGeometryYOffset
      : currentGeometryYOffset);
  if (xDelta === 0 && yDelta === 0) {
    return baseModelMatrix ?? undefined;
  }
  const matrix = baseModelMatrix
    ? new Matrix4(baseModelMatrix as Matrix4)
    : new Matrix4().identity();
  matrix.translate([xDelta, yDelta, 0]);
  return matrix;
}
