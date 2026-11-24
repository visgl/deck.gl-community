// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  AmbientLight,
  Deck,
  DirectionalLight,
  LightingEffect,
  OrbitView,
  type Layer
} from '@deck.gl/core';
import {Buffer, luma, Texture, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {expect, it} from 'vitest';
import {SelectionPulseExtension, TreeLayer, type TreeSpec} from '../../../src';
import {requireWebGPUAdapter} from '../../common-layers/webgpu-test-utils';

const SIZE = 256;
const YELLOW = [255, 220, 0, 255] as const;
const GREEN = [30, 200, 40, 255] as const;

class CanopyLayer extends TreeLayer<TreeSpec> {
  static layerName = 'CanopyColorTestLayer';
  filterSubLayer({layer}: {layer: Layer}) {
    return !layer.id.endsWith('-shadow') && /-(canopy|photoreal-leaves)-/.test(layer.id);
  }
}

for (const backend of ['webgl', 'webgpu'] as const) {
  it(`${backend}: preserves authored hues, opacity, picking and selection across canopy detail`, async ({
    skip
  }) => {
    if (backend === 'webgpu') await requireWebGPUAdapter(skip);
    const errors: string[] = [];
    const parent = document.createElement('div');
    document.body.append(parent);
    const device = await luma.createDevice({
      type: backend,
      adapters: [webgl2Adapter, webgpuAdapter],
      createCanvasContext: {container: parent, width: SIZE, height: SIZE, useDevicePixels: false},
      onError: error => errors.push(error.message)
    });
    const handle = backend === 'webgpu' ? (device as Device & {handle: GPUDevice}).handle : null;
    const record = (event: GPUUncapturedErrorEvent) => errors.push(event.error.message);
    handle?.addEventListener('uncapturederror', record);
    const color = device.createTexture({
      width: SIZE,
      height: SIZE,
      format: 'rgba8unorm',
      usage: Texture.RENDER_ATTACHMENT | Texture.COPY_SRC
    });
    const target = device.createFramebuffer({
      width: SIZE,
      height: SIZE,
      colorAttachments: [color],
      depthStencilAttachment: 'depth24plus'
    });
    const readback = device.createBuffer({
      byteLength: SIZE * SIZE * 4,
      usage: Buffer.COPY_DST | Buffer.MAP_READ
    });
    const data: TreeSpec[] = [
      {
        position: [0, 0, 0],
        species: 'citrus',
        height: 4.8,
        crownRadius: 1.4,
        canopyColor: [...YELLOW]
      }
    ];
    const pulse = new SelectionPulseExtension();
    let draws = 0;
    const deck = new Deck({
      device,
      parent,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      _framebuffer: target,
      views: new OrbitView({orbitAxis: 'Z', fovy: 40}),
      viewState: {target: [0, 0, 2.4], zoom: 6, rotationX: 25, rotationOrbit: 0},
      effects: [
        new LightingEffect({
          ambient: new AmbientLight({color: [184, 209, 239], intensity: 1.2}),
          sun: new DirectionalLight({color: [255, 246, 221], intensity: 2, direction: [-1, -2, -3]})
        })
      ],
      onError: error => errors.push(error.message),
      onAfterRender: () => draws++
    });
    const layer = (props = {}) =>
      new CanopyLayer({
        id: 'canopy-colors',
        data,
        coordinateSystem: 'cartesian',
        shadowEnabled: false,
        pickable: true,
        windTime: 0,
        getCanopyColor: YELLOW,
        extensions: [pulse],
        getSelected: () => false,
        updateTriggers: {getSelected: props['getSelected'] ?? false},
        ...props
      });
    let scenario: unknown;
    const render = async (props = {}) => {
      scenario = props;
      await expect.poll(() => deck.isInitialized, {timeout: 60000}).toBe(true);
      deck['animationLoop'].stop();
      deck.setProps({layers: [layer(props)]});
      const before = draws;
      deck['_onRenderFrame']();
      await expect.poll(() => draws, {timeout: 60000}).toBeGreaterThan(before);
      const encoder = device.createCommandEncoder();
      encoder.copyTextureToBuffer({
        sourceTexture: color,
        destinationBuffer: readback,
        width: SIZE,
        height: SIZE,
        bytesPerRow: SIZE * 4
      });
      device.submit(encoder.finish());
      const pixels = new Uint8Array(await readback.readAsync());
      const gl = (device as Device & {gl?: WebGL2RenderingContext}).gl;
      expect(gl?.getError() ?? 0).toBe(0);
      return pixels;
    };
    const sample = (pixels: Uint8Array, tint: readonly number[], literal = false) => {
      let count = 0,
        maxTintError = 0,
        worst: unknown,
        alpha = 0,
        brightness = 0,
        minAlpha = 255;
      let point = {x: 0, y: 0};
      for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3] || (!literal && pixels[i + 1] < 15)) continue;
        // Neutral shading preserves RGB ratios in display space, for unlit and lit materials.
        const scale = literal ? 1 : pixels[i + 1] / tint[1];
        const error = Math.max(
          Math.abs(pixels[i] - tint[0] * scale),
          literal ? Math.abs(pixels[i + 1] - tint[1]) : 0,
          Math.abs(pixels[i + 2] - tint[2] * scale)
        );
        if (error > maxTintError) {
          maxTintError = error;
          worst = {
            rgba: Array.from(pixels.subarray(i, i + 4)),
            x: (i / 4) % SIZE,
            y: Math.floor(i / 4 / SIZE)
          };
        }
        count++;
        alpha += pixels[i + 3];
        minAlpha = Math.min(minAlpha, pixels[i + 3]);
        brightness += pixels[i + 1];
        point = {x: (i / 4) % SIZE, y: Math.floor(i / 4 / SIZE)};
      }
      expect(count).toBeGreaterThan(100);
      expect(maxTintError, JSON.stringify({scenario, worst})).toBeLessThan(literal ? 2 : 4);
      return {count, minAlpha, alpha: alpha / count, brightness: brightness / count, point};
    };
    const coverage = {shell: false, leaves: false, transition: false};
    let transitionBias = 0;
    try {
      // Bias changes the rendered primitive while keeping the camera and authored size fixed.
      for (const level of [3, 'transition', 0, -3] as const) {
        const lodBias = level === 'transition' ? transitionBias : level;
        const plain = sample(await render({lodBias, foliageMaterial: {unlit: true}}), YELLOW);
        expect(plain.brightness).toBeCloseTo(220, 0);
        // Equal RGB with different intent must preserve the natural fallback or authored override.
        const fallbackPixels = await render({
          lodBias,
          getCanopyColor: null,
          foliageMaterial: {unlit: true}
        });
        const defaultRgb = [33, 112, 29, 255] as const;
        const authoredPixels = await render({
          lodBias,
          getCanopyColor: defaultRgb,
          foliageMaterial: {unlit: true}
        });
        sample(authoredPixels, defaultRgb, true);
        let maxIntentDelta = 0;
        for (let i = 0; i < fallbackPixels.length; i++)
          maxIntentDelta = Math.max(
            maxIntentDelta,
            Math.abs(fallbackPixels[i] - authoredPixels[i])
          );
        expect(maxIntentDelta).toBeGreaterThan(10);
        if (level === 3) {
          // The unlit shell pins the existing species-default pigment and display behavior.
          const linear = defaultRgb.slice(0, 3).map(channel => (channel / 255) ** 2.2);
          const luminance = linear[0] * 0.3 + linear[1] * 0.55 + linear[2] * 0.15;
          const expected = linear.map((channel, index) => {
            const value = (channel * 0.55 + luminance * 0.45) * [0.82, 0.53, 0.33][index];
            const mapped = (value * (2.51 * value + 0.03)) / (value * (2.43 * value + 0.59) + 0.14);
            return Math.round(Math.max(0, Math.min(1, mapped)) ** (1 / 2.2) * 255);
          });
          let maxDefaultError = 0;
          for (let i = 0; i < fallbackPixels.length; i += 4) {
            if (!fallbackPixels[i + 3]) continue;
            for (let channel = 0; channel < 3; channel++)
              maxDefaultError = Math.max(
                maxDefaultError,
                Math.abs(fallbackPixels[i + channel] - expected[channel])
              );
          }
          expect(maxDefaultError).toBeLessThanOrEqual(1);
        }
        const parentLayer = deck['layerManager']
          .getLayers()
          .find(child => child.id === 'canopy-colors') as TreeLayer<TreeSpec>;
        const row = parentLayer.state.photoreal!.rows[0];
        // Put the measured projected crown in the middle of the 56–64 px overlap.
        if (level === 3)
          transitionBias = Math.log2((row.middlePixelsPerMeter * row.bounds!.crownSpan) / 60);
        for (const group of parentLayer.state.photoreal!.groups.values()) {
          coverage.shell ||= group.buckets.slice(4).some(bucket => bucket.length > 0);
          coverage.leaves ||= group.buckets.slice(0, 4).some(bucket => bucket.length > 0);
          coverage.transition ||= group.rows.some(row => row.shellRetention > 0);
        }
        const lit = sample(await render({lodBias}), YELLOW);
        expect(lit.alpha).toBeGreaterThan(250);
        const green = sample(await render({lodBias, getCanopyColor: GREEN}), GREEN);
        const faded = sample(await render({lodBias, getCanopyColor: GREEN, opacity: 0.7}), GREEN);
        // Deck gamma-encodes layer opacity; overlapping surfaces accumulate alpha.
        expect(faded.minAlpha / 255).toBeCloseTo(0.7 ** (1 / 2.2), 1);
        expect(faded.alpha).toBeLessThan(green.alpha);
        const selected = sample(
          await render({
            lodBias,
            getCanopyColor: GREEN,
            extensions: [pulse],
            getSelected: () => true,
            pulsePeriod: 0,
            pulseStrength: 0.4
          }),
          GREEN
        );
        expect(selected.brightness).toBeLessThan(green.brightness);
        await render({lodBias, getCanopyColor: GREEN});
        // WebGL texture readback is bottom-up; WebGPU readback is top-down.
        const point = {
          ...green.point,
          y: backend === 'webgl' ? SIZE - 1 - green.point.y : green.point.y
        };
        expect((await deck.pickObjectAsync({...point, radius: 3}))?.object).toEqual(data[0]);
        await render({lodBias, pickable: false});
        expect(await deck.pickObjectAsync({...point, radius: 3})).toBeNull();
        expect(errors).toEqual([]);
      }
      expect(coverage).toEqual({shell: true, leaves: true, transition: true});
      // The same batched layer must carry natural and authored material intent per tree.
      for (const lodBias of [3, -3]) {
        const pixels = await render({
          lodBias,
          data: [
            {...data[0], position: [-1.6, 0, 0]},
            {...data[0], position: [1.6, 0, 0]}
          ],
          getCanopyColor: (_tree: TreeSpec, {index}: {index: number}) => (index ? GREEN : null),
          foliageMaterial: {unlit: true}
        });
        let authored = 0,
          natural = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (!pixels[i + 3]) continue;
          const literal = GREEN.slice(0, 3).every(
            (channel, c) => Math.abs(pixels[i + c] - channel) <= 1
          );
          if (literal) authored++;
          else natural++;
        }
        expect(authored).toBeGreaterThan(100);
        expect(natural).toBeGreaterThan(100);
      }
      deck.setProps({viewState: {target: [0, 0, 3.4], zoom: 8, rotationX: 25, rotationOrbit: 0}});
      sample(await render({lodBias: -3, getHealth: 0.5, getFlush: 1}), YELLOW);
      const close = deck['layerManager']
        .getLayers()
        .find(child => child.id === 'canopy-colors') as TreeLayer<TreeSpec>;
      const group = [...close.state.photoreal!.groups.values()][0];
      expect(group.fineData.length).toBeGreaterThan(0);
      expect(group.macroData.length).toBeGreaterThan(0);
      sample(
        await render({lodBias: -3, getCanopyColor: GREEN, foliageMaterial: {unlit: true}}),
        GREEN,
        true
      );
      expect(errors).toEqual([]);
    } finally {
      deck.finalize();
      readback.destroy();
      target.destroy();
      color.destroy();
      handle?.removeEventListener('uncapturederror', record);
      device.destroy();
      parent.remove();
    }
  }, 180000);
}
