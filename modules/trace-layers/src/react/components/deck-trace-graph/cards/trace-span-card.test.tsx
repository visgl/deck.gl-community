import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  buildJSONTrace,
  buildTraceGraphDataFromJSONTrace,
  DEFAULT_TRACE_STYLE,
  materializeJSONTrace,
  TraceGraph
} from '../../../../trace/index';
import {createStaticTraceGraphRuntimeSource} from '../../../../trace/trace-chunk-store';
import {
  getRequiredSpanRef,
  getRequiredSpanRefBySpanId
} from '../../../../trace/trace-graph/trace-graph-test-utils';
import {TraceSpanCard} from './trace-span-card';
import {TraceSpanHistogramsTab} from './trace-span-card/trace-span-card-tab-histogram';
import {TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX} from './trace-span-card/trace-span-card-types';

import type {
  JSONTrace,
  SpanRef,
  TraceCrossProcessEndpoint,
  TraceCrossProcessEndpointId,
  TraceDependencyId,
  TraceGraphOverlappingParentSpanFilter,
  TraceGraphSimilarDurationChainSpanFilter,
  TraceLocalDependency,
  TraceProcess,
  TraceSpan,
  TraceSpanId,
  TraceThread,
  TraceThreadId,
  TraceVisSettings
} from '../../../../trace/index';
import type {
  TraceSpanCardCustomTab,
  TraceSpanCardTabId,
  TraceSpanHistogramSpec
} from './trace-span-card/trace-span-card-types';
import type {ReactNode} from 'react';
import type {Root} from 'react-dom/client';

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

vi.mock('@sqlrooms/ui', () => ({
  Badge: ({children, ...props}: {children?: ReactNode}) => <div {...props}>{children}</div>,
  Checkbox: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked?: boolean;
    onCheckedChange?: (nextValue: boolean) => void;
  }) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={event => onCheckedChange?.(event.currentTarget.checked)}
      {...props}
    />
  ),
  Tabs: ({
    children,
    onValueChange: _onValueChange,
    ...props
  }: {
    children?: ReactNode;
    onValueChange?: (value: string) => void;
  }) => {
    void _onValueChange;
    return <div {...props}>{children}</div>;
  },
  TabsList: ({children, ...props}: {children?: ReactNode}) => <div {...props}>{children}</div>,
  TabsTrigger: ({children, ...props}: {children?: ReactNode}) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  cn: (...values: Array<string | undefined | null | false>) => values.filter(Boolean).join(' ')
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function getDependencyTableSpanTexts(rendered: HTMLDivElement): string[] {
  return getDependencyTableColumnTexts(rendered, 'Span').filter(
    text => !text.startsWith('...omitted')
  );
}

function getDependencyTableModeTexts(rendered: HTMLDivElement): string[] {
  return getDependencyTableColumnTexts(rendered, 'Mode');
}

function getDependencyTableMetricTexts(rendered: HTMLDivElement): string[] {
  return getDependencyTableColumnTexts(rendered, 'Wait');
}

/** Return non-empty dependency-table cell text for the named visible header. */
function getDependencyTableColumnTexts(rendered: HTMLDivElement, columnLabel: string): string[] {
  return [...rendered.querySelectorAll('table')].flatMap(table => {
    const headerIndex = [...table.querySelectorAll('thead th')].findIndex(
      header => getDependencyTableHeaderLabel(header) === columnLabel.toLowerCase()
    );
    if (headerIndex < 0) {
      return [];
    }
    return [...table.querySelectorAll(`tbody tr td:nth-child(${headerIndex + 1})`)]
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(Boolean);
  });
}

/** Return non-empty dependency-table cell text under the header with one named select. */
function getDependencyTableSelectColumnTexts(
  rendered: HTMLDivElement,
  ariaLabel: string
): string[] {
  return [...rendered.querySelectorAll('table')].flatMap(table => {
    const headerIndex = [...table.querySelectorAll('thead th')].findIndex(
      header => header.querySelector(`select[aria-label="${ariaLabel}"]`) !== null
    );
    if (headerIndex < 0) {
      return [];
    }
    return [...table.querySelectorAll(`tbody tr td:nth-child(${headerIndex + 1})`)]
      .map(cell => cell.textContent?.trim() ?? '')
      .filter(Boolean);
  });
}

/** Return one normalized dependency-table header label, including active timing picker values. */
function getDependencyTableHeaderLabel(header: Element): string {
  const select = header.querySelector('select');
  if (select instanceof HTMLSelectElement) {
    const ariaLabel = select.getAttribute('aria-label');
    if (ariaLabel?.endsWith(' visibility')) {
      return ariaLabel.slice(0, -' visibility'.length).toLowerCase();
    }
    return select.selectedOptions[0]?.textContent?.trim().toLowerCase() ?? '';
  }
  return header.textContent?.trim().toLowerCase() ?? '';
}

function getFilteredBadgeTexts(rendered: HTMLDivElement): string[] {
  return [...rendered.querySelectorAll('.border-muted-foreground')]
    .map(element => element.textContent?.trim() ?? '')
    .filter(Boolean);
}

function getTopologyFilteredBadgeTexts(rendered: HTMLDivElement): string[] {
  return [...rendered.querySelectorAll('[style*="border-color"]')]
    .map(element => element.textContent?.trim() ?? '')
    .filter(Boolean);
}

function getChildDepths(rendered: HTMLDivElement): string[] {
  return [...rendered.querySelectorAll('tbody tr td:nth-child(3) [data-child-depth]')]
    .map(element => element.getAttribute('data-child-depth') ?? '')
    .filter(Boolean);
}

function getHistogramCountTickTexts(rendered: HTMLDivElement): string[] {
  return [...rendered.querySelectorAll('.h-14.w-6 span')]
    .map(element => element.textContent?.trim() ?? '')
    .filter(Boolean);
}

function getHistogramBarHeights(rendered: HTMLDivElement, ariaLabel: string): number[] {
  const svg = rendered.querySelector(`svg[aria-label="${ariaLabel}"]`);
  return [...(svg?.querySelectorAll('rect[data-histogram-bar="true"]') ?? [])].map(bar =>
    Number(bar.getAttribute('height') ?? '0')
  );
}

function getTraceSpanCardTabBody(rendered: HTMLDivElement): HTMLDivElement {
  const tabBody = rendered.querySelector('[data-testid="trace-span-card-tab-body"]');
  if (!(tabBody instanceof HTMLDivElement)) {
    throw new Error('Missing trace span card tab body');
  }
  return tabBody;
}

function clickButton(rendered: HTMLDivElement, label: string) {
  const button = [...rendered.querySelectorAll('button')].find(
    candidate => candidate.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  flushSync(() => {
    button.click();
  });
}

function doubleClickButton(rendered: HTMLDivElement, label: string) {
  const button = [...rendered.querySelectorAll('button')].find(
    candidate => candidate.textContent?.trim() === label
  );
  if (!button) {
    throw new Error(`Missing button: ${label}`);
  }
  flushSync(() => {
    button.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
  });
}

function changeSelectValue(rendered: HTMLDivElement, ariaLabel: string, value: string) {
  const select = [...rendered.querySelectorAll('select')].find(
    candidate => candidate.getAttribute('aria-label') === ariaLabel
  );
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select: ${ariaLabel}`);
  }
  flushSync(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
  });
}

/** Return the current value for one select identified by its accessible label. */
function getSelectValue(rendered: HTMLDivElement, ariaLabel: string): string {
  const select = [...rendered.querySelectorAll('select')].find(
    candidate => candidate.getAttribute('aria-label') === ariaLabel
  );
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Missing select: ${ariaLabel}`);
  }
  return select.value;
}

function hoverHistogramBar(rendered: HTMLDivElement, ariaLabel: string, index = 0) {
  const svg = rendered.querySelector(`svg[aria-label="${ariaLabel}"]`);
  const hitbox = svg?.querySelectorAll('rect[data-histogram-hitbox="true"]')[index];
  if (!(hitbox instanceof SVGRectElement)) {
    throw new Error(`Missing histogram hitbox ${index} for ${ariaLabel}`);
  }
  flushSync(() => {
    hitbox.focus();
  });
}

