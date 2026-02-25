// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck, Viewport, WidgetPlacement, WidgetProps} from '@deck.gl/core';
import {Widget} from '@deck.gl/core';

/** Framework-agnostic overlay item descriptor. */
export type OverlayItemData = {
  /** World coordinates [lng, lat, ...]. */
  coordinates: number[];
  /** Stable key for reconciliation. */
  key?: string | number;
  /** Create a positioned DOM element at the given screen-space coordinates. */
  createElement: (x: number, y: number) => HTMLElement;
};

export type HtmlOverlayWidgetProps = WidgetProps & {
  /** View id to attach the overlay to. Defaults to the containing view. */
  viewId?: string | null;
  /** Margin beyond the viewport before hiding overlay items. */
  overflowMargin?: number;
  /** z-index for the overlay container. */
  zIndex?: number;
  /** Items to render; used by the default getOverlayItems(). */
  items?: OverlayItemData[];
  /** Create an overlay root for custom rendering. */
  onCreateOverlay?: (container: HTMLElement) => unknown;
  /** Render into a previously created overlay root. */
  onRenderOverlay?: (overlayRoot: unknown, element: HTMLElement | null, container: HTMLElement) => void;
};

const ROOT_STYLE: Partial<CSSStyleDeclaration> = {
  width: '100%',
  height: '100%',
  position: 'absolute',
  pointerEvents: 'none',
  overflow: 'hidden'
};

export class HtmlOverlayWidget<
  PropsT extends HtmlOverlayWidgetProps = HtmlOverlayWidgetProps
> extends Widget<PropsT> {
  static override defaultProps = {
    id: 'html-overlay',
    viewId: null,
    _container: null,
    overflowMargin: 0,
    zIndex: 1,
    style: {},
    className: ''
  } satisfies Required<WidgetProps> &
    Required<Pick<HtmlOverlayWidgetProps, 'overflowMargin' | 'zIndex'>> &
    HtmlOverlayWidgetProps;

  placement: WidgetPlacement = 'fill';
  className = 'deck-widget-html-overlay';
  deck?: Deck | null = null;
  protected viewport: Viewport | null = null;
  protected overlayRoot: unknown = null;
  protected overlayRootInitialized = false;

  constructor(props: PropsT = {} as PropsT) {
    super({...HtmlOverlayWidget.defaultProps, ...props});
    this.viewId = props.viewId ?? null;
  }

  override setProps(props: Partial<PropsT>): void {
    if (props.viewId !== undefined) {
      this.viewId = props.viewId;
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
    this.viewport = null;
    this.overlayRoot = null;
    this.overlayRootInitialized = false;
  }

  override onViewportChange(viewport: Viewport): void {
    if (!this.viewId || this.viewId === viewport.id) {
      this.viewport = viewport;
      this.updateHTML();
    }
  }

  protected getViewport(): Viewport | null {
    return this.viewport;
  }

  protected getZoom(): number {
    return this.viewport?.zoom ?? 0;
  }

  protected scaleWithZoom(n: number): number {
    return n / Math.pow(2, 20 - this.getZoom());
  }

  protected breakpointWithZoom<T>(threshold: number, a: T, b: T): T {
    return this.getZoom() > threshold ? a : b;
  }

  protected getCoords(viewport: Viewport, coordinates: number[]): [number, number] {
    const pos = viewport.project(coordinates);
    if (!pos) return [-1, -1];
    return pos as [number, number];
  }

  protected inView(viewport: Viewport, [x, y]: number[]): boolean {
    const overflowMargin = this.props.overflowMargin ?? 0;
    const {width, height} = viewport;
    return !(
      x < -overflowMargin ||
      y < -overflowMargin ||
      x > width + overflowMargin ||
      y > height + overflowMargin
    );
  }

  protected getOverlayItems(viewport: Viewport): OverlayItemData[] {
    return (this.props.items as OverlayItemData[] | undefined) ?? [];
  }

  protected projectItems(items: OverlayItemData[], viewport: Viewport): HTMLElement[] {
    const rendered: HTMLElement[] = [];
    for (const item of items) {
      if (!item) continue;
      const coordinates = item.coordinates;
      if (!coordinates) continue;
      const [x, y] = this.getCoords(viewport, coordinates);
      if (this.inView(viewport, [x, y])) {
        rendered.push(item.createElement(x, y));
      }
    }
    return rendered;
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    Object.assign(rootElement.style, ROOT_STYLE, {zIndex: `${this.props.zIndex ?? 1}`});

    const viewport = this.getViewport();

    const {onRenderOverlay, onCreateOverlay} = this.props;
    if (onRenderOverlay) {
      if (!this.overlayRootInitialized) {
        this.overlayRoot = onCreateOverlay?.(rootElement) ?? null;
        this.overlayRootInitialized = true;
      }
      // For React portal path: pass a container element with projected children
      const container = viewport
        ? (() => {
            const items = this.getOverlayItems(viewport);
            const elements = this.projectItems(items, viewport);
            const wrapper = document.createElement('div');
            for (const el of elements) wrapper.appendChild(el);
            return wrapper;
          })()
        : null;
      onRenderOverlay(this.overlayRoot, container, rootElement);
      return;
    }

    // Vanilla DOM path: clear and re-append projected elements
    while (rootElement.firstChild) {
      rootElement.removeChild(rootElement.firstChild);
    }

    if (viewport) {
      const items = this.getOverlayItems(viewport);
      const elements = this.projectItems(items, viewport);
      for (const el of elements) {
        rootElement.appendChild(el);
      }
    }
  }
}
