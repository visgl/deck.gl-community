// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {ShaderModule} from '@luma.gl/shaders';
import {SPLAT_GLOBE_GLSL} from '../splat-layer/splat-globe';
import {TREE_CROP_PART, type CropKind, type TreeCropMeshLevel} from './tree-crop';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_CROP_RANK_LEVELS,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  TREE_RADIAL_EXPONENT,
  TREE_SHOOT_MATURING,
  TREE_SHOOT_RADIUS,
  TREE_STATE_ROWS_PER_LINE,
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW,
  TREE_TEMPLATE_TEXTURE_WIDTH
} from './tree-photoreal-layout';
import type {TreeGrowthSpecies} from './tree-growth-model';
import {
  TREE_CITRUS_BUD_UNION_Z,
  TREE_ROOT_PLATE_RADII,
  TREE_ROOT_PLATE_THICKNESS
} from './tree-growth-model';
import {PALM_SHAFT_SCAR_FREQUENCY} from './tree-palm';
import {getPineBladeOutline} from './tree-pine-needle';
import {TREE_WIND_GUST_GLSL, TREE_WIND_STRONG_FROM, TREE_WIND_STRONG_TO} from './tree-wind';

const TREE_PRECISION_GLSL = /* glsl */ `precision highp float;
precision highp int;`;
const TREE_SAMPLER_PRECISION_GLSL = /* glsl */ `${TREE_PRECISION_GLSL}
precision highp sampler2D;`;

const DECLARATION = `uniform treePhotorealUniforms {
  vec4 wind;
  vec4 clock;
  vec4 world;
  vec4 shape;
  vec4 look;
  vec4 barkA;
  vec4 barkB;
  vec4 barkC;
  vec4 leafBlades;
  vec4 woodLevel;
  vec3 leafPaleness;
  float shadowHistoryWeight;
} treePhotoreal;`;

/** Values of the `treePhotoreal` shader module, one set per draw. */
export type TreePhotorealUniforms = {
  /** Strength as a fraction of height; unit direction x, y; 1 if directional, 0 if isotropic. */
  wind: [number, number, number, number];
  /** Layer clock in seconds; leaf normal blend and specular scale at the next coarser level; 1 on a globe. */
  clock: [number, number, number, number];
  /** Layer position that gust phases are measured from, and metres per layer unit along x and y. */
  world: [number, number, number, number];
  /** Template `forkZ`, leaves at LOD 0, leaves this draw shows at `leafDetail` 1, fewest it shows. */
  shape: [number, number, number, number];
  /** Leaf normal blend toward the crown, specular scale, shadow strength, 1 if the draw is past LOD 0. */
  look: [number, number, number, number];
  /** Furrow depth, frequency per metre, vertical stretch, blockiness of plates. */
  barkA: [number, number, number, number];
  /** Lenticel amount, lenticel darkness (1 dark, 0 pale), grey mix, bud union amount. */
  barkB: [number, number, number, number];
  /** Young shoot color (linear RGB), and specular. */
  barkC: [number, number, number, number];
  /**
   * On-screen length, in pixels, a leaf takes the fine blade at (0 if none does) and the macro blade at, pixels
   * on screen of a metre, a metre from the camera, and the template's mean leaf length.
   */
  leafBlades: [number, number, number, number];
  /**
   * The largest mature radius of wood that the next coarser level no longer draws, 0 if none, then the template's
   * trunk radius, which its plate of soil and its roots were laid out in, in its units of height and in its units
   * across, crown radii, 0 for none, and one unused.
   */
  woodLevel: [number, number, number, number];
  /** Leaf underside brightness by channel. A strong wind holds blades over. */
  leafPaleness: [number, number, number];
  /** Weight of a cached shadow map during a projection transition. */
  shadowHistoryWeight: number;
};

/**
 * Per-draw uniforms shared by the photoreal primitive layers. The module holds no bindings: the
 * layers bind `treeState`, `treeLimbs` and their template textures with `model.setBindings`.
 */
export const treePhotoreal = {
  name: 'treePhotoreal',
  vs: DECLARATION,
  fs: DECLARATION,
  uniformTypes: {
    wind: 'vec4<f32>',
    clock: 'vec4<f32>',
    world: 'vec4<f32>',
    shape: 'vec4<f32>',
    look: 'vec4<f32>',
    barkA: 'vec4<f32>',
    barkB: 'vec4<f32>',
    barkC: 'vec4<f32>',
    leafBlades: 'vec4<f32>',
    woodLevel: 'vec4<f32>',
    leafPaleness: 'vec3<f32>',
    shadowHistoryWeight: 'f32'
  }
} as const satisfies ShaderModule<TreePhotorealUniforms>;

/**
 * A full crown hides its finest wood, so wood takes a coarser level than its leaves, by this much of a level with all
 * its leaves, coming on smoothly as foliage goes from the first of these to the second.
 */
export const TREE_WOOD_LOD_SHIFT = 0.7;
export const TREE_WOOD_HIDDEN_FROM = 0.6;
export const TREE_WOOD_HIDDEN_TO = 0.8;

/** Bark uniforms of one species. */
export type TreeBarkStyle = Pick<TreePhotorealUniforms, 'barkA' | 'barkB' | 'barkC'>;

/**
 * Procedural bark per species. The base color always comes from the tree's bark tint. A lenticel amount of 0.5 and up
 * makes them a feature of the bark at any age, and below that they are small and only on young wood.
 */
type TreeAppearanceSpecies = TreeGrowthSpecies | 'pine' | 'palm';

export const TREE_BARK_STYLES: Record<TreeAppearanceSpecies, TreeBarkStyle> = {
  // Warm, flaking scales on the lower stem.
  pine: {
    barkA: [1.12, 28, 5.8, 0.62],
    barkB: [0.02, 0, 0.45, 0],
    barkC: [0.2, 0.15, 0.045, 0.12]
  },
  // The shaft has horizontal leaf-base scars. Green rachises keep their own smooth surface.
  palm: {
    barkA: [0.34, 38, 0.48, 0.32],
    barkB: [0.32, 0.68, 0.2, 0],
    barkC: [0.1, 0.15, 0.036, 0.18]
  },
  // Grey-brown, fine vertical fissures, small pale lenticels on young wood only, and a change of bark low down.
  citrus: {
    barkA: [0.42, 170, 11, 0.12],
    barkB: [0.45, 0, 0.7, 1],
    barkC: [0.075, 0.125, 0.036, 0.2]
  },
  // Deep blocky furrows.
  oak: {
    barkA: [1.5, 34, 3.2, 0.75],
    barkB: [0.04, 0, 0.62, 0],
    barkC: [0.2, 0.16, 0.06, 0.1]
  },
  // Pale, papery, with long dark horizontal lenticels.
  birch: {
    barkA: [0.12, 26, 0.3, 0.15],
    barkB: [1, 1, 0.1, 0],
    barkC: [0.26, 0.16, 0.08, 0.3]
  },
  // Smooth and reddish, with bands of pale horizontal lenticels.
  cherry: {
    barkA: [0.2, 40, 0.4, 0.1],
    barkB: [0.9, 0, 0.25, 0],
    barkC: [0.24, 0.1, 0.07, 0.35]
  },
  // Smooth grey folds.
  banyan: {
    barkA: [0.9, 16, 7, 0.1],
    barkB: [0.1, 0, 0.45, 0],
    barkC: [0.2, 0.22, 0.08, 0.15]
  },
  // Rough grey-brown fissures.
  mangrove: {
    barkA: [1, 52, 4.5, 0.45],
    barkB: [0.2, 0, 0.5, 0],
    barkC: [0.18, 0.2, 0.07, 0.15]
  }
};

/**
 * Which blade a leaf draws, by its own size on screen. The far blade is two triangles, for a tree whose leaves
 * have grown to stand for others: they are all the same few pixels long, and in the millions. The coarse blade
 * has only its outline, as what shows of a leaf of 7 to 24 px is that, and any other leaf of a tree at full
 * detail takes it. The fine blade is curved, folded and shaded by the pixel. The macro blade has enough corners
 * for a leaf that fills the view to have a smooth outline and true relief. Those two are drawn for a list of
 * leaves near the camera.
 */
export type TreeLeafBlade = 'far' | 'coarse' | 'fine' | 'macro';

/** How far along a leaf its petiole ends and its blade begins. */
const BLADE_PETIOLE = 0.085;

/**
 * Half width of a leaf at `t` along it, relative to its widest point: a short, narrowly winged petiole,
 * pinched at its joint, then ovate-elliptic, rounded at the base and full nearly to a short, sudden point.
 */
function getBladeOutline(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t <= BLADE_PETIOLE) {
    const f = t / BLADE_PETIOLE;
    return 0.03 + 0.12 * f * f * (1 - f) * 2.2;
  }
  const u = (t - BLADE_PETIOLE) / (1 - BLADE_PETIOLE);
  const s = Math.max(0, Math.min(1, (u - 0.78) / 0.22));
  const sharpness = 0.6 + 0.62 * s * s * (3 - 2 * s);
  return Math.max(0.03, Math.pow(Math.sin(Math.PI * Math.pow(u, 0.756)), sharpness));
}

/** A pinnate leaflet has a long taper and attaches without a broadleaf petiole. */
function getPalmBladeOutline(t: number): number {
  return t > 0 && t < 1 ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.65)), 0.82) : 0;
}

/** Stations along each blade, from base to tip, between its two ends. */
const BLADE_ALONG: Record<TreeLeafBlade, readonly number[]> = {
  far: [0.44],
  coarse: [0.2, 0.66],
  fine: [0.085, 0.115, 0.2, 0.36, 0.55, 0.74, 0.9],
  macro: [
    0.03, 0.06, 0.085, 0.092, 0.1, 0.115, 0.14, 0.17, 0.21, 0.26, 0.31, 0.37, 0.43, 0.49, 0.55,
    0.61, 0.67, 0.73, 0.78, 0.83, 0.87, 0.91, 0.94, 0.97
  ]
};

/** Columns across each blade, -1 at the right margin and 1 at the left. */
const BLADE_ACROSS: Record<TreeLeafBlade, readonly number[]> = {
  far: [-1, 1],
  coarse: [-1, 1],
  fine: [-1, 0, 1],
  macro: [-1, -0.72, -0.38, 0, 0.38, 0.72, 1]
};

/** Half widths at a blade's stations. A polygon inside a curve has less area, and the coarser the less. */
function getBladeHalves(blade: TreeLeafBlade, species: TreeAppearanceSpecies): number[] {
  const outline =
    species === 'palm'
      ? getPalmBladeOutline
      : species === 'pine'
        ? getPineBladeOutline
        : getBladeOutline;
  const along = [0, ...BLADE_ALONG[blade], 1];
  const halves = along.map(outline);
  let polygon = 0;
  for (let i = 1; i < along.length; i++) {
    polygon += (halves[i] + halves[i - 1]) * 0.5 * (along[i] - along[i - 1]);
  }
  let area = 0;
  for (let i = 0; i < 400; i++) area += outline((i + 0.5) / 400) / 400;
  return halves.slice(1, -1).map(half => (half * area) / polygon);
}

const BLADE_PATTERNS: Partial<Record<TreeLeafBlade, readonly number[]>> = {};

/**
 * Corners of a leaf in the passes of leaves in the air, and its two triangles: a quad on screen, corners 0 and 1
 * where it was a moment before, and 2 and 3 where it is.
 */
export const TREE_LEAF_AIR_CORNERS = 4;
export const TREE_LEAF_AIR_PATTERN: readonly number[] = [0, 1, 2, 0, 2, 3];

/** Corners of a blade: its base, its stations and its tip. */
export function getTreeLeafCorners(blade: TreeLeafBlade): number {
  return 2 + BLADE_ALONG[blade].length * BLADE_ACROSS[blade].length;
}

/** The shared blade outline, as along, signed half width, and across coordinates per corner. */
export function getTreeLeafBladeCorners(
  blade: TreeLeafBlade,
  species: TreeAppearanceSpecies
): [number, number, number][] {
  const halves = getBladeHalves(blade, species);
  const corners: [number, number, number][] = [[0, 0, 0]];
  for (const [station, along] of BLADE_ALONG[blade].entries()) {
    for (const across of BLADE_ACROSS[blade])
      corners.push([along, across * halves[station], across]);
  }
  corners.push([1, 0, 0]);
  return corners;
}

/**
 * The triangle pattern of one leaf, as corner indices. Front faces are the blade's upper side. For a blade that
 * has no list a buffer repeats it, adding `corners` for each following leaf. The others are instanced, by leaf.
 */
export function getTreeLeafPattern(blade: TreeLeafBlade): readonly number[] {
  const known = BLADE_PATTERNS[blade];
  if (known) return known;
  const stations = BLADE_ALONG[blade].length;
  const columns = BLADE_ACROSS[blade].length;
  const corner = (station: number, column: number) => 1 + station * columns + column;
  const tip = 1 + stations * columns;
  const pattern: number[] = [];
  for (let column = 0; column + 1 < columns; column++) {
    pattern.push(0, corner(0, column), corner(0, column + 1));
    for (let station = 0; station + 1 < stations; station++) {
      const a = corner(station, column);
      const b = corner(station + 1, column);
      const c = corner(station + 1, column + 1);
      const d = corner(station, column + 1);
      pattern.push(a, b, c, a, c, d);
    }
    pattern.push(corner(stations - 1, column), tip, corner(stations - 1, column + 1));
  }
  BLADE_PATTERNS[blade] = pattern;
  return pattern;
}

