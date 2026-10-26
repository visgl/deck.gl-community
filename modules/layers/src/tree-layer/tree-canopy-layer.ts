// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Accessor, AccessorContext, DefaultProps, UpdateParameters} from '@deck.gl/core';
import {SplatLayer, type SplatLayerProps} from '../splat-layer/splat-layer';
import {
  SplatPrimitiveLayer,
  type SplatLayerProps as SplatPrimitiveLayerProps
} from '../splat-layer/splat-primitive-layer';
import {getLayerWind, getLayerWindBound} from '../wind-effect/wind-effect';
import {WIND_BEND_GLSL, WIND_BEND_WGSL, getWindBendRadius} from '../wind-effect/wind-bend';
import {wind} from '../wind-effect/wind-module';

type CanopyWindProps<DataT> = {
  /** `[bend height in metres, stable phase, flex]`, the same accessor as the tree's wood. */
  getWind: Accessor<DataT, [number, number, number]>;
  /** Bend with the deck's `WindEffect`; `false` keeps the canopy still. */
  windEnabled: boolean;
};

const canopyWindDefaultProps: DefaultProps<CanopyWindProps<unknown>> = {
  getWind: {type: 'accessor', value: [1, 0, 0]},
  windEnabled: true
};

// SplatLayer places each Gaussian in owner metres, then projects it at this comment. The canopy
// bends and flutters it just before, so drawing, picking and shadows share one pose.
const GLSL_ANCHOR =
  "  // Owner metres point east, north and up of the anchor, on deck.gl's globe as in planar views.";
const WGSL_ANCHOR =
  " // Owner metres point east, north and up of the anchor, on deck.gl's globe as in planar views.";
const WGSL_ATTRIBUTE = ' @location(14) instanceCoverageWeight: f32';

const GLSL_WIND = `  if (wind.strength != 0.0) {
    float treeHeight = max(instanceTreeWind.x, 0.001);
    vec2 treePhase = vec2(sin(instanceTreeWind.z), cos(instanceTreeWind.z));
    vec2 treeCrown = vec2(sin(instanceTreeWind.z * 1.7), cos(instanceTreeWind.z * 1.7));
    vec2 treeWave = vec2(wind.wave.x * treePhase.y + wind.wave.y * treePhase.x,
      wind.wave.z * treeCrown.y + wind.wave.w * treeCrown.x);
    float treeStrength = wind.strength * instanceTreeWind.y;
    vec3 treeFlutter = windFlutter(position, splatCenters, treeHeight, treeStrength, treePhase, wind.axis, wind.flutter);
    mat3 treeJacobian = windBend(position, treeHeight, treeStrength, treeWave, wind.axis, mat2(wind.mode), treePhase, wind.branch);
    position += treeFlutter;
    covariance = treeJacobian * covariance;
    normal = windBendNormal(treeJacobian, normal);
  }
`;
const WGSL_WIND = ` if (wind.strength != 0.0) {
  let treeHeight = max(attributes.instanceTreeWind.x, 0.001);
  let treePhase = vec2<f32>(sin(attributes.instanceTreeWind.z), cos(attributes.instanceTreeWind.z));
  let treeCrown = vec2<f32>(sin(attributes.instanceTreeWind.z * 1.7), cos(attributes.instanceTreeWind.z * 1.7));
  let treeWave = vec2<f32>(wind.wave.x * treePhase.y + wind.wave.y * treePhase.x,
    wind.wave.z * treeCrown.y + wind.wave.w * treeCrown.x);
  let treeStrength = wind.strength * attributes.instanceTreeWind.y;
  let treeFlutter = windFlutter(position, attributes.splatCenters, treeHeight, treeStrength, treePhase, wind.axis, wind.flutter);
  let treeBend = windBend(position, treeHeight, treeStrength, treeWave, wind.axis, mat2x2<f32>(wind.mode.xy, wind.mode.zw), treePhase, wind.branch);
  position = treeBend.position + treeFlutter;
  covariance = treeBend.jacobian * covariance;
  normal = windBendNormal(treeBend.jacobian, normal);
 }
`;

/** Pack `[height, phase, flex]` as `[height, flex, phase, 0]`; the shader derives both sines. */
function getCanopyWindAttribute([height, phase, flex]: readonly number[]): number[] {
  return [height, flex, phase, 0];
}

/**
 * Gaussian canopy primitive that sways with the deck's `WindEffect`, sharing TreeMeshLayer's bend
 * so leaves stay on their branches. It fills SplatPrimitiveLayer's spare attribute slot.
 */