function rerenderTraceSpanCard(params: {
  span: TraceSpan;
  traceGraph: JSONTrace;
  interactive?: boolean;
  showChildrenTab?: boolean;
  showCrossProcessDependencies?: boolean;
  /** Caller-selected active tab restored into the interactive card. */
  selectedTab?: TraceSpanCardTabId;
  /** Callback fired when the interactive card selects another tab. */
  onSelectedTabChange?: (selectedTab: TraceSpanCardTabId) => void;
  selectedTabStorageKey?: string;
  tabBodyHeightPx?: number;
}) {
  const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(params.traceGraph), {});
  const tabOptions = {
    showChildren: params.showChildrenTab,
    showCrossProcessDependencies: params.showCrossProcessDependencies
  };
  flushSync(() => {
    root?.render(
      <TraceSpanCard
        spanRef={getRequiredSpanRef(traceGraph, params.span)}
        traceGraph={traceGraph}
        tabOptions={tabOptions}
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        traceStyle={DEFAULT_TRACE_STYLE}
        traceSettings={{} as TraceVisSettings}
        interactive={params.interactive ?? true}
        selectedTab={params.selectedTab}
        onSelectedTabChange={params.onSelectedTabChange}
        selectedTabStorageKey={params.selectedTabStorageKey}
        tabBodyHeightPx={params.tabBodyHeightPx}
      />
    );
  });

  return container!;
}
function createParentChainGraph(parentCount: number): {
  span: TraceSpan;
  traceGraph: JSONTrace;
} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const spans: TraceSpan[] = [];
  const localDependencies: TraceLocalDependency[] = [];

  for (let index = 0; index < parentCount + 1; index += 1) {
    const spanId =
      index < parentCount ? (`parent-${index + 1}` as TraceSpanId) : ('child' as TraceSpanId);
    const name = index < parentCount ? `parent-${index + 1}` : 'child';
    const span: TraceSpan = {
      type: 'trace-span',
      spanId,
      threadId: thread.threadId,
      processName: processId,
      name,
      keywords: [],
      primaryTimingKey: 'default',
      timings: {
        default: {
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
    spans.push(span);
  }

  for (let index = 0; index < parentCount; index += 1) {
    const startBlock = spans[index];
    const endBlock = spans[index + 1];
    if (!startBlock || !endBlock) {
      continue;
    }
    const dependencyId = `dep-${index + 1}` as TraceDependencyId;
    const dependency: TraceLocalDependency = {
      type: 'trace-local-dependency',
      dependencyId,
      startSpanId: startBlock.spanId,
      endSpanId: endBlock.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    };
    endBlock.localDependencyIds.push(dependencyId);
    localDependencies.push(dependency);
  }

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: spans[spans.length - 1]!,
    traceGraph: buildJSONTrace([process], [], {name: 'parent-chain'})
  };
}

function renderTraceSpanCard(params?: {
  spanFilter?: string;
  parentCount?: number;
  interactive?: boolean;
  /** Callback when a block badge is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: 'select' | 'select-and-focus') => void;
  traceGraph?: JSONTrace;
  span?: TraceSpan;
  traceRunSummaryAggregationKey?: string;
  timezone?: string;
  dependencyTabLabel?: string;
  outgoingDependencyTabLabel?: string;
  allDependencyTabLabel?: string;
  alwaysShowAllInteractiveTabs?: boolean;
  showChildrenTab?: boolean;
  showOutgoingDependenciesTab?: boolean;
  showCrossProcessDependencies?: boolean;
  dependencyMetric?: 'wait' | 'duration';
  /** Local dependency render filter used to verify inspector data is not render-filtered. */
  localDependencyMode?: TraceVisSettings['localDependencyMode'];
  /** Topology filter that removes short overlapping parent/child spans. */
  overlappingParentSpanFilter?: TraceGraphOverlappingParentSpanFilter;
  /** Topology filter that removes linear same-duration parent chains. */
  similarDurationChainSpanFilter?: TraceGraphSimilarDurationChainSpanFilter;
  selectedTabStorageKey?: string;
  /** Caller-selected active tab restored into the interactive card. */
  selectedTab?: TraceSpanCardTabId;
  /** Callback fired when the interactive card selects another tab. */
  onSelectedTabChange?: (selectedTab: TraceSpanCardTabId) => void;
  traversalContent?: ReactNode;
  customTabs?: TraceSpanCardCustomTab[];
  tabBodyHeightPx?: number;
}) {
  const fallbackGraph = createParentChainGraph(params?.parentCount ?? 7);
  const span = params?.span ?? fallbackGraph.span;
  const sourceTraceGraph = params?.traceGraph ?? fallbackGraph.traceGraph;
  const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {
    spanFilters: params?.spanFilter ? params.spanFilter.split('|').filter(Boolean) : undefined,
    overlappingParentSpanFilter: params?.overlappingParentSpanFilter,
    similarDurationChainSpanFilter: params?.similarDurationChainSpanFilter
  });
  const tabOptions = {
    dependencyLabel: params?.dependencyTabLabel,
    outgoingDependencyLabel: params?.outgoingDependencyTabLabel,
    alwaysShowAll: params?.alwaysShowAllInteractiveTabs,
    showChildren: params?.showChildrenTab,
    showOutgoingDependencies: params?.showOutgoingDependenciesTab,
    showCrossProcessDependencies: params?.showCrossProcessDependencies,
    dependencyMetric: params?.dependencyMetric
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceSpanCard
        spanRef={getRequiredSpanRef(traceGraph, span)}
        traceGraph={traceGraph}
        tabOptions={tabOptions}
        traversalContent={params?.traversalContent}
        customTabs={params?.customTabs}
        traceLabels={DEFAULT_TRACE_STYLE.labels}
        traceStyle={DEFAULT_TRACE_STYLE}
        traceSettings={
          {
            spanFilter: params?.spanFilter,
            traceRunSummaryAggregationKey: params?.traceRunSummaryAggregationKey,
            timezone: params?.timezone,
            localDependencyMode: params?.localDependencyMode
          } as TraceVisSettings
        }
        interactive={params?.interactive ?? true}
        onSpanDoubleClick={params?.onSpanDoubleClick}
        selectedTab={params?.selectedTab}
        onSelectedTabChange={params?.onSelectedTabChange}
        selectedTabStorageKey={params?.selectedTabStorageKey}
        tabBodyHeightPx={params?.tabBodyHeightPx}
      />
    );
  });

  return container;
}

function renderTraceSpanHistogramsTab(params?: {
  histograms?: TraceSpanHistogramSpec[];
  interactive?: boolean;
}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  const histograms = params?.histograms ?? [
    createTraceSpanHistogramSpec({id: 'duration', title: 'Duration'}),
    createTraceSpanHistogramSpec({id: 'completion', title: 'Completion'})
  ];

  flushSync(() => {
    root?.render(
      <TraceSpanHistogramsTab histograms={histograms} interactive={params?.interactive} />
    );
  });

  return container;
}

function createTraceSpanHistogramSpec(params: {
  id: string;
  title: string;
  buckets?: number[];
}): TraceSpanHistogramSpec {
  const buckets = params.buckets ?? [1, 3, 2];
  return {
    id: params.id,
    title: params.title,
    ariaLabel: `${params.title} histogram`,
    buckets,
    lowerBoundMs: 0,
    upperBoundMs: 30,
    lowerBoundLabel: '0ms',
    upperBoundLabel: '30ms',
    totalCount: buckets.reduce((sum, bucket) => sum + bucket, 0),
    maxCount: buckets.reduce((maxCount, bucket) => Math.max(maxCount, bucket), 0),
    getDisplayValueMs: (valueMs: number) => valueMs,
    formatValueLabel: (valueMs: number) => `${valueMs}ms`
  };
}

