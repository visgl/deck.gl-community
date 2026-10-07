// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';

describe('Continuous tree wood', () => {
  for (const type of [
    'oak',
    'pine',
    'birch',
    'cherry',
    'palm',
    'banyan',
    'mangrove',
    'citrus'
  ] as const)
    for (const aggregate of [false, true])
      it(`${type}/${aggregate ? 'distant' : 'full'} has one closed, connected trunk-and-branch surface`, () => {
        const mesh = getTreeWoodMesh(type, 4, aggregate);
        const vertices = mesh.attributes.POSITION.value;
        const edges = new Map<string, {count: number; direction: number}>();
        const neighbors = new Map<number, Set<number>>();
        for (let triangle = 0; triangle < mesh.indices.value.length; triangle += 3) {
          const face = Array.from(mesh.indices.value.subarray(triangle, triangle + 3));
          expect(new Set(face).size).toBe(3);
          for (let edge = 0; edge < 3; edge++) {
            const a = face[edge],
              b = face[(edge + 1) % 3];
            const key = `${Math.min(a, b)},${Math.max(a, b)}`;
            const value = edges.get(key) ?? {count: 0, direction: 0};
            value.count++;
            value.direction += a < b ? 1 : -1;
            edges.set(key, value);
            const adjacent = neighbors.get(a) ?? new Set<number>();
            adjacent.add(b);
            neighbors.set(a, adjacent);
          }
        }
        expect(
          [...edges.values()].filter(edge => edge.count !== 2).length,
          'Every edge joins exactly two faces, including branch sockets'
        ).toBe(0);
        expect(
          [...edges.values()].filter(edge => edge.direction !== 0).length,
          'Shared faces have consistent outward winding'
        ).toBe(0);
        const visited = new Set<number>();
        const pending = [0];
        while (pending.length) {
          const vertex = pending.pop()!;
          if (visited.has(vertex)) continue;
          visited.add(vertex);
          pending.push(...neighbors.get(vertex)!);
        }
        expect(visited.size).toBe(vertices.length / 3);
        expect(vertices.every(Number.isFinite)).toBe(true);
        const normals = mesh.attributes.NORMAL.value;
        for (let vertex = 0; vertex < normals.length; vertex += 3)
          expect(Math.hypot(...normals.subarray(vertex, vertex + 3))).toBeCloseTo(1, 4);
        expect(getTreeWoodMesh(type, 4, aggregate)).toBe(mesh);
      });
});

it('keeps deciduous leaders inside the dense crown and retains branches in distant winter meshes', () => {
  for (const type of ['oak', 'birch', 'cherry'] as const) {
    for (const aggregate of [false, true]) {
      const mesh = getTreeWoodMesh(type, 3, aggregate);
      const points = mesh.attributes.POSITION.value;
      let leaderTop = -Infinity,
        branchRadius = 0;
      for (let i = 0; i < points.length; i += 3) {
        const radius = Math.hypot(points[i], points[i + 1]);
        if (mesh.attributes.TEXCOORD_0.value[(i / 3) * 2 + 1] === 1)
          leaderTop = Math.max(leaderTop, points[i + 2]);
        branchRadius = Math.max(branchRadius, radius);
      }
      expect(leaderTop).toBeLessThan(0.36);
      expect(branchRadius).toBeGreaterThan(0.1);
    }
  }
});
