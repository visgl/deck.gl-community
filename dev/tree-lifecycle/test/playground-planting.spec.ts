// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitViewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {getGroundPoint, getPlantedTree, getPlantingLayout} from '../playground-planting';
import {createPlaygroundField, TREE_SPACING} from '../playground-settings';

describe('the planted field inspector', () => {
  it('identifies the empty end of a partial row at an oblique camera angle', () => {
    const trees = createPlaygroundField(10);
    const layout = getPlantingLayout(trees);
    const [x, y] = trees[9].position;
    const viewport = new OrbitViewport({
      width: 800,
      height: 780,
      target: [x, y, 0],
      zoom: 4,
      rotationX: 43,
      rotationOrbit: -38,
      orbitAxis: 'Z'
    });
    for (const [east, expected] of [
      [x, 9],
      [x + TREE_SPACING, -1]
    ]) {
      const [px, py] = viewport.project([east, y, 0]);
      const point = getGroundPoint(viewport, [px, py]);
      expect(point).not.toBeNull();
      expect(getPlantedTree(layout, point!)).toBe(expected);
    }
  });
});
