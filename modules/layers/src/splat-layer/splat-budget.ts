// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatHierarchy} from './splat-hierarchy';

export type SplatBudgetLimit = {key: object; budget: number};

export type SplatSelection<T> = {
  owner: T;
  pixels: number;
  /** Relative allocation priority. It never changes the requested hierarchy level. */
  focus?: number;
  level: number;
  blend: number;
  retainedLevel?: number;
};

const LEVEL_COUNTS = new WeakMap<SplatHierarchy, number[]>();

/** Gaussian count of each representation, cached per immutable hierarchy. */
export function getSplatLevelCounts(hierarchy: SplatHierarchy): number[] {
  let counts = LEVEL_COUNTS.get(hierarchy);
  if (!counts) {
    counts = hierarchy.map(level => level.source.positions.length / 3);
    LEVEL_COUNTS.set(hierarchy, counts);
  }
  return counts;
}

/** Spend a fixed Gaussian budget on owners with the largest remaining screen error. Never discard an owner.
 * If the coarsest representation itself exceeds the budget, return that coverage floor.
 * The caller must use spatial/source aggregation to bound that floor, rather than punch holes.
 * Callbacks also receive the row index, so callers can share one limit list across many rows.
 */
export function budgetSplatSelections<T>(
  desired: SplatSelection<T>[],
  hierarchy: SplatHierarchy | ((owner: T, index: number) => SplatHierarchy),
  budget: number,
  getLimits?: (owner: T, index: number) => SplatBudgetLimit[]
): SplatSelection<T>[] {
  if (!desired.length || (!Number.isFinite(budget) && !getLimits)) return desired;
  const hierarchies: SplatHierarchy[] = new Array(desired.length);
  const sourceCounts: number[][] = new Array(desired.length);
  // Rows reference a few shared limit lists. Resolve each list once to dense counters.
  const limits: number[][] = new Array(desired.length);
  const limitKeys = new Map<object, number>();
  const limitLists = new Map<SplatBudgetLimit[], number[]>();
  const ceilings: number[] = [];
  let previous: SplatHierarchy | undefined;
  let previousCounts: number[] = [];
  for (let index = 0; index < desired.length; index++) {
    const owner = desired[index].owner;
    const levels = typeof hierarchy === 'function' ? hierarchy(owner, index) : hierarchy;
    if (levels !== previous) {
      previous = levels;
      previousCounts = getSplatLevelCounts(levels);
    }
    hierarchies[index] = levels;
    sourceCounts[index] = previousCounts;
    const list = getLimits?.(owner, index) ?? [];
    let resolved = limitLists.get(list);
    if (!resolved) {
      resolved = list.map(limit => {
        let key = limitKeys.get(limit.key);
        if (key === undefined) {
          key = ceilings.length;
          limitKeys.set(limit.key, key);
          ceilings.push(Infinity);
        }
        ceilings[key] = Math.min(ceilings[key], limit.budget);
        return key;
      });
      limitLists.set(list, resolved);
    }
    limits[index] = resolved;
  }
  const usage = new Float64Array(ceilings.length);
  const charge = (index: number, delta: number) => {
    for (const key of limits[index]) usage[key] += delta;
  };
  const fits = (index: number, delta: number) => {
    for (const key of limits[index]) if (usage[key] + delta > ceilings[key]) return false;
    return true;
  };
  const cost = (row: SplatSelection<T>, index: number) =>
    sourceCounts[index][row.level] + (row.blend > 0 ? sourceCounts[index][row.level + 1] : 0);
  let desiredCost = 0;
  for (let index = 0; index < desired.length; index++) {
    const count = cost(desired[index], index);
    charge(index, count);
    desiredCost += count;
  }
  if (desiredCost <= budget && usage.every((count, key) => count <= ceilings[key])) return desired;
  usage.fill(0);
  const rows = desired.map((row, index) => ({
    ...row,
    level: sourceCounts[index].length - 1,
    blend: 0
  }));
  let used = 0;
  for (let index = 0; index < rows.length; index++) {
    const count = cost(rows[index], index);
    charge(index, count);
    used += count;
  }
  type Step = {index: number; level: number; delta: number; priority: number};
  const heap: Step[] = [];
  const push = (step: Step) => {
    let i = heap.length;
    heap.push(step);
    while (i > 0) {
      const parent = (i - 1) >>> 1;
      if (heap[parent].priority >= step.priority) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = step;
  };
  const pop = (): Step => {
    const result = heap[0];
    const tail = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1].priority > heap[child].priority) child++;
        if (tail.priority >= heap[child].priority) break;
        heap[i] = heap[child];
        i = child;
      }
      heap[i] = tail;
    }
    return result;
  };
  const nextLevel = (index: number) => {
    const row = rows[index];
    const counts = sourceCounts[index];
    let level = row.level - 1;
    // A finer representation with no greater cost dominates an intermediate
    // level. Supplied hierarchies need not have monotonic row counts.
    for (let finer = level - 1; finer >= desired[index].level; finer--)
      if (counts[finer] <= counts[level]) level = finer;
    return level;
  };
  // Equal-count (or cheaper) refinements need no scheduling or budget. Advancing
  // these immediately avoids thousands of useless heap operations per camera frame.
  rows.forEach((row, index) => {
    const counts = sourceCounts[index];
    while (row.level > desired[index].level && counts[nextLevel(index)] <= counts[row.level]) {
      const level = nextLevel(index);
      const delta = counts[level] - counts[row.level];
      used += delta;
      charge(index, delta);
      row.level = level;
    }
  });
  const priority = (index: number, level: number) => {
    const row = rows[index];
    const levels = hierarchies[index];
    // Reduce the largest remaining projected error to each owner's requested target first.
    // Ranking only the gain per added splat lets cheap far promotions exhaust the budget while a
    // nearby owner remains a coarse proxy. Cost remains a hard feasibility constraint below.
    const error =
      Math.max(0, levels[row.level].error - levels[desired[index].level].error) * row.pixels;
    return (
      error *
      Math.max(0, desired[index].focus ?? 1) *
      ((desired[index].retainedLevel ?? Infinity) <= level ? 1.2 : 1)
    );
  };
  const enqueue = (index: number) => {
    const row = rows[index];
    const counts = sourceCounts[index];
    if (row.level <= desired[index].level) return;
    const level = nextLevel(index);
    const delta = counts[level] - counts[row.level];
    push({
      index,
      level,
      delta,
      priority: priority(index, level)
    });
  };
  // Every remaining first step adds Gaussians, and usage cannot fall until one is accepted. When
  // the coverage floor already exhausts each owner's limits, no step can ever fit: skip the heap.
  let refinable = false;
  for (let index = 0; index < rows.length && !refinable; index++) {
    const row = rows[index];
    if (row.level <= desired[index].level) continue;
    const delta = sourceCounts[index][nextLevel(index)] - sourceCounts[index][row.level];
    refinable = used + delta <= budget && fits(index, delta);
  }
  if (refinable) rows.forEach((_, index) => enqueue(index));
  while (heap.length) {
    const step = pop();
    if (used + step.delta > budget || !fits(step.index, step.delta)) continue;
    rows[step.index].level = step.level;
    charge(step.index, step.delta);
    used += step.delta;
    enqueue(step.index);
  }
  // Preserve optical cross-fades when both representations fit. A budget-constrained
  // owner uses one covariance-preserving aggregate, never an opacity-scaled sample.
  rows.forEach((row, index) => {
    const target = desired[index];
    const counts = sourceCounts[index];
    if (
      row.level === target.level &&
      target.blend > 0 &&
      used + counts[row.level + 1] <= budget &&
      fits(index, counts[row.level + 1])
    ) {
      row.blend = target.blend;
      used += counts[row.level + 1];
      charge(index, counts[row.level + 1]);
    }
  });
  return rows;
}
