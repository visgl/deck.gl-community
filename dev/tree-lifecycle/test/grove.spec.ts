// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {CropConfig, TreeSpec} from '@deck.gl-community/layers';
import {describe, expect, it, vi} from 'vitest';
import {
  getBloomYear,
  getCrownFraction,
  getHeightFraction,
  getSceneSeconds,
  getYear,
  getYearRate,
  HURRICANE,
  isInSeamWindow,
  LOOP
} from '../story/beats';
import {getCameraEye, getCameraForward} from '../story/camera';
import {getEnvironment} from '../story/environment';
import {getDaysUnderWater, getWaterLevel} from '../story/flood';
import {
  CROP_TABLE,
  DECLINE_TABLE,
  EXPOSURE_TABLE,
  FALL_TABLE,
  GROVE_PLAN,
  type GrovePlanRow,
  getMagicRing,
  getReplantNets,
  getReplantSites,
  getSplashes,
  LEAN_TABLE,
  MAGIC_TABLE,
  REPLANT_TABLE,
  SPLASH_TABLE,
  STORM_TABLE,
  writeTrees
} from '../story/grove';
import {BED_LAYOUT, getLandHeight} from '../story/land';
import {getStoryState} from '../story/story';
import type {StoryNet, Vec3} from '../story/story-types';

// Some of these walk every frame of the cycle, and the machine may be busy.
vi.setConfig({testTimeout: 120000});

const FRAME_RATE = 30;
const PORTRAIT = {aspect: 9 / 16};

type Faller = GrovePlanRow & {fall: NonNullable<GrovePlanRow['fall']>};

const GROVE = GROVE_PLAN.filter(row => row.kind === 'grove');
const FALLERS = GROVE.filter((row): row is Faller => Boolean(row.fall));
const SURVIVORS = GROVE.filter(row => !row.fall);
const LEANERS = SURVIVORS.filter(row => row.heel);
const REPLANTS = GROVE_PLAN.filter(row => row.kind === 'replant');

/** Copies of the numbers of each tree at cycle second `t`, as `getStoryState` composes them. */
function getTreesAt(t: number): TreeSpec[] {
  return structuredClone(writeTrees(t, getYear(t), getYearRate(t), getEnvironment(t).wind));
}

/** The grove tree planted at a grid position, before its jitter. */
function getRowAt(x: number, y: number): GrovePlanRow {
  const row = GROVE.find(
    item => Math.abs(item.position[0] - x) < 0.5 && Math.abs(item.position[1] - y) < 0.5
  );
  if (!row) throw new Error(`No grove tree at ${x}, ${y}`);
  return row;
}

function getLean(tree: TreeSpec): number {
  return (tree.lean as number[])[0];
}

function getFruit(tree: TreeSpec): CropConfig {
  return (tree.crop as CropConfig[])[1];
}

function getBlossom(tree: TreeSpec): CropConfig {
  return (tree.crop as CropConfig[])[0];
}

/** A tree's own canopy tint, or `null` for the species' own. */
function getCanopy(tree: TreeSpec): number[] | null {
  return tree.canopyColor ? Array.from(tree.canopyColor as ArrayLike<number>) : null;
}

function getMean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Degrees between two compass bearings. */
function getBearingOff(bearing: number, toward: number): number {
  return Math.abs(((bearing - toward + 540) % 360) - 180);
}

/** Where a fallen tree's crown lies: its trunk, plus this share of its live height along its fall. */
function getAlongFall(row: Faller, t: number, share: number): [number, number] {
  const tree = getTreesAt(t)[row.index];
  const reach = share * row.height * getHeightFraction(tree.growth as number);
  const radians = row.fall.bearing * (Math.PI / 180);
  return [row.position[0] + Math.sin(radians) * reach, row.position[1] + Math.cos(radians) * reach];
}

