// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Position,
  FeatureCollection,
  SimpleFeatureCollection,
  SimpleFeature
} from '../utils/geojson-types';
import {
  ClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  ModeProps,
  Pick,
  GuideFeatureCollection,
  EditHandleFeature
} from './types';
import {
  getPickedSnapSourceEditHandle,
  getPickedEditHandles,
  getEditHandlesForGeometry,
  toWebMercatorViewport,
  distance2d
} from './utils';
import {GeoJsonEditMode} from './geojson-edit-mode';

type MovementTypeEvent = PointerMoveEvent | StartDraggingEvent | StopDraggingEvent | DraggingEvent;

export class SnappableMode extends GeoJsonEditMode {
  _handler: GeoJsonEditMode;

  constructor(handler: GeoJsonEditMode) {
    super();
    this._handler = handler;
  }

  _getSnappedMouseEvent<T extends MovementTypeEvent>(
    event: T,
    snapSource: EditHandleFeature,
    snapTarget: EditHandleFeature
  ): T {
    return Object.assign(event, {
      mapCoords: snapTarget.geometry.coordinates,
      pointerDownMapCoords: snapSource && snapSource.geometry.coordinates
    });
  }

  _getPickedSnapTarget(picks: Pick[]): EditHandleFeature | null | undefined {
    return getPickedEditHandles(picks).find(
      handle => handle.properties.editHandleType === 'snap-target'
    );
  }

  _getPickedSnapSource(
    pointerDownPicks: Pick[] | null | undefined
  ): EditHandleFeature | null | undefined {
    return getPickedSnapSourceEditHandle(pointerDownPicks);
  }

  _getUpdatedSnapSourceHandle(
    snapSourceHandle: EditHandleFeature,
    data: SimpleFeatureCollection
  ): EditHandleFeature {
    const {featureIndex, positionIndexes} = snapSourceHandle.properties;
    if (!Array.isArray(positionIndexes)) {
      return snapSourceHandle;
    }
    const snapSourceFeature = data.features[featureIndex];

    // $FlowFixMe
    const snapSourceCoordinates = positionIndexes.reduce(
      (a: any[], b: number) => a[b],
      snapSourceFeature.geometry.coordinates
    ) as Position;

    return {
      ...snapSourceHandle,
      geometry: {
        type: 'Point',
        coordinates: snapSourceCoordinates
      }
    };
  }

  // If additionalSnapTargets is present in modeConfig and is populated, this
  // method will return those features along with the features
  // that live in the current layer. Otherwise, this method will simply return the
  // features from the current layer
  _getSnapTargets(props: ModeProps<SimpleFeatureCollection>): SimpleFeature[] {
    let {additionalSnapTargets} = props.modeConfig || {};
    additionalSnapTargets = additionalSnapTargets || [];

    const features = [...props.data.features, ...additionalSnapTargets];
    return features;
  }

  _getClosestSnapTargetHandle(
    props: ModeProps<SimpleFeatureCollection>,
    cursorCoords: [number, number],
    wmViewport: ReturnType<typeof toWebMercatorViewport>
  ): EditHandleFeature | undefined {
    const {pickingRadius} = props;
    const getScreenDist = (handle: EditHandleFeature) => {
      const [px, py] = wmViewport.project(handle.geometry.coordinates);
      return distance2d(cursorCoords[0], cursorCoords[1], px, py);
    };
    const result = this._getSnapTargetHandles(props).reduce(
      (closest, handle) => {
        const dist = getScreenDist(handle);
        return dist <= pickingRadius && dist < closest.dist ? {handle, dist} : closest;
      },
      {handle: undefined, dist: Infinity}
    );
    return result.handle;
  }

