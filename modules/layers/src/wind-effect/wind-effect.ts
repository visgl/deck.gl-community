// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Effect, EffectContext, Layer, PreRenderOptions} from '@deck.gl/core';
import {
  WIND_DEFAULT_DIRECTION,
  WIND_DEFAULT_SHEAR,
  getWindStrength,
  type WindModuleProps
} from './wind-module';

/** Bend strength when neither `strength` nor `speed` is set: TreeLayer's gentle breeze. */
const WIND_DEFAULT_STRENGTH = 0.025;

export type WindEffectProps = {
  /**
   * Bend as a fraction of object height for flex 1. `0` is still air. Wins over `speed`; when both
   * are omitted the bend is 0.025, a gentle breeze. @default null
   */
  strength?: number | null;
  /**
   * Wind speed in m/s at the 10 m reference height. Without `strength`, the bend follows
   * `getWindStrength(speed)`: 0.025 at 5 m/s, capped at 0.2. @default null
   */
  speed?: number | null;
  /** Exponent of the power-law height profile `v(z) = v₁₀ (z / 10)^shear`. @default 1/7 */
  shear?: number;
  /**
   * Compass bearing the wind blows toward, in degrees clockwise from north, like
   * `DirectionalLight.direction`. The default, about 65.8°, is the axis wind used before this effect.
   */
  direction?: number;
  /** Fractional strength swell: strength varies within `strength × (1 ± gust)`. @default 0 */
  gust?: number;
  /** Scale of the crown flutter mode. `0` leaves a pure bend. @default 1 */
  turbulence?: number;
  /**
   * Wind clock in seconds. `null` follows deck.gl's timeline and wind layers request redraws. A
   * callback is an app-owned clock: the app schedules frames, so layers do not. @default null
   */
  time?: number | (() => number) | null;
};

const DEFAULT_PROPS: Required<WindEffectProps> = {
  strength: null,
  speed: null,
  shear: WIND_DEFAULT_SHEAR,
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

  /** Resolved bend for flex 1: `strength`, else the response to `speed`, else 0.025. */
  get strength(): number {
    const {strength, speed} = this.props;
    return strength ?? (typeof speed === 'number' ? getWindStrength(speed) : WIND_DEFAULT_STRENGTH);
  }

  /** The values layer bounds depend on. Direction, shear and time do not change a bound. */
  get boundKey(): string {
    const {gust, turbulence} = this.props;
    return `${this.strength}|${gust}|${turbulence}`;
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
    const {direction, gust, turbulence} = this.props;
    return {
      strength: this.strength,
      direction,
      gust,
      turbulence,
      time: this.getTime() ?? layer.context.timeline.getTime() / 1000
    };
  }

  /** The effect's clock in seconds: the fixed time, the callback's, or null on the timeline. */
  getTime(): number | null {
    const {time} = this.props;
    return typeof time === 'function' ? time() : time;
  }

  cleanup({deck}: EffectContext) {
    if (EFFECTS.get(deck) === this) EFFECTS.delete(deck);
    for (const layer of this.consumers) layer.getCurrentLayer()?.setNeedsUpdate();
    this.consumers = [];
  }
}

/**
 * The wind a layer draws with: the deck's `WindEffect`, or still air without one or when the layer
 * opts out with `windEnabled: false`. `animated` is true while the pose follows the timeline and
 * needs every frame; a fixed or app-owned (callback) clock leaves frame scheduling to the app.
 */
export function getLayerWind(
  layer: Layer,
  enabled = true
): {wind: WindModuleProps; animated: boolean} {
  const effect = WindEffect.get(layer.context?.deck);
  const strength = enabled ? (effect?.strength ?? 0) : 0;
  const clock = effect?.getTime() ?? null;
  return {
    wind: {
      strength,
      direction: effect?.props.direction ?? WIND_DEFAULT_DIRECTION,
      gust: effect?.props.gust ?? 0,
      turbulence: effect?.props.turbulence ?? 1,
      time: clock ?? layer.context.timeline.getTime() / 1000
    },
    animated: strength !== 0 && clock === null
  };
}

/**
 * The wind a layer's CPU bounds must cover. `peak` includes the gust swell; `turbulence` scales
 * the crown term. Records the effect state so `WindEffect` can update the layer when it changes.
 */
export function getLayerWindBound(
  layer: Layer,
  enabled = true
): {strength: number; peak: number; turbulence: number} {
  const effect = WindEffect.get(layer.context?.deck);
  if (layer.state) (layer.state as {windKey?: string}).windKey = effect?.boundKey ?? '';
  const strength = enabled ? (effect?.strength ?? 0) : 0;
  return {
    strength,
    peak: Math.abs(strength) * (1 + Math.abs(effect?.props.gust ?? 0)),
    turbulence: Math.abs(effect?.props.turbulence ?? 1)
  };
}
