// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {LayerManager, WebMercatorViewport, type Layer} from '@deck.gl/core';
import {device} from '@deck.gl/test-utils/vitest';
import {Timeline} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TreeLayer, type TreeSpec, type TreeType} from '../../src';
import {
  getSplatDeformationRadius,
  getSplatDeformationWind,
  SPLAT_DEFORMATION_GLSL,
  SPLAT_DEFORMATION_WGSL
} from '../../src/splat-layer/splat-deformation';
import {SplatLayer} from '../../src/splat-layer/splat-layer';
import {SplatPrimitiveLayer} from '../../src/splat-layer/splat-primitive-layer';
import {getSplatChangedRanges} from '../../src/splat-layer/splat-row-diff';
import {getSplatTransform} from '../../src/splat-layer/splat-transform';
import {TreeMeshLayer} from '../../src/tree-layer/tree-mesh-layer';
import {
  getTreeCrownFraction,
  getTreeHeightFraction,
  getTreeRingRadius
} from '../../src/tree-layer/tree-photoreal-layout';
import {TreeWoodLayer} from '../../src/tree-layer/tree-wood-layer';

const INFO = {index: 0, data: [], target: []};
const SPECIES: TreeType[] = ['citrus', 'pine', 'palm'];

/** A layer with its state built and no deck, for what is worked out on the CPU. */
function prepare(data: TreeSpec | TreeSpec[], extra = {}): TreeLayer<TreeSpec> {
  const layer = new TreeLayer<TreeSpec>({
    id: 'trees',
    data: Array.isArray(data) ? data : [data],
    ...extra
  });
  layer.initializeState();
  vi.spyOn(layer, 'setState').mockImplementation(state => {
    Object.assign(layer.state, state);
  });
  layer.updateState({props: layer.props, oldProps: {}, changeFlags: {dataChanged: true}} as never);
  return layer;
}

function firstRow(layer: TreeLayer<TreeSpec>) {
  return layer.state.standardRows[0];
}

/** A sub-layer, whose props these tests read by name. */
// biome-ignore lint/suspicious/noExplicitAny: each kind of sub-layer has its own.
type Part = Layer & {props: Record<string, any>};

function children(layer: TreeLayer<TreeSpec>): Part[] {
  return layer.renderLayers() as unknown as Part[];
}

function part(layer: TreeLayer<TreeSpec>, name: string): Part {
  return children(layer).find(child => child.id.includes(name)) as Part;
}

function tree(species: TreeType, lifecycle: Partial<TreeSpec> = {}): TreeSpec {
  return {position: [0, 0, 0], species, height: 12, crownRadius: 3, ...lifecycle};
}

/** Where a pose takes a point of a template. */
function transform(matrix: ArrayLike<number>, point: readonly number[]): number[] {
  return [0, 1, 2].map(
    axis =>
      matrix[axis] * point[0] +
      matrix[axis + 3] * point[1] +
      matrix[axis + 6] * point[2] +
      matrix[axis + 9]
  );
}

/** A 16-entry affine matrix as the 12 entries of `getSplatTransform`. */
function toTransform(matrix: ArrayLike<number>): number[] {
  return [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14].map(index => matrix[index]);
}

function getRowTransform(row: ReturnType<typeof firstRow>): number[] {
  return getSplatTransform(row.orientation, row.scale, row.translation);
}

