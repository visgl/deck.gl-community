import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSameProcessDependencyTable,
  buildArrowTraceSpanSidecarTableFromColumns,
  buildArrowTraceSpanTableFromColumns,
  buildJSONTrace,
  buildTraceChunkRowWindowTable,
  buildTraceChunkSourceDependencyTable,
  buildTraceChunkWindowDataset,
  buildTraceLayouts,
  createChronologicalTraceChunkSpanBudgetPolicy,
  DEFAULT_TRACE_COLOR_SCHEME,
  hasTraceLayoutSpanLaneIndex,
  TraceChunkStore,
  TraceChunkStoreLoadSkippedError,
  TraceGraph
} from '../../../trace';
import {
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createRuntimeTraceGraph,
  createTraceDatasetFromJSONTraceForTest
} from '../../../trace/trace-graph/trace-graph-test-fixtures';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../../../trace/trace-graph/trace-id-encoder';
import {
  buildTracePreparedGraphScenes,
  buildTracePreparedMinimapSpanIndicators,
  buildTracePreparedOverviewGraphScenes,
  buildTracePreparedOverviewViewModel,
  buildTracePreparedProcessRows,
  buildTraceSelectionOverviewScenes,
  createTraceComparisonModelMatrix
} from '../../../trace/trace-view-state/trace-prepared-scene';
import {buildTracePreparedPathData} from '../../../trace/trace-view-state/trace-prepared-scene-paths';

import type {
  CollapsedActivityByProcessRef,
  SpanRef,
  TraceChunk,
  TraceChunkData,
  TraceChunkDescriptor,
  TraceChunkSpanOverlapRange,
  TraceColorScheme,
  TraceDependencyId,
  TraceLayout,
  TraceProcess,
  TraceProcessId,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../trace';

/** Concrete chunk descriptor used by trace deck layout input tests. */
type TestTraceChunkDescriptor = TraceChunkDescriptor & {
  /** Test marker used to make descriptor types concrete. */
  readonly testKind: 'chunk';
};

/** Arrow-backed span row used by trace deck layout input tests. */
type TestTraceChunkRow = {
  /** Stable external span id stored in the Arrow span table. */
  readonly externalSpanId: string;
  /** Span start time stored in the Arrow span table. */
  readonly startTimeMs: number;
  /** Span end time stored in the Arrow span table. */
  readonly endTimeMs: number;
  /** Window-overlap ranges stored in chunk metadata. */
  readonly overlapRanges: readonly TraceChunkSpanOverlapRange[];
};

/** Test-local bundle kept only so legacy test assertions can compare the three explicit owners. */
function buildTestTracePreparedRenderData(
  params: Parameters<typeof buildTracePreparedGraphScenes>[0] &
    Parameters<typeof buildTracePreparedOverviewGraphScenes>[0] &
    Parameters<typeof buildTracePreparedPathData>[0]
) {
  return {
    foreground: buildTracePreparedGraphScenes(params),
    overview: buildTracePreparedOverviewGraphScenes(params),
    paths: buildTracePreparedPathData(params)
  };
}

/** Builds a canonical chunk/dataset-backed graph for ordinary JSON fixtures. */
function createTestTraceGraph(
  traceGraph: Parameters<typeof createRuntimeTraceGraph>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createRuntimeTraceGraph(traceGraph, options);
}

/** Wraps dataset fixtures that intentionally mutate post-materialization tables. */
function createRawTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

/** Materializes one prepared span source only at assertion boundaries. */
function getPreparedSpanRefs(source: Iterable<SpanRef> | undefined): SpanRef[] | undefined {
  return source ? Array.from(source) : undefined;
}

/** Builds one concrete chunk descriptor for chunk-backed prepared-row tests. */
function createTestTraceChunkDescriptor(
  chunkKey: string,
  sortStartTimeMs: number
): TestTraceChunkDescriptor {
  return {
    chunkKey,
    familyKey: 'trace-deck-layout-inputs-test-family',
    startTimeMs: 0,
    endTimeMs: 30,
    sortStartTimeMs,
    sortEndTimeMs: 30,
    advertisedSpanCount: 1,
    testKind: 'chunk'
  };
}

/** Builds one span row that overlaps the active chunk-backed prepared-row test window. */
function createTestTraceChunkRow(
  externalSpanId: string,
  options: Partial<Omit<TestTraceChunkRow, 'externalSpanId'>> = {}
): TestTraceChunkRow {
  return {
    externalSpanId,
    startTimeMs: options.startTimeMs ?? 10,
    endTimeMs: options.endTimeMs ?? 11,
    overlapRanges: options.overlapRanges ?? [{startTimeMs: 10, endTimeMs: 20}]
  };
}

/** Builds parser-local chunk data for one same-process prepared-row test chunk. */
function createTestTraceChunkData(
  rows: readonly TestTraceChunkRow[],
  chunkKey: string,
  options: {
    /** Source thread id owned by this parser-local chunk. */
    readonly threadId?: TraceThreadId;
    /** Source thread name owned by this parser-local chunk. */
    readonly threadName?: string;
  } = {}
): TraceChunkData {
  const processId = 'rank-a' as TraceProcessId;
  const threadId = options.threadId ?? ('rank-a-thread' as TraceThreadId);
  const thread = {
    type: 'trace-thread',
    threadId,
    processId,
    name: options.threadName ?? String(threadId)
  } as const;
  return {
    type: 'trace-chunk-data',
    chunkKey,
    processes: [
      {
        type: 'trace-process',
        processId,
        name: 'rank-a',
        rankNum: 0,
        stepNum: 0,
        threads: [thread],
        threadMap: {[thread.threadId]: thread},
        instants: [],
        instantMap: {},
        threadInstantMap: {},
        counters: [],
        counterMap: {},
        threadCounterMap: {},
        sameProcessDependencies: [],
        remoteDependencies: []
      }
    ],
    spanTable: buildArrowTraceSpanTableFromColumns({
      process_ref: rows.map(() => encodeProcessRef(0)),
      thread_ref: rows.map(() => encodeProcessThreadRef(0, 0)),
      span_id: rows.map(row => row.externalSpanId as TraceSpanId),
      external_span_id: rows.map(row => row.externalSpanId),
      thread_id: rows.map(() => threadId),
      name: rows.map(row => row.externalSpanId),
      source: rows.map(() => null),
      primary_timing_key: rows.map(() => 'measured'),
      status: rows.map(() => 'finished'),
      start_time_ms: rows.map(row => row.startTimeMs),
      end_time_ms: rows.map(row => row.endTimeMs),
      duration_ms: rows.map(row => row.endTimeMs - row.startTimeMs)
    }),
    resolvedSameProcessDependencyTable: buildArrowTraceSameProcessDependencyTable([]),
    spanSidecarTable: buildArrowTraceSpanSidecarTableFromColumns({
      rowCount: rows.length,
      keywords: rows.map(() => []),
      userDataJson: rows.map(() => '{}')
    }),
    sourceDependencyTable: buildTraceChunkSourceDependencyTable([]),
    rowWindowTable: buildTraceChunkRowWindowTable(rows.map(row => row.overlapRanges)),
    diagnostics: {
      rowCount: rows.length,
      notStartedSpanCount: 0,
      unfinishedSpanCount: 0,
      invalidRecordCount: 0,
      minTimeMs: rows[0]?.startTimeMs ?? null,
      maxTimeMs: rows.at(-1)?.endTimeMs ?? null,
      warningCounters: {}
    },
    refState: 'parser-local'
  };
}

/** Materializes the active chunk-backed prepared-row test window into one TraceGraph. */
function materializeTestTraceChunkGraph(
  store: TraceChunkStore<TraceChunk, TestTraceChunkDescriptor>
): TraceGraph {
  const selection = store.select({
    window: {startTimeMs: 10, endTimeMs: 20},
    spanBudget: null
  });
  const traceDataset = store.withReadyChunks(selection, ({ownerRefRegistry, readyChunks}) =>
    buildTraceChunkWindowDataset({
      name: 'trace-deck-layout-inputs-chunk-test',
      ownerRefRegistry,
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      readyChunks
    })
  );
  if (!traceDataset) {
    throw new Error('Expected active chunk-backed test graph');
  }
  return new TraceGraph({traceDataset, traceStore: store});
}

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: true,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.1,
  minSpanTimeMs: 0,
  threadDisplayMode: 'all',
  selectedThreadNames: [],
  sortThreads: false,
  lineRoutingMode: 'straight',
  layoutDensity: 'comfortable',
  processLayoutMode: 'interleaved',
  trackAggregationMode: 'separate-threads',
  traceOffsetMs: 0,
  traceScale: 1,
  traceColorSchemeId: 'processes',
  traceTimingKey: 'latest'
};

