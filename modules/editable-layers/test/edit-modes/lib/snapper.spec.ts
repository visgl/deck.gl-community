// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test, vi} from 'vitest';
import {OrthographicViewport} from '@deck.gl/core';
import {DefaultSnapper} from '../../../src/edit-modes/snapping/default-snapper';
import {ClickSnappingStrategy} from '../../../src/edit-modes/snapping/click-snapping-strategy';
import {DragSnappingStrategy} from '../../../src/edit-modes/snapping/drag-snapping-strategy';
import {SourceSnappingStrategy} from '../../../src/edit-modes/snapping/source-snapping-strategy';
import {getSnapTargetHandles} from '../../../src/edit-modes/snapping/snapping-utils';
import {cartesianCoordinateSystem} from '../../../src/edit-modes/coordinate-system';
import type {SimpleFeatureCollection} from '../../../src/utils/geojson-types';
import type {ModeProps, PointerMoveEvent} from '../../../src/edit-modes/types';
import {
  createFeatureCollectionProps,
  createPointerMoveEvent,
  createClickEvent
} from '../test-utils';

const viewport = new OrthographicViewport({width: 100, height: 100, target: [0, 0, 0], zoom: 0});
function createProps(): ModeProps<SimpleFeatureCollection> {
  return {
    ...createFeatureCollectionProps({data: {type: 'FeatureCollection', features: []}}),
    coordinateSystem: cartesianCoordinateSystem,
    pickingRadius: 3,
    modeConfig: {viewport, enableSnapping: true},
    lastPointerMoveEvent: createPointerMoveEvent([5, 1], [], [55, 49])
  } as ModeProps<SimpleFeatureCollection>;
}

const point = {
  type: 'Feature' as const,
  properties: {},
  geometry: {type: 'Point' as const, coordinates: [5, 1]}
};

test('default snapper tolerates absent config and invalid radius', () => {
  const props = createProps();
  props.modeConfig = null;
  expect(new DefaultSnapper().snap(props.lastPointerMoveEvent, props, new Set())).toBeNull();
  props.modeConfig = {viewport};
  for (const radius of [-1, NaN, Infinity]) {
    props.pickingRadius = radius;
    expect(new DefaultSnapper().snap(props.lastPointerMoveEvent, props, new Set())).toBeNull();
  }
});

test('external targets have no editable feature index and survive editable exclusions', () => {
  const props = createProps();
  props.data.features = [{...point, geometry: {...point.geometry, coordinates: [50, 50]}}];
  props.modeConfig.additionalSnapTargets = [point];
  const excluded = new Set([0]);
  const result = new DefaultSnapper().snap(props.lastPointerMoveEvent, props, excluded);
  expect(result).toEqual({mapCoords: [5, 1], featureIndex: undefined});
  expect([...excluded]).toEqual([0]);
  expect(
    getSnapTargetHandles(props, excluded).every(handle => handle.properties.featureIndex === -1)
  ).toBe(true);
});

test('unsupported external geometry is ignored safely', () => {
  const props = createProps();
  props.modeConfig.additionalSnapTargets = [
    {...point, geometry: null},
    {...point, geometry: {type: 'GeometryCollection', geometries: []}},
    point
  ];
  expect(
    new DefaultSnapper().snap(props.lastPointerMoveEvent, props, new Set())?.mapCoords
  ).toEqual([5, 1]);
});

test('custom policy works without a viewport or edge snapping', () => {
  const props = createProps();
  const snap = vi.fn(() => ({mapCoords: [7, 7]}));
  props.modeConfig = {enableSnapping: true, snapper: {snap}};
  const guides = new ClickSnappingStrategy().getSnapGuides(props);
  expect(guides.features[0].geometry.coordinates).toEqual([7, 7]);
  expect(guides.features[0].properties.featureIndex).toBe(-1);
  expect(snap).toHaveBeenCalledWith(props.lastPointerMoveEvent, props, new Set());
});

test('custom policy governs source targets instead of silently adding default vertices', () => {
  const props = createProps();
  props.data.features = [point, {...point, geometry: {...point.geometry, coordinates: [0, 0]}}];
  props.selectedIndexes = [0];
  const source = {
    type: 'Feature',
    geometry: point.geometry,
    properties: {
      guideType: 'editHandle',
      editHandleType: 'snap-source',
      featureIndex: 0,
      positionIndexes: []
    }
  };
  props.lastPointerMoveEvent.pointerDownPicks = [{index: 0, isGuide: true, object: source}];
  const snap = vi.fn(() => ({mapCoords: [7, 7]}));
  props.modeConfig.snapper = {snap};
  const guides = new SourceSnappingStrategy().getSnapGuides(props);
  expect(guides.features.map(feature => feature.geometry.coordinates)).toEqual([
    [7, 7],
    [5, 1]
  ]);
  expect(snap).toHaveBeenCalledWith(props.lastPointerMoveEvent, props, new Set([0]));
  props.modeConfig.snapper = {snap: () => null};
  expect(new SourceSnappingStrategy().getSnapGuides(props).features).toHaveLength(1);
});

test('custom dynamic targets recompute from the current frozen event without edge snapping', () => {
  const props = createProps();
  props.modeConfig.snapper = {
    snap: (event: PointerMoveEvent) => ({mapCoords: [event.mapCoords[0], 0]})
  };
  props.lastPointerMoveEvent = Object.freeze(
    createPointerMoveEvent(
      [5, 1],
      [
        {
          index: 0,
          isGuide: true,
          object: {
            type: 'Feature',
            geometry: {type: 'Point', coordinates: [0, 0]},
            properties: {guideType: 'editHandle', editHandleType: 'snap-target', featureIndex: -1}
          }
        }
      ],
      [55, 49]
    )
  );
  const result = new ClickSnappingStrategy().snapMovementEvent(props, props.lastPointerMoveEvent);
  expect(result.mapCoords).toEqual([5, 0]);
  expect(props.lastPointerMoveEvent.mapCoords).toEqual([5, 1]);
});

test('custom policies apply click and movement targets beyond the guide picking radius', () => {
  const props = createProps();
  const snap = vi.fn(() => ({mapCoords: [25, 1]}));
  props.modeConfig.snapper = {snap};
  const policy = new ClickSnappingStrategy();
  expect(policy.snapClickEvent(props, createClickEvent([5, 1])).mapCoords).toEqual([25, 1]);
  const raw = Object.freeze(createPointerMoveEvent([5, 1], [], [55, 49]));
  expect(policy.snapMovementEvent(props, raw).mapCoords).toEqual([25, 1]);
  expect(raw.mapCoords).toEqual([5, 1]);
});

test('custom policies do not activate handle dragging or translation without an active source', () => {
  const props = createProps();
  const snap = vi.fn(() => ({mapCoords: [25, 1]}));
  props.modeConfig.snapper = {snap};
  const raw = props.lastPointerMoveEvent;
  expect(new DragSnappingStrategy().snapMovementEvent(props, raw)).toBe(raw);
  expect(new SourceSnappingStrategy().snapMovementEvent(props, raw)).toBe(raw);
  expect(snap).not.toHaveBeenCalled();
  props.lastPointerMoveEvent.pointerDownPicks = [
    {
      index: 0,
      isGuide: true,
      object: {
        type: 'Feature',
        geometry: point.geometry,
        properties: {
          guideType: 'editHandle',
          editHandleType: 'existing',
          featureIndex: 0,
          positionIndexes: []
        }
      }
    }
  ];
  expect(new DragSnappingStrategy().snapMovementEvent(props, raw).mapCoords).toEqual([25, 1]);
});
