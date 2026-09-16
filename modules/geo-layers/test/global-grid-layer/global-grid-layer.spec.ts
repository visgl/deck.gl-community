// deck.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {GlobalGridLayer} from '../../src/global-grid-layer/global-grid-layer';
import {type GlobalGrid} from '../../src/global-grid-systems/grids/global-grid';
import {A5Grid} from '../../src/global-grid-systems/grids/a5-grid';
import {H3Grid} from '../../src/global-grid-systems/grids/h3-grid';

function getPolygon(globalGrid: GlobalGrid, cellId: string | bigint = 'cell'): number[] {
  const data = [{cellId}];
  const layer = new GlobalGridLayer({id: 'grid-test', data, globalGrid});
  const props = layer.indexToBounds()!;
  expect(props._normalize).toBe(true);
  const getBoundary = props.getPolygon as (
    object: {cellId: string | bigint},
    info: any
  ) => Float64Array;
  return Array.from(getBoundary(data[0], {index: 0, data, target: []}));
}

describe('GlobalGridLayer boundaries', () => {
  it.each([1, -1])('unwraps crossings in direction %s without mutating cached boundaries', sign => {
    const boundary: [number, number][] = [
      [179 * sign, 10],
      [-179 * sign, 10],
      [-179 * sign, 12],
      [179 * sign, 12]
    ];
    const original = structuredClone(boundary);
    const grid: GlobalGrid = {
      name: 'test',
      hasNumericRepresentation: false,
      cellToLngLat: () => [180, 11],
      cellToBoundary: () => boundary
    };
    const expected = [
      179 * sign,
      10,
      181 * sign,
      10,
      181 * sign,
      12,
      179 * sign,
      12,
      179 * sign,
      10
    ];
    expect(getPolygon(grid)).toEqual(expected);
    expect(getPolygon(grid)).toEqual(expected);
    expect(boundary).toEqual(original);
  });

  it('preserves ordinary, already closed boundaries', () => {
    const boundary: [number, number][] = [
      [10, 10],
      [12, 10],
      [12, 12],
      [10, 12],
      [10, 10]
    ];
    expect(
      getPolygon({
        name: 'test',
        hasNumericRepresentation: false,
        cellToLngLat: () => [11, 11],
        cellToBoundary: () => boundary
      })
    ).toEqual(boundary.flat());
  });

  it.each([A5Grid, H3Grid])('keeps real $name antimeridian cells local', grid => {
    const cell = grid.lngLatToCell([180, 10], 3);
    const rawBoundary = grid.cellToBoundary(cell);
    // A5 already unwraps its boundary; wrap it back to verify this fixture crosses the seam.
    const rawLongitudes = rawBoundary.map(point => ((point[0] + 540) % 360) - 180);
    expect(Math.max(...rawLongitudes) - Math.min(...rawLongitudes)).toBeGreaterThan(180);
    const polygon = getPolygon(grid, cell);
    const longitudes = polygon.filter((_, index) => index % 2 === 0);
    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBeLessThan(30);
    expect(polygon.slice(-2)).toEqual(polygon.slice(0, 2));
    for (let i = 1; i < polygon.length; i += 2) {
      expect(Math.abs(polygon[i] - 10)).toBeLessThan(15);
    }
  });
});
