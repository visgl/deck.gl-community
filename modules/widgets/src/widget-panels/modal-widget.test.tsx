/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {ModalWidget} from './modal-widget';
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

describe('ModalWidget', () => {
  it('shows a built-in trigger when button is enabled', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const widget = new ModalWidget({
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
    const widget = new ModalWidget({
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
    const widget = new ModalWidget({
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
    const widget = new ModalWidget({
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

    const tabRow = root.querySelector<HTMLDivElement>('[data-widget-tabs]');
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

    const widget = new ModalWidget({
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
