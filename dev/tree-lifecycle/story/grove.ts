// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The grove plan and the state of every tree. The plan is fixed when this module loads, from stable
 * hashes and the land: where each tree stands and how high, its seed, when the magic ring reaches
 * it, how much of each wall of the hurricane it takes, when and which way it rocks, leans or falls,
 * how long the flood stands over its roots, and the row that replaces it. Trees run in a fixed
 * order, hero first, then the grove by distance from the hero, then the replants.
 *
 * Rows of trees run east and west, along x, so a low camera can look down an aisle into the sunrise
 * and the sunset. Every time here is a cycle second. Only `TreeLayer`'s existing `TreeSpec` fields
 * carry the storm: `elevation`, `wind`, `lean`, `foliage`, `damage`, `decay`, `health`, `flush`,
 * `canopyColor`, and each crop's `count`, `fallen` and `unripeColor`.
 */

import {
  getTreeWindGust,
  type CropConfig,
  type TreeLean,
  type TreeSpec
} from '@deck.gl-community/layers';
import {
  CROP_CALENDAR,
  getBloomYear,
  getFruitYear,
  getGrowthAtAge,
  getHeightFraction,
  getSceneSeconds,
  getSecondOfYear,
  getSpanFromStart,
  getSpanToEnd,
  getYear,
  HURRICANE
} from './beats';
import {getEnvironment} from './environment';
import {getDaysUnderWater, getWaterLevel} from './flood';
import {BED_LAYOUT, getLandHeight} from './land';
import {getHeroElevation, getNetFit} from './props';
import {
  clamp,
  clamp01,
  createTrack,
  getBearingVector,
  hash01,
  hashRange,
  lerp,
  pulse,
  RADIANS_PER_DEGREE,
  smoothNoise,
  smootherstep,
  smoothstep,
  type Key
} from './story-math';
import type {
  Rgb,
  StoryGroveRows,
  StoryMicrojet,
  StoryNet,
  StoryRootBall,
  StorySite,
  StorySplash,
  StoryWind,
  Vec3
} from './story-types';
import {getBoxesOnTree} from './yield';

/** Layout in metres. `rowSpacing` is between rows, along y, and `treeSpacing` along a row, on x. */
export const GROVE_LAYOUT = {
  rowSpacing: 7.6,
  treeSpacing: 6,
  rows: [-4, 4],
  columns: [-5, 5],
  /**
   * The hero's row is set off by half a tree, so its neighbours along the row stand clear of it.
   */
  heroRowOffsets: [9, 15, 21, 27, 33],
  /** The nearest tree in each neighbouring row stands back this far from the hero. */
  heroClearance: 8.6,
  jitter: 0.14
};

/** Sizes in metres at growth 1, and the characteristics seeds. */
export const TREE_SIZES = {
  hero: {height: 9, crownRadius: 5, seed: 1},
  grove: {height: 6.2, heightSpread: 0.06, crownRadius: 3, crownSpread: 0.05},
  seeds: [2, 3, 4, 5, 6, 7]
};

/** Grove trees rise as the ring reaches them, already this old, give or take. */
export const MAGIC_TABLE = {
  year: 15,
  age: 10,
  ageSpread: 0.8,
  riseSeconds: 2,
  delaySpread: 0.15,
  /** Radius of the ring by cycle second, and how bright it is. */
  ringRadiusKeys: [
    [27.3, 0],
    [28.2, 8],
    [29, 24],
    [29.8, 42],
    [30.3, 56],
    [31, 110],
    [31.8, 300]
  ] as readonly Key[],
  ringStrengthKeys: [
    [27.24, 0],
    [27.6, 0.9],
    [29, 0.8],
    [30.2, 0.3],
    [31, 0]
  ] as readonly Key[],
  /** How far out the rows have spread, which the ground carries on to the horizon. */
  rowReachKeys: [
    [27.3, 0],
    [29, 30],
    [29.8, 70],
    [30.3, 200],
    [31, 800],
    [31.8, 2400]
  ] as readonly Key[],
  rowStrengthKeys: [
    [27.36, 0],
    [29.8, 1]
  ] as readonly Key[],
  /**
   * The magic is the spec's full bloom, so the bloom of its year holds on every tree, none of it
   * fallen. It goes over these seconds, once the camera is high in grove-thrives and before the
   * next year's opens, and only `bloomFallen` of it lets go to lie under the trees.
   */
  bloomGoes: [31, 31.35] as const,
  bloomFallen: 0.25
};

/**
 * A fall the camera is placed to see. `heel` is how the fronts before it rock it: the second a front
 * peaks at `HURRICANE.viewPoint`, the degrees it leans for good after it, and the degrees more it
 * heels while it passes. A fall starts from wherever its rocking has left it.
 */
type ForcedFall = {
  x: number;
  y: number;
  wall: 1 | 2;
  start: number;
  seconds: number;
  /** Compass bearing it falls toward, when not exactly its wall's. */
  bearing?: number;
  /** Sharpness of its sinh topple, when not `FALL_TABLE.topple`. */
  topple?: number;
  /**
   * A topple that goes as this power of its time instead: as slow to start as a sharp sinh, and
   * not as fast as one when it lands.
   */
  power?: number;
  heel: readonly (readonly [second: number, permanent: number, rock: number])[];
  /**
   * Metres across the splash its crown throws up as it lands in water, if it does: at its crown's
   * middle if that is over the water, or else where its fall crosses the furrow's water.
   */
  splash?: number;
};

/**
 * Who falls. `fraction` of the grove goes down, the forced falls among them, chosen from each
 * tree's hash with a slow noise, so they go in swaths that run downwind through each wall. `forced`
 * are the falls the storm camera, low in the north furrow and looking east, is placed to see: in
 * the first wall a north-row tree goes over away from the furrow, and the nearest hero-row tree in
 * view crashes across it on the last front, its crown into the water 12 m ahead, where it dams the
 * furrow; in the second, the next hero-row tree goes over away from it and a north-row tree crashes
 * across it into the flood. `standing` keeps the trees by the camera up, and none falls within
 * `heroClear` of the hero.
 */
export const FALL_TABLE = {
  fraction: 0.18,
  swathScale: 0.09,
  swathWeight: 0.35,
  firstWallShare: 0.55,
  bearingSpread: 20,
  /**
   * Seconds a swath tree takes to go down, so that none hits the ground faster than a tree of its
   * height falling from its root plate, about 140 degrees a second.
   */
  seconds: [1.9, 2.6] as const,
  startJitter: 0.12,
  /** Any swath fall of the first wall is down this soon after the eye opens. */
  firstWallDoneBy: HURRICANE.eyeOpen + 1.1,
  /** And of the second, as the clearing's sun breaks under the deck. */
  secondWallDoneBy: HURRICANE.clearing + 0.9,
  /** Sharpness of the topple, its final lean in degrees, and the bounce when it hits. */
  topple: 3,
  leanDegrees: 86,
  bounceDegrees: 2.4,
  bounceDecay: 5,
  bounceRate: 8,
  heroClear: 10,
  forced: [
    {
      x: -12,
      y: 7.6,
      wall: 1,
      start: 36.25,
      seconds: 2.1,
      // Half down in the 37.45 flash, and on the ground in the calm.
      topple: 2,
      heel: [
        [34.9, 1, 2],
        [36.2, 2, 5]
      ]
    },
    {
      x: -15,
      y: 0,
      wall: 1,
      start: 35.3,
      seconds: 2.2,
      // Rocked by the first front, heeling hard across the aisle in the second, and down across
      // the furrow on the third, in the 37.45 flash: a little east of the wind, so its crown
      // sweeps in from the right and lies across the water in the middle of the frame.
      bearing: 22,
      heel: [[34.9, 1, 2.5]],
      splash: 1.5
    },
    {x: -9, y: 0, wall: 2, start: 41, seconds: 2.1, heel: [[40.9, 1.5, 2.5]]},
    {
      x: -18,
      y: 7.6,
      wall: 2,
      start: 41.5,
      seconds: 1.9,
      // Slow to start, at 9 degrees by the 42.2 peak, then fast into the water at 43.4.
      power: 2.5,
      heel: [[40.9, 1.5, 2.5]],
      splash: 3
    }
  ] as readonly ForcedFall[],
  standing: {x: [-40, -20] as const, y: [-1, 9] as const}
};

/**
 * How the fronts rock and lean a tree that leans or is about to fall. The fronts peak at
 * `HURRICANE.viewPoint` at `HURRICANE.gustPeaks`, and reach a leaner out in the grove `frontSpeed`
 * metres a second downwind of there. A permanent step comes in over `step` around a front, as it
 * builds. A rock rises over `rockRise` seconds before it and dies away over `rockFall` after, and
 * `gustShare` of it follows the tree's own gust, `getTreeWindGust`, so it heels in step with what
 * `TreeLayer` does to its crown.
 */
export const HEEL_TABLE = {
  frontSpeed: 55,
  step: [-0.4, 0] as const,
  rockRise: 0.45,
  rockFall: 0.9,
  gustShare: 0.5,
  /** A fall's rocking stops following the gust over this long before it starts. */
  gustFade: 0.3
};

/**
 * Standing trees that lean on lifted root plates, toward the bearing of the wall that pushed them
 * over, in steps as its fronts reach them. A first-wall leaner is pushed back a little by the second
 * wall. None stands by the storm camera, near the hero, or by the finale's aisle. While the gaps are
 * replanted, the crews set them back up, one after another over `reset`, to `kept` of their lean,
 * as growers reset leaning trees after a storm; the dead are left to go with their replacement.
 */
