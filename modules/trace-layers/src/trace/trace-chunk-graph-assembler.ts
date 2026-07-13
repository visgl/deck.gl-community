import * as arrow from 'apache-arrow';

import {
  buildArrowTraceCrossProcessDependencyTable,
  buildTraceProcessSpanRefTables,
  canonicalizeArrowTraceCrossProcessDependencyTableFromChunks
} from './ingestion/arrow-trace';
import {buildTraceDatasetRefSources} from './trace-dataset-ref-sources';
import {EMPTY_ARROW_TRACE_EVENT_TABLE} from './trace-graph/trace-event-table';

import type {
  ArrowTraceCrossProcessDependencyTable,
  ArrowTraceEventTable,
  ArrowTraceProcessMetadata,
  ArrowTraceSameProcessDependencyTable,
  TraceCrossProcessEndpointsBySpanRef
} from './ingestion/arrow-trace';
import type {TraceChunk} from './trace-chunk';
import type {TraceDataset, TraceDatasetTimeExtents} from './trace-dataset';
import type {TraceGraphStats} from './trace-graph/trace-graph-stats';
import type {TraceOwnerRefRegistry} from './trace-graph/trace-owner-ref-registry';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceProcessId,
  TraceSpanLayoutMode
} from './trace-graph/trace-types';

/**
 * Build an immutable Arrow-backed dataset from ready process-scoped finalized chunks.
 */
export function buildTraceDatasetFromReadyTraceChunks<TReadyChunk extends ReadyTraceChunk>(params: {
  /** Human-friendly trace name for the assembled dataset. */
  readonly name: string;
  /** Trace-global append-only process/thread owner-ref allocator for these chunks. */
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  /** Ready process-scoped finalized chunks selected for this dataset. */
  readonly readyChunks: readonly TReadyChunk[];
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout?: TraceSpanLayoutMode;
  /** Cross-process dependencies shared across the dataset. */
  readonly crossProcessDependencies?: readonly TraceCrossProcessDependency[];
  /** Canonical graph-global event table. */
  readonly events?: Readonly<ArrowTraceEventTable>;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact owning span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Optional canonical graph-wide time bounds to preserve from ingestion. */
  readonly timeExtents?: TraceDatasetTimeExtents;
  /** Optional stat overrides preserved from upstream loaders or active span selections. */
  readonly stats?: Partial<TraceGraphStats>;
}): TraceDataset {
  // Canonical dataset row order follows stable store slots, not caller selection/load order.
  const chunks = params.readyChunks
    .map(({payload}) => payload)
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
  const ownerRefSnapshot = params.ownerRefRegistry.createSnapshot();
  assertUniqueTraceDatasetProcessChunks(chunks, ownerRefSnapshot);
  const processes = buildTraceDatasetProcesses(params.ownerRefRegistry, chunks);
  const selectedProcesses = collectSelectedTraceChunkProcesses(chunks, ownerRefSnapshot, processes);
  const tableMaps = buildTraceGraphTableMaps(chunks, ownerRefSnapshot);
  const crossProcessDependencyTable = canonicalizeArrowTraceCrossProcessDependencyTableFromChunks({
    crossProcessDependencyTable: buildArrowTraceCrossProcessDependencyTable(
      params.crossProcessDependencies ?? []
    ),
    chunks,
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
    processes
  });
  const events = params.events ?? EMPTY_ARROW_TRACE_EVENT_TABLE;
  const crossProcessEndpointsBySpanRef =
    params.crossProcessEndpointsBySpanRef ??
    buildTraceDatasetCrossProcessEndpointsBySpanRef(chunks);
  const timeExtents = resolveTraceDatasetTimeExtents({
    chunks,
    events,
    processes: selectedProcesses,
    timeExtents: params.timeExtents
  });
  const stats = buildTraceDatasetStats({
    chunks,
    crossProcessDependencyTable,
    processes,
    sameProcessDependencyTableMap: tableMaps.sameProcessDependencyTableMap,
    overrides: buildSelectedTraceChunkStats(selectedProcesses, params.stats)
  });
  const processSpanTableMap = buildTraceProcessSpanRefTables(chunks, processes, {
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex
  });
  const refSources = buildTraceDatasetRefSources({
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
    processSpanTableMap,
    sameProcessDependencyTableMap: tableMaps.sameProcessDependencyTableMap
  });

  return {
    type: 'trace-dataset',
    revision: 0,
    name: params.name,
    spanLayout: params.spanLayout,
    processes,
    chunks,
    sameProcessDependencyTableMap: tableMaps.sameProcessDependencyTableMap,
    ...(hasRecordEntries(tableMaps.spanSidecarTableMap)
      ? {spanSidecarTableMap: tableMaps.spanSidecarTableMap}
      : {}),
    crossProcessDependencyTable,
    events,
    crossProcessEndpointsBySpanRef,
    timeExtents,
    stats,
    ownerRefSnapshot,
    processSpanTableMap,
    ...refSources
  };
}

