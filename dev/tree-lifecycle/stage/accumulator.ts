// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The photographic pipeline: how a film renderer gets its look from a rasterizer. A frame is drawn
 * many times, each time with its clock, its lens, its pixel grid and its sun moved a little, and
 * the pictures are averaged as a sensor would, in scene-linear light. That one idea gives motion
 * blur, depth of field, antialiasing and soft shadows, all at once and all correct.
 *
 * What a layer writes is display light: scene light through the filmic curve the photoreal shaders
 * end on, then gamma. Sub-frames are added after undoing both, so a highlight outweighs the dark
 * beside it as it does on film, thin twigs burn away against a bright sky, and exposure rolls off
 * as a stop does. Finishing then runs the curve again, so a frame with nothing to do comes back
 * unchanged. See `FILM.md`.
 *
 * `getSubFrames` and the helpers around it are pure. `Accumulator` has the GL, in deck's own
 * context, where it costs no more than a second context and can keep what a sub-frame shaded in
 * float, which 8-bit canvas pixels cannot: a slow sky gradient that stands still across sub-frames
 * has no 8-bit steps to keep.
 */

import type {Framebuffer, Texture} from '@luma.gl/core';
import type {WebGLDevice} from '@luma.gl/webgl';
import {getCrownFraction, getHeightFraction} from '../story/beats';
import {getCameraEye, getCameraForward} from '../story/camera';
import {hash01, lerp, RADIANS_PER_DEGREE, smoothstep} from '../story/story-math';
import type {StoryCamera, StoryGrade, StoryState, Vec3} from '../story/story-types';

/** Where one sub-frame's clock, lens, pixel grid and sun are, for one index of a frame. */
export type SubFrame = {
  /** 0-1 across the shutter. It only ever rises across a frame's sub-frames. */
  shutter: number;
  /** On the unit disc of the lens. */
  lens: readonly [number, number];
  /** In device pixels, on the image plane. */
  pixel: readonly [number, number];
  /** On the unit disc of the sun. */
  sun: readonly [number, number];
};

/** The one sub-frame of a frame that is not accumulating: no jitter, the frame's own moment. */
export const PINHOLE_SUB_FRAME: SubFrame = {
  shutter: 0.5,
  lens: [0, 0],
  pixel: [0, 0],
  sun: [0, 0]
};

/** A 180-degree shutter, as a fraction of a frame. */
export const DEFAULT_SHUTTER = 0.5;
export const DEFAULT_FPS = 30;

/** How far a sub-frame may shift the pixel grid, in device pixels: the reach of a tent filter. */
const PIXEL_FILTER_REACH = 1;
/** The lens stays on its disc however low a camera looks along the orbit axis. */
const LEAST_PITCH_COSINE = 0.1;
/**
 * Below this many pixels between the points of a lens, in a frame's far blur, a thin thing out of
 * focus stops showing as a row of ghosts.
 */
const LENS_POINT_SPACING = 6;
/**
 * The most `getLensSamples` raises a count by. The widest lens of the macro beats would ask for
 * more than twice this, for what the eye can no longer tell apart.
 */
const MOST_LENS_SAMPLES_SCALE = 4;
/** Counts that come from `getLensSamples` are multiples of this. */
const LENS_SAMPLES_STEP = 8;
/**
 * What moves in a frame by itself, for `getShutterTravel`. Below `spacing` pixels between the
 * sub-frames' copies of something moving across the shutter, it blurs; above, it shows as a row of
 * them, a brush's smear, and a fruit's highlight as a row of dots: sharp things in motion need
 * their copies closer than the lens's points do. In a wind the leaves of a crown whip about at up
 * to `leafSpeed` metres a second at full strength, growing as `leafPower` of it, and a crown nearer
 * than `leastDepth` is counted at it. Only trees within `reach` metres are looked at, for a crown
 * going over or thrashing near the lens is what smears.
 */
const MOTION = {spacing: 3, leafSpeed: 4, leafPower: 1.5, leastDepth: 0.5, reach: 40};

/** The R2 sequence's steps, from the plastic number. */
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

/**
 * How a focus puller works. A camera's target is the middle of what it shows, but a lens is focused
 * on the side of it that can be seen: a share of the way to the near side of a closed orange or of
 * the hero's crown. Away from either, by these many of its radii, or as the orange's halves part,
 * it is back on the target. The crown's rule comes in only as the target leaves the orange, over
 * `orangeNear` to `orangeFar` of its radii, so a fruit hanging at the hero's skirt keeps the focus.
 */
const FOCUS = {
  orangeShare: 0.9,
  /**
   * Radii from the fruit's centre over which that share comes to the whole radius as the lens
   * closes in, so that in the dive onto it, at 0.068 m round the swap, the focus is on the near
   * rind itself rather than millimetres behind it. Its pull is never held to `leastDistance`.
   */
  orangeClose: [6, 2] as const,
  orangeNear: 1.5,
  orangeFar: 4,
  halvesApart: 2.5,
  crownShare: 0.6,
  /**
   * Radii of the crown from its trunk over which the target leaves it. Past the drip line the line
   * of sight to a target, such as the aisle beside the hero at the finale, no longer goes through
   * the crown, and pulling the focus in would leave it on empty air.
   */
  crownNear: 0.75,
  crownFar: 1.1,
  /** The growth over which a crown closes: a whip's few leaves are all in the plane of its stem. */
  crownCloses: [0.1, 0.3] as const,
  /** Never closer than this share of the way to the target. */
  leastDistance: 0.5
};

