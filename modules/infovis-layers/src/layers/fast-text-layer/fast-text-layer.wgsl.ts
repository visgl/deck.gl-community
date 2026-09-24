// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** WebGPU shaders for packed glyphs, following luma.gl's text-rendering conventions. */
export default /* wgsl */ `
struct FastTextUniforms {
  fontAtlasSize: vec2<f32>,
  fontSize: f32,
  size: f32,
  sizeScale: f32,
  sizeMinPixels: f32,
  sizeMaxPixels: f32,
  pixelOffset: vec2<f32>,
  billboard: f32,
  sizeUnits: i32,
  alphaCutoff: f32,
  sdfEnabled: f32,
  sdfBuffer: f32,
  sdfGamma: f32,
  contentCutoffPixels: vec2<f32>,
  contentAlign: vec2<i32>,
  flipY: f32,
};

@group(0) @binding(auto) var<uniform> fastText: FastTextUniforms;
@group(0) @binding(auto) var fontAtlasTexture: texture_2d<f32>;
@group(0) @binding(auto) var fontAtlasTextureSampler: sampler;

struct FastTextAttributes {
  @location(0) positions: vec2<f32>,
  @location(1) instancePositions: vec2<f32>,
  @location(2) instanceGlyphOffsets: vec2<i32>,
  @location(3) instanceGlyphFrames: vec4<u32>,
  @location(4) instanceClipRects: vec4<i32>,
  @location(5) instanceColors: vec4<f32>,
};

struct FastTextVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) textureCoords: vec2<f32>,
  @location(2) uv: vec2<f32>,
};

struct FastTextClipResult {
  position: vec4<f32>,
  pixelOffset: vec2<f32>,
};

fn fast_text_alignment_pixel_offset(
  anchor: f32,
  extent: f32,
  clipStart: f32,
  clipEnd: f32,
  mode: i32
) -> f32 {
  if (clipEnd < clipStart) {
    return 0.0;
  }
  if (mode == 1) {
    return max(-(anchor + clipStart), 0.0);
  }
  if (mode == 2) {
    let visibleMin = max(0.0, anchor + clipStart);
    let visibleMax = min(extent, anchor + clipEnd);
    return select(0.0, (visibleMin + visibleMax) * 0.5 - anchor, visibleMin < visibleMax);
  }
  if (mode == 3) {
    return min(extent - (anchor + clipEnd), 0.0);
  }
  return 0.0;
}

fn fast_text_clip_glyph_vertex(
  initialPixelOffset: vec2<f32>,
  anchorPositionScreen: vec2<f32>,
  clipRect: vec4<i32>,
  initialPosition: vec4<f32>
) -> FastTextClipResult {
  var result: FastTextClipResult;
  result.position = initialPosition;
  result.pixelOffset = initialPixelOffset;

  let clipRectFloat = vec4<f32>(clipRect);
  var clipXY = project_size_vec2(clipRectFloat.xy) * project.scale;
  let clipWH = project_size_vec2(clipRectFloat.zw) * project.scale;

  if (fastText.flipY > 0.5) {
    clipXY.y = -clipXY.y - clipWH.y;
  }

  if (fastText.contentAlign.x > 0 || fastText.contentAlign.y > 0) {
    let viewportPixels = project.viewportSize / project.devicePixelRatio;
    let scrollPixels = vec2<f32>(
      fast_text_alignment_pixel_offset(
        anchorPositionScreen.x,
        viewportPixels.x,
        clipXY.x,
        clipXY.x + clipWH.x,
        fastText.contentAlign.x
      ),
      -fast_text_alignment_pixel_offset(
        anchorPositionScreen.y,
        viewportPixels.y,
        -clipXY.y - clipWH.y,
        -clipXY.y,
        fastText.contentAlign.y
      )
    );
    result.pixelOffset += scrollPixels;
    result.position = vec4<f32>(
      result.position.xy + project_pixel_size_to_clipspace(scrollPixels),
      result.position.zw
    );
  }

  if (clipRectFloat.z >= 0.0) {
    if (result.pixelOffset.x < clipXY.x || result.pixelOffset.x > clipXY.x + clipWH.x) {
      result.position = vec4<f32>(0.0);
    } else if (fastText.contentCutoffPixels.x > 0.0) {
      let viewportWidth = project.viewportSize.x / project.devicePixelRatio;
      let left = max(anchorPositionScreen.x + clipXY.x, 0.0);
      let right = min(anchorPositionScreen.x + clipXY.x + clipWH.x, viewportWidth);
      if (right - left < fastText.contentCutoffPixels.x) {
        result.position = vec4<f32>(0.0);
      }
    }
  }

  if (clipRectFloat.w >= 0.0) {
    if (result.pixelOffset.y < clipXY.y || result.pixelOffset.y > clipXY.y + clipWH.y) {
      result.position = vec4<f32>(0.0);
    } else if (fastText.contentCutoffPixels.y > 0.0) {
      let viewportHeight = project.viewportSize.y / project.devicePixelRatio;
      let top = max(anchorPositionScreen.y - clipXY.y - clipWH.y, 0.0);
      let bottom = min(anchorPositionScreen.y - clipXY.y, viewportHeight);
      if (bottom - top < fastText.contentCutoffPixels.y) {
        result.position = vec4<f32>(0.0);
      }
    }
  }

  return result;
}

@vertex
fn vertexMain(attributes: FastTextAttributes) -> FastTextVaryings {
  let worldPosition = vec3<f32>(attributes.instancePositions, 0.0);
  geometry.worldPosition = worldPosition;
  geometry.uv = attributes.positions;

  let glyphFrame = vec4<f32>(attributes.instanceGlyphFrames);
  let glyphSize = glyphFrame.zw;
  let sizePixels = clamp(
    project_unit_size_to_pixel(fastText.size * fastText.sizeScale, fastText.sizeUnits),
    fastText.sizeMinPixels,
    fastText.sizeMaxPixels
  );
  let instanceScale = select(sizePixels / fastText.fontSize, 0.0, fastText.fontSize == 0.0);
  var pixelOffset = vec2<f32>(attributes.instanceGlyphOffsets) + attributes.positions * glyphSize;
  pixelOffset = pixelOffset * instanceScale + fastText.pixelOffset;
  pixelOffset.y = -pixelOffset.y;

  var clipPosition: vec4<f32>;
  var anchorPositionClip: vec4<f32>;

  if (fastText.billboard > 0.5) {
    let projected = project_position_to_clipspace_and_commonspace(
      worldPosition,
      vec3<f32>(0.0),
      vec3<f32>(0.0)
    );
    geometry.position = projected.commonPosition;
    anchorPositionClip = projected.clipPosition;
    clipPosition = vec4<f32>(
      projected.clipPosition.xy + project_pixel_size_to_clipspace(pixelOffset),
      projected.clipPosition.zw
    );
  } else {
    var offsetCommon = vec3<f32>(project_pixel_size_vec2(pixelOffset), 0.0);
    if (fastText.flipY > 0.5) {
      offsetCommon.y = -offsetCommon.y;
    }
    let projected = project_position_to_clipspace_and_commonspace(
      worldPosition,
      vec3<f32>(0.0),
      offsetCommon
    );
    geometry.position = projected.commonPosition;
    anchorPositionClip = project_position_to_clipspace(
      worldPosition,
      vec3<f32>(0.0),
      vec3<f32>(0.0)
    );
    clipPosition = projected.clipPosition;
  }

  let anchorPositionNdc = anchorPositionClip.xy / anchorPositionClip.w;
  let anchorPositionScreen = vec2<f32>(
    anchorPositionNdc.x + 1.0,
    1.0 - anchorPositionNdc.y
  ) * 0.5 * project.viewportSize / project.devicePixelRatio;
  let clipped = fast_text_clip_glyph_vertex(
    pixelOffset,
    anchorPositionScreen,
    attributes.instanceClipRects,
    clipPosition
  );

  var varyings: FastTextVaryings;
  varyings.position = clipped.position;
  varyings.color = attributes.instanceColors;
  varyings.textureCoords =
    (glyphFrame.xy + attributes.positions * glyphSize) / fastText.fontAtlasSize;
  varyings.uv = attributes.positions;
  return varyings;
}

@fragment
fn fragmentMain(varyings: FastTextVaryings) -> @location(0) vec4<f32> {
  geometry.uv = varyings.uv;

  var alpha = textureSample(
    fontAtlasTexture,
    fontAtlasTextureSampler,
    varyings.textureCoords
  ).a;

  if (fastText.sdfEnabled > 0.5) {
    alpha = smoothstep(
      fastText.sdfBuffer - fastText.sdfGamma,
      fastText.sdfBuffer + fastText.sdfGamma,
      alpha
    );
  }

  let outputAlpha = alpha * varyings.color.a;
  if (outputAlpha < fastText.alphaCutoff) {
    discard;
  }

  return deckgl_premultiplied_alpha(
    vec4<f32>(varyings.color.rgb, outputAlpha * layer.opacity)
  );
}
`;
