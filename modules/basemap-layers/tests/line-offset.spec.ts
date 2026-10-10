// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {PathStyleExtension} from '@deck.gl/extensions';
import {describe, expect, test} from 'vitest';
import {getBasemapLayers, getLineOffset} from '../src/globe-layers';

function line(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties
  };
}

function renderLine(paint: Record<string, unknown>, features = [line()], zoom = 12): any {
  return renderLines(paint, features, zoom)[0];
}

/** Renders one line style layer for one tile and returns all its sublayers. */
function renderLines(paint: Record<string, unknown>, features = [line()], zoom = 12): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: {
        tiles: {
          type: 'vector',
          tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
        }
      },
      layers: [{id: 'line', type: 'line', source: 'tiles', paint}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  return vectorLayer.props
    .renderSubLayers({
      id: 'test-tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: Math.floor(zoom)}}
    })
    .flat();
}

/** The offset of each feature in each sublayer, and each feature's line width. */
function getSides(layers: any[]): {offsets: number[]; widths: number[]}[] {
  return layers.map(layer => ({
    offsets: getOffsets(layer),
    widths: layer.props.data.map((feature: any, index: number) =>
      typeof layer.props.getLineWidth === 'function'
        ? layer.props.getLineWidth(feature, {index})
        : layer.props.getLineWidth
    )
  }));
}

function getOffsets(layer: any): number[] {
  return layer.props.data.map((feature: any) => layer.props.getOffset(feature));
}

function getExtensions(layer: any): any[] {
  return (layer.props.extensions || []).filter(
    (extension: any) => extension instanceof PathStyleExtension
  );
}

