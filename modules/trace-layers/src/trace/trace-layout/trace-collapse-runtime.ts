import {
  buildInitialTraceLayoutCollapseState,
  getExpandedProcessIdsFromCollapseState
} from './trace-collapse-resolution';
import {
  areTraceLayoutCollapseStatesEqual,
  expandSelectedSpanProcessRefs,
  pruneTraceLayoutCollapseStateForGraphs,
  pruneTraceLayoutThreadCollapseStateForLaneRefs,
  selectTraceLayoutCollapseStateUpdate,
  setAllTraceProcessesExpanded,
  toggleTraceProcessCollapse,
  toggleTraceThreadCollapse
} from './trace-collapse-state';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';
import type {TraceProcessExpansionOverrides} from './trace-collapse-state';
import type {TraceLayoutCollapseState} from './trace-layout';

/** Internal inputs used by TraceEngine to resolve ref-native collapse state. */
export type TraceCollapseRuntimeInputs = {
  /** Trace graphs aligned by layout graph index. */
  readonly traceGraphs: readonly TraceGraph[];
  /** Primary graph that owns current/default selected span refs. */
  readonly primaryTraceGraph?: TraceGraph | null;
  /** Whether process rows should expand by default when no explicit override exists. */
  readonly defaultExpandProcess: boolean;
  /** Serialized process ids that should start expanded at the persistence boundary. */
  readonly defaultExpandedProcessIds?: readonly string[];
  /** Serialized process ids that should start collapsed at the persistence boundary. */
  readonly defaultCollapsedProcessIds?: readonly string[];
  /** Current controlled selected span refs. */
  readonly selectedSpanRefs?: readonly SpanRef[];
  /** Startup selected span refs used when there is no current selection. */
  readonly defaultSelectedSpanRefs?: readonly SpanRef[];
  /** Extended-selection span refs whose owning processes should expand on selection changes. */
  readonly extendedSelectionSpanRefs?: readonly SpanRef[];
};

/** Internal collapse state owned by TraceEngine below DeckTraceGraph. */
export type TraceCollapseRuntimeState = {
  /** Ref-native layout collapse state consumed by trace layout builders. */
  readonly collapseState: TraceLayoutCollapseState;
  /** Explicit process expansion overrides that survive default-setting changes. */
  readonly processExpansionOverrides: TraceProcessExpansionOverrides;
  /** Stable key for the selected span refs already applied as expansion overrides. */
  readonly selectedExpansionSpanRefsKey: string | null;
  /** Serialized expanded process ids ready for store or URL persistence. */
  readonly serializedExpandedProcessIds: readonly string[];
};

/** Internal reducer action for the pure TraceEngine collapse runtime. */
export type TraceCollapseRuntimeAction =
  | {
      /** Re-resolves collapse state from current graph/default/selection inputs. */
      readonly type: 'syncInputs';
      /** Inputs used to recompute graph-aligned collapse state. */
      readonly inputs: TraceCollapseRuntimeInputs;
    }
  | {
      /** Expands or collapses all process rows. */
      readonly type: 'setAllProcessesExpanded';
      /** Trace graphs aligned by layout graph index. */
      readonly traceGraphs: readonly TraceGraph[];
      /** Whether every process row should be expanded. */
      readonly expand: boolean;
    }
  | {
      /** Toggles one process collapse row. */
      readonly type: 'toggleProcess';
      /** Trace graphs aligned by layout graph index. */
      readonly traceGraphs: readonly TraceGraph[];
      /** Graph index that owns `processRef`. */
      readonly graphIndex: number;
      /** Graph-local process ref to toggle. */
      readonly processRef: ProcessRef;
    }
  | {
      /** Toggles one thread lane-collapse override. */
      readonly type: 'toggleThread';
      /** Graph index that owns `threadRef`. */
      readonly graphIndex: number;
      /** Graph-local thread ref to toggle. */
      readonly threadRef: ThreadRef;
    }
  | {
      /** Prunes thread overrides to currently visible lane-control rows. */
      readonly type: 'pruneThreads';
      /** Graph-indexed thread refs that should keep lane-collapse overrides. */
      readonly validThreadRefsByGraph: readonly ReadonlySet<ThreadRef>[];
    };

