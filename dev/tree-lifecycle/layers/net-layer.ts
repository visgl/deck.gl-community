// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The protective bag on a young tree: fine white mesh over a wire hoop, against the insect that spreads citrus
 * greening. It comes down from above, billows, drapes, is cinched at the base, strains as the tree fills it, is
 * slit up the side and carried off on the wind. A surface around the tree's axis whose every vertex is worked
 * out in the vertex stage from the story's numbers, so one mesh serves the hero's net and all the replants'.
 * Drawn after the trees, depth test on and depth write off, far side first.
 */

import type {Layer} from '@deck.gl/core';
import {RADIANS_PER_DEGREE} from '../story/story-math';
import type {StoryState} from '../story/story-types';
import {
  createGridMesh,
  getPropLayerProps,
  mergeMeshes,
  PROP_FRAGMENT_CHUNK,
  PROP_VERTEX_CHUNK,
  PropMeshLayer,
  type PropMesh,
  type PropProgram
} from './prop-shading';

/** The bag's shape, and how the mesh is cut up. Lengths are shares of its radius or height. */
const NET = {
  columns: 144,
  rows: 76,
  /** Where along the cloth the hoop is, and at what height, and how wide. */
  hoopAlong: 0.8,
  hoopHeight: 0.84,
  hoopRadius: 0.93,
  /** Metres: the wire's thickness, what's left at the tie, how far above the tree it starts. */
  wire: 0.0032,
  tie: 0.055,
  startHeight: 2.6,
  /** Knit, in metres between threads. */
  pitch: 0.0034,
  /** The share of a square of it that thread covers, seen straight on. */
  coverage: 0.36,
  /** How much of light it stops in the shadow pass: one in so many texels cast. */
  castShare: 0.2,
  /** How much closer than its fit it comes as it strains, so that the crown really touches it. */
  snug: 0.2,
  /** How far it flies, in metres on top of its own size, and how high. */
  flight: {along: 7.5, up: 5.5}
};

function createNetMesh(): PropMesh {
  const cloth = createGridMesh({
    columns: NET.columns,
    rows: NET.rows,
    getPoint: (u, v) => [u, v, 0],
    getDetails: (u, v) => [u, v, 0, 0]
  });
  const hoop = createGridMesh({
    columns: 96,
    rows: 6,
    getPoint: (u, v) => [u, v, 0],
    getDetails: (u, v) => [u, v, 1, 0]
  });
  return mergeMeshes([cloth, hoop]);
}