  _getSnapTargetHandles(props: ModeProps<SimpleFeatureCollection>): EditHandleFeature[] {
    const handles: EditHandleFeature[] = [];
    const features = this._getSnapTargets(props);

    for (let i = 0; i < features.length; i++) {
      // Filter out the currently selected feature(s) if _handler is a mode which renders snap sources on them
      const isCurrentIndexFeatureNotSelected =
        !this._handler.displaySnapSourcesInSnappingMode() || !props.selectedIndexes.includes(i);

      if (isCurrentIndexFeatureNotSelected) {
        const {geometry} = features[i];
        handles.push(...getEditHandlesForGeometry(geometry, i, 'snap-target'));
      }
    }
    return handles;
  }

  // If no snap handle has been picked, only display the edit handles of the
  // selected feature. If a snap handle has been picked, display said snap handle
  // along with all snappable points on all non-selected features.
  getGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    const {modeConfig, lastPointerMoveEvent} = props;
    const {enableSnapping} = modeConfig || {};

    const guides: GuideFeatureCollection = {
      type: 'FeatureCollection',
      features: [...this._handler.getGuides(props).features]
    };

    if (!enableSnapping) {
      return guides;
    }

    const snapSourceHandle: EditHandleFeature | null | undefined =
      lastPointerMoveEvent && this._getPickedSnapSource(lastPointerMoveEvent.pointerDownPicks);

    if (snapSourceHandle) {
      // They started dragging a handle
      // So render the picked handle (in its updated location) and all possible snap targets
      guides.features.push(...this._getDraggingSnapGuides(props, snapSourceHandle));
    } else {
      guides.features.push(...this._getSnapGuides(props));
    }

    return guides;
  }

  _getDraggingSnapGuides(
    props: ModeProps<SimpleFeatureCollection>,
    snapSourceHandle: EditHandleFeature
  ): EditHandleFeature[] {
    return [
      ...this._getSnapTargetHandles(props),
      this._getUpdatedSnapSourceHandle(snapSourceHandle, props.data)
    ];
  }

  // No active drag: snap-source handles for selected features + closest snap-target near cursor
  _getSnapGuides(props: ModeProps<SimpleFeatureCollection>): EditHandleFeature[] {
    const guides: EditHandleFeature[] = [];

    if (this._handler.displaySnapSourcesInSnappingMode()) {
      for (const index of props.selectedIndexes) {
        if (index < props.data.features.length) {
          guides.push(
            ...getEditHandlesForGeometry(props.data.features[index].geometry, index, 'snap-source')
          );
        }
      }
    } else {
      const viewport = props.modeConfig?.viewport;
      const lastPointerMoveEvent = props.lastPointerMoveEvent;
      if (viewport && props.pickingRadius !== undefined && lastPointerMoveEvent) {
        const wmViewport = toWebMercatorViewport(viewport);
        const cursorCoords = wmViewport.project(lastPointerMoveEvent.mapCoords) as [number, number];
        const closest = this._getClosestSnapTargetHandle(props, cursorCoords, wmViewport);
        if (closest) {
          guides.push(closest);
        }
      }
    }

    return guides;
  }

  _getSnapAwareEvent<T extends MovementTypeEvent>(
    event: T,
    props: ModeProps<FeatureCollection>
  ): T {
    const snapSource = this._getPickedSnapSource(props.lastPointerMoveEvent.pointerDownPicks);
    const snapTarget = this._getPickedSnapTarget(event.picks);

    return snapSource && snapTarget
      ? this._getSnappedMouseEvent(event, snapSource, snapTarget)
      : event;
  }

  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const {enableSnapping} = props.modeConfig || {};
    if (enableSnapping) {
      const snapTarget = this._getPickedSnapTarget(event.picks);
      if (snapTarget) {
        this._handler.handleClick({...event, mapCoords: snapTarget.geometry.coordinates}, props);
        return;
      }
    }
    this._handler.handleClick(event, props);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleStartDragging(event, props);
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleStopDragging(this._getSnapAwareEvent(event, props), props);
  }

  handleDragging(event: DraggingEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleDragging(this._getSnapAwareEvent(event, props), props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handlePointerMove(this._getSnapAwareEvent(event, props), props);
  }
}
