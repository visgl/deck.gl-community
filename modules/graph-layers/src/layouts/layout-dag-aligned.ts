// deck.gl-community
// SPDX-License-Identifier: MIT

import {
  coordGreedy,
  coordQuad,
  coordSimplex,
  dagConnect,
  decrossGreedy,
  decrossOpt,
  decrossTwoLayer,
  layeringLongestPath,
  layeringSimplex,
  layeringTopological,
  sugiyama,
  type Dag
} from 'd3-dag';

export type DagNodeId = string | number;

export type DagNode<Data = unknown> = {
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
  nodeSize?: (node: N) => [number, number];
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

type DagDatum<N extends DagNode> = {data?: N};

type DagNodeWithPosition<N extends DagNode> = DagDatum<N> & {
  id: string;
  x?: number;
  y?: number;
};

type DagWithData<N extends DagNode> = Dag<DagDatum<N>> & Iterable<DagNodeWithPosition<N>>;

function pickLayering(name?: DagAlignedOptions['layering']) {
  switch (name) {
    case 'longestPath':
      return layeringLongestPath();
    case 'topological':
      return layeringTopological();
    case 'simplex':
    default:
      return layeringSimplex();
  }
}

function pickDecross(name?: DagAlignedOptions['decross']) {
  switch (name) {
    case 'greedy':
      return decrossGreedy();
    case 'opt':
      return decrossOpt();
    case 'twoLayer':
    default:
      return decrossTwoLayer();
  }
}

function pickCoord(name?: DagAlignedOptions['coord']) {
  switch (name) {
    case 'greedy':
      return coordGreedy();
    case 'quad':
      return coordQuad();
    case 'simplex':
    default:
      return coordSimplex();
  }
}

export function layoutDagAligned<N extends DagNode = DagNode>(
  nodes: N[],
  links: DagLink[],
  opts: DagAlignedOptions<N>
): DagAlignedResult<N> {
  const {rank, yScale, layering, decross, coord, gap = [24, 40], nodeSize, debug} = opts;

  const toId = (node: N) => String(node.id);
  const nodeMap = new Map(nodes.map((node) => [toId(node), node] as const));

  const dag = dagConnect<DagDatum<N>>()(links.map(({source, target}) => ({
    sourceId: String(source),
    targetId: String(target)
  }))) as DagWithData<N>;

  for (const dagNode of dag) {
    const original = nodeMap.get(dagNode.id);
    if (original) {
      dagNode.data = original;
    }
  }

  const layeringImpl = pickLayering(layering);
  if (typeof (layeringImpl as any).rank === 'function') {
    (layeringImpl as any).rank((dagNode: DagNodeWithPosition<N>) => {
      const datum = dagNode.data ?? nodeMap.get(dagNode.id);
      if (!datum) {
        return 0;
      }
      return rank(datum);
    });
  }

  const layout = sugiyama()
    .layering(layeringImpl)
    .decross(pickDecross(decross))
    .coord(pickCoord(coord))
    .gap(gap);

  if (nodeSize) {
    layout.nodeSize((dagNode: DagNodeWithPosition<N>) => {
      const datum = dagNode.data ?? nodeMap.get(dagNode.id);
      return datum ? nodeSize(datum) : [0, 0];
    });
  }

  const laid = layout(dag as unknown as Dag<DagNodeWithPosition<N>>);

  const positioned = new Map<string, {x: number; y: number; rank: number}>();
  const rankY = new Map<number, number>();

  for (const dagNode of laid) {
    const datum = dagNode.data ?? nodeMap.get(dagNode.id);
    if (!datum) {
      continue;
    }
    const r = rank(datum);
    const x = Number.isFinite(dagNode.x) ? (dagNode.x as number) : 0;
    let y = Number.isFinite(dagNode.y) ? (dagNode.y as number) : r * gap[1];

    if (yScale) {
      y = yScale(r);
    }

    const sharedY = rankY.get(r);
    if (sharedY === undefined) {
      rankY.set(r, y);
    } else {
      y = sharedY;
    }

    positioned.set(dagNode.id, {x, y, rank: r});
  }

  const outNodes: DagAlignedResult<N>['nodes'] = nodes.map((node) => {
    const key = toId(node);
    const positionedNode = positioned.get(key);
    const r = rank(node);
    let x = positionedNode?.x ?? 0;
    let y = positionedNode?.y ?? (yScale ? yScale(r) : rankY.get(r) ?? r * gap[1]);

    if (!Number.isFinite(x)) {
      x = 0;
    }
    if (!Number.isFinite(y)) {
      y = 0;
    }

    return {...node, x, y, rank: r};
  });

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of outNodes) {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }

  const width = minX === Number.POSITIVE_INFINITY ? 0 : maxX - minX;
  const height = minY === Number.POSITIVE_INFINITY ? 0 : maxY - minY;

  if (debug) {
    // eslint-disable-next-line no-console
    console.debug('layoutDagAligned result', {nodes: outNodes, links, width, height});
  }

  return {nodes: outNodes, links, width, height};
}
