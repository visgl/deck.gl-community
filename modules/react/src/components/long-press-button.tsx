import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';

export class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    children: PropTypes.any.isRequired
  };

  buttonPressTimer: ReturnType<typeof setTimeout> | null = null;

  _repeat = () => {
    if (this.buttonPressTimer) {
      (this.props as any).onClick();
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
      <div
        onMouseDown={(event) => {
          this._handleButtonPress();
          document.addEventListener('mouseup', this._handleButtonRelease, {once: true});
        }}
      >
        {(this.props as any).children}
      </div>
    );
  }
}
