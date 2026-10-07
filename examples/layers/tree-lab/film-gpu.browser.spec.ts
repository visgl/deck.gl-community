// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {mountTreeFilm} from './film';

it('composes actual tree pixels from both paired GPU renderers after shadow filtering is ready', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  let cleanup: (() => void) | undefined;
  try {
    cleanup = await mountTreeFilm(parent);
    const output = parent.querySelector<HTMLCanvasElement>('#film')!;
    const context = output.getContext('2d')!;
    for (const x of [60, 980]) {
      const pixels = context.getImageData(x, 260, 880, 650).data;
      let green = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (
          pixels[i + 1] > pixels[i] * 1.25 &&
          pixels[i + 1] > pixels[i + 2] * 1.1 &&
          pixels[i + 3] > 50
        )
          green++;
      expect(green).toBeGreaterThan(100);
    }
  } finally {
    cleanup?.();
    parent.remove();
  }
}, 30000);
