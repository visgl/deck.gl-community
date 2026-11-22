// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/core/webgl';
import {
  Deck,
  FirstPersonView,
  MapView,
  _GlobeView as GlobeView,
  type MapViewState,
  type View
} from '@deck.gl/core';
import {EdgeMarkerLayer, type EdgeMarkerLayerProps} from '../../src/index';

const SIZE = 256;
const MARGIN = 20;
const ZOOM = 10;
const DEGREES_PER_PIXEL = 360 / (512 * 2 ** ZOOM);
const CENTER: MapViewState = {longitude: 0, latitude: 0, zoom: ZOOM, pitch: 0, bearing: 0};

type Target = {position: [number, number, number]};

let deck: Deck<View> | undefined;
let device: Device | undefined;
let container: HTMLDivElement | undefined;

beforeEach(async () => {
  container = document.createElement('div');
  container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
  document.body.appendChild(container);
  device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {container, width: SIZE, height: SIZE, useDevicePixels: false}
  });
});

afterEach(() => {
  deck?.finalize();
  device?.destroy();
  container?.remove();
  deck = undefined;
  device = undefined;
});

function readFrame(): Uint8Array {
  const gl = (device as WebGLDevice).gl;
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

/** Red pixels in a box around (x, y), top-left pixel coordinates. */
function countRed(pixels: Uint8Array, x: number, y: number, radius = 12): number {
  let count = 0;
  for (let j = Math.max(0, y - radius); j < Math.min(SIZE, y + radius); j++) {
    for (let i = Math.max(0, x - radius); i < Math.min(SIZE, x + radius); i++) {
      const index = ((SIZE - 1 - j) * SIZE + i) * 4;
      if (pixels[index] > 150 && pixels[index + 1] < 80 && pixels[index + 2] < 80) count++;
    }
  }
  return count;
}

function makeLayer(data: Target[], props: Partial<EdgeMarkerLayerProps<Target>> = {}) {
  return new EdgeMarkerLayer<Target>({
    id: 'edge-markers',
    data,
    getPosition: d => d.position,
    getColor: [255, 0, 0, 255],
    margins: MARGIN,
    devicePixelRatio: 1,
    ...props
  });
}

/** Render until the icon atlas is loaded, then resolve with the second loaded frame. */
function renderLoaded(
  viewState: Record<string, unknown>,
  layer: EdgeMarkerLayer<Target>,
  view: View = new MapView({})
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    let loadedFrames = 0;
    deck = new Deck<View>({
      device,
      parent: container,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      // Draw every frame through the normal frame loop (layer updates, then draw).
      _animate: true,
      views: view,
      viewState,
      layers: [layer],
      onError: reject,
      onAfterRender: () => {
        if (!layer.isLoaded || loadedFrames++ < 1) {
          return;
        }
        const pixels = readFrame();
        deck!.setProps({onAfterRender: () => {}});
        resolve(pixels);
      }
    });
  });
}

/** Resolve with the very first frame drawn after `viewState` changes. */
function renderFirstFrameAfter(viewState: MapViewState): Promise<Uint8Array> {
  return new Promise(resolve => {
    deck!.setProps({
      viewState,
      onAfterRender: () => {
        const pixels = readFrame();
        deck!.setProps({onAfterRender: () => {}});
        resolve(pixels);
      }
    });
  });
}

