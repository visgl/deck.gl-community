// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SimpleFeatureCollection} from '../utils/geojson-types';
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
import {SourceSnappingStrategy} from './snapping/source-snapping-strategy';

type SnappableGeoJsonEditMode = GeoJsonEditMode & Partial<SnappableEditMode>;

/** Wraps a GeoJSON edit mode with mode-specific snapping policies. */
export class SnappableMode extends GeoJsonEditMode {
  _wrappedMode!: SnappableGeoJsonEditMode;
  _strategy: SnappingStrategy | undefined;

  /**
   * Wraps a mode. Existing custom modes use source-handle snapping by default;
   * a strategy hook returning undefined explicitly disables snapping.
   */
  constructor(handler: SnappableGeoJsonEditMode) {
    super();
    this._handler = handler;
  }

  /** @deprecated Use _wrappedMode to inspect the wrapped mode. */
  get _handler(): SnappableGeoJsonEditMode {
    return this._wrappedMode;
  }

  /** @deprecated Retained for compatibility with existing wrapper consumers. */
  set _handler(handler: SnappableGeoJsonEditMode) {
    this._wrappedMode = handler;
    this._strategy = handler.getSnappingStrategy
      ? handler.getSnappingStrategy()
      : new SourceSnappingStrategy();
  }

  handleClick(event: ClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapClickEvent(props, event) : event;
    this._wrappedMode.handleClick(snappedEvent, props);
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    this._wrappedMode.handleDoubleClick(event, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handlePointerMove(
      snappedEvent,
      snappedEvent === event ? props : {...props, lastPointerMoveEvent: snappedEvent}
    );
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const snappedEvent =
      props.modeConfig?.enableSnapping && this._strategy
        ? this._strategy.snapMovementEvent(props, event)
        : event;
    this._wrappedMode.handleStartDragging(snappedEvent, props);
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleStopDragging(snappedEvent, props);
  }

  handleDragging(event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleDragging(snappedEvent, props);
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<SimpleFeatureCollection>) {
    this._wrappedMode.handleKeyUp(event, this._getSnappedProps(props));
  }

  getGuides(props: ModeProps<SimpleFeatureCollection>): GuideFeatureCollection {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const handlerGuides = this._wrappedMode.getGuides(this._getSnappedProps(props));

    if (!enableSnapping || !this._strategy) {
      return handlerGuides;
    }

    const snapGuides = this._strategy.getSnapGuides(props);
    return {
      type: 'FeatureCollection',
      features: [...handlerGuides.features, ...snapGuides.features]
    };
  }

  private _getSnappedProps(
    props: ModeProps<SimpleFeatureCollection>
  ): ModeProps<SimpleFeatureCollection> {
    if (!props.modeConfig?.enableSnapping || !this._strategy || !props.lastPointerMoveEvent)
      return props;
    return {
      ...props,
      lastPointerMoveEvent: this._strategy.snapMovementEvent(props, props.lastPointerMoveEvent)
    };
  }

  getTooltips(props: ModeProps<SimpleFeatureCollection>) {
    return this._wrappedMode.getTooltips(this._getSnappedProps(props));
  }
}
