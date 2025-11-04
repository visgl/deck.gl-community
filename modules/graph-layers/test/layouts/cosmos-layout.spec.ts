// deck.gl-community
// SPDX-License-Identifier: MIT

import {beforeEach, describe, expect, it, vi} from 'vitest';

import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {CosmosLayout} from '../../src/layouts/experimental/cosmos-layout';

vi.mock('cosmos.gl', () => {
  type Handler = () => void;
  type HandlerMap = Record<'start' | 'tick' | 'end', Set<Handler>>;

  const instances: any[] = [];

  class MockCosmos {
    handlers: HandlerMap = {
      start: new Set(),
      tick: new Set(),
      end: new Set()
    };
    graph = {nodes: [], edges: []} as any;
    options: Record<string, unknown> = {};
    locked = new Map<string | number, {x: number; y: number}>();

    constructor(options?: Record<string, unknown>) {
      if (options) {
        this.options = {...options};
      }
      instances.push(this);
    }

    setOptions(options?: Record<string, unknown>) {
      this.options = {...(options ?? {})};
    }

    setGraph(graph: any) {
      this.graph = {
        nodes: graph.nodes.map((node: any) => ({...node})),
        edges: graph.edges.map((edge: any) => ({...edge}))
      };
    }

    start() {
      this.handlers.start.forEach((handler) => handler());
      this._simulateTick();
      this.handlers.tick.forEach((handler) => handler());
      this.handlers.end.forEach((handler) => handler());
    }

    resume() {
      this.start();
    }

    stop() {}

    destroy() {}

    on(event: 'start' | 'tick' | 'end', handler: Handler) {
      this.handlers[event].add(handler);
    }

    off(event: 'start' | 'tick' | 'end', handler: Handler) {
      this.handlers[event].delete(handler);
    }

    getNodePosition(id: string | number) {
      const node = this.graph.nodes.find((candidate: any) => candidate.id === id);
      return node?.position ?? null;
    }

    lockNode(id: string | number, position?: {x: number; y: number}) {
      const coords = position ?? {x: 0, y: 0};
      this.locked.set(id, {...coords});
      const node = this.graph.nodes.find((candidate: any) => candidate.id === id);
      if (node) {
        node.position = {...coords};
      }
    }

    unlockNode(id: string | number) {
      this.locked.delete(id);
    }

    private _simulateTick() {
      this.graph.nodes.forEach((node: any, index: number) => {
        const locked = this.locked.get(node.id);
        if (locked) {
          node.position = {...locked};
          return;
        }
        const x = index * 12;
        const y = index === 0 ? 0 : -index * 7;
        node.position = {x, y};
      });
    }
  }

  return {
    createCosmosLayout: (options?: Record<string, unknown>) => new MockCosmos(options),
    __getMockInstances: () => instances,
    __resetMockInstances: () => {
      instances.splice(0, instances.length);
    }
  };
});

async function loadMockCosmosModule() {
  return (await import('cosmos.gl')) as any;
}

beforeEach(async () => {
  const cosmosModule = await loadMockCosmosModule();
  cosmosModule.__resetMockInstances();
});

describe('CosmosLayout', () => {
  it('runs the cosmos.gl layout and exposes updated positions', async () => {
    const nodes = ['a', 'b', 'c'].map((id) => new Node({id}));
    const edges = [
      new Edge({id: 'ab', sourceId: 'a', targetId: 'b'}),
      new Edge({id: 'bc', sourceId: 'b', targetId: 'c'})
    ];
    const graph = new Graph({nodes, edges});

    const layout = new CosmosLayout({cosmos: {cooldownTicks: 42}});
    const onStart = vi.fn();
    const onUpdate = vi.fn();
    const onDone = vi.fn();

    layout.addEventListener('onLayoutStart', onStart);
    layout.addEventListener('onLayoutChange', onUpdate);
    layout.addEventListener('onLayoutDone', onDone);

    layout.initializeGraph(graph);
    layout.start();

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);

    expect(layout.getNodePosition(nodes[0])).toEqual([0, 0]);
    expect(layout.getNodePosition(nodes[1])).toEqual([12, -7]);
    expect(layout.getNodePosition(nodes[2])).toEqual([24, -14]);

    const edgeAB = layout.getEdgePosition(edges[0]);
    expect(edgeAB).toEqual({
      type: 'line',
      sourcePosition: [0, 0],
      targetPosition: [12, -7],
      controlPoints: []
    });

    const cosmosModule = await loadMockCosmosModule();
    const mockInstance = cosmosModule.__getMockInstances().at(-1);
    expect(mockInstance.options).toEqual({cooldownTicks: 42});
  });

  it('locks nodes through the cosmos controller', async () => {
    const nodes = ['p', 'q'].map((id) => new Node({id}));
    const edges = [new Edge({id: 'pq', sourceId: 'p', targetId: 'q'})];
    const graph = new Graph({nodes, edges});

    const layout = new CosmosLayout();
    layout.initializeGraph(graph);
    layout.start();

    layout.lockNodePosition(nodes[0], 120, -36);

    expect(layout.getNodePosition(nodes[0])).toEqual([120, -36]);

    const cosmosModule = await loadMockCosmosModule();
    const mockInstance = cosmosModule.__getMockInstances().at(-1);
    expect(mockInstance.locked.get('p')).toEqual({x: 120, y: -36});
  });
});
