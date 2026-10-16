// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {Deck, OrbitView} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/webgpu';
import {ClipSpace} from '@luma.gl/engine';
import {VideoSample} from 'mediabunny';
import {requireWebGPUAdapter} from '../webgpu-test-utils';
import {getFrameHistoryBytes, getFrameWindow} from '../../src/volumetric-video-layer/frame-utils';
import {GPUPixelChanges} from '../../src/volumetric-video-layer/gpu-pixel-changes';
import {GPUVideoFrames} from '../../src/volumetric-video-layer/gpu-video-frames';
import {GPUVideoAppearance} from '../../src/volumetric-video-layer/gpu-video-appearance';
import {VideoFrameSource} from '../../src/volumetric-video-layer/video-frame-source';
import {VolumetricVideoLayer} from '../../src/volumetric-video-layer/volumetric-video-layer';

const MP4_URL = new URL('../../../../examples/layers/volumetric-video/sample.mp4', import.meta.url)
  .href;
const MOV_URL = new URL('./sample.mov', import.meta.url).href;

type NativeGpuError = {error?: {message?: string}};
type NativeGpuDevice = {
  addEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
  removeEventListener: (type: 'uncapturederror', listener: (event: NativeGpuError) => void) => void;
};

async function createDevice(): Promise<Device> {
  return luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {width: 320, height: 240}
  });
}

function readFrame(cache: GPUVideoFrames, frame: number): Uint8Array {
  const data = cache.texture.readDataSyncWebGL({z: frame % cache.capacity, depthOrArrayLayers: 1});
  return ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
}

async function readWebGPUFrame(
  device: Device,
  cache: GPUVideoFrames,
  frame: number
): Promise<Uint8Array> {
  // GPUVideoFrames records its resample pass through luma's default encoder.
  // Submit it before issuing the native texture-to-buffer readback.
  device.submit();
  const layout = cache.texture.computeMemoryLayout({
    z: frame % cache.capacity,
    depthOrArrayLayers: 1
  });
  const buffer = device.createBuffer({
    byteLength: layout.byteLength,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    cache.texture.readBuffer({z: frame % cache.capacity, depthOrArrayLayers: 1}, buffer);
    const data = new Uint8Array(await buffer.readAsync());
    const pixels = new Uint8Array(cache.width * cache.height * 4);
    for (let y = 0; y < cache.height; y++) {
      const source = y * layout.bytesPerRow;
      // WebGPU texture-to-buffer copies use a top-left origin, matching canvas
      // image data and the texture coordinates used by the WebGPU volume shaders.
      pixels.set(data.subarray(source, source + cache.width * 4), y * cache.width * 4);
    }
    return pixels;
  } finally {
    buffer.destroy();
  }
}

function countColor(pixels: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 20) count++;
  return count;
}

