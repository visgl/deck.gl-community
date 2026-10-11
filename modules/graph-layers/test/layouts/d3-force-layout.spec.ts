// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as d3 from 'd3-force';

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
  it('uses the configured alpha in the actual worker loop', () => {
    const snapshots: any[] = [];
    const context = {
      d3,
      performance: {now: () => 0},
      importScripts: vi.fn(),
      postMessage: (data: unknown) => snapshots.push(structuredClone(data)),
      self: {close: vi.fn()},
      onmessage: null as ((event: unknown) => void) | null
    };
    runInNewContext(
      readFileSync(new URL('../../src/layouts/d3-force/worker.js', import.meta.url), 'utf8'),
      context
    );
    context.onmessage!({
      data: {
        nodes: [{id: 'a'}, {id: 'b'}],
        edges: [],
        options: {
          alpha: 0,
          nBodyStrength: -900,
          nBodyDistanceMin: 1,
          nBodyDistanceMax: 400,
          getCollisionRadius: 0
        }
      }
    });
    expect(snapshots.map(snapshot => snapshot.type)).toEqual(['end']);
    expect(
      snapshots[0].nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))
    ).toBe(true);
  });

  it('posts changing finite positions from the actual worker loop', () => {
    const messages: any[] = [];
    const close = vi.fn();
    const context = {
      d3,
      performance: {
        now: vi
          .fn()
          .mockImplementationOnce(() => 0)
          .mockImplementationOnce(() => 1)
          .mockImplementation(() => 32)
      },
      importScripts: vi.fn(),
      postMessage: (data: unknown) => messages.push(structuredClone(data)),
      self: {close},
      onmessage: null as ((event: unknown) => void) | null
    };
    const source = readFileSync(
      new URL('../../src/layouts/d3-force/worker.js', import.meta.url),
      'utf8'
    );
    runInNewContext(source, context);
    context.onmessage!({
      data: {
        nodes: [{id: 'a'}, {id: 'b'}],
        edges: [{id: 'ab', source: 'a', target: 'b'}],
        options: {
          nBodyStrength: -900,
          nBodyDistanceMin: 100,
          nBodyDistanceMax: 400,
          getCollisionRadius: 0
        }
      }
    });
    const ticks = messages.filter(message => message.type === 'tick');
    expect(ticks.length).toBeGreaterThan(1);
    expect(ticks).toHaveLength(2);
    expect(ticks[0].nodes).not.toEqual(ticks.at(-1).nodes);
    expect(
      ticks.every(message =>
        message.nodes.every(node => Number.isFinite(node.x) && Number.isFinite(node.y))
      )
    ).toBe(true);
    expect(ticks.every(message => !('edges' in message))).toBe(true);
    expect(ticks.at(-1).progress).toBeLessThan(1);
    expect(messages.at(-1).type).toBe('end');
    expect(messages.at(-1).nodes).not.toEqual(ticks.at(-1).nodes);
    expect(close).toHaveBeenCalledOnce();
  });

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
    expect(worker?.terminate).toHaveBeenCalledOnce();
    worker?.emit({type: 'tick', nodes: [{id: 'a', x: 99, y: 99}]});
    expect(events).toEqual(['start', 'change', 'change', 'done']);
    expect(layout.getNodePosition(nodeA ?? null)).toEqual([5, 6]);
    expect(layout.getNodePosition(nodeB ?? null)).toEqual([7, 8]);
    expect(layout.getBounds()).toEqual([
      [5, 6],
      [7, 8]
    ]);
  });
  it('ignores queued messages after stopping or replacing a worker', () => {
    vi.stubGlobal('Worker', FakeWorker);
    const graph = createGraph();
    const onLayoutChange = vi.fn();
    const layout = new D3ForceLayout({onLayoutChange});
    layout.initializeGraph(graph);
    layout.start();
    const first = FakeWorker.latest!;
    layout.update();
    first.emit({type: 'tick', nodes: [{id: 'a', x: 99, y: 99}]});
    expect(onLayoutChange).not.toHaveBeenCalled();
    const second = FakeWorker.latest!;
    layout.stop();
    second.emit({type: 'end', nodes: [{id: 'a', x: 99, y: 99}]});
    expect(onLayoutChange).not.toHaveBeenCalled();
    expect(layout.getNodePosition(graph.findNode('a'))).toBeNull();
  });
});
