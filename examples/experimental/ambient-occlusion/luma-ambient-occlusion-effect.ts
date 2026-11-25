// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  _LayersPass as LayersPass,
  log,
  type Effect,
  type EffectContext,
  type PostRenderOptions,
  type PreRenderOptions,
  type Viewport
} from '@deck.gl/core';
import {
  Buffer,
  Texture,
  type Device,
  type Framebuffer,
  type TextureFormat,
  type TextureFormatDepthStencil
} from '@luma.gl/core';
import {ClipSpace, Computation} from '@luma.gl/engine';
import {AmbientOcclusionPass} from '@luma.gl/engine/lighting';
import type {ShaderModule} from '@luma.gl/shaders';

/** The luma.gl ambient occlusion methods. */
export type LumaAmbientOcclusionMethod = 'ssao' | 'gtao';

/** Props of {@link LumaAmbientOcclusionEffect}. */
export type LumaAmbientOcclusionEffectProps = {
  id?: string;
  method?: LumaAmbientOcclusionMethod;
  /** World-space radius, in meters. GTAO uses it directly. SSAO gets it in pixels, see below. */
  radius?: number;
  /**
   * Maximum screen-space radius, as a fraction of the viewport height. SSAO uses it to clamp its
   * pixel radius. GTAO has its own clamp, from 2 to 72 pixels.
   */
  maxScreenSpaceRadius?: number;
  /** The luma.gl `intensity` control. `undefined` keeps the luma.gl default of the method. */
  intensity?: number;
  /** The resolution scale of the luma.gl pass. The luma.gl default is 0.5. */
  resolutionScale?: number;
  /** Show the occlusion as a gray image instead of the shaded scene. */
  showOcclusion?: boolean;
};

const DEFAULT_PROPS: Required<Omit<LumaAmbientOcclusionEffectProps, 'intensity'>> & {
  intensity: number | undefined;
} = {
  id: 'luma-ambient-occlusion',
  method: 'gtao',
  radius: 30,
  maxScreenSpaceRadius: 0.2,
  intensity: undefined,
  resolutionScale: 1,
  showOcclusion: false
};

/** The capture targets. They depend on the drawing buffer size. */
type Targets = {
  width: number;
  height: number;
  colorTexture: Texture;
  depthTexture: Texture;
  normalTexture: Texture;
  framebuffer: Framebuffer;
};

/** The meter-sized camera of a viewport. */
type Camera = {
  /** Perspective projection with WebGPU clip depth, from view space in meters. */
  projectionMatrix: number[];
  near: number;
  far: number;
  /** Distance from the camera to the view target, in meters. */
  targetDistance: number;
};

/**
 * View-space normals from depth, as the CORTAO prepass makes them: for each axis, the neighbor
 * with the smaller depth step. The output is `normal * 0.5 + 0.5`, the encoding that the luma.gl
 * `AmbientOcclusionPass` reads.
 *
 * The two luma.gl evaluators read the Y component differently. GTAO unprojects with +Y up, as the
 * deck.gl projection has. SSAO compares the normal with sample directions in texture coordinates,
 * with +Y down, and its own normal from depth has +Y down. So the pass flips Y for SSAO.
 */
