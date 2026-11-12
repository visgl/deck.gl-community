// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  TREE_CITRUS_BUD_UNION_Z,
  TREE_ROOT_PLATE_RADII,
  TREE_ROOT_PLATE_THICKNESS
} from './tree-growth-model';
import {TREE_STATE_TEXEL, TREE_WOOD_FLAG} from './tree-photoreal-layout';
import {treePhotorealRenderWgsl} from './tree-photoreal-render-wgsl';
import {getTreeWgslTextures} from './tree-photoreal-wgsl';

/** Wood vertex buffers, growth rings and per-instance picking match the WebGL tree. */
export function getTreeWoodWgslShaders(lod: number) {
  const bindings = getTreeWgslTextures(['treeState', 'treeLimbs']);
  return {
    modules: [treePhotorealRenderWgsl],
    shaderLayout: bindings.shaderLayout,
    source: /* wgsl */ `
${bindings.source}

struct WoodInput {
  @builtin(instance_index) instanceIndex: u32,
  @location(0) treeCenter: vec4<f32>,
  @location(1) treePrevious: vec4<f32>,
  @location(2) treeRadial: vec4<f32>,
  @location(3) treeBark: vec4<f32>,
  @location(4) treeShade: vec4<f32>,
  @location(5) instanceTreeRow: f32,
};

struct WoodVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) commonPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) bark: vec4<f32>,
  @location(3) tint: vec3<f32>,
  @location(4) fate: vec4<f32>,
  @location(5) shade: vec4<f32>,
  @location(6) @interpolate(flat) pickingColor: vec3<f32>,
};

@vertex fn vertexMain(input: WoodInput) -> WoodVaryings {
  var output: WoodVaryings;
  output.position = TREE_CULLED;
  let row = u32(select(input.instanceTreeRow, treePhotoreal.woodLevel.w - 1.0, treePhotoreal.woodLevel.w > 0.0) + 0.5);
  let life = treeReadLife(treeState, row);
  if (life.growth <= 0.0 || life.coverage <= 0.0 || life.decay >= 1.0) { return output; }
  let flags = u32(input.treeShade.w);
  let root = (flags & ${TREE_WOOD_FLAG.ROOT}u) != 0u;
  let soil = (flags & ${TREE_WOOD_FLAG.SOIL}u) != 0u;
  let hidden = root || soil;
  let lift = smoothstep(0.0087266463, 0.13962634, life.lean);
  if (hidden && lift <= 0.0) { return output; }
  let place = treeReadPlace(treeState, row, life.growth);
  let growth = life.growth;
  let birth = input.treeCenter.w;
  let before = input.treePrevious.w;
  let advance = clamp((growth - before) / max(birth - before, 1e-5), 0.0, 1.0);
  var ring = treeRingRadius(input.treeRadial.w, birth, life);
  if (growth < 0.012 && growth > birth) {
    let t = clamp((growth - birth) / 0.0004, 0.0, 1.0);
    ring = max(ring, min(input.treeRadial.w, 0.006) * sqrt(t * (2.0 - t)));
  }
  if (growth <= before && ring <= 0.0) { return output; }

  let center = treeTurnYaw(treeToMetres(mix(input.treePrevious.xyz, input.treeCenter.xyz, advance), place.size), place.yaw);
  var normal = treeTurnYaw(input.treeRadial.xyz, place.yaw);
  let rot = smoothstep(0.25, 1.0, life.decay);
  var radius = ring * life.trunkRadius * (1.0 - 0.72 * rot);
  let barkMetres = input.treeBark.y * place.size.z;
  if (rot > 0.0 && !soil) {
    radius *= 1.0 - rot * 0.32 * (0.5 + 0.25 * sin(barkMetres * 11.0 + input.treeShade.z * 40.0) +
      0.25 * sin(barkMetres * 29.0));
  }
  var point = center + normal * radius;
  if (hidden) {
    let ratio = treePhotoreal.woodLevel.yz;
    let grown = treeRingRadius(1.0, 0.0, life);
    var trunk = vec3<f32>(1.0);
    if (ratio.x > 0.0) {
      trunk = grown * life.trunkRadius / (vec3<f32>(ratio.yy, ratio.x) * max(place.size.xyz, vec3<f32>(1e-6)));
    }
    let up = select(grown, trunk.z, ratio.x > 0.0);
    var scale = lift * vec3<f32>(0.5 * (trunk.x + trunk.y), trunk.z, 1.0);
    if (soil) { scale = lift * vec3<f32>(1.0, up, 1.0); }
    point = center * scale.xxy + normal * (radius * scale.z);
    if (soil) {
      let plate = point / max(scale.x, 1e-6);
      let middle = (plate + vec3<f32>(0.0, 0.0, ${0.47 * TREE_ROOT_PLATE_THICKNESS} * life.trunkRadius)) /
        max(life.trunkRadius, 1e-4);
      normal = normalize(vec3<f32>(middle.xy / ${TREE_ROOT_PLATE_RADII ** 2}.0, middle.z / ${0.25 * TREE_ROOT_PLATE_THICKNESS ** 2}));
    }
  }

  let outer = u32(input.treeBark.z + 0.5);
  let inner = u32(input.treeBark.w + 0.5);
  let moved = treeMovePoint(point, place, life, treeLimbs, outer, inner);
  let lifted = vec3<f32>(moved.point.xy, select(max(moved.point.z, TREE_GROUND), moved.point.z, hidden));
  let projection = treeProject(lifted, place);
  if (!treeIsShadowPass() && splatBehindGlobe(projection.commonPosition.xyz)) { return output; }
  let direction = splatProjectNormal(moved.turn * normal, projection.frame);
  var clip = projection.clipPosition;
  if (ring > 0.0 && !hidden && !treeIsShadowPass()) {
    let pixels = treePixelsPerMetre(clip.w) * project.devicePixelRatio;
    let extra = 0.22 / max(pixels, 1e-6) - radius;
    if (extra > 0.0) {
      let offset = project.viewProjectionMatrix * vec4<f32>(direction * project_size_float(extra), 0.0);
      clip = vec4<f32>(clip.xy + offset.xy, clip.zw);
    }
  }
  let tint = treeStateTexel(treeState, row, ${TREE_STATE_TEXEL.TRUNK}u);
  var torn = 0.0;
  if (moved.freed > 0.0 && inner > 0u) {
    let pivot = treeLimbTexel(treeLimbs, inner, 0u).xyz;
    torn = select(0.0, 1.0, dot(input.treePrevious.xyz - pivot, input.treeCenter.xyz - pivot) <= 1e-5);
  }
  let brown = pow(tint.rgb, vec3<f32>(2.2));
  let pale = 1.0 - smoothstep(0.005, 0.012, growth);
  output.position = treeShadowPosition(clip, projection.commonPosition);
  output.commonPosition = projection.commonPosition.xyz;
  output.normal = direction;
  output.bark = vec4<f32>(input.treeBark.x, barkMetres, input.treeRadial.w * life.trunkRadius,
    mix(growth - birth, 0.06, pale));
  output.tint = treeFilterVertexColor(vec4<f32>(mix(brown, vec3<f32>(0.62, 0.6, 0.42), pale), 1.0), input.instanceIndex).rgb;
  output.fate = vec4<f32>(life.decay, life.coverage * tint.a, torn, f32(flags));
  output.shade = vec4<f32>(input.treeShade.x, input.treeShade.z, life.foliage, input.treeShade.y);
  output.pickingColor = picking_getPickingColorFromIndex(input.instanceIndex);
  return output;
}

@fragment fn fragmentMain(input: WoodVaryings) -> @location(0) vec4<f32> {
  let around = input.bark.x * TREE_TWO_PI;
  let tube = vec3<f32>(vec2<f32>(cos(around), sin(around)) * input.bark.z, input.bark.y);
  let normal = normalize(input.normal);
  // At long distances the furrows converge toward their average.
  let pores = 1.0 - smoothstep(0.3, 1.25, length(fwidth(tube)) * treePhotoreal.barkA.y);
  if (input.fate.z > 1e-3 || treeHash(floor(tube * 96.0) + vec3<f32>(3.1)) >= input.fate.y) { discard; }
  if (treeIsShadowPass()) { return treeShadowDepth(input.position.z); }
  let decay = clamp((input.fate.x - 0.45) / 0.55, 0.0, 1.0);
  if (decay > 0.0 && treeHash(floor(tube * vec3<f32>(18.0, 18.0, 12.0))) > 1.0 - decay) { discard; }
  let grain = treeHash(floor(tube * vec3<f32>(treePhotoreal.barkA.y, treePhotoreal.barkA.y, 9.0)));
  let ridge = 0.5 + 0.5 * sin(around * 11.0 + sin(input.bark.y * 6.2) + 4.0 * input.shade.y);
  let relief = mix(1.0, 0.66 + 0.29 * ridge + 0.25 * grain, pores * treePhotoreal.barkA.x);
  let aged = mix(treePhotoreal.barkC.rgb, input.tint, smoothstep(0.0, 0.25, input.bark.w));
  let graft = exp(-abs(input.bark.y - ${TREE_CITRUS_BUD_UNION_Z}) * 170.0) *
    (1.0 - step(0.5, input.shade.w)) * treePhotoreal.barkB.w;
  let bark = mix(aged * (relief + 0.08 * graft), vec3<f32>(0.10, 0.073, 0.047), decay);
  let through = mix(1.0, 0.35 + input.shade.x * 0.65, input.shade.z);
  let openness = mix(0.72, through, ${lod < 2 ? '1.0' : '0.65'});
  return treeOutput(treeShadeMaterial(bark, normal, input.commonPosition, 1.0, openness, 0.0), layer.opacity, input.pickingColor);
}
`
  };
}
