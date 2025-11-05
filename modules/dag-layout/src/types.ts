// deck.gl-community
// SPDX-License-Identifier: MIT

export type DagNodeId = string | number;

export type DagNode<Data = any> = {
  id: DagNodeId;
  data?: Data;
};

export type DagLink = {source: DagNodeId; target: DagNodeId};

export type RankAccessor<N = DagNode> = (node: N) => number;
export type YScale = (rank: number) => number;

export type DagAlignedOptions<N = DagNode> = {
  rank: RankAccessor<N>;
  yScale?: YScale;
  layering?: 'simplex' | 'longestPath' | 'topological';
  decross?: 'twoLayer' | 'greedy' | 'opt';
  coord?: 'simplex' | 'greedy' | 'quad';
  gap?: [number, number];
  nodeSize?: (n: N) => [number, number];
  debug?: boolean;
};

export type DagAlignedNode<N = DagNode> = N & {
  x: number;
  y: number;
  rank: number;
};

export type DagAlignedResult<N = DagNode> = {
  nodes: Array<DagAlignedNode<N>>;
  links: DagLink[];
  width: number;
  height: number;
};
