// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_LayersPass, type Layer, type LayersPassRenderOptions} from '@deck.gl/core';
import type {Device, Framebuffer, Parameters, Texture} from '@luma.gl/core';

/** Native depth storage lets the GPU compare depths before bilinear filtering. */
export class TreeShadowPass extends _LayersPass {
  private readonly target: Framebuffer;

  constructor(device: Device) {
    super(device);
    const depth = device.createTexture({
      format: 'depth24plus',
      width: 1,
      height: 1,
      sampler: {
        type: 'comparison-sampler',
        compare: 'less-equal',
        minFilter: 'linear',
        magFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
      }
    });
    this.target = device.createFramebuffer({colorAttachments: [], depthStencilAttachment: depth});
  }

  get depth(): Texture {
    return this.target.depthStencilAttachment!.texture;
  }

  render(options: LayersPassRenderOptions) {
    const viewport = options.viewports[0];
    // A fixed budget keeps maps independent of display DPR and limits blur work.
    const ratio = 1024 / Math.max(viewport.width, viewport.height);
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (width !== this.target.width || height !== this.target.height) {
      const previous = this.depth;
      this.target.resize({width, height});
      previous.destroy();
    }
    super.render({
      ...options,
      shaderModuleProps: {...options.shaderModuleProps, project: {devicePixelRatio: ratio}},
      target: this.target,
      clearColor: [0, 0, 0, 0],
      pass: 'shadow'
    });
  }

  shouldDrawLayer(layer: Layer) {
    return (layer.props as Layer['props'] & {shadowEnabled?: boolean}).shadowEnabled !== false;
  }

  protected getLayerParameters(layer: Layer): Parameters {
    return {
      ...layer.props.parameters,
      blend: false,
      depthWriteEnabled: true,
      depthCompare: 'less-equal'
    };
  }

  // _LayersPass merges render overrides last, preserving the light ID and matrices.
  protected getShaderModuleProps(layer: Layer, effects, otherShaderModuleProps) {
    return {shadow: {project: otherShaderModuleProps.project, drawToShadowMap: true}};
  }

  destroy() {
    const depth = this.depth;
    this.target.destroy();
    depth.destroy();
  }
}
