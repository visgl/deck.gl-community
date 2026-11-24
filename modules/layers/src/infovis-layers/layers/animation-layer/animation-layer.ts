// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer} from '@deck.gl/core';

import {
  AnimationFramesGroup,
  AnimationState,
  resolveAnimationFrames,
  resolveProps
} from './animation';

import type {CompositeLayerProps, Layer} from '@deck.gl/core';

/** Properties supported by {@link AnimationLayer}. */
export type AnimationLayerProps<LayerT extends Layer> = CompositeLayerProps &
  _AnimationLayerProps<LayerT>;

type _AnimationLayerProps<LayerT extends Layer> = {
  /** Base child layer cloned for each animation frame. */
  layer: LayerT;
  /** Frames that describe how child layer props change over time. */
  frames: AnimationFramesGroup<LayerT>;
  /** Number of additional animation iterations after the first pass. @defaultValue 0 */
  repeat?: number;
  /** Whether repeated frames restart or alternate in reverse. @defaultValue 'loop' */
  repeatType?: 'loop' | 'reverse';
  /** Delay in milliseconds before each repeated iteration. @defaultValue 0 */
  repeatDelay?: number;
};

/** A composite layer that animates its child layer with composable frames. */
export class AnimationLayer<LayerT extends Layer> extends CompositeLayer<
  _AnimationLayerProps<LayerT>
> {
  static override layerName = 'AnimationLayer';

  override state: {
    layer?: LayerT;
    animationState?: AnimationState<LayerT>;
  } = {};

  // Hack - hijacking another flag to force updates
  override hasUniformTransition(): boolean {
    if (!this.props.visible) return false;
    const {animationState} = this.state;
    return !animationState || animationState.inProgress;
  }

  override updateState(): void {
    if (!this.props.visible) {
      // Disable animation when visible=false
      this.state.animationState = undefined;
      this.state.layer = undefined;
      return;
    }

    const time = this.context.timeline.getTime();
    const baseLayer = this.props.layer.clone({
      parameters: {
        ...this.props.layer.props.parameters,
        ...this.props.parameters
      }
    });
    let {animationState} = this.state;
    let layer = baseLayer;

    while (true) {
      if (animationState?.inProgress) {
        const nextProps = resolveProps(layer, animationState.frames, time - animationState.start);
        nextProps['id'] = `${this.id}-animation-layer`;
        layer = baseLayer.clone(nextProps);
        animationState.inProgress = time < animationState.end;
        this.setNeedsRedraw();
      }
      const nextState = resolveAnimationFrames(
        time,
        this.props as _AnimationLayerProps<LayerT>,
        animationState
      );
      if (nextState === animationState) break;
      animationState = nextState;
    }
    this.state.animationState = animationState;
    this.state.layer = layer;
  }

  override renderLayers() {
    return this.state.layer!;
  }
}