/** Salts for the shuffles of each jittered quantity. */
const SHUFFLE_LENS = 11;
const SHUFFLE_PIXEL = 23;
const SHUFFLE_SUN = 37;

/** Everything finishing needs to know that is not in `StoryGrade`. */
const FINISH = {
  /** How much of the light past the threshold a `grade.bloom` of 1 spreads back over the frame. */
  bloomStrength: 0.75,
  /** Scene-linear brightness bloom starts from, with a soft knee around it. */
  bloomThreshold: 1.1,
  bloomKnee: 0.5,
  /** Levels of the bloom pyramid, each half the size of the last. */
  bloomLevels: 6,
  /** How much each coarser level adds to the one below it: wide and subtle. */
  bloomSpread: 0.85,
  /** Red and blue, up and down, of a `grade.warmth` of 1, in scene-linear light. */
  warmth: 0.2,
  /** Grain at `grade.grain` 1, in display values at mid gray. */
  grain: 0.26,
  /** Grain in the deepest shadows and highest highlights, against mid gray. */
  grainFloor: 0.42,
  /** Size of a grain against a pixel of a 1080-line frame. */
  grainSize: 1.25,
  /** Of the grain, how much differs from channel to channel. */
  grainColor: 0.18,
  /** The power of `grade.fade` that exposure follows, so a fade reads evenly to the eye. */
  fadePower: 2.6
};

function getFraction(value: number): number {
  return value - Math.floor(value);
}

/**
 * The square's `[0, 1]^2` to the unit disc, by Shirley and Chiu's map, which keeps a sequence even.
 */
