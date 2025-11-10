// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {beforeAll, describe, expect, it} from 'vitest';

type ForceLinkFn = (
  nodes: number[][],
  edges: number[][],
  currentNode: number[],
  nodesSize: number,
  edgesSize: number,
  radius: number
) => [number, number];

let forceLink: ForceLinkFn;

beforeAll(async () => {
  await import('../../../src/layouts/gpu-force/worker.js');
  const testExports = (globalThis as unknown as {
    __GPU_FORCE_WORKER_TEST__?: {forceLink: ForceLinkFn};
  }).__GPU_FORCE_WORKER_TEST__;

  if (!testExports) {
    throw new Error('GPU force worker test exports are not available');
  }

  forceLink = testExports.forceLink;
});

describe('layouts/gpu-force worker forceLink', () => {
  it('indexes nodes by node id instead of edge index', () => {
    const nodes = [
      [1, 0, 0],
      [2, 1, 1]
    ];
    const edges = [
      [1, 2],
      [2, 1],
      [1, 2]
    ];
    const currentNode = [...nodes[0]];

    const result = forceLink(nodes, edges, currentNode, nodes.length, edges.length, 0);

    expect(result).toHaveLength(2);
    expect(result.every((value) => Number.isFinite(value))).toBe(true);
  });
});
