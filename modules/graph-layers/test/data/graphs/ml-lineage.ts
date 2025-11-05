// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type LineageNode = {
  id: string;
  label: string;
  runNumber: number;
  type: 'run' | 'head';
  lineagePath: string;
  sequenceIndex: number;
};

export type LineageEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

type Rng = () => number;

type HeadEntry = {
  headId: string;
  lineagePath: string;
  childIndex: number;
};

type LineageBuilder = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  addNode: (
    type: LineageNode['type'],
    lineagePath: string,
    sequenceIndex: number
  ) => LineageNode;
  link: (sourceId: string, targetId: string) => void;
};

type BranchAllocation = {
  branchNodes: number;
  leftover: number;
};

type GenerateMlLineageGraphOptions = {
  /**
   * Total number of nodes (runs + heads) in the lineage.
   *
   * The default matches the dataset requested by the tests.
   */
  totalNodes?: number;
  /**
   * Number of sequential runs before the first head is reached.
   */
  baseLineageRuns?: number;
  /**
   * Minimum number of runs that appear under a head before another head closes the sequence.
   */
  minRunsPerBranch?: number;
  /**
   * Maximum number of runs that appear under a head before another head closes the sequence.
   */
  maxRunsPerBranch?: number;
  /**
   * Maximum number of child branches that any head may spawn.
   */
  maxBranchesPerHead?: number;
  /**
   * Seed value for the deterministic pseudo-random generator.
   */
  seed?: number;
};

const DEFAULT_OPTIONS: Required<GenerateMlLineageGraphOptions> = {
  totalNodes: 1000,
  baseLineageRuns: 80,
  minRunsPerBranch: 5,
  maxRunsPerBranch: 50,
  maxBranchesPerHead: 4,
  seed: 0xdecacafe
};

function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function createLineageBuilder(): LineageBuilder {
  const nodes: LineageNode[] = [];
  const edges: LineageEdge[] = [];
  let runCounter = 0;
  let edgeCounter = 0;

  return {
    nodes,
    edges,
    addNode(type, lineagePath, sequenceIndex) {
      runCounter += 1;
      const node: LineageNode = {
        id: `run-${runCounter}`,
        label: type === 'head' ? `Head ${runCounter}` : `Run ${runCounter}`,
        runNumber: runCounter,
        type,
        lineagePath,
        sequenceIndex
      };
      nodes.push(node);
      return node;
    },
    link(sourceId, targetId) {
      edgeCounter += 1;
      edges.push({
        id: `edge-${edgeCounter}`,
        sourceId,
        targetId
      });
    }
  };
}

function buildBaseLineage(
  builder: LineageBuilder,
  baseLineageRuns: number
): {initialHead: HeadEntry; baseNodes: number} {
  const firstRun = builder.addNode('run', 'root', 0);
  let previousNode = firstRun;

  for (let index = 1; index < baseLineageRuns; index += 1) {
    const nextNode = builder.addNode('run', 'root', index);
    builder.link(previousNode.id, nextNode.id);
    previousNode = nextNode;
  }

  const headNode = builder.addNode('head', 'root', baseLineageRuns);
  builder.link(previousNode.id, headNode.id);

  return {
    initialHead: {headId: headNode.id, lineagePath: 'root', childIndex: 1},
    baseNodes: builder.nodes.length
  };
}

function allocateBranchNodes(
  rng: Rng,
  remaining: number,
  minNodesPerBranch: number,
  maxNodesPerBranch: number
): BranchAllocation {
  const maxNodesForBranch = Math.min(maxNodesPerBranch, remaining);
  const randomSpan = maxNodesForBranch - minNodesPerBranch + 1;
  const branchNodes =
    minNodesPerBranch + Math.floor(rng() * (randomSpan > 0 ? randomSpan : 1));
  const leftover = remaining - branchNodes;

  if (leftover <= 0 || leftover >= minNodesPerBranch) {
    return {branchNodes, leftover};
  }

  if (branchNodes + leftover <= maxNodesPerBranch) {
    return {branchNodes: branchNodes + leftover, leftover: 0};
  }

  const adjustment = minNodesPerBranch - leftover;
  if (branchNodes - adjustment >= minNodesPerBranch) {
    return {branchNodes: branchNodes - adjustment, leftover: leftover + adjustment};
  }

  return {branchNodes: remaining, leftover: 0};
}

