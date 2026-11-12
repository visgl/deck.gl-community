// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * What every prop shares: light from the same `lighting` uniforms as `TreeLayer`, the same inline
 * filmic curve at the end of every fragment, shadow maps read through samplers of their own, fog, and
 * `PropMeshLayer`, the one custom layer they are all drawn with. A prop is a mesh, a program and the
 * values of its uniforms, so a factory only has to say what changes. Everything here is metres,
 * Cartesian, z up.
 */

import {
  COORDINATE_SYSTEM,
  Layer,
  picking,
  project32,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import {Buffer, type Texture} from '@luma.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import {lighting, type ShaderModule} from '@luma.gl/shadertools';
import type {StoryFog} from '../story/story-types';

/** A mesh of a prop, as plain arrays. `details` is a vec4 per vertex, for the program to use. */
export type PropMesh = {
  positions: Float32Array;
  normals: Float32Array;
  details: Float32Array;
  indices: Uint32Array;
};

/** The values of a program's uniform block: every field is a vec4. */
export type PropValues = Record<string, readonly number[]>;

/** GLSL of a prop, its uniform block and what it reads per instance. Made once, by identity. */
export type PropProgram = {
  name: string;
  vs: string;
  fs: string;
  /** Names of the vec4 fields of the uniform block named `name`. */
  fields?: readonly string[];
  /** Per-instance attributes, as `[name, size]`, in the order `instances` packs them. */
  instanceAttributes?: readonly (readonly [name: string, size: number])[];
  /** Vertices of a mesh that has none: drawn with `gl_VertexID`, with `indices` if any. */
  vertexCount?: number;
  /** It never asks for the key's visibility, so it has no sampler to bind. */
  ignoresShadow?: boolean;
};

const NO_VALUES: PropValues = {};

/** Worked-out uniform blocks, by program. */
const PROGRAM_BLOCKS = new WeakMap<PropProgram, ShaderModule<any>>();

function getProgramBlock(program: PropProgram): ShaderModule<any> | null {
  if (!program.fields) return null;
  let block = PROGRAM_BLOCKS.get(program);
  if (!block) {
    const body = program.fields.map(field => `  vec4 ${field};`).join('\n');
    const declaration = `layout(std140) uniform ${program.name}Uniforms {\n${body}\n} ${program.name};`;
    block = {
      name: program.name,
      vs: declaration,
      fs: declaration,
      uniformTypes: Object.fromEntries(program.fields.map(field => [field, 'vec4<f32>']))
    } as ShaderModule<any>;
    PROGRAM_BLOCKS.set(program, block);
  }
  return block;
}

const LOOK_DECLARATION = /* glsl */ `layout(std140) uniform propLookUniforms {
  vec4 shadow;
  vec4 fog;
  vec4 screen;
} propLook;`;

/** Per-draw values all props share. */
type PropLookUniforms = {
  /** The shadow color's alpha, 0 with no map to read. */
  shadow: [number, number, number, number];
  /** What fog turns a surface into, as linear light, and its density per metre. */
  fog: [number, number, number, number];
  /** Device pixels of a metre, a metre from the camera. */
  screen: [number, number, number, number];
};

const propLook = {
  name: 'propLook',
  vs: LOOK_DECLARATION,
  fs: LOOK_DECLARATION,
  uniformTypes: {shadow: 'vec4<f32>', fog: 'vec4<f32>', screen: 'vec4<f32>'}
} as const satisfies ShaderModule<PropLookUniforms>;

/**
 * Linear light that the filmic curve turns into this sRGB color (each 0-255), so a surface lost in fog
 * shows exactly the fog color asked for. The inverse of the curve in `PROP_FRAGMENT_CHUNK`.
 */
function getFogLight(color: ArrayLike<number>): [number, number, number] {
  const channel = (value: number): number => {
    const y = Math.min(0.999, Math.max(0, Math.min(1, value / 255)) ** 2.2);
    const a = 2.51 - 2.43 * y;
    const b = 0.03 - 0.59 * y;
    const c = -0.14 * y;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  };
  return [channel(color[0]), channel(color[1]), channel(color[2])];
}

const SHADOW_BLOCK = /* glsl */ `
layout(std140) uniform shadowUniforms {
  bool drawShadowMap;
  bool useShadowMap;
  vec4 color;
  highp int lightId;
  float lightCount;
  mat4 viewProjectionMatrix0;
  mat4 viewProjectionMatrix1;
  vec4 projectCenter0;
  vec4 projectCenter1;
} shadow;
`;

const SLIM_SHADOW_VS = /* glsl */ `${SHADOW_BLOCK}
vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  if (!shadow.drawShadowMap) return gl_Position;
  return project_common_position_to_clipspace(position_commonspace, shadow.viewProjectionMatrix0, shadow.projectCenter0);
}
`;

const SLIM_SHADOW_FS = /* glsl */ `${SHADOW_BLOCK}
vec4 shadow_filterShadowColor(vec4 color) {
  if (!shadow.drawShadowMap) return color;
  const vec4 bitPackShift = vec4(1.0, 255.0, 65025.0, 16581375.0);
  const vec4 bitMask = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  vec4 rgbaDepth = fract(gl_FragCoord.z * bitPackShift);
  return rgbaDepth - rgbaDepth.gbaa * bitMask;
}
`;

const SLIM_SHADOW_MODULES = new WeakMap<object, unknown>();

/**
 * deck.gl's shadow module without its samplers and its lookup: props read the map through their own
 * sampler, by the pixel, and shadow direct light alone. Its matrices and what it injects are the same,
 * and so is the depth it packs in a shadow pass. The stage has one map, so there is one matrix to use.
 */
function getSlimShadowModule<ModuleT extends {name: string}>(module: ModuleT): ModuleT {
  if (module.name !== 'shadow') return module;
  let slim = SLIM_SHADOW_MODULES.get(module) as ModuleT | undefined;
  if (!slim) {
    const {getUniforms} = module as unknown as {
      getUniforms: (...args: unknown[]) => Record<string, unknown>;
    };
    slim = {
      ...module,
      vs: SLIM_SHADOW_VS,
      fs: SLIM_SHADOW_FS,
      getUniforms: (...args: unknown[]) => {
        const {
          shadow_uShadowMap0: _map0,
          shadow_uShadowMap1: _map1,
          ...uniforms
        } = getUniforms(...args);
        return uniforms;
      }
    };
    SLIM_SHADOW_MODULES.set(module, slim);
  }
  return slim;
}

/** Declares what the vertex stage hands on for shadows, with `propShadowWrite`. */
export const PROP_VERTEX_CHUNK = /* glsl */ `
out float vPropMetre;
#ifdef MODULE_SHADOW
out vec3 vPropShadow;
#endif
void propShadowWrite(vec4 commonPosition) {
  vPropMetre = project_size(1.0);
#ifdef MODULE_SHADOW
  vec4 position = project_common_position_to_clipspace(
    commonPosition, shadow.viewProjectionMatrix0, shadow.projectCenter0
  );
  vPropShadow = (position.xyz / position.w + 1.0) * 0.5;
#endif
}

vec3 propTurn(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

float propHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

float propNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = p - cell;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(propHash(cell), propHash(cell + vec3(1.0, 0.0, 0.0)), f.x),
      mix(propHash(cell + vec3(0.0, 1.0, 0.0)), propHash(cell + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(propHash(cell + vec3(0.0, 0.0, 1.0)), propHash(cell + vec3(1.0, 0.0, 1.0)), f.x),
      mix(propHash(cell + vec3(0.0, 1.0, 1.0)), propHash(cell + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}
`;

const SHADOW_DISC_TAPS = 8;

function getShadowDisc(): string {
  const taps: string[] = [];
  for (let i = 0; i < SHADOW_DISC_TAPS; i++) {
    const radius = Math.sqrt((i + 0.5) / SHADOW_DISC_TAPS);
    const angle = i * 2.399963;
    taps.push(
      `vec2(${(radius * Math.cos(angle)).toFixed(4)}, ${(radius * Math.sin(angle)).toFixed(4)})`
    );
  }
  return `const vec2 PROP_SHADOW_DISC[${SHADOW_DISC_TAPS}] = vec2[${SHADOW_DISC_TAPS}](${taps.join(', ')});`;
}

/**
 * The fragment stage every prop shares: all in linear light until `propFilmic`, which is the same fit as
 * `TreeLayer`'s. `propLights` adds up direct light into `gDiffuse`, `gSpecular` and `gGlow`.
 */
export const PROP_FRAGMENT_CHUNK = /* glsl */ `
const float PROP_PI = 3.14159265;

// Standard deck.gl lights mean sRGB colors times intensity. Keep the intensity linear, and decode only
// the hue, so a warm low sun or a blue night stays the color it was given.
vec3 propLightColor(vec3 color) {
  float level = max(max(color.r, color.g), max(color.b, 1e-4));
  return pow(color / level, vec3(2.2)) * level;
}

vec3 propFilmic(vec3 x) {
  // Narkowicz's fit to the ACES curve, then display encoding.
  x = max(x, vec3(0.0));
  vec3 mapped = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return pow(mapped, vec3(1.0 / 2.2));
}

// The dimmer the light the less color an eye or a sensor sees: a red pot does not go black under the moon.
vec3 propNightAlbedo(vec3 albedo) {
  vec3 ambient = propLightColor(lighting.ambientColor);
  float level = dot(ambient, vec3(0.3, 0.55, 0.15));
  float night = 1.0 - smoothstep(0.05, 0.28, level);
  float grey = dot(albedo, vec3(0.3, 0.55, 0.15));
  return mix(albedo, vec3(grey) * 1.15, night * 0.85);
}

// Sky above, darker bounce from the ground below, from the standard ambient light.
vec3 propHemisphere(vec3 normal) {
  vec3 ambient = propLightColor(lighting.ambientColor);
  float sky = 0.5 + 0.5 * normal.z;
  return ambient * mix(vec3(0.44, 0.38, 0.28), vec3(0.94, 1.0, 1.1), sky * sky);
}

// What a mirror sees in this direction: the ambient light's color as a sky, paler and brighter toward the
// horizon, and the ground color below it.
vec3 propSkyColor(vec3 direction) {
  vec3 ambient = propLightColor(lighting.ambientColor);
  float height = direction.z;
  vec3 sky = ambient * mix(vec3(1.5, 1.4, 1.15), vec3(0.9, 1.0, 1.12), smoothstep(0.0, 0.55, height));
  return mix(ambient * vec3(0.3, 0.26, 0.19), sky, smoothstep(-0.1, 0.06, height));
}

float propHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 propHash3(vec3 p) {
  float a = propHash(p);
  return fract(vec3(a * 37.0, a * 61.0, a * 83.0) + vec3(0.17, 0.53, 0.71));
}

float propNoise(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = p - cell;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(
      mix(propHash(cell), propHash(cell + vec3(1.0, 0.0, 0.0)), f.x),
      mix(propHash(cell + vec3(0.0, 1.0, 0.0)), propHash(cell + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(propHash(cell + vec3(0.0, 0.0, 1.0)), propHash(cell + vec3(1.0, 0.0, 1.0)), f.x),
      mix(propHash(cell + vec3(0.0, 1.0, 1.0)), propHash(cell + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

float propFbm(vec3 p) {
  return 0.55 * propNoise(p) + 0.3 * propNoise(p * 2.13 + 7.1) + 0.15 * propNoise(p * 4.37 + 3.3);
}

vec3 propTurn(vec4 q, vec3 v) {
  vec3 t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

vec3 gDiffuse = vec3(0.0);
vec3 gSpecular = vec3(0.0);
vec3 gGlow = vec3(0.0);

// The smooth normal of the surface being shaded, in common space, if the part sets it before it asks for
// visibility. Each tap then compares against the plane of the surface, not one depth, so a slope or a
// convex body sees no shadow of its own.
vec3 propShadowNormal = vec3(0.0);
// Radius of the penumbra, in metres. Never narrower than about a texel and a half.
float propShadowSoft = 0.002;

in float vPropMetre;
#ifdef MODULE_SHADOW
uniform sampler2D propShadowMap;
in vec3 vPropShadow;

const vec4 PROP_SHADOW_UNPACK = vec4(1.0, 1.0 / 255.0, 1.0 / 65025.0, 1.0 / 16581375.0);
${getShadowDisc()}

// One tap: lit or not at the four texels around a point in the map, as a blend, since packed depth only
// holds at texel centers.
float propShadowTap(vec2 place, float depth, ivec2 size) {
  vec2 corner = floor(place);
  vec2 f = place - corner;
  ivec2 low = clamp(ivec2(corner), ivec2(0), size - 1);
  ivec2 high = clamp(ivec2(corner) + 1, ivec2(0), size - 1);
  float a = depth <= dot(texelFetch(propShadowMap, low, 0), PROP_SHADOW_UNPACK) ? 1.0 : 0.0;
  float b = depth <= dot(texelFetch(propShadowMap, ivec2(high.x, low.y), 0), PROP_SHADOW_UNPACK) ? 1.0 : 0.0;
  float c = depth <= dot(texelFetch(propShadowMap, ivec2(low.x, high.y), 0), PROP_SHADOW_UNPACK) ? 1.0 : 0.0;
  float d = depth <= dot(texelFetch(propShadowMap, high, 0), PROP_SHADOW_UNPACK) ? 1.0 : 0.0;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fraction of the key light that reaches this point, with the bias in metres. Only the key has a map.
float propKeyVisibility(float biasMetres) {
  if (propLook.shadow.x <= 0.0) return 1.0;
  vec3 position = vPropShadow;
  if (position.x <= 0.0 || position.y <= 0.0 || position.x >= 1.0 || position.y >= 1.0) return 1.0;
  mat4 light = shadow.viewProjectionMatrix0;
  ivec2 size = textureSize(propShadowMap, 0);
  vec2 sizeF = vec2(size);
  vec3 rowU = vec3(light[0].x, light[1].x, light[2].x);
  vec3 rowV = vec3(light[0].y, light[1].y, light[2].y);
  vec3 rowZ = vec3(light[0].z, light[1].z, light[2].z);
  vec2 axisLength = vec2(length(rowU), length(rowV));
  float depthLength = length(rowZ);
  vec2 texelMetres = 2.0 / (axisLength * sizeF * max(vPropMetre, 1e-9));
  float depthPerMetre = 0.5 * depthLength * vPropMetre;
  vec2 slope = vec2(0.0);
  float normalLength = dot(propShadowNormal, propShadowNormal);
  if (normalLength > 0.0) {
    vec3 normal = propShadowNormal / sqrt(normalLength);
    float along = dot(normal, rowZ) / depthLength;
    float facing = sign(along + 1e-6) * max(abs(along), 0.26);
    slope = -vec2(dot(normal, rowU) / axisLength.x, dot(normal, rowV) / axisLength.y) / facing *
      texelMetres * depthPerMetre;
  }
  float angle = PROP_PI * 2.0 *
    fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float c = cos(angle);
  float s = sin(angle);
  vec2 radius = clamp(propShadowSoft / max(texelMetres, vec2(1e-6)), vec2(1.25), vec2(6.0));
  float depth = position.z - biasMetres * depthPerMetre - 0.5 * (abs(slope.x) + abs(slope.y));
  vec2 middle = position.xy * sizeF - 0.5;
  float lit = 0.0;
  for (int i = 0; i < ${SHADOW_DISC_TAPS}; i++) {
    vec2 tap = PROP_SHADOW_DISC[i];
    vec2 offset = vec2(c * tap.x - s * tap.y, s * tap.x + c * tap.y) * radius;
    lit += propShadowTap(middle + offset, depth + dot(offset, slope), size);
  }
  return mix(1.0, lit / ${SHADOW_DISC_TAPS}.0, propLook.shadow.x);
}
#else
float propKeyVisibility(float biasMetres) {
  return 1.0;
}
#endif

// Adds a light. Wrap is how far diffuse light passes the terminator, per channel, as a rind or flesh
// lets red through farther than blue. Through is light that comes out of the far side.
void propLight(
  vec3 normal, vec3 view, vec3 light, vec3 color, float visibility,
  vec3 wrap, float shininess, float wax, float broad, float through
) {
  float facing = dot(normal, light);
  gDiffuse += color * max((vec3(facing) + wrap) / (1.0 + wrap), vec3(0.0)) * visibility;
  if (facing > 0.0 && wax > 0.0) {
    vec3 halfway = normalize(light + view);
    float along = max(dot(normal, halfway), 0.0);
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(view, halfway), 0.0), 5.0);
    // Normalized, so a tight highlight is a bright one.
    float tight = pow(along, shininess) * (shininess + 8.0) * 0.04;
    float wide = pow(along, shininess * 0.09 + 3.0) * broad;
    gSpecular += color * (tight + wide) * fresnel * wax * visibility;
  }
  if (through > 0.0) {
    float toward = pow(max(dot(-view, light), 0.0), 3.0);
    gGlow += color * max(-facing, 0.0) * (0.5 + 1.2 * toward) * through * visibility;
  }
}

// All the lights. The bias is the key's, in metres.
void propLights(
  vec3 normal, vec3 view, vec3 wrap, float shininess, float wax, float broad, float through, float bias
) {
  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    propLight(
      normal, view, normalize(-light.direction), propLightColor(light.color),
      i == 0 ? propKeyVisibility(bias) : 1.0,
      wrap, shininess, wax, broad, through
    );
  }
}

// Fog, in linear light, the last thing before the filmic curve.
vec3 propFogged(vec3 color, vec3 position, vec3 camera) {
  float density = propLook.fog.a;
  if (density <= 0.0) return color;
  float metres = length(camera - position) / max(vPropMetre, 1e-9);
  return mix(propLook.fog.rgb, color, exp(-density * metres));
}
`;

/** What a program's fragment stage does first: the two passes that are not its look. */
export const PROP_FRAGMENT_PASSES = /* glsl */ `
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
`;

export type PropMeshLayerProps = LayerProps & {
  mesh?: PropMesh | null;
  program: PropProgram;
  /** Values of the program's uniform block, by field. */
  values?: PropValues;
  /** Packed per-instance values, as the program lays them out, for `instanceCount` instances. */
  instances?: Float32Array | null;
  instanceCount?: number;
  /** How many vertices or indices to draw, if not all. */
  drawCount?: number;
  fog?: StoryFog | null;
  shadowEnabled?: boolean;
};

const defaultProps: DefaultProps<PropMeshLayerProps> = {
  mesh: {type: 'object', value: null, compare: false, ignore: true},
  program: {type: 'object', value: null as never, compare: false, ignore: true},
  // Not ignored: deck draws with the props of its last update, and these change every frame.
  values: {type: 'object', value: NO_VALUES, compare: false},
  instances: {type: 'object', value: null, compare: false},
  instanceCount: 0,
  drawCount: -1,
  fog: {type: 'object', value: null, compare: false},
  shadowEnabled: true,
  // Depth here is metres at macro scale, and deck's offset by layer index is several millimetres.
  getPolygonOffset: {type: 'function', value: null as never, compare: false},
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  coordinateOrigin: {type: 'array', value: [0, 0, 0], compare: true}
};

/**
 * One prop mesh with its program. Reads the shadow map through its own sampler, as `TreeLayer` does:
 * the shadow module gets an empty list of maps, which keeps its matrices and stops it darkening the
 * final color.
 */
export class PropMeshLayer extends Layer<Required<PropMeshLayerProps>> {
  static layerName = 'PropMeshLayer';
  static defaultProps = defaultProps as never;

  declare state: {
    model?: Model;
    builtFrom?: PropProgram;
    meshFrom?: PropMesh | null;
    instanceBuffer?: Buffer;
    instanceCapacity: number;
    uploaded?: Float32Array | null;
    shadowStrength: number;
    shadowMaps: Texture[];
    dummyShadowMap?: Texture;
    pickingShadow?: Record<string, unknown>;
    readsShadows: boolean;
  };

  getShaders(shaders: unknown): any {
    const merged = super.getShaders(shaders) as {modules: {name: string}[]};
    return {...merged, modules: merged.modules.map(getSlimShadowModule)};
  }

  initializeState(): void {
    this.state.instanceCapacity = 0;
    this.state.shadowStrength = 0;
    this.state.shadowMaps = [];
    this.state.readsShadows = false;
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const {program, mesh} = this.props;
    if (
      params.changeFlags.extensionsChanged ||
      !this.state.model ||
      this.state.builtFrom !== program ||
      this.state.meshFrom !== mesh
    ) {
      this.state.model?.destroy();
      this.state.model = this.createModel();
      if (this.state.instanceBuffer) {
        this.state.model.setAttributes({propInstance: this.state.instanceBuffer});
      }
      this.state.builtFrom = program;
      this.state.meshFrom = mesh;
      this.state.uploaded = undefined;
      this.state.readsShadows = this.context.defaultShaderModules.some(
        module => module.name === 'shadow'
      );
    }
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]): void {
    this.state.instanceBuffer?.destroy();
    super.finalizeState(context);
  }

  private createModel(): Model {
    const {program, mesh} = this.props;
    const block = getProgramBlock(program);
    const modules: any[] = [project32, picking, lighting, propLook];
    if (block) modules.push(block);
    const attributes = program.instanceAttributes;
    const bufferLayout = attributes
      ? [
          {
            name: 'propInstance',
            stepMode: 'instance' as const,
            byteStride: attributes.reduce((sum, [, size]) => sum + size, 0) * 4,
            attributes: (() => {
              let byteOffset = 0;
              return attributes.map(([attribute, size]) => {
                const entry = {
                  attribute,
                  format: (size === 1 ? 'float32' : `float32x${size}`) as never,
                  byteOffset
                };
                byteOffset += size * 4;
                return entry;
              });
            })()
          }
        ]
      : [];
    return new Model(this.context.device, {
      ...this.getShaders({vs: program.vs, fs: program.fs, modules}),
      id: this.props.id,
      bufferLayout,
      isInstanced: Boolean(attributes),
      geometry: mesh
        ? new Geometry({
            topology: 'triangle-list',
            attributes: {
              positions: {size: 3, value: mesh.positions},
              normals: {size: 3, value: mesh.normals},
              details: {size: 4, value: mesh.details}
            },
            indices: {size: 1, value: mesh.indices}
          })
        : undefined,
      topology: mesh ? undefined : 'triangle-list',
      vertexCount: program.vertexCount
    } as never);
  }

  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]): void {
    const all = props as Record<string, any>;
    // Picking leaves out LightingEffect, whose shadow shader stays a default module of the layer.
    if (all.shadow?.dummyShadowMap) this.state.pickingShadow = all.shadow;
    const next =
      all.picking?.isActive && this.state.pickingShadow
        ? {
            ...all,
            shadow: {
              ...this.state.pickingShadow,
              project: all.project,
              shadowEnabled: false,
              drawToShadowMap: false
            }
          }
        : all;
    const shadow = next.shadow;
    if (!shadow) {
      super.setShaderModuleProps(next);
      return;
    }
    if (shadow.dummyShadowMap) this.state.dummyShadowMap = shadow.dummyShadowMap;
    const maps: Texture[] = !next.picking?.isActive && shadow.shadowMaps ? shadow.shadowMaps : [];
    this.state.shadowMaps = maps;
    this.state.shadowStrength = maps.length ? (shadow.shadowColor?.[3] ?? 1) : 0;
    super.setShaderModuleProps({...next, shadow: {...shadow, shadowMaps: []}});
  }

  draw({renderPass}: Parameters<Layer['draw']>[0]): void {
    const {model} = this.state;
    if (!model) return;
    const {program, values, instances, instanceCount, drawCount, fog} = this.props;
    const {device, viewport} = this.context;
    if (instances) {
      if (instanceCount <= 0) return;
      if (!this.state.instanceBuffer || this.state.instanceCapacity < instances.length) {
        this.state.instanceBuffer?.destroy();
        const capacity = Math.max(instances.length * 2, 256);
        this.state.instanceBuffer = device.createBuffer({
          id: `${this.props.id}-instances`,
          usage: Buffer.VERTEX | Buffer.COPY_DST,
          byteLength: capacity * 4
        });
        this.state.instanceCapacity = capacity;
        this.state.uploaded = undefined;
        model.setAttributes({propInstance: this.state.instanceBuffer});
      }
      if (this.state.uploaded !== instances) {
        this.state.instanceBuffer.write(instances);
        this.state.uploaded = instances;
      }
      model.setInstanceCount(instanceCount);
    }
    if (drawCount >= 0) {
      if (this.props.mesh) model.setIndexCount(drawCount);
      else model.setVertexCount(drawCount);
    }
    const focal = viewport.height * 0.5 * viewport.projectionMatrix[5];
    const fogLight = fog && fog.density > 0 ? getFogLight(fog.color) : [0, 0, 0];
    const look: PropLookUniforms = {
      shadow: [this.state.shadowStrength, 0, 0, 0],
      fog: [fogLight[0], fogLight[1], fogLight[2], fog?.density ?? 0],
      screen: [focal * (device.canvasContext?.cssToDeviceRatio() ?? 1), 0, 0, 0]
    };
    const block = getProgramBlock(program);
    model.shaderInputs.setProps({
      propLook: look,
      ...(block ? {[program.name]: values} : {})
    } as never);
    const {dummyShadowMap, shadowMaps, readsShadows} = this.state;
    if (dummyShadowMap && readsShadows && !program.ignoresShadow) {
      // Never the map being drawn: a shadow pass has none here.
      model.setBindings({propShadowMap: shadowMaps[0] ?? dummyShadowMap});
    }
    model.draw(renderPass);
  }
}

