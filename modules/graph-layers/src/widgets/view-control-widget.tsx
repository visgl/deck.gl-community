// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Component, render} from 'preact';

// import {FlyToInterpolator} from '@deck.gl/core';
import type {Deck, Viewport, Widget, WidgetPlacement} from '@deck.gl/core';
import {LongPressButton} from './long-press-button';

export const ViewControlWrapper = ({children}) => (
  <div
    style={{
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      position: 'absolute',
      zIndex: 99,
      userSelect: 'none'
    }}
  >
    {' '}
    {children}{' '}
  </div>
);

export const NavigationButtonContainer = ({children}) => (
  <div
    style={{
      background: '#f7f7f7',
      borderRadius: '23px',
      border: '0.5px solid #eaeaea',
      boxShadow: 'inset 11px 11px 5px -7px rgba(230, 230, 230, 0.49)',
      height: '46px',
      width: '46px'
    }}
  >
    {' '}
    {children}{' '}
  </div>
);

export type NavigationButtonProps = {
  left: any;
  top: any;
  rotate?: number;
  children?: any;
  onClick?: () => void;
};

export const NavigationButton = (props: NavigationButtonProps) => (
  <div
    onClick={props.onClick}
    style={{
      color: '#848484',
      cursor: 'pointer',
      position: 'absolute',
      left: props.left,
      top: props.top,
      transform: `rotate(${props.rotate || 0}deg)`
      // &:hover,
      // &:active {
      //   color: #00ade6;
      // }
    }}
  >
    {' '}
    {props.children}{' '}
  </div>
);

export const ZoomControlWrapper = ({children}) => (
  <div
    style={{
      alignItems: 'center',
      background: '#f7f7f7',
      border: '0.5px solid #eaeaea',
      display: 'flex',
      flexDirection: 'column',
      marginTop: '6px',
      padding: '2px 0',
      width: '18px'
    }}
  >
    {' '}
    {children}{' '}
  </div>
);

export const VerticalSlider = ({children}) => (
  <div
    style={{
      display: 'inline-block',
      height: '100px',
      padding: '0',
      width: '10px'

      // > input[type='range'][orient='vertical'] {
      //   -webkit-appearance: slider-vertical;
      //   height: 100px;
      //   padding: 0;
      //   margin: 0;
      //   width: 10px;
      // }
    }}
  >
    {' '}
    {children}{' '}
  </div>
);

export const ZoomControlButton = ({children}) => (
  <div
    style={{
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 500,
      margin: '-4px'

      // &:hover,
      // &:active {
      //   color: #00ade6;
      // }
    }}
  >
    {' '}
    {children}{' '}
  </div>
);

export type ViewControlProps = {
  id?: string;
  viewId?: string;
  placement?: WidgetPlacement;
  fitBounds: () => void;
  panBy?: (dx: number, dy: number) => void;
  zoomBy?: (delta: number) => void;
  zoomLevel: number;
  minZoom: number;
  maxZoom: number;
  deltaPan: number;
  deltaZoom: number;
  /** CSS inline style overrides. */
  style?: Partial<CSSStyleDeclaration>;
  /** Additional CSS class. */
  className?: string;
};

export class ViewControl extends Component<ViewControlProps> {
  static displayName = 'ViewControl';

