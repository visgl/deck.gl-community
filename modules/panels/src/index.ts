// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {Widget} from './widget';
export type {WidgetPlacement, WidgetProps} from './widget';
export {WidgetHost, type WidgetHostProps} from './widget-host';

export {
  AccordeonPanel,
  AccordeonWidgetContainer,
  ColumnWidgetContainer,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  TabbedPanel,
  TabbedWidgetContainer,
  WidgetContainerRenderer,
  asPanelContainer,
  type AccordeonWidgetContainerProps,
  type AccordeonPanelProps,
  type ColumnWidgetContainerProps,
  type ColumnPanelProps,
  type CustomPanelProps,
  type MarkdownPanelProps,
  type TabbedWidgetContainerProps,
  type TabbedPanelProps,
  type WidgetContainer,
  type WidgetContainerPanelBase,
  type WidgetPanel,
  type WidgetPanelContainer,
  type WidgetPanelContainerProps,
  type WidgetPanelRecord,
  type WidgetPanelTheme,
  type WidgetPanelThemeMode
} from './widget-panels/widget-containers';

export {SettingsPanel, type SettingsPanelProps} from './widget-panels/settings-panel';
export {StatsPanel, type StatsPanelProps} from './widget-panels/stats-panel';
export {
  KeyboardShortcutsPanel,
  type KeyboardShortcutsPanelProps
} from './widget-panels/keyboard-shortcuts-widget';
export {TextEditorPanel, type TextEditorPanelProps} from './widget-panels/text-editor-panel';

export {
  ToolbarWidget,
  type ToolbarWidgetActionItem,
  type ToolbarWidgetBadgeItem,
  type ToolbarWidgetItem,
  type ToolbarWidgetProps,
  type ToolbarWidgetToggleGroupItem,
  type ToolbarWidgetToggleOption
} from './widget-panels/toolbar-widget';
export {ToastWidget, type ToastWidgetProps} from './widget-panels/toast-widget';
export {
  toastManager,
  type ToastEntry,
  type ToastKind,
  type ToastRequest
} from './widget-panels/toast-manager';

export {
  type SettingDescriptor,
  type SettingsSchema,
  type SettingsSectionDescriptor,
  type SettingsState
} from './lib/settings/settings';
export {
  type KeyboardShortcut,
  isShortcutMatchingKeyEvent,
  findShortcutMatchingKeyEvent,
  DEFAULT_SHORTCUTS,
  formatKey
} from './keyboard-shortcuts/keyboard-shortcuts';
