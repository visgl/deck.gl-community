import {Layer, PickingInfo} from '@deck.gl/core';
import {PathStyleExtension} from '@deck.gl/extensions';
import {PathLayer, PolygonLayer, ScatterplotLayer, TextLayer} from '@deck.gl/layers';
import {Matrix4} from '@math.gl/core';
import {AnimationLayer, BlockLayer} from '@deck.gl-community/infovis-layers';
import {DependencyArrowLayer, PathDirection} from '@deck.gl-community/layers';
import {TimeAxisLayer} from '@deck.gl-community/timeline-layers';

import {
  CounterSparkline,
  DEFAULT_COUNTER_COLOR,
  DEFAULT_INSTANT_COLOR,
  DEFAULT_TRACE_FONT_FAMILY,
  getMemoizedDerivedTraceData,
  getTraceLayoutFilteredSpanCountByThreadId,
  getTraceLayoutFilteredSpanCountByThreadRef,
  getTraceLayoutOverflowLabelThreadName,
  traceLog
} from '../../trace/index';
import {
  DEFAULT_TRACE_COLOR_SCHEME,
  getSelectedLocalDependencyLineColor,
  makeDeckColor,
  TRACE_COLOR
} from '../../trace/trace-style/trace-colors';
import {TraceLegendLayer} from '../layers/legend-layer';
import {TraceCrossDependencyLayer} from '../layers/trace-cross-dependency-layer';
import {TracePathLayer} from '../layers/trace-path-layer';
import {TraceProcessLayer} from '../layers/trace-process-layer';
import {TimeMeasureLayer} from './time-measure-layer';
import {
  getTraceLayoutSelectedLocalDependencyGeometry,
  getTraceLayoutSpanGeometryBySpanRef
} from './trace-layout-geometry';
import {ViewportHighlightLayer} from './viewport-highlight-layer';

