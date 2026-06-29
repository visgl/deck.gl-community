import {
  cloneTraceLayoutCollapseStateForGraphs,
  getTraceLayoutGraphs
} from '../trace-layout/trace-collapse-resolution';
import {
  createTraceCollapseRuntimeState,
  reduceTraceCollapseRuntimeState
} from '../trace-layout/trace-collapse-runtime';
import {DEFAULT_TRACE_COLOR_SCHEME} from '../trace-style/trace-colors';
import {createTraceComparisonModelMatrix} from './trace-prepared-scene';
import {
  buildTraceSelectedDependencyDirectionMaps,
  getImmediateVisibleDependencyRefsForSpan,
  getTraceSelectedSpanFromRef
} from './trace-view-selection';
import {
  buildTraceViewRenderInputs,
  buildTraceViewState,
  estimateTraceViewStateRetainedSize
} from './trace-view-state';

import type {TraceProcessActivityAggregation} from '../trace-graph/collapsed-activity';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {TraceSelectedDependencyDirection} from '../trace-graph/trace-graph-types';
import type {
  ProcessRef,
  ThreadRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TracePath} from '../trace-graph/trace-types';
import type {TraceLayout, TraceLayoutCollapseState} from '../trace-layout/trace-layout';
import type {TraceColorScheme} from '../trace-style/trace-color-scheme';
import type {TraceStyle} from '../trace-style/trace-style';
import type {TracePreparedGraphScene, TracePreparedScene} from './trace-prepared-scene';
import type {TraceSelectedSpan} from './trace-view-selection';
import type {TraceViewState, TraceViewStateBuildPhaseTimings} from './trace-view-state';

/** Selection expansion policy retained by the mounted trace engine. */
type TraceEngineSelectionPolicy =
  | {
      /** Leaves extended spans and dependency overlays empty unless an action supplies them. */
      readonly type: 'raw';
    }
  | {
      /** Selects visible dependencies immediately touching the primary selected span. */
      readonly type: 'immediate-visible-dependencies';
    }
  | {
      /** Selects a graph-native dependency chain around the primary selected span. */
      readonly type: 'dependency-chain';
      /** Optional dependency keywords used while traversing the selected chain. */
      readonly keywords?: readonly string[];
    };

/** Canonical selected-span and dependency overlay state retained by TraceEngine. */
type TraceEngineSelectionState = {
  /** Canonical selected span refs owned by the mounted engine. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Extra selected span refs visible through the active selection policy. */
  readonly extendedSelectionSpanRefs: readonly SpanRef[];
  /** Visible local dependency refs rendered as selected overlays. */
  readonly selectedLocalDependencyRefs: readonly VisibleLocalDependencyRef[];
  /** Visible cross-process dependency refs rendered as selected overlays. */
  readonly selectedCrossDependencyRefs: readonly VisibleCrossDependencyRef[];
  /** Selected visible local dependency directions keyed by dependency ref. */
  readonly selectedLocalDependencyDirectionByRef: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Selected visible cross dependency directions keyed by dependency ref. */
  readonly selectedCrossDependencyDirectionByRef: ReadonlyMap<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Whether the mounted engine is rendering a temporary focused layout. */
  readonly isExtendedSelection: boolean;
};

/** Immutable renderer snapshot published by the mounted trace engine. */
type TraceEngineSnapshot = {
  /** Monotonic engine revision consumed by renderer subscriptions. */
  readonly revision: number;
  /** Primary filtered graph supplied by the host. */
  readonly traceGraph: TraceGraph;
  /** Optional secondary filtered graph supplied by the host. */
  readonly secondaryTraceGraph?: TraceGraph;
  /** Graphs currently projected into layouts. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Primary graph currently projected into layouts. */
  readonly primaryTraceGraph: TraceGraph;
  /** Trace labels and style defaults consumed by renderers. */
  readonly traceStyle: TraceStyle;
  /** Active visualization settings consumed by renderers. */
  readonly settings: TraceVisSettings;
  /** Active trace color scheme consumed by renderers. */
  readonly colorScheme: TraceColorScheme;
  /** Active trace paths consumed by prepared-scene builders. */
  readonly paths: TracePath[];
  /** Canonical selected span refs owned by the engine. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Display-oriented selected span payloads resolved from selected refs. */
  readonly selectedSpans: readonly TraceSelectedSpan[];
  /** Extra selected span refs visible through the active selection policy. */
  readonly extendedSelectionSpanRefs: readonly SpanRef[];
  /** Extended selection rendering mode requested by the host. */
  readonly extendedSelectionMode: 'none' | 'fade' | 'highlight' | 'both';
  /** Span refs kept opaque by app-owned path or search highlighting. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
  /** Selected local dependency refs rendered as selected overlays. */
  readonly selectedLocalDependencyRefs?: ReadonlySet<VisibleLocalDependencyRef>;
  /** Selected cross dependency refs rendered as selected overlays. */
  readonly selectedCrossDependencyRefs?: ReadonlySet<VisibleCrossDependencyRef>;
  /** Selected local dependency directions keyed by visible dependency ref. */
  readonly selectedLocalDependencyDirectionByRef: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Selected cross dependency directions keyed by visible dependency ref. */
  readonly selectedCrossDependencyDirectionByRef: ReadonlyMap<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Ref-native collapse state consumed by layout builders. */
  readonly collapseState: TraceLayoutCollapseState;
  /** Serialized expanded process ids ready for URL or store persistence. */
  readonly serializedExpandedProcessIds: readonly string[];
  /** Optional timing key used while laying out spans. */
  readonly layoutTimingKey?: string | null;
  /** Vertical inset applied to the first rendered process row. */
  readonly layoutTopPadding: number;
  /** Whether collapsed-process activity summaries should be projected. */
  readonly showCollapsedActivitySummary: boolean;
  /** Collapsed process activity aggregation requested by the host. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Whether minimap scene inputs should be shown by the renderer. */
  readonly isOverviewEnabled: boolean;
  /** Whether minimap layout inputs should be prepared for the renderer. */
  readonly shouldPrepareOverviewData: boolean;
  /** Current prepared trace-view state owned by the engine. */
  readonly traceViewState: TraceViewState;
};

/** Subscriber invoked after TraceEngine publishes one update. */
type TraceEngineListener = (update: TraceEngineUpdate) => void;

/** Optional work requested while reading TraceEngine diagnostics. */
type TraceEngineDiagnosticsOptions = {
  /** Whether to run on-demand retained-size estimators over current layout and deck inputs. */
  readonly includeRetainedSizeEstimates?: boolean;
};

