// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {expect, test, vi} from 'vitest';
import {SelectionLayer} from '../../src/editable-layers/selection-layer';

const COORDINATES = [
  [
    [10, 10],
    [80, 80],
    [80, 90],
    [10, 20],
    [10, 10]
  ]
];

function makeSelectionLayer() {
  const onSelect = vi.fn();
  const layer = new SelectionLayer({
    id: 'selection',
    selectionType: 'polygon',
    layerIds: ['points'],
    onSelect
  });
  layer.state = {selectionMask: [], isSelecting: false};
  layer.setState = vi.fn(update => Object.assign(layer.state, update));
  layer.context = {
    viewport: {project: position => position, unproject: position => position},
    layerManager: {updateLayers: vi.fn()},
    deck: {pickObjects: vi.fn(() => [])}
  } as any;
  return {
    layer,
    onSelect,
    pickObjects: vi.mocked(layer.context.deck.pickObjects),
    updateLayers: vi.mocked(layer.context.layerManager.updateLayers)
  };
}

test('polygon picking initializes a blocker covering the entire screen rectangle before GPU picking', () => {
  const {layer, onSelect, pickObjects, updateLayers} = makeSelectionLayer();
  const info = {object: {name: 'selected'}, layer: {id: 'points'}, index: 3, picked: true};
  pickObjects.mockImplementation(() => {
    expect(updateLayers).toHaveBeenCalledOnce();
    expect(layer.state.selectionMask[0]).toEqual([
      [
        [9, 9],
        [81, 9],
        [81, 91],
        [9, 91],
        [9, 9]
      ],
      COORDINATES[0]
    ]);
    return [info, {layer, index: 0}] as any;
  });
  layer._selectPolygonObjects(COORDINATES);
  expect(pickObjects).toHaveBeenCalledWith({
    x: 10,
    y: 10,
    width: 70,
    height: 80,
    layerIds: ['selection-selection-blocker', 'points']
  });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith({pickingInfos: [info]});
  expect(onSelect.mock.calls[0][0].pickingInfos[0]).toBe(info);
  expect(layer.state.isSelecting).toBe(false);
  expect(updateLayers).toHaveBeenCalledTimes(2);
});

test('polygon picking cleans up the blocker if GPU picking throws', () => {
  const {layer, onSelect, pickObjects, updateLayers} = makeSelectionLayer();
  pickObjects.mockImplementation(() => {
    throw new Error('picking failed');
  });
  expect(() => layer._selectPolygonObjects(COORDINATES)).toThrow('picking failed');
  expect(layer.state.isSelecting).toBe(false);
  expect(updateLayers).toHaveBeenCalledTimes(2);
  expect(onSelect).not.toHaveBeenCalled();
});

test('picking follows the pointer on screen when the camera target is lifted', () => {
  const {layer, pickObjects} = makeSelectionLayer();
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 18,
    pitch: 45,
    position: [0, 0, 30]
  });
  layer.context.viewport = viewport;
  // The editable layer reads pointer map coordinates on the camera target's plane,
  // while the blocker draws its 2D rings at sea level.
  const at = ([x, y]: number[]) => viewport.unproject([x, y], {targetZ: 30}).slice(0, 2);
  const blockerOnScreen = ([lng, lat]: number[]) => viewport.project([lng, lat]);
  const expectPixels = (actual: number[][], expected: number[][]) =>
    actual.forEach((pixel, i) => pixel.forEach((v, j) => expect(v).toBeCloseTo(expected[i][j], 2)));
  let mask: number[][][] = [];
  pickObjects.mockImplementation(() => {
    mask = layer.state.selectionMask[0];
    return [];
  });

  layer._selectPolygonObjects([
    [
      [300, 200],
      [500, 220],
      [480, 400],
      [300, 200]
    ].map(at)
  ]);
  const lasso = pickObjects.mock.calls[0][0];
  expectPixels([[lasso.x, lasso.y, lasso.width, lasso.height]], [[300, 200, 200, 200]]);
  const [outerRing, innerRing] = mask;
  expectPixels(outerRing.map(blockerOnScreen), [
    [299, 199],
    [501, 199],
    [501, 401],
    [299, 401],
    [299, 199]
  ]);
  expectPixels(innerRing.map(blockerOnScreen), [
    [300, 200],
    [500, 220],
    [480, 400],
    [300, 200]
  ]);

  layer._selectRectangleObjects([
    [
      [320, 240],
      [460, 240],
      [460, 360],
      [320, 360],
      [320, 240]
    ].map(at)
  ]);
  const rectangle = pickObjects.mock.calls[1][0];
  expectPixels(
    [[rectangle.x, rectangle.y, rectangle.width, rectangle.height]],
    [[320, 240, 140, 120]]
  );
});

