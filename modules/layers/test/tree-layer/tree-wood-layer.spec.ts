// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Matrix4} from '@math.gl/core';
import {
  LayerExtension,
  WebMercatorViewport,
  OrthographicViewport,
  _GlobeViewport as GlobeViewport,
  type Viewport
} from '@deck.gl/core';
import {expect, it, vi} from 'vitest';
import {TreeWoodLayer} from '../../src/tree-layer/tree-wood-layer';
import {getTreeWindPhases, TreeMeshLayer} from '../../src/tree-layer/tree-mesh-layer';
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

it('renders camera detail and honors custom wood meshes', () => {
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
  const children = layer.renderLayers();
  expect(children.length).toBeGreaterThan(0);
  for (const child of children) {
    expect(child.props.mesh).toBe(mesh);
    expect(child.props.woodMorph).toBe(false);
    expect(child.props.getStemRadius).toBe(-1);
  }
});

it('keeps near branch meshes while dense-grove foliage fills stable complementary coverage', () => {
  const row = {
    position: [0, 0, 0],
    scale: [1, 1, 5],
    translation: [0, 0, 3],
    type: 'oak' as const,
    levels: 3,
    characteristics: {},
    height: 10,
    wind: [0, 0, 0]
  };
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data: [row],
    mesh: templateMesh,
    templateMesh,
    nearBranchCoverage: 0.55
  });
  layer.initializeState();
  Object.assign(layer.state, {near: [row], far: [row]});

  const [near, far] = layer.renderLayers();
  expect(near.props.mesh).toBe(getTreeWoodMesh('oak', 3, false, {}, true));
  expect(near.props.getCoverageRange).toEqual([0, 1]);
  expect(near.props.branchCoverage).toBe(0.55);
  expect(far.props.mesh).toBe(getTreeWoodMesh('oak', 3, true, {}, true, false));
  expect(far.props.getCoverageRange).toEqual([0, 1]);
  expect(far.props.branchCoverage).toBe(1);
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
});

it('omits native wood once the projected bole is subpixel', () => {
  const row = {
    position: [0, 0, 0],
    scale: [1, 1, 5],
    translation: [0, 0, 3],
    type: 'oak' as const,
    levels: 3,
    characteristics: {},
    height: 10,
    wind: [10, 0, 1]
  };
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data: [row],
    mesh: templateMesh,
    templateMesh,
    getPosition: value => value.position,
    getScale: value => value.scale,
    getTranslation: value => value.translation
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new OrthographicViewport({width: 256, height: 256, zoom: -4});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  expect(layer.state.owners).toHaveLength(1);
  expect(layer.state.near).toEqual([]);
  expect(layer.state.far).toEqual([]);
  expect(layer.renderLayers()).toEqual([]);
});

it('uses affine wood matrices for camera bounds and refreshes matrix triggers', () => {
  const row = {
    position: [40, 0, 0],
    scale: [1, 1, 1],
    translation: [0, 0, 0],
    type: 'oak',
    levels: 3,
    characteristics: {},
    height: 1,
    wind: [1, 0, 0]
  };
  let matrix = new Matrix4().translate([-40, 0, 0]).scale([3, 2, 1]);
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data: [row],
    mesh: templateMesh,
    templateMesh,
    getTransformMatrix: () => matrix
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new OrthographicViewport({width: 256, height: 256, zoom: 0});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  expect(layer.state.owners[0].center[0]).toBe(0);
  expect(Math.max(...layer.state.owners[0].scale)).toBe(3);
  const before = layer.state.owners[0];
  matrix = new Matrix4().translate([-30, 0, 0]).scale([5, 2, 1]);
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {updateTriggersChanged: {getTransformMatrix: true}}
  });
  expect(layer.state.owners[0]).not.toBe(before);
  expect(layer.state.owners[0].center[0]).toBe(10);
  expect(Math.max(...layer.state.owners[0].scale)).toBe(5);
});

import {getTreeBotany} from '../../src/tree-layer/tree-botany';
it('retains structural banyan aerial roots in the coarse woody shell', () => {
  const roots = getTreeBotany('banyan').branches.flatMap(branch =>
    branch.children.filter(child => child.rooted)
  );
  expect(roots.length).toBeGreaterThan(0);
  for (const aggregate of [false, true]) {
    const mesh = getTreeWoodMesh('banyan', 3, aggregate, {}, true);
    const centers = mesh.attributes.COLOR_0.value;
    for (const root of roots) {
      for (const point of root.path) {
        let present = false;
        for (let i = 0; i < centers.length; i += 3)
          if (point.every((value, axis) => Math.abs(value - centers[i + axis]) < 1e-6)) {
            present = true;
            break;
          }
        expect(present).toBe(true);
      }
    }
  }
});

