// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {MjolnirGestureEvent, MjolnirPointerEvent} from 'mjolnir.js';
import {Widget} from './widget';

const PLACEMENTS = {
  'top-left': {top: 0, left: 0},
  'top-right': {top: 0, right: 0},
  'bottom-left': {bottom: 0, left: 0},
  'bottom-right': {bottom: 0, right: 0},
  fill: {top: 0, left: 0, bottom: 0, right: 0}
} as const;

const DEFAULT_PLACEMENT = 'top-left';
const ROOT_CONTAINER_ID = 'root';

type WidgetPlacement = keyof typeof PLACEMENTS;

/**
 * Configuration for one standalone widget host.
 */
export type WidgetHostProps = {
  /**
   * Root HTML element that receives placement containers and widget DOM.
   */
  parentElement: HTMLElement;
  /**
   * Optional deck instance used to forward redraw, viewport, and event hooks
   * for widgets that can take advantage of deck runtime state.
   */
  deck?: unknown | null;
  /**
   * Optional class name appended to the host root alongside
   * `deck-widget-container`.
   */
  className?: string;
};

/**
 * Mounts compatible widget instances into a plain HTML element without
 * requiring Deck to own the widget lifecycle.
 *
 * `WidgetHost` mirrors the DOM-facing behavior of deck.gl's internal
 * `WidgetManager`: it creates placement containers, reconciles widget
 * instances by id, and calls the normal widget lifecycle hooks.
 */
export class WidgetHost {
  /**
   * Optional deck instance forwarded into widget lifecycle hooks.
   */
  deck?: unknown | null;
  /**
   * Root HTML element that owns this host's placement containers.
   */
  parentElement: HTMLElement;

  private className?: string;
  private defaultWidgets: Widget[] = [];
  private widgets: Widget[] = [];
  private resolvedWidgets: Widget[] = [];
  private containers: {[id: string]: HTMLDivElement} = {};
  private lastViewports: {
    [id: string]: {id: string; x: number; y: number; width: number; height: number};
  } = {};

  /**
   * Creates a standalone widget host rooted in the supplied HTML element.
   */
  constructor({parentElement, deck = null, className}: WidgetHostProps) {
    this.deck = deck;
    this.parentElement = parentElement;
    this.className = className;
    this.parentElement.classList.add('deck-widget-container');
    if (className) {
      this.parentElement.classList.add(className);
    }
  }

  /**
   * Returns the currently mounted widget instances after reconciliation.
   */
  getWidgets(): Widget[] {
    return this.resolvedWidgets;
  }

  /**
   * Reconciles the declarative widget list against the current host state.
   *
   * Matching widget ids preserve the mounted instance and receive prop updates
   * through `setProps`. Added and removed ids trigger the normal lifecycle.
   */
  setProps(props: {widgets?: (Widget | null | undefined)[]}) {
    if (props.widgets && !areWidgetListsEqual(props.widgets, this.widgets)) {
      const nextWidgets = props.widgets.filter(isWidget);
      this._setWidgets(nextWidgets);
    }
  }

  /**
   * Removes all mounted widgets and internal placement containers.
   */
  finalize() {
    for (const widget of this.getWidgets()) {
      this._removeWidget(widget);
    }
    this.defaultWidgets.length = 0;
    this.widgets.length = 0;
    this.resolvedWidgets.length = 0;
    this.lastViewports = {};

    for (const id in this.containers) {
      this.containers[id].remove();
    }
    this.containers = {};

    if (this.className) {
      this.parentElement.classList.remove(this.className);
    }
    this.parentElement.classList.remove('deck-widget-container');
  }

  /**
   * Adds one imperative default widget that stays mounted independently of
   * `setProps({widgets})` calls.
   */
  addDefault(widget: Widget) {
    if (!this.defaultWidgets.find((existingWidget) => existingWidget.id === widget.id)) {
      this._addWidget(widget);
      this.defaultWidgets.push(widget);
      this._setWidgets(this.widgets);
    }
  }

  /**
   * Forwards redraw and viewport notifications to mounted widgets.
   *
   * This is optional in standalone mode and is mainly useful when the host is
   * paired with a real deck instance or another renderer that can supply
   * viewport-like geometry.
   */
  onRedraw({
    viewports,
    layers
  }: {
    viewports: Array<{id: string; x: number; y: number; width: number; height: number}>;
    layers: unknown[];
  }) {
    const viewportsById: {
      [id: string]: {id: string; x: number; y: number; width: number; height: number};
    } = viewports.reduce((acc, viewport) => {
      acc[viewport.id] = viewport;
      return acc;
    }, {});

    for (const widget of this.getWidgets()) {
      if (widget.viewId) {
        const viewport = viewportsById[widget.viewId];
        if (viewport) {
          this._notifyViewportChange(widget, [viewport], layers);
        }
      } else {
        this._notifyViewportChange(widget, viewports, layers);
      }
    }

    this.lastViewports = viewportsById;
    this._updateContainers();
  }

  /**
   * Forwards hover events to widgets whose `viewId` matches the hovered view.
   */
  onHover(info: {viewport?: {id?: string}}, event: MjolnirPointerEvent) {
    for (const widget of this.getWidgets()) {
      const {viewId} = widget;
      if (!viewId || viewId === info.viewport?.id) {
        widget.onHover?.(info, event);
      }
    }
  }