/** Where a point of the bag is: u around from the slit, v from the base to the crown, tree-local metres. */
const NET_SHAPE_GLSL = /* glsl */ `
struct Net {
  vec3 base;
  float radius;
  float height;
  float descent;
  float billow;
  float cinch;
  float strain;
  float slit;
  float lift;
  float bearing;
  float id;
};
Net net;

float netSmooth(float a, float b, float x) {
  float u = clamp((x - a) / (b - a), 0.0, 1.0);
  return u * u * (3.0 - 2.0 * u);
}

// Where a point of the cloth lies, in metres, around the tree's base.
vec3 netPoint(float u, float v) {
  const float PI_ = 3.14159265;
  float time = netLook.clock.x;
  float id = net.id * 0.77 + 0.31;
  float slitAt = netSmooth(0.0, 0.5, net.slit * 1.5 - v);
  // A slit is a tie cut too: the base lets go as it opens.
  float cinch = net.cinch * (1.0 - netSmooth(0.15, 0.7, net.slit));
  // The cloth gives way from the slit, and more as the wind gets in.
  float flies = net.lift;
  float gap = slitAt * (0.035 + 0.46 * netSmooth(0.0, 0.8, flies));
  // Bearing is compass, from north clockwise; x is east.
  float downwind = (90.0 - net.bearing) * ${RADIANS_PER_DEGREE};
  float theta = downwind + (u - 0.5) * 2.0 * PI_ * (1.0 - gap);

  float hoopV = ${NET.hoopAlong};
  float z;
  float shape;
  float low = v / hoopV;
  float hemFlare = 0.86 + 0.14 * (1.0 - net.descent);
  float tie = ${NET.tie} / max(net.radius, 0.05);
  if (v < hoopV) {
    z = low * ${NET.hoopHeight};
    float hem = mix(hemFlare, tie, cinch);
    shape = mix(hem, ${NET.hoopRadius}, netSmooth(0.0, mix(0.8, 0.42, cinch), low));
    shape += sin(low * PI_) * 0.03;
  } else {
    float a = (v - hoopV) / (1.0 - hoopV);
    z = ${NET.hoopHeight} + (1.0 - ${NET.hoopHeight}) * sin(a * PI_ * 0.5);
    shape = ${NET.hoopRadius} * cos(a * PI_ * 0.5);
  }
  // Tight on the crown it holds: a smooth dome, and a low cone down to the tie.
  float top = 0.3;
  float above = max((z - top) / (1.0 - top), 0.0);
  float dome = sqrt(max(1.0 - above * above, 0.0));
  float taut = z > top ? dome : mix(tie * 1.2, 1.0, netSmooth(0.0, top, z));
  shape = mix(shape, taut, net.strain);

  float loose = 1.0 - net.strain;
  float r = shape * net.radius;
  // Soft folds down its length, that wander and are never the same twice.
  float wander = sin(theta * 2.0 + id) * 0.9 + sin(v * 4.3 + id * 2.0) + 0.6 * sin(v * 9.0 + theta * 3.0 + id);
  float folds =
    sin(theta * 5.0 + wander * 1.4 + id) * 0.5 +
    sin(theta * 9.0 + wander * 2.2 + 3.0 * v + id * 3.0) * 0.32 +
    sin(theta * 16.0 + wander * 3.1 - 4.0 * v + id * 5.0) * 0.18 +
    sin(theta * 27.0 + wander * 4.0 + 6.0 * v + id * 7.0) * 0.08;
  float hang = netSmooth(1.0, 0.45, v);
  // None at the hoop, which holds it out in a true circle.
  float offHoop = netSmooth(0.0, 0.14, abs(v - hoopV));
  r += net.radius * folds * 0.1 * loose * mix(0.3, 1.0, hang) * offHoop * (v < hoopV ? 1.0 : 0.35);
  // Pleats where it is gathered.
  float pleats = sin(theta * 23.0 + 2.0 * sin(theta * 3.0 + id)) * 0.7 + sin(theta * 37.0 + id) * 0.3;
  r += net.radius * pleats * 0.03 * cinch * (1.0 - netSmooth(0.0, 0.42, v)) * netSmooth(0.0, 0.06, v) * loose;
  // What presses out against it when it is taut: shoots, in small bumps.
  float press = sin(theta * 9.0 + 4.0 * z + id) * sin(z * 19.0 + theta * 3.0) + 0.5 * sin(theta * 17.0 - z * 23.0);
  r += net.radius * press * 0.02 * net.strain * netSmooth(0.1, 0.4, z);

  // Billow: soft, slow, low in frequency, in metres.
  float breathe = 0.55 + 0.45 * sin(theta * 3.0 + time * 1.5 + v * 4.0 + id);
  r += net.billow * breathe * sin(pow(max(v, 0.0), 0.8) * PI_) * offHoop;

  // On the way down it trails: its hem late and flared, fluttering.
  float above0 = (1.0 - net.descent) * (${NET.startHeight} + net.height);
  float fall = above0 * (1.0 + 0.18 * (1.0 - v));
  float flutter = (1.0 - net.descent) * (1.0 - v) * net.radius * 0.1;
  r += flutter * sin(theta * 5.0 + time * 5.0 + v * 7.0 + id) * offHoop;
  float height = z * net.height + fall;
  height += net.billow * 0.25 * sin(theta * 2.0 - time * 2.1 + v * 5.0 + id) * offHoop;

  vec3 point = vec3(cos(theta) * r, sin(theta) * r, height);

  // A breath of the wind, at the top more than the bottom.
  point.xy += netLook.wind.xy * (0.02 + 0.12 * loose) * net.height * z * z;

  // The wind takes it: from the top first, the bottom lagging, as cloth does.
  if (flies > 0.0) {
    float e = netSmooth(0.0, 1.0, flies * 1.65 - (1.0 - v) * 0.65);
    vec2 away = vec2(cos(downwind), sin(downwind));
    float distance_ = e * e * (${NET.flight.along} + net.radius * 2.0);
    // It leaves the axis of the tree as a sail would.
    point.xy *= 1.0 - 0.45 * e;
    point.xy += away * (distance_ + e * net.radius * 1.25);
    point.z += e * e * (${NET.flight.up} + net.height * 0.5) + e * net.height * 0.2;
    // Ripples run along the cloth.
    float wave = sin(v * 8.0 - time * 7.0 + u * 7.0 + id) * 0.6 + sin(u * 13.0 + time * 5.0 + v * 3.0) * 0.4;
    point.z += wave * e * net.radius * 0.22;
    point.xy += vec2(-away.y, away.x) * wave * e * net.radius * 0.28;
  }
  return point;
}
`;

