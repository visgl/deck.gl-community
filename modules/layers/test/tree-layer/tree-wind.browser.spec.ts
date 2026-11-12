// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrbitView} from '@deck.gl/core';
import {luma, Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {afterEach, describe, expect, it} from 'vitest';
import {_treeWindGust, getTreeWindGust, TreeLayer, type TreeSpec} from '../../src';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** Places, clocks and winds as the film's trees have them: in metres from the gust origin, phase in radians. */
const SAMPLES = [
  {position: [0, 0], time: 26.821, direction: 270, strength: 0.9, phase: 0},
  {position: [0, 0], time: 14.337, direction: 270, strength: 0.9, phase: 0},
  {position: [-18, 3.8], time: 36, direction: 195, strength: 0.75, phase: 0},
  {position: [-12, 7.6], time: 34.9, direction: 15, strength: 0.72, phase: 2.2},
  {position: [12, -5], time: 101.2, direction: 195, strength: 0.3, phase: 2},
  {position: [3, 4], time: 1.4, direction: 80, strength: 0.025, phase: 0},
  {position: [250, -120], time: 413.1, direction: 15, strength: 0.75, phase: 5.5},
  {position: [-40, 15.2], time: 160.7, direction: 15, strength: 0.6, phase: 4.1},
  {position: [26, 0], time: 88.25, direction: 195, strength: 0.78, phase: 0.7},
  {position: [0, 0], time: 20, direction: 90, strength: 0.6, phase: 1}
];

describe('getTreeWindGust on the GPU', () => {
  it('agrees with treeWind_getGust, the GLSL the photoreal trees bend by', async () => {
    const count = SAMPLES.length;
    const container = document.createElement('div');
    document.body.append(container);
    const device = (await luma.createDevice({
      type: 'webgl',
      adapters: [webgl2Adapter],
      createCanvasContext: {container, width: count, height: 1, useDevicePixels: false}
    })) as WebGLDevice;
    const color = device.createTexture({
      width: count,
      height: 1,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const framebuffer = device.createFramebuffer({
      width: count,
      height: 1,
      colorAttachments: [color]
    });
    const inputs = new Float32Array(count * 8);
    SAMPLES.forEach(({position, time, direction, strength, phase}, i) => {
      const radians = (direction * Math.PI) / 180;
      inputs.set(
        [position[0], position[1], time, strength, Math.sin(radians), Math.cos(radians), phase, 0],
        i * 8
      );
    });
    const buffer = device.createBuffer({data: inputs});
    // Each sample is a point on its own pixel, its gust in two bytes: 1/65025 apart.
    const model = new Model(device, {
      id: 'tree-wind-gust',
      vs: /* glsl */ `#version 300 es
in vec4 placeTimeForce;
in vec4 directionPhase;
flat out float vGust;
void main(void) {
  vGust = treeWind_getGust(placeTimeForce.xy, placeTimeForce.z, directionPhase.xy, placeTimeForce.w, directionPhase.z);
  gl_Position = vec4((float(gl_VertexID) + 0.5) / ${count}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`,
      fs: /* glsl */ `#version 300 es
precision highp float;
flat in float vGust;
out vec4 fragColor;
void main(void) {
  float gust = clamp(vGust, 0.0, 1.0) * 255.0;
  fragColor = vec4(floor(gust) / 255.0, fract(gust), 0.0, 1.0);
}`,
      modules: [_treeWindGust],
      topology: 'point-list',
      vertexCount: count,
      bufferLayout: [
        {
          name: 'samples',
          byteStride: 32,
          attributes: [
            {attribute: 'placeTimeForce', format: 'float32x4', byteOffset: 0},
            {attribute: 'directionPhase', format: 'float32x4', byteOffset: 16}
          ]
        }
      ],
      attributes: {samples: buffer}
    });
    cleanups.push(() => {
      model.destroy();
      buffer.destroy();
      framebuffer.destroy();
      color.destroy();
      device.destroy();
      container.remove();
    });
    const pass = device.beginRenderPass({framebuffer, clearColor: [0, 0, 0, 0]});
    model.draw(pass);
    pass.end();
    device.submit();
    const pixels = device.readPixelsToArrayWebGL(framebuffer) as Uint8Array;
    SAMPLES.forEach((sample, i) => {
      const gpu = (pixels[i * 4] + pixels[i * 4 + 1] / 255) / 255;
      // The GPU's sines are 32-bit, and the clocks reach a few hundred seconds.
      expect(Math.abs(gpu - getTreeWindGust(sample))).toBeLessThan(2e-4);
    });
  });
});

describe('TreeLayer windGustTime', () => {
  const SIZE = 256;
  const view = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.1, far: 60} as never);
  // Looking north at a tree at the gust origin, so a wind toward 270 streams its crown to the left.
  const viewState = {target: [0, 0, 3], rotationOrbit: 0, rotationX: 4, zoom: 4.4, maxZoom: 30};
  const tree: TreeSpec = {species: 'citrus', position: [0, 0, 0], height: 6, crownRadius: 2.6};

  async function render(props: Record<string, unknown>): Promise<Uint8Array> {
    const parent = document.createElement('div');
    parent.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
    document.body.append(parent);
    let pixels = new Uint8Array();
    let frames = 0;
    const errors: string[] = [];
    const deck = new Deck({
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      _animate: true,
      deviceProps: {type: 'webgl', adapters: [webgl2Adapter]},
      views: view,
      viewState: viewState as never,
      layers: [
        new TreeLayer<TreeSpec>({
          id: 'gusty',
          coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
          coordinateOrigin: [0, 0, 0],
          data: [tree],
          getTree: row => row,
          lodBias: 0,
          windStrength: 0.8,
          windDirection: 270,
          windTime: 10,
          ...props
        })
      ],
      onError: error => errors.push(error.message),
      onAfterRender({gl}) {
        pixels = new Uint8Array(SIZE * SIZE * 4);
        gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        frames++;
      }
    });
    try {
      await expect.poll(() => frames, {timeout: 60000}).toBeGreaterThan(4);
      expect(errors).toEqual([]);
      return pixels;
    } finally {
      // One deck at a time, so a loaded machine draws each as fast as it can.
      deck.finalize();
      parent.remove();
    }
  }

  /** The leftmost column the tree covers, over its rows. */
  function getLeeEdge(pixels: Uint8Array): number {
    let edge = SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (pixels[(y * SIZE + x) * 4 + 3] > 0) {
          edge = Math.min(edge, x);
          break;
        }
      }
    }
    return edge;
  }

  it('runs the gust fronts on its own clock, and on windTime without one', async () => {
    const at = (time: number) =>
      getTreeWindGust({position: [0, 0], time, direction: 270, strength: 0.8, phase: 0});
    expect(at(26.821)).toBe(1);
    expect(at(14.337)).toBeLessThan(0.21);
    const peak = await render({windGustTime: 26.821});
    const lull = await render({windGustTime: 14.337});
    const unset = await render({windGustTime: null});
    const same = await render({windGustTime: 10});
    // With the rest of the wind held, a front alone bows the crown downwind, and only the clock moved it.
    expect(getLeeEdge(lull) - getLeeEdge(peak)).toBeGreaterThan(8);
    expect(same).toEqual(unset);
  }, 240_000);
});
