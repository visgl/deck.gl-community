// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {picking, project32} from '@deck.gl/core';
import type {Texture} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {TreePhotorealPrimitiveLayer} from './tree-photoreal-primitive-layer';
import {TREE_STATE_TEXEL} from './tree-photoreal-layout';
import {treePhotorealRenderWgsl} from './tree-photoreal-render-wgsl';
import {
  getTreeShadowFragment,
  getTreeShadowVertex,
  treePhotoreal,
  TREE_PHOTOREAL_FRAGMENT_CHUNK,
  TREE_PHOTOREAL_VERTEX_CHUNK,
  TREE_SHELL_COVERAGE_GLSL,
  TREE_SHELL_COVERAGE_WGSL,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';
import {getTreeWgslTextures} from './tree-photoreal-wgsl';
import {SHELL_STAGES} from './tree-shell-fit';
import {getTreeShellMesh} from './tree-shell-mesh';

const GLSL_STAGES = SHELL_STAGES.map(stage => stage.toFixed(2)).join(', ');
const STAGE_COUNT = SHELL_STAGES.length;
const LAST_STAGE = STAGE_COUNT - 1;
const {CANOPY, CROP_DROPPED} = TREE_STATE_TEXEL;

const vertex = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in float hullVertex;
in float instanceTreeRow;
uniform sampler2D treeHull;
out vec3 vLocal;
out vec4 vTint;
#ifndef TREE_SHELL_SHADOW_ONLY
out vec3 vNormal;
out vec3 vPosition;
out vec3 vLife;
#ifdef TREE_SHELL_TRANSITION
flat out float vShellRetention;
#endif
#endif
${TREE_PHOTOREAL_VERTEX_CHUNK}
#ifndef TREE_SHELL_SHADOW_ONLY
${getTreeShadowVertex(true)}
#endif
const float stages[${STAGE_COUNT}] = float[](${GLSL_STAGES});

void main() {
  gl_Position = TREE_CULLED;
  int row = int(instanceTreeRow + 0.5);
  treeLoadLife(row);
  if (tree.growth <= 0.0 || tree.foliage <= 0.0 || tree.coverage <= 0.0 || tree.decay >= 1.0) return;
  int first = 0;
  for (int i = 1; i < ${LAST_STAGE}; i++) {
    if (tree.growth > stages[i]) first = i;
  }
  float t = clamp((tree.growth - stages[first]) / (stages[first + 1] - stages[first]), 0.0, 1.0);
  int count = int(treePhotoreal.look.x);
  int index = int(hullVertex);
  int clump = index / count;
  int x = 2 + 2 * (index % count);
  int y = clump * ${STAGE_COUNT} + first;
  vec4 info = mix(texelFetch(treeHull, ivec2(0, y), 0), texelFetch(treeHull, ivec2(0, y + 1), 0), t);
  if (info.x <= 0.0) return;
  vec4 samplePoint = mix(texelFetch(treeHull, ivec2(x, y), 0), texelFetch(treeHull, ivec2(x, y + 1), 0), t);
  treeLoadPlace(row);
  vec3 local = treeToMetres(samplePoint.xyz);
  vec3 posed = local;
  posed.z -= max(local.z, 0.0) * smoothstep(0.15, 1.0, tree.damage) * 0.22;
  vec3 point = treeLeanPoint(treeTurnYaw(posed));
  treeWindLoad();
  vec4 commonPosition = treeProject(treeDecayPoint(treeWindPoint(point)));
  vLocal = local;
  float alive = (1.0 - smoothstep(samplePoint.w - 0.05, samplePoint.w + 0.15, tree.damage)) * (1.0 - 0.33 * tree.damage);
  vec4 tint = treeStateTexel(row, ${CANOPY});
  float coverage = tint.a * tree.coverage * tree.foliage * alive *
    smoothstep(0.0, 0.16, info.x) * (1.0 - smoothstep(0.0, 0.5, tree.decay));
#ifdef TREE_SHELL_SHADOW_ONLY
  vTint.a = coverage;
#else
  vec4 sampleNormal = mix(texelFetch(treeHull, ivec2(x + 1, y), 0), texelFetch(treeHull, ivec2(x + 1, y + 1), 0), t);
  float height = samplePoint.z < treePhotoreal.shape.x
    ? tree.size.w / treePhotoreal.shape.x
    : (tree.size.z - tree.size.w) / (1.0 - treePhotoreal.shape.x);
  vec3 normal = normalize(sampleNormal.xyz / max(vec3(tree.size.xy, height), vec3(0.01)));
  normal = treeLeanTurn(treeTurnYaw(normal));
  normal = treeWindTurn(normal, point.z);
  vPosition = commonPosition.xyz;
  vNormal = treeToCommonDirection(normal);
  geometry.normal = vNormal;
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  vec4 filtered = vec4(pow(tint.rgb, vec3(2.2)), 1.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
  vTint = vec4(filtered.rgb, coverage);
  vLife = vec3(tree.health, tree.flush, sampleNormal.w);
#ifdef TREE_SHELL_TRANSITION
  vShellRetention = treeStateTexel(row, ${CROP_DROPPED}).z;
#endif
#ifdef MODULE_SHADOW
  if (!shadow.drawShadowMap) treeShadowWrite(commonPosition, tree.seed, 0.10);
#endif
#endif
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
}
`;

const fragment = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vLocal;
in vec4 vTint;
#ifndef TREE_SHELL_SHADOW_ONLY
in vec3 vNormal;
in vec3 vPosition;
in vec3 vLife;
#ifdef TREE_SHELL_TRANSITION
flat in float vShellRetention;
${TREE_SHELL_COVERAGE_GLSL}
#endif
#endif
out vec4 fragColor;
${TREE_PHOTOREAL_FRAGMENT_CHUNK}
#ifndef TREE_SHELL_SHADOW_ONLY
${getTreeShadowFragment(true, 4)}
#endif

void main() {
  float pores = treeHash(floor(vLocal * 22.0) + 0.5);
#ifdef TREE_SHELL_SHADOW_ONLY
  // The smooth noise cannot move the threshold outside these bounds. Keep a
  // small rounding margin before testing the unchanged cutoff in between.
  float coverage = vTint.a;
  if (pores >= coverage * 1.33001) discard;
  if (pores >= coverage * 0.71999) {
    float grain = treeNoise(vLocal * 6.0);
    if (pores >= coverage * mix(0.72, 1.33, grain)) discard;
  }
#ifdef MODULE_SHADOW
  fragColor = shadow_filterShadowColor(vec4(0.0));
#else
  fragColor = vec4(0.0);
#endif
#else
  float grain = treeNoise(vLocal * 6.0);
  if (pores >= vTint.a * mix(0.72, 1.33, grain)) discard;
#ifdef TREE_SHELL_TRANSITION
#ifdef MODULE_SHADOW
  if (!shadow.drawShadowMap)
#endif
  {
    if (vShellRetention > 0.0 && !treeShellCoversPixel(gl_FragCoord.xy, vShellRetention)) discard;
  }
#endif
  geometry.uv = vec2(0.0);
  if (picking.isActive > 0.5) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    DECKGL_FILTER_COLOR(fragColor, geometry);
    return;
  }
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) {
    fragColor = shadow_filterShadowColor(vec4(0.0));
    return;
  }
#endif
  vec3 normal = normalize(vNormal);
  vec3 up = treeUp(vPosition);
  float openness = mix(0.56, 1.0, vLife.z * 0.4 + grain * 0.6);
  vec3 color = mix(vTint.rgb * vec3(1.0, 0.68, 0.32), vTint.rgb, vLife.x);
  color = mix(color, color * vec3(1.27, 1.46, 0.76), vLife.y * grain);
  vec3 lit = color;
  if (lighting.enabled != 0 && !material.unlit) {
    lit = color * treeHemisphere(normal, up) * material.ambient * openness;
#ifdef MODULE_SHADOW
    treeShadowNormal = normal;
#endif
    for (int i = 0; i < lighting.directionalLightCount; i++) {
      DirectionalLight light = lighting_getDirectionalLight(i);
      float cosine = dot(normal, -normalize(light.direction));
      float diffuse = max(cosine, 0.0) + 0.18 * max(-cosine, 0.0);
      lit += color * treeLightColor(light.color) * material.diffuse * diffuse * openness *
        treeDirectionalVisibility(i, 0.1);
    }
    for (int i = 0; i < lighting.pointLightCount; i++) {
      PointLight light = lighting_getPointLight(i);
      vec3 ray = light.position - vPosition;
      lit += color * treeLightColor(light.color) * material.diffuse * max(dot(normal, normalize(ray)), 0.0) /
        getPointLightAttenuation(light, length(ray));
    }
  }
  fragColor = vec4(treeFilmic(lit), layer.opacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);
#endif
}
`;

function getShellWgslShaders(shellTransition: boolean) {
  const {source, shaderLayout} = getTreeWgslTextures(['treeState', 'treeLimbs']);
  shaderLayout.bindings.push({
    type: 'texture',
    name: 'treeHull',
    group: 0,
    location: 5,
    sampleType: 'unfilterable-float'
  });
  return {
    shaderLayout,
    modules: [treePhotorealRenderWgsl],
    source: /* wgsl */ `
${source}
${shellTransition ? TREE_SHELL_COVERAGE_WGSL : ''}
@group(0) @binding(5) var treeHull: texture_2d<f32>;
const stages = array<f32, ${STAGE_COUNT}>(${GLSL_STAGES});

struct HullVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) local: vec3<f32>,
  @location(1) commonPosition: vec3<f32>,
  @location(2) normal: vec3<f32>,
  @location(3) tint: vec4<f32>,
  @location(4) life: vec3<f32>,
  @location(5) @interpolate(flat) pickColor: vec3<f32>,
  ${shellTransition ? '@location(6) @interpolate(flat) shellRetention: f32,' : ''}
};

@vertex fn vertexMain(
  @builtin(instance_index) instanceIndex: u32,
  @location(0) hullVertex: f32,
  @location(1) instanceTreeRow: f32
) -> HullVaryings {
  var output: HullVaryings;
  output.position = TREE_CULLED;
  let row = u32(instanceTreeRow + 0.5);
  let life = treeReadLife(treeState, row);
  if (life.growth <= 0.0 || life.foliage <= 0.0 || life.coverage <= 0.0 || life.decay >= 1.0) {
    return output;
  }
  var first = 0;
  for (var i = 1; i < ${LAST_STAGE}; i++) {
    if (life.growth > stages[i]) { first = i; }
  }
  let t = clamp((life.growth - stages[first]) / (stages[first + 1] - stages[first]), 0.0, 1.0);
  let count = i32(treePhotoreal.look.x);
  let index = i32(hullVertex);
  let x = 2 + 2 * (index % count);
  let y = (index / count) * ${STAGE_COUNT} + first;
  let info = mix(textureLoad(treeHull, vec2<i32>(0, y), 0), textureLoad(treeHull, vec2<i32>(0, y + 1), 0), t);
  if (info.x <= 0.0) { return output; }
  let samplePoint = mix(textureLoad(treeHull, vec2<i32>(x, y), 0), textureLoad(treeHull, vec2<i32>(x, y + 1), 0), t);
  let sampleNormal = mix(textureLoad(treeHull, vec2<i32>(x + 1, y), 0), textureLoad(treeHull, vec2<i32>(x + 1, y + 1), 0), t);
  let place = treeReadPlace(treeState, row, life.growth);
  let local = treeToMetres(samplePoint.xyz, place.size);
  let fork = treePhotoreal.shape.x;
  let height = select((place.size.z - place.size.w) / (1.0 - fork), place.size.w / fork, samplePoint.z < fork);
  let normal = normalize(sampleNormal.xyz / max(vec3<f32>(place.size.xy, height), vec3<f32>(0.01)));
  let posed = vec3<f32>(local.xy, local.z - max(local.z, 0.0) * smoothstep(0.15, 1.0, life.damage) * 0.22);
  let moved = treeMovePoint(treeTurnYaw(posed, place.yaw), place, life, treeLimbs, 0u, 0u);
  let projection = treeProject(moved.point, place);
  if (!treeIsShadowPass() && splatBehindGlobe(projection.commonPosition.xyz)) { return output; }
  output.position = treeShadowPosition(projection.clipPosition, projection.commonPosition);
  output.commonPosition = projection.commonPosition.xyz;
  output.local = local;
  output.normal = splatProjectNormal(moved.turn * treeTurnYaw(normal, place.yaw), projection.frame);
  let tint = treeStateTexel(treeState, row, ${CANOPY}u);
  let alive = (1.0 - smoothstep(samplePoint.w - 0.05, samplePoint.w + 0.15, life.damage)) * (1.0 - 0.33 * life.damage);
  let tintWithCoverage = vec4<f32>(pow(tint.rgb, vec3<f32>(2.2)), tint.a * life.coverage * life.foliage * alive *
    smoothstep(0.0, 0.16, info.x) * (1.0 - smoothstep(0.0, 0.5, life.decay)));
  output.tint = treeFilterVertexColor(tintWithCoverage, instanceIndex);
  output.life = vec3<f32>(life.health, life.flush, sampleNormal.w);
  output.pickColor = picking_getPickingColorFromIndex(instanceIndex);
  ${shellTransition ? `output.shellRetention = treeStateTexel(treeState, row, ${CROP_DROPPED}u).z;` : ''}
  return output;
}

@fragment fn fragmentMain(input: HullVaryings) -> @location(0) vec4<f32> {
  let grain = treeHash(floor(input.local * 6.0));
  let pores = treeHash(floor(input.local * 22.0) + 0.5);
  if (pores >= input.tint.a * mix(0.72, 1.33, grain)) { discard; }
  if (treeIsShadowPass()) { return treeShadowDepth(input.position.z); }
  ${shellTransition ? 'if (input.shellRetention > 0.0 && !treeShellCoversPixel(input.position.xy, input.shellRetention)) { discard; }' : ''}
  let openness = mix(0.56, 1.0, input.life.z * 0.4 + grain * 0.6);
  var color = mix(input.tint.rgb * vec3<f32>(1.0, 0.68, 0.32), input.tint.rgb, input.life.x);
  color = mix(color, color * vec3<f32>(1.27, 1.46, 0.76), input.life.y * grain);
  let lit = treeShadeMaterial(color, normalize(input.normal), input.commonPosition, openness, 0.18);
  return treeOutput(lit, layer.opacity, input.pickColor);
}
`
  };
}

/** Instanced fitted foliage, using the same state, placement and lighting as individual leaves. */
export class TreeShellLayer<DataT> extends TreePhotorealPrimitiveLayer<DataT> {
  static layerName = 'TreeShellLayer';
  static instanceColorFilters = true;

  declare state: TreePhotorealPrimitiveLayer<DataT>['state'] & {hull?: Texture};

  private get usesWebglShadowShader(): boolean {
    // Extensions can read or modify the vertex outputs, even in a shadow pass.
    return (
      this.context.device.type === 'webgl' &&
      this.props._shadowPass === 'only' &&
      this.props.extensions.length === 0
    );
  }

  protected readsShadowMaps(): boolean {
    return !this.usesWebglShadowShader && super.readsShadowMaps();
  }

  protected createModel(): Model {
    const mesh = getTreeShellMesh(
      this.props.template,
      this.props.lod,
      this.props._shadowPass === 'only'
    );
    this.state.hull = this.context.device.createTexture({
      id: `${this.id}-hull`,
      width: mesh.width,
      height: mesh.height,
      format: 'rgba32float',
      data: mesh.data,
      mipLevels: 1,
      sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
    });
    const shellTransition = this.props.lod === 0 && this.props._shadowPass === 'skip';
    const shaders =
      this.context.device.type === 'webgpu'
        ? getShellWgslShaders(shellTransition)
        : {
            vs: vertex,
            fs: fragment,
            defines: this.usesWebglShadowShader
              ? {TREE_SHELL_SHADOW_ONLY: 1}
              : shellTransition
                ? {TREE_SHELL_TRANSITION: 1}
                : {},
            modules: [project32, picking, phongMaterial, treePhotoreal]
          };
    return new Model(this.context.device, {
      ...this.getShaders(shaders),
      id: this.id,
      geometry: new Geometry({
        topology: 'triangle-list',
        vertexCount: mesh.vertexCount,
        attributes: {
          hullVertex: {size: 1, value: Float32Array.from({length: mesh.vertexCount}, (_, i) => i)}
        },
        indices: {size: 1, value: mesh.indices}
      }),
      indexCount: mesh.indices.length,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      isInstanced: true
    });
  }

  protected onModelReleased(): void {
    this.state.hull?.destroy();
    this.state.hull = undefined;
  }

  protected setTemplateBindings(model: Model): void {
    if (this.state.hull) model.setBindings({treeHull: this.state.hull});
  }

  protected prepareDraw(): Pick<TreePhotorealUniforms, 'shape' | 'look'> {
    const {template, lod} = this.props;
    return {
      shape: [template.forkZ, template.referenceHeight, 0, 0],
      look: [
        getTreeShellMesh(template, lod, this.props._shadowPass === 'only').verticesPerHull,
        lod,
        this.state.shadowStrength,
        0
      ]
    };
  }
}
