// deck.gl-community
// SPDX-License-Identifier: MIT

import type {Dag} from 'd3-dag';
import * as d3Dag from 'd3-dag';

const {
  coordGreedy,
  coordQuad,
  coordSimplex,
  decrossGreedy,
  decrossOpt,
  decrossTwoLayer,
  layeringLongestPath,
  layeringSimplex,
  layeringTopological,
  sugiyama
} = d3Dag;

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

type StratifyDatum<N extends DagNode> = {
  id: string;
  original?: N;
  parentIds: string[];
};

type DagNodeWithPosition<N extends DagNode> = {
  id: string;
  data?: StratifyDatum<N>;
  x?: number;
  y?: number;
};

type DagWithData<N extends DagNode> = Dag<StratifyDatum<N>> & Iterable<DagNodeWithPosition<N>>;

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
  const nodeMap = new Map<string, N | undefined>();
  for (const node of nodes) {
    nodeMap.set(toId(node), node);
  }

  const parents = new Map<string, Set<string>>();
  for (const {source, target} of links) {
    const sourceId = String(source);
    const targetId = String(target);
    if (!parents.has(targetId)) {
      parents.set(targetId, new Set());
    }
    parents.get(targetId)!.add(sourceId);
    if (!nodeMap.has(sourceId)) {
      nodeMap.set(sourceId, undefined);
    }
    if (!nodeMap.has(targetId)) {
      nodeMap.set(targetId, undefined);
    }
  }

  const stratifyFactory = (d3Dag as {dagStratify?: typeof import('d3-dag')['dagStratify']}).dagStratify;
  const connectFactory = (d3Dag as {dagConnect?: typeof import('d3-dag')['dagConnect']}).dagConnect;

  if (links.length === 0 && typeof stratifyFactory !== 'function') {
    const rankY = new Map<number, number>();
    const outNodes: DagAlignedResult<N>['nodes'] = nodes.map((node, index) => {
      const r = rank(node);
      const assignedY = rankY.has(r) ? rankY.get(r)! : yScale ? yScale(r) : r * gap[1];
      if (!rankY.has(r)) {
        rankY.set(r, assignedY);
      }
      return {
        ...node,
        x: index * gap[0],
        y: assignedY,
        rank: r
      };
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
      console.debug('layoutDagAligned result (fallback)', {nodes: outNodes, links, width, height});
    }

    return {nodes: outNodes, links, width, height};
  }

  let dag: DagWithData<N>;
  if (typeof stratifyFactory === 'function') {
    const stratify = stratifyFactory<StratifyDatum<N>>()
      .id((datum) => datum.id)
      .parentIds((datum) => datum.parentIds);

    dag = stratify(
      Array.from(nodeMap.entries(), ([id, original]) => ({
        id,
        original,
        parentIds: Array.from(parents.get(id)?.values() ?? [])
      }))
    ) as DagWithData<N>;
  } else if (typeof connectFactory === 'function') {
    const connect = connectFactory();
    dag = connect(
      links.map(({source, target}) => ({
        sourceId: String(source),
        targetId: String(target)
      }))
    ) as DagWithData<N>;
  } else {
    throw new Error('d3-dag does not expose a supported DAG builder');
  }

  for (const dagNode of dag) {
    const existingData = (dagNode as DagNodeWithPosition<N>).data;
    const datum = nodeMap.get(dagNode.id);
    if (datum) {
      const enriched: StratifyDatum<N> = existingData
        ? {...existingData, original: datum}
        : {id: dagNode.id, original: datum, parentIds: Array.from(parents.get(dagNode.id)?.values() ?? [])};
      (dagNode as DagNodeWithPosition<N>).data = enriched;
    }
  }

  const layeringImpl = pickLayering(layering);
  if (typeof (layeringImpl as any).rank === 'function') {
    (layeringImpl as any).rank((dagNode: DagNodeWithPosition<N>) => {
      const datum = dagNode.data?.original ?? nodeMap.get(dagNode.id);
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
      const datum = dagNode.data?.original ?? nodeMap.get(dagNode.id);
      return datum ? nodeSize(datum) : [0, 0];
    });
  }

  const laid = layout(dag as unknown as Dag<DagNodeWithPosition<N>>);

  const positioned = new Map<string, {x: number; y: number; rank: number}>();
  const rankY = new Map<number, number>();

  for (const dagNode of laid) {
    const datum = dagNode.data?.original ?? nodeMap.get(dagNode.id);
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