import type {
  SpanRef,
  ThreadRef,
  TraceColorScheme,
  TraceCounterSource,
  TraceCrossDependencySource,
  TraceDeckBinaryAttributeData,
  TraceDeckBinaryProcessActivityData,
  TraceEventSource,
  TraceGraph,
  TraceGraphPathBlockSource,
  TraceGraphPathDependencySource,
  TraceGraphSelectedCrossDependencySource,
  TraceGraphSelectedLocalDependencySource,
  TraceInstantSource,
  TraceLayout,
  TraceLayoutBounds,
  TraceLayoutOverflowLabelDatum,
  TraceLayoutRow,
  TraceLocalDependencySource,
  TracePreparedGraphScene,
  TracePreparedMinimapSpanIndicator,
  TraceProcessInfo,
  TraceRenderSpan,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace/index';
import type {PathStyleExtensionProps} from '@deck.gl/extensions';
import type {Bounds} from '@deck.gl-community/infovis-layers';
import type {Tick} from '@deck.gl-community/timeline-layers';
import type {TimeMeasureSelectionState} from '@deck.gl-community/widgets';

type OverviewEventMarkerDatum = {
  /** Stable marker identifier used by the minimap layer. */
  id: string;
  /** X position in minimap-local coordinates. */
  x: number;
  /** Y position in minimap-local coordinates. */
  y: number;
  /** Optional radius multiplier applied to the minimap marker size. */
  radiusScale?: number;
  /** Optional RGBA fill color for the minimap marker. */
  fillColor?: readonly [number, number, number, number];
  /** Optional RGBA stroke color for the minimap marker. */
  lineColor?: readonly [number, number, number, number];
  /** Tooltip payload returned on hover. */
  object: unknown;
};

type OverviewUnloadedIntervalDatum = {
  /** Full-height polygon covering an unloaded minimap time interval. */
  polygon: [number, number][];
  /** Center X coordinate for the unloaded interval label. */
  labelX: number;
  /** Center Y coordinate for the unloaded interval label. */
  labelY: number;
  /** User-facing label describing the interval state. */
  label: string;
};

type RowSeparatorDatum = {
  /** Render row whose rank layout owns the separator geometry. */
  row: TraceLayoutRow;
  /** Which precomputed separator edge to render for the row. */
  edge: 'top' | 'bottom';
  /** Separator path clipped to the trace time extents. */
  path: Float32Array;
};

type MinimapSpanIndicatorLineDatum = {
  /** Source indicator that owns this line segment. */
  readonly indicator: TracePreparedMinimapSpanIndicator;
  /** Full-height vertical path for the indicator hairline. */
  readonly path: [number, number][];
};

type MinimapSpanIndicatorWhiskerDatum = {
  /** Source indicator that owns this whisker segment. */
  readonly indicator: TracePreparedMinimapSpanIndicator;
  /** Horizontal path for the indicator duration whisker. */
  readonly path: [number, number][];
};

type MinimapSpanIndicatorWhiskerCapDatum = {
  /** Source indicator that owns this whisker book-end cap. */
  readonly indicator: TracePreparedMinimapSpanIndicator;
  /** X position of the whisker book-end cap in minimap-local coordinates. */
  readonly x: number;
};

const TEXT_LAYER_CHARACTER_SET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~▸▾';
const RANK_LABEL_BACKGROUND_COLOR = [255, 255, 255, 220] as [number, number, number, number];
const RANK_LABEL_BACKGROUND_PADDING = [6, 4] as [number, number];
const RANK_LABEL_LEFT_EDGE_OFFSET_PX = -142;
const RANK_ROW_SEPARATOR_COLOR = [0, 0, 0, 160] as [number, number, number, number];
const RANK_ROW_SEPARATOR_DASH_ARRAY = [5, 4] as [number, number];
const RANK_ROW_SEPARATOR_WIDTH_PX = 1;
const ROW_SEPARATOR_HORIZONTAL_EXTENT = 1e6;
const NODENAME_BACKGROUND_COLOR = [0, 196, 0, 255] as [number, number, number, number];
const NODENAME_BACKGROUND_PADDING = [4, 2] as [number, number];
const RANK_LABEL_SIZE = 14;
const SYNTHETIC_LEGEND_THREAD_ID = 'all_threads' as TraceThreadId;
const COMBINED_THREAD_LABEL = 'all_threads';
const OVERVIEW_EVENT_MARKER_RADIUS_PX = 4.8;
const OVERVIEW_EVENT_MARKER_LINE_WIDTH_PX = 1;
const OVERVIEW_AXIS_LABEL_TOP_MARGIN_FRACTION = 0.16;
const OVERVIEW_EVENT_MARKER_Y_FRACTION = 0.07;
const OVERVIEW_UNLOADED_INTERVAL_TOP_INSET_FRACTION = 0.26;
const OVERVIEW_UNLOADED_INTERVAL_LABEL = 'Not loaded';
const MAIN_TIMELINE_EVENT_MARKER_Y_OFFSET = 0.18;
const MINIMAP_SELECTED_SPAN_INDICATOR_DOT_RADIUS_PX = 4.5;
const MINIMAP_SELECTED_SPAN_INDICATOR_HOVER_DOT_RADIUS_PX = 3.8;
const MINIMAP_SELECTED_SPAN_INDICATOR_RING_RADIUS_PX = 7.5;
const MINIMAP_SELECTED_SPAN_INDICATOR_HOVER_RING_RADIUS_PX = 6.5;
const MINIMAP_SELECTED_SPAN_INDICATOR_TOP_CAP_RADIUS_PX = 3;
const MINIMAP_SELECTED_SPAN_INDICATOR_LINE_WIDTH_PX = 1.5;
const MINIMAP_SELECTED_SPAN_INDICATOR_RING_LINE_WIDTH_PX = 2;
const MINIMAP_SELECTED_SPAN_INDICATOR_WHISKER_WIDTH_PX = 2;
const MINIMAP_SELECTED_SPAN_INDICATOR_WHISKER_CAP_HEIGHT_PX = 12;
const DEFAULT_SPAN_WIDTH_MIN_PIXELS = 2;
const SELECTED_BLOCK_HIGHLIGHT_LINE_WIDTH_PX = 4;
const SELECTED_BLOCK_HIGHLIGHT_OUTER_OFFSET = 0.5;
const SELECTED_BLOCK_HIGHLIGHT_COLOR_IDLE = [0, 0, 0, 255] as [number, number, number, number];
const SELECTED_BLOCK_HIGHLIGHT_COLOR_PULSE = [255, 0, 0, 255] as [number, number, number, number];
const SELECTED_BLOCK_HIGHLIGHT_PULSE_DURATION_MS = 1200;
const SELECTED_BLOCK_HIGHLIGHT_PARAMETERS = {
  blend: true,
  depthTest: true,
  depthWriteEnabled: true,
  depthCompare: 'less'
} as const;
const SELECTED_DEPENDENCY_OVERLAY_PARAMETERS = {
  blend: false,
  depthTest: true,
  depthWriteEnabled: true,
  depthCompare: 'always'
} as const;
const HOVERED_BLOCK_HIGHLIGHT_LINE_WIDTH_PX = 1.5;
const SELECTED_LOCAL_DEPENDENCY_LINE_WIDTH_PX = 2;
const PATH_DEPENDENCY_MARKER_SIZE = 3;
const FORWARD_DEPENDENCY_MARKER_PLACEMENTS = [1];
const BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS = [1];
const GLOBAL_EVENT_LABEL = 'Run Events';
const HEADER_TIME_AXIS_MODEL_MATRIX = new Matrix4().translate([0, -12, -1]);
const HEADER_TIME_AXIS_DEPTH_PARAMETERS = {
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'less'
} as const;
const EMPTY_SELECTED_SPAN_REFS: readonly SpanRef[] = [];
const EMPTY_SELECTED_LOCAL_DEPENDENCIES: readonly TraceLocalDependencySource[] = [];
const EMPTY_SELECTED_CROSS_DEPENDENCIES: readonly TraceCrossDependencySource[] = [];
const EMPTY_MINIMAP_SPAN_INDICATORS: readonly TracePreparedMinimapSpanIndicator[] = [];
const EMPTY_ROW_SEPARATOR_LINE = new Float32Array();
const EMPTY_LAYER_UPDATE_TRIGGER = {};
const EMPTY_LAYER_UPDATE_TRIGGERS = [EMPTY_LAYER_UPDATE_TRIGGER];

type TraceDeckLayerGroup = 'all' | 'base' | 'selection';

/** Transient hover, selection, and highlight overlays for deck trace layers. */
export type TraceDeckLayerSelection = {
  /** Transient hovered span used for hover overlay rendering. */
  readonly hoveredSpan?: {rankIndex: number; block?: TraceRenderSpan} | null;
  /** Exact selected span refs used for the animated selected-block overlay. */
  readonly selectedSpanRefs?: readonly SpanRef[];
  /** Legacy selected local dependency sources used for overlay rendering. */
  readonly selectedDependencies?: readonly TraceLocalDependencySource[];
  /** Legacy selected cross-process dependency sources used for overlay rendering. */
  readonly selectedCrossDependencies?: readonly TraceCrossDependencySource[];
  /** Graph-native selected local dependency sources grouped by process id. */
  readonly selectedLocalDependencySourcesByProcessId?: Readonly<
    Partial<Record<string, readonly TraceGraphSelectedLocalDependencySource[]>>
  >;
  /** Graph-native selected cross-process dependency sources used for overlay rendering. */
  readonly selectedCrossDependencySources?: readonly TraceGraphSelectedCrossDependencySource[];
  /** Span refs highlighted by path or search state. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
};

/** Interaction callbacks used by deck trace layers. */
export type TraceDeckLayerHandlers = {
  /** Callback fired when a span block is clicked. */
  readonly onSpanClick: (
    info: PickingInfo,
    event?: {srcEvent?: {shiftKey?: boolean}}
  ) => boolean | void;
  /** Callback fired when a collapsed process activity row should toggle expansion. */
  readonly onToggleProcess?: (processId: string, processRef?: TraceLayoutRow['processRef']) => void;
};

/** Inputs for building deck.gl layers from one prepared graph scene. */
export type BuildDeckLayersForTraceParams = {
  /** Prepared graph scene that supplies stable graph, layout, rows, model matrix, and dependencies. */
  readonly scene: TracePreparedGraphScene;
  /** Transient hover and selection overlays rendered over the stable prepared scene. */
  readonly selection?: TraceDeckLayerSelection;
  /** Active visualization settings used by trace process and dependency layers. */
  readonly settings: TraceVisSettings;
  /** Event handlers passed through to interactive trace layers. */
  readonly handlers: TraceDeckLayerHandlers;
  /** Step number attached to process layers for compatibility with existing picking payloads. */
  readonly stepNum: number;
  /** Active trace color scheme used by deck layers. */
  readonly colorScheme?: TraceColorScheme;
  /** CSS font stack used by deck text labels. */
  readonly fontFamily?: string;
  /** Whether dashed row separators should be rendered for this trace layer group. */
  readonly showRowSeparators?: boolean;
  /** Direction collapsed activity summaries grow relative to the row baseline. */
  readonly collapsedActivityDirection?: 'up' | 'down';
  /** Which subset of trace layers to build for React render stability. */
  readonly layerGroup?: TraceDeckLayerGroup;
};

type TraceDeckSelectedLocalDependencyDatum =
  | (TraceLocalDependencySource & {
      /** Exact visible local dependency ref used to resolve overlay geometry. */
      readonly dependencyRef: NonNullable<TraceLocalDependencySource['dependencyRef']>;
      /** Optional legacy selected-dependency direction; missing values render as incoming. */
      readonly selectedDirection?: TraceGraphSelectedLocalDependencySource['selectedDirection'];
    })
  | (TraceGraphSelectedLocalDependencySource & {
      /** Exact visible local dependency ref used to resolve overlay geometry. */
      readonly dependencyRef: NonNullable<TraceGraphSelectedLocalDependencySource['dependencyRef']>;
    });
const EMPTY_SELECTED_LOCAL_DEPENDENCY_OVERLAY_DATA: readonly TraceDeckSelectedLocalDependencyDatum[] =
  [];
const EMPTY_HOVERED_SPAN_OVERLAY_DATA: readonly TraceRenderSpan[] = [];
const EMPTY_CRITICAL_PATH_BLOCK_SOURCES: readonly TraceGraphPathBlockSource[] = [];
const EMPTY_CRITICAL_PATH_DEPENDENCY_SOURCES: readonly TraceGraphPathDependencySource[] = [];
const EMPTY_TRACE_EVENT_SOURCES: readonly TraceEventSource[] = [];
const EMPTY_TRACE_INSTANT_SOURCES: readonly TraceInstantSource[] = [];
const EMPTY_COUNTER_SPARKLINES: readonly CounterSparkline[] = [];
const EMPTY_TRACE_COUNTER_SOURCES: readonly TraceCounterSource[] = [];
const EMPTY_TRACE_RENDER_BINARY_ATTRIBUTE_DATA: TraceDeckBinaryAttributeData = {
  length: 0,
  attributes: {}
};
const EMPTY_CRITICAL_PATH_HIGHLIGHT_TRAIL: readonly {
  blockSource: TraceGraphPathBlockSource;
  age: number;
}[] = [];
const HIDDEN_EVENT_POSITION = [0, -1e6, 0] as [number, number, number];
const HIDDEN_EVENT_COLOR = [0, 0, 0, 0] as [number, number, number, number];
const EMPTY_COUNTER_SPARKLINE_PATH: [number, number, number][] = [];

/** Eases selected-block color transitions so the outline dwells near endpoint colors. */
function easeSelectedBlockHighlightColor(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

function getHiddenEventPosition(): [number, number, number] {
  return HIDDEN_EVENT_POSITION;
}

function getHiddenEventFillColor(): [number, number, number, number] {
  return HIDDEN_EVENT_COLOR;
}

function getHiddenEventRadius(): number {
  return 0;
}

function getGlobalEventRadius(): number {
  return OVERVIEW_EVENT_MARKER_RADIUS_PX;
}

function getTraceMarkerRadius(): number {
  return 4;
}

function getHiddenCounterSparklinePath(): [number, number, number][] {
  return EMPTY_COUNTER_SPARKLINE_PATH;
}

function getHiddenCounterSparklineColor(): [number, number, number, number] {
  return HIDDEN_EVENT_COLOR;
}

function getHiddenCounterSparklineWidth(): number {
  return 0;
}

function getCounterSparklinePath(item: CounterSparkline): [number, number, number][] {
  return item.path as [number, number, number][];
}

function getCounterSparklineColor(item: CounterSparkline): [number, number, number, number] {
  return [...item.color] as [number, number, number, number];
}

function getCounterSparklineWidth(): number {
  return 2;
}

function makeLayerId(prefix: string | undefined, id: string) {
  return prefix ? `${prefix}-${id}` : id;
}

export function buildDeckBackgroundLayersForTrace({
  processRows,
  traceLayout,
  layerIdPrefix,
  rankBackgroundColor,
  modelMatrix
}: {
  processRows: ReadonlyArray<TraceLayoutRow>;
  traceLayout: Readonly<TraceLayout>;
  layerIdPrefix?: string;
  rankBackgroundColor?: Readonly<[number, number, number, number]>;
  modelMatrix?: Matrix4;
}) {
  return new PolygonLayer<TraceLayoutRow>({
    id: makeLayerId(layerIdPrefix, 'rank-background'),
    visible: Boolean(rankBackgroundColor),
    data: processRows,
    positionFormat: 'XY',
    getPolygon: row => {
      const rankLayout = traceLayout.processLayouts?.[row.rankIndex];
      return rankLayout?.backgroundPolygonInfinite ?? [];
    },
    getFillColor: (rankBackgroundColor ?? HIDDEN_EVENT_COLOR) as [number, number, number, number],
    stroked: false,
    parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'},
    pickable: false,
    modelMatrix
  });
}

/** Builds subtle horizontal row separators from precomputed trace layout geometry. */
export function buildDeckRowSeparatorLayerForTrace({
  traceLayout,
  layerIdPrefix,
  modelMatrix,
  visible = true
}: {
  traceLayout: Readonly<TraceLayout>;
  layerIdPrefix?: string;
  modelMatrix?: Matrix4;
  visible?: boolean;
}) {
  const separatorRows = traceLayout.renderRows;
  const terminalRow = [...separatorRows]
    .reverse()
    .find(row => traceLayout.processLayouts?.[row.rankIndex]);
  const getTraceTimeExtentSeparatorLine = (line: Float32Array | undefined): Float32Array => {
    if (!line || line.length < 4) {
      return EMPTY_ROW_SEPARATOR_LINE;
    }
    const startX = Math.min(
      traceLayout.currentBounds[0]?.[0] ?? 0,
      -ROW_SEPARATOR_HORIZONTAL_EXTENT
    );
    const endX = traceLayout.currentBounds[1]?.[0];
    const startY = line[1];
    const endY = line[3];
    if (
      !Number.isFinite(startX) ||
      !Number.isFinite(endX) ||
      !Number.isFinite(startY) ||
      !Number.isFinite(endY)
    ) {
      return EMPTY_ROW_SEPARATOR_LINE;
    }
    return new Float32Array([startX, startY, endX, endY]);
  };
  const getTerminalSeparatorLine = (
    rankLayout: Readonly<TraceLayout>['processLayouts'][number] | undefined
  ) => {
    if (!rankLayout) {
      return undefined;
    }
    if (rankLayout.terminalSeparatorLineInfinite.length >= 4) {
      return rankLayout.terminalSeparatorLineInfinite;
    }
    const bottomY = rankLayout.yOffset + rankLayout.yHeight;
    return new Float32Array([
      -ROW_SEPARATOR_HORIZONTAL_EXTENT,
      bottomY,
      ROW_SEPARATOR_HORIZONTAL_EXTENT,
      bottomY
    ]);
  };
  const separatorData: RowSeparatorDatum[] = [
    ...separatorRows.map(row => {
      const rankLayout = traceLayout.processLayouts?.[row.rankIndex];
      return {
        row,
        edge: 'top' as const,
        path: getTraceTimeExtentSeparatorLine(rankLayout?.separatorLineInfinite)
      };
    }),
    ...(terminalRow
      ? [
          {
            row: terminalRow,
            edge: 'bottom' as const,
            path: getTraceTimeExtentSeparatorLine(
              getTerminalSeparatorLine(traceLayout.processLayouts?.[terminalRow.rankIndex])
            )
          }
        ]
      : [])
  ];

  return new PathLayer<RowSeparatorDatum, PathStyleExtensionProps<RowSeparatorDatum>>({
    id: makeLayerId(layerIdPrefix, 'rank-row-separators'),
    visible,
    data: separatorData,
    positionFormat: 'XY',
    getPath: datum => datum.path,
    getColor: RANK_ROW_SEPARATOR_COLOR,
    getWidth: RANK_ROW_SEPARATOR_WIDTH_PX,
    widthUnits: 'pixels',
    getDashArray: RANK_ROW_SEPARATOR_DASH_ARRAY,
    dashJustified: true,
    extensions: [new PathStyleExtension({dash: true})],
    pickable: false,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'},
    modelMatrix
  });
}

// Adapter boundary: functions in this file should translate prepared trace/deck scene data into
// deck.gl Layer instances. Avoid adding TraceGraph scans, TraceLayout rebuilds, geometry rebuilds,
// or React-hook-dependent caching here; compute those upstream in OSS trace/layout/scene helpers and
// pass columnar/preprojected data into these layer factories.

/** Returns base trace layers in their draw order. */
function buildBaseTraceLayers(layers: readonly (Layer | null | undefined)[]): Layer[] {
  return layers.filter((layer): layer is Layer => Boolean(layer));
}

/** Returns selection overlay trace layers in their draw order. */
function buildSelectionTraceLayers(layers: readonly (Layer | null | undefined)[]): Layer[] {
  return layers.filter((layer): layer is Layer => Boolean(layer));
}

/** Builds selected local dependency line overlays without updating per-rank layers. */
function buildSelectedLocalDependencyOverlayLayer({
  selectedLocalDependencySourcesByProcessId,
  selectedDependencies,
  traceLayout,
  settings,
  layerIdPrefix,
  modelMatrix
}: {
  /** Selected dependency sources partitioned by process id when available. */
  selectedLocalDependencySourcesByProcessId?: Readonly<
    Partial<Record<string, readonly TraceGraphSelectedLocalDependencySource[]>>
  >;
  /** Flat selected dependency fallback sources. */
  selectedDependencies: readonly TraceLocalDependencySource[];
  /** Prepared trace layout used to resolve selected dependency geometry. */
  traceLayout: Readonly<TraceLayout>;
  /** Trace viewer settings that choose selected dependency routing mode. */
  settings: TraceVisSettings;
  /** Optional id prefix identifying the graph/view that owns this overlay. */
  layerIdPrefix?: string;
  /** Optional transform applied to the trace scene. */
  modelMatrix?: Matrix4;
}): Layer {
  const data = getSelectedLocalDependencyOverlayData({
    selectedLocalDependencySourcesByProcessId,
    selectedDependencies
  });
  const hasSelectedDependencies = data.length > 0;
  const geometryUpdateTriggers = hasSelectedDependencies
    ? [traceLayout]
    : EMPTY_LAYER_UPDATE_TRIGGERS;

  return new DependencyArrowLayer<TraceDeckSelectedLocalDependencyDatum, {rankIndex: number}>({
    id: makeLayerId(layerIdPrefix, 'selected-local-dependency-overlays'),
    visible: hasSelectedDependencies,
    data,
    positionFormat: 'XY',
    getPath: dependency =>
      getTraceLayoutSelectedLocalDependencyGeometry({
        traceLayout,
        dependencyRef: dependency.dependencyRef
      }) ?? [],
    getColor: dependency =>
      getSelectedLocalDependencyLineColor(dependency.waitTimeMs, dependency.selectedDirection),
    getMarkerColor: dependency =>
      getSelectedLocalDependencyLineColor(dependency.waitTimeMs, dependency.selectedDirection),
    getDirection: dependency =>
      dependency.bidirectional ? PathDirection.BOTH : PathDirection.FORWARD,
    getMarkerPlacements: dependency =>
      dependency.bidirectional
        ? BIDIRECTIONAL_DEPENDENCY_MARKER_PLACEMENTS
        : FORWARD_DEPENDENCY_MARKER_PLACEMENTS,
    getMarkerSize: [2, 1],
    getWidth: SELECTED_LOCAL_DEPENDENCY_LINE_WIDTH_PX,
    markerSizeScale: SELECTED_LOCAL_DEPENDENCY_LINE_WIDTH_PX * PATH_DEPENDENCY_MARKER_SIZE,
    widthUnits: 'pixels',
    pickable: false,
    mode: settings.lineRoutingMode === 'curve' ? 'arc' : 'line',
    getArcTilt: 90,
    getArcHeight: 0.3,
    rankIndex: 0,
    parameters: SELECTED_DEPENDENCY_OVERLAY_PARAMETERS,
    modelMatrix,
    updateTriggers: {
      getPath: geometryUpdateTriggers,
      getColor: geometryUpdateTriggers,
      getMarkerColor: geometryUpdateTriggers
    }
  });
}

/** Flattens selected local dependency sources to entries with visible dependency refs. */
function getSelectedLocalDependencyOverlayData({
  selectedLocalDependencySourcesByProcessId,
  selectedDependencies
}: {
  /** Selected dependency sources partitioned by process id when available. */
  selectedLocalDependencySourcesByProcessId?: Readonly<
    Partial<Record<string, readonly TraceGraphSelectedLocalDependencySource[]>>
  >;
  /** Flat selected dependency fallback sources. */
  selectedDependencies: readonly TraceLocalDependencySource[];
}): readonly TraceDeckSelectedLocalDependencyDatum[] {
  if (selectedLocalDependencySourcesByProcessId) {
    const visibleSources: TraceDeckSelectedLocalDependencyDatum[] = [];
    for (const dependencies of Object.values(selectedLocalDependencySourcesByProcessId)) {
      for (const dependency of dependencies ?? []) {
        if (dependency.dependencyRef != null) {
          visibleSources.push(
            dependency as TraceGraphSelectedLocalDependencySource & {
              readonly dependencyRef: NonNullable<
                TraceGraphSelectedLocalDependencySource['dependencyRef']
              >;
            }
          );
        }
      }
    }
    if (visibleSources.length > 0) {
      return visibleSources;
    }
  }
  if (selectedDependencies.length === 0) {
    return EMPTY_SELECTED_LOCAL_DEPENDENCY_OVERLAY_DATA;
  }
  const visibleSources: TraceDeckSelectedLocalDependencyDatum[] = [];
  for (const dependency of selectedDependencies) {
    if (dependency.dependencyRef != null) {
      visibleSources.push(
        dependency as TraceLocalDependencySource & {
          readonly dependencyRef: NonNullable<TraceLocalDependencySource['dependencyRef']>;
        }
      );
    }
  }
  return visibleSources.length > 0 ? visibleSources : EMPTY_SELECTED_LOCAL_DEPENDENCY_OVERLAY_DATA;
}

/** Builds the selected-span animated outline overlay without mutating per-rank base layer props. */
function buildSelectedSpanOverlayLayer({
  selectedSpanRefs,
  traceLayout,
  layerIdPrefix,
  modelMatrix
}: {
  /** Canonical selected span refs for this trace scene. */
  selectedSpanRefs: readonly SpanRef[];
  /** Prepared trace layout used to resolve selected span rectangles. */
  traceLayout: Readonly<TraceLayout>;
  /** Optional id prefix identifying the graph/view that owns this overlay. */
  layerIdPrefix?: string;
  /** Optional transform applied to the trace scene. */
  modelMatrix?: Matrix4;
}): Layer {
  const hasSelectedSpans = selectedSpanRefs.length > 0;
  const geometryUpdateTriggers = hasSelectedSpans ? [traceLayout] : EMPTY_LAYER_UPDATE_TRIGGERS;
  const getSelectedSpanPath = (spanRef: SpanRef): [number, number][] => {
    const bbox = getTraceLayoutSpanGeometryBySpanRef({traceLayout, spanRef});
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
  };

  const outlineLayer = new PathLayer<
    SpanRef,
    PathStyleExtensionProps<SpanRef> & {rankIndex: number}
  >({
    id: makeLayerId(layerIdPrefix, 'selected-block-outlines'),
    visible: hasSelectedSpans,
    data: selectedSpanRefs,
    positionFormat: 'XY',
    getPath: getSelectedSpanPath,
    getColor: SELECTED_BLOCK_HIGHLIGHT_COLOR_IDLE,
    getWidth: SELECTED_BLOCK_HIGHLIGHT_LINE_WIDTH_PX,
    widthUnits: 'pixels',
    widthMinPixels: SELECTED_BLOCK_HIGHLIGHT_LINE_WIDTH_PX,
    getOffset: SELECTED_BLOCK_HIGHLIGHT_OUTER_OFFSET,
    extensions: [new PathStyleExtension({offset: true})],
    opacity: 1,
    pickable: false,
    parameters: SELECTED_BLOCK_HIGHLIGHT_PARAMETERS,
    modelMatrix,
    updateTriggers: {
      getPath: geometryUpdateTriggers
    },
    rankIndex: 0
  });

  return new AnimationLayer({
    id: makeLayerId(layerIdPrefix, 'selected-block-overlays'),
    visible: hasSelectedSpans,
    parameters: SELECTED_BLOCK_HIGHLIGHT_PARAMETERS,
    layer: outlineLayer,
    repeat: Number.POSITIVE_INFINITY,
    repeatType: 'loop',
    frames: {
      type: 'sequence',
      frames: [
        {
          duration: SELECTED_BLOCK_HIGHLIGHT_PULSE_DURATION_MS,
          easing: easeSelectedBlockHighlightColor,
          props: {
            getColor: SELECTED_BLOCK_HIGHLIGHT_COLOR_PULSE
          }
        },
        {
          duration: SELECTED_BLOCK_HIGHLIGHT_PULSE_DURATION_MS,
          easing: easeSelectedBlockHighlightColor,
          props: {
            getColor: SELECTED_BLOCK_HIGHLIGHT_COLOR_IDLE
          }
        }
      ]
    }
  });
}

/** Builds the hovered-span block overlay without changing per-rank base layers. */
function buildHoveredSpanOverlayLayer({
  hoveredSpan,
  traceLayout,
  layerIdPrefix,
  modelMatrix,
  onSpanClick,
  settings
}: {
  /** Hovered span payload and rank index from the current deck picking state. */
  hoveredSpan?: {rankIndex: number; block?: TraceRenderSpan} | null;
  /** Prepared trace layout used to resolve the hovered span rectangle. */
  traceLayout: Readonly<TraceLayout>;
  /** Optional id prefix identifying the graph/view that owns this overlay. */
  layerIdPrefix?: string;
  /** Optional transform applied to the trace scene. */
  modelMatrix?: Matrix4;
  /** Click handler shared with base block layers. */
  onSpanClick: (info: PickingInfo, event?: {srcEvent?: {shiftKey?: boolean}}) => boolean | void;
  /** Trace settings used to match base span rendering. */
  settings: TraceVisSettings;
}): Layer {
  const hoveredBlock = hoveredSpan?.block;
  const data = hoveredBlock ? [hoveredBlock] : EMPTY_HOVERED_SPAN_OVERLAY_DATA;
  const hasHoveredSpan = data.length > 0;
  const geometryUpdateTriggers = hasHoveredSpan ? [traceLayout] : EMPTY_LAYER_UPDATE_TRIGGERS;

  return new BlockLayer<TraceRenderSpan, {rankIndex: number}>({
    id: makeLayerId(layerIdPrefix, 'hovered-block-overlay'),
    visible: hasHoveredSpan,
    data,
    positionFormat: 'XY',
    getPosition: span => {
      const bbox = getTraceLayoutSpanGeometryBySpanRef({
        traceLayout,
        spanRef: span.spanRef
      });
      return bbox ? [bbox[0], bbox[1]] : [0, 0];
    },
    getSize: span => {
      const bbox = getTraceLayoutSpanGeometryBySpanRef({
        traceLayout,
        spanRef: span.spanRef
      });
      return bbox ? [Math.max(0, bbox[2] - bbox[0]), Math.max(0, bbox[3] - bbox[1])] : [0, 0];
    },
    getFillColor: TRACE_COLOR.SPAN_FINISHED_FILL,
    getLineColor: TRACE_COLOR.SPAN_FINISHED_LINE,
    getLineWidth: HOVERED_BLOCK_HIGHLIGHT_LINE_WIDTH_PX,
    lineWidthUnits: 'pixels',
    widthMinPixels: settings.minSpanWidthPixels ?? DEFAULT_SPAN_WIDTH_MIN_PIXELS,
    heightMinPixels: 0,
    pickable: true,
    autoHighlight: true,
    highlightColor: TRACE_COLOR.SPAN_HIGHLIGHT as [number, number, number, number],
    parameters: {
      blend: false,
      depthWriteEnabled: false,
      depthCompare: 'always'
    },
    onClick: onSpanClick,
    modelMatrix,
    updateTriggers: {
      getPosition: geometryUpdateTriggers,
      getSize: geometryUpdateTriggers,
      getFillColor: EMPTY_LAYER_UPDATE_TRIGGERS,
      getLineColor: EMPTY_LAYER_UPDATE_TRIGGERS
    },
    rankIndex: hoveredSpan?.rankIndex ?? 0
  });
}

export function buildDeckLayersForTrace({
  scene,
  stepNum,
  selection,
  settings,
  handlers,
  colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
  fontFamily = DEFAULT_TRACE_FONT_FAMILY,
  showRowSeparators = !scene.layerIdPrefix?.startsWith('minimap'),
  collapsedActivityDirection = 'down',
  layerGroup = 'all'
}: BuildDeckLayersForTraceParams): Layer[] {
  const {
    layout: traceLayout,
    rows: processRows,
    visibleCrossDependencies,
    layerIdPrefix,
    rankBackgroundColor,
    modelMatrix
  } = scene;
  const {
    hoveredSpan,
    selectedSpanRefs = EMPTY_SELECTED_SPAN_REFS,
    selectedCrossDependencies = EMPTY_SELECTED_CROSS_DEPENDENCIES,
    selectedDependencies = EMPTY_SELECTED_LOCAL_DEPENDENCIES,
    selectedCrossDependencySources,
    selectedLocalDependencySourcesByProcessId,
    highlightedSpanRefs
  } = selection ?? {};
  const {onSpanClick, onToggleProcess} = handlers;
  const shouldBuildBaseLayers = layerGroup !== 'selection';
  const shouldBuildSelectionLayers = layerGroup !== 'base';
  const buildStartTime = performance.now();
  traceLog.probe(0, 'deck-trace-layers buildDeckLayersForTrace start', {
    layerIdPrefix: layerIdPrefix ?? '',
    processRowCount: processRows.length,
    totalSpanCount: processRows.reduce((sum, row) => sum + row.spans.length, 0),
    totalLocalDependencyCount: processRows.reduce((sum, row) => sum + row.dependencies.length, 0),
    crossDependencyCount: visibleCrossDependencies.length,
    selectedSpanCount: selectedSpanRefs.length,
    selectedLocalDependencyCount: selectedDependencies.length,
    selectedCrossDependencyCount: selectedCrossDependencies.length
  })();
  const stableSelectedSpanRefs =
    selectedSpanRefs.length > 0 ? selectedSpanRefs : EMPTY_SELECTED_SPAN_REFS;
  const stableSelectedDependencies =
    selectedDependencies.length > 0 ? selectedDependencies : EMPTY_SELECTED_LOCAL_DEPENDENCIES;
  const stableSelectedCrossDependencies =
    selectedCrossDependencies.length > 0
      ? selectedCrossDependencies
      : EMPTY_SELECTED_CROSS_DEPENDENCIES;
  const rankLayers = shouldBuildBaseLayers
    ? processRows.map(
        ({
          row,
          spans,
          dependencies,
          binaryBlockData,
          binaryDependencyLineData,
          collapsedActivityIntervals,
          overflowLabels
        }) => {
          const {threads, rankIndex, processId, rankNum, isCollapsed} = row;
          const rankLayout = traceLayout.processLayouts?.[rankIndex];
          const effectiveIsCollapsed = rankLayout ? rankLayout.isCollapsed === true : isCollapsed;
          const layerThreads = getTraceLayerThreadsForRow({processId, settings, threads});
          return new TraceProcessLayer({
            id: makeLayerId(layerIdPrefix, `rank-${processId}`),
            threads: layerThreads,
            spans,
            dependencies,
            binaryBlockData,
            binaryDependencyLineData,
            selectedSpanRefs: EMPTY_SELECTED_SPAN_REFS,
            selectedDependencies: EMPTY_SELECTED_LOCAL_DEPENDENCIES,
            rankIndex,
            processId,
            processName: row.name,
            rankNum,
            rankProcessRef: row.processRef,
            stepNum,
            onSpanClick,
            hoveredSpan: undefined,
            modelMatrix,
            settings,
            traceLayout,
            colorScheme,
            fontFamily,
            highlightedSpanRefs,
            rankBackgroundColor,
            isCollapsed: effectiveIsCollapsed,
            spanLabelPlacement: 'start',
            updateTrigger: settings.trackAggregationMode === 'combine-threads' ? 1 : 0,
            collapsedActivityDirection,
            collapsedActivityIntervals,
            overflowLabels,
            onToggleProcess
          });
        }
      )
    : [];

  const selectedCrossDependencyOverlaySources =
    selectedCrossDependencySources ?? stableSelectedCrossDependencies;
  const crossLayer = shouldBuildBaseLayers
    ? new TraceCrossDependencyLayer({
        id: makeLayerId(layerIdPrefix, 'cross-rank-dependencies'),
        visible: settings.showCrossProcessDependencies,
        // traceGraph,
        colorScheme,
        crossDependencies: visibleCrossDependencies,
        selectedCrossDependencies: EMPTY_SELECTED_CROSS_DEPENDENCIES,
        settings,
        traceLayout,
        modelMatrix
      })
    : null;
  const selectedCrossLayer = shouldBuildSelectionLayers
    ? new TraceCrossDependencyLayer({
        id: makeLayerId(layerIdPrefix, 'cross-rank-dependency-selection'),
        colorScheme,
        crossDependencies: EMPTY_SELECTED_CROSS_DEPENDENCIES,
        selectedCrossDependencies: selectedCrossDependencyOverlaySources,
        settings,
        traceLayout,
        modelMatrix
      })
    : null;
  const selectedSpanOverlayLayer = shouldBuildSelectionLayers
    ? buildSelectedSpanOverlayLayer({
        selectedSpanRefs: stableSelectedSpanRefs,
        traceLayout,
        layerIdPrefix,
        modelMatrix
      })
    : null;
  const hoveredSpanOverlayLayer = shouldBuildSelectionLayers
    ? buildHoveredSpanOverlayLayer({
        hoveredSpan,
        traceLayout,
        layerIdPrefix,
        modelMatrix,
        onSpanClick,
        settings
      })
    : null;
  const selectedLocalDependencyOverlayLayer = shouldBuildSelectionLayers
    ? buildSelectedLocalDependencyOverlayLayer({
        selectedLocalDependencySourcesByProcessId,
        selectedDependencies: stableSelectedDependencies,
        traceLayout,
        settings,
        layerIdPrefix,
        modelMatrix
      })
    : null;
  const rowSeparatorLayer = shouldBuildBaseLayers
    ? buildDeckRowSeparatorLayerForTrace({
        traceLayout,
        layerIdPrefix,
        modelMatrix,
        visible: showRowSeparators
      })
    : null;

  logDeckLayerConstructionProbe({
    buildStartTime,
    crossDependencyCount: visibleCrossDependencies.length,
    layerIdPrefix,
    processRowCount: processRows.length,
    rankLayerCount: rankLayers.length,
    selectedCrossDependencyCount: selectedCrossDependencyOverlaySources.length,
    selectedLocalDependencyProcessCount: selectedLocalDependencySourcesByProcessId
      ? Object.keys(selectedLocalDependencySourcesByProcessId).length
      : 0,
    selectedSpanCount: stableSelectedSpanRefs.length,
    totalLocalDependencyCount: processRows.reduce((sum, row) => sum + row.dependencies.length, 0),
    totalSpanCount: processRows.reduce((sum, row) => sum + row.spans.length, 0)
  });

  const baseTraceLayers = buildBaseTraceLayers([crossLayer, ...rankLayers, rowSeparatorLayer]);
  const selectionTraceLayers = buildSelectionTraceLayers([
    hoveredSpanOverlayLayer,
    selectedSpanOverlayLayer,
    selectedLocalDependencyOverlayLayer,
    selectedCrossLayer
  ]);

  return [...baseTraceLayers, ...selectionTraceLayers];
}

/**
 * Builds the lightweight minimap/process-summary activity layer from precomputed binary data.
 */
export function buildDeckLayerForTraceProcessActivitySummary({
  data,
  layerIdPrefix,
  modelMatrix,
  onProcessClick
}: {
  /** Binary process activity rectangles projected by TraceViewState. */
  data: TraceDeckBinaryProcessActivityData | undefined;
  /** Optional deck layer id prefix for compare/minimap variants. */
  layerIdPrefix?: string;
  /** Optional model matrix that positions this graph relative to the primary graph. */
  modelMatrix?: Matrix4;
  /** Callback fired when one process activity summary interval is clicked. */
  onProcessClick?: (row: TraceLayoutRow) => void;
}): Layer[] {
  const summaryData = data?.data ?? EMPTY_TRACE_RENDER_BINARY_ATTRIBUTE_DATA;
  const hasSummaryData = summaryData.length > 0;

  return [
    new BlockLayer({
      id: makeLayerId(layerIdPrefix, 'process-activity-summary'),
      visible: hasSummaryData,
      data: summaryData as never,
      modelMatrix,
      positionFormat: 'XY',
      getPosition: () => [0, 0, 0],
      getSize: [0, 0],
      getFillColor: TRACE_COLOR.SPAN_FINISHED_FILL,
      getLineColor: [0, 0, 0, 0],
      getLineWidth: 0,
      heightMinPixels: 1,
      widthMinPixels: 0.75,
      pickable: true,
      onClick: onProcessClick
        ? ({index}: PickingInfo) => {
            const processRowIndex =
              typeof index === 'number' ? data?.processRowIndices[index] : undefined;
            const processRow =
              typeof processRowIndex === 'number' ? data?.processRows[processRowIndex] : undefined;
            if (!processRow) {
              return false;
            }
            onProcessClick(processRow);
            return true;
          }
        : undefined,
      parameters: {
        blend: true,
        depthWriteEnabled: false,
        depthCompare: 'always'
      }
    })
  ];
}

/**
 * Emits one compact probe for foreground TraceGraph deck-layer construction.
 */
function logDeckLayerConstructionProbe(params: {
  /** Timestamp captured before layer construction starts. */
  buildStartTime: number;
  /** Number of visible cross-process dependencies passed to the cross-dependency layer. */
  crossDependencyCount: number;
  /** Optional id prefix identifying the graph/view that owns these layers. */
  layerIdPrefix: string | undefined;
  /** Number of rendered process rows passed to rank layers. */
  processRowCount: number;
  /** Number of TraceProcessLayer instances constructed. */
  rankLayerCount: number;
  /** Number of selected cross-process dependencies passed to the selection layer. */
  selectedCrossDependencyCount: number;
  /** Number of process rows with selected local dependency overlays. */
  selectedLocalDependencyProcessCount: number;
  /** Number of selected span refs passed to row layers. */
  selectedSpanCount: number;
  /** Number of visible local dependencies passed to row layers. */
  totalLocalDependencyCount: number;
  /** Number of visible spans passed to row layers. */
  totalSpanCount: number;
}): void {
  traceLog.probe(0, 'deck-trace-layers buildDeckLayersForTrace done', {
    layerIdPrefix: params.layerIdPrefix ?? '',
    processRowCount: params.processRowCount,
    rankLayerCount: params.rankLayerCount,
    totalSpanCount: params.totalSpanCount,
    totalLocalDependencyCount: params.totalLocalDependencyCount,
    crossDependencyCount: params.crossDependencyCount,
    selectedSpanCount: params.selectedSpanCount,
    selectedCrossDependencyCount: params.selectedCrossDependencyCount,
    selectedLocalDependencyProcessCount: params.selectedLocalDependencyProcessCount,
    durationMs: performance.now() - params.buildStartTime
  })();
}

export function buildDeckLayerForCriticalPath({
  pathBlockSources,
  pathDependencySources,
  pathHighlightTrail,
  pathHighlightSpanRefs,
  pathHighlightTrailLength,
  onSpanClick,
  traceLayout,
  settings,
  colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
  highlightedSpanRefs,
  layerIdPrefix,
  modelMatrix
}: {
  pathBlockSources: readonly TraceGraphPathBlockSource[];
  pathDependencySources: readonly TraceGraphPathDependencySource[];
  pathHighlightSpanRefs?: ReadonlySet<SpanRef>;
  pathHighlightTrail?: {blockSource: TraceGraphPathBlockSource; age: number}[];
  pathHighlightTrailLength: number;
  onSpanClick: (info: PickingInfo) => boolean | void;

  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  colorScheme?: TraceColorScheme;
  highlightedSpanRefs?: ReadonlySet<SpanRef>;
  layerIdPrefix?: string;
  modelMatrix?: Matrix4;
}): Layer {
  return new TracePathLayer({
    id: makeLayerId(layerIdPrefix, 'critical-path'),
    visible:
      pathBlockSources.length > 0 ||
      pathDependencySources.length > 0 ||
      Boolean(pathHighlightTrail?.length),
    blockSources:
      pathBlockSources.length > 0 ? pathBlockSources : EMPTY_CRITICAL_PATH_BLOCK_SOURCES,
    dependencySources:
      pathDependencySources.length > 0
        ? pathDependencySources
        : EMPTY_CRITICAL_PATH_DEPENDENCY_SOURCES,
    settings,
    colorScheme,
    onSpanClick,
    modelMatrix,
    rankIndex: -1,
    traceLayout,
    highlightedSpanRefs,
    highlightedPathSpanRefs: pathHighlightSpanRefs,
    pathHighlightTrail:
      pathHighlightTrail && pathHighlightTrail.length > 0
        ? pathHighlightTrail
        : EMPTY_CRITICAL_PATH_HIGHLIGHT_TRAIL,
    pathHighlightTrailLength
  });
}

export function buildDeckLayersForInstantsAndCounter({
  traceGraph,
  traceLayout,
  settings,
  colorScheme = DEFAULT_TRACE_COLOR_SCHEME,
  layerIdPrefix,
  modelMatrix,
  globalEventYPosition
}: {
  traceGraph: Readonly<TraceGraph>;
  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  colorScheme?: TraceColorScheme;
  layerIdPrefix?: string;
  modelMatrix?: Matrix4;
  /** Optional fixed trace-space Y position for graph-global event markers. */
  globalEventYPosition?: number;
}): Layer[] {
  const derivedData = getMemoizedDerivedTraceData({
    traceGraph,
    traceLayout,
    settings,
    colorScheme,
    buildGlobalEvents: settings.showGlobalEvents,
    buildInstants: settings.showInstants,
    buildCounters: settings.showCounters,
    globalEventYPosition
  });
  const layers: Layer[] = [];

  const {
    positionMap: eventPositionMap,
    colorMap: eventColorMap,
    visibleEvents
  } = derivedData.globalEvents;
  const eventData =
    settings.showGlobalEvents && visibleEvents.length > 0
      ? visibleEvents
      : EMPTY_TRACE_EVENT_SOURCES;
  const hasEventData = eventData.length > 0;
  const eventUpdateTriggers = hasEventData
    ? [eventPositionMap, eventColorMap]
    : EMPTY_LAYER_UPDATE_TRIGGERS;
  layers.push(
    new ScatterplotLayer<TraceEventSource>({
      id: makeLayerId(layerIdPrefix, 'trace-global-events'),
      data: eventData,
      visible: Boolean(settings.showGlobalEvents && hasEventData),
      positionFormat: 'XY',
      getPosition: hasEventData
        ? event => eventPositionMap.get(event.eventRef) ?? HIDDEN_EVENT_POSITION
        : getHiddenEventPosition,
      getFillColor: hasEventData
        ? event => {
            const color = eventColorMap.get(event.eventRef) ?? DEFAULT_COUNTER_COLOR;
            return [...color] as [number, number, number, number];
          }
        : getHiddenEventFillColor,
      getRadius: hasEventData ? getGlobalEventRadius : getHiddenEventRadius,
      radiusUnits: 'pixels',
      radiusMinPixels: 3,
      pickable: hasEventData,
      modelMatrix,
      parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'},
      updateTriggers: {
        getPosition: eventUpdateTriggers,
        getFillColor: eventUpdateTriggers,
        getRadius: hasEventData ? [OVERVIEW_EVENT_MARKER_RADIUS_PX] : EMPTY_LAYER_UPDATE_TRIGGERS
      }
    })
  );

  // instant layers
  const {
    positionMap: instantPositionMap,
    colorMap: instantColorMap,
    visibleInstants
  } = derivedData.instants;
  const instantData =
    settings.showInstants && visibleInstants.length > 0
      ? visibleInstants
      : EMPTY_TRACE_INSTANT_SOURCES;
  const hasInstantData = instantData.length > 0;
  const instantUpdateTriggers = hasInstantData
    ? [instantPositionMap, instantColorMap]
    : EMPTY_LAYER_UPDATE_TRIGGERS;

  layers.push(
    new ScatterplotLayer<TraceInstantSource>({
      id: makeLayerId(layerIdPrefix, 'trace-instants'),
      data: instantData,
      visible: Boolean(settings.showInstants && hasInstantData),
      positionFormat: 'XY',
      getPosition: hasInstantData
        ? instant => instantPositionMap.get(instant.instantRef) ?? HIDDEN_EVENT_POSITION
        : getHiddenEventPosition,
      getFillColor: hasInstantData
        ? instant => {
            const color = instantColorMap.get(instant.instantRef) ?? DEFAULT_INSTANT_COLOR;
            return [...color] as [number, number, number, number];
          }
        : getHiddenEventFillColor,
      getRadius: hasInstantData ? getTraceMarkerRadius : getHiddenEventRadius,
      radiusUnits: 'pixels',
      radiusMinPixels: 3,
      pickable: hasInstantData,
      modelMatrix,
      parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'},
      updateTriggers: {
        getPosition: instantUpdateTriggers,
        getFillColor: instantUpdateTriggers,
        getRadius: hasInstantData ? [4] : EMPTY_LAYER_UPDATE_TRIGGERS
      }
    })
  );

  // counter layers
  const {
    colorMap: counterColorMap,
    counterPoints,
    positionMap: counterPositionMap,
    sparklineData
  } = derivedData.counters;
  const sparklineLayerData =
    settings.showCounters && sparklineData.length > 0 ? sparklineData : EMPTY_COUNTER_SPARKLINES;
  const counterPointLayerData =
    settings.showCounters && counterPoints.length > 0 ? counterPoints : EMPTY_TRACE_COUNTER_SOURCES;
  const hasSparklineData = sparklineLayerData.length > 0;
  const hasCounterPointData = counterPointLayerData.length > 0;
  const sparklineUpdateTriggers = hasSparklineData
    ? [sparklineLayerData]
    : EMPTY_LAYER_UPDATE_TRIGGERS;
  const counterPointUpdateTriggers = hasCounterPointData
    ? [counterPositionMap, counterColorMap]
    : EMPTY_LAYER_UPDATE_TRIGGERS;
  layers.push(
    new PathLayer<CounterSparkline>({
      id: makeLayerId(layerIdPrefix, 'trace-counter-sparklines'),
      data: sparklineLayerData,
      visible: Boolean(settings.showCounters && hasSparklineData),
      positionFormat: 'XY',
      getPath: hasSparklineData ? getCounterSparklinePath : getHiddenCounterSparklinePath,
      getColor: hasSparklineData ? getCounterSparklineColor : getHiddenCounterSparklineColor,
      widthUnits: 'pixels',
      getWidth: hasSparklineData ? getCounterSparklineWidth : getHiddenCounterSparklineWidth,
      pickable: false,
      modelMatrix,
      parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'},
      updateTriggers: {
        getPath: sparklineUpdateTriggers,
        getColor: sparklineUpdateTriggers,
        getWidth: EMPTY_LAYER_UPDATE_TRIGGERS
      }
    }),

    new ScatterplotLayer<TraceCounterSource>({
      id: makeLayerId(layerIdPrefix, 'trace-counter-points'),
      data: counterPointLayerData,
      visible: Boolean(settings.showCounters && hasCounterPointData),
      positionFormat: 'XY',
      getPosition: hasCounterPointData
        ? counter => counterPositionMap.get(counter.counterRef) ?? HIDDEN_EVENT_POSITION
        : getHiddenEventPosition,
      getFillColor: hasCounterPointData
        ? counter => {
            const color = counterColorMap.get(counter.counterRef) ?? DEFAULT_COUNTER_COLOR;
            return [...color] as [number, number, number, number];
          }
        : getHiddenEventFillColor,
      getRadius: hasCounterPointData ? getTraceMarkerRadius : getHiddenEventRadius,
      radiusUnits: 'pixels',
      radiusMinPixels: 3,
      pickable: hasCounterPointData,
      modelMatrix,
      parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'},
      updateTriggers: {
        getPosition: counterPointUpdateTriggers,
        getFillColor: counterPointUpdateTriggers,
        getRadius: hasCounterPointData ? [4] : EMPTY_LAYER_UPDATE_TRIGGERS
      }
    })
  );
  return layers;
}

export function buildDeckLayersForLegend({
  processRows,
  processInfoMap,
  processNamePrefixMap,
  graphName,
  onProcessInfoClick,
  onToggleRank,
  onToggleStream,
  traceLayout,
  settings,
  colorScheme,
  fontFamily = DEFAULT_TRACE_FONT_FAMILY,
  layerIdPrefix,
  modelMatrix
}: {
  processRows: ReadonlyArray<TraceLayoutRow>;
  /** Extra per-process information keyed by trace process id. */
  processInfoMap: Record<string, TraceProcessInfo>;
  processNamePrefixMap?: Readonly<Record<string, string>>;
  graphName?: string;
  /** Callback fired when a process-info node label is clicked. */
  onProcessInfoClick?: (processId: string, processInfo?: TraceProcessInfo) => void;
  /** Callback fired when a process legend label should toggle expansion. */
  onToggleRank?: (
    processId: string,
    processInfo?: TraceProcessInfo,
    processRef?: TraceLayoutRow['processRef']
  ) => void;
  /** Callback fired when a thread legend label should toggle lane collapse. */
  onToggleStream?: (threadId: TraceThreadId, stream: TraceThread, threadRef?: ThreadRef) => void;
  traceLayout: Readonly<TraceLayout>;
  settings: TraceVisSettings;
  colorScheme?: TraceColorScheme;
  /** CSS font stack used by legend text labels. */
  fontFamily?: string;
  layerIdPrefix?: string;
  modelMatrix?: Matrix4;
}): Layer[] {
  void colorScheme;
  const legendOverflowLabels = getLegendOverflowLabels({processRows, traceLayout});
  const legendLayers = processRows.flatMap(
    ({processId, threads, threadRefs, rankIndex, isCollapsed}) => {
      const rankLayout = traceLayout.processLayouts?.[rankIndex];
      const effectiveIsCollapsed = rankLayout ? rankLayout.isCollapsed === true : isCollapsed;
      const legendThreads = getTraceLayerThreadsForRow({processId, settings, threads});
      return new TraceLegendLayer({
        id: makeLayerId(layerIdPrefix, `legend-${processId}`),
        threads: legendThreads,
        traceLayout,
        settings,
        rankLabel: (() => {
          const rankSuffix = processNamePrefixMap?.[processId] ?? graphName;
          const row = processRows[rankIndex];
          const rankLabel = row?.name?.trim() ? row.name : processId;
          const caret = effectiveIsCollapsed ? '▸' : '▾';
          const labelText = rankSuffix ? `${rankLabel} - ${rankSuffix}` : rankLabel;
          return `${labelText} ${caret}`;
        })(),
        nodeNameLabel: String(processInfoMap?.[processId]?.node_name ?? ''),
        // modelMatrix: new Matrix4().translate([0, (maxRank - rankIndex) * rankSpacing, 0]),
        rankIndex,
        threadRefs: settings.trackAggregationMode === 'combine-threads' ? undefined : threadRefs,
        onToggleStream: onToggleStream,
        modelMatrix,
        isCollapsed: effectiveIsCollapsed,
        fontFamily
      });
    }
  );

  const hasNodeNameLabels = processRows.some(({processId}) =>
    Boolean(processInfoMap[processId]?.node_name)
  );
  const nodeNameLabels = new TextLayer<TraceLayoutRow>({
    id: makeLayerId(layerIdPrefix, `legend-rank-node-name`),
    visible: hasNodeNameLabels,
    data: processRows,
    getPosition: row => {
      const rankLayout = traceLayout.processLayouts?.[row.rankIndex];
      const labelY = getRankLabelRenderY(rankLayout);
      return rankLayout?.startPosition
        ? [rankLayout.startPosition[0], labelY, rankLayout.startPosition[2] ?? 0]
        : [0, labelY, 0];
    },
    getText: ({processId}) => {
      return String(processInfoMap?.[processId]?.node_name ?? '');
    },
    getTextAnchor: 'end',
    getAlignmentBaseline: 'center',
    getColor: [255, 255, 255, 255],
    getSize: 8,
    sizeUnits: 'pixels',
    sizeMaxPixels: 10,
    wordBreak: 'break-word',
    maxWidth: 350,
    fontFamily,
    fontWeight: 400,
    pickable: true,
    modelMatrix,
    getPixelOffset: [-NODENAME_BACKGROUND_PADDING[0], 2],
    updateTriggers: {
      getPosition: [traceLayout]
    },

    onClick: ({object}) => {
      const {processId} = object as TraceLayoutRow;
      if (processId) {
        onProcessInfoClick?.(processId, processInfoMap?.[processId]);
        return true;
      }
      return false;
    },

    // Badge styling
    background: true,
    getBackgroundColor: NODENAME_BACKGROUND_COLOR, // Solid green background
    backgroundPadding: NODENAME_BACKGROUND_PADDING, // Horizontal and vertical padding
    backgroundBorderRadius: 6,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
  });

  const rankLabels = new TextLayer<TraceLayoutRow>({
    id: makeLayerId(layerIdPrefix, `legend-rank-label`),
    data: processRows,
    getPosition: row => {
      const rankLayout = traceLayout.processLayouts?.[row.rankIndex];
      const labelY = getRankLabelRenderY(rankLayout);
      return rankLayout?.startPosition
        ? [rankLayout.startPosition[0], labelY, rankLayout.startPosition[2] ?? 0]
        : [0, labelY, 0];
    },
    getText: ({name, processId, isCollapsed, rankIndex}) => {
      const rankLayout = traceLayout.processLayouts?.[rankIndex];
      const effectiveIsCollapsed = rankLayout ? rankLayout.isCollapsed === true : isCollapsed;
      const rankSuffix = processNamePrefixMap?.[processId] ?? graphName;
      const rankLabel = name?.trim() ? name : processId;
      const caret = effectiveIsCollapsed ? '▸' : '▾';
      const labelText = rankSuffix ? `${rankLabel} - ${rankSuffix}` : rankLabel;
      return `${labelText} ${caret}`;
    },
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getColor: TRACE_COLOR.THREAD_TEXT,
    getPixelOffset: hasNodeNameLabels
      ? [RANK_LABEL_BACKGROUND_PADDING[0], 3]
      : [RANK_LABEL_LEFT_EDGE_OFFSET_PX, 3],
    getSize: RANK_LABEL_SIZE / 8, // Starts shrinking at zoom <= 3
    sizeUnits: 'common',
    sizeMinPixels: RANK_LABEL_SIZE / 2,
    sizeMaxPixels: RANK_LABEL_SIZE,
    characterSet: TEXT_LAYER_CHARACTER_SET,
    fontFamily,
    fontWeight: 500,
    wordBreak: 'break-word',
    background: true,
    getBackgroundColor: RANK_LABEL_BACKGROUND_COLOR,
    backgroundPadding: RANK_LABEL_BACKGROUND_PADDING,
    pickable: true,
    updateTriggers: {
      getPosition: [traceLayout],
      getText: [processRows, traceLayout],
      getClipRect: [processRows]
    },
    modelMatrix,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'},
    onClick: info => {
      if (!info.object) return;
      const {processId, processRef} = info.object as TraceLayoutRow;
      if (!processId) {
        return false;
      }
      const processInfo = processInfoMap?.[processId];
      onToggleRank?.(processId, processInfo, processRef);
      return true;
    }
  });

  const globalEventRow = traceLayout.globalEventRow;
  const globalEventLabelLayer = new TextLayer<{label: string}>({
    id: makeLayerId(layerIdPrefix, 'legend-global-event-label'),
    visible: Boolean(settings.showGlobalEvents && globalEventRow),
    data: [{label: GLOBAL_EVENT_LABEL}],
    getPosition: () => [0, globalEventRow?.yPosition ?? 0, 0],
    getText: datum => datum.label,
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getColor: TRACE_COLOR.THREAD_TEXT,
    getPixelOffset: hasNodeNameLabels
      ? [RANK_LABEL_BACKGROUND_PADDING[0], 0]
      : [RANK_LABEL_LEFT_EDGE_OFFSET_PX, 0],
    getSize: RANK_LABEL_SIZE / 8,
    sizeUnits: 'common',
    sizeMinPixels: RANK_LABEL_SIZE / 2,
    sizeMaxPixels: RANK_LABEL_SIZE,
    characterSet: TEXT_LAYER_CHARACTER_SET,
    fontFamily,
    fontWeight: 500,
    wordBreak: 'break-word',
    background: true,
    getBackgroundColor: RANK_LABEL_BACKGROUND_COLOR,
    backgroundPadding: RANK_LABEL_BACKGROUND_PADDING,
    pickable: false,
    modelMatrix,
    parameters: {depthWriteEnabled: false, depthCompare: 'always'},
    updateTriggers: {
      getPosition: [globalEventRow]
    }
  });

  const legendOverflowLabelLayer = new TextLayer<TraceLayoutOverflowLabelDatum>({
    id: makeLayerId(layerIdPrefix, 'legend-overflow-label'),
    visible: legendOverflowLabels.length > 0,
    data: legendOverflowLabels,
    getPosition: datum => [datum.x, datum.y, 0],
    getText: datum => datum.text,
    getTextAnchor: 'start',
    getAlignmentBaseline: 'center',
    getColor: TRACE_COLOR.THREAD_TEXT,
    getPixelOffset: [RANK_LABEL_BACKGROUND_PADDING[0], 0],
    getSize: 10,
    sizeUnits: 'pixels',
    sizeMaxPixels: 14,
    fontFamily,
    fontWeight: 500,
    wordBreak: 'break-word',
    maxWidth: 400,
    pickable: false,
    modelMatrix,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'},
    updateTriggers: {
      getPosition: [legendOverflowLabels],
      getText: [legendOverflowLabels]
    }
  });

  return [
    ...legendLayers,
    nodeNameLabels,
    rankLabels,
    globalEventLabelLayer,
    legendOverflowLabelLayer
  ];
}

/** Returns the rendered process-label Y anchor inside the process band. */
function getRankLabelRenderY(
  rankLayout: Readonly<TraceLayout>['processLayouts'][number] | undefined
) {
  return rankLayout?.labelY ?? 0;
}

/**
 * Returns filtered-only overflow labels that should render in the legend instead of the timeline.
 */
function getLegendOverflowLabels(params: {
  /** Stable rendered rows used to derive per-rank legend notice placement. */
  processRows: ReadonlyArray<TraceLayoutRow>;
  /** Layout that provides thread visibility and filtered-span counts. */
  traceLayout: Readonly<TraceLayout>;
}): readonly TraceLayoutOverflowLabelDatum[] {
  const laneSeparation = params.traceLayout.layoutConfiguration?.laneSeparation ?? 0.7;
  const filteredSpanCountByThreadRef = getTraceLayoutFilteredSpanCountByThreadRef({
    traceLayout: params.traceLayout
  });
  const filteredSpanCountByThreadId = getTraceLayoutFilteredSpanCountByThreadId({
    traceLayout: params.traceLayout
  });

  return params.processRows.flatMap(row => {
    const rankLayout = params.traceLayout.processLayouts?.[row.rankIndex];
    if (!rankLayout) {
      return [];
    }

    const effectiveIsCollapsed = Boolean(rankLayout.isCollapsed || row.isCollapsed);
    const filteredSpanCount =
      filteredSpanCountByThreadRef != null && (row.threadRefs?.length ?? 0) > 0
        ? (row.threadRefs ?? []).reduce(
            (count, threadRef) => count + (filteredSpanCountByThreadRef.get(threadRef) ?? 0),
            0
          )
        : filteredSpanCountByThreadId != null
          ? row.threads.reduce(
              (count, thread) => count + (filteredSpanCountByThreadId[thread.threadId] ?? 0),
              0
            )
          : 0;

    if (effectiveIsCollapsed) {
      if (filteredSpanCount === 0) {
        return [];
      }
      const collapsedActivityY = Number.isFinite(rankLayout.collapsedActivityY)
        ? rankLayout.collapsedActivityY
        : rankLayout.yOffset;
      return [
        {
          text: `${filteredSpanCount} span${filteredSpanCount === 1 ? '' : 's'} filtered`,
          x: 0,
          y: collapsedActivityY + laneSeparation,
          maxX: 0,
          view: 'legend'
        } satisfies TraceLayoutOverflowLabelDatum
      ];
    }

    const threadFilteredLabels = rankLayout.threadLayouts.flatMap(threadLayout => {
      const overflowLabel = threadLayout.visible ? threadLayout.overflowLabel : undefined;
      if (!overflowLabel || (threadLayout.overflowSpanCount ?? 0) > 0) {
        return [];
      }
      return [
        {
          text: overflowLabel.text,
          x: 0,
          y: overflowLabel.y,
          maxX: 0,
          view: 'legend'
        } satisfies TraceLayoutOverflowLabelDatum
      ];
    });
    if (threadFilteredLabels.length > 0 || filteredSpanCount === 0) {
      return threadFilteredLabels;
    }

    return [
      {
        text: `All ${filteredSpanCount} span${filteredSpanCount === 1 ? '' : 's'} filtered out in thread ${getTraceLayoutOverflowLabelThreadName(row.threads)}`,
        x: 0,
        y: rankLayout.startPosition[1] + laneSeparation,
        maxX: 0,
        view: 'legend'
      } satisfies TraceLayoutOverflowLabelDatum
    ];
  });
}

/** Returns row threads that deck.gl layers need without forwarding every logical thread in combined rows. */
function getTraceLayerThreadsForRow(params: {
  /** Process id used to own a synthetic combined-thread label. */
  processId: string;
  /** Current trace settings. */
  settings: TraceVisSettings;
  /** Source row threads. */
  threads: readonly TraceThread[];
}): readonly TraceThread[] {
  if (params.settings.trackAggregationMode !== 'combine-threads') {
    return params.threads;
  }

  /*
   * Combine-threads renders one visual row per process. Forwarding tens of thousands of logical
   * source threads into every foreground and legend layer makes layer diffing and bounds work scale
   * with logical thread count even though the deck layers only need the single combined row.
   */
  return [
    {
      type: 'trace-thread',
      name: COMBINED_THREAD_LABEL,
      threadId: SYNTHETIC_LEGEND_THREAD_ID,
      processId: params.processId
    } satisfies TraceThread
  ];
}

export function buildDeckLayersForTimeMeasure({
  timeMeasureRange,
  layerIdPrefix,
  timeMeasureSelection,
  fontFamily = DEFAULT_TRACE_FONT_FAMILY
}: {
  timeMeasureRange: {startTimeMs: number; endTimeMs: number} | null;
  timeMeasureSelection?: Pick<
    TimeMeasureSelectionState,
    'phase' | 'cursorTimeMs' | 'draftStartTimeMs'
  >;
  layerIdPrefix?: string;
  /** CSS font stack used by the time-measure overlay. */
  fontFamily?: string;
}): Layer[] {
  const visible = Boolean(timeMeasureRange || timeMeasureSelection);
  return [
    new TimeMeasureLayer({
      id: makeLayerId(layerIdPrefix, 'header-time-measure'),
      fontFamily,
      fontSize: 10,
      layerIdPrefix,
      timeMeasureRange,
      selectionState: timeMeasureSelection,
      visible,
      yMin: 0,
      yMax: 1e6
    })
  ];
}

/** Builds minimap pin + hairline layers for selected and hovered spans. */
export function buildDeckLayersForMinimapSpanIndicators({
  indicators = EMPTY_MINIMAP_SPAN_INDICATORS,
  bounds,
  layerIdPrefix,
  modelMatrix,
  fontFamily = DEFAULT_TRACE_FONT_FAMILY
}: {
  /** Preprojected minimap span indicators to render. */
  indicators?: readonly TracePreparedMinimapSpanIndicator[];
  /** Minimap bounds used to make each indicator hairline span the activity area. */
  bounds: Bounds | TraceLayoutBounds;
  /** Optional deck layer id prefix for compare/minimap variants. */
  layerIdPrefix?: string;
  /** Optional transform aligning the indicator with minimap activity layers. */
  modelMatrix?: Matrix4;
  /** CSS font stack used by minimap indicator text. */
  fontFamily?: string;
}): Layer[] {
  const hasIndicators = indicators.length > 0;
  const minY = Math.min(bounds[0][1], bounds[1][1]);
  const maxY = Math.max(bounds[0][1], bounds[1][1]);
  const lineData: MinimapSpanIndicatorLineDatum[] = indicators.map(indicator => ({
    indicator,
    path: [
      [indicator.x, minY],
      [indicator.x, maxY]
    ]
  }));
  const whiskerData: MinimapSpanIndicatorWhiskerDatum[] = indicators.flatMap(indicator =>
    buildMinimapSpanIndicatorWhiskerPaths(indicator).map(path => ({indicator, path}))
  );
  const whiskerCapData: MinimapSpanIndicatorWhiskerCapDatum[] = indicators.flatMap(indicator =>
    buildMinimapSpanIndicatorWhiskerCaps(indicator)
  );

  return [
    new PathLayer<MinimapSpanIndicatorLineDatum>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-hairlines'),
      visible: hasIndicators,
      data: lineData,
      positionFormat: 'XY',
      getPath: datum => datum.path,
      getColor: datum => getMinimapSpanIndicatorBlackLineColor(datum.indicator),
      getWidth: () => MINIMAP_SELECTED_SPAN_INDICATOR_LINE_WIDTH_PX,
      widthUnits: 'pixels',
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    }),
    new ScatterplotLayer<TracePreparedMinimapSpanIndicator>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-top-caps'),
      visible: hasIndicators,
      data: indicators,
      positionFormat: 'XY',
      getPosition: indicator => [indicator.x, minY],
      getRadius: () => MINIMAP_SELECTED_SPAN_INDICATOR_TOP_CAP_RADIUS_PX,
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: indicator => getMinimapSpanIndicatorDotLineColor(indicator),
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1,
      getFillColor: indicator => getMinimapSpanIndicatorBlackFillColor(indicator),
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    }),
    new PathLayer<MinimapSpanIndicatorWhiskerDatum>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-whiskers'),
      visible: hasIndicators,
      data: whiskerData,
      positionFormat: 'XY',
      getPath: datum => datum.path,
      getColor: datum => getMinimapSpanIndicatorBlackLineColor(datum.indicator),
      getWidth: () => MINIMAP_SELECTED_SPAN_INDICATOR_WHISKER_WIDTH_PX,
      widthUnits: 'pixels',
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    }),
    new TextLayer<MinimapSpanIndicatorWhiskerCapDatum>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-whisker-caps'),
      visible: hasIndicators,
      data: whiskerCapData,
      getPosition: datum => [datum.x, datum.indicator.y],
      getText: () => '|',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      getColor: datum => getMinimapSpanIndicatorBlackLineColor(datum.indicator),
      getSize: MINIMAP_SELECTED_SPAN_INDICATOR_WHISKER_CAP_HEIGHT_PX,
      sizeUnits: 'pixels',
      characterSet: TEXT_LAYER_CHARACTER_SET,
      fontFamily,
      fontWeight: 700,
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    }),
    new ScatterplotLayer<TracePreparedMinimapSpanIndicator>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-dot-rings'),
      visible: hasIndicators,
      data: indicators,
      positionFormat: 'XY',
      getPosition: indicator => [indicator.x, indicator.y],
      getRadius: indicator =>
        indicator.kind === 'selected'
          ? MINIMAP_SELECTED_SPAN_INDICATOR_RING_RADIUS_PX
          : MINIMAP_SELECTED_SPAN_INDICATOR_HOVER_RING_RADIUS_PX,
      radiusUnits: 'pixels',
      filled: false,
      stroked: true,
      getLineColor: indicator => getMinimapSpanIndicatorRingColor(indicator),
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: MINIMAP_SELECTED_SPAN_INDICATOR_RING_LINE_WIDTH_PX,
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    }),
    new ScatterplotLayer<TracePreparedMinimapSpanIndicator>({
      id: makeLayerId(layerIdPrefix, 'minimap-span-indicator-dots'),
      visible: hasIndicators,
      data: indicators,
      positionFormat: 'XY',
      getPosition: indicator => [indicator.x, indicator.y],
      getRadius: indicator =>
        indicator.kind === 'selected'
          ? MINIMAP_SELECTED_SPAN_INDICATOR_DOT_RADIUS_PX
          : MINIMAP_SELECTED_SPAN_INDICATOR_HOVER_DOT_RADIUS_PX,
      radiusUnits: 'pixels',
      stroked: true,
      getLineColor: indicator => getMinimapSpanIndicatorDotLineColor(indicator),
      lineWidthUnits: 'pixels',
      lineWidthMinPixels: 1.5,
      getFillColor: indicator => getMinimapSpanIndicatorBlackFillColor(indicator),
      pickable: false,
      modelMatrix,
      parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
    })
  ];
}

