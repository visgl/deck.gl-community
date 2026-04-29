// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('../src/panels/text-editor-panel', () => ({
  TextEditorPanel: class TextEditorPanel {}
}));

let Panels: typeof import('../src/index');

beforeAll(async () => {
  Panels = await import('../src/index');
});

it('exports PanelManager', () => {
  expect(Panels.PanelManager).toBeDefined();
});

it('exports panel theme primitives', () => {
  expect(Panels.PANEL_THEME_LIGHT).toBeDefined();
  expect(Panels.PANEL_THEME_DARK).toBeDefined();
  expect(Panels.applyPanelTheme).toBeDefined();
});

it('exports PanelContentRenderer', () => {
  expect(Panels.PanelContentRenderer).toBeDefined();
});

it('exports SplitterPanel', () => {
  expect(Panels.SplitterPanel).toBeDefined();
});

it('exports ToolbarPanelContainer', () => {
  expect(Panels.ToolbarPanelContainer).toBeDefined();
});

it('exports ToastPanelContainer', () => {
  expect(Panels.ToastPanelContainer).toBeDefined();
});

it('exports TextEditorPanel', () => {
  expect(Panels.TextEditorPanel).toBeDefined();
});

it('exports BinaryDataPanel', () => {
  expect(Panels.BinaryDataPanel).toBeDefined();
});

it('exports URL parameter helpers', () => {
  expect(Panels.URLManager).toBeDefined();
  expect(Panels.URLParametersPanel).toBeDefined();
  expect(Panels.parseUrlParametersIntoState).toBeDefined();
});

it('exports DocumentationLinksPanel', () => {
  expect(Panels.DocumentationLinksPanel).toBeDefined();
});

it('exports ArrowTablePanel', () => {
  expect(Panels.ArrowTablePanel).toBeDefined();
});

it('exports ArrowSchemaPanel', () => {
  expect(Panels.ArrowSchemaPanel).toBeDefined();
});
