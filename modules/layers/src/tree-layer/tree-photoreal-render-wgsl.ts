// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {picking} from '@deck.gl/core';
import {phongMaterial, type ShaderModule} from '@luma.gl/shadertools';
import {WGSL_FILTER_COLOR_ANCHOR} from '../selection-pulse-extension/selection-pulse-shaders';
import {TREE_ROOT_PLATE_RADII} from './tree-growth-model';
import {treePhotorealWgsl} from './tree-photoreal-wgsl';
import {TREE_WIND_STRONG_FROM, TREE_WIND_STRONG_TO} from './tree-wind';

/** Shared color and pose math of the native WebGPU tree parts. */
export const treePhotorealRenderWgsl = {
  name: 'treePhotorealRender',
  dependencies: [treePhotorealWgsl, picking as ShaderModule, phongMaterial],
  source: /* wgsl */ `
const TREE_PI = 3.14159265;
const TREE_TWO_PI = 6.2831853;
const TREE_CULLED = vec4<f32>(2.0, 2.0, 2.0, 1.0);
const TREE_GROUND = 0.005;
const TREE_IDENTITY = mat3x3<f32>(vec3<f32>(1, 0, 0), vec3<f32>(0, 1, 0), vec3<f32>(0, 0, 1));

fn treeRotate(point: vec3<f32>, axis: vec3<f32>, angle: f32) -> vec3<f32> {
  let c = cos(angle);
  return point * c + cross(axis, point) * sin(angle) + axis * dot(axis, point) * (1.0 - c);
}

fn treeRotation(axis: vec3<f32>, angle: f32) -> mat3x3<f32> {
  return mat3x3<f32>(
    treeRotate(TREE_IDENTITY[0], axis, angle),
    treeRotate(TREE_IDENTITY[1], axis, angle),
    treeRotate(TREE_IDENTITY[2], axis, angle)
  );
}

fn treeQuaternionTurn(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

fn treePlateRadius(life: TreeLife) -> f32 {
  return ${TREE_ROOT_PLATE_RADII}.0 * life.trunkRadius * treeRingRadius(1.0, 0.0, life);
}

fn treeLeanMatrix(life: TreeLife) -> mat3x3<f32> {
  return treeRotation(vec3<f32>(-life.leanDirection.y, life.leanDirection.x, 0.0), life.lean);
}

fn treeLeanPoint(point: vec3<f32>, life: TreeLife, lean: mat3x3<f32>) -> vec3<f32> {
  if (life.lean <= 0.0) { return point; }
  let pivot = vec3<f32>(life.leanDirection * treePlateRadius(life), 0.0);
  return pivot + lean * (point - pivot);
}

fn treeEventProgress(passed: f32, rate: f32, seconds: f32) -> f32 {
  return clamp(passed / max(rate * seconds, 1e-4), 0.0, 1.0);
}

fn treeFallCurve(progress: f32) -> f32 {
  if (progress < 0.74) {
    let fall = progress / 0.74;
    return fall * fall;
  }
  let settle = (progress - 0.74) / 0.26;
  return 1.0 - 0.07 * sin(settle * TREE_PI) * (1.0 - settle);
}

struct TreeMovement {
  point: vec3<f32>,
  turn: mat3x3<f32>,
  swing: f32,
  freed: f32,
};

fn treeBreakLimb(
  limbs: texture_2d<f32>,
  limb: u32,
  input: TreeMovement,
  place: TreePlace,
  life: TreeLife,
  lean: mat3x3<f32>
) -> TreeMovement {
  if (limb == 0u) { return input; }
  let head = treeLimbTexel(limbs, limb, 0u);
  let passed = life.damage - head.w;
  if (passed <= 0.0) { return input; }
  let tail = treeLimbTexel(limbs, limb, 1u);
  let hash = fract(f32(limb) * 0.61803399);
  let pivot = treeTurnYaw(treeToMetres(head.xyz, place.size), place.yaw);
  let reachVector = treeTurnYaw(tail.xyz * place.size.xyz, place.yaw);
  let reach = length(reachVector) * tail.w;
  let direction = normalize(reachVector);
  let down = vec3<f32>(life.leanDirection * sin(life.lean), -cos(life.lean));
  let alpha = acos(clamp(dot(direction, down), -1.0, 1.0));
  let axis = cross(direction, down);
  let angleAxis = select(
    vec3<f32>(cos(hash * TREE_TWO_PI), sin(hash * TREE_TWO_PI), 0.0),
    axis / max(length(axis), 1e-8),
    length(axis) > 1e-3
  );
  let height = max(treeLeanPoint(pivot, life, lean).z, 0.0);
  let rest = max(alpha - acos(clamp(height / max(reach, 1e-3), 0.0, 1.0)), 0.0);
  let hinge = treeEventProgress(passed, life.damageRate, 0.9);
  var angle = rest * treeFallCurve(hinge);
  var free = 0.0;
  if (head.w < 0.6) {
    let hang = select(0.0, 0.06 + hash * 0.8, hash < 0.25);
    free = treeEventProgress(passed - hang, life.damageRate, 0.9);
    let lying = alpha - 0.5 * TREE_PI + (hash - 0.5) * 0.35;
    angle = mix(angle, lying, smoothstep(0.0, 1.0, free));
  }
  let rotation = treeRotation(angleAxis, angle);
  var moved = pivot + rotation * (input.point - pivot);
  if (free > 0.0) {
    var outward = direction - down * dot(direction, down);
    if (length(outward) > 1e-3) { outward = normalize(outward); }
    moved += down * max(height - 0.02, 0.0) * treeFallCurve(free) + outward * height * 0.3 * free;
  }
  return TreeMovement(moved, rotation * input.turn, max(input.swing, hinge), free);
}

fn treeWindGust(at: vec2<f32>, time: f32, strong: f32, phase: f32) -> f32 {
  let front = 0.5 + 0.5 * sin(at.x * 0.085 - time * 1.05 + 1.4 * sin(at.y * 0.06 + time * 0.17));
  let chop = 0.5 + 0.5 * sin(at.x * 0.21 - time * 2.3 + phase);
  let pulse = mix(front, front * front * front, strong);
  let flurry = mix(chop, chop * chop * chop, strong);
  return clamp(mix(0.15, 0.2, strong) + mix(0.8, 0.85, strong) * pulse + 0.3 * flurry, 0.0, 1.3);
}

fn treeWindBend(place: TreePlace, life: TreeLife) -> vec2<f32> {
  let force = treePhotoreal.wind.x * life.windFlex;
  let strength = force * max(cos(life.lean), 0.0);
  let bend = 0.3 * (1.0 - exp(-strength / 0.3));
  let time = treePhotoreal.clock.x;
  if (treePhotoreal.wind.w < 0.5) {
    return vec2<f32>(1.0, 0.45) * bend * sin(1.6 * time + place.windPhase);
  }
  let strong = smoothstep(${TREE_WIND_STRONG_FROM}, ${TREE_WIND_STRONG_TO}, force);
  let direction = treePhotoreal.wind.yz;
  let across = vec2<f32>(-direction.y, direction.x);
  let world = ((place.anchor.xy - treePhotoreal.world.xy) + place.anchorLow.xy) * treePhotoreal.world.zw;
  let gust = treeWindGust(vec2<f32>(dot(world, direction), dot(world, across)), time, strong, place.windPhase);
  let rock = 0.3 * strong * gust * sin(time * (3.0 + 0.16 * place.windPhase) + place.windPhase);
  return direction * bend * (mix(0.6 + 0.75 * gust, 0.62 + 0.72 * gust, strong) + rock) +
    across * bend * 0.12 * sin(1.3 * time + place.windPhase);
}

fn treeBendPoint(input: TreeMovement, place: TreePlace, life: TreeLife) -> TreeMovement {
  let bend = treeWindBend(place, life);
  let lengthBend = length(bend);
  if (lengthBend <= 1e-5) { return input; }
  let direction = bend / lengthBend;
  let point = input.point;
  let tilt = 2.0 * lengthBend * clamp(point.z / place.liveHeight, 0.0, 1.5);
  let c = cos(tilt);
  let s = sin(tilt);
  let arcAlong = select((1.0 - c) / max(tilt, 1e-8), tilt * 0.5, tilt < 0.02);
  let arcUp = select(s / max(tilt, 1e-8), 1.0 - tilt * tilt / 6.0, tilt < 0.02);
  let across = dot(point.xy, direction);
  let moved = vec3<f32>(point.xy + direction * (across * (c - 1.0) + point.z * arcAlong),
    point.z * arcUp - across * s);
  let turn = treeRotation(vec3<f32>(-direction.y, direction.x, 0.0), tilt) * input.turn;
  return TreeMovement(moved, turn, input.swing, input.freed);
}

fn treeRotPoint(point: vec3<f32>, life: TreeLife) -> vec3<f32> {
  let flatten = 1.0 - smoothstep(0.06, 0.8, life.decay);
  let debris = max(life.trunkRadius * 0.45, 0.03);
  return vec3<f32>(point.xy, min(point.z, debris) + max(point.z - debris, 0.0) * flatten * flatten);
}

fn treeMovePoint(
  point: vec3<f32>,
  place: TreePlace,
  life: TreeLife,
  limbs: texture_2d<f32>,
  outerLimb: u32,
  innerLimb: u32
) -> TreeMovement {
  let lean = treeLeanMatrix(life);
  var moved = TreeMovement(point, TREE_IDENTITY, 0.0, 0.0);
  if (life.damage > 0.0) {
    moved = treeBreakLimb(limbs, innerLimb, moved, place, life, lean);
    if (moved.freed < 1.0 && outerLimb > 0u) {
      let outer = treeBreakLimb(limbs, outerLimb, moved, place, life, lean);
      let follow = 1.0 - smoothstep(0.0, 0.25, moved.freed);
      moved.point = mix(moved.point, outer.point, follow);
      if (follow > 0.5) {
        moved.turn = outer.turn;
        moved.swing = outer.swing;
      }
    }
  }
  moved.point = treeLeanPoint(moved.point, life, lean);
  moved.turn = lean * moved.turn;
  if (treePhotoreal.wind.x * life.windFlex > 0.0) {
    moved = treeBendPoint(moved, place, life);
  }
  if (life.lean > 0.6) {
    let crownNow = 1.0 - pow(1.0 - life.growth, 1.9);
    let layer = max(place.size.x, place.size.y) * crownNow * 0.17 * smoothstep(0.6, 1.45, life.lean);
    let fromRoot = moved.point.xy - life.leanDirection * treePlateRadius(life);
    let along = dot(fromRoot, life.leanDirection);
    let crown = smoothstep(0.0, 2.0 * max(treePlateRadius(life), 1e-6), along);
    if (layer > 0.0 && crown > 0.0) {
      if (moved.point.z >= layer) {
        moved.point.z -= (moved.point.z - layer) * 2.0 * layer / max(place.liveHeight, 1e-3) * crown;
      } else {
        let spread = (layer * exp((moved.point.z - layer) / layer) - moved.point.z) * crown;
        let aside = fromRoot - life.leanDirection * along;
        moved.point += vec3<f32>((aside * 0.55 / (length(aside) + layer) + life.leanDirection * 0.15) * spread, spread);
      }
    }
  }
  moved.point = treeRotPoint(moved.point, life);
  return moved;
}

fn treePixelsPerMetre(clipW: f32) -> f32 {
  let view = project.viewProjectionMatrix;
  let focal = length(vec3<f32>(view[0].y, view[1].y, view[2].y));
  return project_size_float(1.0) * focal * project.viewportSize.y * 0.5 /
    max(project.devicePixelRatio * clipW, 1e-6);
}

fn treeFilterVertexColor(color: vec4<f32>, instanceIndex: u32) -> vec4<f32> {
  var vertexColor = color;
  ${WGSL_FILTER_COLOR_ANCHOR}
  return vertexColor;
}

fn treeFilmic(color: vec3<f32>) -> vec3<f32> {
  let x = max(color, vec3<f32>(0.0));
  let mapped = clamp((x * (2.51 * x + vec3<f32>(0.03))) /
    (x * (2.43 * x + vec3<f32>(0.59)) + vec3<f32>(0.14)), vec3<f32>(0.0), vec3<f32>(1.0));
  return pow(mapped, vec3<f32>(1.0 / 2.2));
}

fn treeLightColor(color: vec3<f32>) -> vec3<f32> {
  let level = max(max(color.x, color.y), max(color.z, 1e-4));
  return pow(color / level, vec3<f32>(2.2)) * level;
}

fn treeHash(point: vec3<f32>) -> f32 {
  var p = fract(point * 0.1031);
  p += vec3<f32>(dot(p, p.zyx + vec3<f32>(31.32)));
  return fract((p.x + p.y) * p.z);
}

fn treeShadeMaterial(
  color: vec3<f32>,
  normal: vec3<f32>,
  position: vec3<f32>,
  openness: f32,
  transmission: f32
) -> vec3<f32> {
  if (phongMaterial.unlit != 0u || lighting.enabled == 0) { return color; }
  let up = select(vec3<f32>(0.0, 0.0, 1.0), normalize(position), treePhotoreal.clock.w > 0.5);
  let sky = 0.5 + 0.5 * dot(normal, up);
  let ambient = treeLightColor(lighting.ambientColor);
  var lit = color * phongMaterial.ambient * ambient * openness *
    mix(vec3<f32>(0.44, 0.38, 0.28), vec3<f32>(0.94, 1.0, 1.1), sky * sky);
  let view = normalize(project.cameraPosition - position);
  for (var i = 0; i < lighting.directionalLightCount; i++) {
    let light = lighting_getDirectionalLight(i);
    let toLight = -normalize(light.direction);
    let cosine = dot(normal, toLight);
    let diffuse = max(cosine, 0.0) + max(-cosine, 0.0) * transmission;
    let shine = pow(max(dot(normal, normalize(toLight + view)), 0.0), max(phongMaterial.shininess, 1.0));
    let specular = shine * 0.08 * floatColors_normalize(phongMaterial.specularColor);
    lit += (color * phongMaterial.diffuse * diffuse * openness + specular) * treeLightColor(light.color) * treeShadowDirect(i, position, normal);
  }
  for (var i = 0; i < lighting.pointLightCount; i++) {
    let light = lighting_getPointLight(i);
    let ray = light.position - position;
    lit += color * phongMaterial.diffuse * max(dot(normalize(ray), normal), 0.0) *
      treeLightColor(light.color) / getPointLightAttenuation(light, length(ray));
  }
  return lit;
}

fn treeOutput(color: vec3<f32>, alpha: f32, pickColor: vec3<f32>) -> vec4<f32> {
  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(pickColor)) { discard; }
    return vec4<f32>(pickColor, 1.0);
  }
  var display = treeFilmic(color);
  if (picking.isHighlightActive > 0.5 && picking_isColorZero(abs(pickColor - picking_normalizeColor(picking.highlightedObjectColor)))) {
    display = mix(display, picking.highlightColor.rgb, picking.highlightColor.a);
  }
  return vec4<f32>(display, alpha);
}
`
} as const satisfies ShaderModule;