const NORMAL_PASS_WGSL = /* wgsl */ `\
struct NormalUniforms {
  unprojectParams: vec4f,
  resolution: vec2f,
  depthScale: f32,
  depthOffset: f32,
  /** -1 writes the Y component in texture row order (down), as the luma.gl SSAO reads it. */
  normalYScale: f32,
};

@group(0) @binding(0) var<uniform> normals: NormalUniforms;
@group(0) @binding(1) var depthTexture: texture_depth_2d;
@group(0) @binding(2) var normalOutput: texture_storage_2d<rgba8unorm, write>;

struct Position {
  valid: bool,
  position: vec3f,
};

// Pixel coordinates with the origin at the bottom left.
fn loadPosition(pixel: vec2i) -> Position {
  let size = vec2i(normals.resolution);
  if (any(pixel < vec2i(0)) || any(pixel >= size)) {
    return Position(false, vec3f(0.0));
  }
  let depth = textureLoad(depthTexture, vec2i(pixel.x, size.y - 1 - pixel.y), 0);
  if (depth == 1.0) {
    return Position(false, vec3f(0.0));
  }
  let linearDepth = 1.0 / (depth * normals.depthScale + normals.depthOffset);
  let texCoords = (vec2f(pixel) + 0.5) / normals.resolution;
  let direction = texCoords * normals.unprojectParams.xy + normals.unprojectParams.zw;
  return Position(true, vec3f(direction, -1.0) * linearDepth);
}

fn getTangent(pixel: vec2i, axis: vec2i, position: vec3f) -> Position {
  let forwardSample = loadPosition(pixel + axis);
  let backwardSample = loadPosition(pixel - axis);
  let forward = forwardSample.position - position;
  let backward = position - backwardSample.position;
  if (forwardSample.valid && backwardSample.valid) {
    return Position(true, select(backward, forward, abs(forward.z) < abs(backward.z)));
  }
  if (forwardSample.valid) {
    return Position(true, forward);
  }
  if (backwardSample.valid) {
    return Position(true, backward);
  }
  return Position(false, vec3f(0.0));
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = vec2i(normals.resolution);
  let texel = vec2i(id.xy);
  if (any(texel >= size)) {
    return;
  }
  let pixel = vec2i(texel.x, size.y - 1 - texel.y);
  let center = loadPosition(pixel);
  if (!center.valid) {
    textureStore(normalOutput, texel, vec4f(0.5, 0.5, 1.0, 1.0));
    return;
  }
  var normal = normalize(-center.position);
  let tangentX = getTangent(pixel, vec2i(1, 0), center.position);
  let tangentY = getTangent(pixel, vec2i(0, 1), center.position);
  if (tangentX.valid && tangentY.valid) {
    let crossProduct = cross(tangentX.position, tangentY.position);
    if (dot(crossProduct, crossProduct) > 0.0) {
      normal = normalize(crossProduct);
    }
  }
  if (dot(normal, center.position) > 0.0) {
    normal = -normal;
  }
  normal.y *= normals.normalYScale;
  textureStore(normalOutput, texel, vec4f(normal * 0.5 + 0.5, 1.0));
}
`;

type CompositeUniforms = {showOcclusion: number};

const compositeModule = {
  name: 'lumaAmbientOcclusionComposite',
  source: /* wgsl */ `\
struct lumaAmbientOcclusionCompositeUniforms {
  showOcclusion: f32,
};
@group(0) @binding(auto) var<uniform> lumaAmbientOcclusionComposite: lumaAmbientOcclusionCompositeUniforms;
`,
  uniformTypes: {showOcclusion: 'f32'}
} as const satisfies ShaderModule<CompositeUniforms>;

/** Multiplies the color by the visibility, as the CORTAO composite pass does. */
const COMPOSITE_WGSL = /* wgsl */ `\
@group(0) @binding(auto) var colorTexture: texture_2d<f32>;
@group(0) @binding(auto) var visibilityTexture: texture_2d<f32>;
@group(0) @binding(auto) var visibilityTextureSampler: sampler;

@fragment
fn fragmentMain(inputs: FragmentInputs) -> @location(0) vec4f {
  let pixel = vec2i(inputs.Position.xy);
  let color = textureLoad(colorTexture, pixel, 0);
  let uv = inputs.Position.xy / vec2f(textureDimensions(colorTexture));
  let visibility = textureSampleLevel(visibilityTexture, visibilityTextureSampler, uv, 0.0).r;
  if (lumaAmbientOcclusionComposite.showOcclusion > 0.5) {
    return vec4f(vec3f(visibility), 1.0);
  }
  return vec4f(color.rgb * visibility, color.a);
}
`;

