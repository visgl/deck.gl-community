// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {
  getSplatImportanceOrder,
  packSplatCapture,
  toHalfFloat
} from '../../src/splat-layer/splat-capture';
import {
  createSplatSortScratch,
  SplatCaptureSorter,
  sortSplatCapture
} from '../../src/splat-layer/splat-capture-sort';
import {getSplatSourceFromGaussianSplats} from '../../src/splat-layer/splat-gaussian-table';
import {getSplatCaptureSource, SPLAT_CAPTURE_MIN_COUNT} from '../../src/splat-layer/splat-input';
import type {SplatSource} from '../../src/splat-layer/splat-source';

function makeSource(count: number, fill?: (i: number, source: SplatSource) => void): SplatSource {
  const source: SplatSource = {
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3).fill(0.1),
    rotations: new Float32Array(count * 4),
    colors: new Uint8Array(count * 4).fill(255),
    opacities: new Float32Array(count).fill(1)
  };
  for (let i = 0; i < count; i++) {
    source.rotations[i * 4] = 1;
    fill?.(i, source);
  }
  return source;
}

/** The float a half's bits encode. */
function fromHalfFloat(bits: number): number {
  const exponent = (bits >> 10) & 0x1f;
  const mantissa = bits & 0x3ff;
  const sign = bits & 0x8000 ? -1 : 1;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 31) return mantissa ? NaN : sign * Infinity;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

it('toHalfFloat rounds to the nearest half, including subnormals, and clamps overflow', () => {
  for (const value of [0, 1, -2.5, 0.1, 1e-3, 3.2e-5, 6e-8, 65504, 0.7071])
    expect(Math.abs(fromHalfFloat(toHalfFloat(value)) - value)).toBeLessThanOrEqual(
      Math.max(Math.abs(value) * 2 ** -11, 2 ** -25)
    );
  expect(fromHalfFloat(toHalfFloat(1e6))).toBe(65504);
  expect(fromHalfFloat(toHalfFloat(-1e6))).toBe(-65504);
  expect(toHalfFloat(1e-9)).toBe(0);
  expect(Number.isNaN(fromHalfFloat(toHalfFloat(NaN)))).toBe(true);
});

it('packs centre, colour, opacity, scale and rotation into two texels per Gaussian', () => {
  const source = makeSource(2, (i, s) => {
    s.positions.set([i + 0.25, 2 - i, 3], i * 3);
    s.scales.set([0.01, 0.02, 0.5], i * 3);
    s.rotations.set([0.5, 0.5, 0.5, 0.5], i * 4);
    s.colors.set([10, 20, 30, 255], i * 4);
    s.opacities[i] = i ? 0.5 : 1;
  });
  const capture = packSplatCapture(source, 64);
  expect(capture.width).toBe(64);
  expect(capture.height).toBe(1);
  expect(capture.antialiased).toBe(false);
  // the opaque Gaussian (index 0) is the more important one
  const floats = new Float32Array(capture.data.buffer);
  expect(Array.from(floats.slice(0, 3))).toEqual([0.25, 2, 3]);
  // centre and largest sigma, for the sorter
  expect(Array.from(capture.bounds)).toEqual([0.25, 2, 3, 0.5, 1.25, 1, 3, 0.5]);
  // RGB bytes span [-0.5, 1.5]: a byte v of a 0-255 colour packs as v / 2 + 63.75
  expect(capture.data[3]).toBe((69 | (74 << 8) | (79 << 16) | (255 << 24)) >>> 0);
  expect(capture.shDegree).toBe(0);
  expect(capture.sh).toBeNull();
  expect(capture.data[11] >>> 24).toBe(128);
  const half = (word: number, high: boolean) =>
    fromHalfFloat(high ? capture.data[word] >>> 16 : capture.data[word] & 0xffff);
  expect(half(4, false)).toBeCloseTo(0.01, 4);
  expect(half(4, true)).toBeCloseTo(0.02, 4);
  expect(half(5, false)).toBe(0.5);
  expect([half(5, true), half(6, false), half(6, true), half(7, false)]).toEqual([
    0.5, 0.5, 0.5, 0.5
  ]);
});