export const LEAN_TABLE = {
  share: 0.12,
  degrees: [10, 28] as const,
  bearingSpread: 25,
  /** Shares of its lean that each front of its wall adds, and how far each rocks it, of its lean. */
  steps: [0.3, 0.35, 0.35] as const,
  rock: 0.12,
  /** What each front of the second wall takes back from a first-wall leaner, of its lean. */
  backStep: 0.05,
  backRock: 0.1,
  heroClear: 12,
  finale: {x: [-6, 20] as const, y: [-10, 1] as const},
  reset: [51.6, 53] as const,
  resetSeconds: 0.5,
  kept: 0.25
};

/**
 * Each tree's share of the wind, `TreeSpec.wind` over `wind.strength`, by how much grove the wind
 * crosses to reach it: `edge` on the block's edges facing the wind, falling to `lee` over `depth`
 * metres in. The hero, alone in its own room, takes `hero`, and the trees by the storm camera
 * `byCamera`.
 */
export const EXPOSURE_TABLE = {
  lee: 0.9,
  edge: 1.15,
  depth: 9,
  hero: 0.9,
  byCamera: 0.85
};

/**
 * What the storm does to those left standing, and how they come back. All by cycle second.
 *
 * A hurricane tears and strips citrus leaves, but what stays on stays green. `TreeLayer` browns and
 * curls each leaf once its tree's `health` falls below that leaf's own mark, from 0.94 down, so
 * health stays this high through the storm and the flood, and the storm shows in foliage, damage,
 * fallen fruit and lean. The drowned roots' yellowing, `DECLINE_TABLE`, is the grove's only
 * yellowing, and the wrecks wilt and brown on the days after, `WRECK_TABLE`.
 */
export const STORM_TABLE = {
  /**
   * Leaves, fruit and limbs go in bursts at the fronts' peaks, over `burst` around each, to these
   * shares of a tree's storm loss, and a little more through the eye.
   */
  burst: [-0.2, 0.4] as const,
  shareAtPeaks: [0.15, 0.33, 0.5, 0.68, 0.88, 1] as const,
  shareThroughEye: 0.52,
  /**
   * The cycle seconds that little more goes over: none while the wind drops into the eye or comes
   * back out of it, as `TreeLayer`'s leaves in the air follow the wind of the moment and would draw
   * back upwind or swing round with it. A stopped loss ends their flights within a few frames.
   */
  throughEye: [HURRICANE.eyeOpen + 0.5, HURRICANE.eyeClose - 0.1] as const,
  /**
   * Limbs broken come down only in the deepest of the regrowth's night, to this share, since a
   * falling value replays limbs' flights, and these are best not seen.
   */
  limbsHealed: [55, 55.3] as const,
  limbsLeft: 0.18,
  /** How much of the lost leaves are back, by second, plus each tree's `flushDelay`. */
  recoveryKeys: [
    [49.2, 0],
    [50, 0.12],
    [50.4, 0.25],
    [51, 0.65],
    [51.4, 0.85],
    [52.2, 1]
  ] as readonly Key[],
  /** How hurt its leaves are, 0-1, by second, plus each tree's `flushDelay`. */
  hurtKeys: [
    [34.4, 0],
    [36.2, 0.25],
    [38.2, 0.45],
    [43.4, 0.92],
    [45.6, 1],
    [50.4, 0.4],
    [52.6, 0]
  ] as readonly Key[],
  /** The fruit year that was hanging when it came, and what becomes of its fruit. */
  fruitYear: 19,
  /** What fruit is still hanging drops over this, as the roots it lost tell. */
  restDrops: [49, 50.4] as const,
  /** Fallen and stranded, it browns over this, and shrinks away over this. */
  browns: [47.8, 49.6] as const,
  brown: [92, 70, 38] as Rgb,
  gone: [50.2, 50.8] as const,
  /**
   * The hero: a windward scaffold limb at 37.5, then most of its last leaves and two more limbs at
   * 42.2, one into the water at the culvert. It stands.
   */
  hero: {
    foliageKeys: [
      [34.7, 1],
      [35.3, 0.9],
      [36, 0.9],
      [36.6, 0.78],
      [37.3, 0.78],
      [37.9, 0.62],
      // Held while the wind drops into the eye and comes back, as `throughEye` says.
      [38.7, 0.62],
      [40.2, 0.6],
      [40.7, 0.6],
      [41.3, 0.55],
      [42, 0.55],
      [42.4, 0.2],
      [43.2, 0.2],
      [43.8, 0.17]
    ] as readonly Key[],
    damageKeys: [
      [34.7, 0],
      [35.3, 0.04],
      [36, 0.04],
      [36.6, 0.09],
      [37.3, 0.09],
      [37.9, 0.22],
      [42, 0.22],
      [42.6, 0.45],
      [55, 0.45],
      [55.3, 0.08]
    ] as readonly Key[],
    fruitFallenKeys: [
      [34.7, 0],
      [35.3, 0.2],
      [36, 0.2],
      [36.6, 0.4],
      [37.3, 0.4],
      [37.9, 0.6],
      [40.7, 0.6],
      [41.3, 0.7],
      [42, 0.7],
      [42.6, 0.85],
      [43.2, 0.85],
      [43.8, 0.9]
    ] as readonly Key[],
    health: 0.97
  },
  grove: {
    leafLoss: [0.4, 0.75] as const,
    damage: [0.25, 0.5] as const,
    fruitLoss: [0.6, 0.9] as const,
    flushDelay: [0.15, 0.7] as const,
    health: 0.96,
    /**
     * The trees right by the storm camera shed little and take less wind: each wall blows their
     * leaves straight at the lens, and their fruit drops on its banks.
     */
    byCamera: {x: [-31, -23] as const, y: [-1, 9] as const, leafLoss: 0.03, fruitLoss: 0.15}
  },
  /**
   * A brave lime flush by second, plus each tree's `flushDelay`: the hero's is 0, so it goes first.
   */
  flush: {rise: [49.2, 49.9] as const, fall: [51, 52] as const, strength: 0.9}
};

/**
 * Standing water drowns roots. A tree whose land the flood stood over for more than `days` turns
 * over `span`: chlorotic through `canopyColor`, so `TreeLayer`'s health ramp is untouched, half its
 * leaves brown, wilting and thinning, dropping the rest of its fruit and some twigs. The `dead`
 * lowest go further and faster, to grey twigs, and are replanted. The rest come back over `recover`,
 * and their twigs come back with the grove's limbs.
 */
export const DECLINE_TABLE = {
  days: 3,
  dead: 5,
  span: [49, 51] as const,
  /** `TreeLayer`'s own summer tint of citrus, which a declining tree turns from. */
  from: [33, 112, 29] as Rgb,
  color: [150, 158, 62] as Rgb,
  health: 0.5,
  foliage: 0.4,
  damage: 0.15,
  deadSpan: [49, 50.2] as const,
  deadHealth: 0.12,
  /** Fewer than 0.08, at which the dead still read as yellow rather than as grey twigs. */
  deadFoliage: 0.05,
  deadDamage: 0.25,
  /** As much decay as greys their wood without bringing them down. */
  deadDecay: 0.15,
  /** Seconds before its replant arrives that a skeleton starts to go. */
  deadGone: 0.8,
  recover: [53.4, 54.6] as const
};

/**
 * A wreck after it lands. The impact shakes its leaves down to `foliageAtLanding`, and the walls go
 * on stripping it as they strip the standing, with no regrowth. Then the days since it landed, on
 * the year track, tell, as they do for a downed citrus tree: its leaves stay green through the
 * flood (to 47.8), wilt over the third to sixth days (48.4-49.6), are brown by the tenth (50.4),
 * and its wood greys and it settles. Its dry leaves fall and its limbs give as it sags over the
 * months after, which the year track crosses in under a second, so those go by cycle second. It is
 * gone when its replacement arrives.
 */
export const WRECK_TABLE = {
  /** Leaves still on as it lands, of those the storm has left it, and from when they are shaken. */
  foliageAtLanding: 0.55,
  foliageShakenFrom: -1.2,
  /** Health by days since it landed: green, wilting, brown. */
  healthDays: [
    [0, 0.97],
    [1.8, 0.95],
    [4, 0.72],
    [6, 0.45],
    [10, 0.05]
  ] as readonly Key[],
  /** Cycle seconds its dry leaves fall over, from the eighth day, and the share still on after. */
  leavesFall: [50.2, 51.1] as const,
  leavesLeft: 0.12,
  /** Limbs snap at impact, then more as the wreck sags and dries, to `damageLate` as it goes. */
  damageAtImpact: 0.28,
  impactSpan: [-0.3, 0.2] as const,
  damageLate: 0.92,
  /** The cycle second it starts to sag, once the flood has gone down off it. */
  sagFrom: 47.8,
  /** How far it has rotted and settled by days since it landed: nothing while the flood stands. */
  decayDays: [
    [3, 0],
    [8, 0.26],
    [200, 0.45]
  ] as readonly Key[],
  /** Seconds before its replacement arrives over which it goes the rest of the way. */
  goneSeconds: 0.8,
  fruitFall: [-0.6, 0.6] as const
};

/** Days in a film year, for what the days after the storm do. */
const DAYS_PER_YEAR = 365;

