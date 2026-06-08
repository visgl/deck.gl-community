// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, expect, it, vi} from 'vitest';

vi.mock('@deck.gl-community/panels', () => {
  return {
    PanelComponent: class PanelComponent {},
    BoxPanelContainer: class BoxPanelContainer {},
    ModalPanelContainer: class ModalPanelContainer {},
    SidebarPanelContainer: class SidebarPanelContainer {},
    FullScreenPanelContainer: class FullScreenPanelContainer {},
    ToolbarComponent: class ToolbarComponent {},
    ToastComponent: class ToastComponent {}
  };
});

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

it('exports PanelWidget', () => {
  expect(Widgets.PanelWidget).toBeDefined();
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

it('exports ToolbarWidget', () => {
  expect(Widgets.ToolbarWidget).toBeDefined();
});

it('exports ToastWidget', () => {
  expect(Widgets.ToastWidget).toBeDefined();
});

it('removes panel compatibility aliases and studio settings helpers', () => {
  expect(Widgets.BoxWidget).toBeUndefined();
  expect(Widgets.ModalWidget).toBeUndefined();
  expect(Widgets.SidebarWidget).toBeUndefined();
  expect(Widgets.createStudioSettingsWidget).toBeUndefined();
  expect(Widgets.updateStudioSettingsWidget).toBeUndefined();
});