it('packs spherical-harmonic bands as SPZ bytes, 1 to 3 texels per Gaussian', () => {
  const degree1 = makeSource(2, (i, s) => {
    s.opacities[i] = i ? 0.5 : 1;
  });
  degree1.sphericalHarmonics = new Uint8Array(18).map((_, k) => k + 100);
  const capture = packSplatCapture(degree1, 64);
  expect([capture.shDegree, capture.shTexels, capture.shWidth, capture.shHeight]).toEqual([
    1, 1, 64, 1
  ]);
  const bytes = new Uint8Array(capture.sh!.buffer);
  expect(Array.from(bytes.slice(0, 9))).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108]);
  expect(Array.from(bytes.slice(16, 25))).toEqual([109, 110, 111, 112, 113, 114, 115, 116, 117]);

  // floats quantize as SPZ does; degree 3 needs three texels
  const degree3 = makeSource(1);
  degree3.sphericalHarmonics = new Float32Array(45).fill(-0.5);
  const dense = packSplatCapture(degree3, 64);
  expect([dense.shDegree, dense.shTexels]).toEqual([3, 3]);
  expect(new Uint8Array(dense.sh!.buffer)[44]).toBe(64);

  const odd = makeSource(1);
  odd.sphericalHarmonics = new Uint8Array(4);
  expect(() => packSplatCapture(odd, 64)).toThrow('3, 8 or 15');
});

it('keeps the antialiased flag and refuses captures larger than the device texture', () => {
  expect(packSplatCapture({...makeSource(1), antialiased: true}).antialiased).toBe(true);
  // 64 x 64 texels hold 2048 Gaussians
  expect(() => packSplatCapture(makeSource(2049), 64)).toThrow('at most 2048');
});

it('orders Gaussians by opacity times projected area, most important first', () => {
  const source = makeSource(4, (i, s) => {
    s.opacities[i] = [0.1, 1, 0, 0.5][i];
    s.scales.fill([1, 1, 1, 0.1][i], i * 3, i * 3 + 3);
  });
  // 0.1*3, 1*3, 0 (invisible, last), 0.5*0.03
  expect(Array.from(getSplatImportanceOrder(source))).toEqual([1, 0, 3, 2]);
});

/** A perspective camera at the origin looking down -z, like a deck.gl view matrix, column major. */
const LOOK_DOWN_Z = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.2002, 0];

/** XYZ plus a largest sigma per Gaussian. */
const toBounds = (centers: number[], sigma = 0.1) =>
  new Float32Array(centers.flatMap((v, i) => (i % 3 === 2 ? [v, sigma] : [v])));

it('sorts visible Gaussians back to front and culls behind and beside the camera', () => {
  // z = -1 near, -5 far, +2 behind the camera, x = 20 beside the frustum
  const bounds = toBounds([0, 0, -1, 0, 0, -5, 0, 0, 2, 20, 0, -2, 0.5, 0, -3]);
  const order = new Uint32Array(5);
  const count = sortSplatCapture(bounds, 5, LOOK_DOWN_Z, 3, order, createSplatSortScratch(5));
  expect(Array.from(order.subarray(0, count))).toEqual([1, 4, 0]);
  // a budget sorts only the first Gaussians
  expect(sortSplatCapture(bounds, 2, LOOK_DOWN_Z, 3, order, createSplatSortScratch(5))).toBe(2);
  expect(Array.from(order.subarray(0, 2))).toEqual([1, 0]);
});

it('keeps a Gaussian beside the frustum whose footprint reaches into it', () => {
  // centred 20 m to the side at 2 m depth: 3 sigma of 10 m reaches the view, of 0.1 m does not
  const order = new Uint32Array(1);
  const wide = toBounds([20, 0, -2], 10);
  expect(sortSplatCapture(wide, 1, LOOK_DOWN_Z, 3, order, createSplatSortScratch(1))).toBe(1);
  expect(
    sortSplatCapture(toBounds([20, 0, -2]), 1, LOOK_DOWN_Z, 3, order, createSplatSortScratch(1))
  ).toBe(0);
  // the support radius scales the reach
  expect(sortSplatCapture(wide, 1, LOOK_DOWN_Z, 0.5, order, createSplatSortScratch(1))).toBe(0);
});

