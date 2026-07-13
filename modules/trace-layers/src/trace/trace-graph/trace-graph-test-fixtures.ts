import {buildTraceChunkDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {buildTraceDatasetRefSources} from '../trace-dataset-ref-sources';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';
import {TraceGraph} from './trace-graph';
import {encodeSpanRef} from './trace-id-encoder';

import type {TraceDataset} from '../trace-dataset';
import type {TraceViewSnapshotOptions} from '../trace-view-snapshot';
import type {TraceGraphSpanLookupStore} from './trace-graph-types';
import type {
  SpanRef,
  TraceCounter,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceInstant,
  TraceProcess,
  TraceSameProcessDependency,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from './trace-types';

/** Creates a minimal single-process test span. */
export function createBlock(spanId: string): TraceSpan {
  return {
    type: 'trace-span',
    spanRef: 0 as SpanRef,
    spanId: spanId as TraceSpanId,
    threadId: 'thread-1' as TraceThreadId,
    processName: 'rank-1',
    name: spanId,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    sameProcessDependencyIds: [],
    sameProcessDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/** Creates a test span assigned to a specific process and thread. */
export function createBlockForProcess(params: {
  /** Stable span id used by graph lookup helpers. */
  spanId: string;
  /** Process id that owns the test span. */
  processId: string;
  /** Thread id that owns the test span. */
  threadId: string;
  /** Optional runtime span ref assigned before graph materialization. */
  spanRef?: SpanRef;
  /** Optional display name; defaults to `spanId`. */
  name?: string;
  /** Optional start timestamp in milliseconds; defaults to 0. */
  startTimeMs?: number;
  /** Optional end timestamp in milliseconds; defaults to 1. */
  endTimeMs?: number;
}): TraceSpan {
  const startTimeMs = params.startTimeMs ?? 0;
  const endTimeMs = params.endTimeMs ?? 1;
  return {
    ...createBlock(params.spanId),
    spanRef: params.spanRef ?? (0 as SpanRef),
    threadId: params.threadId as TraceThreadId,
    processName: params.processId,
    name: params.name ?? params.spanId,
    timings: {
      test: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: endTimeMs - startTimeMs,
        durationMsAsString: `${endTimeMs - startTimeMs}ms`
      }
    }
  };
}

/** Creates a same-process dependency for test graphs. */
export function createSameProcessDependency(
  dependencyId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  keywords: string[] = []
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyRef: 0 as TraceSameProcessDependency['dependencyRef'],
    startSpanRef: 0 as SpanRef,
    endSpanRef: 0 as SpanRef,
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(keywords),
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 0
  };
}

/** Creates a cross-process dependency for test graphs. */
export function createCrossProcessDependency(
  dependencyId: string,
  endpointId: string,
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId,
  startRankNum: number,
  endRankNum: number,
  topology: string,
  keywords: string[] = []
): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyRef: 0 as TraceCrossProcessDependency['dependencyRef'],
    startSpanRef: 0 as SpanRef,
    endSpanRef: 0 as SpanRef,
    dependencyId: dependencyId as TraceDependencyId,
    endpointId: endpointId as TraceCrossProcessEndpointId,
    startRankNum,
    endRankNum,
    startSpanId,
    endSpanId,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology,
    waitTimeMs: 0,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set(keywords)
  };
}

/** Creates a one-process JSON trace from test spans and same-process dependencies. */
export function createGraphWithBlocks(
  spans: TraceSpan[],
  sameProcessDependencies: TraceSameProcessDependency[]
): ReturnType<typeof buildJSONTrace> {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId: 'rank-1'
  };
  const process: TraceProcess = {
    type: 'trace-process',
    processId: 'rank-1',
    name: 'rank-1',
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    sameProcessDependencies,
    remoteDependencies: []
  };

  return buildJSONTrace([process], [], {name: 'trace-graph-test'});
}

/** Creates a JSON trace process with one thread and optional events. */
export function createProcess(params: {
  /** Stable process id used by graph lookup helpers. */
  processId: string;
  /** Rank number assigned to the process metadata. */
  rankNum: number;
  /** Single thread id created inside the process. */
  threadId: string;
  /** Span rows owned by the process. */
  spans: TraceSpan[];
  /** Optional instant events owned by the process thread. */
  instants?: TraceInstant[];
  /** Optional counter samples owned by the process thread. */
  counters?: TraceCounter[];
  /** Optional process-same process dependencies. */
  sameProcessDependencies?: TraceSameProcessDependency[];
}): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: params.threadId,
    threadId: params.threadId as TraceThreadId,
    processId: params.processId
  };

  return {
    type: 'trace-process',
    processId: params.processId,
    name: params.processId,
    rankNum: params.rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: params.spans,
    spanMap: Object.fromEntries(params.spans.map(span => [span.spanId, span])),
    instants: params.instants ?? [],
    instantMap: Object.fromEntries(
      (params.instants ?? []).map(instant => [instant.instantId, instant])
    ),
    threadInstantMap:
      (params.instants ?? []).length > 0 ? {[thread.threadId]: params.instants ?? []} : {},
    counters: params.counters ?? [],
    counterMap: Object.fromEntries(
      (params.counters ?? []).map(counter => [counter.counterId, counter])
    ),
    threadCounterMap:
      (params.counters ?? []).length > 0 ? {[thread.threadId]: params.counters ?? []} : {},
    sameProcessDependencies: params.sameProcessDependencies ?? [],
    remoteDependencies: []
  };
}

