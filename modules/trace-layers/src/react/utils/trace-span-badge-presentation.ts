import {
  hasTraceSpanRegexpFilter,
  hasTraceSpanTopologyFilter,
  TRACE_SPAN_FILTER_MASK_NONE,
  truncateMiddle
} from '../../trace/index';
import {getTraceSpanFilterReasonLabel} from './trace-span-filter-reason';

import type {TraceSpanFilterMask} from '../../trace/index';

const DEFAULT_BADGE_LABEL_MAX_LENGTH = 40;
const DEFAULT_BADGE_LABEL_ELLIPSIS_POSITION = 5;
const FILTERED_BADGE_BACKGROUND_COLOR = 'hsl(var(--background))';
const FILTERED_BADGE_TEXT_COLOR = 'hsl(var(--muted-foreground))';
const DEFAULT_FILTERED_BADGE_BORDER_COLOR = 'hsl(var(--border))';

/** Visual treatment used when a span badge represents filtered trace geometry. */
export type TraceSpanBadgeFilteredVariant = 'regexp' | 'topology';

/** Inputs used to derive shared span-badge presentation state. */
export type TraceSpanBadgePresentationParams = {
  /** Full untruncated label shown by the badge tooltip and copy affordances. */
  label: string;
  /** Base tooltip text used before filtered-state annotation is appended. */
  tooltipText?: string | null;
  /** Whether the exact span is hidden by the active filtered graph. */
  filtered?: boolean | null;
  /** Explicit filtered badge variant. */
  filteredVariant?: TraceSpanBadgeFilteredVariant | null;
  /** Exact graph filter provenance used to explain hidden badges. */
  filterMask?: TraceSpanFilterMask | null;
  /** Maximum label length before middle truncation. */
  maxLabelLength?: number;
  /** Character position where middle truncation should place the ellipsis. */
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
  /** Filtered visual treatment to apply when `isFiltered` is true. */
  filteredVariant: TraceSpanBadgeFilteredVariant;
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
  const filteredVariant =
    params.filteredVariant ?? getTraceSpanBadgeFilteredVariant(params.filterMask);
  const statusLabel = isFiltered
    ? (getTraceSpanFilterReasonLabel(filterMask) ??
      (filteredVariant === 'topology'
        ? 'Hidden by: topological filter'
        : 'Hidden by span or file filter'))
    : null;
  const baseTooltip = params.tooltipText ?? params.label;

  return {
    label: params.label,
    truncatedLabel: truncateMiddle(params.label, {
      maxLabelLength: params.maxLabelLength ?? DEFAULT_BADGE_LABEL_MAX_LENGTH,
      ellipsisPosition: params.ellipsisPosition ?? DEFAULT_BADGE_LABEL_ELLIPSIS_POSITION
    }),
    isFiltered,
    filteredVariant,
    statusLabel,
    tooltipText: statusLabel ? `${params.label} (${statusLabel})` : baseTooltip,
    badgeBackgroundColor: isFiltered
      ? FILTERED_BADGE_BACKGROUND_COLOR
      : (params.backgroundColor ?? undefined),
    badgeTextColor: isFiltered ? FILTERED_BADGE_TEXT_COLOR : (params.textColor ?? undefined),
    badgeBorderColor: getTraceSpanBadgeBorderColor({
      backgroundColor: params.backgroundColor,
      filteredVariant,
      isFiltered
    })
  };
}

/**
 * Maps graph filter provenance to the badge's supported filtered visual treatments.
 */
export function getTraceSpanBadgeFilteredVariant(
  filterMask: TraceSpanFilterMask | null | undefined
): TraceSpanBadgeFilteredVariant {
  return filterMask != null &&
    hasTraceSpanTopologyFilter(filterMask) &&
    !hasTraceSpanRegexpFilter(filterMask)
    ? 'topology'
    : 'regexp';
}

function getTraceSpanBadgeBorderColor(params: {
  backgroundColor?: string | null;
  filteredVariant: TraceSpanBadgeFilteredVariant;
  isFiltered: boolean;
}): string {
  if (!params.isFiltered) {
    return 'transparent';
  }
  return params.filteredVariant === 'topology' && params.backgroundColor
    ? params.backgroundColor
    : DEFAULT_FILTERED_BADGE_BORDER_COLOR;
}
