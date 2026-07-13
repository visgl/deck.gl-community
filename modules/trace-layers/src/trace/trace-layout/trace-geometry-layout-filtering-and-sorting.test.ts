import {describe, expect, it, vi} from 'vitest';

import {buildArrowTraceSameProcessDependencyTableFromColumns} from '../ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from '../ingestion/json-trace';
import {buildJSONTraceFromSyntheticRunSummary} from '../test-stubs/build-trace-graph-from-run-summary';
import {
  buildSyntheticArrowTraceFixture,
  SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME
} from '../test-stubs/synthetic-arrow-trace';
import {buildTraceDatasetFromReadyTraceChunks} from '../trace-chunk-graph-assembler';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  createRuntimeTraceGraph as createDatasetRuntimeTraceGraph,
  createDatasetRuntimeTraceGraphForTest,
  createDatasetTraceGraphRuntimeSourceForTest,
  createTraceDatasetFromJSONTraceForTest
} from '../trace-graph/trace-graph-test-fixtures';
import {
  getRequiredCrossProcessDependencyRefById,
  getRequiredThreadRef,
  getTraceGraphSpanDependencies as getSpanDependencies,
  getTraceGraphEndpointsWithDependencies,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {
  encodeProcessRef,
  encodeProcessThreadRef,
  encodeSpanRef
} from '../trace-graph/trace-id-encoder';
import {
  buildTraceLayouts as buildRuntimeTraceLayouts,
  rebuildTraceLayoutGeometry as rebuildRuntimeTraceLayoutGeometry
} from '../trace-layout/trace-geometry-layout';
import * as traceGeometryLayoutCommon from '../trace-layout/trace-geometry-layout-common';
import {
  buildTraceLayoutRowOverflowLabels,
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry
} from '../trace-layout/trace-layout';
import {buildTraceViewSnapshot} from '../trace-view-snapshot';

import type {JSONTrace} from '../ingestion/json-trace';
import type {SyntheticRunSummary} from '../test-stubs/run-summary-v2';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceProcess,
  TraceProcessId,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceGeometryLayoutLookup} from '../trace-layout/trace-geometry-layout-common';
import type {TraceLayout} from '../trace-layout/trace-layout';

function createRawTestTraceGraph(
  traceDataset: Parameters<typeof createDatasetTraceGraphRuntimeSourceForTest>[0],
  options?: Parameters<typeof createDatasetRuntimeTraceGraph>[1]
): TraceGraph {
  return createDatasetRuntimeTraceGraphForTest(traceDataset, options);
}

