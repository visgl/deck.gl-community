// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import type {ScatterplotLayer} from '@deck.gl/layers';
import {tableFromArrays, tableToIPC} from 'apache-arrow';
import {afterEach, expect, test, vi} from 'vitest';
import {mountStandalonePlayground} from './standalone';

type Tool = {
  name: string;
  inputSchema: {properties?: Record<string, {enum?: string[]}>};
  execute(input: unknown): Promise<unknown>;
};

const ORIGINAL_CONTEXT = Object.getOwnPropertyDescriptor(document, 'modelContext');
const CLEANUPS: (() => void)[] = [];

function setContext(context: unknown) {
  Object.defineProperty(document, 'modelContext', {configurable: true, value: context});
}

function mount() {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:550px';
  document.body.append(host);
  const setProps = vi.spyOn(Deck.prototype, 'setProps');
  const unmount = mountStandalonePlayground(host, {enableTools: true});
  CLEANUPS.push(() => {
    unmount();
    host.remove();
  });
  const status = host.querySelector('header output')!;
  const toggle = host.querySelector<HTMLButtonElement>('header button')!;
  const ready = async () => {
    await vi.waitFor(() => expect(setProps.mock.contexts.length).toBeGreaterThan(0));
    const deck = setProps.mock.contexts[0] as Deck;
    const layer = () => (deck.props.layers as ScatterplotLayer[])[0];
    await vi.waitFor(() => expect(layer()?.isLoaded).toBe(true), {timeout: 10_000});
    return {layer, canvas: host.querySelector('canvas')!};
  };
  return {host, status, toggle, ready, unmount};
}

afterEach(() => {
  for (const cleanup of CLEANUPS.splice(0).reverse()) cleanup();
  if (ORIGINAL_CONTEXT) Object.defineProperty(document, 'modelContext', ORIGINAL_CONTEXT);
  else Reflect.deleteProperty(document, 'modelContext');
  vi.restoreAllMocks();
});

test('grants only the page templates and points source, preserves imports across tool toggles, and cleans up', async () => {
  const tools = new Map<string, Tool>();
  setContext({
    async registerTool(tool: Tool, {signal}: {signal: AbortSignal}) {
      signal.throwIfAborted();
      tools.set(tool.name, tool);
      signal.addEventListener('abort', () => tools.delete(tool.name), {once: true});
    }
  });
  const {host, status, toggle, ready, unmount} = mount();
  const {layer, canvas} = await ready();
  await vi.waitFor(() => expect(status.textContent).toBe('Browser tools ready'));
  const getTool = (name: string) => tools.get(`playground.${name}`)!;
  expect([...tools.keys()].sort()).toEqual([
    'playground.inspect_source',
    'playground.list_sources',
    'playground.list_templates',
    'playground.reset_view',
    'playground.select_template',
    'playground.set_source'
  ]);
  expect(await getTool('list_templates').execute({})).toEqual({
    templates: ['imported-points', 'scatterplot', 'arcs', 'geojson', 'heatmap']
  });
  expect(await getTool('list_sources').execute({})).toEqual({
    sources: [{id: 'points', status: 'ready', readable: true, writable: true}]
  });
  expect(getTool('set_source').inputSchema.properties?.id.enum).toEqual(['points']);
  for (const [name, input] of [
    ['select_template', {template: 'unknown'}],
    ['inspect_source', {id: 'other'}],
    ['set_source', {id: 'other', format: 'json', data: '[]'}]
  ] as const) {
    await expect(getTool(name).execute(input)).rejects.toThrow('Invalid Playground tool input');
  }

  const setSource = getTool('set_source');
  const jsonRows = [{position: [2, 3], label: 'first'}];
  await setSource.execute({id: 'points', format: 'json', data: JSON.stringify(jsonRows)});
  expect(layer().props.data).toEqual(jsonRows);
  expect(host.querySelector('canvas')).toBe(canvas);
  const bytes = tableToIPC(tableFromArrays({position: [[4, 5]], label: ['second']}));
  await setSource.execute({
    id: 'points',
    format: 'arrow',
    data: btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''))
  });
  const importedRows = layer().props.data;
  expect(importedRows).toEqual([{position: [4, 5], label: 'second'}]);
  expect(host.querySelector('canvas')).toBe(canvas);

  toggle.click();
  expect(status.textContent).toBe('Browser tools disabled');
  expect(tools.size).toBe(0);
  expect(layer().props.data).toBe(importedRows);
  toggle.click();
  await vi.waitFor(() => expect(status.textContent).toBe('Browser tools ready'));
  await expect(setSource.execute({id: 'points', format: 'json', data: '[]'})).rejects.toThrow(
    'unavailable'
  );
  expect(getTool('set_source')).not.toBe(setSource);
  expect(await getTool('inspect_source').execute({id: 'points'})).toMatchObject({
    rowCount: 1,
    sample: importedRows
  });
  expect(layer().props.data).toBe(importedRows);
  expect(host.querySelector('canvas')).toBe(canvas);

  const inspect = getTool('inspect_source');
  unmount();
  expect(tools.size).toBe(0);
  expect(host.children).toHaveLength(0);
  expect(canvas.isConnected).toBe(false);
  await expect(inspect.execute({id: 'points'})).rejects.toThrow('unavailable');
}, 20_000);

