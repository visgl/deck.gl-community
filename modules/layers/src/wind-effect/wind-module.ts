// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

/** Bend axis and crown mode (mat2 columns) of the original fixed wind, in the world frame. */
const LEGACY_AXIS = [1, 0.45] as const;
const LEGACY_MODE = [0.65, -0.25, 0.3, 0.8] as const;

/** Compass bearing of the original fixed bend axis, about 65.8° (east-north-east). */
export const WIND_DEFAULT_DIRECTION = (Math.atan2(LEGACY_AXIS[0], LEGACY_AXIS[1]) * 180) / Math.PI;
/** Anemometer height, in metres, that wind `speed` refers to. */
export const WIND_REFERENCE_HEIGHT = 10;
/** Power-law shear exponent over open ground: `v(z) = v₁₀ (z / 10)^(1/7)`. */
export const WIND_DEFAULT_SHEAR = 1 / 7;
/** Largest bend the speed response reaches, as a fraction of object height. */
const WIND_MAX_STRENGTH = 0.2;

/** Resolved wind for one draw. Layers and `WindEffect` both supply these. */
export type WindModuleProps = {
  /** Bend as a fraction of object height for flex 1. @default 0 */
  strength?: number;
  /** Compass bearing the wind blows toward, in degrees clockwise from north. */
  direction?: number;
  /** Fractional strength swell: strength varies within `strength × (1 ± gust)`. @default 0 */
  gust?: number;
  /** Scale of the crown flutter mode. @default 1 */
  turbulence?: number;
  /** Wind clock in seconds. @default 0 */
  time?: number;
};

type WindUniforms = {
  wave: [number, number, number, number];
  mode: [number, number, number, number];
  flutter: [number, number, number, number];
  axis: [number, number];
  strength: number;
};

/** Leaf flutter angular frequencies in rad/s: about 1 and 1.5 Hz, faster than the trunk's 0.25 Hz. */
const WIND_FLUTTER_FREQUENCIES = [6.1, 9.7] as const;

/** The moving air a wind describes, for consumers that travel with it: rain, clouds, particles. */
export type WindAirProps = {
  /** Wind speed in m/s at the 10 m reference height; null or 0 is still air. @default 0 */
  speed?: number | null;
  /** Compass bearing the wind blows toward, in degrees clockwise from north. */
  direction?: number;
  /** Fractional speed swell: speed varies within `speed × (1 ± gust)`. @default 0 */
  gust?: number;
  /** Exponent of the power-law height profile `v(z) = v₁₀ (z / 10)^shear`. @default 1/7 */
  shear?: number;
};

/** Slow strength swell in [-1, 1]: two incommensurate sines, periods of about 7.6 s and 3 s. */
export function getWindGust(time: number): number {
  return 0.6 * Math.sin(time * 0.83) + 0.4 * Math.sin(time * 2.09 + 1.3);
}

/** Closed-form `∫₀ᵗ getWindGust`, so displacement stays exact over any session length. */
export function getWindGustIntegral(time: number): number {
  return (
    (0.6 / 0.83) * (1 - Math.cos(time * 0.83)) +
    (0.4 / 2.09) * (Math.cos(1.3) - Math.cos(time * 2.09 + 1.3))
  );
}

/**
 * Vegetation bend for a wind speed: `0.025 × (speed / 5)^1.4`, capped at 0.2. 5 m/s at 10 m gives
 * TreeLayer's gentle 0.025 breeze, a 15 m/s gale about 0.12. The exponent below 2 reflects flexible
 * plants streamlining as the wind grows.
 * @param speed - Wind speed in m/s at the 10 m reference height.
 * @returns Bend as a fraction of object height, in [0, 0.2].
 */
export function getWindStrength(speed: number): number {
  if (!(speed > 0)) return 0;
  return Math.min(WIND_MAX_STRENGTH, 0.025 * (speed / 5) ** 1.4);
}

/** Speed at `height` metres on the power-law profile, before gusts. */
function getWindProfileSpeed(props: WindAirProps, height: number): number {
  const {speed = 0, shear = WIND_DEFAULT_SHEAR} = props;
  if (!(speed !== null && speed > 0 && height > 0)) return 0;
  return speed * (height / WIND_REFERENCE_HEIGHT) ** shear;
}

/** Unit `[east, north]` vector of a compass bearing. */
function getWindHeading(direction = WIND_DEFAULT_DIRECTION): [number, number] {
  const radians = (direction * Math.PI) / 180;
  return [Math.sin(radians), Math.cos(radians)];
}

