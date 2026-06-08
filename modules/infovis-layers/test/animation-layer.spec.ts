// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {resolveAnimationFrames} from '../src/layers/animation-layer/animation';
import blockLayerVertexShader from '../src/layers/block-layer/block-layer-vertex.glsl';

import type {Layer} from '@deck.gl/core';
import type {AnimationFramesGroup} from '../src/layers/animation-layer/animation';

type TestLayer = Layer<{opacity: number}>;

const LOOP_FRAMES = {
  type: 'sequence',
  frames: [{props: {opacity: 1}, duration: 100}]
} satisfies AnimationFramesGroup<TestLayer>;

describe('AnimationLayer helpers', () => {
  it('waits for repeatDelay before starting loop repeats', () => {
    const options = {frames: LOOP_FRAMES, repeat: 1, repeatDelay: 50};
    const firstIteration = resolveAnimationFrames<TestLayer>(10, options);
    const secondIteration = resolveAnimationFrames<TestLayer>(
      firstIteration.end,
      options,
      firstIteration
    );

    expect(secondIteration).toMatchObject({
      start: firstIteration.end + 50,
      end: firstIteration.end + 150,
      iterations: 1
    });
  });
});

describe('BlockLayer shaders', () => {
  it('converts scalar line widths through the vec2 pixel-size helper', () => {
    expect(blockLayerVertexShader).toContain(
      'lineWidth = project_size_to_pixel(vec2(instanceLineWidths, 0.0), block.lineWidthUnits).x;'
    );
  });
});
