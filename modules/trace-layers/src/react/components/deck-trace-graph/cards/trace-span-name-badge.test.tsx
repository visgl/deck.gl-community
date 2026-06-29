import {isValidElement} from 'react';
import {describe, expect, it, vi} from 'vitest';

import {
  TRACE_SPAN_FILTER_MASK_NONE,
  TRACE_SPAN_FILTER_MASK_REGEXP,
  TRACE_SPAN_FILTER_MASK_SOURCE,
  TRACE_SPAN_FILTER_MASK_TOPOLOGY
} from '../../../../trace/index';
import {TraceSpanNameBadge} from './trace-span-name-badge';

import type {
  SpanRef,
  TraceGraph,
  TraceSpanColorSource,
  TraceSpanId,
  TraceThreadId
} from '../../../../trace/index';
import type {ReactElement} from 'react';

const filteredSpan: TraceSpanColorSource = {
  spanRef: 1 as SpanRef,
  spanId: 'filtered-span' as TraceSpanId,
  threadId: 'thread-1' as TraceThreadId,
  processName: 'process-1',
  name: 'filtered-span',
  keywords: [],
  primaryTimingKey: 'primary',
  timings: {
    primary: {
      status: 'finished',
      startTimeMs: 0,
      endTimeMs: 1,
      durationMs: 1,
      durationMsAsString: '1ms'
    }
  },
  crossProcessEndpointId: null,
  crossProcessDependencyEndpoints: [],
  userData: undefined
};

