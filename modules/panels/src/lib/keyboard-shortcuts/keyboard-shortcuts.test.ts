import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  DEFAULT_SHORTCUTS,
  findShortcutMatchingKeyEvent,
  formatKey,
  isShortcutMatchingKeyEvent
} from './keyboard-shortcuts';
import {
  KeyboardShortcutsManager,
  KeyboardShortcutsManagerDocument
} from './keyboard-shortcuts-manager';

import type {KeyboardShortcut} from './keyboard-shortcuts';

type Handler = (event: {srcEvent: KeyboardEvent}) => void;

class FakeEventManager {
  handlers = new Map<string, Handler>();

  on(event: string, handler: Handler) {
    this.handlers.set(event, handler);
  }

  off(event: string, handler: Handler) {
    const existing = this.handlers.get(event);
    if (existing === handler) {
      this.handlers.delete(event);
    }
  }

  emit(event: string, srcEvent: KeyboardEvent) {
    const handler = this.handlers.get(event);
    handler?.({srcEvent});
  }
}

const isMac =
  typeof window !== 'undefined' && globalThis.navigator.platform.toUpperCase().includes('MAC');

function keyEvent(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...options
  } as KeyboardEvent;
}

function commandKeyEvent(key: string, options: KeyboardEventInit = {}): KeyboardEvent {
  return keyEvent(key, {
    ctrlKey: !isMac,
    metaKey: isMac,
    ...options
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('keyboard shortcuts', () => {
  it('formats common keys for display', () => {
    expect(formatKey('a')).toBe('A');
    expect(formatKey('ArrowLeft')).toBe('←');
    expect(formatKey('Numpad1')).toBe('Num 1');
  });

  it('does not match plain shortcuts when extra modifiers are pressed', () => {
    const shortcut: KeyboardShortcut = {
      key: 'r',
      name: 'Refresh',
      description: 'Refresh the view.'
    };

    expect(isShortcutMatchingKeyEvent(keyEvent('r'), shortcut)).toBe(true);
    expect(isShortcutMatchingKeyEvent(keyEvent('r', {metaKey: true}), shortcut)).toBe(false);
    expect(isShortcutMatchingKeyEvent(keyEvent('r', {ctrlKey: true}), shortcut)).toBe(false);
    expect(isShortcutMatchingKeyEvent(keyEvent('r', {altKey: true}), shortcut)).toBe(false);
  });

  it('finds a matching default shortcut', () => {
    const event = commandKeyEvent('/');
    const match = findShortcutMatchingKeyEvent(event, DEFAULT_SHORTCUTS);
    expect(match?.key).toBe('/');
  });

  it('prefers the most specific matching shortcut when keys overlap', () => {
    const shortcuts: KeyboardShortcut[] = [
      {
        key: 'c',
        shiftKey: true,
        name: 'Next mode',
        description: 'Cycle to the next mode.'
      },
      {
        key: 'c',
        commandKey: true,
        shiftKey: true,
        name: 'Previous mode',
        description: 'Cycle to the previous mode.'
      }
    ];

    const event = commandKeyEvent('C', {shiftKey: true});
    const match = findShortcutMatchingKeyEvent(event, shortcuts);

    expect(match?.name).toBe('Previous mode');
  });

  it('invokes shortcut handlers and applies preventDefault only when requested', () => {
    const onKeyPress = vi.fn();
    const preventDefault = vi.fn();
    const shortcut: KeyboardShortcut = {
      key: 'g',
      commandKey: true,
      name: 'Go',
      description: 'Go.',
      preventDefault: true,
      onKeyPress
    };

    const eventManager = new FakeEventManager();
    const manager = new KeyboardShortcutsManager(eventManager as never, [shortcut]);
    manager.start();

    const event = commandKeyEvent('g');
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault,
      configurable: true
    });

    eventManager.emit('keydown', event);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onKeyPress).toHaveBeenCalledTimes(1);

    manager.stop();
    expect(eventManager.handlers.has('keydown')).toBe(false);
  });

  it('applies preventDefault in the document manager', () => {
    const onKeyPress = vi.fn();
    const preventDefault = vi.fn();
    const shortcut: KeyboardShortcut = {
      key: 'g',
      commandKey: true,
      name: 'Go',
      description: 'Go.',
      preventDefault: true,
      onKeyPress
    };
    let keydownHandler: ((event: KeyboardEvent) => void) | undefined;
    vi.stubGlobal('document', {
      addEventListener: (_event: string, handler: (event: KeyboardEvent) => void) => {
        keydownHandler = handler;
      },
      removeEventListener: (_event: string, handler: (event: KeyboardEvent) => void) => {
        if (keydownHandler === handler) {
          keydownHandler = undefined;
        }
      }
    });

    const manager = new KeyboardShortcutsManagerDocument([shortcut]);
    manager.start();

    const event = commandKeyEvent('g');
    Object.defineProperty(event, 'preventDefault', {
      value: preventDefault,
      configurable: true
    });
    keydownHandler?.(event);

    manager.stop();
    expect(keydownHandler).toBeUndefined();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(onKeyPress).toHaveBeenCalledTimes(1);
  });
});
