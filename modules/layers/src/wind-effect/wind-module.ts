// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shadertools';

/** Bend axis and crown mode (mat2 columns) of the original fixed wind, in the world frame. */
const LEGACY_AXIS = [1, 0.45] as const;
const LEGACY_MODE = [0.65, -0.25, 0.3, 0.8] as const;

/** Compass bearing of the original fixed bend axis, about 65.8° (east-north-east). */
export const WIND_DEFAULT_DIRECTION = (Math.atan2(LEGACY_AXIS[0], LEGACY_AXIS[1]) * 180) / Math.PI;

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
  axis: [number, number];
  strength: number;
};

/** Slow strength swell in [-1, 1]: two incommensurate sines, periods of about 7.6 s and 3 s. */
export function getWindGust(time: number): number {
  return 0.6 * Math.sin(time * 0.83) + 0.4 * Math.sin(time * 2.09 + 1.3);
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
    axis: [c * LEGACY_AXIS[0] - s * LEGACY_AXIS[1], s * LEGACY_AXIS[0] + c * LEGACY_AXIS[1]],
    strength: strength * (1 + gust * getWindGust(time))
  };
}

const DECLARATION = `layout(std140) uniform windUniforms {
  vec4 wave;
  vec4 mode;
  vec2 axis;
  float strength;
} wind;`;

/**
 * Shared wind uniforms for `splatDeform`: the wave phases, the bend axis, the crown mode
 * (mat2 columns) and the gust-modulated strength. `WindEffect` supplies its props.
 */
export const wind = {
  name: 'wind',
  vs: DECLARATION,
  source: `struct WindUniforms {
  wave: vec4<f32>,
  mode: vec4<f32>,
  axis: vec2<f32>,
  strength: f32
};
@group(0) @binding(auto) var<uniform> wind: WindUniforms;`,
  uniformTypes: {
    wave: 'vec4<f32>',
    mode: 'vec4<f32>',
    axis: 'vec2<f32>',
    strength: 'f32'
  },
  defaultUniforms: getWindUniforms(),
  getUniforms: getWindUniforms
} as const satisfies ShaderModule<WindModuleProps, WindUniforms>;
