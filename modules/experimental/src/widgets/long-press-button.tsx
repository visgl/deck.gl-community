// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Component, type ComponentChildren} from 'preact';

export type LongPressButtonProps = {
  onClick: () => void;
  children: ComponentChildren;
};

export class LongPressButton extends Component<LongPressButtonProps> {
  buttonPressTimer: ReturnType<typeof setTimeout> | null = null;

  private repeat = () => {
    if (this.buttonPressTimer) {
      this.props.onClick();
      this.buttonPressTimer = setTimeout(this.repeat, 100);
    }
  };

  private handleButtonPress = () => {
    this.buttonPressTimer = setTimeout(this.repeat, 100);
  };

  private handleButtonRelease = () => {
    if (this.buttonPressTimer) {
      clearTimeout(this.buttonPressTimer);
    }
    this.buttonPressTimer = null;
  };

  render() {
    return (
      <div className="deck-widget-button">
        <div
          style={{pointerEvents: 'auto'}}
          onMouseDown={() => {
            this.handleButtonPress();
            document.addEventListener('mouseup', this.handleButtonRelease, {once: true});
          }}
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
