// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeEach, test, expect, vi, describe} from 'vitest';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {DrawPointMode} from '../../../src/edit-modes/draw-point-mode';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent,
  createStartDraggingEvent
} from '../test-utils';
import {viewport, center, pickingRadius} from '../../mocks';
import {SimpleFeatureCollection, FeatureCollection} from '../../../src/utils/geojson-types';
import {TranslateMode} from '../../../src/edit-modes/translate-mode';
import {GeoJsonEditMode, ModeProps} from '@deck.gl-community/editable-layers';
import {EditHandleFeature} from '../../../src/edit-modes/types';

const snapSourceHandle: EditHandleFeature = {
  type: 'Feature',
  properties: {
    guideType: 'editHandle',
    editHandleType: 'snap-source',
    featureIndex: 0,
    positionIndexes: []
  },
  geometry: {type: 'Point', coordinates: [1, 2]}
};

const snapTargetHandle: EditHandleFeature = {
  type: 'Feature',
  properties: {
    guideType: 'editHandle',
    editHandleType: 'snap-target',
    featureIndex: 1,
    positionIndexes: [1]
  },
  geometry: {type: 'Point', coordinates: [2, 3]}
};

const sourcePick = {index: 0, isGuide: true, object: snapSourceHandle};
const targetPick = {index: 1, isGuide: true, object: snapTargetHandle};

const simulateDragNearTarget = (
  mode: GeoJsonEditMode,
  props: ModeProps<SimpleFeatureCollection | FeatureCollection>
): void => {
  mode.handlePointerMove(createPointerMoveEvent([1, 2], [sourcePick]), props);
  mode.handleStartDragging(createStartDraggingEvent([1, 2], [1, 2], [sourcePick]), props);
  mode.handleDragging(createStartDraggingEvent([2.1, 3.1], [1, 2], [targetPick]), {
    ...props,
    lastPointerMoveEvent: {
      ...createPointerMoveEvent([2.1, 3.1], [targetPick]),
      pointerDownPicks: [sourcePick],
      isDragging: true
    }
  });
};

describe('translate mode', () => {
  let mode: GeoJsonEditMode;

  beforeEach(() => {
    mode = new SnappableMode(new TranslateMode());
  });

  test('when no pointer down picks renders snap source handles on selected feature', () => {
    const props = createFeatureCollectionProps({
      modeConfig: {enableSnapping: true},
      selectedIndexes: [0],
      lastPointerMoveEvent: createPointerMoveEvent()
    });

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(1);
    expect(guides.features[0].properties.guideType).toBe('editHandle');
    expect((guides.features[0] as EditHandleFeature).properties.editHandleType).toBe('snap-source');
    expect(guides.features[0].geometry.type).toEqual('Point');
    expect(guides.features[0].geometry.coordinates).toEqual([1, 2]);
  });

  test('when no pointer down picks renders no snap targets', () => {
    const offset = [center[0] + 0.001, center[1] + 0.001];
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: center}},
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [0, 0]}}
        ]
      },
      modeConfig: {enableSnapping: true, viewport},
      pickingRadius,
      lastPointerMoveEvent: createPointerMoveEvent(offset)
    });

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('dragging snap source onto snap target calls onEdit with snapped coordinates', () => {
    const mockOnEdit = vi.fn();
    const props = createFeatureCollectionProps({
      modeConfig: {enableSnapping: true},
      selectedIndexes: [0],
      onEdit: mockOnEdit
    });

    simulateDragNearTarget(mode, props);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const movedFeature = mockOnEdit.mock.calls[0][0].updatedData.features[0];
    expect(movedFeature.geometry.coordinates[0]).toBeCloseTo(2);
    expect(movedFeature.geometry.coordinates[1]).toBeCloseTo(3);
  });

  test('during active drag shows snap target handles and snap source handle as guides', () => {
    const props = createFeatureCollectionProps({
      modeConfig: {enableSnapping: true},
      selectedIndexes: [0],
      lastPointerMoveEvent: {
        ...createPointerMoveEvent([2.1, 3.1], [targetPick]),
        pointerDownPicks: [sourcePick],
        isDragging: true
      }
    });

    const guides = mode.getGuides(props);

    expect(guides.features.length).toBe(32);

    const firstHandle = guides.features[0] as EditHandleFeature;
    expect(firstHandle.properties.guideType).toBe('editHandle');
    expect(firstHandle.geometry.type).toEqual('Point');
    expect(firstHandle.geometry.coordinates).toEqual([1, 2]);
    expect(firstHandle.properties.editHandleType).toBe('snap-target');
    expect(firstHandle.properties.featureIndex).toBe(1);

    // The snap source shows its original position since onEdit is mocked
    const lastHandle = guides.features[31] as EditHandleFeature;
    expect(lastHandle.properties.guideType).toBe('editHandle');
    expect(lastHandle.geometry.type).toEqual('Point');
    expect(lastHandle.geometry.coordinates).toEqual([1, 2]);
    expect(lastHandle.properties.editHandleType).toBe('snap-source');
  });
});

