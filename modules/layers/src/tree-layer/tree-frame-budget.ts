// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Effect, EffectContext, PreRenderOptions} from '@deck.gl/core';

/** Hysteretic feedback from recent rendered-frame intervals. Ignore idle gaps and cold loading.
 * This is a quality controller, not a universal frame-rate guarantee: browser/host stalls
 * and the coarsest coverage floor cannot be eliminated by a geometry budget.
 */
export class TreeFrameBudget {
  scale = 1;
  private previous = 0;
  private checked = 0;
  private stableSince = 0;
  private frames: number[] = [];
  sample(now: number, target: number, minimum: number, active = false): boolean {
    const elapsed = now - this.previous;
    this.previous = now;
    if (
      target <= 0 ||
      elapsed <= 0 ||
      elapsed > 1000 ||
      (!active && elapsed > Math.max(100, target * 6))
    ) {
      this.frames = [];
      this.checked = now;
      this.stableSince = 0;
      return false;
    }
    this.frames.push(elapsed);
    if (this.frames.length > 90) this.frames.shift();
    if (this.frames.length < 30 || now - this.checked < 750) return false;
    this.checked = now;
    const sorted = [...this.frames].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const previous = this.scale;
    if (p95 > target * 1.1) {
      this.scale = Math.max(minimum, this.scale * 0.8);
      this.stableSince = 0;
    } else if (p95 < target * 0.85) {
      this.scale = Math.min(1, this.scale * 1.1);
      this.stableSince = 0;
    } else if (p95 <= target * 1.025) {
      // Vsync quantizes a healthy 60Hz renderer to the target interval. Probe
      // quality gently after sustained stability instead of staying reduced forever.
      this.stableSince ||= now;
      if (now - this.stableSince >= 3000) {
        this.scale = Math.min(1, this.scale * 1.05);
        this.stableSince = now;
      }
    } else this.stableSince = 0;
    this.frames = [];
    return this.scale !== previous;
  }
}

const effects = new WeakMap<object, TreeBudgetEffect>();
/** One lightweight feedback pass per Deck. It never overrides the host's metrics callbacks. */
export class TreeBudgetEffect implements Effect {
  static get(deck: EffectContext['deck']) {
    let effect = effects.get(deck);
    if (!effect) {
      effect = new TreeBudgetEffect();
      effects.set(deck, effect);
      deck._addDefaultEffect(effect);
    }
    return effect;
  }
  id = 'tree-frame-budget';
  props = {};
  order = -100;
  setup() {}
  preRender(options: PreRenderOptions) {
    const now = performance.now();
    for (const layer of options.layers) {
      if ('updateFrameBudget' in layer && typeof layer.updateFrameBudget === 'function')
        layer.updateFrameBudget(now);
    }
  }
  cleanup({deck}: EffectContext) {
    effects.delete(deck);
  }
}
