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
  DoubleClickEvent,
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
  getPickedSnapTargetEditHandle,
  getEditHandlesForGeometry,
  toWebMercatorViewport,
  distance2d,
  getPickedEditHandle
} from './utils';
import {GeoJsonEditMode} from './geojson-edit-mode';

type MovementTypeEvent = PointerMoveEvent | StartDraggingEvent | StopDraggingEvent | DraggingEvent;

export class SnappableMode extends GeoJsonEditMode {
  _handler: GeoJsonEditMode;

  constructor(handler: GeoJsonEditMode) {
    super();
    this._handler = handler;
  }

  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const {enableSnapping} = props.modeConfig || {};
    if (enableSnapping && this._handler.getSnappingBehavior() !== 'FromSnapSources') {
      const snapTarget = this._getPickedSnapTarget(event.picks);
      if (snapTarget) {
        return this._handler.handleClick(
          {
            ...event,
            mapCoords: snapTarget.geometry.coordinates,
            picks: event.picks.filter(p => p.object?.properties?.editHandleType !== 'snap-target')
          },
          props
        );
      }
    }
    this._handler.handleClick(event, props);
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleDoubleClick(event, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handlePointerMove(this._getSnapAwareEvent(event, props), props);
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

  handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleKeyUp(event, props);
  }

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
      guides.features.push(...this._getDraggingSnapGuides(props, snapSourceHandle));
    } else {
      guides.features.push(...this._getSnapGuides(props));
    }

    return guides;
  }

  getTooltips(props: ModeProps<FeatureCollection>) {
    return this._handler.getTooltips(props);
  }

  _getSnapAwareEvent<T extends MovementTypeEvent>(
    event: T,
    props: ModeProps<FeatureCollection>
  ): T {
    const snapSource = this._getPickedSnapSource(props.lastPointerMoveEvent.pointerDownPicks);
    const {enableSnapping} = props.modeConfig || {};

    if (
      enableSnapping &&
      (snapSource || this._handler.getSnappingBehavior() !== 'FromSnapSources')
    ) {
      const snapTarget = this._getPickedSnapTarget(event.picks);
      if (snapTarget) {
        return this._getSnappedMouseEvent(event, snapSource, snapTarget);
      }
    }

    return event;
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
    return getPickedSnapTargetEditHandle(picks);
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

  _getClosestPickedSnapTargetHandle(
    screenCoords: [number, number],
    props: ModeProps<SimpleFeatureCollection>
  ): EditHandleFeature | undefined {
    const {viewport} = props.modeConfig || {};
    if (!viewport || props.pickingRadius === undefined) {
      return undefined;
    }

    const wmViewport = toWebMercatorViewport(viewport);
    const [cx, cy] = screenCoords;
    const {pickingRadius} = props;

    const result = this._getSnapTargetHandles(props).reduce(
      (closest, handle) => {
        const [px, py] = wmViewport.project(handle.geometry.coordinates);
        const dist = distance2d(cx, cy, px, py);
        return dist <= pickingRadius && dist < closest.dist ? {handle, dist} : closest;
      },
      {handle: undefined, dist: Infinity}
    );
    return result.handle;
  }

  _getSnapTargetHandles(props: ModeProps<SimpleFeatureCollection>): EditHandleFeature[] {
    const handles: EditHandleFeature[] = [];
    const features = this._getSnapTargets(props);
    const showSnappingSources = this._handler.getSnappingBehavior() === 'FromSnapSources';
    const editHandle = getPickedEditHandle(props.lastPointerMoveEvent.pointerDownPicks);
    const editHandleFeatureIndex = editHandle?.properties.featureIndex;

    for (let i = 0; i < features.length; i++) {
      if (
        (showSnappingSources && !props.selectedIndexes.includes(i)) ||
        (!showSnappingSources && i !== editHandleFeatureIndex)
      ) {
        handles.push(...getEditHandlesForGeometry(features[i].geometry, i, 'snap-target'));
      }
    }
    return handles;
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

  _getSnapGuides(props: ModeProps<SimpleFeatureCollection>): EditHandleFeature[] {
    const guides: EditHandleFeature[] = [];

    if (
      this._handler.getSnappingBehavior() === 'WhenDragging' &&
      !getPickedEditHandle(props.lastPointerMoveEvent.pointerDownPicks)
    ) {
      return [];
    }

    if (this._handler.getSnappingBehavior() === 'FromSnapSources') {
      for (const index of props.selectedIndexes) {
        if (index < props.data.features.length) {
          guides.push(
            ...getEditHandlesForGeometry(props.data.features[index].geometry, index, 'snap-source')
          );
        }
      }
    } else {
      const {lastPointerMoveEvent} = props;
      if (lastPointerMoveEvent) {
        const closest = this._getClosestPickedSnapTargetHandle(
          // Note: we can't use the mapCoords because they might already have been updated to snap to the nearest target rather than current position
          lastPointerMoveEvent.screenCoords,
          props
        );
        if (closest) {
          guides.push(closest);
        }
      }
    }

    return guides;
  }
}
