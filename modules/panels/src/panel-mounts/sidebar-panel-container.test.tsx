/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {SidebarPanelContainer} from './sidebar-panel-container';
import {Panel} from '../panels/panel';

import type {KeyboardShortcutEventManager} from '../lib/keyboard-shortcuts/keyboard-shortcuts-manager';

class TestPanel extends Panel {}

const panel = new TestPanel({
  id: 'settings',
  title: 'Settings',
  content: <div>settings content</div>
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

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SidebarPanelContainer', () => {
  it('starts open by default when uncontrolled', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-default-open',
      panel,
      side: 'right'
    });

    container.onRenderHTML(root);

    expect(root.textContent).toContain('settings content');
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('false');
    expect(root.querySelector('header')).toBeNull();
    expect(container.placement).toBe('top-right');
    expect(root.style.top).toBe('var(--widget-margin, 12px)');
    expect(root.style.bottom).toBe('var(--widget-margin, 12px)');
    expect(root.style.left).toBe('var(--widget-margin, 12px)');
    expect(root.style.right).toBe('-1px');
    expect(root.style.width).toBe('auto');
    expect(root.style.height).toBe('auto');
  });

  it('renders the configured trigger icon and opens from the trigger', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-trigger',
      panel,
      button: true,
      triggerIcon: 'icon',
      defaultOpen: false
    });

    container.onRenderHTML(root);

    const triggerButton = root.querySelector<HTMLButtonElement>('[data-sidebar-handle-button]');
    expect(triggerButton?.textContent).toContain('icon');
    triggerButton?.click();
    await Promise.resolve();
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('false');
  });

  it('closes when Escape is pressed', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-escape',
      panel,
      defaultOpen: true
    });

    container.onRenderHTML(root);
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));

    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('respects controlled closed state even though defaultOpen is true', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-controlled-closed',
      panel,
      open: false,
      title: 'Visualization settings',
      side: 'right'
    });

    container.onRenderHTML(root);

    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('top-aligns the sidebar handle with the panel shell', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-top-aligned-handle',
      panel,
      button: true,
      triggerIcon: 'icon',
      title: 'Visualization settings',
      side: 'right'
    });

    container.onRenderHTML(root);

    const shell = root.querySelector<HTMLDivElement>('[data-sidebar-shell]');
    const handle = root.querySelector<HTMLDivElement>('[data-sidebar-handle]');
    const handleButton = root.querySelector<HTMLButtonElement>('[data-sidebar-handle-button]');
    expect(shell?.style.alignItems).toBe('flex-start');
    expect(shell?.style.position).toBe('absolute');
    expect(shell?.style.pointerEvents).toBe('auto');
    expect(handle?.style.alignItems).toBe('flex-start');
    expect(shell?.style.gap).toBe('8px');
    expect(handleButton?.style.width).toBe('36px');
    expect(handleButton?.textContent).toContain('icon');
  });

  it('reparents the sidebar root into the full component container by default', () => {
    const overlayRoot = document.createElement('div');
    const placementRoot = document.createElement('div');
    const componentRoot = document.createElement('div');
    overlayRoot.appendChild(placementRoot);
    placementRoot.appendChild(componentRoot);
    document.body.appendChild(overlayRoot);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-overlay-parent',
      panel
    });

    container.onRenderHTML(componentRoot);

    expect(componentRoot.parentElement).toBe(overlayRoot);
    expect(componentRoot.style.zIndex).toBe('2100');
  });

  it('keeps the same overlay parent after open state updates', () => {
    const overlayRoot = document.createElement('div');
    const placementRoot = document.createElement('div');
    const componentRoot = document.createElement('div');
    overlayRoot.appendChild(placementRoot);
    placementRoot.appendChild(componentRoot);
    document.body.appendChild(overlayRoot);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-stable-overlay-parent',
      panel,
      open: false
    });

    container.onRenderHTML(componentRoot);
    expect(componentRoot.parentElement).toBe(overlayRoot);

    container.setProps({open: true});
    expect(componentRoot.parentElement).toBe(overlayRoot);
  });

  it('keeps the same shell mounted and only updates transform when open changes', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-animated-shell',
      panel,
      button: true,
      open: false,
      side: 'right'
    });

    container.onRenderHTML(root);
    const closedShell = root.querySelector<HTMLDivElement>('[data-sidebar-shell]');
    expect(closedShell?.style.transform).toBe('translateX(360px)');
    expect(closedShell?.style.transition).toContain('transform 320ms');

    container.setProps({open: true});
    const openShell = root.querySelector<HTMLDivElement>('[data-sidebar-shell]');
    expect(openShell).toBe(closedShell);
    expect(openShell?.style.transform).toBe('translateX(0px)');
    expect(openShell?.style.transition).toContain('transform 320ms');
  });

  it('stops mouse move events from leaking past the sidebar shell', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-stop-mousemove',
      panel,
      open: true,
      side: 'right'
    });
    let bodyMouseMoveCount = 0;
    document.body.addEventListener('mousemove', () => {
      bodyMouseMoveCount += 1;
    });

    container.onRenderHTML(root);
    root
      .querySelector<HTMLDivElement>('[data-sidebar-shell]')
      ?.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));

    expect(bodyMouseMoveCount).toBe(0);
  });

  it('opens from configured keyboard shortcuts and cleans up listeners', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const eventManager = new FakeEventManager();
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-shortcuts',
      panel,
      defaultOpen: false,
      openShortcuts: [
        {
          key: '/',
          commandKey: true,
          name: 'Show Settings',
          description: 'Show settings.'
        }
      ]
    });
    container.deck = {eventManager};

    container.onRenderHTML(root);
    container.onAdd({deck: container.deck, viewId: null});
    eventManager.emit('keydown', commandKeyEvent('/'));

    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('false');
    container.onRemove();
    expect(eventManager.handlers.has('keydown')).toBe(false);
  });

  it('restores keyboard focus to the deck canvas after closing', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const canvas = document.createElement('canvas');
    canvas.tabIndex = -1;
    document.body.appendChild(canvas);
    const container = new SidebarPanelContainer({
      id: 'settings-sidebar-focus',
      panel,
      open: true,
      showBackdrop: true
    });
    container.deck = {canvas};

    container.onRenderHTML(root);
    root.querySelector<HTMLButtonElement>('button[aria-label="Close Open sidebar"]')?.click();
    await Promise.resolve();

    expect(canvas.tabIndex).toBe(0);
    expect(document.activeElement).toBe(canvas);
  });
});
