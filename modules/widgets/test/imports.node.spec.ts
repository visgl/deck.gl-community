// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('../../panels/src/widget-panels/text-editor-panel', () => ({
  TextEditorPanel: class TextEditorPanel {}
}));

let Widgets: typeof import('../src/index');

beforeAll(async () => {
  Widgets = await import('../src/index');
});

it('exports PanWidget', () => {
  expect(Widgets.PanWidget).toBeDefined();
});

it('exports ZoomRangeWidget', () => {
  expect(Widgets.ZoomRangeWidget).toBeDefined();
});

it('exports HtmlOverlayWidget', () => {
  expect(Widgets.HtmlOverlayWidget).toBeDefined();
});

it('exports HtmlTooltipWidget', () => {
  expect(Widgets.HtmlTooltipWidget).toBeDefined();
});

it('exports BoxPanelWidget', () => {
  expect(Widgets.BoxPanelWidget).toBeDefined();
});

it('exports DeviceManager', () => {
  expect(Widgets.DeviceManager).toBeDefined();
});

it('exports DeviceTabsWidget', () => {
  expect(Widgets.DeviceTabsWidget).toBeDefined();
});

it('exports FullScreenPanelWidget', () => {
  expect(Widgets.FullScreenPanelWidget).toBeDefined();
});

it('exports ModalPanelWidget', () => {
  expect(Widgets.ModalPanelWidget).toBeDefined();
});

it('exports SidebarPanelWidget', () => {
  expect(Widgets.SidebarPanelWidget).toBeDefined();
});

it('exports BoxWidget alias', () => {
  expect(Widgets.BoxWidget).toBe(Widgets.BoxPanelWidget);
});

it('exports ModalWidget alias', () => {
  expect(Widgets.ModalWidget).toBe(Widgets.ModalPanelWidget);
});

it('exports SidebarWidget alias', () => {
  expect(Widgets.SidebarWidget).toBe(Widgets.SidebarPanelWidget);
});

it('exports ToolbarWidget', () => {
  expect(Widgets.ToolbarWidget).toBeDefined();
});
