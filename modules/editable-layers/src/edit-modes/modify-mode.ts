// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  getEditHandlesForGeometry,
  getPickedEditHandles,
  getPickedEditHandle,
  getPickedExistingEditHandle,
  getPickedIntermediateEditHandle,
  updateRectanglePosition,
  shouldCancelPan,
  findNearestPointOnGeometry,
  getNearestPoint,
  NearestPointType
} from './utils';
import {
  Polygon,
  FeatureCollection,
  Feature,
  SimpleFeatureCollection,
  Point,
  LineString
} from '../utils/geojson-types';
import {
  ModeProps,
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  GuideFeatureCollection,
  EditHandleFeature,
  GuideFeature,
  SnappingBehavior,
  Viewport
} from './types';
import {GeoJsonEditMode} from './geojson-edit-mode';
import {ImmutableFeatureCollection} from './immutable-feature-collection';
import {EditModeCoordinateSystem} from './coordinate-system';

export class ModifyMode extends GeoJsonEditMode {
  // eslint-disable-next-line complexity
  getGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    const handles: GuideFeature[] = [];

    const {data, lastPointerMoveEvent} = props;
    const {features} = data;
    const picks = lastPointerMoveEvent && lastPointerMoveEvent.picks;
    const mapCoords = lastPointerMoveEvent && lastPointerMoveEvent.mapCoords;

    for (const index of props.selectedIndexes) {
      if (index < features.length) {
        const {geometry} = features[index];
        handles.push(...getEditHandlesForGeometry(geometry, index));
      } else {
        console.warn(`selectedFeatureIndexes out of range ${index}`); // eslint-disable-line no-console,no-undef
      }
    }

    // intermediate edit handle
    if (picks && picks.length && mapCoords) {
      const existingEditHandle = getPickedExistingEditHandle(picks);
      // don't show intermediate point when too close to an existing edit handle
      const featureAsPick = !existingEditHandle && picks.find(pick => !pick.isGuide);

      // is the feature in the pick selected
      if (
        featureAsPick &&
        !featureAsPick.object.geometry.type.includes('Point') &&
        !(
          props.modeConfig?.lockRectangles && featureAsPick.object.properties.shape === 'Rectangle'
        ) &&
        props.selectedIndexes.includes(featureAsPick.index)
      ) {
        const {nearestPoint: intermediatePoint, positionIndexPrefix} = findNearestPointOnGeometry(
          featureAsPick.object,
          mapCoords,
          props.modeConfig?.viewport,
          props.coordinateSystem
        );
        if (intermediatePoint) {
          const {
            geometry: {coordinates: position},
            properties: {index}
          } = intermediatePoint;
          handles.push({
            type: 'Feature',
            properties: {
              guideType: 'editHandle',
              editHandleType: 'intermediate',
              featureIndex: featureAsPick.index,
              positionIndexes: [...positionIndexPrefix, index + 1]
            },
            geometry: {
              type: 'Point',
              coordinates: position
            }
          });
        }
      }
    }

