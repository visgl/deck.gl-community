// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * GLSL of the far trees, in two steps a frame.
 *
 * 1. **Trees**, by transform feedback: one invocation per state row works out everything about its tree for this
 *    frame, through photoreal's own shared vertex chunk, so a far tree grows, leans, bends and rots as its leaves
 *    would: where it stands in common space, its turn and scale, wind, crush and rot, its crown light's parameters,
 *    its color, how much of its hull to keep and at which level. 15 vec4s, interleaved into one buffer.
 * 2. **Hulls and ground**, instanced by row, read that buffer as instance attributes. A hull vertex is a template
 *    point, a matrix, a bend and a projection; the fragment stage adds leaf mottle and light.
 */

import type {ShaderModule} from '@luma.gl/shadertools';
import {
  TREE_PHOTOREAL_FRAGMENT_CHUNK,
  TREE_PHOTOREAL_VERTEX_CHUNK
} from '../../../../modules/layers/src/tree-layer/tree-photoreal-shaders';
import {TREE_STATE_TEXEL} from '../../../../modules/layers/src/tree-layer/tree-photoreal-layout';
import {SHELL_OPAQUE_TAU, SHELL_STAGES} from './shell-fit';

export type ShellUniforms = {
  /** Timeline seconds, pass (0 opaque, 1 dissolve), unused, 1 when far hulls cast into the map. */
  timing: [number, number, number, number];
  /** Hull vertices of this draw's level, this draw's level (0 tiny, 1 coarse, 2 fine), crown pixels for fine and coarse. */
  hull: [number, number, number, number];
  /** Mottle strength, gap darkness, specular, brightness. */
  look: [number, number, number, number];
  /** Color gain (linear RGB) and glow. */
  tint: [number, number, number, number];
  /** Width of the cell texture, rows per cell, ground shadow strength, ground shadow softness. */
  cells: [number, number, number, number];
  /** Sun ground direction xy (where shadows fall), sun elevation sine, 1 if there is a sun that casts. */
  sun: [number, number, number, number];
  /** Unit direction toward the first directional light, and 1 if there is one. */
  light: [number, number, number, number];
  /** Of fine trees: the core's scale and darkness, the outer leaves' share, and their size on screen in pixels. */
  leaf: [number, number, number, number];
  /** Of fine trees: the outer leaves' scale, the brightness of light by the pixel, how fast leaves thin at the rim. */
  outer: [number, number, number, number];
};

const DECLARATION = `uniform shellUniforms {
  vec4 timing;
  vec4 hull;
  vec4 look;
  vec4 tint;
  vec4 cells;
  vec4 sun;
  vec4 light;
  vec4 leaf;
  vec4 outer;
} shell;`;

export const shellUniforms = {
  name: 'shell',
  vs: DECLARATION,
  fs: DECLARATION,
  uniformTypes: {
    timing: 'vec4<f32>',
    hull: 'vec4<f32>',
    look: 'vec4<f32>',
    tint: 'vec4<f32>',
    cells: 'vec4<f32>',
    sun: 'vec4<f32>',
    light: 'vec4<f32>',
    leaf: 'vec4<f32>',
    outer: 'vec4<f32>'
  }
} as const satisfies ShaderModule<ShellUniforms>;

/** The per-tree outputs, in buffer order. */
export const SHELL_TREE_OUTPUTS = [
  'tA',
  'tB',
  'tC',
  'tD',
  'tE',
  'tF',
  'tG',
  'tH',
  'tI',
  'tJ',
  'tK',
  'tL',
  'tM',
  'tN',
  'tO'
] as const;

const {LIFE, POSE, MISC, DETAIL, CANOPY} = TREE_STATE_TEXEL;

