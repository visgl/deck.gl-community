// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {picking, project32, type DefaultProps, type Layer, type Viewport} from '@deck.gl/core';
import {Buffer} from '@luma.gl/core';
import {GPUGeometry, Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {
  TreePhotorealPrimitiveLayer,
  type TreePhotorealLayerProps,
  type TreeTemplateResources
} from './tree-photoreal-primitive-layer';
import {createSplatFrustum} from '../splat-layer/splat-culling';
import {offsetSplatCommonPosition} from '../splat-layer/splat-globe';
import {
  TREE_STATE_TEXELS_PER_ROW,
  TREE_STATE_TEXEL,
  TREE_WOOD_FLAG,
  type TreeGrowthModel
} from './tree-photoreal-layout';
import {
  getTreeWoodClusters,
  getTreeWoodClusterSphere,
  selectTreeWoodClusters,
  type TreeWoodSelection
} from './tree-wood-clusters';
import {getTreeWoodWgslShaders} from './tree-photoreal-wood-wgsl';
import {TREE_WIND_STRONG_FROM} from './tree-wind';
import {
  getTreeWoodShaders,
  treePhotoreal,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';

const WOOD_BYTE_STRIDE = 80;
const STATE_STRIDE = TREE_STATE_TEXELS_PER_ROW * 4;

type WoodRow = {
  stateRow: number;
  common: number[];
  units: number[];
  frame: number[] | null;
};
type WoodVisibility = {
  shape: number[];
  spheres: Float64Array;
  selection: TreeWoodSelection | null;
  selectionPlanes?: Float64Array;
  buffer?: Buffer;
  instanceBuffer?: Buffer;
  capacity: number;
};

const WOOD_LEVEL_CUTS = new WeakMap<TreeGrowthModel, [number, number, number, number]>();

/**
 * For each level of detail, the largest mature radius of wood that the next coarser level no longer draws, and 0 at
 * the last. Roots, soil and collars do not count: the first two do not go by thickness, and a collar lies against
 * the surface of a thick limb, with the radius of that. Worked out once for a template.
 */
function getWoodLevelCuts(template: TreeGrowthModel): [number, number, number, number] {
  const known = WOOD_LEVEL_CUTS.get(template);
  if (known) return known;
  const {indices, radial, shade, lodIndexCounts} = template.wood;
  const cuts: [number, number, number, number] = [0, 0, 0, 0];
  for (let lod = 0; lod < 3; lod++) {
    let cut = 0;
    for (let i = lodIndexCounts[lod + 1]; i + 2 < lodIndexCounts[lod]; i += 3) {
      const a = indices[i] * 4 + 3;
      if ((shade[a] & (TREE_WOOD_FLAG.ROOT | TREE_WOOD_FLAG.SOIL | TREE_WOOD_FLAG.COLLAR)) !== 0)
        continue;
      const thinnest = Math.min(
        radial[a],
        radial[indices[i + 1] * 4 + 3],
        radial[indices[i + 2] * 4 + 3]
      );
      if (thinnest > cut) cut = thinnest;
    }
    cuts[lod] = cut;
  }
  WOOD_LEVEL_CUTS.set(template, cuts);
  return cuts;
}

/** Index buffers belong to the shared template, so a model's geometry must not destroy them. */
class SharedWoodGeometry extends GPUGeometry {
  destroy(): void {}
}

/**
 * Connected wood of one template at one level of detail: a shared mesh instanced by state row. The
 * vertex stage grows, breaks, tips, bends and rots it from the state texture alone, so animating a tree
 * rewrites no attribute. `lodIndexCounts` are prefixes of one index buffer: thick wood first.
 */
export class TreePhotorealWoodLayer<DataT = unknown> extends TreePhotorealPrimitiveLayer<DataT> {
  static layerName = 'TreePhotorealWoodLayer';
  static defaultProps: DefaultProps<TreePhotorealLayerProps & {_woodCulling?: boolean}> = {
    ...TreePhotorealPrimitiveLayer.defaultProps,
    _woodCulling: true
  };

  declare state: TreePhotorealPrimitiveLayer<DataT>['state'] & {
    opaqueModel?: Model;
    woodFrustum?: {matrix: number[]; width: number; height: number; planes: Float64Array};
    woodVisibility?: Map<number, WoodVisibility>;
    woodCullingActive?: boolean;
    woodSubmittedIndices?: number;
    woodOriginalIndices?: number;
  };

  getShaders(opaque = false) {
    if (this.context.device.type === 'webgpu') {
      return super.getShaders(getTreeWoodWgslShaders(this.props.lod));
    }
    return super.getShaders({
      ...getTreeWoodShaders(this.props.lod, opaque, this.props.species),
      modules: [project32, picking, phongMaterial, treePhotoreal]
    });
  }

  protected createModel(resources: TreeTemplateResources): Model {
    const {template} = this.props;
    // Eager models are prepared at startup, so the first macro dive never has to bin triangles.
    getTreeWoodClusters(template, this.props.lod);
    const geometry = new SharedWoodGeometry({
      topology: 'triangle-list',
      vertexCount: template.wood.vertexCount,
      indices: resources.woodIndices,
      attributes: {treeWood: resources.woodVertices},
      bufferLayout: [
        {
          name: 'treeWood',
          stepMode: 'vertex',
          byteStride: WOOD_BYTE_STRIDE,
          attributes: [
            {attribute: 'treeCenter', format: 'float32x4', byteOffset: 0},
            {attribute: 'treePrevious', format: 'float32x4', byteOffset: 16},
            {attribute: 'treeRadial', format: 'float32x4', byteOffset: 32},
            {attribute: 'treeBark', format: 'float32x4', byteOffset: 48},
            {attribute: 'treeShade', format: 'float32x4', byteOffset: 64}
          ]
        }
      ]
    });
    const makeModel = (opaque: boolean) =>
      new Model(this.context.device, {
        ...this.getShaders(opaque),
        id: opaque ? `${this.id}-opaque` : this.id,
        geometry,
        bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
        isInstanced: true
      });
    if (
      this.context.device.type === 'webgl' &&
      this.props._shadowPass === 'skip' &&
      this.props.parameters?.blend === false &&
      !this.props.extensions?.length
    ) {
      this.state.opaqueModel = makeModel(true);
    }
    return makeModel(false);
  }

  getModels(): Model[] {
    const {model, opaqueModel} = this.state;
    return model ? (opaqueModel ? [model, opaqueModel] : [model]) : [];
  }

  protected getDrawModel(params: Parameters<Layer['draw']>[0]): Model | undefined {
    const {model, opaqueModel} = this.state;
    const {props} = this;
    const data = props._stateData;
    const rows = props.data as unknown as WoodRow[];
    if (
      !opaqueModel ||
      props._shadowPass !== 'skip' ||
      props.parameters?.blend !== false ||
      props.opacity !== 1 ||
      props.autoHighlight ||
      (typeof props.highlightedObjectIndex === 'number' && props.highlightedObjectIndex >= 0) ||
      params.shaderModuleProps?.picking?.isActive ||
      !data ||
      !Array.isArray(rows)
    ) {
      return model;
    }
    const {LIFE, POSE, MISC, TRUNK} = TREE_STATE_TEXEL;
    // These rows cannot tear, rot away or dither during the draw. Their shader has no
    // discard, so it can reject hidden bark before evaluating its material.
    for (const row of rows) {
      if (!row) continue;
      const base = row.stateRow * STATE_STRIDE;
      if (
        data[base + LIFE * 4] !== 1 ||
        data[base + POSE * 4] !== 0 ||
        data[base + POSE * 4 + 2] !== 0 ||
        !(data[base + POSE * 4 + 3] <= 0.45) ||
        data[base + MISC * 4 + 2] !== 1 ||
        data[base + TRUNK * 4 + 3] !== 1
      ) {
        return model;
      }
    }
    return opaqueModel;
  }

  protected onModelReleased(): void {
    this.state.opaqueModel?.destroy();
    this.state.opaqueModel = undefined;
    for (const entry of this.state.woodVisibility?.values() ?? []) {
      entry.buffer?.destroy();
      entry.instanceBuffer?.destroy();
    }
    this.state.woodVisibility = undefined;
    this.state.woodFrustum = undefined;
  }

  private getWoodFrustum(viewport: Viewport): Float64Array {
    const {width, height, viewProjectionMatrix} = viewport;
    const cached = this.state.woodFrustum;
    if (
      cached?.width === width &&
      cached.height === height &&
      cached.matrix.every((value, index) => value === viewProjectionMatrix[index])
    ) {
      return cached.planes;
    }
    // The viewport may expose a mutable matrix. Keep an independent snapshot of its values.
    const matrix = Array.from(viewProjectionMatrix);
    const planes = createSplatFrustum({matrix, center: [0, 0, 0, 0], width, height}, 2);
    this.state.woodFrustum = {matrix, width, height, planes};
    return planes;
  }

  protected drawPreparedModel(
    model: Model,
    params: Parameters<Layer['draw']>[0],
    shadowPass: boolean
  ): void {
    const props = this.props as typeof this.props & {_woodCulling?: boolean};
    const highlight = props.highlightedObjectIndex;
    const data = props._stateData;
    const viewport = params.shaderModuleProps?.project?.viewport ?? this.context.viewport;
    const rows = props.data as unknown as WoodRow[];
    this.state.woodCullingActive = false;
    this.state.woodOriginalIndices =
      props.template.wood.lodIndexCounts[props.lod] * this.getNumInstances();
    this.state.woodSubmittedIndices = this.state.woodOriginalIndices;
    if (
      props._woodCulling === false ||
      shadowPass ||
      params.shaderModuleProps?.picking?.isActive ||
      (typeof highlight === 'number' && highlight >= 0) ||
      props.extensions?.length ||
      props.modelMatrix ||
      props.opacity < 1 ||
      !data ||
      !viewport ||
      !Array.isArray(rows)
    ) {
      super.drawPreparedModel(model, params, shadowPass);
      return;
    }
    const {device} = this.context;
    const originalInstances =
      device.type === 'webgpu'
        ? this.getAttributeManager()!.attributes.instanceTreeRow.getBuffer()
        : null;
    if (device.type === 'webgpu' && !originalInstances) {
      super.drawPreparedModel(model, params, shadowPass);
      return;
    }
    const {LIFE, POSE, MISC} = TREE_STATE_TEXEL;
    // Unsupported deformation keeps precisely the original draw, including every root and collar.
    for (const row of rows) {
      if (!row) continue;
      const base = row.stateRow * STATE_STRIDE;
      if (
        row.frame ||
        !row.common ||
        !row.units ||
        data[base + LIFE * 4] !== 1 ||
        data[base + POSE * 4] !== 0 ||
        data[base + POSE * 4 + 2] !== 0 ||
        data[base + POSE * 4 + 3] !== 0 ||
        props.windStrength * data[base + MISC * 4 + 1] > TREE_WIND_STRONG_FROM
      ) {
        super.drawPreparedModel(model, params, shadowPass);
        return;
      }
    }
    const planes = this.getWoodFrustum(viewport);
    const clusters = getTreeWoodClusters(props.template, props.lod);
    this.state.woodVisibility ??= new Map();
    const cache = this.state.woodVisibility;
    const {SIZE, ANCHOR} = TREE_STATE_TEXEL;
    const ratio = props.template.trunkRatio ?? 0;
    const cuts = getWoodLevelCuts(props.template)[props.lod];
    this.state.woodCullingActive = true;
    this.state.woodSubmittedIndices = 0;
    for (const row of rows) {
      if (!row) continue;
      const base = row.stateRow * STATE_STRIDE;
      const crownX = data[base + SIZE * 4];
      const crownY = data[base + SIZE * 4 + 1];
      const height = data[base + SIZE * 4 + 2];
      const trunk = data[base + SIZE * 4 + 3];
      const trunkRadius = data[base + MISC * 4];
      const yaw = data[base + ANCHOR * 4 + 3];
      const force = props.windStrength * data[base + MISC * 4 + 1];
      const shape = [
        crownX,
        crownY,
        height,
        trunk,
        trunkRadius,
        yaw,
        force,
        ...row.common,
        ...row.units
      ];
      let entry = cache.get(row.stateRow);
      if (!entry || shape.some((value, index) => value !== entry?.shape[index])) {
        const spheres = new Float64Array(clusters.length * 4);
        const unit = Math.max(...row.units);
        clusters.forEach((cluster, index) => {
          const sphere = getTreeWoodClusterSphere(
            cluster,
            crownX,
            crownY,
            height,
            trunk,
            trunkRadius,
            props.template.forkZ,
            yaw,
            force
          );
          const common = offsetSplatCommonPosition(row.common, sphere.center, row.units, null);
          spheres.set([common[0], common[1], common[2], sphere.radius * unit], index * 4);
        });
        entry = {...entry, shape, spheres, selection: null, capacity: entry?.capacity ?? 0};
        cache.set(row.stateRow, entry);
      }
      let selection = entry.selection;
      if (!selection || entry.selectionPlanes !== planes) {
        const {spheres} = entry;
        selection = selectTreeWoodClusters(
          clusters,
          (_cluster, index) => {
            const offset = index * 4;
            for (let plane = 0; plane < 24; plane += 4) {
              if (
                planes[plane] * spheres[offset] +
                  planes[plane + 1] * spheres[offset + 1] +
                  planes[plane + 2] * spheres[offset + 2] +
                  planes[plane + 3] <
                -spheres[offset + 3]
              )
                return false;
            }
            return true;
          },
          entry.selection
        );
        entry.selectionPlanes = planes;
      }
      if (selection !== entry.selection && selection.indices.length) {
        if (!entry.buffer || entry.capacity < selection.indices.length) {
          entry.buffer?.destroy();
          entry.capacity = 2 ** Math.ceil(Math.log2(selection.indices.length));
          entry.buffer = this.context.device.createBuffer({
            id: `${this.id}-visible-${row.stateRow}`,
            usage: Buffer.INDEX | Buffer.COPY_DST,
            byteLength: entry.capacity * 4,
            indexType: 'uint32'
          });
        }
        entry.buffer.write(selection.indices);
      }
      entry.selection = selection;
      if (!selection.indices.length || !entry.buffer) continue;
      this.state.woodSubmittedIndices += selection.indices.length;
      model.setIndexBuffer(entry.buffer);
      model.setIndexCount(selection.indices.length);
      model.setInstanceCount(1);
      if (originalInstances) {
        // Each draw needs a stable row until the WebGPU pass submits all of them.
        entry.instanceBuffer ??= device.createBuffer({
          id: `${this.id}-instance-${row.stateRow}`,
          usage: Buffer.VERTEX,
          data: new Float32Array([row.stateRow])
        });
        model.setAttributes({instanceTreeRow: entry.instanceBuffer});
      } else {
        model.shaderInputs.setProps({
          treePhotoreal: {
            woodLevel: [cuts, ratio, ratio / (props.template.crownAspect ?? 1), row.stateRow + 1]
          }
        });
      }
      model.draw(params.renderPass);
    }
    if (originalInstances) model.setAttributes({instanceTreeRow: originalInstances});
  }

  protected prepareDraw(
    model: Model,
    shadowPass: boolean
  ): Pick<TreePhotorealUniforms, 'shape' | 'look' | 'woodLevel'> {
    const {template, lod} = this.props;
    model.setIndexBuffer(this.state.resources!.woodIndices);
    // Light does not need the finest twigs.
    const drawn = shadowPass ? Math.min(3, lod + 1) : lod;
    model.setIndexCount(template.wood.lodIndexCounts[drawn]);
    // The template's trunk radius in its units of height and across, which its roots and plate of soil keep to.
    const ratio = template.trunkRatio ?? 0;
    return {
      shape: [template.forkZ, template.leafCount, 0, 0],
      look: [0, 1, this.state.shadowStrength, lod === 0 ? 0 : 1],
      woodLevel: [getWoodLevelCuts(template)[drawn], ratio, ratio / (template.crownAspect ?? 1), 0]
    };
  }
}