describe('the grove plan', () => {
  it('fells 18% of the grove, the four forced falls among them, never by the camera', () => {
    expect(FALLERS.length).toBe(Math.round(GROVE.length * FALL_TABLE.fraction));
    for (const {x, y, wall, start, seconds} of FALL_TABLE.forced) {
      const row = getRowAt(x, y);
      expect(row.fall?.wall).toBe(wall);
      expect(row.fall?.start).toBe(start);
      expect(row.fall?.seconds).toBe(seconds);
    }
    const {standing} = FALL_TABLE;
    for (const row of GROVE) {
      const [x, y] = row.position;
      const inBox =
        x >= standing.x[0] && x <= standing.x[1] && y >= standing.y[0] && y <= standing.y[1];
      if (inBox) expect(row.fall, `tree ${row.index} by the camera falls`).toBeNull();
      if (inBox) expect(row.heel, `tree ${row.index} by the camera leans`).toBeNull();
    }
    expect(GROVE_PLAN[0].fall).toBeNull();
    expect(GROVE_PLAN[0].heel).toBeNull();
  });

  it('runs the swath falls downwind through each wall, each down before its wall ends', () => {
    const forced = new Set(FALL_TABLE.forced.map(({x, y}) => getRowAt(x, y).index));
    for (const row of FALLERS) {
      const {fall} = row;
      const wind = HURRICANE.firstWallBearing + (fall.wall === 1 ? 0 : 180);
      expect(getBearingOff(fall.bearing, wind)).toBeLessThanOrEqual(
        FALL_TABLE.bearingSpread + 0.01
      );
      expect(fall.seconds).toBeGreaterThanOrEqual(FALL_TABLE.seconds[0]);
      expect(fall.seconds).toBeLessThanOrEqual(FALL_TABLE.seconds[1] + 0.01);
      const end = fall.start + fall.seconds;
      if (fall.wall === 1) {
        expect(fall.start).toBeGreaterThan(HURRICANE.firstWall);
        expect(end).toBeLessThanOrEqual(FALL_TABLE.firstWallDoneBy + 1e-9);
      } else {
        expect(fall.start).toBeGreaterThan(HURRICANE.eyeClose);
        expect(end).toBeLessThanOrEqual(FALL_TABLE.secondWallDoneBy + 1e-9);
      }
      if (!forced.has(row.index)) {
        const span = fall.wall === 1 ? HURRICANE.firstWallFalls : HURRICANE.secondWallFalls;
        expect(fall.start).toBeGreaterThanOrEqual(span[0]);
        expect(fall.start).toBeLessThanOrEqual(span[1]);
        expect(Math.hypot(row.position[0], row.position[1])).toBeGreaterThan(
          FALL_TABLE.heroClear - 0.5
        );
      }
    }
    // Downwind: the first wall's swath goes from the south-south-west, the second's from the other end.
    const swaths = FALLERS.filter(row => !forced.has(row.index));
    const mean = (rows: Faller[]) => getMean(rows.map(row => row.fall.start));
    for (const wall of [1, 2] as const) {
      const own = swaths.filter(row => row.fall.wall === wall);
      const south = own.filter(row => row.position[1] < 0);
      const north = own.filter(row => row.position[1] > 0);
      expect(south.length).toBeGreaterThan(0);
      expect(north.length).toBeGreaterThan(0);
      if (wall === 1) expect(mean(south)).toBeLessThan(mean(north));
      else expect(mean(north)).toBeLessThan(mean(south));
    }
  });

  it('leans 12% of the survivors toward their wall, clear of the hero and the low cameras', () => {
    expect(LEANERS.length).toBe(Math.round(SURVIVORS.length * LEAN_TABLE.share));
    const after = getTreesAt(45);
    const {finale} = LEAN_TABLE;
    for (const row of LEANERS) {
      const [x, y] = row.position;
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(LEAN_TABLE.heroClear);
      expect(x >= finale.x[0] && x <= finale.x[1] && y >= finale.y[0] && y <= finale.y[1]).toBe(
        false
      );
      const [degrees, bearing] = after[row.index].lean as number[];
      expect(degrees).toBeGreaterThanOrEqual(LEAN_TABLE.degrees[0] - 1e-6);
      expect(degrees).toBeLessThanOrEqual(LEAN_TABLE.degrees[1] + 1e-6);
      const offFirst = getBearingOff(bearing, HURRICANE.firstWallBearing);
      expect(Math.min(offFirst, 180 - offFirst)).toBeLessThanOrEqual(
        LEAN_TABLE.bearingSpread + 0.01
      );
    }
    // No other survivor leans at all.
    for (const row of SURVIVORS) if (!row.heel) expect(getLean(after[row.index])).toBe(0);
  });

  it('steps the leaners up as the fronts reach them, and holds them through the eye', () => {
    for (const row of LEANERS) {
      const steps = (row.heel as NonNullable<GrovePlanRow['heel']>).steps;
      const ups = steps.filter(step => step.permanent > 0);
      expect(ups.length).toBe(3);
      for (const {at} of ups) {
        const before = getLean(getTreesAt(at - 0.6)[row.index]);
        const after = getLean(getTreesAt(at + 0.02)[row.index]);
        expect(after - before, `leaner ${row.index} at ${at}`).toBeGreaterThan(0.2);
      }
    }
    // The eye is calm: whatever leaned for good stays put.
    const open = getTreesAt(HURRICANE.eyeOpen + 1);
    const close = getTreesAt(HURRICANE.eyeClose - 0.5);
    for (const row of LEANERS) {
      expect(getLean(close[row.index])).toBeCloseTo(getLean(open[row.index]), 6);
    }
  });

  it('sets the living leaners back up while the gaps are replanted, and leaves the dead to go', () => {
    const before = getTreesAt(LEAN_TABLE.reset[0] - 0.01);
    const after = getTreesAt(LEAN_TABLE.reset[1] + 0.01);
    for (const row of LEANERS) {
      const lean = getLean(before[row.index]);
      if (row.decline?.dies) {
        expect(row.heel?.reset).toBeNull();
      } else {
        expect(getLean(after[row.index])).toBeCloseTo(lean * LEAN_TABLE.kept, 6);
        expect(getLean(getTreesAt(60)[row.index])).toBeCloseTo(lean * LEAN_TABLE.kept, 6);
      }
    }
  });

  it('stands every tree on the land under its trunk', () => {
    for (const row of GROVE_PLAN) {
      expect(row.elevation).toBeCloseTo(getLandHeight(row.position[0], row.position[1]), 9);
    }
    for (const t of [30, 40, 46.4, 52.4, 60]) {
      const trees = getTreesAt(t);
      GROVE_PLAN.forEach((row, index) => {
        if (row.kind === 'grove') expect(trees[index].elevation).toBeCloseTo(row.elevation, 9);
      });
    }
    // The hero's planting lifts it, from the land at its own feet.
    expect(getTreesAt(60)[0].elevation).toBeCloseTo(GROVE_PLAN[0].elevation, 6);
  });
});

describe('the wind on each tree', () => {
  it('gives the windward edges of the block the most wind, the hero and the camera less', () => {
    const exposures = GROVE.map(row => row.exposure);
    expect(Math.max(...exposures.map(([first]) => first))).toBeCloseTo(EXPOSURE_TABLE.edge, 6);
    expect(Math.max(...exposures.map(([, second]) => second))).toBeCloseTo(EXPOSURE_TABLE.edge, 6);
    for (const row of GROVE) {
      for (const share of row.exposure) {
        expect(share).toBeGreaterThanOrEqual(EXPOSURE_TABLE.byCamera);
        expect(share).toBeLessThanOrEqual(EXPOSURE_TABLE.edge);
      }
    }
    // The first wall comes from the south-south-west: the south edge takes it, the north edge is in its lee.
    const southEdge = GROVE.filter(row => row.position[1] < -29);
    const northEdge = GROVE.filter(row => row.position[1] > 29);
    expect(getMean(southEdge.map(row => row.exposure[0]))).toBeGreaterThan(1.1);
    expect(getMean(northEdge.map(row => row.exposure[0]))).toBeLessThan(0.95);
    expect(getMean(northEdge.map(row => row.exposure[1]))).toBeGreaterThan(1.1);
    expect(getMean(southEdge.map(row => row.exposure[1]))).toBeLessThan(0.95);
    expect(GROVE_PLAN[0].exposure).toEqual([EXPOSURE_TABLE.hero, EXPOSURE_TABLE.hero]);
    for (const [x, y] of [
      [-27, 0],
      [-24, 7.6],
      [-30, 7.6]
    ]) {
      expect(getRowAt(x, y).exposure).toEqual([EXPOSURE_TABLE.byCamera, EXPOSURE_TABLE.byCamera]);
    }
  });

  it('writes each tree the wind times its exposure, and none at all in the still air', () => {
    for (const t of [20, 33.2, 36.2, 39, 42.2, 44.9, 57.6]) {
      const state = getStoryState(t, PORTRAIT);
      const {strength, bearing} = state.wind;
      const first = (1 + Math.cos((bearing - HURRICANE.firstWallBearing) * (Math.PI / 180))) / 2;
      GROVE_PLAN.forEach((row, index) => {
        const tree = state.trees[index];
        if ((tree.growth as number) > 0) {
          const exposure = row.exposure[1] + (row.exposure[0] - row.exposure[1]) * first;
          expect(tree.wind as number).toBeCloseTo(Math.min(1, strength * exposure), 9);
        }
      });
    }
    for (let seam = LOOP.stillAir[0]; seam <= LOOP.stillAir[1]; seam += 0.25) {
      const t = (seam + 64) % 64;
      expect(isInSeamWindow(t, LOOP.stillAir)).toBe(true);
      for (const tree of getStoryState(t, PORTRAIT).trees) expect(tree.wind).toBe(0);
    }
  });
});

