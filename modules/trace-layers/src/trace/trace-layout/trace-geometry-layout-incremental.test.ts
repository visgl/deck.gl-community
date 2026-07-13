import {describe, expect, it, vi} from 'vitest';

import {buildJSONTrace, materializeJSONTrace} from '../ingestion/json-trace';
import {TraceGraph} from '../trace-graph/trace-graph';
import {createRuntimeTraceGraph as createDatasetRuntimeTraceGraph} from '../trace-graph/trace-graph-test-fixtures';
import {
  getRequiredSameProcessDependencyRefById,
  getRequiredThreadRef,
  isTraceGraphBlockFiltered
} from '../trace-graph/trace-graph-test-utils';
import {
  encodeSpanRef,
  getSpanRefChunkIndex,
  getSpanRefProcessId,
  getSpanRefRowIndex
} from '../trace-graph/trace-id-encoder';
import {
  buildTraceLayoutForSpanRefs as buildRuntimeTraceLayoutForSpanRefs,
  buildTraceLayouts as buildRuntimeTraceLayouts,
  rebuildTraceLayoutGeometry as rebuildRuntimeTraceLayoutGeometry
} from '../trace-layout/trace-geometry-layout';
import * as traceGeometryLayoutCommon from '../trace-layout/trace-geometry-layout-common';
import {buildTraceGeometryLayoutLookup} from '../trace-layout/trace-geometry-layout-helpers';
import {
  deserializeTraceGraphCollapseState,
  fillTraceLayoutCrossProcessDependencyGeometry,
  fillTraceLayoutSameProcessDependencyGeometry,
  fillTraceLayoutSpanGeometry,
  getTraceLayoutSpanLaneIndex,
  getTraceLayoutSpanVisibility,
  hasTraceLayoutSpanVisibilityFlag,
  isTraceLayoutSpanVisible,
  serializeTraceGraphCollapseState,
  traceLayoutSpanVisibilityFlags
} from '../trace-layout/trace-layout';
import {buildTraceDeckBinaryCrossProcessDependencyLineData} from '../trace-view-state/trace-deck-binary-data';

