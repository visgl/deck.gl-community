// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {rasterizeParticleWindField} from '../../src/wind-layer/gpu-particle-simulation';
import {createWindField, type WindStation} from '../../src/wind-layer/wind-data';

const STATIONS: WindStation[] = [
  {name: 'southwest', long: 2, lat: 0, elv: 10},
  {name: 'southeast', long: 0, lat: 0, elv: 20},
  {name: 'northwest', long: 2, lat: 2, elv: 30},
  {name: 'northeast', long: 0, lat: 2, elv: 40}
];

const FIELD = createWindField(STATIONS, [
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
]);

describe('GPU wind-particle rasterization', () => {
  it('encodes normalized eastward wind, terrain elevation, and valid coverage', () => {
    const raster = rasterizeParticleWindField(FIELD, 0, 3, 3);
    const center = (1 * 3 + 1) * 4;

    expect(raster).toHaveLength(3 * 3 * 4);
    expect(raster[center]).toBeGreaterThan(0);
    expect(raster[center + 1]).toBeCloseTo(0);
    expect(raster[center + 2]).toBeCloseTo(25);
    expect(raster[center + 3]).toBe(1);
  });

  it('updates wind direction for a new hourly weather texture', () => {
    const first = rasterizeParticleWindField(FIELD, 0, 1, 1);
    const next = rasterizeParticleWindField(FIELD, 1, 1, 1);

    expect(first[0]).toBeGreaterThan(0);
    expect(first[1]).toBeCloseTo(0);
    expect(next[0]).toBeCloseTo(0);
    expect(next[1]).toBeGreaterThan(0);
    expect(next[3]).toBe(1);
  });

  it('rejects invalid GPU weather-texture dimensions', () => {
    expect(() => rasterizeParticleWindField(FIELD, 0, 0, 8)).toThrow('positive integer');
    expect(() => rasterizeParticleWindField(FIELD, 0, 8, 1.5)).toThrow('positive integer');
  });
});