function floatLiteral(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

const LEAF_TEXELS = TREE_LEAF_STRIDE / 4;
const LIMB_TEXELS = TREE_LIMB_STRIDE / 4;
const {
  ANCHOR,
  ANCHOR_LOW,
  SIZE,
  LIFE,
  POSE,
  CANOPY,
  TRUNK,
  MISC,
  DETAIL,
  CROP,
  CROP_COLOR,
  CROP_UNRIPE,
  CROP_DROPPED
} = TREE_STATE_TEXEL;

/**
 * The most a limb's own sway turns the chord of its arc, in radians. Past about this a limb streams rather than bends
 * further, and its whole turn is twice this.
 */
const TREE_LIMB_SWAY_MOST = 0.8;
/**
 * Of a shoot's length, how long the axis of its bend toward the wind is, unnormalized, for the way it bends to be
 * settled. Shorter than that, in the narrow cone of shoots that point into the wind from a little below the fork,
 * the bend fades out.
 */
const TREE_WIND_COMB_SETTLED = 0.15;

/**
 * The vertex stage all parts share, in the order of DESIGN.md: state, growth, template to metres and
 * yaw, limb breaks, lean, wind, decay, ground, projection. A part fills the global `tree` with
 * `treeLoadLife` and `treeLoadPlace`, then moves its points and directions through these functions.
 */
export const TREE_PHOTOREAL_VERTEX_CHUNK = /* glsl */ `
${SPLAT_GLOBE_GLSL}

uniform sampler2D treeState;
uniform sampler2D treeLimbs;

const vec4 TREE_CULLED = vec4(2.0, 2.0, 2.0, 1.0);
const float TREE_ROOT_PLATE_RADII = ${floatLiteral(TREE_ROOT_PLATE_RADII)};
const float TREE_TWO_PI = 6.2831853;
const float TREE_HALF_PI = 1.5707963;
const float TREE_LEAN_ROOTS_FROM = ${floatLiteral((0.5 * Math.PI) / 180)};
const float TREE_LEAN_ROOTS_TO = ${floatLiteral((8 * Math.PI) / 180)};
const float TREE_GROUND = 0.005;

struct TreeInstance {
  vec3 anchor;
  vec3 anchorLow;
  vec2 yaw;
  float windPhase;
  vec4 size;
  float growth;
  float health;
  float foliage;
  float flush;
  float lean;
  vec2 leanDirection;
  float leanCos;
  float leanSin;
  float damage;
  float decay;
  float trunkRadius;
  float windFlex;
  float coverage;
  float leafScale;
  float leafDetail;
  float seed;
  float foliageRate;
  float damageRate;
  float liveHeight;
  float plateRadius;
  vec3 worldDown;
  vec2 windBend;
  // The wind on this tree, and that faded as it tips over.
  float windForce;
  float windStrength;
  vec2 windDirection;
  // Where the tree stands along and across the wind, in metres.
  vec2 windPlace;
  // How far the tip of a shoot at the crown's skin turns downwind, in radians, and from where.
  float windComb;
  vec3 windHub;
  float windHubHeight;
  float windReach;
  // Of how limbs move, how much can be seen from here: 0 to read no limb at all.
  float windDetail;
  // How much a blade's own surface takes the wind: x how hard it is overall, y how much of that is steady.
  vec2 windBlade;
  // The gust on the whole tree, 0-1, and how much more than that can be seen.
  float windGust;
  float windSeen;
  // The rotation, as a vector, that the wind gave to the last point through treeWindPoint.
  vec3 windTurn;
  // A tree coming down: how much its limbs lift off the ground, and how thick the layer its crown is crushed into.
  float groundDetail;
  float groundLayer;
  mat3 frame;
} tree;

vec4 treeStateTexel(int row, int texel) {
  return texelFetch(
    treeState,
    ivec2(
      (row % ${TREE_STATE_ROWS_PER_LINE}) * ${TREE_STATE_TEXELS_PER_ROW} + texel,
      row / ${TREE_STATE_ROWS_PER_LINE}
    ),
    0
  );
}

vec4 treeLimbTexel(int limb, int texel) {
  int index = limb * ${LIMB_TEXELS} + texel;
  return texelFetch(
    treeLimbs,
    ivec2(index % ${TREE_TEMPLATE_TEXTURE_WIDTH}, index / ${TREE_TEMPLATE_TEXTURE_WIDTH}),
    0
  );
}

// Whether wood of a mature radius and birth is still there as a tree nears a coarser level of detail that does without
// it, so that a level changes without a pop. Only the wood of a tree has such a level. How far it is on its way follows
// from the leaf detail, which is 4 ^ -(fraction of the way to the next leaf level), and from how much coarser than its
// leaves a full crown lets its wood be: the sum of those passes a whole number where the wood changes level. Fine wood
// keeps a little width on screen however thin it is, so it cannot shrink away, and goes a length at a time.
float treeWoodLevelFade(float radius, float birth) {
  if (radius >= treePhotoreal.woodLevel.x) return 1.0;
  float hidden = smoothstep(${floatLiteral(TREE_WOOD_HIDDEN_FROM)}, ${floatLiteral(TREE_WOOD_HIDDEN_TO)}, tree.foliage);
  float level = -log(max(tree.leafDetail, 1e-4)) * 0.72134752 + ${floatLiteral(TREE_WOOD_LOD_SHIFT)} * hidden;
  float left = 1.0 - smoothstep(mix(0.5, 0.72, hidden), 0.98, fract(level));
  float hash = fract(sin(floor(birth * 97.0) * 12.9898 + floor(radius * 911.0) * 78.233) * 43758.5453);
  return hash < left ? 1.0 : 0.0;
}

float treeRingRadius(float radius, float birth, float growth) {
  if (growth <= birth) return 0.0;
  float age = growth - birth;
  float wood = radius * pow(min(1.0, age / max(1.0 - birth, 1e-5)), ${floatLiteral(TREE_RADIAL_EXPONENT)});
  float t = min(1.0, age / ${floatLiteral(TREE_SHOOT_MATURING)});
  return max(wood, min(radius, ${floatLiteral(TREE_SHOOT_RADIUS)}) * t * t * (3.0 - 2.0 * t)) * treeWoodLevelFade(radius, birth);
}

// The values that decide whether a part is drawn at all, from four texels of the state row.
void treeSetLife(vec4 life, vec4 pose, vec4 misc, vec4 detail) {
  tree.growth = life.x;
  tree.health = life.y;
  tree.foliage = life.z;
  tree.flush = life.w;
  tree.lean = pose.x;
  tree.leanDirection = vec2(cos(pose.y), sin(pose.y));
  tree.damage = pose.z;
  tree.decay = pose.w;
  tree.trunkRadius = misc.x;
  tree.windFlex = misc.y;
  tree.coverage = misc.z;
  tree.leafScale = misc.w;
  tree.leafDetail = detail.x;
  tree.seed = detail.y;
  tree.foliageRate = detail.z;
  tree.damageRate = detail.w;
}

void treeLoadLife(int row) {
  treeSetLife(
    treeStateTexel(row, ${LIFE}),
    treeStateTexel(row, ${POSE}),
    treeStateTexel(row, ${MISC}),
    treeStateTexel(row, ${DETAIL})
  );
}

// The rest of the state, once a part is known to be drawn.
void treeLoadPlace(int row) {
  vec4 anchor = treeStateTexel(row, ${ANCHOR});
  vec4 low = treeStateTexel(row, ${ANCHOR_LOW});
  tree.anchor = anchor.xyz;
  tree.anchorLow = low.xyz;
  tree.yaw = vec2(cos(anchor.w), sin(anchor.w));
  tree.windPhase = low.w;
  tree.size = treeStateTexel(row, ${SIZE});
  tree.liveHeight = tree.growth >= 1.0
    ? tree.size.z
    : max(tree.size.z * (1.0 - pow(1.0 - tree.growth, 1.6)), 0.01);
  tree.leanCos = 1.0;
  tree.leanSin = 0.0;
  tree.plateRadius = 0.0;
  if (tree.lean > 0.0) {
    tree.leanCos = cos(tree.lean);
    tree.leanSin = sin(tree.lean);
    tree.plateRadius = TREE_ROOT_PLATE_RADII * tree.trunkRadius * treeRingRadius(1.0, 0.0, tree.growth);
  }
  // World down in the frame before lean, so a limb of a fallen tree still falls toward the ground.
  tree.worldDown = vec3(tree.leanDirection * tree.leanSin, -tree.leanCos);
  // Filled in by treeProject.
  tree.frame = mat3(1.0);
}

vec3 treeToMetres(vec3 point) {
  float forkZ = treePhotoreal.shape.x;
  float z = point.z < 0.0
    ? point.z * tree.size.z
    : point.z < forkZ
      ? (point.z / forkZ) * tree.size.w
      : tree.size.w + ((point.z - forkZ) / (1.0 - forkZ)) * (tree.size.z - tree.size.w);
  return vec3(point.x * tree.size.x, point.y * tree.size.y, z);
}

vec3 treeTurnYaw(vec3 v) {
  return vec3(v.x * tree.yaw.x - v.y * tree.yaw.y, v.x * tree.yaw.y + v.y * tree.yaw.x, v.z);
}

vec3 treeLeanTurn(vec3 v) {
  if (tree.lean <= 0.0) return v;
  vec3 axis = vec3(-tree.leanDirection.y, tree.leanDirection.x, 0.0);
  return v * tree.leanCos + cross(axis, v) * tree.leanSin + axis * dot(axis, v) * (1.0 - tree.leanCos);
}

vec3 treeLeanPoint(vec3 point) {
  if (tree.lean <= 0.0) return point;
  vec3 pivot = vec3(tree.leanDirection * tree.plateRadius, 0.0);
  return pivot + treeLeanTurn(point - pivot);
}

float treeEventProgress(float passed, float rate, float flightSeconds) {
  // passed: how far the driving value has gone past this item's threshold.
  if (passed <= 0.0) return 0.0;
  return clamp(passed / max(rate * flightSeconds, 1e-4), 0.0, 1.0);
}

// Falling under gravity to a stop at 0.74, then a small rebound.
float treeFallCurve(float progress) {
  if (progress < 0.74) {
    float fall = progress / 0.74;
    return fall * fall;
  }
  float settle = (progress - 0.74) / 0.26;
  return 1.0 - 0.07 * sin(settle * 3.14159265) * (1.0 - settle);
}

mat3 treeRotation(vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  float k = 1.0 - c;
  return mat3(
    c + axis.x * axis.x * k, axis.y * axis.x * k + axis.z * s, axis.z * axis.x * k - axis.y * s,
    axis.x * axis.y * k - axis.z * s, c + axis.y * axis.y * k, axis.z * axis.y * k + axis.x * s,
    axis.x * axis.z * k + axis.y * s, axis.y * axis.z * k - axis.x * s, c + axis.z * axis.z * k
  );
}

// One limb of a damaged tree. A big limb (late breakAt) stays attached and swings about its pivot until
// it hangs or its tip reaches the ground. Others also come free, sooner or later, fall to the ground
// and lie flat. Returns how far this limb has come free.
float treeBreakLimb(int limb, inout vec3 point, inout mat3 turn, inout float swing) {
  if (limb <= 0) return 0.0;
  vec4 head = treeLimbTexel(limb, 0);
  float passed = tree.damage - head.w;
  if (passed <= 0.0) return 0.0;
  vec4 tail = treeLimbTexel(limb, 1);
  float hash = fract(float(limb) * 0.61803399);
  vec3 pivot = treeTurnYaw(treeToMetres(head.xyz));
  vec3 reachVector = treeTurnYaw(vec3(tail.x * tree.size.x, tail.y * tree.size.y, tail.z * tree.size.z));
  float reach = length(reachVector) * tail.w;
  vec3 direction = normalize(reachVector);
  vec3 down = tree.worldDown;
  float alpha = acos(clamp(dot(direction, down), -1.0, 1.0));
  vec3 axis = cross(direction, down);
  float axisLength = length(axis);
  axis = axisLength > 1e-3 ? axis / axisLength : vec3(cos(hash * TREE_TWO_PI), sin(hash * TREE_TWO_PI), 0.0);
  float pivotHeight = max(treeLeanPoint(pivot).z, 0.0);
  // The rigid limb swings until it hangs, or until its tip touches the ground.
  float rest = max(alpha - acos(clamp(pivotHeight / max(reach, 1e-3), 0.0, 1.0)), 0.0);
  float hinge = treeEventProgress(passed, tree.damageRate, 0.9);
  float angle = rest * treeFallCurve(hinge);
  swing = max(swing, hinge);
  float free = 0.0;
  bool attached = head.w >= 0.6;
  if (!attached) {
    // A quarter of the smaller limbs hang by a strip of bark for a while before they drop.
    float hang = hash < 0.25 ? 0.06 + hash * 0.8 : 0.0;
    free = treeEventProgress(passed - hang, tree.damageRate, 0.9);
    if (free > 0.0) {
      float lying = alpha - TREE_HALF_PI + (hash - 0.5) * 0.35;
      angle = mix(angle, lying, smoothstep(0.0, 1.0, free));
    }
  }
  mat3 rotation = treeRotation(axis, angle);
  vec3 moved = pivot + rotation * (point - pivot);
  if (free > 0.0) {
    // Falls to the ground along world down, thrown out a little in the direction it pointed.
    vec3 outward = direction - down * dot(direction, down);
    float outwardLength = length(outward);
    if (outwardLength > 1e-3) outward /= outwardLength;
    float landed = treeFallCurve(free);
    moved += down * max(pivotHeight - 0.02, 0.0) * landed + outward * pivotHeight * 0.3 * free;
  }
  point = moved;
  turn = rotation * turn;
  return free;
}

// How far the inner limb of the last part has come free.
float treeFreed = 0.0;

// Both limbs of a part: the inner one first, since it sits on the outer one. An inner limb that has
// come free no longer follows the outer one. Returns how far the part has swung.
float treeApplyBreaks(int outerLimb, int innerLimb, inout vec3 point, inout mat3 turn) {
  float swing = 0.0;
  float free = treeBreakLimb(innerLimb, point, turn, swing);
  treeFreed = free;
  if (free < 1.0 && outerLimb > 0) {
    vec3 outerPoint = point;
    mat3 outerTurn = turn;
    float outerSwing = swing;
    treeBreakLimb(outerLimb, outerPoint, outerTurn, outerSwing);
    float follow = 1.0 - smoothstep(0.0, 0.25, free);
    point = mix(point, outerPoint, follow);
    if (follow > 0.5) {
      turn = outerTurn;
      swing = outerSwing;
    }
  }
  return swing;
}

// The most a wind bends a tree over, as a fraction of its height. A trunk is stiff: past a breeze, what more
// wind does goes into the crown, its limbs and its leaves.
const float TREE_WIND_BEND_LIMIT = 0.3;

${TREE_WIND_GUST_GLSL}
// Once per vertex: the tree's bend for this frame, faded as a tree tips over, and how its crown takes the wind.
void treeWindLoad() {
  float force = tree.windFlex;
  float strength = force * max(tree.leanCos, 0.0);
  tree.windForce = force;
  tree.windStrength = strength;
  tree.windBend = vec2(0.0);
  tree.windComb = 0.0;
  tree.windDetail = 0.0;
  tree.windBlade = vec2(0.0);
  tree.windTurn = vec3(0.0);
  tree.groundDetail = 0.0;
  tree.groundLayer = 0.0;
  float lift = smoothstep(0.5, 0.75, tree.lean);
  if (force <= 0.0 && lift <= 0.0) return;
  // Anything that moves limbs goes through what depends on this, even with the tree lying flat.
  tree.windStrength = max(strength, 1e-6);
  // What is read of limbs goes only as far as how they move can be seen: by how tall the tree is on screen.
  mat4 view = project.viewProjectionMatrix;
  vec3 toCamera = project.cameraPosition - project_position(tree.anchor, tree.anchorLow);
  float pixels = project_size(1.0) * length(vec3(view[0].y, view[1].y, view[2].y)) * project.viewportSize.y * 0.5 /
    max(project.devicePixelRatio * length(toCamera), 1e-9);
  float tall = pixels * tree.liveHeight;
  float seen = smoothstep(30.0, 60.0, tall);
  float crownNow = tree.growth >= 1.0 ? 1.0 : 1.0 - pow(1.0 - tree.growth, 1.9);
  float crownReach = max(tree.size.x, tree.size.y) * crownNow;
  if (lift > 0.0) {
    tree.groundDetail = lift * seen;
    tree.groundLayer = crownReach * 0.17 * smoothstep(0.6, 1.45, tree.lean);
  }
  if (force <= 0.0) return;
  tree.windDetail = smoothstep(0.6, 1.8, tall * force * 0.1) * seen;
  float time = treePhotoreal.clock.x;
  float bend = TREE_WIND_BEND_LIMIT * (1.0 - exp(-strength / TREE_WIND_BEND_LIMIT));
#ifdef TREE_MATURE_ATTACHED_LEAVES
  const bool directed = false;
#else
  bool directed = treePhotoreal.wind.w >= 0.5;
#endif
  vec2 direction = directed ? treePhotoreal.wind.yz : vec2(0.91, 0.41);
  vec2 across = vec2(-direction.y, direction.x);
  vec2 world = ((tree.anchor.xy - treePhotoreal.world.xy) + tree.anchorLow.xy) * treePhotoreal.world.zw;
  float along = dot(world, direction);
  float side = dot(world, across);
  tree.windDirection = direction;
  tree.windPlace = vec2(along, side);
  tree.windSeen = seen;
  float strong = directed ? treeWind_getStrong(force) : 0.0;
  tree.windBlade = vec2(pow(force, 0.6), strong);
  tree.windGust = 0.5;
  if (directed) {
    // Gusts travel downwind across a grove, in broad, slowly wandering fronts, and a tree rocks in them, at the
    // slow period of something that heavy.
    float gust = treeWind_getGustAt(along, side, time, strong, tree.windPhase);
    tree.windGust = min(gust, 1.0);
    float rock = strong > 0.0 ? 0.3 * strong * gust * sin(time * (3.0 + 0.16 * tree.windPhase) + tree.windPhase) : 0.0;
    // A storm holds a tree over, and its gusts come on top of that: a front bows a crown to about twice what it
    // bends in a lull.
    tree.windBend = direction * bend * (mix(0.6 + 0.75 * gust, 0.62 + 0.72 * gust, strong) + rock) +
      across * bend * 0.12 * sin(1.3 * time + tree.windPhase);
    if (strong > 0.0) {
      // What the wind does to a crown goes around the fork its limbs spread from.
      tree.windHubHeight = max(min(tree.size.w, tree.liveHeight * 0.3), 1e-3);
      tree.windHub = treeLeanPoint(vec3(0.0, 0.0, tree.windHubHeight));
      tree.windReach = max(crownReach, tree.liveHeight - tree.windHubHeight);
      tree.windComb = 1.35 * strong * (0.55 + 0.6 * gust) * mix(1.0, 0.3, smoothstep(0.6, 1.4, tree.lean));
    }
  } else {
    tree.windBend = vec2(1.0, 0.45) * bend * sin(1.6 * time + tree.windPhase);
  }
}

// How far a tree coming down has landed.
float treeGroundLanding() {
  return smoothstep(0.6, 1.45, tree.lean);
}

// Height, once a crown coming down has been crushed into a layer on the ground. It stays above the ground, however
// far below it the tree's own lean would take it, in the order it came.
float treeCrushHeight(float z) {
  float layer = tree.groundLayer;
  return z >= layer || layer <= 0.0 ? z : layer * exp((z - layer) / layer);
}

// Where a crown that has reached the ground goes. What would have gone through it is crushed into a layer, and
// spreads out to the sides, as a crown does when it lands, and what lies above sags onto that.
vec3 treeCrushPoint(vec3 point) {
  float layer = tree.groundLayer;
  if (layer <= 0.0) return point;
  // The root plate and what is close to it stay as they are.
  vec2 fromRoot = point.xy - tree.leanDirection * tree.plateRadius;
  float along = dot(fromRoot, tree.leanDirection);
  float crown = smoothstep(0.0, 2.0 * tree.plateRadius, along);
  if (crown <= 0.0) return point;
  if (point.z >= layer) {
    point.z -= (point.z - layer) * 2.0 * layer / max(tree.liveHeight, 1e-3) * crown;
    return point;
  }
  float spread = (treeCrushHeight(point.z) - point.z) * crown;
  vec2 aside = fromRoot - tree.leanDirection * along;
  point.xy += (aside * 0.55 / (length(aside) + layer) + tree.leanDirection * 0.15) * spread;
  point.z += spread;
  return point;
}

// Cells of turbulence at a point in tree-local metres, each 0-1, carried downwind at 13 m/s. That is the same in
// any wind, as a speed that changed would move everything by a distance it has no history of. x is about as long
// as a crown is wide, and y a stride across.
vec2 treeWindCells(vec3 point) {
  // A tree a few dozen pixels tall has no cells to show, and only the gust it stands in.
  vec2 whole = vec2(tree.windGust);
  if (tree.windSeen <= 0.0) return whole;
  float time = treePhotoreal.clock.x;
  vec2 direction = tree.windDirection;
  float along = tree.windPlace.x + dot(point.xy, direction);
  float side = tree.windPlace.y + point.y * direction.x - point.x * direction.y;
  float wander = sin(side * 0.37 + time * 0.8);
  float broad = sin(along * 0.43 - time * 5.6 + 1.5 * wander + point.z * 0.25);
  float tight = sin(along * 1.15 - time * 15.0 + 1.7 * sin(side * 0.9 - time * 1.1) + 1.1 * wander + point.z * 0.6);
  return mix(whole, vec2(0.5 + 0.5 * broad, 0.5 + 0.5 * tight), tree.windSeen);
}

// Where the wind takes a point, in layer space after lean, with what it did to directions there in tree.windTurn.
// Nothing stretches. A shoot held at the crown's fork bends toward the wind in an arc of its own length, so
// its tip goes along the chord: half the turn, and shorter by the arc's sinc. On the windward side that lifts
// it over the top, and in the lee it only trails. Then the whole tree bends in an arc of its height, with level
// sections, as a beam does. At a breeze that is a bend quadratic in height, moving the top by the bend.
vec3 treeWindPoint(vec3 point) {
  tree.windTurn = vec3(0.0);
  if (tree.windComb > 0.0) {
    vec3 wind = vec3(tree.windDirection, 0.0);
    vec3 fromHub = point - tree.windHub;
    float len = length(fromHub);
    vec3 axis = cross(fromHub, wind) + vec3(-wind.y, wind.x, 0.0) * 0.12 * len;
    float axisLength = length(axis);
    if (axisLength > 1e-5) {
      axis /= axisLength;
      float perLength = 1.0 / max(len, 1e-4);
      float facing = dot(fromHub, wind) * perLength;
      // Which way a shoot bends is not settled for one that points straight into the wind from a little below the
      // fork, and two either side of that would bend apart and tear the wood between them in two. Near that way it
      // bends less, down to not at all.
      float chord = 0.5 * tree.windComb * (0.72 + 0.56 * treeWindCells(point).x) *
        min(len / tree.windReach, 1.2) * sqrt(0.5 - 0.5 * facing) *
        smoothstep(0.0, tree.windHubHeight, point.z) *
        min(axisLength * perLength * ${floatLiteral(1 / TREE_WIND_COMB_SETTLED)}, 1.0);
      float c = cos(chord);
      float s = sin(chord);
      fromHub = fromHub * c + cross(axis, fromHub) * s + axis * dot(axis, fromHub) * (1.0 - c);
      point = tree.windHub + fromHub * (1.0 - chord * chord / 6.0);
      tree.windTurn = axis * 2.0 * chord;
    }
  }
  float bendLength = length(tree.windBend);
  if (bendLength <= 1e-5) return point;
  vec2 direction = tree.windBend / bendLength;
  float tilt = 2.0 * bendLength * clamp(point.z / tree.liveHeight, 0.0, 1.5);
  float c = cos(tilt);
  float s = sin(tilt);
  float arcAlong = tilt < 0.02 ? tilt * 0.5 : (1.0 - c) / tilt;
  float arcUp = tilt < 0.02 ? 1.0 - tilt * tilt / 6.0 : s / tilt;
  float out_ = dot(point.xy, direction);
  point.xy += direction * (out_ * (c - 1.0) + point.z * arcAlong);
  point.z = point.z * arcUp - out_ * s;
  tree.windTurn += vec3(-direction.y, direction.x, 0.0) * tilt;
  return point;
}

// A direction turned by a rotation given as a vector.
vec3 treeTurnBy(vec3 v, vec3 rotation) {
  float angle = length(rotation);
  if (angle <= 1e-5) return v;
  vec3 axis = rotation / angle;
  float c = cos(angle);
  return v * c + cross(axis, v) * sin(angle) + axis * dot(axis, v) * (1.0 - c);
}

// What treeLimbSway did to directions at the last point, as a rotation vector, and that point.
vec3 treeSwayTurn = vec3(0.0);
vec3 treeSwayPoint = vec3(0.0);

// What the wind does to a direction at a height. Up close that is all it does at the point treeLimbSway was last
// asked about: to its limb and to the crown, as well as the tree's bend.
vec3 treeWindTurn(vec3 v, float pointZ) {
  if (tree.windDetail > 0.0 || tree.groundDetail > 0.0) {
    treeWindPoint(treeSwayPoint);
    return treeTurnBy(v, tree.windTurn + treeSwayTurn);
  }
  float bendLength = length(tree.windBend);
  if (bendLength <= 1e-5) return v;
  vec2 direction = tree.windBend / bendLength;
  float tilt = 2.0 * bendLength * clamp(pointZ / tree.liveHeight, 0.0, 1.5);
  return treeTurnBy(v, vec3(-direction.y, direction.x, 0.0) * tilt);
}

// How limbs move on their own, as a displacement of a point. Add it to what treeWindPoint gives. Each bends along its
// length, as a rod held at its pivot does: its tip goes along the chord of an arc, so it moves far and
// does not stretch. The wind holds it over, a gust throws it further, and a wave of bending runs out along it, so
// that the tip comes late, as a whip's does. Thin limbs are quick and go far. Thick ones are slow and go little.
// As a tree comes down, a limb that would reach into the ground bends up off it from its pivot, so that its tip stays
// on top, and lies along the ground if its pivot is in the crushed layer of treeCrushPoint.
// A point knows only its own limb and the one that limb grows on, so a thick scaffold from the trunk does not
// move like this, or what grows on what grows on it would part from it: it goes with the crown, in treeWindPoint.
vec3 treeLimbSway(int outerLimb, int innerLimb, vec3 point) {
  treeSwayTurn = vec3(0.0);
  treeSwayPoint = point;
  if (tree.windDetail <= 0.0 && tree.groundDetail <= 0.0) return vec3(0.0);
  float time = treePhotoreal.clock.x;
  vec3 along = vec3(tree.windDirection, 0.0);
  vec3 across = vec3(-along.y, along.x, 0.0);
  float force = tree.windForce;
  // Per metre of limb, in a tree about 6 m tall. Limbs are longer and stiffer on a larger one.
  float curving = 1.3 * pow(force, 0.75) / (1.0 + 0.3 * force) * min(6.0 / max(tree.liveHeight, 1e-3), 3.0) * tree.windDetail;
  vec3 moved = point;
  for (int level = 0; level < 2; level++) {
    int limb = level == 0 ? innerLimb : outerLimb;
    if (limb <= 0) continue;
    vec4 head = treeLimbTexel(limb, 0);
    // A thick scaffold has limbs on its limbs, and they know nothing of it. Its pivot is on the trunk, and its break late.
    float weight = 1.0 - smoothstep(0.35, 0.42, head.w) * (1.0 - smoothstep(0.025, 0.045, length(head.xy)));
    if (weight <= 0.0) continue;
    vec3 pivot = treeLeanPoint(treeTurnYaw(treeToMetres(head.xyz)));
    vec3 offset = moved - pivot;
    float hash = fract(float(limb) * 0.37139);
    vec3 rotation = vec3(0.0);
    float shorter = 1.0;
    if (tree.windDetail > 0.0) {
      float stiff = smoothstep(0.1, 0.6, head.w);
      float phase = float(limb) * 2.39996 + tree.windPhase;
      float omega = mix(21.0, 6.5, stiff) * (0.85 + 0.3 * hash);
      float late = length(offset) * mix(2.6, 0.9, stiff);
      float swing = sin(time * omega + phase - late);
      float sideways = sin(time * omega * 1.37 + phase * 1.7 - late * 1.3);
      float rise = sin(time * omega * 0.83 + phase * 2.3 - late * 0.8);
      vec2 cells = treeWindCells(pivot);
      float gust = mix(cells.y, cells.x, stiff);
      vec3 push = along * (0.3 + 0.45 * gust + 0.4 * swing * (0.5 + gust)) + across * 0.35 * sideways +
        vec3(0.0, 0.0, 0.25 * rise);
      rotation = cross(offset, push) * 0.5 * curving * mix(1.0, 0.06, sqrt(stiff)) * weight;
      // A limb bends only so far before it streams, as the far end of a long one in a storm would otherwise curl
      // round over its pivot and down to the ground. Short of a storm none bends so far.
      if (treePhotoreal.leafPaleness.z > 0.85) {
        rotation *= inversesqrt(1.0 + dot(rotation, rotation) * ${floatLiteral(1 / (TREE_LIMB_SWAY_MOST * TREE_LIMB_SWAY_MOST))});
      }
      shorter = 1.0 - dot(rotation, rotation) / 6.0;
      treeSwayTurn += 2.0 * rotation;
    }
    if (tree.groundDetail > 0.0) {
      vec4 tail = treeLimbTexel(limb, 1);
      vec3 limbLine = treeLeanTurn(treeTurnYaw(vec3(tail.xy * tree.size.xy, tail.z * tree.size.z)));
      float span = max(length(limbLine) * tail.w, 1e-3);
      vec3 way = normalize(limbLine);
      float standing = treeCrushHeight(pivot.z);
      float clearance = span * 0.05 + 0.06 * hash;
      vec3 hinge = cross(way, vec3(0.0, 0.0, 1.0));
      float hingeLength = length(hinge);
      hinge = hingeLength > 1e-3 ? hinge / hingeLength : vec3(cos(hash * TREE_TWO_PI), sin(hash * TREE_TWO_PI), 0.0);
      // A tree lying down holds its limbs out sideways. They sag under their own weight, thin ones more, and about a
      // quarter of them have split where they join, and hang.
      float landing = treeGroundLanding();
      float split = step(fract(float(limb) * 0.7131), 0.27);
      float elevation = asin(clamp(way.z, -1.0, 1.0));
      float wanted = elevation - landing * mix(0.5, 0.1, smoothstep(0.1, 0.6, head.w)) * (0.4 + 1.2 * hash + 1.3 * split);
      // But none goes into the ground.
      wanted = max(wanted, asin(clamp((clearance - standing) / span, -1.0, 1.0)));
      // All of it turns some, as it does where it breaks, and the rest of the way along it, as it bends.
      vec3 lifted = hinge * (wanted - elevation) * tree.groundDetail * weight *
        mix(0.5 + 0.5 * min(length(offset) / span, 1.0), 1.0, split);
      rotation += lifted;
      treeSwayTurn += lifted;
    }
    moved = pivot + treeTurnBy(offset, rotation) * shorter;
  }
  return moved - point;
}

// Germination: how pale a new shoot is, and how bent over its top, until about growth 0.012. It lifts and
// straightens, the one time wood that stands moves at all.
float treeGerminationHook() {
  return 1.0 - smoothstep(0.005, 0.012, tree.growth);
}

// A sprouting shoot's tip is blunt and soft, where later a tip is a short cone: its rings come up to their
// radius along a quarter circle. Rings of old wood have long since passed this, so they do not change.
float treeGerminationTip(float ring, float radius, float age) {
  float t = clamp(age / 0.0004, 0.0, 1.0);
  return max(ring, min(radius, ${floatLiteral(TREE_SHOOT_RADIUS)}) * sqrt(t * (2.0 - t)));
}

// Bends the top of a new shoot over in a hook, to one side, and returns the turn for directions there.
mat3 treeGerminationBend(inout vec3 point) {
  float angle = 2.6 * treeGerminationHook();
  float start = tree.liveHeight * 0.42;
  if (angle <= 0.0 || point.z <= start) return mat3(1.0);
  float bendRadius = (tree.liveHeight - start) / angle;
  float turned = (point.z - start) / bendRadius;
  vec3 side = vec3(cos(tree.seed * TREE_TWO_PI), sin(tree.seed * TREE_TWO_PI), 0.0);
  float across = dot(point.xy, side.xy);
  vec2 rest = point.xy - side.xy * across;
  float c = cos(turned);
  float s = sin(turned);
  point = vec3(rest, 0.0) +
    side * (bendRadius * (1.0 - c) + across * c) +
    vec3(0.0, 0.0, start + bendRadius * s - across * s);
  return treeRotation(vec3(-side.y, side.x, 0.0), turned);
}

// Rot brings the wreck down flat, onto a low layer of debris.
vec3 treeRotPoint(vec3 point) {
  if (tree.decay <= 0.0) return point;
  float flatten = smoothstep(0.06, 0.8, tree.decay);
  float debris = max(tree.trunkRadius * 0.45, 0.03);
  if (point.z > debris) point.z = debris + (point.z - debris) * (1.0 - flatten) * (1.0 - flatten);
  return point;
}

// What the ground does to a tree that has come down, and what rot does then.
vec3 treeDecayPoint(vec3 point) {
  return treeRotPoint(treeCrushPoint(point));
}

// Projects a point in tree-local metres with the anchor's tangent frame, and fills geometry.
vec4 treeProject(vec3 point) {
  geometry.worldPosition = tree.anchor;
  vec3 anchor = project_position(tree.anchor, tree.anchorLow);
  tree.frame = splatTangentFrame(anchor);
  vec4 commonPosition;
  gl_Position = splatProjectOffset(anchor, tree.frame, project_size(point), commonPosition);
  geometry.position = commonPosition;
  return commonPosition;
}

vec3 treeToCommonDirection(vec3 direction) {
  return splatProjectNormal(direction, tree.frame);
}

// How much of a tree's light gets through its crown. The crown is an ellipsoid in the tree's own axes that
// grows with it, a little larger than its leaves, so a leaf at the skin that faces away from the sun is
// already losing it. Optical depth is per radius of a full crown, and fades in with leaves on the tree.
const float TREE_CROWN_MIDDLE = 0.44;
const float TREE_CROWN_HALF_HEIGHT = 0.62;
const float TREE_CROWN_WIDTH = 1.14;
const float TREE_CROWN_RIM = 0.13;
const float TREE_CROWN_DEPTH = 2.7;

// Metres of crown along a ray from a point, in space where the crown is the unit sphere. The direction is
// a unit vector in metres divided by the radii, so the answer is in metres.
float treeCrownPath(vec3 q, vec3 direction) {
  float a = dot(direction, direction);
  float b = dot(q, direction);
  float c = dot(q, q) - 1.0;
  float discriminant = b * b - a * c;
  if (discriminant <= 0.0) return 0.0;
  float root = sqrt(discriminant);
  return max(-b + root, 0.0) / a - max(-b - root, 0.0) / a;
}

// A direction from common space into the crown's axes: before lean and yaw. Call after treeProject.
vec3 treeCrownDirection(vec3 commonDirection) {
  vec3 v = commonDirection * tree.frame;
  if (tree.lean > 0.0) {
    vec3 axis = vec3(-tree.leanDirection.y, tree.leanDirection.x, 0.0);
    v = v * tree.leanCos - cross(axis, v) * tree.leanSin + axis * dot(axis, v) * (1.0 - tree.leanCos);
  }
  return vec3(v.x * tree.yaw.x + v.y * tree.yaw.y, v.y * tree.yaw.x - v.x * tree.yaw.y, v.z);
}

// How much light reaches a point through the crown: x is the sun, from directional light 0, y the sky and
// z directional light 1, all 0-1, smooth and cheap, and w how full of leaves this crown is. In the fragment
// stage these multiply direct light, with treeCrownSun, and ambient, and treeCrownBounce adds what the leaves
// pass on. The point is in tree-local metres after yaw, before limb breaks, lean and wind, shell is 0 deep in
// the crown and 1 at its skin, or negative if not known. Call after treeProject.
vec4 treeCrownLight(vec3 point, float shell) {
  float g = tree.growth;
  float thick = smoothstep(0.08, 0.5, g) * tree.foliage * tree.coverage * (1.0 - 0.75 * tree.damage) *
    (1.0 - smoothstep(0.0, 0.5, tree.decay));
  if (thick <= 0.0) return vec4(1.0, 1.0, 1.0, 0.0);
  float crownNow = g >= 1.0 ? 1.0 : 1.0 - pow(1.0 - g, 1.9);
  vec3 radii = max(
    vec3(tree.size.xy * crownNow * TREE_CROWN_WIDTH, tree.liveHeight * TREE_CROWN_HALF_HEIGHT),
    vec3(0.01)
  );
  vec3 q = vec3(
    point.x * tree.yaw.x + point.y * tree.yaw.y,
    point.y * tree.yaw.x - point.x * tree.yaw.y,
    point.z - tree.liveHeight * TREE_CROWN_MIDDLE
  ) / radii;
  float size = (radii.x + radii.y + radii.z) / 3.0;
  float rim = size * TREE_CROWN_RIM;
  float known = shell < 0.0 ? 0.6 : shell;
  // Of two points at one depth, the one that is on the outside of a shoot gets more.
  float density = TREE_CROWN_DEPTH * thick / size;
  float sunDensity = density * mix(1.3, 0.8, known);

  vec4 light = vec4(1.0, 1.0, 1.0, thick);
  int lights = lighting.enabled == 0 ? 0 : min(lighting.directionalLightCount, 2);
  for (int i = 0; i < lights; i++) {
    vec3 toLight = treeCrownDirection(-normalize(lighting_getDirectionalLight(i).direction));
    float path = max(treeCrownPath(q, toLight / radii) - rim, 0.0);
    float sun = exp(-sunDensity * path);
    if (i == 0) light.x = sun;
    else light.z = sun;
  }

  // The sky: straight up through the crown, and out by the shortest way.
  vec3 up = -tree.worldDown;
  up = vec3(up.x * tree.yaw.x + up.y * tree.yaw.y, up.y * tree.yaw.x - up.x * tree.yaw.y, up.z);
  float above = max(treeCrownPath(q, up / radii) - rim, 0.0);
  float within = max(1.0 - length(q) - TREE_CROWN_RIM, 0.0);
  float sky = 0.55 * exp(-density * 0.8 * above) + 0.45 * exp(-TREE_CROWN_DEPTH * thick * 1.2 * within);
  light.y = sky * mix(1.0, mix(0.4, 1.0, smoothstep(0.1, 0.75, known)), thick);
  return light;
}
`;

/** Early returns after a fragment passes the part's coverage tests. */
export const TREE_PICKING_FRAGMENT_GLSL = /* glsl */ `  if (picking.isActive > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    DECKGL_FILTER_COLOR(fragColor, geometry);
    return;
  }`;

export const TREE_SHADOW_FRAGMENT_GLSL = /* glsl */ `#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    fragColor = shadow_filterShadowColor(vec4(0.0));
    return;
  }
#endif`;

const TREE_LEAF_PICKING_FRAGMENT_GLSL = /* glsl */ `#ifndef TREE_MATURE_ATTACHED_LEAVES
${TREE_PICKING_FRAGMENT_GLSL}
#endif`;

/**
 * The fragment stage all parts share: light color, hemisphere ambient, shadow map reading and the
 * filmic curve. Everything is in linear space until `treeFilmic`.
 */
export const TREE_PHOTOREAL_FRAGMENT_CHUNK = /* glsl */ `
const float TREE_PI = 3.14159265;

// Standard deck.gl lights mean sRGB colors times intensity. Keep the intensity linear, and decode only
// the hue, so a warm low sun or a blue night stays the color it was given.
vec3 treeLightColor(vec3 color) {
  float level = max(max(color.r, color.g), max(color.b, 1e-4));
  return pow(color / level, vec3(2.2)) * level;
}

vec3 treeFilmic(vec3 x) {
  // Narkowicz's fit to the ACES curve, then display encoding.
  x = max(x, vec3(0.0));
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(mapped, vec3(1.0 / 2.2));
}

// Away from the ground: common space's z, or away from the center of the globe.
vec3 treeUp(vec3 commonPosition) {
  return treePhotoreal.clock.w > 0.5 ? normalize(commonPosition) : vec3(0.0, 0.0, 1.0);
}

// Sky above, darker bounce from the ground below, from the standard ambient light.
vec3 treeHemisphere(vec3 normal, vec3 up) {
  vec3 ambient = treeLightColor(lighting.ambientColor);
  float sky = 0.5 + 0.5 * dot(normal, up);
  return ambient * mix(vec3(0.44, 0.38, 0.28), vec3(0.94, 1.0, 1.1), sky * sky);
}

// What a mirror sees in this direction: the ambient light's color as a sky, paler and brighter toward the
// horizon, and the ground color below it.
vec3 treeSkyColor(vec3 direction, vec3 up) {
  vec3 ambient = treeLightColor(lighting.ambientColor);
  float height = dot(direction, up);
  vec3 sky = ambient * mix(vec3(1.5, 1.4, 1.15), vec3(0.9, 1.0, 1.12), smoothstep(0.0, 0.55, height));
  return mix(ambient * vec3(0.3, 0.26, 0.19), sky, smoothstep(-0.1, 0.06, height));
}

// Of what treeCrownLight gave a part, what reaches it from directional light 'index'.
float treeCrownSun(vec4 crown, int index) {
  return index == 0 ? crown.x : index == 1 ? crown.z : crown.y;
}

// What the leaves of a crown pass on to whatever is among them, sunlit ones most: green, as that is what they
// do not keep. Add it to ambient light, ahead of a surface's own color.
vec3 treeCrownBounce(vec4 crown) {
  vec3 light = treeLightColor(lighting.ambientColor) * 0.5;
  if (lighting.directionalLightCount > 0) {
    float through = sqrt(sqrt(crown.x));
    light += treeLightColor(lighting_getDirectionalLight(0).color) * (0.3 + 0.7 * through);
  }
  return light * vec3(0.05, 0.14, 0.018) * crown.w;
}

float treeHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float treeNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = p - cell;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(treeHash(cell), treeHash(cell + vec3(1.0, 0.0, 0.0)), f.x),
      mix(treeHash(cell + vec3(0.0, 1.0, 0.0)), treeHash(cell + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(treeHash(cell + vec3(0.0, 0.0, 1.0)), treeHash(cell + vec3(1.0, 0.0, 1.0)), f.x),
      mix(treeHash(cell + vec3(0.0, 1.0, 1.0)), treeHash(cell + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}
`;

/**
 * Both stages read the shadow map through these samplers, not deck.gl's. The layers hand the shadow
 * module an empty list of maps, which keeps its matrices but stops its own lookup in every vertex and
 * fragment, the largest single cost of a shadowed frame. They bind the maps here instead.
 */
const TREE_SHADOW_SAMPLERS = /* glsl */ `
#ifdef MODULE_SHADOW
uniform sampler2D treeShadowMap0;
uniform sampler2D treeShadowMap1;
// deck.gl packs depth into RGBA; each fetched texel unpacks with this.
const vec4 TREE_SHADOW_UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
#endif
`;

/** Metres per shadow texel, and shadow-map depth per metre for each light. */
const TREE_SHADOW_VERTEX_COMMON = /* glsl */ `
#ifdef MODULE_SHADOW
vec3 treeShadowScale() {
  mat4 light0 = shadow.viewProjectionMatrix0;
  mat4 light1 = shadow.viewProjectionMatrix1;
  float metres = project_size(1.0);
  float texels = length(vec3(light0[0].x, light0[1].x, light0[2].x)) * project.viewportSize.x * 0.5;
  return vec3(
    1.0 / max(texels * metres, 1e-6),
    0.5 * length(vec3(light0[0].z, light0[1].z, light0[2].z)) * metres,
    0.5 * length(vec3(light1[0].z, light1[1].z, light1[2].z)) * metres
  );
}
// Where a common-space point falls in a light's map: xy in 0-1, z its depth.
vec3 treeShadowPosition(vec4 commonPosition, mat4 light, vec4 center) {
  vec4 position = project_common_position_to_clipspace(commonPosition, light, center);
  return (position.xyz / position.w + 1.0) * 0.5;
}
#endif
`;

/**
 * Shadows read per pixel, for surfaces large on screen: percentage closer filtering with a disc of
 * taps in shadow-map space. Each tap blends the four texels around it, since packed depth only holds
 * at texel centers.
 */
const TREE_SHADOW_PIXEL_VERTEX = /* glsl */ `
#ifdef MODULE_SHADOW
// Common units per metre.
out float vTreeShadowMetre;
out vec3 vTreeShadowPosition0;
out vec3 vTreeShadowPosition1;
void treeShadowWrite(vec4 commonPosition, float seed, float biasMetres) {
  if (treePhotoreal.look.z <= 0.0) return;
  vTreeShadowMetre = project_size(1.0);
  vTreeShadowPosition0 = treeShadowPosition(commonPosition, shadow.viewProjectionMatrix0, shadow.projectCenter0);
  if (shadow.lightCount > 1.0) {
    vTreeShadowPosition1 = treeShadowPosition(commonPosition, shadow.viewProjectionMatrix1, shadow.projectCenter1);
  }
}
#endif
`;

/**
 * Taps on a disc, along a golden-angle spiral, so that any number of them is spread evenly. Each is blended from
 * four texels, so a blended tap counts for about two of whole texels.
 */
function getTreeShadowDisc(count: number): string {
  const taps: string[] = [];
  for (let i = 0; i < count; i++) {
    const radius = Math.sqrt((i + 0.5) / count);
    const angle = i * 2.399963;
    taps.push(
      `vec2(${floatLiteral(Number((radius * Math.cos(angle)).toFixed(4)))}, ${floatLiteral(Number((radius * Math.sin(angle)).toFixed(4)))})`
    );
  }
  return `const vec2 TREE_SHADOW_DISC[${count}] = vec2[${count}](${taps.join(', ')});`;
}

function getTreeShadowPixelFragment(requestedTaps: number): string {
  const taps = Math.max(4, Math.ceil(requestedTaps * 0.6));
  return /* glsl */ `
#ifdef MODULE_SHADOW
in float vTreeShadowMetre;
in vec3 vTreeShadowPosition0;
in vec3 vTreeShadowPosition1;

// The smooth normal of the surface being shaded, in common space, if the part sets it before it asks for
// visibility. A wide filter then compares against the plane of the surface, not one depth, and a slope or a
// convex body sees no shadow of its own.
vec3 treeShadowNormal = vec3(0.0);

${getTreeShadowDisc(taps)}

// One tap: lit or not at the four texels around a point in the map, as a blend. A tap on its own then moves
// smoothly across a texel, and a soft edge has no levels to show. With whole texels it had one for each tap,
// and across a penumbra as wide as a fruit fills the screen, those read as contours.
float treeShadowTap(sampler2D map, vec2 place, float depth, vec2 slope, ivec2 size) {
  vec2 corner = floor(place);
  vec2 f = place - corner;
  ivec2 low = clamp(ivec2(corner), ivec2(0), size - 1);
  ivec2 high = clamp(ivec2(corner) + 1, ivec2(0), size - 1);
  // Compare at the texel centers. On a slope, using the tap's depth for all four comparisons
  // lets them flip as the tap moves within a texel, even on a flat receiver plane.
  float depthLow = depth + dot(vec2(low) - place, slope);
  vec2 rise = vec2(high - low) * slope;
  float a = depthLow <= dot(texelFetch(map, low, 0), TREE_SHADOW_UNPACK) ? 1.0 : 0.0;
  float b = depthLow + rise.x <= dot(texelFetch(map, ivec2(high.x, low.y), 0), TREE_SHADOW_UNPACK) ? 1.0 : 0.0;
  float c = depthLow + rise.y <= dot(texelFetch(map, ivec2(low.x, high.y), 0), TREE_SHADOW_UNPACK) ? 1.0 : 0.0;
  float d = depthLow + rise.x + rise.y <= dot(texelFetch(map, high, 0), TREE_SHADOW_UNPACK) ? 1.0 : 0.0;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float treeShadowTaps(sampler2D map, mat4 light, vec3 position, float biasMetres) {
  if (position.x <= 0.0 || position.y <= 0.0 || position.x >= 1.0 || position.y >= 1.0) return 1.0;
  ivec2 size = textureSize(map, 0);
  vec2 sizeF = vec2(size);
  // The map's axes in common space, and how far a texel and a unit of depth go along them.
  vec3 rowU = vec3(light[0].x, light[1].x, light[2].x);
  vec3 rowV = vec3(light[0].y, light[1].y, light[2].y);
  vec3 rowZ = vec3(light[0].z, light[1].z, light[2].z);
  vec2 axisLength = vec2(length(rowU), length(rowV));
  float depthLength = length(rowZ);
  vec2 texelMetres = 2.0 / (axisLength * sizeF * max(vTreeShadowMetre, 1e-9));
  float depthPerMetre = 0.5 * depthLength * vTreeShadowMetre;
  // Depth per texel along the plane of the surface. Fade the correction at grazing angles, where
  // the plane gives a poor estimate and reversing the light-facing normal would flip the slope.
  vec2 slope = vec2(0.0);
  float normalLength = dot(treeShadowNormal, treeShadowNormal);
  if (normalLength > 0.0) {
    vec3 normal = treeShadowNormal / sqrt(normalLength);
    float along = dot(normal, rowZ) / depthLength;
    float inverseFacing = along / max(along * along, 0.26 * 0.26);
    slope = -vec2(dot(normal, rowU) / axisLength.x, dot(normal, rowV) / axisLength.y) * inverseFacing *
      texelMetres * depthPerMetre;
  }
  // A penumbra about 4 cm wide, but never narrower than about a texel and a half.
  vec2 radius = clamp(0.04 / max(texelMetres, vec2(1e-5)), vec2(1.25), vec2(5.0));
  // The bias asked for, and half a texel's rise on this slope, as a texel holds one depth. With no normal, enough
  // for this map's texels on a surface tilted to the light.
  float depth = normalLength > 0.0
    ? position.z - biasMetres * depthPerMetre - 0.5 * (abs(slope.x) + abs(slope.y))
    : position.z - biasMetres * depthPerMetre * (1.0 + 28.0 * max(texelMetres.x, texelMetres.y));
  vec2 middle = position.xy * sizeF - 0.5;
  float lit = 0.0;
  for (int i = 0; i < ${taps}; i++) {
    // Keep the sample pattern with the shadow map as a leaf moves across the screen.
    vec2 offset = TREE_SHADOW_DISC[i] * radius;
    lit += treeShadowTap(map, middle + offset, depth + dot(offset, slope), slope, size);
  }
  return lit / ${taps}.0;
}

// Fraction of directional light 'index' that reaches this point, with the bias in metres.
float treeDirectionalVisibility(int index, float biasMetres) {
  if (treePhotoreal.look.z <= 0.0 || float(index) >= shadow.lightCount) return 1.0;
  float visibility = index == 0
    ? treeShadowTaps(treeShadowMap0, shadow.viewProjectionMatrix0, vTreeShadowPosition0, biasMetres)
    : treeShadowTaps(treeShadowMap1, shadow.viewProjectionMatrix1, vTreeShadowPosition1, biasMetres);
  if (index == 0 && treePhotoreal.shadowHistoryWeight > 0.0) {
    float previous = treeShadowTaps(treeShadowMap1, shadow.viewProjectionMatrix1, vTreeShadowPosition1, biasMetres);
    visibility = mix(visibility, previous, treePhotoreal.shadowHistoryWeight);
  }
  return mix(1.0, visibility, treePhotoreal.look.z);
}
#else
vec3 treeShadowNormal = vec3(0.0);
float treeOcclusionLight = 1.0;
float treeDirectionalVisibility(int index, float biasMetres) {
  return treeOcclusionLight;
}
#endif
`;
}

/**
 * Shadows read per vertex, for surfaces a few pixels wide: one texel at each corner, offset by the seed
 * so that corners of a leaf differ, and the surface interpolates. It costs a fraction of reading per
 * pixel, and without a dither there is no noise for far crowns to shimmer with.
 */
const TREE_SHADOW_VERTEX_VERTEX = /* glsl */ `
#ifdef MODULE_SHADOW
out vec2 vTreeLit;

float treeShadowCorner(sampler2D map, vec3 position, float depth, vec2 offset) {
  if (position.x <= 0.0 || position.y <= 0.0 || position.x >= 1.0 || position.y >= 1.0) return 1.0;
  ivec2 size = textureSize(map, 0);
  ivec2 texel = clamp(ivec2(position.xy * vec2(size) + offset), ivec2(0), size - 1);
  return depth <= dot(texelFetch(map, texel, 0), TREE_SHADOW_UNPACK) ? 1.0 : 0.0;
}

// How much of each light reaches this corner.
vec2 treeShadowRead(vec4 commonPosition, float seed, float biasMetres) {
  if (treePhotoreal.look.z <= 0.0) return vec2(1.0);
  vec3 scale = treeShadowScale();
  float bias = biasMetres * (1.0 + 28.0 * scale.x);
  float angle = seed * 44.0 + float(gl_VertexID) * 2.4;
  vec2 offset = vec2(cos(angle), sin(angle)) * 1.1;
  vec3 position = treeShadowPosition(commonPosition, shadow.viewProjectionMatrix0, shadow.projectCenter0);
  vec2 lit = vec2(treeShadowCorner(treeShadowMap0, position, position.z - bias * scale.y, offset), 1.0);
  if (shadow.lightCount > 1.0) {
    position = treeShadowPosition(commonPosition, shadow.viewProjectionMatrix1, shadow.projectCenter1);
    if (treePhotoreal.shadowHistoryWeight > 0.0) {
      // Both maps are aligned to the same light axes. Recover the old texel size from
      // its projection rather than reusing the incoming map's coarser/finer depth bias.
      mat4 oldLight = shadow.viewProjectionMatrix1;
      float oldScale = length(vec3(oldLight[0].x, oldLight[1].x, oldLight[2].x));
      float oldTexelMetres = 2.0 / max(oldScale * project.viewportSize.x * project_size(1.0), 1e-6);
      float oldBias = biasMetres * (1.0 + 28.0 * oldTexelMetres);
      float previous = treeShadowCorner(treeShadowMap1, position, position.z - oldBias * scale.z, offset);
      lit.x = mix(lit.x, previous, treePhotoreal.shadowHistoryWeight);
    } else {
      lit.y = treeShadowCorner(treeShadowMap1, position, position.z - bias * scale.z, offset);
    }
  }
  return mix(vec2(1.0), lit, treePhotoreal.look.z);
}

void treeShadowWrite(vec4 commonPosition, float seed, float biasMetres) {
  vTreeLit = treeShadowRead(commonPosition, seed, biasMetres);
}
#endif
`;

const TREE_SHADOW_VERTEX_FRAGMENT = /* glsl */ `
vec3 treeShadowNormal = vec3(0.0);
#ifdef MODULE_SHADOW
in vec2 vTreeLit;
float treeDirectionalVisibility(int index, float biasMetres) {
  return index > 1 ? 1.0 : index == 0 ? vTreeLit.x : vTreeLit.y;
}
#else
float treeOcclusionLight = 1.0;
float treeDirectionalVisibility(int index, float biasMetres) {
  return treeOcclusionLight;
}
#endif
`;

/**
 * Shadow reading for a part's vertex shader: `treeShadowWrite(commonPosition, seed, biasMetres)`. Read per
 * pixel for surfaces large on screen, otherwise per vertex.
 */
export function getTreeShadowVertex(perPixel: boolean): string {
  return `${TREE_SHADOW_SAMPLERS}
${TREE_SHADOW_VERTEX_COMMON}
${perPixel ? TREE_SHADOW_PIXEL_VERTEX : TREE_SHADOW_VERTEX_VERTEX}`;
}

/** The fragment side: `treeDirectionalVisibility(lightIndex, biasMetres)`. */
export function getTreeShadowFragment(perPixel: boolean, taps: number): string {
  return perPixel
    ? `${TREE_SHADOW_SAMPLERS}
${getTreeShadowPixelFragment(taps)}`
    : TREE_SHADOW_VERTEX_FRAGMENT;
}

/** Direct light on a part with no shadow map to read: the template's occlusion stands in for one. */
const TREE_UNSHADOWED_LIGHT = 'mix(0.3, 1.0, occlusion)';

/** The level of detail a wood shader is written for: far wood has just one, 2. */
function getTreeWoodLevel(lod: number): number {
  return Math.min(lod, 2);
}

function getTreeWoodVertex(lod: number, opaque: boolean, palm: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-wood-vs
#define TREE_WOOD_LOD ${getTreeWoodLevel(lod)}
${opaque ? '#define TREE_WOOD_OPAQUE' : ''}
${TREE_SAMPLER_PRECISION_GLSL}

in vec4 treeCenter;
in vec4 treePrevious;
in vec4 treeRadial;
in vec4 treeBark;
in vec4 treeShade;
in float instanceTreeRow;

out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
// Where the surface rests in the tree, in metres, however it moves or grows, and how far it faces up there.
out vec4 vRest;
// Bark u, bark v in metres, mature radius in metres, age in growth.
out vec4 vBark;
// Occlusion, radius now in metres, stable seed, part flags.
out vec4 vWood;
// Bark tint in linear space, and whether this ring is torn from the one before.
out vec4 vTint;
// Decay, coverage, limb hash, and on the trunk the distance from the graft line, on a root how far into its torn end,
// on a soil plate how deep in it.
out vec4 vFate;
// What treeCrownLight gives.
out vec4 vCrown;

${TREE_PHOTOREAL_VERTEX_CHUNK}
${getTreeShadowVertex(lod === 0)}

const float TREE_WOOD_FEWEST_PIXELS = 0.22;

void main(void) {
  geometry.uv = treeBark.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  gl_Position = TREE_CULLED;
  int row = treePhotoreal.woodLevel.w > 0.0
    ? int(treePhotoreal.woodLevel.w - 1.0 + 0.5)
    : int(instanceTreeRow + 0.5);
#ifdef TREE_WOOD_OPAQUE
  // The draw selects mature, upright and undamaged trees with full coverage.
  vec4 life = treeStateTexel(row, ${LIFE});
  vec4 misc = treeStateTexel(row, ${MISC});
  treeSetLife(
    vec4(1.0, life.yzw),
    vec4(0.0, 0.0, 0.0, treeStateTexel(row, ${POSE}).w),
    vec4(misc.xy, 1.0, misc.w),
    treeStateTexel(row, ${DETAIL})
  );
  float flags = treeShade.w;
  if (mod(flags, 4.0) >= 1.0) return;
  const bool isRoot = false;
  const bool isSoil = false;
  const bool isHidden = false;
#else
  treeLoadLife(row);
  if (tree.growth <= 0.0 || tree.coverage <= 0.0 || tree.decay >= 1.0) return;

  float flags = treeShade.w;
  bool isRoot = mod(flags, 2.0) >= 1.0;
  bool isSoil = mod(floor(flags / 2.0), 2.0) >= 1.0;
  bool isHidden = isRoot || isSoil;
#endif
  // How far roots and the plate of soil have come out of the ground as the tree leans: what their places in the tree
  // are scaled by, across and up, and their girth. And how deep under its top a point of the plate lies, as a share of
  // its thickness under the trunk. All of it is worked out here, where a part of a tree that stands has gone already,
  // so that wood pays for none of it.
  vec3 plateIn = vec3(1.0);
  float soilDepth = 0.0;
  if (isHidden) {
    float lifted = smoothstep(TREE_LEAN_ROOTS_FROM, TREE_LEAN_ROOTS_TO, tree.lean);
    if (lifted <= 0.0) return;
    // Both were laid out in the template's trunk radii, so they keep to this tree's trunk and grow with it, as the
    // plate's rim does, whatever the crown's proportions say of where the template's units are.
    vec4 size = treeStateTexel(row, ${SIZE});
    vec2 ratio = treePhotoreal.woodLevel.yz;
    float grown = treeRingRadius(1.0, 0.0, tree.growth);
    vec3 trunk = ratio.x > 0.0
      ? grown * tree.trunkRadius / (vec3(ratio.yy, ratio.x) * max(size.xyz, vec3(1e-6)))
      : vec3(1.0);
    if (isSoil) {
      // A soil ring's radius is the plate's own, in metres already: only its stations' heights take the scale.
      float up = ratio.x > 0.0 ? trunk.z : grown;
      plateIn = lifted * vec3(1.0, up, 1.0);
      soilDepth = -treeCenter.z * size.z * up / max(${floatLiteral(TREE_ROOT_PLATE_THICKNESS)} * grown * tree.trunkRadius, 1e-6);
    } else {
      plateIn = lifted * vec3(0.5 * (trunk.x + trunk.y), trunk.z, 1.0);
    }
  }

  // Growth: the shoot tip advances through the rings, and rings thicken after it passes.
  float g = tree.growth;
  float birth = treeCenter.w;
  float previousBirth = treePrevious.w;
  float advance = clamp((g - previousBirth) / max(birth - previousBirth, 1e-5), 0.0, 1.0);
  float ring = treeRingRadius(treeRadial.w, birth, g);
  if (g < 0.012 && g > birth) ring = treeGerminationTip(ring, treeRadial.w, g - birth);
  if (g <= previousBirth && ring <= 0.0) return;

  treeLoadPlace(row);
  vec3 center = treeTurnYaw(treeToMetres(mix(treePrevious.xyz, treeCenter.xyz, advance)));
  vec3 radial = treeTurnYaw(treeRadial.xyz);
  float rot = smoothstep(0.25, 1.0, tree.decay);
  float radius = ring * tree.trunkRadius * (1.0 - 0.72 * rot);
  // Rotting wood sags unevenly along its length.
  if (rot > 0.0 && !isSoil) {
    float metres = treeBark.y * tree.size.z;
    radius *= 1.0 - rot * 0.32 * (0.5 + 0.25 * sin(metres * 11.0 + treeShade.z * 40.0) + 0.25 * sin(metres * 29.0));
  }
  vec3 point = center + radial * radius;
  vec3 rest = center + radial * ring * tree.trunkRadius;
  if (isHidden) point = center * plateIn.xxy + radial * (radius * plateIn.z);
  // A soil plate's radials only say which way around it a vertex lies. Its surface is about a flat lens.
  if (isSoil) {
    // The plate as it is in the ground: a soil ring's radials lie flat, so only its height took the lift.
    vec3 plate = point / max(plateIn.x, 1e-6);
    vec3 fromMiddle = (plate + vec3(0.0, 0.0, ${floatLiteral(0.47 * TREE_ROOT_PLATE_THICKNESS)} * tree.trunkRadius)) / max(tree.trunkRadius, 1e-4);
    radial = normalize(vec3(
      fromMiddle.xy / ${floatLiteral(TREE_ROOT_PLATE_RADII * TREE_ROOT_PLATE_RADII)},
      fromMiddle.z / ${floatLiteral(0.25 * TREE_ROOT_PLATE_THICKNESS * TREE_ROOT_PLATE_THICKNESS)}
    ));
  }
  if (g < 0.012 && !isHidden) {
    mat3 hook = treeGerminationBend(point);
    radial = hook * radial;
  }

  // Limb breaks, in the frame before lean.
  int outerLimb = int(treeBark.z + 0.5);
  int innerLimb = int(treeBark.w + 0.5);
  mat3 turn = mat3(1.0);
  float swing = 0.0;
  float tear = 0.0;
  if (tree.damage > 0.0) {
    swing = treeApplyBreaks(outerLimb, innerLimb, point, turn);
    radial = turn * radial;
    // A limb that came free leaves its tube behind. The rings around the break would stretch all the
    // way to the ground, so its first ring marks the triangles on both sides of it for the fragment
    // stage to drop. The first ring is the one whose previous ring lies behind the limb's pivot.
    if (treeFreed > 0.0 && innerLimb > 0) {
      vec3 pivot = treeLimbTexel(innerLimb, 0).xyz;
      if (dot(treePrevious.xyz - pivot, treeCenter.xyz - pivot) <= 1e-5) tear = 1.0;
    }
  }

  point = treeLeanPoint(point);
  radial = treeLeanTurn(radial);

  treeWindLoad();
  if (tree.windStrength > 0.0 && !isHidden) {
    vec3 sway = treeLimbSway(outerLimb, innerLimb, point) * (1.0 - swing);
#ifdef TREE_WOOD_OPAQUE
    // The detailed position and normal use the same wind rotation at this point.
    vec3 bent = treeWindPoint(point);
    radial = tree.windDetail > 0.0 || tree.groundDetail > 0.0
      ? treeTurnBy(radial, tree.windTurn + treeSwayTurn)
      : treeWindTurn(radial, point.z);
    point = bent + sway;
#else
    radial = treeWindTurn(radial, point.z);
    point = treeWindPoint(point) + sway;
#endif
  }

  point = treeDecayPoint(point);
  if (!isHidden) point.z = max(point.z, TREE_GROUND);

  vec4 commonPosition = treeProject(point);
  vPosition = commonPosition.xyz;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  // What the shadow pass also needs: rot, coverage and torn rings.
  vec4 tint = treeStateTexel(row, ${TRUNK});
  vBark = vec4(treeBark.x, treeBark.y * tree.size.z, treeRadial.w * tree.trunkRadius, g - birth);
  vTint = vec4(pow(tint.rgb, vec3(2.2)), tear);
  if (g < 0.012) {
    // A new shoot has not greened yet: it takes the tint, made pale, with less of the young shoot's color.
    float pale = treeGerminationHook();
    vBark.w = mix(vBark.w, 0.06, pale);
    vTint.rgb = mix(vTint.rgb, vec3(0.62, 0.6, 0.42), pale);
  }
  // Distance from the graft line, in widths of its blend, on the trunk. A root's last ring closes on its torn end.
  // On a soil plate, how deep under its top a point is.
  float graft = isRoot
    ? (treeRadial.w <= 0.0 ? 1.0 : 0.0)
    : isSoil
      ? soilDepth
      : treeShade.y < 0.5 ? (treeBark.y - ${floatLiteral(TREE_CITRUS_BUD_UNION_Z)}) / 0.0032 : 100.0;
${
  palm
    ? /* glsl */ `  if (!isRoot && !isSoil) {
    // Bark v is normalized shaft height before the wood vertex applies the owner's dimensions.
    graft = treeShade.y < 0.5 ? treeBark.y * ${floatLiteral(PALM_SHAFT_SCAR_FREQUENCY)} : -1.0;
  }`
    : ''
}
  vFate = vec4(tree.decay, tree.coverage * tint.a, fract(float(innerLimb) * 0.61803399), graft);
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) return;
  treeShadowWrite(commonPosition, treeShade.z, 0.12);
#endif

  vCamera = project.cameraPosition;
  vNormal = treeToCommonDirection(radial);
  vRest = vec4(rest, treeRadial.z);
  geometry.normal = vNormal;
  // Wood far under a pixel wide falls between a pixel's samples and breaks into dashes, so it keeps a little width.
  if (ring > 0.0 && !isHidden) {
    mat4 viewProjection = project.viewProjectionMatrix;
    float pixelsPerUnit = length(vec3(viewProjection[0].y, viewProjection[1].y, viewProjection[2].y)) *
      project.viewportSize.y * 0.5 / max(gl_Position.w, 1e-6);
    float extra = TREE_WOOD_FEWEST_PIXELS / pixelsPerUnit - radius * project_size(1.0);
    if (extra > 0.0) gl_Position.xy += (viewProjection * vec4(vNormal * extra, 0.0)).xy;
  }
  // A crotch and the valleys of a trunk stay darker, leaves or no leaves. What a full crown hides is in vCrown.
  float occlusion = mix(1.0, treeShade.x, smoothstep(0.1, 0.6, g) * 0.42);
  vWood = vec4(occlusion, ring * tree.trunkRadius, treeShade.z, flags);
  // Roots and the plate of soil lie open to the sky, on the outside of the crown, once there is any to see of them.
  vCrown = vec4(1.0, 1.0, 1.0, 0.0);
  if (!isHidden) {
#if TREE_WOOD_LOD < 2
    vCrown = treeCrownLight(center, treeShade.x);
#else
    // Far wood is a few pixels wide and costs next to nothing: how deep it lies in a full crown says about the same.
    float full = smoothstep(0.08, 0.5, g) * tree.foliage * tree.coverage * (1.0 - 0.75 * tree.damage) *
      (1.0 - smoothstep(0.0, 0.5, tree.decay));
    float through = mix(1.0, treeShade.x * treeShade.x, full);
    vCrown = vec4(through, through, through, full);
#endif
  }

  // Extensions filter the color the part is made of, and light shades the result.
  vec4 filtered = vec4(vTint.rgb, 1.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
  vTint.rgb = filtered.rgb;
}
`;
}

function getTreeWoodFragment(lod: number, opaque: boolean, palm: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-wood-fs
#define TREE_WOOD_LOD ${getTreeWoodLevel(lod)}
${opaque ? '#define TREE_WOOD_OPAQUE' : ''}
${TREE_SAMPLER_PRECISION_GLSL}

in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec4 vRest;
in vec4 vBark;
in vec4 vWood;
in vec4 vTint;
in vec4 vFate;
in vec4 vCrown;

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${getTreeShadowFragment(lod === 0, 8)}

vec3 gNormal;
vec3 gView;
vec3 gDiffuse = vec3(0.0);
vec3 gSpecular = vec3(0.0);
float gShininess;

// Bark is rough, so it is lit more evenly than a smooth tube, and with the sun at one's back it does not fall off to a
// limb's edge, as the full moon does not. A limb aimed near the camera is all edge, and goes black without this.
void treeWoodLight(vec3 light, vec3 color, float visibility) {
  // Bark's own roughness has faces toward a light that its surface as a whole has turned from.
  float facing = dot(gNormal, light);
  float wrapped = max((facing + 0.22) / 1.22, 0.0);
  float seen = max(dot(gNormal, gView), 0.0);
  float across = dot(light, gView) - facing * seen;
  float rough = 0.78 + 0.34 * across / max(across > 0.0 ? max(max(facing, 0.0), seen) : 1.0, 0.05);
  gDiffuse += color * wrapped * max(rough, 0.0) * visibility;
  if (facing > 0.0) {
    vec3 halfway = normalize(light + gView);
    gSpecular += color * pow(max(dot(gNormal, halfway), 0.0), gShininess) * visibility;
  }
}

// Value noise with its gradient: x is the value, yzw how it changes along each axis.
vec4 treeNoiseSlope(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = p - cell;
  vec3 u = f * f * (3.0 - 2.0 * f);
  vec3 du = 6.0 * f * (1.0 - f);
  float a = treeHash(cell);
  float b = treeHash(cell + vec3(1.0, 0.0, 0.0));
  float c = treeHash(cell + vec3(0.0, 1.0, 0.0));
  float d = treeHash(cell + vec3(1.0, 1.0, 0.0));
  float e = treeHash(cell + vec3(0.0, 0.0, 1.0));
  float g = treeHash(cell + vec3(1.0, 0.0, 1.0));
  float h = treeHash(cell + vec3(0.0, 1.0, 1.0));
  float k = treeHash(cell + vec3(1.0, 1.0, 1.0));
  float xy = a - b - c + d;
  float yz = a - c - e + h;
  float zx = a - b - e + g;
  float xyz = -a + b + c - d + e - g - h + k;
  return vec4(
    a + (b - a) * u.x + (c - a) * u.y + (e - a) * u.z + xy * u.x * u.y + yz * u.y * u.z + zx * u.z * u.x +
      xyz * u.x * u.y * u.z,
    du * vec3(
      b - a + xy * u.y + zx * u.z + xyz * u.y * u.z,
      c - a + yz * u.z + xy * u.x + xyz * u.z * u.x,
      e - a + zx * u.x + yz * u.y + xyz * u.x * u.y
    )
  );
}

// Fissures are where noise crosses its middle, so they join up and wander as cracks in bark do. Returns how far
// this point is from the nearest, in cells, an estimate that keeps a fissure one width whatever the noise's
// slope. 'away' is the unit way out of it, and the sign of 'side' says which plate this is.
float treeFissure(vec3 q, out vec3 away, out float side) {
  vec4 a = treeNoiseSlope(q);
  side = a.x - 0.5;
  float steep = max(length(a.yzw), 0.15);
  away = (side < 0.0 ? -a.yzw : a.yzw) / steep;
  return abs(side) / steep;
}

// The same with a second octave, for more and finer branching cracks.
float treeFissureFine(vec3 q, out vec3 away, out float side) {
  vec4 a = treeNoiseSlope(q);
  vec4 b = treeNoiseSlope(q * 2.17 + 13.7);
  side = a.x * 0.72 + b.x * 0.28 - 0.5;
  vec3 slope = a.yzw * 0.72 + b.yzw * 0.6076;
  float steep = max(length(slope), 0.15);
  away = (side < 0.0 ? -slope : slope) / steep;
  return abs(side) / steep;
}

// How much of a pattern this wavelength across a shoot, stretched along it, a pixel shows.
float treeBarkFade(vec2 foot, float wavelength, float stretch) {
  return 1.0 - smoothstep(wavelength * 0.22, wavelength * 0.85, max(foot.x, foot.y / max(stretch, 1.0)));
}

// Of a fissure of half width 'width' cells, how much of a plate's height is here, 0 in it, 1 on the plate. A pixel
// too coarse to see the fissure sees a wider, fainter one, which keeps its share of the light. Returns that height
// and how steep its wall is, from 2 at its middle to 0 at its edge, as the walls of a crack stand at one angle
// however wide it opens.
vec2 treeFissureProfile(float distance, float width, float pixel) {
  float wide = max(width, pixel);
  float t = clamp(distance / wide, 0.0, 1.0);
  float faint = width / wide;
  return vec2(1.0 - faint * (1.0 - t) * (1.0 - t), faint * 2.0 * (1.0 - t));
}

// What the layers of a surface add up to: how its height changes across a pixel, in metres, how far it stands
// proud, 0 deep in a fissure and 1 on a plate, and what multiplies its color. Domains add with their weights.
vec2 gHeightStep = vec2(0.0);
float gBarkHeight = 0.0;
float gBarkTone = 0.0;
float gStain = 0.0;
float gStreak = 0.0;

// Bark in layers on one domain of noise, from the swells of a limb to its grain. p is the point in it, in metres,
// and pX and pY its change across a pixel. Each layer fades when a pixel is too coarse for it, about a mean of 1,
// so a limb has one value at any distance. 'old' is how much this wood is bark at all, 'coarse' how much rougher
// than usual, foot how much bark a pixel covers, around the shoot and along it, and 'lengthen' how far of a style's
// stretch this domain has, as only some know which way a shoot runs.
void treeBarkLayers(
  vec3 p,
  vec3 pX,
  vec3 pY,
  vec2 foot,
  float old,
  float coarse,
  float seed,
  float lengthen,
  float weight
) {
  vec4 style = treePhotoreal.barkA;
  float depth = style.x * 2.4 * (1.0 + 0.6 * coarse);
  float frequency = style.y;
  float stretch = 1.0 + (style.z - 1.0) * lengthen;
  float pixel = max(foot.x, foot.y);
  vec3 slope = vec3(0.0);
  float tone = 1.0;
  float height = 1.0;
  float wander = 0.0;

  // What sun and rain have done to it, which carries furthest, follows its swells and ridges.
  float stain = 0.5;
  float streak = 0.5;

  // As finer layers go, those that stay take over their contrast, so limbs do not smooth into noodles with distance.
  float fineGone = 1.0 - treeBarkFade(foot, 1.62 / frequency, stretch * 0.9) * old;
  float ridgesGone = 1.0 - treeBarkFade(foot, 5.0 / frequency, stretch * 0.6);

  // Swells: no limb is a tube.
  vec3 scale = vec3(0.045, 0.045, 0.045 / max(stretch * 0.4, 1.0)) * frequency;
  float fade = treeBarkFade(foot, 22.0 / frequency, stretch * 0.4);
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * scale + 3.7 + seed * 37.0);
    slope += n.yzw * scale * 0.017 * depth * fade * mix(0.25, 1.0, old) * (1.0 + ridgesGone);
    tone *= 1.0 + (n.x - 0.5) * 0.5 * ridgesGone * old * fade;
    stain = mix(0.5, n.x, fade);
    wander = n.x - 0.5;
  }

  // Ridges a few centimetres across, long and low.
  scale = vec3(0.2, 0.2, 0.2 / max(stretch * 0.6, 1.0)) * frequency;
  fade = 1.0 - ridgesGone;
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * scale + 11.1 + seed * 19.0);
    slope += n.yzw * scale * 0.0034 * depth * fade * mix(0.2, 1.0, old) * (1.0 + 2.0 * fineGone);
    // At that distance the bark's plates are patches, which have an edge.
    float patchy = (smoothstep(0.38, 0.62, n.x) - 0.5) * 0.5 * fineGone;
    tone *= 1.0 + ((n.x - 0.5) * mix(0.0, 0.9, fineGone) + patchy) * old * fade;
    streak = mix(0.5, n.x, fade);
    wander += (n.x - 0.5) * 0.5;
  }

#if TREE_WOOD_LOD < 2
  float fray = 0.0;
  // Plates between the main fissures, which fray at the edge, and open and close along their length.
  // Fissures are as marked as a style's bark is deep, so a smooth bark has only a trace of them.
  float marked = min(style.x / 0.42, 1.0);
  scale = vec3(0.62, 0.62, 0.62 / max(stretch * 0.9, 1.0)) * frequency;
  fade = treeBarkFade(foot, 1.62 / frequency, stretch * 0.9) * old * marked;
  if (fade > 0.0) {
    vec3 away;
    float side;
    vec3 q = p * scale + vec3(wander * 2.3, -wander * 1.7, wander * 0.7);
    float gap = treeFissure(q, away, side);
    float cells = max(foot.x * scale.x, foot.y * scale.z);
    // Fray too fine for a pixel would break a fissure into dots.
    float fine = 1.0 - smoothstep(0.2, 0.6, cells * 4.3);
    if (fine > 0.0) fray = (treeNoise(q * vec3(4.3, 4.3, 6.1) + 3.1) - 0.5) * fine;
    float width = mix(0.024, 0.115, smoothstep(-0.2, 0.3, wander + fray * 0.4)) * (1.0 + 0.6 * coarse) * (1.0 + 1.4 * style.w);
    vec2 profile = treeFissureProfile(max(gap + fray * 0.12, 0.0), width, cells);
    // A plate is rounded across, so the light rolls over it into the fissure.
    float rounded = smoothstep(0.0, 0.42, gap);
    slope += away * (scale / scale.x) * (profile.y * 0.42 + (1.0 - rounded) * 0.25) * depth * fade;
    height = mix(1.0, profile.x * mix(0.65, 1.0, rounded), fade);
    tone *= 1.0 + ((profile.x - 0.92) * 0.34 + (rounded - 0.72) * 0.26 + clamp(side * 6.0, -1.0, 1.0) * 0.07) * fade;
  }

  // Scales of the outer bark: a mottle, and here and there a paler flake with an edge to it.
  scale = vec3(0.8, 0.8, 0.8 / max(stretch * 0.28, 1.0)) * frequency;
  fade = treeBarkFade(foot, 1.25 / frequency, stretch * 0.28) * old;
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * scale + vec3(wander * 2.2 + fray * 0.9, fray * 0.7, 41.0));
    // A scale has an edge, sharp up close and blurring with the pixel.
    float edge = max(0.045, max(foot.x * scale.x, foot.y * scale.z) * 0.6);
    float scaled = smoothstep(0.5 - edge, 0.5 + edge, n.x);
    slope += n.yzw * scale * 0.0009 * depth * fade;
    tone *= 1.0 + ((n.x - 0.5) * 0.3 + (scaled - 0.5) * 0.22) * fade;
  }

  // Fine fissures, what bark is made of up close.
  scale = vec3(1.0, 1.0, 1.0 / max(stretch, 1.0)) * frequency;
  fade = treeBarkFade(foot, 1.0 / frequency, stretch) * mix(0.3, 1.0, old) * marked;
  if (fade > 0.0) {
    vec3 away;
    float side;
    vec3 q = p * scale + vec3(wander * 3.1, wander * 2.3, 7.3);
    float gap = treeFissureFine(q, away, side);
    float cells = max(foot.x * scale.x, foot.y * scale.z);
    vec2 profile = treeFissureProfile(max(gap + fray * (1.0 - smoothstep(0.2, 0.6, cells * 2.7)) * 0.14, 0.0), 0.1, cells);
    slope += away * (scale / scale.x) * profile.y * 0.32 * depth * fade;
    height = min(height, mix(1.0, 0.45 + 0.55 * profile.x, fade));
    tone *= 1.0 + (profile.x - 0.85) * 0.42 * fade;
  }
#endif

#if TREE_WOOD_LOD == 0
  // Grain and crumbs of bark, for a surface that fills the view.
  scale = vec3(4.5, 4.5, 1.6) * frequency;
  fade = treeBarkFade(foot, 0.222 / frequency, 2.8);
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * scale + vec3(wander * 6.0 + fray * 1.4, fray * 1.1, 23.1));
    slope += n.yzw * scale * 0.00021 * depth * fade;
    tone *= 1.0 + (n.x - 0.5) * 0.44 * fade;
  }
#endif

  gHeightStep += weight * vec2(dot(slope, pX), dot(slope, pY));
  gBarkHeight += weight * height;
  gBarkTone += weight * tone;
  gStain += weight * stain;
  gStreak += weight * streak;
}

// Lenticels: small marks scattered in a cell grid, wider across the shoot than along it.
float treeLenticels(vec3 p, vec3 scale) {
  vec3 q = p * scale;
  vec3 cell = floor(q);
  float marked = treeHash(cell + 3.7);
  if (marked > 0.16) return 0.0;
  vec3 f = fract(q) - 0.5 + (vec3(treeHash(cell + 1.3), treeHash(cell + 2.9), treeHash(cell + 5.1)) - 0.5) * 0.5;
  float d = dot(f * vec3(1.7, 1.7, 2.6), f * vec3(1.7, 1.7, 2.6));
  return smoothstep(0.22, 0.05, d) * (0.5 + marked * 3.0);
}

// Whether rot has taken this point. Wood is holed, then breaks across into pieces, each from its ends and in its
// own time, the thin first, and the last goes just before decay 1 takes the whole tree away. The shadow and
// picking passes ask too, so this must depend on nothing but the surface.
bool treeRotGone(vec3 tube, float decay, float limb, float radius) {
  // On average as much as the standard pipeline's getWoodCoverage leaves.
  float rotted = clamp((decay - 0.45) / 0.55, 0.0, 1.0);
  if (rotted <= 0.0) return false;
  if (treeNoise(tube * vec3(30.0, 30.0, 11.0) + limb * 91.0) < rotted * rotted * 0.26) return true;
  float along = tube.z / (radius > 0.06 ? 0.72 : 0.3) + limb * 7.3 +
    0.9 * treeNoise(vec3(tube.z * 2.1, limb * 61.0, 1.7)) +
    0.55 * (treeNoise(tube * vec3(16.0, 16.0, 7.0) + limb * 17.0 + 31.7) - 0.5);
  float chance = treeHash(vec3(floor(along), limb * 173.0, 5.3));
  float early = 0.26 * (1.0 - smoothstep(0.004, 0.04, radius));
  float open = clamp((rotted + early - chance * 0.6) / 0.4, 0.0, 1.0);
  return abs(fract(along) - 0.5) * 2.0 > 1.0 - open * open * open;
}

// The nearest of the jittered points around p, in cells: xyz the way from it to p, and w a value of its own.
vec4 treeNearestPoint(vec3 p) {
  vec3 corner = floor(p + 0.5);
  vec4 nearest = vec4(0.0);
  float best = 9.0;
  for (int k = 0; k < 8; k++) {
    vec3 cell = corner - vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 way = p - cell - vec3(treeHash(cell + 1.3), treeHash(cell + 2.9), treeHash(cell + 5.1));
    float size = dot(way, way);
    if (size < best) {
      best = size;
      nearest = vec4(way, treeHash(cell + 7.7));
    }
  }
  return nearest;
}

// Soil at a point in the tree, in metres: lumps, rounded clods with creases between them, the crumbs they are made
// of, then grit. Fills the height's change across a pixel, and returns its color. Underside is 1 on what was deep in
// the ground.
vec3 treeSoil(vec3 p, vec3 pX, vec3 pY, float underside, vec2 around) {
  float pixel = max(length(pX), length(pY));
  vec3 slope = vec3(0.0);
  float tone = 0.0;
  float proud = 0.6;
  float patches = 0.5;
  // Lumps, as far as they can be seen.
  float fade = 1.0 - smoothstep(0.03, 0.12, pixel);
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * 6.0 + 3.1);
    slope += n.yzw * 6.0 * 0.07 * fade;
    tone += (n.x - 0.5) * 0.42 * fade;
    patches = mix(0.5, treeNoise(p * 3.1 + 17.0), fade);
  }
#if TREE_WOOD_LOD < 2
  fade = 1.0 - smoothstep(0.008, 0.03, pixel);
  if (fade > 0.0) {
    // Clods, with a shape of their own, and dark creases.
    vec4 lean = treeNoiseSlope(p * 21.0 + 9.3);
    vec3 q = p * vec3(19.0, 19.0, 24.0) + lean.yzw * 0.35;
    vec4 clod = treeNearestPoint(q);
    float dome = 1.0 - dot(clod.xyz, clod.xyz) * 1.7;
    slope += -clod.xyz * vec3(19.0, 19.0, 24.0) * 3.4 * 0.0115 * fade;
    proud = mix(proud, clamp(dome, 0.0, 1.0), fade);
    tone += (clamp(dome, -0.2, 1.0) * 0.8 - 0.42 + (clod.w - 0.5) * 0.46) * 0.6 * fade;
    // Crumbs on them.
    float near = 1.0 - smoothstep(0.0024, 0.009, pixel);
    if (near > 0.0) {
      q = p * 66.0 + lean.yzw * 0.7 + 5.7;
      vec4 crumb = treeNearestPoint(q);
      float small = 1.0 - dot(crumb.xyz, crumb.xyz) * 1.7;
      slope += -crumb.xyz * 66.0 * 3.4 * 0.0032 * near;
      tone += (clamp(small, -0.2, 1.0) * 0.62 - 0.32 + (crumb.w - 0.5) * 0.34) * near;
    }
  }
  // Grit, and what it is made of.
  fade = 1.0 - smoothstep(0.0009, 0.0034, pixel);
  if (fade > 0.0) {
    vec4 n = treeNoiseSlope(p * 240.0);
    slope += n.yzw * 240.0 * 0.0009 * fade;
    tone += (n.x - 0.5) * 0.5 * fade;
    float close = 1.0 - smoothstep(0.00025, 0.001, pixel);
    if (close > 0.0) {
      vec4 fine = treeNoiseSlope(p * 760.0 + 5.0);
      slope += fine.yzw * 760.0 * 0.00024 * close;
      tone += (fine.x - 0.5) * 0.36 * close;
    }
  }
#endif
  gHeightStep = vec2(dot(slope, pX), dot(slope, pY));
  gBarkHeight = proud;
  // Pale grey sand all through it, darker in patches. Under the old ground on top the roots bind it into a dark fibrous
  // mat, which shows round the rim of the face a plate turns up, and where the sand has fallen away from it.
  vec3 sand = mix(vec3(0.34, 0.33, 0.305), vec3(0.24, 0.23, 0.21), patches);
  float mat = max(1.0 - smoothstep(0.08, 0.42, underside + (patches - 0.5) * 0.4), smoothstep(0.7, 0.86, patches) * 0.8);
  vec3 color = mix(sand, vec3(0.05, 0.04, 0.03), mat);
  color *= clamp(1.0 + tone, 0.3, 1.8);
#if TREE_WOOD_LOD < 2
  fade = 1.0 - smoothstep(0.004, 0.012, pixel);
  if (fade > 0.0) {
    // Fibrous roots, running out from the trunk through the sand, dark against it.
    vec3 away;
    float side;
    vec3 line = vec3(around * 56.0, length(p.xy) * 3.0 + p.z * 3.0);
    float gap = treeFissure(line, away, side);
    float cells = pixel * 66.0 / max(length(p.xy), 0.1);
    float rootlet = 1.0 - treeFissureProfile(gap, 0.03, cells).x;
    rootlet *= smoothstep(0.42, 0.62, treeNoise(p * 7.0 + 51.0));
    color = mix(color, vec3(0.032, 0.024, 0.016), rootlet * fade * 0.8);
  }
#endif
  return color;
}

float gRotTone = 1.0;

// Rotten wood: long cracks with the grain and short ones across it that break it into blocks, the bark coming away
// from them in flakes, and fibres in what is left. Adds the relief to gHeightStep, sets gRotTone, and returns how far
// this point stands proud of the deepest crack.
float treeRotCracks(
  vec3 tube,
  vec2 foot,
  float pixel,
  float rotting,
  float crumbling,
  vec2 aroundX,
  vec2 aroundY,
  float alongX,
  float alongY,
  float radius
) {
  vec3 slope = vec3(0.0);
  vec3 away;
  float side;
  // Wide cracks show from far off, and each one frays, so long as a pixel can see it.
  vec3 scale = vec3(9.0, 9.0, 1.8);
  float wobble = 0.5;
  float fade = 1.0 - smoothstep(0.003, 0.009, pixel);
  if (fade > 0.0) wobble = mix(0.5, treeNoise(tube * vec3(70.0, 70.0, 24.0) + 3.0), fade);
  float gap = treeFissureFine(tube * scale + 57.0, away, side) + (wobble - 0.5) * 0.09;
  vec2 profile = treeFissureProfile(max(gap, 0.0), mix(0.015, 0.085, rotting), max(foot.x * scale.x, foot.y * scale.z));
  slope += away * (scale / scale.x) * profile.y * 0.8;
  float tone = mix(0.08, 1.0, profile.x);
  float proud = profile.x;
  // The lie of a block, which catches the sun or does not.
  tone *= 1.0 + clamp(side * 7.0, -1.0, 1.0) * 0.18;
#if TREE_WOOD_LOD < 2
  fade = 1.0 - smoothstep(0.01, 0.035, pixel);
  if (fade > 0.0) {
    // Finer cracks with the grain.
    scale = vec3(31.0, 31.0, 7.0);
    gap = treeFissureFine(tube * scale + 71.0, away, side) + (wobble - 0.5) * 0.12;
    profile = treeFissureProfile(max(gap, 0.0), mix(0.03, 0.1, rotting), max(foot.x * scale.x, foot.y * scale.z));
    slope += away * (scale / scale.x) * profile.y * 0.7 * fade;
    tone *= mix(1.0, mix(0.2, 1.0, profile.x), fade);
    proud = min(proud, mix(1.0, profile.x, fade));
    float ledge = clamp(side * 7.0, -1.0, 1.0);
    // Cracks across the grain, stepped from one plate to the next.
    scale = vec3(10.0, 10.0, 40.0);
    gap = treeFissure(tube * scale + vec3(0.0, 0.0, ledge * 0.8) + 83.0, away, side) + (wobble - 0.5) * 0.14;
    float acrossWidth = mix(0.0, 0.085, clamp(crumbling * 1.3 + rotting * 0.5, 0.0, 1.0));
    profile = treeFissureProfile(max(gap, 0.0), acrossWidth, max(foot.x * scale.x, foot.y * scale.z));
    slope += away * (scale / scale.x) * profile.y * 0.3 * fade;
    tone *= mix(1.0, mix(0.16, 1.0, profile.x), fade);
    proud = min(proud, mix(1.0, profile.x, fade));
  }
  // Flakes of bark come away from the darker wood below, with a lifted edge that catches the light.
  fade = 1.0 - smoothstep(0.018, 0.06, pixel);
  if (fade > 0.0) {
    vec4 flake = treeNoiseSlope(tube * vec3(17.0, 17.0, 5.5) + 91.0);
    float level = flake.x + (wobble - 0.5) * 0.1 - (0.7 - 0.36 * rotting);
    float kept = smoothstep(-0.012, 0.012, level);
    float lip = 1.0 - smoothstep(0.0, 0.045, abs(level));
    tone *= mix(1.0, mix(0.42, 1.0, kept) * (1.0 + lip * 0.75 * kept), fade);
    slope += flake.yzw * vec3(17.0, 17.0, 5.5) * (0.0035 + 0.01 * lip) * fade;
    // Fibres in the wood the flakes have left.
    float fibres = 1.0 - smoothstep(0.0012, 0.005, pixel);
    if (fibres > 0.0) {
      vec3 fine = vec3(260.0, 260.0, 16.0);
      vec4 n = treeNoiseSlope(tube * fine);
      slope += n.yzw * fine * 0.00028 * fibres;
      tone *= 1.0 + (n.x - 0.5) * 0.7 * fibres;
    }
  }
#endif
  gRotTone = tone;
  gHeightStep += rotting * vec2(
    dot(slope, vec3(aroundX * radius, alongX)),
    dot(slope, vec3(aroundY * radius, alongY))
  );
  return proud;
}

void main(void) {
#ifndef TREE_WOOD_OPAQUE
  if (vTint.a > 1e-3) discard;
#endif
  float decay = vFate.x;
  float metresV = vBark.y;
  float circumference = vBark.x * TREE_PI * 2.0;
  vec2 around = vec2(cos(circumference), sin(circumference));
#ifndef TREE_WOOD_OPAQUE
  float radius = vBark.z;
  vec3 tube = vec3(around * radius, metresV);
  // These remove fragments by stable noise, in the shadow and picking passes too.
  if (decay > 0.45 && treeRotGone(tube, decay, vFate.z, radius)) discard;
  if (vFate.y < 1.0 && treeHash(floor(tube * 96.0) + 3.1) >= vFate.y) discard;

  geometry.uv = vBark.xy;
${TREE_PICKING_FRAGMENT_GLSL}
${TREE_SHADOW_FRAGMENT_GLSL}
#endif

  float flags = vWood.w;
  bool isRoot = mod(flags, 2.0) >= 1.0;
  bool isSoil = mod(floor(flags / 2.0), 2.0) >= 1.0;
  vec3 up = treeUp(vPosition);
  gView = normalize(vCamera - vPosition);
  vec3 surface = normalize(vNormal);
  vec3 positionX = dFdx(vPosition);
  vec3 positionY = dFdy(vPosition);
  // A tube of few sides has normals that turn away from the camera at its edge, and would go black there.
  surface = normalize(surface + gView * max(0.04 - dot(surface, gView), 0.0));
  vec3 restX = dFdx(vRest.xyz);
  vec3 restY = dFdy(vRest.xyz);
  float restPixel = max(length(restX), length(restY));
  vec2 aroundX = dFdx(around);
  vec2 aroundY = dFdy(around);
  float alongX = dFdx(metresV);
  float alongY = dFdy(metresV);

  // Bark's pattern belongs to the wood's girth now, not when mature, so a young trunk's is not squeezed around it.
  float width = vWood.y;
  vec3 onWood = vec3(around * width, metresV);
  // How much bark a pixel covers, around the shoot and along it.
  float footAround = max(length(aroundX), length(aroundY));
  vec2 foot = vec2(footAround * width, max(abs(alongX), abs(alongY)));
  float pixel = max(foot.x, foot.y);

  vec4 barkB = treePhotoreal.barkB;
  float restUp = vRest.w;
  // Thin wood is smooth, and bark comes with girth.
  float old = isRoot ? 1.0 : smoothstep(0.006, 0.035, width);

  // A dark tint says how bark looks in the sun, so a little more reflects than that, and a pale one is near the limit
  // of what bark can. A bark's grey wins out over its tint.
  float tinted = dot(vTint.rgb, vec3(0.3, 0.55, 0.15));
  vec3 tint = vTint.rgb * mix(1.16, 0.72, smoothstep(0.1, 0.55, tinted));
  float grey = dot(tint, vec3(0.3, 0.55, 0.15));
  vec3 base = mix(tint, vec3(grey) * vec3(1.03, 0.98, 0.9), barkB.z);

${
  palm
    ? /* glsl */ `  if (!isRoot && !isSoil && vFate.w >= 0.0) {
    float phase = abs(fract(vFate.w + 0.5) - 0.5);
    float footprint = fwidth(vFate.w);
    float scar = (1.0 - smoothstep(0.05, 0.13 + footprint, phase)) *
      (1.0 - smoothstep(0.16, 0.55, footprint));
    base *= mix(vec3(1.0), vec3(0.65, 0.58, 0.48), scar);
  }`
    : ''
}
  // Rootstock and scion differ, darker and rougher below a graft line that is nowhere sharp.
  float rootstock = 0.0;
  if (barkB.w > 0.0 && !isRoot && !isSoil && vFate.w < 6.0) {
    vec3 onTrunk = vec3(around * 0.25, metresV);
    float wobble = (treeNoise(onTrunk * vec3(7.0, 7.0, 2.4) + 3.3) - 0.5) * 3.2;
    rootstock = (1.0 - smoothstep(-1.6, 1.6, vFate.w + wobble)) * barkB.w;
  }

  if (isSoil) {
    float underside = clamp(vFate.w * 2.0, -1.0, 1.0);
    base = treeSoil(vRest.xyz, restX, restY, underside, around);
    // A torn plate's triangles have flat faces. A little of them keeps its large shape, and the soil hides the rest.
    vec3 face = normalize(cross(positionX, positionY));
    if (dot(face, gView) < 0.0) face = -face;
    surface = normalize(mix(surface, face, 0.34));
  } else if (pixel < 0.14) {
    // Noise reads this domain on a circle of its own, not the wood's radius, which flutes and swells from vertex to
    // vertex and would make the pattern slide and kink at each edge. It goes up in steps, crossfading.
    float level = log2(max(width, 0.0015)) / 0.7;
    float low = floor(level);
    float upper = smoothstep(0.38, 0.62, level - low);
    float circleLow = pow(2.0, low * 0.7);
    float circleHigh = circleLow * 1.6245;
    // Bark u and v are squeezed into a collar's fillet and the inside of a bend, and where a root flare runs outward
    // bark v hardly moves. There bark's pattern runs on from where it rests in the tree, not knowing the way of a
    // shoot. A collar still ends on its parent's and its child's own bark.
    float squeeze = restPixel > 0.0 ? pixel / restPixel : 1.0;
    float squeezed = max(smoothstep(1.7, 3.2, squeeze), smoothstep(0.62, 0.36, squeeze));
    float onTube = 1.0 - squeezed;
    if (onTube * (1.0 - upper) > 0.0) {
      treeBarkLayers(
        vec3(around * circleLow, metresV),
        vec3(aroundX * circleLow, alongX),
        vec3(aroundY * circleLow, alongY),
        vec2(footAround * circleLow, foot.y),
        old,
        rootstock,
        vWood.z,
        1.0,
        onTube * (1.0 - upper)
      );
    }
    if (onTube * upper > 0.0) {
      treeBarkLayers(
        vec3(around * circleHigh, metresV),
        vec3(aroundX * circleHigh, alongX),
        vec3(aroundY * circleHigh, alongY),
        vec2(footAround * circleHigh, foot.y),
        old,
        rootstock,
        vWood.z,
        1.0,
        onTube * upper
      );
    }
    if (squeezed > 0.0) {
      treeBarkLayers(vRest.xyz, restX, restY, vec2(restPixel), old, rootstock, vWood.z, 0.3, squeezed);
    }
  } else {
    gBarkHeight = 1.0;
    gBarkTone = 1.0;
    gStain = 0.5;
    gStreak = 0.5;
  }
  float height = isSoil ? gBarkHeight : clamp(gBarkHeight, 0.0, 1.0);

  if (!isSoil) {
    base *= mix(0.68, 1.32, gStain) * mix(0.8, 1.2, gStreak);
    if (!isRoot) {
      // Sun bleaches what faces up where it grew, and the wet and shade keep what faces down dark.
      float exposed = mix(0.5, 1.0, smoothstep(0.62, 1.0, vWood.x));
      float bleach = smoothstep(0.08, 1.0, restUp + (gStreak - 0.5) * 0.8 + (gStain - 0.5) * 0.5) * exposed;
      vec3 silver = vec3(dot(base, vec3(0.3, 0.55, 0.15))) * vec3(1.32, 1.3, 1.24) + 0.006;
      base = mix(base, silver, bleach * mix(0.3, 0.78, old));
      base *= mix(vec3(1.0), vec3(0.62, 0.56, 0.5), (1.0 - smoothstep(-0.95, -0.12, restUp)) * old);
    }
    base *= mix(vec3(1.0), vec3(0.86, 0.83, 0.8), rootstock);
    base *= clamp(gBarkTone, 0.2, 1.8);

    // Young shoots are green and smooth, and bark grows over them. The thinnest twigs of any age have some green.
    float young = (1.0 - smoothstep(0.012, 0.1, vBark.w)) * (1.0 - smoothstep(0.005, 0.014, width));
    float twig = isRoot ? 0.0 : 1.0 - smoothstep(0.0022, 0.0055, width);
    base = mix(base, mix(base, treePhotoreal.barkC.rgb, 0.5), twig);
    base = mix(base, treePhotoreal.barkC.rgb, young);

#if TREE_WOOD_LOD == 0
    // Lenticels are small and for young wood, but for the barks that keep them, on which they are a feature.
    bool keepsLenticels = barkB.x >= 0.5;
    vec3 marks = keepsLenticels ? vec3(70.0, 70.0, 210.0) : vec3(240.0, 240.0, 300.0);
    float lenticelFade = (1.0 - smoothstep(0.13, 0.42, pixel * marks.x)) * barkB.x;
    if (!keepsLenticels) lenticelFade *= 1.0 - smoothstep(0.009, 0.02, width);
    if (lenticelFade > 0.0) {
      float lenticel = clamp(treeLenticels(onWood, marks) * lenticelFade, 0.0, 1.0);
      base = mix(base, barkB.y > 0.5 ? base * 0.16 : mix(base, vec3(0.42, 0.38, 0.28), 0.8), lenticel);
    }
#endif

    if (isRoot) {
      // Bark stained with soil, and pale torn wood at a root's snapped end.
      float caked = 0.0;
      if (pixel < 0.06) caked = smoothstep(0.42, 0.68, treeNoise(onWood * vec3(22.0, 22.0, 8.0) + 15.0));
      base = mix(base * vec3(0.72, 0.62, 0.52), vec3(0.05, 0.036, 0.025), 0.25 + 0.6 * caked);
      float torn = smoothstep(0.3, 0.85, vFate.w);
      if (torn > 0.0) {
        float fibres = pixel < 0.02 ? treeNoise(onWood * vec3(190.0, 190.0, 16.0)) : 0.5;
        base = mix(base, vec3(0.2, 0.155, 0.105) * (0.55 + 0.9 * fibres), torn);
      }
    }

    // Rot greys the wood first, then takes it dark, cracked and flaking from the outside in.
    if (decay > 0.0) {
      float weathered = smoothstep(0.02, 0.2, decay);
      float rotting = smoothstep(0.12, 0.42, decay);
      float crumbling = smoothstep(0.5, 1.0, decay);
      base = mix(base, vec3(dot(base, vec3(0.3, 0.55, 0.15))) * vec3(1.02, 1.0, 0.95), weathered * 0.8);
      if (rotting > 0.0) {
        float blotch = pixel < 0.1 ? treeNoise(onWood * vec3(13.0, 13.0, 4.5) + vFate.z * 37.0) : 0.5;
        vec3 rotten = mix(vec3(0.011, 0.0085, 0.0065), vec3(0.062, 0.046, 0.033), blotch);
        base = mix(base, rotten, rotting);
        // Past a certain distance rot is a color.
        if (pixel < 0.14) {
          height = min(
            height,
            treeRotCracks(onWood, foot, pixel, rotting, crumbling, aroundX, aroundY, alongX, alongY, width)
          );
          // Its marks come in with the dark, as a lifted flake on sound bark would be a bright dash.
          base *= mix(1.0, gRotTone, rotting);
        }
      }
    }
  }

  // The surface with its relief. Each thing above said how its height changes across a pixel, in metres, so this
  // needs no tangents, which a collar, a first ring or a soil plate would not have.
  vec3 normal = surface;
  if (dot(gHeightStep, gHeightStep) > 0.0 && restPixel > 0.0) {
    vec3 sideX = cross(positionY, surface);
    vec3 sideY = cross(surface, positionX);
    float size = dot(positionX, sideX);
    if (abs(size) > 0.0) {
      vec3 tilt = (gHeightStep.x * sideX + gHeightStep.y * sideY) * sign(size) / abs(size);
      tilt *= max(length(positionX), length(positionY)) / restPixel;
      normal = normalize(surface - tilt / (1.0 + 0.45 * length(tilt)));
    }
  }

  float openSky = vCrown.y;
  gNormal = normal;
  gShininess = max(material.shininess, 1.0);
#ifndef MODULE_SHADOW
  {
    float occlusion = vWood.x;
    treeOcclusionLight = ${TREE_UNSHADOWED_LIGHT};
  }
#endif
  treeShadowNormal = surface;
  vec3 sunBounce = vec3(0.0);
  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    vec3 toLight = normalize(-light.direction);
    vec3 color = treeLightColor(light.color);
    treeWoodLight(
      toLight,
      color,
      treeDirectionalVisibility(i, 0.025 + 0.05 * (1.0 - abs(dot(surface, toLight)))) * treeCrownSun(vCrown, i)
    );
    // Sunlit ground lights what faces down, less the more of it a crown shades.
    sunBounce += color * max(dot(toLight, up), 0.0) * mix(1.0, 0.18, vCrown.w);
  }
  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight light = lighting_getPointLight(i);
    vec3 toLight = light.position - vPosition;
    float attenuation = getPointLightAttenuation(light, length(toLight));
    treeWoodLight(normalize(toLight), treeLightColor(light.color) / attenuation, 1.0);
  }

  // Cracks see less of the sky, and ground and sky light the rest.
  float occlusion = vWood.x * mix(0.7, 1.0, height);
  float below = 0.5 - 0.5 * dot(normal, up);
  // Leaves pass on green to what is among them, and a soil plate or a root in the open is not.
  vec3 ambient = treeHemisphere(normal, up) * openSky + treeCrownBounce(vCrown) * (1.0 - openSky) * 0.62 +
    sunBounce * vec3(0.17, 0.14, 0.1) * below * below;
  // Dry bark has hardly a sheen, and that only on what stands proud of it.
  float gloss = 0.3 * mix(0.5, 1.0, height);
  vec3 color = base * (ambient * occlusion * material.ambient + gDiffuse * material.diffuse) +
    gSpecular * floatColors_normalize(material.specularColor) * treePhotoreal.barkC.a * gloss;
  if (material.unlit || lighting.enabled == 0) color = base;

  fragColor = vec4(treeFilmic(color), layer.opacity);
#ifndef TREE_WOOD_OPAQUE
  DECKGL_FILTER_COLOR(fragColor, geometry);
#endif
}
`;
}

/** Vertex and fragment shaders for the wood of a level of detail. */
export function getTreeWoodShaders(
  lod: number,
  opaque = false,
  species: TreeAppearanceSpecies = 'citrus'
): {vs: string; fs: string} {
  const palm = species === 'palm';
  return {vs: getTreeWoodVertex(lod, opaque, palm), fs: getTreeWoodFragment(lod, opaque, palm)};
}

/** Blade surface terms shared by the vertex shape and its fine normal reconstruction. */
export function getBladeSurface(species: TreeAppearanceSpecies) {
  if (species === 'palm') return {cup: 0.24, ruffle: 0.001, airWidth: 0.035, fold: 0.55};
  if (species === 'pine') return {cup: 0, ruffle: 0, airWidth: 0.006, fold: -0.48};
  return {cup: 0.85, ruffle: 0.022, airWidth: 0.15, fold: null};
}
/** Of the sky on a blade's other side, how much comes through it. */
const TREE_LEAF_SKY_THROUGH = 0.3;
/** Material specular colors are for a broad Phong lobe, and this highlight is normalized. */
const TREE_LEAF_SPECULAR_SCALE = 1.5;
/**
 * The finer blades' gloss: how bright the tight highlight of the sun is and its broad bloom, and the bloom's exponent
 * of the material's shininess, whose 32nd power is the highlight's. Wax close up is a mirror, and in a low sun a
 * whole leaf can light up with it.
 */
const TREE_LEAF_NEAR_GLOSS = [0.45, 0.07, 0.25] as const;
/** What a leaf's color is close up, of what the coarser blades have it: darker, and greener. */
const TREE_LEAF_NEAR_TOP = [0.5, 0.72, 0.55] as const;
/**
 * Per channel, how much more of its paleness a flip shows where a storm at its strongest holds a blade over, past
 * what it shows in a breeze: more in blue, so a blade held over shows a silver grey underside rather than a yellow
 * one. And how much more of the open sky a blade held over takes, facing it.
 */
const TREE_LEAF_UNDERSIDE_PALE = [1.4, 1.6, 2.8] as const;
const TREE_LEAF_UNDERSIDE_SKY = 1.5;

/**
 * How much of a leaf's flip shows as its paler side, per channel, for the photoreal uniforms' `gust.yzw`: 0.85 in a
 * breeze, and more as a storm holds blades over and shows their undersides, by the force, 0-1, of a wind with a
 * direction, 0 for none.
 */
export function getTreeLeafPaleness(force: number): [number, number, number] {
  const strong = smoothstep01(
    (force - TREE_WIND_STRONG_FROM) / (TREE_WIND_STRONG_TO - TREE_WIND_STRONG_FROM)
  );
  // Sooner than a storm's other terms: as a gale's fronts arrive, the crowns they cross already silver.
  const storm = smoothstep01(strong / 0.45);
  return [
    0.85 * (1 + TREE_LEAF_UNDERSIDE_PALE[0] * storm),
    0.85 * (1 + TREE_LEAF_UNDERSIDE_PALE[1] * storm),
    0.85 * (1 + TREE_LEAF_UNDERSIDE_PALE[2] * storm)
  ];
}

/** GLSL's smoothstep from 0 to 1. */
function smoothstep01(x: number): number {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}
/**
 * Of its flight, when the pass of leaves in the air takes a leaf from the coarse blade, which has it as it leaves its
 * twig, still close to it, and when one that falls in the lee has landed, and the coarse blade takes it back. A tree
 * stripped all at once has most of its leaves gone by the first, as only some of them go on into the air.
 */
const TREE_LEAF_AIR_FROM = 0.06;
const TREE_LEAF_AIR_LANDED = 0.72;
/**
 * What a full crown hides from a camera outside it: leaves this deep, and past this on its far side. So few of
 * these are drawn, each that much larger, as can back the gaps of those in front. Without them a gap shows the
 * sky, and it should show darkness.
 */
const TREE_LEAF_HIDDEN_SHELL = 0.34;
const TREE_LEAF_HIDDEN_FAR = -0.42;
const TREE_LEAF_HIDDEN_SHARE = 1 / 9;
/** And as many of them as this where a leaf is long enough on screen to read as one. */
const TREE_LEAF_HIDDEN_SHARE_NEAR = 1 / 3;
/**
 * A leaf in the air is drawn along where it went over this many seconds of the layer clock. A render that adds up
 * eight moments of a 1/60 s shutter, half a frame at 30 fps, then has them overlap into one blur.
 */
const TREE_LEAF_STREAK_SECONDS = 1 / 240;
/** The shortest a leaf in the air is drawn, in pixels. One shorter is shown for less of the time instead. */
const TREE_LEAF_AIR_LEAST_PIXELS = 1.5;
/**
 * A far tree's leaf at least this many pixels long where it rests starts its flight from where the wind had its
 * twig. A shorter one starts where it rests, which a few pixels from it does not show.
 */
const TREE_LEAF_AIR_WIND_PIXELS = 3;
/** Metres from the lens over which a leaf in the air fades in: one nearer would cross the view in a frame. */
const TREE_LEAF_AIR_NEAR = [0.6, 1.6] as const;
/**
 * Metres from the lens over which the pass of leaves in the air thins them out, from none to all, in the square of a
 * smooth step: a few in ten at 8 m, and all past 12 m.
 */
const TREE_LEAF_AIR_SPARSE = [4, 12] as const;
/**
 * How much more of the sky behind it comes through a leaf alone in the air than through one in a crown. Not of the
 * sun, which a blade passes on alike wherever it is.
 */
const TREE_LEAF_AIR_THROUGH = 2.5;
/**
 * A leaf in the air that is shown for part of the time is shown for one run of each period this long, in seconds of
 * the layer clock, starting where its own seed says. It is a frame at 30 fps, twice a half-frame shutter, so the
 * moments a render adds up into a frame show such a leaf for its share of them in one unbroken stretch, unless it
 * is shown for most of the time, and frames 1/30 s apart show the same leaves.
 */
const TREE_LEAF_AIR_PERIOD = 1 / 30;
/**
 * Near leaves are listed by where they rest, and the wind may have them this much nearer the camera, in metres,
 * half the height of the tree in the strongest wind, up to the most. The macro blade's list reaches this share of
 * that: its corners are many, and a fine blade serves for a leaf going past.
 */
export const TREE_LEAF_BLADE_MARGIN_MOST = 2.0;
export const TREE_LEAF_BLADE_MARGIN_MACRO = 0.3;

function getTreeLeafVertexBlade(blade: TreeLeafBlade, species: TreeAppearanceSpecies): string {
  const along = BLADE_ALONG[blade].map(floatLiteral).join(', ');
  const halves = getBladeHalves(blade, species).map(floatLiteral).join(', ');
  const across = BLADE_ACROSS[blade].map(floatLiteral).join(', ');
  const stations = BLADE_ALONG[blade].length;
  const columns = BLADE_ACROSS[blade].length;
  return /* glsl */ `
const float TREE_BLADE_ALONG[${stations}] = float[${stations}](${along});
const float TREE_BLADE_HALF[${stations}] = float[${stations}](${halves});
const float TREE_BLADE_ACROSS[${columns}] = float[${columns}](${across});
// Distance along the blade, half width (signed, right is negative), and place across it, -1 to 1.
vec3 treeBladeCorner(int corner) {
  if (corner == 0) return vec3(0.0);
  if (corner == ${getTreeLeafCorners(blade) - 1}) return vec3(1.0, 0.0, 0.0);
  int station = (corner - 1) / ${columns};
  float side = TREE_BLADE_ACROSS[corner - 1 - station * ${columns}];
  return vec3(TREE_BLADE_ALONG[station], side * TREE_BLADE_HALF[station], side);
}
`;
}

/** How far a leaf's margin wanders, in blade lengths, in and out of its plane. GLSL shared by both stages. */
const TREE_LEAF_MARGIN = /* glsl */ `
// The margin's slow wave along the blade, -1 to 1, which differs on the two sides of a leaf.
float treeLeafWave(float t, float side, float seed) {
  float phase = fract(seed * 13.17) * 6.2831853 + side * 1.7;
  return 0.62 * sin(t * (10.0 + 5.0 * fract(seed * 29.41)) + phase) +
    0.38 * sin(t * (23.0 + 8.0 * fract(seed * 53.89)) + phase * 2.3);
}
`;

/**
 * Light on a leaf, in linear space. The coarse blade calls this in its vertex stage, with a few pixels to its
 * name and millions of vertices. The fine and macro blades call it in the fragment stage.
 */
function getTreeLeafShading(blade: TreeLeafBlade, air = false): string {
  return /* glsl */ `
// The normal that light sees, eased toward the crown's with distance, the surface's own, and the view.
vec3 gNormal;
vec3 gSurface;
vec3 gView;
vec3 gDiffuse;
vec3 gSpecular;
vec3 gGlow;
float gShininess;
float gWax;

void treeLeafLight(vec3 light, vec3 color, float visibility) {
  float facing = dot(gNormal, light);
  // Wrapped diffuse, soft as light scatters in the blade.
  gDiffuse += color * max((facing + 0.25) / 1.25, 0.0) * visibility;
  float surface = dot(gSurface, light);
  if (surface > 0.0) {
    // A cuticle's mirror: a tight highlight of the sun, in a broad bloom where the wax is not quite smooth.
    vec3 halfway = normalize(light + gView);
    float along = max(dot(gSurface, halfway), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(gView, halfway), 0.0), 5.0);
${
  blade === 'far' || blade === 'coarse'
    ? /* glsl */ `    float broad = pow(along, gShininess * 0.5);
    float tight = broad * broad;
    tight *= tight;
    tight *= tight;
    // Normalized, so the tighter is the brighter.
    gSpecular += color * (0.04 * gShininess * tight + 0.03 * gShininess * broad) * fresnel * gWax * visibility;`
    : /* glsl */ `    // Close up the wax's bloom is wide enough that a low sun from the side lights up a leaf turned a little toward it,
    // around a highlight tight as a mirror's.
    float broad = pow(along, gShininess * ${floatLiteral(TREE_LEAF_NEAR_GLOSS[2])});
    float tight = broad * broad;
    tight *= tight;
    tight *= tight;
    tight *= tight;
    tight *= tight;
    // Normalized, so the tighter is the brighter.
    gSpecular += color * (${floatLiteral(TREE_LEAF_NEAR_GLOSS[0])} * gShininess * tight + ${floatLiteral(TREE_LEAF_NEAR_GLOSS[1])} * gShininess * broad) * fresnel * gWax * visibility;`
}
  }
  // Light through the blade, by how the blade itself faces it, strongest looking toward the light.
  float through = max(-surface, 0.0);
  float toward = pow(max(dot(-gView, light), 0.0), 3.0);
  gGlow += color * through * (0.55 + 1.15 * toward) * visibility;
}

// The color of a leaf. Top is what its upper side is made of, in linear space. Look is its normal's blend toward
// the crown's and its gloss, crown is what treeCrownLight gave it, wax how glossy the surface is,
// and veins how its veins change what comes through it.
vec3 treeLeafShade(
  vec3 top,
  vec3 bladeNormal,
  vec3 position,
  vec3 view,
  vec3 outward,
  vec2 look,
  vec4 crown,
  float wax,
  float veins,
  bool upper,
  float bias
) {
  gView = view;
  gDiffuse = vec3(0.0);
  gSpecular = vec3(0.0);
  gGlow = vec3(0.0);
  vec3 facingNormal = upper ? bladeNormal : -bladeNormal;
  vec3 up = treeUp(position);
  // Far from the camera a crown should shade like a volume, not like noise.
  gNormal = normalize(mix(facingNormal, outward * (dot(outward, view) >= -0.4 ? 1.0 : 0.6), look.x));
  if (dot(gNormal, gNormal) < 0.01) gNormal = facingNormal;
  gSurface = facingNormal;
  gWax = wax * look.y * (upper ? 1.0 : 0.12);
  gShininess = max(material.shininess, 2.0);

  // The underside is paler, matte and less green.
  float pigment = dot(top, vec3(0.3, 0.55, 0.15));
  vec3 under = mix(top, vec3(pigment) * vec3(1.15, 1.2, 0.65) + vec3(0.012, 0.017, 0.005), 0.5);
  vec3 albedo = upper ? top : under;
  // What gets through the blade: yellow-green, from the same pigments.
  vec3 glowColor = pow(max(top, vec3(0.002)), vec3(0.75)) * vec3(0.95, 1.2, 0.34) * veins;

  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    treeLeafLight(
      normalize(-light.direction),
      treeLightColor(light.color),
      treeDirectionalVisibility(i, bias) * treeCrownSun(crown, i)
    );
  }
  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight light = lighting_getPointLight(i);
    vec3 toLight = light.position - position;
    float attenuation = getPointLightAttenuation(light, length(toLight));
    treeLeafLight(normalize(toLight), treeLightColor(light.color) / attenuation, sqrt(crown.y));
  }

  // Sky on the blade, what the leaves around it pass on, and what comes through it from its other side: alone in the
  // air, the open sky behind it, though no more of the sun comes through it than through one in a crown.
  vec3 sky = treeHemisphere(gNormal, up) * crown.y + treeCrownBounce(crown);
  vec3 skyThrough = treeHemisphere(-gNormal, up) * crown.y * ${floatLiteral(TREE_LEAF_SKY_THROUGH * (air ? TREE_LEAF_AIR_THROUGH : 1))};
  // The waxy cuticle mirrors the sky, more and more at a glancing angle: this is what makes citrus look like
  // citrus. Below the horizon it mirrors the ground.
  float cosine = max(dot(facingNormal, view), 0.0);
  float fresnel = 0.012 + 0.4 * pow(1.0 - cosine, 4.0);
  vec3 sheen = treeSkyColor(reflect(-view, facingNormal), up) * fresnel * crown.y * gWax;
  vec3 specular = gSpecular * floatColors_normalize(material.specularColor) * ${floatLiteral(TREE_LEAF_SPECULAR_SCALE)};
  vec3 color = albedo * (sky * material.ambient + gDiffuse * material.diffuse) +
    glowColor * (gGlow * material.diffuse + skyThrough * material.ambient) + specular + sheen;
  if (material.unlit || lighting.enabled == 0) color = albedo;
  return color;
}
`;
}

/**
 * What the wind does to a leaf on its twig: it goes with the wood that carries it, streams, flutters and flips.
 * The coarse blade flutters more simply. Sets flip, and for the finer blades abaxial.
 */
function getTreeLeafRestingWind(coarse: boolean): string {
  return /* glsl */ `    // A leaf goes where the wood that carries it goes.
    vec3 sway = treeLimbSway(outerLimb, innerLimb, base) * (1.0 - swing);
    vec3 windTurn = treeSwayTurn * (1.0 - swing);
    vec3 before = base;
    base = treeWindPoint(base) + sway;
    windTurn += tree.windTurn;
    float turned = length(windTurn);
    if (turned > 1e-4) treeTurnBlade(axisX, axisY, axisZ, windTurn / turned, turned);
    if (tree.windForce > 0.0) {
    float time = treePhotoreal.clock.x;
    float phase = seed * TREE_TWO_PI * 7.0;
    vec2 cells = treeWindCells(before);
    float strong = tree.windBlade.y;
    float gust = 0.55 * tree.windGust + 0.45 * mix(cells.x, cells.y, 0.25 + 0.2 * strong);
    // Flutter: fast small pitch and roll, growing with the wind. Blades flip and show their pale undersides as a
    // gust comes through, spray by spray, so they do it in waves that run across the crown: by the pressure on them.
    float pressure;${coarse ? '' : '\n    float storm = 0.0;'}
    if (strong > 0.0) {
      // A strong wind takes a blade by its petiole and streams it downwind, further in a gust.
      vec3 wind = vec3(tree.windDirection, 0.0);
      vec3 hinge = cross(axisX, wind);
      float hingeLength = length(hinge);
      if (hingeLength > 1e-3) {
        float stream = strong * (0.4 + 0.6 * gust) * (0.6 + 0.4 * hashB);
        treeTurnBlade(axisX, axisY, axisZ, hinge / hingeLength, stream * atan(hingeLength, dot(axisX, wind)));
      }
      // In a storm a crown stays dark in the lulls, and silvers as a front crosses it, in patches where the air is
      // quickest. From about force 0.6 that is all it does, with none of a breeze's flicker left in the lulls.
      ${coarse ? 'float ' : ''}storm = smoothstep(0.0, 0.7, strong);
      float surge = mix(gust, smoothstep(0.35, 1.0, mix(gust, tree.windGust, 0.6)), storm);
      pressure = tree.windBlade.x *
        (mix(0.12, 0.02, storm) + mix(0.55, 0.95, storm) * surge + 0.24 * (fract(float(innerLimb) * 0.37139) - 0.5));
    } else {
      pressure = tree.windBlade.x * (0.12 + 0.55 * gust + 0.24 * (fract(float(innerLimb) * 0.37139) - 0.5));
    }
    float level = clamp(tree.windForce * 16.0, 0.0, 1.0);
    flip = smoothstep(hashA - 0.07, hashA + 0.07, pressure);${coarse ? '' : '\n    abaxial = flip * storm;'}
    float quick = strong > 0.0 ? strong * sin(time * (50.0 + hashC * 28.0) + phase * 1.7) : 0.0;
${
  coarse
    ? /* glsl */ `    float flutter = sin(time * (7.0 + hashA * 6.0) + phase) + quick;
    treeTurnBlade(axisX, axisY, axisZ, axisX, level * 0.3 * flutter + flip * (2.3 + 0.5 * hashB));`
    : /* glsl */ `    float pitch = level * (0.22 * sin(time * (6.0 + hashA * 5.0) + phase) +
      0.07 * sin(time * (15.0 + hashB * 8.0) + phase * 2.3) + 0.2 * quick);
    float roll = level * 0.28 * (sin(time * (8.0 + hashB * 6.0) + phase * 1.3) + quick);
    treeTurnBlade(axisX, axisY, axisZ, axisY, pitch);
    treeTurnBlade(axisX, axisY, axisZ, axisX, roll + flip * (2.3 + 0.5 * hashB));`
}
    }`;
}

// A fixed screen-space pattern lets the shell and leaves keep complementary pixels
// even when their surfaces are at different depths.
export const TREE_SHELL_COVERAGE_GLSL = /* glsl */ `
bool treeShellCoversPixel(vec2 position, float retention) {
  vec2 pixel = floor(position);
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715)))) < retention;
}
`;

export const TREE_SHELL_COVERAGE_WGSL = /* wgsl */ `
fn treeShellCoversPixel(position: vec2<f32>, retention: f32) -> bool {
  let pixel = floor(position);
  return fract(52.9829189 * fract(dot(pixel, vec2<f32>(0.06711056, 0.00583715)))) < retention;
}
`;

function getTreeLeafVertex(
  blade: TreeLeafBlade,
  air = false,
  depth = false,
  listed = false,
  species: TreeAppearanceSpecies = 'citrus',
  shellTransition = false
): string {
  const surface = getBladeSurface(species);
  const needle = species === 'pine';
  // The fine and macro blades keep everything a leaf does close up. Others are a few pixels, and are drawn in
  // the millions, so they bend with the tree and flutter more simply, are lit by the vertex and hand on one
  // color, and most of what makes them comes after what can tell that they are not drawn at all. The pass of
  // leaves in the air goes through the coarse blade's leaves of each tree that is losing them, and draws only
  // those in the air, each as a quad on screen around the way it went in the last moment.
  const coarse = blade === 'far' || blade === 'coarse';
  const corners = air ? TREE_LEAF_AIR_CORNERS : getTreeLeafCorners(blade);
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-leaf-${air ? 'air-' : ''}vs
${TREE_SAMPLER_PRECISION_GLSL}

${coarse && !listed ? 'in float instanceTreeRow;' : 'in vec2 instanceLeafRef;'}

uniform sampler2D treeLeaves;
${shellTransition ? 'flat out float vShellRetention;' : ''}

${
  air
    ? /* glsl */ `// Light on the leaf, in linear space.
out vec3 vColor;
// Where this corner is on screen from the leaf as it is now, in pixels.
out vec2 vAirPixel;
// From pixels about the leaf to its own measure, half its length a unit: the inverse of its half length and half
// length across on screen, as two columns.
flat out vec4 vAirFrame;
// Where the leaf was a moment before, in its own measure from where it is now, how far its outline's two arcs are
// from its midrib, and how much of it shows.
flat out vec4 vAirMotion;
// The arcs' radius, and how far it went on screen, in pixels.
flat out vec2 vAirShape;`
    : coarse
      ? /* glsl */ `// Light on this corner, in linear space.
out vec3 vColor;`
      : /* glsl */ `out vec3 vPosition;
out vec3 vCamera;
out vec3 vOutward;
out vec3 vTop;
// Seed, how dead, and shadow bias in metres.
out vec3 vInfo;
// How much of the sun and the sky the crown lets through: treeCrownLight.
out vec4 vCrown;
// Leaf normal blend and specular scale, continuous across levels of detail.
out vec2 vLook;
// Along the blade, across it in blade lengths, and across it relative to its half width.
out vec3 vBlade;
out vec3 vAxisX;
out vec3 vAxisZ;
// Fold slope, droop, twist.
out vec3 vFold;
`
}

${TREE_PHOTOREAL_VERTEX_CHUNK}
${getTreeShadowVertex(!coarse)}
${
  coarse
    ? /* glsl */ `${TREE_PHOTOREAL_FRAGMENT_CHUNK}
vec2 treeLeafLit = vec2(1.0);
float treeDirectionalVisibility(int index, float biasMetres) {
  return index == 0 ? treeLeafLit.x : index == 1 ? treeLeafLit.y : 1.0;
}
${getTreeLeafShading(blade, air)}`
    : TREE_LEAF_MARGIN
}
${getTreeLeafVertexBlade(blade, species)}

vec4 treeLeafTexel(int leaf, int texel) {
  int index = leaf * ${LEAF_TEXELS} + texel;
  return texelFetch(
    treeLeaves,
    ivec2(index % ${TREE_TEMPLATE_TEXTURE_WIDTH}, index / ${TREE_TEMPLATE_TEXTURE_WIDTH}),
    0
  );
}

vec3 treeQuaternionTurn(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void treeTurnBlade(inout vec3 x, inout vec3 y, inout vec3 z, vec3 axis, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  float k = 1.0 - c;
  x = x * c + cross(axis, x) * s + axis * dot(axis, x) * k;
  y = y * c + cross(axis, y) * s + axis * dot(axis, y) * k;
  z = z * c + cross(axis, z) * s + axis * dot(axis, z) * k;
}

// Where a shed leaf is, flight of the way through its flight from where it rests on its tree. It starts where the
// wind had its twig, windAway from there, and leaves that behind as it goes. It takes the wind's speed by degrees,
// in a plume that widens and thins downwind, tumbling, some lofted first, and goes out of sight far off. Litter is
// what falls in the lee, so it stays close by and comes back from whatever throws it about. All of it follows from
// flight and the wind now, so where a leaf lies does not depend on the wind of later frames. hash is the leaf's
// own four.
vec3 treeLeafFlightPoint(
  vec3 rest,
  vec3 windAway,
  float flight,
  bool litter,
  float flightSeconds,
  float strength,
  vec2 down,
  vec4 hash
) {
  vec3 point = rest + windAway * (1.0 - smoothstep(0.0, 0.4, flight));
  vec2 across = vec2(-down.y, down.x);
  float arc = sin(flight * 3.14159265);
  float wander = sin(flight * (5.0 + hash.z * 9.0) + hash.x * TREE_TWO_PI);
  if (litter) {
    float thrown = (0.15 + 1.3 * strength) * (0.3 + 0.7 * hash.y) * arc;
    float scatter = 0.5 + 0.25 * max(tree.liveHeight, 1.0);
    point.xy += down * thrown + across * thrown * (wander * 0.5 + hash.z - 0.5) +
      vec2(cos(hash.y * TREE_TWO_PI), sin(hash.y * TREE_TWO_PI)) * scatter * hash.z * smoothstep(0.0, 1.0, flight);
    point.z = mix(point.z, TREE_GROUND * (1.0 + hash.z * 4.0), treeFallCurve(flight));
  } else {
    float carry = (2.5 + 34.0 * strength) * flightSeconds * pow(flight, 1.6) * (0.4 + 0.6 * hash.y);
    point.xy += down * carry + across * (carry * 0.42 * (hash.z - 0.5) + wander * (0.2 + carry * 0.05) * arc);
    point.z = mix(point.z, TREE_GROUND, pow(flight, 2.2)) + (0.15 + 2.6 * strength) * hash.w * hash.w * arc;
  }
  return point;
}

void main(void) {
  gl_Position = TREE_CULLED;
${
  coarse && !listed
    ? /* glsl */ `  int row = int(instanceTreeRow + 0.5);
  int leaf = gl_VertexID / ${corners};
  int corner = gl_VertexID - leaf * ${corners};`
    : /* glsl */ `  int row = int(instanceLeafRef.x + 0.5);
  int leaf = int(instanceLeafRef.y + 0.5);
  int corner = gl_VertexID;`
}

  // Level of detail: a prefix of the leaves, with those near its end shrinking away, so the same
  // leaves at the same size show on both sides of a change of bucket. Most vertices of a far tree stop
  // here, so this comes first.
  vec4 detail = treeStateTexel(row, ${DETAIL});
  float leafDetail = detail.x;
  float count = treePhotoreal.shape.z * leafDetail;
  float index = float(leaf);
  if (index >= count) return;

  vec4 timing = treeLeafTexel(leaf, 2);
  float seed = timing.z;
  vec4 life = treeStateTexel(row, ${LIFE});
#ifdef TREE_MATURE_ATTACHED_LEAVES
  const float g = 1.0;
#else
  float g = life.x;
#endif
  float age = g - timing.x;
  if (age <= 0.0 || g > timing.y + 0.004) return;
${
  air
    ? /* glsl */ `  // A leaf on its twig is the coarse blade's, and this pass has only the leaves in the air to draw.
  if (seed <= life.z * 1.02) return;`
    : ''
}

#ifdef TREE_MATURE_ATTACHED_LEAVES
  treeSetLife(vec4(g, life.y, 1.0, life.w), vec4(0.0), treeStateTexel(row, ${MISC}), detail);
#else
  treeSetLife(life, treeStateTexel(row, ${POSE}), treeStateTexel(row, ${MISC}), detail);
#endif
  if (tree.coverage <= 0.0 || tree.decay >= 1.0) return;
  if (fract(seed * 61.73 + tree.seed) >= tree.coverage) return;
  float shell = timing.w;
${
  coarse && !air
    ? /* glsl */ `
  // A tree in full leaf hides what lies deep in its crown, and on its far side, from a camera outside it, and
  // near half its vertices have nothing to show. Light still sees them. They go smoothly with foliage.
  float closed = tree.lean <= 0.0 && tree.damage <= 0.0 && tree.decay <= 0.0
    ? smoothstep(0.82, 0.97, tree.foliage) * smoothstep(0.5, 0.7, g) * (1.0 - smoothstep(0.12, 0.3, tree.windFlex))
    : 0.0;
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) closed = 0.0;
#endif
  // Which of them stand for the others, and how much larger they grow for that.
  float hiddenThin = fract(seed * 127.31);
  float hiddenScale = 1.0;
  // A tree short of full detail has a camera far enough off to say so before anything else is read.
  if (leafDetail < 1.0 && shell < ${floatLiteral(TREE_LEAF_HIDDEN_SHELL)} * closed) {
    if (hiddenThin >= mix(1.0, ${floatLiteral(TREE_LEAF_HIDDEN_SHARE_NEAR)}, closed)) return;
  }`
    : ''
}

  float presenceTail = count * 0.25 * clamp((1.0 - leafDetail) * 10.0 + treePhotoreal.look.w, 0.0, 1.0);
#ifdef MODULE_SHADOW
  // Grow the last caster in from zero as its prefix changes with camera distance and LOD.
  if (shadow.drawShadowMap) presenceTail = max(presenceTail, 1.0);
#endif
  float presence = presenceTail > 0.0 ? 1.0 - smoothstep(count - presenceTail, count, index) : 1.0;

  // Foliage: attached while seed < foliage. Past that, a leaf flies; some stay as litter.
  float leafFoliage = tree.foliage * 1.02;
  float passed = seed - leafFoliage;
  float settled = 1.0 - smoothstep(0.0, 0.02, tree.foliageRate);
#ifdef TREE_MATURE_ATTACHED_LEAVES
  const float flight = 0.0;
  const bool litter = false;
  const float flightSeconds = 0.0;
  presence *= mix(1.0, smoothstep(0.0, 0.02, -passed), settled);
#else
  float flight = 0.0;
  bool litter = false;
  float flightSeconds = 1.2 + 1.3 * fract(seed * 83.31);
  if (passed > 0.0) {
    flight = treeEventProgress(passed, tree.foliageRate, flightSeconds);
    litter = fract(seed * 97.13) < 0.18;
    if (flight >= 1.0 && !litter) return;
${
  air
    ? /* glsl */ `    if (flight < ${floatLiteral(TREE_LEAF_AIR_FROM)} || flight >= 1.0 || (litter && flight >= ${floatLiteral(TREE_LEAF_AIR_LANDED)})) return;`
    : blade === 'coarse'
      ? /* glsl */ `    // A leaf well on its way through the air is drawn by the pass of its own, which blends. This one has it as it
    // leaves its twig, and takes it back once it has landed.
    if (flight >= ${floatLiteral(TREE_LEAF_AIR_FROM)} && (!litter || flight < ${floatLiteral(TREE_LEAF_AIR_LANDED)})) return;`
      : ''
}
    if (litter) {
      presence *= mix(1.0, smoothstep(0.0, 0.02, passed), settled);
      presence *= 1.0 - smoothstep(0.02, 0.45, tree.decay);
#ifdef MODULE_SHADOW
      // What lies on the ground casts nothing that a map could draw.
      if (shadow.drawShadowMap && flight >= 1.0) return;
#endif
    } else {
      // A tree stripped all at once would be hidden in a cloud of its own leaves, so as many go on into the air as
      // the eye can follow, and the others are gone as they leave the twig.
      float share = 0.07 / max(tree.foliageRate * flightSeconds, 0.07);
      presence *= max(1.0 - smoothstep(share * 0.9, share, fract(seed * 47.71)), 1.0 - smoothstep(0.0, 0.06, flight));
    }
  } else {
    presence *= mix(1.0, smoothstep(0.0, 0.02, -passed), settled);
  }
#endif
  float rotHash = fract(seed * 37.71);
  presence *= 1.0 - smoothstep(rotHash * 0.4, rotHash * 0.4 + 0.25, tree.decay);
  float dying = timing.y <= 1.0 ? 1.0 - smoothstep(timing.y, timing.y + 0.004, g) : 1.0;
  // A leaf scales in and unfolds soon after its birth, and has done so by maturity however late it came.
  float span = min(1.0 - timing.x, 0.012);
  float grown = smoothstep(0.0, span, age);
  presence *= grown * dying;
  if (presence <= 0.0) return;

  treeLoadPlace(row);
  vec4 head = treeLeafTexel(leaf, 0);
  vec3 base = treeTurnYaw(treeToMetres(head.xyz));
  vec3 rest = base;
  geometry.worldPosition = tree.anchor;
  vec3 anchorCommon = project_position(tree.anchor, tree.anchorLow);
  tree.frame = splatTangentFrame(anchorCommon);
  float crownNow = g >= 1.0 ? tree.size.x : tree.size.x * (1.0 - pow(1.0 - g, 1.9));
${
  blade === 'far'
    ? /* glsl */ `  if (flight > 0.0 && !litter && treePhotoreal.leafBlades.z > 0.0) {
    // Most leaves in the air of a far tree are far under a pixel, and shown for so little of the time that it is
    // cheaper to know that first than to work out where they are: from the nearest its flight could bring it and
    // the most of it there is, which is more than it can be shown for.
    vec3 toTree = (project.cameraPosition - anchorCommon) * tree.frame / project_size(1.0) - base;
    float strengthNow = tree.windFlex;
    float reach = (3.0 + 40.0 * strengthNow) * flightSeconds * pow(flight, 1.6) + 3.0 + 3.0 * strengthNow +
      (min(tree.lean, 1.6) + 0.35) * tree.liveHeight;
    float nearest = max(length(toTree) - reach, ${floatLiteral(TREE_LEAF_AIR_NEAR[0])});
    float own = head.w * tree.leafScale;
    float standsFor = max(1.0, min(sqrt(treePhotoreal.shape.y / max(count, 1.0)), 0.6 * crownNow / max(own, 1e-4)));
    float most = own * presence * mix(standsFor, 1.0, smoothstep(0.0, 0.12, flight));
    float drawnMost = max(most, ${floatLiteral(TREE_LEAF_AIR_LEAST_PIXELS)} * nearest / treePhotoreal.leafBlades.z);
    float shownMost = most / max(drawnMost, 1e-12);
    if (fract(fract(seed * 113.71) + treePhotoreal.clock.x * ${floatLiteral(1 / TREE_LEAF_AIR_PERIOD)}) >= shownMost * shownMost) return;
  }
`
    : ''
}  // A tree at full detail is near enough to reach out of the view, or a leaf on a list to be behind the camera.
  if (leafDetail >= 1.0 && flight <= 0.0 && tree.damage <= 0.0 && tree.decay <= 0.0 &&
    tree.lean < 0.5 && tree.growth >= 0.012
#ifdef MODULE_SHADOW
    && !shadow.drawShadowMap
#endif
  ) {
    vec4 place = project_common_position_to_clipspace(vec4(anchorCommon + tree.frame * project_size(treeLeanPoint(rest)), 1.0));
    mat4 view = project.viewProjectionMatrix;
    // Where it rests may be out of view and where the wind has it may not be.
    float slack = (head.w * tree.leafScale * 1.5 + tree.windFlex * tree.liveHeight) * project_size(1.0);
    float slackX = slack * length(vec3(view[0].x, view[1].x, view[2].x));
    float slackY = slack * length(vec3(view[0].y, view[1].y, view[2].y));
    // An offset also changes the width and height of the clip volume through W. In OrbitView,
    // the W row is scaled by zoom and can be much larger than one in a close view.
    float slackW = slack * length(vec3(view[0].w, view[1].w, view[2].w));
    float widest = abs(place.w) + slackW;
    if (abs(place.x) > widest + slackX || abs(place.y) > widest + slackY || place.w < -slackW) return;
  }
${
  coarse && !air
    ? /* glsl */ `  // How far a hidden leaf has been moved in, which no blade is to take for how near it is.
  vec3 bladeShift = vec3(0.0);
  // How much larger a leaf has grown to stand for those it replaces at this level.
  float lodGrowth = max(1.0, sqrt(treePhotoreal.shape.y / max(count, 1.0)));
  if (closed > 0.0) {
    // How many crowns away the camera is: right against one, you can see in.
    vec3 toCamera = (project.cameraPosition - anchorCommon) * tree.frame;
    float cameraDistance = length(toCamera);
    closed *= smoothstep(1.4, 2.0, cameraDistance / max(project_size(crownNow), 1e-6));
    float natural0 = head.w * tree.leafScale * lodGrowth;
    // Where a leaf is large enough to read as one, much larger ones would show in the gaps.
    float hiddenShare = mix(
      ${floatLiteral(TREE_LEAF_HIDDEN_SHARE)},
      ${floatLiteral(TREE_LEAF_HIDDEN_SHARE_NEAR)},
      smoothstep(9.0, 15.0, natural0 * treePhotoreal.leafBlades.z * project_size(1.0) / max(cameraDistance, 1e-6))
    );
    vec3 fromMiddle = normalize(base - vec3(0.0, 0.0, tree.liveHeight * 0.45));
    if (shell < ${floatLiteral(TREE_LEAF_HIDDEN_SHELL)} * closed ||
      dot(fromMiddle, toCamera) < mix(-1.0, ${floatLiteral(TREE_LEAF_HIDDEN_FAR)}, closed) * cameraDistance) {
      float keep = mix(1.0, hiddenShare, closed);
      if (hiddenThin >= keep) return;
      // Inward by as much as it has grown, or the larger blade would stand out against the sky behind. Low on a
      // crown that would not be enough, as what is inward there is not upward, and it would hang below the skirt.
      hiddenScale = mix(1.0, 1.0 / sqrt(keep), smoothstep(0.12, 0.34, base.z / tree.liveHeight));
      bladeShift = fromMiddle * natural0 * hiddenScale * 1.2;
      base -= bladeShift;
    }
  }`
    : ''
}
  vec4 canopy = treeStateTexel(row, ${CANOPY});
  if (fract(seed * 71.37 + tree.seed) >= canopy.a) return;
  vec4 quaternion = treeLeafTexel(leaf, 1);
  vec4 tail = treeLeafTexel(leaf, 3);

  // Fewer leaves grow to keep the coverage, but never larger than the crown they sit in.
  float natural = head.w * tree.leafScale;
  float lodScale = max(1.0, min(sqrt(treePhotoreal.shape.y / max(count, 1.0))${coarse && !air ? ' * hiddenScale' : ''}, 0.6 * crownNow / max(natural, 1e-4)));
  float bladeLength = natural * lodScale * presence;

  vec3 axisX = treeTurnYaw(treeQuaternionTurn(quaternion, vec3(1.0, 0.0, 0.0)));
  vec3 axisZ = treeTurnYaw(treeQuaternionTurn(quaternion, vec3(0.0, 0.0, 1.0)));
  vec3 axisY = cross(axisZ, axisX);
  if (g < 0.012) {
    // The first leaves stay on the hook of a new shoot as it lifts.
    mat3 hook = treeGerminationBend(base);
    axisX = hook * axisX;
    axisY = hook * axisY;
    axisZ = hook * axisZ;
  }
  vec3 outward = base - vec3(0.0, 0.0, tree.liveHeight * 0.55);

  int outerLimb = int(tail.x + 0.5);
  int innerLimb = int(tail.y + 0.5);
  float swing = 0.0;
  if (tree.damage > 0.0) {
    mat3 turn = mat3(1.0);
    swing = treeApplyBreaks(outerLimb, innerLimb, base, turn);
    axisX = turn * axisX;
    axisY = turn * axisY;
    axisZ = turn * axisZ;
    outward = turn * outward;
  }

  base = treeLeanPoint(base);
  axisX = treeLeanTurn(axisX);
  axisY = treeLeanTurn(axisY);
  axisZ = treeLeanTurn(axisZ);
  outward = treeLeanTurn(outward);

  treeWindLoad();
  float hashA = fract(seed * 13.17);
  float hashB = fract(seed * 29.41);
  float hashC = fract(seed * 53.89);
  float flip = 0.0;
${
  coarse
    ? ''
    : `
  // How far a storm has turned a blade over and holds it there, which shows its underside from anywhere.
  float abaxial = 0.0;`
}
${
  air
    ? ''
    : /* glsl */ `  if ((tree.windForce > 0.0 || tree.groundDetail > 0.0) && flight <= 0.0) {
${getTreeLeafRestingWind(coarse)}
  }`
}

  // How far a leaf has come to lie on the ground, dried and curled.
  float lying = litter ? smoothstep(0.72, 1.0, flight) : 0.0;
${
  air
    ? /* glsl */ `  // How far a leaf in the air went in the last moment, which it is drawn along.
  vec3 streak = vec3(0.0);`
    : ''
}
  if (flight > 0.0) {
    float strengthNow = tree.windFlex;
    vec2 down = treePhotoreal.wind.w > 0.5
      ? treePhotoreal.wind.yz
      : vec2(cos(hashA * TREE_TWO_PI), sin(hashA * TREE_TWO_PI));
    float hashD = fract(seed * 71.93);
    vec4 hashes = vec4(hashA, hashB, hashC, hashD);
    vec3 start = base;
    // Where the wind had its twig, which it leaves behind early in its flight.${
      blade === 'far'
        ? /* glsl */ ` A far tree's leaf a few pixels long or less where it
    // rests starts there instead: where the wind had it hardly shows, and working that out costs more than all the
    // rest of its flight, for every leaf a far crown sheds at once.
    float restPixels = bladeLength * treePhotoreal.leafBlades.z /
      max(length((project.cameraPosition - anchorCommon) * tree.frame / project_size(1.0) - start), 1e-3);`
        : ''
    }
    vec3 windAway = flight < 0.4 && (tree.windForce > 0.0 || tree.groundDetail > 0.0)${
      blade === 'far' ? ` && restPixels >= ${floatLiteral(TREE_LEAF_AIR_WIND_PIXELS)}` : ''
    }
      ? treeWindPoint(start) + treeLimbSway(outerLimb, innerLimb, start) * (1.0 - swing) - start
      : vec3(0.0);
    base = treeLeafFlightPoint(start, windAway, flight, litter, flightSeconds, strengthNow, down, hashes);
${
  air
    ? /* glsl */ `    // Where it was a moment before, on the layer clock: its flight goes on at the rate its tree loses leaves. It goes
    // no faster than the air that carries it, so that is as far as it can have gone.
    float earlier = treeEventProgress(
      passed - ${floatLiteral(1.02 * TREE_LEAF_STREAK_SECONDS)} * tree.foliageRate,
      tree.foliageRate,
      flightSeconds
    );
    streak = base - treeLeafFlightPoint(start, windAway, earlier, litter, flightSeconds, strengthNow, down, hashes);
    float streakLength = length(streak);
    float farthest = (2.0 + 70.0 * strengthNow) * ${floatLiteral(TREE_LEAF_STREAK_SECONDS)};
    if (streakLength > farthest) streak *= farthest / streakLength;`
    : ''
}
    float lands = smoothstep(0.0, 1.0, flight);
    float yaw = hashC * TREE_TWO_PI;
    vec3 flatX = vec3(cos(yaw), sin(yaw), 0.0);
    vec3 faceUp = vec3(0.0, 0.0, hashB < 0.72 ? 1.0 : -1.0);
    axisX = normalize(mix(axisX, flatX, lands));
    axisZ = normalize(mix(axisZ, faceUp, lands) + vec3(1e-3, 0.0, 0.0));
    // Whole turns, and always the same way, so it comes down as it was going to.
    vec3 tumbleAxis = normalize(vec3(hashA - 0.5, hashB - 0.5, hashC - 0.3));
    float spin = TREE_TWO_PI * (2.0 + floor(hashC * 3.0)) * (2.0 - flight) * flight * (hashA < 0.5 ? -1.0 : 1.0);
    treeTurnBlade(axisX, axisY, axisZ, tumbleAxis, spin);
    axisZ = normalize(axisZ - axisX * dot(axisX, axisZ));
    axisY = cross(axisZ, axisX);
    // In the air a leaf is the size it is, however far off: a far tree's leaf stands for others in its crown, and
    // alone in the air it would be a fleck of confetti larger than life.
    bladeLength *= mix(1.0, 1.0 / lodScale, smoothstep(0.0, 0.12, flight) * (1.0 - lying));
    if (litter) {
      // No two lie alike, and some lean on an edge or dig in a tip. Smaller than it grew, and a far one stands for
      // less on the ground than in a crown.
      treeTurnBlade(axisX, axisY, axisZ, axisX, (hashA - 0.5) * 1.2 * lying);
      treeTurnBlade(axisX, axisY, axisZ, axisY, (hashD - 0.5) * 0.6 * lying);
      bladeLength = mix(bladeLength, natural * min(lodScale, 2.0) * (0.6 + 0.3 * hashA) * presence, lying);
      outward = mix(outward, vec3(0.0, 0.0, length(outward)), lying);
    } else {
      bladeLength *= 1.0 - smoothstep(0.86, 1.0, flight);
    }${
      blade === 'far'
        ? /* glsl */ `
    if (lying < 1.0) {
      // A leaf in the air is the size it is, at least a pixel and a half long, so it covers more of the view than
      // it is. It is shown for as much of the clock as gives back what it does cover, none at all within a metre or
      // so of the lens, in a run of each period its own. It is never discarded by the pixel, as no leaf is, for the
      // depth test runs before a leaf is shaded.
      vec3 toEye = (project.cameraPosition - anchorCommon) * tree.frame / project_size(1.0) - base;
      float eyeDistance = max(length(toEye), 1e-6);
      float pixelsPerMetre = treePhotoreal.leafBlades.z / eyeDistance;
      float drawn = max(bladeLength, pixelsPerMetre > 0.0 ? ${floatLiteral(TREE_LEAF_AIR_LEAST_PIXELS)} / pixelsPerMetre : 0.0);
      float shown = bladeLength / max(drawn, 1e-12);
      shown *= shown * smoothstep(${floatLiteral(TREE_LEAF_AIR_NEAR[0])}, ${floatLiteral(TREE_LEAF_AIR_NEAR[1])}, eyeDistance);
      shown = mix(1.0, shown, 1.0 - lying);
      if (fract(fract(seed * 113.71) + treePhotoreal.clock.x * ${floatLiteral(1 / TREE_LEAF_AIR_PERIOD)}) >= shown) return;
      bladeLength = mix(bladeLength, drawn, 1.0 - lying);
    }`
        : ''
    }
  }

  // A leaf in the air has left its crown.
  base = flight > 0.0 ? treeRotPoint(base) : treeDecayPoint(base);

  // A leaf large enough on screen for what this blade lacks to show takes a finer one. All of them decide alike,
  // on a list of those near the camera, so each is drawn by one. A tree short of its full detail has no such list.
  // The lists go by where a leaf rests on the tree as it leans, and where a leaf lying on the ground lies, and reach
  // as far again as the wind may take one toward the camera: closer than that it takes the blade of that distance.
  // Measured as if each leaf were on the axis of the view, so that turning the camera changes nothing.
  float finePixels = treePhotoreal.leafBlades.x;
  bool lyingListed = lying >= 1.0 && tree.lean <= 0.0;${
    coarse
      ? ''
      : `
  // How far past the finer blades' start a leaf is on screen, 0 to 1, where its own color shows.
  float nearness = 0.0;`
  }
  if (${air ? 'false && ' : ''}leafDetail >= 1.0 && finePixels > 0.0 && (flight <= 0.0 || lyingListed)
#ifdef MODULE_SHADOW
    && !shadow.drawShadowMap
#endif
  ) {
    float metre = project_size(1.0);
    float pixelsAtMetre = natural * treePhotoreal.leafBlades.z * metre;
    float nowDistance = length(project.cameraPosition - (anchorCommon + tree.frame * project_size(base${coarse && !air ? ' + bladeShift' : ''})));
    float restDistance = lyingListed
      ? nowDistance
      : length(project.cameraPosition - (anchorCommon + tree.frame * project_size(treeLeanPoint(rest))));
    float reachOver = min(tree.windFlex * tree.liveHeight * 0.5, ${floatLiteral(TREE_LEAF_BLADE_MARGIN_MOST)}) * metre;
    float fineDistance = max(nowDistance, restDistance - reachOver);
${
  coarse
    ? /* glsl */ `    if (pixelsAtMetre >= finePixels * fineDistance) return;
    // One that the wind has brought far nearer than that would be a polygon across the view.
    bladeLength *= min(1.0, 2.2 * finePixels * nowDistance / max(pixelsAtMetre, 1e-9));`
    : blade === 'fine'
      ? /* glsl */ `    if (pixelsAtMetre < finePixels * fineDistance) return;
    if (pixelsAtMetre >= treePhotoreal.leafBlades.y * max(nowDistance, restDistance - reachOver * ${floatLiteral(TREE_LEAF_BLADE_MARGIN_MACRO)})) return;`
      : /* glsl */ `    if (pixelsAtMetre < treePhotoreal.leafBlades.y * max(nowDistance, restDistance - reachOver * ${floatLiteral(TREE_LEAF_BLADE_MARGIN_MACRO)})) return;`
}${
  coarse
    ? ''
    : `
    nearness = smoothstep(1.0, 3.0, pixelsAtMetre / max(finePixels * nowDistance, 1e-9));`
}
  }${coarse ? '' : ' else return;'}

${
  air
    ? /* glsl */ `  // In the air a blade has opened flat, and what shows of it is its outline, which the fragment stage draws: a quad on
  // screen around where it went in the last moment, all of it at the leaf's own depth. Pixel by pixel, that works out
  // for how much of the moment the leaf covers it, so the moments a render adds up into a frame join into one soft
  // streak, as a camera's shutter has it, and a leaf that hardly moves is its own sharp shape.
  float healthHash = 0.08 + 0.86 * fract(seed * 43.11);
  float brown = smoothstep(healthHash - 0.06, healthHash + 0.06, 1.0 - tree.health);
  float widthRatio = clamp(tail.w * (1.0 - 0.42 * brown), ${floatLiteral(surface.airWidth)}, 0.9);
  // The size it is, from what it had grown to stand for others' when it let go, and how much of it is there.
  float airLength = natural * mix(lodScale, 1.0, smoothstep(0.0, 0.12, flight));
  float shows = presence * (litter ? 1.0 : 1.0 - smoothstep(0.86, 1.0, flight));
  vec3 point = base + axisX * (0.5 * airLength);
  vec4 commonPosition;
  vec4 now = splatProjectOffset(anchorCommon, tree.frame, project_size(point), commonPosition);
  geometry.position = commonPosition;
  vec4 elsewhere;
  vec4 before = splatProjectOffset(anchorCommon, tree.frame, project_size(point - streak), elsewhere);
  vec4 tip = splatProjectOffset(anchorCommon, tree.frame, project_size(point + axisX * (0.5 * airLength)), elsewhere);
  vec4 side = splatProjectOffset(
    anchorCommon,
    tree.frame,
    project_size(point + axisY * (0.5 * widthRatio * airLength)),
    elsewhere
  );
  // One nearer the lens than this would cross the view in a frame. Near it, a leaf in the air is one large blur
  // among many across the view, so fewer fly there the nearer they are: each fades out where its own share ends.
  float eyeDistance = length(project.cameraPosition - commonPosition.xyz) / max(project_size(1.0), 1e-9);
  shows *= smoothstep(${floatLiteral(TREE_LEAF_AIR_NEAR[0])}, ${floatLiteral(TREE_LEAF_AIR_NEAR[1])}, eyeDistance);
  float sparse = smoothstep(${floatLiteral(TREE_LEAF_AIR_SPARSE[0])}, ${floatLiteral(TREE_LEAF_AIR_SPARSE[1])}, eyeDistance);
  shows *= smoothstep(0.0, 0.12, sparse * sparse * 1.12 - fract(seed * 59.93));
  if (shows <= 0.0 || now.w <= 1e-6 || tip.w <= 1e-6 || side.w <= 1e-6) return;
  // Out of the view, or beside the camera, where a leaf would be drawn across all of it.
  if (abs(now.x) > now.w * 1.5 || abs(now.y) > now.w * 1.5) return;
  vec2 halfView = project.viewportSize * 0.5;
  vec2 middlePixels = now.xy / now.w * halfView;
  vec2 alongPixels = tip.xy / tip.w * halfView - middlePixels;
  vec2 acrossPixels = side.xy / side.w * halfView - middlePixels;
  vec2 motion = before.w > now.w * 0.5 ? middlePixels - before.xy / before.w * halfView : vec2(0.0);
  // No leaf is larger on screen than the view, or goes further across it in the moment.
  float widest = max(halfView.x, halfView.y);
  if (length(alongPixels) > widest || length(acrossPixels) > widest) return;
  float motionLength = length(motion);
  if (motionLength > widest) motion *= widest / motionLength;
  // Shorter than a pixel and a half, it is drawn that long and shows for as much less, and edge on, a pixel wide.
  float lengthPixels = length(alongPixels);
  if (lengthPixels < 0.75) {
    float grow = 0.75 / max(lengthPixels, 1e-4);
    alongPixels *= grow;
    acrossPixels *= grow;
    shows /= grow * grow;
    lengthPixels = 0.75;
  }
  vec2 normalPixels = vec2(-alongPixels.y, alongPixels.x) / lengthPixels;
  float thickness = dot(acrossPixels, normalPixels);
  if (abs(thickness) < 0.5) {
    float wider = (thickness < 0.0 ? -0.5 : 0.5) - thickness;
    acrossPixels += normalPixels * wider;
    shows *= max(abs(thickness), 0.05) * 2.0;
  }
  // The outline in its own measure: two arcs that meet at its base and tip, as wide as it is.
  vec2 lengthwise = acrossPixels / widthRatio;
  mat2 toLeaf = inverse(mat2(alongPixels, lengthwise));
  float arcs = (1.0 - widthRatio * widthRatio) / (2.0 * widthRatio);
  float motionPixels = length(motion);
  vec2 way = motionPixels > 1e-3 ? motion / motionPixels : alongPixels / lengthPixels;
  vec2 aside = vec2(-way.y, way.x);
  float reachAlong = abs(dot(alongPixels, way)) + abs(dot(acrossPixels, way)) + 1.5;
  float reachAside = abs(dot(alongPixels, aside)) + abs(dot(acrossPixels, aside)) + 1.5;
  // Corners 0 and 1 where it was, and 2 and 3 where it is, with 0 and 3 to one side and 1 and 2 to the other.
  float sideOf = corner == 0 || corner == 3 ? -1.0 : 1.0;
  vec2 cornerPixels = (corner >= 2 ? way * reachAlong : -motion - way * reachAlong) + aside * (reachAside * sideOf);
  gl_Position = vec4((middlePixels + cornerPixels) / halfView * now.w, now.z, now.w);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vAirPixel = cornerPixels;
  vAirFrame = vec4(toLeaf[0], toLeaf[1]);
  vAirMotion = vec4(toLeaf * motion, arcs, shows);
  vAirShape = vec2(widthRatio + arcs, motionPixels);${
    depth
      ? /* glsl */ `
  // Its depth needs no color.
  vColor = vec3(0.0);
  return;`
      : ''
  }
`
    : /* glsl */ `  // The blade: folded along its midrib, drooping toward the tip, a little twisted.
  float healthHash = 0.08 + 0.86 * fract(seed * 43.11);
  float brown = smoothstep(healthHash - 0.06, healthHash + 0.06, 1.0 - tree.health);
  float open = smoothstep(0.0, span * 1.6, age);
  vec3 blade = treeBladeCorner(corner);
  float t = blade.x;
  float widthRatio = tail.w * (1.0 - 0.42 * brown) * (1.0 - 0.3 * lying);
  float across = blade.y * widthRatio * 0.5;
  float fold = mix(1.8, ${surface.fold === null ? '0.14 + 0.2 * hashA' : floatLiteral(surface.fold)}, open) + brown * (0.7 + hashB);
  float droop = ${needle ? '(0.025 + 0.055 * hashB) * open + brown * 0.075' : '(0.1 + 0.32 * hashB) * open + brown * 0.3'};
  // In the air a blade has opened flat. On the ground it has dried and curled, with its tip up or dug in.
  fold *= 1.0 - 0.72 * flight;
  droop *= 1.0 - 0.8 * flight;
  fold = mix(fold, 0.2 + 0.8 * hashB, lying);
  droop = mix(droop, (hashC - 0.42) * 0.9, lying);
${
  coarse || needle
    ? /* glsl */ `  float z = abs(across) * fold - droop * t * t;${!coarse ? '\n  float twist = 0.0;' : ''}
  float x = t;
  float y = across;`
    : /* glsl */ `  // Each half arches over from a keel at the midrib to a margin that wanders in and out, and up and down.
  float margin = blade.z * blade.z;
  float wave = treeLeafWave(t, blade.z < 0.0 ? -1.0 : 1.0, seed) * smoothstep(0.1, 0.18, t);
  across *= 1.0 + 0.035 * wave * margin;
  float z = fold * (sqrt(across * across + 3.6e-5) - 0.006) - ${floatLiteral(surface.cup)} * across * across - droop * t * t +
    ${floatLiteral(surface.ruffle)} * wave * margin;
  float twist = (hashC - 0.5) * 0.7 + brown * (hashA - 0.5) * 1.6;
  float x = t * (1.0 - 0.18 * droop * droop * t * t);
  float y = across * cos(twist * t);
  z += across * sin(twist * t);`
}
  vec3 point = base + (axisX * x + axisY * y + axisZ * z) * bladeLength;
  // What lies on the ground lies partly in it.
  point.z = max(point.z, mix(TREE_GROUND, -0.03, lying));

  vec4 commonPosition;
  gl_Position = splatProjectOffset(anchorCommon, tree.frame, project_size(point), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
`
}
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) return;
#endif
  ${shellTransition ? `vShellRetention = treeStateTexel(row, ${CROP_DROPPED}).z;` : ''}
  // Enough to clear the leaf's own caster, which is larger than it in a coarser shadow pass. Read by the pixel
  // a leaf compares against its own plane, and its caster lies in that plane.
  float shadowBias = natural * ${coarse ? '1.2' : '0.2'};
  geometry.pickingColor = ${coarse && !listed ? 'picking_getPickingColorFromInstanceID()' : 'picking_getPickingColorFromIndex(instanceLeafRef.x)'};

  // leafDetail is 4 ^ -(fraction of the way to the next level).
  float lodFraction = clamp(-log(max(leafDetail, 0.01)) * 0.72134752, 0.0, 1.0);
  vec2 look = mix(treePhotoreal.look.xy, treePhotoreal.clock.yz, lodFraction);
  // A leaf that has left its crown is lit as what it is, and flashes as it turns over.
  look.x *= 1.0 - smoothstep(0.0, 0.2, flight);

  // A tint says how a leaf looks in full light. Leaves reflect little, and little blue.
  vec3 tint = pow(canopy.rgb, vec3(2.2));
  float luminance = dot(tint, vec3(0.3, 0.55, 0.15));
  vec3 top = mix(tint, vec3(luminance), 0.45) * vec3(0.82, 0.53, 0.33);
  // Age and exposure run together on a tree: old leaves deep in a crown are dark and blue-green, new ones at
  // its skin lighter and yellower. Leaves on one shoot are much alike, so this reads as patches, not speckle.
  float shoot = fract(float(innerLimb) * 0.61803399);
  float newness = clamp(
    0.74 * smoothstep(0.1, 0.95, shell) + 0.3 * tail.z + 0.34 * (shoot - 0.5) + 0.14 * (hashA - 0.5),
    0.0,
    1.0
  );
  top *= mix(vec3(0.72, 0.74, 0.86), vec3(1.16, 1.12, 0.95), newness);
  // A few old leaves are yellowing, and any leaf does just before it falls. As leaves grow large with
  // distance one of them would be a fleck far brighter than what it stands for.
  float fading = step(hashC, 0.016) * (1.0 - smoothstep(0.35, 0.8, newness));
  float yellow = max(fading, timing.y <= 1.0 ? smoothstep(timing.y - 0.025, timing.y, g) : 0.0);
  yellow *= smoothstep(0.45, 0.95, look.y);
  top = mix(top, vec3(0.2, 0.15, 0.028) * mix(0.8, 1.2, hashB), yellow);
  // A leaf starts pale and matte, and darkens over a season or so.
  vec3 flushColor = vec3(0.17, 0.27, 0.05);
  float young = (1.0 - smoothstep(0.0, 0.024, age)) * smoothstep(1.0, 0.97, g);
  float flushed = tree.flush * smoothstep(0.08, 0.6, tail.z);
  top = mix(top, flushColor, max(young * 0.75, flushed));
  look.y *= 1.0 - 0.75 * max(young * 0.75, flushed);
  // What a flip shows is far paler than any upper side, and paler still where a storm holds it over: its underside,
  // matte and lit by the open sky it faces, which in a storm is far brighter than the light among the leaves. How much
  // of that shows is the layer's, by its wind, so that a leaf carries nothing of it here from its wind.
  top = mix(top, vec3(dot(top, vec3(0.3, 0.55, 0.15))) * vec3(1.9, 2.1, 1.1) + vec3(0.02, 0.026, 0.012), flip * treePhotoreal.leafPaleness);
  top = mix(top, vec3(0.115, 0.066, 0.026) * mix(0.75, 1.25, hashC), brown);
  // On the ground a leaf dries, each at its own pace, and the longer it has lain the more it takes the color of what
  // it is sinking into.
  float dried = lying * mix(0.55, 1.0, hashC);
  top = mix(top, vec3(0.05, 0.032, 0.014) * mix(0.55, 1.6, hashB * hashB), dried);
  top = mix(top, vec3(0.065, 0.05, 0.034) * mix(0.75, 1.1, hashC), lying * clamp(0.15 + 0.5 * hashA + smoothstep(0.02, 0.4, passed), 0.0, 0.8));
  float rotted = smoothstep(0.02, 0.4, tree.decay);
  top = mix(top, vec3(0.075, 0.058, 0.04), rotted);
  float dead = max(max(brown, rotted), dried);

  vec4 crown = treeCrownLight(rest, shell);
  if (flight > 0.0) {
    // Out of its crown, and on the ground under it, where the crown still shades it, and darker where it touches.
    vec4 away = vec4(1.0, 0.8, 1.0, 0.0);
    if (litter && tree.lean <= 0.0) {
      away = treeCrownLight(vec3(base.xy, 0.0), 0.6);
      away.w = 0.0;
    }
    crown = mix(crown, away, flight);
    crown.xyz *= mix(1.0, mix(0.45, 1.0, smoothstep(-0.01, 0.03, point.z)), lying);
  }

  // Extensions filter the color the leaf is made of, and light shades the result.
  vec4 filtered = vec4(top, 1.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
  top = filtered.rgb;
${
  coarse
    ? /* glsl */ `
#ifdef MODULE_SHADOW
  treeLeafLit = treeShadowRead(commonPosition, seed, shadowBias);
#endif
  vec3 bladeNormal = normalize(treeToCommonDirection(${
    air ? 'axisZ' : 'axisZ - axisY * (fold - 0.42) * blade.z + axisX * 2.0 * droop * t'
  }));
  geometry.normal = bladeNormal;
  vec3 view = normalize(project.cameraPosition - commonPosition.xyz);
  vec3 outwardCommon = normalize(treeToCommonDirection(outward));
  vColor = treeLeafShade(
    top,
    bladeNormal,
    commonPosition.xyz,
    view,
    outwardCommon,
    look,
    crown,
    1.0 - 0.8 * dead,
    1.0,
    dot(bladeNormal, view) >= 0.0,
    shadowBias
  );`
    : /* glsl */ `
#ifdef MODULE_SHADOW
  treeShadowWrite(commonPosition, seed, shadowBias);
#endif
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vOutward = treeToCommonDirection(outward);
  vBlade = vec3(t, across, blade.z);
  vAxisX = treeToCommonDirection(axisX);
  vAxisZ = treeToCommonDirection(axisZ);
  vFold = vec3(fold, droop, twist);
  geometry.uv = vBlade.xy;
  geometry.normal = vAxisZ;
  vLook = look;
  vCrown = crown;
  vInfo = vec3(seed, dead, shadowBias);
  // Close up, a leaf is the dark green its glossy top is. From further, what a coarser blade stands for is paler, as
  // it has the sheen and the bright light of many leaves in it, and a leaf goes to that as it gets smaller.
  vTop = top * mix(vec3(1.0), ${'vec3(' + TREE_LEAF_NEAR_TOP.map(floatLiteral).join(', ') + ')'}, nearness);
  // A storm holds the blade over, and what shows is its paler underside, as top has it already: matte, and facing
  // the open sky, which in a storm is far brighter than the light among the leaves. Its frame turns that way. Only
  // the layer's storm does this, so a breeze runs none of it.
  if (treePhotoreal.leafPaleness.z > 0.85) {
    if (abaxial > 0.0) {
      vec3 up = treePhotoreal.clock.w > 0.5 ? normalize(commonPosition.xyz) : vec3(0.0, 0.0, 1.0);
      float side = dot(vAxisZ, project.cameraPosition - commonPosition.xyz) >= 0.0 ? 1.0 : -1.0;
      vAxisZ = side * normalize(mix(side * normalize(vAxisZ), normalize(normalize(vOutward) * 0.6 + up), abaxial));
      vLook.y *= 1.0 - abaxial;
      vCrown.y *= 1.0 + ${floatLiteral(TREE_LEAF_UNDERSIDE_SKY)} * abaxial;
    }
  }`
}
}
`;
}

/**
 * The passes of leaves in the air: of the moment its vertex stage drew a leaf over, for how much a pixel lay inside
 * the leaf's outline, two arcs that meet at its base and tip. Worked out exactly, so a leaf that moves far in that
 * moment is a soft streak, tapered at both ends and to the sides, with as much in it as the leaf covers, and one
 * that hardly moves is its own sharp shape. The pass that blends writes no depth. The one before it writes depth
 * alone, at as many of the pixels as the leaf covers of each, at random, so that what is drawn later at a depth,
 * such as rain in the air beyond a leaf, is behind it for that share of a pixel, and a render that adds up moments
 * into a frame adds that up too.
 */
function getTreeLeafAirFragment(depth: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-leaf-air-${depth ? 'depth-' : ''}fs
${TREE_PRECISION_GLSL}

in vec3 vColor;
in vec2 vAirPixel;
flat in vec4 vAirFrame;
flat in vec4 vAirMotion;
flat in vec2 vAirShape;

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}

// The part of the moment, 0 to 1, that a point q + way * time, in the leaf's own measure, lies inside an arc of the
// outline: the circle about middle of this radius.
vec2 treeAirSpan(vec2 q, vec2 way, vec2 middle, float radius) {
  vec2 offset = q - middle;
  float a = dot(way, way);
  float b = dot(way, offset);
  float c = dot(offset, offset) - radius * radius;
  if (a < 1e-10) return c <= 0.0 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  float discriminant = b * b - a * c;
  if (discriminant <= 0.0) return vec2(1.0, 0.0);
  float root = sqrt(discriminant);
  return vec2(-b - root, -b + root) / a;
}

// How much of the moment the outline covers the point, whose arcs are this far either side of its midrib.
float treeAirCover(vec2 q, vec2 way, float arcs, float radius) {
  vec2 one = treeAirSpan(q, way, vec2(0.0, -arcs), radius);
  vec2 two = treeAirSpan(q, way, vec2(0.0, arcs), radius);
  return max(min(min(one.y, two.y), 1.0) - max(max(one.x, two.x), 0.0), 0.0);
}

void main(void) {
  geometry.uv = vec2(0.0);
  // A leaf in the air is not for picking, and casts nothing.
  if (picking.isActive > 0.5) discard;
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) discard;
#endif
  vec2 q = mat2(vAirFrame.xy, vAirFrame.zw) * vAirPixel;
  vec2 way = vAirMotion.xy;
  float arcs = vAirMotion.z;
  float radius = vAirShape.x;
  // A pixel's worth of the outline, in its own measure, for its edge: from how fast its distance to it changes.
  float outside = max(length(q - vec2(0.0, -arcs)), length(q - vec2(0.0, arcs))) - radius;
  float pixel = max(fwidth(outside), 1e-5);
  float still = clamp(0.5 - outside / pixel, 0.0, 1.0);
  float moving = 0.5 * (
    treeAirCover(q, way, arcs, radius - 0.5 * pixel) + treeAirCover(q, way, arcs, radius + 0.5 * pixel)
  );
  float cover = min(mix(still, moving, smoothstep(0.3, 1.5, vAirShape.y)) * vAirMotion.w, 1.0);
${
  depth
    ? /* glsl */ `  if (treeHash(vec3(gl_FragCoord.xy, fract(treePhotoreal.clock.x * 61.7) * 997.0)) >= cover) discard;
  fragColor = vec4(0.0);`
    : /* glsl */ `  if (cover <= 0.002) discard;
  fragColor = vec4(treeFilmic(vColor), cover * layer.opacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);`
}
}
`;
}

function getTreeLeafFragment(
  blade: TreeLeafBlade,
  species: TreeAppearanceSpecies,
  shellTransition: boolean
): string {
  const surface = getBladeSurface(species);
  const palm = species === 'palm';
  const pine = species === 'pine';
  const shellCoverage = shellTransition
    ? /* glsl */ `flat in float vShellRetention;
${TREE_SHELL_COVERAGE_GLSL}`
    : '';
  const applyShellCoverage = shellTransition
    ? /* glsl */ `
#ifdef MODULE_SHADOW
  if (!shadow.drawShadowMap)
#endif
  {
    if (vShellRetention > 0.0 && treeShellCoversPixel(gl_FragCoord.xy, vShellRetention)) discard;
  }`
    : '';
  if (blade === 'far' || blade === 'coarse') {
    return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-leaf-fs
${TREE_PRECISION_GLSL}

in vec3 vColor;

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${shellCoverage}

void main(void) {
  ${applyShellCoverage}
  geometry.uv = vec2(0.0);
${TREE_LEAF_PICKING_FRAGMENT_GLSL}
${TREE_SHADOW_FRAGMENT_GLSL}
  fragColor = vec4(treeFilmic(vColor), layer.opacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
  }
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-leaf-fs
${TREE_SAMPLER_PRECISION_GLSL}

in vec3 vPosition;
in vec3 vCamera;
in vec3 vOutward;
in vec3 vTop;
in vec3 vInfo;
in vec4 vCrown;
in vec2 vLook;
in vec3 vBlade;
in vec3 vAxisX;
in vec3 vAxisZ;
in vec3 vFold;

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${shellCoverage}
${getTreeShadowFragment(true, 8)}
${getTreeLeafShading(blade)}
${TREE_LEAF_MARGIN}

// Where a side vein leaves the midrib, curving toward the tip: 0 on a vein, 1 between them.
float treeLeafVeinLine(float t, float a, float seed) {
${
  palm
    ? /* glsl */ `  return abs(fract(a * 148.0 + seed * 0.2) - 0.5) * 2.0;`
    : /* glsl */ `  float q = t - a * 1.5 - a * a * 3.5 + seed * 0.07;
  return abs(fract(q * 9.0) - 0.5) * 2.0;`
}
}

// Width of the midrib along the blade, in blade lengths: narrow, and narrower toward the tip.
float treeLeafRibWidth(float t) {
  return mix(0.0066, 0.0014, smoothstep(0.08, 1.0, t));
}

// Relief of the blade, in blade lengths, on its upper side: a keeled midrib, faint side veins, a soft uneven
// quilting between them, and very close the fine surface of a cuticle.
float treeLeafRelief(float t, float y, float seed, float midrib, float veins, float pores) {
  float a = abs(y);
  float width = treeLeafRibWidth(t);
  float rib = exp(-(a * a) / (width * width)) * 0.0022 * midrib;
  float vein = (1.0 - smoothstep(0.0, 0.12, treeLeafVeinLine(t, a, seed))) * 0.00028 * veins;
  float swell = (treeNoise(vec3(t * 9.0, y * 26.0, seed * 17.0)) - 0.5) * 0.0052 * midrib;
  float grain = pores > 0.0
    ? ((treeNoise(vec3(t * 46.0, y * 46.0, seed * 53.0)) - 0.5) * 0.0013 +
      (treeNoise(vec3(t * 130.0, y * 130.0, seed * 71.0)) - 0.5) * 0.00042) * pores
    : 0.0;
  return -rib - vein + swell + grain;
}


void main(void) {
  ${applyShellCoverage}
  geometry.uv = vec2(0.0);
${TREE_LEAF_PICKING_FRAGMENT_GLSL}
${TREE_SHADOW_FRAGMENT_GLSL}

  float seed = vInfo.x;
  float dead = vInfo.y;
  vec3 top = vTop;
  float wax = 1.0 - 0.8 * dead;
  // How its veins change what comes through the blade.
  float throughVeins = 1.0;

  vec3 axisX = normalize(vAxisX);
  vec3 axisZ = normalize(vAxisZ);
  vec3 axisY = cross(axisZ, axisX);
  float t = vBlade.x;
  float y = vBlade.y;
  geometry.uv = vBlade.xy;
  // The blade's own surface: folded at the midrib, arching to a wandering margin, and drooping, with veins
  // and relief that fade with distance. All this is the slope of what the vertex stage built.
  float footprint = fwidth(t);
  float midrib = ${pine ? '0.0' : '1.0 - smoothstep(0.012, 0.05, footprint)'};
  float veins = ${pine ? '0.0' : '1.0 - smoothstep(0.0035, 0.014, footprint)'};
  float pores = ${palm || pine ? '0.0' : '1.0 - smoothstep(0.0012, 0.0045, footprint)'};
  float side = y < 0.0 ? -1.0 : 1.0;
  float slopeAcross = ${pine ? 'sign(y) * vFold.x' : `vFold.x * y / sqrt(y * y + 3.6e-5) - ${floatLiteral(2 * surface.cup)} * y + vFold.z * t`};
  float slopeAlong = -2.0 * vFold.y * t;
  float place = vBlade.z;
  float halfWidth = abs(y) / max(abs(place), 1e-3);
  float wave = treeLeafWave(t, side, seed) * smoothstep(0.1, 0.18, t);
  slopeAcross += ${floatLiteral(2 * surface.ruffle)} * wave * place / max(halfWidth, 0.01);
  vec3 smoothNormal = normalize(axisZ - axisX * slopeAlong - axisY * slopeAcross);
  if (midrib > 0.0) {
    // Slopes over a pixel and a half: the midrib's keel narrows to well under a pixel toward the tip, and a slope read
    // closer than that would flip it from side to side from pixel to pixel.
    float h = max(footprint * 1.5, 0.0008);
    float relief = treeLeafRelief(t, y, seed, midrib, veins, pores);
    slopeAlong += (treeLeafRelief(t + h, y, seed, midrib, veins, pores) - relief) / h;
    slopeAcross += (treeLeafRelief(t, y + h, seed, midrib, veins, pores) - relief) / h;
    float a = abs(y);
    float width = treeLeafRibWidth(t);
    float rib = exp(-(a * a) / (width * width * 1.3));
    float line = treeLeafVeinLine(t, a, seed);
    float secondary = (1.0 - smoothstep(0.0, 0.1, line)) * veins * (1.0 - smoothstep(0.7, 1.0, abs(place)));
    // The midrib is a little paler than the blade, and a side vein is barely there from above.
    vec3 pale = mix(top * 1.34 + vec3(0.012, 0.018, 0.003), top * 1.5, dead);
    top = mix(top, pale, midrib * rib * 0.8 + secondary * 0.1);
    // No blade is one color: slow clouds of it, a little paler toward the margin, and close up a fine mottle.
    float cloud = treeNoise(vec3(t * 7.0, y * 22.0, seed * 91.0));
    float mottle = veins > 0.0 ? treeNoise(vec3(t * 31.0, y * 70.0, seed * 37.0)) : 0.5;
    float shade = (cloud - 0.5) * 0.16 * midrib + (mottle - 0.5) * 0.1 * veins;
    top *= vec3(1.0 + shade * 1.35, 1.0 + shade, 1.0 + shade * 0.6);
    top = mix(top, top * vec3(1.16, 1.1, 1.02), smoothstep(0.82, 1.0, abs(place)) * midrib);
    wax *= 1.0 + (cloud - 0.5) * 0.3 * midrib;
    // In the light, a thick midrib stops more of it, and a side vein with no green in it lets more through,
    // with a fine net between them very close up.
    throughVeins = (1.0 - 0.5 * rib * midrib) * (1.0 + 0.5 * secondary);
    if (pores > 0.0) {
      vec2 cell = vec2(t * 92.0, y * 92.0 + seed * 9.0);
      vec2 net = abs(fract(cell + 0.35 * sin(cell.yx * 0.73)) - 0.5);
      throughVeins *= 1.0 + 0.16 * pores * (1.0 - smoothstep(0.0, 0.1, min(net.x, net.y)));
    }
  }
  vec3 bladeNormal = normalize(axisZ - axisX * slopeAlong - axisY * slopeAcross);
  treeShadowNormal = smoothNormal;
  vec3 color = treeLeafShade(
    top,
    bladeNormal,
    vPosition,
    normalize(vCamera - vPosition),
    normalize(vOutward),
    vLook,
    vCrown,
    wax,
    throughVeins,
    gl_FrontFacing,
    vInfo.z
  );
  fragColor = vec4(treeFilmic(color), layer.opacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
}

/**
 * Vertex and fragment shaders of a blade, or with `air`, of a pass of the coarse blade's leaves that are in the air:
 * `'blend'` draws them, and `'depth'` the depth that goes with that.
 */
export function getTreeLeafShaders(
  blade: TreeLeafBlade,
  air?: 'blend' | 'depth',
  listed = false,
  species: TreeAppearanceSpecies = 'citrus',
  shellTransition = false
): {vs: string; fs: string} {
  return air
    ? {
        vs: getTreeLeafVertex('coarse', true, air === 'depth', false, species),
        fs: getTreeLeafAirFragment(air === 'depth')
      }
    : {
        vs: getTreeLeafVertex(blade, false, false, listed, species, shellTransition),
        fs: getTreeLeafFragment(blade, species, shellTransition)
      };
}

// ---------------------------------------------------------------------------------------------
// Crops
// ---------------------------------------------------------------------------------------------

const CROP_ANCHOR_TEXELS = TREE_CROP_ANCHOR_STRIDE / 4;

/**
 * Sky light on a rind. What has been through the skin comes back warmer than what the surface returns, and
 * without it the shaded side of an orange goes through the tone curve's toe to brick red.
 */
const TREE_CROP_RIND_SHADE = 'vec3(1.2, 1.16, 1.0)';

/** The first mesh level that draws a point for each crop. */
const CROP_DOT_LEVEL = 2;
/**
 * Of a blossom's color, what its petals reflect: white petals, bright in any light, so that a crown in bloom reads
 * speckled white even in a low gold sun.
 */
const TREE_CROP_PETAL_ALBEDO = 0.78;
/**
 * Where blossoms are borne: the crown as an ellipsoid about this share of a tree's height, how far out in it, as a
 * share of its radii, a cluster sits on its skin at most, the share of the tree's height its top is at, as the leaves'
 * highest shoots stand above where they bloom, and the share of that depth by which a cluster may sit deeper.
 */
const TREE_CROP_BLOSSOM_SKIN = [0.5, 0.95, 0.8, 0.16] as const;
/** Metres from the eye within which a blossom hangs on its own twig rather than on the crown's skin, and past which it does not. */
const TREE_CROP_BLOSSOM_NEAR = [1.5, 3.0] as const;
/** The growth from which a tree can bloom, whether its blossoms' twigs have grown or not. */
export const TREE_CROP_BLOOM_FROM = 0.15;
/** The mesh level whose points are lit per vertex: too many, and too small, to shade by the pixel. */
const CROP_LIT_DOT_LEVEL = 3;

/** What a crop's shading needs in both stages, so that a dot and a mesh agree. */
const TREE_CROP_SHADING = /* glsl */ `
// How much of the sun the leaves right around a crop let through. Most hang in the broken light under the outermost
// leaves, and many right out in the sun.
float treeCropSunShare(float among, float hash) {
  return mix(1.0, 0.3 + 0.7 * smoothstep(0.08, 0.42, hash), among);
}

// A rind's color at a place where ripening has got to edge, on a fruit that has got to ripeness. Chlorophyll fades
// everywhere first, through a pale yellow-green, and the orange comes in over that.
vec3 treeRindColor(vec3 unripe, vec3 ripe, float ripeness, float edge) {
  vec3 faded = mix(unripe, mix(unripe, ripe, 0.2) + vec3(0.03, 0.075, 0.006), smoothstep(0.08, 0.6, ripeness));
  vec3 turning = mix(unripe, ripe, 0.42) + vec3(0.04, 0.08, 0.006) * 4.0 * ripeness * (1.0 - ripeness);
  vec3 color = mix(faded, turning, smoothstep(0.14, 0.52, edge));
  return mix(color, ripe, smoothstep(0.42, 0.9, edge));
}`;

/**
 * Everything a crop's vertex stage reads. A crop is the instance `[tree row, crop index, dropped]`, and
 * the last component is 1 for fruit supplied as dropped. Animated values stay in the state row.
 *
 * `treePhotoreal.shape` is the template's `forkZ`, the crop's top and resting height in radii, and crops
 * per twig attachment. `treePhotoreal.look` is the fraction of crops this level of detail draws, how much
 * larger it draws them to keep their coverage, the shadow strength, and the stem length in radii.
 * `treePhotoreal.clock` y and z are the radii on screen, in pixels, that this level of detail draws.
 *
 * With `TREE_CROP_DOT` a crop is a dot the fragment stage shades as the shape it stands for, which at a few
 * pixels across is better than any low-polygon mesh, at a fraction of the cost: with `TREE_CROP_QUAD` a quad,
 * otherwise one point. With `TREE_CROP_LIT` it is also lit once per vertex: most of those in a far crown are
 * behind leaves, and per pixel they would be shaded regardless, as a dot must decide its own shape.
 */
const TREE_CROP_VERTEX_CHUNK = /* glsl */ `
#if !defined(TREE_CROP_DOT) || defined(TREE_CROP_QUAD)
in vec3 cropPosition;
in vec3 cropNormal;
#endif
in vec2 cropPart;
in vec3 instanceCropRef;

uniform sampler2D treeCropAnchors;
uniform sampler2D treeCropRanks;

#ifdef TREE_CROP_LIT
// Display color at the middle of the point, and how it changes toward its right and top.
out vec3 vLit;
out vec3 vLitRight;
out vec3 vLitUp;
// A blossom's middle.
out vec3 vLitCore;
#else
out vec3 vPosition;
// Ripe tint in linear space, and how ripe this crop is.
out vec4 vRipe;
// Unripe tint in linear space, and its seed.
out vec4 vUnripe;
// How much it is among leaves (on the ground, how dark a patch is), part, along the part, shadow bias in metres.
out vec4 vInfo;
// How far it has come to rest on the ground, how far fallen has passed its threshold, and
// where a leaf crosses a dot.
out vec3 vRest;
// How much of the sun and the sky the crown lets through: treeCrownLight.
out vec4 vCrown;
// Out of the crown from it, in common space.
flat out vec3 vAway;
#endif
#ifdef TREE_CROP_DOT
// The screen direction of the crop's axis, and its extent along and across it, in halves of the point.
out vec4 vDot;
// Pixels across the point, and how the fragment stage should shape it.
out vec2 vDotShape;
#ifndef TREE_CROP_LIT
out vec3 vRight;
out vec3 vUp;
out vec3 vToward;
#endif
#else
out vec3 vCamera;
out vec3 vNormal;
// Where on the crop: mesh position in radii.
out vec3 vLocal;
#endif

// Crop count, radius, ripeness, and fallen fraction.
vec4 crop;
// The ripe tint, sRGB with coverage in alpha, and the unripe tint with the fallen rate in alpha.
vec4 cropColor;
vec4 cropUnripe;
bool cropDropped;
// A blossom whose twig is still to grow.
bool cropUnborn = false;
// Twig attachment in template space, limbs, stable seed, how far out in the crown.
vec3 cropTwig;
int cropOuterLimb;
int cropInnerLimb;
float cropSeed;
float cropShell;
float cropMember;
// 0 to 1 as its count arrives and its wood matures.
float cropSwell;
// The tree's base in common space and the tangent frame there. Projecting them is the costliest thing a crop
// does, and most crops only need to know how large they are.
vec3 cropAnchorCommon;
mat3 cropFrame;

// How many of the anchors before this one are born, in the crop order of the template.
float treeCropRank(int anchor, float growth) {
  float level = min(growth, 1.0) * ${floatLiteral(TREE_CROP_RANK_LEVELS - 1)};
  int below = int(level);
  int index = anchor * ${TREE_CROP_RANK_LEVELS} + below;
  float low = texelFetch(
    treeCropRanks,
    ivec2(index % ${TREE_TEMPLATE_TEXTURE_WIDTH}, index / ${TREE_TEMPLATE_TEXTURE_WIDTH}),
    0
  ).r;
  float fraction = level - float(below);
  if (fraction <= 0.0) return low;
  index += 1;
  float high = texelFetch(
    treeCropRanks,
    ivec2(index % ${TREE_TEMPLATE_TEXTURE_WIDTH}, index / ${TREE_TEMPLATE_TEXTURE_WIDTH}),
    0
  ).r;
  return mix(low, high, fraction);
}

vec4 treeCropAnchorTexel(int anchor, int texel) {
  int index = anchor * ${CROP_ANCHOR_TEXELS} + texel;
  return texelFetch(
    treeCropAnchors,
    ivec2(index % ${TREE_TEMPLATE_TEXTURE_WIDTH}, index / ${TREE_TEMPLATE_TEXTURE_WIDTH}),
    0
  );
}

// Clip space w of a point in tree-local metres, before it is projected.
float treeCropClipW(vec3 point) {
  return project_common_position_to_clipspace(vec4(cropAnchorCommon + cropFrame * project_size(point), 1.0)).w;
}

// CSS pixels on screen per metre, at a point with this clip space w.
float treeCropPixelsPerMetre(float w) {
  mat4 view = project.viewProjectionMatrix;
  float focal = length(vec3(view[0].y, view[1].y, view[2].y));
  float pixels = project.viewportSize.y / project.devicePixelRatio;
  return project_size(1.0) * focal * pixels * 0.5 / max(w, 1e-6);
}

// Whether a crop at this point belongs to this level of detail, by the radius of its slot. Every level decides
// alike, so each crop is drawn by exactly one of them, however its instances are shared out.
bool treeCropInLevel(vec3 point) {
#ifdef MODULE_SHADOW
  // Light sees all of them, whatever their size in its map.
  if (shadow.drawShadowMap) return true;
#endif
  float pixels = crop.y * treeCropPixelsPerMetre(treeCropClipW(point));
  return pixels >= treePhotoreal.clock.y && pixels < treePhotoreal.clock.z;
}

// The crop of this instance: false if it is not on the tree. A tree's crops are the first count anchors
// born by its growth, and a crop near the end of them is still swelling. Most instances of a tree are not
// drawn by this level, so this looks at what decides that first.
bool treeCropLoad(int row) {
  cropDropped = instanceCropRef.z > 0.5;
  crop = treeStateTexel(row, ${CROP});
  if (crop.y <= 0.0) return false;
  float total = cropDropped ? treeStateTexel(row, ${CROP_DROPPED}).x : crop.x;
  total *= treePhotoreal.look.x;
  if (total <= 0.0) return false;
  float g = treeStateTexel(row, ${LIFE}).x;
  if (g <= 0.0) return false;
  float index = instanceCropRef.y;
  float cluster = treePhotoreal.shape.w;
  float parent = floor(index / cluster);
  cropMember = index - parent * cluster;
  float rank = index;
  float grown = 1.0;
  if (cropDropped) {
    if (rank >= total) return false;
    grown = smoothstep(0.0, 0.02, g);
  } else {
    int anchor = int(parent + 0.5);
    vec4 head = treeCropAnchorTexel(anchor, 0);
#ifdef TREE_CROP_FLOWER
    // Blossoms come at the tips of the spring's new shoots, on the skin of the crown as it is, so a young tree blooms
    // as fully as an old one: each takes its twig's way out of the crown, born or not, once the tree is old enough.
    float born = min(head.w, ${floatLiteral(TREE_CROP_BLOOM_FROM)});
    cropUnborn = head.w > g;
    float age = g - born;
    if (age <= 0.0) return false;
    rank = treeCropRank(anchor, 1.0) * cluster + cropMember;
#else
    float born = head.w;
    float age = g - born;
    if (age <= 0.0) return false;
    rank = treeCropRank(anchor, g) * cluster + cropMember;
#endif
    if (rank >= total) return false;
    cropTwig = head.xyz;
    grown = smoothstep(0.0, min(1.0 - born, 0.012), age);
  }

  // Where the tree is. What has fallen decides its level of detail by where it is by now.
  vec4 anchor = treeStateTexel(row, ${ANCHOR});
  vec4 low = treeStateTexel(row, ${ANCHOR_LOW});
  tree.anchor = anchor.xyz;
  tree.anchorLow = low.xyz;
  tree.yaw = vec2(cos(anchor.w), sin(anchor.w));
  tree.windPhase = low.w;
  tree.size = treeStateTexel(row, ${SIZE});
  cropAnchorCommon = project_position(tree.anchor, tree.anchorLow);
  cropFrame = splatTangentFrame(cropAnchorCommon);
  tree.frame = cropFrame;
  if (!cropDropped && crop.w <= 0.0 && !treeCropInLevel(treeTurnYaw(treeToMetres(cropTwig)))) {
    return false;
  }

  treeLoadLife(row);
  if (tree.coverage <= 0.0 || tree.decay >= 1.0) return false;
  tree.liveHeight = tree.growth >= 1.0
    ? tree.size.z
    : max(tree.size.z * (1.0 - pow(1.0 - tree.growth, 1.6)), 0.01);
  tree.leanCos = 1.0;
  tree.leanSin = 0.0;
  tree.plateRadius = 0.0;
  if (tree.lean > 0.0) {
    tree.leanCos = cos(tree.lean);
    tree.leanSin = sin(tree.lean);
    tree.plateRadius = TREE_ROOT_PLATE_RADII * tree.trunkRadius * treeRingRadius(1.0, 0.0, tree.growth);
  }
  tree.worldDown = vec3(tree.leanDirection * tree.leanSin, -tree.leanCos);

  if (cropDropped) {
    cropSeed = fract(index * 0.61803399 + tree.seed);
    cropShell = 1.0;
    cropOuterLimb = 0;
    cropInnerLimb = 0;
    cropTwig = vec3(0.0);
  } else {
    vec4 tail = treeCropAnchorTexel(int(parent + 0.5), 1);
    cropOuterLimb = int(tail.x + 0.5);
    cropInnerLimb = int(tail.y + 0.5);
    cropSeed = tail.z;
    cropShell = tail.w;
#ifdef TREE_CROP_FLOWER
    // Out on the skin, in the light, and on no limb of its own that has yet to grow.
    cropShell = 1.0;
    if (cropUnborn) {
      cropOuterLimb = 0;
      cropInnerLimb = 0;
    }
#endif
  }
  if (fract(cropSeed * 61.73 + tree.seed) >= tree.coverage) return false;

  // The last few are still swelling, so a count going up or down never pops, and rest at any size.
  float window = max(1.0, 0.06 * total);
  cropSwell = clamp((total - rank) / window, 0.0, 1.0) * grown;
  float rotHash = fract(cropSeed * 37.71);
  cropSwell *= 1.0 - smoothstep(rotHash * 0.45, rotHash * 0.45 + 0.3, tree.decay);
  return cropSwell > 0.0;
}

// What a crop that is to be drawn also reads: false if its color has it hidden.
bool treeCropLoadColor(int row) {
  cropColor = treeStateTexel(row, ${CROP_COLOR});
  if (fract(cropSeed * 71.37 + tree.seed) >= cropColor.a) return false;
  cropUnripe = treeStateTexel(row, ${CROP_UNRIPE});
  return true;
}

// The twig after everything that moves wood: limb breaks, lean, wind, sway and rot.
vec3 treeCropAttach(vec3 twig, inout mat3 turn) {
  float swing = 0.0;
  if (tree.damage > 0.0) swing = treeApplyBreaks(cropOuterLimb, cropInnerLimb, twig, turn);
  twig = treeLeanPoint(twig);
  if (tree.windStrength > 0.0) {
    vec3 sway = treeLimbSway(cropOuterLimb, cropInnerLimb, twig) * (1.0 - swing);
    twig = treeWindPoint(twig) + sway;
  }
  return treeDecayPoint(twig);
}

// How much larger than life to draw something of this size, to be seen at all. What the eye picks out of a
// far crown is points of color, and a tree carries far more than it can draw: a real one in bloom has
// tens of thousands of blossoms. Continuous, so it never pops. Call after treeProject.
float treeCropVisible(float metres, float pixels, float limit) {
  return clamp(pixels / max(metres * treeCropPixelsPerMetre(gl_Position.w), 1e-6), 1.0, limit);
}

// The same, at a point in tree-local metres, before it is projected.
float treeCropVisibleAt(vec3 point, float metres, float pixels, float limit) {
  return clamp(pixels / max(metres * treeCropPixelsPerMetre(treeCropClipW(point)), 1e-6), 1.0, limit);
}

// Which way the camera is from a point in tree-local metres.
vec3 treeCropToCamera(vec3 point) {
  vec3 toCamera = project.cameraPosition - (cropAnchorCommon + cropFrame * project_size(point));
  return normalize(toCamera * cropFrame);
}

// As treeProject, with the anchor it has already.
vec4 treeCropProject(vec3 point) {
  geometry.worldPosition = tree.anchor;
  vec4 commonPosition;
  gl_Position = splatProjectOffset(cropAnchorCommon, cropFrame, project_size(point), commonPosition);
  geometry.position = commonPosition;
  return commonPosition;
}

// Which way is out of the crown from a twig.
vec3 treeCropAway(vec3 twig) {
  vec3 away = vec3(twig.xy, (twig.z - tree.liveHeight * 0.45) * 0.8);
  float awayLength = length(away);
  return awayLength > 1e-3 ? away / awayLength : vec3(0.0, 0.0, 1.0);
}

// Where a twig would bear a blossom that can be seen: along its way from the crown's middle to the skin of the crown as
// it is now, as near as the crown's shape says, where the new shoots of the spring flush flower.
vec3 treeCropOnSkin(vec3 twig) {
  float crownNow = 1.0 - pow(1.0 - min(tree.growth, 1.0), 1.9);
  vec2 radii = max(tree.size.xy * crownNow, vec2(1e-3));
  float middle = tree.liveHeight * ${floatLiteral(TREE_CROP_BLOSSOM_SKIN[0])};
  vec3 fromMiddle = vec3(twig.xy / radii, (twig.z - middle) / max(tree.liveHeight * ${floatLiteral(TREE_CROP_BLOSSOM_SKIN[2])} - middle, 1e-3));
  float out_ = length(fromMiddle);
  if (out_ <= 1e-3) return twig;
  // Each cluster at its own depth in the outer leaves, some of them half hidden, as the shell is no exact ellipsoid.
  float skin = ${floatLiteral(TREE_CROP_BLOSSOM_SKIN[1])} * (1.0 - ${floatLiteral(TREE_CROP_BLOSSOM_SKIN[3])} * fract(cropSeed * 5.31));
  vec3 onSkin = vec3(0.0, 0.0, middle) + (twig - vec3(0.0, 0.0, middle)) * (skin / out_);
  if (cropUnborn) return onSkin;
  // Close to the eye, among the leaves it looks through, a blossom hangs where its twig is, as the skin of the crown
  // may be all round the eye there.
  vec3 eye = (project.cameraPosition - cropAnchorCommon) * cropFrame / project_size(1.0);
  return mix(onSkin, twig, 1.0 - smoothstep(${floatLiteral(TREE_CROP_BLOSSOM_NEAR[0])}, ${floatLiteral(TREE_CROP_BLOSSOM_NEAR[1])}, length(eye - twig)));
}

// How much of a crop is among the leaves of its own shoot, 0-1, by how full the crown is and what a crop is like.
float treeCropAmong(vec4 crown, float hash, float progress) {
  return crown.w * mix(0.55, 1.0, hash) * (1.0 - smoothstep(0.0, 0.12, progress));
}

${TREE_CROP_SHADING}

// Where a leaf crosses a dot, from its middle, in its radii: 1 or more if none does. Meshes meet real leaves, and
// on a dot of a pixel or two a cut would only take it away.
float treeCropLeafCut(float among, float hash, float radiusPixels) {
  float crossed = among * smoothstep(0.25, 0.75, hash) * smoothstep(2.2, 3.6, radiusPixels) *
    (1.0 - smoothstep(5.0, 10.0, radiusPixels));
  return mix(1.3, mix(0.72, 0.05, fract(hash * 7.31)), crossed);
}

#ifdef TREE_CROP_DOT
// A far leaf stands for several, and is much larger than a real one, and it hides whatever a real leaf would
// have left half in view. So a dot's depth comes toward the viewer by what makes up for that, and it comes out from
// under them where they lie over it. Where it is on screen does not change, so it stays within the crown's shape.
// Near enough for a leaf to be about life size, or for a crop to be a mesh, there is none of this. Nor is there for a
// dot already drawn larger than life by this much, or the color it adds to a crown would grow with distance. Depth
// is all it changes, so light and shadow never see it. Call after treeCropProject.
void treeCropReveal(vec3 commonPosition, float hash, float radiusPixels, float enlarged) {
  float reveal = (0.16 + 0.5 * hash) * (1.0 - smoothstep(4.5, 11.0, radiusPixels)) *
    (1.0 - smoothstep(1.12, 1.6, enlarged));
  if (reveal <= 0.0) return;
  vec3 toCamera = normalize(project.cameraPosition - commonPosition);
  vec4 nearer = project_common_position_to_clipspace(vec4(commonPosition + toCamera * project_size(reveal), 1.0));
  gl_Position.z = nearer.z / nearer.w * gl_Position.w;
}
#endif

// Height above where it comes to rest, a time after letting go: free fall from h, and two soft bounces.
float treeCropDropHeight(float h, float time) {
  const float gravity = 9.81;
  const float restitution = 0.27;
  float fall = sqrt(2.0 * max(h, 0.0) / gravity);
  if (time < fall) return h - 0.5 * gravity * time * time;
  float t = time - fall;
  float speed = gravity * fall * restitution;
  float flight = 2.0 * speed / gravity;
  if (t < flight) return speed * t - 0.5 * gravity * t * t;
  t -= flight;
  speed *= restitution;
  flight = 2.0 * speed / gravity;
  if (t < flight) return speed * t - 0.5 * gravity * t * t;
  return 0.0;
}

// The colors of a crop as they are at either end of ripening, in linear space. Extensions filter what it
// is made of.
vec3 cropRipe;
vec3 cropGreen;
void treeCropTints() {
  vec3 ripe = pow(cropColor.rgb, vec3(2.2));
  vec4 filtered = vec4(ripe, 1.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
  cropRipe = filtered.rgb;
  cropGreen = pow(cropUnripe.rgb, vec3(2.2)) + filtered.rgb - ripe;
}

#ifdef TREE_CROP_DOT
vec3 gDotRight;
vec3 gDotUp;
vec3 gDotToward;
#ifdef TREE_CROP_QUAD
// Corners of a dot too large to be a point, which vanishes whole once its center leaves the view.
out vec2 vDotCorner;
#endif

// A point as large as a crop of this shape: axis in tree-local metres, its half extents along and across
// that axis in radii, and its radius in metres. Call after treeProject.
void treeCropDot(vec3 commonPosition, vec3 axis, float along, float across, float radius, float shape) {
  mat4 view = project.viewProjectionMatrix;
  gDotRight = normalize(vec3(view[0].x, view[1].x, view[2].x));
  gDotUp = normalize(vec3(view[0].y, view[1].y, view[2].y));
  gDotToward = normalize(project.cameraPosition - commonPosition);
  vec3 axisCommon = treeToCommonDirection(axis);
  float facing = dot(axisCommon, gDotToward);
  // What an ellipsoid shows from here is an ellipse.
  float reach = sqrt(along * along * (1.0 - facing * facing) + across * across * facing * facing);
  float size = max(reach, across);
  vec2 screen = vec2(dot(axisCommon, gDotRight), dot(axisCommon, gDotUp));
  float screenLength = length(screen);
  vDot = vec4(screenLength > 1e-3 ? screen / screenLength : vec2(0.0, 1.0), reach / size, across / size);
  // A pixel of margin, for the fragment stage to antialias its edge in.
  float pixels = 2.0 * size * radius * treeCropPixelsPerMetre(gl_Position.w) * project.devicePixelRatio;
#ifdef TREE_CROP_QUAD
  vDotCorner = cropPosition.xy;
  gl_Position.xy += cropPosition.xy * (pixels + 1.0) / project.viewportSize * gl_Position.w;
#else
  gl_PointSize = pixels + 1.0;
#endif
  vDotShape = vec2(pixels, shape);
#ifndef TREE_CROP_LIT
  vRight = gDotRight;
  vUp = gDotUp;
  vToward = gDotToward;
#endif
}
#endif

#ifdef TREE_CROP_LIT
// Light on a point, once per vertex, where hundreds of thousands of them run. Only the surface's direction
// differs between the looks a point takes, so all else is worked out first. The curves here are the shared
// ones with their powers simplified, which hardly shows on what is a few pixels across.
vec3 litAmbient;
vec3 litBounce;
vec3 litColors[2];
vec3 litDirections[2];
vec3 litUp;
vec3 litPoint;
int litCount;
float litPointShare;
// What a thin thing lets through from its far side.
float litThrough = 0.0;

vec3 treeCropLitColor(vec3 color) {
  float level = max(max(color.r, color.g), max(color.b, 1e-4));
  vec3 hue = color / level;
  return hue * hue * level;
}

// What the crown lets through comes from treeCrownLight, and sunShare is how much of the sun leaves right
// around it let through.
void treeCropLitLoad(vec3 point, vec4 crown, float sunShare) {
  litPoint = point;
  litUp = treePhotoreal.clock.w > 0.5 ? normalize(point) : vec3(0.0, 0.0, 1.0);
  vec3 ambient = treeCropLitColor(lighting.ambientColor);
  litAmbient = ambient * crown.y * material.ambient;
  litPointShare = sqrt(crown.y);
  litCount = lighting.enabled == 0 ? 0 : min(lighting.directionalLightCount, 2);
  // What the leaves pass on: treeCrownBounce, with its powers simplified.
  vec3 passedOn = ambient * 0.5;
  for (int i = 0; i < litCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    litDirections[i] = normalize(-light.direction);
    vec3 color = treeCropLitColor(light.color);
    if (i == 0) passedOn += color * (0.3 + 0.7 * sqrt(crown.x));
#ifdef MODULE_SHADOW
    float visibility = i == 0 ? vTreeLit.x : vTreeLit.y;
#else
    float visibility = 1.0;
#endif
    litColors[i] = color * visibility * (i == 0 ? crown.x : crown.z) * sunShare * material.diffuse;
  }
  litBounce = passedOn * vec3(0.05, 0.14, 0.018) * crown.w * material.ambient;
}

// All the light that falls on a surface facing this way.
vec3 treeCropLitShade(vec3 normal, float wrap) {
  float upward = dot(normal, litUp);
  float sky = 0.5 + 0.5 * (litThrough > 0.0 ? abs(upward) : upward);
  vec3 color = litAmbient * mix(vec3(0.44, 0.38, 0.28), vec3(0.94, 1.0, 1.1), sky * sky) + litBounce;
  for (int i = 0; i < litCount; i++) {
    float facing = dot(normal, litDirections[i]);
    color += litColors[i] * (max((facing + wrap) / (1.0 + wrap), 0.0) + litThrough * max(-facing, 0.0));
  }
  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight light = lighting_getPointLight(i);
    vec3 toLight = light.position - litPoint;
    float attenuation = getPointLightAttenuation(light, length(toLight));
    color += treeCropLitColor(light.color) / attenuation * material.diffuse * litPointShare *
      max((dot(normal, normalize(toLight)) + wrap) / (1.0 + wrap), 0.0);
  }
  return color;
}

vec3 treeCropLitTone(vec3 x) {
  if (material.unlit || lighting.enabled == 0) return sqrt(x);
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return sqrt(mapped) * 1.02;
}
#endif
`;

/** Fruit, nuts and cones hang from a twig straight down, swing in the wind, drop and roll. */
const TREE_CROP_PROJECT_GLSL = /* glsl */ `  point.z = max(point.z, TREE_GROUND);

  vec4 commonPosition = treeCropProject(point);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);`;

const TREE_CROP_VARYINGS_GLSL = /* glsl */ `#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) return;
  treeShadowWrite(commonPosition, seed, shadowBias);
#endif
#ifndef TREE_CROP_DOT
  vCamera = project.cameraPosition;
  vNormal = treeToCommonDirection(normal);
  geometry.normal = vNormal;`;

const TREE_CROP_TINT_GLSL = /* glsl */ `  float early = hashE * 0.38;
  float ripeness = smoothstep(early, early + 0.62, crop.z);
  treeCropTints();`;

function getTreeCropHangingVertex(rind: boolean, level: TreeCropMeshLevel): string {
  const dot = level >= CROP_DOT_LEVEL;
  const lit = level === CROP_LIT_DOT_LEVEL;
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-crop-hanging-vs
${dot ? '#define TREE_CROP_DOT' : ''}
${lit ? '#define TREE_CROP_LIT' : ''}
${dot && !lit ? '#define TREE_CROP_QUAD' : ''}
${TREE_SAMPLER_PRECISION_GLSL}

${
  lit
    ? ''
    : /* glsl */ `// The crop's axes in common space, for what lies on its surface.
flat out vec3 vAxisX;
flat out vec3 vAxisZ;`
}

${TREE_PHOTOREAL_VERTEX_CHUNK}
${getTreeShadowVertex(!dot)}
${TREE_CROP_VERTEX_CHUNK}

// No two alike. Height, width over depth, a low shoulder, and wider at one end than the other.
vec4 gCropShape;
vec2 gCropShoulder;

#ifndef TREE_CROP_DOT
vec3 treeCropShaped(vec3 p) {
  float girth = 1.0 + gCropShape.w * p.z;
  float shoulder = gCropShape.z * dot(p.xy, gCropShoulder) * (0.6 + 0.4 * p.z);
  return vec3(p.x * gCropShape.y * girth, p.y / gCropShape.y * girth, p.z * gCropShape.x + shoulder);
}

// What that does to a normal: the surface's two tangents, carried through it.
vec3 treeCropShapedNormal(vec3 p, vec3 n) {
  vec3 tangentA = normalize(cross(n, abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 tangentB = cross(n, tangentA);
  vec3 at = treeCropShaped(p);
  return normalize(cross(treeCropShaped(p + tangentA * 0.03) - at, treeCropShaped(p + tangentB * 0.03) - at));
}
#endif

void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromIndex(instanceCropRef.x);
  gl_Position = TREE_CULLED;
#if defined(TREE_CROP_DOT) && !defined(TREE_CROP_QUAD)
  gl_PointSize = 1.0;
#endif
  int row = int(instanceCropRef.x + 0.5);
  if (!treeCropLoad(row)) return;

  float seed = cropSeed;
  float hashA = fract(seed * 13.17);
  float hashB = fract(seed * 29.41);
  float hashC = fract(seed * 53.89);
  float hashD = fract(seed * 83.31);
  float hashE = fract(seed * 7.77);

  float top = treePhotoreal.shape.y;
  float restHeight = treePhotoreal.shape.z;
  float full = crop.y * (0.84 + 0.16 * hashA) * treePhotoreal.look.y;
  float swell = pow(cropSwell, 0.34);
  float radius = full * swell;
  vec3 twig = cropDropped ? vec3(0.0) : treeTurnYaw(treeToMetres(cropTwig));

  // Where it comes to rest: below its twig, scattered, and rolled a little, away from the trunk, as the
  // ground falls away from a tree's planting berm, and a little anywhere.
  float crownNow = max(tree.size.x, tree.size.y) * (1.0 - pow(1.0 - tree.growth, 1.9));
  vec2 land;
  if (cropDropped) {
    float angle = hashC * TREE_TWO_PI;
    land = vec2(cos(angle), sin(angle)) * sqrt(hashD) * crownNow * 0.92;
  } else {
    float angle = hashC * TREE_TWO_PI;
    land = twig.xy + vec2(cos(angle), sin(angle)) * (0.03 + 0.22 * hashD) * min(crownNow, 1.0);
  }
  float outwardLength = length(land);
  vec2 outward = outwardLength > 1e-3 ? land / outwardLength : vec2(1.0, 0.0);
  float rollAngle = hashE * TREE_TWO_PI;
  vec2 rollDirection = normalize(outward * 0.75 + vec2(cos(rollAngle), sin(rollAngle)) * 0.8 + 1e-3);
  float rollLength = (0.05 + 0.5 * hashA * hashA) * min(crownNow, 1.0);

  // The fall. Time since it let go runs out at rest whatever the rate does, so nothing hangs in the air.
  float threshold = 0.02 + 0.96 * hashB;
  float passed = cropDropped ? 1.0 : crop.w - threshold;
  if (!treeCropLoadColor(row)) return;
  float rate = cropDropped ? 0.0 : cropUnripe.a;
  float settled = 1.0 - smoothstep(0.0, 0.02, rate);
  // With nothing falling, a crop right at its threshold is out of sight, so a slow change never jumps.
  float atThreshold = mix(1.0, smoothstep(0.0, 0.02, abs(passed)), settled);
  swell *= atThreshold;
  radius *= atThreshold;
  if (radius <= 0.0) return;
  float drop = max(twig.z - restHeight * full, 0.0);
  float fallTime = sqrt(2.0 * drop / 9.81);
  const float rollTime = 0.85;
  float flightTime = max(fallTime * 1.72, fallTime + rollTime) + 0.02;
  float progress = cropDropped ? 1.0 : treeEventProgress(passed, rate, flightTime);
  float time = progress * flightTime;
  if ((cropDropped || crop.w > 0.0) && !treeCropInLevel(mix(twig, vec3(land, 0.0), progress))) return;

#ifdef TREE_CROP_DOT
  // A fruit still on the far side of a full crown cannot be seen, and most of a tree's work is here. The
  // view at a very near tree goes through the crown, so this is for points only.
  if (progress <= 0.0 && tree.foliage > 0.8 && tree.lean <= 0.0 && tree.damage <= 0.0 && tree.growth > 0.6 &&
    dot(treeCropAway(twig), treeCropToCamera(twig)) < -0.3) return;
#endif

  treeWindLoad();
  float windStrength = tree.windStrength;

  // Its basis as it hangs: a little off plumb, and pushed by the wind.
  vec2 tilt = (vec2(hashC, hashD) - 0.5) * 0.28;
  float windy = (1.0 - smoothstep(0.0, 0.2, progress));
  if (windStrength > 0.0 && windy > 0.0) {
    float clock = treePhotoreal.clock.x;
    float phase = seed * TREE_TWO_PI * 5.0;
    vec2 direction = treePhotoreal.wind.w > 0.5 ? treePhotoreal.wind.yz : vec2(0.91, 0.41);
    vec2 across = vec2(-direction.y, direction.x);
    float heavy = windStrength * 3.2;
    float swing = sin(clock * (2.4 + 1.6 * hashA) + phase);
    float wobble = sin(clock * (3.7 + 2.1 * hashB) + phase * 1.7);
    tilt += windy * (tree.windBend * 2.2 +
      (direction * swing + across * wobble * 0.55) * min(heavy, 0.7));
  }
  vec3 axisZ = normalize(vec3(tilt, 1.0));
  float yaw = hashD * TREE_TWO_PI;
  vec3 axisX = normalize(vec3(cos(yaw), sin(yaw), 0.0) - axisZ * (cos(yaw) * axisZ.x + sin(yaw) * axisZ.y));
  vec3 axisY = cross(axisZ, axisX);

  // No two alike: its proportions, and which side its shoulder is low on.
  gCropShape = vec4(
    0.925 + 0.105 * hashC,
    1.0 + (hashD - 0.5) * 0.05,
    (hashB - 0.5) * 0.1,
    (hashA - 0.5) * 0.06
  );
  float shoulderAngle = hashE * TREE_TWO_PI * 3.0;
  gCropShoulder = vec2(cos(shoulderAngle), sin(shoulderAngle));
  float crownTop = top * gCropShape.x;

  float restZ = restHeight * radius + TREE_GROUND;
  vec3 center;
  float stem = full * treePhotoreal.look.w * (0.72 + 0.56 * hashE) * swell;
  float released = smoothstep(0.0, 0.06, progress);
  vec3 stemRoot = vec3(0.0);
  // Where it hangs before anything moves it, and which way out of the crown that is.
  vec3 away = cropDropped ? vec3(0.0, 0.0, 1.0) : treeCropAway(twig);
  vec3 hanging = twig - vec3(0.0, 0.0, stem + crownTop * radius);

  if (progress >= 1.0) {
    center = vec3(land + rollDirection * rollLength, restZ);
  } else {
    mat3 turn = mat3(1.0);
    vec3 attach = treeCropAttach(twig, turn);
    // Right under its twig, a little to one side: a stem leaves its node at an angle, and the fruit's weight
    // bends it over to hang plumb.
    float asideAngle = hashB * TREE_TWO_PI * 2.0;
    vec3 aside = vec3(cos(asideAngle), sin(asideAngle), 0.0) * stem * (0.25 + 0.6 * hashC);
    center = attach + aside - axisZ * (stem + crownTop * radius);
    center.z = max(center.z, restZ);
    stemRoot = attach;
    if (progress > 0.0) {
      float falling = center.z - restZ;
      float along = smoothstep(0.0, max(fallTime, 0.05), time);
      float rolled = clamp((time - fallTime) / rollTime, 0.0, 1.0);
      center.xy = mix(center.xy, land, along) + rollDirection * rollLength * (1.0 - (1.0 - rolled) * (1.0 - rolled));
      center.z = restZ + treeCropDropHeight(falling, time);
    }
  }

  if (progress > 0.0) {
    // Tumbling, to lie on its side, and turning about its long axis as it rolls.
    vec3 rollAxis = vec3(-rollDirection.y, rollDirection.x, 0.0);
    float lift = (hashB - 0.5) * (restHeight > 0.6 ? 1.7 : 0.16);
    vec3 lying = normalize(rollAxis + vec3(0.0, 0.0, lift));
    vec3 pivot = cross(axisZ, lying);
    float pivotLength = length(pivot);
    pivot = pivotLength > 1e-3 ? pivot / pivotLength : axisX;
    float tumble = atan(pivotLength, dot(axisZ, lying)) + (hashA < 0.5 ? TREE_TWO_PI : 0.0);
    mat3 turning = treeRotation(pivot, tumble * min(time / max(fallTime, 0.05), 1.0));
    float rolled = clamp((time - fallTime) / rollTime, 0.0, 1.0);
    float rollTurn = rollLength * (1.0 - (1.0 - rolled) * (1.0 - rolled)) / max(radius * restHeight, 1e-3);
    mat3 rolling = treeRotation(rollAxis, rollTurn);
    axisX = rolling * (turning * axisX);
    axisY = rolling * (turning * axisY);
    axisZ = rolling * (turning * axisZ);
  }

  float part = cropPart.x;
  // Under a crop close to the ground: a soft dark patch, and in the sun the shadow it casts.
  bool isContact = part == ${TREE_CROP_PART.CONTACT}.0;
  float contact = 0.0;
  // Toward the sun along the ground, per metre of height.
  vec2 sunward = vec2(0.0);
  bool hasSun = false;
  if (isContact) {
    // It is not the crop, for anything that asks.
    if (picking.isActive > 0.5) return;
#ifdef MODULE_SHADOW
    if (shadow.drawShadowMap) return;
#endif
    contact = 1.0 - smoothstep(0.0, restHeight * radius * 3.0 + 0.02, center.z - restZ);
    if (contact <= 0.0) return;
    if (lighting.directionalLightCount > 0 && treePhotoreal.clock.w < 0.5) {
      vec3 light = normalize(-lighting_getDirectionalLight(0).direction);
      sunward = light.xy / max(light.z, 0.3);
      hasSun = true;
    }
    center.z = TREE_GROUND + 0.0015;
#ifdef TREE_CROP_DOT
    center.xy -= sunward * radius * restHeight * 0.5;
#endif
  }
#ifdef MODULE_SHADOW
  // On the ground the patch is its shadow, softer than a map's texels could draw it.
  if (shadow.drawShadowMap && progress >= 1.0) return;
#endif
  vec4 contactPlace = vec4(0.0);
#ifdef TREE_CROP_DOT
  vec3 point = center;
#else
  vec3 point;
  vec3 normal = axisX * cropNormal.x + axisY * cropNormal.y + axisZ * cropNormal.z;
  if (part == ${TREE_CROP_PART.STEM}.0) {
    // Up from the fruit, and curving over to the twig. Once it drops, a stub stays with the fruit.
    float along = cropPosition.z;
    vec3 from = center + axisZ * crownTop * radius;
    vec3 stub = from + axisZ * along * stem * 0.24;
    vec3 tube = stub;
    vec3 tangent = axisZ;
    if (released < 1.0) {
      // It leaves its node at an angle, and bends over under the fruit's weight to hang plumb.
      vec3 reach = stemRoot - from;
      vec3 control = from + axisZ * max(dot(reach, axisZ) * 0.72, stem * 0.4);
      float rest = 1.0 - along;
      vec3 curve = from * rest * rest + control * 2.0 * along * rest + stemRoot * along * along;
      vec3 direction = (control - from) * 2.0 * rest + (stemRoot - control) * 2.0 * along;
      tube = mix(curve, stub, released);
      tangent = normalize(mix(direction, axisZ, released) + axisZ * 1e-3);
    }
    vec3 sideA = normalize(cross(tangent, axisX) + axisY * 1e-3);
    vec3 sideB = cross(tangent, sideA);
    float thickness = mix(radius, full, 0.5);
    point = tube + (sideA * cropPosition.x + sideB * cropPosition.y) * thickness;
    normal = sideA * cropNormal.x + sideB * cropNormal.y + tangent * cropNormal.z;
  } else if (isContact) {
    // A ball's shadow on the ground is an ellipse, as wide as the ball and as long as the sun is low. The
    // patch takes in that, and what lies under the ball.
    float ball = radius * restHeight;
    float slope = length(sunward);
    vec2 along = slope > 1e-3 ? -sunward / slope : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    float shadowMiddle = ball * slope;
    float shadowLength = ball * sqrt(1.0 + slope * slope);
    float patchStart = -1.2 * ball;
    float patchEnd = max(shadowMiddle + shadowLength, 1.2 * ball);
    vec2 offset = along * (0.5 * (patchStart + patchEnd) + cropPosition.x * 0.56 * (patchEnd - patchStart)) +
      across * cropPosition.y * ball * 1.55;
    point = center + vec3(offset, 0.0);
    normal = vec3(0.0, 0.0, 1.0);
    // Where this point is, from under the ball and in the shadow. Both are linear, so they interpolate.
    contactPlace = vec4(
      offset / (ball * 1.15),
      (dot(offset, along) - shadowMiddle) / shadowLength,
      dot(offset, across) / ball
    );
  } else if (part == ${TREE_CROP_PART.BODY}.0 || part == ${TREE_CROP_PART.CALYX}.0) {
    vec3 local = treeCropShaped(cropPosition) * radius;
    point = center + axisX * local.x + axisY * local.y + axisZ * local.z;
    vec3 shaped = treeCropShapedNormal(cropPosition, cropNormal);
    normal = axisX * shaped.x + axisY * shaped.y + axisZ * shaped.z;
  } else {
    vec3 local = cropPosition * radius;
    point = center + axisX * local.x + axisY * local.y + axisZ * local.z;
  }
#endif
${TREE_CROP_PROJECT_GLSL}
  float leafCutHash = fract(seed * 47.13);
#ifdef TREE_CROP_DOT
  // The size this shape has, large enough to be seen.
  float enlarged = treeCropVisible(radius, 1.3, 1.8);
  radius *= enlarged;
  float radiusPixels = radius * treeCropPixelsPerMetre(gl_Position.w);
  if (isContact) {
    treeCropDot(commonPosition.xyz, vec3(0.0, 0.0, 1.0), 0.02, restHeight * 1.35, radius, 1.0);
  } else {
    treeCropDot(commonPosition.xyz, axisZ, ${rind ? 'top * 0.955' : 'top'}, restHeight, radius, 0.0);
    if (progress <= 0.0) treeCropReveal(commonPosition.xyz, hashD, radiusPixels, enlarged);
  }
#else
  float radiusPixels = 100.0;
#endif
  // A body has its own coarse triangles in the map, which lie inside it, so it needs little bias. Far away its
  // shadow comes from leaves larger than life, at a texel larger than it, so most of those above it are let through,
  // as are a dot's depth and the crown's light.
  float shadowBias = part == ${TREE_CROP_PART.BODY}.0 ? 0.012 : 0.02;
#ifdef TREE_CROP_DOT
  shadowBias = mix(0.2, shadowBias, smoothstep(4.5, 11.0, radiusPixels));
#endif
${TREE_CROP_VARYINGS_GLSL}
  vLocal = cropPosition;
#endif
  // The crown takes most of its light, and the leaves of its own shoot more.
  vec4 crown = isContact
    ? vec4(1.0, 1.0, 1.0, 0.0)
    : treeCrownLight(mix(hanging, vec3(land + rollDirection * rollLength, restZ), progress), mix(cropShell, 1.0, progress));
  float among = isContact ? contact : treeCropAmong(crown, hashC, progress);
  float grounded = smoothstep(0.95, 1.0, progress);
  // Ripening goes fruit by fruit, and is done for all of them at either end.
${TREE_CROP_TINT_GLSL}
  // No two fruit quite one color: some a deeper orange, some yellower.
  cropRipe *= mix(vec3(1.05, 0.92, 0.9), vec3(0.97, 1.09, 1.1), hashD);
  float leafCut = treeCropLeafCut(isContact ? 0.0 : among, leafCutHash, radiusPixels);
#ifdef TREE_CROP_LIT
  if (isContact) {
    vLit = vec3(0.0);
    vLitRight = vec3(0.0);
    vLitUp = vec3(0.0);
    vLitCore = vec3(contact);
  } else {
    vec3 ripe = pow(cropRipe, vec3(1.12)) * vec3(0.52, 0.46, 0.3);
    vec3 green = cropGreen * vec3(0.62, 0.38, 0.75);
${
  rind
    ? /* glsl */ `    vec3 albedo = treeRindColor(green, ripe, ripeness, ripeness) * mix(0.9, 1.08, hashC);`
    : /* glsl */ `    vec3 albedo = mix(green, ripe, ripeness) * cropPart.y;`
}
    treeCropLitLoad(commonPosition.xyz, crown, treeCropSunShare(among, fract(seed * 17.93)));
${rind ? `    litAmbient *= ${TREE_CROP_RIND_SHADE};` : ''}
    bool lit = !(material.unlit || lighting.enabled == 0);
    vec3 shade = lit ? treeCropLitShade(gDotToward, 0.18) : vec3(1.0);
    // What a waxy skin mirrors, on average: the sky it can see, on the side facing the sky.
    vec3 sheen = lit ? litAmbient * vec3(0.09) * (1.0 - 0.4 * among) : vec3(0.0);
    vLit = treeCropLitTone(albedo * shade + sheen);
    // It is a ball: light falls off across it, and on a display goes about as its square root.
    vLitRight = vec3(0.0);
    vLitUp = vec3(0.0);
    if (lit) {
      vec3 toward = max(shade, vec3(1e-3));
      vLitRight = vLit * (treeCropLitShade(normalize(gDotToward + gDotRight), 0.18) / toward - 1.0) * 0.5;
      vLitUp = vLit * (treeCropLitShade(normalize(gDotToward + gDotUp), 0.18) / toward - 1.0) * 0.5;
    }
    // A leaf that crosses it, from its own side.
    float cutAngle = leafCutHash * TREE_TWO_PI * 5.0;
    vLitCore = vec3(vec2(cos(cutAngle), sin(cutAngle)), leafCut);
  }
#else
  vPosition = commonPosition.xyz;
  vAxisX = treeToCommonDirection(axisX);
  vAxisZ = treeToCommonDirection(axisZ);
  vAway = treeToCommonDirection(treeLeanTurn(away));
  vInfo = vec4(among, part, cropPart.y, shadowBias);
  vRest = vec3(grounded, max(passed, 0.0), leafCut);
  vCrown = crown;
  vRipe = isContact ? contactPlace : vec4(cropRipe, ripeness);
  vUnripe = vec4(cropGreen, cropSeed);
#ifndef TREE_CROP_DOT
  if (isContact) vLocal.z = hasSun ? grounded : 0.0;
#endif
#endif
}
`;
}

/** Blossoms face out from the shoot in small clusters, and their petals drift down one by one. */
function getTreeCropFlowerVertex(level: TreeCropMeshLevel): string {
  const dot = level >= CROP_DOT_LEVEL;
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-crop-flower-vs
#define TREE_CROP_FLOWER
${dot ? '#define TREE_CROP_DOT' : ''}
${dot ? '#define TREE_CROP_LIT' : ''}
${TREE_SAMPLER_PRECISION_GLSL}

${TREE_PHOTOREAL_VERTEX_CHUNK}
${getTreeShadowVertex(level === 0)}
${TREE_CROP_VERTEX_CHUNK}

void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromIndex(instanceCropRef.x);
  gl_Position = TREE_CULLED;
#ifdef TREE_CROP_DOT
  gl_PointSize = 1.0;
#endif
  int row = int(instanceCropRef.x + 0.5);
  if (!treeCropLoad(row)) return;

  // Each blossom of a cluster has its own seed.
  float seed = fract(cropSeed * 7.0 + (cropMember + 1.0) * 0.61803399);
  float hashA = fract(seed * 13.17);
  float hashB = fract(seed * 29.41);
  float hashC = fract(seed * 53.89);
  float hashD = fract(seed * 83.31);
  float hashE = fract(seed * 7.77);

  float part = cropPart.x;
#ifdef TREE_CROP_DOT
  bool isPetal = true;
  float petal = cropPart.y;
#else
  bool isPetal = part == ${TREE_CROP_PART.PETAL}.0;
  float petal = isPetal ? cropPosition.z : 0.0;
#endif

  // A few of each cluster are still buds. Others open as they swell.
  float budding = hashE < 0.24 ? 1.0 : 0.0;
  float open = (1.0 - 0.9 * budding) * smoothstep(0.2, 1.0, cropSwell);
  float full = crop.y * (0.84 + 0.16 * hashA) * treePhotoreal.look.y;
  float radius = full * pow(cropSwell, 0.34) * mix(1.0, 0.62, budding);
  if (radius <= 0.0) return;

  // Each petal lets go in its own time.
  float threshold = 0.02 + 0.92 * hashB + petal * 0.012;
  float fallen = cropDropped ? 2.0 : crop.w;
  float passed = fallen - threshold;
#ifdef TREE_CROP_DOT
  // The first point is the whole blossom. The others wait to be petals.
  if (petal > 0.5 && passed <= 0.0) return;
#endif
  vec3 twig = cropDropped ? vec3(0.0) : treeCropOnSkin(treeTurnYaw(treeToMetres(cropTwig)));
  float crownNow = max(tree.size.x, tree.size.y) * (1.0 - pow(1.0 - tree.growth, 1.9));
  if (cropDropped) {
    float angle = hashC * TREE_TWO_PI;
    twig.xy = vec2(cos(angle), sin(angle)) * sqrt(hashD) * crownNow * 0.92;
  }
  if (!treeCropLoadColor(row)) return;
  float rate = cropDropped ? 0.0 : cropUnripe.a;
  float settled = 1.0 - smoothstep(0.0, 0.02, rate);
  // The middle of a blossom outlasts its petals by a little, then withers.
  float blossomPassed = fallen - (0.02 + 0.92 * hashB);
  float wither = 1.0 - smoothstep(0.01, 0.05, blossomPassed);
  if (isPetal) radius *= mix(1.0, smoothstep(0.0, 0.015, abs(passed)), settled);
  else radius *= wither;
  if (radius <= 0.0) return;

  // Facing out from the shoot, toward the open air, each its own way.
  vec3 away = treeCropAway(twig);
#ifdef TREE_CROP_DOT
  // A blossom still on the far side of a full crown cannot be seen, and most of a tree's work is here.
  if (passed <= 0.0 && tree.foliage > 0.8 && tree.lean <= 0.0 && tree.damage <= 0.0 && tree.growth > 0.6 &&
    dot(away, treeCropToCamera(twig)) < -0.3) return;
#endif
  vec3 scatter = vec3(hashC, hashD, hashE) - 0.5;
  vec3 axis = normalize(away + vec3(0.0, 0.0, 0.3) + scatter * 1.3);
  // A cluster spreads about its attachment. The stalk runs from the attachment to the blossom.
  float spreadAngle = (cropMember + hashA * 0.6) * 1.0471976 + fract(cropSeed * 91.3) * TREE_TWO_PI;
  vec3 side = normalize(cross(away, vec3(cos(spreadAngle), sin(spreadAngle), 0.33)));
  float stalk = full * treePhotoreal.look.w * (0.6 + 0.8 * hashB);
  vec3 reach = side * stalk * 0.9 * step(0.5, cropMember) + axis * stalk;

  mat3 turn = mat3(1.0);
  treeWindLoad();
  vec3 attach = twig;
  float flightTime = 1.0;
  float progress = 0.0;
  if (isPetal) {
    // A petal falls at under a metre a second, which is what keeps so many in the air at once.
    float height = max(twig.z + reach.z, 0.1);
    flightTime = max(height / (0.5 + 0.45 * hashC), 0.6) + hashD * 0.6;
    progress = cropDropped ? 1.0 : treeEventProgress(passed, rate, flightTime);
  }
  if ((cropDropped || crop.w > 0.0) && !treeCropInLevel(mix(twig, vec3(twig.xy, 0.0), progress))) return;
  bool skipAttach = progress >= 1.0;
  if (!skipAttach) {
    attach = treeCropAttach(twig, turn);
    axis = treeLeanTurn(turn * axis);
    side = treeLeanTurn(turn * side);
    reach = treeLeanTurn(turn * reach);
    if (tree.windStrength > 0.0) {
      axis = treeWindTurn(axis, attach.z);
      float clock = treePhotoreal.clock.x;
      float phase = seed * TREE_TWO_PI * 5.0;
      axis = normalize(axis + side * sin(clock * (4.0 + 3.0 * hashA) + phase) * min(tree.windStrength * 3.0, 0.5));
    }
  }
  vec3 base = attach + reach * pow(cropSwell, 0.34);

  // Drifting down, side to side, turning over as a petal does, to lie flat on the ground.
  vec3 path = base;
  float grounded = 0.0;
  bool carried = false;
  vec3 flatX = vec3(1.0, 0.0, 0.0);
  vec3 flatY = vec3(0.0, 1.0, 0.0);
  float tumble = 0.0;
  float settling = 0.0;
  if (progress > 0.0) {
    float time = progress * flightTime;
    float k = floor(petal + 0.5);
    float hashK = fract(seed * 17.1 + k * 0.618);
    float hashL = fract(seed * 41.7 + k * 0.414);
    float restAngle = hashK * TREE_TWO_PI;
    // Most leave the crown soon after they let go, which is what makes them seen, and lie around its edge.
    vec2 rest = twig.xy + vec2(cos(restAngle), sin(restAngle)) * (0.04 + 0.5 * hashL * hashL) * min(crownNow, 1.5);
    if (hashK > 0.2) rest += normalize(twig.xy + 1e-3) * (0.15 + 0.75 * hashL) * min(crownNow, 1.5);
    float fallZ = TREE_GROUND + 0.0015 + hashL * 0.012;
    float downward = mix(progress, progress * progress * (3.0 - 2.0 * progress), 0.3);
    float flutter = sin(3.14159265 * progress);
    vec2 slip = vec2(
      sin(time * (1.3 + 1.7 * hashK) + hashL * TREE_TWO_PI),
      sin(time * (1.7 + 1.4 * hashL) + hashK * TREE_TWO_PI)
    ) * (0.2 + 0.6 * hashK) * flutter;
    // The wind carries those it catches away for good, and only leans on the others in the air.
    vec2 downwind = treePhotoreal.wind.w > 0.5 ? treePhotoreal.wind.yz : vec2(0.91, 0.41);
    float gust = tree.windFlex * 24.0;
    carried = hashK < 0.22;
    if (carried && progress >= 1.0) return;
    vec2 windPath = downwind * gust * (carried ? progress : flutter * 0.45) * (0.5 + hashL);
    vec3 start = skipAttach ? twig : base;
    path = vec3(mix(start.xy, rest, smoothstep(0.0, 0.42, progress)) + slip + windPath, mix(start.z, fallZ, downward));
    settling = smoothstep(0.72, 1.0, progress);
    float heading = hashL * TREE_TWO_PI + time * (0.7 + 1.8 * hashK) * (hashK < 0.5 ? -1.0 : 1.0) * (1.0 - settling);
    flatX = vec3(cos(heading), sin(heading), 0.0);
    flatY = vec3(-flatX.y, flatX.x, 0.0);
    tumble = time * (2.2 + 3.4 * hashL) + hashK * TREE_TWO_PI;
    grounded = smoothstep(0.92, 1.0, progress);
    if (carried) radius *= 1.0 - smoothstep(0.82, 1.0, progress);
  }

#ifdef TREE_CROP_DOT
  vec3 point = path;
#else
  // The blossom's frame.
  vec3 axisX = normalize(cross(axis, vec3(hashA - 0.5, hashB - 0.5, 0.31)));
  vec3 axisY = cross(axis, axisX);
  vec3 point;
  vec3 normal;
  vec3 local = cropPosition;
  if (part == ${TREE_CROP_PART.STALK}.0) {
    point = mix(base - axis * 0.1 * radius, attach, cropPosition.z) +
      (axisX * cropPosition.x + axisY * cropPosition.y) * full;
    normal = axisX * cropNormal.x + axisY * cropNormal.y;
  } else if (isPetal) {
    float k = floor(petal + 0.5);
    float wobble = fract(seed * 11.3 + k * 0.37);
    const float petalLength = 0.92;
    float t = cropPosition.x;
    float across = cropPosition.y;
    float azimuth = (k + (wobble - 0.5) * 0.28) * 1.2566371;
    vec3 radial = axisX * cos(azimuth) + axisY * sin(azimuth);
    vec3 tangent = axisY * cos(azimuth) - axisX * sin(azimuth);
    // A petal is an arc in the plane of its radial: from a cup at its base to a tip bent back. Closed, it
    // stands up around the stamens.
    float start = mix(0.14, 0.62 + 0.14 * wobble, open);
    float bend = mix(-0.34, 1.75 + 0.42 * hashC, open);
    float bendSafe = abs(bend) < 1e-3 ? 1e-3 : bend;
    float theta = start + bendSafe * t;
    float r = (cos(start) - cos(theta)) / bendSafe;
    float h = (sin(theta) - sin(start)) / bendSafe;
    vec3 inward = radial * -cos(theta) + axis * sin(theta);
    // Its edges curl back from the inner face.
    float cup = 0.5 + 0.5 * open;
    float curl = across * across * cup;
    point = base + (radial * (0.15 * mix(0.6, 1.0, open) + petalLength * r) + tangent * across +
      axis * (0.02 + petalLength * h) - inward * curl) * radius;
    normal = normalize(inward + tangent * across * cup * 2.0);
    local = vec3(t, across, cropPosition.z);
    if (progress > 0.0) {
      float over = cos(tumble);
      float tip = sin(tumble);
      vec3 e1 = normalize(mix(flatX * over + vec3(0.0, 0.0, tip), flatX, settling));
      vec3 e2 = flatY;
      vec3 e3 = normalize(cross(e1, e2));
      vec2 blade = vec2((t - 0.5) * petalLength, across);
      float curled = -0.42 * blade.x * blade.x * (1.0 - 0.75 * progress);
      float scale = treeCropVisibleAt(path, radius * 0.46, 2.4, 7.0);
      vec3 flying = path + (e1 * blade.x + e2 * blade.y + e3 * curled) * radius * scale;
      float blend = smoothstep(0.0, 0.05, progress);
      point = skipAttach ? flying : mix(point, flying, blend);
      normal = normalize(mix(normal, e3 + e1 * 0.84 * blade.x * (1.0 - 0.75 * progress), blend));
    }
  } else {
    // The stamens, pistil and cup: rigid, drawn in as they open.
    vec3 scale = vec3(radius) * vec3(mix(0.55, 1.0, open), mix(0.55, 1.0, open), mix(0.75, 1.0, open));
    point = base + (axisX * cropPosition.x * scale.x + axisY * cropPosition.y * scale.y + axis * cropPosition.z * scale.z);
    normal = axisX * cropNormal.x + axisY * cropNormal.y + axis * cropNormal.z;
  }
#endif
${TREE_CROP_PROJECT_GLSL}
#ifdef TREE_CROP_DOT
  vec3 dotNormal = vec3(0.0);
  if (progress > 0.0) {
    // A flake, turning over in the air, lying flat on the ground.
    float flakeRadius = radius * 0.46 * treeCropVisible(radius * 0.46, 2.3, 7.0);
    vec3 faceUp = vec3(0.0, 0.0, 1.0);
    vec3 facing = normalize(mix(cross(flatX, flatY) * cos(tumble) + flatX * sin(tumble), faceUp, settling));
    // An ellipse: a petal seen from its face is longer than it is wide, and edge on hardly there.
    treeCropDot(commonPosition.xyz, facing, 0.24, 0.85, flakeRadius, 1.0);
    dotNormal = treeToCommonDirection(facing);
  } else {
    // A whole blossom, with its outline and its yellow middle, facing the viewer as near as makes no odds.
    radius *= mix(0.6, 0.86, open);
    radius *= treeCropVisible(radius, 2.6, 3.2);
    treeCropDot(commonPosition.xyz, vec3(0.0, 0.0, 1.0), 1.0, 1.0, radius, 2.0 + hashA);
    // A blossom is drawn larger than life even from close, as a real tree has so many more of them.
    treeCropReveal(commonPosition.xyz, hashD, radius * treeCropPixelsPerMetre(gl_Position.w), 1.0);
    dotNormal = normalize(gDotToward + treeToCommonDirection(axis) * 0.6);
  }
#endif
  float shadowBias = full * 0.6 + 0.02;
${TREE_CROP_VARYINGS_GLSL}
  vLocal = local;
#endif

  // The crown takes most of its light, wherever it has got to, and the leaves of its own shoot more.
  vec4 crown = treeCrownLight(mix(twig, path, progress), mix(cropShell, 1.0, progress));
  float among = treeCropAmong(crown, hashC, progress);
${TREE_CROP_TINT_GLSL}
#ifdef TREE_CROP_LIT
  {
    vec3 tint = mix(cropGreen, cropRipe, ripeness) * ${floatLiteral(TREE_CROP_PETAL_ALBEDO)};
    // Thin: it lights from both sides.
    if (dot(dotNormal, gDotToward) < 0.0) dotNormal = -dotNormal;
    // On the ground a petal browns, the first to fall the most.
    float aged = grounded * smoothstep(0.25, 0.95, passed) * fract(seed * 19.3);
    tint = mix(tint, vec3(0.34, 0.24, 0.13), aged * 0.75);
    treeCropLitLoad(commonPosition.xyz, crown, treeCropSunShare(among, fract(seed * 17.93)));
    litThrough = 0.8 * (1.0 - grounded);
    vec3 shade = material.unlit || lighting.enabled == 0 ? vec3(1.0) : treeCropLitShade(dotNormal, 0.5);
    vLit = treeCropLitTone(tint * shade);
    vLitRight = vec3(0.0);
    vLitUp = vec3(0.0);
    vLitCore = treeCropLitTone(vec3(0.55, 0.34, 0.03) * shade);
  }
#else
  vPosition = commonPosition.xyz;
  vAway = treeToCommonDirection(treeLeanTurn(away));
  vInfo = vec4(among, part, cropPart.y, shadowBias);
  vRest = vec3(grounded, max(passed, 0.0), 1.3);
  vCrown = crown;
  vRipe = vec4(cropRipe, ripeness);
  vUnripe = vec4(cropGreen, cropSeed);
#endif
}
`;
}

/** The whole fragment stage of a point lit per vertex: its shape and its color, and nothing else. */
function getTreeCropLitDotFragment(flower: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-crop-lit-dot-fs
${TREE_PRECISION_GLSL}

in vec3 vLit;
in vec3 vLitRight;
in vec3 vLitUp;
in vec3 vLitCore;
in vec4 vDot;
in vec2 vDotShape;

out vec4 fragColor;

void main(void) {
  geometry.uv = vec2(0.0);
  vec2 q = vec2(2.0 * gl_PointCoord.x - 1.0, 1.0 - 2.0 * gl_PointCoord.y);
  // The point has a pixel of margin.
  float pixels = vDotShape.x;
  q *= (pixels + 1.0) / max(pixels, 1e-3);
  vec2 axis = vDot.xy;
  vec2 across = vec2(-axis.y, axis.x);
  vec2 e = vec2(dot(q, axis) / max(vDot.z, 1e-3), dot(q, across) / max(vDot.w, 1e-3));
  float rho = length(e);
  float coverage = clamp((1.0 - rho) * pixels * 0.5 * min(vDot.z, vDot.w) + 0.5, 0.0, 1.0);
  vec3 color = vLit;
${
  flower
    ? /* glsl */ `  float shape = vDotShape.y;
  if (shape >= 1.5) {
    // A blossom: five petals around a yellow middle, at its own turn.
    float petals = cos(5.0 * (atan(q.y, q.x) + (shape - 2.0) * 6.2831853));
    float reach = 0.68 + 0.32 * sqrt(max(0.5 + 0.5 * petals, 0.0));
    float radial = length(q);
    coverage = clamp((reach - radial) * pixels * 0.5 + 0.5, 0.0, 1.0);
    color = mix(vLitCore, color, smoothstep(0.1, 0.34, radial));
  }`
    : /* glsl */ `  vec2 onBall = axis * e.x + across * e.y;
  color += (vLitRight * onBall.x + vLitUp * onBall.y) * 1.3;
  if (vDotShape.y > 0.5) {
    // What lies under a crop: dark to nothing.
    float falloff = max(1.0 - rho * rho, 0.0);
    fragColor = vec4(vec3(0.0), layer.opacity * vLitCore.x * 0.6 * falloff * falloff);
    return;
  }
  // A ball darkens toward its edge. A leaf crosses many of them, from its own side, and what is right behind
  // the leaf is in its shade, so a far fruit is an irregular fleck among leaves.
  float leafDirectionLength = length(vLitCore.xy);
  color *= 1.0 - 0.26 * leafDirectionLength * (1.0 - sqrt(max(1.0 - rho * rho, 0.0)));
  float beyondCut = dot(q, vLitCore.xy) - vLitCore.z;
  color *= 1.0 - 0.4 * leafDirectionLength * smoothstep(-0.6, 0.0, beyondCut);
  coverage *= 1.0 - clamp(beyondCut * pixels * 0.5 + 0.5, 0.0, 1.0);`
}
  if (coverage <= (picking.isActive > 0.5 ? 0.5 : 0.0)) discard;
${TREE_PICKING_FRAGMENT_GLSL}
  fragColor = vec4(color, layer.opacity * coverage);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
}

/** Light on a crop, shared by the fragment shaders. Crops are thicker than leaves, and glossier. */
function getTreeCropFragmentChunk(dot: boolean, perPixelShadow: boolean, taps: number): string {
  return /* glsl */ `
in vec3 vPosition;
in vec4 vRipe;
in vec4 vUnripe;
in vec4 vInfo;
in vec3 vRest;
in vec4 vCrown;
flat in vec3 vAway;
${
  dot
    ? /* glsl */ `in vec4 vDot;
in vec2 vDotShape;
in vec3 vRight;
in vec3 vUp;
in vec3 vToward;`
    : /* glsl */ `in vec3 vCamera;
in vec3 vNormal;
in vec3 vLocal;`
}

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${getTreeShadowFragment(perPixelShadow, taps)}

vec3 gNormal;
vec3 gView;
vec3 gDiffuse = vec3(0.0);
vec3 gSpecular = vec3(0.0);
vec3 gGlow = vec3(0.0);
// How much diffuse light wraps past the terminator, light through the part, and gloss.
float gWrap = 0.1;
float gThrough = 0.0;
float gWax = 1.0;
float gShininess = 32.0;
float gBroad = 0.0;
// How much of the sun the leaves right around it let through.
float gSunShare = 1.0;
${TREE_CROP_SHADING}

void treeCropLight(vec3 light, vec3 color, float visibility) {
  float facing = dot(gNormal, light);
  gDiffuse += color * max((facing + gWrap) / (1.0 + gWrap), 0.0) * visibility;
  if (facing > 0.0) {
    vec3 halfway = normalize(light + gView);
    float along = max(dot(gNormal, halfway), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(gView, halfway), 0.0), 5.0);
    // Normalized, so a tight highlight is a bright one.
    float tight = pow(along, gShininess) * (gShininess + 8.0) * 0.04;
    float broad = pow(along, gShininess * 0.09 + 3.0) * gBroad;
    gSpecular += color * (tight + broad) * fresnel * gWax * visibility;
  }
  if (gThrough > 0.0) {
    float through = max(-facing, 0.0);
    float toward = pow(max(dot(-gView, light), 0.0), 3.0);
    gGlow += color * through * (0.5 + 1.2 * toward) * gThrough * visibility;
  }
}

void treeCropLights(float shadowBias) {
  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    treeCropLight(
      normalize(-light.direction),
      treeLightColor(light.color),
      treeDirectionalVisibility(i, shadowBias) * treeCrownSun(vCrown, i) * gSunShare
    );
  }
  for (int i = 0; i < lighting.pointLightCount; i++) {
    PointLight light = lighting_getPointLight(i);
    vec3 toLight = light.position - vPosition;
    float attenuation = getPointLightAttenuation(light, length(toLight));
    treeCropLight(normalize(toLight), treeLightColor(light.color) / attenuation, sqrt(vCrown.y));
  }
}

// What a waxy surface with some relief to it mirrors: treeSkyColor spread over a wide lobe. A crop is too small a
// mirror for a horizon, and one would lie across it as a line.
vec3 treeCropSoftSky(vec3 direction, vec3 up) {
  vec3 ambient = treeLightColor(lighting.ambientColor);
  float height = dot(direction, up);
  vec3 sky = ambient * mix(vec3(1.35, 1.28, 1.12), vec3(0.9, 1.0, 1.12), smoothstep(-0.1, 0.8, height));
  return mix(ambient * vec3(0.3, 0.26, 0.19), sky, smoothstep(-0.7, 0.5, height));
}

// What a surface here sees of the open sky, given how much the crop is among leaves: the side that faces into the
// crown sees leaves and wood, and the top is under the leaves of its own shoot.
float treeCropOpen(vec3 normal, vec3 up, float among) {
  float outward = smoothstep(-0.8, 0.45, dot(normal, vAway));
  float roofed = smoothstep(0.25, 0.95, dot(normal, up));
  return mix(1.0, mix(0.34, 1.0, outward) * (1.0 - 0.34 * roofed), among);
}

${
  dot
    ? /* glsl */ `
in vec2 vDotCorner;

// Where in a dot this fragment is, as xy across the shape it stands for and z toward the viewer; and how
// much of the pixel the shape covers, in w, which is 0 outside it.
vec4 treeCropDotPoint() {
  vec2 q = vDotCorner;
  // The dot has a pixel of margin.
  float pixels = vDotShape.x;
  q *= (pixels + 1.0) / max(pixels, 1e-3);
  vec2 axis = vDot.xy;
  vec2 across = vec2(-axis.y, axis.x);
  vec2 e = vec2(dot(q, axis) / max(vDot.z, 1e-3), dot(q, across) / max(vDot.w, 1e-3));
  float rho = length(e);
  float edge = clamp((1.0 - rho) * pixels * 0.5 * min(vDot.z, vDot.w) + 0.5, 0.0, 1.0);
  return vec4(axis * e.x + across * e.y, sqrt(max(1.0 - rho * rho, 0.0)), edge);
}
`
    : ''
}
`;
}

/** Citrus rind, and the plain surfaces of nuts, cones and catkins. */
function getTreeCropHangingFragment(rind: boolean, level: TreeCropMeshLevel): string {
  const dot = level >= CROP_DOT_LEVEL;
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-crop-hanging-fs
${TREE_SAMPLER_PRECISION_GLSL}

flat in vec3 vAxisX;
flat in vec3 vAxisZ;

${getTreeCropFragmentChunk(dot, !dot, 10)}

${
  !dot && rind
    ? /* glsl */ `
// The nearest oil gland of the rind: xyz from it to p, w how far, all in cells. The nearest of the eight
// cells around p's closest corner, which is all a jitter this small can bring within reach.
vec4 treeRindGland(vec3 p, out float depth) {
  vec3 cell = floor(p);
  vec3 corner = cell + floor(p - cell + 0.5) - 1.0;
  vec4 nearest = vec4(0.0, 0.0, 0.0, 9.0);
  for (int z = 0; z < 2; z++) {
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec3 c = corner + vec3(float(x), float(y), float(z));
        float hash = treeHash(c);
        vec3 jitter = fract(vec3(hash * 37.0, hash * 61.0, hash * 83.0));
        vec3 toPoint = p - (c + 0.5 + (jitter - 0.5) * 0.62);
        float distanceSquared = dot(toPoint, toPoint);
        if (distanceSquared < nearest.w) {
          nearest = vec4(toPoint, distanceSquared);
          depth = 0.3 + 0.7 * fract(hash * 113.0);
        }
      }
    }
  }
  nearest.w = sqrt(nearest.w);
  return nearest;
}

// The rind's relief with glands of this many cells to a radius: xyz how it tilts a surface, in the crop's axes,
// and w how deep in a pit this is, 0-1.
vec4 treeRindRelief(vec3 local, float cells, float seed) {
  float depth;
  vec4 gland = treeRindGland(local * cells + seed * 311.0, depth);
  float pit = clamp(gland.w / (0.3 + 0.17 * depth), 0.0, 1.0);
  float slope = 4.0 * pit * (1.0 - pit);
  vec3 toGland = gland.w > 1e-4 ? gland.xyz / gland.w : vec3(0.0);
  // Up out of each pit, and over a soft cushion to the next, so nowhere on the rind is flat. The cushion
  // levels off before the cell ends, or the seams between cells would show as facets in the highlight.
  float cushion = gland.w * (1.0 - smoothstep(0.26, 0.56, gland.w));
  return vec4(toGland * (slope * 0.22 * depth + cushion * 0.17), (1.0 - pit) * (1.0 - pit) * depth);
}
`
    : ''
}

void main(void) {
  geometry.uv = vec2(0.0);
  // Nothing here discards: a fragment that may discard is shaded before the depth test.
${dot ? '  vec4 dotPoint = treeCropDotPoint();' : ''}
  float part = floor(vInfo.y + 0.5);
${TREE_PICKING_FRAGMENT_GLSL}
${TREE_SHADOW_FRAGMENT_GLSL}

  if (part == ${TREE_CROP_PART.CONTACT}.0) {
${
  dot
    ? /* glsl */ `    // Dark to nothing, in how much of a crop lies here.
    float falloff = max(1.0 - dot(dotPoint.xy, dotPoint.xy), 0.0);
    fragColor = vec4(vec3(0.0), layer.opacity * vInfo.x * 0.6 * falloff * falloff);`
    : /* glsl */ `    // Dark to nothing under the ball, in how much of a crop lies here. Beyond it, where the ground is in the
    // sun, its shadow, in the color the ground's other shadows have.
    float falloff = max(1.0 - dot(vRipe.xy, vRipe.xy), 0.0);
    float under = vInfo.x * 0.62 * falloff * falloff;
    vec3 shadowColor = vec3(0.0);
    float shadowAlpha = 0.45;
#ifdef MODULE_SHADOW
    if (treePhotoreal.look.z > 0.0) {
      shadowColor = shadow.color.rgb;
      shadowAlpha = shadow.color.a;
    }
#endif
    float thrown = vLocal.z * shadowAlpha * smoothstep(1.06, 0.72, length(vRipe.zw));
    if (thrown > 0.0) thrown *= treeDirectionalVisibility(0, vInfo.w);
    float alpha = 1.0 - (1.0 - under) * (1.0 - thrown);
    fragColor = vec4(shadowColor * thrown * (1.0 - under) / max(alpha, 1e-3), layer.opacity * alpha);`
}
    return;
  }
  float seed = vUnripe.a;
  vec3 axisY = cross(vAxisZ, vAxisX);
${
  dot
    ? /* glsl */ `  vec3 view = normalize(vToward);
  vec3 normal = normalize(vRight * dotPoint.x + vUp * dotPoint.y + view * dotPoint.z);
  // Where on the crop, on the ball it would be.
  vec3 local = vec3(dot(normal, vAxisX), dot(normal, axisY), dot(normal, vAxisZ));`
    : /* glsl */ `  vec3 local = vLocal;
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(vCamera - vPosition);`
}
  vec3 smoothNormal = normal;
  vec3 up = treeUp(vPosition);
  // A tint says how a crop looks in full sun; it reflects less than that, and its strongest channel
  // saturates in the tone curve, so the weaker ones take a larger share.
  vec3 ripe = pow(vRipe.rgb, vec3(1.12)) * vec3(0.52, 0.46, 0.3);
  vec3 unripe = vUnripe.rgb * vec3(0.62, 0.38, 0.75);
  vec3 albedo;
  gShininess = max(material.shininess, 2.0);
  gWax = 1.0;
  float among = vInfo.x;
  float occlusion = 1.0;

  if (part == ${TREE_CROP_PART.CALYX}.0) {
    // Sepals: a dull waxy green, drying brown at their tips and on a fruit that has come down.
    float cloud = treeNoise(local * 44.0 + seed * 37.0);
    albedo = mix(vec3(0.05, 0.075, 0.02), vec3(0.11, 0.125, 0.04), cloud);
    float tips = smoothstep(0.65, 1.0, vInfo.z) * treeNoise(local * 19.0 + seed * 7.0);
    albedo = mix(albedo, vec3(0.1, 0.07, 0.035), max(tips, vRest.x * 0.7));
    gShininess = 26.0;
    gWax = 0.45;
    gBroad = 0.5;
    occlusion *= 0.82;
  } else if (part == ${TREE_CROP_PART.STEM}.0) {
    // Wood: a pedicel is green only right at the button, and has barked over by the node it grows from.
    float wood = smoothstep(0.02, 0.4, local.z);
    albedo = mix(vec3(0.05, 0.06, 0.022), vec3(0.075, 0.055, 0.032), wood);
    albedo *= 0.72 + 0.56 * treeNoise(local * vec3(70.0, 70.0, 9.0) + seed * 11.0);
    gShininess = 12.0;
    gWax = 0.25;
    gBroad = 0.3;
  } else {
${
  rind
    ? /* glsl */ `    float ripeness = vRipe.a;
    float mottled = 4.0 * ripeness * (1.0 - ripeness);
    // Color breaks in patches that run into each other, on the side the sun finds and the blossom end first, and
    // last at the stem. The patches have no shape of their own: the noise they come from is bent by another.
    float edge = ripeness;
    if (mottled > 0.0) {
      vec3 q = local * 2.2 + seed * 57.0;
      vec3 bend = vec3(treeNoise(q * 1.3 + 7.1), treeNoise(q * 1.3 + 19.7), treeNoise(q * 1.3 + 31.3)) - 0.5;
      float patches = treeNoise(q + bend * 1.7) * 0.5 + treeNoise(q * 3.3 + bend * 2.6 + 11.0) * 0.28 +
        treeNoise(local * 21.0 + seed * 23.0) * 0.12 + ${dot ? '0.05' : 'treeNoise(local * 63.0 + seed * 41.0) * 0.1'};
      edge += mottled * ((patches - 0.5) * 0.95 - local.z * 0.2 + dot(smoothNormal, vAway) * 0.13);
    }
    albedo = treeRindColor(unripe, ripe, ripeness, edge);
    // No rind is one color: deeper on the side the sun found, yellower in places, with pale flecks.
    float tone = ${dot ? 'fract(seed * 91.0)' : 'treeNoise(local * 3.4 + seed * 91.0) * 0.7 + treeNoise(local * 9.1 + seed * 13.0) * 0.3'};
    albedo *= mix(vec3(0.87, 0.82, 0.8), vec3(1.1, 1.15, 1.18), tone);
    albedo = mix(albedo, albedo * vec3(0.92, 1.06, 1.0), smoothstep(0.1, 0.95, local.z));
    gBroad = 1.0;
    gWrap = 0.2;
    gWax = 1.5;
${
  dot
    ? /* glsl */ `    // The calyx as a dark spot on top; too small for glands, which still spread the highlight, and it is
    // fainter for that.
    albedo = mix(albedo, vec3(0.05, 0.08, 0.02), smoothstep(0.965, 0.985, local.z));
    gShininess *= 0.3;
    gBroad = 0.4;
    gWax = 0.85;`
    : /* glsl */ `    // Oil glands: small pits, closely packed, each its own depth, that break the highlight up. Too small to
    // see one by one, what they leave is a pebbled skin, so the relief goes to a coarser scale that the pixels
    // can show, and less of it. Below them are the slow swells of a real fruit's surface, and very close a
    // fine leathery grain.
    const float cells = 34.0;
    float footprint = length(fwidth(local)) * cells;
    float shown = 1.0 - smoothstep(3.0, 7.0, footprint);
    vec3 relief = vec3(
      sin(local.y * 11.0 + seed * 40.0) + sin(local.z * 7.0 + seed * 71.0) * 0.6,
      sin(local.z * 9.0 + seed * 23.0) + sin(local.x * 13.0 + seed * 5.0) * 0.6,
      sin(local.x * 8.0 + seed * 61.0) + sin(local.y * 6.0 + seed * 29.0) * 0.6
    ) * 0.014;
    float cavity = 0.0;
    if (shown > 0.0) {
      float level = clamp(log2(max(footprint, 1e-3) / 0.62), 0.0, 2.0);
      float lower = floor(level);
      float blend = level - lower;
      vec4 glands = treeRindRelief(local, cells / pow(2.0, lower), seed);
      if (blend > 0.0) glands = mix(glands, treeRindRelief(local, cells / pow(2.0, lower + 1.0), seed), blend);
      float strength = mix(1.0, 0.62, level * 0.5) * shown;
      relief += glands.xyz * strength;
      cavity = glands.w * strength;
      // Close up there are smaller glands between the large ones, so the pits have no pattern to them.
      float small = 1.0 - smoothstep(0.22, 0.5, footprint);
      if (small > 0.0) {
        vec4 smaller = treeRindRelief(local.yzx, cells * 2.3, fract(seed * 3.7));
        relief += smaller.zxy * 0.55 * small;
        cavity = max(cavity, smaller.w * 0.5 * small);
      }
      float grain = 1.0 - smoothstep(0.1, 0.3, footprint);
      if (grain > 0.0) {
        vec3 q = local * 170.0;
        float h = 0.25;
        float g0 = treeNoise(q);
        relief += vec3(treeNoise(q + vec3(h, 0.0, 0.0)) - g0, treeNoise(q + vec3(0.0, h, 0.0)) - g0, treeNoise(q + vec3(0.0, 0.0, h)) - g0) * 0.16 * grain;
      }
    }
    // The ends of a fruit. At the stem its neck is drawn into fine folds that run to the button, and the blossom
    // end has a small dark stylar scar in a puckered navel.
    float rho = length(local.xy);
    vec2 around = rho > 1e-4 ? local.xy / rho : vec2(1.0, 0.0);
    float angle = atan(local.y, local.x);
    float wander = treeNoise(vec3(around * 2.3, rho * 9.0) + seed * 17.0);
    float endDetail = 1.0 - smoothstep(0.04, 0.12, fwidth(rho));
    if (local.z >= 0.0) {
      float folds = sin(angle * 13.0 + wander * 5.0 + seed * 31.0) * (0.4 + 0.6 * wander);
      float reach = (1.0 - smoothstep(0.16, 0.42, rho)) * endDetail;
      relief.xy += vec2(-around.y, around.x) * folds * reach * 0.13;
      albedo *= 1.0 - 0.1 * reach * max(folds, 0.0);
      // What has not turned yet by the button.
      albedo = mix(albedo, albedo * vec3(0.88, 1.08, 1.0), 1.0 - smoothstep(0.12, 0.34, rho));
      occlusion *= mix(0.58, 1.0, smoothstep(0.08, 0.3, rho));
    } else {
      float folds = sin(angle * 9.0 + wander * 4.0 + seed * 13.0);
      float pucker = (1.0 - smoothstep(0.06, 0.26, rho)) * endDetail;
      relief.xy += vec2(-around.y, around.x) * folds * pucker * 0.17;
      float scarEdge = rho * (0.85 + 0.45 * wander);
      float scar = 1.0 - smoothstep(0.02, 0.05, scarEdge);
      albedo = mix(albedo, vec3(0.1, 0.07, 0.035), scar);
      // Its middle has dried darker.
      albedo *= 1.0 - 0.55 * (1.0 - smoothstep(0.004, 0.022, scarEdge));
      albedo = mix(albedo, albedo * vec3(1.06, 1.02, 0.8), (1.0 - smoothstep(0.04, 0.09, scarEdge)) * (1.0 - scar));
      gWax *= 1.0 - 0.8 * scar;
      occlusion *= mix(0.62, 1.0, smoothstep(0.02, 0.085, rho));
    }
    // Few fruit are clean: some have a faint corky scar, where a twig rubbed them as they swelled.
    float blemished = fract(seed * 27.7);
    if (blemished < 0.16 && shown > 0.0) {
      vec3 q = local * 6.5 + seed * 67.0;
      float rubbed = smoothstep(0.72, 0.8, treeNoise(q + treeNoise(q * 1.7) * 1.5));
      float scarred = rubbed * smoothstep(0.3, 0.7, treeNoise(local * 43.0 + seed * 7.0)) * shown;
      albedo = mix(albedo, albedo * vec3(0.76, 0.68, 0.66), scarred);
      gWax *= 1.0 - 0.6 * scarred;
    }
    vec3 tilt = vAxisX * relief.x + axisY * relief.y + vAxisZ * relief.z;
    normal = normalize(normal - (tilt - normal * dot(tilt, normal)));
    // The pits are shaded.
    albedo *= 1.0 - 0.2 * cavity;
    occlusion *= 1.0 - 0.28 * cavity;
    // Where the glands can't be seen they still spread the highlight.
    gShininess = mix(gShininess * 0.3, gShininess, shown);`
}
    // A fruit on the ground dulls and bruises, each in its own time.
    float rest = vRest.x;
    if (rest > 0.0) {
      float spoiled = smoothstep(0.3, 0.95, vRest.y) * fract(seed * 43.1);
      float bruise = smoothstep(0.52, 0.72, treeNoise(local * 3.0 + seed * 73.0));
      albedo = mix(albedo, albedo * vec3(0.5, 0.38, 0.3), bruise * (0.25 + 0.5 * spoiled) * rest);
      gWax *= 1.0 - 0.45 * rest * spoiled;
    }`
    : /* glsl */ `    // Its own color, from unripe to ripe, modeled by the mesh: scale edges, a darker cap.
    float shade = vInfo.z;
    albedo = mix(unripe, ripe, vRipe.a) * shade;
    if (shade < 0.6) albedo = mix(albedo, vec3(0.12, 0.09, 0.05) * (0.7 + 0.6 * shade), 0.75);
    albedo *= 0.82 + 0.36 * treeNoise(local * 15.0 + seed * 31.0);
    gBroad = 0.3;
    gWrap = 0.1;`
}
  }

  gNormal = normal;
  gView = view;
  gSunShare = treeCropSunShare(among, fract(seed * 17.93));
${dot ? '' : '  treeShadowNormal = smoothNormal;'}
  treeCropLights(vInfo.w);

  // The lit bottom of a thing lying on the ground is against the ground.
  float rest = vRest.x;
  float contact = mix(1.0, smoothstep(-1.05, 0.15, dot(normal, up)), rest);
  occlusion *= mix(1.0, 0.35 + 0.65 * contact, rest);
  float open = treeCropOpen(smoothNormal, up, among);
  vec3 sky = treeHemisphere(normal, up) * vCrown.y * open * occlusion + treeCrownBounce(vCrown) * mix(occlusion, 1.0, 0.5);
  // A waxy skin mirrors the sky, at glancing angles above all, broken up by its relief. What it would mirror
  // from inside the crown is leaves, so one among them is dark at its edge, and that is half of what sits it there.
  vec3 reflected = reflect(-view, normal);
  float openToMirror = mix(1.0, smoothstep(-0.55, 0.6, dot(reflected, vAway)), among);
  float fresnel = 0.038 + 0.42 * pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  vec3 mirrored = treeCropSoftSky(reflected, up) * fresnel * vCrown.y * openToMirror * occlusion * gWax;
  vec3 color = albedo * (sky * material.ambient${rind ? ` * ${TREE_CROP_RIND_SHADE}` : ''} + gDiffuse * material.diffuse) +
    gSpecular * floatColors_normalize(material.specularColor) + mirrored;
  if (material.unlit || lighting.enabled == 0) color = albedo;
${
  dot
    ? /* glsl */ `  // A leaf that crosses a small dot, from its own side, and it is in shade right behind that leaf. A mesh has
  // real leaves in front of it.
  float cutAngle = fract(seed * 47.13) * TREE_PI * 10.0;
  float beyondCut = dot(dotPoint.xy, vec2(cos(cutAngle), sin(cutAngle))) - vRest.z;
  color *= mix(1.0, 0.55, smoothstep(-0.5, 0.0, beyondCut));
  float alpha = dotPoint.w * (1.0 - clamp(beyondCut * vDotShape.x * 0.5 + 0.5, 0.0, 1.0));`
    : ''
}

  fragColor = vec4(treeFilmic(color), layer.opacity${dot ? ' * alpha' : ''});
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
}

/** White, waxy, thick petals that let light through, with stamens tipped in yellow. */
function getTreeCropFlowerFragment(level: TreeCropMeshLevel): string {
  const full = level === 0;
  return /* glsl */ `#version 300 es
#define SHADER_NAME tree-photoreal-crop-flower-fs
${TREE_SAMPLER_PRECISION_GLSL}

${getTreeCropFragmentChunk(false, full, 8)}

void main(void) {
  geometry.uv = vec2(0.0);
${TREE_PICKING_FRAGMENT_GLSL}
${TREE_SHADOW_FRAGMENT_GLSL}

  float part = floor(vInfo.y + 0.5);
  float seed = vUnripe.a;
  vec3 local = vLocal;
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  bool inner = gl_FrontFacing;
  if (!inner) normal = -normal;
  float along = vInfo.z;
  vec3 tint = mix(vUnripe.rgb, vRipe.rgb, vRipe.a) * ${floatLiteral(TREE_CROP_PETAL_ALBEDO)};
  vec3 albedo = tint;
  gShininess = max(material.shininess, 2.0);
  gWax = 0.8;
  gBroad = 0.7;
  gWrap = 0.42;
  gThrough = 0.0;
  float among = vInfo.x;
  float occlusion = 1.0;

  if (part == ${TREE_CROP_PART.PETAL}.0) {
    float t = local.x;
    // Greener where it leaves the cup; finely veined and dotted with oil glands close up.
    albedo = mix(tint * vec3(0.84, 0.88, 0.58), tint, smoothstep(0.02, 0.26, t));
${
  full
    ? /* glsl */ `    float footprint = fwidth(t);
    float close = 1.0 - smoothstep(0.012, 0.05, footprint);
    if (close > 0.0) {
      float veins = abs(sin(along * 8.5 + sin(t * 3.0) * 0.6 + seed * 9.0));
      albedo *= 1.0 - 0.07 * close * (1.0 - smoothstep(0.0, 0.3, veins));
      vec2 grid = vec2(t * 42.0, along * 11.0 + seed * 53.0);
      vec2 cell = floor(grid);
      float hash = treeHash(vec3(cell, seed));
      vec2 spot = fract(grid) - 0.5 + (vec2(hash, fract(hash * 7.0)) - 0.5) * 0.5;
      float gland = (1.0 - smoothstep(0.08, 0.22, length(spot))) * step(0.45, hash);
      albedo *= 1.0 - 0.09 * close * gland;
      // A waxy skin that is not quite even.
      float cloud = treeNoise(vec3(t * 13.0, along * 5.0, seed * 31.0));
      gWax *= 0.75 + 0.5 * cloud;
    }`
    : ''
}
    gThrough = 0.85;
    occlusion *= mix(0.72, 1.0, smoothstep(0.0, 0.3, t));
    if (!inner) albedo *= 0.96;
  } else if (part == ${TREE_CROP_PART.ANTHER}.0) {
    albedo = vec3(0.62, 0.36, 0.03);
    gWrap = 0.3;
    gWax = 0.25;
    gShininess = 18.0;
  } else if (part == ${TREE_CROP_PART.FILAMENT}.0) {
    albedo = vec3(0.44, 0.45, 0.3);
    gThrough = 0.4;
  } else if (part == ${TREE_CROP_PART.PISTIL}.0) {
    albedo = mix(vec3(0.2, 0.3, 0.07), vec3(0.5, 0.42, 0.07), smoothstep(0.3, 1.0, along));
    gWax = 0.6;
  } else {
    albedo = vec3(0.06, 0.11, 0.025);
    gWax = 0.35;
    gShininess = 20.0;
    gWrap = 0.2;
  }

  // On the ground a petal bruises and browns, the first to fall the most.
  float rest = vRest.x;
  if (rest > 0.0 && part == ${TREE_CROP_PART.PETAL}.0) {
    float aged = smoothstep(0.25, 0.95, vRest.y) * fract(seed * 19.3);
    albedo = mix(albedo, vec3(0.34, 0.24, 0.13), aged * 0.75);
    gWax *= 1.0 - 0.7 * aged;
    gThrough *= 1.0 - rest;
  }

  vec3 up = treeUp(vPosition);
  gNormal = normal;
  gView = view;
  gSunShare = treeCropSunShare(among, fract(seed * 17.93));
  treeCropLights(vInfo.w);

  vec3 sky = treeHemisphere(normal, up) * vCrown.y * treeCropOpen(normal, up, among) * occlusion +
    treeCrownBounce(vCrown) * occlusion;
  float grazing = pow(1.0 - max(dot(normal, view), 0.0), 4.0);
  vec3 reflected = reflect(-view, normal);
  float openToMirror = mix(1.0, smoothstep(-0.55, 0.6, dot(reflected, vAway)), among);
  vec3 mirrored = treeCropSoftSky(reflected, up) * (0.02 + 0.25 * grazing) * vCrown.y * openToMirror * occlusion * gWax;
  // What gets through a petal warms a little on the way.
  vec3 glowColor = pow(max(albedo, vec3(0.002)), vec3(0.8)) * vec3(1.0, 0.96, 0.78);
  vec3 color = albedo * (sky * material.ambient + gDiffuse * material.diffuse) +
    glowColor * gGlow * material.diffuse +
    gSpecular * floatColors_normalize(material.specularColor) + mirrored;
  if (material.unlit || lighting.enabled == 0) color = albedo;

  fragColor = vec4(treeFilmic(color), layer.opacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;
}

/** Vertex and fragment shaders of a crop kind at a mesh level. */
export function getTreeCropShaders(
  kind: CropKind,
  level: TreeCropMeshLevel
): {vs: string; fs: string} {
  if (kind === 'flower') {
    return {
      vs: getTreeCropFlowerVertex(level),
      fs:
        level >= CROP_DOT_LEVEL ? getTreeCropLitDotFragment(true) : getTreeCropFlowerFragment(level)
    };
  }
  const rind = kind === 'fruit' || kind === 'lemon';
  return {
    vs: getTreeCropHangingVertex(rind, level),
    fs:
      level === CROP_LIT_DOT_LEVEL
        ? getTreeCropLitDotFragment(false)
        : getTreeCropHangingFragment(rind, level)
  };
}