function floatLiteral(value: number): string {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.0`;
}

const STAGES = `const int SHELL_STAGE_COUNT = ${SHELL_STAGES.length};
const float SHELL_STAGES[${SHELL_STAGES.length}] = float[${SHELL_STAGES.length}](${SHELL_STAGES.map(floatLiteral).join(', ')});`;

const HULL_TEXELS = /* glsl */ `
uniform sampler2D shellHull;
${STAGES}
vec4 shellHullTexel(int templateIndex, int stage, int texel) {
  return texelFetch(shellHull, ivec2(texel, templateIndex * SHELL_STAGE_COUNT + stage), 0);
}
`;

/**
 * What each tree is this frame. Outputs, all vec4:
 *   tA  anchor in common space, crown share kept (-1 for no tree)
 *   tB-tD  columns of lean x yaw, and the template-to-metres scale x, y, z
 *   tE  translation of the lean about the root plate, common units per metre
 *   tF  wind bend xy, live height, ground layer of a crushed crown
 *   tG  lean direction xy, root plate radius, rot's flattening
 *   tH  stage, blend to the next, template, damage
 *   tI  direction to the sun in crown space over the crown's radii, sun density
 *   tJ  up in crown space over the radii, sky density
 *   tK  template-to-crown-space scale xyz and offset z
 *   tL  crown rim (metres), crown fullness, middle of the stage's leaves (template z), rot's debris height
 *   tM  leaf albedo (linear), brown share
 *   tN  pixels per metre at the tree, fog visibility, wax, state row
 *   tO  crown half width and half height (metres), stub radius, share of the tree this renderer draws
 */
export function getShellTreeShaders(): {vs: string; fs: string} {
  const vs = /* glsl */ `#version 300 es
#define SHADER_NAME shell-trees-vs
precision highp float;
precision highp int;
precision highp sampler2D;

${SHELL_TREE_OUTPUTS.map(name => `out vec4 ${name};`).join('\n')}

${TREE_PHOTOREAL_VERTEX_CHUNK}

uniform sampler2D shellCells;
// The cells drawn this frame, sorted by bucket, and the template of every row.
uniform sampler2D shellOrder;
uniform sampler2D shellRows;
${HULL_TEXELS}

// How much of a tree this renderer draws: 1 far, 0 where photoreal has it, in between while they hand over.
float shellCellFade(int row) {
  int cell = row / int(shell.cells.y);
  int width = int(shell.cells.x);
  vec4 state = texelFetch(shellCells, ivec2(cell % width, cell / width), 0);
  float span = state.z - state.y;
  float moved = clamp((shell.timing.x - state.x) / max(state.w, 1e-3), 0.0, abs(span));
  return state.y + sign(span) * moved;
}

// Mean opacity over the disc of a ball of leaves whose optical depth along a diameter is tau.
float shellOpacity(float tau) {
  if (tau < 0.01) return tau * 0.6667;
  return 1.0 - 2.0 / (tau * tau) * (1.0 - (1.0 + tau) * exp(-tau));
}

// A world direction in the crown's own axes: before lean and yaw, as photoreal's crown light takes it.
vec3 shellCrownAxes(vec3 v) {
  if (tree.lean > 0.0) {
    vec3 axis = vec3(-tree.leanDirection.y, tree.leanDirection.x, 0.0);
    v = v * tree.leanCos - cross(axis, v) * tree.leanSin + axis * dot(axis, v) * (1.0 - tree.leanCos);
  }
  return vec3(v.x * tree.yaw.x + v.y * tree.yaw.y, v.y * tree.yaw.x - v.x * tree.yaw.y, v.z);
}

// The average leaf of a far crown, in linear light, as the photoreal leaf stage makes them.
vec3 shellLeafAlbedo(vec4 canopy) {
  vec3 tint = pow(canopy.rgb, vec3(2.2));
  float luminance = dot(tint, vec3(0.3, 0.55, 0.15));
  vec3 top = mix(tint, vec3(luminance), 0.45) * vec3(0.82, 0.53, 0.33);
  top *= mix(vec3(0.72, 0.74, 0.86), vec3(1.16, 1.12, 0.95), 0.56);
  top = mix(top, vec3(0.17, 0.27, 0.05), tree.flush * 0.14);
  float rotted = smoothstep(0.02, 0.4, tree.decay);
  return mix(top, vec3(0.075, 0.058, 0.04), rotted);
}

void main(void) {
  gl_Position = vec4(0.0);
${SHELL_TREE_OUTPUTS.map(name => `  ${name} = vec4(0.0);`).join('\n')}
  tA.w = -1.0;
  tO.w = -1.0;
  int rowsPerCell = int(shell.cells.y);
  int slot = gl_VertexID / rowsPerCell;
  int orderWidth = textureSize(shellOrder, 0).x;
  int cell = int(texelFetch(shellOrder, ivec2(slot % orderWidth, slot / orderWidth), 0).x + 0.5);
  int row = cell * rowsPerCell + gl_VertexID - slot * rowsPerCell;
  int rowsWidth = textureSize(shellRows, 0).x;
  int templateIndex = int(texelFetch(shellRows, ivec2(row % rowsWidth, row / rowsWidth), 0).x + 0.5);
  if (templateIndex < 0) return;
  float fade = shellCellFade(row);
  if (fade <= 0.0) return;
  vec4 life = treeStateTexel(row, ${LIFE});
  if (life.x <= 0.0) return;
  treeSetLife(life, treeStateTexel(row, ${POSE}), treeStateTexel(row, ${MISC}), treeStateTexel(row, ${DETAIL}));
  if (tree.decay >= 1.0) return;
  treeLoadPlace(row);

  // The growth stage, and how opaque the crown is as a whole from its leaves, their size, and what they fill.
  int stage0 = 0;
  for (int s = 0; s < SHELL_STAGE_COUNT - 1; s++) {
    if (tree.growth >= SHELL_STAGES[s]) stage0 = s;
  }
  int stage1 = min(stage0 + 1, SHELL_STAGE_COUNT - 1);
  float blend = stage1 == stage0 ? 0.0 : clamp((tree.growth - SHELL_STAGES[stage0]) / (SHELL_STAGES[stage1] - SHELL_STAGES[stage0]), 0.0, 1.0);
  vec4 stage = mix(shellHullTexel(templateIndex, stage0, 0), shellHullTexel(templateIndex, stage1, 0), blend);
  float leafArea = shellHullTexel(templateIndex, 0, 1).x * stage.x * tree.leafScale * tree.leafScale;
  float halfWidth = max(stage.y * 0.5 * (tree.size.x + tree.size.y), 0.01);
  float halfHeight = max((stage.w - stage.z) * 0.5, 0.005) * tree.size.z;
  // How opaque a crown looks, from its leaves: half the optical depth they would have as a cloud of random discs, as
  // a crown's leaves overlap. A mature full crown, at about 2.5, is opaque; a seedling's or a thinned one's is not.
  float tau = 0.5 * 0.75 * leafArea / (3.14159265 * halfWidth * halfHeight);
  float thin = tree.foliage * tree.coverage * (1.0 - 0.7 * tree.damage) * (1.0 - smoothstep(0.0, 0.65, tree.decay));
  float cover = clamp(shellOpacity(tau * thin) / shellOpacity(${floatLiteral(SHELL_OPAQUE_TAU)}), 0.0, 1.0);
  // A crown losing its leaves shows its twigs, as a sparse haze of bark in the crown's shape.
  float twigs = 0.12 * smoothstep(0.25, 0.6, tree.growth) * (1.0 - smoothstep(0.3, 0.7, tree.decay)) *
    (1.0 - 0.6 * tree.damage);
  float bare = 1.0 - clamp(cover / max(twigs + 0.001, 0.001), 0.0, 1.0);
  cover = max(cover, twigs);

  // Yaw, then lean about the edge of the root plate.
  vec3 anchor = project_position(tree.anchor, tree.anchorLow);
  float metre = project_size(1.0);
  mat3 yawTurn = mat3(tree.yaw.x, tree.yaw.y, 0.0, -tree.yaw.y, tree.yaw.x, 0.0, 0.0, 0.0, 1.0);
  mat3 leanTurn = mat3(1.0);
  vec3 shift = vec3(0.0);
  if (tree.lean > 0.0) {
    vec3 axis = vec3(-tree.leanDirection.y, tree.leanDirection.x, 0.0);
    float c = tree.leanCos;
    float s = tree.leanSin;
    leanTurn = mat3(c) + s * mat3(0.0, axis.z, -axis.y, -axis.z, 0.0, axis.x, axis.y, -axis.x, 0.0) +
      (1.0 - c) * outerProduct(axis, axis);
    vec3 pivot = vec3(tree.leanDirection * tree.plateRadius, 0.0);
    shift = pivot - leanTurn * pivot;
  }
  mat3 turn = leanTurn * yawTurn;
  treeWindLoad();

  // Crown light, as treeCrownLight works it out, with what depends only on the tree done here.
  float g = tree.growth;
  float thick = smoothstep(0.08, 0.5, g) * tree.foliage * tree.coverage * (1.0 - 0.75 * tree.damage) *
    (1.0 - smoothstep(0.0, 0.5, tree.decay));
  float crownNow = g >= 1.0 ? 1.0 : 1.0 - pow(1.0 - g, 1.9);
  vec3 radii = max(vec3(tree.size.xy * crownNow * 1.14, tree.liveHeight * 0.62), vec3(0.01));
  float size = (radii.x + radii.y + radii.z) / 3.0;
  float density = 2.7 * thick / size;
  float sunDensity = density * mix(1.3, 0.8, 0.82);
  vec3 toLight = shellCrownAxes(shell.light.xyz) / radii;
  vec3 up = shellCrownAxes(vec3(0.0, 0.0, 1.0)) / radii;

  // Pixels on screen of a metre at the tree, across the line of sight: two points a metre apart, projected.
  vec3 toCamera = project.cameraPosition - anchor;
  vec3 across = cross(toCamera, vec3(0.0, 0.0, 1.0));
  across = dot(across, across) > 1e-24 ? normalize(across) : vec3(1.0, 0.0, 0.0);
  vec4 clip0 = project_common_position_to_clipspace(vec4(anchor, 1.0));
  vec4 clip1 = project_common_position_to_clipspace(vec4(anchor + across * metre, 1.0));
  float pixels = length((clip1.xy / clip1.w - clip0.xy / clip0.w) * project.viewportSize * 0.5) /
    max(project.devicePixelRatio, 1e-6);

  vec4 canopy = treeStateTexel(row, ${CANOPY});
  float brown = clamp((1.0 - tree.health - 0.08) / 0.86, 0.0, 1.0);
  float rotted = smoothstep(0.02, 0.4, tree.decay);
  float flatten = tree.decay > 0.0 ? smoothstep(0.06, 0.8, tree.decay) : 0.0;

  float kept = cover * fade;
  tA = vec4(anchor, kept > 0.002 ? kept : 0.0);
  tB = vec4(turn[0], tree.size.x);
  tC = vec4(turn[1], tree.size.y);
  tD = vec4(turn[2], tree.size.z);
  tE = vec4(shift, metre);
  tF = vec4(tree.windBend, tree.liveHeight, tree.groundLayer);
  tG = vec4(tree.leanDirection, tree.plateRadius, flatten);
  tH = vec4(float(stage0), blend, float(templateIndex), tree.damage);
  tI = vec4(toLight, sunDensity);
  tJ = vec4(up, density);
  tK = vec4(tree.size.xyz / radii, tree.liveHeight * 0.44 / radii.z);
  tL = vec4(size * 0.13, thick, 0.5 * (stage.z + stage.w), max(tree.trunkRadius * 0.45, 0.03));
  vec3 barkAlbedo = pow(treeStateTexel(row, ${TREE_STATE_TEXEL.TRUNK}).rgb, vec3(2.2)) * 0.45;
  tM = vec4(mix(shellLeafAlbedo(canopy), barkAlbedo, bare), brown * (1.0 - bare));
  tN = vec4(pixels, treeFogVisibility(anchor), 1.0 - 0.8 * max(brown, rotted), float(row));
  tO = vec4(halfWidth, halfHeight, tree.trunkRadius * treeRingRadius(1.0, 0.0, tree.growth) * 0.8, fade);
}
`;
  const fs = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;
void main(void) {
  fragColor = vec4(0.0);
}
`;
  return {vs, fs};
}

