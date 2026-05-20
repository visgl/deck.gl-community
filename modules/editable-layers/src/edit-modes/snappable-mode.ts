// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {FeatureCollection} from '../utils/geojson-types';
import {
  ClickEvent,
  DoubleClickEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  ModeProps,
  GuideFeatureCollection
} from './types';
import {GeoJsonEditMode} from './geojson-edit-mode';
import {SnappableEditMode} from './snappable-edit-mode';
import {SnappingStrategy} from './snapping/snapping-strategy';

type SnappableGeoJsonEditMode = GeoJsonEditMode & SnappableEditMode;

export class SnappableMode extends GeoJsonEditMode {
  _wrappedMode: SnappableGeoJsonEditMode;
  _strategy: SnappingStrategy | undefined;

  constructor(handler: SnappableGeoJsonEditMode) {
    super();
    this._wrappedMode = handler;
    this._strategy = handler.getSnappingStrategy();
  }

  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapClickEvent(props, event) : event;
    this._wrappedMode.handleClick(snappedEvent, props);
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<FeatureCollection>) {
    this._wrappedMode.handleDoubleClick(event, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handlePointerMove(snappedEvent, props);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<FeatureCollection>) {
    this._wrappedMode.handleStartDragging(event, props);
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleStopDragging(snappedEvent, props);
  }

  handleDragging(event: DraggingEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleDragging(snappedEvent, props);
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
    this._wrappedMode.handleKeyUp(event, props);
  }

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const handlerGuides = this._wrappedMode.getGuides(props);
    const enableSnapping = props.modeConfig?.enableSnapping;

    if (!enableSnapping || !this._strategy) {
      return handlerGuides;
    }

    const snapGuides = this._strategy.getSnapGuides(props);
    return {
      type: 'FeatureCollection',
      features: [...handlerGuides.features, ...snapGuides.features]
    };
  }

  getTooltips(props: ModeProps<FeatureCollection>) {
    return this._wrappedMode.getTooltips(props);
  }
}
