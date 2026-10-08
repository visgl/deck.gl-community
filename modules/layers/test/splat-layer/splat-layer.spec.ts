// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
const SOURCE = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([0.8])
};
function make(data: {position: [number, number, number]}[], flex = 1, extra = {}) {
  const layer = new SplatLayer({
    data,
    source: SOURCE,
    deformationStrength: 0.1,
    getDeformation: [10, 0, flex],
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  Object.assign(layer, {
    context: {
      viewport,
      device: {canvasContext: {cssToDeviceRatio: () => 1}},
      deck: {getViewports: () => [viewport]}
    }
  });
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  return layer;
}
it('includes absolute flex in both wind allowances for camera and light bounds', () => {
  const data = [{position: [0, 0, 0] as [number, number, number]}];
  const rigid = make(data, 0),
    normal = make(data, 1),
    flexible = make(data, -4);
  const base = rigid.state.owners[0].radius;
  expect(flexible.state.owners[0].radius - base).toBeCloseTo(
    (normal.state.owners[0].radius - base) * 4,
    10
  );
});

it('starts shared capped registrations at coverage before their first joint grant', () => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array])
    ])
  );
  const layer = make([{position: [256, 256, 0]}], 0, {
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: SOURCE, error: 1}
    ],
    pixelError: 0.001,
    _splatBudgetGroup: {maxSplats: 100, maxShadowSplats: 100}
  });
  expect(layer.state.candidates[0].level).toBe(0);
  expect(layer.splatStats.renderedSplats).toBe(1);
  expect(layer.splatStats.coverageFloor).toBe(1);
});
it('reconciles fallback shadow membership on replacement without retaining removed owners', () => {
  const a = {position: [0, 0, 0] as [number, number, number]},
    b = {position: [1, 0, 0] as [number, number, number]};
  const layer = make([a, b]);
  const next = [b];
  // updateState reads the current layer props, matching deck's state-transfer lifecycle.
  Object.assign(layer, {props: layer.clone({data: next}).props});
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  expect(
    [...layer.state.shadowRefinement.entries.values()].map(entry => entry.owner.row.object)
  ).toEqual([b]);
  expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual([b]);
});

it('refreshes light-space owner offsets before regrouping replaced or cleared assets', () => {
  const first = {position: [0, 0, 0] as [number, number, number], splats: SOURCE};
  const second = {
    position: [0.1, 0, 0] as [number, number, number],
    splats: {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])}
  };
  const layer = make([first, second], 0, {source: undefined, getSource: row => row.splats});
  layer.prepareShadow(
    [
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        center: [0, 0, 0, 0],
        width: 256,
        height: 256
      }
    ],
    layer.context.viewport
  );
  expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual([first, second]);
  const retained = [...layer.state.shadowRefinement.entries.values()][1];
  for (const data of [[second], []]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual(data);
    if (data.length) {
      expect([...layer.state.shadowRefinement.entries.values()]).toEqual([retained]);
      expect(retained.owner.offset).toBe(0);
    }
  }
  expect(layer.state.shadowRefinement.entries.size).toBe(0);
  expect(layer.renderLayers()).toEqual([]);
});

it('restores shifted-origin shadow casters immediately after an empty inventory', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const projections = [
    {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    }
  ];
  layer.prepareShadow(projections, layer.context.viewport);
  for (const data of [[], [{position: [100, 0, 0] as [number, number, number]}]]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    // A precision-preserving host origin shifts with the replacement owner's pose.
    vi.mocked(layer.projectPosition).mockImplementation(() => [0, 0, 0]);
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.shadowGroups.flat().map(row => row.object)).toEqual(data);
  }
});

it('retains light-space selections on camera-only changes and invalidates changed source geometry', () => {
  const layer = make([{position: [0, 0, 0]}], 0);
  const viewport = layer.context.viewport;
  const projections = [
    {
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      center: [0, 0, 0, 0],
      width: 256,
      height: 256
    }
  ];
  layer.prepareShadow(projections, viewport);
  const recull = vi.spyOn(layer.state.shadowRefinement, 'reconcile');
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  layer.prepareShadow(projections, viewport);
  expect(recull).not.toHaveBeenCalled();
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  expect(recull).toHaveBeenCalledOnce();
  // Identical input light matrices in a different precision origin still select a new volume.
  vi.mocked(layer.projectPosition).mockImplementation(point => [
    point[0] + 0.5,
    point[1],
    point[2] ?? 0
  ]);
  layer.prepareShadow(projections, viewport);
  expect(recull).toHaveBeenCalledTimes(2);
});