/**
 * Append newly ready finalized chunks to one immutable Arrow-backed dataset.
 */
export function appendTraceDatasetFromReadyTraceChunks<
  TReadyChunk extends ReadyTraceChunk
>(params: {
  /** Human-friendly trace name for the appended dataset. */
  readonly name: string;
  /** Trace-global append-only process/thread owner-ref allocator for these chunks. */
  readonly ownerRefRegistry: TraceOwnerRefRegistry;
  /** Previously assembled canonical dataset whose chunks remain append-prefix inputs. */
  readonly previousTraceDataset: TraceDataset;
  /** Newly ready process-scoped finalized chunks appended after the previous chunk prefix. */
  readonly addedReadyChunks: readonly TReadyChunk[];
  /** Cross-process dependencies shared across the appended dataset. */
  readonly crossProcessDependencies: readonly TraceCrossProcessDependency[];
  /** Cross-process dependencies resolved only from the newly ready chunks. */
  readonly addedCrossProcessDependencies: readonly TraceCrossProcessDependency[];
  /** Whether spans use generated lanes or authored thread-relative vertical geometry. */
  readonly spanLayout?: TraceSpanLayoutMode;
  /** Canonical graph-global event table. */
  readonly events?: Readonly<ArrowTraceEventTable>;
  /** Optional sparse unresolved cross-rank endpoints keyed by exact owning span ref. */
  readonly crossProcessEndpointsBySpanRef?: TraceCrossProcessEndpointsBySpanRef;
  /** Optional canonical graph-wide time bounds preserved while appending ready chunks. */
  readonly timeExtents?: TraceDatasetTimeExtents;
  /** Optional stat overrides preserved from upstream loaders or active span selections. */
  readonly stats?: Partial<TraceGraphStats>;
}): TraceDataset {
  const previousTraceDataset = params.previousTraceDataset;
  if (params.addedReadyChunks.length === 0) {
    return previousTraceDataset;
  }

  // Preserve the same stable store-slot order when append callers arrive out of load order.
  const addedChunks = params.addedReadyChunks
    .map(({payload}) => payload)
    .sort((left, right) => left.chunkIndex - right.chunkIndex);
  const previousChunkKeys = new Set(previousTraceDataset.chunks.map(chunk => chunk.chunkKey));
  addedChunks.forEach(chunk => {
    if (previousChunkKeys.has(chunk.chunkKey)) {
      throw new Error(`TraceChunkStore append received existing chunk ${chunk.chunkKey}.`);
    }
  });
  const chunks = [...previousTraceDataset.chunks, ...addedChunks].sort(
    (left, right) => left.chunkIndex - right.chunkIndex
  );
  const ownerRefSnapshot = params.ownerRefRegistry.createSnapshot();
  assertUniqueTraceDatasetProcessChunks(chunks, ownerRefSnapshot);
  const processes = buildTraceDatasetProcesses(params.ownerRefRegistry, chunks);
  const selectedProcesses = collectSelectedTraceChunkProcesses(chunks, ownerRefSnapshot, processes);
  const tableMaps = buildTraceGraphTableMaps(chunks, ownerRefSnapshot);
  const addedProcesses = collectSelectedTraceChunkProcesses(
    addedChunks,
    ownerRefSnapshot,
    processes
  );
  const addedCrossProcessDependencyTable =
    canonicalizeArrowTraceCrossProcessDependencyTableFromChunks({
      crossProcessDependencyTable: buildArrowTraceCrossProcessDependencyTable(
        params.addedCrossProcessDependencies
      ),
      chunks,
      processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
      processes
    });
  const crossProcessDependencyTable = appendArrowTraceCrossProcessDependencyTable({
    addedCrossProcessDependencyTable,
    previousCrossProcessDependencyTable: previousTraceDataset.crossProcessDependencyTable
  });
  const addedProcessSpanTableMap = buildTraceProcessSpanRefTables(addedChunks, addedProcesses, {
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex
  });
  const processSpanTableMap = {
    ...previousTraceDataset.processSpanTableMap,
    ...addedProcessSpanTableMap
  };
  const events = params.events ?? previousTraceDataset.events;
  const crossProcessEndpointsBySpanRef =
    params.crossProcessEndpointsBySpanRef ??
    mergeTraceDatasetCrossProcessEndpointsBySpanRef(
      previousTraceDataset.crossProcessEndpointsBySpanRef,
      buildTraceDatasetCrossProcessEndpointsBySpanRef(addedChunks)
    );
  const timeExtents = resolveTraceDatasetTimeExtents({
    chunks,
    events,
    processes: selectedProcesses,
    timeExtents: params.timeExtents
  });
  const refSources = buildTraceDatasetRefSources({
    processIdsByIndex: ownerRefSnapshot.processIdsByIndex,
    processSpanTableMap,
    sameProcessDependencyTableMap: tableMaps.sameProcessDependencyTableMap
  });

  return {
    type: 'trace-dataset',
    revision: previousTraceDataset.revision + 1,
    name: params.name,
    spanLayout: params.spanLayout,
    processes,
    chunks,
    sameProcessDependencyTableMap: tableMaps.sameProcessDependencyTableMap,
    ...(hasRecordEntries(tableMaps.spanSidecarTableMap)
      ? {spanSidecarTableMap: tableMaps.spanSidecarTableMap}
      : {}),
    crossProcessDependencyTable,
    events,
    crossProcessEndpointsBySpanRef,
    timeExtents,
    stats: buildAppendedTraceDatasetStats({
      addedChunks,
      crossProcessDependencies: params.crossProcessDependencies,
      previousTraceDataset,
      selectedProcesses,
      stats: params.stats
    }),
    ownerRefSnapshot,
    processSpanTableMap,
    ...refSources
  };
}

