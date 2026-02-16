// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {render} from 'preact';
import type {JSX} from 'preact';
import {LongPressButton} from './long-press-button';
import {cloneViewState, hasViewManager} from './view-manager-utils';
import {
  Widget,
  type Deck,
  type Viewport,
  type WidgetPlacement,
  type WidgetProps
} from '@deck.gl/core';

export type ZoomRangeWidgetProps = WidgetProps & {
  viewId?: string | null;
  placement?: WidgetPlacement;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
};

const WRAPPER_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: '#f7f7f7',
  border: '0.5px solid #eaeaea',
  marginTop: '6px',
  padding: '2px 0',
  width: '18px',
  userSelect: 'none',
  pointerEvents: 'auto'
};

const ZOOM_BUTTON_STYLE: JSX.CSSProperties = {
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: '500',
  margin: '-4px'
};

const SLIDER_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'inline-block',
  height: '100px',
  padding: '0',
  width: '10px'
};

const VERTICAL_SLIDER_STYLE: JSX.CSSProperties = {
  writingMode: 'vertical-lr',
  height: '100px',
  padding: '0',
  margin: '0',
  width: '10px'
};

export class ZoomRangeWidget extends Widget<ZoomRangeWidgetProps> {
  static override defaultProps = {
    id: 'zoom-range',
    viewId: null,
    placement: 'top-left',
    minZoom: undefined,
    maxZoom: undefined,
    step: 0.1,
    style: {},
    className: ''
  } satisfies Required<WidgetProps> &
    Required<Pick<ZoomRangeWidgetProps, 'step'>> &
    ZoomRangeWidgetProps;

  placement: WidgetPlacement = 'top-left';
  className = 'deck-widget-zoom-range';
  deck?: Deck | null = null;
  step: number;
  currentZoom = 0;
  inferredMinZoom: number | null = null;
  inferredMaxZoom: number | null = null;

  constructor(props: ZoomRangeWidgetProps = {}) {
    super({...ZoomRangeWidget.defaultProps, ...props});
    this.viewId = props.viewId ?? null;
    this.placement = props.placement ?? 'top-left';
    this.step = props.step ?? ZoomRangeWidget.defaultProps.step;
  }

  override setProps(props: Partial<ZoomRangeWidgetProps>): void {
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

    const {minZoom, maxZoom} = this.getZoomBounds();
    const clampedZoom = Math.max(minZoom, Math.min(maxZoom, this.currentZoom));

    const stopEventPropagation = (event: Event) => {
      event.stopPropagation();
      if (typeof (event as any).stopImmediatePropagation === 'function') {
        (event as any).stopImmediatePropagation();
      }
    };

    const ui = (
      <>
        <div style={ZOOM_BUTTON_STYLE}>
          <LongPressButton onClick={() => this.handleZoomDelta(this.step)}>{'+'}</LongPressButton>
        </div>
        <div
          style={SLIDER_CONTAINER_STYLE}
          onPointerDown={stopEventPropagation}
          onPointerMove={stopEventPropagation}
          onPointerUp={stopEventPropagation}
          onMouseDown={stopEventPropagation}
          onMouseMove={stopEventPropagation}
          onMouseUp={stopEventPropagation}
          onClick={stopEventPropagation}
          onWheel={stopEventPropagation}
          onTouchStart={stopEventPropagation}
          onTouchMove={stopEventPropagation}
          onTouchEnd={stopEventPropagation}
        >
          <input
            type="range"
            value={clampedZoom}
            min={minZoom}
            max={maxZoom}
            step={this.step}
            onInput={(event) => this.handleZoomTo(Number((event.target as HTMLInputElement).value))}
            onChange={(event) =>
              this.handleZoomTo(Number((event.target as HTMLInputElement).value))
            }
            onPointerDown={stopEventPropagation}
            onPointerMove={stopEventPropagation}
            onPointerUp={stopEventPropagation}
            onMouseDown={stopEventPropagation}
            onMouseMove={stopEventPropagation}
            onMouseUp={stopEventPropagation}
            onClick={stopEventPropagation}
            onWheel={stopEventPropagation}
            onTouchStart={stopEventPropagation}
            onTouchMove={stopEventPropagation}
            onTouchEnd={stopEventPropagation}
            /* @ts-expect-error - non-standard attribute for vertical sliders */
            orient="vertical"
            style={VERTICAL_SLIDER_STYLE}
          />
        </div>
        <div style={ZOOM_BUTTON_STYLE}>
          <LongPressButton onClick={() => this.handleZoomDelta(-this.step)}>{'-'}</LongPressButton>
        </div>
      </>
    );

    render(ui, rootElement);
  }

