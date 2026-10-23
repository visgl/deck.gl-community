// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Layer, type DefaultProps, type UpdateParameters, type Viewport} from '@deck.gl/core';
import {Matrix4} from '@math.gl/core';
import type {SplatLayerProps} from '../splat-layer';
import {SplatPrimitiveLayer} from '../splat-primitive-layer';
import {DEFAULT_GET_SOURCE, type SplatDataInput} from '../splat-input';
import {getSplatTransform} from '../splat-transform';
import {SplatSceneRuntime} from './splat-scene-runtime';
import {getSplatSceneProjectionError} from './splat-scene-projection';

/** Internal host primitive; loading, selection and ordering are shared by the public composite. */
export class SplatSceneLayer extends Layer<
  Required<SplatLayerProps<unknown>> & {_resolvedAssets?: SplatDataInput[] | null}
> {
  static layerName = 'SplatSceneLayer';
  static defaultProps: DefaultProps<SplatLayerProps> = {
    ...SplatPrimitiveLayer.defaultProps,
    data: {type: 'data', value: [], async: false},
    getSource: {type: 'accessor', value: DEFAULT_GET_SOURCE},
    maxResidentSplats: 8_000_000,
    maxConcurrentLoads: 8,
    maxTotalSplats: Infinity,
    sortDomain: 'default',
    // Sorted scenes have no shadow-map shader. Keep deck.gl's ShadowPass from drawing them.
    shadowEnabled: false
  };
  declare state: {runtime: SplatSceneRuntime; disabledPickingIndices: Set<number>};

  initializeState(): void {
    this.state = {
      runtime: SplatSceneRuntime.get(this.context.deck, this.context.device),
      disabledPickingIndices: new Set()
    };
    this.state.runtime.register(this);
  }
  getNumInstances(): number {
    return 0;
  }
  updateState(_parameters: UpdateParameters<this>): void {
    this.state.runtime.register(this);
  }
  finalizeState(): void {
    this.state.runtime.unregister(this.id);
    super.finalizeState(this.context);
  }
  get isLoaded(): boolean {
    return this.state.runtime?.isLoaded(this.id) ?? false;
  }
  draw(options: Parameters<Layer['draw']>[0]): void {
    // The scene renderers would write camera-ordered color into the light's shadow map.
    if (options.shaderModuleProps.shadow?.drawToShadowMap) return;
    this.state.runtime.draw(
      this,
      options.renderPass,
      this.context.viewport,
      Boolean(options.shaderModuleProps.picking?.isActive),
      options.parameters
    );
  }
  getPickingInfo(parameters: Parameters<Layer['getPickingInfo']>[0]) {
    parameters.info.object = this.state.runtime.getPickingOwner(this.id, parameters.info.index);
    return parameters.info;
  }

  /** Deck's multi-depth picker excludes owners until the complete query finishes. */
  disablePickingIndex(index: number): void {
    this.state.disabledPickingIndices.add(index);
  }
  restorePickingColors(): void {
    this.state.disabledPickingIndices.clear();
  }
  isOwnerPickable(index: number): boolean {
    return !this.state?.disabledPickingIndices?.has(index);
  }

  /** Evaluate accessors in the original application row context. */
  getOwnerValue(
    name:
      | 'getPosition'
      | 'getOrientation'
      | 'getScale'
      | 'getTranslation'
      | 'getTransformMatrix'
      | 'getCoverageWeight'
      | 'getColor',
    owner: unknown,
    index: number,
    data: unknown[]
  ): unknown {
    const accessor = this.props[name];
    return typeof accessor === 'function' ? accessor(owner, {index, data, target: []}) : accessor;
  }
  /** Clip transform includes the layer pose and the complete instance affine transform. */
  getOwnerMatrix(owner: unknown, index: number, data: unknown[], viewport: Viewport): Matrix4 {
    const projectionError = getSplatSceneProjectionError(this.props.coordinateSystem, viewport);
    if (projectionError) throw new Error(projectionError);
    const position = this.getOwnerValue('getPosition', owner, index, data) as number[];
    const transform = getSplatTransform(
      this.getOwnerValue('getOrientation', owner, index, data) as number[],
      this.getOwnerValue('getScale', owner, index, data) as number[],
      this.getOwnerValue('getTranslation', owner, index, data) as number[],
      this.getOwnerValue('getTransformMatrix', owner, index, data) as ArrayLike<number> | null
    );
    const affine = new Matrix4([
      ...transform.slice(0, 3),
      0,
      ...transform.slice(3, 6),
      0,
      ...transform.slice(6, 9),
      0,
      ...transform.slice(9, 12),
      1
    ]);
    const matrix = new Matrix4().translate(this.props.coordinateOrigin);
    if (this.props.modelMatrix) matrix.multiplyRight(this.props.modelMatrix);
    return matrix.translate(position ?? [0, 0, 0]).multiplyRight(affine);
  }
}
