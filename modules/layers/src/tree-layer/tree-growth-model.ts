// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The botanical growth model behind TreeLayer's `quality: 'photoreal'`.
 *
 * A tree is grown once per template, as a time-stepped space colonization (Runions et al., 2007)
 * inside a crown envelope that expands with `getTreeHeightFraction` and `getTreeCrownFraction`.
 * Everything that exists at growth g was laid down by shoot tips before g and never moves
 * afterwards,
 * so the wood and leaves at any growth value form a small complete tree, not the first part of a
 * mature skeleton. The vertex stage only compares `g` with the births stored here.
 *
 * All structure is authored in a design space that is isotropic in metres, normalized so the mature
 * tree is 1 tall: x and y span crown radius over height. Shoots turn, fork and droop there, and
 * positions convert to template space only when written. Directions (ring radials, leaf frames)
 * stay
 * physical, because the vertex stage applies them after `treeTemplateToMetres`.
 */

import {
  getTreeCharacteristicsKey,
  resolveTreeCharacteristics,
  TreeTemplateCache,
  type ResolvedTreeCharacteristics,
  type TreeCharacteristics
} from './tree-characteristics';
import {createTreeRng} from './tree-geometry';
import type {TreeType} from './tree-layer';
import {
  getTreeCrownFraction,
  getTreeGrowthAtCrown,
  getTreeGrowthAtHeight,
  getTreeHeightFraction,
  getTreeRingRadius,
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  TREE_WOOD_FLAG,
  type TreeGrowthModel,
  type TreeGrowthWood
} from './tree-photoreal-layout';

/** Broadleaf species with a growth model. Pine and palm keep their specialized skeletons. */
export type TreeGrowthSpecies = 'oak' | 'birch' | 'cherry' | 'banyan' | 'mangrove' | 'citrus';

/**
 * Template z of a citrus tree's bud union, the graft line between rootstock and scion. The swelling
 * is part of the trunk's rings. Trunk bark v starts at 0 on the ground and follows the stem, so a
 * bark shader can draw the line at about this bark v.
 */
export const TREE_CITRUS_BUD_UNION_Z = 0.042;

/**
 * Radius of the plate of soil and roots a falling tree tears out of the ground, in radii of its trunk: about 2 m
 * across under a citrus of 19 years, a wide, shallow disc, as trees that come down in a storm have on a wet,
 * sandy bed. A tree tips over on its rim, so its lean turns about a point this far out.
 */
export const TREE_ROOT_PLATE_RADII = 11;
/** How thick that plate is under the trunk, in radii of the trunk: about a third of a metre there. */
export const TREE_ROOT_PLATE_THICKNESS = 3.9;

/**
 * Lengths a short broken root runs in, kinking where it grew round something in the soil: as many rings as it had
 * straight, so that the wood's levels of detail, which share out its rings, are what they were.
 */
const STUB_KINKS = 2;
/** Broken roots that stand out of the rim of the plate of soil, all round it. */
const RIM_STUBS = 44;

/** Exponent of the pipe model, `r^2.4 = sum(child r^2.4)`. */
const PIPE_EXPONENT = 2.4;
/** Smallest step between two births on one shoot, so the vertex stage never divides by zero. */
const BIRTH_EPSILON = 2e-5;
/** Latest birth of a skeleton node. Rings have room above it to stay strictly increasing. */
const LAST_NODE_BIRTH = 0.9985;
/** Latest ring birth. `1 - birth` divides radial growth, so every ring is born before 1. */
const LAST_RING_BIRTH = 0.9996;
/** Birth of a stem's or soil plate's first ring; its virtual predecessor is born at 0. */
const FIRST_RING_BIRTH = 1e-4;
/** Crown radii the crown must grow past a leaf before the leaf dies. */
const LEAF_DEATH_MARGIN = 0.5;
/** Crop anchors per template. */
const CROP_ANCHOR_COUNT = 3000;
/** Capacity of the limb nodes and shoot table while colonizing; profiles stay well below them. */
const LIMB_CAPACITY = 12000;
const SHOOT_CAPACITY = 6000;
/** Resolution of the arrival table: rows by height, columns by reach. */
const ARRIVAL_ROWS = 128;
const ARRIVAL_COLUMNS = 96;
/**
 * Flush shoots by depth: the crown fractions a tier spans and its share of the shoots. A crown has
 * shoots
 * for its surface, which grows as the square of its size, and some more as it sheds those within,
 * so it is
 * closed at any age, and not only when it is mature. A young tree is made of the inner tiers, whose
 * leaves
 * die as the crown outgrows them, and limbs alone clothe a whip, so no tier reaches the crown's
 * middle.
 */
const FLUSH_TIERS: readonly (readonly [number, number, number])[] = [
  [0.96, 1, 0.13],
  [0.88, 0.96, 0.18],
  [0.7, 0.88, 0.26],
  [0.5, 0.7, 0.18],
  [0.38, 0.5, 0.16],
  [0.24, 0.38, 0.09]
];
/** Flush shoots in a spray, about. Their leaves clump together, with dark gaps between sprays. */
const FLUSH_SPRAY = 5;
/** Least mature radius of a shoot that blends into its parent through a collar. */
const COLLAR_MINIMUM = 0.04;
/** The growth at which the first collars appear. */
const COLLAR_FIRST_BIRTH = 0.22;
/** Side of the grid of `CrownEnvelope.reach`, and the lobes of about 1 to 2 m on a crown's surface. */
const CROWN_REACH_GRID = 64;
const CROWN_LOBES = 70;
/** How far the strongest lobes pass the crown's radius, as a fraction of it. */
const CROWN_LOBE_PAST = 0.1;
/** Sprays with a shoot that stands proud of the crown's surface, as a fraction of them. */
const PROUD_SHOOTS = 0.05;
/** Floats per vertex of a shaped ring: radial xyz, width, bark u and v, shade, center's offset xyz. */
const SHAPED_STRIDE = 10;
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
const GOLDEN_RATIO = 0.61803398875;
const TWO_PI = Math.PI * 2;

/** Everything `getTreeGrowthModel` varies between species. Lengths are in mature tree heights. */
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

const CACHE = new TreeTemplateCache<TreeGrowthModel>(12);

/** Whether `type` has a growth model. Pine and palm do not; they stay on the standard pipeline. */
export function isTreeGrowthSpecies(type: string): type is TreeGrowthSpecies {
  return Object.prototype.hasOwnProperty.call(PROFILES, type);
}

/**
 * The shared, immutable growth template of one species and characteristics combination. Pure and
 * deterministic: one seed always gives the same tree. Results are memoized in an LRU cache, because
 * a
 * template takes up to a few hundred milliseconds to grow.
 *
 * Details of the `TreeGrowthModel` contract:
 * - `wood.bark` v is measured in mature tree heights along the shoot, continuing the parent's v at
 *   the socket, so `v * height` is metres of bark.
 * - Ring radials and leaf frames are physical directions, applied after `treeTemplateToMetres`.
 * - Soil plate vertices keep `center + radial * radius` as their position, but the radial is not
 *   their surface normal.
 * - Tubes flagged `TREE_WOOD_FLAG.COLLAR` have a center, radial and bark of their own at each
 * vertex.
 * - Wood occlusion and leaf `shell` describe the mature tree. A young tree's outer wood and leaves
 * are
 *   not really shaded, so `shade` should fade in with growth.
 *
 * @throws If `type` has no growth model. Check with `isTreeGrowthSpecies`.
 */
