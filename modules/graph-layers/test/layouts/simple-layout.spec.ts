// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';

import {SimpleLayout} from '../../src/layouts/simple-layout';
import {LegacyGraph} from '../../src/graph/legacy-graph';
import {Node} from '../../src/graph/node';

describe('layouts/simple-layout', () => {
  it('updates node positions when nodePositionAccessor changes', () => {
    const graph = new LegacyGraph();
    const node = new Node({id: 'a'});
    node.setDataProperty('x', 1);
    node.setDataProperty('y', 2);
    graph.addNode(node);

    const layout = new SimpleLayout();
    layout.initializeGraph(graph);

    expect(layout.getNodePosition(node)).toEqual([1, 2]);

    layout.setProps({
      nodePositionAccessor: (target) =>
        [
          target.getPropertyValue('y') as number,
          target.getPropertyValue('x') as number
        ] as [number, number]
    });

    expect(layout.getNodePosition(node)).toEqual([2, 1]);
  });
});
