// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Vector3} from '@math.gl/core';
import type {TreeGrowthWood} from './tree-photoreal-layout';

export type TreePoint = [number, number, number];

export type TreeTube = {
  rings: {position: TreePoint; birth: number; radius: number; band: number}[];
  sides: number;
  limb: number;
  order: number;
  occlusion: number;
  seed: number;
  minimumBirth?: number;
};

/** Transport a frame along a tube without the discontinuous vertical-axis switch. */
export function getTreeFrames(path: TreePoint[]) {
  let previous: Vector3 | undefined;
  return path.map((_, index) => {
    const tangent = new Vector3(path[Math.min(path.length - 1, index + 1)])
      .subtract(path[Math.max(0, index - 1)])
      .normalize();
    const side = previous
      ? new Vector3(previous).subtract(new Vector3(tangent).scale(previous.dot(tangent)))
      : new Vector3(Math.abs(tangent.z) > 0.95 ? [1, 0, 0] : [0, 0, 1]).cross(tangent);
    if (side.len() < 1e-6) side.set(1, 0, 0).cross(tangent);
    side.normalize();
    previous = side;
    return {side, up: new Vector3(tangent).cross(side).normalize(), tangent};
  });
}

export function packTreeTubes(tubes: TreeTube[], crownAspect: number): TreeGrowthWood {
  const vertexCount = tubes.reduce(
    (count, tube) => count + tube.rings.length * (tube.sides + 1),
    0
  );
  const center = new Float32Array(vertexCount * 4);
  const previous = new Float32Array(vertexCount * 4);
  const radial = new Float32Array(vertexCount * 4);
  const bark = new Float32Array(vertexCount * 4);
  const shade = new Float32Array(vertexCount * 4);
  // Each finer LOD extends the same woody silhouette.
  const indicesByBand: number[][] = [[], [], [], []];
  let vertex = 0;
  for (const {rings, sides, limb, order, occlusion, seed, minimumBirth = -Infinity} of tubes) {
    const points = rings.map(
      ({position: [x, y, z]}): TreePoint => [x * crownAspect, y * crownAspect, z]
    );
    const frames = getTreeFrames(points);
    let arc = 0;
    for (const [ring, {position, birth, radius, band}] of rings.entries()) {
      const before = Math.max(0, ring - 1);
      if (ring > 0) arc += new Vector3(points[ring]).distance(points[before]);
      const {side, up} = frames[ring];
      for (let segment = 0; segment <= sides; segment++, vertex++) {
        const u = segment / sides;
        const angle = u * (Math.PI * 2);
        const normal = new Vector3(side)
          .scale(Math.cos(angle))
          .add(new Vector3(up).scale(Math.sin(angle)));
        const offset = vertex * 4;
        center.set([...position, Math.max(birth, minimumBirth)], offset);
        previous.set([...rings[before].position, rings[before].birth], offset);
        radial.set([...normal, radius], offset);
        bark.set([u, arc, 0, limb], offset);
        shade.set([occlusion, order, seed, 0], offset);
        if (ring > 0 && segment < sides) {
          const a = vertex - sides - 1;
          indicesByBand[band].push(a, a + 1, vertex, a + 1, vertex + 1, vertex);
        }
      }
    }
  }
  const [stem, primary, outer] = indicesByBand;
  const indices = Uint32Array.from(indicesByBand.flat());
  return {
    vertexCount,
    center,
    previous,
    radial,
    bark,
    shade,
    indices,
    lodIndexCounts: [
      indices.length,
      stem.length + primary.length + outer.length,
      stem.length + primary.length,
      stem.length
    ]
  };
}
