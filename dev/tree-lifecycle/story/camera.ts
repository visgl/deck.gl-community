// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The one take: a person's hand on a very long crane. Key poses by cycle second, on tracks that
 * never overshoot, softened so that speed changes gently, with distance and aperture moving in log
 * space. No cuts, and no zoom pulses. `orbit` is the compass bearing the camera looks along: at
 * orbit 90 it stands west of its target and looks east.
 *
 * Around the swap the take rides the falling orange instead, on keys of seam seconds: its aim is the
 * land point under the fruit's fall line, which jumps at the swap and is never softened, plus the
 * fruit's softened offset from it, which runs on through the swap. So the camera never flies from
 * one world to the other, and it glides through the impact. In the storm it is held by its eye, in
 * the furrow, as an operator there would hold it.
 */

import type {TreeSpec} from '@deck.gl-community/layers';
import {
  CYCLE_SECONDS,
  getContentSeconds,
  getCrownFraction,
  getHeightFraction,
  getSeamSeconds,
  HURRICANE,
  LOOP
} from './beats';
import {getLandHeight} from './land';
import {getFruitTrack, getSeedPosition} from './props';
import {
  clamp,
  createTrack,
  getAngleBetween,
  getBellWeights,
  getSoftened,
  getSoftenedPoint,
  getSoftMin,
  lerp,
  mixVec3,
  pulse,
  RADIANS_PER_DEGREE,
  smoothNoise,
  smoothstep,
  type Key,
  type Track
} from './story-math';
import type {StoryCamera, StoryFlood, StoryOrange, StoryWorld, Vec3} from './story-types';

/**
 * A key pose: its second, the target in focus, the orbit and pitch in degrees, the distance from
 * eye to target in metres, the vertical field of view in degrees, the lens radius in metres, and
 * how many metres past the target must still receive a shadow, which with the trees in view sets
 * the far plane.
 */
type CameraKey = readonly [
  t: number,
  x: number,
  y: number,
  z: number,
  orbit: number,
  pitch: number,
  distance: number,
  fovy: number,
  aperture: number,
  reach: number
];

/** The hero fruit hanging, from the land under it, as `props.ts` places it. */
const HANG_OFFSET: Vec3 = getFruitTrack(CYCLE_SECONDS + LOOP.stillAir[0], 'end').offset;
/** Where the hero fruit hangs in the end world: the end shot's aim. */
const HANG: Vec3 = (() => {
  const {anchor} = getFruitTrack(CYCLE_SECONDS + LOOP.stillAir[0], 'end');
  return [anchor[0] + HANG_OFFSET[0], anchor[1] + HANG_OFFSET[1], anchor[2] + HANG_OFFSET[2]];
})();

/**
 * The storm's eye, low in the north water furrow, `STORM_EYE.height` above its usual water, with
 * the distance and pitch that put the target on that water `STORM_EYE.ahead` metres on.
 */
const STORM_EYE = {height: 1.4, ahead: 9};
const STORM_DISTANCE = Math.hypot(STORM_EYE.ahead, STORM_EYE.height);
const STORM_PITCH = Math.atan2(STORM_EYE.height, STORM_EYE.ahead) / RADIANS_PER_DEGREE;

/** A key of the storm, from where its beat puts the eye: in the furrow, on the 36-degree lens. */
function getEyeKey(t: number, eye: Vec3, orbit: number, pitch = STORM_PITCH): CameraKey {
  const forward = getForward(orbit, pitch);
  return [
    t,
    eye[0] + forward[0] * STORM_DISTANCE,
    eye[1] + forward[1] * STORM_DISTANCE,
    eye[2] + forward[2] * STORM_DISTANCE,
    orbit,
    pitch,
    STORM_DISTANCE,
    36,
    0.006,
    34
  ];
}

/**
 * The take, shot by shot, in cycle seconds from the opening pose that the orange-relative keys hand
 * over to, to the one they take over from. Columns as `CameraKey`. From 34.4 to 44 each key is
 * worked out from the eye the beat asks for, which `EYE_LOCK_KEYS` then holds to.
 */
