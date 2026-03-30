// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('../src/panel-widgets/text-editor-widget', () => ({
  TextEditorWidgetPanel: class TextEditorWidgetPanel {}
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

it('exports BoxWidget', () => {
  expect(Widgets.BoxWidget).toBeDefined();
});

it('exports ModalWidget', () => {
  expect(Widgets.ModalWidget).toBeDefined();
});

it('exports SidebarWidget', () => {
  expect(Widgets.SidebarWidget).toBeDefined();
});

it('exports ToolbarWidget', () => {
  expect(Widgets.ToolbarWidget).toBeDefined();
});

it('exports TextEditorWidgetPanel', () => {
  expect(Widgets.TextEditorWidgetPanel).toBeDefined();
});

it('exports WidgetContainerRenderer', () => {
  expect(Widgets.WidgetContainerRenderer).toBeDefined();
});
