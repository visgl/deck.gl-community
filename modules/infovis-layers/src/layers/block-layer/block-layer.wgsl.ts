// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** WebGPU vertex and fragment shaders for {@link BlockLayer}. */
export default /* wgsl */ `
struct BlockUniforms {
  sizeUnits: i32,
  widthMinPixels: f32,
  heightMinPixels: f32,
  sizeMaxPixels: f32,
  lineWidthUnits: i32,
};

@group(0) @binding(auto) var<uniform> block: BlockUniforms;

struct BlockAttributes {
  @location(0) positions: vec3<f32>,
  @location(1) instancePositions: vec3<f32>,
  @location(2) instancePositions64Low: vec3<f32>,
  @location(3) instanceSizes: vec2<f32>,
  @location(4) instanceLineWidths: f32,
  @location(5) instanceLineColors: vec4<f32>,
  @location(6) instanceFillColors: vec4<f32>,
  @location(7) instancePickingColors: vec3<f32>,
};

struct BlockVaryings {
  @builtin(position) position: vec4<f32>,
  @location(0) unitPosition: vec2<f32>,
  @location(1) @interpolate(flat) fillColor: vec4<f32>,
  @location(2) @interpolate(flat) lineColor: vec4<f32>,
  @location(3) @interpolate(flat) lineWidth: f32,
  @location(4) @interpolate(flat) size: vec2<f32>,
  @location(5) @interpolate(flat) pickingColor: vec3<f32>,
};

fn block_size_to_pixels(size: vec2<f32>, unit: i32) -> vec2<f32> {
  return vec2<f32>(
    project_unit_size_to_pixel(size.x, unit),
    project_unit_size_to_pixel(size.y, unit)
  );
}

fn block_clamp_signed_size(size: f32, minimum: f32, maximum: f32) -> f32 {
  return select(1.0, -1.0, size < 0.0) * clamp(abs(size), minimum, maximum);
}

@vertex
fn vertexMain(attributes: BlockAttributes) -> BlockVaryings {
  geometry.worldPosition = attributes.instancePositions;
  geometry.pickingColor = attributes.instancePickingColors;
  geometry.uv = attributes.positions.xy;

  var pixelSize = block_size_to_pixels(attributes.instanceSizes, block.sizeUnits);
  pixelSize.x = block_clamp_signed_size(pixelSize.x, block.widthMinPixels, block.sizeMaxPixels);
  pixelSize.y = block_clamp_signed_size(pixelSize.y, block.heightMinPixels, block.sizeMaxPixels);

  let offset = vec3<f32>(
    attributes.positions.xy * project_pixel_size_vec2(pixelSize),
    0.0
  );
  let projected = project_position_to_clipspace_and_commonspace(
    attributes.instancePositions,
    attributes.instancePositions64Low,
    offset
  );
  geometry.position = projected.commonPosition;

  var varyings: BlockVaryings;
  varyings.position = projected.clipPosition;
  varyings.unitPosition = attributes.positions.xy;
  varyings.fillColor = vec4<f32>(
    attributes.instanceFillColors.rgb,
    attributes.instanceFillColors.a * layer.opacity
  );
  varyings.lineColor = vec4<f32>(
    attributes.instanceLineColors.rgb,
    attributes.instanceLineColors.a * layer.opacity
  );
  varyings.lineWidth = project_unit_size_to_pixel(
    attributes.instanceLineWidths,
    block.lineWidthUnits
  );
  varyings.size = pixelSize;
  varyings.pickingColor = attributes.instancePickingColors;
  return varyings;
}

@fragment
fn fragmentMain(varyings: BlockVaryings) -> @location(0) vec4<f32> {
  let relativePosition = varyings.unitPosition * varyings.size;
  let distanceToBorder = min(
    min(relativePosition.x, relativePosition.y),
    min(varyings.size.x - relativePosition.x, varyings.size.y - relativePosition.y)
  );
  var fragColor = select(
    varyings.fillColor,
    varyings.lineColor,
    varyings.lineWidth > 0.0 && distanceToBorder <= varyings.lineWidth
  );

  if (picking.isActive > 0.5) {
    if (!picking_isColorValid(varyings.pickingColor)) {
      discard;
    }
    return vec4<f32>(picking_normalizeColor(varyings.pickingColor), 1.0);
  }

  if (picking.isHighlightActive > 0.5) {
    let highlightedColor = picking_normalizeColor(picking.highlightedObjectColor);
    let objectColor = picking_normalizeColor(varyings.pickingColor);
    if (picking_isColorZero(abs(objectColor - highlightedColor))) {
      let highlightAlpha = picking.highlightColor.a;
      let blendedAlpha = highlightAlpha + fragColor.a * (1.0 - highlightAlpha);
      if (blendedAlpha > 0.0) {
        fragColor = vec4<f32>(
          mix(fragColor.rgb, picking.highlightColor.rgb, highlightAlpha / blendedAlpha),
          blendedAlpha
        );
      }
    }
  }

  return deckgl_premultiplied_alpha(fragColor);
}
`;