it('sorts an orthographic view by clip depth', () => {
  // orthographic: w is constant, clip z grows away from the camera
  const ortho = [0.1, 0, 0, 0, 0, 0.1, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 1];
  const bounds = toBounds([0, 0, -1, 0, 0, -5, 0, 0, -3]);
  const order = new Uint32Array(3);
  expect(sortSplatCapture(bounds, 3, ortho, 3, order, createSplatSortScratch(3))).toBe(3);
  expect(Array.from(order)).toEqual([1, 2, 0]);
});

it('runs the same sort as worker source', () => {
  // the sort is stringified into the worker, so it must not reference anything outside itself
  const sort = new Function(`return (${sortSplatCapture.toString()})`)() as typeof sortSplatCapture;
  const bounds = toBounds([0, 0, -1, 0, 0, -5, 0.5, 0, -3]);
  const order = new Uint32Array(3);
  expect(sort(bounds, 3, LOOK_DOWN_Z, 3, order, createSplatSortScratch(3))).toBe(3);
  expect(Array.from(order)).toEqual([1, 2, 0]);
});

it('SplatCaptureSorter sorts synchronously without workers and reports when settled', () => {
  const received: number[][] = [];
  const sorter = new SplatCaptureSorter(toBounds([0, 0, -1, 0, 0, -5]), (order, count) =>
    received.push(Array.from(order.subarray(0, count)))
  );
  expect(sorter.settled).toBe(true);
  sorter.sort(new Float64Array(LOOK_DOWN_Z), Infinity);
  expect(received).toEqual([[1, 0]]);
  expect(sorter.settled).toBe(true);
  sorter.destroy();
});

it('converts decoded SPZ columns without copying, keeping the antialiased flag', () => {
  const columns = {
    splatCount: 1,
    positions: new Float32Array([1, 2, 3]),
    scales: new Float32Array([0.1, 0.1, 0.1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([10, 20, 30]),
    opacities: new Float32Array([1.4]),
    loaderData: {flags: 1}
  };
  const source = getSplatSourceFromGaussianSplats(columns);
  expect(source.positions).toBe(columns.positions);
  expect(Array.from(source.colors)).toEqual([10, 20, 30, 255]);
  expect(source.opacities[0]).toBe(1);
  expect(source.antialiased).toBe(true);
  expect(getSplatSourceFromGaussianSplats({...columns, loaderData: {}}).antialiased).toBe(false);
});

it('takes SPZ colour from the DC terms, unclamped, and keeps the higher bands as bytes', () => {
  // loaders.gl's SPZ `colors` are the stored bytes (0.5 + 0.15 dc), not display colour
  const source = getSplatSourceFromGaussianSplats({
    splatCount: 1,
    positions: new Float32Array(3),
    scales: new Float32Array([0.1, 0.1, 0.1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([166, 128, 89]),
    sphericalHarmonicDcs: new Float32Array([1, 0, -3]),
    sphericalHarmonics: new Float32Array([0, 0.5, -1, 0.25, 0, 0, 0, 0, 0.9921875]),
    opacities: new Float32Array([0.5])
  });
  const color = Array.from(source.colors);
  expect(color[0]).toBeCloseTo(0.5 + 0.2820948, 6);
  expect(color[1]).toBe(0.5);
  expect(color[2]).toBeCloseTo(0.5 - 3 * 0.2820948, 6);
  expect(color[3]).toBe(1);
  expect(Array.from(source.sphericalHarmonics!)).toEqual([
    128, 192, 0, 160, 128, 128, 128, 128, 255
  ]);
});

it('treats splat files and large direct sources as captures', () => {
  const large = makeSource(SPLAT_CAPTURE_MIN_COUNT);
  expect(getSplatCaptureSource(large)).toBe(large);
  expect(getSplatCaptureSource({type: 'prepared-splats', source: large})).toBe(large);
  // a template with an authored hierarchy keeps the owner path
  expect(
    getSplatCaptureSource({
      type: 'prepared-splats',
      source: large,
      hierarchy: [{source: large, error: 0}]
    })
  ).toBeNull();
  expect(getSplatCaptureSource(makeSource(10))).toBeNull();
  expect(getSplatCaptureSource([{splats: large, position: [0, 0, 0]}])).toBeNull();
  // a file is a capture before it loads
  expect(getSplatCaptureSource('/never-fetched-in-this-test.spz')).toBeUndefined();
});
