// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The orange: the ripe fruit hanging by its stalk on the old tree, falling, landing beside the pot, and
 * in the macro shot that opens the cycle a whole fruit with a rind of oil glands and dew that parts into
 * two halves with a cut face worth looking at. Everything is drawn in fruit space, where the radius is 1
 * and z runs from the stem end (+z, half A) to the navel (-z, half B), so the rind goes on unbroken
 * across the seam until the seam opens. The stalk is drawn in its own space, from the button to the twig.
 */

import type {Layer} from '@deck.gl/core';
import {LOOP} from '../story/beats';
import {
  getBearingTwig,
  getImpactDamp,
  HERO_FRUIT_TABLE,
  ORANGE_TABLE,
  SEED_TABLE
} from '../story/props';
import {
  cross,
  getBearingVector,
  getQuatFromAxisAngle,
  getQuatFromTo,
  hash01,
  hashRange,
  multiplyQuat,
  rotateVector,
  smoothstep
} from '../story/story-math';
import type {Quat, StoryOrange, StoryState, Vec3} from '../story/story-types';
import {
  BEAD_PROGRAM,
  CONTACT_PROGRAM,
  CONTACT_STRIDE,
  createGridMesh,
  createSphereMesh,
  getPropLayerProps,
  mergeMeshes,
  PROP_FRAGMENT_CHUNK,
  PROP_FRAGMENT_PASSES,
  PROP_QUAD_MESH,
  PROP_VERTEX_CHUNK,
  PropMeshLayer,
  writeContact,
  writeDamp,
  type PropMesh,
  type PropProgram
} from './prop-shading';

/** The fruit's shape, in fruit units. */
const SHAPE = {
  /** Half height along the stem axis. */
  polar: 0.955,
  lumps: [
    {scale: 2.7, amount: 0.005, salt: 11},
    {scale: 6.1, amount: 0.002, salt: 37}
  ],
  stem: {dimple: 0.03, dimpleWidth: 0.15, shoulder: 0.012, shoulderAt: 0.3, shoulderWidth: 0.13},
  navel: {dimple: 0.036, dimpleWidth: 0.1, shoulder: 0.012, shoulderAt: 0.22, shoulderWidth: 0.12},
  /** How far the cut's edge rounds off, in fruit units, once it has opened. */
  fillet: 0.012,
  /** The share of the rind's rows that the last sliver before the equator takes. */
  filletRows: 0.06,
  filletAngle: 0.014
};

/** The cut face. Radii are in fruit units. */
const FACE = {
  segments: 11,
  /** Each segment's share of the circle, as a share of the mean, from a hash. */
  widthSpread: 0.3,
  columns: 288,
  rows: 72,
  /** Radius of the flesh's outer edge, against 1 for the rind. */
  fleshRadius: 0.895,
  coreRadius: 0.066,
  /** Half the thickness of a membrane. */
  membrane: 0.0034,
  rindRing: 0.032
};

/**
 * Pale seeds in their sockets on each face, in fruit units, as x, y and half length. They lie along the
 * radius, with their points to the center.
 */
const FACE_SEEDS = {
  stemHalf: [
    [-0.26, 0.15, 0.085],
    [0.08, -0.38, 0.1],
    [0.31, 0.27, 0.075]
  ],
  navelHalf: [
    [0.29, 0.17, 0.09],
    [-0.19, -0.3, 0.08],
    [-0.38, 0.2, 0.07],
    [0.12, 0.41, 0.075]
  ]
} as const;

/** Beads of juice that stand on each face once it is wet. */
const JUICE_BEADS = {
  count: 44,
  /** Radius in metres, the smallest and the largest. */
  radius: [0.00024, 0.00125],
  /** Most of them are small: the share of the range is a hash to this power. */
  sizePower: 2.4,
  squash: 0.6,
  /** How far from the center they stand, in fruit units. */
  reach: [0.1, 0.86],
  /** A share of the juice's rise that each bead takes. */
  rise: 0.35,
  height: 0.28
};

const DROPLET_RADIUS = 0.0011;
/** Clear dew, as the hanging and falling fruit sheds it, against the opening's juice. */
const DEW_DROP = {radius: 0.0015, tint: [0.97, 1, 1.04, 0.86]};
const JUICE_TINT = [1, 0.72, 0.36, 0.72];
const CONTACT = {
  /** Patch size in fruit radii, and its strength. */
  half: {size: 1.02, dark: 0.92}
};
/**
 * How much of the sky the hero's skirt keeps from the hanging fruit, which goes as the fruit falls clear
 * of it, over this many metres.
 */
const CANOPY = {sky: 0.5, clear: [0.03, 0.26] as const};
/**
 * The stalk: sides around, rows along, how much it bows, how far on into its twig it goes, and how much
 * it narrows in there, from what share of its length.
 */
const STALK = {
  columns: 14,
  rows: 24,
  bow: 0.06,
  intoTwig: 0.003,
  swell: 0.22,
  narrowing: 0.6,
  narrowFrom: 0.9
};
/** The stalk's radius at its very end, inside its twig, over its radius where it joins the twig. */
export const STALK_END_SHARE = (1 + STALK.swell) * (1 - STALK.narrowing);
/**
 * The bearing twig: sides around, rows along and rows of its rounded tip; how far its base goes on
 * into the limb it leaves, so no end of it shows; and its nodes, each where a leaf grew: how far
 * apart, how much they swell and over what length, the bud over each leaf's scar, and how far off
 * the straight line it turns at each.
 */
const TWIG = {
  columns: 16,
  rows: 320,
  capRows: 6,
  intoLimb: 0.003,
  nodeSpacing: 0.036,
  nodeSwell: 0.14,
  nodeLength: 0.0032,
  bud: 0.0009,
  kink: 0.0016,
  leafy: 0.16
};

/**
 * Leaves on the bearing twig near the fruit, as a citrus shoot carries them: how far up the twig from
 * where the stalk meets it, in metres; the compass bearing the blade points to and how far below level,
 * in degrees; its length and width. Each turns its upper side to `LEAF_FACING`, out of the crown and
 * up to the light, and rolls from there by `roll` degrees about its midrib.
 */
const TWIG_LEAVES = [
  {at: 0.034, bearing: 246, dip: 14, roll: -10, length: 0.084, width: 0.039},
  {at: 0.072, bearing: 62, dip: 4, roll: 12, length: 0.092, width: 0.043},
  {at: 0.118, bearing: 150, dip: 24, roll: 0, length: 0.078, width: 0.036}
] as const;
/** The way the bearing twig's leaves turn their upper sides: out of the hero's crown, and up. */
const LEAF_FACING: Vec3 = [0.55, -0.35, 0.76];
/**
 * A leaf's shape: how much of its length is petiole, and how wide its wings are against the blade; how
 * far the blade folds up along its midrib and arches down along its length; and how its edge waves.
 */
const LEAF_SHAPE = {petiole: 0.14, wing: 0.07, foldDegrees: 11, arch: 0.12, wave: 0.0006};

/** How dark a half's cut face is while the halves are still together. */
const OPEN_DISTANCE = [0.02, 0.8] as const;

const UP: Vec3 = [0, 0, 1];
const TWO_PI = Math.PI * 2;
const RADIANS = Math.PI / 180;

function getConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** A smooth value in 0-1, stable for a salt. */
function getValueNoise(x: number, y: number, z: number, salt: number): number {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const cz = Math.floor(z);
  const smooth = (value: number) => value * value * (3 - 2 * value);
  const fx = smooth(x - cx);
  const fy = smooth(y - cy);
  const fz = smooth(z - cz);
  const at = (i: number, j: number, k: number) =>
    hash01(i * 73856093 + j * 19349663 + k * 83492791, salt);
  const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
  return mix(
    mix(
      mix(at(cx, cy, cz), at(cx + 1, cy, cz), fx),
      mix(at(cx, cy + 1, cz), at(cx + 1, cy + 1, cz), fx),
      fy
    ),
    mix(
      mix(at(cx, cy, cz + 1), at(cx + 1, cy, cz + 1), fx),
      mix(at(cx, cy + 1, cz + 1), at(cx + 1, cy + 1, cz + 1), fx),
      fy
    ),
    fz
  );
}

/** How far the rind stands from a perfect shape along a unit direction, as a factor. */
function getLump(x: number, y: number, z: number): number {
  let lump = 1;
  for (const {scale, amount, salt} of SHAPE.lumps) {
    lump += amount * (2 * getValueNoise(x * scale + 5, y * scale + 5, z * scale + 5, salt) - 1);
  }
  return lump;
}

/** The rind at polar angle `alpha` from the pole of a half, and azimuth `theta`. */
export function getRindPoint(alpha: number, theta: number, side: 1 | -1): [number, number, number] {
  const rho = Math.sin(alpha);
  const height = Math.cos(alpha);
  const x = rho * Math.cos(theta);
  const y = rho * Math.sin(theta);
  const end = side > 0 ? SHAPE.stem : SHAPE.navel;
  const relief =
    -end.dimple * Math.exp(-((rho / end.dimpleWidth) ** 2)) +
    end.shoulder * Math.exp(-(((rho - end.shoulderAt) / end.shoulderWidth) ** 2));
  const lump = getLump(x, y, side * height);
  return [x * lump, y * lump, side * (height * SHAPE.polar * lump + relief * height)];
}

/** Height of the rind over the pole of a half, on its axis side, at a distance from its axis. */
function getRindHeight(rho: number, side: 1 | -1): number {
  return Math.abs(getRindPoint(Math.asin(Math.min(rho, 1)), 0, side)[2]);
}

function createRindDome(side: 1 | -1): PropMesh {
  const {filletRows, filletAngle} = SHAPE;
  const rimFlip = side < 0;
  const getAlpha = (v: number) =>
    v < filletRows
      ? Math.PI / 2 - filletAngle * (v / filletRows)
      : (Math.PI / 2 - filletAngle) * (1 - (v - filletRows) / (1 - filletRows));
  return createGridMesh({
    columns: 340,
    rows: 170,
    wrap: true,
    flip: rimFlip,
    getPoint: (u, v) => getRindPoint(getAlpha(v), u * TWO_PI, side),
    getDetails: (u, v) => [v < filletRows ? 1 - v / filletRows : 0, 0, u, v]
  });
}

/** The dried star of sepals around the stem, lying on the rind, with a stub of cut stem. */
function createCalyx(): PropMesh {
  const lobes = 5;
  const getEdge = (theta: number) => {
    const lobe = Math.floor(((theta + 0.2) / TWO_PI) * lobes);
    const scale = 0.86 + 0.28 * hash01(lobe, 3);
    const wave = 0.5 + 0.5 * Math.cos(lobes * theta - 1);
    return 0.135 * scale * (0.62 + 0.38 * wave ** 0.8);
  };
  const star = createGridMesh({
    columns: 160,
    rows: 28,
    wrap: true,
    flip: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const rho = v * getEdge(theta);
      // Thick at the stem, and the tips of the sepals lift a little off the rind.
      const lift =
        0.024 * Math.sqrt(Math.max(1 - v * v, 0)) * (0.65 + 0.35 * Math.cos(9 * theta)) +
        0.012 * v ** 4 -
        0.002;
      return [rho * Math.cos(theta), rho * Math.sin(theta), getRindHeight(rho, 1) + lift];
    },
    getDetails: (u, v) => [0, 1, u, v]
  });
  // The woody button, whose top is where the stalk joins it and snaps, `buttonHeight` over the center.
  const base = getRindHeight(0, 1) - 0.01;
  const buttonLength = HERO_FRUIT_TABLE.buttonHeight / ORANGE_TABLE.radius - base - 0.002;
  const stub = createGridMesh({
    columns: 48,
    rows: 18,
    wrap: true,
    flip: false,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const length = buttonLength;
      const wobble = 1 + 0.1 * Math.sin(3 * theta + 1) + 0.05 * Math.sin(7 * theta);
      const radius = 0.025 * wobble;
      if (v < 0.8) {
        const along = v / 0.8;
        const flare = radius * (1 + 0.45 * (1 - along) ** 3);
        return [flare * Math.cos(theta), flare * Math.sin(theta), base + length * along];
      }
      const inward = (1 - v) / 0.2;
      return [
        radius * inward * Math.cos(theta),
        radius * inward * Math.sin(theta),
        base + length + 0.002 * inward
      ];
    },
    getDetails: (u, v) => [0, 2, u, v]
  });
  return mergeMeshes([star, stub]);
}