    return {
      type: 'FeatureCollection',
      features: handles
    };
  }

  getNearestPoint(
    line: Feature<LineString>,
    inPoint: Feature<Point>,
    viewport: Viewport | null | undefined,
    coordinateSystem?: EditModeCoordinateSystem
  ): NearestPointType {
    return getNearestPoint(line, inPoint, viewport, coordinateSystem);
  }

  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    const pickedExistingHandle = getPickedExistingEditHandle(event.picks);
    const pickedIntermediateHandle = getPickedIntermediateEditHandle(event.picks);

    if (pickedExistingHandle) {
      const {featureIndex, positionIndexes} = pickedExistingHandle.properties;

      const feature = props.data.features[featureIndex];
      const canRemovePosition = !(
        props.modeConfig?.lockRectangles && feature?.properties.shape === 'Rectangle'
      );
      if (canRemovePosition) {
        let updatedData;
        try {
          updatedData = new ImmutableFeatureCollection(props.data)
            .removePosition(featureIndex, positionIndexes)
            .getObject();
        } catch (_ignored) {
          // This happens if user attempts to remove the last point
        }

        if (updatedData) {
          props.onEdit({
            updatedData,
            editType: 'removePosition',
            editContext: {
              featureIndexes: [featureIndex],
              positionIndexes,
              position: pickedExistingHandle.geometry.coordinates
            }
          });
        }
      }
    } else if (pickedIntermediateHandle) {
      const {featureIndex, positionIndexes} = pickedIntermediateHandle.properties;

      const feature = props.data.features[featureIndex];
      const canAddPosition = !(
        props.modeConfig?.lockRectangles && feature?.properties.shape === 'Rectangle'
      );

      if (canAddPosition) {
        const updatedData = new ImmutableFeatureCollection(props.data)
          .addPosition(featureIndex, positionIndexes, pickedIntermediateHandle.geometry.coordinates)
          .getObject();

        if (updatedData) {
          props.onEdit({
            updatedData,
            editType: 'addPosition',
            editContext: {
              featureIndexes: [featureIndex],
              positionIndexes,
              position: pickedIntermediateHandle.geometry.coordinates
            }
          });
        }
      }
    }
  }

  handleDragging(event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>): void {
    const editHandle = getPickedEditHandle(event.pointerDownPicks);

    if (editHandle) {
      // Cancel map panning if pointer went down on an edit handle
      event.cancelPan();

      this._dragEditHandle('movePosition', props, editHandle, event);
    }
  }

  _dragEditHandle(
    editType: string,
    props: ModeProps<SimpleFeatureCollection>,
    editHandle: EditHandleFeature,
    event: StopDraggingEvent | DraggingEvent
  ) {
    const editHandleProperties = editHandle.properties;
    const editedFeature = props.data.features[editHandleProperties.featureIndex];

    let updatedData;
    if (props.modeConfig?.lockRectangles && editedFeature.properties.shape === 'Rectangle') {
      const coordinates = updateRectanglePosition(
        editedFeature as Feature<Polygon>,
        editHandleProperties.positionIndexes[1],
        event.mapCoords
      ) as any; // TODO

      updatedData = new ImmutableFeatureCollection(props.data)
        .replaceGeometry(editHandleProperties.featureIndex, {coordinates, type: 'Polygon'})
        .getObject();
    } else {
      updatedData = new ImmutableFeatureCollection(props.data)
        .replacePosition(
          editHandleProperties.featureIndex,
          editHandleProperties.positionIndexes,
          event.mapCoords
        )
        .getObject();
    }

    props.onEdit({
      updatedData,
      editType,
      editContext: {
        featureIndexes: [editHandleProperties.featureIndex],
        positionIndexes: editHandleProperties.positionIndexes,
        position: event.mapCoords
      }
    });
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>): void {
    const cursor = this.getCursor(event);
    props.onUpdateCursor(cursor);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    if (shouldCancelPan(event)) {
      event.cancelPan();
    }

    const selectedFeatureIndexes = props.selectedIndexes;

    const editHandle = getPickedIntermediateEditHandle(event.picks);
    if (selectedFeatureIndexes.length && editHandle) {
      const editHandleProperties = editHandle.properties;

      const updatedData = new ImmutableFeatureCollection(props.data)
        .addPosition(
          editHandleProperties.featureIndex,
          editHandleProperties.positionIndexes,
          event.mapCoords
        )
        .getObject();

      props.onEdit({
        updatedData,
        editType: 'addPosition',
        editContext: {
          featureIndexes: [editHandleProperties.featureIndex],
          positionIndexes: editHandleProperties.positionIndexes,
          position: event.mapCoords
        }
      });
    }
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const selectedFeatureIndexes = props.selectedIndexes;
    const editHandle = getPickedEditHandle(event.pointerDownPicks);
    if (selectedFeatureIndexes.length && editHandle) {
      this._dragEditHandle('finishMovePosition', props, editHandle, event);
    }
  }

  getCursor(event: PointerMoveEvent): string | null | undefined {
    const picks = (event && event.picks) || [];

    const handlesPicked = getPickedEditHandles(picks);
    if (handlesPicked.length) {
      return 'cell';
    }
    return null;
  }

  getSnappingBehavior(): SnappingBehavior {
    return 'WhenDragging';
  }
}