describe('TraceSpanNameBadge', () => {
  it('passes explicit span-name filter provenance through to the shared badge', () => {
    const badge = TraceSpanNameBadge({
      spanRef: filteredSpan.spanRef!,
      span: filteredSpan,
      filtered: true,
      filterMask: TRACE_SPAN_FILTER_MASK_REGEXP
    });
    const props = getBadgeProps(badge);

    expect(props.baseTooltipText).toBe('filtered-span');
    expect(props.copyText).toBe('filtered-span');
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
    expect(props.filtered).toBe(true);
    expect(props.filteredVariant).toBe('regexp');
  });

  it('infers topology filtered variants from explicit filter provenance', () => {
    const badge = TraceSpanNameBadge({
      spanRef: filteredSpan.spanRef!,
      span: filteredSpan,
      filtered: true,
      filterMask: TRACE_SPAN_FILTER_MASK_TOPOLOGY
    });
    const props = getBadgeProps(badge);

    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_TOPOLOGY);
    expect(props.filteredVariant).toBe('topology');
  });

  it('infers filtered direct span badges from card-model filter state', () => {
    const fileFilteredSpan: TraceSpanColorSource & {
      filterMask: number;
      isFiltered: boolean;
    } = {
      ...filteredSpan,
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: true
    };
    const badge = TraceSpanNameBadge({
      spanRef: fileFilteredSpan.spanRef!,
      span: fileFilteredSpan
    });
    const props = getBadgeProps(badge);

    expect(props.filtered).toBe(true);
    expect(props.filteredVariant).toBe('regexp');
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_SOURCE);
    expect(props.copyText).toBe('filtered-span');
  });

  it('treats direct span filter masks as filtered even when visibility flags are stale', () => {
    const fileFilteredSpan: TraceSpanColorSource & {
      filterMask: number;
      isFiltered: boolean;
    } = {
      ...filteredSpan,
      filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
      isFiltered: false
    };
    const badge = TraceSpanNameBadge({
      spanRef: fileFilteredSpan.spanRef!,
      span: fileFilteredSpan
    });
    const props = getBadgeProps(badge);

    expect(props.filtered).toBe(true);
    expect(props.filteredVariant).toBe('regexp');
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_SOURCE);
  });

  it('uses explicit visibility props before span-derived filter state', () => {
    const badge = TraceSpanNameBadge({
      spanRef: filteredSpan.spanRef!,
      span: {
        ...filteredSpan,
        filterMask: TRACE_SPAN_FILTER_MASK_SOURCE,
        isFiltered: true
      },
      filtered: false
    });
    const props = getBadgeProps(badge);

    expect(props.filtered).toBe(false);
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_NONE);
  });

  it('infers regexp-filtered ref badges from TraceGraph state', () => {
    const badge = TraceSpanNameBadge({
      traceGraph: createTraceGraphBadgeFacade(TRACE_SPAN_FILTER_MASK_REGEXP),
      spanRef: filteredSpan.spanRef!
    });
    const props = getBadgeProps(badge);

    expect(props.filtered).toBe(true);
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_REGEXP);
    expect(props.copyText).toBe('filtered-span');
  });

  it('infers topology-filtered ref badges from TraceGraph state', () => {
    const badge = TraceSpanNameBadge({
      traceGraph: createTraceGraphBadgeFacade(TRACE_SPAN_FILTER_MASK_TOPOLOGY),
      spanRef: filteredSpan.spanRef!
    });
    const props = getBadgeProps(badge);

    expect(props.filtered).toBe(true);
    expect(props.filteredVariant).toBe('topology');
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_TOPOLOGY);
  });

  it('uses resolved span data before graph fallback for span-ref badges', () => {
    const badge = TraceSpanNameBadge({
      traceGraph: createTraceGraphBadgeFacade(TRACE_SPAN_FILTER_MASK_REGEXP),
      spanRef: filteredSpan.spanRef!,
      span: {
        ...filteredSpan,
        name: 'span-owned-name',
        filterMask: TRACE_SPAN_FILTER_MASK_NONE,
        isFiltered: false
      }
    });
    const props = getBadgeProps(badge);

    expect(props.copyText).toBe('span-owned-name');
    expect(props.filterMask).toBe(TRACE_SPAN_FILTER_MASK_NONE);
    expect(props.filtered).toBe(false);
  });

  it('emits select for plain span badge double-clicks', () => {
    const onSpanDoubleClick = vi.fn();
    const badge = TraceSpanNameBadge({
      spanRef: filteredSpan.spanRef!,
      span: filteredSpan,
      interactive: true,
      onSpanDoubleClick
    });
    const props = getBadgeProps(badge);

    props.onDoubleClick?.({shiftKey: false});

    expect(onSpanDoubleClick).toHaveBeenCalledWith(filteredSpan.spanRef, 'select');
  });

  it('emits select-and-focus for shift span ref badge double-clicks', () => {
    const onSpanDoubleClick = vi.fn();
    const badge = TraceSpanNameBadge({
      traceGraph: createTraceGraphBadgeFacade(TRACE_SPAN_FILTER_MASK_REGEXP),
      spanRef: filteredSpan.spanRef!,
      interactive: true,
      onSpanDoubleClick
    });
    const props = getBadgeProps(badge);

    props.onDoubleClick?.({shiftKey: true});

    expect(onSpanDoubleClick).toHaveBeenCalledWith(filteredSpan.spanRef, 'select-and-focus');
  });
});

/** Builds the TraceGraph slice required by ref-backed name badges. */
function createTraceGraphBadgeFacade(filterMask: number): Readonly<TraceGraph> {
  return {
    getSpanName: () => filteredSpan.name,
    getSpanKeywords: () => filteredSpan.keywords ?? [],
    spanFilterReason: () => ({
      filterMask,
      isFiltered: filterMask !== 0,
      state: filterMask !== 0 ? 'filtered' : 'visible'
    })
  } as unknown as Readonly<TraceGraph>;
}

type TraceSpanNameBadgeTestProps = {
  baseTooltipText?: string;
  copyText?: string;
  filterMask?: number | null;
  filtered?: boolean;
  filteredVariant?: string;
  onDoubleClick?: (event: {shiftKey?: boolean}) => void;
};

function getBadgeProps(element: ReactElement): TraceSpanNameBadgeTestProps {
  expect(isValidElement(element)).toBe(true);
  if (!isValidElement(element)) {
    throw new Error('Expected a TraceSpanBadge element');
  }
  return element.props as TraceSpanNameBadgeTestProps;
}