function makeWoodRow(x: number) {
  return {
    position: [x, 0, 0],
    scale: [1, 1, 5],
    translation: [0, 0, 3],
    type: 'oak' as const,
    levels: 3,
    characteristics: {},
    height: 10,
    wind: [10, 0, 1]
  };
}
function makeWoodLayer(data: ReturnType<typeof makeWoodRow>[], extra = {}) {
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data,
    mesh: templateMesh,
    templateMesh,
    getPosition: row => row.position,
    getScale: row => row.scale,
    getTranslation: row => row.translation,
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  vi.spyOn(layer, 'projectPosition').mockImplementation(point => Array.from(point));
  const look = (target: number[], changeFlags: object) => {
    const viewport = new OrthographicViewport({width: 256, height: 256, target, zoom: 2});
    Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
    layer.updateState({props: layer.props, oldProps: layer.props, changeFlags});
  };
  look([0, 0, 0], {dataChanged: true});
  return {layer, look};
}

it('keeps wood instance slots when trees cross the view edge', () => {
  const data = [-100, -75, -50, -25, 0, 25, 50, 75, 100].map(makeWoodRow);
  const {layer, look} = makeWoodLayer(data);
  const before = layer.state.far;
  expect(before.length).toBeGreaterThan(2);
  look([30, 0, 0], {viewportChanged: true});
  const after = layer.state.far;
  const departed = before.filter(row => !after.includes(row));
  const arrived = after.filter(row => !before.includes(row));
  expect(departed.length).toBeGreaterThan(0);
  expect(arrived.length).toBeGreaterThan(0);
  // Retained trees stay in their instance rows; arrivals take the departed rows.
  for (const [slot, row] of before.entries())
    if (after.includes(row)) expect(after[slot]).toBe(row);
  const rewritten = after.filter((row, slot) => row !== before[slot]);
  expect(rewritten).toHaveLength(Math.max(departed.length, arrived.length));
});

it('reuses cached owner metre scales and records near weights on owners', () => {
  const data = [-20, 0, 20].map(makeWoodRow);
  const {layer} = makeWoodLayer(data);
  const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 18});
  const next = new WebMercatorViewport({width: 256, height: 256, zoom: 18.5, pitch: 30});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [next]}}});
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  const scales = vi.spyOn(WebMercatorViewport.prototype, 'getDistanceScales');
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags: {viewportChanged: true}
  });
  expect(scales).not.toHaveBeenCalled();
  scales.mockRestore();
  expect(layer.state.owners.every(owner => owner.weight >= 0 && owner.weight <= 1)).toBe(true);
});

class SelectedExtension extends LayerExtension {
  static extensionName = 'SelectedExtension';
  static defaultProps = {getSelected: {type: 'accessor', value: 0}};
}
it('forwards its own and extension update triggers to near and far wood meshes', () => {
  const row = makeWoodRow(0);
  const getColor = () => [200, 40, 30];
  const updateTriggers = {
    getColor: [getColor, 1],
    getWind: [0.5, 0.25],
    getDeformation: [0.5, 0.25],
    getCoverageWeight: 2,
    getSelected: 7
  };
  const {layer} = makeWoodLayer([row], {
    extensions: [new SelectedExtension()],
    getColor,
    getSelected: () => 1,
    updateTriggers
  });
  Object.assign(layer.state, {near: [row], far: [row]});
  const children = layer.renderLayers();
  expect(children).toHaveLength(2);
  for (const child of children) expect(child.props.updateTriggers).toMatchObject(updateTriggers);
});

it('maps a controlled highlightedObjectIndex onto near and far wood rows', () => {
  const data = [-50, -25, 0, 25, 50].map(makeWoodRow);
  for (const highlighted of [0, 2, 4]) {
    const {layer} = makeWoodLayer(data, {highlightedObjectIndex: highlighted});
    Object.assign(layer.state, {near: [data[2]], far: [data[4], data[1], data[3]]});
    const [near, far] = layer.renderLayers();
    for (const child of [near, far]) {
      const row = child.props.highlightedObjectIndex;
      if (child.props.data.includes(data[highlighted]))
        expect(child.props.data[row]).toBe(data[highlighted]);
      else expect(row).toBe(-1);
    }
  }
});

