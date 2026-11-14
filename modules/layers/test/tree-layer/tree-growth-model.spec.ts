// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it, vi} from 'vitest';
import {
  getTreeGrowthModel,
  isTreeGrowthSpecies,
  TREE_CITRUS_BUD_UNION_Z,
  TREE_ROOT_PLATE_RADII,
  TREE_ROOT_PLATE_THICKNESS,
  type TreeGrowthSpecies
} from '../../src/tree-layer/tree-growth-model';
import {
  getTreeCrownFraction,
  getTreeHeightFraction,
  getTreeRingRadius,
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  TREE_RADIAL_EXPONENT,
  TREE_SHOOT_MATURING,
  TREE_SHOOT_RADIUS,
  TREE_WOOD_FLAG,
  type TreeGrowthModel
} from '../../src/tree-layer/tree-photoreal-layout';
import {
  getTreeCharacteristicsKey,
  resolveTreeCharacteristics
} from '../../src/tree-layer/tree-characteristics';

// Many tests grow several templates, each of a few hundred milliseconds, more on a busy machine.
vi.setConfig({testTimeout: 30000});

const SPECIES: TreeGrowthSpecies[] = ['oak', 'birch', 'cherry', 'banyan', 'mangrove', 'citrus'];

/** Mature crown radius and trunk radius of a citrus template, over its height. */
const CITRUS_ASPECT = 0.52;
const CITRUS_TRUNK_RATIO = 0.025;

/** Checks that run per vertex or per ring are counted, because one `expect` each is very slow. */
class Violations {
  private found = new Map<string, number>();
  check(condition: boolean, message: string): void {
    if (!condition) this.found.set(message, (this.found.get(message) ?? 0) + 1);
  }
  expectNone(): void {
    expect(Object.fromEntries(this.found)).toEqual({});
  }
}

type Ring = {
  index: number;
  firstVertex: number;
  vertexCount: number;
  x: number;
  y: number;
  z: number;
  birth: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  previousBirth: number;
  /** Mean mature radius over the ring's vertices. */
  radius: number;
  /** A collar's ring, whose vertices each have their own center, radial and bark. */
  shaped: boolean;
  barkV: number;
  limbA: number;
  limbB: number;
  order: number;
  seed: number;
  flags: number;
  /** The ring this one grows from, or -1. */
  predecessor: number;
  /** Rings that grow from this one. */
  successors: number[];
};

type Tube = {rings: Ring[]; socket: Ring | null};

type Wood = {rings: Ring[]; tubes: Tube[]};

/** Rebuilds rings and tubes from the wood arrays alone, trusting nothing else from the generator. */
function readWood(model: TreeGrowthModel): Wood {
  const {wood} = model;
  const rings: Ring[] = [];
  let start = 0;
  for (let vertex = 1; vertex <= wood.vertexCount; vertex++) {
    // All vertices of a ring are born together, and rings of a tube never are. An apex is one
    // vertex.
    if (
      vertex < wood.vertexCount &&
      wood.radial[start * 4 + 3] > 0 &&
      wood.center[vertex * 4 + 3] === wood.center[start * 4 + 3] &&
      wood.previous[vertex * 4 + 3] === wood.previous[start * 4 + 3]
    ) {
      continue;
    }
    const count = vertex - start;
    let radius = 0;
    // Skip the duplicated seam vertex in the mean.
    const distinct = count > 1 ? count - 1 : 1;
    for (let side = 0; side < distinct; side++) radius += wood.radial[(start + side) * 4 + 3];
    const v = start * 4;
    rings.push({
      index: rings.length,
      firstVertex: start,
      vertexCount: count,
      x: wood.center[v],
      y: wood.center[v + 1],
      z: wood.center[v + 2],
      birth: wood.center[v + 3],
      previousX: wood.previous[v],
      previousY: wood.previous[v + 1],
      previousZ: wood.previous[v + 2],
      previousBirth: wood.previous[v + 3],
      radius: radius / distinct,
      shaped: (wood.shade[v + 3] & TREE_WOOD_FLAG.COLLAR) !== 0,
      barkV: wood.bark[v + 1],
      limbA: wood.bark[v + 2],
      limbB: wood.bark[v + 3],
      order: wood.shade[v + 1],
      seed: wood.shade[v + 2],
      flags: wood.shade[v + 3],
      predecessor: -1,
      successors: []
    });
    start = vertex;
  }
  const byCenter = new Map<string, Ring>();
  for (const ring of rings) {
    // A socket and its child's first ring can share a position, but never a birth.
    byCenter.set(`${ring.x},${ring.y},${ring.z},${ring.birth}`, ring);
  }
  const tubes: Tube[] = [];
  let current: Tube | null = null;
  for (const ring of rings) {
    const before = rings[ring.index - 1];
    const continues =
      before &&
      before.vertexCount > 1 &&
      ring.previousX === before.x &&
      ring.previousY === before.y &&
      ring.previousZ === before.z &&
      ring.previousBirth === before.birth;
    if (continues && current) {
      current.rings.push(ring);
      ring.predecessor = before.index;
      before.successors.push(ring.index);
    } else {
      const key = `${ring.previousX},${ring.previousY},${ring.previousZ},${ring.previousBirth}`;
      const socket = byCenter.get(key) ?? null;
      if (socket && socket !== ring) {
        ring.predecessor = socket.index;
        socket.successors.push(ring.index);
      }
      current = {rings: [ring], socket: socket === ring ? null : socket};
      tubes.push(current);
    }
  }
  return {rings, tubes};
}

function isPlainWood(ring: Ring): boolean {
  return ring.flags === 0;
}

function getWoodEnvelope(rings: readonly Ring[], growth: number) {
  let height = 0;
  let radius = 0;
  for (const ring of rings) {
    if (!isPlainWood(ring) || ring.birth > growth) continue;
    height = Math.max(height, ring.z);
    radius = Math.max(radius, Math.hypot(ring.x, ring.y));
  }
  return {height, radius};
}

/** Distance in tree heights, with x and y brought back from crown radii to citrus proportions. */
function physicalDistance(a: Ring, b: Ring): number {
  return Math.hypot((a.x - b.x) * CITRUS_ASPECT, (a.y - b.y) * CITRUS_ASPECT, a.z - b.z);
}

function arc(rings: Ring[], from = 0, to = rings.length - 1): number {
  let sum = 0;
  for (let index = from + 1; index <= to; index++) {
    sum += physicalDistance(rings[index - 1], rings[index]);
  }
  return sum;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function spreadOf(values: number[]): {mean: number; deviation: number} {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return {mean, deviation: Math.sqrt(variance)};
}

function coefficientOfVariation(values: number[]): number {
  const {mean, deviation} = spreadOf(values);
  return deviation / mean;
}

function getLeaf(model: TreeGrowthModel, index: number) {
  const o = index * TREE_LEAF_STRIDE;
  const l = model.leaves;
  return {
    x: l[o],
    y: l[o + 1],
    z: l[o + 2],
    length: l[o + 3],
    q: [l[o + 4], l[o + 5], l[o + 6], l[o + 7]] as [number, number, number, number],
    birth: l[o + 8],
    death: l[o + 9],
    seed: l[o + 10],
    shell: l[o + 11],
    limbA: l[o + 12],
    limbB: l[o + 13],
    tipness: l[o + 14],
    width: l[o + 15]
  };
}

function rotate(
  [qx, qy, qz, qw]: [number, number, number, number],
  [x, y, z]: [number, number, number]
): [number, number, number] {
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx
  ];
}

/** Whether a template point lies near wood that exists by a given growth. */
function createWoodLookup(rings: Ring[]) {
  const cell = 0.08;
  const grid = new Map<string, Ring[]>();
  const keyOf = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (const ring of rings) {
    if (!isPlainWood(ring)) continue;
    const key = keyOf(ring.x, ring.y, ring.z);
    const list = grid.get(key);
    if (list) list.push(ring);
    else grid.set(key, [ring]);
  }
  return (x: number, y: number, z: number, growth: number, reach: number): Ring | null => {
    let best: Ring | null = null;
    let bestDistance = reach;
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    const iz = Math.floor(z / cell);
    for (let cz = iz - 1; cz <= iz + 1; cz++) {
      for (let cy = iy - 1; cy <= iy + 1; cy++) {
        for (let cx = ix - 1; cx <= ix + 1; cx++) {
          for (const ring of grid.get(`${cx},${cy},${cz}`) ?? []) {
            if (ring.birth > growth) continue;
            const distance = Math.hypot(ring.x - x, ring.y - y, ring.z - z);
            if (distance < bestDistance) {
              bestDistance = distance;
              best = ring;
            }
          }
        }
      }
    }
    return best;
  };
}

/** Farthest living leaf in each angular sector at each height. */
function getMatureCrownReach(
  model: TreeGrowthModel,
  bands: number,
  sectors: number,
  from = 0,
  to = 1
): number[] {
  const reach = new Array<number>(bands * sectors).fill(0);
  for (let index = 0; index < model.leafCount; index++) {
    const leaf = getLeaf(model, index);
    if (leaf.death <= 1 || leaf.z < from || leaf.z > to) continue;
    const band = Math.min(bands - 1, Math.floor(((leaf.z - from) / (to - from)) * bands));
    const angle = (Math.atan2(leaf.y, leaf.x) + Math.PI) / (2 * Math.PI);
    const cell = band * sectors + Math.min(sectors - 1, Math.floor(angle * sectors));
    reach[cell] = Math.max(reach[cell], Math.hypot(leaf.x, leaf.y));
  }
  return reach;
}

const citrus = getTreeGrowthModel('citrus', {seed: 7});
const citrusWood = readWood(citrus);

