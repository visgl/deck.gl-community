import {CopyIcon} from 'lucide-react';

import {PrettyTable} from '../../components/pretty-table';

import type {MouseEvent, ReactNode} from 'react';

/**
 * Props for the generic Span Data tab content.
 */
export type TraceSpanSpanDataTabProps = {
  rows: [string, ReactNode][];
};

/**
 * Props for rendering a stable external span id with a copy affordance.
 */
export type TraceSpanExternalSpanIdValueProps = {
  /** Stable external span id copied into URL `spanIds`. */
  value: string;
};

/**
 * Render the generic key/value span-data table.
 */
export function TraceSpanSpanDataTab(props: TraceSpanSpanDataTabProps) {
  const rows = props.rows.map(
    ([key, value]) => [key, renderTraceSpanDataValue(key, value)] as [string, ReactNode]
  );

  return (
    <div className="h-full overflow-auto [&>small]:block [&>small]:w-full [&_table]:w-full">
      <PrettyTable headers={['Key', 'Value']} rows={rows} />
    </div>
  );
}

/**
 * Render an external span id with a copy button revealed on hover or keyboard focus.
 */
export function TraceSpanExternalSpanIdValue(props: TraceSpanExternalSpanIdValueProps) {
  const handleCopyClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard?.writeText(props.value);
  };

  return (
    <span className="group inline-flex max-w-full items-center gap-1 align-middle">
      <span className="min-w-0 break-all font-mono">{props.value}</span>
      <button
        type="button"
        aria-label="Copy external_span_id"
        title="Copy external_span_id"
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
        onClick={handleCopyClick}
      >
        <CopyIcon aria-hidden="true" className="h-3 w-3" />
      </button>
    </span>
  );
}

/**
 * Render special Span Data values that need span-inspector affordances.
 */
function renderTraceSpanDataValue(key: string, value: ReactNode): ReactNode {
  if (isExternalSpanIdDataRowKey(key) && typeof value === 'string' && value !== 'null') {
    return <TraceSpanExternalSpanIdValue value={value} />;
  }

  return value;
}

/**
 * Returns whether one Span Data row carries the stable external span id column.
 */
function isExternalSpanIdDataRowKey(key: string): boolean {
  return key === 'external_span_id' || key === 'spanTable.external_span_id';
}
