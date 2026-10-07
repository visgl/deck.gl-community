// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';

it('keeps controls reachable inside a short embedded example without scrolling the host', async () => {
  await import('./styles.css');
  const wrapper = document.createElement('div');
  wrapper.className = 'coit-example';
  Object.assign(wrapper.style, {width: '500px', height: '240px'});
  wrapper.innerHTML = `<aside class="panel"><h1>Coit</h1>${'<p class="description">Source loading and refinement diagnostics.</p>'.repeat(8)}<button>Reset camera</button></aside>`;
  document.body.append(wrapper);
  try {
    const panel = wrapper.querySelector<HTMLElement>('.panel')!;
    const button = panel.querySelector<HTMLButtonElement>('button')!;
    const hostScroll = window.scrollY;
    expect(getComputedStyle(panel).overflowY).toBe('auto');
    expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
    expect(panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      wrapper.getBoundingClientRect().bottom
    );
    panel.scrollTop = panel.scrollHeight;
    const control = button.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    expect(control.top).toBeGreaterThanOrEqual(bounds.top);
    expect(control.bottom).toBeLessThanOrEqual(bounds.bottom);
    expect(window.scrollY).toBe(hostScroll);
    let clicked = false;
    button.addEventListener('click', () => {
      clicked = true;
    });
    button.click();
    expect(clicked).toBe(true);
  } finally {
    wrapper.remove();
  }
});

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
