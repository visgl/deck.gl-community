// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
/** Retain outgoing source coverage until incoming coverage has blended in.
 * Interrupted transitions restart from their current weight, never from zero or one.
 */
export class TreeCoverageTransition<T> {
  entries = new Map<T, {value: T; weight: number; from: number; target: number; started: number}>();
  revision = 0;
  get active() {
    return [...this.entries.values()].some(entry => entry.weight !== entry.target);
  }
  reconcile(values: T[], now: number, duration: number) {
    this.sample(now, duration);
    const selected = new Set(values);
    const initial = this.entries.size === 0;
    let changed = false;
    for (const entry of this.entries.values()) {
      const target = selected.has(entry.value) ? 1 : 0;
      if (target !== entry.target) {
        entry.from = entry.weight;
        entry.target = target;
        entry.started = now;
        changed = true;
      }
    }
    for (const value of values)
      if (!this.entries.has(value)) {
        const weight = initial ? 1 : 0;
        this.entries.set(value, {value, weight, from: weight, target: 1, started: now});
        changed = true;
      }
    if (changed) {
      // Every contributor to the same replacement must use the same new fade
      // interval. Otherwise an older outgoing page disappears ahead of the new
      // page's incoming weight when a third page interrupts the transition.
      for (const entry of this.entries.values()) {
        entry.from = entry.weight;
        entry.started = now;
      }
      this.revision++;
    }
    return changed;
  }
  /** Keep transition history finite during rapid retargets; current coverage is always retained. */
  trim(maximum: number, selected: T[]) {
    if (this.entries.size <= maximum) return false;
    const keep = new Set(selected);
    const outgoing = [...this.entries.values()]
      .filter(entry => !keep.has(entry.value))
      .sort((a, b) => b.weight - a.weight);
    for (const entry of outgoing.slice(Math.max(0, maximum - selected.length)))
      this.entries.delete(entry.value);
    this.revision++;
    return true;
  }
  sample(now: number, duration: number) {
    let changed = false;
    for (const [value, entry] of this.entries) {
      const t = duration > 0 ? Math.max(0, Math.min(1, (now - entry.started) / duration)) : 1;
      const weight =
        t === 1 ? entry.target : entry.from + (entry.target - entry.from) * (t * t * (3 - 2 * t));
      if (weight !== entry.weight) {
        entry.weight = weight;
        changed = true;
      }
      if (t === 1 && entry.target === 0) {
        this.entries.delete(value);
        changed = true;
      }
    }
    if (changed) this.revision++;
    return changed;
  }
}
