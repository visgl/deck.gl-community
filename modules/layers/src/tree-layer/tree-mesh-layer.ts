// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {createIterable, type Accessor, type DefaultProps} from '@deck.gl/core';
import {SimpleMeshLayer, type SimpleMeshLayerProps} from '@deck.gl/mesh-layers';
import type {Model} from '@luma.gl/engine';
import {getPickingShadowProps} from '../splat-layer/splat-picking-shadow';
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL, SPLAT_DEFORMATION_WGSL} from '../splat-layer/splat-deformation';

type WindProps<DataT> = {
  /** [tree height in metres, stable wind phase, flex multiplier]. */
  getWind: Accessor<DataT, [number, number, number]>;
  /** Physical bole radius at its first branch join; negative disables the morph. */
  getStemRadius: Accessor<DataT, number>;
  /** Physical root-to-first-branch height for the connected woody mesh; negative disables it. */
  getRootLength: Accessor<DataT, number>;
  getCoverageWeight: Accessor<DataT, number>;
  getCoverageRange: Accessor<DataT, [number, number]>;
  woodMorph: boolean;
  windStrength: number;
  windTime: number | null;
  doubleSided: boolean;
};
const UNIFORM_DECLARATION = [
  'layout(std140) uniform treeWindUniforms {',
  '  float strength;',
  '  float twoSided;',
  '  float woodMorph;',
  '  vec4 wave;',
  '} treeWind;'
].join(String.fromCharCode(10));
const TREE_WIND = {
  name: 'treeWind',
  vs: UNIFORM_DECLARATION,
  fs: UNIFORM_DECLARATION,
  source: `struct treeWindUniforms {
  strength: f32,
  twoSided: f32,
  woodMorph: f32,
  wave: vec4<f32>
};
@group(0) @binding(auto) var<uniform> treeWind: treeWindUniforms;`,
  uniformTypes: {strength: 'f32', twoSided: 'f32', woodMorph: 'f32', wave: 'vec4<f32>'}
} as const satisfies ShaderModule<{
  strength: number;
  twoSided: number;
  woodMorph: number;
  wave: [number, number, number, number];
}>;

const GLSL_STEM = `
  vec3 treePosition = positions;
  vec3 treeLocalNormal = normals;
  if (treeWind.woodMorph > 0.5 && instanceStemRadius >= 0.0) {
    float crownScale = max(length(instanceModelMatrixCol0),length(instanceModelMatrixCol1));
    float radiusScale = instanceStemRadius/max(crownScale*0.06,0.000001);
    treePosition = colors + (positions-colors)*radiusScale;
  }
  if (instanceRootLength >= 0.0 && texCoords.y > 0.5 && treePosition.z < 0.22) {
    float rootScale = max(instanceRootLength / (1.22 * max(length(instanceModelMatrixCol2), 0.000001)), 0.000001);
    treePosition.z = 0.22 + (treePosition.z - 0.22) * rootScale;
    treeLocalNormal.z /= rootScale;
  }
  if (treeWind.woodMorph < 0.5 && instanceStemRadius >= 0.0 && texCoords.x > 0.5) {
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
  if (treeWind.woodMorph > 0.5 && attributes.instanceStemRadius >= 0.0) {
    let crownScale = max(length(attributes.instanceModelMatrixCol0),length(attributes.instanceModelMatrixCol1));
    let radiusScale = attributes.instanceStemRadius/max(crownScale*0.06,0.000001);
    treePosition = attributes.colors + (attributes.positions-attributes.colors)*radiusScale;
  }
  if (attributes.instanceRootLength >= 0.0 && attributes.texCoords.y > 0.5 && treePosition.z < 0.22) {
    let rootScale = max(attributes.instanceRootLength / (1.22 * max(length(attributes.instanceModelMatrixCol2), 0.000001)), 0.000001);
    treePosition.z = 0.22 + (treePosition.z - 0.22) * rootScale;
    treeLocalNormal.z /= rootScale;
  }
  if (treeWind.woodMorph < 0.5 && attributes.instanceStemRadius >= 0.0 && attributes.texCoords.x > 0.5) {
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
  vec2 treeWave = vec2(treeWind.wave.x * instanceTreeWind.w + treeWind.wave.y * instanceTreeWind.z, treeWind.wave.z * instanceTreeCrownWind.y + treeWind.wave.w * instanceTreeCrownWind.x);
  mat3 treeJacobian = splatDeform(pos, treeHeight, treeWind.strength * instanceTreeWind.y, treeWave);
  treeNormal = splatDeformNormal(treeJacobian, treeNormal);
  }
`;
const WGSL_WIND = `
  let treeSquaredScale = max(vec3<f32>(dot(attributes.instanceModelMatrixCol0, attributes.instanceModelMatrixCol0), dot(attributes.instanceModelMatrixCol1, attributes.instanceModelMatrixCol1), dot(attributes.instanceModelMatrixCol2, attributes.instanceModelMatrixCol2)), vec3<f32>(0.000001));
  var treeNormal = instanceModelMatrix * (treeLocalNormal / treeSquaredScale);
  if (treeWind.strength > 0.0) {
  let treeHeight = max(attributes.instanceTreeWind.x, 0.001);
  let treeWave = vec2<f32>(treeWind.wave.x * attributes.instanceTreeWind.w + treeWind.wave.y * attributes.instanceTreeWind.z, treeWind.wave.z * attributes.instanceTreeCrownWind.y + treeWind.wave.w * attributes.instanceTreeCrownWind.x);
  let treeDeformation = splatDeform(meshPosition, treeHeight, treeWind.strength * attributes.instanceTreeWind.y, treeWave);
  meshPosition = treeDeformation.position;
  treeNormal = splatDeformNormal(treeDeformation.jacobian, treeNormal);
  }
`;

