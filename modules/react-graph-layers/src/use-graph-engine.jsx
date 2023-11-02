import {useLayoutEffect, useRef, useState} from 'react';
import {GraphEngine} from 'deck-graph-layers';

export const useGraphEngine = (graph, layout) => {
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
