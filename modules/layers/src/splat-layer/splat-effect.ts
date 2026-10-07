// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  _LayersPass,
  type Effect,
  type EffectContext,
  type Layer,
  type PreRenderOptions
} from '@deck.gl/core';
import type {Device, Framebuffer, Texture, Parameters, Sampler, RenderPass} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';

const isSplat = (layer: Layer) =>
  (layer.constructor as {layerName?: string}).layerName === 'SplatPrimitiveLayer';
const EFFECTS = new WeakMap<object, SplatEffect>();
const compositeUniforms = {
  name: 'splatComposite',
  fs: 'uniform splatCompositeUniforms { vec2 size; } splatComposite;',
  source:
    'struct SplatCompositeUniforms { size: vec2<f32> }; @group(0) @binding(auto) var<uniform> splatComposite: SplatCompositeUniforms;',
  uniformTypes: {size: 'vec2<f32>'}
} as const satisfies ShaderModule;

class SplatPass extends _LayersPass {
  constructor(
    device: Device,
    private readonly mode: number,
    private readonly last: Map<string, string>
  ) {
    super(device);
  }
  shouldDrawLayer(layer: Layer) {
    return this.mode === 0
      ? !isSplat(layer) && layer.props.operation.includes('draw')
      : isSplat(layer) && layer.props.operation.includes('draw');
  }
  protected getLayerParameters(layer: Layer): Parameters {
    if (this.mode === 0) return layer.props.parameters;
    return {
      ...layer.props.parameters,
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      blend: true,
      blendColorOperation: 'add',
      blendAlphaOperation: 'add',
      blendColorSrcFactor: this.mode === 1 ? 'one' : 'zero',
      blendColorDstFactor: this.mode === 1 ? 'one' : 'one-minus-src-alpha',
      blendAlphaSrcFactor: this.mode === 1 ? 'one' : 'zero',
      blendAlphaDstFactor: this.mode === 1 ? 'one' : 'one-minus-src-alpha',
      cullMode: 'none'
    };
  }
  protected getShaderModuleProps(layer: Layer, _effects, props) {
    if (this.mode === 1) this.last.set(props.project.viewport.id, layer.id);
    return {splat: {mode: this.mode}};
  }
}

/** Shared offscreen Gaussian accumulation, resolved in the ordinary depth-bearing draw pass. */
export class SplatEffect implements Effect {
  static get(deck: EffectContext['deck']): SplatEffect {
    let effect = EFFECTS.get(deck);
    if (!effect) {
      effect = new SplatEffect();
      EFFECTS.set(deck, effect);
      deck._addDefaultEffect(effect);
    }
    return effect;
  }
  id = 'gaussian-splat-transparency';
  props = {};
  order = 10;
  private device!: Device;
  private passes!: SplatPass[];
  private targets: Framebuffer[] = [];
  private textures: Texture[] = [];
  private model?: ClipSpace;
  private ready = false;
  private sampler?: Sampler;
  private last = new Map<string, string>();

