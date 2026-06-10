import {useId} from 'react';
import {Search, X} from 'lucide-react';

import type {KeyboardEvent} from 'react';

/** Searchable primitive value accepted by span-inspector table filters. */
export type TraceSpanTableFilterValue = boolean | bigint | number | string | null | undefined;

/** Props for one compact span-inspector table filter input. */
export type TraceSpanTableFilterProps = {
  /** Accessible label and placeholder describing the rows filtered by the input. */
  filterLabel: string;
  /** Current raw filter text entered by the user. */
  filterText: string;
  /** Callback fired when the raw filter text changes. */
  onFilterTextChange: (filterText: string) => void;
  /** Number of currently visible rows after applying the filter. */
  filteredRowCount: number;
  /** Number of loaded rows available before applying the filter. */
  rowCount: number;
};

/**
 * Renders one compact text filter for a dense span-inspector table.
 */
export function TraceSpanTableFilter(props: TraceSpanTableFilterProps) {
  const filterInputId = useId();
  const hasFilter = props.filterText.trim().length > 0;

  return (
    <div className="shrink-0 px-1 pb-1">
      <label className="sr-only" htmlFor={filterInputId}>
        {props.filterLabel}
      </label>
      <div className="flex h-7 items-center gap-1 rounded-md border border-border bg-background px-1 text-xs">
        <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          id={filterInputId}
          type="search"
          value={props.filterText}
          aria-label={props.filterLabel}
          placeholder={props.filterLabel}
          className="h-full min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
          onChange={event => props.onFilterTextChange(event.currentTarget.value)}
          onKeyDown={event => clearTraceSpanTableFilterOnEscape(event, props)}
        />
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
          {props.filteredRowCount.toLocaleString()} / {props.rowCount.toLocaleString()}
        </span>
        {hasFilter ? (
          <button
            type="button"
            className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Clear ${props.filterLabel.toLowerCase()}`}
            onClick={() => props.onFilterTextChange('')}
          >
            <X aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Filters loaded rows when every whitespace-delimited filter term appears in one row value.
 */
export function filterTraceSpanTableRows<T>(
  rows: readonly T[],
  filterText: string,
  getSearchValues: (row: T) => readonly TraceSpanTableFilterValue[]
): readonly T[] {
  const filterTerms = getTraceSpanTableFilterTerms(filterText);
  if (filterTerms.length === 0) {
    return rows;
  }

  return rows.filter(row => {
    const searchText = getTraceSpanTableSearchText(getSearchValues(row));
    return filterTerms.every(filterTerm => searchText.includes(filterTerm));
  });
}

/**
 * Clears one active table filter when the focused filter input receives Escape.
 */
function clearTraceSpanTableFilterOnEscape(
  event: KeyboardEvent<HTMLInputElement>,
  props: TraceSpanTableFilterProps
): void {
  if (event.key !== 'Escape' || props.filterText.length === 0) {
    return;
  }
  event.preventDefault();
  props.onFilterTextChange('');
}

/**
 * Splits raw filter text into normalized case-insensitive match terms.
 */
function getTraceSpanTableFilterTerms(filterText: string): string[] {
  return filterText.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Concatenates one row's searchable values into a normalized match string.
 */
function getTraceSpanTableSearchText(values: readonly TraceSpanTableFilterValue[]): string {
  return values
    .filter(value => value !== null && value !== undefined)
    .map(value => String(value).toLowerCase())
    .join(' ');
}