export function getDiscPoint(u: number, v: number): [number, number] {
  const a = 2 * u - 1;
  const b = 2 * v - 1;
  if (a === 0 && b === 0) return [0, 0];
  const isWide = Math.abs(a) > Math.abs(b);
  const radius = isWide ? a : b;
  const angle = isWide ? (Math.PI / 4) * (b / a) : Math.PI / 2 - (Math.PI / 4) * (a / b);
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

/** 0-1 to a tent of width `reach` either side of 0, which a pixel filter is. */
function getTentPoint(u: number, reach: number): number {
  return reach * (u < 0.5 ? Math.sqrt(2 * u) - 1 : 1 - Math.sqrt(2 - 2 * u));
}

/**
 * A stable shuffle of `0..count-1`, by hash, which decorrelates one jittered quantity from another.
 */
function getShuffle(count: number, salt: number): number[] {
  const order = Array.from({length: count}, (_, index) => index);
  for (let index = count - 1; index > 0; index--) {
    const other = Math.floor(hash01(index, salt) * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  return order;
}

/**
 * Moves a set of points so they average 0, so the average of a frame's sub-frames stays where it
 * was.
 */
function getCentered<PointT extends readonly [number, number]>(points: PointT[]): PointT[] {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0] / points.length;
    y += point[1] / points.length;
  }
  return points.map(point => [point[0] - x, point[1] - y] as unknown as PointT);
}

const subFramesByCount = new Map<number, readonly SubFrame[]>();

/**
 * A frame's sub-frames. Index by index they are the same for every frame, so noise does not crawl.
 * The clock is stratified and only rises, as `TreeLayer`'s rates need. Lens, pixel grid and sun are
 * each on their own shuffle of one R2 set, which keeps each of them even over the frame and
 * independent of the others. One sample has no jitter.
 */
export function getSubFrames(samples: number): readonly SubFrame[] {
  const count = Math.max(1, Math.floor(samples));
  if (count === 1) return [PINHOLE_SUB_FRAME];
  const known = subFramesByCount.get(count);
  if (known) return known;
  const points = Array.from({length: count}, (_, index): [number, number] => [
    getFraction(0.5 + index * R2_X),
    getFraction(0.5 + index * R2_Y)
  ]);
  const lensOrder = getShuffle(count, SHUFFLE_LENS);
  const pixelOrder = getShuffle(count, SHUFFLE_PIXEL);
  const sunOrder = getShuffle(count, SHUFFLE_SUN);
  const lens = getCentered(lensOrder.map(index => getDiscPoint(...points[index])));
  const sun = getCentered(sunOrder.map(index => getDiscPoint(...points[index])));
  const pixel = getCentered(
    pixelOrder.map((index): [number, number] => [
      getTentPoint(points[index][0], PIXEL_FILTER_REACH),
      getTentPoint(points[index][1], PIXEL_FILTER_REACH)
    ])
  );
  const subFrames = points.map(
    (_, index): SubFrame => ({
      shutter: (index + 0.5) / count,
      lens: lens[index],
      pixel: pixel[index],
      sun: sun[index]
    })
  );
  subFramesByCount.set(count, subFrames);
  return subFrames;
}

/** The story second of a sub-frame of the frame at `t`. */
export function getSubFrameSeconds(
  t: number,
  subFrame: SubFrame,
  shutter = DEFAULT_SHUTTER,
  fps = DEFAULT_FPS
): number {
  return t + ((subFrame.shutter - 0.5) * shutter) / fps;
}

/**
 * Degrees to add to orbit and pitch to put the eye where a sub-frame's lens point is, on a disc of
 * `aperture` radius. Orbiting keeps the target on the same pixel, so what is at the focus distance
 * stays sharp, and anything else moves by `aperture * |d - distance| / d` on the image plane.
 */
export function getLensAngles(
  camera: Pick<StoryCamera, 'aperture' | 'distance' | 'pitch'>,
  lens: readonly [number, number],
  apertureScale = 1
): [orbit: number, pitch: number] {
  const reach = (camera.aperture * apertureScale) / camera.distance / RADIANS_PER_DEGREE;
  const cosine = Math.max(Math.cos(camera.pitch * RADIANS_PER_DEGREE), LEAST_PITCH_COSINE);
  return [(lens[0] * reach) / cosine, lens[1] * reach];
}

/**
 * Metres nearer than `camera.target` that the lens focuses, for this moment of the film. See
 * `FOCUS`. Moving a target along the line of sight and bringing the distance in by as much leaves
 * the eye and the picture alone.
 */
export function getFocusPull({
  camera,
  props,
  trees
}: Pick<StoryState, 'camera' | 'props' | 'trees'>): number {
  const {target, distance} = camera;
  let orangePull = 0;
  let crownPull = 0;
  // How much the target is off the orange: the crown's rule takes over only as it leaves it.
  let offOrange = 1;
  const {orange} = props;
  if (orange.visible) {
    const {radius} = orange;
    const away = Math.hypot(
      target[0] - orange.position[0],
      target[1] - orange.position[1],
      target[2] - orange.position[2]
    );
    const [a, b] = orange.halves;
    const apart = Math.hypot(
      a.position[0] - b.position[0],
      a.position[1] - b.position[1],
      a.position[2] - b.position[2]
    );
    offOrange = smoothstep(radius * FOCUS.orangeNear, radius * FOCUS.orangeFar, away);
    const close = smoothstep(
      radius * FOCUS.orangeClose[0],
      radius * FOCUS.orangeClose[1],
      distance
    );
    orangePull =
      radius *
      lerp(FOCUS.orangeShare, 1, close) *
      (1 - offOrange) *
      (1 - smoothstep(0, radius * FOCUS.halvesApart, apart));
  }
  const hero = trees[0];
  const growth = hero.growth as number;
  const closed = smoothstep(FOCUS.crownCloses[0], FOCUS.crownCloses[1], growth) * offOrange;
  if (closed > 0) {
    const position = hero.position as ArrayLike<number>;
    const crown = (hero.crownRadius as number) * getCrownFraction(growth);
    const away = Math.hypot(target[0] - position[0], target[1] - position[1]);
    const aimed = 1 - smoothstep(crown * FOCUS.crownNear, crown * FOCUS.crownFar, away);
    crownPull = crown * FOCUS.crownShare * aimed * closed;
  }
  // A crown never takes the focus nearer than `leastDistance` of the way to the target; the orange
  // takes it to its near rind, a millimetre in front of the lens at the nearest.
  return Math.max(
    Math.min(crownPull, distance * (1 - FOCUS.leastDistance)),
    Math.min(orangePull, distance - 0.001)
  );
}

/**
 * The same eye and the same picture, with its target where the lens focuses, `pull` metres nearer.
 */
export function getFocusedCamera(camera: StoryCamera, pull: number): StoryCamera {
  if (pull <= 0) return camera;
  const forward = getCameraForward(camera);
  return {
    ...camera,
    distance: camera.distance - pull,
    target: [
      camera.target[0] - forward[0] * pull,
      camera.target[1] - forward[1] * pull,
      camera.target[2] - forward[2] * pull
    ]
  };
}

/**
 * Pixels of blur radius a lens gives what is far beyond its focus, in a frame this many pixels
 * high.
 */
export function getFarBlurRadius(
  camera: Pick<StoryCamera, 'aperture' | 'distance' | 'fovy'>,
  height: number,
  apertureScale = 1
): number {
  const focal = (0.5 * height) / Math.tan((camera.fovy / 2) * RADIANS_PER_DEGREE);
  return (camera.aperture * apertureScale * focal) / camera.distance;
}

/**
 * How many samples a frame needs for a lens this wide to blur rather than to repeat, at least
 * `samples`. Points of a lens spread evenly over its disc, so their spacing in the image is `radius
 * * sqrt(pi / n)`. It rarely matters past macro, and macro is what is cheap to draw. With `travel`,
 * the pixels the picture moves across the shutter (`getShutterTravel`), it also takes what that
 * motion needs to blur, as `getMotionSamples` says, within the same limit.
 */
export function getLensSamples(samples: number, farBlurRadius: number, travel = 0): number {
  if (samples <= 1) return 1;
  const needed = Math.max(
    Math.PI * (farBlurRadius / LENS_POINT_SPACING) ** 2,
    getMotionSamples(samples, travel)
  );
  if (needed <= samples) return samples;
  const stepped = Math.ceil(needed / LENS_SAMPLES_STEP) * LENS_SAMPLES_STEP;
  return Math.min(stepped, samples * MOST_LENS_SAMPLES_SCALE);
}

/**
 * How many samples a frame needs for what moves `travel` pixels across its shutter to blur rather
 * than to stand in a row of copies, at least `samples`: the sub-frames' copies of it are spread
 * evenly along its path, so they are `travel / n` apart. `getLensSamples` takes the larger of this
 * and what its lens asks for, within the same limit.
 */
export function getMotionSamples(samples: number, travel: number): number {
  if (samples <= 1) return 1;
  return Math.max(samples, Math.ceil(travel / MOTION.spacing));
}

/**
 * What of a frame moves across its shutter, copied out of its state, whose trees the next
 * `getStoryState` rewrites, so that the shutter's two ends can be compared by `getShutterTravel`:
 * the camera as it is drawn, shaken; the points that move fastest by themselves, the top and the
 * middle of each crown, which a tree going over swings, and the orange; and how near the nearest
 * crown in view comes, whose leaves the wind whips about.
 */
export type MotionProbe = {
  camera: StoryCamera;
  /** Two points for each tree in the state's order, NaN for one not there, then the orange's. */
  points: Vec3[];
  /** Metres from the eye to the near side of the nearest crown in view, or Infinity. */
  crownDepth: number;
  /** `wind.strength`. */
  wind: number;
};

const NO_POINT: Vec3 = [Number.NaN, Number.NaN, Number.NaN];

/** A frame's `MotionProbe`, for a frame of this width over height. */
export function getMotionProbe(
  state: Pick<StoryState, 'camera' | 'shake' | 'trees' | 'props' | 'wind'>,
  aspect: number
): MotionProbe {
  const camera: StoryCamera = {
    ...state.camera,
    orbit: state.camera.orbit + state.shake[0],
    pitch: state.camera.pitch + state.shake[1]
  };
  const eye = getCameraEye(camera);
  const forward = getCameraForward(camera);
  const tangent = Math.tan((camera.fovy / 2) * RADIANS_PER_DEGREE);
  const across = tangent * Math.max(aspect, 1);
  const points: Vec3[] = [];
  let crownDepth = Number.POSITIVE_INFINITY;
  for (const tree of state.trees) {
    const growth = tree.growth as number;
    if (!(growth > 0)) {
      points.push(NO_POINT, NO_POINT);
      continue;
    }
    const position = tree.position as ArrayLike<number>;
    const height = (tree.height as number) * getHeightFraction(growth);
    const crown = (tree.crownRadius as number) * getCrownFraction(growth);
    const [lean = 0, bearing = 0] = (tree.lean as number[] | undefined) ?? [];
    const tilt = lean * RADIANS_PER_DEGREE;
    const toward = bearing * RADIANS_PER_DEGREE;
    const axis: Vec3 = [
      Math.sin(tilt) * Math.sin(toward),
      Math.sin(tilt) * Math.cos(toward),
      Math.cos(tilt)
    ];
    const base: Vec3 = [position[0], position[1], tree.elevation as number];
    const along = (share: number): Vec3 => [
      base[0] + axis[0] * height * share,
      base[1] + axis[1] * height * share,
      base[2] + axis[2] * height * share
    ];
    const middle = along(0.6);
    points.push(along(1), middle);
    const offset: Vec3 = [middle[0] - eye[0], middle[1] - eye[1], middle[2] - eye[2]];
    const depth = offset[0] * forward[0] + offset[1] * forward[1] + offset[2] * forward[2];
    const away = Math.hypot(offset[0], offset[1], offset[2]);
    // Seen, near enough to matter, and in the frame, give or take its crown.
    const aside = Math.sqrt(Math.max(away * away - depth * depth, 0));
    if (depth + crown > 0 && away - crown < MOTION.reach && aside < depth * across + crown) {
      crownDepth = Math.min(crownDepth, Math.max(depth - crown, MOTION.leastDepth));
    }
  }
  const {orange} = state.props;
  points.push(
    orange.visible ? [orange.position[0], orange.position[1], orange.position[2]] : NO_POINT
  );
  return {camera, points, crownDepth, wind: state.wind.strength};
}

/** Where a point lands on the image plane, in units of the focal length, or null behind the lens. */
function getImagePoint(camera: StoryCamera, point: Vec3): [number, number] | null {
  const eye = getCameraEye(camera);
  const forward = getCameraForward(camera);
  const flat = Math.hypot(forward[0], forward[1]) || 1;
  const right: Vec3 = [forward[1] / flat, -forward[0] / flat, 0];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0]
  ];
  const d: Vec3 = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const depth = d[0] * forward[0] + d[1] * forward[1] + d[2] * forward[2];
  if (!(depth > camera.near)) return null;
  return [
    (d[0] * right[0] + d[1] * right[1] + d[2] * right[2]) / depth,
    (d[0] * up[0] + d[1] * up[1] + d[2] * up[2]) / depth
  ];
}

