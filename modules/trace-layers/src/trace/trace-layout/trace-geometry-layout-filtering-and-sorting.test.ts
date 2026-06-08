import {describe, expect, it, vi} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from '../ingestion/json-trace';
import {buildJSONTraceFromRunSummary} from '../test-stubs/build-trace-graph-from-run-summary';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {
  getArrowTraceSpanMaterializationCount,
  resetArrowTraceSpanMaterializationCount
} from '../trace-graph-accessors';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  getRequiredThreadRef,
  getTraceGraphSpanDependencies as getSpanDependencies,
  getTraceGraphEndpointsWithDependencies,
  getTraceGraphVisibleDependencyChainForBlock,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {
  buildTraceLayouts as buildRuntimeTraceLayouts,
  rebuildTraceLayoutGeometry as rebuildRuntimeTraceLayoutGeometry
} from '../trace-layout/trace-geometry-layout';
import * as traceGeometryLayoutCommon from '../trace-layout/trace-geometry-layout-common';
import {
  deserializeTraceGraphCollapseState,
  fillTraceLayoutCrossDependencyGeometry
} from '../trace-layout/trace-layout';

import type {JSONTrace} from '../ingestion/json-trace';
import type {StarlingV2RunSummary} from '../test-stubs/run-summary-v2';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayout, TraceLayoutCollapseState} from '../trace-layout/trace-layout';

function createTestTraceGraph(
  traceGraphData: Parameters<typeof createStaticTraceGraphRuntimeSource>[0]['traceGraphData'],
  options?: ConstructorParameters<typeof TraceGraph>[1]
): TraceGraph {
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: `${traceGraphData.name}:test`,
      traceGraphData
    }),
    options
  );
}

