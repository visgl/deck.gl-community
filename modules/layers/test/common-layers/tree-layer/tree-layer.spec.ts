// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension, OrbitViewport, WebMercatorViewport} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {
  TreeLayer,
  SelectionPulseExtension,
  type CropConfig,
  type TreeLayerProps,
  type TreeSpec,
  type TreeType
} from '../../../src';
import {mountTreeScene} from './tree-layer-test-utils';
import {
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW
} from '../../../src/common-layers/tree-layer/tree-photoreal-layout';

const SPECIES: TreeType[] = [
  'oak',
  'birch',
  'cherry',
  'banyan',
  'mangrove',
  'citrus',
  'pine',
  'palm'
];
const OAK: TreeSpec = {species: 'oak', position: [0, 0, 0], height: 10, crownRadius: 2};
const CITRUS: TreeSpec = {species: 'citrus', position: [1e-5, 0, 0]};
const CROP: CropConfig = {count: 3, radius: 0.25, color: [240, 128, 32]};
const baseProps: Partial<TreeLayerProps<TreeSpec>> = {getTree: row => row, windTime: 0};

function load(data: TreeSpec[] = [OAK], props: Partial<TreeLayerProps<TreeSpec>> = {}) {
  const scene = mountTreeScene<TreeSpec>();
  scene.render({...baseProps, ...props, data});
  return scene;
}

