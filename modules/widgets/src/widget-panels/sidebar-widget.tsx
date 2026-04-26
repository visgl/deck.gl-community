// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelSidebar} from '@deck.gl-community/panels';

import type {PanelSidebarProps} from '@deck.gl-community/panels';

/**
 * Props for {@link SidebarPanelWidget}.
 *
 * This is the deck.gl wrapper surface for {@link PanelSidebarProps}.
 */
export type SidebarPanelWidgetProps = PanelSidebarProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
  /** Optional trigger icon. */
  triggerIcon?: string;
};

function normalizeSidebarProps(
  props: Partial<SidebarPanelWidgetProps>
): Partial<PanelSidebarProps> {
  return {
    ...props
  };
}

/**
 * deck.gl widget wrapper for `PanelSidebar`.
 */
export class SidebarPanelWidget extends PanelSidebar {
  className = 'deck-widget-sidebar';

  constructor(props: Partial<SidebarPanelWidgetProps> = {}) {
    super(normalizeSidebarProps(props));
  }

  override setProps(props: Partial<SidebarPanelWidgetProps>): void {
    super.setProps(normalizeSidebarProps(props));
  }
}

/**
 * @deprecated Use {@link SidebarPanelWidget}.
 */
export type SidebarWidgetProps = SidebarPanelWidgetProps;

/**
 * @deprecated Use {@link SidebarPanelWidget}.
 */
export const SidebarWidget = SidebarPanelWidget;
