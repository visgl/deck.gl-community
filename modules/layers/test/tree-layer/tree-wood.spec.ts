// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
import {evaluatePalmFrond, getPalmFronds} from '../../src/tree-layer/tree-palm';

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

it('joins each palm rachis at its authored root', () => {
  const mesh = getTreeWoodMesh('palm');
  const positions = mesh.attributes.POSITION.value;
  const textureCoordinates = mesh.attributes.TEXCOORD_0.value;
  const branchVertices: number[] = [];
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    const offset = vertex * 3;
    if (textureCoordinates[vertex * 2 + 1] === 0)
      branchVertices.push(positions[offset], positions[offset + 1], positions[offset + 2]);
  }

  for (const frond of getPalmFronds()) {
    const base = evaluatePalmFrond(frond, 0);
    let nearestRoot = Infinity;
    for (let vertex = 0; vertex < branchVertices.length; vertex += 3)
      nearestRoot = Math.min(
        nearestRoot,
        Math.hypot(
          branchVertices[vertex] - base[0],
          branchVertices[vertex + 1] - base[1],
          branchVertices[vertex + 2] - base[2]
        )
      );
    expect(nearestRoot).toBeLessThan(0.007);
  }
});

it('tapers the palm leader to a small crown tip', () => {
  const mesh = getTreeWoodMesh('palm');
  const positions = mesh.attributes.POSITION.value;
  const textureCoordinates = mesh.attributes.TEXCOORD_0.value;
  const trunkVertices: number[] = [];
  let leaderTop = -Infinity;
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    if (textureCoordinates[vertex * 2 + 1] !== 1) continue;
    const offset = vertex * 3;
    trunkVertices.push(positions[offset], positions[offset + 1], positions[offset + 2]);
    leaderTop = Math.max(leaderTop, positions[offset + 2]);
  }
  const topRadius = Math.max(
    ...Array.from({length: trunkVertices.length / 3}, (_, vertex) => {
      const offset = vertex * 3;
      return trunkVertices[offset + 2] >= leaderTop - 0.025
        ? Math.hypot(trunkVertices[offset], trunkVertices[offset + 1])
        : 0;
    })
  );
  expect(topRadius).toBeLessThan(0.02);
  expect(leaderTop).toBeGreaterThan(0.65);
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

it('uses a reduced branchless bole for subpixel dense wood LOD', () => {
  for (const type of ['oak', 'banyan', 'mangrove'] as const) {
    const aggregate = getTreeWoodMesh(type, 3, true, undefined, true);
    const trunkOnly = getTreeWoodMesh(type, 3, true, undefined, true, true);
    expect(trunkOnly.attributes.POSITION.value.length).toBeLessThan(
      aggregate.attributes.POSITION.value.length
    );
    expect(trunkOnly.attributes.POSITION.value.every(Number.isFinite)).toBe(true);
    expect(
      trunkOnly.indices.value.every(index => index < trunkOnly.attributes.POSITION.value.length / 3)
    ).toBe(true);
    expect(getTreeWoodMesh(type, 3, true, undefined, true, true)).toBe(trunkOnly);
  }
});

it('builds finite banyan roots across sparse asymmetric growth', () => {
  for (let seed = 0; seed < 64; seed++) {
    const traits = {seed, branchDensity: 0.5, crownAsymmetry: 2, crownSpread: 0.6, crownDepth: 0.6};
    for (const aggregate of [false, true]) {
      const mesh = getTreeWoodMesh('banyan', 4, aggregate, traits);
      expect(mesh.attributes.POSITION.value.every(Number.isFinite), `seed ${seed}`).toBe(true);
      expect(Math.max(...mesh.indices.value)).toBeLessThan(
        mesh.attributes.POSITION.value.length / 3
      );
    }
  }
}, 20000);