export const CAMERA_KEYS: readonly CameraKey[] = [
  // Macro at soil height on the opened orange, the sun ahead and to the right.
  [2.6, -0.283, 0.238, 0.04, 58, 6, 0.265, 30, 0.0052, 0.5],
  // Rises to look into the halves as they part.
  [3.6, -0.283, 0.238, 0.0415, 59.5, 15, 0.28, 30, 0.0048, 0.5],
  [4.6, -0.283, 0.238, 0.043, 61, 24, 0.3, 30, 0.0045, 0.5],
  // Follows the seed, which `SEED_FOLLOW_KEYS` takes over, swinging past the sun to the pot.
  [5.1, -0.25, 0.2, 0.05, 66, 20, 0.27, 30, 0.0042, 0.55],
  [5.75, -0.14, 0.12, 0.22, 82, 8, 0.38, 30, 0.004, 0.7],
  [6.4, 0, 0, 0.127, 97, 15, 0.46, 30, 0.0045, 0.8],
  // Holds low on the soil while it is covered, and rises slowly with the shoot.
  [7.2, 0, 0, 0.125, 102, 20, 0.42, 30, 0.0042, 0.8],
  [7.8, 0, 0, 0.13, 105, 21, 0.4, 30, 0.004, 0.8],
  [9.6, 0, 0, 0.15, 110, 14, 0.45, 31, 0.0045, 1],
  // Pulls back with the whip and the pot-up, keeping the pot in the frame.
  [10.9, 0, 0, 0.3, 113, 9, 1.2, 32, 0.0075, 2.2],
  [12, 0, 0, 0.6, 118, 6, 2.8, 35, 0.015, 5],
  // Morning sun through the net, ahead and to the left.
  [13.2, 0, 0, 0.68, 116, 7, 3.4, 36, 0.018, 9],
  // Cranes back to show the bedded field, and comes round to bring the furrow, running to the
  // horizon, and its crossing beside the tree in on the left of a narrow frame too.
  [14.6, 0, 0, 0.62, 103, 10, 6, 38, 0.02, 14],
  [15.8, 0, 0, 0.62, 91, 9, 8.8, 40, 0.018, 22],
  // Low and close around the limbs, looking a little up, orbiting.
  [16.9, 0, 0, 1, 90, 0, 4.4, 42, 0.02, 9],
  [18.1, 0, 0, 1.6, 62, -6, 5, 43, 0.024, 12],
  [19.2, 0, 0, 1.95, 40, -5, 6.4, 42, 0.028, 14],
  // Year 6 on one day, then the years by.
  [20.2, 0, 0, 2.05, 56, -2, 7.8, 42, 0.028, 14],
  [21.4, 0, 0, 2.25, 84, 2, 9.2, 41, 0.03, 26],
  [22.6, 0, 0, 2.4, 100, 3, 10, 40, 0.03, 24],
  [24.8, 0, 0, 2.75, 104, 3.5, 12.5, 40, 0.03, 28],
  // Into the March sunrise, which rises at the end of the aisle.
  [27, 0, 0, 3.1, 108, 4, 15.5, 40, 0.03, 34],
  // Cranes up and back into the sunrise as the ring goes out, to rows that run to the horizon.
  [28.2, 1.5, -0.5, 2.8, 107, 7, 24, 40, 0.025, 40],
  [29.4, 4, -1, 2.4, 105, 11, 36, 39, 0.02, 50],
  [30.2, 7, -1.6, 1.8, 103, 14, 52, 38, 0.015, 60],
  [31, 9, -2, 1.5, 101, 15, 64, 38, 0.012, 60],
  // High, calm, generous.
  [31.8, 8, -2, 1.5, 98, 14, 64, 38, 0.012, 60],
  [32.6, 6, 0, 1.5, 96, 13, 60, 38, 0.012, 60],
  // The storm comes over from behind, and the camera dives into the north water furrow.
  [33.2, 0, 2, 2, 93, 10, 36, 37, 0.01, 50],
  [33.8, -14, 3.6, 0.6, 91, 9, 18, 36.5, 0.008, 40],
  // Low over the furrow between two canopy walls, looking east along it, the eye creeping east.
  getEyeKey(34.4, [-29, 3.8, 0.72], 90),
  getEyeKey(36.3, [-27.75, 3.8, 0.72], 89.5),
  getEyeKey(38.2, [-26.5, 3.8, 0.72], 89),
  // The eye, held, turning a little toward the line of the furrow. Its tilts up into the stadium
  // and down onto the mirror are `EYE_TILT_KEYS`, which no softening rounds off.
  getEyeKey(40.3, [-26.5, 3.8, 0.72], 90),
  // The second wall: the eye creeps on east.
  getEyeKey(42.2, [-26, 3.8, 0.72], 90.5, 8.4),
  getEyeKey(44, [-25.5, 3.8, 0.72], 91, 8),
  // The clearing: cranes up and back over the wrecks, to about 6 m.
  [45.6, -10, 2, 0.1, 94, 13, 25, 36, 0.012, 40],
  // The flood from 11 to 14 m up, looking east down the flooded rows.
  [46.6, -2, 0, 0.1, 96, 20, 32, 37, 0.012, 50],
  [47.8, 2, -2, 0.1, 100, 22, 36, 38, 0.012, 50],
  // Wide, swinging over the low east end, days then weeks.
  [49, 12, -2, 0.1, 110, 26, 38, 38, 0.012, 50],
  [50.4, 16, -6, 0.3, 130, 24, 36, 38, 0.012, 50],
  [51.4, 8, -4, 0.5, 140, 22, 32, 38, 0.012, 45],
  // Over the gaps as they are replanted.
  [53.2, 0, -6, 0.8, 160, 20, 28, 38, 0.012, 40],
  // Wide seasons round the grove, then down in the night into the bed middle south of the hero.
  // These two are placed by their eyes, in the aisle between the hero's row and the south row,
  // which the spec gives, not by the fruit: the fruit hangs at the skirt, 2 m north of the aisle,
  // and comes into the frame from the right as the camera turns onto it by 59.
  [55.4, 0, -3, 2, 230, 18, 40, 38, 0.012, 50],
  [56.4, 5.5, -3.6, 1.2, 270, 30, 9, 34, 0.012, 20],
  // Year 30 at sunrise, low in the bed middle, looking west down the aisle between the canopy walls
  // with the hero's skirt on the right, stopped down so its limbs and the mist along the rows read,
  // and focused at the skirt; then clockwise onto the fruit.
  [57.4, 4.2, -3.85, 0.9, 272, 3, 2.6, 32, 0.004, 14],
  [57.8, 3.9, -3.75, 0.9, 277, 2, 2.4, 32, 0.0045, 12],
  [59, HANG[0], HANG[1], HANG[2], 300, -4, 1.6, 30, 0.007, 8],
  [CYCLE_SECONDS + LOOP.stillAir[0] + 1, HANG[0], HANG[1], HANG[2], 318, -6, 1.12, 30, 0.006, 6],
  // The let-go's pose, as `RELATIVE_KEYS` has it, so that this track hands over to that one moving
  // on round the fruit rather than coming to rest at 60.
  [CYCLE_SECONDS + LOOP.letGo, HANG[0], HANG[1], HANG[2], 350, -8, 0.72, 30, 0.0055, 3]
];

