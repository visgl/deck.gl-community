// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect} from 'vitest';
import {WebMercatorViewport, OrthographicViewport, COORDINATE_SYSTEM} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import {EditableGeoJsonLayer} from '../../../src/editable-layers/editable-geojson-layer';
import {getClosestSnapTargetHandle} from '../../../src/edit-modes/snapping/snapping-utils';
import {createFeatureCollectionProps} from '../test-utils';

const origin: [number, number, number] = [-122.4, 37.8, 25];
const viewport = new WebMercatorViewport({
  width: 900,
  height: 700,
  longitude: origin[0],
  latitude: origin[1],
  zoom: 16,
  pitch: 45,
  bearing: 20
});

function createProjectionLayer(
  coordinateSystem,
  coordinates,
  modelMatrix?,
  activeViewport = viewport
) {
  const props = createFeatureCollectionProps();
  props.data = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: coordinates.length === 1 ? 'Point' : 'LineString',
          coordinates: coordinates.length === 1 ? coordinates[0] : coordinates
        },
        properties: {}
      }
    ]
  };
  const layer = new EditableGeoJsonLayer({
    id: 'projection-test',
    data: props.data,
    coordinateSystem,
    coordinateOrigin: origin,
    modelMatrix,
    modeConfig: {enableSnapping: true, edgeSnapping: true, viewport: activeViewport},
    selectedFeatureIndexes: [],
    pickingRadius: 8
  });
  layer.context = {viewport: activeViewport} as any;
  layer.internalState = {viewport: activeViewport} as any;
  layer.state = {
    lastPointerMoveEvent: {...props.lastPointerMoveEvent, mapCoords: coordinates[0]},
    cursor: null
  } as any;
  return layer;
}

test.each([
  [COORDINATE_SYSTEM.METER_OFFSETS, [100, 80, 40]],
  [COORDINATE_SYSTEM.LNGLAT_OFFSETS, [0.001, 0.001, 40]]
])('offset vertices snap to original local coordinates: %s', (coordinateSystem, position) => {
  const layer = createProjectionLayer(coordinateSystem, [position]);
  const screen = layer.project(position);
  layer.state.lastPointerMoveEvent = {
    ...layer.state.lastPointerMoveEvent,
    screenCoords: [screen[0] + 1, screen[1] + 1]
  };
  const result = getClosestSnapTargetHandle(layer.getModeProps(layer.props), []);
  expect(result?.geometry.coordinates).toEqual(position);
});

test.each([
  [
    COORDINATE_SYSTEM.METER_OFFSETS,
    [
      [0, 0, 0],
      [200, 100, 80]
    ],
    new Matrix4().translate([20, 30, 10]).rotateZ(0.2)
  ],
  [
    COORDINATE_SYSTEM.LNGLAT_OFFSETS,
    [
      [0, 0, 0],
      [0.002, 0.001, 80]
    ],
    new Matrix4().translate([0.0001, 0.0002, 10])
  ]
])('offset elevated edges reproject to their bounded pixel foot: %s', (coordinateSystem, positions, modelMatrix) => {
  const layer = createProjectionLayer(coordinateSystem, positions, modelMatrix);
  const start = layer.project(positions[0]);
  const end = layer.project(positions[1]);
  const foot = start.map((value, i) => value + (end[i] - value) * 0.4);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  layer.state.lastPointerMoveEvent = {
    ...layer.state.lastPointerMoveEvent,
    screenCoords: [foot[0] - dy / length, foot[1] + dx / length]
  };
  const result = getClosestSnapTargetHandle(layer.getModeProps(layer.props), []);
  expect(result).toBeDefined();
  const local = result!.geometry.coordinates;
  expect(local).toHaveLength(3);
  expect(local[0]).toBeGreaterThan(positions[0][0]);
  expect(local[0]).toBeLessThan(positions[1][0]);
  expect(local[2]).toBeGreaterThan(0);
  expect(local[2]).toBeLessThan(80);
  const projected = layer.project(local);
  for (let i = 0; i < 3; i++) expect(projected[i]).toBeCloseTo(foot[i], 6);
  layer.state.lastPointerMoveEvent = {
    ...layer.state.lastPointerMoveEvent,
    screenCoords: [start[0] - dx / length, start[1] - dy / length]
  };
  expect(
    getClosestSnapTargetHandle(layer.getModeProps(layer.props), [])?.geometry.coordinates
  ).toEqual(positions[0]);
});

test.each([
  [COORDINATE_SYSTEM.LNGLAT, [-122.399, 37.801, 70], undefined, viewport],
  [
    COORDINATE_SYSTEM.CARTESIAN,
    [0.002, 0.002, 0.001],
    new Matrix4().translate([1, 1, 1]),
    viewport
  ],
  [
    COORDINATE_SYSTEM.CARTESIAN,
    [20, 30, 40],
    new Matrix4().translate([10, 20, 30]).rotateZ(0.2),
    new OrthographicViewport({width: 900, height: 700, target: [0, 0, 0], zoom: 1})
  ]
])('layer projection pair reverses render transforms: %s', (coordinateSystem, position, modelMatrix, activeViewport) => {
  const layer = createProjectionLayer(coordinateSystem, [position], modelMatrix, activeViewport);
  const projection = layer.getModeProps(layer.props).projection;
  expect(projection).toBeDefined();
  const recovered = projection!.unproject(projection!.project(position));
  expect(recovered).toBeDefined();
  for (let i = 0; i < 3; i++) expect(recovered![i]).toBeCloseTo(position[i], 6);
});

test('singular model matrices cannot produce an edge snap', () => {
  const layer = createProjectionLayer(
    COORDINATE_SYSTEM.METER_OFFSETS,
    [
      [0, 0, 0],
      [200, 100, 80]
    ],
    new Matrix4().scale([1, 1, 0])
  );
  const projection = layer.getModeProps(layer.props).projection;
  expect(projection).toBeDefined();
  expect(projection!.unproject(layer.project([100, 50, 40]))).toBeUndefined();
});
