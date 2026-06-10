import {log} from '../log';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {getArrowTraceSpanField, iterateTraceGraphProcessSpanRefs} from '../trace-graph-accessors';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  encodeCrossDependencyRef,
  encodeLocalDependencyRef,
  encodeLocalSpanRef,
  getCrossDependencyRefChunkIndex,
  getCrossDependencyRefRowIndex,
  getLocalDependencyRefProcessIndex,
  getLocalDependencyRefRowIndex,
  getProcessRefIndex,
  getSpanRefChunkIndex,
  getSpanRefRowIndex,
  getTraceRefKind,
  getVisibleCrossDependencyRefIndex,
  getVisibleLocalDependencyRefIndex
} from '../trace-graph/trace-id-encoder';
import {shouldShowLocalDependencyByModeFields} from './local-dependency-filter';
import {
  buildTraceCrossRankDependencyGeometry,
  getLocalDependencyPathFlat,
  getSpanBoundingBox,
  getTraceLayoutSpanVisibilityForBlock
} from './trace-geometry-layout-common';
import {
  buildProcessGeometryLayoutLookup,
  buildStreamToProcessLayoutMap,
  buildTraceGeometryLayoutLookup,
  buildVisibleTraceGraph,
  computeTraceLayoutBounds,
  getObjectIdentityId,
  getProcessLayoutForGeometryBlock,
  getProcessSpanChunkCacheKey,
  getThreadLayoutForGeometryBlock,
  getVisibleBlocksForProcess,
  getVisibleLocalDependencyRefsForProcess,
  resolveGeometryBlock
} from './trace-geometry-layout-helpers';
import {buildTraceLayoutGeometryColumn, createTraceLayoutGeometryColumn} from './trace-layout';

import type {
  ArrowTraceLocalDependencyTable,
  TraceGraphData,
  TraceProcessSpanRefTable
} from '../ingestion/arrow-trace';
import type {
  CrossDependencyRef,
  LocalDependencyRef,
  TraceDependencyRef,
  VisibleCrossDependencyRef,
  VisibleLocalDependencyRef
} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {SpanRef, TraceProcessId, TraceSpanId, TraceThreadId} from '../trace-graph/trace-types';
import type {
  TraceGeometryLayoutLookup,
  TraceSpanGeometrySource
} from './trace-geometry-layout-common';
import type {
  ProcessLayout,
  ThreadLayout,
  TraceLayout,
  TraceLayoutDependencyGeometryChunk,
  TraceLayoutGeometryCache,
  TraceLayoutGeometryColumn,
  TraceLayoutProcessGeometryCacheEntry,
  TraceLayoutSpanGeometryChunk,
  TraceLayoutSpanVisibility,
  TraceLayoutVisibleGraph,
  TraceLayoutVisibleProcessMetadata
} from './trace-layout';

const spanTableUsesMaxTimeFallbackCache = new WeakMap<object, boolean>();

type TraceLayoutLocalDependencyGeometryLocation = {
  /** Geometry chunk index in `localDependencyGeometryChunks`. */
  readonly chunkIndex: number;
  /** Row index inside the geometry chunk. */
  readonly rowIndex: number;
};

type TraceLayoutCrossDependencyGeometryLocation = {
  /** Geometry chunk index in `crossDependencyGeometryChunks`. */
  readonly chunkIndex: number;
  /** Row index inside the geometry chunk. */
  readonly rowIndex: number;
};

/**
 * Rebuilds span and dependency geometry columns for a trace layout while reusing unchanged
 * process-local geometry chunks from the previous layout cache.
 */
export function populateTraceLayoutGeometry(params: {
  traceGraph: TraceGraphData;
  visibleTraceGraph?: TraceLayoutVisibleGraph;
  traceLayout: TraceLayout;
  settings: Pick<TraceVisSettings, 'localDependencyMode'>;
  timingKey?: string | null;
  minTimeMs?: number;
  blockHeight?: number;
  includedBlockIdsByProcessId?: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
}): TraceLayout {
  const geometryStartTime = performance.now();
  const {traceGraph, traceLayout, timingKey, settings, blockHeight = 0.3} = params;
  const geometryTraceGraph =
    params.visibleTraceGraph ??
    buildVisibleTraceGraph(
      new TraceGraph(
        createStaticTraceGraphRuntimeSource({
          identityKey: `${traceGraph.name}:geometry-rebuild`,
          traceGraphData: traceGraph
        })
      )
    );
  const {processes, crossDependencies} = geometryTraceGraph;
  log.probe(0, 'rebuildTraceLayoutGeometry start', {
    graphName: traceGraph.name,
    processCount: processes.length,
    crossDependencyCount: crossDependencies.length,
    spanCount: traceGraph.stats.spanCount,
    hasPreviousGeometryCache: Boolean(traceLayout.geometryCache)
  })();
  const maxTimeMs = traceGraph.maxTimeMs;
  const spanVisibilityMapBySpanRef = new Map<SpanRef, TraceLayoutSpanVisibility>();
  const streamToProcessLayoutMap = buildStreamToProcessLayoutMap(
    processes,
    traceLayout.processLayouts
  );
  const geometryLayoutLookupStartTime = performance.now();
  const geometryLayoutLookup = buildTraceGeometryLayoutLookup({
    visibleTraceGraph: geometryTraceGraph,
    processLayouts: traceLayout.processLayouts,
    fallbackThreadLayoutMap: traceLayout.threadLayoutMap,
    fallbackStreamToProcessLayoutMap: streamToProcessLayoutMap
  });
  const geometryLayoutLookupDurationMs = performance.now() - geometryLayoutLookupStartTime;
  const minTimeMs = params.minTimeMs ?? traceGraph.minTimeMs;
  const previousGeometryCache = traceLayout.geometryCache;
  const processGeometryStartTime = performance.now();
  let reusedProcessGeometryCount = 0;
  let fastReusedProcessGeometryCount = 0;
  let translatedProcessGeometryCount = 0;
  let builtProcessGeometryCount = 0;
  let reusedLocalDependencyGeometryCount = 0;
  let builtLocalDependencyGeometryCount = 0;
  const nextProcessesById: Record<string, TraceLayoutProcessGeometryCacheEntry> = {};
  const spanGeometryChunks: TraceLayoutSpanGeometryChunk[] = [];
  const localDependencyGeometryChunks: TraceLayoutDependencyGeometryChunk[] = [];

  for (const [rankIndex, rank] of processes.entries()) {
    const processLayout = traceLayout.processLayouts[rankIndex];
    const processLayoutLookup = buildProcessGeometryLayoutLookup({
      globalLookup: geometryLayoutLookup,
      process: rank,
      processLayout
    });
    const processGeometry = buildOrReuseProcessTraceLayoutGeometry({
      blockHeight,
      geometryTraceGraph,
      maxTimeMs,
      minTimeMs,
      previousGeometryCache,
      process: rank,
      processId: rank.processId,
      processLayout,
      settings,
      layoutLookup: processLayoutLookup,
      streamToProcessLayoutMap,
      threadLayoutMap: traceLayout.threadLayoutMap,
      timingKey,
      includedBlockIdsByProcessId: params.includedBlockIdsByProcessId
    });
    if (processGeometry.didReuse) {
      reusedProcessGeometryCount += 1;
      if (processGeometry.didFastReuse) {
        fastReusedProcessGeometryCount += 1;
      }
      if (processGeometry.didTranslate) {
        translatedProcessGeometryCount += 1;
      }
      reusedLocalDependencyGeometryCount += processGeometry.localDependencyGeometryCount;
    } else {
      builtProcessGeometryCount += 1;
      builtLocalDependencyGeometryCount += processGeometry.localDependencyGeometryCount;
    }
    nextProcessesById[rank.processId] = processGeometry.entry;
    mergeTraceLayoutGeometryChunks(spanGeometryChunks, processGeometry.entry.spanGeometryChunks);
    mergeTraceLayoutGeometryChunks(
      localDependencyGeometryChunks,
      processGeometry.entry.localDependencyGeometryChunks
    );
    populateProcessTraceLayoutSpanVisibility({
      geometryTraceGraph,
      includedBlockIdsByProcessId: params.includedBlockIdsByProcessId,
      layoutLookup: processLayoutLookup,
      processId: rank.processId,
      spanVisibilityMapBySpanRef,
      streamToProcessLayoutMap,
      threadLayoutMap: traceLayout.threadLayoutMap
    });
  }
  const processGeometryDurationMs = performance.now() - processGeometryStartTime;

  const crossGeometryStartTime = performance.now();
  const crossDependencyGeometryChunks: TraceLayoutDependencyGeometryChunk[] = [];
  const crossGeometryResult = buildTraceCrossRankDependencyGeometriesForLayout({
    crossDependencies,
    previousGeometryCache,
    maxTimeMs,
    minTimeMs,
    layoutLookup: geometryLayoutLookup,
    threadLayoutMap: traceLayout.threadLayoutMap,
    streamToProcessLayoutMap,
    crossDependencyGeometryChunks,
    traceGraph: geometryTraceGraph.traceGraph
  });
  const crossGeometryDurationMs = performance.now() - crossGeometryStartTime;
  const geometryCache: TraceLayoutGeometryCache = {
    processesById: nextProcessesById,
    spanGeometryChunks,
    localDependencyGeometryChunks,
    crossDependencyGeometryChunks,
    crossDependencyReuseKeyByVisibleRef: crossGeometryResult.reuseKeyByVisibleRef
  };

  log.probe(0, 'rebuildTraceLayoutGeometry done', {
    processCount: processes.length,
    crossDependencyCount: crossDependencies.length,
    reusedProcessGeometryCount,
    fastReusedProcessGeometryCount,
    translatedProcessGeometryCount,
    builtProcessGeometryCount,
    reusedLocalDependencyGeometryCount,
    builtLocalDependencyGeometryCount,
    reusedCrossGeometryCount: crossGeometryResult.reusedCrossGeometryCount,
    builtCrossGeometryCount: crossGeometryResult.builtCrossGeometryCount,
    skippedCrossStartBlockCount: crossGeometryResult.skippedStartBlockCount,
    skippedCrossEndBlockCount: crossGeometryResult.skippedEndBlockCount,
    geometryLayoutLookupDurationMs,
    processGeometryDurationMs,
    crossGeometryDurationMs,
    durationMs: performance.now() - geometryStartTime
  })();

  return {
    ...traceLayout,
    spanGeometryChunks,
    spanVisibilityMapBySpanRef,
    localDependencyGeometryChunks,
    crossDependencyGeometryChunks,
    geometryCache,
    currentBounds: computeTraceLayoutBounds({
      traceLayout,
      minTimeMs: traceGraph.minTimeMs,
      maxTimeMs: traceGraph.maxTimeMs
    })
  };
}

