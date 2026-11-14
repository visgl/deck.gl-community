// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Shared data contract of TreeLayer's renderer. Pure constants and types, so the
 * growth model, the state store and every shader agree on one layout.
 *
 * Template space: x and y are in crown radii, so a mature crown reaches about +-1. z is 0 at the
 * ground and 1 at the top of a mature tree; `forkZ` is where the trunk meets the crown; roots have
 * z < 0. Radii are relative to a mature trunk base of 1. See `treeTemplateToMetres`.
 *
 * Time: `growth` is biological time from 0 (germination) to 1 (maturity). Everything a tree has at
 * growth g has a birth <= g. Old wood never moves: shoots extend from their tips and thicken.
 */

/** Texels per tree in the RGBA32F state texture. */
export const TREE_STATE_TEXELS_PER_ROW = 16;
export const TREE_STATE_ROWS_PER_LINE = 64;
export const TREE_STATE_TEXTURE_WIDTH = TREE_STATE_TEXELS_PER_ROW * TREE_STATE_ROWS_PER_LINE;

/** Texel index inside one tree's state row. The comment lists its four components. */
export const TREE_STATE_TEXEL = {
  /** x, y, z (layer coordinates, high part), yaw (radians). */
  ANCHOR: 0,
  /** xLow, yLow, zLow (64-bit low part), wind phase (radians). */
  ANCHOR_LOW: 1,
  /** crownX, crownY, height, trunkHeight (metres). */
  SIZE: 2,
  /** growth, health, foliage, flush (all 0-1). */
  LIFE: 3,
  /** lean angle (radians), lean direction (radians, atan2 math angle), damage, decay. */
  POSE: 4,
  /** Canopy tint: sRGB 0-1 RGBA. */
  CANOPY: 5,
  /** Bark tint: sRGB 0-1 RGBA. */
  TRUNK: 6,
  /** trunkRadius (metres), wind flex, coverage (0-1), leaf scale. */
  MISC: 7,
  /** leaf detail (0-1, fraction of this LOD's leaves), seed (0-1), foliage loss rate (/s), damage rate (/s). */
  DETAIL: 8,
  /** Crop slot 0: count, radius (metres), ripeness (0-1), fallen (0-1). */
  CROP0: 9,
  /** Crop slot 0 ripe tint: sRGB 0-1 RGBA. */
  CROP0_COLOR: 10,
  /** Crop slot 0 unripe tint: sRGB 0-1 RGB; alpha is the fallen rate (/s). */
  CROP0_UNRIPE: 11,
  /** Crop slot 1: count, radius (metres), ripeness (0-1), fallen (0-1). */
  CROP1: 12,
  /** Crop slot 1 ripe tint: sRGB 0-1 RGBA. */
  CROP1_COLOR: 13,
  /** Crop slot 1 unripe tint: sRGB 0-1 RGB; alpha is the fallen rate (/s). */
  CROP1_UNRIPE: 14,
  /** Dropped crops on the ground: slot 0 count, slot 1 count, canopy shell retention, unused. */
  CROP_DROPPED: 15
} as const;

/** Column count of the RGBA32F template textures (leaves, crop anchors and limbs). */
export const TREE_TEMPLATE_TEXTURE_WIDTH = 2048;
/** Four texels per leaf, so 16 floats. */
export const TREE_LEAF_STRIDE = 16;

/** Whether the leaf vertex shaders can reject a template record at fully mature growth. */
export function isMatureLeafRejected(leaves: Float32Array, leaf: number): boolean {
  const timing = leaf * TREE_LEAF_STRIDE + 8;
  // Both backends compare the death time plus 0.004 to growth. Leave a rounding margin.
  return leaves[timing] >= 1 || leaves[timing + 1] < 0.995999;
}
/** Two texels per crop anchor, so 8 floats. */
export const TREE_CROP_ANCHOR_STRIDE = 8;
/** Two texels per limb, so 8 floats. */
export const TREE_LIMB_STRIDE = 8;
/**
 * Growth levels of the crop rank table. Entry `anchor * levels + level` counts the anchors before this
 * one, in the stable order, that are born by growth `level / (levels - 1)`: a crop is drawn while that
 * rank is below its slot's `count`. See `getTreeCropTable`.
 */