  /**
   * Forwards one gesture event family to widgets whose `viewId` matches the
   * active view.
   */
  onEvent(
    eventHandlerProp: 'onClick' | 'onDrag' | 'onDragStart' | 'onDragEnd',
    info: {viewport?: {id?: string}},
    event: MjolnirGestureEvent
  ) {
    for (const widget of this.getWidgets()) {
      const {viewId} = widget;
      if (!viewId || viewId === info.viewport?.id) {
        widget[eventHandlerProp]?.(info, event);
      }
    }
  }

  private _setWidgets(nextWidgets: Widget[]) {
    const oldWidgetMap: Record<string, Widget | null> = {};

    for (const widget of this.resolvedWidgets) {
      oldWidgetMap[widget.id] = widget;
    }

    this.resolvedWidgets.length = 0;

    for (const widget of this.defaultWidgets) {
      oldWidgetMap[widget.id] = null;
      this.resolvedWidgets.push(widget);
    }

    for (let widget of nextWidgets) {
      const oldWidget = oldWidgetMap[widget.id];
      if (!oldWidget) {
        this._addWidget(widget);
      } else if (
        oldWidget.viewId !== widget.viewId ||
        oldWidget.placement !== widget.placement ||
        oldWidget.props._container !== widget.props._container
      ) {
        this._removeWidget(oldWidget);
        this._addWidget(widget);
      } else if (widget !== oldWidget) {
        oldWidget.setProps(widget.props);
        widget = oldWidget;
      }

      oldWidgetMap[widget.id] = null;
      this.resolvedWidgets.push(widget);
    }

    for (const id in oldWidgetMap) {
      const oldWidget = oldWidgetMap[id];
      if (oldWidget) {
        this._removeWidget(oldWidget);
      }
    }

    this.widgets = nextWidgets;
  }

  private _addWidget(widget: Widget) {
    const {viewId = null, placement = DEFAULT_PLACEMENT} = widget as Widget & {
      placement?: WidgetPlacement;
    };
    const container = widget.props._container ?? viewId;

    widget.widgetManager = this as never;
    widget.deck = this.deck ?? undefined;

    widget.rootElement = widget._onAdd({deck: this.deck ?? undefined, viewId});

    if (widget.rootElement) {
      this._getContainer(container, placement).append(widget.rootElement);
    }

    widget.updateHTML();
  }

  private _removeWidget(widget: Widget) {
    widget.onRemove?.();

    if (widget.rootElement) {
      widget.rootElement.remove();
    }
    widget.rootElement = undefined;
    widget.deck = undefined;
    widget.widgetManager = undefined;
  }

  private _notifyViewportChange(
    widget: Widget,
    viewports: Array<{id: string; x: number; y: number; width: number; height: number}>,
    layers: unknown[]
  ) {
    if (widget.onViewportChange) {
      for (const viewport of viewports) {
        widget.onViewportChange(viewport);
      }
    }
    widget.onRedraw?.({viewports, layers});
  }

  private _getContainer(
    viewIdOrContainer: string | HTMLDivElement | null,
    placement: WidgetPlacement
  ): HTMLDivElement {
    if (viewIdOrContainer && typeof viewIdOrContainer !== 'string') {
      return viewIdOrContainer;
    }

    const containerId = viewIdOrContainer || ROOT_CONTAINER_ID;
    let viewContainer = this.containers[containerId];
    if (!viewContainer) {
      const document = this.parentElement.ownerDocument;
      viewContainer = document.createElement('div');
      viewContainer.style.pointerEvents = 'none';
      viewContainer.style.position = 'absolute';
      viewContainer.style.overflow = 'hidden';
      this.parentElement.append(viewContainer);
      this.containers[containerId] = viewContainer;
    }

    let container = viewContainer.querySelector<HTMLDivElement>(`.${placement}`);
    if (!container) {
      const document = this.parentElement.ownerDocument;
      container = document.createElement('div');
      container.className = placement;
      container.style.position = 'absolute';
      container.style.zIndex = '2';
      Object.assign(container.style, PLACEMENTS[placement]);
      viewContainer.append(container);
    }
    return container;
  }

  private _updateContainers() {
    const canvasWidth = this.deck?.width ?? this.parentElement.clientWidth;
    const canvasHeight = this.deck?.height ?? this.parentElement.clientHeight;

    for (const id in this.containers) {
      const viewport = this.lastViewports[id] || null;
      const visible = id === ROOT_CONTAINER_ID || viewport;
      const container = this.containers[id];

      if (visible) {
        container.style.display = 'block';
        container.style.left = `${viewport ? viewport.x : 0}px`;
        container.style.top = `${viewport ? viewport.y : 0}px`;
        container.style.width = `${viewport ? viewport.width : canvasWidth}px`;
        container.style.height = `${viewport ? viewport.height : canvasHeight}px`;
      } else {
        container.style.display = 'none';
      }
    }
  }
}

function areWidgetListsEqual(
  left: readonly (Widget | null | undefined)[],
  right: readonly Widget[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function isWidget(widget: Widget | null | undefined): widget is Widget {
  return Boolean(widget);
}
