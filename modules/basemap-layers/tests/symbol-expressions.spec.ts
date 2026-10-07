/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {MVTLabelLayer} from '../src/mvt-label-layer.ts';

function feature(properties: Record<string, unknown>) {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [0, 0]},
    properties: {layerName: 'place', ...properties}
  };
}

function labelLayer(
  layout: Record<string, unknown>,
  paint: Record<string, unknown> = {},
  zoom = 7.6
) {
  return new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    styleLayer: {layout, paint},
    zoom,
    textColor: [10, 20, 30, 255]
  } as any);
}

describe('text-field', () => {
  test('evaluates expressions per feature', () => {
    const layer = labelLayer({
      'text-field': ['concat', ['get', 'name'], ' (', ['get', 'ref'], ')']
    });
    expect(layer.getLabel(feature({name: 'A', ref: 'B'}) as any)).toBe('A (B)');
  });

  test('evaluates coalesce over feature properties', () => {
    const layer = labelLayer({'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']]});
    expect(layer.getLabel(feature({name: 'Local'}) as any)).toBe('Local');
    expect(layer.getLabel(feature({name: 'Local', 'name:en': 'English'}) as any)).toBe('English');
  });

  test('resolves legacy tokens in literal and zoom-stop values', () => {
    expect(labelLayer({'text-field': '{name} x'}).getLabel(feature({name: 'A'}) as any)).toBe(
      'A x'
    );
    const stops = {
      'text-field': {
        stops: [
          [0, '{name}'],
          [10, '{ref}']
        ]
      }
    };
    expect(labelLayer(stops, {}, 7).getLabel(feature({name: 'A', ref: 'B'}) as any)).toBe('A');
    expect(labelLayer(stops, {}, 11).getLabel(feature({name: 'A', ref: 'B'}) as any)).toBe('B');
  });

  test('does not resolve token syntax inside expression results', () => {
    const layer = labelLayer({'text-field': ['get', 'name']});
    expect(layer.getLabel(feature({name: '{ref}', ref: 'B'}) as any)).toBe('{ref}');
  });
});

describe('text-size', () => {
  test('evaluates data-driven sizes per feature', () => {
    const layer = labelLayer({'text-field': 'x', 'text-size': ['get', 'size']});
    expect(layer.getLabelSize(feature({size: 9}) as any)).toBe(9);
    expect(layer.getLabelSize(feature({size: 21}) as any)).toBe(21);
  });

  test('interpolates zoom expressions at the integer zoom', () => {
    const layer = labelLayer(
      {'text-field': 'x', 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 20]},
      {},
      7.6
    );
    expect(layer.getLabelSize(feature({}) as any)).toBe(14);
  });
});

describe('text-color and text-opacity', () => {
  test('evaluates text-color per feature', () => {
    const layer = labelLayer(
      {'text-field': 'x'},
      {'text-color': ['match', ['get', 'class'], 'city', '#ff0000', '#0000ff']}
    );
    expect(layer.getLabelColor(feature({class: 'city'}) as any)).toEqual([255, 0, 0, 255]);
    expect(layer.getLabelColor(feature({class: 'town'}) as any)).toEqual([0, 0, 255, 255]);
  });

  test('applies text-opacity per feature', () => {
    const layer = labelLayer(
      {'text-field': 'x'},
      {'text-color': '#ff0000', 'text-opacity': ['get', 'o']}
    );
    expect(layer.getLabelColor(feature({o: 0.5}) as any)).toEqual([255, 0, 0, 128]);
  });

  test('applies text-opacity to the fallback color when text-color is not set', () => {
    const layer = labelLayer({'text-field': 'x'}, {'text-opacity': 0.5});
    expect(layer.getLabelColor(feature({}) as any)).toEqual([10, 20, 30, 128]);
  });
});

describe('symbol-sort-key', () => {
  test('gives lower sort keys a higher collision priority', () => {
    const layer = labelLayer({'text-field': 'x', 'symbol-sort-key': ['get', 'rank']});
    const first = layer.getLabelCollisionPriority(feature({rank: 1}) as any);
    const second = layer.getLabelCollisionPriority(feature({rank: 5}) as any);
    expect(first).toBeGreaterThan(second);
  });

  test('falls back to the built-in priority when no sort key is set', () => {
    const layer = labelLayer({'text-field': 'x'});
    expect(layer.getLabelCollisionPriority(feature({class: 'country'}) as any)).toBeGreaterThan(
      layer.getLabelCollisionPriority(feature({class: 'village'}) as any)
    );
  });

  test("stays within deck.gl's collision priority range and keeps order for extreme keys", () => {
    const layer = labelLayer({'text-field': 'x', 'symbol-sort-key': ['get', 'rank']});
    const low = layer.getLabelCollisionPriority(feature({rank: -1e6}) as any);
    const high = layer.getLabelCollisionPriority(feature({rank: 1e6}) as any);
    for (const priority of [low, high]) {
      expect(priority).toBeGreaterThanOrEqual(-1000);
      expect(priority).toBeLessThanOrEqual(1000);
    }
    expect(low).toBeGreaterThan(high);
  });

  test('stays within the priority range given for its style layer', () => {
    const layer = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {layout: {'text-field': 'x', 'symbol-sort-key': ['get', 'rank']}},
      zoom: 8,
      collisionPriorityRange: [-200, 100]
    } as any);
    for (const rank of [-1e9, -3, 0, 7, 1e9]) {
      const priority = layer.getLabelCollisionPriority(feature({rank}) as any);
      expect(priority).toBeGreaterThanOrEqual(-200);
      expect(priority).toBeLessThan(100);
    }
  });
});

describe('update triggers', () => {
  test('re-evaluates only zoom-dependent label accessors when the integer zoom changes', () => {
    const layer = labelLayer(
      {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 20],
        'symbol-sort-key': ['get', 'rank']
      },
      {'text-color': ['step', ['zoom'], '#000000', 8, '#ffffff']},
      7.6
    );
    expect(layer.getLabelUpdateTriggers()).toEqual({
      getText: undefined,
      getSize: 7,
      getColor: 7,
      getCollisionPriority: undefined
    });
  });
});

describe('label defaults and invalid values', () => {
  test('text-color defaults to black without a textColor prop', () => {
    const layer = new MVTLabelLayer({
      id: 'labels',
      config: {labels: true},
      styleLayer: {layout: {'text-field': 'x'}},
      zoom: 8
    } as any);
    expect(layer.getLabelColor(feature({}) as any)).toEqual([0, 0, 0, 255]);
  });

  test('an invalid text-field expression leaves the label empty instead of throwing', () => {
    const layer = labelLayer({'text-field': ['to-string', ['config', 'showLabels']]});
    expect(layer.getLabel(feature({name: 'A'}) as any)).toBeUndefined();
  });
});