describe('trace deck layout inputs', () => {
  it('builds comparison transforms in millisecond layout units', () => {
    const matrix = createTraceComparisonModelMatrix(2, 3);

    expect(matrix.transformAsPoint([10, 0, 0])).toEqual([32, 0, 0]);
  });

  it('normalizes invalid comparison transforms to the identity matrix', () => {
    const matrix = createTraceComparisonModelMatrix(Number.NaN, 0);

    expect(matrix.transformAsPoint([10, 0, 0])).toEqual([10, 0, 0]);
  });

  it('projects TraceLayout rows into layer-ready spans and dependencies', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const prepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, sameProcessDependencyMode: 'submit'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground).toHaveLength(1);
    expect(prepared.foreground[0]?.layout.traceGraph).toBe(traceLayouts[0]?.traceGraph);
    expect(prepared.foreground[0]?.rows).toHaveLength(1);
    expect(prepared.foreground[0]?.rows[0]?.binaryBlockData?.spans).toHaveLength(2);
    expect(prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.dependencies).toHaveLength(1);
    expect(prepared.foreground[0]?.rows[0]?.binaryBlockData).toMatchObject({
      data: {
        length: 2,
        attributes: {
          getPosition: {size: 3},
          getSize: {size: 2},
          getFillColor: {size: 4},
          getLineColor: {size: 4}
        }
      }
    });
    expect(
      prepared.foreground[0]?.rows[0]?.binaryBlockData?.data.attributes.getPosition?.value
    ).toBeInstanceOf(Float32Array);
    expect(
      prepared.foreground[0]?.rows[0]?.binaryBlockData?.data.attributes.getFillColor?.value
    ).toBeInstanceOf(Uint8Array);
    expect(prepared.foreground[0]?.rows[0]?.binaryDependencyLineData).toMatchObject({
      data: {
        length: 1,
        attributes: {
          getSourcePosition: {size: 3},
          getTargetPosition: {size: 3},
          getColor: {size: 4}
        }
      }
    });
    expect(
      prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.data.attributes.getSourcePosition
        ?.value
    ).toBeInstanceOf(Float32Array);
    expect(
      prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.data.attributes.getColor?.value
    ).toBeInstanceOf(Uint8Array);
  });

  it('applies same-process dependency mode before rows reach deck layer construction', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const prepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, sameProcessDependencyMode: 'warnings'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.dependencies).toHaveLength(0);
  });

  it('rebuilds binary row payloads without retaining a global row cache', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const params = {
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    };

    const firstPrepared = buildTestTracePreparedRenderData(params);
    const secondPrepared = buildTestTracePreparedRenderData(params);

    expect(secondPrepared.foreground[0]?.rows[0]?.binaryBlockData).toBeDefined();
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData).toBeDefined();
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryBlockData).not.toBe(
      firstPrepared.foreground[0]?.rows[0]?.binaryBlockData
    );
    expect(secondPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData).not.toBe(
      firstPrepared.foreground[0]?.rows[0]?.binaryDependencyLineData
    );
  });

  it('projects current row sources while rebuilding binary payloads after a rank append', () => {
    const firstProcess = createProcessWithSameProcessDependency('rank-a', 0);
    const appendedProcess = createProcessWithSameProcessDependency('rank-b', 1);
    const firstTraceGraph = createTraceGraphFromProcesses([firstProcess]);
    const firstTraceLayouts = buildTestLayouts(firstTraceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const firstPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: firstTraceGraph,
      sourceTraceGraphs: [firstTraceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const appendedTraceGraph = createAppendedTraceGraphReusingFirstProcessTables(firstTraceGraph, [
      firstProcess,
      appendedProcess
    ]);
    const appendedTraceLayouts = buildTestLayouts(appendedTraceGraph, 'primary');
    const appendedPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: appendedTraceGraph,
      sourceTraceGraphs: [appendedTraceGraph],
      traceLayouts: appendedTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const appendedRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-a'
    );
    const newRow = appendedPrepared.foreground[0]?.rows.find(row => row.row.processId === 'rank-b');

    expect(getPreparedSpanRefs(appendedRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
    );
    expect(appendedRow?.binaryDependencyLineData?.dependencies).toEqual(
      firstRow?.binaryDependencyLineData?.dependencies
    );
    expect(appendedRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(appendedRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
    expect(newRow?.binaryBlockData).toBeDefined();
    expect(newRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
  });

  it('reprojects process-row payloads when an appended lower rank sorts before existing rows', () => {
    const rankFourProcess = createProcessWithSameProcessDependency('rank-4', 4);
    const rankFiveProcess = createProcessWithSameProcessDependency('rank-5', 5);
    const rankThreeProcess = createProcessWithSameProcessDependency('rank-3', 3);
    const firstTraceGraph = createTraceGraphFromProcesses([rankFourProcess, rankFiveProcess]);
    const firstTraceLayouts = buildTestLayouts(firstTraceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const firstPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: firstTraceGraph,
      sourceTraceGraphs: [firstTraceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const appendedTraceGraph = createAppendedTraceGraphReusingPreviousProcessTables(
      firstTraceGraph,
      [rankFourProcess, rankFiveProcess, rankThreeProcess]
    );
    const appendedTraceLayouts = buildTestLayouts(appendedTraceGraph, 'primary');
    const appendedPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: appendedTraceGraph,
      sourceTraceGraphs: [appendedTraceGraph],
      traceLayouts: appendedTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRankFourRow = firstPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-4'
    );
    const firstRankFiveRow = firstPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-5'
    );
    const appendedRankFourRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-4'
    );
    const appendedRankFiveRow = appendedPrepared.foreground[0]?.rows.find(
      row => row.row.processId === 'rank-5'
    );
    const firstRankFourPositions = getRequiredFloat32Attribute(
      firstRankFourRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const appendedRankFourPositions = getRequiredFloat32Attribute(
      appendedRankFourRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const firstRankFivePositions = getRequiredFloat32Attribute(
      firstRankFiveRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const appendedRankFivePositions = getRequiredFloat32Attribute(
      appendedRankFiveRow?.binaryBlockData?.data.attributes.getPosition?.value
    );

    expect(appendedPrepared.foreground[0]?.rows.map(row => row.row.processId)).toEqual([
      'rank-3',
      'rank-4',
      'rank-5'
    ]);
    expect(getPreparedSpanRefs(appendedRankFourRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRankFourRow?.binaryBlockData?.spans)
    );
    expect(appendedRankFourRow?.binaryDependencyLineData?.dependencies).toEqual(
      firstRankFourRow?.binaryDependencyLineData?.dependencies
    );
    expect(appendedRankFourRow?.binaryBlockData).not.toBe(firstRankFourRow?.binaryBlockData);
    expect(appendedRankFourRow?.binaryDependencyLineData).not.toBe(
      firstRankFourRow?.binaryDependencyLineData
    );
    expect(appendedRankFourRow).not.toHaveProperty('spans');
    expect(getPreparedSpanRefs(appendedRankFiveRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRankFiveRow?.binaryBlockData?.spans)
    );
    expect(appendedRankFiveRow?.binaryDependencyLineData?.dependencies).toEqual(
      firstRankFiveRow?.binaryDependencyLineData?.dependencies
    );
    expect(appendedRankFiveRow?.binaryBlockData).not.toBe(firstRankFiveRow?.binaryBlockData);
    expect(appendedRankFiveRow?.binaryDependencyLineData).not.toBe(
      firstRankFiveRow?.binaryDependencyLineData
    );
    expect(appendedRankFiveRow).not.toHaveProperty('spans');
    expect(appendedRankFourPositions[1]).toBeGreaterThan(firstRankFourPositions[1] ?? 0);
    expect(appendedRankFivePositions[1]).toBeGreaterThan(firstRankFivePositions[1] ?? 0);

    for (const row of [appendedRankFourRow, appendedRankFiveRow]) {
      const positions = getRequiredFloat32Attribute(
        row?.binaryBlockData?.data.attributes.getPosition?.value
      );
      const sizes = getRequiredFloat32Attribute(
        row?.binaryBlockData?.data.attributes.getSize?.value
      );
      expect(Array.from(positions).every(Number.isFinite)).toBe(true);
      expect(Array.from(sizes).every(Number.isFinite)).toBe(true);
      expect(sizes[0]).toBeGreaterThan(0);
      expect(sizes[1]).toBeGreaterThan(0);
    }
  });

  it('rebuilds binary row payloads when row positions change', () => {
    const traceGraph = createDependencyTraceGraph();
    const firstTraceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const firstPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts: firstTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const shiftedTraceLayouts = buildTestLayouts(traceGraph, 'primary', 10);
    const shiftedPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts: shiftedTraceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const shiftedRow = shiftedPrepared.foreground[0]?.rows[0];
    const firstBlockPositions = getRequiredFloat32Attribute(
      firstRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const shiftedBlockPositions = getRequiredFloat32Attribute(
      shiftedRow?.binaryBlockData?.data.attributes.getPosition?.value
    );
    const firstDependencySources = getRequiredFloat32Attribute(
      firstRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
    );
    const shiftedDependencySources = getRequiredFloat32Attribute(
      shiftedRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
    );

    expect(getPreparedSpanRefs(shiftedRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
    );
    expect(shiftedRow?.binaryDependencyLineData?.dependencies).toEqual(
      firstRow?.binaryDependencyLineData?.dependencies
    );
    expect(shiftedRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(shiftedRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
    expect(shiftedBlockPositions[0]).toBeCloseTo(firstBlockPositions[0] ?? 0);
    expect(shiftedBlockPositions[1]).toBeCloseTo((firstBlockPositions[1] ?? 0) + 10);
    expect(shiftedDependencySources[0]).toBeCloseTo(firstDependencySources[0] ?? 0);
    expect(shiftedDependencySources[1]).toBeCloseTo((firstDependencySources[1] ?? 0) + 10);
  });

  it('rebuilds all binary rows when same-process dependency mode changes', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const submitSettings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const firstPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: submitSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const warningsPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...submitSettings, sameProcessDependencyMode: 'warnings'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const warningsRow = warningsPrepared.foreground[0]?.rows[0];
    expect(getPreparedSpanRefs(warningsRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
    );
    expect(warningsRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(warningsRow?.binaryDependencyLineData?.dependencies).toHaveLength(0);
    expect(warningsRow?.binaryDependencyLineData?.dependencies).not.toBe(
      firstRow?.binaryDependencyLineData?.dependencies
    );
    expect(warningsRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
  });

  it('reprojects rows when combine-thread rows expand to separate threads', () => {
    expectAggregationToggleReprojection('combine-threads', 'separate-threads');
  });

  it('reprojects rows when separate-thread rows collapse into combined threads', () => {
    expectAggregationToggleReprojection('separate-threads', 'combine-threads');
  });

  it('reprojects row-local buffers without geometry-cache metadata', () => {
    const traceGraph = createCrossThreadDependencyTraceGraph();
    const firstLayouts = buildAggregationTestLayouts(traceGraph, 'separate-threads');
    const settings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit',
      trackAggregationMode: 'separate-threads'
    } satisfies TraceVisSettings;
    const firstRows = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: omitTraceLayoutGeometryCache(firstLayouts[0]!),
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME
    });
    const nextLayouts = buildAggregationTestLayouts(traceGraph, 'combine-threads');
    const nextRows = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: omitTraceLayoutGeometryCache(nextLayouts[0]!),
      settings: {
        ...settings,
        trackAggregationMode: 'combine-threads'
      },
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME
    });

    expect(nextRows[0]?.binaryBlockData).not.toBe(firstRows[0]?.binaryBlockData);
    expect(nextRows[0]?.binaryDependencyLineData).not.toBe(firstRows[0]?.binaryDependencyLineData);
  });

  it('rebuilds span binary data when later chunks grow one process spanRefs list', async () => {
    const firstDescriptor = createTestTraceChunkDescriptor('same-process-a', 0);
    const laterDescriptor = createTestTraceChunkDescriptor('same-process-b', 1);
    const store = new TraceChunkStore<TraceChunk, TestTraceChunkDescriptor>({
      identityKey: 'trace-deck-layout-inputs-chunk-test',
      descriptors: [firstDescriptor, laterDescriptor],
      selectionPolicy: createChronologicalTraceChunkSpanBudgetPolicy<TestTraceChunkDescriptor>()
    });
    store.add(
      createTestTraceChunkData(
        [
          createTestTraceChunkRow('same-process-a', {
            startTimeMs: 10,
            endTimeMs: 14
          })
        ],
        firstDescriptor.chunkKey,
        {
          threadId: 'rank-a-thread-a' as TraceThreadId,
          threadName: 'rank-a-thread-a'
        }
      )
    );
    await store.loadWindow({
      window: {id: 'active', minTimeMs: 10, maxTimeMs: 20},
      loadChunk: async descriptor => {
        if (descriptor.chunkKey === laterDescriptor.chunkKey) {
          throw new TraceChunkStoreLoadSkippedError('Defer later test chunk');
        }
        throw new Error('Expected first test chunk to be loaded before registration');
      }
    });
    const firstTraceGraph = materializeTestTraceChunkGraph(store);
    const processRef = firstTraceGraph.getProcessRefs()[0]!;
    const firstSpanRef = encodeSpanRef(0, 0);
    const laterSpanRef = encodeSpanRef(1, 0);
    expect(Array.from(firstTraceGraph.iterateVisibleSpanRefsByProcess(processRef))).toEqual([
      firstSpanRef
    ]);
    const settings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit',
      trackAggregationMode: 'combine-threads'
    } satisfies TraceVisSettings;
    const firstLayouts = buildTraceLayouts({
      traceGraphs: [firstTraceGraph],
      settings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set([processRef]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      },
      threadLaneLayoutOverrides: {},
      timingKey: 'primary',
      minTimeMs: firstTraceGraph.minTimeMs,
      buildMinimapLayouts: true
    });
    const firstRows = buildTracePreparedProcessRows({
      graph: firstTraceGraph,
      layout: firstLayouts[0]!,
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME
    });

    store.add(
      createTestTraceChunkData(
        [
          createTestTraceChunkRow('same-process-b', {
            startTimeMs: 12,
            endTimeMs: 18
          })
        ],
        laterDescriptor.chunkKey,
        {
          threadId: 'rank-a-thread-b' as TraceThreadId,
          threadName: 'rank-a-thread-b'
        }
      )
    );
    const loadedCollapsedTraceGraph = materializeTestTraceChunkGraph(store);
    const loadedCollapsedProcessRef = loadedCollapsedTraceGraph.getProcessRefs()[0]!;
    expect(
      Array.from(
        loadedCollapsedTraceGraph.iterateVisibleSpanRefsByProcess(loadedCollapsedProcessRef)
      )
    ).toEqual([firstSpanRef, laterSpanRef]);
    const loadedCollapsedLayouts = buildTraceLayouts({
      traceGraphs: [loadedCollapsedTraceGraph],
      settings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set([loadedCollapsedProcessRef]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      },
      threadLaneLayoutOverrides: {},
      timingKey: 'primary',
      minTimeMs: loadedCollapsedTraceGraph.minTimeMs,
      buildMinimapLayouts: true
    });
    const loadedCollapsedRows = buildTracePreparedProcessRows({
      graph: loadedCollapsedTraceGraph,
      layout: loadedCollapsedLayouts[0]!,
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME
    });
    const expandedLayouts = buildTraceLayouts({
      traceGraphs: [loadedCollapsedTraceGraph],
      settings,
      threadLaneLayoutOverrides: {},
      timingKey: 'primary',
      minTimeMs: loadedCollapsedTraceGraph.minTimeMs,
      buildMinimapLayouts: true
    });
    const expandedRows = buildTracePreparedProcessRows({
      graph: loadedCollapsedTraceGraph,
      layout: expandedLayouts[0]!,
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME
    });
    const laterSpanIndex = loadedCollapsedRows[0]
      ? Array.from(loadedCollapsedRows[0].binaryBlockData?.spans ?? []).indexOf(laterSpanRef)
      : -1;
    const laterThreadRef = loadedCollapsedTraceGraph.getThreadRefBySpanRef(laterSpanRef);
    if (laterSpanIndex < 0 || laterThreadRef == null) {
      throw new Error('Expected later chunk span in loaded process row');
    }

    expect(getPreparedSpanRefs(firstRows[0]?.binaryBlockData?.spans)).toEqual([firstSpanRef]);
    expect(firstRows[0]?.binaryBlockData?.data.length).toBe(1);
    expect(getPreparedSpanRefs(loadedCollapsedRows[0]?.binaryBlockData?.spans)).toEqual([
      firstSpanRef,
      laterSpanRef
    ]);
    expect(loadedCollapsedRows[0]?.binaryBlockData?.data.length).toBe(2);
    expect(loadedCollapsedRows[0]?.binaryBlockData).not.toBe(firstRows[0]?.binaryBlockData);
    expect(getBinarySpanHeight(loadedCollapsedRows[0]?.binaryBlockData, laterSpanIndex)).toBe(0);
    expect(hasTraceLayoutSpanLaneIndex(expandedLayouts[0]!, laterSpanRef)).toBe(true);
    expect(expandedLayouts[0]!.processLayouts[0]?.threadLayouts).toHaveLength(1);
    expect(expandedLayouts[0]!.threadLayoutMapByRef.get(laterThreadRef)).toBe(
      expandedLayouts[0]!.processLayouts[0]?.threadLayouts[0]
    );
    expect(expandedRows[0]?.binaryBlockData).not.toBe(loadedCollapsedRows[0]?.binaryBlockData);
    expect(getBinarySpanHeight(expandedRows[0]?.binaryBlockData, laterSpanIndex)).toBeGreaterThan(
      0
    );
  });

  it('rebuilds binary colors when the color scheme changes', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const firstPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const nextColorScheme: TraceColorScheme = {
      ...DEFAULT_TRACE_COLOR_SCHEME,
      getSpanFillColorForRef: () => [11, 22, 33, 255]
    };
    const recoloredPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings,
      colorScheme: nextColorScheme,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    const firstRow = firstPrepared.foreground[0]?.rows[0];
    const recoloredRow = recoloredPrepared.foreground[0]?.rows[0];
    expect(getPreparedSpanRefs(recoloredRow?.binaryBlockData?.spans)).toEqual(
      getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
    );
    expect(recoloredRow?.binaryDependencyLineData?.dependencies).toEqual(
      firstRow?.binaryDependencyLineData?.dependencies
    );
    expect(recoloredRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
    expect(recoloredRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
  });

  it('projects active span-filter outputs independently', () => {
    const sourceTrace = buildJSONTrace([createProcessWithSameProcessDependency('rank-a', 0)], [], {
      name: 'trace-deck-layout-inputs-filtered-test'
    });
    const unfilteredGraph = createTestTraceGraph(sourceTrace);
    const filteredGraph = createTestTraceGraph(sourceTrace, {spanFilters: ['parent']});
    const unfilteredLayouts = buildTestLayouts(unfilteredGraph);
    const filteredLayouts = buildTestLayouts(filteredGraph);
    const settings: TraceVisSettings = {
      ...defaultTraceVisSettings,
      sameProcessDependencyMode: 'submit'
    };
    const unfilteredPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: unfilteredGraph,
      sourceTraceGraphs: [unfilteredGraph],
      traceLayouts: unfilteredLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const filteredPrepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: filteredGraph,
      sourceTraceGraphs: [filteredGraph],
      traceLayouts: filteredLayouts,
      paths: [],
      settings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(filteredPrepared.foreground[0]?.rows[0]?.binaryBlockData?.spans).not.toBe(
      unfilteredPrepared.foreground[0]?.rows[0]?.binaryBlockData?.spans
    );
    expect(filteredPrepared.foreground[0]?.rows[0]?.binaryBlockData).not.toBe(
      unfilteredPrepared.foreground[0]?.rows[0]?.binaryBlockData
    );
  });

  it('filters foreground row dependencies through refs before materializing sources', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const sameProcessDependenciesSpy = vi.spyOn(traceGraph, 'getDependencySource');

    const prepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: {...defaultTraceVisSettings, sameProcessDependencyMode: 'submit'},
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared.foreground[0]?.rows[0]?.binaryDependencyLineData?.dependencies).toHaveLength(1);
    expect(sameProcessDependenciesSpy).not.toHaveBeenCalled();
  });

  it('passes the selected collapsed activity aggregation into prepared rows', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);

    const density = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: true,
      isOverviewEnabled: false,
      getTraceModelMatrixForGraph: () => undefined
    });
    const icicle = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: true,
      collapsedActivityAggregation: 'icicle',
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(
      density.foreground[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(false);
    expect(
      icicle.foreground[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(true);
    expect(
      icicle.overview[0]?.rows[0]?.collapsedActivityIntervals.some(
        interval => interval.height != null
      )
    ).toBe(true);
  });

  it('does not precompute row-local selected span refs when visible row spans are omitted', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }

    const preparedRows = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });

    expect(preparedRows[0]?.binaryBlockData).toBeUndefined();
    expect(preparedRows[0]).not.toHaveProperty('selectedSpanRefs');
  });

  it('rebuilds row enrichments without retaining collapsed activity inputs', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }
    const collapsedActivityByProcessRef = new Map([
      [
        traceLayout.renderRows[0]!.processRef,
        [{startX: 3, endX: 4, activity: 1, color: [1, 2, 3] as [number, number, number]}]
      ]
    ]) satisfies CollapsedActivityByProcessRef;

    const first = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      collapsedActivityByProcessRef
    });
    const second = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      collapsedActivityByProcessRef
    });

    expect(second[0]?.collapsedActivityIntervals).not.toBe(first[0]?.collapsedActivityIntervals);
    expect(second[0]?.collapsedActivityIntervals).toEqual(first[0]?.collapsedActivityIntervals);
  });

  it('keeps empty row enrichment arrays stable without overflow labels', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0];
    if (!traceLayout) {
      throw new Error('Expected prepared trace layout');
    }

    const first = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });
    const second = buildTracePreparedProcessRows({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      includeSpans: false,
      includeDependencies: false,
      includeOverflowLabels: false
    });

    expect(second[0]?.collapsedActivityIntervals).toBe(first[0]?.collapsedActivityIntervals);
    expect(second[0]?.overflowLabels).toBe(first[0]?.overflowLabels);
  });

  it('prepares overview rows without reading span details or same process dependencies', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const spanDetailsSpy = vi.spyOn(traceGraph, 'getSpanDetailSource');
    const spanLaneSourceSpy = vi.spyOn(traceGraph, 'getSpanLaneSource');
    const sameProcessDependenciesSpy = vi.spyOn(traceGraph, 'getDependencySource');

    const prepared = buildTracePreparedOverviewGraphScenes({
      isOverviewEnabled: true,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      getTraceModelMatrixForGraph: () => undefined
    });

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.layout.traceGraph).toBe(
      traceLayouts[0]?.minimapLayout?.traceLayout.traceGraph
    );
    expect(prepared[0]?.rows[0]?.binaryBlockData).toBeUndefined();
    expect(prepared[0]?.rows[0]?.binaryDependencyLineData).toBeUndefined();
    expect(prepared[0]?.rows[0]?.collapsedActivityIntervals).toEqual([]);
    expect(prepared[0]?.processActivitySummaryData?.data.length).toBeGreaterThan(0);
    expect(spanDetailsSpy).not.toHaveBeenCalled();
    expect(spanLaneSourceSpy).not.toHaveBeenCalled();
    expect(sameProcessDependenciesSpy).not.toHaveBeenCalled();
  });

  it('projects selected and hovered span indicators into minimap process rows', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(indicators).toEqual([
      expect.objectContaining({
        kind: 'selected',
        x: 4,
        startX: -1,
        endX: 9,
        y: traceLayout.processLayouts[0]?.collapsedActivityY
      }),
      expect.objectContaining({
        kind: 'hovered',
        x: 4,
        startX: 0,
        endX: 8,
        y: traceLayout.processLayouts[0]?.collapsedActivityY
      })
    ]);
  });

  it('decorates prepared minimap scenes with transient selection inputs', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayouts = buildTestLayouts(traceGraph);
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    const prepared = buildTestTracePreparedRenderData({
      primaryTraceGraph: traceGraph,
      sourceTraceGraphs: [traceGraph],
      traceLayouts,
      paths: [],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      showCollapsedActivitySummary: false,
      isOverviewEnabled: true,
      getTraceModelMatrixForGraph: () => undefined
    });

    const selectionOverviewScenes = buildTraceSelectionOverviewScenes({
      overviewScenes: prepared.overview,
      sourceTraceGraphs: [traceGraph],
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(prepared.overview[0]?.minimapSpanIndicators).toEqual([]);
    expect(selectionOverviewScenes[0]?.rows).toBe(prepared.overview[0]?.rows);
    expect(selectionOverviewScenes[0]?.minimapSpanIndicators).toEqual([
      expect.objectContaining({kind: 'selected'}),
      expect.objectContaining({kind: 'hovered'})
    ]);
  });

  it('projects minimap span indicators to the rendered span geometry center', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph, 'latest')[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef]
    });

    expect(indicators[0]).toMatchObject({
      kind: 'selected',
      x: 24,
      startX: 19,
      endX: 29
    });
  });

  it('dedupes hovered span indicators when the hovered span is already selected', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef: selectedSpanRef
    });

    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toMatchObject({kind: 'selected'});
  });

  it('omits minimap span indicators when the span or process row is missing', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    expect(
      buildTracePreparedMinimapSpanIndicators({
        graph: traceGraph,
        layout: {...traceLayout, renderRows: []},
        settings: defaultTraceVisSettings,
        colorScheme: DEFAULT_TRACE_COLOR_SCHEME,
        selectedSpanRefs: [getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId)],
        hoveredSpanRef: 999_999 as SpanRef
      })
    ).toEqual([]);
  });

  it('colors minimap span indicators from the resolved span fill color', () => {
    const traceGraph = createDependencyTraceGraph();
    const traceLayout = buildTestLayouts(traceGraph)[0]?.minimapLayout?.traceLayout;
    const selectedSpanRef = getRequiredTestSpanRef(traceGraph, 'parent' as TraceSpanId);
    const hoveredSpanRef = getRequiredTestSpanRef(traceGraph, 'child' as TraceSpanId);
    const colorScheme: TraceColorScheme = {
      ...DEFAULT_TRACE_COLOR_SCHEME,
      getSpanStyleForRef: () => ({spanFillColor: [12, 34, 56, 255]})
    };
    if (!traceLayout) {
      throw new Error('Expected minimap trace layout');
    }

    const indicators = buildTracePreparedMinimapSpanIndicators({
      graph: traceGraph,
      layout: traceLayout,
      settings: defaultTraceVisSettings,
      colorScheme,
      selectedSpanRefs: [selectedSpanRef],
      hoveredSpanRef
    });

    expect(indicators[0]).toMatchObject({
      kind: 'selected',
      lineColor: [12, 34, 56, 190]
    });
    expect(indicators[1]).toMatchObject({
      kind: 'hovered',
      lineColor: [12, 34, 56, 130]
    });
  });

  it('builds minimap view bounds from minimap layouts and overview time ranges', () => {
    const overviewViewModel = buildTracePreparedOverviewViewModel({
      isOverviewEnabled: true,
      mainBounds: [
        [0, 0],
        [100, 100]
      ],
      minimapBounds: [
        [5, -10],
        [120, 80]
      ],
      originTimeMs: 50,
      overviewTimeRange: {
        startTimeMs: 10,
        endTimeMs: 200
      },
      overviewLoadedTimeRange: {
        startTimeMs: 60,
        endTimeMs: 90
      }
    });

    expect(overviewViewModel.bounds).toEqual([
      [-40, -10],
      [150, 80]
    ]);
    expect(overviewViewModel.loadedContentBounds).toEqual({
      minX: 10,
      maxX: 40
    });
  });
});