/** Durable host inputs synchronized into one mounted trace engine. */
export type TraceEngineInputs = {
  /** Primary filtered graph displayed by the engine. */
  readonly traceGraph: TraceGraph;
  /** Optional secondary filtered graph displayed in compare mode. */
  readonly secondaryTraceGraph?: TraceGraph | null;
  /** Trace labels and visual defaults consumed by renderers. */
  readonly traceStyle: TraceStyle;
  /** Active trace paths rendered above the displayed graphs. */
  readonly paths: TracePath[];
  /** Active visualization settings synchronized from the host. */
  readonly settings: TraceVisSettings;
  /** Optional trace color scheme override synchronized from the host. */
  readonly colorScheme?: TraceColorScheme;
  /** Optional span refs kept opaque by app-owned search or path state. */
  readonly highlightedSpanRefs?: ReadonlySet<SpanRef>;
  /** Canonical selected span refs synchronized from durable host state. */
  readonly selectedSpanRefs?: readonly SpanRef[];
  /** Selection policy applied whenever the primary selected span changes. */
  readonly selectionPolicy?: TraceEngineSelectionPolicy;
  /** Whether synchronized selected refs should enter temporary focused layout mode. */
  readonly focusSelectedSpanRefs?: boolean;
  /** How selected and extended span refs affect highlight fading. */
  readonly extendedSelectionMode?: 'none' | 'fade' | 'highlight' | 'both';
  /** Whether process rows should expand when no explicit override exists. */
  readonly defaultExpandProcess: boolean;
  /** Serialized process ids expanded at the durable host boundary. */
  readonly defaultExpandedProcessIds?: readonly string[];
  /** Serialized process ids collapsed at the durable host boundary. */
  readonly defaultCollapsedProcessIds?: readonly string[];
  /** Startup selected refs used when mounted selection is empty. */
  readonly defaultSelectedSpanRefs?: readonly SpanRef[];
  /** Whether focused extended-selection refs should expand their owning processes. */
  readonly expandExtendedSelectionProcesses?: boolean;
  /** Whether collapsed-process activity summaries should be projected. */
  readonly showCollapsedActivitySummary?: boolean;
  /** Collapsed process activity aggregation requested by the host. */
  readonly collapsedActivityAggregation?: TraceProcessActivityAggregation;
  /** Optional timing key used while laying out spans. */
  readonly layoutTimingKey?: string | null;
  /** Vertical inset applied to the first rendered process row. */
  readonly layoutTopPadding?: number;
};

/** One user or host interaction applied to a mounted trace engine. */
export type TraceEngineAction =
  | {
      /** Selects one span and applies the configured selection policy. */
      readonly type: 'selectSpan';
      /** Canonical span ref selected by the interaction. */
      readonly spanRef: SpanRef;
      /** Whether the interaction should enter temporary focused layout mode. */
      readonly isExtendedSelection?: boolean;
      /** Optional selected visible local dependency refs supplied by the interaction. */
      readonly selectedLocalDependencyRefs?: readonly VisibleLocalDependencyRef[];
      /** Optional selected visible cross dependency refs supplied by the interaction. */
      readonly selectedCrossDependencyRefs?: readonly VisibleCrossDependencyRef[];
      /** Optional selected visible local dependency directions supplied by the interaction. */
      readonly selectedLocalDependencyDirectionByRef?: ReadonlyMap<
        VisibleLocalDependencyRef,
        TraceSelectedDependencyDirection
      >;
      /** Optional selected visible cross dependency directions supplied by the interaction. */
      readonly selectedCrossDependencyDirectionByRef?: ReadonlyMap<
        VisibleCrossDependencyRef,
        TraceSelectedDependencyDirection
      >;
    }
  | {
      /** Replaces mounted selection from canonical span and dependency refs. */
      readonly type: 'setSelection';
      /** Canonical selected span refs to store in the engine. */
      readonly selectedSpanRefs: readonly SpanRef[];
      /** Optional selected visible local dependency refs supplied by the caller. */
      readonly selectedLocalDependencyRefs?: readonly VisibleLocalDependencyRef[];
      /** Optional selected visible cross dependency refs supplied by the caller. */
      readonly selectedCrossDependencyRefs?: readonly VisibleCrossDependencyRef[];
      /** Optional selected visible local dependency directions supplied by the caller. */
      readonly selectedLocalDependencyDirectionByRef?: ReadonlyMap<
        VisibleLocalDependencyRef,
        TraceSelectedDependencyDirection
      >;
      /** Optional selected visible cross dependency directions supplied by the caller. */
      readonly selectedCrossDependencyDirectionByRef?: ReadonlyMap<
        VisibleCrossDependencyRef,
        TraceSelectedDependencyDirection
      >;
      /** Whether the replacement selection should enter temporary focused layout mode. */
      readonly isExtendedSelection?: boolean;
    }
  | {
      /** Clears mounted span, dependency, and focused selection state. */
      readonly type: 'clearSelection';
    }
  | {
      /** Expands or collapses every displayed process row. */
      readonly type: 'setAllProcessesExpanded';
      /** Whether every displayed process row should be expanded. */
      readonly expand: boolean;
    }
  | {
      /** Toggles one displayed process row. */
      readonly type: 'toggleProcess';
      /** Graph index that owns the process ref. */
      readonly graphIndex: number;
      /** Graph-local process ref toggled by the interaction. */
      readonly processRef: ProcessRef;
    }
  | {
      /** Toggles one displayed thread lane row. */
      readonly type: 'toggleThread';
      /** Graph index that owns the thread ref. */
      readonly graphIndex: number;
      /** Graph-local thread ref toggled by the interaction. */
      readonly threadRef: ThreadRef;
    }
  | {
      /** Rebuilds collapse overrides from current durable expansion inputs. */
      readonly type: 'resetProcessExpansion';
    };

/** Semantic mounted-engine update emitted after a synchronized input or interaction change. */
export type TraceEngineUpdate = {
  /** Monotonic engine revision after the applied change. */
  readonly revision: number;
  /** Why the engine emitted this semantic update. */
  readonly reason: 'sync' | TraceEngineAction['type'];
  /** Whether canonical mounted span selection changed. */
  readonly selectionChanged: boolean;
  /** Whether serialized expanded process ids changed. */
  readonly expandedProcessIdsChanged: boolean;
  /** Canonical selected span refs after the applied change. */
  readonly selectedSpanRefs: readonly SpanRef[];
  /** Display-oriented selected span payloads after the applied change. */
  readonly selectedSpans: readonly TraceSelectedSpan[];
  /** Selected visible local dependency refs after the applied change. */
  readonly selectedLocalDependencyRefs: readonly VisibleLocalDependencyRef[];
  /** Selected visible cross dependency refs after the applied change. */
  readonly selectedCrossDependencyRefs: readonly VisibleCrossDependencyRef[];
  /** Whether temporary focused layout mode is active after the applied change. */
  readonly isExtendedSelection: boolean;
  /** Serialized expanded process ids after the applied change. */
  readonly serializedExpandedProcessIds: readonly string[];
};