/**
 * The stalk the fruit hangs by, in its own space: v from 0 at the button to 1 at the twig, around it a
 * unit ring, with an end cap at the button for when it has broken there. Details: u around, v along, 0
 * for the side or 1 for the broken end, and how far toward the end's middle.
 */
function createStalkMesh(): PropMesh {
  const {columns, rows} = STALK;
  const side = createGridMesh({
    columns,
    rows,
    wrap: true,
    getPoint: (u, v) => [Math.cos(u * TWO_PI), Math.sin(u * TWO_PI), v],
    getDetails: (u, v) => [u, v, 0, 0]
  });
  const end = createGridMesh({
    columns,
    rows: 3,
    wrap: true,
    flip: true,
    getPoint: (u, v) => [(1 - v) * Math.cos(u * TWO_PI), (1 - v) * Math.sin(u * TWO_PI), 0],
    getDetails: (u, v) => [u, 0, 1, v]
  });
  return mergeMeshes([side, end]);
}

/**
 * The bearing twig in its own space: around it a unit ring, v from 0 at its base to 1 at its tip, and
 * a rounded cap over the tip. Details: u around, v along, 0 for the side or 1 for the cap, and how far
 * over the cap, from its edge to its point.
 */
function createTwigMesh(): PropMesh {
  const {columns, rows, capRows} = TWIG;
  const side = createGridMesh({
    columns,
    rows,
    wrap: true,
    getPoint: (u, v) => [Math.cos(u * TWO_PI), Math.sin(u * TWO_PI), v],
    getDetails: (u, v) => [u, v, 0, 0]
  });
  const cap = createGridMesh({
    columns,
    rows: capRows,
    wrap: true,
    getPoint: (u, w) => {
      const ring = Math.cos((w * Math.PI) / 2);
      return [ring * Math.cos(u * TWO_PI), ring * Math.sin(u * TWO_PI), 1];
    },
    getDetails: (u, w) => [u, 1, 1, w]
  });
  return mergeMeshes([side, cap]);
}

/** A unit vector toward a compass bearing, dipping below level by `dip` degrees. */
function getDipVector(bearing: number, dip: number): Vec3 {
  const [x, y] = getBearingVector(bearing);
  const angle = dip * RADIANS;
  return [x * Math.cos(angle), y * Math.cos(angle), -Math.sin(angle)];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The bearing twig's radius `s` metres from its base, as the twig program tapers it between nodes. */
function getTwigRadius(s: number): number {
  const {length, junction, radius} = getBearingTwig();
  const v = Math.min(Math.max(s / length, 0), 1);
  return v < junction
    ? radius[0] + (radius[1] - radius[0]) * (v / junction)
    : radius[1] + (radius[2] - radius[1]) * ((v - junction) / (1 - junction));
}

/** Half a leaf's width over its width, a share `s` of the way along its blade from its base. */
function getBladeHalfWidth(s: number): number {
  // Widest a little below the middle, rounded into its petiole, and drawn out to an acute tip.
  const peak = 0.72 / 1.8;
  const top = peak ** 0.72 * (1 - peak) ** 1.08;
  return (0.5 * (Math.max(s, 0) ** 0.72 * Math.max(1 - s, 0) ** 1.08)) / top;
}

/**
 * Where the leaves on the bearing twig are, in the world: for each, the foot of its petiole on the
 * twig, the way its blade points, its upper side, and the other way across it.
 */
export function getTwigLeafFrames(): {foot: Vec3; along: Vec3; across: Vec3; up: Vec3}[] {
  const twig = getBearingTwig();
  return TWIG_LEAVES.map(leaf => {
    const s = twig.junction * twig.length - leaf.at;
    const onAxis: Vec3 = [
      twig.base[0] + twig.along[0] * s,
      twig.base[1] + twig.along[1] * s,
      twig.base[2] + twig.along[2] * s
    ];
    const along = getDipVector(leaf.bearing, leaf.dip);
    const share = dot(along, twig.along);
    const out = normalize([
      along[0] - twig.along[0] * share,
      along[1] - twig.along[1] * share,
      along[2] - twig.along[2] * share
    ]);
    const radius = getTwigRadius(s) * 0.8;
    const foot: Vec3 = [
      onAxis[0] + out[0] * radius,
      onAxis[1] + out[1] * radius,
      onAxis[2] + out[2] * radius
    ];
    const facing = dot(LEAF_FACING, along);
    const turned = normalize([
      LEAF_FACING[0] - along[0] * facing,
      LEAF_FACING[1] - along[1] * facing,
      LEAF_FACING[2] - along[2] * facing
    ]);
    const up = rotateVector(getQuatFromAxisAngle(along, leaf.roll * RADIANS), turned);
    return {foot, along, across: cross(up, along), up};
  });
}

/**
 * The leaves on the bearing twig, in the world, as one mesh, each folded a little along its midrib,
 * arched and with a waving edge. Details: along it from its petiole's foot (0) to its tip (1), across
 * it from one edge (-1) to the other (1), which leaf, and 0.
 */
function createTwigLeafMesh(): PropMesh {
  const {petiole, wing, foldDegrees, arch, wave} = LEAF_SHAPE;
  const fold = Math.tan(foldDegrees * RADIANS);
  const frames = getTwigLeafFrames();
  const meshes = TWIG_LEAVES.map(({length, width}, index) => {
    const {foot, along, across, up} = frames[index];
    return createGridMesh({
      columns: 36,
      rows: 14,
      getPoint: (u, v) => {
        const side = 2 * v - 1;
        const blade = (u - petiole) / (1 - petiole);
        const wings =
          wing *
          0.5 *
          (0.5 + 0.5 * Math.min(u / petiole, 1)) *
          (1 - smoothstep(petiole, petiole + 0.14, u));
        const half = width * (wings + (blade > 0 ? getBladeHalfWidth(blade) : 0));
        const x = u * length;
        const y = side * half;
        const z =
          Math.abs(y) * fold -
          arch * length * u * u +
          wave * Math.sin(u * 23 + index * 1.7) * side * side;
        return [
          foot[0] + along[0] * x + across[0] * y + up[0] * z,
          foot[1] + along[1] * x + across[1] * y + up[1] * z,
          foot[2] + along[2] * x + across[2] * y + up[2] * z
        ];
      },
      getDetails: (u, v) => [u, 2 * v - 1, index, 0]
    });
  });
  return mergeMeshes(meshes);
}

/** A disc of cut face at z = 0, looking along `-side` z. Details: where on an unwarped disc. */
function createFaceMesh(side: 1 | -1): PropMesh {
  const {fillet} = SHAPE;
  const {columns, rows} = FACE;
  return createGridMesh({
    columns,
    rows,
    wrap: true,
    flip: side < 0,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const x = Math.cos(theta);
      const y = Math.sin(theta);
      const radius = v * getLump(x, y, 0) * (1 - fillet);
      return [radius * x, radius * y, 0];
    },
    getDetails: (u, v) => {
      const theta = u * TWO_PI;
      return [Math.cos(theta) * v, Math.sin(theta) * v, 0, 0];
    }
  });
}

/** The walls between segments, as angles from 0 to 2 pi, from stable hashes. */
function getWallAngles(): number[] {
  const widths = Array.from(
    {length: FACE.segments},
    (_, index) => 1 + FACE.widthSpread * (hash01(index, 91) - 0.5)
  );
  const total = widths.reduce((sum, width) => sum + width, 0);
  const walls = [0];
  for (const width of widths) walls.push(walls[walls.length - 1] + (width / total) * TWO_PI);
  walls[walls.length - 1] = TWO_PI;
  return walls;
}

function floatLiteral(value: number): string {
  const text = value.toFixed(5);
  return text.includes('.') ? text : `${text}.0`;
}

const PART_DIRECTION: Vec3 = (() => {
  const [x, y] = getBearingVector(ORANGE_TABLE.partBearing);
  return [x, y, 0];
})();
const FRUIT_ROTATION = getQuatFromTo(UP, PART_DIRECTION);
/** Each half's rotation before it moves, from which it carries fruit space on with it. */
const HALF_START: [Quat, Quat] = [
  getQuatFromTo(UP, [-PART_DIRECTION[0], -PART_DIRECTION[1], 0]),
  getQuatFromTo(UP, PART_DIRECTION)
];

/** A half's turn out of fruit space, at this moment. */
function getHalfTurn(rotation: Quat, index: number): Quat {
  return multiplyQuat(rotation, multiplyQuat(getConjugate(HALF_START[index]), FRUIT_ROTATION));
}

/**
 * Where the seed on half A lies on its face, in fruit units, for its socket. Half A's story frame and
 * fruit space differ by a turn fixed from the start.
 */
const SEED_SOCKET: readonly number[] = (() => {
  const fromStory = multiplyQuat(getConjugate(FRUIT_ROTATION), HALF_START[0]);
  const [x, y] = rotateVector(fromStory, [
    SEED_TABLE.faceOffset[0] / ORANGE_TABLE.radius,
    SEED_TABLE.faceOffset[1] / ORANGE_TABLE.radius,
    0
  ]);
  // The seed lies along a line fixed in the world, which sets its socket once the half has settled.
  const {rollDegrees, faceTiltDegrees, towardCameraBearing} = ORANGE_TABLE;
  const facing: Vec3 = [-PART_DIRECTION[0], -PART_DIRECTION[1], 0];
  const [towardX, towardY] = getBearingVector(towardCameraBearing);
  const rolled = multiplyQuat(
    getQuatFromAxisAngle(cross(facing, UP), (rollDegrees * Math.PI) / 180),
    HALF_START[0]
  );
  const settled = multiplyQuat(
    getQuatFromAxisAngle(cross(UP, [towardX, towardY, 0]), (faceTiltDegrees * Math.PI) / 180),
    rolled
  );
  const toFruit = getConjugate(getHalfTurn(settled, 0));
  const [lyingX, lyingY, lyingZ] = SEED_TABLE.lyingAxis;
  // A quarter turn about the axis takes the seed's point, along +z, to here.
  const point = rotateVector(toFruit, [lyingY, -lyingX, lyingZ]);
  return [x, y, Math.atan2(point[1], point[0]), 0.135];
})();

function getSeedList(seeds: readonly (readonly number[])[], last?: readonly number[]): string {
  const padded = seeds.map(([x, y, length]) => [x, y, Math.atan2(y, x) + Math.PI, length]);
  while (padded.length < 3) padded.push([9, 9, 0, 0.01]);
  padded.push(last ? [...last] : [9, 9, 0, 0.01]);
  const items = padded.map(
    ([x, y, turn, length]) =>
      `vec4(${floatLiteral(x)}, ${floatLiteral(y)}, ${floatLiteral(turn)}, ${floatLiteral(length)})`
  );
  return `vec4[4](${items.join(', ')})`;
}

const ORANGE_VERTEX_HEAD = /* glsl */ `
in vec3 positions;
in vec3 normals;
in vec4 details;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out vec3 vFruit;
out vec3 vFruitNormal;
out vec4 vDetail;
out float vHeight;
${PROP_VERTEX_CHUNK}
`;

const ORANGE_FRAGMENT_HEAD = /* glsl */ `
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec3 vFruit;
in vec3 vFruitNormal;
in vec4 vDetail;
in float vHeight;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
`;

/**
 * The rind of a half, with calyx and button on half A. `shape` is the squash along world z, the land's
 * height under the fruit, and how much of the sky the hero's skirt keeps from it.
 */
