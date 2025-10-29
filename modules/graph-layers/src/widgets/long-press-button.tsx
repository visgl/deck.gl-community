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
  private _isMouseUpListenerAttached = false;

  _repeat = () => {
    if (this.buttonPressTimer) {
      this.props.onClick();
      this.buttonPressTimer = setTimeout(this._repeat, 100);
    }
  };

  componentWillUnmount(): void {
    this._handleButtonRelease();
    this._detachMouseUpListener();
  }

  _handleButtonPress = () => {
    if (!this.buttonPressTimer) {
      this.buttonPressTimer = setTimeout(this._repeat, 100);
    }
    this._attachMouseUpListener();
  };

  _handleButtonRelease = () => {
    if (this.buttonPressTimer) {
      clearTimeout(this.buttonPressTimer);
    }
    this.buttonPressTimer = null;
  };

  _handleDocumentMouseUp = () => {
    this._handleButtonRelease();
    this._detachMouseUpListener();
  };

  _attachMouseUpListener() {
    if (!this._isMouseUpListenerAttached) {
      document.addEventListener('mouseup', this._handleDocumentMouseUp);
      this._isMouseUpListenerAttached = true;
    }
  }

  _detachMouseUpListener() {
    if (this._isMouseUpListenerAttached) {
      document.removeEventListener('mouseup', this._handleDocumentMouseUp);
      this._isMouseUpListenerAttached = false;
    }
  }

  render() {
    return (
      <div className="deck-widget-button">
        <div
          style={{
            pointerEvents: 'auto'
          }}
          onMouseDown={() => {
            this._handleButtonPress();
          }}
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