/**
 * Replace one dataset's graph-global event table without copying its canonical row-heavy fields.
 *
 * Event replacement is deliberately separate from ready-chunk append: event-only revisions must
 * remain possible when no chunk is added, while append keeps its empty-add identity contract.
 * The replacement table and caller-resolved graph-wide bounds are retained without scanning or
 * copying canonical chunks, Arrow tables, refs, or metadata.
 */
export function replaceTraceDatasetEvents(params: {
  /** Canonical immutable dataset whose row-heavy fields remain owned by identity. */
  readonly traceDataset: TraceDataset;
  /** Complete replacement graph-global Arrow event table retained by identity. */
  readonly events: Readonly<ArrowTraceEventTable>;
  /** Exact graph-wide bounds for the replacement snapshot, including non-point event durations. */
  readonly timeExtents: TraceDatasetTimeExtents;
}): TraceDataset {
  const traceDataset = params.traceDataset;
  const timeExtents = normalizeRequiredTraceDatasetTimeExtents(params.timeExtents);
  if (
    params.events === traceDataset.events &&
    areTraceDatasetTimeExtentsEqual(timeExtents, traceDataset.timeExtents)
  ) {
    return traceDataset;
  }

  return {
    ...traceDataset,
    revision: traceDataset.revision + 1,
    events: params.events,
    timeExtents
  };
}

type ReadyTraceChunk = {
  /** Ready store-finalized payload retained by the assembled dataset. */
  readonly payload: TraceChunk;
};

