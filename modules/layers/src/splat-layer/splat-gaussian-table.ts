// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {SplatSource} from './splat-source';

/** Spherical harmonic band 0 basis constant, `1 / (2 * sqrt(pi))`. */
const SH_C0 = 0.28209479177387814;

/** The part of an Arrow vector chunk that a fixed-size list column is read through. */
type GaussianListChunk = {
  offset: number;
  length: number;
  children: {values: ArrayLike<number>; offset: number}[];
};

/** The part of an Arrow vector that the adapter reads. */
type GaussianColumn = {
  toArray(): ArrayLike<number>;
  data?: GaussianListChunk[];
};

/**
 * A decoded Gaussian splat table, as `@loaders.gl/splats` loaders (`SPZLoader`, `SPLATLoader`,
 * `KSPLATLoader`) return it: a loaders.gl Mesh Arrow table whose schema metadata marks it
 * `gaussian-splats`, with `POSITION`, `f_dc_0..2`, linear `opacity`, linear `scale_0..2` and
 * WXYZ `rot_0..3` columns. Typed structurally, so the layer takes no loaders.gl or Arrow
 * runtime dependency.
 */
export type GaussianSplatsTable = {
  shape: 'arrow-table';
  schema?: {metadata?: Record<string, string>};
  data: {numRows: number; getChild(name: string): GaussianColumn | null};
};

const SOURCES = new WeakMap<GaussianSplatsTable, SplatSource>();

/** True for a loaders.gl Mesh Arrow table that carries Gaussian splats. */
export function isGaussianSplatsTable(input: unknown): input is GaussianSplatsTable {
  const table = input as Partial<GaussianSplatsTable> | null;
  return Boolean(
    table &&
      typeof table === 'object' &&
      table.shape === 'arrow-table' &&
      table.schema?.metadata?.['loaders_gl.semantic_type'] === 'gaussian-splats' &&
      typeof table.data?.getChild === 'function'
  );
}

/**
 * Convert a decoded Gaussian splat table into the layer's prepared source columns. Colours come
 * from the spherical harmonic DC terms (higher bands are not rendered); opacities are clamped to
 * the prepared range. The conversion runs once per table, so a table keeps one asset identity.
 */
export function getSplatSourceFromGaussianSplatsTable(table: GaussianSplatsTable): SplatSource {
  const cached = SOURCES.get(table);
  if (cached) return cached;
  const count = table.data.numRows;
  const column = (name: string): ArrayLike<number> => {
    const values = getColumn(table, name).toArray();
    if (values.length !== count)
      throw new Error(`Gaussian splat column ${name} has ${values.length} values, not ${count}.`);
    return values;
  };

  const positions = readFixedSizeList(getColumn(table, 'POSITION'), 3, count);
  const dc = [column('f_dc_0'), column('f_dc_1'), column('f_dc_2')];
  const alpha = column('opacity');
  const scale = [column('scale_0'), column('scale_1'), column('scale_2')];
  const rot = [column('rot_0'), column('rot_1'), column('rot_2'), column('rot_3')];

  const scales = new Float32Array(count * 3);
  const rotations = new Float32Array(count * 4);
  const colors = new Uint8Array(count * 4);
  const opacities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    for (let axis = 0; axis < 3; axis++) {
      scales[i * 3 + axis] = scale[axis][i];
      colors[i * 4 + axis] = Math.round(255 * Math.min(1, Math.max(0, 0.5 + SH_C0 * dc[axis][i])));
    }
    colors[i * 4 + 3] = 255;
    const length = Math.hypot(rot[0][i], rot[1][i], rot[2][i], rot[3][i]) || 1;
    for (let component = 0; component < 4; component++)
      rotations[i * 4 + component] = rot[component][i] / length;
    opacities[i] = Math.min(1, Math.max(0, alpha[i]));
  }

  const source = {positions, scales, rotations, colors, opacities};
  SOURCES.set(table, source);
  return source;
}

function getColumn(table: GaussianSplatsTable, name: string): GaussianColumn {
  const vector = table.data.getChild(name);
  if (!vector) throw new Error(`Gaussian splat table is missing its ${name} column.`);
  return vector;
}

/** Flatten a fixed-size list column (one or more Arrow chunks) into interleaved floats. */
function readFixedSizeList(vector: GaussianColumn, size: number, count: number): Float32Array {
  const out = new Float32Array(count * size);
  let written = 0;
  for (const chunk of vector.data ?? []) {
    const child = chunk.children[0];
    // the child's offset counts child values; the chunk's counts list rows
    const start = child.offset + chunk.offset * size;
    for (let i = 0; i < chunk.length * size; i++) out[written + i] = child.values[start + i];
    written += chunk.length * size;
  }
  if (written !== count * size)
    throw new Error(`Gaussian splat POSITION has ${written / size} rows, not ${count}.`);
  return out;
}
