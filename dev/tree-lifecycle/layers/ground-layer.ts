// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The ground, from a grain of sand under the orange to the horizon, as one polar mesh around the hero,
 * with rings spaced by their logarithm, so it is as fine as a view needs wherever the camera looks from
 * near the middle. It has no texture: every fragment works out its own surface in world coordinates, from
 * bands of detail chosen by how much ground a pixel covers, so nothing tiles and nothing shimmers, and the
 * bands that a pixel can no longer resolve hand over to a flat tone. The depth of a fragment is written by
 * hand, and kept inside the far plane, so the ground reaches the horizon when the far plane does not.
 *
 * The land is `LAND_GLSL`'s beds and furrows. The mesh lies over every furrow as a lid at the bed's
 * height, or on the water when it stands higher, so it is never below what it covers; a fragment of a lid
 * meets the furrow under it along its own ray, in closed form, and writes that point's depth. A furrow
 * too small to draw that way is a tint of water and bank by its share of the pixel. Water, wherever the
 * flood's level stands over the land, is the ground's own surface: luma.gl's `waterMaterial` waves and the
 * film's own ripples, the sky probe and the nearest crowns in it, and a tea-brown body over the bottom.
 * After it, the land keeps a wet band at the shore, wrack where the shore stood, and silt drying pale.
 *
 * Replant sites are small dense patches of the same surface, drawn over the mesh, which is too coarse
 * out there for a hole to be dug in it. Past the block of real trees the rows go on as low hedges of crowns,
 * with no leaves to them but what a shader can suggest, and past those as strips on the ground, to the
 * horizon.
 */

import {COORDINATE_SYSTEM, project32, type UpdateParameters} from '@deck.gl/core';
import {_treeWindGust} from '@deck.gl-community/layers';
import type {Texture} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {lighting, waterMaterial} from '@luma.gl/shadertools';
import {getCrownFraction, getHeightFraction, HURRICANE} from '../story/beats';
import {getDaysUnderWater, getFoamToward} from '../story/flood';
import {DECLINE_TABLE, GROVE_PLAN, LEAN_TABLE} from '../story/grove';
import {BED_LAYOUT, getFurrowU, getFurrowWaterHalf} from '../story/land';
import {clamp01, getBearingVector, RADIANS_PER_DEGREE, smoothstep} from '../story/story-math';
import type {StorySite, StoryState} from '../story/story-types';
import {
  FIELD_AIR_GLSL,
  FIELD_FLOOD_GLSL,
  FIELD_LIGHT_GLSL,
  FIELD_MIRROR_GLSL,
  FIELD_PLAN_GLSL,
  FIELD_SHADOW_VERTEX_GLSL,
  fieldAir,
  fieldFlood,
  type FieldFlood,
  FieldLayer,
  type FieldAir,
  fieldPlan,
  type FieldPlan,
  getFieldAir,
  getFieldFlood,
  getFieldPlan,
  getFieldShadowFragment
} from './field-shading';
import {getGrassWindow} from './grass-layer';
import {getSkyProbe} from './sky-layer';

/** The polar mesh: sides around, and the metres its rings run from and to. */
const GROUND_MESH = {sides: 256, inner: 0.01, outer: 6000, stretch: 1.5};
/** A site's patch: rings and sides, and its radius in metres. */
const SITE_MESH = {rings: 26, sides: 56, radius: 1.3};
/** Metres, for a replant, whose story gives only how far it has got. */
const SITE_SHAPE = {holeRadius: 0.3, holeDepth: 0.24, bermRadius: 0.56};
/** Sides of the cells of the trees' lookup. Cells are a tree's spacing, so each has about one. */
const TREE_GRID = {columns: 16, rows: 12};
/** Open holes the mesh can have at a time, on the lookup's last row. */
const MOST_HOLES = 16;
/** Rows past the block: how far from the hero they stand up and how far they lie down into strips. */
export const FAR_ROWS = {
  riseEnd: 1050,
  flatFrom: 620,
  /** Out to here each tree is a crown of its own, and the rows take over from there. */
  crownsTo: 250,
  /**
   * Metres from the hero over which the crowns give way to the rows' hedges, tree by tree as the hedges rise,
   * so no line shows where one ends and the other starts.
   */
  handOver: [200, 245] as const,
  /** Most lines of trees and most trees to a line that a view of crowns goes through. */
  leastSpacing: 8,
  spacingShare: 0.05
};
/** A crown's mesh: rings up it, and sides around. */
const CROWN_MESH = {rings: 7, sides: 20};
/**
 * How the rows past the block go through the storm and the flood, as the grove's own trees do: the
 * share of them that lean on lifted root plates, how far they lean, and the share of those whose
 * roots drown that die back to twigs.
 */
const FAR_STORM = {
  leanShare: LEAN_TABLE.share,
  leanDegrees: LEAN_TABLE.degrees,
  deadShare: 0.3,
  /** Cycle seconds over which the dead go, as the block's own skeletons go when the replanting reaches them. */
  deadGone: [51.3, 52.9] as const,
  /**
   * Cycle seconds over which the far blocks' yellowed trees green again, as the year-21 spring comes in with the
   * replanting: far off, the low ends' trees read as the field's own by then.
   */
  recover: [51.4, 53] as const,
  /** Degrees the wind at full strength streams a crown over by, as `TreeLayer` bends its own. */
  streamDegrees: 16
};
/**
 * The far blocks' low spots, where their trees' roots drown. Each far block is the hero's own, repeated along
 * the rows past its east ditch, and falls as it does toward an east ditch of its own, so its low east end, over
 * `lowEnd` of its length, is where water stands longest. Hollows there are noise of these cycles per metre under
 * `limit` plus `lowGain`, and elsewhere under `limit` alone, a little more of them where the land lies under the
 * drowning height, by up to `landGain` over `landRange` metres: so about two in five trees of a low end drown,
 * as in the block's own, one in fifteen elsewhere, and a seventh of the far trees in all.
 */
const FAR_HOLLOW = {
  scales: [0.045, 0.13] as const,
  ditch: 4,
  lowEnd: [0.62, 0.92] as const,
  limit: 0.22,
  lowGain: 0.32,
  landGain: 0.03,
  landRange: 0.03
};
/**
 * The culvert's pipe, corrugated steel: its radius, the rim of its wall at its end, how far it stands out past the
 * foot of each ramp, the pitch of its corrugations, and the metres into it over which the daylight at its mouth
 * fades by e.
 */
const PIPE = {
  radius: BED_LAYOUT.crossing.pipe / 2,
  wall: 0.02,
  out: 0.42,
  corrugation: 0.068,
  lightReach: 0.3
};
/** A tree's trunk, for contact shading: radius in metres, as a share of its height. */
const TRUNK_SHARE = 0.022;
/** How many of the nearest crowns the water mirrors, and their shape as shares of a tree's height. */
const MIRROR_TREES = {count: 24, middle: 0.58, tall: 0.44, wide: 0.92};
/**
 * The water. A furrow keeps its own shape while it is more than `detailPixels` across, and is a tint
 * of water and bank by `tintPixels`. The body scatters `body` (sRGB) and hides the bottom over
 * `extinction` metres. The waves are luma's two: A along the wind, B across it, each a wavelength's
 * radians per metre and a speed in radians per second, with an amplitude in metres at full wind,
 * which goes with its square.
 */
const WATER = {
  detailPixels: 7,
  tintPixels: 3.5,
  body: [86, 66, 42] as const,
  extinction: 0.08,
  waveA: {frequency: 7, speed: -8.3, amplitude: 0.012},
  waveB: {frequency: 17, speed: -5, amplitude: 0.0035},
  normalStrength: [0.12, 0.5] as const,
  specularIntensity: 0.6,
  /**
   * Foam a far furrow's ribbon keeps of its share of a pixel when its near bank hides it, so it still
   * glints, thinly, where the land would hide all of it.
   */
  leastSeen: 0.12
};
/** Shares of the grove down in the storm's two walls, and the seconds they go and the gaps fill. */
const FAR_TREES_DOWN = {
  share: 0.18,
  firstWall: [35.6, 37.4] as const,
  secondWall: [41, 43] as const,
  regrown: [51.5, 55.5] as const
};

/** Linear light of an sRGB color 0-255, as a body color for the shaders. */
function getLinear(color: readonly number[]): [number, number, number] {
  const channel = (value: number) => Math.pow(value / 255, 2.2);
  return [channel(color[0]), channel(color[1]), channel(color[2])];
}

const WATER_BODY = getLinear(WATER.body);

/** A number as a GLSL float literal. */
function toGlsl(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

/** Vertices and triangles of a polar mesh around the origin. Rings start at `inner`, about square cells. */
export function createPolarMesh(
  sides: number,
  inner: number,
  outer: number,
  stretch: number
): {positions: Float32Array; indices: Uint32Array; rings: number} {
  const ratio = 1 + (2 * Math.PI * stretch) / sides;
  const rings = Math.ceil(Math.log(outer / inner) / Math.log(ratio)) + 1;
  const positions = new Float32Array((1 + rings * sides) * 2);
  // The first vertex is the center.
  for (let ring = 0; ring < rings; ring++) {
    const radius = ring === rings - 1 ? outer : inner * Math.pow(ratio, ring);
    for (let side = 0; side < sides; side++) {
      const angle = (2 * Math.PI * side) / sides;
      const at = (1 + ring * sides + side) * 2;
      positions[at] = radius * Math.cos(angle);
      positions[at + 1] = radius * Math.sin(angle);
    }
  }
  const indices = new Uint32Array(sides * 3 + (rings - 1) * sides * 6);
  let out = 0;
  for (let side = 0; side < sides; side++) {
    indices[out++] = 0;
    indices[out++] = 1 + side;
    indices[out++] = 1 + ((side + 1) % sides);
  }
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      const a = 1 + ring * sides + side;
      const b = 1 + ring * sides + next;
      const c = 1 + (ring + 1) * sides + side;
      const d = 1 + (ring + 1) * sides + next;
      indices[out++] = a;
      indices[out++] = c;
      indices[out++] = b;
      indices[out++] = b;
      indices[out++] = c;
      indices[out++] = d;
    }
  }
  return {positions, indices, rings};
}

/** A patch of even rings. Its vertices are in units of its radius. */
function createSiteMesh(): {positions: Float32Array; indices: Uint32Array} {
  const {rings, sides} = SITE_MESH;
  const positions = new Float32Array((1 + rings * sides) * 2);
  for (let ring = 0; ring < rings; ring++) {
    const radius = (ring + 1) / rings;
    for (let side = 0; side < sides; side++) {
      const angle = (2 * Math.PI * side) / sides;
      const at = (1 + ring * sides + side) * 2;
      positions[at] = radius * Math.cos(angle);
      positions[at + 1] = radius * Math.sin(angle);
    }
  }
  const indices = new Uint32Array(sides * 3 + (rings - 1) * sides * 6);
  let out = 0;
  for (let side = 0; side < sides; side++) {
    indices[out++] = 0;
    indices[out++] = 1 + side;
    indices[out++] = 1 + ((side + 1) % sides);
  }
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      const a = 1 + ring * sides + side;
      const b = 1 + ring * sides + next;
      const c = 1 + (ring + 1) * sides + side;
      const d = 1 + (ring + 1) * sides + next;
      indices[out++] = a;
      indices[out++] = c;
      indices[out++] = b;
      indices[out++] = b;
      indices[out++] = c;
      indices[out++] = d;
    }
  }
  return {positions, indices};
}

/**
 * Rows of crowns past the block of real trees: for each line of trees, a tube of domes along x, as coarse
 * as its distance from the hero allows. Each vertex is x, y, its place across the row and its height on it.
 */
