// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * Blades of grass, pulled from their index alone: there are no buffers, and a blade is a function of the
 * world's cell it stands in, so it stays put and stays itself however the camera moves. Square levels of
 * cells, each twice the size of the last and twice as far out, follow the camera's view, so blades
 * thin with distance and get coarser, till the ground's own grass color takes over. Where it grows comes
 * from the same plan as the ground's, and it stands on the same land: none on a furrow's floor, and
 * under the flood only the tips of the tallest show, as the water hides the rest by depth. A gust front
 * lays it over pale side up; when the water leaves, it lies combed flat along the last flow, grey with
 * silt, and stands again.
 */

import {COORDINATE_SYSTEM, project32, type Viewport} from '@deck.gl/core';
import {_treeWindGust} from '@deck.gl-community/layers';
import {Model} from '@luma.gl/engine';
import {lighting} from '@luma.gl/shadertools';
import {Matrix4} from '@math.gl/core';
import {getBearingVector} from '../story/story-math';
import type {StoryState} from '../story/story-types';
import {
  FIELD_FLOOD_GLSL,
  FIELD_LIGHT_GLSL,
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
  getFieldPlan
} from './field-shading';

/**
 * The levels: cells of the finest in metres, cells to a side of each, how many are drawn at once, the
 * finest and coarsest there are, and a blade's width by level.
 */
const GRASS_LEVELS = {
  finest: 0.016,
  side: 150,
  drawn: 6,
  most: 8,
  width: 0.0034,
  widthGrowth: 1.36
};
/** How much of a level's half width lies ahead of the eye: most of it, as that is where the frame is. */
const AHEAD_SHARE = 0.72;
/**
 * Grass the flood has left: story seconds it lies combed flat, and over which it stands again, the way
 * the last flow ran (toward the east lateral ditch), and the silt it is grey with.
 */
const COMBED = {flat: 1, standing: 1.5, flow: [1, 0] as const, silt: [0.2, 0.19, 0.16] as const};

const FIELD_GRASS_DECLARATION = /* glsl */ `layout(std140) uniform fieldGrassUniforms {
  vec4 level;
  vec4 center;
  vec4 inner;
  vec4 wind;
  vec4 surface;
  vec4 eye;
  vec4 clip;
} fieldGrass;`;

const fieldGrass = {
  name: 'fieldGrass',
  vs: FIELD_GRASS_DECLARATION,
  fs: FIELD_GRASS_DECLARATION,
  uniformTypes: {
    level: 'vec4<f32>',
    center: 'vec4<f32>',
    inner: 'vec4<f32>',
    wind: 'vec4<f32>',
    surface: 'vec4<f32>',
    eye: 'vec4<f32>',
    clip: 'vec4<f32>'
  }
} as const;