/** Returns the horizontal whisker path for a minimap span duration marker. */
function buildMinimapSpanIndicatorWhiskerPaths(
  indicator: TracePreparedMinimapSpanIndicator
): [number, number][][] {
  const range = getMinimapSpanIndicatorWhiskerRange(indicator);
  if (!range) {
    return [];
  }

  return [
    [
      [range.startX, indicator.y],
      [range.endX, indicator.y]
    ]
  ];
}

/** Returns pixel-sized whisker book-end cap inputs for a minimap span duration marker. */
function buildMinimapSpanIndicatorWhiskerCaps(
  indicator: TracePreparedMinimapSpanIndicator
): MinimapSpanIndicatorWhiskerCapDatum[] {
  const range = getMinimapSpanIndicatorWhiskerRange(indicator);
  if (!range) {
    return [];
  }

  return [
    {indicator, x: range.startX},
    {indicator, x: range.endX}
  ];
}

/** Returns sorted whisker X bounds when the marker has a visible duration. */
function getMinimapSpanIndicatorWhiskerRange(
  indicator: TracePreparedMinimapSpanIndicator
): {startX: number; endX: number} | null {
  const startX = Math.min(indicator.startX, indicator.endX);
  const endX = Math.max(indicator.startX, indicator.endX);
  if (!Number.isFinite(startX) || !Number.isFinite(endX) || endX <= startX) {
    return null;
  }

  return {startX, endX};
}