function createGraphWithChildren(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const selected: TraceSpan = {
    type: 'trace-span',
    spanId: 'selected' as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: 'selected',
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

  const childLater: TraceSpan = {
    ...selected,
    spanId: 'child-later' as TraceSpanId,
    name: 'child-later',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 20,
        endTimeMs: 21,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    }
  };
  const childEarlier: TraceSpan = {
    ...selected,
    spanId: 'child-earlier' as TraceSpanId,
    name: 'child-earlier',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 10,
        endTimeMs: 11,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    }
  };
  const unrelated: TraceSpan = {
    ...selected,
    spanId: 'unrelated' as TraceSpanId,
    name: 'unrelated',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: 5,
        endTimeMs: 6,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    }
  };

  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-child-later' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: childLater.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-child-earlier' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: childEarlier.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-unrelated' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: unrelated.spanId,
      keywords: new Set(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];

  const spans = [selected, childLater, childEarlier, unrelated];
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'children-tab'})
  };
}

function buildChildBlock(params: {
  spanId: string | TraceSpanId;
  threadId: TraceThreadId;
  name?: string;
  startTimeMs: number;
  endTimeMs: number;
  processName?: string;
}): TraceSpan {
  return {
    type: 'trace-span',
    spanId: params.spanId as TraceSpanId,
    threadId: params.threadId,
    processName: params.processName ?? 'rank-1',
    name: params.name ?? String(params.spanId),
    keywords: [],
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs: params.startTimeMs,
        endTimeMs: params.endTimeMs,
        durationMs: params.endTimeMs - params.startTimeMs,
        durationMsAsString: `${params.endTimeMs - params.startTimeMs}ms`
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: []
  };
}

function createGraphWithRecursiveChildren(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const selected = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    name: 'selected',
    startTimeMs: 0,
    endTimeMs: 1
  });
  const childOne = buildChildBlock({
    spanId: 'child-one',
    threadId: thread.threadId,
    name: 'child-one',
    startTimeMs: 10,
    endTimeMs: 11
  });
  const childTwo = buildChildBlock({
    spanId: 'child-two',
    threadId: thread.threadId,
    name: 'child-two',
    startTimeMs: 15,
    endTimeMs: 16
  });
  const childThree = buildChildBlock({
    spanId: 'child-three',
    threadId: thread.threadId,
    name: 'child-three',
    startTimeMs: 20,
    endTimeMs: 21
  });
  const grandChildOneA = buildChildBlock({
    spanId: 'grandchild-one-a',
    threadId: thread.threadId,
    name: 'grandchild-one-a',
    startTimeMs: 11,
    endTimeMs: 12
  });
  const grandChildOneB = buildChildBlock({
    spanId: 'grandchild-one-b',
    threadId: thread.threadId,
    name: 'grandchild-one-b',
    startTimeMs: 13,
    endTimeMs: 14
  });
  const grandChildTwoA = buildChildBlock({
    spanId: 'grandchild-two-a',
    threadId: thread.threadId,
    name: 'grandchild-two-a',
    startTimeMs: 16,
    endTimeMs: 17
  });

  const spans = [
    selected,
    childOne,
    childTwo,
    childThree,
    grandChildOneA,
    grandChildOneB,
    grandChildTwoA
  ];
  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-child-one' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: childOne.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-child-two' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: childTwo.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-child-three' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: childThree.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-child-one-grand-one-a' as TraceDependencyId,
      startSpanId: childOne.spanId,
      endSpanId: grandChildOneA.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-child-one-grand-one-b' as TraceDependencyId,
      startSpanId: childOne.spanId,
      endSpanId: grandChildOneB.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-child-two-grand-two-a' as TraceDependencyId,
      startSpanId: childTwo.spanId,
      endSpanId: grandChildTwoA.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'recursive-children-tab'})
  };
}

function createGraphWithFilteredChildren(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const visibleRoot = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    name: 'selected',
    startTimeMs: 0,
    endTimeMs: 1
  });
  const filteredChild = buildChildBlock({
    spanId: 'filtered-child',
    threadId: thread.threadId,
    name: 'filtered-child',
    startTimeMs: 10,
    endTimeMs: 11
  });
  const visibleGrandchild = buildChildBlock({
    spanId: 'visible-grandchild',
    threadId: thread.threadId,
    name: 'visible-grandchild',
    startTimeMs: 12,
    endTimeMs: 13
  });

  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-filtered' as TraceDependencyId,
      startSpanId: visibleRoot.spanId,
      endSpanId: filteredChild.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-filtered-visible' as TraceDependencyId,
      startSpanId: filteredChild.spanId,
      endSpanId: visibleGrandchild.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];

  const spans = [visibleRoot, filteredChild, visibleGrandchild];
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: visibleRoot,
    traceGraph: buildJSONTrace([process], [], {name: 'filtered-children-tab'})
  };
}

function createGraphWithTopologyFilteredChildren(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const selected = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    name: 'selected',
    startTimeMs: 0,
    endTimeMs: 10
  });
  const topologyFilteredChild = buildChildBlock({
    spanId: 'topology-filtered-child',
    threadId: thread.threadId,
    name: 'topology-filtered-child',
    startTimeMs: 5,
    endTimeMs: 5
  });
  const visibleGrandchild = buildChildBlock({
    spanId: 'visible-grandchild',
    threadId: thread.threadId,
    name: 'visible-grandchild',
    startTimeMs: 6,
    endTimeMs: 7
  });

  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-topology-child' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: topologyFilteredChild.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-topology-child-grandchild' as TraceDependencyId,
      startSpanId: topologyFilteredChild.spanId,
      endSpanId: visibleGrandchild.spanId,
      keywords: new Set(['PARENT']),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];

  const spans = [selected, topologyFilteredChild, visibleGrandchild];
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'topology-filtered-children-tab'})
  };
}

function createGraphWithFilteredDependencySource(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const filteredDependencySource = buildChildBlock({
    spanId: 'filtered-dependency-source',
    threadId: thread.threadId,
    name: 'filtered-dependency-source',
    startTimeMs: 10,
    endTimeMs: 11
  });
  const selected = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    name: 'selected',
    startTimeMs: 12,
    endTimeMs: 13
  });

  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-filtered-selected' as TraceDependencyId,
      startSpanId: filteredDependencySource.spanId,
      endSpanId: selected.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];

  const spans = [filteredDependencySource, selected];
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'filtered-dependency-source'})
  };
}

function createGraphWithDirectionalDependencies(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };
  const incomingSource = buildChildBlock({
    spanId: 'incoming-source',
    threadId: thread.threadId,
    startTimeMs: 0,
    endTimeMs: 1
  });
  const selected = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    startTimeMs: 2,
    endTimeMs: 3
  });
  const outgoingTarget = buildChildBlock({
    spanId: 'outgoing-target',
    threadId: thread.threadId,
    startTimeMs: 4,
    endTimeMs: 5
  });
  const filteredOutgoingTarget = buildChildBlock({
    spanId: 'filtered-outgoing-target',
    threadId: thread.threadId,
    startTimeMs: 6,
    endTimeMs: 7
  });
  const localDependencies: TraceLocalDependency[] = [
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-incoming-selected' as TraceDependencyId,
      startSpanId: incomingSource.spanId,
      endSpanId: selected.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-outgoing' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: outgoingTarget.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    },
    {
      type: 'trace-local-dependency',
      dependencyId: 'dep-selected-filtered-outgoing' as TraceDependencyId,
      startSpanId: selected.spanId,
      endSpanId: filteredOutgoingTarget.spanId,
      keywords: new Set<string>(),
      waitMode: 'start-to-start',
      bidirectional: false,
      waitTimeMs: 0
    }
  ];
  const spans = [incomingSource, selected, outgoingTarget, filteredOutgoingTarget];
  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans,
    spanMap: Object.fromEntries(spans.map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'directional-dependencies'})
  };
}