  override onViewportChange(viewport: Viewport): void {
    const viewState = this.getViewState(viewport);
    const zoom = Number(viewState?.zoom);
    if (Number.isFinite(zoom)) {
      this.currentZoom = zoom;
    }

    if (this.props.minZoom === undefined) {
      const minZoom = Number(viewState?.minZoom);
      if (Number.isFinite(minZoom)) {
        this.inferredMinZoom = minZoom;
      }
    }

    if (this.props.maxZoom === undefined) {
      const maxZoom = Number(viewState?.maxZoom);
      if (Number.isFinite(maxZoom)) {
        this.inferredMaxZoom = maxZoom;
      }
    }

    this.updateHTML();
  }

  private getZoomBounds(): {minZoom: number; maxZoom: number} {
    const minZoom = this.props.minZoom ?? this.inferredMinZoom ?? Number.NEGATIVE_INFINITY;
    const maxZoom = this.props.maxZoom ?? this.inferredMaxZoom ?? Number.POSITIVE_INFINITY;

    if (minZoom > maxZoom) {
      return {minZoom: maxZoom, maxZoom: minZoom};
    }
    return {
      minZoom: Number.isFinite(minZoom) ? minZoom : -20,
      maxZoom: Number.isFinite(maxZoom) ? maxZoom : 20
    };
  }

  private getTargetViewports(): Viewport[] {
    const deck = this.deck;
    if (!deck) {
      return [];
    }
    if (this.viewId) {
      if (hasViewManager(deck)) {
        const viewport = deck.viewManager?.getViewport(this.viewId);
        return viewport ? [viewport] : [];
      }
      return [];
    }
    return deck.getViewports();
  }

  private getViewState(viewport: Viewport): any {
    const deck = this.deck;
    const viewManager = hasViewManager(deck) ? deck.viewManager : null;
    const viewId = this.viewId || viewport.id;
    if (viewManager) {
      try {
        return {...viewManager.getViewState(viewId)};
      } catch (err) {
        return cloneViewState(viewManager.viewState);
      }
    }
    return cloneViewState(viewport);
  }

  private handleZoomDelta(delta: number) {
    const {minZoom, maxZoom} = this.getZoomBounds();

    for (const viewport of this.getTargetViewports()) {
      const viewState = this.getViewState(viewport);
      const baseZoom = Number(viewState.zoom);
      const current = Number.isFinite(baseZoom) ? baseZoom : this.currentZoom;
      const nextZoom = Math.max(minZoom, Math.min(maxZoom, current + delta));
      this.updateViewState(viewport, {...viewState, zoom: nextZoom});
    }
  }

  private handleZoomTo(zoom: number) {
    const {minZoom, maxZoom} = this.getZoomBounds();
    const nextZoom = Math.max(minZoom, Math.min(maxZoom, zoom));

    for (const viewport of this.getTargetViewports()) {
      const viewState = this.getViewState(viewport);
      this.updateViewState(viewport, {...viewState, zoom: nextZoom});
    }
  }

  private updateViewState(viewport: Viewport, viewState: any) {
    if (!this.deck) {
      return;
    }

    const viewId = this.viewId || viewport.id || 'default-view';
    this.currentZoom = Number(viewState.zoom) || this.currentZoom;
    this.updateHTML();

    // @ts-ignore Using private method until a public alternative is available
    this.deck._onViewStateChange({viewId, viewState, interactionState: {}});
  }
}
