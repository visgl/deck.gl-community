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

    // While it stays hidden it is the same instance, which deck.gl does not update.
    expect(labelLayers(layer, onlyWithoutPlaces)[0]).toBe(kept);

    const [again] = labelLayers(layer, all);
    expect(again.id).toBe(drawn.id);
    expect(again.props.visible).not.toBe(false);
    // The same tiles are drawn again: the same data.
    expect(again.props.tiles).toBe(drawn.props.tiles);
  });

  test("keeps its instance while another style layer's tiles change", () => {
    const twoLayers = style();
    twoLayers.layers.push({
      id: 'roads',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'road',
      layout: {'text-field': '{name}'}
    });
    const road = {
      ...withoutPlaces,
      id: '2-0-2',
      index: {x: 2, y: 0, z: 2},
      content: [point('road', 'Main')]
    };
    const state = {tileLayers: new Map(), tileset: {tiles: [withPlace, road]}};
    const layer = tileLayer(2, state, twoLayers);
    const [places, roads] = labelLayers(layer, all);
    // The road's tile changes its content: only the roads label layer is made again.
    road.content = [point('road', 'High')];
    const [placesAfter, roadsAfter] = labelLayers(layer, all);
    expect(placesAfter).toBe(places);
    expect(roadsAfter).not.toBe(roads);
  });

  test('keeps its instance while hidden across a zoom step, and takes the new zoom when shown', () => {
    const shared = style();
    const state = freshState();
    labelLayers(tileLayer(2, state, shared), all);
    const [kept] = labelLayers(tileLayer(2, state, shared), onlyWithoutPlaces);
    // A style zoom step gives the tile layer new props; the hidden label layer stays as it is.
    const [stillKept] = labelLayers(tileLayer(2.25, state, shared), onlyWithoutPlaces);
    expect(stillKept).toBe(kept);
    const [shown] = labelLayers(tileLayer(2.25, state, shared), all);
    expect(shown).not.toBe(kept);
    expect(shown.props.visible).not.toBe(false);
    expect(shown.props.zoom).toBe(2.25);
    expect(kept.props.zoom).toBe(2);
  });

  test('is not kept for a new style, which has no label layers yet', () => {
    const state = freshState();
    labelLayers(tileLayer(2, state, style()), all);
    expect(labelLayers(tileLayer(2, state, style()), onlyWithoutPlaces)).toEqual([]);
  });

  test('is kept across one tile zoom, and removed two tile zooms away', () => {
    const deeper = {id: '0-0-3', index: {x: 0, y: 0, z: 3}, isLoaded: true, content: []};
    const deepest = {id: '0-0-4', index: {x: 0, y: 0, z: 4}, isLoaded: true, content: []};
    const state = {
      tileLayers: new Map(),
      tileset: {tiles: [withoutPlaces, withPlace, deeper, deepest]}
    };
    const layer = tileLayer(4, state);
    const [drawn] = labelLayers(layer, tile => tile.index.z === 2);
    // Tiles of zoom 3 drawn: the zoom 2 tiles may return, as across one tile zoom step.
    const [kept] = labelLayers(layer, tile => tile === deeper);
    expect(kept.id).toBe(drawn.id);
    expect(kept.props.visible).toBe(false);
    // Tiles of zoom 4 drawn: they are two tile zooms away.
    expect(labelLayers(layer, tile => tile === deepest)).toEqual([]);
  });

  test('is forgotten with its style, also while the drawn tiles load', () => {
    const twoLayers = style();
    twoLayers.layers.unshift({
      id: 'names',
      type: 'symbol',
      source: 'tiles',
      'source-layer': 'place',
      layout: {'text-field': '{name}'}
    });
    const state = freshState();
    expect(labelLayers(tileLayer(2, state, twoLayers), all)).toHaveLength(2);
    // A style with fewer layers, while no drawn tile is labelled yet.
    const loading = () => false;
    expect(() => labelLayers(tileLayer(2, state, style()), loading)).not.toThrow();
    expect(labelLayers(tileLayer(2, state, style()), loading)).toEqual([]);
  });

  test('is forgotten with its tileset', () => {
    const state: any = freshState();
    const layer = tileLayer(2, state);
    expect(labelLayers(layer, all)).toHaveLength(1);
    // Another tileset, whose tiles are not labelled yet.
    state.tileset = {tiles: [{...withoutPlaces}, {...withPlace}]};
    expect(labelLayers(layer, () => false)).toEqual([]);
  });

  test('is not made for a style layer index the style does not have', () => {
    const layer = tileLayer(2, freshState());
    expect(
      layer.props.renderLabelLayers(new Map([[5, []]]), (id: string) => ({id}), new Set())
    ).toEqual([]);
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