function createGraphWithManyChildren(blockCount: number): {
  span: TraceSpan;
  traceGraph: JSONTrace;
} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };
  const selected = buildChildBlock({
    spanId: 'selected',
    threadId: thread.threadId,
    name: 'selected',
    startTimeMs: 0,
    endTimeMs: 1
  });
  const descendants = Array.from({length: blockCount}, (_, index) =>
    buildChildBlock({
      spanId: `descendant-${index + 1}`,
      threadId: thread.threadId,
      name: `descendant-${index + 1}`,
      startTimeMs: index + 1,
      endTimeMs: index + 2
    })
  );

  const localDependencies = descendants.map(
    descendant =>
      ({
        type: 'trace-local-dependency',
        dependencyId: `dep-selected-${descendant.spanId}` as TraceDependencyId,
        startSpanId: selected.spanId,
        endSpanId: descendant.spanId,
        keywords: new Set(['PARENT']),
        waitMode: 'start-to-start',
        bidirectional: false,
        waitTimeMs: 0
      }) satisfies TraceLocalDependency
  );

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [selected, ...descendants],
    spanMap: Object.fromEntries([selected, ...descendants].map(span => [span.spanId, span])),
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies,
    remoteDependencies: []
  };

  return {
    span: selected,
    traceGraph: buildJSONTrace([process], [], {name: 'many-children-tab'})
  };
}

function createLeafBlockGraph(
  startTimeMs = 0,
  userData?: Record<string, unknown>
): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const leaf: TraceSpan = {
    type: 'trace-span',
    spanId: 'leaf' as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: 'leaf',
    keywords: [],
    primaryTimingKey: 'default',
    timings: {
      default: {
        status: 'finished',
        startTimeMs,
        endTimeMs: startTimeMs + 1,
        durationMs: 1,
        durationMsAsString: '1ms'
      }
    },
    localDependencyIds: [],
    localDependencies: [],
    crossProcessEndpointId: null,
    crossProcessDependencyEndpoints: [],
    userData
  };

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
    rankNum: 0,
    stepNum: 0,
    threads: [thread],
    threadMap: {[thread.threadId]: thread},
    spans: [leaf],
    spanMap: {[leaf.spanId]: leaf},
    instants: [],
    instantMap: {},
    threadInstantMap: {},
    counters: [],
    counterMap: {},
    threadCounterMap: {},
    localDependencies: [],
    remoteDependencies: []
  };

  return {
    span: leaf,
    traceGraph: buildJSONTrace([process], [], {name: 'leaf'})
  };
}

