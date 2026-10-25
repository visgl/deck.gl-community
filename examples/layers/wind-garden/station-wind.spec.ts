// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createWindField, sampleWindField} from '@deck.gl-community/geo-layers';
import {getWindVelocity} from '@deck.gl-community/layers';
import {describe, expect, it} from 'vitest';
import {
  GARDEN_CENTER,
  GARDEN_STATION_WIND,
  GARDEN_WIND_FIELD,
  getWindSampleBearing,
  sampleStationWind
} from './station-wind';

describe('station wind', () => {
  it('turns counterclockwise-from-east travel directions into compass bearings', () => {
    // Eighth-turns from east: east, northeast, north, ... southeast.
    const bearings = Array.from({length: 8}, (_, turn) =>
      getWindSampleBearing((turn * Math.PI) / 4)
    );
    [90, 45, 0, 315, 270, 225, 180, 135].forEach((value, i) =>
      expect(bearings[i]).toBeCloseTo(value, 9)
    );
    expect(getWindSampleBearing(-Math.PI / 2)).toBeCloseTo(180, 9);
    expect(getWindSampleBearing(2 * Math.PI + 0.1)).toBeCloseTo(90 - (0.1 * 180) / Math.PI, 9);
  });

  it('keeps every interpolated sample blowing the way geo-layers moves its particles', () => {
    const field = createWindField(
      [
        {name: 'a', long: 1, lat: -1, elv: 0},
        {name: 'b', long: -1, lat: -1, elv: 0},
        {name: 'c', long: 0, lat: 1, elv: 0}
      ],
      [
        [
          [0, 4, 10],
          [2, 8, 10],
          [5, 6, 10]
        ]
      ]
    );
    for (const position of [
      [0, -0.5],
      [-0.6, -0.9],
      [0.5, -0.8],
      [0, 0.8]
    ] as [number, number][]) {
      const sample = sampleWindField(field, position)!;
      const bearing = getWindSampleBearing(sample.direction);
      // `WindSample.velocity` is the east/north travel; WindEffect's helpers agree with it.
      const [east, north] = getWindVelocity({speed: sample.speed, direction: bearing}, 10);
      expect(east).toBeCloseTo(sample.velocity[0], 9);
      expect(north).toBeCloseTo(sample.velocity[1], 9);
    }
    // Sampling reports garden metres in m/s and bearings, and nothing outside the stations.
    const center = sampleStationWind(GARDEN_WIND_FIELD, GARDEN_CENTER)!;
    expect(center.speed).toBeCloseTo(6, 9);
    expect(center.direction).toBeCloseTo(45, 9);
    expect(sampleStationWind(GARDEN_WIND_FIELD, [500, 0])).toBeNull();
    // The garden's one wind is the field at its centre.
    expect(GARDEN_STATION_WIND).toEqual(center);
  });
});
