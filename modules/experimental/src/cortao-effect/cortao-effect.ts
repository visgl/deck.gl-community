// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _LayersPass as LayersPass,
  log,
  type Effect,
  type EffectContext,
  type PostRenderOptions,
  type PreRenderOptions
} from '@deck.gl/core';
import {
  Texture,
  type Device,
  type Framebuffer,
  type TextureFormat,
  type TextureFormatDepthStencil
} from '@luma.gl/core';
import type {CORTAORayCount} from './cortao-occluder-lookup-table';
import {getCORTAOCamera, type CORTAOCamera, type CORTAOConfiguration} from './cortao-parameters';
import {NEAREST_SAMPLER, type CORTAOPasses, type CORTAOShaderOptions} from './cortao-passes';
import {CORTAOWebGLPasses} from './cortao-webgl-passes';
import {CORTAOWebGPUPasses} from './cortao-webgpu-passes';

/** Props of {@link CORTAOEffect}. All distances are in meters. */
export type CORTAOEffectProps = {
  /** Effect id. Default `'cortao'`. */
  id?: string;
  /**
   * Maximum world-space radius of the occlusion, in meters. Default `Infinity`: only
   * `maxScreenSpaceRadius` limits the radius, as in the Carbon Engine version of CORTAO.
   */
  radius?: number;
  /** Maximum screen-space radius, as a fraction of the viewport height. Default `0.2`. */
  maxScreenSpaceRadius?: number;
  /**
   * Exponent applied to the occlusion. `1` (default) is the physically based result. Values above
   * 1 make the occlusion darker, values below 1 make it lighter.
   */
  intensity?: number;
  /** Number of depth samples per pixel. A shader constant. Default `16`. CORTAO recommends 4 to 32. */
  sampleCount?: number;
  /** Number of rays per pixel. Default `16`. */
  rayCount?: CORTAORayCount;
  /** Mip level bias for the depth samples. Default `-4`. */
  mipBias?: number;
  /** Maximum enlargement of occluders that are seen at a grazing angle. Default `4`. */
  maxSlopeCompensation?: number;
  /** Threshold that classifies an occluder as a back face, from 0 to 1. Default `0.5`. */
  backfaceThreshold?: number;
  /** Extra enlargement of back-face occluders, from 0 to 1. Default `0.5`. */
  backfaceBoost?: number;
  /** Apply the CORTAO bilateral filter pass. Default `true`. */
  filter?: boolean;
  /** Use the 13-tap filter instead of the 5-tap filter. Default `true`. */
  largeFilter?: boolean;
  /** Use symmetric filter weights. This keeps contact shadows sharper. Default `true`. */
  filterSymmetry?: boolean;
  /** Depth sensitivity of the filter. `0` disables the depth test. Default `512`. */
  filterDepthSensitivity?: number;
  /** Normal sensitivity of the filter. `0` disables the normal test. Default `16`. */
  filterNormalSensitivity?: number;
  /** Seed of the per-pixel noise. Keep it constant to prevent flicker. Default `0`. */
  randomSeed?: number;
  /** Show the occlusion as a gray image instead of the shaded scene. Default `false`. */
  showOcclusion?: boolean;
};

/** The default props. They follow the Carbon Engine version of CORTAO. */
const DEFAULT_PROPS: Required<CORTAOEffectProps> = {
  id: 'cortao',
  radius: Number.POSITIVE_INFINITY,
  maxScreenSpaceRadius: 0.2,
  intensity: 1,
  sampleCount: 16,
  rayCount: 16,
  mipBias: -4,
  maxSlopeCompensation: 4,
  backfaceThreshold: 0.5,
  backfaceBoost: 0.5,
  filter: true,
  largeFilter: true,
  filterSymmetry: true,
  filterDepthSensitivity: 512,
  filterNormalSensitivity: 16,
  randomSeed: 0,
  showOcclusion: false
};

/**
 * Frame configurations that the effect does not support. For these frames, the effect removes its
 * `postRender` callback, so deck.gl renders the frame without the effect.
 */
