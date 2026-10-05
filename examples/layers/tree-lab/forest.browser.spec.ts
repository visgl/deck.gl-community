// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Deck} from '@deck.gl/core';
import {expect, it} from 'vitest';
import {mountTreeForestExample} from './forest';

type ForestApi = {ready: boolean; errors: string[]; count: number; deck: Deck};

it('renders 10K and 20K forests through detail, season, shadow and view changes', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=10000&detail=low&fly=1&sun=0&wind=0';
  history.replaceState(null, '', queryUrl);
  const container = document.createElement('div');
  container.style.width = '900px';
  document.body.append(container);
  const cleanup = mountTreeForestExample(container, true);
  const api = (window as Window & {treeForest?: ForestApi}).treeForest!;
  let frames = 0;
  const originalAfterRender = api.deck.props.onAfterRender;
  api.deck.setProps({
    onAfterRender(context) {
      originalAfterRender?.(context);
      frames++;
    }
  });
  const change = async (action: () => void) => {
    const before = frames;
    action();
    await expect.poll(() => frames, {timeout: 30000}).toBeGreaterThan(before);
    expect(api.errors).toEqual([]);
  };
  try {
    await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
    expect(api.count).toBe(10000);
    const flyover = container.querySelector<HTMLInputElement>('[aria-label="Flyover"]')!;
    expect(flyover.checked).toBe(!matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (flyover.checked) flyover.click();
    await change(() => container.querySelector<HTMLButtonElement>('[data-count="20000"]')!.click());
    expect(api.count).toBe(20000);
    const shadows = container.querySelector<HTMLInputElement>('[aria-label="Shadows"]')!;
    await change(() => shadows.click());
    await change(() => shadows.click());
    const season = container.querySelector<HTMLSelectElement>('[aria-label="Season"]')!;
    for (const value of ['winter', 'spring', 'summer', 'autumn']) {
      await change(() => {
        season.value = value;
        season.dispatchEvent(new Event('change'));
      });
    }
    await change(() => container.querySelector<HTMLButtonElement>('#forest-view')!.click());
    const viewport = api.deck.getViewports()[0];
    const halfSide = (Math.ceil(Math.sqrt(20000)) * 9 + 20) / 111320;
    for (const longitude of [-halfSide, halfSide]) {
      for (const latitude of [-halfSide, halfSide]) {
        const [x, y] = viewport.project([longitude, latitude, 0]);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(viewport.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(viewport.height);
      }
    }
    expect(container.querySelector('.status')!.textContent).toContain('20,000');
    expect(api.errors).toEqual([]);
  } finally {
    cleanup();
    container.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 90000);
