// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Botanical crown skeletons from time-stepped space colonization (Runions et al., 2007).
 *
 * Space is isotropic and normalized to the mature tree's height. A node keeps its birth
 * and parent, so later stages can grow wood around it without moving the existing skeleton.
 */

import {clamp} from '@math.gl/core';
import {
  resolveTreeCharacteristics,
  type ResolvedTreeCharacteristics,
  type TreeCharacteristics
} from './tree-characteristics';
import {
  getTreeCrownFraction,
  getTreeGrowthAtHeight,
  getTreeHeightFraction
} from './tree-growth-fractions';
import {createTreeRng} from './tree-geometry';

/** Species with a space-colonized crown model. */
export type TreeGrowthSpecies = 'oak' | 'birch' | 'cherry' | 'banyan' | 'mangrove' | 'citrus';

type TreeGrowthTraits = TreeCharacteristics & {
  branchWander?: number;
  twigDroop?: number;
};
type ResolvedTreeGrowthTraits = ResolvedTreeCharacteristics & Required<TreeGrowthTraits>;

function resolveTreeGrowthTraits(input: TreeGrowthTraits = {}): ResolvedTreeGrowthTraits {
  const resolveBranchTrait = (value = 1) =>
    Number.isFinite(value) ? Math.round(clamp(value, 0, 2) * 100) / 100 : 1;
  return {
    ...resolveTreeCharacteristics(input),
    branchWander: resolveBranchTrait(input.branchWander),
    twigDroop: resolveBranchTrait(input.twigDroop)
  };
}

/**
 * Template z of a citrus tree's bud union, the graft line between rootstock and scion. The swelling
 * is part of the trunk's rings. Trunk bark v starts at 0 on the ground and follows the stem, so a
 * bark shader can draw the line at about this bark v.
 */
const TREE_CITRUS_BUD_UNION_Z = 0.042;
/** Latest birth of a skeleton node. Rings have room above it to stay strictly increasing. */
const LAST_NODE_BIRTH = 0.9985;
/** Capacity of the limb nodes and shoot table while colonizing; profiles stay well below them. */
const LIMB_CAPACITY = 12000;
const SHOOT_CAPACITY = 6000;
/** Resolution of the arrival table: rows by height, columns by reach. */
const ARRIVAL_ROWS = 128;
const ARRIVAL_COLUMNS = 96;
/** Side of the grid of `CrownEnvelope.reach`, and the lobes of about 1 to 2 m on a crown's surface. */
const CROWN_REACH_GRID = 64;
const CROWN_LOBES = 70;
/** How far the strongest lobes pass the crown's radius, as a fraction of it. */
const CROWN_LOBE_PAST = 0.1;
/** Resolution of `getCrownArrival`. */
const GROWTH_STEPS = 4096;
const CROWN_TABLE_SIZE = 512;
/** Cosines of the half angle in which a tip and a dormant bud perceive attractors. */
const TIP_CONE = 0.2;
const BUD_CONE = -0.35;
/** States of a node's dormant bud; 0 means it has none awake yet. */
const BUD_AWAKE = 1;
const BUD_SPENT = 2;
/** Colonization steps an attractor waits, unreached, before it wakes a bud on old wood. */
const ATTRACTOR_PATIENCE = 5;
const GOLDEN_ANGLE = 2.39996323;
const TWO_PI = Math.PI * 2;

/** Species growth profiles. Lengths are normalized to mature tree height. */
type TreeGrowthProfile = {
  /** Tree height, in metres, the leaf lengths are authored for. */
  referenceHeight: number;
  /** Mature crown radius over height. */
  crownAspect: number;
  /** Trunk base radius over height. */
  trunkRatio: number;
  /** Template z of the first fork. */
  forkZ: number;
  /** Relative height of the crown's widest ring. */
  widestZ: number;
  /** Relative height where the crown's lower curve would close; below 0 makes a bell. */
  footZ: number;
  /** Lowest z colonized by the mature crown. */
  floorZ: number;
  /** Superellipse exponents of the crown above and below its widest ring. */
  topPower: number;
  footPower: number;
  /** Height of the hollow under the crown, and the crown fraction it reaches. */
  hollowHeight: number;
  hollowReach: number;
  /** Colonization density in the hollow and in the outer shell, against the crown's old core. */
  hollowDensity: number;
  shellDensity: number;
  /** Fewest and most scaffolds, and the z span their sockets share above forkZ. */
  scaffolds: [number, number];
  socketSpan: number;
  /** Scaffold departure from vertical, top socket to bottom socket, in degrees. */
  scaffoldAngle: [number, number];
  /** Departure from vertical of the scaffold that continues the stem, in degrees. */
  leaderAngle: number;
  /** Scaffold length grown along its authored heading before attractors steer it. */
  scaffoldRun: number;
  /** Crown attractors, and the fraction of them that shapes the outer surface. */
  attractors: number;
  surfaceFraction: number;
  /** Tip step, and the attractor influence and kill radii. */
  step: number;
  influence: number;
  kill: number;
  /** Heading weights of a growing tip. */
  persistence: number;
  attraction: number;
  /** Upward tropism of young wood, the droop of tips near the crown surface, and phototropism. */
  lift: number;
  droop: number;
  light: number;
  /** Low-frequency sinuosity: heading weight and wavelength. */
  wander: number;
  wanderWave: number;
  /** Sharper direction changes between flushes: largest angle in degrees, and typical spacing. */
  kinkAngle: number;
  kinkSpacing: number;
  /** Typical distance between forks, and before a scaffold's first. */
  forkSpacing: number;
  forkFirst: number;
  /** Smallest and largest angle between the two arms of a fork, in degrees. */
  forkAngle: [number, number];
  /** Typical distance between dormant lateral buds. */
  budSpacing: number;
  /** How far a shoot elongates with no attractor to steer it. */
  freeGrowth: number;
  /** Stem wander in trunk radii. */
  stemWander: number;
  /** Bud union height; 0 means no graft. */
  budUnionZ: number;
  /** Limb nodes colonization may lay. */
  limbBudget: number;
  /** Flush shoots, the short leafy shoots that fill the crown, and their typical length. */
  flushShoots: number;
  flushLength: number;
  /** Side shoots of a young whip, spiralling up its stem. */
  feathers: number;
  /** Droop of shoots. */
  twigDroop: number;
  /** Mature radius of a terminal twig, relative to the trunk base. */
  twigFloor: number;
  /** Lateral surface roots, fewest and most. */
  roots: [number, number];
  /** Arching stilt roots from the lower trunk, and aerial roots hanging from limbs. */
  stiltRoots: number;
  aerialRoots: number;
  /** Leaves at LOD 0, leaf length in metres at referenceHeight, width over length. */
  leaves: number;
  leafLength: number;
  leafWidth: number;
  /** Droop of leaf tips. */
  leafDroop: number;
  /** Earliest growth at which the tree bears crops. */
  cropStart: number;
  /** Thorns per thousand skeleton nodes; 0 gives none. */
  thorns: number;
};

const CITRUS_PROFILE: TreeGrowthProfile = {
  referenceHeight: 7.5,
  crownAspect: 0.52,
  trunkRatio: 0.025,
  forkZ: 0.11,
  widestZ: 0.33,
  footZ: -0.3,
  floorZ: 0.035,
  topPower: 2.6,
  footPower: 2.3,
  hollowHeight: 0.1,
  hollowReach: 0.62,
  hollowDensity: 0.15,
  shellDensity: 0.5,
  scaffolds: [3, 5],
  socketSpan: 0.075,
  scaffoldAngle: [36, 62],
  leaderAngle: 16,
  scaffoldRun: 0.05,
  attractors: 1500,
  surfaceFraction: 0.22,
  step: 0.024,
  influence: 0.17,
  kill: 0.042,
  persistence: 1.5,
  attraction: 0.75,
  lift: 0.1,
  droop: 0.2,
  light: 0.2,
  wander: 0.27,
  wanderWave: 0.24,
  kinkAngle: 21,
  kinkSpacing: 0.085,
  forkSpacing: 0.066,
  forkFirst: 0.055,
  forkAngle: [32, 68],
  budSpacing: 0.085,
  freeGrowth: 0.05,
  stemWander: 0.2,
  budUnionZ: TREE_CITRUS_BUD_UNION_Z,
  limbBudget: 6000,
  flushShoots: 10500,
  flushLength: 0.042,
  feathers: 7,
  twigDroop: 0.9,
  twigFloor: 0.0085,
  roots: [9, 13],
  stiltRoots: 0,
  aerialRoots: 0,
  leaves: 168000,
  leafLength: 0.088,
  leafWidth: 0.56,
  leafDroop: 0.5,
  cropStart: 0.13,
  thorns: 90
};

