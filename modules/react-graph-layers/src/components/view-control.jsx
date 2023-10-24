import React, {PureComponent} from 'react';
import PropTypes from 'prop-types';
import styled from 'styled-components';
import LongPressButton from './long-press-button.jsx';

export const ViewControlWrapper = styled.div`
  align-items: center;
  display: flex;
  flex-direction: column;
  position: absolute;
  z-index: 99;
  user-select: none;
`;

export const NavigationButtonContainer = styled.div`
  background: #f7f7f7;
  border-radius: 23px;
  border: 0.5px solid #eaeaea;
  box-shadow: inset 11px 11px 5px -7px rgba(230, 230, 230, 0.49);
  height: 46px;
  width: 46px;
`;

export const NavigationButton = styled.div`
  color: #848484;
  cursor: pointer;
  left: ${(props) => props.left};
  position: absolute;
  top: ${(props) => props.top};
  font-size: ${(props) => props.fontsize};

  &:hover {
    color: #00ade6;
  }
`;

export const ZoomControlWrapper = styled.div`
  align-items: center;
  background: #f7f7f7;
  border: 0.5px solid #eaeaea;
  display: flex;
  flex-direction: column;
  margin-top: 6px;
  padding: 2px 0;
  width: 18px;
`;

export const VerticalSlider = styled.div`
  display: inline-block;
  height: 100px;
  padding: 0;
  width: 10px;

  > input[type=range][orient=vertical] {
    -webkit-appearance: slider-vertical;
    height: 100px;
    padding: 0;
    margin: 0;
    width: 10px;
  }
`;

export const ZoomControlButton = styled.div`
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  margin: -4px;

  &:hover {
    color: #00ade6;
  }
`;

export default class ViewControl extends PureComponent {
  static displayName = 'ViewControl';

  static propTypes = {
    // functions
    fitBounds: PropTypes.func,
    panBy: PropTypes.func,
    zoomBy: PropTypes.func,
    // current zoom level
    zoomLevel: PropTypes.number,
    // configuration
    minZoom: PropTypes.number,
    maxZoom: PropTypes.number,
    deltaPan: PropTypes.number,
    deltaZoom: PropTypes.number
  };

  static defaultProps = {
    fitBounds: () => {},
    panBy: () => {},
    zoomBy: () => {},
    deltaPan: 10,
    deltaZoom: 0.1,
    minZoom: 0.1,
    maxZoom: 1
  };

  // pan actions
  panUp = () => this.props.panBy(0, this.props.deltaPan);
  panDown = () => this.props.panBy(0, -1 * this.props.deltaPan);
  panLeft = () => this.props.panBy(this.props.deltaPan, 0);
  panRight = () => this.props.panBy(-1 * this.props.deltaPan, 0);

  // zoom actions
  zoomIn = () => this.props.zoomBy(this.props.deltaZoom);
  zoomOut = () => this.props.zoomBy(-1 * this.props.deltaZoom);
  onChangeZoomLevel = (evt) => {
    const delta = evt.target.value - this.props.zoomLevel;
    this.props.zoomBy(delta);
  };

  render() {
    // navigational buttons
    const buttons = [
      {top: -8, left: 13,fontsize: 20,onClick: this.panUp, content: '▲'},
      {top: 10, left: 2, fontsize: 15,onClick: this.panLeft, content: '◀'},
      {top: 10, left: 32, fontsize: 15,onClick: this.panRight, content: '▶'},
      {top: 21, left: 13, fontsize: 20,onClick: this.panDown, content: '▼'}
    ];

    return (
      <ViewControlWrapper>
        <NavigationButtonContainer>
          {buttons.map((b) => (
            <NavigationButton key={b.content} top={`${b.top}px`} left={`${b.left}px`} fontsize={`${b.fontsize}px`}>
              <LongPressButton onClick={b.onClick}>{b.content}</LongPressButton>
            </NavigationButton>
          ))}
          <NavigationButton top={'11px'} left={'17.5px'} onClick={this.props.fitBounds}>
            {'¤'}
          </NavigationButton>
        </NavigationButtonContainer>
        <ZoomControlWrapper>
          <ZoomControlButton>
            <LongPressButton onClick={this.zoomIn}>{'+'}</LongPressButton>
          </ZoomControlButton>
          <VerticalSlider>
            <input
              type="range"
              value={this.props.zoomLevel}
              min={this.props.minZoom}
              max={this.props.maxZoom}
              step={this.props.deltaZoom}
              onChange={this.onChangeZoomLevel}
              orient="vertical"
            />
          </VerticalSlider>
          <ZoomControlButton>
            <LongPressButton onClick={this.zoomOut}>{'-'}</LongPressButton>
          </ZoomControlButton>
        </ZoomControlWrapper>
      </ViewControlWrapper>
    );
  }
}
