// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createRoot} from 'react-dom/client';
import {expect, it, vi} from 'vitest';
import App from './app';

const lifecycle = vi.hoisted(() => ({
  created: 0,
  finalized: 0,
  statusHandlers: [] as ((status: unknown) => void)[]
}));
vi.mock('@deck.gl/core', async importOriginal => {
  const original = await importOriginal<typeof import('@deck.gl/core')>();
  return {
    ...original,
    Deck: class {
      constructor() {
        lifecycle.created++;
      }
      setProps(props: {layers?: unknown[]}) {
        for (const layer of props.layers ?? []) {
          const handler = (layer as {props?: {onStatusChange?: unknown}}).props?.onStatusChange;
          if (typeof handler === 'function')
            lifecycle.statusHandlers.push(handler as (status: unknown) => void);
        }
      }
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
        expect(Boolean((window as unknown as {coitDeck?: unknown}).coitDeck)).toBe(diagnostic);
        const buttons = [...parent.querySelectorAll('button')].map(button => button.textContent);
        expect(buttons.some(label => label?.includes('Run camera test'))).toBe(diagnostic);
      } finally {
        root.unmount();
      }
      expect(lifecycle.finalized).toBe(lifecycle.created);
      expect((window as unknown as {coitDeck?: unknown}).coitDeck).toBeUndefined();
    }
  } finally {
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
});

it('records budget-limited coverage as a completed loading milestone', async () => {
  const originalUrl = location.href;
  const url = new URL(originalUrl);
  url.search = '?diagnostic';
  history.replaceState(null, '', url);
  const parent = document.createElement('div');
  document.body.append(parent);
  const root = createRoot(parent);
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
  lifecycle.statusHandlers.length = 0;
  try {
    root.render(<App />);
    await expect.poll(() => lifecycle.statusHandlers.length).toBeGreaterThan(0);
    lifecycle.statusHandlers.at(-1)!({
      phase: 'budget-limited',
      message: 'Resident budget reached.',
      activeSplats: 500_000,
      residentPages: 1,
      pendingPages: 1,
      sourceSplats: 50_000_000
    });
    await expect
      .poll(() =>
        debug.mock.calls.some(call => call[0] === 'COIT_LOAD' && call[1]?.includes('budget-ready'))
      )
      .toBe(true);
  } finally {
    root.unmount();
    debug.mockRestore();
    parent.remove();
    history.replaceState(null, '', originalUrl);
  }
});

it('does not clear a newer diagnostic deck when an older Coit instance unmounts', async () => {
  const originalUrl = location.href;
  const url = new URL(originalUrl);
  url.search = '?diagnostic';
  history.replaceState(null, '', url);
  const parent = document.createElement('div');
  const other = document.createElement('div');
  document.body.append(parent, other);
  const first = createRoot(parent);
  const second = createRoot(other);
  const diagnostics = window as unknown as {coitDeck?: unknown};
  let firstMounted = true;
  try {
    first.render(<App />);
    await expect.poll(() => diagnostics.coitDeck).toBeDefined();
    const previous = diagnostics.coitDeck;
    second.render(<App />);
    await expect.poll(() => diagnostics.coitDeck).not.toBe(previous);
    const current = diagnostics.coitDeck;
    expect(current).toBeDefined();
    first.unmount();
    firstMounted = false;
    expect(diagnostics.coitDeck).toBe(current);
  } finally {
    if (firstMounted) first.unmount();
    second.unmount();
    expect(diagnostics.coitDeck).toBeUndefined();
    parent.remove();
    other.remove();
    history.replaceState(null, '', originalUrl);
  }
});