const GRASS_VERTEX = /* glsl */ `#version 300 es
#define SHADER_NAME field-grass-vs
precision highp float;

out vec3 vColor;
out vec2 vBlade;
out float vSeen;

${FIELD_LIGHT_GLSL}
${FIELD_PLAN_GLSL}
${FIELD_FLOOD_GLSL}
${FIELD_SHADOW_VERTEX_GLSL}

// How flat the flood has left grass at this height, 0-1: flat under the water and just after it goes,
// then standing again.
float fieldCombed(float landZ) {
  float level = fieldFlood.water.x;
  float mark = fieldFlood.water.y;
  if (mark <= level + 0.001 || landZ >= mark) return 0.0;
  if (landZ < level) return 1.0;
  float since = fieldFlood.more.z - fieldUncovered(landZ).x;
  return 1.0 - smoothstep(${COMBED.flat.toFixed(2)}, ${COMBED.standing.toFixed(2)}, since);
}

void main() {
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vColor = vec3(0.0);
  vBlade = vec2(0.0);
  vSeen = 1.0;

  float cellSize = fieldGrass.level.x;
  int side = int(fieldGrass.level.y);
  float levelIndex = fieldGrass.center.z;
  float segments = fieldGrass.center.w;
  vec2 cell = fieldGrass.center.xy + vec2(float(gl_InstanceID % side), float(gl_InstanceID / side)) - 0.5 * float(side);
  vec2 salt = vec2(levelIndex * 17.0, levelIndex * 31.0);
  vec2 base = (cell + fieldHash2(cell + salt)) * cellSize;

  // This level's square, and a hole for what the next finer level has. Blades shrink away at both edges.
  vec2 fromCenter = abs(base - fieldGrass.center.xy * cellSize);
  float halfWidth = fieldGrass.level.z;
  float shown = 1.0 - smoothstep(0.8 * halfWidth, 0.98 * halfWidth, max(fromCenter.x, fromCenter.y));
  if (fieldGrass.inner.z > 0.0) {
    vec2 fromInner = abs(base - fieldGrass.inner.xy);
    float innerHalf = fieldGrass.inner.z;
    shown *= smoothstep(0.8 * innerHalf, 0.98 * innerHalf, max(fromInner.x, fromInner.y));
  }
  if (shown <= 0.01) return;

  // Off the frame.
  vec3 ground = vec3(base, 0.0);
  vec4 clipBase = project_common_position_to_clipspace(vec4(project_position(ground), 1.0));
  if (clipBase.w <= 0.0 || abs(clipBase.x) > clipBase.w * 1.25 || clipBase.y > clipBase.w * 1.25 || clipBase.y < -clipBase.w * 1.5) return;

  // Is there grass here? It grows in tufts, thick in them, however thin the cover.
  float cover = fieldGrassCover(base, 0.0);
  if (cover <= 0.004) return;
  float tuftSize = 0.14 + 0.035 * levelIndex * levelIndex;
  // The ground's own tufts, laid along a bank's surface as the ground lays them.
  float tuft = fieldTuftsFixed(fieldFurrowPlace(base), tuftSize);
  float clump = smoothstep(1.0 - cover - 0.1, 1.0 - cover + 0.08, tuft);
  float thereHash = fieldHash(cell + salt + 5.0);
  if (thereHash > clump * 0.97) return;

  // Which blade of this cell's few, and which corner of it.
  int perBlade = int(segments) * 6 - 3;
  int bladeIndex = gl_VertexID / perBlade;
  int corner = gl_VertexID % perBlade;
  int quad = corner / 6;
  int inQuad = corner % 6;
  int row = quad;
  float sideSign = -1.0;
  if (quad >= int(segments) - 1) {
    // The tip, one triangle.
    row = int(segments) - 1 + (inQuad == 2 ? 1 : 0);
    sideSign = inQuad == 1 ? 1.0 : -1.0;
  } else {
    row = quad + ((inQuad == 2 || inQuad == 3 || inQuad == 5) ? 1 : 0);
    sideSign = (inQuad == 1 || inQuad == 4 || inQuad == 5) ? 1.0 : -1.0;
  }
  float bladeSalt = float(bladeIndex) * 7.13;
  vec2 bladeCell = cell + salt + bladeSalt;
  float hashA = fieldHash(bladeCell + 9.0);
  float hashB = fieldHash(bladeCell + 13.0);
  float hashC = fieldHash(bladeCell + 21.0);

  float rows = fieldRowsHere(length(base));
  // Mowed in the grove, wild and uneven before it.
  float wildHeight = mix(0.05, 0.15, hashA * hashA) * (0.65 + 0.7 * clump);
  float mowedHeight = mix(0.05, 0.095, hashA) * (0.85 + 0.3 * clump);
  float height = mix(wildHeight, mowedHeight, rows);
  // A few seed stalks stand above the rest, near enough to see.
  float isStalk = step(0.97, hashC) * step(levelIndex, 2.5);
  height *= mix(1.0, 2.6, isStalk);
  height *= smoothstep(0.0, 0.5, shown);
  float width = fieldGrass.level.w * (0.7 + 0.6 * hashB) * mix(1.0, 0.4, isStalk);

  // A cell's blades come up together, and a wild field's from bunches, and splay out from them.
  vec2 spread = (fieldHash2(bladeCell + 3.0) - 0.5) * cellSize * 0.62;
  float bunchSize = 0.075 + 0.05 * levelIndex;
  vec2 bunchCell = floor(base / bunchSize);
  vec2 bunch = (bunchCell + fieldHash2(bunchCell + 3.0)) * bunchSize;
  vec2 outOfBunch = base + spread - bunch;
  base = mix(base + spread, bunch + outOfBunch * 0.3, (1.0 - rows) * step(levelIndex, 3.5));

  // How it stands, and what the wind does.
  float yaw = hashB * 6.2831853;
  vec2 toward = normalize(mix(vec2(cos(yaw), sin(yaw)), normalize(outOfBunch + 1e-4), (1.0 - rows) * 0.7));
  float time = fieldGrass.wind.w;
  vec2 windDirection = fieldGrass.wind.yz;
  float strength = fieldGrass.wind.x;
  float gust = 0.5 + 0.5 * sin(dot(base, windDirection) * 0.31 - time * (2.4 + 3.0 * strength) + 2.0 * fieldNoise(base * 0.13));
  // The trees' own gust fronts, which lay it over pale side up as they pass.
  float front = strength > 0.12 ? treeWind_getGust(base, fieldGrass.clip.z, windDirection, strength, 0.0) : 0.0;
  float flutter = sin(time * (5.0 + 5.0 * hashA + 14.0 * strength) + hashC * 40.0);
  float push = min(strength * 2.1 * (0.55 + 0.45 * gust) + front * strength * 1.4, 1.1) + 0.02 * gust;
  vec2 lean = toward * mix(0.42, 0.2, rows) * (0.3 + hashC) + windDirection * (push + flutter * (0.03 + 0.2 * strength));
  // Where the flood has just left, combed flat the way the last of it ran.
  float landZ = fieldLandHeight(base);
  float combed = fieldCombed(landZ);
  lean = mix(lean, vec2(${COMBED.flow[0].toFixed(1)}, ${COMBED.flow[1].toFixed(1)}) * (1.02 + 0.12 * hashA), combed);

  // Along the blade.
  float t = min(float(row) / segments, 1.0);
  float leanSize = min(dot(lean, lean), 1.2);
  float rise = 1.0 - 0.72 * leanSize;
  vec2 bent = lean * height * t * t;
  vec3 place = vec3(base + bent, landZ + height * max(rise, 0.1) * t * (1.0 - 0.12 * t));

  // A blade turns its flat toward the eye a little, the coarser the more, so it never goes to nothing.
  vec3 toEye = fieldGrass.eye.xyz - place;
  float eyeDistance = length(toEye);
  vec3 view = toEye / max(eyeDistance, 1e-4);
  vec3 across = normalize(vec3(-toward.y, toward.x, 0.0));
  vec3 facing = normalize(vec3(view.y, -view.x, 0.0) + vec3(1e-4, 0.0, 0.0));
  across = normalize(mix(across, facing * sign(dot(across, facing) + 1e-4), mix(0.45, 1.0, smoothstep(1.0, 4.0, levelIndex))));
  float taper = t >= 1.0 ? 0.0 : pow(1.0 - t, 0.6) * (0.65 + 0.35 * min(t * 6.0, 1.0));
  // No thinner than most of a pixel: this far off, a sliver would only flicker.
  float pixelMetres = eyeDistance * fieldGrass.clip.x;
  float widthHere = max(width, pixelMetres * 0.7) * taper;
  place += across * widthHere * 0.5 * sideSign;

  vec3 commonPosition = project_position(place);
  vec4 clip = project_common_position_to_clipspace(vec4(commonPosition, 1.0));
  // Past the far plane, it sorts among itself and stays ahead of the ground.
  float farLimit = 0.9998 * clip.w;
  if (clip.z > farLimit) {
    float past = clamp(clip.w / max(fieldGrass.clip.y, 1e-3), 1.0, 4000.0);
    clip.z = clip.w * (0.9998 + 0.00016 * (1.0 - 1.0 / past));
  }
  gl_Position = clip;

  // Its color, the same as the ground's lawn in the mean.
  float dryness = smoothstep(0.35, 0.8, fieldNoise(base * 0.21 + 4.0) * 0.7 + fieldNoise(base * 1.3 + 9.0) * 0.3);
  float dead = step(0.86, hashA * 0.5 + hashC * 0.5);
  vec3 lush = vec3(0.06, 0.084, 0.034) * mix(0.75, 1.3, hashC);
  vec3 straw = vec3(0.14, 0.122, 0.068) * mix(0.8, 1.25, hashA);
  vec3 albedo = mix(lush, straw, clamp(dryness + dead * 0.8, 0.0, 1.0));
  albedo = mix(albedo, albedo * vec3(1.35, 1.25, 0.85) + vec3(0.012, 0.012, 0.0), t * t * 0.7);
  if (isStalk > 0.5) albedo = mix(vec3(0.15, 0.13, 0.07), vec3(0.05, 0.035, 0.03), step(0.86, t));
  // A blade laid over shows its paler underside, and one the flood has combed is grey with silt.
  albedo = mix(albedo, albedo * 1.7 + vec3(0.02, 0.026, 0.016), front * smoothstep(0.15, 0.45, strength));
  albedo = mix(albedo, vec3(${COMBED.silt.map(value => value.toFixed(3)).join(', ')}) * mix(0.8, 1.2, hashB), combed * 0.8);

  // Light. A blade's normal is mostly its flat, which leans over its bend, and a crowd of them is lit like
  // the ground they hide.
  vec3 tangent = normalize(vec3(lean * 2.0 * t * height + vec2(1e-4), height * max(rise, 0.1)));
  vec3 normal = normalize(cross(across, tangent));
  normal = sign(normal.z + 1e-3) * normal;
  normal = normalize(mix(normal, vec3(0.0, 0.0, 1.0), 0.55));
  vec3 keyColor = vec3(0.0);
  vec3 keyDirection = vec3(0.0, 0.0, 1.0);
  if (lighting.directionalLightCount > 0) {
    DirectionalLight key = lighting_getDirectionalLight(0);
    keyColor = fieldLightColor(key.color);
    keyDirection = normalize(-key.direction);
  }
  float lit = 1.0;
#ifdef MODULE_SHADOW
  if (fieldGrass.eye.w > 0.0) {
    lit = mix(1.0, fieldShadowAtVertex(vec4(commonPosition, 1.0), hashC * 31.0, levelIndex < 2.5 ? 4 : 1), fieldGrass.eye.w);
  }
#endif
  // Blades shade each other down toward the ground.
  float crowded = mix(0.32, 1.0, pow(t, 0.8));
  float nl = max(dot(normal, keyDirection), 0.0);
  vec3 color = albedo * keyColor * nl * lit * crowded;
  // The sun through a blade, seen against it.
  float against = pow(max(dot(-view, keyDirection), 0.0), 2.5);
  color += albedo * vec3(1.3, 1.45, 0.5) * keyColor * against * lit * (0.25 + 0.75 * t) * 0.6;
  vec3 ambient = fieldLightColor(lighting.ambientColor);
  float up = 0.5 + 0.5 * normal.z;
  color += albedo * ambient * mix(vec3(0.44, 0.38, 0.28), vec3(0.94, 1.0, 1.1), up * up) * crowded * mix(1.0, 0.56, fieldAir.moon.w);

  if (lighting.directionalLightCount > 1) {
    DirectionalLight flash = lighting_getDirectionalLight(1);
    color += albedo * fieldLightColor(flash.color) * max(dot(normal, normalize(-flash.direction)), 0.0) * crowded;
  }

  float wetness = fieldGrass.surface.x;
  if (wetness > 0.0) {
    color *= 1.0 - 0.32 * wetness;
    vec3 halfway = normalize(keyDirection + view);
    color += keyColor * pow(max(dot(normal, halfway), 0.0), 60.0) * 0.5 * wetness * lit;
    color += ambient * 0.08 * wetness * t;
  }
  float frost = fieldGrass.surface.y;
  if (frost > 0.0) {
    float rime = smoothstep(0.0, 0.6, frost * 1.4 - (1.0 - t) * 0.7 - hashA * 0.35);
    color = mix(color, vec3(0.62, 0.68, 0.76) * (keyColor * nl * lit + ambient), rime * 0.8);
  }
  float ringStrength = fieldGrass.surface.w;
  if (ringStrength > 0.0) {
    float fromHero = length(base);
    float ringWidth = 0.9 + 0.1 * fieldGrass.surface.z;
    float along = (fromHero - fieldGrass.surface.z) / ringWidth;
    color += albedo * vec3(3.4, 2.7, 1.5) * exp(-along * along) * ringStrength * (0.4 + 0.6 * t);
  }

  vColor = color;
  vBlade = vec2(sideSign, t);
  vSeen = exp(-max(fieldAir.fog.w, 0.00012) * eyeDistance);
}
`;

