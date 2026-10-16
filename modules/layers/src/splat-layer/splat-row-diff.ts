// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
/** Preserve unchanged row identities and the whole list when a spatial query returns the same owners. */
export function retainSplatRows<T>(
  previous: T[],
  next: T[],
  equal: (a: T, b: T) => boolean = Object.is
): T[] {
  let changed = previous.length !== next.length;
  for (let i = 0; i < next.length; i++) {
    if (i < previous.length && equal(previous[i], next[i])) next[i] = previous[i];
    else changed = true;
  }
  return changed ? next : previous;
}

/** Upload only changed contiguous instance ranges; removed tails are excluded by the instance count. */
export function getSplatChangedRanges<T>(next: T[], previous: T[] = []) {
  const ranges: {startRow: number; endRow: number}[] = [];
  let start = -1;
  for (let i = 0; i <= next.length; i++) {
    const changed = i < next.length && next[i] !== previous[i];
    if (changed && start < 0) start = i;
    if (!changed && start >= 0) {
      ranges.push({startRow: start, endRow: i});
      start = -1;
    }
  }
  // Fragmented writes cost more driver calls than one bounded upload. Keep at most four.
  return ranges.length > 4
    ? [{startRow: ranges[0].startRow, endRow: ranges[ranges.length - 1].endRow}]
    : ranges;
}
