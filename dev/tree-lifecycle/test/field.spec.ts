// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {
  getAerosolDepth,
  getFieldAir,
  getFieldLinearLight,
  getFieldPlan
} from '../layers/field-shading';
import {
  createCrownMesh,
  createFarRowsMesh,
  createPolarMesh,
  FAR_ROWS,
  getDrownedBelow,
  getFarRowsLook,
  getFurrowTint,
  writeFieldTrees
} from '../layers/ground-layer';
import {getDaysUnderWater} from '../story/flood';
import {DECLINE_TABLE} from '../story/grove';
import {createCloudNoiseData, getCumulusLayer, getStormCenter} from '../layers/sky-layer';
import {CYCLE_SECONDS, HURRICANE} from '../story/beats';
import {
  BED_LAYOUT,
  getCrossing,
  getFurrowArc,
  getFurrowSlope,
  getFurrowU,
  getFurrowWaterHalf,
  getLandHeight,
  LAND_GLSL
} from '../story/land';
import {getStoryState} from '../story/story';
import type {StorySite, StoryState} from '../story/story-types';

/** Narkowicz's curve and display encoding, as the shaders' `fieldFilmic`. */
function getFilmic(x: number): number {
  const mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
  return Math.pow(Math.min(Math.max(mapped, 0), 1), 1 / 2.2);
}

type GlslFunction = (...args: unknown[]) => number;

/**
 * Runs GLSL written in the land's small part of the language, float scalars with `vec2` only to
 * pass a point, as JavaScript, so a test can hold it to its CPU twin. Anything outside that part
 * throws, rather than running as something else.
 */