/**
 * Builds one canonical dataset from a JSON trace fixture through the real static chunk seam.
 *
 * Tests that need to mutate dataset tables should spread this snapshot and pass the result to
 * {@link createDatasetTraceGraphRuntimeSourceForTest}; ordinary runtime tests should use
 * {@link createRuntimeTraceGraph}.
 */
export function createTraceDatasetFromJSONTraceForTest(
  graph: ReturnType<typeof buildJSONTrace>
): TraceDataset {
  return createTraceGraphRuntimeSourceFromJSONTraceForTest(graph).traceDataset;
}

/** Creates a runtime TraceGraph from a JSON trace fixture. */
export function createRuntimeTraceGraph(
  graph: ReturnType<typeof buildJSONTrace>,
  options: TraceViewSnapshotOptions = {}
) {
  const runtimeSource = createTraceGraphRuntimeSourceFromJSONTraceForTest(graph);
  return new TraceGraph(runtimeSource, buildTraceViewSnapshot(runtimeSource.traceDataset, options));
}

/** Creates a dataset-backed runtime graph while keeping filter options test-local. */
export function createDatasetRuntimeTraceGraphForTest(
  traceDataset: TraceDataset,
  options: TraceViewSnapshotOptions = {}
): TraceGraph {
  const runtimeSource = createDatasetTraceGraphRuntimeSourceForTest(traceDataset);
  return new TraceGraph(runtimeSource, buildTraceViewSnapshot(runtimeSource.traceDataset, options));
}

/**
 * Creates a static dataset runtime source from one JSON trace fixture.
 */
function createTraceGraphRuntimeSourceFromJSONTraceForTest(
  graph: ReturnType<typeof buildJSONTrace>
) {
  const materializedGraph = materializeJSONTrace(graph);
  return createStaticTraceGraphRuntimeSource({
    identityKey: `${materializedGraph.name}:test-fixture`,
    name: materializedGraph.name,
    spanLayout: materializedGraph.spanLayout,
    chunks: buildTraceChunkDataFromJSONTrace(materializedGraph),
    crossProcessDependencies: materializedGraph.crossProcessDependencies,
    events: materializedGraph.events,
    timeExtents: {
      minTimeMs: materializedGraph.minTimeMs,
      maxTimeMs: materializedGraph.maxTimeMs
    },
    stats: {
      droppedSpanCount: materializedGraph.stats.droppedSpanCount,
      droppedDependencyCount: materializedGraph.stats.droppedDependencyCount,
      droppedCrossProcessDependencyCount: materializedGraph.stats.droppedCrossProcessDependencyCount
    }
  });
}

/**
 * Creates an explicit dataset-backed runtime source from one structural dataset test fixture.
 *
 * It always publishes explicit active refs so manually-mutated structural fixtures cannot opt
 * into trusted dense dataset paths. Ordinary JSON fixtures should still use
 * {@link createRuntimeTraceGraph} so they exercise parser-local chunk finalization and trusted
 * dataset semantics.
 */
export function createDatasetTraceGraphRuntimeSourceForTest(
  traceDataset: TraceDataset,
  traceStore?: TraceGraphSpanLookupStore
) {
  const refSources = buildTraceDatasetRefSources({
    processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex,
    processSpanTableMap: traceDataset.processSpanTableMap,
    sameProcessDependencyTableMap: traceDataset.sameProcessDependencyTableMap
  });
  return {
    traceDataset: {
      ...traceDataset,
      ...refSources,
      spanRefs: traceDataset.spanRefs ?? buildTestTraceDatasetActiveSpanRefs(traceDataset)
    } satisfies TraceDataset,
    ...(traceStore ? {traceStore} : {})
  };
}

/**
 * Lists every fixture chunk row explicitly so structural test datasets stay off trusted dense paths.
 */
