// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck, GlobeView, type Layer} from '@deck.gl/core';
import {parse} from '@loaders.gl/core';
import {OMMLoader, type OMMRow} from '@loaders.gl/scientific/omm';
import {luma, Buffer, Texture, type Device, type Framebuffer} from '@luma.gl/core';
import {webgl2Adapter} from '@luma.gl/core/webgl';
import {webgpuAdapter} from '@luma.gl/core/webgpu';
import {getTestDevice} from '@luma.gl/core/test-utils';
import {gstime} from 'satellite.js';
import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  OrbitLayer,
  createSatRec,
  propagateToLngLatAlt,
  toGpRecords,
  type OrbitLayerProps,
  type OrbitSatellite
} from '@deck.gl-community/layers/space-layers';
import {requireWebGPUAdapter} from '../../common-layers/webgpu-test-utils';
import fixture from './data/gp-fixture.omm.json';

const SIZE = 256;
const ISS = 25544;
const TIME_MS = Date.UTC(2026, 10, 24);
const FIXTURE_TEXT = JSON.stringify(fixture);
const FIXTURE_URL = new URL('./data/gp-fixture.omm.json', import.meta.url).href;
const ROWS = ((await parse(FIXTURE_TEXT, OMMLoader, {omm: {shape: 'object-row-table'}})) as any)
  .data as OMMRow[];
const ISS_SATREC = createSatRec(toGpRecords(ROWS).find(record => record.noradId === ISS)!)!;

/** The ISS position at `timeMs`, as SGP4 gives it. */
function getIssPosition(timeMs: number): [number, number, number] {
  const date = new Date(timeMs);
  const target = new Float64Array(3);
  propagateToLngLatAlt(ISS_SATREC, date, gstime(date), target, 0);
  return [target[0], target[1], target[2]];
}

const ISS_START = getIssPosition(TIME_MS);

/** The fixture without the objects that fly with the ISS (docked vehicles), for picking. */
const ROWS_APART_FROM_ISS = ROWS.filter(row => {
  if (row.NORAD_CAT_ID === ISS) {
    return true;
  }
  const satrec = createSatRec(toGpRecords([row])[0]);
  const date = new Date(TIME_MS);
  const position = new Float64Array(3);
  if (!satrec || !Number.isFinite(propagateToLngLatAlt(satrec, date, gstime(date), position, 0))) {
    return true;
  }
  return Math.hypot(position[0] - ISS_START[0], position[1] - ISS_START[1]) > 2;
});

type TestContext = {
  deck: Deck<GlobeView>;
  device: Device;
  errors: Error[];
  setLayer: (props: Partial<OrbitLayerProps>) => void;
  getSubLayer: (name: string) => Layer | undefined;
  getLayer: () => OrbitLayer;
  waitFor: (predicate: () => boolean, message: string, timeoutMs?: number) => Promise<void>;
  readPixels: () => Promise<Uint8Array>;
};

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

