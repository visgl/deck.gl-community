// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Deck, OrthographicView} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Parameters} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it} from 'vitest';

import {SplatLayer} from '../../../src';

class TestDeck extends Deck {
  pause() {
    this.animationLoop?.stop();
  }
  resume() {
    this.animationLoop?.start();
  }
}
async function readFrame(device: Device, texture?: Texture): Promise<Uint8Array> {
  if (device.type === 'webgl') {
    const gl = (device as WebGLDevice).gl;
    const pixels = new Uint8Array(128 * 128 * 4);
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    expect(gl.getError()).toBe(gl.NO_ERROR);
    return pixels;
  }
  device.submit();
  const buffer = device.createBuffer({
    byteLength: 128 * 128 * 4,
    usage: Buffer.COPY_DST | Buffer.MAP_READ
  });
  try {
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({
      sourceTexture: texture!,
      destinationBuffer: buffer,
      bytesPerRow: 128 * 4,
      width: 128,
      height: 128
    });
    device.submit(encoder.finish());
    const data = await buffer.readAsync();
    const pixels = new Uint8Array(data.length);
    for (let y = 0; y < 128; y++)
      pixels.set(data.subarray(y * 128 * 4, (y + 1) * 128 * 4), (127 - y) * 128 * 4);
    return pixels;
  } finally {
    buffer.destroy();
  }
}

