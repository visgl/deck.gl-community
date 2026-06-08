import {describe, expect, it} from 'vitest';

import {buildTraceGraphDataFromJSONTrace} from '../ingestion/arrow-trace';
import {buildJSONTrace} from '../ingestion/json-trace';
import {createStaticTraceGraphRuntimeSource} from '../trace-chunk-store';
import {buildCollapsedActivityByTraceGraphRows} from './collapsed-activity';
import {TraceGraph} from './trace-graph';
import {buildTraceLayoutSpanGeometryChunksForTest} from './trace-graph-test-utils';

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
  const stream = {
    type: 'trace-thread',
    threadId: 'stream:test' as TraceThreadId,
    processId: 'rank1',
    name: 'Stream 1'
  } as TraceThread;
  const process = {
    type: 'trace-process',
    processId: 'rank1',
    name: 'rank1',
    rankNum: 1,
    stepNum: 0,
    threads: [stream],
    threadMap: {
      [stream.threadId]: stream
    },
    spans: spans.map(span => ({
      ...span,
      threadId: stream.threadId,
      processName: 'rank1'
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
  return {
    graph: createTestTraceGraph(
      buildTraceGraphDataFromJSONTrace(
        buildJSONTrace([process], [], {
          name: 'test',
          timeExtents: getTestTimeExtents(spans)
        })
      )
    ),
    stream
  };
}

/** Returns explicit raw span bounds for collapsed-activity fixtures. */
function getTestTimeExtents(spans: readonly TraceSpan[]) {
  if (spans.length === 0) {
    return {minTimeMs: 0, maxTimeMs: 0};
  }
  return {
    minTimeMs: Math.min(
      ...spans.map(span => span.timings[span.primaryTimingKey]?.startTimeMs ?? 0)
    ),
    maxTimeMs: Math.max(...spans.map(span => span.timings[span.primaryTimingKey]?.endTimeMs ?? 0))
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
    rankIndex: 0,
    name: 'rank1',
    rankNum: 1,
    threads: [stream],
    isCollapsed: true
  };
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

    expect(result.rank1?.length).toBeGreaterThan(0);
    expect(result.rank1?.some(interval => interval.height != null)).toBe(false);
  });

  it('builds compact icicle intervals from runtime graph geometry bands', () => {
    const {graph, stream} = makeRuntimeGraph([
      makeBlock('parent', 0, 100),
      makeBlock('child', 10, 90)
    ]);
    const spans = graph.getVisibleProcessDisplaySources(graph.getProcessRefs()[0]!);
    const colorScheme = {
      id: 'icicle-test',
      name: 'Icicle Test',
      getSpanFillColor: ({span}) => (span.name === 'parent' ? [1, 2, 3, 255] : [4, 5, 6, 255])
    } satisfies TraceColorScheme;

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      geometryLayout: {
        spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest([
          [spans[0]!.spanRef, new Float32Array([0, 0, 100, 1])],
          [spans[1]!.spanRef, new Float32Array([10, 10, 90, 11])]
        ])
      } as unknown as Parameters<
        typeof buildCollapsedActivityByTraceGraphRows
      >[0]['geometryLayout'],
      colorScheme,
      settings,
      aggregation: 'icicle'
    });

    expect(result.rank1).toEqual([
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
    expect(result.rank1?.[1]?.yOffset).toBeGreaterThan(0);
    expect(result.rank1?.[1]?.yOffset).toBeLessThan(0.3);
  });

  it('quantizes hundreds of runtime graph icicle lanes into fixed visual bands', () => {
    const {graph, stream} = makeRuntimeGraph(
      Array.from({length: 200}, (_, index) => makeBlock(`span-${index}`, 0, 20))
    );
    const spans = graph.getVisibleProcessDisplaySources(graph.getProcessRefs()[0]!);

    const result = buildCollapsedActivityByTraceGraphRows({
      graph,
      rows: [makeRow(graph, stream)],
      geometryLayout: {
        spanGeometryChunks: buildTraceLayoutSpanGeometryChunksForTest(
          spans.map((span, index) => [span.spanRef, new Float32Array([0, index, 20, index + 0.5])])
        )
      } as unknown as Parameters<
        typeof buildCollapsedActivityByTraceGraphRows
      >[0]['geometryLayout'],
      colorScheme: defaultColorScheme,
      settings,
      aggregation: 'icicle'
    });

    const yOffsets = new Set(result.rank1?.map(interval => interval.yOffset));
    expect(yOffsets.size).toBeLessThanOrEqual(6);
    expect(yOffsets.has(0)).toBe(true);
    expect(
      Math.max(...[...yOffsets].filter((value): value is number => value != null))
    ).toBeGreaterThan(0.5);
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

    expect(result.rank1).toEqual([
      expect.objectContaining({
        startX: 0,
        endX: 20,
        color: [9, 8, 7],
        yOffset: 0
      })
    ]);
  });
});