import type {JSONTrace} from '../ingestion/json-trace';
import type {TraceVisSettings} from '../trace-graph/trace-settings';
import type {
  SpanRef,
  TraceCrossProcessDependency,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceEventId,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';
import type {TraceLayout} from '../trace-layout/trace-layout';

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

  /** Builds one layout after translating fixture thread identities to exact runtime refs. */
  function buildTraceLayoutsWithCollapsedThreads(params: {
    traceGraph: TestTraceGraphSource;
    threadIds: readonly TraceThreadId[];
    settings: Parameters<typeof buildRuntimeTraceLayouts>[0]['settings'];
  }) {
    const traceGraph = normalizeTraceGraphSource(params.traceGraph);
    return buildRuntimeTraceLayouts({
      traceGraphs: [traceGraph],
      settings: params.settings,
      collapseState: {
        graphs: [
          {
            collapsedProcessRefs: new Set(),
            collapsedThreadRefs: new Set(
              params.threadIds.map(threadId => getRequiredThreadRef(traceGraph, threadId))
            ),
            expandedThreadRefs: new Set()
          }
        ]
      }
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
  function buildTraceLayoutForSpanRefs(
    params: Parameters<typeof buildRuntimeTraceLayoutForSpanRefs>[0]
  ) {
    return buildRuntimeTraceLayoutForSpanRefs(params);
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
  function getLayoutThread(layout: TraceLayout, threadId: TraceThreadId) {
    const threadRef = getRequiredThreadRef(requireTraceGraph(layout), threadId);
    const threadLayout = layout.threadLayoutMapByRef.get(threadRef);
    if (!threadLayout) {
      throw new Error(`Expected thread layout for ${threadId}`);
    }
    return threadLayout;
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

  function getCrossGeometry(
    layout: TraceLayout,
    dependencyId: TraceDependencyId
  ): Float32Array | undefined {
    const traceGraph = requireTraceGraph(layout);
    const dependencyRefs = Array.from(traceGraph.iterateVisibleCrossProcessDependencyRefs()).filter(
      dependencyRef => traceGraph.getDependencyId(dependencyRef) === dependencyId
    );
    if (dependencyRefs.length === 0) {
      return undefined;
    }
    if (dependencyRefs.length !== 1) {
      throw new Error(
        `Expected at most one visible cross-process dependency ref for ${dependencyId}, found ${dependencyRefs.length}`
      );
    }
    const dependencyRef = dependencyRefs[0]!;
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
        sameProcessDependencyIds: [],
        sameProcessDependencies: [],
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
    const sameProcessDependencies: TraceProcess['sameProcessDependencies'] = [];
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
          sameProcessDependencyIds: [],
          sameProcessDependencies: [],
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
        type: 'trace-same-process-dependency',
        dependencyId,
        startSpanId: parentBlock.spanId,
        endSpanId: childBlock.spanId,
        keywords: new Set<string>(['PARENT']),
        waitMode: 'start-to-start',
        bidirectional: false,
        waitTimeMs: 0
      } satisfies TraceProcess['sameProcessDependencies'][number];

      childBlock.sameProcessDependencyIds.push(dependencyId);
      sameProcessDependencies.push(dependency);
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
      sameProcessDependencies,
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

  function getLayoutLanes(
    layout: ReturnType<typeof buildTraceLayouts>[number]
  ): ReadonlyMap<SpanRef, number> {
    const processRef = layout.processLayouts[0]?.processRef;
    const laneMap = new Map<SpanRef, number>();
    if (processRef == null) {
      return laneMap;
    }
    for (const [chunkIndex, laneColumn] of layout.spanLaneColumnsByChunkIndex ?? []) {
      for (let rowIndex = 0; rowIndex < laneColumn.values.length; rowIndex += 1) {
        const laneIndex = laneColumn.values[rowIndex]!;
        if (laneIndex < 0) {
          continue;
        }
        const spanRef = encodeSpanRef(chunkIndex, rowIndex);
        if (layout.traceGraph.getProcessRefBySpanRef(spanRef) === processRef) {
          laneMap.set(spanRef, laneIndex);
        }
      }
    }
    return laneMap;
  }

  function getLayoutLane(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanRef: SpanRef
  ): number | undefined {
    return getTraceLayoutSpanLaneIndex(layout, spanRef);
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

  function expectHiddenSpanToHaveNoRenderGeometry(
    layout: ReturnType<typeof buildTraceLayouts>[number],
    spanRef: SpanRef
  ): void {
    const target = {x1: 1, y1: 1, x2: 1, y2: 1};
    expect(fillTraceLayoutSpanGeometry({traceLayout: layout, spanRef, target})).toBe(false);
    expect(target).toEqual({x1: 0, y1: 0, x2: 0, y2: 0});
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
    const spanRef = layout.traceGraph?.getSpanRefById(spanId);
    if (spanRef == null) {
      throw new Error(`Expected span ref for span ${spanId}`);
    }
    return spanRef;
  }

  it('resolves unfiltered same-process dependency geometry by visible dependency refs', () => {
    const rank = createDependencyRank('rank-visible-same-process-dependency-geometry', [
      {
        threadName: 'worker',
        spans: [
          {idSuffix: 'parent', start: 0, end: 1},
          {idSuffix: 'child', start: 2, end: 3, parentId: 'worker:parent'}
        ]
      }
    ]);
    const graph = buildJSONTrace([rank], [], {name: 'visible-same-process-dependency-geometry'});
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const traceGraph = requireTraceGraph(layout);
    const processRef = getRequiredProcessRef(traceGraph, rank.processId);
    const visibleDependency = Array.from(
      traceGraph.iterateVisibleSameProcessDependencyRefsByProcess(processRef)
    ).flatMap(dependencyRef => {
      const dependency = traceGraph.getDependencySource(dependencyRef);
      return dependency?.type === 'trace-same-process-dependency' ? [dependency] : [];
    })[0];
    const parentBlock = rank.spans[0]!;
    const childBlock = rank.spans[1]!;
    const parentLane = getLayoutLane(layout, getLayoutSpanRef(layout, parentBlock.spanId));
    const childLane = getLayoutLane(layout, getLayoutSpanRef(layout, childBlock.spanId));

    expect(visibleDependency?.dependencyRef).toBeDefined();
    expect(parentLane).toBeDefined();
    expect(childLane).toBeDefined();
    expect(parentLane!).toBeLessThan(childLane!);
    expect(getBlockGeometryCenterY(layout, parentBlock.spanId)).toBeLessThan(
      getBlockGeometryCenterY(layout, childBlock.spanId)
    );
    const geometry = {x1: 0, y1: 0, x2: 0, y2: 0};
    expect(
      fillTraceLayoutSameProcessDependencyGeometry({
        traceLayout: layout,
        dependencyRef: visibleDependency!.dependencyRef!,
        target: geometry
      })
    ).toBe(true);
    expect(geometry.x2).toBeGreaterThan(geometry.x1);
    expect(geometry.y2).toBeGreaterThan(geometry.y1);
  });

  it('compacts stale trace affinity while preserving explicit parent depth in separate mode', () => {
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

    expect(getLayoutLane(layout, getLayoutSpanRef(layout, rank.spans[0]!.spanId))).toBe(0);
    expect(getLayoutLane(layout, getLayoutSpanRef(layout, rank.spans[1]!.spanId))).toBe(1);
    expect(getLayoutLane(layout, getLayoutSpanRef(layout, rank.spans[2]!.spanId))).toBe(0);
    expect(getLayoutLane(layout, getLayoutSpanRef(layout, rank.spans[3]!.spanId))).toBe(1);
  });

  it('reuses existing cross geometry when appending ranks and only adds geometry for new matches', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const rankC = createRank('rank-c', 2, 8);
    const crossAB = createCrossProcessDependency({
      dependencyId: 'cross:ab' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1
    });
    const crossAC = createCrossProcessDependency({
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
      settings: baseSettings
    });
    const [layoutABC] = buildTraceLayouts({
      traceGraphs: [graphABC],
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

  it('does not leak removed process geometry when reusing a previous lane layout', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const crossAB = createCrossProcessDependency({
      dependencyId: 'cross:ab' as TraceDependencyId,
      startSpanId: rankA.spans[0]!.spanId,
      endSpanId: rankB.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 1
    });
    const graphB = buildJSONTrace([rankB], [], {name: 'removed-geometry-b'});

    const [layoutB] = buildTraceLayouts({
      traceGraphs: [graphB],
      settings: baseSettings
    });

    expect(getSpanGeometry(layoutB, rankA.spans[0]!.spanId)).toBeUndefined();
    expect(getSpanGeometry(layoutB, rankB.spans[0]!.spanId)).toBeDefined();
    expect(getCrossGeometry(layoutB, crossAB.dependencyId)).toBeUndefined();
  });

  it('derives span and cross geometry from the current timing window', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 4);
    const crossAB = createCrossProcessDependency({
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
        sameProcessDependencyMode: baseSettings.sameProcessDependencyMode,
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

  it('derives not-finished span geometry when an appended rank extends max time', () => {
    const rankA = createRank('rank-a', 0, 0);
    const rankB = createRank('rank-b', 1, 100);
    rankA.spans[0]!.timings.test.status = 'not-finished';

    const graphA = buildJSONTrace([rankA], [], {name: 'not-finished-geometry-a'});
    const graphAB = buildJSONTrace([rankA, rankB], [], {name: 'not-finished-geometry-ab'});

    const [layoutA] = buildTraceLayouts({traceGraphs: [graphA], settings: baseSettings});
    const [layoutAB] = buildTraceLayouts({
      traceGraphs: [graphAB],
      settings: baseSettings
    });

    const spanId = rankA.spans[0]!.spanId;
    expect(getSpanGeometry(layoutAB, spanId)).not.toBe(getSpanGeometry(layoutA, spanId));
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
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [layout044] = buildTraceLayouts({
      traceGraphs: [graph044],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });
    const [layout044144] = buildTraceLayouts({
      traceGraphs: [graph044144],
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

  it('builds same-process dependency geometry for ranks that share process-local stream ids', () => {
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
    const graph = buildJSONTrace([rank0, rank44], [], {name: 'repeated-same-process-dependency'});

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
      const dependency = rank.sameProcessDependencies[0]!;
      const geometry = getLayoutSameProcessDependencyGeometry(layout, dependency.dependencyId);
      expect(
        geometry,
        `Expected same-process dependency geometry for ${rank.processId}`
      ).toBeDefined();
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
    const crossProcessDependency = createCrossProcessDependency({
      dependencyId: 'cross:0-44' as TraceDependencyId,
      startSpanId: rank0.spans[0]!.spanId,
      endSpanId: rank44.spans[0]!.spanId,
      startRankNum: 0,
      endRankNum: 44
    });
    const graph = buildJSONTrace([rank0, rank44], [crossProcessDependency], {
      name: 'repeated-cross-process-dependency'
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
    const geometry = getCrossGeometry(layout, crossProcessDependency.dependencyId);
    expect(geometry).toBeDefined();
    expect(geometry!.length).toBe(4);
    expect(geometry![1]).toBeCloseTo(getBlockGeometryCenterY(layout, rank0.spans[0]!.spanId), 6);
    expect(geometry![3]).toBeCloseTo(getBlockGeometryCenterY(layout, rank44.spans[0]!.spanId), 6);

    const dependencyRefs = Array.from(
      requireTraceGraph(layout).iterateVisibleCrossProcessDependencyRefs()
    );
    const binaryData = buildTraceDeckBinaryCrossProcessDependencyLineData({
      dependencyRefs,
      traceLayout: layout,
      settings: {
        ...baseSettings,
        dependencyOpacity: 0.1,
        showPathsOnly: false
      } as TraceVisSettings
    });
    const sourcePositions = binaryData.data.attributes['getSourcePosition']?.value as
      | Float32Array
      | undefined;
    const targetPositions = binaryData.data.attributes['getTargetPosition']?.value as
      | Float32Array
      | undefined;
    expect(binaryData.data.length).toBe(1);
    expect(binaryData.dependencies.at(0)).toBe(dependencyRefs[0]);
    expect(sourcePositions?.[0]).toBeCloseTo(geometry![0]!, 6);
    expect(sourcePositions?.[1]).toBeCloseTo(geometry![1]!, 6);
    expect(targetPositions?.[0]).toBeCloseTo(geometry![2]!, 6);
    expect(targetPositions?.[1]).toBeCloseTo(geometry![3]!, 6);
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
      getSpanRefProcessId(traceGraph.processIdsByIndex, traceGraph.getSpanRefById(spanId)!)
    ).toBe('rank-1');
    expect(getSpanRefRowIndex(traceGraph.getSpanRefById(spanId)!)).toBe(0);
  });

  it('builds expected separate-thread offsets for a simple multi-rank graph', () => {
    const graph = createGraph('simple-separate', ['rank-1', 'rank-2']);
    const [layout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'}
    });

    expect(layout.processLayouts[0]!.yOffset).toBeCloseTo(0, 6);
    expect(layout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
    expect(
      getLayoutThread(layout, graph.processes[0]!.threads[0]!.threadId)!.yPosition
    ).toBeCloseTo(1.25, 6);
    expect(
      getLayoutThread(layout, graph.processes[1]!.threads[0]!.threadId)!.yPosition
    ).toBeCloseTo(3.83, 6);
    expect(
      getLayoutThread(layout, graph.processes[1]!.threads[0]!.threadId)!.yPosition -
        layout.processLayouts[1]!.yOffset
    ).toBeCloseTo(
      getLayoutThread(layout, graph.processes[0]!.threads[0]!.threadId)!.yPosition -
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
    expect(getLayoutLanes(layout)).toEqual(
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
    const [collapsedLayout] = buildTraceLayoutsWithCollapsedThreads({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'separate-threads'},
      threadIds: [threadId]
    });

    const expandedThreadLayout = getLayoutThread(expandedLayout, threadId)!;
    const collapsedThreadLayout = getLayoutThread(collapsedLayout, threadId)!;
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
    const runtimeGraph = createRuntimeTraceGraph(graph);
    const threadId = rank.threads[0]!.threadId;
    const threadRef = getRequiredThreadRef(runtimeGraph, threadId);

    const [layout] = buildRuntimeTraceLayouts({
      traceGraphs: [runtimeGraph],
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

    const threadLayout = getLayoutThread(layout, threadId)!;
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
    const focusedBlock = rank.spans[2]!;
    const focusedLaneIndex =
      getLayoutLane(baselineLayout, getLayoutSpanRef(baselineLayout, focusedBlock.spanId)) ?? 0;

    const [compactLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      threadLaneLayoutOverrides: {
        [threadId]: {visibleLaneIndices: [focusedLaneIndex]}
      }
    });
    const compactStreamLayout = getLayoutThread(compactLayout, threadId)!;
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
    expectHiddenSpanToHaveNoRenderGeometry(compactLayout, hiddenBlockSpanRef);
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
    const lane0Block = rank.spans[0]!;
    const lane2Block = rank.spans[2]!;
    const lane0Index =
      getLayoutLane(baselineLayout, getLayoutSpanRef(baselineLayout, lane0Block.spanId)) ?? 0;
    const lane2Index =
      getLayoutLane(baselineLayout, getLayoutSpanRef(baselineLayout, lane2Block.spanId)) ?? 0;

    const [compactLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      threadLaneLayoutOverrides: {
        [threadId]: {visibleLaneIndices: [lane0Index, lane2Index]}
      }
    });
    const compactStreamLayout = getLayoutThread(compactLayout, threadId)!;
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
        sameProcessDependencyMode: baseSettings.sameProcessDependencyMode,
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
    expect(getLayoutLane(focusedLayout, parentSpanRef)).toBe(parentLaneIndex);
    expect(getLayoutLane(focusedLayout, childSpanRef)).toBe(childLaneIndex);
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
    const focusedBlockSource = traceGraph.getSpanGeometrySource(focusedSpanRef);
    const mutatedSpanLaneColumnsByChunkIndex = new Map(layout.spanLaneColumnsByChunkIndex);
    const focusedLaneColumn = mutatedSpanLaneColumnsByChunkIndex
      .get(getSpanRefChunkIndex(focusedSpanRef))
      ?.values.slice();
    expect(focusedLaneColumn).toBeDefined();
    focusedLaneColumn![getSpanRefRowIndex(focusedSpanRef)] = -1;
    mutatedSpanLaneColumnsByChunkIndex.set(getSpanRefChunkIndex(focusedSpanRef), {
      values: focusedLaneColumn!
    });
    const layoutLookup = buildTraceGeometryLayoutLookup({
      traceGraph,
      spanLaneColumnsByChunkIndex: mutatedSpanLaneColumnsByChunkIndex,
      processLayoutMapByRef: layout.processLayoutMapByRef,
      threadLayoutMapByRef: layout.threadLayoutMapByRef
    });
    const focusedBoundingBox = traceGeometryLayoutCommon.getSpanBoundingBox(
      focusedBlockSource!,
      layoutLookup,
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

  it('renders same-process dependency geometry when endpoint lanes are hidden by overflow', () => {
    const thread: TraceThread = {
      type: 'trace-thread',
      name: 'overflow-thread',
      threadId: 'overflow-thread-id' as TraceThreadId,
      processId: 'rank-overflow'
    };

    const sameProcessDependencies: TraceProcess['sameProcessDependencies'] = [];
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
        sameProcessDependencyIds: [],
        sameProcessDependencies: [],
        crossProcessEndpointId: null,
        crossProcessDependencyEndpoints: []
      };
      spans.push(span);
    }

    const dependencyId = 'overflow:dep' as TraceDependencyId;
    sameProcessDependencies.push({
      type: 'trace-same-process-dependency',
      dependencyId,
      startSpanId: spans[0]!.spanId,
      endSpanId: spans[spans.length - 1]!.spanId,
      keywords: new Set(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    });

    spans[0]!.sameProcessDependencyIds.push(dependencyId);

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
      sameProcessDependencies,
      remoteDependencies: []
    };

    const graph = buildJSONTrace([rank], [], {
      name: 'hidden-lane-same-process-dependency'
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

    const threadLayout = getLayoutThread(layout, thread.threadId);
    expect(threadLayout).toBeDefined();
    expect(threadLayout.lanes?.renderedLaneCount).toBeLessThan(
      getLayoutLane(layout, getLayoutSpanRef(layout, spans[spans.length - 1]!.spanId)) ?? 0
    );

    const geometry = getLayoutSameProcessDependencyGeometry(layout, dependencyId)!;
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

    expect(getLayoutThread(tightLayout, thread.threadId)?.lanes?.laneCount).toBe(4);
    expect(getLayoutThread(tightLayout, thread.threadId)?.lanes?.renderedLaneCount).toBe(3);
    expect(getLayoutThread(looseLayout, thread.threadId)?.lanes?.laneCount).toBe(7);
    expect(getLayoutThread(looseLayout, thread.threadId)?.lanes?.renderedLaneCount).toBe(7);
    expect(getLayoutThread(unlimitedLayout, thread.threadId)?.lanes?.laneCount).toBe(7);
    expect(getLayoutThread(unlimitedLayout, thread.threadId)?.lanes?.renderedLaneCount).toBe(7);
    expect(getLayoutThread(zeroLimitLayout, thread.threadId)?.lanes?.laneCount).toBe(7);
    expect(getLayoutThread(zeroLimitLayout, thread.threadId)?.lanes?.renderedLaneCount).toBe(7);

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
    expectHiddenSpanToHaveNoRenderGeometry(tightLayout, overflowSpanRef);
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
      getLayoutThread(layoutA, graphA.processes[0]!.threads[0]!.threadId).yPosition
    ).toBeCloseTo(2.25, 6);
    expect(
      getLayoutThread(layoutB, graphB.processes[0]!.threads[0]!.threadId).yPosition
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

    const [layout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [graph.processes[0]!.processId]
    });

    expect(getLayoutThread(layout, graph.processes[0]!.threads[0]!.threadId).visible).toBe(false);
    expect(layout.processLayouts[0]!.yOffset).toBeCloseTo(0, 6);
    expect(layout.processLayouts[1]!.yOffset).toBeCloseTo(2.58, 6);
  });

  it('accepts ref-native collapse state for collapsed process layout input', () => {
    const graph = createGraph('ref-collapse', ['rank-1', 'rank-2']);
    const runtimeGraph = createRuntimeTraceGraph(graph);
    const firstProcessRef = getRequiredProcessRef(runtimeGraph, graph.processes[0]!.processId);

    const [layout] = buildRuntimeTraceLayouts({
      traceGraphs: [runtimeGraph],
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
    expect(getLayoutThread(layout, graph.processes[0]!.threads[0]!.threadId).visible).toBe(false);
  });

  it('keeps graph-local process refs independent across multi-graph layouts', () => {
    const graphA = createGraph('ref-collapse-a', ['rank-1']);
    const graphB = createGraph('ref-collapse-b', ['rank-1']);
    const runtimeGraphA = createRuntimeTraceGraph(graphA);
    const runtimeGraphB = createRuntimeTraceGraph(graphB);
    const processRefA = getRequiredProcessRef(runtimeGraphA, graphA.processes[0]!.processId);
    const processRefB = getRequiredProcessRef(runtimeGraphB, graphB.processes[0]!.processId);

    const [layoutA, layoutB] = buildRuntimeTraceLayouts({
      traceGraphs: [runtimeGraphA, runtimeGraphB],
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
    const [collapsedLayout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      processIds: [firstRank.processId]
    });

    expect(collapsedLayout.processLayouts[0]!.isCollapsed).toBe(true);
    expect(collapsedLayout.processLayouts[0]!.yHeight).toBeLessThan(
      expandedLayout.processLayouts[0]!.yHeight
    );
    expect(collapsedLayout.processLayouts[1]!.yOffset).toBeLessThan(
      expandedLayout.processLayouts[1]!.yOffset
    );
    expect(getLayoutThread(collapsedLayout, firstRank.threads[0]!.threadId)!.visible).toBe(false);
    expect(getLayoutThread(collapsedLayout, firstRank.threads[1]!.threadId)!.visible).toBe(false);
    expect(collapsedLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(false);
    expect(collapsedLayout.processLayouts[0]!.collapsedActivityY).toBeGreaterThan(
      collapsedLayout.processLayouts[0]!.yOffset
    );
    expect(collapsedLayout.processLayouts[1]!.yOffset).toBeCloseTo(2.81, 6);
    expect(getLayoutThread(collapsedLayout, secondRank.threads[0]!.threadId).yPosition).toBeCloseTo(
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

    const [collapsedLayout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [graph.processes[0]!.processId]
    });
    const [filteredLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: {...baseSettings, showEmptyProcesses: true, spanFilter: 'rank-1-span'}
    });

    expect(filteredLayout.processLayouts[0]!.isCollapsed).toBe(false);
    expect(filteredLayout.processLayouts[0]!.threadLayouts[0]!.visible).toBe(true);
    expect(getLayoutLanes(filteredLayout)).toEqual(new Map());
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

    const [collapsedLayout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: {...baseSettings, trackAggregationMode: 'combine-threads'},
      processIds: [graph.processes[0]!.processId]
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
    expect(getLayoutLanes(filteredLayout)).toEqual(new Map());
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
      traceLayout: layout,
      settings: {
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      minTimeMs: 10
    });

    expect(getSpanGeometry(rebuiltLayout, graph.processes[0]!.spans[0]!.spanId)?.[0]).toBeCloseTo(
      -10,
      6
    );
  });

  it('derives dependency geometry only when dependency render data requests it', () => {
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
    const fillSameProcessDependencyPathSpy = vi.spyOn(
      traceGeometryLayoutCommon,
      'fillSameProcessDependencyPathFlat'
    );

    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      minTimeMs: -1
    });

    expect(fillSameProcessDependencyPathSpy).toHaveBeenCalledTimes(0);
    expect(
      getLayoutSameProcessDependencyGeometry(
        rebuiltLayout,
        rank.sameProcessDependencies[0]!.dependencyId
      )
    ).toBeDefined();
    expect(fillSameProcessDependencyPathSpy).toHaveBeenCalledTimes(1);
    expect(fillSameProcessDependencyPathSpy.mock.calls[0]?.[0]).not.toHaveProperty('settings');

    fillSameProcessDependencyPathSpy.mockRestore();
  });

  it('does not derive span rectangles while computing layout bounds', () => {
    const graph = createGraph('A', ['rank-1']);
    const buildBlockGeometrySpy = vi.spyOn(traceGeometryLayoutCommon, 'getSpanBoundingBox');

    buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });

    expect(buildBlockGeometrySpy).toHaveBeenCalledTimes(0);
    buildBlockGeometrySpy.mockRestore();
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
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });

    const rebuiltBlockGeometry = getSpanGeometry(rebuiltLayout, span.spanId)!;
    expect(rebuiltBlockGeometry[0]).toBeCloseTo(3, 6);
    expect(rebuiltBlockGeometry[2]).toBeCloseTo(5, 6);
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
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });

    expect(getLayoutLanes(rebuiltLayout)).toEqual(getLayoutLanes(layout));
    expect(rebuiltLayout.processLayouts).toEqual(layout.processLayouts);
    expect(rebuiltLayout.threadLayoutMapByRef).toEqual(layout.threadLayoutMapByRef);
  });

  it('keeps lane layout stable when the requested timing key resolves to current span timing', () => {
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
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'latest'
    });

    expect(rebuiltLayout).not.toBe(layout);
    expect(rebuiltLayout.processLayouts).toEqual(layout.processLayouts);
    expect(rebuiltLayout.layoutConfiguration?.timingKey).toBe('latest');
    expect(getSpanGeometry(rebuiltLayout, span.spanId)).toEqual(
      getSpanGeometry(layout, span.spanId)
    );
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

    const dependencyId = rank.sameProcessDependencies[0]!.dependencyId;
    const originalGeometry = getLayoutSameProcessDependencyGeometry(layout, dependencyId)!;
    const rebuiltLayout = rebuildTraceLayoutGeometry({
      traceGraph: graph,
      traceLayout: layout,
      settings: {
        sameProcessDependencyMode: 'all',
        layoutDensity: 'comfortable'
      },
      timingKey: 'p50'
    });
    const rebuiltGeometry = getLayoutSameProcessDependencyGeometry(rebuiltLayout, dependencyId)!;

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
  });

  it('changes Y bounds without changing X bounds when collapsing a process', () => {
    const rank = createRankWithStreams('rank-collapse-bounds', ['thread-a', 'thread-b']);
    const graph = buildJSONTrace([rank], [], {name: 'collapse-bounds'});

    const [expandedLayout] = buildTraceLayouts({
      traceGraphs: [graph],
      settings: baseSettings
    });
    const [collapsedLayout] = buildTraceLayoutsWithCollapsedProcesses({
      traceGraph: graph,
      settings: baseSettings,
      processIds: [graph.processes[0]!.processId]
    });

    expect(collapsedLayout.currentBounds[0][0]).toBeCloseTo(expandedLayout.currentBounds[0][0], 6);
    expect(collapsedLayout.currentBounds[1][0]).toBeCloseTo(expandedLayout.currentBounds[1][0], 6);
    expect(collapsedLayout.currentBounds[1][1]).toBeLessThan(expandedLayout.currentBounds[1][1]);
  });
});
