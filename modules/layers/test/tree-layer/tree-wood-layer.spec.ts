// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Matrix4} from '@math.gl/core';
import {WebMercatorViewport} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {TreeWoodLayer} from '../../src/tree-layer/tree-wood-layer';
it('reuses 20K bounds during camera motion and retains off-camera light casters', () => {
  const data = Array.from({length: 20000}, (_, i) => ({
    position: [(i - 10000) / 111320, 0, 0] as [number, number, number],
    scale: [1, 1, 1],
    translation: [0, 0, 5],
    height: 10,
    wind: [10, 0, 1]
  }));
  const layer = new TreeWoodLayer({id: 'wood', data, windStrength: 0.1});
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  let viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  const project = vi
    .spyOn(layer, 'projectPosition')
    .mockImplementation((point, options) =>
      options?.autoOffset === false
        ? [point[0] * 111320, point[1], point[2]]
        : [point[0] * 111320 - 100, point[1], point[2]]
    );
  const update = (dataChanged = false) =>
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {dataChanged, viewportChanged: true}
    });
  update(true);
  const index = layer.state.spatialIndex,
    owners = layer.state.owners;
  const light = {
    matrix: Array.from(new Matrix4().scale([0.05, 0.05, 0.05])),
    center: [0, 0, 0, 0],
    width: 256,
    height: 256
  };
  layer.prepareShadow([light], viewport);
  const casters = layer.state.shadow;
  expect(casters.length).toBeGreaterThan(0);
  expect(layer.state.shadowNear.length + layer.state.shadowFar.length).toBe(casters.length);
  expect(casters.length).toBeLessThan(100);
  expect(casters).toContain(data[10100]);
  viewport = new WebMercatorViewport({
    width: 256,
    height: 256,
    zoom: 18,
    longitude: 0.05,
    latitude: 0.03,
    bearing: 80,
    pitch: 80
  });
  layer.context.viewport = viewport;
  project.mockClear();
  update();
  expect(project).not.toHaveBeenCalled();
  expect(layer.state.spatialIndex).toBe(index);
  expect(layer.state.owners).toBe(owners);
  expect(layer.state.shadow).toBe(casters);
  layer.prepareShadow([light], viewport);
  expect(project).not.toHaveBeenCalled();
  expect(layer.state.shadow).toBe(casters);
  layer.prepareShadow([{...light, center: [-50, 0, 0, 0]}], viewport);
  expect(layer.state.shadow).not.toBe(casters);
  expect(layer.state.shadow).toContain(data[11100]);
  expect(layer.state.shadow.length).toBeLessThan(100);
});

import {getTreeWindPhases} from '../../src/tree-layer/tree-mesh-layer';
it('preserves both wind modes when phases are cached per owner', () => {
  for (const phase of [-5, 0, 0.7, 5.2])
    for (const time of [0, 1.6, 45.7]) {
      const [height, flex, sinPhase, cosPhase, sinCrown, cosCrown] = getTreeWindPhases([
        12,
        phase,
        0.8
      ]);
      expect(height).toBe(12);
      expect(flex).toBe(0.8);
      expect(Math.sin(time * 1.6) * cosPhase + Math.cos(time * 1.6) * sinPhase).toBeCloseTo(
        Math.sin(time * 1.6 + phase),
        12
      );
      expect(Math.sin(time * 3.2) * cosCrown + Math.cos(time * 3.2) * sinCrown).toBeCloseTo(
        Math.sin(time * 3.2 + phase * 1.7),
        12
      );
    }
});

import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
it('keeps physical bole width independent of crown spread and retains branch centerlines', () => {
  for (const aggregate of [false, true]) {
    const mesh = getTreeWoodMesh('oak', 3, aggregate, {}, true);
    const points = mesh.attributes.POSITION.value,
      centers = mesh.attributes.COLOR_0.value,
      markers = mesh.attributes.TEXCOORD_0.value;
    for (const scale of [
      [8, 8, 10],
      [18, 12, 10],
      [30, 25, 10]
    ]) {
      const radius = 0.4,
        factor = radius / (0.06 * Math.max(scale[0], scale[1]));
      let baseRadius = 0,
        topRadius = 0,
        anchors = 0;
      for (let vertex = 0; vertex < points.length / 3; vertex++) {
        const i = vertex * 3;
        const radial = [0, 1, 2].map(
          axis => (points[i + axis] - centers[i + axis]) * factor * scale[axis]
        );
        if (Math.hypot(...radial) < 1e-7) anchors++;
        if (markers[vertex * 2 + 1] === 1) {
          if (Math.abs(centers[i + 2] + 1) < 1e-6)
            baseRadius = Math.max(baseRadius, Math.hypot(radial[0], radial[1]));
          if (centers[i + 2] > 0.3)
            topRadius = Math.max(topRadius, Math.hypot(radial[0], radial[1]));
        }
      }
      expect(baseRadius).toBeCloseTo(radius, 5);
      expect(topRadius).toBeLessThan(baseRadius * 0.9);
      expect(anchors).toBeGreaterThan(1);
    }
  }
});

it('retains conservative default LightingEffect casters and honors custom wood meshes', () => {
  const data = [
    {
      position: [30, 0, 0],
      scale: [1, 1, 5],
      translation: [0, 0, 3],
      type: 'oak',
      levels: 3,
      characteristics: {},
      height: 10,
      wind: [10, 0, 1]
    }
  ];
  const mesh = getTreeWoodMesh('palm');
  const layer = new TreeWoodLayer({
    data,
    mesh,
    getPosition: row => row.position,
    getScale: row => row.scale,
    getTranslation: row => row.translation
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  expect(layer.state.shadow).toEqual(data);
  expect(layer.state.shadowNear).toEqual(data);
  const children = layer.renderLayers();
  expect(children.length).toBeGreaterThan(1);
  expect(children.some(child => child.props.operation === 'shadow')).toBe(true);
  for (const child of children) {
    expect(child.props.mesh).toBe(mesh);
    expect(child.props.woodMorph).toBe(false);
    expect(child.props.getStemRadius).toBe(-1);
  }
});

it('culls wood from resolved transforms and refreshes overridden accessor bounds', () => {
  const data = [
    {
      position: [40, 0, 0],
      scale: [1, 1, 5],
      translation: [0, 0, 3],
      type: 'oak',
      levels: 3,
      characteristics: {},
      height: 10,
      wind: [10, 0, 1]
    }
  ];
  let position = [0, 0, 0];
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data,
    mesh: templateMesh,
    templateMesh,
    getPosition: () => position,
    getScale: [2, 3, 4],
    getTranslation: [4, 5, 6],
    getWind: [12, 0, 4],
    windStrength: 0.1
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  const before = layer.state.owners[0];
  expect(before.position).toEqual([0, 0, 0]);
  expect(before.scale).toEqual([2, 3, 4]);
  position = [10, 2, 0];
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {updateTriggersChanged: {getPosition: true}}
  });
  expect(layer.state.owners[0].position).toEqual(position);
  expect(layer.state.owners[0]).not.toBe(before);
  expect(layer.state.shadow).toEqual(data);
});