/** Cheap retained-state and build diagnostics for one mounted trace engine. */
export type TraceEngineDiagnostics = {
  /** Monotonic engine revision consumed by renderer subscriptions. */
  readonly revision: number;
  /** Reason that produced the current mounted engine snapshot. */
  readonly lastUpdateReason: TraceEngineUpdate['reason'];
  /** Number of semantic update listeners currently registered with the engine. */
  readonly listenerCount: number;
  /** Number of displayed graphs currently projected into layouts. */
  readonly displayedGraphCount: number;
  /** Number of displayed processes across current projected graphs. */
  readonly displayedProcessCount: number;
  /** Number of displayed threads across current projected graphs. */
  readonly displayedThreadCount: number;
  /** Number of displayed spans across current projected graphs. */
  readonly displayedSpanCount: number;
  /** Number of displayed local dependencies across current projected graphs. */
  readonly displayedLocalDependencyCount: number;
  /** Number of displayed cross-process dependencies across current projected graphs. */
  readonly displayedCrossDependencyCount: number;
  /** Number of canonical selected span refs owned by the engine. */
  readonly selectedSpanCount: number;
  /** Number of span refs currently driving temporary focused layouts. */
  readonly focusedSpanCount: number;
  /** Number of visible local dependency refs rendered as selected overlays. */
  readonly selectedLocalDependencyCount: number;
  /** Number of visible cross dependency refs rendered as selected overlays. */
  readonly selectedCrossDependencyCount: number;
  /** Number of layouts currently consumed by renderers. */
  readonly activeLayoutCount: number;
  /** Number of reusable base layouts retained by the engine. */
  readonly baseLayoutCount: number;
  /** Number of temporary focused layouts retained by the engine. */
  readonly focusedLayoutCount: number;
  /** Number of prepared foreground graph scenes retained by the engine. */
  readonly preparedForegroundSceneCount: number;
  /** Number of prepared overview graph scenes retained by the engine. */
  readonly preparedOverviewSceneCount: number;
  /** Number of prepared foreground process rows retained by the engine. */
  readonly preparedForegroundRowCount: number;
  /** Number of prepared foreground span refs retained by the engine. */
  readonly preparedForegroundSpanCount: number;
  /** Number of prepared overview process rows retained by the engine. */
  readonly preparedOverviewRowCount: number;
  /** Number of prepared overview span refs retained by the engine. */
  readonly preparedOverviewSpanCount: number;
  /** Last TraceViewState build phase timings attributed by the engine. */
  readonly buildPhaseTimings: TraceViewStateBuildPhaseTimings;
  /** On-demand estimated retained byte size of current TraceEngine-owned render data. */
  readonly traceEngineRetainedSizeBytes: number | null;
  /** On-demand estimated retained byte size of current TraceLayout outputs. */
  readonly traceLayoutSizeBytes: number | null;
  /** On-demand estimated retained byte size of current prepared deck input outputs. */
  readonly traceDeckInputsSizeBytes: number | null;
  /** Time spent computing optional retained-size estimates for this diagnostics read. */
  readonly retainedSizeEstimateDurationMs: number | null;
};

/** Owns mounted trace interaction, collapse, layout, and prepared-scene state below React. */
export class TraceEngine {
  /** Durable normalized host inputs owned by this engine. */
  private inputs: TraceEngineInputs;
  /** Canonical selected-span and dependency overlay state. */
  private selection: TraceEngineSelectionState;
  /** Ref-native collapse runtime retained across engine updates. */
  private collapseRuntime = createTraceCollapseRuntimeState({
    traceGraphs: [],
    defaultExpandProcess: true
  });
  /** Latest prepared trace-view state, when materialized. */
  private traceViewState: TraceViewState | null = null;
  /** Latest immutable renderer snapshot published by the engine. */
  private snapshot!: TraceEngineSnapshot;
  /** Monotonic renderer snapshot revision. */
  private revision = 0;
  /** Active renderer subscribers awaiting engine updates. */
  private listeners = new Set<TraceEngineListener>();
  /** Reason recorded on the last published engine update. */
  private lastUpdateReason: TraceEngineUpdate['reason'] = 'sync';

  /** Creates one mounted trace engine from durable host inputs. */
  constructor(inputs: TraceEngineInputs) {
    this.inputs = normalizeTraceEngineInputs(inputs);
    this.selection = buildTraceEngineSelectionState({
      inputs: this.inputs,
      selectedSpanRefs: this.inputs.selectedSpanRefs ?? [],
      isExtendedSelection: this.inputs.focusSelectedSpanRefs === true
    });
    this.collapseRuntime = createTraceCollapseRuntimeState(this.buildCollapseRuntimeInputs());
    this.rebuildSnapshot('sync', null, false);
  }

