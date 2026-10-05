// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, it, expect, vi} from 'vitest';
import {TreeLayer} from '../../src/tree-layer/tree-layer';
import {
  getTreeMesh,
  createPalmCanopyMesh,
  createTrunkMesh,
  createCropMesh,
  samplePineSurface,
  sampleCrownSurface
} from '../../src/tree-layer/tree-geometry';

type Datum = {
  position: [number, number];
  type: 'oak' | 'pine' | 'palm';
  season: 'summer' | 'winter';
};
function createLayer(data: Datum[], extra = {}) {
  const layer = new TreeLayer<Datum>({
    id: 'trees',
    data,
    getTreeType: d => d.type,
    getSeason: d => d.season,
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => {
    Object.assign(layer.state, state);
  });
  const update = (overrides = {}, flags = {propsChanged: true}) =>
    layer.updateState({
      props: Object.assign(Object.create(layer.props), overrides),
      oldProps: {},
      changeFlags: flags
    });
  update({}, {dataChanged: true} as any);
  return {layer, update};
}
const OAK: Datum = {position: [0, 0], type: 'oak', season: 'summer'};

describe('native tree geometry', () => {
  it('has finite unit normals, valid triangles and correct bounds for every species/detail/season', () => {
    for (const detail of ['low', 'medium', 'high'] as const)
      for (const type of ['pine', 'oak', 'palm', 'birch', 'cherry'] as const)
        for (const winter of [false, true]) {
          const mesh = getTreeMesh('canopy', type, detail, winter);
          const p = mesh.attributes.POSITION.value;
          const n = mesh.attributes.NORMAL.value;
          expect(mesh.indices.value.length % 3).toBe(0);
          expect(mesh.indices.value.every(index => index < p.length / 3)).toBe(true);
          expect(p.every(Number.isFinite)).toBe(true);
          let maxNormalError = 0;
          for (let i = 0; i < n.length; i += 3)
            maxNormalError = Math.max(
              maxNormalError,
              Math.abs(Math.hypot(n[i], n[i + 1], n[i + 2]) - 1)
            );
          expect(maxNormalError).toBeLessThan(0.0001);
          const z = p.filter((_, i) => i % 3 === 2);
          expect(Math.max(...z)).toBeGreaterThan(0.7);
          expect(Math.min(...z)).toBeGreaterThanOrEqual(-0.03);
        }
  });
  it('shares meshes across instances and bounds broadleaf foliage to one sphere topology', () => {
    const mesh = getTreeMesh('canopy', 'oak');
    expect(getTreeMesh('canopy', 'oak')).toBe(mesh);
    expect(mesh.indices.value.length / 3).toBeLessThanOrEqual(320);
    expect(getTreeMesh('canopy', 'oak', 'low').indices.value.length).toBeLessThan(
      mesh.indices.value.length
    );
  });
  it('keeps low-detail pine within the legacy triangle budget and drops redundant cap faces', () => {
    expect(
      getTreeMesh('canopy', 'pine', 'low', false, 4).indices.value.length / 3
    ).toBeLessThanOrEqual(80);
    expect(
      getTreeMesh('canopy', 'pine', 'high', false, 4).indices.value.length / 3
    ).toBeLessThanOrEqual(150);
  });
  it('keeps the dense feathered palm silhouette deterministic', () => {
    const first = createPalmCanopyMesh();
    expect(first.indices.value.length / 3).toBeLessThan(1800);
    expect(createPalmCanopyMesh().attributes.POSITION.value).toEqual(
      first.attributes.POSITION.value
    );
    expect(first.attributes.POSITION.value.length / 3).toBeGreaterThan(3000);
    const p = first.attributes.POSITION.value;
    expect(Math.max(...p.filter((_, i) => i % 3 === 0))).toBeGreaterThan(0.9);
    expect(Math.max(...p.filter((_, i) => i % 3 === 2))).toBeGreaterThan(0.95);
  });
  it('tapers trunks upward and uses actual radius-one centered crop geometry', () => {
    const p = createTrunkMesh().attributes.POSITION.value;
    let bottom = 0;
    let top = 0;
    for (let i = 0; i < p.length; i += 3) {
      const radius = Math.hypot(p[i], p[i + 1]);
      if (p[i + 2] < 0.1) bottom = Math.max(bottom, radius);
      if (p[i + 2] > 0.9) top = Math.max(top, radius);
    }
    expect(top).toBeLessThan(bottom);
    const crop = createCropMesh().attributes.POSITION.value;
    for (let i = 0; i < crop.length; i += 3)
      expect(Math.hypot(crop[i], crop[i + 1], crop[i + 2])).toBeCloseTo(1, 5);
    expect(Math.min(...crop.filter((_, i) => i % 3 === 2))).toBeCloseTo(-1, 5);
    expect(Math.max(...crop.filter((_, i) => i % 3 === 2))).toBeCloseTo(1, 5);
  });
});

describe('TreeLayer sublayer override contracts', () => {
  it('unwraps exact trunk and crop accessors on the first render, including owner context', () => {
    const data: Datum[] = [{position: [1, 0], type: 'pine', season: 'summer'}, {...OAK}];
    const calls: {object: Datum; index: number; data: Datum[]}[] = [];
    const getColor = (object: Datum, info) => {
      calls.push({object, index: info.index, data: info.data});
      info.target[0] = 100 + info.index;
      info.target[1] = 20;
      info.target[2] = 30;
      info.target[3] = 255;
      return info.target;
    };
    const overrides = {
      visible: false,
      material: false,
      parameters: {depthWriteEnabled: false},
      getColor,
      updateTriggers: {getColor: 'explicit-color'}
    };
    const {layer} = createLayer(data, {
      getCrop: () => ({count: 2, droppedCount: 2, radius: 0.1, color: [200, 80, 40, 255]}),
      windStrength: 0.025,
      windTime: 2,
      updateTriggers: {all: 'owner-data'},
      _subLayerProps: {
        trunks: {...overrides},
        'live-crops': {...overrides},
        'dropped-crops': {...overrides}
      }
    });
    const children = layer.renderLayers();
    for (const id of ['trunks', 'live-crops', 'dropped-crops']) {
      const child = children.find(candidate => candidate.id === `trees-${id}`)!;
      const rowIndex = id === 'trunks' ? 1 : 2;
      const row = child.props.data[rowIndex];
      expect(
        child.props.getColor(row, {index: rowIndex, data: child.props.data, target: []})
      ).toEqual([101, 20, 30, 255]);
      expect(calls.at(-1)).toEqual({object: data[1], index: 1, data});
      expect(child.props.visible).toBe(false);
      expect(child.props.material).toBe(false);
      expect(child.props.parameters.depthWriteEnabled).toBe(false);
      expect(child.props.updateTriggers).toMatchObject({
        all: 'owner-data',
        getColor: 'explicit-color'
      });
      expect(child.props.windStrength).toBe(0.025);
      expect(child.props.windTime).toBe(2);
      const picked = layer.getPickingInfo({info: {object: row, index: rowIndex}} as any);
      expect(picked.object).toBe(data[1]);
      expect(picked.index).toBe(1);
    }
  });

  it('applies legacy species overrides last and gives exact canopy IDs precedence', () => {
    const data: Datum[] = [{...OAK}, {...OAK, position: [2, 0], season: 'winter'}];
    const getAliasColor = vi.fn((object: Datum, info) => [
      object.type === 'oak' ? 90 : 0,
      info.index,
      0,
      255
    ]);
    const getExactColor = vi.fn((object: Datum, info) => [
      object.type === 'oak' ? 120 : 0,
      info.index,
      0,
      255
    ]);
    const getAliasScale = vi.fn((object: Datum, info) => [
      object.position[0] + 1,
      info.index + 1,
      3
    ]);
    const {layer} = createLayer(data, {
      windStrength: 0.03,
      windTime: 4,
      parameters: {depthCompare: 'less-equal'},
      updateTriggers: {all: 'trees'},
      _subLayerProps: {
        'canopy-oak': {
          visible: false,
          material: false,
          parameters: {depthWriteEnabled: false},
          getColor: getAliasColor,
          getScale: getAliasScale,
          updateTriggers: {getColor: 'alias-color', getScale: 'alias-scale'}
        },
        'canopy-oak-foliage-3': {
          visible: true,
          material: {ambient: 0.2},
          parameters: {blend: false},
          getColor: getExactColor,
          updateTriggers: {getColor: 'exact-color'}
        }
      }
    });
    const children = layer.renderLayers();
    const summer = children.find(child => child.id === 'trees-canopy-oak-foliage-3')!;
    const winter = children.find(child => child.id === 'trees-canopy-oak-winter-3')!;
    for (const [child, sourceIndex, expectedColor] of [
      [summer, 0, [120, 0, 0, 255]],
      [winter, 1, [90, 1, 0, 255]]
    ] as const) {
      const row = child.props.data[0];
      const context = {index: 0, data: child.props.data, target: []};
      expect(child.props.getColor(row, context)).toEqual(expectedColor);
      expect(child.props.getScale(row, context)).toEqual([
        data[sourceIndex].position[0] + 1,
        sourceIndex + 1,
        3
      ]);
      expect(child.props.parameters).toMatchObject({
        depthCompare: 'less-equal',
        depthWriteEnabled: false
      });
      expect(child.props.updateTriggers).toMatchObject({all: 'trees', getScale: 'alias-scale'});
      expect(child.props.windStrength).toBe(0.03);
      expect(child.props.windTime).toBe(4);
    }
    expect(summer.props.visible).toBe(true);
    expect(summer.props.material).toEqual({ambient: 0.2});
    expect(summer.props.parameters.blend).toBe(false);
    expect(summer.props.updateTriggers.getColor).toBe('exact-color');
    expect(winter.props.visible).toBe(false);
    expect(winter.props.material).toBe(false);
    expect(winter.props.updateTriggers.getColor).toBe('alias-color');
    expect(getExactColor.mock.calls[0][0]).toBe(data[0]);
    expect(getAliasColor.mock.calls[0][0]).toBe(data[1]);
    expect(getAliasScale.mock.calls.map(call => call[1].index)).toEqual([0, 1]);
    expect(getAliasScale.mock.calls.every(call => call[1].data === data)).toBe(true);
  });

  it('preserves palm wind and double-sided defaults while allowing explicit overrides', () => {
    const data: Datum[] = [{position: [3, 0], type: 'palm', season: 'summer'}];
    const common = {
      windStrength: 0.025,
      windTime: 2,
      _subLayerProps: {'canopy-palm': {parameters: {depthWriteEnabled: false}}}
    };
    const canopy = createLayer(data, common)
      .layer.renderLayers()
      .find(child => child.id.includes('canopy'))!;
    expect(canopy.props.doubleSided).toBe(true);
    expect(canopy.props.parameters).toMatchObject({cullMode: 'none', depthWriteEnabled: false});
    expect(canopy.props.windStrength).toBe(0.025);
    expect(canopy.props.windTime).toBe(2);
    const changed = createLayer(data, {
      ...common,
      _subLayerProps: {
        ...common._subLayerProps,
        'canopy-palm-foliage-3': {
          doubleSided: false,
          windStrength: 0.05,
          windTime: 3,
          shadowEnabled: false,
          parameters: {cullMode: 'back'}
        }
      }
    })
      .layer.renderLayers()
      .find(child => child.id.includes('canopy'))!;
    expect(changed.props.doubleSided).toBe(false);
    expect(changed.props.parameters).toMatchObject({cullMode: 'back', depthWriteEnabled: false});
    expect(changed.props.windStrength).toBe(0.05);
    expect(changed.props.windTime).toBe(3);
    expect(changed.props.shadowEnabled).toBe(false);
  });
});

describe('TreeLayer prepared data and crop contracts', () => {
  it('does not regroup data or rebuild crop instances for wind clock or color-only updates', () => {
    const {layer} = createLayer([OAK]);
    const state = layer.state;
    const groups = state.groups;
    (layer.setState as any).mockClear();
    layer.updateState({
      props: Object.assign(Object.create(layer.props), {windTime: 25, windStrength: 0.03}),
      oldProps: layer.props,
      changeFlags: {propsChanged: true}
    });
    expect(layer.setState).not.toHaveBeenCalled();
    expect(layer.state.groups).toBe(groups);
  });
  it('uses branching geometry in winter while evergreens retain their crown', () => {
    const {layer} = createLayer([
      {...OAK, season: 'winter'},
      {position: [1, 0], type: 'pine', season: 'winter'}
    ]);
    expect([...layer.state.groups.keys()]).toContain('oak-winter-3');
    expect([...layer.state.groups.keys()]).toContain('pine-foliage-3');
  });
  it('keeps crop placement stable when count grows, keeps drops above ground, and preserves owner picking', () => {
    const crop = {count: 8, droppedCount: 5, radius: 0.2, color: [200, 80, 40, 255]};
    const {layer} = createLayer([OAK], {getCrop: () => crop});
    const prefix = layer.state.liveCrops.map(point => point.translation);
    const expanded = createLayer([OAK], {getCrop: () => ({...crop, count: 16})}).layer;
    expect(expanded.state.liveCrops.slice(0, 8).map(point => point.translation)).toEqual(prefix);
    expect(expanded.state.droppedCrops.map(point => point.translation)).toEqual(
      layer.state.droppedCrops.map(point => point.translation)
    );
    for (const point of layer.state.droppedCrops) expect(point.translation[2]).toBe(point.radius);
    const info = layer.getPickingInfo({info: {object: layer.state.liveCrops[0], index: 0}} as any);
    expect(info.object).toBe(OAK);
    expect(info.index).toBe(0);
  });
  it('respects accessor update triggers and mixed seasons', () => {
    const datum = {...OAK};
    const {layer} = createLayer([datum]);
    datum.season = 'winter';
    layer.updateState({
      props: layer.props,
      oldProps: layer.props,
      changeFlags: {updateTriggersChanged: {getSeason: true}}
    });
    expect([...layer.state.groups.keys()]).toEqual(['oak-winter-3']);
  });
  it('places pine crop points on a nonzero stable tier surface', () => {
    for (const levels of [1, 2, 3, 4, 5]) {
      const point = samplePineSurface(levels, 0.35, 0.8);
      expect(Math.hypot(point[0], point[1])).toBeGreaterThan(0.1);
      expect(point[2]).toBe(0.35);
      expect(samplePineSurface(levels, 0.35, 0.8)).toEqual(point);
    }
  });
  it('samples crop points on the visible union envelope', () => {
    const point = sampleCrownSurface('oak', [1, 0, 0]);
    expect(point[0]).toBeGreaterThan(0.4);
    expect(point[2]).toBe(0.5);
  });
});
