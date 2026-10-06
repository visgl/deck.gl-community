// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Accessor, DefaultProps} from '@deck.gl/core';
import {SimpleMeshLayer, type SimpleMeshLayerProps} from '@deck.gl/mesh-layers';
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL, SPLAT_DEFORMATION_WGSL} from '../splat-layer/splat-deformation';

type WindProps<DataT> = {
  /** [tree height in metres, stable wind phase, flex multiplier]. */
  getWind: Accessor<DataT, [number, number, number]>;
  /** Physical bole radius at its first branch join; negative disables the morph. */
  getStemRadius: Accessor<DataT, number>;
  /** Physical root-to-first-branch height for the connected woody mesh; negative disables it. */
  getRootLength: Accessor<DataT, number>;
  windStrength: number;
  windTime: number | null;
  doubleSided: boolean;
};
const UNIFORM_DECLARATION = [
  'layout(std140) uniform treeWindUniforms {',
  '  float strength;',
  '  float time;',
  '  float twoSided;',
  '} treeWind;'
].join(String.fromCharCode(10));
const TREE_WIND = {
  name: 'treeWind',
  vs: UNIFORM_DECLARATION,
  fs: UNIFORM_DECLARATION,
  source: `struct treeWindUniforms {
  strength: f32,
  time: f32,
  twoSided: f32
};
@group(0) @binding(auto) var<uniform> treeWind: treeWindUniforms;`,
  uniformTypes: {strength: 'f32', time: 'f32', twoSided: 'f32'}
} as const satisfies ShaderModule<{strength: number; time: number; twoSided: number}>;

const GLSL_STEM = `
  vec3 treePosition = positions;
  vec3 treeLocalNormal = normals;
  if (instanceRootLength >= 0.0 && texCoords.y > 0.5 && treePosition.z < 0.22) {
    float rootScale = max(instanceRootLength / (1.22 * max(length(instanceModelMatrixCol2), 0.000001)), 0.000001);
    treePosition.z = 0.22 + (treePosition.z - 0.22) * rootScale;
    treeLocalNormal.z /= rootScale;
  }
  if (instanceStemRadius >= 0.0 && texCoords.x > 0.5) {
    vec2 treeScale = max(vec2(length(instanceModelMatrixCol0), length(instanceModelMatrixCol1)), vec2(0.000001));
    vec2 treeTarget = instanceStemRadius / (treeScale * 0.06);
    float treeT = clamp((positions.z - 0.22) / 0.2, 0.0, 1.0);
    float treeBlend = 1.0 - treeT * treeT * (3.0 - 2.0 * treeT);
    float treeDerivative = -6.0 * treeT * (1.0 - treeT) / 0.2;
    vec2 treeFactor = max(mix(vec2(1.0), treeTarget, treeBlend), vec2(0.000001));
    treePosition.xy *= treeFactor;
    treeLocalNormal.xy /= treeFactor;
    treeLocalNormal.z -= dot(treeLocalNormal.xy, positions.xy * (treeTarget - 1.0) * treeDerivative);
  }
`;
const WGSL_STEM = `
  var treePosition = attributes.positions;
  var treeLocalNormal = attributes.normals;
  if (attributes.instanceRootLength >= 0.0 && attributes.texCoords.y > 0.5 && treePosition.z < 0.22) {
    let rootScale = max(attributes.instanceRootLength / (1.22 * max(length(attributes.instanceModelMatrixCol2), 0.000001)), 0.000001);
    treePosition.z = 0.22 + (treePosition.z - 0.22) * rootScale;
    treeLocalNormal.z /= rootScale;
  }
  if (attributes.instanceStemRadius >= 0.0 && attributes.texCoords.x > 0.5) {
    let treeScale = max(vec2<f32>(length(attributes.instanceModelMatrixCol0), length(attributes.instanceModelMatrixCol1)), vec2<f32>(0.000001));
    let treeTarget = attributes.instanceStemRadius / (treeScale * 0.06);
    let treeT = clamp((attributes.positions.z - 0.22) / 0.2, 0.0, 1.0);
    let treeBlend = 1.0 - treeT * treeT * (3.0 - 2.0 * treeT);
    let treeDerivative = -6.0 * treeT * (1.0 - treeT) / 0.2;
    let treeFactor = max(mix(vec2<f32>(1.0), treeTarget, treeBlend), vec2<f32>(0.000001));
    treePosition = vec3<f32>(treePosition.xy * treeFactor, treePosition.z);
    treeLocalNormal = vec3<f32>(treeLocalNormal.xy / treeFactor, treeLocalNormal.z);
    treeLocalNormal.z -= dot(treeLocalNormal.xy, attributes.positions.xy * (treeTarget - 1.0) * treeDerivative);
  }
`;

