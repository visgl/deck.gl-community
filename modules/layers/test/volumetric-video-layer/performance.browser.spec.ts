// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {it, expect, vi} from 'vitest';
import {Deck, OrbitView} from '@deck.gl/core';
import {luma} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {getFrameHistoryBytes} from '../../src/volumetric-video-layer/frame-utils';
import {VolumetricVideoLayer} from '../../src/volumetric-video-layer/volumetric-video-layer';

const VIDEOS = [
  ['sparse', new URL('./performance-sample.mp4', import.meta.url).href],
  ['dense', new URL('./performance-dense.mp4', import.meta.url).href]
] as const;
const ENABLED =
  (import.meta as ImportMeta & {env: Record<string, string | undefined>}).env
    .VITE_VOLUMETRIC_VIDEO_BENCHMARK === '1';

/** Opt-in GPU benchmark; writes measurements, never machine-dependent pass thresholds. */
it.skipIf(!ENABLED)(
  'profiles the same video at increasing grid and trail sizes',
  async () => {
    const device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: {width: 1024, height: 640}
    });
    const target = device.createFramebuffer({
      width: 1024,
      height: 640,
      colorAttachments: ['rgba8unorm'],
      depthStencilAttachment: 'depth24plus'
    });
    const measurements: Record<string, unknown>[] = [];
    const supported = device.features.has('timestamp-query');
    console.log('VIDEO_GPU', JSON.stringify({info: device.info, gpuTimers: supported}));
    try {
      for (const [fixture, video] of VIDEOS) {
        for (const renderMode of ['instanced', 'auto'] as const) {
          for (const [resolution, trail, removal] of [
            [128, 8, 0],
            [128, 64, 0],
            [256, 64, 0],
            [0, 64, 0],
            [0, 64, 1]
          ]) {
            let deck: Deck<OrbitView[]> | undefined;
            let layer: VolumetricVideoLayer;
            const loadingStart = performance.now();
            try {
              await new Promise<void>((resolve, reject) => {
                layer = new VolumetricVideoLayer({
                  id: 'performance-video',
                  video,
                  renderMode,
                  currentFrame: 88,
                  frameTrail: trail,
                  maxFrameTrail: 64,
                  resolution,
                  width: 3,
                  frameSpacing: 0.035,
                  frameOpacity: 0.65,
                  trailFade: 0.006,
                  luminanceThreshold: 0.08,
                  splatSize: 1.5,
                  staticPixelRemoval: removal,
                  onFrameLoad: () => resolve()
                });
                deck = new Deck({
                  device,
                  _framebuffer: target,
                  width: 1024,
                  height: 640,
                  useDevicePixels: false,
                  views: [new OrbitView({id: 'performance', orbitAxis: 'Y'})],
                  initialViewState: {
                    performance: {
                      target: [0, 0, -0.75],
                      rotationX: 22,
                      rotationOrbit: -38,
                      zoom: 7.2
                    }
                  },
                  layers: [layer],
                  onError: error => reject(error)
                });
              });
              const loadMs = performance.now() - loadingStart;
              deck!.redraw('performance');
              const pixels = device.readPixelsToArrayWebGL(target, {
                sourceWidth: 1024,
                sourceHeight: 640
              }) as Uint8Array;
              expect(pixels.some((value, index) => index % 4 !== 3 && value > 20)).toBe(true);
              const model = renderMode === 'auto' ? layer!.state.rasterModel! : layer!.state.model;
              const gpuMs: number[] = [];
              const submitMs: number[] = [];
              for (let sample = 0; sample < 14; sample++) {
                const query = supported
                  ? device.createQuerySet({type: 'timestamp', count: 2})
                  : undefined;
                const start = performance.now();
                const pass = device.beginRenderPass({
                  framebuffer: target,
                  clearColor: [0, 0, 0, 0],
                  timestampQuerySet: query,
                  beginTimestampIndex: query ? 0 : undefined,
                  endTimestampIndex: query ? 1 : undefined,
                  parameters: {viewport: [0, 0, 1024, 640]}
                });
                model.draw(pass);
                pass.end();
                submitMs.push(performance.now() - start);
                if (query) {
                  try {
                    gpuMs.push(await query.readTimestampDuration(0, 1));
                  } finally {
                    query.destroy();
                  }
                } else {
                  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
                }
              }
              const median = (values: number[]) =>
                [...values].slice(4).sort((a, b) => a - b)[Math.floor((values.length - 4) / 2)] ??
                null;
              const frames = layer!.state.frames!;
              let camera: Record<string, unknown> | undefined;
              if (resolution === 0 && removal === 0) {
                const intervals: number[] = [];
                const longTasks: number[] = [];
                const observer = new PerformanceObserver(list => {
                  for (const entry of list.getEntries()) longTasks.push(entry.duration);
                });
                observer.observe({type: 'longtask'});
                const cachedFrames = layer!.state.frames;
                let previous = performance.now();
                for (let step = 0; step < 70; step++) {
                  await new Promise<void>(resolve =>
                    requestAnimationFrame(now => {
                      if (step >= 10) intervals.push(now - previous);
                      previous = now;
                      deck!.setProps({
                        viewState: {
                          performance: {
                            target: [0, 0, -0.75],
                            rotationX: 22,
                            rotationOrbit: -38 + step * 0.3,
                            zoom: 7.2
                          }
                        }
                      });
                      deck!.redraw('camera benchmark');
                      // Complete this render before submitting another. This one-pixel
                      // test-only read fences the GPU; RAF submission alone can hide a backlog.
                      device.readPixelsToArrayWebGL(target, {sourceWidth: 1, sourceHeight: 1});
                      resolve();
                    })
                  );
                }
                for (const entry of observer.takeRecords()) longTasks.push(entry.duration);
                observer.disconnect();
                expect(layer!.state.frames).toBe(cachedFrames);
                const sorted = [...intervals].sort((a, b) => a - b);
                camera = {
                  measuredFrames: intervals.length,
                  medianFrameIntervalMs: sorted[Math.floor(sorted.length * 0.5)],
                  p95FrameIntervalMs: sorted[Math.floor(sorted.length * 0.95)],
                  longTasks: longTasks.length,
                  longestTaskMs: Math.max(0, ...longTasks)
                };
              }
              const result = {
                fixture,
                renderMode,
                resolution,
                trail,
                removal,
                grid: [frames.width, frames.height],
                splatCount: frames.width * frames.height * frames.getReadyWindow()!.frameCount,
                loadMs,
                vertices: model.instanceCount * 4,
                textureBytes: getFrameHistoryBytes(frames.width, frames.height, frames.capacity),
                camera,
                gpuMedianMs: median(gpuMs),
                submitMedianMs: median(submitMs)
              };
              measurements.push(result);
              console.log('VIDEO_CASE', JSON.stringify(result));
              expect(frames.getReadyWindow()?.currentFrame).toBe(88);
            } finally {
              deck?.finalize();
            }
          }
        }
      }
      console.log('VIDEO_BENCHMARK', JSON.stringify({gpu: device.info, measurements}));
    } finally {
      target.destroy();
      device.destroy();
    }
  },
  120000
);

