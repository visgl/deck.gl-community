// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The land: Florida flatwoods double-row beds, with a water furrow between the rows of each pair of
 * beds, as one table emitted to both the CPU (`getLandHeight`) and GLSL (`LAND_GLSL`), so ground,
 * grass, weather, sites and tree elevations agree. Metres, z up, the hero at the origin.
 *
 * Across a bed, from a furrow's centre line: the furrow's floor, its banks up to the bank tops, a
 * shoulder rounding up to the bed, the flat zone of the row, then the crowned bed middle, and the
 * same again mirrored to the next furrow. Under all of it lie the block's fall to the east and the
 * land's own slow rise and fall, faded on the beds and gone at the hero's feet.
 */

/** The beds, furrows and culvert crossing, in metres. */
export const BED_LAYOUT = {
  /** Beds on centre, along y. */
  bedSpacing: 15.2,
  /** Rows of trees along y, at y = rowSpacing * k. */
  rowSpacing: 7.6,
  /** Furrows at y = furrowAt + bedSpacing * k: north of the hero's row, 3.8 m from each row. */
  furrowAt: 3.8,
  /** A furrow's width across its top, and across its floor. */
  furrowTop: 1.8,
  furrowFloor: 0.5,
  /** Height of a furrow's floor, and of its bank tops. */
  floorZ: -0.75,
  bankTopZ: -0.1,
  /**
   * A bank top rounds up to the bed over this width, with no crease: a lip that turns the bank's
   * slope down to `lipSlope`, then an apron that eases it to the level of the bed.
   */
  shoulderWidth: 0.4,
  lipSlope: 0.2,
  /** Within this of every row the bed is flat, with the land's slow noise faded to a fifth. */
  rowFlat: 2.5,
  /** The bed middles' crown: its height and its half-width. */
  crownZ: 0.05,
  crownWidth: 1.3,
  /**
   * Metres from the hero over which the crown comes back: flat within the first, so its fruit
   * lands on level ground, and whole past the second.
   */
  heroClear: [5.5, 7.0] as const,
  /** Metres the block falls per metre east, toward an east lateral ditch. */
  tilt: 0.0005,
  /**
   * Metres east or west over which that fall levels off, as a tanh, so the field past the block
   * neither drowns nor stands dry: the furrows keep a ribbon to the horizon both ways.
   */
  tiltReach: 80,
  /** The 7 cm ribbon of tea-coloured water each furrow holds all year. */
  ribbonZ: -0.68,
  /**
   * The culvert crossing under the hero's crown: a soil bridge at bed height over `x`, with end
   * ramps `ramp` long and the pipe's mouths `pipe` across at the floor of each ramp.
   */
  crossing: {x: [-4.8, 4.8] as const, ramp: 0.6, pipe: 0.45}
};

/**
 * The land's own slow rise and fall, as the open field had it before there were beds: two slow
 * octaves, and fine relief just round the hero's feet for the macro shots, all of it nothing within
 * `heroFade[0]` of the hero. On the beds the slow octaves keep `bedShare` of themselves.
 *
 * `bedShare` holds over the whole bed, not only within `rowFlat` of a row: at full strength in the
 * crowned middles the recession's long strips break into blobs, and in a furrow the ribbon breaks
 * up, where 7 cm of water lies over a floor that would rise and fall by 5.
 */
const LAND_NOISE = {
  broad: {scale: 13, offset: 8, amount: 0.08},
  fine: {scale: 2.3, offset: 3, amount: 0.028, reach: [50, 60] as const},
  bedShare: 0.2,
  heroFade: [0.6, 1.8] as const,
  /** Relief round the hero: cells, offset, amount and the radii it fades out over. */
  grit: {scale: 0.09, offset: 1, amount: 0.0032, fade: [0.9, 1.6] as const},
  ripple: {scale: 0.31, offset: 6, amount: 0.007, fade: [1.2, 2.6] as const}
};

