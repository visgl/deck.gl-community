// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, test, vi} from 'vitest';
import {OrthographicViewport} from '@deck.gl/core';
import {SnappableMode} from '../../../src/edit-modes/snappable-mode';
import {GeoJsonEditMode} from '../../../src/edit-modes/geojson-edit-mode';
import {TransformMode} from '../../../src/edit-modes/transform-mode';
import {DrawPointMode} from '../../../src/edit-modes/draw-point-mode';
import {DrawLineStringMode} from '../../../src/edit-modes/draw-line-string-mode';
import {MeasureDistanceMode} from '../../../src/edit-modes/measure-distance-mode';
import {ClickSnappingStrategy} from '../../../src/edit-modes/snapping/click-snapping-strategy';
import {ModifyMode} from '../../../src/edit-modes/modify-mode';
import {cartesianCoordinateSystem} from '../../../src/edit-modes/coordinate-system';
import {
  getClosestSnapTargetHandle,
  snapMovementEventToPickedTarget
} from '../../../src/edit-modes/snapping/snapping-utils';
import {SourceSnappingStrategy} from '../../../src/edit-modes/snapping/source-snapping-strategy';
import type {
  SimpleFeature,
  SimpleFeatureCollection,
  Position
} from '../../../src/utils/geojson-types';
import type {
  EditHandleFeature,
  ModeProps,
  PointerMoveEvent,
  ScreenCoordinates
} from '../../../src/edit-modes/types';
import {
  createFeatureCollectionProps,
  createClickEvent,
  createPointerMoveEvent
} from '../test-utils';

const viewport = new OrthographicViewport({width: 100, height: 100, target: [0, 0, 0], zoom: 0});
const line: SimpleFeature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [10, 0]
    ]
  }
};

function propsFor(
  features: SimpleFeature[],
  pointer: Position = [5, 1],
  activeViewport = viewport
): ModeProps<SimpleFeatureCollection> {
  return {
    ...createFeatureCollectionProps({data: {type: 'FeatureCollection', features}}),
    coordinateSystem: cartesianCoordinateSystem,
    pickingRadius: 3,
    selectedIndexes: [],
    modeConfig: {enableSnapping: true, edgeSnapping: true, viewport: activeViewport},
    lastPointerMoveEvent: createPointerMoveEvent(
      pointer,
      [],
      activeViewport.project(pointer).slice(0, 2) as ScreenCoordinates
    )
  } as ModeProps<SimpleFeatureCollection>;
}

function handle(
  coordinates: Position,
  editHandleType: 'snap-target' | 'snap-source' = 'snap-target'
): EditHandleFeature {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates},
    properties: {guideType: 'editHandle', editHandleType, featureIndex: 0, positionIndexes: [0]}
  };
}