/** Creates the initial pure collapse runtime from graph/default/selection inputs. */
export function createTraceCollapseRuntimeState(
  inputs: TraceCollapseRuntimeInputs
): TraceCollapseRuntimeState {
  return syncTraceCollapseRuntimeInputs(
    {
      collapseState: {graphs: []},
      processExpansionOverrides: new Map(),
      selectedExpansionSpanRefsKey: null,
      serializedExpandedProcessIds: []
    },
    inputs
  );
}

/** Applies one reducer action to the pure collapse runtime. */
export function reduceTraceCollapseRuntimeState(
  previous: TraceCollapseRuntimeState,
  action: TraceCollapseRuntimeAction
): TraceCollapseRuntimeState {
  if (action.type === 'syncInputs') {
    return syncTraceCollapseRuntimeInputs(previous, action.inputs);
  }

  if (action.type === 'setAllProcessesExpanded') {
    const mutableOverrides = cloneTraceProcessExpansionOverrides(
      previous.processExpansionOverrides
    );
    const nextCollapseState = setAllTraceProcessesExpanded({
      collapseState: previous.collapseState,
      traceGraphs: action.traceGraphs,
      expand: action.expand,
      processExpansionOverrides: mutableOverrides
    });
    const nextOverrides = selectTraceProcessExpansionOverridesUpdate(
      previous.processExpansionOverrides,
      mutableOverrides
    );
    return buildTraceCollapseRuntimeStateUpdate({
      previous,
      traceGraphs: action.traceGraphs,
      collapseState: nextCollapseState,
      processExpansionOverrides: nextOverrides
    });
  }

  return reduceTraceCollapseRuntimeNonSyncAction(previous, action);
}

function reduceTraceCollapseRuntimeNonSyncAction(
  previous: TraceCollapseRuntimeState,
  action: Exclude<
    TraceCollapseRuntimeAction,
    {readonly type: 'syncInputs' | 'setAllProcessesExpanded'}
  >
): TraceCollapseRuntimeState {
  if (action.type === 'toggleProcess') {
    const graph = action.traceGraphs[action.graphIndex] ?? action.traceGraphs[0];
    if (!graph) {
      return previous;
    }
    const mutableOverrides = cloneTraceProcessExpansionOverrides(
      previous.processExpansionOverrides
    );
    const nextCollapseState = toggleTraceProcessCollapse({
      collapseState: previous.collapseState,
      graphIndex: action.graphIndex,
      graph,
      processRef: action.processRef,
      processExpansionOverrides: mutableOverrides
    });
    return buildTraceCollapseRuntimeStateUpdate({
      previous,
      traceGraphs: action.traceGraphs,
      collapseState: nextCollapseState,
      processExpansionOverrides: mutableOverrides
    });
  }

  if (action.type === 'toggleThread') {
    const nextCollapseState = toggleTraceThreadCollapse({
      collapseState: previous.collapseState,
      graphIndex: action.graphIndex,
      threadRef: action.threadRef
    });
    return buildTraceCollapseRuntimeStateUpdate({
      previous,
      traceGraphs: [],
      collapseState: nextCollapseState,
      processExpansionOverrides: previous.processExpansionOverrides
    });
  }

  const nextCollapseState = pruneTraceLayoutThreadCollapseStateForLaneRefs({
    collapseState: previous.collapseState,
    validThreadRefsByGraph: action.validThreadRefsByGraph
  });
  return buildTraceCollapseRuntimeStateUpdate({
    previous,
    traceGraphs: [],
    collapseState: nextCollapseState,
    processExpansionOverrides: previous.processExpansionOverrides
  });
}

