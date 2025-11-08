// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {GraphEngine} from '../../src/core/graph-engine';
import {Graph} from '../../src/graph/graph';
import {Node} from '../../src/graph/node';
import {Edge} from '../../src/graph/edge';
import {GraphLayout, type GraphLayoutProps} from '../../src/core/graph-layout';

type EngineLayoutProps = GraphLayoutProps & {
  scale?: number;
};

class EngineTestLayout extends GraphLayout<EngineLayoutProps> {
  static defaultProps: Required<EngineLayoutProps> = {
    scale: 1
  } as const;

  public initializeGraphCalls = 0;
  public updateGraphCalls = 0;
  public updateCalls = 0;

  constructor(props: EngineLayoutProps = {}) {
    super(props, EngineTestLayout.defaultProps);
  }

  initializeGraph(_graph: Graph): void {
    this.initializeGraphCalls += 1;
  }

  protected override updateGraph(_graph: Graph): void {
    this.updateGraphCalls += 1;
  }

  start(): void {}

  update(): void {
    this.updateCalls += 1;
  }

  resume(): void {}

  stop(): void {}

  getNodePosition(_node: Node): [number, number] {
    return [0, 0];
  }

  getEdgePosition(_edge: Edge) {
    return {
      type: 'line',
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [] as [number, number][]
    };
  }

  lockNodePosition(_node: Node, _x: number, _y: number): void {}

  unlockNodePosition(_node: Node): void {}

  protected override _shouldRecompute(
    _previous: Readonly<Required<EngineLayoutProps>>,
    next: Readonly<Required<EngineLayoutProps>>,
    changedKeys: (keyof EngineLayoutProps)[]
  ): boolean {
    if (changedKeys.includes('scale')) {
      return next.scale > 2;
    }
    return super._shouldRecompute(_previous, next, changedKeys);
  }
}

function createGraph(): Graph {
  return new Graph({
    name: 'test',
    nodes: [new Node({id: 'n1'})],
    edges: []
  });
}

describe('core/graph-engine', () => {
  it('reruns the layout when props invalidate the layout', () => {
    const layout = new EngineTestLayout();
    const engine = new GraphEngine({graph: createGraph(), layout});

    engine.run();
    expect(layout.initializeGraphCalls).toBe(1);

    layout.setProps({scale: 3});

    expect(layout.updateGraphCalls).toBe(1);
    expect(layout.updateCalls).toBe(1);

    engine.clear();
  });

  it('skips recomputation when setProps reports no recompute needed', () => {
    const layout = new EngineTestLayout({scale: 2});
    const engine = new GraphEngine({graph: createGraph(), layout});

    engine.run();

    layout.setProps({scale: 2});
    expect(layout.updateGraphCalls).toBe(0);
    expect(layout.updateCalls).toBe(0);

    layout.setProps({scale: 3});
    expect(layout.updateGraphCalls).toBe(1);
    expect(layout.updateCalls).toBe(1);

    engine.clear();
  });
});