describe('line-offset and line-gap-width', () => {
  test('leaves data and extensions unchanged without offset paint', () => {
    const features = [line()];
    const layer = renderLine({}, features);
    expect(layer.props.data).toBe(features);
    expect(getExtensions(layer)).toEqual([]);
  });

  test.each([6, -6])('converts offset %s to line widths', offset => {
    const features = [line()];
    const paint = {'line-offset': offset, 'line-width': 3};
    const layer = renderLine(paint, features);
    expect(getOffsets(layer)).toEqual([offset / 3]);
    expect(layer.props.data).toBe(features);
    expect(getExtensions(layer)).toHaveLength(1);
    expect(getExtensions(layer)[0].opts.offset).toBe(true);
    expect(getExtensions(layer)[0]).toBe(getExtensions(renderLine(paint))[0]);
  });

  test.each([0, 2])('draws both gap sides with offset %s', offset => {
    const features = [line(), line()];
    const layers = renderLines(
      {'line-gap-width': 4, 'line-width': 2, 'line-offset': offset},
      features
    );
    expect(getSides(layers)).toEqual([
      {offsets: [offset / 2 + 1.5, offset / 2 + 1.5], widths: [2, 2]},
      {offsets: [offset / 2 - 1.5, offset / 2 - 1.5], widths: [2, 2]}
    ]);
    // Both sides draw the tile's features themselves, so picking reports them and their indices.
    expect(layers.map(layer => layer.props.data)).toEqual([features, features]);
    expect(layers[1].props.data).toBe(features);
    expect(layers[1].id).not.toBe(layers[0].id);
    expect(layers[1].props.extensions).toBe(layers[0].props.extensions);
  });

  test('draws a second side only for features with a positive data-driven gap', () => {
    const features = [line({gap: 0}), line({gap: 4})];
    const layers = renderLines({'line-gap-width': ['get', 'gap'], 'line-width': 2}, features);
    expect(getSides(layers)).toEqual([
      {offsets: [0, 1.5], widths: [2, 2]},
      {offsets: [0, -1.5], widths: [0, 2]}
    ]);
    expect(layers[1].props.data).toBe(features);
  });

  test.each([
    ['constant', 4],
    ['zoom-dependent', ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 8]],
    ['data-driven', ['get', 'gap']]
  ])('keeps the tile data across zoom steps with a %s gap', (_, gap) => {
    const features = [line({gap: 4})];
    const paint = {'line-gap-width': gap, 'line-width': 2};
    const layers = [12, 12.25, 12.5, 13].flatMap(zoom => renderLines(paint, features, zoom));
    expect(layers).toHaveLength(8);
    for (const layer of layers) {
      expect(layer.props.data).toBe(features);
    }
  });

  test('re-evaluates the second side when a data-driven gap changes with zoom', () => {
    const paint = {
      'line-gap-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, ['get', 'gap']],
      'line-width': 2
    };
    const features = [line({gap: 4})];
    const [, low] = renderLines(paint, features, 10);
    const [, high] = renderLines(paint, features, 14);
    expect(getSides([low, high])).toEqual([
      {offsets: [0], widths: [0]},
      {offsets: [-1.5], widths: [2]}
    ]);
    expect(low.props.updateTriggers.getLineWidth).not.toEqual(
      high.props.updateTriggers.getLineWidth
    );
  });

  test.each([undefined, 0])('draws one line with gap %s and a data-driven offset', gap => {
    const features = [line({offset: 6})];
    const layers = renderLines({'line-gap-width': gap, 'line-offset': ['get', 'offset']}, features);
    expect(layers).toHaveLength(1);
    expect(layers[0].props.data).toBe(features);
    expect(getOffsets(layers[0])).toEqual([6]);
  });

  test('updates constant offsets and triggers with zoom', () => {
    const paint = {
      'line-offset': ['interpolate', ['linear'], ['zoom'], 10, 0, 14, 8],
      'line-width': 2
    };
    const low = renderLine(paint, [line()], 10);
    const high = renderLine(paint, [line()], 14);
    expect(getOffsets(low)).toEqual([0]);
    expect(getOffsets(high)).toEqual([4]);
    expect(low.props.updateTriggers.getOffset).not.toEqual(high.props.updateTriggers.getOffset);
  });

  test('updates data-driven offsets with zoom', () => {
    const paint = {
      'line-offset': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10,
        ['get', 'offset'],
        14,
        ['*', 2, ['get', 'offset']]
      ]
    };
    const features = [line({offset: 3})];
    const low = renderLine(paint, features, 10);
    const high = renderLine(paint, features, 14);
    expect(getOffsets(low)).toEqual([3]);
    expect(getOffsets(high)).toEqual([6]);
    expect(low.props.updateTriggers.getOffset).toBe(10);
    expect(high.props.updateTriggers.getOffset).toBe(14);
  });

  test('combines dashes and offsets in one stable extension', () => {
    const paint = {'line-dasharray': [2, 1], 'line-offset': 6};
    const extensions = getExtensions(renderLine(paint));
    expect(extensions).toHaveLength(1);
    expect(extensions[0].opts).toMatchObject({
      dash: true,
      offset: true,
      dashMode: 'path'
    });
    expect(extensions[0]).toBe(getExtensions(renderLine(paint))[0]);
  });

  test.each([0, -2])('returns zero offset for width %s', width => {
    const layers = renderLines({
      'line-offset': 6,
      'line-gap-width': 4,
      'line-width': width
    });
    expect(getSides(layers)).toEqual([
      {offsets: [0], widths: [0]},
      {offsets: [0], widths: [0]}
    ]);
  });

  test('clamps negative gaps to zero', () => {
    const features = [line()];
    const layers = renderLines({'line-gap-width': -4, 'line-offset': 2}, features);
    expect(layers).toHaveLength(1);
    expect(layers[0].props.data).toBe(features);
    expect(getOffsets(layers[0])).toEqual([2]);
  });
});

describe('getLineOffset', () => {
  test.each([
    [6, 0, 3, 0, 2],
    [-6, 0, 3, 0, -2],
    [0, 4, 2, 1, 1.5],
    [0, 4, 2, -1, -1.5],
    [2, 4, 2, 1, 2.5],
    [2, 4, 2, -1, -0.5],
    [6, 0, 3, 1, 2],
    [6, 0, 3, -1, 2],
    [6, 4, 0, 1, 0],
    [6, 4, -2, -1, 0]
  ])('converts (%s, %s, %s, %s) to %s', (offset, gap, width, side, expected) => {
    expect(getLineOffset(offset, gap, width, side)).toBe(expected);
  });
});
