import {afterEach, beforeEach, describe, expect, it} from 'vitest';

import {toastManager} from './toast-manager';
import {ToastPanelContainer} from './toast-panel-container';

function mountToastPanelContainer() {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const panelContainer = new ToastPanelContainer();
  panelContainer.onAdd();
  panelContainer.onRenderHTML(root);
  const cleanup = () => {
    panelContainer.onRemove();
    root.remove();
  };

  return {
    root,
    panelContainer,
    cleanup
  };
}

beforeEach(() => {
  toastManager.clear();
});

afterEach(() => {
  document.body.innerHTML = '';
  toastManager.clear();
});

describe('ToastPanelContainer', () => {
  it('renders existing toasts from the manager', () => {
    toastManager.toast({
      type: 'info',
      title: 'Loaded',
      message: 'Data loaded'
    });

    const {root, cleanup} = mountToastPanelContainer();

    expect(root.textContent).toContain('Loaded');
    expect(root.textContent).toContain('Data loaded');
    expect(root.querySelectorAll('[data-toast-id]').length).toBe(1);

    cleanup();
  });

  it('dismisses a toast when the close button is clicked', () => {
    const id = toastManager.toast({
      type: 'warning',
      title: 'Warning',
      message: 'Needs attention'
    });

    const {root, cleanup} = mountToastPanelContainer();

    const closeButton = root.querySelector<HTMLButtonElement>(`[data-toast-close="${id}"]`);
    expect(closeButton).toBeTruthy();
    closeButton?.click();

    expect(root.querySelector(`[data-toast-id="${id}"]`)).toBeNull();
    expect(toastManager.getToasts()).toHaveLength(0);

    cleanup();
  });

  it('unsubscribes from the manager on remove to avoid listener leaks', () => {
    const {root, panelContainer} = mountToastPanelContainer();
    toastManager.toast({type: 'error', message: 'Initial toast'});

    expect(root.querySelector('[data-toast-id]')).toBeTruthy();

    panelContainer.onRemove();

    expect(root.textContent).toBe('');
    toastManager.toast({type: 'info', message: 'Should not appear'});
    expect(root.textContent).toBe('');

    root.remove();
  });

  it('renders the toast host with visible, viewport-safe dimensions', () => {
    const {root, cleanup} = mountToastPanelContainer();

    toastManager.toast({type: 'info', message: 'Width-safe toast'});
    const stack = root.querySelector('.deck-widget-toast-stack');

    expect(stack).toBeTruthy();
    expect(root.getAttribute('style') || '').toContain('width: 360px');
    expect(root.getAttribute('style') || '').toContain('max-width: calc(-24px + 100vw)');
    expect(root.getAttribute('style') || '').toContain('pointer-events: auto');
    expect(root.getAttribute('style') || '').toContain('position: absolute');
    expect(root.getAttribute('style') || '').toContain('bottom: 0px');
    expect(root.getAttribute('style') || '').toContain('right: 0px');

    const card = root.querySelector('[data-toast-id]');
    expect(card?.getAttribute('style') || '').toContain('width: 100%');
    expect(card?.getAttribute('style') || '').toContain('min-width: 0');

    cleanup();
  });
});
