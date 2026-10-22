// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, OrbitView} from '@deck.gl/core';
import {Buffer, luma, Texture} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter, type WebGPUDevice} from '@luma.gl/webgpu';
import {expect, it} from 'vitest';
import {requireWebGPUAdapter} from '../../../modules/layers/test/webgpu-test-utils';
import {createSceneLayers, fitSceneView} from './scene';

const SIZE = 256;

class SceneTestDeck extends Deck<OrbitView> {
  pause() {
    this.animationLoop?.stop();
  }

  resume() {
    this.animationLoop?.start();
  }
}

it.for(['webgl', 'webgpu'] as const)(
  'renders the flame trails over shaded terrain on %s',
  {timeout: 60000},
  async (backend, {skip}) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const container = document.createElement('div');
    container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
    document.body.append(container);
    const errors: string[] = [];
    const device = await luma.createDevice({
      type: backend,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container, width: SIZE, height: SIZE, useDevicePixels: false},
      onError: error => errors.push(error.message)
    });
    if (device.type === 'webgpu') {
      (device as WebGPUDevice).handle.addEventListener('uncapturederror', event => {
        errors.push(event.error.message);
      });
    }
    const texture = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const framebuffer = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [texture],
      depthStencilAttachment: 'depth24plus'
    });
    let deck: SceneTestDeck | undefined;
    try {
      const layers = createSceneLayers(
        {currentTime: 195, trailLength: 80, width: 24, color: [255, 255, 255]},
        backend
      );
      await new Promise<void>((resolve, reject) => {
        let frames = 0;
        deck = new SceneTestDeck({
          device,
          parent: container,
          width: SIZE,
          height: SIZE,
          useDevicePixels: false,
          _framebuffer: backend === 'webgpu' ? framebuffer : undefined,
          views: new OrbitView({orbitAxis: 'Z', orthographic: true}),
          initialViewState: fitSceneView(SIZE, SIZE),
          layers,
          onError: reject,
          onAfterRender: () => {
            // Compilation can take many RAF ticks on software GPUs. Drain each
            // frame before resuming, including frames with pending pipelines.
            deck!.pause();
            let frameDone = Promise.resolve();
            if (backend === 'webgpu') {
              device.submit();
              frameDone = (device as WebGPUDevice).handle.queue.onSubmittedWorkDone();
            }
            frameDone
              .then(() => {
                const pending =
                  backend === 'webgpu' &&
                  layers.some(layer => layer && layer.getModels().some(m => m.pipeline.isPending));
                // TerrainEffect rebuilds source models on the next update.
                if (pending || ++frames < 3) {
                  deck!.resume();
                } else {
                  resolve();
                }
              })
              .catch(reject);
          }
        });
      });
      let pixels: Uint8Array;
      if (backend === 'webgpu') {
        device.submit();
        const buffer = device.createBuffer({
          byteLength: SIZE * SIZE * 4,
          usage: Buffer.COPY_DST | Buffer.MAP_READ
        });
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyTextureToBuffer({
            sourceTexture: texture,
            destinationBuffer: buffer,
            bytesPerRow: SIZE * 4,
            width: SIZE,
            height: SIZE
          });
          device.submit(encoder.finish());
          pixels = await buffer.readAsync();
        } finally {
          buffer.destroy();
        }
      } else {
        const gl = (device as WebGLDevice).gl;
        pixels = new Uint8Array(SIZE * SIZE * 4);
        gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        expect(gl.getError()).toBe(gl.NO_ERROR);
      }
      // Bright warm pixels prove the flames survived the terrain render pass.
      let flamePixels = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 120 && pixels[i] > pixels[i + 1] * 1.3) flamePixels++;
      }
      expect(flamePixels).toBeGreaterThan(100);
      expect(errors).toEqual([]);
    } finally {
      deck?.finalize();
      framebuffer.destroy();
      texture.destroy();
      if (backend === 'webgl') {
        (device as WebGLDevice).gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
      device.destroy();
      container.remove();
    }
  }
);
