// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  cloneElement,
  render,
  toChildArray,
  Fragment,
  type ComponentChildren,
  type VNode
} from 'preact';
import type {Deck, Viewport, WidgetPlacement, WidgetProps} from '@deck.gl/core';
import {Widget} from '@deck.gl/core';

export type HtmlOverlayWidgetProps = WidgetProps & {
  /** View id to attach the overlay to. Defaults to the containing view. */
  viewId?: string | null;
  /** Margin beyond the viewport before hiding overlay items. */
  overflowMargin?: number;
  /** z-index for the overlay container. */
  zIndex?: number;
  /** Items to render; defaults to the supplied children. */
  items?: ComponentChildren;
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

  protected getOverlayItems(viewport: Viewport): VNode[] {
    const {items} = this.props;
    return (items ? toChildArray(items) : []) as VNode[];
  }

  protected projectItems(items: VNode[], viewport: Viewport): VNode[] {
    const renderItems: VNode[] = [];
    items.filter(Boolean).forEach((item, index) => {
      const coordinates = (item.props as any)?.coordinates;
      if (!coordinates) {
        return;
      }
      const [x, y] = this.getCoords(viewport, coordinates);
      if (this.inView(viewport, [x, y])) {
        const key = item.key === null || item.key === undefined ? index : item.key;
        renderItems.push(cloneElement(item, {x, y, key}));
      }
    });

    return renderItems;
  }

  override onRenderHTML(rootElement: HTMLElement): void {
    Object.assign(rootElement.style, ROOT_STYLE, {zIndex: `${this.props.zIndex ?? 1}`});

    const viewport = this.getViewport();
    if (!viewport) {
      render(null, rootElement);
      return;
    }

    const overlayItems = this.getOverlayItems(viewport);
    const renderedItems = this.projectItems(overlayItems, viewport);

    render(<Fragment>{renderedItems}</Fragment>, rootElement);
  }
}