const TREE_ATTRIBUTES = SHELL_TREE_OUTPUTS.map(name => `in vec4 ${name};`).join('\n');

const HULL_VERTEX_HELPERS = /* glsl */ `
const vec4 SHELL_CULLED = vec4(2.0, 2.0, 2.0, 1.0);

// The tree's bend in the wind, as treeWindPoint does it in a breeze: an arc of its height, nothing stretching.
vec3 shellBend(vec3 point, vec2 bend, float liveHeight) {
  float bendLength = length(bend);
  if (bendLength <= 1e-5) return point;
  vec2 direction = bend / bendLength;
  float tilt = 2.0 * bendLength * clamp(point.z / liveHeight, 0.0, 1.5);
  float c = cos(tilt);
  float s = sin(tilt);
  float arcAlong = tilt < 0.02 ? tilt * 0.5 : (1.0 - c) / tilt;
  float arcUp = tilt < 0.02 ? 1.0 - tilt * tilt / 6.0 : s / tilt;
  float out_ = dot(point.xy, direction);
  point.xy += direction * (out_ * (c - 1.0) + point.z * arcAlong);
  point.z = point.z * arcUp - out_ * s;
  return point;
}

// What the ground does to a crown that has come down, as treeCrushPoint, and then rot, as treeRotPoint.
vec3 shellGround(vec3 point) {
  float layer = tF.w;
  if (layer > 0.0) {
    vec2 leanDirection = tG.xy;
    float plateRadius = tG.z;
    vec2 fromRoot = point.xy - leanDirection * plateRadius;
    float along = dot(fromRoot, leanDirection);
    float crown = smoothstep(0.0, 2.0 * plateRadius, along);
    if (crown > 0.0) {
      if (point.z >= layer) {
        point.z -= (point.z - layer) * 2.0 * layer / max(tF.z, 1e-3) * crown;
      } else {
        float spread = (layer * exp((point.z - layer) / layer) - point.z) * crown;
        vec2 aside = fromRoot - leanDirection * along;
        point.xy += (aside * 0.55 / (length(aside) + layer) + leanDirection * 0.15) * spread;
        point.z += spread;
      }
    }
  }
  float flatten = tG.w;
  float debris = tL.w;
  if (flatten > 0.0 && point.z > debris) point.z = debris + (point.z - debris) * (1.0 - flatten) * (1.0 - flatten);
  return point;
}

// Metres of crown along a ray, in space where the crown is the unit ball, as treeCrownPath.
float shellCrownPath(vec3 q, vec3 direction) {
  float a = dot(direction, direction);
  float b = dot(q, direction);
  float c = dot(q, q) - 1.0;
  float discriminant = b * b - a * c;
  if (discriminant <= 0.0) return 0.0;
  float root = sqrt(discriminant);
  return max(-b + root, 0.0) / a - max(-b - root, 0.0) / a;
}

// Sun and sky through the crown at a template point, as treeCrownLight gives them, for a depth in it.
vec2 shellCrownLight(vec3 templatePoint, float known) {
  float thick = tL.y;
  if (thick <= 0.0) return vec2(1.0);
  vec3 q = tK.xyz * templatePoint - vec3(0.0, 0.0, tK.w);
  float rim = tL.x;
  float sun = exp(-tI.w * mix(1.3, 0.8, known) / mix(1.3, 0.8, 0.82) * max(shellCrownPath(q, tI.xyz) - rim, 0.0));
  float above = max(shellCrownPath(q, tJ.xyz) - rim, 0.0);
  float within = max(1.0 - length(q) - 0.13, 0.0);
  float sky = 0.55 * exp(-tJ.w * 0.8 * above) + 0.45 * exp(-2.7 * thick * 1.2 * within);
  return vec2(sun, sky * mix(1.0, mix(0.4, 1.0, smoothstep(0.1, 0.75, known)), thick));
}
`;

