// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, MapView, OrthographicView} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {luma, type Device} from '@luma.gl/core';
import {webgl2Adapter, type WebGLDevice} from '@luma.gl/core/webgl';
import {afterEach, expect, it} from 'vitest';
import {CORTAOEffect} from '../../src';

const SIZE = 256;
/** Half the side of the box, in degrees. About 33 meters. */
const BOX = 0.0003;
const VIEW_STATE = {longitude: 0, latitude: -0.0006, zoom: 16.5, pitch: 50, bearing: 0};

function createLayers() {
  return [
    new SolidPolygonLayer({
      id: 'ground',
      data: [
        [
          [-0.01, -0.01],
          [0.01, -0.01],
          [0.01, 0.01],
          [-0.01, 0.01]
        ]
      ],
      getPolygon: polygon => polygon,
      getFillColor: [200, 200, 200]
    }),
    new SolidPolygonLayer({
      id: 'box',
      data: [
        [
          [-BOX, -BOX],
          [BOX, -BOX],
          [BOX, BOX],
          [-BOX, BOX]
        ]
      ],
      extruded: true,
      getPolygon: polygon => polygon,
      getElevation: 80,
      getFillColor: [200, 200, 200]
    })
  ];
}

let deck: Deck | null = null;
let device: Device | null = null;

afterEach(() => {
  deck?.finalize();
  deck = null;
  device?.destroy();
  device = null;
});

/** Creates a deck on a WebGL 2 device and waits for the first frame. */
async function createDeck(effect: CORTAOEffect | null, views = new MapView()): Promise<Deck> {
  const container = document.createElement('div');
  container.style.cssText = `width: ${SIZE}px; height: ${SIZE}px`;
  document.body.append(container);
  const errors: string[] = [];
  device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {container, width: SIZE, height: SIZE, useDevicePixels: false},
    webgl: {preserveDrawingBuffer: true},
    onError: error => errors.push(error.message)
  });
  await new Promise<void>((resolve, reject) => {
    deck = new Deck({
      device: device!,
      parent: container,
      width: SIZE,
      height: SIZE,
      useDevicePixels: false,
      views,
      initialViewState: VIEW_STATE,
      effects: effect ? [effect] : [],
      layers: createLayers(),
      onError: reject,
      onAfterRender: () => resolve()
    });
  });
  deck!.redraw('test');
  expect(errors).toEqual([]);
  return deck!;
}

/** Reads one RGBA pixel of the canvas. `y` counts from the top, like deck.gl screen pixels. */
function readCanvasPixel(x: number, y: number): number[] {
  const gl = (device as WebGLDevice).gl;
  const pixel = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(Math.round(x), SIZE - 1 - Math.round(y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return Array.from(pixel);
}

/** Gets the screen pixel of a ground position. */
function project(lngLat: [number, number]): [number, number] {
  const [x, y] = deck!.getViewports()[0].project([...lngLat, 0]);
  return [x, y];
}

// Software GPUs in CI compile the CORTAO shaders slowly.
const TIMEOUT = 120000;

it('darkens only the ground at the base of an extruded box on WebGL 2', {
  timeout: TIMEOUT
}, async () => {
  const effect = new CORTAOEffect({showOcclusion: true});
  await createDeck(effect);

  // The camera looks north. The ground in front of the south face is in contact with the box.
  const base = project([0, -BOX - 0.00002]);
  const openGround = project([0, -BOX * 4]);
  expect(readCanvasPixel(...base)[0]).toBeLessThan(200);
  expect(readCanvasPixel(...openGround)[0]).toBeGreaterThan(235);

  effect.setProps({showOcclusion: false});
  deck!.redraw('test');
  const onBase = readCanvasPixel(...base);
  const onOpen = readCanvasPixel(...openGround);

  deck!.setProps({effects: []});
  deck!.redraw('test');
  const offBase = readCanvasPixel(...base);
  const offOpen = readCanvasPixel(...openGround);

  expect(onBase[0]).toBeLessThan(offBase[0] - 20);
  expect(Math.abs(onOpen[0] - offOpen[0])).toBeLessThanOrEqual(8);
});

it('passes the scene through for an orthographic view', {timeout: TIMEOUT}, async () => {
  const effect = new CORTAOEffect();
  await createDeck(effect, new OrthographicView() as unknown as MapView);
  deck!.setProps({initialViewState: {target: [0, 0, 0], zoom: 14}});
  deck!.redraw('test');
  const onPixel = readCanvasPixel(SIZE / 2, SIZE / 2);

  deck!.setProps({effects: []});
  deck!.redraw('test');
  const offPixel = readCanvasPixel(SIZE / 2, SIZE / 2);
  expect(offPixel[3]).toBe(255);
  expect(onPixel).toEqual(offPixel);
});
