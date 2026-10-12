/* eslint-disable import/no-extraneous-dependencies */
import {SharedMVTLayer} from '@deck.gl-community/geo-layers';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {BasemapLayer} from '../src/basemap-layer';
import {getBasemapLayers, getRunSourceLayers, getStyleLayerRuns} from '../src/globe-layers';

const SOURCES = {
  tiles: {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  },
  relief: {
    type: 'raster',
    tiles: ['https://relief.example.com/{z}/{x}/{y}.png']
  }
};

const LAYERS = [
  {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
  {id: 'relief', type: 'raster', source: 'relief'},
  {
    id: 'roads',
    type: 'line',
    source: 'tiles',
    'source-layer': 'road',
    minzoom: 10
  },
  {id: 'road-casing', type: 'line', source: 'tiles', 'source-layer': 'road'},
  {
    id: 'places',
    type: 'symbol',
    source: 'tiles',
    'source-layer': 'place',
    layout: {}
  }
];

function getTileLayers(layers: unknown[], zoom: number, config?: Record<string, boolean>) {
  return (
    getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom,
      globe: config ? ({config} as any) : undefined,
      styleDefinition: {version: 8, sources: SOURCES, layers} as any
    }) as any[]
  ).filter(layer => layer.constructor.layerName === 'StyledMVTLayer');
}

/** The MVT options that a shared tileset loads a tile with. */
function getTileLoadOptions(tileset: any): any {
  let options: any;
  const spy = vi.spyOn(SharedMVTLayer.prototype, 'getTileData').mockImplementation(function (
    this: SharedMVTLayer
  ) {
    options = (this.props.loadOptions as any)?.mvt;
    return Promise.resolve([]);
  });
  tileset.opts.getTileData({index: {x: 0, y: 0, z: 1}});
  spy.mockRestore();
  return options;
}

afterEach(() => vi.restoreAllMocks());

describe('source layers', () => {
  test('are those of all runs of a source, sorted, whatever the zoom', () => {
    const runs = getStyleLayerRuns(LAYERS as any, {version: 8, sources: SOURCES} as any);
    const names = getRunSourceLayers(runs);
    expect([...names.values()]).toEqual([['place', 'road', 'water']]);

    // The runs of the source share a tileset, which decodes the layers of both, including one
    // that only draws at z10.
    const [first, second] = getTileLayers(LAYERS, 4);
    expect(second.props.data).toBe(first.props.data);
    expect(getTileLoadOptions(first.props.data).layers).toEqual(['place', 'road', 'water']);
  });

  test('include a source layer drawn only above the current zoom', () => {
    const peaks = {id: 'peaks', type: 'line', source: 'tiles', 'source-layer': 'peak', minzoom: 10};
    // After a raster layer, the peaks are a run of their own, which draws nothing at 4.
    const relief = {id: 'relief-2', type: 'raster', source: 'relief'};
    const [first] = getTileLayers([...LAYERS, relief, peaks], 4);
    // Zooming in to 10 does not reload the tiles to decode the peaks.
    expect(getTileLoadOptions(first.props.data).layers).toEqual(['peak', 'place', 'road', 'water']);
  });

  test('leave out labels when labels are off', () => {
    const [first] = getTileLayers(LAYERS, 12, {labels: false});
    expect(getTileLoadOptions(first.props.data).layers).toEqual(['road', 'water']);
  });

  test('are those the application sets in loadOptions.mvt.layers, when it sets them', () => {
    const layers = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 12,
      loadOptions: {mvt: {layers: ['road'], shape: 'geojson'}},
      styleDefinition: {version: 8, sources: SOURCES, layers: LAYERS} as any
    } as any) as any[];
    const [first] = layers.filter(layer => layer.constructor.layerName === 'StyledMVTLayer');
    expect(getTileLoadOptions(first.props.data)).toEqual({layers: ['road'], shape: 'geojson'});
  });

  test('are all source layers when a style layer of the source names none', () => {
    const layers = [...LAYERS, {id: 'any', type: 'line', source: 'tiles'}];
    const [first] = getTileLayers(layers, 12);
    expect(getTileLoadOptions(first.props.data)?.layers).toBeUndefined();
  });
});

describe('basemap source tilesets', () => {
  const style: any = {version: 8, sources: SOURCES, layers: LAYERS};

  /** The tileset of the vector source after the layer updates them with `globe`. */
  function updateTilesets(state: any, globe?: unknown, loadOptions?: unknown): any {
    const layer: any = new BasemapLayer({id: 'basemap', style, globe, loadOptions} as any);
    layer.state = state;
    layer.context = {};
    layer.updateSourceTilesets(style);
    return state.tilesets.get(SOURCES.tiles);
  }

  test('decode the drawn source layers, and reload when they change', () => {
    const state = {tilesets: new Map(), tilesetSourceLayers: new Map()};
    const tileset = updateTilesets(state);
    expect(getTileLoadOptions(tileset).layers).toEqual(['place', 'road', 'water']);
    // The same source layers keep the tileset and its tiles.
    expect(updateTilesets(state)).toBe(tileset);

    // With labels off, the places are not decoded: a new tileset reloads the tiles.
    const finalize = vi.spyOn(tileset, 'finalize');
    const unlabelled = updateTilesets(state, {config: {labels: false}});
    expect(unlabelled).not.toBe(tileset);
    expect(finalize).toHaveBeenCalled();
    expect(getTileLoadOptions(unlabelled).layers).toEqual(['road', 'water']);
    // A replaced source leaves nothing behind.
    const other = {...style, sources: {tiles: {...SOURCES.tiles}}};
    const layer: any = new BasemapLayer({id: 'basemap', style: other} as any);
    layer.state = state;
    layer.context = {};
    layer.updateSourceTilesets(other);
    expect([...state.tilesetSourceLayers.keys()]).toEqual([other.sources.tiles]);
  });

  test('keep the tiles when the basemap is turned off and on', () => {
    const state = {tilesets: new Map(), tilesetSourceLayers: new Map()};
    const tileset = updateTilesets(state);
    expect(updateTilesets(state, {config: {basemap: false}})).toBe(tileset);
    expect(updateTilesets(state)).toBe(tileset);
  });

  test('keep the tiles of an application-set mvt.layers when labels are toggled', () => {
    const state = {tilesets: new Map(), tilesetSourceLayers: new Map()};
    const loadOptions = {mvt: {layers: ['road']}};
    const tileset = updateTilesets(state, undefined, loadOptions);
    expect(getTileLoadOptions(tileset).layers).toEqual(['road']);
    expect(updateTilesets(state, {config: {labels: false}}, loadOptions)).toBe(tileset);
  });
});
