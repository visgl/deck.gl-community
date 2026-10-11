// deck.gl-community
// SPDX-License-Identifier: MIT
import {afterEach, expect, test, vi} from 'vitest';
import {page} from 'vitest/browser';
import {mountStandalonePlayground} from './standalone';
import {createVegaView} from '../vega/create-vega-view';

vi.mock('../vega/create-vega-view', {spy: true});

import {loadTextEditorMonacoRuntime} from '../../modules/panels/src/leaf-panels/text-editor/text-editor-panel-monaco-runtime';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  vi.restoreAllMocks();
});

test('edits declarative Vega, retains invalid drafts and releases the preview on tab changes', async () => {
  await page.viewport(1100, 800);
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
  const basemapButton = document.createElement('button');
  basemapButton.style.cssText =
    'position:absolute;left:500px;top:10px;width:100px;height:40px;z-index:20';
  basemapButton.textContent = 'Basemap';
  overlay.parentElement!.append(basemapButton);
  const buttonBounds = basemapButton.getBoundingClientRect();
  expect(
    overlay.contains(document.elementFromPoint(buttonBounds.left + 50, buttonBounds.top + 20))
  ).toBe(true);
  const preview = host.querySelector<HTMLElement>('.deckgl-playground-preview')!;
  const getSidebarToggle = () =>
    host.querySelector<HTMLButtonElement>('[data-sidebar-handle-button]')!;
  const assertSidebarToggleVisible = () => {
    const button = getSidebarToggle();
    const bounds = button.getBoundingClientRect();
    expect(
      document
        .elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
        ?.closest('[data-sidebar-handle-button]')
    ).toBe(button);
  };
  const toggleSidebar = () => getSidebarToggle().click();
  assertSidebarToggleVisible();
  toggleSidebar();
  await expect
    .poll(() => overlay.getBoundingClientRect().left)
    .toBe(preview.getBoundingClientRect().left);
  assertSidebarToggleVisible();
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
  const createView = vi.mocked(createVegaView);
  const {createVegaView: originalCreateView} = await vi.importActual<
    typeof import('../vega/create-vega-view')
  >('../vega/create-vega-view');
  let releaseRestore: () => void;
  const restoreGate = new Promise<void>(resolve => {
    releaseRestore = resolve;
  });
  const callsBeforeRestore = createView.mock.calls.length;
  createView.mockImplementationOnce((...args) => {
    const result = originalCreateView(...args);
    return {
      ...result,
      ready: result.ready.then(async view => {
        await restoreGate;
        return view;
      })
    };
  });
  clickTab('Vega');
  await expect.poll(() => createView.mock.calls.length).toBe(callsBeforeRestore + 1);
  await expect
    .poll(
      () => monaco.editor.getModels().find(entry => entry.uri.toString().includes('vega-json-')),
      {timeout: 10000}
    )
    .toBeDefined();
  const restoredModel = monaco.editor
    .getModels()
    .find(entry => entry.uri.toString().includes('vega-json-'))!;
  restoredModel.setValue('{new invalid draft');
  await expect
    .poll(() => host.querySelector('[role=alert]:not([hidden])')?.textContent)
    .toBeTruthy();
  releaseRestore!();
  await expect.poll(() => host.querySelector('[data-vega-preview] canvas')).not.toBeNull();
  await expect
    .poll(() => host.querySelector<HTMLElement>('[data-vega-preview] > div')?.style.visibility)
    .toBe('visible');
  expect(
    monaco.editor
      .getModels()
      .find(entry => entry.uri.toString().includes('vega-json-'))
      ?.getValue()
  ).toBe('{new invalid draft');
  unmount();
  expect(host.querySelector('canvas')).toBeNull();
}, 60000);
