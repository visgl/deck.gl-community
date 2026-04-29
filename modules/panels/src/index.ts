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
  AccordeonPanelContainer,
  ColumnPanelContainer,
  ColumnPanel,
  CustomPanel,
  MarkdownPanel,
  SplitterPanel,
  TabbedPanel,
  TabbedPanelContainer,
  PanelContentRenderer,
  asPanelContainer,
  useEffectivePanelThemeMode,
  type AccordeonPanelContainerProps,
  type AccordeonPanelProps,
  type ColumnPanelContainerProps,
  type ColumnPanelProps,
  type CustomPanelProps,
  type MarkdownPanelProps,
  type SplitterPanelOrientation,
  type SplitterPanelProps,
  type TabbedPanelContainerProps,
  type TabbedPanelProps,
  type PanelContentContainer,
  type PanelContentContainerBase,
  type Panel,
  type PanelAccordeonContentContainer,
  type SinglePanelContentContainer,
  type SinglePanelContentContainerProps,
  type PanelTabbedContentContainer,
  type PanelRecord,
  type PanelTheme,
  type PanelThemeMode
} from './panels/panel-containers';

export {SettingsPanel, type SettingsPanelProps} from './panels/settings-panel';
export {StatsPanel, type StatsPanelProps} from './panels/stats-panel';
export {BinaryDataPanel, type BinaryDataPanelProps} from './panels/binary-data-panel';
export {
  DocumentationLinksPanel,
  DocumentationLinksPanelContent,
  type DocumentationLink,
  type DocumentationLinkItem,
  type DocumentationLinksPanelProps,
  type DocumentationLinkSpacer
} from './panels/documentation-links-panel';
export {
  ArrowTablePanel,
  type ArrowTableFieldLike,
  type ArrowTableLike,
  type ArrowTablePanelProps,
  type ArrowTableSchemaLike,
  type ArrowTableVectorLike
} from './panels/arrow-table-panel';
export {
  ArrowSchemaPanel,
  type ArrowMetadataLike,
  type ArrowSchemaFieldLike,
  type ArrowSchemaLike,
  type ArrowSchemaPanelProps
} from './panels/arrow-schema-panel';
export {
  KeyboardShortcutsPanel,
  KeyboardShortcutsPanelContent,
  type KeyboardShortcutsPanelProps
} from './panels/keyboard-shortcuts-panel';
export {TextEditorPanel, type TextEditorPanelProps} from './panels/text-editor-panel';
export {
  URLParametersPanel,
  URLParametersPanelContent,
  type URLParametersPanelProps
} from './panels/url-parameters-panel';

export {
  ToolbarPanelContainer,
  type ToolbarPanelContainerActionItem,
  type ToolbarPanelContainerBadgeItem,
  type ToolbarPanelContainerItem,
  type ToolbarPanelContainerProps,
  type ToolbarPanelContainerToggleGroupItem,
  type ToolbarPanelContainerToggleOption
} from './panels/toolbar-panel-container';
export {ToastPanelContainer, type ToastPanelContainerProps} from './panels/toast-panel-container';
export {
  toastManager,
  type ToastEntry,
  type ToastKind,
  type ToastRequest
} from './panels/toast-manager';

export {
  type SettingDescriptor,
  type SettingsSchema,
  type SettingsSectionDescriptor,
  type SettingsState
} from './lib/settings/settings';
export {
  type KeyboardShortcutDisplayPair,
  type KeyboardShortcutDisplaySection,
  type KeyboardShortcut,
  type ShortcutDisplayIcon,
  type ShortcutDisplayInput,
  type ShortcutDisplayInputKind,
  type ShortcutDisplayModifier,
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
export {
  getRecognizedUrlParameterKeys,
  parseUrlParametersIntoState,
  serializeUrlParameters,
  serializeUrlSearchParams,
  type ParseUrlParametersIntoStateOptions,
  type RawUrlParametersInput,
  type URLParameter,
  type URLParameterValue
} from './lib/url-parameters/url-parameters';
export {
  URLManager,
  type URLManagerCreateSearchParamsOptions
} from './lib/url-parameters/url-manager';
