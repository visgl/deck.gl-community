// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=legacy benchmark query values cannot inject HTML or lower geometry quality;
// fails_when=untrusted detail is interpolated into markup or passed to TreeLayer;
// why_new=the visual lab regression does not mount the separate benchmark entry point; seam=none

import type {Deck} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {expect, it, vi} from 'vitest';
import {mountTreeBenchmark} from './benchmark';

type BenchmarkApi = {
  ready: boolean;
  errors: string[];
  deck: Deck;
  measure: (durationMs?: number) => Promise<{
    treeInstances: number;
    view: string;
    renderCallP95Ms: number | null;
  }>;
};

it('rejects failed measurements and cancels pending work when the benchmark closes', async () => {
  const originalUrl = location.href;
  history.replaceState(null, '', '?count=1&season=winter&wind=0&shadows=0');
  try {
    for (const phase of ['render-error', 'idle-close', 'motion-close', 'repeat-close']) {
      const parent = document.createElement('div');
      parent.id = 'app';
      parent.style.cssText = 'width:320px;height:240px';
      document.body.append(parent);
      const cleanup = mountTreeBenchmark(TreeLayer, 'native');
      const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
      let closed = false;
      const setProps = vi.spyOn(api.deck, 'setProps');
      try {
        await expect.poll(() => api.ready, {timeout: 15000}).toBe(true);
        const failure = phase === 'render-error' ? 'Rendering failed' : 'Benchmark closed';
        const rejected =
          phase === 'repeat-close' ? undefined : expect(api.measure(1000)).rejects.toThrow(failure);
        if (phase === 'repeat-close') parent.querySelector<HTMLButtonElement>('#repeat')!.click();
        if (phase !== 'idle-close') await new Promise(resolve => setTimeout(resolve, 600));
        if (phase === 'render-error') {
          (api.deck.props.onError as (error: Error) => void)(
            new Error('benchmark renderer failed')
          );
          await rejected;
          expect(parent.querySelector('#result')!.textContent).toContain(
            'benchmark renderer failed'
          );
          expect(parent.querySelector('#summary table')).toBeNull();
          await expect(api.measure(1)).rejects.toThrow('Rendering failed');
        } else {
          cleanup();
          closed = true;
          await rejected;
          const calls = setProps.mock.calls.length;
          const summary = parent.querySelector('#summary')!.textContent;
          await new Promise(resolve => setTimeout(resolve, 200));
          expect(setProps.mock.calls.length).toBe(calls);
          expect(parent.querySelector('#summary')!.textContent).toBe(summary);
          await expect(api.measure(1)).rejects.toThrow('Benchmark closed');
        }
      } finally {
        setProps.mockRestore();
        if (!closed) cleanup();
        parent.remove();
      }
    }
  } finally {
    history.replaceState(null, '', originalUrl);
  }
}, 45000);

it.each([
  '<img id="tree-query-injection" src="data:," onerror="document.documentElement.dataset.treeQueryInjected=1">',
  'invalid',
  'medium',
  'low'
])('ignores legacy benchmark detail safely for %s', async detail => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '';
  queryUrl.searchParams.set('count', '1');
  queryUrl.searchParams.set('detail', detail);
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.id = 'app';
  parent.style.width = '640px';
  parent.style.height = '480px';
  document.body.append(parent);
  const cleanup = mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  try {
    expect(parent.querySelector('#tree-query-injection')).toBeNull();
    expect(parent.querySelector('p')!.textContent).toContain(
      'full leaf sources · automatic refinement'
    );
    await expect.poll(() => api.ready, {timeout: 15000}).toBe(true);
    expect(api.errors).toEqual([]);
    const layers = api.deck.props.layers as TreeLayer[];
    expect(layers[1].props).not.toHaveProperty('detail');
    expect(document.documentElement.dataset.treeQueryInjected).toBeUndefined();
  } finally {
    cleanup();
    parent.remove();
    delete document.documentElement.dataset.treeQueryInjected;
    history.replaceState(null, '', originalUrl);
  }
});

