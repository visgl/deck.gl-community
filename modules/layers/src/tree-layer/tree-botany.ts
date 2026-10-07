// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Vector3} from '@math.gl/core';
import {createTreeRng, createPineTiers, samplePineSurface} from './tree-geometry';
import type {TreeType} from './tree-layer';
import {
  resolveTreeCharacteristics,
  getTreeCharacteristicsKey,
  TreeTemplateCache,
  type TreeCharacteristics
} from './tree-characteristics';

export type TreePoint = [number, number, number];
export type TreeBranch = {
  ring: number;
  sector: number;
  path: TreePoint[];
  radius: number;
  radii?: number[];
  rooted?: boolean;
  children: TreeBranch[];
};
export type LeafCluster = {
  center: TreePoint;
  radius: TreePoint;
  shoot: TreePoint;
  fruitBearing: boolean;
};
export type TreeBotany = {
  stem: TreePoint[];
  radii: number[];
  branches: TreeBranch[];
  clusters: LeafCluster[];
};
const CACHE = new TreeTemplateCache<TreeBotany>();

/** Transport a frame along a tube without the discontinuous vertical-axis switch. */
export function getTreeFrames(path: TreePoint[]) {
  let previous: Vector3 | undefined;
  return path.map((point, index) => {
    const tangent = new Vector3(path[Math.min(path.length - 1, index + 1)])
      .subtract(path[Math.max(0, index - 1)])
      .normalize();
    const side = previous
      ? new Vector3(previous).subtract(new Vector3(tangent).scale(previous.dot(tangent)))
      : new Vector3(Math.abs(tangent.z) > 0.95 ? [1, 0, 0] : [0, 0, 1]).cross(tangent);
    if (side.len() < 1e-6) side.set(1, 0, 0).cross(tangent);
    side.normalize();
    previous = side;
    return {side, up: new Vector3(tangent).cross(side).normalize(), tangent};
  });
}
function getSocketSector(path: TreePoint[], ring: number, end: TreePoint, count: number) {
  const {side, up} = getTreeFrames(path)[ring];
  const direction = new Vector3(end).subtract(path[ring]);
  const angle = Math.atan2(direction.dot(up), direction.dot(side));
  return (Math.round((angle / (Math.PI * 2)) * count) - 1 + count * 2) % count;
}

type GrowthNode = {point: TreePoint; parent: number; children: number[]; load: number};

/**
 * Bounded space colonization (Runions et al., 2007). Nearest shoots consume crown
 * attractors; normalized attraction vectors, apical persistence and tropism steer growth.
 * Pipe-model radii are accumulated from terminal shoots, rather than fixed fork ratios.
 * This is procedural morphology, not a fitted biological growth simulation.
 */
