// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const vs = /* glsl */ `\
#define SHADER_NAME flow-path-layer-vertex-shader

attribute vec3 positions;
attribute vec3 instanceSourcePositions;
attribute vec3 instanceTargetPositions;
attribute vec4 instanceSourceTargetPositions64xyLow;
attribute vec4 instanceColors;
attribute vec3 instancePickingColors;
attribute float instanceWidths;
attribute float instanceSpeeds;
attribute float instanceOffsets;
attribute float instanceTailLengths;

varying vec4 vColor;
varying float segmentIndex;
varying float speed;
varying float pathLength;
varying float tailLength;
varying float offset;

// offset vector by strokeWidth pixels
// offset_direction is -1 (left) or 1 (right)
vec2 getExtrusionOffset(vec2 line_clipspace, float offset_direction, float width) {
  // normalized direction of the line
  vec2 dir_screenspace = normalize(line_clipspace * project.viewportSize);
  // rotate by 90 degrees
  dir_screenspace = vec2(-dir_screenspace.y, dir_screenspace.x);

  return dir_screenspace * offset_direction * width / 2.0;
}

void main(void) {
  // Position
  vec4 source = project_position_to_clipspace(instanceSourcePositions, instanceSourceTargetPositions64xyLow.xy, vec3(0.));
  vec4 target = project_position_to_clipspace(instanceTargetPositions, instanceSourceTargetPositions64xyLow.zw, vec3(0.));

  // Multiply out width and clamp to limits
  float widthPixels = clamp(
    project_size_to_pixel(instanceWidths * line.widthScale, line.widthUnits),
    line.widthMinPixels, line.widthMaxPixels
  );

  // linear interpolation of source & target to pick right coord
  segmentIndex = positions.x;
  speed = instanceSpeeds;
  tailLength = project_size_to_pixel(instanceTailLengths * line.widthScale, line.widthUnits);
  offset = instanceOffsets;
  pathLength = distance(instanceSourcePositions, instanceTargetPositions);
  vec4 p = mix(source, target, segmentIndex);

  // extrude
  vec2 extrusionOffset = getExtrusionOffset(target.xy - source.xy, positions.y, widthPixels);
  gl_Position = p + vec4(project_pixel_size_to_clipspace(extrusionOffset), 0.0, 0.0);

  // Color
  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity) / 255.;

  // Set color to be rendered to picking fbo (also used to check for selection highlight).
  picking_setPickingColor(instancePickingColors);
}
`;
