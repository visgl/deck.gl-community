// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Quaternion, Vector3} from '@math.gl/core';
import {getTreeFrames, type TreePoint} from './tree-botany';
import {
  getTreeCharacteristicsKey,
  resolveTreeCharacteristics,
  TreeTemplateCache,
  type TreeCharacteristics
} from './tree-characteristics';
import {createPineTiers, createTreeRng} from './tree-geometry';
import {
  getTreeGrowthAtHeight,
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  type TreeGrowthModel,
  type TreeGrowthWood
} from './tree-photoreal-layout';

const REFERENCE_HEIGHT = 12;
const CROWN_ASPECT = 0.25;
const TRUNK_RATIO = 0.025;
const FORK_Z = 0.18;
const LAST_WOOD_BIRTH = 0.994;
const TWO_PI = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const GOLDEN_FRACTION = (Math.sqrt(5) - 1) / 2;
const CACHE = new TreeTemplateCache<TreeGrowthModel>(12);

/** A stem or branch node in the photoreal template coordinate system. */
type PineNode = {
  position: TreePoint;
  parent: number;
  /** Radius as a share of the mature trunk base. */
  radius: number;
  birth: number;
  order: 0 | 1 | 2 | 3;
};

type PineCrownTemplate = {
  referenceHeight: number;
  crownAspect: number;
  forkZ: number;
  nodes: PineNode[];
  /** Node on the leader where each branch whorl attaches, from base to apex. */
  whorls: number[];
  /** Needle records use the same layout and LOD prefix contract as the photoreal foliage. */
  leaves: Float32Array;
  leafCount: number;
  lodLeafCounts: [number, number, number, number];
  /** End node of each needle's supporting segment, for assigning limb IDs when wood is packed. */
  needleNodes: Uint32Array;
};

/**
 * Author a leader, whorled boughs, paired branchlets, and needle fascicles.
 * Wood meshing, needle shaders and TreeLayer selection are handled separately.
 */
