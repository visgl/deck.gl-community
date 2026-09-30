// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {GridLayer, HexagonLayer} from '@deck.gl/aggregation-layers';
import {Deck, MapView, type Layer} from '@deck.gl/core';
import {ScatterplotLayer} from '@deck.gl/layers';
import {luma} from '@luma.gl/core';
import {webgpuAdapter} from '@luma.gl/webgpu';
import {describe, expect, it, vi} from 'vitest';

import {ZoomOpacityExtension} from '../../src';

const SIZE = 128;
const CENTER = SIZE / 2;

// Fully visible between zoom 10 and 12; half faded at 9.5; hidden below 9 and above 13
const ZOOM_OPACITY = [
  [9, 0],
  [10, 1],
  [12, 1],
  [13, 0]
] as const;

// Dense points around the view center so the aggregated cell under the center pixel is filled
const POINTS = Array.from({length: 21 * 21}, (_, i) => ({
  position: [((i % 21) - 10) * 0.0005, (Math.floor(i / 21) - 10) * 0.0005] as [number, number]
}));

const LAYER_FACTORIES: Record<string, () => Layer> = {
  ScatterplotLayer: () =>
    new ScatterplotLayer({
      id: 'scatterplot',
      data: [{position: [0, 0]}],
      getPosition: d => d.position,
      getFillColor: [255, 0, 0, 255],
      radiusMinPixels: 30,
      pickable: true,
      extensions: [new ZoomOpacityExtension()],
      zoomOpacity: ZOOM_OPACITY
    } as any),
  HexagonLayer: () =>
    new HexagonLayer({
      id: 'hexagon',
      data: POINTS,
      getPosition: d => d.position,
      radius: 1000,
      gpuAggregation: true,
      pickable: true,
      extensions: [new ZoomOpacityExtension()],
      zoomOpacity: ZOOM_OPACITY
    } as any),
  GridLayer: () =>
    new GridLayer({
      id: 'grid',
      data: POINTS,
      getPosition: d => d.position,
      cellSize: 1000,
      gpuAggregation: true,
      pickable: true,
      extensions: [new ZoomOpacityExtension()],
      zoomOpacity: ZOOM_OPACITY
    } as any)
};

function readAlpha(deck: Deck, x: number, y: number): number {
  const canvas = deck.getCanvas() as HTMLCanvasElement;
  const readback = document.createElement('canvas');
  readback.width = canvas.width;
  readback.height = canvas.height;
  const context = readback.getContext('2d')!;
  context.drawImage(canvas, 0, 0);
  return context.getImageData(x, y, 1, 1).data[3];
}

function readCenterAlpha(deck: Deck): number {
  return readAlpha(deck, CENTER, CENTER);
}

async function createDeck(layer: Layer, deviceType: 'webgl' | 'webgpu' = 'webgl') {
  const host = document.createElement('div');
  host.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  document.body.append(host);
  let renderedZoom = Number.NaN;
  const onError = vi.fn();
  const device =
    deviceType === 'webgpu'
      ? await luma.createDevice({
          type: 'webgpu',
          adapters: [webgpuAdapter],
          createCanvasContext: {container: host}
        })
      : undefined;
  const deck = new Deck({
    ...(device && {device}),
    parent: host,
    width: SIZE,
    height: SIZE,
    useDevicePixels: 1,
    viewState: {longitude: 0, latitude: 0, zoom: 11},
    layers: [layer],
    onAfterRender: () => {
      renderedZoom = deck.getViewports()[0]?.zoom;
    },
    onError
  });

  const renderAt = async (zoom: number) => {
    deck.setProps({viewState: {longitude: 0, latitude: 0, zoom}});
    await vi.waitFor(() => expect(renderedZoom).toBe(zoom), {timeout: 15000});
    // Allow GPU aggregation results to propagate to the cell layer
    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  };

  const finalize = () => {
    deck.finalize();
    device?.destroy();
    host.remove();
  };

  return {deck, renderAt, finalize, onError};
}

