/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const SOURCES = {
  a: {type: 'vector', tiles: ['https://a.example.com/{z}/{x}/{y}.mvt']},
  b: {type: 'vector', tiles: ['https://b.example.com/{z}/{x}/{y}.mvt']}
};

function sourceOrder(layers: Record<string, unknown>[], zoom: number): string[] {
  return getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition: {version: 8, sources: SOURCES, layers} as any
  })
    .map((layer: any) => layer.id)
    .filter((id: string) => id.startsWith('test-a') || id.startsWith('test-b'));
}

describe('vector source draw order', () => {
  test('interleaves sources in style order, skipping runs with no visible layer', () => {
    const layers = [
      {id: 'a1', type: 'line', source: 'a', 'source-layer': 'x', maxzoom: 5},
      {id: 'b1', type: 'line', source: 'b', 'source-layer': 'x'},
      {id: 'a2', type: 'line', source: 'a', 'source-layer': 'x'}
    ];
    // a1 is hidden at z8, so its run draws nothing; a2 draws after b1 in a second tile layer.
    expect(sourceOrder(layers, 8)).toEqual(['test-b', 'test-a-"a2"']);
    // At z4 a1 is visible and draws first.
    expect(sourceOrder(layers, 4)).toEqual(['test-a', 'test-b', 'test-a-"a2"']);
  });
});