const RIND_PROGRAM: PropProgram = {
  name: 'orangeRind',
  fields: ['center', 'turn', 'look', 'shape'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-rind-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float open = orangeRind.look.z;
  float rim = details.x * details.x * open;
  vec3 fruit = positions;
  fruit.xy *= 1.0 - ${floatLiteral(SHAPE.fillet)} * rim;
  vec3 normal = normalize(mix(normals, vec3(0.0, 0.0, -orangeRind.look.w), rim));
  vec3 offset = propTurn(orangeRind.turn, fruit) * orangeRind.center.w;
  // Flattened against the sand as it lands, keeping its volume.
  float squash = orangeRind.shape.x;
  vec3 stretch = vec3(1.0 + 0.5 * squash, 1.0 + 0.5 * squash, 1.0 - squash);
  offset *= stretch;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(orangeRind.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normalize(propTurn(orangeRind.turn, normal) / stretch);
  vFruit = fruit;
  vFruitNormal = normal;
  vDetail = details;
  vHeight = (orangeRind.center.z + offset.z - orangeRind.shape.y) / orangeRind.center.w;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-rind-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}

// The nearest oil gland of the rind: xyz from it to p, w how far, all in cells.
vec4 rindGland(vec3 p, out float depth) {
  vec3 cell = floor(p);
  vec3 corner = cell + floor(p - cell + 0.5) - 1.0;
  vec4 nearest = vec4(0.0, 0.0, 0.0, 9.0);
  depth = 0.5;
  for (int z = 0; z < 2; z++) {
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec3 c = corner + vec3(float(x), float(y), float(z));
        float hash = propHash(c);
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

// The cuticle's crackle: how far p is from the nearest crack between cells, in cells, with the way
// across it. A crack is where the nearest cell and the next are about as near.
float rindCrackle(vec3 p, out vec3 across) {
  vec3 cell = floor(p);
  vec3 corner = cell + floor(p - cell + 0.5) - 1.0;
  float first = 9.0;
  float second = 9.0;
  vec3 firstAt = vec3(0.0);
  vec3 secondAt = vec3(0.0);
  for (int z = 0; z < 2; z++) {
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec3 c = corner + vec3(float(x), float(y), float(z));
        float hash = propHash(c + 7.7);
        vec3 at = c + 0.5 + (fract(vec3(hash * 29.0, hash * 47.0, hash * 71.0)) - 0.5) * 0.8;
        vec3 toPoint = p - at;
        float d = dot(toPoint, toPoint);
        if (d < first) {
          second = first;
          secondAt = firstAt;
          first = d;
          firstAt = at;
        } else if (d < second) {
          second = d;
          secondAt = at;
        }
      }
    }
  }
  vec3 between = secondAt - firstAt;
  float apart = max(length(between), 1e-4);
  across = between / apart;
  // Distance from p to the plane halfway between the two.
  return abs(dot(p - (firstAt + secondAt) * 0.5, across));
}

// A bead of dew at p on a surface with normal n, if there is one: how far out from its middle (0-1), or
// more than 1, and which way is out, in fruit space. Only a share of the cells has one, by how much dew.
float dewBead(vec3 p, vec3 n, float cells, float salt, float amount, float largest, out vec3 away) {
  vec3 q = p * cells + salt;
  vec3 cell = floor(q);
  vec3 corner = cell + floor(q - cell + 0.5) - 1.0;
  float best = 9.0;
  away = vec3(0.0);
  for (int z = 0; z < 2; z++) {
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        vec3 c = corner + vec3(float(x), float(y), float(z));
        float hash = propHash(c + 3.3);
        if (hash < amount) {
          vec3 jitter = fract(vec3(hash * 41.0, hash * 71.0, hash * 97.0) + 0.3);
          vec3 toPoint = q - (c + 0.5 + (jitter - 0.5) * 0.5);
          vec3 flat_ = toPoint - n * dot(toPoint, n);
          float size = largest * mix(0.45, 1.0, pow(fract(hash * 53.0), 2.0));
          float out_ = length(flat_) / size;
          if (out_ < best) {
            best = out_;
            away = flat_ / max(length(flat_), 1e-5);
          }
        }
      }
    }
  }
  return best;
}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 p = vFruit;
  vec3 n = normalize(vFruitNormal);
  vec4 turn = orangeRind.turn;
  float radius = orangeRind.center.w;
  float side = orangeRind.look.w;
  vec3 view = normalize(vCamera - vPosition);
  vec3 smoothNormal = normalize(vNormal);
  float part = vDetail.y;
  float footprint = length(fwidth(p));

  vec3 albedo;
  vec3 tilt = vec3(0.0);
  float occlusion = 1.0;
  float shininess = 150.0;
  float wax = 1.0;
  float broad = 0.55;
  vec3 wrap = vec3(0.34, 0.2, 0.1);

  float polar = length(p.xy);
  // How close to each end of the axis.
  float stemEnd = p.z > 0.0 ? 1.0 - smoothstep(0.06, 0.5, polar) : 0.0;
  float navelEnd = p.z < 0.0 ? 1.0 - smoothstep(0.02, 0.26, polar) : 0.0;

  if (part < 0.5) {
    // Deep orange, never one color: broad clouds, pale flecks, and a little green left at the stem end.
    float cloud = propFbm(p * 2.4 + 3.1);
    float mottle = propFbm(p * 9.7 + 11.3);
    albedo = mix(vec3(0.84, 0.225, 0.008), vec3(0.93, 0.3, 0.012), smoothstep(0.25, 0.75, cloud));
    albedo *= mix(0.94, 1.05, mottle);
    albedo = mix(albedo, vec3(0.95, 0.42, 0.03), smoothstep(0.58, 0.82, propFbm(p * 22.0 + 7.0)) * 0.22);
    albedo = mix(albedo, vec3(0.68, 0.34, 0.022), stemEnd * stemEnd * 0.5);
    // A rub of wind scar here and there, and small brown marks.
    float rub = smoothstep(0.71, 0.8, propFbm(p * vec3(5.5, 12.0, 7.5) + 41.0));
    albedo = mix(albedo, albedo * vec3(1.02, 1.12, 1.25) + vec3(0.05, 0.05, 0.03), rub * 0.45);
    // 1 once a pixel is a few tens of micrometres, as when the rind fills the frame, else 0.
    float macro = 1.0 - smoothstep(0.0009, 0.0025, footprint);
    float speck = smoothstep(0.84, 0.9, propNoise(p * 58.0 + 19.0)) * smoothstep(0.62, 0.74, propNoise(p * 6.0 + 2.0));
    // A perfect fruit close to has none: what reads as a fleck from off is, at this size, the rind's own grain.
    speck *= 1.0 - macro;
    albedo = mix(albedo, vec3(0.26, 0.11, 0.03), speck * 0.6);

    // Oil glands: small pits, closely packed, each its own depth, which break the highlight up. Over a
    // soft cushion to the next, so nowhere on the rind is flat.
    const float cells = 41.0;
    float shown = 1.0 - smoothstep(0.35, 1.0, footprint * cells);
    if (shown > 0.0) {
      float depth;
      vec4 gland = rindGland(p * cells + 17.0 * side, depth);
      float pit = clamp(gland.w / (0.2 + 0.2 * depth), 0.0, 1.0);
      float slope = 4.0 * pit * (1.0 - pit);
      vec3 toGland = gland.w > 1e-4 ? gland.xyz / gland.w : vec3(0.0);
      float cushion = gland.w * (1.0 - smoothstep(0.3, 0.68, gland.w));
      tilt += toGland * (slope * 0.34 * depth + cushion * 0.34) * shown;
      float cavity = (1.0 - pit) * (1.0 - pit) * depth;
      // Close to, each is a shallow dimple, only a little darker than the rind's own orange, catching light
      // on its lip; between them the oil glands stand as translucent bumps, the light glowing in them.
      albedo *= 1.0 - (0.17 - 0.06 * macro) * cavity * shown;
      occlusion *= 1.0 - (0.26 - 0.1 * macro) * cavity * shown;
      albedo *= 1.0 + 0.1 * macro * smoothstep(0.7, 0.95, pit) * (1.0 - smoothstep(0.95, 1.0, pit)) * depth;
      float bump = smoothstep(0.38, 0.62, gland.w) * (1.0 - smoothstep(0.74, 0.98, gland.w));
      albedo = mix(albedo, albedo * vec3(1.1, 1.06, 0.82) + vec3(0.03, 0.01, 0.0), bump * macro * shown * 0.55);

      // Between them, smaller pits.
      float fineShown = 1.0 - smoothstep(0.35, 1.0, footprint * cells * 2.3);
      if (fineShown > 0.0) {
        float fineDepth;
        vec4 fine = rindGland(p * cells * 2.3 + 5.0, fineDepth);
        float finePit = clamp(fine.w / 0.3, 0.0, 1.0);
        vec3 toFine = fine.w > 1e-4 ? fine.xyz / fine.w : vec3(0.0);
        tilt += toFine * 4.0 * finePit * (1.0 - finePit) * (0.09 + 0.08 * macro) * fineDepth * fineShown;
        albedo *= 1.0 - (0.1 - 0.03 * macro) * (1.0 - finePit) * (1.0 - finePit) * fineDepth * fineShown;

        // Only once the rind fills the frame, at some tens of micrometres a pixel: a third octave of pits,
        // the cells of the gland walls, and the cuticle's crackle and wax bloom.
        float finestShown = 1.0 - smoothstep(0.35, 1.0, footprint * cells * 5.3);
        if (finestShown > 0.0) {
          float finestDepth;
          vec4 finest = rindGland(p * cells * 5.3 + 11.0, finestDepth);
          float finestPit = clamp(finest.w / 0.32, 0.0, 1.0);
          vec3 toFinest = finest.w > 1e-4 ? finest.xyz / finest.w : vec3(0.0);
          tilt += toFinest * 4.0 * finestPit * (1.0 - finestPit) * 0.13 * finestDepth * finestShown;
          albedo *= 1.0 - 0.09 * (1.0 - finestPit) * (1.0 - finestPit) * finestDepth * finestShown;
          // A gland's wall is not smooth: its cells show on it, most where it is steepest, each its own
          // shade.
          float wallShown = finestShown * (1.0 - smoothstep(0.3, 0.8, footprint * 700.0));
          if (wallShown > 0.0) {
            vec3 q = p * 700.0;
            float w0 = propNoise(q);
            vec3 cellTilt = vec3(propNoise(q + vec3(0.35, 0.0, 0.0)) - w0, propNoise(q + vec3(0.0, 0.35, 0.0)) - w0, propNoise(q + vec3(0.0, 0.0, 0.35)) - w0);
            tilt += cellTilt * (0.14 + 0.6 * slope) * wallShown;
            albedo *= 1.0 + (w0 - 0.5) * 0.14 * wallShown;
          }
          float crackShown = finestShown * (1.0 - smoothstep(0.25, 0.6, footprint * 640.0));
          if (crackShown > 0.0) {
            vec3 across;
            float crack = rindCrackle(p * 640.0 + 3.0 * side, across);
            float line = 1.0 - smoothstep(0.02, 0.09, crack);
            tilt += across * sign(crack - 0.04) * line * 0.1 * crackShown;
            albedo *= 1.0 - 0.16 * line * crackShown;
            wax *= 1.0 - 0.4 * line * crackShown;
          }
          float bloomShown = finestShown * (1.0 - smoothstep(0.3, 0.7, footprint * 1300.0));
          if (bloomShown > 0.0) {
            // Wax bloom: a pale, dull frost of platelets that scatters the highlight.
            float bloom = smoothstep(0.45, 0.85, propNoise(p * 1300.0 + 5.0)) * smoothstep(0.35, 0.65, propFbm(p * 60.0 + 9.0));
            albedo = mix(albedo, albedo + vec3(0.035, 0.03, 0.026), bloom * bloomShown);
            shininess = mix(shininess, shininess * 0.55, bloom * bloomShown);
          }
        }
      }
    }
    // The slow swells of a real fruit's surface, which bend a highlight along its length.
    tilt += vec3(
      sin(p.y * 13.0 + 1.0) + sin(p.z * 8.0 + 2.0) * 0.6,
      sin(p.z * 11.0 + 3.0) + sin(p.x * 14.0 + 5.0) * 0.6,
      sin(p.x * 9.0 + 4.0) + sin(p.y * 7.0 + 6.0) * 0.6
    ) * 0.012;
    float grainShown = 1.0 - smoothstep(0.1, 0.5, footprint * 190.0);
    if (grainShown > 0.0) {
      vec3 q = p * 190.0;
      float g0 = propNoise(q);
      tilt += vec3(propNoise(q + vec3(0.3, 0.0, 0.0)) - g0, propNoise(q + vec3(0.0, 0.3, 0.0)) - g0, propNoise(q + vec3(0.0, 0.0, 0.3)) - g0) * 0.2 * grainShown;
    }
    shininess = mix(shininess * 0.35, shininess, shown);

    // The stem end's radial puckers, and the navel: a small puckered scar.
    if (stemEnd > 0.0) {
      float angle = atan(p.y, p.x);
      tilt += vec3(-sin(angle), cos(angle), 0.0) * cos(angle * 17.0 + 1.3) * 0.05 * stemEnd * (1.0 - smoothstep(0.1, 0.34, polar));
    }
    if (navelEnd > 0.0) {
      float angle = atan(p.y, p.x);
      float pucker = cos(angle * 13.0 + 7.0 * polar);
      tilt += vec3(-sin(angle), cos(angle), 0.0) * pucker * 0.2 * navelEnd * smoothstep(0.015, 0.05, polar);
      float scar = 1.0 - smoothstep(0.018, 0.05, polar + 0.012 * pucker);
      albedo = mix(albedo, vec3(0.22, 0.13, 0.06) * (0.7 + 0.6 * propNoise(p * 90.0)), scar);
      occlusion *= mix(1.0, 0.55, navelEnd);
      wax *= 1.0 - 0.8 * scar;
    }
  } else if (part < 1.5) {
    // Sepals: dry, leathery green going to tan at the tips.
    float tip = vDetail.w;
    float cloud = propFbm(p * 60.0);
    albedo = mix(vec3(0.09, 0.135, 0.03), vec3(0.22, 0.24, 0.08), cloud);
    albedo = mix(albedo, vec3(0.32, 0.22, 0.09), smoothstep(0.55, 1.0, tip) * (0.5 + 0.5 * cloud));
    tilt += (vec3(propNoise(p * 130.0), propNoise(p * 130.0 + 5.0), propNoise(p * 130.0 + 9.0)) - 0.5) * 0.35;
    shininess = 24.0;
    wax = 0.35;
    broad = 0.4;
    wrap = vec3(0.12);
    occlusion *= 0.85;
  } else {
    // A cut stem: woody, pale on the cut.
    float cap = smoothstep(0.78, 0.84, vDetail.w);
    float grain = propNoise(vec3(atan(p.y, p.x) * 8.0, p.z * 30.0, 2.0));
    albedo = mix(vec3(0.16, 0.14, 0.06), vec3(0.27, 0.2, 0.1), grain);
    albedo = mix(albedo, vec3(0.5, 0.4, 0.24) * (0.75 + 0.5 * propNoise(p * 200.0)), cap);
    shininess = 16.0;
    wax = 0.2;
    broad = 0.3;
    wrap = vec3(0.1);
  }

  // Dew: beads of two sizes, standing on the rind.
  vec3 beadAway = vec3(0.0);
  float beadOut = 9.0;
  float dew = orangeRind.look.x * (part < 0.5 ? 1.0 : 0.0);
  if (dew > 0.0 && footprint < 0.02) {
    vec3 away;
    // It lies thicker in some places than others, as wiped by what the fruit brushed against.
    float lies = smoothstep(0.32, 0.7, propFbm(p * 3.3 + 21.0));
    float big = dewBead(p, n, 15.0, 2.0 + side * 3.0, dew * 0.085 * lies, 0.26, away);
    beadOut = big;
    beadAway = away;
    float small = dewBead(p, n, 36.0, 9.0, dew * 0.2 * lies, 0.24, away);
    if (small < beadOut) {
      beadOut = small;
      beadAway = away;
    }
    // Close to, the mist between them: beads of a tenth to half a millimetre.
    if (footprint < 0.004) {
      float shownFine = 1.0 - smoothstep(0.0016, 0.004, footprint);
      float mist = dewBead(p, n, 56.0, 13.0, dew * 0.3 * shownFine, 0.28, away);
      if (mist < beadOut) {
        beadOut = mist;
        beadAway = away;
      }
      float finest = dewBead(p, n, 92.0, 17.0, dew * 0.34 * shownFine * (0.4 + 0.6 * lies), 0.26, away);
      if (finest < beadOut) {
        beadOut = finest;
        beadAway = away;
      }
    }
  }

  vec3 surfaceNormal = normalize(n - (tilt - n * dot(tilt, n)));
  vec3 normal = propTurn(turn, surfaceNormal);

  // Light. On the far side of a convex body a shadow is its own, so the bias reaches past the whole fruit.
  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  float keyFacing = dot(smoothNormal, toKey);
  propShadowNormal = keyFacing > 0.02 ? smoothNormal : vec3(0.0);
  propShadowSoft = 0.0012;
  float bias = radius * (0.015 + 2.1 * max(-keyFacing, 0.0));
  propLights(normal, view, wrap, shininess, wax, broad, 0.0, bias);

  // The ground takes the sky away from what is low and faces down, close to where it touches.
  float near = smoothstep(-0.4, 0.9, normal.z + vHeight * 0.9);
  occlusion *= mix(0.42, 1.0, near);
  // Under the tree's skirt, the leaves above keep some of the sky from what faces up.
  occlusion *= 1.0 - orangeRind.shape.z * smoothstep(-0.5, 0.7, normal.z);
  vec3 sky = propHemisphere(normal) * occlusion;
  // The pale sand throws light back up onto what faces it, warm with what it took from the sun.
  sky += vec3(0.16, 0.135, 0.1) * max(-normal.z, 0.0) * smoothstep(0.02, 0.5, vHeight) * propLightColor(lighting.ambientColor);
  float facing = max(dot(normal, view), 0.0);
  float grazing = pow(1.0 - facing, 5.0);
  // A rind is not a mirror: what it reflects of the sky has no edge at the horizon.
  float reflectedUp = reflect(-view, normal).z;
  vec3 skyColor = propLightColor(lighting.ambientColor);
  vec3 mirrored = skyColor * mix(vec3(0.3, 0.26, 0.19), vec3(1.05, 1.08, 1.12), smoothstep(-0.85, 0.6, reflectedUp)) *
    (0.01 + 0.42 * grazing) * occlusion * wax;
  // The glare of the sky around a low sun lies on the wax in a soft sheen, broken up by the glands.
  vec3 glareAt = normalize(vec3(toKey.xy, 0.0) * 0.72 + vec3(0.0, 0.0, 0.7));
  float glareAlong = max(dot(normal, normalize(glareAt + view)), 0.0);
  vec3 glareColor = propLightColor(lighting_getDirectionalLight(0).color) * 0.5 + skyColor * 0.8;
  mirrored += glareColor * (pow(glareAlong, 90.0) * 0.16 + pow(glareAlong, 14.0) * 0.035) * occlusion * wax;
  // Light scatters in the rind and comes out more saturated than it went in.
  vec3 color = albedo * (sky * vec3(1.02, 0.88, 0.7) + gDiffuse) + gSpecular * 1.1 + mirrored;

  if (beadOut < 1.0) {
    // A bead lies over the rind like a lens: the rind shows through it, brighter and smoother, its rim is
    // dark, and it holds a point of the sun and a piece of the sky.
    float c = beadOut;
    vec3 beadNormal = propTurn(turn, normalize(n + beadAway * c / sqrt(max(1.0 - c * c, 0.06)) * 0.9));
    DirectionalLight key = lighting_getDirectionalLight(0);
    vec3 keyColor = propLightColor(key.color) * propKeyVisibility(bias) * smoothstep(-0.05, 0.2, keyFacing);
    float beadFacing = max(dot(beadNormal, view), 0.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - beadFacing, 4.0);
    vec3 outWorld = propTurn(turn, beadAway);
    vec3 flatLight = toKey - smoothNormal * dot(toKey, smoothNormal);
    float along = dot(outWorld, -normalize(flatLight + vec3(1e-5))) * c;
    float focus = smoothstep(0.1, 0.8, along);
    vec3 inner = albedo * (sky * 1.05 + gDiffuse * 0.7) + albedo * keyColor * focus * 1.8;
    inner *= mix(1.0, 0.42, smoothstep(0.62, 1.0, c));
    vec3 reflected = propSkyColor(reflect(-view, beadNormal)) * fresnel * 1.1;
    vec3 halfway = normalize(toKey + view);
    float glintAlong = max(dot(beadNormal, halfway), 0.0);
    vec3 glint = keyColor * (pow(glintAlong, 320.0) * 26.0 + pow(glintAlong, 40.0) * 0.25);
    vec3 beadColor = inner + reflected + glint;
    color = mix(beadColor, color, smoothstep(0.86, 1.0, c));
  }

  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

