// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {TripsLayer, type TripsLayerProps} from '@deck.gl/geo-layers';
import {FlameTrailLayer} from '../../src/index';

describe('FlameTrailLayer API', () => {
  it('accepts unchanged TripsLayer props and inherits its defaults', () => {
    const trip = {
      path: [
        [0, 0],
        [1, 1]
      ],
      timestamps: [0, 10]
    };
    const props: TripsLayerProps<typeof trip> = {
      data: [trip],
      currentTime: 7,
      getColor: [80, 120, 255, 128],
      getTimestamps: d => d.timestamps,
      widthMinPixels: 5,
      pickable: true
    };
    const layer = new FlameTrailLayer(props);
    const trips = new TripsLayer(props);
    expect(layer).toBeInstanceOf(TripsLayer);
    for (const name of [
      'currentTime',
      'trailLength',
      'fadeTrail',
      'getColor',
      'getTimestamps',
      'widthMinPixels',
      'pickable'
    ]) {
      expect(layer.props[name]).toEqual(trips.props[name]);
    }
    expect(new FlameTrailLayer().props.getColor).toEqual([255, 255, 255, 255]);
  });
});
