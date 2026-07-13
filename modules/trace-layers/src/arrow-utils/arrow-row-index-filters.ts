import {
  getArrowUtf8ColumnSource,
  getUtf8ColumnSourceRowView,
  makeUtf8StringView,
  utf8StringViewsEqual
} from '@deck.gl-community/infovis-layers';

import type {Utf8ColumnSource, Utf8StringView} from '@deck.gl-community/infovis-layers';
import type * as arrow from 'apache-arrow';

/** Numeric range filter used by SQL-style Arrow row filtering. */
export type ArrowSqlRangeFilter = {
  /** Inclusive lower bound for numeric values. */
  min?: number | null;
  /** Inclusive upper bound for numeric values. */
  max?: number | null;
};

/** One SQL-style column filter entry applied against Arrow row values. */
export type ArrowSqlColumnFilter = readonly string[] | ArrowSqlRangeFilter | null | undefined;

/** SQL-style filter map keyed by Arrow row field name. */
export type ArrowSqlFilter = Record<string, ArrowSqlColumnFilter>;

/** Exact-any scalar filter evaluated against one Arrow column. */
export type ArrowNativeExactFilter = {
  /** Arrow column name to read. */
  columnName: string;
  /** SQL-facing exact values accepted for the column. */
  values: readonly string[];
};

/** Numeric inclusive range filter evaluated against one Arrow column. */
export type ArrowNativeRangeFilter = {
  /** Arrow column name to read. */
  columnName: string;
  /** Inclusive lower bound for numeric values. */
  min?: number | null;
  /** Inclusive upper bound for numeric values. */
  max?: number | null;
};

/** One native Arrow column filter descriptor. */
export type ArrowNativeColumnFilter = ArrowNativeExactFilter | ArrowNativeRangeFilter;

/** Minimal Arrow-like row-access contract needed by row-index filtering. */
export type ArrowRowFilterTable<TRow extends object = object> = {
  /** Total number of rows in the authoritative table. */
  numRows: number;
  /** Resolves one row object by row index for legacy row-only tables. */
  get: (rowIndex: number) => TRow | null | undefined;
  /** Resolves one column value without materializing a row object. */
  getValue?: (rowIndex: number, columnName: any) => unknown;
  /** Resolves one child vector without materializing a row object. */
  getChild?: (columnName: any) => ArrowVectorLike | null | undefined;
  /** Resolves one raw backing-row index for indexed views. */
  getRawIndex?: (rowIndex: number) => number | null;
  /** Resolves one raw-row UTF-8 source for a backing string column. */
  getUtf8ColumnSource?: (columnName: any) => Utf8ColumnSource | null;
};

/** Predicate evaluated against one row of an Arrow-like table. */
export type ArrowRowPredicate<TTable extends ArrowRowFilterTable> = (
  table: TTable,
  rowIndex: number
) => boolean;

/** Comparator used to sort two row indexes from the same Arrow-like table. */
export type ArrowRowIndexComparator<TTable extends ArrowRowFilterTable> = (
  table: TTable,
  leftRowIndex: number,
  rightRowIndex: number
) => number;

/** Options controlling native Arrow column filtering. */
export type ArrowNativeRowIndexFilterOptions<TTable extends ArrowRowFilterTable> = {
  /** Optional candidate row indexes. Defaults to all visible table rows. */
  rowIndexes?: readonly number[] | Int32Array;
  /** Column-native filters compiled once before scanning candidates. */
  filters?: readonly ArrowNativeColumnFilter[];
  /** Optional additional columnar predicates. */
  predicates?: readonly ArrowRowPredicate<TTable>[];
  /** Optional comparator applied before limiting. */
  compareRows?: ArrowRowIndexComparator<TTable>;
  /** Optional maximum result count. */
  limit?: number;
};

/** Options controlling SQL-compatible Arrow row-index filtering. */
export type ArrowRowIndexFilterOptions<TTable extends ArrowRowFilterTable> = {
  /** Optional prefiltered row indexes. Defaults to all table rows. */
  rowIndexes?: readonly number[] | Int32Array;
  /** Optional SQL-style filter map keyed by column name. */
  sqlFilter?: ArrowSqlFilter | undefined;
  /** Optional additional predicates evaluated after SQL-style filtering. */
  predicates?: readonly ArrowRowPredicate<TTable>[];
  /** Optional comparator applied after filtering and before limiting. */
  compareRows?: ArrowRowIndexComparator<TTable> | undefined;
  /** Optional limit applied after filtering. */
  limit?: number | undefined;
};

/** Returns every row index from an Arrow-like table. */
export function getArrowRowIndexes(table: ArrowRowFilterTable): readonly number[] {
  return Array.from({length: table.numRows}, (_, rowIndex) => rowIndex);
}

/**
 * Filters Arrow row indexes through column-native accessors without materializing rows when the
 * table exposes columns.
 */
