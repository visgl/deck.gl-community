import type {TraceProcessActivityAggregation} from './collapsed-activity';
import type {
  CounterRef,
  EventRef,
  InstantRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from './trace-id-encoder';

// TODO -remove
// a generic Brand<B,T> which tags T with a phantom __brand of type B
type Branded<B extends string, T> = T & {readonly __brand: B};

/** Applies a compile-time brand to a runtime value without changing the value. */
export const brand = <B extends string, T>(value: T): Branded<B, T> => {
  return value as Branded<B, T>;
};

/** Removes a compile-time brand and returns the underlying runtime value. */
export const unbrand = <B extends string, T>(value: Branded<B, T>): T => {
  return value as T;
};

/** A typed string identifier for ranks */
export type TraceProcessId = Branded<'rank', string>;
/** A typed string identifier for streams */
export type TraceThreadId = Branded<'stream', string>;
/** A typed string identifier for spans */
export type TraceSpanId = Branded<'block', string>;
/** A typed string identifier for instants */
export type TraceInstantId = Branded<'instant', string>;
/** A typed string identifier for counters */
export type TraceCounterId = Branded<'counter', string>;
/** A typed string identifier for graph-global events */
export type TraceEventId = Branded<'event', string>;
/** A typed string identifier for dependencies */
export type TraceDependencyId = Branded<'dependency', string>;
/** A packed safe-integer reference for one exact graph-global chunk span row. */
export type SpanRef = Branded<'span-ref', number>;
/** A packed safe-integer reference for one process-local span/dependency row. */
export type LocalSpanRef = Branded<'local-span-ref', number>;

/** A typed string identifier for partial cross-rank dependencies */
export type TraceCrossProcessEndpointId = Branded<'endpoint', string>;

/** Controls whether trace spans render per thread or on combined process rows. */
export type TrackAggregationMode = 'separate-threads' | 'combine-threads';

/** Controls whether span vertical geometry is generated or author-provided. */
export type TraceSpanLayoutMode = 'auto' | 'manual';

/** Trackpad swipe behavior used for timeline interaction. */
export type TraceInteractionMode = 'drag-to-zoom' | 'drag-to-pan';

export type TraceVisSettings = {
  showDependencies: boolean;
  /** Mode for filtering local dependencies when shown */
  localDependencyMode: 'all' | 'warnings' | 'submit';
  showCrossProcessDependencies: boolean;
  showInstants: boolean;
  showCounters: boolean;
  /** Whether to render graph-global events on a dedicated top row. */
  showGlobalEvents?: boolean;
  /** Whether to enable deck.gl layer transitions. */
  transitions: boolean;
  /** Whether to fade to highlighted critical paths and how to animate them. */
  followCriticalPathAnimationMode?: 'none' | 'animate' | 'follow';
  showPathsOnly: boolean;
  /** Whether to render the interactive overview mini-map. */
  showOverview: boolean;
  dependencyDisplayMode: 'all' | 'exclude' | 'include';
  dependencyKeywords: string[];
  dependencyOpacity: number;
  /** Alpha multiplier applied to non-highlighted spans when highlighted span refs are set. */
  highlightFadeFactor?: number;
  /** Alpha multiplier applied to non-highlighted spans when extended selection fade is active. */
  extendedSelectionFadeOpacity?: number;
  /** Whether to use the extended selection fade opacity for non-highlighted spans. */
  useExtendedSelectionFadeOpacity?: boolean;
  /** Milliseconds between steps of the critical path animation. */
  criticalPathAnimationIntervalMs?: number;
  /** Number of spans to keep in the animation trail when animating critical paths. */
  criticalPathTrailSpanLength?: number;
  minSpanTimeMs: number;
  /** Minimum rendered span width in screen pixels. Defaults to 2. */
  minSpanWidthPixels?: number;
  threadDisplayMode: 'all' | 'active' | 'selected' | 'minimal';
  selectedThreadNames?: string[];
  /** Whether to sort streams by numeric-aware thread names. */
  sortThreads: boolean;
  lineRoutingMode: 'straight' | 'curve';
  /** Vertical spacing preset for the timeline layout. */
  layoutDensity:
    | 'comfortable'
    | 'compact'
    | 'compact-spacious-processes'
    | 'ultra-compact'
    | 'flamegraph';
  /** Maximum lanes rendered before deeper lanes are folded into overflow summaries. */
  maxVisibleLanesPerThread?: number;
  /** Whether to render all lanes without applying maxVisibleLanesPerThread. Defaults to true. */
  maxVisibleLanesUnlimited?: boolean;
  processLayoutMode: 'step1' | 'sequential' | 'interleaved';
  /** Whether to retain process rows that have no displayable spans after filtering. */
  showEmptyProcesses?: boolean;
  /** Horizontal translation applied to trace geometry in milliseconds. */
  traceOffsetMs: number;
  /** Horizontal scale multiplier applied to trace geometry. */
  traceScale: number;
  /** Comma/newline/semicolon-separated literal prefixes or explicit `/regex/flags` filters. */
  spanFilter?: string;
  /** IATA time zone name */
  timezone?: string;
  /** Select from multiple trace color schemes */
  traceColorSchemeId: string;
  /** Optional timing key used by aggregated traces to choose an active timing projection. */
  traceRunSummaryAggregationKey?: string;
  /** Controls whether layout rows are per thread or per process. */
  trackAggregationMode: TrackAggregationMode;
  /** Aggregation algorithm used to summarize collapsed process activity rows. */
  processOverviewAggregation?: TraceProcessActivityAggregation;
  /** Trackpad swipe behavior used for timeline interaction. */
  interactionMode?: TraceInteractionMode;
};

export type TracePath = {
  type: 'trace-path';
  pathId: string;
  /** Canonical set of visible span refs in this runtime path. */
  spanRefSet: Set<SpanRef>;
  /** Optional ordered visible span refs as they appear in the path. */
  orderedSpanRefs?: SpanRef[];
  /** Canonical set of visible local dependency refs in this runtime path. */
  visibleLocalDependencyRefSet: Set<VisibleLocalDependencyRef>;
  /** Canonical set of visible cross-process dependency refs in this runtime path. */
  visibleCrossDependencyRefSet: Set<VisibleCrossDependencyRef>;
};

export type TraceProcessInfo = Record<string, string | number>;

export type TraceProcessInfoObject = {
  type: 'trace-process-info';
  processId: string;
  rankNum: number;
  processName: string;
  /** Optional app-provided metadata for the selected trace process. */
  processInfo?: TraceProcessInfo;
  nodeName?: string;
  copyText: string;
};

/**
 * One trace, containing
 * - streams
 * - spans organized into streams
 * - local dependencies
 */
export type TraceProcess = {
  type: 'trace-process';
  /** Warning: this is the API rank id, not the global rank id */
  processId: string;
  /** Human-friendly display name for the rank */
  name: string;
  /** Semantic tags calculated by trace loaders for app-level filtering and presets. */
  tags?: string[];
  /** Stable source process index used by encoded span refs, dependency endpoints, chunk indexes, and compatibility APIs. Do not use this for visual row ordering; use processOrder instead. */
  rankNum: number;
  /** Optional visual row order for trace layout; falls back to rankNum when omitted. */
  processOrder?: number;
  stepNum: number;
  threads: TraceThread[];
  threadMap: Record<string, TraceThread>;
  spans: TraceSpan[];
  spanMap: Record<string, TraceSpan>;
  instants: TraceInstant[];
  instantMap: Record<string, TraceInstant>;
  threadInstantMap: Record<string, TraceInstant[]>;
  counters: TraceCounter[];
  counterMap: Record<string, TraceCounter>;
  threadCounterMap: Record<string, TraceCounter[]>;
  localDependencies: TraceLocalDependency[];
  remoteDependencies: {processId: string; spanId: TraceSpanId}[];
  /** Additional data the application may want to preserve / attach */
  userData?: Record<string, unknown>;
};

/** This is a Trace stream with annotation data calculated for visualization */
export type TraceThread = {
  type: 'trace-thread';
  /** Human-friendly name for the stream */
  name: string;
  threadId: TraceThreadId;

  /** @todo - needed? TraceProcessId? */
  processId: string;

  /** Additional data the application may want to preserve / attach */
  userData?: Record<string, unknown>;
};

/** Trace objects that can appear in the graph */
export type TraceObject =
  | TraceThread
  | TraceSpan
  | TraceEvent
  | TraceInstant
  | TraceCounter
  | TraceLocalDependency
  | TraceCrossProcessDependency
  | TraceProcessInfoObject;

/** One graph-global point-in-time event rendered above all process rows. */
export type TraceEvent<UserDataT extends Record<string, unknown> = Record<string, unknown>> = {
  type: 'trace-event';
  /** Canonical chunk-row runtime ref when supplied by the producer. */
  eventRef?: EventRef;
  eventId: TraceEventId;
  name: string;
  atTimeMs: number;
  userData?: UserDataT;
};

/** One instant event in a trace */
export type TraceInstant<UserDataT extends Record<string, unknown> = Record<string, unknown>> = {
  type: 'trace-instant';
  /** Canonical chunk-row runtime ref when supplied by the producer. */
  instantRef?: InstantRef;
  instantId: TraceInstantId;
  threadId: TraceThreadId;
  name: string;
  atTimeMs: number;
  scope: 'g' | 'p' | 't';
  userData?: UserDataT;
};

/** One counter sample in a trace */
export type TraceCounter<UserDataT extends Record<string, unknown> = Record<string, unknown>> = {
  type: 'trace-counter';
  /** Canonical chunk-row runtime ref when supplied by the producer. */
  counterRef?: CounterRef;
  counterId: TraceCounterId;
  threadId: TraceThreadId;
  name: string;
  atTimeMs: number;
  totalValue: number;
  series: Record<string, number>;
  userData?: UserDataT;
};

export type TraceSpanTiming = {
  /** Completion status of block */
  status: 'not-started' | 'not-finished' | 'finished';
  /** Start time of block */
  startTimeMs: number;
  /** end time of block */
  endTimeMs: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Duration of block */
  durationMsAsString: string;
};

/** One trace block with annotation data calculated for visualization */
export type TraceSpan<UserDataT extends Record<string, unknown> = Record<string, unknown>> = {
  type: 'trace-span';
  /** Canonical packed runtime span reference when materialized by runtime graph helpers. */
  spanRef?: SpanRef;
  /** Global block id */
  spanId: TraceSpanId;
  /** Global stream id */
  threadId: TraceThreadId;
  /** Name of rank */
  processName: string;
  /** Name of block */
  name: string;
  /** Keywords */
  keywords?: string[];

  /** Key for the primary timing measurement. */
  primaryTimingKey: string;
  /** Map of timing measurements, keyed by source. */
  timings: Record<string, TraceSpanTiming>;

  /** Thread-relative top edge used when the owning trace opts into manual span layout. */
  layoutTopY?: number;
  /** Rendered span height used when the owning trace opts into manual span layout. */
  layoutHeight?: number;

  /** Ids to local dependencies of this block */
  localDependencyIds: TraceDependencyId[];
  /** Actual dependencies @todo - Can we drop this? */
  localDependencies: TraceDependency[];

  /** Shared endpoint-group id used to stitch unresolved cross-process dependencies. */
  crossProcessEndpointId: TraceCrossProcessEndpointId | null;
  /** Remote process endpoints waiting to be matched into cross-process dependencies. */
  crossProcessDependencyEndpoints: TraceCrossProcessEndpoint[];

  /** Additional data the application may want to preserve / attach */
  userData?: UserDataT;
};

export type TraceSpanTimingSource = Pick<TraceSpan, 'spanId' | 'primaryTimingKey' | 'timings'>;

export function getPrimaryTiming(block: TraceSpanTimingSource): TraceSpanTiming {
  const primary = block.timings[block.primaryTimingKey];
  if (primary) {
    return primary;
  }
  const fallback = Object.values(block.timings)[0];
  if (fallback) {
    return fallback;
  }
  throw new Error(`TraceSpan ${String(block.spanId)} has no timing entries.`);
}

/** One endpoint of a cross-rank dependency. If we haven't loaded the other rank, this is all we have. */
export type TraceDependency = TraceLocalDependency | TraceCrossProcessDependency;

/**
 * A local dependency between spans in the same rank
 * with annotation data calculated for visualization
 */
export type TraceLocalDependency<
  UserDataT extends Record<string, unknown> = Record<string, unknown>
> = {
  type: 'trace-local-dependency';
  /** Canonical runtime dependency reference when materialized by runtime graph helpers. */
  dependencyRef?: TraceDependencyRef | VisibleLocalDependencyRef;
  /** Canonical runtime span ref for the dependency start span when available. */
  startSpanRef?: SpanRef;
  /** Canonical runtime span ref for the dependency end span when available. */
  endSpanRef?: SpanRef;
  /** Global dependency id */
  dependencyId: TraceDependencyId;
  /** Global id of starting block */
  startSpanId: TraceSpanId;
  /** Global id of end block */
  endSpanId: TraceSpanId;

  keywords: Set<string>;

  /**
   * The wait mode for this dependency affects how waitTimeMs is calculated
   * 'end-to-start' -  from finish of first block to start of the second block (sequential dependency)
   * 'end-to-end' - from finish of first block to finish of second block (parallel dependency)
   * 'start-to-start' - from start of first block to start of the second block (submission of tasks to a queue can continue while the first task starts).
   */
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';
  /** Is this dependency bidirectional? (more of a sync point) */
  bidirectional: boolean;
  /** The wait time for this dependency, i.e. the delay between spans */
  waitTimeMs: number;

  /** Additional data the application may want to preserve / attach */
  userData?: UserDataT;
};

/**
 * This is a cross-rank Trace dependency
 * with annotation data calculated for visualization
 */
export type TraceCrossProcessDependency<
  UserDataT extends Record<string, unknown> = Record<string, unknown>
> = {
  type: 'trace-cross-process-dependency';
  /** Canonical runtime dependency reference when materialized by runtime graph helpers. */
  dependencyRef?: TraceDependencyRef | VisibleCrossDependencyRef;
  /** Canonical runtime span ref for the dependency start span when available. */
  startSpanRef?: SpanRef;
  /** Canonical runtime span ref for the dependency end span when available. */
  endSpanRef?: SpanRef;
  /** Global dependency id */
  dependencyId: TraceDependencyId;
  /** The endpoint ids */
  endpointId: TraceCrossProcessEndpointId;

  startRankNum: number;
  endRankNum: number;

  /** Global id of starting block */
  startSpanId: TraceSpanId;
  /** Global id of end block */
  endSpanId: TraceSpanId;

  /**
   * The wait mode for this dependency affects how waitTimeMs is calculated
   * 'end-to-start' -  from finish of first block to start of the second block (sequential dependency)
   * 'end-to-end' - from finish of first block to finish of second block (parallel dependency)
   * 'start-to-start' - from start of first block to start of the second block (submission of tasks to a queue can continue while the first task starts).
   */
  waitMode: 'end-to-start' | 'end-to-end' | 'start-to-start';

  /** Is this dependency bidirectional? */
  bidirectional: boolean;

  /** Cross Dependency topology */
  topology: string;

  waitTimeMs: number;
  waiting: boolean;
  waitNotFinished: boolean;

  /** Keywords */
  keywords: Set<string>;

  /** Additional data the application may want to preserve / attach */
  userData?: UserDataT;
};

/**
 * Type represents one endpoint of a cross dependency.
 * A rank knows which rank and comm group it depends on, but does not know the block id in that rank.
 * This means that cross dependencies are just "endpoints" that need to be resolved
 * (i.e. combined into actual "dependencies") once those remote ranks actually load.
 */
export type TraceCrossProcessEndpoint<
  UserDataT extends Record<string, unknown> = Record<string, unknown>
> = {
  type: 'cross-process-dependency-endpoint';
  /** Comm Group Id is unique across ranks for this comm goup */
  endpointId: TraceCrossProcessEndpointId;
  /** Span id for the endpoint. */
  spanId: TraceSpanId;
  /** Packed runtime span ref for this endpoint when known. */
  spanRef?: SpanRef;
  /** The rank that has the block in this endpoint */
  startRankNum: number;
  /** The rank we are linking to */
  endRankNum: number;
  /** TBD - we only have islands in cross rank dependencies - @todo how should we use / surface this? */
  islandNum: number;
  /** Time we waited for the other rank */
  waitTimeMs: number;
  /** Are we still waiting? */
  waiting: boolean;
  /** Are we still waiting? @todo How is this different from "waiting" */
  waitNotFinished: boolean;

  /** Additional data the application may want to preserve / attach */
  userData?: UserDataT;
};
