// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Matrix3, Quaternion, Vector3} from '@math.gl/core';
import {packTreeTubes, type TreePoint as Point, type TreeTube} from './tree-botany';
import {createTreeRng} from './tree-geometry';
import {
  evaluatePalmFrond,
  getPalmFrondLeafletT,
  getPalmFronds,
  getPalmRachisRadius,
  getPalmTrunkRadius,
  PALM_LEADER_TOP,
  PALM_LEAFLET_COUNT,
  PALM_SPEAR_TOP,
  type PalmFrond
} from './tree-palm';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  type TreeGrowthModel,
  type TreeGrowthWood
} from './tree-photoreal-layout';

type Rachis = {
  frond: PalmFrond;
  limb: number;
  base: Point;
  birth: number;
};

const REFERENCE_HEIGHT = 12;
const CROWN_ASPECT = 0.35;
const TRUNK_RATIO = 0.021;
const FORK_Z = 0.72;
const BASE_Z = -1;
const SHAFT_RINGS = 133;
const RACHIS_RINGS = 18;
const SHAFT_SIDES = 24;
const RACHIS_SIDES = 6;
const DATES_PER_BUNCH = 20;
const AXIL_T = 0.12;
const LEAFLET_LODS = [PALM_LEAFLET_COUNT, 4, 2, 1] as const;
const JUVENILE_LEAVES_PER_WHORL = 5;
const JUVENILE_WHORLS = [
  {z: 0.021, length: 0.52, width: 0.2, rise: 0.95},
  {z: 0.14, length: 0.98, width: 0.17, rise: 0.74},
  {z: 0.31, length: 1.38, width: 0.14, rise: 0.61},
  {z: 0.49, length: 1.77, width: 0.12, rise: 0.52},
  {z: 0.65, length: 2.1, width: 0.1, rise: 0.46}
] as const;

function getShaftBirth(z: number): number {
  // The juvenile crown establishes close to the ground before the exposed shaft elongates.
  const crownBase = 0.06;
  const shaftTop = normalizeHeight(PALM_LEADER_TOP, PALM_SPEAR_TOP);
  return z <= crownBase
    ? (z / crownBase) * 0.18
    : 0.18 + ((z - crownBase) / (shaftTop - crownBase)) ** 1.1 * 0.5;
}

function normalizeHeight(z: number, top: number): number {
  return (z - BASE_Z) / (top - BASE_Z);
}

/** Convert normalized crown axes to height units before computing physical directions. */
function getPhysicalPoint([x, y, z]: Point): Point {
  return [x * CROWN_ASPECT, y * CROWN_ASPECT, z];
}

function getRachisPoint({frond, base}: Rachis, t: number, top: number): Point {
  const [x, y, z] = evaluatePalmFrond(frond, t);
  const [baseX, baseY] = frond.controls[0];
  // Fit the socket inside the normalized shaft. Ease out the correction in the frond's first quarter.
  const offset = Math.max(1 - t * 4, 0) ** 2;
  return [x + (base[0] - baseX) * offset, y + (base[1] - baseY) * offset, normalizeHeight(z, top)];
}

function getRachisBirth(rachis: Rachis, t: number): number {
  return rachis.birth + t * 0.18;
}

function packPalmCrops(rachises: Rachis[], top: number, seed: number): Float32Array {
  const random = createTreeRng(seed ^ 0xe31a);
  const anchors = new Float32Array(rachises.length * DATES_PER_BUNCH * TREE_CROP_ANCHOR_STRIDE);
  for (const [bunch, rachis] of rachises.entries()) {
    const [x, y, z] = getRachisPoint(rachis, AXIL_T, top);
    const phase = random() * 2 * Math.PI;
    const birth = getRachisBirth(rachis, AXIL_T) + 0.09;
    const azimuth = Math.atan2(y, x);
    for (let date = 0; date < DATES_PER_BUNCH; date++) {
      // Each axil bears a hanging bunch. Stagger its fruit sites as the bunch narrows toward its tip.
      const depth = (date + 0.4 * random()) / DATES_PER_BUNCH;
      const angle = phase + date * Math.PI * (3 - Math.sqrt(5));
      const spread = (0.046 - 0.028 * depth) * (0.65 + 0.35 * random());
      const reach = 0.015 + 0.065 * depth;
      const offset = (date * rachises.length + bunch) * TREE_CROP_ANCHOR_STRIDE;
      anchors.set(
        [
          x + reach * Math.cos(azimuth) + spread * Math.cos(angle),
          y + reach * Math.sin(azimuth) + spread * Math.sin(angle),
          z - 0.012 - 0.057 * depth,
          birth + 0.055 * depth,
          0,
          rachis.limb,
          random(),
          0.76
        ],
        offset
      );
    }
  }
  return anchors;
}

