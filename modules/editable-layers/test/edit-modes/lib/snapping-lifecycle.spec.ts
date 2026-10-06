// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {test, expect, vi} from 'vitest';
import {OrthographicViewport} from '@deck.gl/core';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {DrawRectangleMode} from '../../../src/edit-modes/draw-rectangle-mode';
import {DragSnappingStrategy} from '../../../src/edit-modes/snapping/drag-snapping-strategy';
import {SourceSnappingStrategy} from '../../../src/edit-modes/snapping/source-snapping-strategy';
import {cartesianCoordinateSystem} from '../../../src/edit-modes/coordinate-system';
import {
  createFeatureCollectionProps,
  createPointerMoveEvent,
  createClickEvent,
  createStartDraggingEvent
} from '../test-utils';

const viewport = new OrthographicViewport({width: 100, height: 100, zoom: 0, target: [0, 0, 0]});
const target = {
  type: 'Feature' as const,
  properties: {},
  geometry: {type: 'Point' as const, coordinates: [0, 0]}
};
const propsFor = () => ({
  ...createFeatureCollectionProps({data: {type: 'FeatureCollection', features: [target]}}),
  selectedIndexes: [],
  pickingRadius: 3,
  coordinateSystem: cartesianCoordinateSystem,
  modeConfig: {viewport, enableSnapping: true},
  lastPointerMoveEvent: createPointerMoveEvent([0.4, 0.4], [], [50.4, 49.6])
});

test.each([
  'existing',
  'snap-source'
])('fresh drag picks activate the policy before any move is cached: %s', kind => {
  const props = propsFor();
  props.data.features = [{...target, geometry: {type: 'Point', coordinates: [20, 20]}}, target];
  props.selectedIndexes = [0];
  const pick = {
    index: 0,
    isGuide: true,
    object: {
      ...props.data.features[0],
      properties: {
        guideType: 'editHandle',
        editHandleType: kind,
        featureIndex: 0,
        positionIndexes: []
      }
    }
  };
  const event = {
    ...createStartDraggingEvent([0.4, 0.4], [20, 20], [], [50.4, 49.6]),
    pointerDownPicks: [pick]
  };
  const strategy = kind === 'existing' ? new DragSnappingStrategy() : new SourceSnappingStrategy();
  expect(strategy.snapMovementEvent(props, event).mapCoords).toEqual([0, 0]);
  expect(props.lastPointerMoveEvent.pointerDownPicks).toBeNull();
});

test.each([
  false,
  true
])('finished rectangle agrees with snapped preview; drag-to-draw: %s', dragToDraw => {
  const props = propsFor();
  props.modeConfig = {...props.modeConfig, dragToDraw};
  const mode = new SnappableMode(new DrawRectangleMode());
  if (dragToDraw)
    mode.handleStartDragging(createStartDraggingEvent([10, 10], [10, 10], [], [60, 40]), props);
  else {
    const first = createClickEvent([10, 10]);
    first.screenCoords = [60, 40];
    mode.handleClick(first, props);
  }
  const raw = Object.freeze(createPointerMoveEvent([0.4, 0.4], [], [50.4, 49.6]));
  props.lastPointerMoveEvent = raw;
  const preview = mode
    .getGuides(props)
    .features.find(feature => feature.properties.guideType === 'tentative');
  expect(preview.geometry.coordinates[0]).toContainEqual([0, 0]);
  props.onEdit = vi.fn();
  if (dragToDraw)
    mode.handleStopDragging(
      createStartDraggingEvent([0.4, 0.4], [10, 10], [], [50.4, 49.6]),
      props
    );
  else {
    const second = createClickEvent([0.4, 0.4]);
    second.screenCoords = [50.4, 49.6];
    mode.handleClick(second, props);
  }
  const committed = vi.mocked(props.onEdit).mock.calls[0][0].updatedData.features[1];
  expect(committed.geometry.coordinates).toEqual(preview.geometry.coordinates);
  expect(raw.mapCoords).toEqual([0.4, 0.4]);
});

test.each([
  'existing',
  'snap-source'
])('explicit cleared drag picks override cached picks: %s', kind => {
  const props = propsFor();
  props.data.features = [{...target, geometry: {type: 'Point', coordinates: [20, 20]}}, target];
  props.selectedIndexes = [0];
  props.lastPointerMoveEvent.pointerDownPicks = [
    {
      index: 0,
      isGuide: true,
      object: {
        ...props.data.features[0],
        properties: {
          guideType: 'editHandle',
          editHandleType: kind,
          featureIndex: 0,
          positionIndexes: []
        }
      }
    }
  ];
  const event = {
    ...createStartDraggingEvent([0.4, 0.4], [20, 20], [], [50.4, 49.6]),
    pointerDownPicks: null
  };
  const strategy = kind === 'existing' ? new DragSnappingStrategy() : new SourceSnappingStrategy();
  expect(strategy.snapMovementEvent(props, event)).toBe(event);
});

test('drag exclusions use the current handle rather than a stale cached handle', () => {
  const props = propsFor();
  props.data.features = [{...target, geometry: {type: 'Point', coordinates: [20, 20]}}, target];
  const pick = featureIndex => ({
    index: featureIndex,
    isGuide: true,
    object: {
      ...props.data.features[featureIndex],
      properties: {
        guideType: 'editHandle',
        editHandleType: 'existing',
        featureIndex,
        positionIndexes: []
      }
    }
  });
  props.lastPointerMoveEvent.pointerDownPicks = [pick(0)];
  const event = {
    ...createStartDraggingEvent([0.4, 0.4], [0, 0], [], [50.4, 49.6]),
    pointerDownPicks: [pick(1)]
  };
  expect(new DragSnappingStrategy().snapMovementEvent(props, event)).toBe(event);
});