function createDependencyTraceGraph(): TraceGraph {
  return createTraceGraphFromProcesses([createProcessWithSameProcessDependency('rank-a', 0)]);
}

/** Builds one two-thread process so aggregation toggles necessarily move span/dependency geometry. */
function createCrossThreadDependencyTraceGraph(): TraceGraph {
  return createTraceGraphFromProcesses([
    createProcessWithCrossThreadSameProcessDependency('rank-a', 0)
  ]);
}

function createTraceGraphFromProcesses(processes: readonly TraceProcess[]): TraceGraph {
  return createTestTraceGraph(
    buildJSONTrace([...processes], [], {
      name: 'trace-deck-layout-inputs-test'
    })
  );
}

function createAppendedTraceGraphReusingFirstProcessTables(
  firstTraceGraph: TraceGraph,
  processes: readonly TraceProcess[]
): TraceGraph {
  return createAppendedTraceGraphReusingPreviousProcessTables(firstTraceGraph, processes);
}

/** Builds an appended graph fixture that preserves existing process table and chunk identities. */
function createAppendedTraceGraphReusingPreviousProcessTables(
  previousTraceGraph: TraceGraph,
  processes: readonly TraceProcess[]
): TraceGraph {
  const appendedTraceDataset = createTraceDatasetFromJSONTraceForTest(
    buildJSONTrace([...processes], [], {
      name: 'trace-deck-layout-inputs-append-test'
    })
  );
  if (processes.length === 0) {
    throw new Error('Expected at least one process');
  }
  const previousProcessIds = new Set(previousTraceGraph.processIdsByIndex);
  return createRawTestTraceGraph({
    ...appendedTraceDataset,
    chunks: appendedTraceDataset.chunks.map(
      chunk =>
        previousTraceGraph.traceDataset.chunks.find(
          previousChunk => previousChunk.chunkKey === chunk.chunkKey
        ) ?? chunk
    ),
    processSpanTableMap: {
      ...appendedTraceDataset.processSpanTableMap,
      ...Object.fromEntries(
        [...previousProcessIds].flatMap(processId => {
          const table = previousTraceGraph.processSpanTableMap[processId];
          return table ? [[processId, table] as const] : [];
        })
      )
    },
    sameProcessDependencyTableMap: {
      ...appendedTraceDataset.sameProcessDependencyTableMap,
      ...Object.fromEntries(
        [...previousProcessIds].flatMap(processId => {
          const table = previousTraceGraph.sameProcessDependencyTableMap[processId];
          return table ? [[processId, table] as const] : [];
        })
      )
    }
  });
}

