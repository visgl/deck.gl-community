import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_TRACE_STYLE,
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from '../../../../../trace/index';
import {resolveTraceSpanCardLabels} from '../trace-span-card-helpers';
import {TraceSpanDependenciesTab} from './trace-span-card-tab-dependencies';

import type {
  SpanRef,
  TraceCardSpan,
  TraceDependencyId,
  TraceLocalDependency,
  TraceSpanCardDependencyEntry,
  TraceSpanCardParentChainEntry,
  TraceSpanId,
  TraceThreadId
} from '../../../../../trace/index';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceSpanDependenciesTab', () => {
  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('keeps unfiltered dependency and parent badges clickable for layout-hidden spans', () => {
    const currentSpan = createSpan(1, 'current');
    const dependencySpan = createSpan(2, 'layout-hidden-dependency');
    const parentSpan = createSpan(3, 'layout-hidden-parent');
    const onSpanClick = vi.fn();
    const onSpanDoubleClick = vi.fn();

    renderDependenciesTab({
      currentSpan,
      dependencies: [createDependencyEntry(dependencySpan, currentSpan)],
      parentChain: [createParentEntry(parentSpan)],
      onSpanClick,
      onSpanDoubleClick
    });

    clickBadge('layout-hidden-dependency');
    doubleClickBadge('layout-hidden-parent');

    expect(onSpanClick).toHaveBeenCalledWith(dependencySpan.spanRef);
    expect(onSpanDoubleClick).toHaveBeenCalledWith(parentSpan.spanRef, 'select');
  });

  it('passes select-and-focus for shift double-clicked dependency badges', () => {
    const currentSpan = createSpan(1, 'current');
    const dependencySpan = createSpan(2, 'dependency');
    const onSpanDoubleClick = vi.fn();

    renderDependenciesTab({
      currentSpan,
      dependencies: [createDependencyEntry(dependencySpan, currentSpan)],
      parentChain: [],
      onSpanDoubleClick
    });

    doubleClickBadge('dependency', {shiftKey: true});

    expect(onSpanDoubleClick).toHaveBeenCalledWith(dependencySpan.spanRef, 'select-and-focus');
  });

  it('keeps filtered dependency and parent badges double-clickable without click navigation', () => {
    const currentSpan = createSpan(1, 'current');
    const filteredDependencySpan = createSpan(2, 'filtered-dependency', true);
    const filteredParentSpan = createSpan(3, 'filtered-parent', true);
    const onSpanClick = vi.fn();
    const onSpanDoubleClick = vi.fn();

    renderDependenciesTab({
      currentSpan,
      dependencies: [createDependencyEntry(filteredDependencySpan, currentSpan)],
      parentChain: [createParentEntry(filteredParentSpan)],
      onSpanClick,
      onSpanDoubleClick
    });

    expect(findBadgeButton('filtered-dependency')?.className).toContain('select-none');
    expect(findBadgeButton('filtered-parent')?.className).toContain('select-none');
    doubleClickBadge('filtered-dependency');
    doubleClickBadge('filtered-parent');

    expect(onSpanClick).not.toHaveBeenCalled();
    expect(onSpanDoubleClick).toHaveBeenCalledWith(filteredDependencySpan.spanRef, 'select');
    expect(onSpanDoubleClick).toHaveBeenCalledWith(filteredParentSpan.spanRef, 'select');
  });

  it('renders topology-only filtered dependency and parent badges with the topology outline', () => {
    const currentSpan = createSpan(1, 'current');
    const filteredDependencySpan = createSpan(
      2,
      'topology-filtered-dependency',
      true,
      TRACE_SPAN_FILTER_MASK_TOPOLOGY
    );
    const filteredParentSpan = createSpan(
      3,
      'topology-filtered-parent',
      true,
      TRACE_SPAN_FILTER_MASK_TOPOLOGY
    );

    renderDependenciesTab({
      currentSpan,
      dependencies: [createDependencyEntry(filteredDependencySpan, currentSpan)],
      parentChain: [createParentEntry(filteredParentSpan)]
    });

    const outlinedBadges = Array.from(container?.querySelectorAll('[style*="border-color"]') ?? [])
      .map(element => element.textContent)
      .filter(Boolean);
    expect(outlinedBadges).toEqual(
      expect.arrayContaining(['topology-filtered-dependency', 'topology-filtered-parent'])
    );
  });

  it('filters parent rows by displayed span text', () => {
    const currentSpan = createSpan(1, 'current');
    const alphaParentSpan = createSpan(2, 'alpha-parent');
    const betaParentSpan = createSpan(3, 'beta-parent');

    renderDependenciesTab({
      currentSpan,
      dependencies: [],
      parentChain: [createParentEntry(alphaParentSpan), createParentEntry(betaParentSpan)],
      filterLabel: 'Filter parents'
    });

    setFilterText('beta');

    expect(container?.textContent).toContain('beta-parent');
    expect(container?.textContent).not.toContain('alpha-parent');
    expect(container?.textContent).toContain('1 / 2');
  });
});

