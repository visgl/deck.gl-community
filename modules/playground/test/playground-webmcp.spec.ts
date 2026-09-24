// deck.gl-community
// SPDX-License-Identifier: MIT

import {afterEach, describe, expect, it, vi} from 'vitest';
import {registerPlaygroundTools, type PlaygroundWebMCPOptions} from '../src/playground-webmcp';

type Tool = {
  name: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  execute: (input: unknown, options: {signal: AbortSignal}) => Promise<unknown>;
};

function createContext() {
  const tools = new Map<string, Tool>();
  const signals: AbortSignal[] = [];
  const registerTool = vi.fn(async (tool: Tool, {signal}: {signal: AbortSignal}) => {
    signals.push(signal);
    signal.throwIfAborted();
    if (tools.has(tool.name)) throw new Error('Duplicate tool');
    tools.set(tool.name, tool);
    const unregister = () => {
      if (tools.get(tool.name) === tool) tools.delete(tool.name);
    };
    signal.addEventListener('abort', unregister, {once: true});
  });
  return {tools, signals, registerTool};
}

function createTarget(context?: ReturnType<typeof createContext>) {
  return {
    parentElement: {ownerDocument: {modelContext: context}} as unknown as HTMLElement,
    setTemplate: vi.fn().mockReturnValue({rows: [{secret: 'private'}], config: 'private'})
  };
}

function invoke(tool: Tool, input: unknown = {}, signal = new AbortController().signal) {
  return tool.execute(input, {signal});
}

function registerTools(
  target: Parameters<typeof registerPlaygroundTools>[0],
  options: unknown = {templates: ['safe']},
  signal = new AbortController().signal
) {
  return registerPlaygroundTools(target, options as PlaygroundWebMCPOptions, signal);
}

afterEach(() => vi.unstubAllGlobals());

