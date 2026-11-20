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
import type {
  Device,
  Framebuffer,
  RenderPipelineParameters,
  Texture,
  TextureFormat
} from '@luma.gl/core';
import {ClipSpace} from '@luma.gl/engine';
import {
  createOccluderLookupTable,
  type CORTAORayCount,
  type OccluderLookupTable
} from './cortao-occluder-lookup-table';
import {
  getCORTAOCamera,
  getCORTAOFilterPassUniforms,
  getCORTAOMainPassUniforms,
  getCORTAOMipAtlasSize,
  getCORTAOMipmapUniforms,
  getCORTAOPrepassUniforms,
  type CORTAOCamera,
  type CORTAOConfiguration
} from './cortao-parameters';
import {
  CORTAO_COMPOSITE_FS,
  CORTAO_FILTER_PASS_FS,
  CORTAO_MAIN_PASS_FS,
  CORTAO_MIPMAP_FS,
  CORTAO_PREPASS_FS,
  cortaoComposite,
  cortaoFilter,
  cortaoMain,
  cortaoMipmap,
  cortaoPrepass
} from './cortao-shaders';

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

/** Pipeline parameters of the full-screen passes. */
const PASS_PARAMETERS: RenderPipelineParameters = {
  depthWriteEnabled: false,
  depthCompare: 'always'
};

/** Pipeline parameters of the composite pass. They match the deck.gl `ScreenPass` blending. */
const COMPOSITE_PARAMETERS: RenderPipelineParameters = {
  ...PASS_PARAMETERS,
  blend: true,
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  blendColorOperation: 'add',
  blendAlphaOperation: 'add'
};

/** Nearest sampling. Integer and depth textures are incomplete with linear filtering in WebGL 2. */
const NEAREST_SAMPLER = {minFilter: 'nearest', magFilter: 'nearest'} as const;

/** Render targets that depend on the drawing buffer size. */
type CORTAOTargets = {
  width: number;
  height: number;
  textures: Texture[];
  colorTexture: Texture;
  depthTexture: Texture;
  packedLevel0Texture: Texture;
  normalTexture: Texture;
  packedAtlasTexture: Texture;
  occlusionTexture: Texture;
  filteredOcclusionTexture: Texture;
  captureFramebuffer: Framebuffer;
  prepassFramebuffer: Framebuffer;
  mipmapFramebuffer: Framebuffer;
  mainFramebuffer: Framebuffer;
  filterFramebuffer: Framebuffer;
};

/** The pipelines of the passes. */
type CORTAOModels = {
  prepass: ClipSpace;
  mipmap: ClipSpace;
  main: ClipSpace;
  filter: ClipSpace;
  composite: ClipSpace;
};

