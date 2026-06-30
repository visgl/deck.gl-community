// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrthographicView} from '@deck.gl/core';
import {TextLayer} from '@deck.gl/layers';
import {DeckGL} from '@deck.gl/react';
import {Matrix4} from '@math.gl/core';
import {createRoot} from 'react-dom/client';
import {makeLayerFilter} from '@deck.gl-community/infovis-layers';
import {TraceGraphLayer} from '@deck.gl-community/trace-layers/layers';
import {TimeAxisLayer} from '@deck.gl-community/timeline-layers';
import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  createStaticTraceGraphRuntimeSource,
  TraceGraph
} from '@deck.gl-community/trace-layers/trace';

import type {
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '@deck.gl-community/trace-layers/trace';

const TRACE_LAYER_SETTINGS = {
  showDependencies: true,
  localDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: false,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.2,
  minSpanTimeMs: 0,
  threadDisplayMode: 'all',
  selectedThreadNames: [],
  sortThreads: false,
  lineRoutingMode: 'straight',
  layoutDensity: 'comfortable',
  processLayoutMode: 'interleaved',
  trackAggregationMode: 'separate-threads',
  traceOffsetMs: 0,
  traceScale: 1,
  traceColorSchemeId: 'processes',
  timingAggregationKey: 'latest',
  showEmptyProcesses: false
} satisfies TraceVisSettings;

const TRACE_GRAPH = createExampleTraceGraph();
const HEADER_VIEW_HEIGHT_PX = 36;
const LEGEND_VIEW_WIDTH_PX = 150;
const TRACE_DURATION_MS = Math.max(TRACE_GRAPH.maxTimeMs - TRACE_GRAPH.minTimeMs, 1);
const TIME_AXIS_MODEL_MATRIX = new Matrix4().translate([0, -12, -1]);
const TIME_AXIS_DEPTH_PARAMETERS = {
  blend: false,
  depthWriteEnabled: false,
  depthCompare: 'less'
} as const;
const TRACE_LAYER_FILTER = makeLayerFilter({
  header: {include: ['header']},
  legend: {include: ['legend']},
  main: {exclude: ['header', 'legend', 'rank-label', 'trace-global-events']}
});
const LEGEND_ROWS = [{label: 'Frontend', position: [0, 1.25] as [number, number]}];
const TRACE_VIEWS = [
  new OrthographicView({
    id: 'main',
    flipY: true,
    clear: true,
    x: LEGEND_VIEW_WIDTH_PX,
    y: HEADER_VIEW_HEIGHT_PX,
    width: `calc(100% - ${LEGEND_VIEW_WIDTH_PX}px)`,
    height: `calc(100% - ${HEADER_VIEW_HEIGHT_PX}px)`,
    controller: true
  }),
  new OrthographicView({
    id: 'header',
    flipY: true,
    clear: false,
    x: LEGEND_VIEW_WIDTH_PX,
    y: 0,
    width: `calc(100% - ${LEGEND_VIEW_WIDTH_PX}px)`,
    height: '100%',
    controller: false,
    padding: {
      top: HEADER_VIEW_HEIGHT_PX,
      bottom: `calc(100% - ${HEADER_VIEW_HEIGHT_PX}px)`
    },
    viewState: {
      id: 'main',
      target: [Number.NaN, 0],
      zoomY: 0
    }
  }),
  new OrthographicView({
    id: 'legend',
    flipY: true,
    clear: false,
    x: 0,
    y: HEADER_VIEW_HEIGHT_PX,
    width: '100%',
    height: `calc(100% - ${HEADER_VIEW_HEIGHT_PX}px)`,
    controller: false,
    padding: {
      left: LEGEND_VIEW_WIDTH_PX,
      right: `calc(100% - ${LEGEND_VIEW_WIDTH_PX}px)`
    },
    viewState: {
      id: 'main',
      target: [0, Number.NaN],
      zoomX: 12
    }
  })
];
const INITIAL_VIEW_STATE = {
  target: [TRACE_DURATION_MS / 2, 2.5, 0] as [number, number, number],
  zoom: [5, 5] as [number, number],
  minZoom: -4,
  maxZoom: 12
};

/** Mounts the non-React-viewer TraceGraphLayer example into a supplied container. */
export function mountTraceGraphLayerExample(container: HTMLElement): () => void {
  const root = createRoot(container);
  root.render(<TraceGraphLayerExample />);

  return () => {
    root.unmount();
    container.replaceChildren();
  };
}

/** Renders one trace graph inside a caller-owned DeckGL shell. */
function TraceGraphLayerExample() {
  return (
    <div style={{position: 'relative', width: '100%', height: '100%', background: '#fff'}}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          left: 0,
          height: HEADER_VIEW_HEIGHT_PX,
          borderBottom: '1px solid #e5e7eb',
          background: '#fff'
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: HEADER_VIEW_HEIGHT_PX,
          bottom: 0,
          left: 0,
          width: LEGEND_VIEW_WIDTH_PX,
          borderRight: '1px solid #e5e7eb',
          background: '#fff'
        }}
      />
      <DeckGL
        style={{position: 'absolute', top: '0', right: '0', bottom: '0', left: '0'}}
        views={TRACE_VIEWS}
        initialViewState={INITIAL_VIEW_STATE}
        layers={[
          new TimeAxisLayer({
            id: 'header-time-axis',
            mode: 'duration',
            formatTick: tick => (tick.type === 'major' ? `${tick.value} ms` : ''),
            modelMatrix: TIME_AXIS_MODEL_MATRIX,
            minX: 0,
            maxX: TRACE_DURATION_MS,
            minY: 0,
            maxY: 1e6,
            tickCount: 5,
            minorTickCount: 2,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontSize: 10,
            coverage: 3,
            labelY: -4,
            textColor: [0, 0, 0, 255],
            gridColor: [0, 0, 0, 60],
            parameters: TIME_AXIS_DEPTH_PARAMETERS,
            _subLayerProps: {
              'axis-line': {
                parameters: TIME_AXIS_DEPTH_PARAMETERS
              },
              'tick-marks': {
                parameters: TIME_AXIS_DEPTH_PARAMETERS
              }
            }
          }),
          new TextLayer({
            id: 'legend-process-labels',
            data: LEGEND_ROWS,
            getPosition: row => row.position,
            getText: row => row.label,
            getTextAnchor: 'start',
            getAlignmentBaseline: 'center',
            getPixelOffset: [16, 0],
            getColor: [31, 41, 55, 255],
            getSize: 12,
            fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
            fontWeight: 600,
            pickable: false
          }),
          new TraceGraphLayer({
            id: 'trace-graph',
            traceGraphs: [TRACE_GRAPH],
            settings: TRACE_LAYER_SETTINGS
          })
        ]}
        layerFilter={TRACE_LAYER_FILTER}
        getCursor={({isDragging}) => (isDragging ? 'grabbing' : 'grab')}
      />
    </div>
  );
}

