import {CSSProperties, useEffect, useMemo, useRef, useState} from 'react';

import {hasTraceSpanRegexpFilter, hasTraceSpanTopologyFilter} from '../../../../../trace/index';
import {PrettyTable} from '../../components/pretty-table';
import {
  emitDependencyHoverFromResolvedBlocks,
  getDependencyTableColumnClassNames,
  renderDependencyMetricHeader,
  renderDependencyNameBadge,
  renderDependencyProcessBadge,
  renderDependencySpanHeader
} from './trace-span-card-dependency-shared';
import {MAX_PARENT_CHAIN_ROWS} from './trace-span-card-types';
import {filterTraceSpanTableRows, TraceSpanTableFilter} from './trace-span-table-filter';

import type {
  SpanRef,
  TraceCardSpan,
  TraceDependency,
  TraceSpanCardDependencyEntry,
  TraceSpanCardParentChainEntry,
  TraceStyle
} from '../../../../../trace/index';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {
  ResolvedTraceLabels,
  TraceSpanDependencyMetricColumn,
  TraceSpanTableSpanVisibilityControl
} from './trace-span-card-types';

/**
 * Props for the dependency tab content used by both dependency tabs.
 */
export type TraceSpanDependenciesTabProps = {
  /** Directional dependencies to render before parent-chain rows. */
  dependencies: TraceSpanCardDependencyEntry[];
  /** Total directional dependency count before card row capping. */
  dependencyCount?: number;
  /** Whether directional dependency rows were capped before card render. */
  dependenciesTruncated?: boolean;
  /** Whether dependency rows should show incoming sources or outgoing targets. */
  direction?: 'incoming' | 'outgoing';
  /** Span currently shown in the card. */
  currentSpan: TraceCardSpan;
  /** Parent-chain rows to append after direct dependency rows. */
  parentChain: readonly TraceSpanCardParentChainEntry[];
  /** One-based lookup for parent positions in the full parent chain. */
  parentIndexBySpanRef: ReadonlyMap<SpanRef, number>;
  /** Leading metric columns rendered before process and span details. */
  metricColumns: readonly TraceSpanDependencyMetricColumn[];
  /** Formatter for the leading metric columns across row kinds. */
  getMetricValues: (params: {
    /** Block whose metric value should be displayed. */
    span: TraceCardSpan;
    /** Dependency associated with the row, when the row is an edge. */
    dependency: TraceDependency | null;
    /** Logical row kind for metric resolution. */
    rowKind: 'dependency' | 'parent';
  }) => string[];
  /** Optional filtered-span selector rendered in the span column header. */
  spanVisibilityControl?: TraceSpanTableSpanVisibilityControl | null;
  /** Optional label enabling one compact row filter above the rendered table. */
  filterLabel?: string | null;
  /** Badge-style resolver for dependency target spans. */
  getDependencyBadgeStyle: (dependencySpan: TraceCardSpan) => CSSProperties;
  /** Whether the rendered table should expose interactive controls. */
  interactive?: boolean;
  /** Callback when a block badge is clicked. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when a block badge is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Callback when dependency hover should highlight another block. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
  /** Callback when the dependency action column is clicked. */
  onDependencyClick?: (targetSpanRef: SpanRef) => void;
  /** Resolved labels for process and block columns. */
  traceLabels: ResolvedTraceLabels;
  /** Active trace style for dependency badges. */
  traceStyle: TraceStyle;
  /** Whether the table should manage its own scrolling container. */
  scrollable?: boolean;
};

/**
 * Render the shared dependency-tab table, including visible parent-chain rows.
 */
