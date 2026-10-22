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

/**
 * Instance rows whose slots survive membership changes. A retained member keeps its slot; a
 * departure is refilled by an arrival, otherwise by the last row, so a camera move at the view edge
 * rewrites only the slots it touches instead of shifting every following instance.
 */
export class SplatRowSlots<T> {
  /** Rows in instance order. Replaced, never mutated, when a slot changes. */
  rows: T[] = [];
  private keys: number[] = [];
  /** Slot + 1 of each member key, or 0. */
  private slots: Int32Array = new Int32Array(0);

  /**
   * Place this frame's members, given in any order with unique non-negative integer keys.
   * Returns the previous array when no slot changed.
   */
  update(next: readonly T[], keys: readonly number[], equal: (a: T, b: T) => boolean = Object.is) {
    const previous = this.rows;
    const previousKeys = this.keys;
    const rows = new Array<T>(previous.length);
    const placed = new Array<number>(previous.length);
    const filled = new Uint8Array(previous.length);
    const arrivals: number[] = [];
    let changed = false;
    for (let i = 0; i < next.length; i++) {
      const key = keys[i];
      const slot = key < this.slots.length ? this.slots[key] - 1 : -1;
      if (slot >= 0 && !filled[slot]) {
        filled[slot] = 1;
        placed[slot] = key;
        if (equal(previous[slot], next[i])) rows[slot] = previous[slot];
        else {
          rows[slot] = next[i];
          changed = true;
        }
      } else arrivals.push(i);
    }
    for (let slot = 0; slot < previous.length; slot++)
      if (!filled[slot]) this.slots[previousKeys[slot]] = 0;
    let end = previous.length;
    let arrival = 0;
    for (let slot = 0; slot < end; slot++) {
      if (filled[slot]) continue;
      changed = true;
      if (arrival < arrivals.length) {
        const index = arrivals[arrival++];
        rows[slot] = next[index];
        placed[slot] = keys[index];
      } else {
        while (end > slot + 1 && !filled[end - 1]) end--;
        if (end <= slot + 1) {
          end = slot;
          break;
        }
        end--;
        rows[slot] = rows[end];
        placed[slot] = placed[end];
      }
      filled[slot] = 1;
      this.slots = growSlots(this.slots, placed[slot]);
      this.slots[placed[slot]] = slot + 1;
    }
    rows.length = placed.length = end;
    for (; arrival < arrivals.length; arrival++) {
      const index = arrivals[arrival];
      changed = true;
      this.slots = growSlots(this.slots, keys[index]);
      this.slots[keys[index]] = rows.length + 1;
      rows.push(next[index]);
      placed.push(keys[index]);
    }
    if (!changed) return previous;
    this.rows = rows;
    this.keys = placed;
    return rows;
  }
}

function growSlots(slots: Int32Array, key: number): Int32Array {
  if (key < slots.length) return slots;
  const grown = new Int32Array(Math.max(key + 1, slots.length * 2));
  grown.set(slots);
  return grown;
}

// One driver write per attribute and range is cheaper than re-evaluating this many unchanged rows.
const SPLAT_RANGE_GAP = 32;
const MAX_SPLAT_RANGES = 16;

/**
 * Upload only changed instance ranges; removed tails are excluded by the instance count. Nearby
 * ranges merge, and at most a few ranges remain by merging across the smallest unchanged gaps.
 */
export function getSplatChangedRanges<T>(next: T[], previous: T[] = []) {
  const ranges: {startRow: number; endRow: number}[] = [];
  let start = -1;
  for (let i = 0; i <= next.length; i++) {
    const changed = i < next.length && next[i] !== previous[i];
    if (changed && start < 0) start = i;
    if (!changed && start >= 0) {
      const last = ranges[ranges.length - 1];
      if (last && start - last.endRow < SPLAT_RANGE_GAP) last.endRow = i;
      else ranges.push({startRow: start, endRow: i});
      start = -1;
    }
  }
  if (ranges.length <= MAX_SPLAT_RANGES) return ranges;
  // Keep the largest unchanged gaps as splits and merge across the others.
  const gaps = ranges.slice(1).map((range, i) => range.startRow - ranges[i].endRow);
  const threshold = [...gaps].sort((a, b) => b - a)[MAX_SPLAT_RANGES - 2];
  let splits = gaps.filter(gap => gap > threshold).length;
  const merged = [ranges[0]];
  gaps.forEach((gap, i) => {
    // Equal gaps at the threshold split in order until the range limit is reached.
    if (gap > threshold || (gap === threshold && splits < MAX_SPLAT_RANGES - 1)) {
      if (gap === threshold) splits++;
      merged.push(ranges[i + 1]);
    } else merged[merged.length - 1] = {...merged[merged.length - 1], endRow: ranges[i + 1].endRow};
  });
  return merged;
}
