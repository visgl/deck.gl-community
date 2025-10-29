// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, it, expect} from 'vitest';
import SAMPLE_EDGE from '../__fixtures__/edge.json';

import {basicEdgeParser} from '../../src/loaders/edge-parsers';

describe('loaders/edge-parsers', () => {
  it('should pass sanity', () => {
    expect(basicEdgeParser(SAMPLE_EDGE)).toMatchObject({
      id: 'edge1',
      sourceId: 'node1',
      targetId: 'node2',
      directed: false
    });
  });
});
