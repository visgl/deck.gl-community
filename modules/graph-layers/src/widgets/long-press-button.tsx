// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Component} from 'preact';

export type LongPressButtonProps = {
  onClick: () => void;
  children: any;
};

export class LongPressButton extends Component<LongPressButtonProps> {
  buttonPressTimer: ReturnType<typeof setTimeout> | null = null;

  _repeat = () => {
    if (this.buttonPressTimer) {
      this.props.onClick();
      this.buttonPressTimer = setTimeout(this._repeat, 100);
    }
  };

  _handleButtonPress = () => {
    this.buttonPressTimer = setTimeout(this._repeat, 100);
  };

  _handleButtonRelease = () => {
    if (this.buttonPressTimer) {
      clearTimeout(this.buttonPressTimer);
    }
    this.buttonPressTimer = null;
  };

  render() {
    return (
      <div className="deck-widget-button">
        <div
          style={{
            pointerEvents: 'auto'
          }}
          onMouseDown={(event) => {
            this._handleButtonPress();
            document.addEventListener('mouseup', this._handleButtonRelease, {once: true});
          }}
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