describe('TreeLayer lifecycle on the standard pipeline', () => {
  it.each(SPECIES)('%s: default values change nothing', species => {
    const plain = prepare(tree(species));
    const explicit = prepare(
      tree(species, {
        growth: 1,
        health: 1,
        foliage: 1,
        flush: 0,
        lean: [0, 0],
        damage: 0,
        decay: 0
      })
    );
    // Each has its own source object.
    const fields = (layer: TreeLayer<TreeSpec>) => {
      const {
        __source: _source,
        object: _object,
        ...rest
      } = firstRow(layer) as unknown as {
        __source: unknown;
        object: unknown;
      };
      return rest;
    };
    expect(fields(explicit)).toEqual(fields(plain));
    const row = firstRow(plain);
    expect(row.scale[2] + row.rootLength).toBeCloseTo(row.height, 9);
    expect(row.settle).toBe(1);
    expect(plain.state.hasRowCoverage).toBe(false);
    expect(plain.state.usesPoseMatrix).toBe(false);
    expect(Object.values(plain.state.revisions).every(revision => revision === 0)).toBe(true);
    // Coverage stays the constant it was given, and no accessor comes in to look after a pose.
    for (const child of children(plain)) {
      expect(child.props.getCoverageWeight).toBe(1);
      expect(typeof child.props.getTransformMatrix).not.toBe('function');
    }
  });

  it.each(SPECIES)('%s: growth scales height, crown and trunk radius', species => {
    const mature = firstRow(prepare(tree(species)));
    for (const growth of [0.03, 0.12, 0.35, 0.7]) {
      const row = firstRow(prepare(tree(species, {growth})));
      expect(row.height).toBeCloseTo(mature.height * getTreeHeightFraction(growth), 9);
      expect(row.scale[0]).toBeCloseTo(mature.scale[0] * getTreeCrownFraction(growth), 9);
      expect(row.scale[1]).toBeCloseTo(mature.scale[1] * getTreeCrownFraction(growth), 9);
      expect(row.scale[2]).toBeCloseTo(mature.scale[2] * getTreeHeightFraction(growth), 9);
      expect(row.trunkRadius).toBeCloseTo(mature.trunkRadius * getTreeRingRadius(1, 0, growth), 9);
      // The first fork stays on the bole, and the bole on the ground.
      expect(row.translation[2] + 0.22 * row.scale[2]).toBeCloseTo(row.rootLength, 9);
      expect(row.rootLength).toBeCloseTo(mature.rootLength * getTreeHeightFraction(growth), 9);
    }
  });

  it('draws no part of a tree at growth 0, nor any of its crops', () => {
    const layer = prepare(
      tree('citrus', {
        growth: 0,
        crop: {color: [240, 140, 20], count: 8, droppedCount: 4, radius: 0.04}
      })
    );
    const row = firstRow(layer);
    expect(row.height).toBe(0);
    expect(row.trunkRadius).toBe(0);
    expect(layer.state.liveCrops).toHaveLength(0);
    expect(layer.state.droppedCrops).toHaveLength(0);
    expect(layer.renderLayers().some(child => child instanceof TreeWoodLayer)).toBe(false);
    for (const value of [...row.scale, ...row.translation, ...row.wind])
      expect(Number.isFinite(value)).toBe(true);
  });

  it('tints only the canopy with health and flush', () => {
    const green: [number, number, number, number] = [40, 120, 30, 255];
    const color = (lifecycle: Partial<TreeSpec>) => {
      const layer = prepare(tree('oak', {canopyColor: green, ...lifecycle}));
      const row = firstRow(layer);
      return {
        canopy: part(layer, 'canopy').props.getColor(row, INFO) as number[],
        wood: part(layer, 'wood').props.getColor(row, INFO) as number[]
      };
    };
    const healthy = color({});
    expect(healthy.canopy).toEqual(green);
    const dead = color({health: 0});
    expect(dead.canopy.slice(0, 3)).toEqual([132, 104, 56]);
    const sick = color({health: 0.5});
    expect(sick.canopy[0]).toBeCloseTo((green[0] + 132) / 2, 9);
    const flushing = color({flush: 1});
    expect(flushing.canopy[1]).toBeGreaterThan(green[1]);
    expect(flushing.canopy[0]).toBeGreaterThan(green[0]);
    for (const {wood} of [dead, sick, flushing]) expect(wood).toEqual(healthy.wood);
  });

  it('thins the canopy with foliage and decay, and wood only with decay', () => {
    const coverage = (lifecycle: Partial<TreeSpec>) => {
      const layer = prepare(tree('oak', lifecycle));
      const row = firstRow(layer);
      const read = (accessor: unknown) =>
        typeof accessor === 'function' ? (accessor(row, INFO) as number) : (accessor as number);
      return {
        canopy: read(part(layer, 'canopy').props.getCoverageWeight),
        wood: read(part(layer, 'wood').props.getCoverageWeight)
      };
    };
    expect(coverage({foliage: 0.3}).canopy).toBeCloseTo(0.3, 9);
    expect(coverage({foliage: 0.3}).wood).toBe(1);
    expect(coverage({foliage: 0}).canopy).toBe(0);
    // Leaves rot first. The wood stands whole, then goes grain by grain.
    let last = coverage({}).canopy;
    for (const decay of [0.2, 0.3, 0.4, 0.5, 0.6]) {
      const value = coverage({decay}).canopy;
      expect(value).toBeLessThan(last);
      last = value;
    }
    expect(coverage({decay: 0.65}).canopy).toBe(0);
    expect(coverage({decay: 0.45}).wood).toBe(1);
    expect(coverage({decay: 0.7}).wood).toBeLessThan(1);
    expect(coverage({decay: 0.7}).wood).toBeGreaterThan(0);
    expect(coverage({decay: 1}).wood).toBe(0);
    expect(coverage({decay: 1}).canopy).toBe(0);
  });

  it('multiplies lifecycle coverage with getCoverageWeight, and keeps its trigger', () => {
    const layer = prepare(tree('oak', {foliage: 0.5, decay: 0.55}), {
      getCoverageWeight: 0.5,
      updateTriggers: {getCoverageWeight: 'fade'}
    });
    const row = firstRow(layer);
    expect(row.coverage).toBeGreaterThan(0);
    expect(row.canopyCoverage).toBeGreaterThan(0);
    const wood = part(layer, 'wood');
    const canopy = part(layer, 'canopy');
    expect(wood.props.getCoverageWeight(row, INFO)).toBeCloseTo(0.5 * row.coverage, 9);
    expect(canopy.props.getCoverageWeight(row, INFO)).toBeCloseTo(0.5 * row.canopyCoverage, 9);
    expect(wood.props.updateTriggers.getCoverageWeight).toBe('fade');
    expect(canopy.props.updateTriggers.getCoverageWeight).toBe('fade');
  });

  it.each(SPECIES)('%s: damage thins the crown and droops it from its first fork', species => {
    const whole = firstRow(prepare(tree(species)));
    let last = whole;
    for (const damage of [0.25, 0.5, 1]) {
      const layer = prepare(tree(species, {damage}));
      const row = firstRow(layer);
      expect(row.canopyCoverage).toBeLessThan(last.canopyCoverage);
      expect(row.canopyCoverage).toBeGreaterThan(0);
      expect(row.scale[2]).toBeLessThan(last.scale[2]);
      expect(row.scale[0]).toBe(whole.scale[0]);
      // The bole has not moved, and neither has where the crown joins it.
      expect(row.rootLength).toBe(whole.rootLength);
      expect(row.translation[2] + 0.22 * row.scale[2]).toBeCloseTo(whole.rootLength, 9);
      expect(row.coverage).toBe(1);
      last = row;
    }
  });

  it('takes crops down with their limbs, keeping their number and their place in the crown', () => {
    const crop = {color: [240, 140, 20, 255], count: 40, radius: 0.04} as const;
    const whole = prepare(tree('oak', {crop}));
    const broken = prepare(tree('oak', {crop, damage: 1}));
    expect(whole.state.liveCrops.length).toBeGreaterThan(30);
    expect(broken.state.liveCrops.length).toBeLessThan(whole.state.liveCrops.length);
    expect(broken.state.liveCrops.length).toBeGreaterThan(0);
    expect(broken.state.liveCrops.length + broken.state.droppedCrops.length).toBe(40);
    for (const row of broken.state.droppedCrops) expect(row.translation[2]).toBe(row.radius);
  });

  it.each(SPECIES)('%s: decay settles a standing tree flat and greys its wood', species => {
    const standing = firstRow(prepare(tree(species)));
    const flatten = (decay: number) => {
      const t = Math.max(0, Math.min(1, (decay - 0.06) / 0.74));
      return (1 - t * t * (3 - 2 * t)) ** 2;
    };
    let last = standing;
    for (const decay of [0.1, 0.3, 0.5, 0.8, 1]) {
      const layer = prepare(tree(species, {decay}));
      const row = firstRow(layer);
      expect(row.height).toBeLessThan(last.height);
      // Scale, translation and bole by one factor, so that it stays connected and on the ground.
      const factor = row.height / standing.height;
      expect(row.scale[2]).toBeCloseTo(standing.scale[2] * factor, 9);
      expect(row.rootLength).toBeCloseTo(standing.rootLength * factor, 9);
      expect(row.translation[2]).toBeCloseTo(standing.translation[2] * factor, 9);
      expect(row.scale[0]).toBe(standing.scale[0]);
      expect(row.settle).toBe(1);
      expect(factor).toBeGreaterThanOrEqual(flatten(decay) - 1e-9);
      expect(row.trunkRadius).toBeLessThanOrEqual(last.trunkRadius);
      last = row;
    }
    // Flat, on a thin layer of debris.
    expect(last.height).toBeLessThan(0.2);
    expect(last.height).toBeGreaterThan(0);
    const color = (decay: number) => {
      const layer = prepare(tree(species, {trunkColor: [120, 60, 20, 255], decay}));
      return part(layer, 'wood').props.getColor(firstRow(layer), INFO) as number[];
    };
    const spread = ([r, , b]: number[]) => r - b;
    expect(spread(color(0))).toBe(100);
    expect(spread(color(0.3))).toBeLessThan(100);
    expect(spread(color(0.5))).toBeLessThan(spread(color(0.3)));
    expect(color(1)[0]).toBeLessThan(color(0.5)[0]);
  });

  it.each(SPECIES)('%s: lean turns wood, canopy and crops about the root as one', species => {
    const crop = {color: [240, 140, 20, 255], count: 12, radius: 0.04} as const;
    const upright = prepare(tree(species, {crop}));
    for (const [degrees, bearing] of [
      [10, 0],
      [45, 90],
      [85, 200],
      [90, 315]
    ]) {
      const layer = prepare(tree(species, {crop, lean: [degrees, bearing]}));
      const row = firstRow(layer);
      expect(row.leaning).toBe(true);
      const toRadians = Math.PI / 180;
      const up = [
        Math.sin(bearing * toRadians) * Math.sin(degrees * toRadians),
        Math.cos(bearing * toRadians) * Math.sin(degrees * toRadians),
        Math.cos(degrees * toRadians)
      ];
      const pose = getRowTransform(row);
      // The axis of the tree points where it leans.
      const axis = [pose[6], pose[7], pose[8]].map(value => value / row.scale[2]);
      for (let i = 0; i < 3; i++) expect(axis[i]).toBeCloseTo(up[i], 9);
      // The root of the wood mesh stays where it was.
      const root = transform(pose, [0, 0, 0.22 - row.rootLength / row.scale[2]]);
      for (const value of root) expect(value).toBeCloseTo(0, 9);
      // Every part reads this one pose.
      for (const name of ['wood', 'canopy']) {
        const child = part(layer, name);
        expect(child.props.getOrientation(row, INFO)).toEqual(row.orientation);
        expect(child.props.getScale(row, INFO)).toEqual(row.scale);
        expect(child.props.getTranslation(row, INFO)).toEqual(row.translation);
      }
      // A crop is where the rotation about the root takes it from an upright tree.
      const azimuth = Math.atan2(Math.cos(bearing * toRadians), Math.sin(bearing * toRadians));
      const turn = new Matrix4()
        .rotateZ(azimuth)
        .rotateY(degrees * toRadians)
        .rotateZ(-azimuth);
      expect(layer.state.liveCrops.length).toBe(upright.state.liveCrops.length);
      layer.state.liveCrops.forEach((cropRow, index) => {
        const expected = turn.transformAsVector(upright.state.liveCrops[index].translation);
        for (let i = 0; i < 3; i++) expect(cropRow.translation[i]).toBeCloseTo(expected[i], 9);
      });
      // A tree in a wind bends less the further over it is.
      expect(row.wind[2]).toBeCloseTo(Math.cos(degrees * toRadians), 9);
    }
  });

  it('keeps a tree the same way round as it starts to lean', () => {
    const upright = firstRow(prepare(tree('oak')));
    const leaning = firstRow(prepare(tree('oak', {lean: [0.001, 130]})));
    const a = getRowTransform(upright);
    const b = getRowTransform(leaning);
    for (let i = 0; i < 9; i++) expect(b[i]).toBeCloseTo(a[i], 3);
  });

  it('flattens a leaning, rotting tree onto the ground with a matrix all its parts share', () => {
    const crop = {color: [240, 140, 20, 255], count: 12, radius: 0.04} as const;
    const lean: [number, number] = [50, 90];
    const leaning = prepare(tree('oak', {crop, lean}));
    const rotting = prepare(tree('oak', {crop, lean, decay: 0.4}));
    const row = firstRow(rotting);
    expect(row.settle).toBeGreaterThan(0.2);
    expect(row.settle).toBeLessThan(0.5);
    expect(rotting.state.usesPoseMatrix).toBe(true);
    const wood = part(rotting, 'wood');
    const canopy = part(rotting, 'canopy');
    const matrix = wood.props.getTransformMatrix(row, INFO) as number[];
    expect(canopy.props.getTransformMatrix(row, INFO)).toEqual(matrix);
    expect(matrix[3]).toBe(0);
    expect(matrix[7]).toBe(0);
    expect(matrix[11]).toBe(0);
    expect(matrix[15]).toBe(1);
    // World z alone has gone down.
    const pose = toTransform(matrix);
    const standing = getRowTransform(firstRow(leaning));
    const top = transform(pose, [0, 0, 1]);
    const topStanding = transform(standing, [0, 0, 1]);
    expect(top[0]).toBeCloseTo(topStanding[0], 9);
    expect(top[1]).toBeCloseTo(topStanding[1], 9);
    expect(top[2]).toBeCloseTo(topStanding[2] * row.settle, 9);
    // The root of the wood mesh is still at the root, for the length of column the shader finds.
    const column = Math.hypot(pose[6], pose[7], pose[8]);
    for (const value of transform(pose, [0, 0, 0.22 - row.rootLength / column]))
      expect(value).toBeCloseTo(0, 9);
    // Crops go with it.
    rotting.state.liveCrops.forEach((cropRow, index) => {
      const before = leaning.state.liveCrops[index].translation;
      expect(cropRow.translation[0]).toBeCloseTo(before[0], 9);
      expect(cropRow.translation[1]).toBeCloseTo(before[1], 9);
      expect(cropRow.translation[2]).toBeCloseTo(before[2] * row.settle, 9);
    });
  });

  it('gives every row of a layer a matrix when any row needs one', () => {
    const layer = prepare([
      tree('oak', {lean: [50, 90], decay: 0.4}),
      tree('oak', {position: [40, 0, 0]})
    ]);
    const wood = part(layer, 'wood');
    const upright = layer.state.standardRows[1];
    // deck.gl's matrix attribute asks only the first row whether there are matrices.
    expect(toTransform(wood.props.getTransformMatrix(upright, INFO))).toEqual(
      getRowTransform(upright)
    );
    const trunkOnly = prepare(
      [tree('oak', {lean: [50, 90], decay: 0.4, crownRadius: 0}), tree('oak', {lean: [50, 90]})],
      {}
    );
    const trunks = part(trunkOnly, 'trunks');
    const trunk = trunkOnly.state.standardRows[0];
    const matrix = trunks.props.getTransformMatrix(trunk, INFO) as unknown as number[];
    expect(matrix[14]).toBe(0);
    expect(Math.hypot(matrix[8], matrix[9], matrix[10] / trunk.settle)).toBeCloseTo(
      trunk.trunkHeight,
      9
    );
  });

  it('takes the same materials as photoreal quality, over its own defaults', () => {
    const crop = {color: [240, 140, 20, 255], count: 4, droppedCount: 2, radius: 0.04} as const;
    const data = [tree('oak', {crop}), tree('pine', {position: [40, 0, 0], crownRadius: 0})];
    const parts = children;
    const woodMaterial = {ambient: 0.1, diffuse: 0.2, shininess: 3, specularColor: [1, 2, 3]};
    const foliageMaterial = {ambient: 0.3, diffuse: 0.4, shininess: 5, specularColor: [4, 5, 6]};
    const cropMaterial = {ambient: 0.6, diffuse: 0.7, shininess: 7, specularColor: [7, 8, 9]};
    const custom = prepare(data, {woodMaterial, foliageMaterial, cropMaterial});
    for (const child of parts(custom)) {
      const material = child.id.includes('canopy')
        ? foliageMaterial
        : child.id.includes('crops')
          ? cropMaterial
          : woodMaterial;
      expect(child.props.material).toBe(material);
    }
    expect(parts(custom).length).toBeGreaterThanOrEqual(5);
    // Without them nothing has changed, and a layer's own override still goes over them.
    const canopy = parts(prepare(data)).find(child => child.id.includes('canopy'))!;
    expect(canopy.props.material).toEqual({
      ambient: 0.62,
      diffuse: 0.82,
      shininess: 2,
      specularColor: [0, 0, 0]
    });
    const overridden = prepare(data, {
      foliageMaterial,
      _subLayerProps: {'canopy-oak': {material: cropMaterial}}
    });
    expect(parts(overridden).find(child => child.id.includes('canopy-oak'))!.props.material).toBe(
      cropMaterial
    );
  });

  it('keeps fallen crops on the ground whatever the tree does', () => {
    const crop = {color: [240, 140, 20, 255], count: 0, droppedCount: 6, radius: 0.04} as const;
    const upright = prepare(tree('oak', {crop}));
    const fallen = prepare(tree('oak', {crop, lean: [80, 40], decay: 0.3}));
    expect(fallen.state.droppedCrops.map(row => row.translation)).toEqual(
      upright.state.droppedCrops.map(row => row.translation)
    );
    for (const row of fallen.state.droppedCrops) expect(row.wind[2]).toBe(0);
  });
});