  /** Synchronizes durable host inputs without returning mounted interaction ownership to React. */
  sync(inputs: TraceEngineInputs): TraceEngineUpdate | null {
    const nextInputs = normalizeTraceEngineInputs(inputs);
    if (areTraceEngineInputsEqual(this.inputs, nextInputs)) {
      return null;
    }

    const previousSnapshot = this.snapshot;
    const previousInputs = this.inputs;
    this.inputs = nextInputs;
    const selectedSpanRefs = nextInputs.selectedSpanRefs ?? [];
    const shouldReplaceSelection =
      !areScalarArraysEqual(selectedSpanRefs, this.selection.selectedSpanRefs) ||
      previousInputs.traceGraph !== nextInputs.traceGraph ||
      !areTraceEngineSelectionPoliciesEqual(
        previousInputs.selectionPolicy,
        nextInputs.selectionPolicy
      );
    if (shouldReplaceSelection) {
      this.selection = buildTraceEngineSelectionState({
        inputs: nextInputs,
        selectedSpanRefs,
        isExtendedSelection:
          areScalarArraysEqual(selectedSpanRefs, this.selection.selectedSpanRefs) &&
          previousInputs.traceGraph === nextInputs.traceGraph
            ? this.selection.isExtendedSelection
            : nextInputs.focusSelectedSpanRefs === true
      });
    }
    this.collapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
      type: 'syncInputs',
      inputs: this.buildCollapseRuntimeInputs()
    });
    return this.rebuildSnapshot('sync', previousSnapshot, true);
  }

  /** Applies one mounted trace interaction and returns its semantic engine update. */
  dispatch(action: TraceEngineAction): TraceEngineUpdate {
    const previousSnapshot = this.snapshot;
    if (action.type === 'selectSpan') {
      this.selection = buildTraceEngineSelectionState({
        inputs: this.inputs,
        selectedSpanRefs: [action.spanRef],
        selectedLocalDependencyRefs: action.selectedLocalDependencyRefs,
        selectedCrossDependencyRefs: action.selectedCrossDependencyRefs,
        selectedLocalDependencyDirectionByRef: action.selectedLocalDependencyDirectionByRef,
        selectedCrossDependencyDirectionByRef: action.selectedCrossDependencyDirectionByRef,
        isExtendedSelection: action.isExtendedSelection === true
      });
      this.syncCollapseRuntimeInputs();
    } else if (action.type === 'setSelection') {
      this.selection = buildTraceEngineSelectionState({
        inputs: this.inputs,
        selectedSpanRefs: action.selectedSpanRefs,
        selectedLocalDependencyRefs: action.selectedLocalDependencyRefs,
        selectedCrossDependencyRefs: action.selectedCrossDependencyRefs,
        selectedLocalDependencyDirectionByRef: action.selectedLocalDependencyDirectionByRef,
        selectedCrossDependencyDirectionByRef: action.selectedCrossDependencyDirectionByRef,
        isExtendedSelection: action.isExtendedSelection === true
      });
      this.syncCollapseRuntimeInputs();
    } else if (action.type === 'clearSelection') {
      this.selection = createEmptyTraceEngineSelectionState();
      this.syncCollapseRuntimeInputs();
    } else if (action.type === 'setAllProcessesExpanded') {
      this.collapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
        type: 'setAllProcessesExpanded',
        traceGraphs: this.getTraceGraphsForInputs(),
        expand: action.expand
      });
    } else if (action.type === 'toggleProcess') {
      this.collapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
        type: 'toggleProcess',
        traceGraphs: this.getTraceGraphsForInputs(),
        graphIndex: action.graphIndex,
        processRef: action.processRef
      });
    } else if (action.type === 'toggleThread') {
      this.collapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
        type: 'toggleThread',
        graphIndex: action.graphIndex,
        threadRef: action.threadRef
      });
    } else {
      this.collapseRuntime = createTraceCollapseRuntimeState(this.buildCollapseRuntimeInputs());
    }

    return this.rebuildSnapshot(action.type, previousSnapshot, true)!;
  }

  /** Subscribes to semantic mounted-engine updates. */
  subscribe(listener: TraceEngineListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Returns the current immutable renderer snapshot. */
  getSnapshot(): TraceEngineSnapshot {
    return this.snapshot;
  }

  /** Returns currently active trace layouts consumed by renderers. */
  getActiveLayouts(): readonly TraceLayout[] {
    return this.snapshot.traceViewState.activeLayouts;
  }

  /** Returns currently prepared scene inputs consumed by renderers. */
  getPreparedScene(): TracePreparedScene {
    return this.snapshot.traceViewState.preparedScene;
  }

  /** Returns canonical mounted selected span refs. */
  getSelectedSpanRefs(): readonly SpanRef[] {
    return this.snapshot.selectedSpanRefs;
  }

  /** Returns display-oriented mounted selected span payloads. */
  getSelectedSpans(): readonly TraceSelectedSpan[] {
    return this.snapshot.selectedSpans;
  }

  /** Returns span refs currently driving temporary focused layouts. */
  getFocusedSelectionSpanRefs(): readonly SpanRef[] {
    return this.snapshot.traceViewState.focusedSelectionSpanRefs;
  }

  /** Returns serialized expanded process ids ready for durable host persistence. */
  getSerializedExpandedProcessIds(): readonly string[] {
    return this.snapshot.serializedExpandedProcessIds;
  }

  /** Returns cheap diagnostics, with retained-size estimation only when explicitly requested. */
  getDiagnostics(options: TraceEngineDiagnosticsOptions = {}): TraceEngineDiagnostics {
    const {traceGraphs, traceViewState} = this.snapshot;
    const retainedSizeEstimate = buildTraceEngineRetainedSizeEstimate({
      traceViewState,
      includeRetainedSizeEstimates: options.includeRetainedSizeEstimates === true
    });
    const graphStats = traceGraphs.reduce(
      (totals, traceGraph) => ({
        displayedProcessCount: totals.displayedProcessCount + traceGraph.stats.processCount,
        displayedThreadCount: totals.displayedThreadCount + traceGraph.stats.threadCount,
        displayedSpanCount: totals.displayedSpanCount + traceGraph.stats.spanCount,
        displayedLocalDependencyCount:
          totals.displayedLocalDependencyCount + traceGraph.stats.localDependencyCount,
        displayedCrossDependencyCount:
          totals.displayedCrossDependencyCount + traceGraph.stats.crossDependencyCount
      }),
      {
        displayedProcessCount: 0,
        displayedThreadCount: 0,
        displayedSpanCount: 0,
        displayedLocalDependencyCount: 0,
        displayedCrossDependencyCount: 0
      }
    );
    return {
      revision: this.revision,
      lastUpdateReason: this.lastUpdateReason,
      listenerCount: this.listeners.size,
      displayedGraphCount: traceGraphs.length,
      ...graphStats,
      selectedSpanCount: this.selection.selectedSpanRefs.length,
      focusedSpanCount: traceViewState.focusedSelectionSpanRefs.length,
      selectedLocalDependencyCount: this.selection.selectedLocalDependencyRefs.length,
      selectedCrossDependencyCount: this.selection.selectedCrossDependencyRefs.length,
      activeLayoutCount: traceViewState.activeLayouts.length,
      baseLayoutCount: traceViewState.baseLayouts.length,
      focusedLayoutCount: traceViewState.focusedLayouts?.length ?? 0,
      preparedForegroundSceneCount: traceViewState.preparedScene.foreground.length,
      preparedOverviewSceneCount: traceViewState.preparedScene.overview.length,
      preparedForegroundRowCount: countPreparedSceneRows(traceViewState.preparedScene.foreground),
      preparedForegroundSpanCount: countPreparedSceneSpans(traceViewState.preparedScene.foreground),
      preparedOverviewRowCount: countPreparedSceneRows(traceViewState.preparedScene.overview),
      preparedOverviewSpanCount: countPreparedSceneSpans(traceViewState.preparedScene.overview),
      buildPhaseTimings: traceViewState.buildPhaseTimings,
      traceEngineRetainedSizeBytes: retainedSizeEstimate?.sizes.traceViewStateSizeBytes ?? null,
      traceLayoutSizeBytes: retainedSizeEstimate?.sizes.traceLayoutSizeBytes ?? null,
      traceDeckInputsSizeBytes: retainedSizeEstimate?.sizes.traceDeckInputsSizeBytes ?? null,
      retainedSizeEstimateDurationMs: retainedSizeEstimate?.durationMs ?? null
    };
  }

  private syncCollapseRuntimeInputs(): void {
    this.collapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
      type: 'syncInputs',
      inputs: this.buildCollapseRuntimeInputs()
    });
  }

  private buildCollapseRuntimeInputs() {
    return {
      traceGraphs: this.getTraceGraphsForInputs(),
      primaryTraceGraph: this.inputs.traceGraph,
      defaultExpandProcess: this.inputs.defaultExpandProcess,
      defaultExpandedProcessIds: this.inputs.defaultExpandedProcessIds,
      defaultCollapsedProcessIds: this.inputs.defaultCollapsedProcessIds,
      selectedSpanRefs: this.selection.selectedSpanRefs,
      defaultSelectedSpanRefs: this.inputs.defaultSelectedSpanRefs,
      extendedSelectionSpanRefs:
        this.inputs.expandExtendedSelectionProcesses === false
          ? []
          : this.selection.extendedSelectionSpanRefs
    };
  }

  private getTraceGraphsForInputs(): readonly TraceGraph[] {
    return getTraceLayoutGraphs({
      traceGraph: this.inputs.traceGraph,
      secondaryTraceGraph: this.inputs.secondaryTraceGraph ?? undefined,
      processLayoutMode: this.inputs.settings.processLayoutMode
    });
  }

  private rebuildSnapshot(
    reason: TraceEngineUpdate['reason'],
    previousSnapshot: TraceEngineSnapshot | null,
    emit: boolean
  ): TraceEngineUpdate | null {
    const traceGraphs = this.getTraceGraphsForInputs();
    const collapseState = cloneTraceLayoutCollapseStateForGraphs(
      this.collapseRuntime.collapseState,
      traceGraphs
    );
    const {minTimeMs} = this.inputs.traceGraph.getTimeBounds();
    const shouldPrepareOverviewData = Boolean(this.inputs.settings.showOverview);
    const traceViewRenderInputs = buildTraceViewRenderInputs({
      traceGraph: this.inputs.traceGraph,
      traceGraphs,
      settings: this.inputs.settings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: this.inputs.layoutTopPadding ?? 0,
      layoutTimingKey: this.inputs.layoutTimingKey,
      minTimeMs,
      shouldPrepareOverviewData,
      initialViewportFitKey: getInitialViewportFitKey(traceGraphs),
      selectedSpanRefs: this.selection.selectedSpanRefs,
      extendedSelectionSpanRefs: this.selection.extendedSelectionSpanRefs,
      selectedLocalDependencyRefs:
        this.selection.selectedLocalDependencyRefs.length > 0
          ? new Set(this.selection.selectedLocalDependencyRefs)
          : undefined,
      selectedCrossDependencyRefs:
        this.selection.selectedCrossDependencyRefs.length > 0
          ? new Set(this.selection.selectedCrossDependencyRefs)
          : undefined,
      isExtendedSelection: this.selection.isExtendedSelection
    });
    const traceViewState = buildTraceViewState({
      previousState: this.traceViewState,
      baseLayoutKey: traceViewRenderInputs.traceViewBaseLayoutKey,
      traceGraphs,
      sourceTraceGraphs: traceGraphs,
      primaryTraceGraph: traceGraphs[0] ?? this.inputs.traceGraph,
      paths: this.inputs.paths,
      layoutSettings: traceViewRenderInputs.traceLayoutSettings,
      settings: this.inputs.settings,
      colorScheme: this.inputs.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME,
      collapseState,
      layoutTopPadding: this.inputs.layoutTopPadding,
      layoutTimingKey: this.inputs.layoutTimingKey,
      minTimeMs,
      buildMinimapLayouts: shouldPrepareOverviewData,
      focusedSelectionSpanRefs: traceViewRenderInputs.focusedSelectionSpanRefs,
      showCollapsedActivitySummary: this.inputs.showCollapsedActivitySummary ?? false,
      collapsedActivityAggregation: this.inputs.collapsedActivityAggregation,
      isOverviewEnabled: shouldPrepareOverviewData,
      getTraceModelMatrixForGraph: graphIndex =>
        graphIndex === 1
          ? createTraceComparisonModelMatrix(
              this.inputs.settings.traceOffsetMs,
              this.inputs.settings.traceScale
            )
          : undefined
    });
    this.traceViewState = traceViewState;
    const prunedTraceViewState = this.pruneThreadCollapseState(traceGraphs, traceViewState);
    this.traceViewState = prunedTraceViewState;
    this.revision += 1;
    this.lastUpdateReason = reason;
    this.snapshot = {
      revision: this.revision,
      traceGraph: this.inputs.traceGraph,
      secondaryTraceGraph: this.inputs.secondaryTraceGraph ?? undefined,
      traceGraphs,
      primaryTraceGraph: traceGraphs[0] ?? this.inputs.traceGraph,
      traceStyle: this.inputs.traceStyle,
      settings: this.inputs.settings,
      colorScheme: this.inputs.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME,
      paths: this.inputs.paths,
      selectedSpanRefs: this.selection.selectedSpanRefs,
      selectedSpans: buildTraceSelectedSpans(
        traceGraphs[0] ?? this.inputs.traceGraph,
        this.selection.selectedSpanRefs
      ),
      extendedSelectionSpanRefs: this.selection.extendedSelectionSpanRefs,
      extendedSelectionMode: this.inputs.extendedSelectionMode ?? 'none',
      highlightedSpanRefs: this.inputs.highlightedSpanRefs,
      selectedLocalDependencyRefs:
        this.selection.selectedLocalDependencyRefs.length > 0
          ? new Set(this.selection.selectedLocalDependencyRefs)
          : undefined,
      selectedCrossDependencyRefs:
        this.selection.selectedCrossDependencyRefs.length > 0
          ? new Set(this.selection.selectedCrossDependencyRefs)
          : undefined,
      selectedLocalDependencyDirectionByRef: this.selection.selectedLocalDependencyDirectionByRef,
      selectedCrossDependencyDirectionByRef: this.selection.selectedCrossDependencyDirectionByRef,
      collapseState: this.collapseRuntime.collapseState,
      serializedExpandedProcessIds: this.collapseRuntime.serializedExpandedProcessIds,
      layoutTimingKey: this.inputs.layoutTimingKey,
      layoutTopPadding: this.inputs.layoutTopPadding ?? 0,
      showCollapsedActivitySummary: this.inputs.showCollapsedActivitySummary ?? false,
      collapsedActivityAggregation: this.inputs.collapsedActivityAggregation,
      isOverviewEnabled: isTraceEngineOverviewEnabled(this.inputs.settings, this.selection),
      shouldPrepareOverviewData,
      traceViewState: prunedTraceViewState
    };
    const update = buildTraceEngineUpdate(reason, previousSnapshot, this.snapshot);
    if (emit) {
      this.listeners.forEach(listener => listener(update));
    }
    return update;
  }

  private pruneThreadCollapseState(
    traceGraphs: readonly TraceGraph[],
    traceViewState: TraceViewState
  ): TraceViewState {
    const pruneRequest = traceViewState.threadCollapsePruneRequest;
    if (!pruneRequest) {
      return traceViewState;
    }
    const nextCollapseRuntime = reduceTraceCollapseRuntimeState(this.collapseRuntime, {
      type: 'pruneThreads',
      validThreadRefsByGraph: pruneRequest.validThreadRefsByGraph
    });
    if (nextCollapseRuntime === this.collapseRuntime) {
      return traceViewState;
    }
    this.collapseRuntime = nextCollapseRuntime;
    const collapseState = cloneTraceLayoutCollapseStateForGraphs(
      this.collapseRuntime.collapseState,
      traceGraphs
    );
    const {minTimeMs} = this.inputs.traceGraph.getTimeBounds();
    const traceViewRenderInputs = buildTraceViewRenderInputs({
      traceGraph: this.inputs.traceGraph,
      traceGraphs,
      settings: this.inputs.settings,
      collapseStateForLayout: collapseState,
      layoutTopPadding: this.inputs.layoutTopPadding ?? 0,
      layoutTimingKey: this.inputs.layoutTimingKey,
      minTimeMs,
      shouldPrepareOverviewData: Boolean(this.inputs.settings.showOverview),
      initialViewportFitKey: getInitialViewportFitKey(traceGraphs),
      selectedSpanRefs: this.selection.selectedSpanRefs,
      extendedSelectionSpanRefs: this.selection.extendedSelectionSpanRefs,
      selectedLocalDependencyRefs:
        this.selection.selectedLocalDependencyRefs.length > 0
          ? new Set(this.selection.selectedLocalDependencyRefs)
          : undefined,
      selectedCrossDependencyRefs:
        this.selection.selectedCrossDependencyRefs.length > 0
          ? new Set(this.selection.selectedCrossDependencyRefs)
          : undefined,
      isExtendedSelection: this.selection.isExtendedSelection
    });
    return buildTraceViewState({
      previousState: traceViewState,
      baseLayoutKey: traceViewRenderInputs.traceViewBaseLayoutKey,
      traceGraphs,
      sourceTraceGraphs: traceGraphs,
      primaryTraceGraph: traceGraphs[0] ?? this.inputs.traceGraph,
      paths: this.inputs.paths,
      layoutSettings: traceViewRenderInputs.traceLayoutSettings,
      settings: this.inputs.settings,
      colorScheme: this.inputs.colorScheme ?? DEFAULT_TRACE_COLOR_SCHEME,
      collapseState,
      layoutTopPadding: this.inputs.layoutTopPadding,
      layoutTimingKey: this.inputs.layoutTimingKey,
      minTimeMs,
      buildMinimapLayouts: Boolean(this.inputs.settings.showOverview),
      focusedSelectionSpanRefs: traceViewRenderInputs.focusedSelectionSpanRefs,
      showCollapsedActivitySummary: this.inputs.showCollapsedActivitySummary ?? false,
      collapsedActivityAggregation: this.inputs.collapsedActivityAggregation,
      isOverviewEnabled: isTraceEngineOverviewEnabled(this.inputs.settings, this.selection),
      getTraceModelMatrixForGraph: graphIndex =>
        graphIndex === 1
          ? createTraceComparisonModelMatrix(
              this.inputs.settings.traceOffsetMs,
              this.inputs.settings.traceScale
            )
          : undefined
    });
  }
}

