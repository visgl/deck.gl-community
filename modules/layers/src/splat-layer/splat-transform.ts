// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Same pitch/yaw/roll convention as SimpleMeshLayer, with translation in the last three entries. */
export function getSplatTransform(
  orientation: number[],
  scale: number[],
  translation: number[]
): number[] {
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