export function filterArrowTableRowIndexes<TTable extends ArrowRowFilterTable>(
  table: TTable,
  options: ArrowNativeRowIndexFilterOptions<TTable> = {}
): Int32Array {
  const rowIndexes = options.rowIndexes ?? getArrowRowIndexes(table);
  const predicates = options.predicates ?? [];
  const matchers = (options.filters ?? [])
    .filter(isActiveNativeFilter)
    .map(filter => compileNativeMatcher(table, filter));
  const normalizedLimit = normalizeLimit(options.limit);
  if (normalizedLimit === 0) {
    return new Int32Array();
  }

  const matchesRow = (rowIndex: number) => {
    let fallbackRow: object | null | undefined;
    const readValue = (columnName: string) => {
      if (typeof table.getValue === 'function') {
        return table.getValue(rowIndex, columnName);
      }
      const child = table.getChild?.(columnName);
      if (child) {
        return child.get(rowIndex);
      }
      fallbackRow ??= table.get(rowIndex);
      return fallbackRow ? (fallbackRow as Record<string, unknown>)[columnName] : undefined;
    };

    if (!hasColumnAccess(table) && !table.get(rowIndex)) {
      return false;
    }
    if (!matchers.every(matcher => matcher(rowIndex, readValue))) {
      return false;
    }
    return predicates.every(predicate => predicate(table, rowIndex));
  };

  if (!options.compareRows) {
    const matches: number[] = [];
    for (const rowIndex of rowIndexes) {
      if (!matchesRow(rowIndex)) {
        continue;
      }
      matches.push(rowIndex);
      if (normalizedLimit !== undefined && matches.length >= normalizedLimit) {
        break;
      }
    }
    return Int32Array.from(matches);
  }

  if (normalizedLimit === undefined) {
    const matches = Array.from(rowIndexes).filter(matchesRow);
    matches.sort((left, right) => options.compareRows!(table, left, right));
    return Int32Array.from(matches);
  }

  return getTopKRowIndexes(table, rowIndexes, matchesRow, options.compareRows, normalizedLimit);
}

/**
 * Filters Arrow row indexes using SQL-style filters while delegating to native column filtering.
 */
export function getFilteredArrowRowIndexes<TTable extends ArrowRowFilterTable>(
  table: TTable,
  options: ArrowRowIndexFilterOptions<TTable> = {}
): readonly number[] {
  return Array.from(
    filterArrowTableRowIndexes(table, {
      rowIndexes: options.rowIndexes,
      filters: buildNativeFiltersFromSqlFilter(options.sqlFilter),
      predicates: options.predicates,
      compareRows: options.compareRows,
      limit: options.limit
    })
  );
}

type ArrowVectorLike = {
  /** Resolves one column value by row index. */
  get: (rowIndex: number) => unknown;
  /** Optional Arrow runtime type used for UTF-8 detection. */
  type?: unknown;
};

type NativeMatcher = (rowIndex: number, readValue: (columnName: string) => unknown) => boolean;

type RankedRow = {
  /** Visible row index retained in the bounded result heap. */
  rowIndex: number;
  /** Original candidate order used to preserve stable comparator ties. */
  ordinal: number;
};

function buildNativeFiltersFromSqlFilter(
  sqlFilter: ArrowSqlFilter | undefined
): ArrowNativeColumnFilter[] {
  if (!sqlFilter) {
    return [];
  }
  const filters: ArrowNativeColumnFilter[] = [];
  for (const [columnName, values] of Object.entries(sqlFilter)) {
    if (!values) {
      continue;
    }
    if (Array.isArray(values)) {
      if (values.length > 0) {
        filters.push({columnName, values});
      }
      continue;
    }
    const range = values as ArrowSqlRangeFilter;
    filters.push({columnName, min: range.min, max: range.max});
  }
  return filters;
}

function isActiveNativeFilter(filter: ArrowNativeColumnFilter): boolean {
  return 'values' in filter
    ? filter.values.length > 0
    : filter.min !== undefined || filter.max !== undefined;
}

function compileNativeMatcher<TTable extends ArrowRowFilterTable>(
  table: TTable,
  filter: ArrowNativeColumnFilter
): NativeMatcher {
  if ('values' in filter) {
    const utf8Source = getTableUtf8ColumnSource(table, filter.columnName);
    if (utf8Source) {
      const targetViews = filter.values.map(makeUtf8StringView);
      const rowView: Utf8StringView = {data: new Uint8Array(), start: 0, end: 0};
      return rowIndex => {
        const rawRowIndex = table.getRawIndex?.(rowIndex) ?? rowIndex;
        return (
          rawRowIndex !== null &&
          getUtf8ColumnSourceRowView(utf8Source, rawRowIndex, rowView) &&
          targetViews.some(targetView => utf8StringViewsEqual(rowView, targetView))
        );
      };
    }
    const acceptedValues = new Set(filter.values);
    return (_rowIndex, readValue) =>
      doesArrowRowValueMatchFilter(readValue(filter.columnName), acceptedValues);
  }

  return (_rowIndex, readValue) => {
    const rowValue = Number(readValue(filter.columnName));
    if (!Number.isFinite(rowValue)) {
      return false;
    }
    if (filter.min !== undefined && filter.min !== null && rowValue < filter.min) {
      return false;
    }
    if (filter.max !== undefined && filter.max !== null && rowValue > filter.max) {
      return false;
    }
    return true;
  };
}

