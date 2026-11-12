// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The small things by cycle second: the one orange, hanging on the old tree, falling through the
 * swap and landing beside the pot, then its halves; the seed's flight, the pot and its soil, the
 * hero's net and planting. Every moment is in a table here. What runs through the swap (the fall,
 * the stalk, the landing) is keyed on the fall clock, `getFallSeconds`, which is continuous
 * across it; the rest is keyed on cycle seconds. Motion has weight: heavy things gather speed and
 * settle, and light things are quick.
 */

import {Quaternion} from '@math.gl/core';
import {
  getContentSeconds,
  getCrownFraction,
  getFallSeconds,
  getGrowthAtAge,
  getHeightFraction,
  getSeamSeconds,
  getWorld,
  getYear,
  LOOP
} from './beats';
import {getLandHeight} from './land';
import {
  createTrack,
  cross,
  getBearingVector,
  getQuatFromAxisAngle,
  getQuatFromTo,
  getSettle,
  hash01,
  hashRange,
  lerp,
  multiplyQuat,
  pulse,
  RADIANS_PER_DEGREE,
  rotateVector,
  smootherstep,
  smoothstep,
  type Key
} from './story-math';
import type {
  Quat,
  StoryHeroPlanting,
  StoryMicrojet,
  StoryNet,
  StoryOrange,
  StoryOrangeHalf,
  StoryPot,
  StoryProps,
  StoryRootBall,
  StorySeed,
  StoryWorld,
  Vec3
} from './story-types';

/**
 * Metres, and cycle seconds. The fruit lies near the pot, with the seam square to the opening view,
 * where it came to rest after its fall.
 */
export const ORANGE_TABLE = {
  /**
   * Where it lies on the ground. The pot is at the origin, off to the right of the opening shot.
   */
  center: [-0.283, 0.238] as const,
  radius: 0.04,
  /**
   * Compass bearing half A rolls toward, to the right of the opening view. B goes the other way.
   * The stalk's axis lies this way at rest, so it is also the axis the fruit rolls about to get
   * there.
   */
  partBearing: 148,
  /**
   * Compass bearing from the fruit toward the camera. Each cut face tips this way to be seen, and
   * the landing fruit rolls this way to its rest.
   */
  towardCameraBearing: 238,
  seam: [2.7, 3.15] as const,
  seamGap: 0.0008,
  partStart: 3,
  partSeconds: 1.7,
  /** Each half rolls this far from its cut face looking sideways, overshoots and comes back. */
  rollDegrees: 68,
  rollOvershoot: 0.08,
  faceTiltDegrees: 24,
  juice: [3.1, 4.3] as const,
  dewKeys: [
    [2.6, 0.9],
    [4.6, 0.75],
    [9, 0.5]
  ] as readonly Key[],
  /** It has dried and gone by the time the camera could see it again. */
  goneAt: 9
};

/**
 * The hero fruit: the ripe Valencia that hangs at the outer bottom edge of the hero's south-east
 * skirt in year 30, lets go at `LOOP.letGo`, falls through the swap and lands beside the pot.
 * Metres, and scene seconds of the fall clock (`getFallSeconds`) unless it says seam seconds.
 */
export const HERO_FRUIT_TABLE = {
  /**
   * Where it hangs, x and y, with its centre `LOOP.hangHeight` above the land there: bearing 115
   * from the hero, 3.72 m out, at the outer surface of the south-east skirt. Placed by picking rays
   * against the hero at year 30 in the stage, with its depth pass, from the end shot's distances:
   * under a twig whose tip it hangs 1 cm clear of, in front of the leaves from the end shot's
   * camera, with 6 cm of air round its fall and round the camera's dive, and 46 cm from the nearest
   * of `TreeLayer`'s own fruit. Nothing of the hero reaches the 5.35 m out the spec first had.
   */
  hang: [3.3656, -1.5799] as const,
  /**
   * Where the stalk's top meets that twig: on the underside of a 5 mm twig that runs down and out
   * at 51 degrees to its tip 2.6 cm further on, from the same picking rays.
   */
  twig: [3.3656, -1.5799, 0.922] as const,
  /**
   * The bearing twig the stalk hangs from: the hero's own shoot, straight from where it leaves its
   * limb at `base` down and out to its tip, 2 cm past the stalk, which meets its underside. Radii at
   * the base, where the stalk meets it, and at the tip. Taken off the picking rays that placed
   * `twig`, before the hero had any damage, and the limb it leaves is where they found it. At year
   * 30 `TreeLayer` no longer draws it, since the hero's damage of 0.08 breaks its limb off, and with
   * it all the wood within 32 cm of the stalk, so the orange layer draws it with the stalk: the fruit
   * always hangs from a twig of its tree.
   */
  bearing: {
    base: [3.024, -1.417, 1.4754] as const,
    tip: [3.3778, -1.5848, 0.906] as const,
    radius: [0.0026, 0.0024, 0.0019] as const
  },
  /**
   * Seam second the hero fruit is first drawn, at night and from far off, so it never appears on
   * screen. It hangs still from there, as the wind is 0 in `LOOP.stillAir`.
   */
  shows: -8.6,
  /** The stalk: its radius at the button, and where it joins its twig. */
  stalk: {radius: 0.0012, twigRadius: 0.0015},
  /** Height of the top of the woody button above the fruit's centre, along its stalk's axis. */
  buttonHeight: 0.0393,
  /**
   * After it lets go the stalk springs back up on its twig, as a damped spring at this rate in
   * scene time, swinging by this much toward this compass bearing: across its twig, so it never
   * sweeps through the twig's own tip.
   */
  spring: {hertz: 6, damping: 0.22, degrees: 34, bearing: 202},
  gravity: 9.81,
  /**
   * Its calyx turns from up to the side over the fall, by this much, gathering spin over the first
   * `tumbleSoftness` scene seconds after the stalk lets go.
   */
  tumbleDegrees: 90,
  tumbleSoftness: 0.05,
  /** Dew it sheds as the stalk lets go, falling beside it, gone before the rind fills the frame. */
  shed: {
    count: 5,
    speed: [0.05, 0.12] as const,
    /** Air holds a drop back this much more than the fruit, in m/s². */
    lag: 0.7,
    fade: [-1, -0.62] as const
  },
  /**
   * The landing, beside the pot: it rolls `roll` toward `towardCameraBearing` to its rest and rocks
   * there, squashes for a moment at the impact, and hops by `restitution` of its speed.
   */
  roll: 0.06,
  rockDegrees: 4,
  squash: 0.03,
  squashSeconds: 0.04,
  restitution: 0.18,
  /**
   * Seam second it lies still in exactly the opening's pose, where the opening's orange takes over
   * from it, the same in every number.
   */
  restAt: 2.5,
  /** Sand thrown up in a crown where it lands, from the edge of where it touches. */
  puff: {
    count: 30,
    ring: [0.011, 0.026] as const,
    out: [0.4, 1.25] as const,
    up: [0.45, 1.3] as const,
    size: [0.0009, 0.0024] as const,
    linger: 0.16
  },
  /** Dew flung off the rind by the impact. */
  flung: {count: 6, speed: [0.6, 1.3] as const, rise: [0.3, 0.75] as const, linger: 0.06},
  /**
   * The sand it wets: a dark ring round where it touches, from the dew its rind leaves there, made of
   * this many damp spots between these radii, and a dark splat where each flung drop comes down. All of
   * it soaks in and is gone over these seam seconds, before the opening begins.
   */
  damp: {
    spots: 20,
    ring: [0.032, 0.058] as const,
    spot: [0.008, 0.014] as const,
    splat: [0.0035, 0.0065] as const,
    dark: 0.36,
    splatDark: 0.45,
    dries: [1.7, 2.45] as const
  }
};

