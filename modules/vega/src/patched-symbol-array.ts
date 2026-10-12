// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import type {Polygon, SymbolMark, Vec3} from './interfaces';

type SymbolDatum = SymbolMark | Polygon;

/** Keeps GPU attribute rows stable and retains invisible targets for exited symbols. */
export function patchSymbolArray<T extends SymbolDatum>(data: T[], previous: T[]): T[] {
  const slots = new Map<number, T>();
  data.forEach((item, index) => {
    const ordinal = item.ordinal ?? index;
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || slots.has(ordinal)) {
      throw new Error('Symbol ordinals must be unique non-negative integers.');
    }
    slots.set(ordinal, item);
  });
  const length = Array.from(slots.keys()).reduce(
    (length, index) => Math.max(length, index + 1),
    previous.length
  );
  return Array.from({length}, (_, index) => {
    const target = slots.get(index);
    if (target) return target;
    const source = previous[index] ?? data[0];
    if (!source) return undefined;
    const ghost = {
      ...source,
      ordinal: index,
      datum: undefined,
      fillColor: [0, 0, 0, 0],
      strokeColor: [0, 0, 0, 0],
      strokeWidth: 0
    };
    if ('radius' in source) return {...ghost, radius: 0} as T;
    const positions = source.positions as Vec3[];
    const center = positions
      .reduce((sum, p) => sum.map((v, i) => v + (p[i] || 0)) as Vec3, [0, 0, 0])
      .map(v => v / positions.length) as Vec3;
    return {...ghost, positions: positions.map(() => [...center])} as T;
  });
}
