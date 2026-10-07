// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {TreeLayer, type TreeSpec} from '../../src';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
function prepare<DataT>(data: DataT[], extra = {}) {
  const layer = new TreeLayer<DataT>({id: 'traits', data, ...extra});
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  layer.updateState({
    props: layer.props,
    oldProps: {} as any,
    changeFlags: {dataChanged: true} as any
  });
  return layer;
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
      crop: {kind: 'lemon', color: [255, 220, 20], count: 4, radius: 0.05}
    },
    {position: [0.0001, 0], species: 'oak', season: 'winter'}
  ];
  const layer = prepare(data);
  const citrus = layer.state.groups.get('citrus-foliage-3')![0];
  expect(citrus.height).toBe(5);
  expect(citrus.position).toEqual([0, 0, 7]);
  expect(citrus.trunkRadius).toBeCloseTo(0.125);
  expect(citrus.trunkHeight).toBe(1);
  expect(citrus.scale[2]).toBe(4);
  expect(layer.state.groups.get('oak-winter-3')![0].height).toBe(14);
  expect(layer.state.liveCrops.length).toBeGreaterThan(0);
  const children = layer.renderLayers();
  const crown = children.find(child => child.id.includes('canopy-citrus'))!;
  expect(crown).toBeInstanceOf(SplatLayer);
  expect(crown.props.getColor(citrus, {index: 0, data: [citrus], target: []})).toEqual([
    10, 120, 30
  ]);
  expect(children.some(child => child.id.includes('canopy-oak'))).toBe(false);
});
it('evaluates one mapped traits accessor per source row and lets granular accessors override it', () => {
  const data = [
    {tree: {position: [1, 2], species: 'citrus', height: 9}},
    {tree: {position: [3, 4], species: 'oak', height: 14}}
  ];
  const indices: number[] = [];
  const getTree = vi.fn((row, info) => {
    indices.push(info.index);
    expect(info.data).toBe(data);
    return row.tree;
  });
  const layer = prepare(data, {getTree, getHeight: 5, getPosition: [0, 0], getSeason: 'summer'});
  expect(getTree).toHaveBeenCalledTimes(2);
  expect(indices).toEqual([0, 1]);
  for (const rows of layer.state.groups.values()) {
    expect(rows[0].height).toBe(5);
    expect(rows[0].position).toEqual([0, 0, 0]);
  }
});
it('shares identical morphology templates and pairs each distinct wood/crown group', () => {
  const small = {leafSize: 0.8, branchLift: 0.7};
  const large = {leafSize: 1.4, branchLift: 1.5};
  const data: TreeSpec[] = [small, small, large].map((characteristics, index) => ({
    position: [index * 0.0001, 0],
    species: 'citrus',
    height: 5,
    characteristics
  }));
  const layer = prepare(data);
  expect(layer.state.groups.size).toBe(2);
  expect([...layer.state.groups.values()].map(rows => rows.length).sort()).toEqual([1, 2]);
  const children = layer.renderLayers();
  for (const [key, rows] of layer.state.groups) {
    const wood = children.find(child => child.id === `traits-wood-${key}`)!;
    const crown = children.find(child => child.id === `traits-canopy-${key}`)!;
    expect(wood.props.data[0]).toBe(rows[0]);
    expect(crown.props.data[0]).toBe(rows[0]);
  }
});
it('normalizes independent wind amplitudes without rebuilding geometry on global wind updates', () => {
  const data: TreeSpec[] = [false, true, 0.1].map((wind, index) => ({
    position: [index * 0.0001, 0],
    species: 'citrus',
    wind
  }));
  const layer = prepare(data, {windStrength: 0.05});
  const children = layer.renderLayers();
  const wood = children.find(child => child.id.includes('-wood-'))!;
  expect(wood.props.windStrength).toBe(0.1);
  expect(wood.props.data.map(row => wood.props.getWind(row)[2])).toEqual([0, 0.25, 1]);
  const rows = layer.state.groups;
  vi.mocked(layer.setState).mockClear();
  layer.updateState({
    props: layer.clone({windStrength: 0.08}).props,
    oldProps: layer.props,
    changeFlags: {propsChanged: true} as any
  });
  expect(layer.setState).not.toHaveBeenCalled();
  expect(layer.state.groups).toBe(rows);
  const still = prepare([{position: [0, 0], species: 'citrus', wind: false}] as TreeSpec[], {
    windStrength: 0.05
  });
  expect(still.renderLayers().find(child => child.id.includes('-wood-'))!.props.windStrength).toBe(
    0
  );
});
