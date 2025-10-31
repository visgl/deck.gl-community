// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {getArrowTransform, isEdgeDirected} from '../../src/layers/edge-layers/edge-arrow-layer';

describe('EdgeArrowLayer helpers', () => {
  it('identifies directed edges', () => {
    expect(isEdgeDirected({directed: true})).toBe(true);
    expect(isEdgeDirected({directed: false})).toBe(false);
    expect(isEdgeDirected({directed: undefined})).toBe(false);
    expect(isEdgeDirected({isDirected: () => true})).toBe(true);
    expect(isEdgeDirected({isDirected: () => false})).toBe(false);
  });

  it('computes transforms for straight edges with offsets', () => {
    const layout = {
      sourcePosition: [0, 0, 0],
      targetPosition: [10, 0, 0]
    };

    const {position, angle} = getArrowTransform({layout, size: 4, offset: [2, 1]});

    expect(position[0]).toBeCloseTo(6);
    expect(position[1]).toBeCloseTo(1);
    expect(position[2]).toBeCloseTo(0);
    expect(angle).toBeCloseTo(90);
  });

  it('uses last control point to orient arrows', () => {
    const layout = {
      sourcePosition: [0, 0, 0],
      controlPoints: [[5, 5, 0]],
      targetPosition: [10, 10, 0]
    };

    const {position, angle} = getArrowTransform({layout, size: 4, offset: null});

    expect(position[0]).toBeCloseTo(8.585786, 6);
    expect(position[1]).toBeCloseTo(8.585786, 6);
    expect(position[2]).toBeCloseTo(0);
    expect(angle).toBeCloseTo(45);
  });

  it('falls back to the target position when direction length is zero', () => {
    const layout = {
      sourcePosition: [5, 5, 0],
      targetPosition: [5, 5, 0]
    };

    const {position, angle} = getArrowTransform({layout, size: 10, offset: [5, 5]});

    expect(position).toEqual([5, 5, 0]);
    expect(angle).toBe(0);
  });
});
