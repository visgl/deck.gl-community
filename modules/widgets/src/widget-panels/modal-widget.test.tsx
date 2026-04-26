/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {ModalPanelWidget} from './modal-widget';
import {TabbedPanel} from './widget-containers';

import type {WidgetPanel} from './widget-containers';

const panel: WidgetPanel = {
  id: 'help',
  title: 'Help',
  content: <div>help content</div>
};

afterEach(() => {
  document.body.innerHTML = '';
});

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

    const triggerButton = root.querySelector<HTMLButtonElement>('.deck-panel-icon-button');
    expect(triggerButton).toBeTruthy();
    const triggerWrapper = triggerButton?.parentElement;
    expect(triggerWrapper?.className).toContain('deck-panel-button');
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
    expect(placementContainer.style.zIndex).toBe('40');

    widget.setProps({open: false});
    expect(placementContainer.style.zIndex).toBe('2');
  });
});
