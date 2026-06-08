import {CompositeLayer} from '@deck.gl/core';

import {
  AnimationFramesGroup,
  AnimationState,
  resolveAnimationFrames,
  resolveProps
} from './animation';

import type {CompositeLayerProps, Layer} from '@deck.gl/core';

export type AnimationLayerProps<LayerT extends Layer> = CompositeLayerProps &
  _AnimationLayerProps<LayerT>;

type _AnimationLayerProps<LayerT extends Layer> = {
  /** Base instance of the animated layer */
  layer: LayerT;
  /** Frames of changing layer props */
  frames: AnimationFramesGroup<LayerT>;
  repeat?: number;
  repeatType?: 'loop' | 'reverse';
  repeatDelay?: number;
};

/** A composite layer that animates its child layer with composable frames */
export class AnimationLayer<LayerT extends Layer> extends CompositeLayer<
  _AnimationLayerProps<LayerT>
> {
  static override layerName = 'AnimationLayer';

  static override componentName = 'AnimationLayer';

  declare state: {
    layer?: LayerT;
    animationState?: AnimationState<LayerT>;
  };

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