function buildTestLayouts(
  traceGraph: TraceGraph,
  timingKey: string | null = 'primary',
  topPadding = 0
) {
  return buildTraceLayouts({
    traceGraphs: [traceGraph],
    topPadding,
    settings: defaultTraceVisSettings,
    threadLaneLayoutOverrides: {},
    timingKey,
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true
  });
}

/** Builds layouts for one explicit track aggregation mode. */
function buildAggregationTestLayouts(
  traceGraph: TraceGraph,
  trackAggregationMode: TraceVisSettings['trackAggregationMode']
) {
  return buildTraceLayouts({
    traceGraphs: [traceGraph],
    settings: {
      ...defaultTraceVisSettings,
      trackAggregationMode
    },
    threadLaneLayoutOverrides: {},
    timingKey: 'primary',
    minTimeMs: traceGraph.minTimeMs,
    buildMinimapLayouts: true
  });
}

/** Returns one layout unchanged now that TraceLayout carries no geometry cache. */
function omitTraceLayoutGeometryCache(traceLayout: TraceLayout): TraceLayout {
  return traceLayout;
}

function getRequiredFloat32Attribute(value: unknown): Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new Error('Expected Float32Array attribute');
  }
  return value;
}

/** Returns one rendered binary span height or zero when geometry is absent. */
function getBinarySpanHeight(
  binaryBlockData:
    | {
        /** Binary layer payload containing packed attribute columns. */
        readonly data: {
          /** Packed binary attributes keyed by deck.gl attribute name. */
          readonly attributes: Readonly<
            Record<
              string,
              {
                /** Packed binary attribute values. */
                readonly value: Float32Array | Uint8Array | Uint32Array;
              }
            >
          >;
        };
      }
    | undefined,
  spanIndex: number
): number {
  const sizes = binaryBlockData?.data.attributes.getSize?.value;
  return sizes instanceof Float32Array ? (sizes[spanIndex * 2 + 1] ?? 0) : 0;
}

