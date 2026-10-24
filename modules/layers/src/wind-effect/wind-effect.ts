// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Effect, EffectContext, Layer, PreRenderOptions} from '@deck.gl/core';
import {WIND_DEFAULT_DIRECTION, type WindModuleProps} from './wind-module';

export type WindEffectProps = {
  /** Bend as a fraction of object height for flex 1. `0` is still air. @default 0.025 */
  strength?: number;
  /**
   * Compass bearing the wind blows toward, in degrees clockwise from north, like
   * `DirectionalLight.direction`. The default, about 65.8°, is the axis wind used before this effect.
   */
  direction?: number;
  /** Fractional strength swell: strength varies within `strength × (1 ± gust)`. @default 0 */
  gust?: number;
  /** Scale of the crown flutter mode. `0` leaves a pure bend. @default 1 */
  turbulence?: number;
  /** Wind clock in seconds, or null to follow deck.gl's timeline. @default null */
  time?: number | null;
};

const DEFAULT_PROPS: Required<WindEffectProps> = {
  strength: 0.025,
  direction: WIND_DEFAULT_DIRECTION,
  gust: 0,
  turbulence: 1,
  time: null
};

const EFFECTS = new WeakMap<object, WindEffect>();

/**
 * Scene-wide wind for TreeLayer, SplatLayer and other layers that include the `wind` shader
 * module. Like `LightingEffect`, replace it by passing a new instance: deck.gl then updates the
 * existing one.
 */
export class WindEffect implements Effect {
  /** The effect registered on `deck`, if any. */
  static get(deck: unknown): WindEffect | undefined {
    return deck && typeof deck === 'object' ? EFFECTS.get(deck) : undefined;
  }

  id = 'wind-effect';
  props: Required<WindEffectProps>;
  /** Picking bends geometry exactly like the draw pass. */
  useInPicking = true;
  /** Layers that cached bounds for some wind, refreshed every frame. */
  private consumers: Layer[] = [];

  constructor(props: WindEffectProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
  }

  /** The values layer bounds depend on. Direction and time do not change a bound. */
  get boundKey(): string {
    const {strength, gust, turbulence} = this.props;
    return `${strength}|${gust}|${turbulence}`;
  }

  setup({deck}: EffectContext) {
    EFFECTS.set(deck, this);
  }

  setProps(props: WindEffectProps) {
    this.props = {...DEFAULT_PROPS, ...props};
  }

  // deck.gl does not update layers when only `effects` change. Layers that padded CPU bounds for
  // the wind record which wind in `state.windKey`; ask the stale ones to update.
  preRender({layers}: PreRenderOptions) {
    const key = this.boundKey;
    this.consumers = [];
    for (const layer of layers) {
      const windKey = (layer.state as {windKey?: string} | undefined)?.windKey;
      if (windKey === undefined) continue;
      this.consumers.push(layer);
      if (windKey !== key) layer.setNeedsUpdate();
    }
  }

  getShaderModuleProps(layer: Layer): {wind: WindModuleProps} {
    return {wind: this.getModuleProps(layer)};
  }

  /** Resolved `wind` module props for one layer's clock. */
  getModuleProps(layer: Layer): WindModuleProps {
    const {strength, direction, gust, turbulence, time} = this.props;
    return {
      strength,
      direction,
      gust,
      turbulence,
      time: time ?? layer.context.timeline.getTime() / 1000
    };
  }

  cleanup({deck}: EffectContext) {
    if (EFFECTS.get(deck) === this) EFFECTS.delete(deck);
    for (const layer of this.consumers) layer.getCurrentLayer()?.setNeedsUpdate();
    this.consumers = [];
  }
}

/**
 * The wind a layer draws with: its own strength and clock, when set, override the deck's
 * `WindEffect`. `animated` is true while the pose follows the timeline and needs every frame.
 */
export function getLayerWind(
  layer: Layer,
  strength?: number | null,
  time?: number | null
): {wind: WindModuleProps; animated: boolean} {
  const effect = WindEffect.get(layer.context?.deck);
  const resolvedStrength = strength ?? effect?.props.strength ?? 0;
  const clock = time ?? effect?.props.time ?? null;
  return {
    wind: {
      strength: resolvedStrength,
      direction: effect?.props.direction ?? WIND_DEFAULT_DIRECTION,
      gust: effect?.props.gust ?? 0,
      turbulence: effect?.props.turbulence ?? 1,
      time: clock ?? layer.context.timeline.getTime() / 1000
    },
    animated: resolvedStrength !== 0 && clock === null
  };
}

/**
 * The wind a layer's CPU bounds must cover. `peak` includes the gust swell; `turbulence` scales
 * the crown term. Records the effect state so `WindEffect` can update the layer when it changes.
 */
export function getLayerWindBound(
  layer: Layer,
  strength?: number | null
): {strength: number; peak: number; turbulence: number} {
  const effect = WindEffect.get(layer.context?.deck);
  if (layer.state) (layer.state as {windKey?: string}).windKey = effect?.boundKey ?? '';
  const resolved = strength ?? effect?.props.strength ?? 0;
  return {
    strength: resolved,
    peak: Math.abs(resolved) * (1 + Math.abs(effect?.props.gust ?? 0)),
    turbulence: Math.abs(effect?.props.turbulence ?? 1)
  };
}