/**
 * Returns reusable block/local-dependency geometry for one process, rebuilding only when its
 * visible blocks, local dependencies, timing projection, or lane geometry changed.
 */
function buildOrReuseProcessTraceLayoutGeometry(params: {
  blockHeight: number;
  geometryTraceGraph: TraceLayoutVisibleGraph;
  maxTimeMs: number;
  minTimeMs: number;
  previousGeometryCache?: TraceLayoutGeometryCache;
  process: TraceLayoutVisibleProcessMetadata;
  processId: string;
  processLayout?: ProcessLayout;
  settings: Pick<TraceVisSettings, 'localDependencyMode'>;
  layoutLookup: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
  timingKey?: string | null;
  includedBlockIdsByProcessId?: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
}): {
  entry: TraceLayoutProcessGeometryCacheEntry;
  didReuse: boolean;
  didFastReuse: boolean;
  didTranslate: boolean;
  localDependencyGeometryCount: number;
} {
  const previousEntry = params.previousGeometryCache?.processesById[params.processId];
  const fastReuseKey = buildFastProcessTraceLayoutGeometryReuseKey({
    blockHeight: params.blockHeight,
    geometryTraceGraph: params.geometryTraceGraph,
    maxTimeMs: params.maxTimeMs,
    minTimeMs: params.minTimeMs,
    process: params.process,
    processId: params.processId,
    processLayout: params.processLayout,
    localDependencyMode: params.settings.localDependencyMode,
    timingKey: params.timingKey,
    includedBlockIdsByProcessId: params.includedBlockIdsByProcessId
  });
  if (fastReuseKey && previousEntry?.fastReuseKey === fastReuseKey) {
    const entry = translateProcessTraceLayoutGeometryCacheEntry({
      currentGeometryXOffset: getProcessLayoutGeometryXOffset(params.minTimeMs),
      currentGeometryYOffset: getProcessLayoutTranslationY(params.processLayout),
      previousEntry
    });
    return {
      entry,
      didReuse: true,
      didFastReuse: true,
      didTranslate: entry !== previousEntry,
      localDependencyGeometryCount: countTraceLayoutGeometryChunkRows(
        entry.localDependencyGeometryChunks
      )
    };
  }

  const includedBlockIds = params.includedBlockIdsByProcessId?.[params.processId];
  const visibleBlocks = getVisibleBlocksForProcess(
    params.geometryTraceGraph,
    params.processId
  ).filter(block => includedBlockIds?.has(block.spanId) ?? true);
  const localDependencyTable = !params.geometryTraceGraph.traceGraph.hasActiveSpanFilter()
    ? params.geometryTraceGraph.traceGraph.localDependencyTableMap[
        params.processId as TraceProcessId
      ]
    : undefined;
  const canUseArrowDependencyIteration = localDependencyTable?.getChild('dependencyRef') != null;
  const dependencyRefCount = canUseArrowDependencyIteration
    ? (localDependencyTable?.numRows ?? 0)
    : getVisibleGeometryLocalDependencyRefs({
        geometryTraceGraph: params.geometryTraceGraph,
        processId: params.processId,
        includedBlockIds,
        localDependencyMode: params.settings.localDependencyMode
      }).length;
  const shouldBuildReuseKey =
    previousEntry != null ||
    shouldBuildInitialProcessTraceLayoutGeometryReuseKey({
      dependencyRefCount,
      visibleBlockCount: visibleBlocks.length
    });
  const dependencyRefs =
    canUseArrowDependencyIteration && !shouldBuildReuseKey
      ? []
      : getVisibleGeometryLocalDependencyRefs({
          geometryTraceGraph: params.geometryTraceGraph,
          processId: params.processId,
          includedBlockIds,
          localDependencyMode: params.settings.localDependencyMode
        });
  const reuseKey = !shouldBuildReuseKey
    ? ''
    : buildProcessTraceLayoutGeometryReuseKey({
        dependencyRefCount,
        geometryTraceGraph: params.geometryTraceGraph,
        maxTimeMs: params.maxTimeMs,
        minTimeMs: params.minTimeMs,
        process: params.process,
        processId: params.processId,
        processLayout: params.processLayout,
        threadLayoutMap: params.threadLayoutMap,
        timingKey: params.timingKey,
        visibleBlockCount: visibleBlocks.length,
        blockHeight: params.blockHeight,
        includedBlockIds,
        localDependencyMode: params.settings.localDependencyMode
      });
  if (previousEntry != null && previousEntry.reuseKey === reuseKey) {
    const entry = translateProcessTraceLayoutGeometryCacheEntry({
      currentGeometryXOffset: getProcessLayoutGeometryXOffset(params.minTimeMs),
      currentGeometryYOffset: getProcessLayoutTranslationY(params.processLayout),
      previousEntry
    });
    return {
      entry,
      didReuse: true,
      didFastReuse: false,
      didTranslate: entry !== previousEntry,
      localDependencyGeometryCount: countTraceLayoutGeometryChunkRows(
        entry.localDependencyGeometryChunks
      )
    };
  }

  const geometryBlocks = visibleBlocks.map(block => resolveGeometryBlock(block, params.timingKey));
  const spanGeometryChunks: TraceLayoutSpanGeometryChunk[] = [];
  const localDependencyGeometryChunks: TraceLayoutDependencyGeometryChunk[] = [];
  let skippedStartBlockCount = 0;
  let skippedEndBlockCount = 0;

  for (const [blockIndex, geometryBlock] of geometryBlocks.entries()) {
    const sourceBlock = visibleBlocks[blockIndex];
    const spanRef = sourceBlock?.spanRef ?? null;
    if (spanRef != null) {
      const geometry = getSpanBoundingBox(
        geometryBlock,
        params.threadLayoutMap,
        params.maxTimeMs,
        params.minTimeMs,
        params.blockHeight,
        params.layoutLookup
      );
      const chunkIndex = getSpanRefChunkIndex(spanRef);
      const rowIndex = getSpanRefRowIndex(spanRef);
      writeTraceLayoutGeometryRow(
        getOrCreateTraceLayoutGeometryChunk(
          spanGeometryChunks,
          chunkIndex,
          getSpanGeometryChunkRowCount(
            params.geometryTraceGraph.traceGraph,
            chunkIndex,
            rowIndex + 1
          )
        ),
        rowIndex,
        geometry
      );
    }
  }

  if (canUseArrowDependencyIteration && localDependencyTable && !shouldBuildReuseKey) {
    const skippedCounts = populateUnfilteredLocalDependencyGeometryFromArrowTable({
      geometryTraceGraph: params.geometryTraceGraph,
      includedBlockIds,
      layoutLookup: params.layoutLookup,
      localDependencyGeometryChunks,
      localDependencyMode: params.settings.localDependencyMode,
      maxTimeMs: params.maxTimeMs,
      minTimeMs: params.minTimeMs,
      streamToProcessLayoutMap: params.streamToProcessLayoutMap,
      table: localDependencyTable,
      threadLayoutMap: params.threadLayoutMap
    });
    skippedStartBlockCount += skippedCounts.skippedStartBlockCount;
    skippedEndBlockCount += skippedCounts.skippedEndBlockCount;
  } else {
    for (const dependencyRef of dependencyRefs) {
      const sourceDependencyRef =
        getTraceRefKind(dependencyRef) === 'localDependency'
          ? (dependencyRef as LocalDependencyRef)
          : params.geometryTraceGraph.traceGraph.getDependencySourceRefByRef(dependencyRef);
      const sourceLocalDependencyRef =
        sourceDependencyRef != null && getTraceRefKind(sourceDependencyRef) === 'localDependency'
          ? (sourceDependencyRef as LocalDependencyRef)
          : null;
      const startSpanRef =
        params.geometryTraceGraph.traceGraph.getVisibleDependencyStartSpan(dependencyRef);
      const rawStartBlock =
        startSpanRef == null
          ? null
          : addSpanRefToGeometryBlockSource(
              params.geometryTraceGraph.traceGraph,
              params.geometryTraceGraph.traceGraph.getSpanDisplaySource(startSpanRef),
              startSpanRef
            );
      const startSpan =
        rawStartBlock == null ? null : resolveGeometryBlock(rawStartBlock, params.timingKey);
      if (!startSpan) {
        skippedStartBlockCount += 1;
        continue;
      }
      const endSpanRef =
        params.geometryTraceGraph.traceGraph.getVisibleDependencyEndSpan(dependencyRef);
      const rawEndBlock =
        endSpanRef == null
          ? null
          : addSpanRefToGeometryBlockSource(
              params.geometryTraceGraph.traceGraph,
              params.geometryTraceGraph.traceGraph.getSpanDisplaySource(endSpanRef),
              endSpanRef
            );
      const endSpan =
        rawEndBlock == null ? null : resolveGeometryBlock(rawEndBlock, params.timingKey);
      if (!endSpan) {
        skippedEndBlockCount += 1;
        continue;
      }
      const waitMode =
        params.geometryTraceGraph.traceGraph.getVisibleDependencyWaitMode(dependencyRef);
      const dependencyId =
        params.geometryTraceGraph.traceGraph.getVisibleDependencyIdByRef(dependencyRef);
      if (!waitMode || !dependencyId) {
        continue;
      }
      const geometry = getLocalDependencyPathFlat({
        startBlock: startSpan,
        endBlock: endSpan,
        threadLayoutMap: params.threadLayoutMap,
        layoutLookup: params.layoutLookup,
        streamToProcessLayoutMap: params.streamToProcessLayoutMap,
        maxTimeMs: params.maxTimeMs,
        minTimeMs: params.minTimeMs,
        waitMode,
        bidirectional:
          params.geometryTraceGraph.traceGraph.getVisibleDependencyBidirectional(dependencyRef) ??
          false
      });
      const geometryLocation = resolveLocalDependencyGeometryLocation({
        dependencyRef,
        sourceLocalDependencyRef,
        traceGraph: params.geometryTraceGraph.traceGraph
      });
      if (geometryLocation != null) {
        writeTraceLayoutGeometryRow(
          getOrCreateTraceLayoutGeometryChunk(
            localDependencyGeometryChunks,
            geometryLocation.chunkIndex,
            geometryLocation.rowIndex + 1
          ),
          geometryLocation.rowIndex,
          geometry
        );
      }
    }
  }
  if (skippedStartBlockCount > 0 || skippedEndBlockCount > 0) {
    log.probe(1, 'Skipped local dependency geometries with missing endpoint blocks', {
      skippedStartBlockCount,
      skippedEndBlockCount
    })();
  }

  return {
    didReuse: false,
    didFastReuse: false,
    didTranslate: false,
    localDependencyGeometryCount: countTraceLayoutGeometryChunkRows(localDependencyGeometryChunks),
    entry: {
      processId: params.processId,
      processRef: params.process.processRef,
      fastReuseKey,
      reuseKey,
      geometryXOffset: getProcessLayoutGeometryXOffset(params.minTimeMs),
      geometryYOffset: getProcessLayoutTranslationY(params.processLayout),
      spanGeometryChunks,
      localDependencyGeometryChunks
    }
  };
}

