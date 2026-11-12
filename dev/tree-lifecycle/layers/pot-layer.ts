// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The pot and what comes out of it: terracotta by a lathe, potting soil you could put your hand in, with
 * real crumbs and bark on it, the dimple, mound and cracks of the seed's first weeks, grains and a puff of
 * dust, the root balls of the hero and of every replant, and microjets with their fans of spray.
 */

import type {Layer} from '@deck.gl/core';
import {getCameraEye} from '../story/camera';
import {SEED_TABLE} from '../story/props';
import {hash01, hashRange} from '../story/story-math';
import type {StoryPot, StoryRootBall, StoryState} from '../story/story-types';
import {
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
  type PropMesh,
  type PropProgram
} from './prop-shading';

const TWO_PI = Math.PI * 2;

/**
 * A pot's section, from the middle of its floor inside, up the inner wall, over the lip, down the collar and
 * wall, to the middle of its base. Radius over the rim's, height over the pot's, and the radius of the corner
 * each point rounds off. Everything is drawn from this one line.
 */
const SECTION: readonly (readonly [number, number, number])[] = [
  [0, 0.05, 0],
  [0.645, 0.05, 0.03],
  [0.862, 0.985, 0.012],
  [0.872, 1, 0.012],
  [0.992, 1, 0.012],
  [1, 0.985, 0.012],
  [1, 0.79, 0.016],
  [0.905, 0.765, 0.018],
  [0.685, 0.02, 0.018],
  [0.665, 0, 0.012],
  [0, 0, 0]
];

/** Where the inner wall is, as radius over height, for the soil's edge. */
const INNER_WALL = {at: [0.05, 0.985], radius: [0.645, 0.862]} as const;

/** Soil's crumbs, bark and perlite, for the shot where its surface fills the frame. */
const LUMPS = {
  count: 6400,
  /** [kind, share, smallest and largest size in metres]. */
  kinds: [
    {kind: 0, share: 0.44, size: [0.0012, 0.0036]},
    {kind: 1, share: 0.2, size: [0.0024, 0.0085]},
    {kind: 2, share: 0.028, size: [0.0014, 0.0032]},
    {kind: 3, share: 0.13, size: [0.003, 0.0095]},
    {kind: 4, share: 0.2, size: [0.0006, 0.0014]}
  ],
  /** Below this many pixels a lump is left out, in a frame this tall, as a function of the story alone. */
  leastPixels: 1.1,
  frameHeight: 1080
};

/** How much of the height the story gives over the soil the rim really stands. */
const RIM_OVER_SOIL = 0.55;

const DUST = {
  count: 14,
  seconds: 1.15,
  rise: 0.028,
  spread: 0.034,
  radius: [0.008, 0.024],
  alpha: 0.11
};

/** A microjet, in metres: a black stake, an emitter and its spray. */
const JET = {
  height: 0.2,
  stakeRadius: [0.0048, 0.0028],
  headRadius: 0.0075,
  headHeight: 0.016,
  capRadius: 0.009,
  tube: {length: 0.26, radius: 0.0022},
  /**
   * The fan: a low sheet of fine drops 1 to 1.5 m out over the berm, each a short streak along its way,
   * a share of them catching the sun as sparkle, and a share drawn as mist, wider and fainter.
   */
  spray: {
    droplets: 4600,
    farDroplets: 1000,
    farFrom: 16,
    speed: [1.9, 3.5],
    elevation: [0.08, 0.46],
    /** Half the fan, in radians. */
    fan: 1.25,
    gravity: 7.5,
    radius: [0.0007, 0.0016],
    alpha: 0.62,
    streakSeconds: 0.018,
    sparkle: {share: 0.12, gain: 5},
    mist: {share: 0.14, radius: 0.011, alpha: 0.07}
  }
};

/** Whatever keeps the shaders' numbers in the table, as GLSL. */
function floatLiteral(value: number): string {
  const text = value.toFixed(6);
  return text.includes('.') ? text : `${text}.0`;
}

/** A line of points, with each corner rounded, as many short pieces of about equal length. */
function getRoundedLine(points: readonly (readonly [number, number, number])[]): number[][] {
  const out: number[][] = [];
  for (let index = 0; index < points.length; index++) {
    const [x, y, radius] = points[index];
    const before = points[index - 1];
    const after = points[index + 1];
    if (!before || !after || radius <= 0) {
      out.push([x, y]);
    } else {
      const inX = before[0] - x;
      const inY = before[1] - y;
      const outX = after[0] - x;
      const outY = after[1] - y;
      const inLength = Math.hypot(inX, inY);
      const outLength = Math.hypot(outX, outY);
      const reach = Math.min(radius, inLength * 0.45, outLength * 0.45);
      const steps = 6;
      for (let step = 0; step <= steps; step++) {
        const u = step / steps;
        const ax = x + (inX / inLength) * reach;
        const ay = y + (inY / inLength) * reach;
        const bx = x + (outX / outLength) * reach;
        const by = y + (outY / outLength) * reach;
        out.push([
          (1 - u) * (1 - u) * ax + 2 * u * (1 - u) * x + u * u * bx,
          (1 - u) * (1 - u) * ay + 2 * u * (1 - u) * y + u * u * by
        ]);
      }
    }
  }
  // Long straight runs need rows too, for the wobble.
  const dense: number[][] = [];
  for (let index = 0; index < out.length; index++) {
    dense.push(out[index]);
    const next = out[index + 1];
    if (next) {
      const pieces = Math.min(
        Math.ceil(Math.hypot(next[0] - out[index][0], next[1] - out[index][1]) / 0.03),
        30
      );
      for (let piece = 1; piece < pieces; piece++) {
        const u = piece / pieces;
        dense.push([
          out[index][0] + (next[0] - out[index][0]) * u,
          out[index][1] + (next[1] - out[index][1]) * u
        ]);
      }
    }
  }
  return dense;
}

/** No pot is true: it leans a little out of round, and is a little different at each height. */
function getWobble(theta: number, height: number): number {
  return (
    1 +
    0.0065 * Math.sin(2 * theta + 1.1 + height) +
    0.004 * Math.sin(3 * theta + 2.7 - 2 * height) +
    0.0018 * Math.sin(7 * theta + 0.6 + 6 * height) +
    0.0014 * Math.sin(height * 41)
  );
}

function createPotMesh(): PropMesh {
  const line = getRoundedLine(SECTION);
  const rows = line.length - 1;
  return createGridMesh({
    columns: 192,
    rows,
    wrap: true,
    flip: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const place = v * rows;
      const row = Math.min(Math.floor(place), rows - 1);
      const f = place - row;
      const radius = line[row][0] + (line[row + 1][0] - line[row][0]) * f;
      const height = line[row][1] + (line[row + 1][1] - line[row][1]) * f;
      const wobble = getWobble(theta, height);
      return [radius * wobble * Math.cos(theta), radius * wobble * Math.sin(theta), height];
    },
    getDetails: (u, v) => [u, v, 0, 0]
  });
}

/** A disc of soil. Rows crowd the middle, where the seed and shoot are. */
function createSoilMesh(): PropMesh {
  const mesh = createGridMesh({
    columns: 280,
    rows: 110,
    wrap: true,
    flip: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const radius = v ** 1.42;
      return [radius * Math.cos(theta), radius * Math.sin(theta), 0];
    },
    getDetails: (u, v) => [u, v, 0, 0]
  });
  return mesh;
}

