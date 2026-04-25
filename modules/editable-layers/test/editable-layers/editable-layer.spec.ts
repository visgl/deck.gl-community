// test/editable-layers/event-handlers.spec.ts
import type {PickingInfo} from '@deck.gl/core';
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
  object: {id: 2},
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
    layerManager: {
      getLayers: vi.fn(() => [])
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

const assertBasePointerEvent = (event: BasePointerEvent, mockSrcEvent: any) => {
  expect(event.screenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(event.mapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(event.sourceEvent).toBe(mockSrcEvent.srcEvent);
  expect(Array.isArray(event.picks)).toBe(true);
  expect(event.picks[0]).toMatchObject({index: 0, object: {id: 1}});
  return event;
};

const assertPointerDownEvent = (
  event: StartDraggingEvent | DraggingEvent | StopDraggingEvent | PointerMoveEvent
) => {
  expect(event.pointerDownScreenCoords).toEqual(MOCK_POINTER_DOWN_STATE_SCREEN_COORDS);
  expect(event.pointerDownMapCoords).toEqual(MOCK_POINTER_DOWN_STATE_MAP_COORDS);
  expect(Array.isArray(event.pointerDownPicks)).toBe(true);
  expect(event.pointerDownPicks[0]).toMatchObject({index: 0, object: {id: 2}});
};

const expectBasePointerEvent = <E extends BasePointerEvent>(
  callback: any,
  mockSrcEvent: any
): E => {
  expect(callback).toHaveBeenCalledOnce();

  return assertBasePointerEvent(callback.mock.calls[0][0], mockSrcEvent) as E;
};

test('toBasePointerEvent uses offsetCenter, not clientX/Y', () => {
  const event = makeMockGestureEvent('click');
  const result = layer.toBasePointerEvent(event);

  assertBasePointerEvent(result, event);
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
  const onLayerClickSpy = vi.spyOn(layer, 'onLayerClick');

  const mockEvent = makeMockGestureEvent('click');
  layer._onclick(mockEvent);

  expectBasePointerEvent(onLayerClickSpy, mockEvent);
});

test('_ondblclick calls onLayerDoubleClick with correct event', () => {
  const onLayerDoubleClickSpy = vi.spyOn(layer, 'onLayerDoubleClick');

  const mockEvent = makeMockGestureEvent('dblclick');
  layer._ondblclick(mockEvent);

  expectBasePointerEvent(onLayerDoubleClickSpy, mockEvent);
});

test('_onpanstart calls onStartDragging with correct event', () => {
  const onStartDraggingSpy = vi.spyOn(layer, 'onStartDragging');

  const mockEvent = makeMockGestureEvent('panstart');
  layer._onpanstart(mockEvent);

  const event: StartDraggingEvent = expectBasePointerEvent(onStartDraggingSpy, mockEvent);
  expect(event.pointerDownScreenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(event.pointerDownMapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(event.pointerDownPicks)).toBe(true);
  expect(event.pointerDownPicks[0]).toMatchObject({index: 0, object: {id: 1}});

  expect(typeof event.cancelPan).toBe('function');
  event.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});

test('_onpanstart writes pointerDown coords and picks into state', () => {
  const mockEvent = makeMockGestureEvent('panstart');
  layer._onpanstart(mockEvent);

  const state = layer.state._editableLayerState;
  expect(state.pointerDownScreenCoords).toEqual(MOCK_EVENT_SCREEN_COORDS);
  expect(state.pointerDownMapCoords).toEqual(MOCK_EVENT_MAP_COORDS);
  expect(Array.isArray(state.pointerDownPicks)).toBe(true);
  expect(state.pointerDownPicks[0]).toMatchObject({index: 0, object: {id: 1}});
});

test('_onpanmove calls onDragging with correct event', () => {
  const onDraggingSpy = vi.spyOn(layer, 'onDragging');
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('panmove');
  layer._onpanmove(mockEvent);

  const event: DraggingEvent = expectBasePointerEvent(onDraggingSpy, mockEvent);
  assertPointerDownEvent(event);

  expect(typeof event.cancelPan).toBe('function');
  event.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});

test('_onpanend calls onStopDragging with correct event', () => {
  const stopDragSpy = vi.spyOn(layer, 'onStopDragging');
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('panend');
  layer._onpanend(mockEvent);

  const event: StopDraggingEvent = expectBasePointerEvent(stopDragSpy, mockEvent);
  assertPointerDownEvent(event);
});

test('_onpanend resets pointerDown state to null', () => {
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};
  layer._onpanend(makeMockGestureEvent('panend'));

  const s = layer.state._editableLayerState;
  expect(s.pointerDownScreenCoords).toBeNull();
  expect(s.pointerDownMapCoords).toBeNull();
  expect(s.pointerDownPicks).toBeNull();
});

test('_onpointermove calls onPointerMove with correct event', () => {
  const pointerMoveSpy = vi.spyOn(layer, 'onPointerMove');
  layer.state._editableLayerState = {...MOCK_POINTER_DOWN_STATE};

  const mockEvent = makeMockGestureEvent('pointermove');
  layer._onpointermove(mockEvent);

  const event: PointerMoveEvent = expectBasePointerEvent(pointerMoveSpy, mockEvent);
  assertPointerDownEvent(event);

  expect(typeof event.cancelPan).toBe('function');
  event.cancelPan();
  expect(mockEvent.stopImmediatePropagation).toHaveBeenCalledOnce();
});
