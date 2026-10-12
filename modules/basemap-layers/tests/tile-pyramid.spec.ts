/* eslint-disable import/no-extraneous-dependencies */
import {_GlobeViewport as GlobeViewport, WebMercatorViewport} from '@deck.gl/core';
import {TileLayer, _Tileset2D as Tileset2D} from '@deck.gl/geo-layers';
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const STYLE: any = {
  version: 8,
  sources: {
    vector: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt'], maxzoom: 14},
    raster: {type: 'raster', tiles: ['https://tiles.example.com/{z}/{x}/{y}.png'], maxzoom: 6},
    detail: {type: 'vector', tiles: ['https://detail.example.com/{z}/{x}/{y}.mvt'], minzoom: 4}
  },
  layers: [
    {id: 'imagery', type: 'raster', source: 'raster'},
    {id: 'water', type: 'fill', source: 'vector', 'source-layer': 'water'},
    {id: 'roads', type: 'line', source: 'detail', 'source-layer': 'roads'}
  ]
};

/**
 * A globe looking over the north pole. `GlobeView` lowers the zoom with the latitude, so that the
 * globe keeps its size on screen: this globe, whole on screen, has a zoom below 0.
 */
const POLAR_VIEW = {longitude: 167.79, latitude: 76.15, zoom: -1.16, bearing: 167.5, pitch: 30};

function getTileLayers(mode: 'map' | 'globe', zoom: number): Record<string, any> {
  const layers = getBasemapLayers({idPrefix: 'test', mode, zoom, styleDefinition: STYLE});
  return Object.fromEntries(layers.map(layer => [layer.id, layer]));
}

/** The tiles deck.gl's tileset selects for a tile layer's props in `viewport`. */
function getTileIndices(layer: any, viewport: any): string[] {
  const {tileSize, minZoom, maxZoom, extent, zoomOffset} = layer.props;
  const tileset = new Tileset2D({getTileData: () => null, tileSize, extent, zoomOffset} as any);
  return tileset
    .getTileIndices({viewport, minZoom, maxZoom} as any)
    .map(({x, y, z}: any) => `${z}/${x}/${y}`);
}

/**
 * Whether `TileLayer.renderLayers` hides all tiles of a tile layer in `viewport`. Hidden, it
 * returns no entry at all; otherwise one entry per tile, even an empty one.
 */
function isHidden(layer: any, viewport: any): boolean {
  const tile = {isLoaded: true, content: [], layers: [], index: {x: 0, y: 0, z: 0}};
  const rendered = TileLayer.prototype.renderLayers.call({
    props: layer.props,
    context: {viewport},
    state: {tileset: {tiles: [tile]}},
    getSubLayerPropsByTile: () => null
  } as any) as unknown[];
  return rendered.length === 0;
}

describe('tile pyramid range', () => {
  const viewport = new GlobeViewport({...POLAR_VIEW, width: 800, height: 600});

  test('the polar view has a zoom below 0', () => {
    expect(viewport.zoom).toBeLessThan(-0.5);
  });

  test('a globe below zoom 0 draws the zoom 0 tiles of vector and raster sources', () => {
    const layers = getTileLayers('globe', viewport.zoom);
    for (const id of ['test-vector', 'test-imagery']) {
      expect(isHidden(layers[id], viewport), id).toBe(false);
      expect(getTileIndices(layers[id], viewport), id).toContain('0/0/0');
    }
  });

  test('a source whose tiles start above zoom 0 draws nothing below its minzoom', () => {
    const layers = getTileLayers('globe', viewport.zoom);
    expect(isHidden(layers['test-detail'], viewport)).toBe(true);
    expect(getTileIndices(layers['test-detail'], viewport)).toEqual([]);
  });

  test('tile selection at zoom 0 and above is unchanged on a map and on a globe', () => {
    for (const [mode, view] of [
      [
        'map',
        new WebMercatorViewport({longitude: 2, latitude: 48, zoom: 3, width: 800, height: 600})
      ],
      ['globe', new GlobeViewport({longitude: 2, latitude: 48, zoom: 3, width: 800, height: 600})]
    ] as const) {
      const layers = getTileLayers(mode, view.zoom);
      for (const id of ['test-vector', 'test-imagery', 'test-detail']) {
        expect(getTileIndices(layers[id], view), `${mode} ${id}`).toEqual(
          getTileIndices({props: {...layers[id].props, extent: null}}, view)
        );
      }
    }
  });
});

describe('shared vector tilesets', () => {
  const viewport = new GlobeViewport({...POLAR_VIEW, width: 800, height: 600});

  /** The tiles a vector tile layer's shared tileset selects in `viewport`, as its view does. */
  function getSharedTileIndices(layer: any): string[] {
    const tileset = layer.props.data;
    return tileset
      .getTileIndices({
        viewState: viewport,
        minZoom: tileset.minZoom,
        maxZoom: tileset.maxZoom,
        zRange: null
      })
      .map(({x, y, z}: any) => `${z}/${x}/${y}`);
  }

  test('select the zoom 0 tiles below zoom 0, and nothing below a minzoom above 0', () => {
    const layers = getTileLayers('globe', viewport.zoom);
    expect(getSharedTileIndices(layers['test-vector'])).toContain('0/0/0');
    expect(getSharedTileIndices(layers['test-detail'])).toEqual([]);
  });
});
