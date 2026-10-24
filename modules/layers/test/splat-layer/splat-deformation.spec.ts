// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it} from 'vitest';
import {getSplatDeformationRadius} from '../../src/splat-layer/splat-deformation';
import {getWindUniforms} from '../../src/wind-effect/wind-module';

it('bounds translated branch motion and sheared Gaussian support through every wave phase', () => {
  for (const center of [
    [100, 0, 1],
    [-40, 80, 0.7],
    [0, 0, 5]
  ]) {
    const radius = 0.3,
      height = 1,
      strength = 0.1;
    const bound = getSplatDeformationRadius(center, radius, height, strength);
    for (let phase = 0; phase < 360; phase++) {
      const wave = [Math.sin((phase * Math.PI) / 180), Math.sin((phase * Math.PI) / 90)];
      const u = Math.min(1, Math.max(0, center[2] / height));
      const f = 0.5 * u * u * (3 - u),
        v = Math.max((u - 0.3) / 0.7, 0),
        g = v * v;
      const bend = [strength * wave[0], 0.45 * strength * wave[0]];
      const branch = 0.35 * strength * wave[1];
      const lateral = [0.65 * center[0] + 0.3 * center[1], -0.25 * center[0] + 0.8 * center[1]];
      const displacement = [
        bend[0] * height * f + branch * g * lateral[0],
        bend[1] * height * f + branch * g * lateral[1],
        0
      ];
      const df = center[2] > 0 && center[2] < height ? 3 * u - 1.5 * u * u : 0;
      const dg = center[2] > height * 0.3 && center[2] < height ? (2 * v) / (0.7 * height) : 0;
      const jacobian = [
        [1 + branch * g * 0.65, -branch * g * 0.25, 0],
        [branch * g * 0.3, 1 + branch * g * 0.8, 0],
        [bend[0] * df + branch * dg * lateral[0], bend[1] * df + branch * dg * lateral[1], 1]
      ];
      for (const axis of jacobian) {
        for (const sign of [-1, 1]) {
          const extent = displacement.map((value, i) => value + sign * radius * axis[i]);
          expect(Math.hypot(...extent)).toBeLessThanOrEqual(bound);
        }
      }
    }
  }
  expect(getSplatDeformationRadius([100, 0, 1], 0.3, 1, 0.1)).toBeGreaterThan(2);
});

it('bounds rotated and turbulent wind with the peak strength', () => {
  const center = [3, -2, 0.8],
    radius = 0.2,
    height = 1,
    strength = 0.08;
  for (const {direction, turbulence} of [
    {direction: 0, turbulence: 1},
    {direction: 200, turbulence: 2},
    {direction: 300, turbulence: 0.5}
  ]) {
    const {axis, mode} = getWindUniforms({direction, turbulence});
    const bound = getSplatDeformationRadius(center, radius, height, strength, turbulence);
    for (let phase = 0; phase < 360; phase += 2) {
      const wave = [Math.sin((phase * Math.PI) / 180), Math.sin((phase * Math.PI) / 90)];
      const u = Math.min(1, Math.max(0, center[2] / height));
      const f = 0.5 * u * u * (3 - u),
        v = Math.max((u - 0.3) / 0.7, 0),
        g = v * v;
      const bend = [axis[0] * strength * wave[0], axis[1] * strength * wave[0]];
      const branch = 0.35 * strength * wave[1];
      const lateral = [
        mode[0] * center[0] + mode[2] * center[1],
        mode[1] * center[0] + mode[3] * center[1]
      ];
      const displacement = [
        bend[0] * height * f + branch * g * lateral[0],
        bend[1] * height * f + branch * g * lateral[1],
        0
      ];
      const df = 3 * u - 1.5 * u * u;
      const dg = (2 * v) / (0.7 * height);
      const jacobian = [
        [1 + branch * g * mode[0], branch * g * mode[1], 0],
        [branch * g * mode[2], 1 + branch * g * mode[3], 0],
        [bend[0] * df + branch * dg * lateral[0], bend[1] * df + branch * dg * lateral[1], 1]
      ];
      for (const column of jacobian)
        for (const sign of [-1, 1]) {
          const extent = displacement.map((value, i) => value + sign * radius * column[i]);
          expect(Math.hypot(...extent)).toBeLessThanOrEqual(bound);
        }
    }
  }
});
