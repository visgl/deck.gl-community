// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

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

type RenderableDependencyArrowLayer = TestableDependencyArrowLayer & {
  getSubLayerAccessor: ReturnType<typeof vi.fn>;
  getSubLayerProps: ReturnType<typeof vi.fn>;
  encodePickingColor: ReturnType<typeof vi.fn>;
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

function makeRenderableLayer(): RenderableDependencyArrowLayer {
  const layer = makeLayer('line') as RenderableDependencyArrowLayer;
  layer.props = {
    ...layer.props,
    getOutlineColor: () => [255, 255, 255, 220],
    outlineWidthScale: 3,
    widthScale: 2
  };
  layer.getSubLayerAccessor = vi.fn(accessor => accessor);
  layer.getSubLayerProps = vi.fn(props => props);
  layer.encodePickingColor = vi.fn(() => [0, 0, 0]);
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

  it('renders dependency outlines before line and marker sublayers', () => {
    const layer = makeRenderableLayer();
    const [outlineLayer, lineLayer, markerLayer] = layer.renderLayers();

    expect(outlineLayer?.props.id).toBe('links-line-outline');
    expect(outlineLayer?.props.getColor).toBe(layer.props.getOutlineColor);
    expect(outlineLayer?.props.widthScale).toBe(6);
    expect(lineLayer?.props.id).toBe('links-line');
    expect(markerLayer?.props.id).toBe('arrows');
  });
});