/**
 * Half-widths and slope of a furrow, which the GLSL and the CPU share, and its shoulder's two
 * quadratic pieces: the lip, from the bank top, `lipWidth` across, which turns the bank's slope down
 * to `lipSlope` with curvature `lipCurve`, and the apron, which eases that to the level of the bed at
 * the edge of the zone with curvature `apronCurve`. They meet at `lipZ` with the same slope, and the
 * bank meets the lip with its own, so light runs over the shoulder with no crease.
 */
const FURROW = (() => {
  const {floorZ, bankTopZ, furrowFloor, furrowTop, shoulderWidth, lipSlope} = BED_LAYOUT;
  const halfFloor = furrowFloor / 2;
  const halfTop = furrowTop / 2;
  const bankSlope = (bankTopZ - floorZ) / (halfTop - halfFloor);
  // The lip rises (bankSlope + lipSlope) / 2 a metre and the apron lipSlope / 2, together the bank top's depth.
  const lipWidth = (-2 * bankTopZ - shoulderWidth * lipSlope) / bankSlope;
  const apronWidth = shoulderWidth - lipWidth;
  return {
    halfFloor,
    halfTop,
    bankSlope,
    /** Half-width of what a furrow takes of the bed: its banks and both shoulders. */
    zone: halfTop + shoulderWidth,
    lipWidth,
    lipCurve: (bankSlope - lipSlope) / (2 * lipWidth),
    apronCurve: lipSlope / (2 * apronWidth),
    lipZ: (-lipSlope * apronWidth) / 2
  };
})();

// ---------------------------------------------------------------- CPU

function smoothstep(from: number, to: number, value: number): number {
  const u = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return u * u * (3 - 2 * u);
}

function fract(value: number): number {
  return value - Math.floor(value);
}

/** Dave Hoskins' hash without sine, 0-1, as `fieldHash` in the field's shaders. */
function getLandHash(x: number, y: number): number {
  let qx = fract(x * 0.1031);
  let qy = fract(y * 0.1031);
  let qz = fract(x * 0.1031);
  const d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}