it('compares constant wood coverage ranges by value', () => {
  const invalidate = vi.fn();
  const layer = Object.assign(Object.create(TreeMeshLayer.prototype), {
    internalState: {hasPickingBuffer: false},
    state: {},
    props: {wireframe: false},
    getAttributeManager: () => ({invalidate, invalidateAll: vi.fn()})
  });
  const base = {extensions: [], pickable: false, mesh: null, getCoverageWeight: 1};
  const update = (range: number[], previous: number[]) =>
    layer.updateState({
      props: {...base, getCoverageRange: range},
      oldProps: {...base, getCoverageRange: previous},
      changeFlags: {}
    });
  // TreeWoodLayer passes a new [0, 1] literal on every camera render.
  update([0, 1], [0, 1]);
  expect(invalidate).not.toHaveBeenCalled();
  update([0, 0.5], [0, 1]);
  expect(invalidate).toHaveBeenCalledWith('instanceTreeCoverage');
});

it('passes shadowEnabled to its near and far wood meshes', () => {
  const data = [-50, 0, 50].map(makeWoodRow);
  for (const shadowEnabled of [true, false]) {
    const {layer} = makeWoodLayer(data, {shadowEnabled});
    Object.assign(layer.state, {near: [data[1]], far: [data[0], data[2]]});
    const children = layer.renderLayers();
    expect(children).toHaveLength(2);
    for (const child of children) expect(child.props.shadowEnabled).toBe(shadowEnabled);
  }
});

it('bounds globe wood in its east-north-up frame and omits trees behind the globe', () => {
  // Continental synthetic trees, so they span pixels on a whole-globe camera.
  const row = (longitude: number) => ({
    position: [longitude, 0, 0],
    scale: [2e5, 2e5, 4e5],
    translation: [3e5, 0, 0],
    type: 'oak' as const,
    levels: 3,
    characteristics: {},
    height: 6e5,
    wind: [0, 0, 0]
  });
  const data = [row(0), row(180)];
  const templateMesh = getTreeWoodMesh('oak');
  const layer = new TreeWoodLayer({
    data,
    mesh: templateMesh,
    templateMesh,
    getPosition: value => value.position,
    getScale: value => value.scale,
    getTranslation: value => value.translation
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => Object.assign(layer.state, state));
  const viewport = new GlobeViewport({width: 512, height: 512, longitude: 0, latitude: 0, zoom: 1});
  Object.assign(layer, {context: {viewport, deck: {getViewports: () => [viewport]}}});
  vi.spyOn(layer, 'projectPosition').mockImplementation((point, options) =>
    (options!.viewport as Viewport).projectPosition(Array.from(point))
  );
  layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {dataChanged: true}});
  const drawn = [...layer.state.near, ...layer.state.far].filter(Boolean);
  expect(drawn).toEqual([data[0]]);
  // At longitude 0 on the equator, east is common +x and up is common -y.
  const [owner] = layer.state.owners;
  const units = owner.units[0];
  expect((owner.center[0] - owner.common[0]) / units).toBeCloseTo(3e5, 3);
  expect((owner.common[1] - owner.center[1]) / units).toBeCloseTo(2.4e5, 3);
  expect((owner.center[2] - owner.common[2]) / units).toBeCloseTo(0, 3);
});

it('projects tree mesh offsets and normals in the east-north-up globe frame', () => {
  for (const type of ['webgl', 'webgpu'] as const) {
    const layer = Object.assign(Object.create(TreeMeshLayer.prototype), {
      context: {device: {type}, defaultShaderModules: []},
      props: {...TreeMeshLayer.defaultProps, extensions: []}
    });
    const {vs, source} = layer.getShaders();
    const code = type === 'webgl' ? vs : source;
    // deck.gl's globe frame turns SimpleMeshLayer offsets toward the west and south.
    expect(code).not.toMatch(
      /project_position_to_clipspace(_and_commonspace)?\(\s*(attributes\.)?instancePositions,/
    );
    expect(code).toMatch(/splatProjectOffset\(\s*(attributes\.)?instancePositions,/);
    expect(code).not.toContain('project_normal(treeNormal)');
    expect(code.match(/treeProjectNormal\(treeNormal/g)).toHaveLength(2);
  }
});
