// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, expect, test, vi} from 'vitest';
import {Playground, PlaygroundDataSourceManager} from '../src/index';

const ORIGINAL_CONTEXT = Object.getOwnPropertyDescriptor(document, 'modelContext');
const PLAYGROUNDS: Playground[] = [];

function mountPlayground() {
  const parentElement = document.createElement('div');
  document.body.append(parentElement);
  const onChange = vi.fn();
  const playground = new Playground({
    parentElement,
    templates: {first: {value: 1}, second: {value: 2}, constructor: {value: 3}},
    onChange
  });
  PLAYGROUNDS.push(playground);
  return {playground, onChange};
}

afterEach(() => {
  for (const playground of PLAYGROUNDS.splice(0)) {
    playground.finalize();
    playground.parentElement.remove();
  }
  if (ORIGINAL_CONTEXT) Object.defineProperty(document, 'modelContext', ORIGINAL_CONTEXT);
  else Reflect.deleteProperty(document, 'modelContext');
});

test('exposes only opted-in templates and revokes tools with the playground', async () => {
  const tools = new Map<string, any>();
  const context = {
    registerTool: vi.fn(async (tool, {signal}) => {
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), {once: true});
    })
  };
  Object.defineProperty(document, 'modelContext', {configurable: true, value: context});
  const {playground, onChange} = mountPlayground();
  expect(context.registerTool).not.toHaveBeenCalled();
  await expect(playground.registerWebMCP({templates: ['missing']})).rejects.toThrow();
  await playground.registerWebMCP({templates: ['second', 'constructor']});
  expect([...tools.keys()]).toEqual(['playground.list_templates', 'playground.select_template']);
  const select = tools.get('playground.select_template');
  const options = {signal: new AbortController().signal};
  await expect(select.execute({template: 'second'}, options)).resolves.toEqual({
    status: 'requested'
  });
  expect(onChange).toHaveBeenLastCalledWith({value: 2}, expect.any(String));

  playground.setTemplates({first: {value: 1}});
  onChange.mockClear();
  await expect(select.execute({template: 'constructor'}, options)).rejects.toThrow('action failed');
  expect(onChange).not.toHaveBeenCalled();
  playground.finalize();
  expect(tools.size).toBe(0);
  await expect(select.execute({template: 'second'}, options)).rejects.toThrow('unavailable');
  await expect(playground.registerWebMCP({templates: ['first']})).rejects.toThrow('finalized');
});

// Enable the browser's experimental WebMCP feature to exercise its native implementation.
test.skipIf(!('modelContext' in document))(
  'registers and revokes native WebMCP tools',
  async () => {
    const context = (document as any).modelContext;
    const {playground, onChange} = mountPlayground();
    const sources = new PlaygroundDataSourceManager();
    const unregister = await playground.registerWebMCP({
      name: 'native',
      templates: ['second'],
      dataSources: {manager: sources, read: ['points'], write: ['points']}
    });
    const registered = await context.getTools();
    const select = registered.find(
      (tool: {name: string}) => tool.name === 'native.select_template'
    );
    expect(select).toBeDefined();
    // Chromium previews still use serialized input; the current draft accepts an object.
    const input = {template: 'second'};
    await context.executeTool(
      select,
      typeof select.inputSchema === 'string' ? JSON.stringify(input) : input
    );
    expect(onChange).toHaveBeenLastCalledWith({value: 2}, expect.any(String));
    const set = registered.find((tool: {name: string}) => tool.name === 'native.set_source');
    const upload = {id: 'points', format: 'json', data: '[{"position":[0,0]}]'};
    await context.executeTool(
      set,
      typeof set.inputSchema === 'string' ? JSON.stringify(upload) : upload
    );
    expect(sources.subscribe({dataSourceId: 'points', consumerId: 'test', onChange() {}})).toEqual({
      data: [{position: [0, 0]}]
    });
    await sources.finalize();
    unregister!();
    const remaining = await context.getTools();
    expect(remaining.some((tool: {name: string}) => tool.name.startsWith('native.'))).toBe(false);
  }
);
