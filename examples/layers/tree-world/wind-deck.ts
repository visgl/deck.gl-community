// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Deck, type DeckProps, type MapView} from '@deck.gl/core';
import {Timeline} from '@luma.gl/engine';

/** Private tree demos use a layer animation clock independent of camera transitions. */
export class TreeWindDeck extends Deck<MapView> {
  private windTimeline?: Timeline;
  private hostTimeline?: Timeline;

  constructor(props: DeckProps<MapView>, getSharedWindTime?: () => number) {
    super({
      ...props,
      onBeforeRender: context => {
        const timeline = this.getWindTimeline();
        if (timeline?.playing && getSharedWindTime) timeline.setTime(getSharedWindTime() * 1000);
        else timeline?.update(this.hostTimeline!.getTime());
        props.onBeforeRender?.(context);
      }
    });
  }

  /** Current automatic shader phase in seconds. */
  getWindTime(): number {
    return (this.getWindTimeline()?.getTime() ?? 0) / 1000;
  }

  /** Freeze or resume layer animation without pausing the host's view controllers. */
  setWindClockPaused(paused: boolean, time: number): void {
    const timeline = this.getWindTimeline();
    if (paused) {
      timeline?.pause();
      timeline?.setTime(time * 1000);
    } else timeline?.play();
  }

  private getWindTimeline(): Timeline | undefined {
    if (!this.layerManager) return undefined;
    if (!this.windTimeline) {
      this.hostTimeline = this.layerManager.context.timeline;
      this.windTimeline = new Timeline();
      this.windTimeline.play();
      // These private examples author no attribute transitions. Camera controllers
      // retain the original host clock; new tree children inherit this layer clock.
      this.layerManager.context.timeline = this.windTimeline;
    }
    return this.windTimeline;
  }
}
