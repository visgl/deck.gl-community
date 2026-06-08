// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {PanelComponent} from './panels/panel-component';
export type {PanelComponentProps, PanelPlacement} from './panels/panel-component';
export {PanelContainer} from './panels/panel-container';
export type {PanelContainerProps} from './panels/panel-container';
export {PanelManager, type PanelManagerProps} from './panels/panel-manager';
export {BoxPanelContainer, type BoxPanelContainerProps} from './panel-mounts/box-panel-container';
export {
  ModalPanelContainer,
  type ModalPanelContainerDialogPlacement,
  type ModalPanelContainerPresentation,
  type ModalPanelContainerProps
} from './panel-mounts/modal-panel-container';
export {
  SidebarPanelContainer,
  type SidebarPanelContainerProps
} from './panel-mounts/sidebar-panel-container';
export {
  FullScreenPanelContainer,
  type FullScreenPanelContainerProps
} from './panel-mounts/full-screen-panel-container';

export {
  PANEL_THEME_DARK,
  PANEL_THEME_LIGHT,
  applyPanelTheme,
  type PanelThemeVariables
} from './lib/panel-theme';

export {
  AccordeonPanel,
  AccordeonPanelContainer,
  type AccordeonPanelContainerProps,
  type AccordeonPanelProps
} from './composite-panels/accordeon-panel';
export {
  ColumnPanel,
  ColumnPanelContainer,
  type ColumnPanelContainerProps,
  type ColumnPanelProps
} from './composite-panels/column-panel';
export {
  SplitterPanel,
  type SplitterPanelOrientation,
  type SplitterPanelProps
} from './composite-panels/splitter-panel';
export {
  TabbedPanel,
  TabbedPanelContainer,
  type TabbedPanelContainerProps,
  type TabbedPanelProps
} from './composite-panels/tabbed-panel';
export {CustomPanel, type CustomPanelProps} from './leaf-panels/custom-panel';
export {MarkdownPanel, type MarkdownPanelProps} from './leaf-panels/markdown/markdown-panel';
export {useEffectivePanelThemeMode} from './panels/panel-theme-scope';
export {
  Panel,
  type PanelListContainerProps,
  type PanelProps,
  type PanelTheme,
  type PanelThemeMode
} from './panels/panel';
export {PanelThemeScope} from './panels/panel-theme-scope';

export {
  SettingsPanel,
  type SettingsPanelFontSize,
  type SettingsPanelProps
} from './leaf-panels/settings/settings-panel';
export {
  StudioSettingsIcon,
  StudioSettingsPanel,
  createStudioSettingsPanel,
  type StudioDependencyShape,
  type StudioSettingsIconName,
  type StudioSettingsIconProps,
  type StudioSettingsPanelProps,
  type StudioSettingsRowLayout,
  type StudioSettingsTabId
} from './leaf-panels/settings/studio-settings-panel';
export {StatsPanel, type StatsPanelProps} from './leaf-panels/stats/stats-panel';
export {
  BinaryDataPanel,
  type BinaryDataPanelProps
} from './leaf-panels/binary-data/binary-data-panel';
export {
  DocumentationLinksPanel,
  DocumentationLinksPanelContent,
  type DocumentationLink,
  type DocumentationLinkItem,
  type DocumentationLinksPanelProps,
  type DocumentationLinkSpacer
} from './leaf-panels/documentation-links-panel';
export {
  ArrowTablePanel,
  type ArrowCellFormatContext,
  type ArrowTableColumnFormatters,
  type ArrowTableFieldLike,
  type ArrowTableInput,
  type ArrowTableLike,
  type ArrowTablePanelProps,
  type ArrowTableSchemaLike,
  type ArrowTableVectorLike,
  type ArrowTableWrapperLike
} from './leaf-panels/arrow/arrow-table-panel';
export {
  ArrowSchemaPanel,
  type ArrowMetadataEntry,
  type ArrowMetadataLike,
  type ArrowSchemaFieldLike,
  type ArrowSchemaLike,
  type ArrowSchemaPanelProps
} from './leaf-panels/arrow/arrow-schema-panel';
export {
  ArrowBatchesPanel,
  type ArrowBatchPreview,
  type ArrowBatchPreviewRow,
  type ArrowBatchesPanelProps,
  type ArrowRecordBatchLike
} from './leaf-panels/arrow/arrow-batches-panel';
export {
  KeyboardShortcutsPanel,
  KeyboardShortcutsPanelContent,
  type KeyboardShortcutsPanelProps
} from './leaf-panels/keyboard-shortcuts/keyboard-shortcuts-panel';
export {
  TextEditorPanel,
  type TextEditorPanelProps
} from './leaf-panels/text-editor/text-editor-panel';
export {
  URLParametersPanel,
  URLParametersPanelContent,
  type URLParametersPanelProps
} from './leaf-panels/url-parameters/url-parameters-panel';

export {
  ToolbarComponent,
  type ToolbarComponentActionItem,
  type ToolbarComponentBadgeItem,
  type ToolbarComponentItem,
  type ToolbarComponentProps,
  type ToolbarComponentToggleGroupItem,
  type ToolbarComponentToggleOption
} from './components/toolbar-component';
export {ToastComponent, type ToastComponentProps} from './components/toast-component';
export {
  toastManager,
  type ToastEntry,
  type ToastKind,
  type ToastRequest
} from './lib/toasts/toast-manager';

export {
  buildInitialCollapsedState,
  clamp,
  filterSettingsSchemaByPersistence,
  getDefaultValue,
  getInitialCollapsedState,
  getSectionKey,
  getSettingDefinitions,
  getSettingPersistenceTarget,
  getValueAtPath,
  mergeCollapsedState,
  normalizeOption,
  partitionSettingsSchemaByPersistence,
  resolveSettingValue,
  setValueAtPath,
  type PartitionedSettingsSchema,
  type SettingDescriptor,
  type SettingDescriptorByName,
  type SettingOption,
  type SettingPersistenceTarget,
  type SettingType,
  type SettingValue,
  type SettingsOption,
  type SettingsSchema,
  type SettingsSectionDescriptor,
  type SettingsState
} from './lib/settings/settings';
export {
  getChangedSetting,
  SettingsManager,
  settingsManager,
  type SettingsChangeDescriptor,
  type SettingsManagerLocalStorageConfig,
  type SettingsManagerOnChange
} from './lib/settings/settings-manager';
export {
  CommandManager,
  commandManager,
  type CommandArgsSchema,
  type CommandAutomationSupport,
  type CommandDefinition,
  type CommandDescriptor,
  type CommandState,
  type ExecuteCommandAsyncOptions,
  type InstallCommandAutomationOptions,
  type ListCommandsOptions
} from './lib/commands/command-manager';
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
} from './lib/keyboard-shortcuts/keyboard-shortcuts';
export {
  KeyboardShortcutsManager,
  KeyboardShortcutsManagerDocument,
  type KeyboardShortcutEventManager,
  type KeyboardShortcutManagerEvent
} from './lib/keyboard-shortcuts/keyboard-shortcuts-manager';
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
