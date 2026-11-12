// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {type AccessorContext} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {type TreeLayerProps, type TreeSpec} from '../../src';
import {TreePhotorealCropLayer} from '../../src/tree-layer/tree-photoreal-crop-layer';
import {TreePhotorealLeafLayer} from '../../src/tree-layer/tree-photoreal-leaf-layer';
import {TreePhotorealWoodLayer} from '../../src/tree-layer/tree-photoreal-wood-layer';
import {mountTreeScene} from './tree-layer-test-utils';

function prepare<DataT>(data: DataT[], props: Partial<TreeLayerProps<DataT>> = {}) {
  const scene = mountTreeScene<DataT>();
  scene.render({...props, data});
  return scene;
}

it('renders row traits directly, derives species dimensions, and retains evergreen winter crops', () => {
  const data: TreeSpec[] = [
    {
      position: [0, 0, 7],
      species: 'citrus',
      height: 5,
      crownRadius: 2,
      season: 'winter',
      trunkColor: [80, 60, 20],
      canopyColor: [10, 120, 30],
      crop: {kind: 'lemon', color: [255, 220, 20], count: 4, radius: 0.25}
    },
    {position: [0.0001, 0], species: 'oak', season: 'winter'}
  ];
  const scene = prepare(data, {lodBias: -2});
  expect(scene.row()).toMatchObject({
    height: 5,
    position: [0, 0, 7],
    trunkColor: [80, 60, 20, 255],
    canopyColor: [10, 120, 30, 255],
    foliage: 1
  });
  expect(scene.row().trunkRadius).toBeCloseTo(0.125);
  expect(scene.row(1)).toMatchObject({height: 14, foliage: 0});
  const crops = scene.children().filter(child => child instanceof TreePhotorealCropLayer);
  expect(crops.some(child => child.props.visible && child.props.kind === 'lemon')).toBe(true);
}, 30_000);

it('evaluates one mapped traits accessor per source row and lets granular accessors override it', () => {
  const data: {tree: TreeSpec}[] = [
    {tree: {position: [1, 2], species: 'citrus', height: 9}},
    {tree: {position: [3, 4], species: 'oak', height: 14}}
  ];
  const indices: number[] = [];
  type Row = (typeof data)[number];
  const getTree = vi.fn((row: Row, info: AccessorContext<Row>) => {
    indices.push(info.index);
    expect(info.data).toBe(data);
    return row.tree;
  });
  const scene = prepare(data, {getTree, getHeight: 5, getPosition: [0, 0], getSeason: 'summer'});
  expect(getTree).toHaveBeenCalledTimes(2);
  expect(indices).toEqual([0, 1]);
  for (const index of [0, 1]) {
    expect(scene.row(index)).toMatchObject({height: 5, position: [0, 0, 0]});
  }
});

it('shares identical morphology templates and pairs each distinct wood and foliage group', () => {
  const small = {leafSize: 0.8, branchLift: 0.7};
  const large = {leafSize: 1.4, branchLift: 1.5};
  const data: TreeSpec[] = [small, small, large].map((characteristics, index) => ({
    position: [index * 0.00004, 0],
    species: 'citrus',
    height: 5,
    characteristics
  }));
  const scene = prepare(data);
  const groups = [...scene.layer().state.photoreal!.groups.values()];
  expect(groups.map(group => group.rows.length).sort()).toEqual([1, 2]);
  expect(groups[0].model).not.toBe(groups[1].model);
  for (const group of groups) {
    const parts = scene.children().filter(child => child.id.includes(group.key));
    expect(
      parts.some(
        child => child instanceof TreePhotorealWoodLayer && child.props.template === group.model
      )
    ).toBe(true);
    expect(
      parts.some(
        child => child instanceof TreePhotorealLeafLayer && child.props.template === group.model
      )
    ).toBe(true);
  }
}, 30_000);

it('normalizes independent wind amplitudes without rebuilding geometry on global wind updates', () => {
  const data: TreeSpec[] = [false, true, 0.1].map((wind, index) => ({
    position: [index * 0.0001, 0],
    species: 'citrus',
    wind
  }));
  const scene = prepare(data, {windStrength: 0.05});
  const wood = () => scene.children().find(child => child instanceof TreePhotorealWoodLayer)!;
  expect(wood().props.windStrength).toBe(0.1);
  expect([0, 1, 2].map(index => scene.row(index).windFlex)).toEqual([0, 0.25, 1]);
  const {rows, groups} = scene.layer().state.photoreal!;
  scene.render({data, windStrength: 0.08});
  expect(scene.layer().state.photoreal!.rows).toBe(rows);
  expect(scene.layer().state.photoreal!.groups).toBe(groups);
  expect(wood().props.windStrength).toBe(0.1);
  scene.render({data: [{...data[0]}], windStrength: 0.05});
  expect(wood().props.windStrength).toBe(0);
});

it('derives matching dimensions from species traits and explicit getTreeType accessors', () => {
  const position: [number, number] = [0, 0];
  const expected = prepare<TreeSpec>([{position, species: 'citrus'}]).row();
  const accessor = prepare([{position}], {getTreeType: 'citrus'});
  const mapped = prepare([{position, kind: 'citrus' as const}], {getTreeType: row => row.kind});
  for (const scene of [accessor, mapped]) {
    expect(scene.row()).toMatchObject({
      height: expected.height,
      trunkHeight: expected.trunkHeight,
      trunkRadius: expected.trunkRadius,
      crownX: expected.crownX,
      crownY: expected.crownY
    });
  }
  const override = prepare([{position}], {
    getTreeType: 'citrus',
    getHeight: 9,
    getTrunkRadius: 0.2
  });
  expect(override.row()).toMatchObject({height: 9, trunkRadius: 0.2});
});

it.each([
  ['pine', 3],
  ['palm', 3],
  ['oak', 6]
] as const)('preserves the authored and accessor canopy radius units for %s', (species, getCanopyRadius) => {
  const position: [number, number] = [0, 0];
  const authored = prepare<TreeSpec>([{position, species, crownRadius: 3}]).row();
  const accessor = prepare<TreeSpec>([{position, species}], {getCanopyRadius}).row();
  expect(accessor.crownX).toBeCloseTo(authored.crownX);
  expect(accessor.crownY).toBeCloseTo(authored.crownY);
});
