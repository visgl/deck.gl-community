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
    .filter((id: string) => id === 'test-a' || id === 'test-b');
}

describe('vector source draw order', () => {
  test('orders sources by their first visible style layer', () => {
    const layers = [
      {id: 'a1', type: 'line', source: 'a', 'source-layer': 'x', maxzoom: 5},
      {id: 'b1', type: 'line', source: 'b', 'source-layer': 'x'},
      {id: 'a2', type: 'line', source: 'a', 'source-layer': 'x'}
    ];
    // a1 is hidden at z8, so b1 is the first visible layer and source b draws first.
    expect(sourceOrder(layers, 8)).toEqual(['test-b', 'test-a']);
    // At z4 a1 is visible and draws first.
    expect(sourceOrder(layers, 4)).toEqual(['test-a', 'test-b']);
  });
});