describe('getTreeGrowthModel contract', () => {
  it('is deterministic for a seed: a fresh module grows byte-identical arrays', async () => {
    vi.resetModules();
    const fresh = await import('../../src/tree-layer/tree-growth-model');
    const again = fresh.getTreeGrowthModel('citrus', {seed: 7});
    expect(again === citrus).toBe(false);
    expect(again.key).toBe(citrus.key);
    expect(again.leafCount).toBe(citrus.leafCount);
    expect(again.limbCount).toBe(citrus.limbCount);
    expect(again.wood.vertexCount).toBe(citrus.wood.vertexCount);
    expect(again.forkZ).toBe(citrus.forkZ);
    expect(again.wood.lodIndexCounts).toEqual(citrus.wood.lodIndexCounts);
    expect(again.lodLeafCounts).toEqual(citrus.lodLeafCounts);
    const same = (a: ArrayBufferView, b: ArrayBufferView) =>
      Buffer.from(a.buffer).equals(Buffer.from(b.buffer));
    for (const name of ['center', 'previous', 'radial', 'bark', 'shade', 'indices'] as const) {
      expect(same(again.wood[name], citrus.wood[name])).toBe(true);
    }
    for (const name of ['leaves', 'cropAnchors', 'limbs'] as const) {
      expect(same(again[name], citrus[name])).toBe(true);
    }
  });

  it('memoizes by species and characteristics, with quantized slider values', () => {
    const model = getTreeGrowthModel('citrus', {seed: 70});
    expect(getTreeGrowthModel('citrus', {seed: 70}) === model).toBe(true);
    expect(getTreeGrowthModel('citrus', {seed: 70, branchWander: 1.001}) === model).toBe(true);
    expect(getTreeGrowthModel('citrus', {seed: 71}) === model).toBe(false);
    expect(model.key).toBe(`citrus-${getTreeCharacteristicsKey({seed: 70})}`);
  });

  it('gives different trees for different seeds', () => {
    const other = readWood(getTreeGrowthModel('citrus', {seed: 8}));
    const firstRings = (wood: Wood) =>
      wood.rings
        .filter(ring => ring.order === 1 && isPlainWood(ring))
        .slice(0, 40)
        .map(ring => [ring.x, ring.y, ring.z]);
    expect(firstRings(other)).not.toEqual(firstRings(citrusWood));
    expect(other.rings.length).not.toBe(citrusWood.rings.length);
  });

  it('refuses species without a growth model', () => {
    expect(isTreeGrowthSpecies('citrus')).toBe(true);
    expect(isTreeGrowthSpecies('palm')).toBe(false);
    expect(isTreeGrowthSpecies('toString')).toBe(false);
    expect(() => getTreeGrowthModel('palm')).toThrow(/photoreal/);
    expect(() => getTreeGrowthModel('pine')).toThrow(/photoreal/);
  });

  it('resolves the new characteristics into their ranges, with defaults of 1', () => {
    const traits = resolveTreeCharacteristics({branchWander: 9, twigDroop: -4});
    expect(traits.branchWander).toBe(2);
    expect(traits.twigDroop).toBe(0);
    expect(resolveTreeCharacteristics().branchWander).toBe(1);
    expect(resolveTreeCharacteristics().twigDroop).toBe(1);
    expect(resolveTreeCharacteristics({branchWander: Number.NaN}).branchWander).toBe(1);
    expect(getTreeCharacteristicsKey({twigDroop: 0.5})).not.toBe(getTreeCharacteristicsKey());
    expect(getTreeCharacteristicsKey({branchWander: 0.5})).not.toBe(getTreeCharacteristicsKey());
  });
});

