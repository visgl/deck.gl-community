// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {describe, it, expect, vi} from 'vitest';
import {COORDINATE_SYSTEM, LayerExtension, LayerManager, WebMercatorViewport} from '@deck.gl/core';
import {device} from '@deck.gl/test-utils/vitest';
import {TreeLayer, type TreeType} from '../../src/tree-layer/tree-layer';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {TreeWoodLayer} from '../../src/tree-layer/tree-wood-layer';
import {TreeMeshLayer} from '../../src/tree-layer/tree-mesh-layer';
import {getTreeWoodMesh} from '../../src/tree-layer/tree-wood';
import {
  getPalmFrondLeafletT,
  getTreeSplatHierarchy,
  getTreeSplatSource
} from '../../src/tree-layer/tree-splats';
import {
  createTrunkMesh,
  createCropMesh,
  samplePineSurface
} from '../../src/tree-layer/tree-geometry';
import {getPalmFronds, evaluatePalmFrond} from '../../src/tree-layer/tree-palm';

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
        expect(crown!.props.transparency).toBe('weighted');
        expect(crown!.props.support).toBeCloseTo(type === 'palm' ? 1.4 : 2);
        expect(crown!.props.pixelError).toBeCloseTo(0.75);
        expect(crown!.props.getSource.source.opacities.length).toBeGreaterThan(
          type === 'palm' ? 700 : 1000
        );
        expect(crown!.props.getSource.hierarchy[0].source).toBe(crown!.props.getSource.source);
        expect(
          children
            .filter(child => child.id.includes('canopy'))
            .every(child => child instanceof SplatLayer)
        ).toBe(true);
      }
    }
  });
  it('keeps palm frond stems and splat leaflets on the same deterministic curves', () => {
    const fronds = getPalmFronds();
    expect(fronds).toHaveLength(13);
    expect(fronds.filter(frond => !frond.spear)).toHaveLength(12);
    expect(fronds.filter(frond => frond.spear)).toHaveLength(1);
    expect(
      new Set(fronds.filter(frond => !frond.spear).map(frond => frond.angle.toFixed(3))).size
    ).toBe(12);
    expect(evaluatePalmFrond(fronds[0], 0)).toEqual(fronds[0].controls[0]);
    expect(evaluatePalmFrond(fronds[0], 1)).toEqual(fronds[0].controls[3]);
    const baseAngle = Math.atan2(fronds[0].controls[0][1], fronds[0].controls[0][0]);
    const tipAngle = Math.atan2(fronds[0].controls[3][1], fronds[0].controls[3][0]);
    expect(
      Math.abs(Math.atan2(Math.sin(tipAngle - baseAngle), Math.cos(tipAngle - baseAngle)))
    ).toBeGreaterThan(0.05);
    expect(getPalmFrondLeafletT(0)).toBeCloseTo(0.15);
    expect(getPalmFrondLeafletT(14)).toBeCloseTo(0.86);
    const {layer} = createLayer([{position: [0, 0], type: 'palm', season: 'summer'}]);
    const canopy = layer.renderLayers().find(child => child.id.includes('canopy'))!;
    expect(canopy).toBeInstanceOf(SplatLayer);
    expect(canopy.props.support).toBeCloseTo(1.4);
    expect(canopy.props.pixelError).toBeCloseTo(0.75);
    const palmSplats = getTreeSplatSource('palm');
    expect(getTreeSplatHierarchy('palm')).toHaveLength(4);
    expect(palmSplats.positions.length / 3).toBeGreaterThan(700);
    expect(palmSplats.positions.length / 3).toBeLessThan(800);
    expect(
      Array.from(palmSplats.scales)
        .filter((_, index) => index % 3 === 1)
        .some(width => width > 0.014)
    ).toBe(true);
    expect(palmSplats.positions.every(Number.isFinite)).toBe(true);
    expect(getTreeSplatSource('palm')).toBe(palmSplats);
    const firstLeaf = palmSplats.positions.subarray(0, 3);
    const firstFrondBase = evaluatePalmFrond(fronds[0], getPalmFrondLeafletT(0));
    expect(
      Math.hypot(...Array.from(firstLeaf, (coordinate, axis) => coordinate - firstFrondBase[axis]))
    ).toBeLessThan(0.1);
  });
  it('keeps every canopy on splats while dense groves use batched woody LOD', () => {
    const denseData = Array.from({length: 10000}, (_, index) => ({
      position: [index % 32, Math.floor(index / 32)] as [number, number],
      type: 'oak' as const,
      season: 'summer' as const
    }));
    const {layer: dense} = createLayer(denseData);
    const denseLayers = dense.renderLayers();
    const canopy = denseLayers.find(child => child.id.includes('canopy'))!;
    const wood = denseLayers.find(child => child.id.includes('wood'))!;
    expect(canopy).toBeInstanceOf(SplatLayer);
    expect(canopy.id).not.toContain('dense');
    expect(canopy.props.data).toHaveLength(denseData.length);
    expect(canopy.props.transparency).toBe('weighted');
    expect(canopy.props.pixelError).toBe(0.75);
    expect(canopy.props.foveationStrength).toBe(0);
    expect(canopy.props._splatBudgetGroup).toMatchObject({maxSplats: 'auto'});
    expect(wood).toBeInstanceOf(TreeWoodLayer);
    expect(wood.props.farTrunkOnly).toBe(true);
    expect(wood.props.nearBranchCoverage).toBe(0.55);
    expect(wood.props.data).toHaveLength(denseData.length);

    const {layer: close} = createLayer(denseData.slice(0, 1023));
    const closeLayers = close.renderLayers();
    const closeCanopy = closeLayers.find(child => child.id.includes('canopy'))!;
    const closeWood = closeLayers.find(child => child.id.includes('wood'))!;
    expect(closeCanopy).toBeInstanceOf(SplatLayer);
    expect(closeCanopy.id).toBe(canopy.id);
    expect(closeCanopy.props.pixelError).toBe(canopy.props.pixelError);
    expect(closeCanopy.props.transparency).toBe(canopy.props.transparency);
    expect(closeWood).toBeInstanceOf(TreeWoodLayer);
    expect(closeWood.id).toBe(wood.id);
    expect(closeWood.props.farTrunkOnly).toBe(false);
    expect(closeWood.props.nearBranchCoverage).toBe(1);
    const {layer: threshold} = createLayer(denseData.slice(0, 1024));
    const thresholdCanopy = threshold.renderLayers().find(child => child.id.includes('canopy'))!;
    expect(thresholdCanopy.props._splatBudgetGroup).toMatchObject({maxSplats: 'auto'});
  });
  it('uses the complete mixed-grove inventory when simplifying distant wood', () => {
    // Eight 1,000-row species groups are each below the dense threshold, while the complete
    // 8,000-tree forest must still draw distant wood as trunks so the automatic splat crowns
    // provide the background canopy rather than a branch lattice.
    const mixedDenseData = Array.from({length: 8000}, (_, index) => ({
      position: [index % 100, Math.floor(index / 100)] as [number, number],
      type: (['pine', 'oak', 'palm', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'] as const)[
        index % 8
      ],
      season: 'summer' as const
    }));
    const {layer} = createLayer(mixedDenseData);
    const woodLayers = layer
      .renderLayers()
      .filter((child): child is TreeWoodLayer => child instanceof TreeWoodLayer);

    expect(woodLayers).toHaveLength(8);
    expect(woodLayers.every(wood => wood.props.data.length < 1024)).toBe(true);
    expect(woodLayers.every(wood => wood.props.farTrunkOnly)).toBe(true);
    expect(woodLayers.every(wood => wood.props.nearBranchCoverage === 0.55)).toBe(true);
  });
  it('uses one stable canopy color accessor and blend mode across a mixed dense scene', () => {
    const mixedData = [
      ...Array.from({length: 1024}, (_, index) => ({
        position: [index % 32, Math.floor(index / 32)] as [number, number],
        type: 'oak' as const,
        season: 'summer' as const
      })),
      {position: [40, 0] as [number, number], type: 'pine' as const, season: 'summer' as const}
    ];
    const {layer} = createLayer(mixedData);
    const first = layer.renderLayers().filter(child => child instanceof SplatLayer);
    const second = layer.renderLayers().filter(child => child instanceof SplatLayer);
    expect(first).toHaveLength(2);
    expect(first.map(child => child.props.transparency)).toEqual(['weighted', 'weighted']);
    for (const [index, canopy] of first.entries()) {
      expect(second[index].props.getColor).toBe(canopy.props.getColor);
      expect(second[index].props.updateTriggers.getColor[0]).toBe(
        canopy.props.updateTriggers.getColor[0]
      );
    }
  });
  it('does not apply native dense wood deformation to a custom mesh override', () => {
    const data = Array.from({length: 1024}, (_, index) => ({
      position: [index % 32, Math.floor(index / 32)] as [number, number],
      type: 'oak' as const,
      season: 'summer' as const
    }));
    const customMesh = getTreeWoodMesh('palm');
    const {layer} = createLayer(data, {_subLayerProps: {trunks: {mesh: customMesh}}});
    const wood = layer.renderLayers().find(child => child.id.includes('wood'))!;
    expect(wood).toBeInstanceOf(TreeWoodLayer);
    expect(wood.props.mesh).toBe(customMesh);
    expect(wood.props.templateMesh).not.toBe(customMesh);
  });
  it('gives date palms a slimmer tapered bole with bark scars down the full trunk', () => {
    const mesh = getTreeWoodMesh('palm');
    const positions = mesh.attributes.POSITION.value;
    const trunk = mesh.attributes.TEXCOORD_0.value;
    let baseRadius = 0;
    let topRadius = 0;
    const trunkHeights = new Set<number>();
    for (let vertex = 0; vertex < positions.length / 3; vertex++) {
      if (trunk[vertex * 2 + 1] !== 1) continue;
      const x = positions[vertex * 3];
      const y = positions[vertex * 3 + 1];
      const z = positions[vertex * 3 + 2];
      const radius = Math.hypot(x, y);
      if (z < -0.9) baseRadius = Math.max(baseRadius, radius);
      if (z > 0.5) topRadius = Math.max(topRadius, radius);
      trunkHeights.add(Math.round(z * 1000));
    }
    expect(topRadius).toBeLessThan(baseRadius * 0.85);
    expect(trunkHeights.size).toBeGreaterThan(40);
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

describe('tree wood and crop contracts', () => {
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
      windEnabled: false
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
      expect(child.props.windEnabled).toBe(false);
      const row = child.props.data[0];
      if (child.id.includes('dropped-crops')) expect(row.wind[2]).toBe(0);
      else expect(child.props.getWind(row)).toEqual(tree.wind);
      if (child.id.includes('crops')) expect(child.props.getStemRadius).toBe(-1);
    }
    const groups = small.state.groups;
    vi.mocked(small.setState).mockClear();
    small.updateState({
      props: Object.create(small.props, {windEnabled: {value: true}}),
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
      windEnabled: false,
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
      expect(child.props.windEnabled).toBe(false);
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
      windEnabled: false,
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
      expect(child.props.windEnabled).toBe(false);
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
      windEnabled: false,
      _subLayerProps: {'canopy-palm': {parameters: {depthWriteEnabled: false}}}
    };
    const canopy = createLayer(data, common)
      .layer.renderLayers()
      .find(child => child.id.includes('canopy'))!;
    expect(canopy.props.doubleSided).toBe(true);
    expect(canopy.props.parameters).toMatchObject({cullMode: 'none', depthWriteEnabled: false});
    expect(canopy.props.windEnabled).toBe(false);
    const changed = createLayer(data, {
      ...common,
      _subLayerProps: {
        ...common._subLayerProps,
        'canopy-palm-foliage-3': {
          doubleSided: false,
          windEnabled: true,
          parameters: {cullMode: 'back'}
        }
      }
    })
      .layer.renderLayers()
      .find(child => child.id.includes('canopy'))!;
    expect(changed.props.doubleSided).toBe(false);
    expect(changed.props.parameters).toMatchObject({cullMode: 'back', depthWriteEnabled: false});
    expect(changed.props.windEnabled).toBe(true);
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

  it('does not regroup data or rebuild crop instances for wind or color-only updates', () => {
    const {layer} = createLayer([OAK]);
    const state = layer.state;
    const groups = state.groups;
    (layer.setState as any).mockClear();
    layer.updateState({
      props: Object.assign(Object.create(layer.props), {windEnabled: false}),
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
    const cropRadii = layer.state.liveCrops.map(point => point.radius);
    const expanded = createLayer([OAK], {getCrop: () => ({...crop, count: 16})}).layer;
    expect(expanded.state.liveCrops.slice(0, 8).map(point => point.translation)).toEqual(prefix);
    expect(expanded.state.liveCrops.slice(0, 8).map(point => point.radius)).toEqual(cropRadii);
    expect(new Set(cropRadii).size).toBeGreaterThan(1);
    expect(cropRadii.every(radius => radius >= crop.radius * 0.84 && radius <= crop.radius)).toBe(
      true
    );
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

it('applies a prepared getSource override while sharing one canopy quota', () => {
  const customSource = {
    positions: new Float32Array([0, 0, 0]),
    scales: new Float32Array([1, 1, 1]),
    rotations: new Float32Array([1, 0, 0, 0]),
    colors: new Uint8Array([30, 120, 40, 255]),
    opacities: new Float32Array([1])
  };
  const prepared = {
    type: 'prepared-splats' as const,
    source: customSource,
    hierarchy: [{source: customSource, error: 0}]
  };
  const {layer} = createLayer([OAK, {...OAK, type: 'pine'}], {
    maxCanopySplats: 1234,
    _subLayerProps: {'canopy-oak': {getSource: prepared, maxSplats: 99}}
  });
  const canopies = layer.renderLayers().filter(child => child instanceof SplatLayer);
  const oak = canopies.find(child => child.id.includes('canopy-oak'))!;
  const pine = canopies.find(child => child.id.includes('canopy-pine'))!;
  expect(oak.props.getSource).toBe(prepared);
  expect(pine.props.getSource).not.toBe(prepared);
  expect(oak.props.maxSplats).toBe(99);
  expect(canopies[0].props._splatBudgetGroup).toBe(canopies[1].props._splatBudgetGroup);
  expect(canopies[0].props._splatBudgetGroup).toMatchObject({maxSplats: 1234});
});

it('rejects compositional layer transforms that would detach foliage from wood', () => {
  for (const coordinateSystem of [
    COORDINATE_SYSTEM.CARTESIAN,
    COORDINATE_SYSTEM.METER_OFFSETS,
    COORDINATE_SYSTEM.DEFAULT
  ]) {
    const {layer} = createLayer([OAK], {
      coordinateSystem,
      modelMatrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    });
    Object.assign(layer, {context: {viewport: {isGeospatial: false}}});
    expect(() => layer.renderLayers()).toThrow(/modelMatrix.*translation/);
  }
  const {layer} = createLayer([OAK], {
    coordinateSystem: 'cartesian',
    modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 4, 0, 1]
  });
  expect(() => layer.renderLayers()).not.toThrow();
});

it('maps a controlled highlightedObjectIndex onto each species partition', () => {
  const data: Datum[] = [OAK, {...OAK, type: 'citrus'}, {...OAK}, {...OAK, type: 'citrus'}];
  for (const highlighted of [1, 2]) {
    const {layer} = createLayer(data, {
      highlightedObjectIndex: highlighted,
      getCrop: () => ({count: 2, radius: 0.04, color: [200, 140, 40]})
    });
    const children = layer.renderLayers();
    let found = 0;
    for (const child of children) {
      const rows = child.props.data as {__source: {index: number}}[];
      const row = child.props.highlightedObjectIndex;
      // Each partition holds a subset of trees in its own order; name the same tree or none.
      if (rows.some(entry => entry.__source.index === highlighted)) {
        expect(rows[row].__source.index).toBe(highlighted);
        found++;
      } else expect(row).toBe(-1);
    }
    // Wood, canopy and crops each hold the highlighted tree.
    expect(found).toBeGreaterThanOrEqual(3);
  }
  const {layer} = createLayer(data);
  for (const child of layer.renderLayers()) expect(child.props.highlightedObjectIndex).toBeNull();
});

/** An extension with only an accessor prop, as passed to sub-layers by `getSubLayerProps`. */
class TagExtension extends LayerExtension {
  static extensionName = 'TagExtension';
  static defaultProps = {getTag: {type: 'accessor', value: 0}};
}

it('passes extension accessors and their update triggers to every sub-layer', () => {
  const data = [OAK, {...OAK, position: [10, 0], type: 'citrus'}] as Datum[];
  const {layer} = createLayer(data, {
    getCrop: () => ({count: 2, radius: 0.04, color: [200, 140, 40]}),
    extensions: [new TagExtension()],
    getTag: (d: Datum) => d.type,
    updateTriggers: {getTag: 'tag-v2'}
  });
  const children = layer.renderLayers();
  for (const part of ['wood', 'canopy', 'crops'])
    expect(
      children.some(child => child.id.includes(part)),
      part
    ).toBe(true);
  for (const child of children) {
    expect(child.props.updateTriggers.getTag, child.id).toBe('tag-v2');
    // Sub-layer rows map back to the source tree.
    const rows = child.props.data as {__source: {index: number}}[];
    for (const row of rows)
      expect(child.props.getTag(row, {index: -1})).toBe(data[row.__source.index].type);
  }
});

it('re-renders for an unrelated prop change without recomputing sub-layer attributes', () => {
  // deck.gl re-renders a composite whenever a prop changes. Each child must keep its data and
  // triggers, or every canopy color and crop attribute is rewritten, e.g. per opacity frame.
  const calculateTreeWind = vi.spyOn(TreeMeshLayer.prototype as any, 'calculateTreeWind');
  const getCanopyColor = vi.fn(() => [60, 170, 60, 255]);
  const viewport = new WebMercatorViewport({width: 128, height: 128, zoom: 20});
  const layerManager = new LayerManager(device, {
    viewport,
    deck: {getViewports: () => [viewport]}
  } as any);
  const data = [OAK, {...OAK, position: [1e-5, 0], type: 'citrus'}];
  const render = (opacity: number) =>
    layerManager.setLayers([
      new TreeLayer<Datum>({
        id: 'trees',
        data,
        getTreeType: d => d.type,
        getCrop: () => ({count: 2, droppedCount: 2, radius: 0.04, color: [200, 140, 40]}),
        getCanopyColor,
        maxCanopySplats: 0,
        opacity
      })
    ]);
  try {
    for (let frame = 0; frame < 4; frame++) render(1);
    const ids = layerManager.getLayers().map(layer => layer.id);
    for (const part of ['wood', 'refinement', 'live-crops', 'dropped-crops'])
      expect(
        ids.some(id => id.includes(part)),
        part
      ).toBe(true);
    const calls = [getCanopyColor.mock.calls.length, calculateTreeWind.mock.calls.length];
    expect(calls.every(count => count > 0)).toBe(true);
    for (const opacity of [0.9, 0.8, 0.7]) render(opacity);
    expect([getCanopyColor.mock.calls.length, calculateTreeWind.mock.calls.length]).toEqual(calls);
  } finally {
    layerManager.finalize();
    calculateTreeWind.mockRestore();
  }
});

it('recolors connected wood on a trunk color trigger and rewrites nothing on re-render', () => {
  const viewport = new WebMercatorViewport({
    width: 256,
    height: 256,
    longitude: 0,
    latitude: 0,
    zoom: 19,
    pitch: 45
  });
  const layerManager = new LayerManager(device, {
    viewport,
    deck: {getViewports: () => [viewport]} as any
  });
  const data = [OAK];
  const updateAttributes = vi.spyOn(TreeMeshLayer.prototype as any, 'updateAttributes');
  const render = (color: [number, number, number], trigger: number) => {
    updateAttributes.mockClear();
    layerManager.setLayers([
      new TreeLayer<Datum>({
        id: 'trees',
        data,
        getTreeType: d => d.type,
        getSeason: d => d.season,
        getTrunkColor: () => color,
        updateTriggers: {getTrunkColor: trigger}
      })
    ]);
    const wood = layerManager
      .getLayers()
      .filter(layer => layer instanceof TreeMeshLayer && layer.id.includes('wood'));
    const rewritten = updateAttributes.mock.contexts.flatMap((layer, call) =>
      wood.includes(layer as TreeMeshLayer<unknown>)
        ? Object.keys(updateAttributes.mock.calls[call][0] as object)
        : []
    );
    const colors = wood.map(layer =>
      Array.from(layer.getAttributeManager()!.attributes.instanceColors.value!.slice(0, 3))
    );
    return {wood, rewritten, colors};
  };
  try {
    const initial = render([90, 60, 30], 0);
    expect(initial.wood.length).toBeGreaterThan(0);
    expect(initial.colors.every(color => color.join() === '90,60,30')).toBe(true);
    // Rebuilt parent props with unchanged triggers leave every wood attribute in place.
    expect(render([90, 60, 30], 0).rewritten).toEqual([]);
    const recolored = render([200, 40, 30], 1);
    expect(recolored.colors.every(color => color.join() === '200,40,30')).toBe(true);
    expect(new Set(recolored.rewritten)).toEqual(new Set(['instanceColors']));
  } finally {
    updateAttributes.mockRestore();
    layerManager.finalize();
  }
});