/**
 * Screen-space ambient occlusion with CORTAO (Circular Occluder Ray-Traced Ambient Occlusion), by
 * Daniel Isheden.
 *
 * The effect draws the layers once more into its own color and depth targets, because the deck.gl
 * post-process buffers have no depth attachment. It reconstructs view-space normals from depth,
 * runs the CORTAO prepass, main pass and optional filter pass, and multiplies the captured color by
 * the occlusion. It ignores the color input of the post-process chain, so add it before other
 * post-process effects.
 *
 * Limits: WebGL 2 only, perspective views only, and the first viewport only.
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

  private device: Device | null = null;
  private capturePass: LayersPass | null = null;
  private models: CORTAOModels | null = null;
  private lookupTableTexture: Texture | null = null;
  private targets: CORTAOTargets | null = null;
  /** The camera of the frame that `preRender` captured, or `null` if it captured nothing. */
  private camera: CORTAOCamera | null = null;
  private hasWarned = false;

  /** Creates the effect. */
  constructor(props: CORTAOEffectProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
    this.id = this.props.id;
    this.postRender = this.renderPostProcess.bind(this);
  }

  /** Creates the GPU resources. Called by deck.gl when the effect is added. */
  setup({device}: EffectContext): void {
    if (device.type !== 'webgl') {
      log.warn('CORTAOEffect supports WebGL 2 only')();
      this.postRender = undefined;
      return;
    }
    this.device = device;
    this.capturePass = new LayersPass(device, {id: `${this.id}-capture`});
    this.createModels();
    this.createLookupTable();
  }

  /** Updates the props. A change of a shader constant rebuilds the affected pipelines. */
  setProps(props: CORTAOEffectProps): void {
    const previousProps = this.props;
    this.props = {...this.props, ...props};
    if (!this.device) {
      return;
    }
    if (
      previousProps.sampleCount !== this.props.sampleCount ||
      previousProps.rayCount !== this.props.rayCount ||
      previousProps.largeFilter !== this.props.largeFilter ||
      previousProps.filterSymmetry !== this.props.filterSymmetry
    ) {
      this.destroyModels();
      this.createModels();
    }
    if (previousProps.rayCount !== this.props.rayCount) {
      this.lookupTableTexture?.destroy();
      this.createLookupTable();
    }
  }

  /** Draws the layers into the color and depth capture targets. */
  preRender(options: PreRenderOptions): void {
    this.camera = null;
    if (options.isPicking || !this.device || !this.capturePass) {
      return;
    }
    const viewport = options.viewports[0];
    const camera = viewport ? getCORTAOCamera(viewport) : null;
    if (!camera) {
      if (!this.hasWarned) {
        log.warn('CORTAOEffect supports perspective views only')();
        this.hasWarned = true;
      }
      return;
    }
    const canvasContext = options.canvasContext || this.device.getDefaultCanvasContext();
    const [width, height] = canvasContext.getDrawingBufferSize();
    if (width <= 0 || height <= 0) {
      return;
    }
    const targets = this.getTargets(width, height);
    this.capturePass.render({
      ...options,
      pass: `${this.id}-capture`,
      target: targets.captureFramebuffer,
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
    this.destroyModels();
    this.destroyTargets();
    this.lookupTableTexture?.destroy();
    this.lookupTableTexture = null;
    this.capturePass?.cleanup();
    this.capturePass = null;
    this.device = null;
  }

  /** Runs the CORTAO passes and the composite pass. */
  private renderPostProcess(options: PostRenderOptions): Framebuffer | null {
    const {device, models, targets, camera} = this;
    // As in the deck.gl PostProcessEffect: `undefined` means "not the last effect", and `null` is
    // the default framebuffer.
    const renderToTarget = options.target !== undefined;
    const output = renderToTarget ? options.target : options.swapBuffer;
    if (!device || !models || !targets || !camera || !this.lookupTableTexture) {
      // Nothing was captured. Copy the input color without occlusion.
      this.renderComposite(output, options.inputBuffer.colorAttachments[0].texture, null, options);
      return output ?? null;
    }
    const {width, height} = targets;
    const configuration = this.getConfiguration(width, height);

    models.prepass.shaderInputs.setProps({
      cortaoPrepass: getCORTAOPrepassUniforms(camera, configuration)
    });
    models.prepass.setBindings({depthTexture: targets.depthTexture});
    this.renderFullScreen(models.prepass, targets.prepassFramebuffer, width, height);

    const [atlasWidth, atlasHeight] = getCORTAOMipAtlasSize(width, height);
    models.mipmap.shaderInputs.setProps({cortaoMipmap: getCORTAOMipmapUniforms(configuration)});
    models.mipmap.setBindings({packedLevel0Texture: targets.packedLevel0Texture});
    this.renderFullScreen(models.mipmap, targets.mipmapFramebuffer, atlasWidth, atlasHeight);

    models.main.shaderInputs.setProps({
      cortaoMain: getCORTAOMainPassUniforms(camera, configuration)
    });
    models.main.setBindings({
      packedDataTexture: targets.packedAtlasTexture,
      normalTexture: targets.normalTexture,
      occluderLookupTable: this.lookupTableTexture
    });
    this.renderFullScreen(models.main, targets.mainFramebuffer, width, height);

    let occlusionTexture = targets.occlusionTexture;
    if (this.props.filter) {
      models.filter.shaderInputs.setProps({
        cortaoFilter: getCORTAOFilterPassUniforms(configuration)
      });
      models.filter.setBindings({
        packedDataTexture: targets.packedAtlasTexture,
        occlusionTexture: targets.occlusionTexture
      });
      this.renderFullScreen(models.filter, targets.filterFramebuffer, width, height);
      occlusionTexture = targets.filteredOcclusionTexture;
    }

    this.renderComposite(output, targets.colorTexture, occlusionTexture, options);
    return output ?? null;
  }

  /** Writes the color, multiplied by the occlusion if there is one, to the output. */
  private renderComposite(
    output: Framebuffer | null | undefined,
    colorTexture: Texture,
    occlusionTexture: Texture | null,
    options: PostRenderOptions
  ): void {
    const {models} = this;
    if (!this.device || !models) {
      return;
    }
    models.composite.shaderInputs.setProps({
      cortaoComposite: {
        showOcclusion: this.props.showOcclusion && occlusionTexture ? 1 : 0,
        useOcclusion: occlusionTexture ? 1 : 0
      }
    });
    models.composite.setBindings({
      colorTexture,
      occlusionTexture: occlusionTexture ?? colorTexture
    });
    const clearCanvas = options.target === undefined || Boolean(options.clearCanvas);
    const renderPass = this.device.beginRenderPass({
      id: `${this.id}-composite`,
      framebuffer: output,
      parameters: {viewport: [0, 0, colorTexture.width, colorTexture.height]},
      clearColor: clearCanvas ? [0, 0, 0, 0] : false,
      clearDepth: false,
      clearStencil: false
    });
    models.composite.draw(renderPass);
    renderPass.end();
  }

  /** Draws one full-screen pass. The pass writes every pixel, so there is no clear. */
  private renderFullScreen(
    model: ClipSpace,
    framebuffer: Framebuffer,
    width: number,
    height: number
  ): void {
    const renderPass = this.device!.beginRenderPass({
      id: model.id,
      framebuffer,
      parameters: {viewport: [0, 0, width, height]},
      clearColor: false,
      clearDepth: false,
      clearStencil: false
    });
    model.draw(renderPass);
    renderPass.end();
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

  /** Creates the pass pipelines. */
  private createModels(): void {
    const device = this.device!;
    const lookupTableSize = {
      directionResolution: 24,
      radiusResolution: 16
    };
    this.models = {
      prepass: new ClipSpace(device, {
        id: `${this.id}-prepass`,
        fs: CORTAO_PREPASS_FS,
        modules: [cortaoPrepass],
        parameters: PASS_PARAMETERS
      }),
      mipmap: new ClipSpace(device, {
        id: `${this.id}-mipmap`,
        fs: CORTAO_MIPMAP_FS,
        modules: [cortaoMipmap],
        parameters: PASS_PARAMETERS
      }),
      main: new ClipSpace(device, {
        id: `${this.id}-main`,
        fs: CORTAO_MAIN_PASS_FS,
        modules: [cortaoMain],
        defines: {
          CORTAO_SAMPLE_COUNT: Math.max(1, Math.round(this.props.sampleCount)),
          CORTAO_RAY_COUNT: this.props.rayCount,
          CORTAO_LOOKUP_DIRECTION_RESOLUTION: lookupTableSize.directionResolution,
          CORTAO_LOOKUP_RADIUS_RESOLUTION: lookupTableSize.radiusResolution
        },
        parameters: PASS_PARAMETERS
      }),
      filter: new ClipSpace(device, {
        id: `${this.id}-filter`,
        fs: CORTAO_FILTER_PASS_FS,
        modules: [cortaoFilter],
        defines: {
          CORTAO_LARGE_FILTER: this.props.largeFilter ? 1 : 0,
          CORTAO_FILTER_SYMMETRY: this.props.filterSymmetry ? 1 : 0
        },
        parameters: PASS_PARAMETERS
      }),
      composite: new ClipSpace(device, {
        id: `${this.id}-composite`,
        fs: CORTAO_COMPOSITE_FS,
        modules: [cortaoComposite],
        parameters: COMPOSITE_PARAMETERS
      })
    };
  }

  /** Destroys the pass pipelines. */
  private destroyModels(): void {
    if (this.models) {
      for (const model of Object.values(this.models)) {
        model.destroy();
      }
      this.models = null;
    }
  }

  /** Creates the occluder lookup table texture for the current ray count. */
  private createLookupTable(): void {
    const table: OccluderLookupTable = createOccluderLookupTable({rayCount: this.props.rayCount});
    const texture = this.device!.createTexture({
      id: `${this.id}-occluder-lookup-table`,
      dimension: '3d',
      format: table.format,
      width: table.directionResolution,
      height: table.directionResolution,
      depth: table.radiusResolution,
      sampler: NEAREST_SAMPLER
    });
    texture.writeData(table.data);
    this.lookupTableTexture = texture;
  }

  /** Gets the render targets for a drawing buffer size. Creates them again when the size changes. */
  private getTargets(width: number, height: number): CORTAOTargets {
    if (this.targets && this.targets.width === width && this.targets.height === height) {
      return this.targets;
    }
    this.destroyTargets();
    const device = this.device!;
    const textures: Texture[] = [];
    const createTarget = (name: string, format: TextureFormat, size = [width, height]) => {
      const texture = device.createTexture({
        id: `${this.id}-${name}`,
        format,
        width: size[0],
        height: size[1],
        sampler: NEAREST_SAMPLER
      });
      textures.push(texture);
      return texture;
    };
    const colorTexture = createTarget('color', 'rgba8unorm');
    const depthTexture = createTarget('depth', 'depth32float');
    const packedLevel0Texture = createTarget('packed-level-0', 'r32uint');
    const normalTexture = createTarget('normal', 'rgba8unorm');
    const packedAtlasTexture = createTarget(
      'packed-atlas',
      'r32uint',
      getCORTAOMipAtlasSize(width, height)
    );
    const occlusionTexture = createTarget('occlusion', 'r8unorm');
    const filteredOcclusionTexture = createTarget('filtered-occlusion', 'r8unorm');
    const createFramebuffer = (
      name: string,
      colorAttachments: Texture[],
      depthStencilAttachment?: Texture
    ) =>
      device.createFramebuffer({
        id: `${this.id}-${name}`,
        width: colorAttachments[0].width,
        height: colorAttachments[0].height,
        colorAttachments,
        depthStencilAttachment
      });
    this.targets = {
      width,
      height,
      textures,
      colorTexture,
      depthTexture,
      packedLevel0Texture,
      normalTexture,
      packedAtlasTexture,
      occlusionTexture,
      filteredOcclusionTexture,
      captureFramebuffer: createFramebuffer('capture', [colorTexture], depthTexture),
      prepassFramebuffer: createFramebuffer('prepass', [packedLevel0Texture, normalTexture]),
      mipmapFramebuffer: createFramebuffer('mipmap', [packedAtlasTexture]),
      mainFramebuffer: createFramebuffer('main', [occlusionTexture]),
      filterFramebuffer: createFramebuffer('filter', [filteredOcclusionTexture])
    };
    return this.targets;
  }

  /** Destroys the render targets. */
  private destroyTargets(): void {
    const {targets} = this;
    if (!targets) {
      return;
    }
    for (const framebuffer of [
      targets.captureFramebuffer,
      targets.prepassFramebuffer,
      targets.mipmapFramebuffer,
      targets.mainFramebuffer,
      targets.filterFramebuffer
    ]) {
      framebuffer.destroy();
    }
    for (const texture of targets.textures) {
      texture.destroy();
    }
    this.targets = null;
  }
}