/** Resolve finite canonical time extents, deriving them only when no valid bounds are supplied. */
function resolveTraceDatasetTimeExtents(params: {
  /** Store-finalized chunks whose diagnostics carry exact span timing bounds. */
  readonly chunks: readonly TraceChunk[];
  /** Canonical graph-global event table. */
  readonly events: Readonly<ArrowTraceEventTable>;
  /** Metadata-only process records represented by the dataset. */
  readonly processes: readonly ArrowTraceProcessMetadata[];
  /** Optional caller-provided canonical graph-wide time bounds. */
  readonly timeExtents?: TraceDatasetTimeExtents;
}): TraceDatasetTimeExtents {
  if (
    params.timeExtents &&
    Number.isFinite(params.timeExtents.minTimeMs) &&
    Number.isFinite(params.timeExtents.maxTimeMs)
  ) {
    return {
      minTimeMs: Math.min(params.timeExtents.minTimeMs, params.timeExtents.maxTimeMs),
      maxTimeMs: Math.max(params.timeExtents.minTimeMs, params.timeExtents.maxTimeMs)
    };
  }

  let minTimeMs = Number.MAX_SAFE_INTEGER;
  let maxTimeMs = Number.MIN_SAFE_INTEGER;
  for (const chunk of params.chunks) {
    minTimeMs = minFiniteTraceDatasetTime(minTimeMs, chunk.diagnostics.minTimeMs);
    maxTimeMs = maxFiniteTraceDatasetTime(maxTimeMs, chunk.diagnostics.maxTimeMs);
  }
  for (const process of params.processes) {
    for (const instant of process.instants) {
      minTimeMs = minFiniteTraceDatasetTime(minTimeMs, instant.atTimeMs);
      maxTimeMs = maxFiniteTraceDatasetTime(maxTimeMs, instant.atTimeMs);
    }
    for (const counter of process.counters) {
      minTimeMs = minFiniteTraceDatasetTime(minTimeMs, counter.atTimeMs);
      maxTimeMs = maxFiniteTraceDatasetTime(maxTimeMs, counter.atTimeMs);
    }
  }
  const eventTimeColumn = params.events.getChild('atTimeMs');
  for (let rowIndex = 0; rowIndex < params.events.numRows; rowIndex += 1) {
    const atTimeMs = Number(eventTimeColumn?.get(rowIndex) ?? Number.NaN);
    minTimeMs = minFiniteTraceDatasetTime(minTimeMs, atTimeMs);
    maxTimeMs = maxFiniteTraceDatasetTime(maxTimeMs, atTimeMs);
  }
  return {
    minTimeMs: minTimeMs === Number.MAX_SAFE_INTEGER ? 0 : minTimeMs,
    maxTimeMs: maxTimeMs === Number.MIN_SAFE_INTEGER ? 0 : maxTimeMs
  };
}

/** Return whether two canonical dataset time bounds are numerically identical. */
function areTraceDatasetTimeExtentsEqual(
  left: TraceDatasetTimeExtents,
  right: TraceDatasetTimeExtents
): boolean {
  return left.minTimeMs === right.minTimeMs && left.maxTimeMs === right.maxTimeMs;
}

/** Normalize required finite replacement bounds while rejecting invalid dataset snapshots. */
function normalizeRequiredTraceDatasetTimeExtents(
  timeExtents: TraceDatasetTimeExtents
): TraceDatasetTimeExtents {
  if (!Number.isFinite(timeExtents.minTimeMs) || !Number.isFinite(timeExtents.maxTimeMs)) {
    throw new Error('TraceDataset event replacement requires finite time extents.');
  }
  if (timeExtents.minTimeMs <= timeExtents.maxTimeMs) {
    return timeExtents;
  }
  return {
    minTimeMs: Math.min(timeExtents.minTimeMs, timeExtents.maxTimeMs),
    maxTimeMs: Math.max(timeExtents.minTimeMs, timeExtents.maxTimeMs)
  };
}

/** Collect selected process metadata by canonical owner ref, not source rank number. */
function collectSelectedTraceChunkProcesses(
  chunks: readonly TraceChunk[],
  ownerRefSnapshot: TraceDataset['ownerRefSnapshot'],
  processes: readonly ArrowTraceProcessMetadata[]
): readonly ArrowTraceProcessMetadata[] {
  const selectedProcessIds = new Set(
    chunks.flatMap(chunk =>
      chunk.processRefs.flatMap(processRef => {
        const processId = ownerRefSnapshot.processIdByRef.get(processRef);
        return processId ? [processId] : [];
      })
    )
  );
  return processes.filter(process => selectedProcessIds.has(process.processId as TraceProcessId));
}

/** Build selected process/thread/lane count overrides while preserving caller overrides. */
function buildSelectedTraceChunkStats(
  processes: readonly ArrowTraceProcessMetadata[],
  stats?: Partial<TraceGraphStats>
): Partial<TraceGraphStats> {
  return {
    processCount: processes.length,
    threadCount: processes.reduce((total, process) => total + process.threads.length, 0),
    laneCount: countTraceChunkProcessLanes(processes),
    ...stats
  };
}

