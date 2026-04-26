// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export {
  AccordeonPanel,
  AccordeonPanelContainer as AccordeonWidgetContainer,
  ColumnPanel,
  ColumnPanelContainer as ColumnWidgetContainer,
  CustomPanel,
  MarkdownPanel,
  PanelContentRenderer as WidgetContainerRenderer,
  TabbedPanel,
  TabbedPanelContainer as TabbedWidgetContainer,
  asPanelContainer,
  useEffectivePanelThemeMode as useEffectiveWidgetPanelThemeMode
} from '@deck.gl-community/panels';

export type {
  AccordeonPanelContainerProps as AccordeonWidgetContainerProps,
  AccordeonPanelProps,
  ColumnPanelContainerProps as ColumnWidgetContainerProps,
  ColumnPanelProps,
  CustomPanelProps,
  MarkdownPanelProps,
  Panel as WidgetPanel,
  PanelAccordeonContentContainer as WidgetAccordeonContainer,
  PanelContentContainer as WidgetContainer,
  PanelContentContainerBase as WidgetContainerPanelBase,
  PanelRecord as WidgetPanelRecord,
  PanelTabbedContentContainer as WidgetTabbedContainer,
  PanelTheme as WidgetPanelTheme,
  PanelThemeMode as WidgetPanelThemeMode,
  SinglePanelContentContainer as WidgetPanelContainer,
  SinglePanelContentContainerProps as WidgetPanelContainerProps,
  TabbedPanelContainerProps as TabbedWidgetContainerProps,
  TabbedPanelProps
} from '@deck.gl-community/panels';
