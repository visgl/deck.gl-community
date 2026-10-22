// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension, log} from '@deck.gl/core';
import type {Accessor, Color, Layer, LayerContext, UpdateParameters} from '@deck.gl/core';
import {Texture} from '@luma.gl/core';
import {
  SELECTION_WEIGHTS_ATTRIBUTE,
  getSelectionPulseShaders,
  type SelectionPulseMode,
  type SelectionPulseModuleProps
} from './selection-pulse-shaders';

export type SelectionPulseExtensionProps<DataT = any> = {
  /**
   * Whether each object is selected: `true` or `1` pulses it, `false` or `0` leaves it unchanged,
   * and a number in between pulses it partly. Change `updateTriggers.getSelected` to apply a new
   * selection; that writes one value per object and reruns no other accessor.
   * @default false
   */
  getSelected?: Accessor<DataT, boolean | number>;
  /** RGB that selected objects blend toward at the peak of each pulse. @default [0, 0, 0] */
  pulseColor?: Color;
  /** Blend toward `pulseColor` at the peak, from 0 to 1. @default 0.4 */
  pulseStrength?: number;
  /** Milliseconds per pulse; `0` holds a steady tint at `pulseStrength`. @default 1500 */
  pulsePeriod?: number;
  /** Offset into the pulse, as a fraction of `pulsePeriod`. @default 0 */
  pulsePhase?: number;
  /**
   * Pulse clock in milliseconds, or `null` to follow deck.gl's animation timeline. Set a number
   * for repeatable frames, e.g. in tests. @default null
   */
  pulseTime?: number | null;
};

type PulseProps = Required<SelectionPulseExtensionProps>;

type SelectionPulseState = {
  mode: SelectionPulseMode;
  /** Increments whenever deck.gl writes any selection weight. */
  revision: number;
  /** The revision that `selected` and `texture` reflect. */
  checkedRevision: number;
  /** Whether any drawn object has a nonzero weight. */
  selected: boolean;
  /** `instance` mode: the weights, one texel per instance. */
  texture: Texture | null;
};

/** Texture rows hold this many instances. */
const TEXTURE_WIDTH = 4096;

/**
 * The blend toward `pulseColor` of a fully selected object at `time` milliseconds. It rises from 0
 * to `pulseStrength` over the first half of each period and falls back over the second.
 */
export function getSelectionPulseAmount(
  time: number,
  {
    pulseStrength,
    pulsePeriod,
    pulsePhase
  }: Pick<PulseProps, 'pulseStrength' | 'pulsePeriod' | 'pulsePhase'>
): number {
  const strength = Math.max(0, Math.min(1, pulseStrength || 0));
  if (!isPulsing(pulsePeriod)) return strength;
  const cycle = time / pulsePeriod + (pulsePhase || 0);
  return strength * (0.5 - 0.5 * Math.cos(2 * Math.PI * cycle));
}

function isPulsing(period: number): boolean {
  return period > 0 && Number.isFinite(period);
}

function getSelectionWeight(value: unknown): number {
  if (typeof value === 'number') return value > 0 ? Math.min(value, 1) : 0;
  return value ? 1 : 0;
}

/**
 * `instance` for layer types that declare `static instanceColorFilters = true`, `attribute` for
 * other primitive layers on WebGL, otherwise `null`.
 */
function getMode(layer: Layer): SelectionPulseMode | null {
  if (layer.isComposite || !layer.getAttributeManager()) return null;
  if ((layer.constructor as {instanceColorFilters?: boolean}).instanceColorFilters)
    return 'instance';
  return layer.context?.device?.type === 'webgpu' ? null : 'attribute';
}

function getPulseState(layer: Layer): SelectionPulseState | undefined {
  return (layer.state as {selectionPulse?: SelectionPulseState} | undefined)?.selectionPulse;
}

