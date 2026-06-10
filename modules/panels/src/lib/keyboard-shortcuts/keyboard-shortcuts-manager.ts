import {commandManager} from '../commands/command-manager';
import {findShortcutMatchingKeyEvent, formatShortcutKeyHTML} from './keyboard-shortcuts';

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
  static readonly #keyHTMLByCommandId = new Map<string, string>();
  private shortcuts: KeyboardShortcut[] = [];
  eventManager: KeyboardShortcutEventManager;

  /**
   * Creates a shortcut manager bound to one event-manager style source.
   */
  constructor(eventManager: KeyboardShortcutEventManager, shortcuts: KeyboardShortcut[]) {
    this.eventManager = eventManager;
    this.shortcuts = shortcuts;
    KeyboardShortcutsManager.registerShortcutKeyHTML(shortcuts);
  }

  /** Returns compact key display text for one command id when known. */
  static getKeyHTML(commandId: string): string | undefined {
    return KeyboardShortcutsManager.#keyHTMLByCommandId.get(commandId);
  }

  /** Returns compact key display text for one command id from this manager. */
  getKeyHTML(commandId: string): string | undefined {
    return (
      getKeyHTMLForShortcuts(this.shortcuts, commandId) ??
      KeyboardShortcutsManager.getKeyHTML(commandId)
    );
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
      if (shortcut.shouldHandle && !shortcut.shouldHandle(event.srcEvent)) {
        return;
      }
      if (shortcut.preventDefault) {
        event.srcEvent.preventDefault?.();
      }
      runShortcutCommand(shortcut);
    }
  };

  /** Records command key labels from shortcut definitions for external tooltip rendering. */
  static registerShortcutKeyHTML(shortcuts: readonly KeyboardShortcut[]): void {
    for (const shortcut of shortcuts) {
      if (!shortcut.commandId) {
        continue;
      }
      KeyboardShortcutsManager.#keyHTMLByCommandId.set(
        shortcut.commandId,
        formatShortcutKeyHTML(shortcut)
      );
    }
  }
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
    KeyboardShortcutsManager.registerShortcutKeyHTML(shortcuts);
  }

  /** Returns compact key display text for one command id when known. */
  getKeyHTML(commandId: string): string | undefined {
    return (
      getKeyHTMLForShortcuts(this.shortcuts, commandId) ??
      KeyboardShortcutsManager.getKeyHTML(commandId)
    );
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
      if (shortcut.shouldHandle && !shortcut.shouldHandle(event)) {
        return;
      }
      if (shortcut.preventDefault) {
        event.preventDefault();
      }
      runShortcutCommand(shortcut);
    }
  };
}

function runShortcutCommand(shortcut: KeyboardShortcut): void {
  if (shortcut.commandId) {
    commandManager.executeCommand(shortcut.commandId);
    return;
  }
  shortcut.onKeyPress?.();
}

function getKeyHTMLForShortcuts(
  shortcuts: readonly KeyboardShortcut[],
  commandId: string
): string | undefined {
  const shortcut = shortcuts.find(candidate => candidate.commandId === commandId);
  return shortcut ? formatShortcutKeyHTML(shortcut) : undefined;
}
