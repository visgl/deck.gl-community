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
  /** Optional target range for the computed y positions. */
  yRange?: {min?: number; max?: number};
};

type RankAggregate = {sum: number; count: number; label: string | number | null};

type RankAggregateState = {
  aggregates: Map<number, RankAggregate>;
  range: {min: number; max: number};
};

function distributeEvenSpacing(positions: RankPosition[], start: number, end: number) {
  const count = positions.length;
  if (count === 0) {
    return;
  }

  if (count === 1) {
    positions[0].yPosition = start;
    return;
  }

  const step = (end - start) / (count - 1);
  for (let i = 0; i < count; i++) {
    positions[i].yPosition = start + step * i;
  }
}

function fallbackMonotonicSpacing(positions: RankPosition[]) {
  if (positions.length === 0) {
    return;
  }

  let previous = positions[0].yPosition;
  for (let i = 1; i < positions.length; i++) {
    const current = positions[i].yPosition;
    if (!(current > previous)) {
      previous += 1;
      positions[i].yPosition = previous;
    } else {
      previous = current;
    }
  }
}

function enforceMonotonicPositions(
  positions: RankPosition[],
  range: {min: number; max: number}
) {
  if (positions.length === 0) {
    return;
  }

  const hasFiniteMin = Number.isFinite(range.min);
  const hasFiniteMax = Number.isFinite(range.max);

  if (positions.length === 1) {
    if (hasFiniteMin) {
      positions[0].yPosition = range.min;
    }
    return;
  }

  if (hasFiniteMin && hasFiniteMax && range.max > range.min) {
    distributeEvenSpacing(positions, range.min, range.max);
    return;
  }

  if (hasFiniteMin) {
    positions[0].yPosition = range.min;
  }

  fallbackMonotonicSpacing(positions);
}

function resolveTargetRange(
  range: {min: number; max: number},
  override?: {min?: number; max?: number}
): {min: number; max: number} {
  const overrideMin = typeof override?.min === 'number' && Number.isFinite(override.min) ? override.min : undefined;
  const overrideMax = typeof override?.max === 'number' && Number.isFinite(override.max) ? override.max : undefined;

  const candidateMin = overrideMin ?? range.min;
  const candidateMax = overrideMax ?? range.max;

  const min = Number.isFinite(candidateMin) ? candidateMin : range.min;
  const max = Number.isFinite(candidateMax) ? candidateMax : range.max;

  return {min, max};
}

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

  const needsRemap = positions.some(
    (entry, index) => index > 0 && entry.yPosition <= positions[index - 1].yPosition
  );
  if (needsRemap) {
    const targetRange = resolveTargetRange(range, options?.yRange);
    enforceMonotonicPositions(positions, targetRange);
  }

  return positions;
}

export type SelectRankLinesOptions = {
  yMin: number;
  yMax: number;
  maxCount?: number;
};

function locateInsertionIndex(ranks: RankPosition[], target: number): number {
  let low = 0;
  let high = ranks.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (ranks[mid].yPosition < target) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function pickNearestAvailableIndex(
  ranks: RankPosition[],
  target: number,
  startIndex: number,
  used: Set<number>
): number {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  const consider = (index: number) => {
    if (index < 0 || index >= ranks.length || used.has(index)) {
      return;
    }
    const distance = Math.abs(ranks[index].yPosition - target);
    const isCloser = distance < bestDistance;
    const isTie = distance === bestDistance && bestIndex !== -1;
    if (isCloser || (isTie && (ranks[index].yPosition < ranks[bestIndex].yPosition || index < bestIndex))) {
      bestDistance = distance;
      bestIndex = index;
    }
  };

  consider(startIndex);
  consider(startIndex - 1);

  for (let offset = 1; bestIndex === -1 && (startIndex - offset >= 0 || startIndex + offset < ranks.length); offset++) {
    consider(startIndex - offset);
    consider(startIndex + offset);
  }

  return bestIndex;
}

function findFallbackIndex(ranks: RankPosition[], used: Set<number>): number {
  for (let i = 0; i < ranks.length; i++) {
    if (!used.has(i)) {
      return i;
    }
  }
  return -1;
}

function findClosestAvailableIndex(
  ranks: RankPosition[],
  target: number,
  used: Set<number>
): number {
  if (ranks.length === 0) {
    return -1;
  }

  const insertionIndex = locateInsertionIndex(ranks, target);
  const nearest = pickNearestAvailableIndex(ranks, target, insertionIndex, used);
  if (nearest !== -1) {
    return nearest;
  }

  const fallback = findFallbackIndex(ranks, used);
  if (fallback !== -1) {
    return fallback;
  }

  return Math.min(Math.max(insertionIndex, 0), ranks.length - 1);
}

function computeTargetRatios(count: number): number[] {
  if (count <= 1) {
    return [0.5];
  }
  const step = 1 / (count - 1);
  return Array.from({length: count}, (_, index) => index * step);
}

function fillRemainingSelections(used: Set<number>, lastIndex: number, maxCount: number) {
  for (let i = 0; used.size < maxCount && i <= lastIndex; i++) {
    used.add(i);
  }
}

function chooseEvenlySpacedIndices(ranks: RankPosition[], maxCount: number): number[] {
  const lastIndex = ranks.length - 1;
  const start = ranks[0].yPosition;
  const end = ranks[lastIndex].yPosition;
  const span = end - start;
  const used = new Set<number>();

  for (const ratio of computeTargetRatios(maxCount)) {
    const target = span !== 0 ? start + ratio * span : start;
    const index = findClosestAvailableIndex(ranks, target, used);
    if (index !== -1) {
      used.add(index);
    }
  }

  fillRemainingSelections(used, lastIndex, maxCount);

  return Array.from(used).sort((a, b) => a - b).slice(0, maxCount);
}

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
    const midpoint = (filtered[0].yPosition + filtered[filtered.length - 1].yPosition) / 2;
    const index = findClosestAvailableIndex(filtered, midpoint, new Set<number>());
    return index === -1 ? [filtered[0]] : [filtered[index]];
  }

  const selected = chooseEvenlySpacedIndices(filtered, maxCount);
  return selected.map((index) => filtered[index]);
}