/** Translates a reused process geometry cache entry when only process X/Y offsets changed. */
function translateProcessTraceLayoutGeometryCacheEntry(params: {
  readonly currentGeometryXOffset: number;
  readonly currentGeometryYOffset: number;
  readonly previousEntry: TraceLayoutProcessGeometryCacheEntry;
}): TraceLayoutProcessGeometryCacheEntry {
  const previousXOffset = params.previousEntry.geometryXOffset;
  const previousYOffset = params.previousEntry.geometryYOffset;
  const dx =
    typeof previousXOffset === 'number' && Number.isFinite(previousXOffset)
      ? params.currentGeometryXOffset - previousXOffset
      : 0;
  const dy =
    typeof previousYOffset === 'number' && Number.isFinite(previousYOffset)
      ? params.currentGeometryYOffset - previousYOffset
      : 0;
  if (dx === 0 && dy === 0) {
    return params.previousEntry;
  }

  return {
    ...params.previousEntry,
    geometryXOffset: params.currentGeometryXOffset,
    geometryYOffset: params.currentGeometryYOffset,
    spanGeometryChunks: translateTraceLayoutGeometryChunks(
      params.previousEntry.spanGeometryChunks,
      dx,
      dy
    ),
    localDependencyGeometryChunks: translateTraceLayoutGeometryChunks(
      params.previousEntry.localDependencyGeometryChunks,
      dx,
      dy
    )
  };
}

/** Returns translated copies of sparse geometry chunks while preserving sparse indexes. */
function translateTraceLayoutGeometryChunks<T extends TraceLayoutGeometryColumn>(
  chunks: readonly T[] | undefined,
  dx: number,
  dy: number
): T[] | undefined {
  if (!chunks) {
    return undefined;
  }
  const result: T[] = [];
  for (const [index, chunk] of chunks.entries()) {
    if (chunk) {
      result[index] = translateTraceLayoutGeometryColumn(chunk, dx, dy) as T;
    }
  }
  return result;
}

/** Returns a copy of one packed geometry column translated by fixed X/Y offsets. */
function translateTraceLayoutGeometryColumn(
  column: TraceLayoutGeometryColumn,
  dx: number,
  dy: number
): TraceLayoutGeometryColumn {
  const values = new Float32Array(column.values);
  for (let offset = 0; offset < values.length; offset += 4) {
    values[offset] += dx;
    values[offset + 1] += dy;
    values[offset + 2] += dx;
    values[offset + 3] += dy;
  }
  return buildTraceLayoutGeometryColumn(values);
}

/**
 * Populates unfiltered local dependency geometry by scanning Arrow dependency columns directly.
 */
