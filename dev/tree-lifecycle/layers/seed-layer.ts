// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The seed: pale, teardrop-shaped, a little translucent, with a fine ridge, tumbling along its flight with a
 * bead of juice clinging to it, and behind it the faintest thread of gold, one of the film's two magic moments.
 */

import type {Layer} from '@deck.gl/core';
import {getSeedPosition, SEED_TABLE} from '../story/props';
import {hash01, hashRange, rotateVector, smoothstep} from '../story/story-math';
import type {StoryState, Vec3} from '../story/story-types';
import {getBeadMesh, getHalfDrop} from './orange-layer';
import {
  BEAD_PROGRAM,
  createGridMesh,
  getPropLayerProps,
  PROP_FRAGMENT_CHUNK,
  PROP_FRAGMENT_PASSES,
  PROP_VERTEX_CHUNK,
  PropMeshLayer,
  type PropMesh,
  type PropProgram
} from './prop-shading';

/** All in seed lengths, along the seed's long axis, from its blunt end (z = -0.5) to its point (z = 0.5). */
const SHAPE = {
  width: 0.3,
  /** Flatter across its ridge than along it. */
  flatten: 0.8,
  /** The point bends a little to one side. */
  beak: 0.05,
  ridge: 0.012,
  ridgeWidth: 0.2
};

/** The bead that clings to the seed, in seed lengths. */
const BEAD = {offset: [0.2, 0.05, -0.27] as Vec3, radius: 0.2, tint: [1, 0.78, 0.45, 0.45]};

/** It lies half sunk in its socket until it works loose. */
const EMERGE = {seconds: [7, 7.8] as const, depth: 0.0032};
/** How deep it goes as the soil closes over it, over these seconds. */
const BURY = {seconds: [11.2, 12.6] as const, depth: 0.0095};

/** How wide the gold thread is, in metres, and its motes. */
const TRAIL = {
  width: 0.0013,
  color: [1, 0.76, 0.42],
  strength: 0.62,
  motes: {
    every: 0.05,
    life: 0.95,
    drift: 0.012,
    fall: 0.008,
    size: [0.00018, 0.00042],
    brightness: 0.85
  }
};

function createSeedMesh(): PropMesh {
  const {width, flatten, beak, ridge, ridgeWidth} = SHAPE;
  return createGridMesh({
    columns: 72,
    rows: 56,
    wrap: true,
    getPoint: (u, v) => {
      const theta = u * Math.PI * 2;
      const shape = Math.sin(Math.PI * v ** 0.72) ** 0.82;
      const off = Math.atan2(Math.sin(theta), Math.cos(theta));
      const radius = width * shape * (1 + ridge * 8 * Math.exp(-((off / ridgeWidth) ** 2)) * shape);
      const z = v - 0.5;
      return [radius * Math.cos(theta) + beak * v ** 3, radius * Math.sin(theta) * flatten, z];
    },
    getDetails: (u, v) => [u, v, 0, 0]
  });
}