export function getTreeGrowthModel(
  type: TreeType,
  characteristics?: TreeCharacteristics
): TreeGrowthModel {
  if (!isTreeGrowthSpecies(type)) {
    throw new Error(`TreeLayer: species '${type}' has no photoreal growth model.`);
  }
  const traits = resolveTreeCharacteristics(characteristics);
  const key = `${type}-${getTreeCharacteristicsKey(traits)}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const model = growTreeModel(key, type, traits);
  CACHE.set(key, model);
  return model;
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function fract(value: number): number {
  return value - Math.floor(value);
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
function createArrivalTable(envelope: CrownEnvelope): Float32Array {
  const tables = getGrowthTables();
  const table = new Float32Array((ARRIVAL_ROWS + 1) * (ARRIVAL_COLUMNS + 1));
  for (let row = 0; row <= ARRIVAL_ROWS; row++) {
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
function shapeCrownReach(context: GrowthContext, plan: ScaffoldPlan[], rng: () => number): void {
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
    const value = reach[at] / level;
    reach[at] =
      value > 1 ? 1 + CROWN_LOBE_PAST * (1 - Math.exp(-(value - 1) / CROWN_LOBE_PAST)) : value;
  }
  envelope.reach = reach;
  const crownTop = getCrownReach(envelope, 0, 0, 1);
  for (let row = 0; row <= size; row++) {
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
  traits: ResolvedTreeCharacteristics;
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
function layStem(context: GrowthContext): ScaffoldPlan[] {
  const {profile, traits, nodes} = context;
  const rng = createStream(context.seed, 0x51ed27);
  const [fewest, most] = profile.scaffolds;
  const scaffoldCount = fewest + Math.floor(rng() * (most - fewest + 1));
  const lateralCount = scaffoldCount - 1;

  const heightGaps = drawUnequalGaps(rng, lateralCount, 1.45);
  const socketZ: number[] = [context.forkZ];
  for (let index = 0; index < lateralCount; index++) {
    socketZ.push(socketZ[index] + heightGaps[index] * profile.socketSpan);
  }
  const stemTop = socketZ[lateralCount];

  // Unequal azimuth gaps, with consecutive sockets far apart, as around a real stem.
  const azimuthGaps = drawUnequalGaps(rng, lateralCount, 1.3);
  const sorted: number[] = [];
  let around = rng() * TWO_PI;
  for (let index = 0; index < lateralCount; index++) {
    sorted.push(around);
    around += azimuthGaps[index] * TWO_PI;
  }
  let stride = Math.max(1, Math.round(lateralCount * 0.4));
  while (getGreatestCommonDivisor(stride, lateralCount) !== 1) stride++;
  const azimuths = sorted.map((_, index) => sorted[(index * stride) % lateralCount]);
  let widestGap = 0;
  for (let index = 1; index < lateralCount; index++) {
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
    if (socketZ.every(socket => Math.abs(z - socket) > 0.004)) heights.push(z);
    const nearUnion = union > 0 && Math.abs(z - union) < 0.014;
    z += z < 0.014 ? 0.0003 : z < 0.04 ? 0.0014 : nearUnion ? 0.0035 : 0.008;
  }
  heights.sort((a, b) => a - b);

  const plan: ScaffoldPlan[] = [];
  const [narrowest, widest] = profile.scaffoldAngle;
  let previous = -1;
  for (const z of heights) {
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
function sampleCrownAttractors(context: GrowthContext, stemTop: number): CrownAttractors {
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

  // Shell, core and hollow.
  for (let attempt = 0; attempt < total * 200 && placed.count < volumeCount; attempt++) {
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
function colonizeCrown(
  context: GrowthContext,
  plan: ScaffoldPlan[],
  attractors: CrownAttractors
): void {
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
    let budWrite = 0;
    for (let index = 0; index < budCount; index++) {
      const node = budList[index];
      if (budState[node] !== BUD_AWAKE) continue;
      if (budAge[node]++ > 22) {
        budState[node] = BUD_SPENT;
        continue;
      }
      budList[budWrite++] = node;
      if (node !== tip[nodes.shoot[node]]) {
        insertEligible(node);
        cone[node] = BUD_CONE;
      }
    }
    budCount = budWrite;

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

    // Awake buds with attractors nearby break into lateral shoots.
    for (let index = 0; index < budCount; index++) {
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

// ---------------------------------------------------------------------------------------------
// Flush shoots
// ---------------------------------------------------------------------------------------------

/** Number of terminal shoots at or beyond each node. */
function countTips(nodes: GrowthNodes): Float64Array {
  const {count, parent} = nodes;
  const tips = new Float64Array(count);
  for (let node = count - 1; node >= 0; node--) {
    if (tips[node] === 0) tips[node] = 1;
    if (parent[node] >= 0) tips[parent[node]] += tips[node];
  }
  return tips;
}

/** Shoots wanted by relative height, summed from the crown's floor to its top: by area, and more on top. */
function createCrownSurface(envelope: CrownEnvelope): Float64Array {
  const surface = new Float64Array(CROWN_TABLE_SIZE + 1);
  let last = getCrownProfile(envelope, envelope.floorZ) * envelope.width;
  for (let index = 1; index <= CROWN_TABLE_SIZE; index++) {
    const zeta = envelope.floorZ + (index / CROWN_TABLE_SIZE) * (1 - envelope.floorZ);
    const radius = getCrownProfile(envelope, zeta) * envelope.width;
    const rise = (1 - envelope.floorZ) / CROWN_TABLE_SIZE;
    const slant = Math.sqrt(rise * rise + (radius - last) * (radius - last));
    // Light falls thickest on the crown's top, and from the side there are few leaves in the way
    // there.
    const lit = 1 + 2.4 * smoothstep(0.55, 0.95, zeta);
    surface[index] = surface[index - 1] + Math.PI * (radius + last) * slant * lit;
    last = radius;
  }
  return surface;
}

/** The relative height below which a fraction of a crown's shoots lie. */
function getCrownSurfaceHeight(
  envelope: CrownEnvelope,
  surface: Float64Array,
  fraction: number
): number {
  const area = clamp(fraction, 0, 1) * surface[CROWN_TABLE_SIZE];
  let low = 0;
  let high = CROWN_TABLE_SIZE;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (surface[middle] <= area) low = middle;
    else high = middle;
  }
  const across = (area - surface[low]) / Math.max(surface[high] - surface[low], 1e-9);
  return envelope.floorZ + ((low + across) / CROWN_TABLE_SIZE) * (1 - envelope.floorZ);
}

/** Where flush shoots end: on lattices over scaled copies of the crown, in the order they are reached. */
type FlushTargets = {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Growth at which the crown reaches each, ascending. */
  arrival: Float64Array;
};

/**
 * A golden-angle lattice of shoot ends for each tier of `FLUSH_TIERS`, so the crown has no holes,
 * and
 * jittered by about the lattice's spacing, so it has no pattern. The hollow under the skirt stays
 * open,
 * and a young tree's shoots keep above the height its limbs start from.
 */
function placeFlushTargets(context: GrowthContext, rng: () => number): FlushTargets {
  const {profile, traits, envelope} = context;
  const total = Math.round(profile.flushShoots * Math.sqrt(traits.branchDensity));
  const surface = createCrownSurface(envelope);
  const area = surface[CROWN_TABLE_SIZE];
  const {width, floorZ} = envelope;
  const x = new Float64Array(total);
  const y = new Float64Array(total);
  const z = new Float64Array(total);
  const arrival = new Float64Array(total);
  // A skirt's edge is uneven: it brushes the ground in places, and lifts a little in others.
  const edgeA = rng() * TWO_PI;
  const edgeB = rng() * TWO_PI;
  const edgeC = rng() * TWO_PI;
  const skirtFloor = (px: number, py: number): number => {
    const azimuth = Math.atan2(py, px);
    const lift =
      (0.5 + 0.5 * Math.sin(azimuth * 2 + edgeA)) * (0.6 + 0.4 * Math.sin(azimuth * 5 + edgeB)) +
      0.35 * (0.5 + 0.5 * Math.sin(azimuth * 11 + edgeC));
    return floorZ * 0.6 + 0.04 * lift * traits.crownAsymmetry;
  };
  let placed = 0;
  for (const [low, high, share] of FLUSH_TIERS) {
    const count = Math.min(Math.round(total * share), total - placed);
    const sprays = Math.max(
      1,
      Math.round(count / lerp(2.5, FLUSH_SPRAY + 0.5, smoothstep(0.35, 0.75, high)))
    );
    const spacing = Math.sqrt(area / sprays);
    const turn = rng() * TWO_PI;
    for (let spray = 0; spray < sprays; spray++) {
      const zeta = getCrownSurfaceHeight(
        envelope,
        surface,
        (spray + 0.5 + (rng() - 0.5) * 0.9) / sprays
      );
      const relative = getCrownProfile(envelope, zeta);
      const crown = lerp(low, high, rng());
      const across = spacing / Math.max(relative * width, spacing);
      const azimuth = spray * GOLDEN_ANGLE + turn + (rng() - 0.5) * across;
      const cosine = Math.cos(azimuth) * relative;
      const sine = Math.sin(azimuth) * relative;
      const reach = getCrownReach(envelope, cosine, sine, getCrownFrameZ(envelope, zeta));
      const centerX = cosine * width * crown * reach;
      const centerY = sine * width * crown * reach;
      const height = getTreeHeightFraction(getTreeGrowthAtCrown(crown));
      const middleZ = height * envelope.widest;
      const centerZ = middleZ + height * (zeta - envelope.widest) * reach;
      // Now and then a vigorous shoot stands proud of the surface, though within the smooth shape.
      if (rng() < PROUD_SHOOTS && placed < total) {
        const proud = Math.min(1.08 / reach, 1.05 + rng() * 0.1);
        const proudX = centerX * proud;
        const proudY = centerY * proud;
        const proudZ = middleZ + (centerZ - middleZ) * proud;
        const inCrown = Math.sqrt(proudX * proudX + proudY * proudY) / width;
        if (proudZ > Math.max(floorZ, 0.12)) {
          x[placed] = proudX;
          y[placed] = proudY;
          z[placed] = proudZ;
          arrival[placed] = Math.min(0.995, readArrivalTable(context.arrivals, inCrown, proudZ));
          placed++;
        }
      }
      // A spray is a clump as wide as a good part of the way to the next, so gaps stay between
      // them.
      const spread = spacing * crown * 0.46;
      // A young crown has room for few shoots to a spray, and carries them all round.
      const youth = smoothstep(0.35, 0.75, crown);
      const members = 1 + Math.floor(lerp(1.5, FLUSH_SPRAY, youth) + rng() * 2);
      for (let member = 0; member < members && placed < total; member++) {
        let px = centerX + drawGaussian(rng) * spread;
        let py = centerY + drawGaussian(rng) * spread;
        let pz = centerZ + drawGaussian(rng) * spread;
        // Whatever a spray puts outside the crown comes back to its surface.
        let time = lookUpArrival(envelope, context.arrivals, px, py, pz);
        for (let attempt = 0; attempt < 4 && time >= 0.998; attempt++) {
          px *= 0.975;
          py *= 0.975;
          pz = envelope.widest + (pz - envelope.widest) * 0.975;
          time = lookUpArrival(envelope, context.arrivals, px, py, pz);
        }
        if (time >= 0.998 || pz < Math.max(skirtFloor(px, py), getCrownUnderside(profile, time))) {
          continue;
        }
        const inner = Math.sqrt(px * px + py * py) / (width * profile.hollowReach);
        const hollow = profile.hollowHeight * lerp(0.35, 1, youth);
        if (inner < 1 && pz < floorZ + hollow * (1 - inner * inner) && rng() > 0.15) continue;
        x[placed] = px;
        y[placed] = py;
        z[placed] = pz;
        arrival[placed] = time;
        placed++;
      }
    }
  }
  const order = Array.from({length: placed}, (_, index) => index).sort(
    (a, b) => arrival[a] - arrival[b]
  );
  return {
    count: placed,
    x: Float64Array.from(order, index => x[index]),
    y: Float64Array.from(order, index => y[index]),
    z: Float64Array.from(order, index => z[index]),
    arrival: Float64Array.from(order, index => arrival[index])
  };
}

/**
 * The fine end of the tree. Colonization leaves limbs that come near the crown's surface, and these
 * shoots finish it. Each flush shoot is grown to a target of `placeFlushTargets`, from whichever
 * nearby
 * wood already exists, or from a longer relay shoot sent out for it when nothing is near. So shoots
 * end
 * where the crown needs them, the dome is closed at any age, and they gather into sprays on one
 * another.
 * They arch up and out and droop at the tip, and low in the outer crown they hang, which makes the
 * skirt.
 *
 * A whip has no crown yet. Its side shoots are feathers, which spiral up the stem, and are short
 * enough
 * for the stem to swallow them as it thickens.
 */
function sproutShoots(context: GrowthContext): void {
  const {profile, traits, envelope, nodes} = context;
  const rng = createStream(context.seed, 0x7416);
  const {x, y, z, birth, level, shoot, hx, hy, hz} = nodes;
  const colonized = nodes.count;
  const droopAmount = profile.twigDroop * traits.twigDroop;
  const size = traits.internodeLength;
  const ideal = profile.flushLength * size;
  const wiggle = Math.min(1.5, traits.branchWander);
  const {width} = envelope;
  const capacity = x.length;

  // Wood a shoot may start from, in a uniform grid.
  const cell = 0.05;
  const margin = cell * 2;
  const side = Math.ceil((2 * (width + margin)) / cell) + 1;
  const levels = Math.ceil(1.1 / cell) + 1;
  const head = new Int32Array(side * side * levels).fill(-1);
  const link = new Int32Array(capacity);
  const toCell = (value: number) => clamp(((value + width + margin) / cell) | 0, 0, side - 1);
  const toLevel = (value: number) => clamp((value / cell) | 0, 0, levels - 1);
  const insert = (node: number): void => {
    const index = toCell(x[node]) + toCell(y[node]) * side + toLevel(z[node]) * side * side;
    link[node] = head[index];
    head[index] = node;
  };
  for (let node = 1; node < colonized; node++) {
    if (shoot[node] !== 0) insert(node);
  }
  const load = new Float64Array(capacity);
  load.set(countTips(nodes));
  const sprouted = new Uint8Array(capacity);
  // How many shoots on shoots a node is from a limb: a crown of limbs and fine sprays, not long
  // rods.
  const generation = new Uint8Array(capacity);
  let isFeather = false;

  const getArrival = (px: number, py: number, pz: number) =>
    lookUpArrival(envelope, context.arrivals, px, py, pz);

  /**
   * Lays a shoot from a socket through a control point to an end, with births from `start`, none
   * before
   * the crown reaches it. Returns its last node, or -1 if no node fits.
   */
  const layArc = (
    socket: number,
    cx: number,
    cy: number,
    cz: number,
    ex: number,
    ey: number,
    ez: number,
    segments: number,
    start: number,
    latest: number
  ): number => {
    const shootId = nodes.count;
    const sx = x[socket];
    const sy = y[socket];
    const sz = z[socket];
    let current = socket;
    let time = start;
    const length = Math.hypot(ex - sx, ey - sy, ez - sz);
    for (let index = 1; index <= segments; index++) {
      if (nodes.count >= capacity) break;
      const t = index / segments;
      const a = (1 - t) * (1 - t);
      const b = 2 * t * (1 - t);
      const c = t * t;
      const jitter = index < segments ? (wiggle * length * 0.34) / segments : 0;
      const px = a * sx + b * cx + c * ex + (rng() - 0.5) * jitter;
      const py = a * sy + b * cy + c * ey + (rng() - 0.5) * jitter;
      const pz = clamp(a * sz + b * cz + c * ez + (rng() - 0.5) * jitter, 0.012, 0.998);
      const arrival = Math.min(getArrival(px, py, pz), latest);
      time = Math.min(LAST_NODE_BIRTH, Math.max(time + 0.0015 + rng() * 0.003, arrival));
      const dx = px - x[current];
      const dy = py - y[current];
      const dz = pz - z[current];
      const stride = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const node = addGrowthNode(nodes, current, px, py, pz, time, shootId);
      hx[node] = dx / stride;
      hy[node] = dy / stride;
      hz[node] = dz / stride;
      level[node] = getTreeCrownFraction(arrival);
      load[node] = 1;
      generation[node] = generation[socket] + 1;
      if (!isFeather) insert(node);
      current = node;
    }
    return current === socket ? -1 : current;
  };

  /**
   * The best wood for a shoot to a point: thin and not yet crowded with shoots, there when the
   * crown
   * reaches the point, and not making the new shoot grow back on itself or into the crown.
   */
  const findSocket = (
    px: number,
    py: number,
    pz: number,
    time: number,
    nearest: number,
    furthest: number,
    wanted: number,
    oldest: number
  ): number => {
    const reach = Math.ceil(furthest / cell);
    const cx = toCell(px);
    const cy = toCell(py);
    const cz = toLevel(pz);
    const planar = Math.sqrt(px * px + py * py) || 1;
    const outX = px / planar;
    const outY = py / planar;
    let best = -1;
    let bestCost = Infinity;
    const firstLevel = Math.max(0, cz - reach);
    const lastLevel = Math.min(levels - 1, cz + reach);
    const firstRow = Math.max(0, cy - reach);
    const lastRow = Math.min(side - 1, cy + reach);
    const firstColumn = Math.max(0, cx - reach);
    const lastColumn = Math.min(side - 1, cx + reach);
    for (let iz = firstLevel; iz <= lastLevel; iz++) {
      for (let iy = firstRow; iy <= lastRow; iy++) {
        for (let ix = firstColumn; ix <= lastColumn; ix++) {
          let node = head[ix + iy * side + iz * side * side];
          for (; node >= 0; node = link[node]) {
            if (generation[node] > oldest) continue;
            const dx = px - x[node];
            const dy = py - y[node];
            const dz = pz - z[node];
            const squared = dx * dx + dy * dy + dz * dz;
            if (squared < nearest * nearest || squared > furthest * furthest) continue;
            const distance = Math.sqrt(squared);
            const ahead = (dx * hx[node] + dy * hy[node] + dz * hz[node]) / distance;
            // A tip can only go on from itself, more or less, or it would be a corner in one piece
            // of wood.
            if (ahead < 0.72 && nodes.next[node] < 0 && sprouted[node] === 0) continue;
            const outward = (dx * outX + dy * outY) / distance;
            const cost =
              (Math.abs(distance - wanted) + distance * 0.35) *
                (1 + load[node] * 0.01) *
                (1 + sprouted[node] * 0.9) *
                (ahead < 0.15 ? 2.4 : 1) *
                (outward < -0.3 ? 1.5 : 1) +
              Math.max(0, birth[node] - time) * 0.4;
            if (cost < bestCost) {
              bestCost = cost;
              best = node;
            }
          }
        }
      }
    }
    return best;
  };

  /** Lays a shoot to a point, arched and drooping. Returns its last node, or -1. */
  const growShoot = (
    socket: number,
    px: number,
    py: number,
    pz: number,
    time: number,
    segmentLength: number,
    maximumSegments: number
  ): number => {
    const lowness = 1 - smoothstep(0.08, 0.6, pz);
    const chord = Math.hypot(px - x[socket], py - y[socket], pz - z[socket]);
    // Droop lowers where the shoot ends up.
    const ez = Math.max(0.012, pz - droopAmount * chord * 0.16 * (0.4 + lowness));
    const dx = px - x[socket];
    const dy = py - y[socket];
    const dz = ez - z[socket];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
    // Arch: the middle control point rises above the chord and leans along the parent's heading.
    const rise = distance * (0.08 + rng() * 0.2 + droopAmount * 0.1 * (0.5 + lowness));
    const lean = Math.min(distance * 0.3, 0.02);
    const segments = clamp(Math.round(distance / segmentLength), 1, maximumSegments);
    const start = Math.max(birth[socket] + 0.0015 + rng() * 0.004, time - 0.008);
    sprouted[socket] = Math.min(250, sprouted[socket] + 1);
    load[socket]++;
    return layArc(
      socket,
      x[socket] + dx * 0.5 + hx[socket] * lean,
      y[socket] + dy * 0.5 + hy[socket] * lean,
      z[socket] + dz * 0.5 + hz[socket] * lean + rise,
      px,
      py,
      ez,
      segments,
      start,
      Math.max(time, start)
    );
  };

  // Feathers: side shoots spiralling up the stem from a little above the soil to its last socket.
  // Nothing
  // grows on them, so the stem can swallow them.
  isFeather = true;
  let stemEnd = 0;
  while (stemEnd + 1 < colonized && shoot[stemEnd + 1] === 0) stemEnd++;
  let around = rng() * TWO_PI;
  const featherTop = z[stemEnd] - 0.006;
  const featherBottom = context.forkZ * 0.55;
  for (let feather = 0; feather < profile.feathers; feather++) {
    const height = lerp(
      featherBottom,
      featherTop,
      (feather + 0.25 + rng() * 0.5) / profile.feathers
    );
    let socket = 0;
    while (socket < stemEnd - 1 && z[socket] < height) socket++;
    around += GOLDEN_ANGLE + (rng() - 0.5) * 0.5;
    const length = Math.min(0.0125, profile.trunkRatio * 0.5) * (0.8 + rng() * 0.4);
    const out = toRadians(44 + rng() * 26);
    const ex = x[socket] + Math.cos(around) * Math.sin(out) * length;
    const ey = y[socket] + Math.sin(around) * Math.sin(out) * length;
    const ez = z[socket] + Math.cos(out) * length;
    hx[socket] = 0;
    hy[socket] = 0;
    hz[socket] = 1;
    const time = birth[socket] + 0.007 + rng() * 0.012;
    layArc(
      socket,
      (x[socket] + ex) / 2,
      (y[socket] + ey) / 2,
      (z[socket] + ez) / 2 + length * 0.14,
      ex,
      ey,
      ez,
      2,
      time,
      time
    );
  }

  isFeather = false;

  // Flush shoots, with relays where they are needed.
  const targets = placeFlushTargets(context, rng);
  const longest = ideal * 1.5;
  const relayReach = 0.14;
  const skipped: number[] = [];
  const growFlush = (target: number, relayLimit: number): boolean => {
    const px = targets.x[target];
    const py = targets.y[target];
    const pz = targets.z[target];
    const time = targets.arrival[target];
    let socket = findSocket(px, py, pz, time, ideal * 0.5, longest, ideal, 2);
    if (socket < 0) {
      // Nothing near: send out a relay, which ends a shoot's length short of the target.
      const relay = findSocket(px, py, pz, time, ideal * 1.2, relayLimit, ideal * 1.2, 1);
      if (relay < 0) return false;
      const dx = px - x[relay];
      const dy = py - y[relay];
      const dz = pz - z[relay];
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const end = (distance - ideal * (0.72 + rng() * 0.2)) / distance;
      socket = growShoot(
        relay,
        x[relay] + dx * end,
        y[relay] + dy * end,
        z[relay] + dz * end,
        time,
        0.024 * size,
        9
      );
      if (socket < 0) return false;
    }
    return growShoot(socket, px, py, pz, time, ideal * 0.36, 3) >= 0;
  };
  for (let target = 0; target < targets.count && nodes.count < capacity - 8; target++) {
    if (!growFlush(target, relayReach)) skipped.push(target);
  }
  // What limbs did not come near: a longer relay for the outer crown, and nothing for the inner.
  for (const target of skipped) {
    if (nodes.count >= capacity - 8) break;
    if (targets.arrival[target] > 0.6) growFlush(target, relayReach * 2.4);
  }
}

// ---------------------------------------------------------------------------------------------
// Pipe model
// ---------------------------------------------------------------------------------------------

type PipeRadii = {
  /** Radius arriving at each node, below any fork there. */
  radius: Float64Array;
  /** Radius a node's segment starts with at its parent. */
  base: Float64Array;
  /** Pipe load at each node, for finding its main child. */
  load: Float64Array;
};

/**
 * `r^2.4 = sum(child r^2.4)` at every fork, with terminal twigs at the floor radius. Real wood also
 * thickens between forks with the disused pipes of shed shoots, so load grows geometrically with
 * length as well. The rate is solved so the trunk base comes to exactly 1.
 */
function computePipeRadii(nodes: GrowthNodes, floor: number): PipeRadii {
  const {count, parent, x, y, z, birth} = nodes;
  const lengths = new Float64Array(count);
  for (let node = 1; node < count; node++) {
    const before = parent[node];
    lengths[node] = Math.hypot(x[node] - x[before], y[node] - y[before], z[node] - z[before]);
  }
  // An old terminal twig has thickened for years; only the youngest are at the floor.
  const terminal = new Float64Array(count);
  for (let node = 0; node < count; node++) {
    terminal[node] = Math.pow(1 + 0.8 * (1 - birth[node]), PIPE_EXPONENT);
  }
  const load = new Float64Array(count);
  const evaluate = (rate: number): number => {
    load.fill(0);
    for (let node = count - 1; node >= 1; node--) {
      if (load[node] === 0) load[node] = terminal[node];
      load[parent[node]] += load[node] * Math.exp(rate * lengths[node]);
    }
    return load[0];
  };
  const target = Math.pow(1 / floor, PIPE_EXPONENT);
  let rate = 0;
  if (evaluate(0) < target) {
    let low = 0;
    let high = 1;
    while (evaluate(high) < target && high < 64) high *= 2;
    for (let iteration = 0; iteration < 18; iteration++) {
      const middle = (low + high) / 2;
      if (evaluate(middle) < target) low = middle;
      else high = middle;
    }
    rate = high;
  }
  const rootLoad = evaluate(rate);
  const inverse = 1 / PIPE_EXPONENT;
  const scale = Math.pow(1 / rootLoad, inverse);
  const radius = new Float64Array(count);
  const base = new Float64Array(count);
  for (let node = 0; node < count; node++) {
    radius[node] = scale * Math.pow(load[node], inverse);
    base[node] = scale * Math.pow(load[node] * Math.exp(rate * lengths[node]), inverse);
  }
  return {radius, base, load};
}

// ---------------------------------------------------------------------------------------------
// Chains: one tube per axis
// ---------------------------------------------------------------------------------------------

type GrowthChains = {
  count: number;
  /** Offsets into `nodes`: chain c is nodes[start[c]] up to nodes[start[c + 1] - 1]. */
  start: Int32Array;
  /** Each chain's socket on its parent first, except for the stem, then the chain's own nodes. */
  nodes: Int32Array;
  order: Int32Array;
  seed: Float32Array;
  /** Number of chains leaving each node. */
  socketCount: Int32Array;
  /** Base radius of the thickest chain leaving each node. */
  largestSide: Float64Array;
};

/**
 * Splits the tree into axes. An axis continues into its heaviest child and the others start new
 * chains, so a chain's order counts how many times its wood gave way to a thicker axis. The stem
 * ends
 * at its last socket, whose axis is a scaffold like the others. Chains come parents first.
 */
function buildChains(
  nodes: GrowthNodes,
  pipe: PipeRadii,
  colonized: number,
  rng: () => number
): GrowthChains {
  const {count, parent, shoot} = nodes;
  const firstChild = new Int32Array(count).fill(-1);
  const sibling = new Int32Array(count).fill(-1);
  for (let node = count - 1; node >= 1; node--) {
    sibling[node] = firstChild[parent[node]];
    firstChild[parent[node]] = node;
  }
  const start = new Int32Array(count + 2);
  const list = new Int32Array(count * 2 + 2);
  const order = new Int32Array(count + 1);
  const seed = new Float32Array(count + 1);
  const socketCount = new Int32Array(count);
  const largestSide = new Float64Array(count);
  const queueNode = new Int32Array(count + 1);
  const queueOrder = new Int32Array(count + 1);
  let queueHead = 0;
  let queueTail = 1;
  let chainCount = 0;
  let cursor = 0;
  while (queueHead < queueTail) {
    const first = queueNode[queueHead];
    const chain = chainCount++;
    start[chain] = cursor;
    order[chain] = queueOrder[queueHead];
    seed[chain] = rng();
    queueHead++;
    if (parent[first] >= 0) {
      list[cursor++] = parent[first];
      socketCount[parent[first]]++;
      largestSide[parent[first]] = Math.max(largestSide[parent[first]], pipe.base[first]);
    }
    let node = first;
    while (node >= 0) {
      list[cursor++] = node;
      let main = -1;
      let mainLoad = 0;
      for (let child = firstChild[node]; child >= 0; child = sibling[child]) {
        const load = shoot[node] === 0 ? (shoot[child] === 0 ? 1 : 0) : pipe.load[child];
        if (load > mainLoad) {
          main = child;
          mainLoad = load;
        }
      }
      for (let child = firstChild[node]; child >= 0; child = sibling[child]) {
        if (child === main) continue;
        queueNode[queueTail] = child;
        // A feather on the stem is no scaffold.
        queueOrder[queueTail] = order[chain] + (shoot[node] === 0 && child >= colonized ? 2 : 1);
        queueTail++;
      }
      node = main;
    }
  }
  start[chainCount] = cursor;
  return {count: chainCount, start, nodes: list, order, seed, socketCount, largestSide};
}

/**
 * Cuts the corners of thick limbs a little, as wood that thickened since it was laid fills in the
 * inside
 * of an elbow. The node moves onto the short curve between the two segments, so a fork's socket
 * stays on
 * the limb. A limb stays straight between its nodes, and a thin shoot keeps its kinks.
 */
function roundElbows(
  nodes: GrowthNodes,
  chains: GrowthChains,
  pipe: PipeRadii,
  ratio: number
): void {
  const {x, y, z} = nodes;
  const list = chains.nodes;
  // A kink spreads over the nodes around it, and more on thin wood, which has no rings to spare for
  // an
  // elbow, so no limb has a sharp corner. Between kinks the nodes are in line, and stay there.
  for (let pass = 0; pass < 3; pass++) {
    for (let chain = 1; chain < chains.count; chain++) {
      for (let index = chains.start[chain] + 1; index < chains.start[chain + 1] - 1; index++) {
        const node = list[index];
        const weight = pipe.radius[node] >= 0.2 ? 0.15 : 0.38;
        const before = list[index - 1];
        const after = list[index + 1];
        x[node] += weight * ((x[before] + x[after]) / 2 - x[node]);
        y[node] += weight * ((y[before] + y[after]) / 2 - y[node]);
        z[node] += weight * ((z[before] + z[after]) / 2 - z[node]);
      }
    }
  }
  for (let chain = 1; chain < chains.count; chain++) {
    for (let index = chains.start[chain] + 1; index < chains.start[chain + 1] - 1; index++) {
      const node = list[index];
      if (pipe.radius[node] < 0.03) break;
      const before = list[index - 1];
      const after = list[index + 1];
      const inX = x[node] - x[before];
      const inY = y[node] - y[before];
      const inZ = z[node] - z[before];
      const outX = x[after] - x[node];
      const outY = y[after] - y[node];
      const outZ = z[after] - z[node];
      const lengthIn = Math.sqrt(inX * inX + inY * inY + inZ * inZ) || 1e-6;
      const lengthOut = Math.sqrt(outX * outX + outY * outY + outZ * outZ) || 1e-6;
      const turn = Math.acos(
        clamp((inX * outX + inY * outY + inZ * outZ) / (lengthIn * lengthOut), -1, 1)
      );
      if (turn < toRadians(3)) continue;
      const reach = getElbowReach(pipe.radius[node], ratio, turn, lengthIn, lengthOut);
      // The middle of a quadratic curve from one side of the node to the other.
      const moved = reach * 0.25;
      x[node] += (outX / lengthOut - inX / lengthIn) * moved;
      y[node] += (outY / lengthOut - inY / lengthIn) * moved;
      z[node] += (outZ / lengthOut - inZ / lengthIn) * moved;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------------------------

type GrowthLimbs = {
  limbs: Float32Array;
  count: number;
  /** Per node: the limb its own limb is inside, and its own, smallest limb. */
  outer: Int32Array;
  inner: Int32Array;
};

/**
 * Rigid limbs from the branch hierarchy. Every scaffold is a limb, and so is whatever grows past
 * the
 * point where its wood thins through a threshold, if it holds a few shoots. A node stores its own
 * limb
 * and the next one out. Two levels are enough because a thinner limb always breaks before the limb
 * it
 * grows on, so by the time an outer limb goes, what grew on the inner ones has fallen already.
 */
function buildLimbs(context: GrowthContext, pipe: PipeRadii, rng: () => number): GrowthLimbs {
  const {nodes, profile} = context;
  const {count, x, y, z, parent, shoot} = nodes;
  const tips = countTips(nodes);
  const outer = new Int32Array(count);
  const inner = new Int32Array(count);
  const thresholds = [0.17, 0.072];
  const pivots: number[] = [0, 0, 0];
  const breakAt: number[] = [2];
  const outerOf: number[] = [0];
  const addLimb = (node: number, size: number, up: number): number => {
    const limb = breakAt.length;
    const around = parent[node];
    pivots.push(x[around], y[around], z[around]);
    const raw = lerp(0.05, 0.97, Math.pow(clamp(size / 0.62, 0, 1), 0.55)) + (rng() - 0.5) * 0.16;
    breakAt.push(clamp(raw, 0.02, up > 0 ? breakAt[up] * 0.9 : 0.985));
    outerOf.push(up);
    return limb;
  };
  for (let node = 1; node < count; node++) {
    if (shoot[node] === 0) continue;
    const before = parent[node];
    let own = inner[before];
    let up = outer[before];
    const size = pipe.base[node];
    if (shoot[before] === 0) {
      own = addLimb(node, size, 0);
      up = 0;
    } else if (tips[node] >= 3) {
      for (const threshold of thresholds) {
        if (pipe.radius[before] >= threshold && size < threshold) {
          up = own;
          own = addLimb(node, size, up);
          break;
        }
      }
    }
    inner[node] = own;
    outer[node] = up;
  }

  // Direction and reach, gathered from the tips inward, in template space.
  const limbCount = breakAt.length;
  const scaleX = 1 / profile.crownAspect;
  const sumX = new Float64Array(limbCount);
  const sumY = new Float64Array(limbCount);
  const sumZ = new Float64Array(limbCount);
  const weight = new Float64Array(limbCount);
  const reach = new Float64Array(limbCount);
  for (let node = 0; node < count; node++) {
    const limb = inner[node];
    if (limb === 0) continue;
    const dx = (x[node] - pivots[limb * 3]) * scaleX;
    const dy = (y[node] - pivots[limb * 3 + 1]) * scaleX;
    const dz = z[node] - pivots[limb * 3 + 2];
    sumX[limb] += dx;
    sumY[limb] += dy;
    sumZ[limb] += dz;
    weight[limb]++;
    reach[limb] = Math.max(reach[limb], Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const limbs = new Float32Array(limbCount * TREE_LIMB_STRIDE);
  limbs[3] = 2;
  limbs[6] = 1;
  for (let limb = limbCount - 1; limb >= 1; limb--) {
    const up = outerOf[limb];
    if (up > 0) {
      const ax = (pivots[limb * 3] - pivots[up * 3]) * scaleX;
      const ay = (pivots[limb * 3 + 1] - pivots[up * 3 + 1]) * scaleX;
      const az = pivots[limb * 3 + 2] - pivots[up * 3 + 2];
      sumX[up] += sumX[limb] + ax * weight[limb];
      sumY[up] += sumY[limb] + ay * weight[limb];
      sumZ[up] += sumZ[limb] + az * weight[limb];
      weight[up] += weight[limb];
      reach[up] = Math.max(reach[up], reach[limb] + Math.sqrt(ax * ax + ay * ay + az * az));
    }
    const length = Math.sqrt(sumX[limb] ** 2 + sumY[limb] ** 2 + sumZ[limb] ** 2) || 1;
    const offset = limb * TREE_LIMB_STRIDE;
    limbs[offset] = pivots[limb * 3] * scaleX;
    limbs[offset + 1] = pivots[limb * 3 + 1] * scaleX;
    limbs[offset + 2] = pivots[limb * 3 + 2];
    limbs[offset + 3] = breakAt[limb];
    limbs[offset + 4] = sumX[limb] / length;
    limbs[offset + 5] = sumY[limb] / length;
    limbs[offset + 6] = sumZ[limb] / length;
    limbs[offset + 7] = reach[limb];
  }
  return {limbs, count: limbCount, outer, inner};
}

// ---------------------------------------------------------------------------------------------
// Rings
// ---------------------------------------------------------------------------------------------

/** Rings of all tubes. Rings of one tube are consecutive, from socket to apex. */
type WoodRings = {
  count: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  birth: Float64Array;
  radius: Float64Array;
  /** Previous ring, or -1 if the ring has no predecessor. */
  previous: Int32Array;
  /** Non-zero if the next ring continues this tube. */
  linked: Uint8Array;
  /** Frame across the tube. */
  nx: Float32Array;
  ny: Float32Array;
  nz: Float32Array;
  bx: Float32Array;
  by: Float32Array;
  bz: Float32Array;
  /** Sides of the ring; 0 is a single apex vertex. */
  sides: Uint8Array;
  barkV: Float32Array;
  outer: Int32Array;
  inner: Int32Array;
  order: Uint16Array;
  seed: Float32Array;
  flags: Uint8Array;
  occlusion: Float32Array;
  /** Chain the ring belongs to, or -1 for roots, thorns and soil. */
  chain: Int32Array;
  /** How much of the trunk's fluting the ring has, from 1 on the stem to 0 on most wood. */
  flute: Float32Array;
  /** Rings whose every vertex is authored, `SHAPED_STRIDE` floats each: collars. */
  shaped: Map<number, Float64Array>;
  /** The birth a ring with no previous ring comes from, 0 but for a collar, which appears only then. */
  since: Float64Array;
  /** Non-zero for soil only finer levels of detail draw, and for roots only the finest draws. */
  fine: Uint8Array;
};

function createWoodRings(capacity: number): WoodRings {
  return {
    count: 0,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    birth: new Float64Array(capacity),
    radius: new Float64Array(capacity),
    previous: new Int32Array(capacity),
    linked: new Uint8Array(capacity),
    nx: new Float32Array(capacity),
    ny: new Float32Array(capacity),
    nz: new Float32Array(capacity),
    bx: new Float32Array(capacity),
    by: new Float32Array(capacity),
    bz: new Float32Array(capacity),
    sides: new Uint8Array(capacity),
    barkV: new Float32Array(capacity),
    outer: new Int32Array(capacity),
    inner: new Int32Array(capacity),
    order: new Uint16Array(capacity),
    seed: new Float32Array(capacity),
    flags: new Uint8Array(capacity),
    occlusion: new Float32Array(capacity),
    chain: new Int32Array(capacity),
    flute: new Float32Array(capacity),
    shaped: new Map(),
    since: new Float64Array(capacity),
    fine: new Uint8Array(capacity)
  };
}

function getRingSides(radius: number): number {
  if (radius >= 0.72) return 24;
  if (radius >= 0.5) return 20;
  if (radius >= 0.34) return 16;
  if (radius >= 0.22) return 14;
  if (radius >= 0.14) return 12;
  if (radius >= 0.09) return 10;
  if (radius >= 0.06) return 8;
  if (radius >= 0.042) return 6;
  if (radius >= 0.03) return 4;
  return 3;
}

/** Gives a run of rings strictly increasing births that end before `LAST_RING_BIRTH`. */
function settleBirths(birth: Float64Array, first: number, end: number): void {
  for (let ring = first + 1; ring < end; ring++) {
    birth[ring] = Math.max(birth[ring], birth[ring - 1] + BIRTH_EPSILON);
  }
  if (birth[end - 1] > LAST_RING_BIRTH) {
    birth[end - 1] = LAST_RING_BIRTH;
    for (let ring = end - 2; ring >= first; ring--) {
      birth[ring] = Math.min(birth[ring], birth[ring + 1] - BIRTH_EPSILON);
    }
  }
}

/** What a run of rings' frames must agree with at its ends. */
type RingFrameEnds = {
  /** Tangent of the first ring, where the run continues a tube around a bend. */
  firstTangent?: readonly number[];
  /** Tangent of the last ring, for the same reason. */
  lastTangent?: readonly number[];
  /** The direction the first ring's first vertex leans toward, and so where bark u starts. */
  firstNormal?: readonly number[];
};

/** Parallel-transported frames along a run of rings, so tubes do not twist. */
function frameRings(rings: WoodRings, first: number, end: number, ends?: RingFrameEnds): void {
  const {x, y, z, nx, ny, nz, bx, by, bz} = rings;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let ring = first; ring < end; ring++) {
    const a = Math.max(first, ring - 1);
    const b = Math.min(end - 1, ring + 1);
    const fixed =
      ring === first ? ends?.firstTangent : ring === end - 1 ? ends?.lastTangent : undefined;
    let tx = fixed ? fixed[0] : x[b] - x[a];
    let ty = fixed ? fixed[1] : y[b] - y[a];
    let tz = fixed ? fixed[2] : z[b] - z[a];
    const length = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
    tx /= length;
    ty /= length;
    tz /= length;
    if (ring === first) {
      const seed = ends?.firstNormal;
      const along = seed ? seed[0] * tx + seed[1] * ty + seed[2] * tz : 1;
      if (seed && Math.abs(along) < 0.98) {
        px = seed[0] - tx * along;
        py = seed[1] - ty * along;
        pz = seed[2] - tz * along;
        const size = Math.sqrt(px * px + py * py + pz * pz) || 1;
        px /= size;
        py /= size;
        pz /= size;
      } else {
        setSideDirection(tx, ty, tz, 0);
        px = SIDE[0];
        py = SIDE[1];
        pz = SIDE[2];
      }
    } else {
      const along = px * tx + py * ty + pz * tz;
      px -= tx * along;
      py -= ty * along;
      pz -= tz * along;
      const size = Math.sqrt(px * px + py * py + pz * pz) || 1;
      px /= size;
      py /= size;
      pz /= size;
    }
    nx[ring] = px;
    ny[ring] = py;
    nz[ring] = pz;
    bx[ring] = ty * pz - tz * py;
    by[ring] = tz * px - tx * pz;
    bz[ring] = tx * py - ty * px;
  }
}

function getWoodOcclusion(level: number, z: number): number {
  return lerp(0.2, 1, smoothstep(0.3, 1, level)) * lerp(0.75, 1, smoothstep(0, 0.2, z));
}

/** Swelling of the stem at a graft: a small bulge, with the rootstock a little stouter below it. */
function getStemSwell(profile: TreeGrowthProfile, z: number): number {
  const union = profile.budUnionZ;
  if (union <= 0) return 1;
  const offset = (z - union) / 0.0065;
  return (
    1 +
    0.055 * Math.exp(-offset * offset) +
    0.03 * (1 - smoothstep(union - 0.004, union + 0.004, z))
  );
}

/**
 * How far along a limb's segments an elbow reaches, in design units: enough for its radius, and a
 * good
 * part of the shorter segment if it turns much, so even thin wood curves round a corner.
 */
function getElbowReach(
  radius: number,
  ratio: number,
  turn: number,
  lengthIn: number,
  lengthOut: number
): number {
  const shorter = Math.min(lengthIn, lengthOut);
  const reach = radius * ratio * (1.3 + 2.4 * Math.tan(Math.min(turn, 1.2) / 2));
  return Math.min(Math.max(reach, shorter * 0.34 * smoothstep(0.04, 0.3, turn)), shorter * 0.44);
}

/**
 * Turns chains into rings. A limb is straight between its nodes. Around a node it turns over a
 * short
 * elbow, as long as the wood is thick, and at a fork its radius steps down to the next, just past a
 * slight
 * swelling. Thick wood has low relief along its internodes, so it looks old. Thin straight runs
 * lose
 * rings. Forks always keep a ring, so a child's `previous` is an actual ring center on its parent.
 * The last
 * scaffold simply goes on from the stem, ring for ring, and other thick children are left to
 * `addCollars`.
 * Returns the ring of each node that has one.
 */
function buildChainRings(
  context: GrowthContext,
  chains: GrowthChains,
  pipe: PipeRadii,
  limbs: GrowthLimbs,
  rings: WoodRings,
  joints: WoodJoints
): Int32Array {
  const {profile, nodes} = context;
  const {x, y, z, birth, level} = nodes;
  const ratio = profile.trunkRatio;
  const ringOfNode = new Int32Array(nodes.count).fill(-1);
  const noise = createStream(context.seed, 0xb12c);
  const list = chains.nodes;
  const stemTop = list[chains.start[1] - 1];
  // The bend from the stem into its last scaffold, shared by the rings on both sides of it.
  let leaderChain = -1;
  let stemBend: number[] | undefined;
  for (let chain = 1; chain < chains.count; chain++) {
    if (list[chains.start[chain]] !== stemTop) continue;
    leaderChain = chain;
    const own = list[chains.start[chain] + 1];
    const below = list[chains.start[1] - 2];
    const inLength = Math.hypot(
      x[stemTop] - x[below],
      y[stemTop] - y[below],
      z[stemTop] - z[below]
    );
    const outLength = Math.hypot(x[own] - x[stemTop], y[own] - y[stemTop], z[own] - z[stemTop]);
    stemBend = [
      (x[stemTop] - x[below]) / inLength + (x[own] - x[stemTop]) / outLength,
      (y[stemTop] - y[below]) / inLength + (y[own] - y[stemTop]) / outLength,
      (z[stemTop] - z[below]) / inLength + (z[own] - z[stemTop]) / outLength
    ];
    break;
  }
  let stemRadius = 0;
  let stemEndRadius = 0;
  let stemEndSides = 0;
  let stemEndNormal: number[] | undefined;

  for (let chain = 0; chain < chains.count; chain++) {
    const from = chains.start[chain];
    const to = chains.start[chain + 1];
    const count = to - from;
    const firstRing = rings.count;
    const isStem = chain === 0;
    const socket = list[from];
    const own = list[from + 1];
    const continuesStem = chain === leaderChain;
    // Limbs differ, but slowly, so the broad stain of bark carries across a joint.
    const chainSeed = isStem
      ? chains.seed[0]
      : fract(
          rings.seed[ringOfNode[socket]] + (continuesStem ? 0 : (chains.seed[chain] - 0.5) * 0.024)
        );

    const phase = noise() * TWO_PI;
    const phaseB = noise() * TWO_PI;
    const wave = 34 + noise() * 40;
    const lateralX = noise() * TWO_PI;
    const lateralY = noise() * TWO_PI;
    const socketRing = isStem ? -1 : ringOfNode[socket];
    const baseBark = isStem ? 0 : rings.barkV[socketRing];
    let arc = 0;
    let lastRingArc = 0;
    let lastX = x[socket];
    let lastY = y[socket];
    let lastZ = z[socket];
    const isCollared = !isStem && !continuesStem && pipe.base[own] >= COLLAR_MINIMUM;

    const pushRing = (
      px: number,
      py: number,
      pz: number,
      ringBirth: number,
      radius: number,
      node: number
    ): number => {
      const ring = rings.count++;
      if (ring > firstRing) arc += Math.hypot(px - lastX, py - lastY, pz - lastZ);
      lastX = px;
      lastY = py;
      lastZ = pz;
      // Old wood is a little gnarled: low relief along the limb, more the thicker it is.
      const relief = radius > 0.05 ? 0.012 + 0.05 * smoothstep(0.1, 0.6, radius) : 0;
      const knobble =
        1 +
        relief * (0.6 * Math.sin(arc * wave + phase) + 0.4 * Math.sin(arc * wave * 2.3 + phaseB));
      const shaped = radius * knobble * (isStem ? getStemSwell(profile, pz) : 1);
      rings.x[ring] = px;
      rings.y[ring] = py;
      rings.z[ring] = pz;
      rings.birth[ring] = ringBirth;
      rings.radius[ring] = shaped;
      rings.previous[ring] = ring > firstRing ? ring - 1 : isStem ? -1 : socketRing;
      rings.linked[ring] = 1;
      rings.barkV[ring] = baseBark + arc;
      rings.outer[ring] = limbs.outer[node];
      rings.inner[ring] = limbs.inner[node];
      rings.order[ring] = chains.order[chain];
      rings.seed[ring] = chainSeed;
      rings.flags[ring] = 0;
      rings.occlusion[ring] = getWoodOcclusion(level[node], pz);
      rings.chain[ring] = chain;
      rings.sides[ring] = isStem ? Math.max(16, getRingSides(shaped)) : getRingSides(shaped);
      rings.flute[ring] = isStem
        ? 1
        : continuesStem
          ? 1 - smoothstep(0, 0.09, arc)
          : 0.3 * smoothstep(0.12, 0.5, radius);
      lastRingArc = arc;
      return ring;
    };

    /** Rings along a part of a segment, for a thick limb's relief. Fractions of the segment a to b. */
    const pushRelief = (a: number, b: number, fromT: number, toT: number): void => {
      const radiusA = continuesStem ? Math.max(pipe.base[b], stemRadius) : pipe.base[b];
      const radiusB = continuesStem ? Math.max(pipe.radius[b], stemRadius) : pipe.radius[b];
      if (radiusA < 0.03) return;
      const dx = x[b] - x[a];
      const dy = y[b] - y[a];
      const dz = z[b] - z[a];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const spanned = length * (toT - fromT);
      const spacing = Math.max(0.016, radiusA * ratio * 2.6);
      const parts = Math.min(5, Math.floor(spanned / spacing));
      if (parts < 2) return;
      setSideDirection(dx / length, dy / length, dz / length, 0);
      const ux = SIDE[0];
      const uy = SIDE[1];
      const uz = SIDE[2];
      const vx = (dy * uz - dz * uy) / length;
      const vy = (dz * ux - dx * uz) / length;
      const vz = (dx * uy - dy * ux) / length;
      const amount =
        (0.16 * radiusA * ratio * smoothstep(0.1, 0.4, radiusA) +
          0.05 * length * (1 - smoothstep(0.1, 0.2, radiusA))) *
        context.traits.branchWander;
      for (let part = 1; part < parts; part++) {
        const t = lerp(fromT, toT, part / parts);
        const along = baseBark + arc + length * (t - fromT);
        const a1 = amount * Math.sin(along * 31 + lateralX);
        const a2 = amount * Math.sin(along * 23 + lateralY);
        pushRing(
          x[a] + dx * t + ux * a1 + vx * a2,
          y[a] + dy * t + uy * a1 + vy * a2,
          z[a] + dz * t + uz * a1 + vz * a2,
          lerp(birth[a], birth[b], t),
          lerp(radiusA, radiusB, t),
          b
        );
      }
    };

    // Where the tube starts, and how much of the next segment its last ring has used.
    let consumed = 0;
    if (isStem) {
      stemRadius = pipe.radius[socket];
      pushRing(x[socket], y[socket], z[socket], FIRST_RING_BIRTH, stemRadius, socket);
      ringOfNode[socket] = firstRing;
    } else {
      const parentRing = socketRing;
      const firstBirth = Math.max(
        rings.birth[parentRing] + BIRTH_EPSILON,
        birth[own] - Math.min(0.02, (birth[own] - birth[socket]) * 0.6)
      );
      if (continuesStem) {
        const ring = pushRing(x[socket], y[socket], z[socket], firstBirth, stemEndRadius, own);
        rings.radius[ring] = stemEndRadius;
        rings.sides[ring] = stemEndSides;
        rings.flute[ring] = 1;
        joints.stemEnd = socketRing;
        joints.leaderFirst = ring;
      } else {
        const childRadius = pipe.base[own];
        const flare = !isCollared && childRadius > 0.012 ? 1.22 : 1;
        pushRing(x[socket], y[socket], z[socket], firstBirth, childRadius * flare, own);
      }
    }

    // Nodes along the chain. Segment a to b is the one arriving at a node, and b to c the one
    // leaving.
    for (let index = 1; index < count - 1; index++) {
      const a = list[from + index - 1];
      const b = list[from + index];
      const c = list[from + index + 1];
      const inX = x[b] - x[a];
      const inY = y[b] - y[a];
      const inZ = z[b] - z[a];
      const lengthIn = Math.sqrt(inX * inX + inY * inY + inZ * inZ) || 1e-6;
      const outX = x[c] - x[b];
      const outY = y[c] - y[b];
      const outZ = z[c] - z[b];
      const lengthOut = Math.sqrt(outX * outX + outY * outY + outZ * outZ) || 1e-6;
      const turn = Math.acos(
        clamp((inX * outX + inY * outY + inZ * outZ) / (lengthIn * lengthOut), -1, 1)
      );
      let radius = pipe.radius[b];
      let nextRadius = pipe.base[c];
      if (continuesStem) {
        // The scaffold that goes on from the stem comes down from its girth gradually.
        const ease = Math.exp(-lengthIn / (stemRadius * ratio * 1.4));
        stemRadius = radius + (stemRadius - radius) * ease;
        radius = stemRadius;
        nextRadius = Math.max(nextRadius, stemRadius * 0.96);
      }
      const sideRadius = chains.largestSide[b];
      const forks = chains.socketCount[b] > 0;

      if (isStem) {
        // Rings are spaced for the stem's shape already. Its girth eases down past each scaffold.
        const ease = Math.exp(-lengthIn / (stemRadius * ratio * 1.1));
        stemRadius = radius + (stemRadius - radius) * ease;
        ringOfNode[b] = pushRing(x[b], y[b], z[b], birth[b], stemRadius, b);
        continue;
      }

      const thick = radius >= 0.03;
      const isElbow = thick && (turn > toRadians(4) || sideRadius > radius * 0.35);
      if (isElbow) {
        const reach = getElbowReach(radius, ratio, turn, lengthIn, lengthOut);
        // The fork swells a little just below where it divides, and steps down just past it.
        const swell = 0.09 * Math.min(1, sideRadius / Math.max(radius, 1e-6));
        const t = 1 - reach / lengthIn;
        if (consumed < lengthIn) pushRelief(a, b, consumed / lengthIn, t);
        pushRing(
          x[b] - (inX / lengthIn) * reach,
          y[b] - (inY / lengthIn) * reach,
          z[b] - (inZ / lengthIn) * reach,
          lerp(birth[a], birth[b], t),
          radius * (1 + swell * 0.5),
          b
        );
        ringOfNode[b] = pushRing(x[b], y[b], z[b], birth[b], radius * (1 + swell), b);
        pushRing(
          x[b] + (outX / lengthOut) * reach,
          y[b] + (outY / lengthOut) * reach,
          z[b] + (outZ / lengthOut) * reach,
          lerp(birth[b], birth[c], reach / lengthOut),
          nextRadius * (1 + swell * 0.3),
          c
        );
        consumed = reach;
        continue;
      }
      const keep =
        forks ||
        turn > toRadians(thick ? 3 : 7) ||
        arc + lengthIn - lastRingArc > Math.max(0.03, radius * ratio * 8);
      if (keep) {
        if (thick && consumed < lengthIn) pushRelief(a, b, consumed / lengthIn, 1);
        ringOfNode[b] = pushRing(x[b], y[b], z[b], birth[b], forks ? radius : nextRadius, b);
        consumed = 0;
      }
    }

    // The far end. An apex closes every tube; the stem's stays hidden inside its last scaffold.
    const last = list[to - 1];
    if (isStem) {
      stemEndRadius = pipe.radius[last] + (stemRadius - pipe.radius[last]) * 0.6;
      ringOfNode[last] = pushRing(x[last], y[last], z[last], birth[last], stemEndRadius, last);
      stemEndSides = rings.sides[ringOfNode[last]];
      stemEndRadius = rings.radius[ringOfNode[last]];
      stemRadius = stemEndRadius;
      const apex = pushRing(
        x[last],
        y[last],
        z[last] - stemEndRadius * ratio * 0.05,
        birth[last] + BIRTH_EPSILON,
        0,
        last
      );
      rings.sides[apex] = 0;
      rings.linked[apex] = 0;
      arc = rings.barkV[ringOfNode[last]];
    } else {
      const before = list[to - 2];
      const dx = x[last] - x[before];
      const dy = y[last] - y[before];
      const dz = z[last] - z[before];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const end = pipe.radius[last] * 0.88;
      if (pipe.radius[last] >= 0.1 && consumed < length) {
        pushRelief(before, last, consumed / length, 1);
      }
      ringOfNode[last] = pushRing(x[last], y[last], z[last], birth[last], end, last);
      // A short soft tip: a bud, not a cone.
      const cap = Math.max(end * ratio * 2.2, 0.0003);
      const apex = pushRing(
        x[last] + (dx / length) * cap,
        y[last] + (dy / length) * cap,
        Math.min(1, z[last] + (dz / length) * cap),
        birth[last] + BIRTH_EPSILON,
        0,
        last
      );
      rings.sides[apex] = 0;
      rings.linked[apex] = 0;
    }
    if (isStem) rings.birth[firstRing] = FIRST_RING_BIRTH;
    settleBirths(rings.birth, firstRing, rings.count);
    if (isStem) {
      frameRings(rings, firstRing, rings.count - 1, stemBend ? {lastTangent: stemBend} : undefined);
      // The apex shares the last ring's frame, and sits inside the scaffold that goes on from it.
      const apex = rings.count - 1;
      rings.nx[apex] = rings.nx[apex - 1];
      rings.ny[apex] = rings.ny[apex - 1];
      rings.nz[apex] = rings.nz[apex - 1];
      rings.bx[apex] = rings.bx[apex - 1];
      rings.by[apex] = rings.by[apex - 1];
      rings.bz[apex] = rings.bz[apex - 1];
      stemEndNormal = [rings.nx[apex], rings.ny[apex], rings.nz[apex]];
    } else if (continuesStem) {
      frameRings(rings, firstRing, rings.count, {
        firstTangent: stemBend,
        firstNormal: stemEndNormal
      });
    } else if (isCollared) {
      // Bark u starts in the crotch of the fork, where a collar's seam is darkest.
      const parentRing = socketRing;
      const before = rings.previous[parentRing];
      const after = rings.linked[parentRing] ? parentRing + 1 : parentRing;
      frameRings(rings, firstRing, rings.count, {
        firstNormal: [
          rings.x[after] - rings.x[before >= 0 ? before : parentRing],
          rings.y[after] - rings.y[before >= 0 ? before : parentRing],
          rings.z[after] - rings.z[before >= 0 ? before : parentRing]
        ]
      });
      joints.collars.push({socketRing: parentRing, firstRing, endRing: rings.count});
    } else {
      frameRings(rings, firstRing, rings.count);
    }
  }
  return ringOfNode;
}

/** A thick child's join to its parent, dressed by `addCollars`. */
type CollarRequest = {
  socketRing: number;
  /** The child's tube, as rings from this one up to but not including the end. */
  firstRing: number;
  endRing: number;
};

/** What `addCollars` needs to know of the tubes that `buildChainRings` made. */
type WoodJoints = {
  collars: CollarRequest[];
  /** The stem's last ring, and the first of the scaffold that goes on from it as one piece of wood. */
  stemEnd: number;
  leaderFirst: number;
};

/**
 * Dresses each thick fork with a collar, a tube of its own over the join. Its first ring lies just
 * under
 * the parent's surface around where the child comes out, and is the parent's there: its vertices
 * stand on
 * the parent's axis, so their radials are its normals and their widths its radius, and they have
 * its bark
 * u, bark v, seed and shade. Its last ring is the child's in the same way. Between them each vertex
 * follows a
 * fillet, tangent to the parent where it leaves and to the child where it arrives. So where the
 * wood of a
 * fork meets there is no crease, step or change of bark to see, but for the wrinkles a fillet's
 * tighter
 * radius brings, as on a real branch collar.
 *
 * All the centers of a collar's first half lie on the parent's axis, those of its second half on
 * the child's,
 * and those of its middle ring at the socket, where the axes meet. So a young, thin collar is a
 * thin tube
 * along those axes, inside the wood, and never a web across the crotch. As wood thickens, it grows
 * with the
 * wood and fits the fork of that age.
 */
function addCollars(context: GrowthContext, joints: WoodJoints, rings: WoodRings): void {
  const ratio = context.profile.trunkRatio;
  const {x, y, z, nx, ny, nz, bx, by, bz, barkV, radius, birth, previous, linked, sides} = rings;

  /** The next ring up a piece of wood, or -1. The stem goes on as its last scaffold. */
  const getNextRing = (ring: number): number => {
    if (ring === joints.stemEnd) return joints.leaderFirst + 1;
    return linked[ring] && sides[ring + 1] > 0 ? ring + 1 : -1;
  };
  // The nearest point on a tube's axis, from `findOnAxis`: the rings it is between, how far, and
  // where.
  let onLow = 0;
  let onHigh = 0;
  let onT = 0;
  let onX = 0;
  let onY = 0;
  let onZ = 0;
  const findOnAxis = (start: number, reach: number, px: number, py: number, pz: number): void => {
    let best = Infinity;
    const test = (low: number, high: number): number => {
      const ex = x[high] - x[low];
      const ey = y[high] - y[low];
      const ez = z[high] - z[low];
      const squared = ex * ex + ey * ey + ez * ez;
      const t =
        squared > 1e-16
          ? clamp(((px - x[low]) * ex + (py - y[low]) * ey + (pz - z[low]) * ez) / squared, 0, 1)
          : 0;
      const qx = x[low] + ex * t;
      const qy = y[low] + ey * t;
      const qz = z[low] + ez * t;
      const distance = (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
      if (distance < best) {
        best = distance;
        onLow = low;
        onHigh = high;
        onT = t;
        onX = qx;
        onY = qy;
        onZ = qz;
      }
      return Math.sqrt(squared);
    };
    let walked = 0;
    for (let low = start, high = getNextRing(low); high >= 0 && walked < reach; ) {
      walked += test(low, high);
      low = high;
      high = getNextRing(low);
    }
    // Down to the tube's first ring, as a center past that would make a web to the wood it grew
    // from. The
    // stem and its last scaffold are one piece of wood.
    walked = 0;
    for (let high = start, low = previous[high]; low >= 0 && walked < reach; ) {
      if (rings.chain[low] !== rings.chain[high] && high !== joints.leaderFirst) break;
      walked += test(low, high);
      high = low;
      low = previous[high];
    }
  };

  for (const {socketRing, firstRing, endRing} of joints.collars) {
    const sx = x[socketRing];
    const sy = y[socketRing];
    const sz = z[socketRing];
    const childRadius = radius[firstRing] * ratio;
    const parentRadius = radius[socketRing] * ratio;
    let dx = x[firstRing + 1] - sx;
    let dy = y[firstRing + 1] - sy;
    let dz = z[firstRing + 1] - sz;
    const firstLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (firstLength < 1e-6) continue;
    dx /= firstLength;
    dy /= firstLength;
    dz /= firstLength;
    // How far the child runs on straight: its surface is known only there.
    let room = firstLength;
    let lastRing = firstRing + 1;
    for (let ring = firstRing + 1; ring + 2 < endRing; ring++) {
      const ex = x[ring + 1] - x[ring];
      const ey = y[ring + 1] - y[ring];
      const ez = z[ring + 1] - z[ring];
      const length = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (length > 1e-6 && (ex * dx + ey * dy + ez * dz) / length < 0.985) break;
      room = Math.hypot(x[ring + 1] - sx, y[ring + 1] - sy, z[ring + 1] - sz);
      lastRing = ring + 1;
    }
    if (room < childRadius * 0.8) continue;
    // Along the parent at the socket, and for the rings that keep to its axis.
    const up = getNextRing(socketRing);
    const down = previous[socketRing];
    let ax = (up >= 0 ? x[up] : sx) - (down >= 0 ? x[down] : sx);
    let ay = (up >= 0 ? y[up] : sy) - (down >= 0 ? y[down] : sy);
    let az = (up >= 0 ? z[up] : sz) - (down >= 0 ? z[down] : sz);
    const axisLength = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= axisLength;
    ay /= axisLength;
    az /= axisLength;

    const side0 = Math.max(10, Math.min(20, getRingSides((childRadius * 1.6) / ratio)));
    const steps = childRadius / ratio >= 0.1 ? 6 : 4;
    const middle = steps >> 1;
    const count = side0 + 1;
    const exitRadius = Math.min(childRadius, parentRadius * 0.92);
    const fillet = Math.min(childRadius * 1.1, parentRadius * 0.75);
    const farthest = Math.min(room * 0.8, parentRadius * 3.2);
    const walk = parentRadius * 5 + fillet;
    const inset =
      0.975 -
      0.03 * smoothstep(0.08, 0.4, radius[socketRing]) -
      0.1 * Math.max(rings.flute[socketRing], up >= 0 ? rings.flute[up] : 0);

    // Foot on the parent, corner, and end on the child, of the fillet on each side.
    const points = new Float64Array((steps + 1) * count * 3);
    const feet = new Float64Array(count * 6);
    const ends = new Float64Array(count * 6);
    const nx0 = nx[firstRing];
    const ny0 = ny[firstRing];
    const nz0 = nz[firstRing];
    const bx0 = bx[firstRing];
    const by0 = by[firstRing];
    const bz0 = bz[firstRing];
    let latest = birth[firstRing];
    let lastU = 0;
    for (let side = 0; side < count; side++) {
      const angle = ((side % side0) / side0) * TWO_PI;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const ux = nx0 * cosine + bx0 * sine;
      const uy = ny0 * cosine + by0 * sine;
      const uz = nz0 * cosine + bz0 * sine;
      // Where the child's surface comes out of the parent's.
      const stride = Math.max(exitRadius * 0.35, parentRadius * 0.2);
      const isOutside = (s: number): boolean => {
        const px = sx + dx * s + ux * exitRadius;
        const py = sy + dy * s + uy * exitRadius;
        const pz = sz + dz * s + uz * exitRadius;
        findOnAxis(socketRing, walk, px, py, pz);
        const surface = lerp(radius[onLow], radius[onHigh], onT) * ratio;
        return (px - onX) ** 2 + (py - onY) ** 2 + (pz - onZ) ** 2 > surface * surface;
      };
      let high = 0;
      while (high < farthest && !isOutside(high)) high += stride;
      high = Math.min(high, farthest);
      let low = Math.max(0, high - stride);
      for (let halving = 0; halving < 4; halving++) {
        const mid = (low + high) / 2;
        if (isOutside(mid)) high = mid;
        else low = mid;
      }
      const exit = high;
      const kx = sx + dx * exit + ux * exitRadius;
      const ky = sy + dy * exit + uy * exitRadius;
      const kz = sz + dz * exit + uz * exitRadius;
      findOnAxis(socketRing, walk, kx, ky, kz);
      let cornerX = kx - onX;
      let cornerY = ky - onY;
      let cornerZ = kz - onZ;
      const cornerLength =
        Math.sqrt(cornerX * cornerX + cornerY * cornerY + cornerZ * cornerZ) || 1;
      cornerX /= cornerLength;
      cornerY /= cornerLength;
      cornerZ /= cornerLength;
      // The way on over the parent's surface, away from the child.
      const facing = ux * cornerX + uy * cornerY + uz * cornerZ;
      let ox = ux - cornerX * facing;
      let oy = uy - cornerY * facing;
      let oz = uz - cornerZ * facing;
      const oLength = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (oLength > 1e-3) {
        ox /= oLength;
        oy /= oLength;
        oz /= oLength;
      } else {
        ox = 0;
        oy = 0;
        oz = 0;
      }
      // The foot lies on the parent as it is there, a little under its surface.
      const fx0 = kx + ox * fillet;
      const fy0 = ky + oy * fillet;
      const fz0 = kz + oz * fillet;
      findOnAxis(socketRing, walk, fx0, fy0, fz0);
      let wx = fx0 - onX;
      let wy = fy0 - onY;
      let wz = fz0 - onZ;
      const wLength = Math.sqrt(wx * wx + wy * wy + wz * wz);
      if (wLength > 1e-9) {
        wx /= wLength;
        wy /= wLength;
        wz /= wLength;
      } else {
        wx = cornerX;
        wy = cornerY;
        wz = cornerZ;
      }
      const footRing = onT < 0.5 ? onLow : onHigh;
      const footRadius = lerp(radius[onLow], radius[onHigh], onT) * ratio;
      const footX = onX + wx * footRadius * inset;
      const footY = onY + wy * footRadius * inset;
      const footZ = onZ + wz * footRadius * inset;
      let footU =
        Math.atan2(
          wx * bx[footRing] + wy * by[footRing] + wz * bz[footRing],
          wx * nx[footRing] + wy * ny[footRing] + wz * nz[footRing]
        ) / TWO_PI;
      // Runs on around the loop, from a start in 0 to 1.
      footU += side > 0 ? Math.round(lastU - footU) : footU < 0 ? 1 : 0;
      lastU = footU;
      const footV = lerp(barkV[onLow], barkV[onHigh], onT);
      latest = Math.max(latest, birth[onHigh]);
      feet[side * 6] = wx;
      feet[side * 6 + 1] = wy;
      feet[side * 6 + 2] = wz;
      feet[side * 6 + 3] = footRadius;
      feet[side * 6 + 4] = footU;
      feet[side * 6 + 5] = footV;

      // The end, on the child as it is there.
      const along = Math.min(exit + fillet * 1.15, room);
      let ring = firstRing;
      while (ring < lastRing && barkV[ring + 1] - barkV[firstRing] < along) ring++;
      const span = Math.max(barkV[ring + 1] - barkV[ring], 1e-9);
      const t = clamp((along - (barkV[ring] - barkV[firstRing])) / span, 0, 1);
      const endRadius = lerp(radius[ring], radius[ring + 1], t) * ratio;
      const tx = nx[ring] * cosine + bx[ring] * sine;
      const ty = ny[ring] * cosine + by[ring] * sine;
      const tz = nz[ring] * cosine + bz[ring] * sine;
      const reachOut = endRadius * 0.992;
      const endX = lerp(x[ring], x[ring + 1], t) + tx * reachOut;
      const endY = lerp(y[ring], y[ring + 1], t) + ty * reachOut;
      const endZ = lerp(z[ring], z[ring + 1], t) + tz * reachOut;
      latest = Math.max(latest, birth[ring + 1]);
      ends[side * 6] = tx;
      ends[side * 6 + 1] = ty;
      ends[side * 6 + 2] = tz;
      ends[side * 6 + 3] = endRadius;
      ends[side * 6 + 4] = side / side0;
      ends[side * 6 + 5] = barkV[firstRing] + along;

      // The corner stands off a little, so a fork swells where it meets rather than pinching in.
      const swell = childRadius * 0.08;
      let outX = cornerX + ux;
      let outY = cornerY + uy;
      let outZ = cornerZ + uz;
      const outLength = Math.sqrt(outX * outX + outY * outY + outZ * outZ) || 1;
      outX = kx + (outX / outLength) * swell;
      outY = ky + (outY / outLength) * swell;
      outZ = kz + (outZ / outLength) * swell;
      for (let step = 0; step <= steps; step++) {
        const s = step / steps;
        const a = (1 - s) * (1 - s);
        const m = 2 * s * (1 - s);
        const c = s * s;
        const at = (step * count + side) * 3;
        points[at] = a * footX + m * outX + c * endX;
        points[at + 1] = a * footY + m * outY + c * endY;
        points[at + 2] = a * footZ + m * outZ + c * endZ;
      }
    }

    // The rings, with normals from the surface they make, those at either end the wood's own.
    const first = rings.count;
    // How far the collar's centers leave a straight line along the parent, where the parent bends.
    let sag = 0;
    for (let step = 0; step <= steps; step++) {
      const isSecond = step > middle;
      const s = step / steps;
      const ring = rings.count++;
      const shape = new Float64Array(count * SHAPED_STRIDE);
      rings.shaped.set(ring, shape);
      const lower = Math.max(step - 1, 0) * count * 3;
      const upper = Math.min(step + 1, steps) * count * 3;
      const here = step * count * 3;
      let centerX = 0;
      let centerY = 0;
      let centerZ = 0;
      const toSurface = smoothstep(0, 0.34, s);
      const toChild = smoothstep(0.66, 1, s);
      for (let side = 0; side < count; side++) {
        const wrapped = side % side0;
        const before = ((wrapped + side0 - 1) % side0) * 3;
        const after = ((wrapped + 1) % side0) * 3;
        const along = wrapped * 3;
        const sideX = points[here + after] - points[here + before];
        const sideY = points[here + after + 1] - points[here + before + 1];
        const sideZ = points[here + after + 2] - points[here + before + 2];
        const runX = points[upper + along] - points[lower + along];
        const runY = points[upper + along + 1] - points[lower + along + 1];
        const runZ = points[upper + along + 2] - points[lower + along + 2];
        let rx = sideY * runZ - sideZ * runY;
        let ry = sideZ * runX - sideX * runZ;
        let rz = sideX * runY - sideY * runX;
        const footAt = side * 6;
        const blendX = lerp(feet[footAt], ends[footAt], s);
        const blendY = lerp(feet[footAt + 1], ends[footAt + 1], s);
        const blendZ = lerp(feet[footAt + 2], ends[footAt + 2], s);
        const size = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        const sign = rx * blendX + ry * blendY + rz * blendZ < 0 ? -1 / size : 1 / size;
        rx = lerp(lerp(feet[footAt], rx * sign, toSurface), ends[footAt], toChild);
        ry = lerp(lerp(feet[footAt + 1], ry * sign, toSurface), ends[footAt + 1], toChild);
        rz = lerp(lerp(feet[footAt + 2], rz * sign, toSurface), ends[footAt + 2], toChild);
        const length = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        rx /= length;
        ry /= length;
        rz /= length;
        const px = points[here + side * 3];
        const py = points[here + side * 3 + 1];
        const pz = points[here + side * 3 + 2];
        // This vertex's center: on the axis of this half of the collar, where its normal would meet
        // it. So
        // that it is exactly on the axis, the normal then points from there.
        let width: number;
        if (step === 0) {
          width = feet[footAt + 3];
        } else if (step === steps) {
          width = ends[footAt + 3];
        } else {
          const tx = isSecond ? dx : ax;
          const ty = isSecond ? dy : ay;
          const tz = isSecond ? dz : az;
          const ox = px - sx;
          const oy = py - sy;
          const oz = pz - sz;
          const cosine = rx * tx + ry * ty + rz * tz;
          const ahead = ox * tx + oy * ty + oz * tz;
          const out = ox * rx + oy * ry + oz * rz;
          const off = 1 - cosine * cosine;
          const reach = Math.sqrt(ox * ox + oy * oy + oz * oz);
          const met = off > 0.02 ? (out - cosine * ahead) / off : reach;
          const onAxis =
            step === middle
              ? 0
              : clamp(ahead - cosine * met, isSecond ? 0 : -parentRadius * 1.2, Math.max(ahead, 0));
          let ax0 = sx + tx * onAxis;
          let ay0 = sy + ty * onAxis;
          let az0 = sz + tz * onAxis;
          if (!isSecond && step !== middle) {
            // The parent may bend or end, and its wood is the only place for a center to hide.
            findOnAxis(socketRing, walk, ax0, ay0, az0);
            ax0 = onX;
            ay0 = onY;
            az0 = onZ;
          }
          rx = px - ax0;
          ry = py - ay0;
          rz = pz - az0;
          width = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1e-6;
          rx /= width;
          ry /= width;
          rz /= width;
        }
        const cx = px - rx * width;
        const cy = py - ry * width;
        const cz = pz - rz * width;
        if (!isSecond) {
          const fromX = cx - sx;
          const fromY = cy - sy;
          const fromZ = cz - sz;
          const along = fromX * ax + fromY * ay + fromZ * az;
          sag = Math.max(
            sag,
            Math.hypot(fromX - ax * along, fromY - ay * along, fromZ - az * along)
          );
        }
        if (side === 0) {
          centerX = cx;
          centerY = cy;
          centerZ = cz;
        }
        const crotch = smoothstep(
          -0.2,
          0.85,
          (nx0 * Math.cos((wrapped / side0) * TWO_PI) +
            bx0 * Math.sin((wrapped / side0) * TWO_PI)) *
            ax +
            (ny0 * Math.cos((wrapped / side0) * TWO_PI) +
              by0 * Math.sin((wrapped / side0) * TWO_PI)) *
              ay +
            (nz0 * Math.cos((wrapped / side0) * TWO_PI) +
              bz0 * Math.sin((wrapped / side0) * TWO_PI)) *
              az
        );
        const at = side * SHAPED_STRIDE;
        shape[at] = rx;
        shape[at + 1] = ry;
        shape[at + 2] = rz;
        shape[at + 3] = width / ratio;
        shape[at + 4] = lerp(feet[footAt + 4], ends[footAt + 4], s);
        shape[at + 5] = lerp(feet[footAt + 5], ends[footAt + 5], s);
        // A soft darkening in the crease, the deeper in a crotch.
        shape[at + 6] = 1 - 4 * s * (1 - s) * (0.08 + 0.3 * crotch);
        shape[at + 7] = cx - centerX;
        shape[at + 8] = cy - centerY;
        shape[at + 9] = cz - centerZ;
      }
      rings.x[ring] = centerX;
      rings.y[ring] = centerY;
      rings.z[ring] = centerZ;
      rings.radius[ring] = radius[firstRing];
      rings.previous[ring] = step > 0 ? ring - 1 : -1;
      rings.linked[ring] = step < steps ? 1 : 0;
      rings.nx[ring] = nx0;
      rings.ny[ring] = ny0;
      rings.nz[ring] = nz0;
      rings.bx[ring] = bx0;
      rings.by[ring] = by0;
      rings.bz[ring] = bz0;
      rings.sides[ring] = side0;
      rings.barkV[ring] = shape[5];
      // All of it goes with the child when the child breaks.
      rings.outer[ring] = rings.outer[firstRing + 1];
      rings.inner[ring] = rings.inner[firstRing + 1];
      rings.order[ring] = rings.order[firstRing];
      rings.seed[ring] = lerp(rings.seed[socketRing], rings.seed[firstRing], s);
      rings.flags[ring] = TREE_WOOD_FLAG.COLLAR;
      rings.occlusion[ring] = lerp(rings.occlusion[socketRing], rings.occlusion[firstRing], s);
      rings.chain[ring] = -1;
      rings.flute[ring] = 0;
    }
    // Wood too thin to show a collar has none yet, and a parent must be thick enough to hide a bend
    // in the
    // line of the collar's centers, which would otherwise span a web across it.
    let start = Math.max(latest + BIRTH_EPSILON, COLLAR_FIRST_BIRTH);
    const parentRing = socketRing;
    while (
      start < 0.9 &&
      getTreeRingRadius(radius[parentRing], birth[parentRing], start) * ratio < sag * 1.2
    ) {
      start += 0.01;
    }
    start = Math.min(start, LAST_RING_BIRTH - (steps + 3) * BIRTH_EPSILON);
    for (let step = 0; step <= steps; step++) {
      rings.birth[first + step] = start + step * BIRTH_EPSILON;
      rings.since[first + step] = start - BIRTH_EPSILON;
    }
    settleBirths(rings.birth, first, rings.count);
  }
}

type TubeStyle = {
  order: number;
  flags: number;
  seed: number;
  outer: number;
  inner: number;
  occlusion: number;
};

/**
 * Adds an authored tube from a socket ring. Points are xyz triples, and the first must be the
 * socket's center unless the tube is meant to start off-axis. A last radius of 0 closes it to an
 * apex.
 */
function addTube(
  rings: WoodRings,
  socket: number,
  points: number[],
  radii: number[],
  births: number[],
  style: TubeStyle
): number {
  const first = rings.count;
  let arc = socket >= 0 ? rings.barkV[socket] : 0;
  for (let index = 0; index < radii.length; index++) {
    const ring = rings.count++;
    rings.x[ring] = points[index * 3];
    rings.y[ring] = points[index * 3 + 1];
    rings.z[ring] = points[index * 3 + 2];
    rings.birth[ring] = births[index];
    rings.radius[ring] = radii[index];
    rings.previous[ring] = index > 0 ? ring - 1 : socket;
    rings.linked[ring] = index < radii.length - 1 ? 1 : 0;
    if (index > 0) {
      arc += Math.hypot(
        points[index * 3] - points[index * 3 - 3],
        points[index * 3 + 1] - points[index * 3 - 2],
        points[index * 3 + 2] - points[index * 3 - 1]
      );
    }
    rings.barkV[ring] = arc;
    rings.outer[ring] = style.outer;
    rings.inner[ring] = style.inner;
    rings.order[ring] = style.order;
    rings.seed[ring] = style.seed;
    rings.flags[ring] = style.flags;
    rings.occlusion[ring] = style.occlusion;
    rings.chain[ring] = -1;
    rings.sides[ring] = radii[index] > 0 ? getRingSides(radii[index]) : 0;
  }
  if (socket >= 0) {
    rings.birth[first] = Math.max(rings.birth[first], rings.birth[socket] + BIRTH_EPSILON);
  }
  settleBirths(rings.birth, first, rings.count);
  frameRings(rings, first, rings.count);
  return first;
}

/** Azimuths and sizes of the lateral roots, which also shape the trunk's root flare. */
type RootFlare = {azimuth: Float64Array; strength: Float64Array};

/**
 * Lateral surface roots and a taproot, collapsed onto the trunk base by the vertex stage until the
 * tree leans. Each reaches past the plate of soil a falling tree tears out, and ends where it
 * snapped,
 * sinks slowly, sometimes forks, and has fine root stubs along it, also snapped.
 */
function addRoots(context: GrowthContext, rings: WoodRings, stemBase: number): RootFlare {
  const {profile} = context;
  const rng = createStream(context.seed, 0x4007);
  const ratio = profile.trunkRatio;
  const [fewest, most] = profile.roots;
  const count = fewest + Math.floor(rng() * (most - fewest + 1));
  const gaps = drawUnequalGaps(rng, count, 1.4);
  const azimuths = new Float64Array(count);
  const strengths = new Float64Array(count);
  let azimuth = rng() * TWO_PI;
  const baseX = rings.x[stemBase];
  const baseY = rings.y[stemBase];
  const baseZ = rings.z[stemBase];

  /**
   * A short thin root from a ring, or from a point on its way, broken off: it tapers, kinks at each of the knots it
   * grew round in the soil, and ends in a blunt torn tip. Returns its first ring.
   */
  const layStub = (
    socket: number,
    heading: number,
    thickness: number,
    reach: number,
    start?: readonly [number, number, number]
  ): number => {
    let px = start ? start[0] : rings.x[socket];
    let py = start ? start[1] : rings.y[socket];
    let pz = start ? start[2] : rings.z[socket];
    const dip = (rng() - 0.25) * 0.9;
    const segment = (reach * ratio) / STUB_KINKS;
    const points = [px, py, pz];
    const radii = [thickness];
    const born = rings.birth[socket] + 0.004;
    const births = [born];
    let way = heading;
    let fall = dip;
    for (let kink = 1; kink <= STUB_KINKS; kink++) {
      px += Math.cos(way) * segment;
      py += Math.sin(way) * segment;
      pz = Math.min(0, pz - fall * segment);
      points.push(px, py, pz);
      radii.push(thickness * (1 - 0.62 * (kink / STUB_KINKS)));
      births.push(born + 0.001 * kink);
      way += (rng() - 0.5) * 1.3;
      fall += (rng() - 0.5) * 0.8;
    }
    points.push(
      px + Math.cos(way) * thickness * ratio * 0.7,
      py + Math.sin(way) * thickness * ratio * 0.7,
      Math.min(0, pz)
    );
    radii.push(0);
    births.push(born + 0.001 * STUB_KINKS + 0.0005);
    return addTube(rings, socket, points, radii, births, {
      order: 3,
      flags: TREE_WOOD_FLAG.ROOT,
      seed: rng(),
      outer: 0,
      inner: 0,
      occlusion: 0.4
    });
  };

  const layRoot = (
    socket: number,
    startX: number,
    startY: number,
    startZ: number,
    heading: number,
    length: number,
    // As long as it would be past the rim of a plate of four trunk radii, which says how many rings it has and how
    // deep it sinks: the wider plate spaces them out, so that a far tree draws no more wood for it.
    ringLength: number,
    thickness: number,
    sink: number,
    allowFork: boolean,
    startBirth: number
  ): void => {
    const steps = Math.max(5, Math.round(ringLength / (ratio * 0.7)));
    const sinkPerLength = (sink * ringLength) / length;
    const points: number[] = [];
    const radii: number[] = [];
    const births: number[] = [];
    const wave = 4 + rng() * 5;
    const phase = rng() * TWO_PI;
    const swing = 0.22 + rng() * 0.3;
    let px = startX;
    let py = startY;
    let pz = startZ;
    let forkAt = allowFork && rng() < 0.75 ? 2 + Math.floor(rng() * (steps - 3)) : -1;
    const seed = rng();
    let forkSocket = -1;
    let forkX = 0;
    let forkY = 0;
    let forkZ = 0;
    let forkRadius = 0;
    let forkHeading = 0;
    let forkBirth = 0;
    // It tapers toward a tip it never reaches: it snapped on the way.
    const snapped = 0.5 + rng() * 0.3;
    for (let index = 0; index <= steps; index++) {
      const t = (index / steps) * snapped;
      points.push(px, py, pz);
      radii.push(thickness * Math.pow(1 - t, 0.9) + 0.02 * (1 - t * t));
      births.push(Math.min(0.92, startBirth + getTreeGrowthAtCrown(t * 0.95) * (1 - startBirth)));
      if (index === forkAt) {
        forkX = px;
        forkY = py;
        forkZ = pz;
        forkRadius = radii[index] * 0.62;
        forkHeading = heading + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.6);
        forkBirth = births[index];
        forkAt = -1;
        forkSocket = rings.count + index;
      }
      const turn = heading + swing * Math.sin((t / snapped) * wave + phase);
      const stride = length / steps;
      px += Math.cos(turn) * stride;
      py += Math.sin(turn) * stride;
      pz -= sinkPerLength * stride * (0.5 + t);
    }
    // The torn end: a short ragged closure, a little way on from the last ring.
    const endRadius = radii[steps];
    const last = points.length - 3;
    const short = Math.min(1, (0.6 * ratio * steps) / length);
    points.push(
      points[last] + (px - points[last]) * short,
      points[last + 1] + (py - points[last + 1]) * short,
      points[last + 2] + (pz - points[last + 2]) * short - endRadius * ratio * 0.3
    );
    radii.push(0);
    births.push(Math.min(0.92, births[steps]) + 0.001);
    const first = rings.count;
    addTube(rings, socket, points, radii, births, {
      order: socket === stemBase ? 1 : 2,
      flags: TREE_WOOD_FLAG.ROOT,
      seed,
      outer: 0,
      inner: 0,
      occlusion: 0.42
    });
    // Fine roots along it, thickest toward its end, where the most of them stand out of the torn
    // soil.
    const stubs = 2 + Math.floor(steps * (0.5 + rng() * 0.6));
    for (let stub = 0; stub < stubs; stub++) {
      const along = Math.sqrt(rng());
      const ring = first + 1 + Math.floor(along * (steps - 1));
      const side = heading + (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 1.5);
      layStub(ring, side, 0.018 + rng() * rng() * 0.05, 0.4 + rng() * 1.2);
    }
    if (forkSocket >= 0) {
      const share = 0.3 + rng() * 0.25;
      layRoot(
        forkSocket,
        forkX,
        forkY,
        forkZ,
        forkHeading,
        length * share,
        ringLength * share,
        forkRadius,
        sink * 1.2,
        false,
        forkBirth
      );
    }
  };

  for (let root = 0; root < count; root++) {
    const thickness = 0.2 + rng() * rng() * 0.26;
    azimuths[root] = azimuth;
    strengths[root] = thickness / 0.46;
    // Past the rim of the plate of soil, by not much, where it snapped.
    const reach = rng();
    const length = ratio * (TREE_ROOT_PLATE_RADII * 1.04 + reach * 2.2 + thickness * 1.6);
    layRoot(
      stemBase,
      baseX,
      baseY,
      baseZ,
      azimuth,
      length,
      ratio * (4.3 + reach * 1.5 + thickness * 1.6),
      thickness,
      0.12 + rng() * 0.22,
      true,
      0
    );
    azimuth += gaps[root] * TWO_PI;
  }
  // The taproot closes the trunk from below, and snapped just under the plate of soil.
  const depth = ratio * (TREE_ROOT_PLATE_THICKNESS * 1.05 + rng() * 0.4);
  const tap = addTube(
    rings,
    stemBase,
    [
      baseX,
      baseY,
      baseZ,
      baseX + ratio * 0.08,
      baseY - ratio * 0.05,
      baseZ - depth * 0.45,
      baseX + ratio * 0.14,
      baseY + ratio * 0.03,
      baseZ - depth * 0.8,
      baseX + ratio * 0.15,
      baseY + ratio * 0.08,
      baseZ - depth,
      baseX + ratio * 0.15,
      baseY + ratio * 0.08,
      baseZ - depth - ratio * 0.07
    ],
    [0.62, 0.48, 0.34, 0.26, 0],
    [FIRST_RING_BIRTH, 0.08, 0.3, 0.6, 0.61],
    {
      order: 1,
      flags: TREE_WOOD_FLAG.ROOT,
      seed: rng(),
      outer: 0,
      inner: 0,
      occlusion: 0.35
    }
  );
  // Roots the plate tore through stand out of its rim all round it, short, kinked and torn off. Only the finest
  // level of detail draws them, so a far tree draws no more wood for them.
  for (let stub = 0; stub < RIM_STUBS; stub++) {
    const around = ((stub + rng() * 0.7) / RIM_STUBS) * TWO_PI;
    const out = (0.9 + rng() * 0.08) * TREE_ROOT_PLATE_RADII * ratio;
    const first = layStub(
      tap + 1,
      around + (rng() - 0.5) * 0.7,
      0.05 + rng() * rng() * 0.15,
      1.2 + rng() * 2.8,
      [
        baseX + Math.cos(around) * out,
        baseY + Math.sin(around) * out,
        baseZ - (0.16 + rng() * 0.2) * TREE_ROOT_PLATE_THICKNESS * ratio
      ]
    );
    rings.fine.fill(1, first, rings.count);
  }
  return {azimuth: azimuths, strength: strengths};
}

/**
 * The shape of the plate of soil a falling tree tears out, from around the trunk over the top to the rim and in
 * again below: radius as a share of the plate's, and height as a share of its thickness. The top is the old
 * ground, nearly flat, and the root mat below it is thickest under the trunk and thins to a torn rim.
 */
const SOIL_SHAPE: readonly (readonly [number, number])[] = [
  [0.056, 0.031],
  [0.09, 0.038],
  [0.145, 0.041],
  [0.22, 0.038],
  [0.31, 0.031],
  [0.42, 0.02],
  [0.53, 0.008],
  [0.64, -0.008],
  [0.745, -0.026],
  [0.836, -0.046],
  [0.91, -0.072],
  [0.964, -0.108],
  [1, -0.159],
  [1.014, -0.231],
  [1.009, -0.308],
  [0.986, -0.385],
  [0.936, -0.456],
  [0.864, -0.526],
  [0.773, -0.595],
  [0.664, -0.667],
  [0.545, -0.738],
  [0.427, -0.808],
  [0.309, -0.872],
  [0.2, -0.923],
  [0.109, -0.962],
  [0.045, -0.979],
  [0, -0.987]
];
/** The stations of the plate: radius and height, both in trunk radii. */
const SOIL_STATIONS = SOIL_SHAPE.map(
  ([radius, height]) =>
    [radius * TREE_ROOT_PLATE_RADII, height * TREE_ROOT_PLATE_THICKNESS] as const
);
/** Sides of a ring of the soil plate. */
const SOIL_SIDES = 128;

/** The stations of the plate that far trees draw, the same shape within the fine one. */
const SOIL_FAR_STATIONS = (
  [
    [0.16, -0.13],
    [0.42, -0.13],
    [0.67, -0.15],
    [0.82, -0.26],
    [0.75, -0.48],
    [0.47, -0.68],
    [0, -0.79]
  ] as const
).map(
  ([radius, height]) =>
    [radius * TREE_ROOT_PLATE_RADII, height * TREE_ROOT_PLATE_THICKNESS] as const
);

/**
 * The rough plate of soil a falling tree tears out, a closed lens around the trunk base, in
 * triangles about
 * as wide as they are long. A plate of a few polygons stays inside it for far trees, whose levels
 * of detail
 * do not reach the fine one.
 */
function addSoilPlate(context: GrowthContext, rings: WoodRings): void {
  const ratio = context.profile.trunkRatio;
  const rng = createStream(context.seed, 0x5011);
  const seed = rng();
  const addPlate = (stations: readonly (readonly [number, number])[], isFine: boolean): void =>
    stations.forEach(([radius, height], index) => {
      const ring = rings.count++;
      rings.x[ring] = 0;
      rings.y[ring] = 0;
      rings.z[ring] = height * ratio;
      rings.birth[ring] = FIRST_RING_BIRTH + index * BIRTH_EPSILON;
      rings.radius[ring] = radius;
      rings.previous[ring] = -1;
      rings.linked[ring] = index < stations.length - 1 ? 1 : 0;
      rings.nx[ring] = 1;
      rings.ny[ring] = 0;
      rings.nz[ring] = 0;
      // Clockwise seen from above, since the plate's rings run outward, not along a tube.
      rings.bx[ring] = 0;
      rings.by[ring] = -1;
      rings.bz[ring] = 0;
      rings.sides[ring] =
        radius <= 0 ? 0 : isFine ? clamp(Math.round(radius * 20), 16, SOIL_SIDES) : 24;
      rings.fine[ring] = isFine ? 1 : 0;
      rings.barkV[ring] = radius * ratio;
      rings.outer[ring] = 0;
      rings.inner[ring] = 0;
      rings.order[ring] = 0;
      rings.seed[ring] = seed;
      rings.flags[ring] = TREE_WOOD_FLAG.SOIL;
      rings.occlusion[ring] = 0.55;
      rings.chain[ring] = -1;
    });
  addPlate(SOIL_STATIONS, true);
  addPlate(SOIL_FAR_STATIONS, false);
}

/** Arching stilt roots of a mangrove, from the lower trunk down into the mud. */
function addStiltRoots(context: GrowthContext, rings: WoodRings, ringOfNode: Int32Array): void {
  const {profile, nodes, envelope} = context;
  const rng = createStream(context.seed, 0x5711);
  const count = profile.stiltRoots;
  if (count === 0) return;
  let stemEnd = 0;
  while (stemEnd + 1 < nodes.count && nodes.shoot[stemEnd + 1] === 0) stemEnd++;
  const gaps = drawUnequalGaps(rng, count, 1.3);
  let azimuth = rng() * TWO_PI;
  for (let root = 0; root < count; root++) {
    const target = lerp(0.05, context.forkZ * 0.95, rng());
    let socket = 0;
    while (socket < stemEnd && nodes.z[socket] < target) socket++;
    const sx = nodes.x[socket];
    const sy = nodes.y[socket];
    const sz = nodes.z[socket];
    const reach = envelope.width * (0.32 + rng() * 0.34);
    const arch = 0.03 + rng() * 0.05;
    const swing = (rng() - 0.5) * 0.5;
    const steps = 14;
    const points: number[] = [];
    const radii: number[] = [];
    const births: number[] = [];
    const start = Math.max(nodes.birth[socket] + 0.02, 0.1 + rng() * 0.12);
    for (let index = 0; index <= steps; index++) {
      const t = index / steps;
      const turn = azimuth + swing * Math.sin(t * Math.PI);
      const out = reach * Math.pow(t, 0.85);
      points.push(
        sx + Math.cos(turn) * out,
        sy + Math.sin(turn) * out,
        lerp(sz, -0.012, t * t) + arch * Math.sin(t * Math.PI)
      );
      radii.push(index === steps ? 0 : lerp(0.2, 0.075, t) * (0.8 + 0.2 * Math.sin(t * 9 + root)));
      births.push(lerp(start, start + 0.34, t));
    }
    addTube(rings, ringOfNode[socket], points, radii, births, {
      order: 1,
      flags: 0,
      seed: rng(),
      outer: 0,
      inner: 0,
      occlusion: 0.7
    });
    azimuth += gaps[root] * TWO_PI;
  }
}

/** Aerial roots of a banyan, hanging from spreading limbs and thickening into pillars. */
function addAerialRoots(
  context: GrowthContext,
  rings: WoodRings,
  ringOfNode: Int32Array,
  pipe: PipeRadii,
  limbs: GrowthLimbs
): void {
  const {profile, nodes, envelope} = context;
  const count = profile.aerialRoots;
  if (count === 0) return;
  const rng = createStream(context.seed, 0xae21);
  const chosen: number[] = [];
  const spacing = envelope.width * 0.22;
  for (let attempt = 0; attempt < 2000 && chosen.length < count; attempt++) {
    const node = Math.floor(rng() * nodes.count);
    if (nodes.shoot[node] === 0 || ringOfNode[node] < 0 || nodes.birth[node] > 0.7) continue;
    if (pipe.radius[node] < 0.05 || pipe.radius[node] > 0.34) continue;
    const reach = Math.hypot(nodes.x[node], nodes.y[node]) / envelope.width;
    if (reach < 0.3 || reach > 0.88) continue;
    const isClear = chosen.every(
      other => Math.hypot(nodes.x[node] - nodes.x[other], nodes.y[node] - nodes.y[other]) > spacing
    );
    if (isClear) chosen.push(node);
  }
  for (const node of chosen) {
    const steps = Math.max(6, Math.round(nodes.z[node] / 0.04));
    const points: number[] = [];
    const radii: number[] = [];
    const births: number[] = [];
    const start = Math.max(nodes.birth[node] + 0.06, 0.35 + rng() * 0.2);
    const end = Math.min(0.985, start + 0.25);
    const driftX = (rng() - 0.5) * 0.03;
    const driftY = (rng() - 0.5) * 0.03;
    const thickness = Math.min(0.06 + rng() * 0.05, pipe.radius[node]);
    for (let index = 0; index <= steps; index++) {
      const t = index / steps;
      points.push(
        nodes.x[node] + driftX * Math.sin(t * Math.PI),
        nodes.y[node] + driftY * Math.sin(t * Math.PI),
        lerp(nodes.z[node], -0.012, t)
      );
      radii.push(index === steps ? 0 : lerp(thickness, thickness * 0.85, t));
      births.push(lerp(start, end, t));
    }
    addTube(rings, ringOfNode[node], points, radii, births, {
      order: 3,
      flags: 0,
      seed: rng(),
      outer: limbs.outer[node],
      inner: limbs.inner[node],
      occlusion: 0.55
    });
  }
}

/** Small thorns on young vigorous wood, as on a citrus shoot. */
function addThorns(context: GrowthContext, rings: WoodRings): void {
  const {profile} = context;
  const target = Math.round((profile.thorns * context.colonized) / 1000);
  if (target === 0) return;
  const rng = createStream(context.seed, 0x7409);
  const ratio = profile.trunkRatio;
  const end = rings.count;
  const candidates: number[] = [];
  for (let ring = 0; ring < end; ring++) {
    const isYoungWood = rings.radius[ring] >= 0.014 && rings.radius[ring] <= 0.07;
    if (
      isYoungWood &&
      rings.flags[ring] === 0 &&
      rings.sides[ring] > 0 &&
      rings.order[ring] >= 1 &&
      !rings.shaped.has(ring)
    ) {
      candidates.push(ring);
    }
  }
  if (candidates.length === 0) return;
  for (let thorn = 0; thorn < target; thorn++) {
    const socket = candidates[Math.floor(rng() * candidates.length)];
    const angle = rng() * TWO_PI;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const rx = rings.nx[socket] * cosine + rings.bx[socket] * sine;
    const ry = rings.ny[socket] * cosine + rings.by[socket] * sine;
    const rz = rings.nz[socket] * cosine + rings.bz[socket] * sine;
    // Along the shoot, the ring's frame gives the tangent.
    const tx = rings.ny[socket] * rings.bz[socket] - rings.nz[socket] * rings.by[socket];
    const ty = rings.nz[socket] * rings.bx[socket] - rings.nx[socket] * rings.bz[socket];
    const tz = rings.nx[socket] * rings.by[socket] - rings.ny[socket] * rings.bx[socket];
    // Rooted on the axis, so wood that thickens later simply engulfs its base.
    const length = rings.radius[socket] * ratio + 0.0016 + rng() * 0.0024;
    const px = rings.x[socket];
    const py = rings.y[socket];
    const pz = rings.z[socket];
    const lean = 0.35 + rng() * 0.4;
    const born = Math.min(LAST_NODE_BIRTH, rings.birth[socket] + 0.002 + rng() * 0.004);
    addTube(
      rings,
      socket,
      [
        px,
        py,
        pz,
        px + (rx + tx * lean) * length,
        py + (ry + ty * lean) * length,
        pz + (rz + tz * lean) * length
      ],
      [Math.min(rings.radius[socket] * 0.6, 0.009 + rng() * 0.005), 0],
      [born, born + 0.0006],
      {
        order: rings.order[socket] + 1,
        flags: TREE_WOOD_FLAG.THORN,
        seed: rng(),
        outer: rings.outer[socket],
        inner: rings.inner[socket],
        occlusion: rings.occlusion[socket]
      }
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Wood mesh
// ---------------------------------------------------------------------------------------------

const LOD_BIN_COUNT = 40;
const LOD_BIN_TOP = 2.2;
const LOD_BIN_STEP = Math.log(1.13);

function getLodBin(radius: number): number {
  return clamp(
    Math.floor(Math.log(LOD_BIN_TOP / Math.max(radius, 1e-3)) / LOD_BIN_STEP),
    0,
    LOD_BIN_COUNT - 2
  );
}

/** Smooth value noise in 0 to 1, for shaping soil. */
function getSoilNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const hash = (a: number, b: number): number => {
    let value = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + seed) | 0;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  };
  return lerp(
    lerp(hash(ix, iy), hash(ix + 1, iy), ux),
    lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), ux),
    uy
  );
}

/** Writes rings into vertex arrays, with indices sorted from the thickest wood to the finest. */
function writeWood(context: GrowthContext, rings: WoodRings, flare: RootFlare): TreeGrowthWood {
  const {profile} = context;
  const rng = createStream(context.seed, 0x3009);
  const scale = 1 / profile.crownAspect;
  const ratio = profile.trunkRatio;
  const {count, sides} = rings;

  const firstVertex = new Int32Array(count + 1);
  for (let ring = 0; ring < count; ring++) {
    firstVertex[ring + 1] = firstVertex[ring] + (sides[ring] > 0 ? sides[ring] + 1 : 1);
  }
  const vertexCount = firstVertex[count];
  const center = new Float32Array(vertexCount * 4);
  const previous = new Float32Array(vertexCount * 4);
  const radial = new Float32Array(vertexCount * 4);
  const bark = new Float32Array(vertexCount * 4);
  const shade = new Float32Array(vertexCount * 4);

  // Children thick enough to raise a shoulder on the limb they leave.
  const shoulders = new Map<number, number[]>();
  for (let ring = 1; ring < count; ring++) {
    const parent = rings.previous[ring];
    if (rings.chain[ring] < 0 || parent < 0 || parent === ring - 1) continue;
    if (rings.radius[ring] < 0.05 || rings.radius[parent] < 0.08) continue;
    // The scaffold that goes on from the stem has the same ring as its end, and no shoulder.
    if (rings.flute[ring] === 1) continue;
    const next = ring + 1;
    const dx = rings.x[next] - rings.x[ring];
    const dy = rings.y[next] - rings.y[ring];
    const dz = rings.z[next] - rings.z[ring];
    const length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const list = shoulders.get(rings.chain[parent]) ?? [];
    list.push(
      rings.barkV[parent],
      dx / length,
      dy / length,
      dz / length,
      0.06 * Math.min(1, rings.radius[ring] / rings.radius[parent])
    );
    shoulders.set(rings.chain[parent], list);
  }

  const fluteA = rng() * TWO_PI;
  const fluteB = rng() * TWO_PI;
  const fluteC = rng() * TWO_PI;
  const soilSeed = (rng() * 65536) | 0;

  for (let ring = 0; ring < count; ring++) {
    const before = rings.previous[ring];
    const flags = rings.flags[ring];
    const isSoil = (flags & TREE_WOOD_FLAG.SOIL) !== 0;
    const isStem = rings.chain[ring] === 0;
    const shapedRing = rings.shaped.get(ring);
    const shapedBefore = shapedRing && before === ring - 1 ? rings.shaped.get(before) : undefined;
    const flute = rings.flute[ring];
    const ringX = rings.x[ring] * scale;
    const ringY = rings.y[ring] * scale;
    const ringZ = rings.z[ring];
    const ringBirth = rings.birth[ring];
    const beforeX = before < 0 ? ringX : rings.x[before] * scale;
    const beforeY = before < 0 ? ringY : rings.y[before] * scale;
    const beforeZ = before < 0 ? ringZ : rings.z[before];
    const beforeBirth = before < 0 ? rings.since[ring] : rings.birth[before];
    // A collar's first ring comes from just behind itself, which sets the way along its bark.
    const shapedNext = shapedRing && before < 0 ? rings.shaped.get(ring + 1) : undefined;
    const ringSides = sides[ring];
    const radius = rings.radius[ring];
    const sharesStem = flute === 1 && !isStem;
    const list = radius >= 0.07 ? shoulders.get(sharesStem ? 0 : rings.chain[ring]) : undefined;
    const surface = radius * ratio;
    // The root flare thins with height, and is lobed toward each lateral root.
    const flareBase = isStem
      ? 0.62 * Math.exp(-ringZ / 0.0095) + 0.12 * Math.exp(-ringZ / 0.03)
      : 0;
    // A thick limb is a little deeper than it is wide, to carry its weight.
    const ovality = isStem || flags ? 0 : 0.09 * smoothstep(0.08, 0.4, radius);
    for (let side = 0; side <= ringSides; side++) {
      const vertex = firstVertex[ring] + side;
      const angle = ringSides > 0 ? (side / ringSides) * TWO_PI : 0;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      let rx = rings.nx[ring] * cosine + rings.bx[ring] * sine;
      let ry = rings.ny[ring] * cosine + rings.by[ring] * sine;
      let rz = rings.nz[ring] * cosine + rings.bz[ring] * sine;
      let width = radius;
      let vertexZ = ringZ;
      let barkU = ringSides > 0 ? side / ringSides : 0;
      let barkV = rings.barkV[ring];
      let shadeFactor = 1;
      let shiftX = 0;
      let shiftY = 0;
      let shiftZ = 0;
      if (shapedRing) {
        const at = side * SHAPED_STRIDE;
        rx = shapedRing[at];
        ry = shapedRing[at + 1];
        rz = shapedRing[at + 2];
        width = shapedRing[at + 3];
        barkU = shapedRing[at + 4];
        barkV = shapedRing[at + 5];
        shadeFactor = shapedRing[at + 6];
        shiftX = shapedRing[at + 7] * scale;
        shiftY = shapedRing[at + 8] * scale;
        shiftZ = shapedRing[at + 9];
      } else if (isSoil) {
        // Clods on an irregular disc, torn at its rim and rough and hanging below.
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        const rim = smoothstep(0.65 * TREE_ROOT_PLATE_RADII, 0.97 * TREE_ROOT_PLATE_RADII, radius);
        const below =
          ringZ < 0 ? smoothstep(0, -0.2 * TREE_ROOT_PLATE_THICKNESS * ratio, ringZ) : 0;
        width *=
          1 +
          0.34 *
            (getSoilNoise(Math.cos(angle) * 1.3 + 3, Math.sin(angle) * 1.3 + 7, soilSeed) - 0.5) +
          0.16 *
            (getSoilNoise(Math.cos(angle) * 3.4 + 11, Math.sin(angle) * 3.4 + 5, soilSeed) - 0.5) +
          rim *
            0.1 *
            (getSoilNoise(Math.cos(angle) * 8 + 31, Math.sin(angle) * 8 + ringZ * 40, soilSeed) -
              0.5);
        const lumps = getSoilNoise(px * 0.8 + 13, py * 0.8 + 29, soilSeed) - 0.5;
        const clods = getSoilNoise(px * 1.9 + 41, py * 1.9 + 7, soilSeed) - 0.5;
        const crumbs = getSoilNoise(px * 2.4 + 3, py * 2.4 + 53, soilSeed) - 0.5;
        vertexZ +=
          ratio *
          ((0.3 + 0.9 * below + 0.4 * rim) * lumps +
            (0.16 + 0.34 * below + 0.34 * rim) * clods +
            (0.03 + 0.07 * rim + 0.07 * below) * crumbs);
      } else if (isStem || flute > 0) {
        const azimuth = Math.atan2(ry, rx);
        if (flareBase > 0.002) {
          let lobe = 0;
          for (let root = 0; root < flare.azimuth.length; root++) {
            let gap = azimuth - flare.azimuth[root];
            gap -= TWO_PI * Math.round(gap / TWO_PI);
            lobe += flare.strength[root] * Math.exp(-(gap * gap) / 0.1);
          }
          width *= 1 + flareBase * (0.42 + 0.58 * Math.min(1, lobe));
        }
        // Fluted and a little out of round. The valleys also shade themselves, as a radial, being
        // the
        // way from the ring's center, can only follow them in outline.
        const fluting =
          flute *
          (0.05 * Math.sin(azimuth * 3 + fluteA + ringZ * 24) +
            0.03 * Math.sin(azimuth * 5 + fluteB - ringZ * 40) +
            0.022 * Math.sin(azimuth * 2 + fluteC + ringZ * 11));
        width *= 1 + fluting;
        shadeFactor *= 1 + fluting * 1.6;
      }
      if (ovality > 0 && !shapedRing) width *= 1 + ovality * (1 - flute) * (rz * rz - 0.4);
      if (list) {
        for (let entry = 0; entry < list.length; entry += 5) {
          const offset = (rings.barkV[ring] - list[entry]) / (surface * 1.5);
          if (offset < -2.2 || offset > 2.2) continue;
          const falloff = Math.exp(-offset * offset);
          const facing = Math.max(
            0,
            rx * list[entry + 1] + ry * list[entry + 2] + rz * list[entry + 3]
          );
          width *= 1 + list[entry + 4] * falloff * (0.14 + facing * facing);
        }
      }
      center[vertex * 4] = ringX + shiftX;
      center[vertex * 4 + 1] = ringY + shiftY;
      center[vertex * 4 + 2] = vertexZ + shiftZ;
      center[vertex * 4 + 3] = ringBirth;
      // Within a collar, a vertex comes from the vertex before it on its own fillet.
      const beforeAt = shapedBefore ? side * SHAPED_STRIDE : -1;
      previous[vertex * 4] = beforeX + (shapedBefore ? shapedBefore[beforeAt + 7] * scale : 0);
      previous[vertex * 4 + 1] = beforeY + (shapedBefore ? shapedBefore[beforeAt + 8] * scale : 0);
      previous[vertex * 4 + 2] =
        (before < 0 ? vertexZ : beforeZ) + (shapedBefore ? shapedBefore[beforeAt + 9] : 0);
      if (shapedNext) {
        const at = side * SHAPED_STRIDE;
        previous[vertex * 4] =
          ringX +
          shiftX -
          0.02 * (rings.x[ring + 1] * scale + shapedNext[at + 7] * scale - ringX - shiftX);
        previous[vertex * 4 + 1] =
          ringY +
          shiftY -
          0.02 * (rings.y[ring + 1] * scale + shapedNext[at + 8] * scale - ringY - shiftY);
        previous[vertex * 4 + 2] =
          ringZ + shiftZ - 0.02 * (rings.z[ring + 1] + shapedNext[at + 9] - ringZ - shiftZ);
      }
      previous[vertex * 4 + 3] = beforeBirth;
      radial[vertex * 4] = rx;
      radial[vertex * 4 + 1] = ry;
      radial[vertex * 4 + 2] = rz;
      radial[vertex * 4 + 3] = width;
      bark[vertex * 4] = barkU;
      bark[vertex * 4 + 1] = barkV;
      bark[vertex * 4 + 2] = rings.outer[ring];
      bark[vertex * 4 + 3] = rings.inner[ring];
      shade[vertex * 4] = clamp(rings.occlusion[ring] * (0.84 + 0.16 * rz) * shadeFactor, 0, 1);
      shade[vertex * 4 + 1] = rings.order[ring];
      shade[vertex * 4 + 2] = rings.seed[ring];
      shade[vertex * 4 + 3] = flags;
    }
  }

  // Triangles between consecutive rings, binned by thickness so prefixes drop the finest wood.
  const binSizes = new Int32Array(LOD_BIN_COUNT);
  const binOf = new Uint8Array(count);
  for (let ring = 0; ring < count; ring++) {
    if (!rings.linked[ring]) continue;
    const isThorn = (rings.flags[ring] & TREE_WOOD_FLAG.THORN) !== 0;
    const isSoil = (rings.flags[ring] & TREE_WOOD_FLAG.SOIL) !== 0;
    const isFinest = (rings.flags[ring] & TREE_WOOD_FLAG.ROOT) !== 0 && rings.fine[ring] !== 0;
    const bin =
      isThorn || isFinest
        ? LOD_BIN_COUNT - 1
        : isSoil
          ? rings.fine[ring]
            ? getLodBin(0.06)
            : 0
          : getLodBin(Math.max(rings.radius[ring], rings.radius[ring + 1]));
    binOf[ring] = bin;
    binSizes[bin] += (sides[ring] + sides[ring + 1]) * 3;
  }
  const binEnds = new Int32Array(LOD_BIN_COUNT);
  const binCursor = new Int32Array(LOD_BIN_COUNT);
  let indexTotal = 0;
  for (let bin = 0; bin < LOD_BIN_COUNT; bin++) {
    binCursor[bin] = indexTotal;
    indexTotal += binSizes[bin];
    binEnds[bin] = indexTotal;
  }
  const indices = new Uint32Array(indexTotal);
  for (let ring = 0; ring < count; ring++) {
    if (!rings.linked[ring]) continue;
    const bin = binOf[ring];
    const a = firstVertex[ring];
    const b = firstVertex[ring + 1];
    const m = sides[ring];
    const n = sides[ring + 1];
    let cursor = binCursor[bin];
    let i = 0;
    let j = 0;
    while (i < m || j < n) {
      // Zip the two rings together, so side counts can change along a tube.
      if (n === 0 || (i < m && (i + 1) * n <= (j + 1) * m)) {
        indices[cursor++] = a + i;
        indices[cursor++] = a + i + 1;
        indices[cursor++] = b + (n === 0 ? 0 : j);
        i++;
      } else {
        indices[cursor++] = a + i;
        indices[cursor++] = b + j + 1;
        indices[cursor++] = b + j;
        j++;
      }
    }
    binCursor[bin] = cursor;
  }

  // LOD 3 must keep the whole trunk. Most of the wood is fine shoots, thinner than a pixel at the distance
  // where a tree takes LOD 1, so the levels hold small shares of it.
  let trunkBin = 0;
  for (let ring = 0; ring < count; ring++) {
    if (rings.chain[ring] === 0 && rings.linked[ring]) {
      trunkBin = Math.max(trunkBin, binOf[ring]);
    }
  }
  const allWood = binEnds[LOD_BIN_COUNT - 2];
  const pickEnd = (share: number, atLeast: number): number => {
    for (let bin = 0; bin < LOD_BIN_COUNT - 1; bin++) {
      if (binEnds[bin] >= share * allWood && binEnds[bin] > atLeast) return binEnds[bin];
    }
    return allWood;
  };
  const lod3 = pickEnd(0.025, binEnds[trunkBin] - 1);
  const lod2 = pickEnd(0.065, lod3);
  const lod1 = pickEnd(0.2, lod2);
  return {
    vertexCount,
    center,
    previous,
    radial,
    bark,
    shade,
    indices,
    lodIndexCounts: [indexTotal, Math.min(lod1, indexTotal - 3), lod2, lod3]
  };
}

// ---------------------------------------------------------------------------------------------
// Leaves and crop anchors
// ---------------------------------------------------------------------------------------------

/**
 * An order in which any prefix samples space evenly: within each grid cell, items get golden-ratio
 * keys in the order they were laid, so a prefix also thins evenly along a shoot.
 */
function createStratifiedOrder(
  records: Float32Array,
  stride: number,
  count: number,
  width: number,
  rng: () => number
): Int32Array {
  const cellSize = 0.075;
  const side = Math.ceil(2.4 / cellSize);
  const scale = width / cellSize;
  const levels = Math.ceil(1.2 / cellSize);
  const visits = new Uint32Array(side * side * levels);
  const phases = new Float32Array(side * side * levels).fill(-1);
  const buckets = new Uint32Array(65537);
  const keys = new Uint16Array(count);
  for (let item = 0; item < count; item++) {
    const offset = item * stride;
    const ix = clamp(((records[offset] + 1.2) * scale) | 0, 0, side - 1);
    const iy = clamp(((records[offset + 1] + 1.2) * scale) | 0, 0, side - 1);
    const iz = clamp((records[offset + 2] / cellSize) | 0, 0, levels - 1);
    const cell = ix + iy * side + iz * side * side;
    if (phases[cell] < 0) phases[cell] = rng();
    const key = phases[cell] + visits[cell]++ * GOLDEN_RATIO;
    keys[item] = ((key - Math.floor(key)) * 65536) | 0;
    buckets[keys[item] + 1]++;
  }
  for (let bucket = 0; bucket < 65536; bucket++) buckets[bucket + 1] += buckets[bucket];
  const order = new Int32Array(count);
  for (let item = 0; item < count; item++) order[buckets[keys[item]]++] = item;
  return order;
}

function reorderRecords(
  records: Float32Array,
  stride: number,
  count: number,
  order: Int32Array
): Float32Array {
  const result = new Float32Array(count * stride);
  for (let item = 0; item < count; item++) {
    const from = order[item] * stride;
    const to = item * stride;
    for (let field = 0; field < stride; field++) result[to + field] = records[from + field];
  }
  return result;
}

function getOuterShell(level: number, dies: boolean, rng: () => number): number {
  return dies ? 0.38 + rng() * 0.24 : smoothstep(0.62, 0.98, level);
}

/**
 * Leaves per length of shoot. Flush shoots carry them all along, a limb carries them only while it
 * is a
 * young shoot itself, and thick wood has shed most of them.
 */
function getLeafWeight(context: GrowthContext, node: number, radius: number): number {
  if (node >= context.colonized) return 1;
  const young = 1 - smoothstep(0.12, 0.3, context.nodes.birth[node]);
  return lerp(0.1, 0.9, young) * (radius > 0.12 ? 0.6 : 1);
}

type GrowthFoliage = {
  leaves: Float32Array;
  leafCount: number;
  lodLeafCounts: [number, number, number, number];
};

/**
 * Leaves alternate along every shoot, one to a node, in a spiral of about 137 degrees, each with
 * its own
 * short petiole, so a shoot is never a whorl or a fan. Blades leave the shoot pointing forward,
 * with their
 * tips drooping, and turn their upper faces to the light. They appear just after the tip passes,
 * and
 * leaves on old interior wood die as the crown outgrows them.
 */
function writeLeaves(
  context: GrowthContext,
  chains: GrowthChains,
  pipe: PipeRadii,
  limbs: GrowthLimbs
): GrowthFoliage {
  const {profile, traits, nodes, envelope} = context;
  const rng = createStream(context.seed, 0x1eaf);
  const {x, y, z, birth, level} = nodes;
  const ratio = profile.trunkRatio;
  const scale = 1 / profile.crownAspect;
  const list = chains.nodes;
  const size = profile.leafLength * traits.leafSize;
  // Leaves keep to a shoot's outer part, past the bare stretch at its base.
  const bareBase = 0.004;

  // The stem carries seedling leaves at a fixed spacing; all other shoots share the rest.
  const stemFrom = chains.start[0];
  const stemTo = chains.start[1];
  let stemLength = 0;
  for (let index = stemFrom + 1; index < stemTo; index++) {
    const a = list[index - 1];
    const b = list[index];
    stemLength += Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
  }
  const target = Math.round(profile.leaves * traits.leafDensity);
  const stemLeaves = Math.round((stemLength / 0.0032) * Math.sqrt(traits.leafDensity));
  let totalWeight = 0;
  for (let chain = 1; chain < chains.count; chain++) {
    for (let index = chains.start[chain] + 1; index < chains.start[chain + 1]; index++) {
      const a = list[index - 1];
      const b = list[index];
      const length = Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
      totalWeight += length * getLeafWeight(context, b, pipe.radius[b]);
    }
  }
  const rate = (target - stemLeaves) / totalWeight;
  const capacity = target + 128;
  const records = new Float32Array(capacity * TREE_LEAF_STRIDE);
  let count = 0;

  for (let chain = 0; chain < chains.count; chain++) {
    const from = chains.start[chain];
    const to = chains.start[chain + 1];
    const isStem = chain === 0;
    let chainLength = 0;
    for (let index = from + 1; index < to; index++) {
      const a = list[index - 1];
      const b = list[index];
      chainLength += Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
    }
    const flushHabit = 0.4 + rng() * 0.6;
    let azimuth = rng() * TWO_PI;
    let carried = rng();
    let arc = 0;
    const chainRate = isStem ? stemLeaves / Math.max(stemLength, 1e-6) : rate;
    for (let index = from + 1; index < to; index++) {
      const a = list[index - 1];
      const b = list[index];
      let tx = x[b] - x[a];
      let ty = y[b] - y[a];
      let tz = z[b] - z[a];
      const length = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1e-6;
      tx /= length;
      ty /= length;
      tz /= length;
      const isOldWood = !isStem && pipe.radius[b] > 0.12;
      const weight = isStem ? 1 : getLeafWeight(context, b, pipe.radius[b]);
      carried += length * chainRate * weight;
      const leavesHere = Math.floor(carried);
      carried -= leavesHere;
      for (let leaf = 0; leaf < leavesHere && count < capacity; leaf++) {
        const t = (leaf + 0.3 + rng() * 0.4) / leavesHere;
        const height = lerp(z[a], z[b], t);
        // A seedling's first leaves are well above the soil, and any shoot starts bare.
        if (isStem ? height < 0.012 : arc + length * t < bareBase && chainLength > bareBase * 2.5) {
          continue;
        }
        azimuth += GOLDEN_ANGLE + (rng() - 0.5) * 0.3;
        setSideDirection(tx, ty, tz, azimuth);
        const rx = SIDE[0];
        const ry = SIDE[1];
        const rz = SIDE[2];

        // A leaf lives on young wood, so it sits at the surface of the shoot soon after its birth.
        const woodBirth = lerp(birth[a], birth[b], t);
        const mature = lerp(pipe.radius[a], pipe.radius[b], t);
        const radius = getTreeRingRadius(mature, woodBirth, Math.min(1, woodBirth + 0.08)) * ratio;
        const petiole = 0.0006 + rng() * 0.0009;
        const px = lerp(x[a], x[b], t) + rx * (radius + petiole);
        const py = lerp(y[a], y[b], t) + ry * (radius + petiole);
        const pz = Math.max(0.004, height + rz * (radius + petiole));

        const tipDistance = chainLength - (arc + length * t);
        const tipness = Math.pow(clamp(1 - tipDistance / 0.024, 0, 1), 1.4) * flushHabit;
        const leafLevel = lerp(level[a], level[b], t);
        const margin = LEAF_DEATH_MARGIN + (rng() - 0.5) * 0.08;
        const dies = leafLevel + margin < 1;
        const born = Math.min(LAST_RING_BIRTH, woodBirth + 0.0015 + rng() * 0.005);
        let death = dies ? getTreeGrowthAtCrown(leafLevel + margin) : 2;
        if (isOldWood) death = Math.min(death, born + 0.3 + rng() * 0.1);
        const mortal = death <= 1;
        if (mortal) death = Math.max(death, born + 0.03);

        // Blade axis: forward along the shoot and out to its side, then outward and drooping. New
        // leaves
        // near the tip still hug the shoot.
        const planar = Math.sqrt(px * px + py * py) || 1;
        const outX = px / planar;
        const outY = py / planar;
        const insertion = lerp(0.55, 0.98, rng()) * lerp(1, 0.62, tipness);
        const forward = Math.cos(insertion);
        const away = Math.sin(insertion);
        let lx = rx * away + tx * forward;
        let ly = ry * away + ty * forward;
        let lz = rz * away + tz * forward;
        // Blades make a mosaic: they spread over the crown's surface, as it was when they came,
        // with
        // upper faces out to the light and tips drooping. So the crown closes with few leaves, as a
        // real
        // one does. Its surface is nearly level on top and nearly upright on the sides.
        const crownNow = Math.max(getTreeCrownFraction(born), 0.02) * envelope.width;
        const heightNow = Math.max(getTreeHeightFraction(born), 0.02);
        const centerZ = envelope.widest * heightNow;
        const depthNow = (1 - envelope.widest) * heightNow;
        let surfaceX = px / (crownNow * crownNow);
        let surfaceY = py / (crownNow * crownNow);
        let surfaceZ = (pz - centerZ) / (depthNow * depthNow);
        if (surfaceZ < 0) surfaceZ *= 0.3;
        const surface =
          Math.sqrt(surfaceX * surfaceX + surfaceY * surfaceY + surfaceZ * surfaceZ) || 1;
        surfaceX /= surface;
        surfaceY /= surface;
        surfaceZ /= surface;
        const outness = lx * surfaceX + ly * surfaceY + lz * surfaceZ;
        lx -= surfaceX * outness * 0.62;
        ly -= surfaceY * outness * 0.62;
        lz -= surfaceZ * outness * 0.62;
        const lying = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
        lx /= lying;
        ly /= lying;
        lz /= lying;
        lz -= profile.leafDroop * (0.18 + rng() * 0.5);
        // However it sits on a shoot, a blade does not hang straight down.
        const blade = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
        lx /= blade;
        ly /= blade;
        lz /= blade;
        if (lz < -0.8) {
          const sideways = Math.sqrt(lx * lx + ly * ly) || 1;
          lx = (lx / sideways) * 0.6;
          ly = (ly / sideways) * 0.6;
          lz = -0.8;
        }
        // Upper normal: out from the crown and toward the sky, with some scatter.
        let ux = surfaceX + outX * 0.1 + (rng() - 0.5) * 0.66;
        let uy = surfaceY + outY * 0.1 + (rng() - 0.5) * 0.66;
        let uz = surfaceZ + 0.5 + (rng() - 0.5) * 0.5;
        const dot = ux * lx + uy * ly + uz * lz;
        ux -= lx * dot;
        uy -= ly * dot;
        uz -= lz * dot;
        let upper = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (upper < 1e-3) {
          setSideDirection(lx, ly, lz, azimuth);
          ux = SIDE[0];
          uy = SIDE[1];
          uz = SIDE[2];
          upper = 1;
        }
        ux /= upper;
        uy /= upper;
        uz /= upper;
        const wx = uy * lz - uz * ly;
        const wy = uz * lx - ux * lz;
        const wz = ux * ly - uy * lx;

        const offset = count * TREE_LEAF_STRIDE;
        records[offset] = px * scale;
        records[offset + 1] = py * scale;
        records[offset + 2] = pz;
        // A seedling's leaves are small, and a young vigorous crown's a little large.
        const juvenile =
          lerp(0.22, 1, smoothstep(0, 0.18, born)) *
          lerp(1.3, 1, smoothstep(0.28, 0.62, leafLevel));
        records[offset + 3] = size * (0.78 + rng() * 0.44) * (1 - 0.15 * tipness) * juvenile;
        writeBasisQuaternion(records, offset + 4, lx, ly, lz, wx, wy, wz, ux, uy, uz);
        records[offset + 8] = born;
        records[offset + 9] = death;
        records[offset + 10] = rng();
        records[offset + 11] = getOuterShell(leafLevel, mortal, rng);
        records[offset + 12] = limbs.outer[b];
        records[offset + 13] = limbs.inner[b];
        records[offset + 14] = tipness;
        records[offset + 15] = profile.leafWidth * (0.9 + rng() * 0.2);
        count++;
      }
      arc += length;
    }
  }
  const order = createStratifiedOrder(
    records,
    TREE_LEAF_STRIDE,
    count,
    envelope.width,
    createStream(context.seed, 0x5a5a)
  );
  return {
    leaves: reorderRecords(records, TREE_LEAF_STRIDE, count, order),
    leafCount: count,
    lodLeafCounts: [count, Math.ceil(count / 4), Math.ceil(count / 16), Math.ceil(count / 64)]
  };
}

/** Writes the rotation with columns x, y and z as a quaternion, xyzw. */
function writeBasisQuaternion(
  out: Float32Array,
  offset: number,
  xx: number,
  xy: number,
  xz: number,
  yx: number,
  yy: number,
  yz: number,
  zx: number,
  zy: number,
  zz: number
): void {
  const trace = xx + yy + zz;
  let qx: number;
  let qy: number;
  let qz: number;
  let qw: number;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (yz - zy) * s;
    qy = (zx - xz) * s;
    qz = (xy - yx) * s;
  } else if (xx > yy && xx > zz) {
    const s = 2 * Math.sqrt(1 + xx - yy - zz);
    qw = (yz - zy) / s;
    qx = 0.25 * s;
    qy = (yx + xy) / s;
    qz = (zx + xz) / s;
  } else if (yy > zz) {
    const s = 2 * Math.sqrt(1 + yy - xx - zz);
    qw = (zx - xz) / s;
    qx = (yx + xy) / s;
    qy = 0.25 * s;
    qz = (zy + yz) / s;
  } else {
    const s = 2 * Math.sqrt(1 + zz - xx - yy);
    qw = (xy - yx) / s;
    qx = (zx + xz) / s;
    qy = (zy + yz) / s;
    qz = 0.25 * s;
  }
  out[offset] = qx;
  out[offset + 1] = qy;
  out[offset + 2] = qz;
  out[offset + 3] = qw;
}

/**
 * Crop attachment points on the fine shoots of the crown, among their leaves. They keep back from a
 * shoot's tip and from the crown's very skin, so a crop hanging from one is in the leaf shell,
 * often half
 * hidden and never off the silhouette, and the stored point is the twig it hangs from. The rank
 * order is
 * stable: any count is an even sample, and a larger count only adds crops.
 */
function writeCropAnchors(
  context: GrowthContext,
  chains: GrowthChains,
  pipe: PipeRadii,
  limbs: GrowthLimbs
): Float32Array {
  const {profile, nodes, envelope} = context;
  const rng = createStream(context.seed, 0xc209);
  const {x, y, z, birth, level} = nodes;
  const scale = 1 / profile.crownAspect;
  const list = chains.nodes;
  // A thin shoot's length that may bear, by how deep it lies.
  const weightOf = (a: number, b: number, tipDistance: number): number => {
    if (pipe.radius[b] > 0.05 || nodes.shoot[b] === 0) return 0;
    const length = Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
    const depth = smoothstep(0.6, 0.9, level[b]) * (1 - 0.8 * smoothstep(0.96, 0.995, level[b]));
    return length * (0.04 + 0.96 * depth) * smoothstep(0.002, 0.009, tipDistance);
  };
  const chainLengths = new Float64Array(chains.count);
  let total = 0;
  for (let chain = 1; chain < chains.count; chain++) {
    let chainLength = 0;
    for (let index = chains.start[chain] + 1; index < chains.start[chain + 1]; index++) {
      const a = list[index - 1];
      const b = list[index];
      chainLength += Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
    }
    chainLengths[chain] = chainLength;
    let arc = 0;
    for (let index = chains.start[chain] + 1; index < chains.start[chain + 1]; index++) {
      const a = list[index - 1];
      const b = list[index];
      arc += Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
      total += weightOf(a, b, chainLength - arc);
    }
  }
  const spacing = total / CROP_ANCHOR_COUNT;
  const records = new Float32Array(CROP_ANCHOR_COUNT * TREE_CROP_ANCHOR_STRIDE);
  let count = 0;
  let carried = spacing * rng();
  for (let chain = 1; chain < chains.count && count < CROP_ANCHOR_COUNT; chain++) {
    let arc = 0;
    for (let index = chains.start[chain] + 1; index < chains.start[chain + 1]; index++) {
      const a = list[index - 1];
      const b = list[index];
      arc += Math.hypot(x[b] - x[a], y[b] - y[a], z[b] - z[a]);
      const weight = weightOf(a, b, chainLengths[chain] - arc);
      carried += weight;
      while (carried >= spacing && count < CROP_ANCHOR_COUNT) {
        carried -= spacing;
        const t = weight > 0 ? clamp(1 - carried / weight, 0, 1) : 1;
        const offset = count * TREE_CROP_ANCHOR_STRIDE;
        records[offset] = lerp(x[a], x[b], t) * scale;
        records[offset + 1] = lerp(y[a], y[b], t) * scale;
        records[offset + 2] = lerp(z[a], z[b], t);
        records[offset + 3] = Math.min(
          LAST_RING_BIRTH,
          Math.max(lerp(birth[a], birth[b], t) + 0.004, profile.cropStart + rng() * 0.05)
        );
        records[offset + 4] = limbs.outer[b];
        records[offset + 5] = limbs.inner[b];
        records[offset + 6] = rng();
        records[offset + 7] = smoothstep(0.62, 0.98, lerp(level[a], level[b], t));
        count++;
      }
    }
  }
  const order = createStratifiedOrder(
    records,
    TREE_CROP_ANCHOR_STRIDE,
    count,
    envelope.width,
    createStream(context.seed, 0x6b6b)
  );
  return reorderRecords(records, TREE_CROP_ANCHOR_STRIDE, count, order);
}

// ---------------------------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------------------------

function growTreeModel(
  key: string,
  type: TreeGrowthSpecies,
  traits: ResolvedTreeCharacteristics
): TreeGrowthModel {
  const profile = PROFILES[type];
  const typeSeed = type
    .split('')
    .reduce((seed, letter) => Math.imul(seed, 31) + letter.charCodeAt(0), 137);
  const seed = (typeSeed + Math.imul(traits.seed, 0x9e3779b1)) >>> 0;
  const envelope = createCrownEnvelope(profile, traits);
  const shoots = Math.ceil(profile.flushShoots * Math.sqrt(traits.branchDensity));
  const nodes = createGrowthNodes(profile.limbBudget + 256 + shoots * 5);
  const forkZ = Math.max(profile.forkZ, envelope.floorZ - profile.socketSpan * 0.8);
  const arrivals = createArrivalTable(envelope);
  const context: GrowthContext = {
    profile,
    traits,
    seed,
    envelope,
    nodes,
    forkZ,
    colonized: 0,
    arrivals
  };

  const plan = layStem(context);
  shapeCrownReach(context, plan, createStream(seed, 0x3e11));
  const attractors = sampleCrownAttractors(context, nodes.z[nodes.count - 1]);
  colonizeCrown(context, plan, attractors);
  for (let node = 0; node < nodes.count; node++) {
    nodes.level[node] = getTreeCrownFraction(
      lookUpArrival(envelope, arrivals, nodes.x[node], nodes.y[node], nodes.z[node])
    );
  }
  context.colonized = nodes.count;
  sproutShoots(context);

  const pipe = computePipeRadii(nodes, profile.twigFloor);
  const chains = buildChains(nodes, pipe, context.colonized, createStream(seed, 0xc4a1));
  roundElbows(nodes, chains, pipe, profile.trunkRatio);
  const limbs = buildLimbs(context, pipe, createStream(seed, 0x11b));

  // A limb may have rings for its elbows and its relief, a thin shoot one per node, and a tube a
  // collar.
  let ringCapacity = chains.count * 7 + 512;
  for (let node = 0; node < nodes.count; node++) ringCapacity += pipe.radius[node] >= 0.03 ? 9 : 1;
  ringCapacity += Math.round((profile.thorns * context.colonized) / 1000) * 2;
  ringCapacity += (profile.roots[1] + 1) * 240 + (profile.stiltRoots + profile.aerialRoots) * 64;
  const rings = createWoodRings(ringCapacity);
  const joints: WoodJoints = {collars: [], stemEnd: -1, leaderFirst: -1};
  const ringOfNode = buildChainRings(context, chains, pipe, limbs, rings, joints);
  addCollars(context, joints, rings);
  const flare = addRoots(context, rings, ringOfNode[0]);
  addSoilPlate(context, rings);
  addStiltRoots(context, rings, ringOfNode);
  addAerialRoots(context, rings, ringOfNode, pipe, limbs);
  addThorns(context, rings);

  const wood = writeWood(context, rings, flare);
  const foliage = writeLeaves(context, chains, pipe, limbs);
  const cropAnchors = writeCropAnchors(context, chains, pipe, limbs);
  return {
    key,
    forkZ: context.forkZ,
    referenceHeight: profile.referenceHeight,
    trunkRatio: profile.trunkRatio,
    crownAspect: profile.crownAspect,
    wood,
    leaves: foliage.leaves,
    leafCount: foliage.leafCount,
    lodLeafCounts: foliage.lodLeafCounts,
    cropAnchors,
    cropAnchorCount: cropAnchors.length / TREE_CROP_ANCHOR_STRIDE,
    limbs: limbs.limbs,
    limbCount: limbs.count
  };
}