/** Each replant's sequence in seconds from its own start, and where those starts fall. */
export const REPLANT_TABLE = {
  starts: [51.5, 52.9] as const,
  /** Starts are spread evenly over the gaps, then nudged by this. */
  startJitter: 0.2,
  /** Effective age when planted, in years on the hero's curve. */
  age: 1,
  hole: [0, 0.4] as const,
  appear: [0.15, 0.55] as const,
  lower: [0.3, 1] as const,
  liftHeight: 0.55,
  close: [1, 1.4] as const,
  berm: [1.1, 1.6] as const,
  water: [1.4, 2.2] as const,
  waterDries: [2.2, 2.8] as const,
  /** The site's berm wears away by these film years. */
  bermWear: [22, 24.5] as const,
  rootBall: {radius: 0.12, height: 0.18, roots: 0.8},
  /**
   * Net: quick down over the young tree and cinched. Once the tree fills it, its tie is cut and it
   * comes off in a wave across the grove, west to east, by cycle second, as a grower pulls one off
   * by hand: it rides up off the crown about a metre, comes loose and crumples, and is gone. It is
   * never carried off on the wind, so `lift` stays low and only leans its top downwind.
   */
  netDescent: [-0.1, 0.5] as const,
  netCinch: [0.4, 0.85] as const,
  netBillow: 0.06,
  netBillowSpan: [0.1, 0.45, 0.7, 1.4] as const,
  netStrain: [53.3, 53.8] as const,
  /**
   * The second the first starts to come off, the seconds the wave takes, and each one's jitter: the
   * last are gone in the dusk, by 55.15.
   */
  netLiftFrom: 53.7,
  netLiftAcross: 0.4,
  netLiftJitter: 0.12,
  /** Seconds from its tie being cut to its starting to come off, and from that to its being gone. */
  netSlitBefore: 0.3,
  netLiftSeconds: 0.9,
  /** How high it rides off the crown, as `StoryNet.descent`: 0.78 is about a metre. */
  netLiftDescent: 0.78,
  /** The `lift` it comes to, and how much of its strain it loses as it comes loose. */
  netLiftMost: 0.15,
  netLiftLoosen: 0.8,
  /** Seconds at the end over which it crumples and shrinks away. */
  netGoneSeconds: 0.3,
  netLiftBearing: 75,
  microjetReach: 0.85,
  microjetAppear: [1.3, 1.7] as const,
  microjetSpray: [1.5, 1.9, 2.8, 3.4] as const
};

/** The crop. A box is `fruitPerBox` fruit, and blossoms come in many more than set fruit. */
export const CROP_TABLE = {
  fruitPerBox: 200,
  blossomsPerFruit: 8,
  /**
   * A mature orange opens tens of thousands of blossoms for every few hundred fruit it sets, and a
   * Valencia's full bloom, with the old crop still hanging, is the finale. So the hero blooms as
   * fully as `TreeLayer` can show: five blossoms to each of its 3,000 crop anchors, of which those
   * born by its growth show. The grove keeps its own cap, so a grove of many trees costs what it did.
   */
  heroBlossomsPerFruit: 40,
  heroBlossomCap: 15000,
  groveBlossomCap: 1600,
  /** Grove trees are smaller than the hero, and carry this much of what it carries at an age. */
  groveShare: 0.36,
  /** Boxes on the hero's curve by a tree's own age, before the storm. */
  groveBoxesByAgeKeys: [
    [3, 0.1],
    [7, 2],
    [14, 4.5],
    [20, 5.3],
    [30, 7]
  ] as readonly Key[],
  /** The grove's crop by fruit year, as a share of a normal one: the storm's hurt, and recovery. */
  groveRecoveryKeys: [
    [19, 1],
    [20, 0.12],
    [21, 0.4],
    [22, 0.7],
    [23, 1]
  ] as readonly Key[],
  /**
   * The last crop is still hanging when the film ends, with the next bloom, as a Valencia's does. A
   * healthy, netted tree drops a few percent of it by March 1: `lastFruitFallen` drops fresh from
   * the tree in the last days, which `TreeLayer` shows as about 3% of the crop, and
   * `lastFruitDropped` of it, about 2% more, has lain a while, bruised and softening, each fruit in
   * its own time. That comes over `lastFruitDroppedSpan` of the crop's year, in the regrowth's
   * night, and needs no fall.
   */
  lastFruitYear: 29,
  lastFruitFallen: 0.05,
  lastFruitDropped: 0.018,
  lastFruitDroppedSpan: [0.3, 0.5] as const,
  blossom: {color: [255, 252, 240, 255], radius: 0.018},
  fruit: {
    color: [244, 140, 24, 255],
    unripeColor: [86, 128, 44, 255],
    startRadius: 0.006,
    fullRadius: 0.04
  },
  /**
   * Blossom and flush soften when years pass faster than this per second, so they do not strobe.
   */
  fastYears: 1,
  fastestShare: 0.45
};

/**
 * The flush each spring, within a blossom year, and the new growth of a tree in its first years.
 * A young tree is mostly new growth, so its spring flush is most of it. A mature one's is a light
 * fringe at the shoot tips over its dark old leaves, so the flush's strength falls with age.
 */
export const FLUSH_TABLE = {
  rise: [0, 0.04] as const,
  fall: [0.08, 0.2] as const,
  /** The spring flush's strength by a tree's age, in years on the hero's curve. */
  strengthByAgeKeys: [
    [2, 0.85],
    [6, 0.72],
    [12, 0.55],
    [20, 0.42],
    [28, 0.35]
  ] as readonly Key[],
  firstYearsKeys: [
    [0.04, 0.7],
    [0.25, 0.6],
    [1, 0.4],
    [1.5, 0.2],
    [2, 0]
  ] as readonly Key[]
};

/**
 * What hits water: the crown of each forced fall that has `splash` as it lands, the first wall's
 * across the furrow's water and the second wall's into the flood, and the hero's limb at the
 * culvert's west mouth. Each is listed for `lasts` scene seconds after it hits.
 */
export const SPLASH_TABLE = {
  lasts: 4,
  /** Of a falling tree's live height, how far up its trunk the middle of its crown is. */
  crownCentre: 0.62,
  limb: {t: 42.6, position: [-5.5, 3.8] as const, size: 0.8}
};

/** A step of a tree's lean: when a front reaches it, and the degrees it leans for good and rocks. */
export type GroveHeelStep = {at: number; permanent: number; rock: number};

/** One tree's fixed plan. */
export type GrovePlanRow = {
  index: number;
  kind: 'hero' | 'grove' | 'replant';
  position: Vec3;
  /** Metres: the land under its trunk, from `getLandHeight`. */
  elevation: number;
  /** `characteristics.seed`. */
  seed: number;
  height: number;
  crownRadius: number;
  /** Film year it goes in the ground. */
  plantYear: number;
  /** Its effective age when it does, in years on the hero's curve. */
  plantAge: number;
  /** The second the ring reaches it, or its replanting begins. */
  arrival: number;
  /** Its share of the wind, `TreeSpec.wind` over `wind.strength`, in the first wall and the second. */
  exposure: [number, number];
  /** Radians: its phase in `TreeLayer`'s gusts, as the layer makes it from its position. */
  windPhase: number;
  /**
   * How it rocks and leans in the storm, toward `bearing`, and the second the crews start to set it
   * back up, if they do. `null` if it stays upright.
   */
  heel: {bearing: number; steps: GroveHeelStep[]; reset: number | null} | null;
  /** How it falls, if it does. */
  fall: {
    start: number;
    seconds: number;
    /** Compass bearing it falls toward. */
    bearing: number;
    wall: 1 | 2;
    year: number;
    /** Sharpness of its sinh topple. */
    topple: number;
    /** Or the power of time its topple goes as, if it does not go as a sinh. */
    power: number | null;
    /** Degrees it leans as it starts to go: where its rocking left it. */
    from: number;
    /** Fractional year it lands in, from which its days as a wreck are counted. */
    landedYear: number;
    /** The second it has rotted away, as its replacement arrives. */
    decayEnd: number;
  } | null;
  /** What standing water does to its roots, if it stood in it more than `DECLINE_TABLE.days`. */
  decline: {
    /** Calendar days the flood stood over its land. */
    days: number;
    dies: boolean;
    /** For the dead, the second its skeleton is gone, as its replacement arrives. */
    goneAt: number;
  } | null;
  /** Index of the row that replaces it, or `null`. */
  replacement: number | null;
  /** Index of the row it replaces, or `null`. */
  replaces: number | null;
  /** What the storm does to it, if it stands. */
  storm: {
    leafLoss: number;
    damage: number;
    fruitLoss: number;
    flushDelay: number;
  };
};

/** A row's objects, whose numbers are written in place. */
type RowState = {
  tree: TreeSpec;
  lean: TreeLean;
  blossom: CropConfig;
  fruit: CropConfig;
  /** Its own `unripeColor` and declining `canopyColor`, written in place. */
  unripe: [number, number, number, number];
  canopy: [number, number, number, number];
};

const getMagicRingRadius = createTrack(MAGIC_TABLE.ringRadiusKeys);
const getMagicRingStrength = createTrack(MAGIC_TABLE.ringStrengthKeys);
const getRowReach = createTrack(MAGIC_TABLE.rowReachKeys);
const getRowStrength = createTrack(MAGIC_TABLE.rowStrengthKeys);
const getRecovery = createTrack(STORM_TABLE.recoveryKeys);
const getHurt = createTrack(STORM_TABLE.hurtKeys);
const getHeroFoliage = createTrack(STORM_TABLE.hero.foliageKeys);
const getHeroDamage = createTrack(STORM_TABLE.hero.damageKeys);
const getHeroFruitFallen = createTrack(STORM_TABLE.hero.fruitFallenKeys);
const getGroveBoxesAtAge = createTrack(CROP_TABLE.groveBoxesByAgeKeys);
const getGroveRecovery = createTrack(CROP_TABLE.groveRecoveryKeys);
const getFirstYearsFlush = createTrack(FLUSH_TABLE.firstYearsKeys);
const getFlushStrength = createTrack(FLUSH_TABLE.strengthByAgeKeys);
const getWreckHealth = createTrack(WRECK_TABLE.healthDays);
const getWreckDecay = createTrack(WRECK_TABLE.decayDays);