/**
 * How much the camera is held by its eye rather than its target, by cycle second: low in the
 * storm's furrow, where the beat says where the eye is, and the tilts in the eye turn about it.
 */
const EYE_LOCK_KEYS: readonly Key[] = [
  [33.8, 0],
  [HURRICANE.firstWall, 1],
  [HURRICANE.clearing, 1],
  [45, 0]
];

/**
 * The tilts in the eye of the storm, as the pitch the camera turns to about its held eye, by cycle
 * second, read as they are. As the wind dies it tilts up past the torn root plate and the stripped
 * hero into the stadium, starting as the last of the first wall goes over so that it is up by 38.9,
 * and holds there through the 39.2 frame; then down onto the mirror, where it holds still through
 * the 39.9 frame and the second wall's cat's-paws at 40.0, and settles back to the furrow's pose as
 * the wind comes again. Every key is a turn or a hold, so the track rests at each: no frame the
 * story stops on is shot mid-tilt. The way down is the quickest move of the take, 28 degrees in
 * the 0.68 s those two frames leave it, about 62 degrees a second at most: slower would put one of
 * them mid-tilt.
 */
const EYE_TILT_KEYS: readonly Key[] = [
  [HURRICANE.eyeOpen - 0.2, STORM_PITCH],
  [38.9, -18],
  [39.2, -18],
  [39.88, 10],
  [40.08, 10],
  [40.5, STORM_PITCH]
];

/**
 * The take around the swap, on seam seconds, relative to the falling orange: from the hanging
 * fruit, a dive round it until its rind fills the frame at the swap, then back off it as it lands.
 * The orbit is unwrapped; distance and aperture are in metres and move in log space. The distance
 * is least at the swap, so the camera has no speed toward the fruit there. The first key, at
 * `LOOP.stillAir[0]`, is the 59.0 pose of `CAMERA_KEYS`, which the take hands over from, so both
 * tracks move on together through the hand-over and neither comes to rest at seam -4.
 */
