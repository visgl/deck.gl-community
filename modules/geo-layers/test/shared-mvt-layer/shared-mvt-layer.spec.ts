import {describe, expect, it, vi} from 'vitest';
import {
  COORDINATE_SYSTEM,
  WebMercatorViewport,
  _GlobeViewport as GlobeViewport
} from '@deck.gl/core';
import {SharedMVTLayer, SharedTileset2D} from '../../src';
import {SharedTile2DView} from '../../src/shared-tile-2d-layer/shared-tile-2d-view';
import {getMVTDataInWGS84} from '../../src/shared-mvt-layer/shared-mvt-layer';

const DATA = [
  {
    type: 'Feature',
    id: 7,
    properties: {layerName: 'place'},
    geometry: {type: 'Point', coordinates: [0.5, 0.5]}
  }
];
const viewport = new WebMercatorViewport({
  width: 128,
  height: 128,
  longitude: 0,
  latitude: 0,
  zoom: 0
});
async function waitLoaded(view: SharedTile2DView) {
  await vi.waitFor(() => expect(view.isLoaded).toBe(true));
}

describe('SharedMVTLayer', () => {
  it('retains decoded tiles for a staggered consumer and detaches independently', async () => {
    const fetch = vi.fn(async () => DATA);
    const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
    const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
    const first = new SharedTile2DView(tileset);
    const second = new SharedTile2DView(tileset);
    try {
      first.update(viewport);
      await waitLoaded(first);
      second.update(viewport);
      await waitLoaded(second);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(first.selectedTiles![0].content).toBe(second.selectedTiles![0].content);
      expect(fetch.mock.calls[0][1].loadOptions.mvt).toMatchObject({
        coordinates: 'local',
        shape: 'geojson',
        tileIndex: {x: 0, y: 0, z: 0}
      });
      first.finalize();
      second.update(viewport);
      expect(second.selectedTiles![0].content).toBe(DATA);
    } finally {
      first.finalize();
      second.finalize();
      tileset.finalize();
    }
  });

  it('uses the same cache when switching map to globe and back', async () => {
    const fetch = vi.fn(async () => DATA);
    const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
    const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
    const view = new SharedTile2DView(tileset);
    const consumer = new SharedMVTLayer({
      data: tileset,
      renderSubLayers: props => {
        captured = props;
        return null;
      }
    });
    let captured: any;
    try {
      view.update(viewport);
      await waitLoaded(view);
      const tile = view.selectedTiles![0];
      const globe = new GlobeViewport({
        width: 128,
        height: 128,
        longitude: 0,
        latitude: 0,
        zoom: 0
      });
      for (const active of [viewport, globe, viewport]) {
        view.update(active);
        await waitLoaded(view);
        consumer.context = {viewport: active} as any;
        consumer.renderSubLayers({
          ...consumer.props,
          id: 'tile',
          data: tile.content,
          tile,
          _offset: 0
        } as any);
        if (active === globe) {
          expect(captured.coordinateSystem).toBe(COORDINATE_SYSTEM.LNGLAT);
          expect(captured.data[0].geometry.coordinates).toEqual([0, 0]);
        } else {
          expect(captured.coordinateSystem).toBe(COORDINATE_SYSTEM.CARTESIAN);
          expect(captured.data).toBe(DATA);
          expect(captured.modelMatrix.transformAsPoint([0.5, 0.5, 0])).toEqual([256, -256, 0]);
        }
      }
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(DATA[0].geometry.coordinates).toEqual([0.5, 0.5]);
      expect(getMVTDataInWGS84(DATA, tile.index)).toBe(getMVTDataInWGS84(DATA, tile.index));
    } finally {
      view.finalize();
      tileset.finalize();
    }
  });
});

it('keeps an in-flight load alive when one consumer detaches', async () => {
  let finish: (data: any) => void = () => {};
  let signal: AbortSignal | undefined;
  const fetch = vi.fn((_url: string, options: any) => {
    signal = options.signal;
    return new Promise<any>(resolve => {
      finish = resolve;
    });
  });
  const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
  const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
  const a = new SharedTile2DView(tileset);
  const b = new SharedTile2DView(tileset);
  try {
    a.update(viewport);
    b.update(viewport);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    a.finalize();
    expect(signal?.aborted).toBe(false);
    finish(DATA);
    await waitLoaded(b);
    expect(b.selectedTiles![0].content).toBe(DATA);
  } finally {
    a.finalize();
    b.finalize();
    tileset.finalize();
  }
});

