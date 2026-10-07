// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {mountTreeWorldExample} from './world';
import {WORLD_TREE_COUNT} from './world-source';
import {TreeWoodLayer} from '../../../modules/layers/src/tree-layer/tree-wood-layer';

it('loads malformed world settings, uses host routes and rejects visibility interruptions', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=invalid&density=invalid&wind=0&shadows=0&zoom=21&profileCpu=1';
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.style.width = '400px';
  document.body.append(parent);
  const target = TreeWoodLayer.prototype as unknown as {prepareShadow: unknown};
  const original = target.prepareShadow;
  const cleanup = mountTreeWorldExample(parent, {
    forestHref: './tree-forest',
    comparisonHref: './tree-lab'
  });
  const visibility = vi.spyOn(document, 'visibilityState', 'get');
  try {
    await expect
      .poll(() => parent.querySelector('.status')!.textContent, {timeout: 30000})
      .toContain('Ready');
    expect(
      parent.querySelector<HTMLInputElement>('[aria-label="Global tree count in trillions"]')!
        .valueAsNumber
    ).toBe(WORLD_TREE_COUNT / 1e12);
    expect(
      parent.querySelector<HTMLInputElement>('[aria-label="Forest density"]')!.valueAsNumber
    ).toBe(400);
    expect(
      parent.querySelector<HTMLAnchorElement>('[data-world-link="forest"]')!.getAttribute('href')
    ).toBe('./tree-forest');
    expect(
      parent
        .querySelector<HTMLAnchorElement>('[data-world-link="comparison"]')!
        .getAttribute('href')
    ).toBe('./tree-lab');
    const measure = parent.querySelector<HTMLButtonElement>('#world-measure')!;
    measure.click();
    expect(measure.disabled).toBe(true);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(measure.disabled).toBe(false);
    expect(parent.querySelector('#world-results')!.textContent).toContain('Visibility changed');
    expect(target.prepareShadow).not.toBe(original);
  } finally {
    visibility.mockRestore();
    cleanup();
    expect(target.prepareShadow).toBe(original);
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 45000);