/** Juice drops: how many, when they let go, how slow they fall in the macro shot. */
const DROPLET_TABLE = {
  count: 9,
  from: 3.6,
  to: 4.75,
  gravity: 0.85,
  /**
   * Where each hangs from: this share of the radius out on a cut face's rim, this far under the
   * face.
   */
  rimRadius: 0.92,
  rimDepth: 0.002,
  /**
   * Seconds it hangs before it lets go, no lower than this, falling to this height above the
   * ground.
   */
  hang: 0.1,
  leastHeight: 0.012,
  groundHeight: 0.002
};

/** The seed: when it shows on half A, works loose, lifts, lands and is buried, and its flight. */
export const SEED_TABLE = {
  length: 0.011,
  /** On half A's cut face, local to it. */
  faceOffset: [0.012, -0.006, 0.0035] as Vec3,
  appears: 4.4,
  loosen: [4.6, 5.1] as const,
  hoverHeight: 0.007,
  wiggleDegrees: 16,
  /** Radians per second it rocks as it works loose, and seconds it takes to stop once it lifts. */
  wiggleRate: 14,
  wiggleEnd: 0.3,
  lift: 5.1,
  land: 6.4,
  apexHeight: 0.22,
  /** How softly it gathers speed at the start of its flight, as a share of the flight. */
  liftSoftness: 0.15,
  /** Height above its rest on the soil at which it comes down. */
  landingHeight: 0.003,
  tumbleTurns: 2.6,
  tumbleAxis: [0.62, 0.41, 0.67] as Vec3,
  /** It lies on its side on the fruit, and turns upright by the end of its flight. */
  lyingAxis: [1, 0.3, 0] as Vec3,
  /** The bead of juice shows this long before it works loose, and is gone over this span. */
  beadFrom: 0.2,
  beadGone: [5.6, 6.2] as const,
  settle: [6.4, 6.8] as const,
  buriedAt: 7.6,
  /** Height of the seed's center above the soil surface, at rest. */
  restHeight: 0.003,
  trail: {points: 28, stepSeconds: 0.035, strength: 0.6, fade: [6.4, 7] as const}
};

/** The pot's two sizes, its pot-up and everything its soil does, in seconds. */
export const POT_TABLE = {
  small: {rimRadius: 0.085, height: 0.15, soilLevel: 0.125},
  large: {rimRadius: 0.155, height: 0.28, soilLevel: 0.245},
  potUp: [10.9, 11.6] as const,
  potUpOvershoot: 0.1,
  soilWetnessKeys: [
    [0, 0.55],
    [7.6, 0.6],
    [9.6, 0.7],
    [11.6, 0.9],
    [12, 0.7],
    [13.4, 0.6]
  ] as readonly Key[],
  bumpKeys: [
    [6.4, 0],
    [6.6, -0.005],
    [6.8, -0.005],
    [7.6, 0.007],
    [7.9, 0.007],
    [8.5, 0.011],
    [9.6, 0.008],
    [10.9, 0.004],
    [11.2, 0]
  ] as readonly Key[],
  bumpRadiusKeys: [
    [6.4, 0.03],
    [7.8, 0.03],
    [8.5, 0.036],
    [10.8, 0.04]
  ] as readonly Key[],
  crackKeys: [
    [7.9, 0],
    [8.6, 1],
    [9.4, 0.7],
    [10.9, 0.4],
    [11.2, 0]
  ] as readonly Key[]
};

/**
 * Grains: the puff where the seed lands, what tumbles in to cover it, and crumbs the shoot lifts.
 */
const GRAIN_TABLE = {
  puff: {count: 16, speed: [0.06, 0.16], rise: [0.25, 0.5], gravity: 1.6, size: [0.0012, 0.0035]},
  cover: {
    count: 36,
    from: 6.8,
    to: 7.25,
    seconds: [0.2, 0.32],
    fromRadius: [0.017, 0.034],
    toRadius: [0.001, 0.012],
    hop: 0.004,
    size: [0.0012, 0.0034]
  },
  crumbs: {
    count: 10,
    from: 7.95,
    to: 8.5,
    seconds: 0.4,
    radius: [0.006, 0.02],
    hop: 0.006,
    size: [0.0014, 0.003]
  },
  /** How high above the soil a grain's center rides. */
  surfaceHeight: 0.0015,
  /** Fades of a grain over its life, as `pulse` spans. */
  coverFade: [0, 0.08, 0.88, 1],
  crumbFade: [0, 0.1, 0.8, 1]
} as const;

/**
 * The hero's planting in seconds. The hole opens under the pot as it slides off the root ball's
 * path.
 */
export const PLANTING_TABLE = {
  lift: [13.6, 14.1] as const,
  liftHeight: 0.34,
  slide: [13.9, 14.8] as const,
  slideTo: [0.1, -1.25] as const,
  potFade: [14.8, 15.3] as const,
  hole: [14.1, 14.7] as const,
  holeRadius: 0.42,
  holeDepth: 0.34,
  lower: [14.7, 15.4] as const,
  lowerOvershoot: 0.03,
  fill: [15.2, 15.8] as const,
  berm: [15.3, 15.9] as const,
  bermRadius: 0.75,
  /** The berm wears down as the tree takes hold, to this much. */
  bermWear: [17.9, 19.2] as const,
  bermWorn: 0.25,
  water: [15.8, 16.4] as const,
  waterDries: [16.6, 17.4] as const,
  rootBall: {radius: 0.145, height: 0.225, roots: 0.9}
};