function populateUnfilteredLocalDependencyGeometryFromArrowTable(params: {
  /** Source graph whose dependency table is being rendered. */
  geometryTraceGraph: TraceLayoutVisibleGraph;
  /** Optional exact block filter for focused geometry builds. */
  includedBlockIds?: ReadonlySet<TraceSpanId>;
  /** Ref-native layout lookup used for path construction. */
  layoutLookup: TraceGeometryLayoutLookup;
  /** Output geometry chunks keyed by encoded local-dependency process index. */
  localDependencyGeometryChunks: TraceLayoutDependencyGeometryChunk[];
  /** Current local dependency visibility mode. */
  localDependencyMode: TraceVisSettings['localDependencyMode'];
  /** Maximum rendered time in milliseconds. */
  maxTimeMs: number;
  /** Minimum rendered time in milliseconds. */
  minTimeMs: number;
  /** Optional process layouts keyed by process-local stream id. */
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  /** Process-local Arrow dependency table. */
  table: ArrowTraceLocalDependencyTable;
  /** Thread layouts keyed by process-local stream id. */
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
}): {
  skippedStartBlockCount: number;
  skippedEndBlockCount: number;
} {
  const dependencyRefColumn = params.table.getChild('dependencyRef');
  const dependencyIdColumn = params.table.getChild('dependencyId');
  const startSpanRefColumn = params.table.getChild('startSpanRef');
  const startSpanIdColumn = params.table.getChild('startSpanId');
  const endSpanRefColumn = params.table.getChild('endSpanRef');
  const endSpanIdColumn = params.table.getChild('endSpanId');
  const waitModeColumn = params.table.getChild('waitMode');
  const bidirectionalColumn = params.table.getChild('bidirectional');
  const waitTimeMsColumn = params.table.getChild('waitTimeMs');
  const keywordsColumn = params.table.getChild('keywords');
  let skippedStartBlockCount = 0;
  let skippedEndBlockCount = 0;

  for (let rowIndex = 0; rowIndex < params.table.numRows; rowIndex += 1) {
    const dependencyRef = normalizeArrowRefNumber(dependencyRefColumn?.get(rowIndex));
    const dependencyId = dependencyIdColumn?.get(rowIndex);
    const waitMode = waitModeColumn?.get(rowIndex);
    if (dependencyRef == null || typeof dependencyId !== 'string' || !isLayoutWaitMode(waitMode)) {
      continue;
    }
    if (
      params.localDependencyMode !== 'all' &&
      !shouldShowLocalDependencyByModeFields(
        params.localDependencyMode,
        dependencyKeywordListHas(keywordsColumn?.get(rowIndex), 'SUBMIT'),
        normalizeArrowNumber(waitTimeMsColumn?.get(rowIndex)) ?? 0
      )
    ) {
      continue;
    }

    const startSpanId = startSpanIdColumn?.get(rowIndex);
    const endSpanId = endSpanIdColumn?.get(rowIndex);
    if (
      params.includedBlockIds != null &&
      (typeof startSpanId !== 'string' ||
        typeof endSpanId !== 'string' ||
        !params.includedBlockIds.has(startSpanId as TraceSpanId) ||
        !params.includedBlockIds.has(endSpanId as TraceSpanId))
    ) {
      continue;
    }

    const dependencyProcessIndex = getLocalDependencyRefProcessIndex(
      dependencyRef as LocalDependencyRef
    );
    const startSpanRef = resolveLocalDependencyEndpointSpanRef({
      blockId: startSpanId,
      dependencyProcessIndex,
      spanRef: normalizeArrowRefNumber(startSpanRefColumn?.get(rowIndex)) as SpanRef | null,
      traceGraph: params.geometryTraceGraph.traceGraph
    });
    const startSpan =
      startSpanRef == null
        ? null
        : addSpanRefToGeometryBlockSource(
            params.geometryTraceGraph.traceGraph,
            params.geometryTraceGraph.traceGraph.getSpanDisplaySource(startSpanRef),
            startSpanRef
          );
    if (!startSpan) {
      skippedStartBlockCount += 1;
      continue;
    }

    const endSpanRef = resolveLocalDependencyEndpointSpanRef({
      blockId: endSpanId,
      dependencyProcessIndex,
      spanRef: normalizeArrowRefNumber(endSpanRefColumn?.get(rowIndex)) as SpanRef | null,
      traceGraph: params.geometryTraceGraph.traceGraph
    });
    const endSpan =
      endSpanRef == null
        ? null
        : addSpanRefToGeometryBlockSource(
            params.geometryTraceGraph.traceGraph,
            params.geometryTraceGraph.traceGraph.getSpanDisplaySource(endSpanRef),
            endSpanRef
          );
    if (!endSpan) {
      skippedEndBlockCount += 1;
      continue;
    }

    const geometry = getLocalDependencyPathFlat({
      startBlock: startSpan,
      endBlock: endSpan,
      threadLayoutMap: params.threadLayoutMap,
      layoutLookup: params.layoutLookup,
      streamToProcessLayoutMap: params.streamToProcessLayoutMap,
      maxTimeMs: params.maxTimeMs,
      minTimeMs: params.minTimeMs,
      waitMode,
      bidirectional: bidirectionalColumn?.get(rowIndex) === true
    });
    writeTraceLayoutGeometryRow(
      getOrCreateTraceLayoutGeometryChunk(
        params.localDependencyGeometryChunks,
        getLocalDependencyRefProcessIndex(dependencyRef as LocalDependencyRef),
        getLocalDependencyRefRowIndex(dependencyRef as LocalDependencyRef) + 1
      ),
      getLocalDependencyRefRowIndex(dependencyRef as LocalDependencyRef),
      geometry
    );
  }

  return {skippedStartBlockCount, skippedEndBlockCount};
}

/** Resolves the local-dependency geometry chunk row for source or visible-only refs. */
function resolveLocalDependencyGeometryLocation(params: {
  /** Visible or source dependency ref carried by the rendered dependency. */
  dependencyRef: TraceDependencyRef | VisibleLocalDependencyRef | null | undefined;
  /** Source dependency ref when the rendered dependency maps to an Arrow source row. */
  sourceLocalDependencyRef: LocalDependencyRef | null;
  /** Trace graph that owns source process-indexed local dependencies. */
  traceGraph: Readonly<TraceGraph>;
}): TraceLayoutLocalDependencyGeometryLocation | null {
  if (params.sourceLocalDependencyRef != null) {
    return {
      chunkIndex: getLocalDependencyRefProcessIndex(params.sourceLocalDependencyRef),
      rowIndex: getLocalDependencyRefRowIndex(params.sourceLocalDependencyRef)
    };
  }
  if (
    params.dependencyRef == null ||
    getTraceRefKind(params.dependencyRef) !== 'visibleLocalDependency'
  ) {
    return null;
  }
  const syntheticRef = encodeLocalDependencyRef(
    encodeLocalSpanRef(
      0,
      getVisibleLocalDependencyRefIndex(params.dependencyRef as VisibleLocalDependencyRef)
    )
  );
  return {
    chunkIndex:
      getSyntheticLocalDependencyChunkOffset(params.traceGraph) +
      getLocalDependencyRefProcessIndex(syntheticRef),
    rowIndex: getLocalDependencyRefRowIndex(syntheticRef)
  };
}

/** Returns the first chunk index reserved for visible-only local-dependency geometry. */
function getSyntheticLocalDependencyChunkOffset(traceGraph: Readonly<TraceGraph>): number {
  return traceGraph.getProcessRefs().length;
}

/** Writes one four-float geometry tuple into a row-aligned layout geometry column. */
function writeTraceLayoutGeometryRow(
  column: TraceLayoutGeometryColumn,
  rowIndex: number,
  geometry: ArrayLike<number>
): void {
  if (rowIndex < 0 || rowIndex >= column.table.numRows) {
    return;
  }
  const offset = rowIndex * 4;
  column.values[offset] = geometry[0] ?? 0;
  column.values[offset + 1] = geometry[1] ?? 0;
  column.values[offset + 2] = geometry[2] ?? 0;
  column.values[offset + 3] = geometry[3] ?? 0;
}

/** Copies one geometry row between layout geometry columns without allocating row views. */
function copyTraceLayoutGeometryRow(params: {
  /** Source geometry column. */
  source: TraceLayoutGeometryColumn;
  /** Target geometry column. */
  target: TraceLayoutGeometryColumn;
  /** Row index to copy in both columns. */
  rowIndex: number;
}): boolean {
  if (
    params.rowIndex < 0 ||
    params.rowIndex >= params.source.table.numRows ||
    params.rowIndex >= params.target.table.numRows
  ) {
    return false;
  }
  const offset = params.rowIndex * 4;
  params.target.values[offset] = params.source.values[offset] ?? 0;
  params.target.values[offset + 1] = params.source.values[offset + 1] ?? 0;
  params.target.values[offset + 2] = params.source.values[offset + 2] ?? 0;
  params.target.values[offset + 3] = params.source.values[offset + 3] ?? 0;
  return true;
}

