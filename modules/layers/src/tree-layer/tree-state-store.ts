// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  TREE_STATE_ROWS_PER_LINE,
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW,
  TREE_STATE_TEXTURE_WIDTH
} from './tree-photoreal-layout';

/** The accessor names `transitions` can key settings by. */
export type TreeTransitionKey =
  | 'getTree'
  | 'getGrowth'
  | 'getHealth'
  | 'getFoliage'
  | 'getFlush'
  | 'getLean'
  | 'getDamage'
  | 'getDecay'
  | 'getPosition'
  | 'getElevation'
  | 'getHeight'
  | 'getCanopyRadius'
  | 'getTrunkRadius'
  | 'getTrunkHeightFraction'
  | 'getCanopyColor'
  | 'getSeason'
  | 'getTrunkColor'
  | 'getCrop';

/**
 * Transition lifecycle callback. Tweens are per tree, so unlike deck.gl's per-attribute callbacks
 * this one fires once per tree and field group, and receives which ones. A callback written for
 * deck.gl, which takes no arguments, works unchanged.
 */
export type TreeTransitionCallback = (row: number, key: TreeTransitionKey) => void;

/**
 * Gives the value a newly added row starts from. `toValue` holds the row's target for the field
 * group, in the units listed on {@link TreeStateStore}. A shorter result, or a non-finite entry,
 * leaves that channel at its target. A single number fills every channel.
 */
export type TreeTransitionEnter = (toValue: number[]) => ArrayLike<number> | number;

type TreeTransitionSettingsBase = {
  /** Start value of a row added with `isNew`. Without it a new row jumps to its target. */
  enter?: TreeTransitionEnter;
  /** Called when a tween starts, including when it restarts after a retarget. */
  onStart?: TreeTransitionCallback;
  /** Called when a tween reaches its target. */
  onEnd?: TreeTransitionCallback;
  /** Called when a tween is retargeted or removed before reaching its target. */
  onInterrupt?: TreeTransitionCallback;
};

/** deck.gl's interpolation settings. */
export type TreeInterpolationSettings = TreeTransitionSettingsBase & {
  type?: 'interpolation';
  /** Milliseconds. Zero, negative or non-finite durations jump. */
  duration: number;
  /** Maps elapsed fraction 0-1 to blend fraction. May overshoot. @default linear */
  easing?: (t: number) => number;
};

/**
 * deck.gl's per-frame spring, `next = cur + velocity + (dest - cur) * stiffness - velocity * damping`,
 * stepped at 1/60 s of elapsed time so it does not depend on the frame rate.
 */
export type TreeSpringSettings = TreeTransitionSettingsBase & {
  type: 'spring';
  /** Tension. @default 0.05 */
  stiffness?: number;
  /** Friction. @default 0.5 */
  damping?: number;
};

/** A duration in milliseconds, or settings in deck.gl's shapes. */
export type TreeTransitionSettings = number | TreeInterpolationSettings | TreeSpringSettings;

/**
 * The `transitions` prop. A key that is absent falls back to `getTree`. A key that is present but
 * falsy, such as `getDamage: 0`, makes that group jump even when `getTree` has settings.
 */
export type TreeTransitions = {
  [key in TreeTransitionKey]?: TreeTransitionSettings | null | false;
};

/** Current values of one crop slot. */
export type TreeStateCropValues = {
  /** Attached crops. Fractional while animating. @default 0 */
  count: number;
  /** Metres. @default 0 */
  radius: number;
  /** 0-1. @default 1 */
  ripeness: number;
  /** 0-1. @default 0 */
  fallen: number;
  /** Ripe tint, sRGB 0-255 RGBA. @default [255, 255, 255, 255] */
  color: number[];
  /** Unripe tint, sRGB 0-255 RGB. A fourth entry is accepted and ignored. @default [86, 128, 44] */
  unripeColor: number[];
  /** Crops supplied as already on the ground. Fractional while animating. @default 0 */
  dropped: number;
};

/** Resolved values of one tree. Lean and colors use the units of `TreeSpec`, and yaw is radians. */
export type TreeStateValues = {
  /**
   * Tree base, x, y and z in layer coordinates, at full double precision. The store splits it into
   * the high and low parts of the state row. @default [0, 0, 0]
   */
  position: number[];
  /**
   * Low part of a position that a caller has already split; the full position is the sum. Reads
   * leave this unset, since `position` is complete.
   */
  positionLow?: number[];
  /** Radians. @default 0 */
  yaw: number;
  /** Radians. @default 0 */
  windPhase: number;
  /** Metres. @default 3 */
  crownX: number;
  /** Metres. @default 3 */
  crownY: number;
  /** Metres. @default 10 */
  height: number;
  /** Metres. @default 3.5 */
  trunkHeight: number;
  /** 0-1. @default 1 */
  growth: number;
  /** 0-1. @default 1 */
  health: number;
  /** 0-1. @default 1 */
  foliage: number;
  /** 0-1. @default 0 */
  flush: number;
  /** 0-90 degrees. @default 0 */
  leanDegrees: number;
  /** Degrees clockwise from +y. Reads are normalized to 0-360. @default 0 */
  leanBearing: number;
  /** 0-1. @default 0 */
  damage: number;
  /** 0-1. @default 0 */
  decay: number;
  /** sRGB 0-255 RGBA. @default [255, 255, 255, 255] */
  canopyColor: number[];
  /** sRGB 0-255 RGBA. @default [255, 255, 255, 255] */
  trunkColor: number[];
  /** Metres. @default 0.5 */
  trunkRadius: number;
  /** Non-negative multiplier. @default 1 */
  windFlex: number;
  /** 0-1. @default 1 */
  coverage: number;
  /** Non-negative multiplier. @default 1 */
  leafScale: number;
  /** 0-1. @default 1 */
  leafDetail: number;
  /** 0-1. @default 0 */
  seed: number;
  /** Up to two slots. Reads always return both, with `count` 0 for an empty slot. */
  crops: TreeStateCropValues[];
};

/** A crop slot passed to `setRow`. Absent or non-finite fields keep their previous value. */
export type TreeStateCropUpdate = {
  [key in 'count' | 'radius' | 'ripeness' | 'fallen' | 'dropped']?: number;
} & {
  color?: ArrayLike<number> | null;
  unripeColor?: ArrayLike<number> | null;
};

/**
 * Values passed to `setRow`. Every field is optional: an absent or non-finite value keeps its
 * previous target, or its documented default on a new row. In `crops`, a missing or null slot means
 * no crop: its `count` goes to 0 and its other fields hold, and `crops: null` does that for both.
 * Leaving `crops` out keeps both slots. A null color keeps the previous color, and a
 * three-component color is opaque.
 */
export type TreeStateUpdate = {
  [key in Exclude<
    keyof TreeStateValues,
    'position' | 'positionLow' | 'canopyColor' | 'trunkColor' | 'crops'
  >]?: number;
} & {
  position?: ArrayLike<number> | null;
  positionLow?: ArrayLike<number> | null;
  canopyColor?: ArrayLike<number> | null;
  trunkColor?: ArrayLike<number> | null;
  crops?: readonly (TreeStateCropUpdate | null | undefined)[] | null;
};

/** Timing of a `setRow` call. */
export type TreeStateRowOptions = {
  /** Timeline time in milliseconds. Tweens start at this time. */
  now: number;
  /** Layer clock in seconds: `windTime` when numeric, else the timeline. Loss rates use this. */
  clock: number;
  /** The row now holds a newly added tree. Only such a row runs `enter`. @default false */
  isNew?: boolean;
};

/** Result of `tick`. These objects are shared and frozen, so they are safe to keep. */
export type TreeStateTickResult = Readonly<{
  /** Row data changed since the previous tick, by this tick or by `setRow`. */
  changed: boolean;
  /** Tweens are running or loss rates have not reached 0: keep ticking. */
  active: boolean;
}>;

type ResolvedTreeTransition = {
  /** The settings this came from, so an equal object in the next render can be recognized. */
  readonly source: TreeTransitionSettings;
  readonly spring: boolean;
  readonly duration: number;
  readonly easing: ((t: number) => number) | null;
  readonly stiffness: number;
  readonly damping: number;
  readonly enter: TreeTransitionEnter | null;
  readonly onStart: TreeTransitionCallback | null;
  readonly onEnd: TreeTransitionCallback | null;
  readonly onInterrupt: TreeTransitionCallback | null;
};

const FLOATS_PER_TEXEL = 4;
const FLOATS_PER_ROW = TREE_STATE_TEXELS_PER_ROW * FLOATS_PER_TEXEL;
const FLOATS_PER_LINE = TREE_STATE_TEXTURE_WIDTH * FLOATS_PER_TEXEL;

/**
 * Marks a value not given, in the typed array that raw values pass through. A double stored there
 * stays unboxed, where a double passed to a function V8 does not inline allocates. Doing that once
 * per field of every row is what would otherwise make garbage on each frame of animated data.
 */
const NOT_SET = Number.NaN;

const DEFAULT_SPRING_STIFFNESS = 0.05;
const DEFAULT_SPRING_DAMPING = 0.5;
/** Springs step at this period, in milliseconds. */
const SPRING_STEP_MS = 1000 / 60;
/** Absorbs rounding, so an elapsed time of exactly n steps counts as n and not n - 1. */
const SPRING_STEP_ROUNDING = 1e-9;
/** A tick that skips more than a minute of spring steps ends the spring instead of simulating it. */
const MAX_SPRING_STEPS_PER_TICK = 3600;
/** deck.gl's settling threshold on both distance and per-step velocity. */
const SPRING_EPSILON = 1e-5;
/** 1e-5 of a degree of longitude is a metre, which would be a visible snap on a settled tree. */
const SPRING_POSITION_EPSILON = 1e-9;

/** A larger clock step than this, in seconds, says nothing about how fast a value is falling. */
const MAX_RATE_CLOCK_STEP = 0.25;
/**
 * Frames in the loss rate's moving secant. It reaches the true rate of a steady fall at once, and
 * exactly 0 this many frames after the value stops. Four frames also keep a value that updates
 * every second or fourth frame from flickering between 0 and a multiple of its rate.
 */
const RATE_WINDOW_FRAMES = 4;
const RATE_SAMPLES = RATE_WINDOW_FRAMES + 1;

/** Below this, in degrees, a tree is upright and its bearing cannot be seen. */
const LEAN_UPRIGHT_DEGREES = 1e-3;
/** Bearings closer than this, in degrees, are the same target. */
const SAME_BEARING_DEGREES = 1e-9;
/** At or below this count, a crop slot has nothing on the tree. */
const EMPTY_CROP_COUNT = 1e-6;