/** Build complete dataset stats using the same overrides accepted by legacy graph assembly. */
function buildTraceDatasetStats(params: {
  /** Store-finalized chunks whose diagnostics carry exact span status counts. */
  readonly chunks: readonly TraceChunk[];
  /** Metadata-only process records represented by the dataset. */
  readonly processes: readonly ArrowTraceProcessMetadata[];
  /** Canonical graph-global cross-process dependency table. */
  readonly crossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Canonical process-local Arrow dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Readonly<
    Record<TraceProcessId, ArrowTraceSameProcessDependencyTable>
  >;
  /** Optional count overrides preserved from callers. */
  readonly overrides?: Partial<TraceGraphStats>;
}): TraceGraphStats {
  const processCount = params.processes.length;
  const threadCount = params.processes.reduce(
    (total, process) => total + process.threads.length,
    0
  );
  const laneCount = countTraceChunkProcessLanes(params.processes);
  const spanStatusCounts = countTraceChunkSpanStatusCounts(params.chunks);
  const spanCount = params.overrides?.spanCount ?? spanStatusCounts.spanCount;
  const notStartedSpanCount =
    params.overrides?.notStartedSpanCount ?? spanStatusCounts.notStartedSpanCount;
  const unfinishedSpanCount =
    params.overrides?.unfinishedSpanCount ?? spanStatusCounts.unfinishedSpanCount;
  const sameProcessDependencyCount = params.processes.reduce(
    (total, process) =>
      total +
      (params.sameProcessDependencyTableMap[process.processId as TraceProcessId]?.numRows ?? 0),
    0
  );
  const crossProcessDependencyCount = params.crossProcessDependencyTable.numRows;
  return {
    processCount: Math.max(0, params.overrides?.processCount ?? processCount),
    threadCount: Math.max(0, params.overrides?.threadCount ?? threadCount),
    laneCount: Math.max(0, params.overrides?.laneCount ?? laneCount),
    spanCount: Math.max(0, params.overrides?.spanCount ?? spanCount),
    sameProcessDependencyCount: Math.max(
      0,
      params.overrides?.sameProcessDependencyCount ?? sameProcessDependencyCount
    ),
    notStartedSpanCount: Math.max(0, params.overrides?.notStartedSpanCount ?? notStartedSpanCount),
    unfinishedSpanCount: Math.max(0, params.overrides?.unfinishedSpanCount ?? unfinishedSpanCount),
    droppedSpanCount: Math.max(0, params.overrides?.droppedSpanCount ?? 0),
    dependencyCount: Math.max(
      0,
      params.overrides?.dependencyCount ?? sameProcessDependencyCount + crossProcessDependencyCount
    ),
    droppedDependencyCount: Math.max(0, params.overrides?.droppedDependencyCount ?? 0),
    crossProcessDependencyCount: Math.max(
      0,
      params.overrides?.crossProcessDependencyCount ?? crossProcessDependencyCount
    ),
    droppedCrossProcessDependencyCount: Math.max(
      0,
      params.overrides?.droppedCrossProcessDependencyCount ?? 0
    )
  };
}