const UNSUPPORTED_FRAME_MESSAGES = {
  multipleViewports: 'CORTAOEffect supports one viewport only. The scene passes through.',
  notPerspective: 'CORTAOEffect supports perspective views only. The scene passes through.',
  postProcessBuffers:
    'CORTAOEffect needs deck.gl post-process buffers with a depth attachment on WebGPU, but the ' +
    'existing buffers have none (deck.gl#10981). The scene passes through.'
} as const;

/** A reason why the effect does not render a frame. */
type UnsupportedFrameReason = keyof typeof UNSUPPORTED_FRAME_MESSAGES;

/** Render targets of the layer capture. They depend on the drawing buffer size. */
type CaptureTargets = {
  width: number;
  height: number;
  colorTexture: Texture;
  depthTexture: Texture;
  framebuffer: Framebuffer;
};

/**
 * Screen-space ambient occlusion with CORTAO (Circular Occluder Ray-Traced Ambient Occlusion), by
 * Daniel Isheden.
 *
 * The effect draws the layers once more into its own color and depth targets, because the deck.gl
 * post-process buffers have no depth attachment. It reconstructs view-space normals from depth,
 * runs the CORTAO prepass, mip pass, main pass and optional filter pass, and multiplies the
 * captured color by the occlusion. It ignores the color input of the post-process chain, so add it
 * before other post-process effects.
 *
 * The effect picks the backend from the device: GLSL full-screen passes on WebGL 2, and WGSL
 * compute passes on WebGPU. The WebGPU passes use real mip levels and `textureGather()`.
 *
 * Limits: perspective views only, and one viewport only. For other frames, the effect logs a
 * warning one time and deck.gl renders the frame without the effect. On WebGPU, the same applies
 * when the deck.gl post-process buffers already exist without a depth attachment.
 */
export class CORTAOEffect implements Effect {
  /** Effect id. */
  id: string;
  /** Current props, with defaults applied. */
  props: Required<CORTAOEffectProps>;
  /** The effect does nothing in picking passes. */
  readonly useInPicking = false;
  /**
   * Post-process callback. Deck.gl tests for it to decide whether to render into its offscreen
   * buffers. The effect removes it when the device is not supported, so deck.gl renders as usual.
   */
  postRender?: (options: PostRenderOptions) => Framebuffer | null;

  /** The bound post-process callback. `preRender()` sets or removes `postRender` for each frame. */
  private readonly renderPostProcessCallback: (options: PostRenderOptions) => Framebuffer | null;
  private device: Device | null = null;
  private deck: EffectContext['deck'] | null = null;
  private capturePass: LayersPass | null = null;
  private passes: CORTAOPasses | null = null;
  private targets: CaptureTargets | null = null;
  /** The camera of the frame that `preRender` captured, or `null` if it captured nothing. */
  private camera: CORTAOCamera | null = null;
  /** The unsupported frame reasons that the effect has logged. It logs each reason one time. */
  private readonly warnedReasons = new Set<UnsupportedFrameReason>();

  /** Creates the effect. */
  constructor(props: CORTAOEffectProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
    this.id = this.props.id;
    this.renderPostProcessCallback = this.renderPostProcess.bind(this);
    this.postRender = this.renderPostProcessCallback;
  }

  /** The GPU backend of the passes, or `null` before `setup()`. */
  get backend(): 'webgl' | 'webgpu' | null {
    return this.device ? (this.device.type as 'webgl' | 'webgpu') : null;
  }

  /** Creates the GPU resources. Called by deck.gl when the effect is added. */
  setup({device, deck}: EffectContext): void {
    if (device.type !== 'webgl' && device.type !== 'webgpu') {
      log.warn('CORTAOEffect supports WebGL 2 and WebGPU only')();
      this.postRender = undefined;
      return;
    }
    this.device = device;
    this.deck = deck;
    this.capturePass = new LayersPass(device, {id: `${this.id}-capture`});
    const options = this.getShaderOptions();
    this.passes =
      device.type === 'webgpu'
        ? new CORTAOWebGPUPasses(device, this.id, options)
        : new CORTAOWebGLPasses(device, this.id, options);
  }

