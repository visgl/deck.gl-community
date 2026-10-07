// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatSelection} from './splat-budget';

type Entry<T> = {
  owner: T;
  counts: number[];
  weights: number[];
  target: number[];
  level: number;
  blend: number;
  dominant: number;
  cost: number;
  targetCost: number;
  missingCost: number;
  seen: number;
  revision: number;
};
/** Persistent optical mixtures with bounded overlap. Only moving owners pay fade bookkeeping. */
export class SplatRefinementTransition<T> {
  entries = new Map<string, Entry<T>>();
  private moving = new Set<Entry<T>>();
  private previous = 0;
  private budget = Infinity;
  private used = 0;
  private epoch = 0;
  revision = 0;
  get activeCount() {
    return this.moving.size;
  }
  get active() {
    return this.activeCount > 0;
  }

  reconcile(
    rows: SplatSelection<T>[],
    counts: number[] | ((owner: T) => number[]),
    budget: number,
    key: (owner: T) => string
  ) {
    this.budget = budget;
    let membershipChanged = false;
    const initial = this.entries.size === 0;
    const epoch = ++this.epoch;
    for (const row of rows) {
      const rowCounts = typeof counts === 'function' ? counts(row.owner) : counts;
      const id = key(row.owner);
      // Quantize only the target; optical output still moves continuously. This
      // deadband stops tiny projection changes from keeping thousands of fades alive.
      const blend = Math.round(row.blend * 64) / 64;
      let entry = this.entries.get(id);
      if (!entry) {
        const target = rowCounts.map((_, level) =>
          level === row.level ? 1 - blend : level === row.level + 1 ? blend : 0
        );
        const weights = initial
          ? [...target]
          : rowCounts.map((_, level) => (level === rowCounts.length - 1 ? 1 : 0));
        const cost = weights.reduce(
          (sum, weight, level) => sum + (weight > 0 ? rowCounts[level] : 0),
          0
        );
        entry = {
          owner: row.owner,
          counts: rowCounts,
          weights,
          target,
          level: row.level,
          blend,
          dominant: weights.indexOf(Math.max(...weights)),
          cost,
          targetCost: 0,
          missingCost: 0,
          seen: epoch,
          revision: 0
        };
        membershipChanged = true;
        this.entries.set(id, entry);
        this.used += cost;
        this.updateTarget(entry);
      } else {
        membershipChanged ||= entry.owner !== row.owner;
        entry.owner = row.owner;
        entry.counts = rowCounts;
        entry.seen = epoch;
        if (entry.level !== row.level || entry.blend !== blend) {
          entry.level = row.level;
          entry.blend = blend;
          entry.target.fill(0);
          entry.target[row.level] = 1 - blend;
          if (blend > 0) entry.target[row.level + 1] = blend;
          this.updateTarget(entry);
        }
      }
    }
    for (const [id, entry] of this.entries)
      if (entry.seen !== epoch) {
        membershipChanged = true;
        this.used -= entry.cost;
        this.moving.delete(entry);
        this.entries.delete(id);
      }
    this.revision++;
    return membershipChanged;
  }
  private updateTarget(entry: Entry<T>) {
    entry.targetCost = 0;
    entry.missingCost = 0;
    let changing = false;
    for (let i = 0; i < entry.counts.length; i++) {
      if (entry.target[i] > 0) {
        entry.targetCost += entry.counts[i];
        if (entry.weights[i] === 0) entry.missingCost += entry.counts[i];
      }
      changing ||= entry.weights[i] !== entry.target[i];
    }
    if (changing) this.moving.add(entry);
    else this.moving.delete(entry);
  }
  /** Slow frames cannot turn a detail change into one large optical step.
   * Forced quota reductions retain old work until faded, admitting at most one
   * additional owner representation above that existing work to make progress.
   */
  sample(now: number, duration = 900): boolean {
    const elapsed = this.previous ? Math.max(0, Math.min(16, now - this.previous)) : 0;
    this.previous = now;
    if (!this.active || !elapsed) return false;
    const alpha = 1 - Math.exp(-elapsed / (duration / 3));
    let reserve = 0;
    for (const entry of this.moving)
      if (entry.targetCost <= entry.cost) reserve = Math.max(reserve, entry.missingCost);
    let ceiling = Math.max(this.budget, this.used + reserve);
    // A target can fit the quota while its old/new overlap cannot. If all fades
    // are blocked, temporarily admit the smallest missing owner representation.
    // It retains coverage and frees its old cost when the continuous fade ends.
    let canAdvance = false;
    for (const entry of this.moving) canAdvance ||= this.used + entry.missingCost <= ceiling;
    if (!canAdvance) {
      let fallback = Infinity;
      for (const entry of this.moving)
        if (entry.targetCost <= this.budget) fallback = Math.min(fallback, entry.missingCost);
      if (Number.isFinite(fallback)) ceiling = Math.max(ceiling, this.used + fallback);
    }
    let changed = false;
    for (const demote of [true, false])
      for (const entry of this.moving) {
        if (entry.targetCost <= entry.cost !== demote || this.used + entry.missingCost > ceiling)
          continue;
        const before = entry.cost;
        let cost = 0,
          moving = false,
          largest = -1,
          dominant = 0;
        for (let i = 0; i < entry.weights.length; i++) {
          const delta = entry.target[i] - entry.weights[i];
          if (delta !== 0) {
            entry.weights[i] =
              Math.abs(delta) < 0.0001 ? entry.target[i] : entry.weights[i] + delta * alpha;
            changed = true;
          }
          if (entry.weights[i] > 0) cost += entry.counts[i];
          if (entry.weights[i] > largest) {
            largest = entry.weights[i];
            dominant = i;
          }
          moving ||= entry.weights[i] !== entry.target[i];
        }
        entry.dominant = dominant;
        entry.cost = cost;
        entry.missingCost = 0;
        entry.revision++;
        this.used += cost - before;
        if (!moving) this.moving.delete(entry);
      }
    if (changed) this.revision++;
    return changed;
  }
  getLevel(key: string): number | undefined {
    return this.entries.get(key)?.dominant;
  }
}
