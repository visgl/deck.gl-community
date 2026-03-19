// test/editable-layers/event-handlers.spec.ts
import {LayerContext, PickingInfo} from '@deck.gl/core';
import {test, expect, vi, beforeEach} from 'vitest';

import type {
  BasePointerEvent,
  PointerMoveEvent,
  StartDraggingEvent,
  StopDraggingEvent,
  DraggingEvent,
  ScreenCoordinates
} from '../../src/edit-modes/types';
import {EditableLayer, EVENT_TYPES} from '../../src/editable-layers/editable-layer';
import {Position} from '../../src/utils/geojson-types';

class TestEditableLayer extends EditableLayer {
  renderLayers() {
    return null;
  }
}

const MOCK_EVENT_SCREEN_COORDS: ScreenCoordinates = [50, 100];
const MOCK_EVENT_MAP_COORDS: Position = [12.34, 56.78];
const MOCK_EVENT_PICK: PickingInfo = {
  color: new Uint8Array([255, 0, 0, 255]),
  layer: null,
  index: 0,
  picked: true,
  object: {id: 1},
  x: 50,
  y: 100,
  pixelRatio: 1
};

const MOCK_POINTER_DOWN_STATE_SCREEN_COORDS: ScreenCoordinates = [10, 20];
const MOCK_POINTER_DOWN_STATE_MAP_COORDS: Position = [98.76, 54.32];
const MOCK_POINTER_DOWN_STATE_PICK: PickingInfo = {
  color: new Uint8Array([255, 0, 0, 255]),
  layer: null,
  index: 0,
  picked: true,
  object: {id: 1},
  x: 10,
  y: 20,
  pixelRatio: 1
};

const MOCK_POINTER_DOWN_STATE = {
  pointerDownScreenCoords: MOCK_POINTER_DOWN_STATE_SCREEN_COORDS,
  pointerDownMapCoords: MOCK_POINTER_DOWN_STATE_MAP_COORDS,
  pointerDownPicks: [MOCK_POINTER_DOWN_STATE_PICK]
};

function makeMockContext() {
  return {
    deck: {
      // use a mock implementation that returns static picks for testing, instead of doing actual picking
      pickMultipleObjects: vi.fn(() => [MOCK_EVENT_PICK]),
      eventManager: {
        on: vi.fn(),
        off: vi.fn()
      }
    },
    viewport: {
      // use static map coords for testing, instead of doing actual unprojection
      unproject: (coords: [number, number]) => MOCK_EVENT_MAP_COORDS
    }
  };
}

function makeMockGestureEvent(type: string) {
  return {
    offsetCenter: {x: MOCK_EVENT_SCREEN_COORDS[0], y: MOCK_EVENT_SCREEN_COORDS[1]},
    srcEvent: {type, someData: 123},
    stopImmediatePropagation: vi.fn()
  } as any;
}

let mockContext: ReturnType<typeof makeMockContext>;
let layer: TestEditableLayer;

beforeEach(() => {
  mockContext = makeMockContext();
  layer = new TestEditableLayer();
  layer.context = mockContext as any;
  layer.state = {_editableLayerState: {}};

  layer.initializeState();
});

test('initializeState registers event handlers', () => {
  const registeredHandler = layer.state._editableLayerState.eventHandler;

  expect(mockContext.deck.eventManager.on).toHaveBeenCalledTimes(EVENT_TYPES.length);
  for (const eventType of EVENT_TYPES) {
    expect(mockContext.deck.eventManager.on).toHaveBeenCalledWith(eventType, registeredHandler, {
      priority: 100
    });
  }
});

test('finalizeState deregisters event handlers', () => {
  const registeredHandler = layer.state._editableLayerState.eventHandler;

  layer.finalizeState();

  expect(mockContext.deck.eventManager.off).toHaveBeenCalledTimes(EVENT_TYPES.length);
  for (const call of mockContext.deck.eventManager.off.mock.calls) {
    expect(call[1]).toBe(registeredHandler);
  }
});

test('_onclick calls onLayerClick with correct event', () => {
  const clickSpy = vi.fn();
  layer.onLayerClick = clickSpy;

  const mockEvent = makeMockGestureEvent('click');
  layer._onclick(mockEvent);

  expect(clickSpy).toHaveBeenCalledOnce();
  const evt: BasePointerEvent = clickSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.picks[0]).toMatchObject({index: 0, object: {id: 1}});
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
});

test('_ondblclick calls onLayerDoubleClick with correct event', () => {
  const dblClickSpy = vi.fn();
  layer.onLayerDoubleClick = dblClickSpy;

  const mockEvent = makeMockGestureEvent('dblclick');
  layer._ondblclick(mockEvent);

  expect(dblClickSpy).toHaveBeenCalledOnce();
  const evt: BasePointerEvent = dblClickSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.picks[0]).toMatchObject({index: 0, object: {id: 1}});
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
});