// The row is a vector of channels in caller units, so a tween is plain arithmetic and a read returns
// exactly what was written. Channels of one group are contiguous. Trailing channels have no group.
const CHANNEL_X = 0;
const CHANNEL_Z = 2;
const CHANNEL_CROWN_X = 3;
const CHANNEL_CROWN_Y = 4;
const CHANNEL_HEIGHT = 5;
const CHANNEL_LEAF_SCALE = 6;
const CHANNEL_TRUNK_HEIGHT = 7;
const CHANNEL_TRUNK_RADIUS = 8;
const CHANNEL_GROWTH = 9;
const CHANNEL_HEALTH = 10;
const CHANNEL_FOLIAGE = 11;
const CHANNEL_FLUSH = 12;
const CHANNEL_LEAN_DEGREES = 13;
const CHANNEL_LEAN_BEARING = 14;
const CHANNEL_DAMAGE = 15;
const CHANNEL_DECAY = 16;
const CHANNEL_CANOPY = 17;
const CHANNEL_BARK = 21;
const CHANNEL_WIND_FLEX = 25;
const CHANNEL_CROP0 = 26;
const CHANNEL_CROP1 = 38;
const CHANNEL_YAW = 50;
const CHANNEL_WIND_PHASE = 51;
const CHANNEL_COVERAGE = 52;
const CHANNEL_LEAF_DETAIL = 53;
const CHANNEL_SEED = 54;
const CHANNEL_COUNT = 55;

// Channel offsets inside a crop slot.
const CROP_COUNT = 0;
const CROP_RADIUS = 1;
const CROP_RIPENESS = 2;
const CROP_FALLEN = 3;
const CROP_COLOR = 4;
const CROP_UNRIPE = 8;
const CROP_DROPPED = 11;
const CROP_CHANNELS = 12;

// How a channel encodes into the state row, other than by CHANNEL_SCALE.
const KIND_POSITION = 1;
const KIND_BEARING = 2;

const CHANNEL_OFFSET = new Uint8Array(CHANNEL_COUNT);
const CHANNEL_KIND = new Uint8Array(CHANNEL_COUNT);
const CHANNEL_SCALE = new Float64Array(CHANNEL_COUNT).fill(1);
const CHANNEL_MIN = new Float64Array(CHANNEL_COUNT).fill(-Infinity);
const CHANNEL_MAX = new Float64Array(CHANNEL_COUNT).fill(Infinity);
/** Index into the RATE_ tables of a channel that has a loss rate, else -1. */
const CHANNEL_RATE = new Int8Array(CHANNEL_COUNT).fill(-1);
const DEFAULT_TARGETS = new Float64Array(CHANNEL_COUNT);
const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_UNRIPE_COLOR = [86, 128, 44] as const;

function defineChannel(
  channel: number,
  texel: number,
  component: number,
  fallback: number,
  min = -Infinity,
  max = Infinity,
  scale = 1
): void {
  CHANNEL_OFFSET[channel] = texel * FLOATS_PER_TEXEL + component;
  DEFAULT_TARGETS[channel] = fallback;
  CHANNEL_MIN[channel] = min;
  CHANNEL_MAX[channel] = max;
  CHANNEL_SCALE[channel] = scale;
}

function defineColor(channel: number, texel: number, fallback: readonly number[]): void {
  for (let i = 0; i < fallback.length; i++)
    defineChannel(channel + i, texel, i, fallback[i], 0, 255, 1 / 255);
}

const {ANCHOR, ANCHOR_LOW, SIZE, LIFE, POSE, CANOPY, TRUNK, MISC, DETAIL} = TREE_STATE_TEXEL;
for (let axis = 0; axis < 3; axis++) {
  defineChannel(CHANNEL_X + axis, ANCHOR, axis, 0);
  CHANNEL_KIND[CHANNEL_X + axis] = KIND_POSITION;
}
const POSITION_LOW_OFFSET = (ANCHOR_LOW - ANCHOR) * FLOATS_PER_TEXEL;
defineChannel(CHANNEL_YAW, ANCHOR, 3, 0);
defineChannel(CHANNEL_WIND_PHASE, ANCHOR_LOW, 3, 0);
defineChannel(CHANNEL_CROWN_X, SIZE, 0, 3, 0);
defineChannel(CHANNEL_CROWN_Y, SIZE, 1, 3, 0);
defineChannel(CHANNEL_HEIGHT, SIZE, 2, 10, 0);
defineChannel(CHANNEL_TRUNK_HEIGHT, SIZE, 3, 3.5, 0);
defineChannel(CHANNEL_GROWTH, LIFE, 0, 1, 0, 1);
defineChannel(CHANNEL_HEALTH, LIFE, 1, 1, 0, 1);
defineChannel(CHANNEL_FOLIAGE, LIFE, 2, 1, 0, 1);
defineChannel(CHANNEL_FLUSH, LIFE, 3, 0, 0, 1);
defineChannel(CHANNEL_LEAN_DEGREES, POSE, 0, 0, 0, 90, DEGREES_TO_RADIANS);
defineChannel(CHANNEL_LEAN_BEARING, POSE, 1, 0);
CHANNEL_KIND[CHANNEL_LEAN_BEARING] = KIND_BEARING;
defineChannel(CHANNEL_DAMAGE, POSE, 2, 0, 0, 1);
defineChannel(CHANNEL_DECAY, POSE, 3, 0, 0, 1);
defineColor(CHANNEL_CANOPY, CANOPY, [255, 255, 255, 255]);
defineColor(CHANNEL_BARK, TRUNK, [255, 255, 255, 255]);
defineChannel(CHANNEL_TRUNK_RADIUS, MISC, 0, 0.5, 0);
defineChannel(CHANNEL_WIND_FLEX, MISC, 1, 1, 0);
defineChannel(CHANNEL_COVERAGE, MISC, 2, 1, 0, 1);
defineChannel(CHANNEL_LEAF_SCALE, MISC, 3, 1, 0);
defineChannel(CHANNEL_LEAF_DETAIL, DETAIL, 0, 1, 0, 1);
defineChannel(CHANNEL_SEED, DETAIL, 1, 0, 0, 1);

const CROP_TEXELS = [
  [
    CHANNEL_CROP0,
    TREE_STATE_TEXEL.CROP0,
    TREE_STATE_TEXEL.CROP0_COLOR,
    TREE_STATE_TEXEL.CROP0_UNRIPE,
    0
  ],
  [
    CHANNEL_CROP1,
    TREE_STATE_TEXEL.CROP1,
    TREE_STATE_TEXEL.CROP1_COLOR,
    TREE_STATE_TEXEL.CROP1_UNRIPE,
    1
  ]
] as const;
for (const [channel, state, color, unripe, dropped] of CROP_TEXELS) {
  defineChannel(channel + CROP_COUNT, state, 0, 0, 0);
  defineChannel(channel + CROP_RADIUS, state, 1, 0, 0);
  defineChannel(channel + CROP_RIPENESS, state, 2, 1, 0, 1);
  defineChannel(channel + CROP_FALLEN, state, 3, 0, 0, 1);
  defineColor(channel + CROP_COLOR, color, [255, 255, 255, 255]);
  defineColor(channel + CROP_UNRIPE, unripe, DEFAULT_UNRIPE_COLOR);
  defineChannel(channel + CROP_DROPPED, TREE_STATE_TEXEL.CROP_DROPPED, dropped, 0, 0);
}

// foliage, damage and each crop's fallen store a loss rate per second. Things fall when foliage falls,
// but when damage and fallen rise. Those two measure either way, so that a value going back down replays
// its flights in reverse, as scrubbing does.
const RATE_KINDS = 4;
const RATE_FOLIAGE = 0;
const RATE_CHANNELS = [
  CHANNEL_FOLIAGE,
  CHANNEL_DAMAGE,
  CHANNEL_CROP0 + CROP_FALLEN,
  CHANNEL_CROP1 + CROP_FALLEN
] as const;
const RATE_OFFSETS = [
  DETAIL * FLOATS_PER_TEXEL + 2,
  DETAIL * FLOATS_PER_TEXEL + 3,
  TREE_STATE_TEXEL.CROP0_UNRIPE * FLOATS_PER_TEXEL + 3,
  TREE_STATE_TEXEL.CROP1_UNRIPE * FLOATS_PER_TEXEL + 3
] as const;
RATE_CHANNELS.forEach((channel, rate) => {
  CHANNEL_RATE[channel] = rate;
});

const GROUP_POSITION = 0;
const GROUP_ELEVATION = 1;
const GROUP_HEIGHT = 2;
const GROUP_TRUNK_HEIGHT = 3;
const GROUP_FOLIAGE = 8;
const GROUP_LEAN = 10;
const GROUP_DAMAGE = 11;
const GROUP_CROP0 = 16;
const GROUP_CROP1 = 17;

const GROUPS: readonly {
  /** The accessor reported to callbacks. */
  key: TreeTransitionKey;
  /** Where settings come from, most specific first. */
  keys: readonly TreeTransitionKey[];
  first: number;
  count: number;
  epsilon?: number;
}[] = [
  // Elevation and trunk height tween with position and height unless their own key is present,
  // which is when these groups take over the trailing channel. See `setTransitions`.
  {
    key: 'getPosition',
    keys: ['getPosition', 'getTree'],
    first: CHANNEL_X,
    count: 3,
    epsilon: SPRING_POSITION_EPSILON
  },
  {key: 'getElevation', keys: ['getElevation'], first: CHANNEL_Z, count: 1},
  {key: 'getHeight', keys: ['getHeight', 'getTree'], first: CHANNEL_HEIGHT, count: 3},
  {
    key: 'getTrunkHeightFraction',
    keys: ['getTrunkHeightFraction'],
    first: CHANNEL_TRUNK_HEIGHT,
    count: 1
  },
  {key: 'getCanopyRadius', keys: ['getCanopyRadius', 'getTree'], first: CHANNEL_CROWN_X, count: 2},
  {
    key: 'getTrunkRadius',
    keys: ['getTrunkRadius', 'getTree'],
    first: CHANNEL_TRUNK_RADIUS,
    count: 1
  },
  {key: 'getGrowth', keys: ['getGrowth', 'getTree'], first: CHANNEL_GROWTH, count: 1},
  {key: 'getHealth', keys: ['getHealth', 'getTree'], first: CHANNEL_HEALTH, count: 1},
  {key: 'getFoliage', keys: ['getFoliage', 'getTree'], first: CHANNEL_FOLIAGE, count: 1},
  {key: 'getFlush', keys: ['getFlush', 'getTree'], first: CHANNEL_FLUSH, count: 1},
  {key: 'getLean', keys: ['getLean', 'getTree'], first: CHANNEL_LEAN_DEGREES, count: 2},
  {key: 'getDamage', keys: ['getDamage', 'getTree'], first: CHANNEL_DAMAGE, count: 1},
  {key: 'getDecay', keys: ['getDecay', 'getTree'], first: CHANNEL_DECAY, count: 1},
  {
    key: 'getCanopyColor',
    keys: ['getCanopyColor', 'getSeason', 'getTree'],
    first: CHANNEL_CANOPY,
    count: 4
  },
  {key: 'getTrunkColor', keys: ['getTrunkColor', 'getTree'], first: CHANNEL_BARK, count: 4},
  {key: 'getTree', keys: ['getTree'], first: CHANNEL_WIND_FLEX, count: 1},
  {key: 'getCrop', keys: ['getCrop', 'getTree'], first: CHANNEL_CROP0, count: CROP_CHANNELS},
  {key: 'getCrop', keys: ['getCrop', 'getTree'], first: CHANNEL_CROP1, count: CROP_CHANNELS}
];
const GROUP_COUNT = GROUPS.length;
const GROUP_MAX_CHANNELS = CROP_CHANNELS;
const GROUP_FIRST = Uint8Array.from(GROUPS, group => group.first);
const GROUP_EPSILON_SQUARED = Float64Array.from(
  GROUPS,
  group => (group.epsilon ?? SPRING_EPSILON) ** 2
);
const RATE_GROUPS = [GROUP_FOLIAGE, GROUP_DAMAGE, GROUP_CROP0, GROUP_CROP1] as const;

