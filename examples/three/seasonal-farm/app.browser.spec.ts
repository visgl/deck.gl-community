// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Deck,
  MapController,
  type MapView,
  type MapViewState,
  type WebMercatorViewport,
  type PickingInfo
} from '@deck.gl/core';
import {TreeLayer} from '@deck.gl-community/three';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it, vi} from 'vitest';
import {userEvent} from 'vitest/browser';
import {mountSeasonalFarmExample} from './app';
import {createFarmPlots, getFarmPosition, type FarmTree} from './farm-data';

type BrowserGpu = {requestAdapter: () => Promise<unknown>};

describe('Seasonal Farm integration', () => {
  it.for(['webgl', 'webgpu'] as const)(
    'renders seasons, plot inspection, and responsive remounts on %s',
    {timeout: 60_000},
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
      let savedView: MapViewState | undefined;
      const errors: Error[] = [];
      const frames = vi.fn(() => deck!.getViewports()[0] as WebMercatorViewport);
      const mount = () =>
        mountSeasonalFarmExample(parent, {
          device,
          initialViewState: savedView,
          onViewStateChange(params) {
            savedView = params.viewState;
            return params.viewState;
          },
          onDeckInitialized(instance) {
            deck = instance;
            deck.setProps({onError: error => errors.push(error), onAfterRender: frames});
          }
        });
      const viewport = () => deck!.getViewports()[0] as WebMercatorViewport;
      const root = () => parent.querySelector<HTMLElement>('.seasonal-farm')!;
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
        await expect.poll(() => frames.mock.calls.length, {timeout: 5000}).toBeGreaterThan(0);
        expect(deck!.props.device).toBe(device);
        expect(deck!.props.controller).toMatchObject({type: MapController});
        expect(parent.querySelectorAll('button')).toHaveLength(4);
        expect(parent.querySelectorAll('select, input')).toHaveLength(0);
        expect(root().dataset.season).toBe('spring');
        expect(treeLayers()).toHaveLength(7);
        const data = treeLayers().map(layer => layer.props.data as FarmTree[]);
        expect(data.flat()).toHaveLength(416);
        const view = viewport();
        const cherry = treeLayers().find(layer => layer.id.endsWith('cherry'))!;
        const cherryTree = (cherry.props.data as FarmTree[])[0];
        const springCrop = cherry.props.getCrop(cherryTree);
        expect(springCrop!.count).toBeGreaterThan(0);
        frames.mockClear();
        for (const season of ['summer', 'autumn', 'winter']) select(season);
        await expect.poll(() => frames.mock.calls.length, {timeout: 5000}).toBeGreaterThan(0);
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
        await userEvent.hover(canvas, {position: {x, y}});
        await expect
          .poll(() => parent.querySelector('.deck-tooltip')?.textContent, {timeout: 5000})
          .toContain('Orange tree');
        const [px, py] = view.project(getFarmPosition(3, 3));
        expect(deck!.props.getTooltip!({x: px, y: py} as PickingInfo)).toMatchObject({
          text: expect.stringContaining('Orange tree plot')
        });
        expect(deck!.props.getTooltip!({x: 0, y: 0} as PickingInfo)).toBeNull();
        expect(viewport().zoom).toBe(view.zoom);
        const bounds = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            deltaY: -240,
            clientX: bounds.left + bounds.width / 2,
            clientY: bounds.top + bounds.height / 2
          })
        );
        await expect.poll(() => viewport().zoom, {timeout: 5000}).toBeGreaterThan(view.zoom + 0.5);
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {bubbles: true, key: 'ArrowRight', code: 'ArrowRight'})
        );
        await expect.poll(() => viewport().longitude, {timeout: 5000}).not.toBe(view.longitude);
        canvas.dispatchEvent(
          new KeyboardEvent('keydown', {
            bubbles: true,
            key: 'ArrowLeft',
            code: 'ArrowLeft',
            shiftKey: true
          })
        );
        await expect.poll(() => viewport().bearing, {timeout: 5000}).toBe(-15);
        // Start near the limits to avoid rendering a long zoom sequence on CI's software GPU.
        deck!.setProps({
          initialViewState: {...savedView!, zoom: 22.5, pitch: 75, transitionDuration: 0}
        });
        await expect
          .poll(() => frames.mock.results.at(-1)?.value, {timeout: 5000})
          .toMatchObject({zoom: 22.5, pitch: 75});
        for (const [code, key, property, limit] of [
          ['Equal', '=', 'zoom', 23],
          ['ArrowUp', 'ArrowUp', 'pitch', 80]
        ] as const) {
          canvas.dispatchEvent(
            new KeyboardEvent('keydown', {
              bubbles: true,
              code,
              key,
              shiftKey: property === 'pitch'
            })
          );
          await expect
            .poll(() => frames.mock.results.at(-1)?.value[property], {timeout: 5000})
            .toBe(limit);
        }
        const navigated = {...savedView!};
        // Ignore the transient canvas size reported during a website device handoff.
        deck!.props.onResize!({width: 1, height: 1});
        expect(savedView!.zoom).toBe(navigated.zoom);
        expect(treeLayers().every((layer, index) => layer.props.data === data[index])).toBe(true);
        select('summer');
        select('winter');
        // Ordinary resizes and season changes must not reset a navigated camera.
        parent.style.width = '880px';
        await expect.poll(() => viewport().width, {timeout: 5000}).toBe(880);
        expect(viewport().zoom).toBe(navigated.zoom);
        expect(viewport().pitch).toBe(navigated.pitch);
        expect(viewport().bearing).toBe(navigated.bearing);
        expect(treeLayers().every((layer, index) => layer.props.data === data[index])).toBe(true);
        cleanup();
        frames.mockClear();
        cleanup = mount();
        await expect.poll(() => frames.mock.calls.length, {timeout: 5000}).toBeGreaterThan(0);
        expect(root().dataset.season).toBe('winter');
        expect(viewport().zoom).toBe(navigated.zoom);
        expect(viewport().pitch).toBe(navigated.pitch);
        expect(viewport().longitude).toBe(navigated.longitude);
        expect(viewport().bearing).toBe(navigated.bearing);
        expect(parent.querySelectorAll('.seasonal-farm')).toHaveLength(1);
        for (const [width, height, columns] of [
          [390, 740, 2],
          [900, 600, 3]
        ]) {
          Object.assign(parent.style, {width: `${width}px`, height: `${height}px`});
          await expect.poll(() => viewport().width, {timeout: 5000}).toBe(width);
          await expect
            .poll(() => {
              const fitted = viewport();
              return createFarmPlots(columns)
                .flatMap(plot => plot.polygon)
                .every(point => {
                  const [x, y] = fitted.project(point);
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
