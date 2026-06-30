/**
 * Numeric range filter used by SQL-style Arrow row filtering.
 */
export type ArrowSqlRangeFilter = {
  /** Inclusive lower bound for numeric values. */
  min?: number | null;
  /** Inclusive upper bound for numeric values. */
  max?: number | null;
};

/**
 * One SQL-style column filter entry applied against Arrow row values.
 */
export type ArrowSqlColumnFilter = readonly string[] | ArrowSqlRangeFilter | null | undefined;

/**
 * SQL-style filter map keyed by Arrow row field name.
 */
export type ArrowSqlFilter = Record<string, ArrowSqlColumnFilter>;

/**
 * Minimal Arrow-like row-access contract needed for row-index filtering.
 */
export type ArrowRowFilterTable<TRow extends object = object> = {
  /** Total number of rows in the authoritative table. */
  numRows: number;
  /** Resolves one row object by row index. */
  get: (rowIndex: number) => TRow | null | undefined;
};

/**
 * Predicate evaluated against one row of an Arrow-like table.
 */
export type ArrowRowPredicate<TTable extends ArrowRowFilterTable> = (
  table: TTable,
  rowIndex: number
) => boolean;

/**
 * Comparator used to sort two row indexes from the same Arrow-like table.
 */
export type ArrowRowIndexComparator<TTable extends ArrowRowFilterTable> = (
  table: TTable,
  leftRowIndex: number,
  rightRowIndex: number
) => number;

/**
 * Options controlling Arrow row-index filtering.
 */
export type ArrowRowIndexFilterOptions<TTable extends ArrowRowFilterTable> = {
  /** Optional prefiltered row indexes. Defaults to all table rows. */
  rowIndexes?: readonly number[];
  /** Optional SQL-style filter map keyed by column name. */
  sqlFilter?: ArrowSqlFilter | undefined;
  /** Optional additional predicates evaluated after SQL-style filtering. */
  predicates?: readonly ArrowRowPredicate<TTable>[];
  /** Optional comparator applied after filtering and before limiting. */
  compareRows?: ArrowRowIndexComparator<TTable> | undefined;
  /** Optional limit applied after filtering. */
  limit?: number | undefined;
};

/**
 * Returns every row index from an Arrow-like table.
 */
export function getArrowRowIndexes(table: ArrowRowFilterTable): readonly number[] {
  return Array.from({length: table.numRows}, (_, rowIndex) => rowIndex);
}

/**
 * Filters Arrow row indexes using SQL-style column filters, optional predicates, and an optional limit.
 */
export function getFilteredArrowRowIndexes<TTable extends ArrowRowFilterTable>(
  table: TTable,
  options: ArrowRowIndexFilterOptions<TTable> = {}
): readonly number[] {
  const {
    rowIndexes = getArrowRowIndexes(table),
    sqlFilter,
    predicates = [],
    compareRows,
    limit
  } = options;

  const filteredRowIndexes = rowIndexes.filter(rowIndex => {
    const row = table.get(rowIndex);
    if (!row) {
      return false;
    }

    if (!matchesSqlFilter(row, sqlFilter)) {
      return false;
    }

    return predicates.every(predicate => predicate(table, rowIndex));
  });

  const sortedRowIndexes = compareRows
    ? [...filteredRowIndexes].sort((leftRowIndex, rightRowIndex) =>
        compareRows(table, leftRowIndex, rightRowIndex)
      )
    : filteredRowIndexes;

  if (!Number.isFinite(limit) || limit === undefined || limit >= sortedRowIndexes.length) {
    return sortedRowIndexes;
  }

  return sortedRowIndexes.slice(0, Math.max(limit, 0));
}

function matchesSqlFilter(row: object, sqlFilter: ArrowSqlFilter | undefined): boolean {
  if (!sqlFilter) {
    return true;
  }

  return Object.entries(sqlFilter).every(([key, values]) => {
    if (!values) {
      return true;
    }

    if (Array.isArray(values)) {
      if (values.length === 0) {
        return true;
      }
      const rowValue = getRowFieldValue(row, key);
      if (rowValue === undefined || rowValue === null) {
        return false;
      }
      return doesArrowRowValueMatchFilter(rowValue, values);
    }

    const rangeFilter = values as ArrowSqlRangeFilter;
    const rowValue = Number(getRowFieldValue(row, key));
    if (!Number.isFinite(rowValue)) {
      return false;
    }
    if (rangeFilter.min !== undefined && rangeFilter.min !== null && rowValue < rangeFilter.min) {
      return false;
    }
    if (rangeFilter.max !== undefined && rangeFilter.max !== null && rowValue > rangeFilter.max) {
      return false;
    }
    return true;
  });
}

function getRowFieldValue(row: object, key: string): unknown {
  return (row as Record<string, unknown>)[key];
}

/**
 * Returns whether one Arrow row field value matches any SQL-style discrete filter value.
 */
function doesArrowRowValueMatchFilter(rowValue: unknown, filterValues: readonly string[]): boolean {
  if (filterValues.length === 0) {
    return true;
  }

  const normalizedValues = new Set(getNormalizedArrowFilterValues(rowValue));
  return filterValues.some(filterValue => normalizedValues.has(filterValue));
}

/**
 * Normalizes Arrow row field values into the SQL-facing string forms used by filter dialogs.
 */
function getNormalizedArrowFilterValues(rowValue: unknown): readonly string[] {
  if (rowValue === null || rowValue === undefined) {
    return [''];
  }

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
