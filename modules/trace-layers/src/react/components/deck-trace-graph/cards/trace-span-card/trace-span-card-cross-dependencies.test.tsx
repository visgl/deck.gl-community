import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it} from 'vitest';

import {TRACE_SPAN_FILTER_MASK_NONE} from '../../../../../trace/index';
import {
  TraceSpanCrossDependencies,
  TraceSpanCrossDependenciesHorizontal
} from './trace-span-card-cross-dependencies';

import type {
  TraceCrossProcessDependency,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceSpan,
  TraceSpanId
} from '../../../../../trace/index';
import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceSpanCrossDependencies', () => {
  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('renders compact rows and an omitted-ranks summary', () => {
    const span = createBlock('target-span');
    const dependency = createDependency({
      startSpanId: span.spanId,
      endSpanId: 'current-span' as TraceSpanId,
      endRankNum: 7
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependencies
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 7, waitTimeMs: 12}),
              dependency,
              targetSpan: span
            }),
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 25}),
              dependency: null
            }),
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 9, waitTimeMs: 30}),
              dependency: null
            })
          ]}
          maxRanks={2}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    expect(container.textContent).toContain('12ms');
    expect(container.textContent).toContain('target-span');
    expect(container.textContent).toContain('start-to-start');
    expect(container.textContent).toContain('25ms');
    expect(container.textContent).toContain('...1 more processes...');
  });

  it('renders all horizontal cross dependencies in a scrollable container', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependenciesHorizontal
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 7, waitTimeMs: 12}),
              dependency: null
            }),
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 25}),
              dependency: null
            }),
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 9, waitTimeMs: 30}),
              dependency: null
            })
          ]}
          maxRanks={2}
          currentSpanId={'current-span' as TraceSpanId}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    expect(container.querySelector('.overflow-x-auto')).not.toBeNull();
    const textContent = container.textContent ?? '';
    expect(textContent).toContain('7');
    expect(textContent).toContain('8');
    expect(textContent).toContain('9');
    expect(textContent).toContain('30ms');
    expect(textContent).not.toContain('...');
  });

  it('renders an idle glyph for an unloaded unresolved rank', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependenciesHorizontal
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 25}),
              dependency: null
            })
          ]}
          maxRanks={2}
          currentSpanId={'current-span' as TraceSpanId}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    expect(container.textContent).toContain('◯');
    expect(
      container.querySelector('[aria-label="No resolved dependency for process 8"]')
    ).toBeNull();
  });

  it('renders a warning glyph for a loaded rank with no resolved dependency', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependenciesHorizontal
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 25}),
              dependency: null
            })
          ]}
          maxRanks={2}
          currentSpanId={'current-span' as TraceSpanId}
          rankQueryStatusMap={{
            8: {
              isLoading: false,
              loadStartTimestamp: 100,
              loadEndTimestamp: 200,
              error: null,
              warning: null,
              resourceName: 'Rank 8'
            }
          }}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    const unresolvedGlyph = container.querySelector(
      '[aria-label="No resolved dependency for process 8"]'
    );
    expect(unresolvedGlyph).not.toBeNull();
    expect(unresolvedGlyph?.textContent).toContain('⚠️');
    expect(container.textContent).toContain('25ms');
  });

  it('renders a loading status for an unresolved rank that is still loading', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependenciesHorizontal
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 25}),
              dependency: null
            })
          ]}
          maxRanks={2}
          currentSpanId={'current-span' as TraceSpanId}
          rankQueryStatusMap={{
            8: {
              isLoading: true,
              loadStartTimestamp: 100,
              error: null,
              warning: null,
              resourceName: 'Rank 8'
            }
          }}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    expect(container.textContent).toContain('loading');
    expect(
      container.querySelector('[aria-label="No resolved dependency for process 8"]')
    ).toBeNull();
  });

  it('renders sub-ms waits in the horizontal strip for loaded and unloaded ranks', () => {
    const span = createBlock('target-span');
    const dependency = createDependency({
      startSpanId: span.spanId,
      endSpanId: 'current-span' as TraceSpanId,
      endRankNum: 7
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    flushSync(() => {
      root?.render(
        <TraceSpanCrossDependenciesHorizontal
          endpointsWithDeps={[
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 7, waitTimeMs: 0.402}),
              dependency,
              targetSpan: span
            }),
            createEndpointEntry({
              endpoint: createEndpoint({endRankNum: 8, waitTimeMs: 0.402}),
              dependency: null
            })
          ]}
          maxRanks={2}
          currentSpanId={'current-span' as TraceSpanId}
          traceLabels={{processLabel: 'Process', spanLabel: 'Span', threadLabel: 'Thread'}}
        />
      );
    });

    expect(container.textContent).toContain('402µs');
    expect(container.textContent?.match(/402µs/g)?.length).toBe(2);
  });
});

function createBlock(name: string): TraceSpan {
  return {
    type: 'trace-span',
    spanId: name as TraceSpanId,
    threadId: 'stream-1' as never,
    processName: 'rank-1',
    name,
    keywords: [],
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 0,
        endTimeMs: 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

function createEndpointEntry(params: {
  endpoint: TraceCrossProcessEndpoint;
  dependency: TraceCrossProcessDependency | null;
  targetSpan?: TraceSpan;
}) {
  return {
    endpoint: params.endpoint,
    dependency: params.dependency,
    visibleDependencyRef: null,
    targetSpan: params.targetSpan
      ? {
          spanRef: 0 as never,
          spanId: params.targetSpan.spanId,
          threadId: params.targetSpan.threadId,
          processName: params.targetSpan.processName,
          name: params.targetSpan.name,
          keywords: params.targetSpan.keywords,
          crossProcessEndpointId: params.targetSpan.crossProcessEndpointId,
          crossProcessDependencyEndpoints: params.targetSpan.crossProcessDependencyEndpoints,
          primaryTimingKey: params.targetSpan.primaryTimingKey,
          timings: params.targetSpan.timings,
          userData: params.targetSpan.userData,
          filterMask: TRACE_SPAN_FILTER_MASK_NONE,
          isFiltered: false
        }
      : null
  };
}

function createDependency(params: {
  startSpanId: TraceSpanId;
  endSpanId: TraceSpanId;
  endRankNum: number;
}): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: `dep-${params.endRankNum}` as TraceDependencyId,
    endpointId: `endpoint-${params.endRankNum}` as TraceCrossProcessEndpointId,
    startSpanId: params.startSpanId,
    endSpanId: params.endSpanId,
    startRankNum: 1,
    endRankNum: params.endRankNum,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology: '',
    waitTimeMs: 12,
    waiting: false,
    waitNotFinished: false,
    keywords: new Set()
  };
}

function createEndpoint(params: {
  endRankNum: number;
  waitTimeMs: number;
}): TraceCrossProcessEndpoint {
  return {
    type: 'cross-process-dependency-endpoint',
    endpointId: `endpoint-${params.endRankNum}` as TraceCrossProcessEndpointId,
    startRankNum: 1,
    endRankNum: params.endRankNum,
    islandNum: 0,
    spanId: `span-${params.endRankNum}` as TraceSpanId,
    waitTimeMs: params.waitTimeMs,
    waiting: false,
    waitNotFinished: false
  };
}
