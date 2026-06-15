import {
  cloneTraceGraphCollapseState,
  setTraceProcessExpansionOverride
} from './trace-collapse-state';

import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceProcessExpansionOverrides} from './trace-collapse-state';
import type {TraceLayout, TraceLayoutCollapseState} from './trace-layout';

/** Thread collapse pruning request resolved from visible trace layouts. */
export type TraceLayoutThreadPruneRequest = {
  /** Graph-indexed thread refs that should keep lane-collapse overrides. */
  readonly validThreadRefsByGraph: readonly ReadonlySet<ThreadRef>[];
};

/** Ref-native process target resolved from an interaction payload. */
export type TraceProcessRefTarget = {
  /** Graph index that owns `processRef`. */
  readonly graphIndex: number;
  /** Graph-local process ref carried to runtime collapse state. */
  readonly processRef: ProcessRef;
};

/** Ref-native thread target resolved from an interaction payload. */
export type TraceThreadRefTarget = {
  /** Graph index that owns `threadRef`. */
  readonly graphIndex: number;
  /** Graph-local thread ref carried to runtime collapse state. */
  readonly threadRef: ThreadRef;
};

/** Returns the layout graph list for primary/secondary graphs and rank layout mode. */
export function getTraceLayoutGraphs(params: {
  /** Primary trace graph, when loaded. */
  traceGraph?: TraceGraph | null;
  /** Optional secondary trace graph for comparison layouts. */
  secondaryTraceGraph?: TraceGraph | null;
  /** Rank layout mode that decides whether comparison graphs are rendered together. */
  processLayoutMode?: string | null;
}): readonly TraceGraph[] {
  if (!params.traceGraph) {
    return [];
  }
  if (
    params.secondaryTraceGraph &&
    (params.processLayoutMode === 'sequential' || params.processLayoutMode === 'interleaved')
  ) {
    return [params.traceGraph, params.secondaryTraceGraph];
  }
  return [params.traceGraph];
}

/** Builds the visible-lane thread pruning request for graph-aligned trace layouts. */
export function buildTraceLayoutThreadPruneRequest(params: {
  /** Trace layouts whose visible lane controls should be scanned. */
  traceLayouts: readonly TraceLayout[];
}): TraceLayoutThreadPruneRequest {
  const validThreadRefsByGraph = params.traceLayouts.map(layout => {
    const validLaneThreadRefs = new Set<ThreadRef>();
    layout.threadLayoutMapByRef.forEach((streamLayout, threadRef) => {
      if (streamLayout.lanes) {
        validLaneThreadRefs.add(threadRef);
      }
    });
    return validLaneThreadRefs;
  });
  return {
    validThreadRefsByGraph
  };
}

/** Resolves a process toggle target from an exact graph-local process ref. */
export function resolveTraceProcessRefTarget(params: {
  /** Trace graphs to search. */
  traceGraphs: readonly TraceGraph[];
  /** Serialized process id used to disambiguate identical packed refs across compared graphs. */
  processId: string;
  /** Exact graph-local process ref carried by the interaction payload. */
  processRef: ProcessRef;
  /** Optional graph index already known by the caller. */
  graphIndexHint?: number;
}): TraceProcessRefTarget | null {
  const graphIndex = findProcessGraphIndex({
    traceGraphs: params.traceGraphs,
    processRef: params.processRef,
    processId: params.processId,
    fallbackGraphIndex: params.graphIndexHint
  });
  const graph = params.traceGraphs[graphIndex] ?? params.traceGraphs[0];
  if (!graph) {
    return null;
  }
  return {graphIndex, processRef: params.processRef};
}

/** Resolves a thread toggle target from an exact graph-local thread ref. */
export function resolveTraceThreadRefTarget(params: {
  /** Exact graph-local thread ref carried by the interaction payload. */
  threadRef: ThreadRef;
  /** Graph index already known by the caller. */
  graphIndex: number;
}): TraceThreadRefTarget {
  return {graphIndex: params.graphIndex, threadRef: params.threadRef};
}

/** Resolves one graph-local process ref to its ingestion process id. */
export function getTraceGraphProcessIdForRef(
  graph: TraceGraph,
  processRef: ProcessRef
): string | null {
  const processIndex = graph.getProcessRefs().indexOf(processRef);
  return graph.processes[processIndex]?.processId ?? null;
}