/** The GLSL of `splatDeform`, for what the shader must do. */
function deform(
  position: number[],
  height: number,
  strength: number,
  wave: [number, number],
  wind: readonly number[]
): number[] {
  const u = Math.max(0, Math.min(1, position[2] / height));
  const f = 0.5 * u * u * (3 - u);
  const v = Math.max((u - 0.3) / 0.7, 0);
  const g = v * v;
  const bend = [wind[0], wind[1]].map(axis => axis * strength * (wind[2] + wind[3] * wave[0]));
  const branch = 0.35 * strength * wave[1];
  const lateral = [0.65 * position[0] + 0.3 * position[1], -0.25 * position[0] + 0.8 * position[1]];
  const arc = Math.max(bend[0] ** 2 + bend[1] ** 2 - (wind[2] > 0 ? 0 : 0.3), 0);
  return [
    position[0] + bend[0] * height * f + branch * g * lateral[0],
    position[1] + bend[1] * height * f + branch * g * lateral[1],
    Math.max(position[2] - (2 / 3) * arc * height * u * u * u, Math.min(position[2], 0))
  ];
}

describe('TreeLayer wind', () => {
  it('takes a strength of up to 1, for the layer and for each tree', () => {
    expect((TreeLayer.defaultProps.windStrength as {max: number}).max).toBe(1);
    const row = (wind: boolean | number) => firstRow(prepare(tree('oak', {wind})));
    expect(row(1).windStrength).toBe(1);
    expect(row(0.6).windStrength).toBe(0.6);
    expect(row(5).windStrength).toBe(1);
    expect(row(true).windStrength).toBe(0.025);
    expect(row(false).windStrength).toBe(0);
    const layer = prepare(tree('oak', {wind: 0.8}), {windStrength: 0.2});
    for (const child of children(layer)) expect(child.props.windStrength).toBe(0.8);
  });

  it('gives wood, canopy and crops one direction, as a unit vector of the bearing', () => {
    const data = [
      tree('oak', {
        crop: {color: [240, 140, 20, 255], count: 4, droppedCount: 2, radius: 0.04}
      }),
      tree('oak', {position: [40, 0, 0], crownRadius: 0})
    ];
    for (const [bearing, x, y] of [
      [90, 1, 0],
      [0, 0, 1],
      [225, -Math.SQRT1_2, -Math.SQRT1_2]
    ]) {
      const layer = prepare(data, {windStrength: 0.1, windDirection: bearing});
      const parts = children(layer);
      expect(parts.length).toBeGreaterThanOrEqual(5);
      for (const child of parts) {
        const direction: number[] =
          child instanceof SplatLayer
            ? child.props.deformationDirection
            : child.props.windDirection;
        expect(direction[0]).toBeCloseTo(x, 9);
        expect(direction[1]).toBeCloseTo(y, 9);
      }
    }
    for (const child of children(prepare(data, {windStrength: 0.1})))
      expect(
        child instanceof SplatLayer ? child.props.deformationDirection : child.props.windDirection
      ).toBe(null);
  });

  it('sends gusts across a grove: a tree takes its phase from where it stands downwind', () => {
    const crop = {color: [240, 140, 20, 255], count: 2, radius: 0.04} as const;
    const data = [
      tree('oak', {position: [0, 0, 0], crop}),
      tree('oak', {position: [100, 7, 0], crop}),
      tree('oak', {position: [200, -9, 0], crop})
    ];
    const layer = prepare(data, {windStrength: 0.1, windDirection: 90});
    const wood = part(layer, 'wood');
    const canopy = part(layer, 'canopy');
    const crops = part(layer, 'live-crops');
    const [a, b, c] = layer.state.standardRows;
    const phase = (row: ReturnType<typeof firstRow>) =>
      (wood.props.getWind(row, INFO) as number[])[1] - row.wind[1] * 0.25;
    expect(phase(a)).toBeCloseTo(0, 9);
    expect(phase(b)).toBeCloseTo(-13, 9);
    expect(phase(c)).toBeCloseTo(-26, 9);
    // All of a tree moves together.
    expect(canopy.props.getDeformation(b, INFO)).toEqual(wood.props.getWind(b, INFO));
    const cropRow = b.liveCrops[0];
    expect(crops.props.getWind(cropRow, INFO)).toEqual(wood.props.getWind(b, INFO));
    // Without a direction each tree keeps its phase.
    const sway = prepare(data, {windStrength: 0.1});
    const swayRow = sway.state.standardRows[1];
    expect(part(sway, 'wood').props.getWind(swayRow, INFO)).toBe(swayRow.wind);
  });

  it('measures gusts in metres at longitude and latitude', () => {
    const viewport = new WebMercatorViewport({width: 128, height: 128, zoom: 20});
    const layer = new TreeLayer<TreeSpec>({
      id: 'trees',
      data: [tree('oak', {position: [0, 60]}), tree('oak', {position: [0.001, 60]})],
      windStrength: 0.1,
      windDirection: 90
    });
    layer.initializeState();
    Object.assign(layer, {context: {viewport}});
    vi.spyOn(layer, 'setState').mockImplementation(state => {
      Object.assign(layer.state, state);
    });
    layer.updateState({
      props: layer.props,
      oldProps: {},
      changeFlags: {dataChanged: true}
    } as never);
    const wood = layer.renderLayers().find(child => child.id.includes('wood')) as TreeWoodLayer;
    const [a, b] = layer.state.standardRows;
    const phase = (row: ReturnType<typeof firstRow>) =>
      (wood.props.getWind(row, INFO) as number[])[1] - row.wind[1] * 0.25;
    expect(phase(b) - phase(a)).toBeCloseTo(-0.13 * 111320 * 0.001 * 0.5, 6);
  });

  it('rewrites gust phases only when the wind turns by a whole degree', () => {
    const data = [tree('oak')];
    const trigger = (windDirection: number) =>
      part(prepare(data, {windStrength: 0.1, windDirection}), 'wood').props.updateTriggers.getWind;
    expect(trigger(90.1)).toEqual(trigger(90.2));
    expect(trigger(90.1)).not.toEqual(trigger(91.2));
  });

  it('keeps the shared deformation as it was without a direction, up to a strength of 0.5', () => {
    const wind = getSplatDeformationWind(null);
    expect(wind).toEqual([1, 0.45, 0, 1]);
    // What the deformation was before it took a direction, up to a strength of 0.5.
    for (const strength of [0.025, 0.2, 0.5])
      for (const phase of [0, 0.7, 2.4, 4]) {
        const wave: [number, number] = [Math.sin(phase), Math.sin(phase * 2)];
        const position = [1.5, -0.4, 6];
        const moved = deform(position, 10, strength, wave, wind);
        const u = 0.6,
          f = 0.5 * u * u * (3 - u),
          v = (u - 0.3) / 0.7,
          g = v * v;
        const bend = [strength * wave[0], 0.45 * strength * wave[0]];
        const branch = 0.35 * strength * wave[1];
        expect(moved[0]).toBeCloseTo(
          1.5 + bend[0] * 10 * f + branch * g * (0.65 * 1.5 + 0.3 * -0.4),
          12
        );
        expect(moved[1]).toBeCloseTo(
          -0.4 + bend[1] * 10 * f + branch * g * (-0.25 * 1.5 + 0.8 * -0.4),
          12
        );
        expect(moved[2]).toBe(6);
      }
  });

  it('bends toward the bearing, with gusts, and brings what bends over down', () => {
    const wind = getSplatDeformationWind([0, 1]);
    expect(wind).toEqual([0, 1, 1, 0.5]);
    const height = 10;
    const tip = (strength: number, gust: number) =>
      deform([0, 0, height], height, strength, [gust, 0], wind);
    // At a mean gust, the top bends by `strength` of the height, all of it along the wind.
    expect(tip(0.1, 0)[0]).toBe(0);
    expect(tip(0.1, 0)[1]).toBeCloseTo(1, 9);
    expect(tip(0.1, 1)[1]).toBeCloseTo(1.5, 9);
    expect(tip(0.1, -1)[1]).toBeCloseTo(0.5, 9);
    // The same arc as photoreal quality: (2/3) bend^2 height.
    expect(tip(0.3, 0)[2]).toBeCloseTo(height - (2 / 3) * 0.09 * height, 9);
    // A hurricane lays it over, and never through the ground.
    const hurricane = tip(1, 1);
    expect(hurricane[1]).toBeCloseTo(15, 9);
    expect(hurricane[2]).toBe(0);
    expect(tip(1, -1)[2]).toBeGreaterThan(0);
    // The base never moves.
    const base = deform([0, 0, 0], height, 1, [1, 1], wind);
    expect(base).toEqual([0, 0, 0]);
  });

  it('keeps the owner bound around what the deformation does at any strength', () => {
    const height = 10;
    for (const wind of [getSplatDeformationWind(null), getSplatDeformationWind([0.6, 0.8])])
      for (const strength of [0.03, 0.3, 0.6, 1])
        for (const center of [
          [0, 0, 7],
          [3, -2, 9],
          [0, 0, 12],
          [-5, 1, 2]
        ]) {
          const radius = 0.5;
          const bound = getSplatDeformationRadius(center, radius, height, strength, wind);
          for (let step = 0; step < 64; step++) {
            const angle = (step / 64) * Math.PI * 2;
            const moved = deform(
              center,
              height,
              strength,
              [Math.sin(angle), Math.cos(angle)],
              wind
            );
            const distance = Math.hypot(
              moved[0] - center[0],
              moved[1] - center[1],
              moved[2] - center[2]
            );
            expect(distance).toBeLessThanOrEqual(bound);
          }
        }
  });

  it('uses the shared deformation with its wind uniform, for wood and canopy alike', () => {
    expect(SPLAT_DEFORMATION_GLSL).toContain('wind.xy * strength * (wind.z + wind.w * wave.x)');
    expect(SPLAT_DEFORMATION_WGSL).toContain('wind.xy * strength * (wind.z + wind.w * wave.x)');
    for (const type of ['webgl', 'webgpu'] as const) {
      const layer = Object.assign(Object.create(TreeMeshLayer.prototype), {
        context: {device: {type}, defaultShaderModules: []},
        props: {...TreeMeshLayer.defaultProps, extensions: []}
      });
      const {vs, source} = layer.getShaders();
      expect(type === 'webgl' ? vs : source).toMatch(/splatDeform\([^;]*treeWind\.wind\)/);
    }
    const splat = Object.assign(Object.create(SplatPrimitiveLayer.prototype), {
      context: {device: {type: 'webgl'}, defaultShaderModules: []},
      props: {...SplatPrimitiveLayer.defaultProps, extensions: []}
    });
    const {vs, source} = splat.getShaders();
    expect(vs).toMatch(/splatDeform\([^;]*splat\.wind\)/);
    expect(source).toMatch(/splatDeform\([^;]*splat\.wind\)/);
  });
});

