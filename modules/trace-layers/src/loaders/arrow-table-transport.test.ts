import * as arrow from 'apache-arrow';
import {describe, expect, it} from 'vitest';

import {
  collectDehydratedArrowTableTransferables,
  dehydrateArrowTable,
  deserializeArrowTableFromIPC,
  hydrateArrowTable,
  serializeArrowTableToIPC
} from './arrow-table-transport';

type TransportTestColumns = {
  active: arrow.Bool;
  name: arrow.Utf8;
  score: arrow.Float64;
};

describe('arrow-table-transport', () => {
  it('hydrates a structured-cloned payload into Arrow table and vector instances', () => {
    const table = createTestTable();
    const dehydratedTable = dehydrateArrowTable(table, {copy: 'sliced'});
    const clonedTable = structuredClone(dehydratedTable);
    const hydratedTable = hydrateArrowTable(clonedTable);

    expect(hydratedTable).toBeInstanceOf(arrow.Table);
    expect(hydratedTable.getChild('score')).toBeInstanceOf(arrow.Vector);
    expect(hydratedTable.getChild('score')?.get(1)).toBe(20.5);
    expect(hydratedTable.getChild('name')?.get(2)).toBe('gamma');
    expect(hydratedTable.getChild('active')?.get(0)).toBe(true);
  });

  it('collects transferable buffers for dehydrated table payloads', () => {
    const table = createTestTable();
    const dehydratedTable = dehydrateArrowTable(table, {copy: 'sliced'});

    const transferables = collectDehydratedArrowTableTransferables(dehydratedTable);

    expect(transferables.length).toBeGreaterThan(0);
    expect(transferables.every(transferable => transferable instanceof ArrayBuffer)).toBe(true);
  });

  it('dehydrates primitive makeData vectors without child data arrays', () => {
    const table = new arrow.Table({
      score: arrow.makeVector({
        type: new arrow.Float64(),
        length: 3,
        nullCount: 0,
        data: Float64Array.from([10.25, 20.5, 30.75])
      })
    });

    const dehydratedTable = dehydrateArrowTable(table, {copy: 'sliced'});
    const hydratedTable = hydrateArrowTable(structuredClone(dehydratedTable));

    expect(hydratedTable.getChild('score')?.toArray()).toEqual(
      Float64Array.from([10.25, 20.5, 30.75])
    );
  });

  it('dehydrates primitive data nodes when the buffers getter is unavailable', () => {
    const vector = arrow.makeVector({
      type: new arrow.Float64(),
      length: 3,
      nullCount: 0,
      data: Float64Array.from([10.25, 20.5, 30.75])
    });
    Object.defineProperty(vector.data[0], 'buffers', {
      configurable: true,
      get: () => undefined
    });
    const table = new arrow.Table({score: vector});

    const dehydratedTable = dehydrateArrowTable(table, {copy: 'sliced'});
    const hydratedTable = hydrateArrowTable(structuredClone(dehydratedTable));

    expect(hydratedTable.getChild('score')?.toArray()).toEqual(
      Float64Array.from([10.25, 20.5, 30.75])
    );
  });

  it('round-trips through Arrow IPC as a compatibility transport', () => {
    const table = createTestTable();
    const serializedTable = serializeArrowTableToIPC(table);
    const hydratedTable = deserializeArrowTableFromIPC(structuredClone(serializedTable));

    expect(hydratedTable).toBeInstanceOf(arrow.Table);
    expect(hydratedTable.getChild('score')?.toArray()).toEqual(
      Float64Array.from([10.25, 20.5, 30.75])
    );
    expect(hydratedTable.getChild('name')?.toArray()).toEqual(['alpha', 'beta', 'gamma']);
  });
});

function createTestTable(): arrow.Table<TransportTestColumns> {
  return new arrow.Table({
    active: arrow.vectorFromArray([true, false, true], new arrow.Bool()),
    name: arrow.vectorFromArray(['alpha', 'beta', 'gamma'], new arrow.Utf8()),
    score: arrow.vectorFromArray([10.25, 20.5, 30.75], new arrow.Float64())
  });
}
