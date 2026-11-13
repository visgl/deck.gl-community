// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, expect, it} from 'vitest';
import {type TreeSpec} from '../../src';
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
  it('batches palms by their seed and ignores broadleaf morphology', () => {
    const scene = mountTreeScene<TreeSpec>();
    const layer = scene.render({
      data: [
        {position: [0, 0], species: 'palm', characteristics: {seed: 5, branchWander: 0}},
        {position: [0.00001, 0], species: 'palm', characteristics: {seed: 5, branchWander: 2}},
        {position: [0.00002, 0], species: 'palm', characteristics: {seed: 6}}
      ]
    });
    const groups = [...layer.state.photoreal!.groups.values()];
    expect(groups.map(group => group.rows.length)).toEqual([2, 1]);
    expect(groups[0].model).not.toBe(groups[1].model);
  });

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