/** Shared by the factories: the props every prop layer has. */
export function getPropLayerProps(fog: StoryFog): {
  fog: StoryFog;
  coordinateSystem: typeof COORDINATE_SYSTEM.CARTESIAN;
  coordinateOrigin: [number, number, number];
} {
  return {fog, coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, coordinateOrigin: ORIGIN};
}

const ORIGIN: [number, number, number] = [0, 0, 0];

// Mesh building. Deterministic, and only ever done once for each mesh.

type Point = [number, number, number];

function subtract(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * A surface over a grid. `getPoint(u, v)` takes u and v from 0 to 1. Normals come from the surface's
 * derivatives, facing along `flip ? v x u : u x v`, or `getNormal` if it is given. With `wrap`, u is
 * periodic. `getDetails` says what `details` a vertex has.
 */
export function createGridMesh(options: {
  columns: number;
  rows: number;
  getPoint: (u: number, v: number) => Point;
  wrap?: boolean;
  flip?: boolean;
  getDetails?: (u: number, v: number) => [number, number, number, number];
}): PropMesh {
  const {columns, rows, getPoint, wrap = false, flip = false, getDetails} = options;
  const count = (columns + 1) * (rows + 1);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const details = new Float32Array(count * 4);
  const indices = new Uint32Array(columns * rows * 6);
  const du = 0.25 / columns;
  const dv = 0.25 / rows;
  let vertex = 0;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const point = getPoint(u, v);
      positions.set(point, vertex * 3);
      // Central differences, kept inside the grid unless it wraps.
      const u0 = wrap ? u - du : Math.max(u - du, 0);
      const u1 = wrap ? u + du : Math.min(u + du, 1);
      // A pole has no extent across, so its normal comes from a little way off it.
      const vInner = Math.min(Math.max(v, dv), 1 - dv);
      const v0 = Math.max(v - dv, 0);
      const v1 = Math.min(v + dv, 1);
      const alongU = subtract(getPoint(u1, vInner), getPoint(u0, vInner));
      const alongV = subtract(getPoint(u, v1), getPoint(u, v0));
      let nx = alongU[1] * alongV[2] - alongU[2] * alongV[1];
      let ny = alongU[2] * alongV[0] - alongU[0] * alongV[2];
      let nz = alongU[0] * alongV[1] - alongU[1] * alongV[0];
      const length = Math.hypot(nx, ny, nz) || 1;
      const sign = flip ? -1 : 1;
      nx *= sign / length;
      ny *= sign / length;
      nz *= sign / length;
      normals.set([nx, ny, nz], vertex * 3);
      details.set(getDetails ? getDetails(u, v) : [u, v, 0, 0], vertex * 4);
      vertex++;
    }
  }
  let index = 0;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column;
      const b = a + 1;
      const c = a + columns + 1;
      const d = c + 1;
      indices.set([a, b, d, a, d, c], index);
      index += 6;
    }
  }
  return {positions, normals, details, indices};
}

