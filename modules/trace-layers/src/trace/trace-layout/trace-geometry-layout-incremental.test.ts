import {describe, expect, it, vi} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace, materializeJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  getRequiredThreadRef,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {getSpanRefProcessId, getSpanRefRowIndex} from '../trace-graph/trace-id-encoder';
import {
  buildTraceLayoutForSpanRefs as buildRuntimeTraceLayoutForSpanRefs,
  buildTraceLayouts as buildRuntimeTraceLayouts,
  rebuildTraceLayoutGeometry as rebuildRuntimeTraceLayoutGeometry
} from '../trace-layout/trace-geometry-layout';
import * as traceGeometryLayoutCommon from '../trace-layout/trace-geometry-layout-common';
import {
  deserializeTraceGraphCollapseState,
  fillTraceLayoutCrossDependencyGeometry,
  fillTraceLayoutLocalDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanVisibility,
  hasTraceLayoutSpanVisibilityFlag,
  isTraceLayoutSpanVisible,
  serializeTraceGraphCollapseState,
  traceLayoutSpanVisibilityFlags
} from '../trace-layout/trace-layout';

import type {JSONTrace} from '../ingestion/json-trace';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceEventId,
  TraceProcess,
  TraceProcessId,
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

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

describe('buildTraceLayouts', () => {
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
  function buildTraceLayoutForSpanRefs(
    params: Parameters<typeof buildRuntimeTraceLayoutForSpanRefs>[0]
  ) {
    return buildRuntimeTraceLayoutForSpanRefs(params);
  }

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

  function getSpanGeometry(
    layout: TraceLayout,
    spanId: TraceSpanId
  ): traceGeometryLayoutCommon.SpanBoundingBox | undefined {
    const spanRef = requireTraceGraph(layout).getSpanRefByExternalBlockId(spanId);
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

  function getLayoutLocalDependencyGeometry(
    layout: TraceLayout,
    dependencyId: TraceDependencyId
  ): Float32Array | undefined {
    const dependencyRef = requireTraceGraph(layout).getVisibleLocalDependencyRefById(dependencyId);
    if (dependencyRef == null) {
      return undefined;
    }
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    return fillTraceLayoutLocalDependencyGeometry({
      traceLayout: layout,
      dependencyRef,
      target: geometry
    })
      ? new Float32Array([geometry.x1, geometry.y1, geometry.x2, geometry.y2])
      : undefined;
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
  function createLocalThreadRank(params: {
    processId: string;
    rankNum: number;
    threadIds: readonly string[];
    blockStartOffsetMs?: number;
  }): TraceProcess {
    const threads: TraceThread[] = params.threadIds.map(threadId => ({
      type: 'trace-thread',
      name: threadId,
      threadId: threadId as TraceThreadId,
      processId: params.processId
    }));
    const spans: TraceSpan[] = threads.map((thread, index) => {
      const startTimeMs = (params.blockStartOffsetMs ?? 0) + index;
      return {
        type: 'trace-span',
        spanId: `${params.processId}-${thread.threadId}-span` as TraceSpanId,
        threadId: thread.threadId,
        processName: params.processId,
        name: `${params.processId}-${thread.threadId}-span`,
        keywords: [],
        primaryTimingKey: 'test',
        timings: {
          test: {
            status: 'finished',
            startTimeMs,
            endTimeMs: startTimeMs + 1,
            durationMs: 1,
            durationMsAsString: '1ms'
          }
        },
        localDependencyIds: [],
        localDependencies: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: []
      } satisfies TraceSpan;
    });

    return {
      type: 'trace-process',
      processId: params.processId,
      name: params.processId,
      rankNum: params.rankNum,
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
   * Builds a rank with one process-local stream id and a local dependency on that stream.
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
      localDependencyIds: [],
      localDependencies: [],
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
      localDependencyIds: [dependencyId],
      localDependencies: [],
      crossProcessEndpointId: null,
      crossProcessDependencyEndpoints: []
    };
    const localDependency = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: parentBlock.spanId,
      endSpanId: childBlock.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    } satisfies TraceProcess['localDependencies'][number];
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
      localDependencies: [localDependency],
      remoteDependencies: []
    } satisfies TraceProcess;
  }

  type CombinedThreadDefinition = {
    threadName: string;
    spans: Array<{
      idSuffix: string;
      start: number;
      end: number;
      parentId?: string;
      traceId?: string | bigint;
    }>;
  };

  function createDependencyRank(
    processId: string,
    streamDefinitions: CombinedThreadDefinition[]
  ): TraceProcess {
    const streamSuffixes = streamDefinitions.map(
      (_, index) => `${processId}-stream-${index}` as TraceThreadId
    );
    const threads: TraceThread[] = streamDefinitions.map((definition, index) => ({
      type: 'trace-thread',
      name: definition.threadName,
      threadId: streamSuffixes[index]!,
      processId
    }));

    const spans: TraceSpan[] = [];
    const blockByLogicalId = new Map<string, TraceSpan>();
    const pendingDependencies: Array<{
      spanId: TraceSpanId;
      parentLogicalId: string;
    }> = [];
    const localDependencies: TraceProcess['localDependencies'] = [];
    const spanMap: Record<string, TraceSpan> = {};

    streamDefinitions.forEach((definition, threadIndex) => {
      const threadId = streamSuffixes[threadIndex];
      const thread = threads[threadIndex];
      if (!threadId) {
        return;
      }

      definition.spans.forEach(blockConfig => {
        const spanId = `${processId}-${thread.threadId}-${blockConfig.idSuffix}` as TraceSpanId;
        const span: TraceSpan = {
          type: 'trace-span',
          spanId,
          threadId: thread.threadId,
          processName: processId,
          name: `${thread.name}-${blockConfig.idSuffix}`,
          keywords: [],
          primaryTimingKey: 'test',
          timings: {
            test: {
              status: 'finished',
              startTimeMs: blockConfig.start,
              endTimeMs: blockConfig.end,
              durationMs: blockConfig.end - blockConfig.start,
              durationMsAsString: `${blockConfig.end - blockConfig.start}ms`
            }
          },
          localDependencyIds: [],
          localDependencies: [],
          crossProcessEndpointId: null,
          crossProcessDependencyEndpoints: [],
          ...(blockConfig.traceId != null ? {userData: {trace_id: blockConfig.traceId}} : {})
        };
        spans.push(span);
        spanMap[spanId] = span;
        const threadKey = `${definition.threadName}:${blockConfig.idSuffix}`;
        blockByLogicalId.set(threadKey, span);
        if (blockConfig.parentId) {
          pendingDependencies.push({
            spanId: span.spanId,
            parentLogicalId: blockConfig.parentId
          });
        }
      });
    });

    pendingDependencies.forEach(({spanId, parentLogicalId}) => {
      const childBlock = spans.find(span => span.spanId === spanId);
      const parentBlock = blockByLogicalId.get(parentLogicalId);
      if (!childBlock || !parentBlock) {
        return;
      }

      const dependencyId = `${spanId}:dep` as TraceDependencyId;
      const dependency = {
        type: 'trace-local-dependency',
        dependencyId,
        startSpanId: parentBlock.spanId,
        endSpanId: childBlock.spanId,
        keywords: new Set<string>(['PARENT']),
        waitMode: 'start-to-start',
        bidirectional: false,
        waitTimeMs: 0
      } satisfies TraceProcess['localDependencies'][number];

      childBlock.localDependencyIds.push(dependencyId);
      localDependencies.push(dependency);
    });

    return {
      type: 'trace-process',
      processId,
      name: processId,
      rankNum: 0,
      stepNum: 0,
      threads,
      threadMap: Object.fromEntries(threads.map(thread => [thread.threadId, thread])) as Record<
        string,
        TraceThread
      >,
      spans,
      spanMap,
      instants: [],
      instantMap: {},
      threadInstantMap: {},
      counters: [],
      counterMap: {},
      threadCounterMap: {},
      localDependencies,
      remoteDependencies: []
    } satisfies TraceProcess;
  }

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

  function getLayoutLanes(
    layout: ReturnType<typeof buildTraceLayouts>[number]
  ): ReadonlyMap<SpanRef, number> {
    const syntheticLayout = layout.processLayouts[0]?.threadLayouts?.[0];
    return syntheticLayout?.spanLaneMap ?? new Map();
  }

  /**
   * Asserts that every visible span in a rank has non-empty ref-keyed geometry.
   */
  function expectRankBlocksToHaveGeometry(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    rank: TraceProcess
  ): void {
    for (const span of rank.spans) {
      const geometry = getSpanGeometry(layout, span.spanId);
      expect(geometry, `Expected geometry for ${rank.processId}/${span.spanId}`).toBeDefined();
      expect(geometry![2]).toBeGreaterThan(geometry![0]!);
      expect(geometry![3]).toBeGreaterThan(geometry![1]!);
    }
  }

  /**
   * Returns the vertical center of a rendered span's ref-keyed bbox.
   */
  function getBlockGeometryCenterY(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanId: TraceSpanId
  ): number {
    const geometry = getSpanGeometry(layout, spanId);
    if (!geometry) {
      throw new Error(`Expected geometry for span ${spanId}`);
    }
    return (geometry[1]! + geometry[3]!) / 2;
  }

  function expectZeroHeightNavigableGeometry(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanRef: SpanRef
  ): Float32Array {
    const target = {x1: 0, y1: 0, x2: 0, y2: 0};
    const geometry = fillTraceLayoutSpanGeometry({traceLayout: layout, spanRef, target})
      ? new Float32Array([target.x1, target.y1, target.x2, target.y2])
      : undefined;
    expect(geometry).toBeDefined();
    expect(Array.from(geometry!).every(value => Number.isFinite(value))).toBe(true);
    expect(geometry![2]).toBeGreaterThan(geometry![0]!);
    expect(geometry![3]).toBe(geometry![1]);
    return geometry!;
  }

  function blocksOverlap(
    first: {startTimeMs: number; endTimeMs: number},
    second: {startTimeMs: number; endTimeMs: number}
  ): boolean {
    return first.startTimeMs < second.endTimeMs && second.startTimeMs < first.endTimeMs;
  }

  function getLayoutSpanRef(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanId: TraceSpanId
  ): SpanRef {
    const spanRef = layout.traceGraph?.getSpanRefByExternalBlockId(spanId);
    if (spanRef == null) {
      throw new Error(`Expected span ref for span ${spanId}`);
    }
    return spanRef;
  }

  it('resolves unfiltered local dependency geometry by visible dependency refs', () => {
    const rank = createDependencyRank('rank-visible-local-dependency-geometry', [
      {
        threadName: 'worker',
        spans: [
          {idSuffix: 'parent', start: 0, end: 1},
          {idSuffix: 'child', start: 2, end: 3, parentId: 'worker:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'visible-local-dependency-geometry'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const traceGraph = requireTraceGraph(layout);
    const processRef = getRequiredProcessRef(traceGraph, rank.processId);
    const visibleDependency = traceGraph.getVisibleLocalDependencySources(processRef)[0];
    const parentBlock = rank.spans[0]!;
    const childBlock = rank.spans[1]!;
    const laneMap = layout.threadLayoutMap[parentBlock.threadId]?.spanLaneMap;
    const parentLane = laneMap?.get(getLayoutSpanRef(layout, parentBlock.spanId));
    const childLane = laneMap?.get(getLayoutSpanRef(layout, childBlock.spanId));

    expect(visibleDependency?.dependencyRef).toBeDefined();
    expect(parentLane).toBeDefined();
    expect(childLane).toBeDefined();
    expect(parentLane!).toBeLessThan(childLane!);
    expect(getBlockGeometryCenterY(layout, parentBlock.spanId)).toBeLessThan(
      getBlockGeometryCenterY(layout, childBlock.spanId)
    );
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutLocalDependencyGeometry({
        traceLayout: layout,
        dependencyRef: visibleDependency!.dependencyRef!,
        target: geometry
      })
    ).toBe(true);
    expect(geometry.x2).toBeGreaterThan(geometry.x1);
    expect(geometry.y2).toBeGreaterThan(geometry.y1);
  });

  it('keeps same-trace spans clustered while preserving explicit parent depth in separate mode', () => {
    const rank = createDependencyRank('rank-trace-affinity-parent-depth', [
      {
        threadName: 'worker',
        spans: [
          {idSuffix: 'blocker', start: 0, end: 10, traceId: 'trace-b'},
          {idSuffix: 'trace-a-seed', start: 1, end: 4, traceId: 'trace-a'},
          {idSuffix: 'trace-a-followup', start: 10, end: 15, traceId: 'trace-a'},
          {
            idSuffix: 'trace-a-child',
            start: 16,
            end: 18,
            parentId: 'worker:trace-a-followup',
            traceId: 'trace-a'
          }
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'trace-affinity-parent-depth'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const laneMap = layout.threadLayoutMap[rank.threads[0]!.threadId]?.spanLaneMap;
    expect(laneMap?.get(getLayoutSpanRef(layout, rank.spans[0]!.spanId))).toBe(0);
    expect(laneMap?.get(getLayoutSpanRef(layout, rank.spans[1]!.spanId))).toBe(1);
    expect(laneMap?.get(getLayoutSpanRef(layout, rank.spans[2]!.spanId))).toBe(1);
    expect(laneMap?.get(getLayoutSpanRef(layout, rank.spans[3]!.spanId))).toBe(2);
  });

  it('reuses existing cross geometry when appending ranks and only adds geometry for new matches', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const rankC = createRank('rank-c', 2, 8);
    const crossAB = createCrossDependency({
      dependencyId: 'cross:ab' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1
    });
    const crossAC = createCrossDependency({
      dependencyId: 'cross:ac' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankC.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 2
    });
    const graphAB = buildJSONTrace([rankA, rankB], [crossAB], {name: 'cross-geometry-ab'});
    const graphABCWithoutNewCross = buildJSONTrace([rankA, rankB, rankC], [crossAB], {
      name: 'cross-geometry-abc-no-new-cross'
    });
    const graphABC = buildJSONTrace([rankA, rankB, rankC], [crossAB, crossAC], {
      name: 'cross-geometry-abc'
    });

    const [layoutAB] = buildTraceLayouts({traceGraphs: [graphAB], settings: baseSettings});
    const [layoutABCWithoutNewCross] = buildTraceLayouts({
      traceGraphs: [graphABCWithoutNewCross],
      previousLayouts: [layoutAB],
      settings: baseSettings
    });
    const [layoutABC] = buildTraceLayouts({
      traceGraphs: [graphABC],
      previousLayouts: [layoutABCWithoutNewCross],
      settings: baseSettings
    });

    expect(getCrossGeometry(layoutABCWithoutNewCross, crossAB.dependencyId)).toEqual(
      getCrossGeometry(layoutAB, crossAB.dependencyId)
    );
    expect(getCrossGeometry(layoutABCWithoutNewCross, crossAC.dependencyId)).toBeUndefined();
    expect(getCrossGeometry(layoutABC, crossAB.dependencyId)).toEqual(
      getCrossGeometry(layoutABCWithoutNewCross, crossAB.dependencyId)
    );
    expect(getCrossGeometry(layoutABC, crossAC.dependencyId)).toBeDefined();
  });

  it('does not leak removed process geometry when reusing a previous layout cache', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const crossAB = createCrossDependency({
      dependencyId: 'cross:ab' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1
    });
    const graphAB = buildJSONTrace([rankA, rankB], [crossAB], {name: 'removed-geometry-ab'});
    const graphB = buildJSONTrace([rankB], [], {name: 'removed-geometry-b'});

    const [layoutAB] = buildTraceLayouts({traceGraphs: [graphAB], settings: baseSettings});
    const [layoutB] = buildTraceLayouts({
      traceGraphs: [graphB],
      previousLayouts: [layoutAB],
      settings: baseSettings
    });

    expect(getSpanGeometry(layoutB, rankA.spans[0]!.spanId)).toBeUndefined();
    expect(getSpanGeometry(layoutB, rankB.spans[0]!.spanId)).toBeDefined();
    expect(getCrossGeometry(layoutB, crossAB.dependencyId)).toBeUndefined();
    expect(layoutB.geometryCache?.processesById[rankA.processId]).toBeUndefined();
    expect(layoutB.geometryCache?.processesById[rankB.processId]).toBeDefined();
  });

  it('rebuilds cached span and cross geometry when the timing window changes', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const crossAB = createCrossDependency({
      dependencyId: 'cross:ab' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1
    });
    const graph = buildJSONTrace([rankA, rankB], [crossAB], {name: 'geometry-timing-window'});
    const [baseLayout] = buildTraceLayouts({traceGraphs: [graph], settings: baseSettings});

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: baseLayout,
      settings: {
        localDependencyMode: baseSettings.localDependencyMode,
        layoutDensity: baseSettings.layoutDensity
      },
      minTimeMs: -1
    });

    expect(getSpanGeometry(rebuiltLayout, rankA.spans[0]!.spanId)).not.toBe(
      getSpanGeometry(baseLayout, rankA.spans[0]!.spanId)
    );
    expect(getCrossGeometry(rebuiltLayout, crossAB.dependencyId)).not.toBe(
      getCrossGeometry(baseLayout, crossAB.dependencyId)
    );
  });

  it('rebuilds not-finished span geometry when an appended rank extends max time', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 100);
    rankA.spans[0]!.timings.test.status = 'not-finished';

    const graphA = buildJSONTrace([rankA], [], {name: 'not-finished-geometry-a'});
    const graphAB = buildJSONTrace([rankA, rankB], [], {name: 'not-finished-geometry-ab'});

    const [layoutA] = buildTraceLayouts({traceGraphs: [graphA], settings: baseSettings});
    const [layoutAB] = buildTraceLayouts({
      traceGraphs: [graphAB],
      previousLayouts: [layoutA],
      settings: baseSettings
    });

    const spanId = rankA.spans[0]!.spanId;
    expect(getSpanGeometry(layoutAB, spanId)).not.toBe(getSpanGeometry(layoutA, spanId));
    expect(layoutAB.geometryCache?.processesById[rankA.processId]?.reuseKey).not.toBe(
      layoutA.geometryCache?.processesById[rankA.processId]?.reuseKey
    );
  });

  it('keeps fast geometry reuse stable for finished ranks when an append extends max time', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 100);
    const graphA = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([rankA], [], {
        name: 'finished-fast-geometry-a',
        timeExtents: {minTimeMs: 0, maxTimeMs: 1}
      })
    );
    const graphAB = buildTraceGraphDataFromJSONTrace(
      buildJSONTrace([rankA, rankB], [], {
        name: 'finished-fast-geometry-ab',
        timeExtents: {minTimeMs: 0, maxTimeMs: 101}
      })
    );
    const processId = rankA.processId as TraceProcessId;
    const stableSpanTable = graphA.chunks.find(chunk => chunk.processId === processId)!.spanTable;
    const stableLocalDependencyTable = graphA.localDependencyTableMap[processId]!;
    const graphABWithStableRankA = {
      ...graphAB,
      localDependencyTableMap: {
        ...graphAB.localDependencyTableMap,
        [processId]: stableLocalDependencyTable
      },
      chunks: graphAB.chunks.map(chunk =>
        chunk.processId === processId
          ? {
              ...chunk,
              spanTable: stableSpanTable,
              localDependencyTable: stableLocalDependencyTable
            }
          : chunk
      )
    } satisfies TestTraceGraphSource;

    const [layoutA] = buildRuntimeTraceLayouts({
      traceGraphs: [graphA],
      settings: baseSettings
    });
    const [layoutAB] = buildRuntimeTraceLayouts({
      traceGraphs: [graphABWithStableRankA],
      previousLayouts: [layoutA],
      settings: baseSettings
    });

    const previousEntry = layoutA.geometryCache?.processesById[rankA.processId];
    const appendedEntry = layoutAB.geometryCache?.processesById[rankA.processId];
    expect(appendedEntry?.fastReuseKey).toBe(previousEntry?.fastReuseKey);
    expect(appendedEntry).toBe(previousEntry);
  });

  it('builds span geometry for incrementally loaded ranks that share process-local stream ids', () => {
    const rank44 = createLocalThreadRank({
      processId: '44',
      rankNum: 44,
      threadIds: ['main_thread'],
      blockStartOffsetMs: 4
    });
    const rank0 = createLocalThreadRank({
      processId: '0',
      rankNum: 0,
      threadIds: ['main_thread'],
      blockStartOffsetMs: 0
    });
    const rank144 = createLocalThreadRank({
      processId: '144',
      rankNum: 144,
      threadIds: ['main_thread'],
      blockStartOffsetMs: 8
    });
    const graph44 = buildJSONTrace([rank44], [], {name: 'repeated-stream-44'});
    const graph440 = buildJSONTrace([rank44, rank0], [], {name: 'repeated-stream-44-0'});
    const graph044 = buildJSONTrace([rank0, rank44], [], {name: 'repeated-stream-0-44'});
    const graph044144 = buildJSONTrace([rank0, rank44, rank144], [], {
      name: 'repeated-stream-0-44-144'
    });

    const [layout44] = buildTraceLayouts({
      traceGraphs: [graph44],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const rank44ProcessRef = requireTraceGraph(layout44).getProcessRefBySpanRef(
      getLayoutSpanRef(layout44, rank44.spans[0]!.spanId)
    );
    const [layout440] = buildTraceLayouts({
      traceGraphs: [graph440],
      previousLayouts: [layout44],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [layout044] = buildTraceLayouts({
      traceGraphs: [graph044],
      previousLayouts: [layout44],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [layout044144] = buildTraceLayouts({
      traceGraphs: [graph044144],
      previousLayouts: [layout044],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    expect(requireTraceGraph(layout440).processIdsByIndex).toEqual(['44', '0']);
    expect(layout440.renderRows.map(row => row.processId)).toEqual(['0', '44']);
    expect(
      requireTraceGraph(layout440).getProcessRefBySpanRef(
        getLayoutSpanRef(layout440, rank44.spans[0]!.spanId)
      )
    ).toBe(rank44ProcessRef);
    expectRankBlocksToHaveGeometry(layout440, rank44);
    expectRankBlocksToHaveGeometry(layout440, rank0);
    expectRankBlocksToHaveGeometry(layout044, rank0);
    expectRankBlocksToHaveGeometry(layout044, rank44);
    expectRankBlocksToHaveGeometry(layout044144, rank0);
    expectRankBlocksToHaveGeometry(layout044144, rank44);
    expectRankBlocksToHaveGeometry(layout044144, rank144);
  });

  it('builds multi-stream process geometry when process-local thread ids repeat', () => {
    const threadIds = ['main_thread', 'compute_low', 'data_parallelism', 'd2h', 'h2d'];
    const rank0 = createLocalThreadRank({
      processId: '0',
      rankNum: 0,
      threadIds,
      blockStartOffsetMs: 0
    });
    const rank44 = createLocalThreadRank({
      processId: '44',
      rankNum: 44,
      threadIds,
      blockStartOffsetMs: 10
    });
    const rank144 = createLocalThreadRank({
      processId: '144',
      rankNum: 144,
      threadIds,
      blockStartOffsetMs: 20
    });
    const graph = buildJSONTrace([rank0, rank44, rank144], [], {
      name: 'repeated-process-local-threads'
    });

    const [separateLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [combinedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    for (const rank of [rank0, rank44, rank144]) {
      expectRankBlocksToHaveGeometry(separateLayout, rank);
      expectRankBlocksToHaveGeometry(combinedLayout, rank);
    }
  });

  it('builds local dependency geometry for ranks that share process-local stream ids', () => {
    const rank0 = createRepeatedThreadDependencyRank({
      processId: '0',
      rankNum: 0,
      threadId: 'main_thread',
      blockStartOffsetMs: 0
    });
    const rank44 = createRepeatedThreadDependencyRank({
      processId: '44',
      rankNum: 44,
      threadId: 'main_thread',
      blockStartOffsetMs: 10
    });
    const graph = buildJSONTrace([rank0, rank44], [], {name: 'repeated-local-dependency'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 8,
        maxVisibleLanesUnlimited: false
      }
    });

    expectRankBlocksToHaveGeometry(layout, rank0);
    expectRankBlocksToHaveGeometry(layout, rank44);
    for (const rank of [rank0, rank44]) {
      const dependency = rank.localDependencies[0]!;
      const geometry = getLayoutLocalDependencyGeometry(layout, dependency.dependencyId);
      expect(geometry, `Expected local dependency geometry for ${rank.processId}`).toBeDefined();
      expect(geometry!.length).toBe(4);
      expect(geometry![1]).toBeCloseTo(getBlockGeometryCenterY(layout, dependency.startSpanId), 6);
      expect(geometry![3]).toBeCloseTo(getBlockGeometryCenterY(layout, dependency.endSpanId), 6);
    }
  });

  it('builds cross-rank dependency geometry when endpoints share process-local stream ids', () => {
    const rank0 = createLocalThreadRank({
      processId: '0',
      rankNum: 0,
      threadIds: ['main_thread'],
      blockStartOffsetMs: 0
    });
    const rank44 = createLocalThreadRank({
      processId: '44',
      rankNum: 44,
      threadIds: ['main_thread'],
      blockStartOffsetMs: 10
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:0-44' as TraceDependencyId,
      startSpanId: rank0.spans[0]!.spanId,
      endSpanId: rank44.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 44
    });
    const graph = buildJSONTrace([rank0, rank44], [crossDependency], {
      name: 'repeated-cross-dependency'
    });

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 8,
        maxVisibleLanesUnlimited: false
      }
    });

    expectRankBlocksToHaveGeometry(layout, rank0);
    expectRankBlocksToHaveGeometry(layout, rank44);
    const geometry = getCrossGeometry(layout, crossDependency.dependencyId);
    expect(geometry).toBeDefined();
    expect(geometry!.length).toBe(4);
    expect(geometry![1]).toBeCloseTo(getBlockGeometryCenterY(layout, rank0.spans[0]!.spanId), 6);
    expect(geometry![3]).toBeCloseTo(getBlockGeometryCenterY(layout, rank44.spans[0]!.spanId), 6);
  });

  it('anchors filtered local parent geometry on visible stitched endpoint spans', () => {
    const rankBase = createNamedRank('rank-filtered-local-geometry', [
      'root',
      'filtered-parent',
      'child'
    ]);
    const rankWithParent = addLocalDependency(rankBase, {
      dependencyId: 'local:root-parent' as TraceDependencyId,
      startSpanId: rankBase.spans[0]!.spanId,
      endSpanId: rankBase.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const rank = addLocalDependency(rankWithParent, {
      dependencyId: 'local:parent-child' as TraceDependencyId,
      startSpanId: rankBase.spans[1]!.spanId,
      endSpanId: rankBase.spans[2]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const graph = buildJSONTrace([rank], [], {name: 'filtered-local-parent-geometry'});

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });
    const traceGraph = requireTraceGraph(layout);
    const stitchedDependency = traceGraph
      .getVisibleLocalDependencySources(getRequiredProcessRef(traceGraph, rank.processId))
      .find(dependency => dependency.endSpanId === rank.spans[2]!.spanId);
    const geometry = stitchedDependency
      ? getLayoutLocalDependencyGeometry(layout, stitchedDependency.dependencyId)
      : undefined;

    expect(stitchedDependency).toMatchObject({
      startSpanId: rank.spans[0]!.spanId,
      endSpanId: rank.spans[2]!.spanId
    });
    expect(geometry).toBeDefined();
    expect(geometry![1]).toBeCloseTo(getBlockGeometryCenterY(layout, rank.spans[0]!.spanId), 6);
    expect(geometry![3]).toBeCloseTo(getBlockGeometryCenterY(layout, rank.spans[2]!.spanId), 6);
  });

  it('anchors stitched cross-rank parent geometry on visible endpoint spans', () => {
    const headRank = createNamedRank('rank-head', ['head-root'], {rankNum: 0});
    const logicalBaseRank = createNamedRank('rank-logical', ['filtered-logical', 'logical-child'], {
      rankNum: 1
    });
    const logicalRank = addLocalDependency(logicalBaseRank, {
      dependencyId: 'rank-logical:parent' as TraceDependencyId,
      startSpanId: logicalBaseRank.spans[0]!.spanId,
      endSpanId: logicalBaseRank.spans[1]!.spanId,
      keywords: new Set(['PARENT'])
    });
    const crossDependency = createCrossDependency({
      dependencyId: 'cross:head-logical-parent' as TraceDependencyId,
      startSpanId: headRank.spans[0]!.spanId,
      endSpanId: logicalRank.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1,
      topology: 'parent',
      keywords: new Set(['PARENT'])
    });
    const graph = buildJSONTrace([headRank, logicalRank], [crossDependency], {
      name: 'filtered-cross-parent-geometry'
    });

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'filtered'}
    });
    const traceGraph = requireTraceGraph(layout);
    const stitchedDependency = traceGraph
      .getVisibleCrossDependencySources()
      .find(dependency => dependency.endSpanId === logicalRank.spans[1]!.spanId);
    const geometry = stitchedDependency
      ? getCrossGeometry(layout, stitchedDependency.dependencyId)
      : undefined;

    expect(stitchedDependency).toMatchObject({
      startSpanId: headRank.spans[0]!.spanId,
      endSpanId: logicalRank.spans[1]!.spanId
    });
    expect(geometry).toBeDefined();
    expect(geometry![1]).toBeCloseTo(getBlockGeometryCenterY(layout, headRank.spans[0]!.spanId), 6);
    expect(geometry![3]).toBeCloseTo(
      getBlockGeometryCenterY(layout, logicalRank.spans[1]!.spanId),
      6
    );
  });

  it('retains a normalized Arrow source on filtered layouts built from plain graphs', () => {
    const graph = createGraph('plain-to-arrow-layout', ['rank-1']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    const traceGraph = requireTraceGraph(layout);
    const spanId = graph.processes[0]!.spans[0]!.spanId;

    expect(
      getSpanRefProcessId(
        traceGraph.processIdsByIndex,
        traceGraph.getSpanRefByExternalBlockId(spanId)!
      )
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(traceGraph.getSpanRefByExternalBlockId(spanId)!)).toBe(0);
  });

  it('builds expected separate-thread offsets for a simple multi-rank graph', () => {
    const graph = createGraph('simple-separate', ['rank-1', 'rank-2']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    expect(layout.processLayouts[0]!.yOffset).toBeCloseTo(0, 6);
    expect(layout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
    expect(layout.threadLayoutMap[graph.processes[0]!.threads[0]!.threadId]!.yPosition).toBeCloseTo(
      1.25,
      6
    );
    expect(layout.threadLayoutMap[graph.processes[1]!.threads[0]!.threadId]!.yPosition).toBeCloseTo(
      3.83,
      6
    );
    expect(
      layout.threadLayoutMap[graph.processes[1]!.threads[0]!.threadId]!.yPosition -
        layout.processLayouts[1]!.yOffset
    ).toBeCloseTo(
      layout.threadLayoutMap[graph.processes[0]!.threads[0]!.threadId]!.yPosition -
        layout.processLayouts[0]!.yOffset,
      6
    );
  });

  it('skips lane assignment in separate-thread mode when the rank opts out', () => {
    const rank = createDependencyRank('rank-no-lanes', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    rank.userData = {laneAssignmentMode: 'none'};

    const graph = buildJSONTrace([rank], [], {name: 'no-lanes-separate'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    const threadLayout = layout.processLayouts[0]!.threadLayouts[0]!;
    expect(threadLayout.lanes?.laneCount).toBe(1);
    expect(threadLayout.spanLaneMap).toEqual(
      new Map([
        [getLayoutSpanRef(layout, rank.spans[0]!.spanId), 0],
        [getLayoutSpanRef(layout, rank.spans[1]!.spanId), 0]
      ])
    );
  });

  it('collapses a separate-thread stream to one visible lane row while preserving lane count', () => {
    const rank = createDependencyRank('rank-collapsed-stream', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'collapsed-separate-stream'});
    const threadId = rank.threads[0]!.threadId;

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'},
      collapsedThreadIds: new Set([threadId])
    });

    const expandedThreadLayout = expandedLayout.threadLayoutMap[threadId]!;
    const collapsedThreadLayout = collapsedLayout.threadLayoutMap[threadId]!;
    expect(expandedThreadLayout.lanes?.laneCount).toBeGreaterThan(1);
    expect(collapsedThreadLayout.visible).toBe(true);
    expect(collapsedThreadLayout.lanes?.laneCount).toBe(expandedThreadLayout.lanes?.laneCount);
    expect(collapsedThreadLayout.lanes?.isCollapsed).toBe(true);
    expect(collapsedThreadLayout.lanes?.laneYPositions).toHaveLength(1);
    expect(collapsedThreadLayout.lanes?.laneYPositions[0]).toBeCloseTo(
      collapsedThreadLayout.yPosition,
      6
    );
  });

  it('lets ref-native expanded thread collapse state override collapsed thread state', () => {
    const rank = createDependencyRank('rank-expanded-thread-override', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'expanded-thread-override'});
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const runtimeGraph = createTestTraceGraph(traceGraphData);
    const threadId = rank.threads[0]!.threadId;
    const threadRef = getRequiredThreadRef(runtimeGraph, threadId);

    const [layout] = buildRuntimeTraceLayouts({
      prebuiltTraceGraphs: [runtimeGraph],
      traceGraphs: [traceGraphData],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'},
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(),
            collapsedThreadRefs: new Set([threadRef]),
            expandedThreadRefs: new Set([threadRef])
          }
        ]
      }
    });

    const threadLayout = layout.threadLayoutMap[threadId]!;
    expect(threadLayout.lanes?.laneCount).toBeGreaterThan(1);
    expect(threadLayout.lanes?.isCollapsed).toBe(false);
    expect(threadLayout.lanes?.laneYPositions.length).toBeGreaterThan(1);
  });

  it('keeps combined-thread lane assignment even when the rank opts out of separate-thread lanes', () => {
    const rank = createDependencyRank('rank-combined-no-lanes', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      },
      {
        threadName: 'worker-2',
        spans: [
          {idSuffix: 'parent', start: 1, end: 12},
          {idSuffix: 'child', start: 1.5, end: 3, parentId: 'worker-2:parent'}
        ]
      }
    ]);
    rank.userData = {laneAssignmentMode: 'none'};

    const graph = buildJSONTrace([rank], [], {name: 'no-lanes-combined'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    const laneMap = getLayoutLanes(layout);
    expect(laneMap.get(getLayoutSpanRef(layout, rank.spans[0]!.spanId))!).toBeLessThan(
      laneMap.get(getLayoutSpanRef(layout, rank.spans[1]!.spanId))!
    );
    expect(laneMap.get(getLayoutSpanRef(layout, rank.spans[2]!.spanId))!).toBeLessThan(
      laneMap.get(getLayoutSpanRef(layout, rank.spans[3]!.spanId))!
    );
  });

  it('applies combined-thread visible lane overrides without collapsed processes', () => {
    const rank = createDependencyRank('rank-combined-visible-lanes', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'first', start: 0, end: 20},
          {idSuffix: 'second', start: 1, end: 10},
          {idSuffix: 'third', start: 2, end: 4}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'combined-visible-lane-overrides'});
    const [baselineLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const threadId = rank.threads[0]!.threadId;
    const baselineStreamLayout = baselineLayout.threadLayoutMap[threadId]!;
    const focusedBlock = rank.spans[2]!;
    const focusedLaneIndex =
      baselineStreamLayout.spanLaneMap?.get(
        getLayoutSpanRef(baselineLayout, focusedBlock.spanId)
      ) ?? 0;

    const [compactLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      threadLaneLayoutOverrides: {
        [threadId]: {visibleLaneIndices: [focusedLaneIndex]}
      }
    });
    const compactStreamLayout = compactLayout.threadLayoutMap[threadId]!;
    const baselineGeometry = getSpanGeometry(baselineLayout, focusedBlock.spanId)!;
    const compactGeometry = getSpanGeometry(compactLayout, focusedBlock.spanId)!;
    const hiddenBlockSpanRef = getLayoutSpanRef(compactLayout, rank.spans[0]!.spanId);
    const focusedBlockSpanRef = getLayoutSpanRef(compactLayout, focusedBlock.spanId);
    const hiddenBlockVisibility = getTraceLayoutSpanVisibility({
      traceLayout: compactLayout,
      spanRef: hiddenBlockSpanRef
    });
    const focusedBlockVisibility = getTraceLayoutSpanVisibility({
      traceLayout: compactLayout,
      spanRef: focusedBlockSpanRef
    });

    expect(focusedLaneIndex).toBeGreaterThan(0);
    expect(compactStreamLayout.lanes?.visibleLaneIndices).toEqual([focusedLaneIndex]);
    expect(compactStreamLayout.lanes?.laneYPositions).toHaveLength(1);
    expect(compactGeometry[1]).toBeLessThan(baselineGeometry[1]);
    expect(focusedBlockVisibility?.visible).toBe(true);
    expect(isTraceLayoutSpanVisible(focusedBlockVisibility!.visibilityFlags)).toBe(true);
    expect(hiddenBlockVisibility?.visible).toBe(false);
    expect(
      hasTraceLayoutSpanVisibilityFlag(
        hiddenBlockVisibility!.visibilityFlags,
        traceLayoutSpanVisibilityFlags.laneHidden
      )
    ).toBe(true);
    const hiddenGeometry = expectZeroHeightNavigableGeometry(compactLayout, hiddenBlockSpanRef);
    expect(hiddenGeometry[1]).toBeCloseTo((compactGeometry[1]! + compactGeometry[3]!) / 2, 6);
  });

  it('maps sparse combined-thread visible lane overrides to compact lane positions', () => {
    const rank = createDependencyRank('rank-combined-sparse-visible-lanes', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'lane-0', start: 0, end: 20},
          {idSuffix: 'lane-1', start: 1, end: 10},
          {idSuffix: 'lane-2', start: 2, end: 4}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'combined-sparse-visible-lanes'});
    const [baselineLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const threadId = rank.threads[0]!.threadId;
    const baselineStreamLayout = baselineLayout.threadLayoutMap[threadId]!;
    const lane0Block = rank.spans[0]!;
    const lane2Block = rank.spans[2]!;
    const lane0Index =
      baselineStreamLayout.spanLaneMap?.get(getLayoutSpanRef(baselineLayout, lane0Block.spanId)) ??
      0;
    const lane2Index =
      baselineStreamLayout.spanLaneMap?.get(getLayoutSpanRef(baselineLayout, lane2Block.spanId)) ??
      0;

    const [compactLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      threadLaneLayoutOverrides: {
        [threadId]: {visibleLaneIndices: [lane0Index, lane2Index]}
      }
    });
    const compactStreamLayout = compactLayout.threadLayoutMap[threadId]!;
    const lane0Geometry = getSpanGeometry(compactLayout, lane0Block.spanId)!;
    const lane2Geometry = getSpanGeometry(compactLayout, lane2Block.spanId)!;
    const lane0CenterY = (lane0Geometry[1]! + lane0Geometry[3]!) / 2;
    const lane2CenterY = (lane2Geometry[1]! + lane2Geometry[3]!) / 2;

    expect(lane0Index).toBe(0);
    expect(lane2Index).toBeGreaterThan(1);
    expect(compactStreamLayout.lanes?.visibleLaneIndices).toEqual([lane0Index, lane2Index]);
    expect(compactStreamLayout.lanes?.laneYPositions).toHaveLength(2);
    expect(lane0CenterY).toBeCloseTo(compactStreamLayout.lanes!.laneYPositions[0]!);
    expect(lane2CenterY).toBeCloseTo(compactStreamLayout.lanes!.laneYPositions[1]!);
    expect(lane2CenterY).toBeGreaterThan(lane0CenterY);
  });

  it('preserves combined-thread lane ordering when focusing selected span refs', () => {
    const rank = createDependencyRank('rank-combined-focused-order', [
      {
        threadName: 'worker-1',
        spans: [{idSuffix: 'parent', start: 0, end: 100}]
      },
      {
        threadName: 'worker-2',
        spans: [
          {idSuffix: 'spacer', start: 5, end: 95},
          {idSuffix: 'child', start: 20, end: 30, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    const traceGraph = createRuntimeTraceGraph(
      buildJSONTrace([rank], [], {name: 'combined-focused-order'})
    );
    const [layout] = buildTraceLayouts({
      traceGraphs: [traceGraph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const parentSpanRef = getLayoutSpanRef(layout, rank.spans[0]!.spanId);
    const childSpanRef = getLayoutSpanRef(layout, rank.spans[2]!.spanId);
    const baselineSpanLaneMap = getLayoutLanes(layout);
    const parentLaneIndex = baselineSpanLaneMap.get(parentSpanRef);
    const childLaneIndex = baselineSpanLaneMap.get(childSpanRef);

    expect(parentLaneIndex).toBe(0);
    expect(childLaneIndex).toBeGreaterThan(1);

    const focusedLayout = buildTraceLayoutForSpanRefs({
      traceGraph,
      traceLayout: layout,
      spanRefs: [parentSpanRef, childSpanRef],
      settings: {
        localDependencyMode: baseSettings.localDependencyMode,
        layoutDensity: baseSettings.layoutDensity,
        sortThreads: baseSettings.sortThreads,
        maxVisibleLanesPerThread: baseSettings.maxVisibleLanesPerThread,
        trackAggregationMode: 'combine-threads'
      }
    });
    const focusedCombinedThreadLayout = focusedLayout.processLayouts[0]!.threadLayouts[0]!;

    expect(focusedCombinedThreadLayout.lanes?.visibleLaneIndices).toEqual([
      parentLaneIndex,
      childLaneIndex
    ]);
    expect(focusedCombinedThreadLayout.spanLaneMap?.get(parentSpanRef)).toBe(parentLaneIndex);
    expect(focusedCombinedThreadLayout.spanLaneMap?.get(childSpanRef)).toBe(childLaneIndex);
  });

  it('does not fall back to lane zero when span-lane metadata is missing for a focused span', () => {
    const rank = createDependencyRank('rank-missing-focused-lane', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'lane-0', start: 0, end: 20},
          {idSuffix: 'lane-1', start: 1, end: 10},
          {idSuffix: 'lane-2', start: 2, end: 4}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'missing-focused-lane'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const traceGraph = requireTraceGraph(layout);
    const focusedBlock = rank.spans[2]!;
    const focusedSpanRef = getLayoutSpanRef(layout, focusedBlock.spanId);
    const focusedBlockSource = traceGraph
      .getVisibleProcessLayoutBlocks(getRequiredProcessRef(traceGraph, rank.processId))
      .find(span => span.spanId === focusedBlock.spanId);
    const streamLayout = layout.threadLayoutMap[focusedBlock.threadId]!;
    const mutatedSpanLaneMap = new Map(streamLayout.spanLaneMap);
    mutatedSpanLaneMap.delete(focusedSpanRef);
    const focusedBoundingBox = traceGeometryLayoutCommon.getSpanBoundingBox(
      focusedBlockSource!,
      {
        ...layout.threadLayoutMap,
        [focusedBlock.threadId]: {
          ...streamLayout,
          spanLaneMap: mutatedSpanLaneMap
        }
      },
      traceGraph.maxTimeMs,
      traceGraph.minTimeMs
    );

    expect(focusedBlockSource).toBeDefined();
    expect(focusedBoundingBox[0]).toBeLessThan(focusedBoundingBox[2]!);
    expect(focusedBoundingBox[1]).toBeCloseTo(focusedBoundingBox[3]!, 6);
  });

  it('preserves parent-before-child order and avoids same-lane overlaps in combined mode', () => {
    const rank = createDependencyRank('rank-combined', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      },
      {
        threadName: 'worker-2',
        spans: [
          {idSuffix: 'parent', start: 1, end: 12},
          {idSuffix: 'child', start: 1.5, end: 3, parentId: 'worker-2:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'combined-overlap'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    const laneMap = getLayoutLanes(layout);
    const rankBlocks = rank.spans;

    const parentLane = laneMap.get(getLayoutSpanRef(layout, rankBlocks[0]!.spanId));
    const childLane = laneMap.get(getLayoutSpanRef(layout, rankBlocks[1]!.spanId));
    const parent2Lane = laneMap.get(getLayoutSpanRef(layout, rankBlocks[2]!.spanId));
    const child2Lane = laneMap.get(getLayoutSpanRef(layout, rankBlocks[3]!.spanId));
    expect(parentLane).toBeDefined();
    expect(childLane).toBeDefined();
    expect(parent2Lane).toBeDefined();
    expect(child2Lane).toBeDefined();
    expect(parentLane!).toBeLessThan(childLane!);
    expect(parent2Lane!).toBeLessThan(child2Lane!);
    expect(getBlockGeometryCenterY(layout, rankBlocks[0]!.spanId)).toBeLessThan(
      getBlockGeometryCenterY(layout, rankBlocks[1]!.spanId)
    );
    expect(getBlockGeometryCenterY(layout, rankBlocks[2]!.spanId)).toBeLessThan(
      getBlockGeometryCenterY(layout, rankBlocks[3]!.spanId)
    );

    const blocksByLane = new Map<number, Array<TraceSpan>>();
    for (const span of rankBlocks) {
      const lane = laneMap.get(getLayoutSpanRef(layout, span.spanId));
      expect(lane).toBeDefined();
      const existing = blocksByLane.get(lane!);
      const row = existing ?? [];
      row.push(span);
      blocksByLane.set(lane!, row);
    }

    for (const row of blocksByLane.values()) {
      row.sort((a, b) => {
        const aTiming = a.timings.test;
        const bTiming = b.timings.test;
        return aTiming.startTimeMs - bTiming.startTimeMs;
      });
      for (let index = 1; index < row.length; index += 1) {
        const previous = row[index - 1];
        const current = row[index];
        if (!previous || !current) {
          continue;
        }
        expect(blocksOverlap(previous.timings.test, current.timings.test)).toBe(false);
      }
    }
  });

  it('renders local dependency geometry when endpoint lanes are hidden by overflow', () => {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'overflow-thread',
      threadId: 'overflow-thread-id' as TraceThreadId,
      processId: 'rank-overflow'
    };

    const localDependencies: TraceProcess['localDependencies'] = [];
    const spans: TraceSpan[] = [];

    for (let index = 0; index <= 30; index += 1) {
      const spanId = `overflow-span-${index}` as TraceSpanId;
      const span: TraceSpan = {
        type: 'trace-span',
        spanId,
        threadId: thread.threadId,
        processName: 'rank-overflow',
        name: spanId,
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
      };
      spans.push(span);
    }

    const dependencyId = 'overflow:dep' as TraceDependencyId;
    localDependencies.push({
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: spans[0]!.spanId,
      endSpanId: spans[spans.length - 1]!.spanId,
      keywords: new Set(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    });

    spans[0]!.localDependencyIds.push(dependencyId);

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
      localDependencies,
      remoteDependencies: []
    };

    const graph = buildJSONTrace([rank], [], {
      name: 'hidden-lane-local-dependency'
    });

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 8,
        maxVisibleLanesUnlimited: false
      }
    });

    const threadLayout = layout.threadLayoutMap[thread.threadId];
    expect(threadLayout).toBeDefined();
    expect(threadLayout.lanes?.renderedLaneCount).toBeLessThan(
      threadLayout?.spanLaneMap?.get(getLayoutSpanRef(layout, spans[spans.length - 1]!.spanId)) ?? 0
    );

    const geometry = getLayoutLocalDependencyGeometry(layout, dependencyId)!;
    expect(geometry.length).toBe(4);
    expect(geometry.every(value => Number.isFinite(value))).toBe(true);
  });

  it('uses the lane pruning limit setting for separate-thread overflow', () => {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'overflow-thread',
      threadId: 'overflow-thread-id' as TraceThreadId,
      processId: 'rank-overflow'
    };

    const spans: TraceSpan[] = [];

    for (let index = 0; index <= 6; index += 1) {
      const spanId = `overflow-span-${index}` as TraceSpanId;
      spans.push({
        type: 'trace-span',
        spanId,
        threadId: thread.threadId,
        processName: 'rank-overflow',
        name: spanId,
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
      remoteDependencies: []
    };

    const graph = buildJSONTrace([rank], [], {name: 'custom-lane-pruning-limit'});

    const [tightLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 4,
        maxVisibleLanesUnlimited: false
      }
    });
    const [looseLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 8,
        maxVisibleLanesUnlimited: false
      }
    });
    const [unlimitedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 4,
        maxVisibleLanesUnlimited: true
      }
    });
    const [zeroLimitLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'separate-threads',
        maxVisibleLanesPerThread: 0,
        maxVisibleLanesUnlimited: false
      }
    });

    expect(tightLayout.threadLayoutMap[thread.threadId]?.lanes?.laneCount).toBe(4);
    expect(tightLayout.threadLayoutMap[thread.threadId]?.lanes?.renderedLaneCount).toBe(3);
    expect(looseLayout.threadLayoutMap[thread.threadId]?.lanes?.laneCount).toBe(7);
    expect(looseLayout.threadLayoutMap[thread.threadId]?.lanes?.renderedLaneCount).toBe(7);
    expect(unlimitedLayout.threadLayoutMap[thread.threadId]?.lanes?.laneCount).toBe(7);
    expect(unlimitedLayout.threadLayoutMap[thread.threadId]?.lanes?.renderedLaneCount).toBe(7);
    expect(zeroLimitLayout.threadLayoutMap[thread.threadId]?.lanes?.laneCount).toBe(7);
    expect(zeroLimitLayout.threadLayoutMap[thread.threadId]?.lanes?.renderedLaneCount).toBe(7);

    const overflowSpanRef = getLayoutSpanRef(tightLayout, spans[spans.length - 1]!.spanId);
    const overflowVisibility = getTraceLayoutSpanVisibility({
      traceLayout: tightLayout,
      spanRef: overflowSpanRef
    });
    expect(overflowVisibility?.visible).toBe(false);
    expect(
      hasTraceLayoutSpanVisibilityFlag(
        overflowVisibility!.visibilityFlags,
        traceLayoutSpanVisibilityFlags.laneOverflow
      )
    ).toBe(true);
    expectZeroHeightNavigableGeometry(tightLayout, overflowSpanRef);
  });

  it('returns only the primary layout when layout mode is step1', () => {
    const graphA = createGraph('A', ['rank-1', 'rank-2']);
    const graphB = createGraph('B', ['rank-1']);

    const layouts = buildTraceLayouts({
      traceGraphs: [graphA, graphB],
      settings: baseSettings,
      layoutMode: 'step1'
    });

    expect(layouts).toHaveLength(1);
    expect(layouts[0]!.processLayouts).toHaveLength(graphA.processes.length);
  });

  it('stacks layouts sequentially when layout mode is sequential', () => {
    const graphA = createGraph('A', ['rank-1', 'rank-2', 'rank-3']);
    const graphB = createGraph('B', ['rank-1', 'rank-2']);

    const [layoutA, layoutB] = buildTraceLayouts({
      traceGraphs: [graphA, graphB],
      settings: baseSettings,
      layoutMode: 'sequential'
    });

    [0, 2.58, 5.16].forEach((expectedOffset, index) => {
      expect(layoutA.processLayouts[index]!.yOffset).toBeCloseTo(expectedOffset, 6);
    });
    [6.99, 9.57].forEach((expectedOffset, index) => {
      expect(layoutB.processLayouts[index]!.yOffset).toBeCloseTo(expectedOffset, 6);
    });
  });

  it('interleaves layouts when layout mode is interleaved', () => {
    const graphA = createGraph('A', ['rank-1', 'rank-2', 'rank-3']);
    const graphB = createGraph('B', ['rank-1', 'rank-2']);

    const [layoutA, layoutB] = buildTraceLayouts({
      traceGraphs: [graphA, graphB],
      settings: {...baseSettings, processLayoutMode: 'interleaved'},
      layoutMode: 'interleaved'
    });

    [0, 5.16, 9.57].forEach((expectedOffset, index) => {
      expect(layoutA.processLayouts[index]!.yOffset).toBeCloseTo(expectedOffset, 6);
    });
    [2.58, 7.74].forEach((expectedOffset, index) => {
      expect(layoutB.processLayouts[index]!.yOffset).toBeCloseTo(expectedOffset, 6);
    });
  });

  it('applies top padding once across interleaved comparison layouts', () => {
    const graphA = createGraph('A', ['rank-1']);
    const graphB = createGraph('B', ['rank-1']);

    const [layoutA, layoutB] = buildTraceLayouts({
      traceGraphs: [graphA, graphB],
      settings: {...baseSettings, processLayoutMode: 'interleaved'},
      layoutMode: 'interleaved',
      topPadding: 1
    });

    expect(layoutA.processLayouts[0]!.yOffset).toBeCloseTo(1, 6);
    expect(layoutB.processLayouts[0]!.yOffset).toBeCloseTo(2.83, 6);
    expect(
      layoutA.threadLayoutMap[graphA.processes[0]!.threads[0]!.threadId].yPosition
    ).toBeCloseTo(2.25, 6);
    expect(
      layoutB.threadLayoutMap[graphB.processes[0]!.threads[0]!.threadId].yPosition
    ).toBeCloseTo(4.08, 6);
  });

  it('does not offset process rows for graph-global event rows', () => {
    const rank = createRank('rank-1', 0);
    const graphWithoutEvents = buildJSONTrace([rank], [], {name: 'without-events'});
    const graphWithEvents = buildJSONTrace([rank], [], {
      name: 'with-events',
      events: [
        {
          type: 'trace-event',
          eventId: 'event-1' as TraceEventId,
          name: 'Run event',
          atTimeMs: 0
        }
      ]
    });

    const [layoutWithoutEvents] = buildTraceLayouts({
      traceGraphs: [graphWithoutEvents],
      settings: {...baseSettings, showGlobalEvents: true},
      topPadding: 1
    });
    const [layoutWithEvents] = buildTraceLayouts({
      traceGraphs: [graphWithEvents],
      settings: {...baseSettings, showGlobalEvents: true},
      topPadding: 1
    });

    expect(layoutWithEvents.globalEventRow).toBeDefined();
    expect(layoutWithEvents.processLayouts[0]!.yOffset).toBeCloseTo(
      layoutWithoutEvents.processLayouts[0]!.yOffset,
      6
    );
  });

  it('normalizes comparison graph span geometry to each graph time origin', () => {
    const graphA = buildJSONTrace([createRank('rank-1', 0, 1_000)], [], {name: 'A'});
    const graphB = buildJSONTrace([createRank('rank-1', 0, 1_000_000)], [], {name: 'B'});

    const [layoutA, layoutB] = buildTraceLayouts({
      traceGraphs: [graphA, graphB],
      settings: {...baseSettings, processLayoutMode: 'interleaved'},
      layoutMode: 'interleaved',
      minTimeMs: materializeJSONTrace(graphA).minTimeMs
    });

    expect(getSpanGeometry(layoutA, 'rank-1-span' as TraceSpanId)?.[0]).toBeCloseTo(0, 6);
    expect(getSpanGeometry(layoutB, 'rank-1-span' as TraceSpanId)?.[0]).toBeCloseTo(0, 6);
  });

  it('hides collapsed ranks while keeping spacing consistent with visible ranks', () => {
    const graph = createGraph('A', ['rank-1', 'rank-2']);

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([graph.processes[0]!.processId])
    });

    expect(layout.threadLayoutMap[graph.processes[0]!.threads[0]!.threadId].visible).toBe(false);
    expect(layout.processLayouts[0]!.yOffset).toBeCloseTo(0, 6);
    expect(layout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
  });

  it('accepts ref-native collapse state for collapsed process layout input', () => {
    const graph = createGraph('ref-collapse', ['rank-1', 'rank-2']);
    const traceGraphData = buildTraceGraphDataFromJSONTrace(graph);
    const runtimeGraph = createTestTraceGraph(traceGraphData);
    const firstProcessRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);

    const [layout] = buildRuntimeTraceLayouts({
      prebuiltTraceGraphs: [runtimeGraph],
      traceGraphs: [traceGraphData],
      settings: baseSettings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set([firstProcessRef]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });

    expect(layout.processLayouts[0]!.isCollapsed).toBe(true);
    expect(layout.threadLayoutMap[graph.processes[0]!.threads[0]!.threadId].visible).toBe(false);
  });

  it('keeps graph-local process refs independent across multi-graph layouts', () => {
    const graphA = createGraph('ref-collapse-a', ['rank-1']);
    const graphB = createGraph('ref-collapse-b', ['rank-1']);
    const arrowGraphA = buildTraceGraphDataFromJSONTrace(graphA);
    const arrowGraphB = buildTraceGraphDataFromJSONTrace(graphB);
    const runtimeGraphA = createTestTraceGraph(arrowGraphA);
    const runtimeGraphB = createTestTraceGraph(arrowGraphB);
    const processRefA = getRequiredProcessRef(runtimeGraphA, graphA.processes[0]!.processId);
    const processRefB = getRequiredProcessRef(runtimeGraphB, graphB.processes[0]!.processId);

    const [layoutA, layoutB] = buildRuntimeTraceLayouts({
      prebuiltTraceGraphs: [runtimeGraphA, runtimeGraphB],
      traceGraphs: [arrowGraphA, arrowGraphB],
      settings: {...baseSettings, processLayoutMode: 'interleaved'},
      layoutMode: 'interleaved',
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          },
          {
            collapsedProcessRefs: new Set([processRefB]),
            collapsedThreadRefs: new Set(),
            expandedThreadRefs: new Set()
          }
        ]
      }
    });

    expect(processRefA).toBe(processRefB);
    expect(layoutA.processLayouts[0]!.isCollapsed).toBe(false);
    expect(layoutB.processLayouts[0]!.isCollapsed).toBe(true);
  });

  it('serializes and deserializes graph-local collapse refs at the id edge', () => {
    const graph = createGraph('serialized-collapse', ['rank-1', 'rank-2']);
    const runtimeGraph = createRuntimeTraceGraph(graph);
    const firstProcessRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);
    const firstThreadRef = getRequiredThreadRef(
      runtimeGraph,
      graph.processes[0]!.threads[0]!.threadId
    );

    const serialized = serializeTraceGraphCollapseState(runtimeGraph, {
      collapsedProcessRefs: new Set([firstProcessRef]),
      collapsedThreadRefs: new Set([firstThreadRef]),
      expandedThreadRefs: new Set([firstThreadRef])
    });
    const deserialized = deserializeTraceGraphCollapseState(runtimeGraph, {
      ...serialized,
      collapsedProcessIds: [...serialized.collapsedProcessIds, 'missing-rank'],
      collapsedThreadIds: [...serialized.collapsedThreadIds, 'missing-thread' as TraceThreadId],
      expandedThreadIds: [...serialized.expandedThreadIds, 'missing-thread' as TraceThreadId]
    });

    expect(serialized.collapsedProcessIds).toEqual([graph.processes[0]!.processId]);
    expect(serialized.collapsedThreadIds).toEqual([graph.processes[0]!.threads[0]!.threadId]);
    expect(deserialized.collapsedProcessRefs).toEqual(new Set([firstProcessRef]));
    expect(deserialized.collapsedThreadRefs).toEqual(new Set([firstThreadRef]));
    expect(deserialized.expandedThreadRefs).toEqual(new Set([firstThreadRef]));
  });

  it('structurally collapses a combined-thread process and pulls later ranks up', () => {
    const firstRank = createDependencyRank('rank-1', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      },
      {
        threadName: 'worker-2',
        spans: [
          {idSuffix: 'parent', start: 1, end: 12},
          {idSuffix: 'child', start: 1.5, end: 3, parentId: 'worker-2:parent'}
        ]
      }
    ]);
    firstRank.rankNum = 0;
    const secondRank = createRank('rank-2', 1, 30);
    const graph = buildJSONTrace([firstRank, secondRank], [], {name: 'combined-collapse'});

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapsedProcessIds: new Set([firstRank.processId])
    });

    expect(collapsedLayout.processLayouts[0]!.isCollapsed).toBe(true);
    expect(collapsedLayout.processLayouts[0]!.yHeight).toBeLessThan(
      expandedLayout.processLayouts[0]!.yHeight
    );
    expect(collapsedLayout.processLayouts[1]!.yOffset).toBeLessThan(
      expandedLayout.processLayouts[1]!.yOffset
    );
    expect(collapsedLayout.threadLayoutMap[firstRank.threads[0]!.threadId]!.visible).toBe(false);
    expect(collapsedLayout.threadLayoutMap[firstRank.threads[1]!.threadId]!.visible).toBe(false);
    expect(collapsedLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(false);
    expect(collapsedLayout.processLayouts[0]!.collapsedActivityY).toBeGreaterThan(
      collapsedLayout.processLayouts[0]!.yOffset
    );
    expect(collapsedLayout.processLayouts[1]!.yOffset).toBeCloseTo(2.81, 6);
    expect(collapsedLayout.threadLayoutMap[secondRank.threads[0]!.threadId].yPosition).toBeCloseTo(
      collapsedLayout.processLayouts[1]!.yOffset + 1.25,
      6
    );
  });

  it('hides a separate-thread rank with no visible span content by default', () => {
    const graph = createGraph('empty-expanded-spacing-hidden', ['rank-1', 'rank-2']);

    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'rank-1-span'}
    });

    expect(filteredLayout.processLayouts[0]).toBeUndefined();
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeCloseTo(0, 6);
  });

  it('keeps an expanded separate-thread rank with no visible span content when empty processes are shown', () => {
    const graph = createGraph('empty-expanded-spacing', ['rank-1', 'rank-2']);

    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([graph.processes[0]!.processId])
    });
    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, showEmptyProcesses: true, spanFilter: 'rank-1-span'}
    });

    expect(filteredLayout.processLayouts[0]!.isCollapsed).toBe(false);
    expect(filteredLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(true);
    expect(filteredLayout.processLayouts[0]!.threadLayouts[0]!.spanLaneMap).toEqual(new Map());
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeGreaterThanOrEqual(
      collapsedLayout.processLayouts[1]!.yOffset
    );
  });

  it('hides a combined-thread rank with no visible span content by default', () => {
    const graph = createGraph('empty-expanded-combined-spacing-hidden', ['rank-1', 'rank-2']);

    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'combine-threads',
        spanFilter: 'rank-1-span'
      }
    });

    expect(filteredLayout.processLayouts[0]).toBeUndefined();
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeCloseTo(0, 6);
  });

  it('keeps an expanded combined-thread rank with no visible span content when empty processes are shown', () => {
    const graph = createGraph('empty-expanded-combined-spacing', ['rank-1', 'rank-2']);

    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      collapsedProcessIds: new Set([graph.processes[0]!.processId])
    });
    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {
        ...baseSettings,
        trackAggregationMode: 'combine-threads',
        showEmptyProcesses: true,
        spanFilter: 'rank-1-span'
      }
    });

    expect(filteredLayout.processLayouts[0]!.isCollapsed).toBe(false);
    expect(filteredLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(true);
    expect(filteredLayout.processLayouts[0]!.threadLayouts[0]!.spanLaneMap).toEqual(new Map());
    expect(filteredLayout.processLayouts[1]!.yOffset).toBeGreaterThanOrEqual(
      collapsedLayout.processLayouts[1]!.yOffset
    );
  });

  it('keeps canonical bounds stable during geometry rebuild with a new min time', () => {
    const graph = buildJSONTrace([createRank('rank-1', 0)], [], {
      name: 'A',
      timeExtents: {minTimeMs: 0, maxTimeMs: 1}
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: {
        ...layout,
        expandedBounds: [
          [999, 999],
          [1000, 1000]
        ]
      },
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      minTimeMs: 10
    });

    expect(rebuiltLayout.expandedBounds).toEqual(rebuiltLayout.currentBounds);
    expect(getSpanGeometry(rebuiltLayout, graph.processes[0]!.spans[0]!.spanId)?.[0]).toBeCloseTo(
      -10,
      6
    );
    expect(rebuiltLayout.expandedBounds[0][0]).toBeCloseTo(0, 6);
    expect(rebuiltLayout.expandedBounds[1][0]).toBeCloseTo(1, 6);
  });

  it('rebuilds geometry without routing-specific inputs', () => {
    const rank = createDependencyRank('rank-routing-mode', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 30, end: 40, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'routing-mode-rebuild'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const buildLocalDependencyPathSpy = vi.spyOn(
      traceGeometryLayoutCommon,
      'getLocalDependencyPathFlat'
    );

    rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: {
        ...layout,
        geometryCache: undefined
      },
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      minTimeMs: -1
    });

    expect(buildLocalDependencyPathSpy).toHaveBeenCalledTimes(1);
    expect(buildLocalDependencyPathSpy.mock.calls[0]?.[0]).not.toHaveProperty('settings');

    buildLocalDependencyPathSpy.mockRestore();
  });

  it('does not rebuild expanded geometry when computing expanded bounds', () => {
    const graph = createGraph('A', ['rank-1']);
    const buildBlockGeometrySpy = vi.spyOn(traceGeometryLayoutCommon, 'getSpanBoundingBox');

    buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    expect(buildBlockGeometrySpy).toHaveBeenCalledTimes(1);
    buildBlockGeometrySpy.mockRestore();
  });

  it('keeps expanded bounds equal to the expanded layout bounds when a process is collapsed', () => {
    const graph = createGraph('A', ['rank-1', 'rank-2']);
    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([graph.processes[0]!.processId])
    });

    expect(collapsedLayout.expandedBounds).toEqual(expandedLayout.currentBounds);
  });

  it('rebuilds geometry from the selected timing key instead of the extremal envelope', () => {
    const rank = createRank('rank-1', 0, 0);
    const span = rank.spans[0]!;
    span.primaryTimingKey = 'latest';
    span.timings = {
      latest: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 10,
        durationMs: 10,
        durationMsAsString: '10ms'
      },
      p50: {
        status: 'finished',
        startTimeMs: 3,
        endTimeMs: 5,
        durationMs: 2,
        durationMsAsString: '2ms'
      }
    };

    const graph = buildJSONTrace([rank], [], {
      name: 'timing-key-geometry',
      timeExtents: {minTimeMs: 0, maxTimeMs: 10}
    });
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });

    const rebuiltBlockGeometry = getSpanGeometry(rebuiltLayout, span.spanId)!;
    expect(rebuiltBlockGeometry[0]).toBeCloseTo(3, 6);
    expect(rebuiltBlockGeometry[2]).toBeCloseTo(5, 6);
    expect(rebuiltLayout.expandedBounds).toEqual(rebuiltLayout.currentBounds);
    expect(rebuiltLayout.expandedBounds[0][0]).toBeCloseTo(0, 6);
    expect(rebuiltLayout.expandedBounds[1][0]).toBeCloseTo(10, 6);
  });

  it('keeps lane layout unchanged when rebuilding geometry for a selected timing key', () => {
    const rank = createDependencyRank('rank-combined-aggregation', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 2, end: 4, parentId: 'worker-1:parent'}
        ]
      },
      {
        threadName: 'worker-2',
        spans: [
          {idSuffix: 'parent', start: 1, end: 12},
          {idSuffix: 'child', start: 1.5, end: 3, parentId: 'worker-2:parent'}
        ]
      }
    ]);
    rank.spans.forEach((span, index) => {
      const timing = span.timings.test;
      span.timings.p50 = {
        ...timing,
        startTimeMs: timing.startTimeMs + 10 + index,
        endTimeMs: timing.endTimeMs + 10 + index,
        durationMsAsString: `${timing.durationMs}ms`
      };
    });

    const graph = buildJSONTrace([rank], [], {name: 'timing-key-lanes'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });

    expect(getLayoutLanes(rebuiltLayout)).toEqual(getLayoutLanes(layout));
    expect(rebuiltLayout.processLayouts).toEqual(layout.processLayouts);
    expect(rebuiltLayout.threadLayoutMap).toEqual(layout.threadLayoutMap);
  });

  it('reuses the existing layout when the requested timing key resolves to the current geometry', () => {
    const rank = createRank('rank-1', 0, 0);
    const span = rank.spans[0]!;
    span.primaryTimingKey = 'latest';
    span.timings.latest = span.timings.test;

    const graph = buildJSONTrace([rank], [], {name: 'timing-key-noop'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'latest'
    });

    expect(rebuiltLayout).toBe(layout);
  });

  it('moves dependency geometry in x without changing y when rebuilding for a selected timing key', () => {
    const rank = createDependencyRank('rank-dependency-aggregation', [
      {
        threadName: 'worker-1',
        spans: [
          {idSuffix: 'parent', start: 0, end: 20},
          {idSuffix: 'child', start: 30, end: 40, parentId: 'worker-1:parent'}
        ]
      }
    ]);
    rank.spans[0]!.primaryTimingKey = 'latest';
    rank.spans[1]!.primaryTimingKey = 'latest';
    rank.spans[0]!.timings.latest = rank.spans[0]!.timings.test;
    rank.spans[1]!.timings.latest = rank.spans[1]!.timings.test;
    rank.spans[0]!.timings.p50 = {
      ...rank.spans[0]!.timings.test,
      startTimeMs: 5,
      endTimeMs: 10,
      durationMs: 5,
      durationMsAsString: '5ms'
    };
    rank.spans[1]!.timings.p50 = {
      ...rank.spans[1]!.timings.test,
      startTimeMs: 31,
      endTimeMs: 35,
      durationMs: 4,
      durationMsAsString: '4ms'
    };

    const graph = buildJSONTrace([rank], [], {name: 'timing-key-dependency-geometry'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'}
    });

    const dependencyId = rank.localDependencies[0]!.dependencyId;
    const originalGeometry = getLayoutLocalDependencyGeometry(layout, dependencyId)!;
    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        localDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });
    const rebuiltGeometry = getLayoutLocalDependencyGeometry(rebuiltLayout, dependencyId)!;

    expect(rebuiltGeometry[0]).not.toBeCloseTo(originalGeometry[0]!, 6);
    expect(rebuiltGeometry[2]).not.toBeCloseTo(originalGeometry[2]!, 6);
    expect(rebuiltGeometry[1]).toBeCloseTo(originalGeometry[1]!, 6);
    expect(rebuiltGeometry[3]).toBeCloseTo(originalGeometry[3]!, 6);
  });

  it('keeps canonical X bounds when span filtering removes later spans', () => {
    const rank = createNamedRank('rank-filter-bounds', ['visible', 'filtered']);
    rank.spans[0]!.timings.test.startTimeMs = 0;
    rank.spans[0]!.timings.test.endTimeMs = 1;
    rank.spans[1]!.timings.test.startTimeMs = 20;
    rank.spans[1]!.timings.test.endTimeMs = 30;
    const graph = buildJSONTrace([rank], [], {
      name: 'filter-bounds',
      timeExtents: {minTimeMs: 0, maxTimeMs: 30}
    });

    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, spanFilter: 'visible'}
    });

    const traceGraph = requireTraceGraph(layout);
    expect(getVisibleSpans(rank.spans, traceGraph)).toHaveLength(1);
    expect(layout.currentBounds[0][0]).toBeCloseTo(0, 6);
    expect(layout.currentBounds[1][0]).toBeCloseTo(30, 6);
    expect(layout.expandedBounds[0][0]).toBeCloseTo(0, 6);
    expect(layout.expandedBounds[1][0]).toBeCloseTo(30, 6);
  });

  it('changes Y bounds without changing X bounds when collapsing a process', () => {
    const rank = createRankWithStreams('rank-collapse-bounds', ['thread-a', 'thread-b']);
    const graph = buildJSONTrace([rank], [], {name: 'collapse-bounds'});

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const [collapsedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings,
      collapsedProcessIds: new Set([graph.processes[0]!.processId])
    });

    expect(collapsedLayout.currentBounds[0][0]).toBeCloseTo(expandedLayout.currentBounds[0][0], 6);
    expect(collapsedLayout.currentBounds[1][0]).toBeCloseTo(expandedLayout.currentBounds[1][0], 6);
    expect(collapsedLayout.currentBounds[1][1]).toBeLessThan(expandedLayout.currentBounds[1][1]);
  });
});
