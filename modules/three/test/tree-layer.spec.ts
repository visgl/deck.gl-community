// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {TreeLayer} from '../src/index';
import {
  createTrunkMesh,
  createPineCanopyMesh,
  createOakCanopyMesh,
  createPalmCanopyMesh,
  createBirchCanopyMesh,
  createCherryCanopyMesh
} from '../src/tree-layer/tree-geometry';

describe('TreeLayer', () => {
  it('exports TreeLayer', () => {
    expect(TreeLayer).toBeTruthy();
    expect(TreeLayer.layerName).toBe('TreeLayer');
  });

  it('has correct default props', () => {
    const defaults = TreeLayer.defaultProps as Record<string, any>;
    expect(defaults.sizeScale.value).toBe(1);
    expect(typeof defaults.getPosition.value).toBe('function');
    expect(typeof defaults.getTreeType.value).toBe('function');
    expect(defaults.getTreeType.value({})).toBe('pine');
    expect(defaults.getHeight.value({})).toBe(10);
    expect(defaults.getSeason.value({})).toBe('summer');
  });
});

describe('tree geometry generators', () => {
  it('createTrunkMesh returns valid mesh', () => {
    const mesh = createTrunkMesh();
    expect(mesh.topology).toBe('triangle-list');
    expect(mesh.mode).toBe(4);
    expect(mesh.attributes.POSITION.value.length).toBeGreaterThan(0);
    expect(mesh.attributes.NORMAL.value.length).toBeGreaterThan(0);
    expect(mesh.attributes.POSITION.size).toBe(3);
    expect(mesh.attributes.NORMAL.size).toBe(3);
    expect(mesh.indices.value.length).toBeGreaterThan(0);
  });

  it('createPineCanopyMesh returns valid mesh for different levels', () => {
    for (const levels of [1, 3, 5]) {
      const mesh = createPineCanopyMesh(levels);
      expect(mesh.topology).toBe('triangle-list');
      expect(mesh.attributes.POSITION.value.length).toBeGreaterThan(0);
    }
  });

  it('all canopy generators return valid meshes', () => {
    const generators = [
      createOakCanopyMesh,
      createPalmCanopyMesh,
      createBirchCanopyMesh,
      createCherryCanopyMesh
    ];
    for (const gen of generators) {
      const mesh = gen();
      expect(mesh.topology).toBe('triangle-list');
      expect(mesh.attributes.POSITION.value.length).toBeGreaterThan(0);
      expect(mesh.indices.value.length).toBeGreaterThan(0);
    }
  });

  it('trunk mesh vertices are Z-up (base near z=0, tip near z=1)', () => {
    const mesh = createTrunkMesh();
    const positions = mesh.attributes.POSITION.value;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 2; i < positions.length; i += 3) {
      minZ = Math.min(minZ, positions[i]);
      maxZ = Math.max(maxZ, positions[i]);
    }
    expect(minZ).toBeGreaterThanOrEqual(-0.01);
    expect(maxZ).toBeCloseTo(1, 1);
  });
});