  setup({device}: EffectContext) {
    this.device = device;
    if (device.type === 'webgpu')
      this.sampler = device.createSampler({minFilter: 'linear', magFilter: 'linear'});
    this.passes = [0, 1].map(mode => new SplatPass(device, mode, this.last));
    this.model = new ClipSpace(device, {
      id: 'gaussian-splat-composite',
      modules: [compositeUniforms],
      fs: `#version 300 es
precision highp float;
uniform sampler2D accumulationMap;
uniform sampler2D transmissionMap;
out vec4 color;
void main() {
  vec2 uv = gl_FragCoord.xy / splatComposite.size;
  vec4 accum = texture(accumulationMap, uv);
  float alpha = 1.0 - exp(-max(texture(transmissionMap, uv).r, 0.0));
  color = vec4(accum.rgb / max(accum.a, 0.00001) * alpha, alpha);
}`,
      source: `@group(0) @binding(auto) var accumulationMap: texture_2d<f32>;
@group(0) @binding(auto) var transmissionMap: texture_2d<f32>;
@group(0) @binding(auto) var linearSampler: sampler;
@fragment fn fragmentMain(v: FragmentInputs) -> @location(0) vec4<f32> {
  let uv = v.Position.xy / splatComposite.size;
  let accum = textureSample(accumulationMap, linearSampler, uv);
  let alpha = 1.0 - exp(-max(textureSample(transmissionMap, linearSampler, uv).r, 0.0));
  return vec4<f32>(accum.rgb / max(accum.a, 0.00001) * alpha, alpha);
}`,
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'always',
        blend: true,
        blendColorSrcFactor: 'one',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha'
      }
    });
  }

  private resize(width: number, height: number) {
    if (this.targets[0]?.width === width && this.targets[0]?.height === height) return;
    this.destroyTargets();
    const color = (format: 'rgba8unorm' | 'rgba16float' | 'r16float') =>
      this.device.createTexture({
        format,
        width,
        height,
        sampler: {minFilter: 'linear', magFilter: 'linear'}
      });
    const opaque = color('rgba8unorm'),
      accum = color('rgba16float'),
      transmission = color('r16float');
    const depth = this.device.createTexture({format: 'depth24plus', width, height});
    this.textures = [opaque, accum, transmission, depth];
    this.targets = [
      this.device.createFramebuffer({
        width,
        height,
        colorAttachments: [opaque],
        depthStencilAttachment: depth
      }),
      this.device.createFramebuffer({
        width,
        height,
        colorAttachments: [accum, transmission],
        depthStencilAttachment: depth
      })
    ];
    this.model!.setBindings({
      accumulationMap: accum,
      transmissionMap: transmission,
      ...(this.device.type === 'webgpu' ? {linearSampler: this.sampler!} : {})
    });
    this.model!.shaderInputs.setProps({splatComposite: {size: [width, height]}});
  }

  preRender(options: PreRenderOptions) {
    this.ready = false;
    this.last.clear();
    if (
      !options.layers.some(
        layer => isSplat(layer) && layer.props.visible && layer.props.operation.includes('draw')
      )
    )
      return;
    const [width, height] = (
      options.canvasContext ?? this.device.canvasContext!
    ).getDrawingBufferSize();
    const pixelLimit = options.layers.reduce(
      (limit, layer) =>
        isSplat(layer) && layer.props.visible && layer.props.operation.includes('draw')
          ? Math.min(limit, (layer.props as unknown as {maxRenderPixels: number}).maxRenderPixels)
          : limit,
      Infinity
    );
    const scale = Math.min(1, Math.sqrt(Math.max(1, pixelLimit) / (width * height)));
    this.resize(Math.max(1, Math.floor(width * scale)), Math.max(1, Math.floor(height * scale)));
    // Resolve samples in full canvas coordinates. Only Gaussian raster work and its
    // opaque occlusion capture scale down; the host's opaque draw and picking do not.
    this.model!.shaderInputs.setProps({splatComposite: {size: [width, height]}});
    const scaledOptions = {
      ...options,
      shaderModuleProps: {
        ...options.shaderModuleProps,
        project: {
          ...options.shaderModuleProps?.project,
          devicePixelRatio:
            (options.canvasContext ?? this.device.canvasContext!).cssToDeviceRatio() * scale
        }
      }
    };
    // Capture opaque depth once so branches occlude foliage regardless of source order.
    this.passes[0].render({...scaledOptions, pass: 'splat-opaque-depth', target: this.targets[0]});
    const clear = this.device.beginRenderPass({
      framebuffer: this.targets[1],
      clearColor: [0, 0, 0, 0],
      clearDepth: false
    });
    clear.end();
    this.passes[1].render({
      ...scaledOptions,
      views: undefined,
      pass: 'splat-accumulation',
      target: this.targets[1],
      clearCanvas: false
    });
    this.ready = true;
  }

  getShaderModuleProps(layer: Layer, props) {
    return {splat: {resolve: this.ready && this.last.get(props.project.viewport.id) === layer.id}};
  }

  resolve(renderPass: RenderPass) {
    if (this.ready) this.model!.draw(renderPass);
  }

  private destroyTargets() {
    for (const target of this.targets) target.destroy();
    for (const texture of this.textures) texture.destroy();
    this.targets = [];
    this.textures = [];
  }
  cleanup({deck}: EffectContext) {
    EFFECTS.delete(deck);
    this.sampler?.destroy();
    this.model?.destroy();
    this.destroyTargets();
  }
}
