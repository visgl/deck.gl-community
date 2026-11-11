// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The far renderer: every tree of a field as a crown hull and a stub of trunk, and a soft patch of shadow on the
 * ground under each. JavaScript sorts the cells to draw into six buckets, by level and by whether they may dissolve,
 * once a frame (`ShellField.order`). A transform-feedback pass then works out each drawn tree from its state row and
 * its cell's fade, one invocation per tree, into its bucket's buffer; hulls and patches are instanced over a bucket
 * and read that buffer as instance attributes. Nothing per tree is written from JavaScript on a frame in which only
 * the camera moved.
 *
 * What this found costs a frame, and so avoids:
 * - Vertices that only cull themselves are not free: their triangles still go through assembly. So every draw
 *   covers exactly its bucket's trees, and cells out of view are not drawn at all.
 * - Per-tree work in a vertex shader is done once per vertex; here it is done once per tree, in the transform.
 * - A draw that may discard, or that blends, turns off hidden-surface removal, and with 4x MSAA every overlapping
 *   fragment is then shaded. deck.gl leaves blending on and replaces each model's parameters before a draw, and its
 *   picking filter can discard: so hull models set their own parameters in `draw`, and pick by hand.
 * - Small triangles under MSAA shade each edge pixel once per triangle: small trees are lit per vertex.
 *
 * Levels: 10 triangles under `lodPixels[0]` across, 36 up to `lodPixels[1]`, then 100 lit per pixel, with a darker
 * core and an outer hull of leaves that may discard. Back faces are culled: a hull is closed.
 */

