// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {createWebMcpButton} from './webmcp-button';

test('keeps Escape dismissal until hover and focus end, including when the editor is focused', () => {
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:300px;top:20px';
  const editor = document.createElement('input');
  document.body.append(host, editor);
  editor.addEventListener('keydown', event => event.stopPropagation());
  const control = createWebMcpButton(host);
  const wrapper = control.button.parentElement!;
  const tooltip = host.querySelector<HTMLElement>('[role=tooltip]')!;
  const hover = () => wrapper.dispatchEvent(new MouseEvent('mouseenter'));
  const leave = () => wrapper.dispatchEvent(new MouseEvent('mouseleave'));
  const escape = () =>
    (document.activeElement ?? document).dispatchEvent(
      new KeyboardEvent('keydown', {key: 'Escape', bubbles: true})
    );
  try {
    hover();
    control.button.focus();
    escape();
    expect(tooltip.hidden).toBe(true);
    editor.focus();
    expect(tooltip.hidden).toBe(true);
    leave();
    hover();
    expect(tooltip.hidden).toBe(false);
    // Escape also works while keyboard focus remains in the editor.
    escape();
    expect(tooltip.hidden).toBe(true);
    leave();
    hover();
    control.button.focus();
    escape();
    leave();
    expect(tooltip.hidden).toBe(true);
    editor.focus();
    control.button.focus();
    expect(tooltip.hidden).toBe(false);
    // The gap and tooltip both receive pointer events, retaining wrapper hover.
    const buttonBounds = control.button.getBoundingClientRect();
    expect(
      tooltip.parentElement!.contains(
        document.elementFromPoint(buttonBounds.right - 8, buttonBounds.bottom + 4)
      )
    ).toBe(true);
    const tooltipBounds = tooltip.getBoundingClientRect();
    expect(
      tooltip.contains(document.elementFromPoint(tooltipBounds.left + 20, tooltipBounds.top + 20))
    ).toBe(true);
  } finally {
    control.destroy();
    host.remove();
    editor.remove();
  }
});
