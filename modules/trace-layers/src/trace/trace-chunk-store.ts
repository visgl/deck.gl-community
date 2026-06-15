import {arrowFindUtf8, makeUtf8StringView} from '@deck.gl-community/infovis-layers';
import {
  buildArrowTraceSpanTableFromColumns,
  buildTraceGraphData,
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanTableRowIndex
} from './ingestion/arrow-trace';
import {getHeapUsageProbeFields, log} from './log';
import {finalizeTraceChunkData, isTraceChunk, traceChunkHasSpanRefRow} from './trace-chunk';
import {isTraceChunkData} from './trace-chunk-data';
import {
  getTraceChunkSourceFilterMask,
  getTraceChunkSpanDisplaySource,
  getTraceChunkStoreSpanDisplaySource,
  getTraceChunkStoreSpanFilterNavigation,
  searchTraceChunkStoreSpans
} from './trace-chunk-window';
import {TraceGraph} from './trace-graph/trace-graph';
import {
  areSpanFilterListsEqual,
  buildCompiledTraceSpanFilterPlan,
  normalizeTraceSpanFilters
} from './trace-graph/trace-graph-span-filters';
import {TRACE_SPAN_FILTER_MASK_NONE} from './trace-graph/trace-graph-types';
import {
  encodeChunkRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex
} from './trace-graph/trace-id-encoder';
import {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';

import type {
  ArrowTraceChunk,
  ArrowTraceEventTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSpanTable,
  TraceGraphData,
  TraceSpanArrowColumns
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkData} from './trace-chunk-data';
import type {TraceSpanDisplaySource} from './trace-graph-accessors';
import type {TraceGraphRuntimeSource} from './trace-graph/trace-graph-runtime-source';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanFilterReason,
  TraceGraphSpanSearchRecord,
  TraceGraphSpanStoreAvailability,
  TraceGraphSpanStoreNavigationParams,
  TraceGraphSpanStoreSearchParams,
  TraceSpanFilterMask
} from './trace-graph/trace-graph-types';
import type {ChunkRef, ProcessRef, ThreadRef} from './trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceDependencyId,
  TraceProcessId,
  TraceSpanLayoutMode,
  TraceThreadId
} from './trace-graph/trace-types';

/**
 * Inclusive time window used to select trace retrieval chunks for one visible view.
 */
export type TraceChunkSelectionWindow = {
  /** Inclusive UTC millisecond start of the requested selection window. */
  startTimeMs: number;
  /** Inclusive UTC millisecond end of the requested selection window. */
  endTimeMs: number;
};

/** Default throttling interval for trace-window chunk arrival notifications. */
export const DEFAULT_TRACE_WINDOW_NOTIFY_INTERVAL_MS = 5_000;

/** Error raised when a caller intentionally leaves one chunk descriptor unloaded. */
export class TraceChunkStoreLoadSkippedError extends Error {
  /** Builds one retryable intentional chunk-load skip error. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceChunkStoreLoadSkippedError';
  }
}

/** Returns whether one error intentionally leaves a chunk descriptor unloaded and retryable. */
export function isTraceChunkStoreLoadSkippedError(
  error: unknown
): error is TraceChunkStoreLoadSkippedError {
  return error instanceof Error && error.name === 'TraceChunkStoreLoadSkippedError';
}

/**
 * Long-lived chunk load subscription for one inclusive UTC millisecond trace window.
 */
export type TraceWindow = {
  /** Stable subscription id used for replacement and removal. */
  id: string;
  /** Inclusive UTC millisecond start of the chunk-load window. */
  minTimeMs: number;
  /** Inclusive UTC millisecond end of the chunk-load window. */
  maxTimeMs: number;
  /** Optional throttled notification invoked when new overlapping chunks become ready. */
  onChunksArrived?: (event: TraceWindowChunksArrivedEvent) => void;
  /** Minimum elapsed milliseconds between non-final chunk arrival notifications. */
  notifyIntervalMs?: number;
};

/**
 * Summary emitted when a trace window observes newly ready overlapping chunks.
 */
export type TraceWindowChunksArrivedEvent = {
  /** Registered trace-window id that observed stored chunk arrivals. */
  windowId: string;
  /** Newly ready chunk keys accumulated since the previous trace-window notification. */
  newReadyChunkKeys: readonly string[];
  /** Number of catalog chunks whose descriptor envelopes overlap the registered trace window. */
  matchedChunkCount: number;
  /** Number of matching chunks that are currently stored and ready. */
  readyChunkCount: number;
  /** Number of matching chunks currently sharing in-flight fetches. */
  pendingChunkCount: number;
  /** Number of matching chunks whose latest chunk-load attempt failed and remains retryable. */
  failedChunkCount: number;
  /** Whether every currently matching descriptor has a ready stored payload. */
  isComplete: boolean;
};

/**
 * Generic descriptor for one fetchable trace retrieval chunk.
 */
export type TraceChunkDescriptor = {
  /** Stable store-local chunk key used for retention and in-flight deduplication. */
  chunkKey: string;
  /** Stable chunk-family key used when policies preserve representative coverage. */
  familyKey: string;
  /** Inclusive UTC millisecond start of the descriptor's advertised time envelope. */
  startTimeMs: number;
  /** Inclusive UTC millisecond end of the descriptor's advertised time envelope. */
  endTimeMs: number;
  /** Deterministic chronological leading-edge sort coordinate. */
  sortStartTimeMs: number;
  /** Deterministic chronological trailing-edge sort coordinate. */
  sortEndTimeMs: number;
  /** Advertised span count used by view-selection budget policies. */
  advertisedSpanCount: number;
};

/**
 * Common summary emitted by stored chunk view-selection policies.
 */
export type TraceChunkSelectionSummary = {
  /** Maximum advertised spans allowed across the selected chunk set; null means unlimited. */
  spanBudget: number | null;
  /** Total advertised spans across all matching chunk descriptors. */
  matchedSpanCount: number;
  /** Total advertised spans across the selected visible chunk subset. */
  selectedSpanCount: number;
  /** Number of matching chunk descriptors selected for the visible subset. */
  selectedChunkCount: number;
  /** Number of matching chunk descriptors excluded from the visible subset. */
  omittedChunkCount: number;
  /** Total advertised spans excluded from the visible subset. */
  omittedSpanCount: number;
  /** Whether the visible subset was truncated by the configured span budget. */
  isSpanBudgetCapped: boolean;
};

/**
 * Descriptor selection returned by a trace chunk policy or store query.
 */
export type TraceChunkSelection<TDescriptor extends TraceChunkDescriptor> = {
  /** All catalog descriptors whose time envelopes overlap the requested window. */
  matchingDescriptors: readonly TDescriptor[];
  /** Matching descriptors chosen for the current visible subset. */
  selectedDescriptors: readonly TDescriptor[];
  /** Matching descriptors excluded from the current visible subset. */
  omittedDescriptors: readonly TDescriptor[];
  /** Aggregate selection metrics for status surfaces and diagnostics. */
  summary: TraceChunkSelectionSummary;
};

/**
 * Inputs provided to one pluggable trace chunk selection policy.
 */
export type TraceChunkSelectionPolicyParams<TDescriptor extends TraceChunkDescriptor> = {
  /** Registered chunk descriptors available to the active chunk store. */
  descriptors: readonly TDescriptor[];
  /** Inclusive UTC millisecond window requested by the caller. */
  window: TraceChunkSelectionWindow;
  /** Maximum advertised spans to materialize into the visible subset; null means unlimited. */
  spanBudget: number | null;
};

/**
 * Reusable policy contract for retaining many chunks while materializing one visible subset.
 */
export type TraceChunkSelectionPolicy<TDescriptor extends TraceChunkDescriptor> = {
  /** Select matching and visible chunk descriptors for one requested window. */
  select: (
    params: TraceChunkSelectionPolicyParams<TDescriptor>
  ) => TraceChunkSelection<TDescriptor>;
};

/**
 * Payload returned by a caller-owned loader before the store records it as ready.
 *
 * Generic stores may return their payload directly. Stores specialized on {@link TraceChunk}
 * should return parser-local {@link TraceChunkData}, which the store finalizes during insertion.
 */
export type TraceChunkStoreLoadResult<TPayload> = TPayload | TraceChunkData;

/** Minimal store contract for consuming parser-local trace chunk data. */
export type TraceStore = {
  /** Add parser-local trace chunk data and return the store-finalized chunk. */
  add: (traceChunkData: TraceChunkData) => TraceChunk;
  /** Store-finalized chunks currently owned by the store. */
  readonly chunks: readonly TraceChunk[];
};

/**
 * Progress reported while a trace chunk store ensures descriptor readiness.
 */
export type TraceChunkStoreProgress = {
  /** Number of requested chunk descriptors that are already ready or have finished loading. */
  loadedChunks: number;
  /** Number of requested chunk descriptors that must be ready before ensure completes. */
  totalChunks: number;
};

/**
 * Diagnostics emitted after one trace chunk store ensure pass completes.
 */
export type TraceChunkStoreEnsureSummary = {
  /** Number of requested chunk descriptors passed into the ensure call. */
  requestedChunkCount: number;
  /** Number of requested chunk payloads already ready before ensure started. */
  reusedReadyChunkCount: number;
  /** Number of requested chunk payloads already being fetched by another ensure call. */
  reusedPendingChunkCount: number;
  /** Number of requested chunk payloads newly fetched by this ensure call. */
  fetchedChunkCount: number;
};

/**
 * Ready descriptor and stored payload pair returned after ensure completes.
 */
export type TraceChunkStoreReadyChunk<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Stable store chunk slot encoded into published window span refs. */
  chunkIndex: number;
  /** Typed store chunk reference matching {@link chunkIndex}. */
  chunkRef: ChunkRef;
  /** Registered descriptor associated with the stored chunk payload. */
  descriptor: TDescriptor;
  /** Ready stored chunk payload returned by the caller-owned loader. */
  payload: TPayload;
};

