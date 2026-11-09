// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import FullscreenExample from '../../website/src/components/example/fullscreen-example';

it('shares one fullscreen button across nested website examples without replacing the scene', async () => {
  const request = vi
    .spyOn(Element.prototype, 'requestFullscreen')
    .mockRejectedValue(new Error('Unavailable'));
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => {
      root.render(
        <FullscreenExample style={{height: 300}}>
          <FullscreenExample style={{height: '100%'}}>
            <canvas />
            <input aria-label="Scene value" defaultValue="initial" />
          </FullscreenExample>
        </FullscreenExample>
      );
    });
    const canvas = host.querySelector('canvas');
    const input = host.querySelector('input')!;
    input.value = 'preserved';
    expect(host.querySelectorAll('button')).toHaveLength(1);
    host.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(host.querySelector('[aria-modal="true"]')).not.toBeNull());
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(input.value).toBe('preserved');
    expect(host.querySelector('button')!.getAttribute('aria-label')).toBe('Exit fullscreen');
    await act(async () => root.unmount());
    expect(document.documentElement.hasAttribute('data-deck-panel-fullscreen-lock')).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    request.mockRestore();
  }
});
