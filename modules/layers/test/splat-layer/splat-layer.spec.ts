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
  Object.assign(layer, {props: Object.assign(Object.create(layer.props), {data: next})});
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
