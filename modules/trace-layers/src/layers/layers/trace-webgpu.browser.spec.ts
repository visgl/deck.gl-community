// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrthographicView} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  createStaticTraceGraphRuntimeSource,
  TraceGraph
} from '../../trace';
import {TraceGraphLayer} from './trace-graph-layer';

import type {
  TraceDependencyId,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../trace';

type BrowserGpu = {
  requestAdapter: () => Promise<unknown>;
};

type NativeGpuDevice = {
  addEventListener: (
    type: 'uncapturederror',
    listener: (event: {error: {message: string}}) => void
  ) => void;
  removeEventListener: (
    type: 'uncapturederror',
    listener: (event: {error: {message: string}}) => void
  ) => void;
  queue: {onSubmittedWorkDone: () => Promise<void>};
};

const TRACE_SETTINGS = {
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 1,
  enableFastTextLayer: true,
  layoutDensity: 'comfortable',
  lineRoutingMode: 'straight',
  localDependencyMode: 'all',
  minSpanTimeMs: 0,
  processLayoutMode: 'interleaved',
  showCounters: false,
  showCrossProcessDependencies: true,
  showDependencies: true,
  showEmptyProcesses: false,
  showGlobalEvents: false,
  showInstants: false,
  showOverview: false,
  showPathsOnly: false,
  sortThreads: false,
  threadDisplayMode: 'all',
  traceColorSchemeId: 'processes',
  traceOffsetMs: 0,
  traceScale: 1,
  trackAggregationMode: 'separate-threads',
  transitions: false
} as const satisfies TraceVisSettings;

/** Builds a real trace graph containing visible spans and a straight dependency. */
function createTraceGraph(): TraceGraph {
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'Main thread',
    threadId: 'webgpu-thread' as TraceThreadId,
    processId: 'webgpu-process'
  };
  const createSpan = (name: string, startTimeMs: number, endTimeMs: number): TraceSpan => ({
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
  });
  const firstSpan = createSpan('Request', 0, 8);
  const secondSpan = createSpan('Render', 10, 18);
  const dependency: TraceLocalDependency = {
    type: 'trace-local-dependency',
    dependencyId: 'webgpu-dependency' as TraceDependencyId,
    startSpanId: firstSpan.spanId,
    endSpanId: secondSpan.spanId,
    keywords: new Set(['SUBMIT']),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 2
  };
  firstSpan.localDependencyIds = [dependency.dependencyId];
  firstSpan.localDependencies = [dependency];

  const process: TraceProcess = {
    type: 'trace-process',
    processId: thread.processId,
    name: 'WebGPU process',
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [firstSpan, secondSpan],
    spanMap: {[firstSpan.spanId]: firstSpan, [secondSpan.spanId]: secondSpan},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [dependency],
    remoteDependencies: []
  };
  const traceGraphData = buildTraceGraphDataFromJSONTrace(
    buildJSONTrace([process], [], {name: 'webgpu-trace'})
  );

  return new TraceGraph(
    createStaticTraceGraphRuntimeSource({
      identityKey: 'webgpu-trace-rendering',
      traceGraphData
    })
  );
}

/** Renders the complete public graph layer with an actual selected luma device. */
async function renderTraceGraph(
  type: 'webgl' | 'webgpu',
  enableFastTextLayer: boolean
): Promise<void> {
  const parent = document.createElement('div');
  parent.style.width = '256px';
  parent.style.height = '128px';
  document.body.append(parent);

  let device: Device | undefined;
  let deck: Deck<OrthographicView> | undefined;
  let nativeGpuDevice: NativeGpuDevice | undefined;
  const validationErrors: string[] = [];
  const handleValidationError = (event: {error: {message: string}}) => {
    validationErrors.push(event.error.message);
  };

  try {
    device = await luma.createDevice({
      type,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent}
    });
    nativeGpuDevice =
      type === 'webgpu' ? (device as Device & {handle?: NativeGpuDevice}).handle : undefined;
    nativeGpuDevice?.addEventListener('uncapturederror', handleValidationError);
    const graph = createTraceGraph();
    const layer = new TraceGraphLayer({
      id: `trace-graph-${type}-${enableFastTextLayer ? 'fast-text' : 'default-text'}`,
      traceGraphs: [graph],
      settings: {...TRACE_SETTINGS, enableFastTextLayer},
      showRowSeparators: true
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error(`Timed out while rendering the trace graph with ${type}.`));
      }, 10_000);

      deck = new Deck({
        device,
        parent,
        width: 256,
        height: 128,
        views: new OrthographicView({id: 'trace-webgpu-test', flipY: true}),
        initialViewState: {target: [9, 1, 0], zoom: 3},
        layers: [layer],
        onAfterRender: () => {
          window.clearTimeout(timeout);
          resolve();
        },
        onError: error => {
          window.clearTimeout(timeout);
          reject(error);
        }
      });
    });

    await nativeGpuDevice?.queue.onSubmittedWorkDone();
    expect(device.type).toBe(type);
    expect(layer.state.traceViewState?.preparedScene.foreground).toHaveLength(1);
    expect(graph.getProcessRefs()).toHaveLength(1);
    expect(validationErrors).toEqual([]);
  } finally {
    nativeGpuDevice?.removeEventListener('uncapturederror', handleValidationError);
    deck?.finalize();
    device?.destroy();
    parent.remove();
  }
}

describe('trace graph graphics backend compatibility', () => {
  it('renders spans, default labels, and straight dependencies on WebGL2', async () => {
    await renderTraceGraph('webgl', false);
  }, 30_000);

  it('renders spans, fast labels, and straight dependencies on WebGL2', async () => {
    await renderTraceGraph('webgl', true);
  }, 30_000);

  it('automatically renders spans, labels, and straight dependencies on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTraceGraph('webgpu', false);
  }, 30_000);

  it('renders explicitly enabled fast labels and straight dependencies on WebGPU', async ({
    skip
  }) => {
    const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }

    await renderTraceGraph('webgpu', true);
  }, 30_000);
});