it('converts picked geometry and highlights IDs without modifying shared data', () => {
  const layer = new SharedMVTLayer({data: null, uniqueIdProperty: 'key', highlightedFeatureId: 9});
  const feature = {...DATA[0], properties: {...DATA[0].properties, key: 9}};
  const tile: any = {index: {x: 0, y: 0, z: 0}, content: [feature]};
  layer.context = {viewport} as any;
  layer.initializeState();
  const props = layer.getSubLayerPropsByTile(tile);
  expect(props.highlightedObjectIndex).toBe(0);
  expect(props.clipBounds).toEqual([0, 0, 1, 1]);
  const picked = layer.getPickingInfo({
    info: {picked: true, object: feature, index: 0},
    sourceLayer: {props: {tile, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN}}
  } as any);
  expect(picked.object.geometry.coordinates).toEqual([0, 0]);
  expect(feature.geometry.coordinates).toEqual([0.5, 0.5]);
});

it('decodes an MVT before the cache owner has a deck.gl context', async () => {
  const {MVTLoader} = await import('@loaders.gl/mvt');
  // A valid protobuf tile containing an empty layer named "test", version 2.
  const bytes = Uint8Array.from([0x1a, 8, 0x0a, 4, 116, 101, 115, 116, 0x78, 2]);
  const url = `data:application/x-protobuf;base64,${Buffer.from(bytes).toString('base64')}`;
  const layer = new SharedMVTLayer({data: url, loaders: [MVTLoader], loadOptions: {worker: false}});
  const tile: any = {id: '0-0-0', index: {x: 0, y: 0, z: 0}};
  expect(await layer.getTileData(tile)).toEqual([]);
});

it('skips failed tiles on a globe and maps highlights to filtered sublayer data', async () => {
  const {GeoJsonLayer} = await import('@deck.gl/layers');
  const layer = new SharedMVTLayer({data: null, highlightedFeatureId: 9});
  layer.context = {viewport: new GlobeViewport({width: 128, height: 128, zoom: 0})} as any;
  layer.initializeState();
  const feature = {...DATA[0], id: 9};
  const tile: any = {index: {x: 0, y: 0, z: 0}, content: [DATA[0], feature]};
  expect(layer.renderSubLayers({data: null, tile} as any)).toBeNull();
  const sublayer = new GeoJsonLayer({data: [feature]});
  expect(layer.getSubLayerPropsByTile(tile, sublayer).highlightedObjectIndex).toBe(0);
  expect(
    layer.getSubLayerPropsByTile(tile, new GeoJsonLayer({data: [DATA[0]]})).highlightedObjectIndex
  ).toBe(-1);
});

/** A consumer layer prepared to update outside a Deck, as deck.gl's layer manager would. */
function createConsumer(props: Record<string, unknown>): any {
  const layer: any = new SharedMVTLayer(props as any);
  layer.context = {viewport} as any;
  layer.initializeState();
  layer.setState = (state: any) => Object.assign(layer.state, state);
  layer.setNeedsUpdate = () => {};
  layer.updateState({
    changeFlags: {dataChanged: true, propsOrDataChanged: true, somethingChanged: true}
  } as any);
  return layer;
}