function runGlsl(source: string): Record<string, GlslFunction> {
  const names: string[] = [];
  let js = source.replace(/\/\/.*$/gm, '');
  js = js.replace(/\bconst\s+float\s+/g, 'const ');
  js = js.replace(
    /\b(?:float|vec2|bool|void)\s+(\w+)\s*\(([^)]*)\)\s*\{/g,
    (_match, name: string, args: string) => {
      names.push(name);
      const params = args
        .split(',')
        .map(arg => arg.trim().split(/\s+/).pop())
        .filter(Boolean);
      return `function ${name}(${params.join(', ')}) {`;
    }
  );
  js = js.replace(/\b(?:float|vec2|bool)\s+(\w+)\s*=/g, 'let $1 =');
  const left = js.match(/\b(?:float|int|bool|vec[34]|mat[234]|uniform|in|out|inout)\b/);
  if (left) throw new Error(`GLSL outside the land's subset: ${left[0]}`);
  if (/\bvec2\b(?!\()/.test(js)) throw new Error('vec2 used other than to make a point');
  const clamp = (x: number, low: number, high: number) => Math.min(Math.max(x, low), high);
  const helpers: Record<string, unknown> = {
    abs: Math.abs,
    floor: Math.floor,
    sqrt: Math.sqrt,
    tanh: Math.tanh,
    exp: Math.exp,
    min: Math.min,
    max: Math.max,
    fract: (x: number) => x - Math.floor(x),
    clamp,
    mix: (a: number, b: number, t: number) => a + (b - a) * t,
    step: (edge: number, x: number) => (x < edge ? 0 : 1),
    smoothstep: (from: number, to: number, x: number) => {
      const u = clamp((x - from) / (to - from), 0, 1);
      return u * u * (3 - 2 * u);
    },
    vec2: (x: number, y: number) => ({x, y})
  };
  const factory = new Function(...Object.keys(helpers), `${js}\nreturn {${names.join(', ')}};`);
  return factory(...Object.values(helpers));
}

const GLSL = runGlsl(LAND_GLSL);
const point = (x: number, y: number) => ({x, y});

/** Points over the hero's block and the beds either side, with the culvert and the hero closer in. */
function getLandGrid(): [number, number][] {
  const points: [number, number][] = [];
  for (let x = -61; x <= 61; x += 0.83) {
    for (let y = -24; y <= 24; y += 0.071) points.push([x, y]);
  }
  for (let x = -6.2; x <= 6.2; x += 0.013) {
    for (let y = 2.2; y <= 5.4; y += 0.029) points.push([x, y]);
  }
  for (let x = -3; x <= 3; x += 0.037) {
    for (let y = -3; y <= 3; y += 0.041) points.push([x, y]);
  }
  for (const x of [-900, -310, 140, 750, 2400]) {
    for (let y = -16; y <= 16; y += 0.05) points.push([x, y]);
  }
  return points;
}

describe('land', () => {
  const grid = getLandGrid();

  it('is the same land in GLSL as on the CPU, on a grid', () => {
    let worst = 0;
    for (const [x, y] of grid) {
      worst = Math.max(worst, Math.abs(GLSL.fieldLandHeight(point(x, y)) - getLandHeight(x, y)));
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('puts the same furrows and the same crossing in GLSL', () => {
    for (const [x, y] of grid) {
      expect(GLSL.fieldFurrowU(point(x, y))).toBeCloseTo(getFurrowU(x, y), 9);
      expect(GLSL.fieldCrossing(point(x, y))).toBeCloseTo(getCrossing(x, y), 9);
    }
  });

  it('fills the furrows to the bed in fieldLandBed, and is the land elsewhere', () => {
    for (const [x, y] of grid) {
      const land = GLSL.fieldLandHeight(point(x, y));
      const bed = GLSL.fieldLandBed(point(x, y));
      expect(bed).toBeGreaterThanOrEqual(land - 1e-12);
      if (Math.abs(getFurrowU(x, y)) > 1.31) expect(bed).toBeCloseTo(land, 12);
    }
  });

  it('cuts each furrow to its floor, banks and shoulders', () => {
    // Away from the hero and the crossing, against the land just past the shoulders, give or take
    // the bed's fifth of the slow noise over a metre.
    const near = (value: number, expected: number) =>
      expect(Math.abs(value - expected)).toBeLessThan(0.012);
    for (const x of [-40, -14, 11, 23]) {
      for (const furrow of [-11.4, 3.8, 19]) {
        const bed = getLandHeight(x, furrow + 1.31);
        near(getLandHeight(x, furrow) - bed, BED_LAYOUT.floorZ);
        near(getLandHeight(x, furrow + 0.2) - bed, BED_LAYOUT.floorZ);
        near(getLandHeight(x, furrow - 0.9) - bed, BED_LAYOUT.bankTopZ);
        near(getLandHeight(x, furrow + 0.9) - bed, BED_LAYOUT.bankTopZ);
        // The ribbon is in it: a furrow is never so high its floor stands out of 7 cm of water.
        expect(getLandHeight(x, furrow)).toBeLessThan(BED_LAYOUT.ribbonZ - 0.03);
      }
    }
  });

  it('rounds each shoulder with no crease, so light runs over it smoothly', () => {
    // On a bed with no crown or noise worth the name, the land's own rise is the profile's slope.
    const x = -14;
    const bed = getLandHeight(x, 3.8 + 1.31);
    const step = 1e-4;
    const halfTop = BED_LAYOUT.furrowTop / 2;
    const zone = halfTop + BED_LAYOUT.shoulderWidth;
    for (let across = 0.3; across < zone + 0.1; across += 0.01) {
      const rise =
        (getLandHeight(x, 3.8 + across + step) - getLandHeight(x, 3.8 + across - step)) /
        (2 * step);
      expect(Math.abs(rise - getFurrowSlope(across))).toBeLessThan(0.01);
    }
    // No step in the slope where the bank meets its shoulder, or anywhere over the shoulder, and level
    // with the bed at its edge.
    for (let across = halfTop - 0.05; across <= zone; across += 0.002) {
      expect(Math.abs(getFurrowSlope(across + 0.002) - getFurrowSlope(across))).toBeLessThan(0.07);
    }
    expect(getFurrowSlope(halfTop - 1e-6)).toBeCloseTo(getFurrowSlope(halfTop + 1e-6), 4);
    expect(getFurrowSlope(zone - 1e-6)).toBeCloseTo(0, 4);
    expect(getLandHeight(x, 3.8 + zone - 1e-6) - bed).toBeCloseTo(0, 2);
    // And never above the bed.
    for (let across = halfTop; across <= zone; across += 0.01) {
      expect(getLandHeight(x, 3.8 + across)).toBeLessThanOrEqual(bed + 0.012);
    }
  });

  it('gives the same slope, water and surface across a furrow in GLSL', () => {
    for (let across = 0; across < 1.6; across += 0.0013) {
      expect(GLSL.fieldFurrowSlope(across)).toBeCloseTo(getFurrowSlope(across), 9);
      expect(GLSL.fieldFurrowArc(across)).toBeCloseTo(getFurrowArc(across), 9);
    }
    for (let level = -0.8; level < 0.1; level += 0.0007) {
      expect(GLSL.fieldFurrowWaterHalf(level)).toBeCloseTo(getFurrowWaterHalf(level), 9);
    }
  });

  it('stands water across a furrow as wide as its profile at that level', () => {
    const x = -14;
    const bed = getLandHeight(x, 3.8 + 1.31);
    for (let level = BED_LAYOUT.floorZ + 0.01; level < -0.002; level += 0.003) {
      const half = getFurrowWaterHalf(level);
      expect(getLandHeight(x, 3.8 + half) - bed).toBeCloseTo(level, 1);
      // Profile of the furrow alone, with the bed's noise taken out by its twin across the centre line.
      const profile = getLandHeight(x, 3.8 + half) - getLandHeight(x, 3.8 + 2);
      expect(Math.abs(profile - level)).toBeLessThan(0.015);
    }
    expect(getFurrowWaterHalf(BED_LAYOUT.floorZ - 0.1)).toBe(0);
    expect(getFurrowWaterHalf(0.05)).toBeCloseTo(
      BED_LAYOUT.furrowTop / 2 + BED_LAYOUT.shoulderWidth,
      9
    );
  });

  it('lays texture along the surface of a bank, the same as the plan past it', () => {
    const zone = BED_LAYOUT.furrowTop / 2 + BED_LAYOUT.shoulderWidth;
    for (const across of [zone, zone + 0.4, 3]) expect(getFurrowArc(across)).toBeCloseTo(across, 9);
    let last = -Infinity;
    for (let across = 0; across < zone + 0.5; across += 0.01) {
      const arc = getFurrowArc(across);
      expect(arc).toBeGreaterThan(last);
      last = arc;
    }
    // Down a bank, a metre of plan is the slope's length of surface.
    const halfFloor = BED_LAYOUT.furrowFloor / 2;
    const slope = getFurrowSlope(halfFloor + 0.3);
    expect(getFurrowArc(halfFloor + 0.4) - getFurrowArc(halfFloor + 0.2)).toBeCloseTo(
      0.2 * Math.sqrt(1 + slope * slope),
      6
    );
  });

  it('keeps the ribbon to the horizon both ways', () => {
    for (const x of [-5000, -900, 900, 5000]) {
      const floor = getLandHeight(x, BED_LAYOUT.furrowAt);
      expect(floor).toBeLessThan(BED_LAYOUT.ribbonZ - 0.02);
      expect(floor).toBeGreaterThan(BED_LAYOUT.ribbonZ - 0.15);
    }
  });

  it('lays the rows flat, so trunks and what falls from them sit on their own ground', () => {
    for (const row of [-15.2, -7.6, 7.6, 15.2]) {
      for (const x of [-30, -12, 6, 18, 30]) {
        const trunk = getLandHeight(x, row);
        for (let off = -BED_LAYOUT.rowFlat; off <= BED_LAYOUT.rowFlat; off += 0.25) {
          expect(Math.abs(getLandHeight(x, row + off) - trunk)).toBeLessThan(0.03);
        }
      }
    }
  });

  it('crowns the bed middles, but not under the hero', () => {
    for (const x of [-30, -12, 18, 30]) {
      const middle = getLandHeight(x, -3.8);
      const row = getLandHeight(x, -3.8 + 2);
      expect(middle - row).toBeGreaterThan(BED_LAYOUT.crownZ - 0.02);
      expect(middle - row).toBeLessThan(BED_LAYOUT.crownZ + 0.02);
    }
    for (let x = -4.5; x <= 4.5; x += 0.25) {
      expect(Math.abs(getLandHeight(x, -3.8) - getLandHeight(x, -1.8))).toBeLessThan(0.012);
    }
  });

  it('is level at the hero, and falls to the east', () => {
    expect(getLandHeight(0, 0)).toBe(0);
    expect(Math.abs(getLandHeight(-0.232, 0.27))).toBeLessThan(0.001);
    // 0.06 m per 120 m in the block, give or take the bed's fifth of the slow noise.
    expect(getLandHeight(30, 0) - getLandHeight(-30, 0)).toBeLessThan(-0.015);
    expect(getLandHeight(30, 0) - getLandHeight(-30, 0)).toBeGreaterThan(-0.05);
  });

  it('bridges the hero furrow under its crown, and comes down its end ramps to the pipe', () => {
    const {crossing} = BED_LAYOUT;
    for (let x = crossing.x[0]; x <= crossing.x[1]; x += 0.3) {
      expect(getCrossing(x, BED_LAYOUT.furrowAt)).toBe(1);
      expect(getLandHeight(x, BED_LAYOUT.furrowAt)).toBeGreaterThan(-0.02);
    }
    const top = crossing.x[1];
    expect(getCrossing(top + crossing.ramp / 2, BED_LAYOUT.furrowAt)).toBeCloseTo(0.5, 6);
    expect(getLandHeight(top + crossing.ramp / 2, BED_LAYOUT.furrowAt)).toBeCloseTo(
      BED_LAYOUT.floorZ / 2,
      1
    );
    expect(getCrossing(top + crossing.ramp + 0.01, BED_LAYOUT.furrowAt)).toBe(0);
    // Only the hero's furrow has one.
    expect(getCrossing(0, BED_LAYOUT.furrowAt + BED_LAYOUT.bedSpacing)).toBe(0);
    expect(getCrossing(0, BED_LAYOUT.furrowAt - BED_LAYOUT.bedSpacing)).toBe(0);
    // So no fruit of the hero's north skirt lies over open furrow.
    for (let bearing = 0; bearing < 360; bearing += 3) {
      const radians = (bearing * Math.PI) / 180;
      const x = 5.35 * Math.sin(radians);
      const y = 5.35 * Math.cos(radians);
      if (Math.abs(getFurrowU(x, y)) < 1.3) expect(getCrossing(x, y)).toBe(1);
    }
  });
});

describe('field air', () => {
  it('gives fog as the light that the filmic curve turns back into its color', () => {
    for (const value of [12, 64, 128, 200, 250]) {
      const [light] = getFieldLinearLight([value, value, value]);
      expect(getFilmic(light) * 255).toBeCloseTo(value, 0);
    }
  });

  it('thickens the air with turbidity', () => {
    expect(getAerosolDepth(2)).toBeLessThan(getAerosolDepth(4));
    expect(getAerosolDepth(4)).toBeLessThan(getAerosolDepth(6));
    expect(getAerosolDepth(2)).toBeGreaterThan(0);
  });

  it('is the same for the same frame, and takes its values from the state', () => {
    const state = getStoryState(50);
    const air = getFieldAir(state);
    expect(getFieldAir(state)).toBe(air);
    expect(air.sun.slice(0, 3)).toEqual([...state.sky.sunDirection]);
    expect(air.fog[3]).toBe(state.fog.density);
  });

  it('brings on the moon only at night', () => {
    let day: StoryState | null = null;
    let night: StoryState | null = null;
    for (let t = 0; t < CYCLE_SECONDS && !(day && night); t += 0.25) {
      const state = getStoryState(t);
      if (!day && state.sky.sunDirection[2] > 0.5) day = state;
      if (!night && state.sky.sunDirection[2] < -0.3) night = state;
    }
    expect(day && getFieldAir(day).moon[3]).toBe(0);
    expect(night && getFieldAir(night).moon[3]).toBeGreaterThan(0.5);
  });

  it('gives the same sub-frame seed for the same second', () => {
    expect(getFieldAir(getStoryState(50.25)).clock[1]).toBe(
      getFieldAir(getStoryState(50.25)).clock[1]
    );
    expect(getFieldAir(getStoryState(50.25)).clock[1]).not.toBe(
      getFieldAir(getStoryState(50.26)).clock[1]
    );
  });

  it('passes the rows on', () => {
    const state = getStoryState(26);
    const {rows, reach} = getFieldPlan(state);
    expect(rows[0]).toBe(state.ground.rows.spacing);
    expect(reach[0]).toBe(state.ground.rows.reach);
  });
});

describe('ground meshes', () => {
  it('runs a polar mesh from a centimetre to the horizon', () => {
    const {positions, indices, rings} = createPolarMesh(64, 0.01, 6000, 1.5);
    const radii: number[] = [];
    for (let ring = 0; ring < rings; ring++) {
      const at = (1 + ring * 64) * 2;
      radii.push(Math.hypot(positions[at], positions[at + 1]));
    }
    expect(radii[0]).toBeCloseTo(0.01, 6);
    expect(radii[rings - 1]).toBeCloseTo(6000, 2);
    for (let ring = 1; ring < rings - 1; ring++) {
      expect(radii[ring] / radii[ring - 1]).toBeCloseTo(radii[1] / radii[0], 3);
    }
    expect(Math.max(...indices)).toBe(positions.length / 2 - 1);
  });

  it('winds a polar mesh up, so nothing depends on its side', () => {
    const {positions, indices} = createPolarMesh(32, 0.1, 10, 1.5);
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const ux = positions[b * 2] - positions[a * 2];
      const uy = positions[b * 2 + 1] - positions[a * 2 + 1];
      const vx = positions[c * 2] - positions[a * 2];
      const vy = positions[c * 2 + 1] - positions[a * 2 + 1];
      expect(ux * vy - uy * vx).not.toBe(0);
    }
  });

  it('keeps the far rows out of the crowns they take over from', () => {
    // The hedges start only where the crowns start to give way to them, and the crowns are gone before
    // they end, so the two always overlap and never leave a gap.
    const [handFrom, handTo] = FAR_ROWS.handOver;
    expect(handTo).toBeLessThanOrEqual(FAR_ROWS.crownsTo);
    expect(handFrom).toBeLessThan(handTo);
    const {places, indices} = createFarRowsMesh(7.6, [36, 34.2], 1050);
    for (let i = 0; i < places.length; i += 4) {
      expect(Math.hypot(places[i], places[i + 1])).toBeGreaterThanOrEqual(handFrom - 6);
      expect(Math.hypot(places[i], places[i + 1])).toBeLessThanOrEqual(1050.01);
      expect(Math.abs(places[i + 1] / 7.6 - Math.round(places[i + 1] / 7.6))).toBeLessThan(1e-3);
    }
    expect(indices.length % 3).toBe(0);
    expect(indices.reduce((most, index) => Math.max(most, index), 0)).toBeLessThan(
      places.length / 4
    );
  });

  it('closes a crown at its top', () => {
    const {places, indices} = createCrownMesh();
    expect(places[places.length - 2]).toBe(1);
    expect(Math.max(...indices)).toBe(places.length / 4 - 1);
    for (let i = 0; i < places.length; i += 4) {
      expect(Math.hypot(places[i], places[i + 1], places[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('tints a far furrow by its share of a pixel, which averages to its widths', () => {
    // Pixels of 3 m across y anywhere along a bed see, on average, a furrow's share of it.
    const width = 3;
    let water = 0;
    let bank = 0;
    const count = 4000;
    for (let i = 0; i < count; i++) {
      const y = (i / count) * BED_LAYOUT.bedSpacing;
      const tint = getFurrowTint(y, width, BED_LAYOUT.ribbonZ);
      water += tint.water;
      bank += tint.bank;
    }
    const ribbon = BED_LAYOUT.furrowFloor + 2 * (BED_LAYOUT.ribbonZ - BED_LAYOUT.floorZ);
    expect(water / count).toBeCloseTo(ribbon / BED_LAYOUT.bedSpacing, 2);
    expect((water + bank) / count).toBeCloseTo(
      (BED_LAYOUT.furrowTop + 2 * BED_LAYOUT.shoulderWidth) / BED_LAYOUT.bedSpacing,
      2
    );
  });
});

describe('the rows past the block', () => {
  it('drowns the roots of those on land the water stood over longer than the grove can bear', () => {
    const below = getDrownedBelow();
    expect(getDaysUnderWater(below - 0.002)).toBeGreaterThan(DECLINE_TABLE.days);
    expect(getDaysUnderWater(below + 0.002)).toBeLessThan(DECLINE_TABLE.days);
    // The hero, at the land's own zero, lives; the low east end, where the block falls away, does not.
    expect(below).toBeLessThan(0);
    expect(getLandHeight(60, 7.6)).toBeLessThan(below);
    expect(getLandHeight(-60, 7.6)).toBeGreaterThan(below);
  });

  it('stands untouched before the storm and after the regrowth', () => {
    for (const t of [20, 31, 58]) {
      const look = getFarRowsLook(getStoryState(t), 0, t);
      expect(look.storm[0]).toBe(0);
      expect(look.storm[1]).toBeGreaterThan(0.95);
      expect(look.storm[2]).toBeLessThan(0.05);
      expect(look.decline[0]).toBe(0);
      expect(look.decline[2]).toBe(0);
    }
    expect(getFarRowsLook(getStoryState(20), 0, 20).lean.slice(0, 3)).toEqual([0, 0, 1]);
  });

  it('is stripped and hurt with the grove, leans with each wall, and is set back up', () => {
    const storm = getFarRowsLook(getStoryState(46.4), 0.18, 46.4);
    expect(storm.storm[0]).toBe(0.18);
    // As stripped as the grove's own survivors, and as hurt, which the grove keeps slight.
    expect(storm.storm[1]).toBeLessThan(0.75);
    expect(storm.storm[2]).toBeGreaterThan(0);
    expect(storm.lean[0]).toBeGreaterThan(0.7);
    expect(storm.lean[1]).toBeGreaterThan(0.9);
    const set = getFarRowsLook(getStoryState(54), 0, 54);
    expect(set.lean[2]).toBeCloseTo(0.25, 6);
  });

  it('yellows the low trees as the grove’s own drowned ones do, and lets the dead go with the gaps', () => {
    const early = getFarRowsLook(getStoryState(48.5), 0.18, 48.5);
    const late = getFarRowsLook(getStoryState(50.6), 0.18, 50.6);
    expect(early.decline[0]).toBe(0);
    expect(late.decline[0]).toBeGreaterThan(0.6);
    expect(late.decline[2]).toBeGreaterThan(0.9);
    expect(getFarRowsLook(getStoryState(56), 0, 56).decline[0]).toBe(0);
  });

  it('takes its dead away with the replanting, as the block’s own skeletons go', () => {
    // Still standing grey as the replanting starts, and gone by the time it ends, with the year-21 flush.
    expect(getFarRowsLook(getStoryState(51), 0.18, 51).decline[2]).toBeGreaterThan(0.9);
    expect(getFarRowsLook(getStoryState(53.2), 0.1, 53.2).decline[2]).toBe(0);
    // And as green again as the grove's survivors by then.
    expect(getFarRowsLook(getStoryState(52.4), 0.1, 52.4).storm[1]).toBeGreaterThan(0.9);
  });
});

describe('trees over the ground', () => {
  const texels = new Float32Array(16 * 13 * 4);

  it('has the hero alone before the grove', () => {
    const state = getStoryState(20);
    expect(writeFieldTrees(state, texels)).toBe(0);
    let present = 0;
    for (let i = 0; i < 16 * 12; i++) if (texels[i * 4 + 3] > 0) present++;
    expect(present).toBe(1);
    const hero = (8 + 6 * 16) * 4;
    expect(texels[hero]).toBe(0);
    expect(texels[hero + 1]).toBe(0);
    expect(texels[hero + 2]).toBeGreaterThan(0.5);
  });

  it('has the grove once it has risen, and fills no more cells than it has', () => {
    const story = getStoryState(32);
    // Every tree risen, whenever the grove's own tables raise them.
    const trees = story.trees.map(tree => ({...tree, growth: 1, foliage: 1, decay: 0}));
    const state = {...story, trees};
    writeFieldTrees(state, texels);
    let present = 0;
    for (let i = 0; i < 16 * 12; i++) if (texels[i * 4 + 2] > 0) present++;
    expect(present).toBeGreaterThan(70);
    expect(present).toBeLessThanOrEqual(state.trees.length);
  });

  it('opens a hole for each site that has one, on its last row', () => {
    const state = getStoryState(52);
    const site = (x: number, hole: number): StorySite => ({
      position: [x, 7.6, 0],
      hole,
      berm: 0,
      water: 0,
      rootBall: null
    });
    const sites = [site(-12, 0.8), site(6, 0), site(18, 0.4)];
    const holes = writeFieldTrees({...state, ground: {...state.ground, sites}}, texels);
    expect(holes).toBe(2);
    const first = 12 * 16 * 4;
    expect(texels[first]).toBe(-12);
    expect(texels[first + 2]).toBeGreaterThan(0);
    expect(texels[first + 4]).toBe(18);
  });
});

describe('sky', () => {
  it('builds the same even noise every time', () => {
    const noise = createCloudNoiseData(16);
    expect(noise).toEqual(createCloudNoiseData(16));
    // An even histogram: a threshold of x leaves the share 1 - x above it.
    for (const channel of [0, 3]) {
      let above = 0;
      for (let i = 0; i < noise.length; i += 4) if (noise[i + channel] > 0.7 * 255) above++;
      expect(above / (noise.length / 4)).toBeCloseTo(0.3, 1);
    }
  });

  it('raises cumulus from flat to towering by build', () => {
    const [flatBase, flatTop] = getCumulusLayer(0);
    const [towerBase, towerTop] = getCumulusLayer(1);
    expect(flatTop - flatBase).toBeLessThan(1000);
    expect(towerTop - towerBase).toBeGreaterThan(8000);
  });

  it('puts the storm on the other side of the camera after the eye', () => {
    const before = getStormCenter(HURRICANE.eyeOpen - 1);
    const after = getStormCenter(HURRICANE.eyeClose + 1);
    expect(before[0]).toBeCloseTo(-after[0], 6);
    expect(before[1]).toBeCloseTo(-after[1], 6);
    expect(getStormCenter(HURRICANE.firstWall + 0.5)).toEqual(before);
  });
});
