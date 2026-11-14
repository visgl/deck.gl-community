// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {picking, project32, type DefaultProps} from '@deck.gl/core';
import type {Buffer} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {TREE_STATE_TEXEL, TREE_STATE_TEXELS_PER_ROW} from './tree-photoreal-layout';
import {getTreeLeafWgslShaders} from './tree-photoreal-leaf-wgsl';
import {
  acquireTreeLeafIndices,
  getMatureTreeLeafIndices,
  releaseTreeLeafIndices,
  TreePhotorealPrimitiveLayer,
  type MatureTreeLeafIndices,
  type TreePhotorealLayerProps,
  type TreeTemplateResources
} from './tree-photoreal-primitive-layer';
import {
  getTreeLeafCorners,
  getTreeLeafPattern,
  getTreeLeafShaders,
  TREE_LEAF_AIR_CORNERS,
  TREE_LEAF_AIR_PATTERN,
  treePhotoreal,
  type TreeLeafBlade,
  type TreePhotorealUniforms
} from './tree-photoreal-shaders';

// The color-only model still highlights picked trees. Keeping the picking filter out of its
// fragment hook lets opaque leaves reject covered fragments before evaluating their material.
const colorPicking = {
  ...picking,
  inject: {
    ...picking.inject,
    'fs:DECKGL_FILTER_COLOR': {
      ...picking.inject['fs:DECKGL_FILTER_COLOR'],
      injection: 'color = picking_filterHighlightColor(color);'
    }
  }
};

/** How much a leaf's normal bends toward the crown's, and how much gloss remains, by level of detail. */
const LOOK_BY_LOD: readonly (readonly [number, number])[] = [
  [0.05, 1],
  [0.26, 0.85],
  [0.46, 0.7],
  [0.64, 0.55],
  [0.75, 0.45]
];
const STATE_STRIDE = TREE_STATE_TEXELS_PER_ROW * 4;
const LIFE = TREE_STATE_TEXEL.LIFE * 4;
const POSE = TREE_STATE_TEXEL.POSE * 4;

/** The leaves of a finer blade, as deck.gl binary attribute data: `[tree row, leaf index]` for each. */
export type TreeLeafData<RowT = unknown> = {
  length: number;
  attributes: {instanceLeafRef: {value: Float32Array; size: 2}};
  [Symbol.iterator](): Iterator<RowT | undefined>;
};

export type TreePhotorealLeafLayerProps<DataT = unknown> = Omit<
  TreePhotorealLayerProps<DataT>,
  'data'
> & {
  data: DataT[] | TreeLeafData<DataT>;
  /** Which blade to draw. By default, as suits the level of detail. */
  blade?: TreeLeafBlade;
  /** The coarse blade supplied as original `[tree row, leaf index]` references after spatial culling. */
  listed?: boolean;
  /**
   * Draws only the leaves of the coarse blade that are in the air, which that blade leaves out, for the trees of LOD 0
   * that are losing leaves, and nothing in a shadow pass. `'blend'` draws them as soft streaks that blend and write no
   * depth, and `'depth'`, drawn before that, the depth of each at as many of its pixels as it covers of each.
   */
  air?: 'blend' | 'depth' | null;
  /** The `leafBlades` uniform: on-screen sizes of the finer blades, pixels at a metre, and the mean leaf. */
  leafBlades?: TreePhotorealUniforms['leafBlades'];
  /** Conservative prefix shared by the trees in this color bucket. The shader still uses the full tier count. */
  colorLeafCount?: number;
  /** Whether these crowns overlap a shell during its transition to individual leaves. */
  shellTransition?: boolean;
};

/**
 * Individual leaves of one template. The coarse blade is drawn per tree, at one level of detail: vertices are
 * pulled, as `gl_VertexID` gives the leaf and its corner through a shared index buffer, and everything else
 * comes from the leaf texture and the state row. A level of detail draws a prefix of the leaves.
 *
 * The finer blades are drawn per leaf, for a list of those near the camera: a leaf is an instance, its corners
 * are `gl_VertexID`, and they draw nothing in a shadow pass. Their picking colors encode the tree's state row,
 * as crops do.
 */
