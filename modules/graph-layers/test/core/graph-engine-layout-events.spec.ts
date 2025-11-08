// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import type {Bounds2D} from '@math.gl/types';

import {GraphEngine} from '../../src/core/graph-engine';
import {GraphLayout, type GraphLayoutEventDetail} from '../../src/core/graph-layout';
import type {Graph, EdgeInterface, NodeInterface} from '../../src/graph/graph';
import type {GraphStyleEngine, GraphStylesheet} from '../../src/style/graph-style-engine';

class TestGraph extends EventTarget implements Graph {
  version = 0;

  constructor(
    private readonly nodes: NodeInterface[] = [],
    private readonly edges: EdgeInterface[] = []
  ) {
    super();
  }

  getNodes(): Iterable<NodeInterface> {
    return this.nodes;
  }

  getEdges(): Iterable<EdgeInterface> {
    return this.edges;
  }

  // eslint-disable-next-line class-methods-use-this
  createStylesheetEngine(_style: GraphStylesheet, _options?: {stateUpdateTrigger?: unknown}): GraphStyleEngine {
    throw new Error('Not implemented in tests.');
  }
}

class LifecycleLayout extends GraphLayout {
  public startCalls = 0;
  public updateCalls = 0;
  public resumeCalls = 0;
  public updateGraphCalls = 0;

  constructor() {
    super({}, {});
  }

  initializeGraph(): void {}

  updateGraph(): void {
    this.updateGraphCalls += 1;
  }

  start(): void {
    this.startCalls += 1;
    this._emitLifecycleCycle();
  }

  update(): void {
    this.updateCalls += 1;
    this._emitLifecycleCycle();
  }

  resume(): void {
    this.resumeCalls += 1;
    this._emitLifecycleCycle();
  }

  stop(): void {}

  private _emitLifecycleCycle() {
    this._onLayoutStart();
    this._onLayoutChange();
    this._onLayoutDone();
  }
}

type CapturedEvent = {
  type: 'start' | 'change' | 'done';
  bounds?: Bounds2D | null;
};

function recordEngineEvents(engine: GraphEngine): CapturedEvent[] {
  const events: CapturedEvent[] = [];
  const handler = (type: CapturedEvent['type']) => (event: Event) => {
    const detail = event instanceof CustomEvent ? (event.detail as GraphLayoutEventDetail) : undefined;
    events.push({type, bounds: detail?.bounds});
  };

  engine.addEventListener('onLayoutStart', handler('start'));
  engine.addEventListener('onLayoutChange', handler('change'));
  engine.addEventListener('onLayoutDone', handler('done'));

  return events;
}

describe('GraphEngine layout lifecycle events', () => {
  it('emits start/change/done in order on initial run', () => {
    const graph = new TestGraph();
    const layout = new LifecycleLayout();
    const engine = new GraphEngine({graph, layout});

    const events = recordEngineEvents(engine);

    engine.run();

    expect(events.map((event) => event.type)).toEqual(['start', 'change', 'done']);
    expect(layout.startCalls).toBe(1);
    expect(layout.updateCalls).toBe(0);
    expect(layout.resumeCalls).toBe(0);
  });

  it('emits start/change/done when the graph updates', () => {
    const graph = new TestGraph();
    const layout = new LifecycleLayout();
    const engine = new GraphEngine({graph, layout});

    const events = recordEngineEvents(engine);

    engine.run();
    events.length = 0;

    graph.dispatchEvent(new Event('onNodeAdded'));

    expect(layout.updateGraphCalls).toBe(1);
    expect(layout.updateCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['start', 'change', 'done']);
  });

  it('emits start/change/done when resuming the layout', () => {
    const graph = new TestGraph();
    const layout = new LifecycleLayout();
    const engine = new GraphEngine({graph, layout});

    const events = recordEngineEvents(engine);

    engine.run();
    events.length = 0;

    engine.resume();

    expect(layout.resumeCalls).toBe(1);
    expect(events.map((event) => event.type)).toEqual(['start', 'change', 'done']);
  });
});