/**
 * Keys of a storm share that steps up in a burst at each front's peak, and creeps through the eye.
 */
function getStormShareKeys(): Key[] {
  const {burst, shareAtPeaks, shareThroughEye, throughEye} = STORM_TABLE;
  const keys: Key[] = [];
  let share = 0;
  HURRICANE.gustPeaks.forEach((peak, index) => {
    keys.push([peak + burst[0], share], [peak + burst[1], shareAtPeaks[index]]);
    share = shareAtPeaks[index];
    if (index === 2) {
      keys.push([throughEye[0], share], [throughEye[1], shareThroughEye]);
      share = shareThroughEye;
    }
  });
  return keys;
}

const STRIP_KEYS = getStormShareKeys();
/** Share of a tree's leaf and fruit loss so far. */
const getStrip = createTrack(STRIP_KEYS);
/** Share of a tree's limbs broken so far, which come down in the regrowth's night. */
const getLimbs = createTrack([
  ...STRIP_KEYS,
  [STORM_TABLE.limbsHealed[0], 1],
  [STORM_TABLE.limbsHealed[1], STORM_TABLE.limbsLeft]
]);

/** The second the ring reaches a distance from the hero. */
function getRingArrival(distance: number): number {
  const keys = MAGIC_TABLE.ringRadiusKeys;
  let low = keys[0][0];
  let high = keys[keys.length - 1][0];
  for (let i = 0; i < 40; i++) {
    const middle = (low + high) / 2;
    if (getMagicRingRadius(middle) < distance) low = middle;
    else high = middle;
  }
  return high;
}

/** Grove positions before jitter, nearest the hero first. */
function getGridPositions(): {x: number; y: number}[] {
  const {rowSpacing, treeSpacing, rows, columns, heroRowOffsets, heroClearance} = GROVE_LAYOUT;
  const positions: {x: number; y: number}[] = [];
  for (let row = rows[0]; row <= rows[1]; row++) {
    if (row === 0) {
      for (const offset of heroRowOffsets) {
        positions.push({x: offset, y: 0}, {x: -offset, y: 0});
      }
    } else {
      for (let column = columns[0]; column <= columns[1]; column++) {
        const isHeroNeighbour = column === 0 && Math.abs(row) === 1;
        positions.push({
          x: column * treeSpacing,
          y: isHeroNeighbour ? Math.sign(row) * heroClearance : row * rowSpacing
        });
      }
    }
  }
  return positions.sort(
    (a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) || a.x - b.x || a.y - b.y
  );
}

function isInBox(
  x: number,
  y: number,
  box: {x: readonly [number, number]; y: readonly [number, number]}
): boolean {
  return x >= box.x[0] && x <= box.x[1] && y >= box.y[0] && y <= box.y[1];
}

/** Radians: a tree's phase in `TreeLayer`'s gusts, which the layer makes from its position. */
function getWindPhase(position: Vec3): number {
  const seed =
    ((Math.round(position[0] * 10000) * 92821) ^ (Math.round(position[1] * 10000) * 65537)) >>> 0;
  return (seed / 4294967296) * Math.PI * 2;
}

/** The block of grove positions, which the wind crosses to reach a tree. */
type Block = {x: [number, number]; y: [number, number]};

/** Metres from a point to the edge of the block, along a direction. */
function getFetch(x: number, y: number, [dx, dy]: [number, number], block: Block): number {
  let fetch = Infinity;
  if (dx < -1e-9) fetch = Math.min(fetch, (x - block.x[0]) / -dx);
  else if (dx > 1e-9) fetch = Math.min(fetch, (block.x[1] - x) / dx);
  if (dy < -1e-9) fetch = Math.min(fetch, (y - block.y[0]) / -dy);
  else if (dy > 1e-9) fetch = Math.min(fetch, (block.y[1] - y) / dy);
  return Math.max(0, fetch);
}

/** A grove tree's share of each wall's wind, by how much grove that wind crosses to reach it. */
function getGroveExposure(x: number, y: number, block: Block): [number, number] {
  const {lee, edge, depth, byCamera} = EXPOSURE_TABLE;
  if (isInBox(x, y, STORM_TABLE.grove.byCamera)) return [byCamera, byCamera];
  const [wx, wy] = getBearingVector(HURRICANE.firstWallBearing);
  // The first wall comes from the south-south-west, the second from the opposite way.
  const first = getFetch(x, y, [-wx, -wy], block);
  const second = getFetch(x, y, [wx, wy], block);
  return [
    lee + (edge - lee) * Math.exp(-first / depth),
    lee + (edge - lee) * Math.exp(-second / depth)
  ];
}

/**
 * Seconds after a front peaks at `HURRICANE.viewPoint` that it reaches a point, carried downwind in
 * the first wall. In the second, which blows the other way, it is the same less.
 */
function getFrontDelay(x: number, y: number): number {
  const [wx, wy] = getBearingVector(HURRICANE.firstWallBearing);
  const [vx, vy] = HURRICANE.viewPoint;
  return ((x - vx) * wx + (y - vy) * wy) / HEEL_TABLE.frontSpeed;
}

/** Peaks of a wall's fronts at the view point. */
function getWallPeaks(wall: 1 | 2): readonly number[] {
  return wall === 1 ? HURRICANE.gustPeaks.slice(0, 3) : HURRICANE.gustPeaks.slice(3);
}

/** How a rock goes, 0-1, by seconds from the front: up before it, and dying away after. */
function getRock(since: number): number {
  const {rockRise, rockFall} = HEEL_TABLE;
  return since < 0 ? smoothstep(-rockRise, 0, since) : 1 - smoothstep(0, rockFall, since);
}

/**
 * Degrees a tree leans for good by second `t`, and degrees its rocks add, before any gust follows
 * them.
 */
function getHeelParts(steps: readonly GroveHeelStep[], t: number): [number, number] {
  const {step} = HEEL_TABLE;
  let permanent = 0;
  let rock = 0;
  for (const {at, permanent: degrees, rock: rocks} of steps) {
    permanent += degrees * smoothstep(at + step[0], at + step[1], t);
    rock += rocks * getRock(t - at);
  }
  return [permanent, rock];
}

/**
 * Which grove positions fall, each with its wall, and the forced fall it is, if it is one.
 */
function chooseFalls(
  positions: {x: number; y: number}[]
): Map<number, {wall: 1 | 2; forced?: ForcedFall}> {
  const {forced, standing, fraction, swathScale, swathWeight, firstWallShare, heroClear} =
    FALL_TABLE;
  const chosen = new Map<number, {wall: 1 | 2; forced?: ForcedFall}>();
  positions.forEach((position, index) => {
    const fall = forced.find(({x, y}) => x === position.x && y === position.y);
    if (fall) chosen.set(index, {wall: fall.wall, forced: fall});
  });
  const isClear = ({x, y}: {x: number; y: number}) =>
    !isInBox(x, y, standing) && Math.hypot(x, y) >= heroClear;
  const ranked = positions
    .map((position, index) => ({
      index,
      position,
      score:
        hash01(index, 53) +
        swathWeight *
          (smoothNoise(position.x * swathScale + 40, 51) +
            smoothNoise(position.y * swathScale + 80, 52))
    }))
    .filter(({index, position}) => !chosen.has(index) && isClear(position))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const wanted = Math.round(positions.length * fraction);
  for (const {index} of ranked) {
    if (chosen.size >= wanted) break;
    chosen.set(index, {wall: hash01(index, 54) < firstWallShare ? 1 : 2});
  }
  return chosen;
}

/**
 * The steps by which a leaner goes over toward its wall, to `degrees` once the storm has gone, and a
 * first-wall leaner further, as the second pushes it back.
 */
function getLeanerSteps(wall: 1 | 2, degrees: number, delay: number): GroveHeelStep[] {
  const {steps, rock, backStep, backRock} = LEAN_TABLE;
  const back = getWallPeaks(2);
  const most = wall === 1 ? degrees / (1 - back.length * backStep) : degrees;
  const own = getWallPeaks(wall).map((peak, index) => ({
    at: peak + (wall === 1 ? delay : -delay),
    permanent: most * steps[index],
    rock: most * rock
  }));
  if (wall === 2) return own;
  return [
    ...own,
    ...back.map(peak => ({at: peak - delay, permanent: -most * backStep, rock: -most * backRock}))
  ];
}

