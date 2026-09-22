// deck.gl-community
// SPDX-License-Identifier: MIT

export const MAX_DATA_BYTES = 1024 * 1024;
export const MAX_DATA_ROWS = 10_000;

/** Copies bounded JSON rows without evaluating getters, toJSON methods or expressions. */
export function validatePlaygroundRows(
  value: unknown,
  maxBytes = MAX_DATA_BYTES
): Record<string, unknown>[] {
  let nodes = 0;
  let characters = 0;
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 100_000 || depth > 16) throw new Error('Data is too complex');
    if (typeof value === 'string') {
      characters += value.length;
      if (characters > maxBytes) throw new Error('Data is too large');
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object') throw new Error('Expected JSON values');
    if (Array.isArray(value)) {
      if (value.length > MAX_DATA_ROWS) throw new Error('Too many values');
      return Array.from({length: value.length}, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !('value' in descriptor)) throw new Error('Expected JSON values');
        return copy(descriptor.value, depth + 1);
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype && Object.getPrototypeOf(prototype) !== null) {
      throw new Error('Expected a JSON object');
    }
    const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
    if (entries.length > 128) throw new Error('Too many fields');
    return Object.fromEntries(
      entries.map(([key, descriptor]) => {
        if (
          key.length > 128 ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          !descriptor.enumerable ||
          !('value' in descriptor)
        ) {
          throw new Error('Expected JSON fields');
        }
        characters += key.length;
        if (characters > maxBytes) throw new Error('Data is too large');
        return [key, copy(descriptor.value, depth + 1)];
      })
    );
  }
  if (!Array.isArray(value) || value.length > MAX_DATA_ROWS) {
    throw new Error('Expected a row array');
  }
  const rows = copy(value, 0) as Record<string, unknown>[];
  if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new Error('Expected a row array');
  }
  if (new TextEncoder().encode(JSON.stringify(rows)).byteLength > maxBytes) {
    throw new Error('Data is too large');
  }
  return rows;
}
