// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect, vi} from 'vitest';
import {OrthographicViewport} from '@deck.gl/core';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {TransformMode} from '../../../src/edit-modes/transform-mode';
import {DrawPointMode} from '../../../src/edit-modes/draw-point-mode';
import {DrawRectangleMode} from '../../../src/edit-modes/draw-rectangle-mode';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {DragSnappingStrategy} from '../../../src/edit-modes/snapping/drag-snapping-strategy';
import {SourceSnappingStrategy} from '../../../src/edit-modes/snapping/source-snapping-strategy';
import {cartesianCoordinateSystem} from '../../../src/edit-modes/coordinate-system';
import type {ModeProps, EditHandleFeature} from '../../../src/edit-modes/types';
import type {SimpleFeatureCollection} from '../../../src/utils/geojson-types';
import {
  createFeatureCollectionProps,
  createPointerMoveEvent,
  createClickEvent,
  createStartDraggingEvent
} from '../test-utils';

const viewport = new OrthographicViewport({width: 100, height: 100, zoom: 0, target: [0, 0, 0]});
const point = {
  type: 'Feature' as const,
  properties: {},
  geometry: {type: 'Point' as const, coordinates: [0, 0]}
};
function propsFor(): ModeProps<SimpleFeatureCollection> {
  return {
    ...createFeatureCollectionProps({data: {type: 'FeatureCollection', features: [point]}}),
    selectedIndexes: [],
    pickingRadius: 3,
    coordinateSystem: cartesianCoordinateSystem,
    modeConfig: {viewport, enableSnapping: true},
    lastPointerMoveEvent: createPointerMoveEvent([0.4, 0.4], [], [50.4, 49.6])
  } as ModeProps<SimpleFeatureCollection>;
}
function handle(kind: 'snap-source' | 'snap-target', featureIndex = 0): EditHandleFeature {
  return {
    ...point,
    properties: {guideType: 'editHandle', editHandleType: kind, featureIndex, positionIndexes: []}
  };
}

test('source movement preserves the real drag origin until a target qualifies', () => {
  const props = propsFor();
  props.selectedIndexes = [0];
  const pick = {index: 0, isGuide: true, object: handle('snap-source')};
  props.lastPointerMoveEvent.pointerDownPicks = [pick];
  const event = Object.freeze({...props.lastPointerMoveEvent, pointerDownMapCoords: [0.2, 0.2]});
  expect(new SourceSnappingStrategy().snapMovementEvent(props, event)).toBe(event);
});

test('an initial touch click snaps without any previously rendered guide', () => {
  const props = propsFor();
  const raw = createClickEvent([0.4, 0.4], []);
  raw.screenCoords = [50.4, 49.6];
  new SnappableMode(new DrawPointMode()).handleClick(raw, props);
  expect(
    vi.mocked(props.onEdit).mock.calls[0][0].updatedData.features[1].geometry.coordinates
  ).toEqual([0, 0]);
  expect(raw.mapCoords).toEqual([0.4, 0.4]);
});

test('drag-to-draw snaps its first corner as well as its release', () => {
  const props = propsFor();
  props.modeConfig.dragToDraw = true;
  const wrapped = new DrawRectangleMode();
  const mode = new SnappableMode(wrapped);
  const start = createStartDraggingEvent(
    [0.4, 0.4],
    [0.4, 0.4],
    [{index: 0, isGuide: true, object: handle('snap-target')}]
  );
  start.screenCoords = [50.4, 49.6];
  mode.handleStartDragging(start, props);
  expect(wrapped.getClickSequence()[0]).toEqual([0, 0]);
});

test('legacy handler inspection and replacement remain supported', () => {
  const first = new DrawPointMode();
  const second = new DrawRectangleMode();
  const wrapper = new SnappableMode(first);
  expect(wrapper._handler).toBe(first);
  wrapper._handler = second;
  expect(wrapper._wrappedMode).toBe(second);
});

test('a legacy TransformMode wrapper adds no duplicate snapping guides', () => {
  const props = propsFor();
  props.selectedIndexes = [0];
  const direct = new TransformMode();
  const wrapped = new SnappableMode(new TransformMode());
  const count = (mode: TransformMode | SnappableMode) =>
    mode
      .getGuides(props)
      .features.filter(feature => feature.properties.editHandleType === 'snap-source').length;
  expect(count(wrapped)).toBe(count(direct));
});

test.each([
  0, 4
])('snap targets never act as ModifyMode editable handles: index %i', featureIndex => {
  const props = propsFor();
  props.selectedIndexes = [0];
  const pick = {index: featureIndex, isGuide: true, object: handle('snap-target', featureIndex)};
  const event = {...createStartDraggingEvent([1, 1], [0, 0]), pointerDownPicks: [pick]};
  const mode = new ModifyMode();
  expect(() => mode.handleDragging(event, props)).not.toThrow();
  expect(() => mode.handleStopDragging(event, props)).not.toThrow();
  expect(props.onEdit).not.toHaveBeenCalled();
});

test('a stale target pick cannot snap a click outside the current radius', () => {
  const props = propsFor();
  const raw = createClickEvent(
    [20, 20],
    [{index: 0, isGuide: true, object: handle('snap-target')}]
  );
  raw.screenCoords = [70, 30];
  new SnappableMode(new DrawPointMode()).handleClick(raw, props);
  expect(
    vi.mocked(props.onEdit).mock.calls[0][0].updatedData.features[1].geometry.coordinates
  ).toEqual([20, 20]);
});

test('drag snapping stays inactive until an edit handle has been picked', () => {
  const props = propsFor();
  const strategy = new DragSnappingStrategy();
  const raw = props.lastPointerMoveEvent;
  expect(strategy.snapMovementEvent(props, raw)).toBe(raw);
  expect(strategy.snapClickEvent(props, raw)).toBe(raw);
});