const PROFILES: Record<TreeGrowthSpecies, TreeGrowthProfile> = {
  citrus: CITRUS_PROFILE,
  oak: {
    ...CITRUS_PROFILE,
    referenceHeight: 14,
    crownAspect: 0.42,
    trunkRatio: 0.032,
    forkZ: 0.27,
    widestZ: 0.56,
    footZ: 0.12,
    floorZ: 0.2,
    topPower: 2.1,
    footPower: 2.2,
    hollowHeight: 0.06,
    hollowReach: 0.5,
    hollowDensity: 0.3,
    shellDensity: 0.7,
    scaffolds: [4, 6],
    socketSpan: 0.16,
    scaffoldAngle: [50, 78],
    leaderAngle: 22,
    scaffoldRun: 0.09,
    attractors: 1300,
    persistence: 1.05,
    lift: 0.05,
    droop: 0.16,
    wander: 0.58,
    wanderWave: 0.22,
    kinkAngle: 34,
    kinkSpacing: 0.085,
    forkSpacing: 0.085,
    forkFirst: 0.11,
    forkAngle: [38, 75],
    stemWander: 0.18,
    budUnionZ: 0,
    limbBudget: 4200,
    twigFloor: 0.012,
    flushShoots: 5400,
    feathers: 5,
    twigDroop: 0.25,
    roots: [10, 14],
    leaves: 76000,
    leafLength: 0.18,
    leafWidth: 0.56,
    leafDroop: 0.25,
    cropStart: 0.3,
    thorns: 0
  },
  birch: {
    ...CITRUS_PROFILE,
    referenceHeight: 14,
    crownAspect: 0.23,
    trunkRatio: 0.018,
    forkZ: 0.26,
    widestZ: 0.42,
    footZ: 0.14,
    floorZ: 0.2,
    topPower: 1.7,
    footPower: 2.2,
    hollowHeight: 0.05,
    hollowReach: 0.4,
    hollowDensity: 0.4,
    shellDensity: 0.8,
    scaffolds: [5, 7],
    socketSpan: 0.42,
    scaffoldAngle: [38, 62],
    leaderAngle: 5,
    scaffoldRun: 0.05,
    attractors: 1150,
    influence: 0.14,
    persistence: 1.5,
    attraction: 0.7,
    lift: 0.12,
    droop: 0.55,
    wander: 0.24,
    wanderWave: 0.3,
    kinkAngle: 14,
    kinkSpacing: 0.16,
    forkSpacing: 0.095,
    forkFirst: 0.09,
    forkAngle: [24, 52],
    stemWander: 0.12,
    budUnionZ: 0,
    limbBudget: 3850,
    twigFloor: 0.0133,
    flushShoots: 4100,
    feathers: 5,
    twigDroop: 1.7,
    roots: [8, 12],
    leaves: 58000,
    leafLength: 0.1,
    leafWidth: 0.68,
    leafDroop: 0.45,
    cropStart: 0.25,
    thorns: 0
  },
  cherry: {
    ...CITRUS_PROFILE,
    referenceHeight: 8,
    crownAspect: 0.36,
    trunkRatio: 0.027,
    forkZ: 0.24,
    widestZ: 0.56,
    footZ: 0.12,
    floorZ: 0.2,
    topPower: 2.2,
    footPower: 2.2,
    hollowHeight: 0.05,
    hollowReach: 0.5,
    hollowDensity: 0.3,
    shellDensity: 0.65,
    scaffolds: [3, 5],
    socketSpan: 0.13,
    scaffoldAngle: [38, 62],
    leaderAngle: 18,
    attractors: 1100,
    persistence: 1.25,
    lift: 0.12,
    droop: 0.2,
    wander: 0.36,
    kinkAngle: 18,
    kinkSpacing: 0.13,
    forkAngle: [30, 60],
    stemWander: 0.16,
    budUnionZ: 0.05,
    limbBudget: 3500,
    twigFloor: 0.0142,
    flushShoots: 3400,
    feathers: 5,
    twigDroop: 0.5,
    roots: [8, 12],
    leaves: 48000,
    leafLength: 0.13,
    leafWidth: 0.45,
    leafDroop: 0.35,
    cropStart: 0.18,
    thorns: 0
  },
  banyan: {
    ...CITRUS_PROFILE,
    referenceHeight: 18,
    crownAspect: 0.62,
    trunkRatio: 0.035,
    forkZ: 0.2,
    widestZ: 0.6,
    footZ: 0.14,
    floorZ: 0.2,
    topPower: 2.8,
    footPower: 1.9,
    hollowHeight: 0.04,
    hollowReach: 0.55,
    hollowDensity: 0.3,
    shellDensity: 0.7,
    scaffolds: [5, 7],
    socketSpan: 0.14,
    scaffoldAngle: [62, 84],
    leaderAngle: 20,
    scaffoldRun: 0.12,
    attractors: 1120,
    influence: 0.2,
    kill: 0.038,
    lift: 0.03,
    droop: 0.1,
    wander: 0.42,
    kinkAngle: 22,
    kinkSpacing: 0.12,
    forkSpacing: 0.09,
    forkFirst: 0.12,
    forkAngle: [36, 72],
    stemWander: 0.22,
    budUnionZ: 0,
    limbBudget: 4340,
    twigFloor: 0.0113,
    flushShoots: 6300,
    feathers: 5,
    twigDroop: 0.45,
    roots: [11, 14],
    aerialRoots: 9,
    leaves: 88000,
    leafLength: 0.22,
    leafWidth: 0.6,
    leafDroop: 0.3,
    cropStart: 0.35,
    thorns: 0
  },
  mangrove: {
    ...CITRUS_PROFILE,
    referenceHeight: 8,
    crownAspect: 0.42,
    trunkRatio: 0.028,
    forkZ: 0.22,
    widestZ: 0.6,
    footZ: 0.14,
    floorZ: 0.22,
    topPower: 2.3,
    footPower: 2.1,
    hollowHeight: 0.05,
    hollowReach: 0.5,
    hollowDensity: 0.3,
    shellDensity: 0.7,
    scaffolds: [4, 6],
    socketSpan: 0.13,
    scaffoldAngle: [44, 70],
    leaderAngle: 18,
    attractors: 1150,
    lift: 0.08,
    droop: 0.22,
    wander: 0.5,
    kinkAngle: 26,
    stemWander: 0.3,
    budUnionZ: 0,
    limbBudget: 3600,
    twigFloor: 0.0134,
    flushShoots: 4000,
    feathers: 5,
    twigDroop: 0.55,
    roots: [8, 10],
    stiltRoots: 8,
    leaves: 56000,
    leafLength: 0.13,
    leafWidth: 0.46,
    leafDroop: 0.3,
    cropStart: 0.25,
    thorns: 0
  }
};

export function isTreeGrowthSpecies(type: string): type is TreeGrowthSpecies {
  return Object.prototype.hasOwnProperty.call(PROFILES, type);
}

// Keep the growth model’s interpolation order so seeded skeletons stay reproducible.
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function drawGaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TWO_PI * rng());
}

function getGreatestCommonDivisor(a: number, b: number): number {
  return b === 0 ? a : getGreatestCommonDivisor(b, a % b);
}

function createStream(seed: number, salt: number): () => number {
  return createTreeRng(Math.imul(seed ^ salt, 0x5bd1e995) >>> 0);
}

/** Fractions of a whole, with at least `ratio` between the largest and the smallest. */
function drawUnequalGaps(rng: () => number, count: number, ratio: number): number[] {
  let gaps: number[] = [];
  for (let attempt = 0; attempt < 64; attempt++) {
    gaps = Array.from({length: count}, () => 0.6 + rng() * 0.9);
    if (count < 2 || Math.max(...gaps) / Math.min(...gaps) >= ratio) break;
  }
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return gaps.map(gap => gap / total);
}

/** Scratch output of `setSideDirection`. */
const SIDE = new Float64Array(3);

/** A unit vector perpendicular to a unit axis, at `angle` around it. */
function setSideDirection(ax: number, ay: number, az: number, angle: number): void {
  const refZ = Math.abs(az) < 0.9 ? 1 : 0;
  const refX = 1 - refZ;
  let ux = ay * refZ;
  let uy = az * refX - ax * refZ;
  let uz = -ay * refX;
  const length = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= length;
  uy /= length;
  uz /= length;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  SIDE[0] = ux * cosine + vx * sine;
  SIDE[1] = uy * cosine + vy * sine;
  SIDE[2] = uz * cosine + vz * sine;
}

// ---------------------------------------------------------------------------------------------
// Crown envelope
// ---------------------------------------------------------------------------------------------

/** `getTreeHeightFraction` and `getTreeCrownFraction` by growth step, shared by all templates. */
let growthTables: {height: Float64Array; crown: Float64Array} | null = null;

function getGrowthTables(): {height: Float64Array; crown: Float64Array} {
  if (!growthTables) {
    const height = new Float64Array(GROWTH_STEPS + 1);
    const crown = new Float64Array(GROWTH_STEPS + 1);
    for (let step = 0; step <= GROWTH_STEPS; step++) {
      height[step] = getTreeHeightFraction(step / GROWTH_STEPS);
      crown[step] = getTreeCrownFraction(step / GROWTH_STEPS);
    }
    growthTables = {height, crown};
  }
  return growthTables;
}

/**
 * The mature crown: a surface of revolution, whose surface comes and goes by direction. At growth g
 * the
 * crown is this shape scaled by `getTreeCrownFraction(g)` across and by `getTreeHeightFraction(g)`
 * up.
 */
type CrownEnvelope = {
  /** Mature crown radius in design units. */
  width: number;
  /** Lowest colonized z. */
  floorZ: number;
  /** Relative height of the widest ring, and where the crown's lower curve would close. */
  widest: number;
  foot: number;
  /** Relative radius by relative height. */
  profile: Float64Array;
  /**
   * How far the surface comes out along each direction from the crown's center, as a fraction of
   * the
   * smooth shape's, on an octahedral grid: see `shapeCrownReach`. Null for a smooth crown.
   */
  reach: Float32Array | null;
};

function createCrownEnvelope(
  profile: TreeGrowthProfile,
  traits: ResolvedTreeCharacteristics
): CrownEnvelope {
  const depth = traits.crownDepth;
  const widest = clamp(1 - (1 - profile.widestZ) * depth, 0.08, 0.85);
  const foot = 1 - (1 - profile.footZ) * depth;
  const table = new Float64Array(CROWN_TABLE_SIZE + 1);
  for (let index = 0; index <= CROWN_TABLE_SIZE; index++) {
    const zeta = index / CROWN_TABLE_SIZE;
    if (zeta >= widest) {
      const t = (zeta - widest) / (1 - widest);
      table[index] = Math.pow(Math.max(0, 1 - Math.pow(t, profile.topPower)), 1 / profile.topPower);
    } else {
      const t = (widest - zeta) / (widest - foot);
      table[index] =
        t >= 1 ? 0 : Math.pow(1 - Math.pow(t, profile.footPower), 1 / profile.footPower);
    }
  }
  return {
    width: profile.crownAspect * traits.crownSpread,
    floorZ: Math.max(0.02, 1 - (1 - profile.floorZ) * depth),
    widest,
    foot,
    profile: table,
    reach: null
  };
}

/** A relative height in the frame of `getCrownReach`: 0 at the widest ring, 1 at the top, -1 at the foot. */
function getCrownFrameZ(envelope: CrownEnvelope, zeta: number): number {
  const offset = zeta - envelope.widest;
  return offset >= 0 ? offset / (1 - envelope.widest) : offset / (envelope.widest - envelope.foot);
}

/** The fraction of `CrownEnvelope.reach` toward a point, given in crown widths and frame height. */
function getCrownReach(envelope: CrownEnvelope, nx: number, ny: number, nz: number): number {
  const {reach} = envelope;
  if (!reach) return 1;
  const sum = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
  if (sum < 1e-6) return 1;
  let u = nx / sum;
  let v = ny / sum;
  if (nz < 0) {
    const folded = (1 - Math.abs(v)) * (u < 0 ? -1 : 1);
    v = (1 - Math.abs(u)) * (v < 0 ? -1 : 1);
    u = folded;
  }
  const size = CROWN_REACH_GRID;
  const across = (u + 1) * 0.5 * size;
  const along = (v + 1) * 0.5 * size;
  const column = Math.min(across | 0, size - 1);
  const row = Math.min(along | 0, size - 1);
  const s = across - column;
  const t = along - row;
  const at = row * (size + 1) + column;
  const lower = reach[at] + (reach[at + 1] - reach[at]) * s;
  const upper = reach[at + size + 1] + (reach[at + size + 2] - reach[at + size + 1]) * s;
  return lower + (upper - lower) * t;
}