  /** Updates the props. A change of a shader constant rebuilds the affected pipelines. */
  setProps(props: CORTAOEffectProps): void {
    const previousProps = this.props;
    this.props = {...this.props, ...props};
    if (
      this.passes &&
      (previousProps.sampleCount !== this.props.sampleCount ||
        previousProps.rayCount !== this.props.rayCount ||
        previousProps.largeFilter !== this.props.largeFilter ||
        previousProps.filterSymmetry !== this.props.filterSymmetry)
    ) {
      this.passes.setShaderOptions(this.getShaderOptions());
    }
  }

  /** Draws the layers into the color and depth capture targets. */
  preRender(options: PreRenderOptions): void {
    this.camera = null;
    if (options.isPicking || !this.device || !this.capturePass) {
      return;
    }
    // Deck.gl reads `postRender` after `preRender()`. Without it, deck.gl renders this frame
    // directly to its target, as if the effect were not there.
    this.postRender = undefined;
    if (options.viewports.length !== 1) {
      // The capture, the depth reconstruction and the composite use one camera for the full target.
      this.warnOnce('multipleViewports');
      return;
    }
    const camera = getCORTAOCamera(options.viewports[0]);
    if (!camera) {
      this.warnOnce('notPerspective');
      return;
    }
    const canvasContext = options.canvasContext || this.device.getDefaultCanvasContext();
    const [width, height] = canvasContext.getDrawingBufferSize();
    if (width <= 0 || height <= 0) {
      return;
    }
    if (this.device.type === 'webgpu' && !this.preparePostProcessBuffers()) {
      this.warnOnce('postProcessBuffers');
      return;
    }
    this.postRender = this.renderPostProcessCallback;
    const targets = this.getTargets(width, height);
    this.capturePass.render({
      ...options,
      pass: `${this.id}-capture`,
      target: targets.framebuffer,
      canvasContext,
      effects: options.effects?.filter(effect => effect !== this),
      // View clears would start a nested render pass. The capture target is cleared once instead.
      views: undefined,
      isPicking: false,
      clearCanvas: true,
      clearColor: [0, 0, 0, 0]
    });
    this.camera = camera;
  }

  /** Releases the GPU resources. Called by deck.gl when the effect is removed. */
  cleanup(): void {
    this.passes?.destroy();
    this.passes = null;
    this.destroyTargets();
    this.capturePass?.cleanup();
    this.capturePass = null;
    this.device = null;
    this.deck = null;
  }

  /** Logs the message of an unsupported frame reason, one time for each reason. */
  private warnOnce(reason: UnsupportedFrameReason): void {
    if (!this.warnedReasons.has(reason)) {
      this.warnedReasons.add(reason);
      log.warn(UNSUPPORTED_FRAME_MESSAGES[reason])();
    }
  }

  /**
   * Workaround for the missing depth attachment of the deck.gl post-process buffers
   * (deck.gl#10981). With a post-process effect, deck.gl draws the layers into its first
   * post-process buffer. On WebGPU, the layer pipelines have a depth format, so a draw into a
   * buffer without depth is invalid and the frame is lost. Deck.gl creates the two buffers only
   * when it has none, after `preRender()`. So this method creates them first, with a depth
   * attachment. Deck.gl resizes and deletes them as its own.
   *
   * Deck.gl keeps its buffers for the life of the `Deck`. If an earlier post-process effect made
   * them without depth, this method cannot change them.
   *
   * @returns `true` if the buffers have the depth attachment that the layer pipelines expect.
   */
  private preparePostProcessBuffers(): boolean {
    const renderer = (
      this.deck as unknown as {
        deckRenderer?: {renderBuffers?: Framebuffer[]};
      }
    )?.deckRenderer;
    const device = this.device!;
    const renderBuffers = renderer?.renderBuffers;
    if (!Array.isArray(renderBuffers)) {
      // The deck.gl internals changed. The effect cannot check the buffers.
      return false;
    }
    if (renderBuffers.length > 0) {
      return renderBuffers.every(
        framebuffer =>
          framebuffer.depthStencilAttachment?.texture.format === device.preferredDepthFormat
      );
    }
    for (const index of [0, 1]) {
      renderBuffers.push(
        device.createFramebuffer({
          id: `deck-renderbuffer-${index}`,
          colorAttachments: [
            device.createTexture({
              format: device.preferredColorFormat,
              width: 1,
              height: 1,
              sampler: {minFilter: 'linear', magFilter: 'linear'}
            })
          ],
          depthStencilAttachment: device.preferredDepthFormat as TextureFormatDepthStencil
        })
      );
    }
    return true;
  }

