// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {SimpleFeatureCollection} from '../utils/geojson-types';
import {
  BasePointerEvent,
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
    this._wrappedMode.handleClick(snappedEvent, this._getEventProps(props, snappedEvent));
  }

  handleDoubleClick(event: DoubleClickEvent, props: ModeProps<SimpleFeatureCollection>) {
    this._wrappedMode.handleDoubleClick(event, props);
  }

  handlePointerMove(event: PointerMoveEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handlePointerMove(snappedEvent, this._getEventProps(props, snappedEvent));
  }

  ownsPointerDown(event: BasePointerEvent, props: ModeProps<SimpleFeatureCollection>): boolean {
    return this._wrappedMode.ownsPointerDown(event, props);
  }

  handleStartDragging(event: StartDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const snappedEvent =
      props.modeConfig?.enableSnapping && this._strategy
        ? this._strategy.snapMovementEvent(props, event)
        : event;
    let startEvent = snappedEvent;
    if (props.modeConfig?.enableSnapping && this._strategy) {
      const pointerDownEvent = {
        ...event,
        screenCoords: event.pointerDownScreenCoords || event.screenCoords,
        mapCoords: event.pointerDownMapCoords || event.mapCoords,
        picks: event.pointerDownPicks || []
      };
      const snappedPointerDownEvent = this._strategy.snapMovementEvent(props, pointerDownEvent);
      if (snappedPointerDownEvent !== pointerDownEvent) {
        startEvent = {...snappedEvent, pointerDownMapCoords: snappedPointerDownEvent.mapCoords};
      }
    }
    this._wrappedMode.handleStartDragging(startEvent, this._getEventProps(props, startEvent));
  }

  handleStopDragging(event: StopDraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleStopDragging(snappedEvent, this._getEventProps(props, snappedEvent));
  }

  handleDragging(event: DraggingEvent, props: ModeProps<SimpleFeatureCollection>) {
    const enableSnapping = props.modeConfig?.enableSnapping;
    const snappedEvent =
      enableSnapping && this._strategy ? this._strategy.snapMovementEvent(props, event) : event;
    this._wrappedMode.handleDragging(snappedEvent, this._getEventProps(props, snappedEvent));
  }

  handleKeyUp(event: KeyboardEvent, props: ModeProps<SimpleFeatureCollection>) {
    this._wrappedMode.handleKeyUp(event, this._getKeyEventProps(props));
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

  private _getEventProps(
    props: ModeProps<SimpleFeatureCollection>,
    event: BasePointerEvent
  ): ModeProps<SimpleFeatureCollection> {
    if (!props.modeConfig?.enableSnapping || !this._strategy) return props;
    return {
      ...props,
      lastPointerMoveEvent: {...props.lastPointerMoveEvent, ...event} as PointerMoveEvent
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

  private _getKeyEventProps(
    props: ModeProps<SimpleFeatureCollection>
  ): ModeProps<SimpleFeatureCollection> {
    const snappedProps = this._getSnappedProps(props);
    const {lastPointerMoveEvent} = snappedProps;

    if (!lastPointerMoveEvent) return snappedProps;

    return {
      ...snappedProps,
      lastPointerMoveEvent: {
        ...lastPointerMoveEvent,
        // A snap target controls coordinates, but must not be interpreted as a drawing guide.
        // This matches click snapping, which removes these picks before it reaches the wrapped mode.
        picks: lastPointerMoveEvent.picks.filter(
          pick => pick.object?.properties?.editHandleType !== 'snap-target'
        )
      }
    };
  }

  getTooltips(props: ModeProps<SimpleFeatureCollection>) {
    return this._wrappedMode.getTooltips(this._getSnappedProps(props));
  }
}
