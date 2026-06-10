import * as arrow from 'apache-arrow';
import {afterEach, describe, expect, expectTypeOf, it, vi} from 'vitest';

import {log} from '../react/utils/log';
import {IndexedArrowTable} from './indexed-arrow-table';
import {MappedArrowTable} from './mapped-arrow-table';

type TypedInferenceColumns = {
  run_id: arrow.Utf8;
  score: arrow.Float64;
  active: arrow.Bool;
};

describe('IndexedArrowTable', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves constructor type inference from the input Arrow table', () => {
    const typedTable = createTypedInferenceTable();
    const indexedTable = new IndexedArrowTable(typedTable, [1, 0]);
    const mappedTable = new MappedArrowTable(
      typedTable,
      new Map([
        ['run-b', 1],
        ['run-a', 0]
      ])
    );

    expectTypeOf(indexedTable).toEqualTypeOf<IndexedArrowTable<TypedInferenceColumns>>();
    expectTypeOf(mappedTable).toEqualTypeOf<MappedArrowTable<TypedInferenceColumns>>();
    expectTypeOf(indexedTable.get(0)?.run_id).toEqualTypeOf<string | undefined>();
    expectTypeOf(indexedTable.getTemporaryRow(0)?.run_id).toEqualTypeOf<string | undefined>();
    expectTypeOf(indexedTable.getValue(0, 'score')).toEqualTypeOf<number | null>();
    expectTypeOf(mappedTable.getTemporaryRow(0)?.active).toEqualTypeOf<boolean | undefined>();
    expectTypeOf(mappedTable.getByKey('run-a')?.active).toEqualTypeOf<boolean | undefined>();
  });

  it('normalizes row indexes and preserves typed row and column access', () => {
    const table = createTestTable();
    const indexedTable = new IndexedArrowTable(table, [2, 0, 1]);

    expect(Array.from(indexedTable.indexes)).toEqual([2, 0, 1]);
    expect(indexedTable.numRows).toBe(3);
    expect(indexedTable.numCols).toBe(5);
    expect(indexedTable.getRawIndex(1)).toBe(0);
    expect(indexedTable.getRawIndex(99)).toBeNull();
    expect(indexedTable.get(0)?.name).toBe('gamma');
    expect(indexedTable.at(-1)?.name).toBe('beta');
    expect(indexedTable.getValue(0, 'score')).toBe(30);

    expectTypeOf(indexedTable.get(0)?.name).toEqualTypeOf<string | undefined>();
    expectTypeOf(indexedTable.getValue(0, 'score')).toEqualTypeOf<number | null>();
    expectTypeOf(indexedTable.getChild('name')?.get(0)).toEqualTypeOf<string | null | undefined>();
  });

  it('adopts owned typed row indexes without copying them', () => {
    const table = createTestTable();
    const indexes = Int32Array.from([2, 0, 1]);
    const indexedTable = IndexedArrowTable.fromOwnedIndexes(table, indexes);

    expect(indexedTable.indexes).toBe(indexes);
    expect(indexedTable.get(0)?.name).toBe('gamma');
    expect(indexedTable.getValue(1, 'score')).toBe(10);
  });

  it('returns indexed child-column views', () => {
    const table = createTestTable();
    const indexedTable = new IndexedArrowTable(table, [2, 0]);
    const nameColumn = indexedTable.getChild('name');

    expect(nameColumn).not.toBeNull();
    expect(nameColumn?.length).toBe(2);
    expect(nameColumn?.get(0)).toBe('gamma');
    expect(nameColumn?.at(-1)).toBe('alpha');
    expect(nameColumn?.slice(1).toArray()).toEqual(['alpha']);
  });

  it('delegates public row materialization to the backing table', () => {
    const table = createTestTable();
    const getSpy = vi.spyOn(table, 'get');
    const indexedTable = new IndexedArrowTable(table, [2, 0]);

    expect(indexedTable.get(1)?.name).toBe('alpha');
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(0);
  });

  it('reuses one scratch row for temporary row access without calling table.get', () => {
    const table = createTestTable();
    const getSpy = vi.spyOn(table, 'get');
    const indexedTable = new IndexedArrowTable(table, [2, 0, 1]);

    const firstRow = indexedTable.getTemporaryRow(0);
    expect(firstRow).toMatchObject({
      name: 'gamma',
      score: 30,
      active: true,
      group: 'warm'
    });

    const secondRow = indexedTable.getTemporaryRow(1);

    expect(secondRow).toBe(firstRow);
    expect(secondRow).toMatchObject({
      name: 'alpha',
      score: 10,
      active: true,
      group: 'warm'
    });
    expect(indexedTable.getTemporaryRow(99)).toBeNull();
    expect(getSpy).not.toHaveBeenCalled();
  });

  it('filters and sorts through typed column access without calling table.get', () => {
    const table = createTestTable();
    const getSpy = vi.spyOn(table, 'get');
    const getChildSpy = vi.spyOn(table, 'getChild');
    const indexedTable = new IndexedArrowTable(table);

    const filteredTable = indexedTable.filter(
      (currentTable, rowIndex) => currentTable.getValue(rowIndex, 'active') ?? false
    );
    const sortedTable = filteredTable.sort(
      (currentTable, leftRowIndex, rightRowIndex) =>
        (currentTable.getValue(rightRowIndex, 'score') ?? 0) -
        (currentTable.getValue(leftRowIndex, 'score') ?? 0)
    );

    expect(Array.from(filteredTable.indexes)).toEqual([0, 2]);
    expect(Array.from(sortedTable.indexes)).toEqual([2, 0]);
    expect(getSpy).not.toHaveBeenCalled();
    expect(getChildSpy.mock.calls.map(([columnName]) => columnName)).toEqual(['active', 'score']);
  });

  it('concatenates indexed views across matching tables using backing record batches', () => {
    const leftTable = createTestTable();
    const rightTable = createTestTableFromRows([
      {
        name: 'delta',
        score: 40,
        active: false,
        payload: new Uint8Array([10, 11, 12]),
        group: 'cool'
      },
      {
        name: 'epsilon',
        score: 50,
        active: true,
        payload: new Uint8Array([13, 14, 15]),
        group: 'warm'
      }
    ]);

    const concatenated = new IndexedArrowTable(leftTable, [2, 0]).concat(
      new IndexedArrowTable(rightTable, [1, 0])
    );

    expect(concatenated.table).not.toBe(leftTable);
    expect(concatenated.table).not.toBe(rightTable);
    expect(concatenated.table.numRows).toBe(5);
    expect(Array.from(concatenated.indexes)).toEqual([2, 0, 4, 3]);
    expect(Array.from(concatenated, row => row?.name)).toEqual([
      'gamma',
      'alpha',
      'epsilon',
      'delta'
    ]);
  });

  it('concatenates filtered and sliced indexed views without losing row access', () => {
    const leftView = new IndexedArrowTable(createTestTable()).filter(
      (table, rowIndex) => table.getValue(rowIndex, 'active') ?? false
    );
    const rightView = new IndexedArrowTable(
      createTestTableFromRows([
        {
          name: 'delta',
          score: 40,
          active: true,
          payload: new Uint8Array([10, 11, 12]),
          group: 'warm'
        },
        {
          name: 'epsilon',
          score: 50,
          active: false,
          payload: new Uint8Array([13, 14, 15]),
          group: 'cool'
        },
        {
          name: 'zeta',
          score: 60,
          active: true,
          payload: new Uint8Array([16, 17, 18]),
          group: 'warm'
        }
      ])
    ).slice(1);

    const concatenated = leftView.concat(rightView);

    expect(Array.from(concatenated.indexes)).toEqual([0, 2, 4, 5]);
    expect(concatenated.get(2)?.name).toBe('epsilon');
    expect(concatenated.getValue(3, 'score')).toBe(60);
    expect(concatenated.getChild('group')?.toArray()).toEqual(['warm', 'warm', 'cool', 'warm']);
  });

  it('concatenates views from the same backing table by duplicating source batches', () => {
    const table = createTestTable();
    const concatenated = new IndexedArrowTable(table, [2]).concat(
      new IndexedArrowTable(table, [0, 1])
    );

    expect(concatenated.table.numRows).toBe(6);
    expect(Array.from(concatenated.indexes)).toEqual([2, 3, 4]);
    expect(Array.from(concatenated, row => row?.name)).toEqual(['gamma', 'alpha', 'beta']);
  });

  it('throws when concatenating indexed views with incompatible schemas', () => {
    const indexedTable = new IndexedArrowTable(createTestTable());
    const incompatibleTable = arrow.tableFromJSON([
      {name: 'delta', score: 'forty', active: true, payload: new Uint8Array([1]), group: 'warm'}
    ]);

    expect(() =>
      indexedTable.concat(new IndexedArrowTable(incompatibleTable as any) as any)
    ).toThrow(/identical Arrow schemas/);
  });

  it('supports Array-like find and findIndex helpers', () => {
    const table = createTestTable();
    const indexedTable = new IndexedArrowTable(table, [2, 0, 1]);

    expect(indexedTable.find(row => row?.name === 'alpha')?.score).toBe(10);
    expect(indexedTable.findIndex(row => row?.active === false)).toBe(2);
    expect(indexedTable.find(row => row?.name === 'missing')).toBeUndefined();
    expect(indexedTable.findIndex(row => row?.name === 'missing')).toBe(-1);

    expectTypeOf(indexedTable.find(row => row?.name === 'gamma')?.name).toEqualTypeOf<
      string | undefined
    >();
  });

  it('materializes one concrete Arrow table preserving indexed row order and duplicates', () => {
    const table = createTestTable();
    const indexedTable = new IndexedArrowTable(table, [2, 0, 2]);
    const probeSpy = vi.spyOn(log, 'probe').mockImplementation(() => (() => {}) as any);

    const materializedTable = indexedTable.materializeArrowTable();

    expect(Array.from(materializedTable, row => row.name)).toEqual(['gamma', 'alpha', 'gamma']);
    expect(Array.from(materializedTable.getChild('score') ?? [])).toEqual([30, 10, 30]);
    expect(probeSpy).toHaveBeenCalledWith(0, 'IndexedArrowTable.materializeArrowTable', {
      count: expect.any(Number),
      numRows: 3,
      numCols: 5,
      sourceRows: 3
    });
  });

  it('lets mapped Arrow tables inherit materializeArrowTable', () => {
    const table = createTestTable();
    const mappedTable = new MappedArrowTable(
      table,
      new Map([
        ['gamma', 2],
        ['alpha', 0]
      ])
    );

    const materializedTable = mappedTable.materializeArrowTable();

    expect(Array.from(materializedTable, row => row.name)).toEqual(['gamma', 'alpha']);
    expect(Array.from(materializedTable.getChild('group') ?? [])).toEqual(['warm', 'warm']);
  });

  it('concatenates mapped views while preserving duplicate visible keys and last-wins lookup', () => {
    const leftTable = createTestTableFromRows([
      {
        name: 'alpha-dup',
        score: 10,
        active: true,
        payload: new Uint8Array([1]),
        group: 'warm'
      },
      {
        name: 'alpha-left',
        score: 20,
        active: true,
        payload: new Uint8Array([2]),
        group: 'cool'
      }
    ]);
    const rightTable = createTestTableFromRows([
      {
        name: 'beta-dup',
        score: 30,
        active: false,
        payload: new Uint8Array([3]),
        group: 'cool'
      },
      {
        name: 'beta-right',
        score: 40,
        active: true,
        payload: new Uint8Array([4]),
        group: 'warm'
      }
    ]);

    const concatenated = new MappedArrowTable(
      leftTable,
      new Map([
        ['dup', 0],
        ['left', 1]
      ])
    ).concat(
      new MappedArrowTable(
        rightTable,
        new Map([
          ['dup', 0],
          ['right', 1]
        ])
      )
    );

    expect(concatenated.rowKeys).toEqual(['dup', 'left', 'dup', 'right']);
    expect(Array.from(concatenated.indexes)).toEqual([0, 1, 2, 3]);
    expect(Array.from(concatenated, row => row?.name)).toEqual([
      'alpha-dup',
      'alpha-left',
      'beta-dup',
      'beta-right'
    ]);
    expect(concatenated.getRowIndex('dup')).toBe(2);
    expect(concatenated.getByKey('dup')?.name).toBe('beta-dup');
  });

  it('preserves duplicate mapped keys through slice, filter, and sort after concat', () => {
    const concatenated = new MappedArrowTable(
      createTestTableFromRows([
        {
          name: 'alpha-dup',
          score: 10,
          active: true,
          payload: new Uint8Array([1]),
          group: 'warm'
        },
        {
          name: 'alpha-left',
          score: 20,
          active: true,
          payload: new Uint8Array([2]),
          group: 'cool'
        }
      ]),
      new Map([
        ['dup', 0],
        ['left', 1]
      ])
    ).concat(
      new MappedArrowTable(
        createTestTableFromRows([
          {
            name: 'beta-dup',
            score: 30,
            active: false,
            payload: new Uint8Array([3]),
            group: 'cool'
          },
          {
            name: 'beta-right',
            score: 40,
            active: true,
            payload: new Uint8Array([4]),
            group: 'warm'
          }
        ]),
        new Map([
          ['dup', 0],
          ['right', 1]
        ])
      )
    );

    const sliced = concatenated.slice(1, 3);
    const filtered = concatenated.filter((table, rowIndex) => table.getRowKey(rowIndex) === 'dup');
    const sorted = concatenated.sort(
      (table, leftRowIndex, rightRowIndex) =>
        (table.getValue(rightRowIndex, 'score') ?? 0) - (table.getValue(leftRowIndex, 'score') ?? 0)
    );

    expect(sliced.rowKeys).toEqual(['left', 'dup']);
    expect(sliced.getRowIndex('dup')).toBe(2);
    expect(sliced.getByKey('dup')?.name).toBe('beta-dup');

    expect(filtered.rowKeys).toEqual(['dup', 'dup']);
    expect(filtered.getRowIndex('dup')).toBe(2);
    expect(Array.from(filtered, row => row?.name)).toEqual(['alpha-dup', 'beta-dup']);

    expect(sorted.rowKeys).toEqual(['right', 'dup', 'left', 'dup']);
    expect(sorted.getRowIndex('dup')).toBe(0);
    expect(sorted.getByKey('dup')?.name).toBe('alpha-dup');
  });

  it('throws when constructed with invalid raw row indexes', () => {
    const table = createTestTable();

    expect(() => new IndexedArrowTable(table, [0, 3])).toThrow(RangeError);
    expect(() => new IndexedArrowTable(table, [0, 0.5])).toThrow(RangeError);
  });
});

