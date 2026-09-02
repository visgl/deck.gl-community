import {describe, expect, it, vi} from 'vitest';

import {TimeMeasureWidget} from './time-measure-widget';

import type {PickingInfo, Viewport} from '@deck.gl/core';
import type {EventManager} from 'mjolnir.js';

type EventManagerHandler = (event: ReturnType<typeof createGestureEvent>) => void;
type EventHandlerOptions = {priority?: number; srcElement?: 'root' | HTMLElement};

/** Minimal event manager used to exercise widget-owned gesture listeners. */
class TestEventManager {
  handlers = new Map<string, EventManagerHandler>();
  handlerOptions = new Map<string, EventHandlerOptions>();

  /** Creates an event manager with the supplied root element. */
  constructor(private readonly element: HTMLElement) {}

  /** Returns the root element used by gesture registration. */
  getElement(): HTMLElement {
    return this.element;
  }

  /** Registers one event handler and its options. */
  on(eventName: string, handler: EventManagerHandler, options: EventHandlerOptions = {}) {
    this.handlers.set(eventName, handler);
    this.handlerOptions.set(eventName, options);
  }

  /** Unregisters one event handler. */
  off(eventName: string, handler: EventManagerHandler) {
    if (this.handlers.get(eventName) === handler) {
      this.handlers.delete(eventName);
      this.handlerOptions.delete(eventName);
    }
  }
}

/** Returns a linear viewport whose x coordinate is the measured time. */
function createViewport(): Viewport {
  return {
    id: 'main',
    x: 0,
    project: ([x]: number[]) => [x, 0],
    unproject: ([x]: number[]) => [x, 0],
    containsPixel: ({x, y}: {x: number; y: number}) => x >= 0 && x <= 1000 && y >= 0 && y <= 1000
  } as unknown as Viewport;
}

/** Returns picking data at one time coordinate. */
function createPickingInfo(timeMs: number): PickingInfo {
  return {
    coordinate: [timeMs, 0, 0],
    viewport: createViewport()
  } as PickingInfo;
}

/** Returns a minimal pointer gesture for widget interaction tests. */
function createGestureEvent(
  pointerState: Partial<
    Pick<MouseEvent, 'altKey' | 'button' | 'buttons' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
  > = {},
  position = {x: 0, y: 0}
) {
  return {
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
    stopPropagation: vi.fn(),
    srcEvent: {
      button: 0,
      buttons: 0,
      shiftKey: false,
      ...pointerState
    },
    center: position,
    offsetCenter: position
  };
}

/** Creates a mounted widget with observable callbacks and a fake deck root. */
function createWidget() {
  const canvas = document.createElement('canvas');
  const eventRoot = document.createElement('div');
  eventRoot.appendChild(canvas);
  const eventManager = new TestEventManager(eventRoot);
  const viewport = createViewport();
  const onActivate = vi.fn();
  const onDeactivate = vi.fn();
  const onRangeChange = vi.fn();
  const onSelectionChange = vi.fn();
  const widget = new TimeMeasureWidget({
    eventViewId: 'main',
    projectionViewId: 'main',
    onActivate,
    onDeactivate,
    onRangeChange,
    onSelectionChange
  });
  const deck = {
    eventManager,
    getCanvas: () => canvas,
    getViewports: () => [viewport],
    isInitialized: true
  } as unknown as {eventManager: EventManager};
  (widget as unknown as {deck: typeof deck}).deck = deck;
  const root = widget.onAdd({deck: deck as never, viewId: null}) as HTMLDivElement;
  document.body.appendChild(root);

  return {
    eventManager,
    onActivate,
    onDeactivate,
    onRangeChange,
    onSelectionChange,
    widget,
    cleanup() {
      widget.onRemove();
      root.remove();
    }
  };
}

/** Selects and commits one initial time range. */
function selectRange(widget: TimeMeasureWidget, startTimeMs: number, endTimeMs: number) {
  TimeMeasureWidget.performAction({widget});
  widget.onClick(createPickingInfo(startTimeMs), createGestureEvent() as never);
  widget.onClick(createPickingInfo(endTimeMs), createGestureEvent() as never);
}