describe('TreeLayer species and attributes', () => {
  it('keeps per-tree authored color intent separate from resolved RGB for the color accessor', () => {
    const data: TreeSpec[] = [
      {...OAK, characteristics: {leafDensity: 0.1}},
      {...OAK, characteristics: {leafDensity: 0.1}, canopyColor: [255, 220, 0, 255]},
      {...OAK, characteristics: {leafDensity: 0.1}}
    ];
    const getCanopyColor = (tree: TreeSpec) => tree.canopyColor ?? null;
    const props = {...baseProps, data, getCanopyColor};
    const scene = load(data, props);
    const store = scene.layer().state.store!;
    const flags = () =>
      data.map(
        (_, index) =>
          store.data[index * TREE_STATE_TEXELS_PER_ROW * 4 + TREE_STATE_TEXEL.CROP_DROPPED * 4 + 1]
      );
    expect(flags()).toEqual([0, 1, 0]);
    const revision = store.detailRevision;
    const bounds = scene.layer().state.photoreal!.rows[0].bounds;
    // Equal RGB can still change intent from natural fallback to explicit override.
    data[0].canopyColor = [...scene.row().canopyColor] as [number, number, number, number];
    scene.render({...props, updateTriggers: {getCanopyColor: 1}});
    expect(flags()).toEqual([1, 1, 0]);
    expect(store.detailRevision).toBe(revision);
    expect(scene.layer().state.photoreal!.rows[0].bounds).toBe(bounds);
  });

  it('refreshes spatial leaf selection when only the extension implementation changes', () => {
    const scene = mountTreeScene<TreeSpec>(
      new OrbitViewport({
        width: 256,
        height: 256,
        orbitAxis: 'Z',
        target: [0, 0, 3],
        zoom: 7,
        rotationX: 20,
        rotationOrbit: 0
      })
    );
    const props = {
      data: [{...OAK, height: 6, crownRadius: 2, characteristics: {leafDensity: 0.25}}],
      coordinateSystem: 'cartesian' as const,
      lodBias: -3,
      windStrength: 0,
      extensions: [new SelectionPulseExtension()],
      getSelected: () => false
    };
    const row = () => scene.layer().state.photoreal!.rows[0];
    scene.render(props);
    expect(row().leafSelection).not.toBeNull();
    const bounds = row().bounds;
    class CustomPulse extends SelectionPulseExtension {}
    scene.render({...props, extensions: [new CustomPulse()]});
    expect(row().leafSelection).toBeNull();
    expect(row().useListedLeaves).toBe(false);
    expect(row().bounds).toBe(bounds);
    scene.render(props);
    expect(row().leafSelection).not.toBeNull();
  });

  it('updates RGB tints and their transitions without reading geometry or selecting detail', () => {
    const getTree = vi.fn((row: TreeSpec) => row);
    const scene = load([{...OAK, characteristics: {leafDensity: 0.25}}], {
      getTree,
      getCanopyColor: [34, 120, 15, 255]
    });
    const layer = scene.layer();
    const select = vi.spyOn(TreeLayer.prototype as any, 'updatePhotorealDetail');
    const group = [...layer.state.photoreal!.groups.values()][0];
    const bounds = group.rows[0].bounds;
    const model = scene.children().map(child => child.state.model);
    const buckets = [...group.buckets];
    const data = layer.props.data as TreeSpec[];
    const render = (color: [number, number, number, number], extra = {}) =>
      scene.render({...baseProps, data, getTree, getCanopyColor: color, ...extra});
    try {
      getTree.mockClear();
      render([255, 220, 0, 255]);
      expect(scene.row().canopyColor).toEqual([255, 220, 0, 255]);
      render([30, 200, 40, 255], {transitions: {getCanopyColor: 500}});
      scene.tick(1250);
      expect(scene.row().canopyColor[0]).toBeGreaterThan(30);
      scene.tick(1500);
      expect(scene.row().canopyColor).toEqual([30, 200, 40, 255]);
      expect(getTree).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
      // Fresh but equivalent source data must also retain detail and cached bounds.
      scene.render({...baseProps, data: [...data], getTree, getCanopyColor: [30, 200, 40, 255]});
      expect(getTree).toHaveBeenCalledTimes(data.length);
      expect(select).not.toHaveBeenCalled();
      expect(group.rows[0].bounds).toBe(bounds);
      group.buckets.forEach((bucket, i) => expect(bucket).toBe(buckets[i]));
      scene.children().forEach((child, i) => expect(child.state.model).toBe(model[i]));
      // Alpha changes optical density, so wood and shadow residency must be reconsidered.
      render([30, 200, 40, 100]);
      expect(select).toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });

  it.each([
    false,
    true
  ])('refreshes spec tint fields without geometry work (copied spec: %s)', copied => {
    const data = [
      {
        ...OAK,
        characteristics: {leafDensity: 0.25},
        canopyColor: [34, 120, 15, 255],
        trunkColor: [90, 60, 30, 255]
      }
    ] as TreeSpec[];
    const getTree = vi.fn((row: TreeSpec) => (copied ? {...row} : row));
    const props = {...baseProps, data, getTree};
    const scene = load(data, props);
    const bounds = scene.layer().state.photoreal!.rows[0].bounds;
    const read = vi.spyOn(TreeLayer.prototype as any, 'readTreeSources');
    const group = vi.spyOn(TreeLayer.prototype as any, 'groupPhotorealRows');
    const detail = vi.spyOn(TreeLayer.prototype as any, 'updatePhotorealDetail');
    try {
      getTree.mockClear();
      data[0].canopyColor = [30, 200, 40, 255];
      scene.render({...props, updateTriggers: {getCanopyColor: 1}});
      expect(scene.row().canopyColor).toEqual([30, 200, 40, 255]);
      data[0].trunkColor = [110, 70, 40, 255];
      const updateTriggers = {getCanopyColor: 1, getTrunkColor: 1};
      scene.render({...props, updateTriggers});
      expect(scene.row().trunkColor).toEqual([110, 70, 40, 255]);
      expect(getTree).toHaveBeenCalledTimes(2);
      expect(read).not.toHaveBeenCalled();
      expect(group).not.toHaveBeenCalled();
      expect(detail).not.toHaveBeenCalled();
      expect(scene.layer().state.photoreal!.rows[0].bounds).toBe(bounds);
      // Wind updates reuse the refreshed source colors rather than reverting to a stale snapshot.
      scene.render({...props, updateTriggers, windStrength: 0.1});
      expect(scene.row().canopyColor).toEqual([30, 200, 40, 255]);
      expect(scene.row().trunkColor).toEqual([110, 70, 40, 255]);
      expect(getTree).toHaveBeenCalledTimes(2);
      // A tint trigger and a wind edit in the same update must also read the current spec.
      data[0].canopyColor = [100, 150, 30, 255];
      scene.render({
        ...props,
        updateTriggers: {...updateTriggers, getCanopyColor: 2},
        windStrength: 0.2
      });
      expect(scene.row().canopyColor).toEqual([100, 150, 30, 255]);
      expect(getTree).toHaveBeenCalledTimes(3);
    } finally {
      read.mockRestore();
      group.mockRestore();
      detail.mockRestore();
    }
  });

  it('assigns canopy tiers in projected crown order from either side of the shell cutoff', () => {
    const viewport = new WebMercatorViewport({width: 640, height: 480, zoom: 20, pitch: 55});
    const scene = mountTreeScene<TreeSpec>(viewport);
    const data: TreeSpec[] = [
      {...OAK, crownRadius: 1, trunkHeightFraction: 0.25},
      {...OAK, crownRadius: 1, trunkHeightFraction: 0.55}
    ];
    const render = (lodBias: number) =>
      scene.render({...baseProps, data, lodBias, windStrength: 0}).state.photoreal!.rows;
    const [tall] = render(0);
    const cutoff = Math.log2((tall.middlePixelsPerMeter * 7.5) / 60);

    render(cutoff + 1);
    const [first, second] = render(cutoff);
    const weights = [first.shellRetention, second.shellRetention];
    expect(first.shellLevel).toBe(0);
    expect(weights[0]).toBeGreaterThan(0);
    expect(weights[0]).toBeLessThan(1);
    expect(second.shellLevel).toBe(0);
    expect(weights[1]).toBe(0);
    render(cutoff - 1);
    expect(render(cutoff).map(row => row.shellRetention)).toEqual(weights);
  });

  it('refreshes cached near-leaf bounds when moving a tree with coordinateOrigin', () => {
    const viewport = new WebMercatorViewport({width: 256, height: 256, zoom: 23, pitch: 45});
    const scene = mountTreeScene<TreeSpec>(viewport);
    const data: TreeSpec[] = [{...OAK, height: 6, characteristics: {leafDensity: 0.25}}];
    const render = (target: typeof scene, longitude: number) =>
      target.render({
        ...baseProps,
        data,
        coordinateSystem: 'meter-offsets',
        coordinateOrigin: [longitude, 0, 0],
        windStrength: 0,
        lodBias: -3
      }).state.photoreal!.rows[0];

    const original = render(scene, 0);
    const oldBounds = original.leafBounds;
    expect(oldBounds).not.toBeNull();
    const moved = render(scene, 0.00001);
    const fresh = render(mountTreeScene<TreeSpec>(viewport), 0.00001);
    expect(moved).toBe(original);
    expect(fresh.leafBounds!.spheres[0]).not.toBe(oldBounds!.spheres[0]);
    expect(moved.leafBounds!.spheres[0]).toBe(fresh.leafBounds!.spheres[0]);
    const leaves = fresh.leafSelection!.visibleLeaves;
    expect(leaves.length).toBeGreaterThan(0);
    expect(moved.leafSelection!.visibleLeaves).toEqual(leaves);
  });

  it('keeps foliage LOD stable while expanding culling bounds to cover shed leaves', () => {
    const viewport = new OrbitViewport({
      width: 256,
      height: 256,
      orbitAxis: 'Z',
      fovy: 40,
      target: [0, 0, 5.5],
      rotationX: 3,
      zoom: 3.2
    });
    const scene = mountTreeScene<TreeSpec>(viewport);
    const render = (foliage: number) => {
      const {state} = scene.render({
        ...baseProps,
        data: [{...OAK, height: 12, crownRadius: 3, foliage}],
        coordinateSystem: 'cartesian',
        windStrength: 0
      });
      const row = state.photoreal!.rows[0];
      const group = state.photoreal!.groups.values().next().value!;
      return {
        anchor: row.common,
        bounds: row.bounds!,
        tier: group.buckets.findIndex(bucket => bucket.includes(row)),
        leafPixels: row.leafPixels,
        leafDetail: scene.row().leafDetail
      };
    };
    const full = render(1);
    expect(full.tier).toBeGreaterThanOrEqual(0);
    expect(full.tier).toBeLessThan(4);
    expect(full.bounds.cullCenter).toEqual(full.bounds.center);
    expect(full.bounds.cullCenter[2]).toBeGreaterThan(full.anchor[2]);
    for (const foliage of [0.5, 0.25, 0]) {
      const shed = render(foliage);
      expect(shed.tier).toBe(full.tier);
      expect(shed.leafPixels).toBe(full.leafPixels);
      expect(shed.leafDetail).toBe(full.leafDetail);
      expect(shed.bounds.cullCenter).toEqual(shed.anchor);
      expect(shed.bounds.cullRadius).toBeGreaterThan(full.bounds.cullRadius);
    }
  });

  it.each(SPECIES)('composes wood and leaves from a dedicated %s template', species => {
    const scene = load([{...OAK, species}]);
    const groups = Array.from(scene.layer().state.photoreal!.groups.values());
    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.species).toBe(species);
    expect(group.model.key).toContain(species);
    expect(group.model.wood.vertexCount).toBeGreaterThan(0);
    expect(group.model.leafCount).toBeGreaterThan(0);
    expect(scene.children().some(child => child.id.includes('photoreal-wood'))).toBe(true);
    expect(scene.children().some(child => child.id.includes('photoreal-leaves'))).toBe(true);
    expect(scene.children().some(child => child.constructor.name.includes('Splat'))).toBe(false);
  });

  it('accepts constant accessors for dimensions, species, season, colors and crops', () => {
    const scene = load([OAK], {
      getPosition: [0, 0],
      getTreeType: 'citrus',
      getHeight: 8,
      getTrunkRadius: 0.2,
      getCanopyRadius: 4,
      getElevation: -12,
      getSeason: 'winter',
      getTrunkColor: [90, 70, 40],
      getCanopyColor: [30, 100, 40],
      getCrop: {...CROP, kind: 'lemon'}
    });
    const row = scene.row();
    expect(row.height).toBe(8);
    expect(row.trunkRadius).toBe(0.2);
    expect(row.position).toEqual([0, 0, -12]);
    expect(row.canopyColor).toEqual([30, 100, 40, 255]);
    expect(row.trunkColor).toEqual([90, 70, 40, 255]);
    expect(row.foliage).toBe(1);
    expect(row.crop).toMatchObject({count: CROP.count, radius: CROP.radius});
    expect(scene.layer().state.sources[0].type).toBe('citrus');
  });

  it('preserves source accessor context when invalid rows are omitted and species regroup', () => {
    const data: TreeSpec[] = [{...OAK, position: [NaN, 0, 0]}, OAK, CITRUS];
    const seen: number[] = [];
    const scene = load(data, {
      getHeight: (object, info) => {
        expect(info.data).toBe(data);
        expect(object).toBe(data[info.index]);
        seen.push(info.index);
        return info.index * 10;
      },
      getCanopyColor: (object, info) => {
        expect(info.data).toBe(data);
        expect(object).toBe(data[info.index]);
        return [info.index * 40, 100, 20];
      }
    });
    expect(seen).toEqual([1, 2]);
    expect(scene.row(0).height).toBe(10);
    expect(scene.row(1).height).toBe(20);
    expect(scene.row(0).canopyColor).toEqual([40, 100, 20, 255]);
    expect(scene.row(1).canopyColor).toEqual([80, 100, 20, 255]);
  });

  it('keeps malformed dimensions finite and skips unsupported species', () => {
    const scene = load([OAK, {...OAK, species: 'maple' as TreeType}], {
      getHeight: NaN,
      getCanopyRadius: Infinity,
      getTrunkRadius: NaN,
      getTrunkHeightFraction: NaN,
      getBranchLevels: NaN,
      getElevation: Infinity,
      getSeason: 'unknown' as TreeSpec['season']
    });
    expect(scene.layer().state.sources).toHaveLength(1);
    const row = scene.row();
    expect(scene.layer().state.sources[0].season).toBe('summer');
    expect(
      [...row.position, row.height, row.crownX, row.crownY, row.trunkHeight, row.trunkRadius].every(
        Number.isFinite
      )
    ).toBe(true);
  });

  it('preserves seasonal foliage and keeps accepted zero dimensions finite', () => {
    const scene = load([
      {...OAK, season: 'winter'},
      {...CITRUS, season: 'winter'},
      {...OAK, height: 0, crownRadius: 0, trunkRadius: 0}
    ]);
    expect(scene.row(0).foliage).toBe(0);
    expect(scene.row(1).foliage).toBe(1);
    expect(scene.row(2)).toMatchObject({height: 0, crownX: 0, crownY: 0, trunkRadius: 0});
    expect(scene.layer().state.store!.data.every(Number.isFinite)).toBe(true);
  });

  it('writes optical coverage to the shared row without scaling crop counts', () => {
    const scene = load([OAK, CITRUS], {
      getCoverageWeight: (_row, {index}) => index / 4,
      getCrop: {...CROP, droppedCount: 2}
    });
    expect(scene.row(0).coverage).toBe(0);
    expect(scene.row(1).coverage).toBe(0.25);
    for (const index of [0, 1]) expect(scene.row(index).crop).toMatchObject({count: 3, dropped: 2});
  });
});

