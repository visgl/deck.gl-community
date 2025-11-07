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

  const aggregates = new Map<number, {sum: number; count: number; label: string | number | null}>();

  for (const node of nodes) {
    const rank = getRank(node);
    if (!Number.isFinite(rank)) {
      continue;
    }

    const position = getPosition(node);
    if (!position) {
      continue;
    }

    const [, y] = position;
    if (!Number.isFinite(y)) {
      continue;
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
  }

  const positions: RankPosition[] = Array.from(aggregates.entries()).map(([rank, {sum, count, label}]) => ({
    rank,
    yPosition: count ? sum / count : 0,
    label: label ?? rank
  }));

  positions.sort((a, b) => a.rank - b.rank);

  const sortedY = positions.map((entry) => entry.yPosition).sort((a, b) => a - b);
  let needsRemap = false;
  for (let i = 0; i < positions.length; i++) {
    if (positions[i].yPosition !== sortedY[i]) {
      needsRemap = true;
      break;
    }
  }
  if (needsRemap) {
    for (let i = 0; i < positions.length; i++) {
      positions[i].yPosition = sortedY[i];
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
    return [filtered[Math.round((filtered.length - 1) / 2)]];
  }

  const lastIndex = filtered.length - 1;
  const step = lastIndex / (maxCount - 1);

  const selectedIndices = new Set<number>();
  for (let i = 0; i < maxCount; i++) {
    const target = Math.round(step * i);
    const index = Math.max(0, Math.min(lastIndex, target));
    if (!selectedIndices.has(index)) {
      selectedIndices.add(index);
      continue;
    }

    // Resolve collisions by probing nearby indices.
    let offset = 1;
    let resolved = false;
    while (!resolved && offset <= lastIndex) {
      const left = index - offset;
      if (left >= 0 && !selectedIndices.has(left)) {
        selectedIndices.add(left);
        resolved = true;
        break;
      }
      const right = index + offset;
      if (right <= lastIndex && !selectedIndices.has(right)) {
        selectedIndices.add(right);
        resolved = true;
        break;
      }
      offset += 1;
    }

    if (!resolved) {
      // Fallback: add index modulo length.
      for (let probe = 0; probe <= lastIndex; probe++) {
        if (!selectedIndices.has(probe)) {
          selectedIndices.add(probe);
          break;
        }
      }
    }
  }

  const ordered = Array.from(selectedIndices).sort((a, b) => a - b);
  return ordered.map((index) => filtered[index]);
}
