// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {mountCitrusLabExample} from './citrus';
import {getTourFrame} from './tour';

describe('Citrus lab', () => {
  it('changes actual tree pixels through crown controls, winter, crops and shadow toggles', async () => {
    const container = document.createElement('div');
    container.style.cssText = 'width:1000px;height:800px';
    document.body.append(container);
    let pixels: Uint8Array | undefined,
      renders = 0;
    const errors: string[] = [];
    const original = Deck.prototype.setProps;
    const spy = vi.spyOn(Deck.prototype, 'setProps').mockImplementation(function (props) {
      const next = {...props};
      if (props.onAfterRender) {
        const callback = props.onAfterRender;
        next.onAfterRender = context => {
          callback(context);
          const gl = context.gl;
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
          renders++;
        };
      }
      if (props.onError) {
        const callback = props.onError;
        next.onError = error => {
          errors.push(error.message);
          callback(error);
        };
      }
      return original.call(this, next);
    });
    const cleanup = mountCitrusLabExample(container);
    let restoreClock = () => {};
    const select = (label: string, value: string) => {
      const element = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
      element.value = value;
      element.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const checkbox = (label: string, checked: boolean) => {
      const element = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
      element.checked = checked;
      element.dispatchEvent(new Event('change', {bubbles: true}));
    };
    const capture = async (action: () => void) => {
      const before = renders;
      action();
      await expect.poll(() => renders, {timeout: 15000}).toBeGreaterThan(before);
      expect(errors).toEqual([]);
      return new Uint8Array(pixels!);
    };
    const changed = (a: Uint8Array, b: Uint8Array) => {
      let count = 0;
      for (let i = 0; i < a.length; i += 4)
        if (
          Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) >
          20
        )
          count++;
      return count;
    };
    try {
      await expect.poll(() => renders, {timeout: 15000}).toBeGreaterThan(0);
      checkbox('Cycle light and seasons', false);
      checkbox('Wind', false);
      const cycledDirection = [
        ...(spy.mock.instances.at(-1) as Deck).props.effects![0].props.key.direction
      ];
      checkbox('Shadows', false);
      checkbox('Shadows', true);
      expect((spy.mock.instances.at(-1) as Deck).props.effects![0].props.key.direction).toEqual(
        cycledDirection
      );
      const sun = container.querySelector<HTMLInputElement>('[aria-label="Sun angle"]')!;
      sun.value = '137';
      sun.dispatchEvent(new Event('input', {bubbles: true}));
      const beforeShadowDirection = [
        ...(spy.mock.instances.at(-1) as Deck).props.effects![0].props.key.direction
      ];
      expect(beforeShadowDirection).toEqual(getTourFrame((137 / 360) * 32).direction);
      checkbox('Shadows', false);
      checkbox('Shadows', true);
      expect((spy.mock.instances.at(-1) as Deck).props.effects![0].props.key.direction).toEqual(
        beforeShadowDirection
      );

      const summer = await capture(() => select('Season', 'summer'));
      const bare = await capture(() => select('Inspect tree', 'branches'));
      expect(changed(summer, bare)).toBeGreaterThan(1000);
      const winter = await capture(() => {
        select('Inspect tree', 'crown');
        select('Season', 'winter');
      });
      expect(changed(winter, bare)).toBeGreaterThan(1000); // Citrus never loses its foliage in winter.
      const noShadow = await capture(() => checkbox('Shadows', false));
      expect(changed(winter, noShadow)).toBeGreaterThan(100);
      const bloom = await capture(() => select('Crop stage', 'bloom'));
      expect(changed(noShadow, bloom)).toBeGreaterThan(10);
      const oldRenders = renders;
      const density = container.querySelector<HTMLInputElement>('[aria-label="Leaf density"]')!;
      density.value = '0.25';
      density.dispatchEvent(new Event('input', {bubbles: true}));
      await expect.poll(() => renders, {timeout: 15000}).toBeGreaterThan(oldRenders);
      await expect.poll(() => changed(bloom, pixels!), {timeout: 15000}).toBeGreaterThan(100);
      await capture(() => select('Tree form', 'patio'));
      expect(
        container.querySelector<HTMLSelectElement>('[aria-label="Citrus variety"]')!.value
      ).toBe('lemon');
      await capture(() => select('Tree form', 'spreading'));
      expect(
        container.querySelector<HTMLSelectElement>('[aria-label="Citrus variety"]')!.value
      ).toBe('lime');
      // Embedded short panels retain a drawable scene and keep the footer inside the host.
      container.style.cssText = 'width:480px;height:340px';
      await expect
        .poll(() => container.querySelector('canvas')!.getBoundingClientRect().height, {
          timeout: 15000
        })
        .toBeGreaterThan(40);
      const hostBounds = container.getBoundingClientRect();
      const rootBounds = container.firstElementChild!.getBoundingClientRect();
      expect(rootBounds.height).toBeLessThanOrEqual(hostBounds.height + 1);
      expect(container.querySelector('footer')!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        hostBounds.bottom + 1
      );
      // Control elapsed frame time after pixel checks. Paused intervals must never enter
      // the tour clock, and enabling cycling must continue from the manual sunlight phase.
      const queue: FrameRequestCallback[] = [];
      const realRequest = window.requestAnimationFrame.bind(window);
      const clock = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        queue.push(callback);
        return queue.length;
      });
      restoreClock = () => clock.mockRestore();
      await new Promise<void>(resolve => realRequest(() => realRequest(() => resolve())));
      const advance = (now: number) => queue.splice(0).forEach(callback => callback(now));
      const direction = () =>
        (spy.mock.instances.at(-1) as Deck).props.effects![0].props.key.direction;
      sun.value = '180';
      sun.dispatchEvent(new Event('input', {bubbles: true}));
      checkbox('Cycle light and seasons', true);
      advance(10000);
      expect(direction()).toEqual(getTourFrame(16).direction);
      advance(11000);
      expect(direction()).toEqual(getTourFrame(17).direction);
      checkbox('Cycle light and seasons', false);
      advance(21000);
      checkbox('Cycle light and seasons', true);
      advance(100000);
      expect(direction()).toEqual(getTourFrame(17).direction);
      advance(101000);
      expect(direction()).toEqual(getTourFrame(18).direction);
      expect(errors).toEqual([]);
    } finally {
      cleanup();
      restoreClock();
      spy.mockRestore();
      container.remove();
    }
  }, 45000);
});
