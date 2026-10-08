// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device, Framebuffer, Texture, TextureView} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {GPUVideoResources, assertGPUVideoResources} from './gpu-video-resources';

const changeUniforms: ShaderModule<{slot: number; firstFrame: number}> = {
  name: 'videoChange',
  fs: `uniform videoChangeUniforms {
    float slot;
    float firstFrame;
  } videoChange;`,
  uniformTypes: {slot: 'f32', firstFrame: 'f32'}
};

/** Stores each pixel's color change from the preceding source frame on the GPU. */
export class GPUPixelChanges {
  private resources = new GPUVideoResources();
  readonly texture: Texture;
  readonly previousTexture: Texture;
  readonly previousFramebuffer: Framebuffer;
  private views: TextureView[];
  private framebuffers: Framebuffer[];
  private copyModel: ClipSpace;
  private differenceModel: ClipSpace;

  constructor(
    private device: Device,
    width: number,
    height: number,
    capacity: number
  ) {
    try {
      const sampler = {minFilter: 'nearest', magFilter: 'nearest'} as const;
      this.texture = this.resources.add(
        device.createTexture({
          id: 'volumetric-video-pixel-changes',
          dimension: '2d-array',
          format: 'rgba8unorm',
          width,
          height,
          depth: capacity,
          sampler
        })
      );
      this.views = Array.from({length: capacity}, (_, slot) =>
        this.resources.add(
          this.texture.createView({
            dimension: '2d',
            baseArrayLayer: slot,
            arrayLayerCount: 1,
            mipLevelCount: 1
          })
        )
      );
      this.framebuffers = this.views.map(view =>
        this.resources.add(device.createFramebuffer({colorAttachments: [view]}))
      );
      this.previousTexture = this.resources.add(
        device.createTexture({width, height, format: 'rgba8unorm', sampler})
      );
      this.previousFramebuffer = this.resources.add(
        device.createFramebuffer({colorAttachments: [this.previousTexture]})
      );
      const parameters = {depthCompare: 'always', depthWriteEnabled: false, blend: false} as const;
      this.copyModel = this.resources.add(
        new ClipSpace(device, {
          id: 'volumetric-video-previous-frame',
          modules: [changeUniforms],
          parameters,
          fs: `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray videoFrames;
out vec4 fragColor;
void main() {
  fragColor = texelFetch(videoFrames, ivec3(ivec2(gl_FragCoord.xy), int(videoChange.slot)), 0);
}`
        })
      );
      this.differenceModel = this.resources.add(
        new ClipSpace(device, {
          id: 'volumetric-video-frame-difference',
          modules: [changeUniforms],
          parameters,
          fs: `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray videoFrames;
uniform sampler2D previousFrame;
out vec4 fragColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 delta = abs(texelFetch(videoFrames, ivec3(p, int(videoChange.slot)), 0) - texelFetch(previousFrame, p, 0));
  float change = max(videoChange.firstFrame, max(max(delta.r, delta.g), max(delta.b, delta.a)));
  fragColor = vec4(change, 0.0, 0.0, 1.0);
}`
        })
      );
      assertGPUVideoResources(device);
    } catch (error) {
      this.resources.destroy();
      throw error;
    }
  }

  copyPrevious(frames: Texture, slot: number): void {
    this.copyModel.setBindings({videoFrames: frames});
    this.copyModel.shaderInputs.setProps({videoChange: {slot, firstFrame: 0}});
    this.draw(
      this.copyModel,
      this.previousFramebuffer,
      this.previousTexture.width,
      this.previousTexture.height
    );
  }

  update(frames: Texture, slot: number, firstFrame: boolean): void {
    this.differenceModel.setBindings({videoFrames: frames, previousFrame: this.previousTexture});
    this.differenceModel.shaderInputs.setProps({
      videoChange: {slot, firstFrame: Number(firstFrame)}
    });
    this.draw(
      this.differenceModel,
      this.framebuffers[slot],
      this.texture.width,
      this.texture.height
    );
  }

  destroy(): void {
    this.resources.destroy();
  }

  private draw(model: ClipSpace, framebuffer: Framebuffer, width: number, height: number): void {
    const pass = this.device.beginRenderPass({
      framebuffer,
      parameters: {viewport: [0, 0, width, height]}
    });
    try {
      model.draw(pass);
    } finally {
      pass.end();
    }
  }
}
