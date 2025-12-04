/**
 * Minimal graph data primitives shared by graph loader implementations.
 */
export type GraphNode = {
  /** Unique identifier for the node. */
  id: string;
  /** Optional metadata attached to the node. */
  [key: string]: unknown;
};

export type GraphEdge = {
  /** Identifier for the source node. */
  source: string;
  /** Identifier for the target node. */
  target: string;
  /** Optional metadata attached to the edge. */
  [key: string]: unknown;
};

export type GraphData = {
  /** List of nodes referenced by the graph. */
  nodes: GraphNode[];
  /** List of edges connecting nodes. */
  edges: GraphEdge[];
};

export type GraphLoaderResult = GraphData & {
  /** Optional loader-specific metadata for downstream visualization components. */
  metadata?: Record<string, unknown>;
};

/**
 * Create a normalized, empty graph payload.
 */
export function createEmptyGraph(metadata: Record<string, unknown> = {}): GraphLoaderResult {
  return {
    nodes: [],
    edges: [],
    metadata
  };
}

/**
 * Normalize partially specified graph data into the canonical `GraphLoaderResult` shape.
 */
export function normalizeGraphData(input?: Partial<GraphData> | null): GraphLoaderResult {
  if (!input) {
    return createEmptyGraph();
  }

  const {nodes = [], edges = []} = input;
  return {
    nodes: [...nodes],
    edges: [...edges]
  };
}
