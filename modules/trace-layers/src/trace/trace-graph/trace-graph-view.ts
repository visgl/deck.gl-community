import {buildVisibleTraceGraph} from '../trace-layout/trace-geometry-layout-helpers';

import type {TraceLayoutVisibleGraph} from '../trace-layout/trace-layout';
import type {TraceGraph} from './trace-graph';
import type {TraceGraphVisibleIndex} from './trace-graph-types';

/**
 * No-clone filtered trace view used by layout and rendering boundaries.
 */
export type TraceGraphView = {
  /** Source runtime graph that owns filter state and visible-index caching. */
  readonly graph: TraceGraph;
  /** Cached compact visible index owned by {@link graph}. */
  readonly visibleIndex: TraceGraphVisibleIndex;
  /** Visible layout projection derived from the current graph filter state. */
  readonly layoutGraph: TraceLayoutVisibleGraph;
};

/**
 * Builds a renderer/layout-facing view over a trace graph without cloning the graph.
 */
export function buildTraceGraphView(graph: TraceGraph): TraceGraphView {
  return {
    graph,
    visibleIndex: graph.getVisibleIndex(),
    layoutGraph: buildVisibleTraceGraph(graph)
  };
}
