// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('../src/widget-panels/text-editor-panel', () => ({
  TextEditorPanel: class TextEditorPanel {}
}));

let Panels: typeof import('../src/index');

beforeAll(async () => {
  Panels = await import('../src/index');
});

it('exports WidgetHost', () => {
  expect(Panels.WidgetHost).toBeDefined();
});

it('exports WidgetContainerRenderer', () => {
  expect(Panels.WidgetContainerRenderer).toBeDefined();
});

it('exports ToolbarWidget', () => {
  expect(Panels.ToolbarWidget).toBeDefined();
});

it('exports ToastWidget', () => {
  expect(Panels.ToastWidget).toBeDefined();
});

it('exports TextEditorPanel', () => {
  expect(Panels.TextEditorPanel).toBeDefined();
});
