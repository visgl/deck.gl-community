// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Native WebGPU draw path for individual video-pixel Gaussian splats. */
export const VOLUMETRIC_VIDEO_WGSL = /* wgsl */ `
@group(0) @binding(auto) var videoFrames: texture_2d_array<f32>;
@group(0) @binding(auto) var pixelChanges: texture_2d_array<f32>;

struct VolumetricVideoAttributes {
  @builtin(instance_index) instanceIndex: u32,
  @location(0) positions: vec2<f32>,
};

struct VolumetricVideoVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) unitPosition: vec2<f32>,
  @location(1) splatColor: vec4<f32>,
};

@vertex
fn vertexMain(attributes: VolumetricVideoAttributes) -> VolumetricVideoVaryings {
  var output: VolumetricVideoVaryings;
  let gridWidth = max(u32(volumetricVideo.gridSize.x), 1u);
  let pixelCount = max(gridWidth * max(u32(volumetricVideo.gridSize.y), 1u), 1u);
  let plane = attributes.instanceIndex / pixelCount;
  let pixel = attributes.instanceIndex % pixelCount;
  let age = select(
    volumetricVideo.frameCount - 1.0 - f32(plane),
    f32(plane),
    volumetricVideo.reverse > 0.5
  );
  let frame = volumetricVideo.currentFrame - age;
  let cell = vec2<i32>(i32(pixel % gridWidth), i32(pixel / gridWidth));
  let uv = (vec2<f32>(cell) + vec2<f32>(0.5)) / volumetricVideo.gridSize;
  let slot = i32(frame) % i32(volumetricVideo.capacity);
  let color = textureLoad(videoFrames, cell, slot, 0);
  let luminance = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  var alpha = color.a * volumetricVideo.frameOpacity
    * select(pow(1.0 - volumetricVideo.trailFade, age), 1.0, age == 0.0)
    * layer.opacity;
  if (luminance < volumetricVideo.luminanceThreshold) { alpha = 0.0; }
  let change = textureLoad(pixelChanges, cell, slot, 0).r;
  if (age > 0.0 && volumetricVideo.staticPixelRemoval > 0.0
    && change <= 0.5 * volumetricVideo.staticPixelRemoval * volumetricVideo.staticPixelRemoval) {
    alpha = 0.0;
  }
  let center = volumetricVideo.position + vec3<f32>(
    (uv.x - 0.5) * volumetricVideo.planeSize.x,
    (0.5 - uv.y) * volumetricVideo.planeSize.y,
    -age * volumetricVideo.frameSpacing
  );
  geometry.worldPosition = center;
  geometry.position = vec4<f32>(center, 1.0);
  geometry.uv = uv;
  let offset = vec3<f32>(
    attributes.positions * volumetricVideo.planeSize / volumetricVideo.gridSize
      * volumetricVideo.splatSize * 0.5,
    0.0
  );
  output.position = project_position_to_clipspace(center + offset, ZERO_64_LOW, vec3<f32>(0.0));
  if (alpha == 0.0) { output.position = vec4<f32>(2.0, 2.0, 2.0, 1.0); }
  output.unitPosition = attributes.positions;
  output.splatColor = vec4<f32>(color.rgb, alpha);
  return output;
}

@fragment
fn fragmentMain(input: VolumetricVideoVaryings) -> @location(0) vec4<f32> {
  if (input.splatColor.a == 0.0) { discard; }
  let radiusSquared = dot(input.unitPosition, input.unitPosition);
  let dx = dpdx(input.unitPosition);
  let dy = dpdy(input.unitPosition);
  let variance = (dot(dx, dx) + dot(dy, dy)) / 12.0;
  let filterScale = 1.0 + 6.0 * variance;
  let edgeWidth = max(fwidth(radiusSquared), 0.0001);
  let edge = 1.0 - smoothstep(1.0 - edgeWidth, 1.0 + edgeWidth, radiusSquared);
  let gaussian = exp(-3.0 * radiusSquared / filterScale);
  return vec4<f32>(input.splatColor.rgb, input.splatColor.a * gaussian * edge);
}
`;