export function createPineCrownTemplate(
  branchLevels: number,
  characteristics?: TreeCharacteristics
): PineCrownTemplate {
  const traits = resolveTreeCharacteristics(characteristics);
  const skeletonRng = createTreeRng(traits.seed ^ 0x72ac19);
  const needleRng = createTreeRng(traits.seed ^ 0x184ac5);
  const {tiers, tipEnd} = createPineTiers(branchLevels);
  const aspect = CROWN_ASPECT * traits.crownSpread;
  const nodes: PineNode[] = [{position: [0, 0, 0], parent: -1, radius: 1, birth: 0, order: 0}];
  const whorls: number[] = [];
  const addNode = (node: PineNode) => nodes.push(node) - 1;
  const widest = Math.max(...tiers.map(tier => tier.radius));

  for (const tier of tiers) {
    const z = FORK_Z + ((1 - FORK_Z) * tier.base[2]) / tipEnd[2];
    whorls.push(
      addNode({
        position: [tier.base[0] * 0.2, tier.base[1] * 0.2, z],
        parent: nodes.length - 1,
        birth: getTreeGrowthAtHeight(z),
        radius: 1 - 0.86 * z,
        order: 0
      })
    );
  }
  const leaderSocket = whorls.at(-1)!;
  const leaderBase = nodes[leaderSocket];
  const leader = addNode({
    position: [leaderBase.position[0] * 0.45, leaderBase.position[1] * 0.45, 0.89],
    parent: leaderSocket,
    birth: getTreeGrowthAtHeight(0.89),
    radius: 0.09,
    order: 0
  });
  addNode({position: [0, 0, 1], parent: leader, birth: LAST_WOOD_BIRTH, radius: 0.015, order: 0});

  const boughs = Math.max(3, Math.round(5 * traits.branchDensity));
  const azimuth = skeletonRng() * TWO_PI;
  for (const [index, tier] of tiers.entries()) {
    const socket = whorls[index];
    const {position, birth} = nodes[socket];
    const tierReach = Math.min(tier.radius / widest, 1 - (index / (tiers.length - 1 || 1)) * 0.54);
    for (let bough = 0; bough < boughs; bough++) {
      const angle = azimuth + index * GOLDEN_ANGLE + (bough * TWO_PI) / boughs;
      const outwardX = Math.cos(angle);
      const outwardY = Math.sin(angle);
      const reach = tierReach * (0.79 + skeletonRng() * 0.2);
      const sway = (skeletonRng() - 0.5) * 0.13 * reach * traits.branchWander;
      const rise = Math.min(0.12, tier.height * (0.07 + 0.075 * traits.branchLift));
      let parent = socket;
      for (let station = 1; station <= 5; station++) {
        const t = station / 5;
        const radial = reach * t;
        const curve = Math.sin(t * Math.PI);
        parent = addNode({
          parent,
          position: [
            position[0] + outwardX * radial - outwardY * sway * curve,
            position[1] + outwardY * radial + outwardX * sway * curve,
            position[2] + rise * (t - 0.32 * curve * traits.twigDroop)
          ],
          birth: birth + (1 - birth) * (0.03 + 0.32 * t),
          radius: tierReach * (0.3 - 0.26 * t),
          order: 1
        });
        if (station < 2 || station > 4) continue;
        const fork = nodes[parent];
        const twig = reach * (1 - t) * (0.35 + skeletonRng() * 0.2);
        for (const side of [-1, 1]) {
          const twigX = outwardX * 0.72 - outwardY * side;
          const twigY = outwardY * 0.72 + outwardX * side;
          const twigRise = twig * aspect * (0.66 + skeletonRng() * 0.78 - 0.25 * traits.twigDroop);
          const twigNode = addNode({
            parent,
            position: [
              fork.position[0] + twig * twigX,
              fork.position[1] + twig * twigY,
              fork.position[2] + twigRise
            ],
            birth: fork.birth + (1 - fork.birth) * 0.19,
            radius: fork.radius * 0.17,
            order: 2
          });
          const tip = nodes[twigNode];
          for (const spray of [-1, 1]) {
            const reach = twig * (0.36 + 0.36 * skeletonRng());
            addNode({
              parent: twigNode,
              position: [
                tip.position[0] + reach * (twigX * 0.72 - twigY * spray * 0.55),
                tip.position[1] + reach * (twigY * 0.72 + twigX * spray * 0.55),
                tip.position[2] + twigRise * (0.45 + 0.32 * spray)
              ],
              birth: tip.birth + (1 - tip.birth) * 0.1,
              radius: tip.radius * 0.36,
              order: 3
            });
          }
        }
      }
    }
  }

  const records: number[] = [];
  const supports: number[] = [];
  const phases: number[] = [];
  const groups = new Uint16Array(nodes.length);
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index];
    const parent = nodes[node.parent];
    groups[index] =
      node.order === 0 ? leader : parent.order === 0 ? node.parent : groups[node.parent];
    // Keep the trunk bare below the leader's youngest growth, and bare wood at the bough socket.
    if (node.order === 0 && node.parent !== leaderSocket && node.parent !== leader) continue;
    if (node.order === 1 && parent.order === 0) continue;
    const path = [parent.position, node.position].map(
      ([x, y, z]): TreePoint => [x * aspect, y * aspect, z]
    );
    const length = new Vector3(path[1]).subtract(path[0]).len() * REFERENCE_HEIGHT;
    const [{tangent, side, up}] = getTreeFrames(path);
    const count = Math.max(1, Math.round(length * 220 * traits.leafDensity));
    const phase = needleRng();
    for (let cluster = 0; cluster < count; cluster++) {
      const t = (cluster + 0.3 + needleRng() * 0.4) / count;
      const base = new Vector3(parent.position).lerp(node.position, t);
      const birth = parent.birth + (node.birth - parent.birth) * t + 0.001;
      const turn = phase * TWO_PI + cluster * GOLDEN_ANGLE;
      for (const spread of [-0.18, 0.18]) {
        const angle = turn + spread;
        const radial = new Vector3(side)
          .scale(Math.cos(angle))
          .add(new Vector3(up).scale(Math.sin(angle)));
        const blade = new Vector3(tangent)
          .scale(0.72)
          .add(new Vector3(radial).scale(0.69))
          .normalize();
        const across = new Vector3(radial).cross(blade).normalize();
        const normal = new Vector3(blade).cross(across);
        const rotation = new Quaternion().fromMatrix3([...blade, ...across, ...normal]).normalize();
        const needleLength = (0.102 + needleRng() * 0.068) * traits.leafSize;
        const needleWidth = (0.0016 + needleRng() * 0.0008) * traits.leafSize;
        records.push(
          ...base,
          needleLength,
          ...rotation,
          birth,
          2,
          needleRng(),
          0.85,
          0,
          0,
          t,
          needleWidth / needleLength
        );
        supports.push(index);
        // Give each segment a phase, then interleave its needles across successive LOD prefixes.
        const key = phase + (2 * cluster + (spread > 0 ? 1 : 0)) * GOLDEN_FRACTION;
        phases.push(key - Math.floor(key));
      }
    }
  }
  // Keep a representative in every whorl even when a sparse upper tier would lose
  // its entire sample from the coarsest prefix.
  const representatives: number[] = [];
  const remaining: number[] = [];
  const seen = new Set<number>();
  const stratified = supports.map((_, index) => index).sort((a, b) => phases[a] - phases[b]);
  for (const needle of stratified) {
    const group = groups[supports[needle]];
    if (seen.has(group)) remaining.push(needle);
    else {
      seen.add(group);
      representatives.push(needle);
    }
  }
  const order = representatives.concat(remaining);
  const leafCount = order.length;
  const leaves = new Float32Array(leafCount * TREE_LEAF_STRIDE);
  const needleNodes = new Uint32Array(leafCount);
  for (const [index, source] of order.entries()) {
    for (let lane = 0; lane < TREE_LEAF_STRIDE; lane++) {
      leaves[index * TREE_LEAF_STRIDE + lane] = records[source * TREE_LEAF_STRIDE + lane];
    }
    needleNodes[index] = supports[source];
  }
  return {
    referenceHeight: REFERENCE_HEIGHT,
    crownAspect: aspect,
    forkZ: FORK_Z,
    nodes,
    whorls,
    leaves,
    leafCount,
    lodLeafCounts: [
      leafCount,
      Math.ceil(leafCount / 4),
      Math.ceil(leafCount / 16),
      Math.ceil(leafCount / 64)
    ],
    needleNodes
  };
}

