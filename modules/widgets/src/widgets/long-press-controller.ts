// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/* eslint-disable @typescript-eslint/unbound-method */

const REPEAT_DELAY_MS = 300;
const REPEAT_INTERVAL_MS = 100;

/**
 * Utility that attaches pointer/mouse/touch handlers to an element and
 * invokes a callback immediately plus while the interaction is held.
 */
export class LongPressController {
  private buttonPressTimer: ReturnType<typeof setTimeout> | null = null;
  private usingPointerEvents = false;

  constructor(private element: HTMLElement, private onActivate: () => void) {
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handlePointerCancel = this.handlePointerCancel.bind(this);
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleTouchStart = this.handleTouchStart.bind(this);
    this.handleTouchEnd = this.handleTouchEnd.bind(this);
    this.handleTouchMove = this.handleTouchMove.bind(this);

    element.addEventListener('pointerdown', this.handlePointerDown);
    element.addEventListener('pointerup', this.handlePointerUp);
    element.addEventListener('pointercancel', this.handlePointerCancel);
    element.addEventListener('pointerleave', this.handlePointerCancel);
    element.addEventListener('pointerout', this.handlePointerCancel);
    element.addEventListener('pointermove', this.handlePointerMove);
    element.addEventListener('mousedown', this.handleMouseDown);
    element.addEventListener('mousemove', this.handleMouseMove);
    element.addEventListener('touchstart', this.handleTouchStart, {passive: false});
    element.addEventListener('touchend', this.handleTouchEnd, {passive: false});
    element.addEventListener('touchcancel', this.handleTouchEnd, {passive: false});
    element.addEventListener('touchmove', this.handleTouchMove, {passive: false});
    element.addEventListener('contextmenu', (event) => event.preventDefault());
    element.addEventListener('wheel', (event) => this.stopEvent(event));
    element.addEventListener('click', (event) => this.stopEvent(event));
  }

  destroy(): void {
    this.endPress();
    this.element.removeEventListener('pointerdown', this.handlePointerDown);
    this.element.removeEventListener('pointerup', this.handlePointerUp);
    this.element.removeEventListener('pointercancel', this.handlePointerCancel);
    this.element.removeEventListener('pointerleave', this.handlePointerCancel);
    this.element.removeEventListener('pointerout', this.handlePointerCancel);
    this.element.removeEventListener('pointermove', this.handlePointerMove);
    this.element.removeEventListener('mousedown', this.handleMouseDown);
    this.element.removeEventListener('mousemove', this.handleMouseMove);
    this.element.removeEventListener('touchstart', this.handleTouchStart);
    this.element.removeEventListener('touchend', this.handleTouchEnd);
    this.element.removeEventListener('touchcancel', this.handleTouchEnd);
    this.element.removeEventListener('touchmove', this.handleTouchMove);
  }

  private repeat = () => {
    if (this.buttonPressTimer) {
      this.onActivate();
      this.buttonPressTimer = setTimeout(this.repeat, REPEAT_INTERVAL_MS);
    }
  };

  private startPress(event: Event) {
    this.stopEvent(event);
    this.onActivate();
    this.buttonPressTimer = setTimeout(this.repeat, REPEAT_DELAY_MS);
  }

  private endPress(event?: Event) {
    if (event) {
      this.stopEvent(event);
    }
    if (this.buttonPressTimer) {
      clearTimeout(this.buttonPressTimer);
      this.buttonPressTimer = null;
    }
  }

  private handlePointerDown(event: PointerEvent) {
    this.usingPointerEvents = true;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.startPress(event);
  }

  private handlePointerUp(event: PointerEvent) {
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    this.endPress(event);
  }

  private handlePointerCancel(event: PointerEvent) {
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    this.endPress(event);
  }

  private handlePointerMove = (event: Event) => {
    this.stopEvent(event);
  };

  private handleMouseDown(event: MouseEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.startPress(event);
    document.addEventListener('mouseup', this.handleMouseUp, {once: true});
  }

  private handleMouseUp(event: MouseEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.endPress(event);
  }

  private handleMouseMove(event: MouseEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.stopEvent(event);
  }

  private handleTouchStart(event: TouchEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.startPress(event);
    document.addEventListener('touchend', this.handleTouchEnd, {once: true});
    document.addEventListener('touchcancel', this.handleTouchEnd, {once: true});
  }

  private handleTouchEnd(event: TouchEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.endPress(event);
  }

  private handleTouchMove(event: TouchEvent) {
    if (this.usingPointerEvents) {
      return;
    }
    this.stopEvent(event);
  }

  private stopEvent(event: Event) {
    event.stopPropagation();
    if (typeof (event as any).stopImmediatePropagation === 'function') {
      (event as any).stopImmediatePropagation();
    }
    if (typeof (event as any).preventDefault === 'function') {
      event.preventDefault();
    }
  }
}
