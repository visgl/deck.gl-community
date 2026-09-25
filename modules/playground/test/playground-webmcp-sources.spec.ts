// deck.gl-community
// SPDX-License-Identifier: MIT

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {registerPlaygroundTools} from '../src/playground-webmcp';
import {decodePlaygroundArrow} from '../src/runtime/decode-playground-arrow';
import {PlaygroundDataSourceManager} from '../src/runtime/playground-data-source-manager';
import {MAX_DATA_BYTES, validatePlaygroundRows} from '../src/runtime/playground-webmcp-data';
import {
  PlaygroundWebMCPSources,
  type PlaygroundWebMCPDataSources
} from '../src/runtime/playground-webmcp-sources';

vi.mock('../src/runtime/decode-playground-arrow', () => ({decodePlaygroundArrow: vi.fn()}));

type Tool = {
  name: string;
  annotations: Record<string, boolean>;
  execute(input: unknown, options?: {signal: AbortSignal}): Promise<unknown>;
};

const CLEANUPS: (() => void | Promise<void>)[] = [];

async function createTools(grants: Omit<PlaygroundWebMCPDataSources, 'manager'> = {}) {
  const manager = new PlaygroundDataSourceManager();
  const tools = new Map<string, Tool>();
  const lifetime = new AbortController();
  const context = {
    async registerTool(tool: Tool, {signal}: {signal: AbortSignal}) {
      signal.throwIfAborted();
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), {once: true});
    }
  };
  const dispose = await registerPlaygroundTools(
    {
      parentElement: {ownerDocument: {modelContext: context}} as unknown as HTMLElement,
      setTemplate: vi.fn()
    },
    {templates: ['points'], dataSources: {manager, ...grants}},
    lifetime.signal
  );
  CLEANUPS.push(() => manager.finalize(), dispose!);
  const invoke = (name: string, input: unknown = {}, signal?: AbortSignal) =>
    tools.get(`playground.${name}`)!.execute(input, signal ? {signal} : undefined);
  return {manager, tools, invoke, dispose: dispose!, lifetime};
}

function getSource(manager: PlaygroundDataSourceManager, id = 'points') {
  const source = manager.subscribe({dataSourceId: id, consumerId: 'assertion', onChange() {}});
  manager.unsubscribe({consumerId: 'assertion'});
  return source;
}

function deferRows() {
  let resolve!: (rows: Record<string, unknown>[]) => void;
  const promise = new Promise<Record<string, unknown>[]>(complete => {
    resolve = complete;
  });
  return {promise, resolve};
}

beforeEach(() => vi.mocked(decodePlaygroundArrow).mockReset());
afterEach(async () => {
  for (const cleanup of CLEANUPS.splice(0).reverse()) await cleanup();
});