/** The hero's net in seconds, and how a net fits the tree inside it. */
export const NET_TABLE = {
  descent: [12, 12.9] as const,
  billowKeys: [
    [12.3, 0],
    [12.65, 0.14],
    [12.95, 0.1],
    [13.2, 0.03],
    [13.5, 0]
  ] as readonly Key[],
  cinch: [12.7, 13.3] as const,
  strain: [17.2, 17.9] as const,
  slit: [17.8, 18.1] as const,
  lift: [18.1, 18.9] as const,
  liftBearing: 150,
  /**
   * A bag is this much wider and taller than the crown it holds, and never narrower than
   * `leastRadius`: a tall, narrow sleeve over a young tree, not a bell. A young tree fills only
   * `crownShare` of its crown's nominal radius, from the first of these growths to the last.
   */
  crownFill: 1.2,
  crownShare: {growth: [0.08, 0.19] as const, share: [0.23, 0.57] as const},
  heightFill: 1.1,
  heightClearance: 0.12,
  leastRadius: 0.17
};

/** The hero's microjet, beside the tree on the camera's side, and when it runs. */
export const MICROJET_TABLE = {
  position: [0.95, -0.55, 0] as Vec3,
  appears: [15.5, 15.8] as const,
  /** It waters the new planting, and runs through the first winter's frost night. */
  sprayKeys: [
    [15.7, 0],
    [15.95, 1],
    [17, 1],
    [17.4, 0],
    [21.5, 0],
    [21.65, 1],
    [21.95, 1],
    [22.1, 0]
  ] as readonly Key[]
};

/** The hero's mature size, as the net fits it. Others' nets go by their own. */
const HERO_MATURE = {height: 9, crownRadius: 5};

const getDew = createTrack(ORANGE_TABLE.dewKeys);
const getSoilWetness = createTrack(POT_TABLE.soilWetnessKeys);
const getSoilBump = createTrack(POT_TABLE.bumpKeys);
const getSoilBumpRadius = createTrack(POT_TABLE.bumpRadiusKeys);
const getSoilCrack = createTrack(POT_TABLE.crackKeys);
const getBillow = createTrack(NET_TABLE.billowKeys);
const getSpray = createTrack(MICROJET_TABLE.sprayKeys);

const UP: Vec3 = [0, 0, 1];

function getGroundVector(bearing: number): Vec3 {
  const [x, y] = getBearingVector(bearing);
  return [x, y, 0];
}

const PART_DIRECTION = getGroundVector(ORANGE_TABLE.partBearing);
const TOWARD_CAMERA = getGroundVector(ORANGE_TABLE.towardCameraBearing);
/** How the fruit lies at rest beside the pot: on its side, its stalk's axis along `partBearing`. */
export const ORANGE_ROTATION: Quat = getQuatFromTo(UP, PART_DIRECTION);
/** Each half's turn before it moves, as `getHalf` starts it. */
const HALF_STARTS: readonly [Quat, Quat] = [
  getQuatFromTo(UP, [-PART_DIRECTION[0], -PART_DIRECTION[1], 0]),
  getQuatFromTo(UP, PART_DIRECTION)
];
/** Height of the land under the fruit's rest, which the opening stands on. */
const REST_GROUND = getLandHeight(ORANGE_TABLE.center[0], ORANGE_TABLE.center[1]);

function getConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** A half at second `t`. `side` is +1 for half A, -1 for B. Its dome rolls without slipping. */
function getHalf(side: 1 | -1, t: number): StoryOrangeHalf {
  const {center, radius, partStart, partSeconds, rollDegrees, rollOvershoot, faceTiltDegrees} =
    ORANGE_TABLE;
  const time = (t - partStart) / partSeconds;
  const roll = rollDegrees * RADIANS_PER_DEGREE * getSettle(time, rollOvershoot);
  const tilt = faceTiltDegrees * RADIANS_PER_DEGREE * smoothstep(0, 1, time);
  const away: Vec3 = [side * PART_DIRECTION[0], side * PART_DIRECTION[1], 0];
  const facing: Vec3 = [-away[0], -away[1], 0];
  // First the face looks at the other half. A roll turns it up, and a tilt toward the camera.
  const start = HALF_STARTS[side > 0 ? 0 : 1];
  const rolled = multiplyQuat(getQuatFromAxisAngle(cross(facing, UP), roll), start);
  const rotation = multiplyQuat(getQuatFromAxisAngle(cross(UP, TOWARD_CAMERA), tilt), rolled);
  const seam = smoothstep(ORANGE_TABLE.seam[0], ORANGE_TABLE.seam[1], t);
  const travel = ORANGE_TABLE.seamGap * seam + radius * roll;
  return {
    position: [
      center[0] + away[0] * travel + TOWARD_CAMERA[0] * radius * tilt,
      center[1] + away[1] * travel + TOWARD_CAMERA[1] * radius * tilt,
      REST_GROUND + radius
    ],
    rotation
  };
}

/** The two halves of a whole fruit at a pose, as `getHalf` has them before the seam opens. */
function getWholeHalves(position: Vec3, rotation: Quat): [StoryOrangeHalf, StoryOrangeHalf] {
  const turn = multiplyQuat(rotation, getConjugate(ORANGE_ROTATION));
  return [
    {position, rotation: multiplyQuat(turn, HALF_STARTS[0])},
    {position, rotation: multiplyQuat(turn, HALF_STARTS[1])}
  ];
}

const DROPLETS = Array.from({length: DROPLET_TABLE.count}, (_, index) => {
  const start = hashRange(index, 11, DROPLET_TABLE.from, DROPLET_TABLE.to);
  const half = getHalf(hash01(index, 12) < 0.5 ? 1 : -1, start);
  const angle = hashRange(index, 13, 0, 2 * Math.PI);
  const rim = ORANGE_TABLE.radius * DROPLET_TABLE.rimRadius;
  const local: Vec3 = [rim * Math.cos(angle), rim * Math.sin(angle), -DROPLET_TABLE.rimDepth];
  const offset = rotateVector(half.rotation, local);
  const position: Vec3 = [
    half.position[0] + offset[0],
    half.position[1] + offset[1],
    Math.max(half.position[2] + offset[2], REST_GROUND + DROPLET_TABLE.leastHeight)
  ];
  const seconds = Math.sqrt(
    (2 * (position[2] - REST_GROUND - DROPLET_TABLE.groundHeight)) / DROPLET_TABLE.gravity
  );
  return {start, position, seconds};
});

function getDroplets(t: number): StoryOrange['droplets'] {
  const droplets: StoryOrange['droplets'] = [];
  for (const {start, position, seconds} of DROPLETS) {
    const hang = DROPLET_TABLE.hang;
    if (t >= start && t < start + hang + seconds) {
      const age = Math.max(0, t - start - hang);
      droplets.push({
        position: [position[0], position[1], position[2] - 0.5 * DROPLET_TABLE.gravity * age * age],
        alpha: smoothstep(0, hang, t - start) * (1 - smoothstep(seconds * 0.85, seconds, age))
      });
    }
  }
  return droplets;
}