/** Build append-only stats without rereading previously materialized span statuses. */
function buildAppendedTraceDatasetStats(params: {
  /** Newly ready finalized chunks appended after the previous dataset prefix. */
  readonly addedChunks: readonly TraceChunk[];
  /** Full cross-process dependency set shared by the appended dataset. */
  readonly crossProcessDependencies: readonly TraceCrossProcessDependency[];
  /** Previously assembled dataset whose span stats remain unchanged. */
  readonly previousTraceDataset: TraceDataset;
  /** Process metadata visible in the appended dataset selection. */
  readonly selectedProcesses: readonly ArrowTraceProcessMetadata[];
  /** Optional caller overrides preserved after append-only count derivation. */
  readonly stats?: Partial<TraceGraphStats>;
}): TraceGraphStats {
  const addedSpanStatusCounts = countTraceChunkSpanStatusCounts(params.addedChunks);
  const previousStats = params.previousTraceDataset.stats;
  const sameProcessDependencyCount =
    previousStats.sameProcessDependencyCount +
    params.addedChunks.reduce(
      (total, chunk) => total + chunk.resolvedSameProcessDependencyTable.numRows,
      0
    );
  const crossProcessDependencyCount = params.crossProcessDependencies.length;
  return buildTraceDatasetStats({
    chunks: [],
    processes: params.selectedProcesses,
    crossProcessDependencyTable: params.previousTraceDataset.crossProcessDependencyTable,
    sameProcessDependencyTableMap: {},
    overrides: buildSelectedTraceChunkStats(params.selectedProcesses, {
      spanCount: previousStats.spanCount + addedSpanStatusCounts.spanCount,
      sameProcessDependencyCount,
      notStartedSpanCount:
        previousStats.notStartedSpanCount + addedSpanStatusCounts.notStartedSpanCount,
      unfinishedSpanCount:
        previousStats.unfinishedSpanCount + addedSpanStatusCounts.unfinishedSpanCount,
      droppedSpanCount: previousStats.droppedSpanCount,
      dependencyCount: sameProcessDependencyCount + crossProcessDependencyCount,
      droppedDependencyCount: previousStats.droppedDependencyCount,
      crossProcessDependencyCount,
      droppedCrossProcessDependencyCount: previousStats.droppedCrossProcessDependencyCount,
      ...params.stats
    })
  });
}

/** Count span rows and terminal status buckets from newly appended chunk tables only. */
function countTraceChunkSpanStatusCounts(chunks: readonly TraceChunk[]): {
  /** Number of newly appended span rows. */
  readonly spanCount: number;
  /** Number of newly appended spans that have not started. */
  readonly notStartedSpanCount: number;
  /** Number of newly appended spans that have not finished. */
  readonly unfinishedSpanCount: number;
} {
  let spanCount = 0;
  let notStartedSpanCount = 0;
  let unfinishedSpanCount = 0;
  for (const chunk of chunks) {
    spanCount += chunk.diagnostics.rowCount;
    notStartedSpanCount += chunk.diagnostics.notStartedSpanCount;
    unfinishedSpanCount += chunk.diagnostics.unfinishedSpanCount;
  }
  return {spanCount, notStartedSpanCount, unfinishedSpanCount};
}

/** Return the smaller finite dataset timestamp while ignoring missing values. */
function minFiniteTraceDatasetTime(current: number, candidate: number | null | undefined): number {
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? Math.min(current, candidate)
    : current;
}

/** Return the larger finite dataset timestamp while ignoring missing values. */
function maxFiniteTraceDatasetTime(current: number, candidate: number | null | undefined): number {
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? Math.max(current, candidate)
    : current;
}

/** Count authored or implicit lanes for selected process metadata. */
function countTraceChunkProcessLanes(processes: readonly ArrowTraceProcessMetadata[]): number {
  return processes.reduce((processTotal, process) => {
    return (
      processTotal +
      process.threads.reduce((threadTotal, thread) => {
        const laneValue = (thread.userData as {laneCount?: unknown} | undefined)?.laneCount;
        return threadTotal + normalizeTraceChunkThreadLaneCount(laneValue);
      }, 0)
    );
  }, 0);
}

/** Normalize one authored thread lane count to the stats count used by TraceGraph. */
function normalizeTraceChunkThreadLaneCount(laneValue: unknown): number {
  return typeof laneValue === 'number' && Number.isFinite(laneValue) && laneValue > 0
    ? Math.floor(laneValue)
    : 1;
}

/** Build process-local table maps from process-scoped finalized chunks. */
function buildTraceGraphTableMaps(
  chunks: readonly TraceChunk[],
  ownerRefSnapshot: TraceDataset['ownerRefSnapshot']
): {
  /** Canonical process-local Arrow dependency tables keyed by process id. */
  readonly sameProcessDependencyTableMap: Record<
    TraceProcessId,
    TraceChunk['resolvedSameProcessDependencyTable']
  >;
  /** Optional row-aligned Arrow detail sidecar tables keyed by process id. */
  readonly spanSidecarTableMap: Record<TraceProcessId, NonNullable<TraceChunk['spanSidecarTable']>>;
} {
  const sameProcessDependencyTableMap: Record<
    TraceProcessId,
    TraceChunk['resolvedSameProcessDependencyTable']
  > = {};
  const spanSidecarTableMap: Record<
    TraceProcessId,
    NonNullable<TraceChunk['spanSidecarTable']>
  > = {};
  chunks.forEach(chunk => {
    const processId = getTraceChunkProcessId(chunk, ownerRefSnapshot);
    if (processId == null) {
      return;
    }
    sameProcessDependencyTableMap[processId] = chunk.resolvedSameProcessDependencyTable;
    if (chunk.spanSidecarTable) {
      spanSidecarTableMap[processId] = chunk.spanSidecarTable;
    }
  });
  return {sameProcessDependencyTableMap, spanSidecarTableMap};
}

