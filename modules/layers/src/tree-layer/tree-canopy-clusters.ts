// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createSplatHierarchy} from '../splat-layer/splat-hierarchy';
import type {SplatSource} from '../splat-layer/splat-source';
/** Overlapping 3D crown lobes. Source pages preserve crown height while aggregating XY moments. */
export const TREE_CLUSTER_SOURCE: SplatSource = {
  positions: new Float32Array([
    -0.3, -0.25, 0.35, 0.3, -0.25, 0.42, -0.28, 0.27, 0.46, 0.3, 0.28, 0.35, 0, 0, 0.65
  ]),
  scales: new Float32Array([
    0.26, 0.26, 0.16, 0.26, 0.26, 0.17, 0.26, 0.26, 0.15, 0.26, 0.26, 0.16, 0.28, 0.28, 0.15
  ]),
  rotations: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]),
  colors: new Uint8Array([
    220, 250, 218, 255, 240, 255, 240, 255, 180, 220, 184, 255, 205, 240, 209, 255, 255, 255, 255,
    255
  ]),
  opacities: new Float32Array([0.6, 0.6, 0.6, 0.6, 0.6]),
  normals: new Float32Array([
    -0.3, -0.2, 0.8, 0.3, -0.2, 0.8, -0.3, 0.2, 0.8, 0.3, 0.2, 0.8, 0, 0, 1
  ])
};

export const TREE_CLUSTER_HIERARCHY = createSplatHierarchy(TREE_CLUSTER_SOURCE, [0.5, 1]);
