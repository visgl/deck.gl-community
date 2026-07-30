// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {Buffer, type Device, type Texture} from '@luma.gl/core';
import {BufferTransform, Computation} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';

import {sampleWindField, type WindField} from './wind-data';

const WIND_TEXTURE_WIDTH = 128;
const WIND_TEXTURE_HEIGHT = 64;
const PARTICLE_WORKGROUP_SIZE = 256;
const WIND_RASTER_CACHE = new WeakMap<WindField, Map<number, Float32Array>>();

type ParticleUniforms = {
  bounds: [number, number, number, number];
  speedScale: number;
  elevationScale: number;
  surfaceOffset: number;
  frameMix: number;
  elapsedFrames: number;
  particleCount: number;
};

const particleUniforms = {
  name: 'windParticle',
  vs: `layout(std140) uniform windParticleUniforms {
  vec4 bounds;
  float speedScale;
  float elevationScale;
  float surfaceOffset;
  float frameMix;
  float elapsedFrames;
  float particleCount;
} windParticle;`,
  uniformTypes: {
    bounds: 'vec4<f32>',
    speedScale: 'f32',
    elevationScale: 'f32',
    surfaceOffset: 'f32',
    frameMix: 'f32',
    elapsedFrames: 'f32',
    particleCount: 'f32'
  }
} as const satisfies ShaderModule<ParticleUniforms>;

const PARTICLE_TRANSFORM_VERTEX = `#version 300 es
#define SHADER_NAME wind-particle-gpu-transform
precision highp float;

in vec4 particlePosition;
uniform sampler2D windFrom;
uniform sampler2D windTo;
out vec4 nextParticlePosition;
out vec4 previousParticlePosition;

float randomValue(vec2 value) {
  return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 span = windParticle.bounds.zw - windParticle.bounds.xy;
  vec2 uv = (particlePosition.xy - windParticle.bounds.xy) / span;
  vec4 wind = mix(texture(windFrom, uv), texture(windTo, uv), windParticle.frameMix);
  vec2 nextPosition = particlePosition.xy +
    wind.xy * windParticle.speedScale * windParticle.elapsedFrames;
  float age = particlePosition.w + windParticle.elapsedFrames;

  bool respawn = wind.w < 0.5 || any(lessThan(nextPosition, windParticle.bounds.xy)) ||
    any(greaterThan(nextPosition, windParticle.bounds.zw)) || age > 180.0;
  if (respawn) {
    vec2 seed = particlePosition.xy + vec2(age, float(gl_VertexID));
    nextPosition = windParticle.bounds.xy + span * vec2(
      randomValue(seed), randomValue(seed.yx + 7.13)
    );
    vec2 candidateUV = (nextPosition - windParticle.bounds.xy) / span;
    if (texture(windFrom, candidateUV).w < 0.5) {
      nextPosition = windParticle.bounds.xy + span * 0.5;
    }
    age = 0.0;
  }

  nextParticlePosition = vec4(
    nextPosition,
    wind.z * windParticle.elevationScale + windParticle.surfaceOffset,
    age
  );
  previousParticlePosition = respawn ? nextParticlePosition : particlePosition;
  gl_Position = vec4(0.0);
}`;

