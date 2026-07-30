// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Layer,
  project32,
  type Color,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';

import type {GpuParticleSimulation} from './gpu-particle-simulation';

type GpuParticlePointLayerProps = LayerProps & {
  simulation: GpuParticleSimulation;
  color?: Color;
  pointRadiusPixels?: number;
};

type GpuParticlePointUniforms = {
  color: [number, number, number, number];
  pointSize: number;
};

const gpuParticlePointUniforms = {
  name: 'windParticlePoint',
  source: /* wgsl */ `
struct WindParticlePointUniforms {
  color: vec4<f32>,
  pointSize: f32,
};

@group(0) @binding(auto) var<uniform> windParticlePoint: WindParticlePointUniforms;
`,
  vs: `layout(std140) uniform windParticlePointUniforms {
  vec4 color;
  float pointSize;
} windParticlePoint;`,
  uniformTypes: {color: 'vec4<f32>', pointSize: 'f32'}
} as const satisfies ShaderModule<GpuParticlePointUniforms>;

const POINT_VERTEX_SHADER = `#version 300 es
#define SHADER_NAME wind-particle-point-vertex
precision highp float;

in vec4 particlePosition;
out vec4 particleColor;

void main() {
  float fadeIn = smoothstep(0.0, 16.0, particlePosition.w);
  float fadeOut = 1.0 - smoothstep(152.0, 180.0, particlePosition.w);
  particleColor = vec4(
    windParticlePoint.color.rgb,
    windParticlePoint.color.a * fadeIn * fadeOut
  );
  gl_Position = project_position_to_clipspace(particlePosition.xyz, vec3(0.0), vec3(0.0));
  gl_PointSize = max(1.0, windParticlePoint.pointSize);
}`;

const POINT_FRAGMENT_SHADER = `#version 300 es
#define SHADER_NAME wind-particle-point-fragment
precision highp float;

in vec4 particleColor;
out vec4 fragColor;

void main() {
  vec2 offset = gl_PointCoord - vec2(0.5);
  float radius = length(offset);
  if (radius > 0.5 || particleColor.a <= 0.0) {
    discard;
  }
  float edge = 1.0 - smoothstep(0.32, 0.5, radius);
  fragColor = vec4(particleColor.rgb, particleColor.a * edge);
}`;

const POINT_WEBGPU_SHADER = /* wgsl */ `
struct WindParticlePointVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vertexMain(@location(0) particlePosition: vec4<f32>) -> WindParticlePointVaryings {
  let fadeIn = smoothstep(0.0, 16.0, particlePosition.w);
  let fadeOut = 1.0 - smoothstep(152.0, 180.0, particlePosition.w);
  let projected = project_position_to_clipspace_and_commonspace(
    particlePosition.xyz,
    vec3<f32>(0.0),
    vec3<f32>(0.0)
  );

  var varyings: WindParticlePointVaryings;
  varyings.position = projected.clipPosition;
  varyings.color = vec4<f32>(
    windParticlePoint.color.rgb,
    windParticlePoint.color.a * fadeIn * fadeOut * layer.opacity
  );
  return varyings;
}

@fragment
fn fragmentMain(varyings: WindParticlePointVaryings) -> @location(0) vec4<f32> {
  return varyings.color;
}
`;

const defaultProps: DefaultProps<GpuParticlePointLayerProps> = {
  simulation: {type: 'object', value: undefined!},
  color: [237, 247, 255, 46],
  pointRadiusPixels: 1
};

/**
 * Draws one GPU vertex per simulated particle, matching the historical WebGL showcase.
 *
 * @remarks
 * This is an internal dual-backend rendering primitive. Applications should construct
 * {@link ParticleLayer} rather than importing this implementation detail.
 *
 * @internal
 */
export class GpuParticlePointLayer extends Layer<Required<GpuParticlePointLayerProps>> {
  static layerName = 'GpuParticlePointLayer';
  static defaultProps: DefaultProps<GpuParticlePointLayerProps> = defaultProps;

  declare state: {model?: Model};

  getShaders() {
    return super.getShaders({
      source: POINT_WEBGPU_SHADER,
      vs: POINT_VERTEX_SHADER,
      fs: POINT_FRAGMENT_SHADER,
      modules: [project32, gpuParticlePointUniforms]
    });
  }

  initializeState(): void {
    const {simulation} = this.props;
    const model = new Model(this.context.device, {
      ...this.getShaders(),
      id: `${this.props.id}-model`,
      topology: 'point-list',
      vertexCount: simulation.particleCount,
      bufferLayout: [{name: 'particlePosition', format: 'float32x4'}],
      parameters: {depthWriteEnabled: false}
    });
    // Bind shared simulation storage after construction: Model-owned geometry must never
    // take ownership of or destroy the particle simulation's ping-pong buffers.
    model.setAttributes({particlePosition: simulation.targetBuffer});
    this.setState({model});
  }

  updateState(parameters: UpdateParameters<this>): void {
    super.updateState(parameters);
    const {model} = this.state;
    if (!model) {
      return;
    }

    const {simulation} = this.props;
    model.setVertexCount(simulation.particleCount);
    model.setAttributes({particlePosition: simulation.targetBuffer});
  }

  draw(): void {
    const {model} = this.state;
    if (!model) {
      return;
    }

    const {simulation, color, pointRadiusPixels} = this.props;
    model.setAttributes({particlePosition: simulation.targetBuffer});
    model.shaderInputs.setProps({
      windParticlePoint: {
        color: [color[0] / 255, color[1] / 255, color[2] / 255, (color[3] ?? 255) / 255],
        pointSize: Math.max(1, pointRadiusPixels * 2)
      } satisfies GpuParticlePointUniforms
    });
    model.draw(this.context.renderPass);
  }
}
