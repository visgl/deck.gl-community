import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  DEFAULT_TRACE_STYLE,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE
} from '../../../../trace';
import {TraceCrossProcessDependencyCard} from './trace-cross-process-dependency-card';

import type {
  SpanRef,
  TraceCardSpan,
  TraceCrossProcessDependency,
  TraceGraph,
  TraceProcess,
  TraceThread,
  TraceVisSettings
} from '../../../../trace';
import type {Root} from 'react-dom/client';

const getTraceSpanDependencyChainMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../trace', () => ({
  DEFAULT_TRACE_STYLE: {},
  TRACE_SPAN_FILTER_MASK_NONE: 0x00,
  TRACE_SPAN_FILTER_MASK_REGEXP: 0x01,
  TRACE_SPAN_FILTER_MASK_SOURCE: 0x02,
  formatTimeMs: (timeMs: number) => `${timeMs}ms`,
  getCrossProcessDependencyRefIndex: (dependencyRef: number) => dependencyRef,
  getTraceSpanDependencyChain: getTraceSpanDependencyChainMock,
  isCrossProcessDependencyRef: () => false,
  materializeTraceCrossProcessDependencyFromArrowRow: () => null
}));

vi.mock('./trace-span-name-badge', () => ({
  TraceSpanNameBadge: ({
    filtered,
    spanRef,
    traceGraph
  }: {
    filtered?: boolean;
    spanRef: SpanRef;
    traceGraph: Pick<TraceGraph, 'getSpanName' | 'spanFilterReason'>;
  }) => {
    const filterReason = traceGraph.spanFilterReason(spanRef);
    const resolvedFiltered = filtered ?? filterReason.isFiltered;
    return (
      <span data-filtered={resolvedFiltered ? 'true' : 'false'}>
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

describe('TraceCrossProcessDependencyCard', () => {
  beforeEach(() => {
    getTraceSpanDependencyChainMock.mockImplementation(traceGraph => {
      return (
        (
          traceGraph as TraceGraph & {
            testDependencyChain?: TraceCardSpan[];
          }
        ).testDependencyChain ?? []
      );
    });
  });

  afterEach(() => {
    flushSync(() => {
      root?.unmount();
    });
    root = null;
    container?.remove();
    container = null;
  });

  it('shows the filtered parent count and truncates the badge list after five entries', () => {
    const startSpan = createSpan(1, 'start-span', 'start-span');
    const endSpan = createSpan(2, 'end-span', 'end-span');
    const filteredParents = Array.from({length: 10}, (_, index) =>
      createSpan(index + 3, `filtered-parent-${index + 1}`, `parent-span-${index + 1}`, {
        filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
      })
    );

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan, ...filteredParents],
        dependencyChain: filteredParents
      })
    });

    expect(container?.textContent).toContain('FILTERED PARENTS (10)');
    for (const parent of filteredParents.slice(0, 5)) {
      expect(container?.textContent).toContain(parent.name);
    }
    for (const parent of filteredParents.slice(5)) {
      expect(container?.textContent).not.toContain(parent.name);
    }
    expect(container?.textContent).toContain('...');
  });

  it('omits the truncation marker when five or fewer filtered parents are present', () => {
    const startSpan = createSpan(1, 'start-span', 'start-span');
    const endSpan = createSpan(2, 'end-span', 'end-span');
    const filteredParents = Array.from({length: 5}, (_, index) =>
      createSpan(index + 3, `filtered-parent-${index + 1}`, `parent-span-${index + 1}`, {
        filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
      })
    );

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan, ...filteredParents],
        dependencyChain: filteredParents
      })
    });

    expect(container?.textContent).toContain('FILTERED PARENTS (5)');
    for (const parent of filteredParents) {
      expect(container?.textContent).toContain(parent.name);
    }
    expect(container?.querySelector('[aria-label="Filtered parents truncated"]')).toBeNull();
  });

  it('renders compact process/thread endpoint rows with both span durations', () => {
    const startSpan = createSpan(1, 'start-span', 'start-span', {
      durationMs: 5,
      durationMsAsString: '5ms'
    });
    const endSpan = createSpan(2, 'end-span', 'end-span', {
      durationMs: 7,
      durationMsAsString: '7ms'
    });

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan],
        dependencyChain: []
      })
    });

    const endpointRows = container?.querySelectorAll<HTMLElement>(
      '[data-cross-process-dependency-endpoint-meta]'
    );
    const processThreadLabels = container?.querySelectorAll<HTMLElement>(
      '[data-cross-process-dependency-process-thread]'
    );

    expect(endpointRows).toHaveLength(2);
    expect(endpointRows?.[0]?.textContent).toContain('process-1 / thread-1');
    expect(endpointRows?.[0]?.textContent).toContain('5ms');
    expect(endpointRows?.[1]?.textContent).toContain('process-1 / thread-1');
    expect(endpointRows?.[1]?.textContent).toContain('7ms');
    expect(processThreadLabels?.[0]?.className).toContain('truncate');
    expect(processThreadLabels?.[0]?.getAttribute('title')).toBe('process-1 / thread-1');
  });

  it('marks text-filtered top-level endpoint badges as hidden', () => {
    const startSpan = createSpan(1, 'hidden-start-span', 'hidden-start-span', {
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
    });
    const endSpan = createSpan(2, 'hidden-end-span', 'hidden-end-span', {
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE
    });

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan],
        dependencyChain: []
      })
    });

    expect(findBadgeByText('hidden-start-span')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('hidden-end-span')?.dataset.filtered).toBe('true');
  });

  it('keeps visible endpoints filled when the card shows a filtered parent chain', () => {
    const startSpan = createSpan(1, 'start-span', 'start-span');
    const endSpan = createSpan(2, 'end-span', 'end-span');
    const filteredParent = createSpan(3, 'filtered-parent', 'filtered-parent', {
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
    });

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossProcessDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan, filteredParent],
        dependencyChain: [filteredParent]
      })
    });

    expect(findBadgeByText('start-span')?.dataset.filtered).toBe('false');
    expect(findBadgeByText('end-span')?.dataset.filtered).toBe('false');
    expect(findBadgeByText('filtered-parent')?.dataset.filtered).toBe('true');
  });
});

