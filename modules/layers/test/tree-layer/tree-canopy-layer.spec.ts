// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {WebMercatorViewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {SplatPrimitiveLayer} from '../../src/splat-layer/splat-primitive-layer';
import {TreeCanopyLayer, TreeCanopyPrimitiveLayer} from '../../src/tree-layer/tree-canopy-layer';
import {WindEffect} from '../../src/wind-effect/wind-effect';

const SOURCE = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 1, 1]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([0.8])
};

/** A canopy over one owner under a 0.1 WindEffect, with its owner bounds built. */
function make(
  Layer: typeof SplatLayer | typeof TreeCanopyLayer,
  data: {position: [number, number, number]}[],
  extra = {}
) {
  const layer = new (Layer as typeof TreeCanopyLayer)({data, getSource: SOURCE, ...extra});
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  const deck = {getViewports: () => [viewport]};
  const effect = new WindEffect({strength: 0.1});
  effect.setup({deck} as any);
  Object.assign(layer, {
    context: {viewport, device: {canvasContext: {cssToDeviceRatio: () => 1}}, deck}
  });
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {dataChanged: true}
  } as any);
  return {layer, effect, deck};
}

const owner = [{position: [0, 0, 0] as [number, number, number]}];
const radius = (Layer: typeof SplatLayer | typeof TreeCanopyLayer, extra = {}) =>
  make(Layer, owner, extra).layer.state.owners[0].radius;

it('widens owner bounds by the wind excursion, in proportion to absolute flex', () => {
  const still = radius(SplatLayer);
  const rigid = radius(TreeCanopyLayer, {getWind: [10, 0, 0]});
  const normal = radius(TreeCanopyLayer, {getWind: [10, 0, 1]});
  const flexible = radius(TreeCanopyLayer, {getWind: [10, 0, -4]});
  // A plain SplatLayer knows nothing of wind: a rigid canopy has the same bounds.
  expect(rigid).toBe(still);
  expect(normal).toBeGreaterThan(rigid);
  expect(flexible - rigid).toBeCloseTo((normal - rigid) * 4, 10);
  expect(radius(TreeCanopyLayer, {getWind: [10, 0, 1], windEnabled: false})).toBe(rigid);
});

it('includes translated source centers in the canopy wind bounds', () => {
  const extra = {
    getSource: {...SOURCE, scales: new Float32Array([0.1, 0.1, 0.1])},
    getTranslation: [100, 0, 1]
  };
  const rigid = make(TreeCanopyLayer, owner, {...extra, getWind: [1, 0, 0]}).layer;
  const windy = make(TreeCanopyLayer, owner, {...extra, getWind: [1, 0, 1]}).layer;
  // Compare in the same owner's common-space metre scale: the old allowance was only 0.465m.
  expect(windy.state.owners[0].radius).toBeGreaterThan(rigid.state.owners[0].radius * 1.5);
  expect(windy.state.owners[0].center[0]).toBeGreaterThan(0);
});

it('rebuilds owner bounds when the WindEffect or a per-tree flex changes', () => {
  const {layer, effect} = make(TreeCanopyLayer, owner, {getWind: [10, 0, 1]});
  const before = layer.state.owners[0].radius;
  expect((layer.state as {windKey?: string}).windKey).toBe(effect.boundKey);
  effect.setProps({...effect.props, strength: 0.2});
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {}} as any);
  expect(layer.state.owners[0].radius).toBeGreaterThan(before);
  const stronger = layer.state.owners[0].radius;
  const oldProps = layer.props;
  Object.assign(layer, {props: layer.clone({getWind: [10, 0, 2]}).props});
  layer.updateState({props: layer.props, oldProps, changeFlags: {propsChanged: true}} as any);
  expect(layer.state.owners[0].radius).toBeGreaterThan(stronger);
});

it('draws its levels with the canopy primitive and passes getWind against the original rows', () => {
  const canopy = Object.create(TreeCanopyLayer.prototype);
  expect(canopy.getPrimitiveLayerClass()).toBe(TreeCanopyPrimitiveLayer);
  expect(canopy.getPrimitiveAccessorNames()).toEqual(['getWind']);
  expect(new TreeCanopyPrimitiveLayer({}).constructor).toHaveProperty('splatPrimitive', true);
  expect(Object.create(SplatLayer.prototype).getPrimitiveLayerClass()).toBe(SplatPrimitiveLayer);
});

it('patches the bend into both SplatLayer shaders, and leaves sorted canopies unbent', () => {
  const shadersFor = (transparency: string) =>
    TreeCanopyPrimitiveLayer.prototype.getShaders.call({
      props: {extensions: [], transparency},
      context: {defaultShaderModules: []}
    });
  const plain = SplatPrimitiveLayer.prototype.getShaders.call({
    props: {extensions: []},
    context: {defaultShaderModules: []}
  });
  for (const code of [plain.vs, plain.source]) expect(code).not.toMatch(/wind/i);
  const windy = shadersFor('weighted');
  expect(windy.modules.map(module => module.name)).toContain('wind');
  for (const code of [windy.vs, windy.source]) {
    expect(code).toContain('instanceTreeWind');
    expect(code).toContain('windBend(position');
    expect(code).toContain('windFlutter(position');
  }
  expect(windy.source).toContain('@location(15) instanceTreeWind: vec4<f32>');
  const sorted = shadersFor('sorted');
  expect(sorted.modules.map(module => module.name)).not.toContain('wind');
  expect(sorted.vs).toBe(plain.vs);
});
