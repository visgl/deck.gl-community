import {describe, expect, it, vi} from 'vitest';

import {
  buildArrowTraceSpanSidecarTableFromRows,
  buildArrowTraceSpanTableFromRows,
  buildTraceProcessSpanRefTables,
  toTraceSpanArrowRow
} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  createRuntimeTraceGraph as createDatasetRuntimeTraceGraph,
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createTraceDatasetFromJSONTraceForTest
} from '../trace-graph/trace-graph-test-fixtures';
import {
  getRequiredSameProcessDependencyRefById,
  getRequiredThreadRef
} from '../trace-graph/trace-graph-test-utils';
import {
  encodeChunkRef,
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {buildTraceLayouts as buildRuntimeTraceLayouts} from '../trace-layout/trace-geometry-layout';
import * as traceGeometryLayoutCommon from '../trace-layout/trace-geometry-layout-common';
import {buildTraceLayoutProcesses} from '../trace-layout/trace-geometry-layout-helpers';
import {
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility,
  hasTraceLayoutSpanVisibilityFlag,
  traceLayoutSpanVisibilityFlags
} from '../trace-layout/trace-layout';

import type {JSONTrace} from '../ingestion/json-trace';
import type {ThreadRef} from '../trace-graph/trace-id-encoder';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceDependencyId,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {ProcessLayout, ThreadLayout, TraceLayout} from '../trace-layout/trace-layout';

function createRawTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createDatasetRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

describe('buildTraceLayouts', () => {
  type TestTraceGraphSource = JSONTrace | TraceGraph;

  function normalizeTraceGraphSource(
    traceGraph: TestTraceGraphSource,
    spanFilter?: TraceVisSettings['spanFilter']
  ): TraceGraph {
    if (traceGraph instanceof TraceGraph) {
      return traceGraph;
    }
    const options = {spanFilters: spanFilter ? [spanFilter] : undefined};
    return createDatasetRuntimeTraceGraph(traceGraph, options);
  }

  function buildTraceLayouts(
    params: Omit<Parameters<typeof buildRuntimeTraceLayouts>[0], 'traceGraphs' | 'settings'> & {
      traceGraphs: ReadonlyArray<TestTraceGraphSource>;
      settings: Parameters<typeof buildRuntimeTraceLayouts>[0]['settings'] & {
        spanFilter?: TraceVisSettings['spanFilter'];
      };
    }
  ) {
    const {traceGraphs, settings: sourceSettings, ...layoutParams} = params;
    const {spanFilter, ...settings} = sourceSettings;
    return buildRuntimeTraceLayouts({
      ...layoutParams,
      settings,
      traceGraphs: traceGraphs.map(traceGraph => normalizeTraceGraphSource(traceGraph, spanFilter))
    });
  }

  function createRuntimeTraceGraph(
    traceGraph: JSONTrace,
    options?: Parameters<typeof createDatasetRuntimeTraceGraph>[1]
  ) {
    return createDatasetRuntimeTraceGraph(traceGraph, options);
  }

  function requireTraceGraph(layout: {traceGraph?: TraceGraph}) {
    expect(layout.traceGraph).toBeDefined();
    return layout.traceGraph!;
  }

  /** Returns one required runtime thread layout by fixture thread id. */
  function getLayoutThread(layout: TraceLayout, threadId: TraceThreadId): ThreadLayout {
    const threadRef = getRequiredThreadRef(requireTraceGraph(layout), threadId);
    const threadLayout = layout.threadLayoutMapByRef.get(threadRef);
    if (!threadLayout) {
      throw new Error(`Expected thread layout for ${threadId}`);
    }
    return threadLayout;
  }

  /** Builds exact thread-ref layout lookup for hand-authored layout fixtures. */
  function buildThreadLayoutMapByRef(
    traceGraph: TraceGraph,
    processLayouts: readonly ProcessLayout[]
  ): ReadonlyMap<ThreadRef, ThreadLayout> {
    const threadLayoutMapByRef = new Map<ThreadRef, ThreadLayout>();
    for (const [processIndex, process] of buildTraceLayoutProcesses(traceGraph).entries()) {
      const processLayout = processLayouts[processIndex];
      if (!processLayout) {
        continue;
      }
      for (const [threadIndex, threadRef] of process.threadRefs.entries()) {
        const threadLayout =
          processLayout.threadLayouts.length === 1
            ? processLayout.threadLayouts[0]
            : processLayout.threadLayouts[threadIndex];
        if (threadLayout) {
          threadLayoutMapByRef.set(threadRef, threadLayout);
        }
      }
    }
    return threadLayoutMapByRef;
  }

  /** Builds exact process-ref layout lookup for hand-authored layout fixtures. */
  function buildProcessLayoutMapByRef(
    processLayouts: readonly ProcessLayout[]
  ): ReadonlyMap<ReturnType<typeof getRequiredProcessRef>, ProcessLayout> {
    return new Map(processLayouts.map(processLayout => [processLayout.processRef, processLayout]));
  }

  function getSpanGeometry(
    layout: TraceLayout,
    spanId: TraceSpanId
  ): traceGeometryLayoutCommon.SpanBoundingBox | undefined {
    const spanRef = requireTraceGraph(layout).getSpanRefById(spanId);
    if (spanRef == null) {
      return undefined;
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    return fillTraceLayoutSpanGeometry({traceLayout: layout, spanRef, target: geometry})
      ? (new Float32Array([
          geometry.x1,
          geometry.y1,
          geometry.x2,
          geometry.y2
        ]) as traceGeometryLayoutCommon.SpanBoundingBox)
      : undefined;
  }

  function getLayoutSameProcessDependencyGeometry(
    layout: TraceLayout,
    dependencyId: TraceDependencyId
  ): Float32Array | undefined {
    const dependencyRef = getRequiredSameProcessDependencyRefById(
      requireTraceGraph(layout),
      dependencyId
    );
    if (dependencyRef == null) {
      return undefined;
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    return fillTraceLayoutSameProcessDependencyGeometry({
      traceLayout: layout,
      dependencyRef,
      target: geometry
    })
      ? new Float32Array([geometry.x1, geometry.y1, geometry.x2, geometry.y2])
      : undefined;
  }

  function createRank(
    processId: string,
    index: number,
    blockStartMs: number = index
  ): TraceProcess {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: `${processId}-stream`,
      threadId: `${processId}-stream` as TraceThreadId,
      processId
    };

    const span: TraceSpan = {
      type: 'trace-span',
      spanId: `${processId}-span` as TraceSpanId,
      threadId: thread.threadId,
      processName: processId,
      name: `${processId}-span`,
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: blockStartMs,
          endTimeMs: blockStartMs + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      sameProcessDependencyIds: [],
      sameProcessDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    };

    return {
      type: 'trace-process',
      processId,
      name: processId,
      rankNum: index,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      spans: [span],
      spanMap: {[span.spanId]: span},
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      sameProcessDependencies: [],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  function createGraph(name: string, processIds: string[]): JSONTrace {
    const ranks = processIds.map((processId, index) => createRank(processId, index));
    return buildJSONTrace(ranks, [], {name});
  }

  function createRankWithStreams(processId: string, streamNames: string[]): TraceProcess {
    const threads: TraceThread[] = streamNames.map((name, index) => ({
      type: 'trace-thread',
      name,
      threadId: `${processId}-stream-${index}` as TraceThreadId,
      processId
    }));
    const spans: TraceSpan[] = threads.map((thread, index) => ({
      type: 'trace-span',
      spanId: `${processId}-span-${index}` as TraceSpanId,
      threadId: thread.threadId,
      processName: processId,
      name: `${processId}-span-${index}`,
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: index,
          endTimeMs: index + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      sameProcessDependencyIds: [],
      sameProcessDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    }));

    return {
      type: 'trace-process',
      processId,
      name: processId,
      rankNum: 0,
      stepNum: 0,
      threads,
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      sameProcessDependencies: [],
      remoteDependencies: [],
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])) as Record<
        string,
        TraceThread
      >
    } satisfies TraceProcess;
  }

  /**
   * Builds a rank with one process-local stream id and a same-process dependency on that stream.
   */
  function createRepeatedThreadDependencyRank(params: {
    processId: string;
    rankNum: number;
    threadId: string;
    blockStartOffsetMs?: number;
  }): TraceProcess {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: params.threadId,
      threadId: params.threadId as TraceThreadId,
      processId: params.processId
    };
    const parentStartMs = params.blockStartOffsetMs ?? 0;
    const childStartMs = parentStartMs + 2;
    const parentBlock: TraceSpan = {
      type: 'trace-span',
      spanId: `${params.processId}-${params.threadId}-parent` as TraceSpanId,
      threadId: thread.threadId,
      processName: params.processId,
      name: `${params.processId}-parent`,
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: parentStartMs,
          endTimeMs: parentStartMs + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      sameProcessDependencyIds: [],
      sameProcessDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    };
    const dependencyId = `${params.processId}-${params.threadId}-dep` as TraceDependencyId;
    const childBlock: TraceSpan = {
      type: 'trace-span',
      spanId: `${params.processId}-${params.threadId}-child` as TraceSpanId,
      threadId: thread.threadId,
      processName: params.processId,
      name: `${params.processId}-child`,
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: childStartMs,
          endTimeMs: childStartMs + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      sameProcessDependencyIds: [dependencyId],
      sameProcessDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    };
    const sameProcessDependency = {
      type: 'trace-same-process-dependency',
      dependencyId,
      startSpanId: parentBlock.spanId,
      endSpanId: childBlock.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    } satisfies TraceProcess['sameProcessDependencies'][number];
    const spans = [parentBlock, childBlock];

    return {
      type: 'trace-process',
      processId: params.processId,
      name: params.processId,
      rankNum: params.rankNum,
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
      sameProcessDependencies: [sameProcessDependency],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  const baseSettings: Pick<
    TraceVisSettings,
    | 'showCrossProcessDependencies'
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'sameProcessDependencyMode'
    | 'layoutDensity'
    | 'maxVisibleLanesPerThread'
    | 'processLayoutMode'
    | 'trackAggregationMode'
  > = {
    showCrossProcessDependencies: true,
    threadDisplayMode: 'all',
    selectedThreadNames: undefined,
    sortThreads: false,
    sameProcessDependencyMode: 'all',
    processLayoutMode: 'interleaved',
    layoutDensity: 'comfortable',
    maxVisibleLanesPerThread: undefined,
    trackAggregationMode: 'separate-threads'
  };

  function getLayoutSpanRef(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanId: TraceSpanId
  ): SpanRef {
    const spanRef = layout.traceGraph?.getSpanRefById(spanId);
    if (spanRef == null) {
      throw new Error(`Expected span ref for span ${spanId}`);
    }
    return spanRef;
  }

  it('derives span geometry without expanding display dependency ids', () => {
    const rank = createRepeatedThreadDependencyRank({
      processId: 'rank-geometry-source',
      rankNum: 0,
      threadId: 'thread-geometry-source'
    });
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([rank], [], {name: 'geometry-source-by-ref'})
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });
    const layoutTraceGraph = requireTraceGraph(layout);
    const spanRef = layoutTraceGraph.getSpanRefById(rank.spans[0]!.spanId);
    expect(spanRef).not.toBeNull();
    const target = {x1: 0, y1: 0, x2: 0, y2: 0};

    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout,
        spanRef: spanRef!,
        target
      })
    ).toBe(true);
  });

  it('resolves store-backed span geometry when the span chunk index differs from the process index', () => {
    const rank = createRank('rank-chunk', 0, 10);
    const span = rank.spans[0]!;
    const graph = buildJSONTrace([rank], [], {name: 'chunk-span-geometry'});
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const sourceChunk = traceDataset.chunks[0];
    if (!sourceChunk) {
      throw new Error('Expected source chunk');
    }
    const processRef = encodeProcessRef(0);
    const storeSpanRef = encodeSpanRef(0, 0);
    const storeSpanTable = buildArrowTraceSpanTableFromRows([
      toTraceSpanArrowRow(span, processRef, encodeProcessThreadRef(0, 0))
    ]);
    const geometryChunk = {
      ...sourceChunk,
      chunkIndex: 0,
      chunkRef: encodeChunkRef(0),
      chunkKey: 'chunk-geometry',
      processRefs: [processRef],
      processId: null,
      spanTable: storeSpanTable,
      resolvedSameProcessDependencyTable:
        traceDataset.sameProcessDependencyTableMap[rank.processId as TraceProcessId]!
    };
    const traceGraph = createRawTestTraceGraph({
      ...traceDataset,
      chunks: [geometryChunk],
      processSpanTableMap: buildTraceProcessSpanRefTables([geometryChunk], traceDataset.processes, {
        processIdsByIndex: traceDataset.ownerRefSnapshot.processIdsByIndex
      })
    });

    expect(traceGraph.getSpanRefById(span.spanId)).toBe(storeSpanRef);

    const [layout] = buildTraceLayouts({traceGraphs: [traceGraph], settings: baseSettings});
    expect(layout).toBeDefined();

    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout!,
        spanRef: storeSpanRef,
        target: geometry
      })
    ).toBe(true);
    expect(geometry.x2).toBeGreaterThan(geometry.x1);
    expect(geometry.y2).toBeGreaterThan(geometry.y1);

    const resolvedGeometry = {x1: 0, y1: 0, x2: 0, y2: 0};

    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout!,
        spanRef: storeSpanRef,
        target: resolvedGeometry
      })
    ).toBe(true);
    expect(resolvedGeometry.x1).toBeCloseTo(geometry.x1, 6);
    expect(resolvedGeometry.x2).toBeCloseTo(geometry.x2, 6);
    expect(resolvedGeometry.y1).toBeCloseTo(geometry.y1, 6);
    expect(resolvedGeometry.y2).toBeCloseTo(geometry.y2, 6);
  });

  it('anchors same process dependencies to store-backed span refs when process-scoped endpoint refs collide', () => {
    const rank = createRepeatedThreadDependencyRank({
      processId: 'rank-chunk-dependency',
      rankNum: 0,
      threadId: 'chunk-stream',
      blockStartOffsetMs: 10
    });
    const parent = rank.spans[0]!;
    const child = rank.spans[1]!;
    const dependency = {
      ...rank.sameProcessDependencies[0]!,
      startSpanRef: encodeSpanRef(0, 0),
      endSpanRef: encodeSpanRef(0, 1)
    };
    const rankWithProcessScopedRefs = {
      ...rank,
      sameProcessDependencies: [dependency]
    } satisfies TraceProcess;
    const graph = buildJSONTrace([rankWithProcessScopedRefs], [], {
      name: 'chunk-same-process-dependency-geometry'
    });
    const traceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const sourceChunk = traceDataset.chunks[0];
    if (!sourceChunk) {
      throw new Error('Expected source chunk');
    }
    const processRef = encodeProcessRef(0);
    const threadRef = encodeProcessThreadRef(0, 0);
    const storeSpanTable = buildArrowTraceSpanTableFromRows([
      toTraceSpanArrowRow(child, processRef, threadRef),
      toTraceSpanArrowRow(parent, processRef, threadRef)
    ]);
    const storeSpanSidecarTable = buildArrowTraceSpanSidecarTableFromRows([
      {
        incomingSameProcessDependencyRefs: [],
        outgoingSameProcessDependencyRefs: [],
        sameProcessDependencyIds: [],
        incomingSameProcessDependencyRowIndexes: [],
        outgoingSameProcessDependencyRowIndexes: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: [],
        timings: child.timings,
        keywords: child.keywords ?? [],
        userData: child.userData
      },
      {
        incomingSameProcessDependencyRefs: [],
        outgoingSameProcessDependencyRefs: [],
        sameProcessDependencyIds: [],
        incomingSameProcessDependencyRowIndexes: [],
        outgoingSameProcessDependencyRowIndexes: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: [],
        timings: parent.timings,
        keywords: parent.keywords ?? [],
        userData: parent.userData
      }
    ]);
    const traceGraph = createRawTestTraceGraph({
      ...traceDataset,
      chunks: [
        {
          ...sourceChunk,
          chunkIndex: 0,
          chunkRef: encodeChunkRef(0),
          chunkKey: 'chunk-reordered-geometry',
          processRefs: [processRef],
          processId: null,
          spanTable: storeSpanTable,
          resolvedSameProcessDependencyTable:
            traceDataset.sameProcessDependencyTableMap[rank.processId as TraceProcessId]!,
          spanSidecarTable: storeSpanSidecarTable
        }
      ]
    });

    expect(traceGraph.getSpanRefById(parent.spanId)).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getSpanRefById(child.spanId)).toBe(encodeSpanRef(0, 0));
    const dependencyRef = getRequiredSameProcessDependencyRefById(
      traceGraph,
      dependency.dependencyId
    );

    expect(dependencyRef).toBeDefined();
    expect(traceGraph.getDependencyStartBlockId(dependencyRef!)).toBe(parent.spanId);
    expect(traceGraph.getDependencyEndBlockId(dependencyRef!)).toBe(child.spanId);
    expect(traceGraph.getDependencyStartSpan(dependencyRef!)).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getDependencyEndSpan(dependencyRef!)).toBe(encodeSpanRef(0, 0));
    const processRefForDependency = getRequiredProcessRef(traceGraph, rank.processId);
    const sourceDependencyRef = traceGraph.getSameProcessDependencyRefs(processRefForDependency)[0];

    expect(sourceDependencyRef).toBeDefined();
    expect(traceGraph.getDependencyStartSpan(sourceDependencyRef!)).toBe(encodeSpanRef(0, 1));
    expect(traceGraph.getDependencyEndSpan(sourceDependencyRef!)).toBe(encodeSpanRef(0, 0));

    const [layout] = buildTraceLayouts({traceGraphs: [traceGraph], settings: baseSettings});
    const geometry = getLayoutSameProcessDependencyGeometry(layout!, dependency.dependencyId);

    expect(geometry).toBeDefined();
    expect(geometry![2]).toBeGreaterThan(geometry![0]!);
  });

  it('uses authored manual geometry and forces separate-thread layout over persisted combine mode', () => {
    const firstThread = {
      type: 'trace-thread',
      name: 'manual-a',
      threadId: 'manual-a' as TraceThreadId,
      processId: 'manual-process'
    } satisfies TraceThread;
    const secondThread = {
      type: 'trace-thread',
      name: 'manual-b',
      threadId: 'manual-b' as TraceThreadId,
      processId: 'manual-process'
    } satisfies TraceThread;
    const firstSpan = {
      ...createRank('manual-process', 0).spans[0]!,
      spanId: 'manual-a-span' as TraceSpanId,
      threadId: firstThread.threadId,
      layoutTopY: 1,
      layoutHeight: 2
    } satisfies TraceSpan;
    const secondSpan = {
      ...createRank('manual-process', 0, 2).spans[0]!,
      spanId: 'manual-b-span' as TraceSpanId,
      threadId: secondThread.threadId,
      layoutTopY: 0.5,
      layoutHeight: 1
    } satisfies TraceSpan;
    const process = {
      ...createRank('manual-process', 0),
      threads: [firstThread, secondThread],
      threadMap: {
        [firstThread.threadId]: firstThread,
        [secondThread.threadId]: secondThread
      },
      spans: [firstSpan, secondSpan],
      spanMap: {
        [firstSpan.spanId]: firstSpan,
        [secondSpan.spanId]: secondSpan
      }
    } satisfies TraceProcess;
    const [layout] = buildTraceLayouts({
      traceGraphs: [buildJSONTrace([process], [], {name: 'manual-layout', spanLayout: 'manual'})],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const firstGeometry = getSpanGeometry(layout!, firstSpan.spanId)!;
    const secondGeometry = getSpanGeometry(layout!, secondSpan.spanId)!;
    const firstThreadLayout = getLayoutThread(layout!, firstThread.threadId)!;
    const secondThreadLayout = getLayoutThread(layout!, secondThread.threadId)!;

    expect(requireTraceGraph(layout!).spanLayout).toBe('manual');
    expect(layout!.processLayouts[0]?.threadLayouts).toHaveLength(2);
    expect(firstGeometry[1]).toBeCloseTo(firstThreadLayout.yPosition + 1);
    expect(firstGeometry[3]).toBeCloseTo(firstThreadLayout.yPosition + 3);
    expect(secondGeometry[1]).toBeCloseTo(secondThreadLayout.yPosition + 0.5);
    expect(secondGeometry[3]).toBeCloseTo(secondThreadLayout.yPosition + 1.5);
    expect(firstThreadLayout.manualContentHeight).toBeCloseTo(3);
    expect(secondThreadLayout.yPosition).toBeGreaterThan(firstThreadLayout.yPosition);
  });

  it('hides malformed manual spans, keeps baseline manual rows, and suppresses broken dependency geometry', () => {
    const thread = {
      type: 'trace-thread',
      name: 'manual-thread',
      threadId: 'manual-thread' as TraceThreadId,
      processId: 'manual-invalid-process'
    } satisfies TraceThread;
    const validSpan = {
      ...createRank('manual-invalid-process', 0).spans[0]!,
      spanId: 'manual-valid-span' as TraceSpanId,
      threadId: thread.threadId,
      layoutTopY: 0.25,
      layoutHeight: 1.75
    } satisfies TraceSpan;
    const invalidSpan = {
      ...createRank('manual-invalid-process', 0, 2).spans[0]!,
      spanId: 'manual-invalid-span' as TraceSpanId,
      threadId: thread.threadId,
      layoutTopY: -1,
      layoutHeight: 20
    } satisfies TraceSpan;
    const dependencyId = 'manual-invalid-dependency' as TraceDependencyId;
    const process = {
      ...createRank('manual-invalid-process', 0),
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      spans: [validSpan, invalidSpan],
      spanMap: {
        [validSpan.spanId]: validSpan,
        [invalidSpan.spanId]: invalidSpan
      },
      sameProcessDependencies: [
        {
          type: 'trace-same-process-dependency',
          dependencyId,
          startSpanId: validSpan.spanId,
          endSpanId: invalidSpan.spanId,
          keywords: new Set(['PARENT']),
          waitMode: 'start-to-start',
          bidirectional: false,
          waitTimeMs: 0
        }
      ]
    } satisfies TraceProcess;
    const [layout] = buildTraceLayouts({
      traceGraphs: [buildJSONTrace([process], [], {name: 'manual-invalid', spanLayout: 'manual'})],
      settings: baseSettings
    });
    const traceGraph = requireTraceGraph(layout!);
    const invalidSpanRef = traceGraph.getSpanRefById(invalidSpan.spanId)!;
    const visibility = getTraceLayoutSpanVisibility({
      traceLayout: layout!,
      spanRef: invalidSpanRef
    });
    const threadLayout = getLayoutThread(layout!, thread.threadId)!;

    expect(getSpanGeometry(layout!, validSpan.spanId)).toBeDefined();
    expect(getSpanGeometry(layout!, invalidSpan.spanId)).toBeUndefined();
    expect(threadLayout.visible).toBe(true);
    expect(threadLayout.manualContentHeight).toBeCloseTo(2);
    expect(visibility?.visible).toBe(false);
    expect(
      hasTraceLayoutSpanVisibilityFlag(
        visibility!.visibilityFlags,
        traceLayoutSpanVisibilityFlags.laneHidden
      )
    ).toBe(true);
    expect(getLayoutSameProcessDependencyGeometry(layout!, dependencyId)).toBeUndefined();
  });

  it('ignores thread-collapse overrides for manual threads', () => {
    const process = createRank('manual-collapse-process', 0);
    const manualSpan = {
      ...process.spans[0]!,
      layoutTopY: 0.5,
      layoutHeight: 1
    } satisfies TraceSpan;
    const manualProcess = {
      ...process,
      spans: [manualSpan],
      spanMap: {[manualSpan.spanId]: manualSpan}
    } satisfies TraceProcess;
    const graph = buildJSONTrace([manualProcess], [], {
      name: 'manual-collapse',
      spanLayout: 'manual'
    });
    const threadId = manualProcess.threads[0]!.threadId;
    const traceGraph = normalizeTraceGraphSource(graph);
    const threadRef = getRequiredThreadRef(traceGraph, threadId);
    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: baseSettings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(),
            collapsedThreadRefs: new Set([threadRef]),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });

    expect(getLayoutThread(collapsedLayout!, threadId)?.visible).toBe(true);
    expect(getLayoutThread(collapsedLayout!, threadId)?.manualContentHeight).toBe(
      getLayoutThread(expandedLayout!, threadId)?.manualContentHeight
    );
  });

  function expectHiddenSpanToHaveNoRenderGeometry(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanRef: SpanRef
  ): void {
    const target = {x1: 1, y1: 1, x2: 1, y2: 1};
    expect(fillTraceLayoutSpanGeometry({traceLayout: layout, spanRef, target})).toBe(false);
    expect(target).toEqual({x1: 0, y1: 0, x2: 0, y2: 0});
  }

  it('renders a single combined thread row when trackAggregationMode is combine-threads', () => {
    const rank = createRankWithStreams('rank-1', ['thread-a', 'thread-b']);
    const graph = buildJSONTrace([rank], [], {name: 'combined-row'});

    const [multiThreadLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [combinedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    expect(multiThreadLayout.processLayouts[0]!.threadLayouts).toHaveLength(2);
    expect(combinedLayout.processLayouts[0]!.threadLayouts).toHaveLength(1);
    expect(combinedLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(true);
    expect(combinedLayout.processLayouts[0]!.yHeight).toBeLessThan(
      multiThreadLayout.processLayouts[0]!.yHeight
    );
  });

  it('uses tighter row spacing across layout density presets', () => {
    expect(traceGeometryLayoutCommon.getLayoutDensityPreset('comfortable')).toMatchObject({
      processSeparation: 0.75,
      laneSeparation: 0.58,
      threadSeparation: 0.75,
      firstThreadTopGap: 0.5
    });
    expect(traceGeometryLayoutCommon.getLayoutDensityPreset('compact')).toMatchObject({
      processSeparation: 0.45,
      laneSeparation: 0.36,
      threadSeparation: 0.36,
      firstThreadTopGap: 0.5
    });
    expect(traceGeometryLayoutCommon.getLayoutDensityPreset('flamegraph')).toMatchObject({
      processSeparation: 0.12,
      laneSeparation: 0.36,
      threadSeparation: 0.36,
      firstThreadTopGap: 0,
      labelPadding: 0.12,
      labelMinGap: 0.08
    });
    expect(
      traceGeometryLayoutCommon.getLayoutDensityPreset('compact-spacious-processes')
    ).toMatchObject({
      processSeparation: 0.7,
      laneSeparation: 0.36,
      threadSeparation: 0.5,
      firstThreadTopGap: 0.5
    });
  });

  it('adds a density-encoded gap before the first thread except in flamegraph spacing', () => {
    const graph = createGraph('first-thread-spacing', ['rank-a']);
    const nonFlamegraphDensities = [
      'comfortable',
      'compact',
      'compact-spacious-processes',
      'ultra-compact'
    ] as const;

    nonFlamegraphDensities.forEach(layoutDensity => {
      const [layout] = buildTraceLayouts({
        traceGraphs: [graph],
        settings: {...baseSettings, layoutDensity}
      });
      const rankLayout = layout.processLayouts[0]!;
      const firstThreadLayout = rankLayout.threadLayouts.find(
        threadLayout => threadLayout.visible
      )!;
      const preset = traceGeometryLayoutCommon.getLayoutDensityPreset(layoutDensity);
      const expectedThreadLabelGap =
        traceGeometryLayoutCommon.getProcessContentStartY({
          yOffset: rankLayout.yOffset,
          layoutConfiguration: preset
        }) -
        traceGeometryLayoutCommon.getProcessLabelY({
          yOffset: rankLayout.yOffset,
          layoutConfiguration: preset
        });

      expect(firstThreadLayout.yPosition - rankLayout.labelY).toBeCloseTo(
        expectedThreadLabelGap,
        6
      );
      expect(firstThreadLayout.yPosition - rankLayout.labelY).toBeGreaterThanOrEqual(
        preset.firstThreadTopGap - 1e-9
      );
    });

    const flamegraphPreset = traceGeometryLayoutCommon.getLayoutDensityPreset('flamegraph');
    const [flamegraphLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, layoutDensity: 'flamegraph'}
    });
    const flamegraphRankLayout = flamegraphLayout.processLayouts[0]!;
    const firstFlamegraphThreadLayout = flamegraphRankLayout.threadLayouts.find(
      threadLayout => threadLayout.visible
    )!;

    expect(flamegraphPreset.firstThreadTopGap).toBe(0);
    expect(firstFlamegraphThreadLayout.yPosition - flamegraphRankLayout.labelY).toBeCloseTo(
      0.18,
      6
    );
  });

  it('keeps infinite rank background geometry and scalar content anchors', () => {
    const graph = createGraph('rank-separators', ['rank-a', 'rank-b']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const rankLayout = layout.processLayouts[1]!;

    expect(rankLayout.backgroundPolygonInfinite).toHaveLength(8);
    expect(rankLayout.backgroundPolygonInfinite[0]).toBeLessThan(0);
    expect(rankLayout.backgroundPolygonInfinite[2]).toBeGreaterThan(0);
    expect(rankLayout.labelY).toBeGreaterThanOrEqual(rankLayout.yOffset);
    expect(rankLayout.labelY).toBeLessThanOrEqual(rankLayout.contentStartY);
    expect(rankLayout.collapsedActivityY).toBeGreaterThanOrEqual(rankLayout.yOffset);
    expect(rankLayout.contentStartY).toBeGreaterThanOrEqual(rankLayout.yOffset);
    rankLayout.threadLayouts.forEach(threadLayout => {
      if (!threadLayout.visible) {
        return;
      }
      expect(threadLayout.yPosition).toBeGreaterThanOrEqual(rankLayout.yOffset);
      threadLayout.lanes?.laneYPositions.forEach(laneYPosition => {
        expect(laneYPosition).toBeGreaterThanOrEqual(rankLayout.yOffset);
      });
    });
    expect(
      Math.max(rankLayout.backgroundPolygonInfinite[5]!, rankLayout.backgroundPolygonInfinite[7]!)
    ).toBeGreaterThan(rankLayout.yOffset);
  });

  it('attaches a precomputed collapsed minimap layout to the main trace layout', () => {
    const graph = createGraph('precomputed-minimap-layout', ['rank-a', 'rank-b']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      buildMinimapLayouts: true,
      minimapTopPaddingFraction: 0.1
    });

    const minimapLayout = layout.minimapLayout;

    expect(minimapLayout).toBeDefined();
    expect(minimapLayout?.traceLayout).not.toBe(layout);
    expect(layout.renderRows.every(row => row.isCollapsed)).toBe(false);
    expect(minimapLayout?.traceLayout.renderRows.every(row => row.isCollapsed)).toBe(true);
    expect(
      minimapLayout?.traceLayout.processLayouts.every(rankLayout => rankLayout.isCollapsed)
    ).toBe(true);
    expect(minimapLayout?.bounds[0]).toEqual(minimapLayout?.traceLayout.currentBounds[0]);
    expect(minimapLayout?.bounds[1][1]).toBeGreaterThan(
      minimapLayout?.traceLayout.currentBounds[1][1] ?? 0
    );
  });

  it('keeps the combined rank label anchored inside the process band after graph-level translation', () => {
    const graph = createGraph('combined-label-anchor', ['rank-1', 'rank-2']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    const layoutConfiguration = traceGeometryLayoutCommon.getLayoutDensityPreset(
      baseSettings.layoutDensity
    );

    for (const processLayout of layout.processLayouts) {
      const firstThreadY = processLayout!.threadLayouts.reduce(
        (minThreadY, threadLayout) =>
          (threadLayout.lanes?.laneYPositions ?? [threadLayout.yPosition]).reduce(
            (minLaneY, laneYPosition) => Math.min(minLaneY, laneYPosition),
            minThreadY
          ),
        Infinity
      );
      const expectedLabelY = traceGeometryLayoutCommon.getProcessLabelY({
        yOffset: processLayout!.yOffset,
        layoutConfiguration
      });

      expect(processLayout!.labelY).toBeCloseTo(expectedLabelY, 6);
      expect(processLayout!.labelY).toBeGreaterThanOrEqual(processLayout!.yOffset);
      expect(processLayout!.labelY).toBeLessThanOrEqual(firstThreadY);
    }
  });

  it('normalizes applied rank deltas so visible process Y offsets remain non-negative', () => {
    const graph = createGraph('normalize-y', ['rank-1', 'rank-2']);
    const traceGraph = createRuntimeTraceGraph(graph);
    const processLayouts = [
      {
        processRef: getRequiredProcessRef(traceGraph, 'rank-1'),
        yOffset: 1,
        yHeight: 1,
        labelY: 1.5,
        collapsedActivityY: 1.6,
        backgroundPolygonInfinite: new Float32Array(),
        contentStartY: 1.55,
        label: 'rank-1',
        threadLayouts: [
          {
            visible: true,
            yPosition: 1.55
          } satisfies ThreadLayout
        ]
      } satisfies ProcessLayout,
      {
        processRef: getRequiredProcessRef(traceGraph, 'rank-2'),
        yOffset: 3,
        yHeight: 1,
        labelY: 3.5,
        collapsedActivityY: 3.6,
        backgroundPolygonInfinite: new Float32Array(),
        contentStartY: 3.55,
        label: 'rank-2',
        threadLayouts: [
          {
            visible: true,
            yPosition: 3.55
          } satisfies ThreadLayout
        ]
      } satisfies ProcessLayout
    ] as const;
    const layout = {
      traceGraph,
      processLayouts,
      processLayoutMapByRef: buildProcessLayoutMapByRef(processLayouts),
      renderRows: [],
      threadLayoutMapByRef: buildThreadLayoutMapByRef(traceGraph, processLayouts),
      currentBounds: [
        [0, 0],
        [10, 4]
      ]
    } satisfies TraceLayout;

    const translatedLayout = traceGeometryLayoutCommon.applyRankDeltas({
      layout,
      processes: buildTraceLayoutProcesses(traceGraph),
      rankDeltas: [-2, -2],
      trackAggregationMode: 'separate-threads'
    });

    expect(translatedLayout.processLayouts[0]!.yOffset).toBeCloseTo(0, 6);
    expect(translatedLayout.processLayouts[1]!.yOffset).toBeCloseTo(2, 6);
    expect(translatedLayout.processLayouts.every(processLayout => processLayout.yOffset >= 0)).toBe(
      true
    );
  });

  it('reuses unchanged thread layouts when applying zero rank deltas', () => {
    const rank = createRankWithStreams(
      'rank-many-zero-delta',
      Array.from({length: 2_000}, (_, index) => `Thread ${index}`)
    );
    const threadLayouts = rank.threads.map(
      (_thread, index) =>
        ({
          visible: true,
          yPosition: index
        }) satisfies ThreadLayout
    );
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([rank], [], {
        name: 'zero-delta-reuse'
      })
    );
    const processLayout = {
      processRef: getRequiredProcessRef(traceGraph, rank.processId),
      yOffset: 0,
      yHeight: threadLayouts.length,
      labelY: 0,
      collapsedActivityY: 0,
      backgroundPolygonInfinite: new Float32Array(),
      contentStartY: 0,
      label: rank.name,
      threadLayouts
    } satisfies ProcessLayout;
    const layout = {
      traceGraph,
      processLayouts: [processLayout],
      processLayoutMapByRef: buildProcessLayoutMapByRef([processLayout]),
      renderRows: [],
      threadLayoutMapByRef: buildThreadLayoutMapByRef(traceGraph, [processLayout]),
      currentBounds: [
        [0, 0],
        [10, threadLayouts.length]
      ]
    } satisfies TraceLayout;

    const translatedLayout = traceGeometryLayoutCommon.applyRankDeltas({
      layout,
      processes: buildTraceLayoutProcesses(traceGraph),
      rankDeltas: [0],
      trackAggregationMode: 'separate-threads'
    });

    expect(getLayoutThread(translatedLayout, rank.threads[0]!.threadId)).toBe(threadLayouts[0]);
    expect(getLayoutThread(translatedLayout, rank.threads.at(-1)!.threadId)).toBe(
      threadLayouts.at(-1)
    );
    expect(translatedLayout.processLayouts[0]!.threadLayouts[0]).toBe(threadLayouts[0]);
    expect(translatedLayout.processLayouts[0]!.threadLayouts.at(-1)).toBe(threadLayouts.at(-1));
  });

  it('preserves shared combine-thread layouts when applying rank deltas', () => {
    const rank = createRankWithStreams(
      'rank-many-combined-delta',
      Array.from({length: 20_000}, (_, index) => `Thread ${index}`)
    );
    const graph = buildJSONTrace([rank], [], {name: 'combined-delta-reuse'});
    const traceGraph = createRuntimeTraceGraph(graph);
    const combinedLayout = {
      visible: true,
      yPosition: 1,
      lanes: {
        laneCount: 20_000,
        isCollapsed: false,
        laneYPositions: Array.from({length: 20_000}, (_, index) => index)
      }
    } satisfies ThreadLayout;
    const processLayout = {
      processRef: getRequiredProcessRef(traceGraph, rank.processId),
      yOffset: 1,
      yHeight: 10,
      labelY: 1,
      collapsedActivityY: 1,
      backgroundPolygonInfinite: new Float32Array(),
      contentStartY: 1,
      label: rank.name,
      threadLayouts: [combinedLayout]
    } satisfies ProcessLayout;
    const layout = {
      traceGraph,
      processLayouts: [processLayout],
      processLayoutMapByRef: buildProcessLayoutMapByRef([processLayout]),
      renderRows: [],
      threadLayoutMapByRef: buildThreadLayoutMapByRef(traceGraph, [processLayout]),
      currentBounds: [
        [0, 0],
        [10, 10]
      ]
    } satisfies TraceLayout;

    let translatedLayout!: TraceLayout;
    let threadLayoutMapSetCount = 0;
    const threadLayoutMapSetSpy = vi.spyOn(Map.prototype, 'set');
    try {
      translatedLayout = traceGeometryLayoutCommon.applyRankDeltas({
        layout,
        processes: buildTraceLayoutProcesses(traceGraph),
        rankDeltas: [4],
        trackAggregationMode: 'combine-threads'
      });
      threadLayoutMapSetCount = threadLayoutMapSetSpy.mock.instances.filter(
        threadLayoutMap => threadLayoutMap === translatedLayout.threadLayoutMapByRef
      ).length;
    } finally {
      threadLayoutMapSetSpy.mockRestore();
    }
    const translatedCombinedLayout = translatedLayout.processLayouts[0]!.threadLayouts[0]!;

    // Clone source refs once, then rewrite each ref once to the translated shared layout.
    expect(threadLayoutMapSetCount).toBe(rank.threads.length * 2);
    expect(new Set(translatedLayout.threadLayoutMapByRef.values())).toHaveLength(1);
    expect(getLayoutThread(translatedLayout, rank.threads[0]!.threadId)).toBe(
      translatedCombinedLayout
    );
    expect(getLayoutThread(translatedLayout, rank.threads.at(-1)!.threadId)).toBe(
      translatedCombinedLayout
    );
    expect(translatedCombinedLayout).not.toBe(combinedLayout);
    expect(translatedCombinedLayout.yPosition).toBe(5);
    expect(translatedCombinedLayout.lanes?.laneYPositions[0]).toBe(4);
    expect(translatedCombinedLayout.lanes?.laneYPositions.at(-1)).toBe(20_003);
  }, 15_000);

  it('reuses translated lane positions for distinct combine-thread layouts', () => {
    const rank = createRankWithStreams(
      'rank-many-combined-lanes',
      Array.from({length: 2_000}, (_, index) => `Thread ${index}`)
    );
    const graph = buildJSONTrace([rank], [], {name: 'combined-lane-reuse'});
    const traceGraph = createRuntimeTraceGraph(graph);
    const sharedLaneYPositions = Array.from({length: 2_000}, (_, index) => index);
    const createCombinedThreadLayout = () =>
      ({
        visible: true,
        yPosition: 1,
        lanes: {
          laneCount: 2_000,
          isCollapsed: false,
          laneYPositions: sharedLaneYPositions
        }
      }) satisfies ThreadLayout;
    const combinedLayout = createCombinedThreadLayout();
    const processLayout = {
      processRef: getRequiredProcessRef(traceGraph, rank.processId),
      yOffset: 1,
      yHeight: 10,
      labelY: 1,
      collapsedActivityY: 1,
      backgroundPolygonInfinite: new Float32Array(),
      contentStartY: 1,
      label: rank.name,
      threadLayouts: [combinedLayout]
    } satisfies ProcessLayout;
    const sourceThreadLayoutMapByRef = new Map(
      buildTraceLayoutProcesses(traceGraph)[0]!.threadRefs.map(threadRef => [
        threadRef,
        createCombinedThreadLayout()
      ])
    );
    const layout = {
      traceGraph,
      processLayouts: [processLayout],
      processLayoutMapByRef: buildProcessLayoutMapByRef([processLayout]),
      renderRows: [],
      threadLayoutMapByRef: sourceThreadLayoutMapByRef,
      currentBounds: [
        [0, 0],
        [10, 10]
      ]
    } satisfies TraceLayout;

    const translatedLayout = traceGeometryLayoutCommon.applyRankDeltas({
      layout,
      processes: buildTraceLayoutProcesses(traceGraph),
      rankDeltas: [4],
      trackAggregationMode: 'combine-threads'
    });
    const translatedLaneYPositions =
      translatedLayout.processLayouts[0]!.threadLayouts[0]!.lanes!.laneYPositions;

    expect(translatedLaneYPositions).not.toBe(sharedLaneYPositions);
    expect(translatedLaneYPositions[0]).toBe(4);
    expect(translatedLaneYPositions.at(-1)).toBe(2_003);
    expect(
      new Set(
        [...translatedLayout.threadLayoutMapByRef.values()].map(
          threadLayout => threadLayout.lanes?.laneYPositions
        )
      )
    ).toEqual(new Set([translatedLaneYPositions]));
  });

  it('applies mask-only stream collapse in combine-threads mode without changing rank height', () => {
    const rank = createRankWithStreams('rank-combined-mask', ['thread-a', 'thread-b']);
    const graph = buildJSONTrace([rank], [], {name: 'combined-stream-mask'});
    const threadId = rank.threads[0]!.threadId;
    const traceGraph = normalizeTraceGraphSource(graph);
    const threadRef = getRequiredThreadRef(traceGraph, threadId);

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(),
            collapsedThreadRefs: new Set([threadRef]),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });

    expect(collapsedLayout.processLayouts[0]!.yHeight).toBeCloseTo(
      expandedLayout.processLayouts[0]!.yHeight,
      6
    );
    expect(getLayoutThread(collapsedLayout, threadId)!.visible).toBe(false);
    expect(getLayoutThread(collapsedLayout, rank.threads[1]!.threadId)!.visible).toBe(true);
    expect(collapsedLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(true);
    expectHiddenSpanToHaveNoRenderGeometry(
      collapsedLayout,
      getLayoutSpanRef(collapsedLayout, rank.spans[0]!.spanId)
    );
  });

  it('returns an empty layout when the visible graph has no processes', () => {
    const graph = buildJSONTrace([], [], {name: 'empty-process-layout'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    expect(layout).toBeDefined();
    expect(layout.processLayouts).toEqual([]);
    expect(layout.threadLayoutMapByRef).toEqual(new Map());
    expect(requireTraceGraph(layout).getVisibleProcessRefs()).toEqual([]);
  });

  it('builds one graph-wide combine-thread layout when a rank is appended', () => {
    const rankA = createRankWithStreams('rank-a', ['thread-a', 'thread-b']);
    const rankB = createRankWithStreams('rank-b', ['thread-c', 'thread-d']);
    const graphWithTwoRanks = buildJSONTrace([rankA, rankB], [], {name: 'reuse-two-ranks'});
    const calculateTraceLayoutSpy = vi.spyOn(traceGeometryLayoutCommon, 'calculateTraceLayout');

    const [layout] = buildTraceLayouts({
      traceGraphs: [graphWithTwoRanks],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    expect(calculateTraceLayoutSpy).toHaveBeenCalledTimes(1);
    expect(layout.renderRows.map(row => row.processId)).toEqual(['rank-a', 'rank-b']);
    calculateTraceLayoutSpy.mockRestore();
  });
});
