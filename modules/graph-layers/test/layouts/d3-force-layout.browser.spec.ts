// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, test} from 'vitest';
import {D3ForceLayout} from '../../src/layouts/d3-force/d3-force-layout';
import {ClassicGraph} from '../../src/graph/classic-graph';

test('the shipped D3 v1 worker publishes intermediate and final positions', async () => {
  const graph = new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: [{id: 'a'}, {id: 'b'}],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
    }
  });
  const snapshots: number[][] = [];
  let done = false;
  const layout = new D3ForceLayout({
    onLayoutChange: () => snapshots.push([...layout.getNodePosition(graph.findNode('a'))!]),
    onLayoutDone: () => {
      done = true;
    }
  });
  try {
    layout.initializeGraph(graph);
    layout.start();
    await expect.poll(() => done, {timeout: 20_000}).toBe(true);
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]).not.toEqual(snapshots.at(-1));
    expect(snapshots.every(position => position.every(Number.isFinite))).toBe(true);
    expect(layout.getNodePosition(graph.findNode('a'))).toEqual(snapshots.at(-1));
  } finally {
    layout.stop();
  }
}, 30_000);
