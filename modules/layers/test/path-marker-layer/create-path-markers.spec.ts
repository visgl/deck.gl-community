// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {createPathMarkers} from '../../src/path-marker-layer/create-path-markers';

const data = [
  {
    path: [[0, 0] as [number, number], [10, 0] as [number, number]],
    direction: {
      forward: true,
      backward: false
    }
  }
];

describe('createPathMarkers', () => {
  it('uses projected line length when resolving marker percentages', () => {
    const getMarkerPercentages = vi.fn((_object, {lineLength}) =>
      lineLength > 100 ? [0.25, 0.75] : [0.5]
    );

    const markers = createPathMarkers({
      data,
      getMarkerPercentages,
      projectFlat: ([x, y]) => [x * 20, y]
    });

    expect(getMarkerPercentages).toHaveBeenCalledWith(data[0], {index: 0, lineLength: 200});
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      position: [2.5, 0, 0],
      source: [0, 0],
      target: [10, 0],
      percentage: 0.25,
      object: data[0],
      index: 0,
      __source: {
        object: data[0],
        index: 0
      }
    });
    expect(markers[1]?.position).toEqual([7.5, 0, 0]);
  });

  it('reverses segment endpoints for backward markers', () => {
    const [marker] = createPathMarkers({
      data: [
        {
          path: [[0, 0] as [number, number], [10, 0] as [number, number]],
          direction: {
            forward: false,
            backward: true
          }
        }
      ],
      getMarkerPercentages: () => [0.25],
      projectFlat: ([x, y]) => [x, y]
    });

    expect(marker).toMatchObject({
      position: [7.5, 0, 0],
      source: [10, 0],
      target: [0, 0],
      percentage: 0.25
    });
  });
});
