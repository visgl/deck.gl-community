import type {TraceLabels} from '../../../../../trace/index';
import type {ReactNode} from 'react';

/**
 * Shared fixed layout constants for the compact dependency tables.
 */
export const MAX_PARENT_CHAIN_ROWS = 5;

/**
 * Maximum badge label length before middle truncation in dependency tables.
 */
export const DEPENDENCY_TABLE_BADGE_MAX_LABEL_LENGTH = 28;

/**
 * Standard fixed tab-body height used by interactive TraceSpanCard tabs.
 */
export const TRACE_SPAN_CARD_STANDARD_TAB_HEIGHT_PX = 116;

/**
 * Shared empty-state styling for tab content panes.
 */
export const TRACE_BLOCK_CARD_EMPTY_TAB_CLASS =
  'flex h-full justify-center pt-4 text-center text-xs text-blue-400';

/**
 * Fixed histogram bin width in SVG units.
 */
export const TRACE_BLOCK_CARD_HISTOGRAM_BIN_WIDTH = 12;

/**
 * Fixed histogram baseline position in SVG units.
 */
export const TRACE_BLOCK_CARD_HISTOGRAM_BASELINE_Y = 44;

/**
 * Maximum histogram bar height in SVG units.
 */
export const TRACE_BLOCK_CARD_HISTOGRAM_BAR_MAX_HEIGHT = 34;

/**
 * Ordered list of interactive tabs in the block card.
 */
export const TRACE_BLOCK_CARD_TAB_ORDER = [
  'all',
  'dependencies',
  'outgoing-dependencies',
  'cross-rank',
  'traversal',
  'children',
  'histogram',
  'timings',
  'span-data'
] as const;

/**
 * Literal union of supported TraceSpanCard tab ids.
 */
export type TraceSpanCardTab = (typeof TRACE_BLOCK_CARD_TAB_ORDER)[number];

/**
 * Stable tab id accepted by the TraceSpanCard tab strip.
 */
export type TraceSpanCardTabId = TraceSpanCardTab | string;

/**
 * Caller-owned tab rendered alongside the built-in TraceSpanCard tabs.
 */
export type TraceSpanCardCustomTab = {
  /** Stable tab id used for selection and localStorage persistence. */
  id: TraceSpanCardTabId;
  /** Visible label shown in the card tab strip. */
  label: string;
  /** Optional built-in or custom tab id before which this custom tab should be inserted. */
  insertBeforeTabId?: TraceSpanCardTabId;
  /** Whether this tab should be available for the current span. Defaults to true. */
  isAvailable?: boolean;
  /** Caller-owned tab body content. */
  content: ReactNode;
};

/**
 * Supported leading metric modes for dependency-style tables.
 */
export type TraceSpanDependencyMetric = 'wait' | 'duration';

/**
 * Representative timing keys used to summarize aggregated span durations.
 */
export type TraceSpanRepresentativeTimingKey = 'mean' | 'p50';

/**
 * One metric column rendered by dependency-style span tables.
 */
export type TraceSpanDependencyMetricColumn = {
  /** Stable id used to update one metric column without affecting the other. */
  id: string;
  /** Visible header shown for the metric column. */
  label: string;
  /** Metric family rendered by the column. */
  metric: TraceSpanDependencyMetric;
  /** Preferred timing key for duration columns, or null for wait columns. */
  timingKey: string | null;
  /** Timing keys available to the duration-column picker. */
  timingOptions: readonly string[];
  /** Accessible label for the duration-column picker, or null for read-only metric columns. */
  timingPickerAriaLabel: string | null;
  /** Callback fired when a duration-column picker selects another timing key. */
  onTimingKeyChange?: ((timingKey: string) => void) | undefined;
  /** Whether missing duration timings may fall back to the active or primary span timing. */
  fallbackToActiveTiming: boolean;
};

/**
 * Interactive filtered-span visibility control rendered in dependency-style table headers.
 */
export type TraceSpanTableSpanVisibilityControl = {
  /** Whether filtered spans are currently included in the table rows. */
  showHiddenSpans: boolean;
  /** Callback fired when the table visibility selector changes. */
  onShowHiddenSpansChange: (showHiddenSpans: boolean) => void;
};

/**
 * Normalized interactive-card options passed from app-level callers.
 */
