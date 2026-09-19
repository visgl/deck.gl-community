// deck.gl-community
// SPDX-License-Identifier: MIT

import {beforeEach, describe, expect, test, vi} from 'vitest';
import {PlaygroundDataSourceRegistry} from '../src/runtime/playground-data-source-registry';
import type {PlaygroundDataBinding} from '../src/runtime/playground-registry';

describe('playground data source registry', () => {
  let registry: PlaygroundDataSourceRegistry;
  beforeEach(() => {
    registry = new PlaygroundDataSourceRegistry();
  });
  test('independent producers register and clean up their own named sources', () => {
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
    expect(registry.unregister('missing')).toBe(false);
    expect(observations).toEqual([
      ['points', points],
      ['paths', paths],
      ['points', undefined],
      ['paths', undefined]
    ]);
  });

  test('cleanup never removes a later registration even with the same binding object', () => {
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
    const data = Array.from({length: 100_000}, (_, id) => ({id}));
    const read = vi.fn(() => {
      throw new Error('Rows must not be inspected during registration');
    });
    Object.defineProperty(data[0], 'opaque', {enumerable: true, get: read});
    const getRowId = (row: {id: number}) => row.id;
    const binding = {data, getRowId};
    registry.register('points', binding);
    const registered = registry.get('points')!;
    expect(Object.isFrozen(registered)).toBe(true);
    expect(registered.data).toBe(data);
    expect(Object.isFrozen(data)).toBe(false);
    expect(Object.isFrozen(data[0])).toBe(false);
    expect(read).not.toHaveBeenCalled();
    binding.data = [];
    binding.getRowId = () => -1;
    expect(registered.data).toBe(data);
    expect(registered.getRowId).toBe(getRowId);
  });

  test('rejects invalid names and bindings before replacing sources or notifying', () => {
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
    const secondRegistry = new PlaygroundDataSourceRegistry();
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const data = [name];
      registry.register(name, {data});
      expect(registry.get(name)?.data).toBe(data);
      expect(secondRegistry.get(name)).toBeUndefined();
    }
    secondRegistry.register('__proto__', {data: ['separate']});
    registry.unregister('__proto__');
    expect(secondRegistry.get('__proto__')?.data).toEqual(['separate']);
  });

  test('cleanup remains safe when a subscriber replaces a source during registration', () => {
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
    const data = [{id: 1}];
    const loader = vi.fn(async () => ({data}));
    const consumers = [vi.fn(), vi.fn()];
    for (const consumer of consumers) {
      registry.subscribe(name => consumer(registry.getState(name)?.status));
    }
    registry.register('points', loader);
    const initialState = registry.getState('points');
    expect(initialState).toEqual({status: 'loading'});
    expect(Object.isFrozen(initialState)).toBe(true);
    expect(registry.get('points')).toBeUndefined();
    expect(loader).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(registry.getState('points')).toEqual({status: 'ready'}));
    expect(initialState).toEqual({status: 'loading'});
    expect(registry.get('points')?.data).toBe(data);
    expect(Object.isFrozen(registry.get('points'))).toBe(true);
    expect(loader).toHaveBeenCalledTimes(1);
    for (const consumer of consumers) {
      expect(consumer.mock.calls).toEqual([['loading'], ['ready']]);
    }
  });

  test('supports synchronous loaders with the same deferred lifecycle', async () => {
    const data = [{id: 1}];
    registry.register('points', () => ({data}));
    expect(registry.getState('points')).toEqual({status: 'loading'});
    await vi.waitFor(() => expect(registry.get('points')?.data).toBe(data));
  });

  test.each([
    ['rejection', () => Promise.reject(new Error('Request failed')), 'Request failed'],
    [
      'throw',
      () => {
        throw new Error('Request failed');
      },
      'Request failed'
    ],
    ['non-Error rejection', () => Promise.reject('Unavailable'), 'Unavailable'],
    ['invalid rows', () => ({data: null}), 'must contain a row array'],
    ['invalid identity', () => ({data: [], getRowId: 'id'}), 'getRowId must be a function']
  ])('retains %s as an inspectable loader error', async (_name, load, message) => {
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register('points', load as () => PlaygroundDataBinding);
    await vi.waitFor(() => expect(registry.getState('points')?.status).toBe('error'));
    expect(registry.getState('points')).toMatchObject({
      error: {message: expect.stringContaining(message)}
    });
    expect(registry.get('points')).toBeUndefined();
    expect(listener.mock.calls).toEqual([['points'], ['points']]);
  });

  test.each([
    'replace',
    'remove'
  ])('aborts loaders on %s and ignores stale completion', async action => {
    let resolve!: (binding: PlaygroundDataBinding) => void;
    let reject!: (error: Error) => void;
    let signal!: AbortSignal;
    const listener = vi.fn();
    registry.subscribe(listener);
    const cleanup = registry.register('points', options => {
      signal = options.signal;
      return new Promise((complete, fail) => {
        resolve = complete;
        reject = fail;
      });
    });
    await Promise.resolve();
    expect(signal.aborted).toBe(false);
    const replacement = [{id: 2}];
    if (action === 'replace') registry.register('points', {data: replacement});
    cleanup();
    expect(signal.aborted).toBe(true);
    if (action === 'replace') resolve({data: [{id: 1}]});
    else reject(new Error('Request cancelled'));
    await new Promise(result => setTimeout(result, 0));
    expect(registry.get('points')?.data).toBe(action === 'replace' ? replacement : undefined);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('does not start loaders removed or replaced before their first microtask', async () => {
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
});
