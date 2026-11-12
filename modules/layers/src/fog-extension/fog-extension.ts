// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension, project} from '@deck.gl/core';
import type {Color, Layer} from '@deck.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';

export type FogExtensionProps = {
  /** Fog color in RGB values from 0 to 255. @default [192, 206, 219] */
  fogColor?: Color;
  /** Exponential extinction per meter. Zero disables fog. @default 0.001 */
  fogDensity?: number;
};

const DEFAULT_COLOR = [192, 206, 219] as const;
const DEFAULT_DENSITY = 0.001;
type FogUniforms = {color: [number, number, number]; density: number};

const fog = {
  name: 'distanceFog',
  dependencies: [project],
  uniformTypes: {color: 'vec3<f32>', density: 'f32'},
  fs: /* glsl */ `
layout(std140) uniform distanceFogUniforms {
  vec3 color;
  float density;
} distanceFog;
`,
  getUniforms({
    fogColor = DEFAULT_COLOR,
    fogDensity = DEFAULT_DENSITY
  }: FogExtensionProps): FogUniforms {
    const normalize = (value: number, fallback: number) =>
      Math.min(255, Math.max(0, Number.isFinite(value) ? value : fallback)) / 255;
    return {
      color: [
        normalize(fogColor[0], DEFAULT_COLOR[0]),
        normalize(fogColor[1], DEFAULT_COLOR[1]),
        normalize(fogColor[2], DEFAULT_COLOR[2])
      ],
      density: Number.isFinite(fogDensity) ? Math.max(0, fogDensity) : 0
    };
  },
  inject: {
    'vs:#decl': 'out vec3 distanceFogOffset;',
    'vs:DECKGL_FILTER_GL_POSITION': /* glsl */ `
  distanceFogOffset = (geometry.position.xyz - project.cameraPosition)
    / max(project_size(1.0), 1e-12);
`,
    'fs:#decl': 'in vec3 distanceFogOffset;',
    'fs:DECKGL_FILTER_COLOR': /* glsl */ `
#ifdef MODULE_PICKING
  if (picking.isActive < 0.5)
#endif
#ifdef MODULE_SHADOW
  if (!shadow.drawShadowMap)
#endif
  if (distanceFog.density > 0.0) {
    float visibility = exp(-length(distanceFogOffset) * distanceFog.density);
    color.rgb = mix(distanceFog.color, color.rgb, visibility);
  }
`
  }
} satisfies ShaderModule<FogExtensionProps, FogUniforms>;

/** Applies exponential distance fog to WebGL2 layers that use deck.gl's color hooks. */
export class FogExtension extends LayerExtension {
  static extensionName = 'FogExtension';
  static defaultProps = {
    fogColor: {type: 'color', value: DEFAULT_COLOR},
    fogDensity: {type: 'number', value: DEFAULT_DENSITY, min: 0}
  };

  getShaders(this: Layer<FogExtensionProps>) {
    return this.context.device.type === 'webgl' ? {modules: [fog]} : null;
  }

  draw(this: Layer<FogExtensionProps>) {
    if (this.context.device.type !== 'webgl') return;
    const {fogColor, fogDensity} = this.props;
    this.setShaderModuleProps({distanceFog: {fogColor, fogDensity}});
  }
}
