// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelModal} from '@deck.gl-community/panels';

import type {PanelModalProps} from '@deck.gl-community/panels';

/**
 * Props for {@link ModalPanelWidget}.
 *
 * This is the deck.gl wrapper surface for {@link PanelModalProps}, plus the
 * legacy `icon` alias for `triggerIcon`.
 */
export type ModalPanelWidgetProps = PanelModalProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
};

function normalizeModalProps(props: Partial<ModalPanelWidgetProps>): Partial<PanelModalProps> {
  return {
    ...props,
    triggerIcon: props.icon ?? props.triggerIcon
  };
}

/**
 * deck.gl widget wrapper for `PanelModal`.
 */
export class ModalPanelWidget extends PanelModal {
  constructor(props: Partial<ModalPanelWidgetProps> = {}) {
    super(normalizeModalProps(props));
  }

  override setProps(props: Partial<ModalPanelWidgetProps>): void {
    super.setProps(normalizeModalProps(props));
  }
}

/**
 * @deprecated Use {@link ModalPanelWidget}.
 */
export type ModalWidgetProps = ModalPanelWidgetProps;

/**
 * @deprecated Use {@link ModalPanelWidget}.
 */
export const ModalWidget = ModalPanelWidget;
