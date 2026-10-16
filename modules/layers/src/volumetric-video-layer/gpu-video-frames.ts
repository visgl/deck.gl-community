// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Texture, type Device, type Framebuffer, type TextureView} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {GPUVideoResources, assertGPUVideoResources} from './gpu-video-resources';
import type {VideoSample} from 'mediabunny';
import {getFrameSize, type FrameWindow} from './frame-utils';
import {GPUVideoAppearance} from './gpu-video-appearance';
import {GPUPixelChanges} from './gpu-pixel-changes';
import type {VideoFrameSource} from './video-frame-source';

const copyUniforms: ShaderModule<{rotation: number; flip: number}> = {
  name: 'videoCopy',
  source: /* wgsl */ `
struct VideoCopyUniforms {
  rotation: f32,
  flip: f32,
};
@group(0) @binding(auto) var<uniform> videoCopy: VideoCopyUniforms;
`,
  fs: `uniform videoCopyUniforms {
  float rotation;
  float flip;
} videoCopy;`,
  uniformTypes: {rotation: 'f32', flip: 'f32'}
};

/** Bounded luma texture array with a latest-request-wins decode queue. */
export class GPUVideoFrames {
  private resources = new GPUVideoResources();
  readonly texture: Texture;
  readonly changes: GPUPixelChanges;
  readonly appearance: GPUVideoAppearance;
  /** Lazily allocated unmasked mip pyramid for the selected frame. */
  currentAppearance: GPUVideoAppearance | null = null;
  readonly width: number;
  readonly height: number;
  readonly capacity: number;
  readonly resident: (number | undefined)[];
  readyWindow: FrameWindow | null = null;
  private desiredWindow: FrameWindow | null = null;
  private destroyed = false;
  private processing = false;
  private uploadTexture?: Texture;
  private copyModel: ClipSpace;
  private framebuffers: Framebuffer[];
  private views: TextureView[];
  private referenceFrame: number | undefined;