/** The fruit at rest beside the pot and then opening, at cycle second `t`. */
function getOpeningOrange(t: number): StoryOrange {
  const {center, radius, seam, juice, goneAt} = ORANGE_TABLE;
  const opened = smoothstep(seam[0], seam[1], t);
  return {
    visible: t < goneAt,
    radius,
    position: [center[0], center[1], REST_GROUND + radius],
    rotation: ORANGE_ROTATION,
    seam: opened,
    halves: [getHalf(1, t), getHalf(-1, t)],
    juice: smoothstep(juice[0], juice[1], t),
    droplets: getDroplets(t),
    dew: getDew(t),
    phase: opened > 0 ? 'opening' : 'resting',
    stem: null,
    squash: 0,
    groundZ: REST_GROUND
  };
}

// The hero fruit. Everything that moves is a function of the fall clock alone, so the end world's
// fruit and the start world's are the same fruit relative to the land under their fall lines.

/** Where the start world's fruit reaches the sand: its rest, less the roll toward the camera. */
const IMPACT_POINT: readonly [number, number] = [
  ORANGE_TABLE.center[0] - TOWARD_CAMERA[0] * HERO_FRUIT_TABLE.roll,
  ORANGE_TABLE.center[1] - TOWARD_CAMERA[1] * HERO_FRUIT_TABLE.roll
];

/**
 * The land points under the two fall lines. The camera's aim jumps by their difference at the
 * swap, hidden in the rind, and nothing else does.
 */
const ANCHORS: Record<StoryWorld, Vec3> = {
  end: [
    HERO_FRUIT_TABLE.hang[0],
    HERO_FRUIT_TABLE.hang[1],
    getLandHeight(HERO_FRUIT_TABLE.hang[0], HERO_FRUIT_TABLE.hang[1])
  ],
  start: [IMPACT_POINT[0], IMPACT_POINT[1], getLandHeight(IMPACT_POINT[0], IMPACT_POINT[1])]
};

/** The fall's shape, worked out once from the table. */
const FALL = (() => {
  const {gravity, restitution, roll, rockDegrees, tumbleDegrees} = HERO_FRUIT_TABLE;
  const {radius} = ORANGE_TABLE;
  // Its equator meets the sand, as its stalk's axis lies flat by then.
  const impact = Math.sqrt((2 * (LOOP.hangHeight - radius)) / gravity);
  const bounce = restitution * gravity * impact;
  const rollAngle = roll / radius;
  // Rolling about its stalk's axis takes it toward the camera; turning the stalk's axis from the
  // rest pose back up to the zenith is the tumble, run backward.
  const atImpact = multiplyQuat(getQuatFromAxisAngle(PART_DIRECTION, -rollAngle), ORANGE_ROTATION);
  const hanging = multiplyQuat(
    getQuatFromAxisAngle(cross(UP, PART_DIRECTION), -tumbleDegrees * RADIANS_PER_DEGREE),
    atImpact
  );
  return {
    /** Fall seconds at which it reaches the sand, and those it spends in its hop. */
    impact,
    bounce,
    hop: (2 * bounce) / gravity,
    /** Fall seconds by which it lies still. */
    rest: getFallSeconds(HERO_FRUIT_TABLE.restAt),
    rollAngle,
    rock: (rockDegrees * RADIANS_PER_DEGREE) / rollAngle,
    atImpact,
    hanging
  };
})();

const tumbleQuaternion = new Quaternion();

/** Its turn at a fall second: hanging, tumbling as it falls, then rolling and rocking to rest. */
function getFruitRotation(fall: number): Quat {
  if (fall <= 0) return FALL.hanging;
  if (fall < FALL.impact) {
    const {tumbleSoftness} = HERO_FRUIT_TABLE;
    const ease = (time: number) => (time * time) / (time + tumbleSoftness);
    tumbleQuaternion.slerp(FALL.hanging, FALL.atImpact, ease(fall) / ease(FALL.impact));
    return [tumbleQuaternion[0], tumbleQuaternion[1], tumbleQuaternion[2], tumbleQuaternion[3]];
  }
  if (fall >= FALL.rest) return ORANGE_ROTATION;
  return multiplyQuat(getQuatFromAxisAngle(PART_DIRECTION, getRollAngle(fall)), FALL.atImpact);
}

/** Radians it has rolled about its stalk's axis since the impact, past its rest and back. */
function getRollAngle(fall: number): number {
  if (fall <= FALL.impact) return 0;
  return FALL.rollAngle * getSettle((fall - FALL.impact) / (FALL.rest - FALL.impact), FALL.rock);
}

/**
 * Its flattening: all of the table's squash the instant it hits, as an impact is, and gone again
 * smoothly over `squashSeconds`.
 */
function getSquash(fall: number): number {
  const {squash, squashSeconds} = HERO_FRUIT_TABLE;
  const time = (fall - FALL.impact) / squashSeconds;
  if (time < 0 || time >= 1) return 0;
  return squash * (1 - smoothstep(0, 1, time));
}

/** Its centre at a fall second, in `world`. */
function getFruitCentre(fall: number, world: StoryWorld): Vec3 {
  const {gravity} = HERO_FRUIT_TABLE;
  const {radius} = ORANGE_TABLE;
  const anchor = ANCHORS[world];
  if (world === 'start' && fall >= FALL.rest) {
    return [ORANGE_TABLE.center[0], ORANGE_TABLE.center[1], REST_GROUND + radius];
  }
  if (fall < FALL.impact) {
    const drop = fall > 0 ? 0.5 * gravity * fall * fall : 0;
    return [anchor[0], anchor[1], anchor[2] + LOOP.hangHeight - drop];
  }
  const since = fall - FALL.impact;
  const hop = since < FALL.hop ? FALL.bounce * since - 0.5 * gravity * since * since : 0;
  const along = radius * getRollAngle(fall);
  const x = anchor[0] + TOWARD_CAMERA[0] * along;
  const y = anchor[1] + TOWARD_CAMERA[1] * along;
  return [x, y, getLandHeight(x, y) + radius * (1 - getSquash(fall)) + hop];
}

/** The bearing twig's axis, and where on it the stalk's top is, as `getBearingTwig` gives them. */
export type BearingTwig = {
  base: Vec3;
  tip: Vec3;
  /** Metres from the base to the tip, and the unit vector that way. */
  length: number;
  along: Vec3;
  /** How far along it, 0 at the base and 1 at the tip, the stalk's top is nearest its axis. */
  junction: number;
  /** How far the stalk's top is from its axis there, in metres. */
  offAxis: number;
  /** Radii at the base, at the junction and at the tip. */
  radius: readonly [number, number, number];
};

