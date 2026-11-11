// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Viewport} from '@deck.gl/core';
import type {ShellTree} from './field/shell/shell-field';
import {ROW_SPACING, TREE_SPACING} from './playground-settings';

type Point = [number, number];
type ClipPoint = [number, number, number, number];

export function getPlantingLayout(trees: readonly ShellTree[]) {
  const first = trees[0];
  const last = trees[trees.length - 1];
  const nextRow = trees.findIndex(tree => tree.row !== first.row);
  const columns = nextRow < 0 ? trees.length : nextRow;
  const west = first.position[0] - TREE_SPACING / 2;
  const south = first.position[1] - ROW_SPACING / 2;
  const east = west + columns * TREE_SPACING;
  const lastEast = last.position[0] + TREE_SPACING / 2;
  const north = last.position[1] + ROW_SPACING / 2;
  const outline: Point[] = [
    [west, south],
    [east, south]
  ];
  if (lastEast < east) {
    outline.push([east, north - ROW_SPACING], [lastEast, north - ROW_SPACING]);
  }
  outline.push([lastEast, north], [west, north]);
  return {west, south, columns, count: trees.length, outline};
}

export function getPlantedTree(
  layout: ReturnType<typeof getPlantingLayout>,
  [x, y]: Point
): number {
  const row = Math.floor((y - layout.south) / ROW_SPACING);
  const column = Math.floor((x - layout.west) / TREE_SPACING);
  const index = row * layout.columns + column;
  return row >= 0 && column >= 0 && column < layout.columns && index < layout.count ? index : -1;
}

export function getGroundPoint(viewport: Viewport, [x, y]: Point): Point | null {
  const near = viewport.unproject([x, y, -1]);
  const far = viewport.unproject([x, y, 1]);
  const t = near[2] / (near[2] - far[2]);
  return Number.isFinite(t) && t >= 0 && t <= 1
    ? [near[0] + (far[0] - near[0]) * t, near[1] + (far[1] - near[1]) * t]
    : null;
}

/** Clip a ground segment before dividing by W, including edges that cross behind the eye. */
export function projectPlantingEdge(
  viewport: Viewport,
  start: Point,
  end: Point
): [Point, Point] | null {
  const m = viewport.viewProjectionMatrix;
  const clip = ([x, y]: Point): ClipPoint => [
    m[0] * x + m[4] * y + m[12],
    m[1] * x + m[5] * y + m[13],
    m[2] * x + m[6] * y + m[14],
    m[3] * x + m[7] * y + m[15]
  ];
  const a = clip(start);
  const b = clip(end);
  let first = 0;
  let last = 1;
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const from = a[3] + sign * a[axis];
      const to = b[3] + sign * b[axis];
      if (from < 0 && to < 0) return null;
      if (from < 0) first = Math.max(first, from / (from - to));
      else if (to < 0) last = Math.min(last, from / (from - to));
    }
  }
  if (first > last) return null;
  const screen = (t: number): Point => {
    const w = a[3] + (b[3] - a[3]) * t;
    return [
      (1 + (a[0] + (b[0] - a[0]) * t) / w) * viewport.width * 0.5,
      (1 - (a[1] + (b[1] - a[1]) * t) / w) * viewport.height * 0.5
    ];
  };
  return [screen(first), screen(last)];
}
