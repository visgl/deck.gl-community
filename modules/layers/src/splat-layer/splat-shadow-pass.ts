// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_LayersPass, Viewport, type Layer, type LayersPassRenderOptions} from '@deck.gl/core';
import type {Framebuffer, Parameters, Texture} from '@luma.gl/core';

/** Host-provided light transform uses deck's precision-preserving common-space convention. */
export type SplatShadowProjection = {
  /** Column-major common-space to light-clip transform, with 16 entries. */
  matrix: number[];
  /** Precision-preserving XYZW clip-space offset, with four entries. */
  center: number[];
  /** Light-map width in device pixels. */
  width: number;
  /** Light-map height in device pixels. */
  height: number;
};

/** Gaussian optical transmission for a planar receiver below the canopy; independent of camera visibility. */
export class SplatShadowPass extends _LayersPass {
  private target?: Framebuffer;
  private projection?: SplatShadowProjection;
  /** Current transmission texture, owned by this pass until resize or destruction. */
  get transmission(): Texture | undefined {
    return this.target?.colorAttachments[0].texture;
  }
  /**
   * Render WebGL optical transmission after the host prepares light-space owner selections.
   * The first viewport supplies the common-space reference used by prepareShadow; camera
   * dimensions and additional views do not change the light-map raster or multiply its density.
   */
  renderTransmission(options: LayersPassRenderOptions, projection: SplatShadowProjection) {
    const reference = options.viewports[0];
    if (!reference) throw new Error('SplatShadowPass requires a common-space reference viewport.');
    // Retain the host's projection metadata and precision origin without mutating it.
    // Override the bound equality method so layer activation sees the light-map dimensions.
    const viewport: Viewport = Object.create(reference, {
      x: {value: 0},
      y: {value: 0},
      width: {value: projection.width},
      height: {value: projection.height},
      subViewports: {value: null},
      equals: {value: Viewport.prototype.equals}
    });
    this.projection = projection;
    if (this.target?.width !== projection.width || this.target?.height !== projection.height) {
      this.destroy();
      this.target = this.device.createFramebuffer({
        width: projection.width,
        height: projection.height,
        colorAttachments: ['rgba8unorm']
      });
    }
    super.render({
      ...options,
      viewports: [viewport],
      effects: [],
      views: undefined,
      pass: 'shadow',
      target: this.target,
      clearColor: [1, 1, 1, 1],
      shaderModuleProps: {
        ...options.shaderModuleProps,
        project: {
          ...options.shaderModuleProps?.project,
          devicePixelRatio: 1
        }
      }
    });
  }
  shouldDrawLayer(layer: Layer) {
    return (
      (layer.constructor as {layerName?: string}).layerName === 'SplatPrimitiveLayer' &&
      layer.props.operation.includes('shadow') &&
      (layer.props as {shadowEnabled?: boolean}).shadowEnabled !== false
    );
  }
  protected getLayerParameters(): Parameters {
    return {
      depthCompare: 'always',
      depthWriteEnabled: false,
      cullMode: 'none',
      blend: true,
      blendColorSrcFactor: 'zero',
      blendColorDstFactor: 'one-minus-src-alpha',
      blendAlphaSrcFactor: 'zero',
      blendAlphaDstFactor: 'one-minus-src-alpha'
    };
  }
  protected getShaderModuleProps() {
    return {
      shadow: {drawToShadowMap: false},
      splat: {
        mode: 3,
        lightMatrix: this.projection!.matrix,
        lightCenter: this.projection!.center,
        lightViewport: [this.projection!.width, this.projection!.height]
      }
    };
  }
  destroy() {
    this.target?.destroy();
    this.target = undefined;
  }
}
