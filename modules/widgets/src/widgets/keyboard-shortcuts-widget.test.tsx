import {afterEach, describe, expect, it} from 'vitest';

import {commandManager} from '@deck.gl-community/panels';
import {KeyboardShortcutsWidget} from './keyboard-shortcuts-widget';

import type {KeyboardShortcut} from '@deck.gl-community/panels';

type Handler = (event: {srcEvent: KeyboardEvent}) => void;

const isMac =
  typeof window !== 'undefined' && globalThis.navigator.platform.toUpperCase().includes('MAC');

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

function commandKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !isMac,
    metaKey: isMac
  });
}

/**
 * Renders a keyboard shortcuts widget into a detached DOM node for interaction tests.
 */
function renderWidget(options?: {
  commandId?: string;
  eventManager?: FakeEventManager;
  installShortcuts?: boolean;
  keyboardShortcuts?: KeyboardShortcut[];
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const widget = new KeyboardShortcutsWidget({
    commandId: options?.commandId,
    installShortcuts: options?.installShortcuts,
    keyboardShortcuts: options?.keyboardShortcuts ?? []
  });

  if (options?.eventManager) {
    (widget as unknown as {deck?: {eventManager: FakeEventManager}}).deck = {
      eventManager: options.eventManager
    };
  }

  widget.onRenderHTML(root);
  widget.onAdd();

  return {
    root,
    widget,
    cleanup() {
      widget.onRemove();
      root.remove();
    }
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('KeyboardShortcutsWidget', () => {
  it('renders paired and single shortcut rows with shared descriptions', async () => {
    const {root, cleanup} = renderWidget({
      keyboardShortcuts: [
        {
          key: 'a',
          name: 'Pan Left',
          description: 'Pan left',
          badges: ['perfetto'],
          displayPair: {
            id: 'pan-horizontal',
            position: 'primary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'd',
          name: 'Pan Right',
          description: 'Pan right',
          badges: ['perfetto'],
          displayPair: {
            id: 'pan-horizontal',
            position: 'secondary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'g',
          name: 'Jump',
          description: 'Move to the selected span.'
        },
        {
          key: 'c',
          name: 'Next color scheme',
          description: 'Cycle to the next color scheme.',
          displayPair: {
            id: 'color',
            position: 'primary',
            description: 'Cycle to next/prev color scheme.'
          }
        },
        {
          key: 'c',
          shiftKey: true,
          name: 'Previous color scheme',
          description: 'Cycle to the previous color scheme.',
          displayPair: {
            id: 'color',
            position: 'secondary',
            description: 'Cycle to next/prev color scheme.'
          }
        }
      ]
    });

    (root.querySelector('button[title="Keyboard shortcuts"]') as HTMLButtonElement).click();
    await Promise.resolve();

    const descriptions = Array.from(
      root.querySelectorAll('[data-shortcut-description="true"]')
    ).map(element => element.textContent);

    expect(descriptions).toContain('Show keyboard shortcuts');
    expect(descriptions).toContain('Pan horizontally.');
    expect(descriptions).toContain('Move to the selected span.');
    expect(descriptions).not.toContain('Jump');
    const sections = Array.from(root.querySelectorAll('[data-shortcut-section]'));
    expect(sections.map(section => section.getAttribute('data-shortcut-section'))).toEqual([
      'Navigation',
      'Commands',
      'Settings'
    ]);
    expect(sections[0]?.textContent).toContain('Pan horizontally.');
    expect(sections[0]?.textContent).not.toContain('Move to the selected span.');
    expect(sections[1]?.textContent).toContain('Show keyboard shortcuts');
    expect(sections[1]?.textContent).toContain('Move to the selected span.');
    expect(sections[2]?.textContent).toContain('Cycle to next/prev color scheme.');
    expect(root.querySelectorAll('[data-shortcut-row-kind="pair"]')).toHaveLength(2);
    expect(root.querySelectorAll('[data-shortcut-row-kind="single"]')).toHaveLength(2);
    const pairedRow = root.querySelector(
      '[data-shortcut-row-kind="pair"]'
    ) as HTMLDivElement | null;
    expect(pairedRow?.style.gap).toBe('11px');
    const keyTexts = Array.from(
      root.querySelectorAll('[data-shortcut-input-kind="keyboard"] kbd')
    ).map(element => element.textContent);
    expect(keyTexts).toContain('/');
    expect(keyTexts).toContain('A');
    expect(keyTexts).toContain('D');
    expect(root.textContent).toContain('perfetto');
    expect(root.textContent?.match(/perfetto/g)).toHaveLength(1);

    cleanup();
  });

  it('falls back to separate rows when pair metadata is not adjacent', async () => {
    const {root, cleanup} = renderWidget({
      keyboardShortcuts: [
        {
          key: 'a',
          name: 'Pan Left',
          description: 'Pan left',
          displayPair: {
            id: 'pan-horizontal',
            position: 'primary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'g',
          name: 'Jump',
          description: 'Move to the selected span.'
        },
        {
          key: 'd',
          name: 'Pan Right',
          description: 'Pan right',
          displayPair: {
            id: 'pan-horizontal',
            position: 'secondary',
            description: 'Pan horizontally.'
          }
        }
      ]
    });

    (root.querySelector('button[title="Keyboard shortcuts"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.querySelectorAll('[data-shortcut-row-kind="pair"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-shortcut-row-kind="single"]')).toHaveLength(4);
    expect(root.textContent).not.toContain('Pan horizontally.');

    cleanup();
  });

  it('opens the shortcuts dialog from the default keyboard binding', async () => {
    const eventManager = new FakeEventManager();
    const {root, cleanup} = renderWidget({
      commandId: 'test.shortcuts.open',
      eventManager,
      installShortcuts: true
    });

    expect(root.querySelector('button')?.getAttribute('title')).toBe(
      isMac ? 'Keyboard shortcuts (⌘/)' : 'Keyboard shortcuts (Ctrl+/)'
    );

    eventManager.emit('keydown', commandKeyEvent('/'));
    await Promise.resolve();
    expect(root.querySelector('[role="dialog"]')).toBeTruthy();

    cleanup();
  });

  it('opens the shortcuts dialog from its configured command id', async () => {
    const {root, cleanup} = renderWidget({
      commandId: 'test.shortcuts.command-open'
    });

    commandManager.executeCommand('test.shortcuts.command-open');
    await Promise.resolve();

    expect(root.querySelector('[role="dialog"]')).toBeTruthy();

    cleanup();
  });

  it('renders display-only mouse and trackpad interactions', async () => {
    const {root, cleanup} = renderWidget({
      keyboardShortcuts: [
        {
          key: '',
          name: 'Trackpad pan',
          description: 'Pan with the trackpad.',
          displayInputs: [
            {
              kind: 'trackpad',
              label: 'two-finger swipe',
              icon: 'trackpad-pan'
            }
          ]
        },
        {
          key: '',
          name: 'Mouse drag',
          description: 'Measure time with the mouse.',
          displayInputs: [
            {
              kind: 'mouse',
              label: 'drag',
              modifiers: ['shift'],
              icon: 'mouse-drag'
            }
          ]
        }
      ]
    });

    (root.querySelector('button[title="Keyboard shortcuts"]') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(root.querySelector('[data-shortcut-input-kind="trackpad"]')).toBeTruthy();
    expect(root.querySelector('[data-shortcut-input-kind="mouse"]')).toBeTruthy();
    expect(root.querySelector('svg[aria-label="Keyboard"]')).toBeNull();
    expect(root.querySelector('svg[aria-label="Trackpad pan"]')).toBeTruthy();
    expect(root.querySelector('svg[aria-label="Mouse drag"]')).toBeNull();
    expect(root.textContent).toContain('two-finger swipe');
    expect(root.textContent).toContain('drag');
    expect(root.textContent).toContain('Shift');

    cleanup();
  });

  it('honors explicit section overrides for display-only interactions', async () => {
    const {root, cleanup} = renderWidget({
      keyboardShortcuts: [
        {
          key: '',
          name: 'Press and drag',
          description: 'Pan with the trackpad.',
          displaySection: 'navigation',
          displayInputs: [
            {
              kind: 'trackpad',
              label: 'press + drag',
              icon: 'trackpad-pan'
            }
          ]
        },
        {
          key: '',
          name: 'Select Block',
          description: 'Select a span and open the span inspector.',
          displaySection: 'interaction',
          displayInputs: [
            {
              kind: 'trackpad',
              label: 'click',
              icon: 'trackpad-click'
            }
          ]
        },
        {
          key: '',
          shiftKey: true,
          name: 'Select Dependent Blocks',
          description: 'Select a span and hide non-dependent spans.',
          displaySection: 'interaction',
          displayInputs: [
            {
              kind: 'trackpad',
              label: 'click',
              modifiers: ['shift'],
              icon: 'trackpad-click'
            }
          ]
        }
      ]
    });

    (root.querySelector('button[title="Keyboard shortcuts"]') as HTMLButtonElement).click();
    await Promise.resolve();

    const sections = Array.from(root.querySelectorAll('[data-shortcut-section]'));
    expect(sections.map(section => section.getAttribute('data-shortcut-section'))).toEqual([
      'Navigation',
      'Interaction',
      'Commands'
    ]);
    const navigationSection = sections[0];
    const interactionSection = sections[1];
    const commandSection = sections[2];
    expect(navigationSection?.textContent).toContain('Pan with the trackpad.');
    expect(interactionSection?.textContent).toContain('Select a span and open the span inspector.');
    expect(interactionSection?.textContent).toContain(
      'Select a span and hide non-dependent spans.'
    );
    expect(commandSection?.textContent).toContain('Show keyboard shortcuts');
    expect(root.querySelectorAll('svg[aria-label="Trackpad click"]')).toHaveLength(2);
    const descriptions = Array.from(
      interactionSection?.querySelectorAll('[data-shortcut-description="true"]') ?? []
    ).map(element => element.textContent);
    expect(descriptions).toEqual([
      'Select a span and open the span inspector.',
      'Select a span and hide non-dependent spans.'
    ]);

    cleanup();
  });
});
