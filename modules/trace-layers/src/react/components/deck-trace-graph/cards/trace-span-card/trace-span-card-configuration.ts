import {
  compareTraceTimingKeys,
  getPrimaryTiming,
  getTraceGraphSpanArrowColumnValues,
  getTraceGraphSpanExternalSpanId
} from '../../../../../trace/index';
import {formatUserDataValue, resolveTraceSpanCardLabels} from '../trace-span-card-helpers';
import {getTraceSpanHistogramSpecs} from './trace-span-card-tab-histogram';
import {getSpanTimingsTableRows} from './trace-span-card-tab-timings';
import {TRACE_BLOCK_CARD_TAB_ORDER} from './trace-span-card-types';

import type {
  SpanRef,
  TraceGraph,
  TraceSpanCardModel,
  TraceSpanCardParentChainEntry,
  TraceSpanId,
  TraceSpanTiming,
  TraceVisSettings
} from '../../../../../trace/index';
import type {
  ResolvedTraceLabels,
  TraceSpanCardLabelInput,
  TraceSpanCardTab,
  TraceSpanCardTabOptions,
  TraceSpanHistogramSpec,
  TraceSpanRepresentativeTimingKey,
  TraceSpanTimingsTableData
} from './trace-span-card-types';
import type {ReactNode} from 'react';

/**
 * Explicit duration summary shown for one aggregated span.
 */
export type TraceSpanAggregatedDurationSummary = {
  /** Envelope timing spanning the earliest represented start through latest represented end. */
  envelopeTiming: TraceSpanTiming | null;
  /** Representative per-span timing used to contrast against the envelope. */
  representativeTiming: TraceSpanTiming | null;
  /** Timing key used for the representative per-span duration, when available. */
  representativeTimingKey: TraceSpanRepresentativeTimingKey | null;
};

/**
 * Derived data consumed by the TraceSpanCard container and presentational sections.
 */
export type TraceSpanCardConfiguration = {
  /** Canonical span-card model from the current trace graph. */
  cardModel: TraceSpanCardModel;
  /** Canonical span row from the current trace graph. */
  span: TraceSpanCardModel['span'];
  /** Earliest graph-relative time shared by timings and histogram tabs. */
  traceMinTimeMs: number;
  /** Resolved singular, plural, upper-case, and lower-case labels for the card. */
  traceLabels: ResolvedTraceLabels;
  /** Normalized tab and display options resolved from caller input. */
  tabOptions: Required<TraceSpanCardTabOptions>;
  /** Whether this block represents an aggregate over multiple source spans. */
  isAggregatedSpan: boolean;
  /** Inline aggregate participant label shown beside the title, when available. */
  aggregateParticipantsLabel: string | null;
  /** Human-readable process label for the current block. */
  processName: string;
  /** Human-readable thread or stream label for the current block. */
  streamLabel: string;
  /** Prepared span-data rows with bigint-safe formatting applied to values. */
  userDataRows: [string, ReactNode][];
  /** Stable external span id for URL deep links, when provided by the trace backend. */
  externalSpanId: string | null;
  /** Optional source label shown beside the selected span id. */
  spanSource: string | null;
  /** Prepared timings-table content for the Timings tab, or null when unavailable. */
  spanTimings: TraceSpanTimingsTableData | null;
  /** Prepared histogram specifications derived from aggregate span distributions. */
  histogramSpecs: TraceSpanHistogramSpec[];
  /** Timing key currently active for summary display and duration-based metrics. */
  activeTimingKey: string;
  /** Timing object corresponding to the active timing key fallback chain. */
  blockTiming: TraceSpanCardModel['span']['timings'][string];
  /** Explicit aggregated duration metrics shown beside the selected span title. */
  aggregatedDurationSummary: TraceSpanAggregatedDurationSummary | null;
  /** Block start time relative to the trace origin, in milliseconds. */
  relativeStartTimeMs: number;
  /** Highlighted timings-table column index for the active timing key. */
  highlightedTimingColumnIndex: number;
  /** Ordered timing keys available to duration columns in dependency-style tables. */
  dependencyDurationTimingKeys: readonly string[];
  /** Default timing keys for the first and second duration columns. */
  defaultDependencyDurationTimingKeys: readonly [string, string];
  /** Incoming dependencies for the current block. */
  inDependencies: TraceSpanCardModel['visibleIncomingDependencyEntries'];
  /** Incoming dependencies for the current block, including filtered spans. */
  fullInDependencies: TraceSpanCardModel['fullIncomingDependencyEntries'];
  /** Outgoing dependencies for the current block. */
  outDependencies: TraceSpanCardModel['visibleOutgoingDependencyEntries'];
  /** Outgoing dependencies for the current block, including filtered spans. */
  fullOutDependencies: TraceSpanCardModel['fullOutgoingDependencyEntries'];
  /** Full parent chain regardless of filtering. */
  fullParentChain: TraceSpanCardParentChainEntry[];
  /** Visible parent chain after filtering. */
  visibleParentChain: TraceSpanCardParentChainEntry[];
  /** One-based parent index lookup for parent-chain rows. */
  parentIndexBySpanId: ReadonlyMap<TraceSpanId, number>;
  /** Cross-process dependency endpoints for the compact cross-rank summary. */
  endpointsWithDeps: TraceSpanCardModel['endpointsWithDeps'];
  /** Whether the default dependency tab has visible content. */
  hasDependencyTab: boolean;
  /** Whether the outgoing dependency tab has visible content. */
  hasOutgoingDependencyTab: boolean;
  /** Availability of each interactive tab keyed by tab id. */
  tabAvailability: Record<TraceSpanCardTab, boolean>;
  /** Ordered list of interactive tabs currently available for the card. */
  availableTabs: TraceSpanCardTab[];
  /** Parsed communication operation name. */
  operation: string;
  /** Parsed communication topology label. */
  topology: string;
  /** Received-byte metadata extracted from span data, when available. */
  recvBytes: number | undefined;
  /** Sent-byte metadata extracted from span data, when available. */
  sendBytes: number | undefined;
  /** Whether either receive or send byte metadata is present. */
  hasCommBytes: boolean;
  /** Whether caller-provided traversal content is available for this block. */
  hasTraversalContent: boolean;
};