function getCrownProfile(envelope: CrownEnvelope, zeta: number): number {
  const position = clamp(zeta, 0, 1) * CROWN_TABLE_SIZE;
  const index = Math.min(position | 0, CROWN_TABLE_SIZE - 1);
  const {profile} = envelope;
  return profile[index] + (profile[index + 1] - profile[index]) * (position - index);
}

/**
 * How far a design-space point is from the crown axis, as a fraction of the way to the surface of
 * the crown with these height and crown fractions. Above 1 is outside.
 */
function getCrownFill(
  envelope: CrownEnvelope,
  x: number,
  y: number,
  z: number,
  height: number,
  crown: number
): number {
  if (z >= height || height <= 0 || crown <= 0) return 2;
  const zeta = z / height;
  const radius = Math.sqrt(x * x + y * y);
  const scale = 1 / (crown * envelope.width);
  const reach = getCrownReach(envelope, x * scale, y * scale, getCrownFrameZ(envelope, zeta));
  // The surface comes and goes along the way from the crown's center.
  const moved = envelope.widest + (zeta - envelope.widest) / reach;
  if (moved >= 1) return 2;
  // Below the crown's foot there is still a corridor, so limbs can reach a high crown base.
  const relative = Math.max(getCrownProfile(envelope, moved), moved < envelope.widest ? 0.35 : 0);
  const width = relative * envelope.width * crown * reach;
  return width > 1e-6 ? radius / width : radius > 1e-6 ? 2 : 0;
}

/** The growth at which the expanding crown reaches a point, or 1 if the mature crown never does. */
function getCrownArrival(envelope: CrownEnvelope, x: number, y: number, z: number): number {
  if (getCrownFill(envelope, x, y, z, 1, 1) > 1) return 1;
  const tables = getGrowthTables();
  let low = 0;
  let high = GROWTH_STEPS;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (getCrownFill(envelope, x, y, z, tables.height[middle], tables.crown[middle]) <= 1) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high / GROWTH_STEPS;
}

/**
 * `getCrownArrival` for the smooth shape, as a table of height and radius as a fraction of the
 * crown's
 * full width, for the tens of thousands of nodes of a template's fine shoots.
 */
function* createArrivalTable(
  envelope: CrownEnvelope,
  shouldYield: () => boolean
): Generator<void, Float32Array, void> {
  const tables = getGrowthTables();
  const table = new Float32Array((ARRIVAL_ROWS + 1) * (ARRIVAL_COLUMNS + 1));
  for (let row = 0; row <= ARRIVAL_ROWS; row++) {
    if (shouldYield()) yield;
    const z = row / ARRIVAL_ROWS;
    for (let column = 0; column <= ARRIVAL_COLUMNS; column++) {
      const reach = column / ARRIVAL_COLUMNS;
      let low = 0;
      let high = GROWTH_STEPS;
      while (high - low > 1) {
        const middle = (low + high) >> 1;
        const height = tables.height[middle];
        const zeta = z / height;
        const relative =
          z >= height
            ? -1
            : Math.max(getCrownProfile(envelope, zeta), zeta < envelope.widest ? 0.35 : 0);
        if (reach <= relative * tables.crown[middle]) high = middle;
        else low = middle;
      }
      table[row * (ARRIVAL_COLUMNS + 1) + column] = high / GROWTH_STEPS;
    }
  }
  return table;
}

/** The growth at which the smooth crown reaches a height and a radius in crown widths. */
function readArrivalTable(table: Float32Array, radial: number, z: number): number {
  const across = radial * ARRIVAL_COLUMNS;
  if (across >= ARRIVAL_COLUMNS) return 1;
  const height = clamp(z, 0, 1) * ARRIVAL_ROWS;
  const row = Math.min(height | 0, ARRIVAL_ROWS - 1);
  const column = across | 0;
  const s = across - column;
  const t = height - row;
  const stride = ARRIVAL_COLUMNS + 1;
  const at = row * stride + column;
  const lower = table[at] + (table[at + 1] - table[at]) * s;
  const upper = table[at + stride] + (table[at + stride + 1] - table[at + stride]) * s;
  return lower + (upper - lower) * t;
}

/** The growth at which the crown reaches a point, nearly as `getCrownArrival` would say. */
function lookUpArrival(
  envelope: CrownEnvelope,
  table: Float32Array,
  x: number,
  y: number,
  z: number
): number {
  const radial = Math.sqrt(x * x + y * y) / envelope.width;
  const smooth = readArrivalTable(table, radial, z);
  if (smooth >= 1 || !envelope.reach) return smooth;
  // The surface in this direction, seen from the crown of that age, which then has to grow to reach
  // it.
  const tables = getGrowthTables();
  const step = Math.round(smooth * GROWTH_STEPS);
  const height = tables.height[step];
  const crown = tables.crown[step];
  const scale = 1 / (crown * envelope.width);
  const reach = getCrownReach(envelope, x * scale, y * scale, getCrownFrameZ(envelope, z / height));
  const center = envelope.widest * height;
  return readArrivalTable(table, radial / reach, center + (z - center) / reach);
}

/**
 * Gives the crown the outline of a real tree, since a smooth dome reads as topiary. Every scaffold
 * holds up
 * a sub-crown over a sector of its own and sets its reach, so a tree differs from side to side and
 * from
 * seed to seed. Each has a few bulges where its main limbs end, and over all of them lie lobes of a
 * metre or
 * two. A valley between lobes is where the crown is dark. A crown's radius is about the reach of
 * its
 * stronger side, its lobes a little past that, and the top stays near the tree's height.
 * `crownAsymmetry`
 * scales all of it, and at 0 the crown is smooth.
 */
