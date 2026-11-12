// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {getTreeCropWgslShaders} from './tree-photoreal-crop-wgsl';
import {picking, project32, type DefaultProps} from '@deck.gl/core';
import {Buffer, type Device, type Texture} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {
  getTreeCropGeometry,
  getTreeCropTable,
  TREE_CROP_FLOWER_CLUSTER,
  TREE_CROP_VERTEX_STRIDE,
  type CropKind,
  type TreeCropMeshLevel
} from './tree-crop';
import {TREE_TEMPLATE_TEXTURE_WIDTH, type TreeGrowthModel} from './tree-photoreal-layout';
import {
  TreePhotorealPrimitiveLayer,
  type TreePhotorealLayerProps,
  type TreeTemplateResources
} from './tree-photoreal-primitive-layer';
import {
  getTreeCropShaders,
  treePhotoreal,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';

/**
 * Levels of detail of a crop bucket: the mesh it draws, and how thin its crops are. Thinned crops are drawn
 * larger, to keep the coverage of those they stand for.
 */
const CROP_LEVELS: readonly {mesh: TreeCropMeshLevel; thin: number}[] = [
  {mesh: 0, thin: 1},
  {mesh: 1, thin: 1},
  {mesh: 2, thin: 1},
  {mesh: 3, thin: 1},
  {mesh: 3, thin: 1 / 4},
  {mesh: 3, thin: 1 / 16},
  {mesh: 3, thin: 1 / 64}
];

/**
 * Blossoms thin by cluster first: from a little way off a cluster is one white fleck, so one blossom stands for
 * all of them, and every cluster still shows. Beyond that, as other crops do.
 */
const FLOWER_LEVEL_THIN: readonly number[] = [
  1,
  1,
  1,
  1,
  1 / TREE_CROP_FLOWER_CLUSTER,
  1 / (TREE_CROP_FLOWER_CLUSTER * 4),
  1 / (TREE_CROP_FLOWER_CLUSTER * 16)
];

/** Levels of detail a crop bucket can have. */
export const TREE_CROP_LEVEL_COUNT = CROP_LEVELS.length;

/** The fraction of a slot's crops that a level of detail draws. */
export function getTreeCropLevelThin(kind: CropKind, level: number): number {
  return kind === 'flower' ? FLOWER_LEVEL_THIN[level] : CROP_LEVELS[level].thin;
}

/** A crop's radius on screen, in pixels, that its macro mesh and its fine mesh start at. */
export function getTreeCropMeshPixels(kind: CropKind): readonly [number, number] {
  return kind === 'flower' ? [40, 7] : [50, 12];
}

/** The mesh a level of detail draws. */
export function getTreeCropLevelMesh(level: number): TreeCropMeshLevel {
  return CROP_LEVELS[level].mesh;
}

/** Crops per twig attachment of a kind, at a level of detail. */
export function getTreeCropCluster(kind: CropKind, level: number): number {
  return kind === 'flower' && FLOWER_LEVEL_THIN[level] === 1 ? TREE_CROP_FLOWER_CLUSTER : 1;
}

/**
 * A crop casts only where its shadow can be seen: at any other distance a map's texel is larger than it. All
 * fruit near enough for a mesh have one at the fine level, so that is the level that casts. Blossoms cast only
 * when the view is close enough for a few of them to fill it.
 */
const FLOWER_SHADOW_INSTANCES = 400;

function castsShadow(kind: CropKind, mesh: TreeCropMeshLevel, instances: number): boolean {
  return kind === 'flower' ? mesh === 0 && instances <= FLOWER_SHADOW_INSTANCES : mesh === 1;
}

type CropMeshEntry = {vertices: Buffer; indices: Buffer; references: number};

const MESHES = new WeakMap<Device, Map<string, CropMeshEntry>>();

function acquireCropMesh(device: Device, kind: CropKind, mesh: TreeCropMeshLevel): CropMeshEntry {
  let cache = MESHES.get(device);
  if (!cache) {
    cache = new Map();
    MESHES.set(device, cache);
  }
  const key = `${kind}-${mesh}`;
  let entry = cache.get(key);
  if (!entry) {
    const geometry = getTreeCropGeometry(kind, mesh);
    entry = {
      references: 0,
      vertices: device.createBuffer({
        id: `tree-crop-${key}`,
        usage: Buffer.VERTEX,
        data: geometry.vertices
      }),
      indices: device.createBuffer({
        id: `tree-crop-indices-${key}`,
        usage: Buffer.INDEX,
        data: geometry.indices
      })
    };
    cache.set(key, entry);
  }
  entry.references++;
  return entry;
}

function releaseCropMesh(device: Device, kind: CropKind, mesh: TreeCropMeshLevel): void {
  const cache = MESHES.get(device);
  const key = `${kind}-${mesh}`;
  const entry = cache?.get(key);
  if (!cache || !entry || --entry.references > 0) return;
  cache.delete(key);
  entry.vertices.destroy();
  entry.indices.destroy();
}

type CropRanksEntry = {texture: Texture; references: number};

const RANKS = new WeakMap<Device, Map<TreeGrowthModel, CropRanksEntry>>();

function acquireCropRanks(device: Device, model: TreeGrowthModel): Texture {
  let cache = RANKS.get(device);
  if (!cache) {
    cache = new Map();
    RANKS.set(device, cache);
  }
  let entry = cache.get(model);
  if (!entry) {
    const {ranks} = getTreeCropTable(model);
    const height = Math.max(1, Math.ceil(ranks.length / TREE_TEMPLATE_TEXTURE_WIDTH));
    const data = new Float32Array(TREE_TEMPLATE_TEXTURE_WIDTH * height);
    data.set(ranks);
    entry = {
      references: 0,
      texture: device.createTexture({
        id: `tree-crop-ranks-${model.key}`,
        format: 'r32float',
        width: TREE_TEMPLATE_TEXTURE_WIDTH,
        height,
        data,
        mipLevels: 1,
        sampler: {minFilter: 'nearest', magFilter: 'nearest', mipmapFilter: 'none'}
      })
    };
    cache.set(model, entry);
  }
  entry.references++;
  return entry.texture;
}

function releaseCropRanks(device: Device, model: TreeGrowthModel): void {
  const cache = RANKS.get(device);
  const entry = cache?.get(model);
  if (!cache || !entry || --entry.references > 0) return;
  cache.delete(model);
  entry.texture.destroy();
}

/** Crop meshes are shared, so a model's geometry must not destroy their buffers. */
class SharedCropGeometry extends GPUGeometry {
  destroy(): void {}
}

/**
 * The instances of one bucket, as deck.gl binary attribute data: `[tree row, crop index, slot code]` for
 * each. Iterating gives the source row of each crop, as a color extension's accessors expect.
 */
export type TreeCropData<RowT = unknown> = {
  length: number;
  attributes: {instanceCropRef: {value: Float32Array; size: 3}};
  [Symbol.iterator](): Iterator<RowT | undefined>;
};

export type TreePhotorealCropLayerProps<DataT = unknown> = Omit<
  TreePhotorealLayerProps<DataT>,
  'data'
> & {
  data: TreeCropData<DataT>;
  /** Shape and shading of the crop. */
  kind: CropKind;
  /** Any of its crops might have fallen. A far blossom is then a point for each petal, otherwise only one. */
  shedding: boolean;
  /** What a crop's size on screen counts for, in deciding which level of detail draws it. */
  pixelScale: number;
};

const defaultProps: DefaultProps<{
  kind: CropKind;
  shedding: boolean;
  pixelScale: number;
  getCropRef: unknown;
}> = {
  kind: 'fruit',
  shedding: false,
  pixelScale: 1,
  getCropRef: {type: 'accessor', value: [0, 0, 0]}
};

/**
 * One crop kind of one template at one level of detail: an instanced mesh or points, with an instance for
 * each crop a tree could show. Count, radius, ripeness and fall come from the state row, so they animate with
 * no attribute written. `lod` indexes `CROP_LEVELS`. All crops of a tree have a point, and those near the
 * camera also a mesh instance: the vertex stage draws whichever suits the size of each crop on screen.
 *
 * Picking colors encode the tree's state row, not the instance. So `TreeLayer.getPickingInfo` maps a pick
 * straight back to the source row, and highlighting a tree lights all of its crops.
 */
export class TreePhotorealCropLayer<DataT = unknown> extends TreePhotorealPrimitiveLayer<DataT> {
  static layerName = 'TreePhotorealCropLayer';
  static defaultProps = defaultProps as DefaultProps<any>;

  declare state: TreePhotorealPrimitiveLayer<DataT>['state'] & {
    cropRanks?: Texture;
    cropRanksOf?: TreeGrowthModel;
    cropMesh?: {kind: CropKind; mesh: TreeCropMeshLevel};
  };

  private getKind(): CropKind {
    return (this.props as unknown as TreePhotorealCropLayerProps<DataT>).kind;
  }

  private getMesh(): TreeCropMeshLevel {
    return getTreeCropLevelMesh(this.props.lod);
  }

  initializeState(): void {
    super.initializeState();
    const attributes = this.getAttributeManager()!;
    attributes.remove(['instanceTreeRow']);
    attributes.addInstanced({
      instanceCropRef: {size: 3, accessor: 'getCropRef', noAlloc: true}
    });
  }

  private usesWebGpuDot(): boolean {
    return (
      this.context.device.type === 'webgpu' &&
      (this.getMesh() === 3 || (this.getMesh() === 2 && this.getKind() === 'flower'))
    );
  }

  getShaders() {
    if (this.context.device.type === 'webgpu') {
      return super.getShaders(getTreeCropWgslShaders(this.getKind(), this.usesWebGpuDot()));
    }
    return super.getShaders({
      ...getTreeCropShaders(this.getKind(), this.getMesh()),
      modules: [project32, picking, phongMaterial, treePhotoreal]
    });
  }

  protected createModel(_resources: TreeTemplateResources): Model {
    const {device} = this.context;
    const kind = this.getKind();
    const mesh = this.getMesh();
    const geometry = getTreeCropGeometry(kind, mesh);
    this.state.cropRanks = acquireCropRanks(device, this.props.template);
    this.state.cropRanksOf = this.props.template;
    if (this.usesWebGpuDot()) {
      return new Model(device, {
        ...this.getShaders(),
        id: this.props.id,
        topology: 'triangle-list',
        vertexCount: 6,
        bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
        isInstanced: true
      });
    }
    const {vertices, indices} = acquireCropMesh(device, kind, mesh);
    this.state.cropMesh = {kind, mesh};
    const isPoint = mesh === 3 || (mesh === 2 && kind === 'flower');
    return new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      geometry: new SharedCropGeometry({
        topology: isPoint ? 'point-list' : 'triangle-list',
        vertexCount: geometry.vertexCount,
        indices,
        attributes: {cropMesh: vertices},
        bufferLayout: [
          {
            name: 'cropMesh',
            stepMode: 'vertex',
            byteStride: TREE_CROP_VERTEX_STRIDE * 4,
            // A point has no shape of its own, only which part it is.
            attributes: isPoint
              ? [{attribute: 'cropPart', format: 'float32x2', byteOffset: 24}]
              : [
                  {attribute: 'cropPosition', format: 'float32x3', byteOffset: 0},
                  {attribute: 'cropNormal', format: 'float32x3', byteOffset: 12},
                  {attribute: 'cropPart', format: 'float32x2', byteOffset: 24}
                ]
          }
        ]
      }),
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      isInstanced: true
    });
  }

  protected onModelReleased(): void {
    const {device} = this.context;
    if (this.state.cropMesh) {
      releaseCropMesh(device, this.state.cropMesh.kind, this.state.cropMesh.mesh);
      this.state.cropMesh = undefined;
    }
    if (this.state.cropRanksOf) {
      releaseCropRanks(device, this.state.cropRanksOf);
      this.state.cropRanksOf = undefined;
      this.state.cropRanks = undefined;
    }
  }

  draw(params: Parameters<TreePhotorealPrimitiveLayer<DataT>['draw']>[0]): void {
    // A level that has held crops keeps its model, and a view may leave many of them empty.
    if (!this.getNumInstances()) return;
    const shadowPass = Boolean(params.shaderModuleProps?.shadow?.drawToShadowMap);
    if (shadowPass && !castsShadow(this.getKind(), this.getMesh(), this.getNumInstances())) return;
    super.draw(params);
  }

  protected prepareDraw(
    model: Model,
    shadowPass: boolean
  ): Pick<TreePhotorealUniforms, 'shape' | 'look'> & {nextLook: readonly [number, number]} {
    const {template, lod} = this.props;
    const kind = this.getKind();
    const {top, restHeight, stem, indexCount, bodyIndexCount, shadowIndexCount} =
      getTreeCropGeometry(kind, this.getMesh());
    const thin = getTreeCropLevelThin(kind, lod);
    const {shedding, pixelScale} = this.props as unknown as TreePhotorealCropLayerProps<DataT>;
    // The sizes on screen this level draws. Each crop takes the one its size belongs to, whatever it holds.
    const [macroPixels, finePixels] = getTreeCropMeshPixels(kind);
    const nextLook: [number, number] =
      lod === 0
        ? [macroPixels / pixelScale, 1e9]
        : lod === 1
          ? [finePixels / pixelScale, macroPixels / pixelScale]
          : [0, finePixels / pixelScale];
    const drawn = shedding ? indexCount : bodyIndexCount;
    if (!this.usesWebGpuDot()) {
      model.setDrawOffsets({firstVertex: 0, firstIndex: shadowPass ? indexCount : 0});
      model.setIndexCount(shadowPass ? shadowIndexCount : drawn);
    }
    return {
      shape: [template.forkZ, top, restHeight, getTreeCropCluster(kind, lod)],
      look: [thin, Math.sqrt(1 / thin), this.state.shadowStrength, stem],
      nextLook
    };
  }

  protected setTemplateBindings(model: Model, resources: TreeTemplateResources): void {
    model.setBindings({
      treeCropAnchors: resources.cropAnchors,
      treeCropRanks: this.state.cropRanks as Texture
    });
  }
}
