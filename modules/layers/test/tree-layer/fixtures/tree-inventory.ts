// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {_TileLoadProps} from '@deck.gl/geo-layers';
import type {TreeTileData} from '../../../src/tree-layer/tree-tile-data';

export const TEST_LEAF_ZOOM = 20;
export type TestTree = {
  key: string;
  position: [number, number];
  species: 'oak';
  height: number;
  canopyRadius: number;
  trunkRadius: number;
};
/** Small independent source fixture. No dependency on demo distribution or global cardinality. */
export function getTestTreeTile(tile: _TileLoadProps, count = 4): TreeTileData<TestTree> {
  if (tile.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const {x, y, z} = tile.index;
  const n = 2 ** z;
  const position = (dx: number, dy: number): [number, number] => [
    ((x + dx) / n) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + dy)) / n))) * 180) / Math.PI
  ];
  if (z < 15)
    return {
      byteLength: 128,
      trees: [],
      canopies: [
        {
          position: position(0.5, 0.5),
          scale: [40075000 / n, 40075000 / n, 20],
          color: [30, 120, 40],
          treeCount: count
        }
      ]
    };
  return {
    byteLength: count * 128,
    canopies: [],
    trees: Array.from({length: count}, (_, index) => ({
      key: `${x}/${y}/${z}/${index}`,
      position: position(0.2 + (index % 4) * 0.18, 0.25 + Math.floor(index / 4) * 0.4),
      species: 'oak',
      height: 12,
      canopyRadius: 7,
      trunkRadius: 0.3
    }))
  };
}