describe('the storm', () => {
  const northFirst = getRowAt(-12, 7.6) as Faller;
  const heroRowFirst = getRowAt(-15, 0) as Faller;
  const heroRowSecond = getRowAt(-9, 0) as Faller;
  const northSecond = getRowAt(-18, 7.6) as Faller;
  const leanOf = (row: GrovePlanRow, t: number) => getLean(getTreesAt(t)[row.index]);

  it('rocks the north-row tree at 34.9 and heels it 8 degrees at 36.2, then lays it down in the calm', () => {
    expect(leanOf(northFirst, 34.9)).toBeGreaterThan(2.6);
    expect(leanOf(northFirst, 34.9)).toBeLessThan(3.2);
    // It rocks back in the lull.
    expect(leanOf(northFirst, 35.6)).toBeLessThan(2);
    expect(leanOf(northFirst, 36.2)).toBeGreaterThan(7.4);
    expect(leanOf(northFirst, 36.2)).toBeLessThan(8.2);
    // Half down in the 37.45 flash, on the ground as the wind dies.
    expect(leanOf(northFirst, 37.45)).toBeGreaterThan(30);
    expect(leanOf(northFirst, 37.45)).toBeLessThan(50);
    expect(northFirst.fall.start + northFirst.fall.seconds).toBeCloseTo(38.35, 6);
    expect(leanOf(northFirst, 38.36)).toBeGreaterThan(84);
    // Away from the furrow, to the north-north-east.
    expect(northFirst.fall.bearing).toBe(HURRICANE.firstWallBearing);
  });

  it('crashes the first wall’s hero-row tree across the furrow in clear view, on its last front', () => {
    // It heels hard on the second front and is down on the third, in the 37.45 flash.
    const landed = heroRowFirst.fall.start + heroRowFirst.fall.seconds;
    expect(Math.abs(landed - HURRICANE.gustPeaks[2])).toBeLessThan(0.05);
    expect(leanOf(heroRowFirst, HURRICANE.gustPeaks[1])).toBeGreaterThan(10);
    expect(leanOf(heroRowFirst, HURRICANE.gustPeaks[1])).toBeLessThan(25);
    expect(leanOf(heroRowFirst, landed + 0.01)).toBeGreaterThan(84);
    expect(
      getBearingOff(heroRowFirst.fall.bearing, HURRICANE.firstWallBearing)
    ).toBeLessThanOrEqual(FALL_TABLE.bearingSpread);
    // Its top lies past the middle of the furrow, and its crown spans the water bank to bank.
    const [, topY] = getAlongFall(heroRowFirst, 39.9, 1);
    expect(topY).toBeGreaterThan(BED_LAYOUT.furrowAt);
    const [crownX, crownY] = getAlongFall(heroRowFirst, 39.9, SPLASH_TABLE.crownCentre);
    const tree = getTreesAt(39.9)[heroRowFirst.index];
    const crown = heroRowFirst.crownRadius * getCrownFraction(tree.growth as number);
    expect(Math.abs(crownY - BED_LAYOUT.furrowAt) + BED_LAYOUT.furrowTop / 2).toBeLessThan(crown);
    // From the flash through the eye's mirror it lies 10-16 m ahead, in the middle of the frame.
    for (const t of [37.5, 38.4, 39.9, 40.3]) {
      const {camera} = getStoryState(t, PORTRAIT);
      const eye = getCameraEye(camera);
      const forward = getCameraForward(camera);
      const flat = Math.hypot(forward[0], forward[1]);
      const ahead = ((crownX - eye[0]) * forward[0] + (crownY - eye[1]) * forward[1]) / flat;
      const across = ((crownX - eye[0]) * forward[1] - (crownY - eye[1]) * forward[0]) / flat;
      expect(ahead, `ahead at ${t}`).toBeGreaterThan(10);
      expect(ahead, `ahead at ${t}`).toBeLessThan(16);
      const halfWidth = Math.tan((camera.fovy / 2) * (Math.PI / 180)) * PORTRAIT.aspect;
      expect(Math.abs(across) / ahead, `across at ${t}`).toBeLessThan(halfWidth * 0.5);
    }
  });

  it('rocks both second-wall trees at 40.9, and sends the hero-row tree away from the furrow', () => {
    for (const row of [heroRowSecond, northSecond]) {
      expect(leanOf(row, 40.9)).toBeGreaterThan(3.4);
      expect(leanOf(row, 40.9)).toBeLessThan(4.2);
      expect(getBearingOff(row.fall.bearing, HURRICANE.firstWallBearing + 180)).toBeLessThan(0.01);
    }
    expect(heroRowSecond.fall.start).toBe(41);
    expect(heroRowSecond.fall.start + heroRowSecond.fall.seconds).toBeCloseTo(43.1, 6);
    // Going over in the worst of it.
    expect(leanOf(heroRowSecond, 42.2)).toBeGreaterThan(15);
    expect(leanOf(heroRowSecond, 42.2)).toBeLessThan(45);
  });

  it('heels the north-row tree 9 degrees at 42.2 and crashes its crown into the water at 43.4', () => {
    expect(leanOf(northSecond, 42.2)).toBeGreaterThan(8);
    expect(leanOf(northSecond, 42.2)).toBeLessThan(10);
    expect(northSecond.fall.start + northSecond.fall.seconds).toBeCloseTo(43.4, 6);
    expect(leanOf(northSecond, 43.41)).toBeGreaterThan(84);
    const crown = getSplashes(43.45).find(splash => splash.size === 3);
    expect(crown).toBeDefined();
    const [x, y, z] = (crown as {position: Vec3}).position;
    // 5-10 m ahead of the eye, over the furrow and its banks, on the water.
    expect(x).toBeGreaterThan(-25.5 + 5);
    expect(x).toBeLessThan(-26.5 + 10);
    expect(Math.abs(y - BED_LAYOUT.furrowAt)).toBeLessThan(BED_LAYOUT.furrowTop / 2 + 0.5);
    expect(z).toBeCloseTo(getWaterLevel(43.45), 9);
    expect(getWaterLevel(43.4)).toBeGreaterThan(getLandHeight(x, y));
  });

  it('lists each splash from the moment it hits, aged on the scene clock', () => {
    // The first wall's crash, into the furrow's water where its fall crosses it.
    const landed = heroRowFirst.fall.start + heroRowFirst.fall.seconds;
    const crashSize = FALL_TABLE.forced.find(({x, y}) => x === -15 && y === 0)?.splash;
    expect(getSplashes(landed - 0.02)).toEqual([]);
    const crash = getSplashes(landed + 0.05);
    expect(crash.map(splash => splash.size)).toEqual([crashSize]);
    const [crashX, crashY, crashZ] = crash[0].position;
    expect(crashY).toBeCloseTo(BED_LAYOUT.furrowAt, 6);
    expect(crashZ).toBeCloseTo(getWaterLevel(landed + 0.05), 9);
    expect(getWaterLevel(landed)).toBeGreaterThan(getLandHeight(crashX, crashY));
    expect(crashX).toBeGreaterThan(heroRowFirst.position[0]);
    expect(getSplashes(42.55)).toEqual([]);
    const limb = getSplashes(42.7);
    expect(limb.length).toBe(1);
    expect(limb[0].size).toBe(SPLASH_TABLE.limb.size);
    expect(limb[0].age).toBeCloseTo(
      getSceneSeconds(42.7) - getSceneSeconds(SPLASH_TABLE.limb.t),
      9
    );
    expect(limb[0].position[0]).toBeLessThan(BED_LAYOUT.crossing.x[0]);
    expect(
      getSplashes(43.5)
        .map(splash => splash.size)
        .sort()
    ).toEqual([0.8, 3]);
    expect(getSplashes(43.4 + SPLASH_TABLE.lasts + 0.05)).toEqual([]);
    for (const t of [10, 33, 37.4, 50, 60]) expect(getSplashes(t)).toEqual([]);
  });

  it('strips leaves and fruit in bursts at the peaks, and holds between them', () => {
    const row = SURVIVORS.find(item => !item.heel && !item.decline && item.storm.leafLoss > 0.3);
    if (!row) throw new Error('No plain survivor');
    const {leafLoss} = row.storm;
    const stripAt = (t: number) => (1 - (getTreesAt(t)[row.index].foliage as number)) / leafLoss;
    expect(stripAt(34.4)).toBeCloseTo(0, 6);
    const plateaus = [
      [35.5, 35.95, 0.15],
      [36.8, 37.25, 0.33],
      [37.95, 38.2, 0.5],
      [41.35, 41.95, 0.68],
      [42.65, 43.15, 0.88],
      [43.85, 47, 1]
    ];
    for (const [from, to, share] of plateaus) {
      expect(stripAt(from), `strip at ${from}`).toBeCloseTo(share, 6);
      expect(stripAt(to), `strip at ${to}`).toBeCloseTo(share, 6);
    }
    expect(stripAt(HURRICANE.eyeClose)).toBeCloseTo(STORM_TABLE.shareThroughEye, 6);
  });

  it('loses no leaves off a standing tree while the wind drops into the eye or comes back', () => {
    // TreeLayer's leaves in the air follow the wind of the moment, so none may be in flight then.
    // A tree going down sheds its own as it lands, where the wind no longer holds it.
    const standing = [GROVE_PLAN[0], ...SURVIVORS];
    for (const [from, to] of [
      [38, 38.7],
      [40.2, 40.6]
    ]) {
      const first = getTreesAt(from);
      for (let t = from; t <= to + 1e-9; t += 1 / 30) {
        const trees = getTreesAt(t);
        for (const row of standing) {
          expect(trees[row.index].foliage as number, `tree ${row.index} at ${t}`).toBeCloseTo(
            first[row.index].foliage as number,
            9
          );
        }
      }
    }
  });

  it('strips the hero to 0.6 by the eye and nearly bare in the second wall, and it stands', () => {
    const at = (t: number) => getTreesAt(t)[0];
    expect(at(34.4).foliage).toBeCloseTo(1, 6);
    expect(at(39).foliage as number).toBeCloseTo(0.6, 1);
    expect(at(42).foliage as number).toBeGreaterThan(0.5);
    expect(at(42.4).foliage as number).toBeLessThan(0.21);
    expect(getFruit(at(38.2)).fallen as number).toBeCloseTo(0.6, 2);
    expect(getFruit(at(44)).fallen as number).toBeCloseTo(0.9, 2);
    expect(at(38).damage as number).toBeGreaterThan(0.15);
    expect(at(41).damage as number).toBeLessThan(0.25);
    expect(at(43).damage as number).toBeCloseTo(0.45, 6);
    for (let t = 30; t < 64; t += 0.5) {
      const hero = at(t);
      expect(getLean(hero)).toBe(0);
      expect(hero.growth as number).toBeGreaterThan(0.5);
    }
  });

  it('drops the grove’s green fruit and twigs, and spares the trees by the camera', () => {
    const plain = SURVIVORS.filter(row => !row.decline);
    const endOfFirst = getTreesAt(HURRICANE.eyeOpen);
    const fallenFirst = getMean(plain.map(row => getFruit(endOfFirst[row.index]).fallen as number));
    expect(fallenFirst).toBeGreaterThan(0.3);
    expect(fallenFirst).toBeLessThan(0.42);
    const damageFirst = getMean(plain.map(row => endOfFirst[row.index].damage as number));
    expect(damageFirst).toBeGreaterThan(0.15);
    expect(damageFirst).toBeLessThan(0.25);
    const endOfSecond = getTreesAt(43.4 + STORM_TABLE.burst[1]);
    const fallenSecond = getMean(
      plain.map(row => getFruit(endOfSecond[row.index]).fallen as number)
    );
    expect(fallenSecond).toBeGreaterThan(0.68);
    expect(fallenSecond).toBeLessThan(0.82);
    for (const row of plain) {
      expect(getFruit(endOfSecond[row.index]).ripeness).toBe(0);
      expect(getFruit(getTreesAt(50.4)[row.index]).fallen as number).toBeCloseTo(1, 6);
    }
    for (const [x, y] of [
      [-27, 0],
      [-24, 7.6],
      [-30, 7.6]
    ]) {
      expect(endOfSecond[getRowAt(x, y).index].foliage as number).toBeGreaterThanOrEqual(
        1 - STORM_TABLE.grove.byCamera.leafLoss - 1e-9
      );
    }
  });

  it('browns the storm’s fallen fruit where it lies, and shrinks it away before the next crop', () => {
    const row = SURVIVORS.find(item => !item.decline) as GrovePlanRow;
    const green = getFruit(getTreesAt(47.7)[row.index]);
    expect(green.unripeColor?.slice(0, 3)).toEqual([86, 128, 44]);
    const brown = getFruit(getTreesAt(49.7)[row.index]);
    expect(brown.unripeColor?.slice(0, 3)).toEqual(STORM_TABLE.brown);
    expect(brown.count).toBeGreaterThan(0);
    expect(getFruit(getTreesAt(50.8)[row.index]).count).toBe(0);
    // The next crop comes in green, from nothing.
    for (let t = 50.6; t < 51.6; t += 1 / FRAME_RATE) {
      const fruit = getFruit(getTreesAt(t)[row.index]);
      if (getYear(t) > STORM_TABLE.fruitYear + 1.02) {
        expect(fruit.unripeColor?.slice(0, 3)).toEqual([86, 128, 44]);
      }
    }
  });

  it('keeps every standing tree green through the storm and the flood', () => {
    // TreeLayer browns a leaf once its tree's health is below that leaf's own mark, from 0.94 down:
    // what stays on stays green, and the drowned roots' yellowing is the only yellowing.
    const standing = [GROVE_PLAN[0], ...SURVIVORS];
    for (let t = HURRICANE.arrive; t <= DECLINE_TABLE.span[0]; t += 0.1) {
      const trees = getTreesAt(t);
      for (const row of standing) {
        const tree = trees[row.index];
        if ((tree.growth as number) > 0) {
          expect(tree.health as number, `tree ${row.index} at ${t.toFixed(1)}`).toBeGreaterThan(
            0.95
          );
          expect(tree.canopyColor).toBeNull();
        }
      }
    }
  });

  it('keeps a wreck green through the flood, wilts it over the days after and browns it', () => {
    const healthAt = (row: Faller, t: number) => getTreesAt(t)[row.index].health as number;
    for (const row of FALLERS) {
      const landed = row.fall.start + row.fall.seconds;
      for (const t of [landed + 0.05, Math.max(landed + 0.05, 44.9), 46.4, 47.8]) {
        expect(healthAt(row, t), `wreck ${row.index} at ${t}`).toBeGreaterThan(0.95);
      }
      // It keeps what leaves the walls left it through the flood.
      expect(getTreesAt(47.8)[row.index].foliage as number).toBeGreaterThan(0.2);
      expect(healthAt(row, 48.4)).toBeGreaterThan(0.9);
      expect(healthAt(row, 49.6)).toBeLessThan(0.6);
      expect(healthAt(row, 49.6)).toBeGreaterThan(0.3);
      expect(healthAt(row, 50.4)).toBeLessThan(0.1);
    }
  });
});