async function renderSorted(
  type: 'webgl' | 'webgpu',
  reverse: boolean,
  shared = false,
  blob = false,
  clear?: 'empty' | 'singular',
  hostParameters = false,
  appearanceControls = false
): Promise<number[]> {
  const parent = document.createElement('div');
  document.body.append(parent);
  const device = await luma.createDevice({
    type,
    adapters: [webgl2Adapter, webgpuAdapter],
    createCanvasContext: {container: parent, width: 128, height: 128, useDevicePixels: false}
  });
  const texture =
    type === 'webgpu'
      ? device.createTexture({
          width: 128,
          height: 128,
          format: device.preferredColorFormat,
          usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
        })
      : undefined;
  const framebuffer = texture
    ? device.createFramebuffer({
        width: 128,
        height: 128,
        colorAttachments: [texture],
        depthStencilAttachment: 'depth24plus'
      })
    : undefined;
  const errors: string[] = [];
  const capture = (event: {error?: {message?: string}}) =>
    errors.push(event.error?.message ?? 'GPU error');
  const native =
    type === 'webgpu'
      ? (device as Device & {handle?: {addEventListener: Function; removeEventListener: Function}})
          .handle
      : undefined;
  native?.addEventListener('uncapturederror', capture);
  let deck: TestDeck | undefined;
  try {
    const source = (z: number, color: number[]) => ({
      positions: new Float32Array([0, 0, z]),
      scales: new Float32Array([2, 2, 0.1]),
      rotations: new Float32Array([1, 0, 0, 0]),
      colors: new Uint8Array(color),
      opacities: new Float32Array([0.65])
    });
    const sharedSource = source(0, [255, 255, 255, 255]);
    const bytes = new ArrayBuffer(32);
    new Float32Array(bytes, 0, 6).set([0, 0, -2, 2, 2, 0.1]);
    new Uint8Array(bytes, 24, 8).set([0, 0, 255, 166, 255, 128, 128, 128]);
    const blueBlob = {type: 'splats' as const, url: new Blob([bytes]), format: 'splat' as const};
    const red = {
      position: [0, 0, 0] as [number, number, number],
      splats: source(-4, [255, 0, 0, 255])
    };
    const blue = {
      position: [0, 0, 0] as [number, number, number],
      splats: source(-2, [0, 0, 255, 255])
    };
    const make = (owner: typeof red, id: string) =>
      new SplatLayer({
        id,
        data: [owner],
        getSource: () => (shared ? sharedSource : blob && owner === blue ? blueBlob : owner.splats),
        getPosition: () => (shared ? [0, 0, owner === blue ? -2 : -4] : [0, 0, 0]),
        getColor: () =>
          shared ? (owner === blue ? [0, 0, 255, 255] : [255, 0, 0, 255]) : [255, 255, 255, 255],
        transparency: 'sorted',
        coordinateSystem: shared ? COORDINATE_SYSTEM.DEFAULT : COORDINATE_SYSTEM.CARTESIAN,
        maxActiveSplats: 100,
        pickable: true
      });
    const layers = [make(red, 'red'), make(blue, 'blue')];
    if (reverse) layers.reverse();
    let frames = 0;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('sorted scene render timeout')), 30_000);
      deck = new TestDeck({
        device,
        parent,
        _framebuffer: framebuffer,
        width: 128,
        height: 128,
        useDevicePixels: false,
        _animate: true,
        views: new OrthographicView({id: 'scene', flipY: false}),
        initialViewState: {target: [0, 0, 0], zoom: 3},
        layers,
        onError: error => {
          clearTimeout(timeout);
          reject(error);
        },
        onAfterRender: () => {
          if (++frames >= 3 && layers.every(layer => layer.isLoaded)) {
            deck!.pause();
            clearTimeout(timeout);
            resolve();
          }
        }
      });
    });
    const pixels = await readFrame(device, texture);
    const offset = (64 * 128 + 64) * 4;
    const result = Array.from(pixels.subarray(offset, offset + 4));
    if (texture?.format === 'bgra8unorm') [result[0], result[2]] = [result[2], result[0]];
    expect(result[0] + result[2]).toBeGreaterThan(80);
    expect(Math.min(result[0], result[2])).toBeGreaterThan(10);
    // Red and blue source colors each sum to one. Compositing onto transparent black must
    // therefore retain that equality with accumulated alpha, including at translucent edges.
    expect(Math.abs(result[0] + result[2] - result[3])).toBeLessThanOrEqual(3);
    expect(result[1]).toBeLessThan(5);
    expect(errors).toEqual([]);
    const picked = await deck!.pickObjectAsync({x: 64, y: 64});
    expect(picked?.object).toBe(blue);
    const scene = deck!
      .layerManager!.getLayers()
      .find(layer => layer.id === 'blue-scene') as unknown as {
      state: {runtime: {assets: Map<unknown, unknown>; domains: Map<unknown, unknown>}};
    };
    expect(scene.state.runtime.assets.size).toBe(shared ? 1 : 2);
    const layersNow = deck!.props.layers as SplatLayer[];
    expect(layersNow[0].splatStats.renderedSplats).toBe(1);
    if (appearanceControls) {
      const capture = async (props: Partial<SplatLayer['props']>) => {
        await new Promise<void>((resolve, reject) => {
          let nextFrames = 0;
          const timeout = setTimeout(() => reject(new Error('appearance render timeout')), 30000);
          deck!.setProps({
            layers: layersNow.map(layer => layer.clone(props)),
            onAfterRender: () => {
              if (++nextFrames >= 3) {
                deck!.pause();
                clearTimeout(timeout);
                resolve();
              }
            }
          });
          deck!.resume();
        });
        return readFrame(device, texture);
      };
      const count = (frame: Uint8Array) =>
        frame.filter((value, index) => index % 4 === 3 && value > 0).length;
      expect(count(await capture({alphaCutoff: 1}))).toBe(0);
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toBeNull();
      const small = await capture({support: 1});
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toMatchObject({object: blue});
      const large = await capture({support: 6});
      expect(count(large)).toBeGreaterThan(count(small));
      const blurred = await capture({kernelVariance: 64});
      expect(blurred[offset + 3]).toBeGreaterThan(0);
      expect(blurred[offset + 3]).toBeLessThan(pixels[offset + 3]);
    }
    if (hostParameters) {
      const cases: {parameters: Parameters; sceneParameters?: Parameters}[] = [
        {parameters: {depthCompare: 'never'}},
        {parameters: {depthCompare: 'always'}},
        {parameters: {depthCompare: 'less-equal'}},
        {parameters: {depthCompare: 'always', blendColorSrcFactor: 'one'}},
        {parameters: {depthCompare: 'less-equal'}},
        {parameters: {depthCompare: 'never'}, sceneParameters: {depthCompare: 'always'}},
        {parameters: {depthCompare: 'always'}, sceneParameters: {depthCompare: 'never'}},
        {parameters: {depthCompare: 'always'}, sceneParameters: {blendColorSrcFactor: 'one'}},
        {parameters: {depthCompare: 'never'}, sceneParameters: {blendColorSrcFactor: 'src-alpha'}},
        {parameters: {depthCompare: 'less-equal'}}
      ];
      for (const {parameters, sceneParameters} of cases) {
        const effectiveParameters = {...parameters, ...sceneParameters};
        await new Promise<void>((resolve, reject) => {
          let nextFrames = 0;
          const timeout = setTimeout(
            () => reject(new Error('host parameter render timeout')),
            30000
          );
          deck!.setProps({
            layers: layersNow.map(layer =>
              layer.clone({
                parameters,
                _subLayerProps: sceneParameters ? {scene: {parameters: sceneParameters}} : undefined
              })
            ),
            onAfterRender: () => {
              if (++nextFrames >= 3) {
                deck!.pause();
                clearTimeout(timeout);
                resolve();
              }
            }
          });
          deck!.resume();
        });
        const nextPixels = await readFrame(device, texture);
        const alpha = nextPixels[offset + 3];
        expect(alpha).toSatisfy(value =>
          effectiveParameters.depthCompare === 'never' ? value === 0 : value > 0
        );
        const colorExcess = nextPixels[offset] + nextPixels[offset + 2] - alpha;
        if (effectiveParameters.blendColorSrcFactor === 'one')
          expect(colorExcess).toBeGreaterThan(50);
        else expect(Math.abs(colorExcess)).toBeLessThanOrEqual(3);
      }
    }
    if (clear) {
      await new Promise<void>((resolve, reject) => {
        let clearedFrames = 0;
        const timeout = setTimeout(() => reject(new Error('empty scene render timeout')), 5000);
        deck!.setProps({
          layers: layersNow.map(layer =>
            layer.clone(clear === 'empty' ? {data: []} : {getScale: [0, 0, 0]})
          ),
          onAfterRender: () => {
            if (++clearedFrames >= 3) {
              deck!.pause();
              clearTimeout(timeout);
              resolve();
            }
          }
        });
        deck!.resume();
      });
      const emptyPixels = await readFrame(device, texture);
      expect(Array.from(emptyPixels.subarray(offset, offset + 4))).toEqual([0, 0, 0, 0]);
      expect(scene.state.runtime.domains.size).toBe(0);
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toBeNull();
    }
    deck!.setProps({layers: []});
    deck!.resume();
    await new Promise(resolve => setTimeout(resolve, 50));
    deck!.pause();
    expect(scene.state.runtime.assets.size).toBe(0);
    return result;
  } finally {
    native?.removeEventListener('uncapturederror', capture);
    deck?.finalize();
    framebuffer?.destroy();
    texture?.destroy();
    device.destroy();
    parent.remove();
  }
}