function planBranchRuns(
  rng: Rng,
  totalNodes: number,
  baseNodes: number,
  minRuns: number,
  maxRuns: number
): number[] {
  const minNodesPerBranch = minRuns + 1;
  const maxNodesPerBranch = maxRuns + 1;
  const plan: number[] = [];
  let remaining = totalNodes - baseNodes;

  while (remaining > 0) {
    const allocation = allocateBranchNodes(
      rng,
      remaining,
      minNodesPerBranch,
      maxNodesPerBranch
    );
    plan.push(allocation.branchNodes - 1);
    remaining = allocation.leftover;
  }

  return plan;
}

function selectBranchCount(rng: Rng, possibleBranches: number): number {
  if (possibleBranches <= 0) {
    return 0;
  }
  const selection = Math.floor(rng() * (possibleBranches + 1));
  return selection === 0 ? Math.min(1, possibleBranches) : selection;
}

function growBranch(
  builder: LineageBuilder,
  parentHead: HeadEntry,
  branchLabel: string,
  runsInBranch: number
): HeadEntry {
  let parentId = parentHead.headId;

  for (let runIndex = 0; runIndex < runsInBranch; runIndex += 1) {
    const node = builder.addNode('run', branchLabel, runIndex);
    builder.link(parentId, node.id);
    parentId = node.id;
  }

  const branchHead = builder.addNode('head', branchLabel, runsInBranch);
  builder.link(parentId, branchHead.id);
  return {headId: branchHead.id, lineagePath: branchLabel, childIndex: 1};
}

type BranchDistributionOptions = {
  maxBranchesPerHead: number;
  totalNodes: number;
};

function distributeBranches(
  builder: LineageBuilder,
  branchPlans: number[],
  rng: Rng,
  options: BranchDistributionOptions,
  initialHead: HeadEntry
) {
  const queue: HeadEntry[] = [initialHead];
  let planIndex = 0;

  while (planIndex < branchPlans.length) {
    const currentHead = queue.shift();
    if (!currentHead) {
      break;
    }

    const remainingBranches = branchPlans.length - planIndex;
    const possibleBranches = Math.min(options.maxBranchesPerHead, remainingBranches);
    const branchCount = selectBranchCount(rng, possibleBranches);

    for (let index = 0; index < branchCount && planIndex < branchPlans.length; index += 1) {
      const branchLabel = `${currentHead.lineagePath}.${currentHead.childIndex}`;
      currentHead.childIndex += 1;
      const runsInBranch = branchPlans[planIndex];
      planIndex += 1;
      const newHead = growBranch(builder, currentHead, branchLabel, runsInBranch);
      queue.push(newHead);

      if (builder.nodes.length >= options.totalNodes) {
        return;
      }
    }
  }
}

export function generateMlLineageGraph(
  options: GenerateMlLineageGraphOptions = {}
): {
  name: string;
  nodes: LineageNode[];
  edges: LineageEdge[];
} {
  const config = {...DEFAULT_OPTIONS, ...options};
  if (config.totalNodes <= 0) {
    throw new Error('totalNodes must be greater than 0.');
  }

  const rng = createRng(config.seed);
  const builder = createLineageBuilder();
  const {initialHead, baseNodes} = buildBaseLineage(builder, config.baseLineageRuns);
  const branchPlans = planBranchRuns(
    rng,
    config.totalNodes,
    baseNodes,
    config.minRunsPerBranch,
    config.maxRunsPerBranch
  );

  distributeBranches(
    builder,
    branchPlans,
    rng,
    {maxBranchesPerHead: config.maxBranchesPerHead, totalNodes: config.totalNodes},
    initialHead
  );

  if (builder.nodes.length !== config.totalNodes) {
    throw new Error(
      `Failed to generate requested graph size: ${builder.nodes.length} !== ${config.totalNodes}`
    );
  }

  return {
    name: `ML Lineage DAG (${config.totalNodes} runs)`,
    nodes: builder.nodes,
    edges: builder.edges
  };
}
