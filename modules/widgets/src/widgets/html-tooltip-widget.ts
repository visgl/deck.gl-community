// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {PickingInfo, WidgetProps, Viewport} from '@deck.gl/core';
import {HtmlOverlayWidget, type HtmlOverlayWidgetProps, type OverlayItemData} from './html-overlay-widget';

export type HtmlTooltipWidgetProps = HtmlOverlayWidgetProps & {
  /** Delay before showing the tooltip (ms). */
  showDelay?: number;
  /** Extract a tooltip string from picking info. */
  getTooltip?: (pickingInfo: PickingInfo) => string | null | undefined;
};

const TOOLTIP_STYLE: Partial<CSSStyleDeclaration> = {
  transform: 'translate(-50%,-100%)',
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  padding: '4px 8px',
  borderRadius: '8px',
  color: 'white'
};

const SHOW_TOOLTIP_TIMEOUT = 250;

function defaultGetTooltip(pickingInfo: PickingInfo): string | null | undefined {
  return pickingInfo.object?.style?.tooltip;
}

export class HtmlTooltipWidget extends HtmlOverlayWidget<HtmlTooltipWidgetProps> {
  static override defaultProps = {
    ...HtmlOverlayWidget.defaultProps,
    id: 'html-tooltip-overlay',
    showDelay: SHOW_TOOLTIP_TIMEOUT,
    getTooltip: defaultGetTooltip
  } satisfies Required<WidgetProps> &
    Required<Pick<HtmlTooltipWidgetProps, 'showDelay' | 'getTooltip'>> &
    HtmlTooltipWidgetProps;

  private timeoutID: ReturnType<typeof globalThis.setTimeout> | null = null;
  private pickingInfo: PickingInfo | null = null;
  private visible = false;

  override onRemove(): void {
    if (this.timeoutID !== null) {
      globalThis.clearTimeout(this.timeoutID);
      this.timeoutID = null;
    }
    this.visible = false;
    this.pickingInfo = null;
  }

  override onHover(pickingInfo: PickingInfo): void {
    if (this.timeoutID !== null) {
      globalThis.clearTimeout(this.timeoutID);
      this.timeoutID = null;
    }

    const tooltipContent = this.props.getTooltip?.(pickingInfo);

    if (pickingInfo && tooltipContent) {
      const delay = this.props.showDelay ?? SHOW_TOOLTIP_TIMEOUT;
      this.timeoutID = globalThis.setTimeout(() => {
        this.visible = true;
        this.pickingInfo = pickingInfo;
        this.updateHTML();
      }, delay);
    } else {
      this.visible = false;
      this.pickingInfo = null;
      this.updateHTML();
    }
  }

  protected override getOverlayItems(viewport: Viewport): OverlayItemData[] {
    if (!this.visible || !this.pickingInfo) {
      return [];
    }

    const tooltipContent = this.props.getTooltip?.(this.pickingInfo);
    const coordinates =
      this.pickingInfo.coordinate ??
      (this.pickingInfo as Partial<{lngLat: number[]}>).lngLat ??
      null;
    if (!tooltipContent || !coordinates) {
      return [];
    }

    return [
      {
        coordinates,
        key: 'tooltip',
        createElement: (x: number, y: number): HTMLElement => {
          const outer = document.createElement('div');
          outer.style.transform = `translate(${x}px, ${y}px)`;
          outer.style.position = 'absolute';

          const inner = document.createElement('div');
          Object.assign(inner.style, TOOLTIP_STYLE);
          inner.textContent = tooltipContent;

          outer.appendChild(inner);
          return outer;
        }
      }
    ];
  }
}
