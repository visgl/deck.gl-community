// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension, type Accessor, type DefaultProps, type Layer} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL} from '../splat-layer/splat-deformation';
import {getLayerWind} from './wind-effect';
import {wind} from './wind-module';

/** Spreads default phases so neighbouring objects do not sway in step. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export type WindExtensionProps<DataT = unknown> = {
  /**
   * `[bend height in metres, phase in radians, flex]`. The bend is clamped at its full height
   * above the object's anchor. @default [10, index × golden angle, 1]
   */
  getWind?: Accessor<DataT, [number, number, number]>;
  /**
   * Where bending starts: `'instance'` from each object's anchor (meshes, columns), `'ground'` from
   * z = 0, for point clouds whose points are their own anchors. @default 'instance'
   */
  windBase?: 'instance' | 'ground';
  /** Overrides the deck's `WindEffect` strength for this layer; null follows it. @default null */
  windStrength?: number | null;
  /** Overrides the deck's `WindEffect` clock, in seconds; null follows it. @default null */
  windTime?: number | null;
};

const defaultProps: DefaultProps<WindExtensionProps> = {
  getWind: {
    type: 'accessor',
    value: (_: unknown, {index}: {index: number}) => [10, index * GOLDEN_ANGLE, 1]
  },
  windBase: 'instance',
  windStrength: null,
  windTime: null
};

/** Pack `[height, phase, flex]` as `[height, flex, sin(phase), cos(phase)]`. */
function getWindExtensionPhases([height, phase, flex]: readonly number[]): number[] {
  return [height, flex, Math.sin(phase), Math.cos(phase)];
}

// The vertex filter hook runs before the layer's own attributes are declared, so the anchor is
// copied into globals at the start of main(). Bending in common space, just before deck.gl's
// shadow module projects `geometry.position`, keeps shadows, picking and drawing on one pose.
const windExtension = {
  name: 'windExtension',
  vs: `in vec4 instanceWindExtension;
layout(std140) uniform windExtensionUniforms {
  float ground;
} windExtension;
vec3 windAnchor;
vec3 windAnchor64Low;
${SPLAT_DEFORMATION_GLSL}`,
  inject: {
    'vs:#main-start': `
  windAnchor = instancePositions;
  windAnchor64Low = instancePositions64Low;`,
    'vs:DECKGL_FILTER_GL_POSITION': {
      order: -100,
      injection: `
  if (wind.strength != 0.0) {
    vec3 windUnits = project.commonUnitsPerMeter * project_size();
    vec3 windLocal = (geometry.position.xyz - project_position(windAnchor, windAnchor64Low)) / windUnits;
    if (windExtension.ground > 0.5) windLocal = vec3(0.0, 0.0, windLocal.z + windAnchor.z);
    vec3 windBent = windLocal;
    float windSin = instanceWindExtension.z;
    float windCos = instanceWindExtension.w;
    vec2 windWave = vec2(wind.wave.x * windCos + wind.wave.y * windSin,
      wind.wave.z * (windCos * windCos - windSin * windSin) + wind.wave.w * 2.0 * windSin * windCos);
    mat3 windJacobian = splatDeform(windBent, max(instanceWindExtension.x, 0.001),
      wind.strength * instanceWindExtension.y, windWave, wind.axis, mat2(wind.mode),
      instanceWindExtension.zw, wind.branch);
    vec4 windOffset = vec4((windBent.xy - windLocal.xy) * windUnits.xy, 0.0, 0.0);
    geometry.position += windOffset;
    position += project.viewProjectionMatrix * windOffset;
    geometry.normal = normalize(splatDeformNormal(windJacobian, geometry.normal));
  }`
    }
  },
  uniformTypes: {ground: 'f32'}
} as const satisfies ShaderModule<{ground: number}>;

/**
 * Bends instanced deck.gl layers (`SimpleMeshLayer`, `ScenegraphLayer`, `ColumnLayer`,
 * `GridCellLayer`, `PointCloudLayer`) with the deck's `WindEffect`, using the same cantilever bend
 * as TreeLayer and SplatLayer. WebGL2 only: deck.gl's WGSL layers have no vertex filter hook.
 */
export class WindExtension extends LayerExtension {
  static extensionName = 'WindExtension';
  static defaultProps = defaultProps;

  getShaders(this: Layer<WindExtensionProps>): {modules?: ShaderModule[]} {
    if (this.context.device.type === 'webgpu') return {};
    return {modules: [wind, windExtension]};
  }

  initializeState(this: Layer<WindExtensionProps>) {
    this.getAttributeManager()?.addInstanced({
      instanceWindExtension: {size: 4, accessor: 'getWind', transform: getWindExtensionPhases}
    });
  }

  // Every pass, shadows included, draws with this frame's wind.
  draw(this: Layer<WindExtensionProps>) {
    const {wind: windProps, animated} = getLayerWind(
      this,
      this.props.windStrength,
      this.props.windTime
    );
    this.setShaderModuleProps({
      wind: windProps,
      windExtension: {ground: this.props.windBase === 'ground' ? 1 : 0}
    });
    if (animated) this.setNeedsRedraw();
  }
}