export function buildDeckLayersForGrid({
  minTimeMs,
  maxTimeMs,
  formatTick,
  layerIdPrefix,
  fontFamily = DEFAULT_TRACE_FONT_FAMILY
}: {
  minTimeMs: number;
  maxTimeMs: number;
  formatTick?: (tick: Tick) => string | undefined;
  layerIdPrefix?: string;
  /** CSS font stack used by time-grid labels. */
  fontFamily?: string;
}): Layer[] {
  return [
    new TimeAxisLayer({
      id: makeLayerId(layerIdPrefix, 'header-time-axis'),
      mode: 'duration',
      formatTick,
      modelMatrix: HEADER_TIME_AXIS_MODEL_MATRIX,
      minX: minTimeMs,
      maxX: maxTimeMs,
      minY: 0,
      maxY: 1e6,
      tickCount: 5,
      minorTickCount: 2,
      fontFamily,
      fontSize: 10,
      coverage: 3,
      labelY: -4,
      textColor: [0, 0, 0, 255] as const,
      gridColor: [0, 0, 0, 60] as const,
      parameters: HEADER_TIME_AXIS_DEPTH_PARAMETERS,
      _subLayerProps: {
        'axis-line': {
          parameters: HEADER_TIME_AXIS_DEPTH_PARAMETERS
        },
        'tick-marks': {
          parameters: HEADER_TIME_AXIS_DEPTH_PARAMETERS
        }
      }
    })
  ];
}

