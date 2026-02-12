// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {NodeState, EdgeState} from '../core/constants';

const NODE_STATES: ReadonlySet<NodeState> = new Set(['default', 'hover', 'dragging', 'selected']);
const EDGE_STATES: ReadonlySet<EdgeState> = new Set(['default', 'hover', 'dragging', 'selected']);

export function normalizeNodeState(state: NodeState | undefined): NodeState {
  if (state && NODE_STATES.has(state)) {
    return state;
  }
  return 'default';
}

export function normalizeEdgeState(state: EdgeState | undefined): EdgeState {
  if (state && EDGE_STATES.has(state)) {
    return state;
  }
  return 'default';
}

export function normalizeNodeStateColumn(source: NodeState[] | undefined, length: number): NodeState[] {
  const result: NodeState[] = new Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = normalizeNodeState(source?.[i]);
  }
  return result;
}

export function normalizeEdgeStateColumn(source: EdgeState[] | undefined, length: number): EdgeState[] {
  const result: EdgeState[] = new Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = normalizeEdgeState(source?.[i]);
  }
  return result;
}

export function normalizeBooleanColumn(
  source: boolean[] | undefined,
  length: number,
  fallback: boolean
): boolean[] {
  const result: boolean[] = new Array(length);
  for (let i = 0; i < length; i++) {
    const candidate = source?.[i];
    result[i] = typeof candidate === 'boolean' ? candidate : fallback;
  }
  return result;
}

export function normalizeDataColumn(
  source: Record<string, unknown>[] | undefined,
  length: number
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = new Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = cloneRecord(source?.[i]);
  }
  return result;
}

export function normalizeVersion(version: unknown): number {
  if (typeof version === 'number' && Number.isFinite(version)) {
    return version;
  }
  return 0;
}

export function cloneRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return {...(value as Record<string, unknown>)};
  }
  return {};
}

export function cloneDataColumn(
  source: Record<string, unknown>[],
  length: number
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = new Array(length);
  for (let i = 0; i < length; i++) {
    result[i] = cloneRecord(source[i]);
  }
  return result;
}
