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

  it('carries the leaves on branches rooted at the trunk, each branch swaying as one', () => {
    const height = 12;
    const strength = 0.04;
    const phase = getPhase(0.7);
    const range = (values: number[][]) =>
      Math.max(
        ...[0, 1, 2].map(
          axis => Math.max(...values.map(v => v[axis])) - Math.min(...values.map(v => v[axis]))
        )
      );
    const correlation = (a: number[][], b: number[][]) => {
      const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
      const x = a.map(v => v[0] + v[1]);
      const y = b.map(v => v[0] + v[1]);
      const [mx, my] = [mean(x), mean(y)];
      const cov = mean(x.map((v, i) => (v - mx) * (y[i] - my)));
      return cov / Math.sqrt(mean(x.map(v => (v - mx) ** 2)) * mean(y.map(v => (v - my) ** 2)));
    };
    const tracks: Record<string, number[][]> = {
      axis: [],
      inner: [],
      tip: [],
      leaf: [],
      opposite: [],
      above: []
    };
    for (let time = 0; time < 40; time += 0.05) {
      const uniforms = getWindUniforms({direction: 90, time});
      const at = (point: number[], seed: number[] | null = null) =>
        getSplatWindOffset([], point, seed, height, strength, phase, uniforms);
      const trunk = at([0, 0, 9]);
      // Motion relative to the trunk at the same height: what the branches add.
      const relative = (point: number[], seed: number[] | null = null) =>
        at(point, seed).map((value, i) => value - trunk[i]);
      tracks.axis.push(trunk);
      tracks.inner.push(relative([1.2, 0.4, 9]));
      tracks.tip.push(relative([3.6, 1.2, 9]));
      tracks.leaf.push(relative([3.6, 1.2, 9], [0.8, 0.3, 0.4]));
      tracks.opposite.push(relative([-3.6, -1.2, 9]));
      tracks.above.push(relative([3.6, 1.2, 11]));
      // A leaf moves with the wood it sits on, give or take a small shimmer.
      const wood = at([3.6, 1.2, 9]);
      const leaf = at([3.6, 1.2, 9], [0.8, 0.3, 0.4]);
      expect(Math.hypot(...leaf.map((value, i) => value - wood[i]))).toBeLessThan(
        0.11 * strength * height
      );
    }
    // The trunk axis carries no branch sway: it bends along the wind only.
    for (const [, dy] of tracks.axis) expect(Math.abs(dy)).toBeLessThan(1e-12);
    // Sway grows from the trunk out to the tips, and the tips move more than the trunk sways.
    expect(range(tracks.tip)).toBeGreaterThan(3 * range(tracks.inner));
    expect(range(tracks.tip)).toBeGreaterThan(range(tracks.axis));
    // Points along one branch sway together; branches across the crown, or a tier up, do not.
    expect(correlation(tracks.inner, tracks.tip)).toBeGreaterThan(0.99);
    expect(correlation(tracks.tip, tracks.leaf)).toBeGreaterThan(0.95);
    expect(correlation(tracks.tip, tracks.opposite)).toBeLessThan(0);
    expect(correlation(tracks.tip, tracks.above)).toBeLessThan(0.9);
    // Leaves shimmer up and down a little; wood does not.
    expect(Math.max(...tracks.leaf.map(v => Math.abs(v[2])))).toBeGreaterThan(0.005);
    expect(Math.max(...tracks.tip.map(v => Math.abs(v[2])))).toBe(0);
    // Still turbulence stops the branches and the shimmer.
    const calm = getWindUniforms({direction: 90, time: 3, turbulence: 0});
    const still = getSplatWindOffset([], [3, 1, 9], [0.8, 0.3, 0.4], height, strength, phase, calm);
    const trunk = getSplatWindOffset([], [0, 0, 9], null, height, strength, phase, calm);
    still.forEach((value, i) => expect(value).toBeCloseTo(trunk[i], 12));
  });

  it('matches the shaders’ analytic Jacobian of the branch sway', () => {
    // A transcription of the gradient terms in SPLAT_DEFORMATION_GLSL.
    const analytic = (
      p: number[],
      height: number,
      strength: number,
      phase: number[],
      w: ReturnType<typeof getWindUniforms>
    ) => {
      const [x, y, z] = p;
      const {axis, mode, branch, wave} = w;
      const u = Math.min(Math.max(z / height, 0), 1);
      const v = Math.max((u - 0.3) / 0.7, 0);
      const g = v * v;
      const crownWave = wave[2] * phase[3] + wave[3] * phase[2];
      const trunkWave = wave[0] * phase[1] + wave[1] * phase[0];
      const bend = axis.map(
        (a: number) => a * strength * (1 + 0.25 * (0.75 * trunkWave + 0.25 * crownWave))
      );
      const crown = 0.35 * strength * crownWave;
      const lateral = [mode[0] * x + mode[2] * y, mode[1] * x + mode[3] * y];
      const columns = [
        [1 + crown * g * mode[0], crown * g * mode[1]],
        [crown * g * mode[2], 1 + crown * g * mode[3]]
      ];
      const df = z > 0 && z < height ? 3 * u - 1.5 * u * u : 0;
      const dg = z > height * 0.3 && z < height ? (2 * v) / (0.7 * height) : 0;
      const dz = [0, 1].map(i => bend[i] * df + crown * dg * lateral[i]);
      const span = 0.3 * height;
      const r2 = x * x + y * y;
      const q2 = r2 / (span * span);
      const kappa = 1 / (span * span * (1 + 0.25 * q2));
      const reach = kappa * r2;
      const t = Math.min(Math.max((u - 0.1) / 0.3, 0), 1);
      const tier = t * t * (3 - 2 * t);
      const dtier = z > 0.1 * height && z < 0.4 * height ? (6 * t * (1 - t)) / (0.3 * height) : 0;
      const r = Math.sqrt(r2);
      const azimuth = r > 0 ? [x / r, y / r] : [1, 0];
      const rise = (5 * z) / height;
      const sinBeta = Math.sin(rise) * phase[1] + Math.cos(rise) * phase[0];
      const cosBeta = Math.cos(rise) * phase[1] - Math.sin(rise) * phase[0];
      const sinTheta = azimuth[1] * cosBeta + azimuth[0] * sinBeta;
      const cosTheta = azimuth[0] * cosBeta - azimuth[1] * sinBeta;
      const cos2 = cosTheta * cosTheta - sinTheta * sinTheta;
      const sin2 = 2 * sinTheta * cosTheta;
      const across = [-axis[1], axis[0]];
      const sway = [0, 1].map(
        i =>
          axis[i] * (branch[0] * cosTheta + branch[1] * sinTheta) +
          across[i] * 0.4 * (branch[2] * cos2 + branch[3] * sin2)
      );
      const dsway = [0, 1].map(
        i =>
          axis[i] * (branch[1] * cosTheta - branch[0] * sinTheta) +
          across[i] * 0.8 * (branch[3] * cos2 - branch[2] * sin2)
      );
      const amount = 0.5 * strength * height;
      const dReach = [x, y].map(c => ((2 * kappa) / (1 + 0.25 * q2)) * c);
      const dTheta = [-kappa * y, kappa * x];
      for (const c of [0, 1])
        for (const i of [0, 1])
          columns[c][i] += amount * tier * (dReach[c] * sway[i] + dTheta[c] * dsway[i]);
      for (const i of [0, 1])
        dz[i] += amount * reach * (dtier * sway[i] + ((tier * 5) / height) * dsway[i]);
      return [
        [...columns[0], 0],
        [...columns[1], 0],
        [...dz, 1]
      ];
    };
    const height = 10;
    const strength = 0.06;
    for (const point of [
      [2.5, -1, 6],
      [0.3, 0.2, 2.5],
      [-4, 3, 9.5],
      [0, 0, 5],
      [12, 1, 3.5]
    ]) {
      for (const time of [0.3, 2.2]) {
        const uniforms = getWindUniforms({direction: 140, time, turbulence: 1.3});
        const phase = getPhase(2.1);
        const {jacobian} = deform(point, null, height, strength, phase, uniforms);
        const expected = analytic(point, height, strength, phase, uniforms);
        jacobian.forEach((column, c) =>
          column.forEach((value, i) => expect(value).toBeCloseTo(expected[c][i], 6))
        );
      }
    }
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
