import {arrowFindUtf8, makeUtf8StringView} from '@deck.gl-community/infovis-layers';
import {
  findArrowTraceChunkByIndex,
  getArrowTraceChunkSpanTableRowIndex,
  replaceArrowTraceSameProcessDependencyEndpointRefColumns,
  replaceArrowTraceSpanRefColumns
} from './ingestion/arrow-trace';
import {decodeTraceDependencyWaitModeCode} from './ingestion/trace-dependency-arrow-fields';
import {decodeTraceSpanTimingStatusCode} from './ingestion/trace-span-timing-status-code';
import {getHeapUsageProbeFields, log} from './log';
import {finalizeTraceChunkData, isTraceChunk, traceChunkHasSpanRefRow} from './trace-chunk';
import {isTraceChunkData} from './trace-chunk-data';
import {buildTraceDatasetFromReadyTraceChunks} from './trace-chunk-graph-assembler';
import {
  getTraceChunkStoreSpanDetailSource,
  getTraceChunkStoreSpanFilterNavigation,
  searchTraceChunkStoreSpans
} from './trace-chunk-window';
import {TraceGraph} from './trace-graph/trace-graph';
import {
  encodeChunkRef,
  encodeProcessRef,
  encodeSpanRef,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getThreadRefProcessIndex,
  getThreadRefThreadIndex,
  isThreadRef
} from './trace-graph/trace-id-encoder';
import {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';

import type {
  ArrowTraceChunk,
  ArrowTraceEventTable,
  ArrowTraceSameProcessDependencyTable,
  ArrowTraceSpanTable
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceChunkData} from './trace-chunk-data';
import type {TraceDataset} from './trace-dataset';
import type {TraceSpanDetailSource} from './trace-graph-accessors';
import type {TraceDatasetRuntimeSource} from './trace-graph/trace-graph-runtime-source';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {
  TraceGraphSpanFilterNavigation,
  TraceGraphSpanSearchRecord,
  TraceGraphSpanStoreAvailability,
  TraceGraphSpanStoreNavigationParams,
  TraceGraphSpanStoreSearchParams
} from './trace-graph/trace-graph-types';
import type {ChunkRef, ProcessRef, ThreadRef} from './trace-graph/trace-id-encoder';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
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

/** Error raised when a caller unloads one chunk while its load is still pending. */
export class TraceChunkStoreLoadCancelledError extends Error {
  /** Builds one retryable intentional chunk-load cancellation error. */
  constructor(message: string) {
    super(message);
    this.name = 'TraceChunkStoreLoadCancelledError';
  }
}

/** Returns whether one error marks a cancelled chunk load as unloaded and retryable. */
export function isTraceChunkStoreLoadCancelledError(
  error: unknown
): error is TraceChunkStoreLoadCancelledError {
  return error instanceof Error && error.name === 'TraceChunkStoreLoadCancelledError';
}

/** Summary emitted when the active trace window observes newly ready overlapping chunks. */
export type TraceChunkStoreWindowChunksArrivedEvent = {
  /** Active trace-window id that observed stored chunk arrivals. */
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

/** One active inclusive UTC millisecond window owned by a chunk store load. */
export type TraceChunkStoreWindow = {
  /** Stable window id used to identify callbacks and materialized graph data. */
  id: string;
  /** Inclusive UTC millisecond start of the chunk-load window. */
  minTimeMs: number;
  /** Inclusive UTC millisecond end of the chunk-load window. */
  maxTimeMs: number;
  /** Minimum elapsed milliseconds between non-final chunk arrival notifications. */
  notifyIntervalMs?: number;
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

/** Store-owned cancellation signal passed into one caller-owned chunk loader. */
export type TraceChunkLoadContext = {
  /** Abort signal fired when the store unloads one still-pending chunk. */
  readonly signal: AbortSignal;
};

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
  /** Advertised spans across requested descriptors that are already ready or finished loading. */
  loadedSpanCount: number;
  /** Advertised spans across every requested descriptor in this ensure pass. */
  totalSpanCount: number;
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

/** Inputs accepted by one active trace-window load. */
export type TraceChunkStoreLoadWindowParams<TPayload, TDescriptor extends TraceChunkDescriptor> = {
  /** Active time window that replaces any prior window owned by this store. */
  window: TraceChunkStoreWindow;
  /** Caller-owned async loader that fetches and lightly normalizes one descriptor payload. */
  loadChunk: (
    descriptor: TDescriptor,
    context: TraceChunkLoadContext
  ) => Promise<TraceChunkStoreLoadResult<TPayload>>;
  /** Optional readiness callback used by app-level progress surfaces. */
  onProgress?: (progress: TraceChunkStoreProgress) => void;
  /** Optional throttled callback used by incremental graph and table surfaces. */
  onChunksArrived?: (event: TraceChunkStoreWindowChunksArrivedEvent) => void;
};

/** Counts returned after one active trace-window load finishes. */
export type TraceChunkStoreLoadWindowResult = {
  /** Number of descriptors whose envelopes overlap the active window. */
  matchedChunkCount: number;
  /** Number of matching chunk payloads ready when this load finishes. */
  readyChunkCount: number;
  /** Number of matching payloads already ready before this load started. */
  reusedReadyChunkCount: number;
  /** Number of matching payloads already being fetched by a prior load. */
  reusedPendingChunkCount: number;
  /** Number of matching payloads newly fetched by this load. */
  fetchedChunkCount: number;
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
 * Narrow Arrow-backed source needed to resolve stable URL span ids.
 *
 * URL codecs only inspect canonical retained chunks; they do not need a runtime graph,
 * compatibility projection, or full dataset snapshot.
 */
export type TraceSpanUrlSource = {
  /** Canonical row-backed chunks containing optional external span-id columns. */
  readonly chunks: readonly ArrowTraceChunk[];
};

/**
 * Inputs for serializing one runtime span ref into a stable URL id.
 */
export type TraceSpanUrlSerializeParams = {
  /** Narrow Arrow-backed source containing the span ref. */
  traceSource: Readonly<TraceSpanUrlSource>;
  /** Runtime span ref to serialize. */
  spanRef: SpanRef;
};

/**
 * Inputs for resolving stable URL ids into runtime span refs.
 */
export type TraceSpanUrlDeserializeParams = {
  /** Narrow Arrow-backed source used to resolve span refs. */
  traceSource: Readonly<TraceSpanUrlSource>;
  /** Stable URL span ids to resolve. */
  spanIds: readonly string[];
};

/**
 * Default URL codec that maps span refs to the optional Arrow `external_span_id` column.
 */
export const TRACE_EXTERNAL_SPAN_ID_URL_CODEC: TraceSpanUrlCodec = {
  serializeSpanRef: ({traceSource, spanRef}) =>
    serializeExternalSpanIdUrlSpanRef(traceSource, spanRef),
  deserializeSpanRefs: ({traceSource, spanIds}) =>
    deserializeExternalSpanIdUrlSpanRefs(traceSource, spanIds)
};

/**
 * Shared inputs used while materializing one result from ready selected chunks.
 */
export type TraceChunkReadyMaterializerParams<
  TPayload,
  TDescriptor extends TraceChunkDescriptor
> = {
  /** Trace-global append-only process/thread owner-ref allocator for this chunk store identity. */
  ownerRefRegistry: TraceOwnerRefRegistry;
  /** Policy selection used to pick descriptors for the caller-owned result subset. */
  selection: TraceChunkSelection<TDescriptor>;
  /** Ready stored payloads currently available inside the selected descriptor subset. */
  readyChunks: readonly TraceChunkStoreReadyChunk<TPayload, TDescriptor>[];
};

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
};

/** Current retained or in-flight state for one chunk key. */
export type TraceChunkLoadState = 'not-loaded' | 'pending' | 'ready' | 'failed';

/** Summary returned after explicitly unloading ready or pending chunk keys. */
export type TraceChunkStoreUnloadSummary = {
  /** Number of requested chunk keys passed into the unload call. */
  readonly requestedChunkCount: number;
  /** Number of ready stored payloads removed from retention. */
  readonly unloadedReadyChunkCount: number;
  /** Number of pending chunk loads cancelled and made retryable. */
  readonly cancelledPendingChunkCount: number;
  /** Number of failed chunk markers cleared so later loads can retry. */
  readonly clearedFailedChunkCount: number;
};

/** Inputs for creating an eager store over one immutable static trace snapshot. */
export type StaticTraceChunkStoreOptions = {
  /** Stable identity used to scope the static store instance in diagnostics. */
  readonly identityKey: string;
  /** Parser-local chunks to eagerly finalize into the static store. */
  readonly chunks: readonly TraceChunkData[];
};

/** Inputs for creating a dataset-backed runtime source from parser-local static chunks. */
export type StaticTraceGraphRuntimeSourceOptions = {
  /** Stable identity used to scope the static store instance in diagnostics. */
  readonly identityKey: string;
  /** Parser-local chunks to eagerly finalize into the static store. */
  readonly chunks: readonly TraceChunkData[];
  /** Human-friendly trace name used when materializing the runtime graph snapshot. */
  readonly name?: string;
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout?: TraceSpanLayoutMode;
  /** Cross-process dependencies shared across the static graph. */
  readonly crossProcessDependencies?: readonly TraceCrossProcessDependency[];
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

type PendingTraceChunkLoad<TPayload> = {
  /** Caller-owned payload promise shared across overlapping ensure calls. */
  readonly promise: Promise<TPayload>;
  /** Abort controller fired when the store unloads this pending chunk. */
  readonly abortController: AbortController;
  /** Monotonic generation used to ignore stale completions after unload or retry. */
  readonly loadGeneration: number;
};

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
  private readonly pendingPayloads = new Map<string, PendingTraceChunkLoad<TPayload>>();
  private readonly failedChunkErrors = new Map<string, unknown>();
  private activeTraceWindow: TraceWindowSubscription | null = null;
  /** Monotonic generation used to suppress callbacks from superseded active-window loads. */
  private activeTraceWindowGeneration = 0;
  private readonly ownerRefRegistry = new TraceOwnerRefRegistry();
  private readonly chunkIndexByKey = new Map<string, number>();
  private readonly chunkKeyByIndex = new Map<number, string>();
  private readonly chunkLoadGenerationByKey = new Map<string, number>();

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
    this.failedChunkErrors.delete(traceChunkData.chunkKey);
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

  /** Replace the active descriptor catalog without evicting stored payloads. */
  replaceDescriptors(descriptors: readonly TDescriptor[]): void {
    this.descriptorMap = buildTraceChunkDescriptorMap(descriptors);
    this.assignChunkIndexes(descriptors);
    if (this.activeTraceWindow) {
      this.resetTraceWindowSubscriptionLoadState(this.activeTraceWindow);
    }
  }

  /**
   * Return the current active descriptor catalog in registration order.
   */
  getDescriptors(): readonly TDescriptor[] {
    return [...this.descriptorMap.values()];
  }

  /** Return the stable append-only store slot already assigned to one chunk key. */
  getChunkIndex(chunkKey: string): number | null {
    return this.chunkIndexByKey.get(chunkKey) ?? null;
  }

  /** Returns cheap retained-state counters without walking stored payloads. */
  getDiagnostics(): TraceChunkStoreDiagnostics {
    return {
      descriptorCount: this.descriptorMap.size,
      readyChunkCount: this.readyPayloads.size,
      pendingChunkCount: this.pendingPayloads.size,
      failedChunkCount: this.failedChunkErrors.size,
      traceWindowCount: this.activeTraceWindow ? 1 : 0
    };
  }

  /**
   * Explicitly unload retained ready chunks and cancel matching pending loads.
   */
  unloadChunks(chunkKeys: readonly string[]): TraceChunkStoreUnloadSummary {
    let unloadedReadyChunkCount = 0;
    let cancelledPendingChunkCount = 0;
    let clearedFailedChunkCount = 0;

    chunkKeys.forEach(chunkKey => {
      this.invalidateChunkLoadGeneration(chunkKey);
      if (this.readyPayloads.delete(chunkKey)) {
        unloadedReadyChunkCount += 1;
      }
      const pendingPayload = this.pendingPayloads.get(chunkKey);
      if (pendingPayload) {
        pendingPayload.abortController.abort();
        this.pendingPayloads.delete(chunkKey);
        cancelledPendingChunkCount += 1;
      }
      if (this.failedChunkErrors.delete(chunkKey)) {
        clearedFailedChunkCount += 1;
      }
    });

    return {
      requestedChunkCount: chunkKeys.length,
      unloadedReadyChunkCount,
      cancelledPendingChunkCount,
      clearedFailedChunkCount
    };
  }

  /**
   * Replace the active trace window and load every matching missing descriptor.
   *
   * Pending work that no longer overlaps the replacement window is cancelled. Matching pending
   * work remains shared so repeated loads do not duplicate requests.
   */
  async loadWindow(
    params: TraceChunkStoreLoadWindowParams<TPayload, TDescriptor>
  ): Promise<TraceChunkStoreLoadWindowResult> {
    const loadGeneration = this.activeTraceWindowGeneration + 1;
    this.activeTraceWindowGeneration = loadGeneration;
    const previousSubscription = this.activeTraceWindow;
    if (previousSubscription) {
      clearTraceWindowNotificationTimer(previousSubscription);
    }
    const subscription = createTraceWindowSubscription(params.window, params.onChunksArrived);
    this.activeTraceWindow = subscription;
    this.resetTraceWindowSubscriptionLoadState(subscription);
    this.cancelPendingChunksOutsideActiveWindow();
    const result = await this.loadDescriptors({
      descriptors: this.getMatchingDescriptorsForTraceWindow(params.window),
      loadChunk: params.loadChunk,
      onProgress: progress => {
        if (this.activeTraceWindowGeneration === loadGeneration) {
          params.onProgress?.(progress);
        }
      }
    });
    if (this.activeTraceWindowGeneration !== loadGeneration) {
      throw new TraceChunkStoreLoadCancelledError(
        `Trace window ${params.window.id} load was superseded.`
      );
    }
    return {
      matchedChunkCount: result.requestedChunkCount,
      readyChunkCount: result.readyChunkCount,
      reusedReadyChunkCount: result.reusedReadyChunkCount,
      reusedPendingChunkCount: result.reusedPendingChunkCount,
      fetchedChunkCount: result.fetchedChunkCount
    };
  }

  /** Clear the active trace window, its callbacks, and obsolete pending work. */
  clearActiveWindow(): void {
    if (!this.activeTraceWindow) {
      return;
    }
    clearTraceWindowNotificationTimer(this.activeTraceWindow);
    this.activeTraceWindow = null;
    this.activeTraceWindowGeneration += 1;
    this.cancelPendingChunksOutsideActiveWindow();
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

  /** Return the current retained or in-flight state for one chunk key. */
  getChunkLoadState(chunkKey: string): TraceChunkLoadState {
    if (this.readyPayloads.has(chunkKey)) {
      return 'ready';
    }
    if (this.pendingPayloads.has(chunkKey)) {
      return 'pending';
    }
    if (this.failedChunkErrors.has(chunkKey)) {
      return 'failed';
    }
    return 'not-loaded';
  }

  /** Return the retained error from the latest failed load attempt, when available. */
  getChunkLoadError(chunkKey: string): unknown | null {
    return this.failedChunkErrors.get(chunkKey) ?? null;
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
      this.failedChunkErrors.has(chunkKey) ||
      this.descriptorMap.has(chunkKey)
    ) {
      return 'not-loaded';
    }

    return 'unknown';
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
   * Resolve render data for a ready stored chunk row without expanding same-process dependency ids.
   */
  getSpanDetailSource(spanRef: SpanRef): TraceSpanDetailSource | null {
    return getTraceChunkStoreSpanDetailSource(this, spanRef);
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
   * Return one ready stored chunk by its stable store-local chunk index.
   *
   * Exact span-ref lookups use this path to avoid rebuilding every ready chunk record while
   * resolving one row.
   */
  getReadyChunkByIndex(
    chunkIndex: number
  ): TraceChunkStoreReadyChunk<TPayload, TDescriptor> | null {
    const chunkKey = this.chunkKeyByIndex.get(chunkIndex);
    if (chunkKey == null) {
      return null;
    }
    const descriptor = this.descriptorMap.get(chunkKey);
    const payload = this.readyPayloads.get(chunkKey);
    if (!descriptor || payload === undefined) {
      return null;
    }
    return this.buildReadyChunk(descriptor, payload);
  }

  /**
   * Invoke one caller-owned builder with a selected ready-chunk subset.
   *
   * The store keeps readiness semantics result-agnostic: a non-empty selection with no ready
   * chunks returns `null` before invoking the caller-owned builder, while an empty selection
   * is passed through so callers can intentionally build an empty result.
   */
  withReadyChunks<TResult>(
    selection: TraceChunkSelection<TDescriptor>,
    buildResult: (
      params: TraceChunkReadyMaterializerParams<TPayload, TDescriptor>
    ) => TResult | null
  ): TResult | null {
    const readyChunks = this.getReadyChunks(selection.selectedDescriptors);
    if (readyChunks.length === 0 && selection.selectedDescriptors.length > 0) {
      return null;
    }

    return buildResult({
      ownerRefRegistry: this.ownerRefRegistry,
      selection,
      readyChunks
    });
  }

  /** Load requested descriptors while reusing ready and pending payloads. */
  private async loadDescriptors(params: {
    /** Registered descriptors that must be ready before this load completes. */
    descriptors: readonly TDescriptor[];
    /** Caller-owned async loader for one descriptor payload. */
    loadChunk: (
      descriptor: TDescriptor,
      context: TraceChunkLoadContext
    ) => Promise<TraceChunkStoreLoadResult<TPayload>>;
    /** Optional readiness callback used by app-level progress surfaces. */
    onProgress?: (progress: TraceChunkStoreProgress) => void;
  }): Promise<{
    /** Number of requested descriptors passed into this load. */
    requestedChunkCount: number;
    /** Number of requested descriptors ready when this load finishes. */
    readyChunkCount: number;
    /** Number of requested payloads already ready before this load started. */
    reusedReadyChunkCount: number;
    /** Number of requested payloads already being fetched by a prior load. */
    reusedPendingChunkCount: number;
    /** Number of requested payloads newly fetched by this load. */
    fetchedChunkCount: number;
  }> {
    let reusedReadyChunkCount = 0;
    let reusedPendingChunkCount = 0;
    let fetchedChunkCount = 0;
    let loadedChunks = 0;
    let loadedSpanCount = 0;
    const totalChunks = params.descriptors.length;
    const totalSpanCount = params.descriptors.reduce(
      (spanCount, descriptor) => spanCount + descriptor.advertisedSpanCount,
      0
    );
    const reportProgress = () => {
      params.onProgress?.({loadedChunks, totalChunks, loadedSpanCount, totalSpanCount});
    };
    const reportChunkReady = (descriptor: TDescriptor) => {
      loadedChunks += 1;
      loadedSpanCount += descriptor.advertisedSpanCount;
      reportProgress();
    };

    const chunkPromises = params.descriptors.map(async descriptor => {
      if (this.readyPayloads.has(descriptor.chunkKey)) {
        const readyPayload = this.readyPayloads.get(descriptor.chunkKey) as TPayload;
        reusedReadyChunkCount += 1;
        loadedChunks += 1;
        loadedSpanCount += descriptor.advertisedSpanCount;
        return {
          ...this.buildReadyChunk(descriptor, readyPayload)
        } satisfies TraceChunkStoreReadyChunk<TPayload, TDescriptor>;
      }

      const pendingPayload = this.pendingPayloads.get(descriptor.chunkKey);
      if (pendingPayload) {
        reusedPendingChunkCount += 1;
        return await buildReadyChunkWhenAvailable({
          payloadPromise: pendingPayload.promise,
          reportChunkReady: () => reportChunkReady(descriptor),
          buildReadyChunk: payload => this.buildReadyChunk(descriptor, payload)
        });
      }

      fetchedChunkCount += 1;
      this.failedChunkErrors.delete(descriptor.chunkKey);
      const loadGeneration = this.invalidateChunkLoadGeneration(descriptor.chunkKey);
      const abortController = new AbortController();
      const fetchPromise = params
        .loadChunk(descriptor, {signal: abortController.signal})
        .then(loadedPayload => {
          this.assertCurrentChunkLoad(descriptor.chunkKey, loadGeneration);
          const payload = this.prepareLoadedPayload(loadedPayload);
          this.readyPayloads.set(descriptor.chunkKey, payload);
          this.failedChunkErrors.delete(descriptor.chunkKey);
          return payload;
        })
        .catch((error: unknown) => {
          const normalizedError = normalizeTraceChunkLoadError({
            abortController,
            error,
            chunkKey: descriptor.chunkKey
          });
          if (
            this.isCurrentChunkLoad(descriptor.chunkKey, loadGeneration) &&
            !isTraceChunkStoreLoadSkippedError(normalizedError) &&
            !isTraceChunkStoreLoadCancelledError(normalizedError)
          ) {
            this.failedChunkErrors.set(descriptor.chunkKey, normalizedError);
          }
          throw normalizedError;
        })
        .finally(() => {
          if (this.isCurrentChunkLoad(descriptor.chunkKey, loadGeneration)) {
            this.pendingPayloads.delete(descriptor.chunkKey);
          }
        })
        .then(payload => {
          if (this.isCurrentChunkLoad(descriptor.chunkKey, loadGeneration)) {
            this.reportTraceWindowChunkReady(descriptor);
          }
          return payload;
        });
      this.pendingPayloads.set(descriptor.chunkKey, {
        promise: fetchPromise,
        abortController,
        loadGeneration
      });
      return await buildReadyChunkWhenAvailable({
        payloadPromise: fetchPromise,
        reportChunkReady: () => reportChunkReady(descriptor),
        buildReadyChunk: payload => this.buildReadyChunk(descriptor, payload)
      });
    });

    reportProgress();
    const readyChunks = (await Promise.all(chunkPromises)).filter(isReadyChunk);
    return {
      requestedChunkCount: totalChunks,
      readyChunkCount: readyChunks.length,
      reusedReadyChunkCount,
      reusedPendingChunkCount,
      fetchedChunkCount
    };
  }

  /** Return the stable descriptor list overlapping one active trace window. */
  private getMatchingDescriptorsForTraceWindow(
    window: TraceChunkStoreWindow
  ): readonly TDescriptor[] {
    return this.select({
      window: traceWindowToTraceChunkSelectionWindow(window),
      spanBudget: null
    }).matchingDescriptors;
  }

  /**
   * Record one newly ready stored payload against every overlapping active trace window.
   */
  private reportTraceWindowChunkReady(descriptor: TDescriptor): void {
    const subscription = this.activeTraceWindow;
    if (!subscription || !subscription.matchingChunkKeys.has(descriptor.chunkKey)) {
      return;
    }
    subscription.pendingReadyChunkKeys.add(descriptor.chunkKey);
    this.scheduleTraceWindowNotification(subscription);
  }

  /**
   * Schedule or immediately flush one trace-window readiness notification.
   */
  private scheduleTraceWindowNotification(subscription: TraceWindowSubscription): void {
    if (!subscription.onChunksArrived || subscription.pendingReadyChunkKeys.size === 0) {
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
      if (!subscription.onChunksArrived || subscription.pendingReadyChunkKeys.size === 0) {
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
    event: TraceChunkStoreWindowChunksArrivedEvent
  ): void {
    if (!subscription.onChunksArrived || event.newReadyChunkKeys.length === 0) {
      return;
    }
    subscription.pendingReadyChunkKeys.clear();
    subscription.lastNotificationTimeMs = Date.now();
    subscription.onChunksArrived(event);
  }

  /**
   * Build one readiness summary for the current accumulated window chunk arrivals.
   */
  private buildTraceWindowChunksArrivedEvent(
    subscription: TraceWindowSubscription
  ): TraceChunkStoreWindowChunksArrivedEvent {
    const loadStateCounts = countTraceWindowChunkLoadStates(
      subscription.matchingChunkKeys,
      chunkKey => this.getChunkLoadState(chunkKey)
    );
    return {
      windowId: subscription.window.id,
      newReadyChunkKeys: [...subscription.pendingReadyChunkKeys].sort(),
      matchedChunkCount: subscription.matchedChunkCount,
      readyChunkCount: loadStateCounts.readyChunkCount,
      pendingChunkCount: loadStateCounts.pendingChunkCount,
      failedChunkCount: loadStateCounts.failedChunkCount,
      isComplete: loadStateCounts.readyChunkCount === subscription.matchedChunkCount
    };
  }

  /** Rebuild one window subscription's catalog membership. */
  private resetTraceWindowSubscriptionLoadState(subscription: TraceWindowSubscription): void {
    const matchingDescriptors = this.select({
      window: traceWindowToTraceChunkSelectionWindow(subscription.window),
      spanBudget: null
    }).matchingDescriptors;
    subscription.matchingChunkKeys = new Set(
      matchingDescriptors.map(descriptor => descriptor.chunkKey)
    );
    subscription.pendingReadyChunkKeys = new Set(
      [...subscription.pendingReadyChunkKeys].filter(chunkKey =>
        subscription.matchingChunkKeys.has(chunkKey)
      )
    );
    subscription.matchedChunkCount = matchingDescriptors.length;
  }

  /** Cancel pending payload loads that are no longer needed by the active window. */
  private cancelPendingChunksOutsideActiveWindow(): void {
    const matchingChunkKeys = this.activeTraceWindow?.matchingChunkKeys;
    [...this.pendingPayloads.entries()].forEach(([chunkKey, pendingPayload]) => {
      if (matchingChunkKeys?.has(chunkKey)) {
        return;
      }
      this.invalidateChunkLoadGeneration(chunkKey);
      pendingPayload.abortController.abort();
      this.pendingPayloads.delete(chunkKey);
    });
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

  /** Advance one chunk load generation so stale completions cannot be retained. */
  private invalidateChunkLoadGeneration(chunkKey: string): number {
    const nextLoadGeneration = (this.chunkLoadGenerationByKey.get(chunkKey) ?? 0) + 1;
    this.chunkLoadGenerationByKey.set(chunkKey, nextLoadGeneration);
    return nextLoadGeneration;
  }

  /** Return whether one load attempt still owns the latest generation for its chunk key. */
  private isCurrentChunkLoad(chunkKey: string, loadGeneration: number): boolean {
    return this.chunkLoadGenerationByKey.get(chunkKey) === loadGeneration;
  }

  /** Throw when one stale load attempt completes after a newer load or unload won. */
  private assertCurrentChunkLoad(chunkKey: string, loadGeneration: number): void {
    if (this.isCurrentChunkLoad(chunkKey, loadGeneration)) {
      return;
    }
    throw new TraceChunkStoreLoadCancelledError(`Trace chunk ${chunkKey} load was cancelled.`);
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
    const registeredProcessRefs = registerTraceChunkDataProcesses(
      traceChunkData,
      this.ownerRefRegistry
    );
    const spanTable = finalizeTraceChunkSpanTableRefs(traceChunkData, this.ownerRefRegistry);
    const processRefs = resolveTraceChunkProcessRefs(
      traceChunkData,
      spanTable,
      registeredProcessRefs
    );
    const processes = orderTraceChunkProcessesByProcessRefs(
      traceChunkData.processes,
      processRefs,
      this.ownerRefRegistry
    );
    const sameProcessDependencyProcessIndex = resolveTraceChunkSameProcessDependencyProcessIndex(
      traceChunkData,
      this.ownerRefRegistry,
      processRefs
    );
    const resolvedSameProcessDependencyTable = finalizeTraceChunkSameProcessDependencyTableRefs(
      traceChunkData.resolvedSameProcessDependencyTable,
      sameProcessDependencyProcessIndex,
      chunkIndex
    );
    assertTraceChunkDenseDependencyEndpointRows({
      spanTable,
      dependencyTable: resolvedSameProcessDependencyTable,
      chunkIndex,
      expectedProcessRef:
        sameProcessDependencyProcessIndex == null
          ? null
          : encodeProcessRef(sameProcessDependencyProcessIndex)
    });
    const crossProcessEndpointsByEndpointId = finalizeTraceChunkCrossProcessEndpointsByEndpointId(
      traceChunkData.crossProcessEndpointsByEndpointId,
      chunkIndex
    );
    const chunk = finalizeTraceChunkData({
      data: {
        ...traceChunkData,
        processes,
        spanTable,
        resolvedSameProcessDependencyTable,
        crossProcessEndpointsByEndpointId
      },
      chunkIndex,
      chunkRef: encodeChunkRef(chunkIndex),
      processRefs
    });
    log.probe(1, 'TraceChunkStore finalized TraceChunkData', {
      chunkKey: chunk.chunkKey,
      chunkIndex: chunk.chunkIndex,
      diagnosticRowCount: chunk.diagnostics.rowCount,
      invalidRecordCount: chunk.diagnostics.invalidRecordCount,
      rowCount: chunk.metadata.rowCount,
      processRefCount: chunk.processRefs.length,
      processCount: chunk.processes.length,
      sourceDependencyRowCount: chunk.sourceDependencyTable?.numRows ?? 0,
      windowRowCount: chunk.rowWindowTable?.overlapRangesByRow.length ?? 0,
      minTimeMs: chunk.diagnostics.minTimeMs,
      maxTimeMs: chunk.diagnostics.maxTimeMs,
      ...getHeapUsageProbeFields()
    })();
    return chunk;
  }
}

/**
 * Convert one trace-window subscription into the existing view-selection window shape.
 */
export function traceWindowToTraceChunkSelectionWindow(
  traceWindow: TraceChunkStoreWindow
): TraceChunkSelectionWindow {
  return {
    startTimeMs: traceWindow.minTimeMs,
    endTimeMs: traceWindow.maxTimeMs
  };
}

/**
 * Create an eager chunk store for a static Arrow trace snapshot.
 *
 * Static stores assign deterministic dense chunk indexes from parser-local chunk order so the
 * finalized dataset owns one canonical SpanRef domain.
 */
export function createStaticTraceChunkStore(
  options: StaticTraceChunkStoreOptions
): TraceChunkStore<TraceChunk, TraceChunkDescriptor> {
  const chunks = options.chunks;
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
  options: StaticTraceGraphRuntimeSourceOptions
): TraceDatasetRuntimeSource<TraceChunkStore<TraceChunk, TraceChunkDescriptor>> {
  const traceStore = createStaticTraceChunkStore(options);
  return {
    traceDataset: buildStaticTraceDatasetFromStore(options, traceStore),
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

/** Build one uncapped selection that materializes every supplied descriptor. */
function buildTraceChunkSelectionFromDescriptors<TDescriptor extends TraceChunkDescriptor>(
  descriptors: readonly TDescriptor[]
): TraceChunkSelection<TDescriptor> {
  const selectedSpanCount = sumAdvertisedSpanCounts(descriptors);
  return {
    matchingDescriptors: descriptors,
    selectedDescriptors: descriptors,
    omittedDescriptors: [],
    summary: {
      spanBudget: null,
      matchedSpanCount: selectedSpanCount,
      selectedSpanCount,
      selectedChunkCount: descriptors.length,
      omittedChunkCount: 0,
      omittedSpanCount: 0,
      isSpanBudgetCapped: false
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
 * Materialize the canonical dataset consumed by runtime TraceGraph from finalized chunks.
 */
function buildStaticTraceDatasetFromStore(
  options: StaticTraceGraphRuntimeSourceOptions,
  traceStore: TraceChunkStore<TraceChunk, TraceChunkDescriptor>
): TraceDataset {
  const selection = buildTraceChunkSelectionFromDescriptors(traceStore.getDescriptors());
  const traceDataset = traceStore.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
    buildTraceDatasetFromReadyTraceChunks({
      name: options.name ?? options.identityKey,
      spanLayout: options.spanLayout,
      ownerRefRegistry,
      readyChunks,
      crossProcessDependencies: options.crossProcessDependencies,
      events: options.events,
      timeExtents: options.timeExtents,
      stats: options.stats
    })
  );
  if (!traceDataset) {
    throw new Error(
      'Static trace chunk stores require ready chunks before dataset materialization.'
    );
  }
  return traceDataset;
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
  const processScopedProcess =
    data.processId == null
      ? null
      : (data.processes.find(process => process.processId === data.processId) ?? null);
  if (data.processId != null && processScopedProcess == null) {
    throw new Error(`Missing process metadata for process-scoped chunk ${data.chunkKey}.`);
  }
  for (let rowIndex = 0; rowIndex < data.spanTable.numRows; rowIndex += 1) {
    const localProcessRef = readTraceChunkSpanTableRefValue(localProcessRefColumn, rowIndex);
    const localThreadRef = readTraceChunkSpanTableRefValue(localThreadRefColumn, rowIndex);
    const process =
      processScopedProcess ??
      resolveParserLocalProcessForSpanRow(
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

  return replaceArrowTraceSpanRefColumns({
    sourceTable: data.spanTable,
    processRef: processRefs,
    threadRef: threadRefs
  });
}

/** Rebase same-process dependency endpoint span refs to the store-owned chunk slot. */
function finalizeTraceChunkSameProcessDependencyTableRefs(
  table: ArrowTraceSameProcessDependencyTable,
  processIndex: number | null,
  chunkIndex: number
): ArrowTraceSameProcessDependencyTable {
  if (table.numRows === 0) {
    return table;
  }

  const sourceStartSpanRefs = readNullableTraceChunkNumberColumn(table, 'startSpanRef');
  const sourceEndSpanRefs = readNullableTraceChunkNumberColumn(table, 'endSpanRef');
  requireTraceChunkSameProcessDependencyProcessIndex(processIndex);
  const startSpanRefs = sourceStartSpanRefs.map(spanRef =>
    rebaseTraceChunkSpanRef(spanRef, chunkIndex)
  );
  const endSpanRefs = sourceEndSpanRefs.map(spanRef =>
    rebaseTraceChunkSpanRef(spanRef, chunkIndex)
  );
  const didChange =
    startSpanRefs.some((spanRef, rowIndex) => spanRef !== sourceStartSpanRefs[rowIndex]) ||
    endSpanRefs.some((spanRef, rowIndex) => spanRef !== sourceEndSpanRefs[rowIndex]);
  if (!didChange) {
    return table;
  }

  return replaceArrowTraceSameProcessDependencyEndpointRefColumns({
    sourceTable: table,
    startSpanRef: startSpanRefs,
    endSpanRef: endSpanRefs
  });
}

/**
 * Validates one finalized chunk's dense dependency endpoint domain exactly once.
 *
 * Store-finalized chunks are the trusted dataset boundary: malformed canonical dependency rows
 * fail publication here instead of surviving behind a render-time compatibility flag. Only rows
 * addressed by same-process dependencies are checked; unrelated spans remain on their existing
 * checked consumers and do not add a second all-span finalization scan.
 */
function assertTraceChunkDenseDependencyEndpointRows(params: {
  /** Store-finalized span table whose owner refs and timing status are checked. */
  readonly spanTable: ArrowTraceSpanTable;
  /** Store-finalized same-process dependency table whose endpoint refs are checked. */
  readonly dependencyTable: ArrowTraceSameProcessDependencyTable;
  /** Stable store chunk slot expected inside every local dependency endpoint ref. */
  readonly chunkIndex: number;
  /** Canonical owner process ref for this dependency table, or null when not process-scoped. */
  readonly expectedProcessRef: ProcessRef | null;
}): void {
  if (params.dependencyTable.numRows === 0) {
    return;
  }
  if (params.expectedProcessRef == null) {
    throw new Error('Expected one canonical process owner for same-process dependency rows.');
  }

  const processRefColumn = getTraceChunkSpanTableColumn<unknown>(params.spanTable, 'process_ref');
  const threadRefColumn = getTraceChunkSpanTableColumn<unknown>(params.spanTable, 'thread_ref');
  const statusCodeColumn = getTraceChunkSpanTableColumn<unknown>(params.spanTable, 'status_code');
  const startTimeMsColumn = getTraceChunkSpanTableColumn<unknown>(
    params.spanTable,
    'start_time_ms'
  );
  const endTimeMsColumn = getTraceChunkSpanTableColumn<unknown>(params.spanTable, 'end_time_ms');
  const startSpanRefColumn = getTraceChunkTableColumn(params.dependencyTable, 'startSpanRef');
  const endSpanRefColumn = getTraceChunkTableColumn(params.dependencyTable, 'endSpanRef');
  const waitModeCodeColumn = getTraceChunkTableColumn(params.dependencyTable, 'waitModeCode');
  const waitTimeMsColumn = getTraceChunkTableColumn(params.dependencyTable, 'waitTimeMs');
  const keywordFlagsColumn = getTraceChunkTableColumn(params.dependencyTable, 'keywordFlags');
  if (
    !processRefColumn ||
    !threadRefColumn ||
    !statusCodeColumn ||
    !startTimeMsColumn ||
    !endTimeMsColumn ||
    !startSpanRefColumn ||
    !endSpanRefColumn ||
    !waitModeCodeColumn ||
    !waitTimeMsColumn ||
    !keywordFlagsColumn
  ) {
    throw new Error('Expected canonical dense dependency endpoint columns.');
  }

  for (let rowIndex = 0; rowIndex < params.dependencyTable.numRows; rowIndex += 1) {
    const startSpanRef = normalizeArrowRefNumber(
      readTraceChunkTableColumnValue(startSpanRefColumn, rowIndex)
    );
    const endSpanRef = normalizeArrowRefNumber(
      readTraceChunkTableColumnValue(endSpanRefColumn, rowIndex)
    );
    const keywordFlags = readTraceChunkTableColumnValue(keywordFlagsColumn, rowIndex);
    const waitTimeMs = readTraceChunkTableColumnValue(waitTimeMsColumn, rowIndex);
    if (
      startSpanRef == null ||
      endSpanRef == null ||
      decodeTraceDependencyWaitModeCode(
        readTraceChunkTableColumnValue(waitModeCodeColumn, rowIndex)
      ) == null ||
      typeof keywordFlags !== 'number' ||
      !Number.isInteger(keywordFlags) ||
      keywordFlags < 0 ||
      keywordFlags > 0xff ||
      typeof waitTimeMs !== 'number' ||
      !Number.isFinite(waitTimeMs) ||
      !isTraceChunkValidatedDenseDependencyEndpointRef({
        spanRef: startSpanRef,
        chunkIndex: params.chunkIndex,
        rowCount: params.spanTable.numRows,
        expectedProcessRef: params.expectedProcessRef,
        processRefColumn,
        threadRefColumn,
        statusCodeColumn,
        startTimeMsColumn,
        endTimeMsColumn
      }) ||
      !isTraceChunkValidatedDenseDependencyEndpointRef({
        spanRef: endSpanRef,
        chunkIndex: params.chunkIndex,
        rowCount: params.spanTable.numRows,
        expectedProcessRef: params.expectedProcessRef,
        processRefColumn,
        threadRefColumn,
        statusCodeColumn,
        startTimeMsColumn,
        endTimeMsColumn
      })
    ) {
      throw new Error(`Invalid finalized dense dependency row ${rowIndex}.`);
    }
  }
}

/** Returns whether one finalized local dependency endpoint ref is safe, in-bounds, and owned. */
function isTraceChunkValidatedDenseDependencyEndpointRef(params: {
  /** Safe-integer endpoint span ref read from the finalized dependency table. */
  readonly spanRef: number;
  /** Stable store chunk slot expected inside the endpoint ref. */
  readonly chunkIndex: number;
  /** Number of canonical span rows available in the expected chunk. */
  readonly rowCount: number;
  /** Canonical process ref that must own the endpoint span row. */
  readonly expectedProcessRef: ProcessRef;
  /** Borrowed process-ref span column used only during one-time validation. */
  readonly processRefColumn: ColumnVector<unknown>;
  /** Borrowed thread-ref span column used only during one-time validation. */
  readonly threadRefColumn: ColumnVector<unknown>;
  /** Borrowed compact timing-status span column used only during one-time validation. */
  readonly statusCodeColumn: ColumnVector<unknown>;
  /** Borrowed primary start-time span column used only during one-time validation. */
  readonly startTimeMsColumn: ColumnVector<unknown>;
  /** Borrowed primary source-end span column used only during one-time validation. */
  readonly endTimeMsColumn: ColumnVector<unknown>;
}): boolean {
  if (getSpanRefChunkIndex(params.spanRef as SpanRef) !== params.chunkIndex) {
    return false;
  }
  const rowIndex = getSpanRefRowIndex(params.spanRef as SpanRef);
  if (rowIndex < 0 || rowIndex >= params.rowCount) {
    return false;
  }
  const processRef = readTraceChunkSpanTableRefValue(params.processRefColumn, rowIndex);
  const threadRef = readTraceChunkSpanTableRefValue(params.threadRefColumn, rowIndex);
  const startTimeMs = readTraceChunkSpanTableColumnValue(params.startTimeMsColumn, rowIndex);
  const endTimeMs = readTraceChunkSpanTableColumnValue(params.endTimeMsColumn, rowIndex);
  return (
    processRef === params.expectedProcessRef &&
    threadRef != null &&
    isThreadRef(threadRef) &&
    getThreadRefProcessIndex(threadRef) === getProcessRefIndex(params.expectedProcessRef) &&
    decodeTraceSpanTimingStatusCode(
      readTraceChunkSpanTableColumnValue(params.statusCodeColumn, rowIndex)
    ) != null &&
    typeof startTimeMs === 'number' &&
    Number.isFinite(startTimeMs) &&
    typeof endTimeMs === 'number' &&
    Number.isFinite(endTimeMs)
  );
}

/** Rebase parser-local unresolved endpoint span refs to the store-owned chunk slot. */
function finalizeTraceChunkCrossProcessEndpointsByEndpointId(
  endpointGroups:
    | Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>>
    | undefined,
  chunkIndex: number
): Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>> | undefined {
  if (!endpointGroups) {
    return undefined;
  }

  let didChange = false;
  const finalizedEndpointGroups = Object.fromEntries(
    Object.entries(endpointGroups).map(([endpointId, endpoints]) => [
      endpointId,
      endpoints.map(endpoint => {
        const finalizedEndpoint = finalizeTraceChunkCrossProcessEndpoint(endpoint, chunkIndex);
        didChange ||= finalizedEndpoint !== endpoint;
        return finalizedEndpoint;
      })
    ])
  ) as Readonly<Record<TraceCrossProcessEndpointId, readonly TraceCrossProcessEndpoint[]>>;
  return didChange ? finalizedEndpointGroups : endpointGroups;
}

/** Rebase one unresolved endpoint span ref to the store-owned chunk slot. */
function finalizeTraceChunkCrossProcessEndpoint<T extends {readonly spanRef?: SpanRef}>(
  endpoint: T,
  chunkIndex: number
): T {
  if (endpoint.spanRef === undefined) {
    return endpoint;
  }
  const spanRef = rebaseTraceChunkSpanRef(endpoint.spanRef, chunkIndex);
  return spanRef === endpoint.spanRef ? endpoint : {...endpoint, spanRef};
}

/** Rebase one parser-local span ref to the store-owned chunk slot. */
function rebaseTraceChunkSpanRef(spanRef: number | null, chunkIndex: number): SpanRef | null {
  return spanRef == null ? null : encodeSpanRef(chunkIndex, getSpanRefRowIndex(spanRef as SpanRef));
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

/** Preserve empty process-scoped chunks while preferring refs observed on span rows. */
function resolveTraceChunkProcessRefs(
  data: TraceChunkData,
  spanTable: ArrowTraceSpanTable,
  registeredProcessRefs: readonly ProcessRef[]
): readonly ProcessRef[] {
  if (data.processId != null) {
    const processIndex = data.processes.findIndex(process => process.processId === data.processId);
    if (processIndex < 0) {
      throw new Error(`Missing process metadata for process-scoped chunk ${data.chunkKey}.`);
    }
    const processRef = registeredProcessRefs[processIndex];
    return processRef == null ? [] : [processRef];
  }
  const spanTableProcessRefs = readTraceChunkSpanTableProcessRefs(spanTable);
  return spanTableProcessRefs.length > 0 ? spanTableProcessRefs : registeredProcessRefs;
}

/**
 * Keep represented process metadata aligned with finalized `processRefs`.
 *
 * Multi-process parser chunks may emit span rows in a different order than their metadata array.
 * Window/detail readers intentionally use the compact `processRefs` array as their row-owner
 * lookup, so represented metadata must follow that same order. Metadata for processes with no
 * rows stays after the represented prefix for compatibility consumers.
 */
function orderTraceChunkProcessesByProcessRefs(
  processes: TraceChunkData['processes'],
  processRefs: readonly ProcessRef[],
  ownerRefRegistry: TraceOwnerRefRegistry
): TraceChunkData['processes'] {
  if (processRefs.length === 0 || processes.length <= 1) {
    return processes;
  }
  const processByRef = new Map<ProcessRef, TraceChunkData['processes'][number]>();
  for (const process of processes) {
    const processRef = ownerRefRegistry.getProcessRef(process.processId as TraceProcessId);
    if (processRef != null) {
      processByRef.set(processRef, process);
    }
  }
  const representedProcesses: TraceChunkData['processes'][number][] = [];
  const representedProcessIds = new Set<TraceProcessId>();
  for (const processRef of processRefs) {
    const process = processByRef.get(processRef);
    if (!process) {
      continue;
    }
    representedProcesses.push(process);
    representedProcessIds.add(process.processId as TraceProcessId);
  }
  if (representedProcesses.length === 0) {
    return processes;
  }
  const unrepresentedProcesses = processes.filter(
    process => !representedProcessIds.has(process.processId as TraceProcessId)
  );
  const orderedProcesses = [...representedProcesses, ...unrepresentedProcesses];
  return orderedProcesses.every((process, index) => process === processes[index])
    ? processes
    : orderedProcesses;
}

/** Resolve the store-owned process index owning one same-process dependency table. */
function resolveTraceChunkSameProcessDependencyProcessIndex(
  data: TraceChunkData,
  ownerRefRegistry: TraceOwnerRefRegistry,
  processRefs: readonly ProcessRef[]
): number | null {
  if (data.processId != null) {
    const processRef = ownerRefRegistry.getProcessRef(data.processId);
    return processRef == null ? null : getProcessRefIndex(processRef);
  }
  return getTraceChunkSingleProcessIndex(processRefs);
}

/** Resolve one unique process-scoped chunk owner when local refs use legacy row indexes. */
function getTraceChunkSingleProcessIndex(processRefs: readonly ProcessRef[]): number | null {
  return processRefs.length === 1 ? getProcessRefIndex(processRefs[0]!) : null;
}

/** Require one store-owned process index before finalizing same-process dependency endpoints. */
function requireTraceChunkSameProcessDependencyProcessIndex(processIndex: number | null): number {
  if (processIndex == null) {
    throw new Error('Expected exactly one owning process for same-process dependency refs');
  }
  return processIndex;
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

/** Read a nullable numeric column from one TraceChunk-owned Arrow table. */
function readNullableTraceChunkNumberColumn(
  table: TraceChunkReadableTable,
  columnName: string
): Array<number | null> {
  return Array.from({length: table.numRows}, (_unused, rowIndex) => {
    return normalizeArrowRefNumber(
      readTraceChunkTableColumnValue(getTraceChunkTableColumn(table, columnName), rowIndex)
    );
  });
}

/** Minimal Arrow vector surface used by trace chunk span-table readers. */
type ColumnVector<Value> = {
  /** Returns the value stored at one Arrow row index. */
  get(index: number): Value | null | undefined;
};

/** Minimal Arrow table surface used by trace chunk table readers. */
type TraceChunkReadableTable = {
  /** Number of rows stored in the Arrow table. */
  readonly numRows: number;
  /** Resolve one Arrow vector by column name. */
  getChild(name: string): ColumnVector<unknown> | null | undefined;
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

/** Resolves one TraceChunk-owned Arrow table vector by column name. */
function getTraceChunkTableColumn(
  table: TraceChunkReadableTable,
  columnName: string
): ColumnVector<unknown> | null {
  return table.getChild(columnName) ?? null;
}

/** Reads one typed value from an extracted TraceChunk span-table column when it exists. */
function readTraceChunkSpanTableColumnValue<Value>(
  column: ColumnVector<Value> | null,
  rowIndex: number
): Value | null {
  return column ? (column.get(rowIndex) ?? null) : null;
}

/** Reads one typed value from an extracted TraceChunk-owned Arrow column when it exists. */
function readTraceChunkTableColumnValue(
  column: ColumnVector<unknown> | null,
  rowIndex: number
): unknown {
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
 * Normalize Arrow ref columns that may be nullish or bigint-backed into safe integers.
 */
function normalizeArrowRefNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
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
  window: TraceChunkStoreWindow;
  /** Optional throttled callback for newly ready active-window chunks. */
  onChunksArrived?: (event: TraceChunkStoreWindowChunksArrivedEvent) => void;
  /** Catalog chunk keys whose descriptor envelopes overlap the active window. */
  matchingChunkKeys: Set<string>;
  /** Number of catalog chunks whose descriptor envelopes overlap the active window. */
  matchedChunkCount: number;
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
function createTraceWindowSubscription(
  window: TraceChunkStoreWindow,
  onChunksArrived?: (event: TraceChunkStoreWindowChunksArrivedEvent) => void
): TraceWindowSubscription {
  return {
    window,
    onChunksArrived,
    matchingChunkKeys: new Set<string>(),
    matchedChunkCount: 0,
    pendingReadyChunkKeys: new Set<string>(),
    notificationTimer: null,
    lastNotificationTimeMs: null
  };
}

/** Count active-window chunk states only when a throttled notification is emitted. */
function countTraceWindowChunkLoadStates(
  chunkKeys: ReadonlySet<string>,
  getLoadState: (chunkKey: string) => TraceChunkLoadState
): {
  /** Number of matching chunks currently retained as ready payloads. */
  readyChunkCount: number;
  /** Number of matching chunks currently sharing in-flight payload fetches. */
  pendingChunkCount: number;
  /** Number of matching chunks whose latest load attempt failed. */
  failedChunkCount: number;
} {
  let readyChunkCount = 0;
  let pendingChunkCount = 0;
  let failedChunkCount = 0;
  chunkKeys.forEach(chunkKey => {
    const loadState = getLoadState(chunkKey);
    if (loadState === 'ready') {
      readyChunkCount += 1;
    } else if (loadState === 'pending') {
      pendingChunkCount += 1;
    } else if (loadState === 'failed') {
      failedChunkCount += 1;
    }
  });
  return {readyChunkCount, pendingChunkCount, failedChunkCount};
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
  traceSource: Readonly<TraceSpanUrlSource>,
  spanRef: SpanRef
): string | undefined {
  const chunk = findArrowTraceChunkByIndex(traceSource.chunks, getSpanRefChunkIndex(spanRef));
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
  traceSource: Readonly<TraceSpanUrlSource>,
  spanIds: readonly string[]
): SpanRef[] {
  const requestedSpanIds = spanIds.filter(spanId => spanId.length > 0);
  if (requestedSpanIds.length === 0) {
    return [];
  }

  const requestedViews = requestedSpanIds.map(makeUtf8StringView);
  const selectedSpanRefs: SpanRef[] = [];
  for (const requestedView of requestedViews) {
    for (const chunk of traceSource.chunks) {
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
    if (!isTraceChunkStoreLoadSkippedError(error) && !isTraceChunkStoreLoadCancelledError(error)) {
      throw error;
    }
    return null;
  }
}

/** Normalize AbortController failures into the store's retryable cancellation error. */
function normalizeTraceChunkLoadError(params: {
  /** Abort controller attached to the load attempt that failed. */
  abortController: AbortController;
  /** Error rejected by the caller-owned loader or store finalization. */
  error: unknown;
  /** Stable chunk key owned by the failed load attempt. */
  chunkKey: string;
}): unknown {
  if (isTraceChunkStoreLoadCancelledError(params.error) || !params.abortController.signal.aborted) {
    return params.error;
  }
  return new TraceChunkStoreLoadCancelledError(
    `Trace chunk ${params.chunkKey} load was cancelled.`
  );
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