/** Several meshes as one. */
export function mergeMeshes(meshes: readonly PropMesh[]): PropMesh {
  const vertices = meshes.reduce((sum, mesh) => sum + mesh.positions.length / 3, 0);
  const indexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const merged: PropMesh = {
    positions: new Float32Array(vertices * 3),
    normals: new Float32Array(vertices * 3),
    details: new Float32Array(vertices * 4),
    indices: new Uint32Array(indexCount)
  };
  let vertex = 0;
  let index = 0;
  for (const mesh of meshes) {
    merged.positions.set(mesh.positions, vertex * 3);
    merged.normals.set(mesh.normals, vertex * 3);
    merged.details.set(mesh.details, vertex * 4);
    for (let i = 0; i < mesh.indices.length; i++)
      merged.indices[index + i] = mesh.indices[i] + vertex;
    index += mesh.indices.length;
    vertex += mesh.positions.length / 3;
  }
  return merged;
}

/** A unit sphere, subdivided from an icosahedron, with its normals. Smooth at any size on screen. */
export function createSphereMesh(subdivisions: number): PropMesh {
  const t = (1 + Math.sqrt(5)) / 2;
  let points: Point[] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1]
  ];
  const unit = ([x, y, z]: Point): Point => {
    const length = Math.hypot(x, y, z);
    return [x / length, y / length, z / length];
  };
  points = points.map(unit);
  let faces: number[][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1]
  ];
  for (let level = 0; level < subdivisions; level++) {
    const middles = new Map<string, number>();
    const getMiddle = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let index = middles.get(key);
      if (index === undefined) {
        const [ax, ay, az] = points[a];
        const [bx, by, bz] = points[b];
        index = points.length;
        points.push(unit([(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2]));
        middles.set(key, index);
      }
      return index;
    };
    const next: number[][] = [];
    for (const [a, b, c] of faces) {
      const ab = getMiddle(a, b);
      const bc = getMiddle(b, c);
      const ca = getMiddle(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => positions.set(point, index * 3));
  return {
    positions,
    normals: positions.slice(),
    details: new Float32Array(points.length * 4),
    indices: new Uint32Array(faces.flat())
  };
}

/** A flat unit square from -1 to 1, in x and y, facing +z, for patches on the ground. */
export const PROP_QUAD_MESH: PropMesh = {
  positions: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
  details: new Float32Array(16),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3])
};

