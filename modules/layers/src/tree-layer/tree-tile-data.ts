// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Color, Position} from '@deck.gl/core';

/** Source-built 3D canopy approximations for trees too small to resolve individually. */
export type TreeCanopyCluster = {
  /** Geographic cluster centre at canopy base elevation. */
  position: Position;
  /** Horizontal covariance footprint and vertical crown height in metres. */
  scale: [number, number, number];
  /** Canopy tint and effective foliage coverage. */
  color: Color;
  /** Represented tree count; metadata never expands into client rows. */
  treeCount: number;
};
/** Bounded decoded geographic page. All visual representations are 3D crowns or individual trees. */
export type TreeTileData<DataT = unknown> = {
  /** Total decoded payload bytes, including nested data and retained buffers. */
  byteLength: number;
  /** Individual tree rows resolvable at this source level. */
  trees: DataT[];
  /** Distant Gaussian crown groups, never ground polygons. */
  canopies: TreeCanopyCluster[];
};

export function validateTreeTile<DataT>(data: TreeTileData<DataT>, records: number, bytes: number) {
  if (!data || !Array.isArray(data.trees) || !Array.isArray(data.canopies))
    throw new Error('Tree pages must contain trees and canopies arrays.');
  if (!Number.isSafeInteger(data.byteLength) || data.byteLength < 0 || data.byteLength > bytes)
    throw new Error('Tree page exceeds the decoded byte limit.');
  if (data.trees.length + data.canopies.length > records)
    throw new Error(
      'Tree page exceeds the record limit; provide a finer page or crown aggregates.'
    );
  for (const canopy of data.canopies) {
    if (
      !Number.isSafeInteger(canopy.treeCount) ||
      canopy.treeCount < 0 ||
      canopy.position.length < 2 ||
      canopy.position.some(value => !Number.isFinite(value)) ||
      canopy.color.length < 3 ||
      canopy.color.length > 4 ||
      canopy.color.some(value => !Number.isFinite(value) || value < 0 || value > 255) ||
      canopy.scale.length !== 3 ||
      canopy.scale.some(value => !Number.isFinite(value) || value <= 0)
    )
      throw new Error(
        'Canopy aggregates need finite positions, positive covariance extents and integer counts.'
      );
  }
  return data;
}