/** Shared shader deformation for trunks, crowns and attached crops, including picking/shadows. */
export class TreeMeshLayer<DataT> extends SimpleMeshLayer<DataT, WindProps<DataT>> {
  static layerName = 'TreeMeshLayer';
  static defaultProps: DefaultProps<SimpleMeshLayerProps<unknown> & WindProps<unknown>> = {
    getCoverageWeight: {type: 'accessor', value: 1},
    getCoverageRange: {type: 'accessor', value: [0, 1]},
    getRootLength: {type: 'accessor', value: -1},
    getStemRadius: {type: 'accessor', value: -1},
    getWind: {type: 'accessor', value: [1, 0, 1]},
    woodMorph: false,
    windStrength: 0,
    windTime: null,
    doubleSided: false
  };

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceTreeWindData: {
        size: 6,
        accessor: 'getWind',
        update: this.calculateTreeWind,
        shaderAttributes: {
          instanceTreeWind: {size: 4, elementOffset: 0},
          instanceTreeCrownWind: {size: 2, elementOffset: 4}
        }
      },
      instanceTreeCoverage: {
        size: 2,
        accessor: ['getCoverageWeight', 'getCoverageRange'],
        update: this.calculateTreeCoverage
      },
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
            '  @location(10) instanceTranslation: vec3<f32>,\n  @location(11) instanceTreeWind: vec4<f32>,\n  @location(12) instanceStemRadius: f32,\n  @location(13) instanceRootLength: f32,\n  @location(14) instanceTreeCrownWind: vec2<f32>,\n  @location(15) instanceTreeCoverage: vec2<f32>,'
          )
          .replace(
            '@location(4) pickingColor: vec3<f32>,',
            '@location(4) pickingColor: vec3<f32>,\n  @location(5) treeCoverage: vec2<f32>,\n  @location(6) treeDitherPosition: vec3<f32>,'
          )
          .replace(
            '  return varyings;',
            '  varyings.treeCoverage = attributes.instanceTreeCoverage;\n  varyings.treeDitherPosition = instanceModelMatrix * treePosition;\n  return varyings;'
          )
          .replace(
            '  geometry.uv = varyings.texCoords;',
            '  if (varyings.treeCoverage.x > 0.0 || varyings.treeCoverage.y < 1.0) { let coverageNoise = fract(sin(dot(floor(varyings.treeDitherPosition * 40.0), vec3<f32>(12.9898,78.233,37.719))) * 43758.5453); if (coverageNoise < varyings.treeCoverage.x || coverageNoise >= varyings.treeCoverage.y) { discard; } }\n  geometry.uv = varyings.texCoords;'
          )
          .replace(
            'attributes.colors * attributes.instanceColors.rgb',
            'select(attributes.colors,vec3<f32>(1.0),treeWind.woodMorph > 0.5) * attributes.instanceColors.rgb'
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
        .replace(
          'void main(void) {',
          'in vec2 treeCoverage;\nin vec3 treeDitherPosition;\nvoid main(void) {\n  if (treeCoverage.x > 0.0 || treeCoverage.y < 1.0) { float coverageNoise=fract(sin(dot(floor(treeDitherPosition * 40.0),vec3(12.9898,78.233,37.719))) * 43758.5453); if(coverageNoise < treeCoverage.x || coverageNoise >= treeCoverage.y) discard; }'
        )
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
        .replace(
          'void main(void) {',
          `in vec2 instanceTreeCoverage;\nout vec2 treeCoverage;\n out vec3 treeDitherPosition;\n${SPLAT_DEFORMATION_GLSL}\nvoid main(void) {\n  treeCoverage = instanceTreeCoverage;`
        )
        .replace(
          'in vec3 instanceTranslation;',
          'in vec3 instanceTranslation;\nin vec4 instanceTreeWind;\nin vec2 instanceTreeCrownWind;\nin float instanceStemRadius;\nin float instanceRootLength;'
        )
        .replace(
          anchor,
          `${GLSL_STEM}\n treeDitherPosition = instanceModelMatrix * treePosition;\n${anchor.replace('instanceModelMatrix * positions', 'instanceModelMatrix * treePosition')}\n${GLSL_WIND}`
        )
        .replaceAll('project_normal(instanceModelMatrix * normals)', 'project_normal(treeNormal)')
        .replace(
          'colors * instanceColors.rgb',
          '(treeWind.woodMorph > 0.5 ? vec3(1.0) : colors) * instanceColors.rgb'
        )
    };
  }

  private calculateTreeCoverage(attribute, {startRow, endRow}) {
    const {iterable, objectInfo} = createIterable(this.props.data, startRow, endRow);
    for (const row of iterable) {
      objectInfo.index++;
      const get = accessor =>
        typeof accessor === 'function' ? accessor(row, objectInfo) : accessor;
      const weight = Math.max(0, Math.min(1, get(this.props.getCoverageWeight)));
      const range = get(this.props.getCoverageRange);
      attribute.value.set([range[0] * weight, range[1] * weight], objectInfo.index * 2);
    }
  }

  private calculateTreeWind(attribute, {startRow, endRow}) {
    const {iterable, objectInfo} = createIterable(this.props.data, startRow, endRow);
    for (const row of iterable) {
      objectInfo.index++;
      const wind =
        typeof this.props.getWind === 'function'
          ? this.props.getWind(row, objectInfo)
          : this.props.getWind;
      attribute.value.set(getTreeWindPhases(wind), objectInfo.index * 6);
    }
  }

  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]) {
    super.setShaderModuleProps(getPickingShadowProps(this, props));
  }

  draw(params) {
    const {windStrength, windTime} = this.props;
    const time = windTime ?? this.context.timeline.getTime() / 1000;
    this.state.model?.shaderInputs.setProps({
      treeWind: {
        strength: windStrength,
        woodMorph: this.props.woodMorph ? 1 : 0,
        wave: [
          Math.sin(time * 1.6),
          Math.cos(time * 1.6),
          Math.sin(time * 3.2),
          Math.cos(time * 3.2)
        ],
        twoSided: this.props.doubleSided ? 1 : 0
      }
    });
    super.draw(params);
    if (windStrength > 0 && windTime === null) this.setNeedsRedraw();
  }
}

/** Cache owner phases when attributes change; the animation clock supplies only four sines/cosines per draw. */
export function getTreeWindPhases([height, phase, flex]: readonly number[]): number[] {
  return [
    height,
    flex,
    Math.sin(phase),
    Math.cos(phase),
    Math.sin(phase * 1.7),
    Math.cos(phase * 1.7)
  ];
}
