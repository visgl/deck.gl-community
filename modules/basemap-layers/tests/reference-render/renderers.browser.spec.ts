// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, test, vi} from 'vitest';
import {type BasemapLayerDraw, renderBasemapLayer} from './renderers';
import {DEFAULT_SCENES} from './scenes';

describe('renderBasemapLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('times both draws, and the first draw alone', async () => {
    // A clock that only the draws move: 30 ms for the first, 50 ms for the second.
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const steps = [30, 50];
    const draw = async (): Promise<BasemapLayerDraw> => {
      const step = steps.shift()!;
      clock += step;
      return {
        pixels: new Uint8ClampedArray(0),
        labels: [],
        requests: [],
        problems: [],
        duration: step,
        fontAtlases: []
      };
    };
    const render = await renderBasemapLayer({}, DEFAULT_SCENES[0], {}, draw);
    expect(steps).toEqual([]);
    expect(render.duration).toBe(80);
    expect(render.firstDrawDuration).toBe(30);
  });
});
