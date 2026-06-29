import {act} from 'preact/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {CommandManager, toastManager} from '@deck.gl-community/panels';

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
  toastManager.clear();
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

  it('renders a caller-provided results summary above search options', async () => {
    const {root, cleanup} = renderWidget({
      minQueryLength: 0,
      getOptions: () => [
        {
          id: 'alpha',
          label: 'Alpha item'
        },
        {
          id: 'beta',
          label: 'Beta item'
        }
      ],
      renderResultsSummary: ({mode, options, query}) =>
        `${mode}:${query || '<empty>'}:${options.length}`
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

    const summary = root.querySelector('[data-omni-box-results-summary="true"]');
    expect(summary?.textContent).toBe('search:<empty>:2');

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

  it('delegates non-command queries to the caller option provider', async () => {
    const commandManager = new CommandManager();
    const getOptions = vi.fn(() => [
      {
        id: 'alpha',
        label: 'Alpha item'
      }
    ]);
    const {root, cleanup} = renderWidget({
      commandManager,
      minQueryLength: 0,
      getOptions
    });
    await act(async () => {});

    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
      input.value = 'alpha';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(getOptions).toHaveBeenCalledWith('alpha');
    expect(root.querySelector('button[role="option"]')?.textContent).toContain('Alpha item');

    cleanup();
  });

  it('lists enabled no-argument commands when the command prefix is typed', async () => {
    const commandManager = new CommandManager();
    commandManager.registerCommand({
      id: 'trace.toggleOverview',
      label: 'Toggle overview',
      description: 'Show or hide the overview panel',
      do: vi.fn()
    });
    commandManager.registerCommand({
      id: 'trace.toggleSidePanel',
      label: 'Toggle side panel',
      exposure: 'all',
      do: vi.fn()
    });
    commandManager.registerCommand({
      id: 'trace.panLeft',
      label: 'Pan left',
      exposure: 'automation',
      do: vi.fn()
    });
    commandManager.registerCommand({
      id: 'trace.openSpan',
      label: 'Open span',
      argsSchema: {
        safeParse: () => ({success: true, data: {}})
      },
      do: vi.fn()
    });
    commandManager.registerCommand({
      id: 'trace.disabled',
      label: 'Disabled command',
      isEnabled: () => false,
      do: vi.fn()
    });
    const getOptions = vi.fn(() => []);
    const {root, cleanup} = renderWidget({
      commandManager,
      minQueryLength: 0,
      getOptions
    });
    await act(async () => {});

    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
      input.value = '>toggle';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    const optionText = Array.from(root.querySelectorAll('button[role="option"]')).map(
      option => option.textContent
    );
    expect(getOptions).not.toHaveBeenCalledWith('>toggle');
    expect(optionText).toEqual([
      expect.stringContaining('Toggle overview'),
      expect.stringContaining('Toggle side panel')
    ]);
    expect(optionText.join(' ')).not.toContain('Pan left');
    expect(optionText.join(' ')).not.toContain('Open span');
    expect(optionText.join(' ')).not.toContain('Disabled command');

    cleanup();
  });

  it('executes command options without calling caller search callbacks', async () => {
    const commandManager = new CommandManager();
    const doCommand = vi.fn();
    commandManager.registerCommand({
      id: 'trace.toggleSidePanel',
      label: 'Toggle side panel',
      do: doCommand
    });
    const onSelectOption = vi.fn();
    const onNavigateOption = vi.fn();
    const {root, cleanup} = renderWidget({
      commandManager,
      closeOnSelect: false,
      minQueryLength: 0,
      onSelectOption,
      onNavigateOption
    });
    await act(async () => {});

    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
      input.value = '>';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
    });
    await act(async () => {
      root.querySelector<HTMLButtonElement>('button[role="option"]')?.click();
    });

    expect(doCommand).toHaveBeenCalledOnce();
    expect(onSelectOption).not.toHaveBeenCalled();
    expect(onNavigateOption).not.toHaveBeenCalled();
    expect(toastManager.getToasts()).toEqual([
      expect.objectContaining({
        type: 'info',
        title: 'Command succeeded',
        message: 'Toggle side panel',
        key: 'omnibox-command:trace.toggleSidePanel'
      })
    ]);

    cleanup();
  });

  it('toasts command failures', async () => {
    const commandManager = new CommandManager();
    commandManager.registerCommand({
      id: 'trace.failCommand',
      label: 'Fail command',
      do: () => new Error('Unable to run command')
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const {root, cleanup} = renderWidget({
      commandManager,
      minQueryLength: 0
    });
    await act(async () => {});

    const input = root.querySelector('input[aria-label="OmniBox"]') as HTMLInputElement;
    await act(async () => {
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', {bubbles: false}));
      input.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
      input.value = '>fail';
      input.dispatchEvent(new InputEvent('input', {bubbles: true}));
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    await act(async () => {
      root.querySelector<HTMLButtonElement>('button[role="option"]')?.click();
    });
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 0));
    });

    expect(toastManager.getToasts()).toEqual([
      expect.objectContaining({
        type: 'error',
        title: 'Command failed',
        message: 'Fail command: Unable to run command',
        key: 'omnibox-command:trace.failCommand'
      })
    ]);
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to execute omnibox command: trace.failCommand',
      expect.any(Error)
    );
    consoleError.mockRestore();

    cleanup();
  });
});
