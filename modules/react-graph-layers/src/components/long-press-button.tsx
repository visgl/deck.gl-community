import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';

// interface LongPressButtonProps {
//   onClick: (event: Event) => void,
// }

// export function LongPressButton(props: LongPressButtonProps) {
//   const repeat
// }

export default class LongPressButton extends PureComponent {
  static propTypes = {
    onClick: PropTypes.func.isRequired,
    // eslint-disable-next-line react/forbid-prop-types
    children: PropTypes.any.isRequired
  };

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
    clearTimeout(this.buttonPressTimer);
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
        {this.props.children}
      </div>
    );
  }
}
