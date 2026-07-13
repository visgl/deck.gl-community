import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_TRACE_STYLE,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from '../../../../trace';
import {TraceSameProcessDependencyCard} from './trace-same-process-dependency-card';

import type {
  SpanRef,
  TraceCardSpan,
  TraceGraph,
  TraceSameProcessDependency,
  TraceThread,
  TraceVisSettings
} from '../../../../trace';
import type {Root} from 'react-dom/client';

vi.mock('./trace-span-name-badge', () => ({
  TraceSpanNameBadge: ({
    spanRef,
    traceGraph
  }: {
    spanRef: SpanRef;
    traceGraph: Pick<TraceGraph, 'getSpanName' | 'spanFilterReason'>;
  }) => {
    const filterReason = traceGraph.spanFilterReason(spanRef);
    return (
      <span data-filtered={filterReason.isFiltered ? 'true' : 'false'}>
        {traceGraph.getSpanName(spanRef)}
      </span>
    );
  }
}));

vi.mock('../../../utils/trace-span-badge-style', () => ({
  getTraceSpanBadgeStyleForRef: () => ({})
}));

const defaultTraceVisSettings: TraceVisSettings = {
  showDependencies: true,
  sameProcessDependencyMode: 'all',
  showCrossProcessDependencies: true,
  showInstants: false,
  showCounters: false,
  showGlobalEvents: false,
  transitions: false,
  showPathsOnly: false,
  showOverview: false,
  dependencyDisplayMode: 'all',
  dependencyKeywords: [],
  dependencyOpacity: 0.1,
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
  traceTimingKey: 'latest'
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceSameProcessDependencyCard', () => {
  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  it('marks text-filtered endpoint badges as hidden', () => {
    const startSpan = createSpan(
      1,
      'hidden-start-span',
      'hidden-start-span',
      TRACE_SPAN_FILTER_MASK_REGEXP
    );
    const endSpan = createSpan(
      2,
      'hidden-end-span',
      'hidden-end-span',
      TRACE_SPAN_FILTER_MASK_SOURCE
    );

    renderTraceSameProcessDependencyCard({
      dependency: createSameProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan]
      })
    });

    expect(findBadgeByText('hidden-start-span')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('hidden-end-span')?.dataset.filtered).toBe('true');
  });
});

/**
 * Render one same-process dependency card into a fresh DOM container for testing.
 */
function renderTraceSameProcessDependencyCard(params: {
  dependency: TraceSameProcessDependency;
  traceGraph: TraceGraph;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceSameProcessDependencyCard
        dependency={params.dependency}
        traceGraph={params.traceGraph}
        traceStyle={DEFAULT_TRACE_STYLE}
        traceSettings={defaultTraceVisSettings}
      />
    );
  });
}

/**
 * Build one minimal trace span card model entry for the card renderer.
 */
function createSpan(
  spanRef: number,
  name: string,
  spanId: string,
  filterMask = TRACE_SPAN_FILTER_MASK_NONE
): TraceCardSpan {
  return {
    spanRef: spanRef as SpanRef,
    spanId: spanId as never,
    threadId: 'thread-1' as never,
    processName: 'rank-1',
    name,
    keywords: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
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
    userData: undefined,
    filterMask,
    isFiltered: filterMask !== TRACE_SPAN_FILTER_MASK_NONE
  };
}

/**
 * Build one minimal same-process dependency for the card renderer.
 */
function createSameProcessDependency(): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyId: 'dep-1' as never,
    startSpanId: 'start-span' as never,
    endSpanId: 'end-span' as never,
    waitMode: 'start-to-start',
    bidirectional: false,
    waitTimeMs: 12,
    startSpanRef: 1 as SpanRef,
    endSpanRef: 2 as SpanRef,
    keywords: new Set()
  };
}

/**
 * Build one minimal trace-graph facade that serves the card's data lookups.
 */
function createTraceGraph(params: {spans: TraceCardSpan[]}): TraceGraph {
  const spanMap = new Map(params.spans.map(span => [span.spanRef, span]));
  const thread = {
    type: 'trace-thread',
    processId: 'rank-1',
    threadId: 'thread-1' as never,
    name: 'thread-1'
  } as unknown as TraceThread;

  return {
    getSpanName: (spanRef: SpanRef) => spanMap.get(spanRef)?.name ?? null,
    getSpanOwnerRefs: () => ({
      processRef: 1 as never,
      threadRef: 1 as never
    }),
    getThreadSourceByRef: () => ({
      threadRef: 1 as never,
      processRef: 1 as never,
      name: thread.name
    }),
    spanFilterReason: (spanRef: SpanRef) => {
      const filterMask = spanMap.get(spanRef)?.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE;
      return {
        filterMask,
        isFiltered: filterMask !== TRACE_SPAN_FILTER_MASK_NONE,
        state: filterMask !== TRACE_SPAN_FILTER_MASK_NONE ? 'filtered' : 'visible'
      };
    }
  } as unknown as TraceGraph;
}

/** Returns one rendered mock badge by its label text. */
function findBadgeByText(label: string): HTMLElement | undefined {
  return [...(container?.querySelectorAll<HTMLElement>('[data-filtered]') ?? [])].find(
    element => element.textContent === label
  );
}