describe('WebMCP source permissions and inspection', () => {
  it('rejects malformed source grants before tool registration', async () => {
    const manager = new PlaygroundDataSourceManager();
    const registerTool = vi.fn();
    for (const dataSources of [
      null,
      {},
      {manager: {}},
      {manager, read: ['../points']},
      {manager, write: ['points\n']},
      {manager, read: ['x'.repeat(33)]},
      {manager, write: Array(33).fill('points')},
      {manager, read: ['points'], extra: true},
      {manager: new PlaygroundDataSourceManager({protocol: 'p'}), write: ['points']}
    ]) {
      await expect(
        registerPlaygroundTools(
          {
            parentElement: {
              ownerDocument: {modelContext: {registerTool}}
            } as unknown as HTMLElement,
            setTemplate: vi.fn()
          },
          {templates: ['points'], dataSources: dataSources as PlaygroundWebMCPDataSources},
          new AbortController().signal
        )
      ).rejects.toThrow();
    }
    expect(registerTool).not.toHaveBeenCalled();
  });

  it('copies explicit grants and never inherits read or write permissions', async () => {
    const manager = new PlaygroundDataSourceManager();
    const inherited = Object.assign(Object.create({read: ['hidden'], write: ['hidden']}), {
      manager
    });
    const sources = new PlaygroundWebMCPSources(inherited);
    expect(sources.list()).toEqual([]);
    expect(() => sources.inspect('hidden', 1)).toThrow();
    await expect(
      sources.set({id: 'hidden', format: 'json', data: '[]'}, new AbortController().signal)
    ).rejects.toThrow();
    const read = ['points'];
    const write = ['points'];
    const {invoke} = await createTools({read, write});
    read.push('hidden');
    write.push('hidden');
    expect(await invoke('list_sources')).toEqual({
      sources: [{id: 'points', status: 'missing', readable: true, writable: true}]
    });
    await expect(invoke('inspect_source', {id: 'hidden'})).rejects.toThrow(
      'Invalid Playground tool input'
    );
    await expect(invoke('set_source', {id: 'hidden', format: 'json', data: '[]'})).rejects.toThrow(
      'Invalid Playground tool input'
    );
  });

  it('discloses only readable status and never unlisted sources or write-only existence', async () => {
    const {manager, invoke, tools} = await createTools({
      read: ['points', 'pending', 'failed', 'missing'],
      write: ['points', 'write-only']
    });
    manager.add({dataSourceId: 'points', dataSource: {data: [{value: 1}]}});
    manager.add({dataSourceId: 'unlisted', dataSource: {data: [{detail: 'not exposed'}]}});
    manager.add({dataSourceId: 'write-only', dataSource: {data: [{detail: 'not readable'}]}});
    manager.add({dataSourceId: 'pending', dataSource: new Promise(() => {})});
    manager.add({dataSourceId: 'failed', dataSource: Promise.reject(new Error('source details'))});
    await vi.waitFor(() =>
      expect(manager.listDataSources().find(entry => entry.dataSourceId === 'failed')?.status).toBe(
        'error'
      )
    );
    const sources = [
      {id: 'points', status: 'ready', readable: true, writable: true},
      {id: 'pending', status: 'pending', readable: true, writable: false},
      {id: 'failed', status: 'error', readable: true, writable: false},
      {id: 'missing', status: 'missing', readable: true, writable: false},
      {id: 'write-only', readable: false, writable: true}
    ];
    expect(await invoke('list_sources')).toEqual({sources});
    for (const entry of sources.slice(1, 4)) {
      expect(await invoke('inspect_source', {id: entry.id})).toEqual(entry);
    }
    for (const id of ['unlisted', 'write-only']) {
      await expect(invoke('inspect_source', {id})).rejects.toThrow('Invalid Playground tool input');
    }
    expect(tools.get('playground.inspect_source')!.annotations).toMatchObject({
      readOnlyHint: true,
      untrustedContentHint: true
    });
    expect(tools.get('playground.set_source')!.annotations).toMatchObject({
      readOnlyHint: false,
      consequentialHint: true
    });
  });

  it('copies bounded row samples and leaves expression-like strings opaque', async () => {
    const {manager, invoke} = await createTools({read: ['points']});
    const rows = Array.from({length: 12}, (_, id) => ({id, nested: {label: '@@=value()'}}));
    manager.add({dataSourceId: 'points', dataSource: {data: rows}});
    const result = (await invoke('inspect_source', {id: 'points'})) as {
      rowCount: number;
      columns: string[];
      sample: typeof rows;
    };
    expect(result).toMatchObject({
      rowCount: 12,
      columns: ['id', 'nested'],
      sample: rows.slice(0, 5)
    });
    result.sample[0].nested.label = 'changed';
    expect(rows[0].nested.label).toBe('@@=value()');
    expect(await invoke('inspect_source', {id: 'points', limit: 0})).toMatchObject({sample: []});
    expect(await invoke('inspect_source', {id: 'points', limit: 10})).toMatchObject({
      sample: rows.slice(0, 10)
    });
    manager.add({dataSourceId: 'points', dataSource: {data: [{text: 'x'.repeat(16 * 1024)}]}});
    await expect(invoke('inspect_source', {id: 'points'})).rejects.toThrow(
      'Playground action failed'
    );
  });

  it('rejects unknown, extra and inherited arguments before reading or changing sources', async () => {
    const {manager, invoke} = await createTools({read: ['points'], write: ['points']});
    const source = {data: [{id: 1}]};
    manager.add({dataSourceId: 'points', dataSource: source});
    for (const input of [
      null,
      [],
      {},
      {id: 'other'},
      {id: 'points', extra: true},
      {id: 'points', limit: -1},
      {id: 'points', limit: 11},
      {id: 'points', limit: 1.5},
      Object.create({id: 'points'})
    ]) {
      await expect(invoke('inspect_source', input)).rejects.toThrow(
        'Invalid Playground tool input'
      );
    }
    const valid = {id: 'points', format: 'json', data: '[]'};
    for (const input of [
      null,
      [],
      {},
      {...valid, id: 'other'},
      {...valid, format: 'csv'},
      {...valid, data: []},
      {...valid, extra: true},
      Object.create(valid)
    ]) {
      await expect(invoke('set_source', input)).rejects.toThrow('Invalid Playground tool input');
    }
    await expect(invoke('list_sources', {extra: true})).rejects.toThrow(
      'Invalid Playground tool input'
    );
    expect(getSource(manager)).toBe(source);
  });

  it('inspects source and row descriptors without invoking getters', async () => {
    const {manager, invoke} = await createTools({read: ['points']});
    const sourceGetter = vi.fn(() => [{id: 1}]);
    manager.add({
      dataSourceId: 'points',
      dataSource: Object.defineProperty({}, 'data', {get: sourceGetter})
    });
    expect(await invoke('inspect_source', {id: 'points'})).toMatchObject({inspectable: false});
    expect(sourceGetter).not.toHaveBeenCalled();
    const rowGetter = vi.fn(() => ({id: 1}));
    const rows = Object.defineProperty([], '0', {get: rowGetter, enumerable: true});
    manager.add({dataSourceId: 'points', dataSource: {data: rows}});
    await expect(invoke('inspect_source', {id: 'points'})).rejects.toThrow(
      'Playground action failed'
    );
    expect(rowGetter).not.toHaveBeenCalled();
  });

  it('registers only the granted read and write capabilities', async () => {
    const readOnly = await createTools({read: ['points']});
    expect(readOnly.tools.has('playground.inspect_source')).toBe(true);
    expect(readOnly.tools.has('playground.set_source')).toBe(false);
    const writeOnly = await createTools({write: ['points']});
    expect(writeOnly.tools.has('playground.inspect_source')).toBe(false);
    expect(writeOnly.tools.has('playground.set_source')).toBe(true);
  });
});