describe('the flood and the drowned roots', () => {
  const declining = SURVIVORS.filter(row => row.decline);
  const dead = declining.filter(row => row.decline?.dies);

  it('declines the survivors that stood more than three days in water: about a quarter, in the low east', () => {
    for (const row of SURVIVORS) {
      const days = getDaysUnderWater(row.elevation);
      expect(Boolean(row.decline), `tree ${row.index}, ${days.toFixed(2)} days`).toBe(
        days > DECLINE_TABLE.days
      );
    }
    const share = declining.length / SURVIVORS.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.32);
    const east = declining.filter(row => row.position[0] > 10);
    expect(east.length / declining.length).toBeGreaterThan(0.75);
    expect(getDaysUnderWater(GROVE_PLAN[0].elevation)).toBeLessThan(DECLINE_TABLE.days);
    expect(GROVE_PLAN[0].decline).toBeNull();
  });

  it('kills the five lowest, and replants them', () => {
    expect(dead.length).toBe(Math.min(DECLINE_TABLE.dead, declining.length));
    const highestDead = Math.max(...dead.map(row => row.elevation));
    for (const row of declining) {
      if (!row.decline?.dies) expect(row.elevation).toBeGreaterThanOrEqual(highestDead);
    }
    for (const row of dead) {
      const replant = GROVE_PLAN[row.replacement as number];
      expect(replant.kind).toBe('replant');
      expect(replant.replaces).toBe(row.index);
      expect(replant.position).toEqual(row.position);
      expect(replant.arrival).toBeCloseTo((row.decline as {goneAt: number}).goneAt, 9);
    }
  });

  it('yellows, wilts and thins the decliners, and greys the dead', () => {
    const before = getTreesAt(48.9);
    const turned = getTreesAt(DECLINE_TABLE.span[1]);
    const deadAt = getTreesAt(DECLINE_TABLE.deadSpan[1]);
    for (const row of declining) {
      expect(before[row.index].canopyColor).toBeNull();
      const tree = turned[row.index];
      const color = getCanopy(tree) as number[];
      if (!row.decline?.dies || turned[row.index].growth) {
        expect(color.slice(0, 3)).toEqual(DECLINE_TABLE.color);
        expect(color[3]).toBe(255);
      }
      expect(tree.health as number).toBeLessThanOrEqual(DECLINE_TABLE.health + 1e-9);
      expect(tree.foliage as number).toBeLessThanOrEqual(DECLINE_TABLE.foliage + 1e-9);
      expect(getFruit(tree).fallen).toBeCloseTo(1, 9);
      expect(tree.flush as number).toBeLessThan(1e-9);
    }
    for (const row of dead) {
      const tree = deadAt[row.index];
      expect(tree.health as number).toBeLessThanOrEqual(DECLINE_TABLE.deadHealth + 1e-9);
      expect(tree.foliage as number).toBeLessThanOrEqual(DECLINE_TABLE.deadFoliage + 1e-9);
      expect(tree.decay as number).toBeCloseTo(DECLINE_TABLE.deadDecay, 6);
      expect(tree.growth as number).toBeGreaterThan(0);
      const goneAt = (row.decline as {goneAt: number}).goneAt;
      expect(getTreesAt(goneAt + 0.01)[row.index].growth).toBe(0);
    }
    for (const row of SURVIVORS) {
      if (!row.decline) expect(turned[row.index].canopyColor).toBeNull();
    }
  });

  it('brings the decliners that live back by the regrowth', () => {
    const later = getTreesAt(56);
    for (const row of declining) {
      if (!row.decline?.dies) {
        const tree = later[row.index];
        expect(getCanopy(tree)?.slice(0, 3)).toEqual(DECLINE_TABLE.from);
        expect(tree.health as number).toBeCloseTo(1, 6);
        expect(tree.foliage as number).toBeCloseTo(1, 6);
      }
    }
  });

  it('flushes the hero first, the survivors in the west after it, and not the drowned', () => {
    const firstFlush = (index: number) => {
      for (let t = 48; t < 53; t += 0.05) {
        if ((getTreesAt(t)[index].flush as number) > 0.2) return t;
      }
      return Infinity;
    };
    const hero = firstFlush(0);
    expect(hero).toBeGreaterThan(STORM_TABLE.flush.rise[0]);
    expect(hero).toBeLessThan(STORM_TABLE.flush.rise[1]);
    const west = SURVIVORS.filter(row => !row.decline && row.position[0] < 0).slice(0, 12);
    for (const row of west) expect(firstFlush(row.index)).toBeGreaterThan(hero);
    const at = getTreesAt(50.2);
    expect(at[0].flush as number).toBeGreaterThan(0.85);
    for (const row of declining) expect(at[row.index].flush as number).toBeLessThan(0.45);
  });
});

