import type {TraceGraph} from '../trace-graph/trace-graph';
import type {ProcessRef, ThreadRef} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';
import type {TraceGraphCollapseState, TraceLayoutCollapseState} from './trace-layout';

/** Explicit process expansion overrides keyed by graph instance and graph-local process ref. */
export type TraceProcessExpansionOverrides = ReadonlyMap<
  TraceGraph,
  ReadonlyMap<ProcessRef, boolean>
>;

/** Mutable graph-local collapse state used while preparing immutable updates. */
export type MutableTraceGraphCollapseState = {
  /** Graph-local process refs whose rows should be collapsed. */
  collapsedProcessRefs: Set<ProcessRef>;
  /** Graph-local thread refs whose rows should be collapsed unless explicitly expanded. */
  collapsedThreadRefs: Set<ThreadRef>;
  /** Graph-local thread refs whose rows should be expanded over default lane collapse state. */
  expandedThreadRefs: Set<ThreadRef>;
};

/** Creates an empty collapse state for one graph. */
export function createEmptyTraceGraphCollapseState(): MutableTraceGraphCollapseState {
  return {
    collapsedProcessRefs: new Set(),
    collapsedThreadRefs: new Set(),
    expandedThreadRefs: new Set()
  };
}

/** Clones one graph-local collapse state for immutable update construction. */
export function cloneTraceGraphCollapseState(
  state?: TraceGraphCollapseState
): MutableTraceGraphCollapseState {
  return {
    collapsedProcessRefs: new Set(state?.collapsedProcessRefs ?? []),
    collapsedThreadRefs: new Set(state?.collapsedThreadRefs ?? []),
    expandedThreadRefs: new Set(state?.expandedThreadRefs ?? [])
  };
}

/** Records an explicit process expansion override for future default-state recomputation. */
export function setTraceProcessExpansionOverride(
  overrides: Map<TraceGraph, Map<ProcessRef, boolean>>,
  graph: TraceGraph,
  processRef: ProcessRef,
  isExpanded: boolean
): void {
  const graphOverrides = overrides.get(graph) ?? new Map<ProcessRef, boolean>();
  graphOverrides.set(processRef, isExpanded);
  overrides.set(graph, graphOverrides);
}

/** Returns whether two graph-local collapse states contain the same refs. */
export function areTraceGraphCollapseStatesEqual(
  left: TraceGraphCollapseState,
  right: TraceGraphCollapseState
): boolean {
  return (
    areSetsEqual(left.collapsedProcessRefs, right.collapsedProcessRefs) &&
    areSetsEqual(left.collapsedThreadRefs, right.collapsedThreadRefs) &&
    areSetsEqual(left.expandedThreadRefs, right.expandedThreadRefs)
  );
}

/** Returns whether two multi-graph collapse states contain the same graph-aligned refs. */
export function areTraceLayoutCollapseStatesEqual(
  left: TraceLayoutCollapseState,
  right: TraceLayoutCollapseState
): boolean {
  if (left.graphs.length !== right.graphs.length) {
    return false;
  }
  return left.graphs.every((graphState, index) => {
    const otherGraphState = right.graphs[index];
    return otherGraphState != null && areTraceGraphCollapseStatesEqual(graphState, otherGraphState);
  });
}

/** Returns `next` only when it differs from `previous`, preserving React state identity otherwise. */
export function selectTraceLayoutCollapseStateUpdate(
  previous: TraceLayoutCollapseState,
  next: TraceLayoutCollapseState
): TraceLayoutCollapseState {
  return areTraceLayoutCollapseStatesEqual(previous, next) ? previous : next;
}

/** Expands or collapses every process row across the graph list. */
export function setAllTraceProcessesExpanded(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Trace graphs aligned with `collapseState.graphs`. */
  traceGraphs: readonly TraceGraph[];
  /** Whether all process rows should be expanded. */
  expand: boolean;
  /** Optional override map updated so user intent survives default-setting changes. */
  processExpansionOverrides?: Map<TraceGraph, Map<ProcessRef, boolean>>;
}): TraceLayoutCollapseState {
  return {
    graphs: params.traceGraphs.map((graph, graphIndex) => {
      const previousGraphState = params.collapseState.graphs[graphIndex];
      for (const processRef of graph.getProcessRefs()) {
        if (params.processExpansionOverrides) {
          setTraceProcessExpansionOverride(
            params.processExpansionOverrides,
            graph,
            processRef,
            params.expand
          );
        }
      }
      return {
        collapsedProcessRefs: params.expand
          ? new Set<ProcessRef>()
          : new Set<ProcessRef>(graph.getProcessRefs()),
        collapsedThreadRefs: new Set(previousGraphState?.collapsedThreadRefs ?? []),
        expandedThreadRefs: new Set(previousGraphState?.expandedThreadRefs ?? [])
      };
    })
  };
}

/** Prunes refs that no longer belong to the current graph instances. */
export function pruneTraceLayoutCollapseStateForGraphs(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Current graph instances aligned by graph index. */
  traceGraphs: readonly TraceGraph[];
}): TraceLayoutCollapseState {
  return {
    graphs: params.traceGraphs.map((graph, graphIndex) => {
      const previousGraphState =
        params.collapseState.graphs[graphIndex] ?? createEmptyTraceGraphCollapseState();
      const processRefs = new Set(graph.getProcessRefs());
      const threadRefs = new Set(graph.getThreadRefs());
      return {
        collapsedProcessRefs: new Set(
          [...previousGraphState.collapsedProcessRefs].filter(processRef =>
            processRefs.has(processRef)
          )
        ),
        collapsedThreadRefs: new Set(
          [...previousGraphState.collapsedThreadRefs].filter(threadRef => threadRefs.has(threadRef))
        ),
        expandedThreadRefs: new Set(
          [...previousGraphState.expandedThreadRefs].filter(threadRef => threadRefs.has(threadRef))
        )
      };
    })
  };
}

