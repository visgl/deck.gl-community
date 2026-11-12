// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, LayerExtension} from '@deck.gl/core';
import {describe, expect, it, vi} from 'vitest';
import {
  TreeLayer,
  type CropConfig,
  type TreeLayerProps,
  type TreeSpec,
  type TreeType
} from '../../src';
import {mountTreeScene} from './tree-layer-test-utils';

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
    expect(row.crops[0]).toMatchObject({count: CROP.count, radius: CROP.radius});
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
    for (const index of [0, 1])
      expect(scene.row(index).crops[0]).toMatchObject({count: 3, dropped: 2});
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
    for (const coordinateSystem of [COORDINATE_SYSTEM.CARTESIAN, COORDINATE_SYSTEM.METER_OFFSETS]) {
      expect(() =>
        load([OAK], {
          coordinateSystem,
          modelMatrix: [2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
        })
      ).toThrow(/modelMatrix.*translation/);
    }
    expect(() =>
      load([OAK], {
        coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
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
