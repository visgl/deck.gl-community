// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {type TreeSpec} from '../../src';
import {getTreeBotany, sampleTreeFruit} from '../../src/tree-layer/tree-botany';
import {getTreeSplatSource} from '../../src/tree-layer/tree-splats';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
import {getTreeCropMesh, type CropKind} from '../../src/tree-layer/tree-crop';
import {createTreeRng} from '../../src/tree-layer/tree-geometry';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  TreeTemplateCache
} from '../../src/tree-layer/tree-characteristics';
import {TreePhotorealCropLayer} from '../../src/tree-layer/tree-photoreal-crop-layer';
import {TreePhotorealLeafLayer} from '../../src/tree-layer/tree-photoreal-leaf-layer';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';
import {mountTreeScene} from './tree-layer-test-utils';

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
    expect(source.positions.length / 3).toBe(3072);
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
    const scene = mountTreeScene<TreeSpec>();
    const data: TreeSpec[] = [{position: [0, 0], species: 'citrus'}];
    for (const crop of [
      {count: Infinity, droppedCount: Infinity, radius: 0.25},
      {count: 10, droppedCount: 10, radius: Infinity}
    ]) {
      scene.render({data, lodBias: -2, getCrop: () => ({...crop, color: [255, 150, 20]})});
      expect(scene.row().crops[0]).toMatchObject({count: 0, dropped: 0});
      expect(
        scene
          .children()
          .some(child => child instanceof TreePhotorealCropLayer && child.props.visible)
      ).toBe(false);
    }
  });
  it('updates wood, foliage and crop templates together and retains owners during animation', () => {
    const scene = mountTreeScene<TreeSpec>();
    const data: TreeSpec[] = [
      {
        position: [0, 0],
        species: 'citrus',
        height: 10,
        crownRadius: 4,
        crop: {kind: 'lemon', color: [255, 220, 20], count: 12, radius: 0.25}
      }
    ];
    const props = {data, lodBias: -2};
    const initial = scene.render({...props, windTime: 0}).state.photoreal!;
    const {rows, groups} = initial;
    const previous = [...groups.values()][0].model;
    scene.render({...props, windTime: 3});
    expect(scene.layer().state.photoreal!.rows).toBe(rows);
    expect(scene.layer().state.photoreal!.groups).toBe(groups);

    const characteristics = {seed: 43, leafDensity: 0.5};
    const next = scene.render({...props, windTime: 3, characteristics});
    const group = [...next.state.photoreal!.groups.values()][0];
    expect(group.model).not.toBe(previous);
    expect(next.state.sources[0].characteristics.seed).toBe(43);
    const children = scene.children();
    for (const Part of [TreePhotorealCropLayer, TreePhotorealLeafLayer, TreePhotorealWoodLayer]) {
      expect(
        children.some(child => child instanceof Part && child.props.template === group.model),
        Part.layerName
      ).toBe(true);
    }
    const crop = children.find(
      child => child instanceof TreePhotorealCropLayer && child.props.visible
    )!;
    expect(next.getPickingInfo({info: {index: 0}, sourceLayer: crop} as never).object).toBe(
      data[0]
    );
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