/** Prunes thread collapse refs to the thread rows that currently have visible lane controls. */
export function pruneTraceLayoutThreadCollapseStateForLaneRefs(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Graph-indexed thread refs that should keep lane-collapse overrides. */
  validThreadRefsByGraph: readonly ReadonlySet<ThreadRef>[];
}): TraceLayoutCollapseState {
  return {
    graphs: params.collapseState.graphs.map((previousGraphState, graphIndex) => {
      const validThreadRefs = params.validThreadRefsByGraph[graphIndex] ?? new Set<ThreadRef>();
      return {
        collapsedProcessRefs: new Set(previousGraphState.collapsedProcessRefs),
        collapsedThreadRefs: new Set(
          [...previousGraphState.collapsedThreadRefs].filter(threadRef =>
            validThreadRefs.has(threadRef)
          )
        ),
        expandedThreadRefs: new Set(
          [...previousGraphState.expandedThreadRefs].filter(threadRef =>
            validThreadRefs.has(threadRef)
          )
        )
      };
    })
  };
}

/** Expands the process refs that own the provided selected span refs in the primary graph. */
export function expandSelectedSpanProcessRefs(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Primary graph that owns the selected span refs. */
  traceGraph: TraceGraph;
  /** Selected span refs whose owning process rows should expand. */
  spanRefs: readonly SpanRef[];
  /** Optional override map updated so user intent survives default-setting changes. */
  processExpansionOverrides?: Map<TraceGraph, Map<ProcessRef, boolean>>;
}): TraceLayoutCollapseState {
  const selectedProcessRefs = new Set<ProcessRef>();
  for (const spanRef of params.spanRefs) {
    const processRef = params.traceGraph.getProcessRefBySpanRef(spanRef);
    if (processRef != null) {
      selectedProcessRefs.add(processRef);
    }
  }
  if (selectedProcessRefs.size === 0) {
    return params.collapseState;
  }

  const graphState = cloneTraceGraphCollapseState(params.collapseState.graphs[0]);
  for (const processRef of selectedProcessRefs) {
    graphState.collapsedProcessRefs.delete(processRef);
    if (params.processExpansionOverrides) {
      setTraceProcessExpansionOverride(
        params.processExpansionOverrides,
        params.traceGraph,
        processRef,
        true
      );
    }
  }
  return {
    graphs: params.collapseState.graphs.map((previousGraphState, graphIndex) =>
      graphIndex === 0 ? graphState : cloneTraceGraphCollapseState(previousGraphState)
    )
  };
}

/** Toggles one process row by graph-local ref. */
export function toggleTraceProcessCollapse(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Graph index that owns `processRef`. */
  graphIndex: number;
  /** Graph instance that owns `processRef`. */
  graph: TraceGraph;
  /** Graph-local process ref to toggle. */
  processRef: ProcessRef;
  /** Optional override map updated so user intent survives default-setting changes. */
  processExpansionOverrides?: Map<TraceGraph, Map<ProcessRef, boolean>>;
}): TraceLayoutCollapseState {
  const nextGraphs = params.collapseState.graphs.map(cloneTraceGraphCollapseState);
  const graphState = nextGraphs[params.graphIndex] ?? createEmptyTraceGraphCollapseState();
  nextGraphs[params.graphIndex] = graphState;
  if (graphState.collapsedProcessRefs.has(params.processRef)) {
    graphState.collapsedProcessRefs.delete(params.processRef);
    if (params.processExpansionOverrides) {
      setTraceProcessExpansionOverride(
        params.processExpansionOverrides,
        params.graph,
        params.processRef,
        true
      );
    }
  } else {
    graphState.collapsedProcessRefs.add(params.processRef);
    if (params.processExpansionOverrides) {
      setTraceProcessExpansionOverride(
        params.processExpansionOverrides,
        params.graph,
        params.processRef,
        false
      );
    }
  }
  return {graphs: nextGraphs};
}

/** Toggles one thread lane-collapse override by graph-local ref. */
export function toggleTraceThreadCollapse(params: {
  /** Current collapse state. */
  collapseState: TraceLayoutCollapseState;
  /** Graph index that owns `threadRef`. */
  graphIndex: number;
  /** Graph-local thread ref to toggle. */
  threadRef: ThreadRef;
}): TraceLayoutCollapseState {
  const nextGraphs = params.collapseState.graphs.map(cloneTraceGraphCollapseState);
  const graphState = nextGraphs[params.graphIndex] ?? createEmptyTraceGraphCollapseState();
  nextGraphs[params.graphIndex] = graphState;
  if (graphState.collapsedThreadRefs.has(params.threadRef)) {
    graphState.collapsedThreadRefs.delete(params.threadRef);
    graphState.expandedThreadRefs.add(params.threadRef);
  } else {
    graphState.collapsedThreadRefs.add(params.threadRef);
    graphState.expandedThreadRefs.delete(params.threadRef);
  }
  return {graphs: nextGraphs};
}

function areSetsEqual<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  if (left === right) {
    return true;
  }
  if (left.size !== right.size) {
    return false;
  }
  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }
  return true;
}
