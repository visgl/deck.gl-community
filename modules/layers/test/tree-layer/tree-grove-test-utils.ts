// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import type {TreeLayer, TreeSpec} from '../../src';

const ORIGIN = [-81.7, 28.1];
const ORIGIN_VIEWPORT = new WebMercatorViewport({
  width: 1,
  height: 1,
  longitude: ORIGIN[0],
  latitude: ORIGIN[1]
});
export const getOrchardLngLat = (east: number, north: number) =>
  ORIGIN_VIEWPORT.addMetersToLngLat(ORIGIN, [east, north]);
export function createOrchard(rows: number, treesPerRow: number): TreeSpec[] {
  const trees: TreeSpec[] = [];
  for (let row = 0; row < rows; row++)
    for (let tree = 0; tree < treesPerRow; tree++) {
      const [longitude, latitude] = getOrchardLngLat(
        (tree - (treesPerRow - 1) / 2) * 4.5,
        (row - (rows - 1) / 2) * 7
      );
      trees.push({
        position: [longitude, latitude, 0],
        species: 'citrus',
        height: 3,
        crownRadius: 2.25,
        wind: false
      });
    }
  return trees;
}

/** Read the scheduled color tier for each distinct source owner. */
export function getTreeRenderTiers(layer?: TreeLayer<TreeSpec>): Map<TreeSpec, number> {
  const tiers = new Map<TreeSpec, number>();
  for (const group of layer?.state.photoreal?.groups.values() ?? []) {
    for (const [tier, rows] of group.buckets.entries()) {
      for (const row of rows) {
        if (row?.object && !tiers.has(row.object)) tiers.set(row.object, tier);
      }
    }
  }
  return tiers;
}
