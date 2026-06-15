import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {buildTraceLayout} from '../trace-layout/trace-geometry-layout';
import {buildCollapsedActivityByTraceGraphRows} from './collapsed-activity';
import {TraceGraph} from './trace-graph';

import type {TraceLayoutRow} from '../trace-layout/trace-layout';
import type {TraceColorScheme} from '../trace-style/trace-color-scheme';
import type {
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from './trace-types';

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

const settings = {colorBy: 'blockName'} as unknown as TraceVisSettings;

const defaultColorScheme = {
  id: 'test-color-scheme',
  name: 'Test Color Scheme'
} satisfies TraceColorScheme;

/** Builds one minimal test span with primary timing. */
function makeBlock(spanId: string, startTimeMs: number, endTimeMs: number): TraceSpan {
  return {
    type: 'trace-span',
    spanId: spanId as TraceSpanId,
    threadId: 'stream:test' as TraceThreadId,
    processName: 'rank1',
    name: spanId,
    keywords: [],
    primaryTimingKey: 'test',
    timings: {
      test: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: Math.max(0, endTimeMs - startTimeMs),
        durationMsAsString: `${Math.max(0, endTimeMs - startTimeMs)}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/** Builds an Arrow-backed runtime graph from test spans. */
function makeRuntimeGraph(spans: readonly TraceSpan[]) {
  const {graph, processes} = makeRuntimeGraphForProcesses([{processId: 'rank1', spans}]);
  return {
    graph,
    stream: processes[0]!.threads[0]!
  };
}

/** Builds an Arrow-backed runtime graph from process-local test span lists. */
function makeRuntimeGraphForProcesses(
  processSpanSources: readonly {
    /** Ingestion process id owning the test spans. */
    readonly processId: string;
    /** Test spans assigned to the process. */
    readonly spans: readonly TraceSpan[];
  }[]
) {
  const processes = processSpanSources.map(({processId, spans}, processIndex) =>
    makeRuntimeProcess(processId, spans, processIndex + 1)
  );
  const allSpans = processSpanSources.flatMap(({spans}) => spans);
  return {
    graph: createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace(processes, [], {
          name: 'test',
          timeExtents: getTestTimeExtents(allSpans)
        })
      )
    ),
    processes
  };
}

/** Builds one runtime process fixture with spans assigned to its process-local thread. */
function makeRuntimeProcess(
  processId: string,
  spans: readonly TraceSpan[],
  rankNum: number
): TraceProcess {
  const stream = {
    type: 'trace-thread',
    threadId: `stream:${processId}` as TraceThreadId,
    processId,
    name: `Stream ${processId}`
  } as TraceThread;
  return {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum,
    stepNum: 0,
    threads: [stream],
    threadMap: {
      [stream.threadId]: stream
    },
    spans: spans.map(span => ({
      ...span,
      threadId: stream.threadId,
      processName: processId
    })),
    spanMap: {},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: []
  } as unknown as TraceProcess;
}

/** Returns explicit raw span bounds for collapsed-activity fixtures. */
function getTestTimeExtents(spans: readonly TraceSpan[]) {
  if (spans.length === 0) {
    return {minTimeMs: 0, maxTimeMs: 0};
  }
  let minTimeMs = Infinity;
  let maxTimeMs = -Infinity;
  spans.forEach(span => {
    const timing = span.timings[span.primaryTimingKey];
    minTimeMs = Math.min(minTimeMs, timing?.startTimeMs ?? 0);
    maxTimeMs = Math.max(maxTimeMs, timing?.endTimeMs ?? 0);
  });
  return {
    minTimeMs,
    maxTimeMs
  };
}

/** Builds the visible layout row used by collapsed activity tests. */
function makeRow(graph: TraceGraph, stream: TraceThread): TraceLayoutRow {
  const processRef = graph.getProcessRefs()[0];
  if (processRef == null) {
    throw new Error('Expected test graph process ref');
  }
  return {
    processId: 'rank1',
    processRef,
    threadRefs: graph.getThreadRefsByProcessRef(processRef),
    rankIndex: 0,
    name: 'rank1',
    rankNum: 1,
    threads: [stream],
    isCollapsed: true
  };
}

/** Resolves collapsed activity intervals for one runtime process index. */
function getCollapsedActivityForProcessIndex(
  graph: TraceGraph,
  result: ReturnType<typeof buildCollapsedActivityByTraceGraphRows>,
  processIndex: number
) {
  const processRef = graph.getProcessRefs()[processIndex];
  if (processRef == null) {
    throw new Error(`Expected process ref at index ${processIndex}`);
  }
  return result.get(processRef) ?? [];
}

describe('buildCollapsedActivityByTraceGraphRows', () => {
  it('keeps the legacy density summary as the default aggregation', () => {
    const {graph, stream} = makeRuntimeGraph([makeBlock('parent', 0, 100)]);

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      colorScheme: defaultColorScheme,
      settings
    });

    const intervals = getCollapsedActivityForProcessIndex(graph, result, 0);
    expect(intervals.length).toBeGreaterThan(0);
    expect(intervals.some(interval => interval.height != null)).toBe(false);
  });

  it('leaves density gaps empty when no visible spans cover them', () => {
    const {graph, stream} = makeRuntimeGraph([
      makeBlock('early', 0, 10),
      makeBlock('late', 90, 100)
    ]);

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      colorScheme: defaultColorScheme,
      settings
    });

    const intervals = getCollapsedActivityForProcessIndex(graph, result, 0);
    expect(intervals.some(interval => interval.endX <= 20)).toBe(true);
    expect(intervals.some(interval => interval.startX >= 80)).toBe(true);
    expect(intervals.some(interval => interval.startX < 50 && interval.endX > 50)).toBe(false);
  });

  it('builds compact icicle intervals from runtime graph geometry bands', () => {
    const {graph, stream} = makeRuntimeGraph([
      makeBlock('parent', 0, 100),
      makeBlock('child', 10, 90)
    ]);
    const colorScheme = {
      id: 'icicle-test',
      name: 'Icicle Test',
      getSpanFillColor: ({span}) => (span.name === 'parent' ? [1, 2, 3, 255] : [4, 5, 6, 255])
    } satisfies TraceColorScheme;

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      geometryLayout: buildTraceLayout({traceGraph: graph, settings}),
      colorScheme,
      settings,
      aggregation: 'icicle'
    });

    const intervals = getCollapsedActivityForProcessIndex(graph, result, 0);
    expect(intervals).toEqual([
      expect.objectContaining({
        startX: 0,
        endX: 100,
        color: [1, 2, 3],
        yOffset: 0,
        height: expect.any(Number)
      }),
      expect.objectContaining({
        startX: expect.closeTo(10, 1),
        endX: expect.closeTo(90, 1),
        color: [4, 5, 6],
        yOffset: expect.any(Number),
        height: expect.any(Number)
      })
    ]);
    expect(intervals[1]?.yOffset).toBeGreaterThan(0);
    expect(intervals[1]?.yOffset).toBeLessThan(0.3);
  });

  it('quantizes hundreds of runtime graph icicle lanes into fixed visual bands', () => {
    const {graph, stream} = makeRuntimeGraph(
      Array.from({length: 200}, (_, index) => makeBlock(`span-${index}`, 0, 20))
    );

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      geometryLayout: buildTraceLayout({traceGraph: graph, settings}),
      colorScheme: defaultColorScheme,
      settings,
      aggregation: 'icicle'
    });

    const yOffsets = new Set(
      getCollapsedActivityForProcessIndex(graph, result, 0).map(interval => interval.yOffset)
    );
    expect(yOffsets.size).toBeLessThanOrEqual(6);
    expect(yOffsets.has(0)).toBe(true);
    expect([...yOffsets].some(yOffset => typeof yOffset === 'number' && yOffset > 0.5)).toBe(true);
  });

  it('coalesces adjacent same-color icicle intervals on compact fallback lanes', () => {
    const {graph, stream} = makeRuntimeGraph([
      makeBlock('first', 0, 10),
      makeBlock('second', 10, 20)
    ]);

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      colorScheme: {
        id: 'same-color',
        name: 'Same Color',
        getSpanFillColor: () => [9, 8, 7, 255]
      },
      settings,
      aggregation: 'icicle'
    });

    expect(getCollapsedActivityForProcessIndex(graph, result, 0)).toEqual([
      expect.objectContaining({
        startX: 0,
        endX: 20,
        color: [9, 8, 7],
        yOffset: 0
      })
    ]);
  });

  it('summarizes collapsed activity by exact process ref when row indexes are stale', () => {
    const {graph, processes} = makeRuntimeGraphForProcesses([
      {processId: 'rank-full', spans: [makeBlock('full', 0, 100)]},
      {processId: 'rank-short', spans: [makeBlock('short', 40, 50)]}
    ]);
    const shortProcessRef = graph.getProcessRefs()[1];
    if (shortProcessRef == null) {
      throw new Error('Expected short process ref');
    }
    const shortProcess = processes[1]!;
    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [
        {
          processId: shortProcess.processId,
          processRef: shortProcessRef,
          threadRefs: graph.getThreadRefsByProcessRef(shortProcessRef),
          rankIndex: 0,
          name: shortProcess.name,
          rankNum: shortProcess.rankNum,
          threads: shortProcess.threads,
          isCollapsed: true
        }
      ],
      colorScheme: defaultColorScheme,
      settings
    });
    const intervals = result.get(shortProcessRef) ?? [];

    expect(intervals.length).toBeGreaterThan(0);
    expect(intervals.every(interval => interval.startX > 0)).toBe(true);
    expect(intervals.every(interval => interval.endX < 100)).toBe(true);
  });
});
