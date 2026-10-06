// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {getTreeBotany, sampleTreeFruit, type TreeBranch} from '../../src/tree-layer/tree-botany';
import {getTreeSplatSource} from '../../src/tree-layer/tree-splats';
import {createTreeRng} from '../../src/tree-layer/tree-geometry';

describe('Shared botanical canopy', () => {
  for (const type of ['oak', 'birch', 'cherry', 'banyan', 'mangrove'] as const) {
    it(`${type} divides its bole into tapered forks with leaves around every shoot`, () => {
      const botany = getTreeBotany(type);
      expect(Math.max(...botany.stem.map(point => point[2]))).toBeLessThan(0.35);
      expect(botany.branches.length).toBeGreaterThanOrEqual(4);
      let terminals = 0, forks = 0;
      const visit = (branch: TreeBranch, parentRadius: number) => {
        expect(branch.radius).toBeLessThan(parentRadius);
        expect(branch.path.length).toBeGreaterThanOrEqual(3);
        expect(branch.radii).toHaveLength(branch.path.length);
        expect(branch.radii!.every(value => value > 0 && Number.isFinite(value))).toBe(true);
        if (branch.rooted) {
          expect(branch.path.at(-1)![2]).toBeCloseTo(-1, 10);
          return;
        }
        const tip = branch.path.at(-1)!;
        expect(botany.clusters.some(cluster => Math.hypot(...tip.map((value, axis) => (value - cluster.center[axis]) / cluster.radius[axis])) < 0.5)).toBe(true);
        terminals++;
        forks += branch.children.filter(child => !child.rooted).length;
        branch.children.forEach(child => visit(child, branch.radius));
      };
      botany.branches.forEach(branch => visit(branch, 0.06));
      expect(terminals).toBeGreaterThan(30);
      expect(terminals).toBeLessThan(600);
      expect(forks).toBeGreaterThan(25);
      const crowns = botany.clusters.map(cluster => cluster.center);
      expect(Math.max(...crowns.map(point => point[0])) - Math.min(...crowns.map(point => point[0]))).toBeGreaterThan(0.4);
      // Attraction-driven paths vary in length: the old fixed ten-ring recursive fan cannot pass.
      expect(new Set(botany.branches.flatMap(branch => [branch.path.length, ...branch.children.map(child => child.path.length)])).size).toBeGreaterThan(3);
      expect(getTreeBotany(type)).toBe(botany);
      const source = getTreeSplatSource(type);
      for (let i = 0; i < source.positions.length / 3; i++) {
        expect(
          botany.clusters.some(cluster => {
            const distance = Math.hypot(
              ...cluster.center.map(
                (value, axis) => (source.positions[i * 3 + axis] - value) / cluster.radius[axis]
              )
            );
            return distance <= 0.94001;
          })
        ).toBe(true);
      }
    });
    it(`${type} keeps the complete fruit sphere inside leaf clusters at varied aspect ratios`, () => {
      const clusters = getTreeBotany(type).clusters;
      for (const scale of [
        [7, 5, 8],
        [2, 4, 12],
        [10, 10, 2]
      ] as [number, number, number][]) {
        const rng = createTreeRng(9182);
        for (let i = 0; i < 200; i++) {
          const radius = i % 2 ? 0.08 : 0.12;
          const point = sampleTreeFruit(type, 3, rng, scale, radius)!;
          expect(point).not.toBeNull();
          // Triangle inequality bounds every point on the sphere, including after yaw rotation.
          expect(
            clusters.some(cluster => {
              const centerNorm = Math.hypot(
                ...point.map((value, axis) => (value - cluster.center[axis]) / cluster.radius[axis])
              );
              const sphereNorm = Math.max(
                ...scale.map((value, axis) => radius / value / cluster.radius[axis])
              );
              return cluster.fruitBearing && centerNorm + sphereNorm <= 0.700001;
            })
          ).toBe(true);
        }
      }
      expect(sampleTreeFruit(type, 3, createTreeRng(1), [1, 1, 1], 0.5)).toBeNull();
      expect(sampleTreeFruit(type, 3, createTreeRng(1), [0, 1, 1], 0.01)).toBeNull();
    });
  }
});
