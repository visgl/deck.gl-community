// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_Tileset2D, type _TileLoadProps} from '@deck.gl/geo-layers';
type Index = _TileLoadProps['index'];
type Node = {index: Index; children: Map<string, Node>};
/** Bound the geographic request frontier without lowering nearby-tree refinement.
 * Requests remain internal: the renderer displays trees and three-dimensional crowns only.
 */
export class TreeTileset extends _Tileset2D {
  private retainedSplits = new Set<string>();
  getTileIndices(options: Parameters<_Tileset2D['getTileIndices']>[0]): Index[] {
    const limit = (this.opts as typeof this.opts & {maxVisibleTiles: number}).maxVisibleTiles;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error('maxVisibleTiles must be a positive finite integer.');
    const desired = super.getTileIndices(options);
    if (desired.length <= limit) {
      this.rememberSplits(desired);
      return desired;
    }
    const minimum = options.minZoom ?? 0;
    const roots = new Map<string, Node>();
    for (const index of desired) {
      let siblings = roots;
      for (let z = Math.min(minimum, index.z); z <= index.z; z++) {
        const span = 2 ** (index.z - z),
          x = Math.floor(index.x / span),
          y = Math.floor(index.y / span);
        const key = `${x}/${y}/${z}`;
        let node = siblings.get(key);
        if (!node) {
          node = {index: {x, y, z}, children: new Map()};
          siblings.set(key, node);
        }
        siblings = node.children;
      }
    }
    const frontier = [...roots.values()];
    if (frontier.length > limit)
      throw new Error('Tree source minZoom prevents a bounded frontier; provide coarser coverage.');
    const camera = options.viewport.cameraPosition;
    const priority = ({index: {x, y, z}}: Node) => {
      const extent = 512 / 2 ** z,
        left = x * extent,
        bottom = 512 - (y + 1) * extent;
      const dx = Math.max(left - camera[0], 0, camera[0] - left - extent);
      const dy = Math.max(bottom - camera[1], 0, camera[1] - bottom - extent);
      const dz = Math.abs(camera[2]);
      return (
        (extent / Math.max(1e-12, Math.hypot(dx, dy, dz))) *
        (this.retainedSplits.has(`${x}/${y}/${z}`) ? 1.2 : 1)
      );
    };
    // Refine the largest projected footprints first. One-child paths cost no extra requests.
    while (true) {
      let best = -1,
        score = -Infinity;
      for (let i = 0; i < frontier.length; i++) {
        const node = frontier[i];
        if (!node.children.size || frontier.length + node.children.size - 1 > limit) continue;
        const value = priority(node);
        if (value > score) {
          score = value;
          best = i;
        }
      }
      if (best < 0) break;
      frontier.splice(best, 1, ...frontier[best].children.values());
    }
    const indices = frontier.map(node => node.index);
    this.rememberSplits(indices);
    return indices;
  }
  private rememberSplits(indices: Index[]) {
    this.retainedSplits.clear();
    for (const index of indices)
      for (let z = 0; z < index.z; z++) {
        const span = 2 ** (index.z - z);
        this.retainedSplits.add(`${Math.floor(index.x / span)}/${Math.floor(index.y / span)}/${z}`);
      }
  }
}