describe('ZoomOpacityExtension rendering', () => {
  for (const [name, createLayer] of Object.entries(LAYER_FACTORIES)) {
    it(`fades ${name} by zoom and hides it outside the band`, async () => {
      const {deck, renderAt, finalize, onError} = await createDeck(createLayer());
      try {
        await renderAt(11);
        await vi.waitFor(() => expect(readCenterAlpha(deck)).toBe(255), {timeout: 15000});
        expect(deck.pickObject({x: CENTER, y: CENTER, radius: 2})).toBeTruthy();

        await renderAt(9.5);
        const fadedAlpha = readCenterAlpha(deck);
        expect(fadedAlpha).toBeGreaterThan(100);
        // Aggregated cells may overlap at their edges, compounding alpha
        expect(fadedAlpha).toBeLessThan(250);
        if (name === 'ScatterplotLayer') {
          // Stops scale the `opacity` prop, which deck.gl gamma-corrects: 0.5 ** (1 / 2.2) ~ 0.73
          expect(Math.abs(fadedAlpha - 255 * 0.5 ** (1 / 2.2))).toBeLessThan(3);
        }
        // Partially faded layers stay pickable
        expect(deck.pickObject({x: CENTER, y: CENTER, radius: 2})).toBeTruthy();

        await renderAt(13.5);
        expect(readCenterAlpha(deck)).toBe(0);
        // Fully faded layers produce no fragments, so they cannot be picked
        expect(deck.pickObject({x: CENTER, y: CENTER, radius: 2})).toBeNull();

        await renderAt(8);
        expect(readCenterAlpha(deck)).toBe(0);
        expect(deck.pickObject({x: CENTER, y: CENTER, radius: 2})).toBeNull();

        expect(onError).not.toHaveBeenCalled();
      } finally {
        finalize();
      }
    }, 60000);
  }

  it('uses GPU aggregation for HexagonLayer', async () => {
    const layer = LAYER_FACTORIES.HexagonLayer();
    const {renderAt, finalize} = await createDeck(layer);
    try {
      await renderAt(11);
      const hexagonLayer = (layer as any).getCurrentLayer?.() ?? layer;
      expect(hexagonLayer.state.aggregatorType).toBe('gpu');
    } finally {
      finalize();
    }
  }, 60000);

  it('evaluates zoom per view', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    let rendered = false;
    const deck = new Deck({
      parent: host,
      width: SIZE,
      height: SIZE,
      useDevicePixels: 1,
      views: [
        new MapView({id: 'near', x: 0, width: '50%'}),
        new MapView({id: 'far', x: '50%', width: '50%'})
      ],
      viewState: {
        near: {longitude: 0, latitude: 0, zoom: 11},
        far: {longitude: 0, latitude: 0, zoom: 8}
      },
      layers: [LAYER_FACTORIES.ScatterplotLayer()],
      onAfterRender: () => {
        rendered = true;
      }
    });
    try {
      await vi.waitFor(() => expect(rendered).toBe(true), {timeout: 15000});
      expect(readAlpha(deck, SIZE / 4, CENTER)).toBe(255);
      expect(readAlpha(deck, (SIZE * 3) / 4, CENTER)).toBe(0);
      expect(deck.pickObject({x: SIZE / 4, y: CENTER})).toBeTruthy();
      expect(deck.pickObject({x: (SIZE * 3) / 4, y: CENTER})).toBeNull();
    } finally {
      deck.finalize();
      host.remove();
    }
  }, 60000);

  it('hides fully faded layers from picking on WebGPU', async ({skip}) => {
    const gpu = (navigator as Navigator & {gpu?: {requestAdapter: () => Promise<unknown>}}).gpu;
    if (!gpu || !(await gpu.requestAdapter())) {
      skip('This browser does not expose an available WebGPU adapter.');
    }
    const layer = LAYER_FACTORIES.ScatterplotLayer();
    const {deck, renderAt, finalize, onError} = await createDeck(layer, 'webgpu');
    try {
      // WebGPU only supports asynchronous picking
      await renderAt(11);
      expect(await deck.pickObjectAsync({x: CENTER, y: CENTER, radius: 2})).toBeTruthy();
      await renderAt(9.5);
      expect(await deck.pickObjectAsync({x: CENTER, y: CENTER, radius: 2})).toBeTruthy();
      await renderAt(8);
      expect(await deck.pickObjectAsync({x: CENTER, y: CENTER, radius: 2})).toBeNull();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      finalize();
    }
  }, 60000);
});
