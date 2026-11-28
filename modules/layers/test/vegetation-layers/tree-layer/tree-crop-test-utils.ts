// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitView, type Layer} from '@deck.gl/core';
import {TreeLayer, type CropConfig, type TreeSpec} from '../../../src';
import {TreePhotorealCropLayer} from '../../../src/vegetation-layers/tree-layer/tree-photoreal-crop-layer';
import {
  createTreeFixture,
  mountTreeBrowserScene,
  type TreeBrowserScene as Scene
} from './tree-browser-frame-reader';

export const SIZE = 256;

/** A camera in metres: about 11 m away, level with the middle of a 6 m tree. */
export const ORBIT_VIEW = new OrbitView({orbitAxis: 'Z', fovy: 40, near: 0.05, far: 8} as never);
export const ORBIT_STATE = {
  target: [0, 0, 2.8],
  rotationOrbit: 20,
  rotationX: 4,
  zoom: 4.7,
  maxZoom: 30
};

const coordinates = {
  coordinateSystem: 'cartesian',
  coordinateOrigin: [0, 0, 0] as [number, number, number]
};

/** A color no leaf, bark or sky comes near. */
export const MAGENTA = [255, 0, 255, 255] as [number, number, number, number];

export function fruit(fields: Partial<CropConfig> = {}): CropConfig {
  return {color: MAGENTA, count: 60, radius: 0.09, ...fields};
}

/** Leafless, so a test sees what its crops do. Foliage has its own tests. */
export const TREE: TreeSpec = {
  species: 'citrus',
  position: [0, 0, 0],
  height: 6,
  crownRadius: 2.6,
  foliage: 0
};

export function mount(options: Partial<Parameters<typeof mountTreeBrowserScene>[0]> = {}): Scene {
  return mountTreeBrowserScene({
    staticFrames: true,
    size: SIZE,
    views: ORBIT_VIEW,
    viewState: ORBIT_STATE,
    ...options
  });
}

/** One tree whose crops are in `tree.crop`. CI renders in software, and a coarse mesh tests the same. */
export function trees(
  tree: TreeSpec,
  props: Record<string, unknown> = {},
  data: TreeSpec[] = [tree],
  Layer = TreeLayer<TreeSpec>
) {
  return createTreeFixture(Layer, {
    ...coordinates,
    id: 'trees',
    data,
    getTree: (row: TreeSpec) => row,
    pickable: true,
    windTime: 1,
    lodBias: 1,
    ...props
  });
}

export function isMagenta(pixels: Uint8Array, offset: number): boolean {
  const green = pixels[offset + 1];
  return pixels[offset + 3] > 0 && pixels[offset] > green + 50 && pixels[offset + 2] > green + 30;
}

/** Crop pixels in a window, x and y as on screen. */
export function countCrop(pixels: Uint8Array, x0 = 0, y0 = 0, x1 = SIZE, y1 = SIZE): number {
  let count = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) if (isMagenta(pixels, ((SIZE - 1 - y) * SIZE + x) * 4)) count++;
  return count;
}

export function subLayers(scene: Scene): Layer[] {
  return scene.layerManager().getLayers();
}

export function cropLayers(scene: Scene): Layer[] {
  return subLayers(scene).filter(layer => layer instanceof TreePhotorealCropLayer);
}

/** Draw only crop sublayers when the assertion measures the crop pass itself. */
export class CropFixture extends TreeLayer<TreeSpec> {
  static layerName = 'CropFixture';

  filterSubLayer(context: Parameters<TreeLayer['filterSubLayer']>[0]): boolean {
    return context.layer instanceof TreePhotorealCropLayer && super.filterSubLayer(context);
  }
}
