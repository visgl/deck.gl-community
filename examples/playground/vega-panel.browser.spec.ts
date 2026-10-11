// deck.gl-community
// SPDX-License-Identifier: MIT
import {afterEach, expect, test, vi} from 'vitest';
import {mountStandalonePlayground} from './standalone';
import {loadTextEditorMonacoRuntime} from '../../modules/panels/src/leaf-panels/text-editor/text-editor-panel-monaco-runtime';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
});

test('edits declarative Vega, retains invalid drafts and releases the preview on tab changes', async () => {
  const originalFetch = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    if (String(input).includes('tiles.openfreemap.org')) {
      return Promise.resolve(Response.json({version: 8, sources: {}, layers: []}));
    }
    return originalFetch(input, init);
  });
  const host = document.createElement('div');
  host.style.cssText = 'width:1000px;height:650px';
  document.body.append(host);
  const unmount = mountStandalonePlayground(host, {enableTools: false});
  cleanup = () => {
    unmount();
    host.remove();
  };
  const clickTab = (name: string) =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('[data-panel-tabs] button'))
      .find(button => button.textContent === name)!
      .click();
  clickTab('Vega');
  await expect
    .poll(() => host.querySelector('[data-vega-preview] canvas'), {timeout: 20000})
    .not.toBeNull();
  await expect.poll(() => host.querySelector('[data-vega-preview] select')).not.toBeNull();
  const overlay = host.querySelector<HTMLElement>('[data-vega-preview]')!;
  const preview = host.querySelector<HTMLElement>('.deckgl-playground-preview')!;
  const toggleSidebar = () =>
    host.querySelector<HTMLButtonElement>('[data-sidebar-handle-button]')!.click();
  toggleSidebar();
  await expect
    .poll(() => overlay.getBoundingClientRect().left)
    .toBe(preview.getBoundingClientRect().left);
  toggleSidebar();
  await expect
    .poll(() => overlay.getBoundingClientRect().left - preview.getBoundingClientRect().left)
    .toBe(440);
  const layout = host.querySelector<HTMLSelectElement>('[data-vega-preview] select')!;
  layout.value = 'scatter';
  layout.dispatchEvent(new Event('change'));
  const {monaco} = await loadTextEditorMonacoRuntime();
  await expect
    .poll(() =>
      monaco.editor.getModels().find(model => model.uri.toString().includes('vega-json-'))
    )
    .toBeDefined();
  const model = monaco.editor
    .getModels()
    .find(model => model.uri.toString().includes('vega-json-'))!;
  const valid = model.getValue();
  const canvas = host.querySelector('[data-vega-preview] canvas');
  model.setValue('{');
  await expect
    .poll(() => host.querySelector('[role=alert]:not([hidden])')?.textContent)
    .toBeTruthy();
  expect(host.querySelector('[data-vega-preview] canvas')).toBe(canvas);
  const jsonError = host.querySelector('[role=alert]:not([hidden])')?.textContent;
  model.setValue(JSON.stringify({...JSON.parse(valid), marks: [{type: 'not-a-mark'}]}));
  await expect
    .poll(() => host.querySelector('[role=alert]:not([hidden])')?.textContent)
    .not.toBe(jsonError);
  expect(host.querySelector('[data-vega-preview] canvas')).toBe(canvas);
  model.setValue(valid);
  await expect.poll(() => host.querySelector('[data-vega-preview] canvas')).not.toBe(canvas);
  const picker = host.querySelector<HTMLSelectElement>('[aria-label="Vega example"]')!;
  picker.value = 'bar-chart';
  picker.dispatchEvent(new Event('change'));
  await expect
    .poll(() => host.querySelector('[data-vega-preview] input[type=range]'))
    .not.toBeNull();
  model.setValue('{');
  await expect
    .poll(() => host.querySelector('[role=alert]:not([hidden])')?.textContent)
    .toBeTruthy();
  clickTab('JSON');
  await expect.poll(() => host.querySelector('[data-vega-preview]')).toBeNull();
  expect(canvas?.isConnected).toBe(false);
  clickTab('Vega');
  await expect
    .poll(() => host.querySelector('[role=alert]:not([hidden])')?.textContent)
    .toBeTruthy();
  unmount();
  expect(host.querySelector('canvas')).toBeNull();
}, 60000);
