// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {
  getSplatAxes,
  getSplatRadius,
  getSplatGeometry,
  validateSplatSource,
  type SplatSource
} from '../../src/splat-layer/splat-source';
import {
  createSplatHierarchy,
  getSplatMeanArea,
  decomposeSplatCovariance
} from '../../src/splat-layer/splat-hierarchy';

const source: SplatSource = {
  positions: new Float32Array([-0.1, 0, 0, 0.1, 0, 0]),
  scales: new Float32Array([0.03, 0.02, 0.01, 0.03, 0.02, 0.01]),
  rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]),
  colors: new Uint8Array([255, 128, 0, 128, 255, 128, 0, 128]),
  opacities: new Float32Array([0.7, 0.7])
};
describe('Prepared Gaussian sources', () => {
  it('rejects malformed dimensions, non-finite positions, zero scales and non-unit quaternions before upload', () => {
    expect(validateSplatSource(source)).toBe(2);
    expect(() =>
      validateSplatSource({...source, positions: new Float32Array([NaN, 0, 0, 1, 0, 0])})
    ).toThrow('non-finite');
    expect(() => validateSplatSource({...source, scales: new Float32Array(6)})).toThrow('positive');
    expect(() => validateSplatSource({...source, rotations: new Float32Array(8)})).toThrow('unit');
    expect(() => validateSplatSource({...source, colors: new Uint8Array(4)})).toThrow('length');
  });
  it('retains dense optical mass after opacity saturation and through repeated aggregation', () => {
    const dense = {
      ...source,
      positions: new Float32Array([0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
      opticalDepths: new Float32Array([12, 12])
    };
    const merged = createSplatHierarchy(dense, [0.5])[1].source;
    const depth = merged.opticalDepths![0];
    expect(depth).toBeCloseTo((24 * 128) / 255, 5);
    expect(merged.opacities[0]).toBeGreaterThan(0.999);
    expect(getSplatGeometry(merged).attributes.splatColors.value[3]).toBeCloseTo(depth);
    const remerged = createSplatHierarchy(merged, [1])[1].source;
    expect(remerged.opticalDepths![0]).toBeCloseTo(depth, 5);
    expect(getSplatMeanArea([1, 1, 0.00001])).toBeGreaterThan(0.49);
    expect(() =>
      validateSplatSource({...source, opticalDepths: new Float32Array([-1, 1])})
    ).toThrow('nonnegative');
    expect(() =>
      validateSplatSource({...source, opticalDepths: new Float32Array([NaN, 1])})
    ).toThrow('non-finite');
  });
  it('normalizes authored alpha once and reuses immutable template geometry', () => {
    const geometry = getSplatGeometry(source);
    expect(getSplatGeometry(source)).toBe(geometry);
    const colors = geometry.attributes.splatColors.value;
    expect(colors[3]).toBeCloseTo((0.7 * 128) / 255);
    expect(geometry.vertexCount).toBe(12);
  });
  it('recovers a rotated anisotropic covariance instead of sphericalizing it', () => {
    const covariance = [
      [0.06, 0.02, 0.01],
      [0.02, 0.1, -0.03],
      [0.01, -0.03, 0.05]
    ];
    const {scales, rotation} = decomposeSplatCovariance(covariance);
    const axes = getSplatAxes(rotation, scales);
    for (let row = 0; row < 3; row++)
      for (let column = 0; column < 3; column++)
        expect(axes.reduce((sum, axis) => sum + axis[row] * axis[column], 0)).toBeCloseTo(
          covariance[row][column],
          6
        );
    expect(Math.max(...scales) / Math.min(...scales)).toBeGreaterThan(1.5);
  });
  it('preserves the finest source and builds finite spatial covariance aggregates', () => {
    const hierarchy = createSplatHierarchy(source, [0.5]);
    expect(hierarchy[0].source).toBe(source);
    expect(hierarchy[1].error).toBeGreaterThan(0);
    expect(validateSplatSource(hierarchy[1].source)).toBe(1);
    const merged = createSplatHierarchy(
      {...source, positions: new Float32Array([0.1, 0.1, 0.1, 0.2, 0.1, 0.1])},
      [0.5]
    )[1].source;
    expect(validateSplatSource(merged)).toBe(1);
    expect(merged.positions[0]).toBeCloseTo(0.15);
    expect(Math.max(...merged.scales)).toBeGreaterThan(0.05);
  });
});

it('centers culling on translated crowns and respects their configured support', () => {
  const translated = {...source, positions: new Float32Array([99.9, 0, 0, 100.1, 0, 0])};
  expect(getSplatRadius(translated, 3, [100, 0, 0])).toBeCloseTo(0.19, 4);
  expect(getSplatRadius(translated, 6, [100, 0, 0])).toBeCloseTo(0.28, 4);
  expect(getSplatRadius(translated, 3, [100, 0, 0])).toBe(
    getSplatRadius(translated, 3, [100, 0, 0])
  );
});

it('converges signed crown coordinates to one aggregate instead of retaining octant boundaries', () => {
  const hierarchy = createSplatHierarchy(
    {...source, positions: new Float32Array([-1, -1, -1, 1, 1, 1])},
    [0.5, 4]
  );
  expect(hierarchy.at(-1)!.source.positions).toHaveLength(3);
});