describe('VolumetricVideoLayer GPU pipeline', () => {
  it('detects per-pixel changes and preserves unchanged neighbors at odd grid edges', async () => {
    const device = await createDevice();
    try {
      for (const [width, height] of [
        [1, 1],
        [5, 3],
        [65, 33]
      ]) {
        const texture = device.createTexture({
          dimension: '2d-array',
          format: 'rgba8unorm',
          width,
          height,
          depth: 4
        });
        const changes = new GPUPixelChanges(device, width, height, 4);
        try {
          const baseline = new Uint8Array(width * height * 4).fill(64);
          for (let i = 3; i < baseline.length; i += 4) baseline[i] = 255;
          const tiny = baseline.slice();
          tiny[tiny.length - 3] = 65;
          const large = tiny.slice();
          large[large.length - 2] = 194;
          [baseline, baseline, tiny, large].forEach((data, z) =>
            texture.writeData(data, {z, depthOrArrayLayers: 1})
          );
          changes.update(texture, 0, true);
          for (let slot = 1; slot < 4; slot++) {
            changes.copyPrevious(texture, slot - 1);
            changes.update(texture, slot, false);
          }
          const scores = Array.from({length: 4}, (_, z) => {
            const data = changes.texture.readDataSyncWebGL({z, depthOrArrayLayers: 1});
            return (
              ArrayBuffer.isView(data)
                ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
                : new Uint8Array(data)
            ).filter((_, i) => i % 4 === 0);
          });
          expect(scores[0]).toEqual(new Uint8Array(width * height).fill(255));
          expect(scores[1]).toEqual(new Uint8Array(width * height));
          const expectedTiny = new Uint8Array(width * height);
          expectedTiny[expectedTiny.length - 1] = 1;
          expect(scores[2]).toEqual(expectedTiny);
          const expectedLarge = expectedTiny.slice();
          expectedLarge[expectedLarge.length - 1] = 130;
          expect(scores[3]).toEqual(expectedLarge);
        } finally {
          changes.destroy();
          texture.destroy();
        }
        expect(changes.texture.destroyed).toBe(true);
        expect(changes.previousTexture.destroyed).toBe(true);
      }
    } finally {
      device.destroy();
    }
  });

  it('indexes and decodes real MP4 and MOV blobs in presentation order', async () => {
    for (const url of [MP4_URL, MOV_URL]) {
      const blob = await (await fetch(url)).blob();
      const source = new VideoFrameSource(blob);
      try {
        const info = await source.initialize();
        expect(info.width).toBe(320);
        expect(info.height).toBe(180);
        expect(info.frameCount).toBeGreaterThan(10);
        expect(info.frameTimestamps[1]).toBeCloseTo(1 / 30, 5);
        expect([...info.frameTimestamps].sort((a, b) => a - b)).toEqual(info.frameTimestamps);
        const sample = await source.sink!.getSample(info.frameTimestamps[5]);
        expect(sample?.timestamp).toBeCloseTo(info.frameTimestamps[5], 5);
        sample?.close();
      } finally {
        source.destroy();
      }
      expect(source.destroyed).toBe(true);
    }
  });

  it('reuses a bounded GPU ring and recovers exact frames after backward scrubbing', async () => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    try {
      await source.initialize();
      let resolve: () => void;
      let reject: (error: Error) => void;
      cache = new GPUVideoFrames(
        device,
        source,
        64,
        8,
        () => resolve(),
        error => reject(error)
      );
      const request = (currentFrame: number, frameTrail: number) =>
        new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
          cache!.request(
            getFrameWindow(currentFrame, frameTrail, source.info!.frameCount, cache!.capacity)
          );
        });
      await request(7, 7);
      const original = readFrame(cache, 0);
      expect(countColor(original)).toBeGreaterThan(5);
      const texture = cache.texture;
      await request(88, 999);
      expect(cache.getReadyWindow()).toEqual({firstFrame: 81, currentFrame: 88, frameCount: 8});
      expect(readFrame(cache, 88)).not.toEqual(original);
      const readChange = (frame: number) => {
        const data = cache!.changes.texture.readDataSyncWebGL({
          z: frame % cache!.capacity,
          depthOrArrayLayers: 1
        });
        return ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
      };
      const originalChange = readChange(88);
      cache.resident[81 % cache.capacity] = undefined;
      expect(cache.getReadyWindow()).toEqual({firstFrame: 82, currentFrame: 88, frameCount: 7});
      cache.resident[81 % cache.capacity] = 81;
      await request(0, 0);
      expect(cache.getReadyWindow()).toEqual({firstFrame: 0, currentFrame: 0, frameCount: 1});
      expect(readFrame(cache, 0)).toEqual(original);
      expect(cache.texture).toBe(texture);
      await request(88, 0);
      expect(readChange(88)).toEqual(originalChange);
      await request(87, 0);
      await request(88, 0);
      expect(readChange(88)).toEqual(originalChange);
      cache.destroy();
      cache = new GPUVideoFrames(
        device,
        source,
        64,
        1,
        () => resolve(),
        error => reject(error)
      );
      await request(30, 0);
      let release: () => void;
      let uploaded: () => void;
      const closing = new Promise<void>(res => {
        release = res;
      });
      const upload = new Promise<void>(res => {
        uploaded = res;
      });
      const decode = source.sink!.samplesAtTimestamps.bind(source.sink!);
      const decoder = vi
        .spyOn(source.sink!, 'samplesAtTimestamps')
        .mockImplementation(async function* (timestamps) {
          for await (const sample of decode(timestamps)) yield sample;
          uploaded!();
          await closing;
        });
      try {
        const ready = request(31, 0);
        await upload;
        expect(cache.getReadyWindow()).toEqual({firstFrame: 31, currentFrame: 31, frameCount: 1});
        release!();
        await ready;
      } finally {
        release!();
        decoder.mockRestore();
      }
    } finally {
      cache?.destroy();
      source.destroy();
      device.destroy();
    }
  });

  // Value: protects=rapid scrubbing survives errors from superseded decode requests;
  // fails_when=a stale null sample or iterator rejection clears the newest desired window;
  // why_new=existing reverse seeks complete each decode before the next request; seam=none
  it.each([
    'null',
    'rejection'
  ])('keeps the latest seek after a superseded decoder %s', async failure => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    let reference: GPUVideoFrames | undefined;
    let release: (() => void) | undefined;
    try {
      await source.initialize();
      const ready = vi.fn();
      const errors = vi.fn();
      cache = new GPUVideoFrames(device, source, 32, 3, ready, errors);
      const latest = getFrameWindow(88, 2, source.info!.frameCount, 3);
      const sink = source.sink!;
      const decode = sink.samplesAtTimestamps.bind(sink);
      let started: () => void;
      const active = new Promise<void>(resolve => {
        started = resolve;
      });
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      let calls = 0;
      const decoder = vi
        .spyOn(sink, 'samplesAtTimestamps')
        .mockImplementation(async function* (timestamps) {
          if (calls++ === 0) {
            started!();
            await gate;
            if (failure === 'rejection') throw new Error('Superseded decode failed');
            yield null;
            return;
          }
          yield* decode(timestamps);
        });
      cache.request(getFrameWindow(30, 2, source.info!.frameCount, 3));
      await active;
      cache.request(latest);
      release!();
      // getReadyWindow returns a complete resident window before the decoder closes
      // its iterator and invokes onReady. Wait for both observable completion signals.
      await vi.waitFor(
        () => {
          expect(cache!.getReadyWindow()).toEqual(latest);
          expect(ready).toHaveBeenCalledExactlyOnceWith(latest);
        },
        {timeout: 2000}
      );
      expect(errors).not.toHaveBeenCalled();
      decoder.mockRestore();
      await new Promise<void>((resolve, reject) => {
        reference = new GPUVideoFrames(device, source, 32, 3, () => resolve(), reject);
        reference.request(latest);
      });
      for (let frame = latest.firstFrame; frame <= latest.currentFrame; frame++) {
        expect(readFrame(cache, frame)).toEqual(readFrame(reference!, frame));
        expect(
          cache.changes.texture.readDataSyncWebGL({z: frame % 3, depthOrArrayLayers: 1})
        ).toEqual(
          reference!.changes.texture.readDataSyncWebGL({z: frame % 3, depthOrArrayLayers: 1})
        );
      }
    } finally {
      release?.();
      vi.restoreAllMocks();
      cache?.destroy();
      reference?.destroy();
      source.destroy();
      device.destroy();
    }
  });

  // Value: protects=failed GPU overwrites never expose new pixels as an older resident frame;
  // fails_when=slot/reference ownership is committed before all GPU passes are validated;
  // why_new=decoder failures do not interrupt an upload after the raw texture has changed; seam=none
  it.each([
    'changes',
    'predecessor',
    'validation',
    'copy skipped',
    'changes skipped',
    'predecessor skipped'
  ])('invalidates overwritten history and retries exact pixels after a %s failure', async failure => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    let reference: GPUVideoFrames | undefined;
    try {
      await source.initialize();
      let resolve: () => void;
      let reject: (error: Error) => void;
      cache = new GPUVideoFrames(
        device,
        source,
        32,
        3,
        () => resolve(),
        error => reject(error)
      );
      const request = (frame: number, trail: number) =>
        new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
          cache!.request(getFrameWindow(frame, trail, source.info!.frameCount, 3));
        });
      await request(33, 2);
      const original = readFrame(cache, 31).slice();
      const originalChange = cache.changes.texture.readDataSyncWebGL({z: 1, depthOrArrayLayers: 1});
      cache.appearance.update(cache.texture, cache.changes.texture, cache.resident, {
        luminanceThreshold: 0,
        staticPixelRemoval: 0
      });
      if (failure.endsWith('skipped')) {
        const id =
          failure === 'copy skipped'
            ? 'volumetric-video-resample'
            : failure === 'changes skipped'
              ? 'volumetric-video-frame-difference'
              : 'volumetric-video-previous-frame';
        const draw = ClipSpace.prototype.draw;
        let skipped = false;
        vi.spyOn(ClipSpace.prototype, 'draw').mockImplementation(function (
          this: ClipSpace,
          ...args
        ) {
          if (!skipped && this.id === id) {
            skipped = true;
            return false;
          }
          return draw.apply(this, args);
        });
      } else if (failure === 'validation') {
        const gl = (device as Device & {gl: WebGL2RenderingContext}).gl;
        vi.spyOn(gl, 'getError').mockReturnValueOnce(gl.INVALID_OPERATION);
      } else if (failure === 'changes') {
        const draw = cache.changes.update.bind(cache.changes);
        vi.spyOn(cache.changes, 'update').mockImplementationOnce((...args) => {
          draw(...args);
          throw new Error('Failed changes after GPU write');
        });
      } else {
        const draw = cache.changes.copyPrevious.bind(cache.changes);
        vi.spyOn(cache.changes, 'copyPrevious').mockImplementationOnce((...args) => {
          draw(...args);
          throw new Error('Failed predecessor after GPU write');
        });
      }
      await expect(request(34, 0)).rejects.toThrow();
      vi.restoreAllMocks();
      expect(cache.resident[1]).toBeUndefined();
      expect(cache.getReadyWindow()).toEqual({firstFrame: 32, currentFrame: 33, frameCount: 2});
      await request(34, 0);
      await new Promise<void>((res, rej) => {
        reference = new GPUVideoFrames(device, source, 32, 3, () => res(), rej);
        reference.request(getFrameWindow(34, 0, source.info!.frameCount, 3));
      });
      expect(readFrame(cache, 34)).toEqual(readFrame(reference!, 34));
      expect(cache.changes.texture.readDataSyncWebGL({z: 1, depthOrArrayLayers: 1})).toEqual(
        reference!.changes.texture.readDataSyncWebGL({z: 1, depthOrArrayLayers: 1})
      );
      await request(31, 0);
      expect(readFrame(cache, 31)).toEqual(original);
      expect(cache.changes.texture.readDataSyncWebGL({z: 1, depthOrArrayLayers: 1})).toEqual(
        originalChange
      );
      cache.appearance.update(cache.texture, cache.changes.texture, cache.resident, {
        luminanceThreshold: 0,
        staticPixelRemoval: 0
      });
      expect(cache.appearance.texture.readDataSyncWebGL({z: 1, depthOrArrayLayers: 1})).toEqual(
        original.buffer
      );
    } finally {
      vi.restoreAllMocks();
      reference?.destroy();
      cache?.destroy();
      source.destroy();
      device.destroy();
    }
  });

  // Value: protects=metadata callbacks can synchronously replace the live layer and its history;
  // fails_when=the pre-callback instance destroys the replacement cache using stale props;
  // why_new=ordinary seeks do not replace the layer while loadVideo is returning metadata; seam=none
  it('preserves history created by a synchronous onVideoLoad layer replacement', async () => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    let candidate: GPUVideoFrames | null = null;
    const loaded = vi.fn();
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'metadata-replacement',
          video: MP4_URL,
          resolution: 32,
          currentFrame: 88,
          frameTrail: 5,
          maxFrameTrail: 0,
          onVideoLoad: () => {
            layer = layer.clone({maxFrameTrail: 5});
            deck!.setProps({layers: [layer]});
            deck!.layerManager!.updateLayers();
            candidate = layer.state.pendingFrames;
          },
          onFrameLoad: info => {
            loaded(info);
            resolve();
          }
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'metadata'})],
          initialViewState: {metadata: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      expect(candidate).not.toBeNull();
      expect(candidate!.texture.destroyed).toBe(false);
      expect(layer!.state.frames).toBe(candidate);
      expect(layer!.state.frames!.capacity).toBe(6);
      expect(loaded).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          firstFrame: 83,
          currentFrame: 88,
          frameCount: 6
        })
      );
    } finally {
      deck?.finalize();
      device.destroy();
    }
  });

  // Value: protects=a failed active seek does not permanently freeze later valid frames;
  // fails_when=decode errors block resident requests or prevent replacement retry;
  // why_new=stale-iterator tests bypass the layer's active failure handler; seam=none
  it.each([
    {failure: 'null', replacement: false},
    {failure: 'rejection', replacement: false},
    {failure: 'null', replacement: true},
    {failure: 'rejection', replacement: true}
  ])('recovers a valid seek after active $failure (replacement=$replacement)', async ({
    failure,
    replacement
  }) => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    let reference: GPUVideoFrames | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'decode-recovery',
          video: MP4_URL,
          resolution: 32,
          currentFrame: 30,
          frameTrail: 2,
          maxFrameTrail: 2,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'recovery'})],
          initialViewState: {recovery: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      const previous = layer!.state.frames!;
      const source = layer!.state.source!;
      const decode = source.sink!.samplesAtTimestamps.bind(source.sink!);
      const decoder = vi
        .spyOn(source.sink!, 'samplesAtTimestamps')
        .mockImplementation(async function* (timestamps) {
          let uploaded = 0;
          for await (const sample of decode(timestamps)) {
            yield sample;
            if (++uploaded === 2) break;
          }
          if (failure === 'rejection') throw new Error('Active seek failed');
          yield null;
        });
      const errors = vi.fn();
      const loaded = vi.fn();
      layer = layer!.clone({
        currentFrame: 60,
        frameTrail: replacement ? 4 : 2,
        maxFrameTrail: replacement ? 4 : 2,
        onFrameLoad: loaded
      });
      deck!.setProps({layers: [layer], onError: errors});
      await vi.waitFor(() => expect(errors).toHaveBeenCalled(), {timeout: 2000});
      expect(loaded).not.toHaveBeenCalled();
      expect(layer.state.frames).toBe(previous);
      expect(previous.texture.destroyed).toBe(false);
      decoder.mockRestore();
      layer = layer.clone({currentFrame: 88});
      deck!.setProps({layers: [layer]});
      await vi.waitFor(
        () => expect(loaded).toHaveBeenCalledWith(expect.objectContaining({currentFrame: 88})),
        {timeout: 1500}
      );
      expect(errors).toHaveBeenCalledTimes(1);
      const frames = layer.state.frames!;
      expect(frames.capacity).toBe(replacement ? 5 : 3);
      expect(previous.texture.destroyed).toBe(replacement);
      if (!replacement) expect(frames).toBe(previous);
      const window = getFrameWindow(
        88,
        replacement ? 4 : 2,
        source.info!.frameCount,
        frames.capacity
      );
      await new Promise<void>((resolve, reject) => {
        reference = new GPUVideoFrames(
          device,
          source,
          32,
          frames.capacity,
          () => resolve(),
          reject
        );
        reference.request(window);
      });
      for (let frame = window.firstFrame; frame <= window.currentFrame; frame++) {
        expect(readFrame(frames, frame)).toEqual(readFrame(reference!, frame));
        const options = {z: frame % frames.capacity, depthOrArrayLayers: 1};
        expect(frames.changes.texture.readDataSyncWebGL(options)).toEqual(
          reference!.changes.texture.readDataSyncWebGL(options)
        );
      }
    } finally {
      vi.restoreAllMocks();
      reference?.destroy();
      deck?.finalize();
      device.destroy();
    }
  });

  // Value: protects=failed visibility commits retain enough state to retry unchanged settings;
  // fails_when=dirty slots or settings are committed before mip generation and validation;
  // why_new=allocation failure tests never reach resident appearance commits; seam=none
  it.each([
    'mipmap',
    'validation',
    'skipped pass'
  ])('retries the full visibility pyramid after %s failure', async failure => {
    const device = await createDevice();
    const frames = device.createTexture({
      dimension: '2d-array',
      format: 'rgba8unorm',
      width: 8,
      height: 8,
      depth: 1
    });
    const changes = device.createTexture({
      dimension: '2d-array',
      format: 'rgba8unorm',
      width: 8,
      height: 8,
      depth: 1
    });
    const appearance = new GPUVideoAppearance(device, 8, 8, 1);
    try {
      const color = new Uint8Array(8 * 8 * 4);
      for (let i = 0; i < color.length; i += 4) color.set([160, 80, 40, 255], i);
      frames.writeData(color);
      changes.writeData(new Uint8Array(color.length));
      const showAll = {luminanceThreshold: 0, staticPixelRemoval: 0};
      const removeStatic = {luminanceThreshold: 0, staticPixelRemoval: 1};
      appearance.update(frames, changes, [30], showAll);
      const revision = appearance.revision;
      if (failure === 'skipped pass') {
        vi.spyOn(ClipSpace.prototype, 'draw').mockReturnValueOnce(false);
      } else if (failure === 'mipmap') {
        vi.spyOn(
          Object.getPrototypeOf(appearance.texture),
          'generateMipmapsWebGL'
        ).mockImplementationOnce(() => {
          throw new Error('Simulated mipmap failure');
        });
      } else {
        const gl = (device as Device & {gl: WebGL2RenderingContext}).gl;
        vi.spyOn(gl, 'getError').mockReturnValueOnce(gl.INVALID_OPERATION);
      }
      expect(() => appearance.update(frames, changes, [30], removeStatic)).toThrow();
      expect(appearance.revision).toBe(revision);
      vi.restoreAllMocks();
      appearance.update(frames, changes, [30], removeStatic);
      expect(appearance.revision).toBe(revision + 1);
      for (let mipLevel = 0; mipLevel < 4; mipLevel++) {
        const size = 8 >> mipLevel;
        const pixels = new Uint8Array(
          appearance.texture.readDataSyncWebGL({
            mipLevel,
            width: size,
            height: size,
            depthOrArrayLayers: 1
          }) as ArrayBuffer
        );
        expect(pixels).toEqual(new Uint8Array(size * size * 4));
      }
      appearance.update(frames, changes, [30], showAll);
      expect(new Uint8Array(appearance.texture.readDataSyncWebGL() as ArrayBuffer)).toEqual(color);
    } finally {
      vi.restoreAllMocks();
      appearance.destroy();
      changes.destroy();
      frames.destroy();
      device.destroy();
    }
  });

  // Value: protects=a draw-time filter error is reported without escaping the layer draw;
  // fails_when=the exception aborts the draw or no later redraw retries dirty work;
  // why_new=direct pyramid tests cannot establish deck's error and redraw integration; seam=none
  it('reports draw-time filter failures and retries on the next redraw', async () => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'filter-recovery',
          video: MP4_URL,
          resolution: 32,
          currentFrame: 30,
          frameTrail: 0,
          maxFrameTrail: 0,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'filter'})],
          initialViewState: {filter: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      const appearance = layer!.state.frames!.appearance;
      const revision = appearance.revision;
      appearance.invalidate(0);
      const errors = vi.fn();
      deck!.setProps({onError: errors});
      vi.spyOn(
        Object.getPrototypeOf(appearance.texture),
        'generateMipmapsWebGL'
      ).mockImplementationOnce(() => {
        throw new Error('Draw-time filter failure');
      });
      expect(() => layer!.draw()).not.toThrow();
      expect(errors).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({message: expect.stringContaining('Draw-time filter failure')}),
        layer!
      );
      expect(appearance.revision).toBe(revision);
      await vi.waitFor(() => expect(appearance.revision).toBe(revision + 1), {timeout: 2000});
      expect(layer!.state.frames!.getReadyWindow()?.currentFrame).toBe(30);
    } finally {
      vi.restoreAllMocks();
      deck?.finalize();
      device.destroy();
    }
  });

  // Value: protects=GPU frame sampling honors rotation followed by horizontal mirroring;
  // fails_when=orientation uniforms disappear or inverse sampling applies transforms in the wrong order;
  // why_new=existing decoded fixtures have no rotated or mirrored pixel oracle; seam=none
  it('matches independently drawn asymmetric video samples for every rotation and mirror', async () => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    try {
      await source.initialize();
      const pixels = new Uint8Array(8 * 6 * 4);
      const colors = [
        [240, 20, 30, 255],
        [10, 210, 40, 255],
        [20, 30, 230, 255],
        [230, 190, 15, 255]
      ];
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 8; x++)
          pixels.set(colors[Number(y >= 3) * 2 + Number(x >= 4)], (y * 8 + x) * 4);
      }
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const flip of [false, true]) {
          const sample = new VideoSample(pixels, {
            format: 'RGBA',
            codedWidth: 8,
            codedHeight: 6,
            timestamp: 0,
            rotation,
            flip
          });
          const {displayWidth: width, displayHeight: height} = sample;
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext('2d')!;
          context.imageSmoothingEnabled = false;
          sample.draw(context, 0, 0, width, height);
          const expected = context.getImageData(0, 0, width, height).data;
          source.info = {...source.info!, width, height, frameCount: 1, frameTimestamps: [0]};
          const decoder = vi
            .spyOn(source.sink!, 'samplesAtTimestamps')
            .mockImplementation(async function* () {
              yield sample;
            });
          await new Promise<void>((resolve, reject) => {
            cache = new GPUVideoFrames(device, source, 0, 1, () => resolve(), reject);
            cache.request({firstFrame: 0, currentFrame: 0, frameCount: 1});
          });
          expect([cache!.width, cache!.height]).toEqual([width, height]);
          expect(Array.from(readFrame(cache!, 0)), `rotation ${rotation}, mirror ${flip}`).toEqual(
            Array.from(expected)
          );
          cache!.destroy();
          cache = undefined;
          decoder.mockRestore();
        }
      }
    } finally {
      vi.restoreAllMocks();
      cache?.destroy();
      source.destroy();
      device.destroy();
    }
  });

  // Value: protects=WebGPU upload preserves the source image orientation before volume rendering;
  // fails_when=the native copy path flips an axis or applies rotation/mirroring in the wrong order;
  // why_new=the WebGL readback oracle cannot exercise WebGPU's external-image copy path; seam=WebGPU upload.
  it('matches independently drawn asymmetric video samples on WebGPU', async ({skip}) => {
    await requireWebGPUAdapter(skip);
    const device = await luma.createDevice({
      type: 'webgpu',
      adapters: [webgpuAdapter],
      createCanvasContext: {width: 16, height: 16, useDevicePixels: false}
    });
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    try {
      await source.initialize();
      const pixels = new Uint8Array(8 * 6 * 4);
      const colors = [
        [240, 20, 30, 255],
        [10, 210, 40, 255],
        [20, 30, 230, 255],
        [230, 190, 15, 255]
      ];
      for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 8; x++)
          pixels.set(colors[Number(y >= 3) * 2 + Number(x >= 4)], (y * 8 + x) * 4);
      }
      for (const rotation of [0, 90, 180, 270] as const) {
        for (const flip of [false, true]) {
          const sample = new VideoSample(pixels, {
            format: 'RGBA',
            codedWidth: 8,
            codedHeight: 6,
            timestamp: 0,
            rotation,
            flip
          });
          const {displayWidth: width, displayHeight: height} = sample;
          const canvas = new OffscreenCanvas(width, height);
          const context = canvas.getContext('2d')!;
          context.imageSmoothingEnabled = false;
          sample.draw(context, 0, 0, width, height);
          const expected = context.getImageData(0, 0, width, height).data;
          source.info = {...source.info!, width, height, frameCount: 1, frameTimestamps: [0]};
          const decoder = vi
            .spyOn(source.sink!, 'samplesAtTimestamps')
            .mockImplementation(async function* () {
              yield sample;
            });
          await new Promise<void>((resolve, reject) => {
            cache = new GPUVideoFrames(device, source, 0, 1, () => resolve(), reject);
            cache.request({firstFrame: 0, currentFrame: 0, frameCount: 1});
          });
          expect([cache.width, cache.height]).toEqual([width, height]);
          expect(
            Array.from(await readWebGPUFrame(device, cache, 0)),
            `rotation ${rotation}, mirror ${flip}`
          ).toEqual(Array.from(expected));
          cache.destroy();
          cache = undefined;
          decoder.mockRestore();
        }
      }
    } finally {
      vi.restoreAllMocks();
      cache?.destroy();
      source.destroy();
      device.destroy();
    }
  }, 30_000);

  it('retains the previous upload texture when a display-size replacement cannot allocate', async () => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    let cache: GPUVideoFrames | undefined;
    try {
      await source.initialize();
      const sizes = [
        [8, 6],
        [10, 6],
        [8, 6]
      ] as const;
      source.info = {
        ...source.info!,
        width: 8,
        height: 6,
        frameCount: 3,
        frameTimestamps: [0, 1, 2]
      };
      vi.spyOn(source.sink!, 'samplesAtTimestamps').mockImplementation(
        async function* (timestamps) {
          for (const timestamp of timestamps) {
            const [width, height] = sizes[timestamp];
            const pixels = new Uint8Array(width * height * 4).fill(255);
            yield new VideoSample(pixels, {
              format: 'RGBA',
              codedWidth: width,
              codedHeight: height,
              timestamp
            });
          }
        }
      );
      let resolve: () => void;
      let reject: (error: Error) => void;
      cache = new GPUVideoFrames(
        device,
        source,
        0,
        3,
        () => resolve(),
        error => reject(error)
      );
      const request = (frame: number) =>
        new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
          cache!.request({firstFrame: frame, currentFrame: frame, frameCount: 1});
        });
      await request(0);
      const createTexture = device.createTexture.bind(device);
      const allocation = vi.spyOn(device, 'createTexture').mockImplementation(props => {
        if (props.width === 10 && props.height === 6)
          throw new Error('Simulated upload texture allocation failure');
        return createTexture(props);
      });
      await expect(request(1)).rejects.toThrow('Simulated upload texture allocation failure');
      allocation.mockRestore();
      await request(2);
      expect(cache.getReadyWindow()).toEqual({firstFrame: 2, currentFrame: 2, frameCount: 1});
      expect(countColor(readFrame(cache, 2))).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
      cache?.destroy();
      source.destroy();
      device.destroy();
    }
  });

  it('keeps the current white frame visible when static-pixel removal is enabled', async () => {
    const device = await createDevice();
    const target = device.createFramebuffer({
      width: 320,
      height: 240,
      colorAttachments: ['rgba8unorm'],
      depthStencilAttachment: 'depth24plus'
    });
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'video-test',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 8,
          maxFrameTrail: 8,
          resolution: 32,
          width: 2,
          frameSpacing: 0.04,
          luminanceThreshold: 0.02,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          _framebuffer: target,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'video-test', orbitAxis: 'Y'})],
          initialViewState: {
            'video-test': {target: [0, 0, -0.15], rotationX: 15, rotationOrbit: 30, zoom: 6}
          },
          layers: [layer],
          onError: error => reject(error)
        });
      });
      deck!.redraw('video-test');
      const pixels = device.readPixelsToArrayWebGL(target, {
        sourceWidth: 320,
        sourceHeight: 240
      }) as Uint8Array;
      expect(countColor(pixels)).toBeGreaterThan(25);
      const frames = layer!.state.frames;
      for (let rotationOrbit = 0; rotationOrbit <= 120; rotationOrbit += 10) {
        deck!.setProps({
          viewState: {'video-test': {target: [0, 0, -0.15], rotationX: 15, rotationOrbit, zoom: 6}}
        });
        deck!.redraw('video-test');
        expect(layer!.state.frames).toBe(frames);
        expect(frames!.getReadyWindow()?.currentFrame).toBe(30);
      }
      // Inject exact scores to test the render threshold independently of codec noise.
      const gridPixels = frames!.width * frames!.height;
      const scoreBytes = new Uint8Array(frames!.capacity * gridPixels * 4);
      const white = new Uint8Array(gridPixels * 4).fill(255);
      const slot = 30 % frames!.capacity;
      frames!.texture.writeData(white, {z: slot, depthOrArrayLayers: 1});
      frames!.changes.texture.writeData(scoreBytes);
      frames!.appearance.invalidate(slot);
      frames!.currentAppearance?.invalidate(0);
      const renderRemoval = async (staticPixelRemoval: number) => {
        layer = layer!.clone({staticPixelRemoval, frameTrail: 0});
        await new Promise<void>(resolve => {
          deck!.setProps({
            layers: [layer!],
            onAfterRender: () => resolve(),
            viewState: {'video-test': {target: [0, 0, 0], rotationX: 0, rotationOrbit: 0, zoom: 6}}
          });
        });
        expect(layer.state.frames).toBe(frames);
        return countColor(
          device.readPixelsToArrayWebGL(target, {
            sourceWidth: 320,
            sourceHeight: 240
          }) as Uint8Array
        );
      };
      const fullPlanePixels = await renderRemoval(0);
      expect(fullPlanePixels).toBeGreaterThan(25);
      const currentWhitePixelCount = await renderRemoval(1);
      expect(currentWhitePixelCount).toBeGreaterThan(fullPlanePixels * 0.9);
      const source = layer!.state.source!;
      const texture = layer!.state.frames!.texture;
      deck!.finalize();
      deck = undefined;
      expect(source.destroyed).toBe(true);
      expect(texture.destroyed).toBe(true);
    } finally {
      deck?.finalize();
      target.destroy();
      device.destroy();
    }
  });

  it('preserves source brightness and reuses the visibility pyramid while the camera moves', async () => {
    const device = await createDevice();
    const target = device.createFramebuffer({
      width: 320,
      height: 240,
      colorAttachments: ['rgba8unorm'],
      depthStencilAttachment: 'depth24plus'
    });
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'brightness-video',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 0,
          maxFrameTrail: 0,
          resolution: 0,
          width: 2,
          frameOpacity: 1,
          splatSize: 1.5,
          luminanceThreshold: 0,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          _framebuffer: target,
          width: 320,
          height: 240,
          useDevicePixels: 1,
          views: [new OrbitView({id: 'brightness', orbitAxis: 'Y'})],
          initialViewState: {
            brightness: {target: [0, 0, 0], rotationX: 0, rotationOrbit: 0, zoom: 6}
          },
          layers: [layer],
          onError: reject
        });
      });
      const frames = layer!.state.frames!;
      const color = [128, 200, 240, 255];
      const pixels = new Uint8Array(frames.width * frames.height * 4);
      for (let i = 0; i < pixels.length; i += 4) pixels.set(color, i);
      frames.texture.writeData(pixels, {z: 30 % frames.capacity, depthOrArrayLayers: 1});
      frames.appearance.invalidate(30 % frames.capacity);
      frames.currentAppearance?.invalidate(0);
      const frameRequests = vi.spyOn(frames, 'request');
      const decoding = vi.spyOn(layer!.state.source!.sink!, 'samplesAtTimestamps');
      const capture = async (
        rotationX: number,
        rotationOrbit: number,
        zoom: number,
        frameOpacity = 1
      ) => {
        layer = layer!.clone({frameOpacity});
        await new Promise<void>(resolve =>
          deck!.setProps({
            layers: [layer!],
            viewState: {brightness: {target: [0, 0, 0], rotationX, rotationOrbit, zoom}},
            onAfterRender: () => resolve()
          })
        );
        return device.readPixelsToArrayWebGL(target, {
          sourceWidth: 320,
          sourceHeight: 240
        }) as Uint8Array;
      };
      let revision = 0;
      for (const [rotationX, rotationOrbit, zoom] of [
        [0, 0, 5],
        [20, 35, 6],
        [50, 120, 7.5],
        [0, 0, 8]
      ]) {
        const rendered = await capture(rotationX, rotationOrbit, zoom);
        const errors: number[] = [];
        for (let i = 0; i < rendered.length; i += 4) {
          if (rendered[i + 3] < 250) continue;
          for (let c = 0; c < 3; c++) errors.push(Math.abs(rendered[i + c] - color[c]));
        }
        expect(errors.length).toBeGreaterThan(100);
        expect(errors.reduce((largest, error) => Math.max(largest, error), 0)).toBeLessThanOrEqual(
          2
        );
        if (!revision) revision = frames.appearance.revision;
        expect(frames.appearance.revision).toBe(revision);
        expect(layer!.state.frames).toBe(frames);
        expect(frames.getReadyWindow()?.currentFrame).toBe(30);
      }
      const half = await capture(0, 0, 6, 0.5);
      const center = (120 * 320 + 160) * 4;
      expect(half[center + 3]).toBeCloseTo(128, -1);
      expect(half[center]).toBeCloseTo(64, -1);
      expect(frames.appearance.revision).toBe(revision);
      expect(frameRequests).not.toHaveBeenCalled();
      expect(decoding).not.toHaveBeenCalled();
    } finally {
      deck?.finalize();
      target.destroy();
      device.destroy();
    }
  });

  it('keeps GPU pixels visible until a larger trail finishes decoding and filtering', async () => {
    const device = await createDevice();
    const target = device.createFramebuffer({
      width: 320,
      height: 240,
      colorAttachments: ['rgba8unorm'],
      depthStencilAttachment: 'depth24plus'
    });
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    let release: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'transactional-history',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 0,
          maxFrameTrail: 0,
          frameOpacity: 1,
          luminanceThreshold: 0,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          _framebuffer: target,
          width: 320,
          height: 240,
          useDevicePixels: 1,
          views: [new OrbitView({id: 'history', orbitAxis: 'Y'})],
          initialViewState: {history: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      const previous = layer!.state.frames!;
      const sink = layer!.state.source!.sink!;
      const samples = sink.samplesAtTimestamps.bind(sink);
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      vi.spyOn(sink, 'samplesAtTimestamps').mockImplementation(async function* (timestamps) {
        await gate;
        yield* samples(timestamps);
      });
      const completed = new Promise<void>((resolve, reject) => {
        layer = layer!.clone({frameTrail: 8, maxFrameTrail: 8, onFrameLoad: () => resolve()});
        deck!.setProps({layers: [layer!], onError: reject});
      });
      await vi.waitFor(() => expect(layer!.state.pendingFrames).not.toBeNull());
      const candidate = layer!.state.pendingFrames!;
      expect(layer!.state.frames).toBe(previous);
      expect(previous.texture.destroyed).toBe(false);
      expect(candidate.getReadyWindow()).toBeNull();
      await new Promise<void>(resolve => {
        deck!.setProps({onAfterRender: () => resolve()});
        deck!.redraw('pending-history-test');
      });
      const visible = device.readPixelsToArrayWebGL(target, {
        sourceWidth: 320,
        sourceHeight: 240
      }) as Uint8Array;
      expect(countColor(visible)).toBeGreaterThan(100);
      release!();
      await completed;
      expect(layer!.state.frames).toBe(candidate);
      expect(layer!.state.pendingFrames).toBeNull();
      expect(candidate.getReadyWindow()?.frameCount).toBe(9);
      expect(candidate.appearance.revision).toBeGreaterThan(0);
      expect(previous.texture.destroyed).toBe(true);
    } finally {
      release?.();
      vi.restoreAllMocks();
      deck?.finalize();
      target.destroy();
      device.destroy();
    }
  });

  it('cleans partial allocations and preserves the completed volume on GPU allocation errors', async () => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'failed-history',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 0,
          maxFrameTrail: 0,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'history', orbitAxis: 'Y'})],
          initialViewState: {history: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      const previous = layer!.state.frames!;
      const createTexture = device.createTexture.bind(device);
      for (const failure of ['throw', 'webgl-error']) {
        const allocated: {destroyed: boolean}[] = [];
        vi.spyOn(device, 'createTexture').mockImplementation(props => {
          if (failure === 'throw' && props.id === 'volumetric-video-frames')
            throw new Error('Simulated GPU allocation failure');
          const texture = createTexture(props);
          allocated.push(texture);
          return texture;
        });
        if (failure === 'webgl-error') {
          const gl = (device as Device & {gl: WebGL2RenderingContext}).gl;
          vi.spyOn(gl, 'getError')
            .mockReturnValueOnce(gl.OUT_OF_MEMORY)
            .mockReturnValue(gl.NO_ERROR);
        }
        const error = await new Promise<Error>(resolve => {
          layer = layer!.clone({frameTrail: 8, maxFrameTrail: 8});
          deck!.setProps({layers: [layer!], onError: resolve});
        });
        expect(error.message).toContain(
          failure === 'throw' ? 'allocation failure' : 'could not allocate'
        );
        expect(allocated.length).toBeGreaterThan(0);
        expect(allocated.every(texture => texture.destroyed)).toBe(true);
        expect(layer!.state.frames).toBe(previous);
        expect(layer!.state.pendingFrames).toBeNull();
        expect(previous.texture.destroyed).toBe(false);
        expect(previous.getReadyWindow()?.currentFrame).toBe(30);
        expect(countColor(readFrame(previous, 30))).toBeGreaterThan(100);
        vi.restoreAllMocks();
        await new Promise<void>((resolve, reject) => {
          layer = layer!.clone({frameTrail: 0, maxFrameTrail: 0, onFrameLoad: () => resolve()});
          deck!.setProps({layers: [layer!], onError: reject});
        });
        expect(layer!.state.frames).toBe(previous);
      }
    } finally {
      vi.restoreAllMocks();
      deck?.finalize();
      device.destroy();
    }
  });

  it('defaults to native pixels and grows the trail to every frame beyond the old caps', async ({
    skip
  }) => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      // This GPU integration case requires hardware capable of retaining 300 array layers.
      if (device.limits.maxTextureArrayLayers < 300) skip();
      const video = new URL('./full-trail.mp4', import.meta.url).href;
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'full-trail-video',
          video,
          currentFrame: 299,
          frameTrail: 2,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'full-trail', orbitAxis: 'Y'})],
          initialViewState: {'full-trail': {target: [0, 0, -1], zoom: 5}},
          layers: [layer],
          onError: reject
        });
      });
      expect(layer!.props.resolution).toBe(0);
      expect(layer!.props.maxFrameTrail).toBeNull();
      expect(layer!.state.source!.info!.frameCount).toBe(300);
      expect([layer!.state.frames!.width, layer!.state.frames!.height]).toEqual([128, 72]);
      const initial = layer!.state.frames!;
      await new Promise<void>((resolve, reject) => {
        layer = layer!.clone({frameTrail: 299, onFrameLoad: () => resolve()});
        deck!.setProps({layers: [layer!], onError: reject});
      });
      const frames = layer!.state.frames!;
      expect(initial.texture.destroyed).toBe(true);
      expect(frames.capacity).toBe(300);
      expect(frames.getReadyWindow()).toEqual({firstFrame: 0, currentFrame: 299, frameCount: 300});
      expect(frames.resident).toEqual(Array.from({length: 300}, (_, i) => i));
      expect(countColor(readFrame(frames, 0))).toBeGreaterThan(100);
      expect(countColor(readFrame(frames, 299))).toBeGreaterThan(100);
      // Shortening an automatic trail reuses the allocation and resident frames.
      await new Promise<void>((resolve, reject) => {
        layer = layer!.clone({frameTrail: 0, onFrameLoad: () => resolve()});
        deck!.setProps({layers: [layer!], onError: reject});
      });
      expect(layer!.state.frames).toBe(frames);
      expect(frames.getReadyWindow()?.frameCount).toBe(1);
    } finally {
      deck?.finalize();
      device.destroy();
    }
  });

  it('retains native pixels and preserves the resident cache when a history budget is exceeded', async () => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'native-budget-video',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 2,
          maxFrameTrail: 2,
          resolution: 0,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'native', orbitAxis: 'Y'})],
          initialViewState: {native: {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: error => reject(error)
        });
      });
      const frames = layer!.state.frames!;
      expect([frames.width, frames.height]).toEqual([320, 180]);
      expect(frames.getReadyWindow()?.frameCount).toBe(3);
      expect(layer!.props.parameters.depthWriteEnabled).toBe(false);
      const error = await new Promise<Error>(resolve => {
        layer = layer!.clone({maxTextureBytes: 1});
        deck!.setProps({layers: [layer!], onError: resolve});
      });
      expect(error.message).toContain('history');
      expect(layer!.state.frames).toBe(frames);
      expect(frames.texture.destroyed).toBe(false);
      const frameRequests = vi.spyOn(frames, 'request');
      const frameLoads = vi.fn();
      await new Promise<Error>(resolve => {
        layer = layer!.clone({
          currentFrame: 31,
          frameTrail: 8,
          maxFrameTrail: 8,
          onFrameLoad: frameLoads
        });
        deck!.setProps({layers: [layer!], onError: resolve});
      });
      // An oversized trail must not be reported as a successful truncated old-cache window.
      expect(frameRequests).not.toHaveBeenCalled();
      expect(frameLoads).not.toHaveBeenCalled();
      expect(frames.getReadyWindow()?.currentFrame).toBe(30);
      await new Promise<void>((resolve, reject) => {
        layer = layer!.clone({maxTextureBytes: 512 * 1048576, onFrameLoad: () => resolve()});
        deck!.setProps({layers: [layer!], onError: reject});
      });
      expect(layer!.state.frames).not.toBe(frames);
      expect(frames.texture.destroyed).toBe(true);
      expect(layer!.state.frames!.getReadyWindow()?.currentFrame).toBe(31);
      expect(layer!.state.frames!.getReadyWindow()?.frameCount).toBe(9);
    } finally {
      deck?.finalize();
      device.destroy();
    }
  });

  it('keeps the working volume when static removal needs an over-budget selected-frame mip', async () => {
    const device = await createDevice();
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    const maxTextureBytes = getFrameHistoryBytes(32, 18, 3);
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'static-removal-budget-video',
          video: MP4_URL,
          currentFrame: 30,
          frameTrail: 2,
          maxFrameTrail: 2,
          resolution: 32,
          maxTextureBytes,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          width: 320,
          height: 240,
          views: [new OrbitView({id: 'static-removal-budget'})],
          initialViewState: {'static-removal-budget': {target: [0, 0, 0], zoom: 6}},
          layers: [layer],
          onError: reject
        });
      });
      const frames = layer!.state.frames!;
      const error = await new Promise<Error>(resolve => {
        layer = layer!.clone({staticPixelRemoval: 1});
        deck!.setProps({layers: [layer!], onError: resolve});
      });
      expect(error.message).toContain('selected frame');
      expect(layer!.state.frames).toBe(frames);
      expect(frames.currentAppearance).toBeNull();
      expect(layer!.state.activeStaticPixelRemoval).toBe(0);
      deck!.redraw('static-removal-budget');
      await new Promise<void>((resolve, reject) => {
        layer = layer!.clone({maxTextureBytes: 512 * 1048576, onFrameLoad: () => resolve()});
        deck!.setProps({layers: [layer!], onError: reject});
      });
      expect(frames.currentAppearance).not.toBeNull();
      expect(layer!.state.activeStaticPixelRemoval).toBe(1);
    } finally {
      deck?.finalize();
      device.destroy();
    }
  });

  it('cancels an in-flight decode when the GPU cache is destroyed', async () => {
    const device = await createDevice();
    const source = new VideoFrameSource(MP4_URL);
    try {
      await source.initialize();
      let callbacks = 0;
      const cache = new GPUVideoFrames(
        device,
        source,
        32,
        8,
        () => callbacks++,
        () => callbacks++
      );
      cache.request(getFrameWindow(88, 7, source.info!.frameCount, 8));
      cache.destroy();
      source.destroy();
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(callbacks).toBe(0);
      expect(cache.texture.destroyed).toBe(true);
    } finally {
      source.destroy();
      device.destroy();
    }
  });

  // Value: protects=the public layer compiles both WGSL volume models and carries the asymmetric
  // video fixture through upload, filtering, mip generation, and final rendering; fails_when=any
  // pass stays GLSL-only, is upside down, or emits a native WebGPU validation error; seam=WebGPU.
  it('renders colored decoded video volumes in both WebGPU modes', async ({skip}) => {
    await requireWebGPUAdapter(skip);
    const renderVolume = async (renderMode: 'auto' | 'instanced') => {
      const parent = document.createElement('div');
      parent.style.cssText = 'width: 256px; height: 192px';
      document.body.append(parent);
      let webgpu: Device | undefined;
      let framebuffer: Framebuffer | undefined;
      let colorTexture: Texture | undefined;
      let deck: Deck<OrbitView[]> | undefined;
      let nativeDevice: NativeGpuDevice | undefined;
      const validationErrors: string[] = [];
      const captureValidationError = (event: NativeGpuError) => {
        validationErrors.push(event.error?.message ?? 'Unknown WebGPU validation error.');
      };
      try {
        webgpu = await luma.createDevice({
          type: 'webgpu',
          adapters: [webgl2Adapter, webgpuAdapter],
          createCanvasContext: {container: parent, width: 256, height: 192, useDevicePixels: false}
        });
        expect(webgpu.type).toBe('webgpu');
        colorTexture = webgpu.createTexture({
          width: 256,
          height: 192,
          format: 'rgba8unorm',
          usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
        });
        framebuffer = webgpu.createFramebuffer({
          width: 256,
          height: 192,
          colorAttachments: [colorTexture],
          depthStencilAttachment: 'depth24plus'
        });
        nativeDevice = (webgpu as WebGPUDevice).handle as unknown as NativeGpuDevice;
        nativeDevice.addEventListener('uncapturederror', captureValidationError);
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () =>
              reject(
                new Error(
                  `Timed out while rendering VolumetricVideoLayer in ${renderMode} WebGPU mode.`
                )
              ),
            30_000
          );
          let loaded = false;
          let frames = 0;
          let reading = false;
          deck = new Deck({
            _animate: true,
            _framebuffer: framebuffer,
            device: webgpu,
            parent,
            width: 256,
            height: 192,
            useDevicePixels: false,
            views: [new OrbitView({id: 'webgpu-video', orbitAxis: 'Y'})],
            initialViewState: {
              'webgpu-video': {target: [0, 0, -0.2], rotationX: 18, rotationOrbit: -32, zoom: 7}
            },
            layers: [
              new VolumetricVideoLayer({
                id: 'webgpu-video-volume',
                video: MP4_URL,
                currentFrame: 30,
                frameTrail: 5,
                maxFrameTrail: 5,
                resolution: 64,
                frameOpacity: 0.8,
                luminanceThreshold: 0,
                staticPixelRemoval: 0.2,
                renderMode,
                onFrameLoad: () => {
                  loaded = true;
                }
              })
            ],
            onAfterRender: () => {
              if (!loaded || ++frames < 6 || reading) return;
              reading = true;
              void (async () => {
                // Deck owns the active pass; submit it before the copy command.
                webgpu!.submit();
                const buffer = webgpu!.createBuffer({
                  byteLength: 256 * 192 * 4,
                  usage: Buffer.COPY_DST | Buffer.MAP_READ
                });
                try {
                  const encoder = webgpu!.createCommandEncoder();
                  encoder.copyTextureToBuffer({
                    sourceTexture: colorTexture!,
                    destinationBuffer: buffer,
                    bytesPerRow: 256 * 4,
                    width: 256,
                    height: 192
                  });
                  webgpu!.submit(encoder.finish());
                  const pixels = new Uint8Array(await buffer.readAsync());
                  const visible = pixels.reduce(
                    (count, value, index) => count + Number(index % 4 === 3 && value > 24),
                    0
                  );
                  const colors = new Set<string>();
                  for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index + 3] > 24)
                      colors.add(
                        `${pixels[index] >> 5}:${pixels[index + 1] >> 5}:${pixels[index + 2] >> 5}`
                      );
                  }
                  if (visible > 80 && colors.size > 4) {
                    window.clearTimeout(timeout);
                    resolve();
                  } else {
                    reading = false;
                  }
                } finally {
                  buffer.destroy();
                }
              })().catch(reject);
            },
            onError: error => {
              window.clearTimeout(timeout);
              reject(error);
            }
          });
        });
        await (webgpu as WebGPUDevice).handle.queue.onSubmittedWorkDone();
        expect(validationErrors).toEqual([]);
      } finally {
        nativeDevice?.removeEventListener('uncapturederror', captureValidationError);
        deck?.finalize();
        framebuffer?.destroy();
        colorTexture?.destroy();
        webgpu?.destroy();
        parent.remove();
      }
    };
    await renderVolume('auto');
    await renderVolume('instanced');
  }, 70_000);
});