describe.each(SPECIES)('%s template', type => {
  const model = getTreeGrowthModel(type, {seed: 3});
  const {rings, tubes} = readWood(model);
  const trunk = tubes[0].rings;

  it('has only finite values and indices in bounds', () => {
    const {wood} = model;
    for (const array of [wood.center, wood.previous, wood.radial, wood.bark, wood.shade]) {
      expect(array.length).toBe(wood.vertexCount * 4);
      expect(array.every(Number.isFinite)).toBe(true);
    }
    expect(model.leaves.every(Number.isFinite)).toBe(true);
    expect(model.cropAnchors.every(Number.isFinite)).toBe(true);
    expect(model.limbs.every(Number.isFinite)).toBe(true);
    expect(wood.indices.length % 3).toBe(0);
    expect(wood.indices.every(index => index < wood.vertexCount)).toBe(true);
    expect(model.leaves.length).toBe(model.leafCount * TREE_LEAF_STRIDE);
    expect(model.cropAnchors.length).toBe(model.cropAnchorCount * TREE_CROP_ANCHOR_STRIDE);
    expect(model.limbs.length).toBe(model.limbCount * TREE_LIMB_STRIDE);
    const violations = new Violations();
    for (let vertex = 0; vertex < wood.vertexCount; vertex++) {
      const length = Math.hypot(
        wood.radial[vertex * 4],
        wood.radial[vertex * 4 + 1],
        wood.radial[vertex * 4 + 2]
      );
      violations.check(Math.abs(length - 1) < 1e-3, 'radial is not a unit vector');
      violations.check(wood.radial[vertex * 4 + 3] >= 0, 'radius is negative');
      // A collar's first rings take bark u from the parent, running on around the loop.
      violations.check(wood.bark[vertex * 4] > -2 && wood.bark[vertex * 4] < 3, 'bark u range');
      violations.check(wood.shade[vertex * 4] >= 0 && wood.shade[vertex * 4] <= 1, 'occlusion');
      violations.check(wood.shade[vertex * 4 + 2] >= 0 && wood.shade[vertex * 4 + 2] < 1, 'seed');
    }
    for (let index = 0; index < wood.indices.length; index += 3) {
      const a = wood.indices[index];
      const b = wood.indices[index + 1];
      const c = wood.indices[index + 2];
      violations.check(a !== b && b !== c && a !== c, 'triangle repeats a vertex');
    }
    violations.expectNone();
  });

  it('has valid limbs, with limb 0 the identity that never breaks', () => {
    expect(model.limbCount).toBeGreaterThan(5);
    expect(model.limbs[3]).toBeGreaterThan(1);
    expect(model.limbs[7]).toBe(0);
    const count = model.limbCount;
    const violations = new Violations();
    for (let vertex = 0; vertex < model.wood.vertexCount; vertex++) {
      const a = model.wood.bark[vertex * 4 + 2];
      const b = model.wood.bark[vertex * 4 + 3];
      violations.check(Number.isInteger(a) && a >= 0 && a < count, 'wood limb A');
      violations.check(Number.isInteger(b) && b >= 0 && b < count, 'wood limb B');
    }
    for (let leaf = 0; leaf < model.leafCount; leaf++) {
      const {limbA, limbB} = getLeaf(model, leaf);
      violations.check(Number.isInteger(limbA) && limbA >= 0 && limbA < count, 'leaf limb A');
      violations.check(Number.isInteger(limbB) && limbB >= 0 && limbB < count, 'leaf limb B');
    }
    for (let limb = 1; limb < count; limb++) {
      const o = limb * TREE_LIMB_STRIDE;
      const breakAt = model.limbs[o + 3];
      violations.check(breakAt > 0 && breakAt <= 1, 'limb breakAt');
      violations.check(
        Math.abs(Math.hypot(model.limbs[o + 4], model.limbs[o + 5], model.limbs[o + 6]) - 1) < 1e-3,
        'limb direction'
      );
      violations.check(model.limbs[o + 7] > 0, 'limb length');
    }
    // The trunk belongs to no limb.
    for (const ring of trunk) violations.check(ring.limbA === 0 && ring.limbB === 0, 'trunk limb');
    violations.expectNone();
  });

  it('breaks a thinner limb before the limb it grows on', () => {
    let nested = 0;
    const violations = new Violations();
    for (const ring of rings) {
      if (ring.limbA === 0 || ring.limbB === 0) continue;
      nested++;
      const outer = model.limbs[ring.limbA * TREE_LIMB_STRIDE + 3];
      const inner = model.limbs[ring.limbB * TREE_LIMB_STRIDE + 3];
      violations.check(inner < outer, 'inner limb breaks after its outer limb');
    }
    violations.expectNone();
    expect(nested).toBeGreaterThan(100);
  });

  it('links every ring to its actual predecessor, with births never decreasing', () => {
    const violations = new Violations();
    for (const tube of tubes) {
      const first = tube.rings[0];
      if (first.flags & TREE_WOOD_FLAG.SOIL || first.shaped) continue;
      if (tube === tubes[0]) {
        // The stem starts from itself at germination.
        expect(first.previousX).toBe(first.x);
        expect(first.previousBirth).toBe(0);
        expect(first.birth).toBeGreaterThan(0);
      } else {
        violations.check(tube.socket !== null, 'first ring has no socket');
        if (tube.socket) {
          violations.check(first.birth > tube.socket.birth, 'child born before its socket');
          violations.check(first.previousBirth === tube.socket.birth, 'socket birth');
          // A collar's first ring has the parent's own bark, on both sides of the socket.
          if (!first.shaped) {
            violations.check(first.barkV >= tube.socket.barkV, 'bark v restarts at a socket');
          }
        }
      }
      for (let index = 1; index < tube.rings.length; index++) {
        const ring = tube.rings[index];
        const before = tube.rings[index - 1];
        violations.check(ring.previousX === before.x, 'previous x');
        violations.check(ring.previousY === before.y, 'previous y');
        violations.check(ring.previousZ === before.z, 'previous z');
        violations.check(ring.previousBirth === before.birth, 'previous birth');
        violations.check(ring.birth > before.birth, 'births not increasing');
        if (!before.shaped) violations.check(ring.barkV >= before.barkV, 'bark v decreases');
      }
      violations.check(tube.rings[tube.rings.length - 1].birth < 1, 'born at or after maturity');
    }
    violations.expectNone();
  });

  it('holds a ring to one center and closes it at a duplicate seam vertex', () => {
    const {wood} = model;
    const violations = new Violations();
    for (const ring of rings) {
      const last = ring.firstVertex + ring.vertexCount - 1;
      if (ring.vertexCount > 1) {
        if (!ring.shaped) violations.check(wood.bark[last * 4] === 1, 'bark u does not end at 1');
        for (let axis = 0; axis < 3; axis++) {
          const seam = wood.radial[ring.firstVertex * 4 + axis] - wood.radial[last * 4 + axis];
          violations.check(Math.abs(seam) < 1e-5, 'seam radial differs');
        }
        const width = wood.radial[ring.firstVertex * 4 + 3] - wood.radial[last * 4 + 3];
        violations.check(Math.abs(width) < 1e-3, 'seam radius differs');
      }
      if (ring.flags & TREE_WOOD_FLAG.SOIL || ring.shaped) continue;
      for (let vertex = ring.firstVertex; vertex <= last; vertex++) {
        violations.check(wood.center[vertex * 4] === ring.x, 'center x varies');
        violations.check(wood.center[vertex * 4 + 2] === ring.z, 'center z varies');
        violations.check(wood.center[vertex * 4 + 3] === ring.birth, 'birth varies');
        violations.check(wood.previous[vertex * 4 + 3] === ring.previousBirth, 'previous varies');
      }
    }
    violations.expectNone();
  });

  it('has a trunk base radius of about 1 before its flare, and tapers along every tube', () => {
    const aboveFlare = trunk.filter(
      ring => ring.z > model.forkZ * 0.45 && ring.z < model.forkZ * 0.75
    );
    expect(aboveFlare.length).toBeGreaterThan(1);
    for (const ring of aboveFlare) {
      expect(ring.radius).toBeGreaterThan(0.72);
      expect(ring.radius).toBeLessThan(1.12);
    }
    expect(trunk[0].radius).toBeGreaterThan(1.1);
    expect(trunk[0].radius).toBeLessThan(2);
    const violations = new Violations();
    for (const tube of tubes) {
      if (!isPlainWood(tube.rings[0])) continue;
      // Past any collar, whose rings are as wide as the parent where they leave it.
      const body = tube.rings.filter(ring => !ring.shaped);
      const base = body[0].radius;
      violations.check(tube.rings[tube.rings.length - 1].radius === 0, 'tube does not close');
      if (tube !== tubes[0] && tube.rings[0].order > 1) {
        violations.check(base <= tube.socket!.radius * 1.3, 'child much thicker than its socket');
      }
      // Knobbly and with shoulders at forks, but never growing much thicker on the way out.
      let thinnest = base;
      for (const ring of body) {
        violations.check(ring.radius <= thinnest * 1.4 + 2e-3, 'tube thickens on the way out');
        thinnest = Math.min(thinnest, ring.radius || thinnest);
      }
      violations.check(
        tube.rings.length < 3 || tube.rings[tube.rings.length - 2].radius <= base,
        'tube ends thicker than it starts'
      );
      // A real twig floor: nothing thinner than about 0.0085 of the trunk before its tip closes.
      for (const ring of tube.rings.slice(0, -2)) {
        violations.check(ring.radius > 0.005, 'below the twig floor');
      }
    }
    violations.expectNone();
  });

  it('obeys the pipe model at forks, within tolerance', () => {
    const ratios: number[] = [];
    for (const ring of rings) {
      if (!isPlainWood(ring) || ring.radius < 0.05) continue;
      const children = ring.successors.filter(index => isPlainWood(rings[index]));
      if (children.length < 2) continue;
      let sum = 0;
      for (const child of children) {
        // Measure past the collar flare, which takes up to four rings.
        let ahead = rings[child];
        for (let step = 0; step < (ahead.shaped ? 6 : 2); step++) {
          const next = rings[ahead.index + 1];
          if (!next || next.predecessor !== ahead.index || next.radius === 0) break;
          ahead = next;
        }
        sum += Math.pow(ahead.radius, 2.4);
      }
      ratios.push(sum / Math.pow(ring.radius, 2.4));
    }
    expect(ratios.length).toBeGreaterThan(40);
    expect(median(ratios)).toBeGreaterThan(0.7);
    expect(median(ratios)).toBeLessThan(1.3);
    expect(
      ratios.filter(ratio => ratio > 0.45 && ratio < 1.75).length / ratios.length
    ).toBeGreaterThan(0.88);
  });

  it('orders indices from trunk to twigs, with strictly descending LODs', () => {
    const {wood} = model;
    const [lod0, lod1, lod2, lod3] = wood.lodIndexCounts;
    expect(lod0).toBe(wood.indices.length);
    expect(lod0).toBeGreaterThan(lod1);
    expect(lod1).toBeGreaterThan(lod2);
    expect(lod2).toBeGreaterThan(lod3);
    expect(lod3).toBeGreaterThan(0);
    for (const count of wood.lodIndexCounts) expect(count % 3).toBe(0);
    // Every trunk vertex is in the coarsest prefix.
    const coarsest = new Set(wood.indices.subarray(0, lod3));
    for (const ring of trunk) {
      for (let v = ring.firstVertex; v < ring.firstVertex + ring.vertexCount; v++) {
        expect(coarsest.has(v)).toBe(true);
      }
    }
    // Each prefix reaches thinner wood than the one before.
    const finestRadius = (count: number) => {
      let finest = Infinity;
      for (let index = 0; index < count; index++) {
        const radius = wood.radial[wood.indices[index] * 4 + 3];
        if (radius > 0 && wood.shade[wood.indices[index] * 4 + 3] === 0) {
          finest = Math.min(finest, radius);
        }
      }
      return finest;
    };
    expect(finestRadius(lod2)).toBeLessThanOrEqual(finestRadius(lod3));
    expect(finestRadius(lod1)).toBeLessThan(finestRadius(lod3));
    expect(finestRadius(lod0)).toBeLessThan(finestRadius(lod1));
    // Thorns are drawn only in the finest LOD.
    let thornsInCoarseLod = 0;
    for (let index = 0; index < lod1; index++) {
      if (wood.shade[wood.indices[index] * 4 + 3] & TREE_WOOD_FLAG.THORN) thornsInCoarseLod++;
    }
    expect(thornsInCoarseLod).toBe(0);
  });

  it('has leaf LODs a prefix of about 4x fewer, each an even sample of the crown', () => {
    const [n0, n1, n2, n3] = model.lodLeafCounts;
    expect(n0).toBe(model.leafCount);
    expect(n0).toBeGreaterThan(n1);
    expect(n1).toBeGreaterThan(n2);
    expect(n2).toBeGreaterThan(n3);
    expect(n1 / n0).toBeCloseTo(0.25, 2);
    expect(n2 / n1).toBeCloseTo(0.25, 2);
    expect(n3 / n2).toBeCloseTo(0.25, 2);
    const axisOf = (count: number, field: number) => {
      const values: number[] = [];
      for (let leaf = 0; leaf < count; leaf++) {
        values.push(model.leaves[leaf * TREE_LEAF_STRIDE + field]);
      }
      return spreadOf(values);
    };
    for (const field of [0, 1, 2]) {
      const full = axisOf(n0, field);
      for (const count of [n1, n2, n3]) {
        const sample = axisOf(count, field);
        expect(Math.abs(sample.mean - full.mean)).toBeLessThan(full.deviation * 0.09);
        expect(Math.abs(sample.deviation - full.deviation)).toBeLessThan(full.deviation * 0.09);
      }
    }
  });

  it('tracks the height and crown fractions as it grows', () => {
    for (const growth of [0.05, 0.1, 0.2, 0.25, 0.35, 0.5, 0.7, 0.85, 1]) {
      const {height, radius} = getWoodEnvelope(rings, growth);
      expect(Math.abs(height - getTreeHeightFraction(growth))).toBeLessThan(0.07);
      if (growth >= 0.25) {
        const crown = getTreeCrownFraction(growth);
        expect(radius).toBeLessThan(crown * 1.14);
        expect(radius).toBeGreaterThan(crown - 0.16);
      }
    }
  });

  it('has lateral roots and a soil plate below ground', () => {
    const roots = tubes.filter(tube => tube.rings[0].flags & TREE_WOOD_FLAG.ROOT);
    const lateral = roots.filter(tube => {
      const end = tube.rings[tube.rings.length - 1];
      return tube.socket === trunk[0] && Math.hypot(end.x, end.y) > Math.abs(end.z);
    });
    expect(lateral.length).toBeGreaterThanOrEqual(8);
    expect(lateral.length).toBeLessThanOrEqual(14);
    for (const tube of roots) {
      for (const ring of tube.rings.slice(1)) expect(ring.z).toBeLessThanOrEqual(0.001);
      expect(tube.rings[0].limbB).toBe(0);
    }
    const soil = rings.filter(ring => ring.flags & TREE_WOOD_FLAG.SOIL);
    expect(soil.length).toBeGreaterThan(3);
    // A wide disc, about as wide as the lean pivots on.
    expect(Math.max(...soil.map(ring => ring.radius))).toBeGreaterThan(
      TREE_ROOT_PLATE_RADII * 0.95
    );
    expect(Math.max(...soil.map(ring => ring.radius))).toBeLessThan(TREE_ROOT_PLATE_RADII * 1.1);
  });

  it('has rings with many sides on the trunk and few on twigs', () => {
    for (const ring of trunk) {
      if (ring.vertexCount === 1) continue;
      expect(ring.vertexCount - 1).toBeGreaterThanOrEqual(16);
      expect(ring.vertexCount - 1).toBeLessThanOrEqual(24);
    }
    const twigs = rings.filter(
      ring => isPlainWood(ring) && ring.radius < 0.03 && ring.vertexCount > 1
    );
    expect(twigs.length).toBeGreaterThan(500);
    expect(twigs.every(ring => ring.vertexCount - 1 <= 4)).toBe(true);
  });

  it('keeps every leaf on wood that already exists when it appears', () => {
    const findWood = createWoodLookup(rings);
    const violations = new Violations();
    for (let index = 0; index < model.leafCount; index += 3) {
      const leaf = getLeaf(model, index);
      violations.check(Math.abs(Math.hypot(...leaf.q) - 1) < 1e-3, 'quaternion is not unit');
      violations.check(leaf.birth > 0 && leaf.birth < 1, 'leaf birth range');
      violations.check(leaf.death > leaf.birth, 'leaf dies before its birth');
      violations.check(leaf.seed >= 0 && leaf.seed < 1, 'leaf seed range');
      violations.check(leaf.shell >= 0 && leaf.shell <= 1, 'leaf shell range');
      violations.check(leaf.tipness >= 0 && leaf.tipness <= 1, 'leaf tipness range');
      violations.check(leaf.length > 0 && leaf.width > 0, 'leaf size');
      violations.check(leaf.z > 0, 'leaf below ground');
      if (index % 12 === 0) {
        // Template units stretch x and y, so the reach is generous; a limb segment can be long.
        const wood = findWood(leaf.x, leaf.y, leaf.z, leaf.birth, 0.16);
        violations.check(wood !== null, 'leaf has no wood nearby at its birth');
      }
    }
    violations.expectNone();
  });

  it('anchors crops on wood, in a stable rank that samples the crown evenly', () => {
    expect(model.cropAnchorCount).toBe(3000);
    const anchorAxis = (count: number, field: number) => {
      const values: number[] = [];
      for (let anchor = 0; anchor < count; anchor++) {
        values.push(model.cropAnchors[anchor * TREE_CROP_ANCHOR_STRIDE + field]);
      }
      return spreadOf(values);
    };
    for (const field of [0, 1, 2]) {
      const full = anchorAxis(3000, field);
      expect(Math.abs(anchorAxis(200, field).mean - full.mean)).toBeLessThan(full.deviation * 0.2);
    }
    const findWood = createWoodLookup(rings);
    const violations = new Violations();
    for (let anchor = 0; anchor < 3000; anchor++) {
      const o = anchor * TREE_CROP_ANCHOR_STRIDE;
      const anchors = model.cropAnchors;
      violations.check(anchors[o + 3] > 0 && anchors[o + 3] < 1, 'anchor birth');
      violations.check(anchors[o + 4] < model.limbCount, 'anchor limb A');
      violations.check(anchors[o + 5] < model.limbCount, 'anchor limb B');
      violations.check(anchors[o + 6] >= 0 && anchors[o + 6] < 1, 'anchor seed');
      violations.check(anchors[o + 7] >= 0 && anchors[o + 7] <= 1, 'anchor shell');
      const wood = findWood(anchors[o], anchors[o + 1], anchors[o + 2], anchors[o + 3], 0.14);
      violations.check(wood !== null, 'anchor has no wood nearby at its birth');
    }
    violations.expectNone();
  });

  it('stays within its budgets', () => {
    // Rings between each tube's socket and apex: the skeleton nodes, plus rings added at bends.
    const plainTubes = tubes.filter(tube => isPlainWood(tube.rings[0]));
    let skeleton = 0;
    for (const tube of plainTubes) skeleton += tube.rings.length - 2;
    expect(skeleton).toBeGreaterThan(3000);
    expect(skeleton).toBeLessThan(36000);
    expect(model.leafCount).toBeGreaterThan(30000);
    expect(model.leafCount).toBeLessThan(165000);
    expect(model.wood.vertexCount).toBeLessThan(240000);
    expect(model.wood.indices.length / 3).toBeLessThan(330000);
  });
});

