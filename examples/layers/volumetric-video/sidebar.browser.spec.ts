// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it, vi} from 'vitest';
import {mountVolumetricVideoExample} from './app';

it('keeps floating sidebar restore controls themed', async () => {
  const parent = document.createElement('div');
  parent.style.cssText = 'width:1000px;height:700px';
  document.body.append(parent);
  const cleanup = mountVolumetricVideoExample(parent);
  try {
    await vi.waitFor(
      () => expect(parent.querySelector<HTMLElement>('.vv-demo')?.dataset.frameReady).toBe('88'),
      {timeout: 5000}
    );
    parent.querySelector<HTMLButtonElement>('[aria-label="Hide Video controls"]')!.click();
    await vi.waitFor(() => {
      const restore = parent.querySelector<HTMLElement>('[aria-label="Show Video controls"]');
      expect(restore).not.toBeNull();
      expect(getComputedStyle(restore!).getPropertyValue('--panel-preset').trim()).toBe(
        'sleek-dark'
      );
    });
    parent.querySelector<HTMLButtonElement>('[aria-label="Show Video controls"]')!.click();
    expect(parent.querySelector('[aria-label="Show Video controls"]')).toBeNull();
  } finally {
    cleanup();
    parent.remove();
  }
});