/** Reads the current weights: one value for a constant accessor, otherwise one per row. */
function getWeights(layer: Layer): {constant: boolean; values: ArrayLike<number>} {
  const attribute = layer.getAttributeManager()?.attributes[SELECTION_WEIGHTS_ATTRIBUTE];
  const value = attribute?.value as ArrayLike<number> | null | undefined;
  if (!attribute || !value) return {constant: true, values: [0]};
  if (attribute.isConstant) return {constant: true, values: [value[0] ?? 0]};
  const count = Math.min(value.length, attribute.numInstances * attribute.size);
  return {constant: false, values: (value as Float32Array).subarray(0, count)};
}

/** Writes the weights to a texture by instance, reusing `texture` when it has the same size. */
function updateWeightTexture(
  layer: Layer,
  texture: Texture | null,
  weights: {constant: boolean; values: ArrayLike<number>}
): Texture {
  const count = Math.max(1, weights.constant ? layer.getNumInstances() : weights.values.length);
  const width = Math.min(count, TEXTURE_WIDTH);
  const height = Math.ceil(count / width);
  if (!texture || texture.width !== width || texture.height !== height) {
    texture?.destroy();
    texture = layer.context.device.createTexture({
      id: `${layer.id}-selection-pulse`,
      format: 'r8unorm',
      width,
      height,
      mipLevels: 1,
      usage: Texture.SAMPLE | Texture.COPY_DST,
      // Shaders fetch exact texels.
      sampler: {minFilter: 'nearest', magFilter: 'nearest'}
    });
  }
  const data = new Uint8Array(width * height);
  if (weights.constant) data.fill(Math.round(weights.values[0] * 255));
  else
    for (let i = 0; i < weights.values.length; i++) data[i] = Math.round(weights.values[i] * 255);
  texture.writeData(data);
  return texture;
}

/** deck.gl's update trigger comparison: shallow over the values of an array or object trigger. */
function hasTriggerChanged(props: Layer['props'], oldProps: Layer['props'], name: string): boolean {
  const next = props.updateTriggers?.[name] ?? {};
  const previous = oldProps.updateTriggers?.[name] ?? {};
  if (next === previous) return false;
  if (typeof next !== 'object' || typeof previous !== 'object') return true;
  const keys = Object.keys(next);
  if (keys.length !== Object.keys(previous).length) return true;
  return keys.some(key => !(key in previous) || next[key] !== previous[key]);
}

const warnedLayerTypes = new WeakSet<object>();

/** Adds the weights attribute and the pulse state to `layer`, once. */
function initializePulseState(layer: Layer, mode: SelectionPulseMode): SelectionPulseState {
  let state = getPulseState(layer);
  if (state) return state;
  state = {mode, revision: 0, checkedRevision: -1, selected: false, texture: null};
  layer.setState({selectionPulse: state});
  layer.getAttributeManager()!.add({
    [SELECTION_WEIGHTS_ATTRIBUTE]: {
      size: 1,
      stepMode: 'dynamic',
      accessor: 'getSelected',
      defaultValue: 0,
      // deck.gl calls this with the layer whenever it writes weights, including constants.
      transform(this: Layer, value: unknown) {
        const pulse = getPulseState(this);
        if (pulse) pulse.revision++;
        return getSelectionWeight(value);
      }
    }
  });
  return state;
}

/**
 * Pulses the color of selected objects on the GPU. Selection is a per-object attribute written
 * from `getSelected`, so a new selection writes one value per object; each animation frame sets
 * only uniforms, so no accessor reruns and no attribute uploads while it pulses. While any drawn
 * object is selected and `pulseTime` is `null`, the layer requests a redraw every frame.
 *
 * Works on layers with deck.gl's GLSL `DECKGL_FILTER_COLOR` vertex hook, such as
 * `ScatterplotLayer`, `ColumnLayer`, `SolidPolygonLayer`, `PolygonLayer`, `PathLayer` and
 * `SimpleMeshLayer`, and on `SplatLayer` and `TreeLayer`, which pass it to their sub-layers with
 * `getSelected` applied to their own data rows. On lit meshes the lighting shades the blended color.
 * On WebGPU it applies to `SplatLayer` and `TreeLayer` only: deck.gl 9.4's core layers have no WGSL
 * color hook.
 */
