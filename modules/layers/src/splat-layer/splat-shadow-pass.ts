// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_LayersPass, type Layer, type LayersPassRenderOptions} from '@deck.gl/core';
import type {Framebuffer, Parameters, Texture} from '@luma.gl/core';

/** Host-provided light transform uses deck's precision-preserving common-space convention. */
export type SplatShadowProjection = {
  matrix: number[];
  center: number[];
  width: number;
  height: number;
};

/** Gaussian optical transmission for a planar receiver below the canopy; independent of camera visibility. */
export class SplatShadowPass extends _LayersPass {
  private target?: Framebuffer;
  private projection?: SplatShadowProjection;
  get transmission(): Texture | undefined {
    return this.target?.colorAttachments[0].texture;
  }
  renderTransmission(options: LayersPassRenderOptions, projection: SplatShadowProjection) {
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
      effects: [],
      views: undefined,
      pass: 'shadow',
      target: this.target,
      clearColor: [1, 1, 1, 1],
      shaderModuleProps: {
        ...options.shaderModuleProps,
        project: {
          ...options.shaderModuleProps?.project,
          devicePixelRatio: projection.width / options.viewports[0].width
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