describe('recovery', () => {
  it('replants every gap, toppled and drowned alike, at its own place, as the old tree goes', () => {
    const gaps = GROVE.filter(row => row.fall || row.decline?.dies);
    expect(REPLANTS.length).toBe(gaps.length);
    for (const row of gaps) {
      const replant = GROVE_PLAN[row.replacement as number];
      expect(replant.position).toEqual(row.position);
      expect(replant.elevation).toBe(row.elevation);
      expect(replant.arrival).toBeGreaterThanOrEqual(REPLANT_TABLE.starts[0]);
      expect(replant.arrival).toBeLessThanOrEqual(REPLANT_TABLE.starts[1]);
      if (row.fall) expect(replant.arrival).toBeCloseTo(row.fall.decayEnd, 9);
      // The old tree is gone the moment its replacement arrives.
      expect(getTreesAt(replant.arrival + 1e-3)[row.index].growth).toBe(0);
    }
  });

  it('lets the wrecks lie through the flood, and rot as it goes down', () => {
    const flood = getTreesAt(46.4);
    const later = getTreesAt(50.2);
    for (const row of FALLERS) {
      expect(flood[row.index].decay).toBe(0);
      expect(getLean(flood[row.index])).toBeGreaterThan(80);
      expect(later[row.index].decay as number).toBeGreaterThan(0.2);
    }
  });

  it('nets the replants, strains the nets and pulls them off in a wave by the regrowth night', () => {
    expect(getReplantNets(53.2, getYear(53.2)).length).toBe(REPLANTS.length);
    // Each is taut on its crown as it starts to come off, the west first.
    const startsOff = new Map<number, {t: number; strain: number; x: number}>();
    for (let frame = Math.round(53.2 * FRAME_RATE); frame <= 56 * FRAME_RATE; frame++) {
      const t = frame / FRAME_RATE;
      for (const net of getReplantNets(t, getYear(t))) {
        if (net.lift > 0 && !startsOff.has(net.id)) {
          startsOff.set(net.id, {t, strain: net.strain, x: net.position[0]});
        }
      }
    }
    expect(startsOff.size).toBe(REPLANTS.length);
    for (const {strain} of startsOff.values()) expect(strain).toBeGreaterThan(0.8);
    const offs = [...startsOff.values()];
    expect(getMean(offs.filter(({x}) => x < 0).map(({t}) => t))).toBeLessThan(
      getMean(offs.filter(({x}) => x > 0).map(({t}) => t))
    );
    const lifting = getReplantNets(54.2, getYear(54.2)).map(net => net.lift);
    expect(Math.max(...lifting)).toBeGreaterThan(Math.min(...lifting));
    // The last is gone in the dusk.
    expect(getReplantNets(55.2, getYear(55.2))).toEqual([]);
    // Every net is down on its own tree, at its own land.
    for (const net of getReplantNets(53, getYear(53))) {
      const row = GROVE_PLAN[net.id];
      expect(net.position[2]).toBeGreaterThanOrEqual(row.elevation - 1e-9);
    }
    const sites = getReplantSites(52.5, getYear(52.5));
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site.position[2]).toBeCloseTo(getLandHeight(site.position[0], site.position[1]), 9);
    }
    expect(getReplantSites(56.4, getYear(56.4))).toEqual([]);
  });

  it('rides each net up off its crown and crumples it away, never carried off on the wind', () => {
    // A grower pulls a net off by hand: it never flies, and it never moves far in a frame.
    let last = new Map<number, StoryNet>();
    for (let frame = Math.round(53.4 * FRAME_RATE); frame <= 56 * FRAME_RATE; frame++) {
      const t = frame / FRAME_RATE;
      const now = new Map(getReplantNets(t, getYear(t)).map(net => [net.id, net]));
      for (const net of now.values()) {
        expect(net.lift).toBeLessThanOrEqual(REPLANT_TABLE.netLiftMost + 1e-9);
        expect(net.descent).toBeGreaterThanOrEqual(REPLANT_TABLE.netLiftDescent - 1e-9);
        const before = last.get(net.id);
        if (before) {
          expect(Math.abs(net.lift - before.lift), `lift of ${net.id} at ${t}`).toBeLessThan(0.02);
          expect(Math.abs(net.descent - before.descent), `rise of ${net.id} at ${t}`).toBeLessThan(
            0.02
          );
          expect(Math.abs(net.radius - before.radius), `size of ${net.id} at ${t}`).toBeLessThan(
            0.2
          );
        }
      }
      // What goes has crumpled away to almost nothing first.
      for (const [id, before] of last) {
        if (!now.has(id)) expect(before.radius, `net ${id} at ${t}`).toBeLessThan(0.04);
      }
      last = now;
    }
    expect(last.size).toBe(0);
  });

  it('heals the limbs only in the regrowth night', () => {
    const row = SURVIVORS.find(item => !item.decline) as GrovePlanRow;
    const before = getTreesAt(STORM_TABLE.limbsHealed[0])[row.index].damage as number;
    const after = getTreesAt(STORM_TABLE.limbsHealed[1])[row.index].damage as number;
    expect(before).toBeCloseTo(row.storm.damage, 6);
    expect(after).toBeCloseTo(row.storm.damage * STORM_TABLE.limbsLeft, 6);
    expect(getTreesAt(STORM_TABLE.limbsHealed[1])[0].damage as number).toBeLessThan(0.1);
  });

  it('rings out the magic, raising each grove tree in 2 s as the ring reaches it', () => {
    expect(getMagicRing(27.3).radius).toBe(0);
    expect(getMagicRing(29).radius).toBeCloseTo(24, 6);
    expect(getMagicRing(31.8).radius).toBeCloseTo(300, 6);
    for (const row of GROVE) {
      expect(row.arrival).toBeGreaterThan(27.3);
      expect(row.arrival + MAGIC_TABLE.riseSeconds).toBeLessThan(32.6);
      expect(getTreesAt(row.arrival - 0.01)[row.index].growth).toBe(0);
      expect(
        getTreesAt(row.arrival + MAGIC_TABLE.riseSeconds)[row.index].growth as number
      ).toBeGreaterThan(0.4);
    }
  });

  it('holds the magic’s full bloom on every risen tree, then lets it go once the camera is high', () => {
    const [goes, gone] = MAGIC_TABLE.bloomGoes;
    // Through the ring, the hero and every tree risen with it are in full bloom, none of it fallen.
    for (const t of [27.6, 28.6, 29.4, 30.4, goes]) {
      const trees = getTreesAt(t);
      expect(getBlossom(trees[0]).count, `hero at ${t}`).toBeGreaterThan(
        CROP_TABLE.heroBlossomCap * 0.9
      );
      for (const row of GROVE_PLAN) {
        const tree = trees[row.index];
        if ((tree.growth as number) > 0) {
          const blossom = getBlossom(tree);
          expect(blossom.fallen, `tree ${row.index} at ${t}`).toBe(0);
          if (row.kind === 'grove') {
            expect(blossom.count, `tree ${row.index} at ${t}`).toBeGreaterThan(
              CROP_TABLE.groveBlossomCap * 0.9
            );
          }
        }
      }
    }
    // It goes from high above, and is gone before the next year's bloom opens.
    expect(getCameraEye(getStoryState(goes, PORTRAIT).camera)[2]).toBeGreaterThan(15);
    expect(getBloomYear(getYear(gone)).index).toBe(MAGIC_TABLE.year);
    for (const tree of getTreesAt(gone)) expect(getBlossom(tree).count).toBe(0);
    // It fades without a snap, and only a few petals let go, so the ground is never carpeted.
    const full = getTreesAt(goes).map(tree => getBlossom(tree).count);
    let last = full;
    for (let frame = Math.ceil(goes * FRAME_RATE); frame <= (gone + 0.15) * FRAME_RATE; frame++) {
      const t = frame / FRAME_RATE;
      const now = getTreesAt(t).map(getBlossom);
      now.forEach((blossom, index) => {
        if (full[index] <= 0) return;
        const step = Math.abs(blossom.count - last[index]) / full[index];
        expect(step, `tree ${index} at ${t}`).toBeLessThan(0.25);
        if (t <= gone) {
          expect(blossom.fallen as number).toBeLessThanOrEqual(MAGIC_TABLE.bloomFallen);
          const lying = (blossom.count * (blossom.fallen as number)) / full[index];
          expect(lying, `tree ${index} at ${t}`).toBeLessThan(0.1);
        }
      });
      last = now.map(blossom => blossom.count);
    }
  });
});

