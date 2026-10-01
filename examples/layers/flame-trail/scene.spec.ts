// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {FlameTrailLayer} from '@deck.gl-community/layers';
import {createSceneLayers, TRIP_DURATION} from './scene';
import {SETTINGS_SCHEMA} from './settings';

describe('flame trail example loop', () => {
  for (const backend of ['webgl', 'webgpu'] as const) {
    it(`keeps a burning segment throughout the shortest trail loop on ${backend}`, () => {
      const trailLength = SETTINGS_SCHEMA.sections[0].settings.find(
        setting => setting.name === 'trailLength'
      )!.min!;
      // Check the entire cycle, plus both sides of each head's wrap point.
      const times = [
        ...Array.from({length: TRIP_DURATION + 1}, (_, index) => index),
        TRIP_DURATION / 2 - 0.001,
        TRIP_DURATION / 2 + 0.001,
        TRIP_DURATION - 0.001,
        TRIP_DURATION + 0.001
      ];
      for (const currentTime of times) {
        const flames = createSceneLayers(
          {currentTime, trailLength, width: 24, color: [255, 255, 255]},
          backend
        ).filter(layer => layer instanceof FlameTrailLayer);
        expect(flames).toHaveLength(2);
        const hasBurningSegment = flames.some(layer => {
          const {currentTime: head, data} = layer.props;
          return (data as {timestamps: number[]}[]).some(trip =>
            trip.timestamps.some(
              (end, index) =>
                index > 0 && end > head - trailLength && trip.timestamps[index - 1] < head
            )
          );
        });
        expect(hasBurningSegment, `empty frame at ${currentTime}`).toBe(true);
      }
    });
  }
});
