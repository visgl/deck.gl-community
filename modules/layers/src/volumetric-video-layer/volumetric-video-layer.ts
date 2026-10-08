// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {COORDINATE_SYSTEM, Layer, project32} from '@deck.gl/core';
import type {DefaultProps, LayerProps, UpdateParameters} from '@deck.gl/core';
import {Geometry, Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import {
  getFrameCapacity,
  getFrameHistoryBytes,
  getFrameSize,
  getFrameWindow,
  type FrameWindow
} from './frame-utils';
import {GPUVideoFrames} from './gpu-video-frames';
import {assertGPUVideoResources} from './gpu-video-resources';
import {VideoFrameSource, type VolumetricVideoInfo} from './video-frame-source';

export type {VolumetricVideoInfo} from './video-frame-source';

/** Details of the frame window currently resident on the GPU. */
export type VolumetricVideoFrameInfo = FrameWindow & {
  /** Selected frame's source presentation timestamp, in seconds. */
  timestamp: number;
  /** Number of source pixel splats in this window, before visibility filtering. */
  splatCount: number;
  /** Bytes allocated for raw color, change history, and filtered mip levels (excluding upload/reference textures). */
  textureBytes: number;
};

type VideoProps = {
  /** MP4 or MOV URL, File or Blob. Codec support depends on the browser. */
  video: string | Blob | null;
  /** Zero-based source frame index in presentation order. @default 0 */
  currentFrame?: number;
  /** Number of preceding frames to include, in addition to currentFrame. @default 24 */
  frameTrail?: number;
  /** Optional maximum preceding-frame reservation. Null grows history to frameTrail;
   * explicit values limit the retained trail. Device and memory limits still apply. @default null
   */
  maxFrameTrail?: number | null;
  /** Maximum sampling dimension; 0 retains every source pixel. @default 0 */
  resolution?: number;
  /** Rendering strategy. Auto evaluates Gaussian splats per screen fragment when
   * Cartesian projection and footprint size permit; instanced keeps the per-pixel quad path.
   * @default 'auto'
   */
  renderMode?: 'auto' | 'instanced';
  /** Byte budget for raw color, change history, and filtered mip levels. Exceeding it reports an error and retains
   * the previous cache, rather than silently reducing resolution or the requested trail.
   * @default 536870912
   */
  maxTextureBytes?: number;
  /** Width of the video plane in the layer's coordinate system. @default 2 */
  width?: number;
  /** Distance between consecutive frame planes, along local -Z. @default 0.025 */
  frameSpacing?: number;
  /** Gaussian footprint diameter in grid-cell units. @default 1 */
  splatSize?: number;
  /** Per-frame alpha after normalized auto-mode filtering; 1 preserves source opacity. @default 0.35 */
  frameOpacity?: number;
  /** Fractional opacity decay per preceding frame, from 0 to 1. @default 0.025 */
  trailFade?: number;
  /** Discard texels with luminance below this value, from 0 to 1. @default 0 */
  luminanceThreshold?: number;
  /** Removal strength for pixel splats similar to the same pixel in the preceding frame.
   * 0 shows every pixel; 1 aggressively removes changes of up to 50% in any RGBA channel.
   * The change threshold is 0.5 * strength squared. Frame 0 stays visible.
   * @default 0
   */
  staticPixelRemoval?: number;
  /** Center of the current frame's plane. @default [0, 0, 0] */
  position?: [number, number, number];
  /** Called once metadata and the frame index have loaded. */
  onVideoLoad?: ((info: VolumetricVideoInfo) => void) | null;
  /** Called when the requested frame window has finished uploading. */
  onFrameLoad?: ((info: VolumetricVideoFrameInfo) => void) | null;
};

/** Props for a GPU-rendered image-X/image-Y/time volume. */
export type VolumetricVideoLayerProps = VideoProps & LayerProps;

const defaultProps: DefaultProps<VolumetricVideoLayerProps> = {
  video: {type: 'object', value: null, compare: false},
  parameters: {depthWriteEnabled: false, depthCompare: 'less-equal'},
  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
  currentFrame: {type: 'number', value: 0, min: 0},
  frameTrail: {type: 'number', value: 24, min: 0},
  maxFrameTrail: {
    type: 'number',
    value: null,
    validate: value => value === null || (Number.isFinite(value) && value >= 0)
  },
  resolution: {type: 'number', value: 0, min: 0, max: 16384},
  renderMode: 'auto',
  maxTextureBytes: {type: 'number', value: 512 * 1024 * 1024, min: 1},
  width: {type: 'number', value: 2, min: 0},
  frameSpacing: {type: 'number', value: 0.025, min: 0},
  splatSize: {type: 'number', value: 1, min: 0.01},
  frameOpacity: {type: 'number', value: 0.35, min: 0, max: 1},
  trailFade: {type: 'number', value: 0.025, min: 0, max: 1},
  luminanceThreshold: {type: 'number', value: 0, min: 0, max: 1},
  staticPixelRemoval: {type: 'number', value: 0, min: 0, max: 1},
  position: {type: 'array', value: [0, 0, 0], compare: true},
  onVideoLoad: null,
  onFrameLoad: null
};

type VideoUniforms = {
  gridSize: [number, number];
  planeSize: [number, number];
  position: [number, number, number];
  currentFrame: number;
  frameCount: number;
  capacity: number;
  reverse: number;
  frameSpacing: number;
  splatSize: number;
  frameOpacity: number;
  trailFade: number;
  luminanceThreshold: number;
  staticPixelRemoval: number;
};

const videoUniforms: ShaderModule<VideoUniforms> = {
  name: 'volumetricVideo',
  vs: `uniform volumetricVideoUniforms {
    vec2 gridSize;
    vec2 planeSize;
    vec3 position;
    float currentFrame;
    float frameCount;
    float capacity;
    float reverse;
    float frameSpacing;
    float splatSize;
    float frameOpacity;
    float trailFade;
    float luminanceThreshold;
    float staticPixelRemoval;
  } volumetricVideo;`,
  fs: `uniform volumetricVideoUniforms {
    vec2 gridSize;
    vec2 planeSize;
    vec3 position;
    float currentFrame;
    float frameCount;
    float capacity;
    float reverse;
    float frameSpacing;
    float splatSize;
    float frameOpacity;
    float trailFade;
    float luminanceThreshold;
    float staticPixelRemoval;
  } volumetricVideo;`,
  uniformTypes: {
    gridSize: 'vec2<f32>',
    planeSize: 'vec2<f32>',
    position: 'vec3<f32>',
    currentFrame: 'f32',
    frameCount: 'f32',
    capacity: 'f32',
    reverse: 'f32',
    frameSpacing: 'f32',
    splatSize: 'f32',
    frameOpacity: 'f32',
    trailFade: 'f32',
    luminanceThreshold: 'f32',
    staticPixelRemoval: 'f32'
  }
};

/**
 * Renders video texels as Gaussian splats on successive XY planes. Time is the
 * depth axis, not reconstructed scene geometry. Uses one luma draw with per-frame planes or per-pixel quads
 * and a bounded texture-array ring; requires WebGL2 and a supported video codec.
 */
export class VolumetricVideoLayer<
  ExtraProps extends Record<string, unknown> = Record<string, unknown>
> extends Layer<Required<VideoProps> & ExtraProps> {
  static layerName = 'VolumetricVideoLayer';
  static defaultProps = defaultProps;
  declare state: {
    model: Model;
    rasterModel: Model | null;
    source: VideoFrameSource | null;
    frames: GPUVideoFrames | null;
    pendingFrames: GPUVideoFrames | null;
    cacheError: boolean;
  };

  getShaders() {
    return super.getShaders({vs: VS, fs: FS, modules: [project32, videoUniforms]});
  }

  getModels(): Model[] {
    return this.state.rasterModel ? [this.state.model, this.state.rasterModel] : [this.state.model];
  }

  initializeState(): void {
    if (this.context.device.type !== 'webgl')
      throw new Error('VolumetricVideoLayer requires a WebGL2 device.');
    this.getAttributeManager()?.remove(['instancePickingColors']);
    this.setState({
      model: this.createModel(),
      rasterModel: this.createRasterModel(),
      source: null,
      frames: null,
      pendingFrames: null,
      cacheError: false
    });
  }

  updateState({props, oldProps, changeFlags}: UpdateParameters<this>): void {
    if (changeFlags.extensionsChanged) {
      this.state.model.destroy();
      this.state.rasterModel?.destroy();
      this.setState({model: this.createModel(), rasterModel: this.createRasterModel()});
    }
    if (props.video !== oldProps.video) {
      void this.loadVideo();
    } else if (
      this.state.source?.info &&
      (props.resolution !== oldProps.resolution ||
        props.maxFrameTrail !== oldProps.maxFrameTrail ||
        props.maxTextureBytes !== oldProps.maxTextureBytes ||
        (props.maxFrameTrail === null &&
          props.frameTrail !== oldProps.frameTrail &&
          (this.state.cacheError ||
            getFrameCapacity(props.frameTrail, null, this.state.source.info.frameCount) >
              (this.state.pendingFrames?.capacity ?? this.state.frames?.capacity ?? 0))))
    ) {
      this.createFrameCache();
    }
    if (props.currentFrame !== oldProps.currentFrame || props.frameTrail !== oldProps.frameTrail)
      this.requestFrames();
  }

  finalizeState(): void {
    this.state.source?.destroy();
    this.state.pendingFrames?.destroy();
    this.state.frames?.destroy();
    this.state.model.destroy();
    this.state.rasterModel?.destroy();
  }

  draw(): void {
    const {frames, source} = this.state;
    const raster =
      this.props.renderMode === 'auto' &&
      this.props.coordinateSystem === COORDINATE_SYSTEM.CARTESIAN &&
      this.props.splatSize < 2 &&
      this.state.rasterModel;
    const model = raster || this.state.model;
    const window = frames?.getReadyWindow();
    if (!frames || !source?.info || !window) return;
    const {
      width,
      position,
      frameSpacing,
      splatSize,
      frameOpacity,
      trailFade,
      luminanceThreshold,
      staticPixelRemoval
    } = this.props;
    const height = (width * source.info.height) / source.info.width;
    // Frame planes are parallel. Sort their centers back-to-front for the active
    // viewport. Coplanar texels retain a fixed grid order.
    const near = this.project(position);
    const far = this.project([position[0], position[1], position[2] - frameSpacing]);
    model.shaderInputs.setProps({
      volumetricVideo: {
        gridSize: [frames.width, frames.height],
        planeSize: [width, height],
        position,
        currentFrame: window.currentFrame,
        frameCount: window.frameCount,
        capacity: frames.capacity,
        reverse: Number(far[2] < near[2]),
        frameSpacing,
        splatSize,
        frameOpacity,
        trailFade,
        luminanceThreshold,
        staticPixelRemoval
      }
    });
    if (raster) {
      frames.appearance.update(frames.texture, frames.changes.texture, frames.resident, {
        luminanceThreshold,
        staticPixelRemoval
      });
      model.setBindings({
        videoFrames: frames.texture,
        pixelChanges: frames.changes.texture,
        filteredFrames: frames.appearance.texture
      });
    } else {
      model.setBindings({videoFrames: frames.texture, pixelChanges: frames.changes.texture});
    }
    model.setInstanceCount(
      raster ? window.frameCount : frames.width * frames.height * window.frameCount
    );
    model.draw(this.context.renderPass);
  }

  private createRasterModel(): Model | null {
    if (this.props.extensions.length) return null;
    return this.createModel(true);
  }

  private createModel(raster = false): Model {
    return new Model(this.context.device, {
      ...(raster
        ? super.getShaders({vs: RASTER_VS, fs: RASTER_FS, modules: [project32, videoUniforms]})
        : this.getShaders()),
      id: raster ? `${this.props.id}-raster` : this.props.id,
      isInstanced: true,
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: {size: 2, value: new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])}
        }
      }),
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        cullMode: 'none',
        blend: true,
        blendColorOperation: 'add',
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaOperation: 'add',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha'
      }
    });
  }

  private async loadVideo(): Promise<void> {
    this.state.source?.destroy();
    this.state.pendingFrames?.destroy();
    this.state.frames?.destroy();
    this.setState({source: null, frames: null, pendingFrames: null, cacheError: false});
    if (!this.props.video) return;
    const source = new VideoFrameSource(this.props.video);
    this.setState({source});
    try {
      const info = await source.initialize();
      const layer = this.getCurrentLayer() as this | null;
      if (!layer || layer.state.source !== source || source.destroyed) return;
      layer.props.onVideoLoad?.(info);
      layer.createFrameCache();
    } catch (error) {
      const layer = this.getCurrentLayer();
      if (layer && !source.destroyed) {
        source.destroy();
        layer.raiseError(
          error instanceof Error ? error : new Error(String(error)),
          'loading video'
        );
      }
    }
  }

  private createFrameCache(): void {
    const source = this.state.source!;
    this.state.pendingFrames?.destroy();
    this.setState({pendingFrames: null});
    const capacity = getFrameCapacity(
      this.props.frameTrail,
      this.props.maxFrameTrail,
      source.info!.frameCount
    );
    if (capacity > this.context.device.limits.maxTextureArrayLayers) {
      this.setState({cacheError: true});
      this.raiseError(
        new Error(
          `This trail requires ${capacity} frames; this GPU supports ${this.context.device.limits.maxTextureArrayLayers} texture-array layers. Shorten the trail.`
        ),
        'allocating video history'
      );
      return;
    }
    const size = getFrameSize(source.info!.width, source.info!.height, this.props.resolution);
    const textureBytes = getFrameHistoryBytes(size.width, size.height, capacity);
    if (
      textureBytes > this.props.maxTextureBytes ||
      Math.max(size.width, size.height) > this.context.device.limits.maxTextureDimension2D
    ) {
      this.setState({cacheError: true});
      this.raiseError(
        new Error(
          `This sampling grid and trail require ${(textureBytes / 1048576).toFixed(0)} MiB of history. Shorten frameTrail, choose a smaller grid or lower maxFrameTrail, or increase maxTextureBytes within your GPU's budget.`
        ),
        'allocating video history'
      );
      return;
    }
    const previous = this.state.frames;
    if (
      previous &&
      previous.capacity === capacity &&
      previous.width === size.width &&
      previous.height === size.height
    ) {
      this.setState({cacheError: false});
      this.requestFrames();
      return;
    }
    // Keep drawing the completed cache while its replacement allocates and decodes.
    // A failed constructor must never delete the last working volume.
    let frames: GPUVideoFrames;
    try {
      frames = new GPUVideoFrames(
        this.context.device,
        source,
        this.props.resolution,
        capacity,
        window => {
          const layer = this.getCurrentLayer() as this | null;
          if (!layer || layer.state.cacheError) return;
          if (layer.state.pendingFrames === frames) {
            try {
              assertGPUVideoResources(layer.context.device);
              if (
                layer.props.renderMode === 'auto' &&
                !layer.props.extensions.length &&
                layer.props.coordinateSystem === COORDINATE_SYSTEM.CARTESIAN &&
                layer.props.splatSize < 2
              ) {
                frames.appearance.update(frames.texture, frames.changes.texture, frames.resident, {
                  luminanceThreshold: layer.props.luminanceThreshold,
                  staticPixelRemoval: layer.props.staticPixelRemoval
                });
              }
            } catch (error) {
              layer.failFrameCache(
                frames,
                error instanceof Error ? error : new Error(String(error))
              );
              return;
            }
            const oldFrames = layer.state.frames;
            layer.setState({frames, pendingFrames: null});
            oldFrames?.destroy();
          } else if (layer.state.frames !== frames || layer.state.pendingFrames) return;
          layer.setNeedsRedraw();
          layer.props.onFrameLoad?.({
            ...window,
            timestamp: source.info!.frameTimestamps[window.currentFrame],
            splatCount: frames.width * frames.height * window.frameCount,
            textureBytes: getFrameHistoryBytes(frames.width, frames.height, frames.capacity)
          });
        },
        error => {
          const layer = this.getCurrentLayer() as this | null;
          if (layer && (layer.state.pendingFrames === frames || layer.state.frames === frames))
            layer.failFrameCache(frames, error);
        }
      );
    } catch (error) {
      this.setState({cacheError: true});
      this.raiseError(
        error instanceof Error ? error : new Error(String(error)),
        'allocating video history'
      );
      return;
    }
    this.setState({pendingFrames: frames, cacheError: false});
    this.requestFrames();
  }

  private failFrameCache(frames: GPUVideoFrames, error: Error): void {
    if (this.state.pendingFrames === frames) {
      this.setState({pendingFrames: null});
      frames.destroy();
    }
    this.setState({cacheError: true});
    this.raiseError(error, 'preparing video history');
  }

  private requestFrames(): void {
    const {source} = this.state;
    const frames = this.state.pendingFrames ?? this.state.frames;
    if (frames && source?.info && !this.state.cacheError)
      frames.request(
        getFrameWindow(
          this.props.currentFrame,
          this.props.frameTrail,
          source.info.frameCount,
          frames.capacity
        )
      );
  }
}

