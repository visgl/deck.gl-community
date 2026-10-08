// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {Deck, type OrbitView} from '@deck.gl/core';
import type {VolumetricVideoLayer} from '@deck.gl-community/layers';
import {mountVolumetricVideoExample} from './app';

const MOV_URL = new URL(
  '../../../modules/layers/test/volumetric-video-layer/sample.mov',
  import.meta.url
).href;

function change(element: HTMLInputElement | HTMLSelectElement, value: string, type = 'input') {
  element.value = value;
  element.dispatchEvent(new Event(type, {bubbles: true}));
}

function chooseFile(input: HTMLInputElement, file: File) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', {bubbles: true}));
}

describe('mounted volumetric video demo', () => {
  // Value: protects=real file-driven demo recovers and retains its playback history through controls and remount;
  // fails_when=file errors strand controls, sampling loses the requested trail, camera hold skips time, or cleanup leaks its source;
  // why_new=helper and GPU tests never invoke the mounted demo's DOM handlers or returned cleanup; seam=none
  it('recovers a MOV file, restores requested history, holds playback for camera motion, and remounts cleanly', async () => {
    const parent = document.createElement('div');
    parent.style.cssText = 'position:fixed;inset:0;width:1000px;height:700px';
    document.body.append(parent);
    const updates = vi.spyOn(Deck.prototype, 'setProps');
    const revoked = vi.spyOn(URL, 'revokeObjectURL');
    let cleanup: (() => void) | undefined;
    const element = <T extends HTMLElement>(id: string) => parent.querySelector<T>(id)!;
    const root = () => element<HTMLElement>('.vv-demo');
    const ready = async (frame?: number) => {
      await vi.waitFor(
        () => {
          expect(root().dataset.frameReady).toBeDefined();
          if (frame !== undefined) expect(Number(root().dataset.frameReady)).toBe(frame);
        },
        {timeout: 5000}
      );
    };
    const currentDeck = () => updates.mock.contexts.at(-1)! as Deck<OrbitView[]>;
    const layer = () => currentDeck().props.layers![0] as VolumetricVideoLayer;
    try {
      cleanup = mountVolumetricVideoExample(parent);
      await ready(88);
      expect(element<HTMLSelectElement>('#vv-resolution').value).toBe('0');
      change(element<HTMLSelectElement>('#vv-resolution'), '128', 'change');
      await vi.waitFor(() => expect(layer().state.frames!.width).toBe(128), {timeout: 5000});
      chooseFile(
        element<HTMLInputElement>('#vv-file'),
        new File(['not a movie'], 'broken.mov', {type: 'video/quicktime'})
      );
      await vi.waitFor(() => expect(element('#vv-error').textContent).not.toBe(''), {
        timeout: 5000
      });
      expect(element('#vv-status').textContent).toBe('Video could not be loaded');
      expect(element<HTMLButtonElement>('#vv-play').disabled).toBe(true);
      expect(root().dataset.frameReady).toBeUndefined();
      expect(element<HTMLSelectElement>('#vv-resolution').value).toBe('0');
      const blob = await (await fetch(MOV_URL)).blob();
      chooseFile(
        element<HTMLInputElement>('#vv-file'),
        new File([blob], 'recovered.mov', {type: 'video/quicktime'})
      );
      await ready(0);
      expect(element('#vv-name').textContent).toBe('recovered.mov');
      expect(element('#vv-error').textContent).toBe('');
      expect(element<HTMLButtonElement>('#vv-play').disabled).toBe(false);
      expect(layer().state.source!.info!.frameCount).toBeGreaterThan(10);
      expect([layer().state.frames!.width, layer().state.frames!.height]).toEqual([320, 180]);
      const preview = element<HTMLVideoElement>('video');
      const localUrl = preview.src;
      expect(localUrl).toMatch(/^blob:/);
      expect(revoked).toHaveBeenCalled();

      change(element<HTMLInputElement>('#vv-frame'), '10');
      await ready(10);
      expect(element('#vv-frame-value').textContent).toBe('10');
      change(element<HTMLInputElement>('#vv-budget'), '1', 'change');
      change(element<HTMLInputElement>('#vv-trail'), '7');
      await vi.waitFor(
        () => expect(element('#vv-limit').textContent).toContain('requested 7-frame trail'),
        {timeout: 5000}
      );
      expect(element<HTMLInputElement>('#vv-trail').value).toBe('0');
      change(element<HTMLSelectElement>('#vv-resolution'), '128', 'change');
      await vi.waitFor(() => expect(root().dataset.frameCount).toBe('8'), {timeout: 5000});
      expect(element<HTMLInputElement>('#vv-trail').value).toBe('7');
      expect(element('#vv-limit').textContent).toBe('');
      expect(layer().state.frames!.width).toBe(128);
      change(element<HTMLSelectElement>('#vv-resolution'), '0', 'change');
      await vi.waitFor(() => expect(root().dataset.frameCount).toBe('1'), {timeout: 5000});
      expect(element('#vv-limit').textContent).toContain('requested 7-frame trail');
      change(element<HTMLSelectElement>('#vv-resolution'), '128', 'change');
      await vi.waitFor(() => expect(root().dataset.frameCount).toBe('8'), {timeout: 5000});
      change(element<HTMLInputElement>('#vv-static'), '1');
      change(element<HTMLInputElement>('#vv-spacing'), '0.067');
      change(element<HTMLInputElement>('#vv-opacity'), '1');
      change(element<HTMLInputElement>('#vv-threshold'), '0');
      expect(element('#vv-static-value').textContent).toBe('1.00 · Max');
      expect(element('#vv-spacing-value').textContent).toBe('0.067');
      expect(layer().props).toMatchObject({
        staticPixelRemoval: 1,
        frameSpacing: 0.067,
        frameOpacity: 1,
        luminanceThreshold: 0
      });
      // Keep the real decoder running through controller pointer events and its damping tail.
      change(element<HTMLInputElement>('#vv-static'), '0');
      const heldFrame = Number(root().dataset.frameReady);
      const cameraStarted = performance.now();
      element<HTMLButtonElement>('#vv-play').click();
      const canvas = currentDeck().getCanvas()!;
      const bounds = canvas.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const pointer = (type: string, clientX: number, buttons: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            button: 0,
            buttons,
            clientX,
            clientY: y
          })
        );
      pointer('pointerdown', x, 1);
      pointer('pointermove', x + 20, 1);
      pointer('pointermove', x + 120, 1);
      expect(element('#vv-play').textContent).toBe('Pause');
      await vi.waitFor(
        () => expect(currentDeck().props.viewState!.volume.rotationOrbit).not.toBe(-38),
        {timeout: 5000}
      );
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(Number(root().dataset.frameReady)).toBe(heldFrame);
      expect(layer().props.currentFrame).toBe(heldFrame);
      pointer('pointerup', x + 120, 0);
      await vi.waitFor(() => expect(Number(root().dataset.frameReady)).toBeGreaterThan(heldFrame), {
        timeout: 5000
      });
      const resumed = Number(root().dataset.frameReady);
      const elapsedFrames = Math.floor(((performance.now() - cameraStarted) / 1000) * 30);
      // Without subtracting the held interval this jump is approximately elapsedFrames.
      expect(resumed - heldFrame).toBeLessThan(elapsedFrames - 4);
      element<HTMLButtonElement>('#vv-play').click();
      expect(element('#vv-play').textContent).toBe('Play');
      const zoom = currentDeck().props.viewState!.volume.zoom;
      canvas.dispatchEvent(
        new WheelEvent('wheel', {bubbles: true, deltaY: -120, clientX: x, clientY: y})
      );
      await vi.waitFor(() => expect(currentDeck().props.viewState!.volume.zoom).not.toBe(zoom), {
        timeout: 5000
      });
      element<HTMLButtonElement>('[data-view="front"]').click();
      await vi.waitFor(
        () =>
          expect(Math.abs(currentDeck().props.viewState!.volume.rotationOrbit!)).toBeLessThan(0.02),
        {timeout: 5000}
      );
      change(element<HTMLInputElement>('#vv-frame'), '5');
      await ready(5);
      expect(element('#vv-frame-value').textContent).toBe('5');
      const previousSource = layer().state.source!;
      const previousFrames = layer().state.frames!;
      cleanup();
      cleanup = undefined;
      expect(parent.querySelector('.vv-demo')).toBeNull();
      expect(previousSource.destroyed).toBe(true);
      expect(previousFrames.texture.destroyed).toBe(true);
      expect(preview.hasAttribute('src')).toBe(false);
      expect(revoked).toHaveBeenCalledWith(localUrl);
      cleanup = mountVolumetricVideoExample(parent);
      await ready(88);
      expect(parent.querySelectorAll('.vv-demo')).toHaveLength(1);
      expect(element('#vv-error').textContent).toBe('');
      expect(layer().state.source).not.toBe(previousSource);
    } finally {
      cleanup?.();
      vi.restoreAllMocks();
      parent.remove();
    }
  }, 20000);
});