describe('Year 30', () => {
  it('blooms the hero as fully as TreeLayer can show, with its last crop hanging', () => {
    for (const t of [57.6, 61.3, 62.6]) {
      const trees = getTreesAt(t);
      const [blossom, fruit] = trees[0].crop as CropConfig[];
      expect(blossom.count).toBeGreaterThan(CROP_TABLE.heroBlossomCap * 0.85);
      expect(blossom.fallen).toBe(0);
      expect(fruit.count).toBeGreaterThan(1000);
      // The grove blooms as it did, so a grove of many trees costs what it did.
      for (const row of GROVE_PLAN.slice(1)) {
        expect((trees[row.index].crop as CropConfig[])[0].count).toBeLessThanOrEqual(
          CROP_TABLE.groveBlossomCap
        );
      }
    }
    // A young tree's bloom is far more than its crop, too.
    const year6 = (getTreesAt(19.5)[0].crop as CropConfig[])[0];
    expect(year6.count).toBeGreaterThan(5000);
    expect(year6.fallen).toBe(0);
  });

  it('drops a few percent of the last crop, fresh and lain a while, the old by night', () => {
    for (const t of [57.6, 61.3, 63.9]) {
      const fruit = getFruit(getTreesAt(t)[0]);
      const dropped = (fruit.droppedCount as number) / fruit.count;
      // TreeLayer lets a fruit go once `fallen` passes its own mark, from 0.02 to 0.98.
      const fresh = Math.max(0, ((fruit.fallen as number) - 0.02) / 0.96);
      expect(fresh).toBeGreaterThan(0.01);
      expect(dropped).toBeGreaterThan(0.01);
      expect(fresh + dropped).toBeLessThan(0.06);
    }
    // What has lain a while comes on in the regrowth's night, with no fall to see.
    let before = 0;
    for (let frame = Math.round(55 * FRAME_RATE); frame <= 57 * FRAME_RATE; frame++) {
      const t = frame / FRAME_RATE;
      const dropped = getFruit(getTreesAt(t)[0]).droppedCount as number;
      if (dropped !== before) {
        const {sky} = getStoryState(t, PORTRAIT);
        expect(Math.asin(sky.sunDirection[2]) * (180 / Math.PI), `sun at ${t}`).toBeLessThan(-6);
      }
      before = dropped;
    }
    expect(before).toBeGreaterThan(0);
    // None before the last crop, or in the empty field.
    for (const t of [20, 36.2, 46.4, 50.2, 53.9, 0.1, 1.09, 15.4]) {
      for (const tree of getTreesAt(t)) expect(getFruit(tree).droppedCount).toBe(0);
    }
  });

  it('flushes a mature tree as a fringe of lime, a young one fully', () => {
    const flushAt = (t: number) => getTreesAt(t)[0].flush as number;
    expect(flushAt(61.3)).toBeGreaterThan(0.25);
    expect(flushAt(61.3)).toBeLessThan(0.4);
    expect(flushAt(19.5)).toBeGreaterThan(0.6);
  });
});