export function getTreeBotany(type: TreeType, characteristics?: TreeCharacteristics): TreeBotany {
  const traits = resolveTreeCharacteristics(characteristics);
  const key = `${type}-${getTreeCharacteristicsKey(traits)}`;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const rng = createTreeRng(
    (type.split('').reduce((seed, letter) => seed * 31 + letter.charCodeAt(0), 137) +
      traits.seed) >>>
      0
  );
  const banyan = type === 'banyan',
    mangrove = type === 'mangrove',
    birch = type === 'birch',
    citrus = type === 'citrus';
  const heights = [
    -1, -0.8, -0.6, -0.4, -0.2, 0, 0.1, 0.22, 0.238, 0.256, 0.274, 0.292, 0.31, 0.328, 0.346
  ];
  const stem: TreePoint[] = heights.map(z => [z > 0.1 ? Math.sin((z - 0.1) * 6) * 0.008 : 0, 0, z]);
  const radii = heights.map(z => 0.06 * (1 - Math.max(0, z - 0.1) * 1.7));
  const center: TreePoint = [0.025, -0.018, banyan ? 0.68 : mangrove ? 0.66 : birch ? 0.67 : 0.63];
  const extent: TreePoint = banyan
    ? [0.68, 0.6, 0.29]
    : mangrove
      ? [0.46, 0.42, 0.33]
      : birch
        ? [0.3, 0.31, 0.43]
        : citrus
          ? [0.47, 0.44, 0.34]
          : [0.46, 0.43, 0.38];
  extent[0] *= traits.crownSpread;
  extent[1] *= traits.crownSpread;
  extent[2] *= traits.crownDepth;
  // Smooth azimuthal harmonics break rotational symmetry without disconnected blobs.
  const phase = rng() * Math.PI * 2;
  const attractors: TreePoint[] = [];
  for (let i = 0; i < Math.round(520 * traits.branchDensity); i++) {
    const z = rng() * 2 - 1,
      angle = rng() * Math.PI * 2;
    const r = Math.cbrt(0.08 + rng() * 0.92);
    const lobe =
      1 +
      traits.crownAsymmetry *
        (0.11 * Math.sin(angle * 3 + phase) + 0.055 * Math.cos(angle * 5 - phase));
    const xy = Math.sqrt(1 - z * z) * r * lobe;
    attractors.push([
      center[0] + Math.cos(angle) * extent[0] * xy,
      center[1] + Math.sin(angle) * extent[1] * xy,
      center[2] + z * r * extent[2]
    ]);
  }
  const nodes: GrowthNode[] = [];
  const primaryCount = birch ? 4 : 5;
  const roots: number[] = [];
  for (let i = 0; i < primaryCount; i++) {
    const angle = (i * Math.PI * 2) / primaryCount + phase + (rng() - 0.5) * 0.5;
    const socket = stem[8 + i];
    roots.push(nodes.length);
    nodes.push({
      point: [socket[0] + Math.cos(angle) * 0.095, Math.sin(angle) * 0.095, socket[2] + 0.09],
      parent: -1,
      children: [],
      load: 0
    });
  }
  const step = 0.036 * traits.internodeLength,
    influence = 0.45,
    kill = 0.055;
  let active = attractors;
  // 520 attractors, 600 nodes and 64 iterations are per shared species template, never per tree.
  for (let iteration = 0; iteration < 64 && active.length && nodes.length < 600; iteration++) {
    const directions = new Map<number, Vector3>();
    const remaining: TreePoint[] = [];
    for (const point of active) {
      let nearest = -1,
        distance = influence * influence;
      for (let n = 0; n < nodes.length; n++) {
        const other = nodes[n].point;
        const dx = point[0] - other[0],
          dy = point[1] - other[1],
          dz = point[2] - other[2];
        const delta = dx * dx + dy * dy + dz * dz;
        if (delta < distance) {
          distance = delta;
          nearest = n;
        }
      }
      if (distance < kill * kill) continue;
      remaining.push(point);
      if (nearest < 0 || nodes[nearest].children.length >= 2) continue;
      const direction = new Vector3(point).subtract(nodes[nearest].point).normalize();
      const sum = directions.get(nearest) ?? new Vector3();
      directions.set(nearest, sum.add(direction));
    }
    active = remaining;
    if (!directions.size) break;
    for (const [index, attraction] of directions) {
      const node = nodes[index];
      const direction = attraction.normalize();
      if (node.parent >= 0)
        direction.add(
          new Vector3(node.point).subtract(nodes[node.parent].point).normalize().scale(0.3)
        );
      direction
        .add([0, 0, (birch ? 0.16 : banyan ? 0.025 : citrus ? 0.045 : 0.07) * traits.branchLift])
        .normalize();
      const point = Array.from(new Vector3(node.point).add(direction.scale(step))) as TreePoint;
      if (
        nodes.some(other => {
          const dx = point[0] - other.point[0],
            dy = point[1] - other.point[1],
            dz = point[2] - other.point[2];
          return dx * dx + dy * dy + dz * dz < (step * 0.65) ** 2;
        })
      )
        continue;
      node.children.push(nodes.length);
      nodes.push({point, parent: index, children: [], load: 0});
      if (nodes.length >= 600) break;
    }
  }
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    node.load = node.children.length
      ? node.children.reduce((sum, child) => sum + nodes[child].load, 0)
      : 1;
  }
  const totalLoad = roots.reduce((sum, index) => sum + nodes[index].load, 0);
  // Leonardo/pipe rule r^2.3 = sum(child r^2.3), with a small terminal twig radius.
  const radius = (index: number) =>
    Math.max(0.0018, 0.043 * (nodes[index].load / totalLoad) ** (1 / 2.3));
  const clusters: LeafCluster[] = [];
  const makeBranch = (
    first: number,
    parent: TreePoint[],
    ring: number,
    count: number
  ): TreeBranch => {
    const chain = [first];
    let cursor = first;
    while (nodes[cursor].children.length) {
      cursor = [...nodes[cursor].children].sort((a, b) => nodes[b].load - nodes[a].load)[0];
      chain.push(cursor);
    }
    const start = new Vector3(parent[ring]).lerp(parent[ring + 1], 0.5);
    const path: TreePoint[] = [Array.from(start.lerp(nodes[first].point, 0.25)) as TreePoint];
    const branchRadii = [radius(first)];
    for (let j = 0; j < chain.length; j++) {
      const a = j === 0 ? path[0] : nodes[chain[j - 1]].point,
        b = nodes[chain[j]].point;
      path.push(Array.from(new Vector3(a).lerp(b, 0.5)) as TreePoint, b);
      branchRadii.push(radius(chain[j]), radius(chain[j]));
    }
    if (path.length < 3) throw new Error('Tree shoot path is incomplete.');
    const branch: TreeBranch = {
      ring,
      sector: getSocketSector(parent, ring, nodes[first].point, count),
      path,
      radius: branchRadii[0],
      radii: branchRadii,
      children: []
    };
    for (let j = 0; j < chain.length; j++) {
      const node = nodes[chain[j]];
      for (const child of node.children)
        if (child !== chain[j + 1])
          branch.children.push(makeBranch(child, path, Math.max(0, j * 2 + 1), 12));
      // Leaf-bearing shoots, not opaque envelope surfaces. Overlapping clusters fill
      // the crown interior; outer tips form a coherent irregular silhouette.
      if (!node.children.length || (node.load <= 4 && j % 3 === 0)) {
        const previous = j ? nodes[chain[j - 1]].point : parent[ring];
        const shoot = new Vector3(node.point).subtract(previous).normalize();
        const size =
          (banyan ? 0.125 : mangrove ? 0.115 : birch ? 0.108 : 0.13) * (0.8 + rng() * 0.4);
        clusters.push({
          center: Array.from(
            new Vector3(node.point).add(new Vector3(shoot).scale(0.012))
          ) as TreePoint,
          radius: [size, size * (0.85 + rng() * 0.2), size * (birch ? 1.1 : banyan ? 0.75 : 0.95)],
          shoot: Array.from(shoot) as TreePoint,
          fruitBearing: true
        });
      }
    }
    return branch;
  };
  const branches = roots.map((index, i) => makeBranch(index, stem, 8 + i, 24));
  const addRoot = (
    parent: TreePoint[],
    ring: number,
    end: TreePoint,
    width: number,
    count: number,
    arch: number
  ) => {
    const start = new Vector3(parent[ring]).lerp(parent[ring + 1], 0.5);
    const path = Array.from({length: 12}, (_, i) => {
      const t = 0.03 + (i / 11) * 0.97;
      const point = new Vector3(start).lerp(end, t);
      point.z += Math.sin(t * Math.PI) * arch;
      return Array.from(point) as TreePoint;
    });
    return {
      ring,
      sector: getSocketSector(parent, ring, end, count),
      path,
      radius: width,
      radii: path.map((_, i) => width * (1 - (0.35 * i) / 11)),
      rooted: true,
      children: []
    } as TreeBranch;
  };
  if (banyan) {
    // Aerial roots descend from spreading limbs, becoming connected woody pillars.
    for (const branch of branches) {
      let ring = Math.min(
        branch.path.length - 2,
        Math.max(2, Math.floor(branch.path.length * 0.45))
      );
      while (branch.children.some(child => child.ring === ring) && ring < branch.path.length - 2)
        ring++;
      if (branch.children.some(child => child.ring === ring)) continue;
      const point = branch.path[ring];
      branch.children.push(
        addRoot(branch.path, ring, [point[0] * 1.1, point[1] * 1.1, -1], 0.014, 12, -0.04)
      );
    }
  } else if (mangrove) {
    // Red mangrove rhizophores arch outward from the lower bole to form stilt roots.
    for (let i = 0; i < 7; i++) {
      const angle = (i * Math.PI * 2) / 7 + phase;
      branches.push(
        addRoot(
          stem,
          5 + (i % 3),
          [Math.cos(angle) * (0.32 + rng() * 0.12), Math.sin(angle) * (0.32 + rng() * 0.12), -1],
          0.021,
          24,
          0.18
        )
      );
    }
  }
  const botany = {stem, radii, branches, clusters};
  CACHE.set(key, botany);
  return botany;
}