export class TreeCanopyPrimitiveLayer<DataT = unknown> extends SplatPrimitiveLayer<DataT> {
  static layerName = 'TreeCanopyPrimitiveLayer';
  static defaultProps: DefaultProps<SplatPrimitiveLayerProps & CanopyWindProps<unknown>> = {
    ...SplatPrimitiveLayer.defaultProps,
    ...canopyWindDefaultProps
  };
  declare props: SplatPrimitiveLayer<DataT>['props'] & CanopyWindProps<DataT>;

  initializeState() {
    super.initializeState();
    this.getAttributeManager()!.addInstanced({
      instanceTreeWind: {size: 4, accessor: 'getWind', transform: getCanopyWindAttribute}
    });
  }

  // The wind patch depends on transparency, so switching it recompiles the canopy.
  protected shouldRebuildModels(params: UpdateParameters<this>): boolean {
    return (
      super.shouldRebuildModels(params) ||
      params.props.transparency !== params.oldProps.transparency
    );
  }

  getShaders() {
    const shaders = super.getShaders();
    // The sorted renderer packs only SplatLayer's own attributes: sorted canopies stay still.
    if (this.props.transparency === 'sorted') return shaders;
    if (!shaders.vs.includes(GLSL_ANCHOR) || !shaders.source.includes(WGSL_ANCHOR))
      throw new Error('Unsupported SplatLayer shader anchor for canopy wind.');
    return {
      ...shaders,
      modules: [...shaders.modules, wind],
      vs: shaders.vs
        .replace(
          'in float instanceCoverageWeight;',
          'in float instanceCoverageWeight;\nin vec4 instanceTreeWind;'
        )
        .replace('void main() {', `${WIND_BEND_GLSL}\nvoid main() {`)
        .replace(GLSL_ANCHOR, `${GLSL_WIND}${GLSL_ANCHOR}`),
      source: `${WIND_BEND_WGSL}\n${shaders.source}`
        .replace(WGSL_ATTRIBUTE, `${WGSL_ATTRIBUTE},\n @location(15) instanceTreeWind: vec4<f32>`)
        .replace(WGSL_ANCHOR, `${WGSL_WIND}${WGSL_ANCHOR}`)
    };
  }

  // Every pass, shadows included, draws with this frame's wind.
  draw(params) {
    if (this.props.transparency === 'sorted') {
      super.draw(params);
      return;
    }
    const {wind: windProps, animated} = getLayerWind(this, this.props.windEnabled);
    for (const model of this.getModels()) model.shaderInputs.setProps({wind: windProps});
    super.draw(params);
    if (animated) this.setNeedsRedraw();
  }
}

/**
 * TreeLayer's foliage: a SplatLayer whose Gaussians bend with the deck's `WindEffect`. Owner bounds
 * cover the largest wind excursion, so culling and refinement keep swaying crowns.
 */
export class TreeCanopyLayer<DataT = unknown> extends SplatLayer<DataT> {
  static layerName = 'TreeCanopyLayer';
  static defaultProps: DefaultProps<SplatLayerProps & CanopyWindProps<unknown>> = {
    ...SplatLayer.defaultProps,
    ...canopyWindDefaultProps
  };
  declare props: SplatLayer<DataT>['props'] & CanopyWindProps<DataT>;

  updateState(params: UpdateParameters<this>) {
    const {props, oldProps, changeFlags} = params;
    const triggers = changeFlags.updateTriggersChanged;
    const state = this.state as {windRevision?: number};
    // Per-tree flex changes the owner bounds; a new revision rebuilds them.
    if (
      (triggers && (triggers.all || triggers.getWind)) ||
      (typeof props.getWind !== 'function' && props.getWind !== oldProps.getWind)
    )
      state.windRevision = (state.windRevision ?? 0) + 1;
    super.updateState(params);
  }

  protected getPrimitiveLayerClass() {
    return TreeCanopyPrimitiveLayer as unknown as typeof SplatPrimitiveLayer;
  }

  protected getPrimitiveAccessorNames(): string[] {
    return ['getWind'];
  }

  protected getOwnerBoundsKey(): string {
    // Also records the effect state, so WindEffect updates this layer when it changes.
    const bound = getLayerWindBound(this, this.props.windEnabled);
    const state = this.state as {windRevision?: number; windBound?: typeof bound};
    state.windBound = bound;
    return `${state.windRevision ?? 0}|${bound.peak}|${bound.turbulence}`;
  }

  protected getOwnerRadius(
    object: DataT,
    objectInfo: AccessorContext<DataT>,
    localCenter: number[],
    radius: number
  ): number {
    const bound = (this.state as {windBound?: {peak: number; turbulence: number}}).windBound!;
    const {getWind} = this.props;
    const [height, , flex] = typeof getWind === 'function' ? getWind(object, objectInfo) : getWind;
    return getWindBendRadius(
      localCenter,
      radius,
      height,
      bound.peak * Math.abs(flex),
      bound.turbulence
    );
  }
}
