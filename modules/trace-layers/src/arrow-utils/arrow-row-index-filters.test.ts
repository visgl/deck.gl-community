import * as arrow from 'apache-arrow';
import {describe, expect, it, vi} from 'vitest';

import {
  filterArrowTableRowIndexes,
  getArrowRowIndexes,
  getFilteredArrowRowIndexes
} from './arrow-row-index-filters';
import {IndexedArrowTable} from './indexed-arrow-table';

describe('arrow-row-index-filters', () => {
  it('returns all row indexes by default', () => {
    const table = createMockTable([
      {processId: '1', node_name: 'node-a'},
      {processId: '2', node_name: 'node-b'}
    ]);

    expect(getArrowRowIndexes(table)).toEqual([0, 1]);
    expect(getFilteredArrowRowIndexes(table)).toEqual([0, 1]);
  });

  it('applies SQL-style string and range filters', () => {
    const table = createMockTable([
      {processId: '1', node_name: 'node-a', local_gpu: 0},
      {processId: '2', node_name: 'node-b', local_gpu: 1},
      {processId: '3', node_name: 'node-b', local_gpu: 2}
    ]);

    expect(
      getFilteredArrowRowIndexes(table, {
        sqlFilter: {
          node_name: ['node-b'],
          local_gpu: {min: 1, max: 1}
        }
      })
    ).toEqual([1]);
  });

  it('applies custom predicates and a limit on top of filtered rows', () => {
    const table = createMockTable([
      {processId: '1', node_name: 'node-a'},
      {processId: '2', node_name: 'node-b'},
      {processId: '3', node_name: 'node-c'}
    ]);

    expect(
      getFilteredArrowRowIndexes(table, {
        predicates: [(_, rowIndex) => rowIndex > 0],
        limit: 1
      })
    ).toEqual([1]);
  });

  it('sorts filtered row indexes before applying the limit', () => {
    const table = createMockTable([{processId: '10'}, {processId: '2'}, {processId: '1'}]);

    expect(
      getFilteredArrowRowIndexes(table, {
        compareRows: (currentTable, leftRowIndex, rightRowIndex) => {
          const leftRankId = Number(currentTable.get(leftRowIndex)?.processId ?? Number.NaN);
          const rightRankId = Number(currentTable.get(rightRowIndex)?.processId ?? Number.NaN);
          return leftRankId - rightRankId;
        },
        limit: 2
      })
    ).toEqual([2, 1]);
  });

  it('matches boolean fields against sql-style boolean and numeric checkbox values', () => {
    const table = createMockTable([
      {processId: '1', has_chrome_traces: true},
      {processId: '2', has_chrome_traces: false}
    ]);

    expect(
      getFilteredArrowRowIndexes(table, {
        sqlFilter: {
          has_chrome_traces: ['1']
        }
      })
    ).toEqual([0]);

    expect(
      getFilteredArrowRowIndexes(table, {
        sqlFilter: {
          has_chrome_traces: ['false']
        }
      })
    ).toEqual([1]);
  });

  it('matches iterable fields against joined and individual item values', () => {
    const table = createMockTable([
      {processId: '1', data_roots: ['root-a', 'root-b']},
      {processId: '2', data_roots: ['root-c']}
    ]);

    expect(
      getFilteredArrowRowIndexes(table, {
        sqlFilter: {
          data_roots: ['root-a']
        }
      })
    ).toEqual([0]);

    expect(
      getFilteredArrowRowIndexes(table, {
        sqlFilter: {
          data_roots: ['root-a,root-b']
        }
      })
    ).toEqual([0]);
  });

  it('filters indexed Arrow columns without materializing rows', () => {
    const table = new IndexedArrowTable(
      new arrow.Table({
        name: arrow.vectorFromArray(['alpha', 'beta', 'βeta'], new arrow.Utf8()),
        score: arrow.vectorFromArray([1, 2, 3], new arrow.Float64())
      }),
      [2, 0, 1]
    );
    const getSpy = vi.spyOn(table, 'get');

    const rowIndexes = filterArrowTableRowIndexes(table, {
      filters: [
        {columnName: 'name', values: ['βeta']},
        {columnName: 'score', min: 3, max: 3}
      ]
    });

    expect(Array.from(rowIndexes)).toEqual([0]);
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('returns the same stable top-k rows as a full sort', () => {
    const table = createMockTable([{score: 5}, {score: 1}, {score: 3}, {score: 1}, {score: 2}]);
    const compareRows = (currentTable: typeof table, left: number, right: number) =>
      Number(currentTable.get(left)?.score) - Number(currentTable.get(right)?.score);

    const full = Array.from(filterArrowTableRowIndexes(table, {compareRows})).slice(0, 3);
    const limited = Array.from(filterArrowTableRowIndexes(table, {compareRows, limit: 3}));

    expect(limited).toEqual(full);
    expect(limited).toEqual([1, 3, 4]);
  });
});

function createMockTable(rows: Record<string, unknown>[]) {
  return {
    numRows: rows.length,
    get(rowIndex: number) {
      return rows[rowIndex] ?? null;
    }
  };
}