function* shapeCrownReach(
  context: GrowthContext,
  plan: ScaffoldPlan[],
  rng: () => number
): Generator<void, void, void> {
  const {envelope, traits} = context;
  const amount = traits.crownAsymmetry;
  if (amount <= 0) return;

  // Each scaffold's own reach, spread to the full range, so that every tree has a strong and a weak
  // side.
  const sectors = plan.map(scaffold => clamp((scaffold.domain - 0.85) / 0.45, 0, 1) + rng() * 2);
  const least = Math.min(...sectors);
  const spread = Math.max(Math.max(...sectors) - least, 1e-6);
  const reaches = sectors.map(sector => 1 - 0.2 * amount * (1 - (sector - least) / spread));
  const meanReach = reaches.reduce((sum, reach) => sum + reach, 0) / reaches.length;
  const halfWidth = Math.PI / plan.length;
  // Borders wander with height as those of `assignCrownDomains` do, as they have the same twist.
  const twist = createStream(context.seed, 0xd0a1)() * TWO_PI;

  const direction = new Float64Array(3);
  const setDirection = (azimuth: number, rise: number): void => {
    const planar = Math.sqrt(Math.max(0, 1 - rise * rise));
    direction[0] = Math.cos(azimuth) * planar;
    direction[1] = Math.sin(azimuth) * planar;
    direction[2] = rise;
  };
  // Domes in direction, at chord distances: x, y, z, one over the width squared, and height.
  const domes: number[] = [];
  const addDome = (list: number[], width: number, height: number): void => {
    list.push(direction[0], direction[1], direction[2], 1 / (width * width), height);
  };
  const bulges: number[] = [];
  plan.forEach((scaffold, index) => {
    const count = 2 + Math.floor(rng() * 3);
    for (let bulge = 0; bulge < count; bulge++) {
      setDirection(
        scaffold.azimuth + drawGaussian(rng) * halfWidth * scaffold.domain * 0.7,
        lerp(-0.3, 0.85, rng())
      );
      addDome(bulges, 0.34 + rng() * 0.2, (0.65 + rng() * 0.35) * reaches[index]);
    }
  });
  const turn = rng() * TWO_PI;
  for (let lobe = 0; lobe < CROWN_LOBES; lobe++) {
    if (context.shouldYield()) yield;
    setDirection(
      lobe * GOLDEN_ANGLE + turn + (rng() - 0.5) * 0.5,
      clamp(1 - ((lobe + 0.5 + (rng() - 0.5)) * 2) / CROWN_LOBES, -1, 1)
    );
    addDome(domes, 0.14 + rng() * 0.11, 0.35 + rng() * 0.65);
  }
  const peak = (list: number[], px: number, py: number, pz: number): number => {
    let best = 0;
    for (let at = 0; at < list.length; at += 5) {
      const chord = 2 - 2 * (px * list[at] + py * list[at + 1] + pz * list[at + 2]);
      const spent = chord * list[at + 3];
      if (spent < 3) best = Math.max(best, list[at + 4] * Math.exp(-spent));
    }
    return best;
  };

  const bulgeDepth = 0.13 * amount;
  const lobeDepth = 0.17 * amount;
  const size = CROWN_REACH_GRID;
  const reach = new Float32Array((size + 1) * (size + 1));
  for (let row = 0; row <= size; row++) {
    if (context.shouldYield()) yield;
    for (let column = 0; column <= size; column++) {
      let u = (column / size) * 2 - 1;
      let v = (row / size) * 2 - 1;
      const rise = 1 - Math.abs(u) - Math.abs(v);
      if (rise < 0) {
        const folded = (1 - Math.abs(v)) * (u < 0 ? -1 : 1);
        v = (1 - Math.abs(u)) * (v < 0 ? -1 : 1);
        u = folded;
      }
      const inverse = 1 / Math.sqrt(u * u + v * v + rise * rise);
      const px = u * inverse;
      const py = v * inverse;
      const pz = rise * inverse;
      const zeta =
        envelope.widest + pz * (pz >= 0 ? 1 - envelope.widest : envelope.widest - envelope.foot);
      const azimuth = Math.atan2(py, px) + 0.45 * Math.sin(zeta * 5 + twist);
      let weights = 0;
      let sum = 0;
      for (let index = 0; index < plan.length; index++) {
        let gap = azimuth - plan[index].azimuth;
        gap -= TWO_PI * Math.round(gap / TWO_PI);
        const width = halfWidth * plan[index].domain * 0.75;
        const weight = Math.exp(-(gap * gap) / (width * width)) + 1e-6;
        weights += weight;
        sum += weight * reaches[index];
      }
      // Sectors meet at the top, where the steep last scaffold holds up the crown.
      const sector = lerp(meanReach, sum / weights, Math.sqrt(Math.max(0, 1 - pz * pz)));
      const value =
        sector *
        (1 - bulgeDepth * (1 - peak(bulges, px, py, pz))) *
        (1 - lobeDepth * (1 - peak(domes, px, py, pz)));
      reach[row * (size + 1) + column] = value;
    }
  }
  // Most of the surface comes to the crown's radius, as a crown's size is what a user asked for.
  // The
  // strongest lobes pass it a little, by at most `CROWN_LOBE_PAST`, and the top stays near the
  // tree's height.
  const level = Float32Array.from(reach).sort()[Math.floor(reach.length * 0.8)];
  for (let at = 0; at < reach.length; at++) {
    if (context.shouldYield()) yield;
    const value = reach[at] / level;
    reach[at] =
      value > 1 ? 1 + CROWN_LOBE_PAST * (1 - Math.exp(-(value - 1) / CROWN_LOBE_PAST)) : value;
  }
  envelope.reach = reach;
  const crownTop = getCrownReach(envelope, 0, 0, 1);
  for (let row = 0; row <= size; row++) {
    if (context.shouldYield()) yield;
    for (let column = 0; column <= size; column++) {
      const u = (column / size) * 2 - 1;
      const v = (row / size) * 2 - 1;
      const near = 1 - Math.abs(u) - Math.abs(v);
      reach[row * (size + 1) + column] *= lerp(1, 0.975 / crownTop, smoothstep(0.55, 0.95, near));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Skeleton store
// ---------------------------------------------------------------------------------------------

/** Skeleton nodes, always appended after their parent, so index order is topological. */
type GrowthNodes = {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  parent: Int32Array;
  birth: Float64Array;
  /** Shoot that laid the node; shoot 0 is the stem. */
  shoot: Int32Array;
  /** Next node laid by the same shoot, or -1. */
  next: Int32Array;
  /** Non-zero where a shoot changed direction between flushes. */
  kink: Uint8Array;
  /** Heading of the shoot at this node. */
  hx: Float32Array;
  hy: Float32Array;
  hz: Float32Array;
  /** Crown fraction at which the crown reaches this node. */
  level: Float64Array;
};

function createGrowthNodes(capacity: number): GrowthNodes {
  return {
    count: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    parent: new Int32Array(capacity),
    birth: new Float64Array(capacity),
    shoot: new Int32Array(capacity),
    next: new Int32Array(capacity).fill(-1),
    kink: new Uint8Array(capacity),
    hx: new Float32Array(capacity),
    hy: new Float32Array(capacity),
    hz: new Float32Array(capacity),
    level: new Float64Array(capacity)
  };
}

function addGrowthNode(
  nodes: GrowthNodes,
  parent: number,
  x: number,
  y: number,
  z: number,
  birth: number,
  shoot: number
): number {
  const index = nodes.count++;
  nodes.x[index] = x;
  nodes.y[index] = y;
  nodes.z[index] = z;
  nodes.parent[index] = parent;
  nodes.birth[index] = birth;
  nodes.shoot[index] = shoot;
  if (parent >= 0 && nodes.shoot[parent] === shoot) nodes.next[parent] = index;
  return index;
}

type GrowthContext = {
  profile: TreeGrowthProfile;
  traits: ResolvedTreeGrowthTraits;
  shouldYield: () => boolean;
  seed: number;
  envelope: CrownEnvelope;
  nodes: GrowthNodes;
  /** Template z of the first fork: a shallow crown sits on a longer trunk. */
  forkZ: number;
  /** Nodes below this index are the stem and limbs; those above are sprays and twigs. */
  colonized: number;
  /** See `createArrivalTable`. */
  arrivals: Float32Array;
};

/** One scaffold waiting for the stem to reach its socket. */
type ScaffoldPlan = {
  socket: number;
  azimuth: number;
  angle: number;
  leader: boolean;
  /** Relative size of the crown sector the scaffold owns. */
  domain: number;
};

// ---------------------------------------------------------------------------------------------
// Stem
// ---------------------------------------------------------------------------------------------

/**
 * The stem from the ground to the last scaffold socket. Its births follow `getTreeGrowthAtHeight`,
 * so
 * a seedling is one rising whip. Scaffolds leave it at unequal heights and azimuths, and the stem
 * bends away from each one, the way a real axis deflects where a limb takes over part of its load.
 */
function* layStem(context: GrowthContext): Generator<void, ScaffoldPlan[], void> {
  const {profile, traits, nodes} = context;
  const rng = createStream(context.seed, 0x51ed27);
  const [fewest, most] = profile.scaffolds;
  const scaffoldCount = fewest + Math.floor(rng() * (most - fewest + 1));
  const lateralCount = scaffoldCount - 1;

  const heightGaps = drawUnequalGaps(rng, lateralCount, 1.45);
  const socketZ: number[] = [context.forkZ];
  for (let index = 0; index < lateralCount; index++) {
    if (context.shouldYield()) yield;
    socketZ.push(socketZ[index] + heightGaps[index] * profile.socketSpan);
  }
  const stemTop = socketZ[lateralCount];

  // Unequal azimuth gaps, with consecutive sockets far apart, as around a real stem.
  const azimuthGaps = drawUnequalGaps(rng, lateralCount, 1.3);
  const sorted: number[] = [];
  let around = rng() * TWO_PI;
  for (let index = 0; index < lateralCount; index++) {
    if (context.shouldYield()) yield;
    sorted.push(around);
    around += azimuthGaps[index] * TWO_PI;
  }
  let stride = Math.max(1, Math.round(lateralCount * 0.4));
  while (getGreatestCommonDivisor(stride, lateralCount) !== 1) stride++;
  const azimuths = sorted.map((_, index) => sorted[(index * stride) % lateralCount]);
  let widestGap = 0;
  for (let index = 1; index < lateralCount; index++) {
    if (context.shouldYield()) yield;
    if (azimuthGaps[index] > azimuthGaps[widestGap]) widestGap = index;
  }
  const leaderAzimuth = sorted[widestGap] + azimuthGaps[widestGap] * TWO_PI * (0.38 + rng() * 0.24);

  // Stem shape: slow wander, plus a deflection away from each departing scaffold.
  const radius = profile.trunkRatio;
  const wander = profile.stemWander * radius * Math.min(1.6, 0.4 + traits.branchWander * 0.6);
  const waveA = TWO_PI / (0.16 + rng() * 0.1);
  const waveB = TWO_PI / (0.07 + rng() * 0.04);
  const phases = [rng(), rng(), rng(), rng()].map(value => value * TWO_PI);
  const deflection = radius * 0.32;
  // The faint curve of a seedling, which later wood simply swallows.
  const curlWave = TWO_PI / (0.045 + rng() * 0.025);
  const curlPhase = rng() * TWO_PI;
  const curlTurn = rng() * TWO_PI;
  const curl = 0.0016 * (0.55 + 0.45 * Math.min(1.6, traits.branchWander));
  const stemAt = (z: number): [number, number] => {
    const amount = wander * smoothstep(0.015, 0.08, z);
    const curve = curl * smoothstep(0, 0.012, z) * Math.sin(z * curlWave + curlPhase);
    let x = amount * (Math.sin(z * waveA + phases[0]) + 0.45 * Math.sin(z * waveB + phases[1]));
    let y = amount * (Math.sin(z * waveA + phases[2]) + 0.45 * Math.sin(z * waveB + phases[3]));
    x += curve * Math.cos(curlTurn + z * 14);
    y += curve * Math.sin(curlTurn + z * 14);
    for (let index = 0; index < lateralCount; index++) {
      if (z <= socketZ[index]) continue;
      const away = deflection * (1 - Math.exp(-(z - socketZ[index]) / 0.03));
      x -= Math.cos(azimuths[index]) * away;
      y -= Math.sin(azimuths[index]) * away;
    }
    return [x, y];
  };

  // Rings crowd where the shape changes: root flare, bud union and scaffold sockets.
  const heights: number[] = [...socketZ];
  const union = profile.budUnionZ;
  for (let z = 0; z < stemTop; ) {
    if (context.shouldYield()) yield;
    if (socketZ.every(socket => Math.abs(z - socket) > 0.004)) heights.push(z);
    const nearUnion = union > 0 && Math.abs(z - union) < 0.014;
    z += z < 0.014 ? 0.0003 : z < 0.04 ? 0.0014 : nearUnion ? 0.0035 : 0.008;
  }
  heights.sort((a, b) => a - b);

  const plan: ScaffoldPlan[] = [];
  const [narrowest, widest] = profile.scaffoldAngle;
  let previous = -1;
  for (const z of heights) {
    if (context.shouldYield()) yield;
    const [x, y] = stemAt(z);
    previous = addGrowthNode(nodes, previous, x, y, z, getTreeGrowthAtHeight(z), 0);
    const socket = socketZ.indexOf(z);
    if (socket < 0) continue;
    if (socket === lateralCount) {
      const angle = toRadians(profile.leaderAngle);
      plan.push({socket: previous, azimuth: leaderAzimuth, angle, leader: true, domain: 0.72});
    } else {
      const height = socket / Math.max(1, lateralCount - 1);
      const angle = toRadians(lerp(widest, narrowest, height) + (rng() - 0.5) * 14);
      const domain = 0.85 + rng() * 0.45;
      plan.push({socket: previous, azimuth: azimuths[socket], angle, leader: false, domain});
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Attractors
// ---------------------------------------------------------------------------------------------

/** Points with a minimum spacing, for dart throwing through a uniform grid. */
type SpacedPoints = {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  isClear: (px: number, py: number, pz: number) => boolean;
  add: (px: number, py: number, pz: number) => void;
};

function createSpacedPoints(width: number, spacing: number, capacity: number): SpacedPoints {
  const side = Math.ceil((2 * width) / spacing) + 3;
  const levels = Math.ceil(1.1 / spacing) + 3;
  const head = new Int32Array(side * side * levels).fill(-1);
  const link = new Int32Array(capacity);
  const toCell = (value: number) => (value / spacing + 1) | 0;
  const points: SpacedPoints = {
    count: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    isClear: (px, py, pz) => {
      const ix = toCell(px + width);
      const iy = toCell(py + width);
      const iz = toCell(pz);
      for (let cz = iz - 1; cz <= iz + 1; cz++) {
        for (let cy = iy - 1; cy <= iy + 1; cy++) {
          for (let cx = ix - 1; cx <= ix + 1; cx++) {
            let other = head[cx + cy * side + cz * side * side];
            for (; other >= 0; other = link[other]) {
              const dx = points.x[other] - px;
              const dy = points.y[other] - py;
              const dz = points.z[other] - pz;
              if (dx * dx + dy * dy + dz * dz < spacing * spacing) return false;
            }
          }
        }
      }
      return true;
    },
    add: (px, py, pz) => {
      const index = points.count++;
      const cell = toCell(px + width) + toCell(py + width) * side + toCell(pz) * side * side;
      link[index] = head[cell];
      head[cell] = index;
      points.x[index] = px;
      points.y[index] = py;
      points.z[index] = pz;
    }
  };
  return points;
}

type CrownAttractors = {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Growth at which the crown reaches each attractor, ascending. */
  arrival: Float64Array;
};

/**
 * The lowest z shoots reach by a given growth. The crown scales down when young, but a young tree's
 * limbs start well above the ground; the skirt comes down with age.
 */
function getCrownUnderside(profile: TreeGrowthProfile, growth: number): number {
  return lerp(profile.forkZ * 0.8, 0.02, smoothstep(0.3, 0.85, growth));
}

/**
 * Attractors of the mature crown, each activated when the expanding envelope reaches it. Density
 * rises toward the outer shell, falls in the hollow under the skirt, and varies at branch scale so
 * limbs differ. A share lies right under the surface, so tips reach the full silhouette, and a
 * wandering crown axis keeps one tip rising to the top of the envelope.
 */
function* sampleCrownAttractors(
  context: GrowthContext,
  stemTop: number
): Generator<void, CrownAttractors, void> {
  const {profile, traits, envelope} = context;
  const rng = createStream(context.seed, 0x7a11ce);
  const total = Math.round(profile.attractors * traits.branchDensity);
  const surfaceCount = Math.round(total * profile.surfaceFraction);
  const volumeCount = total - surfaceCount;
  const capacity = total + 64;
  const arrival = new Float64Array(capacity);

  const {width, floorZ} = envelope;
  const clumps = Array.from({length: 3}, () => [
    (rng() - 0.5) * 34,
    (rng() - 0.5) * 34,
    (rng() - 0.5) * 34,
    rng() * TWO_PI
  ]);
  // A soft minimum spacing, so attractors are irregular without leaving voids.
  const spacing = 0.42 * Math.cbrt((width * width * Math.PI * (1 - floorZ) * 0.5) / total);
  const reachOut = width * (1 + CROWN_LOBE_PAST + 0.02);
  const placed = createSpacedPoints(reachOut, spacing, capacity);
  const accept = (x: number, y: number, z: number, time: number): void => {
    arrival[placed.count] = time;
    placed.add(x, y, z);
  };

  let attempts = 0;
  // Shell, core and hollow.
  for (let attempt = 0; attempt < total * 200 && placed.count < volumeCount; attempt++) {
    if ((++attempts & 255) === 0 && context.shouldYield()) yield;
    const x = (rng() * 2 - 1) * reachOut;
    const y = (rng() * 2 - 1) * reachOut;
    const z = floorZ + rng() * (1 - floorZ);
    const time = getCrownArrival(envelope, x, y, z);
    if (time >= 1) continue;
    const level = getTreeCrownFraction(time);
    const reach = Math.sqrt(x * x + y * y) / width;
    let density = lerp(1, profile.shellDensity, smoothstep(0.3, 0.85, level));
    const inner = reach / profile.hollowReach;
    if (inner < 1 && z < floorZ + profile.hollowHeight * (1 - inner * inner)) {
      density *= profile.hollowDensity;
    }
    if (z < getCrownUnderside(profile, time)) continue;
    let clump = 1;
    for (const wave of clumps) {
      clump *= 0.5 + 0.5 * Math.sin(wave[0] * x + wave[1] * y + wave[2] * z + wave[3]);
    }
    density *= 0.62 + 2.4 * clump;
    if (rng() <= density && placed.isClear(x, y, z)) accept(x, y, z, time);
  }

  // The surface layer, area weighted through the crown's profile.
  const surfaceEnd = placed.count + surfaceCount;
  for (let attempt = 0; attempt < total * 40 && placed.count < surfaceEnd; attempt++) {
    if ((++attempts & 255) === 0 && context.shouldYield()) yield;
    const azimuth = rng() * TWO_PI;
    const z = floorZ + rng() * (1 - floorZ);
    const relative = getCrownProfile(envelope, z);
    if (rng() > 0.25 + relative) continue;
    const cosine = Math.cos(azimuth) * relative;
    const sine = Math.sin(azimuth) * relative;
    const out =
      getCrownReach(envelope, cosine, sine, getCrownFrameZ(envelope, z)) * (0.93 + rng() * 0.065);
    const x = cosine * width * out;
    const y = sine * width * out;
    const lifted = envelope.widest + (z - envelope.widest) * out;
    const time = getCrownArrival(envelope, x, y, lifted);
    if (time < 1 && placed.isClear(x, y, lifted)) accept(x, y, lifted, time);
  }

  // The crown axis.
  const phaseX = rng() * TWO_PI;
  const phaseY = rng() * TWO_PI;
  const drift = rng() * TWO_PI;
  for (let z = stemTop + 0.05; z < 1 && placed.count < capacity; z += 0.04) {
    if ((++attempts & 255) === 0 && context.shouldYield()) yield;
    const t = (z - stemTop) / (1 - stemTop);
    const swing = width * 0.14 * Math.sin(t * Math.PI);
    const x = swing * (Math.cos(drift) + 0.7 * Math.sin(t * 9 + phaseX));
    const y = swing * (Math.sin(drift) + 0.7 * Math.sin(t * 7 + phaseY));
    const top = Math.min(z, 0.992);
    const time = getCrownArrival(envelope, x, y, top);
    if (time < 1) accept(x, y, top, time);
  }

  const {count} = placed;
  const order = Array.from({length: count}, (_, index) => index).sort(
    (a, b) => arrival[a] - arrival[b]
  );
  const result: CrownAttractors = {
    count,
    x: new Float64Array(count),
    y: new Float64Array(count),
    z: new Float64Array(count),
    arrival: new Float64Array(count)
  };
  order.forEach((source, index) => {
    result.x[index] = placed.x[source];
    result.y[index] = placed.y[source];
    result.z[index] = placed.z[source];
    result.arrival[index] = arrival[source];
  });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Space colonization
// ---------------------------------------------------------------------------------------------

/**
 * Gives every attractor to one scaffold. Plain nearest-node colonization hands the whole upper
 * crown
 * to the scaffold that continues the stem, which makes a central-leader tree. A real crown divides
 * into unequal sectors, one per scaffold, whose borders wander with height. The axis of the crown
 * goes to the steep last scaffold, so one limb keeps reaching the top of the envelope.
 */
function assignCrownDomains(
  context: GrowthContext,
  plan: ScaffoldPlan[],
  attractors: CrownAttractors
): Uint8Array {
  const {envelope} = context;
  const rng = createStream(context.seed, 0xd0a1);
  const owners = new Uint8Array(attractors.count);
  const twist = rng() * TWO_PI;
  const last = plan.length - 1;
  const stemTop = context.nodes.z[plan[last].socket];
  for (let attractor = 0; attractor < attractors.count; attractor++) {
    const ax = attractors.x[attractor];
    const ay = attractors.y[attractor];
    const az = attractors.z[attractor];
    const reach = Math.sqrt(ax * ax + ay * ay) / envelope.width;
    if (az > stemTop && reach < 0.07 + 0.14 * smoothstep(stemTop, 0.7, az)) {
      owners[attractor] = last;
      continue;
    }
    const azimuth = Math.atan2(ay, ax) + 0.45 * Math.sin(az * 5 + twist) + (rng() - 0.5) * 0.35;
    let best = 0;
    let bestGap = Infinity;
    for (let scaffold = 0; scaffold <= last; scaffold++) {
      let gap = azimuth - plan[scaffold].azimuth;
      gap -= TWO_PI * Math.round(gap / TWO_PI);
      const score = Math.abs(gap) / plan[scaffold].domain;
      if (score < bestGap) {
        bestGap = score;
        best = scaffold;
      }
    }
    owners[attractor] = best;
  }
  return owners;
}

/** Growth values of the colonization steps, close enough that the envelope never outruns a tip. */
function createGrowthSchedule(start: number, step: number, width: number): number[] {
  const schedule: number[] = [];
  let growth = start;
  while (growth < LAST_NODE_BIRTH) {
    const rest = 1 - growth;
    const speed = Math.max(1.6 * Math.pow(rest, 0.6), 1.9 * width * Math.pow(rest, 0.9));
    growth = Math.min(LAST_NODE_BIRTH, growth + clamp((0.6 * step) / speed, 0.002, 0.011));
    schedule.push(growth);
  }
  return schedule;
}

/**
 * Grows the limbs from the scaffold plan. It departs from textbook colonization to avoid the look
 * of
 * a straight-branched procedural tree:
 * - Tips carry persistence and low-frequency wander, and kink between flushes.
 * - A tip forks only after a heavy-tailed distance since its last fork, so forks are not evenly
 *   spaced, and both arms deflect instead of one running straight on.
 * - Attractors are perceived in a cone, so scaffolds do not fold back through the crown.
 * - Lateral shoots come only from dormant buds that stay awake for a while, so interior infill is
 *   sparse rather than a brush of spurs.
 */
function* colonizeCrown(
  context: GrowthContext,
  plan: ScaffoldPlan[],
  attractors: CrownAttractors
): Generator<void, void, void> {
  const {profile, traits, envelope, nodes} = context;
  const rng = createStream(context.seed, 0x2c0104);
  const {x, y, z, hx, hy, hz} = nodes;
  // Dense attractors with short internodes must not exhaust the limb budget before the crown
  // closes.
  const crowding = Math.pow(traits.branchDensity, 0.67) / traits.internodeLength;
  const step = profile.step * traits.internodeLength * Math.max(1, crowding / 1.3);
  const influence = Math.max(profile.influence, step * 3);
  const killSquared = profile.kill * profile.kill;
  const crowdSquared = (step * 0.62) ** 2;
  const width = envelope.width;
  // Sinuosity is more than the wander term: stiff limbs persist and turn slowly as well.
  const wanderAmount = profile.wander * traits.branchWander * 0.3;
  const kinkAmount = toRadians(profile.kinkAngle) * traits.branchWander;
  const persistence = profile.persistence * Math.pow(1.6, 1 - traits.branchWander);
  const suppleness = 0.45 + 0.55 * traits.branchWander;
  const nodeLimit = profile.limbBudget + nodes.count;
  const lateralLow = Math.cos(toRadians(70));
  const lateralHigh = Math.cos(toRadians(28));
  const [forkLow, forkHigh] = profile.forkAngle;
  const crownCenterZ = profile.widestZ * 0.6;
  // A limb holds its line between nodes, and changes direction at them.
  const nodeTurnLimits = [90, 11, 14, 18, 22, 28].map(degrees =>
    Math.cos(toRadians(degrees * suppleness))
  );
  const driftLimits = [90, 0.7, 0.9, 1.3, 1.9, 3].map(degrees =>
    Math.cos(toRadians(degrees * suppleness))
  );

  // Shoot state, indexed by shoot; shoot 0 is the stem, which never grows here.
  const tip = new Int32Array(SHOOT_CAPACITY);
  const order = new Uint8Array(SHOOT_CAPACITY);
  const run = new Float64Array(SHOOT_CAPACITY);
  const shootLength = new Float64Array(SHOOT_CAPACITY);
  const sinceFork = new Float64Array(SHOOT_CAPACITY);
  const nextFork = new Float64Array(SHOOT_CAPACITY);
  const sinceKink = new Float64Array(SHOOT_CAPACITY);
  const nextKink = new Float64Array(SHOOT_CAPACITY);
  const sinceBud = new Float64Array(SHOOT_CAPACITY);
  const nextBud = new Float64Array(SHOOT_CAPACITY);
  const phaseA = new Float64Array(SHOOT_CAPACITY);
  const phaseB = new Float64Array(SHOOT_CAPACITY);
  const waveA = new Float64Array(SHOOT_CAPACITY);
  const waveB = new Float64Array(SHOOT_CAPACITY);
  const kinkTurn = new Float64Array(SHOOT_CAPACITY);
  const freeRun = new Float64Array(SHOOT_CAPACITY);
  const courseX = new Float64Array(SHOOT_CAPACITY);
  const courseY = new Float64Array(SHOOT_CAPACITY);
  const courseZ = new Float64Array(SHOOT_CAPACITY);
  const domain = new Int32Array(SHOOT_CAPACITY);
  const referenceX = new Float64Array(SHOOT_CAPACITY);
  const referenceY = new Float64Array(SHOOT_CAPACITY);
  const referenceZ = new Float64Array(SHOOT_CAPACITY);
  let shootCount = 1;

  // A young tree forks closer and steps shorter: its structure is small because it is small.
  let forkScale = 0.5;
  let stepScale = 0.85;
  const drawForkSpacing = (shootOrder: number) =>
    profile.forkSpacing *
    forkScale *
    Math.exp(drawGaussian(rng) * 0.58) *
    Math.max(0.55, 1.2 - shootOrder * 0.13);
  const drawKinkSpacing = (shootOrder: number) =>
    profile.kinkSpacing *
    Math.max(0.5, 1.2 - shootOrder * 0.14) *
    (0.45 - Math.log(1 - rng()) * 0.55);
  const drawBudSpacing = () => profile.budSpacing * forkScale * Math.exp(drawGaussian(rng) * 0.7);

  const addShoot = (
    start: number,
    shootOrder: number,
    shootDomain: number,
    dx: number,
    dy: number,
    dz: number
  ): number => {
    const shoot = shootCount++;
    tip[shoot] = start;
    order[shoot] = shootOrder;
    domain[shoot] = shootDomain;
    courseX[shoot] = dx;
    courseY[shoot] = dy;
    courseZ[shoot] = dz;
    run[shoot] = 0;
    freeRun[shoot] = 0;
    shootLength[shoot] = 0;
    sinceFork[shoot] = 0;
    sinceKink[shoot] = 0;
    sinceBud[shoot] = 0;
    nextFork[shoot] = drawForkSpacing(shootOrder);
    nextKink[shoot] = drawKinkSpacing(shootOrder);
    nextBud[shoot] = drawBudSpacing();
    const wave = profile.wanderWave * (shootOrder <= 1 ? 1 : shootOrder === 2 ? 0.8 : 0.6);
    waveA[shoot] = TWO_PI / (wave * (0.75 + rng() * 0.6));
    waveB[shoot] = TWO_PI / (wave * (0.5 + rng() * 0.4));
    phaseA[shoot] = rng() * TWO_PI;
    phaseB[shoot] = rng() * TWO_PI;
    kinkTurn[shoot] = rng() * TWO_PI;
    const u = rng() * 2 - 1;
    const angle = rng() * TWO_PI;
    const planar = Math.sqrt(1 - u * u);
    referenceX[shoot] = planar * Math.cos(angle);
    referenceY[shoot] = planar * Math.sin(angle);
    referenceZ[shoot] = u;
    return shoot;
  };

  // Uniform grid over the nodes that can grow, rebuilt each step.
  const gridSide = Math.ceil((2 * (width + influence)) / influence) + 1;
  const gridLevels = Math.ceil(1.15 / influence) + 1;
  const head = new Int32Array(gridSide * gridSide * gridLevels);
  const link = new Int32Array(LIMB_CAPACITY);
  const toCell = (value: number) => ((value + width + influence) / influence) | 0;

  // Attraction accumulated per node, this step.
  const sumX = new Float64Array(LIMB_CAPACITY);
  const sumY = new Float64Array(LIMB_CAPACITY);
  const sumZ = new Float64Array(LIMB_CAPACITY);
  const pull = new Int32Array(LIMB_CAPACITY);
  const cone = new Float32Array(LIMB_CAPACITY);
  const assignedHead = new Int32Array(LIMB_CAPACITY);
  const assignedNext = new Int32Array(attractors.count);
  const active = new Int32Array(attractors.count);
  let activeCount = 0;
  let nextAttractor = 0;

  // Dormant buds: the awake ones, how many steps each has been awake, and each node's bud state.
  const budList = new Int32Array(LIMB_CAPACITY);
  const budAge = new Int32Array(LIMB_CAPACITY);
  const budState = new Uint8Array(LIMB_CAPACITY);
  let budCount = 0;
  const wakeBud = (node: number): void => {
    budState[node] = BUD_AWAKE;
    budAge[node] = 0;
    budList[budCount++] = node;
  };

  // All limb wood by cell, so an attractor nothing can reach can wake a bud on old wood.
  const woodHead = new Int32Array(gridSide * gridSide * gridLevels).fill(-1);
  const woodLink = new Int32Array(LIMB_CAPACITY);
  const waiting = new Uint8Array(attractors.count);
  const wakeList = new Int32Array(attractors.count);

  const insertEligible = (node: number): void => {
    const cell =
      toCell(x[node]) +
      toCell(y[node]) * gridSide +
      ((Math.max(0, z[node]) / influence) | 0) * gridSide * gridSide;
    link[node] = head[cell];
    head[cell] = node;
    sumX[node] = 0;
    sumY[node] = 0;
    sumZ[node] = 0;
    pull[node] = 0;
    assignedHead[node] = -1;
  };

  const isCrowded = (px: number, py: number, pz: number, ignore: number): boolean => {
    const cx = toCell(px);
    const cy = toCell(py);
    const cz = (pz / influence) | 0;
    for (let iz = Math.max(0, cz - 1); iz <= Math.min(gridLevels - 1, cz + 1); iz++) {
      for (let iy = Math.max(0, cy - 1); iy <= Math.min(gridSide - 1, cy + 1); iy++) {
        for (let ix = Math.max(0, cx - 1); ix <= Math.min(gridSide - 1, cx + 1); ix++) {
          let node = head[ix + iy * gridSide + iz * gridSide * gridSide];
          for (; node >= 0; node = link[node]) {
            if (node === ignore) continue;
            const dx = px - x[node];
            const dy = py - y[node];
            const dz = pz - z[node];
            if (dx * dx + dy * dy + dz * dz < crowdSquared) return true;
          }
        }
      }
    }
    return false;
  };

  /** Lays one node from the shoot's tip along a unit heading. Returns it, or -1 if blocked. */
  const extend = (
    shoot: number,
    dx: number,
    dy: number,
    dz: number,
    length: number,
    growth: number,
    height: number,
    crown: number
  ): number => {
    if (nodes.count >= nodeLimit) return -1;
    const parent = tip[shoot];
    length *= stepScale;
    const px = x[parent] + dx * length;
    const py = y[parent] + dy * length;
    const pz = z[parent] + dz * length;
    if (pz < envelope.floorZ * 0.72) return -1;
    if (getCrownFill(envelope, px, py, pz, height, crown) > 1) return -1;
    if (isCrowded(px, py, pz, parent)) return -1;
    const node = addGrowthNode(nodes, parent, px, py, pz, growth, shoot);
    hx[node] = dx;
    hy[node] = dy;
    hz[node] = dz;
    tip[shoot] = node;
    shootLength[shoot] += length;
    sinceFork[shoot] += length;
    sinceKink[shoot] += length;
    sinceBud[shoot] += length;
    const cell =
      toCell(px) +
      toCell(py) * gridSide +
      ((Math.max(0, pz) / influence) | 0) * gridSide * gridSide;
    woodLink[node] = woodHead[cell];
    woodHead[cell] = node;
    if (sinceBud[shoot] >= nextBud[shoot] && order[shoot] < 7) {
      sinceBud[shoot] = 0;
      nextBud[shoot] = drawBudSpacing();
      wakeBud(node);
    }
    return node;
  };

  // Heading output of `steer`.
  let steerX = 0;
  let steerY = 0;
  let steerZ = 0;
  /**
   * The next step of a shoot. Persistence, attraction and tropisms turn the shoot's course, and
   * kinks
   * jump it. Wander only deflects the step from the course, so limbs are sinuous without looping.
   * Returns whether the shoot kinked.
   */
  const steer = (
    shoot: number,
    attractX: number,
    attractY: number,
    attractZ: number,
    attractWeight: number,
    fill: number
  ): boolean => {
    // Young wood rises; wood reaching the crown's surface arches over.
    const edge = smoothstep(0.72, 1, fill);
    const arch = order[shoot] <= 1 ? 0.55 : 1;
    let nx = courseX[shoot] * persistence + attractX * attractWeight;
    let ny = courseY[shoot] * persistence + attractY * attractWeight;
    let nz = courseZ[shoot] * persistence + attractZ * attractWeight;
    nz += profile.lift * traits.branchLift * (1 - edge);
    nz -= profile.droop * traits.twigDroop * edge * arch;
    // Light: everything leans away from the crown's center.
    const node = tip[shoot];
    const lightX = x[node];
    const lightY = y[node];
    const lightZ = z[node] - crownCenterZ;
    const lightLength = Math.sqrt(lightX * lightX + lightY * lightY + lightZ * lightZ) || 1;
    nx += (lightX / lightLength) * profile.light;
    ny += (lightY / lightLength) * profile.light;
    nz += (lightZ / lightLength) * profile.light;
    let length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    // Thick wood cannot hook: attractors out to the side go to side shoots instead. Between nodes a
    // shoot all but holds its line, so a limb is a run of straight internodes, not a bent tube.
    const isNode = sinceKink[shoot] >= nextKink[shoot];
    const limits = isNode ? nodeTurnLimits : driftLimits;
    const turnLimit = limits[Math.min(order[shoot], limits.length - 1)];
    const turnCos = nx * courseX[shoot] + ny * courseY[shoot] + nz * courseZ[shoot];
    if (turnCos < turnLimit) {
      const sideX = nx - courseX[shoot] * turnCos;
      const sideY = ny - courseY[shoot] * turnCos;
      const sideZ = nz - courseZ[shoot] * turnCos;
      const sideLength = Math.sqrt(sideX * sideX + sideY * sideY + sideZ * sideZ) || 1;
      const limitSine = Math.sqrt(1 - turnLimit * turnLimit);
      nx = courseX[shoot] * turnLimit + (sideX / sideLength) * limitSine;
      ny = courseY[shoot] * turnLimit + (sideY / sideLength) * limitSine;
      nz = courseZ[shoot] * turnLimit + (sideZ / sideLength) * limitSine;
    }

    // The wander plane is perpendicular to the course, from a per-shoot reference.
    let ux = ny * referenceZ[shoot] - nz * referenceY[shoot];
    let uy = nz * referenceX[shoot] - nx * referenceZ[shoot];
    let uz = nx * referenceY[shoot] - ny * referenceX[shoot];
    const uLength = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= uLength;
    uy /= uLength;
    uz /= uLength;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    let kinked = false;
    if (isNode) {
      // Rotate about an axis that swings round by a half turn or so each flush: a zig-zag.
      sinceKink[shoot] = 0;
      nextKink[shoot] = drawKinkSpacing(order[shoot]);
      kinkTurn[shoot] += Math.PI + (rng() - 0.5) * 2;
      const angle = kinkAmount * (0.45 + rng() * 0.55);
      const turnCosine = Math.cos(kinkTurn[shoot]);
      const turnSine = Math.sin(kinkTurn[shoot]);
      const axisX = ux * turnCosine + vx * turnSine;
      const axisY = uy * turnCosine + vy * turnSine;
      const axisZ = uz * turnCosine + vz * turnSine;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const cx = axisY * nz - axisZ * ny;
      const cy = axisZ * nx - axisX * nz;
      const cz = axisX * ny - axisY * nx;
      nx = nx * cosine + cx * sine;
      ny = ny * cosine + cy * sine;
      nz = nz * cosine + cz * sine;
      kinked = true;
    }
    courseX[shoot] = nx;
    courseY[shoot] = ny;
    courseZ[shoot] = nz;

    const a = Math.sin(shootLength[shoot] * waveA[shoot] + phaseA[shoot]);
    const b = Math.sin(shootLength[shoot] * waveB[shoot] + phaseB[shoot]) * 0.6;
    const supple = order[shoot] <= 2 ? 1 : order[shoot] === 3 ? 1.8 : 2.8;
    nx += (ux * a + vx * b) * wanderAmount * supple;
    ny += (uy * a + vy * b) * wanderAmount * supple;
    nz += (uz * a + vz * b) * wanderAmount * supple;
    length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    steerX = nx / length;
    steerY = ny / length;
    steerZ = nz / length;
    return kinked;
  };

  /**
   * Forks a tip whose fork distance is spent, if its attractors spread or it is long overdue. Both
   * arms leave the bisector of the old heading and the attractor mean, the lesser one further.
   */
  const tryFork = (
    shoot: number,
    node: number,
    mx: number,
    my: number,
    mz: number,
    growth: number,
    height: number,
    crown: number
  ): boolean => {
    // The attractor furthest from the mean decides the fork plane.
    let farCosine = 1;
    let fx = 0;
    let fy = 0;
    let fz = 0;
    for (let a = assignedHead[node]; a >= 0; a = assignedNext[a]) {
      const dx = attractors.x[a] - x[node];
      const dy = attractors.y[a] - y[node];
      const dz = attractors.z[a] - z[node];
      const inverse = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1);
      const cosine = (dx * mx + dy * my + dz * mz) * inverse;
      if (cosine < farCosine) {
        farCosine = cosine;
        fx = dx * inverse - mx * cosine;
        fy = dy * inverse - my * cosine;
        fz = dz * inverse - mz * cosine;
      }
    }
    const spreads = farCosine < 0.93 && pull[node] >= 2;
    if (!spreads && sinceFork[shoot] < nextFork[shoot] * 1.25) return false;

    let bisectorX = courseX[shoot] * 1.2 + mx;
    let bisectorY = courseY[shoot] * 1.2 + my;
    let bisectorZ = courseZ[shoot] * 1.2 + mz;
    const bisectorLength =
      Math.sqrt(bisectorX * bisectorX + bisectorY * bisectorY + bisectorZ * bisectorZ) || 1;
    bisectorX /= bisectorLength;
    bisectorY /= bisectorLength;
    bisectorZ /= bisectorLength;

    // The side the lesser arm opens toward.
    const along = fx * bisectorX + fy * bisectorY + fz * bisectorZ;
    let sideX = fx - bisectorX * along;
    let sideY = fy - bisectorY * along;
    let sideZ = fz - bisectorZ * along;
    let sideLength = Math.sqrt(sideX * sideX + sideY * sideY + sideZ * sideZ);
    if (!spreads || sideLength < 1e-4) {
      setSideDirection(bisectorX, bisectorY, bisectorZ, rng() * TWO_PI);
      sideX = SIDE[0];
      sideY = SIDE[1];
      sideZ = SIDE[2];
      sideLength = 1;
    }
    sideX /= sideLength;
    sideY /= sideLength;
    sideZ /= sideLength;

    const opening = toRadians(lerp(forkLow, forkHigh, rng()));
    const lesserAngle = opening * (0.55 + rng() * 0.2);
    const mainAngle = (opening - lesserAngle) * Math.min(1, suppleness);
    const mainCosine = Math.cos(mainAngle);
    const mainSine = Math.sin(mainAngle);
    const mainX = bisectorX * mainCosine - sideX * mainSine;
    const mainY = bisectorY * mainCosine - sideY * mainSine;
    const mainZ = bisectorZ * mainCosine - sideZ * mainSine;
    const placedMain = extend(shoot, mainX, mainY, mainZ, step, growth, height, crown);
    if (placedMain < 0) return false;
    nodes.kink[node] = 1;
    courseX[shoot] = mainX;
    courseY[shoot] = mainY;
    courseZ[shoot] = mainZ;
    sinceFork[shoot] = 0;
    nextFork[shoot] = drawForkSpacing(order[shoot]);
    sinceKink[shoot] = 0;
    if (shootCount >= SHOOT_CAPACITY) return true;
    const lesserCosine = Math.cos(lesserAngle);
    const lesserSine = Math.sin(lesserAngle);
    const lesserX = bisectorX * lesserCosine + sideX * lesserSine;
    const lesserY = bisectorY * lesserCosine + sideY * lesserSine;
    const lesserZ = bisectorZ * lesserCosine + sideZ * lesserSine;
    const lesser = addShoot(node, order[shoot] + 1, domain[shoot], lesserX, lesserY, lesserZ);
    const placedLesser = extend(
      lesser,
      lesserX,
      lesserY,
      lesserZ,
      step * (0.7 + rng() * 0.3),
      growth,
      height,
      crown
    );
    // No room for the second arm: forget the shoot before it draws any wood.
    if (placedLesser < 0) shootCount--;
    return true;
  };

  const owners = assignCrownDomains(context, plan, attractors);
  /** The nearest unused limb node in the attractor's domain that is not a tip. */
  const findNearestWood = (attractor: number): number => {
    const ax = attractors.x[attractor];
    const ay = attractors.y[attractor];
    const az = attractors.z[attractor];
    const cx = toCell(ax);
    const cy = toCell(ay);
    const cz = (az / influence) | 0;
    let best = -1;
    let bestSquared = influence * influence;
    for (let iz = Math.max(0, cz - 1); iz <= Math.min(gridLevels - 1, cz + 1); iz++) {
      for (let iy = Math.max(0, cy - 1); iy <= Math.min(gridSide - 1, cy + 1); iy++) {
        for (let ix = Math.max(0, cx - 1); ix <= Math.min(gridSide - 1, cx + 1); ix++) {
          let node = woodHead[ix + iy * gridSide + iz * gridSide * gridSide];
          for (; node >= 0; node = woodLink[node]) {
            if (budState[node] !== 0 || node === tip[nodes.shoot[node]]) continue;
            if (domain[nodes.shoot[node]] !== owners[attractor]) continue;
            const dx = ax - x[node];
            const dy = ay - y[node];
            const dz = az - z[node];
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared < bestSquared) {
              bestSquared = squared;
              best = node;
            }
          }
        }
      }
    }
    return best;
  };

  const schedule = createGrowthSchedule(nodes.birth[plan[0].socket], step, width);
  let planIndex = 0;

  for (let stepIndex = 0; stepIndex < schedule.length; stepIndex++) {
    if (context.shouldYield()) yield;
    const growth = schedule[stepIndex];
    const height = getTreeHeightFraction(growth);
    const crown = getTreeCrownFraction(growth);
    forkScale = lerp(0.45, 1, crown);
    stepScale = lerp(0.85, 1.5, crown);

    // Wake scaffolds whose sockets the stem has reached. The socket holds the departure heading.
    while (planIndex < plan.length && nodes.birth[plan[planIndex].socket] <= growth) {
      const scaffold = plan[planIndex];
      const socket = scaffold.socket;
      const sine = Math.sin(scaffold.angle);
      hx[socket] = Math.cos(scaffold.azimuth) * sine;
      hy[socket] = Math.sin(scaffold.azimuth) * sine;
      hz[socket] = Math.cos(scaffold.angle);
      const shoot = addShoot(socket, 1, planIndex, hx[socket], hy[socket], hz[socket]);
      run[shoot] = profile.scaffoldRun * (0.75 + rng() * 0.5);
      nextFork[shoot] = profile.forkFirst * (0.7 + rng() * 0.7);
      planIndex++;
    }
    while (nextAttractor < attractors.count && attractors.arrival[nextAttractor] <= growth) {
      active[activeCount++] = nextAttractor++;
    }

    // Every tip and each awake bud can grow.
    head.fill(-1);
    for (let shoot = 1; shoot < shootCount; shoot++) {
      insertEligible(tip[shoot]);
      cone[tip[shoot]] = TIP_CONE;
    }
    let eligibleBudCount = 0;
    for (let index = 0; index < budCount; index++) {
      const node = budList[index];
      if (budState[node] !== BUD_AWAKE) continue;
      if (budAge[node]++ > 22) {
        budState[node] = BUD_SPENT;
        continue;
      }
      budList[eligibleBudCount++] = node;
      if (node !== tip[nodes.shoot[node]]) {
        insertEligible(node);
        cone[node] = BUD_CONE;
      }
    }
    budCount = eligibleBudCount;

    // Each attractor pulls its nearest eligible node, or dies if one has reached it.
    let activeWrite = 0;
    let wakeCount = 0;
    for (let index = 0; index < activeCount; index++) {
      const attractor = active[index];
      const ax = attractors.x[attractor];
      const ay = attractors.y[attractor];
      const az = attractors.z[attractor];
      const cx = toCell(ax);
      const cy = toCell(ay);
      const cz = (az / influence) | 0;
      const owner = owners[attractor];
      let best = -1;
      let bestSquared = influence * influence;
      let killed = false;
      for (let iz = Math.max(0, cz - 1); iz <= Math.min(gridLevels - 1, cz + 1) && !killed; iz++) {
        for (let iy = Math.max(0, cy - 1); iy <= Math.min(gridSide - 1, cy + 1) && !killed; iy++) {
          for (let ix = Math.max(0, cx - 1); ix <= Math.min(gridSide - 1, cx + 1); ix++) {
            let node = head[ix + iy * gridSide + iz * gridSide * gridSide];
            for (; node >= 0; node = link[node]) {
              const dx = ax - x[node];
              const dy = ay - y[node];
              const dz = az - z[node];
              const squared = dx * dx + dy * dy + dz * dz;
              if (squared < killSquared) {
                killed = true;
                break;
              }
              if (
                squared < bestSquared &&
                domain[nodes.shoot[node]] === owner &&
                dx * hx[node] + dy * hy[node] + dz * hz[node] >= cone[node] * Math.sqrt(squared)
              ) {
                bestSquared = squared;
                best = node;
              }
            }
            if (killed) break;
          }
        }
      }
      if (killed) continue;
      if (best < 0) {
        // Nothing can grow toward it: after a while, wake a bud on old wood; later, give up.
        waiting[attractor]++;
        if (waiting[attractor] === ATTRACTOR_PATIENCE) wakeList[wakeCount++] = attractor;
        if (waiting[attractor] < ATTRACTOR_PATIENCE * 3) active[activeWrite++] = attractor;
        continue;
      }
      active[activeWrite++] = attractor;
      waiting[attractor] = 0;
      // Attractors ahead steer a tip; those off to the side barely do, so tips do not orbit them.
      const inverse = 1 / Math.sqrt(bestSquared);
      const dirX = (ax - x[best]) * inverse;
      const dirY = (ay - y[best]) * inverse;
      const dirZ = (az - z[best]) * inverse;
      const ahead = Math.max(0.15, dirX * hx[best] + dirY * hy[best] + dirZ * hz[best]);
      const weight = ahead * ahead;
      sumX[best] += dirX * weight;
      sumY[best] += dirY * weight;
      sumZ[best] += dirZ * weight;
      pull[best]++;
      assignedNext[attractor] = assignedHead[best];
      assignedHead[best] = attractor;
    }
    activeCount = activeWrite;

    for (let index = 0; index < wakeCount; index++) {
      const attractor = wakeList[index];
      const bud = findNearestWood(attractor);
      if (bud >= 0) wakeBud(bud);
    }

    // Tips extend or fork.
    const shootsBefore = shootCount;
    for (let shoot = 1; shoot < shootsBefore; shoot++) {
      const node = tip[shoot];
      const fill = getCrownFill(envelope, x[node], y[node], z[node], height, crown);
      if (run[shoot] > 0) {
        // A young scaffold keeps its authored departure before attractors steer it.
        const kinked = steer(shoot, 0, 0, 0, 0, fill);
        const placed = extend(shoot, steerX, steerY, steerZ, step, growth, height, crown);
        if (placed >= 0) {
          run[shoot] -= step;
          if (kinked) nodes.kink[node] = 1;
        }
        continue;
      }
      let mx = sumX[node];
      let my = sumY[node];
      let mz = sumZ[node];
      const mean = Math.sqrt(mx * mx + my * my + mz * mz);
      if (pull[node] > 0 && mean > 1e-6) {
        mx /= mean;
        my /= mean;
        mz /= mean;
        freeRun[shoot] = 0;
      } else {
        // A shoot elongates for a while on its own, within a flush, even with nothing to reach.
        freeRun[shoot] += step;
        if (freeRun[shoot] > profile.freeGrowth) continue;
        mx = courseX[shoot];
        my = courseY[shoot];
        mz = courseZ[shoot];
      }
      if (
        sinceFork[shoot] >= nextFork[shoot] &&
        order[shoot] < 7 &&
        tryFork(shoot, node, mx, my, mz, growth, height, crown)
      ) {
        continue;
      }
      const kinked = steer(shoot, mx, my, mz, profile.attraction, fill);
      const placed = extend(shoot, steerX, steerY, steerZ, step, growth, height, crown);
      if (placed >= 0 && kinked) nodes.kink[node] = 1;
    }

    // Buds that woke during this step need a new attraction assignment before branching.
    for (let index = 0; index < eligibleBudCount; index++) {
      const node = budList[index];
      if (pull[node] === 0 || node === tip[nodes.shoot[node]]) continue;
      if (shootCount >= SHOOT_CAPACITY) break;
      const mean = Math.sqrt(sumX[node] ** 2 + sumY[node] ** 2 + sumZ[node] ** 2) || 1;
      let dx = sumX[node] / mean;
      let dy = sumY[node] / mean;
      let dz = sumZ[node] / mean;
      // Keep the crotch between a tight fork and a wide lateral.
      const cosine = dx * hx[node] + dy * hy[node] + dz * hz[node];
      if (cosine > lateralHigh || cosine < lateralLow) {
        const sideX = dx - hx[node] * cosine;
        const sideY = dy - hy[node] * cosine;
        const sideZ = dz - hz[node] * cosine;
        const length = Math.sqrt(sideX * sideX + sideY * sideY + sideZ * sideZ);
        if (length > 1e-4) {
          SIDE[0] = sideX / length;
          SIDE[1] = sideY / length;
          SIDE[2] = sideZ / length;
        } else {
          setSideDirection(hx[node], hy[node], hz[node], rng() * TWO_PI);
        }
        const angle = toRadians(cosine > lateralHigh ? 28 + rng() * 12 : 70);
        dx = hx[node] * Math.cos(angle) + SIDE[0] * Math.sin(angle);
        dy = hy[node] * Math.cos(angle) + SIDE[1] * Math.sin(angle);
        dz = hz[node] * Math.cos(angle) + SIDE[2] * Math.sin(angle);
      }
      const parentShoot = nodes.shoot[node];
      const shoot = addShoot(node, order[parentShoot] + 1, domain[parentShoot], dx, dy, dz);
      if (extend(shoot, dx, dy, dz, step, growth, height, crown) < 0) shootCount--;
      else budState[node] = BUD_SPENT;
    }
  }
  smoothLimbs(nodes);
}

/** Rounds the node-scale jitter of attractor hopping off the limbs, keeping kinks sharper. */
function smoothLimbs(nodes: GrowthNodes): void {
  const {count, x, y, z, parent, next, kink, shoot} = nodes;
  const nextX = new Float64Array(count);
  const nextY = new Float64Array(count);
  const nextZ = new Float64Array(count);
  for (let pass = 0; pass < 2; pass++) {
    for (let node = 0; node < count; node++) {
      const after = next[node];
      const before = parent[node];
      if (shoot[node] === 0 || after < 0 || before < 0) {
        nextX[node] = x[node];
        nextY[node] = y[node];
        nextZ[node] = z[node];
        continue;
      }
      const weight = kink[node] ? 0.04 : 0.34;
      nextX[node] = x[node] + weight * ((x[before] + x[after]) / 2 - x[node]);
      nextY[node] = y[node] + weight * ((y[before] + y[after]) / 2 - y[node]);
      nextZ[node] = z[node] + weight * ((z[before] + z[after]) / 2 - z[node]);
    }
    x.set(nextX);
    y.set(nextY);
    z.set(nextZ);
  }
}

/**
 * Grow the stem, scaffolds and colonized crown of one species and seed.
 * The optional callback allows a caller to yield between bounded units of work.
 */
export function* growTreeSkeleton(
  species: TreeGrowthSpecies,
  characteristics?: TreeGrowthTraits,
  shouldYield: () => boolean = () => false
): Generator<void, GrowthContext, void> {
  const traits = resolveTreeGrowthTraits(characteristics);
  const profile = PROFILES[species];
  const typeSeed = species
    .split('')
    .reduce((seed, letter) => Math.imul(seed, 31) + letter.charCodeAt(0), 137);
  const seed = (typeSeed + Math.imul(traits.seed, 0x9e3779b1)) >>> 0;
  const envelope = createCrownEnvelope(profile, traits);
  const shoots = Math.ceil(profile.flushShoots * Math.sqrt(traits.branchDensity));
  const nodes = createGrowthNodes(profile.limbBudget + 256 + shoots * 5);
  const forkZ = Math.max(profile.forkZ, envelope.floorZ - profile.socketSpan * 0.8);
  const arrivals = yield* createArrivalTable(envelope, shouldYield);
  const context: GrowthContext = {
    profile,
    traits,
    shouldYield,
    seed,
    envelope,
    nodes,
    forkZ,
    colonized: 0,
    arrivals
  };

  const plan = yield* layStem(context);
  yield* shapeCrownReach(context, plan, createStream(seed, 0x3e11));
  const attractors = yield* sampleCrownAttractors(context, nodes.z[nodes.count - 1]);
  yield* colonizeCrown(context, plan, attractors);
  for (let node = 0; node < nodes.count; node++) {
    nodes.level[node] = getTreeCrownFraction(
      lookUpArrival(envelope, arrivals, nodes.x[node], nodes.y[node], nodes.z[node])
    );
  }
  context.colonized = nodes.count;
  return context;
}
