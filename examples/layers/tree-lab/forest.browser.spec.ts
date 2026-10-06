// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Deck} from '@deck.gl/core';
import type {TreeLayer} from '@deck.gl-community/layers';
import {expect, it, vi} from 'vitest';
import {mountTreeForestExample} from './forest';

type ForestApi = {ready: boolean; errors: string[]; count: number; deck: Deck};

it('renders 10K and 20K forests at highest geometry through season, shadow and view changes', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=10000&detail=low&fly=1&sun=0&wind=0&shadows=0';
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
    // Check the initialization contract, then pause before the first GPU draw.
    // A continuous flyover otherwise queues large software-renderer draws in CI.
    const flyover = container.querySelector<HTMLInputElement>('[aria-label="Flyover"]')!;
    expect(flyover.checked).toBe(!matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (flyover.checked) flyover.click();
    await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
    expect(api.count).toBe(10000);
    expect(container.querySelector('[aria-label="Detail"]')).toBeNull();
    expect((api.deck.props.layers[1] as TreeLayer).props).not.toHaveProperty('detail');
    await change(() => container.querySelector<HTMLButtonElement>('[data-count="20000"]')!.click());
    expect(api.count).toBe(20000);
    expect((api.deck.props.layers[1] as {props: {data: unknown[]}}).props.data).toHaveLength(20000);
    const shadows = container.querySelector<HTMLInputElement>('[aria-label="Shadows"]')!;
    // Keep the actual 20K shadow on/off regression. Seasonal behavior is drawn
    // without shadows here; matched shadow pixels are covered by the lab tests.
    expect(shadows.checked).toBe(false);
    await change(() => shadows.click());
    expect(shadows.checked).toBe(true);
    const pitch = container.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
    await change(() => {
      pitch.value = '80';
      pitch.dispatchEvent(new Event('input'));
    });
    expect((api.deck.getViewports()[0] as {pitch?: number}).pitch).toBe(80);
    expect(container.querySelector('#forest-pitch')!.textContent).toBe('80°');
    await change(() => shadows.click());
    expect(shadows.checked).toBe(false);
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

it('honors reduced motion and the stats toggle, with an explicit wind opt-in', async () => {
  const originalUrl = location.href;
  const matchMedia = window.matchMedia.bind(window);
  const preference = vi
    .spyOn(window, 'matchMedia')
    .mockImplementation(query =>
      query === '(prefers-reduced-motion: reduce)'
        ? ({matches: true} as MediaQueryList)
        : matchMedia(query)
    );
  const container = document.createElement('div');
  document.body.append(container);
  let cleanup: (() => void) | undefined;
  try {
    for (const wind of ['', '&wind=1']) {
      const queryUrl = new URL(originalUrl);
      queryUrl.search = `?count=1&shadows=0${wind}`;
      history.replaceState(null, '', queryUrl);
      cleanup = mountTreeForestExample(container);
      const api = (window as Window & {treeForest?: ForestApi}).treeForest!;
      await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
      expect(container.querySelector<HTMLInputElement>('[aria-label="Wind"]')!.checked).toBe(
        Boolean(wind)
      );
      expect(container.querySelector<HTMLInputElement>('[aria-label="Flyover"]')!.checked).toBe(
        false
      );
      expect(
        container.querySelector<HTMLInputElement>('[aria-label="Moving sunlight"]')!.checked
      ).toBe(false);
      const stats = container.querySelector<HTMLInputElement>('[aria-label="Show performance"]')!;
      const performanceLabel = container.querySelector<HTMLElement>('#forest-performance')!;
      stats.click();
      expect(getComputedStyle(performanceLabel).display).toBe('none');
      stats.click();
      expect(getComputedStyle(performanceLabel).display).not.toBe('none');
      expect(api.errors).toEqual([]);
      cleanup();
      cleanup = undefined;
    }
  } finally {
    cleanup?.();
    preference.mockRestore();
    container.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 60000);