const SEED_PROGRAM: PropProgram = {
  name: 'seedBody',
  fields: ['center', 'turn', 'look'],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME seed-body-vs
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
  vec3 offset = propTurn(seedBody.turn, positions) * seedBody.center.w;
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(seedBody.center.xyz, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = propTurn(seedBody.turn, normals);
  vLocal = positions;
  vSurface = details.xy;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME seed-body-fs
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
  float wet = seedBody.look.x;
  float theta = vSurface.x * PROP_PI * 2.0;
  float along = vSurface.y;
  // Fine wrinkles run along its length, and fade at either end.
  vec3 q = vec3(cos(theta) * 12.0, sin(theta) * 12.0, along * 2.6);
  float wrinkle = propNoise(q);
  float grain = propNoise(vec3(q.xy * 5.0, along * 40.0));
  float delta = 0.12;
  vec3 tangent = vec3(-sin(theta), cos(theta), 0.0);
  float slope = (propNoise(vec3(cos(theta + delta) * 12.0, sin(theta + delta) * 12.0, along * 2.6)) - wrinkle) / delta;
  vec3 tilt = propTurn(seedBody.turn, tangent) * slope * 0.09 * smoothstep(0.0, 0.2, along) * smoothstep(1.0, 0.8, along);
  vec3 shaded = normalize(normal - (tilt - normal * dot(tilt, normal)));

  // Pale cream, greyer by a touch along its ridge, tanned at the blunt end where it was held.
  vec3 albedo = mix(vec3(0.76, 0.64, 0.41), vec3(0.85, 0.74, 0.52), wrinkle * 0.45 + grain * 0.55);
  float ridge = exp(-pow(atan(sin(theta), cos(theta)) / 0.1, 2.0));
  albedo = mix(albedo, vec3(0.62, 0.46, 0.25), ridge * 0.45);
  albedo = mix(albedo, vec3(0.42, 0.25, 0.1), smoothstep(0.14, 0.02, along) * 0.8);
  albedo = mix(albedo, vec3(0.8, 0.68, 0.4), smoothstep(0.86, 1.0, along) * 0.5);

  vec3 toKey = normalize(-lighting_getDirectionalLight(0).direction);
  float keyFacing = dot(normal, toKey);
  propShadowNormal = keyFacing > 0.02 ? normal : vec3(0.0);
  propShadowSoft = 0.0006;
  float size = seedBody.center.w * 0.6;
  float bias = 0.0003 + size * max(-keyFacing, 0.0);
  // A seed is thin enough for light to come through, warmly.
  propLights(shaded, view, vec3(0.7, 0.52, 0.3), mix(40.0, 180.0, wet), 0.25 + 1.3 * wet, 0.6, 0.45, bias);
  vec3 sky = propHemisphere(shaded) * mix(0.75, 1.0, smoothstep(-0.6, 0.6, shaded.z));
  float facing = max(dot(shaded, view), 0.0);
  vec3 mirrored = propSkyColor(reflect(-view, shaded)) * (0.03 + 0.5 * pow(1.0 - facing, 4.0)) * (0.25 + 0.75 * wet);
  vec3 color = albedo * (sky + gDiffuse) + gGlow * albedo * vec3(1.0, 0.8, 0.5) + gSpecular + mirrored;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), 1.0);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * The thread of gold: soft quads along the path, and a few motes. Instanced: from, to, their alphas, width.
 * It adds light, as a thing lit from within does.
 */