function getMinimapSpanIndicatorLineColor(
  indicator: TracePreparedMinimapSpanIndicator
): readonly [number, number, number, number] {
  if (indicator.lineColor) {
    return indicator.lineColor;
  }
  return indicator.kind === 'selected' ? [37, 99, 235, 170] : [96, 165, 250, 120];
}

/** Returns the black vertical hairline color for a minimap span indicator. */
function getMinimapSpanIndicatorBlackLineColor(
  indicator: TracePreparedMinimapSpanIndicator
): readonly [number, number, number, number] {
  return indicator.kind === 'selected' ? [0, 0, 0, 210] : [0, 0, 0, 145];
}

/** Returns the black cap and central dot fill color for a minimap span indicator. */
function getMinimapSpanIndicatorBlackFillColor(
  indicator: TracePreparedMinimapSpanIndicator
): readonly [number, number, number, number] {
  return indicator.kind === 'selected' ? [0, 0, 0, 245] : [0, 0, 0, 205];
}

/** Returns the row-dot ring color, preserving the span hue while keeping the ring visible. */
function getMinimapSpanIndicatorRingColor(
  indicator: TracePreparedMinimapSpanIndicator
): readonly [number, number, number, number] {
  const lineColor = getMinimapSpanIndicatorLineColor(indicator);
  return indicator.kind === 'selected'
    ? [lineColor[0], lineColor[1], lineColor[2], Math.max(lineColor[3], 220)]
    : [lineColor[0], lineColor[1], lineColor[2], Math.max(lineColor[3], 150)];
}

