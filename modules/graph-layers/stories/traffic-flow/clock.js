import React, {Component} from 'react';
import styled from 'styled-components';
import {window} from 'global';

const MINUTE_DURATION = 2000 / 60;

export const ClockWrapper = styled.div`
  font-family: Iceland;
  font-size: 50px;
  text-align: center;
  line-height: 1;
  color: #c6e2ff;
  animation: neon 0.08s ease-in-out infinite alternate;

  @keyframes neon {
    from {
      text-shadow: 0 0 6px rgba(202, 228, 225, 0.92),
        0 0 30px rgba(202, 228, 225, 0.34), 0 0 12px rgba(30, 132, 242, 0.52),
        0 0 21px rgba(30, 132, 242, 0.92), 0 0 34px rgba(30, 132, 242, 0.78),
        0 0 54px rgba(30, 132, 242, 0.92);
    }
    to {
      text-shadow: 0 0 6px rgba(202, 228, 225, 0.98),
        0 0 30px rgba(202, 228, 225, 0.42), 0 0 12px rgba(30, 132, 242, 0.58),
        0 0 22px rgba(30, 132, 242, 0.84), 0 0 38px rgba(30, 132, 242, 0.88),
        0 0 60px rgba(30, 132, 242, 1);
    }
  }
`;

export default class Clock extends Component {
  state = {
    minute: 0,
  };

  componentDidMount() {
    this._lastClock = null;
    this.animate();
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.hour !== this.props.hour) {
      this._lastClock = null;
      this.setState({minute: 0});
    }
  }

  animate = now => {
    if (!this._lastClock) {
      // initialize
      this._lastClock = now;
    }
    if (now - this._lastClock >= MINUTE_DURATION) {
      this._lastClock = now;
      this.setState({minute: (this.state.minute + 1) % 60});
    }
    window.requestAnimationFrame(this.animate);
  };

  render() {
    return (
      <ClockWrapper>
        {`${(this.props.hour < 10 ? '0' : '') + this.props.hour}:
        ${(this.state.minute < 10 ? '0' : '') + this.state.minute}`}
      </ClockWrapper>
    );
  }
}
