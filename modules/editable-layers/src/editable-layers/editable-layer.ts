// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-env browser */

import type {CompositeLayerProps, DefaultProps, UpdateParameters} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import type {MjolnirEvent, MjolnirGestureEvent, MjolnirKeyEvent} from 'mjolnir.js';

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
import {unprojectOnTargetPlane} from '../utils/camera-target';
import {EditableLayerInput, NATIVE_EVENT_HANDLERS} from './editable-layer-input';
export {EVENT_TYPES} from './editable-layer-input';

// TODO(v9): remove generic layer
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type EditableLayerProps<_DataType = any> = CompositeLayerProps & {
  pickingRadius?: number;
  pickingDepth?: number;
  onCancelPan?: () => void;
  /**
   * Element receiving editing input when it differs from deck.gl's own input element.
   * For an overlaid MapboxOverlay, pass the base map's public getCanvas() result.
   * Defaults to the element deck.gl listens on: its canvas, or the wrapper that also holds
   * React `<DeckGL>` children. The element must align with the rendered viewport.
   */
  eventTarget?: HTMLElement | null;
  autoPreventMapInteractions?: boolean;
};

export abstract class EditableLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends CompositeLayer<ExtraPropsT & Required<EditableLayerProps<DataT>>> {
  static layerName = 'EditableLayer';
  static defaultProps: DefaultProps<EditableLayerProps<any>> = {
    autoPreventMapInteractions: true,
    eventTarget: {type: 'object', value: null, compare: 0}
  };

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
    const canvas = this.context.deck.getCanvas?.() || null;
    // @ts-expect-error accessing protected props
    const deckEventManager = this.context.deck.eventManager;
    const input = new EditableLayerInput({
      deckEventManager,
      onEvent: this._forwardEventToCurrentLayer.bind(this)
    });
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
        input
      }
    });
    input.setTarget(this.props.eventTarget);
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (this.state._editableLayerState.input.setTarget(this.props.eventTarget)) {
      if (this.state._editableLayerState.pointerDownMapCoords) {
        // onEdit may replace layers; finish Deck's reconciliation before notifying the app.
        queueMicrotask(() => {
          const currentLayer = (this.getCurrentLayer() || this) as this;
          currentLayer._onpancancel({} as MjolnirGestureEvent);
        });
      }
      this._resetPointerDownState();
    }
  }

  finalizeState() {
    this.state._editableLayerState.input.destroy();
  }

  // The original listener forwards native and recognized events after layer replacement.
  _forwardEventToCurrentLayer(event: MjolnirEvent | Event) {
    const currentLayer = this.getCurrentLayer() || this;
    const handlerName = (
      'srcEvent' in event ? `_on${event.type}` : NATIVE_EVENT_HANDLERS[event.type]
    ) as keyof EditableLayer | undefined;
    const handler = handlerName && currentLayer[handlerName];
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

  /** Returns whether editing uses a primary mouse press; the parent map handles the others. */
  _ownsPointerDown(_event: MouseEvent): boolean {
    return true;
  }

  _onNativeMapInteraction(event: Event) {
    const preventMapInteractions =
      this.props.autoPreventMapInteractions !== false && this.props.visible && this._isEditing();
    if (event.type.startsWith('touch')) {
      const touchEvent = event as TouchEvent;
      const editableState = this.state._editableLayerState;
      if (event.type === 'touchstart') {
        editableState.mapTouchGesture = !preventMapInteractions || touchEvent.touches.length > 1;
      }
      // Preserve map gesture releases, but reserve remaining single-finger movement for editing.
      const block =
        preventMapInteractions &&
        (!editableState.mapTouchGesture ||
          (event.type === 'touchmove' && touchEvent.touches.length === 1));
      if (touchEvent.touches.length === 0) {
        editableState.mapTouchGesture = false;
      }
      if (block) event.stopPropagation();
    } else if (preventMapInteractions && (event as MouseEvent).button === 0) {
      if (event.type === 'mousedown' && !this._ownsPointerDown(event as MouseEvent)) return;
      // MapLibre/Mapbox handle these on the canvas container. Other listeners
      // on the canvas, including deck.gl's pointer recognizer, still receive them.
      event.stopPropagation();
    }
  }

  _onNativeClick(event: MouseEvent) {
    if (event.type === 'dblclick') this._onNativeMapInteraction(event);
    const editableState = this.state._editableLayerState;
    if (event.type === 'pointerdown') {
      if ((event as PointerEvent).isPrimary !== false) {
        editableState.didDrag = false;
        editableState.pressScreenCoords = this.getScreenCoords(event);
      }
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
    if (!mapCoords) {
      this._onpancancel(event);
      return;
    }
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

    if (!pointerDownScreenCoords) {
      this._resetPointerDownState();
      return;
    }

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
    // Without a terrain pick, read the pointer on the level of the point the camera orbits,
    // not on sea level, so input stays under the cursor when viewState `position` lifts it.
    return unprojectOnTargetPlane(this.context.viewport, [screenCoords[0], screenCoords[1]]);
  }
}