const RELATIVE_KEYS: {
  orbit: readonly Key[];
  pitch: readonly Key[];
  distance: readonly Key[];
  aperture: readonly Key[];
  reach: readonly Key[];
  fovy: number;
} = {
  orbit: [
    [LOOP.stillAir[0], 300],
    [-4, 318],
    [-2.3, 350],
    [-1, 385],
    [-0.35, 406],
    [0, 412],
    [0.25, 414],
    [0.8, 416],
    [1.6, 417],
    [2.6, 418]
  ],
  pitch: [
    [LOOP.stillAir[0], -4],
    [-4, -6],
    [-2.3, -8],
    [-1, 6],
    [-0.35, 15],
    [0, 18],
    [0.25, 17],
    // Looking down on the impact from a little further back, so the squash and the sand's crown
    // stand clear above the timeline, and then down to the opening's low macro.
    [0.8, 15.5],
    [1.6, 11],
    [2.6, 6]
  ],
  // Close enough at the file's first frame, 0.8 m, that the fruit is a fifth of the frame across.
  distance: [
    [LOOP.stillAir[0], 1.6],
    [-4, 1.12],
    [-2.3, 0.72],
    [-1, 0.3],
    [-0.35, 0.075],
    [0, 0.068],
    [0.25, 0.075],
    [0.8, 0.25],
    [1.25, 0.32],
    [2.6, 0.265]
  ],
  aperture: [
    [LOOP.stillAir[0], 0.007],
    [-4, 0.006],
    [-2.3, 0.0055],
    [-0.8, 0.0025],
    [0, 0.0018],
    [0.25, 0.0018],
    [0.8, 0.0026],
    [1.6, 0.0042],
    [2.6, 0.0052]
  ],
  reach: [
    [LOOP.stillAir[0], 8],
    [-4, 6],
    [-1, 1],
    [-0.35, 0.45],
    [0.25, 0.45],
    [2.6, 0.5]
  ],
  fovy: 30
};

/** How much the take rides the orange, by seam second. Both hold the same pose where they hand over. */
const FOLLOW_KEYS: readonly Key[] = [
  [LOOP.stillAir[0], 0],
  [LOOP.stillAir[0] + 1, 1],
  [1.6, 1],
  [LOOP.stillAir[1], 0]
];
/**
 * How much the aim goes after the fruit once it has let go, by seam second. Until then, and for
 * more than half a second after, it stays on where the fruit hung, under its stalk, so the let-go
 * is an event: the fruit drops away from the stalk springing back, down out of the middle of the
 * frame by more than its own radius, and only then does the take dive after it. It drops no lower
 * than the timeline's flags, and the aim is on it again well before the rind fills the frame.
 */
const LET_GO_FOLLOW_KEYS: readonly Key[] = [
  [-1.7, 0],
  [-1.25, 1]
];
/** Seam seconds either way the fruit's offset is softened over: its fall, its impact, its roll. */
const FRUIT_SOFTEN_SECONDS = 0.35;
/**
 * Seconds between the readings that soften the fruit's and the seed's moves: densely, so their
 * impacts ease the camera in and out smoothly rather than in steps as each reading passes them.
 */
const SOFTEN_STEP = 1 / 240;
const FRUIT_SOFTEN_WEIGHTS = getBellWeights(FRUIT_SOFTEN_SECONDS, SOFTEN_STEP);

/** How much the focus rides on the seed itself, by cycle second. */
const SEED_FOLLOW_KEYS: readonly Key[] = [
  [4.9, 0],
  [5.2, 1],
  [6.1, 1],
  [6.8, 0]
];

/** Every channel is averaged over this neighbourhood, so speed changes gently. */
const SOFTEN_SECONDS = 0.6;
/**
 * The same for the seed's flight, whose start and end are abrupt: as much softening as the 0.45 s
 * binomial row it had, in the dense bell.
 */
const SEED_SOFTEN_SECONDS = 0.34;
const SEED_SOFTEN_WEIGHTS = getBellWeights(SEED_SOFTEN_SECONDS, SOFTEN_STEP);

/**
 * A narrow frame shows the same subject by widening first and pulling back only past `mostFovy`,
 * eased onto that cap over `capSoftness` of its tangent. At the `from` aspect and wider the frame is
 * untouched; `power` says how quickly it grows below that. The subject is also lifted by `lift` of
 * the frame's height to keep it clear of the timeline, but not in the dive onto the fruit, nor where
 * the camera is held by its eye.
 */
