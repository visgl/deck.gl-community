import {afterEach, describe, expect, it} from 'vitest';

import {KeyboardShortcutsWidget} from './keyboard-shortcuts-widget';

import type {KeyboardShortcut} from '../keyboard-shortcuts/keyboard-shortcuts';

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

/**
 * Renders a keyboard shortcuts widget into a detached DOM node for interaction tests.
 */
function renderWidget(options?: {
  eventManager?: FakeEventManager;
  installShortcuts?: boolean;
  keyboardShortcuts?: KeyboardShortcut[];
}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const widget = new KeyboardShortcutsWidget({
    installShortcuts: options?.installShortcuts,
    keyboardShortcuts: options?.keyboardShortcuts ?? []
  });

  if (options?.eventManager) {
    Reflect.set(widget, 'deck', {eventManager: options.eventManager});
  }

  widget.onRenderHTML(root);
  widget.onAdd();

  const cleanup = () => {
    widget.onRemove();
    root.remove();
  };

  return {
    root,
    widget,
    cleanup
  };
}

function clickButton(button: HTMLButtonElement | null): void {
  expect(button).toBeTruthy();
  button?.dispatchEvent(new MouseEvent('click', {bubbles: true}));
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
          badges: ['Perfetto'],
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
          badges: ['Perfetto'],
          displayPair: {
            id: 'pan-horizontal',
            position: 'secondary',
            description: 'Pan horizontally.'
          }
        },
        {
          key: 'g',
          name: 'Jump',
          description: 'Move to the selected block.'
        }
      ]
    });

    clickButton(root.querySelector<HTMLButtonElement>('button[title="Keyboard shortcuts"]'));
    await Promise.resolve();

    const descriptions = Array.from(
      root.querySelectorAll('[data-shortcut-description="true"]')
    ).map((element) => element.textContent);

    expect(descriptions).toContain('Show keyboard shortcuts');
    expect(descriptions).toContain('Pan horizontally.');
    expect(descriptions).toContain('Move to the selected block.');
    expect(descriptions).not.toContain('Jump');
    expect(root.querySelectorAll('[data-shortcut-row-kind="pair"]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-shortcut-row-kind="single"]')).toHaveLength(2);
    expect(root.textContent).toContain('Perfetto');
    expect(root.textContent?.match(/Perfetto/g)).toHaveLength(1);

    const shortcutRow = root.querySelector('[data-shortcut-row-kind="pair"]')?.parentElement;
    const shortcutDescription = root.querySelector<HTMLSpanElement>(
      '[data-shortcut-description="true"]'
    );
    const shortcutBadges = root.querySelector<HTMLSpanElement>('[data-shortcut-badges="true"]');
    expect(shortcutRow?.style.gridTemplateColumns).toBe('minmax(104px, 148px) minmax(0, 1fr) auto');
    expect(shortcutDescription?.style.width).toBe('100%');
    expect(shortcutBadges?.style.justifySelf).toBe('end');

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
          description: 'Move to the selected block.'
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

    clickButton(root.querySelector<HTMLButtonElement>('button[title="Keyboard shortcuts"]'));
    await Promise.resolve();

    expect(root.querySelectorAll('[data-shortcut-row-kind="pair"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-shortcut-row-kind="single"]')).toHaveLength(4);
    expect(root.textContent).not.toContain('Pan horizontally.');

    cleanup();
  });

  it('opens the shortcuts dialog from both default keyboard bindings', async () => {
    const eventManager = new FakeEventManager();
    const {root, cleanup} = renderWidget({
      eventManager,
      installShortcuts: true
    });

    eventManager.emit('keydown', new KeyboardEvent('keydown', {key: '/', ctrlKey: true}));
    await Promise.resolve();
    expect(root.querySelector('[role="dialog"]')).toBeTruthy();

    cleanup();
  });
});
