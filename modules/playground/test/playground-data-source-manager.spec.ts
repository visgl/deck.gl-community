// deck.gl-community
// SPDX-License-Identifier: MIT

import {beforeEach, describe, expect, test, vi} from 'vitest';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';

function createPendingSource() {
  let resolve!: (source: object) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<object>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return {promise, resolve, reject};
}

describe('playground data source manager', () => {
  let manager: PlaygroundDataSourceManager;
  beforeEach(() => {
    manager = new PlaygroundDataSourceManager();
  });

  test('resolves deferred ids and preserves opaque source identity', () => {
    const onChange = vi.fn();
    expect(manager.contains('points')).toBe(false);
    expect(manager.contains('datasource://points')).toBe(true);
    expect(
      manager.subscribe({dataSourceId: 'points', consumerId: 'absent', onChange})
    ).toBeUndefined();
    expect(
      manager.subscribe({dataSourceId: 'datasource://points', consumerId: 'view', onChange})
    ).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'points', status: 'placeholder'}]);
    const source = {
      get data() {
        throw new Error('Source contents must remain opaque');
      }
    };
    manager.add({dataSourceId: 'datasource://points', dataSource: source});
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toBe(source);
    expect(manager.subscribe({dataSourceId: 'points', consumerId: 'other', onChange})).toBe(source);
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'points', status: 'ready'}]);
  });

  test('notifies for the same object only when forceUpdate is requested', () => {
    const source = {data: []};
    const onChange = vi.fn();
    manager.add({dataSourceId: 'points', dataSource: source});
    manager.subscribe({dataSourceId: 'points', consumerId: 'view', onChange});
    manager.add({dataSourceId: 'points', dataSource: source});
    expect(onChange).not.toHaveBeenCalled();
    manager.add({dataSourceId: 'points', dataSource: source, forceUpdate: true});
    expect(onChange).toHaveBeenCalledExactlyOnceWith(source);
  });

  test('replaces consumer requests independently and unsubscribes without disposing sources', async () => {
    const first = {close: vi.fn()};
    const second = {close: vi.fn()};
    const oldListener = vi.fn();
    const listener = vi.fn();
    const otherListener = vi.fn();
    manager.add({dataSourceId: 'first', dataSource: first});
    manager.add({dataSourceId: 'second', dataSource: second});
    manager.subscribe({dataSourceId: 'first', consumerId: 'view', onChange: oldListener});
    manager.subscribe({dataSourceId: 'second', consumerId: 'view', onChange: listener});
    manager.subscribe({
      dataSourceId: 'first',
      consumerId: 'view',
      requestId: 'extra',
      onChange: listener
    });
    manager.subscribe({dataSourceId: 'first', consumerId: 'other', onChange: otherListener});
    manager.add({dataSourceId: 'first', dataSource: first, forceUpdate: true});
    expect(oldListener).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledExactlyOnceWith(first);
    expect(otherListener).toHaveBeenCalledExactlyOnceWith(first);
    manager.unsubscribe({consumerId: 'view'});
    manager.add({dataSourceId: 'first', dataSource: first, forceUpdate: true});
    manager.add({dataSourceId: 'second', dataSource: second, forceUpdate: true});
    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherListener).toHaveBeenCalledTimes(2);
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
    await manager.finalize();
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  test('shares pending promises without sending another notification on resolution', async () => {
    const pending = createPendingSource();
    const onChange = vi.fn();
    manager.subscribe({dataSourceId: 'datasource://points', consumerId: 'view', onChange});
    manager.add({dataSourceId: 'points', dataSource: pending.promise});
    const current = manager.subscribe({dataSourceId: 'points', consumerId: 'other', onChange});
    expect(current).toBeInstanceOf(Promise);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(current);
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'points', status: 'pending'}]);
    const source = {data: [{id: 1}]};
    pending.resolve(source);
    await expect(current).resolves.toBe(source);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(manager.subscribe({dataSourceId: 'points', consumerId: 'third', onChange})).toBe(source);
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'points', status: 'ready'}]);
  });

  test('records an unobserved rejection and exposes it to later subscribers', async () => {
    manager.add({dataSourceId: 'failed', dataSource: Promise.reject('Unavailable')});
    await vi.waitFor(() => expect(manager.listDataSources()[0].status).toBe('error'));
    const current = manager.subscribe({
      dataSourceId: 'failed',
      consumerId: 'view',
      onChange: vi.fn()
    });
    await expect(current).rejects.toThrow('Unavailable');
    expect(manager.listDataSources()[0].error).toBeInstanceOf(Error);
    const ready = {};
    manager.add({dataSourceId: 'failed', dataSource: ready});
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'failed', status: 'ready'}]);
  });

  test.each(['replace', 'remove', 'finalize'])('disposes stale results after %s', async action => {
    const pending = createPendingSource();
    manager.add({dataSourceId: 'points', dataSource: pending.promise});
    const onChange = vi.fn();
    const current = manager.subscribe({dataSourceId: 'points', consumerId: 'view', onChange});
    const replacement = {data: []};
    if (action === 'replace') manager.add({dataSourceId: 'points', dataSource: replacement});
    else if (action === 'remove') await manager.remove('points');
    else await manager.finalize();
    const stale = {close: vi.fn()};
    pending.resolve(stale);
    await expect(current).resolves.toBe(stale);
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(manager.listDataSources()).toEqual(
      action === 'replace' ? [{dataSourceId: 'points', status: 'ready'}] : []
    );
    expect(onChange).toHaveBeenCalledTimes(action === 'replace' ? 1 : 0);
  });

  test('ignores stale rejections and does not restart a force-notified promise', async () => {
    const stale = createPendingSource();
    const pending = createPendingSource();
    manager.add({dataSourceId: 'points', dataSource: stale.promise});
    manager.add({dataSourceId: 'points', dataSource: pending.promise});
    const onChange = vi.fn();
    const current = manager.subscribe({dataSourceId: 'points', consumerId: 'view', onChange});
    manager.add({dataSourceId: 'points', dataSource: pending.promise, forceUpdate: true});
    expect(onChange).toHaveBeenCalledExactlyOnceWith(current);
    stale.reject(new Error('Obsolete'));
    const source = {close: vi.fn()};
    pending.resolve(source);
    await expect(current).resolves.toBe(source);
    expect(source.close).not.toHaveBeenCalled();
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'points', status: 'ready'}]);
  });

  test('keeps subscriptions through placeholders but silently detaches them on removal', async () => {
    const onChange = vi.fn();
    manager.subscribe({dataSourceId: 'datasource://points', consumerId: 'view', onChange});
    const first = {close: vi.fn()};
    manager.add({dataSourceId: 'points', dataSource: first});
    manager.add({dataSourceId: 'points', dataSource: null});
    expect(first.close).toHaveBeenCalledTimes(1);
    const second = {};
    manager.add({dataSourceId: 'points', dataSource: second});
    expect(onChange.mock.calls).toEqual([[first], [null], [second]]);
    await manager.remove('datasource://points');
    manager.add({dataSourceId: 'points', dataSource: {}});
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  test.each([
    'close',
    'finalize',
    'destroy'
  ])('releases handles using %s with lifecycle precedence', async method => {
    const order = ['close', 'finalize', 'destroy'];
    const source = Object.fromEntries(
      order.slice(order.indexOf(method)).map(name => [name, vi.fn()])
    );
    manager.add({dataSourceId: 'resource', dataSource: source});
    await manager.remove('resource');
    await manager.remove('resource');
    expect(source[method]).toHaveBeenCalledTimes(1);
    for (const other of order.slice(order.indexOf(method) + 1))
      expect(source[other]).not.toHaveBeenCalled();
  });

  test('uses custom protocols and prototype-safe ids without inspecting source payloads', () => {
    manager = new PlaygroundDataSourceManager({protocol: 'source:'});
    for (const id of ['__proto__', 'constructor', 'toString']) {
      const source = {};
      const onChange = vi.fn();
      manager.subscribe({dataSourceId: `source:${id}`, consumerId: id, requestId: id, onChange});
      manager.add({dataSourceId: id, dataSource: source});
      expect(onChange).toHaveBeenCalledExactlyOnceWith(source);
      expect(manager.contains(id)).toBe(true);
    }
    expect(manager.listDataSources().map(entry => entry.dataSourceId)).toEqual([
      '__proto__',
      'constructor',
      'toString'
    ]);
  });

  test('executes a named SQL source through the host query provider', async () => {
    const execute = vi.fn(async ({sql}: {sql: string}) => ({
      data: [{id: 7, sql}],
      getRowId: (row: {id: number}) => row.id
    }));
    manager = new PlaygroundDataSourceManager({queryProvider: {execute}});
    const changes = vi.fn();
    manager.subscribe({dataSourceId: 'cities', consumerId: 'view', onChange: changes});
    manager.addQuery({dataSourceId: 'cities', query: {sql: 'SELECT * FROM cities'}});
    const source = manager.subscribe({
      dataSourceId: 'cities',
      consumerId: 'other',
      onChange: changes
    });
    expect(source).toBeInstanceOf(Promise);
    await expect(source).resolves.toEqual({
      data: [{id: 7, sql: 'SELECT * FROM cities'}],
      getRowId: expect.any(Function)
    });
    expect(execute).toHaveBeenCalledWith({sql: 'SELECT * FROM cities'});
    expect(manager.listDataSources()).toEqual([{dataSourceId: 'cities', status: 'ready'}]);
    manager.addQuery({dataSourceId: 'cities', query: {sql: 'SELECT * FROM cities'}});
    expect(execute).toHaveBeenCalledOnce();
  });

  test('rejects SQL sources when no provider is configured', () => {
    expect(() => manager.addQuery({dataSourceId: 'cities', query: {sql: 'SELECT 1'}})).toThrow(
      'no query provider'
    );
  });
});