function createPlan(): GrovePlanRow[] {
  const {hero, grove, seeds} = TREE_SIZES;
  const heroPosition: Vec3 = [0, 0, 0];
  const plan: GrovePlanRow[] = [
    {
      index: 0,
      kind: 'hero',
      position: heroPosition,
      elevation: getLandHeight(0, 0),
      seed: hero.seed,
      height: hero.height,
      crownRadius: hero.crownRadius,
      plantYear: 0,
      plantAge: 0,
      arrival: 0,
      exposure: [EXPOSURE_TABLE.hero, EXPOSURE_TABLE.hero],
      windPhase: getWindPhase(heroPosition),
      heel: null,
      fall: null,
      decline: null,
      replacement: null,
      replaces: null,
      storm: {leafLoss: 0, damage: 0, fruitLoss: 0, flushDelay: 0}
    }
  ];

  const positions = getGridPositions();
  const falls = chooseFalls(positions);
  const block: Block = {
    x: [Math.min(...positions.map(({x}) => x)), Math.max(...positions.map(({x}) => x))],
    y: [Math.min(...positions.map(({y}) => y)), Math.max(...positions.map(({y}) => y))]
  };
  const firstWind = getBearingVector(HURRICANE.firstWallBearing);
  const downwind = positions.map(({x, y}) => x * firstWind[0] + y * firstWind[1]);
  const upwindEnd = Math.min(...downwind);
  const downwindEnd = Math.max(...downwind);

  positions.forEach(({x, y}, gridIndex) => {
    const id = 1000 + gridIndex;
    const {jitter} = GROVE_LAYOUT;
    const {leafLoss, damage, fruitLoss, flushDelay, byCamera} = STORM_TABLE.grove;
    const position: Vec3 = [
      x + hashRange(id, 1, -jitter, jitter),
      y + hashRange(id, 2, -jitter, jitter),
      0
    ];
    const going = falls.get(gridIndex);
    let fall: GrovePlanRow['fall'] = null;
    let heel: GrovePlanRow['heel'] = null;
    if (going) {
      const {forced} = going;
      const wallBearing = HURRICANE.firstWallBearing + (going.wall === 1 ? 0 : 180);
      const bearing =
        forced?.bearing ??
        (forced
          ? wallBearing
          : wallBearing + hashRange(id, 5, -FALL_TABLE.bearingSpread, FALL_TABLE.bearingSpread));
      let start: number;
      let seconds: number;
      if (forced) {
        // These stand by the view point, so their fronts come as they peak there.
        start = forced.start;
        seconds = forced.seconds;
        heel = {
          bearing,
          steps: forced.heel.map(([at, permanent, rock]) => ({at, permanent, rock})),
          reset: null
        };
      } else {
        // A wave runs through each wall's falls with the wind, each tree with a start of its own.
        const span = going.wall === 1 ? HURRICANE.firstWallFalls : HURRICANE.secondWallFalls;
        const along = (downwind[gridIndex] - upwindEnd) / (downwindEnd - upwindEnd);
        const jolt = hashRange(id, 3, -FALL_TABLE.startJitter, FALL_TABLE.startJitter);
        start = clamp(
          lerp(span[0], span[1], going.wall === 1 ? along : 1 - along) + jolt,
          span[0],
          span[1]
        );
        const doneBy = going.wall === 1 ? FALL_TABLE.firstWallDoneBy : FALL_TABLE.secondWallDoneBy;
        seconds = clamp(
          hashRange(id, 4, FALL_TABLE.seconds[0], FALL_TABLE.seconds[1]),
          FALL_TABLE.seconds[0],
          Math.max(FALL_TABLE.seconds[0], doneBy - start)
        );
      }
      const [permanent, rock] = heel ? getHeelParts(heel.steps, start) : [0, 0];
      fall = {
        start,
        seconds,
        bearing,
        wall: going.wall,
        year: getYear(start),
        topple: forced?.topple ?? FALL_TABLE.topple,
        power: forced?.power ?? null,
        from: permanent + rock,
        landedYear: getYear(start + seconds),
        decayEnd: 0
      };
    }
    const sheltered = isInBox(x, y, byCamera);
    plan.push({
      index: plan.length,
      kind: 'grove',
      position,
      elevation: getLandHeight(position[0], position[1]),
      seed: seeds[Math.floor(hash01(id, 6) * seeds.length)],
      height: grove.height * (1 + hashRange(id, 7, -grove.heightSpread, grove.heightSpread)),
      crownRadius:
        grove.crownRadius * (1 + hashRange(id, 8, -grove.crownSpread, grove.crownSpread)),
      plantYear: MAGIC_TABLE.year,
      plantAge: MAGIC_TABLE.age + hashRange(id, 9, -MAGIC_TABLE.ageSpread, MAGIC_TABLE.ageSpread),
      arrival:
        getRingArrival(Math.hypot(x, y)) +
        hashRange(id, 10, -MAGIC_TABLE.delaySpread, MAGIC_TABLE.delaySpread),
      exposure: getGroveExposure(x, y, block),
      windPhase: getWindPhase(position),
      heel,
      fall,
      decline: null,
      replacement: null,
      replaces: null,
      storm: {
        leafLoss: sheltered ? byCamera.leafLoss : hashRange(id, 11, leafLoss[0], leafLoss[1]),
        damage: hashRange(id, 12, damage[0], damage[1]),
        fruitLoss: sheltered ? byCamera.fruitLoss : hashRange(id, 13, fruitLoss[0], fruitLoss[1]),
        flushDelay: hashRange(id, 18, flushDelay[0], flushDelay[1])
      }
    });
  });

  const survivors = plan.filter(row => row.kind === 'grove' && !row.fall);

  // Leaners: a share of the survivors, from those clear of the cameras that come close.
  const {share, degrees, bearingSpread, heroClear, finale} = LEAN_TABLE;
  const candidates = survivors
    .filter(({position: [x, y]}) => {
      return (
        !isInBox(x, y, FALL_TABLE.standing) &&
        !isInBox(x, y, finale) &&
        Math.hypot(x, y) >= heroClear
      );
    })
    .sort((a, b) => hash01(a.index, 19) - hash01(b.index, 19) || a.index - b.index);
  for (const row of candidates.slice(0, Math.round(survivors.length * share))) {
    const wall: 1 | 2 = hash01(row.index, 20) < 0.5 ? 1 : 2;
    row.heel = {
      bearing:
        HURRICANE.firstWallBearing +
        (wall === 1 ? 0 : 180) +
        hashRange(row.index, 22, -bearingSpread, bearingSpread),
      steps: getLeanerSteps(
        wall,
        hashRange(row.index, 21, degrees[0], degrees[1]),
        getFrontDelay(row.position[0], row.position[1])
      ),
      reset: null
    };
  }

  // Standing water: those under it too long decline, and the lowest of them die.
  const declining = survivors
    .map(row => ({row, days: getDaysUnderWater(row.elevation)}))
    .filter(({days}) => days > DECLINE_TABLE.days);
  for (const {row, days} of declining) row.decline = {days, dies: false, goneAt: 0};
  const lowest = [...declining].sort(
    (a, b) => a.row.elevation - b.row.elevation || b.days - a.days || a.row.index - b.row.index
  );
  for (const {row} of lowest.slice(0, DECLINE_TABLE.dead)) {
    (row.decline as NonNullable<GrovePlanRow['decline']>).dies = true;
  }

  // The crews set the living leaners back up while they replant, one after another.
  const {reset, resetSeconds} = LEAN_TABLE;
  for (const row of survivors) {
    if (row.heel && !row.decline?.dies) {
      row.heel.reset = hashRange(row.index, 23, reset[0], reset[1] - resetSeconds);
    }
  }

  // Each gap's replacement stands exactly where its tree did, and starts as the old one is gone.
  const {starts, startJitter} = REPLANT_TABLE;
  const gaps = plan
    .filter(row => row.fall || row.decline?.dies)
    .sort((a, b) => hash01(a.index, 61) - hash01(b.index, 61) || a.index - b.index);
  gaps.forEach((gap, place) => {
    const id = 3000 + gap.index;
    const start = clamp(
      lerp(starts[0], starts[1], place / Math.max(1, gaps.length - 1)) +
        hashRange(id, 1, -startJitter, startJitter),
      starts[0],
      starts[1]
    );
    if (gap.fall) gap.fall.decayEnd = start;
    if (gap.decline) gap.decline.goneAt = start;
    gap.replacement = plan.length;
    plan.push({
      index: plan.length,
      kind: 'replant',
      position: gap.position,
      elevation: gap.elevation,
      seed: seeds[Math.floor(hash01(id, 2) * seeds.length)],
      height: gap.height,
      crownRadius: gap.crownRadius,
      plantYear: getYear(start),
      plantAge: REPLANT_TABLE.age,
      arrival: start,
      exposure: gap.exposure,
      windPhase: gap.windPhase,
      heel: null,
      fall: null,
      decline: null,
      replacement: null,
      replaces: gap.index,
      storm: {leafLoss: 0, damage: 0, fruitLoss: 0, flushDelay: 0}
    });
  });
  return plan;
}

/** Every tree that ever exists, in the film's fixed order. */
export const GROVE_PLAN: readonly GrovePlanRow[] = createPlan();

const FIRST_REPLANT_ROW = GROVE_PLAN.findIndex(row => row.kind === 'replant');

/** Where each replant's microjet stands, beside it on its own land. */
const MICROJET_POSITIONS: readonly Vec3[] = GROVE_PLAN.map(row => {
  const [x, y] = getBearingVector(hashRange(row.index, 72, 0, 360));
  const at: [number, number] = [
    row.position[0] + x * REPLANT_TABLE.microjetReach,
    row.position[1] + y * REPLANT_TABLE.microjetReach
  ];
  return [at[0], at[1], getLandHeight(at[0], at[1])];
});

/**
 * The second the storm's fruit year ends, when the next crop's fruit takes its slot: the storm's
 * fruit is gone just before.
 */
const STORM_FRUIT_ENDS = getSecondOfYear(STORM_TABLE.fruitYear + 1 + CROP_CALENDAR.fruitLag);
const STORM_FRUIT_GONE: [number, number] = [
  Math.min(STORM_TABLE.gone[0], STORM_FRUIT_ENDS - 0.3),
  Math.min(STORM_TABLE.gone[1], STORM_FRUIT_ENDS - 0.02)
];

/**
 * Where a crown that lands at `t` hits the water, `reach` metres along its fall from its trunk: at
 * its middle if the water stands over the land there, or else where its fall crosses the middle of
 * the nearest furrow, if that is within its live height. `null` if it hits none.
 */
