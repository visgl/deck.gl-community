// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {CYCLE_SECONDS, getYear} from '../story/beats';
import {
  FLOOD,
  FLOOD_LEVEL_KEYS,
  getDaysUnderWater,
  getFlood,
  getFloodDay,
  getFloodTraces,
  getHighWater,
  getSecondUncovered,
  getSilt,
  getWaterLevel
} from '../story/flood';
import {BED_LAYOUT, getLandHeight} from '../story/land';
import {getStoryState} from '../story/story';

/** Every step of the cycle, in order. */
function getCycleSteps(step: number): number[] {
  const seconds: number[] = [];
  for (let t = 0; t < CYCLE_SECONDS; t += step) seconds.push(t);
  return seconds;
}

/** Days the level stands over `baseZ`, added up step by step over the year track. */
function countDaysUnderWater(baseZ: number): number {
  let days = 0;
  const step = 1 / 2000;
  for (let t = 0; t < CYCLE_SECONDS; t += step) {
    if (getWaterLevel(t + step / 2) > baseZ) days += (getYear(t + step) - getYear(t)) * 365.25;
  }
  return days;
}

describe('the flood level', () => {
  it('passes through the flood field’s levels', () => {
    for (const [second, level] of FLOOD_LEVEL_KEYS)
      expect(getWaterLevel(second)).toBeCloseTo(level, 9);
    expect(getWaterLevel(10)).toBe(BED_LAYOUT.ribbonZ);
    expect(getWaterLevel(33.6)).toBe(BED_LAYOUT.ribbonZ);
    expect(getWaterLevel(38.2)).toBeCloseTo(-0.45, 6);
    expect(getWaterLevel(42.2)).toBeCloseTo(BED_LAYOUT.bankTopZ, 6);
    expect(getWaterLevel(43)).toBeCloseTo(0, 6);
    expect(getWaterLevel(46.4)).toBeCloseTo(0.09, 6);
    expect(getWaterLevel(50.8)).toBe(BED_LAYOUT.ribbonZ);
    expect(getWaterLevel(60)).toBe(BED_LAYOUT.ribbonZ);
  });

  it('rises to its peak and goes down from it, and never past it', () => {
    let last = getWaterLevel(0);
    for (const t of getCycleSteps(0.01)) {
      const level = getWaterLevel(t);
      if (t <= FLOOD.peak[0]) expect(level).toBeGreaterThanOrEqual(last - 1e-12);
      if (t >= FLOOD.peak[1]) expect(level).toBeLessThanOrEqual(last + 1e-12);
      expect(level).toBeLessThanOrEqual(0.09 + 1e-12);
      expect(level).toBeGreaterThanOrEqual(BED_LAYOUT.ribbonZ - 1e-12);
      last = level;
    }
  });

  it('is the same at both ends of the cycle, so the swap shows nothing of it', () => {
    const end = getFlood(CYCLE_SECONDS - 1e-6, []);
    const start = getFlood(0, []);
    // Calm follows the wind and the rain, which the environment holds still across the swap.
    expect(end.level).toBe(start.level);
    expect(end.foam).toBe(start.foam);
    expect(end.floating).toBe(start.floating);
    expect(getStoryState(-0.01).ground.flood.level).toBe(getStoryState(0.01).ground.flood.level);
  });

  it('stands 9 cm at the trunks, more at the low east end, and 84 cm over the furrow floors', () => {
    const level = getWaterLevel(46.4);
    expect(level - getLandHeight(0, 0)).toBeCloseTo(0.09, 3);
    expect(level - getLandHeight(32, 0)).toBeGreaterThan(0.1);
    expect(level - BED_LAYOUT.floorZ).toBeCloseTo(0.84, 6);
  });
});

describe('the high-water mark', () => {
  it('is the highest level so far, and starts again at the swap', () => {
    let highest = -Infinity;
    for (const t of getCycleSteps(0.005)) {
      highest = Math.max(highest, getWaterLevel(t));
      expect(getHighWater(t)).toBeCloseTo(highest, 9);
      expect(getFlood(t, []).mark).toBe(getHighWater(t));
    }
    expect(getHighWater(52)).toBeCloseTo(0.09, 9);
    expect(getHighWater(0)).toBe(BED_LAYOUT.ribbonZ);
  });
});

