// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import type {GraphLayoutEventDetail} from '../../src/core/graph-layout';
import {GraphEngine} from '../../src/core/graph-engine';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {Edge} from '../../src/graph/edge';
import {Node} from '../../src/graph/node';
import {GPUForceLayout} from '../../src/layouts/gpu-force/gpu-force-layout';

class MockWorker {
  static lastInstance: MockWorker | null = null;

  onmessage: ((event: {data: any}) => void) | null = null;

  constructor(_url: string) {
    MockWorker.lastInstance = this;
  }

  postMessage(_data: unknown) {}

  terminate() {}
}

describe('core/graph-engine', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;
    MockWorker.lastInstance = null;
  });

  it('fires onLayoutStart when GPUForceLayout starts', () => {
    const layout = new GPUForceLayout();
    const graph = createGraph();
    const onLayoutStart = vi.fn();
    const engine = new GraphEngine({graph, layout, onLayoutStart});

    engine.run();

    expect(onLayoutStart).toHaveBeenCalledTimes(1);

    MockWorker.lastInstance?.onmessage?.({
      data: {type: 'end', nodes: [], edges: []}
    });

    engine.stop();
    engine.clear();
  });

  it('updates bounds on each GPUForceLayout tick event', () => {
    const layout = new GPUForceLayout();
    const graph = createGraph();
    const onLayoutChange = vi.fn();
    const engine = new GraphEngine({graph, layout, onLayoutChange});

    engine.run();

    const tickNodes = [
      {id: 'a', x: 10, y: 5, fx: null, fy: null, locked: false, collisionRadius: 0},
      {id: 'b', x: 110, y: 105, fx: null, fy: null, locked: false, collisionRadius: 0}
    ];
    const tickEdges = [
      {
        id: 'edge-a-b',
        source: tickNodes[0],
        target: tickNodes[1]
      }
    ];

    MockWorker.lastInstance?.onmessage?.({
      data: {type: 'tick', nodes: tickNodes, edges: tickEdges}
    });

    expect(onLayoutChange).toHaveBeenCalled();
    const lastEvent = onLayoutChange.mock.calls.at(-1)?.[0] as GraphLayoutEventDetail;
    expect(lastEvent?.bounds).toEqual([
      [10, 5],
      [110, 105]
    ]);

    MockWorker.lastInstance?.onmessage?.({
      data: {type: 'end', nodes: tickNodes, edges: tickEdges}
    });

    engine.stop();
    engine.clear();
  });
});

function createGraph(): ClassicGraph {
  return new ClassicGraph({
    nodes: [new Node({id: 'a'}), new Node({id: 'b'})],
    edges: [new Edge({id: 'edge-a-b', sourceId: 'a', targetId: 'b'})]
  });
}
