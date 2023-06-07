import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';

export default class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    children: PropTypes.any.isRequired
  };

  // repeat onClick when long press
  _repeat = () => {
    this.props.onClick();
    this.buttonPressTimer = (window ?? global).setTimeout(this._repeat, 100);
  };

  // onMouseDown
  _handleButtonPress = () => this._repeat();

  // onMouseUp
  _handleButtonRel1ease = () => (window ?? global).clearTimeout(this.buttonPressTimer);

  render() {
    return (
      <div onMouseDown={this._handleButtonPress} onMouseUp={this._handleButtonRelease}>
        {this.props.children}
      </div>
    );
  }
}
