import {expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {BasemapLayer} from '../src/basemap-layer';

test('BasemapLayer forwards a terrain query without owning a provider or loading a style', () => {
  const layer = new BasemapLayer({id: 'terrain-query', style: null});
  const viewport = new WebMercatorViewport({
    width: 200,
    height: 100,
    longitude: 0,
    latitude: 0,
    zoom: 2
  });
  const intersectRay = vi.fn(() => null);
  expect(
    layer.getTerrainAt(
      viewport,
      [100, 50],
      {projection: 'web-mercator', intersectRay},
      new Matrix4()
    )
  ).toBeNull();
  expect(intersectRay).toHaveBeenCalledOnce();
});