const PORTRAIT = {
  from: 1.2,
  power: 0.7,
  mostFovy: 62,
  capSoftness: 0.05,
  lift: 0.05,
  liftFull: 0.7
};
/** Seam seconds over which the portrait lift fades out before the swap, and back in after it. */
const LIFT_GONE = [-1.2, -0.4, 0.4, 1.2] as const;

/**
 * Shake in the storm, in degrees: a base by cycle second, rising from 33.6 into the walls, slight
 * in the eye and gone by 44.6, and this much more at each of the walls' gusts, at these rates on
 * the scene clock.
 */
const SHAKE_KEYS: readonly Key[] = [
  [33.6, 0],
  [HURRICANE.firstWall, 0.25],
  [HURRICANE.eyeOpen, 0.25],
  [HURRICANE.eyeOpen + 0.4, 0.03],
  [HURRICANE.eyeClose, 0.03],
  [HURRICANE.eyeClose + 0.4, 0.25],
  [HURRICANE.clearing, 0.25],
  [44.6, 0]
];
const SHAKE_GUST = 0.35;
const SHAKE_GUST_KEYS: readonly Key[] = [
  [33.6, 0],
  [HURRICANE.firstWall, 1],
  [HURRICANE.eyeOpen, 1],
  [HURRICANE.eyeOpen + 0.3, 0],
  [HURRICANE.eyeClose + 0.1, 0],
  [HURRICANE.eyeClose + 0.4, 1],
  [HURRICANE.clearing, 1],
  [44.6, 0]
];
const SHAKE_RATES = [3.1, 7.3];
const SHAKE_SHARE = [0.7, 0.3];
const SHAKE_PITCH = 0.7;

/**
 * The planes, in metres from the eye. `near` is a small share of the distance to the nearer of the
 * target and the ground in the bottom of the frame, and stays this far inside the nearest crown: it
 * matters little to the shadow map, which is fit to the far corners. `far` covers the target's
 * `reach` and every tree in view, each tree's part fading as it nears the frame's edge. Across
 * `LOOP.pinned` they are `LOOP.pinnedPlanes`, eased to and from over `pinEase` seam seconds, so
 * the shadow map is fit to one frustum either side of the swap.
 */
const PLANES = {
  nearShare: 0.015,
  nearLeast: 0.003,
  nearMost: 2,
  crownShare: 0.5,
  crownLeast: 0.1,
  farMargin: 2,
  /**
   * A tree counts while its side is within this many frame half-widths, fading out past the first.
   */
  viewFrom: 1,
  viewFade: 1.25,
  /** Far is always at least this many times near. */
  leastRatio: 4,
  /**
   * Seam seconds the planes ease to and from the pinned ones over, just outside `LOOP.pinned` and
   * inside `LOOP.cover`, where the rind is all there is to see: the far plane comes in from the
   * trees behind the fruit to half a metre, and nothing it passes is on screen.
   */
  pinEase: 0.05
};

function getColumnTrack(column: number, isLog = false): Track {
  return createTrack(
    CAMERA_KEYS.map(key => [key[0], isLog ? Math.log(key[column]) : key[column]] as const)
  );
}

/** A track of the eye of every key, along one axis. */
function getEyeTrack(axis: number): Track {
  return createTrack(
    CAMERA_KEYS.map(key => {
      const forward = getForward(key[4], key[5]);
      return [key[0], key[1 + axis] - forward[axis] * key[6]] as const;
    })
  );
}

function getLogTrack(keys: readonly Key[]): Track {
  return createTrack(keys.map(([x, y]) => [x, Math.log(y)] as const));
}

/** The unit vector a camera at this orbit and pitch looks along. */
function getForward(orbit: number, pitch: number): Vec3 {
  const o = orbit * RADIANS_PER_DEGREE;
  const p = pitch * RADIANS_PER_DEGREE;
  return [Math.sin(o) * Math.cos(p), Math.cos(o) * Math.cos(p), -Math.sin(p)];
}

const TRACKS = {
  targetX: getColumnTrack(1),
  targetY: getColumnTrack(2),
  targetZ: getColumnTrack(3),
  eyeX: getEyeTrack(0),
  eyeY: getEyeTrack(1),
  eyeZ: getEyeTrack(2),
  orbit: getColumnTrack(4),
  pitch: getColumnTrack(5),
  logDistance: getColumnTrack(6, true),
  fovy: getColumnTrack(7),
  logAperture: getColumnTrack(8, true),
  logReach: getColumnTrack(9, true)
};

