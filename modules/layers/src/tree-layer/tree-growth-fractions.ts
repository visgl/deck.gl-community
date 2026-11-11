// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Fraction of mature height a tree has reached at growth g. */
export function getTreeHeightFraction(growth: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, growth)), 1.6);
}

/** Fraction of mature crown radius a tree has reached at growth g. */
export function getTreeCrownFraction(growth: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, growth)), 1.9);
}

/** Inverse of `getTreeHeightFraction`: the growth at which a tree reaches fraction z of its height. */
export function getTreeGrowthAtHeight(heightFraction: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, heightFraction)), 1 / 1.6);
}