/**
 * Pixels the picture moves across an open shutter of `seconds`, at most, in a frame `height` pixels
 * high and `aspect` wide, from its probes at the shutter's two ends: how far the take turns, how far
 * each crown and the orange go on the image as the take and they move, and how far the leaves of the
 * nearest crown whip about in the wind. `getLensSamples` takes it, so that a storm's shake, a fast
 * tilt, a crown going over by the lens or a crown thrashing near it blur rather than smear.
 */
export function getShutterTravel(
  opened: MotionProbe,
  closed: MotionProbe,
  height: number,
  aspect: number,
  seconds: number
): number {
  const tangent = Math.tan((opened.camera.fovy / 2) * RADIANS_PER_DEGREE);
  const focal = (0.5 * height) / tangent;
  const a = getCameraForward(opened.camera);
  const b = getCameraForward(closed.camera);
  const turn = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  let travel = turn * focal;
  const count = Math.min(opened.points.length, closed.points.length);
  for (let index = 0; index < count; index++) {
    const from = getImagePoint(opened.camera, opened.points[index]);
    const to = getImagePoint(closed.camera, closed.points[index]);
    // Only what is in the frame, give or take a little, at either end.
    if (
      from &&
      to &&
      Math.abs(from[0]) < tangent * aspect * 1.2 &&
      Math.abs(from[1]) < tangent * 1.2
    ) {
      travel = Math.max(travel, Math.hypot(to[0] - from[0], to[1] - from[1]) * focal);
    }
  }
  const depth = Math.min(opened.crownDepth, closed.crownDepth);
  const wind = Math.max(opened.wind, closed.wind);
  if (wind > 0 && Number.isFinite(depth)) {
    const leaves = MOTION.leafSpeed * wind ** MOTION.leafPower * seconds;
    travel = Math.max(travel, (leaves / depth) * focal);
  }
  return travel;
}