/**
 * Ready descriptor/payload pairs plus retention diagnostics for one ensure pass.
 */
export type TraceChunkStoreEnsureResult<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Ready stored chunk payloads in the same descriptor order requested by ensure. */
  readyChunks: readonly TraceChunkStoreReadyChunk<TPayload, TDescriptor>[];
  /** Aggregate reuse/fetch metrics for the ensure pass. */
  summary: TraceChunkStoreEnsureSummary;
};

/**
 * Inputs accepted by one trace chunk ensure pass.
 */
export type TraceChunkStoreEnsureParams<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Registered descriptors that must be ready before ensure completes. */
  descriptors: readonly TDescriptor[];
  /** Caller-owned async loader that fetches and lightly normalizes one descriptor payload. */
  loadChunk: (descriptor: TDescriptor) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Optional readiness callback used by app-level progress surfaces. */
  onProgress?: (progress: TraceChunkStoreProgress) => void;
};

/**
 * Inputs accepted while registering or refreshing trace-window subscriptions.
 */
export type TraceChunkStoreTraceWindowLoadParams<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = {
  /** Caller-owned async loader that fetches and lightly normalizes one descriptor payload. */
  loadChunk: (descriptor: TDescriptor) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Optional readiness callback used by app-level progress surfaces. */
  onProgress?: (progress: TraceChunkStoreProgress) => void;
};

/**
 * Inputs used to register or replace trace-window subscriptions.
 */
export type TraceChunkStoreRegisterTraceWindowsParams<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = TraceChunkStoreTraceWindowLoadParams<TPayload, TDescriptor> & {
  /** Trace windows to register or replace by stable id. */
  windows: readonly TraceWindow[];
};

/** Optional refresh-time trace-window loading inputs. */
export type TraceChunkStoreDescriptorRefreshParams<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = {
  /** Optional caller-owned async loader used when refreshed descriptors extend trace windows. */
  loadChunk?: (descriptor: TDescriptor) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Optional readiness callback used by app-level progress surfaces. */
  onProgress?: (progress: TraceChunkStoreProgress) => void;
};

/**
 * Source-owned URL codec for converting between stable external span ids and runtime refs.
 */
export type TraceSpanUrlCodec = {
  /** Serialize one runtime span ref into a stable URL span id. */
  serializeSpanRef: (params: TraceSpanUrlSerializeParams) => string | undefined;
  /** Resolve stable URL span ids into runtime span refs for the active graph. */
  deserializeSpanRefs: (params: TraceSpanUrlDeserializeParams) => readonly SpanRef[];
};

/**
 * Inputs for serializing one runtime span ref into a stable URL id.
 */
export type TraceSpanUrlSerializeParams = {
  /** Active Arrow-backed trace graph containing the span ref. */
  traceGraph: Readonly<TraceGraphData>;
  /** Runtime span ref to serialize. */
  spanRef: SpanRef;
};

/**
 * Inputs for resolving stable URL ids into runtime span refs.
 */
export type TraceSpanUrlDeserializeParams = {
  /** Active Arrow-backed trace graph used to resolve span refs. */
  traceGraph: Readonly<TraceGraphData>;
  /** Stable URL span ids to resolve. */
  spanIds: readonly string[];
};

/**
 * Default URL codec that maps span refs to the optional Arrow `external_span_id` column.
 */
export const TRACE_EXTERNAL_SPAN_ID_URL_CODEC: TraceSpanUrlCodec = {
  serializeSpanRef: ({traceGraph, spanRef}) =>
    serializeExternalSpanIdUrlSpanRef(traceGraph, spanRef),
  deserializeSpanRefs: ({traceGraph, spanIds}) =>
    deserializeExternalSpanIdUrlSpanRefs(traceGraph, spanIds)
};

/**
 * Shared inputs used while materializing one trace-window graph from ready chunks.
 */
export type TraceChunkWindowGraphMaterializerParams<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = {
  /** Trace-global append-only process/thread owner-ref allocator for this chunk store identity. */
  ownerRefRegistry: TraceOwnerRefRegistry;
  /** Registered trace window being materialized. */
  window: TraceWindow;
  /** Policy selection used to pick descriptors for the graph query. */
  selection: TraceChunkSelection<TDescriptor>;
  /** Ready stored payloads currently available inside the selected descriptor subset. */
  readyChunks: readonly TraceChunkStoreReadyChunk<TPayload, TDescriptor>[];
};

/**
 * Source-owned materializer that builds one trace-window subset into `TraceGraphData`.
 */
export type TraceChunkWindowGraphMaterializer<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = (
  params: TraceChunkWindowGraphMaterializerParams<TPayload, TDescriptor>
) => TraceGraphData | null;

/**
 * Constructor inputs for one active-run trace chunk store.
 */
export type TraceChunkStoreOptions<TDescriptor extends TraceChunkDescriptor> = {
  /** Stable active-run identity used for diagnostics and caller-side reset checks. */
  identityKey: string;
  /** Active catalog of fetchable retrieval chunk descriptors. */
  descriptors: readonly TDescriptor[];
  /** Policy used to select a visible subset from the active descriptor catalog. */
  selectionPolicy: TraceChunkSelectionPolicy<TDescriptor>;
  /** Source-owned codec for URL span-id serialization, defaulting to `external_span_id` scans. */
  spanUrlCodec?: TraceSpanUrlCodec;
};

/** Cheap retained-state counters owned by one mounted TraceChunkStore. */
export type TraceChunkStoreDiagnostics = {
  /** Number of catalog descriptors registered with the active store. */
  readonly descriptorCount: number;
  /** Number of ready stored payloads retained by the active store. */
  readonly readyChunkCount: number;
  /** Number of chunk payloads currently sharing in-flight loads. */
  readonly pendingChunkCount: number;
  /** Number of chunk keys whose latest load attempt failed and remains retryable. */
  readonly failedChunkCount: number;
  /** Number of active trace-window subscriptions registered with the store. */
  readonly traceWindowCount: number;
  /** Number of source-column span filters currently applied by the store. */
  readonly sourceSpanFilterCount: number;
  /** Monotonic revision incremented whenever source-column span filters change. */
  readonly sourceSpanFilterRevision: number;
};

/** Inputs for creating an eager store over one immutable static trace snapshot. */
export type StaticTraceChunkStoreOptions = {
  /** Stable identity used to scope the static store instance in diagnostics. */
  readonly identityKey: string;
  /** Parser-local chunks to eagerly finalize into the static store. */
  readonly chunks?: readonly TraceChunkData[];
  /** Existing internal graph snapshot used while migrating legacy static callers. */
  readonly traceGraphData?: TraceGraphData;
};

/** Graph metadata accepted when creating a store-backed static runtime source from chunks. */
export type StaticTraceGraphRuntimeSourceMetadataOptions = {
  /** Stable identity used to scope the static store instance in diagnostics. */
  readonly identityKey: string;
  /** Human-friendly trace name used when materializing the runtime graph snapshot. */
  readonly name?: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout?: TraceSpanLayoutMode;
  /** Cross-process dependencies shared across the static graph. */
  readonly crossDependencies?: readonly TraceCrossProcessDependency[];
  /** Optional stable cross-dependency id index preserved from ingestion. */
  readonly crossDependencyIdToIndexMap?: Readonly<Record<TraceDependencyId, number>>;
  /** Canonical graph-global event table. */
  readonly events?: Readonly<ArrowTraceEventTable>;
  /** Optional canonical graph-wide time bounds to preserve from ingestion. */
  readonly timeExtents?: {
    /** Earliest canonical timestamp in the graph. */
    readonly minTimeMs: number;
    /** Latest canonical timestamp in the graph. */
    readonly maxTimeMs: number;
  };
  /** Optional stat overrides preserved from upstream loaders or active span selections. */
  readonly stats?: Partial<TraceGraphStats>;
};

/** Inputs for creating a store-backed runtime source from parser-local chunks. */
export type StaticTraceGraphRuntimeSourceChunkOptions =
  StaticTraceGraphRuntimeSourceMetadataOptions & {
    /** Parser-local chunks to eagerly finalize into the static store. */
    readonly chunks: readonly TraceChunkData[];
    /** Existing graph snapshot is absent when chunks are the ingestion input. */
    readonly traceGraphData?: never;
  };

/** Inputs for creating a store-backed runtime source from an existing internal graph snapshot. */
export type StaticTraceGraphRuntimeSourceGraphDataOptions =
  StaticTraceGraphRuntimeSourceMetadataOptions & {
    /** Existing internal graph snapshot used while migrating legacy static callers. */
    readonly traceGraphData: TraceGraphData;
    /** Parser-local chunks are derived from the internal graph snapshot. */
    readonly chunks?: never;
  };

/** Inputs for creating a store-backed runtime source for one static trace snapshot. */
export type StaticTraceGraphRuntimeSourceOptions =
  | StaticTraceGraphRuntimeSourceChunkOptions
  | StaticTraceGraphRuntimeSourceGraphDataOptions;

/**
 * Generic descriptor-backed chunk store that owns chunk readiness, deduplication, and selection.
 */
export class TraceChunkStore<
  TPayload,
  TDescriptor extends TraceChunkDescriptor = TraceChunkDescriptor
