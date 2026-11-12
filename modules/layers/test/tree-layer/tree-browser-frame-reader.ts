// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck} from '@deck.gl/core';
import {expect} from 'vitest';

export function createTreeFrameReader(size: number, glErrors: number[], staticFrames: boolean) {
  let pixels = new Uint8Array();
  let frames = 0;
  let readFrame = !staticFrames;
  return {
    onAfterRender({gl}: {gl: WebGL2RenderingContext}) {
      if (readFrame) {
        pixels = new Uint8Array(size * size * 4);
        gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      }
      const error = gl.getError();
      if (error) glErrors.push(error);
      frames++;
    },
    async settle(deck: Deck, count = staticFrames ? 1 : 4) {
      if (staticFrames) {
        await expect.poll(() => deck.isInitialized, {timeout: 60000}).toBe(true);
        const loop = deck['animationLoop']!;
        loop.stop();
        const before = frames;
        // Drive Deck normally, but do not read back or draw while the test is between samples.
        try {
          for (let i = 1; i <= count; i++) {
            readFrame = i === count;
            loop.redraw();
          }
        } finally {
          readFrame = false;
        }
        expect(frames).toBe(before + count);
      } else {
        const before = frames;
        await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThanOrEqual(before + count);
      }
      return pixels;
    }
  };
}