/**
 * Light on a far crown or its stub, in linear light: the photoreal leaf's terms averaged over many leaves of every
 * turn about the crown's normal. `crown` is what treeCrownLight gives, gap how far into a gap between clumps.
 */
const SHELL_SHADING = /* glsl */ `
vec3 shellShade(vec3 normal, vec3 view, vec4 crown, vec3 albedo, float wax, float gap, float pixels, bool wood) {
  vec3 up = vec3(0.0, 0.0, 1.0);
  // Leaves face up and out: a crown's outline is lit more like its top than a ball's would be.
  if (!wood) normal = normalize(normal + up * shell.outer.w);
  float frost = treeFrostCover(normal, up, crown.y, 0.5);
  albedo = treeFrostAlbedo(treeWetAlbedo(albedo, wood ? 1.0 : 0.3), frost);
  wax *= (1.0 + 0.8 * treePhotoreal.weather.x) * (1.0 - frost);
  vec3 diffuse = vec3(0.0);
  vec3 specular = vec3(0.0);
  vec3 glow = vec3(0.0);
  float wrap = wood ? 0.0 : 0.35;
  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    vec3 toLight = normalize(-light.direction);
    vec3 color = treeLightColor(light.color);
    float visibility = i == 0 ? crown.x : 1.0;
    float facing = dot(normal, toLight);
    diffuse += color * max((facing + wrap) / (1.0 + wrap), 0.0) * visibility;
    if (!wood) {
      vec3 halfway = normalize(toLight + view);
      float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(view, halfway), 0.0), 5.0);
      specular += color * pow(max(dot(normal, halfway), 0.0), 12.0) * fresnel * visibility;
      float toward = pow(max(dot(-view, toLight), 0.0), 3.0);
      glow += color * max(-facing, 0.0) * (0.55 + 1.15 * toward) * visibility;
    }
  }
  vec3 sky = treeHemisphere(normal, up) * crown.y + treeCrownBounce(crown);
  if (wood) return albedo * (sky * 0.92 + diffuse) + treeWetFilm(normal, view, up, crown.y) * 0.15;
  float cosine = max(dot(normal, view), 0.0);
  float fresnel = 0.012 + 0.4 * pow(1.0 - cosine, 4.0);
  vec3 sheen = treeSkyColor(reflect(-view, normal), up) * fresnel * crown.y * wax * 0.5;
  vec3 glowColor = pow(max(albedo, vec3(0.002)), vec3(0.75)) * vec3(0.95, 1.2, 0.34);
  vec3 skyThrough = treeHemisphere(-normal, up) * crown.y * 0.3;
  vec3 color = albedo * (sky * 0.9 + diffuse) + glowColor * (glow * shell.tint.w + skyThrough * 0.9) +
    specular * shell.look.z * wax + sheen;
  // Between clumps one sees leaves deeper in, which the crown shades.
  color *= 1.0 - shell.look.y * max(gap, 0.0);
  return color * shell.tint.rgb * shell.look.w;
}
`;