> {
  /** Stable active-run identity string supplied by the caller. */
  readonly identityKey: string;
  /** Source-owned codec for URL span-id serialization in materialized snapshots. */
  readonly spanUrlCodec: TraceSpanUrlCodec;

  private readonly selectionPolicy: TraceChunkSelectionPolicy<TDescriptor>;
  private descriptorMap: Map<string, TDescriptor>;
  private readonly readyPayloads = new Map<string, TPayload>();
  private readonly pendingPayloads = new Map<string, Promise<TPayload>>();
  private readonly failedChunkKeys = new Set<string>();
  private readonly traceWindowSubscriptions = new Map<string, TraceWindowSubscription>();
  private readonly ownerRefRegistry = new TraceOwnerRefRegistry();
  private readonly chunkIndexByKey = new Map<string, number>();
  private readonly chunkKeyByIndex = new Map<number, string>();
  private sourceSpanFilters: readonly string[] = [];
  private sourceSpanFilterPlan = buildCompiledTraceSpanFilterPlan([]);
  /** Monotonic revision incremented whenever source-column span filters change. */
  private sourceSpanFilterRevision = 0;

  /**
   * Create one stored chunk store scoped to a caller-owned active-run identity.
   */
  constructor(options: TraceChunkStoreOptions<TDescriptor>) {
    this.identityKey = options.identityKey;
    this.spanUrlCodec = options.spanUrlCodec ?? TRACE_EXTERNAL_SPAN_ID_URL_CODEC;
    this.selectionPolicy = options.selectionPolicy;
    this.descriptorMap = buildTraceChunkDescriptorMap(options.descriptors);
    this.assignChunkIndexes(options.descriptors);
  }

  /** Store parser-local trace chunk data and return its finalized store-owned chunk. */
  add(traceChunkData: TraceChunkData): TraceChunk {
    const chunk = this.buildStoreTraceChunk(traceChunkData);
    this.readyPayloads.set(traceChunkData.chunkKey, chunk as TPayload);
    this.failedChunkKeys.delete(traceChunkData.chunkKey);
    return chunk;
  }

  /** Store-owned finalized chunks currently stored by this trace chunk store. */
  get chunks(): readonly TraceChunk[] {
    const chunks: TraceChunk[] = [];
    this.readyPayloads.forEach(payload => {
      if (isTraceChunk(payload)) {
        chunks.push(payload);
      }
    });
    return chunks;
  }

  /**
   * Replace the active descriptor catalog without evicting stored or pending chunk payloads.
   */
  async refreshDescriptors(
    descriptors: readonly TDescriptor[],
    traceWindowLoadParams?: TraceChunkStoreDescriptorRefreshParams<TPayload, TDescriptor>
  ): Promise<TraceChunkStoreEnsureResult<TPayload, TDescriptor> | null> {
    this.descriptorMap = buildTraceChunkDescriptorMap(descriptors);
    this.assignChunkIndexes(descriptors);
    if (!traceWindowLoadParams?.loadChunk || this.traceWindowSubscriptions.size === 0) {
      return null;
    }
    return this.ensureRegisteredTraceWindows({
      loadChunk: traceWindowLoadParams.loadChunk,
      onProgress: traceWindowLoadParams.onProgress
    });
  }

  /**
   * Return the current active descriptor catalog in registration order.
   */
  getDescriptors(): readonly TDescriptor[] {
    return [...this.descriptorMap.values()];
  }

  /** Returns cheap retained-state counters without walking stored payloads. */
  getDiagnostics(): TraceChunkStoreDiagnostics {
    return {
      descriptorCount: this.descriptorMap.size,
      readyChunkCount: this.readyPayloads.size,
      pendingChunkCount: this.pendingPayloads.size,
      failedChunkCount: this.failedChunkKeys.size,
      traceWindowCount: this.traceWindowSubscriptions.size,
      sourceSpanFilterCount: this.sourceSpanFilters.length,
      sourceSpanFilterRevision: this.sourceSpanFilterRevision
    };
  }

  /**
   * Register or replace trace-window subscriptions, then load their missing chunks.
   */
  async registerTraceWindows(
    params: TraceChunkStoreRegisterTraceWindowsParams<TPayload, TDescriptor>
  ): Promise<TraceChunkStoreEnsureResult<TPayload, TDescriptor>> {
    params.windows.forEach(window => {
      const previousSubscription = this.traceWindowSubscriptions.get(window.id);
      if (previousSubscription) {
        clearTraceWindowNotificationTimer(previousSubscription);
      }
      this.traceWindowSubscriptions.set(window.id, createTraceWindowSubscription(window));
    });
    return this.ensureTraceWindows({
      windows: params.windows,
      loadChunk: params.loadChunk,
      onProgress: params.onProgress
    });
  }

  /**
   * Remove one trace-window subscription and cancel any delayed notification.
   */
  removeTraceWindow(windowId: string): boolean {
    const subscription = this.traceWindowSubscriptions.get(windowId);
    if (!subscription) {
      return false;
    }
    clearTraceWindowNotificationTimer(subscription);
    return this.traceWindowSubscriptions.delete(windowId);
  }

  /**
   * Return the active trace-window subscriptions in registration order.
   */
  getTraceWindows(): readonly TraceWindow[] {
    return [...this.traceWindowSubscriptions.values()].map(subscription => subscription.window);
  }

  /**
   * Select the catalog chunks that match one window and visible span-budget policy.
   */
  select(params: {
    /** Inclusive UTC millisecond window requested by the caller. */
    window: TraceChunkSelectionWindow;
    /** Maximum advertised spans to materialize into the visible subset; null means unlimited. */
    spanBudget: number | null;
  }): TraceChunkSelection<TDescriptor> {
    return this.selectionPolicy.select({
      descriptors: this.getDescriptors(),
      window: params.window,
      spanBudget: params.spanBudget
    });
  }

  /**
   * Return one loaded stored chunk payload when available.
   */
  getLoadedChunk(chunkKey: string): TPayload | undefined {
    return this.readyPayloads.get(chunkKey);
  }

  /**
   * Return one loaded stored chunk payload by exact store-backed span ref.
   */
  getLoadedChunkBySpanRef(spanRef: SpanRef): TPayload | undefined {
    const chunkKey = this.chunkKeyByIndex.get(getSpanRefChunkIndex(spanRef));
    return chunkKey == null ? undefined : this.getLoadedChunk(chunkKey);
  }

  /**
   * Return one loaded finalized trace chunk by exact store-backed span ref.
   */
  getLoadedTraceChunkBySpanRef(spanRef: SpanRef): TraceChunk | null {
    const payload = this.getLoadedChunkBySpanRef(spanRef);
    if (!payload || !isTraceChunk(payload)) {
      return null;
    }
    return traceChunkHasSpanRefRow(payload, getSpanRefRowIndex(spanRef)) ? payload : null;
  }

  /**
   * Resolve store availability for a span ref missing from a current window graph.
   */
  getSpanRefAvailability(spanRef: SpanRef): TraceGraphSpanStoreAvailability {
    const chunkKey = this.chunkKeyByIndex.get(getSpanRefChunkIndex(spanRef));
    if (chunkKey == null) {
      return 'unknown';
    }

    const loadedPayload = this.getLoadedChunk(chunkKey);
    if (loadedPayload !== undefined) {
      return isTraceChunk(loadedPayload) &&
        !traceChunkHasSpanRefRow(loadedPayload, getSpanRefRowIndex(spanRef))
        ? 'unknown'
        : 'outside-window';
    }

    if (
      this.pendingPayloads.has(chunkKey) ||
      this.failedChunkKeys.has(chunkKey) ||
      this.descriptorMap.has(chunkKey)
    ) {
      return 'not-loaded';
    }

    return 'unknown';
  }

  /**
   * Update source-column filename filters used by store-backed row lookups.
   *
   * This does not trigger descriptor loads or rewrite loaded chunk payloads. Active source-filter
   * masks are computed when graph, card, and hidden-search surfaces inspect specific rows.
   */
  setSourceSpanFilters(spanFilters: readonly string[] | undefined): boolean {
    const normalizedSpanFilters = normalizeTraceSpanFilters(spanFilters);
    if (areSpanFilterListsEqual(this.sourceSpanFilters, normalizedSpanFilters)) {
      return false;
    }

    this.sourceSpanFilters = normalizedSpanFilters;
    this.sourceSpanFilterPlan = buildCompiledTraceSpanFilterPlan(normalizedSpanFilters);
    this.sourceSpanFilterRevision += 1;
    return true;
  }

  /**
   * Return a monotonic revision that changes whenever source-column span filters change.
   */
  getSourceSpanFilterRevision(): number {
    return this.sourceSpanFilterRevision;
  }

  /**
   * Return whether this store has active source-column filename filters.
   */
  hasActiveSourceSpanFilter(): boolean {
    return this.sourceSpanFilters.length > 0;
  }

  /**
   * Return whether the exact store-backed span ref is removed by store-owned filters.
   */
  isFiltered(spanRef: SpanRef): boolean {
    return this.getFilterReason(spanRef).isFiltered;
  }

  /**
   * Return store-owned filtered state and provenance for one exact store-backed span ref.
   */
  getFilterReason(spanRef: SpanRef): TraceGraphSpanFilterReason {
    const filterMask = this.getSpanSourceFilterMask(spanRef);
    return {
      filterMask,
      isFiltered: filterMask !== TRACE_SPAN_FILTER_MASK_NONE,
      state: this.getSpanRefAvailability(spanRef)
    };
  }

  /**
   * Search all ready stored chunk rows without loading additional descriptors.
   */
  searchSpans(params: TraceGraphSpanStoreSearchParams): readonly TraceGraphSpanSearchRecord[] {
    return searchTraceChunkStoreSpans({
      traceChunkStore: this,
      traceGraph: params.traceGraph,
      matchesSearchText: params.matchesSearchText,
      limit: params.limit
    });
  }

  /**
   * Resolve display data for a ready stored chunk row by exact store-backed span ref.
   */
  getSpanDisplaySource(spanRef: SpanRef): TraceSpanDisplaySource | null {
    return getTraceChunkStoreSpanDisplaySource(this, spanRef);
  }

  /**
   * Resolve display data for a loaded chunk-local row without scanning unrelated loaded chunks.
   */
  getLoadedChunkSpanDisplaySource(params: {
    /** Store-local loaded chunk key owning the requested row. */
    chunkKey: string;
    /** Chunk-local span-ref row index encoded into store-owned span refs. */
    spanRefRowIndex: number;
  }): TraceSpanDisplaySource | null {
    const payload = this.getLoadedChunk(params.chunkKey);
    if (!payload || !isTraceChunk(payload)) {
      return null;
    }
    return getTraceChunkSpanDisplaySource(
      payload,
      encodeSpanRef(payload.chunkIndex, params.spanRefRowIndex)
    );
  }

  /**
   * Resolve visible navigation targets for a ready stored chunk row by exact store-backed span ref.
   */
  getSpanFilterNavigation(
    params: TraceGraphSpanStoreNavigationParams
  ): TraceGraphSpanFilterNavigation | null {
    if (!(params.traceGraph instanceof TraceGraph)) {
      return null;
    }
    return getTraceChunkStoreSpanFilterNavigation({
      traceChunkStore: this,
      traceGraph: params.traceGraph,
      spanRef: params.spanRef
    });
  }

  /**
   * Return ready stored payloads for descriptors that have already completed loading.
   */
  getReadyChunks(
    descriptors: readonly TDescriptor[]
  ): readonly TraceChunkStoreReadyChunk<TPayload, TDescriptor>[] {
    return descriptors.flatMap(descriptor => {
      if (!this.readyPayloads.has(descriptor.chunkKey)) {
        return [];
      }
      const payload = this.readyPayloads.get(descriptor.chunkKey) as TPayload;
      return [this.buildReadyChunk(descriptor, payload)];
    });
  }

  /**
   * Materialize immutable graph data for one registered trace window and caller-owned selection.
   */
  materializeTraceGraphDataForWindow(
    windowId: string,
    selection: TraceChunkSelection<TDescriptor>,
    materializer: TraceChunkWindowGraphMaterializer<TPayload, TDescriptor>
  ): TraceGraphData | null {
    const subscription = this.traceWindowSubscriptions.get(windowId);
    if (!subscription) {
      return null;
    }

    const readyChunks = this.getReadyChunks(selection.selectedDescriptors);
    if (readyChunks.length === 0 && selection.selectedDescriptors.length > 0) {
      return null;
    }

    return materializer({
      ownerRefRegistry: this.ownerRefRegistry,
      window: subscription.window,
      selection,
      readyChunks
    });
  }

  /**
   * Ensure every requested descriptor has a stored payload, reusing ready and pending work.
   */
  async ensure(
    params: TraceChunkStoreEnsureParams<TPayload, TDescriptor>
  ): Promise<TraceChunkStoreEnsureResult<TPayload, TDescriptor>> {
    let reusedReadyChunkCount = 0;
    let reusedPendingChunkCount = 0;
    let fetchedChunkCount = 0;
    let loadedChunks = 0;
    const totalChunks = params.descriptors.length;
    const reportProgress = () => {
      params.onProgress?.({loadedChunks, totalChunks});
    };
    const reportChunkReady = () => {
      loadedChunks += 1;
      reportProgress();
    };

    const chunkPromises = params.descriptors.map(async descriptor => {
      if (this.readyPayloads.has(descriptor.chunkKey)) {
        const readyPayload = this.readyPayloads.get(descriptor.chunkKey) as TPayload;
        reusedReadyChunkCount += 1;
        loadedChunks += 1;
        return {
          ...this.buildReadyChunk(descriptor, readyPayload)
        } satisfies TraceChunkStoreReadyChunk<TPayload, TDescriptor>;
      }

      const pendingPayload = this.pendingPayloads.get(descriptor.chunkKey);
      if (pendingPayload) {
        reusedPendingChunkCount += 1;
        return await buildReadyChunkWhenAvailable({
          payloadPromise: pendingPayload,
          reportChunkReady,
          buildReadyChunk: payload => this.buildReadyChunk(descriptor, payload)
        });
      }

      fetchedChunkCount += 1;
      const fetchPromise = params
        .loadChunk(descriptor)
        .then(loadedPayload => {
          const payload = this.prepareLoadedPayload(loadedPayload);
          this.readyPayloads.set(descriptor.chunkKey, payload);
          this.failedChunkKeys.delete(descriptor.chunkKey);
          return payload;
        })
        .catch((error: unknown) => {
          if (!isTraceChunkStoreLoadSkippedError(error)) {
            this.failedChunkKeys.add(descriptor.chunkKey);
          }
          throw error;
        })
        .finally(() => {
          this.pendingPayloads.delete(descriptor.chunkKey);
        })
        .then(payload => {
          this.reportTraceWindowChunkReady(descriptor);
          return payload;
        });
      this.pendingPayloads.set(descriptor.chunkKey, fetchPromise);
      return await buildReadyChunkWhenAvailable({
        payloadPromise: fetchPromise,
        reportChunkReady,
        buildReadyChunk: payload => this.buildReadyChunk(descriptor, payload)
      });
    });

    reportProgress();
    const readyChunks = (await Promise.all(chunkPromises)).filter(isReadyChunk);
    return {
      readyChunks,
      summary: {
        requestedChunkCount: totalChunks,
        reusedReadyChunkCount,
        reusedPendingChunkCount,
        fetchedChunkCount
      }
    };
  }

  /**
   * Ensure every descriptor overlapping the requested trace windows is ready.
   */
  private ensureTraceWindows(
    params: TraceChunkStoreTraceWindowLoadParams<TPayload, TDescriptor> & {
      /** Concrete trace windows whose matching descriptors should load now. */
      windows: readonly TraceWindow[];
    }
  ): Promise<TraceChunkStoreEnsureResult<TPayload, TDescriptor>> {
    return this.ensure({
      descriptors: this.getMatchingDescriptorsForTraceWindows(params.windows),
      loadChunk: params.loadChunk,
      onProgress: params.onProgress
    });
  }

  /**
   * Ensure every descriptor overlapping any currently registered trace window is ready.
   */
  private ensureRegisteredTraceWindows(
    params: TraceChunkStoreTraceWindowLoadParams<TPayload, TDescriptor>
  ): Promise<TraceChunkStoreEnsureResult<TPayload, TDescriptor>> {
    return this.ensureTraceWindows({
      ...params,
      windows: this.getTraceWindows()
    });
  }

  /**
   * Return the stable descriptor union overlapping one or more trace windows.
   */
  private getMatchingDescriptorsForTraceWindows(
    windows: readonly TraceWindow[]
  ): readonly TDescriptor[] {
    const matchingDescriptorsByKey = new Map<string, TDescriptor>();
    windows.forEach(window => {
      this.select({
        window: traceWindowToTraceChunkSelectionWindow(window),
        spanBudget: null
      }).matchingDescriptors.forEach(descriptor => {
        matchingDescriptorsByKey.set(descriptor.chunkKey, descriptor);
      });
    });
    return [...matchingDescriptorsByKey.values()].sort(compareTraceChunkDescriptors);
  }

  /**
   * Record one newly ready stored payload against every overlapping active trace window.
   */
  private reportTraceWindowChunkReady(descriptor: TDescriptor): void {
    this.traceWindowSubscriptions.forEach(subscription => {
      if (
        !doesTraceChunkDescriptorOverlapWindow(
          descriptor,
          traceWindowToTraceChunkSelectionWindow(subscription.window)
        )
      ) {
        return;
      }
      subscription.pendingReadyChunkKeys.add(descriptor.chunkKey);
      this.scheduleTraceWindowNotification(subscription);
    });
  }

  /**
   * Schedule or immediately flush one trace-window readiness notification.
   */
  private scheduleTraceWindowNotification(subscription: TraceWindowSubscription): void {
    if (!subscription.window.onChunksArrived || subscription.pendingReadyChunkKeys.size === 0) {
      return;
    }

    const nowMs = Date.now();
    const notifyIntervalMs =
      subscription.window.notifyIntervalMs ?? DEFAULT_TRACE_WINDOW_NOTIFY_INTERVAL_MS;
    const elapsedMs =
      subscription.lastNotificationTimeMs === null
        ? Number.POSITIVE_INFINITY
        : nowMs - subscription.lastNotificationTimeMs;
    const shouldFlushByInterval = elapsedMs >= notifyIntervalMs;
    const shouldCheckForCompletion = this.pendingPayloads.size === 0;

    if (!shouldFlushByInterval && !shouldCheckForCompletion) {
      this.scheduleDelayedTraceWindowNotification(
        subscription,
        Math.max(0, notifyIntervalMs - elapsedMs)
      );
      return;
    }

    const event = this.buildTraceWindowChunksArrivedEvent(subscription);
    if (event.isComplete) {
      clearTraceWindowNotificationTimer(subscription);
      this.flushTraceWindowNotification(subscription, event);
      return;
    }

    if (shouldFlushByInterval) {
      this.flushTraceWindowNotification(subscription, event);
      return;
    }

    this.scheduleDelayedTraceWindowNotification(
      subscription,
      Math.max(0, notifyIntervalMs - elapsedMs)
    );
  }

  /**
   * Schedule the delayed readiness summary for a throttled trace-window notification.
   */
  private scheduleDelayedTraceWindowNotification(
    subscription: TraceWindowSubscription,
    delayMs: number
  ): void {
    if (subscription.notificationTimer) {
      return;
    }

    subscription.notificationTimer = setTimeout(() => {
      subscription.notificationTimer = null;
      if (!subscription.window.onChunksArrived || subscription.pendingReadyChunkKeys.size === 0) {
        return;
      }
      this.flushTraceWindowNotification(
        subscription,
        this.buildTraceWindowChunksArrivedEvent(subscription)
      );
    }, delayMs);
  }

  /**
   * Emit one trace-window readiness notification and clear the accumulated ready keys.
   */
  private flushTraceWindowNotification(
    subscription: TraceWindowSubscription,
    event: TraceWindowChunksArrivedEvent
  ): void {
    if (!subscription.window.onChunksArrived || event.newReadyChunkKeys.length === 0) {
      return;
    }
    subscription.pendingReadyChunkKeys.clear();
    subscription.lastNotificationTimeMs = Date.now();
    subscription.window.onChunksArrived(event);
  }

  /**
   * Build one readiness summary for the current accumulated window chunk arrivals.
   */
  private buildTraceWindowChunksArrivedEvent(
    subscription: TraceWindowSubscription
  ): TraceWindowChunksArrivedEvent {
    const matchingDescriptors = this.select({
      window: traceWindowToTraceChunkSelectionWindow(subscription.window),
      spanBudget: null
    }).matchingDescriptors;
    const readyChunkCount = matchingDescriptors.filter(descriptor =>
      this.readyPayloads.has(descriptor.chunkKey)
    ).length;
    const pendingChunkCount = matchingDescriptors.filter(descriptor =>
      this.pendingPayloads.has(descriptor.chunkKey)
    ).length;
    const failedChunkCount = matchingDescriptors.filter(descriptor =>
      this.failedChunkKeys.has(descriptor.chunkKey)
    ).length;
    return {
      windowId: subscription.window.id,
      newReadyChunkKeys: [...subscription.pendingReadyChunkKeys].sort(),
      matchedChunkCount: matchingDescriptors.length,
      readyChunkCount,
      pendingChunkCount,
      failedChunkCount,
      isComplete: readyChunkCount === matchingDescriptors.length
    };
  }

  /**
   * Assign append-only chunk storage slots to descriptors in catalog registration order.
   */
  private assignChunkIndexes(descriptors: readonly TDescriptor[]): void {
    descriptors.forEach(descriptor => {
      this.ensureChunkIndex(descriptor.chunkKey);
    });
  }

  /** Return the append-only store slot for a chunk key, assigning one when needed. */
  private ensureChunkIndex(chunkKey: string): number {
    const existingChunkIndex = this.chunkIndexByKey.get(chunkKey);
    if (existingChunkIndex != null) {
      return existingChunkIndex;
    }
    const chunkIndex = this.chunkIndexByKey.size;
    this.chunkIndexByKey.set(chunkKey, chunkIndex);
    this.chunkKeyByIndex.set(chunkIndex, chunkKey);
    return chunkIndex;
  }

  /**
   * Build one ready stored chunk record with its stable store-local storage slot.
   */
  private buildReadyChunk(
    descriptor: TDescriptor,
    payload: TPayload
  ): TraceChunkStoreReadyChunk<TPayload, TDescriptor> {
    const chunkIndex = this.chunkIndexByKey.get(descriptor.chunkKey);
    if (chunkIndex == null) {
      throw new Error(`Missing trace chunk index for ${descriptor.chunkKey}`);
    }
    return {
      chunkIndex,
      chunkRef: encodeChunkRef(chunkIndex),
      descriptor,
      payload
    };
  }

  /** Convert one loader result into the payload type stored by this store. */
  private prepareLoadedPayload(loadedPayload: TraceChunkStoreLoadResult<TPayload>): TPayload {
    return isTraceChunkData(loadedPayload)
      ? (this.buildStoreTraceChunk(loadedPayload) as TPayload)
      : (loadedPayload as TPayload);
  }

  /** Finalize parser-local trace chunk data using this store's stable chunk and owner refs. */
  private buildStoreTraceChunk(traceChunkData: TraceChunkData): TraceChunk {
    const chunkIndex = this.ensureChunkIndex(traceChunkData.chunkKey);
    registerTraceChunkDataProcesses(traceChunkData, this.ownerRefRegistry);
    const spanTable = finalizeTraceChunkSpanTableRefs(traceChunkData, this.ownerRefRegistry);
    const chunk = finalizeTraceChunkData({
      data: {
        ...traceChunkData,
        processes: buildTraceChunkStoreProcesses(this.ownerRefRegistry),
        spanTable
      },
      chunkIndex,
      chunkRef: encodeChunkRef(chunkIndex),
      processRefs: readTraceChunkSpanTableProcessRefs(spanTable)
    });
    log.probe(0, 'TraceChunkStore finalized TraceChunkData', {
      chunkKey: chunk.chunkKey,
      chunkIndex: chunk.chunkIndex,
      diagnosticRowCount: chunk.diagnostics.rowCount,
      invalidRecordCount: chunk.diagnostics.invalidRecordCount,
      rowCount: chunk.metadata.rowCount,
      processRefCount: chunk.processRefs.length,
      processCount: chunk.processes.length,
      sourceDependencyRowCount: chunk.sourceDependencyTable?.rows.length ?? 0,
      windowRowCount: chunk.rowWindowTable?.overlapRangesByRow.length ?? 0,
      minTimeMs: chunk.diagnostics.minTimeMs,
      maxTimeMs: chunk.diagnostics.maxTimeMs,
      ...getHeapUsageProbeFields()
    })();
    return chunk;
  }

  /**
   * Return the source-column filename filter mask for one exact store-backed span ref.
   */
  private getSpanSourceFilterMask(spanRef: SpanRef): TraceSpanFilterMask {
    const payload = this.getLoadedChunkBySpanRef(spanRef);
    return payload && isTraceChunk(payload) && this.hasActiveSourceSpanFilter()
      ? getTraceChunkSourceFilterMask(
          payload,
          getSpanRefRowIndex(spanRef),
          this.sourceSpanFilterPlan
        )
      : TRACE_SPAN_FILTER_MASK_NONE;
  }
}

