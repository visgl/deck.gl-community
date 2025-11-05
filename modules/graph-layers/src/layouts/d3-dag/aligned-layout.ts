// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  coordCenter,
  coordGreedy,
  coordQuad,
  coordSimplex,
  coordTopological,
  dagConnect,
  decrossDfs,
  decrossOpt,
  decrossTwoLayer,
  layeringLongestPath,
  layeringSimplex,
  layeringTopological,
  sugiyama,
  type Coord,
  type Dag,
  type Decross
} from 'd3-dag';

export type DagNode = {id: string | number; [key: string]: unknown};
export type DagLink = {source: string | number; target: string | number; [key: string]: unknown};

export type RankAccessor<N = DagNode> = (node: N) => number;
export type YScale = (rank: number) => number;

export type DagLayeringOption =
  | 'simplex'
  | 'longestPath'
  | 'topological'
  | ReturnType<typeof layeringSimplex>
  | ReturnType<typeof layeringLongestPath>
  | ReturnType<typeof layeringTopological>;

export type DagDecrossOption =
  | 'twoLayer'
  | 'opt'
  | 'dfs'
  | ReturnType<typeof decrossTwoLayer>
  | ReturnType<typeof decrossOpt>
  | ReturnType<typeof decrossDfs>;

export type DagCoordOption =
  | 'simplex'
  | 'greedy'
  | 'quad'
  | 'center'
  | 'topological'
  | ReturnType<typeof coordSimplex>
  | ReturnType<typeof coordGreedy>
  | ReturnType<typeof coordQuad>
  | ReturnType<typeof coordCenter>
  | ReturnType<typeof coordTopological>;

export type DagAlignedOptions<N extends DagNode = DagNode> = {
  rank: RankAccessor<N>;
  yScale?: YScale;
  layering?: DagLayeringOption;
  decross?: DagDecrossOption;
  coord?: DagCoordOption;
  gap?: readonly [number, number];
  nodeSize?: (node: N) => readonly [number, number];
  debug?: boolean;
};

export type DagAlignedNode<N extends DagNode = DagNode> = N & {
  x: number;
  y: number;
  rank: number;
};

export type DagAlignedResult<N extends DagNode = DagNode> = {
  nodes: DagAlignedNode<N>[];
  links: DagLink[];
  width: number;
  height: number;
};

export type DagLike<N> = Iterable<{y?: number; data?: N}> & {
  links?: () => Iterable<{points?: [number, number][]}>;
};

export const ALIGN_DEFAULT_GAP: readonly [number, number] = [24, 40];

const LAYERING_PICKERS: Record<'simplex' | 'longestPath' | 'topological', () => ReturnType<typeof layeringSimplex>> = {
  simplex: layeringSimplex,
  longestPath: layeringLongestPath,
  topological: layeringTopological
};

const DECROSS_PICKERS: Record<'twoLayer' | 'opt' | 'dfs', () => ReturnType<typeof decrossTwoLayer>> = {
  twoLayer: decrossTwoLayer,
  opt: decrossOpt,
  dfs: decrossDfs
};

const COORD_PICKERS: Record<'simplex' | 'greedy' | 'quad' | 'center' | 'topological', () => ReturnType<typeof coordSimplex>> = {
  simplex: coordSimplex,
  greedy: coordGreedy,
  quad: coordQuad,
  center: coordCenter,
  topological: coordTopological
};

function pickLayering(option: DagLayeringOption | undefined) {
  if (!option) {
    return layeringSimplex();
  }
  if (typeof option === 'string') {
    const factory = LAYERING_PICKERS[option];
    return factory ? factory() : layeringSimplex();
  }
  return option;
}

function pickDecross(option: DagDecrossOption | undefined) {
  if (!option) {
    return decrossTwoLayer();
  }
  if (typeof option === 'string') {
    const factory = DECROSS_PICKERS[option];
    return factory ? factory() : decrossTwoLayer();
  }
  return option;
}

function pickCoord(option: DagCoordOption | undefined) {
  if (!option) {
    return coordSimplex();
  }
  if (typeof option === 'string') {
    const factory = COORD_PICKERS[option];
    return factory ? factory() : coordSimplex();
  }
  return option;
}

const FLOAT_KEY_PRECISION = 8;

const formatKey = (value: number) => value.toFixed(FLOAT_KEY_PRECISION);

