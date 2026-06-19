import {CSSProperties, useEffect, useRef, useState} from 'react';

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
import {filterTraceSpanTableRows, TraceSpanTableFilter} from './trace-span-table-filter';

import type {
  SpanRef,
  TraceCardDependency,
  TraceCardSpan,
  TraceSpanCardDescendantResult,
  TraceStyle
} from '../../../../../trace/index';
import type {TraceSpanDoubleClickAction} from '../trace-span-name-badge';
import type {
  ResolvedTraceLabels,
  TraceSpanDependencyMetricColumn,
  TraceSpanTableSpanVisibilityControl
} from './trace-span-card-types';

/**
 * Props for the child-dependencies tab content.
 */
export type TraceSpanChildrenTabProps = {
  /** Recursive descendant rows for the current block. */
  descendants: TraceSpanCardDescendantResult;
  /** Span currently shown in the card. */
  currentSpan: TraceCardSpan;
  /** Leading metric columns rendered before process and span details. */
  metricColumns: readonly TraceSpanDependencyMetricColumn[];
  /** Formatter for the leading metric columns. */
  getMetricValues: (params: {
    /** Child block whose metric value should be displayed. */
    span: TraceCardSpan;
    /** Dependency associated with the child row. */
    dependency: TraceCardDependency;
    /** Logical row kind for metric resolution. */
    rowKind: 'child';
  }) => string[];
  /** Optional filtered-span selector rendered in the span column header. */
  spanVisibilityControl?: TraceSpanTableSpanVisibilityControl | null;
  /** Badge-style resolver for child target spans. */
  getDependencyBadgeStyle: (dependencySpan: TraceCardSpan) => CSSProperties;
  /** Callback when a child block badge is clicked. */
  onSpanClick?: (spanRef: SpanRef) => void;
  /** Callback when a child block badge is double-clicked. */
  onSpanDoubleClick?: (spanRef: SpanRef, action: TraceSpanDoubleClickAction) => void;
  /** Callback when dependency hover should highlight another block. */
  onBlockHover?: (spanRef: SpanRef | null) => void;
  /** Resolved labels for process and block columns. */
  traceLabels: ResolvedTraceLabels;
  /** Active trace style for dependency badges. */
  traceStyle: TraceStyle;
  /** Whether the table should manage its own scrolling container. */
  scrollable?: boolean;
};

/**
 * Render the visible child-dependencies table for the Children tab.
 */
export function TraceSpanChildrenTab(props: TraceSpanChildrenTabProps) {
  const [filterText, setFilterText] = useState('');
  const filterSpanRef = useRef(props.currentSpan.spanRef);

  useEffect(() => {
    if (filterSpanRef.current === props.currentSpan.spanRef) {
      return;
    }
    filterSpanRef.current = props.currentSpan.spanRef;
    setFilterText('');
  }, [props.currentSpan.spanRef]);

  const filteredEntries = filterTraceSpanTableRows(
    props.descendants.entries,
    filterText,
    getTraceSpanChildFilterValues
  );
  const hasFilter = filterText.trim().length > 0;
  const rows = filteredEntries.map(({dependency, startSpan, endSpan, childSpan, depth}) => {
    const isFiltered = childSpan.isFiltered;
    const isTopologyOnlyFiltered =
      hasTraceSpanTopologyFilter(childSpan.filterMask) &&
      !hasTraceSpanRegexpFilter(childSpan.filterMask);
    const depthOffsetRem = Math.min(3, Math.max(0, (depth - 1) * 0.75));
    const hoverHandlers = props.onBlockHover
      ? {
          onMouseEnter: () =>
            emitDependencyHoverFromResolvedBlocks({
              startSpan,
              endSpan,
              onBlockHover: props.onBlockHover
            }),
          onMouseLeave: () => props.onBlockHover?.(null)
        }
      : undefined;

    return [
      ...props.getMetricValues({
        span: childSpan,
        dependency,
        rowKind: 'child'
      }),
      renderDependencyProcessBadge({
        span: childSpan,
        currentSpan: props.currentSpan,
        traceLabels: props.traceLabels
      }),
      <span className="inline-flex" {...hoverHandlers}>
        <span
          className="inline-flex items-center"
          style={{paddingLeft: `${depthOffsetRem}rem`}}
          data-child-depth={depth}
        >
          {renderDependencyNameBadge({
            span: childSpan,
            colorScheme: props.traceStyle.colorScheme,
            style: props.getDependencyBadgeStyle(childSpan),
            interactive: !isFiltered || props.onSpanDoubleClick !== undefined,
            filtered: isFiltered,
            filteredVariant: isTopologyOnlyFiltered ? 'topology' : 'regexp',
            filterMask: childSpan.filterMask,
            onSpanClick: isFiltered ? undefined : props.onSpanClick,
            onSpanDoubleClick: props.onSpanDoubleClick
          })}
        </span>
      </span>,
      dependency.waitMode,
      '⬇️'
    ];
  });

  if (props.descendants.isTruncated) {
    rows.push(
      buildPlaceholderRow(
        props.metricColumns.length,
        `Showing first ${props.descendants.limit} descendants; ${props.descendants.truncatedCount} more omitted`
      )
    );
  }
  const headers = [
    ...props.metricColumns.map(renderDependencyMetricHeader),
    props.traceLabels.processLabel,
    renderDependencySpanHeader({
      spanLabel: props.traceLabels.spanLabel,
      spanLabelPlural: props.traceLabels.spanLabelPlural,
      spanVisibilityControl: props.spanVisibilityControl
    }),
    'Mode',
    'Dir'
  ];

  return (
    <div className={`flex min-h-0 flex-col pr-1 ${props.scrollable === false ? '' : 'h-full'}`}>
      <TraceSpanTableFilter
        filterLabel="Filter children"
        filterText={filterText}
        onFilterTextChange={setFilterText}
        filteredRowCount={filteredEntries.length}
        rowCount={props.descendants.entries.length}
      />
      {!hasFilter || filteredEntries.length > 0 ? (
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
          No children match the current filter.
        </div>
      )}
    </div>
  );
}

/**
 * Returns visible child-row values searched by the Children tab filter.
 */
function getTraceSpanChildFilterValues(
  entry: TraceSpanCardDescendantResult['entries'][number]
): readonly (string | number)[] {
  return [
    entry.childSpan.name,
    entry.childSpan.spanId,
    entry.childSpan.processName,
    entry.childSpan.threadId,
    entry.dependency.waitMode,
    entry.depth
  ];
}

/**
 * Build one compact placeholder row aligned with the child dependency table columns.
 */
function buildPlaceholderRow(metricColumnCount: number, message: string): string[] {
  return [...Array.from({length: metricColumnCount}, () => ''), '', message, '', ''];
}
