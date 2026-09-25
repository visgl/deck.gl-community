// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView, type OrbitViewState} from '@deck.gl/core';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {createSceneLayers, fitSceneView, type SceneOptions} from './scene';

const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION = 12;

type RecordingOptions = {
  scene: SceneOptions;
  backend: 'webgl' | 'webgpu';
  viewState: OrbitViewState;
  orbit: boolean;
  playTrip: boolean;
  speed: number;
  onProgress: (seconds: number) => void;
};

/** Capture the scene at native 1080p, independently of the UI dimensions. */
export function recordScene(container: HTMLElement, options: RecordingOptions) {
  let cancel = () => {};
  const result = new Promise<Blob>((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      reject(new Error('Canvas recording is unavailable in this browser.'));
      return;
    }
    const mimeType = [
      'video/mp4;codecs=avc1.42001f',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8'
    ].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      reject(new Error('This browser has no supported video encoder.'));
      return;
    }
    const stage = document.createElement('div');
    stage.className = 'ft-recording-stage';
    stage.style.width = `${WIDTH}px`;
    stage.style.height = `${HEIGHT}px`;
    container.appendChild(stage);
    const scaleStage = () => {
      const scale = Math.min(container.clientWidth / WIDTH, container.clientHeight / HEIGHT);
      stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    };
    scaleStage();
    const observer = new ResizeObserver(scaleStage);
    observer.observe(container);
    let renderer: Deck<OrbitView> | undefined;
    let recorder: MediaRecorder | undefined;
    let stream: MediaStream | undefined;
    let frame = 0;
    let start = 0;
    let lastFrame = 0;
    let settled = false;
    const chunks: Blob[] = [];
    const viewState = {
      ...fitSceneView(WIDTH, HEIGHT, options.scene.surface),
      rotationX: options.viewState.rotationX,
      rotationOrbit: options.viewState.rotationOrbit
    };
    const scene = {...options.scene};
    const layers = createSceneLayers(scene, options.backend);
    function cleanup() {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
      stream?.getTracks().forEach(track => track.stop());
      observer.disconnect();
      renderer?.finalize();
      stage.remove();
    }
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      cleanup();
      reject(error);
    }
    const timeout = setTimeout(() => fail(new Error('Recording timed out.')), 30000);
    cancel = () => fail(new Error('Recording cancelled.'));
    function animate(now: number) {
      if (settled || !renderer || !recorder) return;
      const elapsed = Math.max(0, Math.min((now - start) / 1000, DURATION));
      if (now - lastFrame >= 1000 / 30 - 1) {
        lastFrame = now;
        renderer.setProps({
          layers: createSceneLayers(
            {
              ...scene,
              currentTime: options.playTrip
                ? (scene.currentTime + elapsed * 18 * options.speed) % 300
                : scene.currentTime
            },
            options.backend
          ),
          viewState: {
            ...viewState,
            rotationOrbit: (viewState.rotationOrbit ?? 0) + (options.orbit ? elapsed * 1.4 : 0)
          }
        });
        options.onProgress(elapsed);
      }
      if (elapsed >= DURATION) recorder.stop();
      else frame = requestAnimationFrame(animate);
    }
    try {
      renderer = new Deck({
        parent: stage,
        width: WIDTH,
        height: HEIGHT,
        useDevicePixels: 1,
        deviceProps: {type: options.backend, adapters: [webgpuAdapter], webgl: {antialias: true}},
        views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
        initialViewState: viewState,
        layers,
        onError: fail,
        onAfterRender: () => {
          if (recorder || settled) return;
          if (
            options.backend === 'webgpu' &&
            layers.some(layer => layer && layer.getModels().some(model => model.pipeline.isPending))
          )
            return;
          try {
            const canvas = stage.querySelector('canvas')!;
            stream = canvas.captureStream(30);
            recorder = new MediaRecorder(stream, {mimeType, videoBitsPerSecond: 16000000});
            recorder.ondataavailable = event => {
              if (event.data.size) chunks.push(event.data);
            };
            recorder.onerror = () => fail(new Error('The video encoder failed.'));
            recorder.onstop = () => {
              if (settled) return;
              settled = true;
              const video = new Blob(chunks, {type: recorder!.mimeType});
              cleanup();
              if (video.size) resolve(video);
              else reject(new Error('The browser returned an empty recording.'));
            };
            recorder.start(250);
            start = performance.now();
            frame = requestAnimationFrame(animate);
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        }
      });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  });
  return {result, cancel: () => cancel()};
}
