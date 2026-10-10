// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}};

function lineFeature(properties: Record<string, unknown> = {}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'transportation', ...properties}
  };
}

/** Renders one style layer for one tile and returns its sublayers. */
function sublayersFor(
  styleLayer: Record<string, unknown>,
  features: unknown[] = [lineFeature()],
  zoom = 12
): any[] {
  const vectorLayer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {
      version: 8,
      sources: SOURCES,
      layers: [{id: 'road', source: 'tiles', 'source-layer': 'transportation', ...styleLayer}]
    } as any
  }).find(layer => layer.id === 'test-tiles');
  // deck.gl flattens nested sublayer arrays, as a style layer split by shape returns.
  return vectorLayer.props
    .renderSubLayers({
      id: 'test-tiles-tile',
      data: features,
      tile: {index: {x: 0, y: 0, z: zoom}}
    })
    .flat();
}

function lineSublayerFor(layout?: Record<string, unknown>): any {
  const sublayers = sublayersFor({type: 'line', paint: {'line-width': 4}, layout});
  expect(sublayers).toHaveLength(1);
  return sublayers[0];
}

/** The cap, join and miter limit props of a sublayer. */
function shapeOf(sublayer: any) {
  const {lineCapRounded, lineJointRounded, lineMiterLimit} = sublayer.props;
  return {lineCapRounded, lineJointRounded, lineMiterLimit};
}

describe('line-cap and line-join', () => {
  test('defaults to butt caps and miter joins with a miter limit of 2', () => {
    // deck.gl cuts joins at miterLimit + 1 half widths, MapLibre at line-miter-limit.
    expect(shapeOf(lineSublayerFor())).toEqual({
      lineCapRounded: false,
      lineJointRounded: false,
      lineMiterLimit: 1
    });
  });

  test.each([
    ['round', true],
    ['butt', false],
    // deck.gl has no square cap; the closest is butt.
    ['square', false]
  ])('line-cap %s', (cap, rounded) => {
    expect(lineSublayerFor({'line-cap': cap}).props.lineCapRounded).toBe(rounded);
  });

  test('line-join round', () => {
    const sublayer = lineSublayerFor({'line-join': 'round'});
    expect(sublayer.props.lineJointRounded).toBe(true);
  });

  test('line-join bevel cuts the joint at half the line width', () => {
    const sublayer = lineSublayerFor({'line-join': 'bevel', 'line-miter-limit': 10});
    expect(sublayer.props.lineJointRounded).toBe(false);
    expect(sublayer.props.lineMiterLimit).toBe(0);
  });

  test.each([
    [4, 3],
    [1, 0],
    [0.5, 0]
  ])('line-miter-limit %s is deck.gl miterLimit %s', (limit, miterLimit) => {
    expect(
      lineSublayerFor({'line-join': 'miter', 'line-miter-limit': limit}).props.lineMiterLimit
    ).toBe(miterLimit);
  });

  test('evaluates zoom-dependent values at the style zoom', () => {
    const layout = {
      'line-cap': ['step', ['zoom'], 'butt', 13, 'round'],
      'line-join': ['step', ['zoom'], 'miter', 13, 'round']
    };
    const [low] = sublayersFor({type: 'line', layout}, [lineFeature()], 12);
    const [high] = sublayersFor({type: 'line', layout}, [lineFeature()], 13);
    expect(shapeOf(low)).toMatchObject({lineCapRounded: false, lineJointRounded: false});
    expect(shapeOf(high)).toMatchObject({lineCapRounded: true, lineJointRounded: true});
  });

  test('per-feature values split the features into one sublayer per shape', () => {
    const features = [
      lineFeature({kind: 'rail'}),
      lineFeature({kind: 'road'}),
      lineFeature({kind: 'rail'}),
      lineFeature({kind: 'path'})
    ];
    const sublayers = sublayersFor(
      {
        type: 'line',
        layout: {
          'line-cap': ['match', ['get', 'kind'], 'road', 'round', 'butt'],
          'line-join': ['match', ['get', 'kind'], 'path', 'bevel', 'round']
        }
      },
      features
    );

    expect(sublayers).toHaveLength(3);
    expect(
      sublayers.map(sublayer => sublayer.props.data.map((f: any) => f.properties.kind))
    ).toEqual([['rail', 'rail'], ['road'], ['path']]);
    expect(sublayers.map(shapeOf)).toEqual([
      {lineCapRounded: false, lineJointRounded: true, lineMiterLimit: 0},
      {lineCapRounded: true, lineJointRounded: true, lineMiterLimit: 0},
      {lineCapRounded: false, lineJointRounded: false, lineMiterLimit: 0}
    ]);
    expect(new Set(sublayers.map(sublayer => sublayer.id)).size).toBe(3);
  });

  describe('per-feature shape groups across zoom steps', () => {
    const features = [lineFeature({kind: 'road'}), lineFeature({kind: 'rail'})];

    /** Renders the same style and tile at each zoom and returns each zoom's sublayer data. */
    function groupDataAt(layout: Record<string, unknown>, zooms: number[]): any[][][] {
      const style = {
        version: 8,
        sources: SOURCES,
        layers: [
          {id: 'road', type: 'line', source: 'tiles', 'source-layer': 'transportation', layout}
        ]
      } as any;
      return zooms.map(zoom => {
        const vectorLayer: any = getBasemapLayers({
          idPrefix: 'test',
          mode: 'map',
          zoom,
          styleDefinition: style
        }).find(layer => layer.id === 'test-tiles');
        return vectorLayer.props
          .renderSubLayers({
            id: 'test-tiles-tile',
            data: features,
            tile: {index: {x: 0, y: 0, z: 12}}
          })
          .flat()
          .map((sublayer: any) => sublayer.props.data);
      });
    }

    test('reuse their feature arrays when the values do not depend on zoom', () => {
      const [first, second] = groupDataAt(
        {'line-cap': ['match', ['get', 'kind'], 'road', 'round', 'butt']},
        [12, 12.5]
      );
      expect(first).toHaveLength(2);
      expect(second[0]).toBe(first[0]);
      expect(second[1]).toBe(first[1]);
    });

    test('regroup at each zoom step when the values depend on zoom', () => {
      const [first, second, third] = groupDataAt(
        {
          'line-cap': [
            'step',
            ['zoom'],
            ['match', ['get', 'kind'], 'road', 'round', 'butt'],
            13,
            'round'
          ]
        },
        [12, 12, 13]
      );
      expect(second[0]).toBe(first[0]);
      expect(first).toHaveLength(2);
      expect(third).toHaveLength(1);
      expect(third[0]).toHaveLength(2);
    });
  });

  test('per-feature values that agree draw one sublayer', () => {
    const sublayers = sublayersFor(
      {type: 'line', layout: {'line-join': ['coalesce', ['get', 'join'], 'round']}},
      [lineFeature(), lineFeature()]
    );
    expect(sublayers).toHaveLength(1);
    expect(sublayers[0].props.data).toHaveLength(2);
    expect(sublayers[0].props.lineJointRounded).toBe(true);
  });

  test('fill outlines keep square joins', () => {
    const square = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0]
          ]
        ]
      },
      properties: {layerName: 'transportation'}
    };
    const [sublayer] = sublayersFor({type: 'fill', paint: {'fill-outline-color': '#000000'}}, [
      square
    ]);
    expect(sublayer.props.lineCapRounded).toBe(false);
    expect(sublayer.props.lineJointRounded).toBe(false);
  });
});
