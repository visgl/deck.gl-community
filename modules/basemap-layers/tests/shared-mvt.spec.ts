import {describe, expect, test, vi} from 'vitest';
import {WebMercatorViewport} from '@deck.gl/core';
import {SharedMVTLayer, SharedTileset2D} from '../../geo-layers/src';
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
  // One fetch and decode across consumers, retention and per-consumer detach are covered
  // against SharedMVTLayer and SharedTileset2D in the geo-layers tests.
  test('style runs of one source share its cache and keep it through rerenders', () => {
    const basemap = createBasemap(vi.fn());
    const [first, raster, second]: any[] = basemap.renderLayers();
    expect(first).toBeInstanceOf(SharedMVTLayer);
    expect(raster).not.toBeInstanceOf(SharedMVTLayer);
    expect(first.props.data).toBeInstanceOf(SharedTileset2D);
    expect(second.props.data).toBe(first.props.data);
    expect((basemap.renderLayers()[0] as any).props.data).toBe(first.props.data);
    basemap.finalizeState();
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

test('clearing the style finalizes source caches immediately', () => {
  const basemap = createBasemap(vi.fn());
  const cache = (basemap.renderLayers()[0] as any).props.data;
  const finalize = vi.spyOn(cache, 'finalize');
  basemap.setState = ((state: any) => Object.assign(basemap.state, state)) as any;
  basemap.loadStyle(null, null);
  expect(finalize).toHaveBeenCalledTimes(1);
  expect(basemap.state.tilesets.size).toBe(0);
  expect(basemap.renderLayers()).toEqual([]);
  basemap.finalizeState();
  expect(finalize).toHaveBeenCalledTimes(1);
});

test('direct helper callers share decoded tiles and release the cache with the last consumer', async () => {
  const {getBasemapLayers} = await import('../src/globe-layers');
  const [first, , second]: any[] = getBasemapLayers({styleDefinition: style});
  const cache = first.props.data;
  expect(cache).toBeInstanceOf(SharedTileset2D);
  expect(second.props.data).toBe(cache);
  const decoded: any[] = [];
  const load = vi.fn(async () => decoded);
  cache.setOptions({getTileData: load});
  const finalize = vi.spyOn(cache, 'finalize');
  for (const layer of [first, second]) {
    layer.context = {viewport} as any;
    layer.initializeState();
    layer.setState = ((state: any) => Object.assign(layer.state, state)) as any;
    layer.updateState({changeFlags: {dataChanged: true, propsOrDataChanged: true}} as any);
  }
  await vi.waitFor(() => expect(first.isLoaded && second.isLoaded).toBe(true));
  expect(load).toHaveBeenCalledTimes(1);
  first.finalizeState();
  expect(finalize).not.toHaveBeenCalled();
  second.finalizeState();
  expect(finalize).toHaveBeenCalledTimes(1);
});
