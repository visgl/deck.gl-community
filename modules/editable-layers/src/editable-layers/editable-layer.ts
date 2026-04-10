// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import {MjolnirEvent, MjolnirGestureEvent, MjolnirKeyEvent} from 'mjolnir.js';

import {
  DraggingEvent,
  ClickEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  PointerMoveEvent,
  DoubleClickEvent,
  BasePointerEvent,
  ScreenCoordinates
} from '../edit-modes/types';
import {Position} from '../utils/geojson-types';

export const EVENT_TYPES = [
  'click',
  'pointermove',
  'panstart',
  'panmove',
  'panend',
  'keyup',
  'dblclick'
];

// TODO(v9): remove generic layer
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type EditableLayerProps<DataType = any> = CompositeLayerProps & {
  pickingRadius?: number;
  pickingDepth?: number;
  onCancelPan?: () => void;
};

export abstract class EditableLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<ExtraPropsT & Required<EditableLayerProps<DataT>>> {
  static layerName = 'EditableLayer';

  state: {_editableLayerState: any} = undefined!;

  // Overridable interaction event handlers
  onLayerClick(event: ClickEvent): void {
    // default implementation - do nothing
  }
  onLayerDoubleClick(event: DoubleClickEvent): void {
    // default implementation - do nothing
  }

  onStartDragging(event: StartDraggingEvent): void {
    // default implementation - do nothing
  }

  onStopDragging(event: StopDraggingEvent): void {
    // default implementation - do nothing
  }

  onDragging(event: DraggingEvent): void {
    // default implementation - do nothing
  }

  onPointerMove(event: PointerMoveEvent): void {
    // default implementation - do nothing
  }

  onLayerKeyUp(event: KeyboardEvent): void {
    // default implementation - do nothing;
  }
  // TODO: implement onCancelDragging (e.g. drag off screen)

  initializeState() {
    this.setState({
      _editableLayerState: {
        // Picked objects at the time the pointer went down
        pointerDownPicks: null,
        // Screen coordinates where the pointer went down
        pointerDownScreenCoords: null,
        // Ground coordinates where the pointer went down
        pointerDownMapCoords: null,

        // Keep track of the mjolnir.js event handler so it can be deregistered
        eventHandler: this._forwardEventToCurrentLayer.bind(this)
      }
    });

    this._addEventHandlers();
  }

  finalizeState() {
    this._removeEventHandlers();
  }

  _addEventHandlers() {
    // @ts-expect-error accessing protected props
    const {eventManager} = this.context.deck;
    const {eventHandler} = this.state._editableLayerState;

    for (const eventType of EVENT_TYPES) {
      eventManager.on(eventType, eventHandler, {
        // give nebula a higher priority so that it can stop propagation to deck.gl's map panning handlers
        priority: 100
      });
    }
  }

  _removeEventHandlers() {
    // @ts-expect-error accessing protected props
    const {eventManager} = this.context.deck;
    const {eventHandler} = this.state._editableLayerState;

    for (const eventType of EVENT_TYPES) {
      eventManager.off(eventType, eventHandler);
    }
  }

  // A new layer instance is created on every render, so forward the event to the current layer
  // This means that the first layer instance will stick around to be the event listener, but will forward the event
  // to the latest layer instance.
  _forwardEventToCurrentLayer(event: MjolnirEvent) {
    const currentLayer = this.getCurrentLayer();

    // Use a naming convention to find the event handling function for this event type
    const func = currentLayer[`_on${event.type}`].bind(currentLayer);
    if (!func) {
      console.warn(`no handler for mjolnir.js event ${event.type}`); // eslint-disable-line
      return;
    }
    func(event);
  }

  _onclick(event: MjolnirGestureEvent) {
    this.onLayerClick(this.toBasePointerEvent(event));
  }

  _ondblclick(event: MjolnirGestureEvent) {
    this.onLayerDoubleClick(this.toBasePointerEvent(event));
  }

  _onkeyup({srcEvent}: MjolnirKeyEvent) {
    this.onLayerKeyUp(srcEvent);
  }