/** Native WebGPU one-plane-per-frame path that samples the prepared mip pyramid. */
export const VOLUMETRIC_VIDEO_RASTER_WGSL = /* wgsl */ `
@group(0) @binding(auto) var videoFrames: texture_2d_array<f32>;
@group(0) @binding(auto) var pixelChanges: texture_2d_array<f32>;
@group(0) @binding(auto) var filteredFrames: texture_2d_array<f32>;
@group(0) @binding(auto) var filteredFramesSampler: sampler;

struct VolumetricVideoRasterAttributes {
  @builtin(instance_index) instanceIndex: u32,
  @location(0) positions: vec2<f32>,
};

struct VolumetricVideoRasterVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) frameUV: vec2<f32>,
  @location(1) @interpolate(flat) videoFrame: f32,
  @location(2) @interpolate(flat) planeOpacity: f32,
  @location(3) @interpolate(flat) frameAge: f32,
};

@vertex
fn vertexMain(attributes: VolumetricVideoRasterAttributes) -> VolumetricVideoRasterVaryings {
  var output: VolumetricVideoRasterVaryings;
  let age = select(
    volumetricVideo.frameCount - 1.0 - f32(attributes.instanceIndex),
    f32(attributes.instanceIndex),
    volumetricVideo.reverse > 0.5
  );
  let padding = vec2<f32>(max(0.0, volumetricVideo.splatSize - 1.0) * 0.5)
    / volumetricVideo.gridSize;
  let frameUV = mix(
    -padding,
    vec2<f32>(1.0) + padding,
    vec2<f32>(attributes.positions.x, -attributes.positions.y) * 0.5 + vec2<f32>(0.5)
  );
  let position = volumetricVideo.position + vec3<f32>(
    (frameUV.x - 0.5) * volumetricVideo.planeSize.x,
    (0.5 - frameUV.y) * volumetricVideo.planeSize.y,
    -age * volumetricVideo.frameSpacing
  );
  geometry.worldPosition = position;
  geometry.position = vec4<f32>(position, 1.0);
  geometry.uv = frameUV;
  output.position = project_position_to_clipspace(position, ZERO_64_LOW, vec3<f32>(0.0));
  output.frameUV = frameUV;
  output.videoFrame = volumetricVideo.currentFrame - age;
  output.planeOpacity = volumetricVideo.frameOpacity
    * select(pow(1.0 - volumetricVideo.trailFade, age), 1.0, age == 0.0)
    * layer.opacity;
  output.frameAge = age;
  return output;
}

@fragment
fn fragmentMain(input: VolumetricVideoRasterVaryings) -> @location(0) vec4<f32> {
  let q = input.frameUV * volumetricVideo.gridSize;
  let uvx = dpdx(input.frameUV);
  let uvy = dpdy(input.frameUV);
  let footprint = max(length(uvx * volumetricVideo.gridSize), length(uvy * volumetricVideo.gridSize));
  var filteredMix = smoothstep(0.6, 1.5, footprint);
  // Static removal is baked into the mip pyramid. Keep the selected frame on
  // the exact path so unchanged bright pixels remain visible.
  if (input.frameAge == 0.0 && volumetricVideo.staticPixelRemoval > 0.0) {
    filteredMix = 0.0;
  }
  let slot = i32(input.videoFrame) % i32(volumetricVideo.capacity);
  var result = vec4<f32>(0.0);
  if (filteredMix > 0.0) {
    result = textureSampleGrad(
      filteredFrames,
      filteredFramesSampler,
      clamp(input.frameUV, vec2<f32>(0.0), vec2<f32>(1.0)),
      slot,
      uvx,
      uvy
    );
  }
  if (filteredMix < 1.0) {
    let size = volumetricVideo.splatSize;
    let firstCell = vec2<i32>(ceil(q - vec2<f32>(0.5 + size * 0.5)));
    var weighted = vec4<f32>(0.0);
    var totalWeight = 0.0;
    for (var y: i32 = 0; y < 2; y = y + 1) {
      for (var x: i32 = 0; x < 2; x = x + 1) {
        let cell = firstCell + vec2<i32>(x, y);
        let unit = (q - vec2<f32>(cell) - vec2<f32>(0.5)) * (2.0 / size);
        if (any(cell < vec2<i32>(0))
          || any(cell >= vec2<i32>(volumetricVideo.gridSize))
          || any(abs(unit) > vec2<f32>(1.0))) {
          continue;
        }
        let weight = exp(-3.0 * dot(unit, unit));
        totalWeight += weight;
        let change = textureLoad(pixelChanges, cell, slot, 0).r;
        if (input.frameAge > 0.0 && volumetricVideo.staticPixelRemoval > 0.0
          && change <= 0.5 * volumetricVideo.staticPixelRemoval * volumetricVideo.staticPixelRemoval) {
          continue;
        }
        let color = textureLoad(videoFrames, cell, slot, 0);
        if (dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722))
          < volumetricVideo.luminanceThreshold) {
          continue;
        }
        weighted += vec4<f32>(color.rgb * color.a, color.a) * weight;
      }
    }
    let detail = select(vec4<f32>(0.0), weighted / totalWeight, totalWeight > 0.0);
    result = mix(detail, result, filteredMix);
  }
  if (result.a == 0.0 || input.planeOpacity == 0.0) { discard; }
  return vec4<f32>(result.rgb / result.a, result.a * input.planeOpacity);
}
`;