const TICK_RESULTS: readonly TreeStateTickResult[] = [
  Object.freeze({changed: false, active: false}),
  Object.freeze({changed: true, active: false}),
  Object.freeze({changed: false, active: true}),
  Object.freeze({changed: true, active: true})
];

/** Whether two settings mean the same transition, field by field. */
function isSameTransition(a: TreeTransitionSettings, b: TreeTransitionSettings): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a.type !== b.type) return false;
  if (a.type === 'spring') {
    const spring = b as TreeSpringSettings;
    if (a.stiffness !== spring.stiffness || a.damping !== spring.damping) return false;
  } else {
    const interpolation = b as TreeInterpolationSettings;
    if (a.duration !== interpolation.duration || a.easing !== interpolation.easing) return false;
  }
  return (
    a.enter === b.enter &&
    a.onStart === b.onStart &&
    a.onEnd === b.onEnd &&
    a.onInterrupt === b.onInterrupt
  );
}

/**
 * Normalizes one key's settings as deck.gl's `normalizeTransitionSettings` does. Returns `previous`
 * when nothing differs, because a layer typically passes a new but equal `transitions` every render.
 */
function resolveTreeTransition(
  settings: TreeTransitionSettings | null | false | undefined,
  previous: ResolvedTreeTransition | null
): ResolvedTreeTransition | null {
  if (!settings) return null;
  if (previous && isSameTransition(settings, previous.source)) return previous;
  const object = typeof settings === 'object' ? settings : null;
  const spring = object?.type === 'spring';
  let duration = 0;
  let easing: ((t: number) => number) | null = null;
  let stiffness = 0;
  let damping = 0;
  if (spring) {
    // Finite, and within the formula's stable range, so a spring always settles.
    const {damping: rawDamping, stiffness: rawStiffness} = object as TreeSpringSettings;
    damping = Number.isFinite(rawDamping) ? (rawDamping as number) : DEFAULT_SPRING_DAMPING;
    damping = Math.max(0.001, Math.min(1.9, damping));
    stiffness =
      Number.isFinite(rawStiffness) && (rawStiffness as number) > 0
        ? (rawStiffness as number)
        : DEFAULT_SPRING_STIFFNESS;
    stiffness = Math.max(1e-4, Math.min(3.9 - 2 * damping, stiffness));
  } else {
    const interpolation = object as TreeInterpolationSettings | null;
    const raw = interpolation ? interpolation.duration : settings;
    if (!Number.isFinite(raw) || (raw as number) <= 0) return null;
    duration = raw as number;
    easing = typeof interpolation?.easing === 'function' ? interpolation.easing : null;
  }
  return {
    source: settings,
    spring,
    duration,
    easing,
    stiffness,
    damping,
    enter: object?.enter ?? null,
    onStart: object?.onStart ?? null,
    onEnd: object?.onEnd ?? null,
    onInterrupt: object?.onInterrupt ?? null
  };
}

const TREE_TRANSITION_KEYS = [...new Set(GROUPS.flatMap(group => group.keys))];
const GROUP_KEY_INDEXES = GROUPS.map(group =>
  group.keys.map(key => TREE_TRANSITION_KEYS.indexOf(key))
);