describe('buildTraceLayouts filtering and sorting', () => {
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
    options?: Parameters<typeof createDatasetRuntimeTraceGraph>[1]
  ) {
    return createDatasetRuntimeTraceGraph(traceGraph, options);
  }

  function requireTraceGraph(layout: {traceGraph?: TraceGraph}) {
    expect(layout.traceGraph).toBeDefined();
    return layout.traceGraph!;
  }

  /** Returns the exact runtime process ref for one fixture process id. */
  function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
    const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
    const processRef = processIndex >= 0 ? traceGraph.getProcessRefs()[processIndex] : undefined;
    if (processRef == null) {
      throw new Error(`Expected process ref for ${processId}`);
    }
    return processRef;
  }

  /** Builds one layout after translating fixture process identities to exact runtime refs. */
  function buildTraceLayoutsWithCollapsedProcesses(params: {
    traceGraph: TestTraceGraphSource;
    processIds: readonly string[];
    settings: Parameters<typeof buildRuntimeTraceLayouts>[0]['settings'];
  }) {
    const traceGraph = normalizeTraceGraphSource(params.traceGraph);
    return buildRuntimeTraceLayouts({
      traceGraphs: [traceGraph],
      settings: params.settings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(
              params.processIds.map(processId => getRequiredProcessRef(traceGraph, processId))
            ),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });
  }

  /** Returns one required runtime thread layout by fixture thread id. */
  function getLayoutThread(layout: TraceLayout, threadId: TraceThreadId) {
    const threadRef = getRequiredThreadRef(requireTraceGraph(layout), threadId);
    const threadLayout = layout.threadLayoutMapByRef.get(threadRef);
    if (!threadLayout) {
      throw new Error(`Expected thread layout for ${threadId}`);
    }
    return threadLayout;
  }

  function getCrossGeometry(
    layout: TraceLayout,
    dependencyId: TraceDependencyId
  ): Float32Array | undefined {
    const dependencyRef = getRequiredCrossProcessDependencyRefById(
      requireTraceGraph(layout),
      dependencyId
    );
    if (dependencyRef == null) {
      return undefined;
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    return fillTraceLayoutCrossProcessDependencyGeometry({
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
          status: 'finished' as const,
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

  function createCrossProcessDependency(params: {
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
          status: 'finished' as const,
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
          status: 'finished' as const,
          startTimeMs: index,
          endTimeMs: index + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      },
      sameProcessDependencyIds: [],
      sameProcessDependencies: [],
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
      sameProcessDependencies: [],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  function addSameProcessDependency(
    rank: TraceProcess,
    params: {
      dependencyId: TraceDependencyId;
      startSpanId: TraceSpanId;
      endSpanId: TraceSpanId;
      keywords?: Set<string>;
    }
  ): TraceProcess {
    const sameProcessDependency = {
      type: 'trace-same-process-dependency',
      dependencyId: params.dependencyId,
      startSpanId: params.startSpanId,
      endSpanId: params.endSpanId,
      keywords: params.keywords ?? new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    } satisfies TraceProcess['sameProcessDependencies'][number];

    return {
      ...rank,
      sameProcessDependencies: [...rank.sameProcessDependencies, sameProcessDependency],
      spans: rank.spans.map(span =>
        span.spanId === sameProcessDependency.startSpanId ||
        span.spanId === sameProcessDependency.endSpanId
          ? {
              ...span,
              sameProcessDependencyIds: [
                ...span.sameProcessDependencyIds,
                sameProcessDependency.dependencyId
              ]
            }
          : span
      ),
      spanMap: Object.fromEntries(
        rank.spans.map(span => {
          const nextBlock =
            span.spanId === sameProcessDependency.startSpanId ||
            span.spanId === sameProcessDependency.endSpanId
              ? {
                  ...span,
                  sameProcessDependencyIds: [
                    ...span.sameProcessDependencyIds,
                    sameProcessDependency.dependencyId
                  ]
                }
              : span;
          return [nextBlock.spanId, nextBlock];
        })
      ) as Record<string, TraceSpan>
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

  function createHeadToLogicalSummary(): SyntheticRunSummary {
    return {scenario: 'head-to-logical'};
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
    const unsortedFirstY = getLayoutThread(unsortedLayout, firstThread!.threadId).yPosition;
    const unsortedSecondY = getLayoutThread(unsortedLayout, secondThread!.threadId).yPosition;
    const sortedFirstY = getLayoutThread(sortedLayout, firstThread!.threadId).yPosition;
    const sortedSecondY = getLayoutThread(sortedLayout, secondThread!.threadId).yPosition;

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
        getLayoutThread(layout, thread.threadId)
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
      expect(layout.threadLayoutMapByRef.get(threadRef)).toBe(
        getLayoutThread(layout, thread.threadId)
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
      expect(layout.threadLayoutMapByRef.get(threadRef)).toBe(
        getLayoutThread(layout, thread.threadId)
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
      expect(layout.threadLayoutMapByRef.get(threadRef)).toBe(combinedLayout);
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
    expect(getLayoutThread(filteredLayout, hiddenStreamId)!.visible).toBe(false);
    expect(getLayoutThread(filteredLayout, hiddenStreamId)!.yPosition).toBe(-1000);
    expect(getLayoutThread(filteredLayout, hiddenStreamId)!.lanes?.laneYPositions).toEqual([]);
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeLessThan(
      expandedLayout.processLayouts[1]!.yOffset
    );
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
  });

  it('precomputes overflow label text without retaining per-thread filtered counts', () => {
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
        sameProcessDependencyIds: [],
        sameProcessDependencies: [],
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
      sameProcessDependencies: [],
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
      '2 deeper spans hidden'
    );

    const getSpanGeometrySourceSpy = vi.spyOn(layout.traceGraph, 'getSpanGeometrySource');
    const overflowLabels = buildTraceLayoutRowOverflowLabels({
      traceLayout: layout,
      row: layout.renderRows[0]!
    });

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabelAnchorX).toBe(0);
    expect(overflowLabels[0]).toMatchObject({
      text: '2 deeper spans hidden',
      x: 0
    });
    expect(getSpanGeometrySourceSpy).not.toHaveBeenCalled();
    getSpanGeometrySourceSpy.mockRestore();
  });

  it('does not create a decorative layout label solely for filtered spans', () => {
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
      sameProcessDependencyIds: [],
      sameProcessDependencies: [],
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
      sameProcessDependencies: [],
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

    expect(layout.processLayouts[0]!.threadLayouts[0]!.overflowLabel).toBeUndefined();

    const getSpanGeometrySourceSpy = vi.spyOn(layout.traceGraph, 'getSpanGeometrySource');
    const overflowLabels = buildTraceLayoutRowOverflowLabels({
      traceLayout: layout,
      row: layout.renderRows[0]!
    });

    expect(overflowLabels).toEqual([]);
    expect(getSpanGeometrySourceSpy).not.toHaveBeenCalled();
    getSpanGeometrySourceSpy.mockRestore();
  });

  it('precomputes combined-thread overflow label text without filtered counts', () => {
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
          sameProcessDependencyIds: [],
          sameProcessDependencies: [],
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
      sameProcessDependencies: [],
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
      '3 deeper spans hidden'
    );
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
    const iterateVisibleSpanRefsByProcessSpy = vi.spyOn(
      traceGraph,
      'iterateVisibleSpanRefsByProcess'
    );
    const getVisibleSameProcessDependencyLayoutSourcesSpy = vi.spyOn(
      traceGraph,
      'getVisibleSameProcessDependencyLayoutSources'
    );

    const [baselineLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings
    });
    const [arrowNativeLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings
    });

    expect(iterateVisibleSpanRefsByProcessSpy).toHaveBeenCalled();
    expect(getVisibleSameProcessDependencyLayoutSourcesSpy).not.toHaveBeenCalled();
    expect(arrowNativeLayout.threadLayoutMapByRef).toEqual(baselineLayout.threadLayoutMapByRef);
    expect(arrowNativeLayout.renderRows).toEqual(baselineLayout.renderRows);
    expect(arrowNativeLayout.currentBounds).toEqual(baselineLayout.currentBounds);

    iterateVisibleSpanRefsByProcessSpy.mockRestore();
    getVisibleSameProcessDependencyLayoutSourcesSpy.mockRestore();
  });

  it('keeps generated auto-layout off the broad span lane accessor', () => {
    const graph = buildJSONTrace([createRank('rank-narrow-lane-layout', 0, 0)], [], {
      name: 'narrow-generated-lane-layout'
    });
    const traceGraph = createRuntimeTraceGraph(graph);
    const getSpanLaneSourceSpy = vi.spyOn(traceGraph, 'getSpanLaneSource');

    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads'
      }
    });

    expect(layout.spanLaneColumnsByChunkIndex).toBeDefined();
    expect(getSpanLaneSourceSpy).not.toHaveBeenCalled();

    getSpanLaneSourceSpy.mockRestore();
  });

  it('scans parent flags from Arrow bytes before structural fixture lane fallback', () => {
    const dependencyId = 'rank-primary-dependency-scan:dependency' as TraceDependencyId;
    const rank = addSameProcessDependency(
      createNamedRank('rank-primary-dependency-scan', ['first', 'second']),
      {
        dependencyId,
        startSpanId: 'rank-primary-dependency-scan-span-0' as TraceSpanId,
        endSpanId: 'rank-primary-dependency-scan-span-1' as TraceSpanId
      }
    );
    const graph = buildJSONTrace([rank], [], {name: 'primary-dependency-arrow-scan'});
    const baseTraceDataset = createTraceDatasetFromJSONTraceForTest(graph);
    const processId = rank.processId as TraceProcessId;
    const startSpanRef = encodeSpanRef(0, 0);
    const endSpanRef = encodeSpanRef(0, 1);

    /** Builds one dataset variant whose dependency table declares or omits explicit parenthood. */
    const buildTraceDatasetWithDependencyTable = (params: {hasParentKeyword: boolean}) => ({
      ...baseTraceDataset,
      sameProcessDependencyTableMap: {
        ...baseTraceDataset.sameProcessDependencyTableMap,
        [processId]: buildArrowTraceSameProcessDependencyTableFromColumns({
          startSpanRef: [startSpanRef],
          endSpanRef: [endSpanRef],
          waitMode: ['start-to-start'],
          bidirectional: [false],
          waitTimeMs: [0],
          keywords: [params.hasParentKeyword ? ['PARENT'] : []],
          hasParentKeyword: [params.hasParentKeyword]
        })
      }
    });
    const settings: Parameters<typeof buildTraceLayouts>[0]['settings'] = {
      ...baseSettings,
      trackAggregationMode: 'separate-threads'
    };

    const noParentTraceDataset = buildTraceDatasetWithDependencyTable({
      hasParentKeyword: false
    });
    const noParentTraceGraph = createRawTestTraceGraph(noParentTraceDataset);
    const noParentDependencySourcesSpy = vi.spyOn(
      noParentTraceGraph,
      'getVisibleSameProcessDependencyLayoutSources'
    );
    const noParentTable = noParentTraceGraph.sameProcessDependencyTableMap[processId]!;
    const noParentKeywordFlagsGet = vi.spyOn(noParentTable.getChild('keywordFlags')!, 'get');
    const [noParentLayout] = buildTraceLayouts({
      traceGraphs: [noParentTraceGraph],
      settings
    });

    expect(noParentLayout.spanLaneColumnsByChunkIndex).toBeDefined();
    expect(noParentDependencySourcesSpy).toHaveBeenCalled();
    expect(noParentKeywordFlagsGet).not.toHaveBeenCalled();

    const parentTraceDataset = buildTraceDatasetWithDependencyTable({
      hasParentKeyword: true
    });
    const parentTraceGraph = createRawTestTraceGraph(parentTraceDataset);
    const parentDependencySourcesSpy = vi.spyOn(
      parentTraceGraph,
      'getVisibleSameProcessDependencyLayoutSources'
    );
    const parentTable = parentTraceGraph.sameProcessDependencyTableMap[processId]!;
    const parentKeywordFlagsGet = vi.spyOn(parentTable.getChild('keywordFlags')!, 'get');
    const [parentLayout] = buildTraceLayouts({
      traceGraphs: [parentTraceGraph],
      settings
    });

    expect(parentDependencySourcesSpy).toHaveBeenCalled();
    expect(parentLayout.spanLaneColumnsByChunkIndex).toBeDefined();
    expect(parentKeywordFlagsGet).not.toHaveBeenCalled();

    noParentDependencySourcesSpy.mockRestore();
    noParentKeywordFlagsGet.mockRestore();
    parentDependencySourcesSpy.mockRestore();
    parentKeywordFlagsGet.mockRestore();
  });

  it('streams dataset-backed primary lanes without ref or dependency source scans', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'trusted-dense-primary-lanes',
      processCount: 2,
      rowCount: 16,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'trusted-dense-primary-lanes',
      ...fixture.materializationInputs
    });
    const traceGraph = new TraceGraph({
      traceDataset,
      traceStore: fixture.traceStore
    });
    const iterateVisibleSpanRefsByProcessSpy = vi.spyOn(
      traceGraph,
      'iterateVisibleSpanRefsByProcess'
    );
    const getVisibleSameProcessDependencyLayoutSourcesSpy = vi.spyOn(
      traceGraph,
      'getVisibleSameProcessDependencyLayoutSources'
    );
    const getSpanLaneSourceSpy = vi.spyOn(traceGraph, 'getSpanLaneSource');

    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads'
      }
    });

    expect(layout.spanLaneColumnsByChunkIndex?.size).toBe(2);
    for (const laneColumn of layout.spanLaneColumnsByChunkIndex?.values() ?? []) {
      expect(Array.from(laneColumn.values)).toEqual(Array(laneColumn.values.length).fill(0));
    }
    expect(iterateVisibleSpanRefsByProcessSpy).not.toHaveBeenCalled();
    expect(getVisibleSameProcessDependencyLayoutSourcesSpy).not.toHaveBeenCalled();
    expect(getSpanLaneSourceSpy).not.toHaveBeenCalled();

    iterateVisibleSpanRefsByProcessSpy.mockRestore();
    getVisibleSameProcessDependencyLayoutSourcesSpy.mockRestore();
    getSpanLaneSourceSpy.mockRestore();
  });

  it('streams text-filter snapshot masks without building a visible ref index', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'trusted-dense-primary-lanes-text-mask',
      processCount: 1,
      rowCount: 8,
      threadsPerProcess: 1,
      textFilterMatchEvery: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'trusted-dense-primary-lanes-text-mask',
      ...fixture.materializationInputs
    });
    const traceViewSnapshot = buildTraceViewSnapshot(traceDataset, {
      spanFilters: [SYNTHETIC_ARROW_TRACE_TEXT_FILTER_MATCH_NAME]
    });
    const traceGraph = new TraceGraph(
      {
        traceDataset,
        traceStore: fixture.traceStore
      },
      traceViewSnapshot
    );
    const iterateVisibleSpanRefsByProcessSpy = vi.spyOn(
      traceGraph,
      'iterateVisibleSpanRefsByProcess'
    );

    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads'
      }
    });

    expect(Array.from(layout.spanLaneColumnsByChunkIndex?.get(0)?.values ?? [])).toEqual([
      -1, 0, -1, 0, -1, 0, -1, 0
    ]);
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutSpanGeometry({
        traceLayout: layout,
        spanRef: encodeSpanRef(0, 1),
        target: geometry
      })
    ).toBe(true);
    expect(iterateVisibleSpanRefsByProcessSpy).not.toHaveBeenCalled();

    iterateVisibleSpanRefsByProcessSpy.mockRestore();
  });

  it('keeps lane-disabled user-data traces on the text-mask lane stream', () => {
    const rank = createNamedRank('rank-lane-disabled-text-mask', ['filtered', 'visible']);
    rank.userData = {laneAssignmentMode: 'none'};
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([rank], [], {name: 'lane-disabled-text-mask'}),
      {
        spanFilters: ['filtered']
      }
    );
    const iterateVisibleSpanRefsByProcessSpy = vi.spyOn(
      traceGraph,
      'iterateVisibleSpanRefsByProcess'
    );

    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads'
      }
    });

    expect(Array.from(layout.spanLaneColumnsByChunkIndex?.get(0)?.values ?? [])).toEqual([-1, 0]);
    expect(iterateVisibleSpanRefsByProcessSpy).not.toHaveBeenCalled();
    iterateVisibleSpanRefsByProcessSpy.mockRestore();
  });

  it('falls back for the whole dataset process when one dense batch is unsupported', () => {
    const fixture = buildSyntheticArrowTraceFixture({
      identityKey: 'trusted-dense-primary-lanes-fallback',
      processCount: 1,
      rowCount: 16,
      threadsPerProcess: 2
    });
    const traceDataset = buildTraceDatasetFromReadyTraceChunks({
      name: 'trusted-dense-primary-lanes-fallback',
      ...fixture.materializationInputs
    });
    const traceGraph = new TraceGraph({
      traceDataset,
      traceStore: fixture.traceStore
    });
    const settings: Parameters<typeof buildTraceLayouts>[0]['settings'] = {
      ...baseSettings,
      trackAggregationMode: 'separate-threads'
    };
    const [trustedLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings
    });
    const trustedLaneValuesByChunkIndex = new Map(
      Array.from(trustedLayout.spanLaneColumnsByChunkIndex ?? [], ([chunkIndex, column]) => [
        chunkIndex,
        Array.from(column.values)
      ])
    );

    const spanTable = traceDataset.chunks[0]!.spanTable;
    const originalGetChild = spanTable.getChild.bind(spanTable);
    const threadRefColumn = spanTable.getChild('thread_ref')!;
    const unsupportedThreadRefColumn = Object.create(threadRefColumn) as typeof threadRefColumn;
    Object.defineProperties(unsupportedThreadRefColumn, {
      data: {
        value: threadRefColumn.data.map(data => ({...data, offset: 1}))
      },
      get: {
        value: threadRefColumn.get.bind(threadRefColumn)
      }
    });
    const getChildSpy = vi
      .spyOn(spanTable, 'getChild')
      .mockImplementation(columnName =>
        columnName === 'thread_ref' ? unsupportedThreadRefColumn : originalGetChild(columnName)
      );
    const iterateVisibleSpanRefsByProcessSpy = vi.spyOn(
      traceGraph,
      'iterateVisibleSpanRefsByProcess'
    );

    const [fallbackLayout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings
    });

    expect(iterateVisibleSpanRefsByProcessSpy).toHaveBeenCalled();
    expect(
      new Map(
        Array.from(fallbackLayout.spanLaneColumnsByChunkIndex ?? [], ([chunkIndex, column]) => [
          chunkIndex,
          Array.from(column.values)
        ])
      )
    ).toEqual(trustedLaneValuesByChunkIndex);

    getChildSpy.mockRestore();
    iterateVisibleSpanRefsByProcessSpy.mockRestore();
  });

  it('builds filtered layout and geometry from ref-native graph sources', () => {
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

    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings
    });

    rebuildTraceLayoutGeometry({
      traceGraph,
      traceLayout: layout!,
      settings: {
        sameProcessDependencyMode: settings.sameProcessDependencyMode,
        layoutDensity: settings.layoutDensity
      }
    });
  });

  it('renders collapsed endpoint below process activity overview when peer is below', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:0' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'collapsed-cross'
    });
    const materializedGraph = materializeJSONTrace(graph);
    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [rankA.processId]
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
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
      getLayoutThread(layout, rankB.threads[0]!.threadId).yPosition,
      6
    );
  });

  it('anchors dependency endpoints from above slightly above collapsed activity overview', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:from-above' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'collapsed-cross-from-above'
    });
    const materializedGraph = materializeJSONTrace(graph);
    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [rankB.processId]
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
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
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:1' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'collapsed-cross-both'
    });
    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [rankA.processId, rankB.processId]
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(layout.processLayouts[0]!.collapsedActivityY + 0.2, 6);
    expect(geometry[3]).toBeCloseTo(layout.processLayouts[1]!.collapsedActivityY - 0.2, 6);
  });

  it('renders cross-rank dependencies from a collapsed combined-thread process using collapsedActivityY', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 15);
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:combined-threads' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'collapsed-combined-thread-cross'
    });
    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      processIds: [rankA.processId]
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
    expect(layout.processLayouts[0]!.isCollapsed).toBe(true);
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(layout.processLayouts[0]!.collapsedActivityY + 0.2, 6);
    expect(geometry[3]).toBeCloseTo(
      getLayoutThread(layout, rankB.threads[0]!.threadId).yPosition,
      6
    );
  });

  it('preserves head-to-logical cross-rank dependency geometry when the logical process is collapsed in combine-threads', () => {
    const graph = buildJSONTraceFromSyntheticRunSummary(createHeadToLogicalSummary());
    const logicalProcess = graph.processes.find(process => process.name === 'Proc A');
    const dependency = graph.crossProcessDependencies?.[0];

    expect(logicalProcess).toBeDefined();
    expect(dependency).toBeDefined();

    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      processIds: [logicalProcess!.processId]
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
    const graph = buildJSONTraceFromSyntheticRunSummary(createHeadToLogicalSummary());
    const headProcess = graph.processes.find(process =>
      String(process.userData?.role ?? '').includes('head')
    );
    const dependency = graph.crossProcessDependencies?.[0];

    expect(headProcess).toBeDefined();
    expect(dependency).toBeDefined();

    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      processIds: [headProcess!.processId]
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
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:3' as TraceDependencyId,
      startSpanId: rankB.spans[0]!.spanId,
      endSpanId: rankA.spans[0]!.spanId,
      startRankNum: 1,
      endRankNum: 0,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'collapsed-cross-below'
    });
    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [rankA.processId]
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
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
        '/workspace/src/runtime/core/rpc_runtime.py',
        'other/file.py'
      ]
    });
    const graph = buildJSONTrace([rank], [], {name: 'span-filter-source'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        spanFilter:
          'packages/distributed_tracing/base.py;/workspace/src/runtime/core/rpc_runtime.py'
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

  it('skips same-process dependency geometry generation when an endpoint span is missing', () => {
    const dependencyGeometryMap: Record<TraceDependencyId, Float32Array> = {};
    const visibleSpanRef = encodeSpanRef(0, 0);
    const visibleThreadRef = encodeProcessThreadRef(0, 0);
    const visibleBlock = {
      spanRef: visibleSpanRef,
      processRef: encodeProcessRef(0),
      threadRef: visibleThreadRef,
      spanId: 'visible-end' as TraceSpanId,
      threadId: 'visible-stream' as TraceThreadId,
      primaryTimingKey: 'test',
      timings: {
        test: {
          status: 'finished' as const,
          startTimeMs: 0,
          endTimeMs: 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      }
    };
    const layoutLookup = {
      traceGraph: {
        getProcessRefBySpanRef: () => null,
        getThreadRefBySpanRef: () => null
      },
      threadLayoutsByRef: new Map(),
      processLayoutsByRef: new Map()
    } satisfies TraceGeometryLayoutLookup;

    traceGeometryLayoutCommon.buildTraceSameProcessDependencyGeometries({
      sameProcessDependencies: [
        {
          type: 'trace-same-process-dependency',
          dependencyId: 'dep-missing-start' as TraceDependencyId,
          startSpanRef: encodeSpanRef(0, 1),
          endSpanRef: visibleSpanRef,
          startSpanId: 'missing-start' as TraceSpanId,
          endSpanId: 'visible-end' as TraceSpanId,
          keywords: new Set(),
          waitMode: 'start-to-start',
          bidirectional: false,
          waitTimeMs: 0
        }
      ],
      spanByRef: new Map([[visibleSpanRef, visibleBlock]]),
      maxTimeMs: 1,
      minTimeMs: 0,
      layoutLookup,
      dependencyGeometryMap,
      settings: {}
    });

    expect(dependencyGeometryMap).toEqual({});
  });

  it('drops a cross parent dependency when the filtered child has no visible descendant', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankB = createNamedRank('rank-b', ['filtered-leaf'], {rankNum: 1});
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:parent-3' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'cross-leaf-drop'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const rootDependencies = getSpanDependencies(traceGraph, rankA.spans[0]!);
    expect(rootDependencies.outDependencies).toHaveLength(0);
  });

  it('does not promote non-parent same process dependencies across ranks', () => {
    const rankA = createNamedRank('rank-a', ['head-root'], {rankNum: 0});
    const rankBBase = createNamedRank('rank-b', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const rankB = addSameProcessDependency(rankBBase, {
      dependencyId: 'rank-b:dep-1' as TraceDependencyId,
      startSpanId: rankBBase.spans[0]!.spanId,
      endSpanId: rankBBase.spans[1]!.spanId
    });
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:parent-4' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'non-parent-local'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });

    const traceGraph = requireTraceGraph(layout);
    const logicalChildDependencies = getSpanDependencies(traceGraph, rankB.spans[1]!);
    expect(logicalChildDependencies.inDependencies).toHaveLength(0);
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
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:2' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      waitMode: 'start-to-start'
    });

    const graph = buildJSONTrace([rankA, rankB], [crossProcessDependency], {
      name: 'visible-cross'
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry[1]).toBeCloseTo(
      getLayoutThread(layout, rankA.threads[0]!.threadId).yPosition,
      6
    );
    expect(geometry[3]).toBeCloseTo(
      getLayoutThread(layout, rankB.threads[0]!.threadId).yPosition,
      6
    );
  });
});