function getRequiredTestSpanRef(traceGraph: TraceGraph, spanId: TraceSpanId): SpanRef {
  const spanRef = traceGraph.getSpanRefById(spanId);
  if (spanRef == null) {
    throw new Error(`Expected span ref for ${spanId}`);
  }
  return spanRef;
}

/** Verifies aggregation toggles rebuild direct row payloads from current layout state. */
function expectAggregationToggleReprojection(
  initialAggregationMode: TraceVisSettings['trackAggregationMode'],
  nextAggregationMode: TraceVisSettings['trackAggregationMode']
): void {
  const traceGraph = createCrossThreadDependencyTraceGraph();
  const firstLayouts = buildAggregationTestLayouts(traceGraph, initialAggregationMode);
  const settings = {
    ...defaultTraceVisSettings,
    sameProcessDependencyMode: 'submit',
    trackAggregationMode: initialAggregationMode
  } satisfies TraceVisSettings;
  const firstRows = buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: firstLayouts[0]!,
    settings,
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME
  });
  const nextLayouts = buildAggregationTestLayouts(traceGraph, nextAggregationMode);
  const nextRows = buildTracePreparedProcessRows({
    graph: traceGraph,
    layout: nextLayouts[0]!,
    settings: {
      ...settings,
      trackAggregationMode: nextAggregationMode
    },
    colorScheme: DEFAULT_TRACE_COLOR_SCHEME
  });

  const firstRow = firstRows[0];
  const nextRow = nextRows[0];
  expect(firstRows).toHaveLength(1);
  expect(nextRows).toHaveLength(1);
  expect(getPreparedSpanRefs(nextRow?.binaryBlockData?.spans)).toEqual(
    getPreparedSpanRefs(firstRow?.binaryBlockData?.spans)
  );
  expect(nextRow?.binaryDependencyLineData?.dependencies).toEqual(
    firstRow?.binaryDependencyLineData?.dependencies
  );
  expect(nextRow?.binaryBlockData).not.toBe(firstRow?.binaryBlockData);
  expect(nextRow?.binaryDependencyLineData).not.toBe(firstRow?.binaryDependencyLineData);
  expect(nextRow?.binaryBlockData?.data.attributes.getPosition?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getPosition?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getSize?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getSize?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value).not.toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getSourcePosition?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getTargetPosition?.value).not.toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getTargetPosition?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getFillColor?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getFillColor?.value
  );
  expect(nextRow?.binaryBlockData?.data.attributes.getLineColor?.value).not.toBe(
    firstRow?.binaryBlockData?.data.attributes.getLineColor?.value
  );
  expect(nextRow?.binaryDependencyLineData?.data.attributes.getColor?.value).not.toBe(
    firstRow?.binaryDependencyLineData?.data.attributes.getColor?.value
  );
}