function getSplashPoint(row: GrovePlanRow, t: number, reach: number, height: number): Vec3 | null {
  const [dx, dy] = getBearingVector((row.fall as NonNullable<GrovePlanRow['fall']>).bearing);
  const [x0, y0] = row.position;
  const level = getWaterLevel(t);
  const middle: Vec3 = [x0 + dx * reach, y0 + dy * reach, level];
  if (getLandHeight(middle[0], middle[1]) < level) return middle;
  const {furrowAt, bedSpacing} = BED_LAYOUT;
  const furrow = furrowAt + bedSpacing * Math.round((middle[1] - furrowAt) / bedSpacing);
  const along = Math.abs(dy) > 1e-6 ? (furrow - y0) / dy : -1;
  if (along <= 0 || along > height) return null;
  return [x0 + dx * along, furrow, level];
}

/** Splashes in the flood, where and when each hits. */
const SPLASHES: readonly {t: number; x: number; y: number; size: number}[] = [
  ...GROVE_PLAN.flatMap(row => {
    const forced = FALL_TABLE.forced.find(
      fall =>
        fall.splash &&
        Math.abs(fall.x - row.position[0]) < 0.5 &&
        Math.abs(fall.y - row.position[1]) < 0.5
    );
    if (!row.fall || !forced?.splash) return [];
    const t = row.fall.start + row.fall.seconds;
    const growth = getGrowthAtAge(row.plantAge + Math.max(0, getYear(t) - row.plantYear));
    const height = row.height * getHeightFraction(growth);
    const point = getSplashPoint(row, t, SPLASH_TABLE.crownCentre * height, height);
    return point ? [{t, x: point[0], y: point[1], size: forced.splash}] : [];
  }),
  {
    t: SPLASH_TABLE.limb.t,
    x: SPLASH_TABLE.limb.position[0],
    y: SPLASH_TABLE.limb.position[1],
    size: SPLASH_TABLE.limb.size
  }
].sort((a, b) => a.t - b.t);

const ROW_STATES: readonly RowState[] = GROVE_PLAN.map(row => {
  const {blossom, fruit} = CROP_TABLE;
  const lean: TreeLean = [0, 0];
  const unripe: [number, number, number, number] = [
    fruit.unripeColor[0],
    fruit.unripeColor[1],
    fruit.unripeColor[2],
    fruit.unripeColor[3]
  ];
  const canopy: [number, number, number, number] = [
    DECLINE_TABLE.from[0],
    DECLINE_TABLE.from[1],
    DECLINE_TABLE.from[2],
    255
  ];
  const blossomSlot: CropConfig = {
    kind: 'flower',
    color: [blossom.color[0], blossom.color[1], blossom.color[2], blossom.color[3]],
    radius: blossom.radius,
    count: 0,
    fallen: 0
  };
  const fruitSlot: CropConfig = {
    kind: 'fruit',
    color: [fruit.color[0], fruit.color[1], fruit.color[2], fruit.color[3]],
    unripeColor: unripe,
    radius: fruit.startRadius,
    ripeness: 0,
    count: 0,
    droppedCount: 0,
    fallen: 0
  };
  const tree: TreeSpec = {
    position: row.position,
    species: 'citrus',
    height: row.height,
    crownRadius: row.crownRadius,
    elevation: row.elevation,
    characteristics: {seed: row.seed},
    growth: 0,
    health: 1,
    foliage: 1,
    flush: 0,
    lean,
    damage: 0,
    decay: 0,
    wind: 0,
    canopyColor: null,
    crop: [blossomSlot, fruitSlot]
  };
  return {tree, lean, blossom: blossomSlot, fruit: fruitSlot, unripe, canopy};
});

/**
 * The rows, whose identity lasts from frame to frame. Numbers are rewritten by each `writeTrees`.
 */
const TREES: TreeSpec[] = ROW_STATES.map(state => state.tree);

/** A tree that is not there, or a standing one before anything has happened to it. */
function resetRow({tree, lean, blossom, fruit, unripe}: RowState, row: GrovePlanRow): void {
  const green = CROP_TABLE.fruit.unripeColor;
  tree.elevation = row.elevation;
  tree.growth = 0;
  tree.health = 1;
  tree.foliage = 1;
  tree.flush = 0;
  lean[0] = 0;
  lean[1] = 0;
  tree.damage = 0;
  tree.decay = 0;
  tree.wind = 0;
  tree.canopyColor = null;
  blossom.count = 0;
  blossom.fallen = 0;
  fruit.count = 0;
  fruit.droppedCount = 0;
  fruit.fallen = 0;
  fruit.ripeness = 0;
  fruit.radius = CROP_TABLE.fruit.startRadius;
  unripe[0] = green[0];
  unripe[1] = green[1];
  unripe[2] = green[2];
}

/**
 * How much of a yearly pulse to show when years pass quickly, so it stays a rhythm, not a strobe.
 */
function getFastYearsShare(rate: number): number {
  const fast = rate / CROP_TABLE.fastYears;
  return lerp(CROP_TABLE.fastestShare, 1, 1 / (1 + fast * fast));
}

/** What a tree's share of the storm's fruit loss becomes once the roots tell: all of it. */
function getStormFruitFallen(share: number, t: number): number {
  return lerp(share, 1, smoothstep(STORM_TABLE.restDrops[0], STORM_TABLE.restDrops[1], t));
}

/**
 * Writes the calendar's blossoms and fruit, from a tree's boxes at this bloom and this fruit year,
 * and the blossoms each fruit's worth of them opens. The storm's fruit stays green, falls as the
 * storm and the drowned roots say, browns where it lies and shrinks away before the next crop sets.
 */
function writeCrop(
  state: RowState,
  t: number,
  year: number,
  rate: number,
  bloomBoxes: number,
  fruitBoxes: number,
  blossomsPerFruit: number,
  blossomCap: number,
  stormFruitFall: number
): void {
  const {blossom, fruit, unripe} = state;
  const {fruitPerBox, lastFruitYear, lastFruitFallen, lastFruitDropped, lastFruitDroppedSpan} =
    CROP_TABLE;
  const bloom = getBloomYear(year);
  let gone = getSpanFromStart(CROP_CALENDAR.blossomGone, bloom.phase, rate);
  let fallen = getSpanFromStart(CROP_CALENDAR.petalFall, bloom.phase, rate);
  if (bloom.index === MAGIC_TABLE.year) {
    // The magic's bloom holds until the camera is high, then goes with a few petals let fall.
    gone = smoothstep(MAGIC_TABLE.bloomGoes[0], MAGIC_TABLE.bloomGoes[1], t);
    fallen = MAGIC_TABLE.bloomFallen * gone;
  }
  blossom.count =
    Math.min(blossomCap, bloomBoxes * fruitPerBox * blossomsPerFruit) *
    getFastYearsShare(rate) *
    getSpanFromStart(CROP_CALENDAR.bloomRise, bloom.phase, rate) *
    (1 - gone);
  blossom.fallen = fallen;

  const crop = getFruitYear(year);
  const isLast = crop.index >= lastFruitYear;
  const fall = getSpanToEnd(CROP_CALENDAR.fruitFall, crop.phase, rate);
  const swell = getSpanFromStart(CROP_CALENDAR.fruitSwell, crop.phase, rate);
  const full = fruitBoxes * fruitPerBox;
  fruit.count =
    full *
    getSpanFromStart(CROP_CALENDAR.fruitSet, crop.phase, rate) *
    (isLast ? 1 : 1 - getSpanToEnd(CROP_CALENDAR.fruitGone, crop.phase, rate));
  fruit.radius = lerp(
    CROP_TABLE.fruit.startRadius,
    CROP_TABLE.fruit.fullRadius,
    1 - (1 - swell) * (1 - swell)
  );
  fruit.fallen = isLast ? fall * lastFruitFallen : fall;
  fruit.droppedCount = isLast
    ? full * lastFruitDropped * getSpanFromStart(lastFruitDroppedSpan, crop.phase, rate)
    : 0;
  if (crop.index === STORM_TABLE.fruitYear) {
    // What the storm brought down was green, and stays so, and goes brown where it lies.
    fruit.ripeness = 0;
    fruit.fallen = Math.max(fruit.fallen as number, stormFruitFall);
    const brown = smoothstep(STORM_TABLE.browns[0], STORM_TABLE.browns[1], t);
    const green = CROP_TABLE.fruit.unripeColor;
    for (let channel = 0; channel < 3; channel++) {
      unripe[channel] = lerp(green[channel], STORM_TABLE.brown[channel], brown);
    }
    fruit.count *= 1 - smoothstep(STORM_FRUIT_GONE[0], STORM_FRUIT_GONE[1], t);
  } else {
    fruit.ripeness = getSpanFromStart(CROP_CALENDAR.colorBreak, crop.phase, rate);
  }
}

/**
 * The spring flush each year, as strong as a tree of `age` puts out, or a storm's, or a young
 * tree's new growth, whichever is most.
 */
function getFlush(
  year: number,
  age: number,
  rate: number,
  stormFlush: number,
  young: number
): number {
  const {rise, fall} = FLUSH_TABLE;
  const {phase} = getBloomYear(year);
  const spring =
    getSpanFromStart(rise, phase, rate) *
    (1 -
      smoothstep(
        fall[0],
        Math.max(fall[1], fall[0] + 2 * rate * CROP_CALENDAR.leastSeconds),
        phase
      ));
  return Math.max(getFlushStrength(age) * getFastYearsShare(rate) * spring, stormFlush, young);
}

function getStormFlush(t: number, delay: number): number {
  const {rise, fall, strength} = STORM_TABLE.flush;
  return strength * pulse(rise[0] + delay, rise[1] + delay, fall[0] + delay, fall[1] + delay, t);
}

/** A tree's share of the wind now, for the bearing it blows toward. */
function getExposure(row: GrovePlanRow, firstWall: number): number {
  return lerp(row.exposure[1], row.exposure[0], firstWall);
}

