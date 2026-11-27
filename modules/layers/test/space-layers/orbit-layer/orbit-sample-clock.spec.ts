// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {OrbitSampleClock} from '../../../src/space-layers/orbit-layer/orbit-sample-clock';

const FRAME_MS = 1000 / 60;
const T0 = Date.UTC(2026, 10, 24);

/** Runs `frames` frames at `speed` simulated ms per wall ms. Returns the last result. */
function runFrames(
  clock: OrbitSampleClock,
  state: {time: number; wall: number},
  speed: number,
  frames: number
) {
  let result = {rate: 0, jumped: false};
  for (let i = 0; i < frames; i++) {
    state.time += speed * FRAME_MS;
    state.wall += FRAME_MS;
    result = clock.update(state.time, state.wall);
  }
  return result;
}

describe('OrbitSampleClock', () => {
  it('estimates the clock rate from currentTime updates', () => {
    const clock = new OrbitSampleClock(1000);
    const state = {time: T0, wall: 0};
    clock.update(state.time, state.wall);
    const result = runFrames(clock, state, 60, 5);
    expect(result.jumped).toBe(false);
    expect(Math.abs(result.rate - 60) / 60).toBeLessThan(0.01);
    expect(clock.getNextSampleTime(state.time)).toBeCloseTo(state.time + result.rate * 1000, 6);
  });

  it('a paused clock requests no samples', () => {
    const clock = new OrbitSampleClock(1000);
    let result = {rate: 1, jumped: false};
    for (let i = 0; i < 10; i++) {
      result = clock.update(T0, i * FRAME_MS);
    }
    expect(result.rate).toBe(0);
    expect(clock.getNextSampleTime(T0)).toBe(T0);
  });

  it('a time jump resets the samples', () => {
    const clock = new OrbitSampleClock(1000);
    const state = {time: T0, wall: 0};
    clock.update(state.time, state.wall);
    runFrames(clock, state, 1, 20);
    state.time -= 10 * 60 * 1000;
    state.wall += FRAME_MS;
    expect(clock.update(state.time, state.wall).jumped).toBe(true);
    runFrames(clock, state, 1, 5);
    state.time += 24 * 3600 * 1000;
    state.wall += FRAME_MS;
    expect(clock.update(state.time, state.wall).jumped).toBe(true);
  });

  it('a speed change reports at most one jump, then the rate converges', () => {
    const clock = new OrbitSampleClock(1000);
    const state = {time: T0, wall: 0};
    clock.update(state.time, state.wall);
    runFrames(clock, state, 1, 30);
    let jumps = 0;
    let rate = 0;
    for (let i = 0; i < 10; i++) {
      state.time += 60 * FRAME_MS;
      state.wall += FRAME_MS;
      const result = clock.update(state.time, state.wall);
      jumps += result.jumped ? 1 : 0;
      rate = result.rate;
    }
    expect(jumps).toBeLessThanOrEqual(1);
    expect(Math.abs(rate - 60) / 60).toBeLessThan(0.05);
  });

  describe('at 5 Hz sampling', () => {
    function countJumps(
      clock: OrbitSampleClock,
      state: {time: number; wall: number},
      speed: number,
      frames: number
    ) {
      let jumps = 0;
      let rate = 0;
      for (let i = 0; i < frames; i++) {
        state.time += speed * FRAME_MS;
        state.wall += FRAME_MS;
        const result = clock.update(state.time, state.wall);
        if (result.jumped) jumps++;
        rate = result.rate;
      }
      return {jumps, rate};
    }

    it('a speed change from 1x to 60x reports at most one jump', () => {
      const clock = new OrbitSampleClock(200);
      const state = {time: T0, wall: 0};
      clock.update(state.time, state.wall);
      countJumps(clock, state, 1, 30);
      const {jumps, rate} = countJumps(clock, state, 60, 10);
      expect(jumps).toBeLessThanOrEqual(1);
      expect(Math.abs(rate - 60) / 60).toBeLessThan(0.05);
    });

    it.each([60, 3600])('%dx from the start gives at most one jump', speed => {
      const clock = new OrbitSampleClock(200);
      const state = {time: T0, wall: 0};
      clock.update(state.time, state.wall);
      const {jumps, rate} = countJumps(clock, state, speed, 20);
      expect(jumps).toBeLessThanOrEqual(1);
      expect(Math.abs(rate - speed) / speed).toBeLessThan(0.05);
    });

    it('detects a +10 min step at 1x and recovers', () => {
      const clock = new OrbitSampleClock(200);
      const state = {time: T0, wall: 0};
      clock.update(state.time, state.wall);
      countJumps(clock, state, 1, 20);
      state.time += 600000;
      state.wall += FRAME_MS;
      expect(clock.update(state.time, state.wall).jumped).toBe(true);
      const {jumps, rate} = countJumps(clock, state, 1, 10);
      expect(jumps).toBeLessThanOrEqual(1);
      expect(Math.abs(rate - 1)).toBeLessThan(0.05);
    });

    it.each([-600000, 86400000])('detects a step of %d ms at 1x and recovers', step => {
      const clock = new OrbitSampleClock(200);
      const state = {time: T0, wall: 0};
      clock.update(state.time, state.wall);
      countJumps(clock, state, 1, 20);
      state.time += step;
      state.wall += FRAME_MS;
      expect(clock.update(state.time, state.wall).jumped).toBe(true);
      const {jumps, rate} = countJumps(clock, state, 1, 10);
      expect(jumps).toBeLessThanOrEqual(1);
      expect(Math.abs(rate - 1)).toBeLessThan(0.05);
    });

    it('a paused clock reports no jumps and requests no samples', () => {
      const clock = new OrbitSampleClock(200);
      let jumps = 0;
      let rate = 1;
      for (let i = 0; i < 10; i++) {
        const result = clock.update(T0, i * FRAME_MS);
        jumps += result.jumped ? 1 : 0;
        rate = result.rate;
      }
      expect(jumps).toBe(0);
      expect(rate).toBe(0);
      expect(clock.getNextSampleTime(T0)).toBe(T0);
    });
  });
});