const RELATIVE = {
  orbit: createTrack(RELATIVE_KEYS.orbit),
  pitch: createTrack(RELATIVE_KEYS.pitch),
  logDistance: getLogTrack(RELATIVE_KEYS.distance),
  logAperture: getLogTrack(RELATIVE_KEYS.aperture),
  logReach: getLogTrack(RELATIVE_KEYS.reach)
};

const getEyeLock = createTrack(EYE_LOCK_KEYS);
const getFollow = createTrack(FOLLOW_KEYS);
const getLetGoFollow = createTrack(LET_GO_FOLLOW_KEYS);
const getSeedFollow = createTrack(SEED_FOLLOW_KEYS);
const getShakeBase = createTrack(SHAKE_KEYS);
const getShakeGust = createTrack(SHAKE_GUST_KEYS);

/** Where the operator aims when following the seed: its flight, without its sudden changes. */
function getSoftenedSeed(t: number): Vec3 {
  return getSoftenedPoint(getSeedPosition, t, SEED_SOFTEN_SECONDS, SEED_SOFTEN_WEIGHTS);
}

/**
 * The fruit's centre from the land under its fall line, softened on seam seconds, through the swap:
 * the falling orange that the take rides, without the stop of its impact.
 */
function getSoftenedFruit(t: number): Vec3 {
  return getSoftenedPoint(
    second => getFruitTrack(second).offset,
    t,
    FRUIT_SOFTEN_SECONDS,
    FRUIT_SOFTEN_WEIGHTS
  );
}

/**
 * Where the take aims, from the land under the fruit's fall line, at `t`: where the fruit hung until
 * a while after it lets go, then the fruit itself, softened. See `LET_GO_FOLLOW_KEYS`.
 */
function getFruitAim(t: number): Vec3 {
  const after = getLetGoFollow(getSeamSeconds(t));
  if (after <= 0) return HANG_OFFSET;
  const softened = getSoftenedFruit(t);
  return after >= 1 ? softened : mixVec3(HANG_OFFSET, softened, after);
}

/** The unit vector the camera looks along. */
export function getCameraForward(camera: StoryCamera): Vec3 {
  return getForward(camera.orbit, camera.pitch);
}

/** Where the camera's eye is. */
export function getCameraEye(camera: StoryCamera): Vec3 {
  const forward = getCameraForward(camera);
  return [
    camera.target[0] - forward[0] * camera.distance,
    camera.target[1] - forward[1] * camera.distance,
    camera.target[2] - forward[2] * camera.distance
  ];
}

/**
 * The planes for a pose among the trees as they are at this moment, over the land and the water
 * under it.
 */
function getPlanes(
  pose: Omit<StoryCamera, 'near' | 'far'>,
  reach: number,
  aspect: number,
  trees: readonly TreeSpec[],
  flood: StoryFlood
): {near: number; far: number} {
  const camera = {...pose, near: 0, far: 0};
  const eye = getCameraEye(camera);
  const forward = getCameraForward(camera);
  const flat = Math.hypot(forward[0], forward[1]);
  const across = [forward[1] / flat, -forward[0] / flat];
  const along = [forward[0] / flat, forward[1] / flat];
  const halfWidth = Math.tan((pose.fovy / 2) * RADIANS_PER_DEGREE) * aspect;
  const bottomRay = pose.pitch + pose.fovy / 2;
  const ground = Math.max(getLandHeight(eye[0], eye[1]), flood.level);
  const groundSeen =
    bottomRay > 0.5
      ? Math.max(eye[2] - ground, 0.001) / Math.sin(bottomRay * RADIANS_PER_DEGREE)
      : Infinity;

  let closest = Math.min(pose.distance, groundSeen) * PLANES.nearShare;
  let far = pose.distance + reach;
  for (const tree of trees) {
    const growth = tree.growth as number;
    if (growth > 0) {
      const position = tree.position as ArrayLike<number>;
      const dx = position[0] - eye[0];
      const dy = position[1] - eye[1];
      const height = (tree.height as number) * getHeightFraction(growth);
      const crown = (tree.crownRadius as number) * getCrownFraction(growth);
      // A standing tree as a ball around its crown, and one that is going as a ball around its
      // base.
      const lean = (tree.lean as number[])[0];
      const fallen = smoothstep(10, 40, lean);
      const size = lerp(Math.max(crown, height / 2), height, fallen);
      const dz = (tree.elevation as number) + lerp(height / 2, 0, fallen) - eye[2];
      const present = smoothstep(0, 0.02, growth);
      const clear = Math.max(Math.hypot(dx, dy, dz) - size, PLANES.crownLeast);
      closest = Math.min(closest, (clear * PLANES.crownShare) / Math.max(present, 1e-3));
      const depth = dx * along[0] + dy * along[1];
      const side = Math.abs(dx * across[0] + dy * across[1]) - size;
      const inView =
        1 - smoothstep(PLANES.viewFrom, PLANES.viewFade, side / (Math.max(depth, 1) * halfWidth));
      far = Math.max(far, (depth + size + PLANES.farMargin) * inView * present);
    }
  }
  const near = clamp(closest, PLANES.nearLeast, PLANES.nearMost);
  return {near, far: Math.max(far, near * PLANES.leastRatio)};
}

