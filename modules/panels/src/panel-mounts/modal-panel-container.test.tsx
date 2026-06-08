/** @jsxImportSource preact */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {ModalPanelContainer} from './modal-panel-container';
import {TabbedPanel} from '../composite-panels/tabbed-panel';
import {Panel} from '../panels/panel';

import type {KeyboardShortcutEventManager} from '../lib/keyboard-shortcuts/keyboard-shortcuts-manager';
import type {ModalPanelContainerProps} from './modal-panel-container';

class TestPanel extends Panel {}

const panel = new TestPanel({
  id: 'help',
  title: 'Help',
  content: <div>help content</div>
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

function renderModal(props: Partial<ModalPanelContainerProps> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const modal = new ModalPanelContainer({
    panel,
    defaultOpen: true,
    ...props
  });
  modal.onRenderHTML(root);
  return {
    root,
    modal,
    cleanup() {
      modal.onRemove();
      root.remove();
    }
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ModalPanelContainer', () => {
  it('supports left dialog placement and caller-provided dialog/content styles', () => {
    const {root, cleanup} = renderModal({
      button: true,
      dialogPlacement: 'left',
      dialogStyle: {width: '400px'},
      contentStyle: {padding: '0px'}
    });

    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    const wrapper = dialog?.parentElement as HTMLElement;
    const content = dialog?.lastElementChild as HTMLElement;

    expect(wrapper.style.justifyContent).toBe('flex-start');
    expect(wrapper.style.padding).toBe('24px');
    expect(dialog?.style.width).toBe('400px');
    expect(content.style.padding).toBe('0px');

    cleanup();
  });

  it('hides built-in close chrome and lets panel content close the modal', () => {
    const contentPanel = new TestPanel({
      id: 'closer',
      title: 'Closer',
      content: (
        <button type="button" data-modal-panel-container-close="true">
          close from content
        </button>
      )
    });
    const onOpenChange = vi.fn();
    const {root, cleanup} = renderModal({
      panel: contentPanel,
      hideCloseButton: true,
      onOpenChange
    });

    expect(root.querySelector('[aria-label="Close"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-modal-panel-container-close="true"]')?.click();

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(root.textContent).not.toContain('close from content');

    cleanup();
  });

  it('marks the trigger active while the modal is open', () => {
    const {root, cleanup} = renderModal({button: true});

    const trigger = root.querySelector<HTMLButtonElement>('.deck-widget-icon-button');
    expect(trigger?.className).toContain('deck-widget-button-active');

    cleanup();
  });

  it('renders the configured trigger icon and hides the trigger when button is false', () => {
    const visibleModal = renderModal({
      button: true,
      defaultOpen: false,
      triggerIcon: 'icon'
    });
    expect(visibleModal.root.querySelector('.deck-widget-icon-button')?.textContent).toContain(
      'icon'
    );
    visibleModal.cleanup();

    const hiddenModal = renderModal({button: false});
    expect(hiddenModal.root.querySelector('.deck-widget-icon-button')).toBeNull();
    hiddenModal.cleanup();
  });

  it('closes when Escape is pressed', () => {
    const {root, cleanup} = renderModal({button: true});

    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));

    expect(root.textContent).not.toContain('help content');
    expect(root.querySelector('[aria-label="Close"]')).toBeNull();
    cleanup();
  });

  it('renders a visible tab row for a tabbed panel', () => {
    const {root, cleanup} = renderModal({
      panel: new TabbedPanel({
        id: 'help-tabs-panel',
        title: 'Help',
        panels: [
          new TestPanel({id: 'first', title: 'First', content: <div>first content</div>}),
          new TestPanel({id: 'second', title: 'Second', content: <div>second content</div>})
        ]
      }),
      title: 'Help'
    });

    const tabRow = root.querySelector<HTMLDivElement>('[data-panel-tabs]');
    expect(tabRow?.textContent).toContain('First');
    expect(tabRow?.textContent).toContain('Second');
    cleanup();
  });

  it('raises its placement container above sibling components while open', () => {
    const placementContainer = document.createElement('div');
    placementContainer.style.zIndex = '2';
    const root = document.createElement('div');
    placementContainer.appendChild(root);
    document.body.appendChild(placementContainer);
    const modal = new ModalPanelContainer({
      id: 'help-stacking',
      panel,
      defaultOpen: true,
      button: true
    });

    modal.onRenderHTML(root);
    expect(placementContainer.style.zIndex).toBe('2100');

    modal.setProps({open: false});
    expect(placementContainer.style.zIndex).toBe('2');
    modal.onRemove();
  });

  it('opens from configured keyboard shortcuts and cleans up listeners', () => {
    const {root, modal} = renderModal({
      defaultOpen: false,
      openShortcuts: [
        {
          key: '/',
          commandKey: true,
          name: 'Show Help',
          description: 'Show help.'
        }
      ]
    });
    const eventManager = new FakeEventManager();
    modal.deck = {eventManager};

    modal.onAdd({deck: modal.deck, viewId: null});
    eventManager.emit('keydown', commandKeyEvent('/'));

    expect(root.textContent).toContain('help content');
    modal.onRemove();
    expect(eventManager.handlers.has('keydown')).toBe(false);
    root.remove();
  });

  it('restores keyboard focus to the deck canvas after closing', async () => {
    const {root, modal, cleanup} = renderModal();
    const canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    document.body.appendChild(canvas);
    modal.deck = {canvas};

    root.querySelector<HTMLButtonElement>('button[style]')?.click();
    await Promise.resolve();

    expect(canvas.tabIndex).toBe(0);
    expect(document.activeElement).toBe(canvas);
    cleanup();
  });

  it('registers non-modal shortcuts without overriding their handlers', () => {
    const onKeyPress = vi.fn();
    const {root, modal, cleanup} = renderModal({
      defaultOpen: false,
      shortcuts: [
        {
          key: 'a',
          name: 'Pan left',
          description: 'Pan left.',
          onKeyPress
        }
      ]
    });
    const eventManager = new FakeEventManager();
    modal.deck = {eventManager};

    modal.onAdd({deck: modal.deck, viewId: null});
    eventManager.emit('keydown', new KeyboardEvent('keydown', {key: 'a'}));

    expect(onKeyPress).toHaveBeenCalledOnce();
    expect(root.textContent).not.toContain('help content');
    cleanup();
  });

  it('can drag the dialog from the title bar', async () => {
    const {root, cleanup} = renderModal({
      draggable: true
    });

    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    const header = root.querySelector<HTMLElement>('[data-modal-panel-container-header="true"]');
    header?.dispatchEvent(
      new MouseEvent('pointerdown', {bubbles: true, button: 0, clientX: 10, clientY: 20})
    );
    document.dispatchEvent(new MouseEvent('pointermove', {clientX: 20, clientY: 45}));
    await Promise.resolve();

    expect(dialog?.parentElement?.style.transform).toBe('translate(10px, 25px)');

    document.dispatchEvent(new MouseEvent('pointerup'));
    cleanup();
  });
});
