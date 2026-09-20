// deck.gl-community
// SPDX-License-Identifier: MIT

import {expect, test, vi} from 'vitest';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';
import {PlaygroundSourceBindings} from '../src/runtime/playground-source-bindings';

test('adapts promises through the structural manager contract and discards stale results', async () => {
  const manager = new PlaygroundDataSourceManager({protocol: 'source://'});
  const changed = vi.fn();
  // Only the upstream consumer API is available to the adapter.
  const sources = new PlaygroundSourceBindings(
    {
      protocol: manager.protocol,
      subscribe: parameters => manager.subscribe(parameters),
      unsubscribe: parameters => manager.unsubscribe(parameters),
      listDataSources: () => manager.listDataSources()
    },
    changed
  );
  expect(sources.get('source://rows')).toBeUndefined();
  let resolve!: (value: object) => void;
  manager.add({
    dataSourceId: 'rows',
    dataSource: new Promise(done => {
      resolve = done;
    })
  });
  expect(sources.getState('source://rows')).toEqual({status: 'loading'});
  const data = [{id: 1}];
  const descriptor = {data};
  manager.add({dataSourceId: 'rows', dataSource: Promise.resolve(descriptor)});
  await vi.waitFor(() => expect(sources.get('source://rows')?.data).toBe(data));
  expect(Object.isFrozen(sources.get('source://rows'))).toBe(true);
  descriptor.data = [];
  resolve({data: [{id: 2}]});
  await Promise.resolve();
  expect(sources.get('source://rows')?.data).toBe(data);
  sources.finalize();
  changed.mockClear();
  manager.add({dataSourceId: 'rows', dataSource: {data: []}});
  expect(changed).not.toHaveBeenCalled();
  await manager.finalize();
});

test('validates row handles and stops exposing removed or released sources', async () => {
  const manager = new PlaygroundDataSourceManager();
  const changed = vi.fn();
  const sources = new PlaygroundSourceBindings(manager, changed);
  manager.add({dataSourceId: 'rows', dataSource: {data: new Float32Array(4)}});
  expect(sources.getState('rows')).toMatchObject({status: 'error'});
  manager.add({dataSourceId: 'rows', dataSource: {data: [], getRowId: 'id'}});
  expect(sources.getState('rows')).toMatchObject({status: 'error'});
  const close = vi.fn();
  manager.add({dataSourceId: 'rows', dataSource: {data: [], close}});
  expect(sources.getState('rows')).toEqual({status: 'ready'});
  await manager.remove('rows');
  expect(sources.get('rows')).toBeUndefined();
  expect(close).toHaveBeenCalledOnce();
  const replacement = {data: [{id: 2}]};
  manager.add({dataSourceId: 'rows', dataSource: replacement});
  expect(sources.get('rows')?.data).toBe(replacement.data);
  await manager.remove('rows');
  manager.add({dataSourceId: 'rows', dataSource: {data: []}});
  expect(sources.get('rows')?.data).not.toBe(replacement.data);
  sources.retain([]);
  let resolve!: (value: object) => void;
  manager.add({
    dataSourceId: 'rows',
    dataSource: new Promise(done => {
      resolve = done;
    })
  });
  expect(sources.getState('rows')).toEqual({status: 'loading'});
  sources.finalize();
  changed.mockClear();
  resolve({data: []});
  await Promise.resolve();
  await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
  await manager.finalize();
});

test('reads multiple aliases from change callbacks without resubscribing in a notification', async () => {
  const manager = new PlaygroundDataSourceManager();
  let sources: PlaygroundSourceBindings;
  const changed = vi.fn(() => {
    expect(sources.get('rows')?.data).toBe(data);
    sources.get('datasource://rows');
    if (changed.mock.calls.length > 2) throw new Error('Reentrant subscription loop');
  });
  sources = new PlaygroundSourceBindings(manager, changed);
  sources.get('rows');
  sources.get('datasource://rows');
  const data = [{id: 1}];
  manager.add({dataSourceId: 'rows', dataSource: {data}});
  expect(changed).toHaveBeenCalledTimes(2);
  expect(sources.get('datasource://rows')?.data).toBe(data);
  sources.finalize();
  await manager.finalize();
});

test('does not repeatedly resubscribe when an upstream manager returns fresh rejected promises', async () => {
  const manager = new PlaygroundDataSourceManager();
  let sources: PlaygroundSourceBindings;
  const changed = vi.fn(() => {
    if (changed.mock.calls.length > 4) sources.finalize();
    else sources.get('rows');
  });
  sources = new PlaygroundSourceBindings(
    {
      protocol: manager.protocol,
      subscribe: parameters => {
        const current = manager.subscribe(parameters);
        const error = manager.listDataSources()[0]?.error;
        return error ? Promise.reject(error) : current;
      },
      unsubscribe: parameters => manager.unsubscribe(parameters),
      listDataSources: () => manager.listDataSources()
    },
    changed
  );
  sources.get('rows');
  manager.add({dataSourceId: 'rows', dataSource: Promise.reject(new Error('Unavailable'))});
  await vi.waitFor(() => expect(sources.getState('rows')).toMatchObject({status: 'error'}));
  expect(changed).toHaveBeenCalledTimes(2);
  sources.finalize();
  await manager.finalize();
});