/** The gust, 0-1, that `TreeLayer` has a tree stand in at this moment. */
function getGustAt(row: GrovePlanRow, wind: StoryWind, exposure: number): number {
  return getTreeWindGust({
    position: row.position,
    time: wind.gustTime,
    direction: wind.bearing,
    strength: clamp01(wind.strength * exposure),
    phase: row.windPhase
  });
}

/**
 * Degrees a rocking or leaning tree leans at `t`: its permanent steps and its rocks, which follow
 * its own gust. `steady` from 0 to 1 hands the rocks back to their envelope alone, as a fall starts
 * from where they leave it.
 */
function getHeelDegrees(
  row: GrovePlanRow,
  t: number,
  wind: StoryWind,
  exposure: number,
  steady = 0
): number {
  const heel = row.heel as NonNullable<GrovePlanRow['heel']>;
  const [permanent, rock] = getHeelParts(heel.steps, t);
  let degrees = permanent;
  if (rock !== 0) {
    const share = HEEL_TABLE.gustShare * (1 - steady);
    const gust = share > 0 ? getGustAt(row, wind, exposure) : 1;
    degrees += rock * (1 - share + share * gust);
  }
  if (heel.reset !== null && t > heel.reset) {
    const {resetSeconds, kept} = LEAN_TABLE;
    degrees *= 1 - (1 - kept) * smootherstep(heel.reset, heel.reset + resetSeconds, t);
  }
  return degrees;
}

function writeHero(
  state: RowState,
  row: GrovePlanRow,
  t: number,
  year: number,
  rate: number,
  wind: StoryWind
): void {
  const {tree} = state;
  const {hero} = STORM_TABLE;
  tree.growth = getGrowthAtAge(year);
  tree.elevation = row.elevation + getHeroElevation(t);
  tree.wind = clamp01(wind.strength * row.exposure[0]);
  tree.health = lerp(1, hero.health, getHurt(t));
  tree.foliage = 1 - (1 - getHeroFoliage(t)) * (1 - getRecovery(t));
  tree.damage = getHeroDamage(t);
  tree.flush = getFlush(year, year, rate, getStormFlush(t, 0), getFirstYearsFlush(year));
  const bloomYear = getBloomYear(year).index;
  writeCrop(
    state,
    t,
    year,
    rate,
    bloomYear >= CROP_CALENDAR.firstBloomYear
      ? getBoxesOnTree(Math.min(bloomYear, CROP_TABLE.lastFruitYear) + 1)
      : 0,
    getBoxesOnTree(getFruitYear(year).index + 1),
    CROP_TABLE.heroBlossomsPerFruit,
    CROP_TABLE.heroBlossomCap,
    getStormFruitFallen(getHeroFruitFallen(t), t)
  );
}

/** A tree's effective age at a year. */
function getAge(row: GrovePlanRow, year: number): number {
  return row.plantAge + Math.max(0, year - row.plantYear);
}

/** A grove tree's boxes in a crop year, by the age it is then. */
function getGroveBoxes(row: GrovePlanRow, cropYear: number): number {
  const age = row.plantAge + cropYear - row.plantYear;
  if (age < CROP_CALENDAR.firstBloomYear) return 0;
  return getGroveBoxesAtAge(age) * CROP_TABLE.groveShare * getGroveRecovery(cropYear);
}

function writeGroveCrop(
  state: RowState,
  row: GrovePlanRow,
  t: number,
  year: number,
  rate: number,
  stormFruitFall: number
): void {
  writeCrop(
    state,
    t,
    year,
    rate,
    getGroveBoxes(row, getBloomYear(year).index),
    getGroveBoxes(row, getFruitYear(year).index),
    CROP_TABLE.blossomsPerFruit,
    CROP_TABLE.groveBlossomCap,
    stormFruitFall
  );
}

/**
 * What a tree does once it starts to go, and as a wreck, written over its standing values. Before
 * it goes, the fronts rock it. Once it is down, the days since it landed, on the year track, say
 * how it wilts, browns, drops its dry leaves and rots, as `WRECK_TABLE` has it.
 */
function writeFalling(
  state: RowState,
  row: GrovePlanRow,
  t: number,
  year: number,
  wind: StoryWind,
  exposure: number
): void {
  const fall = row.fall as NonNullable<GrovePlanRow['fall']>;
  const {tree, lean, blossom, fruit} = state;
  if (t < fall.start) {
    if (row.heel) {
      const steady = smoothstep(fall.start - HEEL_TABLE.gustFade, fall.start, t);
      lean[0] = getHeelDegrees(row, t, wind, exposure, steady);
      lean[1] = fall.bearing;
    }
    return;
  }
  const w = WRECK_TABLE;
  const landed = fall.start + fall.seconds;
  const since = t - landed;
  const days = Math.max(0, (year - fall.landedYear) * DAYS_PER_YEAR);
  const {leanDegrees, bounceDegrees, bounceDecay, bounceRate} = FALL_TABLE;
  const {topple, power} = fall;
  const going = (t - fall.start) / fall.seconds;
  lean[1] = fall.bearing;
  lean[0] =
    since < 0
      ? fall.from +
        (leanDegrees - fall.from) *
          (power ? Math.pow(going, power) : Math.sinh(topple * going) / Math.sinh(topple))
      : leanDegrees -
        bounceDegrees * Math.exp(-bounceDecay * since) * Math.abs(Math.sin(bounceRate * since));
  // What the walls have stripped from it, with no regrowth, and what it shakes off as it hits.
  const stripped = 1 - row.storm.leafLoss * getStrip(t);
  const shaken = lerp(1, w.foliageAtLanding, smoothstep(w.foliageShakenFrom, 0, since));
  const dried = lerp(1, w.leavesLeft, smoothstep(w.leavesFall[0], w.leavesFall[1], t));
  tree.foliage = Math.min(stripped, shaken) * dried;
  tree.health = Math.min(tree.health as number, getWreckHealth(days));
  const sag = smoothstep(Math.max(landed, w.sagFrom), fall.decayEnd, t);
  tree.damage = Math.max(
    tree.damage as number,
    w.damageAtImpact * smoothstep(w.impactSpan[0], w.impactSpan[1], since) +
      (w.damageLate - w.damageAtImpact) * sag
  );
  tree.decay = lerp(
    getWreckDecay(days),
    1,
    smoothstep(fall.decayEnd - w.goneSeconds, fall.decayEnd, t)
  );
  tree.flush = 0;
  fruit.fallen = Math.max(
    fruit.fallen as number,
    smoothstep(w.fruitFall[0], w.fruitFall[1], since)
  );
  // A wreck sets no crop after the one it went down with.
  if (getFruitYear(year).index > STORM_TABLE.fruitYear) fruit.count = 0;
  blossom.count = 0;
  if (t >= fall.decayEnd) tree.growth = 0;
}

/**
 * Drowned roots, written over a standing tree's values: yellowing, wilting, thinning, dropping its
 * fruit, and for the dead, grey twigs that go as their replacement comes.
 */
function writeDecline(state: RowState, row: GrovePlanRow, t: number, year: number): void {
  const decline = row.decline as NonNullable<GrovePlanRow['decline']>;
  const d = DECLINE_TABLE;
  if (t < d.span[0]) return;
  const {tree, blossom, fruit, canopy} = state;
  const turned = smoothstep(d.span[0], d.span[1], t);
  const amount = decline.dies ? turned : turned * (1 - smoothstep(d.recover[0], d.recover[1], t));
  for (let channel = 0; channel < 3; channel++) {
    canopy[channel] = lerp(d.from[channel], d.color[channel], amount);
  }
  tree.canopyColor = canopy;
  tree.health = Math.min(tree.health as number, lerp(1, d.health, amount));
  tree.foliage = Math.min(tree.foliage as number, lerp(1, d.foliage, amount));
  // Twigs lost come back with the grove's limbs, in the regrowth's night.
  const healed = smoothstep(STORM_TABLE.limbsHealed[0], STORM_TABLE.limbsHealed[1], t);
  tree.damage = clamp01((tree.damage as number) + d.damage * turned * (1 - healed));
  tree.flush = (tree.flush as number) * (1 - amount);
  fruit.fallen = Math.max(fruit.fallen as number, turned);
  if (!decline.dies) return;
  const dead = smoothstep(d.deadSpan[0], d.deadSpan[1], t);
  tree.health = Math.min(tree.health as number, lerp(1, d.deadHealth, dead));
  tree.foliage = Math.min(tree.foliage as number, lerp(1, d.deadFoliage, dead));
  tree.damage = clamp01((tree.damage as number) + d.deadDamage * dead);
  tree.decay = lerp(
    d.deadDecay * dead,
    1,
    smoothstep(decline.goneAt - d.deadGone, decline.goneAt, t)
  );
  tree.flush = 0;
  blossom.count = 0;
  if (getFruitYear(year).index > STORM_TABLE.fruitYear) fruit.count = 0;
  if (t >= decline.goneAt) tree.growth = 0;
}

