// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import type {TreeSpec} from '../../src';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';
import {mountTreeScene} from './tree-layer-test-utils';

it('keeps the coarse branch silhouette at shell tiers with sparse or transparent foliage', () => {
  const oak: TreeSpec = {species: 'oak', crownRadius: 2, height: 14};
  const winter: TreeSpec = {...oak, position: [-0.00006, 0], season: 'winter'};
  const sparse: TreeSpec = {...oak, position: [-0.00002, 0], foliage: 0.3};
  const transparent: TreeSpec = {...oak, position: [0.00002, 0], canopyColor: [20, 110, 30, 0]};
  const summer: TreeSpec = {...oak, position: [0.00006, 0], season: 'summer'};
  const scene = mountTreeScene<TreeSpec>();
  const layer = scene.render({data: [winter, sparse, transparent, summer], lodBias: 2});
  const [group] = layer.state.photoreal!.groups.values();
  expect(group.rows.every(row => row.shellLevel >= 1)).toBe(true);

  const coarse = group.woodBuckets[3].flatMap(row => (row ? [row.object] : []));
  const stems = group.stemBucket.flatMap(row => (row ? [row.object] : []));
  expect(coarse).toEqual([winter, sparse, transparent]);
  expect(stems).toEqual([summer]);
  const {indices, shade, lodIndexCounts} = group.model.wood;
  expect(indices.subarray(0, lodIndexCounts[3]).some(vertex => shade[vertex * 4 + 1] > 0)).toBe(
    true
  );
  expect(
    scene
      .children()
      .some(
        child =>
          child instanceof TreePhotorealWoodLayer &&
          child.props.template === group.model &&
          child.props.lod === 3 &&
          child.getNumInstances() === coarse.length
      )
  ).toBe(true);
}, 30_000);