const BEARING_TWIG: BearingTwig = (() => {
  const {base, tip, radius} = HERO_FRUIT_TABLE.bearing;
  const {twig} = HERO_FRUIT_TABLE;
  const axis: Vec3 = [tip[0] - base[0], tip[1] - base[1], tip[2] - base[2]];
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  const along: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length];
  const share =
    (twig[0] - base[0]) * along[0] +
    (twig[1] - base[1]) * along[1] +
    (twig[2] - base[2]) * along[2];
  const nearest = [0, 1, 2].map(i => base[i] + along[i] * share);
  return {
    base: [base[0], base[1], base[2]],
    tip: [tip[0], tip[1], tip[2]],
    length,
    along,
    junction: share / length,
    offAxis: Math.hypot(twig[0] - nearest[0], twig[1] - nearest[1], twig[2] - nearest[2]),
    radius
  };
})();

/** The twig the hero fruit's stalk hangs from: its axis, and where the stalk meets it. */
export function getBearingTwig(): BearingTwig {
  return BEARING_TWIG;
}

/** The damped spring's step, 0 to 1 with its overshoot, at a scene second after it is let go. */
function getSpringStep(seconds: number): number {
  const {hertz, damping} = HERO_FRUIT_TABLE.spring;
  const omega = 2 * Math.PI * hertz;
  const ringing = omega * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * omega * seconds);
  return (
    1 -
    decay *
      (Math.cos(ringing * seconds) +
        (damping / Math.sqrt(1 - damping * damping)) * Math.sin(ringing * seconds))
  );
}

/** The stalk on its twig: down to the button while it holds, then springing back without it. */
function getStem(fall: number): NonNullable<StoryOrange['stem']> {
  const {twig, stalk, buttonHeight, spring, hang} = HERO_FRUIT_TABLE;
  const top: Vec3 = [twig[0], twig[1], twig[2]];
  const button: Vec3 = [hang[0], hang[1], ANCHORS.end[2] + LOOP.hangHeight + buttonHeight];
  if (fall <= 0) return {top, bottom: button, radius: stalk.radius};
  const along: Vec3 = [button[0] - top[0], button[1] - top[1], button[2] - top[2]];
  const length = Math.hypot(along[0], along[1], along[2]);
  const down: Vec3 = [along[0] / length, along[1] / length, along[2] / length];
  // It swings up about its top, in the plane of its hang and the way it swings toward.
  const out = getGroundVector(spring.bearing);
  const share = out[0] * down[0] + out[1] * down[1] + out[2] * down[2];
  const side: Vec3 = [out[0] - down[0] * share, out[1] - down[1] * share, out[2] - down[2] * share];
  const sideLength = Math.hypot(side[0], side[1], side[2]);
  const angle = spring.degrees * RADIANS_PER_DEGREE * getSpringStep(fall);
  const c = Math.cos(angle) * length;
  const s = (Math.sin(angle) * length) / sideLength;
  return {
    top,
    bottom: [
      top[0] + down[0] * c + side[0] * s,
      top[1] + down[1] * c + side[1] * s,
      top[2] + down[2] * c + side[2] * s
    ],
    radius: stalk.radius
  };
}

/** Where on the rind each shed drop starts, how fast it leaves, in world directions at the let-go. */
const SHED = Array.from({length: HERO_FRUIT_TABLE.shed.count}, (_, index) => {
  // Away from where the camera dives from, so none crosses its path.
  const bearing = hashRange(index, 401, -40, 115) * RADIANS_PER_DEGREE;
  const elevation = hashRange(index, 402, -35, 45) * RADIANS_PER_DEGREE;
  const direction: Vec3 = [
    Math.cos(elevation) * Math.sin(bearing),
    Math.cos(elevation) * Math.cos(bearing),
    Math.sin(elevation)
  ];
  const [low, high] = HERO_FRUIT_TABLE.shed.speed;
  return {direction, speed: hashRange(index, 403, low, high)};
});

/** Dew shaken off by the let-go, falling beside the fruit, and gone before the rind fills it all. */
function getShedDew(fall: number, seam: number, anchor: Vec3): StoryOrange['droplets'] {
  const {lag, fade} = HERO_FRUIT_TABLE.shed;
  const alpha = 1 - smoothstep(fade[0], fade[1], seam);
  if (fall <= 0 || alpha <= 0) return [];
  const {gravity} = HERO_FRUIT_TABLE;
  const {radius} = ORANGE_TABLE;
  return SHED.map(({direction, speed}) => {
    const out = radius * 1.03 + speed * fall;
    return {
      position: [
        anchor[0] + direction[0] * out,
        anchor[1] + direction[1] * out,
        anchor[2] + LOOP.hangHeight + direction[2] * out - 0.5 * (gravity - lag) * fall * fall
      ],
      alpha: alpha * smoothstep(0, 0.004, fall)
    };
  });
}

/** Seconds a thing thrown up at `up` m/s from `height` above the ground takes to come down. */
function getFlightSeconds(up: number, height: number, gravity: number): number {
  return (up + Math.sqrt(up * up + 2 * gravity * Math.max(height, 0))) / gravity;
}

/** Each drop the impact flings: which way, how steeply and how fast it leaves. */
const FLUNG = Array.from({length: HERO_FRUIT_TABLE.flung.count}, (_, index) => {
  const {flung} = HERO_FRUIT_TABLE;
  const rise = hashRange(index, 412, flung.rise[0], flung.rise[1]) * (Math.PI / 2);
  return {
    bearing: hashRange(index, 411, 0, 2 * Math.PI),
    across: Math.cos(rise),
    up: Math.sin(rise),
    speed: hashRange(index, 413, flung.speed[0], flung.speed[1])
  };
});

/** A flung drop's place on its flight, fall seconds `since` the impact, and the ground under it. */
function getFlungPlace(
  drop: (typeof FLUNG)[number],
  since: number
): {position: Vec3; ground: number; flight: number} {
  const {gravity} = HERO_FRUIT_TABLE;
  const {radius} = ORANGE_TABLE;
  const start = ANCHORS.start;
  const {bearing, across, up, speed} = drop;
  // From its lower rind, a little out from where it touched.
  const reach = radius * 0.9 * across + speed * across * since;
  const x = start[0] + Math.sin(bearing) * reach;
  const y = start[1] + Math.cos(bearing) * reach;
  const ground = getLandHeight(x, y) + 0.0008;
  const from = start[2] + radius * (1 - 0.6 * across);
  const flight = getFlightSeconds(speed * up, from - ground, gravity);
  const z = from + speed * up * since - 0.5 * gravity * since * since;
  return {position: [x, y, Math.max(z, ground)], ground, flight};
}

