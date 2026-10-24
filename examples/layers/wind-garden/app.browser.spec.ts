// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck, Layer, MapView} from '@deck.gl/core';
import {WindEffect, WindExtension} from '@deck.gl-community/layers';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {expect, it, vi} from 'vitest';
import {mountWindGardenExample} from './app';

it('drives every garden layer from one panel-controlled WindEffect', {
  timeout: 120_000
}, async () => {
  const parent = document.createElement('div');
  Object.assign(parent.style, {width: '800px', height: '500px'});
  document.body.append(parent);
  let device: Device | undefined;
  let deck: Deck<MapView>;
  let cleanup: (() => void) | undefined;
  let pixels = new Uint8Array();
  const errors: Error[] = [];
  const frames = vi.fn(({gl}: {gl: WebGL2RenderingContext}) => {
    pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels
    );
  });
  const wind = () =>
    (deck!.props.effects as WindEffect[]).find(effect => effect instanceof WindEffect)!;
  const layer = (id: string) => (deck!.props.layers as Layer[]).find(item => item?.id === id);
  const setNumber = (label: string, value: number) => {
    const input = parent.querySelector<HTMLInputElement>(
      `input[aria-label="${label} numeric value"]`
    )!;
    input.value = String(value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  };
  // A frozen clock leaves the garden idle: each change then draws once.
  const settle = async (count = 5) => {
    const before = frames.mock.calls.length;
    await expect
      .poll(() => frames.mock.calls.length, {timeout: 30000})
      .toBeGreaterThan(before + count - 1);
  };
  const changed = (a: Uint8Array, b: Uint8Array) => {
    let count = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 24) count++;
    return count;
  };
  try {
    device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: {container: parent}
    });
    cleanup = mountWindGardenExample(parent, {
      device,
      onDeckInitialized(instance) {
        deck = instance;
        deck.setProps({
          useDevicePixels: 0.5,
          onError: error => errors.push(error),
          onAfterRender: frames
        });
      }
    });
    await settle();
    for (const id of ['SimpleMeshLayer', 'ColumnLayer', 'GridCellLayer', 'PointCloudLayer'])
      expect(
        layer(id)?.props.extensions.some(item => item instanceof WindExtension),
        id
      ).toBe(true);
    expect(layer('TreeLayer')).toBeDefined();
    expect(wind().props).toMatchObject({strength: 0.03, direction: 90, gust: 0.3, time: null});

    // Freeze the clock, then turn the wind around: the frozen garden changes pose.
    parent.querySelector<HTMLInputElement>('#settings-panel-input-frozen')!.click();
    await expect.poll(() => wind().props.time).toBe(2);
    setNumber('Wind', 0.1);
    await expect.poll(() => wind().props.strength).toBe(0.1);
    await settle(1);
    const east = pixels.slice();
    setNumber('Wind direction', 270);
    await expect.poll(() => wind().props.direction).toBe(270);
    await settle(1);
    expect(changed(east, pixels)).toBeGreaterThan(500);
    setNumber('Turbulence', 0);
    await expect.poll(() => wind().props.turbulence).toBe(0);
    // A layer toggle removes only that layer; the rest keep the effect.
    parent.querySelector<HTMLInputElement>('#settings-panel-input-layers-columns')!.click();
    await expect.poll(() => layer('ColumnLayer')).toBeUndefined();
    await settle(1);
    expect(errors).toEqual([]);
  } finally {
    cleanup?.();
    device?.destroy();
    parent.remove();
  }
});
