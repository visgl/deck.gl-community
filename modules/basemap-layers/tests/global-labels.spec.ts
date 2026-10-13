/* eslint-disable import/no-extraneous-dependencies */
import {describe, expect, test} from 'vitest';
import {MVTLabelLayer, combineTileRows} from '../src/mvt-label-layer.ts';
import {getBasemapLayers, getStyleLayerRuns} from '../src/globe-layers.ts';

/** Longitude/latitude of a point given in world units, `[0, 1]` across the world. */
function lngLat(x: number, y: number): number[] {
  return [x * 360 - 180, (360 / Math.PI) * Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - 90];
}

function tile(x: number, y: number, z: number): any {
  return {index: {x, y, z}, features: []};
}

describe('labels of several tiles', () => {
  test("a parent tile's labels give way where a child tile is drawn, and stay elsewhere", () => {
    const parent = tile(0, 0, 1);
    // The top-left quarter of the parent.
    const child = tile(0, 0, 2);
    const inChild = {position: lngLat(0.1, 0.1)};
    const outsideChild = {position: lngLat(0.4, 0.1)};
    const childRow = {position: lngLat(0.1, 0.12)};
    const rows = combineTileRows([parent, child], [[inChild, outsideChild], [childRow]]);
    expect(rows).toEqual([outsideChild, childRow]);
  });

  test('tiles of one zoom keep all of their rows, in tile order', () => {
    const a = {position: lngLat(0.1, 0.1)};
    const b = {position: lngLat(0.6, 0.1)};
    expect(combineTileRows([tile(0, 0, 1), tile(1, 0, 1)], [[a], [b]])).toEqual([a, b]);
  });

  test('an anchor on a child tile edge is covered by the child it lies in', () => {
    // World y 1/16 is the top edge of child row 1 at zoom 4; through latitude it rounds below.
    const row = {position: lngLat(0.01, 1 / 16), world: [0.01, 1 / 16]};
    expect(combineTileRows([tile(0, 0, 3), tile(0, 1, 4)], [[row], []])).toEqual([]);
  });

  test('a grandchild tile replaces the labels it covers', () => {
    const row = {position: lngLat(0.01, 0.01)};
    expect(combineTileRows([tile(0, 0, 1), tile(0, 0, 3)], [[row], []])).toEqual([]);
  });
});

describe('style layer runs with labels', () => {
  const source = {
    type: 'vector',
    tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']
  };
  const style: any = {version: 8, sources: {tiles: source}, layers: []};
  const layer = (id: string, type: string) => ({
    id,
    type,
    source: 'tiles',
    'source-layer': 'l'
  });

  test('a layer drawn after a label layer starts a new run', () => {
    const layers: any[] = [
      layer('fill', 'fill'),
      layer('label', 'symbol'),
      layer('road', 'line'),
      layer('label2', 'symbol')
    ];
    const runs = getStyleLayerRuns(layers, style, {labels: true} as any);
    expect(runs.map(run => run.styleLayers.map(l => l.id))).toEqual([
      ['fill', 'label'],
      ['road', 'label2']
    ]);
  });

  test('without labels, the layers stay in one run', () => {
    const layers: any[] = [layer('fill', 'fill'), layer('label', 'symbol'), layer('road', 'line')];
    const runs = getStyleLayerRuns(layers, style, {labels: false} as any);
    expect(runs.map(run => run.styleLayers.map(l => l.id))).toEqual([['fill', 'road']]);
  });
});

/** Runs `updateState` outside deck.gl, carrying state over as deck.gl does between updates. */
function update(props: Record<string, any>, state: Record<string, any>): void {
  const layer = new MVTLabelLayer({
    id: 'labels',
    config: {labels: true},
    zoom: 10,
    styleLayer: {layout: {'text-field': '{name}'}},
    ...props
  } as any);
  (layer as any).context = {viewport: {}};
  (layer as any).state = state;
  (layer as any).setState = (partial: Record<string, any>) => Object.assign(state, partial);
  layer.updateState({changeFlags: {}} as any);
}

function pointFeature(x: number, y: number, name: string): any {
  return {
    geometry: {type: 'Point', coordinates: [x, y]},
    properties: {name}
  };
}

