// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LongPressController} from './long-press-controller';

export type LongPressButtonProps = {
  onClick: () => void;
  label: string;
};

/**
 * A button element with long-press repeat behaviour.
 * Wraps {@link LongPressController} and exposes the root DOM element.
 */
export class LongPressButton {
  readonly element: HTMLElement;
  private controller: LongPressController;

  constructor(props: LongPressButtonProps) {
    const wrapper = document.createElement('div');
    wrapper.className = 'deck-widget-button';

    const inner = document.createElement('div');
    inner.style.pointerEvents = 'auto';
    inner.textContent = props.label;

    wrapper.appendChild(inner);

    this.element = wrapper;
    this.controller = new LongPressController(inner, props.onClick);
  }

  destroy(): void {
    this.controller.destroy();
  }
}