test('the blocker only renders in picking passes while a polygon selection is pending', () => {
  const {layer} = makeSelectionLayer();
  const blocker = {id: 'selection-selection-blocker'};
  const editing = {id: 'selection-selection-geojson'};
  const filter = (subLayer, isPicking) => layer.filterSubLayer({layer: subLayer, isPicking} as any);
  expect(filter(blocker, true)).toBe(false);
  layer.state.isSelecting = true;
  expect(filter(blocker, false)).toBe(false);
  expect(filter(blocker, true)).toBe(true);
  expect(filter(editing, false)).toBe(true);
  expect(filter(editing, true)).toBe(true);
});

test('rectangle selection retains deck.gl GPU picking', () => {
  const {layer, onSelect, pickObjects, updateLayers} = makeSelectionLayer();
  layer._selectRectangleObjects([
    [
      [80, 90],
      [80, 10],
      [10, 10],
      [10, 90],
      [80, 90]
    ]
  ]);
  expect(pickObjects).toHaveBeenCalledWith({
    x: 10,
    y: 10,
    width: 70,
    height: 80,
    layerIds: ['points']
  });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith({pickingInfos: []});
  expect(updateLayers).not.toHaveBeenCalled();
});

test('rectangle selection deduplicates picked objects without conflating same-index tile features', () => {
  const {layer, onSelect, pickObjects} = makeSelectionLayer();
  const feature = {
    layer: {id: 'points'},
    index: 0,
    object: {type: 'Feature', properties: {guideType: 'editHandle'}}
  };
  const featureFromAnotherTile = {
    ...feature,
    object: {type: 'Feature', properties: {tile: 'another'}}
  };
  pickObjects.mockReturnValue([
    feature,
    featureFromAnotherTile,
    {layer: feature.layer, index: 3, isGuide: true},
    {
      layer: feature.layer,
      index: 7,
      isGuide: true,
      object: {properties: {guideType: 'editHandle'}}
    },
    {...feature, index: 7}
  ] as any);

  layer._selectRectangleObjects(COORDINATES);

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    pickingInfos: [feature, featureFromAnotherTile]
  });
});

test('polygon selection deduplicates picked objects without conflating same-index tile features', () => {
  const {layer, onSelect, pickObjects, updateLayers} = makeSelectionLayer();
  const feature = {
    layer: {id: 'points'},
    index: 0,
    object: {type: 'Feature', properties: {guideType: 'editHandle'}}
  };
  const featureFromAnotherTile = {
    ...feature,
    object: {type: 'Feature', properties: {tile: 'another'}}
  };
  pickObjects.mockImplementation(() => {
    expect(layer.state.isSelecting).toBe(true);
    expect(updateLayers).toHaveBeenCalledOnce();
    return [
      feature,
      featureFromAnotherTile,
      {layer: feature.layer, index: 3, isGuide: true},
      {
        layer: feature.layer,
        index: 7,
        isGuide: true,
        object: {properties: {guideType: 'editHandle'}}
      },
      {...feature, index: 7},
      {layer, index: 0}
    ] as any;
  });

  layer._selectPolygonObjects(COORDINATES);

  expect(onSelect).toHaveBeenCalledExactlyOnceWith({
    pickingInfos: [feature, featureFromAnotherTile]
  });
});

test('selection forwards the application interaction override to its editable sublayer', () => {
  const layer = new SelectionLayer({id: 'selection', autoPreventMapInteractions: false});
  layer.state = {selectionMask: [], isSelecting: false};
  const editable = layer.renderLayers()[0];
  expect(editable.props.autoPreventMapInteractions).toBe(false);
});