const PARTICLE_COMPUTE_SHADER = `
struct WindParticleUniforms {
  bounds: vec4<f32>,
  speedScale: f32,
  elevationScale: f32,
  surfaceOffset: f32,
  frameMix: f32,
  elapsedFrames: f32,
  particleCount: f32,
};

@group(0) @binding(0) var windFrom: texture_2d<u32>;
@group(0) @binding(1) var windTo: texture_2d<u32>;
@group(0) @binding(2) var<storage, read> particlePositions: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> previousParticlePositions: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> nextParticlePositions: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> windParticle: WindParticleUniforms;

fn randomValue(value: vec2<f32>) -> f32 {
  return fract(sin(dot(value, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn sampleWind(texture: texture_2d<u32>, uv: vec2<f32>) -> vec4<f32> {
  let dimensions = textureDimensions(texture);
  let texel = clamp(
    vec2<i32>(uv * vec2<f32>(dimensions)),
    vec2<i32>(0),
    vec2<i32>(dimensions) - vec2<i32>(1)
  );
  return bitcast<vec4<f32>>(textureLoad(texture, texel, 0));
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) invocation: vec3<u32>) {
  let index = invocation.x;
  if (index >= u32(windParticle.particleCount)) {
    return;
  }

  let particlePosition = particlePositions[index];
  let span = windParticle.bounds.zw - windParticle.bounds.xy;
  let uv = (particlePosition.xy - windParticle.bounds.xy) / span;
  let wind = mix(sampleWind(windFrom, uv), sampleWind(windTo, uv), windParticle.frameMix);
  var nextPosition = particlePosition.xy +
    wind.xy * windParticle.speedScale * windParticle.elapsedFrames;
  var age = particlePosition.w + windParticle.elapsedFrames;

  let respawn = wind.w < 0.5 || any(nextPosition < windParticle.bounds.xy) ||
    any(nextPosition > windParticle.bounds.zw) || age > 180.0;
  if (respawn) {
    let seed = particlePosition.xy + vec2<f32>(age, f32(index));
    nextPosition = windParticle.bounds.xy + span * vec2<f32>(
      randomValue(seed), randomValue(seed.yx + 7.13)
    );
    let candidateUV = (nextPosition - windParticle.bounds.xy) / span;
    if (sampleWind(windFrom, candidateUV).w < 0.5) {
      nextPosition = windParticle.bounds.xy + span * 0.5;
    }
    age = 0.0;
  }

  nextParticlePositions[index] = vec4<f32>(
    nextPosition,
    wind.z * windParticle.elevationScale + windParticle.surfaceOffset,
    age
  );
  previousParticlePositions[index] = select(
    particlePosition,
    nextParticlePositions[index],
    respawn
  );
}`;

/**
 * Rasterizes one station-interpolated frame for GPU weather-texture sampling.
 *
 * @param field - Indexed wind field shared by the particle simulation.
 * @param frame - Integer forecast-frame index.
 * @param width - Weather-texture width; defaults to `128`.
 * @param height - Weather-texture height; defaults to `64`.
 * @returns RGBA float texels containing east, north, elevation, and coverage.
 * @throws RangeError if either raster dimension is not a positive integer.
 * @internal
 */
export function rasterizeParticleWindField(
  field: WindField,
  frame: number,
  width = WIND_TEXTURE_WIDTH,
  height = WIND_TEXTURE_HEIGHT
): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError('A GPU wind texture requires positive integer dimensions.');
  }

  const raster = new Float32Array(width * height * 4);
  const {bounds, speedRange} = field;
  const speedSpan = Math.max(speedRange[1] - speedRange[0], 1);

  for (let row = 0; row < height; row++) {
    const latitude = bounds.minLat + ((row + 0.5) / height) * (bounds.maxLat - bounds.minLat);
    for (let column = 0; column < width; column++) {
      const longitude = bounds.minLng + ((column + 0.5) / width) * (bounds.maxLng - bounds.minLng);
      const sample = sampleWindField(field, [longitude, latitude], frame);
      if (!sample) {
        continue;
      }

      const offset = (row * width + column) * 4;
      const normalizedSpeed =
        0.18 + Math.sqrt(Math.max(0, (sample.speed - speedRange[0]) / speedSpan)) * 0.82;
      const directionLength = Math.max(Math.hypot(...sample.velocity), 1e-10);
      raster[offset] = (sample.velocity[0] / directionLength) * normalizedSpeed;
      raster[offset + 1] = (sample.velocity[1] / directionLength) * normalizedSpeed;
      raster[offset + 2] = sample.elevation;
      raster[offset + 3] = 1;
    }
  }

  return raster;
}

function getCachedParticleWindRaster(field: WindField, frame: number): Float32Array {
  let rasters = WIND_RASTER_CACHE.get(field);
  if (!rasters) {
    rasters = new Map();
    WIND_RASTER_CACHE.set(field, rasters);
  }

  let raster = rasters.get(frame);
  if (!raster) {
    raster = rasterizeParticleWindField(field, frame);
    rasters.set(frame, raster);
  }
  return raster;
}

function createSeedPositions(field: WindField, count: number, surfaceOffset: number): Float32Array {
  const positions = new Float32Array(count * 4);
  const {bounds} = field;
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * 2)));
  const rows = Math.max(1, Math.ceil(count / columns));

  for (let index = 0; index < count; index++) {
    const offset = index * 4;
    positions[offset] =
      bounds.minLng + (((index % columns) + 0.5) / columns) * (bounds.maxLng - bounds.minLng);
    positions[offset + 1] =
      bounds.minLat +
      ((Math.floor(index / columns) + 0.5) / rows) * (bounds.maxLat - bounds.minLat);
    positions[offset + 2] = surfaceOffset;
    positions[offset + 3] = (index * 0.61803398875) % 180;
  }

  return positions;
}

