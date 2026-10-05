// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps} from '@deck.gl/core';
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

const MAP_INTERACTION_EVENT_TYPES = [
  'mousedown',
  'dblclick',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel'
];

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
export type EditableLayerProps<_DataType = any> = CompositeLayerProps & {
  pickingRadius?: number;
  pickingDepth?: number;
  onCancelPan?: () => void;
  /**
   * Keep primary mouse and single-touch editing gestures from bubbling into a
   * parent map. ViewMode and multi-touch navigation remain available.
   * Set to false when the application coordinates map interactions itself.
   * @default true
   */
  autoPreventMapInteractions?: boolean;
};

export abstract class EditableLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<ExtraPropsT & Required<EditableLayerProps<DataT>>> {
  static layerName = 'EditableLayer';
  static defaultProps: DefaultProps<EditableLayerProps<any>> = {autoPreventMapInteractions: true};

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
    const canvas = this.context.deck.getCanvas?.();
    if (canvas) {
      const nativeEventHandler = (event: MouseEvent) => {
        const currentLayer = (this.getCurrentLayer() || this) as EditableLayer;
        currentLayer._onNativeClick(event);
      };
      const mapInteractionEventHandler = (event: Event) => {
        const currentLayer = (this.getCurrentLayer() || this) as EditableLayer;
        currentLayer._onNativeMapInteraction(event);
      };
      Object.assign(this.state._editableLayerState, {
        canvas,
        nativeEventHandler,
        mapInteractionEventHandler,
        didDrag: false
      });
      for (const type of MAP_INTERACTION_EVENT_TYPES) {
        canvas.addEventListener(type, mapInteractionEventHandler);
      }
      for (const type of ['pointerdown', 'click', 'dblclick']) {
        canvas.addEventListener(type, nativeEventHandler);
      }
    }

