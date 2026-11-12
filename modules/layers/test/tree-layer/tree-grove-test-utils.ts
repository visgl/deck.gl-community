// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TreeLayer, TreeSpec} from '../../src';

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
