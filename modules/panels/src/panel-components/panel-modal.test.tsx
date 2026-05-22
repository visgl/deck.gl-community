/** @jsxImportSource preact */
import {afterEach, describe, expect, it, vi} from 'vitest';

import {PanelModal} from './panel-modal';

import type {Panel} from '../panels/panel-types';
import type {PanelModalProps} from './panel-modal';

const panel: Panel = {
  id: 'help',
  title: 'Help',
  content: <div>help content</div>
};

function renderModal(props: Partial<PanelModalProps> = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const modal = new PanelModal({
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

describe('PanelModal', () => {
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
    const contentPanel: Panel = {
      id: 'closer',
      title: 'Closer',
      content: (
        <button type="button" data-modal-widget-close="true">
          close from content
        </button>
      )
    };
    const onOpenChange = vi.fn();
    const {root, cleanup} = renderModal({
      panel: contentPanel,
      hideCloseButton: true,
      onOpenChange
    });

    expect(root.querySelector('[aria-label="Close"]')).toBeNull();
    root.querySelector<HTMLButtonElement>('[data-modal-widget-close="true"]')?.click();

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

  it('can drag the dialog from the title bar', async () => {
    const {root, cleanup} = renderModal({
      draggable: true
    });

    const dialog = root.querySelector<HTMLElement>('[role="dialog"]');
    const header = root.querySelector<HTMLElement>('[data-modal-widget-header="true"]');
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
