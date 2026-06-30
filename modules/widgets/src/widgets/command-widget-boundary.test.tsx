import {describe, expect, it, vi} from 'vitest';

import {commandManager} from '@deck.gl-community/panels';
import {CommandResetViewWidget} from './command-reset-view-widget';
import {CommandToggleWidget} from './command-toggle-widget';

/** Renders a widget into a document-attached root for DOM assertions. */
function renderWidget(widget: {onRenderHTML: (rootElement: HTMLElement) => void}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  widget.onRenderHTML(root);
  return {
    root,
    cleanup() {
      root.remove();
    }
  };
}

describe('command action widgets', () => {
  it('runs toggle actions directly from clicks and caller-owned commands', () => {
    const onChange = vi.fn();
    const widget = new CommandToggleWidget({
      id: 'test-toggle',
      icon: 'test-icon',
      label: 'Enable test mode',
      onChange,
      renderTooltipHTML: () => '<span>Enable test mode <kbd>T</kbd></span>'
    });
    const {root, cleanup} = renderWidget(widget);

    expect(root.querySelector('[role="tooltip"]')?.innerHTML).toContain('<kbd>T</kbd>');

    root.querySelector('button')?.click();
    expect(onChange).toHaveBeenLastCalledWith(true);

    commandManager.registerCommand({
      id: 'test-toggle.external',
      do: () => CommandToggleWidget.performAction({widget})
    });
    commandManager.executeCommand('test-toggle.external');
    expect(onChange).toHaveBeenLastCalledWith(false);

    cleanup();
  });

  it('runs reset actions directly from clicks and caller-owned commands', () => {
    const onCommand = vi.fn();
    const widget = new CommandResetViewWidget({
      id: 'test-reset',
      label: 'Reset test view',
      onCommand,
      renderTooltipHTML: () => {
        const element = document.createElement('span');
        element.textContent = 'Reset from caller tooltip';
        return element;
      }
    });
    const {root, cleanup} = renderWidget(widget);

    expect(root.querySelector('[role="tooltip"]')?.textContent).toContain(
      'Reset from caller tooltip'
    );

    root.querySelector('button')?.click();
    expect(onCommand).toHaveBeenCalledTimes(1);

    commandManager.registerCommand({
      id: 'test-reset.external',
      do: () => CommandResetViewWidget.performAction({widget})
    });
    commandManager.executeCommand('test-reset.external');
    expect(onCommand).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