/**
 * What a `View` takes as `padding` to shift the whole image plane by this many device pixels, at
 * every depth alike, unlike moving the target. Viewports measure in CSS pixels.
 */
export function getPixelPadding(
  pixel: readonly [number, number],
  devicePixelRatio: number
): {left: number; right: number; top: number; bottom: number} {
  // deck moves the center by half of what padding asks for.
  const x = (2 * pixel[0]) / devicePixelRatio;
  const y = (2 * pixel[1]) / devicePixelRatio;
  return {
    left: Math.max(x, 0),
    right: Math.max(-x, 0),
    top: Math.max(y, 0),
    bottom: Math.max(-y, 0)
  };
}

/** A unit vector moved by a point of the unit disc, `degrees` at its rim. */
export function getJitteredDirection(
  direction: Vec3,
  point: readonly [number, number],
  degrees: number
): Vec3 {
  if (degrees <= 0 || (point[0] === 0 && point[1] === 0)) return direction;
  const [x, y, z] = direction;
  // Any two directions across this one.
  const across: Vec3 = Math.abs(z) < 0.9 ? [y, -x, 0] : [0, z, -y];
  const acrossLength = Math.hypot(across[0], across[1], across[2]);
  const u: Vec3 = [across[0] / acrossLength, across[1] / acrossLength, across[2] / acrossLength];
  const v: Vec3 = [y * u[2] - z * u[1], z * u[0] - x * u[2], x * u[1] - y * u[0]];
  const reach = Math.tan(degrees * RADIANS_PER_DEGREE);
  const moved: Vec3 = [
    x + reach * (point[0] * u[0] + point[1] * v[0]),
    y + reach * (point[0] * u[1] + point[1] * v[1]),
    z + reach * (point[0] * u[2] + point[1] * v[2])
  ];
  const length = Math.hypot(moved[0], moved[1], moved[2]);
  return [moved[0] / length, moved[1] / length, moved[2] / length];
}

const FULL_SCREEN_VS = /* glsl */ `#version 300 es
out vec2 uv;
void main() {
  vec2 position = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  uv = 0.5 * position + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Display light back to scene light: gamma, then the inverse of the filmic curve at the end of
 * `TREE_PHOTOREAL_FRAGMENT_CHUNK`, and of what `finish` puts back.
 */
const SCENE_LIGHT_GLSL = /* glsl */ `
vec3 toSceneLight(vec3 display) {
  // A float target can hold what an 8-bit canvas never would: NaN, and more than 1 from additive
  // blends.
  display = mix(display, vec3(0.0), vec3(isnan(display)));
  vec3 y = pow(clamp(display, 0.0, 1.0), vec3(2.2));
  // y (2.43 x^2 + 0.59 x + 0.14) = 2.51 x^2 + 0.03 x, by whichever form of the root keeps its
  // digits.
  vec3 a = 2.51 - 2.43 * y;
  vec3 b = 0.03 - 0.59 * y;
  vec3 c = -0.14 * y;
  vec3 root = sqrt(b * b - 4.0 * a * c);
  vec3 forSmall = -2.0 * c / max(b + root, 1e-9);
  return mix((root - b) / (2.0 * a), forSmall, vec3(greaterThan(b, vec3(0.0))));
}
`;

const ADD_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D source;
out vec4 fragColor;
${SCENE_LIGHT_GLSL}
void main() {
  fragColor = vec4(toSceneLight(texelFetch(source, ivec2(gl_FragCoord.xy), 0).rgb), 1.0);
}
`;

/**
 * The bright part of a frame at half size, from the sum, which only `texelFetch` is sure to read.
 */