  static defaultProps: Required<ViewControlProps> = {
    id: undefined,
    viewId: undefined,
    placement: 'top-left',
    fitBounds: () => {},
    panBy: () => {},
    zoomBy: () => {},
    zoomLevel: 1,
    deltaPan: 10,
    deltaZoom: 0.1,
    minZoom: 0.1,
    maxZoom: 1,
    style: {},
    className: ''
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
    const buttons = [
      {top: -2, left: 14, rotate: 0, onClick: this.panUp, content: '▲', key: 'up'},
      {top: 12, left: 0, rotate: -90, onClick: this.panLeft, content: '◀', key: 'left'},
      {top: 12, left: 28, rotate: 90, onClick: this.panRight, content: '▶', key: 'right'},
      {top: 25, left: 14, rotate: 180, onClick: this.panDown, content: '▼', key: 'down'}
    ];

    return (
      <ViewControlWrapper>
        <NavigationButtonContainer>
          {buttons.map((b: any) => (
            <NavigationButton key={b.key} top={`${b.top}px`} left={`${b.left}px`} rotate={b.rotate}>
              <LongPressButton onClick={b.onClick}>{b.content}</LongPressButton>
            </NavigationButton>
          ))}
          <NavigationButton
            top={'12px'}
            left={'16px'}
            onClick={() => {
              // console.log('on click fit bounds') || this.props.fitBounds;
            }}
          >
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
              /* @ts-expect-error TODO */
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

export class ViewControlWidget implements Widget<ViewControlProps> {
  id = 'zoom';
  props: ViewControlProps;
  placement: WidgetPlacement = 'top-left';
  orientation: 'vertical' | 'horizontal' = 'vertical';
  viewId?: string | null = null;
  viewports: {[id: string]: Viewport} = {};
  deck?: Deck<any>;
  element?: HTMLDivElement;

  constructor(props: ViewControlProps) {
    this.props = {...ViewControl.defaultProps, ...props};
    this.id = props.id || 'zoom';
    this.viewId = props.viewId || null;
    this.placement = props.placement || 'top-left';
    // this.orientation = props.orientation || 'vertical';
    // props.transitionDuration = props.transitionDuration || 200;
    // props.zoomInLabel = props.zoomInLabel || 'Zoom In';
    // props.zoomOutLabel = props.zoomOutLabel || 'Zoom Out';
    props.style = props.style || {};
    this.props = props;
  }

  onAdd({deck}: {deck: Deck<any>}): HTMLDivElement {
    this.deck = deck;
    this.element = document.createElement('div');

    const {style, className} = this.props;
    this.element.classList.add('deck-widget', 'deck-widget-zoom');
    if (className) {
      this.element.classList.add(className);
    }
    if (style) {
      Object.entries(style).map(([key, value]) =>
        this.element.style.setProperty(key, value as string)
      );
    }
    const ui = (
      <ViewControl
        {...this.props}
        zoomBy={this.handleDeltaZoom.bind(this)}
        panBy={this.handlePanBy.bind(this)}
      />
    );
    render(ui, this.element);

    return this.element;
  }

  onRemove() {
    this.deck = undefined;
    this.element = undefined;
  }

  setProps(props: Partial<ViewControlProps>) {
    Object.assign(this.props, props);
  }

  onViewportChange(viewport: Viewport) {
    this.viewports[viewport.id] = viewport;
  }

  handleDeltaZoom(deltaZoom: number) {
    // console.log('Handle delta zoom');
    for (const view of this.deck.getViewports()) {
      this.handleZoomView(view, view.zoom + deltaZoom);
    }
  }

  handlePanBy(deltaX: number, deltaY: number) {
    // console.log('Handle panby', deltaX, deltaY);
    for (const viewport of this.deck.getViewports()) {
      this.handlePanViewport(viewport, deltaX, deltaY);
    }
  }

  handleZoomView(viewport: Viewport, nextZoom: number) {
    const viewId = this.viewId || viewport?.id || 'default-view';
    // @ts-expect-error TODO we lack a proper API for getting viewStates
    const viewState = this.deck.viewManager.viewState || viewport;
    const nextViewState = {
      ...viewState,
      zoom: nextZoom
      // transitionDuration: this.props.transitionDuration,
      // transitionInterpolator: new FlyToInterpolator()
    };

    // @ts-ignore Using private method temporary until there's a public one
    this.deck._onViewStateChange({viewId, viewState: nextViewState, interactionState: {}});
  }

  handlePanViewport(viewport: Viewport, deltaX: number, deltaY: number) {
    const viewId = this.viewId || viewport?.id || 'default-view';
    // @ts-expect-error TODO we lack a proper API for getting viewStates
    const viewState = this.deck.viewManager.viewState || viewport;
    // console.log('Handle pan viewport', deltaX, deltaY, viewState);
    const nextViewState = {
      ...viewState,
      position: [viewport.position[0] + deltaX, viewport.position[1] + deltaY]
    };

    // @ts-ignore Using private method temporary until there's a public one
    this.deck._onViewStateChange({viewId, viewState: nextViewState, interactionState: {}});
  }
}