it.skipIf(!ENABLED)(
  'profiles native portrait video camera movement without rebuilding the volume',
  async () => {
    const width = 597;
    const height = 853;
    const device = await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: {width, height}
    });
    const target = device.createFramebuffer({
      width,
      height,
      colorAttachments: ['rgba8unorm'],
      depthStencilAttachment: 'depth24plus'
    });
    let deck: Deck<OrbitView[]> | undefined;
    let layer: VolumetricVideoLayer;
    try {
      await new Promise<void>((resolve, reject) => {
        layer = new VolumetricVideoLayer({
          id: 'portrait-performance',
          video: new URL('./performance-native-portrait.mp4', import.meta.url).href,
          currentFrame: 44,
          frameTrail: 18,
          maxFrameTrail: 18,
          resolution: 0,
          frameOpacity: 1,
          luminanceThreshold: 0,
          splatSize: 1.5,
          width: 3,
          frameSpacing: 0.035,
          trailFade: 0.006,
          onFrameLoad: () => resolve()
        });
        deck = new Deck({
          device,
          _framebuffer: target,
          width,
          height,
          useDevicePixels: 1,
          views: [new OrbitView({id: 'portrait', orbitAxis: 'Y'})],
          initialViewState: {
            portrait: {target: [0, 0, -0.75], rotationX: 22, rotationOrbit: -38, zoom: 7.2}
          },
          layers: [layer],
          onError: reject
        });
      });
      deck!.redraw('portrait-ready');
      const frames = layer!.state.frames!;
      const revision = frames.appearance.revision;
      const requests = vi.spyOn(frames, 'request');
      const decoding = vi.spyOn(layer!.state.source!.sink!, 'samplesAtTimestamps');
      const intervals: number[] = [];
      let previous = performance.now();
      for (let step = 0; step < 70; step++) {
        await new Promise<void>(resolve =>
          requestAnimationFrame(now => {
            if (step >= 10) intervals.push(now - previous);
            previous = now;
            deck!.setProps({
              viewState: {
                portrait: {
                  target: [0, 0, -0.75],
                  rotationX: 22,
                  rotationOrbit: -38 + step * 0.3,
                  zoom: 7.2
                }
              }
            });
            deck!.redraw('portrait-camera');
            device.readPixelsToArrayWebGL(target, {sourceWidth: 1, sourceHeight: 1});
            expect(layer!.state.frames).toBe(frames);
            expect(frames.appearance.revision).toBe(revision);
            expect(frames.getReadyWindow()?.currentFrame).toBe(44);
            resolve();
          })
        );
      }
      expect(requests).not.toHaveBeenCalled();
      expect(decoding).not.toHaveBeenCalled();
      const pixels = device.readPixelsToArrayWebGL(target, {
        sourceWidth: width,
        sourceHeight: height
      }) as Uint8Array;
      expect(pixels.some((value, index) => index % 4 !== 3 && value > 200)).toBe(true);
      const sorted = [...intervals].sort((a, b) => a - b);
      console.log(
        'VIDEO_PORTRAIT_CAMERA',
        JSON.stringify({
          gpu: device.info,
          source: [frames.width, frames.height],
          frames: frames.getReadyWindow()!.frameCount,
          target: [width, height],
          opacity: 1,
          measuredFrames: intervals.length,
          medianMs: sorted[30],
          p95Ms: sorted[57],
          historyBytes: getFrameHistoryBytes(frames.width, frames.height, frames.capacity),
          decodeCalls: decoding.mock.calls.length,
          frameRequests: requests.mock.calls.length,
          appearanceBuildsDuringOrbit: frames.appearance.revision - revision
        })
      );
    } finally {
      deck?.finalize();
      target.destroy();
      device.destroy();
    }
  },
  120000
);