export const TREE_CROP_RANK_LEVELS = 33;

/** Wood `flags` bits in `TreeGrowthWood.shade` component 3. */
export const TREE_WOOD_FLAG = {
  /** Below-ground root, collapsed onto the trunk base until the tree leans. */
  ROOT: 1,
  /** Soil held by the root plate, shown only when the tree leans. */
  SOIL: 2,
  /** Young-wood thorn, drawn only in the finest LOD. */
  THORN: 4,
  /** A collar, the tube over the join of a thick limb to its parent. See `TreeGrowthWood`. */
  COLLAR: 8
} as const;

/**
 * Connected, tube-shaped wood. Every array holds one vec4 per vertex; `indices` is ordered from
 * trunk to finest twig, so the prefixes in `lodIndexCounts` are simpler versions of the same tree.
 *
 * A tube flagged `COLLAR` lies over the join of a thick limb to its parent. Its first ring is the parent's
 * surface and its last the child's, so each of its vertices has its own center and radial, the radial being
 * the surface's normal, and takes the bark of whichever wood it meets. There, bark u runs from the parent's
 * to the child's, is not 0 to 1 around a ring, and has a seam in the crotch of the fork, and bark v differs
 * around a ring. All of a ring is still born together, and its vertices come from those of the ring before.
 */
export type TreeGrowthWood = {
  vertexCount: number;
  /** Ring center xyz in template space; w is the growth at which the shoot tip reaches this ring. */
  center: Float32Array;
  /** Previous ring center xyz along the shoot, or the socket on the parent; w is its birth. */
  previous: Float32Array;
  /** Unit radial direction xyz; w is the mature radius, relative to a mature trunk base of 1. */
  radial: Float32Array;
  /**
   * Bark u (0-1 around the tube), bark v (mature tree heights along the shoot, continuing the parent's
   * at a socket, so `v * height` is metres of bark), limb A, limb B.
   */
  bark: Float32Array;
  /** Occlusion (0 dark - 1 open), branch order (0 trunk), stable seed (0-1), TREE_WOOD_FLAG bits. */
  shade: Float32Array;
  indices: Uint32Array;
  /** Descending index counts for LOD 0, 1, 2 and 3. */
  lodIndexCounts: [number, number, number, number];
};

/**
 * Everything one species and characteristics combination needs. Immutable and shared by all trees
 * of that template. Leaves, anchors and limbs upload as RGBA32F textures read by index.
 */
export type TreeGrowthModel = {
  key: string;
  /** Template z of the first fork; trunk rings lie below it. */
  forkZ: number;
  /** Tree height, in metres, that leaf lengths were authored for. */
  referenceHeight: number;
  /**
   * Trunk radius in template units of height, which the plate of soil and the roots were laid out in, so that they
   * keep to a tree's own trunk, whatever the proportions of its crown. 0 or none takes them as the crown's.
   */
  trunkRatio?: number;
  /** Mature crown radius over height, the template unit of x and y in units of height. None takes 1. */
  crownAspect?: number;
  wood: TreeGrowthWood;
  /**
   * `TREE_LEAF_STRIDE` floats per leaf, shuffled so any prefix is an even sample of the crown:
   * - base xyz (template space), length (metres at referenceHeight)
   * - quaternion xyzw from blade space (x along the blade, y across it, z its upper normal)
   * - birth, death (> 1 means never), seed (0-1), shell (0 interior - 1 outer crown)
   * - limb A, limb B, tipness (0-1, weight of `flush`), width over length
   */
  leaves: Float32Array;
  leafCount: number;
  /** Descending leaf counts for LOD 0, 1, 2 and 3, each a prefix of `leaves`. */
  lodLeafCounts: [number, number, number, number];
  /**
   * `TREE_CROP_ANCHOR_STRIDE` floats per anchor, in stable rank order, so a larger count only adds
   * crops:
   * - twig attachment xyz (template space), birth
   * - limb A, limb B, seed (0-1), shell (0-1)
   */
  cropAnchors: Float32Array;
  cropAnchorCount: number;
  /**
   * `TREE_LIMB_STRIDE` floats per limb. Limb 0 is the identity and never breaks. A limb is a rigid
   * piece that hinges at its pivot when `damage` passes breakAt:
   * - pivot xyz (template space), breakAt (0-1; > 1 means never)
   * - unit direction xyz (template space), length (template units)
   */
  limbs: Float32Array;
  limbCount: number;
};

