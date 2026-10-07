// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Same pitch/yaw/roll convention as SimpleMeshLayer, with translation in the last three entries. */
export function getSplatTransform(
  orientation: number[],
  scale: number[],
  translation: number[],
  matrix?: ArrayLike<number> | null
): number[] {
  if (matrix) {
    if (
      matrix.length !== 16 ||
      Array.from(matrix).some(value => !Number.isFinite(value)) ||
      matrix[3] !== 0 ||
      matrix[7] !== 0 ||
      matrix[11] !== 0 ||
      matrix[15] !== 1
    )
      throw new Error('Splat instance transforms must be finite affine 4x4 matrices.');
    return [
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[4],
      matrix[5],
      matrix[6],
      matrix[8],
      matrix[9],
      matrix[10],
      matrix[12],
      matrix[13],
      matrix[14]
    ];
  }
  const [pitch, yaw, roll] = orientation.map(value => (value * Math.PI) / 180);
  const [sp, sw, sr] = [pitch, yaw, roll].map(Math.sin);
  const [cp, cw, cr] = [pitch, yaw, roll].map(Math.cos);
  return [
    scale[0] * cw * cp,
    scale[0] * sw * cp,
    -scale[0] * sp,
    scale[1] * (-sw * cr + cw * sp * sr),
    scale[1] * (cw * cr + sw * sp * sr),
    scale[1] * cp * sr,
    scale[2] * (sw * sr + cw * sp * cr),
    scale[2] * (-cw * sr + sw * sp * cr),
    scale[2] * cp * cr,
    ...translation
  ];
}

/** Conservative affine stretch bound, including shear and reflection. */
export function getSplatTransformScale(matrix: ArrayLike<number>): number {
  const column = Math.max(
    ...[0, 4, 8].map(i => Math.abs(matrix[i]) + Math.abs(matrix[i + 1]) + Math.abs(matrix[i + 2]))
  );
  const row = Math.max(
    ...[0, 1, 2].map(i => Math.abs(matrix[i]) + Math.abs(matrix[i + 4]) + Math.abs(matrix[i + 8]))
  );
  return Math.sqrt(column * row);
}