/** The soil's lumps: largest first, so that a far shot draws only the ones it can see. */
export function createSoilLumps(): Float32Array {
  const lumps: number[][] = [];
  const total = LUMPS.kinds.reduce((sum, {share}) => sum + share, 0);
  for (let index = 0; index < LUMPS.count; index++) {
    const pick = hash01(index, 401) * total;
    let kind = LUMPS.kinds[0];
    let reached = 0;
    for (const entry of LUMPS.kinds) {
      reached += entry.share;
      if (pick <= reached) {
        kind = entry;
        break;
      }
    }
    const radius = Math.sqrt(hash01(index, 402));
    const angle = hashRange(index, 403, 0, TWO_PI);
    // Most things are near the small end of their kind.
    const size = kind.size[0] + (kind.size[1] - kind.size[0]) * hash01(index, 404) ** 2;
    lumps.push([
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      size,
      kind.kind,
      hashRange(index, 405, 0, TWO_PI),
      hashRange(index, 406, -0.35, 0.35),
      hash01(index, 407),
      hashRange(index, 408, -0.35, 0.35)
    ]);
  }
  lumps.sort((a, b) => b[2] - a[2]);
  return new Float32Array(lumps.flat());
}

/** A root ball: a tapered, rounded plug of soil, with a flat top. Radius 1, height 1, top at 0.5. */
function createRootBallMesh(): PropMesh {
  const section = getRoundedLine([
    [0, 0.5, 0],
    [0.86, 0.5, 0.05],
    [0.8, -0.5, 0.16],
    [0, -0.5, 0]
  ]);
  const rows = section.length - 1;
  return createGridMesh({
    columns: 96,
    rows,
    wrap: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const place = v * rows;
      const row = Math.min(Math.floor(place), rows - 1);
      const f = place - row;
      const radius = section[row][0] + (section[row + 1][0] - section[row][0]) * f;
      const height = section[row][1] + (section[row + 1][1] - section[row][1]) * f;
      const lump =
        1 + 0.03 * Math.sin(3 * theta + 5 * height) + 0.02 * Math.sin(7 * theta - 9 * height + 1);
      return [radius * lump * Math.cos(theta), radius * lump * Math.sin(theta), height];
    },
    getDetails: (u, v) => [u, v, 0, 0]
  });
}

/** A black stake with an emitter and deflector, and the thin tube that feeds it along the ground. */
function createJetMesh(): PropMesh {
  const {height, stakeRadius, headRadius, headHeight, capRadius, tube} = JET;
  const stake = createGridMesh({
    columns: 12,
    rows: 10,
    wrap: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const taper = stakeRadius[0] + (stakeRadius[1] - stakeRadius[0]) * v;
      return [taper * Math.cos(theta), taper * Math.sin(theta), v * (height - headHeight)];
    },
    getDetails: () => [0, 0, 0, 0]
  });
  const headLine = getRoundedLine([
    [0, height - headHeight, 0],
    [headRadius, height - headHeight, 0.0015],
    [headRadius * 0.7, height - headHeight * 0.32, 0.0008],
    [capRadius * 0.24, height - headHeight * 0.26, 0.0002],
    [capRadius * 0.24, height - headHeight * 0.12, 0.0002],
    [capRadius, height - headHeight * 0.08, 0.0012],
    [capRadius * 0.8, height, 0.0012],
    [0, height, 0]
  ]);
  const headRows = headLine.length - 1;
  const head = createGridMesh({
    columns: 16,
    rows: headRows,
    wrap: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      const place = v * headRows;
      const row = Math.min(Math.floor(place), headRows - 1);
      const f = place - row;
      const radius = headLine[row][0] + (headLine[row + 1][0] - headLine[row][0]) * f;
      const z = headLine[row][1] + (headLine[row + 1][1] - headLine[row][1]) * f;
      return [radius * Math.cos(theta), radius * Math.sin(theta), z];
    },
    getDetails: () => [1, 0, 0, 0]
  });
  const feed = createGridMesh({
    columns: 8,
    rows: 24,
    wrap: true,
    getPoint: (u, v) => {
      const theta = u * TWO_PI;
      // Leaves the stake low down and wanders off along the ground.
      const along = v * tube.length;
      const cx = along;
      const cy = 0.02 * Math.sin(v * 3.6);
      const cz = tube.radius + 0.018 * (1 - v) * (1 - v);
      return [cx, cy + tube.radius * Math.cos(theta), cz + tube.radius * Math.sin(theta)];
    },
    getDetails: () => [0, 0, 0, 0]
  });
  return mergeMeshes([stake, head, feed]);
}

const LAZY: {
  pot?: PropMesh;
  soil?: PropMesh;
  lump?: PropMesh;
  lumps?: Float32Array;
  ball?: PropMesh;
  jet?: PropMesh;
} = {};