/**
 * Render one cross-rank dependency card into a fresh DOM container for testing.
 */
function renderTraceCrossProcessDependencyCard(params: {
  crossDep: TraceCrossProcessDependency;
  traceGraph: TraceGraph;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceCrossProcessDependencyCard
        crossDep={params.crossDep}
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
  options: {
    filterMask?: TraceCardSpan['filterMask'];
    durationMs?: number;
    durationMsAsString?: string;
  } = {}
): TraceCardSpan {
  const durationMs = options.durationMs ?? 1;
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
        endTimeMs: durationMs,
        durationMs,
        durationMsAsString: options.durationMsAsString ?? `${durationMs}ms`
      }
    },
    userData: undefined,
    filterMask: options.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE,
    isFiltered: (options.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE) !== TRACE_SPAN_FILTER_MASK_NONE
  };
}

/**
 * Build one minimal parent-topology cross-process dependency for the card renderer.
 */
function createCrossProcessDependency(): TraceCrossProcessDependency {
  return {
    type: 'trace-cross-process-dependency',
    dependencyId: 'dep-1' as never,
    endpointId: 'endpoint-1' as never,
    startSpanId: 'start-span' as never,
    endSpanId: 'end-span' as never,
    startRankNum: 1,
    endRankNum: 2,
    waitMode: 'start-to-start',
    bidirectional: false,
    topology: 'parent',
    waitTimeMs: 12,
    waiting: false,
    waitNotFinished: false,
    startSpanRef: 1 as SpanRef,
    endSpanRef: 2 as SpanRef,
    keywords: new Set(['PARENT'])
  };
}

/**
 * Build one minimal trace-graph facade that serves the card's data lookups.
 */
function createTraceGraph(params: {
  spans: TraceCardSpan[];
  dependencyChain: TraceCardSpan[];
  hasActiveSpanFilter?: boolean;
}): TraceGraph {
  const spanMap = new Map(params.spans.map(span => [span.spanRef, span]));
  const process = {
    type: 'trace-process',
    processId: 'rank-1',
    name: 'process-1'
  } as unknown as TraceProcess;
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
    getProcessSourceByRef: () => ({processRef: 1 as never, name: process.name, rankNum: 0}),
    getThreadSourceByRef: () => ({
      threadRef: 1 as never,
      processRef: 1 as never,
      name: thread.name
    }),
    hasActiveSpanFilter: () =>
      params.hasActiveSpanFilter ??
      params.spans.some(span => span.filterMask !== TRACE_SPAN_FILTER_MASK_NONE),
    spanFilterReason: (spanRef: SpanRef) => {
      const filterMask = spanMap.get(spanRef)?.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE;
      return {
        filterMask,
        isFiltered: filterMask !== TRACE_SPAN_FILTER_MASK_NONE,
        state: filterMask !== TRACE_SPAN_FILTER_MASK_NONE ? 'filtered' : 'visible'
      };
    },
    getSpanDurationLabel: (spanRef: SpanRef) =>
      spanMap.get(spanRef)?.timings.default?.durationMsAsString ?? null,
    getSpanDurationMs: (spanRef: SpanRef) =>
      spanMap.get(spanRef)?.timings.default?.durationMs ?? null,
    testDependencyChain: params.dependencyChain,
    spanIsFiltered: (spanRef: SpanRef) =>
      (spanMap.get(spanRef)?.filterMask ?? TRACE_SPAN_FILTER_MASK_NONE) !==
      TRACE_SPAN_FILTER_MASK_NONE
  } as unknown as TraceGraph;
}

/** Returns one rendered mock badge by its label text. */
function findBadgeByText(label: string): HTMLElement | undefined {
  return [...(container?.querySelectorAll<HTMLElement>('[data-filtered]') ?? [])].find(
    element => element.textContent === label
  );
}
