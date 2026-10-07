// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';

it('contains hosted styles without changing document scrolling or external headings', async () => {
  const heading = document.createElement('h1');
  heading.textContent = 'Host documentation';
  document.body.append(heading);
  const overflow = getComputedStyle(document.body).overflow;
  const size = getComputedStyle(heading).fontSize;
  try {
    await import('./styles.css');
    expect(getComputedStyle(document.body).overflow).toBe(overflow);
    expect(getComputedStyle(heading).fontSize).toBe(size);
    const wrapper = document.createElement('div');
    wrapper.className = 'coit-example';
    wrapper.innerHTML = '<h1>Coit</h1>';
    document.body.append(wrapper);
    expect(getComputedStyle(wrapper).overflow).toBe('hidden');
    expect(getComputedStyle(wrapper.firstElementChild!).fontSize).not.toBe(size);
    wrapper.remove();
  } finally {
    heading.remove();
  }
});
