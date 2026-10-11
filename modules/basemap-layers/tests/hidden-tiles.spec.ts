/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test, vi} from 'vitest';
import {getBasemapLayers} from '../src/index.ts';

const STYLE: any = {
  version: 8,
  sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
  layers: [{id: 'roads', type: 'line', source: 'tiles', 'source-layer': 'roads'}]
};

const FEATURES = [
  {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 1]
      ]
    },
    properties: {layerName: 'roads'}
  }
];

function createTile(x: number, isVisible: boolean) {
  return {
    id: `${x}-0-12`,
    index: {x, y: 0, z: 12},
    bbox: {left: 0, top: 0, right: 1, bottom: 1},
    isVisible,
    isLoaded: true,
    content: FEATURES
  };
}

/**
 * The vector tile layer of `STYLE`, rendering `tiles` of its shared tileset, in one view that
 * shows the tiles whose `isVisible` is set.
 */
function createTileLayer(tiles: any[]) {
  const layer: any = getBasemapLayers({
    idPrefix: 'test',
    mode: 'map',
    zoom: 12,
    styleDefinition: STYLE
  }).find((l: any) => l.id === 'test-tiles');
  layer.context = {viewport: {zoom: 12}};
  const tileLayers = new Map();
  const view = {isTileVisible: (tile: any) => tile.isVisible};
  layer.state = {tileset: {tiles}, tileLayers, tilesetViews: new Map([['default', view]])};
  /** The sublayers the layer holds for `tile`. */
  const layersOf = (tile: any) => tileLayers.get(tile.id);
  const spy = vi.spyOn(layer, 'renderSubLayers');
  // The calls that generated sublayers, rather than leaving out a hidden tile.
  const renderSubLayers = {
    get calls() {
      return spy.mock.results.filter(result => result.value).length;
    },
    mockClear: () => spy.mockClear()
  };
  /** Renders after a `renderSubLayers` update, which clears every tile's sublayers. */
  const renderAfterUpdate = () => {
    tileLayers.clear();
    return layer.renderLayers();
  };
  return {layer, renderSubLayers, renderAfterUpdate, layersOf};
}

describe('hidden tiles', () => {
  test('keep their sublayers at a zoom step and regenerate them when shown again', () => {
    const shown = createTile(0, true);
    const hidden = createTile(1, true);
    const {renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([shown, hidden]);
    renderAfterUpdate();
    const hiddenLayers = layersOf(hidden);
    expect(hiddenLayers).toHaveLength(1);
    expect(renderSubLayers.calls).toBe(2);

    hidden.isVisible = false;
    renderSubLayers.mockClear();
    const drawn = renderAfterUpdate();
    // Only the shown tile regenerates; the hidden one keeps its sublayers, in the layer tree.
    expect(renderSubLayers.calls).toBe(1);
    expect(layersOf(hidden)[0]).toBe(hiddenLayers[0]);
    expect(drawn).toContain(hiddenLayers[0]);

    hidden.isVisible = true;
    renderSubLayers.mockClear();
    renderAfterUpdate();
    expect(layersOf(hidden)).toHaveLength(1);
    expect(layersOf(hidden)[0]).not.toBe(hiddenLayers[0]);
    expect(renderSubLayers.calls).toBe(2);
  });

  test('a tile hidden before it has sublayers gets them when shown', () => {
    const tile = createTile(0, false);
    const {layer, renderSubLayers, renderAfterUpdate} = createTileLayer([tile]);
    expect(renderAfterUpdate()).toEqual([]);
    expect(renderSubLayers.calls).toBe(0);

    // Shown without a `renderSubLayers` update: the tile's empty sublayers are kept.
    tile.isVisible = true;
    expect(layer.renderLayers()).toHaveLength(1);
    expect(renderSubLayers.calls).toBe(1);
  });

  test('a tile whose content is reloaded or evicted drops its kept sublayers', () => {
    const tile = createTile(0, true);
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([tile]);
    renderAfterUpdate();
    const before = layersOf(tile);
    tile.isVisible = false;
    layer._onTileLoad(tile);
    renderSubLayers.mockClear();
    renderAfterUpdate();
    // Not regenerated while hidden, and not given the sublayers of its previous content.
    expect(renderSubLayers.calls).toBe(0);
    expect(layersOf(tile)).toEqual([]);
    expect(layersOf(tile)).not.toBe(before);
  });
});