    for (const eventType of EVENT_TYPES) {
      // Browser clicks fire immediately. The gesture recognizer waits 300ms
      // for double-click failure, which leaves drawn vertices behind the pointer.
      if (canvas && (eventType === 'click' || eventType === 'dblclick')) {
        continue;
      }
      eventManager.on(eventType, eventHandler, {
        // give nebula a higher priority so that it can stop propagation to deck.gl's map panning handlers
        priority: 100
      });
    }
  }

  _removeEventHandlers() {
    // @ts-expect-error accessing protected props
    const {eventManager} = this.context.deck;
    const {eventHandler, canvas, nativeEventHandler, mapInteractionEventHandler} =
      this.state._editableLayerState;
    if (canvas) {
      for (const type of ['pointerdown', 'click', 'dblclick']) {
        canvas.removeEventListener(type, nativeEventHandler);
      }
      for (const type of MAP_INTERACTION_EVENT_TYPES) {
        canvas.removeEventListener(type, mapInteractionEventHandler);
      }
    }

    for (const eventType of EVENT_TYPES) {
      if (canvas && (eventType === 'click' || eventType === 'dblclick')) {
        continue;
      }
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
    const basePointerEvent = this.toBasePointerEvent(event);
    if (!basePointerEvent) {
      return;
    }
    this.onLayerClick(basePointerEvent);
  }

  _isEditing(): boolean {
    return false;
  }

  _onNativeMapInteraction(event: Event) {
    if (
      this.props.autoPreventMapInteractions === false ||
      !this.props.visible ||
      !this._isEditing()
    ) {
      return;
    }
    if (event.type.startsWith('touch')) {
      const touchEvent = event as TouchEvent;
      const editableState = this.state._editableLayerState;
      if (event.type === 'touchstart') {
        editableState.blockMapTouchGesture = touchEvent.touches.length === 1;
      }
      const block = editableState.blockMapTouchGesture;
      if (touchEvent.touches.length === 0) {
        editableState.blockMapTouchGesture = false;
      }
      if (block) event.stopPropagation();
    } else if ((event as MouseEvent).button === 0) {
      // MapLibre/Mapbox handle these on the canvas container. Other listeners
      // on the canvas, including deck.gl's pointer recognizer, still receive them.
      event.stopPropagation();
    }
  }

  _onNativeClick(event: MouseEvent) {
    const editableState = this.state._editableLayerState;
    if (event.type === 'pointerdown') {
      editableState.didDrag = false;
      editableState.pressScreenCoords = this.getScreenCoords(event);
      return;
    }
    if (
      event.button !== 0 ||
      editableState.didDrag ||
      (event.type === 'click' && event.detail > 1)
    ) {
      return;
    }
    const screenCoords = this.getScreenCoords(event) as ScreenCoordinates;
    const mapCoords = this.getMapCoords(screenCoords);
    if (!mapCoords) return;
    const pointerEvent = {
      screenCoords,
      mapCoords,
      picks: this.getPicks(screenCoords),
      sourceEvent: event
    };
    if (event.type === 'dblclick') {
      this.onLayerDoubleClick(pointerEvent);
    } else {
      this.onLayerClick(pointerEvent);
    }
  }

  _ondblclick(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    if (!basePointerEvent) {
      return;
    }
    this.onLayerDoubleClick(basePointerEvent);
  }

  _onkeyup({srcEvent}: MjolnirKeyEvent) {
    this.onLayerKeyUp(srcEvent);
  }

  _onpanstart(event: MjolnirGestureEvent) {
    this.state._editableLayerState.didDrag = true;
    const basePointerEvent = this.toBasePointerEvent(event);
    if (!basePointerEvent) {
      return;
    }
    const screenCoords: ScreenCoordinates = this.state._editableLayerState.pressScreenCoords || [
      basePointerEvent.screenCoords[0] - (event.deltaX || 0),
      basePointerEvent.screenCoords[1] - (event.deltaY || 0)
    ];
    const mapCoords = this.getMapCoords(screenCoords);
    if (!mapCoords) return;
    const picks = this.getPicks(screenCoords);

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
    if (!basePointerEvent) {
      return;
    }
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

    if (basePointerEvent) {
      this.onStopDragging({
        ...basePointerEvent,
        pointerDownPicks,
        pointerDownScreenCoords,
        pointerDownMapCoords
      });
    }

    this.setState({
      _editableLayerState: {
        ...this.state._editableLayerState,
        pointerDownScreenCoords: null,
        pointerDownMapCoords: null,
        pointerDownPicks: null,
        pressScreenCoords: null
      }
    });
  }

  _onpointermove(event: MjolnirGestureEvent) {
    const basePointerEvent = this.toBasePointerEvent(event);
    if (!basePointerEvent) {
      return;
    }
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

  toBasePointerEvent(event: MjolnirGestureEvent): BasePointerEvent | null {
    const screenCoords: ScreenCoordinates = [event.offsetCenter.x, event.offsetCenter.y];
    const mapCoords = this.getMapCoords(screenCoords);
    if (!mapCoords) {
      return null;
    }
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
    const canvas = (this.state._editableLayerState.canvas ||
      this.context.gl.canvas) as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / canvas.offsetWidth || 1;
    const scaleY = rect.height / canvas.offsetHeight || 1;
    return [
      (pointerEvent.clientX - rect.left - canvas.clientLeft) / scaleX,
      (pointerEvent.clientY - rect.top - canvas.clientTop) / scaleY
    ];
  }

  getMapCoords(screenCoords: Position): Position | null {
    if (this.context.deck) {
      const layerIds = this.context.layerManager
        .getLayers()
        .filter(l => l.props.pickable === '3d')
        .map(l => l.id);
      if (layerIds.length > 0) {
        const pickInfo = this.context.deck.pickObject({
          x: screenCoords[0],
          y: screenCoords[1],
          layerIds,
          unproject3D: true
        });
        if (!pickInfo?.coordinate) {
          return null;
        }
        const position = pickInfo.coordinate;

        // Keep terrain-edited geometry 2D. TerrainExtension applies height at
        // render time, so editable coordinates should not carry picked terrain Z.
        return [position[0], position[1]] as Position;
      }
    }
    return this.context.viewport.unproject([screenCoords[0], screenCoords[1]]) as Position;
  }
}