function getMinimapSpanIndicatorDotLineColor(
  indicator: TracePreparedMinimapSpanIndicator
): readonly [number, number, number, number] {
  return indicator.kind === 'selected' ? [255, 255, 255, 245] : [255, 255, 255, 210];
}

export function buildOverviewLayers(params: {
  bounds: Bounds;
  highlightViewportId: string;
  loadedContentBounds?: Readonly<{minX: number; maxX: number}>;
  highlightViewportOffsetX?: number;
  formatTick?: (tick: Tick) => string | undefined;
  /** CSS font stack used by overview labels. */
  fontFamily?: string;
  eventMarkers?: ReadonlyArray<{
    id: string;
    x: number;
    radiusScale?: number;
    fillColor?: readonly [number, number, number, number];
    lineColor?: readonly [number, number, number, number];
    object: unknown;
  }>;
}): Layer[] {
  const {
    highlightViewportId,
    bounds,
    loadedContentBounds,
    highlightViewportOffsetX = 0,
    formatTick,
    fontFamily = DEFAULT_TRACE_FONT_FAMILY,
    eventMarkers = []
  } = params;
  const unloadedIntervalData = buildOverviewUnloadedIntervalData(bounds, loadedContentBounds);
  const overviewMarkerData: OverviewEventMarkerDatum[] = eventMarkers.map(marker => ({
    ...marker,
    y: bounds[0][1] + (bounds[1][1] - bounds[0][1]) * OVERVIEW_EVENT_MARKER_Y_FRACTION
  }));
  const gridLayer = new TimeAxisLayer({
    id: 'minimap-time-grids',
    mode: 'duration',
    axisLine: false,
    tickLabels: true,
    formatTick,
    minX: bounds[0][0],
    maxX: bounds[1][0],
    minY: bounds[0][1],
    maxY: bounds[1][1],
    tickCount: 5,
    minorTickCount: 2,
    fontFamily,
    fontSize: 10,
    coverage: 3,
    labelY: bounds[0][1] + (bounds[1][1] - bounds[0][1]) * OVERVIEW_AXIS_LABEL_TOP_MARGIN_FRACTION,
    textColor: [0, 0, 0, 255] as const,
    gridColor: [0, 0, 0, 60] as const
  });
  const axisPath: [number, number][] = [
    [bounds[0][0], bounds[0][1]],
    [bounds[1][0], bounds[0][1]]
  ];
  const axisLayer = new PathLayer<[number, number][]>({
    id: 'minimap-time-axis',
    data: [axisPath],
    getPath: path => path,
    getColor: [0, 0, 0, 90] as const,
    getWidth: 1,
    widthUnits: 'pixels',
    pickable: false,
    parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'}
  });

  const viewportLayer = new ViewportHighlightLayer({
    id: 'minimap-viewport',
    highlightedViewportIds: [highlightViewportId],
    bounds,
    xOffset: highlightViewportOffsetX,
    getFillColor: makeDeckColor('#0f172a26'),
    getLineColor: makeDeckColor('#0f172a80'),
    lineWidthMinPixels: 2,
    pickable: false,
    parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'}
  });

  const hasUnloadedIntervals = unloadedIntervalData.length > 0;
  const unloadedIntervalsLayer = new PolygonLayer<OverviewUnloadedIntervalDatum>({
    id: 'minimap-unloaded-intervals',
    visible: hasUnloadedIntervals,
    data: unloadedIntervalData,
    positionFormat: 'XY',
    getPolygon: interval => interval.polygon,
    getFillColor: [15, 23, 42, 70] as const,
    stroked: false,
    pickable: false,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
  });
  const unloadedIntervalLabelLayer = new TextLayer<OverviewUnloadedIntervalDatum>({
    id: 'minimap-unloaded-interval-labels',
    visible: hasUnloadedIntervals,
    data: unloadedIntervalData,
    getPosition: interval => [interval.labelX, interval.labelY],
    getText: interval => interval.label,
    getColor: [15, 23, 42, 215] as const,
    getTextAnchor: 'middle',
    getAlignmentBaseline: 'center',
    fontFamily,
    getSize: 11,
    pickable: false,
    parameters: {blend: true, depthWriteEnabled: false, depthCompare: 'always'}
  });
  const eventMarkerLayer = new ScatterplotLayer<OverviewEventMarkerDatum>({
    id: 'minimap-model-timeline-events',
    visible: overviewMarkerData.length > 0,
    data: overviewMarkerData,
    getPosition: datum => [datum.x, datum.y],
    getRadius: datum => OVERVIEW_EVENT_MARKER_RADIUS_PX * (datum.radiusScale ?? 1),
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: datum => datum.lineColor ?? ([120, 53, 15, 220] as const),
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: OVERVIEW_EVENT_MARKER_LINE_WIDTH_PX,
    getFillColor: datum => datum.fillColor ?? ([250, 204, 21, 230] as const),
    pickable: true,
    parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'}
  });

  return [
    viewportLayer,
    unloadedIntervalsLayer,
    gridLayer,
    axisLayer,
    unloadedIntervalLabelLayer,
    eventMarkerLayer
  ];
}

