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
function make(data: {position: [number, number, number]}[], flex = 1) {
  const layer = new SplatLayer({
    data,
    source: SOURCE,
    deformationStrength: 0.1,
    getDeformation: [10, 0, flex]
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
