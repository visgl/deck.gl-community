/** @jsxImportSource preact */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {ModalPanelWidget} from './modal-widget';
import {TabbedPanel} from './widget-containers';

import type {WidgetPanel} from './widget-containers';
import type {KeyboardShortcutEventManager} from '@deck.gl-community/panels';

const panel: WidgetPanel = {
  id: 'help',
  title: 'Help',
  content: <div>help content</div>
};

afterEach(() => {
  document.body.innerHTML = '';
});

type Handler = (event: {srcEvent: KeyboardEvent}) => void;

class FakeEventManager implements KeyboardShortcutEventManager {
  handlers = new Map<string, Handler>();

  on(event: 'keydown', handler: Handler) {
    this.handlers.set(event, handler);
  }

  off(event: 'keydown', handler: Handler) {
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

const isMac = globalThis.navigator.platform.toUpperCase().includes('MAC');

function commandKeyEvent(key: string): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: !isMac,
    metaKey: isMac
  });
}

describe('ModalPanelWidget', () => {
  it('shows a built-in trigger when button is enabled', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new ModalPanelWidget({
      id: 'help',
      panel,
      button: true,
      icon: 'icon'
    });

    widget.onRenderHTML(root);

    const triggerButton = root.querySelector<HTMLButtonElement>('.deck-widget-icon-button');
    expect(triggerButton).toBeTruthy();
    const triggerWrapper = triggerButton?.parentElement;
    expect(triggerWrapper?.className).toContain('deck-widget-button');
  });

  it('hides the built-in trigger when button is disabled', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new ModalPanelWidget({
      id: 'help-hidden-button',
      panel,
      button: false
    });

    widget.onRenderHTML(root);

    expect(root.querySelector('button')).toBeNull();
  });

  it('closes the modal when Escape is pressed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new ModalPanelWidget({
      id: 'help-escape',
      panel,
      defaultOpen: true,
      button: true
    });

    widget.onRenderHTML(root);

    expect(root.textContent).toContain('help content');

    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));

    expect(root.textContent).not.toContain('help content');
    expect(root.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('renders a visible tab row when given a tabbed widget panel', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new ModalPanelWidget({
      id: 'help-tabs',
      defaultOpen: true,
      panel: new TabbedPanel({
        id: 'help-tabs-panel',
        panels: {
          first: {
            id: 'first',
            title: 'First',
            content: <div>first content</div>
          },
          second: {
            id: 'second',
            title: 'Second',
            content: <div>second content</div>
          }
        }
      }),
      title: 'Help'
    });

    widget.onRenderHTML(root);

    const tabRow = root.querySelector<HTMLDivElement>('[data-panel-tabs]');
    expect(tabRow).toBeTruthy();
    expect(tabRow?.textContent).toContain('First');
    expect(tabRow?.textContent).toContain('Second');
  });

  it('raises its placement container above sibling widgets while open', () => {
    const placementContainer = document.createElement('div');
    placementContainer.style.zIndex = '2';
    const root = document.createElement('div');
    placementContainer.appendChild(root);
    document.body.appendChild(placementContainer);

    const widget = new ModalPanelWidget({
      id: 'help-stacking',
      panel,
      defaultOpen: true,
      button: true
    });

    widget.onRenderHTML(root);
    expect(placementContainer.style.zIndex).toBe('2100');

    widget.setProps({open: false});
    expect(placementContainer.style.zIndex).toBe('2');
  });

  it('opens from configured keyboard shortcuts and cleans up listeners', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const eventManager = new FakeEventManager();
    const widget = new ModalPanelWidget({
      id: 'help-shortcuts',
      panel,
      openShortcuts: [
        {
          key: '/',
          commandKey: true,
          name: 'Show Help',
          description: 'Show help.'
        }
      ]
    });
    (widget as {deck?: {eventManager: FakeEventManager}}).deck = {eventManager};

    widget.onRenderHTML(root);
    widget.onAdd({deck: (widget as {deck: unknown}).deck, viewId: null});
    eventManager.emit('keydown', commandKeyEvent('/'));

    expect(root.textContent).toContain('help content');
    widget.onRemove();
    expect(eventManager.handlers.has('keydown')).toBe(false);
  });

  it('restores keyboard focus to the deck canvas after closing', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    document.body.appendChild(canvas);
    const widget = new ModalPanelWidget({
      id: 'help-focus',
      panel,
      defaultOpen: true
    });
    (widget as {deck?: {canvas: HTMLCanvasElement}}).deck = {canvas};

    widget.onRenderHTML(root);
    const backdrop = root.querySelector<HTMLButtonElement>('button[style]');
    backdrop?.click();
    await Promise.resolve();

    expect(canvas.tabIndex).toBe(0);
    expect(document.activeElement).toBe(canvas);
  });

  it('registers non-modal shortcuts without overriding their handlers', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const eventManager = new FakeEventManager();
    const onKeyPress = vi.fn();
    const widget = new ModalPanelWidget({
      id: 'help-non-modal-shortcuts',
      panel,
      shortcuts: [
        {
          key: 'a',
          name: 'Pan left',
          description: 'Pan left.',
          onKeyPress
        }
      ]
    });
    (widget as {deck?: {eventManager: FakeEventManager}}).deck = {eventManager};

    widget.onRenderHTML(root);
    widget.onAdd({deck: (widget as {deck: unknown}).deck, viewId: null});
    eventManager.emit('keydown', new KeyboardEvent('keydown', {key: 'a'}));

    expect(onKeyPress).toHaveBeenCalledOnce();
    expect(root.textContent).not.toContain('help content');
  });
});
