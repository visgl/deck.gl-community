// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, test} from 'vitest';
import {tableFromJSON} from 'apache-arrow';
import {createPlaygroundSQLProvider} from '../src/sql';

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
  await expect(provider.execute({sql: 'SHOW TABLES'})).rejects.toThrow('requires SELECT');
  await expect(provider.execute({sql: 'SELECT * FROM points', parameters: []})).rejects.toThrow(
    'parameters'
  );
  const controller = new AbortController();
  controller.abort();
  await expect(
    provider.execute({sql: 'SELECT * FROM points'}, {signal: controller.signal})
  ).rejects.toThrow();
});