/**
 * Air velocity at a height, with the gust swell that bends the trees on the same clock.
 * @param props - The wind, for example `WindEffect.props`.
 * @param height - Height above ground in metres.
 * @param time - Wind clock in seconds.
 * @returns `[east, north]` in m/s.
 */
export function getWindVelocity(props: WindAirProps, height: number, time = 0): [number, number] {
  const speed = getWindProfileSpeed(props, height) * (1 + (props.gust ?? 0) * getWindGust(time));
  const [east, north] = getWindHeading(props.direction);
  return [east * speed, north * speed];
}

/**
 * Distance the air has travelled since time 0: the exact integral of `getWindVelocity`. Rain or
 * cloud offsets built on it stay continuous through gusts, unlike `velocity × time`.
 * @param props - The wind, for example `WindEffect.props`.
 * @param height - Height above ground in metres.
 * @param time - Wind clock in seconds.
 * @returns `[east, north]` in metres.
 */
export function getWindDisplacement(
  props: WindAirProps,
  height: number,
  time = 0
): [number, number] {
  const distance =
    getWindProfileSpeed(props, height) * (time + (props.gust ?? 0) * getWindGustIntegral(time));
  const [east, north] = getWindHeading(props.direction);
  return [east * distance, north * distance];
}

/**
 * Rotate the original bend frame to `direction`. The crown mode rotates with the axis
 * (`R·M·Rᵀ`), so rotating a scene together with its wind leaves it unchanged.
 */
export function getWindUniforms(props: WindModuleProps = {}): WindUniforms {
  const {
    strength = 0,
    direction = WIND_DEFAULT_DIRECTION,
    gust = 0,
    turbulence = 1,
    time = 0
  } = props;
  // Bearings turn clockwise; the math angle turns counterclockwise.
  const angle = ((WIND_DEFAULT_DIRECTION - direction) * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [m0, m1, m2, m3] = LEGACY_MODE;
  // R·M, then (R·M)·Rᵀ, column-major.
  const rm = [c * m0 - s * m1, s * m0 + c * m1, c * m2 - s * m3, s * m2 + c * m3];
  return {
    wave: [Math.sin(time * 1.6), Math.cos(time * 1.6), Math.sin(time * 3.2), Math.cos(time * 3.2)],
    mode: [
      turbulence * (rm[0] * c - rm[2] * s),
      turbulence * (rm[1] * c - rm[3] * s),
      turbulence * (rm[0] * s + rm[2] * c),
      turbulence * (rm[1] * s + rm[3] * c)
    ],
    flutter: [
      turbulence * Math.sin(time * WIND_FLUTTER_FREQUENCIES[0]),
      turbulence * Math.cos(time * WIND_FLUTTER_FREQUENCIES[0]),
      turbulence * Math.sin(time * WIND_FLUTTER_FREQUENCIES[1]),
      turbulence * Math.cos(time * WIND_FLUTTER_FREQUENCIES[1])
    ],
    axis: [c * LEGACY_AXIS[0] - s * LEGACY_AXIS[1], s * LEGACY_AXIS[0] + c * LEGACY_AXIS[1]],
    strength: strength * (1 + gust * getWindGust(time))
  };
}

const DECLARATION = `layout(std140) uniform windUniforms {
  vec4 wave;
  vec4 mode;
  vec4 flutter;
  vec2 axis;
  float strength;
} wind;`;

/**
 * Shared wind uniforms for `splatDeform` and `splatFlutter`: the trunk and crown wave phases, the
 * crown mode (mat2 columns), the leaf flutter phases (scaled by turbulence), the bend axis and the
 * gust-modulated strength. `WindEffect` supplies its props.
 */
export const wind = {
  name: 'wind',
  vs: DECLARATION,
  source: `struct WindUniforms {
  wave: vec4<f32>,
  mode: vec4<f32>,
  flutter: vec4<f32>,
  axis: vec2<f32>,
  strength: f32
};
@group(0) @binding(auto) var<uniform> wind: WindUniforms;`,
  uniformTypes: {
    wave: 'vec4<f32>',
    mode: 'vec4<f32>',
    flutter: 'vec4<f32>',
    axis: 'vec2<f32>',
    strength: 'f32'
  },
  defaultUniforms: getWindUniforms(),
  getUniforms: getWindUniforms
} as const satisfies ShaderModule<WindModuleProps, WindUniforms>;
