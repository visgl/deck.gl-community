// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {LayerExtension} from '@deck.gl/core';
import type {CompositeLayer, Layer, Viewport} from '@deck.gl/core';

import {getViewportZoom, interpolateZoom, type ZoomOpacityStops} from './zoom-opacity';
import {zoomOpacityShaderModule} from './zoom-opacity-shader-module';

/** Props added to a layer by {@link ZoomOpacityExtension}. */
export type ZoomOpacityExtensionProps = {
  /**
   * `[zoom, opacity]` stops, sorted by ascending zoom, that scale the layer's `opacity` prop by
   * a function of the current viewport zoom. Values are linearly interpolated between stops and
   * clamped at the ends. Consecutive stops at the same zoom express a hard step.
   *
   * `null` or `[]` leaves the layer at its regular opacity.
   * @default null
   */
  zoomOpacity?: ZoomOpacityStops | null;
};

const defaultProps = {
  zoomOpacity: {type: 'array', value: null, optional: true, compare: 2}
};

/** Zoom opacity applied by {@link drawWithInheritedOpacity}, keyed by layer instance. */
const inheritedOpacity = new WeakMap<Layer, number>();

/**
 * Makes a layer's opacity a function of the viewport zoom, like a MapLibre
 * `["interpolate", ["linear"], ["zoom"], ...]` expression on `*-opacity`.
 *
 * Opacity is evaluated on the CPU for each viewport the layer is drawn into, so it is correct
 * in multi-view setups and costs nothing when the camera is idle. The result multiplies the
 * layer's `opacity` prop, so a stop value of `0.5` looks the same as `opacity: 0.5`. When the
 * result is `0`, the layer produces no fragments and is not pickable.
 *
 * Works with composite layers, including aggregation layers such as `HexagonLayer` and
 * `GridLayer`, whose rendered cells fade while aggregation is left untouched.
 *
 * @example
 * ```ts
 * new HexagonLayer({
 *   extensions: [new ZoomOpacityExtension()],
 *   zoomOpacity: zoomBand({minZoom: 8, maxZoom: 11, fadeWidth: 1})
 * });
 * ```
 */
export class ZoomOpacityExtension extends LayerExtension {
  static defaultProps = defaultProps;
  static extensionName = 'ZoomOpacityExtension';

  getShaders(this: Layer<ZoomOpacityExtensionProps>, extension: this): any {
    // Composite layers only request shaders for internal work such as GPU aggregation, which
    // must not be affected. The geometry-collapse module is GLSL-only.
    if (this.isComposite || this.context.device.type === 'webgpu') {
      return null;
    }
    return {modules: [zoomOpacityShaderModule]};
  }

  draw(this: Layer<ZoomOpacityExtensionProps>, params: any, extension: this): void {
    const viewport: Viewport | undefined = params?.context?.viewport ?? this.context.viewport;
    const opacity = interpolateZoom(getViewportZoom(viewport), this.props.zoomOpacity);

    if (this.isComposite) {
      // Drawable composites (deck.gl aggregation layers) draw before their sublayers in every
      // pass and viewport, but render cells with `extensions: []`. Fade those cells from here.
      applyToSublayers(this as unknown as CompositeLayer, extension, opacity);
      return;
    }

    if (this.context.device.type === 'webgpu') {
      // No WGSL geometry collapse yet: fade and skip drawing through the instance `draw` instead
      setInheritedOpacity(this, opacity);
      return;
    }

    this.setShaderModuleProps({
      // Scale the layer opacity before deck.gl applies its gamma, so stops compose exactly like
      // the `opacity` prop.
      layer: {opacity: this.props.opacity * opacity},
      zoomOpacity: {opacity}
    });
  }
}

function applyToSublayers(
  parent: CompositeLayer,
  extension: ZoomOpacityExtension,
  opacity: number
): void {
  for (const sublayer of parent.getSubLayers()) {
    if (sublayer.props.extensions.includes(extension)) {
      // The sublayer applies the extension itself
      continue;
    }
    if (sublayer.isComposite) {
      applyToSublayers(sublayer as unknown as CompositeLayer, extension, opacity);
      continue;
    }
    setInheritedOpacity(sublayer, opacity);
  }
}

/**
 * Installs an instance-level `draw` on a primitive layer that applies `opacity`. Used for
 * sublayers that do not carry the extension and on WebGPU.
 */
function setInheritedOpacity(layer: Layer, opacity: number): void {
  inheritedOpacity.set(layer, opacity);
  if (!Object.prototype.hasOwnProperty.call(layer, 'draw')) {
    Object.defineProperty(layer, 'draw', {
      configurable: true,
      writable: true,
      value: drawWithInheritedOpacity
    });
  }
}

/**
 * deck.gl calls `layer.draw()` after applying per-pass shader module props and extension draw
 * hooks, so the opacity set here wins.
 */
function drawWithInheritedOpacity(this: Layer, opts: any): void {
  const opacity = inheritedOpacity.get(this) ?? 1;
  // Skip fully faded layers entirely, so they are neither rendered nor pickable
  if (opacity <= 0) {
    return;
  }
  this.setShaderModuleProps({layer: {opacity: this.props.opacity * opacity}});
  Object.getPrototypeOf(this).draw.call(this, opts);
}
