// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TreeGrowthModel} from './tree-photoreal-layout';

const stems = new WeakMap<TreeGrowthModel, TreeGrowthModel>();
const RINGS = 7;
const SIDES = 5;

/** The trunk's original spine and taper, sampled for screen sizes where branches are subpixel. */
export function getTreeStemModel(template: TreeGrowthModel): TreeGrowthModel {
  const existing = stems.get(template);
  if (existing) return existing;
  const wood = template.wood;
  const candidates = new Map<number, number>();
  for (let offset = 0; offset < wood.center.length; offset += 4) {
    if (wood.shade[offset + 1] !== 0 || wood.shade[offset + 3] !== 0) continue;
    const z = wood.center[offset + 2];
    if (z >= 0 && !candidates.has(z)) candidates.set(z, offset);
  }
  const spine = [...candidates.values()].sort((a, b) => wood.center[a + 2] - wood.center[b + 2]);
  if (spine.length < 2) return template;
  const height = wood.center[spine[spine.length - 1] + 2];
  const rings = [spine[0]];
  let ring = 0;
  for (let i = 1; i < RINGS; i++) {
    const target = (height * i) / (RINGS - 1);
    while (
      ring + 1 < spine.length &&
      Math.abs(wood.center[spine[ring + 1] + 2] - target) <
        Math.abs(wood.center[spine[ring] + 2] - target)
    )
      ring++;
    if (rings[rings.length - 1] !== spine[ring]) rings.push(spine[ring]);
  }
  const stride = SIDES + 1;
  const vertexCount = rings.length * stride;
  const center = new Float32Array(vertexCount * 4);
  const previous = new Float32Array(vertexCount * 4);
  const radial = new Float32Array(vertexCount * 4);
  const bark = new Float32Array(vertexCount * 4);
  const shade = new Float32Array(vertexCount * 4);
  const indices = new Uint32Array((rings.length - 1) * SIDES * 6);
  let cursor = 0;
  rings.forEach((source, index) => {
    const before = index === 0 ? source : rings[index - 1];
    for (let side = 0; side <= SIDES; side++) {
      const vertex = index * stride + side;
      const offset = vertex * 4;
      const angle = (side / SIDES) * 2 * Math.PI;
      center.set(wood.center.subarray(source, source + 4), offset);
      previous.set(
        (index === 0 ? wood.previous : wood.center).subarray(before, before + 4),
        offset
      );
      radial.set([Math.cos(angle), Math.sin(angle), 0, wood.radial[source + 3]], offset);
      bark.set([side / SIDES, wood.bark[source + 1], 0, 0], offset);
      shade.set([1, 0, wood.shade[source + 2], 0], offset);
      if (index + 1 < rings.length && side < SIDES) {
        const next = vertex + stride;
        indices.set([vertex, vertex + 1, next, vertex + 1, next + 1, next], cursor);
        cursor += 6;
      }
    }
  });
  const count = indices.length;
  const model: TreeGrowthModel = {
    ...template,
    key: `${template.key}-stem`,
    leafCount: 0,
    leaves: new Float32Array(0),
    wood: {
      vertexCount,
      center,
      previous,
      radial,
      bark,
      shade,
      indices,
      lodIndexCounts: [count, count, count, count]
    }
  };
  stems.set(template, model);
  return model;
}