describe('Citrus growth stages', () => {
  const {rings} = citrusWood;
  const forksBy = (growth: number) =>
    rings.filter(
      ring =>
        isPlainWood(ring) &&
        ring.birth <= growth &&
        ring.successors.filter(index => rings[index].birth <= growth && isPlainWood(rings[index]))
          .length >= 2
    ).length;
  const leavesAlive = (growth: number) => {
    const alive: ReturnType<typeof getLeaf>[] = [];
    for (let index = 0; index < citrus.leafCount; index++) {
      const leaf = getLeaf(citrus, index);
      if (leaf.birth <= growth && growth < leaf.death) alive.push(leaf);
    }
    return alive;
  };

  it('has several forks and a full young crown at growth 0.35', () => {
    expect(forksBy(0.35)).toBeGreaterThan(40);
    const leaves = leavesAlive(0.35);
    expect(leaves.length).toBeGreaterThan(6000);
    // Young and round: leaves all the way around, out to the crown's edge.
    const sectors = new Set(
      leaves.map(leaf => Math.floor((Math.atan2(leaf.y, leaf.x) + Math.PI) * 3))
    );
    expect(sectors.size).toBeGreaterThanOrEqual(18);
    const crown = getTreeCrownFraction(0.35);
    const reach = leaves.reduce((far, leaf) => Math.max(far, Math.hypot(leaf.x, leaf.y)), 0);
    expect(reach).toBeGreaterThan(crown * 0.75);
    expect(leaves.reduce((top, leaf) => Math.max(top, leaf.z), 0)).toBeLessThan(
      getTreeHeightFraction(0.35) + 0.05
    );
    for (const growth of [0.2, 0.35, 0.5, 0.7]) {
      const {height, radius} = getWoodEnvelope(rings, growth);
      expect(height).toBeLessThanOrEqual(getTreeHeightFraction(growth) + 0.02);
      expect(radius).toBeLessThanOrEqual(getTreeCrownFraction(growth) * 1.14 + 0.03);
    }
  });

  it('closes into a dome with a low skirt at growth 1', () => {
    const leaves = leavesAlive(1);
    expect(leaves.length).toBeGreaterThan(100000);
    expect(leaves.length).toBeLessThan(160000);
    const centerZ = 0.42;
    const cells = new Set<number>();
    const azimuthCells = 18;
    const elevationCells = 8;
    for (const leaf of leaves) {
      if (leaf.shell < 0.4) continue;
      const dx = leaf.x * CITRUS_ASPECT;
      const dy = leaf.y * CITRUS_ASPECT;
      const elevation = Math.atan2(leaf.z - centerZ, Math.hypot(dx, dy));
      // From 40 degrees below the crown's center to the top.
      const row = Math.floor(((elevation + (40 * Math.PI) / 180) / ((130 * Math.PI) / 180)) * 8);
      if (row < 0 || row >= elevationCells) continue;
      const column = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * azimuthCells);
      cells.add(row * azimuthCells + column);
    }
    expect(cells.size / (azimuthCells * elevationCells)).toBeGreaterThan(0.97);
    // The skirt comes down near the ground all the way round.
    const skirt = new Set<number>();
    for (const leaf of leaves) {
      if (leaf.z < 0.12 && Math.hypot(leaf.x, leaf.y) > 0.5) {
        skirt.add(Math.floor(((Math.atan2(leaf.y, leaf.x) + Math.PI) / (Math.PI * 2)) * 12));
      }
    }
    expect(skirt.size).toBe(12);
    expect(leaves.reduce((low, leaf) => Math.min(low, leaf.z), 1)).toBeLessThan(0.06);
  });

  it('lets interior leaves die as the crown outgrows them, while outer leaves never do', () => {
    let mortal = 0;
    let outer = 0;
    const violations = new Violations();
    for (let index = 0; index < citrus.leafCount; index++) {
      const leaf = getLeaf(citrus, index);
      if (leaf.shell > 0.7) {
        outer++;
        violations.check(leaf.death > 1, 'outer leaf does not survive');
      }
      if (leaf.death > 1) {
        violations.check(getTreeCrownFraction(leaf.birth) > 0.4, 'old interior leaf never dies');
      } else {
        mortal++;
        violations.check(leaf.death >= leaf.birth + 0.029, 'leaf lives too briefly');
        violations.check(
          getTreeCrownFraction(leaf.death) - getTreeCrownFraction(leaf.birth) < 0.75,
          'leaf outlives the crown passing it'
        );
      }
    }
    violations.expectNone();
    expect(mortal / citrus.leafCount).toBeGreaterThan(0.05);
    expect(mortal / citrus.leafCount).toBeLessThan(0.6);
    expect(outer).toBeGreaterThan(1000);
  });
});

