// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {
  createWindField,
  DelaunayInterpolation,
  getWindBounds,
  parseWindData,
  sampleWindField,
  triangulateWindStations,
  type WindMeasurement,
  type WindStation
} from '../../src';

const STATIONS: WindStation[] = [
  {name: 'southwest', long: 2, lat: 0, elv: 10},
  {name: 'southeast', long: 0, lat: 0, elv: 20},
  {name: 'northwest', long: 2, lat: 2, elv: 30},
  {name: 'northeast', long: 0, lat: 2, elv: 40}
];

const FRAMES: WindMeasurement[][] = [
  [
    [0, 10, 20],
    [0, 20, 30],
    [0, 30, 40],
    [0, 40, 50]
  ],
  [
    [2, 20, 30],
    [2, 30, 40],
    [2, 40, 50],
    [2, 50, 60]
  ]
];

describe('wind showcase data', () => {
  it('parses the original station-major binary weather format', () => {
    const values = new Uint16Array([
      0, 10, 20, 2, 20, 30, 0, 20, 30, 2, 30, 40, 0, 30, 40, 2, 40, 50, 0, 40, 50, 2, 50, 60
    ]);

    expect(parseWindData(values.buffer, STATIONS.length, 2)).toEqual(FRAMES);
  });

  it('rejects truncated and mismatched weather binaries', () => {
    expect(() => parseWindData(new Uint8Array([1]).buffer, 1, 1)).toThrow(
      'complete unsigned 16-bit'
    );
    expect(() => parseWindData(new Uint16Array([1, 2, 3]).buffer, 2, 1)).toThrow(
      'Expected 6 wind measurements'
    );
  });

  it('converts original positive-west station longitudes into geographic bounds', () => {
    expect(getWindBounds(STATIONS)).toEqual({minLng: -2, minLat: 0, maxLng: 0, maxLat: 2});
  });

  it('triangulates the complete station coverage', () => {
    const triangles = triangulateWindStations(STATIONS);

    expect(triangles).toHaveLength(2);
    expect(new Set(triangles.flat())).toEqual(new Set([0, 1, 2, 3]));
  });

  it('ignores duplicate station coordinates without creating degenerate triangles', () => {
    const triangles = triangulateWindStations([...STATIONS, {...STATIONS[0], name: 'duplicate'}]);

    expect(triangles).toHaveLength(2);
    expect(triangles.flat()).not.toContain(4);
  });

  it('interpolates station speed, temperature, and elevation barycentrically', () => {
    const field = createWindField(STATIONS, FRAMES);
    const sample = sampleWindField(field, [-1, 1], 0);

    expect(sample).not.toBeNull();
    expect(sample?.direction).toBeCloseTo(0);
    expect(sample?.speed).toBeCloseTo(25);
    expect(sample?.temperature).toBeCloseTo(35);
    expect(sample?.elevation).toBeCloseTo(25);
    expect(sample?.velocity[0]).toBeCloseTo(25);
  });

  it('interpolates wind direction circularly between weather frames', () => {
    const field = createWindField(STATIONS, FRAMES);
    const sample = sampleWindField(field, [-1, 1], 0.5);

    expect(sample?.direction).toBeCloseTo(Math.PI / 4);
    expect(sample?.speed).toBeCloseTo(30);
    expect(sample?.temperature).toBeCloseTo(40);
  });

  it('wraps fractional animation time in either direction', () => {
    const field = createWindField(STATIONS, FRAMES);

    expect(sampleWindField(field, [-1, 1], 2.5)).toEqual(sampleWindField(field, [-1, 1], 0.5));
    expect(sampleWindField(field, [-1, 1], -0.5)).toEqual(sampleWindField(field, [-1, 1], 1.5));
  });

  it('does not extrapolate beyond station coverage', () => {
    const field = createWindField(STATIONS, FRAMES);

    expect(sampleWindField(field, [-3, 1])).toBeNull();
    expect(sampleWindField(field, [-1, 3])).toBeNull();
  });

  it('validates station and frame alignment', () => {
    expect(() => createWindField(STATIONS.slice(0, 2), FRAMES)).toThrow('at least three');
    expect(() => createWindField(STATIONS, [FRAMES[0].slice(0, 3)])).toThrow(
      'one measurement for every station'
    );
  });

  it('rasterizes interpolated direction, speed, temperature, and elevation', () => {
    const interpolation = new DelaunayInterpolation({
      field: createWindField(STATIONS, FRAMES),
      width: 3,
      height: 3
    });
    const raster = interpolation.rasterize(0.5);
    const centerOffset = (1 * raster.width + 1) * 4;

    expect(raster.width).toBe(3);
    expect(raster.height).toBe(3);
    expect(raster.data).toHaveLength(36);
    expect(raster.data[centerOffset]).toBeCloseTo(Math.PI / 4);
    expect(raster.data[centerOffset + 1]).toBeCloseTo(30);
    expect(raster.data[centerOffset + 2]).toBeCloseTo(40);
    expect(raster.data[centerOffset + 3]).toBeCloseTo(25);
  });

  it('validates raster dimensions', () => {
    const field = createWindField(STATIONS, FRAMES);

    expect(() => new DelaunayInterpolation({field, width: 1})).toThrow('width');
    expect(() => new DelaunayInterpolation({field, height: 1})).toThrow('height');
  });
});
