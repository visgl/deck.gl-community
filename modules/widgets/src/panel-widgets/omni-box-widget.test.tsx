import { afterEach, describe, expect, it } from 'vitest';

import { OmniBoxWidget } from './omni-box-widget';

function renderWidget() {
  const root = document.createElement('div');
  document.body.appendChild(root);

  const widget = new OmniBoxWidget({
    defaultOpen: true,
    getOptions: () => [
      {
        id: 'alpha',
        label: 'Alpha block',
        description: 'First result',
      },
    ],
  });

  widget.onRenderHTML(root);

  return {
    root,
    widget,
    cleanup() {
      widget.onRemove();
      root.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('OmniBoxWidget', () => {
  it('uses deck widget theme CSS variables for the control row and dropdown', async () => {
    const { root, cleanup } = renderWidget();

    const styles = root.querySelector('style');
    expect(styles?.textContent).toContain('var(--button-stroke');
    expect(styles?.textContent).toContain('var(--button-icon-hover');
    expect(styles?.textContent).toContain('var(--button-icon-idle');
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
});