/** Dew thrown off the rind by the impact, up and out, until it soaks into the sand. */
function getFlungDew(fall: number): StoryOrange['droplets'] {
  const since = fall - FALL.impact;
  if (since <= 0) return [];
  const {flung} = HERO_FRUIT_TABLE;
  const droplets: StoryOrange['droplets'] = [];
  for (const drop of FLUNG) {
    const {position, flight} = getFlungPlace(drop, since);
    const alpha = 1 - smoothstep(flight, flight + flung.linger, since);
    if (alpha > 0) {
      droplets.push({position, alpha: alpha * smoothstep(0, 0.003, since)});
    }
  }
  return droplets;
}

/** Where each flung drop comes down, and when, in fall seconds after the impact. */
const FLUNG_LANDINGS = FLUNG.map((drop, index) => {
  // Its flight, from the ground where it is at the impact, then where it is then.
  let {flight} = getFlungPlace(drop, 0);
  for (let i = 0; i < 3; i++) flight = getFlungPlace(drop, flight).flight;
  const {position, ground} = getFlungPlace(drop, flight);
  const {splat} = HERO_FRUIT_TABLE.damp;
  return {
    position: [position[0], position[1], ground - 0.0008] as Vec3,
    flight,
    radius: hashRange(index, 435, splat[0], splat[1])
  };
});

/** A damp mark on the sand: its middle, on the land, its radius, and how dark it makes the sand. */
export type DampMark = {position: Vec3; radius: number; dark: number};

/**
 * The sand the hero fruit wets where it lands, in the start world, at cycle second `t`: a ring of damp
 * spots round where it touched, there from the impact, and a splat under each flung drop once it is
 * down, all soaking in over `HERO_FRUIT_TABLE.damp.dries`. Empty before the impact and once dry, so
 * the opening has none of it.
 */
export function getImpactDamp(t: number): DampMark[] {
  const since = getFallSeconds(t) - FALL.impact;
  const seam = getSeamSeconds(t);
  const {damp} = HERO_FRUIT_TABLE;
  if (since <= 0 || seam < 0 || seam >= damp.dries[1]) return [];
  const left = 1 - smoothstep(damp.dries[0], damp.dries[1], seam);
  const start = ANCHORS.start;
  const marks: DampMark[] = [];
  // Wetted as it touched, the ring spreads a little as the impact squeezes the dew out.
  const spread = smoothstep(0, 0.012, since);
  for (let index = 0; index < damp.spots; index++) {
    const bearing = ((index + hashRange(index, 431, -0.3, 0.3)) / damp.spots) * 2 * Math.PI;
    const out = hashRange(index, 432, damp.ring[0], damp.ring[1]);
    const radius = lerp(damp.ring[0], out, 0.35 + 0.65 * spread);
    const x = start[0] + Math.sin(bearing) * radius;
    const y = start[1] + Math.cos(bearing) * radius;
    marks.push({
      position: [x, y, getLandHeight(x, y)],
      radius: hashRange(index, 433, damp.spot[0], damp.spot[1]),
      dark: damp.dark * left * hashRange(index, 434, 0.6, 1) * smoothstep(0, 0.0002, since)
    });
  }
  for (const {position, flight, radius} of FLUNG_LANDINGS) {
    if (since > flight) {
      marks.push({
        position,
        radius,
        dark: damp.splatDark * left * smoothstep(flight, flight + 0.004, since)
      });
    }
  }
  return marks;
}

/** The hero fruit at seam second `seam` and fall second `fall`, in `world`. */
function getHeroFruit(seam: number, fall: number, world: StoryWorld): StoryOrange {
  const {radius} = ORANGE_TABLE;
  const position = getFruitCentre(fall, world);
  const rotation = getFruitRotation(fall);
  const anchor = ANCHORS[world];
  const droplets = getShedDew(fall, seam, anchor);
  if (world === 'start') droplets.push(...getFlungDew(fall));
  return {
    visible: true,
    radius,
    position,
    rotation,
    seam: 0,
    halves: getWholeHalves(position, rotation),
    juice: 0,
    droplets,
    dew: ORANGE_TABLE.dewKeys[0][1],
    phase: world === 'end' && fall <= 0 ? 'hanging' : 'falling',
    stem: world === 'end' ? getStem(fall) : null,
    squash: getSquash(fall),
    groundZ: getLandHeight(position[0], position[1])
  };
}

/**
 * The orange at `t` in `world`: the hero fruit in the end world from `HERO_FRUIT_TABLE.shows`,
 * hanging and falling; in the start world the same fruit falling and landing until it rests, and
 * then the opening's orange, resting and opening, read at the content second.
 */
function getOrange(t: number, world: StoryWorld): StoryOrange {
  const seam = getSeamSeconds(t);
  const isHero = world === 'end' ? seam >= HERO_FRUIT_TABLE.shows : seam < HERO_FRUIT_TABLE.restAt;
  if (isHero) return getHeroFruit(seam, getFallSeconds(t), world);
  return getOpeningOrange(getContentSeconds(t, world));
}

/** Sand thrown up in a crown where it lands, in the start world, by the fall clock. */
function getPuffs(fall: number): StoryProps['puffs'] {
  const since = fall - FALL.impact;
  if (since <= 0) return [];
  const {puff, gravity} = HERO_FRUIT_TABLE;
  const start = ANCHORS.start;
  const puffs: StoryProps['puffs'] = [];
  for (let index = 0; index < puff.count; index++) {
    const bearing = hashRange(index, 421, 0, 2 * Math.PI);
    const ring = hashRange(index, 422, puff.ring[0], puff.ring[1]);
    const out = hashRange(index, 423, puff.out[0], puff.out[1]);
    const up = hashRange(index, 424, puff.up[0], puff.up[1]);
    const size = hashRange(index, 425, puff.size[0], puff.size[1]);
    // Heavier grains go less far.
    const weight = 1 - (0.45 * (size - puff.size[0])) / (puff.size[1] - puff.size[0]);
    const flight = (2 * up * weight) / gravity;
    const time = Math.min(since, flight);
    const reach = ring + out * weight * time;
    const x = start[0] + Math.sin(bearing) * reach;
    const y = start[1] + Math.cos(bearing) * reach;
    const rise = up * weight * time - 0.5 * gravity * time * time;
    const alpha = 1 - smoothstep(flight, flight + puff.linger, since);
    if (alpha > 0) {
      puffs.push({
        position: [x, y, getLandHeight(x, y) + size * 0.5 + Math.max(rise, 0)],
        size,
        alpha
      });
    }
  }
  return puffs;
}