describe('snapping review regressions', () => {
  test('guides use the GeoJSON FeatureCollection discriminator', () => {
    expect(new SnappableMode(new DrawPointMode()).getGuides(propsFor([line])).type).toBe(
      'FeatureCollection'
    );
  });

  test('existing custom and TransformMode wrappers remain constructible and forward events', () => {
    const custom = new GeoJsonEditMode();
    const click = vi.spyOn(custom, 'handleClick');
    const wrapper = new SnappableMode(custom);
    const props = propsFor([line]);
    props.modeConfig.enableSnapping = false;
    const event = createClickEvent([2, 2]);
    wrapper.handleClick(event, props);
    expect(click).toHaveBeenCalledWith(event, props);
    expect(() => new SnappableMode(new TransformMode())).not.toThrow();
  });

  test.each([
    {coordinates: [[0, 0]]},
    {
      coordinates: [
        [0, 0],
        [10, 0]
      ]
    }
  ])('MultiPoint vertices do not create an edge: $coordinates', ({coordinates}) => {
    const multiPoint: SimpleFeature = {
      type: 'Feature',
      properties: {},
      geometry: {type: 'MultiPoint', coordinates}
    };
    expect(getClosestSnapTargetHandle(propsFor([multiPoint]), [])).toBeUndefined();
  });

  test('snapping never mutates an event shared with another mode or guide generation', () => {
    const event = Object.freeze(
      createPointerMoveEvent([5, 1], [{index: 0, isGuide: true, object: handle([0, 0])}])
    ) as PointerMoveEvent;
    const snapped = snapMovementEventToPickedTarget(event);
    expect(event.mapCoords).toEqual([5, 1]);
    expect(snapped).not.toBe(event);
    expect(snapped.mapCoords).toEqual([0, 0]);
  });

  test('source snapping preserves the pointer-down event as well as raw movement', () => {
    const props = propsFor([line]);
    props.lastPointerMoveEvent.pointerDownPicks = [
      {index: 0, isGuide: true, object: handle([0, 0], 'snap-source')}
    ];
    const event = Object.freeze({...props.lastPointerMoveEvent, pointerDownMapCoords: [1, 1]});
    const snapped = new SourceSnappingStrategy().snapMovementEvent(props, event);
    expect(event.pointerDownMapCoords).toEqual([1, 1]);
    expect(snapped.pointerDownMapCoords).toEqual([0, 0]);
  });

  test('edge guides follow current screen coordinates even when map coordinates are stale', () => {
    const props = propsFor([line]);
    props.lastPointerMoveEvent.mapCoords = [0, 0];
    const target = getClosestSnapTargetHandle(props, []);
    expect(target?.geometry.coordinates[0]).toBeCloseTo(5);
    expect(target?.geometry.coordinates[1]).toBeCloseTo(0);
  });

  test('projected 3D edges stop at their endpoints', () => {
    const elevated: SimpleFeature = {
      ...line,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0, 0],
          [10, 0, 10]
        ]
      }
    };
    expect(getClosestSnapTargetHandle(propsFor([elevated], [-5, 1]), [])).toBeUndefined();
    const target = getClosestSnapTargetHandle(propsFor([elevated], [5, 1]), []);
    expect(target?.geometry.coordinates[0]).toBeCloseTo(5);
    expect(target?.geometry.coordinates[2]).toBeCloseTo(5);
  });

  test('Cartesian snapping measures the nearest segment in projected pixels', () => {
    const scaled = new OrthographicViewport({
      width: 100,
      height: 100,
      target: [0, 0, 0],
      zoom: [Math.log2(10), 0]
    });
    const diagonal: SimpleFeature = {
      ...line,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [10, 10]
        ]
      }
    };
    const props = propsFor([diagonal], [5, 0], scaled);
    props.pickingRadius = 6;
    const target = getClosestSnapTargetHandle(props, []);
    expect(target?.geometry.coordinates[0]).toBeCloseTo(500 / 101);
    expect(target?.geometry.coordinates[1]).toBeCloseTo(500 / 101);
  });

  test('ModifyMode still dispatches overridden nearest-point calculation', () => {
    class CustomModify extends ModifyMode {
      override getNearestPoint() {
        return {
          type: 'Feature' as const,
          geometry: {type: 'Point' as const, coordinates: [4, 0]},
          properties: {dist: 0, index: 0}
        };
      }
    }
    const mode = new CustomModify();
    const resolver = vi.spyOn(mode, 'getNearestPoint');
    const props = propsFor([line]);
    props.selectedIndexes = [0];
    props.lastPointerMoveEvent.picks = [{index: 0, object: line}];
    const guides = mode.getGuides(props);
    expect(resolver).toHaveBeenCalledOnce();
    expect(
      guides.features.find(feature => feature.properties.editHandleType === 'intermediate')
        ?.geometry.coordinates
    ).toEqual([4, 0]);
  });

  test.each([
    false,
    true
  ])('line completion survives an overlapping snap target, target first: %s', targetFirst => {
    const mode = new SnappableMode(new DrawLineStringMode());
    const props = propsFor([]);
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([10, 0]), props);
    const existing = mode
      .getGuides(props)
      .features.find(feature => feature.properties.positionIndexes?.[0] === 1);
    const targetPick = {index: 0, isGuide: true, object: handle([10, 0])};
    const existingPick = {index: 1, isGuide: true, object: existing};
    props.onEdit = vi.fn();
    mode.handleClick(
      createClickEvent(
        [10, 0],
        targetFirst ? [targetPick, existingPick] : [existingPick, targetPick]
      ),
      props
    );
    expect(props.onEdit).toHaveBeenCalledOnce();
    expect(vi.mocked(props.onEdit).mock.calls[0][0].editType).toBe('addFeature');
  });

  test.each([
    'Enter',
    'Escape',
    'doubleClick'
  ])('wrapped drawing forwards completion/cancellation: %s', action => {
    const mode = new SnappableMode(new DrawLineStringMode());
    const props = propsFor([]);
    mode.handleClick(createClickEvent([0, 0]), props);
    mode.handleClick(createClickEvent([10, 0]), props);
    props.onEdit = vi.fn();
    if (action === 'doubleClick') mode.handleDoubleClick(createClickEvent([10, 0]), props);
    else mode.handleKeyUp({key: action} as KeyboardEvent, props);
    expect(vi.mocked(props.onEdit).mock.calls[0][0].editType).toBe(
      action === 'Escape' ? 'cancelFeature' : 'addFeature'
    );
  });
  test.each([
    false,
    true
  ])('tentative callbacks agree with guides without mutating raw props, snapping: %s', enabled => {
    const props = propsFor([line]);
    props.modeConfig.edgeSnapping = false;
    props.modeConfig.enableSnapping = enabled;
    const raw = Object.freeze(
      createPointerMoveEvent([5, 1], [{index: 0, isGuide: true, object: handle([0, 0])}], [55, 49])
    );
    props.lastPointerMoveEvent = raw;
    const mode = new SnappableMode(new DrawPointMode());
    mode.handlePointerMove(raw, props);
    expect(
      vi.mocked(props.onEdit).mock.calls[0][0].editContext.feature.geometry.coordinates
    ).toEqual(enabled ? [0, 0] : [5, 1]);
    expect(props.lastPointerMoveEvent).toBe(raw);
    expect(raw.mapCoords).toEqual([5, 1]);
  });

  test('measurement tooltips use the same snapped position as guides', () => {
    const mode = new SnappableMode(new MeasureDistanceMode());
    const props = propsFor([line]);
    props.modeConfig.edgeSnapping = false;
    mode.handleClick(createClickEvent([10, 0]), props);
    props.lastPointerMoveEvent = createPointerMoveEvent(
      [5, 1],
      [{index: 0, isGuide: true, object: handle([0, 0])}]
    );
    const tips = mode.getTooltips(props);
    expect(tips[0].position).toEqual([0, 0]);
    expect(tips[0].text).toBe('10.00 kilometers');
  });

  test('moving edge targets are recomputed before applying the event', () => {
    const props = propsFor([line]);
    props.lastPointerMoveEvent.picks = [{index: 0, isGuide: true, object: handle([0, 0])}];
    const snapped = new ClickSnappingStrategy().snapMovementEvent(
      props,
      props.lastPointerMoveEvent
    );
    expect(snapped.mapCoords[0]).toBeCloseTo(5);
    expect(snapped.mapCoords[1]).toBeCloseTo(0);
  });
});