describe('Citrus organic form', () => {
  const trees = [0, 1, 2, 3, 4, 5].map(seed => {
    const model = getTreeGrowthModel('citrus', {seed});
    return {seed, model, ...readWood(model)};
  });
  const scaffoldsOf = (tree: (typeof trees)[number]) =>
    tree.tubes.filter(
      tube => tube.rings[0].order === 1 && isPlainWood(tube.rings[0]) && tube.socket?.order === 0
    );

  it('has 3 to 5 scaffolds, varying between trees, low on the trunk', () => {
    const counts = new Set<number>();
    for (const tree of trees) {
      const scaffolds = scaffoldsOf(tree);
      counts.add(scaffolds.length);
      expect(scaffolds.length).toBeGreaterThanOrEqual(3);
      expect(scaffolds.length).toBeLessThanOrEqual(5);
      for (const scaffold of scaffolds) {
        expect(scaffold.socket!.z).toBeGreaterThanOrEqual(tree.model.forkZ - 1e-6);
        expect(scaffold.socket!.z).toBeLessThan(tree.model.forkZ + 0.13);
      }
    }
    expect(counts.size).toBeGreaterThanOrEqual(2);
  });

  it('spaces scaffold sockets unequally in height and azimuth', () => {
    for (const tree of trees) {
      const scaffolds = scaffoldsOf(tree);
      const heights = scaffolds.map(tube => tube.socket!.z).sort((a, b) => a - b);
      const heightGaps = heights.slice(1).map((z, index) => z - heights[index]);
      expect(Math.max(...heightGaps) / Math.min(...heightGaps)).toBeGreaterThan(1.2);
      const azimuths = scaffolds
        .map(tube => {
          const out = tube.rings[Math.min(3, tube.rings.length - 1)];
          return Math.atan2(out.y - tube.socket!.y, out.x - tube.socket!.x);
        })
        .sort((a, b) => a - b);
      const azimuthGaps = azimuths.map((azimuth, index) =>
        index + 1 < azimuths.length
          ? azimuths[index + 1] - azimuth
          : azimuths[0] + Math.PI * 2 - azimuth
      );
      expect(Math.max(...azimuthGaps) / Math.min(...azimuthGaps)).toBeGreaterThan(1.15);
      expect(coefficientOfVariation(azimuthGaps)).toBeGreaterThan(0.08);
    }
  });

  it('forks at uneven intervals, with limbs that differ', () => {
    const spacings: number[] = [];
    for (const tree of trees.slice(0, 4)) {
      const parents = tree.tubes.filter(
        tube => tube.rings[0].order <= 2 && isPlainWood(tube.rings[0])
      );
      for (const tube of parents) {
        let last = 0;
        let walked = 0;
        for (let index = 1; index < tube.rings.length; index++) {
          walked += physicalDistance(tube.rings[index - 1], tube.rings[index]);
          const thick = tube.rings[index].successors.filter(
            child => tree.rings[child].radius >= 0.06 && isPlainWood(tree.rings[child])
          );
          if (thick.length >= 2) {
            spacings.push(walked - last);
            last = walked;
          }
        }
      }
    }
    expect(spacings.length).toBeGreaterThan(30);
    expect(coefficientOfVariation(spacings)).toBeGreaterThan(0.35);
    // The scaffolds of one tree differ in reach, a little in any tree and well on average.
    const differences = trees.map(tree => {
      const reach = scaffoldsOf(tree).map(tube => arc(tube.rings));
      return Math.max(...reach) / Math.min(...reach);
    });
    for (const difference of differences) expect(difference).toBeGreaterThan(1.015);
    expect(spreadOf(differences).mean).toBeGreaterThan(1.06);
  });

  it('has a short trunk with a root flare and a subtle bud-union swelling', () => {
    const trunk = trees[0].tubes[0].rings;
    const unionIndex = trunk.reduce(
      (best, ring, index) =>
        Math.abs(ring.z - TREE_CITRUS_BUD_UNION_Z) <
        Math.abs(trunk[best].z - TREE_CITRUS_BUD_UNION_Z)
          ? index
          : best,
      0
    );
    const union = trunk[unionIndex].radius;
    const above = trunk.find(ring => ring.z > TREE_CITRUS_BUD_UNION_Z + 0.02)!.radius;
    expect(union / above).toBeGreaterThan(1.02);
    expect(union / above).toBeLessThan(1.25);
    expect(trunk[0].radius / union).toBeGreaterThan(1.1);
    expect(trees[0].model.forkZ).toBeLessThan(0.16);
    // Trunk bark v follows the stem, so a bark shader can find the union line.
    expect(Math.abs(trunk[unionIndex].barkV - TREE_CITRUS_BUD_UNION_Z)).toBeLessThan(0.006);
  });

  it('has a trunk slightly sinuous, not straight and not wild', () => {
    for (const tree of trees) {
      const offsets = tree.tubes[0].rings.map(ring => Math.hypot(ring.x, ring.y) * CITRUS_ASPECT);
      expect(Math.max(...offsets)).toBeGreaterThan(0.002);
      expect(Math.max(...offsets)).toBeLessThan(0.05);
    }
  });

  it('faces wood triangles outward', () => {
    const {wood} = citrus;
    const point = (vertex: number): [number, number, number] => {
      const v = vertex * 4;
      const radius = wood.radial[v + 3] * CITRUS_TRUNK_RATIO;
      return [
        wood.center[v] * CITRUS_ASPECT + wood.radial[v] * radius,
        wood.center[v + 1] * CITRUS_ASPECT + wood.radial[v + 1] * radius,
        wood.center[v + 2] + wood.radial[v + 2] * radius
      ];
    };
    let facing = 0;
    let total = 0;
    for (let index = 0; index < wood.indices.length; index += 3) {
      const a = wood.indices[index];
      const b = wood.indices[index + 1];
      const c = wood.indices[index + 2];
      if (wood.shade[a * 4 + 3] !== 0 || wood.radial[a * 4 + 3] <= 0) continue;
      const pa = point(a);
      const pb = point(b);
      const pc = point(c);
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
      const w = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const nx = u[1] * w[2] - u[2] * w[1];
      const ny = u[2] * w[0] - u[0] * w[2];
      const nz = u[0] * w[1] - u[1] * w[0];
      total++;
      if (
        nx * wood.radial[a * 4] + ny * wood.radial[a * 4 + 1] + nz * wood.radial[a * 4 + 2] >=
        0
      ) {
        facing++;
      }
    }
    expect(facing / total).toBeGreaterThan(0.995);
  });

  it('faces blades up and out, with drooping tips and the authored sizes', () => {
    const lengths: number[] = [];
    let upward = 0;
    let outward = 0;
    let droop = 0;
    let count = 0;
    for (let index = 0; index < citrus.leafCount; index += 3) {
      const leaf = getLeaf(citrus, index);
      if (leaf.death <= 1) continue;
      lengths.push(leaf.length);
      const normal = rotate(leaf.q, [0, 0, 1]);
      const along = rotate(leaf.q, [1, 0, 0]);
      const planar = Math.hypot(leaf.x, leaf.y) || 1;
      if (normal[2] > 0) upward++;
      if ((normal[0] * leaf.x + normal[1] * leaf.y) / planar > 0) outward++;
      droop += along[2];
      count++;
    }
    expect(upward / count).toBeGreaterThan(0.85);
    expect(outward / count).toBeGreaterThan(0.7);
    expect(droop / count).toBeLessThan(0.1);
    const {mean, deviation} = spreadOf(lengths);
    // 7 to 11 cm at the reference height.
    expect(mean).toBeGreaterThan(0.08);
    expect(mean).toBeLessThan(0.095);
    expect(deviation / mean).toBeGreaterThan(0.08);
    expect(deviation / mean).toBeLessThan(0.25);
    const sorted = [...lengths].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length * 0.05)]).toBeGreaterThan(0.066);
    expect(sorted[Math.floor(sorted.length * 0.95)]).toBeLessThan(0.112);
    expect(getLeaf(citrus, 0).width).toBeGreaterThan(0.4);
    expect(getLeaf(citrus, 0).width).toBeLessThan(0.65);
    expect(citrus.referenceHeight).toBeCloseTo(7.5);
  });

  it('gives shoot tips the flush, not old wood', () => {
    let tips = 0;
    for (let index = 0; index < citrus.leafCount; index++) {
      if (getLeaf(citrus, index).tipness > 0.5) tips++;
    }
    expect(tips).toBeGreaterThan(citrus.leafCount * 0.05);
    expect(tips).toBeLessThan(citrus.leafCount * 0.7);
  });

  it('grows thorns only on citrus, flagged and thin', () => {
    const thorns = citrusWood.tubes.filter(tube => tube.rings[0].flags & TREE_WOOD_FLAG.THORN);
    expect(thorns.length).toBeGreaterThan(100);
    for (const thorn of thorns) {
      expect(thorn.rings).toHaveLength(2);
      expect(thorn.rings[0].radius).toBeLessThan(0.05);
    }
    const oak = readWood(getTreeGrowthModel('oak', {seed: 3}));
    expect(oak.rings.some(ring => ring.flags & TREE_WOOD_FLAG.THORN)).toBe(false);
  });

  it('breaks thin limbs early and scaffolds late', () => {
    const tree = trees[0];
    const breakOf = (limb: number) => tree.model.limbs[limb * TREE_LIMB_STRIDE + 3];
    const scaffoldBreaks = scaffoldsOf(tree).map(tube => breakOf(tube.rings[1].limbB));
    expect(Math.min(...scaffoldBreaks)).toBeGreaterThan(0.45);
    const thin = tree.rings
      .filter(
        ring => isPlainWood(ring) && ring.limbA !== 0 && ring.limbB !== 0 && ring.radius < 0.05
      )
      .map(ring => breakOf(ring.limbB));
    expect(median(thin)).toBeLessThan(0.5);
    expect(median(thin)).toBeLessThan(Math.min(...scaffoldBreaks));
  });
});