/**
 * Convert one trace-window subscription into the existing view-selection window shape.
 */
export function traceWindowToTraceChunkSelectionWindow(
  traceWindow: TraceWindow
): TraceChunkSelectionWindow {
  return {
    startTimeMs: traceWindow.minTimeMs,
    endTimeMs: traceWindow.maxTimeMs
  };
}

/**
 * Create an eager chunk store for a static Arrow trace snapshot.
 *
 * Static stores preserve the snapshot's existing dense Arrow chunk indexes so SpanRefs already
 * encoded in the snapshot continue to resolve through the store.
 */
export function createStaticTraceChunkStore(
  options: StaticTraceChunkStoreOptions
): TraceChunkStore<TraceChunk, TraceChunkDescriptor> {
  const chunks = resolveStaticTraceChunkData(options);
  assertStaticTraceChunkDataKeys(chunks);
  const traceChunkStore = new TraceChunkStore<TraceChunk, TraceChunkDescriptor>({
    identityKey: options.identityKey,
    descriptors: chunks.map(buildStaticTraceChunkDescriptor),
    selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy()
  });
  chunks.forEach(chunk => traceChunkStore.add(chunk));
  return traceChunkStore;
}

/**
 * Create a store-backed runtime source for static parser-local chunks and graph metadata.
 */