/** The pitch the eye of the storm tilts to, about its held eye, as `EYE_TILT_KEYS` has it. */
const getEyePitch = createTrack(EYE_TILT_KEYS);

/** Degrees the eye's tilts add to the pitch it holds in the furrow: 0 outside the eye. */
function getEyeTilt(seconds: number): number {
  const first = EYE_TILT_KEYS[0][0];
  const last = EYE_TILT_KEYS[EYE_TILT_KEYS.length - 1][0];
  return seconds > first && seconds < last ? getEyePitch(seconds) - STORM_PITCH : 0;
}

/** 0-1, how far the planes have come to `LOOP.pinnedPlanes` at seam second `seam`. */
function getPinning(seam: number): number {
  const [from, to] = LOOP.pinned;
  return pulse(from - PLANES.pinEase, from, to, to + PLANES.pinEase, seam);
}

/**
 * The take at `t`, composed from `world`'s side of the swap, for a frame of this aspect, among the
 * trees as they are now, over the water they may stand in. `orange` is the fruit as it is drawn,
 * which the relative keys ride by way of `getFruitTrack`.
 */
export function getStoryCamera(
  t: number,
  world: StoryWorld,
  aspect: number,
  trees: readonly TreeSpec[],
  orange: StoryOrange,
  flood: StoryFlood
): StoryCamera {
  const seconds = getContentSeconds(t, world);
  const seam = getSeamSeconds(t);
  const read = (track: Track) => getSoftened(track, seconds, SOFTEN_SECONDS);

  // The world's keys, held by the target or, in the storm, by the eye, which the eye's tilts turn
  // about.
  let orbit = read(TRACKS.orbit);
  let pitch = read(TRACKS.pitch) + getEyeTilt(seconds);
  let distance = Math.exp(read(TRACKS.logDistance));
  let fovy = read(TRACKS.fovy);
  let aperture = Math.exp(read(TRACKS.logAperture));
  let reach = Math.exp(read(TRACKS.logReach));
  const path: Vec3 = [read(TRACKS.targetX), read(TRACKS.targetY), read(TRACKS.targetZ)];
  const seedFollow = getSeedFollow(seconds);
  let target = seedFollow > 0 ? mixVec3(path, getSoftenedSeed(seconds), seedFollow) : path;
  const lock = getEyeLock(seconds);
  if (lock > 0) {
    const forward = getForward(orbit, pitch);
    const eye: Vec3 = [read(TRACKS.eyeX), read(TRACKS.eyeY), read(TRACKS.eyeZ)];
    target = mixVec3(
      target,
      [
        eye[0] + forward[0] * distance,
        eye[1] + forward[1] * distance,
        eye[2] + forward[2] * distance
      ],
      lock
    );
  }

  // Around the swap, the fruit's.
  const follow = getFollow(seam);
  if (follow > 0) {
    const {anchor} = getFruitTrack(t, world);
    const offset = getFruitAim(t);
    const fruit: Vec3 = [anchor[0] + offset[0], anchor[1] + offset[1], anchor[2] + offset[2]];
    target = mixVec3(target, fruit, follow);
    orbit += follow * getAngleBetween(orbit, RELATIVE.orbit(seam));
    pitch = lerp(pitch, RELATIVE.pitch(seam), follow);
    distance = Math.exp(lerp(Math.log(distance), RELATIVE.logDistance(seam), follow));
    fovy = lerp(fovy, RELATIVE_KEYS.fovy, follow);
    aperture = Math.exp(lerp(Math.log(aperture), RELATIVE.logAperture(seam), follow));
    reach = Math.exp(lerp(Math.log(reach), RELATIVE.logReach(seam), follow));
  }

  if (aspect < PORTRAIT.from) {
    const tangent = Math.tan((fovy / 2) * RADIANS_PER_DEGREE);
    const wanted = tangent * Math.pow(PORTRAIT.from / aspect, PORTRAIT.power);
    // Eased onto its cap, so that the lens's widening and the dolly back that takes over from it
    // hand over with matching rates.
    const most = Math.max(Math.tan((PORTRAIT.mostFovy / 2) * RADIANS_PER_DEGREE), tangent);
    const widened = getSoftMin(wanted, most, most * PORTRAIT.capSoftness);
    fovy = (2 * Math.atan(widened)) / RADIANS_PER_DEGREE;
    distance *= wanted / widened;
    // The aim drops below the subject, which lifts it in the frame, with the eye where it was.
    const lifted =
      (1 - pulse(LIFT_GONE[0], LIFT_GONE[1], LIFT_GONE[2], LIFT_GONE[3], seam)) * (1 - lock);
    const lift =
      PORTRAIT.lift *
      2 *
      distance *
      widened *
      smoothstep(PORTRAIT.from, PORTRAIT.liftFull, aspect) *
      lifted;
    const across = distance * Math.cos(pitch * RADIANS_PER_DEGREE);
    const above = distance * Math.sin(pitch * RADIANS_PER_DEGREE) + lift;
    target = [target[0], target[1], target[2] - lift];
    pitch = Math.atan2(above, across) / RADIANS_PER_DEGREE;
    distance = Math.hypot(across, above);
  }

  const pose = {target, orbit, pitch, distance, fovy, aperture};
  const planes = getPlanes(pose, reach, aspect, trees, flood);
  const pinning = getPinning(seam);
  if (pinning > 0) {
    const {near, far} = LOOP.pinnedPlanes;
    planes.near = Math.exp(lerp(Math.log(planes.near), Math.log(near), pinning));
    planes.far = Math.exp(lerp(Math.log(planes.far), Math.log(far), pinning));
  }
  return {...pose, ...planes};
}

