// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {picking, project32, type DefaultProps} from '@deck.gl/core';
import {Model} from '@luma.gl/engine';
import {phongMaterial} from '@luma.gl/shadertools';
import {getTreeLeafWgslShaders} from './tree-photoreal-leaf-wgsl';
import {
  acquireTreeLeafIndices,
  releaseTreeLeafIndices,
  TreePhotorealPrimitiveLayer,
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

/** How much a leaf's normal bends toward the crown's, and how much gloss remains, by level of detail. */
const LOOK_BY_LOD: readonly (readonly [number, number])[] = [
  [0.05, 1],
  [0.26, 0.85],
  [0.46, 0.7],
  [0.64, 0.55],
  [0.75, 0.45]
];

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
    leafBlades: {type: 'array', value: [0, 0, 0, 0], compare: true},
    getLeafRef: {type: 'accessor', value: [0, 0]}
  } as DefaultProps<any>;

  declare state: TreePhotorealPrimitiveLayer<DataT>['state'] & {leafIndexKey?: string};

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

  getShaders() {
    if (this.context.device.type === 'webgpu') {
      return super.getShaders(
        getTreeLeafWgslShaders(
          this.getBlade(),
          this.getLeafProps().air,
          Boolean(this.getLeafProps().listed),
          this.props.species
        )
      );
    }
    return super.getShaders({
      ...getTreeLeafShaders(
        this.getBlade(),
        this.getLeafProps().air ?? undefined,
        this.getLeafProps().listed,
        this.props.species
      ),
      modules: [project32, picking, phongMaterial, treePhotoreal]
    });
  }

  protected createModel(_resources: TreeTemplateResources): Model {
    const {template, lod} = this.props;
    const {device} = this.context;
    const {corners, pattern, key} = this.getLeafLayout();
    const leaves = this.isListed() ? 1 : template.lodLeafCounts[lod];
    const indexBuffer = acquireTreeLeafIndices(device, key, corners, pattern, leaves);
    this.state.leafIndexKey = key;
    return new Model(device, {
      ...this.getShaders(),
      id: this.props.id,
      topology: 'triangle-list',
      indexBuffer,
      indexCount: 0,
      vertexCount: corners * leaves,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      isInstanced: true
    });
  }

  protected onModelReleased(): void {
    if (this.state.leafIndexKey) {
      releaseTreeLeafIndices(this.context.device, this.state.leafIndexKey);
      this.state.leafIndexKey = undefined;
    }
  }

  protected prepareDraw(model: Model): Pick<
    TreePhotorealUniforms,
    'shape' | 'look' | 'leafBlades'
  > & {
    nextLook: readonly [number, number];
  } {
    const {template, lod} = this.props;
    const {forkZ, leafCount} = template;
    const {leafBlades = [0, 0, 0, 0]} = this.getLeafProps();
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
    model.setIndexCount((listed ? 1 : count) * patternLength);
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