export function createStaticTraceGraphRuntimeSource(
  options: StaticTraceGraphRuntimeSourceChunkOptions
): TraceGraphRuntimeSource;
export function createStaticTraceGraphRuntimeSource(
  options: StaticTraceGraphRuntimeSourceGraphDataOptions
): TraceGraphRuntimeSource;
export function createStaticTraceGraphRuntimeSource(
  options: StaticTraceGraphRuntimeSourceOptions
): TraceGraphRuntimeSource {
  const traceStore = createStaticTraceChunkStore(options);
  return {
    traceGraphData:
      options.traceGraphData ?? buildStaticTraceGraphDataFromStore(options, traceStore),
    traceStore
  };
}

/**
 * Create the default chronological advertised-span budget policy used by trace chunk stores.
 */
export function createChronologicalTraceChunkSpanBudgetPolicy<
  TDescriptor extends TraceChunkDescriptor
>(): TraceChunkSelectionPolicy<TDescriptor> {
  return {
    select: ({descriptors, window, spanBudget}) =>
      selectTraceChunksByChronologicalSpanBudget({
        descriptors,
        window,
        spanBudget
      })
  };
}

/**
 * Build one deterministic chronological span-budget descriptor selection.
 */
function selectTraceChunksByChronologicalSpanBudget<TDescriptor extends TraceChunkDescriptor>(
  params: TraceChunkSelectionPolicyParams<TDescriptor>
): TraceChunkSelection<TDescriptor> {
  const matchingDescriptors = params.descriptors
    .filter(descriptor => doesTraceChunkDescriptorOverlapWindow(descriptor, params.window))
    .sort(compareTraceChunkDescriptors);
  const matchedSpanCount = sumAdvertisedSpanCounts(matchingDescriptors);

  if (params.spanBudget === null) {
    return {
      matchingDescriptors,
      selectedDescriptors: matchingDescriptors,
      omittedDescriptors: [],
      summary: {
        spanBudget: null,
        matchedSpanCount,
        selectedSpanCount: matchedSpanCount,
        selectedChunkCount: matchingDescriptors.length,
        omittedChunkCount: 0,
        omittedSpanCount: 0,
        isSpanBudgetCapped: false
      }
    };
  }

  const selectedDescriptorsByFamily = buildDescriptorFamilies(matchingDescriptors);
  const minimumSelectedCounts = new Map(
    [...selectedDescriptorsByFamily.entries()].map(([familyKey, descriptors]) => [
      familyKey,
      descriptors.length > 0 ? 1 : 0
    ])
  );
  let selectedSpanCount = matchedSpanCount;

  while (selectedSpanCount > params.spanBudget) {
    const droppableFamilyTails = [...selectedDescriptorsByFamily.entries()].flatMap(
      ([familyKey, descriptors]) => {
        const minimumSelectedCount = minimumSelectedCounts.get(familyKey) ?? 0;
        if (descriptors.length <= minimumSelectedCount) {
          return [];
        }
        const descriptor = descriptors[descriptors.length - 1];
        return descriptor ? [{familyKey, descriptor}] : [];
      }
    );
    if (droppableFamilyTails.length === 0) {
      break;
    }

    const latestTail = droppableFamilyTails.reduce((currentLatest, candidate) =>
      compareTraceChunkDescriptorEnds(candidate.descriptor, currentLatest.descriptor) > 0
        ? candidate
        : currentLatest
    );
    const tailsToDrop = droppableFamilyTails.filter(
      candidate =>
        compareTraceChunkDescriptorEnds(candidate.descriptor, latestTail.descriptor) === 0
    );

    tailsToDrop.forEach(({familyKey, descriptor}) => {
      const selectedFamilyDescriptors = selectedDescriptorsByFamily.get(familyKey);
      if (!selectedFamilyDescriptors) {
        return;
      }
      const removedDescriptor = selectedFamilyDescriptors.pop();
      if (!removedDescriptor) {
        return;
      }
      selectedSpanCount -= descriptor.advertisedSpanCount;
    });
  }

  const selectedDescriptorKeys = new Set(
    [...selectedDescriptorsByFamily.values()].flatMap(descriptors =>
      descriptors.map(descriptor => descriptor.chunkKey)
    )
  );
  const selectedDescriptors = matchingDescriptors.filter(descriptor =>
    selectedDescriptorKeys.has(descriptor.chunkKey)
  );
  const omittedDescriptors = matchingDescriptors.filter(
    descriptor => !selectedDescriptorKeys.has(descriptor.chunkKey)
  );

  return {
    matchingDescriptors,
    selectedDescriptors,
    omittedDescriptors,
    summary: {
      spanBudget: params.spanBudget,
      matchedSpanCount,
      selectedSpanCount,
      selectedChunkCount: selectedDescriptors.length,
      omittedChunkCount: omittedDescriptors.length,
      omittedSpanCount: sumAdvertisedSpanCounts(omittedDescriptors),
      isSpanBudgetCapped: omittedDescriptors.length > 0
    }
  };
}

