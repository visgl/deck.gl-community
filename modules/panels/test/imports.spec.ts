// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('../src/leaf-panels/text-editor/text-editor-panel', () => ({
  TextEditorPanel: class TextEditorPanel {}
}));

let Panels: typeof import('../src/index');

beforeAll(async () => {
  Panels = await import('../src/index');
});

it('exports PanelManager', () => {
  expect(Panels.PanelManager).toBeDefined();
});

it('exports panel component primitives', () => {
  expect(Panels.PanelComponent).toBeDefined();
  expect(Panels.Panel).toBeDefined();
  expect(Panels.PanelContainer).toBeDefined();
});

it('exports panel theme primitives', () => {
  expect(Panels.PANEL_THEME_LIGHT).toBeDefined();
  expect(Panels.PANEL_THEME_DARK).toBeDefined();
  expect(Panels.applyPanelTheme).toBeDefined();
});

it('exports SplitterPanel', () => {
  expect(Panels.SplitterPanel).toBeDefined();
});

it('exports renamed panel containers', () => {
  expect(Panels.BoxPanelContainer).toBeDefined();
  expect(Panels.ModalPanelContainer).toBeDefined();
  expect(Panels.SidebarPanelContainer).toBeDefined();
  expect(Panels.FullScreenPanelContainer).toBeDefined();
});

it('exports specialized panel components', () => {
  expect(Panels.ToolbarComponent).toBeDefined();
  expect(Panels.ToastComponent).toBeDefined();
});

it('removes old panel component names', () => {
  expect(Panels.PanelBox).toBeUndefined();
  expect(Panels.PanelModal).toBeUndefined();
  expect(Panels.PanelSidebar).toBeUndefined();
  expect(Panels.PanelFullScreen).toBeUndefined();
  expect(Panels.ToolbarPanelContainer).toBeUndefined();
  expect(Panels.ToastPanelContainer).toBeUndefined();
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

it('exports ArrowBatchesPanel', () => {
  expect(Panels.ArrowBatchesPanel).toBeDefined();
});
