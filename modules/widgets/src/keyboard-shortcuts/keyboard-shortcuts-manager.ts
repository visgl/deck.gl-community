import { findShortcutMatchingKeyEvent } from './keyboard-shortcuts';

import type { KeyboardShortcut } from './keyboard-shortcuts';
import type { EventManager, MjolnirKeyEvent } from 'mjolnir.js';

export class KeyboardShortcutsManager {
  private shortcuts: KeyboardShortcut[] = [];
  eventManager: EventManager;

  constructor(eventManager: EventManager, shortcuts: KeyboardShortcut[]) {
    this.eventManager = eventManager;
    this.shortcuts = shortcuts;
  }

  start() {
    console.log('Installing keyboard shortcuts:', this.shortcuts);
    this.eventManager.on('keydown', this._handleKeyDown);
  }

  stop() {
    this.eventManager.off('keydown', this._handleKeyDown);
    console.log('Uninstalling keyboard shortcuts:', this.shortcuts);
  }

  private _handleKeyDown = (e: MjolnirKeyEvent) => {
    console.log('Mjolnir key event:', e);
    const shortcut = findShortcutMatchingKeyEvent(e.srcEvent, this.shortcuts);
    if (shortcut) {
      shortcut?.onKeyPress?.();
      // e.preventDefault();
    }
    console.log('Key pressed:', e.srcEvent.key, 'Matching shortcut:', shortcut?.name);
  };
}

export class KeyboardShortcutsManagerDocument {
  private shortcuts: KeyboardShortcut[] = [];

  constructor(shortcuts: KeyboardShortcut[]) {
    this.shortcuts = shortcuts;
  }

  start() {
    document.addEventListener('keydown', this._handleKeyDown);
  }

  stop() {
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  private _handleKeyDown(e: KeyboardEvent) {
    const shortcut = findShortcutMatchingKeyEvent(e, this.shortcuts);
    if (shortcut) {
      shortcut?.onKeyPress?.();
      // e.preventDefault();
    }
    console.log('Key pressed:', e.key, 'Matching shortcut:', shortcut?.name);
  }
}
