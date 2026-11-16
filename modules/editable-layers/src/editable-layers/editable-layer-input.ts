// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {EventManager, Pan} from 'mjolnir.js';
import type {MjolnirEvent} from 'mjolnir.js';

export const NATIVE_EVENT_HANDLERS: Record<string, string> = {
  pointerdown: '_onNativeClick',
  click: '_onNativeClick',
  dblclick: '_onNativeClick',
  mousedown: '_onNativeMapInteraction',
  touchstart: '_onNativeMapInteraction',
  touchmove: '_onNativeMapInteraction',
  touchend: '_onNativeMapInteraction',
  touchcancel: '_onNativeMapInteraction'
};

// Native clicks bypass the recognizer's 300ms double-click failure delay.
export const EVENT_TYPES = [
  'click',
  'pointermove',
  'panstart',
  'panmove',
  'panend',
  'pancancel',
  'keyup',
  'dblclick'
];

type TouchActionLease = {
  owners: Set<object>;
  previousTouchAction: string;
  managedTouchAction: string;
};

type EditableLayerInputOptions = {
  deckEventManager: EventManager;
  onEvent: (event: MjolnirEvent | Event) => void;
};

// Several editable layers may share one map canvas; restore its style after the last layer leaves.
const TOUCH_ACTION_LEASES = new WeakMap<HTMLElement, TouchActionLease>();

function acquireTouchAction(target: HTMLElement, owner: object) {
  let lease = TOUCH_ACTION_LEASES.get(target);
  if (!lease) {
    lease = {
      owners: new Set(),
      previousTouchAction: target.style.touchAction,
      managedTouchAction: target.style.touchAction
    };
    TOUCH_ACTION_LEASES.set(target, lease);
  } else if (target.style.touchAction !== lease.managedTouchAction) {
    // Treat a style change made while a target is leased as the application's new baseline.
    lease.previousTouchAction = target.style.touchAction;
  }
  lease.owners.add(owner);
}

function recordTouchAction(target: HTMLElement) {
  const lease = TOUCH_ACTION_LEASES.get(target);
  if (lease) {
    lease.managedTouchAction = target.style.touchAction;
  }
}

function releaseTouchAction(target: HTMLElement, owner: object, touchActionBeforeDestroy: string) {
  const lease = TOUCH_ACTION_LEASES.get(target);
  if (!lease || !lease.owners.delete(owner)) {
    return;
  }
  if (lease.owners.size > 0) {
    target.style.touchAction = touchActionBeforeDestroy;
    return;
  }
  target.style.touchAction =
    touchActionBeforeDestroy === lease.managedTouchAction
      ? lease.previousTouchAction
      : touchActionBeforeDestroy;
  TOUCH_ACTION_LEASES.delete(target);
}

/**
 * Owns the DOM and Mjolnir lifecycle for one EditableLayer input target.
 *
 * By default input arrives where deck.gl's event manager listens: its canvas, or the React
 * `<DeckGL>` wrapper that also holds child base maps. Handlers then share deck's manager so
 * editing can outrank its controller. An overlaid map canvas never reaches deck's manager, so
 * that target gets its own gesture recognizer.
 */
export class EditableLayerInput {
  private readonly handler: (event: MjolnirEvent | Event) => void;

  /** Element receiving input, resolved from the `eventTarget` prop. */
  eventTarget: HTMLElement | null;

  private readonly deckEventManager: EventManager;
  private readonly touchActionOwner = {};
  private eventManager: EventManager | null = null;
  private gestureEventTypes: string[] = [];
  private connected = false;

  constructor({deckEventManager, onEvent}: EditableLayerInputOptions) {
    this.eventTarget = null;
    this.deckEventManager = deckEventManager;
    this.handler = onEvent;
  }

  /**
   * Listens on `eventTarget`, or on deck's own input element when it is null.
   * Returns whether the resolved target changed.
   */
  setTarget(eventTarget: HTMLElement | null): boolean {
    const target = eventTarget || this.deckEventManager?.getElement?.() || null;
    if (this.connected && target === this.eventTarget) {
      return false;
    }
    if (this.connected) {
      this.removeEventHandlers();
    }
    this.eventTarget = target;
    this.addEventHandlers();
    this.connected = true;
    return true;
  }

  destroy() {
    if (!this.connected) {
      return;
    }
    this.removeEventHandlers();
    this.eventTarget = null;
    this.connected = false;
  }

  private addEventHandlers() {
    const {eventTarget, handler} = this;
    const ownsEventManager = Boolean(
      eventTarget && eventTarget !== this.deckEventManager?.getElement?.()
    );
    if (ownsEventManager) {
      acquireTouchAction(eventTarget!, this.touchActionOwner);
    }

    // MapboxOverlay forwards map callbacks directly to Deck, bypassing its event manager.
    // Recognize input on the supplied map canvas without changing the render canvas behavior.
    const eventManager = ownsEventManager
      ? new EventManager(eventTarget!, {recognizers: [[Pan, {threshold: 3}]], cssProps: {}})
      : this.deckEventManager;
    this.eventManager = eventManager;
    this.gestureEventTypes = eventTarget
      ? EVENT_TYPES.filter(type => !NATIVE_EVENT_HANDLERS[type])
      : EVENT_TYPES;

    for (const eventType of Object.keys(NATIVE_EVENT_HANDLERS)) {
      eventTarget?.addEventListener(eventType, handler);
    }
    for (const eventType of this.gestureEventTypes) {
      eventManager.on(eventType, handler, {
        // Give editable handlers priority to stop deck.gl's map-panning handlers.
        priority: 100
      });
    }
    if (ownsEventManager) {
      recordTouchAction(eventTarget!);
    }
  }

  private removeEventHandlers() {
    const {eventTarget, eventManager, handler} = this;
    if (!eventManager) {
      return;
    }
    const ownsEventManager = eventManager !== this.deckEventManager;
    const touchActionBeforeCleanup = ownsEventManager ? eventTarget!.style.touchAction : undefined;

    for (const eventType of Object.keys(NATIVE_EVENT_HANDLERS)) {
      eventTarget?.removeEventListener(eventType, handler);
    }
    for (const eventType of this.gestureEventTypes) {
      eventManager.off(eventType, handler);
    }
    if (ownsEventManager) {
      eventManager.destroy();
      // Release our recognizer's CSS without overwriting later application changes.
      releaseTouchAction(eventTarget!, this.touchActionOwner, touchActionBeforeCleanup!);
    }

    this.eventManager = null;
    this.gestureEventTypes = [];
  }
}