/**
 * Soft dark patches on the ground, under what rests on it: what a shadow map is far too coarse to
 * give. Instanced: center, then its half lengths along the x and y of its own frame, turn in radians,
 * how dark, and how warm.
 */
export const CONTACT_PROGRAM: PropProgram = {
  name: 'propContact',
  ignoresShadow: true,
  instanceAttributes: [
    ['instanceCenter', 3],
    ['instanceSize', 2],
    ['instanceShape', 3]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME prop-contact-vs
precision highp float;
in vec3 positions;
in vec3 instanceCenter;
in vec2 instanceSize;
in vec3 instanceShape;
out vec2 vPatch;
out vec2 vShape;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = positions.xy;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float c = cos(instanceShape.x);
  float s = sin(instanceShape.x);
  vec2 size = positions.xy * instanceSize;
  vec3 offset = vec3(c * size.x - s * size.y, s * size.x + c * size.y, 0.0);
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(instanceCenter, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPatch = positions.xy;
  vShape = instanceShape.yz;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME prop-contact-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec2 vPatch;
in vec2 vShape;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  // What a ball keeps of the sky from a point on the ground, a patch being three of its radii:
  // nearly all of it where it touches, a third at one radius off, and very little at three.
  float rho = length(vPatch);
  float kept = pow(1.0 + 9.0 * rho * rho, -1.5);
  float dark = vShape.x * kept * smoothstep(1.0, 0.55, rho);
  fragColor = vec4(vec3(0.05, 0.03, 0.02) * vShape.y, dark);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};

/**
 * Writes the contact patches of a body on the ground, into `CONTACT_PROGRAM`'s instances: a tight dark
 * one where it touches, and a long soft one away from the key, where it keeps both the low sun and half the
 * sky from the ground. In metres: where it touches, how big it is, the land's height there, and how far
 * the body's lowest point is above it. A body clear of the land by `CONTACT_FADE` or more writes nothing.
 */
export function writeContact(
  out: number[],
  x: number,
  y: number,
  radius: number,
  dark: number,
  keyDirection: readonly number[],
  ground = 0,
  height = 0
): void {
  const strength = dark * (1 - smoothstep01(height / CONTACT_FADE));
  if (strength <= 0) return;
  const z = ground + CONTACT_LIFT;
  out.push(x, y, z, radius * 3, radius * 3, 0, strength, 1);
  const flat = Math.hypot(keyDirection[0], keyDirection[1]);
  if (flat > 1e-3) {
    const elevation = Math.atan2(-keyDirection[2], flat);
    const reach = Math.min(radius / Math.max(Math.tan(elevation), 0.05), radius * 5.5);
    const along = reach * 0.62 + radius * 0.5;
    const ux = keyDirection[0] / flat;
    const uy = keyDirection[1] / flat;
    out.push(
      x + ux * along * 0.72,
      y + uy * along * 0.72,
      z,
      along * 1.7,
      radius * 2.4,
      Math.atan2(uy, ux),
      strength * 0.34,
      1
    );
  }
}

/**
 * Writes a damp mark on the ground into `CONTACT_PROGRAM`'s instances: sand darkened where something wet
 * touched it, round, with no long patch, at the same lift over the land as a contact patch.
 */
export function writeDamp(
  out: number[],
  x: number,
  y: number,
  ground: number,
  radius: number,
  dark: number
): void {
  if (dark <= 0) return;
  out.push(x, y, ground + CONTACT_LIFT, radius * 1.6, radius * 1.6, 0, dark, 1);
}

/** Floats per instance `writeContact` writes. */
export const CONTACT_STRIDE = 8;
/** Over the ground, in metres: the sand has this much relief close to. */
const CONTACT_LIFT = 0.0022;
/** Metres between a body and the land at which its contact patches have faded to nothing. */
export const CONTACT_FADE = 0.05;

/** Smoothstep from 0 to 1. */
function smoothstep01(value: number): number {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
}

/**
 * A bead of clear liquid, as a stand-in for what it would refract: light through its far side, a mirror
 * of the sky, and the sun in a tight point. Instanced: center, radius, up, squash along up, alpha.
 */
export const BEAD_PROGRAM: PropProgram = {
  name: 'propBead',
  fields: ['tint'],
  instanceAttributes: [
    ['instanceCenter', 3],
    ['instanceRadius', 1],
    ['instanceUp', 3],
    ['instanceSquash', 1],
    ['instanceAlpha', 1]
  ],
  vs: /* glsl */ `#version 300 es
#define SHADER_NAME prop-bead-vs
precision highp float;
in vec3 positions;
in vec3 normals;
in vec3 instanceCenter;
in float instanceRadius;
in vec3 instanceUp;
in float instanceSquash;
in float instanceAlpha;
out vec3 vPosition;
out vec3 vCamera;
out vec3 vNormal;
out float vAlpha;
${PROP_VERTEX_CHUNK}
void main(void) {
  geometry.uv = vec2(0.0);
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  float along = dot(positions, instanceUp);
  vec3 point = positions + instanceUp * along * (instanceSquash - 1.0);
  // A bead standing on a surface sits with its foot on it.
  vec3 offset = (point + instanceUp * (instanceSquash - 1.0) * 0.0) * instanceRadius;
  float nAlong = dot(normals, instanceUp);
  vNormal = normalize(normals + instanceUp * nAlong * (1.0 / max(instanceSquash, 0.2) - 1.0));
  vec4 commonPosition;
  gl_Position = project_position_to_clipspace(instanceCenter, vec3(0.0), project_size(offset), commonPosition);
  geometry.position = commonPosition;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  vPosition = commonPosition.xyz;
  vCamera = project.cameraPosition;
  vAlpha = instanceAlpha;
  propShadowWrite(commonPosition);
  vec4 filtered = vec4(0.0);
  DECKGL_FILTER_COLOR(filtered, geometry);
}
`,
  fs: /* glsl */ `#version 300 es
#define SHADER_NAME prop-bead-fs
precision highp float;
precision highp int;
precision highp sampler2D;
in vec3 vPosition;
in vec3 vCamera;
in vec3 vNormal;
in float vAlpha;
out vec4 fragColor;
${PROP_FRAGMENT_CHUNK}
void main(void) {
  ${PROP_FRAGMENT_PASSES}
  vec3 normal = normalize(vNormal);
  vec3 view = normalize(vCamera - vPosition);
  float facing = max(dot(normal, view), 0.0);
  float fresnel = 0.03 + 0.97 * pow(1.0 - facing, 4.0);
  vec3 tint = propBead.tint.rgb;
  // Refraction turns the world over: the lower part of a bead shows the bright sky, and the upper the
  // ground. What is behind the bead shows through it, so the middle is nearly clear, and its rim is dark.
  vec3 refractedRay = refract(-view, normal, 0.75);
  vec3 inner = propSkyColor(-refractedRay) * tint * 0.9;
  float clear = propBead.tint.a * mix(0.2, 1.0, smoothstep(0.92, 0.3, facing));
  inner *= mix(0.22, 1.0, smoothstep(0.1, 0.62, facing));
  vec3 shine = vec3(0.0);
  float visible = propKeyVisibility(0.0005);
  for (int i = 0; i < lighting.directionalLightCount; i++) {
    DirectionalLight light = lighting_getDirectionalLight(i);
    vec3 toLight = normalize(-light.direction);
    vec3 sun = propLightColor(light.color) * (i == 0 ? visible : 1.0);
    // The bright focus inside, on the far side from the light.
    float focus = pow(max(dot(normal, -toLight), 0.0), 5.0);
    inner += sun * tint * focus * 2.6;
    clear = max(clear, focus * 0.8);
    vec3 halfway = normalize(toLight + view);
    float along = max(dot(normal, halfway), 0.0);
    // A sharp glint from the surface, and a soft bloom around it.
    shine += sun * (pow(along, 900.0) * 40.0 + pow(along, 70.0) * 0.5);
  }
  shine += propSkyColor(reflect(-view, normal)) * fresnel * 1.1;
  float shineLevel = clamp(max(max(shine.r, shine.g), shine.b), 0.0, 1.0);
  float alpha = clear + (1.0 - clear) * shineLevel;
  vec3 color = (inner * clear + shine) / max(alpha, 1e-3);
  alpha *= vAlpha;
  fragColor = vec4(propFilmic(propFogged(color, vPosition, vCamera)), alpha);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}
`
};