const GLSL_WIND = `
  vec3 treeSquaredScale = max(vec3(dot(instanceModelMatrixCol0, instanceModelMatrixCol0), dot(instanceModelMatrixCol1, instanceModelMatrixCol1), dot(instanceModelMatrixCol2, instanceModelMatrixCol2)), vec3(0.000001));
  vec3 treeNormal = instanceModelMatrix * (treeLocalNormal / treeSquaredScale);
  if (treeWind.strength > 0.0) {
  float treeHeight = max(instanceTreeWind.x, 0.001);
  vec2 treeWave = vec2(sin(treeWind.time * 1.6 + instanceTreeWind.y), sin(treeWind.time * 3.2 + instanceTreeWind.y * 1.7));
  mat3 treeJacobian = splatDeform(pos, treeHeight, treeWind.strength * instanceTreeWind.z, treeWave);
  treeNormal = splatDeformNormal(treeJacobian, treeNormal);
  }
`;
const WGSL_WIND = `
  let treeSquaredScale = max(vec3<f32>(dot(attributes.instanceModelMatrixCol0, attributes.instanceModelMatrixCol0), dot(attributes.instanceModelMatrixCol1, attributes.instanceModelMatrixCol1), dot(attributes.instanceModelMatrixCol2, attributes.instanceModelMatrixCol2)), vec3<f32>(0.000001));
  var treeNormal = instanceModelMatrix * (treeLocalNormal / treeSquaredScale);
  if (treeWind.strength > 0.0) {
  let treeHeight = max(attributes.instanceTreeWind.x, 0.001);
  let treeWave = vec2<f32>(sin(treeWind.time * 1.6 + attributes.instanceTreeWind.y), sin(treeWind.time * 3.2 + attributes.instanceTreeWind.y * 1.7));
  let treeDeformation = splatDeform(meshPosition, treeHeight, treeWind.strength * attributes.instanceTreeWind.z, treeWave);
  meshPosition = treeDeformation.position;
  treeNormal = splatDeformNormal(treeDeformation.jacobian, treeNormal);
  }
`;

/** Shared shader deformation for trunks, crowns and attached crops, including picking/shadows. */
export class TreeMeshLayer<DataT> extends SimpleMeshLayer<DataT, WindProps<DataT>> {
  static layerName = 'TreeMeshLayer';
  static defaultProps: DefaultProps<SimpleMeshLayerProps<unknown> & WindProps<unknown>> = {
    getRootLength: {type: 'accessor', value: -1},
    getStemRadius: {type: 'accessor', value: -1},
    getWind: {type: 'accessor', value: [1, 0, 1]},
    windStrength: 0,
    windTime: null,
    doubleSided: false
  };

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceTreeWind: {size: 3, accessor: 'getWind', defaultValue: [1, 0, 1]},
      instanceRootLength: {size: 1, accessor: 'getRootLength', defaultValue: -1},
      instanceStemRadius: {size: 1, accessor: 'getStemRadius', defaultValue: -1}
    });
  }

  getShaders() {
    const shaders = super.getShaders();
    if (this.context.device.type === 'webgpu') {
      const anchor = '    attributes.instanceTranslation;';
      if (!shaders.source.includes(anchor))
        throw new Error('Unsupported SimpleMeshLayer WGSL wind anchor.');
      return {
        ...shaders,
        modules: [...shaders.modules, TREE_WIND],
        source: `${SPLAT_DEFORMATION_WGSL}\n${shaders.source}`
          .replace(
            '  @location(10) instanceTranslation: vec3<f32>,',
            '  @location(10) instanceTranslation: vec3<f32>,\n  @location(11) instanceTreeWind: vec3<f32>,\n  @location(12) instanceStemRadius: f32,\n  @location(13) instanceRootLength: f32,'
          )
          .replace('  let meshPosition =', `${WGSL_STEM}\n  var meshPosition =`)
          .replace(
            '(instanceModelMatrix * attributes.positions)',
            '(instanceModelMatrix * treePosition)'
          )
          .replace(
            'fn fragmentMain(varyings: Varyings)',
            'fn fragmentMain(varyings: Varyings, @builtin(front_facing) frontFacing: bool)'
          )
          .replace(
            '  color = vec4<f32>(',
            '  if (treeWind.twoSided > 0.5 && !frontFacing) { normal = -normal; }\n  color = vec4<f32>('
          )
          .replace(anchor, `${anchor}\n${WGSL_WIND}`)
          .replaceAll(
            'project_normal(instanceModelMatrix * attributes.normals)',
            'project_normal(treeNormal)'
          )
      };
    }
    const anchor =
      'vec3 pos = (instanceModelMatrix * positions) * simpleMesh.sizeScale + instanceTranslation;';
    if (!shaders.vs.includes(anchor))
      throw new Error('Unsupported SimpleMeshLayer GLSL wind anchor.');
    return {
      ...shaders,
      modules: [...shaders.modules, TREE_WIND],
      // Filter the final shaded color. In a shadow pass the filter writes packed
      // depth; lighting or opacity must never modify those RGBA bytes afterward.
      fs: shaders.fs
        .replace('  DECKGL_FILTER_COLOR(color, geometry);', '')
        .replace(
          'vec3 lightColor =',
          'if (treeWind.twoSided > 0.5 && !gl_FrontFacing) normal = -normal;\nvec3 lightColor ='
        )
        .replace(
          'fragColor = vec4(lightColor, color.a * layer.opacity);',
          'color = vec4(lightColor, color.a * layer.opacity);\n  DECKGL_FILTER_COLOR(color, geometry);\n  fragColor = color;'
        ),
      vs: shaders.vs
        .replace('void main(void) {', `${SPLAT_DEFORMATION_GLSL}\nvoid main(void) {`)
        .replace(
          'in vec3 instanceTranslation;',
          'in vec3 instanceTranslation;\nin vec3 instanceTreeWind;\nin float instanceStemRadius;\nin float instanceRootLength;'
        )
        .replace(
          anchor,
          `${GLSL_STEM}\n${anchor.replace('instanceModelMatrix * positions', 'instanceModelMatrix * treePosition')}\n${GLSL_WIND}`
        )
        .replaceAll('project_normal(instanceModelMatrix * normals)', 'project_normal(treeNormal)')
    };
  }

  draw(params) {
    const {windStrength, windTime} = this.props;
    this.state.model?.shaderInputs.setProps({
      treeWind: {
        strength: windStrength,
        time: windTime ?? this.context.timeline.getTime() / 1000,
        twoSided: this.props.doubleSided ? 1 : 0
      }
    });
    super.draw(params);
    if (windStrength > 0 && windTime === null) this.setNeedsRedraw();
  }
}
