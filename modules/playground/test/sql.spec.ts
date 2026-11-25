// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, test, vi} from 'vitest';
import {tableFromJSON} from 'apache-arrow';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';
import {createPlaygroundSQLProvider, PlaygroundSQLTableCatalog} from '../src/sql';

const table = tableFromJSON([
  {value: 1, position: [1, 2]},
  {value: 2, position: [3, 4]},
  {value: 3, position: [5, 6]}
]);
const provider = createPlaygroundSQLProvider({
  getTable: name => (name === 'points' ? table : undefined)
});

test('SQL provider parses, filters, projects and limits Arrow rows for deck.gl', async () => {
  const result = await provider.execute({
    sql: 'SELECT value AS size, position FROM points WHERE value >= 2 LIMIT 1'
  });
  expect(result.data).toEqual([{size: 2, position: [3, 4]}]);
  expect(table.numRows).toBe(3);
});

test('SQL provider rejects unavailable tables, invalid queries, parameters and cancellation', async () => {
  await expect(provider.execute({sql: 'SELECT * FROM missing'})).rejects.toThrow(
    'Unknown SQL table'
  );
  await expect(provider.execute({sql: 'not SQL'})).rejects.toThrow();
  await expect(provider.execute({sql: 'SHOW TABLES'})).rejects.toThrow('listTables');
  await expect(provider.execute({sql: 'SELECT * FROM points', parameters: []})).rejects.toThrow(
    'parameters'
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    provider.execute({sql: 'SELECT * FROM points'}, {signal: controller.signal})
  ).rejects.toThrow();
});

test('SQL provider binds named scalar and array parameters without interpreting them as SQL', async () => {
  expect(
    (
      await provider.execute({
        sql: 'SELECT value FROM points WHERE value >= :minimum',
        parameters: {minimum: 2}
      })
    ).data
  ).toEqual([{value: 2}, {value: 3}]);
  expect(
    (
      await provider.execute({
        sql: 'SELECT value FROM points WHERE value IN (:values)',
        parameters: {values: [1, 3]}
      })
    ).data
  ).toEqual([{value: 1}, {value: 3}]);
  await expect(
    provider.execute({sql: 'SELECT value FROM points WHERE value >= :minimum'})
  ).rejects.toThrow();
});

test('SQL provider executes joins, sorting, grouping and UNION ALL through math.gl', async () => {
  const labels = tableFromJSON([
    {value: 2, label: 'Two'},
    {value: 3, label: 'Three'}
  ]);
  const relational = createPlaygroundSQLProvider({
    getTable: name => (name === 'points' ? table : name === 'labels' ? labels : undefined)
  });
  expect(
    (
      await relational.execute({
        sql: 'SELECT p.value AS value, l.label AS label FROM points p INNER JOIN labels l ON p.value = l.value ORDER BY value DESC'
      })
    ).data
  ).toEqual([
    {value: 3, label: 'Three'},
    {value: 2, label: 'Two'}
  ]);
  const grouped = await relational.execute({
    sql: 'SELECT value, COUNT(*) AS count FROM points GROUP BY value ORDER BY value DESC LIMIT 1'
  });
  expect(grouped.data).toEqual([{value: 3, count: 1n}]);
  expect(
    (
      await relational.execute({
        sql: 'SELECT value FROM points WHERE value = 1 UNION ALL SELECT value FROM points WHERE value = 3 ORDER BY value DESC'
      })
    ).data
  ).toEqual([{value: 3}, {value: 1}]);
});

test('SQL provider discovers only the allowed catalog and preserves projected unique picking IDs', async () => {
  const catalog = createPlaygroundSQLProvider({
    getTable: name => (name === 'points' ? table : undefined),
    listTables: () => ['points'],
    rowIdColumn: 'value'
  });
  expect((await catalog.execute({sql: 'SHOW TABLES'})).data).toEqual([{name: 'points'}]);
  expect((await catalog.execute({sql: 'SHOW SOURCES'})).data).toEqual([{name: 'points'}]);
  const description = await catalog.execute({sql: 'DESCRIBE points'});
  expect(description.data).toEqual(
    table.schema.fields.map(field => ({
      name: field.name,
      type: String(field.type),
      nullable: field.nullable
    }))
  );
  const picked = await catalog.execute({
    sql: 'SELECT value FROM points ORDER BY value DESC LIMIT 1'
  });
  expect(picked.getRowId?.(picked.data[0], 0)).toBe(3);
  expect((await catalog.execute({sql: 'SELECT position FROM points'})).getRowId).toBeUndefined();
  expect(
    (await catalog.execute({sql: 'SELECT value FROM points UNION ALL SELECT value FROM points'}))
      .getRowId
  ).toBeUndefined();
});

