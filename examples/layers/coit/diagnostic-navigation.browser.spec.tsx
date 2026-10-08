// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import App from './app';

const lifecycle = vi.hoisted(() => ({created: 0, finalized: 0}));
vi.mock('@deck.gl/core', async importOriginal => {
  const original = await importOriginal<typeof import('@deck.gl/core')>();
  return {
    ...original,
    Deck: class {
      constructor() {
        lifecycle.created++;
      }
      setProps() {}
      finalize() {
        lifecycle.finalized++;
      }
    }
  };
});

it('reads diagnostics again when the cached website module mounts under a changed URL', async () => {
  const originalUrl = location.href;
  const parent = document.createElement('div');
  document.body.append(parent);
  try {
    for (const diagnostic of [false, true, false]) {
      const url = new URL(originalUrl);
      url.search = diagnostic ? '?diagnostic' : '';
      history.replaceState(null, '', url);
      const root = createRoot(parent);
      const before = lifecycle.created;
      root.render(<App />);
      try {
        await expect.poll(() => lifecycle.created).toBe(before + 1);
        const buttons = [...parent.querySelectorAll('button')].map(button => button.textContent);
        expect(buttons.some(label => label?.includes('Run camera test'))).toBe(diagnostic);
      } finally {
        root.unmount();
      }
      expect(lifecycle.finalized).toBe(lifecycle.created);
    }
  } finally {
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
});