/** The pot's size and its soil's height above the base, through the pot-up. */
function getPotSize(t: number): {rimRadius: number; height: number; soilLevel: number} {
  const {small, large, potUp, potUpOvershoot} = POT_TABLE;
  const amount = getSettle((t - potUp[0]) / (potUp[1] - potUp[0]), potUpOvershoot);
  return {
    rimRadius: lerp(small.rimRadius, large.rimRadius, amount),
    height: lerp(small.height, large.height, amount),
    soilLevel: lerp(small.soilLevel, large.soilLevel, amount)
  };
}

/** Where the hero's base stands: on the pot's soil, out of it, then in the ground. */
export function getHeroElevation(t: number): number {
  const {lift, liftHeight, lower, lowerOvershoot} = PLANTING_TABLE;
  const raised = getPotSize(t).soilLevel + liftHeight * smootherstep(lift[0], lift[1], t);
  return raised * (1 - getSettle((t - lower[0]) / (lower[1] - lower[0]), lowerOvershoot));
}

/** The seed's center at second `t`. The camera follows this. */
export function getSeedPosition(t: number): Vec3 {
  const {faceOffset, loosen, hoverHeight, lift, land, apexHeight, settle, restHeight} = SEED_TABLE;
  const {liftSoftness, landingHeight} = SEED_TABLE;
  const soil = POT_TABLE.small.soilLevel;
  const landing = soil + restHeight + landingHeight;
  const getOnFace = (time: number): Vec3 => {
    const half = getHalf(1, time);
    const offset = rotateVector(half.rotation, faceOffset);
    const hover = hoverHeight * smootherstep(loosen[0], loosen[1], time);
    return [
      half.position[0] + offset[0],
      half.position[1] + offset[1],
      half.position[2] + offset[2] + hover
    ];
  };
  if (t < lift) return getOnFace(t);
  if (t < land) {
    const from = getOnFace(lift);
    const time = (t - lift) / (land - lift);
    // Gathers speed from rest, and goes on as a thrown thing does, slowed down.
    const across = ((time * time) / (time + liftSoftness)) * (1 + liftSoftness);
    return [
      lerp(from[0], 0, across),
      lerp(from[1], 0, across),
      lerp(from[2], landing, across) + 4 * apexHeight * across * (1 - across)
    ];
  }
  return [
    0,
    0,
    lerp(landing, soil + getSoilBump(t) + restHeight, smoothstep(settle[0], settle[1], t))
  ];
}

function getSeedRotation(t: number): Quat {
  const {loosen, wiggleDegrees, wiggleRate, wiggleEnd, lift, tumbleTurns, tumbleAxis} = SEED_TABLE;
  const {lyingAxis, settle} = SEED_TABLE;
  const wiggle =
    wiggleDegrees *
    RADIANS_PER_DEGREE *
    smootherstep(loosen[0], loosen[1], t) *
    (1 - smootherstep(lift, lift + wiggleEnd, t)) *
    Math.sin((t - loosen[0]) * wiggleRate);
  const flight = smootherstep(lift, settle[1], t);
  const tumble = getQuatFromAxisAngle(tumbleAxis, tumbleTurns * 2 * Math.PI * flight);
  const lying = getQuatFromAxisAngle(lyingAxis, (Math.PI / 2) * (1 - flight));
  return multiplyQuat(getQuatFromAxisAngle([0, 1, 0], wiggle), multiplyQuat(tumble, lying));
}

function getSeed(t: number): StorySeed {
  const {appears, buriedAt, beadFrom, beadGone, lift, length, land, trail, loosen} = SEED_TABLE;
  const points: StorySeed['trail'] = [];
  if (t > lift && t < trail.fade[1]) {
    const fade = 1 - smoothstep(trail.fade[0], trail.fade[1], t);
    for (let step = trail.points; step >= 0; step--) {
      const time = t - step * trail.stepSeconds;
      if (time >= lift) {
        const amount = 1 - step / trail.points;
        points.push({
          position: getSeedPosition(Math.min(time, land)),
          alpha: trail.strength * amount * amount * fade
        });
      }
    }
  }
  return {
    visible: t >= appears && t < buriedAt,
    position: getSeedPosition(t),
    rotation: getSeedRotation(t),
    length,
    bead:
      smoothstep(loosen[0] - beadFrom, loosen[0], t) *
      (1 - smoothstep(beadGone[0], beadGone[1], t)),
    trail: points
  };
}

function getGrains(t: number): StoryPot['grains'] {
  const grains: StoryPot['grains'] = [];
  const {puff, cover, crumbs, surfaceHeight, coverFade, crumbFade} = GRAIN_TABLE;
  const soil = POT_TABLE.small.soilLevel;
  const center = soil + getSoilBump(t);
  const land = SEED_TABLE.land;
  const longestPuff = (2 * puff.rise[1]) / puff.gravity;
  if (t >= land && t < land + longestPuff) {
    for (let index = 0; index < puff.count; index++) {
      const rise = hashRange(index, 21, puff.rise[0], puff.rise[1]);
      const seconds = (2 * rise) / puff.gravity;
      const age = t - land;
      if (age < seconds) {
        const angle = hashRange(index, 22, 0, 2 * Math.PI);
        const reach = hashRange(index, 23, puff.speed[0], puff.speed[1]) * age;
        grains.push({
          position: [
            reach * Math.cos(angle),
            reach * Math.sin(angle),
            soil + rise * age - 0.5 * puff.gravity * age * age
          ],
          size: hashRange(index, 24, puff.size[0], puff.size[1]),
          alpha: 1 - age / seconds
        });
      }
    }
  }
  if (t >= cover.from && t < cover.to + cover.seconds[1]) {
    for (let index = 0; index < cover.count; index++) {
      const start = hashRange(index, 31, cover.from, cover.to);
      const seconds = hashRange(index, 32, cover.seconds[0], cover.seconds[1]);
      const time = (t - start) / seconds;
      if (time >= 0 && time < 1) {
        const angle = hashRange(index, 33, 0, 2 * Math.PI);
        const radius = lerp(
          hashRange(index, 34, cover.fromRadius[0], cover.fromRadius[1]),
          hashRange(index, 35, cover.toRadius[0], cover.toRadius[1]),
          time * time
        );
        grains.push({
          position: [
            radius * Math.cos(angle),
            radius * Math.sin(angle),
            center + surfaceHeight + 4 * cover.hop * time * (1 - time)
          ],
          size: hashRange(index, 36, cover.size[0], cover.size[1]),
          alpha: pulse(coverFade[0], coverFade[1], coverFade[2], coverFade[3], time)
        });
      }
    }
  }
  if (t >= crumbs.from && t < crumbs.to + crumbs.seconds) {
    for (let index = 0; index < crumbs.count; index++) {
      const time = (t - hashRange(index, 41, crumbs.from, crumbs.to)) / crumbs.seconds;
      if (time >= 0 && time < 1) {
        const angle = hashRange(index, 42, 0, 2 * Math.PI);
        const radius = lerp(crumbs.radius[0], crumbs.radius[1], Math.sqrt(time));
        grains.push({
          position: [
            radius * Math.cos(angle),
            radius * Math.sin(angle),
            center + surfaceHeight + 4 * crumbs.hop * time * (1 - time)
          ],
          size: hashRange(index, 43, crumbs.size[0], crumbs.size[1]),
          alpha: pulse(crumbFade[0], crumbFade[1], crumbFade[2], crumbFade[3], time)
        });
      }
    }
  }
  return grains;
}