export function createFarRowsMesh(
  spacing: number,
  extent: readonly [number, number],
  reach: number
): {places: Float32Array; indices: Uint32Array} {
  const across = [-1, -0.72, 0, 0.72, 1];
  const up = [0, 0.74, 1, 0.74, 0];
  const places: number[] = [];
  const indices: number[] = [];
  const rows = Math.ceil(reach / spacing);
  const addRun = (y: number, from: number, to: number, direction: number) => {
    let x = from;
    let first = true;
    while (true) {
      const at = places.length / 4;
      for (let i = 0; i < across.length; i++) places.push(x, y, across[i], up[i]);
      if (!first) {
        for (let i = 0; i < across.length - 1; i++) {
          const a = at - across.length + i;
          const b = at + i;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
      first = false;
      if (direction * (to - x) <= 0) break;
      const far = Math.max(Math.abs(x), Math.abs(y));
      const step = Math.max(FAR_ROWS.leastSpacing, far * FAR_ROWS.spacingShare);
      x = direction > 0 ? Math.min(x + step, to) : Math.max(x - step, to);
    }
  };
  for (let row = -rows; row <= rows; row++) {
    const y = row * spacing;
    const end = Math.sqrt(Math.max(reach * reach - y * y, 0));
    // Nearer than where the crowns start to give way to them, the crowns have it.
    const start = Math.sqrt(Math.max((FAR_ROWS.handOver[0] - 5) ** 2 - y * y, 0));
    if (end > start) {
      addRun(y, start, end, 1);
      addRun(y, -start, -end, -1);
    }
  }
  return {places: new Float32Array(places), indices: new Uint32Array(indices)};
}

/** A rounded crown, as rings up a dome, for one tree of the rows past the block. Unit size. */
export function createCrownMesh(): {places: Float32Array; indices: Uint32Array} {
  const {rings, sides} = CROWN_MESH;
  const places: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const angle = ((ring / (rings - 1)) * Math.PI) / 2;
    for (let side = 0; side < sides; side++) {
      const around = (side / sides) * 2 * Math.PI;
      places.push(
        Math.cos(angle) * Math.cos(around),
        Math.cos(angle) * Math.sin(around),
        Math.sin(angle),
        0
      );
    }
  }
  const top = places.length / 4;
  places.push(0, 0, 1, 0);
  for (let ring = 0; ring < rings - 1; ring++) {
    for (let side = 0; side < sides; side++) {
      const next = (side + 1) % sides;
      const a = ring * sides + side;
      const b = ring * sides + next;
      const c = (ring + 1) * sides + side;
      const d = (ring + 1) * sides + next;
      if (ring === rings - 2) {
        indices.push(a, b, top);
      } else {
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  return {places: new Float32Array(places), indices: new Uint32Array(indices)};
}

/** The share of a window `width` wide around `u` that lies within `half` of a furrow's centre line. */
function getFurrowShare(u: number, width: number, half: number): number {
  const period = BED_LAYOUT.bedSpacing;
  const window = Math.max(width, 1e-4) / 2;
  const covered = (at: number) => {
    const shifted = at + period / 2;
    const whole = Math.floor(shifted / period);
    const low = period / 2 - half;
    return (
      whole * 2 * half + Math.min(Math.max(shifted - whole * period, low), low + 2 * half) - low
    );
  };
  return clamp01((covered(u + window) - covered(u - window)) / (2 * window));
}

/**
 * What of a pixel `width` metres across y, at `y`, a far furrow takes, as the ground tints it: its
 * water at `level` against the bed, and its banks and shoulders. The CPU twin of `fieldFurrowTint`.
 */
export function getFurrowTint(
  y: number,
  width: number,
  level: number
): {water: number; bank: number} {
  const u = getFurrowU(0, y);
  const water = getFurrowShare(u, width, getFurrowWaterHalf(level));
  const zone = BED_LAYOUT.furrowTop / 2 + BED_LAYOUT.shoulderWidth;
  return {water, bank: Math.max(getFurrowShare(u, width, zone) - water, 0)};
}

const FIELD_GROUND_DECLARATION = /* glsl */ `layout(std140) uniform fieldGroundUniforms {
  vec4 hero;
  vec4 heroMore;
  vec4 surface;
  vec4 ring;
  vec4 site;
  vec4 siteMore;
  vec4 eye;
  vec4 wind;
  vec4 rows;
  vec4 shade;
  vec4 farStorm;
  vec4 farDecline;
  mat4 viewProjection;
} fieldGround;`;

const fieldGround = {
  name: 'fieldGround',
  vs: FIELD_GROUND_DECLARATION,
  fs: FIELD_GROUND_DECLARATION,
  uniformTypes: {
    hero: 'vec4<f32>',
    heroMore: 'vec4<f32>',
    surface: 'vec4<f32>',
    ring: 'vec4<f32>',
    site: 'vec4<f32>',
    siteMore: 'vec4<f32>',
    eye: 'vec4<f32>',
    wind: 'vec4<f32>',
    rows: 'vec4<f32>',
    shade: 'vec4<f32>',
    farStorm: 'vec4<f32>',
    farDecline: 'vec4<f32>',
    viewProjection: 'mat4x4<f32>'
  }
} as const;

/** The dug and heaped shape of a planting, the same for the hero and a site. */
const FIELD_PLANTING_GLSL = /* glsl */ `
// Height of a planting at this distance from its center: a hole, and a low ring of soil around it,
// a little out of round by a direction's noise.
float fieldPlantingHeight(float r, vec2 toward, float hole, float holeRadius, float holeDepth, float berm, float bermRadius) {
  float rough = 1.0 + 0.16 * (fieldNoise(toward * 2.3 + 5.0) - 0.5);
  float d = r * rough;
  float z = 0.0;
  if (hole > 0.0) {
    float rim = (d - holeRadius * 1.25) / (holeRadius * 0.3);
    z -= hole * holeDepth * (1.0 - smoothstep(holeRadius * 0.68, holeRadius, d));
    z += hole * 0.05 * exp(-rim * rim);
  }
  if (berm > 0.0) {
    // Squared by hand: pow of a negative number is undefined, and a GPU may make it NaN.
    float ring = (d - bermRadius) / (bermRadius * 0.24);
    z += berm * 0.11 * exp(-ring * ring);
    z -= berm * 0.016 * (1.0 - smoothstep(bermRadius * 0.4, bermRadius * 0.9, d));
  }
  return z;
}

// Fresh turned soil here, 0-1.
float fieldPlantingSoil(float r, float hole, float holeRadius, float berm, float bermRadius) {
  float dug = hole * (1.0 - smoothstep(holeRadius * 1.1, holeRadius * 1.9, r));
  float heaped = berm * (1.0 - smoothstep(bermRadius * 1.05, bermRadius * 1.42, r));
  return max(dug, heaped);
}

// How much of the berm's crest is here, 0-1: the dry top of the ring of soil, which the water in the basin
// inside it never reaches.
float fieldPlantingCrest(float r, float berm, float bermRadius) {
  float ring = (r - bermRadius * 1.02) / (bermRadius * 0.16);
  return berm * exp(-ring * ring);
}
`;

/**
 * The far blocks past the grove's own, in GLSL, for the rows that stand there and the ground under them, which
 * must agree on which trees stand. `fieldFarStands(cell, gone)`: whether a tree of the rows is there, with `gone`
 * of them down, and fewer of them as the hedges take over from the crowns, tree by tree. `fieldFarHollow(stand,
 * ground, below)`, 0-1: how much a tree stands in a low spot of its own far block, as `FAR_HOLLOW` lays them out,
 * where `below` is the height that drowned the block's own trees. Never the whole field: each far block drains to
 * its own ditch, and only its low end suffers, as the hero's does.
 */
const FAR_BLOCKS_GLSL = /* glsl */ `
bool fieldFarStands(vec2 cell, float gone) {
  float fromHero = length(cell * vec2(fieldPlan.rows.y, fieldPlan.rows.x));
  float kept = 1.0 - smoothstep(${FAR_ROWS.handOver[0].toFixed(1)}, ${FAR_ROWS.handOver[1].toFixed(1)}, fromHero);
  return fieldHash(cell + 77.0) >= gone && fieldHash(cell + 251.0) < kept;
}

float fieldFarHollow(vec2 stand, float ground, float below) {
  // Where along its own block a tree stands, from its high west end at 0 to its low east end at 1, the blocks
  // the hero's own length and its east ditch's.
  float blockLength = 2.0 * fieldPlan.rows.z + ${toGlsl(FAR_HOLLOW.ditch)};
  float along = fract((stand.x - fieldPlan.rows.z - ${toGlsl(FAR_HOLLOW.ditch / 2)}) / blockLength);
  float hollow = fieldNoise(stand * ${toGlsl(FAR_HOLLOW.scales[0])} + 3.7) * 0.7 + fieldNoise(stand * ${toGlsl(FAR_HOLLOW.scales[1])} + 9.1) * 0.3;
  float limit = ${toGlsl(FAR_HOLLOW.limit)} + ${toGlsl(FAR_HOLLOW.lowGain)} * smoothstep(${toGlsl(FAR_HOLLOW.lowEnd[0])}, ${toGlsl(FAR_HOLLOW.lowEnd[1])}, along) +
    ${toGlsl(FAR_HOLLOW.landGain)} * clamp((below - ground) / ${toGlsl(FAR_HOLLOW.landRange)}, 0.0, 1.0);
  return 1.0 - smoothstep(limit - 0.025, limit + 0.025, hollow);
}
`;

const GROUND_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME field-ground-vs
precision highp float;

in vec2 groundPlace;

out vec3 vWorld;
out vec2 vClip;
out vec3 vHorizon;
// What still water here would mirror of the sky, for when there is no sky probe.
out vec3 vMirror;

${FIELD_AIR_GLSL}
${FIELD_PLAN_GLSL}
${FIELD_PLANTING_GLSL}
${FIELD_SHADOW_VERTEX_GLSL}

void main() {
  vec2 p = groundPlace;
  float z = 0.0;
  if (fieldGround.site.w > 0.5) {
    // A site's patch, which comes down to the land at its rim.
    p = fieldGround.site.xy + groundPlace * ${SITE_MESH.radius.toFixed(2)};
    float r = length(groundPlace) * ${SITE_MESH.radius.toFixed(2)};
    z = fieldLandHeight(p);
    z += fieldPlantingHeight(
      r,
      groundPlace,
      fieldGround.siteMore.x,
      ${SITE_SHAPE.holeRadius.toFixed(2)},
      ${SITE_SHAPE.holeDepth.toFixed(2)},
      fieldGround.siteMore.y,
      ${SITE_SHAPE.bermRadius.toFixed(2)}
    ) * (1.0 - smoothstep(0.85, 1.0, r / ${SITE_MESH.radius.toFixed(2)}));
  } else {
    float r = length(p);
    // The land with its furrows filled to the bed, which fragments cut them out of again, or the water
    // standing over it: never below what it covers.
    z = fieldLandBed(p);
    z += fieldPlantingHeight(
      r,
      p / max(r, 1e-4),
      fieldGround.hero.x,
      fieldGround.hero.y,
      fieldGround.hero.z,
      fieldGround.hero.w,
      fieldGround.heroMore.x
    );
    z = max(z, fieldFlood.water.x);
  }
  vec3 world = vec3(p, z);
  vWorld = world;
  // What this point turns into with distance, which is as smooth as the mesh is fine.
  vec3 look = normalize(world - fieldGround.eye.xyz);
  vHorizon = fieldHorizon(look);
  vec3 up = vec3(look.xy, max(-look.z, FIELD_HORIZON_Z));
  vec3 clear = fieldAir.weather.z < 0.999 ? fieldAtmosphere(normalize(up)) : vec3(0.0);
  vMirror = mix(clear, fieldAir.fog.rgb * 0.9, fieldAir.weather.z);
  vec3 commonPosition = project_position(world);
  vec4 clip = project_common_position_to_clipspace(vec4(commonPosition, 1.0));
  vClip = clip.zw;
  // The hardware clips nothing but what is behind the eye. Depth is written per fragment.
  gl_Position = vec4(clip.xy, 0.0, clip.w);
  fieldShadowWrite(vec4(commonPosition, 1.0));
}
`;

const GROUND_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME field-ground-fs
precision highp float;

in vec3 vWorld;
in vec2 vClip;
in vec3 vHorizon;
in vec3 vMirror;

// Each cell: a tree's x, y, crown radius and trunk radius. Its last row: open holes, x, y, radius, and one unused.
uniform sampler2D fieldTrees;
// The crowns the water mirrors, a column each: the crown's middle and a sphere round the whole tree, its
// width, height and lean, its trunk's foot and radius, and its leaves. See writeMirrorTrees.
uniform sampler2D fieldMirrorTrees;

out vec4 fragColor;

${FIELD_LIGHT_GLSL}
${FIELD_AIR_GLSL}
${FIELD_MIRROR_GLSL}
${FIELD_PLAN_GLSL}
${FIELD_FLOOD_GLSL}
${FIELD_PLANTING_GLSL}
${FAR_BLOCKS_GLSL}
${getFieldShadowFragment(14)}

const float GROUND_PI = 3.14159265;
const vec3 WATER_BODY = vec3(${WATER_BODY.map(value => value.toFixed(5)).join(', ')});

// ---------------------------------------------------------------- Bands of relief

// One octave for each doubling of scale that a pixel can resolve, from the finest it can up to this many.
// Each octave is rotated by its own level, so no direction shows, and hashed by its own place, so nothing
// tiles. Relief goes on the gradient, with a slope that eases with scale, as sand and land do.
const int LADDER_OCTAVES = 6;
void fieldLadder(vec2 p, float footprint, float slope, inout vec2 gradient, inout float tone) {
  float levelFloat = log2(max(footprint * 2.4, 0.0009) / 0.0009);
  float level = ceil(levelFloat);
  float first = level - levelFloat;
  float scale = 0.0009 * pow(2.0, level);
  float amount = slope * pow(0.86, level);
  for (int i = 0; i < LADDER_OCTAVES && scale < 40.0; i++) {
    float index = level + float(i);
    float angle = index * 2.399963;
    float c = cos(angle);
    float s = sin(angle);
    vec2 turned = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    vec3 n = fieldNoised(turned / scale + index * 7.31);
    float weight = i == 0 ? smoothstep(0.0, 1.0, first) : 1.0;
    vec2 g = n.yz - 0.0;
    gradient += vec2(c * g.x + s * g.y, -s * g.x + c * g.y) * amount * weight;
    tone += (n.x - 0.5) * weight * mix(0.05, 0.12, smoothstep(0.004, 0.5, scale));
    scale *= 2.0;
    amount *= 0.86;
  }
}

// ---------------------------------------------------------------- Sand up close

// Grains: the nearest of a jittered lattice. Out comes a tint and how it faces. Quartz mostly, clear or
// white, with iron stains, some dark mineral grains and a few bits of organic matter.
void fieldGrains(vec2 p, float cell, float seed, float fade, inout vec3 albedo, inout vec2 gradient, inout float glint, vec3 halfway) {
  vec2 q = p / cell;
  vec2 id = floor(q);
  vec2 f = q - id;
  float best = 9.0;
  vec2 bestOffset = vec2(0.0);
  vec2 bestId = id;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = vec2(float(x), float(y));
      vec2 offset = at + fieldHash2(id + at + seed) - f;
      float d = dot(offset, offset);
      if (d < best) {
        best = d;
        bestOffset = offset;
        bestId = id + at;
      }
    }
  }
  float pick = fieldHash(bestId + seed + 3.0);
  float shade = fieldHash(bestId + seed + 7.0);
  vec3 tint = vec3(0.42, 0.39, 0.33) * (0.84 + 0.36 * shade);
  if (pick < 0.1) tint = vec3(0.23, 0.215, 0.2) * (0.8 + 0.5 * shade);
  else if (pick < 0.18) tint = vec3(0.37, 0.26, 0.15) * (0.8 + 0.5 * shade);
  else if (pick < 0.2) tint = vec3(0.04, 0.036, 0.036);
  else if (pick < 0.22) tint = vec3(0.1, 0.07, 0.042);
  float dome = sqrt(max(best, 0.0));
  // Dark between grains, as they sit in each other's shade.
  float gap = smoothstep(0.46, 0.8, dome);
  albedo = mix(albedo, tint * (1.0 - 0.55 * gap), fade);
  vec2 lean = bestOffset * 0.8;
  // A facet that faces its own way, for a glint when it happens to face the light.
  vec2 facet = (fieldHash2(bestId + seed + 13.0) - 0.5) * 1.1;
  gradient += (lean + facet * 0.3) * fade;
  float clear = 1.0 - smoothstep(0.18, 0.28, pick);
  vec3 n = normalize(vec3(-facet * 1.8, 1.0));
  glint += clear * fade * pow(max(dot(n, halfway), 0.0), 600.0) * (1.0 - gap) * step(0.45, shade);
}

// How far a point is from a shadow cast along the ground from a blocker at d = 0, in the blocker's sizes.
float fieldShadowReach(vec2 d, vec2 thrown, float size) {
  float along = clamp(dot(d, thrown) / max(dot(thrown, thrown), 1e-10), 0.0, 1.0);
  return length(d - thrown * along) / size;
}

// Bits of shell and limestone, sparsely, with their own shape and their own shadow away from the sun.
void fieldPebbles(vec2 p, float footprint, vec2 sunward, inout vec3 albedo, inout vec2 gradient, inout float occlusion) {
  const float CELL = 0.03;
  float fade = 1.0 - smoothstep(0.0012, 0.0045, footprint);
  if (fade <= 0.0) return;
  vec2 id = floor(p / CELL);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = id + vec2(float(x), float(y));
      if (fieldHash(cell + 41.0) < 0.2) {
        vec2 center = (cell + fieldHash2(cell + 53.0)) * CELL;
        float size = mix(0.0014, 0.0058, pow(fieldHash(cell + 61.0), 2.6));
        vec2 rough = fieldHash2(cell + 71.0);
        float angle = rough.x * 6.283;
        vec2 axis = vec2(cos(angle), sin(angle));
        vec2 d = p - center;
        vec2 local = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
        local.y *= 1.0 + rough.y * 0.9;
        float wobble = 1.0 + 0.45 * (fieldNoise(normalize(local + 1e-6) * 1.7 + cell) - 0.5);
        float r = length(local) * wobble / size;
        vec2 thrown = -sunward * size * 0.55;
        float below = 1.0 - smoothstep(0.6, 1.25, fieldShadowReach(d, thrown, size));
        occlusion *= 1.0 - 0.6 * below * fade;
        if (r < 1.0) {
          float tone = fieldHash(cell + 97.0);
          vec3 stone = mix(vec3(0.46, 0.44, 0.39), vec3(0.2, 0.18, 0.15), tone * tone);
          stone *= 0.82 + 0.36 * fieldNoise(p * 1100.0 + cell);
          float dome = sqrt(max(1.0 - r * r, 0.0));
          float inside = fade * smoothstep(1.0, 0.82, r);
          albedo = mix(albedo, stone, inside);
          occlusion = mix(occlusion, 1.0, inside);
          gradient -= (d / max(size, 1e-5)) * (1.25 - dome) * 1.3 * inside;
        }
      }
    }
  }
}

// Bits of dead stuff on the sand: straws, twigs and scraps of leaf, each with a torn edge and a low shadow.
void fieldLitter(vec2 p, float footprint, float amount, vec2 sunward, inout vec3 albedo, inout vec2 gradient, inout float occlusion) {
  const float CELL = 0.085;
  float fade = (1.0 - smoothstep(0.0025, 0.012, footprint)) * amount;
  if (fade <= 0.0) return;
  vec2 id = floor(p / CELL);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = id + vec2(float(x), float(y));
      vec2 h = fieldHash2(cell + 141.0);
      if (h.x < 0.5) {
        vec2 center = (cell + fieldHash2(cell + 151.0)) * CELL;
        float angle = h.y * 6.283;
        vec2 axis = vec2(cos(angle), sin(angle));
        float isLeaf = step(0.82, fieldHash(cell + 171.0));
        float reach = isLeaf > 0.5 ? mix(0.006, 0.02, fieldHash(cell + 161.0)) : mix(0.006, 0.042, fieldHash(cell + 161.0));
        float width = isLeaf > 0.5 ? reach * mix(0.25, 0.42, h.x * 2.0) : mix(0.00035, 0.0011, fieldHash(cell + 181.0));
        vec2 d = p - center;
        // Bent or crooked, by its own noise along it.
        d += vec2(-axis.y, axis.x) * (fieldNoise(vec2(dot(d, axis) / reach * 1.3, cell.x)) - 0.5) * reach * 0.3;
        vec2 local = vec2(dot(d, axis), dot(d, vec2(-axis.y, axis.x)));
        float along = clamp(abs(local.x) / reach, 0.0, 1.0);
        float torn = isLeaf > 0.5 ? 0.62 + 0.76 * fieldNoise(p * 420.0 + cell) : 1.0;
        float halfWidth = width * torn * (isLeaf > 0.5 ? sqrt(max(1.0 - along * along, 0.0)) : 1.0 - 0.5 * along);
        float inside = (1.0 - smoothstep(reach * 0.9, reach, abs(local.x))) *
          (1.0 - smoothstep(halfWidth * 0.7, halfWidth * 1.1 + 1e-5, abs(local.y)));
        vec2 shifted = d + sunward * min(0.0009, width);
        vec2 shiftedLocal = vec2(dot(shifted, axis), dot(shifted, vec2(-axis.y, axis.x)));
        float shadow = (1.0 - smoothstep(reach * 0.9, reach * 1.05, abs(shiftedLocal.x))) *
          (1.0 - smoothstep(halfWidth, halfWidth * 1.4 + 0.0005, abs(shiftedLocal.y)));
        occlusion *= 1.0 - 0.4 * shadow * fade;
        vec3 color = mix(vec3(0.22, 0.17, 0.105), vec3(0.075, 0.052, 0.032), fieldHash(cell + 191.0));
        if (isLeaf > 0.5) {
          color = mix(vec3(0.19, 0.145, 0.075), vec3(0.09, 0.066, 0.036), fieldHash(cell + 193.0));
          // A paler midrib, and it darkens toward its edge.
          color *= 1.0 + 0.3 * (1.0 - smoothstep(0.0, 0.1, abs(local.y) / max(width, 1e-5)));
          color *= 1.0 - 0.32 * smoothstep(0.4, 1.0, abs(local.y) / max(halfWidth, 1e-5));
        }
        color *= 0.8 + 0.4 * fieldNoise(p * 500.0);
        albedo = mix(albedo, color, inside * fade);
        occlusion = mix(occlusion, 1.0, inside * fade);
        gradient -= vec2(-axis.y, axis.x) * clamp(local.y / max(halfWidth, 1e-5), -1.0, 1.0) * 0.45 * inside * fade;
      }
    }
  }
}

// ---------------------------------------------------------------- Trees above

// How much sky and what is at their feet, from the trees around this point: a soft disc under each crown,
// dark at the trunk. The lookup's cells are the rows and the spacing along them.
void fieldUnderTrees(vec2 p, out float skyLeft, out float litter, out float directLeft) {
  skyLeft = 1.0;
  litter = 0.0;
  directLeft = 1.0;
  float spacingY = fieldPlan.rows.x;
  float spacingX = fieldPlan.rows.y;
  ivec2 center = ivec2(floor(p.x / spacingX + 0.5), floor(p.y / spacingY + 0.5));
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 cell = center + ivec2(x, y) + ivec2(${TREE_GRID.columns / 2}, ${TREE_GRID.rows / 2});
      if (cell.x >= 0 && cell.y >= 0 && cell.x < ${TREE_GRID.columns} && cell.y < ${TREE_GRID.rows}) {
        vec4 tree = texelFetch(fieldTrees, cell, 0);
        if (tree.z > 0.0 || tree.w > 0.0) {
          float d = length(p - tree.xy);
          float crown = tree.z;
          float under = 1.0 - smoothstep(crown * 0.4, crown * 1.3, d);
          // A crown takes most of the sky from what is right beneath it.
          skyLeft *= 1.0 - 0.78 * under * smoothstep(0.1, 1.2, crown);
          litter = max(litter, 1.0 - smoothstep(crown * 0.55, crown * 1.08, d));
          float trunk = tree.w;
          if (trunk > 0.0) {
            float contact = exp(-max(d - trunk, 0.0) / (trunk * 2.2 + 0.006));
            skyLeft *= 1.0 - 0.72 * contact;
            directLeft *= 1.0 - 0.55 * contact;
          }
        }
      }
    }
  }
}

// The rows past the real trees, as they lie on the ground: what is beneath their crowns, what they shade, and
// past where they stand up, the crowns themselves as a strip seen from above. They cast nothing into the map,
// so a crown's own shade is worked out here, tree by tree, for as far as a pixel can tell them apart.
void fieldFarRows(vec2 p, float fromHero, float yWidth, float footprint, vec3 keyDirection, vec3 ray, out float under, out float shaded, out float strip) {
  under = 0.0;
  shaded = 0.0;
  strip = 0.0;
  float height = fieldGround.rows.x;
  if (height <= 0.0) return;
  float outside = max(smoothstep(0.0, 1.5, abs(p.x) - fieldPlan.rows.z), smoothstep(0.0, 1.5, abs(p.y) - fieldPlan.rows.w));
  // Once the grove has spread as far as the rows go, they go on to the horizon.
  float here = outside * max(fieldRowsHere(fromHero), fieldPlan.reach.y * smoothstep(1800.0, 2400.0, fieldPlan.reach.x));
  if (here <= 0.0) return;
  float halfWidth = fieldGround.rows.y;
  float standing = 1.0 - smoothstep(${FAR_ROWS.flatFrom.toFixed(1)}, ${FAR_ROWS.riseEnd.toFixed(1)}, fromHero);
  float reach = -keyDirection.y / max(keyDirection.z, 0.1) * height * standing;
  // Rows that have run together.
  float lines = fieldStripShare(p.y, max(yWidth, 0.4), halfWidth * 1.05);
  under = lines * here * 0.62;
  shaded = fieldStripShare(p.y - reach * 0.5, max(yWidth, 0.4), halfWidth + abs(reach) * 0.5) * here * 0.7;
  // Seen low across them, each row of crowns hides the ground behind it for as far as its height and the view's
  // fall allow, so only down the aisles does the land, or the water, show between them.
  float descent = -ray.z / max(abs(ray.y), 1e-3);
  float gap = max(fieldPlan.rows.x - 2.0 * halfWidth, 0.0);
  float showing = max(gap - height / max(descent, 1e-3), 0.0) / fieldPlan.rows.x;
  float share = fieldStripShare(p.y, max(yWidth, 0.4), halfWidth);
  strip = max(share, mix(share, 1.0 - showing, smoothstep(0.5, 2.0, yWidth / fieldPlan.rows.x * 4.0))) * here * (1.0 - standing);
  float crowned = (1.0 - smoothstep(${FAR_ROWS.handOver[0].toFixed(1)}, ${FAR_ROWS.handOver[1].toFixed(1)}, fromHero)) * (1.0 - smoothstep(0.8, 2.6, footprint));
  if (crowned > 0.0) {
    vec2 spacing = vec2(fieldPlan.rows.y, fieldPlan.rows.x);
    float gone = fieldGround.rows.z;
    // Beneath the nearest crown.
    vec2 cell = floor(p / spacing + 0.5);
    float eachUnder = 0.0;
    if (fieldFarStands(cell, gone)) {
      vec2 stand = cell * spacing + (fieldHash2(cell + 7.0) - 0.5) * 0.5;
      float size = 0.84 + 0.3 * fieldHash(cell);
      eachUnder = 1.0 - smoothstep(0.5, 1.3, length(p - stand) / (halfWidth * size));
    }
    // The shade of the crown whose shade would fall here.
    vec2 thrown = -keyDirection.xy / max(keyDirection.z, 0.1) * height * 0.56;
    float eachShaded = 0.0;
    vec2 castCell = floor((p - thrown) / spacing + 0.5);
    for (int i = -1; i <= 1; i++) {
      vec2 other = castCell + vec2(float(i), 0.0);
      if (fieldFarStands(other, gone)) {
        vec2 stand = other * spacing + (fieldHash2(other + 7.0) - 0.5) * 0.5;
        float size = 0.84 + 0.3 * fieldHash(other);
        vec2 d = p - stand - thrown * size;
        float reachOut = max(length(thrown) * size, 1e-3);
        vec2 along = thrown * size / reachOut;
        vec2 ellipse = vec2(dot(d, along) / (halfWidth * size + reachOut), dot(d, vec2(-along.y, along.x)) / (halfWidth * size));
        eachShaded = max(eachShaded, 1.0 - smoothstep(0.72, 1.12, length(ellipse)));
      }
    }
    under = mix(under, eachUnder * here, crowned);
    shaded = mix(shaded, eachShaded * here, crowned);
    strip *= 1.0 - crowned;
  }
}

// The top of a far row of crowns seen from far above, as the storm and the flood have left the rows there, the
// same as the hedges and the crowns nearer in: dark glossy green, thinned toward the grey of its wood, bronzed,
// chlorotic in the far blocks' low spots, flushing lime.
vec3 fieldFarStripAlbedo(vec2 p, float tone) {
  float leaves = fieldGround.farStorm.y;
  float drowned = fieldGround.farDecline.x * fieldFarHollow(p, fieldLandOffset(p), fieldGround.farDecline.y);
  float dead = drowned * fieldGround.farDecline.z * fieldGround.farDecline.w;
  vec3 leaf = vec3(0.035, 0.058, 0.021);
  leaf = mix(leaf, vec3(0.045, 0.054, 0.03), fieldGround.farStorm.z * 0.32);
  leaf = mix(leaf, vec3(0.15, 0.158, 0.04), drowned * 0.85);
  leaf = mix(leaf, vec3(0.075, 0.12, 0.02), fieldGround.farStorm.w * (1.0 - drowned) * 0.6);
  float kept = min(leaves, mix(1.0, ${toGlsl(DECLINE_TABLE.foliage)}, drowned));
  vec3 twig = mix(vec3(0.028, 0.03, 0.028), vec3(0.08, 0.079, 0.074), dead);
  float bare = clamp((1.0 - kept) * 0.3 + dead * 0.5, 0.0, 1.0);
  return mix(leaf, twig, bare) * mix(1.0, 0.8, 1.0 - kept) * (1.0 + tone);
}

// Whether this ground is where a site's hole has opened: the mesh then leaves it to the patch.
bool fieldInOpenHole(vec2 p) {
  int count = int(fieldGround.surface.w);
  for (int i = 0; i < count; i++) {
    vec4 hole = texelFetch(fieldTrees, ivec2(i, ${TREE_GRID.rows}), 0);
    vec2 d = p - hole.xy;
    if (dot(d, d) < hole.z * hole.z) return true;
  }
  return false;
}

// ---------------------------------------------------------------- Furrows

// Where a ray meets one quadratic piece of a furrow's profile, z = z0 + k1 e + k2 e^2 with e = |u| - u0 over
// |u| from u0 to u1, along a run of it on which |u| = a + b s and z = dz s from the lid: the first such s from
// 'from_' to 'to', if it is nearer than 'best', which it then becomes, with 'piece' as 'kind'.
void fieldFurrowPieceHit(float a, float b, float dz, float u0, float u1, float z0, float k1, float k2, float from_, float to, float kind, inout float best, inout float piece) {
  float e = a - u0;
  float qa = k2 * b * b;
  float qb = (k1 + 2.0 * k2 * e) * b - dz;
  float qc = z0 + (k1 + k2 * e) * e;
  float first = -1.0;
  float second = -1.0;
  if (abs(qa) < 1e-9) {
    if (abs(qb) > 1e-9) first = -qc / qb;
  } else {
    float discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant >= 0.0) {
      float root = sqrt(discriminant);
      first = (-qb - root) / (2.0 * qa);
      second = (-qb + root) / (2.0 * qa);
    }
  }
  for (int k = 0; k < 2; k++) {
    float s = k == 0 ? first : second;
    float across = a + b * s;
    if (s >= from_ - 1e-5 && s <= to + 1e-5 && across >= u0 - 1e-4 && across <= u1 + 1e-4 && s < best) {
      best = s;
      piece = kind;
    }
  }
}

// Where a ray, from its point on a furrow's lid at the bed's height and pointing down, first meets the land
// under the lid, in metres along it, in closed form for each piece: a floor, a bank, a shoulder's lip or
// apron, or one of the crossing's end ramps. 'piece' says which: 1 floor, 2 bank, 3 shoulder, 4 ramp, 0 the
// lid itself.
float fieldFurrowHit(vec3 start, vec3 d, out float piece) {
  float u0 = fieldFurrowU(start.xy);
  float dz = d.z;
  float best = 1e9;
  piece = 0.0;
  float side = u0 != 0.0 ? sign(u0) : (d.y >= 0.0 ? 1.0 : -1.0);
  // Two runs: on the side it starts, and on the other once it crosses the centre line.
  float crossAt = side * d.y < 0.0 ? -u0 / d.y : 1e9;
  for (int run = 0; run < 2; run++) {
    float from_ = run == 0 ? 0.0 : crossAt;
    float to = run == 0 ? crossAt : 1e9;
    if (from_ >= best || from_ > 1e8) break;
    // |u| along the run is a + b s.
    float b = run == 0 ? side * d.y : abs(d.y);
    float a = (run == 0 ? abs(u0) : 0.0) - b * from_;
    fieldFurrowPieceHit(a, b, dz, 0.0, FIELD_LAND_HALF_FLOOR, FIELD_LAND_FLOOR_Z, 0.0, 0.0, from_, to, 1.0, best, piece);
    fieldFurrowPieceHit(a, b, dz, FIELD_LAND_HALF_FLOOR, FIELD_LAND_HALF_TOP, FIELD_LAND_FLOOR_Z, FIELD_LAND_BANK_SLOPE, 0.0, from_, to, 2.0, best, piece);
    fieldFurrowPieceHit(a, b, dz, FIELD_LAND_HALF_TOP, FIELD_LAND_LIP_END, FIELD_LAND_BANK_TOP_Z, FIELD_LAND_BANK_SLOPE, -FIELD_LAND_LIP_CURVE, from_, to, 3.0, best, piece);
    // The apron, -c (zone - |u|)^2, about its own start.
    fieldFurrowPieceHit(a, b, dz, FIELD_LAND_LIP_END, FIELD_LAND_ZONE, FIELD_LAND_LIP_Z, FIELD_LAND_LIP_SLOPE, -FIELD_LAND_APRON_CURVE, from_, to, 3.0, best, piece);
  }
  // The crossing's end ramps, on the hero's furrow: the land is the higher of a ramp and the furrow.
  if (abs(start.y - FIELD_LAND_FURROW_AT) < FIELD_LAND_ZONE) {
    float k = FIELD_LAND_FLOOR_Z / FIELD_LAND_CROSS_RAMP;
    float below = dz - k * d.x;
    if (abs(below) > 1e-7) {
      float s = k * (start.x - FIELD_LAND_CROSS_TO) / below;
      vec3 at = start + d * s;
      if (s >= -1e-5 && s < best && at.x >= FIELD_LAND_CROSS_TO - 1e-4 && at.x <= FIELD_LAND_CROSS_TO + FIELD_LAND_CROSS_RAMP && abs(at.y - FIELD_LAND_FURROW_AT) < FIELD_LAND_ZONE) {
        best = s;
        piece = 4.0;
      }
    }
    below = dz + k * d.x;
    if (abs(below) > 1e-7) {
      float s = k * (FIELD_LAND_CROSS_FROM - start.x) / below;
      vec3 at = start + d * s;
      if (s >= -1e-5 && s < best && at.x <= FIELD_LAND_CROSS_FROM + 1e-4 && at.x >= FIELD_LAND_CROSS_FROM - FIELD_LAND_CROSS_RAMP && abs(at.y - FIELD_LAND_FURROW_AT) < FIELD_LAND_ZONE) {
        best = s;
        piece = 4.0;
      }
    }
  }
  return best < 1e8 ? max(best, 0.0) : 0.0;
}

// The share of a window of y this wide, around u, that lies within half of a furrow's centre line: a box
// filter of the pulse train of furrows, so a far one runs into its average and never shimmers.
float fieldFurrowShare(float u, float width, float half_) {
  float period = FIELD_LAND_BED_SPACING;
  float window = 0.5 * max(width, 1e-4);
  float low = 0.5 * period - half_;
  float a = u - window + 0.5 * period;
  float b = u + window + 0.5 * period;
  float fa = floor(a / period) * 2.0 * half_ + clamp(a - floor(a / period) * period, low, low + 2.0 * half_) - low;
  float fb = floor(b / period) * 2.0 * half_ + clamp(b - floor(b / period) * period, low, low + 2.0 * half_) - low;
  return clamp((fb - fa) / (b - a), 0.0, 1.0);
}

// The land's slope, as its height's gradient: a furrow's banks and shoulders, the crossing's ramps and the
// bed's crown. The slow noise and the block's fall are too gentle to count. A furrow's shoulder has no crease to
// round; the crease where its floor meets a bank is rounded a few centimetres either way in the light, as rain
// and a spade leave it, though the shape the ray meets keeps it.
vec2 fieldLandSlope(vec2 p) {
  float u = fieldFurrowU(p);
  float across = abs(u);
  float side = u < 0.0 ? -1.0 : 1.0;
  vec2 g = vec2(0.0);
  if (across < FIELD_LAND_ZONE) {
    float crossing = fieldCrossing(p);
    float profile = fieldFurrowProfile(across);
    float rising = across < FIELD_LAND_HALF_TOP ?
      FIELD_LAND_BANK_SLOPE * smoothstep(FIELD_LAND_HALF_FLOOR - 0.07, FIELD_LAND_HALF_FLOOR + 0.07, across) :
      fieldFurrowSlope(across);
    g.y = side * rising;
    if (crossing >= 1.0) {
      g = vec2(0.0);
    } else if (crossing > 0.0) {
      // An end ramp of the crossing, where it stands over the furrow: its crest and where it meets the banks are
      // rounded in the light, as fill settles and grasses over, though the shape the ray meets keeps them.
      float fill = smoothstep(-0.04, 0.04, FIELD_LAND_FLOOR_Z * (1.0 - crossing) - profile);
      float ramp = (p.x > FIELD_LAND_CROSS_TO ? 1.0 : -1.0) * FIELD_LAND_FLOOR_Z / FIELD_LAND_CROSS_RAMP *
        (1.0 - 0.7 * smoothstep(0.84, 1.0, crossing));
      g = mix(g, vec2(ramp, 0.0), fill);
    }
  } else {
    float fromHero = length(p);
    float here = fieldLandCrown(across, fromHero);
    float north = fieldLandCrown(abs(fieldFurrowU(p + vec2(0.0, 0.04))), fromHero);
    g.y = (north - here) / 0.04;
  }
  return g;
}

// ---------------------------------------------------------------- After the water

// Cracks in drying silt: the edges between cells of a jittered lattice, 0-1.
float fieldCracks(vec2 p, float cell) {
  vec2 q = p / cell;
  vec2 id = floor(q);
  vec2 f = q - id;
  float first = 9.0;
  float second = 9.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 at = vec2(float(x), float(y));
      vec2 offset = at + fieldHash2(id + at + 71.0) - f;
      float d = dot(offset, offset);
      if (d < first) {
        second = first;
        first = d;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return 1.0 - smoothstep(0.0, 0.07, sqrt(second) - sqrt(first));
}

// ---------------------------------------------------------------- Water

// Rings where something drops into standing water, as a gradient: cells of 0.38 m at this many rings a
// second each, in up to three layers, more of them as busy goes from 0 to 1. Each ring keeps to the middle
// of its cell, so no cell's edge cuts one off, which a low view would see as bars across the water.
vec2 fieldRings(vec2 p, float busy, float rate, float time, float seed) {
  vec2 sum = vec2(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float index = float(layer);
    vec2 shifted = p + vec2(0.13, 0.29) * index + seed;
    vec2 cell = floor(shifted / 0.38);
    vec2 f = shifted / 0.38 - cell;
    float on = layer == 0 ? busy : step(fieldHash(cell + 17.0 * index + seed), busy) * busy;
    if (on > 0.0) {
      float age = fract(time * rate + fieldHash(cell + 3.1 * index + seed) * 7.0);
      vec2 d = f - (0.3 + 0.4 * fieldHash2(cell + 3.0 + 5.0 * index + seed));
      float r = length(d);
      float ring = sin(r * 62.0 - age * 22.0) * (1.0 - smoothstep(0.04, 0.3 * age + 0.02, r)) * (1.0 - age);
      sum += normalize(d + 1e-4) * ring * on;
    }
  }
  return sum * 0.16;
}

// The wind's own chop, as a gradient: five octaves from wavelets of most of a metre down to capillaries of a
// few centimetres, their crests across the wind, each turned a little off it and running downwind at its own
// speed, so no lattice of the noise shows. An octave a pixel is too big to see fades, and the reflection's
// blur stands in for it.
vec2 fieldWaterChop(vec2 p, float time, vec2 toward, float wind, float footprint) {
  vec2 across = vec2(-toward.y, toward.x);
  vec2 g = vec2(0.0);
  float wavelength = 0.8;
  for (int i = 0; i < 5; i++) {
    float index = float(i);
    float turn = (index - 2.0) * 0.23 + 0.11;
    vec2 along = toward * cos(turn) + across * sin(turn);
    vec2 side = vec2(-along.y, along.x);
    // Short along the wind, long across it.
    vec2 frequency = vec2(1.0, 0.42) / wavelength;
    float speed = 0.35 + 1.1 * wind + 0.9 * sqrt(wavelength);
    vec3 n = fieldNoised(vec2(dot(p, along) * frequency.x - time * speed * frequency.x, dot(p, side) * frequency.y) + index * 17.3);
    float seen = 1.0 - smoothstep(wavelength * 0.12, wavelength * 0.45, footprint);
    // A steepness that holds about even over the octaves, as a wind sea's does.
    float steep = 0.055 * (0.7 + 0.3 * index * 0.25);
    g += (n.y * along + n.z * side * 0.42) * steep * seen;
    wavelength *= 0.5;
  }
  return g;
}

// Rain falling on standing water, as a gradient and a splash: in each cell of a jittered lattice one drop after
// another lands, makes a crater and a crown for its first instants, and a ring a few centimetres across that
// spreads and dies in a third of a second. Three layers of cells, each as busy as the rain, boil the surface.
vec3 fieldRainHits(vec2 p, float rain, float time, float footprint) {
  float fade = 1.0 - smoothstep(0.008, 0.035, footprint);
  if (fade <= 0.0 || rain <= 0.0) return vec3(0.0);
  const float CELL = 0.07;
  vec3 sum = vec3(0.0);
  // A ring is never finer than a pixel's share of it.
  float width = max(0.0035, footprint * 0.7);
  for (int layer = 0; layer < 3; layer++) {
    float index = float(layer);
    vec2 q = p / CELL + vec2(0.41, 0.77) * index;
    vec2 cell = floor(q);
    vec2 f = q - cell;
    float life = mix(0.2, 0.4, fieldHash(cell + 5.1 * index));
    float clock = time / life + fieldHash(cell + 9.7 * index) * 17.0;
    float drop = floor(clock);
    float age = clock - drop;
    // Only as many cells have a drop just now as the rain brings.
    if (fieldHash(cell + vec2(drop * 0.613, index * 1.37 + 0.5)) > rain) continue;
    vec2 centre = 0.22 + 0.56 * fieldHash2(cell + vec2(drop * 1.31, index * 2.7));
    vec2 d = (f - centre) * CELL;
    float r = length(d);
    float radius = 0.003 + 0.021 * sqrt(age);
    float x = (r - radius) / width;
    float ring = -2.0 * x * exp(-x * x) * (1.0 - age) * (1.0 - age);
    float early = 1.0 - smoothstep(0.0, 0.22, age);
    float crater = exp(-r * r / 0.000036) * early;
    sum.xy += (d / max(r, 1e-4)) * (ring * 0.32 - crater * 0.45);
    // The crown it throws up, a white bead for an instant, where a pixel can see one.
    sum.z = max(sum.z, crater * smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.003, 0.012, footprint)));
  }
  return sum * fade;
}

// The bank's own small relief and the tufts of grass on it, which the land's table is too smooth to have, as
// metres up or down: where the water stops, within a few centimetres, wanders with them, and on a steep bank as
// much as on a flat.
float fieldShoreRelief(vec2 p, float slope, float footprint) {
  float fine = 1.0 - smoothstep(0.02, 0.15, footprint);
  float relief = (fieldNoise(p * 2.3 + 17.0) - 0.5) * 0.7 + (fieldNoise(p * 8.9 + 5.0) - 0.5) * 0.3 * (0.4 + 0.6 * fine);
  float tufts = fieldFurrowCover(p) * smoothstep(0.55, 0.82, fieldNoise(p * 13.0 + 2.0)) * fine;
  return relief * mix(0.012, 0.09, smoothstep(0.05, 0.7, slope)) + tufts * mix(0.018, 0.035, smoothstep(0.05, 0.5, slope));
}

// In a furrow, how much a reflection low enough to meet the far bank before the sky sees the bank instead,
// 0-1: from a point 'u' across the furrow, with the water 'below' metres under the bed.
float fieldBankHide(float u, float below, vec3 reflected) {
  if (below <= 0.0) return 0.0;
  float across = abs(reflected.y);
  if (across < 1e-4) return 0.0;
  float toLip = max(FIELD_LAND_ZONE - sign(reflected.y) * u, 0.0);
  float rises = reflected.z / across * toLip;
  return 1.0 - smoothstep(below * 0.7, below * 1.25, rises);
}

// The culvert's pipe where it stands out of each end ramp: corrugated steel, on the furrow's floor, from where it
// leaves the ramp to its own end, its mouth open. How far along a ray from 'start' it meets it, or 1e9; 'part' says
// what it met, 1 its side, 2 the rim of its end, 3 its open mouth; 'along' is where along the pipe that is, in
// metres of x. Through the mouth, 'inside' is how far into the pipe the ray meets its inner wall or the water it
// carries at 'level', which is how much of the daylight at the mouth reaches there.
float fieldPipeHit(vec3 start, vec3 d, float offset, float level, out float part, out vec3 normal, out float inside) {
  part = 0.0;
  inside = 0.0;
  normal = vec3(0.0, 0.0, 1.0);
  float best = 1e9;
  vec2 axis = vec2(FIELD_LAND_FURROW_AT, offset + FIELD_LAND_FLOOR_Z + ${toGlsl(PIPE.radius)});
  vec2 o = vec2(start.y, start.z) - axis;
  vec2 dd = vec2(d.y, d.z);
  float a = dot(dd, dd);
  float b = dot(o, dd);
  float c = dot(o, o) - ${toGlsl(PIPE.radius)} * ${toGlsl(PIPE.radius)};
  float discriminant = b * b - a * c;
  float inner = ${toGlsl(PIPE.radius - PIPE.wall)};
  for (int end = 0; end < 2; end++) {
    float s = end == 0 ? 1.0 : -1.0;
    float top = s > 0.0 ? FIELD_LAND_CROSS_TO : FIELD_LAND_CROSS_FROM;
    float tip = top + s * (FIELD_LAND_CROSS_RAMP + ${toGlsl(PIPE.out)});
    // Its side, out from the ramp, which buries it at each height as far as the ramp has come down.
    if (discriminant > 0.0 && a > 1e-9) {
      float t = (-b - sqrt(discriminant)) / a;
      vec3 at = start + d * t;
      float ramp = top + s * FIELD_LAND_CROSS_RAMP * (at.z - offset) / FIELD_LAND_FLOOR_Z;
      if (t > 0.0 && t < best && s * (at.x - ramp) > 0.0 && s * (tip - at.x) > 0.0) {
        best = t;
        part = 1.0;
        normal = normalize(vec3(0.0, at.y - axis.x, at.z - axis.y));
      }
    }
    // Its end: the thin rim of the steel round its open mouth, and through that, the inside.
    if (abs(d.x) > 1e-6) {
      float t = (tip - start.x) / d.x;
      vec3 at = start + d * t;
      float r = length(vec2(at.y, at.z) - axis);
      if (t > 0.0 && t < best && r < ${toGlsl(PIPE.radius)}) {
        best = t;
        part = r > inner ? 2.0 : 3.0;
        normal = vec3(s, 0.0, 0.0);
        if (part > 2.5) {
          // On into it, to the far side of its wall, or the water in it.
          vec2 oi = vec2(at.y, at.z) - axis;
          float bi = dot(oi, dd);
          float ci = dot(oi, oi) - inner * inner;
          float far = a > 1e-9 ? (-bi + sqrt(max(bi * bi - a * ci, 0.0))) / a : 1e3;
          if (d.z < -1e-6 && level > axis.y - ${toGlsl(PIPE.radius)} && at.z > level) far = min(far, (level - at.z) / d.z);
          inside = abs(d.x) * far;
        }
      }
    }
  }
  return best;
}

// What the nearest crowns and their trunks put in a reflection: soft ellipsoids with leafy rims, tilted as
// the trees lean, and as blurred as the water's roughness blurs everything it mirrors, 'blur' being the
// spread of its rays. The nearest along the ray is in front of what it overlaps.
vec3 fieldMirrorTreesAt(vec3 origin, vec3 dir, vec3 behind, vec3 keyColor, vec3 keyDirection, vec3 ambient, float blur) {
  float nearest = 1e9;
  vec3 nearColor = vec3(0.0);
  float nearCover = 0.0;
  vec3 farColor = vec3(0.0);
  float farCover = 0.0;
  for (int i = 0; i < ${MIRROR_TREES.count}; i++) {
    // A sphere round the whole tree first, so a ray that passes it by costs one read.
    vec4 bound = texelFetch(fieldMirrorTrees, ivec2(i, 0), 0);
    if (bound.w <= 0.0) continue;
    vec3 toTree = bound.xyz - origin;
    float ahead = dot(toTree, dir);
    if (ahead < -bound.w || dot(toTree, toTree) - ahead * ahead > bound.w * bound.w) continue;
    vec4 shape = texelFetch(fieldMirrorTrees, ivec2(i, 1), 0);
    vec4 trunk = texelFetch(fieldMirrorTrees, ivec2(i, 2), 0);
    float leaves = texelFetch(fieldMirrorTrees, ivec2(i, 3), 0).x;
    vec4 crown = vec4(bound.xyz, shape.x);
    vec3 axis = vec3(shape.z, shape.w, sqrt(max(1.0 - shape.z * shape.z - shape.w * shape.w, 0.0)));
    vec3 side = abs(axis.z) > 0.999 ? vec3(1.0, 0.0, 0.0) : normalize(cross(vec3(0.0, 0.0, 1.0), axis));
    vec3 front = cross(axis, side);
    vec3 radii = vec3(shape.x, shape.x, shape.y);
    vec3 o = origin - crown.xyz;
    vec3 lo = vec3(dot(o, side), dot(o, front), dot(o, axis)) / radii;
    vec3 ld = vec3(dot(dir, side), dot(dir, front), dot(dir, axis)) / radii;
    float a = dot(ld, ld);
    float b = dot(lo, ld);
    float c = dot(lo, lo) - 1.0;
    float t = -b / a;
    float cover = 0.0;
    vec3 tint = vec3(0.0);
    float hitAt = 1e9;
    vec3 closest = lo + ld * t;
    float reach = length(closest);
    // How soft its edge is, in its own size: a leafy edge, and what the water's roughness blurs it by there.
    float soft = 0.16 + blur * max(t, 0.0) / max(shape.x, 0.1);
    // The rim never reaches past its size and its blur, so a ray that passes further off misses it.
    if (t > 0.0 && reach < 1.05 + soft) {
      vec3 around = closest / max(reach, 1e-4);
      float sharp = 1.0 - smoothstep(0.2, 0.7, soft);
      float leafy = fieldNoise(around.xy * 3.1 + around.z * 2.3 + float(i) * 3.1) * 0.55 +
        fieldNoise(around.xy * 8.3 + around.z * 5.9 + float(i) * 1.7) * 0.3 +
        fieldNoise(around.xy * 19.0 + float(i) * 0.7) * 0.15;
      float rim = mix(0.85, 0.66 + 0.4 * leafy, sharp);
      // A thinned crown lets the sky through in holes as well as at its edge.
      float holes = mix(1.0, smoothstep(0.25, 0.6, fieldNoise(closest.xy * 4.1 + closest.z * 3.3 + float(i) * 5.3)), (1.0 - leaves) * sharp);
      cover = (1.0 - smoothstep(rim - soft, rim + soft * 0.5, reach)) * mix(0.3, 1.0, leaves) * holes;
      if (cover > 0.0) {
        float entry = t - sqrt(max(b * b - a * c, 0.0)) / a;
        vec3 hit = lo + ld * max(entry, 0.0);
        hitAt = max(entry, 0.0);
        vec3 normal = normalize(side * hit.x / radii.x + front * hit.y / radii.y + axis * hit.z / radii.z);
        float lit = max(dot(normal, keyDirection), 0.0);
        float shade = 0.55 + 0.45 * fieldNoise(hit.xy * 9.0 + hit.z * 5.0 + float(i));
        tint = vec3(0.032, 0.052, 0.02) * (ambient * mix(0.3, 0.75, 0.5 + 0.5 * normal.z) + keyColor * lit * 0.35) * shade;
      }
    }
    // Its trunk, up its axis from the ground into the crown.
    vec3 w = origin - trunk.xyz;
    float along = dot(dir, axis);
    float apart = 1.0 - along * along;
    if (apart > 1e-5 && trunk.w > 0.0) {
      float onRay = (along * dot(w, axis) - dot(w, dir)) / apart;
      float onAxis = (dot(w, axis) - along * dot(w, dir)) / apart;
      float length_ = max(dot(crown.xyz - trunk.xyz, axis), 0.0);
      float gap = length(w + dir * onRay - axis * onAxis);
      float edge = trunk.w + blur * max(onRay, 0.0);
      if (onRay > 0.0 && onAxis > 0.0 && onAxis < length_ && gap < edge && onRay < hitAt) {
        hitAt = onRay;
        cover = max(cover, (1.0 - smoothstep(trunk.w * 0.5, edge, gap)) * (1.0 - smoothstep(length_ * 0.8, length_, onAxis) * 0.6));
        tint = vec3(0.05, 0.04, 0.034) * ambient * 0.6;
      }
    }
    if (cover > 0.0) {
      if (hitAt < nearest) {
        farColor = mix(farColor, nearColor, nearCover / max(max(farCover, nearCover), 1e-4));
        farCover = max(farCover, nearCover);
        nearest = hitAt;
        nearColor = tint;
        nearCover = cover;
      } else {
        farColor = mix(farColor, tint, cover / max(max(farCover, cover), 1e-4));
        farCover = max(farCover, cover);
      }
    }
  }
  vec3 color = mix(behind, farColor, farCover);
  return mix(color, nearColor, nearCover);
}

// The far rows along the foot of a reflection, past the block of real trees: a dark band of hedges, as thin as
// the storm has left them, and as soft as the water's roughness blurs it.
vec3 fieldMirrorHedges(vec3 origin, vec3 dir, vec3 color, vec3 ambient, float blur) {
  float height = fieldGround.rows.x;
  float along = length(dir.xy);
  if (height <= 0.0 || along < 1e-4) return color;
  vec2 flat_ = dir.xy / along;
  vec2 extent = fieldPlan.rows.zw;
  float toX = abs(flat_.x) > 1e-4 ? (sign(flat_.x) * extent.x - origin.x) / flat_.x : 1e9;
  float toY = abs(flat_.y) > 1e-4 ? (sign(flat_.y) * extent.y - origin.y) / flat_.y : 1e9;
  float out_ = max(min(toX, toY), 2.0);
  float rise = dir.z / along;
  // Crowns along its top, which run together into one line the further off they are.
  float teeth = fieldNoise(vec2(atan(flat_.y, flat_.x) * 60.0, 3.0)) * (1.0 - smoothstep(60.0, 260.0, out_));
  float top = height * (0.86 + 0.24 * teeth) / out_;
  float soft = max(top * 0.35, blur * 0.6);
  float leaves = fieldGround.rows.w;
  float hedge = (1.0 - smoothstep(top - soft, top + soft * 0.4, rise)) * fieldRowsHere(length(origin.xy) + out_) *
    (1.0 - fieldGround.rows.z) * mix(0.55, 1.0, leaves);
  return mix(color, vec3(0.03, 0.045, 0.022) * ambient * 0.55, hedge);
}

// Standing water at a point on it, which 'view' looks at from the eye: luma's waves, the wind's chop, the rain's
// hits and rings and the drips' rings, Fresnel from 0.02 over the sky probe, the far rows and the nearest
// crowns, or a furrow's own far bank where it stands in the way of the sky, the sun's glint, foam, and a tannic
// body that hides the bottom it lies on by 25 cm. 'shore' is metres from the water's edge across it, 'edge' the
// way to that edge, 'fetch' how many metres of water the wind has run over to get here, and 'ditch', in a
// furrow, where across it this is and how far under the bed the water stands. 'bankColor' is what a far bank
// gives a reflection. 'footprint' is the long side of what a pixel covers of the water, and 'pixel' the two
// steps across the water that a pixel to the right and one up make, in metres.
vec3 fieldWater(vec3 at, vec3 view, float depth, vec3 bottom, float shadowLight, vec3 keyColor, vec3 keyDirection, vec3 ambient, float footprint, vec4 pixel, float underCrowns, float shore, vec2 edge, float fetch, vec2 ditch, vec3 bankColor) {
  float wind = fieldGround.wind.x;
  vec2 toward = fieldGround.wind.yz;
  float time = fieldGround.eye.w;
  float rain = clamp(fieldGround.surface.z, 0.0, 1.0);
  float calm = fieldFlood.water.z;
  float fine = 1.0 - smoothstep(0.02, 0.08, footprint);
  // luma's two waves, gone where a pixel is too big to see them, as far off they would only make ladders.
  vec3 waved = water_getNormal(at, at, vec3(0.0, 0.0, 1.0), at.xy);
  vec2 slope = waved.xy / max(waved.z, 0.2) * (1.0 - smoothstep(0.05, 0.22, footprint));
  // Cat's paws: where a front of the trees' gusts crosses it, it roughens.
  float gust = wind > 0.05 ? treeWind_getGust(at.xy, fieldGround.wind.w, toward, wind, 0.0) : 0.0;
  // Never still: a breath of air ruffles even the eye's water and the flood's last week of it.
  float rough = 0.07 + 0.91 * wind * wind;
  slope += fieldWaterChop(at.xy, time, toward, wind, footprint) * rough * (1.0 + 1.2 * gust) * 1.7;
  // Rain: from light rain on, a dense field of small hits that boils it in a downpour, and in a light one, rings.
  vec3 hits = fieldRainHits(at.xy, smoothstep(0.03, 0.85, rain), time, footprint);
  slope += hits.xy;
  float sparse = rain * (1.0 - smoothstep(0.3, 0.6, rain));
  slope += fieldRings(at.xy, pow(sparse, 0.7), 1.7, time, 0.0) * fine * 0.6;
  // Drips from wet crowns once the rain has stopped, and a ring or two anywhere, so it never lies dead still.
  float drips = fieldGround.shade.w * underCrowns * (1.0 - rain);
  slope += fieldRings(at.xy, max(drips * 0.55, 0.06), 0.45, time, 31.0) * fine * 0.5;
  vec3 normal = normalize(vec3(slope, 1.0));
  float facing = max(dot(normal, view), 0.0);
  // Roughness too fine to see still turns some facets toward the eye: rough water shows more of its body low
  // down than a mirror would, and less sky.
  float unseen = clamp(rough * 1.3 + rain * smoothstep(0.004, 0.04, footprint) * 0.6, 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - mix(facing, max(facing, 0.25), unseen * 0.5), 5.0);
  vec3 reflected = reflect(-view, normal);
  reflected.z = max(reflected.z, 0.002);
  reflected = normalize(reflected);
  // What the eye cannot see of the ripples still blurs what the water mirrors.
  float spread = 0.012 + 0.45 * rough * (1.0 - 0.6 * calm) + 0.2 * smoothstep(0.02, 0.5, footprint) * rough +
    0.16 * rain * (1.0 - fine);
  // The sky probe, or the sky still water would mirror here, worked out where the mesh is.
  vec3 mirror = fieldGround.shade.z > 0.5 ? fieldMirror(reflected, spread, 1.0) : vMirror;
  mirror = fieldMirrorHedges(at, reflected, mirror, ambient, spread);
  mirror = fieldMirrorTreesAt(at, reflected, mirror, keyColor, keyDirection, ambient, spread);
  // Down in a furrow, a low reflection meets the far bank before it reaches the sky, or the sun.
  float banked = fieldBankHide(ditch.x, ditch.y, reflected);
  mirror = mix(mirror, bankColor, banked);
  // The body: tea-brown and turbid, lit by the sky and the key through its surface, and the bottom through it,
  // down and back. Tannin takes more light than silt sends back, and more the deeper it goes, so a deep channel
  // is darker than the sheet beside it; churned, it carries more silt and is paler.
  // Rain and wind churn silt up off the bottom and wash it in off the land: then it is muddy, paler and browner,
  // and still, it is the dark of strong tea under a sheen of sky.
  float churn = clamp(rain * 0.75 + wind * wind * 0.9, 0.0, 1.0);
  // Still, enough light gets in and back out that, looked down into, it is the color of tea under the sky it
  // mirrors, and a high sun lights it right through, so a shallow ribbon glows; churned, the silt does that, and
  // no key gets through it, so the storm's high grey key leaves its body as dark as the silt alone makes it.
  vec3 lightIn = ambient * mix(0.42, 0.28, churn) + keyColor * max(keyDirection.z, 0.0) * shadowLight * mix(0.15, 0.32, smoothstep(0.4, 0.85, keyDirection.z) * (1.0 - churn));
  vec3 body = WATER_BODY * lightIn * mix(1.0, 0.62, smoothstep(0.15, 0.7, depth)) * (1.0 + 4.0 * churn);
  // Clouds of silt it carries, drifting with it.
  vec2 drifted = at.xy - vec2(time * 0.15, 0.0);
  body *= 0.78 + 0.44 * (fieldNoise(drifted * 0.21 + 4.1) * 0.65 + fieldNoise(drifted * 0.9 + 8.3) * 0.35);
  float cosOut = sqrt(max(1.0 - (1.0 - facing * facing) / 1.7689, 0.05));
  // Tannin takes the blue first and the red last, so a shallow bottom shows through it the amber of tea.
  vec3 through = exp(-(depth / cosOut + depth) / (${toGlsl(WATER.extinction)} * vec3(1.5, 1.0, 0.5)));
  // After the storm, still water left standing for days carries a film of scum, pollen and silt that dulls its
  // mirror, so what it shows is tea as much as sky, even where the sky near the sun is at its brightest.
  float after = smoothstep(43.5, 45.5, fieldFlood.more.z) * (1.0 - smoothstep(50.4, 50.8, fieldFlood.more.z));
  float filmed = after * calm * smoothstep(46.5, 48.5, fieldFlood.more.z);
  float mirrored = fresnel * (1.0 - 0.45 * filmed);
  float brightest = max(max(mirror.r, mirror.g), mirror.b);
  mirror *= mix(1.0, 1.0 / (1.0 + 0.35 * max(brightest - 0.8, 0.0)), filmed);
  vec3 color = mix(body * (1.0 - through) + bottom * through, mirror, mirrored);
  // The sun on it, under the shadow: luma's sheen, which is the glitter of a ruffled surface and no part of a
  // still one's, and the facets that catch the disc itself.
  float shine = (1.0 - 0.75 * unseen) * (1.0 - banked);
  float ruffled = smoothstep(0.04, 0.35, rough + 0.6 * rain);
  color += water_getSpecularContribution(keyDirection, view, normal, keyColor, fresnel) * shadowLight * shine * ruffled;
  // The disc's own image is as small as the sun on still water, and spreads into a glitter as it roughens, and
  // it is only as bright as the water reflects at that angle.
  float disc = mix(9000.0, 1400.0, ruffled);
  color += keyColor * pow(max(dot(reflected, keyDirection), 0.0), disc) * 6.0 * min(mirrored * 5.0, 1.0) * mix(2.5, 1.0, ruffled) * shadowLight * shine;
  if (lighting.directionalLightCount > 1) {
    DirectionalLight flash = lighting_getDirectionalLight(1);
    color += fieldLightColor(flash.color) * (0.7 * fresnel + 0.4 * (1.0 - fresnel) * WATER_BODY);
  }

  // Foam, pale and stained by the tannin it is whipped from.
  float foam = fieldFlood.water.w;
  vec2 acrossWind = vec2(-toward.y, toward.x);
  vec2 q = vec2(dot(at.xy, toward), dot(at.xy, acrossWind));
  // Streaks along the wind over 0.4, where it has open water to raise them over: thin, broken and wandering,
  // and only where a pixel is fine enough across them, as further off they would only alias into ladders.
  float wander = (fieldNoise(vec2(q.x * 0.21, q.y * 0.6) + 5.0) - 0.5) * 1.6;
  float streaks = smoothstep(0.7, 0.9, fieldNoise(vec2(q.x * 0.3 - time * wind * 6.0, (q.y + wander) * 7.5))) *
    smoothstep(0.55, 0.85, fieldNoise(vec2(q.x * 1.7 - time * wind * 4.0, q.y * 1.3) + 17.0)) *
    smoothstep(0.4, 0.7, wind) * foam * smoothstep(4.0, 15.0, fetch) * (1.0 - smoothstep(0.02, 0.07, footprint)) * 0.4;
  // Flecks of spume the wind tears off the chop and drives along it, a furrow's as well as a sheet's.
  float flecks = 0.6 * smoothstep(0.86, 0.97, fieldNoise(vec2(q.x * 6.3 - time * (2.0 + 9.0 * wind), q.y * 23.0) + 31.0)) *
    smoothstep(0.45, 0.8, fieldNoise(at.xy * 2.1 + vec2(-time * wind, 5.0))) * smoothstep(0.45, 0.8, wind) * foam *
    (0.35 + 0.5 * gust) * (1.0 - smoothstep(0.02, 0.12, footprint));
  // Lines of it driven onto the banks the wind that made it blew toward, which keep it after the wind drops or
  // turns: lace that hugs the shore, out to between 3 and 12 cm by turns, in runs and gaps of every length, and
  // none further out. Its holes go to their mean where a pixel is too long along the bank to see them, and a
  // band thinner than a pixel across it is only its share of one, so it never strings out into dashes.
  float onto = smoothstep(0.1, 0.6, dot(edge, fieldGround.heroMore.zw));
  float lines = 0.0;
  if (onto > 0.0 && foam > 0.0 && shore < 0.3) {
    vec2 alongBank = vec2(edge.y, -edge.x);
    float a = dot(at.xy, alongBank);
    float alongPixel = abs(dot(pixel.xy, alongBank)) + abs(dot(pixel.zw, alongBank));
    float acrossPixel = abs(dot(pixel.xy, edge)) + abs(dot(pixel.zw, edge));
    float seenRuns = 1.0 - smoothstep(0.1, 0.35, alongPixel);
    float runs = fieldNoise(vec2(a * 0.29, 7.0)) * 0.5 + fieldNoise(vec2(a * 0.97 + 2.0, 11.0)) * 0.3 +
      mix(0.5, fieldNoise(vec2(a * 3.1 + 5.0, 13.0)), seenRuns) * 0.2;
    float reach = mix(0.03, 0.12, smoothstep(0.2, 0.8, fieldNoise(vec2(a * 0.71 + 3.0, 5.0)) * 0.65 +
      mix(0.5, fieldNoise(vec2(a * 2.3, 9.0)), seenRuns) * 0.35));
    float band = (1.0 - smoothstep(reach * 0.3, reach + acrossPixel, shore)) * min(reach / max(acrossPixel, reach), 1.0) *
      smoothstep(0.38, 0.5, runs);
    float seenHoles = 1.0 - smoothstep(0.008, 0.035, alongPixel);
    float holes = fieldNoise(vec2(a * 23.0 + time * 0.05, shore * 37.0)) * 0.6 + fieldNoise(vec2(a * 61.0, shore * 71.0 + 2.0)) * 0.4;
    float lace = mix(0.55, smoothstep(0.4, 0.62, holes), seenHoles);
    lines = band * lace * onto * foam;
  }
  // Its bubbles, where a pixel can see them.
  float bubbles = mix(1.0, 0.45 + 0.75 * smoothstep(0.3, 0.7, fieldNoise(at.xy * 170.0)), 1.0 - smoothstep(0.004, 0.015, footprint));
  float froth = clamp(max(max(streaks, flecks), lines * bubbles) * (1.0 - smoothstep(0.06, 0.6, footprint) * 0.5) + hits.z * 0.35, 0.0, 1.0);
  vec3 foamColor = vec3(0.46, 0.41, 0.31) * (ambient * 0.95 + keyColor * max(keyDirection.z, 0.0) * shadowLight * 0.8);
  color = mix(color, foamColor, froth);
  // A meniscus where it meets the land: the thinnest line of sky, broken, and nothing once a pixel is too big for it.
  float meniscus = (1.0 - smoothstep(0.0, 0.004 + footprint * 0.5, shore)) * min(0.004 / max(footprint, 1e-4), 1.0) *
    smoothstep(0.4, 0.65, fieldNoise(at.xy * 23.0));
  return mix(color, mirror * 1.15, meniscus * 0.5);
}

// ---------------------------------------------------------------- The surface

vec3 grassColor(vec2 p, float dryness) {
  vec3 lush = vec3(0.06, 0.084, 0.034);
  vec3 straw = vec3(0.14, 0.122, 0.068);
  return mix(lush, straw, dryness);
}

void main() {
  vec3 mesh = vWorld;
  bool isSite = fieldGround.site.w > 0.5;
  if (!isSite && fieldGround.surface.w > 0.5 && fieldInOpenHole(mesh.xy)) discard;

  float meshDepth = vClip.x / vClip.y * 0.5 + 0.5;
  if (meshDepth < 0.0) discard;

  vec3 eye = fieldGround.eye.xyz;
  vec3 fromEye = mesh - eye;
  float meshDistance = length(fromEye);
  vec3 ray = fromEye / max(meshDistance, 1e-5);
  vec3 view = -ray;

  // What a pixel covers, from its ray and its neighbours' rays where they meet the level plane through the
  // mesh's point. They run smoothly over the frame whatever the mesh's triangles do, so nothing here shows a
  // facet of them. Its short axis sets what can be seen, its long one what would alias across it.
  vec3 rayDx = dFdx(ray);
  vec3 rayDy = dFdy(ray);
  float rayDown = ray.z < 0.0 ? min(ray.z, -1e-4) : max(ray.z, 1e-4);
  vec2 dx = (meshDistance * (rayDx - ray * (rayDx.z / rayDown))).xy;
  vec2 dy = (meshDistance * (rayDy - ray * (rayDy.z / rayDown))).xy;
  float longAxis = sqrt(max(dot(dx, dx), dot(dy, dy)));
  float shortAxis = sqrt(max(min(dot(dx, dx), dot(dy, dy)), 1e-14));
  // Between the two, as an accumulator's jitter averages the rest away; but never so far under the long axis
  // that a low view's pixels, each a long way along the ground, alias into streaks the jitter cannot average.
  float meshFootprint = max(max(sqrt(longAxis * shortAxis), longAxis * 0.42), 1e-5);
  // What a low view of water would alias along first.
  float meshReach = max(longAxis, 1e-5);
  float meshYWidth = abs(dx.y) + abs(dy.y);

  // ---- Where the ray meets the land, and whether water is in its way.
  float level = fieldFlood.water.x;
  float mark = fieldFlood.water.y;
  float furrowU = fieldFurrowU(mesh.xy);
  // The land's own height is wanted only where a furrow is cut or water could stand or has stood: anywhere
  // else the mesh is the land, and a dry frame pays nothing for it.
  bool wantsLand = isSite || abs(furrowU) < FIELD_LAND_ZONE + 0.5 || level > FIELD_LAND_BANK_TOP_Z - 0.1 || mark > level + 0.001;
  float landOffset = wantsLand ? fieldLandOffset(mesh.xy) : mesh.z;
  // A furrow keeps its own shape while it is a few pixels across, and turns into a tint past that.
  float tinted = isSite ? 0.0 : smoothstep(${toGlsl(BED_LAYOUT.furrowTop / WATER.detailPixels)}, ${toGlsl(BED_LAYOUT.furrowTop / WATER.tintPixels)}, meshYWidth);
  bool inFurrow = !isSite && abs(furrowU) < FIELD_LAND_ZONE && fieldCrossing(mesh.xy) < 1.0 &&
    ray.z < -1e-4 && tinted < 1.0 && eye.z > landOffset;
  float piece = 0.0;
  float landDistance = meshDistance;
  float pipePart = 0.0;
  float pipeInside = 0.0;
  vec3 pipeNormal = vec3(0.0, 0.0, 1.0);
  if (inFurrow) {
    float toLid = (landOffset - eye.z) / ray.z;
    vec3 lid = eye + ray * toLid;
    float s = fieldFurrowHit(lid, ray, piece);
    // The culvert's pipe, standing out of its end ramps in front of what it lies on.
    if (abs(abs(lid.x) - ${toGlsl(BED_LAYOUT.crossing.x[1] + BED_LAYOUT.crossing.ramp)}) < 3.0 && abs(lid.y - FIELD_LAND_FURROW_AT) < FIELD_LAND_ZONE) {
      float pipeAt = fieldPipeHit(lid, ray, landOffset, fieldFlood.water.x, pipePart, pipeNormal, pipeInside);
      if (pipeAt < s) {
        s = pipeAt;
        piece = 5.0;
      }
    }
    landDistance = toLid + s * (1.0 - tinted);
  }
  vec3 world = inFurrow ? eye + ray * landDistance : mesh;
  vec2 p = world.xy;

  // What a pixel covers there: in a furrow, on the plane of the floor, bank, shoulder or pipe the ray met, so a
  // bank that faces the eye is as sharp as it is near, and one turned away as soft.
  float landScale = landDistance / max(meshDistance, 1e-5);
  float footprint = meshFootprint * landScale;
  float yWidth = meshYWidth * landScale;
  float xWidth = (abs(dx.x) + abs(dy.x)) * landScale;
  if (inFurrow && piece > 0.5) {
    vec3 facingNormal = piece > 4.5 ? pipeNormal : normalize(vec3(-fieldLandSlope(p), 1.0));
    float facing = dot(facingNormal, ray);
    facing = facing < 0.0 ? min(facing, -0.03) : max(facing, 0.03);
    vec2 sx = (landDistance * (rayDx - ray * (dot(facingNormal, rayDx) / facing))).xy;
    vec2 sy = (landDistance * (rayDy - ray * (dot(facingNormal, rayDy) / facing))).xy;
    float longSide = sqrt(max(dot(sx, sx), dot(sy, sy)));
    float shortSide = sqrt(max(min(dot(sx, sx), dot(sy, sy)), 1e-14));
    footprint = clamp(max(sqrt(longSide * shortSide), longSide * 0.42), 1e-5, footprint * 4.0);
    yWidth = min(abs(sx.y) + abs(sy.y), yWidth * 4.0);
    xWidth = min(abs(sx.x) + abs(sy.x), xWidth * 4.0);
  }

  vec3 keyColor = vec3(0.0);
  vec3 keyDirection = vec3(0.0, 0.0, 1.0);
  if (lighting.directionalLightCount > 0) {
    DirectionalLight key = lighting_getDirectionalLight(0);
    keyColor = fieldLightColor(key.color);
    keyDirection = normalize(-key.direction);
  }
  vec3 halfway = normalize(keyDirection + view);
  vec2 sunward = keyDirection.xy / max(keyDirection.z, 0.12);

  float wetness = fieldGround.surface.x;
  float frost = fieldGround.surface.y;
  float rain = fieldGround.surface.z;
  float fromHero = length(p);

  // Plantings. A watered basin is wet inside its berm, and the berm's crest stays dry and pale above it.
  float soil = 0.0;
  float basin = 0.0;
  float crest = 0.0;
  float plantingZ = 0.0;
  vec2 plantingGradient = vec2(0.0);
  if (isSite) {
    vec2 center = fieldGround.site.xy;
    vec2 d = p - center;
    float r = length(d);
    vec2 toward = d / max(r, 1e-4);
    float e = 0.012;
    float z0 = fieldPlantingHeight(r, toward, fieldGround.siteMore.x, ${SITE_SHAPE.holeRadius.toFixed(2)}, ${SITE_SHAPE.holeDepth.toFixed(2)}, fieldGround.siteMore.y, ${SITE_SHAPE.bermRadius.toFixed(2)});
    float z1 = fieldPlantingHeight(r + e, toward, fieldGround.siteMore.x, ${SITE_SHAPE.holeRadius.toFixed(2)}, ${SITE_SHAPE.holeDepth.toFixed(2)}, fieldGround.siteMore.y, ${SITE_SHAPE.bermRadius.toFixed(2)});
    plantingZ = z0;
    plantingGradient = toward * (z1 - z0) / e;
    soil = fieldPlantingSoil(r, fieldGround.siteMore.x, ${SITE_SHAPE.holeRadius.toFixed(2)}, fieldGround.siteMore.y, ${SITE_SHAPE.bermRadius.toFixed(2)});
    basin = fieldGround.siteMore.z * (1.0 - smoothstep(${SITE_SHAPE.bermRadius.toFixed(2)} * 0.55, ${SITE_SHAPE.bermRadius.toFixed(2)} * 0.88, r));
    crest = fieldPlantingCrest(r, fieldGround.siteMore.y, ${SITE_SHAPE.bermRadius.toFixed(2)});
  } else {
    float heroHole = fieldGround.hero.x;
    float heroBerm = fieldGround.hero.w;
    if (fromHero < 3.0 && (heroHole > 0.0 || heroBerm > 0.0 || fieldGround.heroMore.y > 0.0)) {
      vec2 toward = p / max(fromHero, 1e-4);
      float e = 0.01;
      float z0 = fieldPlantingHeight(fromHero, toward, heroHole, fieldGround.hero.y, fieldGround.hero.z, heroBerm, fieldGround.heroMore.x);
      float z1 = fieldPlantingHeight(fromHero + e, toward, heroHole, fieldGround.hero.y, fieldGround.hero.z, heroBerm, fieldGround.heroMore.x);
      plantingZ = z0;
      plantingGradient = toward * (z1 - z0) / e;
      soil = fieldPlantingSoil(fromHero, heroHole, fieldGround.hero.y, heroBerm, fieldGround.heroMore.x);
      basin = fieldGround.heroMore.y * (1.0 - smoothstep(fieldGround.heroMore.x * 0.55, fieldGround.heroMore.x * 0.88, fromHero));
      crest = fieldPlantingCrest(fromHero, heroBerm, fieldGround.heroMore.x);
    }
  }

  // The land here.
  float landHeight = inFurrow ? world.z : (wantsLand ? fieldLandOver(p, landOffset) + plantingZ : mesh.z);
  world.z = landHeight;
  vec2 landSlope = fieldLandSlope(p);
  float slopeSize = max(length(landSlope), 0.004);

  // ---- The water over it. Its edge wanders a few centimetres either way of where the land's table puts it,
  // with the bank's own relief and its tufts: a bump the water would cover stands out of it as soaked ground at
  // its surface, and a dip it would not reach holds a film of it.
  float relief = 0.0;
  if (!isSite && abs(level - landHeight) < 0.12) relief = fieldShoreRelief(p, slopeSize, footprint);
  bool canSeeWater = !isSite && ray.z < -1e-5 && eye.z > level;
  bool under = level > landHeight + 1e-5;
  bool isWater = canSeeWater && level > landHeight + relief;
  float waterDistance = landDistance;
  vec3 surfacePoint = world;
  bool atSurface = canSeeWater && under;
  if (atSurface) {
    waterDistance = (level - eye.z) / ray.z;
    surfacePoint = eye + ray * waterDistance;
    if (!isWater) {
      world = surfacePoint;
      p = world.xy;
      landHeight = level;
      fromHero = length(p);
      landSlope = fieldLandSlope(p);
      slopeSize = max(length(landSlope), 0.004);
    }
  }
  float surfaceDistance = atSurface ? waterDistance : (inFurrow ? landDistance : meshDistance);
  float depth = meshDepth;
  if (inFurrow || atSurface) {
    vec4 clip = fieldGround.viewProjection * vec4(surfacePoint, 1.0);
    depth = clip.z / clip.w * 0.5 + 0.5;
  }
  gl_FragDepth = clamp(depth, 0.0, 0.99999);
  float distanceToEye = surfaceDistance;

  // Where things are.
  float rowsHere = fieldRowsHere(fromHero);
  float cover = piece > 4.5 ? 0.0 : fieldGrassCover(p, yWidth);
  float nearNoise = footprint < 0.3 ? fieldNoise(p * 1.3 + 9.0) : 0.5;
  // Slow tones of the land, how pale the sand and how dry the grass, worked out here rather than at the mesh's
  // corners, which would cut them into its facets, and their finer part gone where a pixel is too big for it.
  vec2 slow = vec2(
    fieldNoise(p * 0.11 + 13.0) * 0.64 + mix(fieldNoise(p * 0.6 + 19.0), 0.5, smoothstep(0.4, 1.6, footprint)) * 0.36,
    fieldNoise(p * 0.21 + 4.0)
  );
  float dryness = smoothstep(0.35, 0.8, slow.y * 0.7 + nearNoise * 0.3);
  float strip = fieldStrip(p, yWidth) * rowsHere;

  // Under the trees.
  float skyLeft;
  float litter;
  float directLeft;
  fieldUnderTrees(p, skyLeft, litter, directLeft);
  float farUnder;
  float farShaded;
  float farStrip;
  fieldFarRows(p, fromHero, yWidth, footprint, keyDirection, ray, farUnder, farShaded, farStrip);
  skyLeft *= 1.0 - 0.7 * farUnder;
  directLeft *= 1.0 - 0.92 * farShaded;
  litter = max(litter, farUnder * 0.8);

  // How much of the land here is a furrow's dug bank and floor, and how much the crossing's fill on its end
  // ramps, rather than the bed: by where it is across the furrow, and how far the fill stands over the dug
  // profile, each with an edge that wanders, so nothing about a furrow changes along a straight line.
  float acrossLand = abs(fieldFurrowU(p));
  float dug = 0.0;
  float rampFill = 0.0;
  if (!isSite && acrossLand < FIELD_LAND_ZONE + 0.25) {
    float wobble = (fieldNoise(vec2(p.x * 0.9, acrossLand * 2.0) + 43.0) - 0.5) * 0.18 + (fieldNoise(p * 4.3 + 11.0) - 0.5) * 0.08;
    // A furrow too far to draw is a tint of its own.
    dug = (1.0 - smoothstep(FIELD_LAND_HALF_TOP - 0.12, FIELD_LAND_LIP_END + 0.16, acrossLand + wobble)) * (1.0 - tinted);
    float crossingHere = fieldCrossing(p);
    if (crossingHere > 0.0) {
      float fill = FIELD_LAND_FLOOR_Z * (1.0 - crossingHere) - fieldFurrowProfile(acrossLand) + (fieldNoise(p * 3.1 + 5.0) - 0.5) * 0.05;
      float filled = smoothstep(-0.05, 0.06, fill);
      dug *= 1.0 - filled;
      rampFill = crossingHere < 1.0 ? filled * (1.0 - smoothstep(0.85, 1.0, crossingHere)) : 0.0;
    }
  }

  // Sand, all the way down from what a pixel covers.
  vec2 gradient = plantingGradient + landSlope;
  float tone = 0.0;
  fieldLadder(p, footprint, 0.3, gradient, tone);
  // A dug bank, or a ramp of fill, is never a plane: lumps and slumps the spade and the rain left, from a third
  // of a metre to a metre across, which break up its light as they would its outline. They come and go with the
  // bank, not at a line.
  float lumpy = max(dug * mix(0.5, 1.0, smoothstep(FIELD_LAND_HALF_FLOOR - 0.05, FIELD_LAND_HALF_FLOOR + 0.12, acrossLand)), rampFill);
  if (lumpy > 0.0) {
    lumpy *= 1.0 - smoothstep(0.1, 0.45, footprint);
    gradient += (fieldNoised(p * 1.1 + 71.0).yz * 1.1 * 0.09 + fieldNoised(p * 2.9 + 17.0).yz * 2.9 * 0.028) * lumpy;
  }

  vec3 sand = vec3(0.305, 0.275, 0.22);
  float paleness = slow.x * 0.85 + (footprint < 0.1 ? fieldNoise(p * 3.7 + 29.0) : 0.5) * 0.15;
  sand *= mix(vec3(0.7, 0.68, 0.66), vec3(1.08, 1.06, 1.03), smoothstep(0.26, 0.72, paleness));
  vec3 albedo = sand * (1.0 + tone);
  // Flecks of darker stuff, at every scale a pixel can see. Natural ground has more of these than noise does.
  float fleckScale = max(footprint * 1.8, 0.006);
  float flecks = fieldNoiseScaled(p, fleckScale, 3.7) * fieldNoiseScaled(p, fleckScale * 3.3, 8.3);
  albedo *= 1.0 - 0.55 * smoothstep(0.42, 0.72, flecks) * (1.0 - smoothstep(0.05, 0.8, footprint));

  float occlusion = 1.0;
  float glint = 0.0;
  float grainFade = 1.0 - smoothstep(0.00028, 0.0011, footprint);
  if (grainFade > 0.0) {
    fieldGrains(p, 0.00052, 1.0, grainFade, albedo, gradient, glint, halfway);
    fieldGrains(p + 0.00013, 0.00031, 5.0, grainFade * 0.35, albedo, gradient, glint, halfway);
  }
  // Below the grains' size but still too fine for the bands: a sand's fine tooth, as a pixel sees it.
  float tooth = (1.0 - grainFade) * (1.0 - smoothstep(0.0025, 0.03, footprint));
  if (tooth > 0.0) {
    float n = fieldNoiseScaled(p, footprint * 1.3, 1.9);
    albedo *= 1.0 + (n - 0.5) * 0.5 * tooth;
    gradient += (vec2(fieldNoiseScaled(p, footprint * 1.6, 5.3), fieldNoiseScaled(p, footprint * 1.6, 7.1)) - 0.5) * 0.5 * tooth;
  }
  fieldPebbles(p, footprint, sunward, albedo, gradient, occlusion);
  fieldLitter(p, footprint, 0.4 + 0.6 * litter, sunward, albedo, gradient, occlusion);

  // Old leaves and shade-darkened soil beneath a crown.
  albedo = mix(albedo, vec3(0.085, 0.07, 0.05) * (1.0 + tone * 1.5), litter * 0.75);

  // A furrow's banks and floor, damp and dark down to the water; the crossing's fill on its ramps, grassed in
  // patches and stained dark and wet round the pipe; and the pipe itself.
  float aboveWater = landHeight + relief - level;
  float pipeDark = 0.0;
  if (dug > 0.0) {
    // Dark organic soil, sandier in patches with no edge to them, and rills down the bank where rain runs off it,
    // gone before a pixel's length along the furrow is too long for them. It comes in over the shoulder as the
    // bank does, damper and darker toward the water.
    float damp = 1.0 - smoothstep(0.0, 0.3, aboveWater);
    vec2 bank = fieldFurrowPlace(p);
    float patches = fieldNoise(bank * 1.3 + 41.0) * 0.55 + fieldNoise(bank * 3.7 + 13.0) * 0.3 +
      mix(fieldNoise(bank * 9.1 + 5.0), 0.5, smoothstep(0.03, 0.1, footprint)) * 0.15;
    float rills = smoothstep(0.55, 0.8, fieldNoise(vec2(p.x * 9.0, acrossLand * 0.9) + 23.0)) * (1.0 - smoothstep(0.03, 0.09, xWidth));
    vec3 soil = mix(vec3(0.08, 0.066, 0.048), vec3(0.15, 0.128, 0.093), smoothstep(0.25, 0.8, patches)) * (1.0 + tone);
    soil *= 1.0 - 0.25 * rills;
    albedo = mix(albedo, soil, (0.65 + 0.3 * damp) * dug);
    albedo *= 1.0 - 0.3 * damp * dug;
  }
  if (rampFill > 0.0) {
    // The crossing's end ramps: sandy fill, grassed in patches as the bed is, damp and dark toward its foot, with
    // a wet stain spreading down from the pipe's mouth over what the water leaves on it.
    float high = clamp((landHeight - landOffset - FIELD_LAND_FLOOR_Z) / -FIELD_LAND_FLOOR_Z, 0.0, 1.0);
    vec3 fill = mix(vec3(0.12, 0.105, 0.078), vec3(0.2, 0.178, 0.135), smoothstep(0.1, 0.7, high)) *
      (0.85 + 0.3 * fieldNoise(p * 4.7 + 19.0)) * (1.0 + tone);
    albedo = mix(albedo, fill, 0.45 * rampFill);
    float fromPipe = length(vec2(fieldFurrowU(p) * 0.8, landHeight - landOffset - FIELD_LAND_FLOOR_Z - ${toGlsl(PIPE.radius)}));
    float stain = (1.0 - smoothstep(${toGlsl(PIPE.radius)}, ${toGlsl(PIPE.radius + 0.42)}, fromPipe + (fieldNoise(p * 7.0 + 3.0) - 0.5) * 0.18)) * rampFill;
    albedo *= 1.0 - 0.4 * stain;
    wetness = max(wetness, max(stain * 0.75, (1.0 - smoothstep(0.0, 0.25, high)) * 0.6 * rampFill));
  }
  if (piece > 4.5) {
    // Old galvanized steel, dulled grey, its rings of corrugation catching the light where a pixel can see them,
    // stained tea-brown up to where the water stands and rusted along it, mud caked low down; and inside its mouth,
    // the same rings lit by the daylight that gets in, darker the further in, to black.
    float high = landHeight - landOffset - FIELD_LAND_FLOOR_Z;
    float ringsSeen = 1.0 - smoothstep(0.012, 0.035, footprint);
    float rings = sin(p.x * ${toGlsl((2 * Math.PI) / PIPE.corrugation)});
    vec3 steel = vec3(0.29, 0.29, 0.28) * (0.82 + 0.3 * fieldNoise(p * 23.0 + high * 13.0)) * (1.0 + tone * 0.4);
    steel = mix(steel, vec3(0.2, 0.13, 0.07), smoothstep(0.35, 0.8, fieldNoise(vec2(p.x * 5.0, high * 21.0) + 7.0)) * 0.5);
    float stainedTo = max(mark, level) - landOffset - FIELD_LAND_FLOOR_Z + 0.04;
    albedo = mix(steel, vec3(0.11, 0.085, 0.055), (1.0 - smoothstep(stainedTo - 0.03, stainedTo + 0.02, high)) * 0.75);
    albedo = mix(albedo, vec3(0.07, 0.06, 0.045), (1.0 - smoothstep(0.03, 0.09, high)) * 0.7);
    albedo *= 1.0 + 0.18 * rings * ringsSeen;
    pipeNormal = normalize(pipeNormal + vec3(cos(p.x * ${toGlsl((2 * Math.PI) / PIPE.corrugation)}) * 0.45 * ringsSeen, 0.0, 0.0));
    if (pipePart > 1.5 && pipePart < 2.5) albedo *= 1.15;
    if (pipePart > 2.5) {
      albedo *= 0.8;
      pipeDark = 1.0 - exp(-pipeInside / ${toGlsl(PIPE.lightReach)}) * 0.85;
    }
  }

  // Fresh soil at a planting, darker and damp.
  if (soil > 0.0) {
    vec3 turned = vec3(0.1, 0.078, 0.058) * (1.0 + tone * 1.8);
    turned = mix(turned, vec3(0.2, 0.176, 0.138) * (1.0 + tone * 1.4), crest * 0.7);
    albedo = mix(albedo, turned, soil * 0.9);
    gradient *= 1.0 + soil * 0.8;
  }

  // Grass, as color and texture, for as far as there are no blades to see, and beneath those there are.
  // A share of ground is shown by a threshold on noise as fine as a tuft, so the edge of grass is tufts.
  float grass = 0.0;
  float fieldThatch = 0.0;
  if (cover > 0.0) {
    float tuftScale = max(footprint * 2.0, 0.14);
    // Laid along a bank's own surface, so its tufts are not drawn out down the slope; and there, as big each way as
    // what a pixel covers that way, so a bank seen end on down a furrow is not a run of streaks down its face.
    vec2 tuftPlace = fieldFurrowPlace(p);
    float tufts = fieldTufts(tuftPlace, tuftScale);
    float bladeNoise = fieldNoiseScaled(p, max(footprint * 1.5, 0.012), 6.1);
    if (dug > 0.0) {
      float rise = fieldFurrowSlope(acrossLand);
      float down = yWidth * sqrt(1.0 + rise * rise);
      float downScale = max(down * 2.0, 0.14);
      float ratio = clamp(max(xWidth * 2.0, 0.14) / downScale, 1.0, 8.0);
      tufts = mix(tufts, fieldTufts(vec2(tuftPlace.x / ratio, tuftPlace.y), downScale), dug);
      float bladeDown = max(down * 1.5, 0.012);
      float bladeRatio = clamp(max(xWidth * 1.5, 0.012) / bladeDown, 1.0, 8.0);
      bladeNoise = mix(bladeNoise, fieldNoiseScaled(vec2(tuftPlace.x / bladeRatio, tuftPlace.y), bladeDown, 6.1), dug);
    }
    float soft = mix(mix(0.3, 0.12, rowsHere), 1.0, smoothstep(0.03, 0.5, footprint));
    grass = smoothstep(1.0 - cover - soft, 1.0 - cover + soft, tufts);
    vec3 lawn = grassColor(p, dryness) * (0.68 + 0.64 * bladeNoise + tone * 2.0);
    // Mower's stripes along the middles, gone before they are too fine for a pixel.
    lawn *= 1.0 + 0.07 * rowsHere * sin(p.y * 2.6) * (1.0 - smoothstep(0.35, 1.1, yWidth));
    // A gust front lays the mowed middles over, pale side up, in silver waves.
    float gust = fieldGround.wind.x > 0.15 ? treeWind_getGust(p, fieldGround.wind.w, fieldGround.wind.yz, fieldGround.wind.x, 0.0) : 0.0;
    lawn = mix(lawn, lawn * 1.7 + vec3(0.024, 0.03, 0.02), gust * smoothstep(0.15, 0.45, fieldGround.wind.x) * rowsHere);
    // Under blades, the ground is thatch and shade.
    fieldThatch = 1.0 - smoothstep(fieldGround.shade.x * 0.6, fieldGround.shade.x, distanceToEye);
    // Dead stuff and shade at the feet of blades, which on an open field is mostly the sand.
    vec3 thatch = mix(albedo * 0.66, vec3(0.078, 0.074, 0.044), rowsHere) * (0.8 + 0.5 * bladeNoise);
    lawn = mix(lawn, thatch, fieldThatch);
    // What shows through in the middles is old organic soil, not clean sand.
    albedo *= mix(1.0, 0.7, rowsHere * cover);
    albedo = mix(albedo, lawn, grass * (1.0 - soil));
    gradient *= 1.0 + grass * 0.4;
  }

  // Far off, what lies on the ground is the top of a row of crowns, as stripped and as yellow as the rows are.
  vec3 stripAlbedo = fieldFarStripAlbedo(p, tone);
  if (farStrip > 0.0 && !isWater) {
    albedo = mix(albedo, stripAlbedo, farStrip);
    directLeft = mix(directLeft, 1.0, farStrip);
    skyLeft = mix(skyLeft, 0.9, farStrip);
    grass *= 1.0 - farStrip;
  }

  // ---- What the flood leaves on the land it has left, as flatwoods sand keeps it: a dark wet band at its shore;
  // a thin film of pale silt, matte once it dries, which the grass soon comes through; wrack, lines of leaves and
  // twigs and dark silt where the shore stood on its way down; fans of sand washed off the shoulders down the
  // banks; and a grey scum in the low spots where it stood longest.
  float puddleTint = 0.0;
  if (!isWater) {
    if (aboveWater < 0.1) {
      float fromShore = max(aboveWater, 0.0) / slopeSize;
      float band = mix(0.03, 0.06, fieldNoise(p * 4.1 + 2.3));
      float soaked = 1.0 - smoothstep(band * 0.5, band, fromShore);
      wetness = max(wetness, soaked);
      albedo *= 1.0 - 0.4 * soaked;
    }
    float wasUnder = mark > level + 0.001 ? smoothstep(0.0, 0.003, mark - landHeight) : 0.0;
    float traces = fieldFlood.marks.x;
    if (wasUnder > 0.0 && traces > 0.0) {
      vec2 uncovered = fieldUncovered(landHeight);
      float daysOut = fieldFlood.more.w - uncovered.y;
      float dried = smoothstep(0.4, 2.6, daysOut);
      float stood = clamp((mark - landHeight) / 0.12, 0.0, 1.0);
      float silted = fieldFlood.more.x;
      // Thicker where it stood deepest, in patches, and thin over the grass, which comes through it.
      float patchy = 0.6 + 0.4 * smoothstep(0.25, 0.7, fieldNoise(p * 0.7 + 5.1) * 0.7 + fieldNoise(p * 3.3 + 9.4) * 0.3);
      float film = wasUnder * silted * (0.45 + 0.55 * stood) * patchy;
      vec3 silt = mix(vec3(0.4, 0.36, 0.28), vec3(0.31, 0.28, 0.215), stood * 0.5);
      albedo = mix(albedo, silt * (1.0 + tone * 0.6), film * (0.25 + 0.4 * dried) * (1.0 - grass * 0.7));
      wetness = max(wetness, wasUnder * (1.0 - dried) * 0.85 * silted);
      // Grey scum in the low spots, where the water stood longest.
      float lowSpot = smoothstep(0.5, 0.85, stood) * smoothstep(0.45, 0.72, fieldNoise(p * 0.8 + 3.3) * 0.7 + fieldNoise(p * 3.1 + 1.7) * 0.3);
      albedo = mix(albedo, vec3(0.12, 0.12, 0.1) * (1.0 + tone), lowSpot * wasUnder * traces * 0.55 * (1.0 - grass * 0.5));
      // Sand washed off the shoulders in fans down the banks, once the water stood over them.
      float acrossHere = abs(fieldFurrowU(p));
      if (acrossHere < FIELD_LAND_ZONE && mark > FIELD_LAND_BANK_TOP_Z) {
        float fanAlong = fieldNoise(vec2(p.x * 0.45, acrossHere * 0.3) + 61.0) * 0.7 + fieldNoise(vec2(p.x * 1.9, acrossHere * 1.1) + 7.0) * 0.3;
        float fan = smoothstep(0.55, 0.7, fanAlong + (acrossHere - FIELD_LAND_HALF_FLOOR) * 0.12) * (1.0 - smoothstep(FIELD_LAND_HALF_TOP, FIELD_LAND_ZONE, acrossHere));
        albedo = mix(albedo, vec3(0.43, 0.4, 0.33) * (1.0 + tone), fan * traces * 0.75 * (1.0 - grass * 0.8));
      }
      // Wrack: at each height the shore paused at on its way down, a ragged line of leaves, twigs and dark silt a
      // hand or two wide, and, along the shore now, what it is still letting go of.
      float wrack = 0.0;
      float lineWidth = clamp(slopeSize * 0.14, 0.0025, 0.014);
      for (int i = 0; i < 6; i++) {
        float knot = i < 4 ? (i == 0 ? fieldFlood.levelsA.x : (i == 1 ? fieldFlood.levelsA.y : (i == 2 ? fieldFlood.levelsA.z : fieldFlood.levelsA.w))) :
          (i == 4 ? fieldFlood.levelsB.x : fieldFlood.levelsB.y);
        if (knot > level + 0.004 && knot <= mark + 1e-4) {
          float along = landHeight - knot + (fieldNoise(p * 1.9 + float(i) * 7.1) - 0.5) * lineWidth * 1.6;
          float onLine = 1.0 - smoothstep(lineWidth * 0.35, lineWidth, abs(along));
          wrack = max(wrack, onLine * smoothstep(0.3, 0.58, fieldNoise(p * 2.7 + float(i) * 3.3)) * (0.55 + 0.45 * fieldHash(vec2(float(i), 3.0))));
        }
      }
      wrack *= 1.0 - smoothstep(0.6, 2.5, fwidth(landHeight) / lineWidth);
      float riding = (1.0 - smoothstep(0.0, 0.012, max(aboveWater, 0.0))) * fieldFlood.more.y * smoothstep(0.3, 0.6, fieldNoise(p * 5.3));
      wrack = max(wrack * traces, riding) * wasUnder;
      vec3 drift = mix(vec3(0.07, 0.056, 0.034), vec3(0.045, 0.06, 0.025), fieldNoise(p * 31.0)) * (0.75 + 0.5 * fieldNoise(p * 87.0));
      albedo = mix(albedo, drift, wrack * 0.85);
    }
    // Sheet flow off the shoulders into the furrow while it rains, in streaks running down them.
    float across = abs(fieldFurrowU(p));
    if (rain > 0.0 && across < FIELD_LAND_ZONE + 0.4) {
      float flow = fieldNoise(vec2(p.x * 11.0, across * 1.3 + fieldGround.eye.w * 0.9));
      float sheet = smoothstep(0.5, 0.75, flow) * rain * smoothstep(0.35, 0.9, across) * (1.0 - smoothstep(FIELD_LAND_ZONE, FIELD_LAND_ZONE + 0.4, across));
      wetness = max(wetness, sheet);
    }
  } else {
    // Soaked.
    albedo *= 0.5;
  }

  // Rain darkens by filling pores, and stands only in the low spots of flat ground: puddles whose edges wander
  // with the land's small relief and the grass, never along a strip's edge and never on a bank. A watered
  // basin drinks in seconds on sand, leaving it dark, with only a passing sheen.
  float puddled = 0.0;
  float dampness = max(wetness, basin);
  if (dampness > 0.0) {
    float porous = mix(0.55, 0.32, grass);
    albedo *= 1.0 - porous * smoothstep(0.0, 0.8, dampness);
    float low = fieldNoise(p * 0.9 + 21.0) * 0.52 + fieldNoise(p * 2.9 + 31.0) * 0.26 + fieldNoise(p * 9.3 + 37.0) * 0.14 +
      (footprint < 0.05 ? fieldNoise(p * 31.0 + 41.0) : 0.5) * 0.08;
    float flat_ = 1.0 - smoothstep(0.03, 0.08, slopeSize);
    float need = 0.73 - 0.1 * wetness + 0.07 * cover;
    float deep = smoothstep(need, need + 0.03, low) * smoothstep(0.35, 0.85, wetness) * flat_;
    deep *= 1.0 - smoothstep(18.0, 90.0, distanceToEye);
    puddled = max(deep * (1.0 - 0.6 * litter), basin * basin * 0.22);
  }

  // Rime, in the grains and on what faces the sky.
  if (frost > 0.0) {
    float grain = fieldNoiseScaled(p, max(footprint * 1.4, 0.0015), 12.9) * 0.5 + fieldNoise(p * 7.0) * 0.5;
    float rime = smoothstep(0.0, 0.5, frost * 1.3 - grain * mix(0.7, 0.2, frost)) * skyLeft;
    albedo = mix(albedo, vec3(0.37, 0.4, 0.45) * (0.86 + 0.28 * grain), rime * 0.62);
    glint += rime * step(0.985, fieldHash(floor(p / 0.0016))) * pow(max(halfway.z, 0.0), 40.0) * 0.5;
  }

  vec3 normal = normalize(vec3(-gradient, 1.0));
  if (piece > 4.5) normal = normalize(pipeNormal + vec3(gradient * 0.05, 0.0));

  // Direct light. A rough surface of grains keeps more of a low sun than Lambert's law allows, and looks
  // brightest with the sun at one's back.
  float nl = max(dot(normal, keyDirection), 0.0);
  float nv = max(dot(normal, view), 1e-3);
  float sigma2 = 0.5;
  float sinL = sqrt(max(1.0 - nl * nl, 0.0));
  float sinV = sqrt(max(1.0 - nv * nv, 0.0));
  vec3 lOnPlane = keyDirection - normal * dot(normal, keyDirection);
  vec3 vOnPlane = view - normal * nv;
  float cosAzimuth = max(dot(normalize(lOnPlane + 1e-5), normalize(vOnPlane + 1e-5)), 0.0);
  float orenB = 0.45 * sigma2 / (sigma2 + 0.09);
  float orenA = 1.0 - 0.5 * sigma2 / (sigma2 + 0.33);
  float rough = nl * (orenA + orenB * cosAzimuth * max(sinL, sinV) * min(sinL / max(nl, 1e-3), sinV / nv));

  float strength = fieldGround.shade.y;
  vec3 shadowPlace = (inFurrow || atSurface) ? fieldShadowPlaceAt(surfacePoint) : vFieldShadow;
  float shadowLight = mix(1.0, fieldShadowAt(shadowPlace), strength);
  // Grass takes the key as a crowd of blades does, not as flat ground.
  float lawnLight = fieldLawnLight(keyDirection.z);
  float direct = mix(rough, lawnLight, grass * (1.0 - fieldThatch)) * shadowLight * directLeft * occlusion;

  vec3 ambient = fieldLightColor(lighting.ambientColor);
  float upness = 0.5 + 0.5 * normal.z;
  vec3 hemisphere = ambient * mix(vec3(0.44, 0.38, 0.28), vec3(0.94, 1.0, 1.1), upness * upness);
  // The ambient light is kept high at night so that trees can be seen. Sand must still stay under the sky it
  // is lit by.
  hemisphere *= mix(1.0, 0.56, fieldAir.moon.w);
  // Relief's own shade: what is low sees less sky.
  float relief_ = clamp(0.5 - tone * 2.6, 0.0, 1.0);
  float skyLight = skyLeft * occlusion * mix(1.0, 0.72 + 0.28 * (1.0 - relief_), 0.6);
  // A furrow's floor and banks see less of the sky the deeper they lie.
  skyLight *= 1.0 - 0.45 * smoothstep(0.1, 0.7, landOffset - landHeight);

  vec3 color = albedo * (keyColor * direct + hemisphere * skyLight);

  // The sun through blades, seen against it.
  float against = pow(max(dot(-view, keyDirection), 0.0), 2.5);
  color += albedo * vec3(1.3, 1.45, 0.5) * keyColor * against * shadowLight * directLeft * 0.42 * grass * (1.0 - fieldThatch);

  // The flash, with no map to tell it what is in the way.
  if (lighting.directionalLightCount > 1) {
    DirectionalLight flash = lighting_getDirectionalLight(1);
    color += albedo * fieldLightColor(flash.color) * max(dot(normal, normalize(-flash.direction)), 0.0) * skyLeft;
  }

  // A glint of quartz or ice in the sun.
  color += keyColor * glint * 3.2 * shadowLight;

  // The dark inside of the culvert's pipe.
  color *= 1.0 - pipeDark;

  // Water on the land mirrors the sky, by Fresnel: a sheen on wet ground, and in a puddle the sky, rain-dimpled
  // and blurred, over the muddy water's own dark.
  if (!isWater && (puddled > 0.0 || wetness > 0.0)) {
    vec2 ripple = rain > 0.0 && puddled > 0.0 ? fieldRainHits(p, rain, fieldGround.eye.w, footprint).xy * puddled : vec2(0.0);
    vec3 flat_ = normalize(vec3(ripple + mix(gradient * 0.1, gradient, 1.0 - puddled) * 0.3, 1.0));
    vec3 reflected = reflect(-view, flat_);
    float fresnel = 0.025 + 0.975 * pow(1.0 - max(dot(flat_, view), 0.0), 5.0);
    float film = mix(wetness * 0.07 * (1.0 - grass), 0.85 - 0.3 * clamp(rain, 0.0, 1.0), puddled);
    vec3 mirror = fieldMirror(reflected, 0.05 + 0.2 * clamp(rain, 0.0, 1.0), fieldGround.shade.z) * 0.9;
    color = mix(color, mirror, clamp(fresnel * film, 0.0, 1.0));
    color *= mix(1.0, 0.62, puddled * (1.0 - fresnel));
    // The sun on water, as bright as the water reflects it at this angle, and spread by the rain.
    float sunMirror = pow(max(dot(reflected, keyDirection), 0.0), mix(6000.0, 900.0, clamp(rain, 0.0, 1.0)));
    color += keyColor * sunMirror * 8.0 * min(fresnel * 5.0, 1.0) * puddled * shadowLight;
  }

  // The magic ring: light lying on the ground, no brighter than the ground can show it.
  float ringStrength = fieldGround.ring.y;
  if (ringStrength > 0.0) {
    float radius = fieldGround.ring.x;
    float width = 0.9 + 0.1 * radius;
    float wobble = (fieldNoise(p * 0.6) - 0.5) * width * 0.9;
    float along = (fromHero + wobble - radius) / width;
    float glow = exp(-along * along) + 0.22 * smoothstep(0.0, -7.0, along) * (1.0 - smoothstep(-7.0, -24.0, along));
    color += (albedo * 3.0 + vec3(0.05, 0.035, 0.012)) * vec3(1.0, 0.76, 0.42) * glow * ringStrength;
  }

  // ---- Standing water over the land, or a far furrow's share of a pixel: as much of its ribbon as its near bank
  // leaves in sight, looking across it this low, and never on the crossing.
  float waterShare = 0.0;
  float bankShare = 0.0;
  if (tinted > 0.0 && abs(furrowU) < FIELD_LAND_ZONE + meshYWidth) {
    float relative = level - landOffset;
    float waterHalf = fieldFurrowWaterHalf(relative);
    float seen = 1.0;
    if (relative < 0.0) {
      float descent = -ray.z / max(abs(ray.y), 1e-3);
      float hidden = -FIELD_LAND_ZONE - relative / max(descent, 1e-3);
      seen = clamp((waterHalf - max(-waterHalf, hidden)) / max(2.0 * waterHalf, 1e-3), 0.0, 1.0);
      seen = mix(${toGlsl(WATER.leastSeen)}, 1.0, seen);
    }
    float open = (1.0 - fieldCrossing(mesh.xy)) * tinted;
    waterShare = fieldFurrowShare(furrowU, meshYWidth, waterHalf) * open * seen;
    bankShare = max(fieldFurrowShare(furrowU, meshYWidth, FIELD_LAND_ZONE) * open - waterShare, 0.0);
  }
  if (isWater || waterShare > 0.0) {
    vec3 at = isWater ? surfacePoint : vec3(mesh.xy, level);
    float waterDepth = isWater ? max(level - landHeight - min(relief, 0.0), 0.0) : level - landOffset - FIELD_LAND_FLOOR_Z;
    vec3 bottom = isWater ? color : color * 0.4;
    float waterScale = isWater ? waterDistance / max(meshDistance, 1e-5) : 1.0;
    float waterFootprint = meshReach * waterScale;
    // Metres to the water's edge across it, and the way to that edge: as deep as it stands over the land right
    // under it, less the bank's relief there, over how steeply that land rises. In a furrow below the bed, where
    // across it this is and how far down, for the far bank in its reflection, and what the wind runs over.
    float shore = 1e3;
    vec2 edge = vec2(0.0);
    float fetch = 1e3;
    // A far furrow's water mirrors its far bank as a near one's does.
    vec2 ditch = isWater || level >= landOffset ? vec2(0.0) : vec2(furrowU, landOffset - level);
    if (isWater) {
      vec2 rise = fieldLandSlope(at.xy);
      float riseSize = length(rise);
      float acrossHere = fieldFurrowU(at.xy);
      // Only where the land comes up to the surface near here: a furrow's banks under the sheet have no shore,
      // however they slope.
      bool banksUnder = abs(acrossHere) < FIELD_LAND_ZONE && level > landOffset - 0.005;
      if (riseSize > 0.004 && !banksUnder) {
        float stands = level - fieldLandOver(at.xy, landOffset) - fieldShoreRelief(at.xy, riseSize, meshFootprint * waterScale);
        if (stands < 0.15) {
          shore = max(stands, 0.0) / riseSize;
          edge = rise / riseSize;
        }
      }
      if (abs(acrossHere) < FIELD_LAND_ZONE && level < landOffset && fieldCrossing(at.xy) < 1.0) {
        ditch = vec2(acrossHere, landOffset - level);
        fetch = 2.0 * fieldFurrowWaterHalf(level - landOffset) / max(abs(fieldGround.wind.z), 0.05);
      }
    }
    vec3 bankColor = vec3(0.075, 0.068, 0.046) * (ambient * 0.75 + keyColor * max(keyDirection.z, 0.0) * shadowLight * 0.4);
    vec3 water = fieldWater(at, view, waterDepth, bottom, shadowLight, keyColor, keyDirection, ambient, waterFootprint, vec4(dx, dy) * waterScale, litter, shore, edge, fetch, ditch, bankColor);
    if (isWater) color = water;
    color = mix(color, color * 0.62, bankShare);
    color = mix(color, water, isWater ? 0.0 : waterShare);
  } else if (bankShare > 0.0) {
    color = mix(color, color * 0.62, bankShare);
  }

  // Past where the rows stand up, they stand in the water too: their tops over it, as dark lines in the sheet.
  if (farStrip > 0.0 && isWater) {
    vec3 stripLit = stripAlbedo * (keyColor * fieldLawnLight(keyDirection.z) + ambient * 0.9);
    color = mix(color, stripLit, farStrip);
  }

  // The air between here and the eye. Far off, where the sky probe is drawn, it is the sky itself just over the
  // horizon this way, deck and glow and all, so a flooded field mirroring that sky meets it with no stripe.
  vec3 air = vHorizon;
  if (fieldGround.shade.z > 0.5) {
    vec3 sky = textureLod(fieldSkyProbe, fieldSkyProbePlace(fieldHorizonDirection(ray)), 0.0).rgb;
    air = mix(air, sky, smoothstep(400.0, 2500.0, surfaceDistance));
  }
  color = mix(air, color, fieldAirVisibility(surfaceDistance));

  fragColor = vec4(fieldDither(fieldFilmic(color), gl_FragCoord.xy), 1.0);
}
`;

type GroundLayerProps = {
  plan: FieldPlan;
  flood: FieldFlood;
  /** Hole, its radius and depth, and berm. */
  hero: [number, number, number, number];
  /** Berm radius, water, and the unit vector of the wind that made the foam on the water. */
  heroMore: [number, number, number, number];
  /** Wetness, frost, rain, and how many open holes the lookup holds. */
  surface: [number, number, number, number];
  /** The ring's radius and strength, and two unused. */
  ring: [number, number, number, number];
  /** The scene clock, for ripples and waves. */
  seconds: number;
  /** Strength, the unit vector it blows toward, and the trees' gust clock. */
  wind: [number, number, number, number];
  /** `TreeLayer.wetness`, for drips off the crowns. */
  treeWetness: number;
  /** Replant sites that have something to show. */
  sites: StorySite[];
  /** The lookup's values. */
  treeTexels: Float32Array;
  /** Every crown the water could mirror, `MIRROR_FLOATS` each, as `getMirrorCandidates` writes them. */
  mirrorCandidates: Float32Array;
  /** The rows past the real trees: crown height, crown half width, share of them down, and the leaves they keep. */
  rows: [number, number, number, number];
  /** What the storm and the flood have done to them, as `FarRowsLook.storm` and `.decline`. */
  farStorm: [number, number, number, number];
  farDecline: [number, number, number, number];
};

const GEOMETRIES = new WeakMap<object, {ground: Geometry; site: Geometry}>();

function getGeometries(device: object): {ground: Geometry; site: Geometry} {
  let geometries = GEOMETRIES.get(device);
  if (!geometries) {
    const mesh = createPolarMesh(
      GROUND_MESH.sides,
      GROUND_MESH.inner,
      GROUND_MESH.outer,
      GROUND_MESH.stretch
    );
    const site = createSiteMesh();
    geometries = {
      ground: new Geometry({
        topology: 'triangle-list',
        attributes: {groundPlace: {size: 2, value: mesh.positions}},
        indices: {size: 1, value: mesh.indices}
      }),
      site: new Geometry({
        topology: 'triangle-list',
        attributes: {groundPlace: {size: 2, value: site.positions}},
        indices: {size: 1, value: site.indices}
      })
    };
    GEOMETRIES.set(device, geometries);
  }
  return geometries;
}

/**
 * Floats a crown the water may mirror takes, four texels: its middle and a sphere round the whole tree,
 * its width, height and the axis it leans along, its trunk's foot and radius, and its leaves.
 */
const MIRROR_FLOATS = 16;
const MIRROR_ROWS = MIRROR_FLOATS / 4;
const MIRROR_TEXELS = new Float32Array(MIRROR_TREES.count * MIRROR_FLOATS);

/** Writes the crowns nearest an eye into the mirror's lookup, a column each, as `MIRROR_FLOATS` says. */
export function writeMirrorTrees(
  candidates: Float32Array,
  eye: readonly number[],
  out: Float32Array
): number {
  out.fill(0);
  const count = candidates.length / MIRROR_FLOATS;
  const order: {index: number; distance: number}[] = [];
  for (let index = 0; index < count; index++) {
    const at = index * MIRROR_FLOATS;
    order.push({
      index,
      distance: Math.hypot(candidates[at + 8] - eye[0], candidates[at + 9] - eye[1])
    });
  }
  order.sort((a, b) => a.distance - b.distance || a.index - b.index);
  const shown = Math.min(order.length, MIRROR_TREES.count);
  const row = MIRROR_TREES.count * 4;
  for (let column = 0; column < shown; column++) {
    const from = order[column].index * MIRROR_FLOATS;
    for (let texel = 0; texel < MIRROR_ROWS; texel++) {
      for (let channel = 0; channel < 4; channel++) {
        out[texel * row + column * 4 + channel] = candidates[from + texel * 4 + channel];
      }
    }
  }
  return shown;
}

/** Every tree's crown as the water mirrors it, `MIRROR_FLOATS` each, from a frame's trees. */
export function getMirrorCandidates(state: StoryState): Float32Array {
  const live = state.trees.filter(tree => (tree.growth as number) > 0);
  const out = new Float32Array(live.length * MIRROR_FLOATS);
  live.forEach((tree, index) => {
    const position = tree.position as unknown as number[];
    const growth = tree.growth as number;
    const height = (tree.height as number) * getHeightFraction(growth);
    const crown = (tree.crownRadius as number) * getCrownFraction(growth);
    const [leanDegrees, leanBearing] = (tree.lean as number[] | undefined) ?? [0, 0];
    const tilt = leanDegrees * RADIANS_PER_DEGREE;
    const [towardX, towardY] = getBearingVector(leanBearing);
    const axis = [Math.sin(tilt) * towardX, Math.sin(tilt) * towardY, Math.cos(tilt)];
    const base = [position[0], position[1], (tree.elevation as number | undefined) ?? 0];
    const middle = height * MIRROR_TREES.middle;
    const leaves = clamp01(
      ((tree.foliage as number | undefined) ?? 1) * (1 - ((tree.decay as number | undefined) ?? 0))
    );
    const wide = crown * MIRROR_TREES.wide;
    const tall = height * MIRROR_TREES.tall;
    const trunk = Math.max(height * TRUNK_SHARE, 0.004);
    out.set(
      [
        base[0] + axis[0] * middle,
        base[1] + axis[1] * middle,
        base[2] + axis[2] * middle,
        Math.max(wide, tall, middle + trunk) * 1.05,
        wide,
        tall,
        axis[0],
        axis[1],
        base[0],
        base[1],
        base[2],
        trunk,
        leaves,
        0,
        0,
        0
      ],
      index * MIRROR_FLOATS
    );
  });
  return out;
}

class FieldGroundLayer extends FieldLayer<GroundLayerProps> {
  static layerName = 'FieldGroundLayer';

  declare state: FieldLayer['state'] & {
    siteModel?: Model;
    treeTexture?: Texture;
    mirrorTexture?: Texture;
    probeFallback?: Texture;
  };

  getShaders() {
    return super.getShaders({
      vs: GROUND_VERTEX,
      fs: GROUND_FRAGMENT,
      modules: [
        project32,
        lighting,
        waterMaterial,
        _treeWindGust,
        fieldAir,
        fieldPlan,
        fieldFlood,
        fieldGround
      ]
    });
  }

  initializeState(): void {
    super.initializeState();
    const {device} = this.context;
    this.state.treeTexture = device.createTexture({
      id: `${this.props.id}-trees`,
      format: 'rgba32float',
      width: TREE_GRID.columns,
      height: TREE_GRID.rows + 1,
      mipLevels: 1,
      data: this.props.treeTexels,
      sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
    });
    this.state.mirrorTexture = device.createTexture({
      id: `${this.props.id}-mirror-trees`,
      format: 'rgba32float',
      width: MIRROR_TREES.count,
      height: MIRROR_ROWS,
      mipLevels: 1,
      data: MIRROR_TEXELS,
      sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
    });
    this.state.probeFallback = device.createTexture({
      id: `${this.props.id}-no-probe`,
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      mipLevels: 1,
      data: new Uint8Array([0, 0, 0, 255])
    });
  }

  protected createModel(): Model {
    const geometries = getGeometries(this.context.device);
    this.state.siteModel?.destroy();
    this.state.siteModel = new Model(this.context.device, {
      ...this.getShaders(),
      id: `${this.props.id}-sites`,
      geometry: geometries.site
    });
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      geometry: geometries.ground
    });
  }

  getModels(): Model[] {
    const {model, siteModel} = this.state;
    return model && siteModel ? [model, siteModel] : [];
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const {treeTexture} = this.state;
    if (treeTexture) {
      treeTexture.writeData(this.props.treeTexels, {
        width: TREE_GRID.columns,
        height: TREE_GRID.rows + 1
      } as never);
    }
  }

  finalizeState(context: Parameters<FieldLayer['finalizeState']>[0]): void {
    this.state.treeTexture?.destroy();
    this.state.mirrorTexture?.destroy();
    this.state.probeFallback?.destroy();
    super.finalizeState(context);
  }

  draw({renderPass, shaderModuleProps}: Parameters<FieldLayer['draw']>[0]): void {
    const {model, siteModel, treeTexture, mirrorTexture, probeFallback} = this.state;
    if (
      !model ||
      !siteModel ||
      !treeTexture ||
      !mirrorTexture ||
      !probeFallback ||
      this.isDrawSkipped({shaderModuleProps})
    ) {
      return;
    }
    const {
      air,
      plan,
      flood,
      hero,
      heroMore,
      surface,
      ring,
      seconds,
      wind,
      treeWetness,
      sites,
      rows,
      farStorm,
      farDecline
    } = this.props;
    const {viewport} = this.context;
    const eye = viewport.cameraPosition as number[];
    const bladeReach = getGrassWindow(viewport).reach;
    writeMirrorTrees(this.props.mirrorCandidates, eye, MIRROR_TEXELS);
    mirrorTexture.writeData(MIRROR_TEXELS, {
      width: MIRROR_TREES.count,
      height: MIRROR_ROWS
    } as never);
    const probe = getSkyProbe(this.context.device);
    const strength = wind[0];
    const shared = {
      hero,
      heroMore,
      surface,
      ring,
      eye: [eye[0], eye[1], eye[2], seconds],
      wind,
      rows,
      shade: [bladeReach, this.fieldShadowStrength, probe ? 1 : 0, treeWetness],
      farStorm,
      farDecline,
      viewProjection: viewport.viewProjectionMatrix
    };
    const water = {
      time: seconds,
      mapping: 'uv' as const,
      coordinateScale: [1, 1],
      coordinateOffset: [0, 0],
      fresnelColor: [1, 1, 1],
      specularIntensity: WATER.specularIntensity,
      normalStrength: WATER.normalStrength[0] + WATER.normalStrength[1] * strength,
      waveADirection: [wind[1], wind[2]],
      waveAFrequency: WATER.waveA.frequency,
      waveASpeed: WATER.waveA.speed,
      waveAAmplitude: WATER.waveA.amplitude * strength * strength,
      waveBDirection: [-wind[2], wind[1]],
      waveBFrequency: WATER.waveB.frequency,
      waveBSpeed: WATER.waveB.speed,
      waveBAmplitude: WATER.waveB.amplitude * strength * strength
    };
    const bindings = {
      fieldTrees: treeTexture,
      fieldMirrorTrees: mirrorTexture,
      fieldSkyProbe: probe ?? probeFallback
    };
    this.setFieldUniforms(model, air);
    model.shaderInputs.setProps({
      fieldPlan: plan,
      fieldFlood: flood,
      waterMaterial: water,
      fieldGround: {...shared, site: [0, 0, 0, 0], siteMore: [0, 0, 0, 0]}
    } as never);
    model.setBindings(bindings);
    model.draw(renderPass);
    if (sites.length) {
      this.setFieldUniforms(siteModel, air);
      siteModel.setBindings(bindings);
      for (const site of sites) {
        siteModel.shaderInputs.setProps({
          fieldPlan: plan,
          fieldFlood: flood,
          waterMaterial: water,
          fieldGround: {
            ...shared,
            site: [site.position[0], site.position[1], 0, 1],
            siteMore: [site.hole, site.berm, site.water, 0]
          }
        } as never);
        siteModel.draw(renderPass);
      }
    }
  }
}

const FAR_ROWS_DECLARATION = /* glsl */ `layout(std140) uniform fieldFarRowsUniforms {
  vec4 shape;
  vec4 eye;
  vec4 storm;
  vec4 decline;
  vec4 bend;
  vec4 lean;
} fieldFarRows;`;

const fieldFarRowsModule = {
  name: 'fieldFarRows',
  vs: FAR_ROWS_DECLARATION,
  fs: FAR_ROWS_DECLARATION,
  uniformTypes: {
    shape: 'vec4<f32>',
    eye: 'vec4<f32>',
    storm: 'vec4<f32>',
    decline: 'vec4<f32>',
    bend: 'vec4<f32>',
    lean: 'vec4<f32>'
  }
} as const;

/**
 * What the storm and the flood have done to a tree of the rows past the block, in GLSL, from its cell, where it
 * stands and the land under it, as `FarRowsLook` gives them: `vec4(leaves, drowned, dead, flush)`, each 0-1.
 * `FAR_HOLLOW_GLSL` says where its roots drown.
 */
const FAR_TREE_GLSL = /* glsl */ `
vec4 fieldFarTree(vec2 cell, vec2 stand, float ground) {
  float drowned = fieldFarRows.decline.x * fieldFarHollow(stand, ground, fieldFarRows.decline.y);
  float dies = step(fieldHash(cell + 113.0), fieldFarRows.decline.w) * step(0.001, drowned);
  float dead = dies * fieldFarRows.decline.z;
  float leaves = clamp(1.0 - (1.0 - fieldFarRows.storm.y) * (0.7 + 0.6 * fieldHash(cell + 29.0)), 0.06, 1.0);
  leaves = min(leaves, mix(1.0, ${toGlsl(DECLINE_TABLE.foliage)}, drowned));
  leaves = mix(leaves, 0.05, dead);
  float flush = fieldFarRows.storm.w * (0.6 + 0.4 * fieldHash(cell + 31.0)) * (1.0 - drowned) * (1.0 - dead);
  return vec4(leaves, drowned, dead, flush);
}

// A leaf's color for that state: dark glossy green, bronzed where the wind burned it, chlorotic where the
// roots drowned, lime where it flushes.
vec3 fieldFarLeaf(vec4 tree, float id, float up) {
  vec3 leaf = mix(vec3(0.029, 0.051, 0.019), vec3(0.041, 0.066, 0.022), id);
  leaf = mix(leaf, vec3(0.045, 0.054, 0.03), fieldFarRows.storm.z * 0.4 * (0.6 + 0.4 * id));
  leaf = mix(leaf, vec3(0.15, 0.158, 0.04), tree.y * (0.7 + 0.3 * id));
  leaf = mix(leaf, vec3(0.075, 0.12, 0.02), tree.w * mix(0.4, 0.85, smoothstep(0.2, 0.9, up)));
  return leaf;
}

// The wood where the leaves have gone: grey-brown bark in the crown's own shade, and the paler grey of the dead.
vec3 fieldFarTwig(vec4 tree) {
  return mix(vec3(0.028, 0.03, 0.028), vec3(0.08, 0.079, 0.074), tree.z);
}

vec3 fieldFarHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.103, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

function getFarRowsVertex(isCrowns: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME field-far-rows-vs
precision highp float;

in vec4 rowPlace;

out vec3 vWorld;
out vec2 vClip;
out vec3 vNormal;
out vec2 vCell;
out float vUp;
out vec3 vHorizon;
out vec3 vLocal;
out vec4 vTree;

${FIELD_AIR_GLSL}
${FIELD_PLAN_GLSL}
${FAR_BLOCKS_GLSL}
${FAR_TREE_GLSL}

void main() {
  vHorizon = vec3(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vWorld = vec3(0.0);
  vClip = vec2(0.0, 1.0);
  vNormal = vec3(0.0, 0.0, 1.0);
  vCell = vec2(0.0);
  vUp = 0.0;
  vLocal = vec3(0.0);
  vTree = vec4(1.0, 0.0, 0.0, 0.0);
  float treeSpacing = fieldPlan.rows.y;
  float lineSpacing = fieldPlan.rows.x;
${
  isCrowns
    ? /* glsl */ `
  // A tree from its index alone: which line, and which along it, here or gone.
  int side = int(fieldFarRows.shape.z);
  vec2 cell = vec2(float(gl_InstanceID % side), float(gl_InstanceID / side)) - 0.5 * float(side - 1);
  vec2 stand = cell * vec2(treeSpacing, lineSpacing);
  if (abs(stand.x) < fieldPlan.rows.z && abs(stand.y) < fieldPlan.rows.w) return;
  float fromHero = length(stand);
  if (fromHero > ${FAR_ROWS.crownsTo.toFixed(1)}) return;
  float gone = fieldFarRows.storm.x;
  if (!fieldFarStands(cell, gone)) return;
  stand += (fieldHash2(cell + 7.0) - 0.5) * 0.5;
  float rise = fieldRowsHere(fromHero);
  if (rise <= 0.0) return;
  float ground = fieldLandHeight(stand);
  vec4 tree = fieldFarTree(cell, stand, ground);
  float size = 0.84 + 0.3 * fieldHash(cell);
  vec3 unit = rowPlace.xyz;
  // Each crown its own shape, as no two trees of a grove are: taller or squatter, its skirt higher or lower,
  // its top off to one side, and its lobes turned its own way.
  vec2 build = fieldHash2(cell + 211.0);
  vec2 offTop = (fieldHash2(cell + 223.0) - 0.5) * 0.4;
  float turn = fieldHash(cell + 227.0) * 6.2831853;
  vec2 turned = vec2(cos(turn) * unit.x - sin(turn) * unit.y, sin(turn) * unit.x + cos(turn) * unit.y);
  // Lobes on a crown of its own: slow bumps in where its surface comes to, different on each tree, and deeper
  // as it thins, as a stripped crown's outline is ragged.
  float lobes = 0.74 + 0.4 * fieldNoise(turned * 1.7 + unit.z * 2.3 + cell * 3.7) + 0.2 * fieldNoise(turned * 4.6 + unit.z * 4.1 + cell * 1.9);
  lobes = mix(lobes, lobes * (0.74 + 0.52 * fieldNoise(turned * 3.7 + unit.z * 3.1 + cell * 5.1)), 1.0 - tree.x);
  float height = fieldFarRows.shape.x * size * mix(0.84, 1.18, build.x) * rise;
  float radius = fieldFarRows.shape.y * size * mix(1.1, 0.9, build.x) * sqrt(rise);
  // A citrus tree is skirted nearly to the ground.
  float skirt = mix(0.0, 0.07, build.y);
  // A rounded crown about as wide as it is tall, down to its skirt, a little flattened on top.
  float across = length(unit.xy);
  vec2 outward = unit.xy / max(across, 1e-4);
  vec3 local = vec3(outward * pow(across, 0.62) * radius * lobes + offTop * radius * unit.z * unit.z,
    height * skirt + height * (1.0 - skirt) * pow(unit.z, mix(1.0, 1.35, build.y)) * mix(1.0, lobes, 0.6));
  // The wind streams it over, its top furthest; and a leaner stands over for good on its lifted root plate,
  // toward the wall that pushed it, until the crews set it back up.
  float up = local.z / max(height, 0.1);
  float stream = fieldFarRows.bend.z * (0.8 + 0.4 * fieldHash(cell + 41.0));
  float leaner = step(fieldHash(cell + 131.0), ${toGlsl(FAR_STORM.leanShare)});
  float secondWall = step(0.5, fieldHash(cell + 137.0));
  float leanAngle = radians(mix(${toGlsl(FAR_STORM.leanDegrees[0])}, ${toGlsl(FAR_STORM.leanDegrees[1])}, fieldHash(cell + 139.0))) * leaner *
    mix(fieldFarRows.lean.x, fieldFarRows.lean.y, secondWall) * fieldFarRows.lean.z;
  float bearing = radians(${toGlsl(HURRICANE.firstWallBearing)} + 180.0 * secondWall + (fieldHash(cell + 149.0) - 0.5) * 50.0);
  vec2 leanToward = vec2(sin(bearing), cos(bearing));
  vec3 world = vec3(stand, ground) + vec3(local.xy, local.z * cos(leanAngle));
  world.xy += leanToward * local.z * sin(leanAngle) + fieldFarRows.bend.xy * height * stream * up * up * ${toGlsl(Math.tan((FAR_STORM.streamDegrees * Math.PI) / 180))};
  vWorld = world;
  vNormal = normalize(vec3(unit.xy / max(radius, 0.1), unit.z / max(height, 0.1)));
  vCell = cell;
  vUp = unit.z;
  vLocal = local;
  vTree = tree;
`
    : /* glsl */ `
  vec2 p = rowPlace.xy;
  float across = rowPlace.z;
  float up = rowPlace.w;
  float fromHero = length(p);
  // They rise as the crowns give way to them, and lie down into the ground's strips far off.
  float rise = fieldRowsHere(fromHero) * (1.0 - smoothstep(${FAR_ROWS.flatFrom.toFixed(1)}, ${FAR_ROWS.riseEnd.toFixed(1)}, fromHero)) *
    mix(0.35, 1.0, smoothstep(${FAR_ROWS.handOver[0].toFixed(1)}, ${FAR_ROWS.handOver[1].toFixed(1)}, fromHero));
  float line = floor(p.y / lineSpacing + 0.5);
  // One size to a line: a size that changed along it from corner to corner of its coarse mesh would saw its top.
  float size = 0.94 + 0.1 * fieldHash(vec2(line, 3.1));
  float height = fieldFarRows.shape.x * size * rise;
  float halfWidth = fieldFarRows.shape.y * size * sqrt(rise);
  vec3 world = vec3(p.x, p.y + across * halfWidth, fieldLandHeight(p) + up * height);
  world.xy += fieldFarRows.bend.xy * height * fieldFarRows.bend.z * up * up * ${toGlsl(Math.tan((FAR_STORM.streamDegrees * Math.PI) / 180))};
  vWorld = world;
  vNormal = normalize(vec3(0.0, across / max(halfWidth, 0.1), up / max(height, 0.1)));
  vCell = vec2(height, line);
  vUp = up;
  vLocal = vec3(p, fieldLandHeight(p));
`
}
  // The same air as the ground they stand on and the hedges past them, so that with distance all three go the
  // way the sky at the horizon goes, not one of them toward the fog's own color.
  vHorizon = fieldHorizon(normalize(vWorld - fieldFarRows.eye.xyz));
  vec4 clip = project_common_position_to_clipspace(vec4(project_position(vWorld), 1.0));
  vClip = clip.zw;
  gl_Position = vec4(clip.xy, 0.0, clip.w);
}
`;
}

function getFarRowsFragment(isCrowns: boolean): string {
  return /* glsl */ `#version 300 es
#define SHADER_NAME field-far-rows-fs
precision highp float;

in vec3 vWorld;
in vec2 vClip;
in vec3 vNormal;
in vec2 vCell;
in float vUp;
in vec3 vHorizon;
in vec3 vLocal;
in vec4 vTree;

out vec4 fragColor;

${FIELD_LIGHT_GLSL}
${FIELD_AIR_GLSL}
${FIELD_MIRROR_GLSL}
${FIELD_PLAN_GLSL}
${FAR_BLOCKS_GLSL}
${FAR_TREE_GLSL}

// The nearest clump of leaves to a point on a crown, metres from its base: how near its middle, 0 at its rim and
// 1 at its heart, the way out from its middle to here, and a number of its own.
void fieldFarClumps(vec3 q, float size, out float near, out vec3 outward, out float id) {
  vec3 s = q / size;
  vec3 base = floor(s - 0.5);
  float best = 9.0;
  vec3 bestOffset = vec3(0.0);
  vec3 bestCell = base;
  for (int i = 0; i < 8; i++) {
    vec3 cell = base + vec3(float(i & 1), float((i >> 1) & 1), float((i >> 2) & 1));
    vec3 offset = s - (cell + 0.15 + 0.7 * fieldFarHash3(cell));
    float d = dot(offset, offset);
    if (d < best) {
      best = d;
      bestOffset = offset;
      bestCell = cell;
    }
  }
  near = 1.0 - clamp(sqrt(best) / 0.8, 0.0, 1.0);
  outward = bestOffset;
  id = fieldFarHash3(bestCell + 5.0).x;
}

void main() {
  vec3 world = vWorld;
  float depth = vClip.x / vClip.y * 0.5 + 0.5;
  if (depth < 0.0) discard;

  vec3 toEye = fieldFarRows.eye.xyz - world;
  float distanceToEye = length(toEye);
  vec3 view = toEye / max(distanceToEye, 1e-4);
  float footprint = max(sqrt(length(dFdx(world)) * length(dFdy(world))), 1e-3);
  vec3 baseNormal = normalize(vNormal);
  float rim = 1.0 - abs(dot(baseNormal, view));

  vec3 keyColor = vec3(0.0);
  vec3 keyDirection = vec3(0.0, 0.0, 1.0);
  if (lighting.directionalLightCount > 0) {
    DirectionalLight key = lighting_getDirectionalLight(0);
    keyColor = fieldLightColor(key.color);
    keyDirection = normalize(-key.direction);
  }
${
  isCrowns
    ? /* glsl */ `
  vec4 tree = vTree;
  // Clumps of leaves a little under half a metre across, each a rounded mass of its own, with leaves at the
  // scale a pixel can still see; between them, as the storm thins it, twigs, and through those the sky or
  // whatever stands behind. Its outline breaks up first. Too far off to tell the clumps apart, it is as much of
  // each as it has, which the sub-frames' own dither shares out.
  float near;
  vec3 out_;
  float id;
  fieldFarClumps(vLocal, 0.36 + 0.14 * fieldHash(vCell + 59.0), near, out_, id);
  float smaller;
  vec3 smallerOut;
  float smallerId;
  fieldFarClumps(vLocal + 0.37, 0.17, smaller, smallerOut, smallerId);
  near = near * 0.7 + smaller * 0.3;
  float seen = 1.0 - smoothstep(0.07, 0.24, footprint);
  float leafScale = max(footprint * 1.4, 0.06);
  vec3 weights = abs(baseNormal);
  weights = weights * weights;
  weights /= weights.x + weights.y + weights.z;
  float leafNoise = weights.x * fieldNoiseScaled(vLocal.yz + vCell * 7.0, leafScale, 2.3) +
    weights.y * fieldNoiseScaled(vLocal.xz + vCell * 7.0, leafScale, 3.9) +
    weights.z * fieldNoiseScaled(vLocal.xy + vCell * 7.0, leafScale, 5.3);
  float edge = rim * rim * rim;
  // What of a crown shows leaves: the share it keeps, so a stripped crown is as airy as the grove's own, the land
  // and the crowns behind it showing through.
  float kept = tree.x;
  // Near: leaf where the clump is dense enough for what it keeps; wood between; and nothing between those.
  float density = near * 0.72 + leafNoise * 0.4;
  float threshold = mix(0.1, 0.86, 1.0 - kept) + 0.22 * edge * (0.4 + 0.6 * (1.0 - kept));
  float leafHere = smoothstep(threshold - 0.04, threshold + 0.04, density);
  // Wood shows where the leaves have gone, toward its heart: limbs and twigs, thin, so only here and there.
  float twigs = smoothstep(0.66, 0.76, fieldNoiseScaled(vLocal.xz * 1.3 + vLocal.yx + vCell * 3.0, max(footprint * 1.2, 0.05), 8.7)) *
    (0.25 + 0.75 * (1.0 - rim)) * (0.45 + 0.55 * (1.0 - kept));
  float nearCover = max(leafHere, step(0.5, twigs));
  // Far: the shares of them.
  float leafShare = clamp(kept * 1.05, 0.0, 1.0) * (1.0 - 0.45 * edge);
  float farCover = clamp(leafShare + (1.0 - leafShare) * 0.14 * (1.0 - edge), 0.0, 1.0);
  float cover = mix(farCover, nearCover, seen);
  if (cover < 0.999 && cover <= fieldPixelNoise(gl_FragCoord.xy + 0.5)) discard;
  bool isLeaf = mix(leafShare / max(farCover, 1e-3), leafHere, seen) > fieldPixelNoise(gl_FragCoord.yx + 3.7);
  vec3 leaf = fieldFarLeaf(tree, id, vUp);
  vec3 albedo = isLeaf ? leaf * (0.75 + 0.5 * leafNoise) : fieldFarTwig(tree);
  // Each clump is lit as a mass, its own heart toward the sky and the sun, its rim in the shade of the next.
  vec3 normal = normalize(baseNormal * 0.55 + normalize(out_ + 1e-4) * 0.45 * seen + vec3(leafNoise - 0.5) * 0.3 * seen);
  float occluded = mix(0.9, 0.66 + 0.34 * near, seen) * (isLeaf ? 1.0 : 0.75);
  // Wood inside a crown is in the shade of the leaves around it, and takes little of the key.
  float keyShare = isLeaf ? 1.0 : 0.45;
`
    : /* glsl */ `
  // One line of crowns, far off: its trees' tops where a pixel can still see them, each its own height and
  // width and off its spacing a little, some meeting the next and some with a gap down between them, so the line
  // rises and falls with no beat to it; and its trees as stripped, bronzed, drowned or flushing as those nearer.
  vec2 cell = vec2(floor(world.x / fieldPlan.rows.y + 0.5), vCell.y);
  vec2 shape = fieldHash2(cell + 5.0);
  float along = world.x / fieldPlan.rows.y - cell.x - (shape.x - 0.5) * 0.3;
  float reach = mix(0.36, 0.56, shape.y);
  float dome = sqrt(max(1.0 - along * along / (reach * reach), 0.0));
  float top = mix(0.86, 1.0, fieldHash(cell + 17.0)) - 0.3 * (1.0 - dome) * mix(0.2, 1.0, fieldHash(cell + 19.0)) +
    0.05 * (fieldNoise(vec2(world.x * 1.3, vCell.y * 3.1)) - 0.5);
  if (vUp > mix(1.0, top, 1.0 - smoothstep(0.8, 3.0, footprint))) discard;
  vec4 tree = fieldFarTree(cell, vec2(world.x, vCell.y * fieldPlan.rows.x), vLocal.z);
  float id = fieldHash(cell + 13.0);
  // A line of them is seen through several crowns at once, so what shows is mostly leaves even when they are thin.
  vec3 albedo = mix(fieldFarLeaf(tree, id, vUp), fieldFarTwig(tree), (1.0 - tree.x) * 0.3) * mix(1.0, 0.8, 1.0 - tree.x);
  float clumps = fieldNoiseScaled(world.xz + world.yx * 0.5, max(footprint * 0.95, 0.12), 2.3);
  albedo *= mix(1.0, 0.7 + 0.6 * clumps, 1.0 - smoothstep(0.4, 2.5, footprint));
  // What shows of a line of round crowns, seen down it, is the faces of each turned toward the eye, which the tube
  // itself has none of: so it is lit as those are, as the crowns nearer are.
  vec3 normal = normalize(vec3(view.x * 0.8, baseNormal.y, baseNormal.z));
  float occluded = 1.0;
  float keyShare = 1.0;
`
}
  float nl = dot(normal, keyDirection);
  float wrap = max(nl * 0.55 + 0.45, 0.0);
  // A crown is darker low down, as light has come through less of it, though never so dark that its shade reads
  // as anything but leaves: what lights it from below is light the leaves around have let through, green.
  float low = mix(${isCrowns ? '0.6' : '0.5'}, 1.0, pow(clamp(vUp, 0.0, 1.0), 1.2)) * occluded;
  vec3 ambient = fieldLightColor(lighting.ambientColor);
  float upness = 0.5 + 0.5 * normal.z;
  vec3 color = albedo * (keyColor * wrap * low * keyShare + ambient * mix(vec3(0.42, 0.44, 0.32), vec3(0.94, 1.0, 1.1), upness * upness) * low);
  // Backlit leaves, glowing the yellow-green that light through a citrus leaf is, as the grove's own do; and lit
  // from the front, the sheen of glossy leaves, which a low sun shows warm.
  float against = pow(max(dot(-view, keyDirection), 0.0), 3.0);
  color += albedo * vec3(1.9, 1.6, 0.4) * keyColor * against * (1.0 - 0.6 * abs(nl)) * 0.6 * keyShare;
  float sheen = pow(max(dot(normal, normalize(keyDirection + view)), 0.0), 8.0);
  color += keyColor * sheen * 0.035 * low * keyShare;

  if (lighting.directionalLightCount > 1) {
    DirectionalLight flash = lighting_getDirectionalLight(1);
    color += albedo * fieldLightColor(flash.color) * max(dot(normal, normalize(-flash.direction)), 0.0);
  }

  gl_FragDepth = min(depth, 0.99999);
  // The air, as the ground's: far off, where the sky probe is drawn, the sky itself just over the horizon.
  vec3 air = vHorizon;
  if (fieldFarRows.shape.w > 0.5) {
    vec3 sky = textureLod(fieldSkyProbe, fieldSkyProbePlace(fieldHorizonDirection(-view)), 0.0).rgb;
    air = mix(air, sky, smoothstep(400.0, 2500.0, distanceToEye));
  }
  color = mix(air, color, fieldAirVisibility(distanceToEye));
  fragColor = vec4(fieldDither(fieldFilmic(color), gl_FragCoord.xy), 1.0);
}
`;
}

type FarRowsLayerProps = {
  plan: FieldPlan;
  /** Crown height, crown half width, and two unused. */
  shape: [number, number, number, number];
  /** What the storm and the flood have done to the rows, as `getFarRowsLook` gives it. */
  look: FarRowsLook;
};

const FAR_ROWS_GEOMETRIES = new WeakMap<object, {rows: Geometry; crown: Geometry}>();

/**
 * The rows past the real trees: a crown of its own for each tree as far as that can be seen, and past that
 * long tubes of crowns, which lie down into the ground's strips where they are too far off to stand up.
 */
class FieldFarRowsLayer extends FieldLayer<FarRowsLayerProps> {
  static layerName = 'FieldFarRowsLayer';

  declare state: FieldLayer['state'] & {crownModel?: Model; probeFallback?: Texture};

  initializeState(): void {
    super.initializeState();
    this.state.probeFallback = this.context.device.createTexture({
      id: `${this.props.id}-no-probe`,
      format: 'rgba8unorm',
      width: 1,
      height: 1,
      mipLevels: 1,
      data: new Uint8Array([0, 0, 0, 255])
    });
  }

  finalizeState(context: Parameters<FieldLayer['finalizeState']>[0]): void {
    this.state.probeFallback?.destroy();
    super.finalizeState(context);
  }

  getShaders(isCrowns = false) {
    return super.getShaders({
      vs: getFarRowsVertex(isCrowns),
      fs: getFarRowsFragment(isCrowns),
      modules: [project32, lighting, fieldAir, fieldPlan, fieldFarRowsModule]
    });
  }

  protected createModel(): Model {
    const {device} = this.context;
    let geometries = FAR_ROWS_GEOMETRIES.get(device);
    if (!geometries) {
      const {rows} = this.props.plan;
      const tubes = createFarRowsMesh(rows[0], [rows[2], rows[3]], FAR_ROWS.riseEnd);
      const crown = createCrownMesh();
      geometries = {
        rows: new Geometry({
          topology: 'triangle-list',
          attributes: {rowPlace: {size: 4, value: tubes.places}},
          indices: {size: 1, value: tubes.indices}
        }),
        crown: new Geometry({
          topology: 'triangle-list',
          attributes: {rowPlace: {size: 4, value: crown.places}},
          indices: {size: 1, value: crown.indices}
        })
      };
      FAR_ROWS_GEOMETRIES.set(device, geometries);
    }
    this.state.crownModel?.destroy();
    const {rows} = this.props.plan;
    const side = getFarCrownsSide(rows[0], rows[1]);
    this.state.crownModel = new Model(device, {
      ...this.getShaders(true),
      id: `${this.props.id}-crowns`,
      geometry: geometries.crown,
      instanceCount: side * side,
      isInstanced: true
    });
    return new Model(device, {
      ...this.getShaders(false),
      id: this.props.id,
      geometry: geometries.rows
    });
  }

  getModels(): Model[] {
    const {model, crownModel} = this.state;
    return model && crownModel ? [model, crownModel] : [];
  }

  draw({renderPass, shaderModuleProps}: Parameters<FieldLayer['draw']>[0]): void {
    const {model, crownModel, probeFallback} = this.state;
    if (!model || !crownModel || !probeFallback || this.isDrawSkipped({shaderModuleProps})) return;
    const {air, plan, shape, look} = this.props;
    const eye = this.context.viewport.cameraPosition as number[];
    const side = getFarCrownsSide(plan.rows[0], plan.rows[1]);
    const probe = getSkyProbe(this.context.device);
    const uniforms = {
      fieldPlan: plan,
      fieldFarRows: {
        shape: [shape[0], shape[1], side, probe ? 1 : 0],
        eye: [eye[0], eye[1], eye[2], 0],
        ...look
      }
    };
    const bindings = {fieldSkyProbe: probe ?? probeFallback};
    this.setFieldUniforms(crownModel, air, false);
    crownModel.shaderInputs.setProps(uniforms as never);
    crownModel.setBindings(bindings);
    crownModel.draw(renderPass);
    this.setFieldUniforms(model, air, false);
    model.shaderInputs.setProps(uniforms as never);
    model.setBindings(bindings);
    model.draw(renderPass);
  }
}

/** Cells to a side of the square of crowns, which must reach as far as the crowns do along x and y. */
function getFarCrownsSide(lineSpacing: number, treeSpacing: number): number {
  return Math.ceil((2 * FAR_ROWS.crownsTo) / Math.min(lineSpacing, treeSpacing)) + 3;
}

const GROUND_PARAMETERS = {
  depthWriteEnabled: true,
  depthCompare: 'less-equal',
  cullMode: 'none',
  blend: false
} as const;

const TREE_TEXELS = new Float32Array(TREE_GRID.columns * (TREE_GRID.rows + 1) * 4);

/** Fills the lookup of trees and open holes for this frame, and returns how many holes it holds. */
export function writeFieldTrees(state: StoryState, out: Float32Array): number {
  out.fill(0);
  const {spacing, treeSpacing} = state.ground.rows;
  for (const tree of state.trees) {
    const growth = tree.growth as number;
    if (growth > 0) {
      const position = tree.position as unknown as number[];
      const height = (tree.height as number) * getHeightFraction(growth);
      const crown = (tree.crownRadius as number) * getCrownFraction(growth);
      const lean = (tree.lean as number[])[0];
      const standing = 1 - smoothstep(8, 40, lean);
      const leaves = Math.sqrt(clamp01((tree.foliage as number) * (1 - (tree.decay as number))));
      const column = Math.floor(position[0] / treeSpacing + 0.5) + TREE_GRID.columns / 2;
      const row = Math.floor(position[1] / spacing + 0.5) + TREE_GRID.rows / 2;
      if (column >= 0 && row >= 0 && column < TREE_GRID.columns && row < TREE_GRID.rows) {
        const at = (column + row * TREE_GRID.columns) * 4;
        const shade = crown * leaves * standing;
        if (shade >= out[at + 2]) {
          out[at] = position[0];
          out[at + 1] = position[1];
          out[at + 2] = shade;
          out[at + 3] = Math.max(height * TRUNK_SHARE, 0.004) * standing;
        }
      }
    }
  }
  let holes = 0;
  const lastRow = TREE_GRID.rows * TREE_GRID.columns * 4;
  for (const site of state.ground.sites) {
    if (holes < MOST_HOLES && site.hole > 0.001) {
      const at = lastRow + holes * 4;
      out[at] = site.position[0];
      out[at + 1] = site.position[1];
      out[at + 2] = SITE_SHAPE.holeRadius * 1.5;
      holes++;
    }
  }
  return holes;
}

/**
 * The crown of a tree that stands in for the rows past the real ones: how tall and wide its neighbours have
 * got, by the first grove tree standing.
 */
function getFarCrown(state: StoryState): [number, number] {
  for (let row = 1; row < state.trees.length; row++) {
    const tree = state.trees[row];
    const growth = tree.growth as number;
    if (growth > 0 && (tree.lean as number[])[0] < 8) {
      return [
        (tree.height as number) * getHeightFraction(growth),
        (tree.crownRadius as number) * getCrownFraction(growth)
      ];
    }
  }
  return [0, 0];
}

/** Share of the rows past the real trees that the storm has taken down, at a content second. */
function getFarTreesDown(seconds: number): number {
  const {share, firstWall, secondWall, regrown} = FAR_TREES_DOWN;
  const down =
    0.5 * smoothstep(firstWall[0], firstWall[1], seconds) +
    0.5 * smoothstep(secondWall[0], secondWall[1], seconds);
  return share * down * (1 - smoothstep(regrown[0], regrown[1], seconds));
}

/**
 * What the storm and the flood have done to the rows past the block, as they did to the grove's own trees,
 * vec4s for the `fieldFarRows` uniforms. Each far tree takes its share of it from its own hash and its land.
 */
export type FarRowsLook = {
  /** Share down, the leaves the standing keep, how hurt those are, and their lime flush, 0-1 each. */
  storm: [number, number, number, number];
  /**
   * How far drowned roots have yellowed the trees in the far blocks' low spots, 0-1, the land height below
   * which the block's own drowned (a little more of the far trees drown below it), how far those that die have
   * gone to twigs, 0-1, and the share of them that die.
   */
  decline: [number, number, number, number];
  /** The unit vector the wind blows toward, how far it streams the crowns over, 0-1, and one unused. */
  bend: [number, number, number, number];
  /**
   * How far the first wall's leaners and the second's have gone over, 0-1 each, how much of their lean the
   * crews have left them, and one unused.
   */
  lean: [number, number, number, number];
};

let drownedBelow: number | null = null;

/** The land height under which the flood stood over a tree's roots for longer than the grove's trees stand. */
export function getDrownedBelow(): number {
  if (drownedBelow === null) {
    let low = BED_LAYOUT.ribbonZ;
    let high = 0.09;
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (getDaysUnderWater(middle) > DECLINE_TABLE.days) low = middle;
      else high = middle;
    }
    drownedBelow = (low + high) / 2;
  }
  return drownedBelow;
}