function getTableUtf8ColumnSource(
  table: ArrowRowFilterTable,
  columnName: string
): Utf8ColumnSource | null {
  const indexedSource = table.getUtf8ColumnSource?.(columnName);
  if (indexedSource) {
    return indexedSource;
  }
  const child = table.getChild?.(columnName);
  if (!child) {
    return null;
  }
  return getArrowUtf8ColumnSource(child as arrow.Vector<arrow.Utf8>);
}

function hasColumnAccess(table: ArrowRowFilterTable): boolean {
  return typeof table.getValue === 'function' || typeof table.getChild === 'function';
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined || !Number.isFinite(limit)) {
    return undefined;
  }
  return Math.max(0, Math.floor(limit));
}

function getTopKRowIndexes<TTable extends ArrowRowFilterTable>(
  table: TTable,
  rowIndexes: readonly number[] | Int32Array,
  matchesRow: (rowIndex: number) => boolean,
  compareRows: ArrowRowIndexComparator<TTable>,
  limit: number
): Int32Array {
  const heap: RankedRow[] = [];
  let ordinal = 0;
  for (const rowIndex of rowIndexes) {
    const candidate = {rowIndex, ordinal};
    ordinal += 1;
    if (!matchesRow(rowIndex)) {
      continue;
    }
    if (heap.length < limit) {
      heap.push(candidate);
      siftHeapUp(table, heap, heap.length - 1, compareRows);
      continue;
    }
    if (compareRankedRows(table, candidate, heap[0]!, compareRows) < 0) {
      heap[0] = candidate;
      siftHeapDown(table, heap, 0, compareRows);
    }
  }
  heap.sort((left, right) => compareRankedRows(table, left, right, compareRows));
  return Int32Array.from(heap, entry => entry.rowIndex);
}

function siftHeapUp<TTable extends ArrowRowFilterTable>(
  table: TTable,
  heap: RankedRow[],
  startIndex: number,
  compareRows: ArrowRowIndexComparator<TTable>
): void {
  let childIndex = startIndex;
  while (childIndex > 0) {
    const parentIndex = Math.floor((childIndex - 1) / 2);
    if (compareRankedRows(table, heap[parentIndex]!, heap[childIndex]!, compareRows) >= 0) {
      return;
    }
    [heap[parentIndex], heap[childIndex]] = [heap[childIndex]!, heap[parentIndex]!];
    childIndex = parentIndex;
  }
}

function siftHeapDown<TTable extends ArrowRowFilterTable>(
  table: TTable,
  heap: RankedRow[],
  startIndex: number,
  compareRows: ArrowRowIndexComparator<TTable>
): void {
  let parentIndex = startIndex;
  while (true) {
    const leftIndex = parentIndex * 2 + 1;
    const rightIndex = leftIndex + 1;
    let worstIndex = parentIndex;
    if (
      leftIndex < heap.length &&
      compareRankedRows(table, heap[leftIndex]!, heap[worstIndex]!, compareRows) > 0
    ) {
      worstIndex = leftIndex;
    }
    if (
      rightIndex < heap.length &&
      compareRankedRows(table, heap[rightIndex]!, heap[worstIndex]!, compareRows) > 0
    ) {
      worstIndex = rightIndex;
    }
    if (worstIndex === parentIndex) {
      return;
    }
    [heap[parentIndex], heap[worstIndex]] = [heap[worstIndex]!, heap[parentIndex]!];
    parentIndex = worstIndex;
  }
}

function compareRankedRows<TTable extends ArrowRowFilterTable>(
  table: TTable,
  left: RankedRow,
  right: RankedRow,
  compareRows: ArrowRowIndexComparator<TTable>
): number {
  const result = compareRows(table, left.rowIndex, right.rowIndex);
  return result !== 0 ? result : left.ordinal - right.ordinal;
}

function doesArrowRowValueMatchFilter(
  rowValue: unknown,
  filterValues: ReadonlySet<string>
): boolean {
  if (rowValue === undefined || rowValue === null) {
    return false;
  }
  return getNormalizedArrowFilterValues(rowValue).some(value => filterValues.has(value));
}

function getNormalizedArrowFilterValues(rowValue: unknown): readonly string[] {
  if (typeof rowValue === 'boolean') {
    return rowValue ? ['true', '1'] : ['false', '0'];
  }
  if (Array.isArray(rowValue)) {
    return [rowValue.join(','), ...rowValue.map(item => String(item ?? ''))];
  }
  if (typeof rowValue === 'object' && Symbol.iterator in Object(rowValue)) {
    const items = Array.from(rowValue as Iterable<unknown>, item => String(item ?? ''));
    return items.length > 0 ? [items.join(','), ...items] : [''];
  }
  return [String(rowValue)];
}
