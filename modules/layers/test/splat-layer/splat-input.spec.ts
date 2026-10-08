// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {expect, it, vi} from 'vitest';
import {
  DEFAULT_GET_SOURCE,
  resolveSplatAsset,
  resolveSplatInput
} from '../../src/splat-layer/splat-input';
import {getSplatTransform, getSplatTransformScale} from '../../src/splat-layer/splat-transform';
const source = {
  positions: new Float32Array([0, 0, 0]),
  scales: new Float32Array([1, 2, 3]),
  rotations: new Float32Array([1, 0, 0, 0]),
  colors: new Uint8Array([30, 120, 40, 255]),
  opacities: new Float32Array([0.8])
};

it('normalizes direct assets to one stable implicit owner and retains source identity', () => {
  const a = resolveSplatInput({data: source, getSource: DEFAULT_GET_SOURCE});
  const b = resolveSplatInput({data: source, getSource: DEFAULT_GET_SOURCE});
  expect(a.data).toBe(b.data);
  expect(a.data).toEqual([{splats: source, position: [0, 0, 0]}]);
  expect(a.assets[0]).toBe(b.assets[0]);
  expect(a.assets[0].source).toBe(source);
});

it('shares a constant template and resolves heterogeneous rows with original indices and data', () => {
  const second = {...source, colors: new Uint8Array([200, 20, 50, 255])};
  const data = [{splats: source}, {splats: second}, {splats: source}];
  const getSource = vi.fn((row, info) => {
    expect(info.data).toBe(data);
    expect(data[info.index]).toBe(row);
    return row.splats;
  });
  const result = resolveSplatInput({data, getSource});
  expect(result.data).toBe(data);
  expect(result.assets).toHaveLength(2);
  expect(result.rowAssets[0]).toBe(result.rowAssets[2]);
  expect(getSource).toHaveBeenCalledTimes(3);
  expect(resolveSplatInput({data, getSource: source}).assets).toHaveLength(1);
  expect(resolveSplatInput({data, getSource: DEFAULT_GET_SOURCE}).rowAssets).toEqual(
    result.rowAssets
  );
});

it('retains authored hierarchies without treating them as RAD hierarchy metadata', () => {
  const coarse = {...source, scales: new Float32Array([4, 4, 4])};
  const hierarchy = [
    {source, error: 0},
    {source: coarse, error: 2}
  ];
  const asset = resolveSplatAsset({type: 'prepared-splats', source, hierarchy});
  expect(asset.hierarchy).toBe(hierarchy);
  expect(resolveSplatAsset({type: 'prepared-splats', source, hierarchy})).toBe(asset);
  expect(() =>
    resolveSplatAsset({type: 'prepared-splats', source, hierarchy: [{source: coarse, error: 0}]})
  ).toThrow('start with source');
});

it('rejects conflicting channels, missing assets and unsupported scene inputs explicitly', () => {
  expect(() =>
    resolveSplatInput({data: [{position: [0, 0, 0]}], getSource: DEFAULT_GET_SOURCE})
  ).toThrow('prepared Gaussian asset');
  expect(() => resolveSplatInput({data: source, source, getSource: DEFAULT_GET_SOURCE})).toThrow(
    'cannot be combined'
  );
  expect(() => resolveSplatInput({data: [], source, getSource: source})).toThrow(
    'cannot be combined'
  );
  expect(() =>
    resolveSplatInput({data: [], hierarchy: [{source, error: 0}], getSource: source})
  ).toThrow('Put a hierarchy');
  expect(() =>
    resolveSplatInput({data: '/scene.rad' as any, getSource: DEFAULT_GET_SOURCE})
  ).toThrow('prepared asset');
  expect(resolveSplatInput({data: [], source, getSource: DEFAULT_GET_SOURCE}).data).toEqual([]);
});

it('gives affine matrices precedence and bounds shear without decomposing covariance', () => {
  const matrix = [1, 0, 0, 0, 4, 2, 0, 0, 0, 0, -3, 0, 10, 20, 30, 1];
  expect(getSplatTransform([90, 90, 90], [9, 9, 9], [1, 2, 3], matrix)).toEqual([
    1, 0, 0, 4, 2, 0, 0, 0, -3, 10, 20, 30
  ]);
  expect(getSplatTransformScale(matrix)).toBeGreaterThanOrEqual(Math.hypot(4, 2));
  expect(() => getSplatTransform([], [], [], [...matrix.slice(0, 15), 0])).toThrow('affine');
});