describe('every frame', () => {
  it('is a pure function of the second, whatever came before', () => {
    for (const t of [29.4, 36.2, 39.9, 42.2, 46.4, 50.2, 53.9, 57.6]) {
      const first = getTreesAt(t);
      getTreesAt(t * 0.37 + 11);
      getTreesAt(44);
      expect(getTreesAt(t)).toEqual(first);
    }
  });

  it('writes the same rows in place, with every value in range', () => {
    const trees = writeTrees(40, getYear(40), getYearRate(40));
    const again = writeTrees(50, getYear(50), getYearRate(50));
    expect(again).toBe(trees);
    for (let t = 0; t < 64; t += 0.25) {
      for (const tree of writeTrees(t, getYear(t), getYearRate(t))) {
        for (const key of [
          'growth',
          'health',
          'foliage',
          'flush',
          'damage',
          'decay',
          'wind'
        ] as const) {
          const value = tree[key] as number;
          expect(value, `${key} at ${t}`).toBeGreaterThanOrEqual(0);
          expect(value, `${key} at ${t}`).toBeLessThanOrEqual(1);
        }
        expect(getLean(tree)).toBeGreaterThanOrEqual(0);
        expect(getLean(tree)).toBeLessThanOrEqual(90);
        for (const slot of tree.crop as CropConfig[]) {
          expect(slot.count).toBeGreaterThanOrEqual(0);
          expect(slot.fallen as number).toBeGreaterThanOrEqual(0);
          expect(slot.fallen as number).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('never lets lean, foliage, decay or the yellowing jump', () => {
    let last: {lean: number; foliage: number; decay: number; yellow: number}[] | null = null;
    for (let frame = 0; frame <= 64 * FRAME_RATE; frame++) {
      const t = frame / FRAME_RATE;
      const trees = writeTrees(t, getYear(t), getYearRate(t));
      const now = trees.map(tree => ({
        lean: getLean(tree),
        foliage: tree.foliage as number,
        decay: tree.decay as number,
        yellow: getCanopy(tree)?.[0] ?? DECLINE_TABLE.from[0]
      }));
      if (last && t > 27) {
        now.forEach((value, index) => {
          const before = (last as typeof now)[index];
          // A row that is not there may change anything.
          if ((trees[index].growth as number) > 0 && t < 63.99) {
            expect(Math.abs(value.lean - before.lean), `lean of ${index} at ${t}`).toBeLessThan(5);
            expect(
              Math.abs(value.foliage - before.foliage),
              `foliage of ${index} at ${t}`
            ).toBeLessThan(0.08);
            expect(Math.abs(value.decay - before.decay), `decay of ${index} at ${t}`).toBeLessThan(
              0.08
            );
            expect(
              Math.abs(value.yellow - before.yellow),
              `yellow of ${index} at ${t}`
            ).toBeLessThan(6);
          }
        });
      }
      last = now;
    }
  });

  it('keeps every falling crown well clear of the storm camera in the furrow', () => {
    // The eye's path in the spec: x -29 to -26.5 in the first wall, -26.5 in the eye, to -25.5 by 44.
    const getEye = (t: number): Vec3 => {
      const x =
        t < 38.2 ? -29 + 2.5 * ((t - 34.4) / 3.8) : t < 40.3 ? -26.5 : -26.5 + (t - 40.3) / 3.7;
      return [x, BED_LAYOUT.furrowAt, 0.72];
    };
    for (let t = 34.4; t <= 44; t += 0.05) {
      const eye = getEye(t);
      const trees = getTreesAt(t);
      trees.forEach((tree, index) => {
        const growth = tree.growth as number;
        if (growth <= 0) return;
        const position = tree.position as Vec3;
        const height = (tree.height as number) * getHeightFraction(growth);
        const crown = (tree.crownRadius as number) * getCrownFraction(growth);
        const [degrees, bearing] = (tree.lean as number[]).map(value => value * (Math.PI / 180));
        const axis: Vec3 = [
          Math.sin(degrees) * Math.sin(bearing),
          Math.sin(degrees) * Math.cos(bearing),
          Math.cos(degrees)
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
        const away = Math.hypot(
          d[0] - axis[0] * along * height,
          d[1] - axis[1] * along * height,
          d[2] - axis[2] * along * height
        );
        expect(away - crown, `tree ${index} at ${t.toFixed(2)}`).toBeGreaterThan(1);
      });
    }
  });

  it('writes the trees in well under a millisecond', () => {
    const wind = getEnvironment(42.2).wind;
    const start = performance.now();
    const count = 400;
    for (let i = 0; i < count; i++) {
      const t = 34 + (i % 100) * 0.1;
      writeTrees(t, getYear(t), getYearRate(t), wind);
    }
    expect((performance.now() - start) / count).toBeLessThan(1);
  });
});