export function TraceSpanDependenciesTab(props: TraceSpanDependenciesTabProps) {
  const {parentChain, interactive, traceLabels, currentSpan, traceStyle} = props;
  const direction = props.direction ?? 'incoming';
  const [filterText, setFilterText] = useState('');
  const filterSpanRef = useRef(props.currentSpan.spanRef);

  const dependencies = useMemo(() => {
    const parentSpanRefSet = new Set(parentChain.map(entry => entry.spanRef));
    return direction === 'incoming'
      ? props.dependencies.filter(entry => !parentSpanRefSet.has(entry.startSpanRef))
      : props.dependencies;
  }, [direction, parentChain, props.dependencies]);
  const filteredDependencies = props.filterLabel
    ? filterTraceSpanTableRows(dependencies, filterText, entry =>
        getTraceSpanDependencyFilterValues(entry, direction, props.getMetricValues)
      )
    : dependencies;
  const filteredParentChain = props.filterLabel
    ? filterTraceSpanTableRows(parentChain, filterText, chainEntry =>
        getTraceSpanParentFilterValues(
          chainEntry,
          props.parentIndexBySpanRef.get(chainEntry.spanRef) ?? chainEntry.chainIndex,
          props.getMetricValues
        )
      )
    : parentChain;
  const hasFilter = filterText.trim().length > 0;
  const dependencyCount = props.dependencyCount ?? dependencies.length;
  const filteredRowCount = filteredDependencies.length + filteredParentChain.length;
  const rowCount = dependencies.length + parentChain.length;

  useEffect(() => {
    if (filterSpanRef.current === props.currentSpan.spanRef) {
      return;
    }
    filterSpanRef.current = props.currentSpan.spanRef;
    setFilterText('');
  }, [props.currentSpan.spanRef]);

  let dependencyRows = filteredDependencies
    .map(entry => {
      const dependencySpan = direction === 'incoming' ? entry.startSpan : entry.endSpan;
      const dependencySpanRef = direction === 'incoming' ? entry.startSpanRef : entry.endSpanRef;
      const isFilteredDependencySource = dependencySpan.isFiltered;
      const isTopologyOnlyFilteredDependencySource =
        hasTraceSpanTopologyFilter(dependencySpan.filterMask) &&
        !hasTraceSpanRegexpFilter(dependencySpan.filterMask);
      const hoverHandlers =
        !isFilteredDependencySource && props.onBlockHover
          ? {
              onMouseEnter: () =>
                emitDependencyHoverFromResolvedBlocks({
                  startSpan: entry.startSpan,
                  endSpan: entry.endSpan,
                  onBlockHover: props.onBlockHover
                }),
              onMouseLeave: () => props.onBlockHover?.(null)
            }
          : undefined;

      return [
        ...props.getMetricValues({
          span: dependencySpan,
          dependency: entry.dependency,
          rowKind: 'dependency'
        }),
        renderDependencyProcessBadge({
          span: dependencySpan,
          currentSpan,
          traceLabels
        }),
        <span className="inline-flex" {...hoverHandlers}>
          {renderDependencyNameBadge({
            span: dependencySpan,
            colorScheme: traceStyle.colorScheme,
            style: props.getDependencyBadgeStyle(dependencySpan),
            filtered: isFilteredDependencySource,
            filteredVariant: isTopologyOnlyFilteredDependencySource ? 'topology' : 'regexp',
            filterMask: dependencySpan.filterMask,
            interactive:
              props.interactive &&
              (!isFilteredDependencySource || props.onSpanDoubleClick !== undefined),
            onSpanClick: isFilteredDependencySource ? undefined : props.onSpanClick,
            onSpanDoubleClick: props.onSpanDoubleClick
          })}
        </span>,
        entry.dependency.waitMode,
        entry.dependency.bidirectional ? '↔️' : '➡️',
        isFilteredDependencySource ? (
          ''
        ) : (
          <button
            className="pointer-events-auto"
            onClick={() => props.onDependencyClick?.(dependencySpanRef)}
          />
        )
      ];
    })
    .filter(fields => fields !== null);

  let parentChainRows = [...filteredParentChain]
    .map((chainEntry, index) => {
      const isVisibleParent = !chainEntry.isFiltered;
      const isTopologyOnlyFilteredParent =
        hasTraceSpanTopologyFilter(chainEntry.span.filterMask) &&
        !hasTraceSpanRegexpFilter(chainEntry.span.filterMask);
      const parentIndex = props.parentIndexBySpanRef.get(chainEntry.spanRef) ?? index + 1;
      return [
        ...props.getMetricValues({
          span: chainEntry.span,
          dependency: null,
          rowKind: 'parent'
        }),
        renderDependencyProcessBadge({
          span: chainEntry.span,
          currentSpan,
          traceLabels
        }),
        <span className="inline-flex items-center">
          {renderDependencyNameBadge({
            span: chainEntry.span,
            colorScheme: traceStyle.colorScheme,
            style: props.getDependencyBadgeStyle(chainEntry.span),
            filtered: !isVisibleParent,
            filteredVariant: isTopologyOnlyFilteredParent ? 'topology' : 'regexp',
            filterMask: chainEntry.span.filterMask,
            interactive:
              props.interactive && (isVisibleParent || props.onSpanDoubleClick !== undefined),
            onSpanClick: isVisibleParent ? props.onSpanClick : undefined,
            onSpanDoubleClick: props.onSpanDoubleClick
          })}
        </span>,
        `parent-${parentIndex}`,
        '⬆️',
        ''
      ];
    })
    .filter(Boolean);

  if (!interactive && parentChainRows.length > 0) {
    const firstVisibleParentIndex =
      props.parentIndexBySpanRef.get(filteredParentChain[0]!.spanRef) ?? 1;
    const hiddenLeadingParentCount = Math.max(0, firstVisibleParentIndex - 1);
    const hiddenLeadingRow =
      hiddenLeadingParentCount > 0
        ? buildPlaceholderRow(
            props.metricColumns.length,
            `omitting ${hiddenLeadingParentCount} hidden parent spans`
          )
        : null;

    if (parentChainRows.length > MAX_PARENT_CHAIN_ROWS) {
      const immediateParentRows = parentChainRows.slice(0, MAX_PARENT_CHAIN_ROWS - 1);
      const omittedParentCount = parentChainRows.length - immediateParentRows.length;
      parentChainRows = [
        ...(hiddenLeadingRow ? [hiddenLeadingRow] : []),
        ...immediateParentRows,
        buildPlaceholderRow(
          props.metricColumns.length,
          `omitted ${omittedParentCount} parent spans`
        )
      ];
    } else if (hiddenLeadingRow) {
      parentChainRows = [hiddenLeadingRow, ...parentChainRows];
    }
  }

  if (!interactive && dependencyCount > 3 && dependencyRows.length > 0) {
    dependencyRows = [
      dependencyRows[0],
      buildPlaceholderRow(
        props.metricColumns.length,
        `...omitted ${dependencyCount - 2} dependencies`
      ),
      dependencyRows[dependencyRows.length - 1]
    ];
  }

  const rows = [...dependencyRows, ...parentChainRows];
  const headers = [
    ...props.metricColumns.map(renderDependencyMetricHeader),
    traceLabels.processLabel,
    renderDependencySpanHeader({
      spanLabel: traceLabels.spanLabel,
      spanLabelPlural: traceLabels.spanLabelPlural,
      spanVisibilityControl: props.spanVisibilityControl
    }),
    'Mode',
    'Dir'
  ];

  return (
    <div className={`flex min-h-0 flex-col pr-1 ${props.scrollable === false ? '' : 'h-full'}`}>
      {props.filterLabel ? (
        <TraceSpanTableFilter
          filterLabel={props.filterLabel}
          filterText={filterText}
          onFilterTextChange={setFilterText}
          filteredRowCount={filteredRowCount}
          rowCount={rowCount}
        />
      ) : null}
      {interactive && props.dependenciesTruncated && !hasFilter ? (
        <div className="pb-1 text-xs text-muted-foreground">
          Showing {props.dependencies.length} of {dependencyCount} dependencies
        </div>
      ) : null}
      {!props.filterLabel || !hasFilter || rows.length > 0 ? (
        <div
          className={`[&>small]:block [&>small]:w-full [&_table]:w-full ${
            props.scrollable === false ? '' : 'min-h-0 flex-1 overflow-y-auto'
          }`}
        >
          <PrettyTable
            headers={headers}
            rows={rows as string[][]}
            stickyHeader
            columnClassNames={getDependencyTableColumnClassNames(props.metricColumns)}
          />
        </div>
      ) : (
        <div className="px-2 py-3 text-xs text-muted-foreground">
          No parents match the current filter.
        </div>
      )}
    </div>
  );
}