  /** Runs the CORTAO passes and the composite pass. */
  private renderPostProcess(options: PostRenderOptions): Framebuffer | null {
    const {passes, targets, camera} = this;
    // As in the deck.gl PostProcessEffect: `undefined` means "not the last effect", and `null` is
    // the default framebuffer.
    const output = (options.target !== undefined ? options.target : options.swapBuffer) ?? null;
    const clearCanvas = options.target === undefined || Boolean(options.clearCanvas);
    if (!passes) {
      return output;
    }
    if (!targets || !camera) {
      // Nothing was captured. Copy the input color without occlusion.
      passes.composite({
        output,
        colorTexture: options.inputBuffer.colorAttachments[0].texture,
        occlusionTexture: null,
        showOcclusion: false,
        clearCanvas
      });
      return output;
    }
    const occlusionTexture = passes.renderOcclusion({
      camera,
      configuration: this.getConfiguration(targets.width, targets.height),
      depthTexture: targets.depthTexture,
      filter: this.props.filter
    });
    passes.composite({
      output,
      colorTexture: targets.colorTexture,
      occlusionTexture,
      showOcclusion: this.props.showOcclusion,
      clearCanvas
    });
    return output;
  }

  /** Gets the shader constants from the props. */
  private getShaderOptions(): CORTAOShaderOptions {
    const {sampleCount, rayCount, largeFilter, filterSymmetry} = this.props;
    return {sampleCount, rayCount, largeFilter, filterSymmetry};
  }

  /** Gets the pass configuration from the props. */
  private getConfiguration(width: number, height: number): CORTAOConfiguration {
    const {props} = this;
    return {
      width,
      height,
      randomSeed: props.randomSeed,
      radius: props.radius,
      maxScreenSpaceRadius: props.maxScreenSpaceRadius,
      mipBias: props.mipBias,
      maxSlopeCompensation: props.maxSlopeCompensation,
      backfaceThreshold: props.backfaceThreshold,
      backfaceBoost: props.backfaceBoost,
      intensity: props.intensity,
      filterDepthSensitivity: props.filterDepthSensitivity,
      filterNormalSensitivity: props.filterNormalSensitivity
    };
  }

  /**
   * Gets the capture targets for a drawing buffer size. Creates them again when the size changes.
   * On WebGPU, the layer pipelines use the preferred color and depth formats of the device, so the
   * capture targets use them too.
   */
  private getTargets(width: number, height: number): CaptureTargets {
    if (this.targets && this.targets.width === width && this.targets.height === height) {
      return this.targets;
    }
    this.destroyTargets();
    const device = this.device!;
    const isWebGPU = device.type === 'webgpu';
    const usage = Texture.SAMPLE | Texture.RENDER;
    const colorTexture = device.createTexture({
      id: `${this.id}-color`,
      format: isWebGPU ? device.preferredColorFormat : 'rgba8unorm',
      width,
      height,
      usage,
      sampler: NEAREST_SAMPLER
    });
    const depthTexture = device.createTexture({
      id: `${this.id}-depth`,
      // luma.gl types the preferred depth format with names that `TextureFormat` does not list.
      format: isWebGPU ? (device.preferredDepthFormat as TextureFormat) : 'depth32float',
      width,
      height,
      usage,
      sampler: NEAREST_SAMPLER
    });
    const framebuffer = device.createFramebuffer({
      id: `${this.id}-capture`,
      width,
      height,
      colorAttachments: [colorTexture],
      depthStencilAttachment: depthTexture
    });
    this.targets = {width, height, colorTexture, depthTexture, framebuffer};
    return this.targets;
  }

  private destroyTargets(): void {
    const {targets} = this;
    if (!targets) {
      return;
    }
    targets.framebuffer.destroy();
    targets.colorTexture.destroy();
    targets.depthTexture.destroy();
    this.targets = null;
  }
}