/** How far a wall's leaners have gone over by second `t`, in its steps at its fronts' peaks. */
function getLeanersOver(peaks: readonly number[], t: number): number {
  const {steps} = LEAN_TABLE;
  return peaks.reduce(
    (over, peak, index) => over + (steps[index] ?? 0) * smoothstep(peak - 0.4, peak, t),
    0
  );
}

/**
 * The rows past the block, as the grove's standing trees are now: their leaves, hurt and flush averaged
 * over the grove's own survivors whose roots did not drown, and the decline's own timing for those whose
 * did. The first frame of the cycle and the last see nothing of the storm.
 */
export function getFarRowsLook(state: StoryState, down: number, seconds: number): FarRowsLook {
  let leaves = 0;
  let hurt = 0;
  let flush = 0;
  let count = 0;
  GROVE_PLAN.forEach((row, index) => {
    const tree = state.trees[index];
    if (!tree || row.kind !== 'grove' || row.fall || row.decline || (tree.growth as number) <= 0)
      return;
    leaves += (tree.foliage as number | undefined) ?? 1;
    hurt += clamp01((1 - ((tree.health as number | undefined) ?? 1)) / 0.4);
    flush += (tree.flush as number | undefined) ?? 0;
    count++;
  });
  const {span, deadSpan} = DECLINE_TABLE;
  const declined =
    smoothstep(span[0], span[1], seconds) *
    (1 - smoothstep(FAR_STORM.recover[0], FAR_STORM.recover[1], seconds));
  // The dead go as the block's own skeletons do, as their replacements come, and those regrow with the gaps.
  const dead =
    smoothstep(deadSpan[0], deadSpan[1], seconds) *
    (1 - smoothstep(FAR_STORM.deadGone[0], FAR_STORM.deadGone[1], seconds));
  const [towardX, towardY] = getBearingVector(state.wind.bearing);
  const peaks = HURRICANE.gustPeaks;
  const reset =
    1 - (1 - LEAN_TABLE.kept) * smoothstep(LEAN_TABLE.reset[0], LEAN_TABLE.reset[1], seconds);
  const back = getLeanersOver(peaks.slice(3), seconds) * LEAN_TABLE.backStep * 3;
  return {
    storm: [down, count ? leaves / count : 1, count ? hurt / count : 0, count ? flush / count : 0],
    decline: [declined, getDrownedBelow(), dead, FAR_STORM.deadShare],
    bend: [towardX, towardY, clamp01(state.wind.strength) ** 2, 0],
    lean: [
      Math.max(getLeanersOver(peaks.slice(0, 3), seconds) - back, 0),
      getLeanersOver(peaks.slice(3), seconds),
      reset,
      0
    ]
  };
}

