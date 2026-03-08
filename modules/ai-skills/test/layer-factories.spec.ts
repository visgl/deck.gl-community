// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import {scatterplotLayer, arcLayer, heatmapLayer} from '../src/layer-factories';
import {createDescriptor, validateDescriptor, hydrateDescriptor} from '../src/layer-descriptors';
import {DeckBuilder} from '../src/deck-builder';
import {fitViewport, getBoundingBox} from '../src/viewport-skills';

describe('scatterplotLayer', () => {
  it('applies sensible defaults', () => {
    const props = scatterplotLayer({data: [], id: 'test'});
    expect(props.id).toBe('test');
    expect(props.radiusScale).toBe(1);
    expect(props.pickable).toBe(true);
  });

  it('overrides defaults', () => {
    const props = scatterplotLayer({data: [], opacity: 0.5, radiusScale: 2});
    expect(props.opacity).toBe(0.5);
    expect(props.radiusScale).toBe(2);
  });
});

describe('arcLayer', () => {
  it('returns default colors', () => {
    const props = arcLayer({data: []});
    expect(props.getSourceColor).toEqual([0, 128, 200]);
    expect(props.getTargetColor).toEqual([200, 0, 80]);
  });
});

describe('heatmapLayer', () => {
  it('returns a 6-stop color range by default', () => {
    const props = heatmapLayer({data: []});
    expect(props.colorRange).toHaveLength(6);
  });
});

describe('createDescriptor / validateDescriptor', () => {
  it('validates a correct descriptor', () => {
    const desc = createDescriptor('ScatterplotLayer', {
      data: [],
      getPosition: 'coordinates'
    });
    const result = validateDescriptor(desc);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports missing required props', () => {
    const desc = createDescriptor('ScatterplotLayer', {data: []});
    const result = validateDescriptor(desc);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('getPosition'))).toBe(true);
  });

  it('reports unknown layer type', () => {
    const desc = createDescriptor('FakeLayer' as never, {data: []});
    const result = validateDescriptor(desc);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/Unknown layer type/);
  });
});

describe('hydrateDescriptor', () => {
  it('resolves dot-path accessor strings to functions', () => {
    const desc = createDescriptor('ScatterplotLayer', {
      data: [],
      getPosition: 'location.coords',
      getFillColor: [255, 0, 0]
    });
    const hydrated = hydrateDescriptor(desc);
    expect(typeof hydrated.getPosition).toBe('function');
    expect(typeof hydrated.getFillColor).not.toBe('function');
  });

  it('resolves nested dot-paths correctly', () => {
    const desc = createDescriptor('ScatterplotLayer', {
      data: [],
      getPosition: 'meta.position'
    });
    const hydrated = hydrateDescriptor(desc);
    const accessor = hydrated.getPosition as (d: unknown) => unknown;
    expect(accessor({meta: {position: [1, 2]}})).toEqual([1, 2]);
  });
});

describe('DeckBuilder', () => {
  it('builds a DeckConfig with layers and viewState', () => {
    const config = new DeckBuilder()
      .addLayer(createDescriptor('ScatterplotLayer', {data: [], getPosition: 'coords'}))
      .setViewState({longitude: -74, latitude: 40.7, zoom: 10})
      .build();

    expect(config.layers).toHaveLength(1);
    expect(config.viewState.zoom).toBe(10);
    expect(config.mapStyle).toBeUndefined();
  });

  it('includes mapStyle when set', () => {
    const config = new DeckBuilder().setMapStyle('https://example.com/style.json').build();
    expect(config.mapStyle).toBe('https://example.com/style.json');
  });
});

describe('viewport helpers', () => {
  const positions: [number, number][] = [
    [-74.006, 40.7128],
    [-118.2437, 34.0522],
    [-87.6298, 41.8781]
  ];

  it('getBoundingBox returns correct bounds', () => {
    const bbox = getBoundingBox(positions);
    if (!bbox) throw new Error('expected bbox');
    expect(bbox[0]).toBe(-118.2437);
    expect(bbox[3]).toBe(41.8781);
  });

  it('getBoundingBox returns null for empty array', () => {
    expect(getBoundingBox([])).toBeNull();
  });

  it('fitViewport returns a valid zoom level', () => {
    const vs = fitViewport(positions);
    expect(vs.zoom).toBeGreaterThanOrEqual(0);
    expect(vs.zoom).toBeLessThanOrEqual(20);
    expect(vs.longitude).toBeCloseTo(-96.12, 1);
  });
});