/**
 * Builds a main-trace event row rendered above the first process lane.
 */
export function buildMainTimelineEventLayer(params: {
  bounds: Bounds;
  eventMarkers?: ReadonlyArray<{
    id: string;
    x: number;
    radiusScale?: number;
    fillColor?: readonly [number, number, number, number];
    lineColor?: readonly [number, number, number, number];
    object: unknown;
  }>;
}): Layer {
  const {bounds, eventMarkers = []} = params;
  const markerData: OverviewEventMarkerDatum[] = eventMarkers.map(marker => ({
    ...marker,
    y: bounds[0][1] + MAIN_TIMELINE_EVENT_MARKER_Y_OFFSET
  }));

  return new ScatterplotLayer<OverviewEventMarkerDatum>({
    id: 'main-model-timeline-events',
    visible: markerData.length > 0,
    data: markerData,
    getPosition: datum => [datum.x, datum.y],
    getRadius: datum => OVERVIEW_EVENT_MARKER_RADIUS_PX * (datum.radiusScale ?? 1),
    radiusUnits: 'pixels',
    stroked: true,
    getLineColor: datum => datum.lineColor ?? ([120, 53, 15, 220] as const),
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: OVERVIEW_EVENT_MARKER_LINE_WIDTH_PX,
    getFillColor: datum => datum.fillColor ?? ([250, 204, 21, 230] as const),
    pickable: true,
    parameters: {blend: false, depthWriteEnabled: false, depthCompare: 'always'}
  });
}

