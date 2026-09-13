// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type MapView, type PickingInfo} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/three';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it, vi} from 'vitest';
import {mountWildForestExample} from './app';
import {createFarmPlots, getFarmPosition, type FarmTree} from './farm-data';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};

describe('Seasonal farm integration', () => {
  it.for(['webgl', 'webgpu'] as const)(
    'renders seasons, plot inspection, and responsive remounts on %s',
    {timeout: 30_000},
    async (type, {skip}) => {
      if (type === 'webgpu') {
        const gpu = (navigator as Navigator & {gpu?: BrowserGpu}).gpu;
        if (!gpu || !(await gpu.requestAdapter())) skip('No WebGPU adapter is available.');
      }
      const parent = document.createElement('div');
      Object.assign(parent.style, {width: '900px', height: '600px'});
      document.body.append(parent);
      let device: Device | undefined;
      let deck: Deck<MapView>;
      let cleanup: (() => void) | undefined;
      const errors: Error[] = [];
      const frames = vi.fn();
      const mount = () =>
        mountWildForestExample(parent, {
          device,
          onDeckInitialized(instance) {
            deck = instance;
            deck.setProps({onError: error => errors.push(error), onAfterRender: frames});
          }
        });
      const root = () => parent.querySelector<HTMLElement>('.forest-farm')!;
      const select = (season: string) =>
        parent.querySelector<HTMLButtonElement>(`button[data-season="${season}"]`)!.click();
      const treeLayers = () =>
        (deck!.props.layers as TreeLayer<FarmTree>[]).filter(layer => layer instanceof TreeLayer);
      try {
        device = await luma.createDevice({
          type,
          adapters: [webgl2Adapter, webgpuAdapter],
          createCanvasContext: {container: parent}
        });
        cleanup = mount();
        await expect.poll(() => frames.mock.calls.length).toBeGreaterThan(0);
        expect(deck!.props.device).toBe(device);
        expect(deck!.props.controller).toBe(false);
        expect(parent.querySelectorAll('button')).toHaveLength(4);
        expect(parent.querySelectorAll('select, input')).toHaveLength(0);
        expect(root().dataset.season).toBe('spring');
        expect(treeLayers()).toHaveLength(7);
        const data = treeLayers().map(layer => layer.props.data as FarmTree[]);
        expect(data.flat()).toHaveLength(416);
        const view = deck!.getViewports()[0];
        const cherry = treeLayers().find(layer => layer.id.endsWith('cherry'))!;
        const cherryTree = (cherry.props.data as FarmTree[])[0];
        const springCrop = cherry.props.getCrop(cherryTree);
        expect(springCrop!.count).toBeGreaterThan(0);
        frames.mockClear();
        for (const season of ['summer', 'autumn', 'winter']) select(season);
        await expect.poll(() => frames.mock.calls.length).toBeGreaterThan(0);
        expect(root().dataset.season).toBe('winter');
        expect(
          parent.querySelector('button[data-season="winter"]')!.getAttribute('aria-pressed')
        ).toBe('true');
        expect(treeLayers().every((layer, index) => layer.props.data === data[index])).toBe(true);
        const winterCherry = treeLayers().find(layer => layer.id.endsWith('cherry'))!;
        expect(winterCherry.props._subLayerProps!['canopy-cherry'].visible).toBe(false);
        const citrus = treeLayers().find(layer => layer.id.endsWith('orange'))!;
        expect(citrus.props._subLayerProps).toEqual({});
        const orange = (citrus.props.data as FarmTree[])[0];
        expect(citrus.props.getCrop(orange)!.count).toBeGreaterThan(0);
        const [x, y] = view.project([
          orange.position[0],
          orange.position[1],
          orange.height * (0.5 + orange.trunkFraction * 0.5)
        ]);
        expect(deck!.props.getTooltip!({x, y} as PickingInfo)).toMatchObject({
          text: expect.stringContaining('Orange tree')
        });
        const canvas = deck!.getCanvas()!;
        const bounds = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new MouseEvent('mousemove', {
            bubbles: true,
            clientX: bounds.left + x,
            clientY: bounds.top + y
          })
        );
        await expect
          .poll(() => parent.querySelector('.deck-tooltip')?.textContent)
          .toContain('Orange tree');
        const [px, py] = view.project(getFarmPosition(3, 3));
        expect(deck!.props.getTooltip!({x: px, y: py} as PickingInfo)).toMatchObject({
          text: expect.stringContaining('Orange tree plot')
        });
        expect(deck!.props.getTooltip!({x: 0, y: 0} as PickingInfo)).toBeNull();
        expect(deck!.getViewports()[0].zoom).toBe(view.zoom);
        cleanup();
        frames.mockClear();
        cleanup = mount();
        await expect.poll(() => frames.mock.calls.length).toBeGreaterThan(0);
        expect(root().dataset.season).toBe('winter');
        expect(parent.querySelectorAll('.forest-farm')).toHaveLength(1);
        for (const [width, height, columns] of [
          [390, 740, 2],
          [900, 600, 3]
        ]) {
          Object.assign(parent.style, {width: `${width}px`, height: `${height}px`});
          await expect.poll(() => deck!.getViewports()[0].width).toBe(width);
          await expect
            .poll(() => {
              const viewport = deck!.getViewports()[0];
              return createFarmPlots(columns)
                .flatMap(plot => plot.polygon)
                .every(point => {
                  const [x, y] = viewport.project(point);
                  return x > 8 && x < width - 8 && y > 90 && y < height - 70;
                });
            })
            .toBe(true);
        }
        expect(errors).toEqual([]);
      } finally {
        cleanup?.();
        device?.destroy();
        parent.remove();
      }
    }
  );
});