const FACE_PROGRAM: PropProgram = {
  name: 'orangeFace',
  fields: ['center', 'turn', 'look', 'seed'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-face-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec3 offset = propTurn(orangeFace.turn, positions) * orangeFace.center.w;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(orangeFace.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = propTurn(orangeFace.turn, normals);
  vFruit = positions;
  vFruitNormal = normals;
  vDetail = details;
  vHeight = (orangeFace.center.z + offset.z - orangeFace.seed.y) / orangeFace.center.w;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-face-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}

const int SEGMENTS = ${FACE.segments};
const float WALLS[${FACE.segments + 1}] = float[${FACE.segments + 1}](${getWallAngles().map(floatLiteral).join(', ')});
const vec4 SEEDS_STEM[4] = ${getSeedList(FACE_SEEDS.stemHalf, SEED_SOCKET)};
const vec4 SEEDS_NAVEL[4] = ${getSeedList(FACE_SEEDS.navelHalf.slice(0, 3), FACE_SEEDS.navelHalf.slice(3).map(([x, y, length]) => [x, y, Math.atan2(y, x) + Math.PI, length])[0])};
const float TAU = 6.28318531;
const float FLESH_RADIUS = ${floatLiteral(FACE.fleshRadius)};
const float CORE_RADIUS = ${floatLiteral(FACE.coreRadius)};
const float MEMBRANE = ${floatLiteral(FACE.membrane)};
const float RIND_RING = ${floatLiteral(FACE.rindRing)};

float softMin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Where in the wheel of segments a point falls.
struct Cut {
  float r;
  // Angle from the middle of its segment, and that segment's half angle, and its middle.
  float along;
  float half_;
  float middle;
  float hash;
  // Metres, in radii, to the nearest wall.
  float wall;
  // Signed distance into the segment's flesh, in radii.
  float flesh;
};

Cut citrusCut(vec2 p) {
  Cut cut;
  float r = length(p);
  // The walls wander.
  float wander = (propNoise(vec3(p * 2.7, 3.3)) - 0.5) * 0.1 + (propNoise(vec3(p * 7.3, 9.1)) - 0.5) * 0.02;
  float phi = mod(atan(p.y, p.x) + wander + TAU, TAU);
  int index = SEGMENTS - 1;
  for (int k = 0; k < SEGMENTS; k++) {
    if (phi < WALLS[k + 1]) {
      index = k;
      break;
    }
  }
  float a0 = WALLS[index];
  float a1 = WALLS[index + 1];
  cut.middle = (a0 + a1) * 0.5;
  cut.half_ = (a1 - a0) * 0.5;
  cut.along = phi - cut.middle;
  cut.r = r;
  cut.hash = fract(float(index) * 0.618034 + 0.37);
  cut.wall = (cut.half_ - abs(cut.along)) * r;
  float across = cut.along / cut.half_;
  // A segment's outer wall is a shallow arc, so the pith's inner edge is scalloped.
  float outer = FLESH_RADIUS - 0.012 * (cut.hash - 0.5) - 0.05 * across * across;
  float membrane = MEMBRANE * (1.0 + 0.9 * (1.0 - smoothstep(0.1, 0.5, r)));
  float d = softMin(cut.wall - membrane, outer - r, 0.045);
  cut.flesh = softMin(d, r - CORE_RADIUS * (0.9 + 0.5 * cut.hash), 0.02);
  return cut;
}

// Juice sacs in one segment: elongated along the radius, narrow where they hang from the outer wall, in a
// staggered grid that fans out with the wedge. f1 is how far into the nearest sac, from 0 at its middle to
// 1 at its edge. f2 is the same for the next nearest. where is the point in the nearest's own coordinates,
// across and along, and info holds its hash, its half width and its half length, in radii.
void juiceSacs(Cut cut, float salt, vec2 cellSize, out float f1, out float f2, out vec2 where, out vec3 info) {
  float fan = mix(cut.r, 0.55, 0.55);
  vec2 g = vec2(cut.along * fan, cut.r) / cellSize;
  g.x += cut.hash * 13.0 + salt * 1.7;
  // They are never ruler straight.
  g.x += (propNoise(vec3(cut.along * 2.2, cut.r * 3.6, cut.hash * 17.0 + salt)) - 0.5) * 1.1;
  float column = floor(g.x);
  f1 = 9.0;
  f2 = 9.0;
  where = vec2(0.0);
  info = vec3(0.5, 0.0, 0.0);
  for (int i = -1; i <= 1; i++) {
    float cx = column + float(i);
    float stagger = propHash(vec3(cx, cut.hash * 91.0, salt)) * 3.1;
    float gy = g.y + stagger;
    float row = floor(gy);
    for (int j = -1; j <= 1; j++) {
      float cy = row + float(j);
      vec3 h = propHash3(vec3(cx, cy, cut.hash * 57.0 + salt));
      vec2 center = vec2(cx + 0.5 + (h.x - 0.5) * 0.52, cy + 0.5 + (h.y - 0.5) * 0.7);
      vec2 d = vec2(g.x - center.x, gy - center.y);
      float halfLength = mix(0.7, 1.12, h.z);
      float v = d.y / halfLength;
      // Thin toward the outer wall, where it hangs.
      float halfWidth = mix(0.5, 0.86, fract(h.z * 7.3)) * mix(1.12, 0.58, smoothstep(-1.0, 1.0, v));
      float u = (d.x - v * (h.x - 0.5) * 0.34) / halfWidth;
      float s = sqrt(u * u + v * v);
      if (s < f1) {
        f2 = f1;
        f1 = s;
        where = vec2(u, v);
        info = vec3(fract(h.z * 3.7 + h.x), halfWidth * cellSize.x, halfLength * cellSize.y);
      } else if (s < f2) {
        f2 = s;
      }
    }
  }
}

// What light is left after crossing the fruit from where it entered to this point on the face.
vec3 throughFlesh(vec3 point, vec3 light, out float path) {
  float b = dot(point, light);
  float c = dot(point, point) - 1.0;
  path = max(-b + sqrt(max(b * b - c, 0.0)), 0.0);
  return exp(-path * vec3(1.15, 4.2, 12.0));
}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec2 p = vDetail.xy;
  vec4 turn = orangeFace.turn;
  float juice = orangeFace.look.x;
  float open = orangeFace.look.y;
  float side = orangeFace.look.z;
  float salt = orangeFace.look.w;
  float radius = orangeFace.center.w;
  vec3 faceNormal = vec3(0.0, 0.0, -side);
  vec3 view = normalize(vCamera - vPosition);
  // The view in fruit space, for what lies a little under the surface.
  vec4 inverseTurn = vec4(-turn.xyz, turn.w);
  vec3 viewFruit = propTurn(inverseTurn, view);
  vec2 under = viewFruit.xy / max(abs(viewFruit.z), 0.2);
  float footprint = length(fwidth(p));
  // Pixels are too large to show the sacs from a distance.
  float shown = 1.0 - smoothstep(0.012, 0.03, footprint);

  Cut cut = citrusCut(p);
  float r = cut.r;
  float edge = max(footprint, 1e-4);

  // Height of the surface above the flesh, in radii, and its gradient.
  vec2 gradient = vec2(0.0);
  vec3 albedo;
  float fleshAmount = smoothstep(-edge, edge, cut.flesh);
  float pithAmount = 1.0 - fleshAmount;
  float wetness = 0.0;
  float thin = 0.0;
  vec3 flesh = vec3(0.0);
  vec2 sacTilt = vec2(0.0);
  float sacGloss = 1.0;

  // The flesh: glassy sacs of juice, fat at their inner ends and thin where they hang from the outer wall.
  float cavity = 1.0;
  if (fleshAmount > 0.0) {
    float f1, f2;
    vec2 where;
    vec3 info;
    juiceSacs(cut, salt, vec2(0.056, 0.2), f1, f2, where, info);
    float inner1 = min(f1, 1.0);
    float cap = sqrt(max(1.0 - inner1 * inner1, 0.0));
    vec2 er = p / max(r, 1e-4);
    vec2 et = vec2(-er.y, er.x);
    float lean = 1.0 / max(cap, 0.3);
    float hue = info.x;
    float other = fract(hue * 5.3);
    vec2 slope = vec2(where.x * 0.7, where.y * 0.14) * lean;
    sacTilt = (et * (slope.x + (hue - 0.5) * 0.16) + er * (slope.y + (other - 0.5) * 0.1)) * shown;
    // Each segment bulges a little, so each catches the light its own way.
    float across = cut.along / cut.half_;
    sacTilt += et * across * 0.05 + er * ((r - 0.5) * 0.07 + (cut.hash - 0.5) * 0.04);
    float seamWidth = max(0.2, fwidth(f2 - f1) * 1.4);
    float seam = 1.0 - smoothstep(0.0, seamWidth, f2 - f1);
    float inSac = smoothstep(1.05, 0.7, f1);

    // Under the glassy wall of a sac one sees the next ones down, in other places: darker and redder.
    float f1b, f2b;
    vec2 whereB;
    vec3 infoB;
    Cut deep = citrusCut(p - under * 0.03);
    juiceSacs(deep, salt + 7.0, vec2(0.07, 0.25), f1b, f2b, whereB, infoB);
    float deepSeam = 1.0 - smoothstep(0.0, 0.34, f2b - f1b);

    vec3 body = mix(vec3(0.85, 0.245, 0.004), vec3(0.93, 0.325, 0.007), hue);
    vec3 core = mix(vec3(0.97, 0.42, 0.014), vec3(1.0, 0.52, 0.03), other);
    vec3 crevice = vec3(0.68, 0.135, 0.003);
    flesh = mix(crevice, body, smoothstep(1.16, 0.62, f1));
    // Each sac is a lens: it gathers light along its middle, more toward its fat end.
    float axis = exp(-where.x * where.x * 5.0) * smoothstep(1.1, 0.4, abs(where.y + 0.25));
    flesh = mix(flesh, core, axis * mix(0.28, 0.85, other));
    // Fine strands inside it, along its length.
    float strand = propNoise(vec3(cut.along * mix(cut.r, 0.55, 0.55) * 190.0, r * 11.0, hue * 40.0));
    flesh *= mix(0.9, 1.08, strand * shown + 0.5 * (1.0 - shown));
    flesh *= mix(1.0, 0.86, deepSeam * (1.0 - 0.7 * cap));
    // Sacs darken softly where they meet, and a few of the walls between them are pale and glassy.
    flesh *= 1.0 - 0.12 * seam * shown;
    flesh *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.55, f2 - f1)) * shown;
    float pallid = smoothstep(0.7, 0.95, fract(hue * 11.0));
    flesh = mix(flesh, vec3(0.98, 0.56, 0.16), seam * pallid * 0.28 * shown);
    // Flesh darkens toward the walls of its segment, and pales toward the outer wall, where sacs are young.
    flesh *= mix(0.68, 1.0, smoothstep(0.0, 0.04, cut.flesh));
    flesh = mix(flesh, flesh * vec3(1.02, 1.18, 1.4) + vec3(0.0, 0.012, 0.002), smoothstep(0.76, 0.89, r) * 0.42);
    flesh *= 0.93 + 0.14 * cut.hash;
    cavity = mix(0.58, 1.0, cap) * mix(1.0, 0.85, seam);
    wetness = (0.3 + 0.7 * smoothstep(0.3, 0.62, propNoise(vec3(p * 11.0, salt)))) * inSac;
    thin = cap;
    if (shown < 1.0) {
      vec3 far = mix(vec3(0.86, 0.24, 0.007), vec3(0.95, 0.34, 0.016), propFbm(vec3(p * 18.0, salt)));
      flesh = mix(far, flesh, shown);
      cavity = mix(0.85, cavity, shown);
    }
    sacGloss = mix(0.4, 1.0, inSac);
  }

  // Pith, membranes and core: spongy and pale, with fine fibres running out.
  vec3 pith = vec3(0.0);
  if (pithAmount > 0.0) {
    float fibres = propNoise(vec3(atan(p.y, p.x) * 46.0, r * 7.0, 4.0));
    float pores = propNoise(vec3(p * 95.0, salt));
    float cloud = propFbm(vec3(p * 11.0, 2.0));
    pith = mix(vec3(0.84, 0.68, 0.38), vec3(0.95, 0.83, 0.56), cloud);
    pith *= mix(0.92, 1.04, fibres);
    pith *= mix(0.9, 1.03, smoothstep(0.25, 0.65, pores));
    // Warmer against the rind and against the flesh.
    pith = mix(pith, vec3(0.92, 0.6, 0.2), smoothstep(0.9, 0.97, r) * 0.7);
    float membraneAt = 1.0 - smoothstep(0.0, 0.02, -cut.flesh);
    pith = mix(pith, vec3(0.97, 0.7, 0.3), membraneAt * 0.6);
    // A hairline where two segments' walls meet.
    float line = 1.0 - smoothstep(0.0, max(edge * 1.5, 0.0012), cut.wall);
    pith = mix(pith, vec3(0.42, 0.2, 0.07), line * 0.55 * smoothstep(0.82, 0.3, r));
    // The core is the same sponge, with a small hollow in its middle.
    float core = 1.0 - smoothstep(CORE_RADIUS, CORE_RADIUS * 1.5, r);
    pith = mix(pith, vec3(0.94, 0.83, 0.58) * mix(0.8, 1.05, pores), core);
    float hollow = 1.0 - smoothstep(0.008, 0.022, r + 0.01 * (fibres - 0.5));
    pith = mix(pith, vec3(0.2, 0.11, 0.05), hollow);
  }
  albedo = mix(pith, flesh, fleshAmount);

  // The edge of a segment stands a little proud, and its flesh is sunken just inside it.
  float rise = 0.0065 * (1.0 - smoothstep(0.0, 0.035, cut.flesh));
  gradient = vec2(0.0);
  {
    const float eps = 0.006;
    float fx = citrusCut(p + vec2(eps, 0.0)).flesh;
    float fy = citrusCut(p + vec2(0.0, eps)).flesh;
    vec2 g = (vec2(fx, fy) - cut.flesh) / eps;
    float near = 1.0 - smoothstep(0.0, 0.035, cut.flesh);
    gradient = -g * near * smoothstep(-0.025, 0.0, cut.flesh) * 0.22;
  }

  // The colored ring of rind, with oil sacs cut across.
  float rimAt = (1.0 - r) / RIND_RING;
  float ring = 1.0 - smoothstep(1.0 - edge / RIND_RING, 1.0 + edge / RIND_RING, rimAt);
  if (ring > 0.0) {
    float wobble = propNoise(vec3(atan(p.y, p.x) * 34.0, 1.0, 5.0));
    vec3 rindColor = mix(vec3(0.74, 0.19, 0.008), vec3(0.92, 0.5, 0.09), smoothstep(0.25, 1.0, rimAt));
    rindColor *= mix(0.9, 1.05, wobble);
    float sacs = propNoise(vec3(p * 90.0, 8.0));
    rindColor = mix(rindColor, vec3(0.98, 0.55, 0.1), smoothstep(0.66, 0.84, sacs) * smoothstep(0.8, 0.2, rimAt) * 0.32);
    albedo = mix(albedo, rindColor, ring);
    fleshAmount *= 1.0 - ring;
  }

  // Seeds in sockets.
  vec3 seedTilt = vec3(0.0);
  float seedAmount = 0.0;
  float socketDark = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 seed = side > 0.0 ? SEEDS_STEM[i] : SEEDS_NAVEL[i];
    vec2 toSeed = p - seed.xy;
    if (dot(toSeed, toSeed) < seed.w * seed.w * 2.3) {
      float c = cos(seed.z);
      float s = sin(seed.z);
      vec2 q = vec2(c * toSeed.x + s * toSeed.y, -s * toSeed.x + c * toSeed.y);
      float lengthAlong = q.x / seed.w;
      // Pointed toward its head.
      float width = seed.w * 0.56 * mix(1.08, 0.72, smoothstep(-1.0, 1.0, lengthAlong));
      vec2 e = vec2(lengthAlong, q.y / width);
      float s2 = length(e);
      socketDark *= mix(0.5, 1.0, smoothstep(0.96, 1.36, s2));
      float inSeed = smoothstep(1.0, 0.96 - edge / seed.w, s2);
      // The seed that flies has its own mesh. Under it, and after it has gone, a wet hollow.
      if (i == 3 && side > 0.0 && orangeFace.seed.x > 0.5) {
        albedo = mix(albedo, vec3(0.86, 0.36, 0.06) * mix(0.62, 0.9, s2), inSeed);
        socketDark *= mix(0.78, 1.0, smoothstep(0.55, 1.05, s2));
      } else if (inSeed > 0.0) {
        float dome = sqrt(max(1.0 - s2 * s2, 0.05));
        vec2 slopes = vec2(e.x / seed.w, e.y / width) * seed.w * 0.45 / dome;
        vec2 worldSlope = vec2(c * slopes.x - s * slopes.y, s * slopes.x + c * slopes.y);
        seedTilt = vec3(worldSlope, 0.0);
        float ridges = propNoise(vec3(q.x * 14.0, q.y * 150.0, float(i)));
        vec3 seedColor = mix(vec3(0.74, 0.57, 0.27), vec3(0.88, 0.73, 0.42), ridges);
        seedColor = mix(seedColor, vec3(0.62, 0.42, 0.2), smoothstep(-0.65, -1.0, e.x) * 0.55);
        albedo = mix(albedo, seedColor, inSeed);
        seedAmount = max(seedAmount, inSeed);
      }
    }
  }
  albedo *= socketDark;
  fleshAmount *= 1.0 - seedAmount;

  // A film of juice lies over the sacs, with its own small ripples, which scatter the highlights.
  float rippleShown = shown * fleshAmount;
  vec2 ripple = vec2(0.0);
  if (rippleShown > 0.0) {
    vec3 q = vec3(p * 62.0, salt);
    float r0 = propNoise(q);
    ripple = vec2(propNoise(q + vec3(0.35, 0.0, 0.0)) - r0, propNoise(q + vec3(0.0, 0.35, 0.0)) - r0) * 0.75 * rippleShown;
  }
  vec2 tiltFace = gradient + sacTilt * fleshAmount;
  vec3 fruitNormal = normalize(vec3(-tiltFace - seedTilt.xy * seedAmount, faceNormal.z));
  vec3 filmNormal = normalize(vec3(-tiltFace * 0.8 - ripple - seedTilt.xy * seedAmount, faceNormal.z));
  vec3 normal = propTurn(turn, fruitNormal);
  vec3 film = propTurn(turn, filmNormal);
  vec3 smoothNormal = normalize(vNormal);

  // Light from the key falls on the face, if it is on the face's side.
  DirectionalLight key = lighting_getDirectionalLight(0);
  vec3 toKey = normalize(-key.direction);
  vec3 keyFruit = propTurn(inverseTurn, toKey);
  float keyFacing = dot(faceNormal, keyFruit);
  vec3 point = vec3(p, 0.0);
  float path;
  vec3 passed = throughFlesh(point, keyFruit, path);
  propShadowNormal = keyFacing > 0.06 ? smoothNormal : vec3(0.0);
  propShadowSoft = 0.0012;
  float keyBias = keyFacing > 0.06 ? radius * 0.01 : radius * (path + 0.05);
  float wet = juice * mix(0.25, 1.0, wetness * fleshAmount) * mix(0.3, 1.0, fleshAmount + seedAmount * 0.5);
  vec3 wrap = mix(vec3(0.3, 0.26, 0.2), vec3(0.8, 0.55, 0.3), fleshAmount);
  propLights(film, view, wrap, 260.0, 0.1 + 2.2 * wet, 0.35, 0.0, keyBias);

  // Light that came in through the rind and crossed the flesh: orange deepening to red with the distance.
  float behind = 1.0 - smoothstep(-0.05, 0.14, keyFacing);
  vec3 keyColor = propLightColor(key.color);
  float keyVisible = propKeyVisibility(radius * (path + 0.05));
  float glowShape = mix(0.3, 1.0, thin * fleshAmount);
  vec3 through = keyColor * passed * behind * keyVisible * glowShape;
  through *= mix(vec3(0.75, 0.62, 0.46), vec3(1.0, 0.82, 0.6), fleshAmount);

  float occlusion = open * mix(1.0, cavity, fleshAmount);
  vec3 sky = propHemisphere(normal) * occlusion;
  // A wet surface mirrors the sky, and the brightest of it is around a low sun.
  float filmFacing = max(dot(film, view), 0.0);
  float grazing = pow(1.0 - filmFacing, 3.0);
  vec3 reflectedRay = reflect(-view, film);
  float toSun = max(dot(reflectedRay, toKey), 0.0);
  vec3 reflected = propSkyColor(reflectedRay) * 1.2 +
    keyColor * keyVisible * (pow(toSun, 5.0) * 0.5 + pow(toSun, 40.0) * 2.4);
  vec3 mirrored = reflected * (0.045 + 0.8 * grazing) * occlusion * wet * sacGloss;
  // The glare of the sky around a low sun, as a broad soft light, is what a wet surface looks wet by.
  vec3 glareAt = normalize(vec3(toKey.xy, 0.0) * 0.72 + vec3(0.0, 0.0, 0.7));
  float glareAlong = max(dot(film, normalize(glareAt + view)), 0.0);
  vec3 glareColor = keyColor * 0.5 + propLightColor(lighting.ambientColor) * 0.8;
  mirrored += glareColor * (pow(glareAlong, 300.0) * 1.05 + pow(glareAlong, 32.0) * 0.03) * occlusion * wet * sacGloss;
  // What scatters in the flesh comes out more saturated than it went in.
  vec3 saturating = mix(vec3(1.0), vec3(1.03, 0.96, 0.62), fleshAmount);
  vec3 color = albedo * (sky * saturating + gDiffuse * open) +
    albedo * through * 1.05 * open +
    gSpecular * open * mix(0.5, 1.4, wet) +
    mirrored;

  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** A dark disc in the gap as the halves first part, so the slit shows no daylight through the fruit. */