const POT_PROGRAM: PropProgram = {
  name: 'potBody',
  fields: ['base', 'size', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-body-vs
precision highp float;
in vec3 positions;
in vec3 normals;
in vec4 details;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out vec3 vLocal;
out vec2 vSurface;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec2 size = potBody.size.xy;
  vec3 offset = positions * vec3(size.x, size.x, size.y);
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(potBody.base.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normalize(normals / vec3(size.x, size.x, size.y));
  vLocal = positions;
  vSurface = details.xy;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-body-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec3 vLocal;
in vec2 vSurface;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  float wetness = potBody.look.x;
  float soilAt = potBody.look.y;
  float alpha = potBody.look.z;
  float height = vLocal.z;
  float rho = length(vLocal.xy);
  // A height through the wall, for a pattern that wraps: positions on a cylinder.
  vec3 q = vec3(vLocal.xy * 1.0, height * potBody.size.y / potBody.size.x);
  float footprint = length(fwidth(q));
  // The section's rows run from the floor up the inside to the lip, then down the outside.
  bool inside = vSurface.y < potBody.look.w;

  // Fired clay: never one color. Warm clouds, darker where it was stacked in the kiln.
  float cloud = propFbm(q * 3.3 + 2.0);
  float blush = propFbm(q * 1.15 + 9.0);
  vec3 albedo = mix(vec3(0.27, 0.083, 0.036), vec3(0.385, 0.135, 0.06), cloud);
  albedo = mix(albedo, albedo * vec3(0.82, 0.74, 0.7), smoothstep(0.5, 0.7, blush) * 0.5);

  // The fine sand in the clay: dark flecks and pale ones, down to the size of a pixel.
  float fine = 1.0 - smoothstep(0.004, 0.012, footprint);
  if (fine > 0.0) {
    float speck = propNoise(q * 105.0);
    float pale = propNoise(q * 150.0 + 31.0);
    float tiny = propNoise(q * 330.0 + 7.0);
    albedo = mix(albedo, vec3(0.085, 0.036, 0.02), smoothstep(0.8, 0.88, speck) * 0.6 * fine);
    albedo = mix(albedo, vec3(0.46, 0.3, 0.19), smoothstep(0.82, 0.9, pale) * 0.42 * fine);
    albedo *= 1.0 + (tiny - 0.5) * 0.12 * fine;
  }

  // The lines of its turning, around it, faint, and a soft pitting of its surface.
  vec3 radial = vec3(vLocal.xy / max(rho, 1e-4), 0.0);
  vec3 tilt = vec3(0.0);
  float lines = propNoise(vec3(height * 24.0, 3.0, 0.0)) + 0.4 * propNoise(vec3(height * 77.0, 5.0, 0.0));
  float linesAhead = propNoise(vec3((height + 0.002) * 24.0, 3.0, 0.0)) + 0.4 * propNoise(vec3((height + 0.002) * 77.0, 5.0, 0.0));
  tilt.z += (linesAhead - lines) * 1.5 * (1.0 - smoothstep(0.005, 0.02, footprint));
  albedo *= 1.0 + (lines - 0.7) * 0.035;
  float roughShown = 1.0 - smoothstep(0.003, 0.01, footprint);
  if (roughShown > 0.0) {
    vec3 r = q * 78.0;
    float r0 = propNoise(r);
    tilt += vec3(propNoise(r + vec3(0.4, 0.0, 0.0)) - r0, propNoise(r + vec3(0.0, 0.4, 0.0)) - r0, propNoise(r + vec3(0.0, 0.0, 0.4)) - r0) * 0.2 * roughShown;
  }

  // A pot breathes: water comes through its wall from below, and leaves salts behind it. It is dark where
  // wet, up to a line that wanders, and the bloom gathers above that line and under the collar.
  float wander = propFbm(vec3(q.xy * 4.2, q.z * 3.0) + 13.0);
  float line = 0.03 + 0.34 * wetness * (0.6 + 0.8 * wander);
  float wet = 1.0 - smoothstep(line - 0.1, line + 0.14, height);
  float bloomMask = propFbm(q * 4.1 + 40.0) * 0.5 + propFbm(q * 15.0 + 3.0) * 0.3 + propNoise(q * 46.0 + 8.0) * 0.2;
  float band = smoothstep(line + 0.02, line + 0.2, height) * (1.0 - smoothstep(0.72, 0.84, height) * 0.5);
  float rimBand = smoothstep(0.78, 0.82, height) * smoothstep(1.0, 0.86, height) * 0.55;
  float bloom = smoothstep(0.44, 0.72, bloomMask) * max(band, rimBand) * 0.4;
  bloom *= 0.5 + 0.5 * propNoise(q * 130.0);
  if (inside) {
    wet = max(wet, smoothstep(soilAt + 0.12, soilAt, height));
    bloom *= 0.25;
  }
  albedo = mix(albedo, vec3(0.56, 0.5, 0.41), bloom);
  albedo *= 1.0 - 0.42 * wet;

  vec3 shaded = normalize(normal - (tilt - normal * dot(tilt, normal)));

  // Under the collar, and down inside, little of the sky gets in.
  float occlusion = 1.0;
  if (inside) {
    occlusion *= mix(0.22, 1.0, smoothstep(soilAt - 0.06, 1.0, height));
  } else {
    occlusion *= mix(0.6, 1.0, smoothstep(0.76, 0.5, height) + smoothstep(0.76, 0.8, height));
    occlusion *= mix(0.6, 1.0, smoothstep(0.0, 0.16, height));
  }
  occlusion *= mix(0.5, 1.0, smoothstep(-0.6, 0.3, shaded.z + height));

  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  float keyFacing = dot(normal, toKey);
  propShadowNormal = keyFacing > 0.02 ? normal : vec3(0.0);
  propShadowSoft = 0.0016;
  float bias = 0.0006 + potBody.size.x * 0.02 * (1.0 - abs(keyFacing));
  propLights(shaded, view, vec3(0.12, 0.08, 0.06), mix(10.0, 60.0, wet), 0.12 + 0.5 * wet, 0.4, 0.0, bias);
  vec3 sky = propHemisphere(shaded) * occlusion;
  float facing = max(dot(shaded, view), 0.0);
  vec3 reflectedRay = reflect(-view, shaded);
  reflectedRay.z = reflectedRay.z * 0.4 + 0.2;
  vec3 mirrored = propSkyColor(normalize(reflectedRay)) * (0.012 + 0.16 * pow(1.0 - facing, 5.0)) * occlusion * (0.7 + 0.5 * wet);
  vec3 color = propNightAlbedo(albedo) * (sky + gDiffuse) + gSpecular * 0.8 + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), alpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** The soil's surface, in metres from its center. Shared by the soil, and what lies on it. */
const SOIL_RELIEF_GLSL = /* glsl */ `
// Plates of crust, as cells: f1 to the nearest cell's point, f2 to the next, in cells.
vec3 soilPlates(vec2 xy, out float f2) {
  vec2 g = xy / 0.0085;
  vec2 cell = floor(g);
  float f1 = 9.0;
  f2 = 9.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float h = propHash(vec3(c, 7.0));
      vec2 at = c + 0.5 + (vec2(h, fract(h * 37.0)) - 0.5) * 0.8;
      float d = length(g - at);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = h;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3(f1, id, f2 - f1);
}

float soilRelief(vec2 xy) {
  float bump = soilShape.shape.x;
  float bumpRadius = max(soilShape.shape.y, 1e-4);
  float crack = soilShape.shape.z;
  float r = length(xy);
  float s = r / bumpRadius;
  float inBump = s < 1.0 ? (1.0 - s * s) * (1.0 - s * s) : 0.0;
  float h = bump * inBump;
  // What a dimple pushes aside stands around it.
  if (bump < 0.0) h -= bump * 0.34 * exp(-pow((s - 1.2) / 0.3, 2.0));
  h += (propNoise(vec3(xy / 0.03, 1.0)) - 0.5) * 0.0042;
  h += (propNoise(vec3(xy / 0.012, 2.0)) - 0.5) * 0.0026;
  h += (propNoise(vec3(xy / 0.0048, 3.0)) - 0.5) * 0.0012;
  if (crack > 0.0) {
    float zone = 1.0 - smoothstep(0.35, 1.25, s);
    if (zone > 0.0) {
      float f2;
      vec3 plate = soilPlates(xy, f2);
      // Plates heave up toward the shoot, each at its own height, with their edges broken.
      h += crack * zone * (0.0022 + 0.0024 * plate.y);
      h -= crack * zone * 0.002 * (1.0 - smoothstep(0.0, 0.2, plate.z));
    }
  }
  return h;
}
`;

const SOIL_PROGRAM: PropProgram = {
  name: 'soilShape',
  fields: ['center', 'shape', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-soil-vs
precision highp float;
in vec3 positions;
in vec4 details;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out vec2 vSoil;
${PROP_VERTEX_CHUNK}
${SOIL_RELIEF_GLSL}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float radius = soilShape.center.w;
  vec2 xy = positions.xy * radius;
  float h = soilRelief(xy);
  const float eps = 0.0007;
  float hx = soilRelief(xy + vec2(eps, 0.0));
  float hy = soilRelief(xy + vec2(0.0, eps));
  vec3 offset = vec3(xy, h);
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(soilShape.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normalize(vec3(-(hx - h) / eps, -(hy - h) / eps, 1.0));
  vSoil = xy;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-soil-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec2 vSoil;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}

// The nearest fine crumb under what lies on top: x how far, in cells, yz from it.
vec3 soilCrumb(vec2 g, out float id) {
  vec2 cell = floor(g);
  vec3 best = vec3(9.0, 0.0, 0.0);
  id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float h = propHash(vec3(c, 3.0));
      vec2 toPoint = g - (c + 0.5 + (vec2(h, fract(h * 53.0)) - 0.5) * 0.85);
      float d = length(toPoint);
      if (d < best.x) {
        best = vec3(d, toPoint);
        id = h;
      }
    }
  }
  return best;
}

vec3 cracksAt(vec2 xy) {
  // As soilPlates in the vertex stage.
  vec2 g = xy / 0.0085;
  vec2 cell = floor(g);
  float f1 = 9.0;
  float f2 = 9.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float h = propHash(vec3(c, 7.0));
      vec2 at = c + 0.5 + (vec2(h, fract(h * 37.0)) - 0.5) * 0.8;
      float d = length(g - at);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = h;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3(f1, id, f2 - f1);
}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  vec2 xy = vSoil;
  float wetness = soilShape.look.x;
  float alpha = soilShape.look.y;
  float crack = soilShape.shape.z;
  float footprint = length(fwidth(xy));
  float r = length(xy);
  // Dark peaty soil, drier and paler in places on top.
  float cloud = propFbm(vec3(xy / 0.016, 5.0));
  float fibres = propFbm(vec3(xy / 0.0034, 6.0));
  vec3 albedo = mix(vec3(0.05, 0.034, 0.024), vec3(0.135, 0.098, 0.068), cloud * 0.6 + fibres * 0.4);
  vec3 tilt = vec3(0.0);
  float occlusion = 1.0;
  float gloss = 0.0;

  // Fine crumbs, down to what a pixel can show, each with its own shade.
  float shown = 1.0 - smoothstep(0.0006, 0.0022, footprint);
  if (shown > 0.0) {
    float id;
    vec3 crumb = soilCrumb(xy / 0.0017, id);
    float domed = clamp(crumb.x / 0.72, 0.0, 1.0);
    vec2 away = crumb.yz / max(crumb.x, 1e-4);
    tilt.xy += away * 3.0 * domed * domed * 0.55 * shown;
    albedo *= mix(1.0, mix(0.55, 1.5, id), shown);
    occlusion *= mix(1.0, mix(1.0, 0.42, domed * domed * domed), shown);
    if (id > 0.965) albedo = mix(albedo, vec3(0.5, 0.46, 0.38), shown * (1.0 - domed));
    gloss = (1.0 - domed) * shown;
    float grainShown = 1.0 - smoothstep(0.0002, 0.0007, footprint);
    if (grainShown > 0.0) {
      vec3 q = vec3(xy / 0.00042, 2.0);
      float g0 = propNoise(q);
      tilt.xy += vec2(propNoise(q + vec3(0.4, 0.0, 0.0)) - g0, propNoise(q + vec3(0.0, 0.4, 0.0)) - g0) * 0.7 * grainShown;
      albedo *= 1.0 + (g0 - 0.5) * 0.45 * grainShown;
    }
  }

  // The crust cracks where the shoot comes up: dark lines around plates.
  float darkCrack = 0.0;
  if (crack > 0.0) {
    float s = r / max(soilShape.shape.y, 1e-4);
    float zone = 1.0 - smoothstep(0.4, 1.3, s);
    if (zone > 0.0) {
      vec3 plate = cracksAt(xy);
      float width = 0.045 + 0.13 * crack * zone;
      darkCrack = zone * smoothstep(0.0, 0.2, crack) * (1.0 - smoothstep(width * 0.5, width + footprint / 0.0085, plate.z));
      // A plate's top is drier, and paler than what it broke from.
      albedo = mix(albedo, albedo * vec3(1.45, 1.4, 1.3), crack * zone * 0.75 * plate.y);
    }
  }

  albedo *= 1.0 - 0.5 * wetness;
  vec3 shaded = normalize(normal - (tilt - normal * dot(tilt, normal)));
  occlusion *= 1.0 - 0.94 * darkCrack;
  // The rim of the pot keeps sky from the edges.
  occlusion *= mix(0.66, 1.0, smoothstep(1.0, 0.82, r / soilShape.center.w));

  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  float keyFacing = dot(normal, toKey);
  propShadowNormal = keyFacing > 0.02 ? normal : vec3(0.0);
  propShadowSoft = 0.0009;
  propLights(shaded, view, vec3(0.06), mix(14.0, 90.0, wetness), 0.05 + 0.5 * wetness * gloss, 0.3, 0.0, 0.0008);
  vec3 sky = propHemisphere(shaded) * occlusion;
  float facing = max(dot(shaded, view), 0.0);
  vec3 mirrored = propSkyColor(reflect(-view, shaded)) * (0.015 + 0.3 * pow(1.0 - facing, 5.0)) * occlusion * wetness * (0.35 + gloss);
  vec3 color = propNightAlbedo(albedo) * (sky + gDiffuse * (1.0 - darkCrack)) + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), alpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * What makes a lump the thing it is, for both stages. Kinds: 0 crumb, 1 bark, 2 perlite, 3 fibre, 4 the
 * potting mix's sand, 5 the field's own pale sand.
 */
const LUMP_FRAGMENT = /* glsl */ `
in vec3 vPosition;
in vec3 vCamera;
in vec3 vRest;
in vec4 vLump;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  // Crumbs have facets. Their shading is what shows they are solid.
  vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
  if (dot(normal, view) < 0.0) normal = -normal;
  float kind = vLump.x;
  float id = vLump.y;
  float wetness = vLump.z;
  float low = vLump.w;
  vec3 q = vRest * 6.0 + id * 31.0;
  float grain = propFbm(q);
  vec3 albedo;
  float shininess = 18.0;
  float wax = 0.08;
  if (kind < 0.5) {
    albedo = mix(vec3(0.06, 0.042, 0.028), vec3(0.22, 0.16, 0.105), id * 0.6 + grain * 0.4);
    wax = 0.03;
  } else if (kind < 1.5) {
    // Pine bark: red-brown, stringy along its length, pale on a broken edge.
    float strands = propNoise(vec3(vRest.x * 5.0, vRest.y * 40.0, id * 9.0));
    albedo = mix(vec3(0.085, 0.04, 0.022), vec3(0.24, 0.125, 0.065), strands * 0.7 + id * 0.3);
    shininess = 26.0;
    wax = 0.14;
  } else if (kind < 2.5) {
    // Perlite: a white, popped, gritty stone.
    albedo = vec3(0.58, 0.55, 0.49) * mix(0.72, 1.05, grain);
    shininess = 40.0;
    wax = 0.2;
  } else if (kind < 3.5) {
    albedo = mix(vec3(0.19, 0.12, 0.065), vec3(0.34, 0.24, 0.14), grain);
  } else if (kind < 4.5) {
    albedo = mix(vec3(0.2, 0.155, 0.1), vec3(0.42, 0.34, 0.24), id);
    shininess = 30.0;
    wax = 0.16;
  } else {
    // The field's own sand, as the ground has it: pale quartz, with iron stains and a few dark grains, each
    // frosted by the wind, so matte with a glint on a face here and there.
    albedo = vec3(0.27, 0.25, 0.22) * mix(0.8, 1.15, fract(id * 7.13)) * mix(0.85, 1.1, grain);
    if (id < 0.12) albedo = vec3(0.16, 0.15, 0.14) * mix(0.8, 1.3, grain);
    else if (id < 0.22) albedo = vec3(0.26, 0.18, 0.11) * mix(0.8, 1.3, grain);
    else if (id < 0.25) albedo = vec3(0.04, 0.036, 0.036);
    shininess = 90.0;
    wax = 0.1;
  }
  albedo *= 1.0 - (kind > 1.5 && kind < 2.5 ? 0.15 : 0.5) * wetness;
  // Tucked in among its neighbours at its foot.
  float occlusion = mix(0.28, 1.0, smoothstep(-0.5, 0.45, low));
  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  propShadowNormal = vec3(0.0);
  propShadowSoft = 0.0006;
  propLights(normal, view, vec3(0.1), mix(shininess, shininess * 3.0, wetness), wax + 0.45 * wetness, 0.3, 0.0, 0.0006);
  vec3 sky = propHemisphere(normal) * occlusion;
  float facing = max(dot(normal, view), 0.0);
  vec3 mirrored = propSkyColor(reflect(-view, normal)) * (0.012 + 0.18 * pow(1.0 - facing, 5.0)) * occlusion * (0.35 + wetness);
  vec3 color = albedo * (sky + gDiffuse) + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), vAlpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`;

/** Crumbs, bark and perlite resting on the soil. Instanced from a fixed list, on its relief. */
const SOIL_LUMP_PROGRAM: PropProgram = {
  name: 'soilShape',
  fields: ['center', 'shape', 'look'],
  instanceAttributes: [
    ['instanceSpot', 4],
    ['instanceTurn', 4]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-soil-lump-vs
precision highp float;
in vec3 positions;
in vec4 instanceSpot;
in vec4 instanceTurn;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vRest;
out vec4 vLump;
${PROP_VERTEX_CHUNK}
${SOIL_RELIEF_GLSL}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float radius = soilShape.center.w;
  float size = instanceSpot.z;
  float kind = instanceSpot.w;
  float id = instanceTurn.z;
  vec2 xy = instanceSpot.xy * radius;
  // The dimple and the shoot push things aside.
  float clear = soilShape.shape.w;
  float r = length(xy);
  if (clear > 0.0 && r < clear * 2.0) {
    float reach = r < 1e-5 ? 0.0 : mix(clear, r, smoothstep(0.0, clear * 2.0, r)) / r;
    xy *= max(reach, 1.0);
  }
  vec3 local = positions;
  // Lumpy, each its own way: no two crumbs alike, and none of them round.
  local *= mix(0.55, 1.25, propNoise(positions * 2.6 + id * 37.0));
  local += (vec3(propNoise(positions * 4.1 + id * 11.0), propNoise(positions * 4.1 + id * 23.0), propNoise(positions * 4.1 + id * 41.0)) - 0.5) * 0.5;
  float squash = fract(id * 7.3);
  vec3 stretch = kind < 0.5 ? vec3(1.0, mix(0.55, 1.0, squash), mix(0.38, 0.8, fract(id * 3.1)))
    : kind < 1.5 ? vec3(1.0, mix(0.35, 0.7, squash), 0.14)
    : kind < 2.5 ? vec3(0.95, 0.9, 0.82)
    : kind < 3.5 ? vec3(1.0, 0.08, 0.06)
    : vec3(0.9, 0.75, 0.6);
  vec3 shaped = local * stretch;
  vRest = local;
  float c = cos(instanceTurn.x);
  float s = sin(instanceTurn.x);
  shaped = vec3(c * shaped.x - s * shaped.y, s * shaped.x + c * shaped.y, shaped.z);
  // Tilts, more or less, as it fell.
  shaped.z += dot(shaped.xy, vec2(instanceTurn.y, instanceTurn.w));
  float h = soilRelief(xy);
  vec3 offset = vec3(xy, h + size * (kind > 0.5 && kind < 1.5 ? 0.12 : 0.28)) + shaped * size * 0.5;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(soilShape.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vLump = vec4(kind, id, soilShape.look.x, local.z);
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-soil-lump-fs
precision highp float;
precision highp int;
precision highp sampler2D;
#define vAlpha soilShape.look.y
${LUMP_FRAGMENT}
`
};

/**
 * Grains in the air and tumbling, from the story. Instanced: center, size, alpha. `look` is how wet they
 * are and their kind, as `LUMP_FRAGMENT` has them.
 */
const GRAIN_PROGRAM: PropProgram = {
  name: 'potGrain',
  fields: ['look'],
  instanceAttributes: [
    ['instanceCenter', 3],
    ['instanceSize', 1],
    ['instanceAlpha', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-grain-vs
precision highp float;
in vec3 positions;
in vec3 instanceCenter;
in float instanceSize;
in float instanceAlpha;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vRest;
out vec4 vLump;
out float vAlphaOut;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float id = fract(float(gl_InstanceID) * 0.618034);
  vec3 local = positions * mix(0.72, 1.18, propNoise(positions * 1.9 + id * 37.0));
  if (potGrain.look.y > 4.5) {
    // The field's sand is broken quartz: angular, never round, and each its own way.
    local = positions * mix(0.5, 1.3, propNoise(positions * 2.9 + id * 41.0));
    local *= vec3(1.0, mix(0.6, 1.0, fract(id * 5.7)), mix(0.5, 0.85, fract(id * 3.3)));
    float c = cos(id * 19.0);
    float s = sin(id * 19.0);
    local = vec3(c * local.x - s * local.z, local.y, s * local.x + c * local.z);
  }
  vec3 offset = local * instanceSize * 0.5;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(instanceCenter, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vRest = local;
  vLump = vec4(potGrain.look.y, id, potGrain.look.x, local.z + 0.6);
  vAlphaOut = instanceAlpha;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-grain-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in float vAlphaOut;
#define vAlpha vAlphaOut
${LUMP_FRAGMENT}
`
};

/** A soft sprite of dust. Instanced: center, radius, alpha. */
const DUST_PROGRAM: PropProgram = {
  name: 'potDust',
  ignoresShadow: true,
  vertexCount: 6,
  instanceAttributes: [
    ['instanceCenter', 3],
    ['instanceRadius', 1],
    ['instanceAlpha', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-dust-vs
precision highp float;
in vec3 instanceCenter;
in float instanceRadius;
in float instanceAlpha;
out vec2 vSpot;
out float vAlpha;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  int corner = gl_VertexID;
  vec2 q = corner == 0 ? vec2(-1.0, -1.0) : corner == 1 ? vec2(1.0, -1.0) : corner == 2 ? vec2(1.0, 1.0)
    : corner == 3 ? vec2(-1.0, -1.0) : corner == 4 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
  vec3 anchor = project_position(instanceCenter);
  vec3 toCamera = normalize(project.cameraPosition - anchor);
  vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), toCamera));
  vec3 up = cross(toCamera, right);
  vec4 commonPosition = vec4(anchor + project_size((right * q.x + up * q.y) * instanceRadius), 1.0);
  gl_Position = project_common_position_to_clipspace(commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vSpot = q;
  vAlpha = instanceAlpha;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME pot-dust-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vSpot;
in float vAlpha;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  float d = dot(vSpot, vSpot);
  float soft = exp(-d * 3.2) * smoothstep(1.0, 0.7, d);
  vec3 light = propHemisphere(vec3(0.0, 0.0, 1.0));
  if (lighting.directionalLightCount > 0) light += propLightColor(lighting_getDirectionalLight(0).color) * 0.6;
  vec3 color = vec3(0.3, 0.24, 0.18) * light;
  fragColor = vec4(propFilmic(color), vAlpha * soft);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** Root balls: soil, lumpy, with fine white roots circling it. Instanced: center, radius, height, roots. */
const ROOT_BALL_PROGRAM: PropProgram = {
  name: 'rootBall',
  instanceAttributes: [
    ['instanceCenter', 3],
    ['instanceSize', 2],
    ['instanceRoots', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME root-ball-vs
precision highp float;
in vec3 positions;
in vec3 normals;
in vec4 details;
in vec3 instanceCenter;
in vec2 instanceSize;
in float instanceRoots;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out vec3 vLocal;
out vec3 vBall;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float id = fract(float(gl_InstanceID) * 0.618034);
  vec3 p = positions;
  // Soil holds together in lumps, except on its flat top.
  float side = 1.0 - smoothstep(0.42, 0.5, p.z);
  float lump = propNoise(p * 5.0 + id * 19.0) - 0.5 + (propNoise(p * 13.0 + id * 7.0) - 0.5) * 0.45;
  p += normals * lump * 0.075 * side;
  vec3 size = vec3(instanceSize.x, instanceSize.x, instanceSize.y);
  vec3 offset = p * size;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(instanceCenter, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normalize(normals / size);
  vLocal = p;
  vBall = vec3(instanceSize, instanceRoots);
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME root-ball-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec3 vLocal;
in vec3 vBall;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}

// A root that circles the ball: its distance, in metres, from a family of helices of a given pitch.
float circling(float theta, float z, float wraps, float rings, float salt, float wander) {
  float c = z * rings + theta / 6.2831853 * wraps + salt +
    wander * (sin(theta * 3.0 + salt * 7.0) * 0.5 + sin(theta * 8.0 + z * 9.0 + salt) * 0.2);
  return abs(fract(c) - 0.5) / rings;
}

void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(cross(dFdx(vPosition), dFdy(vPosition)));
  vec3 smoothNormal = normalize(vNormal);
  if (dot(normal, smoothNormal) < 0.0) normal = -normal;
  normal = normalize(mix(smoothNormal, normal, 0.7));
  vec3 p = vLocal;
  float radius = vBall.x;
  float heightM = vBall.y;
  float roots = vBall.z;
  float theta = atan(p.y, p.x);
  float footprintM = length(fwidth(p)) * radius;

  // Soil: crumbling, dark, with pale grit.
  float cloud = propFbm(p * 6.0);
  float crumbs = propNoise(p * 38.0);
  vec3 albedo = mix(vec3(0.045, 0.031, 0.022), vec3(0.13, 0.095, 0.065), cloud * 0.5 + crumbs * 0.5);
  albedo = mix(albedo, vec3(0.34, 0.29, 0.22), smoothstep(0.82, 0.92, propNoise(p * 70.0)) * 0.5);
  float isSide = 1.0 - smoothstep(0.42, 0.495, p.z);

  // Roots: fine and white, circling as they do against the wall of a pot, here and there, and between them
  // the soil they hold shows through.
  float coverage = 0.0;
  float z = p.z;
  float widths[3] = float[3](0.0013, 0.0009, 0.0006);
  for (int i = 0; i < 3; i++) {
    float salt = float(i) * 0.37 + 0.11;
    float rings = (i == 0 ? 5.0 : i == 1 ? 8.0 : 13.0);
    float wraps = (i == 0 ? 2.0 : i == 1 ? -3.0 : 5.0);
    // Wander more than a turning of the wall would have them.
    float wiggle = propNoise(vec3(cos(theta) * 2.3, sin(theta) * 2.3, z * 3.0 + float(i) * 7.0));
    float d = circling(theta, z + (wiggle - 0.5) * 0.2, wraps, rings, salt, 0.9) * heightM;
    float breaks = smoothstep(0.42, 0.58, propNoise(vec3(cos(theta) * 3.1, sin(theta) * 3.1, z * 5.0 + float(i) * 5.0)));
    float w = widths[i] * mix(0.5, 1.5, propNoise(vec3(theta * 8.0, z * 11.0, float(i))));
    float aa = max(footprintM, 1e-5);
    // A root under a pixel wide still shows, as less of a pixel.
    float line = clamp((w + aa * 0.5 - d) / aa, 0.0, 1.0) * min(w * 2.0 / aa, 1.0);
    coverage = max(coverage, line * breaks * smoothstep(float(i) * 0.25, 0.3 + float(i) * 0.25, roots));
  }
  // None on the very top.
  coverage *= isSide;
  albedo = mix(albedo, vec3(0.84, 0.79, 0.67) * mix(0.8, 1.05, crumbs), coverage);
  // And lying in a shallow groove of shadow.
  float occlusion = mix(0.75, 1.0, crumbs);

  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  float keyFacing = dot(smoothNormal, toKey);
  propShadowNormal = keyFacing > 0.02 ? smoothNormal : vec3(0.0);
  propShadowSoft = 0.004;
  propLights(normal, view, vec3(0.14), 14.0, 0.06, 0.3, 0.0, 0.002 + radius * 0.05);
  vec3 sky = propHemisphere(normal) * occlusion;
  vec3 color = albedo * (sky + gDiffuse) + gSpecular;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** Microjets: black plastic. Instanced: position, how far up it has come. */
const JET_PROGRAM: PropProgram = {
  name: 'jetBody',
  instanceAttributes: [
    ['instanceSpot', 4],
    ['instanceAim', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME jet-body-vs
precision highp float;
in vec3 positions;
in vec3 normals;
in vec4 details;
in vec4 instanceSpot;
in float instanceAim;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float c = cos(instanceAim);
  float s = sin(instanceAim);
  vec3 p = vec3(c * positions.x - s * positions.y, s * positions.x + c * positions.y, positions.z * instanceSpot.w);
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(instanceSpot.xyz, vec3(0.0), project_size(p), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = vec3(c * normals.x - s * normals.y, s * normals.x + c * normals.y, normals.z);
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME jet-body-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  if (dot(normal, view) < 0.0) normal = -normal;
  vec3 albedo = vec3(0.016, 0.016, 0.017);
  propShadowSoft = 0.003;
  propLights(normal, view, vec3(0.05), 60.0, 0.75, 0.5, 0.0, 0.004);
  float facing = max(dot(normal, view), 0.0);
  vec3 mirrored = propSkyColor(reflect(-view, normal)) * (0.05 + 0.6 * pow(1.0 - facing, 5.0));
  vec3 color = albedo * (propHemisphere(normal) + gDiffuse) + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * The fan of spray: a fixed number of droplets per jet, each on its own ballistic arc from the emitter, a
 * function of the story's clock. No vertex data: a droplet is `gl_VertexID / 6`. Instanced by jet: position
 * of the nozzle, how much it is spraying, aim, and a seed.
 */
const SPRAY_PROGRAM: PropProgram = {
  name: 'jetSpray',
  ignoresShadow: true,
  fields: ['clock'],
  instanceAttributes: [
    ['instanceNozzle', 3],
    ['instanceSpray', 3]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME jet-spray-vs
precision highp float;
in vec3 instanceNozzle;
in vec3 instanceSpray;
out vec2 vSpot;
out float vAlpha;
out vec3 vPosition;
out vec3 vCamera;
// How much it sparkles, and 1 for mist.
out vec2 vKind;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float droplet = float(gl_VertexID / 6);
  int corner = gl_VertexID % 6;
  vec2 q = corner == 0 ? vec2(-1.0, -1.0) : corner == 1 ? vec2(1.0, -1.0) : corner == 2 ? vec2(1.0, 1.0)
    : corner == 3 ? vec2(-1.0, -1.0) : corner == 4 ? vec2(1.0, 1.0) : vec2(-1.0, 1.0);
  float spraying = instanceSpray.x;
  float aim = instanceSpray.y;
  float seed = instanceSpray.z;
  vec3 h = vec3(
    propHash(vec3(droplet, seed, 1.0)),
    propHash(vec3(droplet, seed, 2.0)),
    propHash(vec3(droplet, seed, 3.0))
  );
  float h4 = propHash(vec3(droplet, seed, 4.0));
  float h5 = propHash(vec3(droplet, seed, 5.0));
  float h6 = propHash(vec3(droplet, seed, 6.0));
  bool mist = h6 < ${floatLiteral(JET.spray.mist.share)};
  float sparkle = h6 > ${floatLiteral(1 - JET.spray.sparkle.share)} ? ${floatLiteral(JET.spray.sparkle.gain)} : 0.0;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vSpot = q;
  vAlpha = 0.0;
  vKind = vec2(0.0);
  vPosition = vec3(0.0);
  vCamera = vec3(0.0);
  geometry.position = vec4(0.0);
  propShadowWrite(vec4(0.0, 0.0, 0.0, 1.0));
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
  if (h.x > spraying) return;
  // Ribs of the emitter make the fan into streams.
  float across = (h.y - 0.5) * 2.0;
  float rib = floor(across * 7.0) / 7.0 + (fract(across * 7.0) - 0.5) * 0.09;
  float bearing = aim + mix(across, rib, 0.7) * ${floatLiteral(JET.spray.fan)};
  float elevation = mix(${floatLiteral(JET.spray.elevation[0])}, ${floatLiteral(JET.spray.elevation[1])}, h.z * h.z);
  float speed = mix(${floatLiteral(JET.spray.speed[0])}, ${floatLiteral(JET.spray.speed[1])}, h4);
  float rise = speed * sin(elevation);
  float gravity = ${floatLiteral(JET.spray.gravity)};
  float flight = (rise + sqrt(rise * rise + 2.0 * gravity * instanceNozzle.z)) / gravity;
  float life = fract(jetSpray.clock.x / max(flight, 0.05) + h5);
  float tau = life * flight;
  float flat_ = speed * cos(elevation);
  // Fine drops slow in the air.
  float travelled = flat_ * tau * (1.0 - 0.22 * life);
  vec3 point = vec3(
    instanceNozzle.xy + vec2(cos(bearing), sin(bearing)) * travelled,
    max(instanceNozzle.z + rise * tau - 0.5 * gravity * tau * tau, 0.0)
  );
  vec3 anchor = project_position(point);
  vec3 toCamera = project.cameraPosition - anchor;
  float distanceM = length(toCamera) / max(project_size(1.0), 1e-9);
  toCamera = normalize(toCamera);
  vec3 right = normalize(cross(vec3(0.0, 0.0, 1.0), toCamera));
  vec3 up = cross(toCamera, right);
  float pixelsPerMetre = propLook.screen.x / max(distanceM, 1e-3);
  float size = mix(${floatLiteral(JET.spray.radius[0])}, ${floatLiteral(JET.spray.radius[1])}, h4 * h5);
  // Mist is the finest of it, seen as a haze along the fan rather than as drops.
  if (mist) size = ${floatLiteral(JET.spray.mist.radius)} * mix(0.6, 1.4, h4);
  // A droplet under a pixel still catches the light, as less of a pixel.
  float least = 0.8 / pixelsPerMetre;
  float drawn = max(size, least);
  float dim = max(min(size * size / (drawn * drawn) * 3.0, 1.0), 0.32);
  // Each is a short streak along its way, as a drop is to the eye. A shutter draws out the rest.
  vec3 velocity = vec3(vec2(cos(bearing), sin(bearing)) * flat_, rise - gravity * tau);
  vec3 streak = velocity * ${floatLiteral(JET.spray.streakSeconds)} * q.x * (mist ? 0.5 : 1.0);
  vec3 sideways = normalize(cross(velocity, toCamera));
  vec4 commonPosition = vec4(anchor + project_size(streak + sideways * q.y * drawn), 1.0);
  gl_Position = project_common_position_to_clipspace(commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vAlpha = dim * smoothstep(0.0, 0.02, life) * smoothstep(1.0, 0.86, life);
  if (mist) vAlpha = ${floatLiteral(JET.spray.mist.alpha / JET.spray.alpha)} * smoothstep(0.0, 0.1, life) * smoothstep(1.0, 0.7, life);
  // A sparkle comes and goes as the drop turns its glint to the eye.
  vKind = vec2(sparkle * smoothstep(0.55, 1.0, sin(life * 31.0 + h5 * 6.2832) * 0.5 + 0.5), mist ? 1.0 : 0.0);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  propShadowWrite(commonPosition);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME jet-spray-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vSpot;
in float vAlpha;
in vec3 vPosition;
in vec3 vCamera;
in vec2 vKind;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  float d = dot(vSpot, vSpot);
  if (d > 1.0 || vAlpha <= 0.0) discard;
  vec3 view = normalize(vCamera - vPosition);
  // Water scatters forward: drops light up looking toward the sun, and each holds a glint of it.
  vec3 light = propHemisphere(vec3(0.0, 0.0, 1.0)) * 0.8;
  if (lighting.directionalLightCount > 0) {
    DirectionalLight key = lighting_getDirectionalLight(0);
    vec3 toKey = normalize(-key.direction);
    float toward = max(dot(-view, toKey), 0.0);
    light += propLightColor(key.color) * (0.32 + 2.2 * pow(toward, 4.0) + vKind.x * (0.4 + toward));
  }
  vec3 color = light * vec3(0.9, 0.95, 1.0);
  float edge = vKind.y > 0.5 ? exp(-d * 2.6) * smoothstep(1.0, 0.6, d) : smoothstep(1.0, 0.4, d);
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), vAlpha * ${floatLiteral(JET.spray.alpha)} * edge);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/** How many of the soil's lumps are large enough to see, from a distance. Largest first. */
export function getLumpCount(lumps: Float32Array, pixelsPerMetre: number): number {
  const stride = 8;
  const count = lumps.length / stride;
  let low = 0;
  let high = count;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lumps[middle * stride + 2] * pixelsPerMetre >= LUMPS.leastPixels) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The height the pot is drawn at. Its rim stands a little lower over its soil than the story's height says, as
 * in a low shot it would otherwise hide the middle of the soil, where everything happens.
 */
export function getPotHeight(pot: StoryPot): number {
  return pot.soilLevel + RIM_OVER_SOIL * (pot.height - pot.soilLevel);
}

/** The soil's radius in metres, where it meets the inner wall. */
export function getSoilRadius(pot: StoryPot): number {
  const height = pot.soilLevel / getPotHeight(pot);
  const u = (height - INNER_WALL.at[0]) / (INNER_WALL.at[1] - INNER_WALL.at[0]);
  return (INNER_WALL.radius[0] + (INNER_WALL.radius[1] - INNER_WALL.radius[0]) * u) * pot.rimRadius;
}

function createPotLayers(state: StoryState, pot: StoryPot, hasRootBall: boolean): Layer[] {
  const base = getPropLayerProps(state.fog);
  const layers: Layer[] = [];
  const {position, rimRadius, alpha} = pot;
  const height = getPotHeight(pot);
  LAZY.pot ??= createPotMesh();
  const insideEnd = getInsideRowShare();
  const blending = alpha < 1 ? {parameters: {depthWriteEnabled: true}} : {};
  const contacts: number[] = [];
  writeContact(
    contacts,
    position[0],
    position[1],
    rimRadius * 0.76,
    0.86 * alpha,
    state.key.direction
  );
  layers.push(
    new PropMeshLayer({
      ...base,
      id: 'pot-contact',
      mesh: PROP_QUAD_MESH,
      program: CONTACT_PROGRAM,
      instances: new Float32Array(contacts),
      instanceCount: contacts.length / CONTACT_STRIDE,
      shadowEnabled: false,
      parameters: {depthWriteEnabled: false}
    }) as Layer,
    new PropMeshLayer({
      ...base,
      id: 'pot-body',
      mesh: LAZY.pot,
      program: POT_PROGRAM,
      values: {
        base: [position[0], position[1], position[2], 0],
        size: [rimRadius, height, 0, 0],
        look: [pot.soilWetness, pot.soilLevel / height, alpha, insideEnd]
      },
      shadowEnabled: alpha > 0.5,
      ...blending
    }) as Layer
  );
  if (!hasRootBall) {
    LAZY.soil ??= createSoilMesh();
    LAZY.lump ??= createSphereMesh(1);
    LAZY.lumps ??= createSoilLumps();
    const radius = getSoilRadius(pot);
    const center = [position[0], position[1], position[2] + pot.soilLevel, radius];
    const clear = Math.max(-pot.soilBump, 0) * 2 + pot.soilCrack * 0.0048;
    const shape = [pot.soilBump, pot.soilBumpRadius, pot.soilCrack, clear];
    const look = [pot.soilWetness, alpha, 0, 0];
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'pot-soil',
        mesh: LAZY.soil,
        program: SOIL_PROGRAM,
        values: {center, shape, look}
      }) as Layer
    );
    const eye = getEyeDistance(state, position[0], position[1], position[2] + pot.soilLevel);
    const lumps = LAZY.lumps;
    const pixelsPerMetre =
      LUMPS.frameHeight / (2 * Math.tan((state.camera.fovy * Math.PI) / 360) * Math.max(eye, 1e-3));
    const shown = getLumpCount(lumps, pixelsPerMetre);
    if (shown > 0) {
      layers.push(
        new PropMeshLayer({
          ...base,
          id: 'pot-lumps',
          mesh: LAZY.lump,
          program: SOIL_LUMP_PROGRAM,
          values: {center, shape, look},
          instances: lumps,
          instanceCount: shown
        }) as Layer
      );
    }
    if (pot.grains.length > 0) {
      const values = new Float32Array(pot.grains.length * 5);
      pot.grains.forEach(({position: at, size, alpha: seen}, index) => {
        values.set(
          [at[0] + position[0], at[1] + position[1], at[2] + position[2], size, seen],
          index * 5
        );
      });
      layers.push(
        new PropMeshLayer({
          ...base,
          id: 'pot-grains',
          mesh: LAZY.lump,
          program: GRAIN_PROGRAM,
          values: {look: [pot.soilWetness, 0, 0, 0]},
          instances: values,
          instanceCount: pot.grains.length
        }) as Layer
      );
    }
    // The seed's landing puts up a little soft dust.
    const since = state.t - SEED_TABLE.land;
    if (since > 0 && since < DUST.seconds) {
      const dust: number[] = [];
      const fade = 1 - since / DUST.seconds;
      for (let index = 0; index < DUST.count; index++) {
        const angle = hashRange(index, 501, 0, TWO_PI);
        const reach = DUST.spread * hashRange(index, 502, 0.2, 1) * Math.sqrt(since);
        const rise = DUST.rise * hashRange(index, 503, 0.3, 1) * Math.sqrt(since) * 1.3;
        dust.push(
          position[0] + reach * Math.cos(angle),
          position[1] + reach * Math.sin(angle),
          position[2] + pot.soilLevel + 0.002 + rise,
          hashRange(index, 504, DUST.radius[0], DUST.radius[1]) * (0.5 + since),
          DUST.alpha * fade * fade * Math.min(since / 0.05, 1)
        );
      }
      layers.push(
        new PropMeshLayer({
          ...base,
          id: 'pot-dust',
          program: DUST_PROGRAM,
          instances: new Float32Array(dust),
          instanceCount: DUST.count,
          shadowEnabled: false,
          parameters: {depthWriteEnabled: false}
        }) as Layer
      );
    }
  }
  return layers;
}

let insideRowShare: number | null = null;

/** The share of the pot's section that is its inside, up to the middle of its lip. */
function getInsideRowShare(): number {
  if (insideRowShare !== null) return insideRowShare;
  const line = getRoundedLine(SECTION);
  let lip = 0;
  for (let index = 0; index < line.length; index++) {
    if (line[index][0] >= 0.93 && line[index][1] >= 0.99) {
      lip = index;
      break;
    }
  }
  insideRowShare = lip / (line.length - 1);
  return insideRowShare;
}

function getEyeDistance(state: StoryState, x: number, y: number, z: number): number {
  const [eyeX, eyeY, eyeZ] = getCameraEye(state.camera);
  return Math.hypot(x - eyeX, y - eyeY, z - eyeZ);
}

function createRootBallLayers(state: StoryState, balls: readonly StoryRootBall[]): Layer[] {
  if (balls.length === 0) return [];
  LAZY.ball ??= createRootBallMesh();
  const values = new Float32Array(balls.length * 6);
  balls.forEach(({position, radius, height, roots}, index) => {
    values.set([position[0], position[1], position[2], radius, height, roots], index * 6);
  });
  return [
    new PropMeshLayer({
      ...getPropLayerProps(state.fog),
      id: 'root-balls',
      mesh: LAZY.ball,
      program: ROOT_BALL_PROGRAM,
      instances: values,
      instanceCount: balls.length
    }) as Layer
  ];
}

function createJetLayers(state: StoryState): Layer[] {
  const jets = state.props.microjets.filter(jet => jet.visible > 0);
  if (jets.length === 0) return [];
  LAZY.jet ??= createJetMesh();
  const base = getPropLayerProps(state.fog);
  const body = new Float32Array(jets.length * 5);
  const spraying: number[] = [];
  let nearest = Infinity;
  jets.forEach((jet, index) => {
    // It waters the nearest tree: aimed there, and its tube runs away from it.
    let aim = hash01(index, 511) * TWO_PI;
    let closest = Infinity;
    for (const tree of state.trees) {
      if ((tree.growth as number) > 0) {
        const at = tree.position as ArrayLike<number>;
        const distance = Math.hypot(at[0] - jet.position[0], at[1] - jet.position[1]);
        if (distance < closest) {
          closest = distance;
          aim = Math.atan2(at[1] - jet.position[1], at[0] - jet.position[0]);
        }
      }
    }
    body.set(
      [jet.position[0], jet.position[1], jet.position[2], jet.visible, aim + Math.PI],
      index * 5
    );
    if (jet.spray > 0) {
      const eye = getEyeDistance(state, jet.position[0], jet.position[1], JET.height);
      nearest = Math.min(nearest, eye);
      spraying.push(
        jet.position[0],
        jet.position[1],
        jet.position[2] + JET.height - JET.headHeight * 0.2,
        jet.spray,
        aim,
        index * 13 + 1
      );
    }
  });
  const layers: Layer[] = [
    new PropMeshLayer({
      ...base,
      id: 'jets',
      mesh: LAZY.jet,
      program: JET_PROGRAM,
      instances: body,
      instanceCount: jets.length
    }) as Layer
  ];
  if (spraying.length > 0) {
    const {droplets, farDroplets, farFrom} = JET.spray;
    const count = nearest < farFrom ? droplets : farDroplets;
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'jet-spray',
        program: SPRAY_PROGRAM,
        values: {clock: [state.wind.time, 0, 0, 0]},
        instances: new Float32Array(spraying),
        instanceCount: spraying.length / 6,
        drawCount: count * 6,
        shadowEnabled: false,
        parameters: {depthWriteEnabled: false}
      }) as Layer
    );
  }
  return layers;
}

/** Kind of grain, as `LUMP_FRAGMENT` has them, for the field's own sand. */
const FIELD_SAND = 5;

/** The crown of sand the orange throws up where it lands, in the field sand's colour. */
function createPuffLayers(state: StoryState): Layer[] {
  const {puffs} = state.props;
  if (puffs.length === 0) return [];
  LAZY.lump ??= createSphereMesh(1);
  const values = new Float32Array(puffs.length * 5);
  puffs.forEach(({position, size, alpha}, index) => {
    values.set([position[0], position[1], position[2], size, alpha], index * 5);
  });
  return [
    new PropMeshLayer({
      ...getPropLayerProps(state.fog),
      id: 'sand-puffs',
      mesh: LAZY.lump,
      program: GRAIN_PROGRAM,
      values: {look: [state.ground.wetness * 0.5, FIELD_SAND, 0, 0]},
      instances: values,
      instanceCount: puffs.length
    }) as Layer
  ];
}

/** Terracotta pot, potting soil, mound, grains, root balls, microjets and puffs of sand. */
export function createPotLayer(state: StoryState): Layer | Layer[] | null {
  const {pot, rootBall, microjets} = state.props;
  const balls: StoryRootBall[] = [];
  if (rootBall) balls.push(rootBall);
  for (const site of state.ground.sites) {
    if (site.rootBall) balls.push(site.rootBall);
  }
  const layers: Layer[] = [];
  if (pot.visible) layers.push(...createPotLayers(state, pot, Boolean(rootBall)));
  layers.push(...createRootBallLayers(state, balls));
  if (microjets.length > 0) layers.push(...createJetLayers(state));
  layers.push(...createPuffLayers(state));
  return layers.length > 0 ? layers : null;
}
