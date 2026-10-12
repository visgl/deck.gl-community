// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {SymbolMark} from './interfaces';

/** Keeps one GPU row per record and retains stationary targets for removed records. */
export function patchSymbolArray(data: SymbolMark[], previous: SymbolMark[]): SymbolMark[] {
  const slots = new Map<number, SymbolMark>();
  data.forEach((item, index) => {
    const ordinal = item.ordinal ?? index;
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || slots.has(ordinal)) {
      throw new Error('Symbol ordinals must be unique non-negative integers.');
    }
    slots.set(ordinal, item);
  });
  const length = Array.from(slots.keys()).reduce(
    (count, index) => Math.max(count, index + 1),
    previous.length
  );
  const result = Array.from({length}, (_, index): SymbolMark => {
    const target = slots.get(index);
    if (target) return target;
    const source = previous[index] ?? data[0];
    if (source.isEmpty) return source;
    return {
      ...source,
      ordinal: index,
      isEmpty: true,
      datum: undefined,
      radius: 0,
      fillColor: [0, 0, 0, 0],
      strokeColor: [0, 0, 0, 0],
      strokeWidth: 0
    };
  });
  return result.length === previous.length &&
    result.every((item, index) => item === previous[index])
    ? previous
    : result;
}
