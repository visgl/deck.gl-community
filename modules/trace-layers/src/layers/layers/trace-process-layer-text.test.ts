import {describe, expect, it} from 'vitest';

import {buildJSONTrace, buildTraceLayouts, buildTracePreparedProcessRows} from '../../trace';
import {createRuntimeTraceGraph} from '../../trace/trace-graph/trace-graph-test-fixtures';
import {TraceProcessLayer} from './trace-process-layer';

import type {
  JSONTrace,
  SpanRef,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace';

describe('TraceProcessLayer text labels', () => {
  it('uses stock TextLayer span labels unless FastTextLayer is enabled', () => {
    const {graph, process} = createGraphFixture();
    const getBlockLabelLayerName = (enableFastTextLayer?: boolean) => {
      const rankLayer = createTraceProcessLayer({
        enableFastTextLayer,
        graph,
        process
      });
      const layer = rankLayer
        .renderLayers()
        ?.find(sublayer => sublayer?.id.endsWith('block-labels-above')) as
        | {
            constructor: {
              layerName?: string;
            };
          }
        | undefined;
      return layer?.constructor.layerName;
    };

    expect(getBlockLabelLayerName()).toBe('TextLayer');
    expect(getBlockLabelLayerName(false)).toBe('TextLayer');
    expect(getBlockLabelLayerName(true)).toBe('FastTextLayer');
  });
});

/** Builds one process layer instance for span-label layer implementation tests. */
function createTraceProcessLayer(params: {
  /** Whether the experimental fast text label layer is enabled. */
  readonly enableFastTextLayer?: boolean;
  /** JSON trace fixture used to build the dataset-backed process-row layout. */
  readonly graph: JSONTrace;
  /** Source process rendered by the process layer. */
  readonly process: TraceProcess;
}): TraceProcessLayer {
  const settings = getTraceSettings(params.enableFastTextLayer);
  const traceGraph = createRuntimeTraceGraph(params.graph);
  const layout = buildTraceLayouts({
    traceGraphs: [traceGraph],
    settings
  })[0]!;
  const preparedRow = buildTracePreparedProcessRows({
    graph: layout.traceGraph,
    layout,
    settings
  })[0];
  if (preparedRow?.binaryBlockData == null || preparedRow.binaryDependencyLineData == null) {
    throw new Error('Expected prepared binary process-row data.');
  }

  return new TraceProcessLayer({
    id: `rank-label-layer-${params.enableFastTextLayer === true ? 'fast' : 'default'}`,
    threads: params.process.threads,
    binaryBlockData: preparedRow.binaryBlockData,
    binaryDependencyLineData: preparedRow.binaryDependencyLineData,
    selectedSpanRefs: [],
    selectedDependencies: [],
    rankIndex: 0,
    processId: params.process.processId,
    rankNum: params.process.rankNum,
    stepNum: 0,
    onSpanClick: () => undefined,
    traceLayout: layout,
    settings
  });
}

/** Builds the one-process graph fixture used by label implementation tests. */
function createGraphFixture(): {
  /** JSON trace fixture used by dataset-backed layout construction. */
  graph: JSONTrace;
  /** Source process contained by the graph. */
  process: TraceProcess;
} {
  const process = createProcess();
  return {
    graph: buildJSONTrace([process], [], {name: 'labels'}),
    process
  };
}

/** Builds one process with one thread and one finished span. */
function createProcess(): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread',
    threadId: 'thread' as TraceThreadId,
    processId: 'rank-0'
  };
  const span: TraceSpan = {
    type: 'trace-span',
    spanRef: 0 as SpanRef,
    spanId: 'span-0' as TraceSpanId,
    threadId: thread.threadId,
    processName: 'rank-0',
    name: 'span-0',
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
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

  return {
    type: 'trace-process',
    processId: 'rank-0',
    name: 'rank-0',
    rankNum: 0,
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
  };
}

/** Returns trace settings with only the text implementation flag varied by tests. */
function getTraceSettings(enableFastTextLayer?: boolean): TraceVisSettings {
  return {
    dependencyDisplayMode: 'all',
    dependencyKeywords: [],
    dependencyOpacity: 1,
    enableFastTextLayer,
    highlightFadeFactor: 1,
    layoutDensity: 'comfortable',
    lineRoutingMode: 'straight',
    sameProcessDependencyMode: 'all',
    minSpanTimeMs: 0,
    processLayoutMode: 'interleaved',
    showCounters: true,
    showCrossProcessDependencies: true,
    showDependencies: true,
    showEmptyProcesses: false,
    showInstants: true,
    showOverview: false,
    showPathsOnly: false,
    sortThreads: false,
    threadDisplayMode: 'all',
    traceColorSchemeId: 'processes',
    traceOffsetMs: 0,
    traceScale: 1,
    trackAggregationMode: 'separate-threads',
    transitions: false
  };
}