describe('SharedMVTLayer consumers of one tileset', () => {
  it('load each tile once, and one consumer finalizing leaves the tileset to the others', async () => {
    const fetch = vi.fn(async () => DATA);
    const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
    const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
    const finalize = vi.spyOn(tileset, 'finalize');
    const first = createConsumer({id: 'first', data: tileset});
    const second = createConsumer({id: 'second', data: tileset});
    try {
      await vi.waitFor(() => expect(first.isLoaded && second.isLoaded).toBe(true));
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(first.state.tileset).toBe(tileset);
      expect(second.state.tileset).toBe(tileset);

      first.finalizeState();
      expect(finalize).not.toHaveBeenCalled();
      expect(second.isLoaded).toBe(true);
      expect(tileset.tiles.map(tile => tile.content)).toEqual([DATA]);
      expect(tileset.stats.get('Consumers').count).toBe(1);
    } finally {
      second.finalizeState();
      expect(finalize).not.toHaveBeenCalled();
      tileset.finalize();
    }
  });

  it('retain decoded tiles after every consumer detaches, for a later consumer', async () => {
    const fetch = vi.fn(async () => DATA);
    const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
    const tileset = new SharedTileset2D({...loader._getTilesetOptions(), maxZoom: 0});
    const first = new SharedTile2DView(tileset);
    let later: SharedTile2DView | null = null;
    try {
      first.update(viewport);
      await waitLoaded(first);
      const [tile] = first.selectedTiles!;
      first.finalize();
      expect(tileset.stats.get('Consumers').count).toBe(0);

      later = new SharedTile2DView(tileset);
      later.update(viewport);
      expect(later.isLoaded).toBe(true);
      expect(later.selectedTiles![0]).toBe(tile);
      expect(later.selectedTiles![0].content).toBe(DATA);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      first.finalize();
      later?.finalize();
      tileset.finalize();
    }
  });

  it('abort a request only once no consumer selects it, and all of them with the tileset', async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn((_url: string, options: any) => {
      signals.push(options.signal);
      return new Promise<any>(() => {});
    });
    const loader = new SharedMVTLayer({data: 'https://example.com/{z}/{x}/{y}.mvt', fetch});
    // One request at a time: the other selected tiles queue behind it.
    const tileset = new SharedTileset2D({
      ...loader._getTilesetOptions(),
      maxZoom: 1,
      maxRequests: 1
    });
    const zoomOne = new WebMercatorViewport({width: 512, height: 512, zoom: 1});
    const a = new SharedTile2DView(tileset);
    const b = new SharedTile2DView(tileset);
    try {
      a.update(zoomOne);
      b.update(zoomOne);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      expect(tileset.tiles.filter(tile => tile.isLoading)).toHaveLength(4);

      a.finalize();
      expect(tileset.tiles.filter(tile => tile.isLoading)).toHaveLength(4);
      expect(signals[0].aborted).toBe(false);

      // No consumer selects the tiles any more: requests beyond the limit are cancelled.
      b.finalize();
      expect(tileset.tiles.filter(tile => tile.isLoading)).toHaveLength(1);

      tileset.finalize();
      expect(signals.every(signal => signal.aborted)).toBe(true);
    } finally {
      a.finalize();
      b.finalize();
      tileset.finalize();
    }
  });

  it('keep hover highlights per consumer, without changing the shared features', () => {
    const features = [
      {...DATA[0], id: 1, properties: {layerName: 'place'}},
      {...DATA[0], id: 2, properties: {layerName: 'place'}}
    ];
    const snapshot = structuredClone(features);
    const tile: any = {index: {x: 0, y: 0, z: 0}, content: features};
    const [hovered, other] = ['hovered', 'other'].map(id => {
      const layer: any = new SharedMVTLayer({id, data: null, highlightColor: [1, 2, 3, 4]});
      layer.context = {viewport} as any;
      layer.initializeState();
      layer.setState = (state: any) => Object.assign(layer.state, state);
      return layer;
    });

    hovered._updateAutoHighlight({object: features[1]} as any);
    expect(hovered.getSubLayerPropsByTile(tile)).toMatchObject({
      highlightedObjectIndex: 1,
      highlightColor: [1, 2, 3, 4]
    });
    expect(other.getSubLayerPropsByTile(tile).highlightedObjectIndex).toBe(-1);

    // Each consumer picks its own geographic copy of the shared tile-local feature.
    for (const layer of [hovered, other]) {
      const picked = layer.getPickingInfo({
        info: {picked: true, object: features[1], index: 1},
        sourceLayer: {props: {tile, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN}}
      } as any);
      expect(picked.object).not.toBe(features[1]);
      expect(picked.object.geometry.coordinates).toEqual([0, 0]);
    }

    hovered._updateAutoHighlight({object: null} as any);
    expect(hovered.getSubLayerPropsByTile(tile).highlightedObjectIndex).toBe(-1);
    expect(features).toEqual(snapshot);
    expect(tile.content).toBe(features);
  });
});

it('picks features by the coordinates its sublayer holds, not by the current viewport', () => {
  const layer = new SharedMVTLayer({data: null});
  layer.context = {viewport} as any;
  layer.initializeState();
  const local = DATA[0];
  const tile: any = {index: {x: 0, y: 0, z: 0}, content: [local]};
  const [geographic] = getMVTDataInWGS84([local], tile.index);
  const globe = new GlobeViewport({width: 128, height: 128, longitude: 0, latitude: 0, zoom: 0});
  const pick = (object: any, coordinateSystem: string, activeViewport: any) => {
    layer.context = {viewport: activeViewport} as any;
    return layer.getPickingInfo({
      info: {picked: true, object, index: 0},
      sourceLayer: {props: {tile, coordinateSystem}}
    } as any).object;
  };

  // Just after a switch from a globe to a map, the sublayer built for the globe still draws
  // geographic features: they are returned as they are, not converted a second time.
  expect(pick(geographic, COORDINATE_SYSTEM.LNGLAT, viewport)).toBe(geographic);
  // Just after a switch from a map to a globe, a tile-local feature is still converted.
  expect(pick(local, COORDINATE_SYSTEM.CARTESIAN, globe).geometry.coordinates).toEqual([0, 0]);
  expect(pick(local, COORDINATE_SYSTEM.CARTESIAN, viewport).geometry.coordinates).toEqual([0, 0]);
  expect(pick(geographic, COORDINATE_SYSTEM.LNGLAT, globe)).toBe(geographic);
  expect(local.geometry.coordinates).toEqual([0.5, 0.5]);
});