async function createTestContext(
  backend: 'webgl' | 'webgpu',
  skip: (message: string) => void
): Promise<TestContext | null> {
  if (backend === 'webgpu') {
    await requireWebGPUAdapter(skip);
  }
  if (!(await getTestDevice(backend))) {
    skip(`${backend} unavailable`);
    return null;
  }
  const parent = document.createElement('div');
  parent.style.width = `${SIZE}px`;
  parent.style.height = `${SIZE}px`;
  document.body.append(parent);
  const canvas = document.createElement('canvas');
  canvas.style.width = `${SIZE}px`;
  canvas.style.height = `${SIZE}px`;
  parent.append(canvas);
  const device = await luma.createDevice({
    type: backend,
    adapters: [webgpuAdapter, webgl2Adapter],
    createCanvasContext: {canvas, width: SIZE, height: SIZE, useDevicePixels: false}
  });
  const texture = device.createTexture({
    width: SIZE,
    height: SIZE,
    format: 'rgba8unorm',
    usage: Texture.RENDER | Texture.COPY_SRC
  });
  const framebuffer: Framebuffer = device.createFramebuffer({
    width: SIZE,
    height: SIZE,
    colorAttachments: [texture],
    depthStencilAttachment: 'depth24plus'
  });
  const errors: Error[] = [];
  const deck = new Deck({
    device,
    parent,
    width: SIZE,
    height: SIZE,
    useDevicePixels: false,
    _framebuffer: framebuffer,
    views: new GlobeView(),
    initialViewState: {longitude: ISS_START[0], latitude: ISS_START[1], zoom: 0},
    layers: [],
    onError: error => {
      errors.push(error);
    }
  });
  let layerProps: Partial<OrbitLayerProps> = {};

  cleanup = () => {
    deck.finalize();
    framebuffer.destroy();
    texture.destroy();
    device.destroy();
    parent.remove();
  };

  const getLayers = () =>
    (deck as unknown as {layerManager?: {getLayers(): Layer[]}}).layerManager?.getLayers() ?? [];
  const context: TestContext = {
    deck,
    device,
    errors,
    setLayer(props) {
      layerProps = {...layerProps, ...props};
      deck.setProps({
        layers: [
          new OrbitLayer({
            id: 'orbits',
            data: [],
            currentTime: TIME_MS,
            propagation: 'main-thread',
            pickable: true,
            ...layerProps
          })
        ]
      });
    },
    getSubLayer: name => getLayers().find(layer => layer.id === `orbits-${name}`),
    getLayer: () => getLayers().find(layer => layer.id === 'orbits') as OrbitLayer,
    async waitFor(predicate, message, timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > deadline) {
          throw new Error(`Timed out: ${message}`);
        }
        deck.redraw('orbit layer test');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
    },
    async readPixels() {
      // Two frames, so the latest attributes are drawn.
      for (let i = 0; i < 2; i++) {
        deck.redraw('orbit layer test');
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      device.submit();
      const buffer = device.createBuffer({
        byteLength: texture.computeMemoryLayout().byteLength,
        usage: Buffer.COPY_DST | Buffer.MAP_READ
      });
      try {
        texture.readBuffer({}, buffer);
        device.submit();
        return new Uint8Array(await buffer.readAsync()).slice();
      } finally {
        buffer.destroy();
      }
    }
  };
  return context;
}

function getNumInstances(context: TestContext): number {
  return context.getSubLayer('satellites')?.getNumInstances() ?? -1;
}

/** True when the layer shows a sample of its current data. */
function hasSample(context: TestContext): boolean {
  const state = context.getLayer()?.state;
  return Boolean(
    state?.dataset &&
      state.dataset.generation === state.generation &&
      state.sampleB?.generation === state.generation
  );
}

/** Returns the maximum alpha in a 7 × 7 window around a pixel, in both row orders. */
function getAlphaNear(pixels: Uint8Array, x: number, y: number): number {
  let alpha = 0;
  for (const row of [Math.round(y), SIZE - 1 - Math.round(y)]) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = Math.round(x) + dx;
        const py = row + dy;
        if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
          alpha = Math.max(alpha, pixels[(py * SIZE + px) * 4 + 3]);
        }
      }
    }
  }
  return alpha;
}

function getIssScreenPosition(context: TestContext): number[] {
  const viewport = context.deck.getViewports()[0];
  return viewport.project(ISS_START);
}

function expectNearIss(position: number[], timeMs: number): void {
  const expected = getIssPosition(timeMs);
  expect(Math.abs(position[0] - expected[0])).toBeLessThan(0.05);
  expect(Math.abs(position[1] - expected[1])).toBeLessThan(0.05);
  expect(Math.abs(position[2] - expected[2])).toBeLessThan(1000);
}