describe('draw point mode', () => {
  let mode: GeoJsonEditMode;

  beforeEach(() => {
    mode = new SnappableMode(new DrawPointMode());
  });

  test('when snapping disabled, exact click location is used', () => {
    const mockOnEdit = vi.fn();
    const props = createFeatureCollectionProps({
      onEdit: mockOnEdit
    });

    mode.handleClick(createClickEvent([2.1, 3.1], [targetPick]), props);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const addedFeature = mockOnEdit.mock.calls[0][0].updatedData.features.at(-1);
    expect(addedFeature.geometry.coordinates).toEqual([2.1, 3.1]);
  });

  test('draw point snaps to snap targets', () => {
    const mockOnEdit = vi.fn();
    const props = createFeatureCollectionProps({
      modeConfig: {enableSnapping: true},
      onEdit: mockOnEdit
    });

    // Click slightly off the snap target — picks contain the snap-target handle
    mode.handleClick(createClickEvent([2.1, 3.1], [targetPick]), props);

    expect(mockOnEdit).toHaveBeenCalledTimes(1);
    const addedFeature = mockOnEdit.mock.calls[0][0].updatedData.features.at(-1);
    expect(addedFeature.geometry.coordinates).toEqual([2, 3]);
  });

  test('renders no snap targets when cursor is outside picking radius', () => {
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: center}}
        ]
      },
      selectedIndexes: [],
      modeConfig: {enableSnapping: true, viewport},
      pickingRadius,
      lastPointerMoveEvent: createPointerMoveEvent([-120, 38])
    });

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('in draw modes renders no snap sources when features are selected', () => {
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: center}}
        ]
      },
      selectedIndexes: [0],
      modeConfig: {enableSnapping: true, viewport},
      pickingRadius,
      lastPointerMoveEvent: createPointerMoveEvent([-120, 38])
    });

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(0);
  });

  test('renders nearest snap target when cursor is within picking radius', () => {
    const offset = [center[0] + 0.001, center[1] + 0.001];
    const props = createFeatureCollectionProps({
      data: {
        type: 'FeatureCollection',
        features: [
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: center}},
          {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: [0, 0]}}
        ]
      },
      selectedIndexes: [0],
      modeConfig: {enableSnapping: true, viewport},
      pickingRadius,
      lastPointerMoveEvent: createPointerMoveEvent(offset)
    });

    const guides = mode.getGuides(props);
    expect(guides.features.length).toBe(1);
    const handle = guides.features[0] as EditHandleFeature;
    expect(handle.properties.guideType).toBe('editHandle');
    expect(handle.geometry.type).toEqual('Point');
    expect(handle.geometry.coordinates).toEqual(center);
    expect(handle.properties.editHandleType).toBe('snap-target');
  });
});

// TODO - add tests that modeConfig.snapPixelRadius overrides the pickingRadius if specified
