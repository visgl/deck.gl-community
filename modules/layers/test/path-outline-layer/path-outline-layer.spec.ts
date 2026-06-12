// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {PathStyleExtension} from '@deck.gl/extensions';
import {PathLayer} from '@deck.gl/layers';
import {describe, expect, it, vi} from 'vitest';

import {PathOutlineLayer} from '../../src/path-outline-layer/path-outline-layer';

type PathOutlineHarness = PathOutlineLayer & {
  getSubLayerProps: ReturnType<typeof vi.fn>;
  props: any;
};

function createRenderHarness(props: Record<string, unknown> = {}): PathOutlineHarness {
  const layer = Object.create(PathOutlineLayer.prototype) as PathOutlineHarness;
  layer.getSubLayerProps = vi.fn(subLayerProps => subLayerProps);
  layer.props = {
    data: [
      {
        path: [
          [0, 0],
          [1, 1]
        ],
        color: [80, 140, 220, 255],
        outlineColor: [10, 20, 30, 220],
        width: 4
      }
    ],
    getPath: d => d.path,
    getColor: d => d.color,
    getOutlineColor: d => d.outlineColor,
    getWidth: d => d.width,
    outlineWidthScale: 1.5,
    parameters: {
      blend: true,
      depthTest: false
    },
    updateTriggers: {
      getColor: ['path-color'],
      getOutlineColor: ['outline-color'],
      getWidth: ['width']
    },
    widthScale: 2,
    ...props
  };
  return layer;
}

describe('PathOutlineLayer', () => {
  it('renders outline and path sublayers with v9 path props', () => {
    const layer = createRenderHarness();
    const [outlineLayer, pathLayer] = layer.renderLayers() as PathLayer[];

    expect(outlineLayer).toBeInstanceOf(PathLayer);
    expect(pathLayer).toBeInstanceOf(PathLayer);
    expect(outlineLayer.props.id).toBe('outline');
    expect(pathLayer.props.id).toBe('path');
    expect(outlineLayer.props.widthScale).toBe(3);
    expect(pathLayer.props.widthScale).toBe(2);
    expect(outlineLayer.props.getColor).toBe(layer.props.getOutlineColor);
    expect(pathLayer.props.getColor).toBe(layer.props.getColor);
    expect(outlineLayer.props.parameters).toEqual({
      blend: true,
      depthCompare: 'always',
      depthWriteEnabled: false
    });
  });

  it('adds PathStyleExtension for dashed paths', () => {
    const layer = createRenderHarness({getDashArray: () => [4, 2]});
    const [outlineLayer, pathLayer] = layer.renderLayers() as PathLayer[];

    expect(outlineLayer.props.extensions).toHaveLength(1);
    expect(pathLayer.props.extensions).toHaveLength(1);
    expect(outlineLayer.props.extensions[0]).toBeInstanceOf(PathStyleExtension);
    expect((outlineLayer.props.extensions[0] as any).opts.highPrecisionDash).toBe(true);
    expect(pathLayer.props.extensions[0]).toBe(outlineLayer.props.extensions[0]);
    expect(outlineLayer.props.getDashArray(layer.props.data[0], {index: 0})).toEqual([
      4 / 1.5,
      2 / 1.5
    ]);
    expect(pathLayer.props.getDashArray(layer.props.data[0], {index: 0})).toEqual([4, 2]);
  });

  it('preserves an existing PathStyleExtension instance', () => {
    const extension = new PathStyleExtension({dash: true});
    const layer = createRenderHarness({extensions: [extension], getDashArray: () => [4, 2]});
    const [outlineLayer] = layer.renderLayers() as PathLayer[];

    expect(outlineLayer.props.extensions).toEqual([extension]);
  });

  it('does not attach dash extension for solid paths', () => {
    const layer = createRenderHarness();
    const [outlineLayer, pathLayer] = layer.renderLayers() as PathLayer[];

    expect(outlineLayer.props.extensions).toEqual([]);
    expect(pathLayer.props.extensions).toEqual([]);
  });
});
