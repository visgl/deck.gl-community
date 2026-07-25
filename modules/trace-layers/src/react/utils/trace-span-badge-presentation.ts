import {TRACE_SPAN_FILTER_MASK_NONE, truncateMiddle} from '../../trace';
import {getTraceSpanFilterReasonLabel} from './trace-span-filter-reason';

import type {TraceSpanFilterMask} from '../../trace';

const DEFAULT_BADGE_LABEL_MAX_LENGTH = 40;
const FILTERED_BADGE_BACKGROUND_COLOR = 'hsl(var(--background))';
const FILTERED_BADGE_TEXT_COLOR = 'hsl(var(--muted-foreground))';
const DEFAULT_FILTERED_BADGE_BORDER_COLOR = 'hsl(var(--border))';

/** Inputs used to derive shared span-badge presentation state. */
export type TraceSpanBadgePresentationParams = {
  /** Full untruncated label shown by the badge tooltip and copy affordances. */
  label: string;
  /** Base tooltip text used before filtered-state annotation is appended. */
  tooltipText?: string | null;
  /** Whether the exact span is hidden by the active filtered graph. */
  filtered?: boolean | null;
  /** Exact graph filter provenance used to explain hidden badges. */
  filterMask?: TraceSpanFilterMask | null;
  /** Maximum label length before middle truncation. */
  maxLabelLength?: number;
  /** Character position where middle truncation should place the ellipsis; omitted values center it. */
  ellipsisPosition?: number;
  /** Normal badge background color resolved by the active trace color scheme. */
  backgroundColor?: string | null;
  /** Normal badge foreground text color resolved by the active trace color scheme. */
  textColor?: string | null;
};

/** Shared computed presentation state for React and Preact span badge renderers. */
export type TraceSpanBadgePresentation = {
  /** Full untruncated label. */
  label: string;
  /** Middle-truncated label for compact badge surfaces. */
  truncatedLabel: string;
  /** Whether the badge should render with filtered styling. */
  isFiltered: boolean;
  /** User-facing hidden-state reason label, or null for visible badges. */
  statusLabel: string | null;
  /** Final tooltip text after hidden-state annotation. */
  tooltipText: string;
  /** Badge background color for the current filtered/visible state. */
  badgeBackgroundColor?: string;
  /** Badge foreground text color for the current filtered/visible state. */
  badgeTextColor?: string;
  /** Badge border color for the current filtered/visible state. */
  badgeBorderColor: string;
};

/**
 * Builds shared span badge presentation state without depending on React or Preact.
 */
export function getTraceSpanBadgePresentation(
  params: TraceSpanBadgePresentationParams
): TraceSpanBadgePresentation {
  const filterMask = params.filterMask;
  const isFiltered =
    Boolean(params.filtered) || (filterMask != null && filterMask !== TRACE_SPAN_FILTER_MASK_NONE);
  const statusLabel = isFiltered
    ? (getTraceSpanFilterReasonLabel(filterMask) ?? 'Hidden by span or file filter')
    : null;
  const baseTooltip = params.tooltipText ?? params.label;

  return {
    label: params.label,
    truncatedLabel: truncateMiddle(params.label, {
      maxLabelLength: params.maxLabelLength ?? DEFAULT_BADGE_LABEL_MAX_LENGTH,
      ellipsisPosition: params.ellipsisPosition
    }),
    isFiltered,
    statusLabel,
    tooltipText: statusLabel ? `${params.label} (${statusLabel})` : baseTooltip,
    badgeBackgroundColor: isFiltered
      ? FILTERED_BADGE_BACKGROUND_COLOR
      : (params.backgroundColor ?? undefined),
    badgeTextColor: isFiltered ? FILTERED_BADGE_TEXT_COLOR : (params.textColor ?? undefined),
    badgeBorderColor: isFiltered ? DEFAULT_FILTERED_BADGE_BORDER_COLOR : 'transparent'
  };
}
