/** @jsxImportSource preact */
import { OrthographicViewport, Widget } from '@deck.gl/core';
import { render } from 'preact';

import { IconButton, makeTextIcon } from './widget-utils';

import type { Deck, OrthographicViewState, WidgetPlacement, WidgetProps } from '@deck.gl/core';
import type { JSX } from 'preact';

export type YZoomWidgetProps = WidgetProps & {
  contentBounds?: [[number, number], [number, number]];
  viewId?: string | null;
  targetViewId?: string | null;
  placement?: WidgetPlacement;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
};

const DEFAULT_ZOOM_LIMITS = { min: -20, max: 20 } as const;

type RenderedZoomState = {
  clampedZoom: number;
  minZoom: number;
  maxZoom: number;
};

const WRAPPER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '4px',
  background: 'var(--button-background)',
  border: '1px solid var(--button-stroke)',
  boxShadow: 'var(--button-shadow)',
  borderRadius: 'var(--button-corner-radius)',
  margin: 'var(--widget-margin) 0',
  padding: '4px 2px',
  width: 'var(--button-size)',
  boxSizing: 'border-box',
  userSelect: 'none',
  pointerEvents: 'auto',
};

const ZOOM_BUTTON_STYLE: JSX.CSSProperties = {
  boxShadow: 'none',
};

const SLIDER_CONTAINER_STYLE: JSX.CSSProperties = {
  display: 'flex',
  alignItems: 'stretch',
  height: '120px',
  padding: '2px 0',
};

const VERTICAL_SLIDER_STYLE: JSX.CSSProperties = {
  writingMode: 'vertical-lr',
  height: '120px',
  width: '14px',
  margin: 0,
  padding: 0,
};

function cloneViewState(viewState: unknown): Record<string, unknown> {
  return viewState && typeof viewState === 'object'
    ? { ...(viewState as Record<string, unknown>) }
    : {};
}

function hasViewManager(deck: Deck): boolean {
  return Boolean((deck as Deck & { viewManager?: unknown }).viewManager);
}

function stopEventPropagation(event: Event) {
  event.stopPropagation();
  if (
    typeof (event as { stopImmediatePropagation?: () => void }).stopImmediatePropagation ===
    'function'
  ) {
    event.stopImmediatePropagation();
  }
}

