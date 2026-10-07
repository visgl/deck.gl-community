// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SplatHierarchy} from './splat-hierarchy';

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
  hierarchy: SplatHierarchy,
  budget: number
): SplatSelection<T>[] {
  const counts = hierarchy.map(level => level.source.positions.length / 3);
  const cost = (row: SplatSelection<T>) =>
    counts[row.level] + (row.blend > 0 ? counts[row.level + 1] : 0);
  const desiredCost = desired.reduce((sum, row) => sum + cost(row), 0);
  if (desiredCost <= budget || !desired.length) return desired;
  const last = counts.length - 1;
  const rows = desired.map(row => ({...row, level: last, blend: 0}));
  let used = rows.length * counts[last];
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
    // Equal-count (or cheaper) refinements need no scheduling or budget. Advancing
    // these immediately avoids thousands of useless heap operations per camera frame.
    while (row.level > desired[index].level && counts[row.level - 1] <= counts[row.level]) {
      used += counts[row.level - 1] - counts[row.level];
      row.level--;
    }
    if (row.level <= desired[index].level) return;
    const level = row.level - 1;
    const delta = counts[level] - counts[row.level];
    const error = (hierarchy[row.level].error - hierarchy[level].error) * row.pixels;
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
    if (used + step.delta > budget) continue;
    rows[step.index].level = step.level;
    used += step.delta;
    enqueue(step.index);
  }
  // Preserve optical cross-fades when both representations fit. A budget-constrained
  // owner uses one covariance-preserving aggregate, never an opacity-scaled sample.
  rows.forEach((row, index) => {
    const target = desired[index];
    if (row.level === target.level && target.blend > 0 && used + counts[row.level + 1] <= budget) {
      row.blend = target.blend;
      used += counts[row.level + 1];
    }
  });
  return rows;
}
