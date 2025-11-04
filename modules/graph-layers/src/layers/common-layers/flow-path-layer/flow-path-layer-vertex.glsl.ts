// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME flow-path-layer-vertex-shader

in vec3 positions;
in vec3 instanceSourcePositions;
in vec3 instanceTargetPositions;
in vec4 instanceSourceTargetPositions64xyLow;
in vec4 instanceColors;
in vec3 instancePickingColors;
in float instanceWidths;
in float instanceSpeeds;
in float instanceOffsets;
in float instanceTailLengths;

uniform float opacity;
uniform float widthScale;
uniform float widthMinPixels;
uniform float widthMaxPixels;

out vec4 vColor;
out float segmentIndex;
out float speed;
out float pathLength;
out float tailLength;
out float flowOffset;

// offset vector by strokeWidth pixels
// offset_direction is -1 (left) or 1 (right)
vec2 getExtrusionOffset(vec2 line_clipspace, float offset_direction, float width) {
  // normalized direction of the line
  vec2 dir_screenspace = normalize(line_clipspace * project_uViewportSize);
  // rotate by 90 degrees
  dir_screenspace = vec2(-dir_screenspace.y, dir_screenspace.x);

  vec2 offset_screenspace = dir_screenspace * offset_direction * width / 2.0;
  vec2 offset_clipspace = project_pixel_size_to_clipspace(offset_screenspace);

  return offset_clipspace;
}

void main(void) {
  // Position
  vec4 source = project_position_to_clipspace(instanceSourcePositions, instanceSourceTargetPositions64xyLow.xy, vec3(0.));
  vec4 target = project_position_to_clipspace(instanceTargetPositions, instanceSourceTargetPositions64xyLow.zw, vec3(0.));

  // Multiply out width and clamp to limits
  float widthPixels = clamp(
    project_size_to_pixel(instanceWidths * widthScale),
    widthMinPixels, widthMaxPixels
  );

  // linear interpolation of source & target to pick right coord
  segmentIndex = positions.x;
  speed = instanceSpeeds;
  tailLength = project_size_to_pixel(instanceTailLengths * widthScale);
  flowOffset = instanceOffsets;
  pathLength = distance(instanceSourcePositions, instanceTargetPositions);
  vec4 p = mix(source, target, segmentIndex);

  // extrude
  vec2 extrudedOffset = getExtrusionOffset(target.xy - source.xy, positions.y, widthPixels);
  gl_Position = p + vec4(extrudedOffset, 0.0, 0.0);

  // Color
  vColor = vec4(instanceColors.rgb, instanceColors.a * opacity) / 255.;

  // Set color to be rendered to picking fbo (also used to check for selection highlight).
  picking_setPickingColor(instancePickingColors);
}
`;