import {
  Layer,
  picking,
  project32,
  type DefaultProps,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import {Buffer, type Device, type Texture} from '@luma.gl/core';
import {BufferTransform, Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {prepareShadowDraw} from '../../../../modules/layers/src/splat-layer/splat-shadow';
import {
  TREE_STATE_TEXTURE_WIDTH,
  type TreeGrowthModel
} from '../../../../modules/layers/src/tree-layer/tree-photoreal-layout';
import {
  getTreeFogLight,
  getTreeLeafPaleness,
  TREE_BARK_STYLES,
  treePhotoreal,
  type TreePhotorealUniforms
} from '../../../../modules/layers/src/tree-layer/tree-photoreal-shaders';
import type {TreeStateStore} from '../../../../modules/layers/src/tree-layer/tree-state-store';
import {
  getShellGroundShaders,
  getShellHullShaders,
  getShellTreeShaders,
  SHELL_TREE_OUTPUTS,
  shellUniforms,
  type ShellUniforms
} from './shell-shaders';

/** One level of hull: its fitted lines, and its strip of vertex indices, hull then stub. */
export type ShellHullLevel = {
  data: Float32Array;
  width: number;
  height: number;
  vertices: number;
  strip: Uint16Array;
};

/** Everything the far renderer holds for a field. Built once; the per-frame parts are mutated in place. */
export type ShellField = {
  store: TreeStateStore;
  /** Template of each state row, -1 for a row that holds no tree. */
  templates: Float32Array;
  /** Tiny, coarse and fine hulls. */
  levels: [ShellHullLevel, ShellHullLevel, ShellHullLevel];
  /** One RGBA32F texel per cell: fade start, from, to, seconds for a whole fade. */
  cells: Float32Array;
  cellWidth: number;
  cellHeight: number;
  rowsPerCell: number;
  /** Bumped when `cells` changed. */
  cellsRevision: number;
  /**
   * The cells to draw this frame, sorted by bucket: level (0 tiny, 1 coarse, 2 fine) plus 3 for cells that may
   * dissolve, as they hand over or hold thin crowns. `bucketStarts[b]` is bucket b's first entry, 7 entries.
   */
  order: Float32Array;
  orderWidth: number;
  bucketStarts: Int32Array;
  /** Bumped when `order` changed. */
  orderRevision: number;
  forkZ: number;
  models: TreeGrowthModel[];
};

export type ShellLayerProps = LayerProps & {
  field: ShellField;
  data: unknown[];
  /** Timeline seconds, for the cells' fades. */
  time: number;
  windStrength: number;
  windDirection: readonly [number, number] | null;
  windTime: number | null;
  wetness?: number;
  frost?: number;
  windOrigin: readonly [number, number];
  windUnits: readonly [number, number];
  /** Mottle strength, gap darkness, specular, brightness. */
  look: [number, number, number, number];
  tint: [number, number, number, number];
  /** Darkness and softness of the ground patches; 0 darkness draws none. */
  groundShadow: [number, number];
  /** Whether hulls draw into deck.gl's shadow map. */
  castShadows: boolean;
  /** Of fine trees: the core's scale and darkness, the outer leaves' share, and their length on screen in pixels. */
  leaf: [number, number, number, number];
  /** Of fine trees: the outer leaves' scale, the gain of light by the pixel, how much leaves thin at the rim. */
  outer: [number, number, number, number];
  /** Crown width, in pixels, from which a tree takes the coarse hull, and the fine one, lit by the pixel. */
  lodPixels: [number, number];
  material?: unknown;
  /** Experiments: 1 no dissolve draws, 8 no leafy outer hulls, 16 no ground patches, 32 no culling. */
  debug: number;
};

const defaultProps: DefaultProps<ShellLayerProps> = {
  field: {type: 'object', value: null, compare: false, ignore: true} as never,
  time: 0,
  windStrength: 0,
  windDirection: {type: 'array', value: null, optional: true, compare: true},
  windTime: null,
  wetness: 0,
  frost: 0,
  windOrigin: {type: 'array', value: [0, 0], compare: true},
  windUnits: {type: 'array', value: [1, 1], compare: true},
  look: {type: 'array', value: [0.6, 0.35, 0.25, 1], compare: true},
  tint: {type: 'array', value: [1, 1, 1, 1], compare: true},
  groundShadow: {type: 'array', value: [0.45, 0.25], compare: true},
  castShadows: false,
  lodPixels: {type: 'array', value: [12, 40], compare: true},
  leaf: {type: 'array', value: [0.88, 0.75, 0.66, 4], compare: true},
  outer: {type: 'array', value: [1.05, 1.2, 0.8, 0], compare: true},
  debug: 0,
  material: {type: 'object', value: null, compare: 2, optional: true}
};

const SHADOW_UNIFORM_BLOCK = /* glsl */ `
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

/** deck.gl's shadow module slimmed as photoreal's is: matrices and the depth it packs, no lookups of its own. */
const SLIM_SHADOW_VS = /* glsl */ `${SHADOW_UNIFORM_BLOCK}
vec4 shadow_setVertexPosition(vec4 position_commonspace) {
  if (!shadow.drawShadowMap) return gl_Position;
  return shadow.lightId == 0
    ? project_common_position_to_clipspace(position_commonspace, shadow.viewProjectionMatrix0, shadow.projectCenter0)
    : project_common_position_to_clipspace(position_commonspace, shadow.viewProjectionMatrix1, shadow.projectCenter1);
}
`;
const SLIM_SHADOW_FS = /* glsl */ `${SHADOW_UNIFORM_BLOCK}
vec4 shadow_filterShadowColor(vec4 color) {
  if (!shadow.drawShadowMap) return color;
  const vec4 bitPackShift = vec4(1.0, 255.0, 65025.0, 16581375.0);
  const vec4 bitMask = vec4(1.0 / 255.0, 1.0 / 255.0, 1.0 / 255.0, 0.0);
  vec4 rgbaDepth = fract(gl_FragCoord.z * bitPackShift);
  return rgbaDepth - rgbaDepth.gbaa * bitMask;
}
`;
const SLIM_SHADOW = new WeakMap<object, unknown>();

function getSlimShadowModule<ModuleT extends {name: string}>(module: ModuleT): ModuleT {
  if (module.name !== 'shadow') return module;
  let slim = SLIM_SHADOW.get(module) as ModuleT | undefined;
  if (!slim) {
    const {getUniforms} = module as unknown as {
      getUniforms: (...args: unknown[]) => Record<string, unknown>;
    };
    slim = {
      ...module,
      vs: SLIM_SHADOW_VS,
      fs: SLIM_SHADOW_FS,
      getUniforms: (...args: unknown[]) => {
        const {shadow_uShadowMap0: _a, shadow_uShadowMap1: _b, ...uniforms} = getUniforms(...args);
        return uniforms;
      }
    };
    SLIM_SHADOW.set(module, slim);
  }
  return slim;
}

const PICKING_SHADOW = new WeakMap<object, Record<string, any>>();
const RASTERIZER_DISCARD = 0x8c89;
const TREE_STRIDE = SHELL_TREE_OUTPUTS.length * 16;

type SunState = {direction: [number, number, number]; casts: boolean} | null;
type HullDraw = {
  model: Model;
  level: 0 | 1 | 2;
  pass: 0 | 1 | 2;
  /** The draw whose uniforms it has, and the buffer it reads, so that neither is set again for nothing. */
  frame: number;
  buffer: Buffer | null;
};

export class ShellLayer extends Layer<Required<ShellLayerProps>> {
  static layerName = 'ShellLayer';
  static defaultProps = defaultProps;

  declare state: {
    trees?: BufferTransform;
    /** Per bucket, the records of its trees this frame, and how many rows each can hold. */
    bucketBuffers: (Buffer | null)[];
    bucketCapacity: number[];
    hulls: HullDraw[];
    ground?: Model;
    stateTexture?: Texture;
    hullTextures: Texture[];
    strips: Buffer[];
    cellTexture?: Texture;
    orderTexture?: Texture;
    rowsTexture?: Texture;
    cellsRevision: number;
    orderRevision: number;
    /** Counts this layer's draws, one a pass, for setting each model's uniforms once a pass. */
    drawCount: number;
    groundBuffer: Buffer | null;
    needsTrees: boolean;
    shadowStrength: number;
    dummyShadowMap?: Texture;
  };

  initializeState(): void {
    this.state.hulls = [];
    this.state.hullTextures = [];
    this.state.strips = [];
    this.state.bucketBuffers = [null, null, null, null, null, null];
    this.state.bucketCapacity = [0, 0, 0, 0, 0, 0];
    this.state.cellsRevision = -1;
    this.state.orderRevision = -1;
    this.state.drawCount = 0;
    this.state.groundBuffer = null;
    this.state.needsTrees = true;
    this.state.shadowStrength = 0;
    const {device} = this.context;
    const {field} = this.props;
    const rowsWidth = 1024;
    const rowsData = new Float32Array(
      rowsWidth * Math.ceil(field.templates.length / rowsWidth)
    ).fill(-1);
    rowsData.set(field.templates);
    this.state.rowsTexture = device.createTexture({
      id: `${this.id}-rows`,
      format: 'r32float',
      width: rowsWidth,
      height: rowsData.length / rowsWidth,
      data: rowsData,
      mipLevels: 1,
      sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
    });
    this.state.hullTextures = field.levels.map((level, index) =>
      device.createTexture({
        id: `${this.id}-hull-${index}`,
        format: 'rgba32float',
        width: level.width,
        height: level.height,
        data: level.data,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      })
    );
    this.state.strips = field.levels.map((level, index) =>
      device.createBuffer({id: `${this.id}-strip-${index}`, usage: Buffer.INDEX, data: level.strip})
    );
    this.createModels(device);
  }

  shouldUpdateState({changeFlags}: Parameters<Layer['shouldUpdateState']>[0]): boolean {
    return Boolean(changeFlags.somethingChanged);
  }

  updateState(params: UpdateParameters<this>): void {
    super.updateState(params);
    // Anything at all may move a tree on screen: work them out again before this frame's first draw.
    this.state.needsTrees = true;
  }

  getModels(): Model[] {
    const models = this.state.hulls.map(hull => hull.model);
    if (this.state.ground) models.push(this.state.ground);
    return models;
  }

  getShaders(shaders: unknown): any {
    const merged = super.getShaders(shaders) as {modules: {name: string}[]};
    return {...merged, modules: merged.modules.map(getSlimShadowModule)};
  }

  private createModels(device: Device): void {
    const {field} = this.props;
    const modules = [project32, picking, phongMaterial, treePhotoreal, shellUniforms];
    const treeLayout = {
      name: 'trees',
      byteStride: TREE_STRIDE,
      stepMode: 'instance',
      attributes: SHELL_TREE_OUTPUTS.map((name, index) => ({
        attribute: name,
        format: 'float32x4',
        byteOffset: index * 16
      }))
    };
    const treeShaders = getShellTreeShaders();
    this.state.trees = new BufferTransform(device, {
      id: `${this.id}-trees`,
      vs: treeShaders.vs,
      fs: treeShaders.fs,
      modules: [project32, phongMaterial, treePhotoreal, shellUniforms],
      vertexCount: 0,
      topology: 'point-list',
      outputs: [...SHELL_TREE_OUTPUTS],
      feedbackBufferMode: 'interleaved'
    } as never);

    const hull = (level: 0 | 1 | 2, pass: 0 | 1 | 2): HullDraw => {
      const model = new Model(device, {
        ...this.getShaders({
          ...getShellHullShaders(pass === 1, level === 2, this.props.debug, pass === 2),
          modules
        }),
        id: `${this.id}-hull-${level}-${pass ? 'dissolve' : 'opaque'}`,
        topology: 'triangle-strip',
        bufferLayout: [treeLayout],
        indexBuffer: this.state.strips[level],
        indexCount: field.levels[level].strip.length,
        isInstanced: true,
        instanceCount: field.templates.length
      } as never);
      return {model, level, pass, frame: -1, buffer: null};
    };
    this.state.hulls = [
      hull(0, 0),
      hull(1, 0),
      hull(2, 0),
      hull(0, 1),
      hull(1, 1),
      hull(2, 1),
      hull(2, 2)
    ];
    this.state.ground = new Model(device, {
      ...this.getShaders({...getShellGroundShaders(), modules}),
      id: `${this.id}-ground`,
      topology: 'triangle-strip',
      bufferLayout: [treeLayout],
      vertexCount: 4,
      isInstanced: true,
      instanceCount: field.templates.length
    } as never);
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]): void {
    super.finalizeState(context);
    for (const model of this.getModels()) model.destroy();
    this.state.trees?.destroy();
    for (const resource of [
      this.state.stateTexture,
      ...this.state.hullTextures,
      ...this.state.strips,
      ...this.state.bucketBuffers,
      this.state.cellTexture,
      this.state.orderTexture,
      this.state.rowsTexture
    ]) {
      resource?.destroy();
    }
  }

  setShaderModuleProps(props: Parameters<Model['shaderInputs']['setProps']>[0]): void {
    let next = props as Record<string, any>;
    if (next.shadow?.dummyShadowMap) PICKING_SHADOW.set(this, next.shadow);
    const previous = PICKING_SHADOW.get(this);
    if (next.picking?.isActive && previous) {
      next = {
        ...next,
        shadow: {...previous, project: next.project, shadowEnabled: false, drawToShadowMap: false}
      };
    }
    const shadow = next.shadow;
    if (!shadow) {
      super.setShaderModuleProps(next);
      return;
    }
    if (shadow.dummyShadowMap) this.state.dummyShadowMap = shadow.dummyShadowMap;
    const maps = !next.picking?.isActive && shadow.shadowMaps ? shadow.shadowMaps : [];
    this.state.shadowStrength = maps.length ? (shadow.shadowColor?.[3] ?? 1) : 0;
    super.setShaderModuleProps({...next, shadow: {...shadow, shadowMaps: []}});
  }

  /** Uploads the store's dirty lines and the cells, once a frame, before the first pass draws. */
  private uploadState(): void {
    const {store} = this.props.field;
    const {device} = this.context;
    let texture = this.state.stateTexture;
    if (!texture || texture.height !== store.lineCount) {
      texture?.destroy();
      texture = device.createTexture({
        id: `${this.id}-state`,
        format: 'rgba32float',
        width: TREE_STATE_TEXTURE_WIDTH,
        height: store.lineCount,
        data: store.data,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      });
      this.state.stateTexture = texture;
      store.clearDirty();
    } else if (store.isDirty) {
      const {dirtyLineStart: y, dirtyLineEnd: end} = store;
      const floatsPerLine = TREE_STATE_TEXTURE_WIDTH * 4;
      texture.writeData(store.data.subarray(y * floatsPerLine, end * floatsPerLine), {
        y,
        height: end - y
      });
      store.clearDirty();
    }
    const {field} = this.props;
    if (!this.state.cellTexture) {
      this.state.cellTexture = device.createTexture({
        id: `${this.id}-cells`,
        format: 'rgba32float',
        width: field.cellWidth,
        height: field.cellHeight,
        data: field.cells,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      });
      this.state.cellsRevision = field.cellsRevision;
    } else if (this.state.cellsRevision !== field.cellsRevision) {
      this.state.cellTexture.writeData(field.cells, {height: field.cellHeight});
      this.state.cellsRevision = field.cellsRevision;
    }
    if (!this.state.orderTexture) {
      this.state.orderTexture = device.createTexture({
        id: `${this.id}-order`,
        format: 'r32float',
        width: field.orderWidth,
        height: field.order.length / field.orderWidth,
        data: field.order,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      });
      this.state.orderRevision = field.orderRevision;
    } else if (this.state.orderRevision !== field.orderRevision) {
      this.state.orderTexture.writeData(field.order, {
        height: field.order.length / field.orderWidth
      });
      this.state.orderRevision = field.orderRevision;
    }
  }

  /** A bucket's buffer, grown to a power of two of rows when it must be. */
  private getBucketBuffer(bucket: number, rows: number): Buffer {
    const {bucketBuffers, bucketCapacity} = this.state;
    let buffer = bucketBuffers[bucket];
    if (!buffer || bucketCapacity[bucket] < rows) {
      buffer?.destroy();
      const capacity = 2 ** Math.ceil(Math.log2(Math.max(rows, 256)));
      buffer = this.context.device.createBuffer({
        id: `${this.id}-bucket-${bucket}`,
        usage: Buffer.VERTEX,
        byteLength: capacity * TREE_STRIDE
      });
      bucketBuffers[bucket] = buffer;
      bucketCapacity[bucket] = capacity;
    }
    return buffer;
  }

  private getSun(): SunState {
    const effects = (this.context.deck?.props as {effects?: unknown[]} | undefined)?.effects ?? [];
    for (const effect of effects as {
      directionalLights?: {direction: number[]; shadow?: boolean}[];
    }[]) {
      const light = effect.directionalLights?.[0];
      if (light) {
        const [x, y, z] = light.direction;
        return {direction: [x, y, z], casts: Boolean(light.shadow)};
      }
    }
    return null;
  }

  private getUniforms(): {photoreal: TreePhotorealUniforms; shell: ShellUniforms} {
    const {field, windStrength, windDirection, windTime, windOrigin, windUnits, time} = this.props;
    const clock = windTime ?? this.context.timeline.getTime() / 1000;
    const photoreal: TreePhotorealUniforms = {
      wind: [windStrength, windDirection?.[0] ?? 0, windDirection?.[1] ?? 0, windDirection ? 1 : 0],
      clock: [clock, 0, 0, 0],
      gust: [clock, ...getTreeLeafPaleness(windDirection ? windStrength : 0)],
      world: [windOrigin[0], windOrigin[1], windUnits[0], windUnits[1]],
      shape: [field.forkZ, 0, 0, 0],
      look: [0.64, 0.55, this.state.shadowStrength, 1],
      shadowHistoryWeight: 0,
      weather: [this.props.wetness ?? 0, this.props.frost ?? 0, 0, 0],
      fog: [...getTreeFogLight([0, 0, 0]), 0],
      leafBlades: [0, 0, 0, 0],
      woodLevel: [0, 0, 0, 0],
      ...TREE_BARK_STYLES.citrus
    };
    const sun = this.getSun();
    let sunUniform: ShellUniforms['sun'] = [0, 0, 1, 0];
    let lightUniform: ShellUniforms['light'] = [0, 0, 1, 0];
    if (sun) {
      const [x, y, z] = sun.direction;
      const horizontal = Math.hypot(x, y) || 1;
      const length = Math.hypot(x, y, z) || 1;
      sunUniform = [x / horizontal, y / horizontal, -z / length, sun.casts ? 1 : 0];
      lightUniform = [-x / length, -y / length, -z / length, 1];
    }
    const [groundDark, groundSoft] = this.props.groundShadow;
    return {
      photoreal,
      shell: {
        timing: [time, 0, 0, this.props.castShadows ? 1 : 0],
        hull: [field.levels[1].vertices, 1, this.props.lodPixels[1], this.props.lodPixels[0]],
        look: this.props.look,
        tint: this.props.tint,
        cells: [field.cellWidth, field.rowsPerCell, groundDark, groundSoft],
        sun: groundDark > 0 && !(this.props.debug & 16) ? sunUniform : [0, 0, 1, 0],
        light: lightUniform,
        leaf: this.props.leaf,
        outer: this.props.outer
      }
    };
  }

  /** Every tree, once a frame, in the first pass that draws. */
  private runTrees(
    renderPass: Parameters<Layer['draw']>[0]['renderPass'],
    shaderModuleProps: Record<string, any>,
    uniforms: ReturnType<ShellLayer['getUniforms']>
  ): void {
    const trees = this.state.trees;
    const {stateTexture, cellTexture, orderTexture, rowsTexture} = this.state;
    const fineTexture = this.state.hullTextures[2];
    if (!trees || !stateTexture || !fineTexture || !cellTexture || !orderTexture || !rowsTexture)
      return;
    const {bucketStarts, rowsPerCell} = this.props.field;
    const model = trees.model;
    model.shaderInputs.setProps({
      project: shaderModuleProps.project,
      treePhotoreal: uniforms.photoreal,
      shell: uniforms.shell
    });
    model.setBindings({
      treeState: stateTexture,
      shellHull: fineTexture,
      shellCells: cellTexture,
      shellOrder: orderTexture,
      shellRows: rowsTexture
    });
    const gl = (this.context.device as unknown as {gl: WebGL2RenderingContext}).gl;
    gl.enable(RASTERIZER_DISCARD);
    try {
      for (let bucket = 0; bucket < 6; bucket++) {
        const rows = (bucketStarts[bucket + 1] - bucketStarts[bucket]) * rowsPerCell;
        if (!rows) continue;
        trees.transformFeedback.setBuffers({
          [SHELL_TREE_OUTPUTS[0]]: this.getBucketBuffer(bucket, rows)
        });
        model.setDrawOffsets({firstVertex: bucketStarts[bucket] * rowsPerCell, firstIndex: 0});
        model.setVertexCount(rows);
        model.draw(renderPass);
      }
    } finally {
      gl.disable(RASTERIZER_DISCARD);
    }
    this.state.needsTrees = false;
  }

  draw({shaderModuleProps, renderPass}: Parameters<Layer['draw']>[0]): void {
    const {field} = this.props;
    // A runtime override for measuring parts of a frame a moment apart: bits as for the `debug` prop, plus 4096 to
    // draw nothing at all, 512 no tiny level, 1024 no coarse, 2048 no fine.
    const runtime = (globalThis as {shellDebug?: number}).shellDebug;
    const debug = typeof runtime === 'number' ? runtime : this.props.debug;
    if (debug & 4096) return;
    const shadowPass = Boolean(shaderModuleProps?.shadow?.drawToShadowMap);
    const pickPass = Boolean(shaderModuleProps?.picking?.isActive);
    if (shadowPass && (!this.props.castShadows || !prepareShadowDraw(this))) return;
    this.state.drawCount++;
    this.uploadState();
    const uniforms = this.getUniforms();
    if (this.state.needsTrees) this.runTrees(renderPass, shaderModuleProps, uniforms);
    const {bucketStarts, rowsPerCell} = field;
    const parameters = {
      ...(this.props.parameters as object),
      cullMode: debug & 32 ? 'none' : 'back',
      blend: false,
      depthWriteEnabled: true,
      depthCompare: 'less-equal'
    };
    for (let bucket = 0; bucket < 6; bucket++) {
      const rows = (bucketStarts[bucket + 1] - bucketStarts[bucket]) * rowsPerCell;
      const buffer = this.state.bucketBuffers[bucket];
      if (!rows || !buffer) continue;
      // Light needs only the coarse hull.
      const level = shadowPass ? 1 : bucket % 3;
      const dissolving = bucket >= 3;
      if (debug & (512 << level)) continue;
      for (const draw of this.state.hulls) {
        if (draw.level !== level || (draw.pass === 1 && (!dissolving || debug & 1))) continue;
        if (draw.pass === 2 && (shadowPass || debug & 8)) continue;
        const {model, pass} = draw;
        if (draw.frame !== this.state.drawCount) {
          // Once a pass: luma.gl's uniforms allocate each time they are set.
          draw.frame = this.state.drawCount;
          const hull = field.levels[level];
          model.shaderInputs.setProps({
            treePhotoreal: uniforms.photoreal,
            shell: {
              ...uniforms.shell,
              timing: [uniforms.shell.timing[0], pass, 0, uniforms.shell.timing[3]],
              hull: [hull.vertices, level, this.props.lodPixels[1], this.props.lodPixels[0]]
            }
          });
          model.setBindings({shellHull: this.state.hullTextures[level]});
          // deck.gl has just replaced every model's parameters with the layer's, and leaves blending on: an opaque
          // hull that blends cannot have its hidden fragments removed before they are shaded. But its pick pass
          // writes the layer's index through the blend constant's alpha, so there its blending stays.
          model.setParameters(
            (pickPass
              ? {...(model.parameters as object), cullMode: parameters.cullMode}
              : parameters) as never
          );
        }
        if (draw.buffer !== buffer) {
          draw.buffer = buffer;
          model.setAttributes({trees: buffer});
        }
        model.setInstanceCount(rows);
        model.draw(renderPass);
      }
    }
    // The ground patches stand in for the shadows of far trees, so only on screen.
    const ground = this.state.ground;
    if (ground && !shadowPass && !pickPass && uniforms.shell.sun[3] > 0 && !(debug & 16)) {
      ground.shaderInputs.setProps({treePhotoreal: uniforms.photoreal, shell: uniforms.shell});
      ground.setParameters({
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'dst',
        blendColorDstFactor: 'zero',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'zero',
        blendAlphaDstFactor: 'one'
      } as never);
      for (let bucket = 0; bucket < 6; bucket++) {
        const rows = (bucketStarts[bucket + 1] - bucketStarts[bucket]) * rowsPerCell;
        const buffer = this.state.bucketBuffers[bucket];
        if (!rows || !buffer) continue;
        if (this.state.groundBuffer !== buffer) {
          this.state.groundBuffer = buffer;
          ground.setAttributes({trees: buffer});
        }
        ground.setInstanceCount(rows);
        ground.draw(renderPass);
      }
    }
  }
}