export class TreePhotorealLeafLayer<DataT = unknown> extends TreePhotorealPrimitiveLayer<DataT> {
  static layerName = 'TreePhotorealLeafLayer';
  static defaultProps = {
    blade: undefined,
    listed: false,
    air: null,
    shellTransition: false,
    leafBlades: {type: 'array', value: [0, 0, 0, 0], compare: true},
    getLeafRef: {type: 'accessor', value: [0, 0]}
  } as DefaultProps<any>;

  declare state: TreePhotorealPrimitiveLayer<DataT>['state'] & {
    leafIndexKey?: string;
    leafIndexBuffer?: Buffer;
    matureIndices?: MatureTreeLeafIndices | null;
    matureModel?: Model;
  };

  private getLeafProps(): TreePhotorealLeafLayerProps<DataT> {
    return this.props as unknown as TreePhotorealLeafLayerProps<DataT>;
  }

  /** The coarse blade for trees at full detail, and the far blade for those whose leaves stand for others. */
  private getBlade(): TreeLeafBlade {
    if (this.getLeafProps().air) return 'coarse';
    return this.getLeafProps().blade ?? (this.props.lod === 0 ? 'coarse' : 'far');
  }

  private isListed(): boolean {
    const blade = this.getBlade();
    return this.getLeafProps().listed || blade === 'fine' || blade === 'macro';
  }

  /** Corners of each leaf, and its triangles as corner indices. A leaf in the air is a quad on screen. */
  private getLeafLayout(): {corners: number; pattern: readonly number[]; key: string} {
    if (this.getLeafProps().air) {
      return {corners: TREE_LEAF_AIR_CORNERS, pattern: TREE_LEAF_AIR_PATTERN, key: 'air'};
    }
    const blade = this.getBlade();
    return {corners: getTreeLeafCorners(blade), pattern: getTreeLeafPattern(blade), key: blade};
  }

  initializeState(): void {
    super.initializeState();
    if (this.isListed()) {
      const attributes = this.getAttributeManager()!;
      attributes.remove(['instanceTreeRow']);
      attributes.addInstanced({
        instanceLeafRef: {size: 2, accessor: 'getLeafRef', noAlloc: true}
      });
    }
  }

  getShaders(mature = false) {
    const {air, listed, shellTransition} = this.getLeafProps();
    if (this.context.device.type === 'webgpu') {
      return super.getShaders(
        getTreeLeafWgslShaders(
          this.getBlade(),
          air,
          Boolean(listed),
          this.props.species,
          shellTransition
        )
      );
    }
    return super.getShaders({
      ...getTreeLeafShaders(
        this.getBlade(),
        air ?? undefined,
        listed,
        this.props.species,
        shellTransition
      ),
      defines: mature ? {TREE_MATURE_ATTACHED_LEAVES: 1} : {},
      modules: [project32, mature ? colorPicking : picking, phongMaterial, treePhotoreal]
    });
  }

  protected createModel(resources: TreeTemplateResources): Model {
    const {template, lod} = this.props;
    const {device} = this.context;
    const layout = this.getLeafLayout();
    const {corners, pattern, key} = layout;
    const listed = this.isListed();
    const leaves = listed ? 1 : template.lodLeafCounts[lod];
    const indexBuffer = acquireTreeLeafIndices(device, key, corners, pattern, leaves);
    this.state.leafIndexKey = key;
    this.state.leafIndexBuffer = indexBuffer;
    const {air, shellTransition} = this.getLeafProps();
    if (!listed && !air) {
      const capacity = key === 'far' ? Math.max(leaves, template.lodLeafCounts[1]) : leaves;
      this.state.matureIndices = getMatureTreeLeafIndices(
        device,
        resources,
        template,
        layout,
        capacity
      );
    }
    const makeModel = (mature: boolean) =>
      new Model(device, {
        ...this.getShaders(mature),
        id: mature ? `${this.id}-mature` : this.id,
        topology: 'triangle-list',
        indexBuffer,
        indexCount: 0,
        vertexCount: corners * leaves,
        bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
        isInstanced: true
      });
    if (
      device.type === 'webgl' &&
      this.props._shadowPass === 'skip' &&
      !air &&
      !shellTransition &&
      !this.props.extensions.length
    ) {
      this.state.matureModel = makeModel(true);
    }
    return makeModel(false);
  }

  getModels(): Model[] {
    const {model, matureModel} = this.state;
    return model ? (matureModel ? [model, matureModel] : [model]) : [];
  }

