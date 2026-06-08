import {OrthographicController} from '@deck.gl/core';

import type {MjolnirGestureEvent, MjolnirWheelEvent} from 'mjolnir.js';

const NO_TRANSITION_PROPS = {
  transitionDuration: 0
} as const;
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const WHEEL_DELTA_PER_LINE = 40;
const WHEEL_DELTA_PER_PAGE = 800;
const DRAG_ZOOM_PIXELS_PER_OCTAVE = 180;
const DEFAULT_TRACE_DRAG_INTERACTION_MODE = 'drag-to-zoom';

/** Trackpad swipe behavior used by the trace orthographic controller. */
export type TraceDragInteractionMode = 'drag-to-zoom' | 'drag-to-pan';

type TraceOrthographicControllerProps = {
  traceDragInteractionMode?: TraceDragInteractionMode;
};

/**
 * Returns the viewport-pixel pan delta represented by a trackpad or wheel event.
 */
export function getTraceWheelPanDelta(event: WheelEvent): [x: number, y: number] {
  const scale = getWheelDeltaModeScale(event.deltaMode);
  return [event.deltaX * scale, event.deltaY * scale];
}

/**
 * Returns the X-axis zoom scale represented by a pressed vertical swipe distance.
 */
export function getTraceDragZoomScale(deltaY: number): number {
  return 2 ** (-deltaY / DRAG_ZOOM_PIXELS_PER_OCTAVE);
}

/**
 * Returns whether a wheel event should be treated as an unpressed trackpad pan.
 */
export function isTraceWheelPanEvent(event: WheelEvent): boolean {
  return event.buttons == null || event.buttons === 0;
}

/**
 * Returns a supported trace drag interaction mode, defaulting invalid values.
 */
export function getTraceDragInteractionMode(value: unknown): TraceDragInteractionMode {
  return value === 'drag-to-pan' ? 'drag-to-pan' : DEFAULT_TRACE_DRAG_INTERACTION_MODE;
}

/**
 * Orthographic controller tuned for trace navigation on trackpads.
 *
 * By default it uses deck.gl's wheel/swipe zoom and drag-pan behavior. The Perfetto-style
 * alternate mode maps unpressed trackpad swipes to X/Y panning.
 */
export class TraceOrthographicController extends OrthographicController {
  #dragZoomAnchorPos: [number, number] | null = null;

  protected override _onWheel(event: MjolnirWheelEvent): boolean {
    if (this.#getTraceDragInteractionMode() !== 'drag-to-pan') {
      return super._onWheel(event);
    }

    if (!this.scrollZoom) {
      return false;
    }

    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos, event)) {
      return false;
    }

    if (!isTraceWheelPanEvent(event.srcEvent)) {
      event.srcEvent.preventDefault();
      return false;
    }

    const [deltaX, deltaY] = getTraceWheelPanDelta(event.srcEvent);
    if (deltaX === 0 && deltaY === 0) {
      return false;
    }

    event.srcEvent.preventDefault();

    const newControllerState = this.controllerState.pan({
      pos: [pos[0] - deltaX, pos[1] - deltaY],
      startPosition: this.makeViewport(this.controllerState.getViewportProps()).unproject(pos)
    });
    this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {
      isPanning: true
    });
    this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {
      isPanning: false
    });
    return true;
  }

  protected override _onPanStart(event: MjolnirGestureEvent): boolean {
    if (this.#getTraceDragInteractionMode() !== 'drag-to-pan') {
      return super._onPanStart(event);
    }

    const pos = this.getCenter(event);
    if (!this.isPointInBounds(pos, event)) {
      return false;
    }

    this.#dragZoomAnchorPos = pos;
    const newControllerState = this.controllerState.zoomStart({pos});
    this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {isDragging: true});
    return true;
  }

  protected override _onPan(event: MjolnirGestureEvent): boolean {
    if (this.#getTraceDragInteractionMode() !== 'drag-to-pan') {
      return super._onPan(event);
    }

    if (!this.isDragging()) {
      return false;
    }
    if (!this.dragPan) {
      return false;
    }

    const scale = getTraceDragZoomScale(event.deltaY);
    const pos = this.#dragZoomAnchorPos ?? this.getCenter(event);
    const newControllerState = this.controllerState.zoom({pos, scale});
    this.updateViewport(newControllerState, NO_TRANSITION_PROPS, {
      isDragging: true,
      isZooming: true
    });
    return true;
  }

  protected override _onPanEnd(event: MjolnirGestureEvent): boolean {
    if (this.#getTraceDragInteractionMode() !== 'drag-to-pan') {
      return super._onPanEnd(event);
    }

    if (!this.isDragging()) {
      return false;
    }

    this.#dragZoomAnchorPos = null;
    const newControllerState = this.controllerState.zoomEnd();
    this.updateViewport(newControllerState, null, {
      isDragging: false,
      isZooming: false
    });
    return true;
  }

  #getTraceDragInteractionMode(): TraceDragInteractionMode {
    return getTraceDragInteractionMode(
      (this.props as typeof this.props & TraceOrthographicControllerProps).traceDragInteractionMode
    );
  }
}

function getWheelDeltaModeScale(deltaMode: number): number {
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return WHEEL_DELTA_PER_LINE;
    case DOM_DELTA_PAGE:
      return WHEEL_DELTA_PER_PAGE;
    case DOM_DELTA_PIXEL:
    default:
      return 1;
  }
}