function renderDependenciesTab(params: {
  currentSpan: TraceCardSpan;
  dependencies: TraceSpanCardDependencyEntry[];
  parentChain: TraceSpanCardParentChainEntry[];
  filterLabel?: string;
  onSpanClick?: (spanRef: SpanRef) => void;
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceSpanDependenciesTab
        dependencies={params.dependencies}
        currentSpan={params.currentSpan}
        parentChain={params.parentChain}
        parentIndexBySpanId={
          new Map(params.parentChain.map((entry, index) => [entry.span.spanId, index + 1]))
        }
        metricColumns={[createWaitMetricColumn()]}
        getMetricValues={() => ['1ms']}
        filterLabel={params.filterLabel}
        getDependencyBadgeStyle={() => ({
          backgroundColor: 'rgb(4, 5, 6)',
          color: 'rgb(1, 2, 3)'
        })}
        interactive={true}
        onSpanClick={params.onSpanClick}
        onSpanDoubleClick={params.onSpanDoubleClick}
        traceLabels={resolveTraceSpanCardLabels({
          processLabel: 'Process',
          spanLabel: 'Span',
          threadLabel: 'Thread'
        })}
        traceStyle={DEFAULT_TRACE_STYLE}
      />
    );
  });
}

/** Build the single Wait metric column used by direct dependency table tests. */
function createWaitMetricColumn() {
  return {
    id: 'wait',
    label: 'Wait',
    metric: 'wait' as const,
    timingKey: null,
    timingOptions: [],
    timingPickerAriaLabel: null,
    fallbackToActiveTiming: false
  };
}

function createSpan(
  spanRef: number,
  name: string,
  isFiltered = false,
  filterMask = TRACE_SPAN_FILTER_MASK_NONE
): TraceCardSpan {
  return {
    spanRef: spanRef as SpanRef,
    spanId: `${name}-span` as TraceSpanId,
    threadId: 'stream' as TraceThreadId,
    processName: 'rank',
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
    filterMask,
    isFiltered
  };
}

function createDependencyEntry(
  startSpan: TraceCardSpan,
  endSpan: TraceCardSpan
): TraceSpanCardDependencyEntry {
  return {
    dependency: createDependency(startSpan.spanId, endSpan.spanId),
    dependencyRef: null,
    visibleDependencyRef: null,
    startSpanRef: startSpan.spanRef,
    endSpanRef: endSpan.spanRef,
    startSpan,
    endSpan
  };
}

function createParentEntry(span: TraceCardSpan): TraceSpanCardParentChainEntry {
  return {
    spanRef: span.spanRef,
    span,
    chainIndex: 1,
    isFiltered: span.isFiltered
  };
}

function createDependency(startSpanId: TraceSpanId, endSpanId: TraceSpanId): TraceLocalDependency {
  return {
    type: 'trace-local-dependency',
    dependencyId: 'dependency' as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1
  };
}

function clickBadge(label: string): void {
  const button = findBadgeButton(label);
  expect(button).toBeDefined();
  button?.click();
}

function doubleClickBadge(label: string, options: {shiftKey?: boolean} = {}): void {
  const button = findBadgeButton(label);
  expect(button).toBeDefined();
  button?.dispatchEvent(
    new MouseEvent('dblclick', {bubbles: true, shiftKey: Boolean(options.shiftKey)})
  );
}

/** Updates the controlled Parents tab filter input. */
function setFilterText(filterText: string): void {
  const input = container?.querySelector<HTMLInputElement>('input[aria-label="Filter parents"]');
  expect(input).not.toBeNull();
  if (!input) {
    return;
  }
  flushSync(() => {
    setInputValue(input, filterText);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
}

/** Uses the native input setter so React observes a controlled filter input edit. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  expect(valueSetter).toBeDefined();
  valueSetter?.call(input, value);
}

function findBadgeButton(label: string): HTMLButtonElement | undefined {
  return Array.from(container?.querySelectorAll('button') ?? []).find(
    button => button.textContent === label
  );
}