function createGraphWithCrossProcessEndpoint(): {span: TraceSpan; traceGraph: JSONTrace} {
  const processId = 'rank-1';
  const thread: TraceThread = {
    type: 'trace-thread',
    name: 'thread-1',
    threadId: 'thread-1' as TraceThreadId,
    processId
  };

  const endpoint: TraceCrossProcessEndpoint = {
    type: 'cross-process-dependency-endpoint',
    endpointId: 'endpoint-1' as TraceCrossProcessEndpointId,
    spanId: 'selected-with-cross' as TraceSpanId,
    startRankNum: 0,
    endRankNum: 5,
    islandNum: 0,
    waitTimeMs: 12,
    waiting: false,
    waitNotFinished: false
  };

  const span: TraceSpan = {
    type: 'trace-span',
    spanId: 'selected-with-cross' as TraceSpanId,
    threadId: thread.threadId,
    processName: processId,
    name: 'selected-with-cross',
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
    crossProcessEndpointId: endpoint.endpointId,
    crossProcessDependencyEndpoints: [endpoint]
  };

  const process: TraceProcess = {
    type: 'trace-process',
    processId,
    name: processId,
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
    localDependencies: [],
    remoteDependencies: []
  };

  return {
    span,
    traceGraph: buildJSONTrace([process], [], {name: 'cross-process-endpoint'})
  };
}

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('TraceSpanCard', () => {
  it('shows the four nearest hover parents before the omitted parent summary', () => {
    const rendered = renderTraceSpanCard({parentCount: 7, interactive: false});

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-6',
      'parent-5',
      'parent-4',
      'omitted 3 parent spans'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'parent-1',
      'parent-2',
      'parent-3',
      'parent-4'
    ]);
  });

  it('shows the visible stitched parent chain in the popup when intermediate parents are filtered', () => {
    const rendered = renderTraceSpanCard({
      spanFilter: 'parent-2|parent-4|parent-6',
      interactive: false
    });
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-5',
      'parent-3',
      'parent-1'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'parent-1',
      'parent-3',
      'parent-5',
      'parent-7'
    ]);
  });

  it('shows a hidden-parent notice when the hover chain starts with filtered parents', () => {
    const rendered = renderTraceSpanCard({
      spanFilter: 'parent-6|parent-7',
      interactive: false
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'omitting 2 hidden parent spans',
      'parent-5',
      'parent-4',
      'parent-3',
      'parent-2',
      'parent-1'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'parent-3',
      'parent-4',
      'parent-5',
      'parent-6',
      'parent-7'
    ]);
  });

  it('shows filtered parents by default when intermediate parents are filtered', () => {
    const rendered = renderTraceSpanCard({
      parentCount: 7,
      spanFilter: 'parent-2|parent-4|parent-6',
      interactive: true
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-6',
      'parent-5',
      'parent-4',
      'parent-3',
      'parent-2',
      'parent-1'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'parent-1',
      'parent-2',
      'parent-3',
      'parent-4',
      'parent-5',
      'parent-6',
      'parent-7'
    ]);
    expect(rendered.textContent).not.toContain('...omitted');
  });

  it('keeps topology-filtered parents visible by default with topology outlines', () => {
    const rendered = renderTraceSpanCard({
      parentCount: 3,
      interactive: true,
      similarDurationChainSpanFilter: {maxRelativeDurationDelta: 0}
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['parent-3', 'parent-2', 'parent-1']);
    expect(getTopologyFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['parent-3', 'parent-2', 'parent-1'])
    );

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual([]);
  });

  it('does not apply local dependency render filters to inspector parent rows', () => {
    const rendered = renderTraceSpanCard({
      parentCount: 1,
      interactive: true,
      localDependencyMode: 'warnings'
    });

    expect(getDependencyTableSpanTexts(rendered)).toContain('parent-1');
    expect(getDependencyTableModeTexts(rendered)).toEqual(['parent-1']);
  });

  it('shows filtered parents by default and hides them when Visible Spans is selected', async () => {
    const rendered = renderTraceSpanCard({
      parentCount: 7,
      spanFilter: 'parent-2|parent-4|parent-6',
      interactive: true
    });

    expect(getSelectValue(rendered, 'Span visibility')).toBe('all');
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-6',
      'parent-5',
      'parent-4',
      'parent-3',
      'parent-2',
      'parent-1'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'parent-1',
      'parent-2',
      'parent-3',
      'parent-4',
      'parent-5',
      'parent-6',
      'parent-7'
    ]);
    expect(getFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['parent-2', 'parent-4', 'parent-6'])
    );
    expect(rendered.textContent).not.toContain('...omitted');

    changeSelectValue(rendered, 'Span visibility', 'visible');
    await Promise.resolve();

    expect(getSelectValue(rendered, 'Span visibility')).toBe('visible');
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-5',
      'parent-3',
      'parent-1'
    ]);
  });

  it('double-clicks filtered parent badges while filtered spans are shown by default', async () => {
    const source = createParentChainGraph(7);
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(source.traceGraph), {
      spanFilters: ['parent-2', 'parent-4', 'parent-6']
    });
    const onSpanDoubleClick = vi.fn();
    const rendered = renderTraceSpanCard({
      traceGraph: source.traceGraph,
      span: source.span,
      spanFilter: 'parent-2|parent-4|parent-6',
      interactive: true,
      onSpanDoubleClick
    });

    await Promise.resolve();
    doubleClickButton(rendered, 'parent-6');

    expect(onSpanDoubleClick).toHaveBeenCalledWith(
      getRequiredSpanRefBySpanId(traceGraph, 'parent-6' as TraceSpanId),
      'select'
    );
  });

  it('does not render hidden-span controls when the card is non-interactive', () => {
    const rendered = renderTraceSpanCard({
      parentCount: 7,
      spanFilter: 'parent-2|parent-4|parent-6',
      interactive: false
    });

    expect(rendered.querySelector('[aria-label="Span visibility"]')).toBeNull();
  });

  it('uses the standard default tab-body height for interactive tabs', () => {
    const rendered = renderTraceSpanCard({interactive: true});

    expect(getTraceSpanCardTabBody(rendered).style.height).toBe(
      `${TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX}px`
    );
  });

  it('applies a caller-provided tab-body height override', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      tabBodyHeightPx: 180
    });

    expect(getTraceSpanCardTabBody(rendered).style.height).toBe('180px');
  });

  it('renders caller-provided custom tabs in interactive mode', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      customTabs: [
        {
          id: 'constituents',
          label: 'Constituents',
          content: <div>Stub constituent rows</div>
        }
      ]
    });

    clickButton(rendered, 'Constituents');
    expect(rendered.textContent).toContain('Stub constituent rows');
  });

  it('inserts caller-provided custom tabs before a requested tab id', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      dependencyTabLabel: 'Parents',
      alwaysShowAllInteractiveTabs: true,
      showChildrenTab: true,
      customTabs: [
        {
          id: 'constituents',
          label: 'Constituents',
          insertBeforeTabId: 'histogram',
          content: <div>Stub constituent rows</div>
        }
      ]
    });

    const tabLabels = [...rendered.querySelectorAll('[role="tab"]')].map(tab =>
      tab.textContent?.trim()
    );
    expect(tabLabels).toEqual([
      'Parents',
      'Children',
      'Constituents',
      'Histogram',
      'Timings',
      'Span Data'
    ]);
  });

  it('does not render the histogram picker when the histogram tab is non-interactive', () => {
    const rendered = renderTraceSpanHistogramsTab({
      interactive: false
    });

    expect(rendered.querySelector('[aria-label="Histogram metric"]')).toBeNull();
    expect(rendered.textContent).not.toContain('Linear Scale');
    expect(rendered.textContent).not.toContain('Log Scale');
  });

  it('toggles logarithmic histogram scaling in interactive mode', () => {
    const rendered = renderTraceSpanHistogramsTab({
      histograms: [
        createTraceSpanHistogramSpec({
          id: 'duration',
          title: 'Duration',
          buckets: [1, 10_000]
        })
      ],
      interactive: true
    });
    const toggle = [...rendered.querySelectorAll('button')].find(
      button => button.textContent?.trim() === 'Linear Scale'
    );
    if (!(toggle instanceof HTMLButtonElement)) {
      throw new Error('Missing histogram scale toggle');
    }

    const linearHeights = getHistogramBarHeights(rendered, 'Duration histogram');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    flushSync(() => {
      toggle.click();
    });

    const logHeights = getHistogramBarHeights(rendered, 'Duration histogram');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent?.trim()).toBe('Log Scale');
    expect(logHeights[0]).toBeGreaterThan(linearHeights[0] ?? 0);
    expect(logHeights[1]).toBe(linearHeights[1]);
  });

  it('shows recursive visible descendants in tree order with child indentation depth', () => {
    const {span, traceGraph} = createGraphWithRecursiveChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true
    });

    clickButton(rendered, 'Children');
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'child-one',
      'grandchild-one-a',
      'grandchild-one-b',
      'child-two',
      'grandchild-two-a',
      'child-three'
    ]);
    expect(getDependencyTableModeTexts(rendered)).toEqual([
      'start-to-start',
      'start-to-start',
      'start-to-start',
      'start-to-start',
      'start-to-start',
      'start-to-start'
    ]);
    expect(getChildDepths(rendered)).toEqual(['1', '2', '2', '1', '2', '1']);
  });

  it('shows filtered descendants by default and can hide them', () => {
    const {span, traceGraph} = createGraphWithFilteredChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true,
      spanFilter: 'filtered-child'
    });

    clickButton(rendered, 'Children');
    expect(getDependencyTableSpanTexts(rendered)).toEqual(['filtered-child', 'visible-grandchild']);
    expect(getChildDepths(rendered)).toEqual(['1', '2']);
    expect(getFilteredBadgeTexts(rendered)).toEqual(expect.arrayContaining(['filtered-child']));

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['visible-grandchild']);
    expect(getChildDepths(rendered)).toEqual(['2']);
  });

  it('double-clicks filtered child badges while filtered spans are shown by default', () => {
    const {span, traceGraph: sourceTraceGraph} = createGraphWithFilteredChildren();
    const traceGraph = createTestTraceGraph(buildTraceGraphDataFromJSONTrace(sourceTraceGraph), {
      spanFilters: ['filtered-child']
    });
    const onSpanDoubleClick = vi.fn();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph: sourceTraceGraph,
      showChildrenTab: true,
      spanFilter: 'filtered-child',
      onSpanDoubleClick
    });

    clickButton(rendered, 'Children');
    doubleClickButton(rendered, 'filtered-child');

    expect(onSpanDoubleClick).toHaveBeenCalledWith(
      getRequiredSpanRefBySpanId(traceGraph, 'filtered-child' as TraceSpanId),
      'select'
    );
  });

  it('keeps topology-filtered descendants visible by default with topology outlines', () => {
    const {span, traceGraph} = createGraphWithTopologyFilteredChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true,
      overlappingParentSpanFilter: {maxChildDurationMs: 1}
    });

    clickButton(rendered, 'Children');

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'topology-filtered-child',
      'visible-grandchild'
    ]);
    expect(getTopologyFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['topology-filtered-child'])
    );

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['visible-grandchild']);
  });

  it('outlines filtered direct dependency sources while filtered spans are shown by default', () => {
    const {span, traceGraph} = createGraphWithFilteredDependencySource();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      spanFilter: 'filtered-dependency-source'
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['filtered-dependency-source']);
    expect(getFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['filtered-dependency-source'])
    );

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual([]);
  });

  it('renders outgoing dependency rows with dependent blocks', () => {
    const {span, traceGraph} = createGraphWithDirectionalDependencies();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showOutgoingDependenciesTab: true,
      outgoingDependencyTabLabel: 'Outgoing'
    });

    clickButton(rendered, 'Outgoing');

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'outgoing-target',
      'filtered-outgoing-target'
    ]);
    expect(getDependencyTableSpanTexts(rendered)).not.toContain('incoming-source');
    expect(getDependencyTableSpanTexts(rendered)).not.toContain('selected');
  });

  it('shows hidden outgoing dependency targets by default and can hide them', () => {
    const {span, traceGraph} = createGraphWithDirectionalDependencies();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      spanFilter: 'filtered-outgoing-target',
      showOutgoingDependenciesTab: true,
      outgoingDependencyTabLabel: 'Outgoing'
    });

    clickButton(rendered, 'Outgoing');
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'outgoing-target',
      'filtered-outgoing-target'
    ]);
    expect(getFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['filtered-outgoing-target'])
    );

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['outgoing-target']);
  });

  it('renders a truncation notice when recursive child traversal exceeds the limit', () => {
    const {span, traceGraph} = createGraphWithManyChildren(1001);
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true
    });

    clickButton(rendered, 'Children');
    expect(rendered.textContent).toContain('Showing first 1000 descendants; 1 more omitted');
  }, 30000);

  it('shows the children tab even when no child dependencies are visible', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 0,
      showChildrenTab: true
    });

    clickButton(rendered, 'Children');
    expect(rendered.textContent).toContain('Span has no children');
  });

  it('keeps the dependencies tab visible for leaf spans with no dependencies', () => {
    const {span, traceGraph} = createLeafBlockGraph();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true
    });

    expect(rendered.textContent).toContain('Dependencies');
    expect(rendered.textContent).toContain('Children');
    expect(rendered.textContent).toContain('Span has no parents');
  });

  it('formats the selected span start timestamp with the trace timezone', () => {
    const startTimeMs = Date.parse('2026-05-20T15:20:18.477Z');
    const {span, traceGraph} = createLeafBlockGraph(startTimeMs);
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      timezone: 'America/Los_Angeles'
    });

    expect(rendered.textContent).toContain('8:20:18.477 AM, May 20, 2026 PDT');
    expect(rendered.textContent).not.toContain('3:20:18.477 PM, May 20, 2026 UTC');
    expect(rendered.textContent).toContain('start 0s');
    expect(rendered.textContent).not.toContain('start @');
    const relativeStart = [...rendered.querySelectorAll('b')].find(
      element => element.textContent === '0s'
    );
    expect(relativeStart?.className).toContain('text-foreground');
  });

  it('renders the selected span source in the header', () => {
    const {span, traceGraph} = createLeafBlockGraph(0, {source: 'worker-trace.json'});
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph
    });

    expect(rendered.textContent).toContain('SOURCE worker-trace.json');
  });

  it('outlines the selected span header badge when the span is filtered', () => {
    const {span, traceGraph} = createLeafBlockGraph();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      spanFilter: 'leaf'
    });

    expect(getFilteredBadgeTexts(rendered)).toEqual(expect.arrayContaining(['leaf']));
  });

  it('outlines source-filtered header badges for plain and aggregated spans', () => {
    for (const testCase of [
      {
        expectedTitle: 'SPAN',
        userData: {
          source: 'projects/runtime/runtime-crates/runtime-core/src/worker.rs'
        }
      },
      {
        expectedTitle: 'AGGREGATED SPAN',
        userData: {
          aggregates: {participants: 1},
          source: 'projects/runtime/runtime-crates/runtime-core/src/worker.rs'
        }
      }
    ] as const) {
      const {span, traceGraph} = createLeafBlockGraph(0, testCase.userData);
      const rendered = renderTraceSpanCard({
        interactive: true,
        span,
        traceGraph,
        spanFilter: 'projects/runtime/runtime-crates'
      });

      expect(rendered.textContent).toContain(testCase.expectedTitle);
      expect(getFilteredBadgeTexts(rendered)).toEqual(expect.arrayContaining(['leaf']));
      root?.unmount();
      root = null;
      container?.remove();
      container = null;
    }
  });

  it('supports overriding the dependency tab label', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 1,
      dependencyTabLabel: 'Parents'
    });

    expect(getDependencyTableModeTexts(rendered)).toEqual(['parent-1']);
    expect(rendered.textContent).not.toContain('Dependencies');
  });

  it('shows span durations instead of wait times in duration dependency tabs', () => {
    const baseGraph = createParentChainGraph(2);
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const updatedBlocks = process.spans.map(candidate => {
      if (candidate.spanId === ('parent-1' as TraceSpanId)) {
        return {
          ...candidate,
          timings: {
            ...candidate.timings,
            envelope: createFinishedTiming(0, 5),
            p50: createFinishedTiming(0, 3)
          }
        };
      }
      if (candidate.spanId === ('parent-2' as TraceSpanId)) {
        return {
          ...candidate,
          timings: {
            ...candidate.timings,
            envelope: createFinishedTiming(0, 7),
            p50: createFinishedTiming(0, 4)
          }
        };
      }
      if (candidate.spanId === baseGraph.span.spanId) {
        return {
          ...candidate,
          timings: {
            ...candidate.timings,
            envelope: createFinishedTiming(0, 9),
            p50: createFinishedTiming(0, 6)
          }
        };
      }
      return candidate;
    });
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans: updatedBlocks,
          spanMap: Object.fromEntries(updatedBlocks.map(candidate => [candidate.spanId, candidate]))
        }
      ],
      [],
      {name: 'duration-parent-durations'}
    );

    const rendered = renderTraceSpanCard({
      interactive: true,
      span: materializeJSONTrace(traceGraph).spanMap[baseGraph.span.spanId]!,
      traceGraph,
      dependencyTabLabel: 'Parents',
      showChildrenTab: true,
      dependencyMetric: 'duration',
      traceRunSummaryAggregationKey: 'envelope'
    });

    expect(getSelectValue(rendered, 'First duration metric')).toBe('envelope');
    expect(getSelectValue(rendered, 'Second duration metric')).toBe('p50');
    expect(rendered.textContent).not.toContain('Wait');
    const firstDurationMetricSelect = rendered.querySelector(
      'select[aria-label="First duration metric"]'
    );
    if (!(firstDurationMetricSelect instanceof HTMLSelectElement)) {
      throw new Error('Missing first duration metric select');
    }
    expect([...firstDurationMetricSelect.options].map(option => option.textContent)).toEqual(
      expect.arrayContaining(['envelope', 'p50'])
    );
    expect(firstDurationMetricSelect.closest('th')?.className).toContain('w-20');
    expect(firstDurationMetricSelect.closest('th')?.className).toContain('max-w-20');
    expect(getDependencyTableSelectColumnTexts(rendered, 'First duration metric')).toEqual([
      '7ms',
      '5ms'
    ]);
    expect(getDependencyTableSelectColumnTexts(rendered, 'Second duration metric')).toEqual([
      '4ms',
      '3ms'
    ]);

    changeSelectValue(rendered, 'Second duration metric', 'envelope');

    expect(getSelectValue(rendered, 'Second duration metric')).toBe('envelope');
  });

  it('keeps wait-mode dependency tables on one Wait column', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 1,
      dependencyTabLabel: 'Parents'
    });

    expect(rendered.textContent).toContain('Wait');
    expect(rendered.textContent).not.toContain('First duration metric');
    expect(getDependencyTableMetricTexts(rendered)).toEqual(['-']);
  });

  it('shows selected timing duration columns in duration child tabs', () => {
    const baseGraph = createGraphWithChildren();
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const updatedBlocks = process.spans.map(candidate => {
      const durationBySpanId: Partial<Record<TraceSpanId, {envelope: number; p50: number}>> = {
        [baseGraph.span.spanId]: {envelope: 6, p50: 3},
        ['child-earlier' as TraceSpanId]: {envelope: 4, p50: 2},
        ['child-later' as TraceSpanId]: {envelope: 5, p50: 3}
      };
      const durations = durationBySpanId[candidate.spanId];
      if (!durations) {
        return candidate;
      }

      return {
        ...candidate,
        timings: {
          ...candidate.timings,
          envelope: createFinishedTiming(0, durations.envelope),
          p50: createFinishedTiming(0, durations.p50)
        }
      };
    });
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans: updatedBlocks,
          spanMap: Object.fromEntries(updatedBlocks.map(candidate => [candidate.spanId, candidate]))
        }
      ],
      [],
      {name: 'duration-child-durations'}
    );

    const rendered = renderTraceSpanCard({
      interactive: true,
      span: materializeJSONTrace(traceGraph).spanMap[baseGraph.span.spanId]!,
      traceGraph,
      dependencyTabLabel: 'Parents',
      showChildrenTab: true,
      dependencyMetric: 'duration',
      traceRunSummaryAggregationKey: 'envelope'
    });

    clickButton(rendered, 'Children');

    expect(getSelectValue(rendered, 'First duration metric')).toBe('envelope');
    expect(getSelectValue(rendered, 'Second duration metric')).toBe('p50');
    expect(getDependencyTableSelectColumnTexts(rendered, 'First duration metric')).toEqual([
      '4ms',
      '5ms'
    ]);
    expect(getDependencyTableSelectColumnTexts(rendered, 'Second duration metric')).toEqual([
      '2ms',
      '3ms'
    ]);
  });

  it('splits all and visible parents with a filtered-spans toggle', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 7,
      spanFilter: 'parent-2|parent-4|parent-6',
      dependencyTabLabel: 'Parents',
      showChildrenTab: true,
      dependencyMetric: 'duration'
    });

    expect(rendered.textContent).toContain('Parents');
    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-6',
      'parent-5',
      'parent-4',
      'parent-3',
      'parent-2',
      'parent-1'
    ]);

    changeSelectValue(rendered, 'Span visibility', 'visible');

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-5',
      'parent-3',
      'parent-1'
    ]);
  });

  it('hides the combined All tab in interactive mode', () => {
    const {span, traceGraph} = createGraphWithChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      dependencyTabLabel: 'Parents',
      showChildrenTab: true
    });

    expect(rendered.textContent).not.toContain('All');
    expect(rendered.textContent).toContain('Parents');
    expect(rendered.textContent).toContain('Children');

    clickButton(rendered, 'Children');

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['child-earlier', 'child-later']);
  });

  it('keeps the remaining duration tabs visible and shows empty states when data is unavailable', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 1,
      dependencyTabLabel: 'Parents',
      showChildrenTab: true,
      dependencyMetric: 'duration'
    });
    clickButton(rendered, 'Children');

    expect(rendered.textContent).toContain('Parents');
    expect(rendered.textContent).toContain('Children');
    expect(rendered.textContent).toContain('has no children');
    expect(rendered.textContent).not.toContain('All');
    expect(rendered.textContent).not.toContain('Timings');
    expect(rendered.textContent).not.toContain('Histogram');
    expect(rendered.textContent).toContain('Span Data');
  });

  it('shows aggregated duration and completion histograms in the histogram tab', () => {
    const baseGraph = createParentChainGraph(1);
    const absoluteTraceStartMs = 1_772_779_900_000;
    const span: TraceSpan = {
      ...baseGraph.span,
      timings: {
        default: {
          status: 'finished',
          startTimeMs: absoluteTraceStartMs + 1,
          endTimeMs: absoluteTraceStartMs + 2,
          durationMs: 1,
          durationMsAsString: '1ms'
        },
        envelope: {
          status: 'finished',
          startTimeMs: absoluteTraceStartMs + 1,
          endTimeMs: absoluteTraceStartMs + 147,
          durationMs: 146,
          durationMsAsString: '146ms'
        },
        p50: {
          status: 'finished',
          startTimeMs: absoluteTraceStartMs + 5,
          endTimeMs: absoluteTraceStartMs + 11,
          durationMs: 6,
          durationMsAsString: '6ms'
        },
        latest: {
          status: 'finished',
          startTimeMs: absoluteTraceStartMs + 5,
          endTimeMs: absoluteTraceStartMs + 11,
          durationMs: 6,
          durationMsAsString: '6ms'
        }
      },
      userData: {
        spanKind: 'logical',
        aggregates: {
          participants: 2,
          variance: 9_234_828_120_996,
          duration_cv: 0.03750800268626125,
          duration_distribution_us: {
            lower_bound: 77_373_006,
            upper_bound: 84_666_334,
            buckets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]
          },
          completion_distribution_us: {
            lower_bound: 1_772_779_910_648_178,
            upper_bound: 1_772_779_917_941_570,
            buckets: [1, 0, 0, 0, 0, 0, 0, 0, 0, 1]
          }
        }
      }
    };
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const absoluteBlocks = process.spans.map((candidate, index) => ({
      ...candidate,
      timings: {
        default: {
          status: 'finished' as const,
          startTimeMs: absoluteTraceStartMs + index,
          endTimeMs: absoluteTraceStartMs + index + 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        }
      }
    }));
    const absoluteBlockMap = Object.fromEntries(
      absoluteBlocks.map(candidate => [candidate.spanId, candidate])
    );
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans: absoluteBlocks.map(candidate =>
            candidate.spanId === span.spanId ? span : candidate
          ),
          spanMap: {
            ...absoluteBlockMap,
            [span.spanId]: span
          }
        }
      ],
      [],
      {name: 'histogram-tab'}
    );

    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      traceRunSummaryAggregationKey: 'latest',
      timezone: 'America/Los_Angeles'
    });

    expect(rendered.textContent).toContain('Histogram');
    expect(rendered.textContent).toContain('Timings');
    expect(rendered.textContent).toContain('AGGREGATED SPAN');
    expect(rendered.textContent).toContain('(2 source spans)');
    expect(rendered.textContent).toContain('PROCESS');
    expect(rendered.textContent).not.toContain('AGGREGATED PROCESS');
    expect(rendered.textContent).toContain('Envelope duration:');
    expect(rendered.textContent).toContain('P50 duration:');
    expect(rendered.textContent).not.toContain('Duration:');
    expect(rendered.textContent).toContain('Start Time:');
    expect(rendered.textContent).toContain('146ms');
    expect(rendered.textContent).toContain('6ms');
    expect(rendered.textContent).toContain('5ms');
    expect(rendered.textContent).toContain('latest');
    expect(rendered.textContent).toContain('PST');

    clickButton(rendered, 'Histogram');

    expect(rendered.textContent).toContain('Duration');
    expect(rendered.textContent).toContain('2 Processes');
    expect(rendered.textContent).toContain('1m17s');
    expect(rendered.textContent).toContain('1m19s');
    expect(rendered.textContent).toContain('1m21s');
    expect(rendered.textContent).toContain('1m22s');
    expect(rendered.textContent).toContain('1m24s');
    expect(rendered.querySelector('svg[aria-label="Duration histogram"]')).toBeTruthy();
    expect(rendered.textContent).not.toContain('2 samples');
    expect(
      [...rendered.querySelectorAll('title')].some(element =>
        element.textContent?.includes('1 process')
      )
    ).toBe(true);

    changeSelectValue(rendered, 'Histogram metric', 'completion');

    expect(rendered.textContent).toContain('Completion');
    expect(rendered.textContent).toContain('10.648s');
    expect(rendered.textContent).toContain('12.472s');
    expect(rendered.textContent).toContain('14.295s');
    expect(rendered.textContent).toContain('16.118s');
    expect(rendered.textContent).toContain('17.942s');
    expect(rendered.querySelector('svg[aria-label="Completion histogram"]')).toBeTruthy();
    expect(rendered.querySelector('svg[aria-label="Duration histogram"]')).toBeFalsy();
  });

  it('shows a hover tooltip and rounded count ticks for histogram bars', () => {
    const baseGraph = createParentChainGraph(1);
    const span: TraceSpan = {
      ...baseGraph.span,
      userData: {
        aggregates: {
          participants: 7_104,
          duration_distribution_us: {
            lower_bound: 75_600_000,
            upper_bound: 84_600_000,
            buckets: [400, 6_616, 20, 10, 8, 6, 4, 2, 1, 1]
          }
        }
      }
    };
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans: process.spans.map(candidate =>
            candidate.spanId === span.spanId ? span : candidate
          ),
          spanMap: {
            ...process.spanMap,
            [span.spanId]: span
          }
        }
      ],
      [],
      {name: 'histogram-tooltip'}
    );

    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      alwaysShowAllInteractiveTabs: true
    });

    clickButton(rendered, 'Histogram');

    expect(getHistogramCountTickTexts(rendered)).toEqual(['8,000', '6,000', '4,000', '2,000', '0']);

    hoverHistogramBar(rendered, 'Duration histogram', 1);

    expect(rendered.textContent).toContain('6,616 processes');
    expect(rendered.querySelector('[role="tooltip"]')?.textContent).toContain('1m16s - 1m17s');
  });

  it('keeps tiny histogram bins inspectable through full-height hitboxes', () => {
    const rendered = renderTraceSpanHistogramsTab({
      histograms: [
        createTraceSpanHistogramSpec({
          id: 'duration',
          title: 'Duration',
          buckets: [10_000, 0, 0, 0, 1]
        })
      ],
      interactive: true
    });
    const svg = rendered.querySelector('svg[aria-label="Duration histogram"]');

    expect(svg?.querySelectorAll('rect[data-histogram-hitbox="true"]')).toHaveLength(5);
    expect(svg?.querySelectorAll('rect[data-histogram-bar="true"]')).toHaveLength(5);

    hoverHistogramBar(rendered, 'Duration histogram', 4);

    expect(rendered.querySelector('[role="tooltip"]')?.textContent).toContain('1 process');
    expect(rendered.querySelector('[role="tooltip"]')?.textContent).toContain('24ms - 30ms');
  });

  it('only shows stored span userData rows in the span data tab', () => {
    const baseGraph = createParentChainGraph(1);
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const spans = process.spans.map(span =>
      span.spanId === baseGraph.span.spanId
        ? {
            ...span,
            userData: {
              stored_field: 'stored-value'
            }
          }
        : span
    );
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans,
          spanMap: Object.fromEntries(spans.map(span => [span.spanId, span]))
        }
      ],
      [],
      {name: 'stored-span-user-data'}
    );
    const span = materializeJSONTrace(traceGraph).spanMap[baseGraph.span.spanId]!;
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph
    });

    expect(rendered.textContent).toContain('Span Data');

    clickButton(rendered, 'Span Data');

    expect(rendered.textContent).toContain('stored_field');
    expect(rendered.textContent).toContain('stored-value');
  });

  it('shows dependency and span-data tabs when both are available', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 1
    });

    expect(rendered.textContent).toContain('Dependencies');
    expect(rendered.textContent).toContain('Span Data');
    expect(getDependencyTableModeTexts(rendered)).toEqual(['parent-1']);
  });

  it('marks the selected interactive tab for styling', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      parentCount: 1
    });

    let dependenciesTab = [...rendered.querySelectorAll('button')].find(
      candidate => candidate.textContent?.trim() === 'Dependencies'
    );
    let spanDataTab = [...rendered.querySelectorAll('button')].find(
      candidate => candidate.textContent?.trim() === 'Span Data'
    );

    expect(dependenciesTab?.getAttribute('data-state')).toBe('active');
    expect(dependenciesTab?.getAttribute('aria-selected')).toBe('true');
    expect(dependenciesTab?.className).toContain('bg-background');
    expect(spanDataTab?.getAttribute('data-state')).toBe('inactive');
    expect(spanDataTab?.getAttribute('aria-selected')).toBe('false');

    clickButton(rendered, 'Span Data');

    dependenciesTab = [...rendered.querySelectorAll('button')].find(
      candidate => candidate.textContent?.trim() === 'Dependencies'
    );
    spanDataTab = [...rendered.querySelectorAll('button')].find(
      candidate => candidate.textContent?.trim() === 'Span Data'
    );

    expect(dependenciesTab?.getAttribute('data-state')).toBe('inactive');
    expect(dependenciesTab?.getAttribute('aria-selected')).toBe('false');
    expect(spanDataTab?.getAttribute('data-state')).toBe('active');
    expect(spanDataTab?.getAttribute('aria-selected')).toBe('true');
    expect(spanDataTab?.className).toContain('bg-background');
  });

  it('does not show the children tab by default', () => {
    const {span, traceGraph} = createGraphWithChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph
    });

    expect(rendered.textContent).not.toContain('Children');
  });

  it('keeps the selected tab stable when navigating to a new span', () => {
    const initial = createGraphWithChildren();
    const storageKey = 'trace-span-card:selected-tab:stable';
    const rendered = renderTraceSpanCard({
      interactive: true,
      span: initial.span,
      traceGraph: initial.traceGraph,
      showChildrenTab: true,
      selectedTabStorageKey: storageKey
    });

    clickButton(rendered, 'Children');
    expect(getDependencyTableSpanTexts(rendered)).toEqual(['child-earlier', 'child-later']);

    const next = createLeafBlockGraph();
    rerenderTraceSpanCard({
      interactive: true,
      span: next.span,
      traceGraph: next.traceGraph,
      showChildrenTab: true,
      selectedTabStorageKey: storageKey
    });

    expect(rendered.textContent).toContain('Span has no children');
    expect(rendered.textContent).not.toContain('has no parents');
  });

  it('restores the selected interactive tab from local storage when it is still available', () => {
    const storageKey = 'trace-span-card:selected-tab:test-view';
    window.localStorage.setItem(storageKey, 'children');

    const {span, traceGraph} = createGraphWithChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true,
      selectedTabStorageKey: storageKey
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual(['child-earlier', 'child-later']);
    expect(rendered.textContent).not.toContain('has no parents');
  });

  it('restores and reports a caller-selected interactive tab', () => {
    const onSelectedTabChange = vi.fn();
    const {span, traceGraph} = createGraphWithChildren();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showChildrenTab: true,
      selectedTab: 'children',
      onSelectedTabChange
    });

    expect(rendered.textContent).toContain('child-earlier');
    expect(rendered.textContent).toContain('child-later');
    expect(onSelectedTabChange).toHaveBeenCalledWith('children');

    clickButton(rendered, 'Dependencies');

    expect(onSelectedTabChange).toHaveBeenLastCalledWith('dependencies');
  });

  it('normalizes legacy dependencies-all tab selection to dependencies with hidden rows enabled', () => {
    const storageKey = 'trace-span-card:selected-tab:legacy';
    window.localStorage.setItem(storageKey, 'dependencies-all');

    const {span, traceGraph} = createParentChainGraph(7);
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      spanFilter: 'parent-2|parent-4|parent-6',
      showChildrenTab: true,
      selectedTabStorageKey: storageKey
    });

    expect(getDependencyTableSpanTexts(rendered)).toEqual([
      'parent-7',
      'parent-6',
      'parent-5',
      'parent-4',
      'parent-3',
      'parent-2',
      'parent-1'
    ]);
    expect(getFilteredBadgeTexts(rendered)).toEqual(
      expect.arrayContaining(['parent-2', 'parent-4', 'parent-6'])
    );
  });

  it('hides cross-process dependency summaries when disabled', () => {
    const {span, traceGraph} = createGraphWithCrossProcessEndpoint();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph,
      showCrossProcessDependencies: false
    });

    expect(rendered.textContent).not.toContain('Cross Process');
    expect(rendered.textContent).not.toContain('12ms');
  });

  it('renders cross-rank details as an interactive tab', () => {
    const {span, traceGraph} = createGraphWithCrossProcessEndpoint();
    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph
    });

    expect(rendered.textContent).toContain('Cross Rank');
    expect(rendered.textContent).not.toContain('12ms');

    clickButton(rendered, 'Cross Rank');

    expect(rendered.textContent).toContain('Cross Process');
    expect(rendered.textContent).toContain('12ms');
  });

  it('keeps cross-rank details outside tabs in non-interactive hover cards', () => {
    const {span, traceGraph} = createGraphWithCrossProcessEndpoint();
    const rendered = renderTraceSpanCard({
      interactive: false,
      span,
      traceGraph
    });

    expect(rendered.textContent).not.toContain('Cross Rank');
    expect(rendered.textContent).toContain('Cross Process');
    expect(rendered.textContent).toContain('12ms');
  });

  it('renders caller-provided traversal controls in a Traversal tab', () => {
    const rendered = renderTraceSpanCard({
      interactive: true,
      traversalContent: <div>start traversal controls</div>
    });

    expect(rendered.textContent).toContain('Traversal');
    expect(rendered.textContent).not.toContain('start traversal controls');

    clickButton(rendered, 'Traversal');

    expect(rendered.textContent).toContain('start traversal controls');
  });

  it('renders the interactive timings tab without a count label', () => {
    const baseGraph = createParentChainGraph(1);
    const span: TraceSpan = {
      ...baseGraph.span,
      timings: {
        default: {
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 1,
          durationMs: 1,
          durationMsAsString: '1ms'
        },
        kernel: {
          status: 'finished',
          startTimeMs: 0,
          endTimeMs: 2,
          durationMs: 2,
          durationMsAsString: '2ms'
        }
      }
    };
    const process = materializeJSONTrace(baseGraph.traceGraph).processes[0]!;
    const traceGraph = buildJSONTrace(
      [
        {
          ...process,
          spans: process.spans.map(candidate =>
            candidate.spanId === span.spanId ? span : candidate
          ),
          spanMap: {
            ...process.spanMap,
            [span.spanId]: span
          }
        }
      ],
      [],
      {name: 'timings-label'}
    );

    const rendered = renderTraceSpanCard({
      interactive: true,
      span,
      traceGraph
    });

    expect(rendered.textContent).not.toContain('Timings (');
    expect(rendered.textContent).toContain('Timings');

    clickButton(rendered, 'Timings');

    expect(rendered.textContent).toContain('default');
    expect(rendered.textContent).toContain('kernel');
  });
});

/** Build one finished timing fixture with a compact duration label. */
function createFinishedTiming(
  startTimeMs: number,
  endTimeMs: number
): TraceSpan['timings'][string] {
  const durationMs = endTimeMs - startTimeMs;
  return {
    status: 'finished',
    startTimeMs,
    endTimeMs,
    durationMs,
    durationMsAsString: `${durationMs}ms`
  };
}
