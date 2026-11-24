// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FirstPersonViewport, OrbitViewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {describe, expect, it} from 'vitest';
import {
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
});
