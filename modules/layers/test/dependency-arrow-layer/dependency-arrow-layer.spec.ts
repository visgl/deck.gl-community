// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {DependencyArrowLayer} from '../../src/dependency-arrow-layer/dependency-arrow-layer';

import type {UpdateParameters} from '@deck.gl/core';

type Datum = {
  path: [number, number][];
};

type TestableDependencyArrowLayer = DependencyArrowLayer<Datum> & {
  state: {
    markers: {
      source: [number, number];
      target: [number, number];
    }[];
  };
};

const DATA: Datum[] = [
  {
    path: [
      [0, 0],
      [10, 0],
      [10, 10]
    ]
  }
];
const GET_PATH = (datum: Datum) => datum.path;

function makeLayer(mode: 'path' | 'line'): TestableDependencyArrowLayer {
  const layer = new DependencyArrowLayer<Datum>({
    id: 'dependency-arrows',
    data: DATA,
    mode,
    positionFormat: 'XY',
    getPath: GET_PATH
  }) as TestableDependencyArrowLayer;
  layer.state = {markers: []};
  return layer;
}

function updateLayer(
  layer: TestableDependencyArrowLayer,
  oldProps: TestableDependencyArrowLayer['props'],
  changeFlags: UpdateParameters<TestableDependencyArrowLayer>['changeFlags']
): void {
  layer.updateState({
    props: layer.props,
    oldProps,
    changeFlags
  } as UpdateParameters<TestableDependencyArrowLayer>);
}

describe('DependencyArrowLayer', () => {
  it('rebuilds marker geometry when routing mode changes', () => {
    const layer = makeLayer('path');
    updateLayer(layer, {...layer.props}, {dataChanged: true});
    expect(layer.state.markers[0]?.target).toEqual([10, 0]);

    const pathProps = layer.props;
    layer.props = makeLayer('line').props;
    updateLayer(layer, pathProps, {propsChanged: true});

    expect(layer.state.markers[0]?.target).toEqual([10, 10]);
  });
});
