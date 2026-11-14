// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Deck, MapView} from '@deck.gl/core';
import {getSplatPixelsPerMeter} from '../../../modules/layers/src/splat-layer/splat-culling';
import {TreeLayer} from '@deck.gl-community/layers';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {expect, it, vi} from 'vitest';
import {mountSeasonalFarmExample} from './app';
import type {FarmTree} from './farm-data';

// Keep the two actual trees from the tilted Farm reproduction on the software GPU.
vi.mock('./farm-data', async importOriginal => {
  const data = await importOriginal<typeof import('./farm-data')>();
  return {
    ...data,
    createTreeSamples: (...args: Parameters<typeof data.createTreeSamples>) =>
      data.createTreeSamples(...args).filter(tree => ['almond-38', 'almond-63'].includes(tree.id))
  };
});

const FOREGROUND = 'almond-38';
const BACKGROUND = 'almond-63';
const VIEW = {
  longitude: 0.001366975,
  latitude: 0.001125082,
  bearing: 22,
  pitch: 55
};

it.for(['webgl', 'webgpu'] as const)(
  'retains individual leaves on the smaller foreground crown during the tilted Farm replay on %s',
  {timeout: 120_000},
  async (type, {skip}) => {
    if (type === 'webgpu') {
      const gpu = (navigator as Navigator & {gpu?: {requestAdapter(): Promise<unknown>}}).gpu;
      if (!gpu || !(await gpu.requestAdapter())) skip('No WebGPU adapter is available.');
    }
    const parent = document.createElement('div');
    parent.style.cssText = 'width:1100px;height:850px';
    document.body.append(parent);
    const errors: string[] = [];
    let frames = 0;
    let deck: Deck<MapView> | undefined;
    let cleanup: (() => void) | undefined;
    const treeLayer = () =>
      deck?.['layerManager']
        ?.getLayers()
        .find((layer): layer is TreeLayer<FarmTree> => layer instanceof TreeLayer);
    const sample = async (zoom: number) => {
      const before = frames;
      deck!.setProps({viewState: {...VIEW, zoom}});
      // View changes can render one frame before deck.gl updates composite sublayers.
      // Wait for TreeLayer's own projected scale to match the requested camera.
      await expect
        .poll(
          () => {
            const view = deck!.getViewports()[0];
            const row = treeLayer()?.state.photoreal?.rows.find(
              entry => entry?.object.id === FOREGROUND
            );
            if (view.zoom !== zoom || !row?.bounds) return false;
            const pixels = getSplatPixelsPerMeter(row.bounds.center, view, row.units);
            return frames > before && Math.abs(row.middlePixelsPerMeter - pixels) < 1e-8;
          },
          {timeout: 20_000}
        )
        .toBe(true);
      const view = deck!.getViewports()[0];
      expect(view).toMatchObject({zoom, ...VIEW});
      const state = treeLayer()!.state.photoreal!;
      return [FOREGROUND, BACKGROUND].map(id => {
        const group = [...state.groups.values()].find(entry =>
          entry.rows.some(row => row.object.id === id)
        )!;
        const row = group.rows.find(entry => entry.object.id === id)!;
        const center = row.bounds!.center;
        const distance = Math.hypot(...view.cameraPosition.map((value, i) => value - center[i]));
        const span = row.middlePixelsPerMeter * row.bounds!.crownSpan;
        return {
          distance,
          span,
          visible: row.visible,
          shellLevel: row.shellLevel,
          shellRetention: row.shellRetention,
          leafTier: group.buckets.slice(0, 4).findIndex(bucket => bucket.includes(row)),
          transitionTier: group.transitionBuckets.findIndex(bucket => bucket.includes(row)),
          caster: group.shadowBucket.includes(row)
        };
      });
    };
    let device: Device | undefined;
    try {
      device = await luma.createDevice({
        type,
        adapters: [webgl2Adapter, webgpuAdapter],
        createCanvasContext: {container: parent}
      });
      const overview = 17.8;
      const inspection = 18.9;
      cleanup = mountSeasonalFarmExample(parent, {
        device,
        initialViewState: {...VIEW, zoom: 17.6},
        showControlsWidget: false,
        onDeckInitialized(instance) {
          deck = instance;
          deck.setProps({
            useDevicePixels: 0.5,
            onError: error => errors.push(error.message),
            onAfterRender: () => frames++
          });
        }
      });
      await expect.poll(() => treeLayer()?.state.photoreal?.rows.length).toBe(2);
      const farView = await sample(overview);
      expect(farView.every(row => row.visible && row.caster)).toBe(true);
      expect(farView[0].shellLevel).toBeGreaterThanOrEqual(0);
      expect(farView[0]).toMatchObject({leafTier: -1, transitionTier: -1});
      const overlapZoom = 18.4;
      const overlapView = await sample(overlapZoom);
      const [overlap] = overlapView;
      expect(overlap).toMatchObject({visible: true, caster: true, shellLevel: 0, leafTier: -1});
      expect(overlap.shellRetention).toBeGreaterThan(0);
      expect(overlap.shellRetention).toBeLessThan(1);
      expect(overlap.transitionTier).toBeGreaterThanOrEqual(0);

      const [near, far] = await sample(inspection);
      expect(near.distance).toBeLessThan(far.distance);
      // The earlier screen-only cutoff used a 16 CSS pixel span at the Farm's default bias.
      expect(near.span).toBeLessThan(16);
      expect(far.span).toBeGreaterThan(16);
      expect(near).toMatchObject({visible: true, caster: true, shellLevel: -1, shellRetention: 0});
      expect(near.leafTier).toBeGreaterThanOrEqual(0);
      expect(far).toMatchObject({visible: true, caster: true});
      expect(far.leafTier).toBeGreaterThanOrEqual(0);

      expect(await sample(overlapZoom)).toEqual(overlapView);
      expect(await sample(overview)).toEqual(farView);
      expect(errors).toEqual([]);
    } finally {
      cleanup?.();
      device?.destroy();
      parent.remove();
    }
  }
);
