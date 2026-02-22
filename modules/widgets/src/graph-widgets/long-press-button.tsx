// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Component, type ComponentChildren} from 'preact';

const REPEAT_DELAY_MS = 300;
const REPEAT_INTERVAL_MS = 100;

export type LongPressButtonProps = {
  onClick: () => void;
  children: ComponentChildren;
};

export class LongPressButton extends Component<LongPressButtonProps> {
  buttonPressTimer: ReturnType<typeof setTimeout> | null = null;
  usingPointerEvents = false;

  private stopEvent(event: Event) {
    event.stopPropagation();
    if (typeof (event as any).stopImmediatePropagation === 'function') {
      (event as any).stopImmediatePropagation();
    }
    if (typeof (event as any).preventDefault === 'function') {
      (event as any).preventDefault();
    }
  }

  private repeat = () => {
    if (this.buttonPressTimer) {
      this.props.onClick();
      this.buttonPressTimer = setTimeout(this.repeat, REPEAT_INTERVAL_MS);
    }
  };

  private startPress(event: Event) {
    this.stopEvent(event);
    this.props.onClick();
    this.buttonPressTimer = setTimeout(this.repeat, REPEAT_DELAY_MS);
  }

  private endPress(event?: Event) {
    if (event) {
      this.stopEvent(event);
    }
    if (this.buttonPressTimer) {
      clearTimeout(this.buttonPressTimer);
    }
    this.buttonPressTimer = null;
  }

  private handlePointerDown = (event: PointerEvent) => {
    this.usingPointerEvents = true;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
    this.startPress(event);
  };

  private handlePointerUp = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    this.endPress(event);
  };

  private handlePointerCancel = (event: PointerEvent) => {
    (event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId);
    this.endPress(event);
  };

  private handleMouseDown = (event: MouseEvent) => {
    if (this.usingPointerEvents) {
      return;
    }
    this.startPress(event);
    document.addEventListener('mouseup', this.handleMouseUp, {once: true});
  };

  private handleMouseUp = (event: MouseEvent) => {
    if (this.usingPointerEvents) {
      return;
    }
    this.endPress(event);
  };

  private handleTouchStart = (event: TouchEvent) => {
    if (this.usingPointerEvents) {
      return;
    }
    this.startPress(event);
    document.addEventListener('touchend', this.handleTouchEnd, {once: true});
    document.addEventListener('touchcancel', this.handleTouchEnd, {once: true});
  };

  private handleTouchEnd = (event: TouchEvent) => {
    if (this.usingPointerEvents) {
      return;
    }
    this.endPress(event);
  };

  render() {
    return (
      <div className="deck-widget-button">
        <div
          style={{pointerEvents: 'auto'}}
          onPointerDown={this.handlePointerDown}
          onPointerUp={this.handlePointerUp}
          onPointerCancel={this.handlePointerCancel}
          onPointerMove={(event) => this.stopEvent(event)}
          onPointerLeave={this.handlePointerCancel}
          onPointerOut={this.handlePointerCancel}
          onMouseDown={this.handleMouseDown}
          onMouseUp={this.handleMouseUp}
          onMouseMove={(event) => this.stopEvent(event)}
          onTouchStart={this.handleTouchStart}
          onTouchEnd={this.handleTouchEnd}
          onTouchMove={(event) => this.stopEvent(event)}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={(event) => this.stopEvent(event)}
          onClick={(event) => this.stopEvent(event)}
        >
          {this.props.children}
        </div>
      </div>
    );
  }
}
