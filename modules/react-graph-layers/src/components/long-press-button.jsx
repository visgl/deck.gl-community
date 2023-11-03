import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';

export default class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    children: PropTypes.any.isRequired
  };

  componentDidMount() {
    (document ?? global.document).addEventListener('mouseup', this._handleButtonRelease);
  }

  componentWillUnmount() {
    (window ?? global).clearTimeout(this.buttonPressTimer);
    (document ?? global.document).removeEventListener('mouseup', this._handleButtonRelease);
  }

  _repeat = () => {
    if (this.buttonPressTimer) {
      this.props.onClick();
      this.buttonPressTimer = (window ?? global).setTimeout(this._repeat, 100);
    }
  };

  _handleButtonPress = () => {
    this.buttonPressTimer = (window ?? global).setTimeout(this._repeat, 100);
  };

  _handleButtonRelease = () => {
    (window ?? global).clearTimeout(this.buttonPressTimer);
    this.buttonPressTimer = null;
  };

  render() {
    return <div onMouseDown={this._handleButtonPress}>{this.props.children}</div>;
  }
}
