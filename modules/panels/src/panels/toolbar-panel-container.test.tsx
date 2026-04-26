import {afterEach, describe, expect, it, vi} from 'vitest';

import {ToolbarPanelContainer} from './toolbar-panel-container';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ToolbarPanelContainer', () => {
  it('fires action callbacks when action buttons are clicked', () => {
    const root = document.createElement('div');
    const onClick = vi.fn();
    document.body.appendChild(root);
    const panelContainer = new ToolbarPanelContainer({
      id: 'toolbar-actions',
      items: [
        {
          kind: 'action',
          id: 'reset',
          label: 'Reset',
          onClick
        }
      ]
    });

    panelContainer.onRenderHTML(root);

    root.querySelector<HTMLButtonElement>('[data-toolbar-item-id="reset"]')?.click();

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('fires toggle selection callbacks and reflects selected state', () => {
    const root = document.createElement('div');
    const onSelect = vi.fn();
    document.body.appendChild(root);
    const panelContainer = new ToolbarPanelContainer({
      id: 'toolbar-toggle',
      items: [
        {
          kind: 'toggle-group',
          id: 'boolean-op',
          selectedId: 'union',
          onSelect,
          options: [
            {id: 'union', label: 'Union'},
            {id: 'difference', label: 'Difference'}
          ]
        }
      ]
    });

    panelContainer.onRenderHTML(root);

    const unionButton = root.querySelector<HTMLButtonElement>('[data-toolbar-option-id="union"]');
    const differenceButton = root.querySelector<HTMLButtonElement>(
      '[data-toolbar-option-id="difference"]'
    );

    expect(unionButton?.getAttribute('aria-pressed')).toBe('true');
    expect(differenceButton?.getAttribute('aria-pressed')).toBe('false');

    differenceButton?.click();

    expect(onSelect).toHaveBeenCalledWith('difference');
  });

  it('respects disabled state for actions and toggle groups', () => {
    const root = document.createElement('div');
    const onClick = vi.fn();
    const onSelect = vi.fn();
    document.body.appendChild(root);
    const panelContainer = new ToolbarPanelContainer({
      id: 'toolbar-disabled',
      items: [
        {
          kind: 'action',
          id: 'disabled-action',
          label: 'Disabled action',
          disabled: true,
          onClick
        },
        {
          kind: 'toggle-group',
          id: 'disabled-group',
          disabled: true,
          onSelect,
          options: [{id: 'one', label: 'One'}]
        }
      ]
    });

    panelContainer.onRenderHTML(root);

    const actionButton = root.querySelector<HTMLButtonElement>(
      '[data-toolbar-item-id="disabled-action"]'
    );
    const toggleButton = root.querySelector<HTMLButtonElement>('[data-toolbar-option-id="one"]');

    expect(actionButton?.disabled).toBe(true);
    expect(toggleButton?.disabled).toBe(true);

    actionButton?.click();
    toggleButton?.click();

    expect(onClick).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders badges as read-only status items', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const panelContainer = new ToolbarPanelContainer({
      id: 'toolbar-badge',
      items: [
        {
          kind: 'badge',
          id: 'status',
          label: '3 clusters'
        }
      ]
    });

    panelContainer.onRenderHTML(root);

    const badge = root.querySelector<HTMLElement>('[data-toolbar-item-kind="badge"]');
    expect(badge?.textContent).toContain('3 clusters');
  });
});
