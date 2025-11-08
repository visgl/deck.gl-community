// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Node} from '../graph/node';

export type RankAccessor = string | ((node: Node) => number | null | undefined);
export type LabelAccessor = string | ((node: Node) => string | number | null | undefined);

export type RankPosition = {
  rank: number;
  yPosition: number;
  label: string | number;
};

export type MapRanksToYPositionsOptions = {
  rankAccessor?: RankAccessor;
  labelAccessor?: LabelAccessor;
};

type RankAggregate = {sum: number; count: number; label: string | number | null};

type RankAggregateState = {
  aggregates: Map<number, RankAggregate>;
  range: {min: number; max: number};
};

function accumulateRank(
  node: Node,
  getRank: (node: Node) => number | null,
  getLabel: (node: Node) => string | number | null,
  getPosition: (node: Node) => [number, number] | null | undefined,
  state: RankAggregateState
) {
  const {aggregates, range} = state;
  const rank = getRank(node);
  if (typeof rank !== 'number' || !Number.isFinite(rank)) {
    return;
  }

  const position = getPosition(node);
  if (!position) {
    return;
  }

  const [, y] = position;
  if (typeof y !== 'number' || !Number.isFinite(y)) {
    return;
  }

  const entry = aggregates.get(rank) ?? {sum: 0, count: 0, label: null};
  entry.sum += y;
  entry.count += 1;

  if (entry.label === null) {
    const label = getLabel(node);
    if (label !== null) {
      entry.label = label;
    }
  }

  aggregates.set(rank, entry);
  range.min = Math.min(range.min, y);
  range.max = Math.max(range.max, y);
}

function normalizeRankAccessor(accessor: RankAccessor | undefined): (node: Node) => number | null {
  if (!accessor) {
    return (node: Node) => {
      const value = node.getPropertyValue('srank');
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
  }

  if (typeof accessor === 'function') {
    return (node: Node) => {
      const value = accessor(node);
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
  }

  return (node: Node) => {
    const value = node.getPropertyValue(accessor);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };
}

function normalizeLabelAccessor(accessor: LabelAccessor | undefined): (node: Node) => string | number | null {
  if (!accessor) {
    return (node: Node) => {
      const value = node.getPropertyValue('rankLabel');
      if (value === undefined || value === null || value === '') {
        return null;
      }
      if (typeof value === 'number' || typeof value === 'string') {
        return value;
      }
      return null;
    };
  }

  if (typeof accessor === 'function') {
    return (node: Node) => {
      const value = accessor(node);
      if (value === undefined || value === null || value === '') {
        return null;
      }
      if (typeof value === 'number' || typeof value === 'string') {
        return value;
      }
      return null;
    };
  }

  return (node: Node) => {
    const value = node.getPropertyValue(accessor);
    if (value === undefined || value === null || value === '') {
      return null;
    }
    if (typeof value === 'number' || typeof value === 'string') {
      return value;
    }
    return null;
  };
}

/**
 * Builds a mapping from rank identifiers to averaged y positions.
 */
export function mapRanksToYPositions(
  nodes: Iterable<Node>,
  getPosition: (node: Node) => [number, number] | null | undefined,
  options?: MapRanksToYPositionsOptions
): RankPosition[] {
  const getRank = normalizeRankAccessor(options?.rankAccessor);
  const getLabel = normalizeLabelAccessor(options?.labelAccessor);

  const state: RankAggregateState = {
    aggregates: new Map<number, RankAggregate>(),
    range: {min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY}
  };

  for (const node of nodes) {
    accumulateRank(node, getRank, getLabel, getPosition, state);
  }

  const {aggregates, range} = state;
  const positions: RankPosition[] = Array.from(aggregates.entries()).map(([rank, {sum, count, label}]) => ({
    rank,
    yPosition: count ? sum / count : 0,
    label: label ?? rank
  }));

  positions.sort((a, b) => a.rank - b.rank);

  const needsRemap = positions.some((entry, index) => index > 0 && entry.yPosition <= positions[index - 1].yPosition);
  if (needsRemap) {
    if (positions.length > 0 && Number.isFinite(range.min)) {
      positions[0].yPosition = Math.min(positions[0].yPosition, range.min);
    }
    let previous = positions.length > 0 ? positions[0].yPosition : 0;
    for (let i = 1; i < positions.length - 1; i++) {
      const current = positions[i].yPosition;
      if (current <= previous) {
        positions[i].yPosition = previous;
      } else {
        previous = current;
      }
    }
    if (positions.length > 1) {
      const last = positions[positions.length - 1];
      const maxTarget = Number.isFinite(range.max) ? range.max : last.yPosition;
      last.yPosition = Math.max(last.yPosition, previous, maxTarget);
    }
  }

  return positions;
}

export type SelectRankLinesOptions = {
  yMin: number;
  yMax: number;
  maxCount?: number;
};

/**
 * Selects a subset of rank positions that are evenly distributed within a range.
 */
export function selectRankLines(
  ranks: RankPosition[],
  {yMin, yMax, maxCount = 8}: SelectRankLinesOptions
): RankPosition[] {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || maxCount <= 0) {
    return [];
  }

  const min = Math.min(yMin, yMax);
  const max = Math.max(yMin, yMax);

  const filtered = ranks
    .filter((entry) => Number.isFinite(entry.yPosition) && entry.yPosition >= min && entry.yPosition <= max)
    .sort((a, b) => a.yPosition - b.yPosition);

  if (filtered.length === 0) {
    return [];
  }

  if (filtered.length <= maxCount) {
    return filtered;
  }

  if (maxCount === 1) {
    return [filtered[Math.floor((filtered.length - 1) / 2)]];
  }

  const lastIndex = filtered.length - 1;
  const step = lastIndex / (maxCount - 1);

  const selectedIndices = new Set<number>();
  for (let i = 0; i < maxCount; i++) {
    const target = Math.round(step * i);
    const clamped = Math.max(0, Math.min(lastIndex, target));
    selectedIndices.add(clamped);
  }

  for (let i = 0; selectedIndices.size < maxCount && i <= lastIndex; i++) {
    selectedIndices.add(i);
  }

  const ordered = Array.from(selectedIndices)
    .sort((a, b) => a - b)
    .slice(0, maxCount);
  return ordered.map((index) => filtered[index]);
}
