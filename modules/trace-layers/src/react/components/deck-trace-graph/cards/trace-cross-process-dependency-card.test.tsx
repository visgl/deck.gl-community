import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_TRACE_STYLE,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from '../../../../trace/index';
import {TraceCrossProcessDependencyCard} from './trace-cross-process-dependency-card';

import type {
  SpanRef,
  TraceCardSpan,
  TraceCrossProcessDependency,
  TraceDependencyRef,
  TraceGraph,
  TraceProcess,
  TraceThread,
  TraceVisSettings,
  VisibleCrossDependencyRef
} from '../../../../trace/index';
import type {Root} from 'react-dom/client';

vi.mock('./trace-span-name-badge', () => ({
  TraceSpanNameBadge: ({
    filtered,
    filterMask,
    spanRef,
    traceGraph
  }: {
    filtered?: boolean;
    filterMask?: number;
    spanRef: SpanRef;
    traceGraph: Pick<TraceGraph, 'getSpanName' | 'getTraceSpanCardModel' | 'spanFilterReason'>;
  }) => {
    const filterReason = traceGraph.spanFilterReason(spanRef);
    const resolvedFilterMask = filterMask ?? filterReason.filterMask;
    const resolvedFiltered = filtered ?? filterReason.isFiltered;
    const filteredVariant =
      (resolvedFilterMask & 0x02) !== 0 && (resolvedFilterMask & 0x01) === 0
        ? 'topology'
        : 'regexp';
    return (
      <span
        data-filtered={resolvedFiltered ? 'true' : 'false'}
        data-filtered-variant={resolvedFiltered ? filteredVariant : 'none'}
      >
        {traceGraph.getSpanName?.(spanRef) ?? traceGraph.getTraceSpanCardModel(spanRef)?.span.name}
      </span>
    );
  }
}));

vi.mock('../../../utils/trace-span-badge-style', () => ({
  getTraceSpanBadgeStyle: () => ({}),
  getTraceSpanBadgeStyleForRef: () => ({})
}));

