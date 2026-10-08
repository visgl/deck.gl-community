// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device, Framebuffer, Texture, TextureView} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {GPUVideoResources, assertGPUVideoResources} from './gpu-video-resources';

type Appearance = {luminanceThreshold: number; staticPixelRemoval: number};
const uniforms: ShaderModule<Appearance & {slot: number}> = {
  name: 'videoAppearance',
  fs: `uniform videoAppearanceUniforms {
    float slot;
    float luminanceThreshold;
    float staticPixelRemoval;
  } videoAppearance;`,
  uniformTypes: {slot: 'f32', luminanceThreshold: 'f32', staticPixelRemoval: 'f32'}
};

/** GPU-only, premultiplied visibility pyramid. Camera changes never rebuild it. */
export class GPUVideoAppearance {
  private resources = new GPUVideoResources();
  readonly texture: Texture;
  revision = 0;
  private dirty = new Set<number>();
  private settings: Appearance | null = null;
  private model: ClipSpace;
  private views: TextureView[];
  private framebuffers: Framebuffer[];

  constructor(
    private device: Device,
    width: number,
    height: number,
    capacity: number
  ) {
    try {
      this.texture = this.resources.add(
        device.createTexture({
          id: 'volumetric-video-filtered-frames',
          dimension: '2d-array',
          format: 'rgba8unorm',
          width,
          height,
          depth: capacity,
          mipLevels: Math.floor(Math.log2(Math.max(width, height))) + 1,
          sampler: {
            minFilter: 'linear',
            magFilter: 'linear',
            mipmapFilter: 'linear',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge',
            maxAnisotropy: 4
          }
        })
      );
      this.views = Array.from({length: capacity}, (_, slot) =>
        this.resources.add(
          this.texture.createView({
            dimension: '2d',
            baseArrayLayer: slot,
            arrayLayerCount: 1,
            baseMipLevel: 0,
            mipLevelCount: 1
          })
        )
      );
      this.framebuffers = this.views.map(view =>
        this.resources.add(device.createFramebuffer({colorAttachments: [view]}))
      );
      this.model = this.resources.add(
        new ClipSpace(device, {
          id: 'volumetric-video-filter-visibility',
          modules: [uniforms],
          parameters: {depthCompare: 'always', depthWriteEnabled: false, blend: false},
          fs: `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray videoFrames;
uniform sampler2DArray pixelChanges;
out vec4 fragColor;
void main() {
  ivec3 p = ivec3(ivec2(gl_FragCoord.xy), int(videoAppearance.slot));
  vec4 color = texelFetch(videoFrames, p, 0);
  float strength = videoAppearance.staticPixelRemoval;
  if (dot(color.rgb, vec3(0.2126, 0.7152, 0.0722)) < videoAppearance.luminanceThreshold ||
      (strength > 0.0 && texelFetch(pixelChanges, p, 0).r <= 0.5 * strength * strength)) color = vec4(0.0);
  fragColor = vec4(color.rgb * color.a, color.a);
}`
        })
      );
      assertGPUVideoResources(device);
    } catch (error) {
      this.resources.destroy();
      throw error;
    }
  }

  invalidate(slot: number): void {
    this.dirty.add(slot);
  }

  update(
    frames: Texture,
    changes: Texture,
    resident: (number | undefined)[],
    settings: Appearance
  ): void {
    if (
      !this.settings ||
      settings.luminanceThreshold !== this.settings.luminanceThreshold ||
      settings.staticPixelRemoval !== this.settings.staticPixelRemoval
    ) {
      resident.forEach((frame, slot) => {
        if (frame !== undefined) this.dirty.add(slot);
      });
      this.settings = {...settings};
    }
    if (!this.dirty.size) return;
    this.model.setBindings({videoFrames: frames, pixelChanges: changes});
    for (const slot of this.dirty) {
      if (resident[slot] === undefined) continue;
      this.model.shaderInputs.setProps({videoAppearance: {...settings, slot}});
      const pass = this.device.beginRenderPass({
        framebuffer: this.framebuffers[slot],
        parameters: {viewport: [0, 0, this.texture.width, this.texture.height]}
      });
      try {
        this.model.draw(pass);
      } finally {
        pass.end();
      }
    }
    this.dirty.clear();
    this.texture.generateMipmapsWebGL();
    assertGPUVideoResources(this.device);
    this.revision++;
  }

  destroy(): void {
    this.resources.destroy();
  }
}