export type TraceSpanCardTabOptions = {
  /** Visible label for the default dependency tab. */
  dependencyLabel?: string | undefined;
  /** Visible label for the outgoing dependency tab. */
  outgoingDependencyLabel?: string | undefined;
  /** Whether the outgoing-dependencies tab should be shown. */
  showOutgoingDependencies?: boolean;
  /**
   * Whether data tabs should remain visible even when their current span has no tab content.
   */
  alwaysShowAll?: boolean;
  /** Whether the child-dependencies tab should be shown. */
  showChildren?: boolean;
  /** Whether cross-process dependency summaries should be shown. */
  showCrossProcessDependencies?: boolean;
  /** Leading metric to show in dependency-style tables. */
  dependencyMetric?: TraceSpanDependencyMetric;
  /** Optional empty-state message shown when the Timings tab has no timing-table data. */
  timingsEmptyMessage?: string | undefined;
};

/**
 * Default human-readable labels for each TraceSpanCard tab.
 */
export const TRACE_BLOCK_CARD_TAB_LABELS: Record<TraceSpanCardTab, string> = {
  all: 'All',
  dependencies: 'Dependencies',
  'outgoing-dependencies': 'Outgoing',
  'cross-rank': 'Cross Rank',
  traversal: 'Traversal',
  children: 'Children',
  histogram: 'Histogram',
  'span-data': 'Span Data',
  timings: 'Timings'
};

/**
 * Resolved trace label bundle used throughout TraceSpanCard internals.
 */
export type ResolvedTraceLabels = {
  /** Singular display label for spans. */
  spanLabel: string;
  /** Singular display label for processes. */
  processLabel: string;
  /** Singular display label for threads. */
  threadLabel: string;
  /** Upper-case block label for section headers. */
  spanLabelUpper: string;
  /** Upper-case process label for section headers. */
  processLabelUpper: string;
  /** Lower-case block label for inline text. */
  spanLabelLower: string;
  /** Lower-case process label for inline text. */
  processLabelLower: string;
  /** Plural block label for counts and aggregate text. */
  spanLabelPlural: string;
  /** Plural process label for counts and aggregate text. */
  processLabelPlural: string;
  /** Upper-case thread label for section headers. */
  threadLabelUpper: string;
  /** Lower-case thread label for inline text. */
  threadLabelLower: string;
};

/**
 * Parsed histogram distribution payload from aggregated span data.
 */
export type TraceSpanHistogramDistribution = {
  /** Lower bound of the histogram domain, in microseconds. */
  lowerBoundUs: number;
  /** Upper bound of the histogram domain, in microseconds. */
  upperBoundUs: number;
  /** Integer process counts for each histogram bucket. */
  buckets: number[];
};

/**
 * Fully prepared histogram specification for TraceSpanCard rendering.
 */
export type TraceSpanHistogramSpec = {
  /** Stable histogram id used for tabs and hover state. */
  id: string;
  /** Visible histogram title shown in the selector. */
  title: string;
  /** Accessible label for the rendered SVG histogram. */
  ariaLabel: string;
  /** Integer process counts for each bucket. */
  buckets: number[];
  /** Lower bound of the histogram domain, in milliseconds. */
  lowerBoundMs: number;
  /** Upper bound of the histogram domain, in milliseconds. */
  upperBoundMs: number;
  /** Formatted lower-bound axis label. */
  lowerBoundLabel: string;
  /** Formatted upper-bound axis label. */
  upperBoundLabel: string;
  /** Total number of samples represented across buckets. */
  totalCount: number;
  /** Maximum bucket count used for Y-axis scaling. */
  maxCount: number;
  /** Domain-specific converter for displaying raw millisecond values. */
  getDisplayValueMs: (valueMs: number) => number;
  /** Domain-specific formatter for a displayed millisecond value. */
  formatValueLabel: (valueMs: number) => string;
};

/**
 * Prepared timing-table content and aggregate metric strings for the Timings tab.
 */
export type TraceSpanTimingsTableData = {
  /** Two-dimensional table rows consumed by PrettyTable. */
  rows: string[][];
  /** Number of timing columns present in the table. */
  timingCount: number;
  /** Ordered timing keys corresponding to the rendered columns. */
  timingKeys: string[];
  /** Formatted variance metric shown above the table, when available. */
  variance: null | string;
  /** Formatted duration coefficient-of-variation shown above the table. */
  durationCv: null | string;
};

/**
 * Minimal input shape for resolving trace labels into the normalized internal form.
 */
export type TraceSpanCardLabelInput = TraceLabels | undefined;
