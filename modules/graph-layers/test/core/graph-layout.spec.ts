// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {GraphLayout, type GraphLayoutProps} from '../../src/core/graph-layout';
import {LegacyGraph} from '../../src/graph/legacy-graph';

type TestLayoutProps = GraphLayoutProps & {
  foo?: number;
};

class TestLayout extends GraphLayout<TestLayoutProps> {
  static defaultProps = {
    graph: undefined as unknown as LegacyGraph,
    foo: 0
  } as const satisfies Required<TestLayoutProps>;

  public updateGraphCalls = 0;
  public lastGraph: LegacyGraph | null = null;

  constructor(props: TestLayoutProps = {}) {
    super(props, TestLayout.defaultProps);
  }

  initializeGraph(graph: LegacyGraph): void {
    this.setProps({graph});
  }

  protected override updateGraph(graph: LegacyGraph): void {
    this.lastGraph = graph;
    this.updateGraphCalls += 1;
  }

  start(): void {}

  update(): void {}

  resume(): void {}

  stop(): void {}

  getFoo(): number {
    return this.props.foo ?? 0;
  }
}

describe('core/graph-layout#setProps', () => {
  it('merges props and triggers graph updates', () => {
    const layout = new TestLayout();

    expect(layout.setProps({})).toBe(false);

    const fooChanged = layout.setProps({foo: 3});
    expect(fooChanged).toBe(true);
    expect(layout.getFoo()).toBe(3);

    const fooUnchanged = layout.setProps({foo: 3});
    expect(fooUnchanged).toBe(false);

    const graph = new LegacyGraph();
    const firstGraphChange = layout.setProps({graph});
    expect(firstGraphChange).toBe(true);
    expect(layout.updateGraphCalls).toBe(1);
    expect(layout.lastGraph).toBe(graph);

    const repeatedGraphChange = layout.setProps({graph});
    expect(repeatedGraphChange).toBe(true);
    expect(layout.updateGraphCalls).toBe(2);
  });
});
