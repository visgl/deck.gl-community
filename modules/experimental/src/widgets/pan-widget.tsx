// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import type {JSX} from 'preact';
import {LongPressButton} from './long-press-button';
import {
  Widget,
  type Deck,
  type Viewport,
  type WidgetPlacement,
  type WidgetProps
} from '@deck.gl/core';

export type PanWidgetProps = WidgetProps & {
  viewId?: string | null;
  placement?: WidgetPlacement;
  /** Amount in screen pixels to pan by when a button is pressed. */
  step?: number;
};

const WRAPPER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  zIndex: '99',
  userSelect: 'none'
};

const NAVIGATION_CONTAINER_STYLE: JSX.CSSProperties = {
  position: 'relative',
  background: '#f7f7f7',
  borderRadius: '23px',
  border: '0.5px solid #eaeaea',
  boxShadow: 'inset 11px 11px 5px -7px rgba(230, 230, 230, 0.49)',
  height: '46px',
  width: '46px'
};

const NAVIGATION_BUTTON_STYLE: JSX.CSSProperties = {
  color: '#848484',
  cursor: 'pointer',
  position: 'absolute',
  pointerEvents: 'auto'
};

export class PanWidget extends Widget<PanWidgetProps> {
  static override defaultProps = {
    id: 'pan',
    viewId: null,
    placement: 'top-left',
    step: 48,
    style: {},
    className: ''
  } satisfies Required<WidgetProps> & Required<Pick<PanWidgetProps, 'step'>> & PanWidgetProps;

  placement: WidgetPlacement = 'top-left';
  className = 'deck-widget-pan';
  deck?: Deck | null = null;
  step: number;

  constructor(props: PanWidgetProps = {}) {
    super({...PanWidget.defaultProps, ...props});
    this.viewId = props.viewId ?? null;
    this.placement = props.placement ?? 'top-left';
    this.step = props.step ?? PanWidget.defaultProps.step;
  }

  override setProps(props: Partial<PanWidgetProps>): void {
    if (props.viewId !== undefined) {
      this.viewId = props.viewId;
    }
    if (props.placement !== undefined) {
      this.placement = props.placement;
    }
    if (props.step !== undefined) {
      this.step = props.step;
    }
    super.setProps(props);
  }

  override onAdd({deck, viewId}: {deck: Deck; viewId: string | null}): void {
    this.deck = deck;
    if (this.viewId === undefined) {
      this.viewId = viewId;
    }
  }

  override onRemove(): void {
    this.deck = null;
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    const style = {...WRAPPER_STYLE, ...this.props.style};
    Object.assign(rootElement.style, style);

    const buttons = [
      {top: -2, left: 14, onClick: () => this.handlePan(0, this.step), label: '▲', key: 'up'},
      {top: 12, left: 0, onClick: () => this.handlePan(this.step, 0), label: '◀', key: 'left'},
      {top: 12, left: 28, onClick: () => this.handlePan(-this.step, 0), label: '▶', key: 'right'},
      {top: 25, left: 14, onClick: () => this.handlePan(0, -this.step), label: '▼', key: 'down'}
    ] as const;

    const ui = (
      <div style={NAVIGATION_CONTAINER_STYLE}>
        {buttons.map((button) => (
          <div
            key={button.key}
            style={{
              ...NAVIGATION_BUTTON_STYLE,
              top: `${button.top}px`,
              left: `${button.left}px`
            } as JSX.CSSProperties}
          >
            <LongPressButton onClick={button.onClick}>{button.label}</LongPressButton>
          </div>
        ))}
      </div>
    );

    render(ui, rootElement);
  }

  private getTargetViewports(): Viewport[] {
    const deck = this.deck as (Deck & {viewManager?: any}) | null;
    if (!deck) {
      return [];
    }

    if (this.viewId) {
      const viewport = deck.viewManager?.getViewport(this.viewId);
      return viewport ? [viewport] : [];
    }
    return deck.getViewports();
  }

  private getViewState(viewport: Viewport): any {
    const viewManager = (this.deck as (Deck & {viewManager?: any}) | null)?.viewManager;
    const viewId = this.viewId || viewport.id;
    if (viewManager) {
      try {
        return {...viewManager.getViewState(viewId)};
      } catch (err) {
        return {...(viewManager.viewState as any)};
      }
    }
    return {...(viewport as any)};
  }

  private handlePan(deltaX: number, deltaY: number) {
    if (!this.deck) {
      return;
    }

    const viewports = this.getTargetViewports();
    for (const viewport of viewports) {
      const center = viewport.unproject([viewport.width / 2, viewport.height / 2]);
      if (!center) {
        continue;
      }

      const nextPixel: [number, number] = [
        viewport.width / 2 + deltaX,
        viewport.height / 2 + deltaY
      ];

      const viewState = this.getViewState(viewport);
      const panUpdate = viewport.panByPosition(center, nextPixel);
      const nextViewState = {...viewState, ...panUpdate};
      const viewId = this.viewId || viewport.id || 'default-view';

      // @ts-ignore Using private method until a public alternative is available
      this.deck._onViewStateChange({viewId, viewState: nextViewState, interactionState: {}});
    }
  }
}
