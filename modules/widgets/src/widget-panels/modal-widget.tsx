// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PanelModal} from '../../../panels/src';

import type {PanelModalProps} from '../../../panels/src';

/** Trigger and panel configuration for a modal-style widget. */
export type ModalWidgetProps = PanelModalProps & {
  /** Trigger icon alias for legacy compatibility. */
  icon?: string;
};

function normalizeModalProps(props: Partial<ModalWidgetProps>): Partial<PanelModalProps> {
  return {
    ...props,
    triggerIcon: props.icon ?? props.triggerIcon
  };
}

/**
 * deck.gl wrapper for `PanelModal`.
 */
export class ModalWidget extends PanelModal {
  constructor(props: Partial<ModalWidgetProps> = {}) {
    super(normalizeModalProps(props));
  }

  override setProps(props: Partial<ModalWidgetProps>): void {
    super.setProps(normalizeModalProps(props));
  }
}