const GRASS_FRAGMENT = /* glsl */ `#version 300 es
#define SHADER_NAME field-grass-fs
precision highp float;

in vec3 vColor;
in vec2 vBlade;
in float vSeen;

out vec4 fragColor;

${FIELD_LIGHT_GLSL}

void main() {
  // A paler midrib, and a shade to one side of it, for a blade close enough to have sides.
  float rib = 1.0 - smoothstep(0.0, 0.22, abs(vBlade.x));
  vec3 color = vColor * (1.0 + 0.1 * rib - 0.06 * vBlade.x);
  color = mix(fieldAir.fog.rgb, color, vSeen);
  fragColor = vec4(fieldDither(fieldFilmic(color), gl_FragCoord.xy), 1.0);
}
`;

/** A level's blades: how many corners along one, and how many blades in a cell. */
function getLevelBlades(level: number): {segments: number; blades: number} {
  if (level <= 1) return {segments: 3, blades: 1};
  if (level <= 3) return {segments: 2, blades: level};
  if (level <= 5) return {segments: 1, blades: 6};
  return {segments: 1, blades: 10};
}

/** Half the width of a level's square, in metres. */
function getLevelHalfWidth(level: number): number {
  return (GRASS_LEVELS.finest * Math.pow(2, level) * GRASS_LEVELS.side) / 2;
}