function packPalmWood(rachises: Rachis[], top: number): TreeGrowthWood {
  const shaft: TreeTube = {
    rings: Array.from({length: SHAFT_RINGS}, (_, ring) => {
      const z = BASE_Z + (ring / (SHAFT_RINGS - 1)) * (PALM_LEADER_TOP - BASE_Z);
      const height = normalizeHeight(z, top);
      return {
        position: [0, 0, height],
        radius: getPalmTrunkRadius(z) / getPalmTrunkRadius(BASE_Z),
        birth: getShaftBirth(height),
        band: 0
      };
    }),
    sides: SHAFT_SIDES,
    limb: 0,
    order: 0,
    occlusion: 0.95,
    seed: 0
  };
  const distances = Array.from({length: RACHIS_RINGS}, (_, ring) => ring / (RACHIS_RINGS - 1));
  const rachisRadii = distances.map(t => (getPalmRachisRadius(t) * CROWN_ASPECT) / TRUNK_RATIO);
  const frondTubes = rachises.map(
    (rachis): TreeTube => ({
      rings: distances.map((t, ring) => ({
        position: getRachisPoint(rachis, t, top),
        radius: rachisRadii[ring],
        birth: getRachisBirth(rachis, t),
        band: ring < 5 ? 1 : ring < 10 ? 2 : 3
      })),
      sides: RACHIS_SIDES,
      limb: rachis.limb,
      order: 1,
      occlusion: 0.8,
      seed: rachis.limb / (rachises.length + 1)
    })
  );
  return packTreeTubes([shaft, ...frondTubes], CROWN_ASPECT);
}

function packPalmLeaves(rachises: Rachis[], spear: PalmFrond, top: number, seed: number) {
  const rng = createTreeRng(seed);
  const juvenileCount = JUVENILE_WHORLS.length * JUVENILE_LEAVES_PER_WHORL;
  const crownCenterCount = 1 + juvenileCount;
  const leafCount = crownCenterCount + rachises.length * PALM_LEAFLET_COUNT * 2;
  const leaves = new Float32Array(leafCount * TREE_LEAF_STRIDE);
  let leaf = 0;

  function writeBlade(
    base: Point,
    direction: Vector3,
    across: Vector3,
    length: number,
    width: number,
    limb: number,
    birth: number,
    death = 2,
    exposure = 1,
    tipness = 0
  ): void {
    const normal = new Vector3(direction).cross(across).normalize();
    if (normal.z < 0) normal.negate();
    const widthAxis = new Vector3(normal).cross(direction);
    const rotation = new Quaternion()
      .fromMatrix3(new Matrix3([...direction, ...widthAxis, ...normal]))
      .normalize();
    const offset = leaf++ * TREE_LEAF_STRIDE;
    leaves.set(
      [...base, length, ...rotation, birth, death, rng(), exposure, 0, limb, tipness, width],
      offset
    );
  }

  const spearBase: Point = [0, 0, normalizeHeight(PALM_LEADER_TOP, top)];
  const spearTip: Point = [spear.controls[3][0], spear.controls[3][1], 1];
  const spearAxis = new Vector3(getPhysicalPoint(spearTip)).subtract(getPhysicalPoint(spearBase));
  writeBlade(
    spearBase,
    new Vector3(spearAxis).normalize(),
    new Vector3(0, 1, 0),
    spearAxis.len() * REFERENCE_HEIGHT,
    0.055,
    0,
    getShaftBirth(spearBase[2]) + 0.01
  );

  // Early strap leaves open in successive rosettes as the visible shaft rises. Keep the upper
  // whorl until the first pinnate leaflets have opened, then shed the temporary foliage.
  JUVENILE_WHORLS.forEach(({z, length, width, rise}, whorl) => {
    const next = JUVENILE_WHORLS[whorl + 1];
    const birth = getShaftBirth(z) + 0.01;
    const death = next ? getShaftBirth(next.z) + 0.08 : 0.86;
    for (let index = 0; index < JUVENILE_LEAVES_PER_WHORL; index++) {
      const phase = index / JUVENILE_LEAVES_PER_WHORL + whorl * 0.38;
      const angle = phase * 2 * Math.PI;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      writeBlade(
        [0, 0, z],
        new Vector3(x, y, rise).normalize(),
        new Vector3(-y, x, 0),
        length * (0.87 + rng() * 0.26),
        width,
        0,
        birth + index * 0.004,
        death + index * 0.003,
        0.8,
        0.4
      );
    }
  });

  // Each prefix contains pairs from all fronds. Stride four covers each of the 15 anchor slots.
  for (let sample = 0; sample < PALM_LEAFLET_COUNT; sample++) {
    const pair = (7 + sample * 4) % PALM_LEAFLET_COUNT;
    const center = getPalmFrondLeafletT(pair);
    const fullness = Math.sin(((pair + 0.5) / PALM_LEAFLET_COUNT) * Math.PI);
    for (const rachis of rachises) {
      for (const side of [-1, 1]) {
        const t = center + side * 0.017 + (rng() - 0.5) * 0.02;
        const base = getRachisPoint(rachis, t, top);
        const tangent = new Vector3(getPhysicalPoint(getRachisPoint(rachis, t + 0.001, top)))
          .subtract(getPhysicalPoint(getRachisPoint(rachis, t - 0.001, top)))
          .normalize();
        const direction = new Vector3(-tangent.y, tangent.x, 0)
          .normalize()
          .scale(side)
          .add(new Vector3(tangent).scale(0.09 + t * 0.24))
          .add([0, 0, -0.12 - t * 0.3 - rng() * 0.14])
          .normalize();
        const length =
          (0.08 + fullness * 0.15) * (0.82 + rng() * 0.36) * CROWN_ASPECT * REFERENCE_HEIGHT;
        writeBlade(
          base,
          direction,
          tangent,
          length,
          0.09,
          rachis.limb,
          getRachisBirth(rachis, t) + 0.004,
          2,
          0.52 + rachis.frond.tier * 0.14,
          t * 0.26
        );
      }
    }
  }

  const lodLeafCounts = LEAFLET_LODS.map(
    pairs => crownCenterCount + rachises.length * pairs * 2
  ) as TreeGrowthModel['lodLeafCounts'];
  return {leaves, leafCount, lodLeafCounts};
}

