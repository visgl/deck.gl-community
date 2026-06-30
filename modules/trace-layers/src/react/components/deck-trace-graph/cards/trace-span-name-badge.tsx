import {DEFAULT_TRACE_STYLE, TRACE_SPAN_FILTER_MASK_NONE} from '../../../../trace/index';
import {getTraceSpanBadgeFilteredVariant} from '../../../utils/trace-span-badge-presentation';
import {colorToRgbaCss} from '../../../utils/trace-span-badge-style';
import {TraceSpanBadge} from '../../trace-span-badge';

import type {
  SpanRef,
  TraceColorScheme,
  TraceGraph,
  TraceSpanColorSource,
  TraceSpanFilterMask
} from '../../../../trace/index';
import type {TraceSpanBadgeFilteredVariant} from '../../../utils/trace-span-badge-presentation';
import type {CSSProperties, MouseEvent as ReactMouseEvent} from 'react';

/** Semantic action requested by a span-name badge double-click gesture. */
export type TraceSpanDoubleClickAction = 'select' | 'select-and-focus';

/** Resolved span display data accepted by the internal span-name badge adapter. */
export type TraceSpanNameBadgeResolvedSpan = TraceSpanColorSource & {
  /** Exact graph filter provenance used to explain filtered badges. */
  filterMask?: TraceSpanFilterMask;
  /** Whether the span is hidden by the current filtered view. */
  isFiltered?: boolean;
};

export type TraceSpanNameBadgeProps = {
  /** Canonical span ref used for selection and click callbacks. */
  spanRef: SpanRef;
  /** Optional graph used to resolve missing display and filter fields. */
  traceGraph?: Readonly<TraceGraph>;
  /** Optional pre-resolved span display data used by card rows. */
  span?: Partial<TraceSpanNameBadgeResolvedSpan>;
  /** Active trace color scheme used for keyword presentation. */
  colorScheme?: TraceColorScheme;
  /** Whether the badge should emit click and double-click events. */
  interactive?: boolean;
  /** Whether the span is hidden by the current filtered view. */
  filtered?: boolean;
  /** Visual treatment for a filtered badge. */
  filteredVariant?: TraceSpanBadgeFilteredVariant;
  /** Exact graph filter provenance used to explain filtered badges. */
  filterMask?: TraceSpanFilterMask;
  /** Maximum label length before middle truncation. */
  maxLabelLength?: number;
  /** Callback when the badge is clicked for the exact span ref. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when the badge is double-clicked for the exact span ref. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** CSS style applied to the badge. */
  style?: CSSProperties;
};

/** Render a trace span name badge from a span ref and optional resolved span data. */
export function TraceSpanNameBadge(props: TraceSpanNameBadgeProps) {
  const name = props.span?.name ?? props.traceGraph?.getSpanName(props.spanRef) ?? 'unknown';
  const keywords = props.span?.keywords ?? props.traceGraph?.getSpanKeywords(props.spanRef) ?? [];
  const spanFilterMask = getTraceSpanNameBadgeSpanFilterMask(props.span);
  const spanFiltered = getTraceSpanNameBadgeSpanFiltered(props.span, spanFilterMask);
  const graphFilterReason =
    spanFilterMask == null || spanFiltered == null
      ? props.traceGraph?.spanFilterReason(props.spanRef)
      : undefined;
  const filterMask =
    props.filterMask ??
    spanFilterMask ??
    graphFilterReason?.filterMask ??
    TRACE_SPAN_FILTER_MASK_NONE;
  const filtered = getTraceSpanNameBadgeFilteredState({
    explicitFiltered: props.filtered,
    explicitFilterMask: props.filterMask,
    spanFiltered,
    graphFiltered: graphFilterReason?.isFiltered,
    filterMask
  });
  const badgeFilterMask = filtered ? filterMask : TRACE_SPAN_FILTER_MASK_NONE;
  const filteredVariant =
    props.filteredVariant ?? getTraceSpanBadgeFilteredVariant(badgeFilterMask);
  const keywordPresentation = props.colorScheme?.getKeywordPresentation?.({
    keywords
  });
  const keywordBackgroundColor = keywordPresentation?.color
    ? colorToRgbaCss(keywordPresentation.color)
    : undefined;
  const style: CSSProperties = {
    ...(keywordBackgroundColor && !props.style?.backgroundColor
      ? {backgroundColor: keywordBackgroundColor}
      : {}),
    ...(props.style ?? {})
  };

  return (
    <TraceSpanBadge
      traceLabels={DEFAULT_TRACE_STYLE.labels}
      label={name}
      baseTooltipText={keywordPresentation?.description ?? name}
      copyText={name}
      className="py-0 my-0 rounded-xl pointer-events-auto"
      style={style}
      filtered={filtered}
      filteredVariant={filteredVariant}
      filterMask={badgeFilterMask}
      maxLabelLength={props.maxLabelLength}
      interactive={props.interactive}
      onClick={() => props.onSpanClick?.(props.spanRef)}
      onDoubleClick={event =>
        props.onSpanDoubleClick?.(props.spanRef, getTraceSpanDoubleClickAction(event))
      }
    />
  );
}

/**
 * Decodes the span badge double-click modifier into the public semantic action.
 */
function getTraceSpanDoubleClickAction(
  event: ReactMouseEvent<HTMLButtonElement>
): TraceSpanDoubleClickAction {
  return event.shiftKey ? 'select-and-focus' : 'select';
}

/**
 * Reads optional card-model filter provenance from direct span badge sources.
 */
function getTraceSpanNameBadgeSpanFilterMask(
  span: Partial<TraceSpanNameBadgeResolvedSpan> | null | undefined
): TraceSpanFilterMask | undefined {
  const filterMask = span?.filterMask;
  return typeof filterMask === 'number' ? filterMask : undefined;
}

/**
 * Reads optional card-model filtered state from direct span badge sources.
 */
function getTraceSpanNameBadgeSpanFiltered(
  span: Partial<TraceSpanNameBadgeResolvedSpan> | null | undefined,
  filterMask: TraceSpanFilterMask | undefined
): boolean | undefined {
  const filteredByMask = filterMask != null && filterMask !== TRACE_SPAN_FILTER_MASK_NONE;
  if (typeof span?.isFiltered === 'boolean') {
    return span.isFiltered || filteredByMask;
  }
  return filterMask == null ? undefined : filteredByMask;
}

/**
 * Resolves filtered state using explicit props before span and graph-derived fallbacks.
 */
function getTraceSpanNameBadgeFilteredState(params: {
  explicitFiltered: boolean | undefined;
  explicitFilterMask: TraceSpanFilterMask | undefined;
  spanFiltered: boolean | undefined;
  graphFiltered: boolean | undefined;
  filterMask: TraceSpanFilterMask;
}): boolean {
  if (params.explicitFiltered != null) {
    return params.explicitFiltered;
  }
  if (params.explicitFilterMask != null) {
    return params.explicitFilterMask !== TRACE_SPAN_FILTER_MASK_NONE;
  }
  return (
    params.spanFiltered ?? params.graphFiltered ?? params.filterMask !== TRACE_SPAN_FILTER_MASK_NONE
  );
}
