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

const NATIVE_EVENT_HANDLERS: Record<string, keyof EditableLayer> = {
  pointerdown: '_onNativeClick',
  click: '_onNativeClick',
  dblclick: '_onNativeClick',
  mousedown: '_onNativeMapInteraction',
  touchstart: '_onNativeMapInteraction',
  touchmove: '_onNativeMapInteraction',
  touchend: '_onNativeMapInteraction',
  touchcancel: '_onNativeMapInteraction'
};

export const EVENT_TYPES = [
  'click',
  'pointermove',
  'panstart',
  'panmove',
  'panend',
  'pancancel',
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
    const canvas = this.context.deck.getCanvas?.();
    this.setState({
      _editableLayerState: {
        // Picked objects at the time the pointer went down
        pointerDownPicks: null,
        // Screen coordinates where the pointer went down
        pointerDownScreenCoords: null,
        // Ground coordinates where the pointer went down
        pointerDownMapCoords: null,
        pressScreenCoords: null,
        didDrag: false,
        canvas,
        // Native clicks bypass the recognizer's 300ms double-click failure delay.
        gestureEventTypes: canvas
          ? EVENT_TYPES.filter(type => !NATIVE_EVENT_HANDLERS[type])
          : EVENT_TYPES,

        // Retain one callback for registration, layer replacement, and cleanup.
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
    const {eventHandler, canvas, gestureEventTypes} = this.state._editableLayerState;
    for (const eventType of Object.keys(NATIVE_EVENT_HANDLERS)) {
      canvas?.addEventListener(eventType, eventHandler);
    }

    for (const eventType of gestureEventTypes) {
      eventManager.on(eventType, eventHandler, {
        // give nebula a higher priority so that it can stop propagation to deck.gl's map panning handlers
        priority: 100
      });
    }
  }

  _removeEventHandlers() {
    // @ts-expect-error accessing protected props
    const {eventManager} = this.context.deck;
    const {eventHandler, canvas, gestureEventTypes} = this.state._editableLayerState;
    for (const eventType of Object.keys(NATIVE_EVENT_HANDLERS)) {
      canvas?.removeEventListener(eventType, eventHandler);
    }

    for (const eventType of gestureEventTypes) {
      eventManager.off(eventType, eventHandler);
    }
  }

  // The original listener forwards native and recognized events after layer replacement.
  _forwardEventToCurrentLayer(event: MjolnirEvent | Event) {
    const currentLayer = this.getCurrentLayer() || this;
    const handlerName =
      'srcEvent' in event ? `_on${event.type}` : NATIVE_EVENT_HANDLERS[event.type];
    const handler = currentLayer[handlerName];
    if (!handler) {
      console.warn(`no handler for mjolnir.js event ${event.type}`); // eslint-disable-line
      return;
    }
    handler.call(currentLayer, event);
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
    if (event.type === 'dblclick') this._onNativeMapInteraction(event);
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
    const pointerEvent = this.toBasePointerEvent(event);
    if (!pointerEvent) return;
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
      this._onpancancel(event);
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
    } else {
      this._onpancancel(event);
    }

    this._resetPointerDownState();
  }

  _onpancancel(_event: MjolnirGestureEvent) {
    this._resetPointerDownState();
  }

  _resetPointerDownState() {
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

  /** Converts native or recognized pointer input into an edit-mode event. */
  toBasePointerEvent(event: MjolnirGestureEvent | MouseEvent): BasePointerEvent | null {
    const screenCoords: ScreenCoordinates =
      'offsetCenter' in event
        ? [event.offsetCenter.x, event.offsetCenter.y]
        : (this.getScreenCoords(event) as ScreenCoordinates);
    const mapCoords = this.getMapCoords(screenCoords);
    if (!mapCoords) {
      return null;
    }
    const picks = this.getPicks(screenCoords);
    return {
      screenCoords,
      mapCoords,
      picks,
      sourceEvent: 'srcEvent' in event ? event.srcEvent : event
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