describe('shared sorted SplatLayer domains', () => {
  it('WebGPU and WebGL2 update cutoff, support and kernel controls for pixels and picking', async () => {
    await renderSorted('webgl', false, false, false, undefined, false, true);
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    if (gpu && (await gpu.requestAdapter()))
      await renderSorted('webgpu', false, false, false, undefined, false, true);
    else if (inject('requireWebGPU')) throw new Error('WebGPU required');
  }, 60000);
  it('WebGPU and WebGL2 apply and restore host depth and blend parameters on sorted backends', async () => {
    await renderSorted('webgl', false, false, false, undefined, true);
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    if (gpu && (await gpu.requestAdapter()))
      await renderSorted('webgpu', false, false, false, undefined, true);
    else if (inject('requireWebGPU')) throw new Error('WebGPU required');
  }, 60000);
  it('WebGPU and WebGL2 clear drawn and pickable domains when owners disappear or transforms become singular', async () => {
    for (const clear of ['empty', 'singular'] as const) {
      await renderSorted('webgl', false, false, false, clear);
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (gpu && (await gpu.requestAdapter()))
        await renderSorted('webgpu', false, false, false, clear);
      else if (inject('requireWebGPU'))
        throw new Error('A WebGPU adapter is required for this gate.');
    }
  }, 60_000);
  it('decodes a Blob through the bundled worker and retains application picking ownership', async () => {
    await renderSorted('webgl', false, false, true);
  }, 60_000);
  it('WebGPU and WebGL2 share one affine-instanced source with independent tint and owner picking', async () => {
    await renderSorted('webgl', false, true);
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    if (gpu && (await gpu.requestAdapter())) await renderSorted('webgpu', false, true);
    else if (inject('requireWebGPU'))
      throw new Error('A WebGPU adapter is required for this gate.');
  }, 60_000);
  it('globally orders overlapping sources independently of layer order on WebGL2', async () => {
    const first = await renderSorted('webgl', false);
    const reversed = await renderSorted('webgl', true);
    expect(reversed).toEqual(first);
  }, 60_000);
  it('globally orders overlapping sources independently of layer order on WebGPU', async ({
    skip
  }) => {
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      if (inject('requireWebGPU')) throw new Error('WebGPU required');
      skip();
    }
    const first = await renderSorted('webgpu', false);
    const reversed = await renderSorted('webgpu', true);
    expect(reversed).toEqual(first);
  }, 60_000);
});
