/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {getBasemapLayers} from '../src/globe-layers.ts';

// A symbol style layer whose features are only in some of the drawn tiles loses them when those
// tiles are hidden, as at the edge of a moving view. Its label layer is kept, hidden, so that it
// keeps its state when they are shown again.

const point = (layerName: string, name: string) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [0.5, 0.5]},
  properties: {layerName, name}
});

const style = (minzoom?: number): any => ({
  version: 8,
  sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
  layers: [
    {
      id: 'places',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'place',
      ...(minzoom === undefined ? {} : {minzoom}),
      layout: {'text-field': '{name}'}
    }
  ]
});

/** A tile without places, and one with a place. */
const withoutPlaces = {id: '0-0-2', index: {x: 0, y: 0, z: 2}, isLoaded: true, content: []};
const withPlace = {
  id: '1-0-2',
  index: {x: 1, y: 0, z: 2},
  isLoaded: true,
  content: [point('place', 'Town')]
};

/** The vector tile layer of `style` at `zoom`, with the given tile state, as deck.gl holds it. */
function tileLayer(zoom: number, state: Record<string, any>, styleDefinition = style()): any {
  const [layer]: any[] = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom,
    styleDefinition
  }).filter((l: any) => l.id.startsWith('test-tiles'));
  layer.context = {viewport: {zoom, resolution: 0}};
  layer.internalState = {};
  layer.state = state;
  return layer;
}

/** The label layers of a tile layer whose tiles `shown` accepts, after its tiles render. */
function labelLayers(layer: any, shown: (tile: any) => boolean): any[] {
  layer.state.tilesetViews = new Map([['default', {isTileVisible: shown}]]);
  layer.state.tileLayers.clear();
  layer.renderLayers();
  return layer.renderLayers().filter((l: any) => l.props.tiles);
}

const freshState = () => ({
  tileLayers: new Map(),
  tileset: {tiles: [withoutPlaces, withPlace]}
});

const all = () => true;
const onlyWithoutPlaces = (tile: any) => tile === withoutPlaces;

describe('a label layer whose drawn tiles lose its features', () => {
  test('is not made while no drawn tile has its features', () => {
    const layer = tileLayer(2, freshState());
    expect(labelLayers(layer, onlyWithoutPlaces)).toEqual([]);
  });

  test('is kept, hidden, and shown again with the same id when they return', () => {
    const layer = tileLayer(2, freshState());
    const [drawn] = labelLayers(layer, all);
    expect(drawn.props.visible).not.toBe(false);
    expect(drawn.props.tiles.flatMap((tile: any) => tile.features)).toHaveLength(1);

    const [kept] = labelLayers(layer, onlyWithoutPlaces);
    expect(kept.id).toBe(drawn.id);
    expect(kept.props.visible).toBe(false);
    // With the tiles it last drew: its data does not change.
    expect(kept.props.tiles).toBe(drawn.props.tiles);

    const [again] = labelLayers(layer, all);
    expect(again.id).toBe(drawn.id);
    expect(again.props.visible).not.toBe(false);
    // The same tiles are drawn again: the same data.
    expect(again.props.tiles).toBe(drawn.props.tiles);
  });

  test('is removed outside its zoom range', () => {
    // Another symbol layer, drawn at every zoom, keeps the tile layer.
    const zoomed = style(5);
    zoomed.layers.push({
      id: 'names',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'place',
      layout: {'text-field': '{name}'}
    });
    const state = freshState();
    const ids = (layers: any[]) => layers.map(l => l.id.replace(/^test-tiles-/, ''));
    expect(ids(labelLayers(tileLayer(6, state, zoomed), all))).toEqual([
      'labels-"places"',
      'labels-"names"'
    ]);
    // The same tile layer state at a zoom below the style layer's minzoom.
    expect(ids(labelLayers(tileLayer(4, state, zoomed), all))).toEqual(['labels-"names"']);
  });
});
