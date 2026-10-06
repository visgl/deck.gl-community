// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {project, shadow, type ProjectUniforms, type Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';

// The lab's 12m specimens and varied forest dimensions remain below 32m,
// including wind. Include this entire slab so elevated crowns are not clipped.
const CASTER_HEIGHT = 32;
const corners = new WeakMap<Viewport, number[][]>();
const projections = new WeakMap<Matrix4[], WeakMap<Viewport, Matrix4[]>>();

function getShadowCorners(viewport: Viewport): number[][] {
  const cached = corners.get(viewport);
  if (cached) return cached;
  const [cameraX, cameraY, cameraZ] = viewport.cameraPosition;
  const height = CASTER_HEIGHT * viewport.distanceScales.unitsPerMeter[2];
  const range = Math.max(
    (2 * Math.max(viewport.width, viewport.height)) / viewport.scale,
    height * 4
  );
  const unprojection = new Matrix4(viewport.pixelUnprojectionMatrix);
  const points: number[][] = [
    [cameraX, cameraY, 0],
    [cameraX, cameraY, height]
  ];
  for (const x of [0, viewport.width]) {
    for (const y of [0, viewport.height]) {
      const far = unprojection.transformAsPoint([x, y, 1]);
      const dx = far[0] - cameraX;
      const dy = far[1] - cameraY;
      const dz = far[2] - cameraZ;
      const groundT = dz < 0 ? Math.max(0, -cameraZ / dz) : Infinity;
      // Rays above the horizon never intersect the ground in front of the
      // camera. End those rays at a finite distance instead of behind it.
      const t = Math.min(groundT, range / Math.max(Math.hypot(dx, dy), 1e-10));
      points.push([cameraX + dx * t, cameraY + dy * t, 0]);
      points.push([cameraX + dx * t, cameraY + dy * t, height]);
    }
  }
  corners.set(viewport, points);
  return points;
}

function getShadowProjections(viewport: Viewport, lights: Matrix4[]): Matrix4[] {
  let cache = projections.get(lights);
  if (!cache) {
    cache = new WeakMap();
    projections.set(lights, cache);
  }
  const cached = cache.get(viewport);
  if (cached) return cached;
  const points = getShadowCorners(viewport);
  const result = lights.map(light => {
    const view = light.clone().translate(viewport.center.map(value => -value));
    const positions = points.map(point => view.transformAsPoint(point));
    const padding = CASTER_HEIGHT * viewport.distanceScales.unitsPerMeter[2];
    return new Matrix4()
      .ortho({
        left: Math.min(...positions.map(point => point[0])) - padding,
        right: Math.max(...positions.map(point => point[0])) + padding,
        bottom: Math.min(...positions.map(point => point[1])) - padding,
        top: Math.max(...positions.map(point => point[1])) + padding,
        near: Math.min(...positions.map(point => -point[2])) - padding,
        far: Math.max(...positions.map(point => -point[2])) + padding
      })
      .multiplyRight(light);
  });
  cache.set(viewport, result);
  return result;
}

/** Use the same finite light volume in the depth pass and the receiving color pass. */
export function getBoundedShadowUniforms(opts: Parameters<typeof shadow.getUniforms>[0]) {
  const uniforms = {
    ...shadow.getUniforms(opts),
    depthBias: [0.000015, 0.000015] as [number, number]
  };
  const viewport = opts.project?.viewport;
  if (!viewport?.isGeospatial || opts.shadowEnabled === false || !opts.shadowMatrices?.length)
    return uniforms;
  const projectUniforms = project.getUniforms(opts.project!) as ProjectUniforms;
  const center = new Matrix4(viewport.viewProjectionMatrix)
    .invert()
    .transform(projectUniforms.center);
  getShadowProjections(viewport, opts.shadowMatrices).forEach((matrix, index) => {
    // Convert a 2cm receiver bias into normalized light depth. A fixed
    // normalized bias grows into metres when the forest volume gets larger.
    const depthScale = Math.hypot(matrix[2], matrix[6], matrix[10]);
    uniforms.depthBias[index] = Math.max(
      0.000015,
      0.01 * depthScale * viewport.distanceScales.unitsPerMeter[2]
    );
    const projection = matrix.clone();
    const centered = projection.clone().translate(viewport.center.map(value => -value));
    // deck.gl uses w=0 matrices with a separate clip-space center for its
    // precision-preserving offset coordinates; preserve that shader convention.
    const matrixKey = `viewProjectionMatrix${index}` as
      | 'viewProjectionMatrix0'
      | 'viewProjectionMatrix1';
    const centerKey = `projectCenter${index}` as 'projectCenter0' | 'projectCenter1';
    // Read the valid camera convention, not the upstream shadow matrix:
    // that matrix itself can be non-finite exactly at the horizon.
    if (projectUniforms.viewProjectionMatrix[15] === 0) {
      const clipCenter = centered.transform(center);
      uniforms[centerKey] = [clipCenter[0], clipCenter[1], clipCenter[2], clipCenter[3]];
      projection[12] = 0;
      projection[13] = 0;
      projection[14] = 0;
      projection[15] = 0;
      uniforms[matrixKey] = Array.from(projection) as typeof uniforms.viewProjectionMatrix0;
    } else {
      uniforms[centerKey] = [center[0], center[1], center[2], center[3]];
      uniforms[matrixKey] = Array.from(centered) as typeof uniforms.viewProjectionMatrix0;
    }
  });
  return uniforms;
}
