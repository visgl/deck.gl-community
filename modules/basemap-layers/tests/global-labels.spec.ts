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
    // A new list of the same tiles combines them again into the same rows, and keeps the array,
    // so the sublayers' data does not change.
    const same = [a, b];
    update({tiles: same}, state);
    expect(state.rowTiles).toBe(same);
    expect(state.labelData).toBe(first);
    update({tiles: same}, state);
    expect(state.labelData).toBe(first);
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

  test('wraps the text again when another first tile changes a data-driven text-font', () => {
    const styleLayer = {
      layout: {
        'text-field': '{name}',
        'text-font': [
          'match',
          ['get', 'name'],
          'a',
          ['literal', ['Bold']],
          ['literal', ['Regular']]
        ]
      }
    };
    const a = {index: {x: 0, y: 0, z: 1}, features: [pointFeature(0.5, 0.5, 'a')]};
    const b = {index: {x: 1, y: 0, z: 1}, features: [pointFeature(0.5, 0.5, 'b')]};
    const c = {index: {x: 0, y: 1, z: 1}, features: [pointFeature(0.5, 0.5, 'c')]};
    const state: Record<string, any> = {};
    update({tiles: [b, c], styleLayer}, state);
    const regular = state.labelText.labels;
    // Another tile with the same font keeps the wrapped text.
    update({tiles: [b, c, a], styleLayer}, state);
    expect(state.labelText.labels).toBe(regular);
    // A first tile with another font wraps it again.
    update({tiles: [a, b, c], styleLayer}, state);
    expect(state.labelText.labels).not.toBe(regular);
  });

  test('records the tile a row was placed for, also when another tile takes its place', () => {
    const features = [pointFeature(0.5, 0.5, 'a')];
    const first = {id: '0-0-1'};
    const second = {id: '0-0-1'};
    const state: Record<string, any> = {};
    update({tiles: [{index: {x: 0, y: 0, z: 1}, features, tile: first}]}, state);
    update({tiles: [{index: {x: 0, y: 0, z: 1}, features, tile: second}]}, state);
    expect(state.labelData[0].__tile).toBe(second);
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
    // A symbol layer that loses its features in every drawn tile keeps its label layer, hidden.
    sharedTile.content = [point('road')];
    first.state.tileLayers.clear();
    first.renderLayers();
    const emptied = first.renderLayers().find((layer: any) => layer.props.tiles);
    expect(emptied.id).toBe(afterContent.id);
    expect(emptied.props.visible).toBe(false);
    // With the tiles it last drew, so that its data does not change.
    expect(emptied.props.tiles).toBe(afterContent.props.tiles);
    // Without any drawn tile, as while the drawn tiles load, it is kept too.
    first.state.tilesetViews.set('default', {isTileVisible: () => false});
    sharedTile.content = [point('place'), point('road')];
    first.state.tileLayers.clear();
    first.renderLayers();
    const untiled = first.renderLayers().find((layer: any) => layer.props.tiles);
    expect(untiled.id).toBe(afterContent.id);
    expect(untiled.props.visible).toBe(false);
    expect(untiled.props.tiles).toBe(afterContent.props.tiles);
  });

  test('a picked label on a map reports its feature in longitude/latitude', () => {
    const style: any = {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [
        {
          id: 'places',
          type: 'symbol',
          source: 'tiles',
          'source-layer': 'place',
          layout: {'text-field': '{name}'}
        }
      ]
    };
    const [run]: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 1,
      styleDefinition: style
    }).filter((layer: any) => layer.id.startsWith('test-tiles'));
    run.context = {viewport: {zoom: 1}};
    const tile = {id: '1-0-1', index: {x: 1, y: 0, z: 1}};
    const feature = {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [0.5, 0.5]},
      properties: {layerName: 'place', name: 'a'}
    };
    // The label layer holds no single tile; the picked row's tile is in the info.
    const info = run.getPickingInfo({
      info: {picked: true, object: feature, tile},
      mode: 'hover',
      sourceLayer: {props: {}}
    });
    const [lng, lat] = info.object.geometry.coordinates;
    const [expectedLng, expectedLat] = lngLat(1.5 / 2, 0.5 / 2);
    expect(lng).toBeCloseTo(expectedLng, 6);
    expect(lat).toBeCloseTo(expectedLat, 6);
    // On a globe the recorded features are in longitude/latitude already.
    run.context = {viewport: {zoom: 1, projectionMode: 2}};
    const onGlobe = {...feature, geometry: {type: 'Point', coordinates: [10, 20]}};
    const globeInfo = run.getPickingInfo({
      info: {picked: true, object: onGlobe, tile},
      mode: 'hover',
      sourceLayer: {props: {}}
    });
    expect(globeInfo.object.geometry.coordinates).toEqual([10, 20]);
  });

  test('each view draws the labels of the tiles it shows', () => {
    const style: any = {
      version: 8,
      sources: {tiles: {type: 'vector', tiles: ['https://tiles.example.com/{z}/{x}/{y}.mvt']}},
      layers: [
        {
          id: 'places',
          type: 'symbol',
          source: 'tiles',
          'source-layer': 'place',
          layout: {'text-field': '{name}'}
        }
      ]
    };
    const place = (name: string) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [0.5, 0.5]},
      properties: {layerName: 'place', name}
    });
    const left = {id: '0-0-1', index: {x: 0, y: 0, z: 1}, isLoaded: true, content: [place('l')]};
    const right = {id: '1-0-1', index: {x: 1, y: 0, z: 1}, isLoaded: true, content: [place('r')]};
    const [run]: any[] = getBasemapLayers({
      idPrefix: 'test',
      mode: 'map',
      zoom: 1,
      styleDefinition: style
    }).filter((layer: any) => layer.id.startsWith('test-tiles'));
    run.context = {viewport: {zoom: 1}};
    run.internalState = {};
    run.state = {
      tileLayers: new Map(),
      tilesetViews: new Map([
        ['left', {isTileVisible: (tile: any) => tile === left}],
        ['right', {isTileVisible: (tile: any) => tile === right}]
      ]),
      tileset: {tiles: [left, right]}
    };
    run.renderLayers();
    const labelLayers = run.renderLayers().filter((layer: any) => layer.props.tiles);
    const byView = labelLayers.map((layer: any) => [
      layer.id,
      layer.props.tiles.map((tile: any) => tile.tile.id)
    ]);
    expect(byView).toEqual([
      ['test-tiles-labels-"places"-view-left', ['0-0-1']],
      ['test-tiles-labels-"places"-view-right', ['1-0-1']]
    ]);
    const drawnIn = (viewport: any) =>
      labelLayers
        .filter((layer: any) => run.filterSubLayer({layer, viewport}))
        .map((layer: any) => layer.props.tiles[0].tile.id);
    expect(drawnIn({id: 'left'})).toEqual(['0-0-1']);
    expect(drawnIn({id: 'right'})).toEqual(['1-0-1']);
    // Each view keeps its label layers while its tiles do not change.
    const again = run.renderLayers().filter((layer: any) => layer.props.tiles);
    again.forEach((layer: any, index: number) => expect(layer).toBe(labelLayers[index]));
  });
});
