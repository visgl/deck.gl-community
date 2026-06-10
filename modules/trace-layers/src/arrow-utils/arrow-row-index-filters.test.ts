import {describe, expect, it} from 'vitest';

import {getArrowRowIndexes, getFilteredArrowRowIndexes} from './arrow-row-index-filters';

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
});

function createMockTable(rows: Record<string, unknown>[]) {
  return {
    numRows: rows.length,
    get(rowIndex: number) {
      return rows[rowIndex] ?? null;
    }
  };
}