/** Pack the seeded pine scaffold into the same geometry and lifecycle records as other trees. */
export function createPineGrowthModel(
  branchLevels: number,
  characteristics?: TreeCharacteristics
): TreeGrowthModel {
  const levels = createPineTiers(branchLevels).tiers.length;
  const key = `pine-${levels}-${getTreeCharacteristicsKey(characteristics)}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const crown = createPineCrownTemplate(levels, characteristics);
  const {
    nodes,
    leaves,
    leafCount,
    lodLeafCounts,
    needleNodes,
    crownAspect,
    referenceHeight,
    forkZ
  } = crown;
  const rng = createTreeRng(resolveTreeCharacteristics(characteristics).seed ^ 0x329f17);
  const next = new Int32Array(nodes.length).fill(-1);
  for (let index = 1; index < nodes.length; index++) {
    const {parent, order} = nodes[index];
    if (order === nodes[parent].order) next[parent] = index;
  }
  const physicalPoint = ([x, y, z]: TreePoint): TreePoint => [x * crownAspect, y * crownAspect, z];
  const center: number[] = [];
  const previous: number[] = [];
  const radial: number[] = [];
  const bark: number[] = [];
  const shade: number[] = [];
  // Coarsest first, so every detailed model starts with the same woody silhouette.
  const indices: number[][] = [[], [], [], []];
  const limbs = [0, 0, 0, 2, 0, 0, 1, 0];
  const limbByNode = new Uint16Array(nodes.length);
  const cropAnchors: number[] = [];

  function writeTube(path: number[], order: PineNode['order'], limb: number) {
    const sides = order === 0 ? 12 : order === 1 ? 8 : 5;
    const points = path.map(index => physicalPoint(nodes[index].position));
    const frames = getTreeFrames(points);
    const seed = rng();
    let arc = 0;
    for (const [ring, index] of path.entries()) {
      const node = nodes[index];
      const before = nodes[path[Math.max(0, ring - 1)]];
      if (ring > 0) arc += new Vector3(points[ring]).distance(points[ring - 1]);
      const radius = ring === 0 && order > 0 ? nodes[path[1]].radius * 1.3 : node.radius;
      const band = order === 0 ? 0 : order >= 2 ? 3 : ring <= 2 ? 1 : 2;
      const {side, up} = frames[ring];
      for (let segment = 0; segment <= sides; segment++) {
        const u = segment / sides;
        const angle = u * TWO_PI;
        const normal = new Vector3(side)
          .scale(Math.cos(angle))
          .add(new Vector3(up).scale(Math.sin(angle)));
        const vertex = center.length / 4;
        center.push(...node.position, Math.max(node.birth, 0.0001));
        previous.push(...before.position, before.birth);
        radial.push(...normal, radius);
        bark.push(u, arc, 0, limb);
        shade.push(order === 0 ? 0.9 : Math.min(1, 0.7 + 0.12 * order), order, seed, 0);
        if (ring > 0 && segment < sides) {
          const a = vertex - sides - 1;
          indices[band].push(a, a + 1, vertex, a + 1, vertex + 1, vertex);
        }
      }
    }
  }

  function traceTube(first: number): number[] {
    const path: number[] = [];
    for (let index = first; index >= 0; index = next[index]) path.push(index);
    return path;
  }

  writeTube(traceTube(0), 0, 0);
  for (let index = 1; index < nodes.length; index++) {
    const node = nodes[index];
    const parent = nodes[node.parent];
    if (node.order === 1 && parent.order === 0) {
      const bough = traceTube(index);
      const tip = nodes[bough[bough.length - 1]];
      const direction = new Vector3(tip.position).subtract(parent.position);
      const length = direction.len();
      const limb = limbs.length / TREE_LIMB_STRIDE;
      const breakAt = 0.78 - 0.42 * parent.position[2] + 0.08 * rng();
      limbs.push(...parent.position, breakAt, ...direction.normalize(), length);
      for (const member of bough) limbByNode[member] = limb;
      writeTube([node.parent, ...bough], 1, limb);
    } else if (node.order >= 2) {
      const limb = limbByNode[node.parent];
      limbByNode[index] = limb;
      writeTube([node.parent, index], node.order, limb);
      // An optional crop attaches to a grown twig near the ends of the surrounding needles.
      if (node.order === 2)
        cropAnchors.push(...node.position, node.birth + 0.003, 0, limb, rng(), 0.82);
    }
  }
  for (let leaf = 0; leaf < leafCount; leaf++) {
    leaves[leaf * TREE_LEAF_STRIDE + 13] = limbByNode[needleNodes[leaf]];
  }

  const [stem, primary, outer, fine] = indices;
  const wood: TreeGrowthWood = {
    vertexCount: center.length / 4,
    center: Float32Array.from(center),
    previous: Float32Array.from(previous),
    radial: Float32Array.from(radial),
    bark: Float32Array.from(bark),
    shade: Float32Array.from(shade),
    indices: Uint32Array.from(indices.flat()),
    lodIndexCounts: [
      stem.length + primary.length + outer.length + fine.length,
      stem.length + primary.length + outer.length,
      stem.length + primary.length,
      stem.length
    ]
  };
  const model = {
    key,
    forkZ,
    referenceHeight,
    trunkRatio: TRUNK_RATIO,
    crownAspect,
    wood,
    leaves,
    leafCount,
    lodLeafCounts,
    cropAnchors: Float32Array.from(cropAnchors),
    cropAnchorCount: cropAnchors.length / TREE_CROP_ANCHOR_STRIDE,
    limbs: Float32Array.from(limbs),
    limbCount: limbs.length / TREE_LIMB_STRIDE
  };
  CACHE.set(key, model);
  return model;
}
