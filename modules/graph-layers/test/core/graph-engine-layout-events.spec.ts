// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {afterEach, describe, expect, it, vi} from 'vitest';
import {GraphEngine} from '../../src/core/graph-engine';
import {D3ForceLayout} from '../../src/layouts/d3-force/d3-force-layout';
import {ClassicGraph} from '../../src/graph/classic-graph';
import {Node} from '../../src/graph/node';

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

describe('GraphEngine D3 lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts before dispatch, publishes geometry before callbacks, and resumes from cached positions', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const graph = new ClassicGraph({data: {shape: 'plain-graph-data', nodes: [{id: 'a'}]}});
    const layout = new D3ForceLayout({alpha: 0.4, resumeAlpha: 0.05});
    const events: string[] = [];
    const engine = new GraphEngine({
      graph,
      layout,
      onLayoutStart: () => {
        events.push('start');
        expect(FakeWorker.latest.postMessage).not.toHaveBeenCalled();
        expect(layout.state).toBe('calculating');
      },
      onLayoutChange: () => {
        events.push('change');
        expect(engine.getNodePosition(graph.findNode('a')!)).toEqual([1, 2]);
        expect(layout.getBounds()![0]).toEqual([1, 2]);
      },
      onLayoutDone: () => events.push('done')
    });
    engine.run();
    const first = FakeWorker.latest;
    expect(first.postMessage.mock.calls[0][0].options.alpha).toBe(0.4);
    first.emit({type: 'tick', nodes: [{id: 'a', x: 1, y: 2}]});
    first.emit({type: 'end', nodes: [{id: 'a', x: 1, y: 2}]});
    expect(events).toEqual(['start', 'change', 'change', 'done']);
    expect(first.terminate).toHaveBeenCalledOnce();
    engine.resume();
    const resumed = FakeWorker.latest;
    expect(resumed).not.toBe(first);
    expect(resumed.postMessage.mock.calls[0][0]).toMatchObject({
      nodes: [{id: 'a', x: 1, y: 2}],
      options: {alpha: 0.05}
    });
    resumed.emit({type: 'end', nodes: [{id: 'a', x: 1, y: 2}]});
    expect(events.slice(-3)).toEqual(['start', 'change', 'done']);
    events.length = 0;
    graph.addNode(new Node({id: 'b'}));
    expect(events).toEqual(['start']);
    expect(FakeWorker.latest.postMessage.mock.calls[0][0].nodes).toHaveLength(2);
    expect(FakeWorker.latest.postMessage.mock.calls[0][0].options.alpha).toBe(0.4);
    engine.stop();
    engine.clear();
  });

  it('allows a start callback to cancel dispatch and does not create workers without a graph', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const onLayoutStart = vi.fn(() => layout.stop());
    const layout = new D3ForceLayout({onLayoutStart});
    layout.start();
    expect(onLayoutStart).not.toHaveBeenCalled();
    layout.initializeGraph(new ClassicGraph({data: {shape: 'plain-graph-data', nodes: []}}));
    layout.start();
    expect(onLayoutStart).toHaveBeenCalledOnce();
    expect(FakeWorker.latest.postMessage).not.toHaveBeenCalled();
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});
