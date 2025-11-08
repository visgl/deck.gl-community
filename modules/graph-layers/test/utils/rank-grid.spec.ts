// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {Node} from '../../src/graph/node';
import {
  mapRanksToYPositions,
  selectRankLines,
  type RankPosition
} from '../../src/utils/rank-grid';

describe('rank-grid utilities', () => {
  const createNode = (id: string | number, rank: number, y: number, label?: string) => {
    const node = new Node({
      id,
      data: {
        srank: rank,
        rankLabel: label
      }
    });
    return {node, position: [0, y] as [number, number]};
  };

  it('maps ranks to averaged y positions and preserves monotonic ordering', () => {
    const entries = [
      createNode('a', 2, 30, 'two'),
      createNode('b', 1, 10, 'one'),
      createNode('c', 2, 40),
      createNode('d', 3, 20, 'three')
    ];

    const nodes = entries.map((entry) => entry.node);
    const positions = new Map<Node, [number, number]>(entries.map((entry) => [entry.node, entry.position]));

    const ranks = mapRanksToYPositions(nodes, (node) => positions.get(node) ?? null);

    expect(ranks.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(ranks.map((entry) => entry.label)).toEqual(['one', 'two', 'three']);
    expect(ranks.map((entry) => entry.yPosition)).toEqual([10, 25, 40]);
  });

  it('distributes overlapping ranks evenly across the layout bounds', () => {
    const entries = [
      createNode('a', 0, 0),
      createNode('b', 1, 10),
      createNode('c', 2, 10),
      createNode('d', 3, 30)
    ];

    const nodes = entries.map((entry) => entry.node);
    const positions = new Map<Node, [number, number]>(entries.map((entry) => [entry.node, entry.position]));

    const ranks = mapRanksToYPositions(nodes, (node) => positions.get(node) ?? null);

    expect(ranks.map((entry) => entry.rank)).toEqual([0, 1, 2, 3]);
    expect(ranks.map((entry) => entry.yPosition)).toEqual([0, 10, 20, 30]);
  });

  it('selects rank lines within a range and limits the output count', () => {
    const ranks: RankPosition[] = Array.from({length: 10}, (_, index) => ({
      rank: index,
      yPosition: index * 10,
      label: index
    }));

    const selected = selectRankLines(ranks, {yMin: 0, yMax: 90, maxCount: 5});
    expect(selected.map((entry) => entry.yPosition)).toEqual([0, 20, 40, 70, 90]);

    const narrowed = selectRankLines(ranks, {yMin: 15, yMax: 65, maxCount: 3});
    expect(narrowed.map((entry) => entry.yPosition)).toEqual([20, 40, 60]);

    const single = selectRankLines(ranks, {yMin: 0, yMax: 90, maxCount: 1});
    expect(single).toHaveLength(1);
    expect(single[0].yPosition).toBe(40);
  });
  it('retains interior ranks when spacing is uneven', () => {
    const ranks: RankPosition[] = [
      {rank: 0, yPosition: 0, label: 0},
      {rank: 1, yPosition: 5, label: 1},
      {rank: 2, yPosition: 10, label: 2},
      {rank: 3, yPosition: 20, label: 3},
      {rank: 4, yPosition: 30, label: 4},
      {rank: 5, yPosition: 40, label: 5},
      {rank: 6, yPosition: 50, label: 6}
    ];
    const selected = selectRankLines(ranks, {yMin: 0, yMax: 50, maxCount: 4});
    expect(selected.map((entry) => entry.yPosition)).toEqual([0, 20, 30, 50]);
  });

});
