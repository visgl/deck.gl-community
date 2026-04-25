// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {PanelContainer} from './panel-container';
export type {PanelContainerProps, PanelPlacement} from './panel-container';
export {PanelManager, type PanelManagerProps} from './panel-manager';
export {PanelBox, type PanelBoxProps} from './panel-components/panel-box';
export {PanelModal, type PanelModalProps} from './panel-components/panel-modal';
export {PanelSidebar, type PanelSidebarProps} from './panel-components/panel-sidebar';
export {PanelFullScreen, type PanelFullScreenProps} from './panel-components/panel-full-screen';

export {
  PANEL_THEME_DARK,
  PANEL_THEME_LIGHT,
  applyPanelTheme,
  type PanelThemeVariables
} from './lib/panel-theme';

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
export {BinaryDataPanel, type BinaryDataPanelProps} from './widget-panels/binary-data-panel';
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
export {
  KeyboardShortcutsManager,
  KeyboardShortcutsManagerDocument,
  type KeyboardShortcutEventManager,
  type KeyboardShortcutManagerEvent
} from './keyboard-shortcuts/keyboard-shortcuts-manager';