describe('TreeLayer composition contracts', () => {
  it('resolves owner picking across invalid rows, species, and crop partitions', () => {
    const data = [
      {...OAK, position: [NaN, 0, 0] as [number, number, number]},
      {...OAK, crop: {...CROP, kind: 'acorn' as const}},
      {...CITRUS, crop: {...CROP, kind: 'lemon' as const}}
    ];
    const scene = load(data, {pickable: true, lodBias: -2});
    const layer = scene.layer();
    const rows = layer.state.photoreal!.rows;
    const cropLayer = scene.children().find(child => child.id.includes('photoreal-crops'))!;
    expect(cropLayer).toBeTruthy();
    for (const [stateRow, row] of rows.entries()) {
      const sourceIndex = stateRow + 1;
      const picking = layer.getPickingInfo({info: {object: row, index: stateRow}} as never);
      expect(picking.object).toBe(data[sourceIndex]);
      expect(picking.index).toBe(sourceIndex);
      const crop = layer.getPickingInfo({info: {index: stateRow}, sourceLayer: cropLayer} as never);
      expect(crop.object).toBe(data[sourceIndex]);
      expect(crop.index).toBe(sourceIndex);
    }
  });

  it('rejects compositional scale and allows translation', () => {
    for (const coordinateSystem of ['cartesian', 'meter-offsets']) {
      expect(() =>
        load([OAK], {
          coordinateSystem,
          modelMatrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        })
      ).toThrow(/modelMatrix.*translation/);
    }
    expect(() =>
      load([OAK], {
        coordinateSystem: 'cartesian',
        modelMatrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 4, 0, 1]
      })
    ).not.toThrow();
  });

  it('maps a controlled highlight to state rows after source filtering', () => {
    const scene = load([{...OAK, position: [NaN, 0, 0]}, OAK, {...CITRUS, crop: CROP}], {
      highlightedObjectIndex: 2,
      pickable: true,
      lodBias: -2
    });
    const crops = scene.children().filter(child => child.id.includes('photoreal-crops'));
    expect(crops.length).toBeGreaterThan(0);
    for (const child of crops) expect(child.props.highlightedObjectIndex).toBe(1);
  });

  it('passes extension accessors and triggers through the source rows', () => {
    class TagExtension extends LayerExtension {
      static extensionName = 'TagExtension';
      static defaultProps = {getTag: {type: 'accessor', value: 0}};
    }
    const props = {
      extensions: [new TagExtension()],
      lodBias: -2,
      getTag: (row: TreeSpec) => row.species,
      updateTriggers: {getTag: 'tag-v2'}
    };
    const scene = load([OAK, {...CITRUS, crop: CROP}], props);
    const parts = scene.children().filter(child => child.id.includes('photoreal'));
    expect(parts.length).toBeGreaterThan(0);
    let read = 0;
    for (const part of parts) {
      expect(part.props.updateTriggers.getTag, part.id).toBe('tag-v2');
      const rows = Array.from(part.props.data as ArrayLike<{object?: TreeSpec} | undefined>);
      for (const row of rows) {
        if (!row?.object) continue;
        expect(part.props.getTag(row, {index: -1})).toBe(row.object.species);
        read++;
      }
    }
    expect(read).toBeGreaterThan(0);
  });

  it('applies material overrides to their corresponding draw parts', () => {
    const scene = load([OAK, {...CITRUS, crop: CROP}], {
      woodMaterial: {ambient: 0.4},
      foliageMaterial: {diffuse: 0.6},
      cropMaterial: {shininess: 22},
      lodBias: -2
    });
    const expectMaterial = (part: string, property: string, value: number) => {
      const child = scene.children().find(candidate => candidate.id.includes(part))!;
      expect(child.props.material[property]).toBe(value);
    };
    expectMaterial('photoreal-wood', 'ambient', 0.4);
    expectMaterial('photoreal-leaves', 'diffuse', 0.6);
    expectMaterial('photoreal-crops', 'shininess', 22);
  });

  it('reuses state rows and templates on wind clock updates and resolves color triggers', () => {
    const scene = mountTreeScene<TreeSpec>();
    const data = [OAK, CITRUS];
    let red = 10;
    const getCanopyColor = vi.fn((): [number, number, number] => [red, 100, 40]);
    const render = (windTime: number, trigger = 0): TreeLayer<TreeSpec> =>
      scene.render({
        ...baseProps,
        data,
        windTime,
        getCanopyColor,
        updateTriggers: {getCanopyColor: trigger}
      });
    const {photoreal, stateTexture, store} = render(0).state;
    const calls = getCanopyColor.mock.calls.length;
    const expected = store!.data.slice();
    const updated = render(1).state;
    expect(getCanopyColor.mock.calls.length).toBe(calls);
    expect(updated.stateTexture).toBe(stateTexture);
    expect(updated.photoreal!.rows).toBe(photoreal!.rows);
    expect(updated.store!.data).toEqual(expected);
    red = 80;
    render(1, 1);
    expect(scene.row().canopyColor).toEqual([80, 100, 40, 255]);
  });
});
