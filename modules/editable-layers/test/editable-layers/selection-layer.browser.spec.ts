// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Deck} from '@deck.gl/core';
import {GeoJsonLayer, PathLayer, ScatterplotLayer} from '@deck.gl/layers';
import {expect, test, vi} from 'vitest';
import {SelectionLayer} from '../../src/editable-layers/selection-layer';

const DIAGONAL_LASSO = [
  [
    [-8, -8],
    [8, 8],
    [8, 9],
    [-8, -7],
    [-8, -8]
  ]
];
const CONCAVE_LASSO = [
  [
    [-8, -8],
    [8, -8],
    [8, -6],
    [-6, -6],
    [-6, 8],
    [-8, 8],
    [-8, -8]
  ]
];

test.each([
  {name: 'diagonal', coordinates: DIAGONAL_LASSO, inside: [0, 0.5], outside: [5, -5]},
  {name: 'concave', coordinates: CONCAVE_LASSO, inside: [-7, 0], outside: [0, 0]},
  {
    name: 'pitched diagonal',
    coordinates: DIAGONAL_LASSO,
    inside: [0, 0.5],
    outside: [5, -5],
    pitch: 45,
    bearing: 25
  }
])('$name lasso excludes visible pins far outside its edges', async ({
  coordinates,
  inside,
  outside,
  pitch = 0,
  bearing = 0
}) => {
  const data = [{position: inside}, {position: outside}];
  const points = new ScatterplotLayer({
    id: 'points',
    data,
    getPosition: d => d.position,
    getRadius: 6,
    radiusUnits: 'pixels',
    pickable: true
  });
  const onSelect = vi.fn();
  const selection = new SelectionLayer({
    id: 'selection',
    selectionType: 'polygon',
    layerIds: ['points'],
    onSelect
  });
  const host = document.createElement('div');
  host.style.cssText = 'width:600px;height:600px';
  document.body.append(host);
  const onError = vi.fn();
  const deck = new Deck({
    parent: host,
    width: 600,
    height: 600,
    useDevicePixels: false,
    initialViewState: {longitude: 0, latitude: 0, zoom: 4, pitch, bearing},
    layers: [points, selection],
    onError
  });
  try {
    await vi.waitFor(() => expect(points.isLoaded && selection.isLoaded).toBe(true), {
      timeout: 10000
    });
    expect(
      deck.pickObjects({x: 0, y: 0, width: 600, height: 600, layerIds: ['points']})
    ).toHaveLength(2);
    selection._selectPolygonObjects(coordinates);
    expect(onSelect).toHaveBeenCalledOnce();
    const {pickingInfos} = onSelect.mock.calls[0][0];
    expect(pickingInfos.map(info => info.index)).toEqual([0]);
    expect(pickingInfos[0].object).toBe(data[0]);
    expect(pickingInfos[0].picked).toBe(true);
    expect(selection.state.isSelecting).toBe(false);
    // The mask must not leak into later unrelated picks.
    expect(
      deck.pickObjects({x: 0, y: 0, width: 600, height: 600, layerIds: ['points']})
    ).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    host.remove();
  }
}, 15000);

async function withTarget(target, run, {size = 600, zoom = 4} = {}) {
  const onSelect = vi.fn();
  const selection = new SelectionLayer({
    id: 'selection',
    selectionType: 'polygon',
    layerIds: [target.id],
    onSelect
  });
  const host = document.createElement('div');
  host.style.cssText = `position:relative;width:${size}px;height:${size}px`;
  document.body.append(host);
  const onError = vi.fn();
  const deck = new Deck({
    parent: host,
    width: size,
    height: size,
    useDevicePixels: false,
    initialViewState: {longitude: 0, latitude: 0, zoom},
    layers: [target, selection],
    onError
  });
  try {
    await vi.waitFor(() => expect(target.isLoaded && selection.isLoaded).toBe(true), {
      timeout: 10000
    });
    await run({selection, onSelect, deck});
    expect(onError).not.toHaveBeenCalled();
  } finally {
    deck.finalize();
    host.remove();
  }
}

test('lasso selects a rendered path crossing its edges without any contained vertices', async () => {
  const data = [
    [
      [-10, 0.5],
      [10, 0.5]
    ],
    [
      [4, -5],
      [6, -5]
    ]
  ];
  await withTarget(
    new PathLayer({
      id: 'paths',
      data,
      getPath: path => path,
      getWidth: 4,
      widthUnits: 'pixels',
      pickable: true
    }),
    ({selection, onSelect}) => {
      selection._selectPolygonObjects(DIAGONAL_LASSO);
      expect(onSelect.mock.calls[0][0].pickingInfos.map(info => info.index)).toEqual([0]);
    }
  );
}, 15000);