/**
 * Returns displayed dependency-row values searched by the Parents filter.
 */
function getTraceSpanDependencyFilterValues(
  entry: TraceSpanCardDependencyEntry,
  direction: 'incoming' | 'outgoing',
  getMetricValues: TraceSpanDependenciesTabProps['getMetricValues']
): readonly (boolean | number | string)[] {
  const dependencySpan = direction === 'incoming' ? entry.startSpan : entry.endSpan;
  return [
    ...getMetricValues({
      span: dependencySpan,
      dependency: entry.dependency,
      rowKind: 'dependency'
    }),
    dependencySpan.name,
    dependencySpan.spanId,
    dependencySpan.processName,
    dependencySpan.threadId,
    entry.dependency.waitMode,
    entry.dependency.bidirectional,
    direction
  ];
}

/**
 * Returns displayed parent-row values searched by the Parents filter.
 */
function getTraceSpanParentFilterValues(
  chainEntry: TraceSpanCardParentChainEntry,
  parentIndex: number,
  getMetricValues: TraceSpanDependenciesTabProps['getMetricValues']
): readonly (number | string)[] {
  return [
    ...getMetricValues({
      span: chainEntry.span,
      dependency: null,
      rowKind: 'parent'
    }),
    chainEntry.span.name,
    chainEntry.span.spanId,
    chainEntry.span.processName,
    chainEntry.span.threadId,
    `parent-${parentIndex}`,
    parentIndex
  ];
}

/**
 * Build one compact placeholder row aligned with the dependency table columns.
 */
function buildPlaceholderRow(metricColumnCount: number, message: string): string[] {
  return [...Array.from({length: metricColumnCount}, () => ''), '', message, '', ''];
}