function buildTestTraceDatasetActiveSpanRefs(traceDataset: TraceDataset): readonly SpanRef[] {
  return traceDataset.chunks.flatMap(chunk =>
    Array.from({length: chunk.spanTable.numRows}, (_, rowIndex) =>
      encodeSpanRef(chunk.chunkIndex, rowIndex)
    )
  );
}

/** Creates a duplicate-id graph for selected-card process-scoping tests. */
export function createProcessAwareSelectedCardGraph(): {
  /** Source JSON trace containing selected and duplicate span ids. */
  graph: ReturnType<typeof buildJSONTrace>;
  /** Selected span in the process under test. */
  selectedBlock: TraceSpan;
  /** Filtered parent span in the selected process. */
  hiddenParentBlock: TraceSpan;
  /** Cross-process parent that should resolve for the selected span. */
  correctParentBlock: TraceSpan;
  /** Incoming source span that should resolve for the selected span. */
  correctSourceBlock: TraceSpan;
} {
  const correctParentBlock = createBlockForProcess({
    spanId: 'shared-parent',
    processId: 'rank-parent',
    threadId: 'thread-parent',
    name: 'parent-correct',
    startTimeMs: 0,
    endTimeMs: 3
  });
  const correctSourceBlock = createBlockForProcess({
    spanId: 'shared-source',
    processId: 'rank-parent',
    threadId: 'thread-parent',
    name: 'source-correct',
    startTimeMs: 4,
    endTimeMs: 7
  });
  const hiddenParentBlock = createBlockForProcess({
    spanId: 'hidden-parent',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'hidden-parent-correct',
    startTimeMs: 8,
    endTimeMs: 9
  });
  const selectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'selected-correct',
    startTimeMs: 10,
    endTimeMs: 12
  });
  const wrongSelectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'selected-wrong',
    startTimeMs: 20,
    endTimeMs: 21
  });
  const wrongParentBlock = createBlockForProcess({
    spanId: 'shared-parent',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'parent-wrong',
    startTimeMs: 22,
    endTimeMs: 23
  });
  const wrongSourceBlock = createBlockForProcess({
    spanId: 'shared-source',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'source-wrong',
    startTimeMs: 24,
    endTimeMs: 25
  });

  const localParentDependency = createSameProcessDependency(
    'dep-hidden-selected',
    hiddenParentBlock.spanId,
    selectedBlock.spanId,
    ['PARENT']
  );
  localParentDependency.waitTimeMs = 1;

  const crossParentDependency = createCrossProcessDependency(
    'dep-cross-parent',
    'endpoint-parent',
    correctParentBlock.spanId,
    hiddenParentBlock.spanId,
    0,
    1,
    'parent',
    ['PARENT']
  );
  crossParentDependency.waitTimeMs = 2;

  const crossIncomingDependency = createCrossProcessDependency(
    'dep-cross-incoming',
    'endpoint-incoming',
    correctSourceBlock.spanId,
    selectedBlock.spanId,
    0,
    1,
    'send',
    []
  );
  crossIncomingDependency.waitTimeMs = 10;

  const graph = buildJSONTrace(
    [
      createProcess({
        processId: 'rank-parent',
        rankNum: 0,
        threadId: 'thread-parent',
        spans: [correctParentBlock, correctSourceBlock]
      }),
      createProcess({
        processId: 'rank-selected',
        rankNum: 1,
        threadId: 'thread-selected',
        spans: [hiddenParentBlock, selectedBlock],
        sameProcessDependencies: [localParentDependency]
      }),
      createProcess({
        processId: 'rank-other',
        rankNum: 2,
        threadId: 'thread-other',
        spans: [wrongSelectedBlock, wrongParentBlock, wrongSourceBlock]
      })
    ],
    [crossParentDependency, crossIncomingDependency],
    {name: 'process-aware-selected-card'}
  );

  return {
    graph,
    selectedBlock,
    hiddenParentBlock,
    correctParentBlock,
    correctSourceBlock
  };
}

/** Creates a duplicate-id graph for selected-card traversal tests. */
export function createDuplicateIdSelectionTraversalGraph() {
  const selectedParentBlock = createBlockForProcess({
    spanId: 'shared-parent',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'parent-correct',
    startTimeMs: 0,
    endTimeMs: 2
  });
  const selectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'selected-correct',
    startTimeMs: 3,
    endTimeMs: 5
  });
  const wrongParentBlock = createBlockForProcess({
    spanId: 'shared-parent',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'parent-wrong',
    startTimeMs: 6,
    endTimeMs: 8
  });
  const selectedToParentDependency = createSameProcessDependency(
    'dep-selected-parent',
    selectedParentBlock.spanId,
    selectedBlock.spanId,
    ['PARENT']
  );

  const graph = buildJSONTrace(
    [
      createProcess({
        processId: 'rank-selected',
        rankNum: 0,
        threadId: 'thread-selected',
        spans: [selectedParentBlock, selectedBlock],
        sameProcessDependencies: [selectedToParentDependency]
      }),
      createProcess({
        processId: 'rank-other',
        rankNum: 1,
        threadId: 'thread-other',
        spans: [wrongParentBlock]
      })
    ],
    [],
    {name: 'duplicate-id-selection-traversal'}
  );

  return {
    graph,
    selectedBlock,
    selectedParentBlock,
    wrongParentBlock
  };
}