describe.for(['webgl', 'webgpu'] as const)('OrbitLayer on %s', backend => {
  it(`draws the 224-satellite fixture on GlobeView (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    context.setLayer({data: FIXTURE_TEXT});
    await context.waitFor(
      () => getNumInstances(context) === 224 && hasSample(context),
      '224 satellites'
    );
    const pixels = await context.readPixels();
    const [x, y] = getIssScreenPosition(context);
    expect(getAlphaNear(pixels, x, y)).toBeGreaterThan(0);
    // A corner of the view has no satellite.
    expect(pixels[3]).toBe(0);
    expect(context.errors).toEqual([]);
  });

  it(`picking returns the satellite (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    context.setLayer({data: ROWS_APART_FROM_ISS});
    await context.waitFor(() => hasSample(context), 'a sample');
    await context.readPixels();
    const [x, y] = getIssScreenPosition(context);
    const info = await context.deck.pickObjectAsync({x, y, radius: 2});
    const satellite = info?.object as OrbitSatellite;
    expect(satellite.noradId).toBe(ISS);
    expect(satellite.name).toBe('ISS (ZARYA)');
    expect(satellite.orbitClass).toBe('LEO');
    expect(satellite.periodMinutes).toBeGreaterThan(90);
    expect(satellite.speedKmS).toBeGreaterThan(7);
    expectNearIss(satellite.position!, TIME_MS);
  });

  it(`the selected orbit and ground track draw (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    context.setLayer({data: ROWS, selectedNoradId: ISS});
    await context.waitFor(
      () => Boolean(context.getSubLayer('orbit') && context.getSubLayer('ground-track')),
      'orbit and ground track'
    );
    const orbit = context.getSubLayer('orbit')!.props.data as number[][][];
    expect(orbit[0].length).toBe(181);
    const groundTrack = context.getSubLayer('ground-track')!.props.data as number[][][];
    expect(groundTrack[0].length).toBe(361);
    expect(groundTrack[0].every(point => point[2] === 0)).toBe(true);
    await context.waitFor(() => Boolean(context.getSubLayer('selected')), 'selected ring');
    context.setLayer({showOrbit: false, showGroundTrack: false});
    await context.waitFor(() => !context.getSubLayer('orbit'), 'orbit hidden');
    expect(context.getSubLayer('ground-track')).toBeUndefined();
    expect(context.errors).toEqual([]);
  });

  it(`an unknown selected id draws no paths (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const onSelectedPositionChange = vi.fn();
    const onError = vi.fn();
    context.setLayer({data: ROWS, selectedNoradId: 1, onSelectedPositionChange, onError});
    await context.waitFor(() => hasSample(context), 'a sample');
    context.setLayer({currentTime: TIME_MS + 1000});
    await context.readPixels();
    expect(context.getSubLayer('orbit')).toBeUndefined();
    expect(context.getSubLayer('ground-track')).toBeUndefined();
    expect(context.getSubLayer('selected')).toBeUndefined();
    expect(onSelectedPositionChange).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(context.errors).toEqual([]);
  });

  it(`a late data reply after a data change is dropped (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const rowsA = ROWS.slice(0, 10);
    const rowsB = ROWS.slice(10);
    let resolveA: (() => void) | null = null;
    const fetch = vi.fn(
      (url: string) =>
        new Promise(resolve => {
          resolveA = () => resolve({shape: 'object-row-table', data: rowsA});
        })
    );
    const onDataLoad = vi.fn();
    context.setLayer({data: '/slow-a.json', fetch, onDataLoad} as Partial<OrbitLayerProps>);
    await context.waitFor(() => fetch.mock.calls.length === 1, 'fetch A');
    context.setLayer({data: rowsB});
    await context.waitFor(() => getNumInstances(context) === rowsB.length, 'data B');
    resolveA!();
    // Two rows of data A and B in a row: the second must win over the first init too.
    await context.readPixels();
    expect(getNumInstances(context)).toBe(rowsB.length);
    expect(onDataLoad).toHaveBeenCalledTimes(1);
    expect(onDataLoad).toHaveBeenCalledWith({satellites: rowsB.length, rejected: 0});

    context.setLayer({data: rowsA});
    context.setLayer({data: rowsB.slice(0, 20)});
    await context.waitFor(() => onDataLoad.mock.calls.length === 2, 'second load');
    await context.readPixels();
    expect(onDataLoad).toHaveBeenCalledTimes(2);
    expect(getNumInstances(context)).toBe(20);
    expect(context.errors).toEqual([]);
  });

  it(`empty data reports zero satellites (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const onDataLoad = vi.fn();
    const onError = vi.fn();
    context.setLayer({data: [], onDataLoad, onError});
    await context.waitFor(() => onDataLoad.mock.calls.length === 1, 'empty load');
    expect(onDataLoad).toHaveBeenLastCalledWith({satellites: 0, rejected: 0});
    // An eccentricity above 1 is not an ellipse, so SGP4 rejects the element set.
    context.setLayer({data: [{...ROWS[0], ECCENTRICITY: 1.5}]});
    await context.waitFor(() => onDataLoad.mock.calls.length === 2, 'invalid load');
    expect(onDataLoad).toHaveBeenLastCalledWith({satellites: 0, rejected: 1});
    await context.readPixels();
    expect(getNumInstances(context)).toBe(0);
    expect(onError).not.toHaveBeenCalled();
    expect(context.errors).toEqual([]);
  });

  it(`onSelectedPositionChange follows the interpolated position (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const calls: {position: number[]; satellite: OrbitSatellite}[] = [];
    const onSelectedPositionChange = (position: number[], satellite: OrbitSatellite) =>
      calls.push({position, satellite});
    context.setLayer({data: ROWS, selectedNoradId: ISS, onSelectedPositionChange});
    await context.waitFor(() => calls.length > 0, 'first position');
    const first = calls[calls.length - 1];
    expect(first.satellite.noradId).toBe(ISS);
    expectNearIss(first.position, TIME_MS);

    const later = TIME_MS + 10000;
    context.setLayer({currentTime: later});
    await context.waitFor(() => {
      const {position} = calls[calls.length - 1];
      return Math.abs(position[0] - getIssPosition(later)[0]) < 0.05;
    }, 'second position');
    const second = calls[calls.length - 1];
    expect(second.position).not.toEqual(first.position);
    expectNearIss(second.position, later);
    expect(context.errors).toEqual([]);
  });

  it(`worker mode draws the fixture (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const onDataLoad = vi.fn();
    context.setLayer({data: FIXTURE_URL, propagation: 'worker', onDataLoad});
    await context.waitFor(
      () => getNumInstances(context) === 224 && hasSample(context),
      '224 satellites from the worker'
    );
    expect(onDataLoad).toHaveBeenCalledWith({satellites: 224, rejected: 0});
    expect(context.errors).toEqual([]);
  });

  it(`accessors run once per data load (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const getColor = vi.fn((): [number, number, number, number] => [255, 0, 0, 255]);
    context.setLayer({data: ROWS, getColor});
    await context.waitFor(() => hasSample(context), 'a sample');
    for (let i = 1; i <= 10; i++) {
      context.setLayer({currentTime: TIME_MS + i * 1000});
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    await context.readPixels();
    expect(getColor).toHaveBeenCalledTimes(224);
    expect(context.errors).toEqual([]);
  });

  it(`switching propagation keeps the satellites (${backend})`, async ({skip}) => {
    const context = (await createTestContext(backend, skip))!;
    const getIssRow = () => {
      const state = context.getLayer().state;
      const row = state.dataset.satellites.findIndex((d: OrbitSatellite) => d.noradId === ISS);
      return Array.from(state.positions.subarray(row * 3, row * 3 + 3)) as number[];
    };
    const isFrom = (mode: string) => () => {
      const state = context.getLayer()?.state;
      return hasSample(context) && state.propagatorMode === mode;
    };
    context.setLayer({data: ROWS});
    await context.waitFor(isFrom('main-thread'), 'main-thread sample');
    const reference = getIssRow();
    for (const mode of ['worker', 'main-thread'] as const) {
      context.setLayer({propagation: mode});
      await context.waitFor(isFrom(mode), `${mode} sample`);
      expect(getNumInstances(context)).toBe(224);
      const position = getIssRow();
      for (let k = 0; k < 2; k++) {
        expect(Math.abs(position[k] - reference[k])).toBeLessThan(1e-6);
      }
      expect(Math.abs(position[2] - reference[2])).toBeLessThan(1e-3);
    }
    expect(context.errors).toEqual([]);
  });
});
