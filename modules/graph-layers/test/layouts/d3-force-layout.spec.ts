// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';

import {D3ForceLayout} from '../../src/layouts/d3-force/d3-force-layout';
import {ClassicGraph} from '../../src/graph/classic-graph';

class FakeWorker {
  static latest: FakeWorker | null = null;

  onmessage: ((event: {data: unknown}) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor(_url: string) {
    FakeWorker.latest = this;
  }

  emit(data: unknown): void {
    this.onmessage?.({data});
  }
}

function createGraph(): ClassicGraph {
  return new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: [{id: 'a'}, {id: 'b'}],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
    }
  });
}

describe('D3ForceLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.latest = null;
  });

  it('streams worker tick positions before the final layout event', () => {
    vi.stubGlobal('Worker', FakeWorker);

    const events: string[] = [];
    const graph = createGraph();
    const layout = new D3ForceLayout({
      onLayoutStart: () => events.push('start'),
      onLayoutChange: () => events.push('change'),
      onLayoutDone: () => events.push('done')
    });

    layout.initializeGraph(graph);
    layout.start();

    const worker = FakeWorker.latest;
    expect(worker).not.toBeNull();
    expect(events).toEqual(['start']);

    worker?.emit({
      type: 'tick',
      nodes: [
        {id: 'a', x: 1, y: 2},
        {id: 'b', x: 3, y: 4}
      ]
    });

    const nodeA = graph.findNode('a');
    const nodeB = graph.findNode('b');
    const edge = Array.from(graph.getEdges())[0];

    expect(events).toEqual(['start', 'change']);
    expect(layout.getNodePosition(nodeA ?? null)).toEqual([1, 2]);
    expect(layout.getNodePosition(nodeB ?? null)).toEqual([3, 4]);
    expect(layout.getEdgePosition(edge)?.sourcePosition).toEqual([1, 2]);
    expect(layout.getEdgePosition(edge)?.targetPosition).toEqual([3, 4]);
    expect(layout.getBounds()).toEqual([
      [1, 2],
      [3, 4]
    ]);

    worker?.emit({
      type: 'end',
      nodes: [
        {id: 'a', x: 5, y: 6},
        {id: 'b', x: 7, y: 8}
      ]
    });

    expect(events).toEqual(['start', 'change', 'change', 'done']);
    expect(layout.getNodePosition(nodeA ?? null)).toEqual([5, 6]);
    expect(layout.getNodePosition(nodeB ?? null)).toEqual([7, 8]);
    expect(layout.getBounds()).toEqual([
      [5, 6],
      [7, 8]
    ]);
  });
});