const TRAIL_PROGRAM: PropProgram = {
  name: 'seedTrail',
  ignoresShadow: true,
  fields: ['color'],
  vertexCount: 6,
  instanceAttributes: [
    ['instanceFrom', 3],
    ['instanceTo', 3],
    ['instanceAlphas', 2],
    ['instanceWidth', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME seed-trail-vs
precision highp float;
in vec3 instanceFrom;
in vec3 instanceTo;
in vec2 instanceAlphas;
in float instanceWidth;
out vec2 vAcross;
out float vAlpha;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  int corner = gl_VertexID;
  vec2 q = corner == 0 ? vec2(0.0, -1.0) : corner == 1 ? vec2(1.0, -1.0) : corner == 2 ? vec2(1.0, 1.0)
    : corner == 3 ? vec2(0.0, -1.0) : corner == 4 ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
  vec3 anchor = mix(instanceFrom, instanceTo, q.x);
  vec3 commonAnchor = project_position(anchor);
  vec3 along = instanceTo - instanceFrom;
  vec3 toCamera = normalize(project.cameraPosition - commonAnchor);
  float span = length(along);
  vec3 side;
  vec3 extend = vec3(0.0);
  if (span > 1e-6) {
    side = normalize(cross(along / span, toCamera));
  } else {
    // A mote: a round dot.
    side = normalize(cross(vec3(0.0, 0.0, 1.0), toCamera));
    extend = cross(toCamera, side) * (q.x * 2.0 - 1.0) * instanceWidth;
  }
  vec4 commonPosition = vec4(commonAnchor + project_size(side * q.y * instanceWidth + extend), 1.0);
  gl_Position = project_common_position_to_clipspace(commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vAcross = span > 1e-6 ? vec2(0.0, q.y) : vec2(q.x * 2.0 - 1.0, q.y);
  vAlpha = mix(instanceAlphas.x, instanceAlphas.y, q.x);
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME seed-trail-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vAcross;
in float vAlpha;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  float d = length(vAcross);
  float glow = exp(-d * d * 7.0) * 0.5 + exp(-d * d * 40.0) * 0.5;
  fragColor = vec4(seedTrail.color.rgb, vAlpha * glow * smoothstep(1.0, 0.8, d));
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

let seedMesh: PropMesh | null = null;

/** The thread is not even: it breathes along its length, from a moment on the path. */
function getWisp(time: number): number {
  return 0.55 + 0.45 * Math.sin(time * 23) * Math.sin(time * 37 + 1.3);
}

/** The seed, the bead clinging to it, and its thread of gold. */
export function createSeedLayer(state: StoryState): Layer | Layer[] | null {
  const {seed, orange} = state.props;
  const {t} = state;
  if (!seed.visible && seed.trail.length === 0) return null;
  const base = getPropLayerProps(state.fog);
  const layers: Layer[] = [];
  if (seed.visible) {
    // On the fruit it rides the half, which has settled a little below where the story has it.
    const drop =
      getHalfDrop(orange.halves[0].rotation, 0, orange.radius) *
      (1 - smoothstep(SEED_TABLE.lift, SEED_TABLE.lift + 0.5, t));
    const emerge = EMERGE.depth * (1 - smoothstep(EMERGE.seconds[0], EMERGE.seconds[1], t));
    const bury = BURY.depth * smoothstep(BURY.seconds[0], BURY.seconds[1], t);
    const center: Vec3 = [seed.position[0], seed.position[1], seed.position[2] - drop - bury];
    if (emerge > 0) {
      const normal = rotateVector(orange.halves[0].rotation, [0, 0, 1]);
      center[0] -= normal[0] * emerge;
      center[1] -= normal[1] * emerge;
      center[2] -= normal[2] * emerge;
    }
    seedMesh ??= createSeedMesh();
    const wet = Math.max(seed.bead, 1 - smoothstep(SEED_TABLE.lift, SEED_TABLE.land, t));
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'seed-body',
        mesh: seedMesh,
        program: SEED_PROGRAM,
        values: {
          center: [center[0], center[1], center[2], seed.length],
          turn: seed.rotation,
          look: [wet, 0, 0, 0]
        }
      }) as Layer
    );
    if (seed.bead > 0) {
      const offset = rotateVector(seed.rotation, BEAD.offset);
      const radius = BEAD.radius * seed.length * Math.cbrt(seed.bead);
      layers.push(
        new PropMeshLayer({
          ...base,
          id: 'seed-bead',
          mesh: getBeadMesh(),
          program: BEAD_PROGRAM,
          values: {tint: BEAD.tint},
          instances: new Float32Array([
            center[0] + offset[0] * seed.length,
            center[1] + offset[1] * seed.length,
            center[2] + offset[2] * seed.length,
            radius,
            0,
            0,
            1,
            1,
            1
          ]),
          instanceCount: 1,
          shadowEnabled: false
        }) as Layer
      );
    }
  }
  if (seed.trail.length > 1) {
    const {trail} = seed;
    const values: number[] = [];
    const strength = (trail[trail.length - 1].alpha || 0) / SEED_TABLE.trail.strength;
    for (let index = 1; index < trail.length; index++) {
      const from = trail[index - 1];
      const to = trail[index];
      values.push(
        from.position[0],
        from.position[1],
        from.position[2],
        to.position[0],
        to.position[1],
        to.position[2],
        from.alpha *
          TRAIL.strength *
          getWisp(state.t - (trail.length - index) * SEED_TABLE.trail.stepSeconds),
        to.alpha *
          TRAIL.strength *
          getWisp(state.t - (trail.length - 1 - index) * SEED_TABLE.trail.stepSeconds),
        TRAIL.width
      );
    }
    // Motes shed along the way, each from a moment on the path, drifting and falling a little.
    const {every, life, drift, fall, size, brightness} = TRAIL.motes;
    const flightEnd = Math.min(t, SEED_TABLE.land);
    for (let step = Math.ceil(SEED_TABLE.lift / every); step * every < flightEnd; step++) {
      const born = step * every;
      const age = t - born;
      if (age > 0 && age < life) {
        const position = getSeedPosition(born);
        const alpha =
          brightness * strength * (1 - age / life) ** 1.5 * hashRange(step, 61, 0.35, 1);
        const twinkle = 0.65 + 0.35 * Math.sin(age * 9 + 6.28 * hash01(step, 62));
        const x = position[0] + hashRange(step, 63, -1, 1) * drift * age;
        const y = position[1] + hashRange(step, 64, -1, 1) * drift * age;
        const z = position[2] + hashRange(step, 65, -1, 1) * drift * age * 0.6 - fall * age * age;
        values.push(
          x,
          y,
          z,
          x,
          y,
          z,
          alpha * twinkle,
          alpha * twinkle,
          hashRange(step, 66, size[0], size[1])
        );
      }
    }
    layers.push(
      new PropMeshLayer({
        ...base,
        id: 'seed-trail',
        program: TRAIL_PROGRAM,
        values: {color: [...TRAIL.color, 1]},
        instances: new Float32Array(values),
        instanceCount: values.length / 9,
        shadowEnabled: false,
        parameters: {
          depthWriteEnabled: false,
          blend: true,
          blendColorOperation: 'add',
          blendAlphaOperation: 'add',
          blendColorSrcFactor: 'src-alpha',
          blendColorDstFactor: 'one',
          blendAlphaSrcFactor: 'zero',
          blendAlphaDstFactor: 'one'
        }
      }) as Layer
    );
  }
  return layers;
}
