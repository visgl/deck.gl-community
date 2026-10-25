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
import {TreeLayer, WindEffect, type CropConfig, type Season} from '@deck.gl-community/layers';
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
    'renders panel-driven TreeLayer props, plot inspection, and responsive remounts on %s',
    // Full native foliage across 416 trees and camera/remount checks is slower on CI's software GPU.
    // Individual readiness and interaction assertions retain their five-second bounds.
    {timeout: 180_000},
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
      let instantCamera = false;
      const errors: Error[] = [];
      const frames = vi.fn(() => deck!.getViewports()[0] as WebMercatorViewport);
      const mount = () =>
        mountSeasonalFarmExample(parent, {
          device,
          initialViewState: savedView,
          onViewStateChange(params) {
            // Clamp contracts should inspect the authored target independently of
            // software-GPU animation cadence. Earlier inputs still exercise transitions.
            savedView = instantCamera
              ? {...params.viewState, transitionDuration: 0}
              : params.viewState;
            return savedView;
          },
          onDeckInitialized(instance) {
            deck = instance;
            deck.setProps({
              useDevicePixels: 0.5,
              onError: error => errors.push(error),
              onAfterRender: frames
            });
          }
        });
      const viewport = () => deck!.getViewports()[0] as WebMercatorViewport;
      const root = () => parent.querySelector<HTMLElement>('.seasonal-farm')!;
      const trees = () =>
        (deck!.props.layers as TreeLayer<FarmTree>[]).find(layer => layer instanceof TreeLayer)!;
      const wind = () =>
        (deck!.props.effects as WindEffect[]).find(effect => effect instanceof WindEffect)!;
      const getCrop = (tree: FarmTree) =>
        (trees().props.getCrop as (tree: FarmTree) => CropConfig | null)(tree);
      const getSeason = (tree: FarmTree) =>
        (trees().props.getSeason as (tree: FarmTree) => Season)(tree);
      const selectOption = async (name: string, label: string) => {
        parent.querySelector<HTMLButtonElement>(`#settings-panel-input-${name}`)!.click();
        const option = await vi.waitFor(() => {
          const match = Array.from(
            document.body.querySelectorAll<HTMLElement>('[role="option"]')
          ).find(element => element.textContent?.toLowerCase().includes(label.toLowerCase()));
          expect(match).toBeDefined();
          return match!;
        });
        option.click();
      };
      const select = async (season: string) => {
        await selectOption('season', season);
        await expect.poll(() => root().dataset.season).toBe(season);
      };
      const setNumber = (label: string, value: number) => {
        const input = parent.querySelector<HTMLInputElement>(
          `input[aria-label="${label} numeric value"]`
        )!;
        input.value = String(value);
        input.dispatchEvent(new Event('input', {bubbles: true}));
      };
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
        await expect
          .poll(() => parent.querySelector('#settings-panel-input-season'), {timeout: 5000})
          .not.toBeNull();
        expect(root().dataset.season).toBe('spring');
        const data = trees().props.data as FarmTree[];
        expect(data).toHaveLength(416);
        expect(deck!.props.layers.filter(layer => layer instanceof TreeLayer)).toHaveLength(1);
        // The demo stays free of in-canvas copy: plots are identified by hover tooltips.
        expect(parent.querySelector('h1, small')).toBeNull();
        const view = viewport();
        const cherryTree = data.find(tree => tree.species === 'cherry')!;
        const corkOak = data.find(tree => tree.species === 'cork-oak')!;
        expect(getCrop(cherryTree)!.count).toBeGreaterThan(0);
        frames.mockClear();
        for (const season of ['summer', 'autumn', 'winter']) await select(season);
        await expect.poll(() => frames.mock.calls.length, {timeout: 5000}).toBeGreaterThan(0);
        expect(trees().props.data).toBe(data);
        expect(getSeason(cherryTree)).toBe('winter');
        expect(getSeason(corkOak)).toBe('summer');
        const orange = data.find(tree => tree.species === 'orange')!;
        expect(orange.type).toBe('citrus');
        expect(getCrop(orange)!.count).toBeGreaterThan(0);
        // Every panel control maps directly onto a TreeLayer or WindEffect prop.
        parent.querySelector<HTMLInputElement>('#settings-panel-input-crops')!.click();
        await expect.poll(() => getCrop(orange)).toBeNull();
        // The trees follow the scene's WindEffect rather than a layer prop.
        setNumber('Wind', 0.05);
        await expect.poll(() => wind().props.strength).toBe(0.05);
        setNumber('Wind direction', 270);
        await expect.poll(() => wind().props.direction).toBe(270);
        setNumber('Gusts', 0.5);
        await expect.poll(() => wind().props.gust).toBe(0.5);
        expect(trees().props.windEnabled).toBe(true);
        setNumber('Size', 1.2);
        await expect.poll(() => trees().props.sizeScale).toBe(1.2);
        Array.from(parent.querySelectorAll<HTMLButtonElement>('button'))
          .find(button => button.textContent?.includes('Rendering'))!
          .click();
        await expect
          .poll(() => parent.querySelector('#settings-panel-input-maxCanopySplats'))
          .not.toBeNull();
        await selectOption('maxCanopySplats', '5,000');
        await expect.poll(() => trees().props.maxCanopySplats).toBe(5_000);
        await selectOption('maxCanopyPixels', '1 MP');
        await expect.poll(() => trees().props.maxCanopyPixels).toBe(1_000_000);
        setNumber('Foveation', 0.5);
        await expect.poll(() => trees().props.foveationStrength).toBe(0.5);
        setNumber('Wind', 0);
        setNumber('Gusts', 0);
        setNumber('Size', 1);
        parent.querySelector<HTMLInputElement>('#settings-panel-input-crops')!.click();
        await expect.poll(() => getCrop(orange)?.count).toBeGreaterThan(0);
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
        instantCamera = true;
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
          expect(savedView![property]).toBe(limit);
          await expect
            .poll(() => frames.mock.results.at(-1)?.value[property], {timeout: 5000})
            .toBe(limit);
        }
        const navigated = {...savedView!};
        // Ignore the transient canvas size reported during a website device handoff.
        deck!.props.onResize!({width: 1, height: 1});
        expect(savedView!.zoom).toBe(navigated.zoom);
        expect(trees().props.data).toBe(data);
        await select('summer');
        await select('winter');
        // Ordinary resizes and season changes must not reset a navigated camera.
        parent.style.width = '880px';
        await expect.poll(() => viewport().width, {timeout: 5000}).toBe(880);
        expect(viewport().zoom).toBe(navigated.zoom);
        expect(viewport().pitch).toBe(navigated.pitch);
        expect(viewport().bearing).toBe(navigated.bearing);
        expect(trees().props.data).toBe(data);
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
        // Layout switches refit the farm, and so does any resize until the camera moves.
        for (const [width, height, columns] of [
          [390, 740, 2],
          [900, 600, 3],
          [800, 480, 3]
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
                  return x > 8 && x < width - 8 && y > 40 && y < height - 16;
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
