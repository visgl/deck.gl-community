// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {ExperimentalColumnLayer} from '../../src';

describe('ExperimentalColumnLayer', () => {
  it('exports and can be instantiated', () => {
    expect(ExperimentalColumnLayer).toBeTruthy();
    expect(ExperimentalColumnLayer.layerName).toBe('ExperimentalColumnLayer');

    const layer = new ExperimentalColumnLayer({
      id: 'test-layer',
      data: []
    });

    expect(layer).toBeTruthy();
    expect(layer.id).toBe('test-layer');
  });

  it('has getBevel accessor with default value', () => {
    const layer = new ExperimentalColumnLayer({
      id: 'test-layer',
      data: [{position: [0, 0, 0]}]
    });

    expect(layer.props.getBevel).toBeTruthy();
  });

  it('has getRadius accessor with default value', () => {
    const layer = new ExperimentalColumnLayer({
      id: 'test-layer',
      data: [{position: [0, 0, 0]}]
    });

    expect(layer.props.getRadius).toBeTruthy();
  });

  it('accepts custom bevel configurations', () => {
    const layer = new ExperimentalColumnLayer({
      id: 'test-layer',
      data: [
        {position: [0, 0, 0], bevel: 'flat'},
        {position: [1, 1, 0], bevel: 'dome'},
        {position: [2, 2, 0], bevel: 'cone'},
        {position: [3, 3, 0], bevel: {segs: 5, height: 100, bulge: 0.5}}
      ],
      getBevel: d => d.bevel
    });

    expect(layer.props.getBevel).toBeTruthy();
  });

  it('accepts custom radius values', () => {
    const layer = new ExperimentalColumnLayer({
      id: 'test-layer',
      data: [
        {position: [0, 0, 0], radius: 1},
        {position: [1, 1, 0], radius: 2},
        {position: [2, 2, 0], radius: 0.5}
      ],
      getRadius: d => d.radius
    });

    expect(layer.props.getRadius).toBeTruthy();
  });
});