test('catalog changes rerun queries and recover missing inputs without changing SQL', async () => {
  const catalog = new PlaygroundSQLTableCatalog();
  const engine = createPlaygroundSQLProvider(catalog);
  const execute = vi.spyOn(engine, 'execute');
  const manager = new PlaygroundDataSourceManager({queryProvider: engine});
  const read = () => manager.subscribe({dataSourceId: 'result', consumerId: 'test', onChange() {}});
  const resultQuery = {sql: 'SELECT value FROM points WHERE value >= :min', parameters: {min: 2}};
  try {
    manager.addQuery({dataSourceId: 'result', query: resultQuery});
    await expect(read()).rejects.toThrow('Unknown SQL table');
    catalog.setTable('points', table);
    await vi.waitFor(() => expect(manager.listDataSources()[0].status).toBe('ready'));
    expect((read() as any).data).toEqual([{value: 2}, {value: 3}]);
    catalog.setTable('points', tableFromJSON([{value: 4}]));
    await vi.waitFor(() => expect((read() as any)?.data).toEqual([{value: 4}]));
    catalog.removeTable('points');
    await vi.waitFor(() => expect(manager.listDataSources()[0].status).toBe('error'));
    catalog.setTable('points', table);
    await vi.waitFor(() => expect((read() as any)?.data).toEqual([{value: 2}, {value: 3}]));
    await manager.finalize();
    const calls = execute.mock.calls.length;
    catalog.setTable('points', table);
    await new Promise(resolve => queueMicrotask(() => resolve(undefined)));
    expect(execute).toHaveBeenCalledTimes(calls);
  } finally {
    await manager.finalize();
    catalog.finalize();
  }
});

test('JSON-backed sparse rows and GeoJSON can be filtered and restored without coercion', async () => {
  const rows = [{value: 2, info: {label: 'Two'}}, {other: 'sparse'}, {value: 3, info: null}];
  const features = [
    {type: 'Feature', geometry: {type: 'Point', coordinates: [1, 2]}, properties: {value: 2}}
  ];
  const catalog = new PlaygroundSQLTableCatalog();
  catalog.setTable('rows', tableFromJSON(rows.map(row => ({row: JSON.stringify(row)}))), row =>
    JSON.parse(String(row.row))
  );
  catalog.setTable(
    'geo',
    tableFromJSON(
      features.map(feature => ({
        feature: JSON.stringify(feature),
        properties: JSON.stringify(feature.properties)
      }))
    ),
    row => JSON.parse(String(row.feature))
  );
  const json = createPlaygroundSQLProvider(catalog);
  expect(
    (await json.execute({sql: "SELECT * FROM rows WHERE JSON_NUMBER(row, '$.value') >= 2"})).data
  ).toEqual([rows[0], rows[2]]);
  expect(
    (await json.execute({sql: "SELECT JSON_VALUE(row, '$.info.label') AS label FROM rows"})).data
  ).toEqual([{label: 'Two'}, {label: null}, {label: null}]);
  expect(
    (await json.execute({sql: "SELECT * FROM geo WHERE JSON_NUMBER(properties, '$.value') >= 2"}))
      .data
  ).toEqual(features);
  expect(
    (
      await json.execute({
        sql: "SELECT JSON_NUMBER(feature, '$.geometry.coordinates[0]') AS x FROM geo"
      })
    ).data
  ).toEqual([{x: 1}]);
  await expect(
    json.execute({sql: "SELECT JSON_VALUE(row, 'invalid') AS label FROM rows"})
  ).rejects.toThrow();
  expect(
    (await json.execute({sql: "SELECT * FROM rows AS r WHERE JSON_NUMBER(r.row, '$.value') >= 2"}))
      .data
  ).toEqual([rows[0], rows[2]]);
  catalog.setTable('warehouse.rows', table);
  expect((await json.execute({sql: 'SHOW TABLES FROM "warehouse.rows"'})).data).toEqual([
    {name: 'warehouse.rows'}
  ]);
  catalog.finalize();
});

test('hosts can explicitly register math.gl SQL function packages', async () => {
  const {SQRT} = await import('@math.gl/sql/math-functions');
  const math = createPlaygroundSQLProvider({getTable: () => table, functions: [SQRT]});
  expect(
    (await math.execute({sql: 'SELECT SQRT(CAST(value AS FLOAT64)) AS root FROM points LIMIT 1'}))
      .data
  ).toEqual([{root: 1}]);
});
