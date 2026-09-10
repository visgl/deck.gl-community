// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, type _GlobeView, type MapView, type MapViewState} from '@deck.gl/core';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/webgl';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it, vi} from 'vitest';
import {mountWildForestExample} from './app';
import {getGroveBoundsPoints} from './forest-camera';
import {createTreeSamples} from './forest-data';

// Exercise real vector rendering without depending on the tile provider.
vi.mock('@deck.gl/geo-layers', async importOriginal => {
  const original = await importOriginal<typeof import('@deck.gl/geo-layers')>();
  return {
    ...original,
    TileLayer: class extends original.TileLayer {
      getTileData() {
        // Geographic coordinates remain valid through the globe/map handoff.
        return Promise.resolve([
          {
            type: 'Feature' as const,
            properties: {layerName: 'landcover'},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [
                [
                  [-1, 38],
                  [0, 38],
                  [0, 39],
                  [-1, 39],
                  [-1, 38]
                ]
              ]
            }
          }
        ]);
      }
    }
  };
});

describe('Wild Forest integration', () => {
  it.each([
    {type: 'webgl', reducedMotion: false},
    {type: 'webgpu', reducedMotion: false},
    {type: 'webgl', reducedMotion: true}
  ] as const)('supports grove defaults, interpolated flights, immediate zoom, and remounts on $type (reduced motion: $reducedMotion)', async ({
    type,
    reducedMotion
  }) => {
    const originalMatchMedia = window.matchMedia.bind(window);
    const motionPreference = vi.spyOn(window, 'matchMedia').mockImplementation(query => {
      const result = originalMatchMedia(query);
      if (query === '(prefers-reduced-motion: reduce)') {
        Object.defineProperty(result, 'matches', {value: reducedMotion});
      }
      return result;
    });
    const parent = document.createElement('div');
    Object.assign(parent.style, {width: '900px', height: '600px'});
    document.body.append(parent);
    let device: Device | undefined;
    let deck: Deck<_GlobeView | MapView>;
    let view: MapViewState;
    let cleanup: (() => void) | undefined;
    const errors: Error[] = [];
    const frames = vi.fn();
    const cameraFrames: MapViewState[] = [];
    const mount = (initialViewState?: MapViewState) =>
      mountWildForestExample(parent, {
        device,
        initialViewState,
        onViewStateChange(params) {
          view = params.viewState;
          cameraFrames.push({...view});
          return params.viewState;
        },
        onDeckInitialized(instance) {
          deck = instance;
          deck.setProps({onError: error => errors.push(error), onAfterRender: frames});
        }
      });
    const click = (selector: string) => parent.querySelector<HTMLButtonElement>(selector)!.click();
    const root = () => parent.querySelector<HTMLElement>('.forest-explorer')!;
    try {
      device = await luma.createDevice({
        type,
        adapters: [webgl2Adapter, webgpuAdapter],
        createCanvasContext: {container: parent}
      });
      cleanup = mount();
      await expect.poll(() => frames.mock.calls.length).toBeGreaterThan(0);
      expect(deck!.props.device).toBe(device);
      expect(root().dataset.view).toBe('grove');
      expect(root().dataset.site).toBe('siwa');
      expect(root().dataset.flying).toBe('false');
      expect(parent.querySelectorAll('select')).toHaveLength(2);
      expect(parent.querySelectorAll('input')).toHaveLength(0);
      const regions = parent.querySelector<HTMLSelectElement>('[aria-label="Explore a tree"]')!;
      expect(regions.value).toBe('siwa');
      expect([...regions.options].every(option => Boolean(option.value))).toBe(true);
      expect(regions.options).toHaveLength(7);
      const select = (label: string, value: string) => {
        const control = parent.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
        control.value = value;
        control.dispatchEvent(new Event('change'));
      };
      const treeLayers = () =>
        (deck!.props.layers as any[]).filter(layer => layer.id.startsWith('forest-trees-'));
      expect(treeLayers().reduce((count, layer) => count + layer.props.data.length, 0)).toBe(2800);
      expect(treeLayers().every(layer => layer.props.sizeScale === 1)).toBe(true);
      expect(treeLayers().every(layer => layer.props.data.length === 400)).toBe(true);
      const palms = treeLayers().find(layer => layer.id.endsWith('siwa'));
      const palm = palms.props.data[0];
      const autumnColor = palms.props.getCanopyColor(palm);
      const autumnCrop = palms.props.getCrop(palm);
      expect(autumnCrop.count).toBeGreaterThan(0);
      const distant = treeLayers().find(layer => layer.id.endsWith('saopaulo'));
      expect(distant.props.getCrop(distant.props.data[0])?.count).toBeGreaterThan(0);
      const fittedZoom = deck!.getViewports()[0].zoom;
      expect(fittedZoom).toBeGreaterThan(15);
      const localLayers = treeLayers();
      click('[data-action="zoom-out"]');
      click('[data-action="zoom-out"]');
      expect(view!.zoom).toBeCloseTo(fittedZoom - 2);
      expect(treeLayers()[0]).toBe(localLayers[0]);
      await expect.poll(() => deck!.getViewports()[0].zoom).toBeCloseTo(view!.zoom);
      const canvas = parent.querySelector('canvas')!;
      const wheel = (deltaY: number) => {
        const rect = canvas.getBoundingClientRect();
        canvas.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            deltaY,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          })
        );
      };
      const wheelStart = view!.zoom;
      wheel(-240);
      await expect.poll(() => view!.zoom, {timeout: 1000}).toBeGreaterThan(wheelStart + 0.8);
      expect(treeLayers()[0]).toBe(localLayers[0]);
      select('Local season', 'winter');
      expect(root().dataset.season).toBe('winter');
      expect(
        treeLayers()
          .find(layer => layer.id.endsWith('siwa'))
          .props.getCrop(palm)
      ).toBeNull();
      expect(autumnColor).toHaveLength(4);
      expect(
        treeLayers().find(layer => layer.id.endsWith('kyoto')).props._subLayerProps['canopy-cherry']
          .visible
      ).toBe(false);
      // Citrus uses the cherry-shaped mesh, but keeps its evergreen crown in winter.
      expect(
        treeLayers().find(layer => layer.id.endsWith('saopaulo')).props._subLayerProps
      ).toEqual({});
      const winterLayers = treeLayers();
      cameraFrames.length = 0;
      select('Explore a tree', 'kyoto');
      expect(root().dataset.site).toBe('kyoto');
      if (!reducedMotion) {
        expect(root().dataset.flying).toBe('true');
        expect(view!.longitude).toBeCloseTo(25.53, 2);
      }
      await expect.poll(() => root().dataset.flying, {timeout: 6000}).toBe('false');
      expect(view!.longitude).toBeCloseTo(135.7847, 2);
      expect(view!.zoom).toBeGreaterThan(15);
      expect(view!.position![2]).toBeGreaterThan(0);
      // Crossing globe/map projections must not recreate any grove or its crop attributes.
      expect(treeLayers().every((layer, index) => layer === winterLayers[index])).toBe(true);
      expect(treeLayers().every(layer => layer.props.sizeScale === 1)).toBe(true);
      if (!reducedMotion) {
        expect(cameraFrames.length).toBeGreaterThan(1);
        // Native input interrupts a region flight immediately.
        select('Explore a tree', 'yosemite');
        wheel(-120);
        await expect.poll(() => root().dataset.flying).toBe('false');
        select('Explore a tree', 'kyoto');
        await expect.poll(() => root().dataset.flying, {timeout: 6000}).toBe('false');
        expect(view!.longitude).toBeCloseTo(135.7847, 2);
      }
      // A newer selection replaces a pending destination without rebuilding any grove.
      select('Explore a tree', 'riverland');
      select('Explore a tree', 'alentejo');
      select('Explore a tree', 'kyoto');
      await expect.poll(() => root().dataset.flying, {timeout: 6000}).toBe('false');
      expect(view!.longitude).toBeCloseTo(135.7847, 2);
      expect(treeLayers().every((layer, index) => layer === winterLayers[index])).toBe(true);
      const savedView = {...view!};
      cleanup();
      cleanup = mount(savedView);
      await expect.poll(() => deck!.isInitialized).toBe(true);
      expect(root().dataset.site).toBe('kyoto');
      expect(root().dataset.season).toBe('winter');
      expect(parent.querySelector<HTMLSelectElement>('[aria-label="Local season"]')!.value).toBe(
        'winter'
      );
      Object.assign(parent.style, {width: '390px', height: '740px'});
      await expect.poll(() => deck!.getViewports()[0].width, {timeout: 5000}).toBe(390);
      const points = getGroveBoundsPoints(
        createTreeSamples().filter(tree => tree.siteId === 'kyoto')
      );
      await expect
        .poll(() => {
          const viewport = deck!.getViewports()[0];
          return points.every(point => {
            const [x, y] = viewport.project(point);
            return x >= 23 && x <= 367 && y >= 119 && y <= 651;
          });
        })
        .toBe(true);
      expect(errors).toEqual([]);
      select('Explore a tree', 'yosemite');
      cleanup();
      cleanup = undefined;
      const callbacksAtCleanup = cameraFrames.length;
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(cameraFrames).toHaveLength(callbacksAtCleanup);
    } finally {
      cleanup?.();
      device?.destroy();
      parent.remove();
      motionPreference.mockRestore();
    }
  }, 60_000);
});