/** Fruit centers use the same shoots as the leaf source; its complete sphere must fit. */
export function sampleTreeFruit(
  type: TreeType,
  levels: number,
  rng: () => number,
  scale: TreePoint,
  fruitRadius: number,
  characteristics?: TreeCharacteristics
): TreePoint | null {
  if (!scale.every(value => value > 0)) return null;
  const margin = scale.map(value => fruitRadius / value) as TreePoint;
  if (type === 'palm') {
    // Coconuts attach just below the frond sockets, inside the crown's central collar.
    if (Math.max(...margin) > 0.065) return null;
    const angle = rng() * Math.PI * 2;
    return [Math.cos(angle) * 0.055, Math.sin(angle) * 0.055, 0.42 - margin[2]];
  }
  if (type === 'pine') {
    const theta = rng() * Math.PI * 2;
    const z = 0.2 + rng() * 0.38;
    const outer = samplePineSurface(levels, z, theta);
    const radial = Math.hypot(outer[0], outer[1]);
    const clearance = Math.max(margin[0], margin[1]) + margin[2] * 2;
    if (radial * 0.65 <= clearance || z + margin[2] >= createPineTiers(levels).tipStart[2])
      return null;
    const ratio = (radial * 0.65 - clearance) / radial;
    return [outer[0] * ratio, outer[1] * ratio, z];
  }
  const clusters = getTreeBotany(type, characteristics).clusters;
  const start = Math.floor(rng() * clusters.length);
  const theta = rng() * Math.PI * 2;
  const z = rng() * 2 - 1;
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[(start + i) % clusters.length];
    if (!cluster.fruitBearing) continue;
    // Ellipsoid norm obeys the triangle inequality. Reserve the sphere's largest norm,
    // plus a leaf-sized margin, before placing its center near the woody shoot.
    const sphereNorm = Math.max(...margin.map((value, axis) => value / cluster.radius[axis]));
    const available = 0.7 - sphereNorm;
    if (available <= 0) continue;
    const distance = Math.min(0.22, available);
    return cluster.center.map(
      (value, axis) =>
        value +
        distance *
          cluster.radius[axis] *
          (axis === 2 ? z : Math.sqrt(1 - z * z) * (axis === 0 ? Math.cos(theta) : Math.sin(theta)))
    ) as TreePoint;
  }
  return null;
}