describe('WebMCP source imports', () => {
  it('creates and replaces only approved sources without interpreting row markers', async () => {
    const {manager, invoke} = await createTools({write: ['points']});
    const rows = [{label: '@@#value', nested: {'@@type': 'Unregistered', '@@function': 'unused'}}];
    expect(
      await invoke('set_source', {id: 'points', format: 'json', data: JSON.stringify(rows)})
    ).toEqual({id: 'points', rowCount: 1, status: 'registered'});
    expect(getSource(manager)).toEqual({data: rows});
    const close = vi.fn();
    manager.add({dataSourceId: 'points', dataSource: {data: rows, close}});
    await invoke('set_source', {id: 'points', format: 'json', data: '[{"id":2}]'});
    expect(close).toHaveBeenCalledTimes(1);
    expect(getSource(manager)).toEqual({data: [{id: 2}]});
    expect(decodePlaygroundArrow).not.toHaveBeenCalled();
  });

  it('retains the source and consumers after malformed or over-limit JSON imports', async () => {
    const {manager, invoke} = await createTools({write: ['points']});
    const source = {data: [{id: 'original'}], close: vi.fn()};
    manager.add({dataSourceId: 'points', dataSource: source});
    const onChange = vi.fn();
    manager.subscribe({dataSourceId: 'points', consumerId: 'preview', onChange});
    const nested = Array.from({length: 17}).reduce<unknown>(value => ({child: value}), null);
    for (const data of [
      '{',
      '{}',
      '[1]',
      '[{"value":1e400}]',
      JSON.stringify([{text: 'é'.repeat(MAX_DATA_BYTES / 2)}]),
      JSON.stringify(Array(10_001).fill({})),
      JSON.stringify([{nested}]),
      JSON.stringify([Object.fromEntries(Array.from({length: 129}, (_, i) => [`field${i}`, i]))]),
      JSON.stringify(Array.from({length: 10_000}, () => ({values: Array(10).fill(0)}))),
      ...['__proto__', 'prototype', 'constructor'].map(key => JSON.stringify([{[key]: true}]))
    ]) {
      await expect(invoke('set_source', {id: 'points', format: 'json', data})).rejects.toThrow(
        'Playground action failed'
      );
      expect(getSource(manager)).toBe(source);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(source.close).not.toHaveBeenCalled();
  });

  it('decodes bounded Arrow IPC and rejects malformed input before decoding', async () => {
    const {manager, invoke} = await createTools({write: ['points']});
    vi.mocked(decodePlaygroundArrow).mockResolvedValueOnce([{id: 3}]);
    expect(await invoke('set_source', {id: 'points', format: 'arrow', data: 'AQIDBA=='})).toEqual({
      id: 'points',
      rowCount: 1,
      status: 'registered'
    });
    expect(vi.mocked(decodePlaygroundArrow).mock.calls[0][0]).toEqual(new Uint8Array([1, 2, 3, 4]));
    const accepted = getSource(manager);
    for (const data of [
      '',
      '%%%%',
      'AQI',
      'AQID\n',
      'A'.repeat(4 * Math.ceil(MAX_DATA_BYTES / 3))
    ]) {
      await expect(invoke('set_source', {id: 'points', format: 'arrow', data})).rejects.toThrow();
      expect(getSource(manager)).toBe(accepted);
    }
    expect(decodePlaygroundArrow).toHaveBeenCalledTimes(1);
  });

  it.each([
    'execution',
    'unregister',
    'lifetime'
  ])('does not mutate after %s cancels decoding', async mode => {
    const {manager, invoke, dispose, lifetime} = await createTools({write: ['points']});
    const source = {data: [{id: 'original'}]};
    manager.add({dataSourceId: 'points', dataSource: source});
    const decoded = deferRows();
    vi.mocked(decodePlaygroundArrow).mockReturnValueOnce(decoded.promise);
    const execution = new AbortController();
    const pending = invoke(
      'set_source',
      {id: 'points', format: 'arrow', data: 'AQIDBA=='},
      execution.signal
    );
    expect(decodePlaygroundArrow).toHaveBeenCalledTimes(1);
    if (mode === 'execution') execution.abort();
    else if (mode === 'unregister') dispose();
    else lifetime.abort();
    decoded.resolve([{id: 'imported'}]);
    await expect(pending).rejects.toThrow('Playground action failed');
    expect(getSource(manager)).toBe(source);
  });

  it.each([
    'replace',
    'force-update'
  ])('rejects concurrent imports and preserves a host %s during decoding', async update => {
    const {manager, invoke} = await createTools({write: ['points']});
    const source = {data: [{id: 'original'}]};
    manager.add({dataSourceId: 'points', dataSource: source});
    const decoded = deferRows();
    vi.mocked(decodePlaygroundArrow).mockReturnValueOnce(decoded.promise);
    const pending = invoke('set_source', {id: 'points', format: 'arrow', data: 'AQIDBA=='});
    await expect(invoke('set_source', {id: 'points', format: 'json', data: '[]'})).rejects.toThrow(
      'Playground action failed'
    );
    const replacement = update === 'replace' ? {data: [{id: 'host-update'}]} : source;
    if (update === 'force-update') source.data = [{id: 'host-update'}];
    manager.add({dataSourceId: 'points', dataSource: replacement, forceUpdate: true});
    decoded.resolve([{id: 'imported'}]);
    await expect(pending).rejects.toThrow('Playground action failed');
    expect(getSource(manager)).toBe(replacement);
    await invoke('set_source', {id: 'points', format: 'json', data: '[]'});
    expect(getSource(manager)).toEqual({data: []});
  });
});

describe('WebMCP row validation', () => {
  it('copies JSON objects without executing getters or serialization hooks', () => {
    const getter = vi.fn(() => 'value');
    const serialize = vi.fn(() => ({value: 'rewritten'}));
    const row = Object.defineProperty({}, 'value', {get: getter, enumerable: true});
    expect(() => validatePlaygroundRows([row])).toThrow();
    expect(() => validatePlaygroundRows([{toJSON: serialize}])).toThrow();
    const rowGetter = vi.fn(() => ({}));
    const accessorRows = Object.defineProperty([], '0', {get: rowGetter, enumerable: true});
    expect(() => validatePlaygroundRows(accessorRows)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
    expect(rowGetter).not.toHaveBeenCalled();
    const rows = [{nested: [true, null, 5, {value: '@@=literal'}]}];
    const copy = validatePlaygroundRows(rows);
    expect(copy).toEqual(rows);
    expect(copy[0].nested).not.toBe(rows[0].nested);
  });

  it.each([
    new Date(),
    Object.create({inherited: true}),
    {value: undefined},
    {value: Infinity},
    {value: new Array(2)},
    {value: 1n}
  ])('rejects non-JSON row values (case %#)', row => {
    expect(() => validatePlaygroundRows([row])).toThrow();
  });
});