function getOrCreateTraceLayoutGeometryChunk<T extends TraceLayoutGeometryColumn>(
  chunks: T[],
  chunkIndex: number,
  rowCount: number
): T {
  const normalizedRowCount = Math.max(0, rowCount);
  const existing = chunks[chunkIndex];
  if (existing && existing.table.numRows >= normalizedRowCount) {
    return existing;
  }
  const nextChunk = createTraceLayoutGeometryColumn(normalizedRowCount) as T;
  if (existing) {
    nextChunk.values.set(existing.values);
  }
  chunks[chunkIndex] = nextChunk;
  return nextChunk;
}

function mergeTraceLayoutGeometryChunks<T extends TraceLayoutGeometryColumn>(
  targetChunks: T[],
  sourceChunks: readonly T[] | undefined
): void {
  if (!sourceChunks) {
    return;
  }
  for (const [chunkIndex, sourceChunk] of sourceChunks.entries()) {
    if (!sourceChunk) {
      continue;
    }
    const targetChunk = getOrCreateTraceLayoutGeometryChunk(
      targetChunks,
      chunkIndex,
      sourceChunk.table.numRows
    );
    if (targetChunk === sourceChunk) {
      continue;
    }
    mergeTraceLayoutGeometryColumnRows(targetChunk, sourceChunk);
  }
}

function mergeTraceLayoutGeometryColumnRows(
  target: TraceLayoutGeometryColumn,
  source: TraceLayoutGeometryColumn
): void {
  const rowCount = Math.min(target.table.numRows, source.table.numRows);
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const offset = rowIndex * 4;
    const x1 = source.values[offset] ?? 0;
    const y1 = source.values[offset + 1] ?? 0;
    const x2 = source.values[offset + 2] ?? 0;
    const y2 = source.values[offset + 3] ?? 0;
    if (x1 === 0 && y1 === 0 && x2 === 0 && y2 === 0) {
      continue;
    }
    target.values[offset] = x1;
    target.values[offset + 1] = y1;
    target.values[offset + 2] = x2;
    target.values[offset + 3] = y2;
  }
}

function countTraceLayoutGeometryChunkRows(
  chunks: readonly TraceLayoutGeometryColumn[] | undefined
): number {
  let rowCount = 0;
  for (const chunk of chunks ?? []) {
    rowCount += chunk?.table.numRows ?? 0;
  }
  return rowCount;
}

function getSpanGeometryChunkRowCount(
  traceGraph: Pick<TraceGraph, 'chunks'>,
  chunkIndex: number,
  minimumRowCount: number
): number {
  return Math.max(traceGraph.chunks[chunkIndex]?.spanTable.numRows ?? 0, minimumRowCount);
}

/**
 * Preserves canonical runtime refs on display sources used by ref-native layout lookups.
 */
function addSpanRefToGeometryBlockSource(
  traceGraph: Pick<TraceGraph, 'getProcessRefBySpanRef' | 'getThreadRefBySpanRef'>,
  block: TraceSpanGeometrySource | null,
  spanRef: SpanRef
): TraceSpanGeometrySource | null {
  return block
    ? {
        ...block,
        spanRef,
        processRef: traceGraph.getProcessRefBySpanRef(spanRef) ?? undefined,
        threadRef: traceGraph.getThreadRefBySpanRef(spanRef) ?? undefined
      }
    : null;
}

/**
 * Resolves one local dependency endpoint span ref in the dependency row's process.
 */
function resolveLocalDependencyEndpointSpanRef(params: {
  /** Optional endpoint block id fallback for imported traces with stale endpoint refs. */
  blockId: unknown;
  /** Process index encoded in the owning local dependency ref. */
  dependencyProcessIndex: number;
  /** Endpoint span ref stored on the dependency row. */
  spanRef: SpanRef | null;
  /** Source graph used to resolve block-id fallback refs. */
  traceGraph: Pick<
    TraceGraph,
    'getProcessRefBySpanRef' | 'getSpanBlockId' | 'getSpanRefByExternalBlockId'
  >;
}): SpanRef | null {
  const blockId = typeof params.blockId === 'string' ? (params.blockId as TraceSpanId) : null;
  const blockIdSpanRef = blockId ? params.traceGraph.getSpanRefByExternalBlockId(blockId) : null;
  const processRef =
    params.spanRef == null ? null : params.traceGraph.getProcessRefBySpanRef(params.spanRef);
  if (
    params.spanRef != null &&
    processRef != null &&
    getProcessRefIndex(processRef) === params.dependencyProcessIndex &&
    (blockId == null || params.traceGraph.getSpanBlockId(params.spanRef) === blockId)
  ) {
    return params.spanRef;
  }
  return blockIdSpanRef;
}

/** Returns one Arrow numeric ref cell as a JavaScript safe integer. */
function normalizeArrowRefNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isSafeInteger(numberValue) ? numberValue : null;
}

/** Returns one Arrow numeric cell as a finite JavaScript number. */
function normalizeArrowNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'bigint' ? Number(value) : typeof value === 'number' ? value : null;
  return numberValue != null && Number.isFinite(numberValue) ? numberValue : null;
}

/** Returns whether a raw Arrow keyword-list cell contains the target keyword. */
function dependencyKeywordListHas(value: unknown, keyword: string): boolean {
  if (value == null || typeof (value as Iterable<unknown>)[Symbol.iterator] !== 'function') {
    return false;
  }
  for (const candidate of value as Iterable<unknown>) {
    if (candidate === keyword) {
      return true;
    }
  }
  return false;
}

/** Returns whether an unknown value is a dependency wait mode supported by layout geometry. */
function isLayoutWaitMode(
  value: unknown
): value is 'end-to-start' | 'end-to-end' | 'start-to-start' {
  return value === 'end-to-start' || value === 'end-to-end' || value === 'start-to-start';
}

/** Returns whether first-build process geometry should pay the full reusable-key cost. */
function shouldBuildInitialProcessTraceLayoutGeometryReuseKey(params: {
  /** Number of visible local dependency refs included in process geometry. */
  dependencyRefCount: number;
  /** Number of visible blocks included in process geometry. */
  visibleBlockCount: number;
}): boolean {
  return params.visibleBlockCount + params.dependencyRefCount < 50_000;
}

/** Populates aggregate layout visibility sidecars for one process from the current layout state. */
function populateProcessTraceLayoutSpanVisibility(params: {
  /** Filtered source graph whose visible span refs are represented by the layout. */
  geometryTraceGraph: TraceLayoutVisibleGraph;
  /** Optional exact visible block ids kept when building focused geometry. */
  includedBlockIdsByProcessId?: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
  /** Ref-native layout lookup used before falling back to stream-id layout lookup. */
  layoutLookup: TraceGeometryLayoutLookup;
  /** Process id whose visible spans should be indexed. */
  processId: string;
  /** Aggregate layout visibility sidecar keyed by exact visible span ref. */
  spanVisibilityMapBySpanRef: Map<SpanRef, TraceLayoutSpanVisibility>;
  /** Optional process layouts keyed by process-local stream id. */
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  /** Thread layouts keyed by process-local stream id. */
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
}): void {
  const includedBlockIds = params.includedBlockIdsByProcessId?.[params.processId];
  const visibleBlocks = getVisibleBlocksForProcess(params.geometryTraceGraph, params.processId);
  for (const block of visibleBlocks) {
    if (block.spanRef == null || !(includedBlockIds?.has(block.spanId) ?? true)) {
      continue;
    }
    params.spanVisibilityMapBySpanRef.set(
      block.spanRef,
      getTraceLayoutSpanVisibilityForBlock({
        block,
        threadLayoutMap: params.threadLayoutMap,
        streamToProcessLayoutMap: params.streamToProcessLayoutMap,
        layoutLookup: params.layoutLookup
      })
    );
  }
}

/**
 * Builds a cheap append-stable geometry key that avoids scanning spans for unchanged processes.
 */
