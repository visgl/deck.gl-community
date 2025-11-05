// deck.gl-community
// SPDX-License-Identifier: MIT

import {describe, expect, test} from 'vitest';

import {layoutDagAligned} from '../../src/layouts/layout-dag-aligned';

describe('layoutDagAligned', () => {
  test('rank-aligned layers share y', () => {
    const nodes = [
      {id: 'A', step: 0},
      {id: 'B', step: 1},
      {id: 'C', step: 1},
      {id: 'D', step: 2}
    ];
    const links = [
      {source: 'A', target: 'B'},
      {source: 'A', target: 'C'},
      {source: 'B', target: 'D'},
      {source: 'C', target: 'D'}
    ];

    const {nodes: out} = layoutDagAligned(nodes as any, links, {
      rank: (node) => (node as any).step
    });

    const yB = out.find((node) => node.id === 'B')!.y;
    const yC = out.find((node) => node.id === 'C')!.y;
    expect(yB).toBe(yC);
  });

  test('yScale remaps vertical spacing deterministically', () => {
    const nodes = [
      {id: 'A', step: 0},
      {id: 'B', step: 10},
      {id: 'C', step: 20}
    ];
    const links = [
      {source: 'A', target: 'B'},
      {source: 'B', target: 'C'}
    ];

    const {nodes: out} = layoutDagAligned(nodes as any, links, {
      rank: (node) => (node as any).step,
      yScale: (rank) => rank * 100
    });

    expect(out.find((node) => node.id === 'A')!.y).toBe(0);
    expect(out.find((node) => node.id === 'B')!.y).toBe(1000);
    expect(out.find((node) => node.id === 'C')!.y).toBe(2000);
  });

  test('deterministic output for same inputs', () => {
    const nodes = [
      {id: 'A', step: 0},
      {id: 'B', step: 1},
      {id: 'C', step: 2}
    ];
    const links = [
      {source: 'A', target: 'B'},
      {source: 'B', target: 'C'}
    ];

    const r1 = layoutDagAligned(nodes as any, links, {rank: (node) => (node as any).step});
    const r2 = layoutDagAligned(nodes as any, links, {rank: (node) => (node as any).step});

    expect(r1.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
      r2.nodes.map((node) => [node.id, node.x, node.y])
    );
  });
});
