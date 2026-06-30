import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {TraceGraph} from '../trace-graph/trace-graph';
import {
  createTraceCollapseRuntimeState,
  reduceTraceCollapseRuntimeState
} from './trace-collapse-runtime';

import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId
} from '../trace-graph/trace-types';

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

describe('trace collapse runtime', () => {
  it('preserves explicit process overrides across input syncs', () => {
    const graph = createGraph('primary', ['A', 'B']);
    const processARef = getRequiredProcessRef(graph, 'A');
    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graph],
      primaryTraceGraph: graph,
      defaultExpandProcess: false
    });

    const expandedA = reduceTraceCollapseRuntimeState(runtime, {
      type: 'toggleProcess',
      traceGraphs: [graph],
      graphIndex: 0,
      processRef: processARef
    });
    const synced = reduceTraceCollapseRuntimeState(expandedA, {
      type: 'syncInputs',
      inputs: {
        traceGraphs: [graph],
        primaryTraceGraph: graph,
        defaultExpandProcess: false,
        defaultExpandedProcessIds: ['B']
      }
    });

    expect(synced.collapseState.graphs[0]?.collapsedProcessRefs.has(processARef)).toBe(false);
    expect(synced.serializedExpandedProcessIds).toEqual(['A', 'B']);
  });

  it('expands the process that owns the selected span during sync', () => {
    const graph = createGraph('primary', ['A', 'B']);
    const processARef = getRequiredProcessRef(graph, 'A');
    const processBRef = getRequiredProcessRef(graph, 'B');
    const spanBRef = getRequiredSpanRef(graph, 'B');

    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graph],
      primaryTraceGraph: graph,
      defaultExpandProcess: false,
      selectedSpanRefs: [spanBRef]
    });

    expect(runtime.collapseState.graphs[0]?.collapsedProcessRefs.has(processARef)).toBe(true);
    expect(runtime.collapseState.graphs[0]?.collapsedProcessRefs.has(processBRef)).toBe(false);
    expect(runtime.serializedExpandedProcessIds).toEqual(['B']);
  });

  it('prunes stale graph refs and stale process overrides during sync', () => {
    const graphAB = createGraph('primary', ['A', 'B']);
    const graphB = createGraph('primary-next', ['B']);
    const processARef = getRequiredProcessRef(graphAB, 'A');
    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graphAB],
      primaryTraceGraph: graphAB,
      defaultExpandProcess: false
    });
    const expandedA = reduceTraceCollapseRuntimeState(runtime, {
      type: 'toggleProcess',
      traceGraphs: [graphAB],
      graphIndex: 0,
      processRef: processARef
    });

    const synced = reduceTraceCollapseRuntimeState(expandedA, {
      type: 'syncInputs',
      inputs: {
        traceGraphs: [graphB],
        primaryTraceGraph: graphB,
        defaultExpandProcess: true
      }
    });

    expect(synced.collapseState.graphs).toHaveLength(1);
    expect(synced.processExpansionOverrides.has(graphAB)).toBe(false);
    expect(synced.serializedExpandedProcessIds).toEqual(['B']);
  });

  it('updates collapse state and process overrides for expand all and collapse all', () => {
    const graph = createGraph('primary', ['A', 'B']);
    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graph],
      primaryTraceGraph: graph,
      defaultExpandProcess: false
    });

    const expanded = reduceTraceCollapseRuntimeState(runtime, {
      type: 'setAllProcessesExpanded',
      traceGraphs: [graph],
      expand: true
    });
    expect(expanded.collapseState.graphs[0]?.collapsedProcessRefs.size).toBe(0);
    expect([...expanded.processExpansionOverrides.get(graph)!.values()]).toEqual([true, true]);

    const collapsed = reduceTraceCollapseRuntimeState(expanded, {
      type: 'setAllProcessesExpanded',
      traceGraphs: [graph],
      expand: false
    });
    expect(collapsed.collapseState.graphs[0]?.collapsedProcessRefs.size).toBe(2);
    expect([...collapsed.processExpansionOverrides.get(graph)!.values()]).toEqual([false, false]);
  });

  it('keeps thread expanded overrides exclusive with collapsed overrides', () => {
    const graph = createGraph('primary', ['A']);
    const threadRef = graph.getThreadRefs()[0]!;
    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graph],
      primaryTraceGraph: graph,
      defaultExpandProcess: true
    });

    const collapsed = reduceTraceCollapseRuntimeState(runtime, {
      type: 'toggleThread',
      graphIndex: 0,
      threadRef
    });
    const expanded = reduceTraceCollapseRuntimeState(collapsed, {
      type: 'toggleThread',
      graphIndex: 0,
      threadRef
    });

    expect(expanded.collapseState.graphs[0]?.collapsedThreadRefs.has(threadRef)).toBe(false);
    expect(expanded.collapseState.graphs[0]?.expandedThreadRefs.has(threadRef)).toBe(true);
  });

  it('keeps duplicate process ids independent across graph indexes', () => {
    const graphA = createGraph('left', ['0']);
    const graphB = createGraph('right', ['0']);
    const processARef = getRequiredProcessRef(graphA, '0');
    const processBRef = getRequiredProcessRef(graphB, '0');
    const runtime = createTraceCollapseRuntimeState({
      traceGraphs: [graphA, graphB],
      primaryTraceGraph: graphA,
      defaultExpandProcess: false
    });

    const expandedSecondGraph = reduceTraceCollapseRuntimeState(runtime, {
      type: 'toggleProcess',
      traceGraphs: [graphA, graphB],
      graphIndex: 1,
      processRef: processBRef
    });

    expect(expandedSecondGraph.collapseState.graphs[0]?.collapsedProcessRefs.has(processARef)).toBe(
      true
    );
    expect(expandedSecondGraph.collapseState.graphs[1]?.collapsedProcessRefs.has(processBRef)).toBe(
      false
    );
  });
});

function createGraph(name: string, processIds: readonly string[]): TraceGraph {
  return createTestTraceGraph(
    buildTraceGraphDataFromJSONTrace(
      buildJSONTrace(
        processIds.map((processId, index) => createRank(processId, index)),
        [],
        {name}
      )
    )
  );
}

function createRank(processId: string, index: number): TraceProcess {
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
  };
}

function getRequiredProcessRef(traceGraph: TraceGraph, processId: string) {
  const processIndex = traceGraph.processes.findIndex(process => process.processId === processId);
  const processRef = processIndex >= 0 ? (traceGraph.getProcessRefs()[processIndex] ?? null) : null;
  if (processRef == null) {
    throw new Error(`Expected process ref for ${processId}`);
  }
  return processRef;
}

function getRequiredSpanRef(traceGraph: TraceGraph, processId: string) {
  const spanRef =
    traceGraph.getSpanRefByExternalBlockId(`${processId}-span` as TraceSpanId) ?? null;
  if (spanRef == null) {
    throw new Error(`Expected span ref for ${processId}`);
  }
  return spanRef;
}
