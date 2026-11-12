// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TREE_CROP_PART, type CropKind} from './tree-crop';
import {TREE_CROP_RANK_LEVELS, TREE_STATE_TEXEL} from './tree-photoreal-layout';
import {TREE_CROP_BLOOM_FROM} from './tree-photoreal-shaders';
import {treePhotorealRenderWgsl} from './tree-photoreal-render-wgsl';
import {getTreeWgslTextures} from './tree-photoreal-wgsl';

/** Native crop meshes and analytic distant discs use the same ranked anchor records. */
export function getTreeCropWgslShaders(kind: CropKind, dot: boolean) {
  const bindings = getTreeWgslTextures([
    'treeState',
    'treeLimbs',
    'treeCropAnchors',
    'treeCropRanks'
  ]);
  const flower = kind === 'flower';
  return {
    modules: [treePhotorealRenderWgsl],
    shaderLayout: bindings.shaderLayout,
    source: /* wgsl */ `
${bindings.source}

struct CropInput {
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) instanceCropRef: vec3<f32>,
  ${
    dot
      ? ''
      : `@location(1) cropPosition: vec3<f32>,
  @location(2) cropNormal: vec3<f32>,
  @location(3) cropPart: vec2<f32>,`
  }
};

struct CropVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) commonPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) local: vec3<f32>,
  @location(4) @interpolate(flat) pickingColor: vec3<f32>,
  @location(5) @interpolate(flat) seed: f32,
};

fn treeCropRankAt(crop: u32, growth: f32) -> f32 {
  let level = min(growth, 1.0) * ${TREE_CROP_RANK_LEVELS - 1}.0;
  let below = u32(level);
  let low = treeCropRankTexel(treeCropRanks, crop, below);
  if (level <= f32(below)) { return low; }
  return mix(low, treeCropRankTexel(treeCropRanks, crop, below + 1u), fract(level));
}

@vertex fn vertexMain(input: CropInput) -> CropVaryings {
  var output: CropVaryings;
  output.position = TREE_CULLED;
  let row = u32(input.instanceCropRef.x + 0.5);
  let index = input.instanceCropRef.y;
  let code = u32(input.instanceCropRef.z + 0.5);
  let slot = code % 2u;
  let dropped = (code & 2u) != 0u;
  let offTwig = (code & 4u) != 0u;
  let first = ${TREE_STATE_TEXEL.CROP0}u + slot * ${TREE_STATE_TEXEL.CROP1 - TREE_STATE_TEXEL.CROP0}u;
  let crop = treeStateTexel(treeState, row, first);
  let total = select(crop.x, treeStateTexel(treeState, row, ${TREE_STATE_TEXEL.CROP_DROPPED}u)[slot], dropped) *
    treePhotoreal.look.x;
  if (crop.y <= 0.0 || total <= 0.0) { return output; }
  let life = treeReadLife(treeState, row);
  if (life.growth <= 0.0 || life.coverage <= 0.0 || life.decay >= 1.0) { return output; }

  let cluster = max(treePhotoreal.shape.w, 1.0);
  let parent = u32(floor(index / cluster));
  var seed = fract(index * 0.61803399 + f32(slot) * 0.37 + life.seed);
  var grown = smoothstep(0.0, 0.02, life.growth);
  var anchor = vec3<f32>(0.0);
  var outer = 0u;
  var inner = 0u;
  if (dropped) {
    if (index >= total) { return output; }
  } else {
    let head = treeCropAnchorTexel(treeCropAnchors, parent, 0u);
    let born = ${flower ? `min(head.w, ${TREE_CROP_BLOOM_FROM})` : 'head.w'};
    let age = life.growth - born;
    let rank = treeCropRankAt(parent, ${flower ? '1.0' : 'life.growth'}) * cluster + index - f32(parent) * cluster;
    if (age <= 0.0 || rank >= total) { return output; }
    let tail = treeCropAnchorTexel(treeCropAnchors, parent, 1u);
    anchor = head.xyz;
    seed = tail.z;
    outer = u32(tail.x + 0.5);
    inner = u32(tail.y + 0.5);
    grown = smoothstep(0.0, max(min(1.0 - born, 0.012), 1e-6), age);
  }

  let ripe = treeStateTexel(treeState, row, first + 1u);
  let unripe = treeStateTexel(treeState, row, first + 2u);
  if (fract(seed * 61.73 + life.seed) >= life.coverage * ripe.a) { return output; }
  let place = treeReadPlace(treeState, row, life.growth);
  let hashA = fract(seed * 13.17);
  let hashB = fract(seed * 29.41);
  let hashC = fract(seed * 53.89);
  let hashD = fract(seed * 83.31);
  let hashE = fract(seed * 7.77);
  let full = crop.y * (0.84 + 0.16 * hashA) * treePhotoreal.look.y;
  let threshold = 0.02 + 0.96 * hashB;
  let passed = select(crop.w - threshold, 1.0, dropped);
  let settling = 1.0 - smoothstep(0.0, 0.02, unripe.a);
  let swell = pow(grown, 0.34) * mix(1.0, smoothstep(0.0, 0.02, abs(passed)), settling);
  let radius = full * swell;
  if (radius <= 0.0) { return output; }

  let twig = treeTurnYaw(treeToMetres(anchor, place.size), place.yaw);
  let attachment = treeMovePoint(twig, place, life, treeLimbs, outer, inner).point;
  let restZ = treePhotoreal.shape.z * radius + TREE_GROUND;
  let stem = full * treePhotoreal.look.w * (0.72 + 0.56 * hashE) * swell;
  let axis = vec2<f32>(cos(hashB * 2.0 * TREE_TWO_PI), sin(hashB * 2.0 * TREE_TWO_PI));
  let offset = axis * stem * select(0.25 + 0.6 * hashC, 1.0, offTwig);
  let hanging = vec3<f32>(attachment.xy + offset,
    max(restZ, attachment.z - stem - treePhotoreal.shape.y * radius));
  let crown = max(place.size.x, place.size.y) * (1.0 - pow(1.0 - life.growth, 1.9));
  let spread = vec2<f32>(cos(hashC * TREE_TWO_PI), sin(hashC * TREE_TWO_PI));
  let land = select(twig.xy + spread * (0.03 + 0.22 * hashD) * min(crown, 1.0),
    spread * sqrt(hashD) * crown * 0.92, dropped);
  let fallTime = sqrt(2.0 * max(hanging.z - restZ, 0.0) / 9.81);
  let duration = max(fallTime * 1.72, fallTime + 0.85) + 0.02;
  let flight = select(treeEventProgress(passed, unripe.a, duration), 1.0, dropped);
  let time = flight * duration;
  let airborne = smoothstep(0.0, max(fallTime, 0.05), time);
  let center = vec3<f32>(mix(hanging.xy, land, airborne),
    restZ + max(0.0, hanging.z - restZ - 4.905 * time * time));
  let projection = treeProject(center, place);
  if (!treeIsShadowPass() && (projection.clipPosition.w <= 1e-6 || splatBehindGlobe(projection.commonPosition.xyz))) { return output; }
  let pixelsPerMetre = treePixelsPerMetre(projection.clipPosition.w);
  let pixels = crop.y * pixelsPerMetre;
  if (pixels < treePhotoreal.clock.y || pixels >= treePhotoreal.clock.z) { return output; }

  let tint = mix(pow(unripe.rgb, vec3<f32>(2.2)), pow(ripe.rgb, vec3<f32>(2.2)), crop.z);
  output.color = mix(tint, vec3<f32>(0.085, 0.047, 0.025), smoothstep(0.03, 0.5, life.decay));
  output.pickingColor = picking_getPickingColorFromIndex(row);
  output.seed = seed;
  ${
    dot
      ? `
  let corners = array<vec2<f32>, 6>(
    vec2<f32>(-1, -1), vec2<f32>(1, -1), vec2<f32>(1, 1),
    vec2<f32>(-1, -1), vec2<f32>(1, 1), vec2<f32>(-1, 1)
  );
  let corner = corners[input.vertexIndex];
  let clip = projection.clipPosition;
  let pixelRadius = max(0.65, radius * pixelsPerMetre) * project.devicePixelRatio;
  output.position = vec4<f32>(clip.xy + corner * pixelRadius * 2.0 / project.viewportSize * clip.w, clip.zw);
  output.commonPosition = projection.commonPosition.xyz;
  output.normal = normalize(project.cameraPosition - output.commonPosition);
  output.local = vec3<f32>(corner, 0.0);
  `
      : `
  let part = u32(input.cropPart.x + 0.5);
  if (part == ${TREE_CROP_PART.CONTACT}u) { return output; }
  var normal = input.cropNormal;
  var local = input.cropPosition;
  let turning = treeRotation(vec3<f32>(0, 0, 1), seed * TREE_TWO_PI);
  let shape = vec3<f32>(1.0 + (hashD - 0.5) * 0.05, 1.0 - (hashD - 0.5) * 0.05, 0.925 + 0.105 * hashC);
  var point = center + turning * (local * shape) * radius;
  if (part == ${TREE_CROP_PART.STEM}u || part == ${TREE_CROP_PART.STALK}u) {
    let stemRoot = mix(attachment, center + vec3<f32>(0, 0, treePhotoreal.shape.y * radius + stem * 0.18), smoothstep(0.0, 0.06, flight));
    let start = center + vec3<f32>(0, 0, treePhotoreal.shape.y * radius);
    point = mix(start, stemRoot, local.z) + vec3<f32>(local.xy * radius, 0.0);
    output.color = vec3<f32>(0.12, 0.20, 0.035);
  } else {
    normal = turning * normal;
    if (part == ${TREE_CROP_PART.CALYX}u || part == ${TREE_CROP_PART.RECEPTACLE}u) {
      output.color = vec3<f32>(0.14, 0.22, 0.04);
    }
  }
  let projected = treeProject(vec3<f32>(point.xy, max(point.z, TREE_GROUND)), place);
  output.position = treeShadowPosition(projected.clipPosition, projected.commonPosition);
  output.commonPosition = projected.commonPosition.xyz;
  output.normal = splatProjectNormal(normal, projected.frame);
  output.local = local;
  `
  }
  output.color = treeFilterVertexColor(vec4<f32>(output.color, 1.0), input.instanceIndex).rgb;
  return output;
}

@fragment fn fragmentMain(input: CropVaryings) -> @location(0) vec4<f32> {
  if (treeIsShadowPass()) { return treeShadowDepth(input.position.z); }
  let footprint = length(fwidth(input.local));
  var normal = normalize(input.normal);
  ${
    dot
      ? `
  let r2 = dot(input.local.xy, input.local.xy);
  if (r2 > 1.0) { discard; }
  let right = normalize(cross(normal, vec3<f32>(0.0, 0.0, 1.0) + vec3<f32>(0.0001, 0.0, 0.0)));
  let up = cross(right, normal);
  normal = normalize(right * input.local.x + up * input.local.y + normal * sqrt(max(1.0 - r2, 0.0)));
  `
      : ''
  }
  let pore = treeHash(floor(input.local * 40.0 + vec3<f32>(input.seed * 6.0)));
  let detail = 1.0 - smoothstep(0.008, 0.04, footprint);
  let color = input.color * (1.0 + (pore - 0.5) * detail * 0.16);
  return treeOutput(treeShadeMaterial(color, normal, input.commonPosition, 0.36, 0.86, ${flower ? '0.24' : '0.0'}),
    layer.opacity, input.pickingColor);
}
`
  };
}
