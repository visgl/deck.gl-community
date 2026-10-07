// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it, vi} from 'vitest';
import {getTreeBotany, sampleTreeFruit} from '../../src/tree-layer/tree-botany';
import {getTreeSplatSource} from '../../src/tree-layer/tree-splats';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
import {TreeLayer} from '../../src/tree-layer/tree-layer';
import {getTreeCropMesh, type CropKind} from '../../src/tree-layer/tree-crop';
import {createTreeRng} from '../../src/tree-layer/tree-geometry';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  TreeTemplateCache
} from '../../src/tree-layer/tree-characteristics';

describe('Shared tree characteristics', () => {
  it('bounds malformed inputs and quantizes equivalent slider states to the same template', () => {
    const traits = resolveTreeCharacteristics({
      seed: NaN,
      leafDensity: Infinity,
      branchDensity: -5,
      branchLift: 10,
      crownDepth: 0
    });
    expect(traits.seed).toBe(0);
    expect(traits.leafDensity).toBe(1);
    expect(traits.branchDensity).toBe(0.5);
    expect(traits.branchLift).toBe(3);
    expect(traits.crownDepth).toBe(0.6);
    expect(getTreeCharacteristicsKey({leafSize: 1.001})).toBe(
      getTreeCharacteristicsKey({leafSize: 1})
    );
    expect(getTreeSplatSource('citrus', 3, {leafSize: 1.001})).toBe(getTreeSplatSource('citrus'));
    const cache = new TreeTemplateCache<number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a');
    cache.set('d', 4);
    expect(cache.size).toBe(3);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
  });
  it('changes branching, leaf count and leaf size while keeping complete crop bounds in the same shoots', () => {
    const traits = {seed: 19, crownSpread: 1.3, branchLift: 0.5, leafDensity: 0.5, leafSize: 1.4};
    const botany = getTreeBotany('citrus', traits);
    const source = getTreeSplatSource('citrus', 3, traits);
    expect(botany).not.toBe(getTreeBotany('citrus'));
    expect(getTreeWoodMesh('citrus', 3, false, traits)).not.toBe(getTreeWoodMesh('citrus'));
    expect(source.positions.length / 3).toBe(6144);
    expect(Math.max(...source.scales)).toBeGreaterThan(
      Math.max(...getTreeSplatSource('citrus').scales)
    );
    const scale: [number, number, number] = [4, 3, 4],
      rng = createTreeRng(42),
      radius = 0.052;
    for (let i = 0; i < 200; i++) {
      const point = sampleTreeFruit('citrus', 3, rng, scale, radius, traits)!;
      expect(point).not.toBeNull();
      expect(
        botany.clusters.some(cluster => {
          const norm = Math.hypot(
            ...point.map((value, axis) => (value - cluster.center[axis]) / cluster.radius[axis])
          );
          const margin = Math.max(
            ...scale.map((value, axis) => radius / value / cluster.radius[axis])
          );
          return norm + margin <= 0.700001;
        })
      ).toBe(true);
    }
  });
  it('rejects non-finite crop sizes and counts without generating unbounded instances', () => {
    const data = [{position: [0, 0] as [number, number]}];
    for (const crop of [
      {color: [255, 150, 20], count: Infinity, droppedCount: Infinity, radius: 0.045},
      {color: [255, 150, 20], count: 10, droppedCount: 10, radius: Infinity}
    ]) {
      const layer = new TreeLayer<{position: [number, number]}>({
        id: 'bounded-crops',
        data,
        getTreeType: () => 'citrus',
        getCrop: () => ({...crop, color: [255, 150, 20]})
      });
      layer.initializeState();
      vi.spyOn(layer, 'setState').mockImplementation(next => Object.assign(layer.state, next));
      layer.updateState({props: layer.props, oldProps: {}, changeFlags: {dataChanged: true}});
      expect(layer.state.liveCrops).toHaveLength(0);
      expect(layer.state.droppedCrops).toHaveLength(0);
    }
  });
  it('updates all three template consumers together and retains owner rows on animation-only updates', () => {
    const data = [{position: [0, 0] as [number, number]}];
    const layer = new TreeLayer({
      id: 'citrus',
      data,
      getTreeType: () => 'citrus',
      getCrop: () => ({kind: 'lemon', color: [255, 220, 20], count: 12, radius: 0.052})
    });
    layer.initializeState();
    vi.spyOn(layer, 'setState').mockImplementation(next => Object.assign(layer.state, next));
    layer.updateState({props: layer.props, oldProps: {}, changeFlags: {dataChanged: true}});
    const rows = layer.state.groups,
      crops = layer.state.liveCrops;
    layer.updateState({
      props: Object.assign(Object.create(layer.props), {windTime: 3}),
      oldProps: layer.props,
      changeFlags: {propsChanged: true}
    });
    expect(layer.state.groups).toBe(rows);
    expect(layer.state.liveCrops).toBe(crops);
    const traits = {seed: 43, leafDensity: 0.5};
    const next = Object.assign(Object.create(layer.props), {characteristics: traits});
    layer.updateState({props: next, oldProps: layer.props, changeFlags: {propsChanged: true}});
    expect(layer.state.groups).not.toBe(rows);
    expect(layer.state.liveCrops).not.toBe(crops);
    const row = [...layer.state.groups.values()][0][0];
    expect(row.characteristics.seed).toBe(43);
    // deck.gl child props retain data ownership for picking, including shaped crops.
    expect(layer.state.liveCrops.every(crop => crop.kind === 'lemon')).toBe(true);
  });
});

describe('Species crop meshes', () => {
  for (const kind of [
    'fruit',
    'lemon',
    'cone',
    'acorn',
    'catkin',
    'flower',
    'propagule'
  ] as CropKind[]) {
    it(`${kind} fits the enclosing sphere used for foliage containment`, () => {
      const mesh = getTreeCropMesh(kind),
        positions = mesh.attributes.POSITION.value;
      expect(getTreeCropMesh(kind)).toBe(mesh);
      let maxRadius = 0;
      for (let i = 0; i < positions.length; i += 3)
        maxRadius = Math.max(maxRadius, Math.hypot(...positions.subarray(i, i + 3)));
      expect(maxRadius).toBeLessThanOrEqual(1.000001);
      expect(mesh.attributes.NORMAL.value.every(Number.isFinite)).toBe(true);
      expect(mesh.indices.value.every(index => index < positions.length / 3)).toBe(true);
    });
  }
});
