// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import type {TreeSpec} from '../../../src';
import {TreePhotorealWoodLayer} from '../../../src/common-layers/tree-layer/tree-photoreal-wood-layer';
import {mountTreeScene} from './tree-layer-test-utils';

it('keeps the coarse branch silhouette at shell tiers with sparse or transparent foliage', () => {
  const oak: TreeSpec = {species: 'oak', crownRadius: 2, height: 14};
  const winter: TreeSpec = {...oak, position: [-0.00006, 0], season: 'winter'};
  const nearlyBare: TreeSpec = {...oak, position: [-0.00004, 0], foliage: 0.1};
  const sparse: TreeSpec = {...oak, position: [-0.00002, 0], foliage: 0.3};
  const transparent: TreeSpec = {...oak, position: [0.00002, 0], canopyColor: [20, 110, 30, 0]};
  const summer: TreeSpec = {...oak, position: [0.00006, 0], season: 'summer'};
  const scene = mountTreeScene<TreeSpec>();
  const data = [winter, nearlyBare, sparse, transparent, summer];
  const layer = scene.render({data, lodBias: 2});
  const [group] = layer.state.photoreal!.groups.values();
  expect(group.rows.every(row => row.shellLevel >= 1)).toBe(true);

  const coarse = group.woodBuckets[3].flatMap(row => (row ? [row.object] : []));
  const stems = group.stemBucket.flatMap(row => (row ? [row.object] : []));
  expect(coarse).toEqual([winter, nearlyBare, sparse, transparent]);
  expect(stems).toEqual([summer]);
  const {indices, shade, lodIndexCounts} = group.model.wood;
  expect(indices.subarray(0, lodIndexCounts[3]).some(vertex => shade[vertex * 4 + 1] > 0)).toBe(
    true
  );
  const wood = () => scene.children().filter(child => child instanceof TreePhotorealWoodLayer);
  const coarseColor = wood().find(
    child =>
      child.props.template === group.model &&
      child.props.lod === 3 &&
      child.props._shadowPass === 'skip'
  );
  expect(coarseColor?.getNumInstances()).toBe(coarse.length);

  const branchCaster = wood().find(
    child => child.props._shadowPass === 'only' && child.props.template === group.model
  );
  const stemCaster = wood().find(
    child => child.props._shadowPass === 'only' && child.props.template !== group.model
  );
  expect(branchCaster?.props.lod).toBe(3);
  expect(branchCaster?.props.data).toBe(group.shadowBranchBucket);
  expect(group.shadowBranchBucket.map(row => row.object)).toEqual([
    winter,
    nearlyBare,
    transparent
  ]);
  expect(stemCaster?.props.data).toBe(group.shadowStemBucket);
  expect(group.shadowStemBucket.map(row => row.object)).toEqual([sparse, summer]);

  scene.render({data, lodBias: -2});
  expect(wood().find(child => child.id === branchCaster?.id)?.props.data).toBe(
    branchCaster?.props.data
  );
  expect(wood().find(child => child.id === stemCaster?.id)?.props.data).toBe(
    stemCaster?.props.data
  );

  scene.render({data: [summer], lodBias: -2});
  expect(wood().find(child => child.id === branchCaster?.id)).toBeUndefined();
  expect(group.shadowStemBucket).toBe(group.shadowBucket);
}, 30_000);