/**
 * Screen-space ambient occlusion with the luma.gl `AmbientOcclusionPass` (SSAO or GTAO), for a
 * comparison with CORTAO. WebGPU only.
 *
 * It uses the same layer capture and the same normals from depth as `CORTAOEffect`, and the same
 * composite: the color times the visibility.
 */
export class LumaAmbientOcclusionEffect implements Effect {
  id: string;
  props: typeof DEFAULT_PROPS;
  readonly useInPicking = false;
  postRender?: (options: PostRenderOptions) => Framebuffer | null;

  private device: Device | null = null;
  private deck: EffectContext['deck'] | null = null;
  private capturePass: LayersPass | null = null;
  private ambientOcclusionPass: AmbientOcclusionPass | null = null;
  private normalPass: Computation | null = null;
  private normalUniforms: Buffer | null = null;
  private composite: ClipSpace | null = null;
  private targets: Targets | null = null;
  private camera: Camera | null = null;

  constructor(props: LumaAmbientOcclusionEffectProps = {}) {
    this.props = {...DEFAULT_PROPS, ...props};
    this.id = this.props.id;
    this.postRender = this.renderPostProcess.bind(this);
  }

  setup({device, deck}: EffectContext): void {
    if (device.type !== 'webgpu') {
      log.warn('The luma.gl ambient occlusion passes are WebGPU only')();
      this.postRender = undefined;
      return;
    }
    this.device = device;
    this.deck = deck;
    this.capturePass = new LayersPass(device, {id: `${this.id}-capture`});
    this.createPasses();
    this.normalUniforms = device.createBuffer({
      id: `${this.id}-normal-uniforms`,
      byteLength: 48,
      usage: Buffer.UNIFORM | Buffer.COPY_DST
    });
    this.normalPass = new Computation(device, {
      id: `${this.id}-normals`,
      source: NORMAL_PASS_WGSL,
      shaderLayout: {
        bindings: [
          {name: 'normals', type: 'uniform', group: 0, location: 0, visibility: 4},
          {
            name: 'depthTexture',
            type: 'texture',
            group: 0,
            location: 1,
            visibility: 4,
            sampleType: 'depth',
            viewDimension: '2d'
          },
          {
            name: 'normalOutput',
            type: 'storage',
            group: 0,
            location: 2,
            visibility: 4,
            access: 'write-only',
            format: 'rgba8unorm',
            viewDimension: '2d'
          }
        ]
      }
    });
    this.composite = new ClipSpace(device, {
      id: `${this.id}-composite`,
      source: COMPOSITE_WGSL,
      modules: [compositeModule],
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

  setProps(props: LumaAmbientOcclusionEffectProps): void {
    const previous = this.props;
    this.props = {...this.props, ...props};
    if (
      this.device &&
      (previous.method !== this.props.method ||
        previous.resolutionScale !== this.props.resolutionScale)
    ) {
      this.ambientOcclusionPass?.destroy();
      this.createPasses();
    }
  }

  preRender(options: PreRenderOptions): void {
    this.camera = null;
    if (options.isPicking || !this.device || !this.capturePass) {
      return;
    }
    const viewport = options.viewports[0];
    const camera = viewport ? getCamera(viewport) : null;
    if (!camera) {
      return;
    }
    const canvasContext = options.canvasContext || this.device.getDefaultCanvasContext();
    const [width, height] = canvasContext.getDrawingBufferSize();
    if (width <= 0 || height <= 0) {
      return;
    }
    addDepthToPostProcessBuffers(this.device, this.deck);
    const targets = this.getTargets(width, height);
    this.capturePass.render({
      ...options,
      pass: `${this.id}-capture`,
      target: targets.framebuffer,
      canvasContext,
      effects: options.effects?.filter(effect => effect !== this),
      views: undefined,
      isPicking: false,
      clearCanvas: true,
      clearColor: [0, 0, 0, 0]
    });
    this.camera = camera;
  }

  cleanup(): void {
    this.ambientOcclusionPass?.destroy();
    this.normalPass?.destroy();
    this.normalUniforms?.destroy();
    this.composite?.destroy();
    this.capturePass?.cleanup();
    this.destroyTargets();
    this.ambientOcclusionPass = null;
    this.normalPass = null;
    this.normalUniforms = null;
    this.composite = null;
    this.capturePass = null;
    this.device = null;
    this.deck = null;
  }

  /** The SSAO radius in pixels: the world radius at the view target, clamped by the screen limit. */
  getSSAORadius(height: number): number {
    const camera = this.camera;
    if (!camera) {
      return 1;
    }
    const focalLength = camera.projectionMatrix[5] * height * 0.5;
    const radius = (this.props.radius * focalLength) / camera.targetDistance;
    return Math.max(1, Math.min(radius, this.props.maxScreenSpaceRadius * height));
  }

  private renderPostProcess(options: PostRenderOptions): Framebuffer | null {
    const output = (options.target !== undefined ? options.target : options.swapBuffer) ?? null;
    const clearCanvas = options.target === undefined || Boolean(options.clearCanvas);
    const {device, targets, camera, normalPass, normalUniforms, ambientOcclusionPass, composite} =
      this;
    if (!device || !composite) {
      return output;
    }
    let colorTexture = options.inputBuffer.colorAttachments[0].texture;
    let visibilityTexture: Texture | null = null;
    if (targets && camera && normalPass && normalUniforms && ambientOcclusionPass) {
      const {width, height} = targets;
      const {near, far, projectionMatrix} = camera;
      const isSSAO = this.props.method === 'ssao';
      const data = new Float32Array(12);
      data.set(getUnprojectParams(projectionMatrix), 0);
      data.set([width, height, (near - far) / (near * far), 1 / near, isSSAO ? -1 : 1], 4);
      normalUniforms.write(data);
      normalPass.setBindings({
        normals: normalUniforms,
        depthTexture: targets.depthTexture.view,
        normalOutput: targets.normalTexture.view
      });
      normalPass.predraw(device.commandEncoder);
      const computePass = device.beginComputePass({id: `${this.id}-normals`});
      normalPass.dispatch(computePass, Math.ceil(width / 8), Math.ceil(height / 8));
      computePass.end();

      visibilityTexture = ambientOcclusionPass.render({
        depthTexture: targets.depthTexture,
        normalTexture: targets.normalTexture,
        projectionMatrix: projectionMatrix as unknown as Parameters<
          AmbientOcclusionPass['render']
        >[0]['projectionMatrix'],
        near,
        far,
        radius: isSSAO ? this.getSSAORadius(height) : this.props.radius,
        ...(this.props.intensity === undefined ? {} : {intensity: this.props.intensity})
      });
      colorTexture = targets.colorTexture;
    }
    composite.shaderInputs.setProps({
      lumaAmbientOcclusionComposite: {
        showOcclusion: this.props.showOcclusion && visibilityTexture ? 1 : 0
      }
    });
    composite.setBindings({
      colorTexture,
      visibilityTexture: visibilityTexture ?? this.getWhiteTexture()
    });
    const renderPass = device.beginRenderPass({
      id: `${this.id}-composite`,
      framebuffer: output,
      parameters: {viewport: [0, 0, colorTexture.width, colorTexture.height]},
      clearColor: clearCanvas ? [0, 0, 0, 0] : false,
      clearDepth: false,
      clearStencil: false
    });
    composite.draw(renderPass);
    renderPass.end();
    return output;
  }

  private whiteTexture: Texture | null = null;
  private getWhiteTexture(): Texture {
    this.whiteTexture ||= this.device!.createTexture({
      width: 1,
      height: 1,
      data: new Uint8Array([255, 255, 255, 255])
    });
    return this.whiteTexture;
  }

  private createPasses(): void {
    this.ambientOcclusionPass = new AmbientOcclusionPass(this.device!, {
      mode: this.props.method,
      resolutionScale: this.props.resolutionScale
    });
  }

  private getTargets(width: number, height: number): Targets {
    if (this.targets && this.targets.width === width && this.targets.height === height) {
      return this.targets;
    }
    this.destroyTargets();
    const device = this.device!;
    const sampler = {minFilter: 'nearest', magFilter: 'nearest'} as const;
    const colorTexture = device.createTexture({
      id: `${this.id}-color`,
      format: device.preferredColorFormat,
      width,
      height,
      usage: Texture.SAMPLE | Texture.RENDER,
      sampler
    });
    const depthTexture = device.createTexture({
      id: `${this.id}-depth`,
      format: device.preferredDepthFormat as TextureFormat,
      width,
      height,
      usage: Texture.SAMPLE | Texture.RENDER,
      sampler
    });
    const normalTexture = device.createTexture({
      id: `${this.id}-normal`,
      format: 'rgba8unorm',
      width,
      height,
      usage: Texture.SAMPLE | Texture.STORAGE,
      sampler: {minFilter: 'linear', magFilter: 'linear'}
    });
    const framebuffer = device.createFramebuffer({
      id: `${this.id}-capture`,
      width,
      height,
      colorAttachments: [colorTexture],
      depthStencilAttachment: depthTexture
    });
    this.targets = {width, height, colorTexture, depthTexture, normalTexture, framebuffer};
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
    targets.normalTexture.destroy();
    this.targets = null;
  }
}

/**
 * Gets the meter-sized camera of a deck.gl perspective viewport. Deck.gl view space uses common
 * units. A uniform scale of view space does not change the screen projection, so only the near
 * and far planes change. The returned projection has WebGPU clip depth (0 to 1), which the luma.gl
 * GTAO pass expects. Deck.gl maps its depth to 0 to 1 on WebGPU in the same way.
 */
function getCamera(viewport: Viewport): Camera | null {
  const {projectionMatrix, viewMatrix} = viewport;
  if (Math.abs(projectionMatrix[11] + 1) > 1e-6 || projectionMatrix[15] !== 0) {
    return null;
  }
  const viewUnitsPerMeter =
    viewport.distanceScales.unitsPerMeter[2] *
    Math.hypot(viewMatrix[8], viewMatrix[9], viewMatrix[10]);
  const depthScale = projectionMatrix[10];
  const depthOffset = projectionMatrix[14];
  const near = depthOffset / (depthScale - 1) / viewUnitsPerMeter;
  const far = depthOffset / (depthScale + 1) / viewUnitsPerMeter;
  const matrix = Array.from(projectionMatrix);
  matrix[10] = far / (near - far);
  matrix[14] = (near * far) / (near - far);
  const {cameraPosition, center} = viewport as Viewport & {center: number[]};
  const targetDistance =
    Math.hypot(
      cameraPosition[0] - center[0],
      cameraPosition[1] - center[1],
      cameraPosition[2] - center[2]
    ) / viewport.distanceScales.unitsPerMeter[2];
  return {projectionMatrix: matrix, near, far, targetDistance};
}

/** The texture coordinate to view direction parameters of a perspective projection. */
function getUnprojectParams(matrix: number[]): number[] {
  const inverseX = 1 / matrix[0];
  const inverseY = 1 / matrix[5];
  return [
    2 * inverseX,
    2 * inverseY,
    -inverseX + matrix[8] / matrix[0],
    -inverseY + matrix[9] / matrix[5]
  ];
}

/** Same workaround as in `CORTAOEffect`: the deck.gl post-process buffers need depth on WebGPU. */
function addDepthToPostProcessBuffers(device: Device, deck: EffectContext['deck'] | null): void {
  const renderer = (deck as unknown as {deckRenderer?: {renderBuffers?: Framebuffer[]}})
    ?.deckRenderer;
  if (!renderer?.renderBuffers || renderer.renderBuffers.length > 0) {
    return;
  }
  for (const index of [0, 1]) {
    renderer.renderBuffers.push(
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
}