type Written = {layer: string; attributes: string[]};

/** A deck's layers on a stepped clock, with every attribute write on record. */
function mount() {
  const viewport = new WebMercatorViewport({
    width: 256,
    height: 256,
    longitude: 0,
    latitude: 0,
    zoom: 19,
    pitch: 45
  });
  const timeline = new Timeline();
  timeline.setTime(1000);
  const manager = new LayerManager(device, {
    viewport,
    timeline,
    deck: {getViewports: () => [viewport], _addDefaultEffect: () => {}}
  } as never);
  const errors: string[] = [];
  manager.setProps({onError: (error: Error) => errors.push(error.message)});
  const written: Written[] = [];
  const record = (prototype: object) =>
    vi
      .spyOn(
        prototype as {updateAttributes(changed: Record<string, unknown>): void},
        'updateAttributes'
      )
      .mockImplementation(function record(this: Layer, changed) {
        const attributes = Object.keys(changed);
        if (attributes.length) written.push({layer: this.id, attributes});
      } as never);
  const spies = [record(TreeMeshLayer.prototype), record(SplatPrimitiveLayer.prototype)];
  const render = (props: Record<string, unknown>) =>
    manager.setLayers([new TreeLayer<TreeSpec>({id: 'trees', ...props}) as never]);
  const treeLayer = () =>
    manager
      .getLayers({layerIds: ['trees']})
      .find(layer => layer.id === 'trees') as TreeLayer<TreeSpec>;
  return {
    manager,
    timeline,
    written,
    render,
    treeLayer,
    /** Moves the clock, and updates as a frame of the deck would. */
    tick(time: number) {
      timeline.setTime(time);
      manager.updateLayers();
    },
    find: <T extends Layer>(name: string) =>
      manager.getLayers().find(layer => layer.id.includes(name)) as unknown as T,
    finalize() {
      manager.finalize();
      for (const spy of spies) spy.mockRestore();
      expect(errors).toEqual([]);
    }
  };
}