it('submits all 20,000 requested tree instances to the renderer', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=20000&species=mixed&detail=low&season=winter';
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.id = 'app';
  parent.style.width = '640px';
  parent.style.height = '480px';
  document.body.append(parent);
  const cleanup = mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  try {
    await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
    expect(parent.querySelector('h1')!.textContent).toContain('20,000');
    expect(parent.querySelector('p')!.textContent).toContain('winter');
    const layers = api.deck.props.layers as TreeLayer[];
    expect(layers[1].props.data).toHaveLength(20000);
    const sample = await api.measure(1000);
    expect(sample.treeInstances).toBe(20000);
    expect(sample.view).toBe('canopy');
    expect(sample.renderCallP95Ms).not.toBeNull();
    expect(sample.renderCallP95Ms!).toBeGreaterThanOrEqual(0);
    expect(api.errors).toEqual([]);
  } finally {
    cleanup();
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 45000);

it('uses the computed pullback zoom for a large single-species grid', async () => {
  const originalUrl = location.href;
  history.replaceState(null, '', '?count=20000&species=pine&season=winter&wind=0&shadows=0');
  const parent = document.createElement('div');
  parent.id = 'app';
  document.body.append(parent);
  const cleanup = mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  Object.assign(parent.querySelector<HTMLElement>('.canvas')!.style, {
    width: '160px',
    height: '120px'
  });
  api.deck.setProps({width: 160, height: 120, useDevicePixels: false});
  try {
    await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
    expect(api.deck.getViewports()[0].zoom).toBeCloseTo(20.5 - Math.log2(Math.sqrt(20000)));
    expect((api.deck.props.layers as TreeLayer[])[1].props.data).toHaveLength(20000);
    expect(api.errors).toEqual([]);
  } finally {
    cleanup();
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 45000);

it('refits overview after resize and rejects measurements across viewport sizes', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=100&species=mixed&detail=low&wind=0&shadows=0&view=overview';
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.id = 'app';
  parent.style.width = '900px';
  document.body.append(parent);
  const cleanup = mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  try {
    await expect.poll(() => api.ready, {timeout: 30000}).toBe(true);
    const initialZoom = api.deck.getViewports()[0].zoom;
    parent.style.width = '360px';
    await expect.poll(() => api.deck.width).toBe(316);
    const viewport = api.deck.getViewports()[0];
    expect(viewport.zoom).toBeLessThan(initialZoom);
    const halfSide = (Math.ceil(Math.sqrt(100)) * 9 + 20) / 111320;
    for (const longitude of [-halfSide, halfSide]) {
      for (const latitude of [-halfSide, halfSide]) {
        const [x, y] = viewport.project([longitude, latitude, 30]);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(viewport.width);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(viewport.height);
      }
    }
    const rejected = expect(api.measure(500)).rejects.toThrow('Viewport resized');
    parent.style.width = '480px';
    await rejected;
    await expect(api.measure(250)).resolves.toMatchObject({treeInstances: 100, view: 'overview'});
    expect(api.errors).toEqual([]);
  } finally {
    cleanup();
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 30000);

it('rejects hidden and visible interruptions even when both endpoints are visible', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=1&wind=0&shadows=0';
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.id = 'app';
  document.body.append(parent);
  const cleanup = mountTreeBenchmark(TreeLayer, 'native');
  const api = (window as Window & {treeBenchmark?: BenchmarkApi}).treeBenchmark!;
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    await expect.poll(() => api.ready, {timeout: 15000}).toBe(true);
    const rejected = expect(api.measure(100)).rejects.toThrow('Visibility changed');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await rejected;
    await expect(api.measure(100)).resolves.toMatchObject({treeInstances: 1});
  } finally {
    visibility.mockRestore();
    cleanup();
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
});
