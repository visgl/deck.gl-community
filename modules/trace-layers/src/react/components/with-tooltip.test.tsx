import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it} from 'vitest';

import {WithTooltip} from './with-tooltip';

import type {ReactElement} from 'react';

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('WithTooltip', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows string tooltips on hover and wraps long lines', () => {
    const view = renderElement(
      <WithTooltip tooltip="abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef">
        <button type="button">Target</button>
      </WithTooltip>
    );

    expect(document.querySelector('[role="tooltip"]')).toBeNull();
    hoverTarget(view.container);

    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toContain('abcdefghijklmnopqrstuvwxyz');
    expect(tooltip?.querySelector('br')).not.toBeNull();
    expect(tooltip?.parentElement).toBe(document.body);
    expect(tooltip?.className).toContain('fixed');
    expect(tooltip?.className).toContain('z-[2147483647]');
    view.cleanup();
  });

  it('shows React node tooltips on focus with variant and class styling', () => {
    const view = renderElement(
      <WithTooltip className="custom-tooltip" tooltip={<strong>Details</strong>} variant="brand">
        <button type="button">Target</button>
      </WithTooltip>
    );

    focusTarget(view.container);

    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe('Details');
    expect(tooltip?.className).toContain('custom-tooltip');
    expect(tooltip?.className).toContain('bg-primary');
    view.cleanup();
  });

  it('portals tooltips above clipping containers', () => {
    const view = renderElement(
      <div className="overflow-hidden">
        <WithTooltip tooltip="Copy">
          <button type="button">Target</button>
        </WithTooltip>
      </div>
    );

    hoverTarget(view.container);

    const tooltip = document.querySelector('[role="tooltip"]');
    expect(tooltip?.parentElement).toBe(document.body);
    expect(tooltip?.className).toContain('fixed');
    expect(tooltip?.className).toContain('z-[2147483647]');
    expect(tooltip?.textContent).toBe('Copy');
    expect(tooltip?.querySelector('br')).toBeNull();
    view.cleanup();
  });
});

function hoverTarget(container: HTMLElement): void {
  const target = container.querySelector('button');
  if (!target) {
    throw new Error('Missing tooltip target');
  }

  act(() => {
    target.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
  });
}

function focusTarget(container: HTMLElement): void {
  const target = container.querySelector('button');
  if (!target) {
    throw new Error('Missing tooltip target');
  }

  act(() => {
    target.dispatchEvent(new FocusEvent('focusin', {bubbles: true}));
  });
}

function renderElement(element: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(element);
  });

  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  };
}
