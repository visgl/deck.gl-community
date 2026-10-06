// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Device, Framebuffer, Texture} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';

const FILTER_UNIFORMS = {
  name: 'groundShadow',
  uniformTypes: {plane: 'vec4<f32>', step: 'vec2<f32>'},
  fs: `uniform groundShadowUniforms {
    vec4 plane;
    vec2 step;
  } groundShadow;`
} as const;

// Separable nine-tap Gaussian, collapsed to five bilinear texture lookups.
// The horizontal pass compares native depths; the vertical pass filters coverage.
export const GROUND_SHADOW_FILTER = `
  float getCoverage(vec2 point) {
    if (any(lessThanEqual(point, vec2(0.0))) || any(greaterThanEqual(point, vec2(1.0)))) return 0.0;
    float depth = dot(groundShadow.plane.xyz, vec3(point, 1.0)) - groundShadow.plane.w;
    if (depth <= 0.0 || depth >= 1.0) return 0.0;
    return 1.0 - texture(depthMap, vec3(point, depth));
  }
  void main() {
    float result = getCoverage(uv) * 0.227027;
    result += (getCoverage(uv + groundShadow.step * 1.384615) + getCoverage(uv - groundShadow.step * 1.384615)) * 0.316216;
    result += (getCoverage(uv + groundShadow.step * 3.230769) + getCoverage(uv - groundShadow.step * 3.230769)) * 0.070270;
    color = vec4(result, 0.0, 0.0, 1.0);
  }`;

const VERTICAL_FILTER = `
  void main() {
    float result = texture(coverageMap, uv).r * 0.227027;
    result += (texture(coverageMap, uv + groundShadow.step * 1.384615).r + texture(coverageMap, uv - groundShadow.step * 1.384615).r) * 0.316216;
    result += (texture(coverageMap, uv + groundShadow.step * 3.230769).r + texture(coverageMap, uv - groundShadow.step * 3.230769).r) * 0.070270;
    color = vec4(result, 0.0, 0.0, 1.0);
  }`;

/** Filter planar ground coverage once per light, rather than at every screen pixel. */
export class GroundShadowFilter {
  ready = false;
  private readonly targets: Framebuffer[];
  private readonly models: ClipSpace[];

  constructor(private readonly device: Device) {
    const makeTexture = () =>
      device.createTexture({
        format: 'rgba8unorm',
        width: 1,
        height: 1,
        sampler: {
          minFilter: 'linear',
          magFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        }
      });
    this.targets = [makeTexture(), makeTexture()].map(texture =>
      device.createFramebuffer({colorAttachments: [texture]})
    );
    this.models = [
      new ClipSpace(device, {
        id: 'ground-shadow-horizontal',
        modules: [FILTER_UNIFORMS],
        fs: `#version 300 es
          precision highp float;
          uniform highp sampler2DShadow depthMap;
          in vec2 uv;
          out vec4 color;
          ${GROUND_SHADOW_FILTER}`,
        parameters: {depthWriteEnabled: false, depthCompare: 'always', blend: false}
      }),
      new ClipSpace(device, {
        id: 'ground-shadow-vertical',
        modules: [FILTER_UNIFORMS],
        fs: `#version 300 es
          precision highp float;
          uniform sampler2D coverageMap;
          in vec2 uv;
          out vec4 color;
          ${VERTICAL_FILTER}`,
        parameters: {depthWriteEnabled: false, depthCompare: 'always', blend: false}
      })
    ];
  }

  get map(): Texture {
    return this.targets[1].colorAttachments[0].texture;
  }

  render(depth: Texture, plane: [number, number, number, number], step: [number, number]) {
    this.ready = false;
    const width = Math.max(1, Math.ceil(depth.width / 2));
    const height = Math.max(1, Math.ceil(depth.height / 2));
    for (const target of this.targets) {
      if (target.width !== width || target.height !== height) {
        const previous = target.colorAttachments[0].texture;
        target.resize({width, height});
        previous.destroy();
      }
    }
    for (const [index, model] of this.models.entries()) {
      model.setBindings(
        index === 0 ? {depthMap: depth} : {coverageMap: this.targets[0].colorAttachments[0].texture}
      );
      model.shaderInputs.setProps({
        groundShadow: {plane, step: index === 0 ? [step[0], 0] : [0, step[1]]}
      });
      const pass = this.device.beginRenderPass({
        framebuffer: this.targets[index],
        parameters: {viewport: [0, 0, width, height]},
        clearColor: [0, 0, 0, 0]
      });
      const drawn = model.draw(pass);
      pass.end();
      if (!drawn) return;
    }
    this.ready = true;
  }

  destroy() {
    for (const model of this.models) model.destroy();
    for (const target of this.targets) {
      const texture = target.colorAttachments[0].texture;
      target.destroy();
      texture.destroy();
    }
  }
}
