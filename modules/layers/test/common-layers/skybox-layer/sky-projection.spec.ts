// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FirstPersonViewport, OrbitViewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core/matrix';
import {log} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {
  getSkyModelRotation,
  getSkyOrientationMatrix,
  getSkyProjectionProps,
  getSkyViewMatrix
} from '../../../src/common-layers/skybox-layer/sky-projection';

/** Projects a direction the way the `sky_project` shader function does, to pixels. */
function projectSky(
  viewport: OrbitViewport | FirstPersonViewport,
  direction: number[],
  options?: Parameters<typeof getSkyProjectionProps>[1]
): number[] {
  const {modelMatrix, viewMatrix, projectionMatrix} = getSkyProjectionProps(viewport, options);
  const clip = new Matrix4(projectionMatrix as number[])
    .multiplyRight(viewMatrix as number[])
    .multiplyRight(modelMatrix as number[])
    .transform([...direction, 1]);
  return [
    ((clip[0] / clip[3] + 1) / 2) * viewport.width,
    ((1 - clip[1] / clip[3]) / 2) * viewport.height,
    clip[3]
  ];
}

const ORBIT = {width: 800, height: 600, fovy: 50, rotationOrbit: 30, rotationX: 20, zoom: 0};

describe('sky projection', () => {
  it('removes the camera translation', () => {
    const near = getSkyViewMatrix(new OrbitViewport({...ORBIT, target: [0, 0, 0]}));
    const far = getSkyViewMatrix(new OrbitViewport({...ORBIT, target: [1e9, -3e8, 5e7]}));
    expect([near[12], near[13], near[14]]).toEqual([0, 0, 0]);
    expect(Array.from(far)).toEqual(Array.from(near));
  });

  it('agrees with the viewport projection of a very distant point', () => {
    const viewport = new OrbitViewport({...ORBIT, target: [10, 20, 30]});
    for (const direction of [
      [0.2, 0.9, -0.3],
      [-0.5, 0.7, 0.1],
      [0.1, 0.99, 0.05]
    ]) {
      const [x, y, w] = projectSky(viewport, direction);
      expect(w).toBeGreaterThan(0);
      const expected = viewport.project(direction.map(value => value * 1e12));
      expect(x).toBeCloseTo(expected[0], 3);
      expect(y).toBeCloseTo(expected[1], 3);
    }
  });

  it('turns with the camera', () => {
    const direction = [0.2, 0.9, -0.3];
    const before = projectSky(new OrbitViewport(ORBIT), direction);
    const after = projectSky(new OrbitViewport({...ORBIT, rotationOrbit: 40}), direction);
    expect(Math.abs(after[0] - before[0])).toBeGreaterThan(50);
  });

  it('agrees with a first-person viewport at any camera position', () => {
    const props = {width: 800, height: 600, fovy: 60, bearing: 20, pitch: 10};
    const direction = [0.3, 0.9, 0.2];
    const origin = projectSky(new FirstPersonViewport({...props, position: [0, 0, 0]}), direction);
    const moved = projectSky(
      new FirstPersonViewport({...props, position: [5000, -200, 30]}),
      direction
    );
    expect(moved[0]).toBeCloseTo(origin[0], 6);
    expect(moved[1]).toBeCloseTo(origin[1], 6);
    const expected = new FirstPersonViewport({...props, position: [0, 0, 0]}).project(
      direction.map(value => value * 1e12)
    );
    expect(origin[0]).toBeCloseTo(expected[0], 3);
    expect(origin[1]).toBeCloseTo(expected[1], 3);
  });

  it('maps the +Y axis of y-up content to the world +Z axis', () => {
    const up = getSkyOrientationMatrix('y-up').transformAsVector([0, 1, 0]);
    expect(up[0]).toBeCloseTo(0, 15);
    expect(up[1]).toBeCloseTo(0, 15);
    expect(up[2]).toBeCloseTo(1, 15);
    expect(Array.from(getSkyOrientationMatrix())).toEqual(Array.from(new Matrix4()));
  });

  it('applies the model rotation after the orientation, and ignores its translation', () => {
    const viewport = new OrbitViewport(ORBIT);
    const modelMatrix = new Matrix4().translate([1e6, 2e6, 3e6]).rotateZ(Math.PI / 2);
    // y-up: [0, 0, -1] becomes world +y. The model matrix then turns +y to -x.
    const rotated = projectSky(viewport, [0, 0, -1], {orientation: 'y-up', modelMatrix});
    const expected = projectSky(viewport, [-1, 0, 0]);
    expect(rotated[0]).toBeCloseTo(expected[0], 6);
    expect(rotated[1]).toBeCloseTo(expected[1], 6);
  });

  it('scales the sky geometry without moving its projection', () => {
    const viewport = new OrbitViewport(ORBIT);
    const scaled = projectSky(viewport, [0.2, 0.9, -0.3], {scale: 2});
    const unscaled = projectSky(viewport, [0.2, 0.9, -0.3]);
    expect(scaled[0]).toBeCloseTo(unscaled[0], 9);
    expect(scaled[1]).toBeCloseTo(unscaled[1], 9);
    expect(scaled[2]).toBeCloseTo(2 * unscaled[2], 9);
  });

  it('ignores the scale of the model matrix', () => {
    const viewport = new OrbitViewport(ORBIT);
    const rotation = new Matrix4().rotateZ(Math.PI / 2);
    const distorted = new Matrix4(rotation).scale([3, 0.5, 7]);
    const direction = [0.2, 0.9, -0.3];
    const actual = projectSky(viewport, direction, {modelMatrix: distorted});
    const expected = projectSky(viewport, direction, {modelMatrix: rotation});
    expect(actual[0]).toBeCloseTo(expected[0], 6);
    expect(actual[1]).toBeCloseTo(expected[1], 6);
  });
});

