// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  createIterable,
  type Accessor,
  type DefaultProps,
  type UpdateParameters
} from '@deck.gl/core';
import {SimpleMeshLayer, type SimpleMeshLayerProps} from '@deck.gl/mesh-layers';
import type {ShaderModule} from '@luma.gl/shadertools';
import {SPLAT_DEFORMATION_GLSL, SPLAT_DEFORMATION_WGSL} from '../splat-layer/splat-deformation';
import {SPLAT_GLOBE_GLSL, SPLAT_GLOBE_WGSL} from '../splat-layer/splat-globe';
import {prepareShadowDraw} from '../splat-layer/splat-shadow';
import {WGSL_FILTER_COLOR_ANCHOR} from '../selection-pulse-extension/selection-pulse-shaders';
import {getLayerWind} from '../wind-effect/wind-effect';
import {wind} from '../wind-effect/wind-module';

type WindProps<DataT> = {
  /** [tree height in metres, stable wind phase, flex multiplier]. */
  getWind: Accessor<DataT, [number, number, number]>;
  /** Physical bole radius at its first branch join; negative disables the morph. */
  getStemRadius: Accessor<DataT, number>;
  /** Physical root-to-first-branch height for the connected woody mesh; negative disables it. */
  getRootLength: Accessor<DataT, number>;
  getCoverageWeight: Accessor<DataT, number>;
  getCoverageRange: Accessor<DataT, [number, number]>;
  /** Stable branch-only coverage; boles continue to use getCoverageWeight. */
  branchCoverage: number;
  woodMorph: boolean;
  /** Bend with the deck's `WindEffect`; `false` keeps this layer still. */
  windEnabled: boolean;
  doubleSided: boolean;
};
const UNIFORM_DECLARATION = [
  'layout(std140) uniform treeWindUniforms {',
  '  float twoSided;',
  '  float woodMorph;',
  '  float branchCoverage;',
  '} treeWind;'
].join(String.fromCharCode(10));
const TREE_WIND = {
  name: 'treeWind',
  vs: UNIFORM_DECLARATION,
  fs: UNIFORM_DECLARATION,
  source: `struct treeWindUniforms {
  twoSided: f32,
  woodMorph: f32,
  branchCoverage: f32
};
@group(0) @binding(auto) var<uniform> treeWind: treeWindUniforms;`,
  uniformTypes: {
    twoSided: 'f32',
    woodMorph: 'f32',
    branchCoverage: 'f32'
  }
} as const satisfies ShaderModule<{
  twoSided: number;
  woodMorph: number;
  branchCoverage: number;
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
// Coverage must run before host depth-only shortcuts, which enter at the default order.
const TREE_COVERAGE = {
  name: 'treeCoverageFilter',
  fs: 'in vec2 treeCoverage;\nin vec3 treeDitherPosition;\nin vec2 treeDitherTexCoord;',
  inject: {
    'fs:#main-start': {
      order: -100,
      injection: `if (treeCoverage.x > 0.0 || treeCoverage.y < 1.0) {
        float coverageNoise = fract(sin(dot(floor(treeDitherPosition * 96.0), vec3(12.9898,78.233,37.719))) * 43758.5453);
        if (coverageNoise < treeCoverage.x || coverageNoise >= treeCoverage.y) discard;
      }
      if (treeDitherTexCoord.y < 0.5 && treeWind.branchCoverage < 1.0) {
        float branchNoise = fract(sin(dot(floor(treeDitherPosition * 96.0) + vec3(19.19,47.23,73.31), vec3(39.3468,11.135,83.155))) * 24634.6345);
        if (branchNoise >= treeWind.branchCoverage) discard;
      }`
    },
    // deck.gl 9.4's SimpleMeshLayer applies DECKGL_FILTER_COLOR before lighting, which would shade
    // the depth its shadow module packs into the color. Write the packed depth after lighting.
    'fs:#main-end': `
#ifdef MODULE_SHADOW
  if (shadow.drawShadowMap) fragColor = shadow_filterShadowColor(vec4(0.0));
#endif
`
  }
} as const;

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
  if (wind.strength > 0.0) {
  float treeHeight = max(instanceTreeWind.x, 0.001);
  vec2 treeWave = vec2(wind.wave.x * instanceTreeWind.w + wind.wave.y * instanceTreeWind.z, wind.wave.z * instanceTreeCrownWind.y + wind.wave.w * instanceTreeCrownWind.x);
  mat3 treeJacobian = splatDeform(pos, treeHeight, wind.strength * instanceTreeWind.y, treeWave, wind.axis, mat2(wind.mode), instanceTreeWind.zw, wind.branch);
  treeNormal = splatDeformNormal(treeJacobian, treeNormal);
  }
`;
const WGSL_WIND = `
  let treeSquaredScale = max(vec3<f32>(dot(attributes.instanceModelMatrixCol0, attributes.instanceModelMatrixCol0), dot(attributes.instanceModelMatrixCol1, attributes.instanceModelMatrixCol1), dot(attributes.instanceModelMatrixCol2, attributes.instanceModelMatrixCol2)), vec3<f32>(0.000001));
  var treeNormal = instanceModelMatrix * (treeLocalNormal / treeSquaredScale);
  if (wind.strength > 0.0) {
  let treeHeight = max(attributes.instanceTreeWind.x, 0.001);
  let treeWave = vec2<f32>(wind.wave.x * attributes.instanceTreeWind.w + wind.wave.y * attributes.instanceTreeWind.z, wind.wave.z * attributes.instanceTreeCrownWind.y + wind.wave.w * attributes.instanceTreeCrownWind.x);
  let treeDeformation = splatDeform(meshPosition, treeHeight, wind.strength * attributes.instanceTreeWind.y, treeWave, wind.axis, mat2x2<f32>(wind.mode.xy, wind.mode.zw), attributes.instanceTreeWind.zw, wind.branch);
  meshPosition = treeDeformation.position;
  treeNormal = splatDeformNormal(treeDeformation.jacobian, treeNormal);
  }
`;

// SimpleMeshLayer rotates its metre offsets and normals by deck.gl's globe frame, which points west
// and south. Trees use the east-north-up frame of their splat canopies instead, so wood, crops and
// foliage keep one pose, and the same pose as in Web Mercator views. The composed (metre-offset)
// branch sets normals before geometry.position, so both branches orient them at the anchor. Each
// vertex projects that anchor once: SwiftShader compiles and runs both branches.
const GLSL_ANCHOR = `
  vec3 treeAnchor = project_position(instancePositions, instancePositions64Low);
  mat3 treeFrame = splatTangentFrame(treeAnchor);`;
const WGSL_ANCHOR = `
  let treeAnchor = project_position_vec3_f64(attributes.instancePositions, attributes.instancePositions64Low);
  let treeFrame = splatTangentFrame(treeAnchor);`;
const GLSL_OFFSET_PROJECTION =
  'project_position_to_clipspace(instancePositions, instancePositions64Low, pos, position_commonspace)';
const WGSL_OFFSET_PROJECTION =
  'project_position_to_clipspace_and_commonspace(\n      attributes.instancePositions,\n      attributes.instancePositions64Low,\n      project_size_vec3(meshPosition)\n    )';

/** Shared shader deformation for trunks, crowns and attached crops. */
export class TreeMeshLayer<DataT> extends SimpleMeshLayer<DataT, WindProps<DataT>> {
  static layerName = 'TreeMeshLayer';
  /**
   * The vertex attributes fill the 16 slots WebGL2 and WebGPU guarantee: per-object color filters
   * such as `SelectionPulseExtension` read their data by instance index. The WGSL exposes
   * `WGSL_FILTER_COLOR_ANCHOR`.
   */
  static instanceColorFilters = true;
  static defaultProps: DefaultProps<SimpleMeshLayerProps<unknown> & WindProps<unknown>> = {
    getCoverageWeight: {type: 'accessor', value: 1},
    getCoverageRange: {type: 'accessor', value: [0, 1]},
    branchCoverage: {type: 'number', value: 1, min: 0, max: 1},
    getRootLength: {type: 'accessor', value: -1},
    getStemRadius: {type: 'accessor', value: -1},
    getWind: {type: 'accessor', value: [1, 0, 1]},
    woodMorph: false,
    windEnabled: true,
    doubleSided: false
  };

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceTreeWindData: {
        size: 6,
        // Meter-offset positions occupy two WebGPU slots for high/low precision. Pack the
        // tree-specific columns together so MapView tree scenes remain below WebGPU's
        // eight-vertex-buffer pipeline limit.
        bufferGroup: 'tree-instance-data',
        accessor: 'getWind',
        update: this.calculateTreeWind,
        shaderAttributes: {
          instanceTreeWind: {size: 4, elementOffset: 0},
          instanceTreeCrownWind: {size: 2, elementOffset: 4}
        }
      },
      instanceTreeCoverage: {
        size: 2,
        bufferGroup: 'tree-instance-data',
        accessor: ['getCoverageWeight', 'getCoverageRange'],
        update: this.calculateTreeCoverage
      },
      instanceRootLength: {
        size: 1,
        bufferGroup: 'tree-instance-data',
        accessor: 'getRootLength',
        defaultValue: -1
      },
      instanceStemRadius: {
        size: 1,
        bufferGroup: 'tree-instance-data',
        accessor: 'getStemRadius',
        defaultValue: -1
      }
    });
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    // This derived attribute combines two accessors. Constants do not pass through
    // the attribute manager's single-accessor value path and need invalidation. Compare constant
    // ranges by value: composite parents pass a new literal every render.
    for (const name of ['getCoverageWeight', 'getCoverageRange'] as const) {
      const value = params.props[name] as unknown;
      const old = params.oldProps[name] as unknown;
      if (
        typeof value !== 'function' &&
        value !== old &&
        !(
          Array.isArray(value) &&
          Array.isArray(old) &&
          value.length === old.length &&
          value.every((item, i) => item === old[i])
        )
      ) {
        this.getAttributeManager()!.invalidate('instanceTreeCoverage');
        break;
      }
    }
  }

  getShaders() {
    const shaders = super.getShaders();
    if (this.context.device.type === 'webgpu') {
      const anchor = '    attributes.instanceTranslation;';
      if (!shaders.source.includes(anchor) || !shaders.source.includes(WGSL_OFFSET_PROJECTION))
        throw new Error('Unsupported SimpleMeshLayer WGSL wind anchor.');
      return {
        ...shaders,
        modules: [...shaders.modules, wind, TREE_WIND],
        source: `${SPLAT_DEFORMATION_WGSL}\n${SPLAT_GLOBE_WGSL}\n${shaders.source}`
          .replace(
            '  @location(10) instanceTranslation: vec3<f32>,',
            '  @location(10) instanceTranslation: vec3<f32>,\n  @location(11) instanceTreeWind: vec4<f32>,\n  @location(12) instanceStemRadius: f32,\n  @location(13) instanceRootLength: f32,\n  @location(14) instanceTreeCrownWind: vec2<f32>,\n  @location(15) instanceTreeCoverage: vec2<f32>,'
          )
          .replace(
            '  varyings.texCoords = attributes.texCoords;',
            `  var vertexColor = varyings.color;\n  let instanceIndex = attributes.instanceIndex;\n  ${WGSL_FILTER_COLOR_ANCHOR}\n  varyings.color = vertexColor;\n  varyings.texCoords = attributes.texCoords;`
          )
          .replace(
            '@location(4) pickingColor: vec3<f32>,',
            '@location(4) pickingColor: vec3<f32>,\n  @location(5) treeCoverage: vec2<f32>,\n  @location(6) treeDitherPosition: vec3<f32>,\n  @location(7) treeDitherTexCoord: vec2<f32>,'
          )
          .replace(
            '  return varyings;',
            '  varyings.treeCoverage = attributes.instanceTreeCoverage;\n  varyings.treeDitherPosition = instanceModelMatrix * treePosition + fract(attributes.instancePositions * vec3<f32>(0.1031,0.11369,0.13787));\n  varyings.treeDitherTexCoord = attributes.texCoords;\n  return varyings;'
          )
          .replace(
            '  geometry.uv = varyings.texCoords;',
            '  if (varyings.treeCoverage.x > 0.0 || varyings.treeCoverage.y < 1.0) { let coverageNoise = fract(sin(dot(floor(varyings.treeDitherPosition * 96.0), vec3<f32>(12.9898,78.233,37.719))) * 43758.5453); if (coverageNoise < varyings.treeCoverage.x || coverageNoise >= varyings.treeCoverage.y) { discard; } }\n  if (varyings.treeDitherTexCoord.y < 0.5 && treeWind.branchCoverage < 1.0) { let branchNoise = fract(sin(dot(floor(varyings.treeDitherPosition * 96.0) + vec3<f32>(19.19,47.23,73.31), vec3<f32>(39.3468,11.135,83.155))) * 24634.6345); if (branchNoise >= treeWind.branchCoverage) { discard; } }\n  geometry.uv = varyings.texCoords;'
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
          .replace(anchor, `${anchor}\n${WGSL_WIND}\n${WGSL_ANCHOR}`)
          .replace(
            WGSL_OFFSET_PROJECTION,
            'splatProjectOffset(treeAnchor, treeFrame, project_size_vec3(meshPosition))'
          )
          .replaceAll(
            'project_normal(instanceModelMatrix * attributes.normals)',
            'splatProjectNormal(treeNormal, treeFrame)'
          )
      };
    }
    const anchor =
      'vec3 pos = (instanceModelMatrix * positions) * simpleMesh.sizeScale + instanceTranslation;';
    if (!shaders.vs.includes(anchor) || !shaders.vs.includes(GLSL_OFFSET_PROJECTION))
      throw new Error('Unsupported SimpleMeshLayer GLSL wind anchor.');
    return {
      ...shaders,
      modules: [...shaders.modules, wind, TREE_WIND, TREE_COVERAGE],
      fs: shaders.fs.replace(
        'vec3 lightColor =',
        'if (treeWind.twoSided > 0.5 && !gl_FrontFacing) normal = -normal;\nvec3 lightColor ='
      ),
      vs: shaders.vs
        .replace(
          'void main(void) {',
          `in vec2 instanceTreeCoverage;\nout vec2 treeCoverage;\nout vec3 treeDitherPosition;\nout vec2 treeDitherTexCoord;\n${SPLAT_DEFORMATION_GLSL}\n${SPLAT_GLOBE_GLSL}\nvoid main(void) {\n  treeCoverage = instanceTreeCoverage;\n  treeDitherTexCoord = texCoords;`
        )
        .replace(
          'in vec3 instanceTranslation;',
          'in vec3 instanceTranslation;\nin vec4 instanceTreeWind;\nin vec2 instanceTreeCrownWind;\nin float instanceStemRadius;\nin float instanceRootLength;'
        )
        .replace(
          anchor,
          `${GLSL_STEM}\n treeDitherPosition = instanceModelMatrix * treePosition + fract(instancePositions * vec3(0.1031,0.11369,0.13787));\n${anchor.replace('instanceModelMatrix * positions', 'instanceModelMatrix * treePosition')}\n${GLSL_WIND}\n${GLSL_ANCHOR}`
        )
        .replace(
          GLSL_OFFSET_PROJECTION,
          'splatProjectOffset(treeAnchor, treeFrame, pos, position_commonspace)'
        )
        .replaceAll(
          'project_normal(instanceModelMatrix * normals)',
          'splatProjectNormal(treeNormal, treeFrame)'
        )
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

  draw(params) {
    if (params.shaderModuleProps?.shadow?.drawToShadowMap && !prepareShadowDraw(this)) return;
    // Shadow passes receive no effect props: resolve the deck's WindEffect here for every pass.
    const {wind: windProps, animated} = getLayerWind(this, this.props.windEnabled);
    this.state.model?.shaderInputs.setProps({
      wind: windProps,
      treeWind: {
        woodMorph: this.props.woodMorph ? 1 : 0,
        branchCoverage: this.props.branchCoverage,
        twoSided: this.props.doubleSided ? 1 : 0
      }
    });
    super.draw(params);
    if (animated) this.setNeedsRedraw();
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
