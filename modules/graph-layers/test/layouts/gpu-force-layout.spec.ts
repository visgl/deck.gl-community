// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {GPUForceLayout} from '../../src/layouts/gpu-force/gpu-force-layout';
import {GraphEngine} from '../../src/core/graph-engine';
import {ClassicGraph} from '../../src/graph/classic-graph';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: {data: unknown}) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
  emit(data: unknown) {
    this.onmessage?.({data});
  }
}
function createGraph() {
  return new ClassicGraph({
    data: {
      shape: 'plain-graph-data',
      nodes: [{id: 'a'}, {id: 'b'}],
      edges: [{id: 'ab', sourceId: 'a', targetId: 'b'}]
    }
  });
}
function createResult(x = 10) {
  const nodes = [
    {id: 'a', x, y: 5},
    {id: 'b', x: 110, y: 105}
  ];
  return {type: 'end', nodes, edges: [{id: 'ab', source: nodes[0], target: nodes[1]}]};
}

describe('GPUForceLayout lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('publishes start and final geometry through GraphEngine, releasing the worker before callbacks', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const graph = createGraph();
    const layout = new GPUForceLayout();
    const events: string[] = [];
    const engine = new GraphEngine({
      graph,
      layout,
      onLayoutStart: () => {
        events.push('start');
        expect(FakeWorker.latest.postMessage).not.toHaveBeenCalled();
      },
      onLayoutChange: detail => {
        events.push('change');
        expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
        expect(detail.bounds).toEqual([
          [10, 5],
          [110, 105]
        ]);
      },
      onLayoutDone: () => events.push('done')
    });
    try {
      engine.run();
      const worker = FakeWorker.latest;
      expect(events).toEqual(['start']);
      expect(worker.postMessage).toHaveBeenCalledOnce();
      worker.emit(createResult());
      expect(events).toEqual(['start', 'change', 'done']);
      expect(engine.getNodePosition(engine.getNodes()[0])).toEqual([10, 5]);
      expect(layout.getEdgePosition(graph.getEdges()[0]).targetPosition).toEqual([110, 105]);
      worker.emit(createResult(999));
      expect(events).toEqual(['start', 'change', 'done']);
      expect(engine.getNodePosition(engine.getNodes()[0])).toEqual([10, 5]);
    } finally {
      engine.stop();
      engine.clear();
    }
  });

  it('emits start for updates and ignores results after replacement or stop', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onLayoutStart = vi.fn();
    const onLayoutChange = vi.fn();
    const layout = new GPUForceLayout({onLayoutStart, onLayoutChange});
    layout.initializeGraph(createGraph());
    layout.start();
    const first = FakeWorker.latest;
    layout.update();
    const second = FakeWorker.latest;
    expect(onLayoutStart).toHaveBeenCalledTimes(2);
    expect(first.terminate).toHaveBeenCalledOnce();
    first.emit(createResult());
    expect(onLayoutChange).not.toHaveBeenCalled();
    layout.stop();
    second.emit(createResult());
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(second.terminate).toHaveBeenCalledOnce();
  });

  it('allows a start callback to cancel submission', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const layout = new GPUForceLayout({onLayoutStart: () => layout.stop()});
    layout.initializeGraph(createGraph());
    layout.start();
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
    expect(FakeWorker.latest.postMessage).not.toHaveBeenCalled();
  });

  it('does not create a worker or emit start before a graph is initialized', () => {
    const worker = vi.fn();
    vi.stubGlobal('Worker', worker);
    const onLayoutStart = vi.fn();
    const layout = new GPUForceLayout({onLayoutStart});
    layout.start();
    expect(worker).not.toHaveBeenCalled();
    expect(onLayoutStart).not.toHaveBeenCalled();
  });
});