function getZoomLimitForAxis(
  limit: OrthographicViewState['minZoom' | 'maxZoom'] | undefined,
  axisIndex: 0 | 1,
): number | undefined {
  if (Array.isArray(limit)) {
    const [x, y] = limit;
    return axisIndex === 0 ? x : (y ?? x);
  }
  return typeof limit === 'number' && Number.isFinite(limit) ? limit : undefined;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export class YZoomWidget extends Widget<YZoomWidgetProps> {
  static override defaultProps = {
    ...Widget.defaultProps,
    id: 'y-zoom',
    viewId: null,
    targetViewId: null,
    placement: 'top-left',
    minZoom: undefined,
    maxZoom: undefined,
    step: 0.1,
  } satisfies Required<WidgetProps> &
    Required<Pick<YZoomWidgetProps, 'step'>> &
    YZoomWidgetProps;

  placement: WidgetPlacement = 'top-left';
  className = 'deck-widget-y-zoom';
  step: number;
  currentZoom = 0;
  inferredMinZoom: number | null = null;
  inferredMaxZoom: number | null = null;
  lastRenderedZoomState: RenderedZoomState | null = null;

  constructor(props: YZoomWidgetProps = {}) {
    super({ ...YZoomWidget.defaultProps, ...props });
    this.viewId = props.viewId ?? null;
    this.placement = props.placement ?? 'top-left';
    this.step = props.step ?? YZoomWidget.defaultProps.step;
  }

  override setProps(props: Partial<YZoomWidgetProps>): void {
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

  override onAdd({ deck, viewId }: { deck: Deck; viewId: string | null }): void {
    this.deck = deck;
    if (this.viewId === undefined) {
      this.viewId = viewId;
    }
  }

  override onRemove(): void {
    this.deck = undefined;
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    const { minZoom, maxZoom, clampedZoom } = this.getRenderedZoomState();
    this.lastRenderedZoomState = { minZoom, maxZoom, clampedZoom };

    const handleInput = (event: Event) => {
      stopEventPropagation(event);
      this.handleZoomTo(Number((event.target as HTMLInputElement).value));
    };

    const addVerticalOrient = (element: HTMLInputElement | null) => {
      element?.setAttribute('orient', 'vertical');
    };

    const stopPointerPropagation: JSX.PointerEventHandler<HTMLElement> = (event) => {
      stopEventPropagation(event as unknown as Event);
    };

    const stopWheelPropagation: JSX.WheelEventHandler<HTMLElement> = (event) => {
      stopEventPropagation(event as unknown as Event);
    };

    const stopMousePropagation: JSX.MouseEventHandler<HTMLElement> = (event) => {
      stopEventPropagation(event as unknown as Event);
    };

    render(
      <div class="deck-widget-button-group" style={WRAPPER_STYLE}>
        <IconButton
          icon={makeTextIcon('—')}
          style={ZOOM_BUTTON_STYLE}
          title="zoom out"
          onClick={() => this.handleZoomDelta(-this.step)}
        />
        <div
          style={SLIDER_CONTAINER_STYLE}
          onPointerDown={stopPointerPropagation}
          onPointerMove={stopPointerPropagation}
          onPointerUp={stopPointerPropagation}
          onWheel={stopWheelPropagation}
          onMouseDown={stopMousePropagation}
          onMouseMove={stopMousePropagation}
          onMouseUp={stopMousePropagation}
        >
          <input
            ref={addVerticalOrient}
            type="range"
            min={String(minZoom)}
            max={String(maxZoom)}
            step={String(this.step)}
            value={String(clampedZoom)}
            aria-label="Adjust Y-axis zoom"
            style={VERTICAL_SLIDER_STYLE}
            onInput={handleInput}
            onChange={handleInput}
            onPointerDown={stopPointerPropagation}
            onPointerMove={stopPointerPropagation}
            onPointerUp={stopPointerPropagation}
            onWheel={stopWheelPropagation}
            onMouseDown={stopMousePropagation}
            onMouseMove={stopMousePropagation}
            onMouseUp={stopMousePropagation}
          />
        </div>
        <IconButton
          icon={makeTextIcon('＋')}
          style={ZOOM_BUTTON_STYLE}
          title="zoom in"
          onClick={() => this.handleZoomDelta(this.step)}
        />
      </div>,
      rootElement,
    );
  }

  override onViewportChange(viewport: OrthographicViewport): void {
    const targetViewId = this.props.targetViewId ?? this.viewId;
    if (targetViewId && targetViewId !== viewport.id) return;

    const viewState = this.getViewState(viewport);
    const zoomY = viewport.zoomY;
    this.currentZoom = zoomY;

    if (this.props.minZoom === undefined) {
      const minZoom = getZoomLimitForAxis(viewState.minZoom, 1);
      if (Number.isFinite(minZoom)) {
        this.inferredMinZoom = minZoom as number;
      }
    }

    if (this.props.maxZoom === undefined) {
      const maxZoom = getZoomLimitForAxis(viewState.maxZoom, 1);
      if (Number.isFinite(maxZoom)) {
        this.inferredMaxZoom = maxZoom as number;
      }
    }

    this.updateHTMLIfRenderedStateChanged();
  }

  /**
   * Returns the effective min/max bounds and the clamped zoom value currently shown in the slider.
   */
  private getRenderedZoomState(): RenderedZoomState {
    const { minZoom, maxZoom } = this.getZoomBounds();
    return {
      minZoom,
      maxZoom,
      clampedZoom: clamp(this.currentZoom, minZoom, maxZoom),
    };
  }

  /**
   * Re-renders the widget only when the displayed slider state changed.
   */
  private updateHTMLIfRenderedStateChanged(): void {
    const nextState = this.getRenderedZoomState();
    const previousState = this.lastRenderedZoomState;
    if (
      previousState &&
      previousState.clampedZoom === nextState.clampedZoom &&
      previousState.minZoom === nextState.minZoom &&
      previousState.maxZoom === nextState.maxZoom
    ) {
      return;
    }
    this.lastRenderedZoomState = nextState;
    this.updateHTML();
  }

  /**
   * Resolves the slider min/max bounds from explicit props or inferred viewport limits.
   */
  private getZoomBounds(): { minZoom: number; maxZoom: number } {
    const minZoom = this.props.minZoom ?? this.inferredMinZoom ?? Number.NEGATIVE_INFINITY;
    const maxZoom = this.props.maxZoom ?? this.inferredMaxZoom ?? Number.POSITIVE_INFINITY;

    if (minZoom > maxZoom) {
      return { minZoom: maxZoom, maxZoom: minZoom };
    }
    return {
      minZoom: Number.isFinite(minZoom) ? minZoom : DEFAULT_ZOOM_LIMITS.min,
      maxZoom: Number.isFinite(maxZoom) ? maxZoom : DEFAULT_ZOOM_LIMITS.max,
    };
  }

  private getTargetViewports(): OrthographicViewport[] {
    const deck = this.deck;
    if (!deck) {
      return [];
    }
    if (this.viewId) {
      if (hasViewManager(deck)) {
        const viewport = (deck as Deck & { viewManager?: any }).viewManager?.getViewport(
          this.props.targetViewId ?? this.viewId,
        );
        return viewport ? [viewport] : [];
      }
      return [];
    }
    return deck.getViewports() as OrthographicViewport[];
  }

  private getViewState(viewport: OrthographicViewport): OrthographicViewState {
    const deck = this.deck;
    const viewManager =
      deck && hasViewManager(deck) ? (deck as Deck & { viewManager?: any }).viewManager : null;
    const viewId = this.viewId || viewport.id;
    if (viewManager) {
      try {
        return { ...viewManager.getViewState(viewId) } as OrthographicViewState;
      } catch (err) {
        return cloneViewState(viewManager.viewState) as OrthographicViewState;
      }
    }
    return cloneViewState(viewport) as OrthographicViewState;
  }

  private handleZoomDelta(delta: number) {
    const { minZoom, maxZoom } = this.getZoomBounds();

    for (const viewport of this.getTargetViewports()) {
      const zoomY = viewport.zoomY;
      const nextZoom = clamp(zoomY + delta, minZoom, maxZoom);
      this.updateViewState(viewport, nextZoom);
    }
  }

  private handleZoomTo(zoom: number) {
    const { minZoom, maxZoom } = this.getZoomBounds();
    const nextZoom = clamp(zoom, minZoom, maxZoom);

    for (const viewport of this.getTargetViewports()) {
      this.updateViewState(viewport, nextZoom);
    }
  }

  private updateViewState(viewport: OrthographicViewport, nextZoomY: number) {
    if (!this.deck) {
      return;
    }

    const { contentBounds } = this.props;
    const viewState = this.getViewState(viewport as OrthographicViewport);
    const zoomX = viewport.zoomX;
    const newViewState = { ...viewState, zoom: [zoomX, nextZoomY] };
    if (contentBounds) {
      const targetY = viewport.target?.[1] ?? 0;
      const minY = contentBounds[0][1];
      const maxY = contentBounds[1][1];
      if (targetY < minY || targetY > maxY) {
        const nextViewport = new OrthographicViewport({ ...viewport, zoomY: nextZoomY });
        const anchor = [contentBounds[0][0], Math.max(minY, Math.min(maxY, targetY))];
        const anchorPixels = viewport.project(anchor);
        newViewState.target = nextViewport.panByPosition(anchor, anchorPixels).target;
      }
    }

    const viewId = this.viewId || viewport.id || 'default-view';
    this.currentZoom = nextZoomY;
    this.updateHTMLIfRenderedStateChanged();

    // @ts-expect-error Using private method until a public alternative is available
    this.deck._onViewStateChange({ viewId, viewState: newViewState, interactionState: {} });
  }
}
