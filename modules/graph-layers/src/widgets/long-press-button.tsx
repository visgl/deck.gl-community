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
    console.log('long')
    return (
      <div
        onMouseDown={(event) => {
          console.log('press')
          this._handleButtonPress();
          document.addEventListener('mouseup', this._handleButtonRelease, {once: true});
        }}
      >
        {this.props.children}
      </div>
    );
  }
}
