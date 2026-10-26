// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {WebMercatorViewport} from '@deck.gl/core';
import {beforeEach, afterEach, test, expect, vi} from 'vitest';
import {TransformMode} from '../../../src/edit-modes/transform-mode';
import {TranslateMode} from '../../../src/edit-modes/translate-mode';
import {
  createFeatureCollectionProps,
  createPointerMoveEvent,
  createStartDraggingEvent,
  createStopDraggingEvent
} from '../test-utils';
import {Pick, ModeProps} from '../../../src/edit-modes/types';
import {FeatureCollection} from '../../../src/utils/geojson-types';

let transformMode: TransformMode;

let warnBefore: typeof console.warn;
beforeEach(() => {
  warnBefore = console.warn; // eslint-disable-line
  // $FlowFixMe
  console.warn = function () {}; // eslint-disable-line
  transformMode = new TransformMode();
});

afterEach(() => {
  // $FlowFixMe
  console.warn = warnBefore; // eslint-disable-line
});

const mockMove = (picks: Pick[], props: ModeProps<FeatureCollection>) => {
  const moveEvent = createPointerMoveEvent([-1, -1], picks);
  transformMode.handlePointerMove(moveEvent, props);

  const startDragEvent = createStartDraggingEvent([-1, -1], [-1, -1], picks);
  transformMode.handleStartDragging(startDragEvent, props);

  const stopDragEvent = createStopDraggingEvent([2, 3], [-1, -1], picks);
  transformMode.handleStopDragging(stopDragEvent, props);
};

test('Selected polygon feature can be translated', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    selectedIndexes: [2],
    onEdit: mockOnEdit
  });
  mockMove([{index: 2, isGuide: false, object: null}], props);

  expect(mockOnEdit).toHaveBeenCalledTimes(1);
  const movedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[2];
  expect(movedFeature).toMatchSnapshot();
  expect(props.data.features[2]).not.toEqual(movedFeature);
});

test('Selected polygon feature can be translated in screen space', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    selectedIndexes: [2],
    onEdit: mockOnEdit
  });
  mockMove([{index: 2, isGuide: false, object: null}], {
    ...props,
    modeConfig: {screenSpace: true, viewport: {width: 600, height: 480, zoom: 5}}
  });

  expect(mockOnEdit).toHaveBeenCalledTimes(1);
  const movedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[2];
  expect(movedFeature).toMatchSnapshot();
  expect(props.data.features[2]).not.toEqual(movedFeature);
});

test('Screen-space translation follows the pointer when the camera target is lifted', () => {
  const viewport = new WebMercatorViewport({
    width: 800,
    height: 600,
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 18,
    pitch: 45,
    position: [0, 0, 30]
  });
  // The editable layer reads pointer map coordinates on the camera target's plane.
  const at = ([x, y]: number[]) => viewport.unproject([x, y], {targetZ: 30}).slice(0, 2);
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    data: {
      type: 'FeatureCollection',
      features: [
        {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: at([300, 250])}}
      ]
    },
    selectedIndexes: [0],
    onEdit: mockOnEdit,
    modeConfig: {screenSpace: true, viewport}
  });
  const picks = [{index: 0, isGuide: false, object: null}];
  const translateMode = new TranslateMode();
  translateMode.handlePointerMove(createPointerMoveEvent(at([400, 300]), picks), props);
  translateMode.handleStartDragging(
    createStartDraggingEvent(at([400, 300]), at([400, 300]), picks),
    props
  );
  translateMode.handleStopDragging(
    createStopDraggingEvent(at([460, 260]), at([400, 300]), picks),
    props
  );

  const [lng, lat, ...rest] =
    mockOnEdit.mock.calls[0][0].updatedData.features[0].geometry.coordinates;
  const [x, y] = viewport.project([lng, lat, 30]);
  expect(rest).toEqual([]);
  expect(x).toBeCloseTo(360, 2);
  expect(y).toBeCloseTo(210, 2);
});

test('Non-picked selected polygon feature cannot be translated', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    selectedIndexes: [2],
    onEdit: mockOnEdit
  });
  mockMove([], props);
  expect(mockOnEdit).toHaveBeenCalledTimes(0);
});

test('Picked non-selected polygon feature cannot be translated', () => {
  const mockOnEdit = vi.fn();
  const props = createFeatureCollectionProps({
    selectedIndexes: [0],
    onEdit: mockOnEdit
  });
  mockMove([{index: 2, isGuide: false, object: null}], props);
  expect(mockOnEdit).toHaveBeenCalledTimes(0);
});
