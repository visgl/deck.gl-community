// deck.gl-community
// SPDX-License-Identifier: MIT

import {describe, expect, test, vi} from 'vitest';
import {PlaygroundDataSourceRegistry} from '../src/runtime/playground-data-source-registry';
import type {PlaygroundDataBinding} from '../src/runtime/playground-registry';

describe('playground data source registry', () => {
  test('independent producers register and clean up their own named sources', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const observations: unknown[] = [];
    registry.subscribe(name => observations.push([name, registry.get(name)?.data]));
    const points = [{id: 1}];
    const paths = [{id: 2}];
    const removePoints = registry.register('points', {data: points});
    const removePaths = registry.register('paths', {data: paths});
    expect(registry.get('points')?.data).toBe(points);
    expect(registry.get('paths')?.data).toBe(paths);
    removePoints();
    removePoints();
    expect(registry.get('points')).toBeUndefined();
    expect(registry.get('paths')?.data).toBe(paths);
    removePaths();
    expect(observations).toEqual([
      ['points', points],
      ['paths', paths],
      ['points', undefined],
      ['paths', undefined]
    ]);
  });

  test('cleanup never removes a later registration even with the same binding object', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const binding = {data: [{id: 1}]};
    const firstCleanup = registry.register('points', binding);
    const replacementCleanup = registry.register('points', binding);
    firstCleanup();
    expect(registry.get('points')?.data).toBe(binding.data);
    expect(registry.unregister('points')).toBe(true);
    registry.register('points', binding);
    replacementCleanup();
    expect(registry.get('points')?.data).toBe(binding.data);
  });

  test('preserves 100,000 rows and their identities without inspecting or freezing payloads', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const data = Array.from({length: 100_000}, (_, id) => ({id}));
    const read = vi.fn(() => {
      throw new Error('Rows must not be inspected during registration');
    });
    Object.defineProperty(data[0], 'opaque', {enumerable: true, get: read});
    const getRowId = (row: {id: number}) => row.id;
    const binding = {data, getRowId};
    registry.register('points', binding);
    const registered = registry.get('points')!;
    expect(registered).not.toBe(binding);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(registered.data).toBe(data);
    expect(registered.data[0]).toBe(data[0]);
    expect(registered.getRowId).toBe(getRowId);
    expect(Object.isFrozen(data)).toBe(false);
    expect(Object.isFrozen(data[0])).toBe(false);
    expect(read).not.toHaveBeenCalled();
    binding.data = [];
    binding.getRowId = () => -1;
    expect(registered.data).toBe(data);
    expect(registered.getRowId).toBe(getRowId);
  });

  test('rejects invalid names and bindings before replacing sources or notifying', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const data = [{id: 1}];
    registry.register('points', {data});
    const listener = vi.fn();
    registry.subscribe(listener);
    for (const name of ['', '   ', null, 42]) {
      expect(() => registry.register(name as string, {data: []})).toThrow('nonempty strings');
    }
    for (const binding of [null, undefined, {}, {data: {}}, {data: new Float32Array(4)}]) {
      expect(() => registry.register('points', binding as PlaygroundDataBinding)).toThrow(
        'must contain a row array'
      );
    }
    for (const getRowId of [null, 'id', 1]) {
      expect(() =>
        registry.register('points', {data: [], getRowId} as unknown as PlaygroundDataBinding)
      ).toThrow('getRowId must be a function');
    }
    expect(registry.get('points')?.data).toBe(data);
    expect(listener).not.toHaveBeenCalled();
  });

  test('keeps prototype-like names and registry instances independent', () => {
    const firstRegistry = new PlaygroundDataSourceRegistry();
    const secondRegistry = new PlaygroundDataSourceRegistry();
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const data = [name];
      firstRegistry.register(name, {data});
      expect(firstRegistry.get(name)?.data).toBe(data);
      expect(secondRegistry.get(name)).toBeUndefined();
    }
    secondRegistry.register('__proto__', {data: ['separate']});
    firstRegistry.unregister('__proto__');
    expect(secondRegistry.get('__proto__')?.data).toEqual(['separate']);
  });

  test('notifies only when registration state changes', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    expect(registry.unregister('missing')).toBe(false);
    registry.register('points', {data: []});
    registry.register('points', {data: []});
    expect(registry.unregister('points')).toBe(true);
    expect(registry.unregister('points')).toBe(false);
    expect(listener.mock.calls).toEqual([['points'], ['points'], ['points']]);
  });

  test('repeated subscriptions of the same callback have independent idempotent cleanup', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const listener = vi.fn();
    const firstCleanup = registry.subscribe(listener);
    const secondCleanup = registry.subscribe(listener);
    registry.register('points', {data: []});
    expect(listener).toHaveBeenCalledTimes(2);
    firstCleanup();
    firstCleanup();
    registry.unregister('points');
    expect(listener).toHaveBeenCalledTimes(3);
    secondCleanup();
    registry.register('points', {data: []});
    expect(listener).toHaveBeenCalledTimes(3);
  });

  test('dispatches a snapshot when listeners subscribe or unsubscribe during notification', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const calls: string[] = [];
    const lateListener = () => calls.push('late');
    let removeSecond = () => {};
    const removeFirst = registry.subscribe(() => {
      calls.push('first');
      removeSecond();
      registry.subscribe(lateListener);
    });
    removeSecond = registry.subscribe(() => calls.push('second'));
    registry.register('points', {data: []});
    expect(calls).toEqual(['first', 'second']);
    removeFirst();
    registry.unregister('points');
    expect(calls).toEqual(['first', 'second', 'late']);
  });

  test('notifies remaining subscribers and aggregates errors after mutation', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const firstError = new Error('first subscriber failed');
    const secondError = new Error('second subscriber failed');
    registry.subscribe(() => {
      throw firstError;
    });
    const observer = vi.fn(name => registry.get(name));
    registry.subscribe(observer);
    registry.subscribe(() => {
      throw secondError;
    });
    const data = [{id: 1}];
    expect(() => registry.register('points', {data})).toThrow(AggregateError);
    expect(registry.get('points')?.data).toBe(data);
    expect(observer.mock.results[0].value.data).toBe(data);
    try {
      registry.unregister('points');
      expect.fail('Expected subscriber errors');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([firstError, secondError]);
    }
    expect(registry.get('points')).toBeUndefined();
    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.results[1].value).toBeUndefined();
  });

  test('cleanup remains safe when a subscriber replaces a source during registration', () => {
    const registry = new PlaygroundDataSourceRegistry();
    const replacement = [{id: 2}];
    const unsubscribe = registry.subscribe(name => {
      unsubscribe();
      registry.register(name, {data: replacement});
    });
    const cleanup = registry.register('points', {data: [{id: 1}]});
    cleanup();
    expect(registry.get('points')?.data).toBe(replacement);
  });

  test('starts a loader once in a microtask and shares readiness with independent consumers', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const data = [{id: 1}];
    const loader = vi.fn(async () => ({data}));
    const firstConsumer = vi.fn(name => registry.getState(name)?.status);
    const secondConsumer = vi.fn(name => registry.getState(name)?.status);
    registry.subscribe(firstConsumer);
    registry.subscribe(secondConsumer);
    registry.register('points', loader);
    const initialState = registry.getState('points');
    expect(initialState).toEqual({status: 'loading'});
    expect(Object.isFrozen(initialState)).toBe(true);
    expect(registry.get('points')).toBeUndefined();
    expect(registry.get('points')).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(registry.getState('points')).toEqual({status: 'ready'}));
    expect(initialState).toEqual({status: 'loading'});
    expect(registry.get('points')?.data).toBe(data);
    expect(Object.isFrozen(registry.get('points'))).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(firstConsumer.mock.results.map(result => result.value)).toEqual(['loading', 'ready']);
    expect(secondConsumer.mock.results.map(result => result.value)).toEqual(['loading', 'ready']);
  });

  test('supports synchronous loaders with the same deferred lifecycle', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const data = [{id: 1}];
    registry.register('points', () => ({data}));
    expect(registry.getState('points')).toEqual({status: 'loading'});
    await vi.waitFor(() => expect(registry.get('points')?.data).toBe(data));
  });

  test('retains loader rejection and validation failures as inspectable error states', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const error = new Error('Request failed');
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register('rejected', () => Promise.reject(error));
    registry.register('thrown', () => {
      throw error;
    });
    registry.register('nonError', () => Promise.reject('Unavailable'));
    registry.register('invalidRows', () => ({data: null}));
    registry.register(
      'invalidId',
      () => ({data: [], getRowId: 'id'}) as unknown as PlaygroundDataBinding
    );
    await vi.waitFor(() => expect(registry.getState('invalidId')?.status).toBe('error'));
    expect(registry.getState('rejected')).toEqual({status: 'error', error});
    expect(registry.getState('thrown')).toEqual({status: 'error', error});
    expect(registry.getState('nonError')).toEqual({
      status: 'error',
      error: new Error('Unavailable')
    });
    expect(registry.getState('invalidRows')).toMatchObject({
      status: 'error',
      error: {message: 'Playground data source "invalidRows" must contain a row array'}
    });
    expect(registry.getState('invalidId')).toMatchObject({
      status: 'error',
      error: {message: 'Playground data source "invalidId" getRowId must be a function'}
    });
    expect(registry.get('rejected')).toBeUndefined();
    expect(registry.get('invalidRows')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(10);
  });

  test('aborts replaced loaders and ignores their stale resolutions and cleanup', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    let resolve: (binding: PlaygroundDataBinding) => void;
    let signal: AbortSignal;
    const cleanup = registry.register('points', options => {
      signal = options.signal;
      return new Promise(result => {
        resolve = result;
      });
    });
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    const replacement = [{id: 2}];
    registry.register('points', {data: replacement});
    expect(signal.aborted).toBe(true);
    cleanup();
    resolve({data: [{id: 1}]});
    await new Promise(result => setTimeout(result, 0));
    expect(registry.get('points')?.data).toBe(replacement);
    expect(registry.getState('points')).toEqual({status: 'ready'});
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('aborts removed loaders and ignores stale rejections without restoring a source', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    let reject: (error: Error) => void;
    let signal: AbortSignal;
    const cleanup = registry.register('points', options => {
      signal = options.signal;
      return new Promise((_resolve, fail) => {
        reject = fail;
      });
    });
    await Promise.resolve();
    cleanup();
    expect(signal.aborted).toBe(true);
    reject(new Error('Request cancelled'));
    await new Promise(result => setTimeout(result, 0));
    expect(registry.get('points')).toBeUndefined();
    expect(registry.getState('points')).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('does not start loaders removed or replaced before their first microtask', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const loader = vi.fn(async () => ({data: []}));
    const cleanup = registry.register('removed', loader);
    cleanup();
    registry.register('replaced', loader);
    registry.register('replaced', {data: []});
    await new Promise(result => setTimeout(result, 0));
    expect(loader).not.toHaveBeenCalled();
    expect(registry.getState('removed')).toBeUndefined();
    expect(registry.getState('replaced')).toEqual({status: 'ready'});
  });

  test('reports asynchronous subscriber failures without losing readiness or other consumers', async () => {
    const registry = new PlaygroundDataSourceRegistry();
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const listenerError = new Error('Subscriber failed');
    const observer = vi.fn();
    try {
      registry.subscribe(name => {
        if (registry.getState(name)?.status === 'ready') {
          throw listenerError;
        }
      });
      registry.subscribe(observer);
      registry.register('points', async () => ({data: []}));
      await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
      expect(reportError.mock.calls[0][0]).toBeInstanceOf(AggregateError);
      expect(reportError.mock.calls[0][0].errors).toEqual([listenerError]);
      expect(registry.getState('points')).toEqual({status: 'ready'});
      expect(observer).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