  constructor(
    private device: Device,
    private source: VideoFrameSource,
    resolution: number,
    capacity: number,
    private onReady: (window: FrameWindow) => void,
    private onError: (error: Error) => void
  ) {
    try {
      const info = source.info!;
      const size = getFrameSize(info.width, info.height, resolution);
      this.width = size.width;
      this.height = size.height;
      this.capacity = capacity;
      this.resident = new Array(capacity);
      this.appearance = this.resources.add(
        new GPUVideoAppearance(device, this.width, this.height, capacity)
      );
      this.changes = this.resources.add(
        new GPUPixelChanges(device, this.width, this.height, capacity)
      );
      this.texture = this.resources.add(
        device.createTexture({
          id: 'volumetric-video-frames',
          dimension: '2d-array',
          format: 'rgba8unorm',
          width: this.width,
          height: this.height,
          depth: capacity,
          // Keep the normalized frame ring inspectable on WebGPU as well as WebGL.
          // This is useful for exact orientation checks and future frame exports.
          usage: Texture.SAMPLE | Texture.RENDER | Texture.COPY_DST | Texture.COPY_SRC,
          sampler: {
            minFilter: 'nearest',
            magFilter: 'nearest',
            addressModeU: 'clamp-to-edge',
            addressModeV: 'clamp-to-edge'
          }
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
      this.copyModel = this.resources.add(
        new ClipSpace(device, {
          id: 'volumetric-video-resample',
          modules: [copyUniforms],
          parameters: {depthWriteEnabled: false, blend: false},
          source: /* wgsl */ `
@group(0) @binding(auto) var videoTexture: texture_2d<f32>;
@group(0) @binding(auto) var videoTextureSampler: sampler;
@fragment
fn fragmentMain(input: FragmentInputs) -> @location(0) vec4<f32> {
  // WebGPU external images and texture reads use top-left coordinates, while
  // ClipSpace interpolates its UVs from the bottom edge. Normalize once here so
  // the volume shaders can use native WebGPU texture coordinates.
  var p = vec2<f32>(input.uv.x, 1.0 - input.uv.y);
  if (videoCopy.flip > 0.5) { p.x = 1.0 - p.x; }
  if (videoCopy.rotation == 90.0) { p = vec2<f32>(p.y, 1.0 - p.x); }
  else if (videoCopy.rotation == 180.0) { p = vec2<f32>(1.0) - p; }
  else if (videoCopy.rotation == 270.0) { p = vec2<f32>(1.0 - p.y, p.x); }
  return textureSample(videoTexture, videoTextureSampler, p);
}
`,
          fs: `#version 300 es
precision highp float;
uniform sampler2D videoTexture;
in vec2 uv;
out vec4 fragColor;
void main() {
  vec2 p = uv;
  if (videoCopy.flip > 0.5) p.x = 1.0 - p.x;
  if (videoCopy.rotation == 90.0) p = vec2(p.y, 1.0 - p.x);
  else if (videoCopy.rotation == 180.0) p = 1.0 - p;
  else if (videoCopy.rotation == 270.0) p = vec2(1.0 - p.y, p.x);
  fragColor = texture(videoTexture, p);
}`
        })
      );
      assertGPUVideoResources(device);
    } catch (error) {
      this.resources.destroy();
      throw error;
    }
  }

  request(window: FrameWindow): void {
    this.desiredWindow = window;
    if (!this.processing && !this.destroyed) {
      void this.processFrames();
    }
  }

  /** Never expose a ring slot that has been overwritten with a different frame. */
  getReadyWindow(): FrameWindow | null {
    const desired = this.desiredWindow;
    if (desired) {
      let complete = true;
      for (let frame = desired.firstFrame; frame <= desired.currentFrame; frame++) {
        if (this.resident[frame % this.capacity] !== frame) {
          complete = false;
          break;
        }
      }
      // Uploads are synchronous GPU commands. The decoder may still be closing
      // its iterator, but a complete requested window is already safe to render.
      if (complete) return desired;
    }
    const window = this.readyWindow;
    if (!window) return null;
    // A forward upload can overwrite the oldest slot before the decoder yields
    // completion. Keep the still-resident suffix visible instead of blanking the volume.
    if (this.resident[window.currentFrame % this.capacity] !== window.currentFrame) return null;
    let firstFrame = window.currentFrame;
    while (
      firstFrame > window.firstFrame &&
      this.resident[(firstFrame - 1) % this.capacity] === firstFrame - 1
    )
      firstFrame--;
    return {
      firstFrame,
      currentFrame: window.currentFrame,
      frameCount: window.currentFrame - firstFrame + 1
    };
  }

  destroy(): void {
    this.destroyed = true;
    this.desiredWindow = null;
    // The frame queue may contain an upload or filtering pass when a source is
    // replaced. WebGPU validates resource lifetime at submission, so flush the
    // default encoder before releasing the textures and geometry it references.
    if (this.device.type === 'webgpu' && !this.device.isLost) this.device.submit();
    this.resources.destroy();
    this.uploadTexture?.destroy();
  }

  /** Allocates the selected-frame pyramid only when static removal needs it. */
  getCurrentAppearance(): GPUVideoAppearance {
    if (!this.currentAppearance) {
      this.currentAppearance = this.resources.add(
        new GPUVideoAppearance(this.device, this.width, this.height, 1)
      );
    }
    return this.currentAppearance;
  }

  private async processFrames(): Promise<void> {
    this.processing = true;
    let window: FrameWindow | null = null;
    try {
      while (this.desiredWindow && !this.destroyed) {
        window = this.desiredWindow;
        const missing: number[] = [];
        for (let frame = window.firstFrame; frame <= window.currentFrame; frame++) {
          if (this.resident[frame % this.capacity] !== frame) missing.push(frame);
        }
        const jobs: {frame: number; reference: boolean}[] = [];
        for (let i = 0; i < missing.length; i++) {
          const frame = missing[i];
          // A disjoint seek needs the actual source predecessor, even outside the trail.
          if (
            frame > 0 &&
            missing[i - 1] !== frame - 1 &&
            this.referenceFrame !== frame - 1 &&
            this.resident[(frame - 1) % this.capacity] !== frame - 1
          )
            jobs.push({frame: frame - 1, reference: true});
          jobs.push({frame, reference: false});
        }
        const timestamps = jobs.map(job => this.source.info!.frameTimestamps[job.frame]);
        let index = 0;
        for await (const sample of this.source.sink!.samplesAtTimestamps(timestamps)) {
          if (this.destroyed || this.desiredWindow !== window) {
            sample?.close();
            break;
          }
          if (!sample) throw new Error('The requested video frame could not be decoded.');
          try {
            const job = jobs[index++];
            if (!job.reference && job.frame > 0 && this.referenceFrame !== job.frame - 1) {
              this.referenceFrame = undefined;
              this.changes.copyPrevious(this.texture, (job.frame - 1) % this.capacity);
              assertGPUVideoResources(this.device);
              this.referenceFrame = job.frame - 1;
            }
            this.uploadFrame(sample, job.frame, job.reference);
          } finally {
            sample.close();
          }
        }
        if (this.desiredWindow === window && !this.destroyed) {
          this.readyWindow = window;
          this.desiredWindow = null;
          this.onReady(window);
        }
      }
    } catch (error) {
      // A superseded iterator may fail after the newest seek has been queued.
      // Only its own request can be failed; the latest window must still run.
      if (
        this.desiredWindow === window ||
        (this.desiredWindow === null && this.readyWindow === window)
      ) {
        this.desiredWindow = null;
        if (!this.destroyed && !this.source.destroyed)
          this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      this.processing = false;
      if (this.desiredWindow && !this.destroyed) void this.processFrames();
    }
  }

  private uploadFrame(sample: VideoSample, frameIndex: number, reference: boolean): void {
    const frame = sample.toVideoFrame();
    try {
      const {displayWidth: width, displayHeight: height} = frame;
      if (
        !this.uploadTexture ||
        this.uploadTexture.width !== width ||
        this.uploadTexture.height !== height
      ) {
        // Retain the prior texture until replacement allocation succeeds. A decoder
        // can return a later frame at a different display size; if its allocation
        // fails, a subsequent frame with the prior dimensions must still be uploadable.
        const uploadTexture = this.device.createTexture({
          width,
          height,
          format: 'rgba8unorm',
          sampler: {minFilter: 'linear', magFilter: 'linear'}
        });
        this.uploadTexture?.destroy();
        this.uploadTexture = uploadTexture;
      }
      this.uploadTexture.copyExternalImage({image: frame, width, height, depth: 1});
      this.copyModel.setBindings({videoTexture: this.uploadTexture});
      this.copyModel.shaderInputs.setProps({
        videoCopy: {rotation: sample.rotation, flip: Number(sample.flip)}
      });
      const slot = frameIndex % this.capacity;
      // Revoke ownership before any pass can overwrite pixels belonging to an old frame.
      if (reference) this.referenceFrame = undefined;
      else {
        this.resident[slot] = undefined;
        this.appearance.invalidate(slot);
        // The one-layer selected-frame pyramid may be sourcing this ring slot.
        // Mark it stale now; the layer only regenerates it when the selected frame changes.
        this.currentAppearance?.invalidate(0);
      }
      const pass = this.device.beginRenderPass({
        framebuffer: reference ? this.changes.previousFramebuffer : this.framebuffers[slot],
        clearColor: [0, 0, 0, 0],
        parameters: {viewport: [0, 0, this.width, this.height]}
      });
      try {
        if (!this.copyModel.draw(pass)) throw new Error('The GPU could not copy this video frame.');
      } finally {
        pass.end();
      }
      if (!reference) {
        this.changes.update(this.texture, slot, frameIndex === 0);
        this.referenceFrame = undefined;
        this.changes.copyPrevious(this.texture, slot);
      }
      assertGPUVideoResources(this.device);
      if (!reference) this.resident[slot] = frameIndex;
      this.referenceFrame = frameIndex;
    } finally {
      frame.close();
    }
  }
}
