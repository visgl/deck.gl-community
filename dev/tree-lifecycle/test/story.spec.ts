// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitView} from '@deck.gl/core';
import {type CropConfig, getTreeWindGust} from '@deck.gl-community/layers';
import {describe, expect, it, vi} from 'vitest';
import {
  getFocusPull,
  getLensSamples,
  getMotionProbe,
  getMotionSamples,
  getShutterTravel
} from '../stage/accumulator';
import {
  getCrownFraction,
  getHeightFraction,
  getSeamSeconds,
  getSeason,
  getSecondOfYear,
  getYear,
  HURRICANE,
  LOOP
} from '../story/beats';
import {getCameraEye, getCameraForward, getOrbitViewProps} from '../story/camera';
import {GUST_LOCK} from '../story/environment';
import {
  GROVE_LAYOUT,
  GROVE_PLAN,
  type GrovePlanRow,
  MAGIC_TABLE,
  REPLANT_TABLE
} from '../story/grove';
import {getLandHeight} from '../story/land';
import {
  MICROJET_TABLE,
  NET_TABLE,
  ORANGE_TABLE,
  PLANTING_TABLE,
  POT_TABLE,
  SEED_TABLE
} from '../story/props';
import {BEAT_TABLE, CYCLE_SECONDS, getStoryState} from '../story/story';
import {getLength} from '../story/story-math';
import type {StoryCamera, StoryState, Vec3} from '../story/story-types';
import {CAPTION_TABLE, FLAG_TABLE, getReadout, YIELD_TABLE} from '../story/yield';
import {
  getTreeCrownFraction,
  getTreeHeightFraction
} from '../../../modules/layers/src/tree-layer/tree-photoreal-layout';
import {TREE_WIND_STRONG_FROM} from '../../../modules/layers/src/tree-layer/tree-wind';

// Many of these walk every frame of the cycle, and the machine may be busy.
vi.setConfig({testTimeout: 120000});

const LANDSCAPE = {aspect: 16 / 9};
const PORTRAIT = {aspect: 9 / 16};
const FRAME_RATE = 30;
const FRAMES = CYCLE_SECONDS * FRAME_RATE;
/** The cycle's last second, held on Year 30, just before the swap. */
const END = CYCLE_SECONDS - 0.1;

/**
 * Every frame of the cycle's state in turn, from the swap on. `getStoryState` rewrites trees in
 * place, so read them inside.
 */
function forEachFrame(
  visit: (state: StoryState, t: number) => void,
  options: {aspect: number} = LANDSCAPE
): void {
  for (let frame = 0; frame < FRAMES; frame++) {
    const t = frame / FRAME_RATE;
    visit(getStoryState(t, options), t);
  }
}

/** Whether the take rides the falling orange at `t`, on keys of seam seconds. */
function isRidingFruit(t: number): boolean {
  const seam = getSeamSeconds(t);
  return seam >= LOOP.stillAir[0] && seam <= LOOP.stillAir[1];
}