const NET_PROGRAM: PropProgram = {
  name: 'netLook',
  fields: ['clock', 'wind'],
  instanceAttributes: [
    ['instanceA', 4],
    ['instanceB', 4],
    ['instanceC', 4],
    ['instanceD', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME net-vs
precision highp float;
in vec4 details;
in vec4 instanceA;
in vec4 instanceB;
in vec4 instanceC;
in float instanceD;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out vec3 vAcross;
out vec2 vKnit;
out vec2 vPart;
${PROP_VERTEX_CHUNK}
${NET_SHAPE_GLSL}
void main(void) {
  geometry.uv = details.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  net = Net(
    instanceA.xyz, instanceA.w,
    instanceB.x, instanceB.y, instanceB.z, instanceB.w,
    instanceC.x, instanceC.y, instanceC.z, instanceC.w,
    instanceD
  );
  // Pulled in close to the crown when it strains, rather than standing off it.
  net.radius *= 1.0 - ${NET.snug} * net.strain;
  net.height *= 1.0 - ${NET.snug} * 0.7 * net.strain;
  float u = details.x;
  float v = details.y;
  bool isHoop = details.z > 0.5;
  vec3 point;
  vec3 normal;
  vec3 across;
  if (isHoop) {
    // The wire: a thin ring at the hoop.
    float wrap = v * 6.2831853;
    point = netPoint(u, ${NET.hoopAlong});
    vec3 ahead = netPoint(fract(u + 0.004), ${NET.hoopAlong});
    vec3 outward = normalize(vec3(point.xy, 0.0));
    normal = outward * cos(wrap) + vec3(0.0, 0.0, sin(wrap));
    point += normal * ${NET.wire};
    across = normalize(ahead - point);
  } else {
    const float du = 0.0032;
    const float dv = 0.006;
    point = netPoint(u, v);
    vec3 alongU = netPoint(u + du, v) - netPoint(u - du, v);
    vec3 alongV = netPoint(u, min(v + dv, 1.0)) - netPoint(u, max(v - dv, 0.0));
    normal = cross(alongU, alongV);
    float lengthN = length(normal);
    normal = lengthN > 1e-9 ? normal / lengthN : vec3(0.0, 0.0, 1.0);
    across = alongU;
  }
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(net.base, vec3(0.0), project_size(point), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vNormal = normal;
  vAcross = normalize(across);
  // Knit runs in metres of cloth, so that a thread keeps its size as the bag fills.
  vKnit = vec2(u * 6.2831853 * net.radius, v * net.height * 1.25);
  float fade = 1.0 - netSmooth(0.72, 1.0, net.lift);
  // By the time the crown strains it, the hoop has been taken out.
  float hoopFade = 1.0 - netSmooth(0.0, 0.6, net.strain);
  vPart = vec2(isHoop ? 1.0 : 0.0, isHoop ? hoopFade : fade);
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME net-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in vec3 vAcross;
in vec2 vKnit;
in vec2 vPart;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}

void main(void) {
  if (vPart.y <= 0.0) discard;
  // In the shadow pass, a share of it stops light: a veil's worth.
  geometry.uv = vec2(0.0);
  if (picking.isActive > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    DECKGL_FILTER_COLOR(fragColor, geometry);
    return;
  }
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    float screen = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vPart.x < 0.5 && screen > ${NET.castShare}) discard;
    fragColor = shadow_filterShadowColor(vec4(0.0));
    return;
  }
#endif
  vec3 view = normalize(vCamera - vPosition);
  vec3 normal = normalize(vNormal);
  float towardCamera = dot(normal, view);
  if (towardCamera < 0.0) {
    normal = -normal;
    towardCamera = -towardCamera;
  }
  vec3 color;
  float alpha;
  float isHoop = vPart.x;

  // Light on thread: it lets through and scatters as much as it reflects.
  DirectionalLight key = lighting_getDirectionalLight(0);
  vec3 toKey = normalize(-key.direction);
  vec3 keyColor = propLightColor(key.color);
  float visible = propKeyVisibility(0.02);
  float facing = dot(normal, toKey);
  float front = max((facing + 0.5) / 1.5, 0.0);
  float forward = max(dot(-view, toKey), 0.0);
  // The morning coming through: a broad glow around the sun, and brightest where the cloth is seen edge on.
  float through = (0.32 * max(-facing + 0.3, 0.0) + pow(forward, 2.0) * 0.95 + pow(forward, 14.0) * 1.6);

  if (isHoop > 0.5) {
    color = vec3(0.7, 0.71, 0.72) * (propHemisphere(normal) + keyColor * front * visible);
    alpha = vPart.y * 0.92;
  } else {
    // Cloth is never true: fine creases run down it, closer together where it hangs slack, and in a
    // veil they show as a little more or less density, which is most of what says cloth and not glass.
    vec2 crease = vec2(vKnit.x * 15.0, vKnit.y * 2.6);
    float c0 = propNoise(vec3(crease, 1.0));
    float cx = propNoise(vec3(crease + vec2(0.3, 0.0), 1.0)) - c0;
    float fineCrease = propNoise(vec3(crease * vec2(3.7, 2.3), 4.0));
    vec3 creased = normalize(normal + normalize(vAcross) * (cx * 1.8 + (fineCrease - 0.5) * 0.3));
    towardCamera = max(dot(creased, view), 0.0);
    // Knit: two sets of threads, on the diagonal, resolved while a pixel can see them and a soft veil after.
    float pitch = ${NET.pitch};
    vec2 g = vec2(vKnit.x + vKnit.y, vKnit.x - vKnit.y) / pitch;
    vec2 cell = abs(fract(g) - 0.5) * 2.0;
    vec2 pixels = fwidth(g) * 1.2;
    float threadWidth = 1.0 - sqrt(1.0 - ${NET.coverage});
    vec2 lineAmount = smoothstep(vec2(threadWidth * 2.0) + pixels, vec2(threadWidth * 2.0) - pixels, 1.0 - cell);
    float pattern = 1.0 - (1.0 - lineAmount.x) * (1.0 - lineAmount.y);
    float resolved = 1.0 - smoothstep(0.22, 0.6, max(pixels.x, pixels.y));
    float coverage = mix(${NET.coverage} * 1.06, pattern, resolved);
    // It gets denser seen at a slant, as threads close up: this is what shows its folds.
    // From far off, what shows is the veil and not the edge, and a hard rim would read as glass.
    float metres = length(vCamera - vPosition) / max(vPropMetre, 1e-9);
    float far = smoothstep(7.0, 24.0, metres);
    float slant = max(towardCamera, mix(0.16, 0.5, far));
    alpha = 1.0 - pow(1.0 - coverage * mix(1.0, 1.3, far), 0.42 / slant);
    // Thread by thread it is never even: a grain, and the slow beat between two sets of threads.
    vec2 weave = vKnit / 0.0065;
    float grain = propNoise(vec3(weave, 2.0)) * 0.6 + propNoise(vec3(weave * 2.3, 7.0)) * 0.4;
    float beat = sin(vKnit.x * 71.0 + vKnit.y * 37.0) * sin(vKnit.x * 43.0 - vKnit.y * 83.0);
    alpha *= 1.0 + (grain - 0.5) * 0.42 * (1.0 - far) + beat * 0.07 * (1.0 - far);
    alpha = min(alpha, 0.84);

    // Thread highlights: each set of threads a thin cylinder, with a highlight along its own cone.
    vec3 alongA = normalize(vAcross);
    vec3 alongB = normalize(cross(normal, alongA));
    vec3 diagonalA = normalize(alongA + alongB);
    vec3 diagonalB = normalize(alongA - alongB);
    vec3 halfway = normalize(toKey + view);
    float da = dot(diagonalA, halfway);
    float db = dot(diagonalB, halfway);
    float sheen = pow(max(1.0 - da * da, 0.0), 26.0) + pow(max(1.0 - db * db, 0.0), 26.0);

    vec3 sky = propHemisphere(normal) * 0.95;
    vec3 thread = vec3(0.86, 0.87, 0.85);
    color = thread * (sky + keyColor * (front * 0.75 + through) * visible) + keyColor * sheen * 0.03 * visible;
    alpha *= vPart.y;
  }
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), alpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

let netMesh: PropMesh | null = null;

/** The nets of this moment: the hero's and the replants'. Far side first, and depth write off. */
export function createNetLayer(state: StoryState): Layer | Layer[] | null {
  const {nets} = state.props;
  if (nets.length === 0) return null;
  netMesh ??= createNetMesh();
  const values = new Float32Array(nets.length * 13);
  nets.forEach((net, index) => {
    values.set(
      [
        net.position[0],
        net.position[1],
        net.position[2],
        net.radius,
        net.height,
        net.descent,
        net.billow,
        net.cinch,
        net.strain,
        net.slit,
        net.lift,
        net.liftBearing,
        net.id
      ],
      index * 13
    );
  });
  const bearing = state.wind.bearing * RADIANS_PER_DEGREE;
  const look = {
    clock: [state.wind.time, 0, 0, 0],
    wind: [Math.sin(bearing) * state.wind.strength, Math.cos(bearing) * state.wind.strength, 0, 0]
  };
  const base = {
    ...getPropLayerProps(state.fog),
    mesh: netMesh,
    program: NET_PROGRAM,
    values: look,
    instances: values,
    instanceCount: nets.length
  };
  const blend = {
    depthWriteEnabled: false,
    blend: true,
    blendColorOperation: 'add',
    blendAlphaOperation: 'add',
    blendColorSrcFactor: 'src-alpha',
    blendColorDstFactor: 'one-minus-src-alpha',
    blendAlphaSrcFactor: 'one',
    blendAlphaDstFactor: 'one-minus-src-alpha'
  } as const;
  return [
    new PropMeshLayer({
      ...base,
      id: 'net-far',
      shadowEnabled: false,
      parameters: {...blend, cullMode: 'front'}
    }) as Layer,
    new PropMeshLayer({
      ...base,
      id: 'net-near',
      parameters: {...blend, cullMode: 'back'}
    }) as Layer
  ];
}