function createProcessWithSameProcessDependency(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread`,
    threadId: `${processId}-thread` as TraceThreadId,
    processId
  };
  const parentBlock = createBlock('parent', thread);
  const childBlock = createBlock('child', thread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentBlock.sameProcessDependencyIds = [dependencyId];
  parentBlock.sameProcessDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [parentBlock, childBlock],
    spanMap: {
      [parentBlock.spanId]: parentBlock,
      [childBlock.spanId]: childBlock
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [dependency],
    remoteDependencies: []
  };
}

/** Builds one process whose same-process dependency spans two distinct source threads. */
function createProcessWithCrossThreadSameProcessDependency(
  processId: string,
  rankNum: number
): TraceProcess {
  const startThread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread-a`,
    threadId: `${processId}-thread-a` as TraceThreadId,
    processId
  };
  const endThread: TraceThread = {
    type: 'trace-thread',
    name: `${processId}-thread-b`,
    threadId: `${processId}-thread-b` as TraceThreadId,
    processId
  };
  const parentBlock = createBlock('parent', startThread);
  const childBlock = createBlock('child', endThread);
  const dependencyId = 'dep-parent-child' as TraceDependencyId;
  const dependency: TraceSameProcessDependency = {
    type: 'trace-same-process-dependency',
    dependencyId,
    startSpanId: parentBlock.spanId,
    endSpanId: childBlock.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 1_000
  };
  parentBlock.sameProcessDependencyIds = [dependencyId];
  parentBlock.sameProcessDependencies = [dependency];

  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [startThread, endThread],
    threadMap: {
      [startThread.threadId]: startThread,
      [endThread.threadId]: endThread
    },
    spans: [parentBlock, childBlock],
    spanMap: {
      [parentBlock.spanId]: parentBlock,
      [childBlock.spanId]: childBlock
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies: [dependency],
    remoteDependencies: []
  };
}

function createBlock(name: string, thread: TraceThread): TraceSpan {
  return {
    type: 'trace-span',
    spanId: name as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs: name === 'parent' ? 0 : 1,
        endTimeMs: name === 'parent' ? 10 : 9,
        durationMs: name === 'parent' ? 10 : 8,
        durationMsAsString: name === 'parent' ? '10ms' : '8ms'
      },
      latest: {
        status: 'finished',
        startTimeMs: name === 'parent' ? 20 : 41,
        endTimeMs: name === 'parent' ? 30 : 49,
        durationMs: name === 'parent' ? 10 : 8,
        durationMsAsString: name === 'parent' ? '10ms' : '8ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}
