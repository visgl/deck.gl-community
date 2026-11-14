// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {getTreeGrowthModel} from '../../src/tree-layer/tree-growth-model';
import {createPalmGrowthModel} from '../../src/tree-layer/tree-palm-growth-model';
import {createPineGrowthModel} from '../../src/tree-layer/tree-pine';
import {SHELL_STAGES} from '../../src/tree-layer/tree-shell-fit';
import {getTreeShellMesh} from '../../src/tree-layer/tree-shell-mesh';
import {getTreeStemModel} from '../../src/tree-layer/tree-stem-model';

describe('TreeLayer fitted crowns', () => {
  it.each([
    ['citrus', () => getTreeGrowthModel('citrus')],
    ['pine', () => createPineGrowthModel(3)],
    ['palm', () => createPalmGrowthModel(1)]
  ] as const)('retains live growth stages and reduces indexed geometry for %s', (_species, model) => {
    const template = model();
    const levels = [0, 1, 2, 3].map(level => getTreeShellMesh(template, level));
    const counts = levels.map(mesh => mesh.indices.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(levels[0].height).toBe(SHELL_STAGES.length);
    expect(counts[3]).toBe(30);
    for (const [level, mesh] of levels.entries()) {
      expect(mesh.data).toHaveLength(mesh.width * mesh.height * 4);
      expect(mesh.data.every(Number.isFinite)).toBe(true);
      expect(mesh.data[(SHELL_STAGES.length - 1) * mesh.width * 4]).toBeGreaterThan(0);
      expect(mesh.indices.every(index => index < mesh.vertexCount)).toBe(true);
      expect(getTreeShellMesh(template, level)).toBe(mesh);
    }
    const caster = getTreeShellMesh(template, 2, true);
    expect(caster.indices.length / 3).toBe(48);
    expect(caster.data.every(Number.isFinite)).toBe(true);
    expect(getTreeShellMesh(template, 0, true)).toBe(caster);
    const stem = getTreeStemModel(template);
    expect(stem.wood.indices.length).toBeLessThan(template.wood.lodIndexCounts[3]);
    expect(stem.wood.indices.every(index => index < stem.wood.vertexCount)).toBe(true);
    expect(stem.wood.center.some((value, i) => i % 4 === 2 && value >= template.forkZ * 0.7)).toBe(
      true
    );
  });
});
