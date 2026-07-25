import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {DEFAULT_TRACE_STYLE, TRACE_SPAN_FILTER_MASK_NONE} from '../../../../../trace';
import {resolveTraceSpanCardLabels} from '../trace-span-card-helpers';
import {TraceSpanChildrenTab} from './trace-span-card-tab-children';

import type {
  SpanRef,
  TraceCardSpan,
  TraceDependencyId,
  TraceSameProcessDependency,
  TraceSpanCardDescendantResult,
  TraceSpanId,
  TraceThreadId
} from '../../../../../trace';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {Root} from 'react-dom/client';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

describe('TraceSpanChildrenTab', () => {
  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
    document.body.innerHTML = '';
  });

  it('passes select-and-focus for shift double-clicked child badges', () => {
    const currentSpan = createSpan(1, 'current');
    const childSpan = createSpan(2, 'child');
    const onSpanDoubleClick = vi.fn();

    renderChildrenTab({
      currentSpan,
      descendants: createDescendants(currentSpan, childSpan),
      onSpanDoubleClick
    });

    doubleClickBadge('child', {shiftKey: true});

    expect(onSpanDoubleClick).toHaveBeenCalledWith(childSpan.spanRef, 'select-and-focus');
  });

  it('filters child rows by displayed span text', () => {
    const currentSpan = createSpan(1, 'current');
    const alphaChildSpan = createSpan(2, 'alpha-child');
    const betaChildSpan = createSpan(3, 'beta-child');

    renderChildrenTab({
      currentSpan,
      descendants: createDescendants(currentSpan, alphaChildSpan, betaChildSpan)
    });

    setFilterText('beta');

    expect(container?.textContent).toContain('beta-child');
    expect(container?.textContent).not.toContain('alpha-child');
    expect(container?.textContent).toContain('1 / 2');
  });

  it('shows an empty state when no child rows match the filter', () => {
    const currentSpan = createSpan(1, 'current');
    const childSpan = createSpan(2, 'child');

    renderChildrenTab({
      currentSpan,
      descendants: createDescendants(currentSpan, childSpan)
    });

    setFilterText('missing');

    expect(container?.textContent).toContain('No children match the current filter.');
  });

  it('renders metrics and process before span with one-em listed-descendant indentation', () => {
    const currentSpan = createSpan(1, 'current');
    const childSpan = createSpan(2, 'child');
    const deepChildSpan = createSpan(3, 'deep-child');
    const nestedSiblingSpan = createSpan(4, 'nested-sibling');
    const siblingSpan = createSpan(5, 'sibling');

    renderChildrenTab({
      currentSpan,
      descendants: createDescendantsFromEntries(currentSpan, [
        {childSpan, depth: 1, parentSpanId: currentSpan.spanId},
        {
          childSpan: deepChildSpan,
          depth: 4,
          parentSpanId: 'hidden-parent' as TraceSpanId
        },
        {
          childSpan: nestedSiblingSpan,
          depth: 3,
          parentSpanId: 'hidden-sibling-parent' as TraceSpanId
        },
        {childSpan: siblingSpan, depth: 1, parentSpanId: currentSpan.spanId}
      ])
    });

    expect(getHeaderTexts()).toEqual(['Duration', 'Process', 'Span']);
    expect(getChildAttributeValues('data-child-depth')).toEqual(['1', '4', '3', '1']);
    expect(getChildAttributeValues('data-child-indent-level')).toEqual(['0', '1', '1', '0']);
    expect(getChildIndentOffsets()).toEqual(['0em', '1em', '1em', '0em']);
  });
});

function renderChildrenTab(params: {
  currentSpan: TraceCardSpan;
  descendants: TraceSpanCardDescendantResult;
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <TraceSpanChildrenTab
        descendants={params.descendants}
        currentSpan={params.currentSpan}
        metricColumns={[createDurationMetricColumn()]}
        getMetricValues={() => ['1ms']}
        getDependencyBadgeStyle={() => ({
          backgroundColor: 'rgb(4, 5, 6)',
          color: 'rgb(1, 2, 3)'
        })}
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

/** Build the single duration metric column used by direct child table tests. */
function createDurationMetricColumn() {
  return {
    id: 'duration',
    label: 'Duration',
    metric: 'duration' as const,
    timingKey: 'default',
    timingOptions: ['default'],
    timingPickerAriaLabel: null,
    fallbackToActiveTiming: false
  };
}

function createDescendants(
  currentSpan: TraceCardSpan,
  ...childSpans: TraceCardSpan[]
): TraceSpanCardDescendantResult {
  return createDescendantsFromEntries(
    currentSpan,
    childSpans.map(childSpan => ({
      childSpan,
      depth: 1,
      parentSpanId: currentSpan.spanId
    }))
  );
}

/** Builds descendant rows with explicit raw traversal depths for indentation tests. */
function createDescendantsFromEntries(
  currentSpan: TraceCardSpan,
  entries: readonly {
    /** Descendant span rendered in one child row. */
    childSpan: TraceCardSpan;
    /** Raw dependency traversal depth retained on the child row. */
    depth: number;
    /** Raw parent span id retained on the child row. */
    parentSpanId: TraceSpanId;
  }[]
): TraceSpanCardDescendantResult {
  return {
    entries: entries.map(({childSpan, depth, parentSpanId}) => {
      const dependency = createDependency(currentSpan.spanId, childSpan.spanId);
      return {
        dependency,
        visibleDependencyRef: null,
        startSpan: currentSpan,
        endSpan: childSpan,
        childSpanRef: childSpan.spanRef,
        childSpan,
        depth,
        parentSpanId
      };
    }),
    isTruncated: false,
    truncatedCount: 0,
    truncationCountIsExact: true,
    limit: 100
  };
}

/** Returns rendered child-table header labels. */
function getHeaderTexts(): string[] {
  return [...(container?.querySelectorAll('thead th') ?? [])].map(
    header => header.textContent?.trim() ?? ''
  );
}

/** Returns one rendered child-row data attribute from every matching child badge wrapper. */
function getChildAttributeValues(attributeName: string): string[] {
  return [...(container?.querySelectorAll(`[${attributeName}]`) ?? [])].map(
    element => element.getAttribute(attributeName) ?? ''
  );
}

/** Returns rendered inline indentation offsets from every child badge wrapper. */
function getChildIndentOffsets(): string[] {
  return [...(container?.querySelectorAll<HTMLElement>('[data-child-indent-level]') ?? [])].map(
    element => element.style.paddingInlineStart
  );
}

function createSpan(spanRef: number, name: string): TraceCardSpan {
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
    filterMask: TRACE_SPAN_FILTER_MASK_NONE,
    isFiltered: false
  };
}

function createDependency(
  startSpanId: TraceSpanId,
  endSpanId: TraceSpanId
): TraceSameProcessDependency {
  return {
    type: 'trace-same-process-dependency',
    dependencyId: 'dependency' as TraceDependencyId,
    startSpanId,
    endSpanId,
    keywords: new Set(),
    waitMode: 'end-to-start',
    bidirectional: false,
    waitTimeMs: 1
  };
}

function doubleClickBadge(label: string, options: {shiftKey?: boolean} = {}): void {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    candidate => candidate.textContent === label
  );
  expect(button).toBeDefined();
  button?.dispatchEvent(
    new MouseEvent('dblclick', {bubbles: true, shiftKey: Boolean(options.shiftKey)})
  );
}

/** Updates the controlled Children tab filter input. */
function setFilterText(filterText: string): void {
  const input = container?.querySelector<HTMLInputElement>('input[aria-label="Filter children"]');
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
