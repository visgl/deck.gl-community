// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {CompositeLayer, type Layer, type Deck} from '@deck.gl/core';
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
    // Exercise all 20K native instances and controls without filling a full-size
    // framebuffer on Linux SwiftShader. Dedicated lab tests assert full-resolution pixels.
    useDevicePixels: 0.25,
    onAfterRender(context) {
      originalAfterRender?.(context);
      frames++;
    }
  });
  const change = async (phase: string, action: () => void) => {
    const before = frames;
    console.info(`Forest contract: ${phase}`);
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
    await change('20K source', () =>
      container.querySelector<HTMLButtonElement>('[data-count="20000"]')!.click()
    );
    expect(api.count).toBe(20000);
    expect((api.deck.props.layers[1] as {props: {data: unknown[]}}).props.data).toHaveLength(20000);
    const shadows = container.querySelector<HTMLInputElement>('[aria-label="Shadows"]')!;
    // Keep the actual 20K shadow on/off regression. Seasonal behavior is drawn
    // without shadows here; matched shadow pixels are covered by the lab tests.
    expect(shadows.checked).toBe(false);
    await change('20K shadows', () => shadows.click());
    expect(shadows.checked).toBe(true);
    const pitch = container.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
    await change('80 degree pitch', () => {
      pitch.value = '80';
      pitch.dispatchEvent(new Event('input'));
    });
    expect((api.deck.getViewports()[0] as {pitch?: number}).pitch).toBe(80);
    expect(container.querySelector('#forest-pitch')!.textContent).toBe('80°');
    await expect
      .poll(
        () => {
          const leaves = (layer: Layer): Layer[] =>
            layer instanceof CompositeLayer ? layer.getSubLayers().flatMap(leaves) : [layer];
          const casters = (api.deck.props.layers as Layer[])
            .flatMap(leaves)
            .filter(
              layer => layer.id.includes('-wood-') && layer.props.operation.includes('shadow')
            );
          return casters.reduce((sum, layer) => sum + layer.getNumInstances(), 0);
        },
        {timeout: 30000}
      )
      .toBeLessThan(10000);

    await change('shadows off', () => shadows.click());
    expect(shadows.checked).toBe(false);
    const season = container.querySelector<HTMLSelectElement>('[aria-label="Season"]')!;
    for (const value of ['winter', 'spring', 'summer', 'autumn']) {
      await change(value, () => {
        season.value = value;
        season.dispatchEvent(new Event('change'));
      });
    }
    await change('forest overview', () =>
      container.querySelector<HTMLButtonElement>('#forest-view')!.click()
    );
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
  // Keep each 30s draw assertion; the complete sequence has more than ten such phases.
}, 420000);

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
  container.style.cssText = 'width:400px;height:300px';
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
      const root = container.querySelector<HTMLElement>('.tree-forest')!;
      expect(getComputedStyle(root).overflowY).toBe('auto');
      expect(root.scrollHeight).toBeGreaterThan(root.clientHeight);
      root.scrollTop = root.scrollHeight;
      expect(root.querySelector('.footer')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        root.getBoundingClientRect().bottom + 1
      );
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
}, 90000);

it('keeps the current flyover position when pitch is changed', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=1&fly=0&sun=0&wind=0&shadows=0';
  history.replaceState(null, '', queryUrl);
  const container = document.createElement('div');
  document.body.append(container);
  const cleanup = mountTreeForestExample(container);
  const api = (window as Window & {treeForest?: ForestApi}).treeForest!;
  try {
    await expect.poll(() => api.ready, {timeout: 15000}).toBe(true);
    const flyover = container.querySelector<HTMLInputElement>('[aria-label="Flyover"]')!;
    flyover.click();
    const pose = () =>
      api.deck.props.viewState as {
        longitude: number;
        latitude: number;
        bearing: number;
        pitch: number;
      };
    await expect.poll(() => pose().latitude).not.toBe(0);
    flyover.click();
    const current = {...pose()};
    const pitch = container.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
    pitch.value = '75';
    pitch.dispatchEvent(new Event('input'));
    expect(pose()).toMatchObject({...current, pitch: 75});
    expect(api.errors).toEqual([]);
  } finally {
    cleanup();
    container.remove();
    history.replaceState(null, '', originalUrl);
  }
});