/**
 * Build a stable chunk-key descriptor lookup while preserving registration order.
 */
function buildTraceChunkDescriptorMap<TDescriptor extends TraceChunkDescriptor>(
  descriptors: readonly TDescriptor[]
): Map<string, TDescriptor> {
  const descriptorMap = new Map<string, TDescriptor>();
  descriptors.forEach(descriptor => {
    descriptorMap.set(descriptor.chunkKey, descriptor);
  });
  return descriptorMap;
}

/**
 * Resolve static parser-local chunk data from the primary chunk input or the legacy snapshot bridge.
 */
function resolveStaticTraceChunkData(
  options: StaticTraceChunkStoreOptions
): readonly TraceChunkData[] {
  if (options.chunks) {
    return options.chunks;
  }
  if (options.traceGraphData) {
    return getDenseStaticTraceChunks(options.traceGraphData).map(chunk =>
      buildStaticTraceChunkData(options.traceGraphData as TraceGraphData, chunk)
    );
  }
  throw new Error('Static trace runtime sources require chunks or traceGraphData.');
}

/**
 * Assert that static parser-local chunk data can be assigned deterministic dense store indexes.
 */
function assertStaticTraceChunkDataKeys(chunks: readonly TraceChunkData[]): void {
  const seenChunkKeys = new Set<string>();
  chunks.forEach(chunk => {
    if (seenChunkKeys.has(chunk.chunkKey)) {
      throw new Error(`Static trace chunks must have unique chunk keys; found ${chunk.chunkKey}.`);
    }
    seenChunkKeys.add(chunk.chunkKey);
  });
}

/**
 * Return static graph chunks in the dense store index order required by SpanRefs.
 */
function getDenseStaticTraceChunks(traceGraphData: TraceGraphData): readonly ArrowTraceChunk[] {
  const chunks = [...traceGraphData.chunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex
  );
  const seenChunkKeys = new Set<string>();
  chunks.forEach((chunk, index) => {
    if (chunk.chunkIndex !== index) {
      throw new Error(
        `Static trace chunks must use dense chunk indexes; expected ${index}, got ${chunk.chunkIndex}.`
      );
    }
    if (seenChunkKeys.has(chunk.chunkKey)) {
      throw new Error(`Static trace chunks must have unique chunk keys; found ${chunk.chunkKey}.`);
    }
    seenChunkKeys.add(chunk.chunkKey);
  });
  return chunks;
}

/**
 * Build one descriptor for an eager static parser-local chunk.
 */
function buildStaticTraceChunkDescriptor(chunk: TraceChunkData): TraceChunkDescriptor {
  const timeRange = getStaticTraceChunkDataTimeRange(chunk);
  return {
    chunkKey: chunk.chunkKey,
    familyKey: 'static',
    startTimeMs: timeRange.startTimeMs,
    endTimeMs: timeRange.endTimeMs,
    sortStartTimeMs: timeRange.startTimeMs,
    sortEndTimeMs: timeRange.endTimeMs,
    advertisedSpanCount: chunk.diagnostics.rowCount
  };
}

/**
 * Materialize the internal graph snapshot consumed by runtime TraceGraph from finalized chunks.
 */
function buildStaticTraceGraphDataFromStore(
  options: StaticTraceGraphRuntimeSourceOptions,
  traceStore: TraceChunkStore<TraceChunk, TraceChunkDescriptor>
): TraceGraphData {
  const chunks = traceStore.chunks;
  const processes = collectStaticTraceChunkProcesses(chunks);
  const tableMaps = buildStaticTraceGraphTableMaps(chunks, processes);
  return buildTraceGraphData({
    name: options.name ?? options.identityKey,
    spanLayout: options.spanLayout,
    processes,
    crossDependencies: options.crossDependencies ?? [],
    crossDependencyIdToIndexMap: options.crossDependencyIdToIndexMap,
    events: options.events,
    spanTableMap: tableMaps.spanTableMap,
    localDependencyTableMap: tableMaps.localDependencyTableMap,
    spanSidecarMap: tableMaps.spanSidecarMap,
    spanSidecarTableMap: tableMaps.spanSidecarTableMap,
    chunks,
    timeExtents: options.timeExtents,
    stats: options.stats
  });
}

/**
 * Collect store-finalized process metadata in owner-ref order.
 */
function collectStaticTraceChunkProcesses(
  chunks: readonly TraceChunk[]
): readonly ArrowTraceProcessMetadata[] {
  const processById = new Map<TraceProcessId, ArrowTraceProcessMetadata>();
  chunks.forEach(chunk => {
    chunk.processes.forEach(process => {
      const processId = process.processId as TraceProcessId;
      if (!processById.has(processId)) {
        processById.set(processId, process);
      }
    });
  });
  return [...processById.values()];
}

/**
 * Build process-local table maps from process-scoped static chunks.
 */
function buildStaticTraceGraphTableMaps(
  chunks: readonly TraceChunk[],
  processes: readonly ArrowTraceProcessMetadata[]
): {
  readonly spanTableMap: Record<TraceProcessId, ArrowTraceSpanTable>;
  readonly localDependencyTableMap: Record<TraceProcessId, TraceChunk['localDependencyTable']>;
  readonly spanSidecarMap: Record<TraceProcessId, NonNullable<TraceChunk['spanSidecarRows']>>;
  readonly spanSidecarTableMap: Record<TraceProcessId, NonNullable<TraceChunk['spanSidecarTable']>>;
} {
  const processIdsByIndex = processes.map(process => process.processId as TraceProcessId);
  const processIds = new Set(processIdsByIndex);
  const spanTableMap: Record<TraceProcessId, ArrowTraceSpanTable> = {};
  const localDependencyTableMap: Record<TraceProcessId, TraceChunk['localDependencyTable']> = {};
  const spanSidecarMap: Record<TraceProcessId, NonNullable<TraceChunk['spanSidecarRows']>> = {};
  const spanSidecarTableMap: Record<
    TraceProcessId,
    NonNullable<TraceChunk['spanSidecarTable']>
  > = {};

  chunks.forEach(chunk => {
    const processId = getStaticTraceChunkProcessId(chunk, processIdsByIndex, processIds);
    if (processId == null) {
      return;
    }
    spanTableMap[processId] = chunk.spanTable;
    localDependencyTableMap[processId] = chunk.localDependencyTable;
    if (chunk.spanSidecarRows) {
      spanSidecarMap[processId] = chunk.spanSidecarRows;
    }
    if (chunk.spanSidecarTable) {
      spanSidecarTableMap[processId] = chunk.spanSidecarTable;
    }
  });

  return {
    spanTableMap,
    localDependencyTableMap,
    spanSidecarMap,
    spanSidecarTableMap
  };
}

/**
 * Return the single owning process id for a static process-scoped chunk.
 */
function getStaticTraceChunkProcessId(
  chunk: TraceChunk,
  processIdsByIndex: readonly TraceProcessId[],
  processIds: ReadonlySet<TraceProcessId>
): TraceProcessId | null {
  if (chunk.processRefs.length > 1) {
    throw new Error(
      `Static TraceChunkData chunks must be process-scoped; ${chunk.chunkKey} has ${chunk.processRefs.length} process refs.`
    );
  }
  const processRef = chunk.processRefs[0];
  if (processRef != null) {
    const processId = processIdsByIndex[getProcessRefIndex(processRef)];
    if (!processId) {
      throw new Error(`Missing process metadata for static chunk ${chunk.chunkKey}.`);
    }
    return processId;
  }
  return processIds.has(chunk.chunkKey as TraceProcessId)
    ? (chunk.chunkKey as TraceProcessId)
    : null;
}

/**
 * Wrap one existing Arrow chunk as parser-local data for eager static store finalization.
 */