function syncTraceCollapseRuntimeInputs(
  previous: TraceCollapseRuntimeState,
  inputs: TraceCollapseRuntimeInputs
): TraceCollapseRuntimeState {
  const prunedOverrides = selectTraceProcessExpansionOverridesUpdate(
    previous.processExpansionOverrides,
    pruneTraceProcessExpansionOverridesForGraphs(
      previous.processExpansionOverrides,
      inputs.traceGraphs
    )
  );
  const selectedDefaultExpandedProcessRefs = getSelectedDefaultExpandedProcessRefs(inputs);
  const initialCollapseState = buildInitialTraceLayoutCollapseState({
    traceGraphs: inputs.traceGraphs,
    defaultExpandProcess: inputs.defaultExpandProcess,
    defaultExpandedProcessIds: inputs.defaultExpandedProcessIds,
    defaultCollapsedProcessIds: inputs.defaultCollapsedProcessIds,
    selectedDefaultExpandedProcessRefs,
    processExpansionOverrides: prunedOverrides
  });
  let nextCollapseState = selectTraceLayoutCollapseStateUpdate(
    previous.collapseState,
    initialCollapseState
  );
  nextCollapseState = selectTraceLayoutCollapseStateUpdate(
    nextCollapseState,
    pruneTraceLayoutCollapseStateForGraphs({
      collapseState: nextCollapseState,
      traceGraphs: inputs.traceGraphs
    })
  );

  const selectedExpansionSpanRefs = [
    ...(inputs.selectedSpanRefs ?? []),
    ...(inputs.extendedSelectionSpanRefs ?? [])
  ];
  const selectedExpansionSpanRefsKey = getSpanRefsKey(selectedExpansionSpanRefs);
  const mutableOverrides = cloneTraceProcessExpansionOverrides(prunedOverrides);
  let nextSelectedExpansionSpanRefsKey = previous.selectedExpansionSpanRefsKey;
  if (selectedExpansionSpanRefs.length === 0) {
    nextSelectedExpansionSpanRefsKey = null;
  } else if (
    inputs.primaryTraceGraph &&
    previous.selectedExpansionSpanRefsKey !== selectedExpansionSpanRefsKey
  ) {
    nextSelectedExpansionSpanRefsKey = selectedExpansionSpanRefsKey;
    nextCollapseState = selectTraceLayoutCollapseStateUpdate(
      nextCollapseState,
      expandSelectedSpanProcessRefs({
        collapseState: nextCollapseState,
        traceGraph: inputs.primaryTraceGraph,
        spanRefs: selectedExpansionSpanRefs,
        processExpansionOverrides: mutableOverrides
      })
    );
  }

  const nextOverrides = selectTraceProcessExpansionOverridesUpdate(
    prunedOverrides,
    mutableOverrides
  );
  return buildTraceCollapseRuntimeStateUpdate({
    previous,
    traceGraphs: inputs.traceGraphs,
    collapseState: nextCollapseState,
    processExpansionOverrides: nextOverrides,
    selectedExpansionSpanRefsKey: nextSelectedExpansionSpanRefsKey
  });
}

function buildTraceCollapseRuntimeStateUpdate(params: {
  previous: TraceCollapseRuntimeState;
  traceGraphs: readonly TraceGraph[];
  collapseState: TraceLayoutCollapseState;
  processExpansionOverrides: TraceProcessExpansionOverrides;
  selectedExpansionSpanRefsKey?: string | null;
}): TraceCollapseRuntimeState {
  const serializedExpandedProcessIds =
    params.traceGraphs.length > 0
      ? dedupeScalarArray(
          getExpandedProcessIdsFromCollapseState({
            traceGraphs: params.traceGraphs,
            collapseState: params.collapseState
          })
        )
      : params.previous.serializedExpandedProcessIds;
  const selectedExpansionSpanRefsKey =
    params.selectedExpansionSpanRefsKey === undefined
      ? params.previous.selectedExpansionSpanRefsKey
      : params.selectedExpansionSpanRefsKey;
  if (
    areTraceLayoutCollapseStatesEqual(params.previous.collapseState, params.collapseState) &&
    params.previous.processExpansionOverrides === params.processExpansionOverrides &&
    params.previous.selectedExpansionSpanRefsKey === selectedExpansionSpanRefsKey &&
    areScalarArraysEqual(params.previous.serializedExpandedProcessIds, serializedExpandedProcessIds)
  ) {
    return params.previous;
  }
  return {
    collapseState: params.collapseState,
    processExpansionOverrides: params.processExpansionOverrides,
    selectedExpansionSpanRefsKey,
    serializedExpandedProcessIds
  };
}

