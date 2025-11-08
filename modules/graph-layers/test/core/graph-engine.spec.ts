// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {GraphEngine} from '../../src/core/graph-engine';
import type {GraphLayoutEventDetail} from '../../src/core/graph-layout';
import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
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
  const OriginalWorker = globalThis.Worker;

  beforeEach(() => {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = OriginalWorker;
    MockWorker.lastInstance = null;
  });

  it('fires onLayoutStart when GPUForceLayout starts', () => {
    const layout = new GPUForceLayout();
    const graph = new Graph({
      name: 'test',
      nodes: [new Node({id: 'a'}), new Node({id: 'b'})],
      edges: [new Edge({id: 'edge-a-b', sourceId: 'a', targetId: 'b'})]
    });
    const engine = new GraphEngine({graph, layout});
    const onLayoutStart = vi.fn();

    engine.addEventListener('onLayoutStart', onLayoutStart);
    engine.run();

    expect(onLayoutStart).toHaveBeenCalledTimes(1);

    MockWorker.lastInstance?.onmessage?.({
      data: {type: 'end', nodes: [], edges: []}
    });

    engine.stop();
    engine.clear();
  });

  it('updates bounds on each GPU tick event', () => {
    const layout = new GPUForceLayout();
    const graph = new Graph({
      name: 'bounds-test',
      nodes: [new Node({id: 'a'}), new Node({id: 'b'})],
      edges: [new Edge({id: 'edge-a-b', sourceId: 'a', targetId: 'b'})]
    });
    const engine = new GraphEngine({graph, layout});
    const onLayoutChange = vi.fn();

    engine.addEventListener('onLayoutChange', onLayoutChange);
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
    const lastEvent = onLayoutChange.mock.calls.at(-1)?.[0] as CustomEvent<GraphLayoutEventDetail>;
    expect(lastEvent?.detail?.bounds).toEqual([
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