const SHELL_NOISE = /* glsl */ `
// Value noise remapped to about even odds, so that a threshold keeps about that share.
float shellEven(float n) {
  return smoothstep(0.18, 0.82, n);
}

// A stable pattern in the tree's own metres, in blobs about 3 pixels across at any distance: the two octaves
// about that size, blended by where between them it is.
float shellDissolveNoise(vec3 p, float pixels) {
  float level = log2(max(pixels, 1e-3) / 3.0);
  float base = floor(level);
  float f = exp2(base);
  float a = treeNoise(p * f + 13.1);
  float b = treeNoise(p * f * 2.0 + 41.7);
  return shellEven(mix(a, b, level - base));
}

// Leaves about shell.leaf.w pixels long at any distance, as photoreal's far leaves are: the two octaves of value noise
// about that size, blended by where between them it is. Returns the noise and its octave's cells per metre.
float shellLeafNoise(vec3 p, float pixels, out float cells) {
  float level = log2(max(pixels, 1e-3) / shell.leaf.w);
  float base = floor(level);
  cells = exp2(base);
  float a = treeNoise(p * cells + 5.3);
  float b = treeNoise(p * cells * 2.0 + 17.9);
  return mix(a, b, smoothstep(0.0, 1.0, level - base));
}

// How far into a gap between clumps, -1 to 1, once clumps are a few pixels across.
float shellClumps(vec3 p, float pixels) {
  float seen = smoothstep(2.5, 6.0, pixels / 1.4);
  if (seen <= 0.0) return 0.0;
  return (0.5 - treeNoise(p * 1.4)) * 2.0 * seen;
}
`;

/**
 * The hull and its stub of trunk. `dissolve` compiles the variant that may discard. `perPixel` lights by the pixel,
 * with leaf mottle in the normal, for trees large on screen; otherwise light is worked out per vertex, as photoreal
 * does for far leaves, since a small tree's triangles are a few pixels and MSAA shades each edge pixel once per
 * triangle that touches it.
 */