describe('days under water', () => {
  it('gives the hero 2.7 days, and land 8 mm lower 3', () => {
    expect(getDaysUnderWater(getLandHeight(0, 0))).toBeCloseTo(2.7, 1);
    expect(getDaysUnderWater(-0.008)).toBeCloseTo(3, 1);
  });

  it('agrees with the days the level stands over a height, step by step', () => {
    for (const baseZ of [0.08, 0.05, 0.02, 0, -0.008, -0.02, -0.1, -0.4, -0.66]) {
      expect(getDaysUnderWater(baseZ)).toBeCloseTo(countDaysUnderWater(baseZ), 2);
    }
  });

  it('is longer the lower the land, nothing above the peak, and the whole cycle in a furrow', () => {
    let last = Infinity;
    for (let z = -0.67; z <= 0.1; z += 0.002) {
      const days = getDaysUnderWater(z);
      expect(days).toBeLessThanOrEqual(last + 1e-9);
      last = days;
    }
    expect(getDaysUnderWater(0.095)).toBe(0);
    expect(getDaysUnderWater(BED_LAYOUT.floorZ)).toBeCloseTo(
      (getYear(64) - getYear(0)) * 365.25,
      6
    );
  });

  it('leaves the bed crowns first, then the rows, then the shoulders', () => {
    const crown = getSecondUncovered(0.045);
    const rows = getSecondUncovered(0);
    const shoulders = getSecondUncovered(BED_LAYOUT.bankTopZ);
    expect(crown).toBeLessThan(rows);
    expect(rows).toBeLessThan(shoulders);
    expect(shoulders).toBeLessThan(FLOOD.drained);
    expect(getWaterLevel(rows)).toBeCloseTo(0, 3);
  });
});

describe('what the water carries', () => {
  it('carries nothing before it rises, and starts again from nothing at the swap', () => {
    expect(getFlood(20, []).drift).toEqual([0, 0]);
    expect(getFlood(FLOOD.rises, []).drift).toEqual([0, 0]);
    expect(getFlood(0, []).drift).toEqual([0, 0]);
  });

  it('drifts east once it runs over the bank tops, at the current’s speed and the wind’s', () => {
    const before = getFlood(42, []).drift;
    const after = getFlood(49.5, []).drift;
    // 0.15 m/s east for most of 7.5 s, give or take what the wind did.
    const blown = FLOOD.windage * FLOOD.airSpeed * 0.1 * 7.5;
    expect(after[0] - before[0]).toBeGreaterThan(0.15 * 6 - blown);
    expect(after[0] - before[0]).toBeLessThan(0.15 * 7.5 + blown);
  });

  it('moves smoothly, and holds once the water has gone', () => {
    let last = getFlood(FLOOD.rises, []).drift;
    for (let t = FLOOD.rises; t < CYCLE_SECONDS; t += 1 / 30) {
      const {drift} = getFlood(t, []);
      // At most 1.5 m/s, as fast as the wind at its strongest could take anything.
      expect(Math.hypot(drift[0] - last[0], drift[1] - last[1])).toBeLessThan(1.5 / 30);
      last = drift;
    }
    expect(getFlood(55, []).drift).toEqual(getFlood(FLOOD.drained + 0.5, []).drift);
  });

  it('floats litter through the flood, and has it gone once the water has', () => {
    expect(getFlood(30, []).floating).toBe(0);
    expect(getFlood(46.4, []).floating).toBe(1);
    expect(getFlood(FLOOD.drained, []).floating).toBe(0);
    expect(getFlood(60, []).floating).toBe(0);
  });

  it('passes the splashes through', () => {
    const splashes = [{position: [-14, 3.8, 0] as [number, number, number], age: 0.2, size: 3}];
    expect(getFlood(43.6, splashes).splashes).toBe(splashes);
  });

  it('is still without wind or rain', () => {
    for (const t of [1, 20, 57.6]) {
      const flood = getFlood(t, []);
      const state = getStoryState(t);
      if (state.weather.rain === 0 && state.wind.strength < 0.05)
        expect(flood.calm).toBeGreaterThan(0.99);
      expect(flood.foam).toBe(0);
    }
  });
});

describe('silt', () => {
  it('comes as the water goes, and is gone again by the swap', () => {
    expect(getSilt(46.4)).toBe(0);
    expect(getSilt(48.5)).toBeGreaterThan(0);
    expect(getSilt(50.2)).toBeGreaterThan(0.85);
    expect(getSilt(60)).toBe(0);
    expect(getSilt(0)).toBe(0);
  });

  it('is gone within weeks, before the replanting, as rain and grass take it off sand', () => {
    expect(getSilt(50.4)).toBeGreaterThan(0.85);
    expect(getSilt(50.8)).toBe(0);
    expect(getSilt(51.4)).toBe(0);
    expect(getSilt(52.4)).toBe(0);
  });

  it('leaves its other traces a little longer, and grown over before the replants go in', () => {
    expect(getFloodTraces(48.5)).toBe(1);
    expect(getFloodTraces(50.6)).toBe(1);
    expect(getFloodTraces(51)).toBeGreaterThan(0);
    expect(getFloodTraces(51)).toBeLessThan(1);
    expect(getFloodTraces(51.4)).toBe(0);
    expect(getFloodTraces(60)).toBe(0);
    // The land under the high-water mark tells where they are, and the mark starts again at the swap.
    expect(getHighWater(0)).toBe(BED_LAYOUT.ribbonZ);
  });

  it('counts days from the hurricane on the year track', () => {
    expect(getFloodDay(32.6)).toBeCloseTo(0, 9);
    expect(getFloodDay(48.4) - getFloodDay(40.3)).toBeCloseTo(1.8, 1);
    expect(getFloodDay(50.4) - getFloodDay(40.3)).toBeCloseTo(9.9, 1);
  });
});