  protected getDrawModel(params: Parameters<TreePhotorealPrimitiveLayer<DataT>['draw']>[0]) {
    const {model, matureModel} = this.state;
    if (
      !matureModel ||
      this.props.windDirection ||
      params.shaderModuleProps?.picking?.isActive ||
      params.shaderModuleProps?.shadow?.drawToShadowMap
    ) {
      return model;
    }
    return this.hasOnlyMatureTrees(true) ? matureModel : model;
  }

  protected onModelReleased(): void {
    this.state.matureModel?.destroy();
    this.state.matureModel = undefined;
    this.state.leafIndexBuffer = undefined;
    this.state.matureIndices = undefined;
    if (this.state.leafIndexKey) {
      releaseTreeLeafIndices(this.context.device, this.state.leafIndexKey);
      this.state.leafIndexKey = undefined;
    }
  }

  private hasOnlyMatureTrees(attached = false): boolean {
    const state = this.props._stateData;
    const listed = this.isListed();
    const stride = listed ? 2 : 1;
    const attribute =
      this.getAttributeManager()?.attributes[listed ? 'instanceLeafRef' : 'instanceTreeRow'];
    const values = attribute?.value;
    const accessor = attribute?.getAccessor();
    const end = this.getNumInstances() * stride;
    if (
      !state ||
      !(values instanceof Float32Array) ||
      values.length < end ||
      !attribute?.getBuffer() ||
      attribute.getBuffer() !== attribute.buffer ||
      attribute?.byteOffset ||
      accessor?.offset ||
      (accessor?.stride && accessor.stride !== stride * Float32Array.BYTES_PER_ELEMENT)
    ) {
      return false;
    }
    // Listed leaves are grouped by tree, so read each consecutive tree's state once.
    let previous = Number.NaN;
    for (let i = 0; i < end; i += stride) {
      const value = values[i];
      if (value === previous) continue;
      const row = Math.fround(value + 0.5) | 0;
      const offset = row * STATE_STRIDE;
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        state[offset + LIFE] !== 1 ||
        (attached &&
          (state[offset + LIFE + 2] !== 1 ||
            state[offset + POSE] !== 0 ||
            state[offset + POSE + 2] !== 0 ||
            state[offset + POSE + 3] !== 0))
      ) {
        return false;
      }
      previous = value;
    }
    return true;
  }

  protected prepareDraw(
    model: Model,
    shadowPass: boolean
  ): Pick<TreePhotorealUniforms, 'shape' | 'look' | 'leafBlades'> & {
    nextLook: readonly [number, number];
  } {
    const {template, lod} = this.props;
    const {forkZ, leafCount} = template;
    const {leafBlades = [0, 0, 0, 0], colorLeafCount} = this.getLeafProps();
    const [blend, gloss] = LOOK_BY_LOD[lod];
    const look: TreePhotorealUniforms['look'] = [
      blend,
      gloss,
      this.state.shadowStrength,
      lod === 0 ? 0 : 1
    ];
    const nextLook = LOOK_BY_LOD[lod + 1];
    const patternLength = this.getLeafLayout().pattern.length;
    const listed = this.isListed();
    const count = listed ? leafCount : template.lodLeafCounts[lod];
    const prefix = listed ? 1 : shadowPass ? count : Math.min(count, colorLeafCount ?? count);
    const compact =
      !shadowPass &&
      this.state.matureIndices &&
      (model === this.state.matureModel || this.hasOnlyMatureTrees())
        ? this.state.matureIndices
        : null;
    const indexBuffer = compact?.buffer ?? this.state.leafIndexBuffer!;
    if (model.vertexArray.indexBuffer !== indexBuffer) model.setIndexBuffer(indexBuffer);
    model.setIndexCount(compact ? compact.indexCounts[prefix] : prefix * patternLength);
    return {shape: [forkZ, leafCount, count, 0], look, nextLook, leafBlades};
  }

  protected setTemplateBindings(model: Model, resources: TreeTemplateResources): void {
    model.setBindings({treeLeaves: resources.leaves});
  }

  /** The pass that writes only the depth of leaves in the air lights nothing, so it samples no shadow map. */
  protected readsShadowMaps(): boolean {
    return this.getLeafProps().air !== 'depth' && super.readsShadowMaps();
  }
}