/** On-demand retained-size estimate returned by TraceEngine diagnostics. */
type TraceEngineRetainedSizeEstimate = {
  /** On-demand retained-size estimate for current engine render outputs. */
  readonly sizes: ReturnType<typeof estimateTraceViewStateRetainedSize>;
  /** Time spent producing the on-demand retained-size estimate. */
  readonly durationMs: number;
};

/** Runs TraceEngine retained-size estimation only for explicit diagnostic requests. */
function buildTraceEngineRetainedSizeEstimate(params: {
  /** Current prepared TraceViewState owned by the engine. */
  traceViewState: TraceViewState;
  /** Whether this diagnostic read explicitly requested retained-size estimates. */
  includeRetainedSizeEstimates: boolean;
}): TraceEngineRetainedSizeEstimate | null {
  if (!params.includeRetainedSizeEstimates) {
    return null;
  }
  const estimateStartTime = performance.now();
  const sizes = estimateTraceViewStateRetainedSize(params.traceViewState);
  return {
    sizes,
    durationMs: performance.now() - estimateStartTime
  };
}

/** Counts prepared process rows retained across one prepared scene collection. */
function countPreparedSceneRows(scenes: readonly TracePreparedGraphScene[]): number {
  return scenes.reduce((rowCount, scene) => rowCount + scene.rows.length, 0);
}