describe('Citrus crown', () => {
  it.each([1, 2, 3])('is widest low on the dome, with a broad skirt, seed %i', seed => {
    const model = getTreeGrowthModel('citrus', {seed});
    const bands = 12;
    const sectors = 36;
    const samples = getMatureCrownReach(model, bands, sectors);
    const reach = Array.from(
      {length: bands},
      (_, band) => spreadOf(samples.slice(band * sectors, (band + 1) * sectors)).mean
    );
    const widest = Math.max(...reach);
    const widestBand = reach.indexOf(widest);
    // Out to about the crown radius, and at its widest in its lower half.
    expect(widest).toBeGreaterThan(0.84);
    expect(widest).toBeLessThan(1.1);
    expect((widestBand + 0.5) / bands).toBeGreaterThan(0.1);
    expect((widestBand + 0.5) / bands).toBeLessThan(0.55);
    // A broad skirt, not a sphere's undercut or an egg standing on its end.
    expect(reach[0]).toBeGreaterThan(widest * 0.72);
    expect(reach[1]).toBeGreaterThan(widest * 0.85);
    // A round top, not a beehive's straight sides or a point.
    const shoulder = reach[Math.floor(bands * 0.72)];
    expect(shoulder).toBeGreaterThan(widest * 0.68);
    expect(shoulder).toBeLessThan(widest * 0.96);
    expect(reach[bands - 1]).toBeLessThan(widest * 0.6);
  });

  it('has an outline of its own for each seed, set by its scaffolds', () => {
    const around = 24;
    const outlines = [1, 2, 3].map(seed =>
      getMatureCrownReach(getTreeGrowthModel('citrus', {seed}), 1, around, 0.2, 0.6)
    );
    for (const outline of outlines) {
      // One side reaches further than another.
      expect(Math.max(...outline) / Math.min(...outline)).toBeGreaterThan(1.06);
      expect(Math.max(...outline) / Math.min(...outline)).toBeLessThan(1.5);
    }
    const apart = (a: number[], b: number[]) =>
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / around;
    expect(apart(outlines[0], outlines[1])).toBeGreaterThan(0.012);
    expect(apart(outlines[1], outlines[2])).toBeGreaterThan(0.012);
  });

  it('stands the odd shoot proud of the surface', () => {
    const {tubes} = readWood(getTreeGrowthModel('citrus', {seed: 1}));
    // Fine wood past the reach of nine leaf tips in ten, in each band of height.
    const tips = tubes
      .filter(tube => isPlainWood(tube.rings[0]) && tube.rings[0].radius < 0.03)
      .map(tube => tube.rings[tube.rings.length - 1]);
    const reachOf = (ring: Ring) => Math.hypot(ring.x, (ring.z - 0.33) / 0.67 / 1.0, ring.y);
    const sorted = tips.map(reachOf).sort((a, b) => a - b);
    const typical = sorted[Math.floor(sorted.length * 0.9)];
    const proud = sorted.filter(reach => reach > typical * 1.04).length;
    expect(proud).toBeGreaterThan(10);
    expect(proud / sorted.length).toBeLessThan(0.08);
  });

  it('is a small closed tree at growth 0.32', () => {
    const cells = 20;
    const growth = 0.32;
    const height = getTreeHeightFraction(growth);
    const crown = getTreeCrownFraction(growth);
    const covered = new Uint8Array(cells * cells);
    const model = getTreeGrowthModel('citrus', {seed: 1});
    let alive = 0;
    for (let index = 0; index < model.leafCount; index++) {
      const leaf = getLeaf(model, index);
      if (leaf.birth > growth || growth >= leaf.death) continue;
      alive++;
      const column = Math.floor(((leaf.x / crown + 1.15) / 2.3) * cells);
      const row = Math.floor((leaf.z / height) * cells);
      if (column >= 0 && column < cells && row >= 0 && row < cells)
        covered[row * cells + column] = 1;
    }
    expect(alive).toBeGreaterThan(20000);
    let inside = 0;
    let empty = 0;
    for (let row = 6; row < cells - 3; row++) {
      for (let column = 5; column < cells - 5; column++) {
        inside++;
        if (!covered[row * cells + column]) empty++;
      }
    }
    expect(empty / inside).toBeLessThan(0.01);
  });

  it('has no holes high up: leaves cover the crown as seen from any side', () => {
    const cells = 28;
    for (const seed of [1, 2]) {
      const model = getTreeGrowthModel('citrus', {seed});
      const covered = new Uint8Array(cells * cells);
      for (let index = 0; index < model.leafCount; index++) {
        const leaf = getLeaf(model, index);
        if (leaf.death <= 1) continue;
        const column = Math.floor(((leaf.x + 1.15) / 2.3) * cells);
        const row = Math.floor(leaf.z * cells);
        if (column >= 0 && column < cells && row >= 0 && row < cells) {
          covered[row * cells + column] = 1;
        }
      }
      // Each cell of the crown's side view, 40 cm or so on a tree of 9 m, inside its outline.
      let inside = 0;
      let empty = 0;
      for (let row = 2; row < cells - 2; row++) {
        const z = (row + 0.5) / cells;
        const zeta = (z - 0.33) / 0.67;
        const half = z > 0.33 ? Math.pow(1 - Math.pow(zeta, 2.3), 1 / 2.3) : 0.9;
        for (let column = 0; column < cells; column++) {
          const x = ((column + 0.5) / cells) * 2.3 - 1.15;
          if (Math.abs(x) > half * 0.85) continue;
          inside++;
          if (!covered[row * cells + column]) empty++;
        }
      }
      expect(empty / inside).toBeLessThan(0.02);
    }
  });

  it('has many more, smaller leaves, in alternate spirals and never in whorls', () => {
    expect(citrus.leafCount).toBeGreaterThan(120000);
    expect(citrus.leafCount).toBeLessThanOrEqual(160000);
    // Leaf bases by nearest neighbor: a whorl or a fan would put them almost on top of one another.
    const cell = 0.03;
    const grid = new Map<string, number[]>();
    const place = (x: number, y: number, z: number) =>
      `${Math.floor((x * CITRUS_ASPECT) / cell)},${Math.floor((y * CITRUS_ASPECT) / cell)},${Math.floor(z / cell)}`;
    for (let index = 0; index < citrus.leafCount; index++) {
      const leaf = getLeaf(citrus, index);
      const key = place(leaf.x, leaf.y, leaf.z);
      const list = grid.get(key);
      if (list) list.push(index);
      else grid.set(key, [index]);
    }
    const nearest: number[] = [];
    for (let index = 0; index < citrus.leafCount; index += 37) {
      const leaf = getLeaf(citrus, index);
      let best = Infinity;
      const cx = Math.floor((leaf.x * CITRUS_ASPECT) / cell);
      const cy = Math.floor((leaf.y * CITRUS_ASPECT) / cell);
      const cz = Math.floor(leaf.z / cell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
              if (other === index) continue;
              const near = getLeaf(citrus, other);
              best = Math.min(
                best,
                Math.hypot(
                  (near.x - leaf.x) * CITRUS_ASPECT,
                  (near.y - leaf.y) * CITRUS_ASPECT,
                  near.z - leaf.z
                )
              );
            }
          }
        }
      }
      nearest.push(best);
    }
    // In tree heights, for a leaf of about 0.012: a good fraction of a leaf apart, as on a shoot.
    expect(median(nearest)).toBeGreaterThan(0.0009);
    expect(nearest.filter(distance => distance < 0.0002).length / nearest.length).toBeLessThan(
      0.03
    );
  });

  it('leaves point along their shoots and do not all lie one way', () => {
    // Blade directions over the crown spread round in every sector, not a single combed direction.
    const sectors = new Array<number>(8).fill(0);
    for (let index = 0; index < citrus.leafCount; index += 11) {
      const leaf = getLeaf(citrus, index);
      const along = rotate(leaf.q, [1, 0, 0]);
      sectors[Math.floor(((Math.atan2(along[1], along[0]) + Math.PI) / (2 * Math.PI)) * 8) % 8]++;
    }
    expect(Math.min(...sectors) / Math.max(...sectors)).toBeGreaterThan(0.55);
  });

  it('scales leaf length by leafSize, and keeps the count and everything else', () => {
    const base = getTreeGrowthModel('citrus', {seed: 21});
    const large = getTreeGrowthModel('citrus', {seed: 21, leafSize: 1.5});
    expect(resolveTreeCharacteristics().leafSize).toBe(1);
    expect(large.leafCount).toBe(base.leafCount);
    for (let index = 0; index < base.leafCount; index += 97) {
      const a = getLeaf(base, index);
      const b = getLeaf(large, index);
      expect(b.length / a.length).toBeCloseTo(1.5, 4);
      expect(b.x).toBe(a.x);
      expect(b.z).toBe(a.z);
      expect(b.birth).toBe(a.birth);
    }
  });
});

