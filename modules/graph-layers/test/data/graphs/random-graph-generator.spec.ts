// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';

import {randomGraphGenerator} from './random-graph-generator';

describe('randomGraphGenerator', () => {
  it('produces deterministic output for the same input', () => {
    const first = randomGraphGenerator(5, 4, 'sample');
    const second = randomGraphGenerator(5, 4, 'sample');

    expect(second).toEqual(first);
  });

  it('uses a provided random generator when supplied', () => {
    const graph = randomGraphGenerator(4, 3, 'custom', () => 0);

    expect(graph.edges).toEqual([
      {id: 0, sourceId: 0, targetId: 1},
      {id: 1, sourceId: 0, targetId: 2},
      {id: 2, sourceId: 0, targetId: 3}
    ]);
  });
});
