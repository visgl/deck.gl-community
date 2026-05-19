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

type SnappableHandlerType = GeoJsonEditMode & SnappableEditMode;

export class SnappableMode extends GeoJsonEditMode {
  _handler: SnappableHandlerType;
  _strategy: SnappingStrategy | undefined;

  constructor(handler: SnappableHandlerType) {
    super();
    this._handler = handler;
    this._strategy = handler.getSnappingStrategy();
  }

  handleClick(event: ClickEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapClickEvent(props, event) : event;
    this._handler.handleClick(snappedEvent, props);
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleDoubleClick(event, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._handler.handlePointerMove(snappedEvent, props);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleStartDragging(event, props);
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._handler.handleStopDragging(snappedEvent, props);
  }

  handleDragging(event: DraggingEvent, props: ModeProps<FeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._handler.handleDragging(snappedEvent, props);
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<FeatureCollection>) {
    this._handler.handleKeyUp(event, props);
  }

  getGuides(props: ModeProps<FeatureCollection>): GuideFeatureCollection {
    const handlerGuides = this._handler.getGuides(props);
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
    return this._handler.getTooltips(props);
  }
}