/** Where the camera looks: its eye, the unit forward along the ground, and the nearest ground in frame. */
function getViewOnGround(viewport: Viewport): {
  eye: number[];
  forward: [number, number];
  nearest: number;
} {
  const inverse = new Matrix4(viewport.viewProjectionMatrix as number[]).invert();
  const eye = viewport.cameraPosition as number[];
  const middle = inverse.transform([0, 0, 1]) as number[];
  const bottom = inverse.transform([0, -1, 1]) as number[];
  const flatX = middle[0] - eye[0];
  const flatY = middle[1] - eye[1];
  const across = Math.hypot(flatX, flatY) || 1;
  const down = eye[2] - bottom[2];
  const bottomAcross = Math.hypot(bottom[0] - eye[0], bottom[1] - eye[1]);
  // Where the bottom of the frame meets the ground, along it, or the eye's own height if it does not.
  const nearest =
    down > 1e-6 ? Math.max(eye[2], 0.001) * (bottomAcross / down) : Math.max(eye[2], 0.001) * 8;
  return {eye, forward: [flatX / across, flatY / across], nearest};
}

/** The levels a view draws, and how far they go. Exported for the ground, whose lawn takes over from them. */
export function getGrassWindow(viewport: Viewport): {first: number; count: number; reach: number} {
  const {nearest} = getViewOnGround(viewport);
  let first = 0;
  while (first < GRASS_LEVELS.most - GRASS_LEVELS.drawn && getLevelHalfWidth(first) < nearest * 0.7)
    first++;
  const count = GRASS_LEVELS.drawn;
  // The ground under the blades is thatch out to where they are still thick.
  return {first, count, reach: getLevelHalfWidth(first + 2)};
}

