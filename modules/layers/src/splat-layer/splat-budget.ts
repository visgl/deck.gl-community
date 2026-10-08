// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatHierarchy} from './splat-hierarchy';

export type SplatBudgetLimit = {key: object; budget: number};

export type SplatSelection<T> = {
  owner: T;
  pixels: number;
  level: number;
  blend: number;
  retainedLevel?: number;
};

/** Spend a fixed Gaussian budget on the largest screen-error reductions. Never discard an owner.
 * If the coarsest representation itself exceeds the budget, return that coverage floor.
 * The caller must use spatial/source aggregation to bound that floor, rather than punch holes.
 */
export function budgetSplatSelections<T>(
  desired: SplatSelection<T>[],
  hierarchy: SplatHierarchy | ((owner: T) => SplatHierarchy),
  budget: number,
  getLimits?: (owner: T) => SplatBudgetLimit[]
): SplatSelection<T>[] {
  if (!desired.length || (!Number.isFinite(budget) && !getLimits)) return desired;
  const getHierarchy = (row: SplatSelection<T>) =>
    typeof hierarchy === 'function' ? hierarchy(row.owner) : hierarchy;
  const cachedCounts = new Map<SplatHierarchy, number[]>();
  const sourceCounts = desired.map(row => {
    const levels = getHierarchy(row);
    let counts = cachedCounts.get(levels);
    if (!counts) {
      counts = levels.map(level => level.source.positions.length / 3);
      cachedCounts.set(levels, counts);
    }
    return counts;
  });
  const limits = desired.map(row => getLimits?.(row.owner) ?? []);
  const ceilings = new Map<object, number>();
  const usage = new Map<object, number>();
  limits.forEach(list =>
    list.forEach(limit =>
      ceilings.set(limit.key, Math.min(ceilings.get(limit.key) ?? Infinity, limit.budget))
    )
  );
  const charge = (index: number, delta: number) =>
    limits[index].forEach(limit => usage.set(limit.key, (usage.get(limit.key) ?? 0) + delta));
  const fits = (index: number, delta: number) =>
    limits[index].every(limit => (usage.get(limit.key) ?? 0) + delta <= ceilings.get(limit.key)!);
  const cost = (row: SplatSelection<T>, index: number) =>
    sourceCounts[index][row.level] + (row.blend > 0 ? sourceCounts[index][row.level + 1] : 0);
  const desiredCost = desired.reduce((sum, row, index) => {
    const count = cost(row, index);
    charge(index, count);
    return sum + count;
  }, 0);
  if (
    !desired.length ||
    (desiredCost <= budget && [...usage].every(([key, count]) => count <= ceilings.get(key)!))
  )
    return desired;
  usage.clear();
  const rows = desired.map((row, index) => ({
    ...row,
    level: sourceCounts[index].length - 1,
    blend: 0
  }));
  let used = rows.reduce((sum, row, index) => {
    const count = cost(row, index);
    charge(index, count);
    return sum + count;
  }, 0);
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
  const enqueue = (index: number) => {
    const row = rows[index];
    const counts = sourceCounts[index];
    const levels = getHierarchy(row);
    const nextLevel = () => {
      let level = row.level - 1;
      // A finer representation with no greater cost dominates an intermediate
      // level. Supplied hierarchies need not have monotonic row counts.
      for (let finer = level - 1; finer >= desired[index].level; finer--)
        if (counts[finer] <= counts[level]) level = finer;
      return level;
    };
    // Equal-count (or cheaper) refinements need no scheduling or budget. Advancing
    // these immediately avoids thousands of useless heap operations per camera frame.
    while (row.level > desired[index].level && counts[nextLevel()] <= counts[row.level]) {
      const level = nextLevel();
      const delta = counts[level] - counts[row.level];
      used += delta;
      charge(index, delta);
      row.level = level;
    }
    if (row.level <= desired[index].level) return;
    const level = nextLevel();
    const delta = counts[level] - counts[row.level];
    const error = (levels[row.level].error - levels[level].error) * row.pixels;
    push({
      index,
      level,
      delta,
      priority:
        (error / Math.max(1, delta)) *
        ((desired[index].retainedLevel ?? Infinity) <= level ? 1.2 : 1)
    });
  };
  rows.forEach((_, index) => enqueue(index));
  while (heap.length) {
    const step = pop();
    if (used + step.delta > budget || !fits(step.index, step.delta)) continue;
    rows[step.index].level = step.level;
    used += step.delta;
    charge(step.index, step.delta);
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
