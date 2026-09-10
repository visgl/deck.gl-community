// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  FlyToInterpolator,
  WebMercatorViewport,
  type MapViewState,
  type Viewport
} from '@deck.gl/core';
import {addMetersToLngLat, lngLatToWorld, worldToPixels} from '@math.gl/web-mercator';
import type {ForestTree} from './forest-data';

/** Include crown width, lean, and height instead of fitting trunk bases alone. */
export function getGroveBoundsPoints(trees: ForestTree[]): number[][] {
  return trees.flatMap(tree => {
    const radius = tree.canopyRadius * 1.5;
    return [-radius, radius].flatMap(x =>
      [-radius, radius].flatMap(y =>
        [0, tree.height * 1.1].map(z => addMetersToLngLat(tree.position, [x, y, z]))
      )
    );
  });
}

const FIT_CACHE = new WeakMap<ForestTree[], Map<string, MapViewState>>();

/** Fit and center the complete 3D grove between the title and the bottom controls. */
export function getGroveView(trees: ForestTree[], width: number, height: number): MapViewState {
  let cache = FIT_CACHE.get(trees);
  const key = `${width}:${height}`;
  const cached = cache?.get(key);
  if (cached) return {...cached};
  // Geographic projection is independent of the trial camera. Do its trigonometry
  // once, then fit using only the changing pixel matrix and altitude scale.
  const points = getGroveBoundsPoints(trees).map(point => [...lngLatToWorld(point), point[2]]);
  const top = Math.min(120, height * 0.22);
  const bottom = Math.min(90, height * 0.2);
  const target = [width / 2, (top + height - bottom) / 2];
  const altitude = Math.max(...trees.map(tree => tree.height)) / 2;
  const center = {
    longitude: trees.reduce((sum, tree) => sum + tree.position[0], 0) / trees.length,
    latitude: trees.reduce((sum, tree) => sum + tree.position[1], 0) / trees.length
  };
  let best: MapViewState = {
    ...center,
    zoom: 13,
    pitch: 50,
    bearing: 20,
    position: [0, 0, altitude]
  };
  let low = 13;
  let high = 21;
  for (let step = 0; step < 14; step++) {
    const zoom = (low + high) / 2;
    let view = {...best, ...center, zoom};
    let bounds: number[] = [];
    for (let pass = 0; pass < 4; pass++) {
      const viewport = new WebMercatorViewport({...view, width, height});
      bounds = [Infinity, Infinity, -Infinity, -Infinity];
      for (const point of points) {
        const [x, y] = worldToPixels(
          [point[0], point[1], point[2] * viewport.distanceScales.unitsPerMeter[2]],
          viewport.pixelProjectionMatrix
        );
        bounds[0] = Math.min(bounds[0], x);
        bounds[1] = Math.min(bounds[1], y);
        bounds[2] = Math.max(bounds[2], x);
        bounds[3] = Math.max(bounds[3], y);
      }
      if (pass === 3) break;
      const middle = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
      const from = viewport.unproject(middle, {targetZ: altitude});
      const to = viewport.unproject(target, {targetZ: altitude});
      view = {
        ...view,
        longitude: view.longitude + from[0] - to[0],
        latitude: view.latitude + from[1] - to[1]
      };
    }
    if (
      bounds[0] >= 24 &&
      bounds[2] <= width - 24 &&
      bounds[1] >= top &&
      bounds[3] <= height - bottom
    ) {
      best = view;
      low = zoom;
    } else {
      high = zoom;
    }
  }
  if (!cache) {
    cache = new Map();
    FIT_CACHE.set(trees, cache);
  }
  // Resizing can produce many dimensions; retain a small set per stable grove.
  if (cache.size >= 8) cache.delete(cache.keys().next().value!);
  cache.set(key, best);
  return {...best};
}

type CrownHitArea = {tree: ForestTree; x: number; y: number; rx: number; ry: number};
const PICK_CACHE = new WeakMap<Viewport, {trees: ForestTree[]; crowns: CrownHitArea[]}>();

/** Cache projected crowns per camera so hovering a dense grove only checks ellipses. */
export function pickTreeAtPixel(
  trees: ForestTree[],
  viewport: Viewport,
  view: MapViewState,
  x: number,
  y: number
): ForestTree | undefined {
  if (view.zoom < 14) return undefined;
  let cached = PICK_CACHE.get(viewport);
  if (!cached || cached.trees !== trees) {
    const crowns: CrownHitArea[] = [];
    for (const tree of trees) {
      // Other continents cannot be hit at grove zoom. Avoid projecting their geometry.
      const lngDelta = ((tree.position[0] - view.longitude + 540) % 360) - 180;
      if (Math.abs(lngDelta) > 1 || Math.abs(tree.position[1] - view.latitude) > 1) continue;
      const radius = tree.canopyRadius * 1.35;
      let left = Infinity;
      let right = -Infinity;
      let top = Infinity;
      let bottom = -Infinity;
      for (const dx of [-radius, radius]) {
        for (const dy of [-radius, radius]) {
          for (const z of [tree.height * tree.trunkFraction, tree.height]) {
            const pixel = viewport.project(addMetersToLngLat(tree.position, [dx, dy, z]));
            left = Math.min(left, pixel[0]);
            right = Math.max(right, pixel[0]);
            top = Math.min(top, pixel[1]);
            bottom = Math.max(bottom, pixel[1]);
          }
        }
      }
      if (right < 0 || left > viewport.width || bottom < 0 || top > viewport.height) continue;
      crowns.push({
        tree,
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        rx: Math.max(4, (right - left) / 2),
        ry: Math.max(4, (bottom - top) / 2)
      });
    }
    cached = {trees, crowns};
    PICK_CACHE.set(viewport, cached);
  }
  let nearest: ForestTree | undefined;
  let nearestDistance = 1;
  for (const crown of cached.crowns) {
    const distance = ((x - crown.x) / crown.rx) ** 2 + ((y - crown.y) / crown.ry) ** 2;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = crown.tree;
    }
  }
  return nearest;
}

/** Fly between groves along the shorter longitude arc, retaining the 3D camera target. */
export function createGroveFlight(
  from: MapViewState,
  to: MapViewState,
  width: number,
  height: number
): (progress: number) => MapViewState {
  const interpolator = new FlyToInterpolator();
  const wrapAngle = (angle: number) => ((((angle + 180) % 360) + 360) % 360) - 180;
  const {start, end} = interpolator.initializeProps(
    {...from, width, height},
    {
      ...to,
      width,
      height,
      longitude: from.longitude + wrapAngle(to.longitude - from.longitude),
      bearing: (from.bearing || 0) + wrapAngle((to.bearing || 0) - (from.bearing || 0))
    }
  );
  return progress =>
    progress >= 1 ? to : (interpolator.interpolateProps(start, end, progress) as MapViewState);
}