function buildFastProcessTraceLayoutGeometryReuseKey(params: {
  blockHeight: number;
  geometryTraceGraph: TraceLayoutVisibleGraph;
  maxTimeMs: number;
  minTimeMs: number;
  process: TraceLayoutVisibleProcessMetadata;
  processId: string;
  processLayout?: ProcessLayout;
  localDependencyMode: TraceVisSettings['localDependencyMode'];
  timingKey?: string | null;
  includedBlockIdsByProcessId?: Readonly<Record<string, ReadonlySet<TraceSpanId>>>;
}): string | null {
  if (
    params.geometryTraceGraph.traceGraph.hasActiveSpanFilter() ||
    params.includedBlockIdsByProcessId?.[params.processId] ||
    !params.processLayout
  ) {
    return null;
  }

  const processId = params.process.processId as TraceProcessId;
  const processSpanTable = params.geometryTraceGraph.traceGraph.processSpanTableMap[processId];
  const spanChunkKey = getProcessSpanChunkCacheKey(
    params.geometryTraceGraph.traceGraph,
    params.process.processRef
  );
  if (!spanChunkKey) {
    return null;
  }
  const localDependencyTable =
    params.geometryTraceGraph.traceGraph.localDependencyTableMap[processId];

  return [
    'geometry-nofilter-v1',
    params.processId,
    params.process.processRef ?? '',
    `timing=${params.timingKey ?? ''}`,
    `max=${
      processSpanTableUsesMaxTimeFallback(
        params.geometryTraceGraph.traceGraph,
        processId,
        processSpanTable,
        params.timingKey
      )
        ? params.maxTimeMs
        : ''
    }`,
    `height=${params.blockHeight}`,
    `localDeps=${params.localDependencyMode}`,
    `spans=${spanChunkKey}`,
    `deps=${localDependencyTable?.numRows ?? 0}`,
    params.process.threads
      .map((thread, index) =>
        [thread.threadId, thread.name ?? '', params.process.threadRefs?.[index] ?? ''].join(':')
      )
      .join('|'),
    buildProcessLayoutTranslationInvariantGeometryKey(params.processLayout),
    params.processLayout.threadLayouts
      .map(threadLayout =>
        buildThreadLayoutTranslationInvariantGeometryKey(
          threadLayout,
          getProcessLayoutTranslationY(params.processLayout)
        )
      )
      .join('|')
  ].join('||');
}

/** Returns the graph-level X offset encoded in process-local geometry coordinates. */
function getProcessLayoutGeometryXOffset(minTimeMs: number): number {
  return Number.isFinite(minTimeMs) ? -minTimeMs : 0;
}

function getVisibleGeometryLocalDependencyRefs(params: {
  readonly geometryTraceGraph: TraceLayoutVisibleGraph;
  readonly processId: string;
  readonly includedBlockIds?: ReadonlySet<TraceSpanId>;
  readonly localDependencyMode: TraceVisSettings['localDependencyMode'];
}): readonly (TraceDependencyRef | VisibleLocalDependencyRef)[] {
  const dependencyRefs = getVisibleLocalDependencyRefsForProcess(
    params.geometryTraceGraph,
    params.processId
  );
  if (dependencyRefs.length === 0) {
    return dependencyRefs;
  }

  const filteredDependencyRefs: (TraceDependencyRef | VisibleLocalDependencyRef)[] = [];
  for (const dependencyRef of dependencyRefs) {
    const startSpanId =
      params.geometryTraceGraph.traceGraph.getVisibleDependencyStartBlockId(dependencyRef);
    const endSpanId =
      params.geometryTraceGraph.traceGraph.getVisibleDependencyEndBlockId(dependencyRef);
    if (
      params.includedBlockIds != null &&
      (startSpanId == null ||
        endSpanId == null ||
        !params.includedBlockIds.has(startSpanId) ||
        !params.includedBlockIds.has(endSpanId))
    ) {
      continue;
    }

    if (
      shouldShowLocalDependencyByModeFields(
        params.localDependencyMode,
        params.geometryTraceGraph.traceGraph.getVisibleDependencyHasKeyword(
          dependencyRef,
          'SUBMIT'
        ),
        params.geometryTraceGraph.traceGraph.getVisibleDependencyWaitTimeMs(dependencyRef) ?? 0
      )
    ) {
      filteredDependencyRefs.push(dependencyRef);
    }
  }
  return filteredDependencyRefs;
}

function createTraceLayoutReuseFingerprintBuilder(seed: string): {
  hashA: number;
  hashB: number;
  partCount: number;
} {
  const builder = {
    hashA: 0x811c9dc5,
    hashB: 0x85ebca6b,
    partCount: 0
  };
  appendTraceLayoutReuseFingerprintParts(builder, [seed]);
  return builder;
}

function appendTraceLayoutReuseFingerprintParts(
  builder: ReturnType<typeof createTraceLayoutReuseFingerprintBuilder>,
  parts: readonly (number | string)[]
): void {
  for (const part of parts) {
    const text = String(part);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      builder.hashA = Math.imul(builder.hashA ^ code, 0x01000193) >>> 0;
      builder.hashB = Math.imul(builder.hashB + code, 0xc2b2ae35) >>> 0;
      builder.hashB = (builder.hashB ^ (builder.hashB >>> 16)) >>> 0;
    }
    builder.hashA = Math.imul(builder.hashA ^ 0xff, 0x01000193) >>> 0;
    builder.hashB = Math.imul(builder.hashB + 0xff, 0xc2b2ae35) >>> 0;
    builder.partCount += 1;
  }
}

function appendTraceLayoutReuseFingerprintValues(
  builder: ReturnType<typeof createTraceLayoutReuseFingerprintBuilder>,
  values: readonly unknown[]
): void {
  appendTraceLayoutReuseFingerprintParts(builder, [values.length]);
  for (const value of values) {
    appendTraceLayoutReuseFingerprintParts(builder, [String(value)]);
  }
}

function formatTraceLayoutReuseFingerprint(
  builder: ReturnType<typeof createTraceLayoutReuseFingerprintBuilder>
): string {
  return `${builder.partCount}:${builder.hashA.toString(36)}:${builder.hashB.toString(36)}`;
}

function buildProcessTraceLayoutGeometryReuseKey(params: {
  blockHeight: number;
  dependencyRefCount: number;
  geometryTraceGraph: TraceLayoutVisibleGraph;
  includedBlockIds?: ReadonlySet<TraceSpanId>;
  localDependencyMode: TraceVisSettings['localDependencyMode'];
  maxTimeMs: number;
  minTimeMs: number;
  process: TraceLayoutVisibleProcessMetadata;
  processId: string;
  processLayout?: ProcessLayout;
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
  timingKey?: string | null;
  visibleBlockCount: number;
}): string {
  const fingerprint = createTraceLayoutReuseFingerprintBuilder('process-geometry-v2');
  appendTraceLayoutReuseFingerprintParts(fingerprint, [
    params.processId,
    buildProcessGeometryDataGenerationKey({
      geometryTraceGraph: params.geometryTraceGraph,
      process: params.process
    }),
    params.timingKey ?? '',
    params.minTimeMs,
    params.maxTimeMs,
    params.blockHeight,
    params.localDependencyMode,
    params.visibleBlockCount,
    params.dependencyRefCount,
    buildProcessLayoutTranslationInvariantGeometryKey(params.processLayout)
  ]);
  if (params.includedBlockIds) {
    appendTraceLayoutReuseFingerprintValues(fingerprint, [...params.includedBlockIds]);
  } else {
    appendTraceLayoutReuseFingerprintParts(fingerprint, [0]);
  }
  const processLayoutY = getProcessLayoutTranslationY(params.processLayout);
  const threadLayouts = params.processLayout?.threadLayouts ?? [];
  appendTraceLayoutReuseFingerprintParts(fingerprint, [threadLayouts.length]);
  for (const threadLayout of threadLayouts) {
    appendTraceLayoutReuseFingerprintParts(fingerprint, [
      buildThreadLayoutTranslationInvariantGeometryKey(threadLayout, processLayoutY)
    ]);
  }
  return `pg:${formatTraceLayoutReuseFingerprint(fingerprint)}`;
}

/** Returns whether span geometry for one process can depend on the current graph max time. */
function processSpanTableUsesMaxTimeFallback(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId,
  spanTable: TraceProcessSpanRefTable | undefined,
  timingKey: string | null | undefined
): boolean {
  if (!spanTable || timingKey) {
    return true;
  }

  const cached = spanTableUsesMaxTimeFallbackCache.get(spanTable);
  if (cached != null) {
    return cached;
  }

  const usesMaxTimeFallback = scanProcessSpansUseMaxTimeFallback(traceGraph, processId);
  spanTableUsesMaxTimeFallbackCache.set(spanTable, usesMaxTimeFallback);
  return usesMaxTimeFallback;
}

