import {act} from 'preact/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {OmniBoxWidget} from './omni-box-widget';

import type {OmniBoxWidgetProps} from './omni-box-widget';

function renderWidget(props: OmniBoxWidgetProps = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const widget = new OmniBoxWidget({
    defaultOpen: true,
    getOptions: () => [
      {
        id: 'alpha',
        label: 'Alpha item',
        description: 'First result'
      }
    ],
    ...props
  });

  widget.onRenderHTML(root);

  return {
    root,
    widget,
    cleanup() {
      widget.onRemove();
      root.remove();
    }
  };
}

afterEach(() => {
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('OmniBoxWidget', () => {
  it('uses deck widget theme CSS variables for the control row and dropdown', async () => {
    const {root, cleanup} = renderWidget();

    const styles = root.querySelector('style');
    expect(styles?.textContent).toContain('--omni-box-row-background');
    expect(styles?.textContent).toContain('var(--button-icon-hover');
    expect(styles?.textContent).toContain('var(--button-icon-idle');
    expect(styles?.textContent).toContain('--omni-box-surface-background');
    expect(styles?.textContent).toContain('var(--menu-background');
    expect(styles?.textContent).toContain('var(--menu-backdrop-filter');
    expect(styles?.textContent).toContain('var(--menu-shadow');
    expect(styles?.textContent).toContain('var(--menu-item-hover');

    const controls = root.querySelector('[data-omni-box-controls="true"]') as HTMLDivElement;
    expect(controls.getAttribute('style') || '').toContain('var(--button-shadow');

    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    expect(input.getAttribute('style') || '').toContain('var(--button-backdrop-filter');
    expect(input.getAttribute('style') || '').toContain('var(--button-inner-stroke');

    cleanup();
  });

  it('keeps a slash shortcut button at the start of the expanded control row', async () => {
    const {root, cleanup} = renderWidget({
      defaultOpen: true,
      placeholder: 'type to search'
    });
    await act(async () => {});

    const controls = root.querySelector('[data-omni-box-controls="true"]') as HTMLDivElement;
    const expandedShortcut = root.querySelector(
      'button[aria-label="Close Search"]'
    ) as HTMLButtonElement | null;
    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;

    expect(expandedShortcut).not.toBeNull();
    const expandedShortcutButton = expandedShortcut as HTMLButtonElement;
    expect(expandedShortcutButton.textContent).toBe('/');
    expect(expandedShortcutButton.getAttribute('title')).toBe('Close Search');
    expect(input.getAttribute('placeholder')).toBe('type to search');
    expect(controls.contains(expandedShortcutButton)).toBe(true);
    expect(
      expandedShortcutButton.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    cleanup();
  });

  it('can render a slash anchor button while the input is closed', () => {
    const {root, cleanup} = renderWidget({
      defaultOpen: false,
      showAnchorButton: true
    });

    expect(root.style.pointerEvents).toBe('none');
    expect((root.firstElementChild as HTMLElement | null)?.style.pointerEvents).toBe('none');
    expect(root.querySelector('[data-omni-box-controls="true"]')).toBeNull();

    const anchor = root.querySelector('[data-omni-box-anchor="true"]') as HTMLDivElement;
    expect(anchor).not.toBeNull();
    expect(anchor.style.pointerEvents).toBe('auto');

    const anchorButton = root.querySelector(
      'button[aria-label="Open Search"]'
    ) as HTMLButtonElement;
    expect(anchorButton.textContent).toBe('/');
    expect(anchorButton.getAttribute('title')).toBe('Open Search');
    expect(root.querySelector('input[aria-label="OmniBox"]')).toBeNull();

    cleanup();
  });

  it('can keep results open after selecting an option', async () => {
    const onSelectOption = vi.fn();
    const {root, cleanup} = renderWidget({
      closeOnSelect: false,
      minQueryLength: 0,
      getOptions: () => [
        {
          id: 'alpha',
          label: 'Alpha item',
          description: 'First result'
        },
        {
          id: 'beta',
          label: 'Beta item',
          description: 'Second result'
        }
      ],
      onSelectOption
    });

    await act(async () => {});
    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    const options = root.querySelectorAll('button[role="option"]');
    expect(options).toHaveLength(2);

    await act(async () => {
      (options[1] as HTMLButtonElement).click();
    });

    expect(onSelectOption).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'beta',
        label: 'Beta item'
      })
    );
    expect(root.querySelector('[data-omni-box-dropdown="true"]')).not.toBeNull();
    expect(root.querySelectorAll('button[role="option"]')).toHaveLength(2);
    expect(input.value).toBe('');

    cleanup();
  });

  it('closes an open result dropdown before hiding the widget on Escape', async () => {
    const {root, cleanup} = renderWidget({
      minQueryLength: 0,
      getOptions: () => [
        {
          id: 'alpha',
          label: 'Alpha item',
          description: 'First result'
        }
      ]
    });

    await act(async () => {});
    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(root.querySelector('[data-omni-box-dropdown="true"]')).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });

    expect(root.querySelector('[data-omni-box-dropdown="true"]')).toBeNull();
    expect(root.querySelector('[data-omni-box-controls="true"]')).not.toBeNull();

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    });

    expect(root.querySelector('[data-omni-box-controls="true"]')).toBeNull();

    cleanup();
  });

  it('can remember selected query strings and select them from recent searches', async () => {
    const {root, cleanup} = renderWidget({
      closeOnSelect: false,
      rememberQueries: true,
      queryHistoryStorageKey: 'omnibox-widget-test-history',
      getOptions: () => [
        {
          id: 'alpha',
          label: 'Alpha item',
          description: 'First result'
        }
      ]
    });

    await act(async () => {});
    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
    });
    await act(async () => {
      input.value = 'alpha query';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    const firstResult = root.querySelector('button[role="option"]') as HTMLButtonElement;
    await act(async () => {
      firstResult.click();
    });

    expect(window.localStorage.getItem('omnibox-widget-test-history')).toBe('["alpha query"]');

    await act(async () => {
      input.value = '';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });

    const historyButton = root.querySelector(
      'button[aria-label="Recent searches"]'
    ) as HTMLButtonElement;
    await act(async () => {
      historyButton.click();
    });

    const historyOption = root.querySelector('button[role="option"]') as HTMLButtonElement;
    expect(historyOption.textContent).toContain('alpha query');

    await act(async () => {
      historyOption.click();
    });

    expect(input.value).toBe('alpha query');

    cleanup();
  });
});
