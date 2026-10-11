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
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([shown, hidden]);
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

    // Shown again without a `renderSubLayers` update, as when the view pans back.
    hidden.isVisible = true;
    renderSubLayers.mockClear();
    layer.renderLayers();
    // Regenerated; a sublayer whose props did not change keeps its instance (see
    // tile-layer-reuse.spec).
    expect(layersOf(hidden)).toHaveLength(1);
    expect(renderSubLayers.calls).toBe(1);
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

  test('a tile that left the tileset without an unload event drops its kept sublayers', () => {
    const tile = createTile(0, true);
    const tiles = [tile];
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer(tiles);
    renderAfterUpdate();
    // `reloadAll` drops the tile; deck.gl finalizes its sublayers. Later a new tile of the same id,
    // hidden, takes its place.
    tiles.length = 0;
    layer.renderLayers();
    tiles.push(createTile(0, false));
    renderSubLayers.mockClear();
    renderAfterUpdate();
    expect(renderSubLayers.calls).toBe(0);
    expect(layersOf(tiles[0])).toEqual([]);
  });

  test('a shown tile replaced by another tile of the same id gets new sublayers', () => {
    const tiles = [createTile(0, true)];
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer(tiles);
    renderAfterUpdate();
    // Without an unload event, and without a `renderSubLayers` update.
    tiles[0] = createTile(0, true);
    renderSubLayers.mockClear();
    layer.renderLayers();
    expect(renderSubLayers.calls).toBe(1);
    expect(layersOf(tiles[0])[0].props.tile).toBe(tiles[0]);
  });

  test('a tile replaced by another tile of the same id drops its kept sublayers', () => {
    const tiles = [createTile(0, true)];
    const {renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer(tiles);
    renderAfterUpdate();
    // Between two renders, `reloadAll` drops the tile and a new, hidden one takes its id.
    tiles[0] = createTile(0, false);
    renderSubLayers.mockClear();
    renderAfterUpdate();
    expect(renderSubLayers.calls).toBe(0);
    expect(layersOf(tiles[0])).toEqual([]);
  });

  test.each([
    '_onTileLoad',
    '_onTileUnload'
  ])('a tile whose content is reloaded or evicted drops its kept sublayers (%s)', event => {
    const tile = createTile(0, true);
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([tile]);
    renderAfterUpdate();
    const before = layersOf(tile);
    tile.isVisible = false;
    layer[event](tile);
    renderSubLayers.mockClear();
    renderAfterUpdate();
    // Not regenerated while hidden, and not given the sublayers of its previous content.
    expect(renderSubLayers.calls).toBe(0);
    expect(layersOf(tile)).toEqual([]);
    expect(layersOf(tile)).not.toBe(before);
  });

  test('a tile shown in any view regenerates its sublayers', () => {
    const tile = createTile(0, true);
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([tile]);
    renderAfterUpdate();
    // Hidden in the first view, shown in a second one. Regenerated; a sublayer whose props did not
    // change keeps its instance (see tile-layer-reuse.spec).
    tile.isVisible = false;
    layer.state.tilesetViews.set('second', {isTileVisible: () => true});
    renderSubLayers.mockClear();
    renderAfterUpdate();
    expect(renderSubLayers.calls).toBe(1);
    expect(layersOf(tile)).toHaveLength(1);
  });

  test.each([
    ['another tileset', (state: any) => (state.tileset = {tiles: state.tileset.tiles})],
    ['a switch between a map and a globe', (state: any) => (state.geographic = !state.geographic)]
  ])('%s drops the kept sublayers', (_, change) => {
    const tile = createTile(0, true);
    const {layer, renderSubLayers, renderAfterUpdate, layersOf} = createTileLayer([tile]);
    renderAfterUpdate();
    tile.isVisible = false;
    // The vector tile layer's own update: here it only makes the change.
    const parent = Object.getPrototypeOf(Object.getPrototypeOf(layer));
    const updateState = vi.spyOn(parent, 'updateState').mockImplementation(function (this: any) {
      change(this.state);
    });
    try {
      layer.updateState({props: layer.props, oldProps: layer.props, changeFlags: {}});
    } finally {
      updateState.mockRestore();
    }
    renderSubLayers.mockClear();
    renderAfterUpdate();
    // Not handed the sublayers made for the previous tileset or view mode.
    expect(renderSubLayers.calls).toBe(0);
    expect(layersOf(tile)).toEqual([]);
  });
});
