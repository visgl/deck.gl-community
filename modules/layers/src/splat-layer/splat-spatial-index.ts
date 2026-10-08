// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createSplatFrustum, intersectsSplatFrustum} from './splat-culling';
import type {SplatShadowProjection} from './splat-shadow-pass';

export type SplatSpatialEntry<T> = {center: number[]; radius: number; value: T};
export type SplatSpatialNode<T> = {
  center: number[];
  radius: number;
  children?: SplatSpatialNode<T>[];
  entries?: SplatSpatialEntry<T>[];
};

/** Persistent owner BVH. Bounds include Gaussian support, translation and maximum wind excursion. */
export function createSplatSpatialIndex<T>(
  entries: SplatSpatialEntry<T>[]
): SplatSpatialNode<T> | null {
  if (!entries.length) return null;
  const build = (items: SplatSpatialEntry<T>[]): SplatSpatialNode<T> => {
    const minimum = [Infinity, Infinity, Infinity],
      maximum = [-Infinity, -Infinity, -Infinity];
    for (const item of items)
      for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], item.center[axis] - item.radius);
        maximum[axis] = Math.max(maximum[axis], item.center[axis] + item.radius);
      }
    const center = minimum.map((value, axis) => (value + maximum[axis]) / 2);
    const radius = Math.hypot(...maximum.map((value, axis) => value - center[axis]));
    if (items.length <= 32) return {center, radius, entries: items};
    const extent = maximum.map((value, axis) => value - minimum[axis]);
    const axis = extent.indexOf(Math.max(...extent));
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const middle = Math.floor(items.length / 2);
    return {center, radius, children: [build(items.slice(0, middle)), build(items.slice(middle))]};
  };
  return build([...entries]);
}

/** Visit visible branches of the BVH, then test each surviving owner's bounds. */
export function querySplatSpatialIndex<T>(
  root: SplatSpatialNode<T> | null,
  projections: readonly SplatShadowProjection[]
): T[] {
  const visible: T[] = [];
  const frusta = projections.map(createSplatFrustum);
  const intersects = (entry: {center: number[]; radius: number}) =>
    frusta.some(frustum => intersectsSplatFrustum(entry.center, entry.radius, frustum));
  const visit = (node: SplatSpatialNode<T>) => {
    if (!intersects(node)) return;
    if (node.children) for (const child of node.children) visit(child);
    else for (const entry of node.entries!) if (intersects(entry)) visible.push(entry.value);
  };
  if (root) visit(root);
  return visible;
}