/**
 * Parameters for building a TraceSpanCardConfiguration.
 */
export type BuildTraceSpanCardConfigurationParams = {
  /** Exact span ref selected by the caller. */
  spanRef: SpanRef;
  /** Filtered graph wrapper used for dependency and child lookups. */
  traceGraph: Readonly<TraceGraph>;
  /** Optional trace labels supplied by the owning trace view. */
  traceLabels: TraceSpanCardLabelInput;
  /** Active visualization settings for timing selection and formatting. */
  traceSettings: TraceVisSettings;
  /** Whether the card is interactive and should render tabs. */
  interactive?: boolean;
  /** Optional caller-provided tab and dependency display options. */
  tabOptions?: TraceSpanCardTabOptions;
  /** Whether caller-provided traversal content is available for this block. */
  hasTraversalContent?: boolean;
};

/**
 * Resolve graph state and caller options into the stable TraceSpanCard configuration.
 */
export function buildTraceSpanCardConfiguration(
  params: BuildTraceSpanCardConfigurationParams
): TraceSpanCardConfiguration {
  const traceLabels = resolveTraceSpanCardLabels(params.traceLabels);
  const tabOptions = resolveTraceSpanCardOptions(params.tabOptions);
  const cardModel = params.traceGraph.getTraceSpanCardModel(params.spanRef);
  if (!cardModel) {
    throw new Error(`Trace span not found: ${String(params.spanRef)}`);
  }
  const traceMinTimeMs = cardModel.traceMinTimeMs;
  const span = cardModel.span;
  const fullParentChain = cardModel.fullParentChain;
  const visibleParentChain = cardModel.visibleParentChain;
  const parentIndexBySpanId = new Map<TraceSpanId, number>(
    fullParentChain.map(parentEntry => [parentEntry.span.spanId, parentEntry.chainIndex])
  );
  const inDependencies = cardModel.visibleIncomingDependencyEntries;
  const fullInDependencies = cardModel.fullIncomingDependencyEntries;
  const outDependencies = cardModel.visibleOutgoingDependencyEntries;
  const fullOutDependencies = cardModel.fullOutgoingDependencyEntries;
  const endpointsWithDeps = cardModel.endpointsWithDeps;
  const {commOp, userData} = getTraceSpanUserData({
    span
  });
  const aggregateParticipants = (
    span.userData as {aggregates?: {participants?: number}} | undefined
  )?.aggregates?.participants;
  const aggregateParticipantsLabel = getAggregateParticipantsLabel({
    aggregateParticipants,
    traceLabels
  });
  const isAggregatedSpan = aggregateParticipantsLabel !== null;
  const {operation, topology} = extractCommOperationParts(commOp);
  const recvBytes = userData['recv_bytes'] as number | undefined;
  const sendBytes = userData['send_bytes'] as number | undefined;
  const hasCommBytes =
    (typeof recvBytes === 'number' && recvBytes >= 0) ||
    (typeof sendBytes === 'number' && sendBytes >= 0);
  const spanTableRows = getTraceGraphSpanArrowColumnValues(params.traceGraph, params.spanRef).map(
    entry =>
      [`${entry.tableName}.${entry.columnName}`, formatUserDataValue(entry.value)] as [
        string,
        ReactNode
      ]
  );
  const externalSpanId = getTraceGraphSpanExternalSpanId(params.traceGraph, params.spanRef);
  const spanSource = params.traceGraph.getSpanSource(params.spanRef);
  const userDataRows = Object.entries(userData)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, formatUserDataValue(value)] as [string, ReactNode]);
  const spanDataRows = [...spanTableRows, ...userDataRows];
  const spanTimings = getSpanTimingsTableRows(span, traceMinTimeMs);
  const histogramSpecs = getTraceSpanHistogramSpecs(userData, traceMinTimeMs);
  const activeTimingKey = getActiveTraceSpanTimingKey(span, params.traceSettings);
  const blockTiming = span.timings[activeTimingKey] ?? getPrimaryTiming(span);
  const aggregatedDurationSummary = isAggregatedSpan ? getAggregatedDurationSummary(span) : null;
  const dependencyDurationTimingKeys = getDependencyDurationTimingKeys(span);
  const defaultDependencyDurationTimingKeys = getDefaultDependencyDurationTimingKeys({
    span,
    activeTimingKey,
    dependencyDurationTimingKeys
  });
  const relativeStartTimeMs = Math.max(0, blockTiming.startTimeMs - traceMinTimeMs);
  const highlightedTimingColumnIndex = spanTimings?.timingKeys.indexOf(activeTimingKey) ?? -1;
  const hasDependencyTab =
    fullInDependencies.length > 0 || fullParentChain.length > 0 || visibleParentChain.length > 0;
  const hasOutgoingDependencyTab = fullOutDependencies.length > 0;
  const tabAvailability = Object.fromEntries(
    TRACE_BLOCK_CARD_TAB_ORDER.map(tab => [
      tab,
      isTraceSpanTabAvailable({
        tab,
        tabOptions,
        hasDependencyTab,
        hasOutgoingDependencyTab,
        spanTimings,
        histogramCount: histogramSpecs.length,
        userDataRowCount: spanDataRows.length,
        crossRankEndpointCount: endpointsWithDeps.length,
        hasCommBytes,
        hasCommOperation: Boolean(operation),
        hasTraversalContent: Boolean(params.hasTraversalContent)
      })
    ])
  ) as Record<TraceSpanCardTab, boolean>;
  const availableTabs = TRACE_BLOCK_CARD_TAB_ORDER.filter(tab => tabAvailability[tab]);

  return {
    cardModel,
    span,
    traceMinTimeMs,
    traceLabels,
    tabOptions,
    isAggregatedSpan,
    aggregateParticipantsLabel,
    processName: cardModel.processName,
    streamLabel: cardModel.streamLabel,
    userDataRows: spanDataRows,
    externalSpanId,
    spanSource,
    spanTimings,
    histogramSpecs,
    activeTimingKey,
    blockTiming,
    aggregatedDurationSummary,
    relativeStartTimeMs,
    highlightedTimingColumnIndex,
    dependencyDurationTimingKeys,
    defaultDependencyDurationTimingKeys,
    inDependencies,
    fullInDependencies,
    outDependencies,
    fullOutDependencies,
    fullParentChain,
    visibleParentChain,

    parentIndexBySpanId,
    endpointsWithDeps,
    hasDependencyTab,
    hasOutgoingDependencyTab,
    tabAvailability,
    availableTabs,
    operation,
    topology,
    recvBytes,
    sendBytes,
    hasCommBytes,
    hasTraversalContent: Boolean(params.hasTraversalContent)
  };
}