test('keeps the editor usable without browser tools and across narrow resizes', async () => {
  setContext(undefined);
  const {editor} = await import('monaco-editor');
  const originalModels = new Set(editor.getModels());
  const {host, status, toggle, ready} = mount();
  const {layer, canvas} = await ready();
  await vi.waitFor(() => expect(status.textContent).toBe('Browser tools unavailable'));
  expect(toggle.disabled).toBe(true);
  await vi.waitFor(() => {
    expect(editor.getModels().filter(model => !originalModels.has(model))).toHaveLength(1);
  });
  const model = editor.getModels().find(model => !originalModels.has(model))!;
  const sidebar = host.querySelector('aside[aria-label="JSON"]')!;
  const dialog = sidebar.querySelector<HTMLElement>('[role="dialog"]')!;
  const close = sidebar.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
  const handle = sidebar.querySelector<HTMLButtonElement>('[data-sidebar-handle-button]')!;
  const expectInsideHost = (element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const parentBounds = host.getBoundingClientRect();
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.left).toBeGreaterThanOrEqual(parentBounds.left);
    expect(bounds.top).toBeGreaterThanOrEqual(parentBounds.top);
    expect(bounds.right).toBeLessThanOrEqual(parentBounds.right);
    expect(bounds.bottom).toBeLessThanOrEqual(parentBounds.bottom);
  };
  host.style.width = '390px';
  await vi.waitFor(() => {
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
    for (const element of [dialog, close, handle]) expectInsideHost(element);
  });
  close.click();
  await vi.waitFor(() => {
    expect(dialog.getAttribute('aria-hidden')).toBe('true');
    expect(handle.getAttribute('aria-label')).toBe('JSON editor');
    expectInsideHost(handle);
    const bounds = handle.getBoundingClientRect();
    expect(
      handle.contains(
        host.ownerDocument.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        )
      )
    ).toBe(true);
  });
  handle.click();
  await vi.waitFor(() => {
    expect(dialog.getAttribute('aria-hidden')).toBe('false');
    expectInsideHost(dialog);
    expectInsideHost(close);
  });
  const document = JSON.parse(model.getValue());
  document.layers[0].getRadius = 13;
  model.setValue(JSON.stringify(document));
  await vi.waitFor(() => expect(layer().props.getRadius).toBe(13));
  expect(host.querySelector('canvas')).toBe(canvas);

  model.setValue('{');
  expect(host.querySelector<HTMLOutputElement>('[data-error]')!.hidden).toBe(false);
  expect(layer().props.getRadius).toBe(13);
  model.setValue(JSON.stringify(document));
  expect(host.querySelector<HTMLOutputElement>('[data-error]')!.hidden).toBe(true);
}, 20_000);
