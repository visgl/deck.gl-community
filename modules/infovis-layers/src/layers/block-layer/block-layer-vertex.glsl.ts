// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export default `\
#version 300 es
#define SHADER_NAME block-layer-vertex-shader

in vec3 positions;
in vec3 instancePositions;
in vec3 instancePositions64Low;
in vec2 instanceSizes;
in float instanceLineWidths;
in vec4 instanceFillColors;
in vec4 instanceLineColors;
in vec3 instancePickingColors;

out vec2 unitPosition;
flat out vec4 vFillColor;
flat out vec4 vLineColor;
flat out float lineWidth;
flat out vec2 size;

// This needs to be added back to the project module
vec2 project_size_to_pixel(vec2 size, int unit) {
  if (unit == UNIT_PIXELS) return size;
  if (unit == UNIT_COMMON && project.projectionMode != PROJECTION_MODE_IDENTITY) {
    return size * project.scale;
  }
  return project_size(size) * project.scale;
}

float clamp_signed_size(float size, float minPixels, float maxPixels) {
  float clampedMagnitude = clamp(abs(size), minPixels, maxPixels);
  if (size < 0.0) {
    return -clampedMagnitude;
  }
  return clampedMagnitude;
}

void main(void) {
  geometry.worldPosition = instancePositions;
  geometry.pickingColor = instancePickingColors;
  geometry.uv = positions.xy;

  vec2 pixelSize = project_size_to_pixel(instanceSizes, block.sizeUnits);
  pixelSize.x = clamp_signed_size(pixelSize.x, block.widthMinPixels, block.sizeMaxPixels);
  pixelSize.y = clamp_signed_size(pixelSize.y, block.heightMinPixels, block.sizeMaxPixels);
  unitPosition = positions.xy;
  size = pixelSize;
  lineWidth = project_size_to_pixel(vec2(instanceLineWidths, 0.0), block.lineWidthUnits).x;

  // Find the center of the point and add the current vertex
  vec3 offset = vec3(unitPosition * project_pixel_size(pixelSize), 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);

  gl_Position = project_position_to_clipspace(instancePositions, instancePositions64Low, offset, geometry.position);
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);

  // Apply opacity to instance color, or return instance picking color
  vFillColor = vec4(instanceFillColors.rgb, instanceFillColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vFillColor, geometry);

  vLineColor = vec4(instanceLineColors.rgb, instanceLineColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vLineColor, geometry);
}
`;