export function getShellHullShaders(
  dissolve: boolean,
  perPixel: boolean,
  debug = 0,
  leaves = false
): {vs: string; fs: string} {
  const vs = /* glsl */ `#version 300 es
#define SHADER_NAME shell-hull-vs
precision highp float;
precision highp int;
precision highp sampler2D;
${perPixel ? '#define SHELL_PER_PIXEL' : ''}

${TREE_ATTRIBUTES}

out vec3 vLocal;
#ifdef SHELL_PER_PIXEL
out vec3 vNormal;
out vec3 vView;
out vec2 vLight;
// Leaf albedo and brown share.
flat out vec4 vMaterial;
#else
// Light, in linear light.
out vec3 vColor;
#endif
// Pixels per metre, share kept, crown fullness, wax; wax below 0 marks wood.
flat out vec4 vTree;
// Picking color, and 1 if this tree is highlighted.
flat out vec4 vPick;

${HULL_TEXELS}
${HULL_VERTEX_HELPERS}
#ifndef SHELL_PER_PIXEL
${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${SHELL_SHADING}
#endif

void main(void) {
  gl_Position = SHELL_CULLED;
  int vertex = gl_VertexID;
  int hullVertices = int(shell.hull.x);
  bool stub = vertex >= hullVertices;
  float share = stub ? tO.w : tA.w;
  if (share <= 0.0) return;
  bool shadowPass = false;
#ifdef MODULE_SHADOW
  shadowPass = shadow.drawShadowMap;
#endif
  // Light does not need a stub.
  if (shadowPass && stub) return;
  float pass = shell.timing.y;
  bool leafy = pass > 1.5;
  if (leafy ? stub : (share >= 0.995) == (pass > 0.5)) return;
  // A fine tree's hull is a darker core, and its leaves are an outer hull drawn as leaves.
  float core = shell.hull.y > 1.5 && !shadowPass ? (leafy ? shell.outer.x : shell.leaf.x) : 1.0;

  mat3 turn = mat3(tB.xyz, tC.xyz, tD.xyz);
  vec3 scale = vec3(tB.w, tC.w, tD.w);
  vec3 templatePoint;
  vec3 local;
  vec3 normal;
  if (!stub) {
    int stage0 = int(tH.x + 0.5);
    int stage1 = min(stage0 + 1, SHELL_STAGE_COUNT - 1);
    int templateIndex = int(tH.z + 0.5);
    vec4 p0 = shellHullTexel(templateIndex, stage0, 2 + vertex * 2);
    vec4 p1 = shellHullTexel(templateIndex, stage1, 2 + vertex * 2);
    vec4 n0 = shellHullTexel(templateIndex, stage0, 3 + vertex * 2);
    vec4 n1 = shellHullTexel(templateIndex, stage1, 3 + vertex * 2);
    templatePoint = mix(p0.xyz, p1.xyz, tH.y);
    // Damage takes limbs off a direction about when its leaves' limbs break.
    float lost = smoothstep(p0.w - 0.06, p0.w + 0.06, tH.w);
    vec3 middle = vec3(0.0, 0.0, tL.z);
    templatePoint = middle + (templatePoint - middle) * core;
    // What breaks off falls, and lies spread on the ground around the tree.
    templatePoint.xy *= 1.0 + 0.3 * lost;
    templatePoint.z = mix(templatePoint.z, 0.03 + 0.12 * templatePoint.z, 0.85 * lost);
    local = turn * (templatePoint * scale) + tE.xyz;
    normal = normalize(turn * (mix(n0.xyz, n1.xyz, tH.y) / scale));
  } else {
    // Six sides from the ground into the crown.
    int k = vertex - hullVertices;
    float angle = float(k / 2) * 1.0471976;
    bool topRing = (k & 1) == 0;
    vec3 out_ = vec3(cos(angle), sin(angle), 0.0);
    float topZ = tL.z - 0.4 * tO.y / max(scale.z, 1e-3);
    templatePoint = vec3(0.0, 0.0, topRing ? topZ : 0.0);
    local = turn * (out_ * tO.z + templatePoint * scale) + tE.xyz;
    normal = turn * out_;
  }
  local = shellBend(local, tF.xy, tF.z);
  local = shellGround(local);
  local.z = max(local.z, 0.005);
  vec3 commonPosition = tA.xyz + local * tE.w;
  gl_Position = project_common_position_to_clipspace(vec4(commonPosition, 1.0));
  geometry.position = vec4(commonPosition, 1.0);
  geometry.normal = normal;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  // Picking and highlight by hand: deck.gl's color filter can discard, and a shader that can discard turns off
  // hidden-surface removal for the whole draw.
  float row = tN.w;
  vec3 pickColor = picking_normalizeColor(picking_getPickingColorFromIndex(row));
  vPick = vec4(pickColor, picking.isActive > 0.5 || isVertexHighlighted(pickColor) ? 1.0 : 0.0);
  vLocal = templatePoint * scale + vec3(fract(row * 0.6180339) * 97.0, fract(row * 0.3771) * 61.0, 0.0);
  vTree = vec4(tN.x, share, tL.y, stub ? -1.0 : (core < 1.0 && !leafy ? 2.0 + tN.z : tN.z));
  if (shadowPass || picking.isActive > 0.5) return;
  vec2 light = shellCrownLight(templatePoint, stub ? 0.2 : 0.82);
#ifdef SHELL_PER_PIXEL
  vNormal = normal;
  vView = project.cameraPosition - commonPosition;
  vLight = light;
  vMaterial = tM;
#else
  vec3 view = normalize(project.cameraPosition - commonPosition);
  vec3 albedo = stub ? vec3(0.07, 0.055, 0.04) : mix(tM.rgb, vec3(0.1, 0.07, 0.038), tM.a);
  vColor = shellShade(normal, view, vec4(light, 1.0, tL.y), albedo, tN.z, 0.0, tN.x, stub);
#endif
}
`;

  const fs = /* glsl */ `#version 300 es
#define SHADER_NAME shell-hull-fs
precision highp float;
precision highp int;
${dissolve ? '#define SHELL_DISSOLVE' : ''}
${perPixel ? '#define SHELL_PER_PIXEL' : ''}
${leaves ? '#define SHELL_LEAVES' : ''}
${debug & 64 ? '#define SHELL_FLAT' : ''}

in vec3 vLocal;
#ifdef SHELL_PER_PIXEL
in vec3 vNormal;
in vec3 vView;
in vec2 vLight;
flat in vec4 vMaterial;
#else
in vec3 vColor;
#endif
flat in vec4 vTree;
flat in vec4 vPick;

out vec4 fragColor;

${TREE_PHOTOREAL_FRAGMENT_CHUNK}
${SHELL_NOISE}
#ifdef SHELL_PER_PIXEL
${SHELL_SHADING}

// Leaf mottle: clumps, sprays and leaves, each fading in once it is a few pixels across, as a height in metres.
float shellMottle(vec3 p, float pixels, out float clumps) {
  float h = 0.0;
  float total = 0.0;
  clumps = 0.5;
  float frequency = 1.4;
  float amplitude = 1.0;
  for (int i = 0; i < 3; i++) {
    float cycle = pixels / frequency;
    float seen = smoothstep(2.5, 6.0, cycle);
    if (seen > 0.0) {
      float n = treeNoise(p * frequency + float(i) * 17.3);
      h += (n - 0.5) * amplitude * seen;
      if (i == 0) clumps = mix(0.5, n, seen);
    }
    total += amplitude;
    frequency *= 2.7;
    amplitude *= 0.45;
  }
  return h / total;
}

vec3 shellBump(vec3 normal, vec3 position, float height, float strength) {
  vec3 dpdx = dFdx(position);
  vec3 dpdy = dFdy(position);
  float dhdx = dFdx(height);
  float dhdy = dFdy(height);
  vec3 r1 = cross(dpdy, normal);
  vec3 r2 = cross(normal, dpdx);
  float det = dot(dpdx, r1);
  if (abs(det) < 1e-20) return normal;
  vec3 gradient = (dhdx * r1 + dhdy * r2) / det;
  return normalize(normal - strength * gradient);
}
#endif

void main(void) {
  if (picking.isActive > 0.5) {
    fragColor = vec4(vPick.rgb, 1.0);
    return;
  }
  float pixels = vTree.x;
#ifdef SHELL_DISSOLVE
  if (shellDissolveNoise(vLocal, pixels > 0.0 ? pixels : 24.0) > vTree.y) discard;
#endif
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    fragColor = shadow_filterShadowColor(vec4(0.0));
    return;
  }
#endif
  bool wood = vTree.w < 0.0;
#ifdef SHELL_PER_PIXEL
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(vView);
  vec3 albedo = vMaterial.rgb;
  float gap = 0.0;
  bool isCore = vTree.w >= 2.0;
  float wax = isCore ? vTree.w - 2.0 : vTree.w;
#ifdef SHELL_LEAVES
  // The outer hull: leaves where the noise says, fewer toward the outline, so that it is ragged against the sky.
  float cells = 1.0;
  float leaf = shellLeafNoise(vLocal, pixels, cells);
  float rim = 1.0 - abs(dot(normal, view));
  float keep = shell.leaf.z * (1.0 - shell.outer.z * rim * rim) * vTree.y;
  if (leaf > keep) discard;
  // Each leaf turns its own way: the noise's slope across it, in the normal.
  float metreLeaf = length(dFdx(vView)) / max(length(dFdx(vLocal)), 1e-12);
  normal = shellBump(normal, -vView, leaf * metreLeaf / cells * 0.9, 1.0);
  albedo *= mix(vec3(0.86, 0.9, 1.0), vec3(1.12, 1.08, 0.94), treeNoise(vLocal * cells * 0.5 + 9.1));
#endif
  if (wood) {
    albedo = vec3(0.07, 0.055, 0.04);
  } else if (isCore) {
    // Seen only between the outer leaves: deeper in the crown, in its shade.
    albedo *= shell.leaf.y;
  } else {
    // Mottle: clumps that catch the light and gaps that show the darker leaves behind them. Heights are in tree
    // metres; the view vector's derivatives are in common units, so scale by common units per tree metre.
    float clumps = 0.5;
    float height = shellMottle(vLocal, pixels, clumps);
    float metre = length(dFdx(vView)) / max(length(dFdx(vLocal)), 1e-12);
    normal = shellBump(normal, -vView, height * 0.35 * metre, shell.look.x);
    gap = (0.5 - clumps) * 2.0 * smoothstep(3.0, 8.0, pixels / 1.4);
    // Leaves brown one by one with falling health: here as patches, by the same kind of threshold.
    float browning = vMaterial.a;
    if (browning > 0.0) {
      float n = shellEven(treeNoise(vLocal * 5.3 + 7.7));
      albedo = mix(albedo, vec3(0.1, 0.07, 0.038), smoothstep(n - 0.08, n + 0.08, browning));
    }
    // Newer leaves at the skin are lighter and yellower, old ones deeper bluer: patch by patch.
    albedo *= mix(vec3(0.9, 0.92, 1.0), vec3(1.08, 1.06, 0.97), treeNoise(vLocal * 2.1 + 3.3));
  }
  vec3 color = shellShade(normal, view, vec4(vLight, 1.0, vTree.z), albedo, wax, gap, pixels, wood);
  // A darker core and gaps make a fine tree darker on average than a coarse one: give that back.
  if (!wood) color *= shell.outer.y;
  if (lighting.enabled == 0) color = albedo;
#else
  vec3 color = vColor;
  if (!wood) {
    color *= 1.0 - shell.look.y * max(shellClumps(vLocal, pixels), 0.0);
    // Far leaves are a few pixels long at any distance, and each catches the light its own way.
    float cells = 1.0;
    float leaf = shellLeafNoise(vLocal, pixels, cells);
    color *= mix(1.0, mix(0.7, 1.32, smoothstep(0.25, 0.85, leaf)), shell.tint.w > 0.0 ? 1.0 : 0.0);
  }
#endif
#ifdef SHELL_FLAT
  color = vec3(0.05, 0.1, 0.02);
#endif
  fragColor = vec4(treeFilmic(color), 1.0);
  if (vPick.a > 0.5) fragColor.rgb = mix(fragColor.rgb, picking.highlightColor.rgb, picking.highlightColor.a);
}
`;
  return {vs, fs};
}

