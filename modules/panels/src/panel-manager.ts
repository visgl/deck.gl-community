// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {MjolnirGestureEvent, MjolnirPointerEvent} from 'mjolnir.js';
import {PanelContainer} from './panel-container';
import {ensurePanelStylesheet} from './lib/panel-styles';

const PLACEMENTS = {
  'top-left': {top: 0, left: 0},
  'top-right': {top: 0, right: 0},
  'bottom-left': {bottom: 0, left: 0},
  'bottom-right': {bottom: 0, right: 0},
  fill: {top: 0, left: 0, bottom: 0, right: 0}
} as const;

const DEFAULT_PLACEMENT = 'top-left';
const ROOT_CONTAINER_ID = 'root';

type PanelPlacement = keyof typeof PLACEMENTS;
type DeckLike = {
  width?: number;
  height?: number;
};

/**
 * Configuration for one standalone panel host.
 */
export type PanelManagerProps = {
  /**
   * Root HTML element that receives placement containers and widget DOM.
   */
  parentElement: HTMLElement;
  /**
   * Optional deck instance used to forward redraw, viewport, and event hooks
   * for panel containers that can take advantage of deck runtime state.
   */
  deck?: unknown | null;
  /**
   * Optional class name appended to the host root alongside
   * `deck-widget-container`.
   */
  className?: string;
};

/**
 * Mounts compatible panel-managed UI instances into a plain HTML element without
 * requiring Deck to own the widget lifecycle.
 *
 * `PanelManager` mirrors the DOM-facing behavior of deck.gl's internal
 * `WidgetManager`: it creates placement containers, reconciles mounted
 * instances by id, and calls the normal lifecycle hooks.
 */
export class PanelManager {
  /**
   * Optional deck instance forwarded into panel lifecycle hooks.
   */
  deck?: unknown | null;
  /**
   * Root HTML element that owns this host's placement containers.
   */
  parentElement: HTMLElement;

  private className?: string;
  private defaultComponents: PanelContainer[] = [];
  private components: PanelContainer[] = [];
  private resolvedComponents: PanelContainer[] = [];
  private containers: {[id: string]: HTMLDivElement} = {};
  private lastViewports: {
    [id: string]: {id: string; x: number; y: number; width: number; height: number};
  } = {};

  /**
   * Creates a standalone panel host rooted in the supplied HTML element.
   */
  constructor({parentElement, deck = null, className}: PanelManagerProps) {
    this.deck = deck;
    this.parentElement = parentElement;
    this.className = className;
    ensurePanelStylesheet(parentElement.ownerDocument);
    this.parentElement.classList.add('deck-widget-container');
    if (className) {
      this.parentElement.classList.add(className);
    }
  }

  /**
   * Returns the currently mounted instances after reconciliation.
   */
  getComponents(): PanelContainer[] {
    return this.resolvedComponents;
  }

  /**
   * Reconciles the declarative component list against the current host state.
   *
   * Matching ids preserve the mounted instance and receive prop updates
   * through `setProps`. Added and removed ids trigger the normal lifecycle.
   */
  setProps(props: {components?: (PanelContainer | null | undefined)[]}) {
    if (props.components && !areComponentListsEqual(props.components, this.components)) {
      const nextComponents = props.components.filter(isPanelContainer);
      this._setComponents(nextComponents);
    }
  }

