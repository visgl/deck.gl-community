import {CompositeLayer} from '@deck.gl/core';

import {
  cloneTraceLayoutCollapseStateForGraphs,
  createEmptyTraceGraphCollapseState,
  createTraceComparisonModelMatrix,
  DEFAULT_TRACE_COLOR_SCHEME,
  DEFAULT_TRACE_FONT_FAMILY
} from '../../trace/index';
import {
  buildTraceViewRenderInputs,
  buildTraceViewState
} from '../../trace/trace-view-state/trace-view-state';
import {TracePreparedStateLayer} from './trace-prepared-state-layer';

import type {
  SpanRef,
  TraceColorScheme,
  TraceLayoutCollapseState,
  TracePath,
  TraceProcessActivityAggregation,
  TraceGraph,
  TraceThreadId,
  TraceVisSettings,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../../trace/index';
import type {CompositeLayerProps, Layer, LayerProps, UpdateParameters} from '@deck.gl/core';
import type {Matrix4} from '@math.gl/core';
import type {ThreadLaneMetadata} from '../../trace/index';
import type {TraceViewState} from '../../trace/trace-view-state/trace-view-state';
import type {TraceDeckLayerHandlers, TraceDeckLayerSelection} from './deck-layers';
import type {TracePreparedStateLayerPathHighlighting} from './trace-prepared-state-layer';

const EMPTY_SPAN_REFS: readonly SpanRef[] = [];
const EMPTY_TRACE_PATHS: readonly TracePath[] = [];

type TraceGraphLayerState = {
  /** Most recent pure-JS trace render state prepared for deck sublayers. */
  traceViewState: TraceViewState | null;
};

/** Properties supported by {@link TraceGraphLayer}. */
export type TraceGraphLayerProps = LayerProps &
  CompositeLayerProps & {
    /** Runtime trace graphs rendered by this main-timeline deck layer. */
    readonly traceGraphs: readonly TraceGraph[];
    /** Source graphs represented before optional comparison/layout slicing. */
    readonly sourceTraceGraphs?: readonly TraceGraph[];
    /** Active visualization settings used by layout and trace deck sublayers. */
    readonly settings: TraceVisSettings;
    /** Active trace color scheme used by prepared scene and deck sublayers. */
    readonly colorScheme?: TraceColorScheme;
    /** CSS font stack used by trace text layers. */
    readonly fontFamily?: string;
    /** Ref-native collapse state aligned with `traceGraphs`. */
    readonly collapseState?: TraceLayoutCollapseState;
    /** Critical paths rendered by the prepared trace scene. */
    readonly paths?: readonly TracePath[];
    /** Transient hover, selection, and highlight overlays. */
    readonly selection?: TraceDeckLayerSelection;
    /** Interaction callbacks forwarded to interactive trace sublayers. */
    readonly handlers?: Partial<TraceDeckLayerHandlers>;
    /** Step number attached to process layers for legacy picking payloads. */
    readonly stepNum?: number;
    /** Whether collapsed process activity summaries should be prepared. */
    readonly showCollapsedActivitySummary?: boolean;
    /** Aggregation algorithm used by collapsed process activity summaries. */
    readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
    /** Whether dashed row separators should be rendered for foreground rows. */
    readonly showRowSeparators?: boolean;
    /** Vertical inset applied before the first visible process row. */
    readonly layoutTopPadding?: number;
    /** Optional timing key used to rebuild span geometry. */
    readonly layoutTimingKey?: string | null;
    /** Canonical minimum time paired with timing-key geometry rebuilds. */
    readonly minTimeMs?: number;
    /** Optional per-thread lane visibility overrides used by custom renderers. */
    readonly threadLaneLayoutOverrides?: Readonly<
      Record<TraceThreadId, Pick<ThreadLaneMetadata, 'visibleLaneIndices'>>
    >;
    /** Exact selected span refs used for focused extended-selection layouts. */
    readonly selectedSpanRefs?: readonly SpanRef[];
    /** Extra selected span refs visible only in focused or extended selection. */
    readonly extendedSelectionSpanRefs?: readonly SpanRef[];
    /** Selected local dependency refs whose endpoints should remain visible. */
    readonly selectedLocalDependencyRefs?: ReadonlySet<VisibleLocalDependencyRef>;
    /** Selected cross-process dependency refs whose endpoints should remain visible. */
    readonly selectedCrossDependencyRefs?: ReadonlySet<VisibleCrossDependencyRef>;
    /** Whether current selection inputs should produce a focused extended-selection layout. */
    readonly isExtendedSelection?: boolean;
    /** Returns the model matrix for one graph index in comparison mode. */
    readonly getTraceModelMatrixForGraph?: (graphIndex: number) => Matrix4 | undefined;
    /** Active path animation overlays, when critical-path playback is enabled. */
    readonly pathHighlighting?: TracePreparedStateLayerPathHighlighting;
  };

/** Prepares trace graphs into pure-JS trace view state and renders main-timeline deck sublayers. */
export class TraceGraphLayer extends CompositeLayer<TraceGraphLayerProps> {
  static override layerName = 'TraceGraphLayer';

  override state: TraceGraphLayerState = {
    traceViewState: null
  };

  override updateState({props}: UpdateParameters<this>): void {
    this.state.traceViewState = buildTraceGraphLayerTraceViewState(
      props,
      this.state.traceViewState
    );
  }

  override renderLayers(): Layer | null {
    const traceViewState =
      this.state.traceViewState ?? buildTraceGraphLayerTraceViewState(this.props, null);
    if (!traceViewState) {
      return null;
    }
    const selection =
      this.props.selectedSpanRefs == null
        ? this.props.selection
        : {...this.props.selection, selectedSpanRefs: this.props.selectedSpanRefs};

    return new TracePreparedStateLayer({
      ...this.getSubLayerProps({id: 'prepared-state'}),
      traceViewState,
      settings: this.props.settings,
      selection,
      handlers: this.props.handlers,
      stepNum: this.props.stepNum,
      colorScheme: this.props.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME,
      fontFamily: this.props.fontFamily ?? DEFAULT_TRACE_FONT_FAMILY,
      showRowSeparators: this.props.showRowSeparators,
      pathHighlighting: this.props.pathHighlighting
    });
  }
}

/** Builds the pure-JS trace view state consumed by {@link TraceGraphLayer}. */
function buildTraceGraphLayerTraceViewState(
  props: TraceGraphLayerProps,
  previousState: TraceViewState | null
): TraceViewState | null {
  const traceGraphs = props.traceGraphs;
  const primaryTraceGraph = traceGraphs[0];
  if (!primaryTraceGraph) {
    return null;
  }

  const settings = props.settings;
  const colorScheme = props.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME;
  const sourceTraceGraphs = props.sourceTraceGraphs ?? traceGraphs;
  const layoutTopPadding = props.layoutTopPadding ?? 0;
  const minTimeMs = props.minTimeMs ?? primaryTraceGraph.minTimeMs;
  const collapseState = cloneTraceLayoutCollapseStateForGraphs(
    props.collapseState ?? createEmptyTraceLayoutCollapseState(traceGraphs),
    traceGraphs
  );
  const selectedSpanRefs =
    props.selectedSpanRefs ?? props.selection?.selectedSpanRefs ?? EMPTY_SPAN_REFS;
  const getTraceModelMatrixForGraph =
    props.getTraceModelMatrixForGraph ??
    (graphIndex =>
      graphIndex === 1
        ? createTraceComparisonModelMatrix(settings.traceOffsetMs, settings.traceScale)
        : undefined);
  const renderInputs = buildTraceViewRenderInputs({
    traceGraph: primaryTraceGraph,
    traceGraphs,
    settings,
    collapseStateForLayout: collapseState,
    layoutTopPadding,
    layoutTimingKey: props.layoutTimingKey,
    minTimeMs,
    shouldPrepareOverviewData: false,
    initialViewportFitKey: getInitialViewportFitKey(traceGraphs),
    selectedSpanRefs,
    extendedSelectionSpanRefs: props.extendedSelectionSpanRefs ?? EMPTY_SPAN_REFS,
    selectedLocalDependencyRefs: props.selectedLocalDependencyRefs,
    selectedCrossDependencyRefs: props.selectedCrossDependencyRefs,
    isExtendedSelection: props.isExtendedSelection ?? false
  });

  return buildTraceViewState({
    previousState,
    baseLayoutKey: renderInputs.traceViewBaseLayoutKey,
    traceGraphs,
    sourceTraceGraphs,
    primaryTraceGraph,
    paths: props.paths ?? EMPTY_TRACE_PATHS,
    layoutSettings: renderInputs.traceLayoutSettings,
    settings,
    colorScheme,
    collapseState,
    threadLaneLayoutOverrides: props.threadLaneLayoutOverrides,
    layoutTopPadding,
    layoutTimingKey: props.layoutTimingKey,
    minTimeMs,
    buildMinimapLayouts: false,
    focusedSelectionSpanRefs: renderInputs.focusedSelectionSpanRefs,
    showCollapsedActivitySummary: props.showCollapsedActivitySummary ?? false,
    collapsedActivityAggregation: props.collapsedActivityAggregation,
    isOverviewEnabled: false,
    getTraceModelMatrixForGraph
  });
}

/** Creates an expanded-by-default collapse state aligned with one graph list. */
function createEmptyTraceLayoutCollapseState(
  traceGraphs: readonly TraceGraph[]
): TraceLayoutCollapseState {
  return {
    graphs: traceGraphs.map(() => createEmptyTraceGraphCollapseState())
  };
}

/** Returns the stable graph-family key used by TraceViewState base layout reuse. */
function getInitialViewportFitKey(traceGraphs: readonly TraceGraph[]): string {
  return traceGraphs
    .map(traceGraph => `${traceGraph.name}\u0000${traceGraph.minTimeMs}`)
    .join('\u0001');
}