/**
 * A soft patch of shadow on the ground under and behind each far tree, where the sun puts its crown's shadow:
 * what a shadow map cannot give a tree a few pixels wide, or gives with shimmer. Multiplied into what is there.
 */
export function getShellGroundShaders(): {vs: string; fs: string} {
  const vs = /* glsl */ `#version 300 es
#define SHADER_NAME shell-ground-vs
precision highp float;
precision highp int;

${TREE_ATTRIBUTES}

// Metres from the trunk, along the shadow and across it.
out vec2 vPatch;
// Where the crown's shadow is centred along it, its half length and half width, and the radius under the crown.
flat out vec4 vShape;
// How dark the cast shadow is at its middle, and under the crown.
flat out vec2 vDark;

void main(void) {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (shell.sun.w <= 0.0) return;
  float cover = tA.w;
  if (cover <= 0.01) return;
  // The crown's middle, standing or as it leans, and what rot leaves of its height.
  mat3 turn = mat3(tB.xyz, tC.xyz, tD.xyz);
  vec3 middle = turn * vec3(0.0, 0.0, tL.z * tD.w) + tE.xyz;
  float flatten = tG.w;
  middle.z *= (1.0 - flatten) * (1.0 - flatten);
  float halfWidth = tO.x;
  float halfHeight = tO.y * mix(1.0, 0.25, flatten);

  vec2 toShadow = shell.sun.xy;
  float elevationSine = max(shell.sun.z, 0.08);
  float cotangent = sqrt(1.0 - elevationSine * elevationSine) / elevationSine;
  // The crown's shadow is its ellipse moved away from the sun by its height, stretched by how low the sun is.
  vec2 shift = toShadow * max(middle.z, 0.0) * cotangent;
  float along = halfWidth + halfHeight * cotangent * 0.8;
  float across = halfWidth;
  float under = halfWidth * 0.9;
  float reach = length(shift);
  vec2 axis = reach > 1e-3 ? shift / reach : toShadow;
  vec2 sideAxis = vec2(-axis.y, axis.x);
  // A quad from behind the trunk to past the far end of the shadow, a little larger for its soft edge.
  float grow = 1.0 + shell.cells.w;
  float from = -max(under, along - reach) * grow;
  float to = (reach + along) * grow;
  float wide = max(across, under) * grow;
  int corner = gl_VertexID;
  vec2 uv = vec2(corner == 1 || corner == 3 ? to : from, corner >= 2 ? wide : -wide);
  vec2 offset = middle.xy + axis * uv.x + sideAxis * uv.y;
  vec3 commonPosition = tA.xyz + vec3(offset, 0.03) * tE.w;
  gl_Position = project_common_position_to_clipspace(vec4(commonPosition, 1.0));
  vPatch = uv;
  vShape = vec4(reach, along, across, under);
  // Light through a thin crown comes through its shadow too.
  vDark = vec2(cover * shell.cells.z, cover * shell.cells.z * 0.45);
}
`;
  const fs = /* glsl */ `#version 300 es
#define SHADER_NAME shell-ground-fs
precision highp float;

in vec2 vPatch;
flat in vec4 vShape;
flat in vec2 vDark;
out vec4 fragColor;

void main(void) {
  float soft = shell.cells.w;
  vec2 castAt = (vPatch - vec2(vShape.x, 0.0)) / vShape.yz;
  float shadow = 1.0 - smoothstep(1.0 - soft, 1.0 + soft, length(castAt));
  float hidden = 1.0 - smoothstep(0.4, 1.0 + soft, length(vPatch) / vShape.w);
  float dark = max(vDark.x * shadow, vDark.y * hidden);
  // Multiplied into the ground: white leaves it as it is.
  fragColor = vec4(vec3(1.0 - dark), 1.0);
}
`;
  return {vs, fs};
}
