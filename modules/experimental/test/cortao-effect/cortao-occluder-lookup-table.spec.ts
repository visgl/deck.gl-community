// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {createOccluderLookupTable} from '../../src';

/** FNV-1a hash of the bytes of a typed array, in little-endian order. */
function hashBytes(data: ArrayBufferView): number {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

describe('createOccluderLookupTable', () => {
  // Hashes of tables/occluder/24x24x16x*_R*_UINT.bin in https://github.com/theagentd/CORTAO
  // at commit 420b168d88dd6f9276077ba62f3711cac9d7b46c.
  it.each([
    [8, 'r8uint', 9216, 0xbf2c0ef6],
    [16, 'r16uint', 18432, 0xb1c6e886],
    [32, 'r32uint', 36864, 0xe4a537cd]
  ] as const)('matches the reference %i-ray table', (rayCount, format, byteLength, hash) => {
    const table = createOccluderLookupTable({rayCount});
    expect(table.format).toBe(format);
    expect(table.directionResolution).toBe(24);
    expect(table.radiusResolution).toBe(16);
    expect(table.data.byteLength).toBe(byteLength);
    expect(hashBytes(table.data)).toBe(hash);
  });

  it('blocks more rays as the occluder radius grows', () => {
    const {data, directionResolution, radiusResolution} = createOccluderLookupTable({
      rayCount: 16
    });
    const sliceSize = directionResolution * directionResolution;
    // The texel at the center of the sphere map points along the normal.
    const centerTexel = (directionResolution / 2) * directionResolution + directionResolution / 2;
    const countBits = (value: number) => value.toString(2).replace(/0/g, '').length;
    const counts = Array.from({length: radiusResolution}, (_, z) =>
      countBits(data[z * sliceSize + centerTexel])
    );
    for (let z = 1; z < radiusResolution; z++) {
      expect(counts[z]).toBeGreaterThanOrEqual(counts[z - 1]);
    }
    expect(counts[radiusResolution - 1]).toBe(16);
  });
});
