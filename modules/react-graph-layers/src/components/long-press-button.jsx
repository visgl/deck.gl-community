import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import {window} from 'global';

export default class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    children: PropTypes.any.isRequired
  };

  // repeat onClick when long press
  _repeat = () => {
    this.props.onClick();
    this.buttonPressTimer = window.setTimeout(this._repeat, 100);
  };

  // onMouseDown
  _handleButtonPress = () => this._repeat();

  // onMouseUp
  _handleButtonRelease = () => window.clearTimeout(this.buttonPressTimer);

  render() {
    return (
      <div onMouseDown={this._handleButtonPress} onMouseUp={this._handleButtonRelease}>
        {this.props.children}
      </div>
    );
  }
}