/**
 * Resolve optional caller input into the normalized internal tab configuration.
 */
export function resolveTraceSpanCardOptions(
  tabOptions?: TraceSpanCardTabOptions
): Required<TraceSpanCardTabOptions> {
  return {
    dependencyLabel: tabOptions?.dependencyLabel ?? 'Dependencies',
    outgoingDependencyLabel: tabOptions?.outgoingDependencyLabel ?? 'Outgoing',
    showOutgoingDependencies: tabOptions?.showOutgoingDependencies ?? false,
    alwaysShowAll: tabOptions?.alwaysShowAll ?? false,
    showChildren: tabOptions?.showChildren ?? false,
    showCrossProcessDependencies: tabOptions?.showCrossProcessDependencies ?? true,
    dependencyMetric: tabOptions?.dependencyMetric ?? 'wait',
    timingsEmptyMessage: tabOptions?.timingsEmptyMessage ?? ''
  };
}

/**
 * Parameters for the aggregate participant label helper.
 */
type AggregateParticipantsLabelParams = {
  /** Raw participant count extracted from the aggregate metadata. */
  aggregateParticipants: unknown;
  /** Resolved trace labels used to pick the singular or plural block term. */
  traceLabels: ResolvedTraceLabels;
};

/**
 * Parameters for defaulting the two dependency-table duration timing columns.
 */