const PLUG_PROGRAM: PropProgram = {
  name: 'orangePlug',
  ignoresShadow: true,
  fields: ['center', 'turn', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-plug-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec3 offset = propTurn(orangePlug.turn, positions) * orangePlug.center.w * orangePlug.look.x;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(orangePlug.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = vec3(0.0, 0.0, 1.0);
  vFruit = positions;
  vFruitNormal = normals;
  vDetail = details;
  vHeight = 0.0;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-plug-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  fragColor = vec4(propFilmic(vec3(0.012, 0.0035, 0.001) + propHemisphere(vec3(0.0, 0.0, 1.0)) * vec3(0.02, 0.005, 0.0)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * The stalk: from `bottom`, the top of the fruit's button or where it broke off it, to `top` on its twig,
 * with its radius at each end in w. It bows a little toward `bow.xyz`, by `bow.w` of its length. `look.x`
 * is 1 once it has broken, which shows its torn end.
 */
const STALK_PROGRAM: PropProgram = {
  name: 'orangeStalk',
  fields: ['bottom', 'top', 'bow', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-stalk-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec3 bottom = orangeStalk.bottom.xyz;
  vec3 axis = orangeStalk.top.xyz - bottom;
  float len = length(axis);
  vec3 along = axis / max(len, 1e-6);
  vec3 side = normalize(cross(along, abs(along.z) < 0.95 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0)));
  vec3 other = cross(along, side);
  float v = positions.z;
  // Thicker where it leaves its twig, with a small swelling at the joint, and woody at the button. Past the
  // joint, inside the twig, it narrows, so none of it shows through the twig's far side.
  float radius = mix(orangeStalk.bottom.w, orangeStalk.top.w, v * v);
  radius *= 1.0 + ${floatLiteral(STALK.swell)} * smoothstep(0.74, 0.88, v) + 0.12 * (1.0 - smoothstep(0.0, 0.12, v)) * (1.0 - orangeStalk.look.x);
  radius *= 1.0 - ${floatLiteral(STALK.narrowing)} * smoothstep(${floatLiteral(STALK.narrowFrom)}, 1.0, v);
  float bow = orangeStalk.bow.w * len * 4.0 * v * (1.0 - v);
  vec3 bend = orangeStalk.bow.xyz * orangeStalk.bow.w * 4.0 * (1.0 - 2.0 * v);
  vec3 tangent = normalize(along + bend);
  vec3 ring = side * positions.x + other * positions.y;
  // Square to the bowed line.
  ring = normalize(ring - tangent * dot(ring, tangent));
  vec3 offset = axis * v + orangeStalk.bow.xyz * bow + ring * radius * length(positions.xy);
  vec3 normal = details.z > 0.5 ? -tangent : ring;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(bottom, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normal;
  vFruit = vec3(atan(positions.y, positions.x), v * len, length(positions.xy));
  vFruitNormal = normal;
  vDetail = details;
  vHeight = 1.0;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-stalk-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  float around = vFruit.x;
  float metres = vFruit.y;
  float broken = orangeStalk.look.x;
  // Green bark going woody toward the twig, finely striped along its length, with a few pale lenticels.
  float stripes = propNoise(vec3(around * 9.0, metres * 1400.0, 3.0));
  float cloud = propFbm(vec3(around * 2.0, metres * 160.0, 7.0));
  // Into the twig's own olive bark where it leaves it.
  vec3 albedo = mix(vec3(0.11, 0.15, 0.045), vec3(0.16, 0.14, 0.068), smoothstep(0.35, 0.85, vDetail.y + 0.3 * cloud));
  albedo = mix(albedo, vec3(0.1, 0.104, 0.04), smoothstep(0.86, 1.0, vDetail.y));
  albedo *= mix(0.82, 1.1, stripes);
  float lenticel = smoothstep(0.86, 0.92, propNoise(vec3(around * 6.0, metres * 900.0, 11.0)));
  albedo = mix(albedo, vec3(0.42, 0.38, 0.26), lenticel * 0.6);
  // The button's woody collar where it meets the fruit, while it holds.
  albedo = mix(albedo, vec3(0.24, 0.19, 0.1), (1.0 - smoothstep(0.0, 0.1, vDetail.y)) * (1.0 - broken));
  float shininess = 30.0;
  float wax = 0.3;
  if (vDetail.z > 0.5) {
    // Torn: pale, wet, fibrous green, a darker ring of bark round it.
    float fibres = propNoise(vec3(around * 14.0, vDetail.w * 30.0, 5.0));
    vec3 torn = vec3(0.5, 0.56, 0.3) * mix(0.8, 1.08, fibres);
    albedo = mix(torn, vec3(0.16, 0.18, 0.07), (1.0 - smoothstep(0.0, 0.2, vDetail.w)) * 0.7);
    shininess = 60.0;
    wax = 0.6;
  }
  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  propShadowNormal = dot(normal, toKey) > 0.02 ? normal : vec3(0.0);
  propShadowSoft = 0.0012;
  propLights(normal, view, vec3(0.14, 0.12, 0.08), shininess, wax, 0.3, 0.0, 0.0012);
  vec3 sky = propHemisphere(normal) * 0.85;
  vec3 color = albedo * (sky + gDiffuse) + gSpecular;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** The bearing twig's shape, for both stages: its taper, its nodes, and the bud and scar at each. */
const TWIG_SHAPE_GLSL = /* glsl */ `
const float TWIG_NODE_SPACING = ${floatLiteral(TWIG.nodeSpacing)};
const float TWIG_NODE_LENGTH = ${floatLiteral(TWIG.nodeLength)};
const float TWIG_NODE_SWELL = ${floatLiteral(TWIG.nodeSwell)};
const float TWIG_BUD = ${floatLiteral(TWIG.bud)};
const float TWIG_KINK = ${floatLiteral(TWIG.kink)};
// How far from the tip the shoot still has all its leaves.
const float TWIG_LEAFY = ${floatLiteral(TWIG.leafy)};
// Each node's leaf grew 2/5 of the way round from the last one's.
const float TWIG_TURN = 2.51327;

// Metres from the twig's base to node k, each a little off an even spacing.
float twigNodeAt(float k) {
  return (k + 0.5 + 0.4 * (propHash(vec3(k, 3.1, 7.7)) - 0.5)) * TWIG_NODE_SPACING;
}

// Which node the stalk grows from, at the junction, with no leaf scar or bud of its own.
const float TWIG_STALK_NODE = -1000.0;

// How close s is to the nearest node, 1 on it; which node; and how far past it toward the tip. The nodes the
// stalk and the leaves grow from are where they are; the others, on its older wood, are where leaves fell.
float twigNode(float s, out float index, out float past) {
  float len = orangeTwig.tip.w;
  past = s - orangeTwig.radius.w * len;
  index = TWIG_STALK_NODE;
  vec3 leaves = s - orangeTwig.look.yzw;
  if (abs(leaves.x) < abs(past)) past = leaves.x;
  if (abs(leaves.y) < abs(past)) past = leaves.y;
  if (abs(leaves.z) < abs(past)) past = leaves.z;
  if (len - s > TWIG_LEAFY) {
    float k = floor(s / TWIG_NODE_SPACING);
    for (int i = -1; i <= 1; i++) {
      float node = k + float(i);
      float d = s - twigNodeAt(node);
      if (abs(d) < abs(past) && len - twigNodeAt(node) > TWIG_LEAFY) {
        past = d;
        index = node;
      }
    }
  }
  return exp(-(past * past) / (TWIG_NODE_LENGTH * TWIG_NODE_LENGTH));
}

// How far round the twig from the side its node's leaf grew on, as a cosine. -1 where something still grows
// from the node, as the stalk and the leaves do, so it has no scar.
float twigFacing(float angle, float index) {
  return index == TWIG_STALK_NODE ? -1.0 : cos(angle - index * TWIG_TURN);
}

// The bud in the axil of each node's leaf, on the side the leaf grew, just toward the tip from its scar.
float twigBud(float past, float facing) {
  float d = (past - 0.0012) / 0.0011;
  return exp(-d * d) * smoothstep(0.6, 1.0, facing);
}

// How far its axis is from the straight line, s metres from the base: a twig turns a little at each node,
// one way then another. Never at its base, in its limb, nor where the stalk meets it.
vec2 twigKinkAt(float node) {
  vec2 h = vec2(propHash(vec3(node, 5.3, 1.9)), propHash(vec3(node, 8.1, 4.4)));
  return vec2(cos(h.x * 6.2832), sin(h.x * 6.2832)) * (0.35 + 0.65 * h.y);
}

vec3 twigKink(float s, vec3 side, vec3 other) {
  float len = orangeTwig.tip.w;
  float v = clamp(s / len, 0.0, 1.0);
  float from = (orangeTwig.radius.w - v) * len;
  float held = smoothstep(0.0, 0.08, v) * smoothstep(0.012, 0.05, abs(from));
  float node = floor(s / TWIG_NODE_SPACING - 0.5);
  if (s < twigNodeAt(node)) node -= 1.0;
  if (s > twigNodeAt(node + 1.0)) node += 1.0;
  float a = twigNodeAt(node);
  float b = twigNodeAt(node + 1.0);
  float t = clamp((s - a) / max(b - a, 1e-4), 0.0, 1.0);
  vec2 bend = mix(twigKinkAt(node), twigKinkAt(node + 1.0), t) * TWIG_KINK * held;
  return side * bend.x + other * bend.y;
}

// The radius s metres from the base, at an angle round the twig: tapering from the base to where the stalk
// meets it and on to the tip, swollen at each node, with its bud.
float twigRadius(float s, float angle) {
  vec4 r = orangeTwig.radius;
  float v = clamp(s / orangeTwig.tip.w, 0.0, 1.0);
  float radius = v < r.w ? mix(r.x, r.y, v / r.w) : mix(r.y, r.z, (v - r.w) / max(1.0 - r.w, 1e-4));
  float index;
  float past;
  float node = twigNode(s, index, past);
  return radius * (1.0 + TWIG_NODE_SWELL * node) + TWIG_BUD * twigBud(past, twigFacing(angle, index));
}
`;

/**
 * The bearing twig, from `base`, on the axis of the limb it leaves, to `tip`. `base.w` is how far it
 * goes on into that limb, `tip.w` its length, `radius` its radii at the base, where the stalk meets it
 * and at the tip, with in w how far along it the stalk meets it, `look.x` how much of the sky the
 * hero's skirt keeps from it, and `look.yzw` the nodes its leaves grow from, in metres from its base.
 */
const TWIG_PROGRAM: PropProgram = {
  name: 'orangeTwig',
  fields: ['base', 'tip', 'radius', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-twig-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
${TWIG_SHAPE_GLSL}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec3 base = orangeTwig.base.xyz;
  float len = orangeTwig.tip.w;
  vec3 along = (orangeTwig.tip.xyz - base) / len;
  vec3 side = normalize(cross(along, vec3(0.0, 0.0, 1.0)));
  vec3 other = cross(side, along);
  float angle = atan(positions.y, positions.x);
  vec3 ring = side * cos(angle) + other * sin(angle);
  vec3 around = other * cos(angle) - side * sin(angle);
  bool cap = details.z > 0.5;
  float s = cap ? len : mix(-orangeTwig.base.w, len, positions.z);
  float radius = twigRadius(s, angle);
  const float ALONG_STEP = 0.0003;
  float slope = (twigRadius(s + ALONG_STEP, angle) - twigRadius(s - ALONG_STEP, angle)) / (2.0 * ALONG_STEP);
  float turn = (twigRadius(s, angle + 0.05) - twigRadius(s, angle - 0.05)) / (0.1 * max(radius, 1e-5));
  vec3 normal = normalize(ring - along * slope - around * turn);
  vec3 kink = twigKink(s, side, other);
  vec3 offset = along * s + kink + ring * radius;
  if (cap) {
    // Rounded, a little blunt.
    float a = details.w * 1.5707963;
    offset = along * (len + radius * 0.8 * sin(a)) + kink + ring * radius * cos(a);
    normal = normalize(ring * cos(a) * 0.8 + along * sin(a));
  }
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(base, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normal;
  vFruit = vec3(angle, s, radius);
  vFruitNormal = normal;
  vDetail = details;
  vHeight = 1.0;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-twig-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}
${TWIG_SHAPE_GLSL}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  float angle = vFruit.x;
  float s = vFruit.y;
  float fromTip = orangeTwig.tip.w - s;
  float index;
  float past;
  float node = twigNode(s, index, past);
  float facing = twigFacing(angle, index);
  // Olive and waxy near its tip, this season's wood; brown toward its limb, where it is older, as
  // TreeLayer's own thin wood is.
  float age = smoothstep(0.06, 0.42, fromTip + 0.05 * (propNoise(vec3(angle * 2.0, s * 30.0, 1.0)) - 0.5));
  vec3 albedo = mix(vec3(0.088, 0.104, 0.036), vec3(0.128, 0.098, 0.054), age);
  // Fine lines along it, and a mottle of grey on the older wood.
  albedo *= mix(0.84, 1.1, propNoise(vec3(angle * 7.0, s * 1600.0, 3.0)));
  albedo = mix(albedo, vec3(0.15, 0.14, 0.115), smoothstep(0.62, 0.9, propFbm(vec3(angle * 3.0, s * 90.0, 5.0))) * age * 0.5);
  // Pale lenticels, more of them where it is older.
  float lenticel = smoothstep(0.88, 0.94, propNoise(vec3(angle * 5.0, s * 1100.0, 9.0)));
  albedo = mix(albedo, vec3(0.34, 0.31, 0.22), lenticel * (0.25 + 0.5 * age));
  // A node is a little darker. On it, the pale crescent of its leaf's scar, and the green bud over it.
  albedo *= 1.0 - 0.16 * node;
  float scarAt = (past + 0.0004) / 0.0008;
  float scar = smoothstep(0.72, 0.92, facing) * exp(-scarAt * scarAt);
  albedo = mix(albedo, vec3(0.28, 0.23, 0.14), scar * 0.75);
  albedo = mix(albedo, vec3(0.085, 0.12, 0.035), twigBud(past, facing) * 0.7);
  if (vDetail.z > 0.5) albedo = mix(albedo, vec3(0.1, 0.125, 0.04), smoothstep(0.4, 1.0, vDetail.w));

  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  propShadowNormal = dot(normal, toKey) > 0.02 ? normal : vec3(0.0);
  propShadowSoft = 0.0015;
  float shininess = mix(46.0, 22.0, age);
  float wax = mix(0.42, 0.2, age);
  propLights(normal, view, vec3(0.12, 0.11, 0.07), shininess, wax, 0.35, 0.0, 0.0015);
  // Under the hero's skirt, the leaves above keep some of the sky from it, and pass on green light of their
  // own, from every side.
  float canopy = orangeTwig.look.x;
  float occlusion = 1.0 - canopy * smoothstep(-0.5, 0.7, normal.z);
  vec3 ambient = propLightColor(lighting.ambientColor);
  vec3 sky = propHemisphere(normal) * occlusion + ambient * vec3(0.09, 0.13, 0.045) * canopy;
  // What its wax mirrors is mostly the leaves around it.
  float grazing = pow(1.0 - max(dot(normal, view), 0.0), 5.0);
  vec3 around = mix(propSkyColor(reflect(-view, normal)), ambient * vec3(0.12, 0.17, 0.06), canopy);
  vec3 mirrored = around * (0.02 + 0.16 * grazing) * occlusion * wax;
  vec3 color = albedo * (sky + gDiffuse) + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * The bearing twig's leaves, already in the world: a citrus leaf, glossy and dark above, paler and matte
 * below, with its midrib and veins, letting yellow-green light through. `look.x` is how much of the sky
 * the hero's skirt keeps from them.
 */
const TWIG_LEAF_PROGRAM: PropProgram = {
  name: 'orangeLeaf',
  fields: ['look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-leaf-vs
precision highp float;
${ORANGE_VERTEX_HEAD}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(vec3(0.0), vec3(0.0), project_size(positions), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normals;
  vFruit = positions;
  vFruitNormal = normals;
  vDetail = details;
  vHeight = 1.0;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME orange-leaf-fs
precision highp float;
precision highp int;
precision highp sampler2D;
${ORANGE_FRAGMENT_HEAD}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  float along = vDetail.x;
  float across = vDetail.y;
  float leaf = vDetail.z;
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  bool upper = dot(normal, view) >= 0.0;
  vec3 facing = upper ? normal : -normal;
  float blade = clamp((along - ${floatLiteral(LEAF_SHAPE.petiole)}) / ${floatLiteral(1 - LEAF_SHAPE.petiole)}, 0.0, 1.0);

  // The midrib, and the side veins that leave it toward the tip and loop near the edge.
  float midrib = 1.0 - smoothstep(0.025, 0.07, abs(across));
  float veinAt = fract(blade * 11.0 - abs(across) * 1.7 + leaf * 0.37);
  float vein = (1.0 - smoothstep(0.0, 0.08, min(veinAt, 1.0 - veinAt))) * smoothstep(0.08, 0.2, abs(across)) *
    (1.0 - smoothstep(0.78, 0.92, abs(across))) * smoothstep(0.02, 0.12, blade);
  // Dark glossy green above, each leaf its own, with oil glands as fine pale dots; paler, matte and less green
  // below. The petiole is a yellower green.
  vec3 top = vec3(0.048, 0.125, 0.021) * mix(0.88, 1.12, fract(leaf * 0.61 + 0.3));
  top *= mix(0.92, 1.06, propNoise(vec3(vFruit * 260.0)));
  float pigment = dot(top, vec3(0.3, 0.55, 0.15));
  vec3 under = mix(top, vec3(pigment) * vec3(1.15, 1.2, 0.65) + vec3(0.012, 0.017, 0.005), 0.5);
  vec3 albedo = upper ? top : under;
  albedo = mix(albedo, albedo * vec3(1.4, 1.35, 1.1) + vec3(0.012, 0.016, 0.0), max(midrib, vein * 0.5) * (upper ? 0.5 : 0.8));
  albedo = mix(albedo, vec3(0.06, 0.12, 0.025), 1.0 - smoothstep(0.0, 0.08, blade));
  float gland = smoothstep(0.86, 0.95, propNoise(vec3(vFruit * 1400.0))) * (upper ? 0.25 : 0.1);
  albedo += vec3(0.01, 0.014, 0.004) * gland;

  // Light: wrapped as it scatters in the blade, the cuticle's sheen, and light through it from behind.
  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  propShadowNormal = dot(facing, toKey) > 0.02 ? facing : vec3(0.0);
  propShadowSoft = 0.0015;
  float wax = upper ? 0.9 : 0.12;
  propLights(facing, view, vec3(0.25), upper ? 90.0 : 12.0, wax, 0.5, 0.0, 0.0012);
  DirectionalLight key = lighting_getDirectionalLight(0);
  float behind = max(-dot(facing, toKey), 0.0);
  float toward = pow(max(dot(-view, toKey), 0.0), 3.0);
  vec3 glowColor = pow(max(top, vec3(0.002)), vec3(0.75)) * vec3(0.95, 1.2, 0.34) * mix(1.0, 0.55, max(midrib, vein));
  vec3 glow = glowColor * propLightColor(key.color) * propKeyVisibility(0.0012) * behind * (0.55 + 1.15 * toward);
  float canopy = orangeLeaf.look.x;
  float occlusion = 1.0 - canopy * smoothstep(-0.5, 0.7, facing.z);
  vec3 ambient = propLightColor(lighting.ambientColor);
  vec3 sky = propHemisphere(facing) * occlusion + ambient * vec3(0.09, 0.13, 0.045) * canopy;
  float cosine = max(dot(facing, view), 0.0);
  float fresnel = 0.012 + 0.4 * pow(1.0 - cosine, 4.0);
  vec3 mirrored = mix(propSkyColor(reflect(-view, facing)), ambient * vec3(0.12, 0.17, 0.06), canopy * 0.6) *
    fresnel * wax * occlusion;
  vec3 color = albedo * (sky + gDiffuse) + glow + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

const STEM_MESH_LAZY: {
  rind?: PropMesh;
  navel?: PropMesh;
  stemFace?: PropMesh;
  navelFace?: PropMesh;
  bead?: PropMesh;
  stalk?: PropMesh;
  twig?: PropMesh;
  leaves?: PropMesh;
} = {};

function getRindMesh(side: 1 | -1): PropMesh {
  if (side > 0) {
    STEM_MESH_LAZY.rind ??= mergeMeshes([createRindDome(1), createCalyx()]);
    return STEM_MESH_LAZY.rind;
  }
  STEM_MESH_LAZY.navel ??= createRindDome(-1);
  return STEM_MESH_LAZY.navel;
}

function getFaceMesh(side: 1 | -1): PropMesh {
  if (side > 0) {
    STEM_MESH_LAZY.stemFace ??= createFaceMesh(1);
    return STEM_MESH_LAZY.stemFace;
  }
  STEM_MESH_LAZY.navelFace ??= createFaceMesh(-1);
  return STEM_MESH_LAZY.navelFace;
}

/** A rounded bead, for juice. */
export function getBeadMesh(): PropMesh {
  STEM_MESH_LAZY.bead ??= createSphereMesh(3);
  return STEM_MESH_LAZY.bead;
}

function getStalkMesh(): PropMesh {
  STEM_MESH_LAZY.stalk ??= createStalkMesh();
  return STEM_MESH_LAZY.stalk;
}

function getTwigMesh(): PropMesh {
  STEM_MESH_LAZY.twig ??= createTwigMesh();
  return STEM_MESH_LAZY.twig;
}

/** The bearing twig's leaves, as one mesh in the world. */
export function getTwigLeafMesh(): PropMesh {
  STEM_MESH_LAZY.leaves ??= createTwigLeafMesh();
  return STEM_MESH_LAZY.leaves;
}

/**
 * What the twig program takes for the bearing twig: its base, reaching a little way on into its limb,
 * its tip and length, its radii and where along it the stalk meets it, and how much sky it has.
 */
export function getTwigValues(): Record<string, number[]> {
  const {base, tip, length, junction, radius} = getBearingTwig();
  const [first, second, third] = TWIG_LEAVES.map(leaf => junction * length - leaf.at);
  return {
    base: [base[0], base[1], base[2], TWIG.intoLimb],
    tip: [tip[0], tip[1], tip[2], length],
    radius: [radius[0], radius[1], radius[2], junction],
    look: [CANOPY.sky, first, second, third]
  };
}

/**
 * What the stalk program takes for a stalk: its ends, each with its radius, reaching a little way into
 * its twig, the way it bows, and whether it has broken off the fruit.
 */
export function getStalkValues(
  stem: NonNullable<StoryOrange['stem']>,
  broken: boolean
): Record<string, number[]> {
  const {bottom, top, radius} = stem;
  const axis: Vec3 = [top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]];
  const length = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const along: Vec3 = [axis[0] / length, axis[1] / length, axis[2] / length];
  const reach = STALK.intoTwig;
  // It bows out from under its twig, away from the tree's middle.
  const out: Vec3 = [bottom[0], bottom[1], 0];
  const share = out[0] * along[0] + out[1] * along[1];
  const bow: Vec3 = [out[0] - along[0] * share, out[1] - along[1] * share, -along[2] * share];
  const bowLength = Math.hypot(bow[0], bow[1], bow[2]) || 1;
  return {
    bottom: [bottom[0], bottom[1], bottom[2], radius],
    top: [
      top[0] + along[0] * reach,
      top[1] + along[1] * reach,
      top[2] + along[2] * reach,
      HERO_FRUIT_TABLE.stalk.twigRadius
    ],
    bow: [bow[0] / bowLength, bow[1] / bowLength, bow[2] / bowLength, STALK.bow],
    look: [broken ? 1 : 0, 0, 0, 0]
  };
}

/** How far the fruit's lowest point is above the land under it, in metres. */
function getClearance(orange: StoryOrange): number {
  return orange.position[2] - orange.groundZ - orange.radius * (1 - orange.squash);
}

/** How much of the sky the hero's skirt keeps from the fruit: all of `CANOPY.sky` while it hangs. */
function getCanopy(orange: StoryOrange): number {
  if (!orange.stem) return 0;
  const {hangHeight} = LOOP;
  const dropped = hangHeight - (orange.position[2] - orange.groundZ);
  return CANOPY.sky * (1 - smoothstep(CANOPY.clear[0], CANOPY.clear[1], dropped));
}

/**
 * How far a half settles below where the story puts it, since its dome is not a sphere: it rests on the
 * ground wherever it has rolled to. In metres.
 */
export function getHalfDrop(rotation: Quat, index: number, radius: number): number {
  const turn = getHalfTurn(rotation, index);
  const down = rotateVector(getConjugate(turn), [0, 0, -1]);
  const height = Math.hypot(Math.hypot(down[0], down[1]), down[2] * SHAPE.polar);
  return radius * (1 - height);
}

/** The instances of juice beads on a half's face. */
function writeJuiceBeads(
  out: number[],
  orange: StoryOrange,
  index: number,
  center: Vec3,
  turn: Quat,
  side: 1 | -1
): void {
  const {count, radius, sizePower, squash, reach, rise, height} = JUICE_BEADS;
  const normal = rotateVector(turn, [0, 0, -side]);
  for (let bead = 0; bead < count; bead++) {
    const id = bead * 2 + index;
    const start = hash01(id, 301) * (1 - rise);
    const grown = smoothstep(start, start + rise, orange.juice);
    if (grown > 0) {
      const angle = hashRange(id, 302, 0, TWO_PI);
      const rho = Math.sqrt(hashRange(id, 303, reach[0] ** 2, reach[1] ** 2));
      const size = radius[0] + (radius[1] - radius[0]) * hash01(id, 304) ** sizePower;
      const local: Vec3 = [
        rho * Math.cos(angle) * orange.radius,
        rho * Math.sin(angle) * orange.radius,
        -side * size * height
      ];
      const offset = rotateVector(turn, local);
      out.push(
        center[0] + offset[0],
        center[1] + offset[1],
        center[2] + offset[2],
        size * Math.sqrt(grown),
        normal[0],
        normal[1],
        normal[2],
        squash,
        1
      );
    }
  }
}

/**
 * The orange: the whole fruit, hanging by its stalk, falling or resting, then its two halves with their
 * cut faces, juice beads and falling droplets, and dew it sheds.
 */
export function createOrangeLayer(state: StoryState): Layer | Layer[] | null {
  const {orange} = state.props;
  if (!orange.visible) return null;
  const base = getPropLayerProps(state.fog);
  const layers: Layer[] = [];
  const {radius, halves, seam, juice, dew, phase, stem, squash, groundZ} = orange;
  const gap = Math.hypot(
    halves[0].position[0] - halves[1].position[0],
    halves[0].position[1] - halves[1].position[1],
    halves[0].position[2] - halves[1].position[2]
  );
  const open = seam > 0 ? 1 : 0;
  const faceLight = smoothstep(OPEN_DISTANCE[0], OPEN_DISTANCE[1], gap / radius);
  // Only a fruit lying on the sand settles on its dome. In the air, or bouncing, it is where it is.
  const settles = phase === 'resting' || phase === 'opening';
  const clearance = getClearance(orange);
  const shape = [squash, groundZ, getCanopy(orange), 0];
  const contacts: number[] = [];

  for (let index = 0; index < 2; index++) {
    const side = (index === 0 ? 1 : -1) as 1 | -1;
    const {position, rotation} = halves[index];
    const turn = getHalfTurn(rotation, index);
    const drop = settles ? getHalfDrop(rotation, index, radius) : 0;
    const center: Vec3 = [position[0], position[1], position[2] - drop];
    const values = {
      center: [center[0], center[1], center[2], radius],
      turn
    };
    layers.push(
      new PropMeshLayer({
        ...base,
        id: `orange-rind-${index}`,
        mesh: getRindMesh(side),
        program: RIND_PROGRAM,
        values: {...values, look: [dew, juice, open, side], shape}
      }) as Layer
    );
    if (seam > 0) {
      layers.push(
        new PropMeshLayer({
          ...base,
          id: `orange-face-${index}`,
          mesh: getFaceMesh(side),
          program: FACE_PROGRAM,
          values: {
            ...values,
            look: [juice, faceLight, side, index * 3 + 1],
            seed: [state.props.seed.visible ? 1 : 0, groundZ, 0, 0]
          }
        }) as Layer
      );
    }
    // Under each half, a soft dark patch. They are one under the whole fruit, until the halves part,
    // and none under a fruit well clear of the land.
    const {size, dark} = CONTACT.half;
    const down = rotateVector(getConjugate(turn), [0, 0, -1]);
    const low = rotateVector(turn, [down[0], down[1], down[2] * SHAPE.polar]);
    writeContact(
      contacts,
      position[0] + low[0] * radius,
      position[1] + low[1] * radius,
      radius * size,
      dark * smoothstep(0, 1, 0.55 + gap / radius),
      state.key.direction,
      groundZ,
      clearance
    );
  }

  // Where it lands, in the start world, the sand it wets, until that soaks in.
  if (!stem && phase === 'falling') {
    for (const {position, radius: size, dark} of getImpactDamp(state.t)) {
      writeDamp(contacts, position[0], position[1], position[2], size, dark);
    }
  }

  if (stem) {
    // The twig it hangs from is drawn with it, as the tree may not have it.
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'orange-twig',
        mesh: getTwigMesh(),
        program: TWIG_PROGRAM,
        values: getTwigValues()
      }) as Layer,
      new PropMeshLayer({
        ...base,
        id: 'orange-twig-leaves',
        mesh: getTwigLeafMesh(),
        program: TWIG_LEAF_PROGRAM,
        values: {look: [CANOPY.sky, 0, 0, 0]}
      }) as Layer
    );
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'orange-stalk',
        mesh: getStalkMesh(),
        program: STALK_PROGRAM,
        values: getStalkValues(stem, phase !== 'hanging')
      }) as Layer
    );
  }

  if (seam > 0 && faceLight < 1) {
    // Only until the halves have rolled enough to hide it.
    const middle: Vec3 = [
      (halves[0].position[0] + halves[1].position[0]) / 2,
      (halves[0].position[1] + halves[1].position[1]) / 2,
      (halves[0].position[2] + halves[1].position[2]) / 2
    ];
    const shrink = 1 - smoothstep(0.05, 0.3, gap / radius);
    if (shrink > 0) {
      layers.push(
        new PropMeshLayer({
          ...base,
          id: 'orange-plug',
          mesh: getFaceMesh(1),
          program: PLUG_PROGRAM,
          values: {
            center: [middle[0], middle[1], middle[2], radius],
            turn: orange.rotation,
            look: [0.97 * shrink, 0, 0, 0]
          }
        }) as Layer
      );
    }
  }

  layers.unshift(
    new PropMeshLayer({
      ...base,
      id: 'orange-contact',
      mesh: PROP_QUAD_MESH,
      program: CONTACT_PROGRAM,
      instances: new Float32Array(contacts),
      instanceCount: contacts.length / CONTACT_STRIDE,
      shadowEnabled: false,
      parameters: {depthWriteEnabled: false}
    }) as Layer
  );

  const beads: number[] = [];
  if (juice > 0) {
    for (let index = 0; index < 2; index++) {
      const side = (index === 0 ? 1 : -1) as 1 | -1;
      const {position, rotation} = halves[index];
      const turn = getHalfTurn(rotation, index);
      const drop = getHalfDrop(rotation, index, radius);
      writeJuiceBeads(
        beads,
        orange,
        index,
        [position[0], position[1], position[2] - drop],
        turn,
        side
      );
    }
  }
  // What drops from the opening's halves is juice. What the whole fruit sheds is dew.
  const isDew = phase === 'hanging' || phase === 'falling';
  const dropRadius = isDew ? DEW_DROP.radius : DROPLET_RADIUS;
  for (const {position, alpha} of orange.droplets) {
    if (alpha > 0)
      beads.push(position[0], position[1], position[2], dropRadius, 0, 0, 1, 1.08, alpha);
  }
  if (beads.length > 0) {
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'orange-beads',
        mesh: getBeadMesh(),
        program: BEAD_PROGRAM,
        values: {tint: isDew && juice <= 0 ? DEW_DROP.tint : JUICE_TINT},
        instances: new Float32Array(beads),
        instanceCount: beads.length / 9,
        shadowEnabled: false
      }) as Layer
    );
  }
  return layers;
}