  _onpanstart(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    const {picks, screenCoords, mapCoords} = basePointerEvent;

    this.setState({
      _editableLayerState: {
        ...this.state._editableLayerState,
        pointerDownPicks: picks,
        pointerDownScreenCoords: screenCoords,
        pointerDownMapCoords: mapCoords
      }
    });

    this.onStartDragging({
      ...basePointerEvent,
      pointerDownPicks: picks,
      pointerDownScreenCoords: screenCoords,
      pointerDownMapCoords: mapCoords,
      cancelPan: () => {
        if (this.props.onCancelPan) {
          this.props.onCancelPan();
        }
        event.stopImmediatePropagation();
      }
    });
  }

  _onpanmove(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    const {pointerDownPicks, pointerDownScreenCoords, pointerDownMapCoords} =
      this.state._editableLayerState;

    this.onDragging({
      ...basePointerEvent,
      pointerDownPicks,
      pointerDownScreenCoords,
      pointerDownMapCoords,
      cancelPan: event.stopImmediatePropagation
      // another (hacky) approach for cancelling map panning
      // const controller = this.context.deck.viewManager.controllers[
      //   Object.keys(this.context.deck.viewManager.controllers)[0]
      // ];
      // controller._state.isDragging = false;
    });
  }

  _onpanend(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    const {pointerDownPicks, pointerDownScreenCoords, pointerDownMapCoords} =
      this.state._editableLayerState;

    this.onStopDragging({
      ...basePointerEvent,
      pointerDownPicks,
      pointerDownScreenCoords,
      pointerDownMapCoords
    });

    this.setState({
      _editableLayerState: {
        ...this.state._editableLayerState,
        pointerDownScreenCoords: null,
        pointerDownMapCoords: null,
        pointerDownPicks: null
      }
    });
  }

  _onpointermove(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    const {pointerDownPicks, pointerDownScreenCoords, pointerDownMapCoords} =
      this.state._editableLayerState;

    this.onPointerMove({
      ...basePointerEvent,
      pointerDownPicks,
      pointerDownScreenCoords,
      pointerDownMapCoords,
      cancelPan: event.stopImmediatePropagation
    });
  }

  toBasePointerEvent(event: MjolnirGestureEvent): BasePointerEvent {
    const screenCoords: ScreenCoordinates = [event.offsetCenter.x, event.offsetCenter.y];
    const mapCoords = this.getMapCoords(screenCoords);
    const picks = this.getPicks(screenCoords);
    return {
      screenCoords,
      mapCoords,
      picks,
      sourceEvent: event.srcEvent
    };
  }

  getPicks(screenCoords: ScreenCoordinates) {
    return this.context.deck.pickMultipleObjects({
      x: screenCoords[0],
      y: screenCoords[1],
      layerIds: [this.props.id],
      radius: this.props.pickingRadius,
      depth: this.props.pickingDepth
    });
  }

  getScreenCoords(pointerEvent: any): Position {
    return [
      pointerEvent.clientX -
        (this.context.gl.canvas as HTMLCanvasElement).getBoundingClientRect().left,
      pointerEvent.clientY -
        (this.context.gl.canvas as HTMLCanvasElement).getBoundingClientRect().top
    ];
  }

  getMapCoords(screenCoords: Position): Position {
    if (this.context.deck) {
      const layerIds = this.context.layerManager
        .getLayers()
        .filter((l) => l.props.pickable === '3d')
        .map((l) => l.id);
      if (layerIds.length > 0) {
        const pickInfo = this.context.deck.pickObject({
          x: screenCoords[0],
          y: screenCoords[1],
          layerIds,
          unproject3D: true
        });
        if (pickInfo?.coordinate) {
          // Return only lon/lat — discard Z so that TerrainExtension
          // can drape geometry onto the surface without double-offsetting.
          return [pickInfo.coordinate[0], pickInfo.coordinate[1]] as Position;
        }
      }
    }
    return this.context.viewport.unproject([screenCoords[0], screenCoords[1]]) as Position;
  }
}
