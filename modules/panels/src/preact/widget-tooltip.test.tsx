/** @jsxImportSource preact */

import {render} from 'preact';
import {afterEach, describe, expect, it} from 'vitest';

import {WidgetTooltip} from './widget-tooltip';

/**
 * Renders one tooltip into a disposable DOM root.
 */
function renderTooltip() {
  const root = document.createElement('div');
  document.body.appendChild(root);

  render(
    <WidgetTooltip label="Example tooltip">
      <button type="button">Trigger</button>
    </WidgetTooltip>,
    root
  );

  return root;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('WidgetTooltip', () => {
  it('uses keyboard-visible focus instead of persistent focus-within', () => {
    const root = renderTooltip();
    const css = root.querySelector('style')?.textContent ?? '';

    expect(css).toContain(':has(:focus-visible)');
    expect(css).not.toContain(':focus-within');
  });
});