export class SelectionPulseExtension extends LayerExtension {
  static extensionName = 'SelectionPulseExtension';
  static defaultProps = {
    getSelected: {type: 'accessor', value: false},
    pulseColor: {type: 'color', value: [0, 0, 0]},
    pulseStrength: {type: 'number', value: 0.4, min: 0, max: 1},
    pulsePeriod: {type: 'number', value: 1500, min: 0},
    pulsePhase: {type: 'number', value: 0},
    pulseTime: null
  };

  isEnabled(layer: Layer): boolean {
    return getMode(layer) !== null;
  }

  getShaders(this: Layer<PulseProps>, extension: this): any {
    const mode = getMode(this);
    if (!mode) return null;
    // deck.gl initializes extensions only when it creates a layer. When the extension is added to
    // an existing layer, the layer rebuilds its models, calling this before it reads the buffer
    // layouts, so the weights attribute is bound from the first draw.
    initializePulseState(this, mode);
    return getSelectionPulseShaders(mode, this.context.device.type === 'webgpu');
  }

  initializeState(this: Layer<PulseProps>, context: LayerContext, extension: this) {
    const mode = getMode(this);
    if (mode) initializePulseState(this, mode);
    else if (!this.isComposite && !warnedLayerTypes.has(this.constructor)) {
      warnedLayerTypes.add(this.constructor);
      log.warn(
        `SelectionPulseExtension: ${this.id} has no WebGPU color hook and does not pulse.`
      )();
    }
  }

  updateState(
    this: Layer<PulseProps>,
    {props, oldProps, changeFlags}: UpdateParameters<Layer<PulseProps>>,
    extension: this
  ) {
    const state = getPulseState(this);
    if (!state) return;
    // In `instance` mode the shaders read a texture; keep the attribute off the models, which may
    // have been recreated by this update.
    if (state.mode === 'instance')
      for (const model of this.getModels()) {
        const userData = model.userData as {excludeAttributes?: Record<string, boolean>};
        userData.excludeAttributes = {
          ...userData.excludeAttributes,
          [SELECTION_WEIGHTS_ATTRIBUTE]: true
        };
      }
    // deck.gl ignores update triggers when the data changes, even for partial `_dataDiff`
    // ranges, which composite layers such as SplatLayer and TreeLayer send while the camera
    // moves. A selection changed in such a frame must still reach the rows that kept their data.
    if (
      Array.isArray(changeFlags.dataChanged) &&
      (hasTriggerChanged(props, oldProps, 'getSelected') ||
        hasTriggerChanged(props, oldProps, 'all'))
    )
      this.getAttributeManager()!.invalidate('getSelected');
  }

  draw(this: Layer<PulseProps>, params: any, extension: this) {
    const state = getPulseState(this);
    if (!state) return;
    const instanced = state.mode === 'instance';
    if (state.checkedRevision !== state.revision || (instanced && !state.texture)) {
      state.checkedRevision = state.revision;
      const weights = getWeights(this);
      let selected = false;
      for (let i = 0; i < weights.values.length && !selected; i++) selected = weights.values[i] > 0;
      state.selected = selected;
      if (instanced) state.texture = updateWeightTexture(this, state.texture, weights);
    }
    // SplatLayer's depth-sorted transparency redraws its Gaussians unindexed, so instance indices
    // there do not name owners. It does not pulse.
    const sorted = (this.props as {transparency?: string}).transparency === 'sorted';
    const pulsing = state.selected && !sorted;
    const {pulseColor, pulseTime, pulsePeriod} = this.props;
    const time = pulseTime ?? this.context.timeline.getTime();
    const moduleProps: SelectionPulseModuleProps = {
      color: [pulseColor[0] / 255, pulseColor[1] / 255, pulseColor[2] / 255],
      amount: pulsing ? getSelectionPulseAmount(time, this.props) : 0
    };
    if (instanced) moduleProps.selectionPulseTexture = state.texture!;
    this.setShaderModuleProps({selectionPulse: moduleProps} as any);
    if (pulsing && pulseTime === null && isPulsing(pulsePeriod)) this.setNeedsRedraw();
  }

  finalizeState(this: Layer<PulseProps>, context: LayerContext, extension: this) {
    const state = getPulseState(this);
    state?.texture?.destroy();
    if (state) state.texture = null;
  }
}