function getSelectedDefaultExpandedProcessRefs(
  inputs: TraceCollapseRuntimeInputs
): ReadonlyMap<number, ReadonlySet<ProcessRef>> {
  const expandedProcessRefsByGraph = new Map<number, Set<ProcessRef>>();
  if (!inputs.primaryTraceGraph) {
    return expandedProcessRefsByGraph;
  }
  const defaultExpansionSpanRefs =
    (inputs.selectedSpanRefs?.length ?? 0) > 0
      ? (inputs.selectedSpanRefs ?? [])
      : (inputs.defaultSelectedSpanRefs ?? []);
  for (const spanRef of defaultExpansionSpanRefs) {
    const processRef = inputs.primaryTraceGraph.getProcessRefBySpanRef(spanRef);
    if (processRef != null) {
      const expandedProcessRefs = expandedProcessRefsByGraph.get(0) ?? new Set<ProcessRef>();
      expandedProcessRefs.add(processRef);
      expandedProcessRefsByGraph.set(0, expandedProcessRefs);
    }
  }
  return expandedProcessRefsByGraph;
}

function cloneTraceProcessExpansionOverrides(
  overrides: TraceProcessExpansionOverrides
): Map<TraceGraph, Map<ProcessRef, boolean>> {
  return new Map([...overrides].map(([graph, graphOverrides]) => [graph, new Map(graphOverrides)]));
}

function pruneTraceProcessExpansionOverridesForGraphs(
  overrides: TraceProcessExpansionOverrides,
  traceGraphs: readonly TraceGraph[]
): TraceProcessExpansionOverrides {
  const currentGraphSet = new Set(traceGraphs);
  const nextOverrides = new Map<TraceGraph, Map<ProcessRef, boolean>>();
  for (const [graph, graphOverrides] of overrides) {
    if (!currentGraphSet.has(graph)) {
      continue;
    }
    const processRefs = new Set(graph.getProcessRefs());
    const nextGraphOverrides = new Map<ProcessRef, boolean>();
    for (const [processRef, isExpanded] of graphOverrides) {
      if (processRefs.has(processRef)) {
        nextGraphOverrides.set(processRef, isExpanded);
      }
    }
    if (nextGraphOverrides.size > 0) {
      nextOverrides.set(graph, nextGraphOverrides);
    }
  }
  return nextOverrides;
}

function selectTraceProcessExpansionOverridesUpdate(
  previous: TraceProcessExpansionOverrides,
  next: TraceProcessExpansionOverrides
): TraceProcessExpansionOverrides {
  if (previous.size !== next.size) {
    return next;
  }
  for (const [graph, previousGraphOverrides] of previous) {
    const nextGraphOverrides = next.get(graph);
    if (!nextGraphOverrides || previousGraphOverrides.size !== nextGraphOverrides.size) {
      return next;
    }
    for (const [processRef, isExpanded] of previousGraphOverrides) {
      if (nextGraphOverrides.get(processRef) !== isExpanded) {
        return next;
      }
    }
  }
  return previous;
}

function getSpanRefsKey(spanRefs: readonly SpanRef[]): string {
  return spanRefs.join(',');
}

function dedupeScalarArray<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function areScalarArraysEqual<T extends string | number>(
  left: readonly T[],
  right: readonly T[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