describe('playground WebMCP tools', () => {
  it('uses only the owner document and registers bounded schemas with explicit annotations', async () => {
    const context = createContext();
    vi.stubGlobal('navigator', {modelContext: context});
    vi.stubGlobal('document', {modelContext: context});
    vi.stubGlobal('modelContext', context);
    expect(await registerTools(createTarget())).toBeNull();
    expect(context.registerTool).not.toHaveBeenCalled();
    const dispose = await registerTools(createTarget(context));
    expect([...context.tools.keys()]).toEqual([
      'playground.list_templates',
      'playground.select_template'
    ]);
    const list = context.tools.get('playground.list_templates')!;
    const select = context.tools.get('playground.select_template')!;
    expect(list.inputSchema).toMatchObject({type: 'object', additionalProperties: false});
    expect(select.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ['template'],
      properties: {template: {enum: ['safe']}}
    });
    expect(list.annotations).toMatchObject({readOnlyHint: true, untrustedContentHint: true});
    expect(select.annotations).toMatchObject({readOnlyHint: false, consequentialHint: true});
    expect(context.signals[0]).toBe(context.signals[1]);
    dispose!();
    expect(context.signals[0].aborted).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    {templates: []},
    {templates: ['']},
    {templates: ['../safe']},
    {templates: ['safe\n']},
    {templates: ['x'.repeat(33)]},
    {templates: Array(33).fill('safe')},
    {templates: ['safe'], name: ''},
    {templates: ['safe'], name: 'x'.repeat(49)},
    {templates: ['safe'], name: 'invalid/name'},
    {templates: ['safe'], name: 'invalid\n'},
    {templates: ['safe'], extra: true},
    Object.create({templates: ['safe']})
  ])('rejects invalid registration options before registering: %j', async options => {
    const context = createContext();
    await expect(registerTools(createTarget(context), options)).rejects.toThrow();
    expect(context.registerTool).not.toHaveBeenCalled();
  });

  it('rejects malformed, extra, unknown and inherited tool arguments without invoking the target', async () => {
    const context = createContext();
    const target = {...createTarget(context), resetView: vi.fn()};
    const dispose = await registerTools(target);
    const select = context.tools.get('playground.select_template')!;
    for (const input of [
      null,
      [],
      'safe',
      {},
      {template: 1},
      {template: 'unknown'},
      {template: 'safe', rows: []},
      Object.create({template: 'safe'}),
      JSON.parse('{"template":"safe","__proto__":{"polluted":true}}')
    ]) {
      await expect(invoke(select, input)).rejects.toThrow('Invalid Playground tool input');
    }
    for (const name of ['list_templates', 'reset_view']) {
      await expect(invoke(context.tools.get(`playground.${name}`)!, {extra: true})).rejects.toThrow(
        'Invalid Playground tool input'
      );
    }
    expect(target.setTemplate).not.toHaveBeenCalled();
    expect(target.resetView).not.toHaveBeenCalled();
    dispose!();
  });

  it('copies the allowlist and exposes only bounded results and sanitized action failures', async () => {
    const context = createContext();
    const target = {...createTarget(context), resetView: vi.fn()};
    const templates = ['safe'];
    const dispose = await registerTools(target, {templates});
    templates.push('private');
    const list = context.tools.get('playground.list_templates')!;
    const select = context.tools.get('playground.select_template')!;
    const result = (await invoke(list)) as {templates: string[]};
    expect(result).toEqual({templates: ['safe']});
    result.templates.push('private');
    expect(await invoke(list)).toEqual({templates: ['safe']});
    await expect(invoke(select, {template: 'private'})).rejects.toThrow(
      'Invalid Playground tool input'
    );
    expect(await invoke(select, {template: 'safe'})).toEqual({status: 'requested'});
    expect(await invoke(context.tools.get('playground.reset_view')!)).toEqual({
      status: 'requested'
    });
    expect(target.setTemplate).toHaveBeenCalledExactlyOnceWith('safe');
    for (const [tool, action, input] of [
      [select, target.setTemplate, {template: 'safe'}],
      [context.tools.get('playground.reset_view')!, target.resetView, {}]
    ] as const) {
      action.mockImplementationOnce(() => {
        throw new Error('private source URL and rows');
      });
      await expect(invoke(tool, input)).rejects.toMatchObject({
        message: 'Playground action failed'
      });
    }
    dispose!();
  });

  it.each([
    'list_templates',
    'select_template'
  ])('rolls back a collision at %s without touching foreign tools', async suffix => {
    const context = createContext();
    const foreign = {name: `playground.${suffix}`} as Tool;
    context.tools.set(foreign.name, foreign);
    await expect(registerTools(createTarget(context))).rejects.toThrow('Duplicate tool');
    expect([...context.tools.values()]).toEqual([foreign]);
    expect(context.signals.every(signal => signal.aborted)).toBe(true);
  });

  it('aborts pending registration and prevents its captured callback from executing', async () => {
    const context = createContext();
    const target = createTarget(context);
    const lifetime = new AbortController();
    const register = context.registerTool.getMockImplementation()!;
    let finish!: () => void;
    context.registerTool.mockImplementationOnce(async (...args) => {
      await register(...args);
      await new Promise<void>(resolve => {
        finish = resolve;
      });
    });
    const pending = registerTools(target, undefined, lifetime.signal);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const callback = context.tools.get('playground.list_templates')!;
    await expect(invoke(callback)).rejects.toThrow('Playground tools are unavailable');
    lifetime.abort();
    finish();
    await expect(pending).rejects.toThrow();
    expect(context.tools.size).toBe(0);
    await expect(invoke(callback)).rejects.toThrow('Playground tools are unavailable');
    expect(target.setTemplate).not.toHaveBeenCalled();
  });

  it('isolates namespaces and rejects canceled invocations and callbacks after abort', async () => {
    const context = createContext();
    const first = createTarget(context);
    const second = createTarget(context);
    const lifetime = new AbortController();
    const dispose = await registerTools(
      first,
      {templates: ['safe'], name: 'first'},
      lifetime.signal
    );
    const disposeSecond = await registerTools(second, {templates: ['safe'], name: 'second'});
    const select = context.tools.get('first.select_template')!;
    await expect(invoke(select, {template: 'safe'}, AbortSignal.abort())).rejects.toThrow(
      'Playground tools are unavailable'
    );
    expect(first.setTemplate).not.toHaveBeenCalled();
    lifetime.abort();
    await expect(invoke(select, {template: 'safe'})).rejects.toThrow(
      'Playground tools are unavailable'
    );
    expect([...context.tools.keys()]).toEqual(['second.list_templates', 'second.select_template']);
    expect(await invoke(context.tools.get('second.select_template')!, {template: 'safe'})).toEqual({
      status: 'requested'
    });
    dispose!();
    dispose!();
    disposeSecond!();
    expect(context.tools.size).toBe(0);
  });
});