/** Fraction of mature height a tree has reached at growth g. */
export function getTreeHeightFraction(growth: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, growth)), 1.6);
}

/** Fraction of mature crown radius a tree has reached at growth g. */
export function getTreeCrownFraction(growth: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, growth)), 1.9);
}

/** Inverse of `getTreeHeightFraction`: the growth at which a tree reaches fraction z of its height. */
export function getTreeGrowthAtHeight(heightFraction: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, heightFraction)), 1 / 1.6);
}

/** Inverse of `getTreeCrownFraction`: the growth at which a crown reaches this fraction of its radius. */
export function getTreeGrowthAtCrown(crownFraction: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, crownFraction)), 1 / 1.9);
}

/**
 * Radial growth: fraction of its mature radius a ring born at `birth` has reached at growth g. Above 1, as
 * a seedling is far thinner for its height than a tree: a 0.75 exponent makes it a stumpy cone.
 */
export const TREE_RADIAL_EXPONENT = 1.3;

/**
 * Radius every shoot reaches soon after its birth, relative to a mature trunk base, and the growth
 * span it takes. A real shoot lignifies within a season; without this, young twigs would thicken only
 * with the trunk and be hair-thin for most of a tree's life. The span is short, so a shoot is a thin stem
 * right up to a short soft tip, not a long cone.
 */
export const TREE_SHOOT_RADIUS = 0.006;
export const TREE_SHOOT_MATURING = 0.0004;

/**
 * Radius of a ring at growth g, relative to a mature trunk base. The vertex stage must compute the same
 * value.
 */
export function getTreeRingRadius(radius: number, birth: number, growth: number): number {
  if (growth <= birth) return 0;
  const wood = radius * Math.pow(Math.min(1, (growth - birth) / (1 - birth)), TREE_RADIAL_EXPONENT);
  const t = Math.min(1, (growth - birth) / TREE_SHOOT_MATURING);
  return Math.max(wood, Math.min(radius, TREE_SHOOT_RADIUS) * t * t * (3 - 2 * t));
}

/** Crown, height and trunk measurements that map one template onto one tree. */
export type TreeTemplateSize = {
  crownX: number;
  crownY: number;
  height: number;
  trunkHeight: number;
};

/**
 * Template space to tree-local metres, before yaw. z is piecewise linear so a tree can have any
 * trunk height while the trunk and crown stay connected at `forkZ`. With a trunk height of
 * `forkZ * height` it is simply linear, which is what `getTreeHeightFraction` assumes, so that is
 * the default for a photoreal tree.
 */
export function treeTemplateToMetres(
  point: ArrayLike<number>,
  size: TreeTemplateSize,
  forkZ: number
): [number, number, number] {
  const z = point[2];
  const metres =
    z < 0
      ? z * size.height
      : z < forkZ
        ? (z / forkZ) * size.trunkHeight
        : size.trunkHeight + ((z - forkZ) / (1 - forkZ)) * (size.height - size.trunkHeight);
  return [point[0] * size.crownX, point[1] * size.crownY, metres];
}
