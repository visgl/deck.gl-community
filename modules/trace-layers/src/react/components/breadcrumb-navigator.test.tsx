import {flushSync} from 'react-dom';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {DEFAULT_TRACE_STYLE, TRACE_SPAN_FILTER_MASK_SOURCE} from '../../trace/index';
import {BreadcrumbNavigator} from './breadcrumb-navigator';

import type {SpanRef, TraceGraph} from '../../trace/index';
import type {TraceBreadcrumbEntry} from './breadcrumb-navigator';
import type {Root} from 'react-dom/client';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

describe('BreadcrumbNavigator', () => {
  it('outlines filtered breadcrumb entries while leaving older entries solid', () => {
    const rendered = renderBreadcrumbNavigator();

    const filteredBadge = getBadgeElementByLabel(rendered, 'filtered-span');
    const solidBadge = getBadgeElementByLabel(rendered, 'solid-span');

    expect(filteredBadge.className).toContain('border-muted-foreground');
    expect(filteredBadge.className).toContain('text-muted-foreground');
    expect(solidBadge.className).not.toContain('border-muted-foreground');
    expect(solidBadge.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });

  it('uses current graph filter state instead of stale breadcrumb filter fields', () => {
    const rendered = renderBreadcrumbNavigator({
      traceGraph: createBreadcrumbTraceGraphFacade({
        1: TRACE_SPAN_FILTER_MASK_SOURCE,
        2: 0
      }),
      filteredEntryOverrides: {
        filterMask: null,
        isFiltered: false
      },
      solidEntryOverrides: {
        filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
        isFiltered: true
      }
    });

    const graphFilteredBadge = getBadgeElementByLabel(rendered, 'filtered-span');
    const graphVisibleBadge = getBadgeElementByLabel(rendered, 'solid-span');

    expect(graphFilteredBadge.className).toContain('border-muted-foreground');
    expect(graphVisibleBadge.className).not.toContain('border-muted-foreground');
  });
});

/** Renders the breadcrumb navigator with one filtered entry and one legacy entry. */
function renderBreadcrumbNavigator(
  params: {
    /** Optional graph facade used to resolve current breadcrumb filter state. */
    traceGraph?: Readonly<TraceGraph>;
    /** Optional overrides applied to the first breadcrumb entry. */
    filteredEntryOverrides?: Partial<TraceBreadcrumbEntry>;
    /** Optional overrides applied to the second breadcrumb entry. */
    solidEntryOverrides?: Partial<TraceBreadcrumbEntry>;
  } = {}
): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  flushSync(() => {
    root?.render(
      <BreadcrumbNavigator
        traceStyle={DEFAULT_TRACE_STYLE}
        traceGraph={params.traceGraph}
        breadcrumb={[
          {
            spanRef: 1 as SpanRef,
            spanName: 'filtered-span',
            filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
            isFiltered: false,
            blockColor: 'rgb(120, 90, 60)',
            ...params.filteredEntryOverrides
          },
          {
            spanRef: 2 as SpanRef,
            spanName: 'solid-span',
            blockColor: 'rgb(1, 2, 3)',
            ...params.solidEntryOverrides
          }
        ]}
        activeIndex={0}
        goToBreadcrumb={vi.fn()}
      />
    );
  });

  return container;
}

/** Builds the small TraceGraph surface BreadcrumbNavigator needs for filter state lookups. */
function createBreadcrumbTraceGraphFacade(
  testFilterMaskBySpanRef: Record<number, number>
): Readonly<TraceGraph> {
  return {
    getSpanName: (spanRef: SpanRef) =>
      Object.prototype.hasOwnProperty.call(testFilterMaskBySpanRef, spanRef)
        ? `span-${String(spanRef)}`
        : null,
    spanFilterReason: (spanRef: SpanRef) => {
      const filterMask = testFilterMaskBySpanRef[spanRef] ?? 0;
      return {
        filterMask,
        isFiltered: filterMask !== 0,
        state: filterMask !== 0 ? 'filtered' : 'visible'
      };
    }
  } as unknown as Readonly<TraceGraph>;
}

/** Returns the rendered TraceSpanBadge root for a breadcrumb label. */
function getBadgeElementByLabel(rendered: HTMLDivElement, label: string): HTMLElement {
  const labelElement = [...rendered.querySelectorAll('span')].find(
    element => element.textContent === label && element.className.includes('select-none')
  );
  const badgeElement = labelElement?.closest('.relative.group');
  if (!(badgeElement instanceof HTMLElement)) {
    throw new Error(`Missing breadcrumb badge for ${label}`);
  }
  return badgeElement;
}
