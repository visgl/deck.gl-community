import {findShortcutMatchingKeyEvent} from './keyboard-shortcuts';

import type {KeyboardShortcut} from './keyboard-shortcuts';

/**
 * Minimal event payload contract for keyboard shortcut managers that forward DOM keyboard events.
 */
export type KeyboardShortcutManagerEvent = {
  srcEvent: KeyboardEvent;
};

/**
 * Minimal event manager contract used by {@link KeyboardShortcutsManager}.
 * Compatible with mjolnir.js event managers without requiring a direct dependency.
 */
export type KeyboardShortcutEventManager = {
  on(event: 'keydown', handler: (event: KeyboardShortcutManagerEvent) => void): void;
  off(event: 'keydown', handler: (event: KeyboardShortcutManagerEvent) => void): void;
};

/**
 * Installs keyboard shortcuts on an event manager that forwards `keydown` events.
 */
export class KeyboardShortcutsManager {
  private shortcuts: KeyboardShortcut[] = [];
  eventManager: KeyboardShortcutEventManager;

  /**
   * Creates a shortcut manager bound to one event-manager style source.
   */
  constructor(eventManager: KeyboardShortcutEventManager, shortcuts: KeyboardShortcut[]) {
    this.eventManager = eventManager;
    this.shortcuts = shortcuts;
  }

  /**
   * Starts listening for forwarded `keydown` events.
   */
  start() {
    this.eventManager.on('keydown', this._handleKeyDown);
  }

  /**
   * Stops listening for forwarded `keydown` events.
   */
  stop() {
    this.eventManager.off('keydown', this._handleKeyDown);
  }

  private _handleKeyDown = (event: KeyboardShortcutManagerEvent) => {
    const shortcut = findShortcutMatchingKeyEvent(event.srcEvent, this.shortcuts);
    if (shortcut) {
      if (shortcut.preventDefault) {
        event.srcEvent.preventDefault?.();
      }
      shortcut.onKeyPress?.();
    }
  };
}

/**
 * Installs keyboard shortcuts directly on `document`.
 */
export class KeyboardShortcutsManagerDocument {
  private shortcuts: KeyboardShortcut[] = [];

  /**
   * Creates a shortcut manager that listens directly on `document`.
   */
  constructor(shortcuts: KeyboardShortcut[]) {
    this.shortcuts = shortcuts;
  }

  /**
   * Starts listening for `keydown` events on `document`.
   */
  start() {
    document.addEventListener('keydown', this._handleKeyDown);
  }

  /**
   * Stops listening for `keydown` events on `document`.
   */
  stop() {
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  private _handleKeyDown = (event: KeyboardEvent) => {
    const shortcut = findShortcutMatchingKeyEvent(event, this.shortcuts);
    if (shortcut) {
      if (shortcut.preventDefault) {
        event.preventDefault();
      }
      shortcut.onKeyPress?.();
    }
  };
}