/**
 * Builds one small Arrow table used by the indexed and mapped view tests.
 */
function createTestTable() {
  return createTestTableFromRows([
    {
      name: 'alpha',
      score: 10,
      active: true,
      payload: new Uint8Array([1, 2, 3]),
      group: 'warm'
    },
    {
      name: 'beta',
      score: 20,
      active: false,
      payload: new Uint8Array([4, 5, 6]),
      group: 'cool'
    },
    {
      name: 'gamma',
      score: 30,
      active: true,
      payload: new Uint8Array([7, 8, 9]),
      group: 'warm'
    }
  ]);
}

/**
 * Builds one small Arrow table from explicit row objects for concat-oriented tests.
 */
function createTestTableFromRows(
  rows: ReadonlyArray<{
    name: string;
    score: number;
    active: boolean;
    payload: Uint8Array;
    group: string;
  }>
) {
  return arrow.tableFromJSON([...rows]);
}

/**
 * Builds one explicitly typed Arrow table used to verify constructor inference.
 */
function createTypedInferenceTable(): arrow.Table<TypedInferenceColumns> {
  return new arrow.Table<TypedInferenceColumns>({
    run_id: arrow.vectorFromArray(['run-a', 'run-b'], new arrow.Utf8()),
    score: arrow.vectorFromArray([10, 20], new arrow.Float64()),
    active: arrow.vectorFromArray([true, false], new arrow.Bool())
  });
}