/** Builds the graph-aligned collapse state implied by starting/default expansion inputs. */
export function buildInitialTraceLayoutCollapseState(params: {
  /** Trace graphs whose process refs should be represented in the returned state. */
  traceGraphs: readonly TraceGraph[];
  /** Whether processes should expand by default when no explicit override applies. */
  defaultExpandProcess: boolean;
  /** Serialized process ids that should start expanded. */
  defaultExpandedProcessIds?: readonly string[];
  /** Serialized process ids that should start collapsed even when default expansion is enabled. */
  defaultCollapsedProcessIds?: readonly string[];
  /** Selected process refs that should start expanded, keyed by graph index. */
  selectedDefaultExpandedProcessRefs: ReadonlyMap<number, ReadonlySet<ProcessRef>>;
  /** Explicit user expansion overrides keyed by graph instance and graph-local process ref. */
  processExpansionOverrides?: TraceProcessExpansionOverrides;
}): TraceLayoutCollapseState {
  const defaultExpandedProcessIdSet = new Set(params.defaultExpandedProcessIds ?? []);
  const defaultCollapsedProcessIdSet = new Set(params.defaultCollapsedProcessIds ?? []);
  return {
    graphs: params.traceGraphs.map((graph, graphIndex) => {
      const selectedExpandedRefs =
        params.selectedDefaultExpandedProcessRefs.get(graphIndex) ?? new Set<ProcessRef>();
      const processExpansionOverrides = params.processExpansionOverrides?.get(graph);
      const collapsedProcessRefs = new Set<ProcessRef>();
      for (const processRef of graph.getProcessRefs()) {
        const processId = getTraceGraphProcessIdForRef(graph, processRef);
        const explicitExpansion = processExpansionOverrides?.get(processRef);
        const shouldExpand =
          explicitExpansion ??
          (selectedExpandedRefs.has(processRef) ||
            (processId != null && defaultExpandedProcessIdSet.has(processId)) ||
            (params.defaultExpandProcess &&
              (processId == null || !defaultCollapsedProcessIdSet.has(processId))));
        if (!shouldExpand) {
          collapsedProcessRefs.add(processRef);
        }
      }
      return {
        collapsedProcessRefs,
        collapsedThreadRefs: new Set(),
        expandedThreadRefs: new Set()
      };
    })
  };
}

/** Serializes expanded process ids from the current ref-native collapse state. */
export function getExpandedProcessIdsFromCollapseState(params: {
  /** Trace graphs aligned with `collapseState.graphs`. */
  traceGraphs: readonly TraceGraph[];
  /** Ref-native collapse state to serialize at the process-id boundary. */
  collapseState: TraceLayoutCollapseState;
}): string[] {
  const expandedProcessIds: string[] = [];
  params.traceGraphs.forEach((graph, graphIndex) => {
    const graphState = params.collapseState.graphs[graphIndex];
    const collapsedProcessRefs = graphState?.collapsedProcessRefs ?? new Set<ProcessRef>();
    for (const processRef of graph.getProcessRefs()) {
      if (collapsedProcessRefs.has(processRef)) {
        continue;
      }
      const processId = getTraceGraphProcessIdForRef(graph, processRef);
      if (processId) {
        expandedProcessIds.push(processId);
      }
    }
  });
  return expandedProcessIds;
}

/** Finds the graph index that owns a process-ref/rank-id pair. */
export function findProcessGraphIndex(params: {
  /** Trace graphs to search. */
  traceGraphs: readonly TraceGraph[];
  /** Exact graph-local process ref carried by the interaction payload. */
  processRef: ProcessRef;
  /** Serialized process id used to disambiguate identical packed refs across compared graphs. */
  processId: string;
  /** Optional graph index already known by the caller. */
  fallbackGraphIndex?: number;
}): number {
  if (params.fallbackGraphIndex != null) {
    return params.fallbackGraphIndex;
  }
  return Math.max(
    0,
    params.traceGraphs.findIndex(
      graph => getTraceGraphProcessIdForRef(graph, params.processRef) === params.processId
    )
  );
}

/** Expands the provided process ids and collapses all other process rows. */
export function setExpandedTraceProcessIds(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Trace graphs aligned with `collapseState.graphs`. */
  traceGraphs: readonly TraceGraph[];
  /** Serialized process ids that should remain expanded. */
  processIds: readonly string[];
  /** Optional override map updated so user intent survives default-setting changes. */
  processExpansionOverrides?: Map<TraceGraph, Map<ProcessRef, boolean>>;
}): TraceLayoutCollapseState {
  const expandedProcessIdSet = new Set(params.processIds);
  return {
    graphs: params.traceGraphs.map((graph, graphIndex) => {
      const previousGraphState = params.collapseState.graphs[graphIndex];
      const collapsedProcessRefs = new Set<ProcessRef>();
      for (const processRef of graph.getProcessRefs()) {
        const processId = getTraceGraphProcessIdForRef(graph, processRef);
        const shouldExpand = processId != null && expandedProcessIdSet.has(processId);
        if (params.processExpansionOverrides) {
          setTraceProcessExpansionOverride(
            params.processExpansionOverrides,
            graph,
            processRef,
            shouldExpand
          );
        }
        if (!shouldExpand) {
          collapsedProcessRefs.add(processRef);
        }
      }
      return {
        collapsedProcessRefs,
        collapsedThreadRefs: new Set(previousGraphState?.collapsedThreadRefs ?? []),
        expandedThreadRefs: new Set(previousGraphState?.expandedThreadRefs ?? [])
      };
    })
  };
}

/** Builds a layout-ready clone aligned to the provided trace graph list. */
export function cloneTraceLayoutCollapseStateForGraphs(
  collapseState: TraceLayoutCollapseState,
  traceGraphs: readonly TraceGraph[]
): TraceLayoutCollapseState {
  return {
    graphs: traceGraphs.map((_, graphIndex) =>
      cloneTraceGraphCollapseState(collapseState.graphs[graphIndex])
    )
  };
}
