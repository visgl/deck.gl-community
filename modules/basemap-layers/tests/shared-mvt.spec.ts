import {describe, expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {SharedMVTLayer, SharedTileset2D} from '../../geo-layers/src';
import {SharedTile2DView} from '../../geo-layers/src/shared-tile-2d-layer/shared-tile-2d-view';
import {BasemapLayer} from '../src/basemap-layer';

const source = {type: 'vector', maxzoom: 0, tiles: ['https://example.com/{z}/{x}/{y}.pbf']};
const style: any = {
  version: 8,
  sources: {
    tiles: source,
    raster: {type: 'raster', tiles: ['https://example.com/{z}/{x}/{y}.png']}
  },
  layers: [
    {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
    {id: 'raster', type: 'raster', source: 'raster'},
    {id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'roads'}
  ]
};
const viewport = new WebMercatorViewport({width: 128, height: 128, zoom: 0});
function createBasemap(fetch: any) {
  const basemap = new BasemapLayer({id: 'test', style, fetch});
  basemap.initializeState();
  basemap.state.resolvedStyle = style;
  basemap.context = {viewport} as any;
  return basemap;
}

describe('basemap shared MVT tiles', () => {
  test('style runs share settled decoded data and keep the cache through rerenders', async () => {
    const decoded: any[] = [];
    const fetch = vi.fn(async () => decoded);
    const basemap = createBasemap(fetch);
    const [first, , second]: any[] = basemap.renderLayers();
    expect(first).toBeInstanceOf(SharedMVTLayer);
    expect(first.props.data).toBeInstanceOf(SharedTileset2D);
    expect(second.props.data).toBe(first.props.data);
    const a = new SharedTile2DView(first.props.data);
    const b = new SharedTile2DView(second.props.data);
    try {
      a.update(viewport);
      await vi.waitFor(() => expect(a.isLoaded).toBe(true));
      b.update(viewport);
      await vi.waitFor(() => expect(b.isLoaded).toBe(true));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(a.selectedTiles![0].content).toBe(decoded);
      expect(b.selectedTiles![0].content).toBe(decoded);
      expect((basemap.renderLayers()[0] as any).props.data).toBe(first.props.data);
      a.finalize();
      b.update(viewport);
      expect(b.selectedTiles![0].content).toBe(decoded);
    } finally {
      a.finalize();
      b.finalize();
      basemap.finalizeState();
    }
  });

  test('isolates basemap owners and finalizes only the replaced source cache', () => {
    const a = createBasemap(vi.fn());
    const b = createBasemap(vi.fn());
    const cacheA = (a.renderLayers()[0] as any).props.data;
    const cacheB = (b.renderLayers()[0] as any).props.data;
    expect(cacheA).not.toBe(cacheB);
    const finalize = vi.spyOn(cacheA, 'finalize');
    a.state.resolvedStyle = {...style, sources: {...style.sources, tiles: {...source}}};
    expect((a.renderLayers()[0] as any).props.data).not.toBe(cacheA);
    expect(finalize).toHaveBeenCalledTimes(1);
    a.finalizeState();
    b.finalizeState();
  });
});

test('loading options replace the cache, while view mode keeps it', () => {
  const first = createBasemap(vi.fn());
  const cache = (first.renderLayers()[0] as any).props.data;
  const globe = first.clone({mode: 'globe'});
  globe.state = first.state;
  globe.context = first.context;
  expect(
    (globe.renderLayers().find((layer: any) => layer.id === 'test-tiles') as any).props.data
  ).toBe(cache);
  const finalize = vi.spyOn(cache, 'finalize');
  const configured = globe.clone({loadOptions: {mvt: {layerProperty: 'sourceLayer'}}});
  configured.state = globe.state;
  configured.context = globe.context;
  expect(
    (configured.renderLayers().find((layer: any) => layer.id === 'test-tiles') as any).props.data
  ).not.toBe(cache);
  expect(finalize).toHaveBeenCalledTimes(1);
  configured.finalizeState();
});