describe('EdgeMarkerLayer rendering', () => {
  it('docks an off-screen target to the margin on its side', async () => {
    const east: Target = {position: [SIZE * DEGREES_PER_PIXEL * 3, 0, 0]};
    const pixels = await renderLoaded(CENTER, makeLayer([east]));
    // The arrow tip is on the margin edge; the arrow body extends inward from it.
    expect(countRed(pixels, SIZE - MARGIN, SIZE / 2)).toBeGreaterThan(20);
    expect(countRed(pixels, MARGIN, SIZE / 2)).toBe(0);
    expect(countRed(pixels, SIZE / 2, SIZE / 2)).toBe(0);
  });

  it('docks a target behind the camera on its own side, not the mirrored side', async () => {
    // Pitched camera: a ground point far to the south is behind the camera plane.
    const pitched = {...CENTER, pitch: 60};
    const south: Target = {position: [0, -SIZE * DEGREES_PER_PIXEL * 40, 0]};
    const layer = makeLayer([south]);
    const pixels = await renderLoaded(pitched, layer);
    expect(layer.getEdgeMarkerFrame(deck!.getViewports()[0]).states[0]).toBe(3);
    expect(countRed(pixels, SIZE / 2, SIZE - MARGIN)).toBeGreaterThan(20);
    expect(countRed(pixels, SIZE / 2, MARGIN)).toBe(0);
  });

  it('moves markers in the same frame as the camera', async () => {
    // 30 px east of the center at ZOOM, so 60 px east at ZOOM + 1.
    const target: Target = {position: [30 * DEGREES_PER_PIXEL, 0, 0]};
    const before = await renderLoaded(CENTER, makeLayer([target]));
    expect(countRed(before, SIZE / 2 + 30, SIZE / 2, 8)).toBeGreaterThan(10);
    // A pan moves the anchor and the offsets together, so a one-frame lag would look right.
    // A zoom does not: a lagging marker stays at +30 px.
    const after = await renderFirstFrameAfter({...CENTER, zoom: ZOOM + 1});
    expect(countRed(after, SIZE / 2 + 60, SIZE / 2, 8)).toBeGreaterThan(10);
    expect(countRed(after, SIZE / 2 + 30, SIZE / 2, 8)).toBe(0);
  });

  it('hides targets outside the distance range', async () => {
    const target: Target = {position: [0, 0, 0]};
    const pixels = await renderLoaded(CENTER, makeLayer([target], {maxDistance: 10}));
    // Nothing anywhere: a hidden marker has no screen position.
    expect(countRed(pixels, SIZE / 2, SIZE / 2, SIZE)).toBe(0);
  });

  it('draws markers at their pixel size', async () => {
    const target: Target = {position: [0, 0, 0]};
    const pixels = await renderLoaded(CENTER, makeLayer([target], {onScreenIconSize: 22}));
    // The 22 px ring fits in a 24 px box. deck.gl billboards scale pixels by focalW / anchorW,
    // so a wrong anchor depth draws a larger ring.
    const inside = countRed(pixels, SIZE / 2, SIZE / 2, 12);
    expect(inside).toBeGreaterThan(20);
    expect(countRed(pixels, SIZE / 2, SIZE / 2, SIZE)).toBe(inside);
  });

  it('docks a target beyond the globe horizon in GlobeView, and the globe does not hide it', async () => {
    // The camera looks at (0, 0): a target at longitude 150 is on the far side, toward +x.
    const far: Target = {position: [150, 0, 0]};
    const layer = makeLayer([far]);
    const pixels = await renderLoaded(
      {longitude: 0, latitude: 0, zoom: 1},
      layer,
      new GlobeView({})
    );
    expect(layer.getEdgeMarkerFrame(deck!.getViewports()[0]).states[0]).toBe(4);
    expect(countRed(pixels, SIZE - MARGIN, SIZE / 2)).toBeGreaterThan(20);
    expect(countRed(pixels, MARGIN, SIZE / 2)).toBe(0);
  });

  it('docks a target behind the camera in FirstPersonView', async () => {
    // The camera looks north (bearing 0): a target 100 m to the south and 30 m to the west.
    const behind: Target = {position: [-0.00034, -0.0009, 120]};
    const layer = makeLayer([behind]);
    const pixels = await renderLoaded(
      {longitude: 0, latitude: 0, position: [0, 0, 120], pitch: 0, bearing: 0},
      layer,
      new FirstPersonView({})
    );
    const frame = layer.getEdgeMarkerFrame(deck!.getViewports()[0]);
    expect(frame.states[0]).toBe(3);
    // Behind and to the left: the marker docks on the left edge, not the right.
    expect(frame.positions[0]).toBe(MARGIN);
    expect(countRed(pixels, MARGIN, frame.positions[1])).toBeGreaterThan(20);
    expect(countRed(pixels, SIZE - MARGIN, frame.positions[1])).toBe(0);
  });
});