function buildStaticTraceChunkData(
  traceGraphData: TraceGraphData,
  chunk: ArrowTraceChunk
): TraceChunkData {
  const timeRange = getStaticTraceTimeRange(traceGraphData, chunk.spanTable.numRows);
  return {
    type: 'trace-chunk-data',
    chunkKey: chunk.chunkKey,
    processes: traceGraphData.processes,
    spanTable: chunk.spanTable,
    localDependencyTable: chunk.localDependencyTable,
    spanSidecarRows: chunk.spanSidecarRows,
    spanSidecarTable: chunk.spanSidecarTable,
    diagnostics: {
      rowCount: chunk.spanTable.numRows,
      invalidRecordCount: 0,
      minTimeMs: timeRange.minTimeMs,
      maxTimeMs: timeRange.maxTimeMs,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/**
 * Return a finite descriptor envelope and nullable diagnostics bounds for static chunks.
 */
function getStaticTraceTimeRange(
  traceGraphData: TraceGraphData,
  rowCount: number
): {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
  readonly minTimeMs: number | null;
  readonly maxTimeMs: number | null;
} {
  if (rowCount <= 0) {
    return {startTimeMs: 0, endTimeMs: 0, minTimeMs: null, maxTimeMs: null};
  }
  const startTimeMs = Number.isFinite(traceGraphData.minTimeMs) ? traceGraphData.minTimeMs : 0;
  const endTimeMs = Math.max(
    startTimeMs,
    Number.isFinite(traceGraphData.maxTimeMs) ? traceGraphData.maxTimeMs : startTimeMs
  );
  return {
    startTimeMs,
    endTimeMs,
    minTimeMs: startTimeMs,
    maxTimeMs: endTimeMs
  };
}

/**
 * Return a finite descriptor envelope from parser-local static chunk diagnostics.
 */
function getStaticTraceChunkDataTimeRange(chunk: TraceChunkData): {
  readonly startTimeMs: number;
  readonly endTimeMs: number;
} {
  const startTimeMs = Number.isFinite(chunk.diagnostics.minTimeMs)
    ? (chunk.diagnostics.minTimeMs as number)
    : 0;
  const endTimeMs = Math.max(
    startTimeMs,
    Number.isFinite(chunk.diagnostics.maxTimeMs)
      ? (chunk.diagnostics.maxTimeMs as number)
      : startTimeMs
  );
  return {startTimeMs, endTimeMs};
}

/**
 * Replace parser-local process/thread refs in a chunk span table with store-global owner refs.
 */
function finalizeTraceChunkSpanTableRefs(
  data: TraceChunkData,
  ownerRefRegistry: TraceOwnerRefRegistry
): ArrowTraceSpanTable {
  const processRefs: Array<number | null> = [];
  const threadRefs: Array<number | null> = [];
  let didChangeRefColumn = false;
  const localProcessRefColumn = getTraceChunkSpanTableColumn<unknown>(
    data.spanTable,
    'process_ref'
  );
  const localThreadRefColumn = getTraceChunkSpanTableColumn<unknown>(data.spanTable, 'thread_ref');
  const processIdColumn = getTraceChunkSpanTableColumn<TraceProcessId>(
    data.spanTable,
    'process_id'
  );
  const threadIdColumn = getTraceChunkSpanTableColumn<TraceThreadId>(data.spanTable, 'thread_id');
  for (let rowIndex = 0; rowIndex < data.spanTable.numRows; rowIndex += 1) {
    const localProcessRef = readTraceChunkSpanTableRefValue(localProcessRefColumn, rowIndex);
    const localThreadRef = readTraceChunkSpanTableRefValue(localThreadRefColumn, rowIndex);
    const process = resolveParserLocalProcessForSpanRow(
      data,
      localProcessRef,
      readTraceChunkSpanTableColumnValue(processIdColumn, rowIndex)
    );
    const thread = resolveParserLocalThreadForSpanRow(
      data,
      localThreadRef,
      process,
      readTraceChunkSpanTableColumnValue(threadIdColumn, rowIndex)
    );
    const finalizedProcessRef =
      process == null ? null : ownerRefRegistry.getProcessRef(process.processId as TraceProcessId);
    const finalizedThreadRef =
      thread == null
        ? null
        : ownerRefRegistry.getProcessThreadRef(
            thread.processId as TraceProcessId,
            thread.threadId as TraceThreadId
          );

    processRefs.push(finalizedProcessRef);
    threadRefs.push(finalizedThreadRef);
    didChangeRefColumn ||=
      finalizedProcessRef !== localProcessRef || finalizedThreadRef !== localThreadRef;
  }

  if (!didChangeRefColumn) {
    return data.spanTable;
  }

  const columns: TraceSpanArrowColumns = {
    process_ref: processRefs,
    thread_ref: threadRefs,
    span_id: readRequiredTraceChunkSpanStringColumn(data.spanTable, 'span_id'),
    external_span_id: readNullableTraceChunkSpanStringColumn(data.spanTable, 'external_span_id'),
    thread_id: readRequiredTraceChunkSpanStringColumn(data.spanTable, 'thread_id'),
    name: readRequiredTraceChunkSpanStringColumn(data.spanTable, 'name'),
    source: readNullableTraceChunkSpanStringColumn(data.spanTable, 'source'),
    primary_timing_key: readRequiredTraceChunkSpanStringColumn(
      data.spanTable,
      'primary_timing_key'
    ),
    status: readRequiredTraceChunkSpanStringColumn(data.spanTable, 'status'),
    start_time_ms: readRequiredTraceChunkSpanNumberColumn(data.spanTable, 'start_time_ms'),
    end_time_ms: readRequiredTraceChunkSpanNumberColumn(data.spanTable, 'end_time_ms'),
    duration_ms: readRequiredTraceChunkSpanNumberColumn(data.spanTable, 'duration_ms')
  };
  if (getTraceChunkSpanTableColumn(data.spanTable, 'layout_top_y')) {
    columns.layout_top_y = readNullableTraceChunkSpanNumberColumn(data.spanTable, 'layout_top_y');
  }
  if (getTraceChunkSpanTableColumn(data.spanTable, 'layout_height')) {
    columns.layout_height = readNullableTraceChunkSpanNumberColumn(data.spanTable, 'layout_height');
  }
  return buildArrowTraceSpanTableFromColumns(columns);
}

/**
 * Materialize store-owned process metadata in the same append-only order used by process refs.
 */
function buildTraceChunkStoreProcesses(
  ownerRefRegistry: TraceOwnerRefRegistry
): readonly ArrowTraceProcessMetadata[] {
  return ownerRefRegistry.getOwnerProcessSnapshots().map(process => {
    const threads = [...process.threads];
    return {
      type: process.type,
      processId: process.processId,
      name: process.name,
      tags: process.tags,
      rankNum: process.rankNum,
      processOrder: process.processOrder,
      stepNum: process.stepNum,
      threads,
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      remoteDependencies: [],
      userData: process.userData
    };
  });
}

/**
 * Read the unique store-owned process refs represented by rows in one finalized chunk table.
 */
function readTraceChunkSpanTableProcessRefs(spanTable: ArrowTraceSpanTable): readonly ProcessRef[] {
  const processRefColumn = getTraceChunkSpanTableColumn<unknown>(spanTable, 'process_ref');
  const processRefs: ProcessRef[] = [];
  const seenProcessRefs = new Set<ProcessRef>();
  for (let rowIndex = 0; rowIndex < spanTable.numRows; rowIndex += 1) {
    const processRef = readTraceChunkSpanTableRefValue(processRefColumn, rowIndex);
    if (processRef == null || seenProcessRefs.has(processRef as ProcessRef)) {
      continue;
    }
    processRefs.push(processRef as ProcessRef);
    seenProcessRefs.add(processRef as ProcessRef);
  }
  return processRefs;
}

/**
 * Resolve the parser-local process metadata addressed by one span-table row.
 */
function resolveParserLocalProcessForSpanRow(
  data: TraceChunkData,
  localProcessRef: number | null,
  processId: TraceProcessId | null
): TraceChunkData['processes'][number] | null {
  if (localProcessRef != null) {
    const processIndex = getProcessRefIndex(localProcessRef as ProcessRef);
    return (
      data.processes[processIndex] ??
      data.processes.find(process => process.rankNum === processIndex) ??
      null
    );
  }
  if (processId) {
    return data.processes.find(process => process.processId === processId) ?? null;
  }
  return data.processes.length === 1 ? data.processes[0]! : null;
}

/**
 * Resolve the parser-local thread metadata addressed by one span-table row.
 */
function resolveParserLocalThreadForSpanRow(
  data: TraceChunkData,
  localThreadRef: number | null,
  fallbackProcess: TraceChunkData['processes'][number] | null,
  threadId: TraceThreadId | null
): TraceChunkData['processes'][number]['threads'][number] | null {
  if (localThreadRef != null) {
    const processIndex = getThreadRefProcessIndex(localThreadRef as ThreadRef);
    const threadIndex = getThreadRefThreadIndex(localThreadRef as ThreadRef);
    const process =
      data.processes[processIndex] ??
      data.processes.find(candidate => candidate.rankNum === processIndex);
    const thread = process?.threads[threadIndex];
    if (thread) {
      return thread;
    }
  }
  if (!threadId) {
    return null;
  }
  return (
    fallbackProcess?.threadMap[threadId] ??
    fallbackProcess?.threads.find(thread => thread.threadId === threadId) ??
    null
  );
}

/**
 * Read a required string column from a TraceChunk span table.
 */
function readRequiredTraceChunkSpanStringColumn(
  table: ArrowTraceSpanTable,
  columnName: string
): string[] {
  const column = getTraceChunkSpanTableColumn<string>(table, columnName);
  return Array.from({length: table.numRows}, (_unused, rowIndex) => {
    const value = readTraceChunkSpanTableColumnValue(column, rowIndex);
    return value ?? '';
  });
}

/**
 * Read a nullable string column from a TraceChunk span table.
 */
function readNullableTraceChunkSpanStringColumn(
  table: ArrowTraceSpanTable,
  columnName: string
): Array<string | null> {
  const column = getTraceChunkSpanTableColumn<string>(table, columnName);
  return Array.from({length: table.numRows}, (_unused, rowIndex) => {
    return readTraceChunkSpanTableColumnValue(column, rowIndex) ?? null;
  });
}

/**
 * Read a required numeric column from a TraceChunk span table.
 */
function readRequiredTraceChunkSpanNumberColumn(
  table: ArrowTraceSpanTable,
  columnName: string
): number[] {
  const column = getTraceChunkSpanTableColumn<number>(table, columnName);
  return Array.from({length: table.numRows}, (_unused, rowIndex) => {
    const value = readTraceChunkSpanTableColumnValue(column, rowIndex);
    return value ?? 0;
  });
}

/**
 * Read a nullable numeric column from a TraceChunk span table.
 */
function readNullableTraceChunkSpanNumberColumn(
  table: ArrowTraceSpanTable,
  columnName: string
): Array<number | null> {
  const column = getTraceChunkSpanTableColumn<number>(table, columnName);
  return Array.from({length: table.numRows}, (_unused, rowIndex) => {
    return readTraceChunkSpanTableColumnValue(column, rowIndex) ?? null;
  });
}

/** Minimal Arrow vector surface used by trace chunk span-table readers. */
type ColumnVector<Value> = {
  /** Returns the value stored at one Arrow row index. */
  get(index: number): Value | null | undefined;
};

/** Resolves one TraceChunk span-table vector by column name. */
function getTraceChunkSpanTableColumn<Value>(
  table: ArrowTraceSpanTable,
  columnName: string
): ColumnVector<Value> | null {
  return (
    (
      table as unknown as {
        getChild(name: string): ColumnVector<Value> | null | undefined;
      }
    ).getChild(columnName) ?? null
  );
}

/** Reads one typed value from an extracted TraceChunk span-table column when it exists. */
function readTraceChunkSpanTableColumnValue<Value>(
  column: ColumnVector<Value> | null,
  rowIndex: number
): Value | null {
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Reads one extracted TraceChunk span-table ref column as a normalized number. */
function readTraceChunkSpanTableRefValue(
  column: ColumnVector<unknown> | null,
  rowIndex: number
): number | null {
  return normalizeArrowRefNumber(readTraceChunkSpanTableColumnValue(column, rowIndex));
}

/**
 * Normalize Arrow ref columns that may be nullish or bigint-backed.
 */
function normalizeArrowRefNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    const numberValue = Number(value);
    return Number.isSafeInteger(numberValue) ? numberValue : null;
  }
  return null;
}

/**
 * Register every process/thread owner represented by one parser-local trace chunk.
 */
function registerTraceChunkDataProcesses(
  payload: TraceChunkData,
  ownerRefRegistry: TraceOwnerRefRegistry
): readonly ProcessRef[] {
  return registerTraceChunkProcesses(payload.processes, ownerRefRegistry);
}

/**
 * Register process/thread owner metadata and return unique owning process refs.
 */
function registerTraceChunkProcesses(
  processes: readonly TraceChunkData['processes'][number][],
  ownerRefRegistry: TraceOwnerRefRegistry
): readonly ProcessRef[] {
  const processRefs: ProcessRef[] = [];
  const seenProcessRefs = new Set<ProcessRef>();
  for (const process of processes) {
    const processRef = ownerRefRegistry.upsertProcess(process);
    for (const thread of process.threads) {
      ownerRefRegistry.upsertThread(thread);
    }
    if (!seenProcessRefs.has(processRef)) {
      processRefs.push(processRef);
      seenProcessRefs.add(processRef);
    }
  }
  return processRefs;
}

type TraceWindowSubscription = {
  /** Active trace-window definition. */
  window: TraceWindow;
  /** Ready chunk keys accumulated since the previous callback flush. */
  pendingReadyChunkKeys: Set<string>;
  /** Delayed callback flush scheduled for this trace window, when any. */
  notificationTimer: ReturnType<typeof setTimeout> | null;
  /** Wall-clock millisecond timestamp of the previous emitted readiness callback. */
  lastNotificationTimeMs: number | null;
};

/**
 * Create one mutable trace-window subscription state record.
 */
function createTraceWindowSubscription(window: TraceWindow): TraceWindowSubscription {
  return {
    window,
    pendingReadyChunkKeys: new Set<string>(),
    notificationTimer: null,
    lastNotificationTimeMs: null
  };
}

/**
 * Cancel one trace-window delayed callback when present.
 */
function clearTraceWindowNotificationTimer(subscription: TraceWindowSubscription): void {
  if (!subscription.notificationTimer) {
    return;
  }
  clearTimeout(subscription.notificationTimer);
  subscription.notificationTimer = null;
}

/**
 * Serializes one span ref from the Arrow `external_span_id` column.
 */
function serializeExternalSpanIdUrlSpanRef(
  traceGraph: Readonly<TraceGraphData>,
  spanRef: SpanRef
): string | undefined {
  const chunk = findArrowTraceChunkByIndex(traceGraph.chunks, getSpanRefChunkIndex(spanRef));
  const rowIndex = chunk
    ? getArrowTraceChunkSpanTableRowIndex(chunk, getSpanRefRowIndex(spanRef))
    : null;
  if (!chunk || rowIndex == null) {
    return undefined;
  }
  const value = chunk.spanTable.getChild('external_span_id')?.get(rowIndex);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Resolves URL span ids by scanning Arrow `external_span_id` columns in URL-id order.
 */
function deserializeExternalSpanIdUrlSpanRefs(
  traceGraph: Readonly<TraceGraphData>,
  spanIds: readonly string[]
): SpanRef[] {
  const requestedSpanIds = spanIds.filter(spanId => spanId.length > 0);
  if (requestedSpanIds.length === 0) {
    return [];
  }

  const requestedViews = requestedSpanIds.map(makeUtf8StringView);
  const selectedSpanRefs: SpanRef[] = [];
  for (const requestedView of requestedViews) {
    for (const chunk of traceGraph.chunks) {
      const externalSpanIdColumn = chunk.spanTable.getChild('external_span_id');
      if (!externalSpanIdColumn) {
        continue;
      }

      let rowIndex = arrowFindUtf8(externalSpanIdColumn, requestedView);
      while (rowIndex !== -1) {
        const spanRef = getSpanRefForChunkSpanTableRow(chunk, rowIndex);
        if (spanRef != null) {
          selectedSpanRefs.push(spanRef);
        }
        rowIndex = arrowFindUtf8(externalSpanIdColumn, requestedView, rowIndex + 1);
      }
    }
  }
  return selectedSpanRefs;
}

/**
 * Converts one published chunk span-table row into its runtime span ref.
 */
function getSpanRefForChunkSpanTableRow(
  chunk: Readonly<ArrowTraceChunk>,
  tableRowIndex: number
): SpanRef | null {
  if (tableRowIndex < 0 || tableRowIndex >= chunk.spanTable.numRows) {
    return null;
  }
  return encodeSpanRef(chunk.chunkIndex, tableRowIndex);
}

/** Builds one ready chunk after awaiting a payload, or leaves an intentional skip retryable. */
async function buildReadyChunkWhenAvailable<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
>(params: {
  /** Ready or pending payload promise owned by the chunk store. */
  payloadPromise: Promise<TPayload>;
  /** Progress callback invoked only after one descriptor has a ready payload. */
  reportChunkReady: () => void;
  /** Builds the typed ready chunk after the payload resolves. */
  buildReadyChunk: (payload: TPayload) => TraceChunkStoreReadyChunk<TPayload, TDescriptor>;
}): Promise<TraceChunkStoreReadyChunk<TPayload, TDescriptor> | null> {
  try {
    const payload = await params.payloadPromise;
    params.reportChunkReady();
    return params.buildReadyChunk(payload);
  } catch (error) {
    if (!isTraceChunkStoreLoadSkippedError(error)) {
      throw error;
    }
    return null;
  }
}

/** Returns whether one optional ready-chunk slot contains a concrete ready chunk. */
function isReadyChunk<TPayload, TDescriptor extends TraceChunkDescriptor>(
  readyChunk: TraceChunkStoreReadyChunk<TPayload, TDescriptor> | null
): readyChunk is TraceChunkStoreReadyChunk<TPayload, TDescriptor> {
  return readyChunk !== null;
}

/**
 * Group matching chunk descriptors by family while preserving deterministic policy order.
 */
function buildDescriptorFamilies<TDescriptor extends TraceChunkDescriptor>(
  descriptors: readonly TDescriptor[]
): Map<string, TDescriptor[]> {
  const descriptorsByFamily = new Map<string, TDescriptor[]>();
  descriptors.forEach(descriptor => {
    const familyDescriptors = descriptorsByFamily.get(descriptor.familyKey);
    if (familyDescriptors) {
      familyDescriptors.push(descriptor);
      return;
    }
    descriptorsByFamily.set(descriptor.familyKey, [descriptor]);
  });
  return descriptorsByFamily;
}

/**
 * Return whether one descriptor overlaps one inclusive UTC millisecond selection window.
 */
function doesTraceChunkDescriptorOverlapWindow(
  descriptor: TraceChunkDescriptor,
  window: TraceChunkSelectionWindow
): boolean {
  return descriptor.endTimeMs >= window.startTimeMs && descriptor.startTimeMs <= window.endTimeMs;
}

/**
 * Compare descriptors in deterministic chronological order.
 */
function compareTraceChunkDescriptors(
  left: TraceChunkDescriptor,
  right: TraceChunkDescriptor
): number {
  return (
    left.sortStartTimeMs - right.sortStartTimeMs ||
    left.sortEndTimeMs - right.sortEndTimeMs ||
    left.familyKey.localeCompare(right.familyKey) ||
    left.chunkKey.localeCompare(right.chunkKey)
  );
}

/**
 * Compare descriptor trailing edges while trimming the latest visible chunks first.
 */
function compareTraceChunkDescriptorEnds(
  left: TraceChunkDescriptor,
  right: TraceChunkDescriptor
): number {
  return left.sortEndTimeMs - right.sortEndTimeMs || left.sortStartTimeMs - right.sortStartTimeMs;
}

/**
 * Sum advertised span counts across one descriptor list.
 */
function sumAdvertisedSpanCounts(descriptors: readonly TraceChunkDescriptor[]): number {
  return descriptors.reduce(
    (spanCount, descriptor) => spanCount + descriptor.advertisedSpanCount,
    0
  );
}