export function alignDagYByRank<N>(
  dag: DagLike<N> | null,
  rankAccessor: RankAccessor<N>,
  options: {yScale?: YScale; gapY?: number; debug?: boolean} = {}
): {minY: number; maxY: number} | null {
  if (!dag) {
    return null;
  }

  const entries: Array<{node: any; originalY: number}> = [];
  const yToKnownRank = new Map<string, number>();
  const observedRanks: number[] = [];

  for (const node of dag) {
    const originalY = typeof (node as any).y === 'number' ? ((node as any).y as number) : 0;
    entries.push({node, originalY});

    const data = (node as any).data as N | undefined;
    if (data !== undefined) {
      const rank = rankAccessor(data);
      if (Number.isFinite(rank)) {
        const key = formatKey(originalY);
        yToKnownRank.set(key, rank);
        observedRanks.push(rank);
      }
    }
  }

  if (!entries.length || !observedRanks.length) {
    return null;
  }

  const sortedY = Array.from(new Set(entries.map(({originalY}) => originalY))).sort((a, b) => a - b);
  const minRank = Math.min(...observedRanks);
  const gapY = options.gapY ?? ALIGN_DEFAULT_GAP[1];
  const scaleFn = options.yScale ?? ((rank: number) => (rank - minRank) * gapY);

  const yToRank = new Map<string, number>();
  let currentRank = minRank - 1;

  for (const value of sortedY) {
    const key = formatKey(value);
    if (yToKnownRank.has(key)) {
      currentRank = yToKnownRank.get(key)!;
      yToRank.set(key, currentRank);
    } else {
      currentRank += 1;
      yToRank.set(key, currentRank);
    }
  }

  const yMapping = new Map<string, number>();
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [key, rank] of yToRank) {
    const mapped = scaleFn(rank);
    yMapping.set(key, mapped);
    minY = Math.min(minY, mapped);
    maxY = Math.max(maxY, mapped);
  }

  for (const entry of entries) {
    const mapped = yMapping.get(formatKey(entry.originalY));
    if (mapped !== undefined) {
      (entry.node as any).y = mapped;
    }
  }

  const links = typeof dag.links === 'function' ? dag.links() : null;
  if (links) {
    for (const link of links) {
      const points = (link as any).points;
      if (!Array.isArray(points)) {
        continue;
      }
      for (const point of points) {
        const mapped = yMapping.get(formatKey(point[1]));
        if (mapped !== undefined) {
          point[1] = mapped;
        }
      }
    }
  }

  if (options.debug) {
    // eslint-disable-next-line no-console
    console.table(
      Array.from(yToRank.entries()).map(([key, rank]) => ({
        originalY: Number(key),
        rank,
        mappedY: yMapping.get(key)
      }))
    );
  }

  return {minY, maxY};
}

export function layoutDagAligned<N extends DagNode = DagNode>(
  nodes: N[],
  links: DagLink[],
  opts: DagAlignedOptions<N>
): DagAlignedResult<N> {
  const {rank, yScale, layering, decross, coord, gap = ALIGN_DEFAULT_GAP, nodeSize, debug} = opts;

  const id = (node: N) => String(node.id);
  const nodeMap = new Map(nodes.map((node) => [id(node), node]));
  const dag = dagConnect()(
    links.map((link) => ({
      sourceId: String(link.source),
      targetId: String(link.target)
    }))
  );

  for (const dagNode of dag) {
    const datum = nodeMap.get(dagNode.id);
    (dagNode as any).data = datum ?? null;
  }

  const layeringImpl = pickLayering(layering);
  if (typeof (layeringImpl as any).rank === 'function') {
    (layeringImpl as any).rank((dagNode: any) => rank(dagNode.data));
  }

  const layout = sugiyama()
    .layering(layeringImpl as any)
    .decross(pickDecross(decross) as Decross<any, any>)
    .coord(pickCoord(coord) as Coord<any, any>)
    .gap(gap);

  if (nodeSize) {
    layout.nodeSize((dagNode: any) => nodeSize(dagNode.data));
  }

  const laid = layout(dag as unknown as Dag<any>);
  const remapped = alignDagYByRank(laid as unknown as DagLike<any>, (dagNode: any) => rank(dagNode), {
    yScale,
    gapY: gap[1],
    debug
  });

  const width = laid.width();
  const height = remapped ? remapped.maxY - remapped.minY : laid.height();

  const outNodes: DagAlignedNode<N>[] = [];
  for (const dagNode of laid) {
    const datum = (dagNode as any).data as N | undefined;
    if (!datum) {
      continue;
    }
    const nodeRank = rank(datum);
    outNodes.push({
      ...datum,
      x: (dagNode as any).x,
      y: (dagNode as any).y,
      rank: nodeRank
    });
  }

  return {nodes: outNodes, links, width, height};
}

