// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, it, expect, vi} from 'vitest';
import {TreeLayer, type TreeType} from '../../src/tree-layer/tree-layer';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
import {
  getTreeMesh,
  createPalmCanopyMesh,
  createTrunkMesh,
  createCropMesh,
  samplePineSurface,
  sampleCrownSurface,
  type TreeMesh
} from '../../src/tree-layer/tree-geometry';

type Datum = {
  position: [number, number];
  type: TreeType;
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

function getMeshRing(mesh: TreeMesh, height: number, leaderOnly = false) {
  const points = new Map<string, [number, number, number]>();
  const positions = mesh.attributes.POSITION.value;
  const markers = mesh.attributes.TEXCOORD_0.value;
  for (let i = 0; i < positions.length; i += 3) {
    const point: [number, number, number] = [positions[i], positions[i + 1], positions[i + 2]];
    if (leaderOnly && markers[(i / 3) * 2] !== 1) continue;
    if (Math.abs(point[2] - height) > 0.000001 || Math.hypot(point[0], point[1]) < 0.000001)
      continue;
    const key = point
      .slice(0, 2)
      .map(value => Math.round(value * 1e6))
      .join(',');
    points.set(key, point);
  }
  return [...points.values()];
}

describe('native tree geometry', () => {
  it.each([
    'pine',
    'oak',
    'palm',
    'birch',
    'cherry',
    'banyan',
    'mangrove',
    'citrus'
  ] as const)('%s composes connected wood and the full Gaussian source, ignoring a legacy detail prop', type => {
    for (const season of ['summer', 'winter'] as const) {
      const {layer} = createLayer([{position: [0, 0], type, season}], {detail: 'low'});
      const children = layer.renderLayers();
      const wood = children.find(child => child.id.includes('wood'))!;
      const crown = children.find(child => child.id.includes('canopy'));
      expect(wood.props.mesh).toBe(getTreeWoodMesh(type));
      if (season === 'winter' && (type === 'oak' || type === 'birch' || type === 'cherry'))
        expect(crown).toBeUndefined();
      else {
        expect(crown).toBeInstanceOf(SplatLayer);
        expect(crown!.props.getSource.source.opacities.length).toBeGreaterThan(1000);
        expect(crown!.props.getSource.hierarchy[0].source).toBe(crown!.props.getSource.source);
      }
    }
  });
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

describe('winter trunk and leader join contracts', () => {
  it('provides centered join rings with the same angular grid as the trunk at every detail', () => {
    for (const detail of ['low', 'medium', 'high'] as const) {
      const trunk = getTreeMesh('trunk', 'oak', detail);
      const top = getMeshRing(trunk, 1);
      for (const species of ['oak', 'birch', 'cherry'] as const) {
        const crown = getTreeMesh('canopy', species, detail, true);
        const join = getMeshRing(crown, 0.22, true);
        expect(join.length).toBe(detail === 'low' ? 8 : 12);
        expect(top.length).toBe(join.length);
        for (const point of join) {
          const radius = Math.hypot(point[0], point[1]);
          expect(radius).toBeCloseTo(0.06, 6);
          const matching = top.find(
            candidate =>
              Math.hypot(
                candidate[0] / 0.7 - point[0] / radius,
                candidate[1] / 0.7 - point[1] / radius
              ) < 0.000001
          );
          expect(matching).toBeDefined();
        }
        for (const axis of [0, 1])
          expect(join.reduce((sum, point) => sum + point[axis], 0)).toBeCloseTo(0, 6);
        // A taper needs real rings above the join, not just interpolated shader values.
        expect(getMeshRing(crown, 0.27, true).length).toBe(join.length);
        expect(getMeshRing(crown, 0.42, true).length).toBe(join.length);
        expect(
          crown.attributes.TEXCOORD_0.value.some((value, i) => i % 2 === 0 && value === 0)
        ).toBe(true);
        expect(trunk.attributes.TEXCOORD_0.value.every(value => value === 0)).toBe(true);
      }
    }
  });

  it('anchors the connected root at the tree base across dimensions, yaw and canopy anisotropy', () => {
    for (const species of ['oak', 'birch', 'cherry'] as const) {
      for (const dimensions of [
        {height: 12, fraction: 0.36, radius: 0.38, canopy: 7},
        {height: 20, fraction: 0.2, radius: 0.05, canopy: 12},
        {height: 5, fraction: 0.7, radius: 2, canopy: 0.2}
      ]) {
        const data: Datum[] = [{position: [-122.415, 37.775], type: species, season: 'winter'}];
        const {layer} = createLayer(data, {
          sizeScale: 2.4,
          getHeight: () => dimensions.height,
          getTrunkHeightFraction: () => dimensions.fraction,
          getTrunkRadius: () => dimensions.radius,
          getCanopyRadius: () => dimensions.canopy,
          getElevation: () => 130
        });
        const wood = layer.renderLayers().find(child => child.id.includes('wood'))!;
        const row = wood.props.data[0];
        const scale = wood.props.getScale(row);
        const translation = wood.props.getTranslation(row);
        const rootLength = wood.props.getRootLength(row);
        expect(wood.props.mesh).toBe(getTreeWoodMesh(species));
        expect(rootLength).toBeCloseTo(dimensions.height * dimensions.fraction * 2.4);
        expect(wood.props.getStemRadius(row)).toBeCloseTo(dimensions.radius * 2.4);
        expect(translation[2] + 0.22 * scale[2]).toBeCloseTo(rootLength);
        // The canonical root at -1 is stretched below the first branch socket at 0.22.
        const rootZ = 0.22 + ((-1 - 0.22) * rootLength) / (1.22 * scale[2]);
        expect(translation[2] + rootZ * scale[2]).toBeCloseTo(0);
        expect(wood.props.getOrientation(row)[0]).toBe(0);
        expect(row.position[2]).toBe(130);
        expect(layer.renderLayers().some(child => child.id.includes('canopy'))).toBe(false);
      }
    }
  });

  it('keeps accepted zero dimensions finite without allocating instance-specific meshes', () => {
    const cases = [
      {getHeight: () => 0},
      {getCanopyRadius: () => 0},
      {getTrunkRadius: () => 0},
      {getTrunkHeightFraction: () => 0},
      {getTrunkHeightFraction: () => 1},
      {sizeScale: 0}
    ];
    for (const extra of cases) {
      const {layer} = createLayer([{...OAK, season: 'winter'}], extra);
      const children = layer.renderLayers();
      expect(children.some(child => child.id.includes('canopy'))).toBe(false);
      for (const child of children) {
        const row = child.props.data[0];
        expect(
          [...child.props.getScale(row), ...child.props.getOrientation(row), ...row.wind].every(
            Number.isFinite
          )
        ).toBe(true);
        if (child.id.includes('wood')) {
          expect(child.props.mesh).toBe(getTreeWoodMesh('oak'));
          expect(
            [
              ...child.props.getTranslation(row),
              child.props.getStemRadius(row),
              child.props.getRootLength(row)
            ].every(Number.isFinite)
          ).toBe(true);
        }
      }
    }
  });

  it('leaves crop dimensions and placement independent of the collar and shares the wind frame', () => {
    const data: Datum[] = [{...OAK, position: [-122.415, 37.775], season: 'winter'}];
    const extra = {
      getCrop: () => ({count: 8, droppedCount: 4, radius: 0.2, color: [200, 80, 40, 255]}),
      windStrength: 0.025,
      windTime: 3
    };
    const small = createLayer(data, {...extra, getTrunkRadius: () => 0.05}).layer;
    const large = createLayer(data, {...extra, getTrunkRadius: () => 2}).layer;
    for (const key of ['liveCrops', 'droppedCrops'] as const)
      expect(small.state[key].map(row => [row.translation, row.radius])).toEqual(
        large.state[key].map(row => [row.translation, row.radius])
      );
    const children = small.renderLayers();
    const crown = children.find(child => child.id.includes('wood'))!;
    const tree = crown.props.data[0];
    for (const child of children) {
      expect(child.props.windStrength).toBe(0.025);
      expect(child.props.windTime).toBe(3);
      const row = child.props.data[0];
      if (child.id.includes('dropped-crops')) expect(row.wind[2]).toBe(0);
      else expect(child.props.getWind(row)).toEqual(tree.wind);
      if (child.id.includes('crops')) expect(child.props.getStemRadius).toBe(-1);
    }
    const groups = small.state.groups;
    vi.mocked(small.setState).mockClear();
    small.updateState({
      props: Object.create(small.props, {windTime: {value: 20}}),
      oldProps: small.props,
      changeFlags: {propsChanged: true}
    });
    expect(small.setState).not.toHaveBeenCalled();
    expect(small.state.groups).toBe(groups);
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
      const child = children.find(candidate =>
        id === 'trunks'
          ? candidate.id === 'trees-wood-oak-foliage-3'
          : candidate.id === `trees-${id}`
      )!;
      const rowIndex = id === 'trunks' ? 0 : 2;
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
    const data: Datum[] = [
      {...OAK, type: 'pine'},
      {...OAK, type: 'pine', position: [2, 0], season: 'winter'}
    ];
    const getAliasColor = vi.fn((object: Datum, info) => [
      object.type === 'pine' ? 90 : 0,
      info.index,
      0,
      255
    ]);
    const getExactColor = vi.fn((object: Datum, info) => [
      object.type === 'pine' ? 120 : 0,
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
      getBranchLevels: (d: Datum) => (d.position[0] === 2 ? 4 : 3),
      windStrength: 0.03,
      windTime: 4,
      parameters: {depthCompare: 'less-equal'},
      updateTriggers: {all: 'trees'},
      _subLayerProps: {
        'canopy-pine': {
          visible: false,
          material: false,
          parameters: {depthWriteEnabled: false},
          getColor: getAliasColor,
          getScale: getAliasScale,
          updateTriggers: {getColor: 'alias-color', getScale: 'alias-scale'}
        },
        'canopy-pine-foliage-3': {
          visible: true,
          material: {ambient: 0.2},
          parameters: {blend: false},
          getColor: getExactColor,
          updateTriggers: {getColor: 'exact-color'}
        }
      }
    });
    const children = layer.renderLayers();
    const summer = children.find(child => child.id === 'trees-canopy-pine-foliage-3')!;
    const winter = children.find(child => child.id === 'trees-canopy-pine-foliage-4')!;
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
  it('retains woody data arrays across optical coverage updates', () => {
    const {layer} = createLayer([OAK]);
    const before = layer.renderLayers().find(child => child.id.includes('wood'))!.props.data;
    layer.updateState({
      props: Object.assign(Object.create(layer.props), {getCoverageWeight: () => 0.5}),
      oldProps: layer.props,
      changeFlags: {propsChanged: true, updateTriggersChanged: {getCoverageWeight: true}}
    });
    const after = layer.renderLayers().find(child => child.id.includes('wood'))!.props.data;
    expect(after).toBe(before);
  });

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

describe('canonical TreeLayer accessor contract', () => {
  it('accepts constant accessors for dimensions, species, season, colors and crops', () => {
    const {layer} = createLayer([OAK], {
      getPosition: [0, 0],
      getTreeType: 'citrus',
      getHeight: 8,
      getTrunkRadius: 0.2,
      getCanopyRadius: 4,
      getElevation: -12,
      getSeason: 'winter',
      getTrunkColor: [90, 70, 40],
      getCanopyColor: [30, 100, 40],
      getCrop: {kind: 'lemon', count: 2, radius: 0.04, color: [250, 220, 40]}
    });
    expect(layer.state.trunks[0].height).toBe(8);
    expect(layer.state.trunks[0].position[2]).toBe(-12);
    const children = layer.renderLayers();
    for (const child of children) {
      const row = child.props.data[0];
      const info = {index: 0, data: child.props.data, target: []};
      if (child.id.includes('wood')) expect(child.props.getColor(row, info)).toEqual([90, 70, 40]);
      if (child.id.includes('canopy'))
        expect(child.props.getColor(row, info)).toEqual([30, 100, 40]);
    }
    expect(children.some(child => child.id.includes('canopy-citrus'))).toBe(true);
    expect(layer.state.liveCrops).toHaveLength(2);
  });

  it('preserves original accessor context after invalid rows are omitted and species regroup', () => {
    const data: Datum[] = [{...OAK, position: [NaN, 0]}, OAK, {...OAK, type: 'citrus'}];
    const seen: number[] = [];
    const color = (object: Datum, info) => {
      expect(info.data).toBe(data);
      expect(object).toBe(data[info.index]);
      return [info.index * 40, 100, 20];
    };
    const {layer} = createLayer(data, {
      getHeight: (object, info) => {
        expect(info.data).toBe(data);
        expect(object).toBe(data[info.index]);
        seen.push(info.index);
        return info.index * 10;
      },
      getTrunkColor: color,
      getCanopyColor: color
    });
    expect(seen).toEqual([1, 2]);
    expect(layer.state.trunks.map(row => row.height)).toEqual([10, 20]);
    for (const child of layer.renderLayers()) {
      const row = child.props.data[0];
      const info = {index: 0, data: child.props.data, target: []};
      expect(child.props.getColor(row, info)[0]).toBe(data.indexOf(row.object) * 40);
    }
  });

  it('keeps malformed dimensions out of GPU attributes and skips unsupported species', () => {
    const {layer} = createLayer([OAK, {...OAK, type: 'maple' as TreeType}], {
      getHeight: NaN,
      getCanopyRadius: Infinity,
      getTrunkRadius: NaN,
      getTrunkHeightFraction: NaN,
      getBranchLevels: NaN,
      getElevation: Infinity,
      getSeason: 'unknown'
    });
    expect(layer.state.trunks).toHaveLength(1);
    const row = layer.state.trunks[0];
    expect(row.height).toBe(10);
    expect(row.season).toBe('summer');
    expect(
      [
        ...row.position,
        ...row.scale,
        ...row.translation,
        ...row.orientation,
        ...row.wind,
        row.trunkRadius
      ].every(Number.isFinite)
    ).toBe(true);
    expect(layer.renderLayers().filter(child => child.id.includes('canopy')).length).toBe(1);
  });
});

it('keeps interleaved crop kinds pickable by their source owner and merges group overrides', () => {
  const data: Datum[] = [OAK, {...OAK, type: 'citrus'}, {...OAK}, {...OAK, type: 'citrus'}];
  const kinds = ['acorn', 'lemon', 'fruit', 'lemon'];
  const {layer} = createLayer(data, {
    getCrop: (_, info) => ({
      kind: kinds[info.index],
      count: 2,
      droppedCount: 1,
      radius: 0.04,
      color: [200, 140, 40]
    }),
    getCoverageWeight: (_, info) => info.index / 4,
    updateTriggers: {getCoverageWeight: 'coverage'},
    _subLayerProps: {
      'live-crops': {
        material: false,
        getColor: (_, info) => [info.index, 10, 20],
        parameters: {depthWriteEnabled: false}
      },
      'live-crops-lemon': {
        getColor: (_, info) => [info.index, 30, 40],
        parameters: {cullMode: 'none'}
      }
    }
  });
  const children = layer.renderLayers().filter(child => child.id.includes('crops'));
  expect(children).toHaveLength(6);
  for (const child of children)
    for (const [index, row] of child.props.data.entries()) {
      const picked = layer.getPickingInfo({info: {object: row, index}} as any);
      const sourceIndex = data.indexOf(picked.object);
      expect(picked.index).toBe(sourceIndex);
      expect(child.props.getCoverageWeight(row, {index, data: child.props.data, target: []})).toBe(
        sourceIndex / 4
      );
      expect(child.props.updateTriggers.getCoverageWeight).toBe('coverage');
      if (child.id.includes('live-crops')) {
        expect(child.props.getColor(row, {index, data: child.props.data, target: []})).toEqual([
          sourceIndex,
          child.id.endsWith('lemon') ? 30 : 10,
          child.id.endsWith('lemon') ? 40 : 20
        ]);
        expect(child.props.material).toBe(false);
        expect(child.props.parameters.depthWriteEnabled).toBe(false);
        if (child.id.endsWith('lemon')) expect(child.props.parameters.cullMode).toBe('none');
      }
    }
});

it('propagates optical coverage to trunk-only trees and every supplied crop part', () => {
  const {layer} = createLayer([OAK], {
    getCanopyRadius: 0,
    getCoverageWeight: 0,
    getCrop: {count: 0, droppedCount: 2, radius: 0.1, color: [200, 100, 30]},
    updateTriggers: {getCoverageWeight: 'hidden'}
  });
  const children = layer.renderLayers();
  expect(children.some(child => child.id.endsWith('trunks'))).toBe(true);
  expect(children.some(child => child.id.includes('dropped-crops'))).toBe(true);
  for (const child of children) {
    expect(child.props.getCoverageWeight).toBe(0);
    expect(child.props.updateTriggers.getCoverageWeight).toBe('hidden');
  }
});

it('preserves legacy source and hierarchy overrides while sharing one canopy quota', () => {
  const customSource = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([30, 120, 40, 255]),
    opacities: new Float32Array([1])
  };
  const hierarchy = [{source: customSource, error: 0}];
  const {layer} = createLayer([OAK, {...OAK, type: 'pine'}], {
    maxCanopySplats: 1234,
    maxShadowSplats: 567,
    _subLayerProps: {'canopy-oak': {source: customSource, hierarchy, maxSplats: 99}}
  });
  const canopies = layer.renderLayers().filter(child => child instanceof SplatLayer);
  const oak = canopies.find(child => child.id.includes('canopy-oak'))!;
  expect(oak.props.getSource).toEqual({type: 'prepared-splats', source: customSource, hierarchy});
  expect(oak.props.source).toBeNull();
  expect(oak.props.maxSplats).toBe(99);
  expect(canopies[0].props._splatBudgetGroup).toBe(canopies[1].props._splatBudgetGroup);
  expect(canopies[0].props._splatBudgetGroup).toMatchObject({
    maxSplats: 1234,
    maxShadowSplats: 567
  });
});