/**
 * GPU-resident wind simulation for WebGL transform feedback and WebGPU compute.
 *
 * @remarks
 * This implementation detail is not exported from the package entry point. Use
 * {@link ParticleLayer} as the public, backend-selecting layer API.
 *
 * @internal
 */
export class GpuParticleSimulation {
  /** Active luma.gl rendering device. */
  readonly device: Device;
  /** Number of simulated GPU-resident particles. */
  readonly particleCount: number;
  /** Current and next station-interpolated weather textures. */
  readonly textures: [Texture, Texture];
  /** Ping-pong particle-position storage and vertex buffers. */
  readonly buffers: [Buffer, Buffer];
  /** Previous valid position used to avoid cross-map respawn trails. */
  readonly trailBuffer: Buffer;

  private readonly field: WindField;
  private readonly transform: BufferTransform | null;
  private readonly computation: Computation | null;
  private readonly computeUniforms: Buffer | null;
  private readonly uniformValues = new Float32Array(12);
  private currentBufferIndex = 0;
  private currentWeatherFrame = -1;
  private destroyed = false;

  /**
   * Allocates GPU particle buffers, cached weather textures, and the backend pipeline.
   *
   * @param device - Active WebGL2 or WebGPU rendering device.
   * @param field - Indexed station forecast.
   * @param count - Number of GPU particles to allocate.
   * @param surfaceOffset - Initial particle elevation in meters.
   */
  constructor(device: Device, field: WindField, count: number, surfaceOffset: number) {
    this.device = device;
    this.field = field;
    this.particleCount = Math.max(0, Math.floor(count));

    const usage = Buffer.VERTEX | Buffer.STORAGE | Buffer.COPY_DST;
    const initialPositions = createSeedPositions(field, this.particleCount, surfaceOffset);
    this.buffers = [
      device.createBuffer({id: 'wind-particle-positions-a', data: initialPositions, usage}),
      device.createBuffer({
        id: 'wind-particle-positions-b',
        byteLength: initialPositions.byteLength,
        usage
      })
    ];
    this.trailBuffer = device.createBuffer({
      id: 'wind-particle-trail-positions',
      byteLength: initialPositions.byteLength,
      usage
    });
    const textureProps = {
      width: WIND_TEXTURE_WIDTH,
      height: WIND_TEXTURE_HEIGHT,
      // Baseline WebGPU cannot bind rgba32float as a filterable texture. Store the identical
      // float bits in an integer texture and recover them with bitcast in the compute shader.
      format: device.type === 'webgpu' ? ('rgba32uint' as const) : ('rgba32float' as const),
      sampler: {
        minFilter: 'nearest' as const,
        magFilter: 'nearest' as const,
        addressModeU: 'clamp-to-edge' as const,
        addressModeV: 'clamp-to-edge' as const
      }
    };
    this.textures = [
      device.createTexture({...textureProps, id: 'wind-particle-weather-from'}),
      device.createTexture({...textureProps, id: 'wind-particle-weather-to'})
    ];

    if (device.type === 'webgl') {
      this.computeUniforms = null;
      this.computation = null;
      this.transform = new BufferTransform(device, {
        id: 'wind-particle-transform-feedback',
        vs: PARTICLE_TRANSFORM_VERTEX,
        modules: [particleUniforms],
        bufferLayout: [{name: 'particlePosition', format: 'float32x4'}],
        outputs: ['nextParticlePosition', 'previousParticlePosition'],
        vertexCount: this.particleCount,
        disableWarnings: true
      });
      this.transform.model.setBindings({windFrom: this.textures[0], windTo: this.textures[1]});
    } else {
      this.transform = null;
      this.computeUniforms = device.createBuffer({
        id: 'wind-particle-compute-uniforms',
        byteLength: 48,
        usage: Buffer.UNIFORM | Buffer.COPY_DST
      });
      this.computation = new Computation(device, {
        id: 'wind-particle-compute',
        source: PARTICLE_COMPUTE_SHADER,
        shaderLayout: {
          bindings: [
            {
              name: 'windFrom',
              type: 'texture',
              group: 0,
              location: 0,
              sampleType: 'uint'
            },
            {
              name: 'windTo',
              type: 'texture',
              group: 0,
              location: 1,
              sampleType: 'uint'
            },
            {name: 'particlePositions', type: 'read-only-storage', group: 0, location: 2},
            {name: 'previousParticlePositions', type: 'storage', group: 0, location: 3},
            {name: 'nextParticlePositions', type: 'storage', group: 0, location: 4},
            {name: 'windParticle', type: 'uniform', group: 0, location: 5}
          ]
        }
      });
    }
  }