type DefaultDependencyDurationTimingKeysParams = {
  /** Span whose timings seed the duration-column defaults. */
  span: TraceSpanCardModel['span'];
  /** Active timing key selected by the owning trace view. */
  activeTimingKey: string;
  /** Ordered timing keys available to duration-column pickers. */
  dependencyDurationTimingKeys: readonly string[];
};

/**
 * Parameters for extracting the cleaned span-data payload from a block.
 */
type TraceSpanUserDataParams = {
  /** Span whose userData payload should be normalized. */
  span: TraceSpanCardModel['span'];
};

/**
 * Cleaned user-data payload extracted from a TraceSpan.
 */
type TraceSpanUserData = {
  /** Communication operation name stripped out of the generic userData map. */
  commOp: string;
  /** Final userData map displayed in the Span Data tab. */
  userData: Record<string, unknown>;
};

/**
 * Parameters for resolving whether one tab is available.
 */
type TraceSpanTabAvailabilityParams = {
  /** Tab id being evaluated. */
  tab: TraceSpanCardTab;
  /** Fully resolved tab options. */
  tabOptions: Required<TraceSpanCardTabOptions>;
  /** Whether the default dependency tab has visible content. */
  hasDependencyTab: boolean;
  /** Whether the outgoing dependency tab has visible content. */
  hasOutgoingDependencyTab: boolean;
  /** Prepared timings data, when available. */
  spanTimings: TraceSpanTimingsTableData | null;
  /** Number of histogram specs available for the block. */
  histogramCount: number;
  /** Number of formatted Span Data rows available for the block. */
  userDataRowCount: number;
  /** Number of cross-rank endpoints attached to the block. */
  crossRankEndpointCount: number;
  /** Whether communication byte metadata exists for the block. */
  hasCommBytes: boolean;
  /** Whether a communication operation label exists for the block. */
  hasCommOperation: boolean;
  /** Whether caller-provided traversal content is available for this block. */
  hasTraversalContent: boolean;
};

/**
 * Resolve the active timing key used for summary display and duration-based metrics.
 */
function getActiveTraceSpanTimingKey(
  span: TraceSpanCardModel['span'],
  traceSettings: TraceVisSettings
): string {
  const aggregationTimingKey = traceSettings.timingAggregationKey;
  if (typeof aggregationTimingKey === 'string' && span.timings[aggregationTimingKey]) {
    return aggregationTimingKey;
  }
  if (span.timings[span.primaryTimingKey]) {
    return span.primaryTimingKey;
  }
  return 'default';
}

/**
 * Build the inline aggregate participant label for aggregated spans.
 */