/** Counts prepared span refs retained across one prepared scene collection. */
function countPreparedSceneSpans(scenes: readonly TracePreparedGraphScene[]): number {
  return scenes.reduce(
    (spanCount, scene) =>
      spanCount + scene.rows.reduce((rowSpanCount, row) => rowSpanCount + row.spans.length, 0),
    0
  );
}

/** Normalizes optional TraceEngine inputs into stable mounted-engine defaults. */
function normalizeTraceEngineInputs(inputs: TraceEngineInputs): TraceEngineInputs {
  return {
    ...inputs,
    secondaryTraceGraph: inputs.secondaryTraceGraph ?? undefined,
    selectedSpanRefs: inputs.selectedSpanRefs ?? [],
    selectionPolicy: inputs.selectionPolicy ?? {type: 'raw'},
    extendedSelectionMode: inputs.extendedSelectionMode ?? 'none',
    defaultExpandedProcessIds: inputs.defaultExpandedProcessIds ?? [],
    defaultCollapsedProcessIds: inputs.defaultCollapsedProcessIds ?? [],
    defaultSelectedSpanRefs: inputs.defaultSelectedSpanRefs ?? [],
    expandExtendedSelectionProcesses: inputs.expandExtendedSelectionProcesses ?? true,
    showCollapsedActivitySummary: inputs.showCollapsedActivitySummary ?? false,
    layoutTopPadding: inputs.layoutTopPadding ?? 0
  };
}