/** Where a point falls in a frame: -1 to 1 across and up, and how far ahead of the eye. */
function project(camera: StoryCamera, aspect: number, point: Vec3) {
  const eye = getCameraEye(camera);
  const forward = getCameraForward(camera);
  const flat = Math.hypot(forward[0], forward[1]);
  const right: Vec3 = [forward[1] / flat, -forward[0] / flat, 0];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
  const tangent = Math.tan((camera.fovy / 2) * (Math.PI / 180));
  return {
    x: (d[0] * right[0] + d[1] * right[1]) / (depth * tangent * aspect),
    y: (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / (depth * tangent),
    depth
  };
}

/** Degrees from the camera's view to the sun, around the horizon, and the sun's elevation. */
function getSunAngles(state: StoryState): {off: number; elevation: number} {
  const sun = state.sky.sunDirection;
  const bearing = (Math.atan2(sun[0], sun[1]) * 180) / Math.PI;
  return {
    off: ((bearing - state.camera.orbit + 540) % 360) - 180,
    elevation: (Math.asin(sun[2]) * 180) / Math.PI
  };
}

function findNonFinite(value: unknown, path: string, found: string[]): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) found.push(`${path}=${value}`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => findNonFinite(item, `${path}[${index}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) findNonFinite(item, `${path}.${key}`, found);
  }
}

function getTreeHeight(tree: StoryState['trees'][number]): number {
  return (tree.height as number) * getHeightFraction(tree.growth as number);
}

describe('getStoryState', () => {
  it('is pure: the same t and options give the same state, whatever came before', () => {
    for (const t of [0, 1.09, 4.5, 10, 20, 29.4, 33.3, 36.2, 39.2, 42.2, 46.4, 50.2, 57.6, 61.3]) {
      const first = structuredClone(getStoryState(t, LANDSCAPE));
      getStoryState(t * 0.37 + 3, PORTRAIT);
      getStoryState(40, LANDSCAPE);
      expect(getStoryState(t, LANDSCAPE)).toEqual(first);
    }
  });

  it('gives the same state when frames are visited backward', () => {
    const forward = new Map<number, unknown>();
    for (let t = 30; t <= 60; t += 5) forward.set(t, structuredClone(getStoryState(t, LANDSCAPE)));
    for (let t = 60; t >= 30; t -= 5) expect(getStoryState(t, LANDSCAPE)).toEqual(forward.get(t));
  });

  it('has no NaN or Infinity anywhere, in any frame, at any aspect', () => {
    for (const options of [LANDSCAPE, PORTRAIT, {aspect: 1}]) {
      const found: string[] = [];
      forEachFrame((state, t) => findNonFinite(state, `t=${t}`, found), options);
      expect(found.slice(0, 10)).toEqual([]);
    }
  });

  it('never clamps: any time is taken mod the cycle', () => {
    expect(getStoryState(CYCLE_SECONDS, LANDSCAPE).t).toBe(0);
    expect(getStoryState(-1, LANDSCAPE).t).toBeCloseTo(CYCLE_SECONDS - 1, 9);
    expect(getStoryState(500, LANDSCAPE).t).toBeCloseTo(500 % CYCLE_SECONDS, 9);
    const once = structuredClone(getStoryState(20.5, PORTRAIT));
    expect(getStoryState(20.5 + 3 * CYCLE_SECONDS, PORTRAIT)).toEqual(once);
    // The export's second pass, past the end of the first cycle, is the same cycle.
    const wrapped = structuredClone(getStoryState(LOOP.fileStart, PORTRAIT));
    expect(getStoryState(LOOP.fileStart + CYCLE_SECONDS, PORTRAIT)).toEqual(wrapped);
  });

  it('composes from the world asked for only inside the rind', () => {
    const covered = (LOOP.cover[0] / 2 + CYCLE_SECONDS) % CYCLE_SECONDS;
    expect(getStoryState(covered, {...PORTRAIT, world: 'start'}).cycle.world).toBe('start');
    expect(getStoryState(covered, PORTRAIT).cycle.world).toBe('end');
    expect(getStoryState(covered, PORTRAIT).cycle.cover).toBe(1);
    expect(getStoryState(60, {...PORTRAIT, world: 'start'}).cycle.world).toBe('end');
    expect(getStoryState(60, PORTRAIT).cycle.cover).toBe(0);
  });

  it('keeps the identity of the rows from frame to frame', () => {
    const {trees} = getStoryState(1, LANDSCAPE);
    const rows = [...trees];
    const crops = trees.map(tree => tree.crop);
    const later = getStoryState(40, LANDSCAPE);
    expect(later.trees).toBe(trees);
    later.trees.forEach((tree, index) => {
      expect(tree).toBe(rows[index]);
      expect(tree.crop).toBe(crops[index]);
    });
  });
});

describe('time', () => {
  it('has year that never goes back in the cycle, reaching 30 and starting again at the swap', () => {
    let last = -1;
    forEachFrame(state => {
      expect(state.year).toBeGreaterThanOrEqual(last);
      last = state.year;
    });
    expect(getYear(0)).toBe(0);
    expect(getYear(57.4)).toBe(30);
    expect(getYear(END)).toBe(30);
    expect(getYear(CYCLE_SECONDS)).toBe(0);
  });

  it('lands on the beat table, with beats in order and progress within each', () => {
    for (let index = 1; index < BEAT_TABLE.length; index++) {
      expect(BEAT_TABLE[index].start).toBeGreaterThan(BEAT_TABLE[index - 1].start);
      expect(BEAT_TABLE[index].year).toBeGreaterThanOrEqual(BEAT_TABLE[index - 1].year);
    }
    for (const {id, start, year} of BEAT_TABLE) {
      const state = getStoryState(start, LANDSCAPE);
      expect(state.beat).toBe(id);
      expect(state.beatProgress).toBeCloseTo(0, 6);
      expect(state.year).toBeCloseTo(year, 6);
    }
    let lastBeat = -1;
    forEachFrame(state => {
      const index = BEAT_TABLE.findIndex(beat => beat.id === state.beat);
      expect(index).toBeGreaterThanOrEqual(lastBeat);
      lastBeat = index;
      expect(state.beatProgress).toBeGreaterThanOrEqual(0);
      expect(state.beatProgress).toBeLessThanOrEqual(1);
    });
  });

  it('reads days per second early, years per second later, and nearly stops in the storm', () => {
    expect((getYear(5) - getYear(4)) * 365).toBeLessThan(1);
    expect(getYear(24) - getYear(23)).toBeGreaterThan(0.5);
    expect(getYear(HURRICANE.clearing) - getYear(HURRICANE.arrive)).toBeLessThan(0.002);
    expect(getYear(55) - getYear(54)).toBeGreaterThan(1.5);
  });

  it('plays year 6 on one day, then gives each later year of seasons less time', () => {
    expect(getSecondOfYear(7) - getSecondOfYear(6)).toBeCloseTo(3.4, 3);
    let last = Infinity;
    for (let year = 7; year < 14; year++) {
      const seconds = getSecondOfYear(year + 1) - getSecondOfYear(year);
      expect(seconds).toBeLessThan(last);
      last = seconds;
    }
    expect(last).toBeLessThan(0.5);
  });

  it('puts September at the hurricane and March at the magic and the finale', () => {
    expect(getSeason(getYear(36.2))).toBeCloseTo(0.5, 1);
    expect(getSeason(getYear(27))).toBeCloseTo(0, 5);
    expect(getSeason(getYear(57.4))).toBeCloseTo(0, 9);
  });
});

describe('the grove plan', () => {
  const grove = GROVE_PLAN.filter(row => row.kind === 'grove');
  const fallers = GROVE_PLAN.filter(
    (row): row is GrovePlanRow & {fall: NonNullable<GrovePlanRow['fall']>} => Boolean(row.fall)
  );
  const replants = GROVE_PLAN.filter(row => row.kind === 'replant');

  it('has about a hundred positions, hero first, in a fixed order', () => {
    expect(GROVE_PLAN[0].kind).toBe('hero');
    expect(GROVE_PLAN[0].position).toEqual([0, 0, 0]);
    expect(grove.length).toBeGreaterThanOrEqual(90);
    expect(grove.length).toBeLessThanOrEqual(120);
    GROVE_PLAN.forEach((row, index) => expect(row.index).toBe(index));
    const kinds = GROVE_PLAN.map(row => row.kind);
    expect(kinds.lastIndexOf('grove')).toBeLessThan(kinds.indexOf('replant'));
  });

  it('gives the same row count and order in every frame', () => {
    const count = GROVE_PLAN.length;
    const first = getStoryState(0, LANDSCAPE).trees.map(tree => [...(tree.position as Vec3)]);
    forEachFrame(state => {
      expect(state.trees.length).toBe(count);
      expect((state.trees[0].position as Vec3).slice(0, 2)).toEqual([0, 0]);
    });
    getStoryState(50, LANDSCAPE).trees.forEach((tree, index) => {
      expect(tree.position).toEqual(first[index]);
    });
  });

  it('spaces rows 7.6 m apart and trees about 6 m along them, with room around the hero', () => {
    expect(GROVE_LAYOUT.rowSpacing).toBe(7.6);
    expect(GROVE_LAYOUT.treeSpacing).toBe(6);
    const others = grove.map(row => Math.hypot(row.position[0], row.position[1]));
    expect(Math.min(...others)).toBeGreaterThan(8);
    for (const row of grove) {
      for (const other of grove) {
        if (other !== row) {
          const apart = Math.hypot(
            other.position[0] - row.position[0],
            other.position[1] - row.position[1]
          );
          expect(apart).toBeGreaterThan(5.5);
        }
      }
    }
  });

  it('tells the ground the extent of the block of real trees', () => {
    const {extent, spacing, treeSpacing} = getStoryState(36, LANDSCAPE).ground.rows;
    expect(spacing).toBe(GROVE_LAYOUT.rowSpacing);
    expect(treeSpacing).toBe(GROVE_LAYOUT.treeSpacing);
    for (const row of grove) {
      expect(Math.abs(row.position[0])).toBeLessThan(extent[0]);
      expect(Math.abs(row.position[1])).toBeLessThan(extent[1]);
    }
  });

  it('has a ring that reaches trees in order of distance, in grove-magic', () => {
    const sorted = [...grove].sort(
      (a, b) => Math.hypot(a.position[0], a.position[1]) - Math.hypot(b.position[0], b.position[1])
    );
    expect(sorted[0].arrival).toBeLessThan(sorted[sorted.length - 1].arrival);
    const delays = grove.map(row => row.arrival);
    expect(Math.min(...delays)).toBeGreaterThan(MAGIC_TABLE.ringRadiusKeys[0][0]);
    expect(Math.max(...delays)).toBeLessThan(31.9);
  });

  it('fells about a fifth of the grove, never the hero', () => {
    expect(fallers.length / grove.length).toBeGreaterThan(0.15);
    expect(fallers.length / grove.length).toBeLessThan(0.26);
    expect(GROVE_PLAN[0].fall).toBeNull();
    expect(fallers.some(row => row.fall.wall === 1)).toBe(true);
    expect(fallers.some(row => row.fall.wall === 2)).toBe(true);
  });

  it('fells each wall with its wind, in waves that run downwind, before and after the eye', () => {
    const getOff = (bearing: number, wind: number) =>
      Math.abs(((bearing - wind + 540) % 360) - 180);
    for (const {fall} of fallers) {
      const wind = HURRICANE.firstWallBearing + (fall.wall === 1 ? 0 : 180);
      expect(getOff(fall.bearing, wind)).toBeLessThanOrEqual(21);
      expect(fall.seconds).toBeGreaterThanOrEqual(1.8);
      expect(fall.seconds).toBeLessThanOrEqual(4);
      if (fall.wall === 1) {
        expect(fall.start).toBeGreaterThanOrEqual(HURRICANE.firstWall);
        expect(fall.start).toBeLessThan(HURRICANE.eyeOpen);
      } else {
        expect(fall.start).toBeGreaterThan(HURRICANE.eyeClose);
        expect(fall.start + fall.seconds).toBeLessThan(45.6);
      }
    }
    // The first wall blows toward the north, so its swaths start in the south.
    const firstWall = fallers.filter(row => row.fall.wall === 1);
    const north = firstWall.filter(row => row.position[1] > 15);
    const south = firstWall.filter(row => row.position[1] < -15);
    const mean = (rows: typeof fallers) =>
      rows.reduce((sum, row) => sum + row.fall.start, 0) / rows.length;
    expect(mean(south)).toBeLessThan(mean(north));
  });

  it('gives every wreck a replant at exactly its position, arriving as it is gone', () => {
    const dead = GROVE_PLAN.filter(row => row.kind === 'grove' && row.replacement !== null);
    expect(replants.length).toBe(dead.length);
    expect(replants.length).toBeGreaterThanOrEqual(fallers.length);
    for (const row of dead) {
      const replant = GROVE_PLAN[row.replacement as number];
      expect(replant.kind).toBe('replant');
      expect(replant.replaces).toBe(row.index);
      expect(replant.position).toEqual(row.position);
      if (row.fall) expect(replant.arrival).toBeCloseTo(row.fall.decayEnd, 6);
      expect(replant.arrival).toBeGreaterThanOrEqual(REPLANT_TABLE.starts[0] - 0.3);
      expect(replant.arrival).toBeLessThanOrEqual(REPLANT_TABLE.starts[1] + 0.3);
    }
  });

  it('uses six seeds across the grove and its own for the hero', () => {
    const seeds = new Set(grove.map(row => row.seed));
    expect(seeds.size).toBe(6);
    expect(seeds.has(GROVE_PLAN[0].seed)).toBe(false);
  });
});

describe('trees', () => {
  const HERO_GROWTH: [number, number][] = [
    [0.25, 0.02],
    [1, 0.075],
    [1.5, 0.095],
    [3, 0.17],
    [6, 0.32],
    [15, 0.6],
    [21, 0.75],
    [30, 0.97]
  ];

  it('keeps the growth curve of the story', () => {
    for (const [year, growth] of HERO_GROWTH) {
      const state = getStoryState(getSecondOfYear(year), LANDSCAPE);
      expect(state.trees[0].growth).toBeCloseTo(growth, 3);
    }
    expect(getStoryState(0, LANDSCAPE).trees[0].growth).toBe(0);
  });

  it('has the same growth fractions as TreeLayer', () => {
    for (let growth = 0; growth <= 1; growth += 0.05) {
      expect(getHeightFraction(growth)).toBeCloseTo(getTreeHeightFraction(growth), 10);
      expect(getCrownFraction(growth)).toBeCloseTo(getTreeCrownFraction(growth), 10);
    }
  });

  it('grows the hero, monotonically, about a metre tall by year 1 and nine by the end', () => {
    let last = -1;
    forEachFrame(state => {
      expect(state.trees[0].growth).toBeGreaterThanOrEqual(last);
      last = state.trees[0].growth as number;
    });
    expect(getTreeHeight(getStoryState(getSecondOfYear(1), LANDSCAPE).trees[0])).toBeCloseTo(
      1.05,
      1
    );
    expect(getTreeHeight(getStoryState(END, LANDSCAPE).trees[0])).toBeCloseTo(8.97, 1);
  });

  it('keeps the hero the tallest from year 15 on', () => {
    const from = getSecondOfYear(15);
    forEachFrame((state, t) => {
      if (t >= from) {
        const hero = getTreeHeight(state.trees[0]);
        for (let index = 1; index < state.trees.length; index++) {
          expect(getTreeHeight(state.trees[index])).toBeLessThan(hero);
        }
      }
    });
  });

  it('puts survivors near 5.9 m and replants near 3.6 m at year 30', () => {
    const {trees} = getStoryState(END, LANDSCAPE);
    const survivors = GROVE_PLAN.filter(
      row => row.kind === 'grove' && row.replacement === null
    ).map(row => getTreeHeight(trees[row.index]));
    const replants = GROVE_PLAN.filter(row => row.kind === 'replant').map(row =>
      getTreeHeight(trees[row.index])
    );
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean(survivors)).toBeGreaterThan(5.5);
    expect(mean(survivors)).toBeLessThan(6.3);
    expect(mean(replants)).toBeGreaterThan(3.2);
    expect(mean(replants)).toBeLessThan(4.1);
  });

  it('has no grove tree before the ring, and all of them rising in seconds behind it', () => {
    const before = getStoryState(MAGIC_TABLE.ringRadiusKeys[0][0] - 0.1, LANDSCAPE).trees;
    expect(before.filter(tree => (tree.growth as number) > 0).length).toBe(1);
    for (const row of GROVE_PLAN) {
      if (row.kind === 'grove') {
        const state = getStoryState(row.arrival + MAGIC_TABLE.riseSeconds + 0.2, LANDSCAPE);
        expect(state.trees[row.index].growth).toBeGreaterThan(0.35);
        expect(getStoryState(row.arrival - 0.01, LANDSCAPE).trees[row.index].growth).toBe(0);
      }
    }
  });

  it('lays a faller down to about 86 degrees, eased, then rots it flat before its replant', () => {
    const row = GROVE_PLAN.find(item => item.fall) as GrovePlanRow;
    const fall = row.fall as NonNullable<GrovePlanRow['fall']>;
    const leanAt = (t: number) =>
      (getStoryState(t, LANDSCAPE).trees[row.index].lean as number[])[0];
    expect(leanAt(fall.start - 0.01)).toBeLessThan(12);
    expect(leanAt(fall.start + fall.seconds * 0.5)).toBeLessThan(40);
    expect(leanAt(fall.start + fall.seconds)).toBeCloseTo(86, 0);
    expect(
      (getStoryState(fall.start + 1, LANDSCAPE).trees[row.index].lean as number[])[1]
    ).toBeCloseTo(fall.bearing, 6);
    const late = getStoryState(fall.decayEnd - 0.01, LANDSCAPE).trees[row.index];
    expect(late.decay).toBeGreaterThan(0.98);
    expect(late.damage).toBeGreaterThan(0.85);
    expect(getStoryState(fall.decayEnd + 0.01, LANDSCAPE).trees[row.index].growth).toBe(0);
  });

  it('never lets lean, foliage or decay jump', () => {
    let last: {lean: number; foliage: number; decay: number}[] | null = null;
    forEachFrame((state, t) => {
      const now = state.trees.map(tree => ({
        lean: (tree.lean as number[])[0],
        foliage: tree.foliage as number,
        decay: tree.decay as number
      }));
      if (last && t > MAGIC_TABLE.ringRadiusKeys[0][0] + 1) {
        now.forEach((value, index) => {
          const before = (last as typeof now)[index];
          // A row that is not there may change anything.
          if ((state.trees[index].growth as number) > 0) {
            expect(Math.abs(value.lean - before.lean)).toBeLessThan(5);
            expect(Math.abs(value.foliage - before.foliage)).toBeLessThan(0.1);
            expect(Math.abs(value.decay - before.decay)).toBeLessThan(0.08);
          }
        });
      }
      last = now;
    });
  });

  it('strips the hero of limbs and most leaves, and it stands and flushes first', () => {
    const during = getStoryState(HURRICANE.clearing, LANDSCAPE).trees[0];
    expect(during.foliage).toBeLessThan(0.3);
    expect(during.damage).toBeGreaterThan(0.3);
    expect((during.lean as number[])[0]).toBe(0);
    forEachFrame(state => expect((state.trees[0].lean as number[])[0]).toBe(0));
    const firstFlush = (index: number) => {
      for (let t = 45; t < 56; t += 0.1) {
        if ((getStoryState(t, LANDSCAPE).trees[index].flush as number) > 0.2) return t;
      }
      return Infinity;
    };
    const heroFlush = firstFlush(0);
    const survivors = GROVE_PLAN.filter(
      row => row.kind === 'grove' && row.replacement === null
    ).slice(0, 12);
    for (const row of survivors) expect(firstFlush(row.index)).toBeGreaterThan(heroFlush);
    const recovered = getStoryState(END, LANDSCAPE).trees[0];
    expect(recovered.foliage).toBeCloseTo(1, 2);
    expect(recovered.health).toBeCloseTo(1, 2);
  });

  it('strips survivors of fruit and many leaves, not all of them', () => {
    const row = GROVE_PLAN.find(
      item => item.kind === 'grove' && item.replacement === null
    ) as GrovePlanRow;
    expect(getStoryState(HURRICANE.arrive, LANDSCAPE).trees[row.index].foliage).toBeCloseTo(1, 3);
    const after = getStoryState(44.5, LANDSCAPE).trees[row.index];
    expect(after.foliage).toBeLessThan(0.75);
    expect(after.foliage).toBeGreaterThan(0.2);
    const crop = after.crop as CropConfig[];
    expect(crop[1].fallen).toBeGreaterThan(0.4);
  });
});

describe('the crop', () => {
  const heroCrop = (t: number) => {
    const crop = getStoryState(t, LANDSCAPE).trees[0].crop as CropConfig[];
    return {blossom: crop[0], fruit: crop[1]};
  };

  it('has two slots, blossom then fruit, for every tree in every frame', () => {
    forEachFrame(state => {
      for (const tree of state.trees) {
        const crop = tree.crop as CropConfig[];
        expect(crop.map(slot => slot.kind)).toEqual(['flower', 'fruit']);
      }
    });
  });

  it('has no blossom before about year 3', () => {
    forEachFrame(state => {
      if (state.year < 2.9) {
        const crop = state.trees[0].crop as CropConfig[];
        expect(crop[0].count).toBe(0);
        expect(crop[1].count).toBe(0);
      }
    });
    expect(heroCrop(getSecondOfYear(3.1)).blossom.count).toBeGreaterThan(50);
  });

  it('runs year 6, the slow one, in order: bloom, petal fall, fruit swelling, colour, fall', () => {
    const at = (fraction: number) => heroCrop(getSecondOfYear(6 + fraction));
    expect(at(0.02).blossom.count).toBeGreaterThan(1000);
    expect(at(0.02).blossom.fallen).toBe(0);
    expect(at(0.14).blossom.fallen).toBeGreaterThan(0.5);
    expect(at(0.3).blossom.count).toBe(0);
    expect(at(0.1).fruit.radius).toBeLessThan(at(0.4).fruit.radius);
    expect(at(0.4).fruit.radius).toBeLessThan(at(0.8).fruit.radius);
    expect(at(0.3).fruit.ripeness).toBe(0);
    expect(at(0.7).fruit.ripeness).toBeGreaterThan(0.1);
    expect(at(0.7).fruit.ripeness).toBeLessThan(1);
    expect(at(0.88).fruit.ripeness).toBe(1);
    expect(at(0.8).fruit.fallen).toBe(0);
    expect(at(0.985).fruit.fallen).toBe(1);
  });

  it('has more fruit each year on the way to the storm, and again after', () => {
    // The most fruit a year carries, however briefly a fast year shows it.
    const fruitIn = (year: number) => {
      let most = 0;
      for (let fraction = 0.3; fraction <= 0.9; fraction += 0.05) {
        most = Math.max(most, heroCrop(getSecondOfYear(year + fraction)).fruit.count);
      }
      return most;
    };
    // Every year that has time to show its whole crop has more than the last.
    for (let year = 4; year < 12; year++) {
      expect(fruitIn(year + 1), `year ${year + 1}`).toBeGreaterThan(fruitIn(year));
    }
    // The quick years show less of theirs, but the crop still grows over them.
    expect(fruitIn(19)).toBeGreaterThan(fruitIn(12));
    expect(fruitIn(29)).toBeGreaterThan(fruitIn(22) * 2);
    expect(fruitIn(29)).toBeGreaterThan(fruitIn(19));
    expect(fruitIn(20)).toBeLessThan(fruitIn(19) * 0.25);
  });

  it('ends with the last crop still hanging, in the next bloom', () => {
    for (const t of [57.6, LOOP.fileStart, END]) {
      const {blossom, fruit} = heroCrop(t);
      expect(blossom.count).toBeGreaterThan(1000);
      expect(fruit.count).toBeGreaterThan(1000);
      expect(fruit.ripeness).toBe(1);
      expect(fruit.fallen).toBeLessThan(0.3);
    }
  });

  it('never runs a count below 0', () => {
    forEachFrame(state => {
      for (const tree of state.trees) {
        for (const slot of tree.crop as CropConfig[]) {
          expect(slot.count).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });
});

describe('the camera', () => {
  it('has near above 0 and below far, at any aspect', () => {
    for (const options of [LANDSCAPE, PORTRAIT]) {
      forEachFrame(({camera}) => {
        expect(camera.near).toBeGreaterThan(0);
        expect(camera.far).toBeGreaterThan(camera.near * 3.9);
        expect(camera.distance).toBeGreaterThan(camera.near);
        expect(camera.distance).toBeLessThan(camera.far);
      }, options);
    }
  });

  it('stays above the land and the water, and out of every crown', () => {
    for (const options of [LANDSCAPE, PORTRAIT]) {
      forEachFrame((state, t) => {
        const eye = getCameraEye(state.camera);
        const ground = Math.max(getLandHeight(eye[0], eye[1]), state.ground.flood.level);
        expect(eye[2] - ground, `eye height at t=${t}`).toBeGreaterThan(0.02);
        state.trees.forEach((tree, index) => {
          const growth = tree.growth as number;
          if (growth > 0) {
            const position = tree.position as Vec3;
            const height = getTreeHeight(tree);
            const crown = (tree.crownRadius as number) * getCrownFraction(growth);
            const lean = (tree.lean as number[])[0] * (Math.PI / 180);
            const bearing = (tree.lean as number[])[1] * (Math.PI / 180);
            const axis: Vec3 = [
              Math.sin(lean) * Math.sin(bearing),
              Math.sin(lean) * Math.cos(bearing),
              Math.cos(lean)
            ];
            const d: Vec3 = [
              eye[0] - position[0],
              eye[1] - position[1],
              eye[2] - (tree.elevation as number)
            ];
            const along = Math.max(
              0,
              Math.min(1, (d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2]) / height)
            );
            const away = getLength([
              d[0] - axis[0] * along * height,
              d[1] - axis[1] * along * height,
              d[2] - axis[2] * along * height
            ]);
            const profile = Math.sin(Math.PI * Math.min(1, along * 0.9 + 0.08));
            expect(
              away,
              `eye inside tree ${index} at t=${t}, aspect ${options.aspect}`
            ).toBeGreaterThan(crown * profile);
          }
        });
      }, options);
    }
  });

  it('moves with no sudden acceleration, but at the swap', () => {
    // How much a frame's move changes from the next, as a share of the distance to the subject.
    // The cut is twice as quick as the two-minute one; the dive onto the fruit and its glide
    // through the impact are quicker still, a few centimetres from it.
    const eyes: Vec3[] = [];
    const distances: number[] = [];
    forEachFrame(state => {
      eyes.push(getCameraEye(state.camera));
      distances.push(state.camera.distance);
    });
    let worst = 0;
    let worstAt = 0;
    let worstRiding = 0;
    let worstRidingAt = 0;
    for (let frame = 2; frame < FRAMES; frame++) {
      const [a, b, c] = [eyes[frame - 2], eyes[frame - 1], eyes[frame]];
      const change =
        getLength([c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]]) /
        distances[frame];
      const t = frame / FRAME_RATE;
      if (isRidingFruit(t)) {
        if (change > worstRiding) [worstRiding, worstRidingAt] = [change, t];
      } else if (change > worst) {
        [worst, worstAt] = [change, t];
      }
    }
    expect(worst, `worst change of step at t=${worstAt}`).toBeLessThan(0.01);
    expect(worstRiding, `worst change of step at t=${worstRidingAt}`).toBeLessThan(0.02);
  });

  it('has no zoom pulses: the distance has no more than a few turns', () => {
    let turns = 0;
    let lastChange = 0;
    let last = getStoryState(0, LANDSCAPE).camera.distance;
    forEachFrame(({camera}) => {
      const change = Math.log(camera.distance / last);
      if (Math.abs(change) > 2e-4) {
        if (lastChange !== 0 && Math.sign(change) !== Math.sign(lastChange)) turns++;
        lastChange = change;
      }
      last = camera.distance;
    });
    expect(turns).toBeLessThan(15);
  });

  it('shakes only in the hurricane, and only slightly', () => {
    forEachFrame((state, t) => {
      const amount = Math.hypot(state.shake[0], state.shake[1]);
      if (t < 33.6 || t > 44.6) expect(amount).toBe(0);
      expect(amount).toBeLessThan(0.75);
    });
    expect(Math.hypot(...getStoryState(36.2, LANDSCAPE).shake)).toBeGreaterThan(0.01);
    const eye = getStoryState(39.2, LANDSCAPE).shake;
    expect(Math.hypot(...eye)).toBeLessThan(0.04);
  });

  it('opens on the fallen fruit, macro, low, with the sunrise ahead and to the right', () => {
    const open = getStoryState(2.6, LANDSCAPE);
    expect(open.camera.distance).toBeCloseTo(0.265, 2);
    expect(open.camera.fovy).toBeLessThan(32);
    expect(getCameraEye(open.camera)[2]).toBeLessThan(0.1);
    const {off, elevation} = getSunAngles(open);
    expect(off).toBeGreaterThan(25);
    expect(off).toBeLessThan(45);
    expect(elevation).toBeGreaterThan(3);
    expect(elevation).toBeLessThan(4);
  });

  it('ends low in the bed middle on the hanging fruit, side lit, 0.8 m from it', () => {
    // Close enough in the file's first frame for the fruit to be a fifth of the frame across.
    const first = getStoryState(LOOP.fileStart, PORTRAIT);
    const eye = getCameraEye(first.camera);
    const fruit = first.props.orange.position;
    expect(first.props.orange.visible).toBe(true);
    expect(first.props.orange.phase).toBe('hanging');
    expect(getLength([eye[0] - fruit[0], eye[1] - fruit[1], eye[2] - fruit[2]])).toBeCloseTo(
      0.8,
      1
    );
    const across =
      (2 * first.props.orange.radius) /
      (2 * first.camera.distance) /
      (Math.tan((first.camera.fovy / 2) * (Math.PI / 180)) * PORTRAIT.aspect);
    expect(across).toBeGreaterThan(0.17);
    expect(across).toBeLessThan(0.25);
    expect(eye[2]).toBeLessThan(1);
    // Out from the skirt the fruit hangs at, low and to the south of it.
    expect(Math.hypot(eye[0], eye[1])).toBeGreaterThan(Math.hypot(fruit[0], fruit[1]) + 0.3);
    expect(eye[1]).toBeLessThan(fruit[1] - 0.5);
    const point = project(first.camera, PORTRAIT.aspect, fruit);
    expect(Math.abs(point.x)).toBeLessThan(0.15);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(0.3);
    const {off, elevation} = getSunAngles(first);
    expect(off).toBeGreaterThan(90);
    expect(off).toBeLessThan(125);
    expect(elevation).toBeGreaterThan(2.5);
    expect(elevation).toBeLessThan(3.2);
    // At the swap the sunrise is a three-quarter backlight, 39 degrees right of the view.
    expect(getSunAngles(getStoryState(CYCLE_SECONDS - 1e-6, PORTRAIT)).off).toBeCloseTo(39.6, 0);
  });

  it('keeps the hanging fruit in focus, not the crown behind it', () => {
    const state = getStoryState(LOOP.fileStart, PORTRAIT);
    expect(getFocusPull(state)).toBeCloseTo(state.props.orange.radius * 0.9, 3);
  });

  it('dives with the falling fruit until it fills the frame, and draws back off it as it lands', () => {
    const fromFruit = (t: number) => {
      const state = getStoryState(t, PORTRAIT);
      const eye = getCameraEye(state.camera);
      const fruit = state.props.orange.position;
      return getLength([eye[0] - fruit[0], eye[1] - fruit[1], eye[2] - fruit[2]]);
    };
    expect(fromFruit(CYCLE_SECONDS + LOOP.letGo)).toBeCloseTo(0.72, 1);
    expect(fromFruit(CYCLE_SECONDS - 1.0)).toBeCloseTo(0.3, 1);
    expect(fromFruit(CYCLE_SECONDS - 1e-6)).toBeCloseTo(0.068, 2);
    expect(fromFruit(1e-6)).toBeCloseTo(0.068, 2);
    expect(fromFruit(0.8)).toBeCloseTo(0.25, 1);
    expect(fromFruit(1.25)).toBeCloseTo(0.32, 1);
    expect(fromFruit(1.6)).toBeCloseTo(0.31, 1);
    let least = Infinity;
    for (let seam = -0.5; seam <= 0.5; seam += 0.01) {
      least = Math.min(
        least,
        getStoryState((seam + CYCLE_SECONDS) % CYCLE_SECONDS).camera.distance
      );
    }
    expect(least).toBeCloseTo(0.068, 3);
  });

  it('holds its eye low in the storm furrow, 1.4 m over the water, and tilts up in the eye', () => {
    for (let t = 35; t <= HURRICANE.clearing; t += 0.1) {
      const eye = getCameraEye(getStoryState(t, PORTRAIT).camera);
      expect(eye[0]).toBeGreaterThan(-29.1);
      expect(eye[0]).toBeLessThan(-25.4);
      expect(eye[1]).toBeCloseTo(3.8, 1);
      expect(eye[2]).toBeCloseTo(0.72, 1);
    }
    const held = getCameraEye(getStoryState(HURRICANE.eyeOpen, PORTRAIT).camera);
    for (let t = HURRICANE.eyeOpen; t <= HURRICANE.eyeClose; t += 0.1) {
      const eye = getCameraEye(getStoryState(t, PORTRAIT).camera);
      expect(getLength([eye[0] - held[0], eye[1] - held[1], eye[2] - held[2]])).toBeLessThan(0.05);
    }
    expect(getStoryState(39.2, PORTRAIT).camera.pitch).toBeLessThan(-15);
    expect(getStoryState(36.2, PORTRAIT).camera.pitch).toBeCloseTo(8.8, 0);
    // From 45.6 it is over the wrecks, about 6 m up.
    expect(getCameraEye(getStoryState(45.6, PORTRAIT).camera)[2]).toBeGreaterThan(4.5);
  });

  it("stops for the eye's frames: looking up at 39.2, and on the mirror through the cat's-paws", () => {
    const pitchAt = (t: number) => getStoryState(t, PORTRAIT).camera.pitch;
    const rateAt = (t: number) => (pitchAt(t + 1 / 240) - pitchAt(t - 1 / 240)) * 120;
    // Up in the stadium from 38.9, and held there through the 39.2 frame.
    for (let t = 38.9; t <= 39.2; t += 0.02) {
      expect(pitchAt(t), `pitch at t=${t}`).toBeLessThan(-17.9);
      expect(Math.abs(rateAt(t)), `pitch rate at t=${t}`).toBeLessThan(2);
    }
    for (let t = 39.88; t <= 40.06; t += 0.02) {
      expect(pitchAt(t), `pitch at t=${t}`).toBeCloseTo(10, 1);
      expect(Math.abs(rateAt(t)), `pitch rate at t=${t}`).toBeLessThan(1);
    }
    // No overshoot past either pose, and no tilt faster than the 0.68 s between the frames asks:
    // 28 degrees of smooth tilt in that time is about 62 degrees a second at the most.
    let fastest = 0;
    for (let t = HURRICANE.eyeOpen - 0.3; t <= HURRICANE.eyeClose + 0.4; t += 1 / 60) {
      expect(pitchAt(t)).toBeGreaterThan(-18.01);
      expect(pitchAt(t)).toBeLessThan(10.01);
      fastest = Math.max(fastest, Math.abs(rateAt(t)));
    }
    expect(fastest).toBeLessThan(63);
  });

  it('lands the fruit clear above the timeline', () => {
    // On the film's 1080x1920 frame the overlay's axis is at y 1350, its readout below. The squash,
    // the sand's crown and the hop all stand above it.
    for (let t = 0.9; t <= 1.4; t += 1 / 60) {
      const state = getStoryState(t, PORTRAIT);
      const {position, radius} = state.props.orange;
      const contact = project(state.camera, PORTRAIT.aspect, [
        position[0],
        position[1],
        position[2] - radius
      ]);
      expect(960 - contact.y * 960, `contact at t=${t}`).toBeLessThan(1335);
    }
  });

  it('lets the fruit drop out of the middle of the frame before it dives after it', () => {
    const getFruit = (seam: number) => {
      const state = getStoryState(CYCLE_SECONDS + seam, PORTRAIT);
      const {position, radius} = state.props.orange;
      return {
        y: project(state.camera, PORTRAIT.aspect, position).y,
        bottom: project(state.camera, PORTRAIT.aspect, [
          position[0],
          position[1],
          position[2] - radius
        ]).y
      };
    };
    const hanging = getFruit(LOOP.letGo).y;
    // Held on where it hung, the take watches it fall from its stalk, by more than its radius.
    let lowest = hanging;
    for (let seam = LOOP.letGo; seam <= -1; seam += 0.02) {
      const fruit = getFruit(seam);
      lowest = Math.min(lowest, fruit.y);
      // Never down behind the timeline's flags, which stand from y 1190 of 1920.
      expect(960 - fruit.bottom * 960, `fruit at seam ${seam.toFixed(2)}`).toBeLessThan(1180);
    }
    expect(lowest).toBeLessThan(hanging - 0.11);
    // Then it is back on the fruit well before the rind fills the frame.
    expect(Math.abs(getFruit(-1).y - hanging)).toBeLessThan(0.05);
  });

  it('glides through the impact and the seed landing with no step in its acceleration', () => {
    // The eye's acceleration, every 1/240 s: softened densely, an impact eases in and out rather
    // than arriving in steps as each reading of the fruit's fall passes it.
    for (const [from, to] of [
      [0.6, 2.2],
      [6, 6.8]
    ]) {
      const step = 1 / 240;
      let last = Number.NaN;
      let worst = 0;
      const eyes: Vec3[] = [];
      for (let t = from - step; t <= to + step; t += step) {
        eyes.push(getCameraEye(getStoryState(t, PORTRAIT).camera));
      }
      for (let index = 1; index < eyes.length - 1; index++) {
        const [a, b, c] = [eyes[index - 1], eyes[index], eyes[index + 1]];
        const acceleration =
          getLength([c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1], c[2] - 2 * b[2] + a[2]]) /
          (step * step);
        expect(acceleration, `acceleration at t=${from + index * step}`).toBeLessThan(4);
        if (Number.isFinite(last)) worst = Math.max(worst, Math.abs(acceleration - last));
        last = acceleration;
      }
      expect(worst, `steps of acceleration over ${from}-${to}`).toBeLessThan(1.5);
    }
  });

  it("opens Year 30 down the aisle, focused on the hero's skirt, and stopped down", () => {
    const state = getStoryState(57.6, PORTRAIT);
    const orbit = ((state.camera.orbit % 360) + 360) % 360;
    // Looking west down the bed middle, between the hero's row and the south row.
    expect(orbit).toBeGreaterThan(266);
    expect(orbit).toBeLessThan(282);
    const eye = getCameraEye(state.camera);
    expect(eye[1]).toBeGreaterThan(-4.3);
    expect(eye[1]).toBeLessThan(-3.5);
    // The focus stays on the target, at the skirt beside the aisle, not on air in front of it.
    expect(getFocusPull(state)).toBeLessThan(0.1);
    expect(state.camera.aperture).toBeLessThan(0.005);
  });

  it('hands the narrow frame from widening to pulling back with no kink', () => {
    const step = 1 / 240;
    for (const [from, to] of [
      [14.6, 15.8],
      [28.8, 30]
    ]) {
      const fovy: number[] = [];
      for (let t = from - step; t <= to + step; t += step) {
        fovy.push(getStoryState(t, PORTRAIT).camera.fovy);
      }
      for (let index = 1; index < fovy.length - 1; index++) {
        const acceleration = (fovy[index + 1] - 2 * fovy[index] + fovy[index - 1]) / (step * step);
        expect(Math.abs(acceleration), `fovy at t=${from + index * step}`).toBeLessThan(20);
      }
    }
  });

  it('frames the hero from the time it is a tree, and keeps it clear of the timeline', () => {
    for (const options of [LANDSCAPE, PORTRAIT]) {
      forEachFrame((state, t) => {
        if (t >= 12 && t <= 27) {
          const hero = state.trees[0];
          const elevation = hero.elevation as number;
          const top = project(state.camera, options.aspect, [
            0,
            0,
            elevation + getTreeHeight(hero)
          ]);
          const base = project(state.camera, options.aspect, [0, 0, elevation]);
          expect(top.y, `top of the hero at t=${t}`).toBeLessThan(0.95);
          expect(base.y, `base of the hero at t=${t}`).toBeGreaterThan(-0.85);
        }
      }, options);
    }
  });

  it('frames the same subject in a narrow frame, by widening first', () => {
    for (const t of [3, 12, 20, 29.4, 36.2, 46.4, 57.6]) {
      const wide = getStoryState(t, LANDSCAPE).camera;
      const narrow = getStoryState(t, PORTRAIT).camera;
      const widthAt = (camera: StoryCamera, aspect: number) =>
        2 * camera.distance * Math.tan((camera.fovy / 2) * (Math.PI / 180)) * aspect;
      expect(narrow.fovy).toBeGreaterThan(wide.fovy);
      expect(widthAt(narrow, PORTRAIT.aspect)).toBeGreaterThan(
        0.5 * widthAt(wide, LANDSCAPE.aspect)
      );
      expect(narrow.distance).toBeLessThan(wide.distance * 1.3);
      expect(narrow.fovy).toBeLessThanOrEqual(62.01);
    }
  });
});

describe('motion blur', () => {
  // A frame's travel across a 180-degree shutter at 30 fps, on the film's 1080x1920 frame.
  const getTravel = (t: number) => {
    const open = 1 / 60;
    const opened = getMotionProbe(getStoryState(t - open / 2, PORTRAIT), PORTRAIT.aspect);
    const closed = getMotionProbe(getStoryState(t + open / 2, PORTRAIT), PORTRAIT.aspect);
    return getShutterTravel(opened, closed, 1920, PORTRAIT.aspect, open);
  };

  it("measures what the take's turn moves across the shutter", () => {
    // The eye's tilt down at its fastest, about a degree a shutter on a 58 degree lens.
    expect(getTravel(39.55)).toBeGreaterThan(25);
    // Held still on the mirror, in next to no wind, nothing moves.
    expect(getTravel(39.95)).toBeLessThan(2);
  });

  it('asks for more sub-frames where crowns thrash or fall by the lens, and only there', () => {
    // A crown going over into the water by the lens, in the second wall's last peak.
    expect(getMotionSamples(8, getTravel(43.45))).toBeGreaterThan(16);
    expect(getLensSamples(8, 0, getTravel(43.45))).toBeGreaterThanOrEqual(24);
    // A still frame asks for no more than it is given, and the limit holds.
    expect(getLensSamples(8, 0, getTravel(39.95))).toBe(8);
    expect(getLensSamples(8, 0, 1e6)).toBe(32);
    expect(getLensSamples(1, 0, 1e6)).toBe(1);
  });
});

describe('the camera in deck.gl', () => {
  it('stands where an OrbitView says, with the target centered, at every scale', () => {
    const width = 1280;
    const height = 720;
    for (const t of [0.5, 5, 12, 20, 29.4, 36.2, 46.4, 57.4, LOOP.fileStart, END]) {
      const {camera} = getStoryState(t, {aspect: width / height});
      const {view, viewState} = getOrbitViewProps(camera, height);
      const viewport = new OrbitView(view).makeViewport({width, height, viewState});
      const eye = getCameraEye(camera);
      const seen = viewport?.cameraPosition as number[];
      for (let axis = 0; axis < 3; axis++) {
        expect(seen[axis]).toBeCloseTo(eye[axis], 4);
      }
      const [x, y] = viewport?.project(camera.target) as number[];
      expect(x).toBeCloseTo(width / 2, 3);
      expect(y).toBeCloseTo(height / 2, 3);
    }
  });

  it('agrees with an OrbitView on where things land in the frame, and on the planes', () => {
    const width = 1920;
    const height = 1080;
    for (const t of [3, 18, 36.2, 50.2, LOOP.fileStart]) {
      const {camera} = getStoryState(t, {aspect: width / height});
      const {view, viewState} = getOrbitViewProps(camera, height);
      const viewport = new OrbitView(view).makeViewport({width, height, viewState});
      const point: Vec3 = [
        camera.target[0] + 0.1 * camera.distance,
        camera.target[1] - 0.05 * camera.distance,
        camera.target[2] + 0.07 * camera.distance
      ];
      const ours = project(camera, width / height, point);
      const [x, y] = viewport?.project(point) as number[];
      expect(x).toBeCloseTo((ours.x * 0.5 + 0.5) * width, 2);
      expect(y).toBeCloseTo((0.5 - ours.y * 0.5) * height, 2);
      // A point on the axis at the far plane unprojects to depth 1, and at the near plane to -1.
      const forward = getCameraForward(camera);
      const eye = getCameraEye(camera);
      const at = (metres: number): Vec3 => [
        eye[0] + forward[0] * metres,
        eye[1] + forward[1] * metres,
        eye[2] + forward[2] * metres
      ];
      expect(viewport?.project(at(camera.far))[2]).toBeCloseTo(1, 3);
      expect(viewport?.project(at(camera.near))[2]).toBeCloseTo(-1, 3);
    }
  });
});

describe('the opening', () => {
  it('rolls the halves apart and settles them with a little overshoot', () => {
    const spread = (t: number) => {
      const [a, b] = getStoryState(t, LANDSCAPE).props.orange.halves;
      return Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]);
    };
    const {partStart, partSeconds} = ORANGE_TABLE;
    const settled = spread(partStart + partSeconds + 0.1);
    expect(spread(partStart - 0.1)).toBeLessThan(0.002);
    let most = 0;
    for (let t = partStart; t < partStart + partSeconds + 0.5; t += 0.02) {
      most = Math.max(most, spread(t));
    }
    expect(most).toBeGreaterThan(settled);
    expect(most).toBeLessThan(settled * 1.15);
    expect(settled).toBeGreaterThan(0.05);
  });

  it('has quaternions of unit length', () => {
    forEachFrame(({props}) => {
      for (const q of [
        props.orange.rotation,
        props.orange.halves[0].rotation,
        props.orange.halves[1].rotation,
        props.seed.rotation
      ]) {
        expect(Math.hypot(...q)).toBeCloseTo(1, 6);
      }
    });
  });

  it('flies the seed from a half to the pot, in a high arc, with its trail', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE).props;
    const {lift, land, buriedAt} = SEED_TABLE;
    const start = at(lift).seed;
    expect(start.visible).toBe(true);
    const orange = ORANGE_TABLE.center;
    expect(Math.hypot(start.position[0] - orange[0], start.position[1] - orange[1])).toBeLessThan(
      0.12
    );
    let apex = 0;
    let lastPosition = start.position;
    for (let t = lift; t <= land; t += 1 / 60) {
      const {seed} = at(t);
      apex = Math.max(apex, seed.position[2]);
      expect(
        getLength([
          seed.position[0] - lastPosition[0],
          seed.position[1] - lastPosition[1],
          seed.position[2] - lastPosition[2]
        ])
      ).toBeLessThan(0.02);
      lastPosition = seed.position;
    }
    expect(apex).toBeGreaterThan(0.25);
    const landed = at(land);
    expect(Math.hypot(landed.seed.position[0], landed.seed.position[1])).toBeLessThan(1e-9);
    expect(landed.seed.position[2]).toBeCloseTo(landed.pot.soilLevel + 0.006, 2);
    const flying = at((lift + land) / 2 + 0.2).seed;
    expect(flying.trail.length).toBeGreaterThan(4);
    expect(flying.trail[0].alpha).toBeLessThan(flying.trail[flying.trail.length - 1].alpha);
    expect(at(buriedAt + 0.1).seed.visible).toBe(false);
  });

  it('keeps the seed in frame while the camera follows it', () => {
    for (const options of [LANDSCAPE, PORTRAIT]) {
      for (let t = SEED_TABLE.lift; t <= SEED_TABLE.land; t += 0.05) {
        const state = getStoryState(t, options);
        const point = project(state.camera, options.aspect, state.props.seed.position);
        expect(Math.abs(point.x), `seed across at t=${t}`).toBeLessThan(0.6);
        expect(Math.abs(point.y), `seed up at t=${t}`).toBeLessThan(0.6);
      }
    }
  });

  it('has grains for the puff and the covering, and a mound after a dimple', () => {
    const pot = (t: number) => getStoryState(t, LANDSCAPE).props.pot;
    const {land} = SEED_TABLE;
    expect(pot(land + 0.15).grains.length).toBeGreaterThan(5);
    expect(pot(7.05).grains.length).toBeGreaterThan(3);
    expect(pot(6.7).soilBump).toBeLessThan(0);
    expect(pot(7.8).soilBump).toBeGreaterThan(0);
    expect(pot(7.8).soilCrack).toBe(0);
    expect(pot(8.8).soilCrack).toBeGreaterThan(0.8);
  });

  it('steps the pot up with a settle, with the tree on the soil throughout', () => {
    const {potUp} = POT_TABLE;
    const before = getStoryState(potUp[0] - 0.1, LANDSCAPE);
    const after = getStoryState(potUp[1] + 0.2, LANDSCAPE);
    expect(after.props.pot.rimRadius).toBeGreaterThan(before.props.pot.rimRadius * 1.5);
    expect(after.props.pot.height).toBeGreaterThan(before.props.pot.height * 1.5);
    let most = 0;
    for (let t = potUp[0]; t < potUp[1] + 0.1; t += 0.01) {
      most = Math.max(most, getStoryState(t, LANDSCAPE).props.pot.rimRadius);
    }
    expect(most).toBeGreaterThan(after.props.pot.rimRadius);
    for (const t of [10, potUp[0] + 0.3, potUp[1] + 0.2, 13]) {
      const state = getStoryState(t, LANDSCAPE);
      expect(state.trees[0].elevation).toBeCloseTo(state.props.pot.soilLevel, 6);
    }
  });

  it('hides the orange only when it is out of the frame, at any aspect', () => {
    const {goneAt, center, radius} = ORANGE_TABLE;
    for (const options of [LANDSCAPE, PORTRAIT]) {
      for (let t = goneAt - 0.2; t < goneAt + 0.2; t += 0.02) {
        const {camera} = getStoryState(t, options);
        for (const dx of [-0.1, 0, 0.1]) {
          for (const dy of [-0.1, 0, 0.1]) {
            const point = project(camera, options.aspect, [center[0] + dx, center[1] + dy, radius]);
            const inFrame = point.depth > 0 && Math.abs(point.x) < 1 && Math.abs(point.y) < 1;
            expect(inFrame, `orange in frame at t=${t}`).toBe(false);
          }
        }
      }
    }
  });

  it('lays the net over the tree, strains it, slits it and lets the wind take it', () => {
    const net = (t: number) => getStoryState(t, LANDSCAPE).props.nets[0];
    const {descent, cinch, strain, slit, lift} = NET_TABLE;
    expect(net(descent[0] - 0.1)).toBeUndefined();
    expect(net(descent[0] + 0.2).descent).toBeLessThan(0.5);
    expect(net(descent[1]).descent).toBe(1);
    expect(net(12.65).billow).toBeGreaterThan(0.1);
    expect(net(cinch[1]).cinch).toBe(1);
    expect(net(strain[1]).strain).toBe(1);
    expect(net(slit[1]).slit).toBe(1);
    expect(net((lift[0] + lift[1]) / 2).lift).toBeGreaterThan(0.3);
    expect(net(lift[1] + 0.1)).toBeUndefined();
  });

  it('plants the hero: pot away, root ball down, hole filled, berm and water, microjet', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    const {lift, slide, potFade, hole, fill, berm, water} = PLANTING_TABLE;
    expect(at(lift[0] - 0.1).props.rootBall).toBeNull();
    expect(at(lift[0] + 0.2).props.rootBall).not.toBeNull();
    expect(at((hole[0] + hole[1]) / 2 + 0.1).ground.hero.hole).toBeGreaterThan(0.3);
    expect(Math.hypot(...at(slide[1]).props.pot.position.slice(0, 2))).toBeGreaterThan(1);
    expect(at(potFade[1]).props.pot.visible).toBe(false);
    expect(at(fill[1] + 0.1).ground.hero.hole).toBe(0);
    expect(at(berm[1] + 0.1).ground.hero.berm).toBe(1);
    expect(at(water[1]).ground.hero.water).toBeGreaterThan(0.9);
    expect(at(water[1]).props.rootBall).toBeNull();
    expect(at(water[1]).trees[0].elevation).toBeCloseTo(getLandHeight(0, 0), 6);
    expect(at(MICROJET_TABLE.appears[0] - 0.1).props.microjets.length).toBe(0);
    expect(at(16.5).props.microjets[0].visible).toBe(1);
    expect(at(16.5).props.microjets[0].spray).toBe(1);
  });
});

describe('the replant', () => {
  const [from, to] = REPLANT_TABLE.starts;

  it('opens sites with holes, root balls, berms and water, and they fade', () => {
    let holes = 0;
    let balls = 0;
    let wet = 0;
    for (let t = from; t <= to + 2.5; t += 0.05) {
      for (const site of getStoryState(t, LANDSCAPE).ground.sites) {
        if (site.hole > 0.5) holes++;
        if (site.rootBall) balls++;
        if (site.water > 0.5) wet++;
      }
    }
    expect(holes).toBeGreaterThan(20);
    expect(balls).toBeGreaterThan(20);
    expect(wet).toBeGreaterThan(20);
    expect(getStoryState(from - 0.5, LANDSCAPE).ground.sites.length).toBe(0);
    expect(getStoryState(57.4, LANDSCAPE).ground.sites.length).toBe(0);
  });

  it('nets each replant, and lifts the nets in a wave in the regrowth', () => {
    const count = GROVE_PLAN.filter(row => row.kind === 'replant').length;
    expect(getStoryState(from - 0.5, LANDSCAPE).props.nets.length).toBe(0);
    expect(getStoryState(REPLANT_TABLE.netStrain[0], LANDSCAPE).props.nets.length).toBe(count);
    const lifts = getStoryState(REPLANT_TABLE.netLiftFrom + 0.4, LANDSCAPE).props.nets.map(
      net => net.lift
    );
    expect(Math.max(...lifts)).toBeGreaterThan(Math.min(...lifts));
    expect(getStoryState(56.4, LANDSCAPE).props.nets.length).toBe(0);
  });

  it('has a microjet by each', () => {
    const count = GROVE_PLAN.filter(row => row.kind === 'replant').length;
    expect(getStoryState(to + 2, LANDSCAPE).props.microjets.length).toBe(count + 1);
  });
});

describe('light', () => {
  const elevationOf = (state: StoryState) => (Math.asin(state.sky.sunDirection[2]) * 180) / Math.PI;

  it('has unit directions, and a key light that points down', () => {
    forEachFrame(state => {
      expect(getLength(state.key.direction)).toBeCloseTo(1, 6);
      expect(getLength(state.flash.direction)).toBeCloseTo(1, 6);
      expect(getLength(state.sky.sunDirection)).toBeCloseTo(1, 6);
      expect(getLength(state.sky.moonDirection)).toBeCloseTo(1, 6);
      expect(state.key.direction[2]).toBeLessThan(-0.06);
      expect(state.flash.direction[2]).toBeLessThan(0);
      expect(state.key.shadow).toBe(true);
      expect(state.flash.shadow).toBe(false);
    });
  });

  it('runs the sun east to west, through the south, off the clock', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE).sky.sunDirection;
    // Sunrise over the fruit at both ends of the cycle, and sunset behind the camera on the flood.
    expect(at(1)[0]).toBeGreaterThan(0.9);
    expect(at(LOOP.fileStart)[0]).toBeGreaterThan(0.9);
    expect(at(46.6)[0]).toBeLessThan(-0.9);
    // Noon in year 6 is high, and in the south.
    expect(at(20.4)[2]).toBeGreaterThan(0.9);
    expect(at(20.4)[1]).toBeLessThan(0);
    // It is the same sun either side of the swap.
    const before = at(CYCLE_SECONDS - 1e-6);
    const after = at(0);
    for (let axis = 0; axis < 3; axis++) expect(before[axis]).toBeCloseTo(after[axis], 6);
  });

  it('has a day of 3 to 5 seconds through the seasons, and no strobing', () => {
    const sunrises: number[] = [];
    let lastUp = false;
    for (let t = 19; t <= 27.1; t += 0.01) {
      const up = getStoryState(t, LANDSCAPE).sky.sunDirection[2] > 0;
      if (up && !lastUp) sunrises.push(t);
      lastUp = up;
    }
    expect(sunrises.length).toBe(3);
    for (let index = 1; index < sunrises.length; index++) {
      const day = sunrises[index] - sunrises[index - 1];
      expect(day).toBeGreaterThanOrEqual(3);
      expect(day).toBeLessThanOrEqual(5);
    }
    // Nothing in the cycle crosses the horizon twice within a third of a second.
    let lastSign = 0;
    let lastFlip = -10;
    forEachFrame((state, t) => {
      const sign = Math.sign(state.sky.sunDirection[2]);
      if (lastSign && sign !== lastSign) {
        expect(t - lastFlip, `sun crossed the horizon twice by t=${t}`).toBeGreaterThan(0.35);
        lastFlip = t;
      }
      lastSign = sign;
    });
  });

  it('warms the low sun and cools the dusk ambient, and dims the blue moon', () => {
    const low = getStoryState(1, LANDSCAPE);
    expect(low.key.color[0]).toBeGreaterThan(low.key.color[2] * 1.8);
    const noon = getStoryState(20.4, LANDSCAPE);
    expect(noon.key.color[2]).toBeGreaterThan(200);
    expect(noon.key.intensity).toBeGreaterThan(2);
    forEachFrame(state => {
      const elevation = elevationOf(state);
      if (elevation < -8 && state.sky.storm === 0) {
        expect(state.ambient.color[2]).toBeGreaterThan(state.ambient.color[0]);
        expect(state.ambient.intensity).toBeLessThan(0.5);
        expect(state.key.intensity).toBeLessThan(0.45);
        expect(state.key.color[2]).toBeGreaterThan(state.key.color[0]);
      }
    });
  });

  it('never lets the key light jump, even as moon and sun trade places', () => {
    let last = getStoryState(0, LANDSCAPE).key.intensity;
    forEachFrame((state, t) => {
      expect(Math.abs(state.key.intensity - last), `key at t=${t}`).toBeLessThan(0.6);
      last = state.key.intensity;
    });
  });

  it('lights the recession and the drowned roots by day, and the replant from morning to midday', () => {
    // The 48.50 and 50.20 stills: the bed crowns coming out, and the low east end weeks later.
    for (const t of [48.5, 50.2]) {
      expect(elevationOf(getStoryState(t, LANDSCAPE)), `sun at t=${t}`).toBeGreaterThan(8);
    }
    for (let t = 51.4; t <= 53.2; t += 0.1) {
      expect(elevationOf(getStoryState(t, LANDSCAPE)), `sun at t=${t}`).toBeGreaterThan(35);
    }
  });

  it('keeps its milestones and bars in daylight, with short nights between', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    // 'First fruit' and the net's slit and lift-off play in the afternoon.
    for (let t = 17.6; t <= 18.4; t += 0.1) {
      expect(elevationOf(at(t)), `sun at t=${t}`).toBeGreaterThan(5);
    }
    // The bars of years 11 to 14, and those climbing past the old peak, land over a lit grove.
    for (const t of [25, 25.4, 25.8, 54, 54.6, 55, 55.4]) {
      expect(elevationOf(at(t)), `sun at t=${t}`).toBeGreaterThan(4);
    }
    // Each night there is a blink.
    for (const [from, to] of [
      [18, 19.4],
      [24.5, 27.2],
      [55, 57.4]
    ]) {
      let dark = 0;
      for (let t = from; t <= to; t += 0.01) if (elevationOf(at(t)) < -6) dark += 0.01;
      expect(dark, `night over ${from}-${to}`).toBeLessThan(0.65);
    }
  });

  it('grades the end shot and the landing it runs into as a golden hour, the same at the swap', () => {
    for (const t of [57.6, 59, LOOP.fileStart, CYCLE_SECONDS - 1e-6, 1e-6, 1.09]) {
      expect(getStoryState(t, LANDSCAPE).grade.exposure, `exposure at t=${t}`).toBeGreaterThan(0.5);
    }
    // And back to the opening's own by the time the seed flies.
    expect(getStoryState(4.6, LANDSCAPE).grade.exposure).toBeLessThan(0.2);
    // The sun is up for Year 30.
    expect(elevationOf(getStoryState(57.6, LANDSCAPE))).toBeGreaterThan(0.8);
  });

  it('holds golden light where the story asks for it', () => {
    for (const t of [1, 4.6, 28.2, 44.9, 46.4, 54, 59, LOOP.fileStart]) {
      const elevation = elevationOf(getStoryState(t, LANDSCAPE));
      expect(elevation, `sun at t=${t}`).toBeGreaterThan(1);
      expect(elevation, `sun at t=${t}`).toBeLessThan(25);
    }
  });

  it('flashes lightning for only a few frames, with its light dark otherwise', () => {
    let longest = 0;
    let run = 0;
    let frames = 0;
    forEachFrame(state => {
      if (state.sky.flash > 0.3) {
        frames++;
        run++;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
      if (state.sky.flash === 0) expect(state.flash.intensity).toBe(0);
    });
    expect(frames).toBeGreaterThan(5);
    expect(longest).toBeLessThanOrEqual(5);
    for (const {t} of HURRICANE.lightning) {
      expect(getStoryState(t + 0.02, LANDSCAPE).sky.flash).toBeGreaterThan(0.3);
    }
  });
});

describe('weather', () => {
  it('has rain and storm only in the hurricane, with no summer storm in the seasons', () => {
    forEachFrame((state, t) => {
      if (t < 33.6 || t > 46.2) expect(state.weather.rain, `rain at t=${t}`).toBe(0);
      if (t < HURRICANE.arrive || t > 47.8) expect(state.sky.storm, `storm at t=${t}`).toBe(0);
    });
  });

  it('frosts the winter night with the microjets running under stars', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    expect(at(21.6).sky.stars).toBeGreaterThan(0.5);
    expect(at(22).ground.frost).toBeGreaterThan(0.5);
    expect(at(22).treeFrost).toBeGreaterThan(0.4);
    expect(at(21.8).props.microjets[0].spray).toBe(1);
    expect(at(20.4).ground.frost).toBe(0);
    expect(at(23).ground.frost).toBe(0);
  });

  it('builds the hurricane, with a calm eye of about 2 s between opposite winds', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    expect(at(32).sky.storm).toBe(0);
    expect(at(36).sky.storm).toBe(1);
    expect(at(36.2).weather.rain).toBe(1);
    expect(at(36.2).wind.strength).toBeGreaterThan(0.65);
    expect(at(36.2).weather.rainSlant).toBeGreaterThan(70);
    expect(at(36.2).weather.debris).toBeGreaterThan(0.7);
    expect(at(36.2).weather.curtains).toBeCloseTo(0.75, 6);

    const calm: number[] = [];
    for (let t = 34; t < 45; t += 0.01) {
      if (at(t).wind.strength < 0.2 && at(t).sky.eye > 0.5) calm.push(t);
    }
    expect(calm[0]).toBeGreaterThan(HURRICANE.eyeOpen);
    expect(calm[calm.length - 1] - calm[0]).toBeGreaterThan(1.4);
    expect(calm[calm.length - 1] - calm[0]).toBeLessThan(2.2);

    expect(at(36).wind.bearing).toBeCloseTo(HURRICANE.firstWallBearing, 6);
    expect(at(42).wind.bearing).toBeCloseTo(HURRICANE.firstWallBearing + 180, 6);
    expect(at(39.2).weather.shaft).toBeGreaterThan(0.8);
    expect(at(39.2).lightShafts.length).toBe(1);
    expect(at(39.2).lightShafts[0].strength).toBeGreaterThan(0.8);
    expect(at(42).lightShafts.length).toBe(0);
    expect(at(42).wind.strength).toBeGreaterThan(0.7);
    expect(at(48).sky.storm).toBe(0);
    expect(at(51.4).sky.cloudCover).toBeLessThan(0.25);
    expect(at(49).sky.turbidity).toBeLessThan(2.5);
  });

  it('brings the arrival wind up while the camera is still high, so its gust fronts show', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE).wind.strength;
    // Past TreeLayer's strong-wind start, where the fronts silver the canopy in bands, by 33.0.
    expect(at(33)).toBeGreaterThan(0.3);
    expect(at(33.6)).toBeGreaterThan(0.42);
    expect(at(HURRICANE.arrive)).toBeLessThan(0.1);
  });

  it('clears the air for the gold light under the departing deck', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    for (let t = 44.7; t <= 45.6; t += 0.1) {
      const state = at(t);
      expect(state.weather.rain, `rain at t=${t}`).toBeLessThan(0.05);
      expect(state.key.intensity, `key at t=${t}`).toBeGreaterThan(1.8);
      expect(state.key.color[2], `key at t=${t}`).toBeLessThan(state.key.color[0] * 0.75);
      if (t >= 44.8) expect(state.fog.density, `fog at t=${t}`).toBeLessThan(0.0012);
    }
    // What haze is left is lit warm by that sun.
    const clearing = at(44.9);
    expect(clearing.fog.color[0]).toBeGreaterThan(clearing.fog.color[2] + 25);
    expect(clearing.weather.mist).toBeLessThan(0.3);
  });

  it('adds a squall at each gust peak, and swings the wind round through the calm', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE).wind.strength;
    for (const peak of HURRICANE.gustPeaks) {
      expect(at(peak)).toBeGreaterThan(at(peak - 0.5));
      expect(at(peak)).toBeGreaterThan(at(peak + 0.6));
      expect(at(peak)).toBeGreaterThan(0.75);
    }
  });

  it('lights the walls from the storm sky, and grades them clear and cool, not murky', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    const walls = at(36.2);
    expect(walls.key.intensity).toBeCloseTo(0.45, 2);
    expect(walls.key.color).toEqual([205, 214, 218]);
    expect(walls.key.softness).toBeCloseTo(12, 6);
    // From high on the sun's side.
    const sun = walls.sky.sunDirection;
    expect(-walls.key.direction[2]).toBeGreaterThan(sun[2]);
    expect(-walls.key.direction[0] * sun[0] - walls.key.direction[1] * sun[1]).toBeGreaterThan(0);
    expect(walls.ambient.intensity).toBeCloseTo(0.48, 6);
    expect(walls.shadowColor[3]).toBeCloseTo(0.35, 6);
    expect(walls.grade).toMatchObject({
      exposure: -0.1,
      contrast: 1.1,
      saturation: 0.72,
      warmth: -0.18,
      vignette: 0.42
    });
    expect(walls.grade.grain).toBeCloseTo(0.12, 6);
    // The second wall's toe is deeper, for the darks its brimming water takes from the frame.
    expect(at(42.2).grade).toMatchObject({
      exposure: -0.1,
      contrast: 1.26,
      saturation: 0.72,
      warmth: -0.18,
      vignette: 0.42
    });
    // And it comes in under the eye's own grade, so no frame shows the change.
    for (let t = HURRICANE.eyeOpen + 0.6; t <= HURRICANE.eyeClose - 0.2; t += 1 / 30) {
      const step = Math.abs(at(t + 1 / 30).grade.contrast - at(t).grade.contrast);
      expect(step, `contrast step at t=${t}`).toBeLessThan(0.002);
    }
    expect(walls.fog.color).toEqual([172, 182, 184]);
    // The fog thickens at a squall's peak, and is thinner between.
    expect(walls.fog.density).toBeCloseTo(0.006 * 1.6, 6);
    expect(at(35.6).fog.density).toBeLessThan(walls.fog.density);
    expect(at(36.2).key.intensity).toBeLessThan(at(32).key.intensity * 0.25);
    // The deck's edge drains the key as it passes the view at 33.0.
    expect(at(33).key.intensity).toBeCloseTo(1, 1);
  });

  it("runs the deck's shadow out across the grove as it comes, and the sun after it as it clears", () => {
    const at = (t: number) => getStoryState(t, PORTRAIT);
    // The ground in the middle column of the frame, `y` of the way up from its middle to its top.
    const getGround = (state: StoryState, y: number): [number, number] => {
      const {camera} = state;
      const eye = getCameraEye(camera);
      const forward = getCameraForward(camera);
      const flat = Math.hypot(forward[0], forward[1]);
      const right: Vec3 = [forward[1] / flat, -forward[0] / flat, 0];
      const up: Vec3 = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0]
      ];
      const tangent = Math.tan((camera.fovy / 2) * (Math.PI / 180)) * y;
      const ray = [0, 1, 2].map(axis => forward[axis] + up[axis] * tangent);
      const run = -eye[2] / ray[2];
      expect(run, `the ground ${y} up the frame`).toBeGreaterThan(0);
      return [eye[0] + ray[0] * run, eye[1] + ray[1] * run];
    };
    // The key light there, as `StoryDeckShadow` says a layer works it out.
    const getKey = (state: StoryState, point: readonly [number, number]) => {
      const {direction, position, softness, shaded, sunlit} = state.sky.deckShadow;
      const along = point[0] * direction[0] + point[1] * direction[1];
      const u = Math.min(1, Math.max(0, (along - position + softness) / (2 * softness)));
      return state.key.intensity * (shaded + (sunlit - shaded) * u * u * (3 - 2 * u));
    };
    // No edge outside the arrival and the clearing: a layer that reads it changes nothing there.
    for (const t of [20, 31, 36.2, 39.2, 42.2, 47, 0.1, 63.9]) {
      expect(at(t).sky.deckShadow).toMatchObject({shaded: 1, sunlit: 1});
    }
    // In the 33.2 frame the near rows at its foot are in the deck's light, and the far ones up the
    // middle are still in the sun.
    const arrival = at(33.2);
    expect(getKey(arrival, getGround(arrival, -0.9))).toBeLessThan(0.6);
    expect(getKey(arrival, getGround(arrival, 0.3))).toBeGreaterThan(2);
    // The edge runs out away from the lens, at about 30 m/s.
    const forward = getCameraForward(arrival.camera);
    const {direction} = arrival.sky.deckShadow;
    expect(direction[0] * forward[0] + direction[1] * forward[1]).toBeGreaterThan(0.6);
    const speed = (at(33.6).sky.deckShadow.position - at(33).sky.deckShadow.position) / 0.6;
    expect(speed).toBeGreaterThan(25);
    expect(speed).toBeLessThan(40);
    // It passes the view centre about as the key there falls, at 33.0.
    const passing = at(33);
    const centre: [number, number] = [passing.camera.target[0], passing.camera.target[1]];
    expect(Math.abs(getKey(passing, centre) - passing.key.intensity)).toBeLessThan(0.4);
    // By the first wall the deck is over everything.
    expect(at(HURRICANE.firstWall).sky.deckShadow).toMatchObject({shaded: 1, sunlit: 1});
    // Clearing, the gold sun is on the near ground in the 44.9 frame, and the far rows under the
    // departing deck have only some of it.
    const clearing = at(44.9);
    const sun = getKey(clearing, getGround(clearing, -0.9));
    expect(sun).toBeCloseTo(clearing.key.intensity, 1);
    expect(getKey(clearing, getGround(clearing, 0.3))).toBeLessThan(sun * 0.7);
  });

  it('lets the true sun into the eye, and a gold one under the deck as it clears', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    const eye = at(39.2);
    const {elevation} = getSunAngles(eye);
    expect(elevation).toBeGreaterThan(50);
    expect(elevation).toBeLessThan(60);
    expect(eye.key.intensity).toBeGreaterThan(1);
    expect(eye.key.softness).toBeLessThan(3);
    expect(eye.grade.saturation).toBeCloseTo(0.9, 2);
    expect(eye.grade.bloom).toBeCloseTo(0.25, 2);
    expect(eye.fog.density).toBeCloseTo(0.002, 4);
    expect(eye.weather.mist).toBeCloseTo(0.5, 2);
    const clear = at(45.6);
    expect(clear.key.intensity).toBeGreaterThan(1.8);
    expect(clear.key.color).toEqual([255, 215, 170]);
    expect(clear.grade.warmth).toBeCloseTo(0.28, 2);
    expect(getSunAngles(clear).elevation).toBeGreaterThan(15);
    expect(getSunAngles(clear).elevation).toBeLessThan(26);
    expect(at(44).key.intensity).toBeLessThan(0.6);
  });

  it('brings the magic with sparkle, motes, petals and a ring, and only then', () => {
    const at = (t: number) => getStoryState(t, LANDSCAPE);
    expect(at(26.5).ground.magicRing.strength).toBe(0);
    expect(at(29).ground.magicRing.strength).toBeGreaterThan(0.7);
    expect(at(29).ground.magicRing.radius).toBeGreaterThan(5);
    expect(at(29).weather.sparkle).toBeGreaterThan(0.7);
    expect(at(29.4).weather.petals).toBeGreaterThan(0.5);
    expect(at(29.4).weather.motes).toBeGreaterThan(0.8);
    expect(at(33).ground.magicRing.strength).toBe(0);
    expect(at(36).weather.sparkle).toBe(0);
    expect(at(5.6).weather.sparkle).toBeGreaterThan(0.1);
    expect(at(5.6).weather.sparkle).toBeLessThan(0.3);
    expect(at(27.2).ground.rows.strength).toBe(0);
    expect(at(36).ground.rows.strength).toBe(1);
    expect(at(36).ground.rows.reach).toBeGreaterThan(2000);
  });

  it('keeps every 0-1 value in range, and the wind in TreeLayer bounds, on the scene clock', () => {
    forEachFrame(state => {
      const {sky, weather, wind, grade, ground} = state;
      for (const value of [
        sky.cloudCover,
        sky.cloudBuild,
        sky.storm,
        sky.eye,
        sky.stars,
        sky.flash,
        weather.rain,
        weather.debris,
        weather.motes,
        weather.petals,
        weather.sparkle,
        weather.shaft,
        weather.mist,
        weather.curtains,
        weather.spray,
        ground.wetness,
        ground.frost,
        state.treeWetness,
        state.treeFrost,
        grade.bloom,
        grade.vignette,
        grade.grain,
        grade.fade,
        wind.strength,
        wind.gust
      ]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      expect(wind.bearing).toBeGreaterThanOrEqual(0);
      expect(wind.bearing).toBeLessThan(360);
      expect(wind.time).toBe(state.cycle.clock);
      expect(wind.gustTime).toBeGreaterThanOrEqual(wind.time);
      expect(sky.turbidity).toBeGreaterThanOrEqual(1.9);
      expect(sky.turbidity).toBeLessThanOrEqual(6);
    });
  });

  it('never fades: the picture is up in every frame', () => {
    forEachFrame(state => expect(state.grade.fade).toBe(1));
  });
});

describe('the gust clock', () => {
  const peaks = HURRICANE.gustPeaks;

  it('is the scene clock outside the storm, and runs back only in a breeze too light to show it', () => {
    const [from, to] = GUST_LOCK.unwind;
    let last = -Infinity;
    forEachFrame((state, t) => {
      const {time, gustTime, strength} = state.wind;
      // Exactly, so a frame drawn with `windGustTime` is the frame drawn without it.
      if (t < HURRICANE.arrive || t >= to) expect(gustTime, `t ${t}`).toBe(time);
      expect(gustTime).toBeGreaterThanOrEqual(time);
      if (t > from && t < to) {
        // Taking the storm off it again: below the trees' strong-wind start and the water's
        // cat's-paws, with no rain, and never faster than 3 times the scene clock backward.
        expect(strength, `t ${t}`).toBeLessThan(0.05);
        for (const tree of state.trees) expect(tree.wind ?? 0).toBeLessThan(TREE_WIND_STRONG_FROM);
        expect(state.weather.rain).toBe(0);
        expect((gustTime - last) * FRAME_RATE, `t ${t}`).toBeGreaterThan(-3);
      } else {
        expect(gustTime, `t ${t}`).toBeGreaterThan(last);
      }
      last = gustTime;
    });
    // Frames with no water and no storm, which must not change for passing it.
    for (const t of [20, 57.6]) {
      const {time, gustTime} = getStoryState(t, PORTRAIT).wind;
      expect(gustTime).toBe(time);
    }
    // Between the peaks it runs about as fast as the air, so fronts cross the grove with it.
    const gustTime = (t: number) => getStoryState(t, LANDSCAPE).wind.gustTime;
    const rate = (gustTime(peaks[2]) - gustTime(peaks[0])) / (peaks[2] - peaks[0]);
    expect(rate).toBeGreaterThan(3);
    expect(rate).toBeLessThan(6);
  });

  it('peaks a front at the view centre at each gust peak, once TreeLayer has its twin', () => {
    const probe = [0, 1.3, 2.6, 3.9].map(time =>
      getTreeWindGust({position: HURRICANE.viewPoint, time, direction: 15, strength: 0.7})
    );
    const hasTwin = Math.max(...probe) - Math.min(...probe) > 1e-6;
    for (const peak of peaks) {
      const gust = (t: number) => getStoryState(t, LANDSCAPE).wind.gust;
      if (hasTwin) {
        expect(gust(peak), `gust at ${peak}`).toBeGreaterThan(0.95);
        expect(gust(peak)).toBeGreaterThanOrEqual(gust(peak - 0.5));
        expect(gust(peak)).toBeGreaterThanOrEqual(gust(peak + 0.5));
      } else {
        expect(gust(peak)).toBe(0);
      }
    }
  });
});

describe('the timeline', () => {
  it('spans exactly 0 to 30 by the finale, and never less than what has passed', () => {
    forEachFrame(({timeline, year}) => {
      expect(timeline.spanStart).toBe(0);
      expect(timeline.spanEnd).toBeGreaterThanOrEqual(year);
      expect(timeline.spanEnd).toBeLessThanOrEqual(30);
    });
    for (const t of [57.4, 59, END]) {
      const {timeline} = getStoryState(t, LANDSCAPE);
      expect(timeline.spanStart).toBe(0);
      expect(timeline.spanEnd).toBe(30);
      expect(timeline.playhead).toBe(30);
    }
  });

  it('zooms out only, with the playhead 70 to 85 percent across for most of the cycle', () => {
    let last = 0;
    forEachFrame(({timeline, year}, t) => {
      expect(timeline.spanEnd).toBeGreaterThanOrEqual(last);
      last = timeline.spanEnd;
      if (t > 12 && year < 19) {
        const across = timeline.playhead / timeline.spanEnd;
        expect(across, `playhead across at t=${t}`).toBeGreaterThanOrEqual(0.7);
        expect(across, `playhead across at t=${t}`).toBeLessThanOrEqual(0.85);
      }
    });
    const early = getStoryState(0, LANDSCAPE).timeline;
    expect(early.spanEnd).toBeLessThan(10 / 365);
  });

  it('fades ticks through days, weeks, months, years and five years', () => {
    const ticks = (t: number) => getStoryState(t, LANDSCAPE).timeline.tickAlpha;
    expect(ticks(1).day).toBe(1);
    expect(ticks(1).year).toBe(0);
    expect(ticks(9.6).week).toBeGreaterThan(0.5);
    expect(ticks(11.2).month).toBeGreaterThan(0.5);
    expect(ticks(11.2).day).toBe(0);
    expect(ticks(27).year).toBe(1);
    expect(ticks(27).week).toBe(0);
    expect(ticks(27).month).toBe(0);
    expect(ticks(END).fiveYears).toBe(1);
    expect(ticks(END).year).toBe(1);
    expect(ticks(END).day).toBe(0);
    forEachFrame(({timeline}) => {
      for (const alpha of Object.values(timeline.tickAlpha)) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
    });
  });

  it('raises bars in order, with a broken one for the storm and a low one after', () => {
    const {bars} = getStoryState(END, LANDSCAPE).timeline;
    expect(bars.length).toBe(YIELD_TABLE.length);
    for (let index = 1; index < bars.length; index++) {
      expect(bars[index].year).toBeGreaterThan(bars[index - 1].year);
    }
    bars.forEach(bar => expect(bar.rise).toBe(1));
    const broken = bars.filter(bar => bar.broken);
    expect(broken.length).toBe(1);
    expect(broken[0].year).toBeGreaterThan(19.5);
    expect(broken[0].year).toBeLessThan(19.53);
    expect(broken[0].boxes).toBeLessThan(2);
    const next = bars[bars.indexOf(broken[0]) + 1];
    expect(next.boxes).toBeLessThan(1);
    const peak = Math.max(...bars.slice(0, bars.indexOf(broken[0])).map(bar => bar.boxes));
    expect(bars[bars.length - 1].boxes).toBeGreaterThan(peak);
    const boxesIn = (year: number) => YIELD_TABLE.find(row => row.year === year)?.boxes;
    expect(boxesIn(4)).toBeCloseTo(0.1, 5);
    expect(boxesIn(8)).toBeCloseTo(2, 5);
    expect(boxesIn(15)).toBeCloseTo(4.5, 5);
    expect(boxesIn(30)).toBeCloseTo(7, 5);
    let count = 0;
    forEachFrame(({timeline}) => {
      expect(timeline.bars.length).toBeGreaterThanOrEqual(count);
      count = timeline.bars.length;
      for (const bar of timeline.bars) {
        expect(bar.rise).toBeGreaterThanOrEqual(0);
        expect(bar.rise).toBeLessThanOrEqual(1);
      }
    });
  });

  it('shows flags in order as they are reached, each staying once it has', () => {
    let seen: string[] = [];
    const order = FLAG_TABLE.map(flag => flag.id);
    forEachFrame(({timeline}) => {
      const ids = timeline.flags.map(flag => flag.id);
      expect(ids.slice(0, seen.length)).toEqual(seen);
      expect(ids).toEqual(order.slice(0, ids.length));
      seen = ids;
      for (const flag of timeline.flags) {
        expect(flag.year).toBeLessThanOrEqual(timeline.playhead + 1e-9);
        expect(flag.alpha).toBeGreaterThanOrEqual(0);
        expect(flag.alpha).toBeLessThanOrEqual(1);
      }
    });
    expect(seen).toEqual(order);
    expect(order).toEqual([
      'seed',
      'sprout',
      'potted',
      'net',
      'planted',
      'first-bloom',
      'first-harvest',
      'grove',
      'hurricane',
      'flood',
      'replanted',
      'year-30'
    ]);
    const flags = getStoryState(END, LANDSCAPE).timeline.flags;
    flags.forEach(flag => expect(flag.alpha).toBe(1));
    const yearOf = (id: string) => flags.find(flag => flag.id === id)?.year as number;
    expect(yearOf('first-bloom')).toBeCloseTo(3, 0);
    expect(yearOf('first-harvest')).toBeCloseTo(4, 0);
    expect(yearOf('hurricane')).toBeCloseTo(19.5, 1);
    expect(yearOf('flood')).toBeCloseTo(19.5, 1);
    expect(yearOf('year-30')).toBe(30);
  });

  it('reads days, weeks, months and years, with the season beneath', () => {
    expect(getReadout(0)).toBe('Day 0');
    expect(getReadout(12 / 365)).toBe('Day 12');
    expect(getReadout(35 / 365)).toBe('Week 5');
    expect(getReadout(7 / 12 + 0.001)).toBe('Month 7');
    expect(getReadout(12.5)).toBe('Year 12');
    expect(getStoryState(END, LANDSCAPE).timeline.readout).toBe('Year 30');
    expect(getStoryState(1, LANDSCAPE).timeline.readout).toBe('Day 0');
    expect(getStoryState(1, LANDSCAPE).timeline.subReadout).toBe('Spring');
    expect(getStoryState(19.5, LANDSCAPE).timeline.subReadout).toBe('Spring');
    expect(getStoryState(20.6, LANDSCAPE).timeline.subReadout).toBe('Summer');
    expect(getStoryState(21.4, LANDSCAPE).timeline.subReadout).toBe('Autumn');
    expect(getStoryState(22.2, LANDSCAPE).timeline.subReadout).toBe('Winter');
  });

  it('has no yield until the first harvest, then this year and the total', () => {
    expect(getStoryState(12, LANDSCAPE).timeline.yield).toBeNull();
    const firstBar = getSecondOfYear(3.92);
    expect(getStoryState(firstBar - 0.05, LANDSCAPE).timeline.yield).toBeNull();
    const after = getStoryState(firstBar + 0.4, LANDSCAPE).timeline.yield;
    expect(after?.thisYear).toBeGreaterThan(0.05);
    expect(after?.thisYear).toBeLessThanOrEqual(0.1);
    expect(after?.total).toBeCloseTo(after?.thisYear as number, 9);
    const end = getStoryState(LOOP.fileStart, LANDSCAPE).timeline.yield;
    expect(end?.thisYear).toBe(7);
    const total = YIELD_TABLE.reduce((sum, row) => sum + row.boxes, 0);
    expect(end?.total).toBeCloseTo(total, 6);
  });

  it('is on in every frame, with no fade at either end', () => {
    forEachFrame(({timeline}) => expect(timeline.alpha).toBe(1));
  });
});

describe('captions', () => {
  it('are short, and never overlap', () => {
    for (let index = 0; index < CAPTION_TABLE.length; index++) {
      const {start, end} = CAPTION_TABLE[index];
      expect(end).toBeGreaterThan(start);
      if (index > 0) expect(start).toBeGreaterThanOrEqual(CAPTION_TABLE[index - 1].end);
    }
    const texts = new Set<string>();
    forEachFrame(({caption}) => {
      if (caption) {
        texts.add(caption.text);
        expect(caption.text.split(' ').length).toBeLessThanOrEqual(4);
        expect(caption.alpha).toBeGreaterThanOrEqual(0);
        expect(caption.alpha).toBeLessThanOrEqual(1);
      }
    });
    expect(texts.size).toBe(14);
    expect(getStoryState(0, LANDSCAPE).caption).toBeNull();
    expect(getStoryState(END, LANDSCAPE).caption).toBeNull();
    expect(getStoryState(LOOP.fileStart, LANDSCAPE).caption).toMatchObject({
      text: 'Thirty years',
      alpha: 1
    });
  });
});