type GrassLayerProps = {
  plan: FieldPlan;
  flood: FieldFlood;
  /** Strength, then the unit direction, then the wind's clock. */
  wind: [number, number, number, number];
  /** The trees' gust clock, `TreeLayer.windGustTime`. */
  gustTime: number;
  /** Wetness, frost, the ring's radius and strength. */
  surface: [number, number, number, number];
};

class FieldGrassLayer extends FieldLayer<GrassLayerProps> {
  static layerName = 'FieldGrassLayer';

  getShaders() {
    return super.getShaders({
      vs: GRASS_VERTEX,
      fs: GRASS_FRAGMENT,
      modules: [project32, lighting, _treeWindGust, fieldAir, fieldPlan, fieldFlood, fieldGrass]
    });
  }

  protected createModel(): Model {
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-list',
      vertexCount: 21,
      instanceCount: GRASS_LEVELS.side * GRASS_LEVELS.side,
      isInstanced: true,
      bufferLayout: []
    });
  }

  draw({renderPass, shaderModuleProps}: Parameters<FieldLayer['draw']>[0]): void {
    const {model} = this.state;
    if (!model || this.isDrawSkipped({shaderModuleProps})) return;
    const {air, plan, flood, wind, gustTime, surface} = this.props;
    const viewport = this.context.viewport as Viewport;
    const {eye, forward} = getViewOnGround(viewport);
    const {first, count} = getGrassWindow(viewport);
    this.setFieldUniforms(model, air);
    const pixelAngle =
      (2 * Math.tan(((viewport as unknown as {fovy: number}).fovy * Math.PI) / 360)) /
      viewport.height;
    const far = this.farPlaneMetres(viewport);
    let inner: [number, number, number, number] = [0, 0, 0, 0];
    model.setInstanceCount(GRASS_LEVELS.side * GRASS_LEVELS.side);
    for (let level = first; level < first + count; level++) {
      const cellSize = GRASS_LEVELS.finest * Math.pow(2, level);
      const halfWidth = getLevelHalfWidth(level);
      const centerX = Math.floor((eye[0] + forward[0] * halfWidth * AHEAD_SHARE) / cellSize);
      const centerY = Math.floor((eye[1] + forward[1] * halfWidth * AHEAD_SHARE) / cellSize);
      const {segments, blades} = getLevelBlades(level);
      model.setVertexCount((segments * 6 - 3) * blades);
      model.shaderInputs.setProps({
        fieldPlan: plan,
        fieldFlood: flood,
        fieldGrass: {
          level: [
            cellSize,
            GRASS_LEVELS.side,
            halfWidth,
            GRASS_LEVELS.width * Math.pow(GRASS_LEVELS.widthGrowth, level)
          ],
          center: [centerX, centerY, level, segments],
          inner,
          wind,
          surface,
          eye: [eye[0], eye[1], eye[2], this.fieldShadowStrength],
          clip: [pixelAngle, far, gustTime, 0]
        }
      } as never);
      model.draw(renderPass);
      inner = [centerX * cellSize, centerY * cellSize, halfWidth, 0];
    }
  }

  private farPlaneMetres(viewport: Viewport): number {
    const projection = viewport.projectionMatrix as number[];
    // w of the far plane in clip space, from z = (a w + b) / w at z = 1. In the view's own units, as clip's w is.
    const a = projection[10];
    const b = projection[14];
    return b / (a + 1);
  }
}

const GRASS_PARAMETERS = {
  depthWriteEnabled: true,
  depthCompare: 'less-equal',
  cullMode: 'none',
  blend: false
} as const;

/** Blades of mowed grass and wild field around the view. */
export function createGrassLayer(state: StoryState): FieldGrassLayer {
  const {ground, wind} = state;
  const [x, y] = getBearingVector(wind.bearing);
  return new FieldGrassLayer({
    id: 'grass',
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    coordinateOrigin: [0, 0, 0],
    air: getFieldAir(state) as FieldAir,
    plan: getFieldPlan(state),
    flood: getFieldFlood(state),
    wind: [wind.strength, x, y, wind.time],
    gustTime: wind.gustTime,
    surface: [ground.wetness, ground.frost, ground.magicRing.radius, ground.magicRing.strength],
    parameters: GRASS_PARAMETERS,
    shadowEnabled: false,
    pickable: false
  } as never);
}