const scenes: ReturnType<typeof mount>[] = [];
function scene() {
  const created = mount();
  scenes.push(created);
  return created;
}
afterEach(() => {
  for (const created of scenes.splice(0)) created.finalize();
});

const NOTHING_ELSE = {maxCanopySplats: 0, windTime: 1};

describe('TreeLayer transitions on the standard pipeline', () => {
  it('writes only canopy colors on each tick of a tween on health', () => {
    const {render, tick, written, treeLayer, find} = scene();
    const data = [tree('oak'), tree('pine', {position: [1e-4, 0, 0]})];
    const make = (health: number) => ({
      ...NOTHING_ELSE,
      data,
      getTree: (row: TreeSpec) => ({...row, canopyColor: [40, 120, 30, 255]}),
      getHealth: () => health,
      transitions: {getHealth: 1000},
      updateTriggers: {getHealth: health}
    });
    render(make(1));
    const rows = treeLayer().state.standardRows.slice();
    const {groups, woodGroups} = treeLayer().state;
    const canopy = find<SplatLayer>('canopy-oak');
    const woodData = find<TreeWoodLayer>('wood-oak').props.data;
    const canopyData = canopy.props.data;
    render(make(0));
    expect(treeLayer().state.ticking).toBe(true);
    written.length = 0;
    tick(1500);
    const colors = () =>
      written.filter(entry => entry.layer.includes('canopy')).flatMap(entry => entry.attributes);
    expect(colors().length).toBeGreaterThan(0);
    expect(new Set(colors())).toEqual(new Set(['instanceColors']));
    expect(written.filter(entry => !entry.layer.includes('canopy'))).toEqual([]);
    const row = treeLayer().state.standardRows[0];
    expect(row.dry).toBeCloseTo(0.5, 9);
    // Rows and everything holding them have not moved.
    expect(treeLayer().state.standardRows.every((value, i) => value === rows[i])).toBe(true);
    expect(treeLayer().state.groups === groups).toBe(true);
    expect(treeLayer().state.woodGroups === woodGroups).toBe(true);
    expect(find<TreeWoodLayer>('wood-oak').props.data === woodData).toBe(true);
    expect(find<SplatLayer>('canopy-oak').props.data === canopyData).toBe(true);
    // What the GPU reads has moved with it.
    const attribute = find<SplatPrimitiveLayer>(
      'canopy-oak-foliage-3-refinement'
    ).getAttributeManager()!.attributes.instanceColors.value!;
    expect(attribute[0] / 255).toBeCloseTo((40 + (132 - 40) * 0.5) / 255, 1);
    written.length = 0;
    tick(2000);
    expect(treeLayer().state.ticking).toBe(false);
    expect(treeLayer().hasUniformTransition()).toBe(false);
    expect(treeLayer().state.standardRows[0].dry).toBe(1);
    expect(written.length).toBeGreaterThan(0);
    // Done: nothing more is written.
    written.length = 0;
    tick(2100);
    render(make(0));
    expect(written).toEqual([]);
  });

  it('writes poses and wood on a tween on growth, and every part reads the same values', () => {
    const {render, tick, written, treeLayer, find} = scene();
    const data = [tree('oak')];
    const make = (growth: number) => ({
      ...NOTHING_ELSE,
      data,
      getGrowth: () => growth,
      transitions: {getGrowth: 1000},
      updateTriggers: {getGrowth: growth}
    });
    render(make(0.2));
    render(make(0.8));
    written.length = 0;
    tick(1500);
    const row = treeLayer().state.standardRows[0];
    expect(treeLayer().state.store!.getRowValues(0).growth).toBeCloseTo(0.5, 9);
    const mature = firstRow(prepare(tree('oak')));
    expect(row.height).toBeCloseTo(mature.height * getTreeHeightFraction(0.5), 9);
    expect(row.scale[0]).toBeCloseTo(mature.scale[0] * getTreeCrownFraction(0.5), 9);
    const woodMesh = find<TreeMeshLayer<unknown>>('-wood-oak-foliage-3-');
    const woodWritten = written.filter(entry => entry.layer === woodMesh.id);
    expect(woodWritten.flatMap(entry => entry.attributes)).toEqual(
      expect.arrayContaining(['instanceModelMatrix', 'instanceTreeWindData', 'instanceStemRadius'])
    );
    expect(woodWritten.flatMap(entry => entry.attributes)).not.toContain('instanceColors');
    const pose = getSplatTransform(row.orientation, row.scale, row.translation);
    const matrix = woodMesh.getAttributeManager()!.attributes.instanceModelMatrix.value!;
    for (let i = 0; i < 12; i++) expect(matrix[i]).toBeCloseTo(pose[i], 3);
    const canopy = find<SplatPrimitiveLayer>('canopy-oak-foliage-3-refinement');
    const canopyMatrix = canopy.getAttributeManager()!.attributes.instanceModelMatrix.value!;
    for (let i = 0; i < 12; i++) expect(canopyMatrix[i]).toBeCloseTo(pose[i], 3);
  });

  it('keeps a canopy at its level of detail through a tween and through direct animation', () => {
    const {render, tick, find} = scene();
    const data = [tree('oak')];
    const make = (growth: number, transitions: unknown) => ({
      data,
      windTime: 1,
      getGrowth: () => growth,
      transitions,
      updateTriggers: {getGrowth: growth}
    });
    const entries = () => [...find<SplatLayer>('canopy-oak').state.refinement.entries.entries()];
    render(make(0.9, {getGrowth: 1000}));
    const [[key, entry]] = entries();
    render(make(0.5, {getGrowth: 1000}));
    tick(1300);
    tick(1600);
    // An owner that arrives anew starts over from its coarsest level.
    expect(entries()).toHaveLength(1);
    expect(entries()[0][0]).toBe(key);
    expect(entries()[0][1] === entry).toBe(true);
    // And with no transitions at all.
    render(make(0.4, null));
    render(make(0.3, null));
    expect(entries()[0][0]).toBe(key);
    expect(entries()[0][1] === entry).toBe(true);
  });

  it('follows a stepped timeline: a paused clock holds a tween', () => {
    const {render, tick, written, treeLayer} = scene();
    const data = [tree('oak')];
    const make = (foliage: number) => ({
      ...NOTHING_ELSE,
      data,
      getFoliage: () => foliage,
      transitions: {getFoliage: 1000},
      updateTriggers: {getFoliage: foliage}
    });
    render(make(1));
    render(make(0));
    tick(1250);
    const coverage = treeLayer().state.standardRows[0].canopyCoverage;
    expect(coverage).toBeCloseTo(0.75, 9);
    written.length = 0;
    tick(1250);
    tick(1250);
    expect(treeLayer().state.standardRows[0].canopyCoverage).toBe(coverage);
    expect(treeLayer().state.ticking).toBe(true);
    expect(written).toEqual([]);
    tick(1500);
    expect(treeLayer().state.standardRows[0].canopyCoverage).toBeCloseTo(0.5, 9);
    // Only the canopy's coverage: wood does not lose its leaves.
    expect(written.flatMap(entry => entry.attributes)).toEqual(['instanceWindData']);
  });

  it('takes springs and the getTree default', () => {
    const {render, tick, treeLayer} = scene();
    const make = (lean: [number, number], damage: number) => ({
      ...NOTHING_ELSE,
      data: [tree('oak', {lean, damage})],
      getTree: (row: TreeSpec) => row,
      transitions: {getTree: 1000, getLean: {type: 'spring', stiffness: 0.1, damping: 0.4}}
    });
    render(make([0, 90], 0));
    render(make([60, 90], 1));
    tick(1500);
    const row = treeLayer().state.standardRows[0];
    const {leanDegrees, damage} = treeLayer().state.store!.getRowValues(0);
    expect(damage).toBeCloseTo(0.5, 9);
    expect(leanDegrees).toBeGreaterThan(30);
    expect(row.leaning).toBe(true);
    expect(row.scale[2]).toBeLessThan(firstRow(prepare(tree('oak'))).scale[2]);
    for (let time = 1600; time < 12000; time += 100) tick(time);
    expect(treeLayer().state.ticking).toBe(false);
    const rest = treeLayer().state.standardRows[0];
    const target = firstRow(prepare(tree('oak', {lean: [60, 90], damage: 1})));
    expect(rest.orientation[1]).toBeCloseTo(target.orientation[1], 9);
    expect(rest.scale[2]).toBeCloseTo(target.scale[2], 9);
    expect(rest.translation[0]).toBeCloseTo(target.translation[0], 9);
  });

  // Every key of the contract, each with what it tweens on a row and the attribute that takes it.
  const KEYS: [
    string,
    Partial<TreeSpec>,
    Partial<TreeSpec>,
    (row: ReturnType<typeof firstRow>) => number,
    string
  ][] = [
    ['getHeight', {height: 10}, {height: 20}, row => row.height, 'instanceModelMatrix'],
    [
      'getCanopyRadius',
      {crownRadius: 2},
      {crownRadius: 4},
      row => row.fullScale[0],
      'instanceModelMatrix'
    ],
    [
      'getTrunkRadius',
      {trunkRadius: 0.2},
      {trunkRadius: 0.4},
      row => row.trunkRadius,
      'instanceStemRadius'
    ],
    [
      'getTrunkHeightFraction',
      {trunkHeightFraction: 0.2},
      {trunkHeightFraction: 0.4},
      row => row.rootLength,
      'instanceRootLength'
    ],
    [
      'getElevation',
      {elevation: 0},
      {elevation: 10},
      row => row.position[2] as number,
      'instancePositions'
    ],
    [
      'getCanopyColor',
      {canopyColor: [0, 100, 0, 255]},
      {canopyColor: [100, 100, 0, 255]},
      row => (row.canopyColor as unknown as number[])[0],
      'instanceColors'
    ],
    [
      'getTrunkColor',
      {trunkColor: [0, 100, 0, 255]},
      {trunkColor: [100, 100, 0, 255]},
      row => (row.trunkColor as unknown as number[])[0],
      'instanceColors'
    ]
  ];
  it.each(KEYS)('tweens %s, on its row and in its attribute', (key, from, to, read, attribute) => {
    const {render, tick, treeLayer, written} = scene();
    const make = (lifecycle: Partial<TreeSpec>) => ({
      ...NOTHING_ELSE,
      data: [tree('oak', {height: 10, crownRadius: 2, ...lifecycle})],
      getTree: (row: TreeSpec) => row,
      transitions: {[key]: 1000}
    });
    render(make(from));
    const start = read(treeLayer().state.standardRows[0]);
    render(make(to));
    written.length = 0;
    tick(1500);
    const middle = read(treeLayer().state.standardRows[0]);
    tick(2100);
    const end = read(treeLayer().state.standardRows[0]);
    expect(end).not.toBe(start);
    expect(middle).toBeCloseTo((start + end) / 2, 6);
    expect(written.flatMap(entry => entry.attributes)).toContain(attribute);
    expect(treeLayer().state.ticking).toBe(false);
  });

  it('calls the callbacks of a transition, per tree', () => {
    const {render, tick} = scene();
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const data = [tree('oak'), tree('pine', {position: [1e-4, 0, 0]})];
    const make = (growth: number) => ({
      ...NOTHING_ELSE,
      data,
      getGrowth: () => growth,
      transitions: {getGrowth: {duration: 1000, onStart, onEnd}},
      updateTriggers: {getGrowth: growth}
    });
    render(make(0.5));
    expect(onStart).not.toHaveBeenCalled();
    render(make(0.9));
    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onStart).toHaveBeenCalledWith(1, 'getGrowth');
    tick(1500);
    expect(onEnd).not.toHaveBeenCalled();
    tick(2100);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('adds crops as a count tweens, writing only crops, and moves those that fall', () => {
    const {render, tick, treeLayer, find, written} = scene();
    const make = (count: number, fallen: number) => ({
      ...NOTHING_ELSE,
      data: [tree('oak')],
      getCrop: () => ({color: [240, 140, 20, 255], count, fallen, radius: 0.04}),
      transitions: {getCrop: 1000},
      updateTriggers: {getCrop: [count, fallen]}
    });
    render(make(0, 0));
    render(make(40, 0));
    const woodData = find<TreeWoodLayer>('wood-oak').props.data;
    written.length = 0;
    tick(1250);
    const quarter = treeLayer().state.liveCrops.length;
    expect(quarter).toBeGreaterThan(5);
    expect(quarter).toBeLessThanOrEqual(10);
    const existing = treeLayer().state.liveCrops[0];
    tick(1500);
    expect(treeLayer().state.liveCrops.length).toBeGreaterThan(quarter);
    // Crops there already stay what they were.
    expect(treeLayer().state.liveCrops[0] === existing).toBe(true);
    expect(find<TreeWoodLayer>('wood-oak').props.data === woodData).toBe(true);
    expect(written.every(entry => entry.layer.includes('crops'))).toBe(true);
    tick(2100);
    const all = treeLayer().state.liveCrops.length;
    expect(all).toBeGreaterThan(30);
    expect(treeLayer().state.droppedCrops).toHaveLength(0);
    render(make(40, 0.5));
    tick(2600);
    expect(treeLayer().state.store!.getRowValues(0).crops[0].fallen).toBeCloseTo(0.25, 9);
    expect(treeLayer().state.droppedCrops.length).toBe(40 - Math.floor(40 * 0.75));
  });

  it('keeps crops on their tree through a tween on its pose, with no new rows', () => {
    const {render, tick, treeLayer, find, written} = scene();
    const data = [
      tree('oak', {crop: {color: [240, 140, 20, 255], count: 12, droppedCount: 3, radius: 0.04}})
    ];
    const make = (lean: number) => ({
      ...NOTHING_ELSE,
      data,
      getLean: () => [lean, 90],
      transitions: {getLean: 1000},
      updateTriggers: {getLean: lean}
    });
    render(make(0));
    render(make(60));
    const {liveCrops, droppedCrops} = treeLayer().state;
    written.length = 0;
    tick(1500);
    const state = treeLayer().state;
    expect(state.liveCrops === liveCrops).toBe(true);
    expect(state.droppedCrops === droppedCrops).toBe(true);
    expect(treeLayer().state.store!.getRowValues(0).leanDegrees).toBeCloseTo(30, 9);
    // What the GPU reads has followed the tree.
    const crops = find<TreeMeshLayer<unknown>>('live-crops');
    const matrix = crops.getAttributeManager()!.attributes.instanceModelMatrix.value!;
    const expected = firstRow(prepare(data, {getLean: () => [30, 90]})).liveCrops[0].translation;
    for (let i = 0; i < 3; i++) expect(matrix[9 + i]).toBeCloseTo(expected[i], 3);
    const writes = (id: string) =>
      written.filter(entry => entry.layer.endsWith(id)).flatMap(entry => entry.attributes);
    expect(writes('live-crops')).toContain('instanceModelMatrix');
    // Those on the ground have not moved.
    expect(writes('dropped-crops')).toEqual([]);
    const dropped = find<TreeMeshLayer<unknown>>('dropped-crops');
    const groundMatrix = dropped.getAttributeManager()!.attributes.instanceModelMatrix.value!;
    expect(groundMatrix[11]).toBe(Math.fround(state.droppedCrops[0].translation[2]));
  });

  it('writes only crops colors on a tween on ripeness', () => {
    const {render, tick, treeLayer, written} = scene();
    const make = (ripeness: number) => ({
      ...NOTHING_ELSE,
      data: [tree('oak')],
      getCrop: () => ({
        color: [240, 140, 20, 255],
        unripeColor: [40, 120, 20],
        ripeness,
        count: 12,
        radius: 0.04
      }),
      transitions: {getCrop: 1000},
      updateTriggers: {getCrop: ripeness}
    });
    render(make(0));
    render(make(1));
    const crop = treeLayer().state.liveCrops[0];
    const red = (row: typeof crop) => (row.color as unknown as number[])[0];
    expect(treeLayer().state.liveCrops.every(row => red(row) === 40)).toBe(true);
    written.length = 0;
    tick(1500);
    // Fruit by fruit.
    const reds = new Set(treeLayer().state.liveCrops.map(red));
    expect(reds.size).toBeGreaterThan(3);
    expect(Math.min(...reds)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...reds)).toBeLessThanOrEqual(240);
    expect(Math.min(...reds)).toBeLessThan(Math.max(...reds));
    expect(treeLayer().state.liveCrops[0] === crop).toBe(true);
    expect(new Set(written.flatMap(entry => entry.attributes))).toEqual(
      new Set(['instanceColors'])
    );
    expect(written.every(entry => entry.layer.includes('crops'))).toBe(true);
    tick(2100);
    expect(treeLayer().state.liveCrops.every(row => red(row) === 240)).toBe(true);
  });

  it('crossfades a change of crop kind, with both kinds on the tree until the old one has gone', () => {
    const {render, tick, treeLayer} = scene();
    const make = (kind: 'fruit' | 'lemon') => ({
      ...NOTHING_ELSE,
      data: [tree('oak')],
      getCrop: () => ({kind, color: [240, 140, 20, 255], count: 20, radius: 0.04}),
      transitions: {getCrop: 1000},
      updateTriggers: {getCrop: kind}
    });
    const kinds = () => new Set(treeLayer().state.liveCrops.map(row => row.kind));
    render(make('fruit'));
    expect(kinds()).toEqual(new Set(['fruit']));
    render(make('lemon'));
    tick(1500);
    expect(kinds()).toEqual(new Set(['fruit', 'lemon']));
    tick(2100);
    expect(kinds()).toEqual(new Set(['lemon']));
  });

  it('holds a bare season until a tween on its foliage has finished', () => {
    const {render, tick, treeLayer, find} = scene();
    const make = (season: 'summer' | 'winter') => ({
      ...NOTHING_ELSE,
      data: [tree('oak', {season})],
      getTree: (row: TreeSpec) => row,
      transitions: {getTree: 1000}
    });
    render(make('summer'));
    render(make('winter'));
    tick(1500);
    expect([...treeLayer().state.groups.keys()]).toEqual(['oak-foliage-3']);
    expect(find('canopy-oak')).toBeTruthy();
    expect(treeLayer().state.standardRows[0].canopyCoverage).toBeCloseTo(0.5, 9);
    tick(2100);
    expect([...treeLayer().state.groups.keys()]).toEqual(['oak-winter-3']);
    expect(find('canopy-oak')).toBeUndefined();
  });

  it('keeps the tree it was as a tween takes it elsewhere', () => {
    const {render, tick, treeLayer, find} = scene();
    const make = (x: number) => ({
      ...NOTHING_ELSE,
      data: [tree('oak', {position: [x, 0, 0]})],
      getTree: (row: TreeSpec) => row,
      transitions: {getPosition: 1000}
    });
    render(make(0));
    const {orientation, seed} = treeLayer().state.standardRows[0];
    const scale = [...treeLayer().state.standardRows[0].scale];
    const [[key]] = [...find<SplatLayer>('canopy-oak').state.refinement.entries.entries()];
    render(make(1e-4));
    tick(1500);
    const row = treeLayer().state.standardRows[0];
    expect(row.position[0]).toBeCloseTo(0.5e-4, 12);
    expect(row.orientation).toEqual(orientation);
    expect(row.seed).toBe(seed);
    expect(row.scale).toEqual(scale);
    expect([...find<SplatLayer>('canopy-oak').state.refinement.entries.keys()]).toEqual([key]);
    const attribute =
      find<TreeMeshLayer<unknown>>('-wood-oak-foliage-3-').getAttributeManager()!.attributes
        .instancePositions;
    expect(attribute).toBeTruthy();
  });

  it('tweens a tree that takes its own wind under getTree', () => {
    const {render, tick, treeLayer, find} = scene();
    const make = (wind: number) => ({
      ...NOTHING_ELSE,
      windStrength: 0.5,
      data: [tree('oak', {wind}), tree('oak', {position: [1e-4, 0, 0], wind: 0.5})],
      getTree: (row: TreeSpec) => row,
      transitions: {getTree: 1000}
    });
    render(make(0.5));
    render(make(0.25));
    tick(1500);
    const row = treeLayer().state.standardRows[0];
    expect(row.windFlex).toBeCloseTo(0.75, 9);
    expect(find<TreeWoodLayer>('wood-oak').props.getWind(row, INFO)[2]).toBeCloseTo(0.75, 9);
    tick(2100);
    expect(treeLayer().state.standardRows[0].windFlex).toBeCloseTo(0.5, 9);
  });

  it('jumps to the accessors when transitions are taken away mid-tween', () => {
    const {render, tick, treeLayer} = scene();
    const data = [tree('oak')];
    const make = (growth: number, transitions: unknown) => ({
      ...NOTHING_ELSE,
      data,
      getGrowth: () => growth,
      transitions,
      updateTriggers: {getGrowth: growth}
    });
    render(make(0.2, {getGrowth: 1000}));
    render(make(0.8, {getGrowth: 1000}));
    tick(1500);
    const row = treeLayer().state.standardRows[0];
    render(make(0.8, null));
    expect(treeLayer().state.store).toBe(null);
    expect(treeLayer().state.standardRows[0] === row).toBe(true);
    expect(row.height).toBeCloseTo(firstRow(prepare(tree('oak', {growth: 0.8}))).height, 9);
    expect(row.resolvedColors).toBe(false);
  });

  it('takes a new row from enter, and leaves those there are in place', () => {
    const {render, tick, treeLayer} = scene();
    const one = tree('oak');
    const two = tree('oak', {position: [1e-4, 0, 0]});
    const make = (data: TreeSpec[]) => ({
      ...NOTHING_ELSE,
      data,
      getTree: (row: TreeSpec) => row,
      transitions: {getGrowth: {duration: 1000, enter: () => [0]}}
    });
    render(make([one]));
    tick(2000);
    render(make([one, two]));
    tick(2500);
    const [first, second] = treeLayer().state.standardRows;
    expect(first.height).toBe(firstRow(prepare(one)).height);
    expect(second.height).toBeCloseTo(first.height * getTreeHeightFraction(0.5), 9);
  });
});