function getPot(t: number): StoryPot {
  const {slide, slideTo, potFade} = PLANTING_TABLE;
  const away = smootherstep(slide[0], slide[1], t);
  return {
    visible: t < potFade[1],
    position: [slideTo[0] * away, slideTo[1] * away, 0],
    ...getPotSize(t),
    soilWetness: getSoilWetness(t),
    soilBump: getSoilBump(t),
    soilBumpRadius: getSoilBumpRadius(t),
    soilCrack: getSoilCrack(t),
    grains: getGrains(t),
    alpha: 1 - smoothstep(potFade[0], potFade[1], t)
  };
}

/** The root ball, out of the pot and on its way into the hole, or `null`. */
function getRootBall(t: number): StoryRootBall | null {
  const {lift, fill, rootBall} = PLANTING_TABLE;
  if (t < lift[0] || t >= fill[1]) return null;
  return {
    position: [0, 0, getHeroElevation(t) - rootBall.height / 2],
    radius: rootBall.radius,
    height: rootBall.height,
    roots: rootBall.roots
  };
}

/** The bag that fits a tree of a mature size at a growth. */
export function getNetFit(
  matureHeight: number,
  matureCrown: number,
  growth: number
): {radius: number; height: number} {
  const {crownShare} = NET_TABLE;
  const filled = lerp(
    crownShare.share[0],
    crownShare.share[1],
    smoothstep(crownShare.growth[0], crownShare.growth[1], growth)
  );
  return {
    radius: Math.max(
      NET_TABLE.leastRadius * (matureHeight / HERO_MATURE.height + 0.5),
      NET_TABLE.crownFill * filled * matureCrown * getCrownFraction(growth)
    ),
    height:
      NET_TABLE.heightFill * matureHeight * getHeightFraction(growth) + NET_TABLE.heightClearance
  };
}

function getHeroNet(t: number): StoryNet | null {
  const {descent, cinch, strain, slit, lift, liftBearing} = NET_TABLE;
  if (t < descent[0] || t >= lift[1]) return null;
  const fit = getNetFit(
    HERO_MATURE.height,
    HERO_MATURE.crownRadius,
    getGrowthAtAge(getYear(Math.min(t, lift[0])))
  );
  const down = smoothstep(descent[0], descent[1], t);
  return {
    id: 0,
    position: [0, 0, getHeroElevation(t)],
    radius: fit.radius,
    height: fit.height,
    descent: 1 - (1 - down) * (1 - down),
    billow: getBillow(t),
    cinch: smoothstep(cinch[0], cinch[1], t),
    strain: smoothstep(strain[0], strain[1], t),
    slit: smoothstep(slit[0], slit[1], t),
    lift: smootherstep(lift[0], lift[1], t),
    liftBearing
  };
}

function getHeroMicrojet(t: number): StoryMicrojet | null {
  const {position, appears} = MICROJET_TABLE;
  if (t < appears[0]) return null;
  return {
    position,
    visible: smoothstep(appears[0], appears[1], t),
    spray: getSpray(t)
  };
}

/** The ground's hole, berm and water around the hero. */
export function getHeroPlanting(t: number): StoryHeroPlanting {
  const {
    hole,
    fill,
    holeRadius,
    holeDepth,
    berm,
    bermWear,
    bermWorn,
    bermRadius,
    water,
    waterDries
  } = PLANTING_TABLE;
  return {
    hole: smoothstep(hole[0], hole[1], t) * (1 - smoothstep(fill[0], fill[1], t)),
    holeRadius,
    holeDepth,
    berm:
      smoothstep(berm[0], berm[1], t) * lerp(1, bermWorn, smoothstep(bermWear[0], bermWear[1], t)),
    bermRadius,
    water: pulse(water[0], water[1], waterDries[0], waterDries[1], t)
  };
}

/**
 * The props at `t`, composed from `world`'s side of the swap: the orange (see `getOrange`), the
 * seed, the pot, and the hero's net and microjet if it has them yet, read at the content second,
 * and the sand the orange throws up where it lands.
 */
export function getHeroProps(
  t: number,
  world: StoryWorld = getWorld(t)
): {
  orange: StoryOrange;
  seed: StorySeed;
  pot: StoryPot;
  rootBall: StoryRootBall | null;
  net: StoryNet | null;
  microjet: StoryMicrojet | null;
  puffs: StoryProps['puffs'];
} {
  const seconds = getContentSeconds(t, world);
  return {
    orange: getOrange(t, world),
    seed: getSeed(seconds),
    pot: getPot(seconds),
    rootBall: getRootBall(seconds),
    net: getHeroNet(seconds),
    microjet: getHeroMicrojet(seconds),
    puffs: world === 'start' ? getPuffs(getFallSeconds(t)) : []
  };
}

/**
 * Where the camera's aim rides the hero fruit around the swap, on `world`'s side of it: `anchor`,
 * the land point under its fall line, which jumps at the swap and is never softened, and `offset`,
 * its centre from there, which is continuous through it in value and rate. Before the let-go it
 * hangs `LOOP.hangHeight` over the anchor, and once it has come to rest it lies there.
 */
export function getFruitTrack(
  t: number,
  world: StoryWorld = getWorld(t)
): {anchor: Vec3; offset: Vec3} {
  const anchor = ANCHORS[world];
  const centre = getFruitCentre(getFallSeconds(t), world);
  return {
    anchor: [anchor[0], anchor[1], anchor[2]],
    offset: [centre[0] - anchor[0], centre[1] - anchor[1], centre[2] - anchor[2]]
  };
}

/**
 * The cycle second the falling fruit reaches the sand, from its own fall: what `LOOP.impact` says
 * about. For tests and tools.
 */
export function getImpactSecond(): number {
  let low = 0;
  let high = HERO_FRUIT_TABLE.restAt;
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (getFallSeconds(middle) < FALL.impact) low = middle;
    else high = middle;
  }
  return high;
}