/** Builds a graph where duplicate selected span ids have different visible children per process. */
export function createDuplicateIdChildDependencyGraph() {
  const selectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'selected-correct',
    startTimeMs: 0,
    endTimeMs: 2
  });
  const correctChildBlock = createBlockForProcess({
    spanId: 'child-correct',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'child-correct',
    startTimeMs: 3,
    endTimeMs: 4
  });
  const wrongSelectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'selected-wrong',
    startTimeMs: 5,
    endTimeMs: 6
  });
  const wrongChildBlock = createBlockForProcess({
    spanId: 'child-wrong',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'child-wrong',
    startTimeMs: 7,
    endTimeMs: 8
  });

  const graph = buildJSONTrace(
    [
      createProcess({
        processId: 'rank-selected',
        rankNum: 0,
        threadId: 'thread-selected',
        spans: [selectedBlock, correctChildBlock],
        sameProcessDependencies: [
          createSameProcessDependency(
            'dep-selected-correct-child',
            selectedBlock.spanId,
            correctChildBlock.spanId,
            ['PARENT']
          )
        ]
      }),
      createProcess({
        processId: 'rank-other',
        rankNum: 1,
        threadId: 'thread-other',
        spans: [wrongSelectedBlock, wrongChildBlock],
        sameProcessDependencies: [
          createSameProcessDependency(
            'dep-selected-wrong-child',
            wrongSelectedBlock.spanId,
            wrongChildBlock.spanId,
            ['PARENT']
          )
        ]
      })
    ],
    [],
    {name: 'duplicate-id-child-dependencies'}
  );

  return {
    graph,
    selectedBlock,
    correctChildBlock,
    wrongChildBlock
  };
}

/** Creates a duplicate-id graph with a selected span that has no parent. */
export function createDuplicateIdParentlessSelectionGraph() {
  const selectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-selected',
    threadId: 'thread-selected',
    name: 'selected-parentless',
    startTimeMs: 3,
    endTimeMs: 5
  });
  const wrongParentBlock = createBlockForProcess({
    spanId: 'shared-parent',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'parent-wrong',
    startTimeMs: 0,
    endTimeMs: 2
  });
  const wrongSelectedBlock = createBlockForProcess({
    spanId: 'selected',
    processId: 'rank-other',
    threadId: 'thread-other',
    name: 'selected-wrong',
    startTimeMs: 6,
    endTimeMs: 8
  });
  const wrongParentDependency = createSameProcessDependency(
    'dep-wrong-parent',
    wrongParentBlock.spanId,
    wrongSelectedBlock.spanId,
    ['PARENT']
  );

  const graph = buildJSONTrace(
    [
      createProcess({
        processId: 'rank-selected',
        rankNum: 0,
        threadId: 'thread-selected',
        spans: [selectedBlock]
      }),
      createProcess({
        processId: 'rank-other',
        rankNum: 1,
        threadId: 'thread-other',
        spans: [wrongParentBlock, wrongSelectedBlock],
        sameProcessDependencies: [wrongParentDependency]
      })
    ],
    [],
    {name: 'duplicate-id-parentless-selection'}
  );

  return {
    graph,
    selectedBlock
  };
}

/** Summarizes visible process rows for parity assertions without rebuilding process clones. */
export function getVisibleProcessSnapshot(traceGraph: TraceGraph) {
  return traceGraph.getVisibleProcessRefs().flatMap(processRef => {
    const processIndex = traceGraph.getProcessRefs().indexOf(processRef);
    const process = processIndex >= 0 ? (traceGraph.processes[processIndex] ?? null) : null;
    return process
      ? [
          {
            processId: process.processId,
            spanIds: Array.from(traceGraph.iterateVisibleSpanRefsByProcess(processRef)).flatMap(
              spanRef => {
                const spanId = traceGraph.getSpanId(spanRef);
                return spanId == null ? [] : [spanId];
              }
            ),
            dependencyIds: Array.from(
              traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
            ).flatMap(dependencyRef => {
              const dependencyId = traceGraph.getDependencyId(dependencyRef);
              return dependencyId == null ? [] : [dependencyId];
            })
          }
        ]
      : [];
  });
}