  /**
   * Removes all mounted instances and internal placement containers.
   */
  finalize() {
    for (const component of this.getComponents()) {
      this._removeComponent(component);
    }
    this.defaultComponents.length = 0;
    this.components.length = 0;
    this.resolvedComponents.length = 0;
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
   * Adds one imperative default instance that stays mounted independently of
   * `setProps({components})` calls.
   */
  addDefault(component: PanelContainer) {
    if (
      !this.defaultComponents.find((existingComponent) => existingComponent.id === component.id)
    ) {
      this._addComponent(component);
      this.defaultComponents.push(component);
      this._setComponents(this.components);
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

    for (const component of this.getComponents()) {
      if (component.viewId) {
        const viewport = viewportsById[component.viewId];
        if (viewport) {
          this._notifyViewportChange(component, [viewport], layers);
        }
      } else {
        this._notifyViewportChange(component, viewports, layers);
      }
    }

    this.lastViewports = viewportsById;
    this._updateContainers();
  }

  /**
   * Forwards hover events to widgets whose `viewId` matches the hovered view.
   */
  onHover(info: {viewport?: {id?: string}}, event: MjolnirPointerEvent) {
    for (const component of this.getComponents()) {
      const {viewId} = component;
      if (!viewId || viewId === info.viewport?.id) {
        component.onHover?.(info, event);
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
    for (const component of this.getComponents()) {
      const {viewId} = component;
      if (!viewId || viewId === info.viewport?.id) {
        component[eventHandlerProp]?.(info, event);
      }
    }
  }

  private _setComponents(nextComponents: PanelContainer[]) {
    const oldComponentMap: Record<string, PanelContainer | null> = {};

    for (const component of this.resolvedComponents) {
      oldComponentMap[component.id] = component;
    }

    this.resolvedComponents.length = 0;

    for (const component of this.defaultComponents) {
      oldComponentMap[component.id] = null;
      this.resolvedComponents.push(component);
    }

    for (let component of nextComponents) {
      const oldComponent = oldComponentMap[component.id];
      if (!oldComponent) {
        this._addComponent(component);
      } else if (
        oldComponent.viewId !== component.viewId ||
        oldComponent.placement !== component.placement ||
        oldComponent.props._container !== component.props._container
      ) {
        this._removeComponent(oldComponent);
        this._addComponent(component);
      } else if (component !== oldComponent) {
        oldComponent.setProps(component.props);
        component = oldComponent;
      }

      oldComponentMap[component.id] = null;
      this.resolvedComponents.push(component);
    }

    for (const id in oldComponentMap) {
      const oldComponent = oldComponentMap[id];
      if (oldComponent) {
        this._removeComponent(oldComponent);
      }
    }

    this.components = nextComponents;
  }

  private _addComponent(component: PanelContainer) {
    const {viewId = null, placement = DEFAULT_PLACEMENT} = component as PanelContainer & {
      placement?: PanelPlacement;
    };
    const container = component.props._container ?? viewId;

    component.widgetManager = this as never;
    component.deck = this.deck ?? undefined;

    component.rootElement = component._onAdd({deck: this.deck ?? undefined, viewId});

    if (component.rootElement) {
      this._getContainer(container, placement).append(component.rootElement);
    }

    component.updateHTML();
  }

  private _removeComponent(component: PanelContainer) {
    component.onRemove?.();

    if (component.rootElement) {
      component.rootElement.remove();
    }
    component.rootElement = undefined;
    component.deck = undefined;
    component.widgetManager = undefined;
  }

  private _notifyViewportChange(
    component: PanelContainer,
    viewports: Array<{id: string; x: number; y: number; width: number; height: number}>,
    layers: unknown[]
  ) {
    if (component.onViewportChange) {
      for (const viewport of viewports) {
        component.onViewportChange(viewport);
      }
    }
    component.onRedraw?.({viewports, layers});
  }

  private _getContainer(
    viewIdOrContainer: string | HTMLDivElement | null,
    placement: PanelPlacement
  ): HTMLDivElement {
    if (viewIdOrContainer && typeof viewIdOrContainer !== 'string') {
      return viewIdOrContainer;
    }

    const containerId =
      typeof viewIdOrContainer === 'string' ? viewIdOrContainer : ROOT_CONTAINER_ID;
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
    const deck = this.deck as DeckLike | null | undefined;
    const canvasWidth = deck?.width ?? this.parentElement.clientWidth;
    const canvasHeight = deck?.height ?? this.parentElement.clientHeight;

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

function areComponentListsEqual(
  left: readonly (PanelContainer | null | undefined)[],
  right: readonly PanelContainer[]
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

function isPanelContainer(
  component: PanelContainer | null | undefined
): component is PanelContainer {
  return Boolean(component);
}
