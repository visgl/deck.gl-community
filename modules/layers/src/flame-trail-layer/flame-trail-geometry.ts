// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Geometry} from '@luma.gl/engine';

const HORIZONTAL_SLICES = 96;
const VERTICAL_SLICES = 64;
const SEGMENT_POSITIONS = [0, 0, 0, -1, 0, 1, 1, -1, 1, 1, 1, 0];
const SEGMENT_INDICES = [0, 1, 2, 1, 4, 2, 1, 3, 4, 3, 5, 4];

/** Crossed volume slices, instanced using the upstream path/timestamp attributes. */
export function createFlameGeometry(): Geometry {
  const positions: number[] = [];
  const flameSlices: number[] = [];
  const indices: number[] = [];

  for (let slice = 0; slice < HORIZONTAL_SLICES; slice++) {
    const offset = positions.length / 2;
    positions.push(...SEGMENT_POSITIONS);
    for (let vertex = 0; vertex < 6; vertex++) {
      // height, cross-path coordinate, orientation, integration step
      flameSlices.push((slice + 0.5) / HORIZONTAL_SLICES, 0, 0, 1 / HORIZONTAL_SLICES);
    }
    indices.push(...SEGMENT_INDICES.map(index => index + offset));
  }
  for (let slice = 0; slice < VERTICAL_SLICES; slice++) {
    const offset = positions.length / 2;
    positions.push(0, -1, 0, 1, 1, -1, 1, 1);
    for (let vertex = 0; vertex < 4; vertex++) {
      flameSlices.push(
        vertex % 2,
        ((slice + 0.5) / VERTICAL_SLICES) * 2 - 1,
        1,
        1 / VERTICAL_SLICES
      );
    }
    indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
  }
  // A bounded set of GPU ember emitters per segment. Timestamp bins suppress
  // redundant emitters on densely tessellated paths without any CPU resampling.
  for (let ember = 0; ember < 8; ember++) {
    const offset = positions.length / 2;
    positions.push(0, -1, 0, 1, 1, -1, 1, 1);
    for (let vertex = 0; vertex < 4; vertex++) flameSlices.push(ember, 0, 2, 0);
    indices.push(offset, offset + 2, offset + 1, offset + 1, offset + 2, offset + 3);
  }
  return new Geometry({
    topology: 'triangle-list',
    attributes: {
      indices: new Uint16Array(indices),
      positions: {value: new Float32Array(positions), size: 2},
      flameSlices: {value: new Float32Array(flameSlices), size: 4}
    }
  });
}