/** Append new cross-process-dependency rows while retaining previous Arrow record batches. */
function appendArrowTraceCrossProcessDependencyTable(params: {
  /** Previously assembled cross-process-dependency table. */
  readonly previousCrossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
  /** Newly canonicalized cross-process dependency rows after one ready chunk append. */
  readonly addedCrossProcessDependencyTable: Readonly<ArrowTraceCrossProcessDependencyTable>;
}): ArrowTraceCrossProcessDependencyTable {
  const addedCrossProcessDependencyTable = params.addedCrossProcessDependencyTable;
  if (addedCrossProcessDependencyTable.numRows === 0) {
    return params.previousCrossProcessDependencyTable as ArrowTraceCrossProcessDependencyTable;
  }
  if (params.previousCrossProcessDependencyTable.numRows === 0) {
    return addedCrossProcessDependencyTable as ArrowTraceCrossProcessDependencyTable;
  }
  return new arrow.Table(params.previousCrossProcessDependencyTable.schema, [
    ...params.previousCrossProcessDependencyTable.batches,
    ...addedCrossProcessDependencyTable.batches
  ]) as ArrowTraceCrossProcessDependencyTable;
}

/** Return whether one string-keyed table map contains at least one owned entry. */
function hasRecordEntries<TValue>(record: Readonly<Record<string, TValue>>): boolean {
  return Object.keys(record).length > 0;
}

/** Return the single owning process id for one process-scoped finalized chunk. */
function getTraceChunkProcessId(
  chunk: TraceChunk,
  ownerRefSnapshot: TraceDataset['ownerRefSnapshot']
): TraceProcessId | null {
  if (chunk.processRefs.length > 1) {
    throw new Error(
      `TraceChunkData chunks must be process-scoped; ${chunk.chunkKey} has ${chunk.processRefs.length} process refs.`
    );
  }
  const processRef = chunk.processRefs[0];
  if (processRef != null) {
    const processId = ownerRefSnapshot.processIdByRef.get(processRef);
    if (!processId) {
      throw new Error(`Missing process metadata for chunk ${chunk.chunkKey}.`);
    }
    return processId;
  }
  return null;
}

/**
 * Require one canonical process-scoped chunk per dataset process.
 *
 * TraceDataset owns a single process-local dependency table and sidecar table per process. A
 * second chunk for the same process would otherwise silently replace those tables and cold
 * metadata. Time-window chunk composition remains a separate chunk-window materialization path
 * until the dataset shape gains an explicit multi-batch-per-process contract.
 */
function assertUniqueTraceDatasetProcessChunks(
  chunks: readonly TraceChunk[],
  ownerRefSnapshot: TraceDataset['ownerRefSnapshot']
): void {
  const chunkKeyByProcessId = new Map<TraceProcessId, string>();
  for (const chunk of chunks) {
    const processId = getTraceChunkProcessId(chunk, ownerRefSnapshot);
    if (processId == null) {
      continue;
    }
    const previousChunkKey = chunkKeyByProcessId.get(processId);
    if (previousChunkKey != null) {
      throw new Error(
        `TraceDataset requires one process-scoped chunk per process; ${processId} appears in ${previousChunkKey} and ${chunk.chunkKey}.`
      );
    }
    chunkKeyByProcessId.set(processId, chunk.chunkKey);
  }
}

/**
 * Materialize dataset process metadata in append-only owner-ref order.
 *
 * The owner registry owns only stable low-cardinality process/thread identity. Chunk-local source
 * metadata remains the owner for instants, counters, remote dependencies, source rank numbers,
 * and thread user data, so dataset assembly does not silently erase those cold compatibility
 * surfaces or retain them in a long-lived registry.
 */
