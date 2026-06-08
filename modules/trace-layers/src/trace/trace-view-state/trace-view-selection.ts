import {
  isVisibleCrossDependencyRef,
  isVisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';

import type {
  TraceCrossDependencySource,
  TraceLocalDependencySource,
  TraceRenderSpan
} from '../trace-graph-accessors';
import type {TraceCardSpan} from '../trace-graph/build-trace-span-card-data';
import type {TraceGraph} from '../trace-graph/trace-graph';
import type {
  TraceGraphSelectedCrossDependencySource,
  TraceGraphSelectedLocalDependencySource,
  TraceSelectedDependencyDirection
} from '../trace-graph/trace-graph-types';
import type {
  VisibleCrossDependencyRef,
  VisibleDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {SpanRef} from '../trace-graph/trace-types';

/** Immediate visible dependency refs touching a span. */
export type TraceVisibleDependencyRefsForSpan = {
  /** Immediate visible local dependency refs touching the span. */
  readonly localDependencyRefs: readonly VisibleLocalDependencyRef[];
  /** Immediate visible cross dependency refs touching the span. */
  readonly crossDependencyRefs: readonly VisibleCrossDependencyRef[];
  /** Immediate visible local dependency refs incoming to the span. */
  readonly incomingLocalDependencyRefs: readonly VisibleLocalDependencyRef[];
  /** Immediate visible cross dependency refs incoming to the span. */
  readonly incomingCrossDependencyRefs: readonly VisibleCrossDependencyRef[];
  /** Immediate visible local dependency refs outgoing from the span. */
  readonly outgoingLocalDependencyRefs: readonly VisibleLocalDependencyRef[];
  /** Immediate visible cross dependency refs outgoing from the span. */
  readonly outgoingCrossDependencyRefs: readonly VisibleCrossDependencyRef[];
};

/** Direction maps for selected local and cross dependencies. */
export type TraceSelectedDependencyDirectionMaps = {
  /** Selected local dependency directions keyed by visible dependency ref. */
  readonly localDependencyDirectionByRef: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Selected cross dependency directions keyed by visible dependency ref. */
  readonly crossDependencyDirectionByRef: ReadonlyMap<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >;
};

/** Inputs used to build selected dependency direction maps. */
export type TraceSelectedDependencyDirectionMapInput = {
  /** Visible local dependency refs incoming to the selected origin span. */
  readonly incomingLocalDependencyRefs?: readonly VisibleLocalDependencyRef[];
  /** Visible cross dependency refs incoming to the selected origin span. */
  readonly incomingCrossDependencyRefs?: readonly VisibleCrossDependencyRef[];
  /** Visible local dependency refs outgoing from the selected origin span. */
  readonly outgoingLocalDependencyRefs?: readonly VisibleLocalDependencyRef[];
  /** Visible cross dependency refs outgoing from the selected origin span. */
  readonly outgoingCrossDependencyRefs?: readonly VisibleCrossDependencyRef[];
};

/** Visible dependency refs whose endpoint span refs should be resolved. */
export type TraceVisibleDependencyEndpointSpanRefInput = {
  /** Visible local dependency refs to resolve to start and end span refs. */
  readonly localDependencyRefs?: readonly VisibleLocalDependencyRef[];
  /** Visible cross-process dependency refs to resolve to start and end span refs. */
  readonly crossDependencyRefs?: readonly VisibleCrossDependencyRef[];
};

/** Direction maps passed while resolving selected dependency overlay sources. */
export type TraceSelectedDependencySourceDirectionOptions = {
  /** Directions for externally selected local dependency refs. */
  readonly selectedLocalDependencyDirectionByRef?: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for clicked local dependency refs kept before parent state round-trips. */
  readonly clickedLocalDependencyDirectionByRef?: ReadonlyMap<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for externally selected cross dependency refs. */
  readonly selectedCrossDependencyDirectionByRef?: ReadonlyMap<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >;
  /** Directions for clicked cross dependency refs kept before parent state round-trips. */
  readonly clickedCrossDependencyDirectionByRef?: ReadonlyMap<
    VisibleCrossDependencyRef,
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

/** Selection-change payload emitted by trace views without exposing TraceSpan objects. */
export type TraceSelectionChange = {
  /** Canonical selected span refs. */
  selectedSpanRefs: SpanRef[];
  /** Resolved selected spans for display-oriented consumers. */
  selectedSpans: TraceSelectedSpan[];
  /** Canonical visible local dependency refs selected by the latest gesture. */
  selectedLocalDependencyRefs: VisibleLocalDependencyRef[];
  /** Canonical visible cross dependency refs selected by the latest gesture. */
  selectedCrossDependencyRefs: VisibleCrossDependencyRef[];
  /** Selected visible local dependency sources resolved from the canonical refs. */
  selectedDependencies: TraceLocalDependencySource[];
  /** Selected visible cross dependency sources resolved from the canonical refs. */
  selectedCrossDependencies: TraceCrossDependencySource[];
  /** Whether the selection was emitted from an extended-selection gesture such as shift-click. */
  isExtendedSelection: boolean;
};

/** Tracks the most recent user selection gesture that should be visible to consumers. */
export type TraceSelectionInteraction = {
  /** Monotonic counter used to publish repeated clicks on the same span. */
  nonce: number;
  /** Whether the latest selection gesture requested extended selection behavior. */
  isExtendedSelection: boolean;
};

/**
 * Resolves the lightweight selected-span payload without building full card dependency data.
 */
export function getTraceSelectedSpanFromRef(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceCardSpan | null {
  const span = traceGraph.getSpanDisplaySource(spanRef);
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
export function getImmediateVisibleDependencyRefsForSpan(
  traceGraph: Readonly<TraceGraph>,
  spanRef: SpanRef
): TraceVisibleDependencyRefsForSpan {
  const localDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const crossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  const incomingLocalDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const incomingCrossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  const outgoingLocalDependencyRefs = new Set<VisibleLocalDependencyRef>();
  const outgoingCrossDependencyRefs = new Set<VisibleCrossDependencyRef>();
  const addVisibleDependencyRef = (
    visibleDependencyRef: VisibleDependencyRef | null | undefined,
    direction?: TraceSelectedDependencyDirection
  ) => {
    if (visibleDependencyRef == null) {
      return;
    }
    if (isVisibleLocalDependencyRef(visibleDependencyRef)) {
      localDependencyRefs.add(visibleDependencyRef);
      if (direction === 'incoming') {
        incomingLocalDependencyRefs.add(visibleDependencyRef);
      } else if (direction === 'outgoing') {
        outgoingLocalDependencyRefs.add(visibleDependencyRef);
      }
    } else if (isVisibleCrossDependencyRef(visibleDependencyRef)) {
      crossDependencyRefs.add(visibleDependencyRef);
      if (direction === 'incoming') {
        incomingCrossDependencyRefs.add(visibleDependencyRef);
      } else if (direction === 'outgoing') {
        outgoingCrossDependencyRefs.add(visibleDependencyRef);
      }
    }
  };

  for (const direction of ['incoming', 'outgoing'] as const) {
    const dependencyRefs = traceGraph.getSpanDirectionalDependencyRefs(spanRef, direction);
    for (const dependencyRef of dependencyRefs.localDependencyRefs) {
      const visibleDependencyRef =
        traceGraph.getVisibleLocalDependencyRefBySourceRef(dependencyRef);
      if (visibleDependencyRef != null) {
        addVisibleDependencyRef(visibleDependencyRef, direction);
      }
    }
    for (const dependencyRef of dependencyRefs.crossDependencyRefs) {
      const visibleDependencyRef =
        traceGraph.getVisibleCrossDependencyRefBySourceRef(dependencyRef);
      if (visibleDependencyRef != null) {
        addVisibleDependencyRef(visibleDependencyRef, direction);
      }
    }
  }

  const cardModel = traceGraph.getTraceSpanCardModel(spanRef);
  if (cardModel) {
    for (const entry of cardModel.visibleIncomingDependencyEntries) {
      addVisibleDependencyRef(entry.visibleDependencyRef, 'incoming');
    }
    for (const entry of cardModel.visibleOutgoingDependencyEntries) {
      addVisibleDependencyRef(entry.visibleDependencyRef, 'outgoing');
    }
  }

  return {
    localDependencyRefs: [...localDependencyRefs],
    crossDependencyRefs: [...crossDependencyRefs],
    incomingLocalDependencyRefs: [...incomingLocalDependencyRefs],
    incomingCrossDependencyRefs: [...incomingCrossDependencyRefs],
    outgoingLocalDependencyRefs: [...outgoingLocalDependencyRefs],
    outgoingCrossDependencyRefs: [...outgoingCrossDependencyRefs]
  };
}

/**
 * Builds selected dependency direction maps, with incoming dependencies winning ties.
 */
export function buildTraceSelectedDependencyDirectionMaps(
  input: TraceSelectedDependencyDirectionMapInput
): TraceSelectedDependencyDirectionMaps {
  const localDependencyDirectionByRef = new Map<
    VisibleLocalDependencyRef,
    TraceSelectedDependencyDirection
  >();
  const crossDependencyDirectionByRef = new Map<
    VisibleCrossDependencyRef,
    TraceSelectedDependencyDirection
  >();

  addDependencyDirections(
    localDependencyDirectionByRef,
    input.outgoingLocalDependencyRefs,
    'outgoing'
  );
  addDependencyDirections(
    crossDependencyDirectionByRef,
    input.outgoingCrossDependencyRefs,
    'outgoing'
  );
  addDependencyDirections(
    localDependencyDirectionByRef,
    input.incomingLocalDependencyRefs,
    'incoming'
  );
  addDependencyDirections(
    crossDependencyDirectionByRef,
    input.incomingCrossDependencyRefs,
    'incoming'
  );

  return {
    localDependencyDirectionByRef,
    crossDependencyDirectionByRef
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
  for (const dependencyRef of input.localDependencyRefs ?? []) {
    addVisibleDependencyEndpointSpanRefs(traceGraph, dependencyRef, spanRefs);
  }
  for (const dependencyRef of input.crossDependencyRefs ?? []) {
    addVisibleDependencyEndpointSpanRefs(traceGraph, dependencyRef, spanRefs);
  }
  return [...spanRefs];
}

/**
 * Builds selected local-dependency render sources grouped by process id.
 */
export function buildTraceSelectedLocalDependencySourcesByProcessId(
  traceGraph: Readonly<TraceGraph>,
  selectedDependencyRefs: ReadonlySet<VisibleLocalDependencyRef> | null | undefined,
  clickedDependencyRefs: readonly VisibleLocalDependencyRef[],
  directionOptions?: Pick<
    TraceSelectedDependencySourceDirectionOptions,
    'selectedLocalDependencyDirectionByRef' | 'clickedLocalDependencyDirectionByRef'
  >
): TraceSelectedLocalDependencySourcesByProcessId {
  if ((selectedDependencyRefs?.size ?? 0) === 0 && clickedDependencyRefs.length === 0) {
    return {};
  }

  const selectedSourcesByRef = new Map<
    VisibleLocalDependencyRef,
    TraceGraphSelectedLocalDependencySource
  >();
  const addLocalDependencySource = (source: TraceGraphSelectedLocalDependencySource | null) => {
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
      directionOptions?.selectedLocalDependencyDirectionByRef?.get(dependencyRef);
    addLocalDependencySource(
      traceGraph.getVisibleSelectedLocalDependencySources([dependencyRef], selectedDirection)[0] ??
        null
    );
  }
  for (const dependencyRef of clickedDependencyRefs) {
    const selectedDirection =
      directionOptions?.clickedLocalDependencyDirectionByRef?.get(dependencyRef);
    addLocalDependencySource(
      traceGraph.getVisibleSelectedLocalDependencySources([dependencyRef], selectedDirection)[0] ??
        null
    );
  }

  if (selectedSourcesByRef.size === 0) {
    return {};
  }

  return Array.from(selectedSourcesByRef.values()).reduce<
    Partial<Record<string, TraceGraphSelectedLocalDependencySource[]>>
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
 * Builds selected cross-dependency render sources from canonical visible dependency refs.
 */
export function buildTraceSelectedCrossDependencySources(
  traceGraph: Readonly<TraceGraph>,
  selectedDependencyRefs: ReadonlySet<VisibleCrossDependencyRef> | null | undefined,
  clickedDependencyRefs: readonly VisibleCrossDependencyRef[],
  directionOptions?: Pick<
    TraceSelectedDependencySourceDirectionOptions,
    'selectedCrossDependencyDirectionByRef' | 'clickedCrossDependencyDirectionByRef'
  >
): TraceSelectedCrossDependencySources {
  if ((selectedDependencyRefs?.size ?? 0) === 0 && clickedDependencyRefs.length === 0) {
    return [];
  }

  const selectedSourcesByRef = new Map<
    VisibleCrossDependencyRef,
    TraceGraphSelectedCrossDependencySource
  >();
  const addCrossDependencySource = (source: TraceGraphSelectedCrossDependencySource | null) => {
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
      directionOptions?.selectedCrossDependencyDirectionByRef?.get(dependencyRef);
    addCrossDependencySource(
      traceGraph.getVisibleSelectedCrossDependencySources([dependencyRef], selectedDirection)[0] ??
        null
    );
  }
  for (const dependencyRef of clickedDependencyRefs) {
    const selectedDirection =
      directionOptions?.clickedCrossDependencyDirectionByRef?.get(dependencyRef);
    addCrossDependencySource(
      traceGraph.getVisibleSelectedCrossDependencySources([dependencyRef], selectedDirection)[0] ??
        null
    );
  }

  return Array.from(selectedSourcesByRef.values());
}

/**
 * Resolves exact visible local dependencies from canonical visible dependency refs.
 */
export function getVisibleLocalDependenciesByRef(
  traceGraph: Readonly<TraceGraph>,
  dependencyRefs: readonly VisibleLocalDependencyRef[]
): TraceLocalDependencySource[] {
  return dependencyRefs.flatMap(dependencyRef => {
    const dependency = traceGraph.getVisibleDependencySourceByRef(dependencyRef);
    return dependency?.type === 'trace-local-dependency' ? [dependency] : [];
  });
}

/**
 * Resolves exact visible cross-process dependencies from canonical visible dependency refs.
 */
export function getVisibleCrossDependenciesByRef(
  traceGraph: Readonly<TraceGraph>,
  dependencyRefs: readonly VisibleCrossDependencyRef[]
): TraceCrossDependencySource[] {
  return dependencyRefs.flatMap(dependencyRef => {
    const dependency = traceGraph.getVisibleDependencySourceByRef(dependencyRef);
    return dependency?.type === 'trace-cross-process-dependency' ? [dependency] : [];
  });
}

/** Selected local-dependency sources grouped by process id. */
export type TraceSelectedLocalDependencySourcesByProcessId = Readonly<
  Partial<Record<string, readonly TraceGraphSelectedLocalDependencySource[]>>
>;

/** Selected cross-dependency sources for ref-native selection rendering. */
export type TraceSelectedCrossDependencySources =
  readonly TraceGraphSelectedCrossDependencySource[];

function addDependencyDirections<
  TRef extends VisibleLocalDependencyRef | VisibleCrossDependencyRef
>(
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
  dependencyRef: VisibleDependencyRef,
  spanRefs: Set<SpanRef>
): void {
  const startSpanRef = traceGraph.getVisibleDependencyStartSpan(dependencyRef);
  if (startSpanRef != null) {
    spanRefs.add(startSpanRef);
  }
  const endSpanRef = traceGraph.getVisibleDependencyEndSpan(dependencyRef);
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
