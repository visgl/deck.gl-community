// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {describe, expect, it} from 'vitest';
import {type TreeSpec} from '../../src';
import {mountTreeScene} from './tree-layer-test-utils';

describe('TreeLayer crop mesh selection', () => {
  it('refreshes nearby candidates when a tree leans without moving the camera', () => {
    const scene = mountTreeScene<TreeSpec>(
      new WebMercatorViewport({width: 256, height: 256, zoom: 22, pitch: 40})
    );
    const tree: TreeSpec = {
      position: [0, 0],
      species: 'citrus',
      height: 10,
      crownRadius: 3,
      crop: {kind: 'fruit', count: 80, radius: 0.07, color: [255, 30, 20]}
    };
    const render = (lean: TreeSpec['lean']) => {
      const layer = scene.render({
        data: [{...tree, lean}],
        shadowEnabled: false,
        _cropOnly: true
      });
      return [...layer.state.photoreal!.groups.values()][0].rows[0].crop;
    };

    const upright = render([0, 0]);
    const {level} = upright;
    const {capacity} = upright.attached;
    const uprightMeshCount = upright.near[1].length / 2;
    expect(uprightMeshCount).toBeLessThan(capacity);
    const leaning = render([30, 90]);
    expect(leaning.level).toBe(level);
    expect(leaning.attached.capacity).toBe(capacity);
    expect(leaning.near[1].length / 2).toBe(capacity);
    expect(render([0, 0]).near[1].length / 2).toBe(uprightMeshCount);
  });
});