const BLOOM_BRIGHT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D source;
uniform float sumScale;
uniform float threshold;
uniform float knee;
out vec4 fragColor;
void main() {
  ivec2 pixel = 2 * ivec2(gl_FragCoord.xy);
  vec3 color =
    texelFetch(source, pixel, 0).rgb +
    texelFetch(source, pixel + ivec2(1, 0), 0).rgb +
    texelFetch(source, pixel + ivec2(0, 1), 0).rgb +
    texelFetch(source, pixel + ivec2(1, 1), 0).rgb;
  color *= 0.25 * sumScale;
  float bright = max(color.r, max(color.g, color.b));
  float soft = clamp(bright - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  fragColor = vec4(color * max(soft, bright - threshold) / max(bright, 1e-4), 1.0);
}
`;

/** Dual filter down: a pixel at twice the area, from five taps. */
const BLOOM_DOWN_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 texel;
in vec2 uv;
out vec4 fragColor;
void main() {
  vec3 color = 4.0 * texture(source, uv).rgb;
  color += texture(source, uv - texel).rgb;
  color += texture(source, uv + texel).rgb;
  color += texture(source, uv + vec2(texel.x, -texel.y)).rgb;
  color += texture(source, uv + vec2(-texel.x, texel.y)).rgb;
  fragColor = vec4(color / 8.0, 1.0);
}
`;

/** Dual filter up: a tent of eight taps, added to the level below by blending. */
const BLOOM_UP_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D source;
uniform vec2 texel;
uniform float strength;
in vec2 uv;
out vec4 fragColor;
void main() {
  vec3 color = texture(source, uv + vec2(-2.0 * texel.x, 0.0)).rgb;
  color += 2.0 * texture(source, uv + vec2(-texel.x, texel.y)).rgb;
  color += texture(source, uv + vec2(0.0, 2.0 * texel.y)).rgb;
  color += 2.0 * texture(source, uv + texel).rgb;
  color += texture(source, uv + vec2(2.0 * texel.x, 0.0)).rgb;
  color += 2.0 * texture(source, uv + vec2(texel.x, -texel.y)).rgb;
  color += texture(source, uv + vec2(0.0, -2.0 * texel.y)).rgb;
  color += 2.0 * texture(source, uv - texel).rgb;
  fragColor = vec4(strength * color / 12.0, 1.0);
}
`;

const FINISH_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D sum;
uniform sampler2D bloom;
uniform float sumScale;
uniform float bloomAmount;
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform vec3 balance;
uniform float vignette;
uniform float grain;
uniform float grainFloor;
uniform float grainScale;
uniform float grainColor;
uniform float fade;
uniform float fadeExposure;
uniform vec2 frameSize;
uniform uint seed;
in vec2 uv;
out vec4 fragColor;

// Narkowicz's fit to the ACES curve, as treeFilmic has it.
vec3 toDisplay(vec3 x) {
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(mapped, vec3(1.0 / 2.2));
}

// Mark Jarzynski and Marc Olano's PCG, three values from three.
uvec3 hashPcg(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z;
  v.y += v.z * v.x;
  v.z += v.x * v.y;
  return v;
}

vec3 getHash(ivec2 cell, uint salt) {
  return vec3(hashPcg(uvec3(uvec2(cell), seed + salt))) / 4294967295.0;
}

// Two uniform values make a triangle around 0, which is close enough to how grain falls, and the
// cells of a lattice turned against the pixels soften it, so it clumps a little as real grain does.
vec3 getGrain(vec2 position) {
  const mat2 turn = mat2(0.8660254, 0.5, -0.5, 0.8660254);
  vec2 turned = turn * position / grainScale;
  vec2 base = floor(turned);
  vec2 f = turned - base;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 cell = ivec2(base);
  vec3 near = mix(getHash(cell, 0u), getHash(cell + ivec2(1, 0), 0u), f.x);
  vec3 far = mix(getHash(cell + ivec2(0, 1), 0u), getHash(cell + ivec2(1, 1), 0u), f.x);
  return 2.0 * (mix(near, far, f.y) - 0.5);
}

void main() {
  vec3 color = sumScale * texelFetch(sum, ivec2(gl_FragCoord.xy), 0).rgb;
  if (bloomAmount > 0.0) color += bloomAmount * texture(bloom, uv).rgb;

  // In scene light, as a lens and a sensor have it.
  color *= exposure * balance * fadeExposure;
  if (vignette > 0.0) {
    vec2 centered = (uv - 0.5) * frameSize / length(frameSize) * 2.0;
    float reach = dot(centered, centered);
    color *= 1.0 - vignette * reach * (0.45 + 0.55 * reach);
  }
  if (saturation != 1.0) {
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = max(mix(vec3(luma), color, saturation), 0.0);
  }

  // A slight S on the display values, whose slope at the middle is contrast and whose ends stay
  // put.
  vec3 display = toDisplay(color);
  if (contrast != 1.0) {
    vec3 curve = display * display * (3.0 - 2.0 * display);
    display = clamp(display + 2.0 * (contrast - 1.0) * (curve - display), 0.0, 1.0);
  }

  if (grain > 0.0 && fade > 0.0) {
    vec3 noise = getGrain(gl_FragCoord.xy);
    vec3 mono = vec3((noise.r + noise.g + noise.b) / 3.0);
    vec3 spread = mono + grainColor * (noise - mono);
    float luma = dot(display, vec3(0.2126, 0.7152, 0.0722));
    float response = mix(grainFloor, 1.0, 4.0 * luma * (1.0 - luma));
    display += grain * fade * response * spread;
  }

  // Under half a step of 8 bits, so it hides the steps of a slow gradient and leaves exact values
  // alone.
  vec3 dither = getHash(ivec2(gl_FragCoord.xy), 7u) - 0.5;
  fragColor = vec4(display + 0.98 * dither / 255.0, 1.0);
}
`;

type Pass = {program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null>};

type TargetTexture = {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
};

/** How `finish` was asked to end a frame. */
export type FinishOptions = {
  grade: StoryGrade;
  /** Stable for a frame, different from one frame to the next: the grain's seed. */
  seed: number;
};

/**
 * Sub-frame accumulation and finishing, in deck's own WebGL2 context. It takes the same frame from
 * either of two places: `getTarget` is a float framebuffer for deck to draw into, which is what
 * many samples use, as a target has no MSAA to resolve and no 8-bit steps, and `addCanvas` copies
 * the drawing buffer, with MSAA or without, which is what a single-sample preview uses. `finish`
 * writes the drawing buffer, so what is on screen is always a finished frame.
 *
 * Calling it never disturbs deck. All GL state that luma tracks goes back through
 * `device.pushState` and `popState`, and luma binds its own textures, buffers and vertex arrays for
 * each draw.
 */
export class Accumulator {
  private device: WebGLDevice;
  private gl: WebGL2RenderingContext;
  private vertexArray: WebGLVertexArrayObject;
  private passes: Record<'add' | 'bright' | 'down' | 'up' | 'finish', Pass>;
  private sumFormat: number;
  private width = 0;
  private height = 0;
  private sum: TargetTexture | null = null;
  private canvasCopy: WebGLTexture | null = null;
  private target: Framebuffer | null = null;
  private targetColor: Texture | null = null;
  private bloomLevels: TargetTexture[] = [];
  private added = 0;

  constructor(device: WebGLDevice) {
    this.device = device;
    this.gl = device.gl;
    const {gl} = this;
    // RGBA16F has too few bits left to add 32 samples of different size without drift.
    gl.getExtension('EXT_color_buffer_float');
    this.sumFormat = gl.getExtension('EXT_float_blend') ? gl.RGBA32F : gl.RGBA16F;
    this.vertexArray = gl.createVertexArray() as WebGLVertexArrayObject;
    device.pushState();
    this.passes = {
      add: this.createPass(ADD_FS),
      bright: this.createPass(BLOOM_BRIGHT_FS),
      down: this.createPass(BLOOM_DOWN_FS),
      up: this.createPass(BLOOM_UP_FS),
      finish: this.createPass(FINISH_FS)
    };
    device.popState();
  }

  /** What is being used, for a tool to report. */
  getInfo(): {sum: string; added: number} {
    return {sum: this.sumFormat === this.gl.RGBA32F ? 'rgba32f' : 'rgba16f', added: this.added};
  }

  /** Starts a frame of this size in device pixels, with nothing added yet. */
  begin(width: number, height: number): void {
    const {gl} = this;
    this.setSize(width, height);
    this.device.pushState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, (this.sum as TargetTexture).framebuffer);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    this.device.popState();
    this.added = 0;
  }

  /** The framebuffer to draw a sub-frame into, for `addTarget`. */
  getTarget(): Framebuffer {
    if (!this.target) {
      const {width, height} = this;
      this.targetColor = this.device.createTexture({
        id: 'film-sub-frame-color',
        format: 'rgba16float',
        width,
        height,
        sampler: {minFilter: 'nearest', magFilter: 'nearest'}
      });
      this.target = this.device.createFramebuffer({
        id: 'film-sub-frame',
        width,
        height,
        colorAttachments: [this.targetColor],
        depthStencilAttachment: 'depth24plus'
      });
    }
    return this.target;
  }

  /** Adds what deck drew into `getTarget`. */
  addTarget(): void {
    this.getTarget();
    this.add((this.targetColor as unknown as {handle: WebGLTexture}).handle);
  }

  /** Adds what is in the drawing buffer, which a frame of the canvas's own MSAA has resolved to. */
  addCanvas(): void {
    const {gl} = this;
    this.device.pushState();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.canvasCopy);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.device.popState();
    this.add(this.canvasCopy as WebGLTexture);
  }

  /** Bloom and grade over what was added, into the drawing buffer. */
  finish({grade, seed}: FinishOptions): void {
    const {device} = this;
    device.pushState();
    this.setDrawState();
    const sumScale = 1 / Math.max(this.added, 1);
    // Each level holds what the coarser ones added to it, so a wide field of light sums to all of
    // them.
    const levelSum = (1 - FINISH.bloomSpread ** FINISH.bloomLevels) / (1 - FINISH.bloomSpread);
    const bloomAmount = (grade.bloom * FINISH.bloomStrength) / levelSum;
    if (bloomAmount > 0) this.drawBloom(sumScale);
    this.drawFinish(grade, seed, sumScale, bloomAmount);
    this.setSource(1, null);
    this.setSource(0, null);
    device.popState();
  }

  /** Frees everything. */
  destroy(): void {
    const {gl} = this;
    this.setSize(0, 0);
    gl.deleteVertexArray(this.vertexArray);
    for (const {program} of Object.values(this.passes)) gl.deleteProgram(program);
  }

  private add(source: WebGLTexture): void {
    const {gl} = this;
    const {add} = this.passes;
    this.device.pushState();
    this.setDrawState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, (this.sum as TargetTexture).framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(add.program);
    this.setSource(0, source);
    gl.uniform1i(this.getUniform(add, 'source'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.setSource(0, null);
    this.device.popState();
    this.added++;
  }

  private drawBloom(sumScale: number): void {
    const {gl, bloomLevels} = this;
    const {bright, down, up} = this.passes;
    const sum = this.sum as TargetTexture;
    gl.disable(gl.BLEND);
    gl.useProgram(bright.program);
    this.setTarget(bloomLevels[0]);
    this.setSource(0, sum.texture);
    gl.uniform1i(this.getUniform(bright, 'source'), 0);
    gl.uniform1f(this.getUniform(bright, 'sumScale'), sumScale);
    gl.uniform1f(this.getUniform(bright, 'threshold'), FINISH.bloomThreshold);
    gl.uniform1f(this.getUniform(bright, 'knee'), FINISH.bloomKnee);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(down.program);
    gl.uniform1i(this.getUniform(down, 'source'), 0);
    for (let level = 1; level < bloomLevels.length; level++) {
      const from = bloomLevels[level - 1];
      this.setTarget(bloomLevels[level]);
      this.setSource(0, from.texture);
      gl.uniform2f(this.getUniform(down, 'texel'), 0.5 / from.width, 0.5 / from.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(up.program);
    gl.uniform1i(this.getUniform(up, 'source'), 0);
    gl.uniform1f(this.getUniform(up, 'strength'), FINISH.bloomSpread);
    for (let level = bloomLevels.length - 2; level >= 0; level--) {
      const from = bloomLevels[level + 1];
      this.setTarget(bloomLevels[level]);
      this.setSource(0, from.texture);
      gl.uniform2f(this.getUniform(up, 'texel'), 0.5 / from.width, 0.5 / from.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);
  }

  private drawFinish(grade: StoryGrade, seed: number, sumScale: number, bloomAmount: number): void {
    const {gl, width, height} = this;
    const {finish} = this.passes;
    const sum = this.sum as TargetTexture;
    const set1f = (name: string, value: number) =>
      gl.uniform1f(this.getUniform(finish, name), value);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.BLEND);
    gl.useProgram(finish.program);
    this.setSource(0, sum.texture);
    this.setSource(1, this.bloomLevels[0].texture);
    gl.uniform1i(this.getUniform(finish, 'sum'), 0);
    gl.uniform1i(this.getUniform(finish, 'bloom'), 1);
    set1f('sumScale', sumScale);
    set1f('bloomAmount', bloomAmount);
    set1f('exposure', 2 ** grade.exposure);
    set1f('contrast', grade.contrast);
    set1f('saturation', grade.saturation);
    const warmth = grade.warmth * FINISH.warmth;
    gl.uniform3f(this.getUniform(finish, 'balance'), 1 + warmth, 1, 1 - warmth);
    set1f('vignette', grade.vignette);
    set1f('grain', grade.grain * FINISH.grain);
    set1f('grainFloor', FINISH.grainFloor);
    set1f('grainScale', (FINISH.grainSize * height) / 1080);
    set1f('grainColor', FINISH.grainColor);
    set1f('fade', grade.fade);
    set1f('fadeExposure', grade.fade ** FINISH.fadePower);
    gl.uniform2f(this.getUniform(finish, 'frameSize'), width, height);
    gl.uniform1ui(this.getUniform(finish, 'seed'), seed >>> 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** What every pass of ours has in common, inside a `pushState`. */
  private setDrawState(): void {
    const {gl} = this;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    gl.disable(gl.SAMPLE_COVERAGE);
    gl.colorMask(true, true, true, true);
    gl.depthMask(false);
    gl.bindVertexArray(this.vertexArray);
  }

  private setTarget({framebuffer, width, height}: TargetTexture): void {
    const {gl} = this;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, width, height);
  }

  private setSource(unit: number, texture: WebGLTexture | null): void {
    const {gl} = this;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  private getUniform(pass: Pass, name: string): WebGLUniformLocation | null {
    let location = pass.uniforms.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(pass.program, name);
      pass.uniforms.set(name, location);
    }
    return location;
  }

  private setSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    const {gl} = this;
    this.width = width;
    this.height = height;
    if (this.sum) this.deleteTargetTexture(this.sum);
    for (const level of this.bloomLevels) this.deleteTargetTexture(level);
    if (this.canvasCopy) gl.deleteTexture(this.canvasCopy);
    this.target?.destroy();
    this.targetColor?.destroy();
    this.target = null;
    this.targetColor = null;
    this.sum = null;
    this.canvasCopy = null;
    this.bloomLevels = [];
    if (width <= 0 || height <= 0) return;
    this.device.pushState();
    gl.activeTexture(gl.TEXTURE0);
    this.sum = this.createTargetTexture(this.sumFormat, width, height, gl.NEAREST);
    this.canvasCopy = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, this.canvasCopy);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    for (let level = 1; level <= FINISH.bloomLevels; level++) {
      this.bloomLevels.push(
        this.createTargetTexture(
          gl.RGBA16F,
          Math.max(width >> level, 1),
          Math.max(height >> level, 1),
          gl.LINEAR
        )
      );
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.device.popState();
  }

  private createTargetTexture(
    format: number,
    width: number,
    height: number,
    filter: number
  ): TargetTexture {
    const {gl} = this;
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Accumulator: framebuffer incomplete, 0x${status.toString(16)}`);
    }
    return {texture, framebuffer, width, height};
  }

  private deleteTargetTexture({texture, framebuffer}: TargetTexture): void {
    this.gl.deleteFramebuffer(framebuffer);
    this.gl.deleteTexture(texture);
  }

  private createPass(fragmentSource: string): Pass {
    const {gl} = this;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Accumulator: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram() as WebGLProgram;
    const vertexShader = compile(gl.VERTEX_SHADER, FULL_SCREEN_VS);
    const fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Accumulator: ${gl.getProgramInfoLog(program)}`);
    }
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return {program, uniforms: new Map()};
  }
}
