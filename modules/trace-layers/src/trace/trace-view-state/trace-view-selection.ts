import {DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT} from '../trace-graph/build-trace-span-card-data';
import {
  isCrossProcessDependencyRef,
  isSameProcessDependencyRef
} from '../trace-graph/trace-id-encoder';

import type {TraceRenderSpan} from '../trace-graph-accessors';
import type {TraceCardSpan} from '../trace-graph/build-trace-span-card-data';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  TraceGraphSelectedCrossProcessDependencySource,
  TraceGraphSelectedSameProcessDependencySource,
  TraceSelectedDependencyDirection
} from '../trace-graph/trace-graph-types';
import type {
  CrossProcessDependencyRef,
  SameProcessDependencyRef,
  TraceDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';

/** Immediate visible dependency refs touching a span. */
export type TraceDependencyRefsForSpan = {
  /** Immediate visible same-process dependency refs touching the span. */
  readonly sameProcessDependencyRefs: readonly SameProcessDependencyRef[];
  /** Immediate visible cross-process dependency refs touching the span. */
  readonly crossProcessDependencyRefs: readonly CrossProcessDependencyRef[];
  /** Immediate visible same-process dependency refs incoming to the span. */
  readonly incomingSameProcessDependencyRefs: readonly SameProcessDependencyRef[];
  /** Immediate visible cross-process dependency refs incoming to the span. */
  readonly incomingCrossProcessDependencyRefs: readonly CrossProcessDependencyRef[];
  /** Immediate visible same-process dependency refs outgoing from the span. */
  readonly outgoingSameProcessDependencyRefs: readonly SameProcessDependencyRef[];
  /** Immediate visible cross-process dependency refs outgoing from the span. */
  readonly outgoingCrossProcessDependencyRefs: readonly CrossProcessDependencyRef[];
};

/** Direction maps for selected same-process and cross-process dependencies. */
export type TraceSelectedDependencyDirectionMaps = {
  /** Selected same-process dependency directions keyed by visible dependency ref. */
  readonly sameProcessDependencyDirectionByRef: ReadonlyMap<
    SameProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Selected cross-process dependency directions keyed by visible dependency ref. */
  readonly crossProcessDependencyDirectionByRef: ReadonlyMap<
    CrossProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
};

/** Inputs used to build selected dependency direction maps. */
export type TraceSelectedDependencyDirectionMapInput = {
  /** Visible same-process dependency refs incoming to the selected origin span. */
  readonly incomingSameProcessDependencyRefs?: readonly SameProcessDependencyRef[];
  /** Visible cross-process dependency refs incoming to the selected origin span. */
  readonly incomingCrossProcessDependencyRefs?: readonly CrossProcessDependencyRef[];
  /** Visible same-process dependency refs outgoing from the selected origin span. */
  readonly outgoingSameProcessDependencyRefs?: readonly SameProcessDependencyRef[];
  /** Visible cross-process dependency refs outgoing from the selected origin span. */
  readonly outgoingCrossProcessDependencyRefs?: readonly CrossProcessDependencyRef[];
};

/** Visible dependency refs whose endpoint span refs should be resolved. */
export type TraceVisibleDependencyEndpointSpanRefInput = {
  /** Visible same-process dependency refs to resolve to start and end span refs. */
  readonly sameProcessDependencyRefs?: readonly SameProcessDependencyRef[];
  /** Visible cross-process dependency refs to resolve to start and end span refs. */
  readonly crossProcessDependencyRefs?: readonly CrossProcessDependencyRef[];
};

/** Direction maps passed while resolving selected dependency overlay sources. */
export type TraceSelectedDependencySourceDirectionOptions = {
  /** Directions for externally selected same-process dependency refs. */
  readonly selectedSameProcessDependencyDirectionByRef?: ReadonlyMap<
    SameProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for clicked same-process dependency refs kept before parent state round-trips. */
  readonly clickedSameProcessDependencyDirectionByRef?: ReadonlyMap<
    SameProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for externally selected cross-process dependency refs. */
  readonly selectedCrossProcessDependencyDirectionByRef?: ReadonlyMap<
    CrossProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for clicked cross-process dependency refs kept before parent state round-trips. */
  readonly clickedCrossProcessDependencyDirectionByRef?: ReadonlyMap<
    CrossProcessDependencyRef,
    TraceSelectedDependencyDirection
  >;
};

/** Exact selected span data emitted by trace view selection callbacks. */
export type TraceSelectedSpan = {
  /** Stable process-local span ref used as the runtime selection identity. */
  spanRef: SpanRef;
  /** Selected-card span model resolved from the span ref. */
  span: TraceCardSpan;
};

/**
 * Resolves the lightweight selected-span payload without building full card dependency data.
 */
export function getTraceSelectedSpanFromRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceCardSpan | null {
  const span = traceGraph.getSpanDetailSource(spanRef);
  return span ? getTraceSelectedSpanFromRenderSpan(traceGraph, span) : null;
}

/**
 * Converts an Arrow-native render span into the selected-span shape used by selection callbacks.
 */
export function getTraceSelectedSpanFromRenderSpan(
  traceGraph: Readonly<TraceGraph>,
  span: Readonly<TraceRenderSpan>
): TraceCardSpan {
  const filterReason = traceGraph.spanFilterReason(span.spanRef);
  return {
    spanRef: span.spanRef,
    spanId: span.spanId,
    threadId: span.threadId,
    processName: span.processName,
    name: span.name,
    keywords: [...span.keywords],
    crossProcessEndpointId: span.crossProcessEndpointId,
    crossProcessDependencyEndpoints: [...span.crossProcessDependencyEndpoints],
    primaryTimingKey: span.primaryTimingKey,
    timings: span.timings,
    userData: span.userData,
    filterMask: filterReason.filterMask,
    isFiltered: filterReason.isFiltered
  };
}

/**
 * Returns immediate visible dependency refs touching the given span.
 */
export function getImmediateDependencyRefsForSpan(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceDependencyRefsForSpan {
  const sameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const crossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
  const incomingSameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const incomingCrossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
  const outgoingSameProcessDependencyRefs = new Set<SameProcessDependencyRef>();
  const outgoingCrossProcessDependencyRefs = new Set<CrossProcessDependencyRef>();
  const addTraceDependencyRef = (
    visibleDependencyRef: TraceDependencyRef | null | undefined,
    direction?: TraceSelectedDependencyDirection
  ) => {
    if (visibleDependencyRef == null) {
      return;
    }
    if (isSameProcessDependencyRef(visibleDependencyRef)) {
      sameProcessDependencyRefs.add(visibleDependencyRef);
      if (direction === 'incoming') {
        incomingSameProcessDependencyRefs.add(visibleDependencyRef);
      } else if (direction === 'outgoing') {
        outgoingSameProcessDependencyRefs.add(visibleDependencyRef);
      }
    } else if (isCrossProcessDependencyRef(visibleDependencyRef)) {
      crossProcessDependencyRefs.add(visibleDependencyRef);
      if (direction === 'incoming') {
        incomingCrossProcessDependencyRefs.add(visibleDependencyRef);
      } else if (direction === 'outgoing') {
        outgoingCrossProcessDependencyRefs.add(visibleDependencyRef);
      }
    }
  };

  for (const direction of ['incoming', 'outgoing'] as const) {
    const dependencyRefs = traceGraph.getVisibleDirectionalDependencyRefSlice(
      spanRef,
      direction,
      DEFAULT_TRACE_SPAN_CARD_DEPENDENCY_LIMIT
    );
    for (const dependencyRef of dependencyRefs.dependencyRefs) {
      addTraceDependencyRef(dependencyRef, direction);
    }
  }

  return {
    sameProcessDependencyRefs: [...sameProcessDependencyRefs],
    crossProcessDependencyRefs: [...crossProcessDependencyRefs],
    incomingSameProcessDependencyRefs: [...incomingSameProcessDependencyRefs],
    incomingCrossProcessDependencyRefs: [...incomingCrossProcessDependencyRefs],
    outgoingSameProcessDependencyRefs: [...outgoingSameProcessDependencyRefs],
    outgoingCrossProcessDependencyRefs: [...outgoingCrossProcessDependencyRefs]
  };
}

/**
 * Builds selected dependency direction maps, with incoming dependencies winning ties.
 */
export function buildTraceSelectedDependencyDirectionMaps(
  input: TraceSelectedDependencyDirectionMapInput
): TraceSelectedDependencyDirectionMaps {
  const sameProcessDependencyDirectionByRef = new Map<
    SameProcessDependencyRef,
    TraceSelectedDependencyDirection
  >();
  const crossProcessDependencyDirectionByRef = new Map<
    CrossProcessDependencyRef,
    TraceSelectedDependencyDirection
  >();

  addDependencyDirections(
    sameProcessDependencyDirectionByRef,
    input.outgoingSameProcessDependencyRefs,
    'outgoing'
  );
  addDependencyDirections(
    crossProcessDependencyDirectionByRef,
    input.outgoingCrossProcessDependencyRefs,
    'outgoing'
  );
  addDependencyDirections(
    sameProcessDependencyDirectionByRef,
    input.incomingSameProcessDependencyRefs,
    'incoming'
  );
  addDependencyDirections(
    crossProcessDependencyDirectionByRef,
    input.incomingCrossProcessDependencyRefs,
    'incoming'
  );

  return {
    sameProcessDependencyDirectionByRef,
    crossProcessDependencyDirectionByRef
  };
}

/**
 * Returns visible start/end span refs touched by the supplied visible dependency refs.
 */
export function getVisibleDependencyEndpointSpanRefs(
  traceGraph: Readonly<TraceGraph>,
  input: TraceVisibleDependencyEndpointSpanRefInput
): SpanRef[] {
  const spanRefs = new Set<SpanRef>();
  for (const dependencyRef of input.sameProcessDependencyRefs ?? []) {
    addVisibleDependencyEndpointSpanRefs(traceGraph, dependencyRef, spanRefs);
  }
  for (const dependencyRef of input.crossProcessDependencyRefs ?? []) {
    addVisibleDependencyEndpointSpanRefs(traceGraph, dependencyRef, spanRefs);
  }
  return [...spanRefs];
}

/**
 * Builds selected same-process-dependency render sources grouped by process id.
 */
export function buildTraceSelectedSameProcessDependencySourcesByProcessId(
  traceGraph: Readonly<TraceGraph>,
  selectedDependencyRefs: ReadonlySet<SameProcessDependencyRef> | null | undefined,
  clickedDependencyRefs: readonly SameProcessDependencyRef[],
  directionOptions?: Pick<
    TraceSelectedDependencySourceDirectionOptions,
    'selectedSameProcessDependencyDirectionByRef' | 'clickedSameProcessDependencyDirectionByRef'
  >
): TraceSelectedSameProcessDependencySourcesByProcessId {
  if ((selectedDependencyRefs?.size ?? 0) === 0 && clickedDependencyRefs.length === 0) {
    return {};
  }

  const selectedSourcesByRef = new Map<
    SameProcessDependencyRef,
    TraceGraphSelectedSameProcessDependencySource
  >();
  const addSameProcessDependencySource = (
    source: TraceGraphSelectedSameProcessDependencySource | null
  ) => {
    if (!source) {
      return;
    }
    const previous = selectedSourcesByRef.get(source.dependencyRef);
    if (!previous) {
      selectedSourcesByRef.set(source.dependencyRef, source);
      return;
    }
    const selectedDirection = mergeSelectedDependencyDirections(
      previous.selectedDirection,
      source.selectedDirection
    );
    selectedSourcesByRef.set(
      source.dependencyRef,
      selectedDirection === source.selectedDirection ? source : {...source, selectedDirection}
    );
  };

  for (const dependencyRef of selectedDependencyRefs ?? []) {
    const selectedDirection =
      directionOptions?.selectedSameProcessDependencyDirectionByRef?.get(dependencyRef);
    addSameProcessDependencySource(
      buildSelectedSameProcessDependencySource(traceGraph, dependencyRef, selectedDirection)
    );
  }
  for (const dependencyRef of clickedDependencyRefs) {
    const selectedDirection =
      directionOptions?.clickedSameProcessDependencyDirectionByRef?.get(dependencyRef);
    addSameProcessDependencySource(
      buildSelectedSameProcessDependencySource(traceGraph, dependencyRef, selectedDirection)
    );
  }

  if (selectedSourcesByRef.size === 0) {
    return {};
  }

  return Array.from(selectedSourcesByRef.values()).reduce<
    Partial<Record<string, TraceGraphSelectedSameProcessDependencySource[]>>
  >((groupedSources, source) => {
    const processKey = String(source.processRef);
    if (!groupedSources[processKey]) {
      groupedSources[processKey] = [];
    }
    groupedSources[processKey]!.push(source);
    return groupedSources;
  }, {});
}

/**
 * Builds selected cross-process-dependency render sources from canonical visible dependency refs.
 */
export function buildTraceSelectedCrossProcessDependencySources(
  traceGraph: Readonly<TraceGraph>,
  selectedDependencyRefs: ReadonlySet<CrossProcessDependencyRef> | null | undefined,
  clickedDependencyRefs: readonly CrossProcessDependencyRef[],
  directionOptions?: Pick<
    TraceSelectedDependencySourceDirectionOptions,
    'selectedCrossProcessDependencyDirectionByRef' | 'clickedCrossProcessDependencyDirectionByRef'
  >
): TraceSelectedCrossProcessDependencySources {
  if ((selectedDependencyRefs?.size ?? 0) === 0 && clickedDependencyRefs.length === 0) {
    return [];
  }

  const selectedSourcesByRef = new Map<
    CrossProcessDependencyRef,
    TraceGraphSelectedCrossProcessDependencySource
  >();
  const addCrossProcessDependencySource = (
    source: TraceGraphSelectedCrossProcessDependencySource | null
  ) => {
    if (!source) {
      return;
    }
    const previous = selectedSourcesByRef.get(source.dependencyRef);
    if (!previous) {
      selectedSourcesByRef.set(source.dependencyRef, source);
      return;
    }
    const selectedDirection = mergeSelectedDependencyDirections(
      previous.selectedDirection,
      source.selectedDirection
    );
    selectedSourcesByRef.set(
      source.dependencyRef,
      selectedDirection === source.selectedDirection ? source : {...source, selectedDirection}
    );
  };

  for (const dependencyRef of selectedDependencyRefs ?? []) {
    const selectedDirection =
      directionOptions?.selectedCrossProcessDependencyDirectionByRef?.get(dependencyRef);
    addCrossProcessDependencySource(
      buildSelectedCrossProcessDependencySource(traceGraph, dependencyRef, selectedDirection)
    );
  }
  for (const dependencyRef of clickedDependencyRefs) {
    const selectedDirection =
      directionOptions?.clickedCrossProcessDependencyDirectionByRef?.get(dependencyRef);
    addCrossProcessDependencySource(
      buildSelectedCrossProcessDependencySource(traceGraph, dependencyRef, selectedDirection)
    );
  }

  return Array.from(selectedSourcesByRef.values());
}

/** Selected same-process-dependency sources grouped by process id. */
export type TraceSelectedSameProcessDependencySourcesByProcessId = Readonly<
  Partial<Record<string, readonly TraceGraphSelectedSameProcessDependencySource[]>>
>;

/** Selected cross-process-dependency sources for ref-native selection rendering. */
export type TraceSelectedCrossProcessDependencySources =
  readonly TraceGraphSelectedCrossProcessDependencySource[];

/** Projects one visible same-process dependency ref into the selected-overlay scalar payload. */
function buildSelectedSameProcessDependencySource(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: SameProcessDependencyRef,
  selectedDirection?: TraceSelectedDependencyDirection
): TraceGraphSelectedSameProcessDependencySource | null {
  const processRef = traceGraph.getSameProcessDependencyProcessRefByRef(dependencyRef);
  if (processRef == null) {
    return null;
  }
  return {
    dependencyRef,
    processRef,
    selectedDirection: selectedDirection ?? 'incoming',
    waitTimeMs: traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
    bidirectional: traceGraph.getDependencyBidirectional(dependencyRef) === true
  };
}

/** Projects one visible cross-process dependency ref into the selected-overlay scalar payload. */
function buildSelectedCrossProcessDependencySource(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: CrossProcessDependencyRef,
  selectedDirection?: TraceSelectedDependencyDirection
): TraceGraphSelectedCrossProcessDependencySource | null {
  if (!traceGraph.isDependencyVisible(dependencyRef)) {
    return null;
  }
  return {
    dependencyRef,
    selectedDirection: selectedDirection ?? 'incoming',
    waitTimeMs: traceGraph.getDependencyWaitTimeMs(dependencyRef) ?? 0,
    bidirectional: traceGraph.getDependencyBidirectional(dependencyRef) === true
  };
}

function addDependencyDirections<TRef extends SameProcessDependencyRef | CrossProcessDependencyRef>(
  directionByRef: Map<TRef, TraceSelectedDependencyDirection>,
  dependencyRefs: readonly TRef[] | null | undefined,
  selectedDirection: TraceSelectedDependencyDirection
): void {
  for (const dependencyRef of dependencyRefs ?? []) {
    directionByRef.set(
      dependencyRef,
      mergeSelectedDependencyDirections(directionByRef.get(dependencyRef), selectedDirection)
    );
  }
}

function addVisibleDependencyEndpointSpanRefs(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: TraceDependencyRef,
  spanRefs: Set<SpanRef>
): void {
  const startSpanRef = traceGraph.getDependencyStartSpan(dependencyRef);
  if (startSpanRef != null) {
    spanRefs.add(startSpanRef);
  }
  const endSpanRef = traceGraph.getDependencyEndSpan(dependencyRef);
  if (endSpanRef != null) {
    spanRefs.add(endSpanRef);
  }
}

function mergeSelectedDependencyDirections(
  previous: TraceSelectedDependencyDirection | null | undefined,
  next: TraceSelectedDependencyDirection | null | undefined
): TraceSelectedDependencyDirection {
  if (previous === 'incoming' || next === 'incoming') {
    return 'incoming';
  }
  if (previous === 'outgoing' || next === 'outgoing') {
    return 'outgoing';
  }
  return 'incoming';
}
