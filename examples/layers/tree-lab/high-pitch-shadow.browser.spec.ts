// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=local ground shadows remain visible as the camera crosses the horizon;
// fails_when=screen-corner ground intersections flip behind the camera or stretch the shadow map;
// why_new=existing shadow tests keep a 58 degree camera; seam=none

import {Deck} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/layers';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it} from 'vitest';
import {
  createLighting,
  createSceneLayers,
  createSpecimens,
  createViews,
  DEFAULT_OPTIONS,
  VIEW,
  SEASONS
} from './scene';

it('keeps local shadows through the horizon at every season and moving sun angle', async () => {
  const width = 600;
  const height = 400;
  const container = document.createElement('div');
  container.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(container);
  const lighting = createLighting(true);
  const errors: string[] = [];
  let frame = 0;
  let pixels = new Uint8Array();
  const deck = new Deck({
    parent: container,
    width,
    height,
    useDevicePixels: false,
    deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
    views: createViews(),
    viewState: VIEW,
    effects: [lighting],
    layers: [],
    onError: error => errors.push(error.message),
    onAfterRender({gl}) {
      pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) errors.push('Shadow readback failed');
      frame++;
    }
  });
  try {
    let data = createSpecimens('oak');
    const capture = async (casters: boolean) => {
      const before = frame;
      deck.setProps({
        layerFilter: ({layer, renderPass}) =>
          renderPass === 'shadow' ? casters : layer.id.endsWith('-ground')
      });
      await expect.poll(() => frame, {timeout: 15000}).toBeGreaterThan(before);
      expect(errors).toEqual([]);
      return pixels.slice();
    };
    for (const species of ['oak', 'palm'] as const) {
      data = createSpecimens(species);
      for (const season of SEASONS) {
        for (const pitch of [58, 68, 70, 71.4, 71.5, 71.56505117707799, 72, 75, 80]) {
          deck.setProps({
            viewState: {...VIEW, zoom: 19.5, pitch, bearing: 0, position: [0, 0, 0]},
            layers: createSceneLayers(TreeLayer, 'horizon', data, {
              ...DEFAULT_OPTIONS,
              season,
              crops: false,
              dropped: false,
              detail: 'medium',
              shadows: true,
              wind: true,
              windTime: 1.5
            })
          });
          for (const direction of [
            [-1, -0.6, -1.4],
            [1, 0.8, -0.7]
          ] as [number, number, number][]) {
            lighting.setSunDirection(direction);
            const clear = await capture(false);
            const shadowed = await capture(true);
            let localShadowPixels = 0;
            let distantShadowPixels = 0;
            const viewport = deck.getViewports()[0];
            for (let offset = 0; offset < clear.length; offset += 4) {
              const darkening =
                clear[offset] -
                shadowed[offset] +
                clear[offset + 1] -
                shadowed[offset + 1] +
                clear[offset + 2] -
                shadowed[offset + 2];
              if (clear[offset + 3] === 0 || darkening <= 15) continue;
              const index = offset / 4;
              const [longitude, latitude] = viewport.unproject([
                (index % width) + 0.5,
                height - Math.floor(index / width) - 0.5
              ]);
              // Each specimen and its shadow fit comfortably within 40m.
              if (Math.hypot(longitude, latitude) * 111320 < 40) localShadowPixels++;
              else distantShadowPixels++;
            }
            expect(
              localShadowPixels,
              `${species}, ${season}, pitch ${pitch}, sun ${direction}`
            ).toBeGreaterThan(25);
            expect(
              distantShadowPixels,
              `${species}, ${season}, pitch ${pitch}: no phantom distant shadows`
            ).toBe(0);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    deck.finalize();
    container.remove();
  }
}, 90000);