  /** GPU trail-source positions without synchronous or asynchronous readback. */
  get sourceBuffer(): Buffer {
    return this.trailBuffer;
  }

  /** Current GPU-computed particle positions. */
  get targetBuffer(): Buffer {
    return this.buffers[this.currentBufferIndex];
  }

  /**
   * Advances GPU-resident particles and uploads a weather texture only when its frame changes.
   *
   * @param time - Fractional, cyclic weather-frame index.
   * @param speedScale - Geographic distance per normalized simulation frame.
   * @param elevationScale - Multiplier for interpolated station elevation.
   * @param surfaceOffset - Separation above the station-interpolated surface.
   * @param elapsedFrames - Elapsed, frame-rate-independent simulation steps.
   */
  advance(
    time: number,
    speedScale: number,
    elevationScale: number,
    surfaceOffset: number,
    elapsedFrames: number
  ): void {
    if (this.particleCount === 0) {
      return;
    }

    const frame =
      ((Math.floor(time) % this.field.frames.length) + this.field.frames.length) %
      this.field.frames.length;
    if (frame !== this.currentWeatherFrame) {
      const fromRaster = getCachedParticleWindRaster(this.field, frame);
      const toRaster = getCachedParticleWindRaster(
        this.field,
        (frame + 1) % this.field.frames.length
      );
      this.textures[0].writeData(
        this.device.type === 'webgpu' ? new Uint32Array(fromRaster.buffer) : fromRaster
      );
      this.textures[1].writeData(
        this.device.type === 'webgpu' ? new Uint32Array(toRaster.buffer) : toRaster
      );
      this.currentWeatherFrame = frame;
    }

    const {bounds} = this.field;
    const uniforms: ParticleUniforms = {
      bounds: [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
      speedScale,
      elevationScale,
      surfaceOffset,
      frameMix: ((time % 1) + 1) % 1,
      elapsedFrames,
      particleCount: this.particleCount
    };
    const input = this.buffers[this.currentBufferIndex];
    const output = this.buffers[1 - this.currentBufferIndex];

    if (this.transform) {
      this.transform.model.shaderInputs.setProps({windParticle: uniforms});
      this.transform.run({
        discard: true,
        inputBuffers: {particlePosition: input},
        outputBuffers: {
          nextParticlePosition: output,
          previousParticlePosition: this.trailBuffer
        }
      });
    } else if (this.computation && this.computeUniforms) {
      this.uniformValues.set(uniforms.bounds);
      this.uniformValues.set(
        [
          speedScale,
          elevationScale,
          surfaceOffset,
          uniforms.frameMix,
          elapsedFrames,
          this.particleCount
        ],
        4
      );
      this.computeUniforms.write(this.uniformValues);
      this.computation.setBindings({
        windFrom: this.textures[0],
        windTo: this.textures[1],
        particlePositions: input,
        previousParticlePositions: this.trailBuffer,
        nextParticlePositions: output,
        windParticle: this.computeUniforms
      });
      const pass = this.device.beginComputePass({id: 'wind-particle-compute-pass'});
      this.computation.dispatch(pass, Math.ceil(this.particleCount / PARTICLE_WORKGROUP_SIZE));
      pass.end();
    }

    this.currentBufferIndex = 1 - this.currentBufferIndex;
  }

  /** Destroys owned particle buffers, weather textures, and the active GPU pipeline. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;

    const destroyResources = (): void => {
      this.transform?.destroy();
      this.computation?.destroy();
      this.computeUniforms?.destroy();
      for (const buffer of this.buffers) {
        buffer.destroy();
      }
      this.trailBuffer.destroy();
      for (const texture of this.textures) {
        texture.destroy();
      }
    };

    if (this.device.type === 'webgpu') {
      const nativeDevice = (
        this.device as Device & {
          handle?: {queue: {onSubmittedWorkDone: () => Promise<void>}};
        }
      ).handle;
      if (nativeDevice) {
        // Layer replacement can happen inside the active render pass. Wait until that
        // pass is submitted and complete before releasing its compute/vertex resources.
        setTimeout(() => {
          void nativeDevice.queue.onSubmittedWorkDone().then(destroyResources, destroyResources);
        }, 0);
        return;
      }
    }

    destroyResources();
  }
}
