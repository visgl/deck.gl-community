// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _GlobeViewport as GlobeViewport,
  Layer,
  type Accessor,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import {Buffer, type Device, type Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import type {PhongMaterialProps} from '@luma.gl/shadertools';
import {prepareShadowDraw} from '../splat-layer/splat-shadow';
import type {TreeGrowthSpecies} from './tree-growth-model';
import {TREE_TEMPLATE_TEXTURE_WIDTH, type TreeGrowthModel} from './tree-photoreal-layout';
import {TREE_WIND_STRONG_FROM} from './tree-wind';
import {
  getTreeFogLight,
  getTreeLeafPaleness,
  TREE_BARK_STYLES,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';

/** GPU resources of one template, shared by all sub-layers and layers that use it on a device. */
export type TreeTemplateResources = {
  /** Interleaved `center`, `previous`, `radial`, `bark` and `shade`. */
  woodVertices: Buffer;
  woodIndices: Buffer;
  /** `TREE_LEAF_STRIDE` floats per leaf. */
  leaves: Texture;
  /** `TREE_CROP_ANCHOR_STRIDE` floats per anchor. */
  cropAnchors: Texture;
  /** `TREE_LIMB_STRIDE` floats per limb. */
  limbs: Texture;
};

type TemplateEntry = TreeTemplateResources & {references: number};

const TEMPLATES = new WeakMap<Device, Map<TreeGrowthModel, TemplateEntry>>();

/** Lays records out in the shared width of the template textures. */
function createTemplateTexture(device: Device, id: string, records: Float32Array): Texture {
  const texels = Math.max(1, records.length / 4);
  const height = Math.ceil(texels / TREE_TEMPLATE_TEXTURE_WIDTH);
  const data = new Float32Array(TREE_TEMPLATE_TEXTURE_WIDTH * height * 4);
  data.set(records);
  return device.createTexture({
    id,
    format: 'rgba32float',
    width: TREE_TEMPLATE_TEXTURE_WIDTH,
    height,
    data,
    mipLevels: 1,
    sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
  });
}

/** Interleaves the wood arrays, one vec4 each per vertex. */
function createWoodVertexData(model: TreeGrowthModel): Float32Array {
  const {vertexCount, center, previous, radial, bark, shade} = model.wood;
  const data = new Float32Array(vertexCount * 20);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const out = vertex * 20;
    const from = vertex * 4;
    for (let i = 0; i < 4; i++) {
      data[out + i] = center[from + i];
      data[out + 4 + i] = previous[from + i];
      data[out + 8 + i] = radial[from + i];
      data[out + 12 + i] = bark[from + i];
      data[out + 16 + i] = shade[from + i];
    }
  }
  return data;
}

/** A counted lease on a template's buffers and textures. Pair with `releaseTreeTemplateResources`. */
export function acquireTreeTemplateResources(
  device: Device,
  model: TreeGrowthModel
): TreeTemplateResources {
  let cache = TEMPLATES.get(device);
  if (!cache) {
    cache = new Map();
    TEMPLATES.set(device, cache);
  }
  let entry = cache.get(model);
  if (!entry) {
    entry = {
      references: 0,
      woodVertices: device.createBuffer({
        id: `tree-wood-${model.key}`,
        usage: Buffer.VERTEX,
        data: createWoodVertexData(model)
      }),
      woodIndices: device.createBuffer({
        id: `tree-wood-indices-${model.key}`,
        usage: Buffer.INDEX,
        data: model.wood.indices
      }),
      leaves: createTemplateTexture(device, `tree-leaves-${model.key}`, model.leaves),
      cropAnchors: createTemplateTexture(
        device,
        `tree-crop-anchors-${model.key}`,
        model.cropAnchors
      ),
      limbs: createTemplateTexture(device, `tree-limbs-${model.key}`, model.limbs)
    };
    cache.set(model, entry);
  }
  entry.references++;
  return entry;
}

export function releaseTreeTemplateResources(device: Device, model: TreeGrowthModel): void {
  const cache = TEMPLATES.get(device);
  const entry = cache?.get(model);
  if (!cache || !entry || --entry.references > 0) return;
  cache.delete(model);
  entry.woodVertices.destroy();
  entry.woodIndices.destroy();
  entry.leaves.destroy();
  entry.cropAnchors.destroy();
  entry.limbs.destroy();
}

type LeafIndexEntry = {
  buffer: Buffer;
  /** Leaves the buffer holds. */
  capacity: number;
  /** Smaller buffers some model may still have bound. */
  retired: Buffer[];
  references: number;
};

const LEAF_INDICES = new WeakMap<Device, Map<string, LeafIndexEntry>>();

/**
 * A counted lease on the index buffer of a blade pattern. Every template shares it: indices only say
 * which corner of which leaf comes next, so any leaf count is a prefix of a larger buffer. A buffer
 * that turns out too small for a later template stays alive until its users are gone.
 */
export function acquireTreeLeafIndices(
  device: Device,
  key: string,
  corners: number,
  pattern: readonly number[],
  leaves: number
): Buffer {
  let cache = LEAF_INDICES.get(device);
  if (!cache) {
    cache = new Map();
    LEAF_INDICES.set(device, cache);
  }
  let entry = cache.get(key);
  if (!entry || entry.capacity < leaves) {
    const indices = new Uint32Array(pattern.length * leaves);
    for (let leaf = 0; leaf < leaves; leaf++) {
      const start = leaf * pattern.length;
      const first = leaf * corners;
      for (let i = 0; i < pattern.length; i++) indices[start + i] = first + pattern[i];
    }
    const buffer = device.createBuffer({
      id: `tree-leaf-indices-${key}`,
      usage: Buffer.INDEX,
      data: indices
    });
    entry = {
      buffer,
      capacity: leaves,
      retired: entry ? [...entry.retired, entry.buffer] : [],
      references: entry ? entry.references : 0
    };
    cache.set(key, entry);
  }
  entry.references++;
  return entry.buffer;
}

export function releaseTreeLeafIndices(device: Device, key: string): void {
  const cache = LEAF_INDICES.get(device);
  const entry = cache?.get(key);
  if (!cache || !entry || --entry.references > 0) return;
  cache.delete(key);
  entry.buffer.destroy();
  for (const buffer of entry.retired) buffer.destroy();
}

const TREE_SHADOW_UNIFORM_BLOCK = /* glsl */ `
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

const TREE_SHADOW_MODULE_VS = /* glsl */ `${TREE_SHADOW_UNIFORM_BLOCK}
vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  if (!shadow.drawShadowMap) return gl_Position;
  return shadow.lightId == 0
    ? project_common_position_to_clipspace(position_commonspace, shadow.viewProjectionMatrix0, shadow.projectCenter0)
    : project_common_position_to_clipspace(position_commonspace, shadow.viewProjectionMatrix1, shadow.projectCenter1);
}
`;

const TREE_SHADOW_MODULE_FS = /* glsl */ `${TREE_SHADOW_UNIFORM_BLOCK}
vec4 shadow_filterShadowColor(vec4 color) {
  if (!shadow.drawShadowMap) return color;
  const vec4 bitPackShift = vec4(1.0, 255.0, 65025.0, 16581375.0);
  const vec4 bitMask = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  vec4 rgbaDepth = fract(gl_FragCoord.z * bitPackShift);
  return rgbaDepth - rgbaDepth.gbaa * bitMask;
}
`;

const TREE_SHADOW_MODULES = new WeakMap<object, unknown>();

/**
 * deck.gl's shadow module with what the photoreal layers do not use taken out, as they read the maps
 * through samplers of their own. Its vertex stage copies both matrices into an array for every vertex and
 * has two more varyings, which together cost as much as the rest of a far leaf's vertex stage. The uniforms
 * and what it injects are the same, and so is the depth it packs in a shadow pass.
 */
function getTreeShadowModule<ModuleT extends {name: string}>(module: ModuleT): ModuleT {
  if (module.name !== 'shadow') return module;
  let slim = TREE_SHADOW_MODULES.get(module) as ModuleT | undefined;
  if (!slim) {
    const {getUniforms} = module as unknown as {
      getUniforms: (...args: unknown[]) => Record<string, unknown>;
    };
    slim = {
      ...module,
      vs: TREE_SHADOW_MODULE_VS,
      fs: TREE_SHADOW_MODULE_FS,
      getUniforms: (...args: unknown[]) => {
        const {
          shadow_uShadowMap0: _map0,
          shadow_uShadowMap1: _map1,
          ...uniforms
        } = getUniforms(...args);
        return uniforms;
      }
    };
    TREE_SHADOW_MODULES.set(module, slim);
  }
  return slim;
}

// Picking omits LightingEffect, but the effect's shadow shader remains a deck default module. Keep its
// fallback samplers from a draw pass so the pick pass can bind the module.
const PICKING_SHADOW_BINDINGS = new WeakMap<object, Record<string, any>>();

function withPickingShadowBindings(owner: object, props: Record<string, any>) {
  if (props.shadow?.dummyShadowMap) PICKING_SHADOW_BINDINGS.set(owner, props.shadow);
  const previous = PICKING_SHADOW_BINDINGS.get(owner);
  return props.picking?.isActive && previous
    ? {
        ...props,
        shadow: {...previous, project: props.project, shadowEnabled: false, drawToShadowMap: false}
      }
    : props;
}

/** Exponential fog over a photoreal tree: a sRGB color, each 0-255, and how thick it is, per metre. */
export type TreeFog = {color: readonly number[]; density: number};

/** What `TreeLayer` gives each photoreal primitive layer. */
export type TreePhotorealLayerProps<DataT = unknown> = LayerProps & {
  data: DataT[];
  /** The template all rows of this layer use. */
  template: TreeGrowthModel;
  /** Its species, which chooses the bark. */
  species: TreeGrowthSpecies;
  /** Level of detail of this layer, 0-3. */
  lod: number;
  /** RGBA32F state rows, read with `texelFetch`. */
  stateTexture: Texture | null;
  /** @internal CPU copy of state rows for conservative geometry submission bounds. */
  _stateData?: Float32Array | null;
  /** Row of a tree in `stateTexture`. */
  getTreeRow?: Accessor<DataT, number>;
  windStrength?: number;
  /** Unit vector the wind blows along, or null for isotropic sway. */
  windDirection?: readonly [number, number] | null;
  windTime?: number | null;
  /** The clock gust fronts and their chop run on, or null for `windTime`. */
  windGustTime?: number | null;
  /** Layer position gust phases are measured from. */
  windOrigin?: readonly [number, number];
  /** Metres per layer unit along x and y. */
  windUnits?: readonly [number, number];
  /** Standard Phong material. */
  material?: PhongMaterialProps;
  shadowEnabled?: boolean;
  /** Keep a dedicated caster draw independent of the color and picking batches. */
  _shadowPass?: 'only' | 'skip' | null;
  /** Rain on the tree, 0-1. */
  wetness?: number;
  /** Rime on the tree, 0-1. */
  frost?: number;
  fog?: TreeFog | null;
};

const defaultProps: DefaultProps<TreePhotorealLayerProps> = {
  template: {type: 'object', value: null, compare: false, ignore: true},
  species: 'citrus',
  lod: 0,
  stateTexture: {type: 'object', value: null, compare: false, ignore: true},
  _stateData: {type: 'object', value: null, compare: false, ignore: true, optional: true},
  getTreeRow: {type: 'accessor', value: (row: any) => row.stateRow},
  windStrength: 0,
  windDirection: {type: 'array', value: null, optional: true, compare: true},
  windTime: null,
  windGustTime: null,
  windOrigin: {type: 'array', value: [0, 0], compare: true},
  windUnits: {type: 'array', value: [1, 1], compare: true},
  material: {type: 'object', value: null, compare: 2, optional: true},
  shadowEnabled: true,
  _shadowPass: null,
  wetness: 0,
  frost: 0,
  fog: {type: 'object', value: null, compare: 2, optional: true}
};

/**
 * Shared base of the wood, leaf and crop layers: the state texture, template leases, the `instanceTreeRow`
 * attribute, the `treePhotoreal` uniforms, and the shadow module's handling. A subclass supplies
 * `createModel` and `prepareDraw`, and the state row of each tree stays the only per-tree data.
 *
 * Picking returns the source row: `gl_InstanceID` indexes this layer's `data`, and the composite parent
 * unwraps it.
 */
export abstract class TreePhotorealPrimitiveLayer<DataT = unknown> extends Layer<
  Required<TreePhotorealLayerProps<DataT>>
> {
  static layerName = 'TreePhotorealPrimitiveLayer';
  static defaultProps = defaultProps;

  declare state: {
    model?: Model;
    resources?: TreeTemplateResources;
    resourcesOf?: TreeGrowthModel;
    /** The shadow color's alpha: how much of direct light a shadow takes. 0 with no shadow to read. */
    shadowStrength: number;
    shadowHistoryWeight: number;
    /** Shadow maps to read in the next draw pass. */
    shadowMaps: Texture[];
    dummyShadowMap?: Texture;
    /** The model was compiled with the shadow module, so it has the samplers to bind. */
    modelReadsShadows: boolean;
  };

  initializeState(): void {
    this.state.shadowStrength = 0;
    this.state.shadowHistoryWeight = 0;
    this.state.shadowMaps = [];
    this.state.modelReadsShadows = false;
    this.getAttributeManager()!.addInstanced({
      instanceTreeRow: {size: 1, accessor: 'getTreeRow'}
    });
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    const {props, oldProps, changeFlags} = params;
    const templateChanged = props.template !== oldProps.template;
    if (templateChanged || changeFlags.extensionsChanged || !this.state.model) {
      this.state.model?.destroy();
      this.onModelReleased();
      this.state.model = undefined;
      if (this.state.resourcesOf && this.state.resourcesOf !== this.props.template) {
        releaseTreeTemplateResources(this.context.device, this.state.resourcesOf);
        this.state.resources = undefined;
        this.state.resourcesOf = undefined;
      }
      if (!this.state.resources) {
        this.state.resources = acquireTreeTemplateResources(
          this.context.device,
          this.props.template
        );
        this.state.resourcesOf = this.props.template;
      }
      this.state.model = this.createModel(this.state.resources);
      this.state.modelReadsShadows = this.readsShadowMaps();
      this.getAttributeManager()!.invalidateAll();
    }
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]): void {
    this.onModelReleased();
    super.finalizeState(context);
    if (this.state.resourcesOf) {
      releaseTreeTemplateResources(this.context.device, this.state.resourcesOf);
      this.state.resources = undefined;
      this.state.resourcesOf = undefined;
    }
  }

  getShaders(shaders: unknown): any {
    const merged = super.getShaders(shaders) as {modules: {name: string}[]};
    return {...merged, modules: merged.modules.map(getTreeShadowModule)};
  }

  /** Builds the model. It holds a lease from `acquireTreeTemplateResources` through `resources`. */
  protected abstract createModel(resources: TreeTemplateResources): Model;

  /** Releases what the last model held, other than template resources. */
  protected onModelReleased(): void {}

  /** Sets this draw's index count, and returns its `treePhotoreal` shape, look and next level's look. */
  protected abstract prepareDraw(
    model: Model,
    shadowPass: boolean
  ): Pick<TreePhotorealUniforms, 'shape' | 'look'> & {
    nextLook?: readonly [number, number];
    /** The `leafBlades` uniform of a leaf layer. */
    leafBlades?: TreePhotorealUniforms['leafBlades'];
    /** The `woodLevel` uniform of a wood layer. */
    woodLevel?: TreePhotorealUniforms['woodLevel'];
    fixedLeafShadowShare?: number;
  };

  /**
   * Takes the shadow maps away from the shadow module. Its matrices stay, and it no longer darkens the
   * final color or looks up the map for every vertex and fragment: the shaders shadow direct light
   * alone, reading the maps through their own samplers.
   */
  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]): void {
    const next = withPickingShadowBindings(this, props);
    const shadow = next.shadow;
    if (!shadow) {
      super.setShaderModuleProps(next);
      return;
    }
    if (shadow.dummyShadowMap) this.state.dummyShadowMap = shadow.dummyShadowMap;
    const maps: Texture[] = !next.picking?.isActive && shadow.shadowMaps ? shadow.shadowMaps : [];
    this.state.shadowMaps = maps;
    this.state.shadowStrength = maps.length ? (shadow.shadowColor?.[3] ?? 1) : 0;
    this.state.shadowHistoryWeight = maps.length > 1 ? (shadow.historyWeight ?? 0) : 0;
    super.setShaderModuleProps({...next, shadow: {...shadow, shadowMaps: []}});
  }

  protected getDrawModel(_params: Parameters<Layer['draw']>[0]): Model | undefined {
    return this.state.model;
  }

  draw(params: Parameters<Layer['draw']>[0]): void {
    const {shaderModuleProps} = params;
    const {resources} = this.state;
    if (!resources || !this.props.stateTexture || !this.getNumInstances()) return;
    const shadowPass = Boolean(shaderModuleProps?.shadow?.drawToShadowMap);
    const mode = this.props._shadowPass;
    if ((mode === 'only' && !shadowPass) || (mode === 'skip' && shadowPass)) return;
    if (shadowPass && !prepareShadowDraw(this)) return;
    const model = this.getDrawModel(params);
    if (!model) return;
    const {windStrength, windDirection, windTime, windGustTime, windOrigin, windUnits, species} =
      this.props;
    const {wetness, frost, fog} = this.props;
    const time = windTime ?? this.context.timeline.getTime() / 1000;
    const {shape, look, nextLook, leafBlades, woodLevel, fixedLeafShadowShare} = this.prepareDraw(
      model,
      shadowPass
    );
    const stormy = Boolean(windDirection) && windStrength > TREE_WIND_STRONG_FROM;
    model.shaderInputs.setProps({
      treePhotoreal: {
        wind: [
          windStrength,
          windDirection?.[0] ?? 0,
          windDirection?.[1] ?? 0,
          windDirection ? 1 : 0
        ],
        clock: [
          time,
          nextLook?.[0] ?? 0,
          nextLook?.[1] ?? 0,
          shaderModuleProps?.project?.viewport instanceof GlobeViewport ? 1 : 0
        ],
        world: [windOrigin[0], windOrigin[1], windUnits[0], windUnits[1]],
        shape,
        look,
        weather: [wetness, frost, fog ? fog.density : 0, fixedLeafShadowShare ?? 0],
        shadowHistoryWeight: this.state.shadowHistoryWeight,
        fog: fog ? [...getTreeFogLight(fog.color), 1] : [0, 0, 0, 0],
        leafBlades: leafBlades ?? [0, 0, 0, 0],
        woodLevel: woodLevel ?? [0, 0, 0, 0],
        // How much of a flip's paleness shows: more where a storm holds a blade over and shows its underside. That
        // it is more says a storm's terms are to come in, which is all they ask before they cost anything.
        gust: [windGustTime ?? time, ...getTreeLeafPaleness(stormy ? windStrength : 0)],
        ...TREE_BARK_STYLES[species]
      } satisfies TreePhotorealUniforms
    });
    model.setBindings({treeState: this.props.stateTexture, treeLimbs: resources.limbs});
    const {shadowMaps, dummyShadowMap, modelReadsShadows} = this.state;
    if (dummyShadowMap && modelReadsShadows) {
      // Never the map being drawn: a shadow pass has none here.
      model.setBindings({
        treeShadowMap0: shadowMaps[0] ?? dummyShadowMap,
        treeShadowMap1: shadowMaps[1] ?? dummyShadowMap
      });
    }
    this.setTemplateBindings(model, resources);
    model.setInstanceCount(this.getNumInstances());
    this.drawPreparedModel(model, params, shadowPass);
    if (windStrength > 0 && windTime === null) this.setNeedsRedraw();
  }

  /** Draw the already-bound model; specialized parts may split its visible geometry into batches. */
  protected drawPreparedModel(
    model: Model,
    {renderPass}: Parameters<Layer['draw']>[0],
    _shadowPass: boolean
  ): void {
    model.draw(renderPass);
  }

  /** Binds the textures only this part reads. */
  protected setTemplateBindings(_model: Model, _resources: TreeTemplateResources): void {}

  /** Whether this part's shaders sample the shadow maps, which then must be bound. */
  protected readsShadowMaps(): boolean {
    return this.context.defaultShaderModules.some(module => module.name === 'shadow');
  }
}
