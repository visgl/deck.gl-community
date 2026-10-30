// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {SPLATLoader} from '@loaders.gl/splats';
import {expect, it} from 'vitest';
import {
  getSplatSourceFromGaussianSplatsTable,
  isGaussianSplatsTable
} from '../../src/splat-layer/splat-gaussian-table';
import {
  DEFAULT_GET_SOURCE,
  isSplatDataInput,
  resolveSplatInput
} from '../../src/splat-layer/splat-input';
import {validateSplatSource} from '../../src/splat-layer/splat-source';

/** Two splats in the uncompressed antimatter15 `.splat` layout (32 bytes each). */
function makeSplatFile(): ArrayBuffer {
  const rows = [
    {
      position: [1, 2, 3],
      scale: [0.1, 0.2, 0.3],
      rgba: [255, 128, 0, 255],
      rot: [255, 128, 128, 128]
    },
    {position: [-1, 0, 5], scale: [1, 1, 1], rgba: [0, 0, 255, 128], rot: [128, 255, 128, 128]}
  ];
  const buffer = new ArrayBuffer(rows.length * 32);
  const view = new DataView(buffer);
  rows.forEach((row, i) => {
    const offset = i * 32;
    row.position.forEach((v, k) => view.setFloat32(offset + k * 4, v, true));
    row.scale.forEach((v, k) => view.setFloat32(offset + 12 + k * 4, v, true));
    row.rgba.forEach((v, k) => view.setUint8(offset + 24 + k, v));
    row.rot.forEach((v, k) => view.setUint8(offset + 28 + k, v));
  });
  return buffer;
}

async function loadTable() {
  return SPLATLoader.parse(makeSplatFile());
}

it('converts a decoded @loaders.gl/splats table into prepared source columns', async () => {
  const table = await loadTable();
  expect(isGaussianSplatsTable(table)).toBe(true);
  const source = getSplatSourceFromGaussianSplatsTable(table);

  expect(validateSplatSource(source)).toBe(2);
  expect(Array.from(source.positions)).toEqual([1, 2, 3, -1, 0, 5]);
  expect(Array.from(source.scales)).toEqual(Array.from(new Float32Array([0.1, 0.2, 0.3, 1, 1, 1])));
  expect(Array.from(source.rotations)).toEqual([1, 0, 0, 0, 0, 1, 0, 0]);
  // colours round-trip through the table's SH DC terms; alpha lives in the opacities
  expect(Array.from(source.colors)).toEqual([255, 128, 0, 255, 0, 0, 255, 255]);
  expect(source.opacities[0]).toBeCloseTo(1);
  expect(source.opacities[1]).toBeCloseTo(128 / 255);
  // one conversion per table: the same table keeps one source identity
  expect(getSplatSourceFromGaussianSplatsTable(table)).toBe(source);
});

it('resolves a table as direct data and as instance rows', async () => {
  const table = await loadTable();
  expect(isSplatDataInput(table)).toBe(true);

  const direct = resolveSplatInput({data: table, getSource: DEFAULT_GET_SOURCE});
  expect(direct.data).toEqual([{splats: table, position: [0, 0, 0]}]);
  expect(direct.assets[0].source).toBe(getSplatSourceFromGaussianSplatsTable(table));
  expect(resolveSplatInput({data: table, getSource: DEFAULT_GET_SOURCE}).assets[0]).toBe(
    direct.assets[0]
  );

  const rows = [{splats: table}, {splats: table}];
  const resolved = resolveSplatInput({data: rows, getSource: DEFAULT_GET_SOURCE});
  expect(resolved.assets).toHaveLength(1);
  expect(resolved.rowAssets[0]).toBe(resolved.rowAssets[1]);
  expect(resolved.assets[0]).toBe(direct.assets[0]);
});

it('rejects Arrow tables that do not carry Gaussian splats', async () => {
  const table = await loadTable();
  const plain = {...table, schema: {...table.schema, metadata: {}}};
  expect(isGaussianSplatsTable(plain)).toBe(false);
  expect(() => resolveSplatInput({data: [{splats: plain}], getSource: DEFAULT_GET_SOURCE})).toThrow(
    '@loaders.gl/splats'
  );
});
