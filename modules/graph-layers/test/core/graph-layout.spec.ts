// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';

import {GraphLayout, type GraphLayoutProps} from '../../src/core/graph-layout';
import type {Graph} from '../../src/graph/graph';
import type {Node} from '../../src/graph/node';
import type {Edge} from '../../src/graph/edge';

type TestLayoutProps = GraphLayoutProps & {
  scale?: number;
  threshold?: number;
};

class TestLayout extends GraphLayout<TestLayoutProps> {
  static defaultProps: Required<TestLayoutProps> = {
    scale: 1,
    threshold: 5
  } as const;

  constructor(props: TestLayoutProps = {}) {
    super(props, TestLayout.defaultProps);
  }

  // eslint-disable-next-line class-methods-use-this
  initializeGraph(_graph: Graph): void {}
  // eslint-disable-next-line class-methods-use-this
  protected override updateGraph(_graph: Graph): void {}
  // eslint-disable-next-line class-methods-use-this
  start(): void {}
  // eslint-disable-next-line class-methods-use-this
  update(): void {}
  // eslint-disable-next-line class-methods-use-this
  resume(): void {}
  // eslint-disable-next-line class-methods-use-this
  stop(): void {}
  // eslint-disable-next-line class-methods-use-this
  getNodePosition(_node: Node): [number, number] {
    return [0, 0];
  }
  // eslint-disable-next-line class-methods-use-this
  getEdgePosition(_edge: Edge) {
    return {
      type: 'line',
      sourcePosition: [0, 0],
      targetPosition: [0, 0],
      controlPoints: [] as [number, number][]
    };
  }
  // eslint-disable-next-line class-methods-use-this
  lockNodePosition(_node: Node, _x: number, _y: number): void {}
  // eslint-disable-next-line class-methods-use-this
  unlockNodePosition(_node: Node): void {}

  protected override _validateProps(props: Readonly<Required<TestLayoutProps>>): void {
    if (props.scale < 0) {
      throw new Error('scale must be non-negative');
    }
  }

  protected override _shouldRecompute(
    previous: Readonly<Required<TestLayoutProps>>,
    next: Readonly<Required<TestLayoutProps>>,
    changedKeys: (keyof TestLayoutProps)[]
  ): boolean {
    if (changedKeys.includes('threshold')) {
      return next.threshold > 10 && next.threshold !== previous.threshold;
    }

    return super._shouldRecompute(previous, next, changedKeys);
  }
}

describe('core/graph-layout', () => {
  it('merges props and emits invalidation events when needed', () => {
    const layout = new TestLayout();
    const handler = vi.fn();
    layout.addEventListener('onLayoutInvalidated', handler as EventListener);

    const result = layout.setProps({scale: 3});

    expect(result.changed).toBe(true);
    expect(result.needsRecompute).toBe(true);
    expect(result.changedKeys).toEqual(['scale']);
    expect(handler).toHaveBeenCalledTimes(1);

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.changedKeys).toEqual(['scale']);
  });

  it('ignores redundant prop updates', () => {
    const layout = new TestLayout({scale: 2});
    const handler = vi.fn();
    layout.addEventListener('onLayoutInvalidated', handler as EventListener);

    const result = layout.setProps({scale: 2});

    expect(result.changed).toBe(false);
    expect(result.needsRecompute).toBe(false);
    expect(result.changedKeys).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('respects validation and recompute heuristics', () => {
    const layout = new TestLayout();

    expect(() => layout.setProps({scale: -1})).toThrow('scale must be non-negative');

    const handler = vi.fn();
    layout.addEventListener('onLayoutInvalidated', handler as EventListener);

    const softUpdate = layout.setProps({threshold: 8});
    expect(softUpdate.changed).toBe(true);
    expect(softUpdate.needsRecompute).toBe(false);
    expect(handler).not.toHaveBeenCalled();

    const hardUpdate = layout.setProps({threshold: 12});
    expect(hardUpdate.changed).toBe(true);
    expect(hardUpdate.needsRecompute).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.changedKeys).toEqual(['threshold']);
  });
});