function buildTraceDatasetProcesses(
  ownerRefRegistry: TraceOwnerRefRegistry,
  chunks: readonly TraceChunk[]
): readonly ArrowTraceProcessMetadata[] {
  const sourceProcessById = new Map<TraceProcessId, ArrowTraceProcessMetadata>();
  for (const chunk of chunks) {
    for (const process of chunk.processes) {
      sourceProcessById.set(process.processId as TraceProcessId, process);
    }
  }

  return ownerRefRegistry.getOwnerProcessSnapshots().map(ownerProcess => {
    const sourceProcess = sourceProcessById.get(ownerProcess.processId as TraceProcessId);
    const sourceThreadById = new Map(
      (sourceProcess?.threads ?? []).map(thread => [thread.threadId, thread] as const)
    );
    const threads = ownerProcess.threads.map(ownerThread => {
      const sourceThread = sourceThreadById.get(ownerThread.threadId);
      return sourceThread
        ? {
            ...sourceThread,
            type: ownerThread.type,
            processId: ownerThread.processId,
            threadId: ownerThread.threadId,
            name: ownerThread.name
          }
        : ownerThread;
    });
    return {
      type: ownerProcess.type,
      processId: ownerProcess.processId,
      name: ownerProcess.name,
      tags: ownerProcess.tags,
      rankNum: sourceProcess?.rankNum ?? ownerProcess.rankNum,
      processOrder: sourceProcess?.processOrder ?? ownerProcess.processOrder,
      stepNum: ownerProcess.stepNum,
      threads,
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])),
      instants: sourceProcess?.instants ?? [],
      instantMap: sourceProcess?.instantMap ?? {},
      threadInstantMap: sourceProcess?.threadInstantMap ?? {},
      counters: sourceProcess?.counters ?? [],
      counterMap: sourceProcess?.counterMap ?? {},
      threadCounterMap: sourceProcess?.threadCounterMap ?? {},
      remoteDependencies: sourceProcess?.remoteDependencies ?? [],
      userData: ownerProcess.userData
    } satisfies ArrowTraceProcessMetadata;
  });
}

/** Build sparse unresolved endpoint sidecars from finalized chunk endpoint groups. */
function buildTraceDatasetCrossProcessEndpointsBySpanRef(
  chunks: readonly TraceChunk[]
): TraceCrossProcessEndpointsBySpanRef | undefined {
  const endpointsBySpanRef = new Map<SpanRef, readonly TraceCrossProcessEndpoint[]>();
  for (const chunk of chunks) {
    for (const endpoints of Object.values(chunk.crossProcessEndpointsByEndpointId ?? {})) {
      for (const endpoint of endpoints) {
        if (endpoint.spanRef == null) {
          continue;
        }
        const previousEndpoints = endpointsBySpanRef.get(endpoint.spanRef);
        endpointsBySpanRef.set(
          endpoint.spanRef,
          previousEndpoints ? [...previousEndpoints, endpoint] : [endpoint]
        );
      }
    }
  }
  return endpointsBySpanRef.size === 0 ? undefined : endpointsBySpanRef;
}

/** Merge sparse endpoint sidecars while preserving either input identity when the other is empty. */
function mergeTraceDatasetCrossProcessEndpointsBySpanRef(
  previousEndpointsBySpanRef: TraceCrossProcessEndpointsBySpanRef | undefined,
  addedEndpointsBySpanRef: TraceCrossProcessEndpointsBySpanRef | undefined
): TraceCrossProcessEndpointsBySpanRef | undefined {
  if (!previousEndpointsBySpanRef || previousEndpointsBySpanRef.size === 0) {
    return addedEndpointsBySpanRef;
  }
  if (!addedEndpointsBySpanRef || addedEndpointsBySpanRef.size === 0) {
    return previousEndpointsBySpanRef;
  }
  const endpointsBySpanRef = new Map(previousEndpointsBySpanRef);
  addedEndpointsBySpanRef.forEach((addedEndpoints, spanRef) => {
    const previousEndpoints = endpointsBySpanRef.get(spanRef);
    endpointsBySpanRef.set(
      spanRef,
      previousEndpoints ? [...previousEndpoints, ...addedEndpoints] : addedEndpoints
    );
  });
  return endpointsBySpanRef;
}
