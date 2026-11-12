// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {project32} from '@deck.gl/core';
import type {ShaderLayout} from '@luma.gl/core';
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_GLOBE_WGSL} from '../splat-layer/splat-globe';
import {
  TREE_CROP_ANCHOR_STRIDE,
  TREE_CROP_RANK_LEVELS,
  TREE_LEAF_STRIDE,
  TREE_LIMB_STRIDE,
  TREE_RADIAL_EXPONENT,
  TREE_SHOOT_MATURING,
  TREE_SHOOT_RADIUS,
  TREE_STATE_ROWS_PER_LINE,
  TREE_STATE_TEXEL,
  TREE_STATE_TEXELS_PER_ROW,
  TREE_TEMPLATE_TEXTURE_WIDTH
} from './tree-photoreal-layout';
import {
  TREE_WOOD_HIDDEN_FROM,
  TREE_WOOD_HIDDEN_TO,
  TREE_WOOD_LOD_SHIFT,
  treePhotoreal,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';

/** Application-owned slots below luma.gl's WGSL shader-module bindings. */
const TEXTURE_LOCATIONS = {
  treeState: 0,
  treeLimbs: 1,
  treeLeaves: 2,
  treeCropAnchors: 3,
  treeCropRanks: 4
} as const;

type TreeTextureBinding = keyof typeof TEXTURE_LOCATIONS;

/** Bind only the float textures a variant uses, without requiring float32 filtering. */
export function getTreeWgslTextures(names: readonly TreeTextureBinding[]): {
  source: string;
  shaderLayout: ShaderLayout;
} {
  return {
    source: names
      .map(name => `@group(0) @binding(${TEXTURE_LOCATIONS[name]}) var ${name}: texture_2d<f32>;`)
      .join('\n'),
    shaderLayout: {
      attributes: [],
      bindings: names.map(name => ({
        type: 'texture',
        name,
        group: 0,
        location: TEXTURE_LOCATIONS[name],
        sampleType: 'unfilterable-float'
      }))
    }
  };
}

/** Shared projection, lifecycle state and template addressing for photoreal WGSL primitives. */
export const treePhotorealWgsl = {
  name: treePhotoreal.name,
  dependencies: [project32],
  uniformTypes: treePhotoreal.uniformTypes,
  source: /* wgsl */ `
struct TreePhotorealUniforms {
  ${Object.entries(treePhotoreal.uniformTypes)
    .map(([name, type]) => `${name}: ${type},`)
    .join('\n  ')}
};

@group(0) @binding(auto) var<uniform> treePhotoreal: TreePhotorealUniforms;

${SPLAT_GLOBE_WGSL}

fn treeStateTexel(state: texture_2d<f32>, row: u32, texel: u32) -> vec4<f32> {
  let cell = vec2<u32>(
    (row % ${TREE_STATE_ROWS_PER_LINE}u) * ${TREE_STATE_TEXELS_PER_ROW}u + texel,
    row / ${TREE_STATE_ROWS_PER_LINE}u
  );
  return textureLoad(state, cell, 0);
}

fn treeTemplateTexel(tex: texture_2d<f32>, index: u32) -> vec4<f32> {
  let width = ${TREE_TEMPLATE_TEXTURE_WIDTH}u;
  return textureLoad(tex, vec2<u32>(index % width, index / width), 0);
}

fn treeLimbTexel(limbs: texture_2d<f32>, limb: u32, texel: u32) -> vec4<f32> {
  return treeTemplateTexel(limbs, limb * ${TREE_LIMB_STRIDE / 4}u + texel);
}

fn treeLeafTexel(leaves: texture_2d<f32>, leaf: u32, texel: u32) -> vec4<f32> {
  return treeTemplateTexel(leaves, leaf * ${TREE_LEAF_STRIDE / 4}u + texel);
}

fn treeCropAnchorTexel(anchors: texture_2d<f32>, crop: u32, texel: u32) -> vec4<f32> {
  return treeTemplateTexel(anchors, crop * ${TREE_CROP_ANCHOR_STRIDE / 4}u + texel);
}

fn treeCropRankTexel(ranks: texture_2d<f32>, crop: u32, level: u32) -> f32 {
  return treeTemplateTexel(ranks, crop * ${TREE_CROP_RANK_LEVELS}u + level).x;
}

struct TreeLife {
  growth: f32,
  health: f32,
  foliage: f32,
  flush: f32,
  lean: f32,
  leanDirection: vec2<f32>,
  damage: f32,
  decay: f32,
  trunkRadius: f32,
  windFlex: f32,
  coverage: f32,
  leafScale: f32,
  leafDetail: f32,
  seed: f32,
  foliageRate: f32,
  damageRate: f32,
};

fn treeReadLife(state: texture_2d<f32>, row: u32) -> TreeLife {
  let life = treeStateTexel(state, row, ${TREE_STATE_TEXEL.LIFE}u);
  let pose = treeStateTexel(state, row, ${TREE_STATE_TEXEL.POSE}u);
  let misc = treeStateTexel(state, row, ${TREE_STATE_TEXEL.MISC}u);
  let detail = treeStateTexel(state, row, ${TREE_STATE_TEXEL.DETAIL}u);
  return TreeLife(
    life.x, life.y, life.z, life.w,
    pose.x, vec2<f32>(cos(pose.y), sin(pose.y)), pose.z, pose.w,
    misc.x, misc.y, misc.z, misc.w,
    detail.x, detail.y, detail.z, detail.w
  );
}

struct TreePlace {
  anchor: vec3<f32>,
  anchorLow: vec3<f32>,
  yaw: vec2<f32>,
  windPhase: f32,
  size: vec4<f32>,
  liveHeight: f32,
};

fn treeReadPlace(state: texture_2d<f32>, row: u32, growth: f32) -> TreePlace {
  let anchor = treeStateTexel(state, row, ${TREE_STATE_TEXEL.ANCHOR}u);
  let low = treeStateTexel(state, row, ${TREE_STATE_TEXEL.ANCHOR_LOW}u);
  let size = treeStateTexel(state, row, ${TREE_STATE_TEXEL.SIZE}u);
  let height = select(max(size.z * (1.0 - pow(1.0 - growth, 1.6)), 0.01), size.z, growth >= 1.0);
  return TreePlace(anchor.xyz, low.xyz, vec2<f32>(cos(anchor.w), sin(anchor.w)), low.w, size, height);
}

fn treeToMetres(point: vec3<f32>, size: vec4<f32>) -> vec3<f32> {
  let forkZ = treePhotoreal.shape.x;
  var z = point.z * size.z;
  if (point.z >= 0.0) {
    if (point.z < forkZ) {
      z = (point.z / forkZ) * size.w;
    } else {
      z = size.w + ((point.z - forkZ) / (1.0 - forkZ)) * (size.z - size.w);
    }
  }
  return vec3<f32>(point.xy * size.xy, z);
}

fn treeTurnYaw(point: vec3<f32>, yaw: vec2<f32>) -> vec3<f32> {
  return vec3<f32>(point.x * yaw.x - point.y * yaw.y, point.x * yaw.y + point.y * yaw.x, point.z);
}

struct TreeProjection {
  clipPosition: vec4<f32>,
  commonPosition: vec4<f32>,
  frame: mat3x3<f32>,
};

fn treeProject(point: vec3<f32>, place: TreePlace) -> TreeProjection {
  let anchor = project_position_vec3_f64(place.anchor, place.anchorLow);
  let frame = splatTangentFrame(anchor);
  let position = splatProjectOffset(anchor, frame, project_size_vec3(point));
  return TreeProjection(position.clipPosition, position.commonPosition, frame);
}

fn treeWoodLevelFade(radius: f32, birth: f32, life: TreeLife) -> f32 {
  if (radius >= treePhotoreal.woodLevel.x) {
    return 1.0;
  }
  let hidden = smoothstep(${TREE_WOOD_HIDDEN_FROM}, ${TREE_WOOD_HIDDEN_TO}, life.foliage);
  let level = -log(max(life.leafDetail, 1e-4)) * 0.72134752 + ${TREE_WOOD_LOD_SHIFT} * hidden;
  let left = 1.0 - smoothstep(mix(0.5, 0.72, hidden), 0.98, fract(level));
  let hash = fract(sin(floor(birth * 97.0) * 12.9898 + floor(radius * 911.0) * 78.233) * 43758.5453);
  return select(0.0, 1.0, hash < left);
}

fn treeRingRadius(radius: f32, birth: f32, life: TreeLife) -> f32 {
  if (life.growth <= birth) {
    return 0.0;
  }
  let age = life.growth - birth;
  let wood = radius * pow(min(1.0, age / max(1.0 - birth, 1e-5)), ${TREE_RADIAL_EXPONENT});
  let t = min(1.0, age / ${TREE_SHOOT_MATURING});
  let shoot = min(radius, ${TREE_SHOOT_RADIUS}) * t * t * (3.0 - 2.0 * t);
  return max(wood, shoot) * treeWoodLevelFade(radius, birth, life);
}
`
} as const satisfies ShaderModule<TreePhotorealUniforms>;
