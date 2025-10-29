// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';

export class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    children: PropTypes.any.isRequired
  };

  buttonPressTimer: ReturnType<typeof setTimeout> | null = null;
  private _isMouseUpListenerAttached = false;

  _repeat = () => {
    if (this.buttonPressTimer) {
      (this.props as any).onClick();
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
      <div
        onMouseDown={() => {
          this._handleButtonPress();
        }}
      >
        {(this.props as any).children}
      </div>
    );
  }
}