/** Builds the exact selected-span and dependency state retained by TraceEngine. */
function buildTraceEngineSelectionState(params: {
  /** Current normalized engine inputs owning selected-graph context. */
  inputs: TraceEngineInputs;
  /** Explicit selected span refs before dependency-chain expansion. */
  selectedSpanRefs: readonly SpanRef[];
  /** Optional visible local dependency refs selected by the caller. */
  selectedLocalDependencyRefs?: readonly VisibleLocalDependencyRef[];
  /** Optional visible cross dependency refs selected by the caller. */
  selectedCrossDependencyRefs?: readonly VisibleCrossDependencyRef[];
  /** Optional local dependency directions selected by the caller. */
  selectedLocalDependencyDirectionByRef?: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Optional cross dependency directions selected by the caller. */
  selectedCrossDependencyDirectionByRef?: ReadonlyMap<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Whether the caller is building a temporary focused selection layout. */
  isExtendedSelection: boolean;
}): TraceEngineSelectionState {
  const selectedSpanRefs = [...new Set(params.selectedSpanRefs)];
  if (selectedSpanRefs.length === 0) {
    return createEmptyTraceEngineSelectionState();
  }
  const primarySpanRef = selectedSpanRefs[0];
  const selectedLocalDependencyRefs = [...(params.selectedLocalDependencyRefs ?? [])];
  const selectedCrossDependencyRefs = [...(params.selectedCrossDependencyRefs ?? [])];
  const selectionPolicy = params.inputs.selectionPolicy ?? {type: 'raw'};
  if (selectionPolicy.type === 'immediate-visible-dependencies') {
    const immediateDependencyRefs = getImmediateVisibleDependencyRefsForSpan(
      params.inputs.traceGraph,
      primarySpanRef
    );
    const selectedLocalDependencyRefsWithImmediate = dedupeRefs([
      ...immediateDependencyRefs.localDependencyRefs,
      ...selectedLocalDependencyRefs
    ]);
    const selectedCrossDependencyRefsWithImmediate = dedupeRefs([
      ...immediateDependencyRefs.crossDependencyRefs,
      ...selectedCrossDependencyRefs
    ]);
    const dependencyDirections = mergeTraceSelectedDependencyDirectionMaps(
      buildTraceSelectedDependencyDirectionMaps({
        incomingLocalDependencyRefs: immediateDependencyRefs.incomingLocalDependencyRefs,
        incomingCrossDependencyRefs: immediateDependencyRefs.incomingCrossDependencyRefs,
        outgoingLocalDependencyRefs: immediateDependencyRefs.outgoingLocalDependencyRefs,
        outgoingCrossDependencyRefs: immediateDependencyRefs.outgoingCrossDependencyRefs
      }),
      params.selectedLocalDependencyDirectionByRef,
      params.selectedCrossDependencyDirectionByRef
    );
    return {
      selectedSpanRefs,
      extendedSelectionSpanRefs: [],
      selectedLocalDependencyRefs: selectedLocalDependencyRefsWithImmediate,
      selectedCrossDependencyRefs: selectedCrossDependencyRefsWithImmediate,
      selectedLocalDependencyDirectionByRef: dependencyDirections.localDependencyDirectionByRef,
      selectedCrossDependencyDirectionByRef: dependencyDirections.crossDependencyDirectionByRef,
      isExtendedSelection: params.isExtendedSelection
    };
  }
  if (selectionPolicy.type === 'dependency-chain') {
    const dependencySelection = params.inputs.traceGraph.getTraceSpanDependencySelection(
      primarySpanRef,
      {
        keywords: new Set(selectionPolicy.keywords ?? [])
      }
    );
    const dependencySelectionHasRefs =
      dependencySelection.visibleLocalDependencyRefs.length > 0 ||
      dependencySelection.visibleCrossDependencyRefs.length > 0;
    const dependencyDirections = mergeTraceSelectedDependencyDirectionMaps(
      dependencySelectionHasRefs
        ? buildTraceSelectedDependencyDirectionMaps({
            incomingLocalDependencyRefs: dependencySelection.parentLocalDependencyRefs,
            incomingCrossDependencyRefs: dependencySelection.parentCrossDependencyRefs,
            outgoingLocalDependencyRefs: dependencySelection.childLocalDependencyRefs,
            outgoingCrossDependencyRefs: dependencySelection.childCrossDependencyRefs
          })
        : buildTraceSelectedDependencyDirectionMaps({
            incomingLocalDependencyRefs: selectedLocalDependencyRefs,
            incomingCrossDependencyRefs: selectedCrossDependencyRefs
          }),
      params.selectedLocalDependencyDirectionByRef,
      params.selectedCrossDependencyDirectionByRef
    );
    return {
      selectedSpanRefs,
      extendedSelectionSpanRefs: params.isExtendedSelection
        ? dependencySelection.spanRefs.filter(spanRef => !selectedSpanRefs.includes(spanRef))
        : [],
      selectedLocalDependencyRefs: dependencySelectionHasRefs
        ? dependencySelection.visibleLocalDependencyRefs
        : selectedLocalDependencyRefs,
      selectedCrossDependencyRefs: dependencySelectionHasRefs
        ? dependencySelection.visibleCrossDependencyRefs
        : selectedCrossDependencyRefs,
      selectedLocalDependencyDirectionByRef: dependencyDirections.localDependencyDirectionByRef,
      selectedCrossDependencyDirectionByRef: dependencyDirections.crossDependencyDirectionByRef,
      isExtendedSelection: params.isExtendedSelection
    };
  }
  const dependencyDirections = mergeTraceSelectedDependencyDirectionMaps(
    buildTraceSelectedDependencyDirectionMaps({
      incomingLocalDependencyRefs: selectedLocalDependencyRefs,
      incomingCrossDependencyRefs: selectedCrossDependencyRefs
    }),
    params.selectedLocalDependencyDirectionByRef,
    params.selectedCrossDependencyDirectionByRef
  );
  return {
    selectedSpanRefs,
    extendedSelectionSpanRefs: [],
    selectedLocalDependencyRefs,
    selectedCrossDependencyRefs,
    selectedLocalDependencyDirectionByRef: dependencyDirections.localDependencyDirectionByRef,
    selectedCrossDependencyDirectionByRef: dependencyDirections.crossDependencyDirectionByRef,
    isExtendedSelection: params.isExtendedSelection
  };
}

/** Builds the empty TraceEngine selection state used after clear/reset actions. */
function createEmptyTraceEngineSelectionState(): TraceEngineSelectionState {
  return {
    selectedSpanRefs: [],
    extendedSelectionSpanRefs: [],
    selectedLocalDependencyRefs: [],
    selectedCrossDependencyRefs: [],
    selectedLocalDependencyDirectionByRef: new Map(),
    selectedCrossDependencyDirectionByRef: new Map(),
    isExtendedSelection: false
  };
}

/** Returns one insertion-ordered dependency-ref list without duplicates. */
function dedupeRefs<TRef>(refs: readonly TRef[]): TRef[] {
  return [...new Set(refs)];
}