test('lasso inside a GeoJSON polygon hole does not select the polygon', async () => {
  const data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-8, -8],
              [8, -8],
              [8, 8],
              [-8, 8],
              [-8, -8]
            ],
            [
              [-2, -2],
              [2, -2],
              [2, 2],
              [-2, 2],
              [-2, -2]
            ]
          ]
        }
      }
    ]
  };
  await withTarget(
    new GeoJsonLayer({id: 'geojson', data, filled: true, stroked: false, pickable: true}),
    ({selection, onSelect}) => {
      selection._selectPolygonObjects([
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
          [-1, -1]
        ]
      ]);
      expect(onSelect.mock.calls[0][0].pickingInfos).toEqual([]);
      selection._selectPolygonObjects([
        [
          [3, 3],
          [4, 3],
          [4, 4],
          [3, 4],
          [3, 3]
        ]
      ]);
      expect(onSelect.mock.calls[1][0].pickingInfos.map(info => info.object)).toEqual(
        data.features
      );
    }
  );
}, 15000);

test('lasso supports binary point data and keeps the GPU object index', async () => {
  const data = {
    length: 2,
    attributes: {getPosition: {value: new Float32Array([0, 0.5, 5, -5]), size: 2}}
  };
  await withTarget(
    new ScatterplotLayer({id: 'binary', data, getRadius: 6, radiusUnits: 'pixels', pickable: true}),
    ({selection, onSelect}) => {
      selection._selectPolygonObjects(DIAGONAL_LASSO);
      const {pickingInfos} = onSelect.mock.calls[0][0];
      expect(pickingInfos.map(info => info.index)).toEqual([0]);
      expect(pickingInfos[0].picked).toBe(true);
    }
  );
}, 15000);

test('lasso respects non-pickable targets and does not rescan 10000 point positions', async () => {
  const data = Array.from({length: 10000}, (_, index) => ({
    position: [(index % 100) / 10 - 5, Math.floor(index / 100) / 10 - 5]
  }));
  const getPosition = vi.fn(object => object.position);
  const target = new ScatterplotLayer({
    id: 'many-points',
    data,
    getPosition,
    getRadius: 1,
    radiusUnits: 'pixels',
    pickable: true
  });
  await withTarget(target, ({selection, onSelect, deck}) => {
    getPosition.mockClear();
    const start = performance.now();
    selection._selectPolygonObjects(DIAGONAL_LASSO);
    console.log(
      `10000-point GPU lasso: ${(performance.now() - start).toFixed(1)} ms; position accessor calls: ${getPosition.mock.calls.length}`
    );
    expect(onSelect.mock.calls[0][0].pickingInfos.length).toBeGreaterThan(0);
    expect(getPosition).not.toHaveBeenCalled();
    const blocker = deck
      .layerManager!.getLayers()
      .find(layer => layer.id.endsWith('selection-blocker-fill'))!;
    const blockerModel = blocker.getModels()[0];
    expect(blockerModel).toBeTruthy();
    selection._selectPolygonObjects(DIAGONAL_LASSO);
    expect(
      deck
        .layerManager!.getLayers()
        .find(layer => layer.id === blocker.id)!
        .getModels()[0]
    ).toBe(blockerModel);
    deck.setProps({layers: [target.clone({pickable: false}), selection]});
    deck.layerManager!.updateLayers();
    selection._selectPolygonObjects(DIAGONAL_LASSO);
    expect(onSelect.mock.calls[2][0].pickingInfos).toEqual([]);
  });
}, 15000);

test('completing DrawPolygonMode emits the GPU selection through onEdit', async () => {
  const data = [{position: [0, 0.5]}, {position: [5, -5]}];
  await withTarget(
    new ScatterplotLayer({
      id: 'points',
      data,
      getPosition: object => object.position,
      getRadius: 6,
      radiusUnits: 'pixels',
      pickable: true
    }),
    ({selection, onSelect, deck}) => {
      const viewport = deck.getViewports()[0];
      for (const coordinate of DIAGONAL_LASSO[0]) {
        const editable = deck
          .layerManager!.getLayers()
          .find(layer => layer.id === 'selection-selection-geojson') as any;
        editable.onLayerClick({
          mapCoords: coordinate,
          screenCoords: viewport.project(coordinate),
          picks: [],
          sourceEvent: new MouseEvent('click', {button: 0})
        });
        deck.layerManager!.updateLayers();
      }
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.calls[0][0].pickingInfos.map(info => info.index)).toEqual([0]);
      expect(selection.state.isSelecting).toBe(false);
    }
  );
}, 15000);