/**
 * What `OrbitView` and its view state need to show this camera in a frame `height` pixels tall. An
 * `OrbitView` measures its planes in units of the frame's height, so metres scale by where the
 * target lands. `shake` adds to orbit and pitch.
 */
export function getOrbitViewProps(
  camera: StoryCamera,
  height: number,
  shake: readonly [number, number] = [0, 0]
): {
  view: {orbitAxis: 'Z'; fovy: number; near: number; far: number};
  viewState: {
    target: Vec3;
    rotationOrbit: number;
    rotationX: number;
    zoom: number;
    minZoom: number;
    maxZoom: number;
  };
} {
  const focal = 0.5 / Math.tan((camera.fovy / 2) * RADIANS_PER_DEGREE);
  const unitsPerMetre = focal / camera.distance;
  return {
    view: {
      orbitAxis: 'Z',
      fovy: camera.fovy,
      near: camera.near * unitsPerMetre,
      far: camera.far * unitsPerMetre
    },
    viewState: {
      target: camera.target,
      rotationOrbit: camera.orbit + shake[0],
      rotationX: camera.pitch + shake[1],
      zoom: Math.log2(unitsPerMetre * height),
      minZoom: -30,
      maxZoom: 40
    }
  };
}

/**
 * Shake at cycle second `seconds`, in degrees added to orbit and pitch: 0.25 plus 0.35 times the
 * gust at the view centre in the walls, slight in the eye, and none elsewhere, at its rates on the
 * scene clock `clock`.
 */
export function getCameraShake(seconds: number, clock: number, gust: number): [number, number] {
  const amount = getShakeBase(seconds) + SHAKE_GUST * gust * getShakeGust(seconds);
  if (amount <= 0) return [0, 0];
  const getWobble = (seed: number) =>
    SHAKE_SHARE[0] * smoothNoise(clock * SHAKE_RATES[0], seed) +
    SHAKE_SHARE[1] * smoothNoise(clock * SHAKE_RATES[1], seed + 1);
  return [amount * getWobble(81), SHAKE_PITCH * amount * getWobble(83)];
}
