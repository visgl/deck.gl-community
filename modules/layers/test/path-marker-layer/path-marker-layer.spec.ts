// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {PathMarkerLayer} from '../../src/path-marker-layer/path-marker-layer';

import type {UpdateParameters} from '@deck.gl/core';

type Datum = {
  path: [number, number][];
  direction: {
    forward: boolean;
    backward: boolean;
  };
};

type TestablePathMarkerLayer = PathMarkerLayer<Datum> & {
  context: {
    viewport: {
      projectFlat: (position: [number, number]) => [number, number];
    };
  };
  state: {
    markers: unknown[];
    mesh: unknown;
    closestPoint: null;
    closestPoints: unknown[];
  };
};

type GetMarkerPercentages = (datum: Datum, info: {index: number; lineLength: number}) => number[];

const DATA: Datum[] = [
  {
    path: [
      [0, 0],
      [10, 0]
    ],
    direction: {
      forward: true,
      backward: false
    }
  }
];

function makeLayer(getMarkerPercentages: GetMarkerPercentages): TestablePathMarkerLayer {
  const layer = new PathMarkerLayer<Datum>({
    id: 'path-markers',
    data: DATA,
    getMarkerPercentages
  }) as TestablePathMarkerLayer;
  layer.state = {
    markers: [],
    mesh: null,
    closestPoint: null,
    closestPoints: []
  };
  setProjectScale(layer, 10);
  return layer;
}

function setProjectScale(layer: TestablePathMarkerLayer, scale: number): void {
  layer.context = {
    viewport: {
      projectFlat: ([x, y]) => [x * scale, y]
    }
  };
}

function updateLayer(
  layer: TestablePathMarkerLayer,
  changeFlags: Partial<UpdateParameters<TestablePathMarkerLayer>['changeFlags']>
): void {
  layer.updateState({
    props: layer.props,
    oldProps: layer.props,
    changeFlags
  } as UpdateParameters<TestablePathMarkerLayer>);
}

describe('PathMarkerLayer', () => {
  it('rebuilds screen-space markers when the viewport changes', () => {
    const getMarkerPercentages = vi.fn((_object: Datum, {lineLength}: {lineLength: number}) =>
      lineLength > 100 ? [0.25, 0.75] : [0.5]
    );
    const layer = makeLayer(getMarkerPercentages);

    updateLayer(layer, {dataChanged: true});
    expect(layer.state.markers).toHaveLength(1);
    expect(getMarkerPercentages).toHaveBeenLastCalledWith(DATA[0], {index: 0, lineLength: 100});

    setProjectScale(layer, 20);
    updateLayer(layer, {viewportChanged: true});

    expect(layer.state.markers).toHaveLength(2);
    expect(getMarkerPercentages).toHaveBeenLastCalledWith(DATA[0], {index: 0, lineLength: 200});
  });
});