function buildOverviewUnloadedIntervalData(
  bounds: Bounds,
  loadedContentBounds?: Readonly<{minX: number; maxX: number}>
): OverviewUnloadedIntervalDatum[] {
  if (!loadedContentBounds) {
    return [];
  }

  const minX = bounds[0][0];
  const maxX = bounds[1][0];
  const minY = bounds[0][1];
  const maxY = bounds[1][1];
  const unloadedIntervalMinY = minY + (maxY - minY) * OVERVIEW_UNLOADED_INTERVAL_TOP_INSET_FRACTION;
  const loadedMinX = Math.min(loadedContentBounds.minX, loadedContentBounds.maxX);
  const loadedMaxX = Math.max(loadedContentBounds.minX, loadedContentBounds.maxX);
  const clampedLoadedMinX = Math.max(minX, Math.min(maxX, loadedMinX));
  const clampedLoadedMaxX = Math.max(minX, Math.min(maxX, loadedMaxX));
  const labelY = unloadedIntervalMinY + (maxY - unloadedIntervalMinY) / 2;
  const intervals: OverviewUnloadedIntervalDatum[] = [];

  if (clampedLoadedMinX > minX) {
    intervals.push({
      polygon: [
        [minX, unloadedIntervalMinY],
        [clampedLoadedMinX, unloadedIntervalMinY],
        [clampedLoadedMinX, maxY],
        [minX, maxY]
      ],
      labelX: minX + (clampedLoadedMinX - minX) / 2,
      labelY,
      label: OVERVIEW_UNLOADED_INTERVAL_LABEL
    });
  }
  if (clampedLoadedMaxX < maxX) {
    intervals.push({
      polygon: [
        [clampedLoadedMaxX, unloadedIntervalMinY],
        [maxX, unloadedIntervalMinY],
        [maxX, maxY],
        [clampedLoadedMaxX, maxY]
      ],
      labelX: clampedLoadedMaxX + (maxX - clampedLoadedMaxX) / 2,
      labelY,
      label: OVERVIEW_UNLOADED_INTERVAL_LABEL
    });
  }

  return intervals;
}