describe('a label layer of several tiles', () => {
  test('places tile-local anchors in longitude/latitude, leaving out those outside their tile', () => {
    const tiles = [
      // In the tile, and in the buffer of the tile on the right.
      {
        index: {x: 1, y: 2, z: 2},
        features: [pointFeature(0.5, 0.25, 'a'), pointFeature(1.02, 0.5, 'b')]
      }
    ];
    const state: Record<string, any> = {};
    update({tiles}, state);
    expect(state.labelData).toHaveLength(1);
    const [lng, lat] = state.labelData[0].position;
    const [expectedLng, expectedLat] = lngLat(1.5 / 4, 2.25 / 4);
    expect(lng).toBeCloseTo(expectedLng, 9);
    expect(lat).toBeCloseTo(expectedLat, 9);
    expect(state.labelData[0].__source.object.properties.name).toBe('a');
  });

  test("keeps a tile's anchors while its features do not change, and combines the tiles again", () => {
    const a = {
      index: {x: 0, y: 0, z: 1},
      features: [pointFeature(0.5, 0.5, 'a')]
    };
    const b = {
      index: {x: 1, y: 0, z: 1},
      features: [pointFeature(0.5, 0.5, 'b')]
    };
    const state: Record<string, any> = {};
    update({tiles: [a]}, state);
    const rowsOfA = state.tileRows.get('0,0,1').rows;
    update({tiles: [a, b]}, state);
    expect(state.tileRows.get('0,0,1').rows).toBe(rowsOfA);
    expect(state.labelData.map((row: any) => row.__source.object.properties.name)).toEqual([
      'a',
      'b'
    ]);
    const first = state.labelData;
    const same = [a, b];
    update({tiles: same}, state);
    update({tiles: same}, state);
    expect(state.labelData).not.toBe(first);
    const second = state.labelData;
    update({tiles: same}, state);
    expect(state.labelData).toBe(second);
  });

  test('places a tile again when its features or the anchor inputs change', () => {
    const a = {index: {x: 0, y: 0, z: 1}, features: [pointFeature(0.5, 0.5, 'a')]};
    const state: Record<string, any> = {};
    update({tiles: [a]}, state);
    const rows = state.tileRows.get('0,0,1').rows;
    // New features of the same tile.
    update({tiles: [{...a, features: [pointFeature(0.25, 0.25, 'c')]}]}, state);
    expect(state.labelData.map((row: any) => row.__source.object.properties.name)).toEqual(['c']);
    // The same features, placed along lines instead of at points.
    const placedRows = state.tileRows.get('0,0,1').rows;
    update(
      {
        tiles: [{...a, features: state.tileRows.get('0,0,1').features}],
        styleLayer: {layout: {'text-field': '{name}', 'symbol-placement': 'line'}}
      },
      state
    );
    expect(state.tileRows.get('0,0,1').rows).not.toBe(placedRows);
    expect(rows).not.toBe(placedRows);
  });

  test('records the tile of each row, which picking reports', () => {
    const tile = {id: '0-0-1'};
    const state: Record<string, any> = {};
    update(
      {tiles: [{index: {x: 0, y: 0, z: 1}, features: [pointFeature(0.5, 0.5, 'a')], tile}]},
      state
    );
    expect(state.labelData[0].__tile).toBe(tile);
  });
});

describe('label layers of tile layers sharing tiles', () => {
  test("each run labels a shared tile with its own symbol layers' features", () => {
    const source = {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']};
    const symbol = (id: string, sourceLayer: string) => ({
      id,
      type: 'symbol',
      source: 'tiles',
      'source-layer': sourceLayer,
      layout: {'text-field': '{name}'}
    });
    const style: any = {
      version: 8,
      sources: {tiles: source},
      // The fill after the first label layer starts a second run of the source.
      layers: [
        symbol('places', 'place'),
        {id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water'},
        symbol('roads', 'road')
      ]
    };
    const point = (layerName: string) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [0.5, 0.5]},
      properties: {layerName, name: layerName}
    });
    // One tile object, as the source's shared tileset hands it to both runs.
    const sharedTile = {
      id: '0-0-1',
      index: {x: 0, y: 0, z: 1},
      isLoaded: true,
      content: [point('place'), point('road')]
    };
    const runs = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 1,
      styleDefinition: style
    }).filter((layer: any) => layer.id.startsWith('test-tiles'));
    expect(runs).toHaveLength(2);
    const labelFeatures = runs.map((run: any) => {
      run.context = {viewport: {zoom: 1, resolution: 0}};
      run.internalState = {};
      run.state = {
        tileLayers: new Map(),
        tilesetViews: new Map([['default', {isTileVisible: () => true}]]),
        tileset: {tiles: [sharedTile]}
      };
      return run;
    });
    // Both runs render the tile before either draws its labels.
    for (const run of labelFeatures) {
      run.renderLayers();
    }
    const labelLayers = labelFeatures.map((run: any) =>
      run.renderLayers().filter((layer: any) => layer.props.tiles)
    );
    expect(labelLayers.map(layers => layers.map((layer: any) => layer.id))).toEqual([
      ['test-tiles-labels-"places"'],
      ['test-tiles-"water"-labels-"roads"']
    ]);
    expect(
      labelLayers.map(([layer]) =>
        layer.props.tiles.map((tile: any) => tile.features.map((f: any) => f.properties.name))
      )
    ).toEqual([[['place']], [['road']]]);

    // Kept while the tiles and the tile layer's props do not change; new once a tile is hidden.
    const [first] = labelFeatures;
    const kept = first.renderLayers().find((layer: any) => layer.props.tiles);
    expect(kept).toBe(labelLayers[0][0]);
    // New when the tile layer's props change, as at a style zoom step.
    first.props = Object.assign(Object.create(Object.getPrototypeOf(first.props)), first.props);
    const afterProps = first.renderLayers().find((layer: any) => layer.props.tiles);
    expect(afterProps).not.toBe(kept);
    // New, with the new features, when the tile's content changes.
    sharedTile.content = [point('place'), point('road')];
    first.state.tileLayers.clear();
    first.renderLayers();
    const afterContent = first.renderLayers().find((layer: any) => layer.props.tiles);
    expect(afterContent).not.toBe(afterProps);
    expect(afterContent.props.tiles[0].features[0]).toBe(sharedTile.content[0]);
    // A symbol layer without features in any drawn tile has no label layer.
    sharedTile.content = [point('road')];
    first.state.tileLayers.clear();
    first.renderLayers();
    expect(first.renderLayers().find((layer: any) => layer.props.tiles)).toBeUndefined();
    first.state.tilesetViews.set('default', {isTileVisible: () => false});
    sharedTile.content = [point('place'), point('road')];
    first.state.tileLayers.clear();
    first.renderLayers();
    expect(first.renderLayers().find((layer: any) => layer.props.tiles)).toBeUndefined();
  });
});