describe('Citrus wood', () => {
  const trees = [1, 2, 4].map(seed => {
    const model = getTreeGrowthModel('citrus', {seed});
    return {model, ...readWood(model)};
  });

  it('has twigs thin nearly to their ends, with a short tip', () => {
    for (const {rings, tubes} of trees) {
      let terminal = 0;
      for (const tube of tubes) {
        const {rings: own} = tube;
        if (!isPlainWood(own[0]) || own.length < 3 || own[0].radius > 0.03) continue;
        terminal++;
        const last = own[own.length - 2];
        const apex = own[own.length - 1];
        expect(apex.radius).toBe(0);
        // No long cone: the last ring is still about as thick as any twig.
        expect(last.radius).toBeGreaterThan(0.0058);
        // And its tip is a few of its own radii long.
        const tip = physicalDistance(last, apex);
        expect(tip).toBeLessThan(last.radius * CITRUS_TRUNK_RATIO * 4 + 3e-4);
      }
      expect(terminal).toBeGreaterThan(8000);
      expect(rings.filter(ring => isPlainWood(ring) && ring.radius < 0.02).length).toBeGreaterThan(
        15000
      );
    }
  });

  it('turns limbs at nodes and keeps them straight between', () => {
    // Limbs are runs of nearly straight wood. A tube bent like rubber would turn evenly along its
    // length.
    for (const {tubes} of trees) {
      const turns: number[] = [];
      for (const tube of tubes) {
        const limb = tube.rings.filter(ring => !ring.shaped && ring.radius > 0.06);
        for (let index = 2; index < limb.length; index++) {
          const a = limb[index - 2];
          const b = limb[index - 1];
          const c = limb[index];
          const ux = (b.x - a.x) * CITRUS_ASPECT;
          const uy = (b.y - a.y) * CITRUS_ASPECT;
          const uz = b.z - a.z;
          const vx = (c.x - b.x) * CITRUS_ASPECT;
          const vy = (c.y - b.y) * CITRUS_ASPECT;
          const vz = c.z - b.z;
          const cosine =
            (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) || 1);
          turns.push(Math.acos(Math.min(1, Math.max(-1, cosine))));
        }
      }
      const sorted = [...turns].sort((a, b) => a - b);
      const typical = sorted[Math.floor(sorted.length * 0.5)];
      const largest = sorted[Math.floor(sorted.length * 0.95)];
      expect(largest).toBeGreaterThan(typical * 3);
      expect(largest).toBeLessThan((50 * Math.PI) / 180);
    }
  });

  it('blends a thick child into its parent through a collar with the bark of each', () => {
    for (const {model, tubes} of trees) {
      const {wood} = model;
      const collars = tubes.filter(tube => tube.rings[0].shaped);
      expect(collars.length).toBeGreaterThan(40);
      const violations = new Violations();
      for (const {rings: own} of collars) {
        const end = own[own.length - 1];
        for (let side = 0; side < end.vertexCount; side++) {
          // It ends with the child's own bark, running once around.
          const v = (end.firstVertex + side) * 4;
          violations.check(
            Math.abs(wood.bark[v] - side / (end.vertexCount - 1)) < 1e-6,
            'end bark u'
          );
        }
        // All of a ring's vertices are born together, and each comes from the one before it.
        for (let index = 1; index < own.length; index++) {
          for (let side = 0; side < own[index].vertexCount; side++) {
            const v = (own[index].firstVertex + side) * 4;
            const before = (own[index - 1].firstVertex + side) * 4;
            violations.check(
              wood.previous[v] === wood.center[before],
              'collar vertex comes from elsewhere'
            );
            violations.check(
              wood.previous[v + 2] === wood.center[before + 2],
              'collar vertex comes from elsewhere'
            );
            violations.check(
              wood.center[v + 3] === own[index].birth,
              'collar ring not born together'
            );
            // The surface runs smoothly: no normal turns much from one ring to the next.
            const dot =
              wood.radial[v] * wood.radial[before] +
              wood.radial[v + 1] * wood.radial[before + 1] +
              wood.radial[v + 2] * wood.radial[before + 2];
            violations.check(dot > -0.2, 'collar normal turns back');
          }
        }
        // Centers keep to the axes of its wood in each half and meet at the socket, so a thin fork
        // has no web.
        const middle = own[Math.floor(own.length / 2)];
        for (let side = 0; side < middle.vertexCount; side++) {
          const v = (middle.firstVertex + side) * 4;
          violations.check(
            Math.hypot(
              wood.center[v] - middle.x,
              wood.center[v + 1] - middle.y,
              wood.center[v + 2] - middle.z
            ) < 1e-5,
            'collar middle centers apart'
          );
        }
        for (const ring of [own[1], own[own.length - 2]]) {
          const v = ring.firstVertex * 4;
          const w = (ring.firstVertex + Math.floor(ring.vertexCount / 2)) * 4;
          const u = (ring.firstVertex + Math.floor(ring.vertexCount / 4)) * 4;
          const ex = (wood.center[w] - wood.center[v]) * CITRUS_ASPECT;
          const ey = (wood.center[w + 1] - wood.center[v + 1]) * CITRUS_ASPECT;
          const ez = wood.center[w + 2] - wood.center[v + 2];
          const fx = (wood.center[u] - wood.center[v]) * CITRUS_ASPECT;
          const fy = (wood.center[u + 1] - wood.center[v + 1]) * CITRUS_ASPECT;
          const fz = wood.center[u + 2] - wood.center[v + 2];
          const area = Math.hypot(ey * fz - ez * fy, ez * fx - ex * fz, ex * fy - ey * fx) / 2;
          // Where a parent bends, they do not lie on one line, so it comes only once the parent is
          // thick.
          violations.check(area < 1e-6 || ring.birth > 0.25, 'collar centers span a web');
        }
      }
      violations.expectNone();
      // And none appears on wood too thin to need one.
      for (const {rings: own} of collars) expect(own[0].birth).toBeGreaterThan(0.2199);
    }
  });

  it('runs the last scaffold on from the stem, with no change at the joint', () => {
    for (const {model, tubes} of trees) {
      const {wood} = model;
      const stem = tubes[0].rings;
      const end = stem[stem.length - 2];
      const leader = tubes.find(tube => tube.socket === end && tube !== tubes[0]) as Tube;
      expect(leader).toBeDefined();
      const first = leader.rings[0];
      expect(first.vertexCount).toBe(end.vertexCount);
      expect(first.radius).toBeCloseTo(end.radius, 4);
      expect(first.barkV).toBeCloseTo(end.barkV, 5);
      expect(first.seed).toBe(end.seed);
      for (let side = 0; side < first.vertexCount; side++) {
        const a = (first.firstVertex + side) * 4;
        const b = (end.firstVertex + side) * 4;
        expect(wood.radial[a]).toBeCloseTo(wood.radial[b], 4);
        expect(wood.radial[a + 2]).toBeCloseTo(wood.radial[b + 2], 4);
        expect(wood.bark[a]).toBe(wood.bark[b]);
      }
    }
  });

  it('has an out of round, fluted trunk', () => {
    const {model, tubes} = trees[0];
    const {wood} = model;
    const ring = tubes[0].rings.find(candidate => candidate.z > 0.06 && candidate.z < 0.09) as Ring;
    const widths: number[] = [];
    for (let side = 0; side < ring.vertexCount - 1; side++) {
      widths.push(wood.radial[(ring.firstVertex + side) * 4 + 3]);
    }
    const spread = (Math.max(...widths) - Math.min(...widths)) / median(widths);
    expect(spread).toBeGreaterThan(0.06);
    expect(spread).toBeLessThan(0.3);
  });

  it('hangs crops from fine shoots inside the leaf shell, with no reach to them', () => {
    for (const {model, rings} of trees) {
      const fine = rings.filter(ring => isPlainWood(ring) && ring.radius < 0.06);
      const findFine = createWoodLookup(fine);
      const anchors = model.cropAnchors;
      const violations = new Violations();
      let shelled = 0;
      for (let anchor = 0; anchor < model.cropAnchorCount; anchor++) {
        const o = anchor * TREE_CROP_ANCHOR_STRIDE;
        // Within a shoot's segment of fine wood that exists by then.
        const wood = findFine(anchors[o], anchors[o + 1], anchors[o + 2], anchors[o + 3], 0.1);
        violations.check(wood !== null, 'anchor is not on fine wood');
        // Within the outline of the crown.
        const reach = Math.hypot(anchors[o], anchors[o + 1]);
        violations.check(reach < 1.14, 'anchor outside the crown');
        if (anchors[o + 7] > 0.5) shelled++;
      }
      violations.expectNone();
      expect(shelled / model.cropAnchorCount).toBeGreaterThan(0.7);
      // Mostly under the skin of leaves, rather than out at its very edge.
      let atEdge = 0;
      for (let anchor = 0; anchor < model.cropAnchorCount; anchor++) {
        if (anchors[anchor * TREE_CROP_ANCHOR_STRIDE + 7] >= 0.999) atEdge++;
      }
      expect(atEdge / model.cropAnchorCount).toBeLessThan(0.5);
    }
  });

  it('has a soil plate of many polygons and torn roots, with stubs', () => {
    const {model, rings, tubes} = trees[0];
    const soil = rings.filter(ring => ring.flags & TREE_WOOD_FLAG.SOIL);
    const soilVertices = soil.reduce((sum, ring) => sum + ring.vertexCount, 0);
    expect(soilVertices).toBeGreaterThan(2000);
    // Shallow: far less deep under the trunk than it is wide.
    const deepest = -Math.min(...soil.map(ring => ring.z)) / CITRUS_TRUNK_RATIO;
    expect(deepest).toBeGreaterThan(TREE_ROOT_PLATE_THICKNESS * 0.75);
    expect(deepest).toBeLessThan(TREE_ROOT_PLATE_RADII * 0.5);
    // Irregular: its rim is no circle, and its heights vary around a ring.
    const rim = soil.reduce((best, ring) => (ring.radius > best.radius ? ring : best), soil[0]);
    const widths: number[] = [];
    const heights: number[] = [];
    for (let side = 0; side < rim.vertexCount - 1; side++) {
      const v = (rim.firstVertex + side) * 4;
      widths.push(model.wood.radial[v + 3]);
      heights.push(model.wood.center[v + 2]);
    }
    expect((Math.max(...widths) - Math.min(...widths)) / median(widths)).toBeGreaterThan(0.2);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(CITRUS_TRUNK_RATIO * 0.4);
    // Stubs: fine roots on the roots, and every root ends in a break, not a long point.
    const roots = tubes.filter(tube => tube.rings[0].flags & TREE_WOOD_FLAG.ROOT);
    const stubs = roots.filter(tube => tube.socket && tube.socket.flags & TREE_WOOD_FLAG.ROOT);
    expect(stubs.length).toBeGreaterThan(60);
    for (const root of roots) {
      const own = root.rings;
      const last = own[own.length - 2];
      if (last.radius > 0.05) {
        expect(physicalDistance(last, own[own.length - 1])).toBeLessThan(CITRUS_TRUNK_RATIO);
      }
    }
  });

  it('stands short broken roots out of the rim of its plate all round it, at the finest level only', () => {
    // Trunk radii out from the trunk, with x and y brought back to citrus proportions.
    const out = (ring: Ring) =>
      Math.hypot(ring.x * CITRUS_ASPECT, ring.y * CITRUS_ASPECT) / CITRUS_TRUNK_RATIO;
    for (const {model, tubes} of trees) {
      const fringe = tubes.filter(
        tube =>
          tube.rings[0].flags & TREE_WOOD_FLAG.ROOT &&
          tube.socket !== null &&
          out(tube.socket) < 2 &&
          out(tube.rings[0]) > TREE_ROOT_PLATE_RADII * 0.85
      );
      expect(fringe.length).toBeGreaterThanOrEqual(40);
      // All round the rim, with no wide gap.
      const azimuths = fringe
        .map(tube => Math.atan2(tube.rings[0].y, tube.rings[0].x))
        .sort((a, b) => a - b);
      const gaps = azimuths.map((azimuth, index) =>
        index > 0
          ? azimuth - azimuths[index - 1]
          : azimuth + 2 * Math.PI - azimuths[azimuths.length - 1]
      );
      expect(Math.max(...gaps)).toBeLessThan(0.5);
      // Short: none ends more than a few trunk radii past the rim.
      for (const tube of fringe) {
        expect(out(tube.rings[tube.rings.length - 1])).toBeLessThan(TREE_ROOT_PLATE_RADII + 5);
      }
      // No coarser level draws them, so a far tree draws no more wood for them.
      const fine = new Set<number>();
      for (const tube of fringe) {
        for (const ring of tube.rings) {
          for (let vertex = 0; vertex < ring.vertexCount; vertex++)
            fine.add(ring.firstVertex + vertex);
        }
      }
      const {indices, lodIndexCounts} = model.wood;
      let coarse = 0;
      for (let index = 0; index < lodIndexCounts[1]; index++) {
        if (fine.has(indices[index])) coarse++;
      }
      expect(coarse).toBe(0);
    }
  });
});

describe('Citrus young forms', () => {
  const {tubes} = citrusWood;
  const stem = tubes[0].rings;
  const leavesAlive = (model: TreeGrowthModel, growth: number) => {
    const alive: ReturnType<typeof getLeaf>[] = [];
    for (let index = 0; index < model.leafCount; index++) {
      const leaf = getLeaf(model, index);
      if (leaf.birth <= growth && growth < leaf.death) alive.push(leaf);
    }
    return alive;
  };

  it('is a thin faintly curved stem with a few small leaves at its top, as a seedling', () => {
    const growth = 0.03;
    const height = getTreeHeightFraction(growth);
    expect(
      tubes.slice(1).some(tube => isPlainWood(tube.rings[0]) && tube.rings[0].birth <= growth)
    ).toBe(false);
    const rising = stem.filter(ring => ring.birth <= growth);
    expect(rising.length).toBeGreaterThan(12);
    // Faintly curved: off a straight line by a little, for the seedling's height.
    const top = rising[rising.length - 1];
    let farthest = 0;
    for (const ring of rising) {
      const t = ring.z / top.z;
      farthest = Math.max(
        farthest,
        Math.hypot((ring.x - top.x * t) * CITRUS_ASPECT, (ring.y - top.y * t) * CITRUS_ASPECT) /
          top.z
      );
    }
    expect(farthest).toBeGreaterThan(0.01);
    expect(farthest).toBeLessThan(0.12);
    // Thin all the way: at growth 0.03 a stem of a tree of 9 m is a few millimetres thick.
    const metres = CITRUS_TRUNK_RATIO * 9;
    const middle = rising[Math.floor(rising.length / 2)];
    expect(getTreeRingRadius(middle.radius, middle.birth, growth) * metres).toBeLessThan(0.0035);
    expect(getTreeRingRadius(middle.radius, middle.birth, growth) * metres).toBeGreaterThan(0.0005);
    // A short soft tip, not a long spike: most of the way up it is already at its young thickness.
    const nearTop = rising[Math.max(0, rising.length - 4)];
    expect(getTreeRingRadius(nearTop.radius, nearTop.birth, growth)).toBeGreaterThan(
      getTreeRingRadius(middle.radius, middle.birth, growth) * 0.55
    );
    // Leaves are small, and none low down.
    const leaves = leavesAlive(citrus, growth);
    expect(leaves.length).toBeGreaterThanOrEqual(4);
    expect(leaves.length).toBeLessThan(30);
    for (const leaf of leaves) {
      expect(Math.hypot(leaf.x, leaf.y)).toBeLessThan(0.02);
      expect(leaf.z).toBeGreaterThan(height * 0.25);
      expect(leaf.length).toBeLessThan(0.07);
    }
  });

  it('is a whip with leaves spiralling up it and balanced side shoots at growth 0.12', () => {
    for (const seed of [1, 2, 3, 7]) {
      const model = getTreeGrowthModel('citrus', {seed});
      const {tubes: own} = readWood(model);
      const growth = 0.12;
      const leaves = leavesAlive(model, growth);
      expect(leaves.length).toBeGreaterThan(30);
      expect(leaves.length).toBeLessThan(600);
      // Balanced: no one side has most of the leaves, in plan or by height.
      let sumX = 0;
      let sumY = 0;
      for (const leaf of leaves) {
        const out = Math.hypot(leaf.x, leaf.y) || 1;
        sumX += leaf.x / out;
        sumY += leaf.y / out;
      }
      expect(Math.hypot(sumX, sumY) / leaves.length).toBeLessThan(0.45);
      const sectors = new Set(
        leaves.map(leaf => Math.floor((Math.atan2(leaf.y, leaf.x) + Math.PI) / (Math.PI / 2)) % 4)
      );
      expect(sectors.size).toBe(4);
      // Up the stem and not in one clump: leaves in the top sixth of the whip's height are not
      // most.
      const top = getTreeHeightFraction(growth);
      const high = leaves.filter(leaf => leaf.z > top * 0.83).length;
      expect(high / leaves.length).toBeLessThan(0.5);
      // Side shoots go round the stem.
      const sides = own.filter(
        tube =>
          tube !== own[0] &&
          isPlainWood(tube.rings[0]) &&
          tube.rings[0].birth <= growth &&
          tube.socket === own[0].rings.find(ring => ring === tube.socket)
      );
      expect(sides.length).toBeGreaterThanOrEqual(3);
      if (seed === 7) {
        expect(sides.filter(tube => tube.rings[0].order === 1).length).toBeLessThanOrEqual(4);
      }
      const bearings = new Set(
        sides.map(tube => {
          const end = tube.rings[tube.rings.length - 1];
          return (
            Math.floor(
              (Math.atan2(end.y - tube.rings[0].y, end.x - tube.rings[0].x) + Math.PI) /
                (Math.PI / 2)
            ) % 4
          );
        })
      );
      expect(bearings.size).toBeGreaterThanOrEqual(3);
    }
  });

  it('lets the stem swallow the feathers of the whip', () => {
    const feathers = tubes.filter(
      tube =>
        tube !== tubes[0] &&
        isPlainWood(tube.rings[0]) &&
        tube.rings[0].order === 2 &&
        tube.socket?.order === 0
    );
    expect(feathers.length).toBeGreaterThanOrEqual(3);
    for (const feather of feathers) {
      const socket = feather.socket as Ring;
      const end = feather.rings[feather.rings.length - 1];
      expect(physicalDistance(socket, end)).toBeLessThan(socket.radius * CITRUS_TRUNK_RATIO * 1.1);
    }
  });
});