const defaultTraceVisSettings: TraceVisSettings = {
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
  traceRunSummaryAggregationKey: 'latest'
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceCrossProcessDependencyCard', () => {
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
      crossDep: createCrossDependency(),
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
      crossDep: createCrossDependency(),
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
      crossDep: createCrossDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan],
        dependencyChain: []
      })
    });

    const endpointRows = container?.querySelectorAll<HTMLElement>(
      '[data-cross-dependency-endpoint-meta]'
    );
    const processThreadLabels = container?.querySelectorAll<HTMLElement>(
      '[data-cross-dependency-process-thread]'
    );

    expect(endpointRows).toHaveLength(2);
    expect(endpointRows?.[0]?.textContent).toContain('process-1 / thread-1');
    expect(endpointRows?.[0]?.textContent).toContain('5ms');
    expect(endpointRows?.[1]?.textContent).toContain('process-1 / thread-1');
    expect(endpointRows?.[1]?.textContent).toContain('7ms');
    expect(processThreadLabels?.[0]?.className).toContain('truncate');
    expect(processThreadLabels?.[0]?.getAttribute('title')).toBe('process-1 / thread-1');
  });

  it('marks hidden top-level endpoint badges with their filtered badge variants', () => {
    const startSpan = createSpan(1, 'hidden-start-span', 'hidden-start-span', {
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
    });
    const endSpan = createSpan(2, 'hidden-end-span', 'hidden-end-span', {
      filterMask: TRACE_SPAN_FILTER_MASK_TOPOLOGY
    });

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossDependency(),
      traceGraph: createTraceGraph({
        spans: [startSpan, endSpan],
        dependencyChain: []
      })
    });

    expect(findBadgeByText('hidden-start-span')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('hidden-start-span')?.dataset.filteredVariant).toBe('regexp');
    expect(findBadgeByText('hidden-end-span')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('hidden-end-span')?.dataset.filteredVariant).toBe('topology');
  });

  it('marks raw filtered source endpoints when visible cross dependencies are stitched', () => {
    const hiddenStartSpan = createSpan(1, 'rpc.actor.call_user_python', 'hidden-start-span', {
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE
    });
    const visibleStartSpan = createSpan(2, 'visible-parent-span', 'visible-start-span');
    const endSpan = createSpan(3, 'end-span', 'end-span');
    const visibleDependencyRef = 101 as VisibleCrossDependencyRef;
    const visibleDependency = {
      ...createCrossDependency(),
      dependencyRef: visibleDependencyRef,
      startSpanId: visibleStartSpan.spanId,
      endSpanId: endSpan.spanId,
      startSpanRef: visibleStartSpan.spanRef,
      endSpanRef: endSpan.spanRef
    } satisfies TraceCrossProcessDependency;

    renderTraceCrossProcessDependencyCard({
      crossDep: visibleDependency,
      dependencyRef: visibleDependencyRef,
      traceGraph: createTraceGraph({
        spans: [hiddenStartSpan, visibleStartSpan, endSpan],
        dependencyChain: [],
        sourceEndSpanRef: endSpan.spanRef,
        sourceStartSpanRef: hiddenStartSpan.spanRef,
        visibleDependencySource: visibleDependency
      })
    });

    expect(findBadgeByText('rpc.actor.call_user_python')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('rpc.actor.call_user_python')?.dataset.filteredVariant).toBe('regexp');
    expect(container?.textContent).toContain('SOURCE');
    expect(container?.textContent).toContain('RENDERED AS');
    expect(findBadgeByText('visible-parent-span')?.dataset.filtered).toBe('false');
  });

  it('marks stitched source endpoints filtered when the raw endpoint has no mask', () => {
    const hiddenStartSpan = createSpan(1, 'raw-hidden-start', 'hidden-start-span');
    const visibleStartSpan = createSpan(2, 'visible-parent-span', 'visible-start-span');
    const endSpan = createSpan(3, 'end-span', 'end-span');
    const visibleDependencyRef = 101 as VisibleCrossDependencyRef;
    const visibleDependency = {
      ...createCrossDependency(),
      dependencyRef: visibleDependencyRef,
      startSpanId: visibleStartSpan.spanId,
      endSpanId: endSpan.spanId,
      startSpanRef: visibleStartSpan.spanRef,
      endSpanRef: endSpan.spanRef
    } satisfies TraceCrossProcessDependency;

    renderTraceCrossProcessDependencyCard({
      crossDep: visibleDependency,
      dependencyRef: visibleDependencyRef,
      traceGraph: createTraceGraph({
        spans: [hiddenStartSpan, visibleStartSpan, endSpan],
        dependencyChain: [],
        hasActiveSpanFilter: true,
        sourceEndSpanRef: endSpan.spanRef,
        sourceStartSpanRef: hiddenStartSpan.spanRef,
        visibleDependencySource: visibleDependency
      })
    });

    expect(findBadgeByText('raw-hidden-start')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('raw-hidden-start')?.dataset.filteredVariant).toBe('regexp');
    expect(container?.textContent).toContain('RENDERED AS');
    expect(findBadgeByText('visible-parent-span')?.dataset.filtered).toBe('false');
  });

  it('resolves raw hovered cross dependencies through their stitched visible dependency refs', () => {
    const hiddenStartSpan = createSpan(1, 'raw-hidden-start', 'hidden-start-span');
    const visibleStartSpan = createSpan(2, 'visible-parent-span', 'visible-start-span');
    const endSpan = createSpan(3, 'end-span', 'end-span');
    const visibleDependencyRef = 101 as VisibleCrossDependencyRef;
    const sourceDependencyRef = 202 as TraceDependencyRef;
    const hoveredDependency = {
      ...createCrossDependency(),
      dependencyRef: sourceDependencyRef,
      startSpanId: visibleStartSpan.spanId,
      endSpanId: endSpan.spanId,
      startSpanRef: visibleStartSpan.spanRef,
      endSpanRef: endSpan.spanRef
    } satisfies TraceCrossProcessDependency;
    const visibleDependency = {
      ...hoveredDependency,
      dependencyRef: visibleDependencyRef
    } satisfies TraceCrossProcessDependency;

    renderTraceCrossProcessDependencyCard({
      crossDep: hoveredDependency,
      traceGraph: createTraceGraph({
        spans: [hiddenStartSpan, visibleStartSpan, endSpan],
        dependencyChain: [],
        hasActiveSpanFilter: true,
        sourceEndSpanRef: endSpan.spanRef,
        sourceStartSpanRef: hiddenStartSpan.spanRef,
        visibleDependencyRef,
        visibleDependencySource: visibleDependency
      })
    });

    expect(findBadgeByText('raw-hidden-start')?.dataset.filtered).toBe('true');
    expect(findBadgeByText('raw-hidden-start')?.dataset.filteredVariant).toBe('regexp');
    expect(container?.textContent).toContain('RENDERED AS');
    expect(findBadgeByText('visible-parent-span')?.dataset.filtered).toBe('false');
  });

  it('keeps visible endpoints filled when the card shows a filtered parent chain', () => {
    const startSpan = createSpan(1, 'start-span', 'start-span');
    const endSpan = createSpan(2, 'end-span', 'end-span');
    const filteredParent = createSpan(3, 'filtered-parent', 'filtered-parent', {
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
    });

    renderTraceCrossProcessDependencyCard({
      crossDep: createCrossDependency(),
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
  dependencyRef?: VisibleCrossDependencyRef;
  traceGraph: TraceGraph;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceCrossProcessDependencyCard
        crossDep={params.crossDep}
        dependencyRef={params.dependencyRef}
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
 * Build one minimal parent-topology cross dependency for the card renderer.
 */
function createCrossDependency(): TraceCrossProcessDependency {
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
  sourceEndSpanRef?: SpanRef;
  sourceStartSpanRef?: SpanRef;
  visibleDependencyRef?: VisibleCrossDependencyRef;
  visibleDependencySource?: TraceCrossProcessDependency;
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
    getTraceSpanCardModel: (spanRef: SpanRef) => {
      const span = spanMap.get(spanRef) ?? null;
      return span ? {span} : null;
    },
    getSpanName: (spanRef: SpanRef) => spanMap.get(spanRef)?.name ?? null,
    getProcessSourceBySpanRef: () => ({processRef: 1 as never, name: process.name, rankNum: 0}),
    getThreadSourceBySpanRef: () => ({
      threadRef: 1 as never,
      processRef: 1 as never,
      name: thread.name
    }),
    getDependencyEndSpan: () => params.sourceEndSpanRef ?? null,
    getDependencySourceEndSpan: () => params.sourceEndSpanRef ?? null,
    getDependencySourceStartSpan: () => params.sourceStartSpanRef ?? null,
    getDependencyStartSpan: () => params.sourceStartSpanRef ?? null,
    hasActiveSpanFilter: () =>
      params.hasActiveSpanFilter ??
      params.spans.some(span => span.filterMask !== TRACE_SPAN_FILTER_MASK_NONE),
    getVisibleDependencyRefForDependency: () => params.visibleDependencyRef ?? null,
    getVisibleDependencySourceByRef: () => params.visibleDependencySource ?? null,
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
    getDependencyChainBySpanRef: () => params.dependencyChain,
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