describe('buildTraceLayouts filtering and sorting', () => {
  type TestTraceGraphSource = Parameters<typeof buildRuntimeTraceLayouts>[0]['traceGraphs'][number];
  type TestCollapseIdInputs = {
    collapsedProcessIds?: ReadonlySet<string>;
    expandedThreadIds?: ReadonlySet<TraceThreadId>;
    collapsedThreadIds?: ReadonlySet<TraceThreadId>;
  };

  function normalizeTraceGraphSource(
    traceGraph: JSONTrace | TestTraceGraphSource
  ): TestTraceGraphSource {
    return (
      'processSpanTableMap' in traceGraph
        ? traceGraph
        : buildTraceGraphDataFromJSONTrace(traceGraph)
    ) as TestTraceGraphSource;
  }

  function buildTraceLayouts(
    params: Omit<Parameters<typeof buildRuntimeTraceLayouts>[0], 'traceGraphs'> &
      TestCollapseIdInputs & {
        traceGraphs: ReadonlyArray<JSONTrace | TestTraceGraphSource>;
      }
  ) {
    const {collapsedProcessIds, collapsedThreadIds, expandedThreadIds, traceGraphs, ...options} =
      params;
    const normalizedTraceGraphs = traceGraphs.map(normalizeTraceGraphSource);
    return buildRuntimeTraceLayouts({
      ...options,
      collapseState:
        options.collapseState ??
        buildTestCollapseState(normalizedTraceGraphs, {
          collapsedProcessIds,
          collapsedThreadIds,
          expandedThreadIds
        }),
      traceGraphs: normalizedTraceGraphs
    });
  }

  function buildTestCollapseState(
    traceGraphs: readonly TestTraceGraphSource[],
    inputs: TestCollapseIdInputs
  ): TraceLayoutCollapseState | undefined {
    if (
      inputs.collapsedProcessIds === undefined &&
      inputs.collapsedThreadIds === undefined &&
      inputs.expandedThreadIds === undefined
    ) {
      return undefined;
    }
    return {
      graphs: traceGraphs.map(traceGraph =>
        deserializeTraceGraphCollapseState(createTestTraceGraph(traceGraph), {
          collapsedProcessIds: [...(inputs.collapsedProcessIds ?? [])],
          collapsedThreadIds: [...(inputs.collapsedThreadIds ?? [])],
          expandedThreadIds: [...(inputs.expandedThreadIds ?? [])]
        })
      )
    };
  }

  function rebuildTraceLayoutGeometry(
    params: Omit<Parameters<typeof rebuildRuntimeTraceLayoutGeometry>[0], 'traceGraph'> & {
      traceGraph: JSONTrace | TraceGraph;
    }
  ) {
    return rebuildRuntimeTraceLayoutGeometry({
      ...params,
      traceGraph:
        params.traceGraph instanceof TraceGraph
          ? params.traceGraph
          : normalizeTraceGraphSource(params.traceGraph)
    });
  }

  /** Builds a focused trace layout for a selected set of span refs in tests. */

  function createRuntimeTraceGraph(
    traceGraph: JSONTrace,
    options?: ConstructorParameters<typeof TraceGraph>[1]
  ) {
    return createTestTraceGraph(buildTraceGraphDataFromJSONTrace(traceGraph), options);
  }

  function requireTraceGraph(layout: {traceGraph?: TraceGraph}) {
    expect(layout.traceGraph).toBeDefined();
    return layout.traceGraph!;
  }

  function getCrossGeometry(
    layout: TraceLayout,
    dependencyId: TraceDependencyId
  ): Float32Array | undefined {
    const dependencyRef = requireTraceGraph(layout).getVisibleCrossDependencyRefById(dependencyId);
    if (dependencyRef == null) {
      return undefined;
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    return fillTraceLayoutCrossDependencyGeometry({
      traceLayout: layout,
      dependencyRef,
      target: geometry
    })
      ? new Float32Array([geometry.x1, geometry.y1, geometry.x2, geometry.y2])
      : undefined;
  }

  function getVisibleSpans(spans: readonly TraceSpan[], traceGraph: TraceGraph): TraceSpan[] {
    return spans.filter(span => !isTraceGraphBlockFiltered(traceGraph, span));
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
      localDependencyIds: [],
      localDependencies: [],
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
      localDependencies: [],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  function createCrossDependency(params: {
    dependencyId: TraceDependencyId;
    startSpanId: TraceSpanId;
    endSpanId: TraceSpanId;
    startRankNum: number;
    endRankNum: number;
    waitMode?: 'end-to-start' | 'end-to-end' | 'start-to-start';
    topology?: string;
    keywords?: Set<string>;
  }): TraceCrossProcessDependency {
    return {
      type: 'trace-cross-process-dependency',
      dependencyId: params.dependencyId,
      endpointId: `${params.dependencyId}:endpoint` as TraceCrossProcessEndpointId,
      startRankNum: params.startRankNum,
      endRankNum: params.endRankNum,
      startSpanId: params.startSpanId,
      endSpanId: params.endSpanId,
      waitMode: params.waitMode ?? 'start-to-start',
      bidirectional: false,
      topology: params.topology ?? 'cross',
      waitTimeMs: 0,
      waiting: false,
      waitNotFinished: false,
      keywords: params.keywords ?? new Set()
    };
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
      localDependencyIds: [],
      localDependencies: [],
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
      localDependencies: [],
      remoteDependencies: [],
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])) as Record<
        string,
        TraceThread
      >
    } satisfies TraceProcess;
  }

  /**
   * Builds a rank whose stream ids intentionally match ids used by other ranks.
   */

  function createNamedRank(
    processId: string,
    blockNames: string[],
    options?: {sources?: readonly string[]; rankNum?: number}
  ): TraceProcess {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: `${processId}-stream`,
      threadId: `${processId}-stream` as TraceThreadId,
      processId
    };

    const spans: TraceSpan[] = blockNames.map((name, index) => ({
      type: 'trace-span',
      spanId: `${processId}-span-${index}` as TraceSpanId,
      threadId: thread.threadId,
      processName: processId,
      name,
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
      localDependencyIds: [],
      localDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: [],
      ...(options?.sources?.[index] !== undefined
        ? {userData: {source: options.sources[index]!}}
        : {})
    }));

    return {
      type: 'trace-process',
      processId,
      name: processId,
      rankNum: options?.rankNum ?? 0,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread},
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
        string,
        TraceSpan
      >,
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  function addLocalDependency(
    rank: TraceProcess,
    params: {
      dependencyId: TraceDependencyId;
      startSpanId: TraceSpanId;
      endSpanId: TraceSpanId;
      keywords?: Set<string>;
    }
  ): TraceProcess {
    const localDependency = {
      type: 'trace-local-dependency',
      dependencyId: params.dependencyId,
      startSpanId: params.startSpanId,
      endSpanId: params.endSpanId,
      keywords: params.keywords ?? new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    } satisfies TraceProcess['localDependencies'][number];

    return {
      ...rank,
      localDependencies: [...rank.localDependencies, localDependency],
      spans: rank.spans.map(span =>
        span.spanId === localDependency.startSpanId || span.spanId === localDependency.endSpanId
          ? {
              ...span,
              localDependencyIds: [...span.localDependencyIds, localDependency.dependencyId]
            }
          : span
      ),
      spanMap: Object.fromEntries(
        rank.spans.map(span => {
          const nextBlock =
            span.spanId === localDependency.startSpanId || span.spanId === localDependency.endSpanId
              ? {
                  ...span,
                  localDependencyIds: [...span.localDependencyIds, localDependency.dependencyId]
                }
              : span;
          return [nextBlock.spanId, nextBlock];
        })
      ) as Record<string, TraceSpan>
    } satisfies TraceProcess;
  }

  function createRankWithParentChain(processId: string, blockNames: string[]): TraceProcess {
    const rank = createNamedRank(processId, blockNames);
    const localDependencies: TraceProcess['localDependencies'] = [];

    for (let index = 1; index < rank.spans.length; index += 1) {
      const parentBlock = rank.spans[index - 1];
      const childBlock = rank.spans[index];
      if (!parentBlock || !childBlock) {
        continue;
      }

      const dependencyId = `${processId}:parent-${index}` as TraceDependencyId;
      const dependency: TraceProcess['localDependencies'][number] = {
        type: 'trace-local-dependency',
        dependencyId,
        startSpanId: parentBlock.spanId,
        endSpanId: childBlock.spanId,
        keywords: new Set(['PARENT']),
        waitMode: 'start-to-start',
        bidirectional: false,
        waitTimeMs: 0
      };

      parentBlock.localDependencyIds.push(dependencyId);
      localDependencies.push(dependency);
    }

    return {
      ...rank,
      localDependencies
    } satisfies TraceProcess;
  }

  const baseSettings: Pick<
    TraceVisSettings,
    | 'showCrossProcessDependencies'
    | 'threadDisplayMode'
    | 'selectedThreadNames'
    | 'sortThreads'
    | 'localDependencyMode'
    | 'layoutDensity'
    | 'maxVisibleLanesPerThread'
    | 'processLayoutMode'
    | 'trackAggregationMode'
  > = {
    showCrossProcessDependencies: true,
    threadDisplayMode: 'all',
    selectedThreadNames: undefined,
    sortThreads: false,
    localDependencyMode: 'all',
    processLayoutMode: 'interleaved',
    layoutDensity: 'comfortable',
    maxVisibleLanesPerThread: undefined,
    trackAggregationMode: 'separate-threads'
  };

  function createHeadToLogicalSummary(): StarlingV2RunSummary {
    const baseStartUs = Date.parse('2023-01-01T00:00:00.000Z') * 1000;
    return {
      run_id: 'run-1',
      execution_id: 'exec-1',
      resolution: 'full',
      main_client_span_id: 1n,
      metadata: {
        main_client: {
          namespace: 'ns',
          pod: 'pod-1',
          brix_pool: 'pool',
          cluster: 'cluster'
        },
        projections: {primary: 'latest', supported: []}
      },
      head_processes: [
        {
          pod_id: 'pod-1',
          pid: 11,
          role: 'head',
          threads: [{tid: 1, thread_name: 'head-thread'}]
        }
      ],
      head_spans: [
        {
          trace_id: 1n,
          span_id: 900n,
          name: 'head-parent',
          namespace: 'ns',
          start_us: baseStartUs,
          end_us: baseStartUs + 1_000_000,
          pod_id: 'pod-1',
          pid: 11,
          tid: 1
        }
      ],
      logical_processes: [
        {
          logical_process_id: 1,
          name: 'Proc A',
          threads: [{logical_thread_id: 1, normalized_thread_name: 'Thread A'}]
        }
      ],
      logical_spans: [
        {
          logical_span_id: 101n,
          path: 'path',
          trace_id: 1n,
          span_name: 'logical-child',
          template: {
            span_id: 101n,
            name: 'logical-child',
            namespace: 'ns',
            start_us: baseStartUs + 2_000_000,
            end_us: baseStartUs + 3_000_000,
            trace_id: 1n,
            pod_id: 'pod-1',
            pid: 11
          },
          projections: {
            envelope: {
              start_us: baseStartUs + 2_000_000,
              end_us: baseStartUs + 3_000_000
            }
          },
          logical_process_id: 1,
          logical_thread_id: 1,
          parent: {logical: false, span_id: 900n}
        }
      ]
    };
  }

  it('sorts streams only in layout when sortThreads is enabled', () => {
    const rank = createRankWithStreams('rank-1', ['Thread 10', 'Thread 2']);
    const graph = buildJSONTrace([rank], [], {name: 'A'});

    const [unsortedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, sortThreads: false}
    });

    const [sortedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, sortThreads: true}
    });

    const [firstThread, secondThread] = rank.threads;
    const unsortedFirstY = unsortedLayout.threadLayoutMap[firstThread!.threadId].yPosition;
    const unsortedSecondY = unsortedLayout.threadLayoutMap[secondThread!.threadId].yPosition;
    const sortedFirstY = sortedLayout.threadLayoutMap[firstThread!.threadId].yPosition;
    const sortedSecondY = sortedLayout.threadLayoutMap[secondThread!.threadId].yPosition;

    expect(unsortedFirstY).toBeLessThan(unsortedSecondY);
    expect(sortedFirstY).toBeGreaterThan(sortedSecondY);
  });

  it('preserves sorted process thread order while keeping threadLayoutMap keyed by stream id', () => {
    const rank = createRankWithStreams('rank-order', ['Thread 10', 'Thread 2', 'Thread 1']);
    const graph = buildJSONTrace([rank], [], {name: 'sorted-order'});
    const expectedThreadOrder = [...rank.threads].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {numeric: true})
    );

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        sortThreads: true
      }
    });

    expectedThreadOrder.forEach((thread, index) => {
      expect(layout.processLayouts[0]!.threadLayouts[index]).toBe(
        layout.threadLayoutMap[thread.threadId]
      );
    });
  });

  it('preserves threadLayoutMapByRef alignment when sortThreads reorders thread layouts', () => {
    const rank = createRankWithStreams('rank-ref-order', ['Thread 10', 'Thread 2', 'Thread 1']);
    const graph = buildJSONTrace([rank], [], {name: 'sorted-ref-order'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        sortThreads: true
      }
    });

    expect(layout.traceGraph).toBeInstanceOf(TraceGraph);

    for (const thread of rank.threads) {
      const threadRef = getRequiredThreadRef(layout.traceGraph!, thread.threadId);
      expect(layout.threadLayoutMapByRef?.get(threadRef)).toBe(
        layout.threadLayoutMap[thread.threadId]
      );
    }
  });

  it('keeps thread ref indexes linear with many sorted separate-thread rows', () => {
    const streamNames = Array.from({length: 2_000}, (_, index) => `Thread ${2_000 - index}`);
    const rank = createRankWithStreams('rank-many-ref-order', streamNames);
    const graph = buildJSONTrace([rank], [], {name: 'many-sorted-ref-order'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        sortThreads: true
      }
    });

    expect(layout.traceGraph).toBeInstanceOf(TraceGraph);
    expect(layout.processLayouts[0]!.threadLayouts).toHaveLength(streamNames.length);

    for (const thread of rank.threads) {
      const threadRef = getRequiredThreadRef(layout.traceGraph!, thread.threadId);
      expect(layout.threadLayoutMapByRef?.get(threadRef)).toBe(
        layout.threadLayoutMap[thread.threadId]
      );
    }
  });

  it('maps all thread refs to the combined layout in combine-threads mode', () => {
    const streamNames = Array.from({length: 2_000}, (_, index) => `Thread ${index}`);
    const rank = createRankWithStreams('rank-many-combined-ref-order', streamNames);
    const graph = buildJSONTrace([rank], [], {name: 'many-combined-ref-order'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'combine-threads',
        sortThreads: true
      }
    });
    const combinedLayout = layout.processLayouts[0]!.threadLayouts[0]!;

    expect(layout.processLayouts[0]!.threadLayouts).toHaveLength(1);
    for (const thread of rank.threads) {
      const threadRef = getRequiredThreadRef(layout.traceGraph!, thread.threadId);
      expect(layout.threadLayoutMapByRef?.get(threadRef)).toBe(combinedLayout);
    }
  });

  it('sorts rendered process rows by rankNum instead of input load order', () => {
    const rankTen = createRank('rank-10', 10, 10);
    const rankTwo = createRank('rank-2', 2, 2);
    const rankSeven = createRank('rank-7', 7, 7);
    const graph = buildJSONTrace([rankTen, rankTwo, rankSeven], [], {name: 'ranknum-order'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    expect(layout.renderRows.map(row => row.processId)).toEqual(['rank-2', 'rank-7', 'rank-10']);
    expect(layout.renderRows.map(row => row.rankNum)).toEqual([2, 7, 10]);
    expect(layout.processLayouts.map(processLayout => processLayout.label)).toEqual([
      'rank-2',
      'rank-7',
      'rank-10'
    ]);
  });

  it('keeps filtered-out streams hidden in threadLayouts without consuming rank spacing', () => {
    const firstRank = createRankWithStreams('rank-filtered', ['selected', 'filtered']);
    firstRank.rankNum = 0;
    const secondRank = createRank('rank-next', 1, 30);
    secondRank.threads[0]!.name = 'selected';
    const graph = buildJSONTrace([firstRank, secondRank], [], {name: 'filtered-streams'});

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        threadDisplayMode: 'selected',
        selectedThreadNames: ['selected']
      }
    });

    const hiddenStreamId = firstRank.threads[1]!.threadId;
    expect(filteredLayout.threadLayoutMap[hiddenStreamId]!.visible).toBe(false);
    expect(filteredLayout.threadLayoutMap[hiddenStreamId]!.yPosition).toBe(-1000);
    expect(filteredLayout.threadLayoutMap[hiddenStreamId]!.lanes?.laneYPositions).toEqual([]);
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeLessThan(
      expandedLayout.processLayouts[1]!.yOffset
    );
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
  });

  it('precomputes overflow label text with per-thread filtered span counts', () => {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'overflow-thread',
      threadId: 'overflow-thread-id' as TraceThreadId,
      processId: 'rank-overflow'
    };

    const spans: TraceSpan[] = [];
    for (let index = 0; index <= 31; index += 1) {
      const spanId = `overflow-span-${index}` as TraceSpanId;
      spans.push({
        type: 'trace-span',
        spanId,
        threadId: thread.threadId,
        processName: 'rank-overflow',
        name: index === 0 ? 'filtered-overflow-span' : spanId,
        keywords: [],
        primaryTimingKey: 'test',
        timings: {
          test: {
            status: 'finished',
            startTimeMs: 0,
            endTimeMs: 10,
            durationMs: 10,
            durationMsAsString: '10ms'
          }
        },
        localDependencyIds: [],
        localDependencies: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: []
      });
    }

    const rank: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-overflow',
      name: 'rank-overflow',
      rankNum: 0,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread} as Record<string, TraceThread>,
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
        string,
        TraceSpan
      >,
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: [],
      userData: {}
    };

    const graph = buildJSONTrace([rank], [], {name: 'overflow-filtered'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesUnlimited: false,
        spanFilter: 'filtered'
      }
    });

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabel?.text).toBe(
      '2 deeper spans hidden, 1 span filtered in thread overflow-thread'
    );
  });

  it('shows a filtered-span label even when no deeper lanes are hidden', () => {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'filtered-only-thread',
      threadId: 'filtered-only-thread-id' as TraceThreadId,
      processId: 'rank-filtered-only'
    };

    const spans: TraceSpan[] = [0, 1].map(index => ({
      type: 'trace-span',
      spanId: `filtered-only-span-${index}` as TraceSpanId,
      threadId: thread.threadId,
      processName: 'rank-filtered-only',
      name: index === 0 ? 'filtered-span' : 'visible-span',
      keywords: [],
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished',
          startTimeMs: index * 2,
          endTimeMs: index * 2 + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      localDependencyIds: [],
      localDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    }));

    const rank: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-filtered-only',
      name: 'rank-filtered-only',
      rankNum: 0,
      stepNum: 0,
      threads: [thread],
      threadMap: {[thread.threadId]: thread} as Record<string, TraceThread>,
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
        string,
        TraceSpan
      >,
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: [],
      userData: {}
    };

    const graph = buildJSONTrace([rank], [], {name: 'filtered-only-label'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        spanFilter: 'filtered'
      }
    });

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabel?.text).toBe(
      '1 span filtered in thread filtered-only-thread'
    );
  });

  it('precomputes combined-thread overflow label text with summed filtered span counts', () => {
    const threads: TraceThread[] = [
      {
        type: 'trace-thread',
        name: 'overflow-thread-a',
        threadId: 'overflow-thread-a' as TraceThreadId,
        processId: 'rank-overflow'
      },
      {
        type: 'trace-thread',
        name: 'overflow-thread-b',
        threadId: 'overflow-thread-b' as TraceThreadId,
        processId: 'rank-overflow'
      }
    ];

    const spans: TraceSpan[] = [];
    for (const [threadIndex, thread] of threads.entries()) {
      for (let index = 0; index < 17; index += 1) {
        const spanId = `combined-overflow-span-${threadIndex}-${index}` as TraceSpanId;
        spans.push({
          type: 'trace-span',
          spanId,
          threadId: thread.threadId,
          processName: 'rank-overflow',
          name: index === 0 ? `filtered-${spanId}` : spanId,
          keywords: [],
          primaryTimingKey: 'test',
          timings: {
            test: {
              status: 'finished',
              startTimeMs: 0,
              endTimeMs: 10,
              durationMs: 10,
              durationMsAsString: '10ms'
            }
          },
          localDependencyIds: [],
          localDependencies: [],
          crossProcessEndpointId: null,
          crossProcessDependencyEndpoints: []
        });
      }
    }

    const rank: TraceProcess = {
      type: 'trace-process',
      processId: 'rank-overflow',
      name: 'rank-overflow',
      rankNum: 0,
      stepNum: 0,
      threads,
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])) as Record<
        string,
        TraceThread
      >,
      spans,
      spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])) as Record<
        string,
        TraceSpan
      >,
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies: [],
      remoteDependencies: [],
      userData: {}
    };

    const graph = buildJSONTrace([rank], [], {name: 'overflow-filtered-combined'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'combine-threads',
        maxVisibleLanesUnlimited: false,
        spanFilter: 'filtered'
      }
    });

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabel?.text).toBe(
      '3 deeper spans hidden, 2 spans filtered in thread all threads'
    );
  });

  it('scans filtered span counts when an active filter can produce a visible label', () => {
    const getFilteredSpanCountByThreadRefSpy = vi.spyOn(
      TraceGraph.prototype,
      'getFilteredSpanCountByThreadRef'
    );
    const rank = createNamedRank('rank-filtered-count-scan', ['filtered-span', 'visible']);
    const graph = buildJSONTrace([rank], [], {name: 'filtered-count-scan'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        spanFilter: 'filtered'
      }
    });

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabel?.text).toBe(
      '1 span filtered in thread rank-filtered-count-scan-stream'
    );
    expect(getFilteredSpanCountByThreadRefSpy).toHaveBeenCalled();
    getFilteredSpanCountByThreadRefSpy.mockRestore();
  });

  it('uses Arrow-native filtered layout sources for combine-threads without changing layout output', () => {
    const rank = createRank('rank-filtered-combined', 0, 0);
    const graph = buildJSONTrace([rank], [], {name: 'filtered-combined-arrow-layout'});
    const settings: Parameters<typeof buildTraceLayouts>[0]['settings'] = {
      ...baseSettings,
      trackAggregationMode: 'combine-threads',
      spanFilter: rank.spans[0]!.name
    };
    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: [rank.spans[0]!.name]
    });
    const getVisibleProcessLayoutBlocksSpy = vi.spyOn(traceGraph, 'getVisibleProcessLayoutBlocks');
    const getVisibleLocalDependencyLayoutSourcesSpy = vi.spyOn(
      traceGraph,
      'getVisibleLocalDependencyLayoutSources'
    );

    const [baselineLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings
    });
    const [arrowNativeLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      prebuiltTraceGraphs: [traceGraph],
      settings
    });

    expect(getVisibleProcessLayoutBlocksSpy).toHaveBeenCalled();
    expect(getVisibleLocalDependencyLayoutSourcesSpy).not.toHaveBeenCalled();
    expect(arrowNativeLayout.threadLayoutMap).toEqual(baselineLayout.threadLayoutMap);
    expect(arrowNativeLayout.overflowLabels).toEqual(baselineLayout.overflowLabels);
    expect(arrowNativeLayout.renderRows).toEqual(baselineLayout.renderRows);
    expect(arrowNativeLayout.currentBounds).toEqual(baselineLayout.currentBounds);
    expect(arrowNativeLayout.expandedBounds).toEqual(baselineLayout.expandedBounds);

    getVisibleProcessLayoutBlocksSpy.mockRestore();
    getVisibleLocalDependencyLayoutSourcesSpy.mockRestore();
  });

  it('does not materialize compatibility TraceSpans during filtered layout or geometry rebuild', () => {
    const rank = createRank('rank-filtered-no-span-materialization', 0, 0);
    const graph = buildJSONTrace([rank], [], {name: 'filtered-no-span-materialization'});
    const traceGraph = createRuntimeTraceGraph(graph, {
      spanFilters: [rank.spans[0]!.name]
    });
    const settings: Parameters<typeof buildTraceLayouts>[0]['settings'] = {
      ...baseSettings,
      trackAggregationMode: 'combine-threads',
      spanFilter: rank.spans[0]!.name
    };

    resetArrowTraceSpanMaterializationCount();
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      prebuiltTraceGraphs: [traceGraph],
      settings
    });
    expect(getArrowTraceSpanMaterializationCount()).toBe(0);

    resetArrowTraceSpanMaterializationCount();
    rebuildTraceLayoutGeometry({
      traceGraph,
      prebuiltTraceGraph: traceGraph,
      traceLayout: layout!,
      settings: {
        localDependencyMode: settings.localDependencyMode,
        layoutDensity: settings.layoutDensity
      }
    });
    expect(getArrowTraceSpanMaterializationCount()).toBe(0);
  });

  it('renders collapsed endpoint below process activity overview when peer is below', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:0' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'collapsed-cross'});
    const materializedGraph = materializeJSONTrace(graph);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([rankA.processId])
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(layout.processLayouts[0]!.collapsedActivityY + 0.2, 6);
    expect(geometry[0]).toBeCloseTo(
      rankA.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
    expect(geometry[2]).toBeCloseTo(
      rankB.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
    expect(geometry[3]).toBeCloseTo(
      layout.threadLayoutMap[rankB.threads[0]!.threadId].yPosition,
      6
    );
  });

  it('anchors dependency endpoints from above slightly above collapsed activity overview', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:from-above' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {
      name: 'collapsed-cross-from-above'
    });
    const materializedGraph = materializeJSONTrace(graph);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([rankB.processId])
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    const collapsedY = layout.processLayouts[1]!.collapsedActivityY;
    expect(geometry[3]).toBeCloseTo(collapsedY - 0.2, 6);
    expect(geometry[0]).toBeCloseTo(
      rankA.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
    expect(geometry[2]).toBeCloseTo(
      rankB.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
  });

  it('renders cross-rank dependencies between two collapsed processes at both collapsedActivityY values', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:1' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {
      name: 'collapsed-cross-both'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([rankA.processId, rankB.processId])
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(layout.processLayouts[0]!.collapsedActivityY + 0.2, 6);
    expect(geometry[3]).toBeCloseTo(layout.processLayouts[1]!.collapsedActivityY - 0.2, 6);
  });

  it('renders cross-rank dependencies from a collapsed combined-thread process using collapsedActivityY', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:combined-threads' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {
      name: 'collapsed-combined-thread-cross'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapsedProcessIds: new Set([rankA.processId])
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(layout.processLayouts[0]!.isCollapsed).toBe(true);
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(layout.processLayouts[0]!.collapsedActivityY + 0.2, 6);
    expect(geometry[3]).toBeCloseTo(
      layout.threadLayoutMap[rankB.threads[0]!.threadId].yPosition,
      6
    );
  });

  it('preserves head-to-logical cross-rank dependency geometry when the logical process is collapsed in combine-threads', () => {
    const graph = buildJSONTraceFromRunSummary(createHeadToLogicalSummary());
    const logicalProcess = graph.processes.find(process => process.name === 'Proc A');
    const dependency = graph.crossDependencies?.[0];

    expect(logicalProcess).toBeDefined();
    expect(dependency).toBeDefined();

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapsedProcessIds: new Set([logicalProcess!.processId])
    });

    const geometry = getCrossGeometry(layout, dependency!.dependencyId)!;
    expect(layout.processLayouts[logicalProcess!.rankNum]!.isCollapsed).toBe(true);
    expect(geometry.length).toBe(4);
    expect(geometry[3]).toBeCloseTo(
      layout.processLayouts[logicalProcess!.rankNum]!.collapsedActivityY - 0.2,
      6
    );
  });

  it('preserves head-to-logical cross-rank dependency geometry when the head process is collapsed in combine-threads', () => {
    const graph = buildJSONTraceFromRunSummary(createHeadToLogicalSummary());
    const headProcess = graph.processes.find(process =>
      String(process.userData?.role ?? '').includes('head')
    );
    const dependency = graph.crossDependencies?.[0];

    expect(headProcess).toBeDefined();
    expect(dependency).toBeDefined();

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapsedProcessIds: new Set([headProcess!.processId])
    });

    const geometry = getCrossGeometry(layout, dependency!.dependencyId)!;
    expect(layout.processLayouts[headProcess!.rankNum]!.isCollapsed).toBe(true);
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(
      layout.processLayouts[headProcess!.rankNum]!.collapsedActivityY + 0.2,
      6
    );
  });

  it('anchors dependency endpoint below collapsed activity overview when peer is above', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:3' as TraceDependencyId,
      startSpanId: rankB.spans[0]!.spanId,
      endSpanId: rankA.spans[0]!.spanId,
      startRankNum: 1,
      endRankNum: 0,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {
      name: 'collapsed-cross-below'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([rankA.processId])
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    const collapsedY = layout.processLayouts[0]!.collapsedActivityY;
    expect(geometry[3]).toBeCloseTo(collapsedY + 0.2, 6);
    const materializedGraph = materializeJSONTrace(graph);
    expect(geometry[0]).toBeCloseTo(
      rankB.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
    expect(geometry[2]).toBeCloseTo(
      rankA.spans[0]!.timings.test.startTimeMs - materializedGraph.minTimeMs,
      6
    );
  });

  it('filters spans by delimiter-separated literal prefixes', () => {
    const rank = createNamedRank('filter-names', ['executeRpc', 'fetchQuery', 'renderUi']);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-list'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'executeRpc;\nfetchQuery, keepMe'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph).map(span => span.name)).toEqual(['renderUi']);
  });

  it('treats plain span filter entries as literal prefix patterns', () => {
    const rank = createNamedRank('filter-prefix', [
      'rpc.request_worker',
      'other_rpc.request',
      'rpc'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-prefix'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'rpc.request_'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph).map(span => span.name)).toEqual([
      'other_rpc.request',
      'rpc'
    ]);
  });

  it('filters spans by userData.source prefix', () => {
    const rank = createNamedRank('filter-source', ['executeRpc', 'fetchQuery', 'renderUi'], {
      sources: [
        'packages/distributed_tracing/base.py',
        '/root/code/example/lib/starling_core/starling_core/core/rpc_runtime.py',
        'other/file.py'
      ]
    });
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-source'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        spanFilter:
          'packages/distributed_tracing/base.py;/root/code/example/lib/starling_core/starling_core/core/rpc_runtime.py'
      }
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph).map(span => span.name)).toEqual(['renderUi']);
  });

  it('supports regular-expression span filters', () => {
    const rank = createNamedRank('filter-regex', ['executeRpc-1', 'executeRpc-2', 'other']);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-regex'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: '/^executeRpc-\\d+$/'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph).map(span => span.name)).toEqual(['other']);
  });

  it('rewires parent dependencies to the nearest visible ancestor', () => {
    const rank = createRankWithParentChain('filter-ancestor', [
      'rpc-root',
      'filtered-parent',
      'filtered-child',
      'child-leaf'
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-ancestor'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph).map(span => span.name)).toEqual([
      'rpc-root',
      'child-leaf'
    ]);

    const visibleParentChain = getTraceGraphVisibleDependencyChainForBlock(
      traceGraph,
      rank.spans[3]!,
      'PARENT'
    );
    expect(visibleParentChain.map(span => span.name)).toEqual(['rpc-root']);

    const childDependencies = getSpanDependencies(traceGraph, rank.spans[3]!);
    expect(childDependencies.localDependencies).toHaveLength(1);
    expect(childDependencies.localDependencies[0]).toMatchObject({
      startSpanId: rank.spans[0]!.spanId,
      endSpanId: rank.spans[3]!.spanId
    });
  });

  it('skips local dependency geometry generation when an endpoint span is missing', () => {
    const dependencyGeometryMap: Record<TraceDependencyId, Float32Array> = {};

    traceGeometryLayoutCommon.buildTraceLocalDependencyGeometries({
      localDependencies: [
        {
          type: 'trace-local-dependency',
          dependencyId: 'dep-missing-start' as TraceDependencyId,
          startSpanId: 'missing-start' as TraceSpanId,
          endSpanId: 'visible-end' as TraceSpanId,
          keywords: new Set(),
          waitMode: 'start-to-start',
          bidirectional: false,
          waitTimeMs: 0
        }
      ],
      spanMap: {
        'visible-end': {
          spanId: 'visible-end' as TraceSpanId,
          threadId: 'visible-stream' as TraceThreadId,
          primaryTimingKey: 'test',
          timings: {
            test: {
              status: 'finished',
              startTimeMs: 0,
              endTimeMs: 1,
              durationMs: 1,
              durationMsAsString: '1ms'
            }
          }
        }
      },
      maxTimeMs: 1,
      minTimeMs: 0,
      threadLayoutMap: {},
      dependencyGeometryMap,
      settings: {}
    });

    expect(dependencyGeometryMap).toEqual({});
  });

  it('contracts a mixed cross/local parent chain into a cross dependency', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createNamedRank('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-1' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'mixed-cross-local'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChild = rankB.spans[1]!;
    const logicalChildDependencies = getSpanDependencies(traceGraph, logicalChild);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId,
      topology: 'parent'
    });
    expect(logicalChildDependencies.localDependencies).toHaveLength(0);

    const endpointsWithDeps = getTraceGraphEndpointsWithDependencies(traceGraph, logicalChild);
    expect(endpointsWithDeps).toHaveLength(1);
    expect(endpointsWithDeps[0]?.[1]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId
    });
  });

  it('contracts a mixed local/cross parent chain when the filtered node is on the start side of the cross edge', () => {
    const rankABase = createNamedRank('rank-a', ['head-root', 'filtered-head'], {
      rankNum: 0
    });
    const rankA = addLocalDependency(rankABase, {
      dependencyId: 'rank-a:parent-1' as TraceDependencyId,
      startSpanId: rankABase.spans[0]!.spanId,
      endSpanId: rankABase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const rankB = createNamedRank('rank-b', ['logical-child'], {rankNum: 1});
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-2' as TraceDependencyId,
      startSpanId: rankA.spans[1]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'mixed-local-cross'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getSpanDependencies(traceGraph, rankB.spans[0]!);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      topology: 'parent'
    });
    expect(
      getTraceGraphVisibleDependencyChainForBlock(traceGraph, rankB.spans[0]!, 'PARENT').map(
        span => span.name
      )
    ).toEqual(['head-root']);
  });

  it('drops a cross parent dependency when the filtered child has no visible descendant', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankB = createNamedRank('rank-b', ['filtered-leaf'], {rankNum: 1});
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-3' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'cross-leaf-drop'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const rootDependencies = getSpanDependencies(traceGraph, rankA.spans[0]!);
    expect(rootDependencies.outDependencies).toHaveLength(0);
  });

  it('does not promote non-parent local dependencies across ranks', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createNamedRank('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:dep-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-4' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'non-parent-local'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getSpanDependencies(traceGraph, rankB.spans[1]!);
    expect(logicalChildDependencies.inDependencies).toHaveLength(0);
  });

  it('deduplicates stitched parent edges that collapse to the same visible endpoints', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createNamedRank(
      'rank-b',
      ['filtered-parent', 'logical-child', 'logical-child-2'],
      {rankNum: 1}
    );
    const rankBWithChildOne = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const rankB = addLocalDependency(rankBWithChildOne, {
      dependencyId: 'rank-b:parent-2' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[2]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependencies = [
      createCrossDependency({
        dependencyId: 'cross:parent-5' as TraceDependencyId,
        startSpanId: rankA.spans[0]!.spanId,
        endSpanId: rankB.spans[0]!.spanId,
        startRankNum: 0,
        endRankNum: 1,
        topology: 'parent',
        keywords: new Set(['PARENT'])
      }),
      createCrossDependency({
        dependencyId: 'cross:parent-6' as TraceDependencyId,
        startSpanId: rankA.spans[0]!.spanId,
        endSpanId: rankB.spans[1]!.spanId,
        startRankNum: 0,
        endRankNum: 1,
        topology: 'parent',
        keywords: new Set(['PARENT'])
      })
    ];

    const graph = buildJSONTrace([rankA, rankB], crossDependencies, {name: 'dedup-parent'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered-parent|logical-child-2'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getSpanDependencies(traceGraph, rankB.spans[1]!);

    expect(logicalChildDependencies.crossRankDependencies).toHaveLength(1);
    expect(logicalChildDependencies.crossRankDependencies[0]).toMatchObject({
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[1]!.spanId
    });
  });

  it('preserves geometry for stitched cross parent edges', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createNamedRank('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addLocalDependency(rankBBase, {
      dependencyId: 'rank-b:parent-3' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:parent-7' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'geometry-parent'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const stitchedDependencyId = getSpanDependencies(traceGraph, rankB.spans[1]!)
      .crossRankDependencies[0]?.dependencyId;
    const geometry = stitchedDependencyId
      ? getCrossGeometry(layout, stitchedDependencyId)
      : undefined;
    expect(geometry).toBeDefined();
    if (!geometry) {
      throw new Error('Expected stitched cross dependency geometry');
    }
    expect(Array.from(geometry).every(value => Number.isFinite(value))).toBe(true);
  });

  it('preserves unresolved cross-rank endpoints when filtering spans', () => {
    const rank = createNamedRank('rank-a', ['visible-span', 'filtered-span'], {
      rankNum: 0
    });
    const unresolvedEndpointId = 'endpoint:unresolved' as TraceCrossProcessEndpointId;
    const unresolvedEndpoint = {
      type: 'cross-process-dependency-endpoint',
      endpointId: unresolvedEndpointId,
      spanId: rank.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 7,
      islandNum: 0,
      waitTimeMs: 12,
      waiting: true,
      waitNotFinished: false
    } satisfies TraceSpan['crossProcessDependencyEndpoints'][number];

    rank.spans[0] = {
      ...rank.spans[0]!,
      crossProcessEndpointId: unresolvedEndpointId,
      crossProcessDependencyEndpoints: [unresolvedEndpoint]
    };
    rank.spanMap[rank.spans[0]!.spanId] = rank.spans[0]!;

    const graph = buildJSONTrace([rank], [], {name: 'preserve-unresolved-endpoint'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const endpointsWithDeps = getTraceGraphEndpointsWithDependencies(traceGraph, rank.spans[0]!);
    expect(endpointsWithDeps).toHaveLength(1);
    expect(endpointsWithDeps[0]?.[0]).toMatchObject({
      endpointId: unresolvedEndpointId,
      endRankNum: 7,
      waiting: true
    });
    expect(endpointsWithDeps[0]?.[1]).toBeNull();
  });

  it('does not change cross-rank path rendering when both endpoints are visible', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:2' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossDependency], {name: 'visible-cross'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const geometry = getCrossGeometry(layout, crossDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(
      layout.threadLayoutMap[rankA.threads[0]!.threadId].yPosition,
      6
    );
    expect(geometry[3]).toBeCloseTo(
      layout.threadLayoutMap[rankB.threads[0]!.threadId].yPosition,
      6
    );
  });
});