describe('Characteristics', () => {
  const measure = (characteristics: Parameters<typeof getTreeGrowthModel>[1]) => {
    const model = getTreeGrowthModel('citrus', {seed: 11, ...characteristics});
    return {model, ...readWood(model)};
  };

  it('branchWander makes limbs more sinuous', () => {
    // Measured between forks, where only the limb's own wander and stiffness bend it.
    const sinuosity = (wander: number) => {
      const {tubes, rings} = measure({branchWander: wander});
      let extra = 0;
      let length = 0;
      for (const tube of tubes) {
        if (!isPlainWood(tube.rings[0])) continue;
        let start = 0;
        for (let index = 1; index < tube.rings.length; index++) {
          const ring = tube.rings[index];
          // A collar's vertices each have their own center.
          if (ring.shaped) start = index;
          if (ring.shaped) continue;
          const forks =
            ring.successors.filter(child => rings[child].radius >= 0.03 && !rings[child].flags)
              .length >= 2;
          if (!forks && index < tube.rings.length - 1) continue;
          if (ring.radius >= 0.05) {
            const walked = arc(tube.rings, start, index);
            if (walked > 0.06) {
              extra += walked - physicalDistance(tube.rings[start], ring);
              length += walked;
            }
          }
          start = index;
        }
      }
      return extra / length;
    };
    expect(sinuosity(2)).toBeGreaterThan(sinuosity(1));
    expect(sinuosity(1)).toBeGreaterThan(sinuosity(0) * 1.2);
  });

  it('twigDroop makes outer twigs hang lower', () => {
    const droop = (amount: number) => {
      const {rings} = measure({twigDroop: amount});
      let sum = 0;
      let count = 0;
      for (const ring of rings) {
        if (ring.predecessor < 0 || !isPlainWood(ring) || ring.radius > 0.05) continue;
        const before = rings[ring.predecessor];
        const length = physicalDistance(before, ring);
        if (length <= 1e-5) continue;
        sum += (ring.z - before.z) / length;
        count++;
      }
      return sum / count;
    };
    expect(droop(2)).toBeLessThan(droop(0));
  });

  it('crownSpread and crownDepth change the envelope, leaving the height at 1', () => {
    const reach = (tree: Wood) =>
      Math.max(...tree.rings.filter(isPlainWood).map(ring => Math.hypot(ring.x, ring.y)));
    expect(reach(measure({crownSpread: 1.4}))).toBeGreaterThan(1.1);
    expect(reach(measure({crownSpread: 0.7}))).toBeLessThan(0.75);
    const shallow = measure({crownDepth: 0.6});
    const lowest = (tree: {model: TreeGrowthModel}) => {
      let low = 1;
      for (let index = 0; index < tree.model.leafCount; index++) {
        const leaf = getLeaf(tree.model, index);
        if (leaf.death > 1) low = Math.min(low, leaf.z);
      }
      return low;
    };
    expect(lowest(shallow)).toBeGreaterThan(lowest(measure({crownDepth: 1.4})));
    const top = Math.max(...shallow.rings.filter(isPlainWood).map(ring => ring.z));
    expect(top).toBeGreaterThan(0.9);
    expect(top).toBeLessThanOrEqual(1);
    // A shallow crown sits on a longer trunk.
    expect(shallow.model.forkZ).toBeGreaterThan(measure({}).model.forkZ);
  });

  it('crownAsymmetry lobes the crown', () => {
    // How much the crown's reach varies around it, at each of several heights.
    const lumpiness = (asymmetry: number) => {
      const {model} = measure({crownAsymmetry: asymmetry});
      const reach = getMatureCrownReach(model, 6, 24);
      let sum = 0;
      for (let band = 1; band < 5; band++) {
        sum += coefficientOfVariation(reach.slice(band * 24, band * 24 + 24));
      }
      return sum;
    };
    expect(lumpiness(2)).toBeGreaterThan(lumpiness(0) * 1.3);
  });

  it('leaf traits change only the leaves', () => {
    const base = measure({});
    const leafy = measure({leafDensity: 2, leafSize: 1.5});
    expect(leafy.model.leafCount).toBeGreaterThan(base.model.leafCount * 1.8);
    expect(leafy.model.leafCount).toBeLessThan(base.model.leafCount * 2.2);
    expect(leafy.model.wood.vertexCount).toBe(base.model.wood.vertexCount);
    expect(
      Buffer.from(leafy.model.wood.center.buffer).equals(Buffer.from(base.model.wood.center.buffer))
    ).toBe(true);
    const meanLength = (model: TreeGrowthModel) => {
      let sum = 0;
      for (let index = 0; index < model.leafCount; index++) sum += getLeaf(model, index).length;
      return sum / model.leafCount;
    };
    expect(meanLength(leafy.model) / meanLength(base.model)).toBeCloseTo(1.5, 1);
  });

  it('stays valid and within budget at every extreme', () => {
    const extremes = [
      {branchDensity: 1.5, internodeLength: 0.7},
      {branchDensity: 0.5, internodeLength: 1.4},
      {crownSpread: 1.5, crownDepth: 1.4, crownAsymmetry: 2},
      {crownSpread: 0.6, crownDepth: 0.6, crownAsymmetry: 0},
      {branchLift: 0, branchWander: 2, twigDroop: 2},
      {branchLift: 3, branchWander: 0, twigDroop: 0},
      {leafDensity: 0.25, leafSize: 0.5},
      {leafDensity: 2, leafSize: 1.8}
    ];
    for (const extreme of extremes) {
      const {model, rings, tubes} = measure(extreme);
      expect(model.wood.center.every(Number.isFinite)).toBe(true);
      expect(model.leaves.every(Number.isFinite)).toBe(true);
      expect(model.wood.indices.every(index => index < model.wood.vertexCount)).toBe(true);
      const [lod0, lod1, lod2, lod3] = model.wood.lodIndexCounts;
      expect(lod0 > lod1 && lod1 > lod2 && lod2 > lod3 && lod3 > 0).toBe(true);
      const plain = rings.filter(isPlainWood);
      expect(plain.length).toBeGreaterThan(3000);
      expect(plain.length).toBeLessThan(70000);
      // The tree still reaches its full height.
      expect(Math.max(...plain.map(ring => ring.z))).toBeGreaterThan(0.88);
      expect(
        tubes.every(tube =>
          tube.rings.every((ring, i) => !i || ring.birth > tube.rings[i - 1].birth)
        )
      ).toBe(true);
    }
  }, 30000);
});

describe('Radial growth', () => {
  it('computes ring radii the vertex stage must match', () => {
    expect(getTreeRingRadius(1, 0, 0)).toBe(0);
    expect(getTreeRingRadius(1, 0, 1)).toBeCloseTo(1, 6);
    expect(getTreeRingRadius(0.5, 0.2, 0.1)).toBe(0);
    expect(getTreeRingRadius(0.5, 0.2, 1)).toBeCloseTo(0.5, 6);
    expect(getTreeRingRadius(1, 0, 0.5)).toBeCloseTo(Math.pow(0.5, TREE_RADIAL_EXPONENT), 6);
    // A young twig lignifies within a short span, far sooner than its wood thickens.
    const twig = getTreeRingRadius(0.03, 0.2, 0.2 + TREE_SHOOT_MATURING);
    expect(twig).toBeCloseTo(TREE_SHOOT_RADIUS, 6);
    // Never beyond the mature radius.
    expect(getTreeRingRadius(0.005, 0.2, 0.3)).toBeCloseTo(0.005, 6);
    // Monotonic in growth.
    let last = 0;
    for (let growth = 0.2; growth <= 1; growth += 0.01) {
      const radius = getTreeRingRadius(0.04, 0.2, growth);
      expect(radius).toBeGreaterThanOrEqual(last - 1e-9);
      last = radius;
    }
  });
});