describe('TimeMeasureWidget boundary editing', () => {
  it('reports nearby completed boundaries without changing activation callbacks', () => {
    const {onActivate, onDeactivate, onSelectionChange, widget, cleanup} = createWidget();
    selectRange(widget, 100, 250);
    onActivate.mockClear();
    onDeactivate.mockClear();
    onSelectionChange.mockClear();

    widget.onHover(createPickingInfo(102), createGestureEvent() as never);

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({hoveredBoundary: 'start', adjustingBoundary: null})
    );
    expect(onActivate).not.toHaveBeenCalled();
    expect(onDeactivate).not.toHaveBeenCalled();

    widget.onHover(createPickingInfo(180), createGestureEvent() as never);

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({hoveredBoundary: null, adjustingBoundary: null})
    );

    cleanup();
  });

  it('remeasures either completed boundary and commits only after drag end', () => {
    const {onRangeChange, widget, cleanup} = createWidget();
    selectRange(widget, 100, 250);
    onRangeChange.mockClear();

    widget.onDragStart(createPickingInfo(100), createGestureEvent() as never);
    widget.onDrag(createPickingInfo(125), createGestureEvent({}, {x: 125, y: 0}) as never);

    expect(onRangeChange).not.toHaveBeenCalled();

    widget.onDragEnd(createPickingInfo(125), createGestureEvent({}, {x: 125, y: 0}) as never);

    expect(onRangeChange).toHaveBeenLastCalledWith({startTimeMs: 125, endTimeMs: 250});

    widget.onDragStart(createPickingInfo(250), createGestureEvent() as never);
    widget.onDragEnd(createPickingInfo(300), createGestureEvent({}, {x: 300, y: 0}) as never);

    expect(onRangeChange).toHaveBeenLastCalledWith({startTimeMs: 125, endTimeMs: 300});

    cleanup();
  });

  it('uses current gesture positions when picking data is stale', () => {
    const {onRangeChange, onSelectionChange, widget, cleanup} = createWidget();
    selectRange(widget, 100, 250);
    const pointerDownPickingInfo = createPickingInfo(100);

    widget.onDragStart(pointerDownPickingInfo, createGestureEvent() as never);
    widget.onDrag(pointerDownPickingInfo, createGestureEvent({}, {x: 125, y: 0}) as never);

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({adjustingBoundary: 'start', cursorTimeMs: 125})
    );

    widget.onDragEnd(pointerDownPickingInfo, createGestureEvent({}, {x: 160, y: 0}) as never);

    expect(onRangeChange).toHaveBeenLastCalledWith({startTimeMs: 160, endTimeMs: 250});

    cleanup();
  });

  it('restores the completed range when boundary adjustment is cancelled', () => {
    const {eventManager, onRangeChange, onSelectionChange, widget, cleanup} = createWidget();
    selectRange(widget, 100, 250);
    onRangeChange.mockClear();

    widget.onDragStart(createPickingInfo(250), createGestureEvent() as never);
    widget.onDrag(createPickingInfo(300), createGestureEvent({}, {x: 300, y: 0}) as never);
    eventManager.handlers.get('keydown')?.({
      ...createGestureEvent(),
      srcEvent: {key: 'Escape'}
    } as never);

    expect(onRangeChange).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        phase: 'selected',
        range: {startTimeMs: 100, endTimeMs: 250},
        adjustingBoundary: null
      })
    );

    cleanup();
  });

  it('intercepts primary boundary pans and preserves modified or alternate-button pans', () => {
    const {eventManager, onSelectionChange, widget, cleanup} = createWidget();
    selectRange(widget, 100, 250);
    onSelectionChange.mockClear();

    const leftPanStart = createGestureEvent({}, {x: 100, y: 100});
    eventManager.handlers.get('panstart')?.(leftPanStart);

    expect(eventManager.handlerOptions.get('panstart')?.priority).toBeGreaterThan(0);
    expect(leftPanStart.preventDefault).toHaveBeenCalledTimes(1);
    expect(leftPanStart.stopImmediatePropagation).toHaveBeenCalledTimes(1);
    expect(leftPanStart.stopPropagation).toHaveBeenCalledTimes(1);

    widget.onDragEnd(createPickingInfo(100), createGestureEvent({}, {x: 100, y: 100}) as never);
    onSelectionChange.mockClear();

    const rightPanStart = {
      ...createGestureEvent({button: 2}, {x: 100, y: 100}),
      rightButton: true
    };
    eventManager.handlers.get('panstart')?.(rightPanStart);

    expect(rightPanStart.preventDefault).not.toHaveBeenCalled();
    expect(rightPanStart.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();

    for (const pointerState of [
      {button: 1, buttons: 4},
      {altKey: true},
      {ctrlKey: true},
      {metaKey: true}
    ]) {
      const panStart = createGestureEvent(pointerState, {x: 100, y: 100});
      eventManager.handlers.get('panstart')?.(panStart);

      expect(panStart.preventDefault).not.toHaveBeenCalled();
      expect(panStart.stopImmediatePropagation).not.toHaveBeenCalled();

      widget.onDragStart(createPickingInfo(100), panStart as never);

      expect(onSelectionChange).not.toHaveBeenCalled();
    }

    const shiftPanStart = createGestureEvent({shiftKey: true}, {x: 100, y: 100});
    eventManager.handlers.get('panstart')?.(shiftPanStart);

    expect(shiftPanStart.preventDefault).not.toHaveBeenCalled();
    expect(shiftPanStart.stopImmediatePropagation).not.toHaveBeenCalled();

    widget.onDragStart(createPickingInfo(100), shiftPanStart as never);

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({phase: 'selecting-end', adjustingBoundary: null, range: null})
    );

    cleanup();
  });
});
