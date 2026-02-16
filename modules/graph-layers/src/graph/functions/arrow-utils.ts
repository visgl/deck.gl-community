// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import * as arrow from 'apache-arrow';

export function getVectorLength(vector: arrow.Vector | null): number {
  return vector?.length ?? 0;
}

export function getVectorValue(vector: arrow.Vector | null, index: number): unknown {
  return vector ? (vector.get?.(index) ?? vector.toArray?.()[index]) : undefined;
}

export function getColumnVector(table: arrow.Table, columnName: string): arrow.Vector | null {
  const candidate = (
    table as arrow.Table & {getColumn?: (name: string) => arrow.Vector | null}
  ).getColumn?.(columnName);
  if (candidate) {
    return candidate;
  }
  const childAccessor = (table as arrow.Table & {getChild?: (name: string) => arrow.Vector | null})
    .getChild;
  if (typeof childAccessor === 'function') {
    const vector = childAccessor.call(table, columnName);
    if (vector) {
      return vector;
    }
  }
  const getChildAt = (table as arrow.Table & {getChildAt?: (index: number) => arrow.Vector | null})
    .getChildAt;
  const schema = (table as arrow.Table & {schema?: {fields?: Array<{name: string}>}}).schema;
  if (schema && Array.isArray(schema.fields) && typeof getChildAt === 'function') {
    const index = schema.fields.findIndex((field) => field?.name === columnName);
    if (index >= 0) {
      return getChildAt.call(table, index) ?? null;
    }
  }
  return null;
}

export function parseDataRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return {...(parsed as Record<string, unknown>)};
      }
    } catch {
      return {};
    }
  } else if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}

export function coerceIdentifier(value: unknown): string | number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric) && String(numeric) === trimmed) {
        return numeric;
      }
    }
    return value;
  }
  if (value === null || typeof value === 'undefined') {
    throw new Error('Arrow graph encountered an undefined identifier.');
  }
  return String(value);
}
