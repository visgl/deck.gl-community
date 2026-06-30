/** @jsxImportSource preact */

import {render} from 'preact';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {PanelSelect} from './panel-select';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('PanelSelect', () => {
  it('renders a rounded themed menu with lighter option text', async () => {
    const onChange = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);

    render(
      <PanelSelect
        ariaLabel="Color"
        value="processes"
        options={[
          {label: 'Process Id', value: 'processes'},
          {label: 'Span Status', value: 'span-status'}
        ]}
        onChange={onChange}
      />,
      root
    );

    (root.querySelector('button[aria-label="Color"]') as HTMLButtonElement).click();
    await Promise.resolve();

    const menu = document.body.querySelector('[role="listbox"]') as HTMLElement;
    const option = Array.from(document.body.querySelectorAll('[role="option"]')).find(
      candidate => candidate.textContent === 'Span Status'
    ) as HTMLButtonElement;

    expect(menu.style.borderRadius).toBe('13px');
    expect(option.style.fontWeight).toBe('430');

    option.click();
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith('span-status');
  });

  it('supports arrow-key navigation and Enter selection in the body-portaled menu', async () => {
    const onChange = vi.fn();
    const root = document.createElement('div');
    document.body.append(root);

    render(
      <PanelSelect
        ariaLabel="Color"
        value="processes"
        options={[
          {label: 'Process Id', value: 'processes'},
          {label: 'Span Status', value: 'span-status'},
          {label: 'Latency', value: 'latency'}
        ]}
        onChange={onChange}
      />,
      root
    );

    const button = root.querySelector('button[aria-label="Color"]') as HTMLButtonElement;
    button.click();
    await Promise.resolve();
    button.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'ArrowDown'}));
    await Promise.resolve();
    button.dispatchEvent(new KeyboardEvent('keydown', {bubbles: true, key: 'Enter'}));
    await Promise.resolve();

    expect(onChange).toHaveBeenCalledWith('span-status');
  });
});