it('includes translated source centers in prepared camera and light wind bounds', () => {
  const data = [{position: [0, 0, 0] as [number, number, number]}];
  const layer = make(data, 1);
  const rigidRadius = make(data, 0).state.owners[0].radius;
  const oldProps = layer.props;
  Object.assign(layer, {
    props: layer.clone({
      source: {...SOURCE, scales: new Float32Array([0.1, 0.1, 0.1])},
      getTranslation: [100, 0, 1],
      getDeformation: [1, 0, 1]
    }).props
  });
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  // Compare in the same owner's common-space metre scale: the old allowance was only 0.465m.
  expect(layer.state.owners[0].radius).toBeGreaterThan((rigidRadius * 2) / 3);
  expect(layer.state.owners[0].center[0]).toBeGreaterThan(0);
});

it('keeps heterogeneous source identity and original accessor contexts through refinement', () => {
  const layer = make([{position: [0, 0, 0]}, {position: [1, 0, 0]}], 0);
  const data = layer.props.data;
  const second = {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])};
  const oldProps = layer.props;
  const getSource = vi.fn((_row, info) => {
    expect(info.data).toBe(data);
    return info.index ? second : SOURCE;
  });
  Object.assign(layer, {props: layer.clone({source: undefined, getSource}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
  expect(layer.state.owners.map(owner => owner.row.object)).toEqual(data);
  expect(layer.state.owners.map(owner => owner.asset.source)).toEqual([SOURCE, second]);
  expect(layer.state.hierarchy).toHaveLength(2);
  expect(getSource).toHaveBeenCalledTimes(2);
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  } as any);
  expect(getSource).toHaveBeenCalledTimes(2);
});

it('preserves a moving owner when other assets enter or leave and safely clears all owners', () => {
  const fine = Object.fromEntries(
    Object.entries(SOURCE).map(([key, array]) => [
      key,
      new (array.constructor as typeof Float32Array)([...array, ...array, ...array])
    ])
  );
  const firstAsset = {
    type: 'prepared-splats' as const,
    source: fine,
    hierarchy: [
      {source: fine, error: 0},
      {source: SOURCE, error: 1}
    ]
  };
  const secondAsset = {...SOURCE, colors: new Uint8Array([200, 20, 50, 255])};
  const first = {position: [256, 256, 0] as [number, number, number], splats: firstAsset};
  const second = {position: [257, 256, 0] as [number, number, number], splats: secondAsset};
  const layer = make([first], 0, {
    source: undefined,
    getSource: row => row.splats,
    pixelError: 0.001
  });
  const transition = layer.state.refinement;
  const owner = layer.state.owners[0];
  transition.reconcile([{owner, pixels: 1, level: 1, blend: 0}], [3, 1], Infinity, row => row.key);
  transition.sample(1);
  transition.sample(17);
  const entry = transition.entries.get(owner.key)!;
  const weights = [...entry.weights];
  expect(weights[0]).toBeGreaterThan(0);
  expect(weights[1]).toBeGreaterThan(0);
  for (const data of [[first, second], [first], []]) {
    const oldProps = layer.props;
    Object.assign(layer, {props: layer.clone({data}).props});
    layer.updateState({props: layer.props, oldProps, changeFlags: {dataChanged: true}} as any);
    expect(layer.state.refinement).toBe(transition);
    if (data.length) {
      expect(transition.entries.get(owner.key)).toBe(entry);
      expect(entry.weights).toEqual(weights);
    }
  }
  expect(layer.state.hierarchy).toEqual([]);
  expect(layer.state.groups.flat()).toEqual([]);
  expect(layer.state.shadowGroups.flat()).toEqual([]);
  expect(layer.renderLayers()).toEqual([]);
});
