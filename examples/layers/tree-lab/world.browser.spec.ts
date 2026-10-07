// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {Deck} from '@deck.gl/core';
import {mountTreeWorldExample} from './world';
import {WORLD_TREE_COUNT} from './world-source';
import {TreeWoodLayer} from '../../../modules/layers/src/tree-layer/tree-wood-layer';

it('loads malformed world settings, uses host routes and rejects visibility interruptions', async () => {
  const originalUrl = location.href;
  const queryUrl = new URL(originalUrl);
  queryUrl.search = '?count=invalid&density=invalid&wind=0&shadows=0&zoom=21&profileCpu=1';
  history.replaceState(null, '', queryUrl);
  const parent = document.createElement('div');
  parent.style.cssText = 'width:400px;height:300px';
  document.body.append(parent);
  const target = TreeWoodLayer.prototype as unknown as {prepareShadow: unknown};
  const original = target.prepareShadow;
  const deckProps = vi.spyOn(Deck.prototype, 'setProps');
  const cleanup = mountTreeWorldExample(parent, {
    forestHref: './tree-forest',
    comparisonHref: './tree-lab',
    scroll: true
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
    // URL/layout/measurement controls do not require continuous GPU draws.
    const deck = (deckProps.mock.contexts as Deck[]).find(
      instance => instance.props?.parent === parent.querySelector('.canvas')
    )!;
    (deck as unknown as {animationLoop: {stop(): void}}).animationLoop.stop();
    const measure = parent.querySelector<HTMLButtonElement>('#world-measure')!;
    measure.click();
    expect(measure.disabled).toBe(true);
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(measure.disabled).toBe(false);
    expect(parent.querySelector('#world-results')!.textContent).toContain('Visibility changed');
    const root = parent.querySelector<HTMLElement>('.tree-world')!;
    const details = parent.querySelector<HTMLDetailsElement>('details')!;
    details.open = true;
    expect(getComputedStyle(root).overflowY).toBe('auto');
    expect(root.scrollHeight).toBeGreaterThan(root.clientHeight);
    root.scrollTop = details.offsetTop;
    expect(details.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      root.getBoundingClientRect().top
    );
    expect(details.getBoundingClientRect().top).toBeLessThan(root.getBoundingClientRect().bottom);
    const pitch = parent.querySelector<HTMLInputElement>('[aria-label="Pitch"]')!;
    pitch.value = '55';
    pitch.dispatchEvent(new Event('input'));
    pitch.value = '75';
    pitch.dispatchEvent(new Event('input'));
    await expect.poll(() => new URLSearchParams(location.search).get('pitch')).toBe('75');
    parent.querySelector<HTMLButtonElement>('[data-zoom="19"]')!.click();
    await expect.poll(() => new URLSearchParams(location.search).get('zoom')).toBe('19');
    for (const label of ['Wind', 'Shadows', 'Season']) {
      measure.click();
      expect(measure.disabled).toBe(true);
      const control = parent.querySelector<HTMLInputElement | HTMLSelectElement>(
        `[aria-label="${label}"]`
      )!;
      if (control instanceof HTMLSelectElement) {
        control.value = 'winter';
        control.dispatchEvent(new Event('change'));
      } else control.click();
      expect(measure.disabled).toBe(false);
      expect(parent.querySelector('#world-results')!.textContent).toContain(
        'Render settings changed'
      );
      await expect
        .poll(() => new URLSearchParams(location.search).get(label.toLowerCase()))
        .toBe(label === 'Season' ? 'winter' : '1');
    }
    expect(target.prepareShadow).not.toBe(original);
  } finally {
    visibility.mockRestore();
    deckProps.mockRestore();
    cleanup();
    expect(target.prepareShadow).toBe(original);
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
}, 45000);
