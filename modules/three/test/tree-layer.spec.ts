// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {TreeLayer} from '../src/index';
import {
  createTrunkMesh,
  createDatePalmTrunkMesh,
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

  it('extends palm trunks into the crown', () => {
    const datum = {position: [0, 0] as [number, number]};
    const layer = new TreeLayer({
      id: 'palm-crown-connection',
      data: [datum],
      getTreeType: () => 'palm',
      getHeight: () => 10,
      getTrunkHeightFraction: () => 0.8,
      getTrunkRadius: () => 1
    });

    layer.state = {
      grouped: {pine: [], oak: [], palm: [datum], birch: [], cherry: []},
      pineMeshes: {},
      liveCropPoints: [],
      droppedCropPoints: []
    } as typeof layer.state;

    const palmTrunk = layer.renderLayers().find(subLayer => subLayer.id.endsWith('trunks-palm'));
    const scale = palmTrunk?.props.getScale(datum);

    expect(scale).toEqual([1, 1, 8.48]);
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

  it('palm trunk adds leaf-scar detail without changing unit bounds', () => {
    const basicTrunk = createTrunkMesh();
    const palmTrunk = createDatePalmTrunkMesh();
    const positions = palmTrunk.attributes.POSITION.value;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 2; i < positions.length; i += 3) {
      minZ = Math.min(minZ, positions[i]);
      maxZ = Math.max(maxZ, positions[i]);
    }

    expect(positions.length).toBeGreaterThan(basicTrunk.attributes.POSITION.value.length * 4);
    expect(minZ).toBeGreaterThanOrEqual(-0.01);
    expect(maxZ).toBeLessThanOrEqual(1.01);
  });

  it('palm crown has a dense radial, pinnate silhouette', () => {
    const mesh = createPalmCanopyMesh();
    const positions = mesh.attributes.POSITION.value;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }

    expect(positions.length / 3).toBeGreaterThan(4000);
    expect(minX).toBeLessThan(-0.9);
    expect(maxX).toBeGreaterThan(0.9);
    expect(minY).toBeLessThan(-0.9);
    expect(maxY).toBeGreaterThan(0.9);
    expect(minZ).toBeGreaterThan(0);
    expect(maxZ).toBeGreaterThan(0.95);
  });

  it('palm geometry is deterministic', () => {
    const first = createPalmCanopyMesh();
    const second = createPalmCanopyMesh();

    expect(second.attributes.POSITION.value).toEqual(first.attributes.POSITION.value);
    expect(second.indices.value).toEqual(first.indices.value);
  });
});
