// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {classifySplatFrustum, createSplatFrustum, intersectsSplatFrustum} from './splat-culling';
import type {SplatProjection} from './splat-culling';
import {classifySplatHorizon} from './splat-globe';

export type SplatSpatialEntry<T> = {center: number[]; radius: number; value: T};
export type SplatSpatialNode<T> = {
  center: number[];
  radius: number;
  children?: SplatSpatialNode<T>[];
  entries?: SplatSpatialEntry<T>[];
};

/** Persistent owner BVH. Bounds include Gaussian support, translation and any draw-time motion. */
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

/**
 * Visit visible branches of the BVH, then test each surviving owner's bounds. A node whose bounds
 * lie inside a frustum, and in front of its globe horizon, contributes every owner below it
 * without further tests.
 */
export function querySplatSpatialIndex<T>(
  root: SplatSpatialNode<T> | null,
  projections: readonly SplatProjection[],
  pixelPadding = 0
): T[] {
  const visible: T[] = [];
  const frusta = projections.map(projection => createSplatFrustum(projection, pixelPadding));
  const horizons = projections.map(projection => projection.horizon);
  const collect = (node: SplatSpatialNode<T>) => {
    if (node.children) for (const child of node.children) collect(child);
    else for (const entry of node.entries!) visible.push(entry.value);
  };
  const visit = (node: SplatSpatialNode<T>) => {
    let intersects = false;
    for (let i = 0; i < frusta.length; i++) {
      const horizon = horizons[i];
      const side = Math.min(
        classifySplatFrustum(node.center, node.radius, frusta[i]),
        horizon ? classifySplatHorizon(node.center, node.radius, horizon) : 1
      );
      if (side > 0) {
        collect(node);
        return;
      }
      intersects ||= side === 0;
    }
    if (!intersects) return;
    if (node.children) for (const child of node.children) visit(child);
    else
      for (const entry of node.entries!)
        for (let i = 0; i < frusta.length; i++) {
          const horizon = horizons[i];
          if (
            intersectsSplatFrustum(entry.center, entry.radius, frusta[i]) &&
            !(horizon && classifySplatHorizon(entry.center, entry.radius, horizon) < 0)
          ) {
            visible.push(entry.value);
            break;
          }
        }
  };
  if (root) visit(root);
  return visible;
}
