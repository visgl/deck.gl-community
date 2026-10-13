// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport} from '@deck.gl/core';
import {Matrix4, Vector3} from '@math.gl/core';
import {expect, it} from 'vitest';
import {getShadowProjections, getGroundShadowSettings} from './shadow-frustum';
import {getWorldShadowHeight} from './world-source';

it('fits the rainforest envelope and refreshes cached light volumes when its height changes', () => {
  const height = getWorldShadowHeight({profile: 'rainforest'});
  expect(height).toBeGreaterThan(50);
  for (const pitch of [0, 60, 80]) {
    const viewport = new WebMercatorViewport({
      width: 400,
      height: 300,
      zoom: 20,
      pitch,
      position: [0, 0, 42]
    });
    const lights = [
      [-1, -0.6, -1.4],
      [1, 0.8, -0.7]
    ].map(direction => new Matrix4().lookAt({eye: new Vector3(direction).negate()}));
    const small = getShadowProjections(viewport, lights);
    const rainforest = getShadowProjections(viewport, lights, height);
    expect(rainforest).not.toBe(small);
    expect(getShadowProjections(viewport, lights, height)).toBe(rainforest);
    for (const matrix of rainforest) {
      for (const z of [0, 32, 50, height]) {
        const point = [
          viewport.cameraPosition[0],
          viewport.cameraPosition[1],
          z * viewport.distanceScales.unitsPerMeter[2]
        ];
        const clip = matrix.transformAsPoint(
          point.map((value, axis) => value - viewport.center[axis])
        );
        for (const value of clip) expect(Math.abs(value)).toBeLessThanOrEqual(1);
      }
    }
    const settings = getGroundShadowSettings(
      viewport,
      lights,
      [
        [1024, 1024],
        [1024, 1024]
      ],
      height
    );
    for (const setting of settings)
      expect([...setting.plane, ...setting.step].every(Number.isFinite)).toBe(true);
    const restored = getShadowProjections(viewport, lights);
    expect(restored).not.toBe(rainforest);
    expect(restored.map(matrix => Array.from(matrix))).toEqual(
      small.map(matrix => Array.from(matrix))
    );
  }
});