describe('TreeLayer without an active change on the standard pipeline', () => {
  it('rewrites nothing on a re-render, with transitions or without', () => {
    for (const transitions of [null, {getTree: 1000}]) {
      const {render, written} = scene();
      const data = [
        tree('oak', {crop: {color: [240, 140, 20, 255], count: 4, droppedCount: 2, radius: 0.04}}),
        tree('pine', {position: [1e-4, 0, 0]})
      ];
      const make = (windTime: number) => ({
        data,
        getTree: (row: TreeSpec) => row,
        maxCanopySplats: 0,
        transitions,
        windTime
      });
      for (let frame = 0; frame < 4; frame++) render(make(0));
      expect(written.length).toBeGreaterThan(0);
      written.length = 0;
      for (const windTime of [1, 2, 3]) render(make(windTime));
      expect(written).toEqual([]);
    }
  });

  it('rewrites nothing for a trigger that changes no value', () => {
    const {render, written} = scene();
    const data = [tree('oak')];
    const make = (frame: number) => ({
      ...NOTHING_ELSE,
      data,
      getTree: (row: TreeSpec) => row,
      updateTriggers: {getTree: frame}
    });
    for (let frame = 0; frame < 3; frame++) render(make(frame));
    written.length = 0;
    for (let frame = 3; frame < 6; frame++) render(make(frame));
    expect(written).toEqual([]);
  });

  it('animates through update triggers with no transitions either', () => {
    const {render, treeLayer, written, find} = scene();
    const data = [tree('oak')];
    const make = (decay: number, health: number) => ({
      ...NOTHING_ELSE,
      data,
      getDecay: () => decay,
      getHealth: () => health,
      updateTriggers: {getDecay: decay, getHealth: health}
    });
    render(make(0, 1));
    const row = treeLayer().state.standardRows[0];
    const woodData = find<TreeWoodLayer>('wood-oak').props.data;
    written.length = 0;
    render(make(0, 0.5));
    expect(treeLayer().state.standardRows[0] === row).toBe(true);
    expect(new Set(written.flatMap(entry => entry.attributes))).toEqual(
      new Set(['instanceColors'])
    );
    expect(written.every(entry => entry.layer.includes('canopy'))).toBe(true);
    written.length = 0;
    render(make(0.3, 0.5));
    expect(treeLayer().state.standardRows[0] === row).toBe(true);
    expect(find<TreeWoodLayer>('wood-oak').props.data === woodData).toBe(true);
    expect(written.flatMap(entry => entry.attributes)).toEqual(
      expect.arrayContaining(['instanceModelMatrix', 'instanceColors'])
    );
    expect(row.height).toBeLessThan(firstRow(prepare(tree('oak'))).height);
  });

  it('gives new rows to sub-layers that read accessors for themselves, as a change of rows always has', () => {
    const {render, treeLayer, written} = scene();
    const data = [tree('oak')];
    let color = [10, 20, 30, 255];
    const make = (height: number) => ({
      ...NOTHING_ELSE,
      data,
      getHeight: () => height,
      getCanopyColor: () => color,
      updateTriggers: {getHeight: height}
    });
    render(make(10));
    const row = treeLayer().state.standardRows[0];
    color = [200, 20, 30, 255];
    written.length = 0;
    render(make(12));
    expect(treeLayer().state.standardRows[0] === row).toBe(false);
    expect(written.flatMap(entry => entry.attributes)).toContain('instanceColors');
    expect(Object.values(treeLayer().state.revisions).every(revision => revision === 0)).toBe(true);
  });

  it('picks the source object it was last given on the rows it keeps', () => {
    const {render, treeLayer} = scene();
    const crop = {color: [240, 140, 20, 255], count: 4, droppedCount: 2, radius: 0.04} as const;
    const data = [tree('oak', {crop})];
    const make = (frame: number) => ({
      ...NOTHING_ELSE,
      data,
      getTree: (row: TreeSpec) => row,
      updateTriggers: {getTree: frame}
    });
    render(make(0));
    const {standardRows, liveCrops, droppedCrops} = treeLayer().state;
    const [row] = standardRows;
    // The same array, a new tree object in it, and an update trigger to say so.
    data[0] = {...data[0], height: 13};
    render(make(1));
    expect(treeLayer().state.standardRows[0] === row).toBe(true);
    for (const object of [row, liveCrops[0], droppedCrops[0]]) {
      const info = treeLayer().getPickingInfo({info: {object, index: 0}} as never);
      expect(info.object === data[0]).toBe(true);
    }
  });

  it('regroups when a tree changes what it is', () => {
    const {render, treeLayer} = scene();
    const make = (species: TreeType, frame: number) => ({
      ...NOTHING_ELSE,
      data: [tree(species)],
      getTree: (row: TreeSpec) => row,
      updateTriggers: {getTree: frame}
    });
    render(make('oak', 0));
    const {groups} = treeLayer().state;
    render(make('birch', 1));
    expect(treeLayer().state.groups === groups).toBe(false);
    expect([...treeLayer().state.groups.keys()]).toEqual(['birch-foliage-3']);
  });

  it('regroups when a growing tree gets its crown', () => {
    const {render, tick, treeLayer, find} = scene();
    const make = (growth: number) => ({
      ...NOTHING_ELSE,
      data: [tree('oak')],
      getGrowth: () => growth,
      transitions: {getGrowth: 1000},
      updateTriggers: {getGrowth: growth}
    });
    render(make(0));
    expect(find('wood-oak')).toBeUndefined();
    expect(treeLayer().state.woodGroups.get('oak-foliage-3')).toEqual([]);
    render(make(1));
    tick(1500);
    expect(treeLayer().state.woodGroups.get('oak-foliage-3')).toHaveLength(1);
    expect(find('wood-oak')).toBeTruthy();
  });
});

describe('TreeWoodLayer under update triggers', () => {
  it('sends every row its new values when near and far change in the same update', () => {
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
    const layer = new TreeWoodLayer({id: 'wood', data: [row]});
    layer.initializeState();
    Object.assign(layer.state, {near: [row], far: [row]});
    expect(layer.renderLayers()[0].props._dataDiff).toBe(getSplatChangedRanges);
    Object.assign(layer.state, {triggersChanged: true});
    // deck.gl drops the triggers of an update whose data diff has ranges.
    expect(layer.renderLayers()[0].props._dataDiff).not.toBe(getSplatChangedRanges);
  });
});