/**
 * Pack a date palm with juvenile strap leaves, an elongating shaft, and a mature pinnate crown.
 * The template's birth and death intervals keep the shaft, leaflets, and temporary whorls in order.
 */
export function createPalmGrowthModel(seed = 1): TreeGrowthModel {
  const fronds = getPalmFronds();
  const spear = fronds.find(frond => frond.spear)!;
  const top = PALM_SPEAR_TOP;
  const rachises = fronds
    .filter(frond => !frond.spear)
    .map((frond, index): Rachis => {
      const [x, y, z] = frond.controls[0];
      const baseZ = normalizeHeight(z, top);
      const shaftRadius = (getPalmTrunkRadius(z) / getPalmTrunkRadius(BASE_Z)) * TRUNK_RATIO;
      const radius = shaftRadius / CROWN_ASPECT - getPalmRachisRadius(0) * 0.4;
      const scale = radius / Math.hypot(x, y);
      return {
        frond,
        limb: index + 1,
        base: [x * scale, y * scale, baseZ],
        birth: getShaftBirth(baseZ) + 0.01
      };
    });
  const limbCount = rachises.length + 1;
  const limbs = new Float32Array(limbCount * TREE_LIMB_STRIDE);
  limbs.set([0, 0, 0, 2, 0, 0, 1, 0]);
  for (const rachis of rachises) {
    const axis = new Vector3(getRachisPoint(rachis, 1, top)).subtract(rachis.base);
    const direction = new Vector3(axis).normalize();
    // Lower, older fronds give way before the upright new fronds.
    const breakAt = 0.29 + 0.12 * rachis.frond.tier;
    limbs.set([...rachis.base, breakAt, ...direction, axis.len()], rachis.limb * TREE_LIMB_STRIDE);
  }

  const cropAnchors = packPalmCrops(rachises, top, seed);
  return {
    key: `palm-${seed}`,
    forkZ: FORK_Z,
    referenceHeight: REFERENCE_HEIGHT,
    trunkRatio: TRUNK_RATIO,
    crownAspect: CROWN_ASPECT,
    wood: packPalmWood(rachises, top),
    ...packPalmLeaves(rachises, spear, top, seed),
    cropAnchors,
    cropAnchorCount: cropAnchors.length / TREE_CROP_ANCHOR_STRIDE,
    limbs,
    limbCount
  };
}
