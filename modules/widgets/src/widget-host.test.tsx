/** @jsxImportSource preact */
import {afterEach, describe, expect, it} from 'vitest';

import {BoxWidget} from './widget-panels/box-widget';
import {MarkdownPanel, TabbedPanel} from './widget-panels/widget-containers';
import {ModalWidget} from './widget-panels/modal-widget';
import {SidebarWidget} from './widget-panels/sidebar-widget';
import {ToolbarWidget} from './widget-panels/toolbar-widget';
import {WidgetHost} from './widget-host';

afterEach(() => {
  document.body.innerHTML = '';
});

function createHostRoot() {
  const root = document.createElement('div');
  root.style.position = 'relative';
  root.style.width = '960px';
  root.style.height = '640px';
  document.body.appendChild(root);
  return root;
}

describe('WidgetHost', () => {
  it('mounts DOM widgets without a Deck instance', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});

    host.setProps({
      widgets: [
        new BoxWidget({
          id: 'box',
          placement: 'top-left',
          title: 'Summary',
          panel: new MarkdownPanel({
            id: 'box-panel',
            title: 'Summary',
            markdown: 'Standalone box content'
          }),
          collapsible: false,
          open: true
        }),
        new SidebarWidget({
          id: 'sidebar',
          panel: new MarkdownPanel({
            id: 'sidebar-panel',
            title: 'Sidebar',
            markdown: 'Standalone sidebar content'
          }),
          title: 'Sidebar',
          open: true,
          button: true
        }),
        new ModalWidget({
          id: 'modal',
          title: 'Modal',
          defaultOpen: true,
          button: true,
          panel: new TabbedPanel({
            id: 'modal-tabs',
            panels: {
              first: new MarkdownPanel({
                id: 'modal-first',
                title: 'First',
                markdown: 'First tab'
              }),
              second: new MarkdownPanel({
                id: 'modal-second',
                title: 'Second',
                markdown: 'Second tab'
              })
            }
          })
        }),
        new ToolbarWidget({
          id: 'toolbar',
          items: [{kind: 'action', id: 'save', label: 'Save'}]
        })
      ]
    });

    expect(root.classList.contains('deck-widget-container')).toBe(true);
    expect(root.querySelector('.deck-widget-box')?.textContent).toContain('Standalone box content');
    expect(root.querySelector('.deck-widget-sidebar')?.textContent).toContain(
      'Standalone sidebar content'
    );
    expect(root.querySelector('.deck-widget-modal')?.textContent).toContain('First tab');
    expect(root.querySelector('.deck-widget-toolbar')?.textContent).toContain('Save');
    expect(root.querySelector('.top-left')).toBeTruthy();
    expect(root.querySelector('.top-right')).toBeTruthy();
  });

  it('reconciles widgets by id and updates an existing mounted instance', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});
    const initialWidget = new BoxWidget({
      id: 'box',
      title: 'Summary',
      panel: new MarkdownPanel({
        id: 'first-panel',
        title: 'First',
        markdown: 'First content'
      }),
      collapsible: false,
      open: true
    });

    host.setProps({widgets: [initialWidget]});

    const updatedWidget = new BoxWidget({
      id: 'box',
      title: 'Summary',
      panel: new MarkdownPanel({
        id: 'second-panel',
        title: 'Second',
        markdown: 'Updated content'
      }),
      collapsible: false,
      open: true
    });

    host.setProps({widgets: [updatedWidget]});

    expect(host.getWidgets()[0]).toBe(initialWidget);
    expect(root.textContent).toContain('Updated content');
    expect(root.querySelectorAll('.deck-widget-box')).toHaveLength(1);
  });

  it('honors an explicit HTMLElement container override', () => {
    const root = createHostRoot();
    const explicitContainer = document.createElement('div');
    root.appendChild(explicitContainer);

    const host = new WidgetHost({parentElement: root});
    host.setProps({
      widgets: [
        new ToolbarWidget({
          id: 'toolbar',
          _container: explicitContainer,
          items: [{kind: 'action', id: 'custom', label: 'Explicit'}]
        })
      ]
    });

    expect(explicitContainer.querySelector('.deck-widget-toolbar')?.textContent).toContain(
      'Explicit'
    );
    expect(root.querySelector('.top-right .deck-widget-toolbar')).toBeNull();
  });

  it('finalizes widgets and removes internal placement containers', () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});

    host.setProps({
      widgets: [
        new BoxWidget({
          id: 'box',
          panel: new MarkdownPanel({
            id: 'panel',
            title: 'Panel',
            markdown: 'Content'
          }),
          collapsible: false,
          open: true
        })
      ]
    });

    expect(root.querySelector('.bottom-left')).toBeTruthy();

    host.finalize();

    expect(root.classList.contains('deck-widget-container')).toBe(false);
    expect(root.querySelector('.deck-widget-box')).toBeNull();
    expect(root.querySelector('.bottom-left')).toBeNull();
  });

  it('supports interactive updates in standalone mode', async () => {
    const root = createHostRoot();
    const host = new WidgetHost({parentElement: root});
    const state = {
      accent: 'Ocean',
      sidebarOpen: false
    };

    const boxWidget = new BoxWidget({
      id: 'box',
      placement: 'top-left',
      title: 'Summary',
      panel: new MarkdownPanel({
        id: 'summary',
        title: 'Summary',
        markdown: `Accent: ${state.accent}`
      }),
      collapsible: false,
      open: true
    });

    const sidebarWidget = new SidebarWidget({
      id: 'sidebar',
      title: 'Controls',
      button: true,
      open: state.sidebarOpen,
      panel: new MarkdownPanel({
        id: 'sidebar-panel',
        title: 'Controls',
        markdown: `Sidebar accent: ${state.accent}`
      })
    });

    const syncWidgets = () => {
      boxWidget.setProps({
        panel: new MarkdownPanel({
          id: 'summary',
          title: 'Summary',
          markdown: `Accent: ${state.accent}`
        })
      });
      sidebarWidget.setProps({
        open: state.sidebarOpen,
        panel: new MarkdownPanel({
          id: 'sidebar-panel',
          title: 'Controls',
          markdown: `Sidebar accent: ${state.accent}`
        })
      });
    };

    const toolbarWidget = new ToolbarWidget({
      id: 'toolbar',
      items: [
        {
          kind: 'action',
          id: 'accent',
          label: 'Accent',
          onClick: () => {
            state.accent = 'Sunset';
            syncWidgets();
          }
        },
        {
          kind: 'action',
          id: 'sidebar-toggle',
          label: 'Sidebar',
          onClick: () => {
            state.sidebarOpen = !state.sidebarOpen;
            syncWidgets();
          }
        }
      ]
    });

    host.setProps({widgets: [boxWidget, sidebarWidget, toolbarWidget]});

    const actionButtons = root.querySelectorAll<HTMLButtonElement>(
      '.deck-widget-toolbar [data-toolbar-item-kind="action"]'
    );

    actionButtons[0].click();
    await Promise.resolve();
    expect(root.textContent).toContain('Accent: Sunset');

    actionButtons[1].click();
    await Promise.resolve();
    expect(root.textContent).toContain('Sidebar accent: Sunset');
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-hidden')).toBe('false');
  });
});