/** Returns the upper-left 3x3 determinant of a Matrix4. */
function determinant3(m: Matrix4): number {
  return (
    m[0] * (m[5] * m[10] - m[9] * m[6]) -
    m[4] * (m[1] * m[10] - m[9] * m[2]) +
    m[8] * (m[1] * m[6] - m[5] * m[2])
  );
}

/** Expects the upper-left 3x3 parts of two matrices to agree, and the rest to be the identity. */
function expectRotation(actual: Matrix4, expected: Matrix4, digits = 9): void {
  for (let index = 0; index < 16; index++) {
    const value = [3, 7, 11, 12, 13, 14].includes(index) ? 0 : index === 15 ? 1 : expected[index];
    expect(actual[index]).toBeCloseTo(value, digits);
  }
}

/** Expects M^T M = I for the upper-left 3x3 part. */
function expectOrthogonal(m: Matrix4): void {
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += m[i * 4 + k] * m[j * 4 + k];
      expect(dot).toBeCloseTo(i === j ? 1 : 0, 9);
    }
  }
}

describe('getSkyModelRotation', () => {
  const rotation = new Matrix4().rotateZ(0.7).rotateX(-0.4).rotateY(1.9);

  it('returns the identity without a model matrix', () => {
    expect(getSkyModelRotation(null)).toEqual({matrix: new Matrix4(), mirrored: false});
  });

  it('keeps a pure rotation and removes translation', () => {
    const {matrix, mirrored} = getSkyModelRotation(
      new Matrix4().translate([10, -20, 30]).multiplyRight(rotation)
    );
    expect(mirrored).toBe(false);
    expectRotation(matrix, rotation, 12);
  });

  it('removes a uniform scale', () => {
    for (const factor of [1e-4, 0.25, 4, 1e6]) {
      const {matrix, mirrored} = getSkyModelRotation(new Matrix4(rotation).scale(factor));
      expect(mirrored).toBe(false);
      expectRotation(matrix, rotation);
    }
  });

  it('removes a nonuniform scale', () => {
    const {matrix, mirrored} = getSkyModelRotation(new Matrix4(rotation).scale([2, 0.1, 50]));
    expect(mirrored).toBe(false);
    expectRotation(matrix, rotation);
  });

  it('removes shear and gives an orthogonal matrix with determinant 1', () => {
    const shear = new Matrix4();
    shear[4] = 0.6; // x += 0.6 y
    shear[9] = -0.3; // z -= 0.3 y
    const sheared = new Matrix4(rotation).multiplyRight(shear);
    const {matrix, mirrored} = getSkyModelRotation(sheared);
    expect(mirrored).toBe(false);
    expectOrthogonal(matrix);
    expect(determinant3(matrix)).toBeCloseTo(1, 12);
    // Polar decomposition: Q^T A is the symmetric stretch, so Q is the nearest rotation.
    const stretch = new Matrix4(matrix).transpose().multiplyRight(sheared);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(stretch[i * 4 + j]).toBeCloseTo(stretch[j * 4 + i], 9);
    }
  });

  it('keeps a reflection and reports it', () => {
    const reflected = new Matrix4(rotation).scale([-1, 1, 1]);
    const {matrix, mirrored} = getSkyModelRotation(new Matrix4(reflected).scale([3, 1, 0.5]));
    expect(mirrored).toBe(true);
    expect(determinant3(matrix)).toBeCloseTo(-1, 12);
    expectRotation(matrix, reflected);
  });

  it('does not depend on the axis that carries the reflection', () => {
    for (const scale of [
      [-1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [-1, -1, -1]
    ]) {
      const {matrix, mirrored} = getSkyModelRotation(new Matrix4().scale(scale));
      expect(mirrored).toBe(true);
      expectRotation(matrix, new Matrix4().scale(scale), 12);
    }
  });

  it('falls back to the identity for a singular matrix and warns once', () => {
    const warn = vi.spyOn(log, 'warn').mockReturnValue(() => {});
    try {
      for (const singular of [
        new Matrix4().scale([1, 0, 1]),
        new Matrix4().scale([1e3, 1e3, 1e-12]),
        new Matrix4(Array.from({length: 16}, () => 0)),
        new Matrix4().scale([1, Number.NaN, 1])
      ]) {
        expect(getSkyModelRotation(singular)).toEqual({matrix: new Matrix4(), mirrored: false});
      }
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