/** Overlays caller-supplied selected dependency directions on computed policy directions. */
function mergeTraceSelectedDependencyDirectionMaps(
  baseDirections: ReturnType<typeof buildTraceSelectedDependencyDirectionMaps>,
  selectedLocalDependencyDirectionByRef:
    | ReadonlyMap<VisibleLocalDependencyRef, TraceSelectedDependencyDirection>
    | undefined,
  selectedCrossDependencyDirectionByRef:
    | ReadonlyMap<VisibleCrossDependencyRef, TraceSelectedDependencyDirection>
    | undefined
): ReturnType<typeof buildTraceSelectedDependencyDirectionMaps> {
  if (!selectedLocalDependencyDirectionByRef && !selectedCrossDependencyDirectionByRef) {
    return baseDirections;
  }
  return {
    localDependencyDirectionByRef: new Map([
      ...baseDirections.localDependencyDirectionByRef,
      ...(selectedLocalDependencyDirectionByRef ?? [])
    ]),
    crossDependencyDirectionByRef: new Map([
      ...baseDirections.crossDependencyDirectionByRef,
      ...(selectedCrossDependencyDirectionByRef ?? [])
    ])
  };
}

/** Returns whether the current mounted selection should leave the overview visible. */
function isTraceEngineOverviewEnabled(
  settings: TraceVisSettings,
  selection: TraceEngineSelectionState
): boolean {
  return (
    settings.showOverview &&
    !selection.isExtendedSelection &&
    !(settings.selectHidesMinimap === true && selection.selectedSpanRefs.length > 0)
  );
}

/** Materializes selected span card rows for the supplied exact span refs. */
function buildTraceSelectedSpans(
  traceGraph: Readonly<TraceGraph>,
  selectedSpanRefs: readonly SpanRef[]
): readonly TraceSelectedSpan[] {
  return selectedSpanRefs.flatMap(spanRef => {
    const span = getTraceSelectedSpanFromRef(traceGraph, spanRef);
    return span ? [{spanRef, span}] : [];
  });
}

/** Builds one immutable TraceEngine update payload from snapshot transitions. */
function buildTraceEngineUpdate(
  reason: TraceEngineUpdate['reason'],
  previousSnapshot: TraceEngineSnapshot | null,
  nextSnapshot: TraceEngineSnapshot
): TraceEngineUpdate {
  const isSelectionAction =
    reason === 'selectSpan' || reason === 'setSelection' || reason === 'clearSelection';
  return {
    revision: nextSnapshot.revision,
    reason,
    selectionChanged:
      isSelectionAction ||
      previousSnapshot == null ||
      !areScalarArraysEqual(previousSnapshot.selectedSpanRefs, nextSnapshot.selectedSpanRefs) ||
      !areScalarArraysEqual(
        [...(previousSnapshot.selectedLocalDependencyRefs ?? [])],
        [...(nextSnapshot.selectedLocalDependencyRefs ?? [])]
      ) ||
      !areScalarArraysEqual(
        [...(previousSnapshot.selectedCrossDependencyRefs ?? [])],
        [...(nextSnapshot.selectedCrossDependencyRefs ?? [])]
      ) ||
      !areScalarArraysEqual(
        previousSnapshot.traceViewState.focusedSelectionSpanRefs,
        nextSnapshot.traceViewState.focusedSelectionSpanRefs
      ),
    expandedProcessIdsChanged:
      previousSnapshot == null ||
      !areScalarArraysEqual(
        previousSnapshot.serializedExpandedProcessIds,
        nextSnapshot.serializedExpandedProcessIds
      ),
    selectedSpanRefs: nextSnapshot.selectedSpanRefs,
    selectedSpans: nextSnapshot.selectedSpans,
    selectedLocalDependencyRefs: [...(nextSnapshot.selectedLocalDependencyRefs ?? [])],
    selectedCrossDependencyRefs: [...(nextSnapshot.selectedCrossDependencyRefs ?? [])],
    isExtendedSelection: nextSnapshot.traceViewState.focusedSelectionSpanRefs.length > 0,
    serializedExpandedProcessIds: nextSnapshot.serializedExpandedProcessIds
  };
}

/** Returns whether two normalized TraceEngine input bundles are semantically equal. */
function areTraceEngineInputsEqual(left: TraceEngineInputs, right: TraceEngineInputs): boolean {
  return (
    left.traceGraph === right.traceGraph &&
    left.secondaryTraceGraph === right.secondaryTraceGraph &&
    left.traceStyle === right.traceStyle &&
    left.paths === right.paths &&
    left.settings === right.settings &&
    left.colorScheme === right.colorScheme &&
    left.highlightedSpanRefs === right.highlightedSpanRefs &&
    areScalarArraysEqual(left.selectedSpanRefs ?? [], right.selectedSpanRefs ?? []) &&
    areTraceEngineSelectionPoliciesEqual(left.selectionPolicy, right.selectionPolicy) &&
    left.focusSelectedSpanRefs === right.focusSelectedSpanRefs &&
    left.extendedSelectionMode === right.extendedSelectionMode &&
    left.defaultExpandProcess === right.defaultExpandProcess &&
    areScalarArraysEqual(
      left.defaultExpandedProcessIds ?? [],
      right.defaultExpandedProcessIds ?? []
    ) &&
    areScalarArraysEqual(
      left.defaultCollapsedProcessIds ?? [],
      right.defaultCollapsedProcessIds ?? []
    ) &&
    areScalarArraysEqual(left.defaultSelectedSpanRefs ?? [], right.defaultSelectedSpanRefs ?? []) &&
    left.expandExtendedSelectionProcesses === right.expandExtendedSelectionProcesses &&
    left.showCollapsedActivitySummary === right.showCollapsedActivitySummary &&
    left.collapsedActivityAggregation === right.collapsedActivityAggregation &&
    left.layoutTimingKey === right.layoutTimingKey &&
    left.layoutTopPadding === right.layoutTopPadding
  );
}

/** Returns whether two TraceEngine selection policies select the same behavior. */
function areTraceEngineSelectionPoliciesEqual(
  left: TraceEngineSelectionPolicy | undefined,
  right: TraceEngineSelectionPolicy | undefined
): boolean {
  const normalizedLeft = left ?? {type: 'raw' as const};
  const normalizedRight = right ?? {type: 'raw' as const};
  return (
    normalizedLeft.type === normalizedRight.type &&
    (normalizedLeft.type !== 'dependency-chain' ||
      (normalizedRight.type === 'dependency-chain' &&
        areScalarArraysEqual(normalizedLeft.keywords ?? [], normalizedRight.keywords ?? [])))
  );
}

/** Returns whether two scalar arrays contain the same values in the same order. */
function areScalarArraysEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  if (left === right) {
    return true;
  }
  return (
    left.length === right.length && left.every((value, valueIndex) => value === right[valueIndex])
  );
}

/** Builds the graph identity key used for first-fit viewport invalidation. */
function getInitialViewportFitKey(traceGraphs: readonly TraceGraph[]): string {
  return traceGraphs
    .map(traceGraph => `${traceGraph.name}\u0000${traceGraph.minTimeMs}`)
    .join('\u0001');
}