/** Builds the small normalized graph rendered by this layers-only example. */
function createExampleTraceGraph(): TraceGraph {
  const traceGraphData = buildTraceGraphDataFromJSONTrace(
    buildJSONTrace([createExampleProcess('frontend', 0)], [], {name: 'trace-graph-layer-example'})
  );
  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: 'trace-graph-layer-example',
      traceGraphData
    })
  );
}

/** Creates one process with a local dependency chain for the example graph. */
function createExampleProcess(processId: string, rankNum: number): TraceProcess {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'Main thread',
    threadId: `${processId}-main` as TraceThreadId,
    processId
  };
  const requestSpan = createSpan('Request', thread, 1, 5);
  const parseSpan = createSpan('Parse', thread, 7, 11);
  const renderSpan = createSpan('Render', thread, 13, 18);
  const requestToParse = createDependency('request-to-parse', requestSpan, parseSpan);
  const parseToRender = createDependency('parse-to-render', parseSpan, renderSpan);
  requestSpan.localDependencyIds = [requestToParse.dependencyId];
  requestSpan.localDependencies = [requestToParse];
  parseSpan.localDependencyIds = [parseToRender.dependencyId];
  parseSpan.localDependencies = [parseToRender];

  return {
    type: 'trace-process',
    processId,
    name: 'Frontend',
    rankNum,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [requestSpan, parseSpan, renderSpan],
    spanMap: {
      [requestSpan.spanId]: requestSpan,
      [parseSpan.spanId]: parseSpan,
      [renderSpan.spanId]: renderSpan
    },
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [requestToParse, parseToRender],
    remoteDependencies: []
  };
}

/** Creates one finished example span. */
function createSpan(
  name: string,
  thread: TraceThread,
  startTimeMs: number,
  endTimeMs: number
): TraceSpan {
  return {
    type: 'trace-span',
    spanId: name.toLowerCase() as TraceSpanId,
    threadId: thread.threadId,
    processName: thread.processId,
    name,
    keywords: [],
    primaryTimingKey: 'primary',
    timings: {
      primary: {
        status: 'finished',
        startTimeMs,
        endTimeMs,
        durationMs: endTimeMs - startTimeMs,
        durationMsAsString: `${endTimeMs - startTimeMs}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

/** Creates one end-to-start local dependency between example spans. */
function createDependency(
  dependencyId: string,
  startSpan: TraceSpan,
  endSpan: TraceSpan
): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: dependencyId as TraceDependencyId,
    startSpanId: startSpan.spanId,
    endSpanId: endSpan.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: endSpan.timings.primary.startTimeMs - startSpan.timings.primary.endTimeMs
  };
}
