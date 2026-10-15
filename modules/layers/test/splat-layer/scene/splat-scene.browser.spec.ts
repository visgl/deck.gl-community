// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  COORDINATE_SYSTEM,
  Deck,
  MapView,
  OrthographicView,
  _GlobeView as GlobeView
} from '@deck.gl/core';
import {luma, Buffer, Texture, type Device, type Parameters} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, inject, it, vi} from 'vitest';

import {SplatLayer} from '../../../src';
import {ScatterplotLayer} from '@deck.gl/layers';

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
  appearanceControls = false,
  pickingOnly = false,
  replaceViewport = false,
  deckFiltering = false,
  projectionRecovery = false,
  deepPicking = false,
  unrelatedView?: 'globe' | 'repeat'
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
    const statuses: {id: string; phase: string}[] = [];
    const projectionErrors: string[] = [];
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
        pickable: true,
        onStatusChange: status => statuses.push({id, phase: status.phase}),
        onError: projectionRecovery
          ? error => {
              projectionErrors.push(error.message);
              return true;
            }
          : undefined
      });
    const layers = deepPicking
      ? [make(blue, 'blue').clone({data: [red, blue], getSource: row => row.splats})]
      : [make(red, 'red'), make(blue, 'blue')];
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
        views: unrelatedView
          ? [
              unrelatedView === 'globe'
                ? new GlobeView({id: 'unrelated'})
                : new MapView({id: 'unrelated', repeat: true, width: 2048}),
              new OrthographicView({id: 'scene', flipY: false})
            ]
          : new OrthographicView({id: 'scene', flipY: false}),
        initialViewState: unrelatedView
          ? {scene: {target: [0, 0, 0], zoom: 3}, unrelated: {longitude: 0, latitude: 0, zoom: 0}}
          : {target: [0, 0, 0], zoom: 3},
        layers: deckFiltering
          ? [make(red, 'mask').clone({operation: 'mask', pickable: false}), ...layers]
          : layers,
        layerFilter: unrelatedView
          ? ({viewport}) => viewport.id === 'scene'
          : deckFiltering
            ? ({layer, isPicking, renderPass, cullRect}) =>
                ['red', 'blue', 'mask'].includes(layer.id) &&
                (!pickingOnly || isPicking) &&
                (!isPicking || (renderPass.startsWith('picking:query') && Boolean(cullRect)))
            : pickingOnly
              ? ({isPicking}) => isPicking
              : undefined,
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
    if (pickingOnly) expect(result).toEqual([0, 0, 0, 0]);
    else {
      expect(result[0] + result[2]).toBeGreaterThan(80);
      expect(Math.min(result[0], result[2])).toBeGreaterThan(10);
      // The scene backend composites straight colors; the prepared backend applies its lighting
      // modules, so only its independent tint channels are asserted below.
      if (!shared) expect(Math.abs(result[0] + result[2] - result[3])).toBeLessThanOrEqual(3);
      expect(result[1]).toBeLessThan(5);
    }
    if (blob) {
      const phases = statuses.filter(status => status.id === 'blue').map(status => status.phase);
      expect(phases[0]).toBe('loading');
      expect(phases.at(-1)).toBe('ready');
    }
    expect(errors).toEqual([]);
    const picked = await deck!.pickObjectAsync({x: 64, y: 64});
    expect(picked?.object).toBe(blue);
    if (deepPicking) {
      // Deck's async picker supports depth internally; the public multi-depth API is WebGL-only.
      const hits =
        type === 'webgl'
          ? deck!.pickMultipleObjects({x: 64, y: 64, depth: 3})
          : (
              await (deck as any)._pickAsync('pickObjectAsync', 'pickObject Time', {
                x: 64,
                y: 64,
                depth: 3
              })
            ).result;
      expect(hits.map((hit: {object: unknown}) => hit.object)).toEqual([blue, red]);
      expect((await deck!.pickObjectAsync({x: 64, y: 64}))?.object).toBe(blue);
    }
    const layersNow = deck!.props.layers as SplatLayer[];
    const scene = deck!.layerManager!.getLayers().find(layer => layer.id === 'blue-scene') as
      | (unknown & {
          state: {
            runtime: {
              assets: Map<unknown, unknown>;
              domains: Map<unknown, unknown>;
              pickers: Map<string, {destroy(): void}>;
            };
          };
        })
      | undefined;
    if (shared) {
      expect(layersNow[0].state.scene).toBe(false);
      expect(layersNow[0].state.input.assets[0]).toBe(layersNow[1].state.input.assets[0]);
    } else {
      expect(scene!.state.runtime.assets.size).toBe(2);
    }
    expect(layersNow.find(layer => layer.id === 'blue')!.splatStats.renderedSplats).toBe(
      pickingOnly ? 0 : deepPicking ? 2 : 1
    );
    if (replaceViewport) {
      const pickers = [...scene!.state.runtime.pickers.values()];
      expect(pickers).toHaveLength(2);
      const destroys = pickers.map(picker => vi.spyOn(picker, 'destroy'));
      await new Promise<void>((resolve, reject) => {
        let nextFrames = 0;
        const timeout = setTimeout(
          () => reject(new Error('replacement viewport render timeout')),
          15000
        );
        deck!.setProps({
          views: new OrthographicView({id: 'replacement', flipY: false}),
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
      for (const destroy of destroys) expect(destroy).toHaveBeenCalledOnce();
      expect(scene!.state.runtime.pickers.size).toBe(0);
      expect((await deck!.pickObjectAsync({x: 64, y: 64}))?.object).toBe(blue);
      expect(
        [...scene!.state.runtime.pickers.keys()].every(key => key.startsWith('replacement/'))
      ).toBe(true);
    }
    if (projectionRecovery) {
      const settle = async (props: Partial<Deck['props']>) => {
        await new Promise<void>((resolve, reject) => {
          let count = 0;
          const timeout = setTimeout(
            () => reject(new Error('projection recovery render timeout')),
            15000
          );
          deck!.setProps({
            ...props,
            onAfterRender: () => {
              if (++count >= 3) {
                deck!.pause();
                clearTimeout(timeout);
                resolve();
              }
            }
          });
          deck!.resume();
        });
      };
      await settle({
        views: new MapView({id: 'scene'}),
        viewState: {longitude: 0, latitude: 0, zoom: 10},
        layers: [
          ...layersNow,
          new ScatterplotLayer({
            id: 'unrelated',
            data: [{position: [0, 0]}],
            getRadius: 20,
            radiusUnits: 'pixels',
            getFillColor: [0, 255, 0]
          })
        ]
      });
      const mapPixels = await readFrame(device, texture);
      expect(mapPixels[offset + 1]).toBeGreaterThan(200);
      expect(projectionErrors).toHaveLength(2);
      expect(projectionErrors.every(message => message.includes('Cartesian'))).toBe(true);
      expect(scene!.state.runtime.domains.size).toBe(0);
      expect(scene!.state.runtime.pickers.size).toBe(0);
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toBeNull();
      expect(projectionErrors).toHaveLength(2);
      await settle({
        views: new OrthographicView({id: 'scene', flipY: false}),
        viewState: {target: [0, 0, 0], zoom: 3},
        layers: layersNow
      });
      expect((await readFrame(device, texture))[offset + 3]).toBeGreaterThan(0);
      expect((await deck!.pickObjectAsync({x: 64, y: 64}))?.object).toBe(blue);
      // Consecutive query filters must preserve staged candidates without a screen redraw.
      deck!.setProps({layerFilter: () => false});
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toBeNull();
      deck!.setProps({layerFilter: () => true});
      expect((await deck!.pickObjectAsync({x: 64, y: 64}))?.object).toBe(blue);
      await settle({
        layers: layersNow.map(layer => layer.clone({coordinateSystem: COORDINATE_SYSTEM.LNGLAT}))
      });
      expect(scene!.state.runtime.domains.size).toBe(0);
      expect(projectionErrors).toHaveLength(4);
      expect((await readFrame(device, texture))[offset + 3]).toBe(0);
      await settle({
        layers: layersNow.map(layer => layer.clone({coordinateSystem: COORDINATE_SYSTEM.CARTESIAN}))
      });
      expect((await readFrame(device, texture))[offset + 3]).toBeGreaterThan(0);
      expect((await deck!.pickObjectAsync({x: 64, y: 64}))?.object).toBe(blue);
      expect(errors).toEqual([]);
    }
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
      expect(scene!.state.runtime.domains.size).toBe(0);
      expect(await deck!.pickObjectAsync({x: 64, y: 64})).toBeNull();
    }
    deck!.setProps({layers: []});
    deck!.resume();
    await new Promise(resolve => setTimeout(resolve, 50));
    deck!.pause();
    if (scene) expect(scene.state.runtime.assets.size).toBe(0);
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
  it('WebGPU and WebGL2 load and pick layers excluded from the screen pass', async () => {
    await renderSorted('webgl', false, false, true, undefined, false, false, true);
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
    if (gpu && (await gpu.requestAdapter()))
      await renderSorted('webgpu', false, false, true, undefined, false, false, true);
    else if (inject('requireWebGPU')) throw new Error('WebGPU required');
  }, 60000);

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

for (const type of ['webgl', 'webgpu'] as const) {
  it(`${type} releases picking buffers when viewports are replaced`, async ({skip}) => {
    if (type === 'webgpu') {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (!gpu || !(await gpu.requestAdapter())) {
        if (inject('requireWebGPU')) throw new Error('WebGPU required');
        skip();
      }
    }
    await renderSorted(type, false, false, false, undefined, false, false, false, true);
  }, 60000);
}

for (const type of ['webgl', 'webgpu'] as const) {
  it(`${type} draws and picks root-filtered scenes after a non-draw sibling`, async ({skip}) => {
    if (type === 'webgpu') {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (!gpu || !(await gpu.requestAdapter())) {
        if (inject('requireWebGPU')) throw new Error('WebGPU required');
        skip();
      }
    }
    await renderSorted(type, false, false, false, undefined, false, false, false, false, true);
  }, 60000);
}

for (const type of ['webgl', 'webgpu'] as const) {
  it(`${type} isolates unsupported scene projections and recovers rendering and picking`, async ({
    skip
  }) => {
    if (type === 'webgpu') {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (!gpu || !(await gpu.requestAdapter())) {
        if (inject('requireWebGPU')) throw new Error('WebGPU required');
        skip();
      }
    }
    await renderSorted(
      type,
      false,
      false,
      false,
      undefined,
      false,
      false,
      false,
      false,
      false,
      true
    );
  }, 60000);
}

for (const type of ['webgl', 'webgpu'] as const) {
  it(`${type} picks overlapping scene owners at multiple depths and restores the front owner`, async ({
    skip
  }) => {
    if (type === 'webgpu') {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (!gpu || !(await gpu.requestAdapter())) {
        if (inject('requireWebGPU')) throw new Error('WebGPU required');
        skip();
      }
    }
    await renderSorted(
      type,
      false,
      false,
      false,
      undefined,
      false,
      false,
      false,
      false,
      false,
      false,
      true
    );
  }, 60000);
  for (const unrelated of ['globe', 'repeat'] as const) {
    it(`${type} renders and picks Cartesian scenes beside a filtered unrelated ${unrelated} view`, async ({
      skip
    }) => {
      if (type === 'webgpu') {
        const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
        if (!gpu || !(await gpu.requestAdapter())) {
          if (inject('requireWebGPU')) throw new Error('WebGPU required');
          skip();
        }
      }
      await renderSorted(
        type,
        false,
        false,
        false,
        undefined,
        false,
        false,
        false,
        false,
        false,
        false,
        false,
        unrelated
      );
    }, 60000);
  }
}