function writeGrove(
  state: RowState,
  row: GrovePlanRow,
  t: number,
  year: number,
  rate: number,
  wind: StoryWind,
  firstWall: number
): void {
  const rise = clamp01((t - row.arrival) / MAGIC_TABLE.riseSeconds);
  if (rise <= 0) return;
  const {tree, lean} = state;
  const {leafLoss, damage, fruitLoss, flushDelay} = row.storm;
  const strip = getStrip(t);
  const exposure = getExposure(row, firstWall);
  // It bursts from the soil and slows as it nears the age of the trees around it.
  tree.growth = getGrowthAtAge(getAge(row, year)) * (1 - (1 - rise) * (1 - rise) * (1 - rise));
  tree.wind = clamp01(wind.strength * exposure);
  tree.foliage = 1 - leafLoss * strip * (1 - getRecovery(t - flushDelay));
  tree.damage = damage * getLimbs(t);
  tree.health = lerp(1, STORM_TABLE.grove.health, getHurt(t - flushDelay));
  tree.flush = getFlush(year, getAge(row, year), rate, getStormFlush(t, flushDelay), 0);
  writeGroveCrop(state, row, t, year, rate, getStormFruitFallen(fruitLoss * strip, t));
  if (row.fall) {
    writeFalling(state, row, t, year, wind, exposure);
  } else {
    if (row.heel) {
      lean[0] = getHeelDegrees(row, t, wind, exposure);
      lean[1] = row.heel.bearing;
    }
    if (row.decline) writeDecline(state, row, t, year);
  }
}

function writeReplant(
  state: RowState,
  row: GrovePlanRow,
  t: number,
  year: number,
  rate: number,
  wind: StoryWind,
  firstWall: number
): void {
  const since = t - row.arrival;
  const {appear, lower, liftHeight} = REPLANT_TABLE;
  if (since < appear[0]) return;
  const {tree} = state;
  tree.growth = getGrowthAtAge(getAge(row, year)) * smoothstep(appear[0], appear[1], since);
  tree.elevation = row.elevation + liftHeight * (1 - smootherstep(lower[0], lower[1], since));
  tree.wind = clamp01(wind.strength * getExposure(row, firstWall));
  tree.flush = getFlush(year, getAge(row, year), rate, 0, 0);
  writeGroveCrop(state, row, t, year, rate, 0);
}

/**
 * The trees at cycle second `t`. The array and its rows are the same objects on every call, with
 * their numbers rewritten, as `FILM.md` asks, so what one call returns is good until the next.
 *
 * @param t The content second: cycle seconds, as `getContentSeconds` gives them.
 * @param year Fractional years at `t`.
 * @param rate Years per second at `t`, which softens what would strobe.
 * @param wind The air at `t`. Omitted, it is `getEnvironment(t).wind`: `TreeSpec.wind` is this
 *   strength times each tree's exposure, and the trees that rock follow their own gust in it.
 */
export function writeTrees(
  t: number,
  year: number,
  rate: number,
  wind: StoryWind = getEnvironment(t).wind
): TreeSpec[] {
  // How much of each tree's exposure is its first-wall one, by the way the wind blows now.
  const firstWall =
    (1 + Math.cos((wind.bearing - HURRICANE.firstWallBearing) * RADIANS_PER_DEGREE)) / 2;
  GROVE_PLAN.forEach((row, index) => {
    const state = ROW_STATES[index];
    resetRow(state, row);
    if (row.kind === 'hero') writeHero(state, row, t, year, rate, wind);
    else if (row.kind === 'grove') writeGrove(state, row, t, year, rate, wind, firstWall);
    else writeReplant(state, row, t, year, rate, wind, firstWall);
  });
  return TREES;
}

/**
 * What heavy is hitting water at cycle second `t`: the crown of the hero-row tree that crashes
 * across the furrow in the first wall, the crown of the north-row tree that falls across it into
 * the flood in the second, and the hero's limb at the culvert's west mouth. Each is on the water's
 * surface, with its age in scene seconds since it hit.
 */
export function getSplashes(t: number): StorySplash[] {
  const splashes: StorySplash[] = [];
  for (const splash of SPLASHES) {
    if (t >= splash.t && t - splash.t <= SPLASH_TABLE.lasts) {
      splashes.push({
        position: [splash.x, splash.y, getWaterLevel(t)],
        age: Math.max(0, getSceneSeconds(t) - getSceneSeconds(splash.t)),
        size: splash.size
      });
    }
  }
  return splashes;
}

/** The ring of light of `grove-magic`. */
export function getMagicRing(t: number): {radius: number; strength: number} {
  return {radius: getMagicRingRadius(t), strength: getMagicRingStrength(t)};
}

/** How far the rows on the ground have spread, and how settled they are. */
export function getGroveRows(t: number): StoryGroveRows {
  const {rowSpacing, treeSpacing, rows, heroRowOffsets} = GROVE_LAYOUT;
  return {
    spacing: rowSpacing,
    treeSpacing,
    extent: [
      heroRowOffsets[heroRowOffsets.length - 1] + treeSpacing / 2,
      (rows[1] + 0.5) * rowSpacing
    ],
    reach: getRowReach(t),
    strength: getRowStrength(t)
  };
}

/** Sites of replants with something to show at second `t`, on their own land. */
export function getReplantSites(t: number, year: number): StorySite[] {
  const sites: StorySite[] = [];
  const {starts, hole, close, berm, water, waterDries, bermWear, lower, liftHeight, rootBall} =
    REPLANT_TABLE;
  if (t < starts[0] || FIRST_REPLANT_ROW < 0) return sites;
  for (let index = FIRST_REPLANT_ROW; index < GROVE_PLAN.length; index++) {
    const row = GROVE_PLAN[index];
    const since = t - row.arrival;
    if (since >= 0) {
      const holeOpen =
        smoothstep(hole[0], hole[1], since) * (1 - smoothstep(close[0], close[1], since));
      const bermUp =
        smoothstep(berm[0], berm[1], since) * (1 - smoothstep(bermWear[0], bermWear[1], year));
      const wet = pulse(water[0], water[1], waterDries[0], waterDries[1], since);
      if (holeOpen > 0 || bermUp > 0 || wet > 0) {
        let ball: StoryRootBall | null = null;
        if (since < close[1]) {
          const base = row.elevation + liftHeight * (1 - smootherstep(lower[0], lower[1], since));
          ball = {
            position: [row.position[0], row.position[1], base - rootBall.height / 2],
            radius: rootBall.radius,
            height: rootBall.height,
            roots: rootBall.roots
          };
        }
        sites.push({
          position: [row.position[0], row.position[1], row.elevation],
          hole: holeOpen,
          berm: bermUp,
          water: wet,
          rootBall: ball
        });
      }
    }
  }
  return sites;
}

/** The second each replant's net starts to come off: west to east across the grove, each its own. */
const NET_LIFT_STARTS: readonly number[] = GROVE_PLAN.map(row => {
  const {netLiftFrom, netLiftAcross, netLiftJitter} = REPLANT_TABLE;
  const reach = GROVE_LAYOUT.heroRowOffsets[GROVE_LAYOUT.heroRowOffsets.length - 1];
  const across = clamp01((row.position[0] + reach) / (2 * reach));
  return netLiftFrom + across * netLiftAcross + hashRange(row.index, 71, 0, netLiftJitter);
});

/**
 * Nets on replants at second `t`, each with its row's index as its id. Each follows its crown until
 * it comes off, then keeps the size it had, rides up off the crown, loosens, and crumples away.
 */
export function getReplantNets(t: number, year: number): StoryNet[] {
  const nets: StoryNet[] = [];
  const r = REPLANT_TABLE;
  if (t < r.starts[0] + r.netDescent[0] || FIRST_REPLANT_ROW < 0) return nets;
  for (let index = FIRST_REPLANT_ROW; index < GROVE_PLAN.length; index++) {
    const row = GROVE_PLAN[index];
    const since = t - row.arrival;
    const offFrom = NET_LIFT_STARTS[index];
    const offEnd = offFrom + r.netLiftSeconds;
    if (since >= r.netDescent[0] && t < offEnd) {
      const fitAt = Math.min(t, offFrom);
      const growth =
        getGrowthAtAge(getAge(row, t < offFrom ? year : getYear(offFrom))) *
        smoothstep(r.appear[0], r.appear[1], fitAt - row.arrival);
      const fit = getNetFit(row.height, row.crownRadius, growth);
      const down = smoothstep(r.netDescent[0], r.netDescent[1], since);
      const off = smootherstep(offFrom, offEnd, t);
      const left = 1 - smoothstep(offEnd - r.netGoneSeconds, offEnd, t);
      const span = r.netBillowSpan;
      nets.push({
        id: index,
        position: [
          row.position[0],
          row.position[1],
          row.elevation + r.liftHeight * (1 - smootherstep(r.lower[0], r.lower[1], since))
        ],
        radius: fit.radius * left,
        height: fit.height * left,
        descent: lerp(1 - (1 - down) * (1 - down), r.netLiftDescent, off),
        billow: r.netBillow * pulse(span[0], span[1], span[2], span[3], since),
        cinch: smoothstep(r.netCinch[0], r.netCinch[1], since),
        strain: smoothstep(r.netStrain[0], r.netStrain[1], t) * (1 - r.netLiftLoosen * off),
        slit: smoothstep(offFrom - r.netSlitBefore, offFrom, t),
        lift: r.netLiftMost * off,
        liftBearing: r.netLiftBearing
      });
    }
  }
  return nets;
}

/** Microjets beside replants at second `t`. */
export function getReplantMicrojets(t: number): StoryMicrojet[] {
  const jets: StoryMicrojet[] = [];
  const {starts, microjetAppear, microjetSpray} = REPLANT_TABLE;
  if (t < starts[0] || FIRST_REPLANT_ROW < 0) return jets;
  for (let index = FIRST_REPLANT_ROW; index < GROVE_PLAN.length; index++) {
    const row = GROVE_PLAN[index];
    const since = t - row.arrival;
    if (since >= microjetAppear[0]) {
      jets.push({
        position: MICROJET_POSITIONS[index],
        visible: smoothstep(microjetAppear[0], microjetAppear[1], since),
        spray: pulse(microjetSpray[0], microjetSpray[1], microjetSpray[2], microjetSpray[3], since)
      });
    }
  }
  return jets;
}