/** Scans one process's store-backed span rows for open-ended primary timings. */
function scanProcessSpansUseMaxTimeFallback(
  traceGraph: Readonly<TraceGraphData>,
  processId: TraceProcessId
): boolean {
  for (const spanRef of iterateTraceGraphProcessSpanRefs(traceGraph, processId)) {
    if (getArrowTraceSpanField(traceGraph, spanRef, 'status') !== 'finished') {
      return true;
    }
  }
  return false;
}

/** Builds a compact geometry data-generation token for one process without scanning its rows. */
function buildProcessGeometryDataGenerationKey(params: {
  geometryTraceGraph: TraceLayoutVisibleGraph;
  process: TraceLayoutVisibleProcessMetadata;
}): string {
  if (params.geometryTraceGraph.traceGraph.hasActiveSpanFilter()) {
    return `graph:${getObjectIdentityId(params.geometryTraceGraph.traceGraph)}`;
  }
  return (
    getProcessSpanChunkCacheKey(params.geometryTraceGraph.traceGraph, params.process.processRef) ??
    `graph:${getObjectIdentityId(params.geometryTraceGraph.traceGraph)}`
  );
}

/** Resolves a visible cross-dependency ref back to its encoded source dependency row. */
function resolveSourceCrossDependencyRef(
  traceGraph: Readonly<TraceGraph>,
  dependencyRef: TraceDependencyRef | VisibleCrossDependencyRef | null | undefined
): CrossDependencyRef | null {
  if (dependencyRef == null) {
    return null;
  }
  const sourceRef = traceGraph.getDependencySourceRefByRef(dependencyRef);
  return sourceRef != null && getTraceRefKind(sourceRef) === 'crossDependency'
    ? (sourceRef as CrossDependencyRef)
    : null;
}

function buildTraceCrossRankDependencyGeometriesForLayout(params: {
  crossDependencies: Readonly<TraceLayoutVisibleGraph['crossDependencies']>;
  previousGeometryCache?: TraceLayoutGeometryCache;
  maxTimeMs: number;
  minTimeMs: number;
  layoutLookup: TraceGeometryLayoutLookup;
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  crossDependencyGeometryChunks: TraceLayoutDependencyGeometryChunk[];
  traceGraph: Readonly<TraceGraph>;
}): {
  reuseKeyByVisibleRef: ReadonlyMap<TraceDependencyRef | VisibleCrossDependencyRef, string>;
  reusedCrossGeometryCount: number;
  builtCrossGeometryCount: number;
  skippedStartBlockCount: number;
  skippedEndBlockCount: number;
} {
  const reuseKeyByVisibleRef = new Map<TraceDependencyRef | VisibleCrossDependencyRef, string>();
  let reusedCrossGeometryCount = 0;
  let builtCrossGeometryCount = 0;
  let skippedStartBlockCount = 0;
  let skippedEndBlockCount = 0;

  for (const dependency of params.crossDependencies) {
    const dependencyRef = dependency.dependencyRef;
    const startSpan =
      dependency.startSpanRef == null
        ? null
        : params.traceGraph.getSpanDisplaySource(dependency.startSpanRef);
    const endSpan =
      dependency.endSpanRef == null
        ? null
        : params.traceGraph.getSpanDisplaySource(dependency.endSpanRef);
    const reuseKey = buildCrossTraceLayoutGeometryReuseKey({
      dependency,
      startSpan,
      endSpan,
      maxTimeMs: params.maxTimeMs,
      minTimeMs: params.minTimeMs,
      layoutLookup: params.layoutLookup,
      streamToProcessLayoutMap: params.streamToProcessLayoutMap,
      threadLayoutMap: params.threadLayoutMap
    });
    const dependencyRefKind = dependencyRef == null ? null : getTraceRefKind(dependencyRef);
    const sourceCrossDependencyRef =
      dependencyRefKind === 'crossDependency'
        ? (dependencyRef as CrossDependencyRef)
        : resolveSourceCrossDependencyRef(params.traceGraph, dependencyRef);
    const geometryLocation = resolveCrossDependencyGeometryLocation({
      dependencyRef,
      sourceCrossDependencyRef,
      traceGraph: params.traceGraph
    });
    const previousGeometryColumn =
      geometryLocation == null
        ? undefined
        : params.previousGeometryCache?.crossDependencyGeometryChunks[geometryLocation.chunkIndex];
    const previousReuseKey =
      dependencyRef == null
        ? undefined
        : params.previousGeometryCache?.crossDependencyReuseKeyByVisibleRef.get(dependencyRef);
    if (
      dependencyRef != null &&
      geometryLocation != null &&
      previousGeometryColumn &&
      previousReuseKey === reuseKey &&
      copyTraceLayoutGeometryRow({
        source: previousGeometryColumn,
        target: getOrCreateTraceLayoutGeometryChunk(
          params.crossDependencyGeometryChunks,
          geometryLocation.chunkIndex,
          geometryLocation.rowIndex + 1
        ),
        rowIndex: geometryLocation.rowIndex
      })
    ) {
      reuseKeyByVisibleRef.set(dependencyRef, reuseKey);
      reusedCrossGeometryCount += 1;
      continue;
    }

    if (!startSpan) {
      skippedStartBlockCount += 1;
      continue;
    }
    if (!endSpan) {
      skippedEndBlockCount += 1;
      continue;
    }
    const result = buildTraceCrossRankDependencyGeometry({
      crossDependency: dependency,
      spanMap: {
        [dependency.startSpanId]: startSpan,
        [dependency.endSpanId]: endSpan
      },
      maxTimeMs: params.maxTimeMs,
      minTimeMs: params.minTimeMs,
      layoutLookup: params.layoutLookup,
      threadLayoutMap: params.threadLayoutMap,
      streamToProcessLayoutMap: params.streamToProcessLayoutMap
    });
    if (result.skippedEndpoint === 'start') {
      skippedStartBlockCount += 1;
      continue;
    }
    if (result.skippedEndpoint === 'end') {
      skippedEndBlockCount += 1;
      continue;
    }
    if (!result.geometry) {
      continue;
    }
    builtCrossGeometryCount += 1;
    if (dependencyRef != null && geometryLocation != null) {
      writeTraceLayoutGeometryRow(
        getOrCreateTraceLayoutGeometryChunk(
          params.crossDependencyGeometryChunks,
          geometryLocation.chunkIndex,
          geometryLocation.rowIndex + 1
        ),
        geometryLocation.rowIndex,
        result.geometry
      );
      reuseKeyByVisibleRef.set(dependencyRef, reuseKey);
    }
  }
  return {
    reuseKeyByVisibleRef,
    reusedCrossGeometryCount,
    builtCrossGeometryCount,
    skippedStartBlockCount,
    skippedEndBlockCount
  };
}

/** Resolves the cross-dependency geometry chunk row for source or override-only visible refs. */
function resolveCrossDependencyGeometryLocation(params: {
  /** Visible or source dependency ref carried by the rendered dependency. */
  dependencyRef: TraceDependencyRef | VisibleCrossDependencyRef | null | undefined;
  /** Source dependency ref when the rendered dependency maps to an Arrow source row. */
  sourceCrossDependencyRef: CrossDependencyRef | null;
  /** Trace graph that owns the source cross-dependency table. */
  traceGraph: Readonly<TraceGraph>;
}): TraceLayoutCrossDependencyGeometryLocation | null {
  if (params.sourceCrossDependencyRef != null) {
    return {
      chunkIndex: getCrossDependencyRefChunkIndex(params.sourceCrossDependencyRef),
      rowIndex: getCrossDependencyRefRowIndex(params.sourceCrossDependencyRef)
    };
  }
  if (
    params.dependencyRef == null ||
    getTraceRefKind(params.dependencyRef) !== 'visibleCrossDependency'
  ) {
    return null;
  }
  const syntheticRef = encodeCrossDependencyRef(
    getVisibleCrossDependencyRefIndex(params.dependencyRef as VisibleCrossDependencyRef)
  );
  return {
    chunkIndex:
      getSyntheticCrossDependencyChunkOffset(params.traceGraph) +
      getCrossDependencyRefChunkIndex(syntheticRef),
    rowIndex: getCrossDependencyRefRowIndex(syntheticRef)
  };
}

/** Returns the first chunk index reserved for override-only visible cross-dependency geometry. */
function getSyntheticCrossDependencyChunkOffset(traceGraph: Readonly<TraceGraph>): number {
  const sourceRowCount = traceGraph.crossDependencyTable.numRows;
  return sourceRowCount <= 0
    ? 0
    : getCrossDependencyRefChunkIndex(encodeCrossDependencyRef(sourceRowCount - 1)) + 1;
}

