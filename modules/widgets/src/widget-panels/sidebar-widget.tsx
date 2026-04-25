// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelSidebar} from '../../../panels/src';

import type {PanelSidebarProps} from '../../../panels/src';

/** Sidebar widget properties. */
export type SidebarWidgetProps = PanelSidebarProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
  /** Optional trigger icon. */
  triggerIcon?: string;
};

function normalizeSidebarProps(props: Partial<SidebarWidgetProps>): Partial<PanelSidebarProps> {
  return {
    ...props
  };
}

/**
 * deck.gl wrapper for `PanelSidebar`.
 */
export class SidebarWidget extends PanelSidebar {
  constructor(props: Partial<SidebarWidgetProps> = {}) {
    super(normalizeSidebarProps(props));
  }

  override setProps(props: Partial<SidebarWidgetProps>): void {
    super.setProps(normalizeSidebarProps(props));
  }
}