function getAggregateParticipantsLabel(params: AggregateParticipantsLabelParams): string | null {
  if (
    typeof params.aggregateParticipants !== 'number' ||
    !Number.isFinite(params.aggregateParticipants)
  ) {
    return null;
  }

  const sourceLabel =
    params.aggregateParticipants === 1
      ? params.traceLabels.spanLabelLower
      : params.traceLabels.spanLabelPlural.toLowerCase();
  return `(${params.aggregateParticipants} source ${sourceLabel})`;
}

/**
 * Build the explicit aggregated duration metrics shown in the compact summary.
 */
function getAggregatedDurationSummary(
  span: TraceSpanCardModel['span']
): TraceSpanAggregatedDurationSummary {
  const representativeTimingKey = getTraceSpanRepresentativeTimingKey(span);
  return {
    envelopeTiming: span.timings.envelope ?? null,
    representativeTiming:
      representativeTimingKey === null ? null : (span.timings[representativeTimingKey] ?? null),
    representativeTimingKey
  };
}

/**
 * Return ordered timing keys available to duration-column pickers.
 */
function getDependencyDurationTimingKeys(span: TraceSpanCardModel['span']): readonly string[] {
  return Object.keys(span.timings).sort(compareTraceTimingKeys);
}

/**
 * Resolve default timing keys for the two duration columns.
 */
function getDefaultDependencyDurationTimingKeys(
  params: DefaultDependencyDurationTimingKeysParams
): readonly [string, string] {
  const activeTimingKey = params.span.timings[params.activeTimingKey]
    ? params.activeTimingKey
    : params.span.primaryTimingKey;
  const envelopeTimingKey = params.span.timings.envelope ? 'envelope' : activeTimingKey;
  const representativeTimingKey =
    getTraceSpanRepresentativeTimingKey(params.span) ??
    params.dependencyDurationTimingKeys.find(timingKey => timingKey !== envelopeTimingKey) ??
    'p50';

  return [envelopeTimingKey, representativeTimingKey];
}

/**
 * Resolve the preferred representative timing key for one span.
 */
function getTraceSpanRepresentativeTimingKey(
  span: TraceSpanCardModel['span']
): TraceSpanRepresentativeTimingKey | null {
  if (span.timings.mean) {
    return 'mean';
  }
  if (span.timings.p50) {
    return 'p50';
  }
  return null;
}

/**
 * Splits a communication-operation label such as `all_reduce (ring)` into display parts.
 */
function extractCommOperationParts(input: string): {operation: string; topology: string} {
  const match = input.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (!match) {
    return {operation: input.trim(), topology: ''};
  }

  return {
    operation: match[1].trim(),
    topology: match[2].trim()
  };
}

/**
 * Strip reserved fields from the stored span userData shown in the generic Span Data payload.
 */
function getTraceSpanUserData(params: TraceSpanUserDataParams): TraceSpanUserData {
  const blockUserData = {...(params.span.userData || {})};
  delete blockUserData['block_id'];
  delete blockUserData['graph_block_id'];
  const commOp = (blockUserData['comm_op.op_name'] as string) || '';
  delete blockUserData['comm_op.op_name'];

  return {
    commOp,
    userData: blockUserData
  };
}

/**
 * Decide whether a tab should be present for the current block and normalized options.
 */
function isTraceSpanTabAvailable(params: TraceSpanTabAvailabilityParams): boolean {
  switch (params.tab) {
    case 'all':
      return params.tabOptions.showChildren;
    case 'dependencies':
      return true;
    case 'outgoing-dependencies':
      return params.tabOptions.showOutgoingDependencies;
    case 'cross-rank':
      return (
        params.tabOptions.showCrossProcessDependencies &&
        (params.crossRankEndpointCount > 0 || params.hasCommBytes || params.hasCommOperation)
      );
    case 'traversal':
      return params.hasTraversalContent;
    case 'children':
      return params.tabOptions.showChildren;
    case 'histogram':
      return params.tabOptions.alwaysShowAll || params.histogramCount > 0;
    case 'timings':
      return params.tabOptions.alwaysShowAll || Boolean(params.spanTimings);
    case 'span-data':
      return params.tabOptions.alwaysShowAll || params.userDataRowCount > 0;
  }
}