test('_onpanstart calls onStartDragging with correct event', () => {
  const startDragSpy = vi.fn();
  layer.onStartDragging = startDragSpy;

  const mockEvent = makeMockGestureEvent('panstart');
  layer._onpanstart(mockEvent);

  expect(startDragSpy).toHaveBeenCalledOnce();
  const evt: StartDraggingEvent = startDragSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(evt.pointerDownScreenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.pointerDownMapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.picks[0]).toMatchObject({index: 0, object: {id: 1}});
  expect(Array.isArray(evt.pointerDownPicks)).toBe(true);
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
  expect(typeof evt.cancelPan).toBe('function');
});

test('_onpanstart writes pointerDown coords and picks into state', () => {
  layer.onStartDragging = vi.fn();

  const mockEvent = makeMockGestureEvent('panstart');
  layer._onpanstart(mockEvent);

  const s = layer.state._editableLayerState;
  expect(s.pointerDownScreenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(s.pointerDownMapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(s.pointerDownPicks)).toBe(true);
});

test('_onpanstart cancelPan calls stopImmediatePropagation', () => {
  layer.onStartDragging = vi.fn();

  const mockEvent = makeMockGestureEvent('panstart');
  layer._onpanstart(mockEvent);

  const evt: StartDraggingEvent = (layer.onStartDragging as any).mock.calls[0][0];
  evt.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});

test('_onpanmove calls onDragging with correct event', () => {
  const dragSpy = vi.fn();
  layer.onDragging = dragSpy;
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('panmove');
  layer._onpanmove(mockEvent);

  expect(dragSpy).toHaveBeenCalledOnce();
  const evt: DraggingEvent = dragSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(evt.pointerDownScreenCoords).toEqual(MOCK_POINTER_DOWN_STATE_SCREEN_COORDS);
  expect(evt.pointerDownMapCoords).toEqual(MOCK_POINTER_DOWN_STATE_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
  expect(typeof evt.cancelPan).toBe('function');
});

test('_onpanmove cancelPan delegates to event.stopImmediatePropagation', () => {
  layer.onDragging = vi.fn();
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('panmove');
  layer._onpanmove(mockEvent);

  const evt: DraggingEvent = (layer.onDragging as any).mock.calls[0][0];
  evt.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});

test('_onpanend calls onStopDragging with correct event', () => {
  const stopDragSpy = vi.fn();
  layer.onStopDragging = stopDragSpy;
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('panend');
  layer._onpanend(mockEvent);

  expect(stopDragSpy).toHaveBeenCalledOnce();
  const evt: StopDraggingEvent = stopDragSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(evt.pointerDownScreenCoords).toEqual(MOCK_POINTER_DOWN_STATE_SCREEN_COORDS);
  expect(evt.pointerDownMapCoords).toEqual(MOCK_POINTER_DOWN_STATE_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
});

test('_onpanend resets pointerDown state to null', () => {
  layer.onStopDragging = vi.fn();
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  layer._onpanend(makeMockGestureEvent('panend'));

  const s = layer.state._editableLayerState;
  expect(s.pointerDownScreenCoords).toBeNull();
  expect(s.pointerDownMapCoords).toBeNull();
  expect(s.pointerDownPicks).toBeNull();
});

test('_onpointermove calls onPointerMove with correct event', () => {
  const pointerMoveSpy = vi.fn();
  layer.onPointerMove = pointerMoveSpy;
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('pointermove');
  layer._onpointermove(mockEvent);

  expect(pointerMoveSpy).toHaveBeenCalledOnce();
  const evt: PointerMoveEvent = pointerMoveSpy.mock.calls[0][0];
  expect(evt.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(evt.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(evt.pointerDownScreenCoords).toEqual(MOCK_POINTER_DOWN_STATE_SCREEN_COORDS);
  expect(evt.pointerDownMapCoords).toEqual(MOCK_POINTER_DOWN_STATE_MAP_COORDS);
  expect(Array.isArray(evt.picks)).toBe(true);
  expect(evt.picks[0]).toMatchObject({index: 0, object: {id: 1}});
  expect(evt.sourceEvent).toBe(mockEvent.srcEvent);
  expect(typeof evt.cancelPan).toBe('function');
});

test('_onpointermove cancelPan delegates to event.stopImmediatePropagation', () => {
  layer.onPointerMove = vi.fn();
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('pointermove');
  layer._onpointermove(mockEvent);

  const evt: PointerMoveEvent = (layer.onPointerMove as any).mock.calls[0][0];
  evt.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});