/** The signed turn, in -180 to 180 degrees, that takes bearing `from` to bearing `to`. */
function getBearingTurn(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Encodes one channel into a state row, and returns whether the row changed. The value comes from
 * `source[index]`: see `TreeStateStore.nextValue` for why doubles do not travel as arguments here.
 */
function writeChannel(
  data: Float32Array,
  rowOffset: number,
  channel: number,
  source: Float64Array,
  index: number
): boolean {
  const value = source[index];
  const offset = rowOffset + CHANNEL_OFFSET[channel];
  const kind = CHANNEL_KIND[channel];
  let changed = false;
  let encoded: number;
  if (kind === KIND_POSITION) {
    encoded = Math.fround(value);
    const low = Math.fround(value - encoded);
    if (data[offset + POSITION_LOW_OFFSET] !== low) {
      data[offset + POSITION_LOW_OFFSET] = low;
      changed = true;
    }
  } else if (kind === KIND_BEARING) {
    const radians = value * DEGREES_TO_RADIANS;
    encoded = Math.fround(Math.atan2(Math.cos(radians), Math.sin(radians)));
  } else {
    const clamped = Math.min(CHANNEL_MAX[channel], Math.max(CHANNEL_MIN[channel], value));
    encoded = Math.fround(clamped * CHANNEL_SCALE[channel]);
  }
  if (data[offset] !== encoded) {
    data[offset] = encoded;
    changed = true;
  }
  return changed;
}

const DEFAULT_ROW_DATA = new Float32Array(FLOATS_PER_ROW);
for (let channel = 0; channel < CHANNEL_COUNT; channel++)
  writeChannel(DEFAULT_ROW_DATA, 0, channel, DEFAULT_TARGETS, channel);

/** Copies channels into a values object. Reused by every read. */
function fillValues(out: TreeStateValues, channels: Float64Array): TreeStateValues {
  for (let axis = 0; axis < 3; axis++) out.position[axis] = channels[CHANNEL_X + axis];
  out.positionLow = undefined;
  out.yaw = channels[CHANNEL_YAW];
  out.windPhase = channels[CHANNEL_WIND_PHASE];
  out.crownX = channels[CHANNEL_CROWN_X];
  out.crownY = channels[CHANNEL_CROWN_Y];
  out.height = channels[CHANNEL_HEIGHT];
  out.trunkHeight = channels[CHANNEL_TRUNK_HEIGHT];
  out.growth = channels[CHANNEL_GROWTH];
  out.health = channels[CHANNEL_HEALTH];
  out.foliage = channels[CHANNEL_FOLIAGE];
  out.flush = channels[CHANNEL_FLUSH];
  out.leanDegrees = channels[CHANNEL_LEAN_DEGREES];
  out.leanBearing = channels[CHANNEL_LEAN_BEARING];
  out.damage = channels[CHANNEL_DAMAGE];
  out.decay = channels[CHANNEL_DECAY];
  for (let i = 0; i < 4; i++) {
    out.canopyColor[i] = channels[CHANNEL_CANOPY + i];
    out.trunkColor[i] = channels[CHANNEL_BARK + i];
  }
  out.trunkRadius = channels[CHANNEL_TRUNK_RADIUS];
  out.windFlex = channels[CHANNEL_WIND_FLEX];
  out.coverage = channels[CHANNEL_COVERAGE];
  out.leafScale = channels[CHANNEL_LEAF_SCALE];
  out.leafDetail = channels[CHANNEL_LEAF_DETAIL];
  out.seed = channels[CHANNEL_SEED];
  for (let slot = 0; slot < 2; slot++) {
    const first = slot === 0 ? CHANNEL_CROP0 : CHANNEL_CROP1;
    const crop = out.crops[slot];
    crop.count = channels[first + CROP_COUNT];
    crop.radius = channels[first + CROP_RADIUS];
    crop.ripeness = channels[first + CROP_RIPENESS];
    crop.fallen = channels[first + CROP_FALLEN];
    for (let i = 0; i < 4; i++) crop.color[i] = channels[first + CROP_COLOR + i];
    for (let i = 0; i < 3; i++) crop.unripeColor[i] = channels[first + CROP_UNRIPE + i];
    crop.dropped = channels[first + CROP_DROPPED];
  }
  return out;
}

/** A values object holding the documented defaults, ready to pass to `getRowValues` as `out`. */
export function createTreeStateValues(): TreeStateValues {
  const createCrop = (): TreeStateCropValues => ({
    count: 0,
    radius: 0,
    ripeness: 0,
    fallen: 0,
    color: [0, 0, 0, 0],
    unripeColor: [0, 0, 0],
    dropped: 0
  });
  return fillValues(
    {
      position: [0, 0, 0],
      yaw: 0,
      windPhase: 0,
      crownX: 0,
      crownY: 0,
      height: 0,
      trunkHeight: 0,
      growth: 0,
      health: 0,
      foliage: 0,
      flush: 0,
      leanDegrees: 0,
      leanBearing: 0,
      damage: 0,
      decay: 0,
      canopyColor: [0, 0, 0, 0],
      trunkColor: [0, 0, 0, 0],
      trunkRadius: 0,
      windFlex: 0,
      coverage: 0,
      leafScale: 0,
      leafDetail: 0,
      seed: 0,
      crops: [createCrop(), createCrop()]
    },
    DEFAULT_TARGETS
  );
}

/**
 * Stable slot ids for records in struct-of-arrays pools. `order` keeps allocation order, so
 * callbacks fire in a predictable sequence. A released slot leaves `order` at the next pass.
 */
class TreeSlotList {
  capacity = 16;
  order = new Int32Array(this.capacity);
  orderCount = 0;
  alive = new Uint8Array(this.capacity);
  aliveCount = 0;
  private free = new Int32Array(this.capacity);
  private freeCount = 0;
  private highWater = 0;

  allocate(): number {
    if (this.freeCount === 0 && this.orderCount > this.aliveCount) this.compact();
    let slot: number;
    if (this.freeCount > 0) {
      slot = this.free[--this.freeCount];
    } else {
      if (this.highWater === this.capacity) this.grow();
      slot = this.highWater++;
    }
    this.alive[slot] = 1;
    this.aliveCount++;
    this.order[this.orderCount++] = slot;
    return slot;
  }

  release(slot: number): void {
    this.alive[slot] = 0;
    this.aliveCount--;
  }

  recycle(slot: number): void {
    this.free[this.freeCount++] = slot;
  }

  private compact(): void {
    let kept = 0;
    for (let i = 0; i < this.orderCount; i++) {
      const slot = this.order[i];
      if (this.alive[slot] === 1) this.order[kept++] = slot;
      else this.recycle(slot);
    }
    this.orderCount = kept;
  }

  private grow(): void {
    this.capacity *= 2;
    const order = new Int32Array(this.capacity);
    order.set(this.order);
    this.order = order;
    const alive = new Uint8Array(this.capacity);
    alive.set(this.alive);
    this.alive = alive;
    const free = new Int32Array(this.capacity);
    free.set(this.free);
    this.free = free;
  }
}

function growArray(array: Float64Array, length: number) {
  const grown = new Float64Array(length);
  grown.set(array);
  return grown;
}

/**
 * Per-tree state for `TreeLayer`: targets, tweens, springs and loss rates, and the Float32Array that
 * backs the RGBA32F state texture, laid out by `TREE_STATE_TEXEL`. It is pure, so wood, leaves and
 * crops read one value per tree and can never disagree, whichever sub-layer or level of detail they
 * are in.
 *
 * Call `setRow` for each row whose accessors ran, then `tick` once per frame. Upload what changed:
 *
 * ```ts
 * const {active} = store.tick(timeline.getTime(), clock);
 * if (store.isDirty) {
 *   const {dirtyLineStart: y, dirtyLineEnd: end} = store;
 *   const floatsPerLine = TREE_STATE_TEXTURE_WIDTH * 4;
 *   texture.writeData(store.data.subarray(y * floatsPerLine, end * floatsPerLine), {
 *     y,
 *     height: end - y
 *   });
 *   store.clearDirty();
 * }
 * if (active) this.setNeedsUpdate();
 * ```
 *
 * Each field group tweens independently, and takes its settings from its own key or else `getTree`:
 *
 * | Fields | Own keys | `enter` value |
 * | --- | --- | --- |
 * | `position` | `getPosition` | `[x, y, z]` |
 * | `position` z | `getElevation` when present, else with `getPosition` | `[z]` |
 * | `height`, `leafScale` | `getHeight` | `[height, leafScale, trunkHeight]` |
 * | `trunkHeight` | `getTrunkHeightFraction` when present, else with `getHeight` | `[fraction]` |
 * | `crownX`, `crownY` | `getCanopyRadius` | `[crownX, crownY]` |
 * | `trunkRadius` | `getTrunkRadius` | `[radius]` |
 * | `growth`, `health`, `foliage`, `flush`, `damage`, `decay` | `getGrowth` and so on | `[value]` |
 * | `leanDegrees`, `leanBearing` | `getLean` | `[degrees, bearing]` |
 * | `canopyColor` | `getCanopyColor`, then `getSeason` | `[r, g, b, a]` |
 * | `trunkColor` | `getTrunkColor` | `[r, g, b, a]` |
 * | `windFlex` | none | `[flex]` |
 * | Each crop slot | `getCrop` | `[count, radius, ripeness, fallen, r, g, b, a, r, g, b, dropped]` |
 *
 * `yaw`, `windPhase`, `coverage`, `leafDetail` and `seed` identify a tree or are driven per frame by
 * the layer, and always jump.
 *
 * Inside a group, each channel keeps its own timing, so a `ripeness` that changes every frame does
 * not restart a `fallen` that is still falling. Callbacks are per group: changing several channels
 * at once starts one transition.
 *
 * Lean never swings a tree around while it is upright: a tree rising from upright goes straight to
 * its target bearing, and one returning upright holds its bearing on the way. Otherwise a bearing
 * takes the short way around. Likewise a crop slot with nothing on the tree takes its new radius,
 * ripeness and colors at once, and only `count` tweens, so the first fruit is never the wrong color.
 */
export class TreeStateStore {
  /**
   * The state rows, `lineCount` lines of `TREE_STATE_TEXTURE_WIDTH` RGBA32F texels. Treat as
   * read-only. Reallocated when `lineCount` changes, so read it again after `resize`.
   */
  data = new Float32Array(FLOATS_PER_LINE);
  /** Rows that exist. */
  rowCount = 0;
  /** Texture height: lines needed to hold `rowCount`, and at least 1. */
  lineCount = 1;

  private dirtyStart = 1;
  private dirtyEnd = 0;
  private changedSinceTick = false;

  /** Latest targets in caller units. Also the current value of any group not tweening. */
  private targets = new Float64Array(TREE_STATE_ROWS_PER_LINE * CHANNEL_COUNT);
  private rowSet = new Uint8Array(TREE_STATE_ROWS_PER_LINE);
  /** Active tween slot of each row and group, or -1. */
  private tweenIndex = new Int32Array(TREE_STATE_ROWS_PER_LINE * GROUP_COUNT);
  /** Active rate slot of each row and rate kind, or -1. */
  private rateIndex = new Int32Array(TREE_STATE_ROWS_PER_LINE * RATE_KINDS);

  private incoming = new Float64Array(CHANNEL_COUNT);
  private startValues = new Float64Array(GROUP_MAX_CHANNELS);
  private readChannels = new Float64Array(CHANNEL_COUNT);

  private transitions: TreeTransitions | null = null;
  private keySettings: (ResolvedTreeTransition | null)[] = TREE_TRANSITION_KEYS.map(() => null);
  private groupSettings: (ResolvedTreeTransition | null)[] = GROUPS.map(() => null);
  private groupCounts = Uint8Array.from(GROUPS, ({count}) => count);

  // Tween records. Channels of a record sit at slot * GROUP_MAX_CHANNELS.
  private tweens = new TreeSlotList();
  private tweenRow = new Int32Array(this.tweens.capacity);
  private tweenGroup = new Uint8Array(this.tweens.capacity);
  private tweenSettings: (ResolvedTreeTransition | null)[] = [];
  /** Spring: when the current run of steps began. */
  private tweenBegin = new Float64Array(this.tweens.capacity);
  /** Spring: steps taken since `tweenBegin`. */
  private tweenSteps = new Float64Array(this.tweens.capacity);
  /** Interpolation: blend origin of each channel. Spring: position at the latest step. */
  private tweenFrom = new Float64Array(this.tweens.capacity * GROUP_MAX_CHANNELS);
  /** Destination of each channel. Bearings are unwrapped, so they take the short way. */
  private tweenTo = new Float64Array(this.tweens.capacity * GROUP_MAX_CHANNELS);
  /** Current value of each channel. */
  private tweenCurrent = new Float64Array(this.tweens.capacity * GROUP_MAX_CHANNELS);
  /** Spring: position at the step before `tweenFrom`. */
  private tweenPrevious = new Float64Array(this.tweens.capacity * GROUP_MAX_CHANNELS);
  /** Interpolation: start time of each channel, or -Infinity if it is not moving. */
  private tweenStart = new Float64Array(this.tweens.capacity * GROUP_MAX_CHANNELS);

  // Rate records, one per value still inside its loss-rate window. Rows at rest cost nothing.
  private rates = new TreeSlotList();
  private rateRow = new Int32Array(this.rates.capacity);
  private rateKind = new Uint8Array(this.rates.capacity);
  private rateHead = new Uint8Array(this.rates.capacity);
  private rateSize = new Uint8Array(this.rates.capacity);
  private rateTimes = new Float64Array(this.rates.capacity * RATE_SAMPLES);
  private rateValues = new Float64Array(this.rates.capacity * RATE_SAMPLES);

  /** The latest timeline time, in milliseconds. */
  private now = 0;
  /** The clock of this frame. */
  private frameClock = Number.NaN;
  /** The last different clock before `frameClock`. */
  private previousClock = Number.NaN;
  /** `tick` has finished for `frameClock`, so any later change at this clock took no time. */
  private frameTicked = false;

  /**
   * Doubles travel between these methods by field or by array index, not as arguments. V8 allocates a
   * box for a double passed to a call it does not inline, which at one per row per frame is the only
   * garbage this path would make.
   */
  private nextValue = Number.NaN;
  private rateBefore = Number.NaN;
  private rateAfter = Number.NaN;

  // Callbacks wait until the store is consistent, so they may call back into it.
  private callbacks: (TreeTransitionCallback | null)[] = [];
  private callbackRows: number[] = [];
  private callbackKeys: TreeTransitionKey[] = [];
  private callbackHead = 0;
  private callbackCount = 0;
  private flushing = false;

  constructor(rowCount = 0) {
    this.resize(rowCount);
  }

  /** Whether any line changed since `clearDirty`. */
  get isDirty(): boolean {
    return this.dirtyEnd > this.dirtyStart;
  }

  /** First line to upload, inclusive. Equals `dirtyLineEnd` when nothing changed. */
  get dirtyLineStart(): number {
    return this.isDirty ? this.dirtyStart : 0;
  }

  /** End of the lines to upload, exclusive. */
  get dirtyLineEnd(): number {
    return this.isDirty ? this.dirtyEnd : 0;
  }

  /** Forgets the dirty lines. Call after uploading them. */
  clearDirty(): void {
    this.dirtyStart = 1;
    this.dirtyEnd = 0;
  }

  /** Tweens still running. */
  get activeTweenCount(): number {
    return this.tweens.aliveCount;
  }

  /**
   * Sets the `transitions` prop. Passing the same object again costs nothing, and an equal new one
   * costs a comparison. Running tweens keep the settings they started with, as in deck.gl. A group
   * whose settings are removed stops: its tween is interrupted and it jumps to its target.
   */
  setTransitions(transitions: TreeTransitions | null | undefined): void {
    const next = transitions ?? null;
    if (next === this.transitions) return;
    this.transitions = next;
    const raw: TreeTransitions = next ?? {};
    const {keySettings, groupSettings, groupCounts} = this;
    for (let i = 0; i < TREE_TRANSITION_KEYS.length; i++)
      keySettings[i] = resolveTreeTransition(raw[TREE_TRANSITION_KEYS[i]], keySettings[i]);

    let stopping = false;
    for (let group = 0; group < GROUP_COUNT; group++) {
      const keyIndexes = GROUP_KEY_INDEXES[group];
      let settings: ResolvedTreeTransition | null = null;
      for (let i = 0; i < keyIndexes.length; i++) {
        const keyIndex = keyIndexes[i];
        if (raw[TREE_TRANSITION_KEYS[keyIndex]] !== undefined) {
          settings = keySettings[keyIndex];
          break;
        }
      }
      if (groupSettings[group] && !settings) stopping = true;
      groupSettings[group] = settings;
    }
    const splitElevation = raw.getElevation !== undefined;
    const splitTrunkHeight = raw.getTrunkHeightFraction !== undefined;
    const split =
      splitElevation !== groupCounts[GROUP_ELEVATION] > 0 ||
      splitTrunkHeight !== groupCounts[GROUP_TRUNK_HEIGHT] > 0;
    if ((stopping || split) && this.tweens.aliveCount > 0) this.stopTweens(split);
    groupCounts[GROUP_POSITION] = splitElevation ? 2 : 3;
    groupCounts[GROUP_ELEVATION] = splitElevation ? 1 : 0;
    groupCounts[GROUP_HEIGHT] = splitTrunkHeight ? 2 : 3;
    groupCounts[GROUP_TRUNK_HEIGHT] = splitTrunkHeight ? 1 : 0;
    this.flushCallbacks();
  }

  /**
   * Sets how many rows exist. Existing rows keep their state and running tweens. Removed rows have
   * their tweens interrupted. Added rows hold the defaults until `setRow`. When `lineCount` changes
   * `data` is reallocated and every line is dirty, since the texture must be recreated at that height.
   */
  resize(rowCount: number): void {
    const count = Number.isFinite(rowCount) ? Math.max(0, Math.floor(rowCount)) : 0;
    const previous = this.rowCount;
    if (count === previous) return;
    if (count < previous) this.dropRows(count);
    const lineCount = Math.max(1, Math.ceil(count / TREE_STATE_ROWS_PER_LINE));
    if (lineCount !== this.lineCount) this.reallocate(lineCount, Math.min(previous, count));
    this.rowCount = count;
    for (let row = previous; row < count; row++) this.resetRow(row);
    if (count > previous) {
      this.markLines(previous, count);
      this.changedSinceTick = true;
    }
    this.flushCallbacks();
  }

  /**
   * Sets the targets of one row. Unchanged values do nothing, and a tween already running toward
   * them carries on. A changed value starts or retargets its group's tween from the current value,
   * or jumps if the group has no settings. A row's first `setRow` jumps, except where it is `isNew`
   * and the group has `enter`. `isNew` means the row holds a different tree from now on: anything
   * running on it is interrupted, and absent fields take their defaults rather than previous values.
   *
   * This allocates nothing as long as `values` objects keep one shape, and `options` objects keep
   * another, so always pass `isNew`. V8 boxes the numbers of objects it has seen in several shapes.
   */
  setRow(row: number, values: TreeStateUpdate, options: TreeStateRowOptions): void {
    this.checkRow(row);
    if (Number.isFinite(options.now)) this.now = options.now;
    this.noteClock(options.clock);

    const isNew = options.isNew === true;
    const wasSet = this.rowSet[row] === 1;
    if (isNew && wasSet) this.clearRow(row);
    this.rowSet[row] = 1;
    const continuing = wasSet && !isNew;

    const base = row * CHANNEL_COUNT;
    this.readIncoming(values, base);

    const {groupCounts, groupSettings, incoming, targets} = this;
    for (let group = 0; group < GROUP_COUNT; group++) {
      const count = groupCounts[group];
      if (count === 0) continue;
      const settings = groupSettings[group];
      if (isNew && settings?.enter) {
        this.enterGroup(row, group, settings);
        continue;
      }
      const first = GROUP_FIRST[group];
      const end = first + count;
      let changed = false;
      for (let channel = first; channel < end; channel++) {
        if (incoming[channel] !== targets[base + channel]) {
          changed = true;
          break;
        }
      }
      if (!changed) continue;
      if (settings && continuing) this.retargetGroup(row, group, settings);
      else this.jumpGroup(row, group, continuing);
    }
    for (let channel = CHANNEL_YAW; channel < CHANNEL_COUNT; channel++) {
      if (incoming[channel] !== targets[base + channel]) {
        targets[base + channel] = incoming[channel];
        this.writeRowChannel(row, channel, targets, base + channel);
      }
    }
    this.sampleRowRates(row);
    this.flushCallbacks();
  }

  /**
   * Advances every tween to `now` and every loss rate to `clock`. A paused timeline holds tweens, and
   * a paused clock holds rates, so things in flight wait rather than land.
   */
  tick(now: number, clock: number): TreeStateTickResult {
    if (Number.isFinite(now)) this.now = now;
    this.noteClock(clock);
    this.advanceTweens();
    this.advanceRates();
    this.frameTicked = true;
    this.flushCallbacks();
    const changed = this.changedSinceTick;
    this.changedSinceTick = false;
    const active = this.tweens.aliveCount > 0 || this.rates.aliveCount > 0;
    return TICK_RESULTS[(changed ? 1 : 0) + (active ? 2 : 0)];
  }

  /**
   * Current values of a row, in the units of `TreeStateValues`. At rest they are exactly what
   * `setRow` resolved. Pass `out` to reuse an object from `createTreeStateValues`.
   */
  getRowValues(row: number, out: TreeStateValues = createTreeStateValues()): TreeStateValues {
    this.checkRow(row);
    const {targets, readChannels, tweenIndex, groupCounts, tweenCurrent} = this;
    const base = row * CHANNEL_COUNT;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++)
      readChannels[channel] = targets[base + channel];
    const indexBase = row * GROUP_COUNT;
    for (let group = 0; group < GROUP_COUNT; group++) {
      const slot = tweenIndex[indexBase + group];
      if (slot < 0) continue;
      const first = GROUP_FIRST[group];
      const offset = slot * GROUP_MAX_CHANNELS;
      for (let c = 0; c < groupCounts[group]; c++) {
        const channel = first + c;
        const value = tweenCurrent[offset + c];
        readChannels[channel] = Math.min(
          CHANNEL_MAX[channel],
          Math.max(CHANNEL_MIN[channel], value)
        );
      }
    }
    const bearing = readChannels[CHANNEL_LEAN_BEARING];
    if (!(bearing >= 0 && bearing < 360))
      readChannels[CHANNEL_LEAN_BEARING] = ((bearing % 360) + 360) % 360;
    return fillValues(out, readChannels);
  }

  private checkRow(row: number): void {
    if (!(row >= 0 && row < this.rowCount) || !Number.isInteger(row))
      throw new RangeError(`TreeStateStore has ${this.rowCount} rows, so row ${row} is invalid.`);
  }

  private noteClock(clock: number): void {
    if (Number.isFinite(clock) && clock !== this.frameClock) {
      this.previousClock = this.frameClock;
      this.frameClock = clock;
      this.frameTicked = false;
    }
  }

  private markLines(startRow: number, endRow: number): void {
    const start = Math.floor(startRow / TREE_STATE_ROWS_PER_LINE);
    const end = Math.floor((endRow - 1) / TREE_STATE_ROWS_PER_LINE) + 1;
    if (this.isDirty) {
      if (start < this.dirtyStart) this.dirtyStart = start;
      if (end > this.dirtyEnd) this.dirtyEnd = end;
    } else {
      this.dirtyStart = start;
      this.dirtyEnd = end;
    }
  }

  private writeRowChannel(row: number, channel: number, source: Float64Array, index: number): void {
    if (writeChannel(this.data, row * FLOATS_PER_ROW, channel, source, index))
      this.markRowChanged(row);
  }

  private markRowChanged(row: number): void {
    this.markLines(row, row + 1);
    this.changedSinceTick = true;
  }

  private reallocate(lineCount: number, keepRows: number): void {
    const rows = lineCount * TREE_STATE_ROWS_PER_LINE;
    const data = new Float32Array(lineCount * FLOATS_PER_LINE);
    data.set(this.data.subarray(0, keepRows * FLOATS_PER_ROW));
    this.data = data;
    const targets = new Float64Array(rows * CHANNEL_COUNT);
    targets.set(this.targets.subarray(0, keepRows * CHANNEL_COUNT));
    this.targets = targets;
    const rowSet = new Uint8Array(rows);
    rowSet.set(this.rowSet.subarray(0, keepRows));
    this.rowSet = rowSet;
    const tweenIndex = new Int32Array(rows * GROUP_COUNT);
    tweenIndex.set(this.tweenIndex.subarray(0, keepRows * GROUP_COUNT));
    this.tweenIndex = tweenIndex;
    const rateIndex = new Int32Array(rows * RATE_KINDS);
    rateIndex.set(this.rateIndex.subarray(0, keepRows * RATE_KINDS));
    this.rateIndex = rateIndex;
    this.lineCount = lineCount;
    this.dirtyStart = 0;
    this.dirtyEnd = lineCount;
    this.changedSinceTick = true;
  }

  private resetRow(row: number): void {
    this.targets.set(DEFAULT_TARGETS, row * CHANNEL_COUNT);
    this.data.set(DEFAULT_ROW_DATA, row * FLOATS_PER_ROW);
    this.rowSet[row] = 0;
    this.tweenIndex.fill(-1, row * GROUP_COUNT, (row + 1) * GROUP_COUNT);
    this.rateIndex.fill(-1, row * RATE_KINDS, (row + 1) * RATE_KINDS);
  }

  private dropRows(rowCount: number): void {
    const {tweens, rates} = this;
    for (let i = 0; i < tweens.orderCount; i++) {
      const slot = tweens.order[i];
      if (tweens.alive[slot] === 1 && this.tweenRow[slot] >= rowCount) {
        this.enqueueCallback(
          this.tweenSettings[slot]?.onInterrupt,
          this.tweenRow[slot],
          this.tweenGroup[slot]
        );
        this.releaseTween(slot);
      }
    }
    for (let i = 0; i < rates.orderCount; i++) {
      const slot = rates.order[i];
      if (rates.alive[slot] === 1 && this.rateRow[slot] >= rowCount) this.stopRate(slot);
    }
    this.changedSinceTick = true;
  }

  /** Returns a row in use to the defaults, for a new tree. */
  private clearRow(row: number): void {
    for (let group = 0; group < GROUP_COUNT; group++) {
      const slot = this.tweenIndex[row * GROUP_COUNT + group];
      if (slot >= 0) {
        this.enqueueCallback(this.tweenSettings[slot]?.onInterrupt, row, group);
        this.releaseTween(slot);
      }
    }
    for (let rate = 0; rate < RATE_KINDS; rate++) {
      const slot = this.rateIndex[row * RATE_KINDS + rate];
      if (slot >= 0) this.stopRate(slot);
    }
    this.resetRow(row);
    this.markRowChanged(row);
  }

  /**
   * Fills `incoming` from `values`. Raw values go straight into the typed array, where undefined, and
   * null by way of `??`, become NaN. One pass then checks them all against the channel table.
   */
  private readIncoming(values: TreeStateUpdate, base: number): void {
    const {incoming, targets} = this;
    const {position, positionLow: low, crops} = values;
    for (let axis = 0; axis < 3; axis++) {
      const lowPart = low ? low[axis] : 0;
      incoming[CHANNEL_X + axis] =
        (position ? (position[axis] ?? NOT_SET) : NOT_SET) +
        (Number.isFinite(lowPart) ? lowPart : 0);
    }
    incoming[CHANNEL_CROWN_X] = values.crownX ?? NOT_SET;
    incoming[CHANNEL_CROWN_Y] = values.crownY ?? NOT_SET;
    incoming[CHANNEL_HEIGHT] = values.height ?? NOT_SET;
    incoming[CHANNEL_LEAF_SCALE] = values.leafScale ?? NOT_SET;
    incoming[CHANNEL_TRUNK_HEIGHT] = values.trunkHeight ?? NOT_SET;
    incoming[CHANNEL_TRUNK_RADIUS] = values.trunkRadius ?? NOT_SET;
    incoming[CHANNEL_GROWTH] = values.growth ?? NOT_SET;
    incoming[CHANNEL_HEALTH] = values.health ?? NOT_SET;
    incoming[CHANNEL_FOLIAGE] = values.foliage ?? NOT_SET;
    incoming[CHANNEL_FLUSH] = values.flush ?? NOT_SET;
    incoming[CHANNEL_LEAN_DEGREES] = values.leanDegrees ?? NOT_SET;
    incoming[CHANNEL_LEAN_BEARING] = values.leanBearing ?? NOT_SET;
    incoming[CHANNEL_DAMAGE] = values.damage ?? NOT_SET;
    incoming[CHANNEL_DECAY] = values.decay ?? NOT_SET;
    this.readIncomingColor(values.canopyColor, CHANNEL_CANOPY, 4);
    this.readIncomingColor(values.trunkColor, CHANNEL_BARK, 4);
    incoming[CHANNEL_WIND_FLEX] = values.windFlex ?? NOT_SET;
    this.readIncomingCrop(crops, 0, CHANNEL_CROP0);
    this.readIncomingCrop(crops, 1, CHANNEL_CROP1);
    incoming[CHANNEL_YAW] = values.yaw ?? NOT_SET;
    incoming[CHANNEL_WIND_PHASE] = values.windPhase ?? NOT_SET;
    incoming[CHANNEL_COVERAGE] = values.coverage ?? NOT_SET;
    incoming[CHANNEL_LEAF_DETAIL] = values.leafDetail ?? NOT_SET;
    incoming[CHANNEL_SEED] = values.seed ?? NOT_SET;

    const bearing = incoming[CHANNEL_LEAN_BEARING];
    if (!(bearing >= 0 && bearing < 360))
      incoming[CHANNEL_LEAN_BEARING] = ((bearing % 360) + 360) % 360;
    for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
      const value = incoming[channel];
      incoming[channel] = Number.isFinite(value)
        ? Math.min(CHANNEL_MAX[channel], Math.max(CHANNEL_MIN[channel], value))
        : targets[base + channel];
    }
  }

  private readIncomingColor(
    color: ArrayLike<number> | null | undefined,
    channel: number,
    size: number
  ): void {
    const {incoming} = this;
    for (let i = 0; i < size; i++)
      incoming[channel + i] = color ? (color[i] ?? (i === 3 ? 255 : NOT_SET)) : NOT_SET;
  }

  private readIncomingCrop(crops: TreeStateUpdate['crops'], slot: number, channel: number): void {
    const {incoming} = this;
    const crop = crops ? crops[slot] : null;
    if (crop) {
      incoming[channel + CROP_COUNT] = crop.count ?? NOT_SET;
      incoming[channel + CROP_RADIUS] = crop.radius ?? NOT_SET;
      incoming[channel + CROP_RIPENESS] = crop.ripeness ?? NOT_SET;
      incoming[channel + CROP_FALLEN] = crop.fallen ?? NOT_SET;
      incoming[channel + CROP_DROPPED] = crop.dropped ?? NOT_SET;
    } else {
      // A slot left out of a supplied array has no crop. Its appearance holds while it animates out.
      incoming[channel + CROP_COUNT] = crops === undefined ? NOT_SET : 0;
      incoming[channel + CROP_DROPPED] = crops === undefined ? NOT_SET : 0;
      incoming[channel + CROP_RADIUS] = NOT_SET;
      incoming[channel + CROP_RIPENESS] = NOT_SET;
      incoming[channel + CROP_FALLEN] = NOT_SET;
    }
    this.readIncomingColor(crop?.color, channel + CROP_COLOR, 4);
    this.readIncomingColor(crop?.unripeColor, channel + CROP_UNRIPE, 3);
  }

  private enqueueCallback(
    callback: TreeTransitionCallback | null | undefined,
    row: number,
    group: number
  ): void {
    if (!callback) return;
    const index = this.callbackCount++;
    this.callbacks[index] = callback;
    this.callbackRows[index] = row;
    this.callbackKeys[index] = GROUPS[group].key;
  }

  private flushCallbacks(): void {
    if (this.flushing || this.callbackHead === this.callbackCount) return;
    this.flushing = true;
    try {
      while (this.callbackHead < this.callbackCount) {
        const index = this.callbackHead++;
        const callback = this.callbacks[index] as TreeTransitionCallback;
        this.callbacks[index] = null;
        callback(this.callbackRows[index], this.callbackKeys[index]);
      }
    } finally {
      // If a callback threw, the rest run on the next flush, so every start still gets its end.
      this.flushing = false;
      if (this.callbackHead === this.callbackCount) {
        this.callbackHead = 0;
        this.callbackCount = 0;
      }
    }
  }

  private allocateTween(): number {
    const {tweens} = this;
    const slot = tweens.allocate();
    if (tweens.capacity > this.tweenRow.length) {
      const {capacity} = tweens;
      const channels = capacity * GROUP_MAX_CHANNELS;
      const tweenRow = new Int32Array(capacity);
      tweenRow.set(this.tweenRow);
      this.tweenRow = tweenRow;
      const tweenGroup = new Uint8Array(capacity);
      tweenGroup.set(this.tweenGroup);
      this.tweenGroup = tweenGroup;
      this.tweenBegin = growArray(this.tweenBegin, capacity);
      this.tweenSteps = growArray(this.tweenSteps, capacity);
      this.tweenFrom = growArray(this.tweenFrom, channels);
      this.tweenTo = growArray(this.tweenTo, channels);
      this.tweenCurrent = growArray(this.tweenCurrent, channels);
      this.tweenPrevious = growArray(this.tweenPrevious, channels);
      this.tweenStart = growArray(this.tweenStart, channels);
    }
    return slot;
  }

  private releaseTween(slot: number): void {
    this.tweenIndex[this.tweenRow[slot] * GROUP_COUNT + this.tweenGroup[slot]] = -1;
    this.tweenSettings[slot] = null;
    this.tweens.release(slot);
  }

  /** Copies a group's incoming values to its targets, without touching the state row. */
  private commitTargets(row: number, group: number): void {
    const base = row * CHANNEL_COUNT;
    const first = GROUP_FIRST[group];
    for (let channel = first; channel < first + this.groupCounts[group]; channel++)
      this.targets[base + channel] = this.incoming[channel];
  }

  /**
   * Moves a group to its incoming values at once. It has no tween to end: `setTransitions` stops the
   * tweens of a group that loses its settings, and `clearRow` those of a row with a new tree.
   */
  private jumpGroup(row: number, group: number, trackRates: boolean): void {
    const {incoming, targets} = this;
    const base = row * CHANNEL_COUNT;
    const first = GROUP_FIRST[group];
    for (let channel = first; channel < first + this.groupCounts[group]; channel++) {
      const before = targets[base + channel];
      const value = incoming[channel];
      targets[base + channel] = value;
      this.writeRowChannel(row, channel, targets, base + channel);
      const rate = CHANNEL_RATE[channel];
      if (trackRates && rate >= 0) {
        this.rateBefore = before;
        this.rateAfter = value;
        this.noteRateChange(row, rate);
      }
    }
  }

  private retargetGroup(row: number, group: number, settings: ResolvedTreeTransition): void {
    const slot = this.tweenIndex[row * GROUP_COUNT + group];
    if (slot >= 0) {
      this.retargetTween(slot, row, group, settings);
      return;
    }
    const base = row * CHANNEL_COUNT;
    const first = GROUP_FIRST[group];
    for (let c = 0; c < this.groupCounts[group]; c++)
      this.startValues[c] = this.targets[base + first + c];
    this.beginTween(row, group, settings);
  }

  /** Runs `enter` for one group of a new row, and starts its tween from the result. */
  private enterGroup(row: number, group: number, settings: ResolvedTreeTransition): void {
    const {incoming, startValues} = this;
    const first = GROUP_FIRST[group];
    const count = this.groupCounts[group];
    const height = incoming[CHANNEL_HEIGHT];
    const asFraction = group === GROUP_TRUNK_HEIGHT;
    const toValue: number[] = [];
    if (asFraction) {
      toValue.push(height > 0 ? incoming[CHANNEL_TRUNK_HEIGHT] / height : 0);
    } else {
      for (let c = 0; c < GROUPS[group].count; c++) toValue.push(incoming[first + c]);
    }
    const start = (settings.enter as TreeTransitionEnter)(toValue);
    for (let c = 0; c < count; c++) {
      const channel = first + c;
      const value = typeof start === 'number' ? start : start?.[c];
      if (Number.isFinite(value)) {
        const scaled = asFraction ? (value as number) * height : (value as number);
        startValues[c] = Math.min(CHANNEL_MAX[channel], Math.max(CHANNEL_MIN[channel], scaled));
      } else {
        startValues[c] = incoming[channel];
      }
    }
    this.beginTween(row, group, settings);
  }

  /** Starts a tween from `startValues` toward the incoming values, if anything would move. */
  private beginTween(row: number, group: number, settings: ResolvedTreeTransition): void {
    // Allocating can replace the record arrays, so read them afterward.
    const slot = this.allocateTween();
    const {incoming, startValues, tweenFrom, tweenTo, tweenCurrent, tweenPrevious, tweenStart} =
      this;
    const first = GROUP_FIRST[group];
    const count = this.groupCounts[group];
    this.tweenRow[slot] = row;
    this.tweenGroup[slot] = group;
    this.tweenSettings[slot] = settings;
    this.tweenBegin[slot] = this.now;
    this.tweenSteps[slot] = 0;
    const offset = slot * GROUP_MAX_CHANNELS;
    for (let c = 0; c < count; c++) {
      const from = startValues[c];
      const to = incoming[first + c];
      tweenFrom[offset + c] = from;
      tweenCurrent[offset + c] = from;
      tweenPrevious[offset + c] = from;
      tweenTo[offset + c] = to;
      tweenStart[offset + c] = from === to ? -Infinity : this.now;
    }
    this.applyGroupRules(slot, row, group, false);
    if (!this.isTweenMoving(slot, count, settings)) {
      this.releaseTween(slot);
      this.jumpGroup(row, group, false);
      return;
    }
    this.tweenIndex[row * GROUP_COUNT + group] = slot;
    for (let c = 0; c < count; c++) this.writeRowChannel(row, first + c, tweenCurrent, offset + c);
    this.commitTargets(row, group);
    this.enqueueCallback(settings.onStart, row, group);
  }

  /** Points a running tween at the incoming values, continuing from where it is at `now`. */
  private retargetTween(
    slot: number,
    row: number,
    group: number,
    settings: ResolvedTreeTransition
  ): void {
    const finished = this.advanceTween(slot);
    const previous = this.tweenSettings[slot] as ResolvedTreeTransition;
    this.enqueueCallback(finished ? previous.onEnd : previous.onInterrupt, row, group);

    const {now, incoming, targets, tweenFrom, tweenTo, tweenCurrent, tweenPrevious, tweenStart} =
      this;
    const base = row * CHANNEL_COUNT;
    const first = GROUP_FIRST[group];
    const count = this.groupCounts[group];
    const offset = slot * GROUP_MAX_CHANNELS;
    if (settings.spring) {
      if (previous.spring && !finished) {
        this.rebaseSpring(slot, group, previous);
      } else {
        // Nothing to carry over: a spring that settled has no velocity, and an interpolation's is
        // not a spring's.
        for (let c = 0; c < count; c++) {
          tweenFrom[offset + c] = tweenCurrent[offset + c];
          tweenPrevious[offset + c] = tweenCurrent[offset + c];
        }
      }
      this.tweenBegin[slot] = now;
      this.tweenSteps[slot] = 0;
    } else if (previous.duration !== settings.duration) {
      // Whatever is still moving carries on under the new timing, from where it is now. This includes
      // a spring, whose duration is 0. A new easing alone does not count: a layer that writes it
      // inline passes a new function every render, which must not restart everything in the group.
      for (let c = 0; c < count; c++) {
        const current = tweenCurrent[offset + c];
        tweenFrom[offset + c] = current;
        tweenStart[offset + c] = current === tweenTo[offset + c] ? -Infinity : now;
      }
    }
    this.tweenSettings[slot] = settings;

    // The lean rule places the bearing itself.
    const retargeted = group === GROUP_LEAN ? 1 : count;
    for (let c = 0; c < retargeted; c++) {
      const value = incoming[first + c];
      if (value !== targets[base + first + c]) {
        const current = tweenCurrent[offset + c];
        tweenFrom[offset + c] = current;
        tweenTo[offset + c] = value;
        tweenStart[offset + c] = current === value ? -Infinity : now;
      }
    }
    this.applyGroupRules(slot, row, group, true);
    this.commitTargets(row, group);
    if (this.isTweenMoving(slot, count, settings)) {
      this.enqueueCallback(settings.onStart, row, group);
    } else {
      for (let c = 0; c < count; c++)
        this.writeRowChannel(row, first + c, targets, base + first + c);
      this.releaseTween(slot);
    }
  }

  private isTweenMoving(slot: number, count: number, settings: ResolvedTreeTransition): boolean {
    const offset = slot * GROUP_MAX_CHANNELS;
    for (let c = 0; c < count; c++) {
      if (settings.spring) {
        const current = this.tweenCurrent[offset + c];
        if (current !== this.tweenTo[offset + c] || current !== this.tweenPrevious[offset + c])
          return true;
      } else if (this.now - this.tweenStart[offset + c] < settings.duration) {
        return true;
      }
    }
    return false;
  }

  /** Field semantics that plain per-channel arithmetic would get visibly wrong. */
  private applyGroupRules(slot: number, row: number, group: number, retargeting: boolean): void {
    if (group === GROUP_LEAN) this.applyLeanRule(slot, row, retargeting);
    else if (group === GROUP_CROP0 || group === GROUP_CROP1)
      this.applyEmptyCropRule(slot, row, group);
  }

  /** Puts a tween's channel on its incoming value at once, for good. */
  private snapTweenChannel(offset: number, row: number, channel: number): void {
    const value = this.incoming[channel];
    this.tweenFrom[offset] = value;
    this.tweenTo[offset] = value;
    this.tweenCurrent[offset] = value;
    this.tweenPrevious[offset] = value;
    this.tweenStart[offset] = -Infinity;
    this.writeRowChannel(row, channel, this.tweenCurrent, offset);
  }

  private applyLeanRule(slot: number, row: number, retargeting: boolean): void {
    const {incoming, tweenFrom, tweenTo, tweenCurrent, tweenPrevious, tweenStart} = this;
    const offset = slot * GROUP_MAX_CHANNELS;
    const degrees = tweenCurrent[offset];
    const bearing = tweenCurrent[offset + 1];
    const target = incoming[CHANNEL_LEAN_BEARING];
    const upright = degrees < LEAN_UPRIGHT_DEGREES;
    const targetUpright = incoming[CHANNEL_LEAN_DEGREES] < LEAN_UPRIGHT_DEGREES;
    if (upright && !targetUpright) {
      this.snapTweenChannel(offset + 1, row, CHANNEL_LEAN_BEARING);
      return;
    }
    if (targetUpright && !upright) {
      // Held here until the tween ends, when the target bearing lands on an upright tree.
      tweenFrom[offset + 1] = bearing;
      tweenTo[offset + 1] = bearing;
      tweenPrevious[offset + 1] = bearing;
      tweenStart[offset + 1] = -Infinity;
      return;
    }
    const sameTarget =
      retargeting &&
      tweenStart[offset + 1] !== -Infinity &&
      Math.abs(getBearingTurn(tweenTo[offset + 1], target)) < SAME_BEARING_DEGREES;
    if (sameTarget) return;
    const turn = getBearingTurn(bearing, target);
    tweenFrom[offset + 1] = bearing;
    tweenTo[offset + 1] = bearing + turn;
    tweenStart[offset + 1] = turn === 0 ? -Infinity : this.now;
  }

  private applyEmptyCropRule(slot: number, row: number, group: number): void {
    const first = GROUP_FIRST[group];
    const offset = slot * GROUP_MAX_CHANNELS;
    if (
      this.tweenCurrent[offset + CROP_COUNT] > EMPTY_CROP_COUNT ||
      this.tweenCurrent[offset + CROP_DROPPED] > EMPTY_CROP_COUNT
    )
      return;
    for (let c = CROP_RADIUS; c < CROP_DROPPED; c++)
      this.snapTweenChannel(offset + c, row, first + c);
  }

  /**
   * Restarts a spring's steps at its current value and velocity. The value at `now` lies between two
   * steps. Stepping onward from there, instead of from the earlier step, keeps it continuous when
   * the new destination takes effect.
   */
  private rebaseSpring(slot: number, group: number, settings: ResolvedTreeTransition): void {
    const {stiffness, damping} = settings;
    const {tweenFrom, tweenTo, tweenCurrent, tweenPrevious} = this;
    const offset = slot * GROUP_MAX_CHANNELS;
    const elapsed = (this.now - this.tweenBegin[slot]) / SPRING_STEP_MS;
    const fraction = Math.max(0, Math.min(1, elapsed - this.tweenSteps[slot]));
    for (let c = 0; c < this.groupCounts[group]; c++) {
      const position = tweenFrom[offset + c];
      const velocity = position - tweenPrevious[offset + c];
      const next =
        position + velocity + (tweenTo[offset + c] - position) * stiffness - velocity * damping;
      const current = tweenCurrent[offset + c];
      tweenFrom[offset + c] = current;
      tweenPrevious[offset + c] = current - (velocity + (next - position - velocity) * fraction);
    }
  }

  private advanceTweens(): void {
    const list = this.tweens;
    let kept = 0;
    for (let i = 0; i < list.orderCount; i++) {
      const slot = list.order[i];
      if (list.alive[slot] === 0) {
        list.recycle(slot);
      } else if (this.advanceTween(slot)) {
        this.finishTween(slot);
        list.recycle(slot);
      } else {
        list.order[kept++] = slot;
      }
    }
    list.orderCount = kept;
  }

  /** Brings a tween to `now`, and returns whether it has reached its destination. */
  private advanceTween(slot: number): boolean {
    return (this.tweenSettings[slot] as ResolvedTreeTransition).spring
      ? this.advanceSpring(slot)
      : this.advanceInterpolation(slot);
  }

  private advanceInterpolation(slot: number): boolean {
    const {duration, easing} = this.tweenSettings[slot] as ResolvedTreeTransition;
    const {now, tweenStart, tweenFrom, tweenTo} = this;
    const row = this.tweenRow[slot];
    const group = this.tweenGroup[slot];
    const first = GROUP_FIRST[group];
    const count = this.groupCounts[group];
    const offset = slot * GROUP_MAX_CHANNELS;
    let finished = true;
    // Channels usually started together, and an easing is the caller's code, so run it once for them.
    let easedStart = Number.NaN;
    let eased = 0;
    for (let c = 0; c < count; c++) {
      const start = tweenStart[offset + c];
      const to = tweenTo[offset + c];
      const t = (now - start) / duration;
      let value = to;
      if (t < 1) {
        finished = false;
        const from = tweenFrom[offset + c];
        if (t <= 0) {
          value = from;
        } else {
          if (start !== easedStart) {
            easedStart = start;
            eased = t;
            if (easing) {
              // `+` keeps `eased` a double. Merged with the untyped result of a call, V8 would box
              // `t` on every tick of every tween, including those with no easing.
              const result = +easing(t);
              if (Number.isFinite(result)) eased = result;
            }
          }
          value = from + (to - from) * eased;
        }
      }
      this.nextValue = value;
      this.setTweenValue(offset + c, row, first + c);
    }
    return finished;
  }

  private advanceSpring(slot: number): boolean {
    const elapsed = (this.now - this.tweenBegin[slot]) / SPRING_STEP_MS;
    if (elapsed < 0) return false;
    const {stiffness, damping} = this.tweenSettings[slot] as ResolvedTreeTransition;
    const {tweenFrom, tweenTo, tweenPrevious} = this;
    const row = this.tweenRow[slot];
    const group = this.tweenGroup[slot];
    const first = GROUP_FIRST[group];
    const count = this.groupCounts[group];
    const offset = slot * GROUP_MAX_CHANNELS;
    const epsilonSquared = GROUP_EPSILON_SQUARED[group];
    const steps = Math.floor(elapsed + SPRING_STEP_ROUNDING);
    let taken = this.tweenSteps[slot];
    let finished = steps - taken > MAX_SPRING_STEPS_PER_TICK;
    while (!finished && taken < steps) {
      let distance = 0;
      let speed = 0;
      for (let c = 0; c < count; c++) {
        const position = tweenFrom[offset + c];
        const velocity = position - tweenPrevious[offset + c];
        const to = tweenTo[offset + c];
        const next = position + velocity + (to - position) * stiffness - velocity * damping;
        tweenPrevious[offset + c] = position;
        tweenFrom[offset + c] = next;
        distance += (next - to) * (next - to);
        speed += (next - position) * (next - position);
      }
      taken++;
      finished = distance < epsilonSquared && speed < epsilonSquared;
    }
    this.tweenSteps[slot] = taken;
    if (finished) {
      for (let c = 0; c < count; c++) {
        this.nextValue = tweenTo[offset + c];
        this.setTweenValue(offset + c, row, first + c);
      }
      return true;
    }
    // Between steps, show the way to the next one, so motion is smooth at any frame rate.
    const fraction = Math.max(0, elapsed - taken);
    for (let c = 0; c < count; c++) {
      const position = tweenFrom[offset + c];
      const velocity = position - tweenPrevious[offset + c];
      const next =
        position + velocity + (tweenTo[offset + c] - position) * stiffness - velocity * damping;
      this.nextValue = position + (next - position) * fraction;
      this.setTweenValue(offset + c, row, first + c);
    }
    return false;
  }

  /** Moves a tween's channel to `nextValue`. */
  private setTweenValue(offset: number, row: number, channel: number): void {
    const {tweenCurrent} = this;
    const value = this.nextValue;
    const before = tweenCurrent[offset];
    if (value === before) return;
    tweenCurrent[offset] = value;
    this.writeRowChannel(row, channel, tweenCurrent, offset);
    const rate = CHANNEL_RATE[channel];
    if (rate >= 0) {
      // Every channel with a loss rate is 0-1.
      this.rateBefore = Math.min(1, Math.max(0, before));
      this.rateAfter = Math.min(1, Math.max(0, value));
      this.noteRateChange(row, rate);
    }
  }

  /** Lands a tween that reached its destination exactly on the group's targets. */
  private finishTween(slot: number): void {
    const row = this.tweenRow[slot];
    const group = this.tweenGroup[slot];
    this.enqueueCallback(this.tweenSettings[slot]?.onEnd, row, group);
    const base = row * CHANNEL_COUNT;
    const first = GROUP_FIRST[group];
    for (let channel = first; channel < first + this.groupCounts[group]; channel++)
      this.writeRowChannel(row, channel, this.targets, base + channel);
    this.releaseTween(slot);
  }

  /** Interrupts tweens whose group no longer has settings, or all that a split would reassign. */
  private stopTweens(split: boolean): void {
    const {tweens} = this;
    for (let i = 0; i < tweens.orderCount; i++) {
      const slot = tweens.order[i];
      if (tweens.alive[slot] === 0) continue;
      const group = this.tweenGroup[slot];
      const reassigned =
        split &&
        (group === GROUP_POSITION ||
          group === GROUP_ELEVATION ||
          group === GROUP_HEIGHT ||
          group === GROUP_TRUNK_HEIGHT);
      if (!reassigned && this.groupSettings[group]) continue;
      const row = this.tweenRow[slot];
      this.enqueueCallback(this.tweenSettings[slot]?.onInterrupt, row, group);
      const base = row * CHANNEL_COUNT;
      const first = GROUP_FIRST[group];
      const offset = slot * GROUP_MAX_CHANNELS;
      for (let c = 0; c < this.groupCounts[group]; c++) {
        const channel = first + c;
        this.writeRowChannel(row, channel, this.targets, base + channel);
        const rate = CHANNEL_RATE[channel];
        if (rate >= 0) {
          this.rateBefore = Math.min(1, Math.max(0, this.tweenCurrent[offset + c]));
          this.rateAfter = this.targets[base + channel];
          this.noteRateChange(row, rate);
        }
      }
      this.releaseTween(slot);
    }
  }

  /**
   * Records a move from `rateBefore` to `rateAfter` in a value with a loss rate. A value with no
   * record has rate 0, and only a fall over a usable clock step needs one.
   */
  private noteRateChange(row: number, rate: number): void {
    let slot = this.rateIndex[row * RATE_KINDS + rate];
    if (slot < 0) {
      const {rateBefore, rateAfter, frameClock} = this;
      // The clock at which a value at rest was last known. Once this frame has ticked, a further
      // change at the same clock took no time.
      const restClock = this.frameTicked ? frameClock : this.previousClock;
      const step = frameClock - restClock;
      if (!(step !== 0 && Math.abs(step) <= MAX_RATE_CLOCK_STEP)) return;
      if (rate === RATE_FOLIAGE ? (rateBefore - rateAfter) / step <= 0 : rateBefore === rateAfter)
        return;
      slot = this.allocateRate();
      this.rateIndex[row * RATE_KINDS + rate] = slot;
      this.rateRow[slot] = row;
      this.rateKind[slot] = rate;
      this.rateHead[slot] = 0;
      this.rateSize[slot] = 1;
      this.rateTimes[slot * RATE_SAMPLES] = restClock;
      this.rateValues[slot * RATE_SAMPLES] = rateBefore;
    }
    this.sampleRate(slot);
  }

  private allocateRate(): number {
    const {rates} = this;
    const slot = rates.allocate();
    if (rates.capacity > this.rateRow.length) {
      const {capacity} = rates;
      const rateRow = new Int32Array(capacity);
      rateRow.set(this.rateRow);
      this.rateRow = rateRow;
      const rateKind = new Uint8Array(capacity);
      rateKind.set(this.rateKind);
      this.rateKind = rateKind;
      const rateHead = new Uint8Array(capacity);
      rateHead.set(this.rateHead);
      this.rateHead = rateHead;
      const rateSize = new Uint8Array(capacity);
      rateSize.set(this.rateSize);
      this.rateSize = rateSize;
      this.rateTimes = growArray(this.rateTimes, capacity * RATE_SAMPLES);
      this.rateValues = growArray(this.rateValues, capacity * RATE_SAMPLES);
    }
    return slot;
  }

  /**
   * Adds `rateAfter`, at this frame's clock, to a value's window. The rate is the secant across the
   * window, in loss per second. The sign of the clock step comes along, so scrubbing backward through
   * a fall gives the same rate as playing it forward, which keeps falling things a function of state.
   */
  private sampleRate(slot: number): void {
    const {rateTimes, rateValues, frameClock: clock, rateAfter: value} = this;
    const offset = slot * RATE_SAMPLES;
    const head = this.rateHead[slot];
    const newestTime = rateTimes[offset + head];
    const newestValue = rateValues[offset + head];
    const step = clock - newestTime;
    if (step === 0) {
      // A change that took no clock time has no finite difference.
      if (value !== newestValue) this.stopRate(slot);
      return;
    }
    const reversed = this.rateKind[slot] === RATE_FOLIAGE && (newestValue - value) / step < 0;
    if (!(Math.abs(step) <= MAX_RATE_CLOCK_STEP) || reversed) {
      this.stopRate(slot);
      return;
    }
    let size = this.rateSize[slot];
    if (size > 1) {
      // A clock that changed direction starts the window again from the turning point.
      const earlierTime = rateTimes[offset + ((head + RATE_SAMPLES - 1) % RATE_SAMPLES)];
      if ((newestTime - earlierTime) * step < 0) size = 1;
    }
    const next = (head + 1) % RATE_SAMPLES;
    rateTimes[offset + next] = clock;
    rateValues[offset + next] = value;
    size = Math.min(size + 1, RATE_SAMPLES);
    this.rateHead[slot] = next;
    this.rateSize[slot] = size;
    const oldest = (next + RATE_SAMPLES - size + 1) % RATE_SAMPLES;
    const oldestValue = rateValues[offset + oldest];
    if (oldestValue === value) {
      this.stopRate(slot);
      return;
    }
    const row = this.rateRow[slot];
    const rateOffset = row * FLOATS_PER_ROW + RATE_OFFSETS[this.rateKind[slot]];
    const rate = Math.fround(
      Math.abs((oldestValue - value) / (clock - rateTimes[offset + oldest]))
    );
    if (this.data[rateOffset] !== rate) {
      this.data[rateOffset] = rate;
      this.markRowChanged(row);
    }
  }

  private stopRate(slot: number): void {
    const row = this.rateRow[slot];
    const rate = this.rateKind[slot];
    const rateOffset = row * FLOATS_PER_ROW + RATE_OFFSETS[rate];
    if (this.data[rateOffset] !== 0) {
      this.data[rateOffset] = 0;
      this.markRowChanged(row);
    }
    this.rateIndex[row * RATE_KINDS + rate] = -1;
    this.rates.release(slot);
  }

  /** Feeds a row's windows from `setRow`. A tween's current value is only known at `tick`. */
  private sampleRowRates(row: number): void {
    const base = row * CHANNEL_COUNT;
    for (let rate = 0; rate < RATE_KINDS; rate++) {
      const slot = this.rateIndex[row * RATE_KINDS + rate];
      if (slot >= 0 && this.tweenIndex[row * GROUP_COUNT + RATE_GROUPS[rate]] < 0) {
        this.rateAfter = this.targets[base + RATE_CHANNELS[rate]];
        this.sampleRate(slot);
      }
    }
  }

  private advanceRates(): void {
    const list = this.rates;
    let kept = 0;
    for (let i = 0; i < list.orderCount; i++) {
      const slot = list.order[i];
      if (list.alive[slot] === 1) {
        const row = this.rateRow[slot];
        const rate = this.rateKind[slot];
        const channel = RATE_CHANNELS[rate];
        const group = RATE_GROUPS[rate];
        const tween = this.tweenIndex[row * GROUP_COUNT + group];
        const value =
          tween < 0
            ? this.targets[row * CHANNEL_COUNT + channel]
            : this.tweenCurrent[tween * GROUP_MAX_CHANNELS + channel - GROUP_FIRST[group]];
        this.rateAfter = Math.min(1, Math.max(0, value));
        this.sampleRate(slot);
      }
      if (list.alive[slot] === 1) list.order[kept++] = slot;
      else list.recycle(slot);
    }
    list.orderCount = kept;
  }
}