/** Value noise, 0-1, with quintic easing, as `fieldNoise`. */
function getLandNoise(x: number, y: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = getLandHash(cx, cy);
  const b = getLandHash(cx + 1, cy);
  const c = getLandHash(cx, cy + 1);
  const d = getLandHash(cx + 1, cy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Metres the block has fallen at `x`: east is lower, levelling off past `tiltReach`. */
function getTilt(x: number): number {
  const {tilt, tiltReach} = BED_LAYOUT;
  return -tilt * tiltReach * Math.tanh(x / tiltReach);
}

/** What lies under the profile: the block's fall and the land's own slow noise. */
function getLandOffset(x: number, y: number): number {
  const r = Math.hypot(x, y);
  const {broad, fine, bedShare, heroFade, grit, ripple} = LAND_NOISE;
  const away = smoothstep(heroFade[0], heroFade[1], r);
  let slow =
    (getLandNoise(x / broad.scale + broad.offset, y / broad.scale + broad.offset) - 0.5) *
    broad.amount;
  const reach = 1 - smoothstep(fine.reach[0], fine.reach[1], r);
  if (reach > 0) {
    slow +=
      (getLandNoise(x / fine.scale + fine.offset, y / fine.scale + fine.offset) - 0.5) *
      fine.amount *
      reach;
  }
  let z = slow * bedShare * away;
  if (r < ripple.fade[1]) {
    z +=
      (getLandNoise(x / grit.scale + grit.offset, y / grit.scale + grit.offset) - 0.5) *
      grit.amount *
      (1 - smoothstep(grit.fade[0], grit.fade[1], r)) *
      away;
    z +=
      (getLandNoise(x / ripple.scale + ripple.offset, y / ripple.scale + ripple.offset) - 0.5) *
      ripple.amount *
      (1 - smoothstep(ripple.fade[0], ripple.fade[1], r)) *
      away;
  }
  return z + getTilt(x);
}

/** A furrow's profile against the bed, 0 or below, by metres from its centre line. */
function getFurrowProfile(across: number): number {
  const {floorZ, bankTopZ} = BED_LAYOUT;
  if (across >= FURROW.zone) return 0;
  const lipEnd = FURROW.halfTop + FURROW.lipWidth;
  if (across >= lipEnd) {
    const e = FURROW.zone - across;
    return -FURROW.apronCurve * e * e;
  }
  if (across >= FURROW.halfTop) {
    const e = across - FURROW.halfTop;
    return bankTopZ + FURROW.bankSlope * e - FURROW.lipCurve * e * e;
  }
  if (across >= FURROW.halfFloor) return floorZ + (across - FURROW.halfFloor) * FURROW.bankSlope;
  return floorZ;
}

/**
 * How steeply a furrow's profile rises away from its centre line, metres a metre, by metres from
 * it: 0 on its floor, the bank's slope up it, and down to 0 again over the shoulder.
 */
export function getFurrowSlope(across: number): number {
  if (across >= FURROW.zone) return 0;
  if (across >= FURROW.halfTop + FURROW.lipWidth)
    return 2 * FURROW.apronCurve * (FURROW.zone - across);
  if (across >= FURROW.halfTop)
    return FURROW.bankSlope - 2 * FURROW.lipCurve * (across - FURROW.halfTop);
  if (across >= FURROW.halfFloor) return FURROW.bankSlope;
  return 0;
}

/**
 * Half the width of a furrow's water at `level` against its bed (0 at the bed, the floor at
 * `floorZ`): none below the floor, the whole zone at the bed or above.
 */
export function getFurrowWaterHalf(level: number): number {
  const {floorZ, bankTopZ} = BED_LAYOUT;
  if (level <= floorZ) return 0;
  if (level <= bankTopZ) return FURROW.halfFloor + (level - floorZ) / FURROW.bankSlope;
  if (level >= 0) return FURROW.zone;
  if (level <= FURROW.lipZ) {
    // bankTopZ + bankSlope e - lipCurve e^2 = level, the root on the lip.
    const c = FURROW.lipCurve;
    const k = FURROW.bankSlope;
    return (
      FURROW.halfTop +
      (2 * (level - bankTopZ)) / (k + Math.sqrt(k * k - 4 * c * (level - bankTopZ)))
    );
  }
  return FURROW.zone - Math.sqrt(-level / FURROW.apronCurve);
}

/**
 * Metres along the land's own surface across a furrow, by metres from its centre line, counted so
 * that it is the same as `across` at the edge of the zone and past it: a bank's slope is longer than
 * its width, so a texture laid by this rather than by the plan is not drawn out down it. Inside it
 * runs to below zero at the centre line, which is under the ribbon.
 */
export function getFurrowArc(across: number): number {
  const stretch = Math.sqrt(1 + FURROW.bankSlope * FURROW.bankSlope);
  const lipStretch = Math.sqrt(1 + ((FURROW.bankSlope + BED_LAYOUT.lipSlope) / 2) ** 2);
  const apronStretch = Math.sqrt(1 + (BED_LAYOUT.lipSlope / 2) ** 2);
  const lipEnd = FURROW.halfTop + FURROW.lipWidth;
  const clampTo = (value: number, low: number, high: number) =>
    Math.min(Math.max(value, low), high);
  // From the edge of the zone in, what each piece adds to its width: the apron, the lip and the bank,
  // each at its mean stretch.
  return (
    across -
    (FURROW.zone - clampTo(across, lipEnd, FURROW.zone)) * (apronStretch - 1) -
    (lipEnd - clampTo(across, FURROW.halfTop, lipEnd)) * (lipStretch - 1) -
    (FURROW.halfTop - clampTo(across, FURROW.halfFloor, FURROW.halfTop)) * (stretch - 1)
  );
}

/** The crowned bed middle, by metres from a furrow's centre line and from the hero. */
function getCrown(across: number, fromHero: number): number {
  const {bedSpacing, crownZ, crownWidth, heroClear} = BED_LAYOUT;
  const fromMiddle = Math.abs(bedSpacing / 2 - across) / crownWidth;
  if (fromMiddle >= 1) return 0;
  return (
    crownZ * (1 - smoothstep(0, 1, fromMiddle)) * smoothstep(heroClear[0], heroClear[1], fromHero)
  );
}

/**
 * Signed metres from the centre line of the nearest furrow, across it, from -bedSpacing/2 up to
 * bedSpacing/2. Positive is north of it.
 */
export function getFurrowU(x: number, y: number): number {
  const {bedSpacing, furrowAt} = BED_LAYOUT;
  const v = y - furrowAt;
  return v - bedSpacing * Math.floor(v / bedSpacing + 0.5);
}

/**
 * How much a point is on the culvert crossing: 1 on its bridge, falling to 0 down its end ramps, 0
 * anywhere else, including off the hero's furrow.
 */
export function getCrossing(x: number, y: number): number {
  const {furrowAt, crossing} = BED_LAYOUT;
  if (Math.abs(y - furrowAt) >= FURROW.zone) return 0;
  const outside = Math.max(crossing.x[0] - x, x - crossing.x[1], 0);
  return 1 - Math.min(outside / crossing.ramp, 1);
}

/**
 * Height of the land at a point on the field, in metres. A tree stands at the land under its trunk
 * (`TreeSpec.elevation`).
 */
export function getLandHeight(x: number, y: number): number {
  const across = Math.abs(getFurrowU(x, y));
  let profile = getFurrowProfile(across);
  const crossing = getCrossing(x, y);
  if (crossing > 0) profile = Math.max(profile, BED_LAYOUT.floorZ * (1 - crossing));
  return getLandOffset(x, y) + profile + getCrown(across, Math.hypot(x, y));
}

// ---------------------------------------------------------------- GLSL

/** A number as a GLSL float literal. */
function toGlsl(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/**
 * GLSL of the same land, from the same table, needing nothing else:
 * - `float fieldLandHeight(vec2 p)`: the land's height in metres at `p`, metres on the field.
 * - `float fieldFurrowU(vec2 p)`: where `p` is across its nearest furrow, as `getFurrowU`.
 * - `float fieldCrossing(vec2 p)`: how much `p` is on the culvert crossing, as `getCrossing`.
 *
 * Also `fieldLandBed(p)`, the land with every furrow filled to its bed, which is never below the
 * land; `fieldLandOffset(p)`, the fall and slow noise under the profile, which is most of the cost;
 * `fieldLandOver(p, offset)`, the land over an offset already worked out; the profile's own
 * `fieldFurrowProfile(across)` and `fieldLandCrown(across, fromHero)`; and the profile's twins of
 * `getFurrowSlope`, `getFurrowWaterHalf` and `getFurrowArc`. Every name it defines starts
 * `fieldLand`, `fieldFurrow` or `FIELD_LAND`, or is `fieldCrossing`, so it sits beside other chunks.
 * `FIELD_PLAN_GLSL` includes it: a shader takes one or the other, never both.
 *
 * It is written in a small part of GLSL, scalars with `vec2` only to pass a point, so that a test
 * can run it as JavaScript against `getLandHeight`.
 */
export const LAND_GLSL = /* glsl */ `\
const float FIELD_LAND_BED_SPACING = ${toGlsl(BED_LAYOUT.bedSpacing)};
const float FIELD_LAND_FURROW_AT = ${toGlsl(BED_LAYOUT.furrowAt)};
const float FIELD_LAND_FLOOR_Z = ${toGlsl(BED_LAYOUT.floorZ)};
const float FIELD_LAND_BANK_TOP_Z = ${toGlsl(BED_LAYOUT.bankTopZ)};
const float FIELD_LAND_SHOULDER = ${toGlsl(BED_LAYOUT.shoulderWidth)};
const float FIELD_LAND_HALF_FLOOR = ${toGlsl(FURROW.halfFloor)};
const float FIELD_LAND_HALF_TOP = ${toGlsl(FURROW.halfTop)};
const float FIELD_LAND_BANK_SLOPE = ${toGlsl(FURROW.bankSlope)};
const float FIELD_LAND_ZONE = ${toGlsl(FURROW.zone)};
const float FIELD_LAND_LIP_END = ${toGlsl(FURROW.halfTop + FURROW.lipWidth)};
const float FIELD_LAND_LIP_CURVE = ${toGlsl(FURROW.lipCurve)};
const float FIELD_LAND_LIP_Z = ${toGlsl(FURROW.lipZ)};
const float FIELD_LAND_LIP_SLOPE = ${toGlsl(BED_LAYOUT.lipSlope)};
const float FIELD_LAND_APRON_CURVE = ${toGlsl(FURROW.apronCurve)};
const float FIELD_LAND_CROWN_Z = ${toGlsl(BED_LAYOUT.crownZ)};
const float FIELD_LAND_CROWN_WIDTH = ${toGlsl(BED_LAYOUT.crownWidth)};
const float FIELD_LAND_TILT = ${toGlsl(BED_LAYOUT.tilt)};
const float FIELD_LAND_TILT_REACH = ${toGlsl(BED_LAYOUT.tiltReach)};
const float FIELD_LAND_CROSS_FROM = ${toGlsl(BED_LAYOUT.crossing.x[0])};
const float FIELD_LAND_CROSS_TO = ${toGlsl(BED_LAYOUT.crossing.x[1])};
const float FIELD_LAND_CROSS_RAMP = ${toGlsl(BED_LAYOUT.crossing.ramp)};

// Dave Hoskins' hash without sine, as fieldHash.
float fieldLandHash(float x, float y) {
  float qx = fract(x * 0.1031);
  float qy = fract(y * 0.1031);
  float qz = fract(x * 0.1031);
  float d = qx * (qy + 33.33) + qy * (qz + 33.33) + qz * (qx + 33.33);
  qx += d;
  qy += d;
  qz += d;
  return fract((qx + qy) * qz);
}

// Value noise, 0-1, as fieldNoise.
float fieldLandNoise(float x, float y) {
  float cx = floor(x);
  float cy = floor(y);
  float fx = x - cx;
  float fy = y - cy;
  float ux = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
  float uy = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
  float a = fieldLandHash(cx, cy);
  float b = fieldLandHash(cx + 1.0, cy);
  float c = fieldLandHash(cx, cy + 1.0);
  float d = fieldLandHash(cx + 1.0, cy + 1.0);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// The block's fall and the land's own slow noise, which the whole profile lies on.
float fieldLandOffset(vec2 p) {
  float r = sqrt(p.x * p.x + p.y * p.y);
  float away = smoothstep(${toGlsl(LAND_NOISE.heroFade[0])}, ${toGlsl(LAND_NOISE.heroFade[1])}, r);
  float slow = (fieldLandNoise(p.x / ${toGlsl(LAND_NOISE.broad.scale)} + ${toGlsl(LAND_NOISE.broad.offset)}, p.y / ${toGlsl(LAND_NOISE.broad.scale)} + ${toGlsl(LAND_NOISE.broad.offset)}) - 0.5) * ${toGlsl(LAND_NOISE.broad.amount)};
  float reach = 1.0 - smoothstep(${toGlsl(LAND_NOISE.fine.reach[0])}, ${toGlsl(LAND_NOISE.fine.reach[1])}, r);
  if (reach > 0.0) {
    slow += (fieldLandNoise(p.x / ${toGlsl(LAND_NOISE.fine.scale)} + ${toGlsl(LAND_NOISE.fine.offset)}, p.y / ${toGlsl(LAND_NOISE.fine.scale)} + ${toGlsl(LAND_NOISE.fine.offset)}) - 0.5) * ${toGlsl(LAND_NOISE.fine.amount)} * reach;
  }
  float z = slow * ${toGlsl(LAND_NOISE.bedShare)} * away;
  if (r < ${toGlsl(LAND_NOISE.ripple.fade[1])}) {
    z += (fieldLandNoise(p.x / ${toGlsl(LAND_NOISE.grit.scale)} + ${toGlsl(LAND_NOISE.grit.offset)}, p.y / ${toGlsl(LAND_NOISE.grit.scale)} + ${toGlsl(LAND_NOISE.grit.offset)}) - 0.5) * ${toGlsl(LAND_NOISE.grit.amount)} * (1.0 - smoothstep(${toGlsl(LAND_NOISE.grit.fade[0])}, ${toGlsl(LAND_NOISE.grit.fade[1])}, r)) * away;
    z += (fieldLandNoise(p.x / ${toGlsl(LAND_NOISE.ripple.scale)} + ${toGlsl(LAND_NOISE.ripple.offset)}, p.y / ${toGlsl(LAND_NOISE.ripple.scale)} + ${toGlsl(LAND_NOISE.ripple.offset)}) - 0.5) * ${toGlsl(LAND_NOISE.ripple.amount)} * (1.0 - smoothstep(${toGlsl(LAND_NOISE.ripple.fade[0])}, ${toGlsl(LAND_NOISE.ripple.fade[1])}, r)) * away;
  }
  return z - FIELD_LAND_TILT * FIELD_LAND_TILT_REACH * tanh(p.x / FIELD_LAND_TILT_REACH);
}

// Signed metres from the nearest furrow's centre line, positive to its north.
float fieldFurrowU(vec2 p) {
  float v = p.y - FIELD_LAND_FURROW_AT;
  return v - FIELD_LAND_BED_SPACING * floor(v / FIELD_LAND_BED_SPACING + 0.5);
}

// 1 on the culvert crossing's bridge, falling to 0 down its end ramps, else 0.
float fieldCrossing(vec2 p) {
  if (abs(p.y - FIELD_LAND_FURROW_AT) >= FIELD_LAND_ZONE) return 0.0;
  float outside = max(max(FIELD_LAND_CROSS_FROM - p.x, p.x - FIELD_LAND_CROSS_TO), 0.0);
  return 1.0 - min(outside / FIELD_LAND_CROSS_RAMP, 1.0);
}

// A furrow's profile against the bed, 0 or below, by metres from its centre line: floor, bank, and a
// shoulder of a lip and an apron that rounds it up to the bed with no crease.
float fieldFurrowProfile(float across) {
  if (across >= FIELD_LAND_ZONE) return 0.0;
  if (across >= FIELD_LAND_LIP_END) {
    float e = FIELD_LAND_ZONE - across;
    return -FIELD_LAND_APRON_CURVE * e * e;
  }
  if (across >= FIELD_LAND_HALF_TOP) {
    float e = across - FIELD_LAND_HALF_TOP;
    return FIELD_LAND_BANK_TOP_Z + FIELD_LAND_BANK_SLOPE * e - FIELD_LAND_LIP_CURVE * e * e;
  }
  if (across >= FIELD_LAND_HALF_FLOOR) return FIELD_LAND_FLOOR_Z + (across - FIELD_LAND_HALF_FLOOR) * FIELD_LAND_BANK_SLOPE;
  return FIELD_LAND_FLOOR_Z;
}

// How steeply that profile rises away from the centre line, metres a metre, as getFurrowSlope.
float fieldFurrowSlope(float across) {
  if (across >= FIELD_LAND_ZONE) return 0.0;
  if (across >= FIELD_LAND_LIP_END) return 2.0 * FIELD_LAND_APRON_CURVE * (FIELD_LAND_ZONE - across);
  if (across >= FIELD_LAND_HALF_TOP) return FIELD_LAND_BANK_SLOPE - 2.0 * FIELD_LAND_LIP_CURVE * (across - FIELD_LAND_HALF_TOP);
  if (across >= FIELD_LAND_HALF_FLOOR) return FIELD_LAND_BANK_SLOPE;
  return 0.0;
}

// Half the width of a furrow's water at a level against its bed, as getFurrowWaterHalf.
float fieldFurrowWaterHalf(float level) {
  if (level <= FIELD_LAND_FLOOR_Z) return 0.0;
  if (level <= FIELD_LAND_BANK_TOP_Z) return FIELD_LAND_HALF_FLOOR + (level - FIELD_LAND_FLOOR_Z) / FIELD_LAND_BANK_SLOPE;
  if (level >= 0.0) return FIELD_LAND_ZONE;
  if (level <= FIELD_LAND_LIP_Z) {
    float rise = level - FIELD_LAND_BANK_TOP_Z;
    return FIELD_LAND_HALF_TOP + 2.0 * rise / (FIELD_LAND_BANK_SLOPE + sqrt(FIELD_LAND_BANK_SLOPE * FIELD_LAND_BANK_SLOPE - 4.0 * FIELD_LAND_LIP_CURVE * rise));
  }
  return FIELD_LAND_ZONE - sqrt(-level / FIELD_LAND_APRON_CURVE);
}

// Metres along the land's surface across a furrow, as getFurrowArc: the same as across past the zone.
float fieldFurrowArc(float across) {
  float lipStretch = ${toGlsl(Math.sqrt(1 + ((FURROW.bankSlope + BED_LAYOUT.lipSlope) / 2) ** 2) - 1)};
  float apronStretch = ${toGlsl(Math.sqrt(1 + (BED_LAYOUT.lipSlope / 2) ** 2) - 1)};
  float bankStretch = ${toGlsl(Math.sqrt(1 + FURROW.bankSlope * FURROW.bankSlope) - 1)};
  return across -
    (FIELD_LAND_ZONE - clamp(across, FIELD_LAND_LIP_END, FIELD_LAND_ZONE)) * apronStretch -
    (FIELD_LAND_LIP_END - clamp(across, FIELD_LAND_HALF_TOP, FIELD_LAND_LIP_END)) * lipStretch -
    (FIELD_LAND_HALF_TOP - clamp(across, FIELD_LAND_HALF_FLOOR, FIELD_LAND_HALF_TOP)) * bankStretch;
}

// The crowned bed middle, flattened round the hero.
float fieldLandCrown(float across, float fromHero) {
  float fromMiddle = abs(FIELD_LAND_BED_SPACING * 0.5 - across) / FIELD_LAND_CROWN_WIDTH;
  if (fromMiddle >= 1.0) return 0.0;
  return FIELD_LAND_CROWN_Z * (1.0 - smoothstep(0.0, 1.0, fromMiddle)) * smoothstep(${toGlsl(BED_LAYOUT.heroClear[0])}, ${toGlsl(BED_LAYOUT.heroClear[1])}, fromHero);
}

// The land over an offset already worked out at p, as fieldLandOffset gives it.
float fieldLandOver(vec2 p, float offset) {
  float across = abs(fieldFurrowU(p));
  float profile = fieldFurrowProfile(across);
  float crossing = fieldCrossing(p);
  if (crossing > 0.0) profile = max(profile, FIELD_LAND_FLOOR_Z * (1.0 - crossing));
  return offset + profile + fieldLandCrown(across, sqrt(p.x * p.x + p.y * p.y));
}

// Height of the land in metres.
float fieldLandHeight(vec2 p) {
  return fieldLandOver(p, fieldLandOffset(p));
}

// The land with every furrow filled to its bed: never below the land, and the same off the furrows.
float fieldLandBed(vec2 p) {
  float across = abs(fieldFurrowU(p));
  return fieldLandOffset(p) + fieldLandCrown(across, sqrt(p.x * p.x + p.y * p.y));
}
`;
