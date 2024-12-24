// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {useLayoutEffect, useRef, useState} from 'react';
import {GraphLayout, Graph, GraphEngine} from '@deck.gl-community/graph-layers';

export const useGraphEngine = (graph: Graph, layout: GraphLayout): GraphEngine => {
  const [engine, setEngine] = useState(new GraphEngine(graph, layout));
  const isFirstMount = useRef(true);

  useLayoutEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }

    setEngine(new GraphEngine(graph, layout));
  }, [graph, layout]);

  return engine;
};
