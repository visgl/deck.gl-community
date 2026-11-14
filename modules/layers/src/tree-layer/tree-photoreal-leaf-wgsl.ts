// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TreeType} from './tree-layer';
import {TREE_STATE_TEXEL} from './tree-photoreal-layout';
import {
  getBladeSurface,
  getTreeLeafBladeCorners,
  TREE_LEAF_BLADE_MARGIN_MACRO,
  TREE_LEAF_BLADE_MARGIN_MOST,
  TREE_SHELL_COVERAGE_WGSL,
  type TreeLeafBlade
} from './tree-photoreal-shaders';
import {treePhotorealRenderWgsl} from './tree-photoreal-render-wgsl';
import {getTreeWgslTextures} from './tree-photoreal-wgsl';

/** Render the same indexed blade outlines and packed leaf records on WebGPU. */
export function getTreeLeafWgslShaders(
  blade: TreeLeafBlade,
  air: 'blend' | 'depth' | null | undefined,
  listed: boolean,
  species: TreeType,
  shellTransition = false
) {
  const mask = shellTransition && !air;
  const usesReferences = listed || blade === 'fine' || blade === 'macro';
  const fine = blade === 'fine' || blade === 'macro';
  const corners = air
    ? [
        [0, -0.5, -1],
        [0, 0.5, 1],
        [1, 0.5, 1],
        [1, -0.5, -1]
      ]
    : getTreeLeafBladeCorners(blade, species);
  const surface = getBladeSurface(species);
  const needle = species === 'pine';
  const bindings = getTreeWgslTextures(['treeState', 'treeLimbs', 'treeLeaves']);
  return {
    modules: [treePhotorealRenderWgsl],
    shaderLayout: bindings.shaderLayout,
    source: /* wgsl */ `
${bindings.source}
${mask ? TREE_SHELL_COVERAGE_WGSL : ''}

const LEAF_OUTLINE = array<vec3<f32>, ${corners.length}>(
  ${corners.map(corner => `vec3<f32>(${corner.join(', ')})`).join(',\n  ')}
);

struct LeafInput {
  @builtin(instance_index) instanceIndex: u32,
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) ${usesReferences ? 'instanceLeafRef: vec2<f32>' : 'instanceTreeRow: f32'},
};

struct LeafVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) commonPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) color: vec3<f32>,
  @location(3) blade: vec3<f32>,
  @location(4) optics: vec3<f32>,
  @location(5) @interpolate(flat) pickingColor: vec3<f32>,
  ${mask ? '@location(6) @interpolate(flat) shellRetention: f32,' : ''}
};

@vertex fn vertexMain(input: LeafInput) -> LeafVaryings {
  var output: LeafVaryings;
  output.position = TREE_CULLED;
  let row = u32(${usesReferences ? 'input.instanceLeafRef.x' : 'input.instanceTreeRow'} + 0.5);
  let leaf = ${usesReferences ? 'u32(input.instanceLeafRef.y + 0.5)' : `input.vertexIndex / ${corners.length}u`};
  let corner = input.vertexIndex % ${corners.length}u;
  let life = treeReadLife(treeState, row);
  let count = treePhotoreal.shape.z * life.leafDetail;
  if (f32(leaf) >= count || life.coverage <= 0.0 || life.decay >= 1.0) { return output; }
  let timing = treeLeafTexel(treeLeaves, leaf, 2u);
  let seed = timing.z;
  let age = life.growth - timing.x;
  if (age <= 0.0 || life.growth > timing.y + 0.004 || fract(seed * 61.73 + life.seed) >= life.coverage) { return output; }
  let canopy = treeStateTexel(treeState, row, ${TREE_STATE_TEXEL.CANOPY}u);
  if (fract(seed * 71.37 + life.seed) >= canopy.a) { return output; }

  let passed = seed - life.foliage * 1.02;
  let flightSeconds = 1.2 + 1.3 * fract(seed * 83.31);
  let flight = treeEventProgress(passed, life.foliageRate, flightSeconds);
  let litter = fract(seed * 97.13) < 0.18;
  if (flight >= 1.0 && !litter) { return output; }
  ${air ? 'if (flight < 0.06 || flight >= 1.0 || (litter && flight >= 0.72)) { return output; }' : blade === 'coarse' ? 'if (flight >= 0.06 && (!litter || flight < 0.72)) { return output; }' : ''}
  let lying = select(0.0, smoothstep(0.72, 1.0, flight), litter);
  let settling = 1.0 - smoothstep(0.0, 0.02, life.foliageRate);
  let ageSpan = max(min(1.0 - timing.x, 0.012), 1e-6);
  let grown = smoothstep(0.0, ageSpan, age);
  let tailCount = count * 0.25 * clamp((1.0 - life.leafDetail) * 10.0 + treePhotoreal.look.w, 0.0, 1.0);
  var presence = grown * (1.0 - smoothstep(timing.y, timing.y + 0.004, life.growth)) *
    (1.0 - smoothstep(fract(seed * 37.71) * 0.4, fract(seed * 37.71) * 0.4 + 0.25, life.decay));
  if (tailCount > 0.0) { presence *= 1.0 - smoothstep(count - tailCount, count, f32(leaf)); }
  if (passed <= 0.0 || litter) {
    presence *= mix(1.0, smoothstep(0.0, 0.02, abs(passed)), settling);
  } else {
    let share = 0.07 / max(life.foliageRate * flightSeconds, 0.07);
    presence *= max(1.0 - smoothstep(share * 0.9, share, fract(seed * 47.71)), 1.0 - smoothstep(0.0, 0.06, flight));
  }
  if (presence <= 0.0) { return output; }

  let head = treeLeafTexel(treeLeaves, leaf, 0u);
  let frame = treeLeafTexel(treeLeaves, leaf, 1u);
  let tail = treeLeafTexel(treeLeaves, leaf, 3u);
  let place = treeReadPlace(treeState, row, life.growth);
  let rest = treeTurnYaw(treeToMetres(head.xyz, place.size), place.yaw);
  let moved = treeMovePoint(rest, place, life, treeLimbs, u32(tail.x + 0.5), u32(tail.y + 0.5));
  var base = moved.point;
  var axisX = moved.turn * treeTurnYaw(treeQuaternionTurn(frame, vec3<f32>(1, 0, 0)), place.yaw);
  var axisZ = moved.turn * treeTurnYaw(treeQuaternionTurn(frame, vec3<f32>(0, 0, 1)), place.yaw);
  let hashA = fract(seed * 13.17);
  let hashB = fract(seed * 29.41);
  let hashC = fract(seed * 53.89);
  if (flight > 0.0) {
    let direction = select(vec2<f32>(cos(hashA * TREE_TWO_PI), sin(hashA * TREE_TWO_PI)), treePhotoreal.wind.yz, treePhotoreal.wind.w > 0.5);
    let force = treePhotoreal.wind.x * life.windFlex;
    let drift = (2.5 + 34.0 * force) * flightSeconds * pow(flight, 1.6) * (0.4 + 0.6 * hashB);
    let litterDrift = (0.15 + 1.3 * force) * sin(flight * TREE_PI) + hashC * smoothstep(0.0, 1.0, flight);
    let away = direction * select(drift, litterDrift, litter);
    base = vec3<f32>(base.xy + away,
      mix(base.z, TREE_GROUND, treeFallCurve(flight)) + select(force * sin(flight * TREE_PI), 0.0, litter));
    let spin = sin(flight * (7.0 + 5.0 * hashB) + seed * TREE_TWO_PI) * (1.0 - lying);
    axisX = treeRotate(axisX, axisZ, spin);
    axisZ = normalize(mix(treeRotate(axisZ, axisX, spin), vec3<f32>(0, 0, 1), lying));
  }

  let axisY = cross(axisZ, axisX);
  let natural = head.w * life.leafScale;
  let crown = place.size.x * (1.0 - pow(1.0 - life.growth, 1.9));
  let standFor = max(1.0, min(sqrt(treePhotoreal.shape.y / max(count, 1.0)), 0.6 * crown / max(natural, 1e-4)));
  let bladeLength = natural * mix(standFor, 1.0, smoothstep(0.0, 0.12, flight)) * presence;
  let centre = treeProject(base, place);
  if (!treeIsShadowPass() && (centre.clipPosition.w <= 1e-6 || splatBehindGlobe(centre.commonPosition.xyz))) { return output; }
  let finePixels = treePhotoreal.leafBlades.x;
  if (${air ? 'false' : 'life.leafDetail >= 1.0 && finePixels > 0.0 && (flight <= 0.0 || lying >= 1.0)'}) {
    let metre = project_size_float(1.0);
    let pixelsAtMetre = natural * treePhotoreal.leafBlades.z * metre;
    let nowDistance = length(project.cameraPosition - centre.commonPosition.xyz);
    let restCommon = treeProject(treeLeanPoint(rest, life, treeLeanMatrix(life)), place).commonPosition.xyz;
    let restDistance = select(length(project.cameraPosition - restCommon), nowDistance, lying >= 1.0);
    let reach = min(treePhotoreal.wind.x * life.windFlex * place.liveHeight * 0.5, ${TREE_LEAF_BLADE_MARGIN_MOST}.0) * metre;
    let isFine = pixelsAtMetre >= finePixels * max(nowDistance, restDistance - reach);
    let isMacro = pixelsAtMetre >= treePhotoreal.leafBlades.y * max(nowDistance, restDistance - reach * ${TREE_LEAF_BLADE_MARGIN_MACRO});
    ${blade === 'macro' ? 'if (!isMacro) { return output; }' : blade === 'fine' ? 'if (!isFine || isMacro) { return output; }' : 'if (isFine) { return output; }'}
  }${fine ? ' else { return output; }' : ''}

  let brown = smoothstep(0.02 + 0.86 * fract(seed * 43.11), 0.14 + 0.86 * fract(seed * 43.11), 1.0 - life.health);
  let open = smoothstep(0.0, ageSpan * 1.6, age);
  let bladePoint = LEAF_OUTLINE[corner];
  let t = bladePoint.x;
  let widthRatio = tail.w * (1.0 - 0.42 * brown) * (1.0 - 0.3 * lying);
  var width = bladePoint.y * widthRatio * 0.5;
  var fold = (mix(1.8, ${surface.fold === null ? '0.14 + 0.2 * hashA' : surface.fold}, open) + brown * (0.7 + hashB)) * (1.0 - 0.72 * flight);
  var droop = (${needle ? '(0.025 + 0.055 * hashB) * open + brown * 0.075' : '(0.1 + 0.32 * hashB) * open + brown * 0.3'}) * (1.0 - 0.8 * flight);
  fold = mix(fold, 0.2 + 0.8 * hashB, lying);
  droop = mix(droop, (hashC - 0.42) * 0.9, lying);
  ${
    fine && !needle
      ? `
  let phase = hashA * TREE_TWO_PI + select(-1.7, 1.7, bladePoint.z >= 0.0);
  let wave = (0.62 * sin(t * (10.0 + 5.0 * hashB) + phase) +
    0.38 * sin(t * (23.0 + 8.0 * hashC) + phase * 2.3)) * smoothstep(0.1, 0.18, t);
  let margin = bladePoint.z * bladePoint.z;
  width *= 1.0 + 0.035 * wave * margin;
  let twist = (hashC - 0.5) * 0.7 + brown * (hashA - 0.5) * 1.6;
  let thickness = fold * (sqrt(width * width + 3.6e-5) - 0.006) - ${surface.cup} * width * width - droop * t * t +
    ${surface.ruffle} * wave * margin + width * sin(twist * t);
  let bladeOffset = axisX * t * (1.0 - 0.18 * droop * droop * t * t) +
    axisY * width * cos(twist * t) + axisZ * thickness;
  `
      : 'let bladeOffset = axisX * t + axisY * width + axisZ * (abs(width) * fold - droop * t * t);'
  }
  let point = base + bladeOffset * bladeLength;
  let projection = treeProject(vec3<f32>(point.xy, max(point.z, mix(TREE_GROUND, -0.03, lying))), place);
  let normal = normalize(axisZ + axisX * (2.0 * droop * t) - axisY * (fold * bladePoint.z));
  let tint = pow(canopy.rgb, vec3<f32>(2.2));
  let luminance = dot(tint, vec3<f32>(0.3, 0.55, 0.15));
  var color = mix(tint, vec3<f32>(luminance), 0.45) * vec3<f32>(0.82, 0.53, 0.33);
  let shoot = fract(f32(u32(tail.y + 0.5)) * 0.61803399);
  let newness = clamp(0.74 * smoothstep(0.1, 0.95, timing.w) + 0.3 * tail.z + 0.34 * (shoot - 0.5) +
    0.14 * (hashA - 0.5), 0.0, 1.0);
  color *= mix(vec3<f32>(0.72, 0.74, 0.86), vec3<f32>(1.16, 1.12, 0.95), newness);
  let young = (1.0 - smoothstep(0.0, 0.024, age)) * (1.0 - smoothstep(0.97, 1.0, life.growth));
  color = mix(color, vec3<f32>(0.17, 0.27, 0.05), max(young * 0.75, life.flush * smoothstep(0.08, 0.6, tail.z)));
  color = mix(color, vec3<f32>(0.115, 0.066, 0.026) * mix(0.75, 1.25, hashC), brown);
  color = mix(color, vec3<f32>(0.05, 0.032, 0.014), lying * mix(0.55, 1.0, hashC));
  color = mix(color, vec3<f32>(0.075, 0.058, 0.04), smoothstep(0.02, 0.4, life.decay));
  output.position = treeShadowPosition(projection.clipPosition, projection.commonPosition);
  output.commonPosition = projection.commonPosition.xyz;
  output.normal = splatProjectNormal(normal, projection.frame);
  output.color = treeFilterVertexColor(vec4<f32>(color, 1.0), input.instanceIndex).rgb;
  output.blade = vec3<f32>(t, bladePoint.z, width);
  output.optics = vec3<f32>(mix(0.62 + 0.38 * timing.w, 1.0, flight), seed,
    presence * select(1.0 - smoothstep(0.86, 1.0, flight), 1.0, litter));
  output.pickingColor = picking_getPickingColorFromIndex(${usesReferences ? 'row' : 'input.instanceIndex'});
  ${mask ? `output.shellRetention = treeStateTexel(treeState, row, ${TREE_STATE_TEXEL.CROP_DROPPED}u).z;` : ''}
  return output;
}

@fragment fn fragmentMain(input: LeafVaryings, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
  if (treeIsShadowPass()) { return treeShadowDepth(input.position.z); }
  let t = input.blade.x;
  ${
    needle
      ? 'let modulation = 1.0;'
      : `let detail = 1.0 - smoothstep(0.015, 0.12, fwidth(t));
  let vein = (1.0 - smoothstep(0.012, 0.13, abs(input.blade.y))) * detail;
  let modulation = 1.0 + vein * 0.14 + detail * 0.035 * sin(95.0 * t + input.optics.y * 21.0);`
  }
  ${mask ? 'if (input.shellRetention > 0.0 && treeShellCoversPixel(input.position.xy, input.shellRetention)) { discard; }' : ''}
  let normal = normalize(input.normal) * select(-1.0, 1.0, front);
  ${
    air
      ? `if (picking.isActive > 0.5) { discard; }
  let cover = input.optics.z * (1.0 - smoothstep(0.6, 1.0, abs(input.blade.y)));
  ${air === 'depth' ? 'if (treeHash(input.position.xyz) >= cover) { discard; } return vec4<f32>(0.0);' : 'if (cover <= 0.001) { discard; } return treeOutput(treeShadeMaterial(input.color, normal, input.commonPosition, 1.0, 0.25), cover * layer.opacity, input.pickingColor);'}`
      : 'return treeOutput(treeShadeMaterial(input.color * modulation, normal, input.commonPosition, input.optics.x, 0.22), layer.opacity, input.pickingColor);'
  }
}
`
  };
}