const VS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 positions;
uniform sampler2DArray videoFrames;
uniform sampler2DArray pixelChanges;
out vec2 unitPosition;
out vec4 splatColor;
void main() {
  int pixels = int(volumetricVideo.gridSize.x * volumetricVideo.gridSize.y);
  int plane = gl_InstanceID / pixels;
  int pixel = gl_InstanceID % pixels;
  float age = volumetricVideo.reverse > 0.5 ? float(plane) : volumetricVideo.frameCount - 1.0 - float(plane);
  float frame = volumetricVideo.currentFrame - age;
  vec2 cell = vec2(float(pixel % int(volumetricVideo.gridSize.x)), float(pixel / int(volumetricVideo.gridSize.x)));
  vec2 uv = (cell + 0.5) / volumetricVideo.gridSize;
  vec4 color = texture(videoFrames, vec3(uv, mod(frame, volumetricVideo.capacity)));
  float luminance = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
  float alpha = color.a * volumetricVideo.frameOpacity * (age == 0.0 ? 1.0 : pow(1.0 - volumetricVideo.trailFade, age)) * layer.opacity;
  if (luminance < volumetricVideo.luminanceThreshold) alpha = 0.0;
  if (volumetricVideo.staticPixelRemoval > 0.0 &&
      texture(pixelChanges, vec3(uv, mod(frame, volumetricVideo.capacity))).r <= 0.5 * volumetricVideo.staticPixelRemoval * volumetricVideo.staticPixelRemoval) alpha = 0.0;
  vec3 center = volumetricVideo.position + vec3((uv.x - 0.5) * volumetricVideo.planeSize.x,
    (0.5 - uv.y) * volumetricVideo.planeSize.y, -age * volumetricVideo.frameSpacing);
  geometry.worldPosition = center;
  geometry.uv = uv;
  unitPosition = positions;
  vec3 offset = vec3(positions * volumetricVideo.planeSize / volumetricVideo.gridSize * volumetricVideo.splatSize * 0.5, 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  gl_Position = project_position_to_clipspace(center + offset, vec3(0.0), vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  if (alpha == 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  splatColor = vec4(color.rgb, alpha);
  DECKGL_FILTER_COLOR(splatColor, geometry);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 unitPosition;
in vec4 splatColor;
out vec4 fragColor;
void main() {
  float radiusSquared = dot(unitPosition, unitPosition);
  if (splatColor.a == 0.0) discard;
  // Integrate the Gaussian over the pixel footprint. This suppresses shimmer
  // when the frame grid is minified or viewed at an oblique angle.
  vec2 dx = dFdx(unitPosition);
  vec2 dy = dFdy(unitPosition);
  float variance = (dot(dx, dx) + dot(dy, dy)) / 12.0;
  float filterScale = 1.0 + 6.0 * variance;
  float edgeWidth = max(fwidth(radiusSquared), 0.0001);
  float edge = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, radiusSquared);
  float gaussian = exp(-3.0 * radiusSquared / filterScale);
  fragColor = vec4(splatColor.rgb, splatColor.a * gaussian * edge);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}`;

// Rasterize one plane per frame. The fragment shader evaluates the exact neighboring
// Gaussian footprints, preserving the input grid without submitting per-pixel geometry.
const RASTER_VS = `#version 300 es
precision highp float;
in vec2 positions;
out vec2 frameUV;
flat out float videoFrame;
flat out float planeOpacity;
void main() {
  float age = volumetricVideo.reverse > 0.5 ? float(gl_InstanceID) : volumetricVideo.frameCount - 1.0 - float(gl_InstanceID);
  videoFrame = volumetricVideo.currentFrame - age;
  planeOpacity = volumetricVideo.frameOpacity * (age == 0.0 ? 1.0 : pow(1.0 - volumetricVideo.trailFade, age)) * layer.opacity;
  vec2 padding = vec2(max(0.0, volumetricVideo.splatSize - 1.0) * 0.5) / volumetricVideo.gridSize;
  frameUV = mix(-padding, 1.0 + padding, vec2(positions.x, -positions.y) * 0.5 + 0.5);
  vec3 p = volumetricVideo.position + vec3((frameUV.x - 0.5) * volumetricVideo.planeSize.x,
    (0.5 - frameUV.y) * volumetricVideo.planeSize.y, -age * volumetricVideo.frameSpacing);
  geometry.worldPosition = p;
  geometry.uv = frameUV;
  gl_Position = project_position_to_clipspace(p, vec3(0.0), vec3(0.0), geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
}`;

const RASTER_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray videoFrames;
uniform sampler2DArray pixelChanges;
uniform sampler2DArray filteredFrames;
in vec2 frameUV;
flat in float videoFrame;
flat in float planeOpacity;
out vec4 fragColor;
void main() {
  vec2 q = frameUV * volumetricVideo.gridSize;
  vec2 uvx = dFdx(frameUV);
  vec2 uvy = dFdy(frameUV);
  vec2 qx = uvx * volumetricVideo.gridSize;
  vec2 qy = uvy * volumetricVideo.gridSize;
  float footprint = max(length(qx), length(qy));
  float filteredMix = smoothstep(0.6, 1.5, footprint);
  int slot = int(mod(videoFrame, volumetricVideo.capacity));
  vec4 result = vec4(0.0);
  // The pyramid averages premultiplied, visibility-masked pixels, preserving
  // brightness and avoiding nearest-cell shimmer when several texels fit a fragment.
  if (filteredMix > 0.0) {
    result = textureGrad(filteredFrames, vec3(clamp(frameUV, vec2(0.0), vec2(1.0)), float(slot)),
      uvx, uvy);
  }
  if (filteredMix < 1.0) {
    float size = volumetricVideo.splatSize;
    ivec2 firstCell = ivec2(ceil(q - vec2(0.5 + size * 0.5)));
    vec4 weighted = vec4(0.0);
    float totalWeight = 0.0;
    for (int y = 0; y < 2; y++) {
      for (int x = 0; x < 2; x++) {
        ivec2 cell = firstCell + ivec2(x, y);
        vec2 unit = (q - vec2(cell) - 0.5) * (2.0 / size);
        if (any(lessThan(cell, ivec2(0))) || any(greaterThanEqual(cell, ivec2(volumetricVideo.gridSize))) || any(greaterThan(abs(unit), vec2(1.0)))) continue;
        // Normalize geometric weights before applying visibility, so removing
        // one pixel does not brighten or restore its unchanged neighbors.
        float weight = exp(-3.0 * dot(unit, unit));
        totalWeight += weight;
        if (volumetricVideo.staticPixelRemoval > 0.0 &&
            texelFetch(pixelChanges, ivec3(cell, slot), 0).r <= 0.5 * volumetricVideo.staticPixelRemoval * volumetricVideo.staticPixelRemoval) continue;
        vec4 color = texelFetch(videoFrames, ivec3(cell, slot), 0);
        if (dot(color.rgb, vec3(0.2126, 0.7152, 0.0722)) < volumetricVideo.luminanceThreshold) continue;
        weighted += vec4(color.rgb * color.a, color.a) * weight;
      }
    }
    vec4 detail = totalWeight > 0.0 ? weighted / totalWeight : vec4(0.0);
    result = mix(detail, result, filteredMix);
  }
  if (result.a == 0.0 || planeOpacity == 0.0) discard;
  fragColor = vec4(result.rgb / result.a, result.a * planeOpacity);
  DECKGL_FILTER_COLOR(fragColor, geometry);
}`;
