// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {
  getSplatDeformationRadius,
  getSplatLeafHash,
  getSplatWindOffset
} from '../../src/splat-layer/splat-deformation';
import {getWindUniforms} from '../../src/wind-effect/wind-module';

/** Owner `[sin φ, cos φ, sin 1.7φ, cos 1.7φ]`, as SplatLayer packs `getDeformation`. */
function getPhase(phase: number) {
  return [Math.sin(phase), Math.cos(phase), Math.sin(phase * 1.7), Math.cos(phase * 1.7)];
}

/** Offset of a point, with the trunk and crown Jacobian by central differences. */
function deform(
  center: number[],
  seed: number[] | null,
  height: number,
  strength: number,
  phase: number[],
  uniforms: ReturnType<typeof getWindUniforms>
) {
  const displacement = getSplatWindOffset([], center, seed, height, strength, phase, uniforms);
  const h = 1e-5;
  const jacobian = [0, 1, 2].map(axis => {
    const plus = center.map((value, i) => (i === axis ? value + h : value));
    const minus = center.map((value, i) => (i === axis ? value - h : value));
    const a = getSplatWindOffset([], plus, null, height, strength, phase, uniforms);
    const b = getSplatWindOffset([], minus, null, height, strength, phase, uniforms);
    return a.map((value, i) => (i === axis ? 1 : 0) + (value - b[i]) / (2 * h));
  });
  return {displacement, jacobian};
}

describe('splat wind deformation', () => {
  it('leans the trunk downwind at every moment: it sways around the lean, never upwind', () => {
    const height = 12;
    const strength = 0.04;
    for (const direction of [90, 200]) {
      for (let time = 0; time < 40; time += 0.13) {
        const uniforms = getWindUniforms({direction, time});
        const [ax, ay] = uniforms.axis;
        for (const phase of [0, 0.7, 2.9]) {
          const [dx, dy] = getSplatWindOffset(
            [],
            [0, 0, height],
            null,
            height,
            strength,
            getPhase(phase),
            uniforms
          );
          // Projected on the bend axis: within 0.75–1.25 of the lean.
          const along = (dx * ax + dy * ay) / (ax * ax + ay * ay) / (strength * height);
          expect(along).toBeGreaterThanOrEqual(0.75 - 1e-9);
          expect(along).toBeLessThanOrEqual(1.25 + 1e-9);
          expect(Math.abs(dx * ay - dy * ax)).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('swings the leaves further than the trunk sways, and each patch of leaves on its own', () => {
    const height = 12;
    const strength = 0.04;
    const phase = getPhase(0.7);
    const range = (values: number[][]) =>
      Math.max(
        ...[0, 1, 2].map(
          axis => Math.max(...values.map(v => v[axis])) - Math.min(...values.map(v => v[axis]))
        )
      );
    const trunk: number[][] = [];
    const leaf: number[][] = [];
    const neighbour: number[][] = [];
    const across: number[][] = [];
    for (let time = 0; time < 30; time += 0.05) {
      const uniforms = getWindUniforms({direction: 90, time});
      trunk.push(getSplatWindOffset([], [0, 0, height], null, height, strength, phase, uniforms));
      leaf.push(
        getSplatWindOffset([], [3, 1, 9], [0.8, 0.3, 0.4], height, strength, phase, uniforms)
      );
      neighbour.push(
        getSplatWindOffset([], [3.2, 1, 9], [0.82, 0.3, 0.4], height, strength, phase, uniforms)
      );
      across.push(
        getSplatWindOffset([], [-3, -1, 9], [-0.8, -0.3, 0.4], height, strength, phase, uniforms)
      );
    }
    // The leaf is carried by the trunk too; its own motion is the difference.
    const flutter = leaf.map((value, i) => value.map((v, axis) => v - trunk[i][axis]));
    expect(range(flutter)).toBeGreaterThan(1.5 * range(trunk));
    // Leaves move up and down, and across the wind, as well as along it.
    expect(Math.max(...flutter.map(v => Math.abs(v[1])))).toBeGreaterThan(0.02);
    expect(Math.max(...flutter.map(v => Math.abs(v[2])))).toBeGreaterThan(0.05);
    // Nearby leaves move nearly together; leaves across the crown move on their own.
    const correlation = (a: number[][], b: number[][]) => {
      const x = a.map(v => v[0]);
      const y = b.map(v => v[0]);
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
      const [mx, my] = [mean(x), mean(y)];
      const cov = mean(x.map((v, i) => (v - mx) * (y[i] - my)));
      return cov / Math.sqrt(mean(x.map(v => (v - mx) ** 2)) * mean(y.map(v => (v - my) ** 2)));
    };
    expect(correlation(leaf, neighbour)).toBeGreaterThan(0.8);
    expect(correlation(leaf, across)).toBeLessThan(0.8);
    // Calm air and still turbulence stop the flutter.
    const calm = getWindUniforms({direction: 90, time: 3, turbulence: 0});
    const still = getSplatWindOffset([], [3, 1, 9], [0.8, 0.3, 0.4], height, strength, phase, calm);
    const rigid = getSplatWindOffset([], [3, 1, 9], null, height, strength, phase, calm);
    still.forEach((value, i) => expect(value).toBeCloseTo(rigid[i], 12));
  });

  it('hashes each Gaussian on a 1/64 grid, the same way the shaders do', () => {
    const values = new Set<number>();
    let sum = 0;
    for (let i = 0; i < 400; i++) {
      const value = getSplatLeafHash(i * 0.137 - 20, (i % 17) * 0.31, i * 0.011);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      values.add(value);
      sum += value;
    }
    expect(values.size).toBeGreaterThan(390);
    expect(sum / 400).toBeGreaterThan(0.4);
    expect(sum / 400).toBeLessThan(0.6);
    expect(getSplatLeafHash(0.5, -1.25, 3)).toBe(getSplatLeafHash(0.501, -1.249, 3.004));
    expect(getSplatLeafHash(0.5, -1.25, 3)).not.toBe(getSplatLeafHash(0.52, -1.25, 3));
  });

  it('bounds the bend, crown mode, flutter and sheared Gaussian support at every moment', () => {
    for (const {center, direction, turbulence} of [
      {center: [100, 0, 1], direction: 65.77, turbulence: 1},
      {center: [-40, 80, 0.7], direction: 0, turbulence: 1},
      {center: [0, 0, 5], direction: 200, turbulence: 2},
      {center: [3, -2, 0.8], direction: 300, turbulence: 0.5},
      {center: [0.4, 0.2, 0.2], direction: 90, turbulence: 1}
    ]) {
      const radius = 0.3,
        height = 1,
        strength = 0.1;
      const bound = getSplatDeformationRadius(center, radius, height, strength, turbulence);
      for (let time = 0; time < 12; time += 0.07) {
        const uniforms = getWindUniforms({direction, turbulence, time});
        for (const phase of [0, 1.1, 4]) {
          const {displacement, jacobian} = deform(
            center,
            [0.25, -0.5, 0.75],
            height,
            strength,
            getPhase(phase),
            uniforms
          );
          for (const column of jacobian)
            for (const sign of [-1, 1]) {
              const extent = displacement.map((value, i) => value + sign * radius * column[i]);
              expect(Math.hypot(...extent)).toBeLessThanOrEqual(bound);
            }
        }
      }
    }
    expect(getSplatDeformationRadius([100, 0, 1], 0.3, 1, 0.1)).toBeGreaterThan(2);
  });
});
