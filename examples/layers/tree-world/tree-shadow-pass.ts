// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {_LayersPass, Viewport, type Layer, type LayersPassRenderOptions} from '@deck.gl/core';
import type {Device, Framebuffer, Parameters, Texture} from '@luma.gl/core';

/** Native depth storage lets the GPU compare depths before bilinear filtering. */
export class TreeShadowPass extends _LayersPass {
  private readonly target: Framebuffer;
  private reference?: Viewport;

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

  render(options: LayersPassRenderOptions, mapSize = 1024) {
    const viewport = options.viewports[0];
    if (!viewport) throw new Error('TreeShadowPass requires a common-space reference viewport.');
    this.reference = viewport;
    // A fixed budget keeps maps independent of display DPR and limits blur work.
    const ratio = mapSize / Math.max(viewport.width, viewport.height);
    const width = Math.max(1, Math.round(viewport.width * ratio));
    const height = Math.max(1, Math.round(viewport.height * ratio));
    if (width !== this.target.width || height !== this.target.height) {
      const previous = this.depth;
      this.target.resize({width, height});
      previous.destroy();
    }
    // Match optical transmission: one complete light map, preserving the first
    // view's projection metadata and precision origin independently of its inset.
    const raster: Viewport = Object.create(viewport, {
      x: {value: 0},
      y: {value: 0},
      width: {value: width},
      height: {value: height},
      subViewports: {value: null},
      equals: {value: Viewport.prototype.equals}
    });
    super.render({
      ...options,
      viewports: [raster],
      views: undefined,
      shaderModuleProps: {
        ...options.shaderModuleProps,
        project: {...options.shaderModuleProps?.project, devicePixelRatio: 1}
      },
      target: this.target,
      clearColor: [0, 0, 0, 0],
      pass: 'shadow'
    });
  }

  shouldDrawLayer(layer: Layer) {
    if (layer.id.includes('-wood-') && !layer.props.operation.includes('shadow')) return false;
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
    return {
      shadow: {
        // Raster dimensions do not change the camera-fitted light volume. Keep
        // this object separate from project.viewport, which LayersPass overwrites.
        project: {...otherShaderModuleProps.project, viewport: this.reference},
        drawToShadowMap: true
      }
    };
  }

  destroy() {
    const depth = this.depth;
    this.target.destroy();
    depth.destroy();
  }
}