/**
 * Polar mesh, hole, berm, wetness, soil and row detail, the beds, furrows and flood, reading shadows, and
 * the rows past the trees.
 */
export function createGroundLayer(state: StoryState): FieldLayer<any>[] {
  const {ground, weather, wind} = state;
  const holes = writeFieldTrees(state, TREE_TEXELS);
  const [crownHeight, crownRadius] = getFarCrown(state);
  const hasRows = ground.rows.reach > 0 && crownHeight > 0;
  const air = getFieldAir(state) as FieldAir;
  const plan = getFieldPlan(state);
  const flood = getFieldFlood(state);
  const coordinates = {
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0],
    air,
    plan,
    parameters: GROUND_PARAMETERS,
    shadowEnabled: false,
    pickable: false
  };
  const farTreesDown = getFarTreesDown(flood.more[2]);
  const look = getFarRowsLook(state, farTreesDown, flood.more[2]);
  const [towardX, towardY] = getBearingVector(wind.bearing);
  const layers: FieldLayer<any>[] = [
    new FieldGroundLayer({
      ...coordinates,
      id: 'ground',
      flood,
      hero: [ground.hero.hole, ground.hero.holeRadius, ground.hero.holeDepth, ground.hero.berm],
      heroMore: [ground.hero.bermRadius, ground.hero.water, ...getFoamToward(flood.more[2])],
      surface: [ground.wetness, ground.frost, weather.rain, holes],
      ring: [ground.magicRing.radius, ground.magicRing.strength, 0, 0],
      seconds: wind.time,
      wind: [wind.strength, towardX, towardY, wind.gustTime],
      treeWetness: state.treeWetness,
      sites: ground.sites,
      treeTexels: TREE_TEXELS,
      mirrorCandidates: getMirrorCandidates(state),
      rows: [hasRows ? crownHeight : 0, crownRadius * 0.95, farTreesDown, look.storm[1]],
      farStorm: look.storm,
      farDecline: look.decline
    } as never)
  ];
  if (hasRows) {
    layers.push(
      new FieldFarRowsLayer({
        ...coordinates,
        id: 'ground-far-rows',
        shape: [crownHeight, crownRadius * 0.95, 0, 0],
        look
      } as never)
    );
  }
  return layers;
}