/**
 * Builds a stable fingerprint for one cross-process dependency geometry path.
 */
function buildCrossTraceLayoutGeometryReuseKey(params: {
  dependency: TraceLayoutVisibleGraph['crossDependencies'][number];
  startSpan: TraceSpanGeometrySource | null;
  endSpan: TraceSpanGeometrySource | null;
  maxTimeMs: number;
  minTimeMs: number;
  layoutLookup: TraceGeometryLayoutLookup;
  streamToProcessLayoutMap?: Readonly<Record<TraceThreadId, ProcessLayout>>;
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>;
}): string {
  return [
    params.dependency.dependencyId,
    params.dependency.startSpanId,
    params.dependency.endSpanId,
    params.dependency.waitMode,
    params.dependency.bidirectional ? 1 : 0,
    `min=${params.minTimeMs}`,
    `start=${buildGeometryBlockReuseKey(params.startSpan, params.layoutLookup, params.threadLayoutMap, params.streamToProcessLayoutMap, params.maxTimeMs)}`,
    `end=${buildGeometryBlockReuseKey(params.endSpan, params.layoutLookup, params.threadLayoutMap, params.streamToProcessLayoutMap, params.maxTimeMs)}`
  ].join('||');
}

/**
 * Builds the endpoint portion of a cross-dependency geometry reuse key.
 */
function buildGeometryBlockReuseKey(
  block: TraceSpanGeometrySource | null,
  layoutLookup: TraceGeometryLayoutLookup,
  threadLayoutMap: Record<TraceThreadId, ThreadLayout>,
  streamToProcessLayoutMap: Readonly<Record<TraceThreadId, ProcessLayout>> | undefined,
  maxTimeMs: number
): string {
  if (!block) {
    return 'missing';
  }
  const timing = block.timings[block.primaryTimingKey];
  const threadLayout = getThreadLayoutForGeometryBlock({
    block,
    fallbackThreadLayoutMap: threadLayoutMap,
    layoutLookup
  });
  const rankLayout = getProcessLayoutForGeometryBlock({
    block,
    fallbackStreamToProcessLayoutMap: streamToProcessLayoutMap,
    layoutLookup
  });
  return [
    block.spanId,
    block.threadId,
    block.primaryTimingKey,
    timing?.startTimeMs ?? '',
    timing?.endTimeMs ?? maxTimeMs,
    buildThreadLayoutGeometryStableKey(threadLayout),
    buildProcessLayoutGeometryKey(rankLayout)
  ].join(':');
}

/** Builds a compact fingerprint for process geometry that can anchor hidden spans. */
function buildProcessLayoutGeometryKey(rankLayout: ProcessLayout | undefined): string {
  if (!rankLayout) {
    return 'missing';
  }
  return [
    rankLayout.isCollapsed ? 1 : 0,
    formatTraceLayoutGeometryKeyNumber(rankLayout.yOffset),
    formatTraceLayoutGeometryKeyNumber(rankLayout.yHeight),
    formatTraceLayoutGeometryKeyNumber(rankLayout.collapsedActivityY)
  ].join(';');
}

/** Returns a process-layout key that ignores absolute graph-level Y translation. */
function buildProcessLayoutTranslationInvariantGeometryKey(
  rankLayout: ProcessLayout | undefined
): string {
  if (!rankLayout) {
    return 'missing';
  }
  const yOffset = getProcessLayoutTranslationY(rankLayout);
  return [
    rankLayout.isCollapsed ? 1 : 0,
    formatTraceLayoutGeometryKeyNumber(rankLayout.yHeight),
    Number.isFinite(rankLayout.collapsedActivityY)
      ? formatTraceLayoutGeometryKeyNumber((rankLayout.collapsedActivityY ?? 0) - yOffset)
      : ''
  ].join(';');
}

/** Returns the absolute graph-level Y translation applied to one process layout. */
function getProcessLayoutTranslationY(rankLayout: ProcessLayout | undefined): number {
  return rankLayout && Number.isFinite(rankLayout.yOffset) ? rankLayout.yOffset : 0;
}

/** Returns a thread-layout key that ignores absolute graph-level Y translation. */
function buildThreadLayoutTranslationInvariantGeometryKey(
  threadLayout: ThreadLayout | undefined,
  yOffset: number
): string {
  if (!threadLayout) {
    return 'missing';
  }
  const fingerprint = createTraceLayoutReuseFingerprintBuilder('thread-layout-translate-v1');
  appendTraceLayoutReuseFingerprintParts(fingerprint, [
    threadLayout.visible ? 1 : 0,
    formatTraceLayoutGeometryKeyNumber(threadLayout.yPosition - yOffset)
  ]);
  appendTraceLayoutReuseFingerprintValues(
    fingerprint,
    formatTraceLayoutGeometryKeyValues(translatePointY(threadLayout.startPosition, yOffset))
  );
  appendTraceLayoutReuseFingerprintValues(
    fingerprint,
    formatTraceLayoutGeometryKeyValues(translatePointY(threadLayout.targetPosition, yOffset))
  );
  appendTraceLayoutReuseFingerprintValues(
    fingerprint,
    formatLaneYPositionGeometryKeyValues(threadLayout.lanes?.laneYPositions ?? [], yOffset)
  );
  appendTraceLayoutReuseFingerprintParts(fingerprint, [threadLayout.lanes?.isCollapsed ? 1 : 0]);
  return formatTraceLayoutReuseFingerprint(fingerprint);
}

/** Returns a point with its Y coordinate made relative to a process layout offset. */
function translatePointY(point: readonly number[], yOffset: number): readonly number[] {
  return point.map((value, index) => (index === 1 ? value - yOffset : value));
}

/** Formats numeric geometry key parts with bounded precision before fingerprinting them. */
function formatTraceLayoutGeometryKeyValues(values: readonly number[]): readonly string[] {
  return values.map(formatTraceLayoutGeometryKeyNumber);
}

function formatLaneYPositionGeometryKeyValues(
  laneYPositions: readonly number[],
  yOffset = 0
): readonly string[] {
  const laneCount = laneYPositions.length;
  if (laneCount === 0) {
    return ['0'];
  }

  const firstLaneY = laneYPositions[0]! - yOffset;
  if (laneCount === 1) {
    return ['1', formatTraceLayoutGeometryKeyNumber(firstLaneY)];
  }

  const secondLaneY = laneYPositions[1]! - yOffset;
  const lastLaneY = laneYPositions[laneCount - 1]! - yOffset;
  return [
    String(laneCount),
    formatTraceLayoutGeometryKeyNumber(firstLaneY),
    formatTraceLayoutGeometryKeyNumber(secondLaneY - firstLaneY),
    formatTraceLayoutGeometryKeyNumber(lastLaneY)
  ];
}

/** Formats one geometry key number so equivalent floating-point results hash identically. */
function formatTraceLayoutGeometryKeyNumber(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return normalized.toFixed(6);
}

/**
 * Builds a thread-layout geometry fingerprint that ignores timeline width changes unrelated to
 * finished block and dependency paths.
 */
function buildThreadLayoutGeometryStableKey(threadLayout: ThreadLayout | undefined): string {
  if (!threadLayout) {
    return 'missing';
  }
  const fingerprint = createTraceLayoutReuseFingerprintBuilder('thread-layout-stable-v2');
  appendTraceLayoutReuseFingerprintParts(fingerprint, [
    threadLayout.visible ? 1 : 0,
    formatTraceLayoutGeometryKeyNumber(threadLayout.yPosition)
  ]);
  appendTraceLayoutReuseFingerprintValues(
    fingerprint,
    formatTraceLayoutGeometryKeyValues(threadLayout.startPosition)
  );
  appendTraceLayoutReuseFingerprintParts(fingerprint, [
    formatTraceLayoutGeometryKeyNumber(threadLayout.targetPosition[1]),
    formatTraceLayoutGeometryKeyNumber(threadLayout.targetPosition[2])
  ]);
  appendTraceLayoutReuseFingerprintValues(
    fingerprint,
    formatLaneYPositionGeometryKeyValues(threadLayout.lanes?.laneYPositions ?? [])
  );
  appendTraceLayoutReuseFingerprintParts(fingerprint, [threadLayout.lanes?.isCollapsed ? 1 : 0]);
  return formatTraceLayoutReuseFingerprint(fingerprint);
}
