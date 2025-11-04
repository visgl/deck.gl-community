// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export const vs = /* glsl */ `\
#version 300 es
#define SHADER_NAME flow-path-layer-vertex-shader

in vec3 positions;
in vec3 instanceSourcePositions;
in vec3 instanceTargetPositions;
in vec3 instanceSourcePositions64Low;
in vec3 instanceTargetPositions64Low;
in vec4 instanceColors;
in vec3 instancePickingColors;
in float instanceWidths;
in float instanceSpeeds;
in float instanceOffsets;
in float instanceTailLengths;

out vec4 vColor;
out vec2 uv;
out float segmentIndex;
out float speed;
out float pathLength;
out float tailLength;
out float flowOffset;

vec2 getExtrusionOffset(vec2 line_clipspace, float offset_direction, float width) {
  vec2 dir_screenspace = normalize(line_clipspace * project.viewportSize);
  dir_screenspace = vec2(-dir_screenspace.y, dir_screenspace.x);
  return dir_screenspace * offset_direction * width / 2.0;
}

void main(void) {
  geometry.worldPosition = instanceSourcePositions;
  geometry.worldPositionAlt = instanceTargetPositions;

  vec3 source_world = instanceSourcePositions;
  vec3 target_world = instanceTargetPositions;
  vec3 source_world_64low = instanceSourcePositions64Low;
  vec3 target_world_64low = instanceTargetPositions64Low;

  if (line.useShortestPath > 0.5 || line.useShortestPath < -0.5) {
    source_world.x = mod(source_world.x + 180., 360.0) - 180.;
    target_world.x = mod(target_world.x + 180., 360.0) - 180.;
    float deltaLng = target_world.x - source_world.x;

    if (deltaLng * line.useShortestPath > 180.) {
      source_world.x += 360. * line.useShortestPath;
      float splitX = 180. * line.useShortestPath;
      float t = (splitX - source_world.x) / (target_world.x - source_world.x);
      source_world = vec3(splitX, mix(source_world.yz, target_world.yz, t));
      source_world_64low = vec3(0.0);
    } else if (deltaLng * line.useShortestPath < -180.) {
      target_world.x += 360. * line.useShortestPath;
      float splitX = 180. * line.useShortestPath;
      float t = (splitX - source_world.x) / (target_world.x - source_world.x);
      target_world = vec3(splitX, mix(source_world.yz, target_world.yz, t));
      target_world_64low = vec3(0.0);
    } else if (line.useShortestPath < 0.) {
      gl_Position = vec4(0.);
      return;
    }
  }

  vec4 source_commonspace;
  vec4 target_commonspace;
  vec4 source = project_position_to_clipspace(source_world, source_world_64low, vec3(0.), source_commonspace);
  vec4 target = project_position_to_clipspace(target_world, target_world_64low, vec3(0.), target_commonspace);

  segmentIndex = positions.x;
  vec4 p = mix(source, target, segmentIndex);
  geometry.position = mix(source_commonspace, target_commonspace, segmentIndex);
  uv = positions.xy;
  geometry.uv = uv;
  geometry.pickingColor = instancePickingColors;
  speed = instanceSpeeds;
  flowOffset = instanceOffsets;

  float widthPixels = clamp(
    project_size_to_pixel(instanceWidths * line.widthScale, line.widthUnits),
    line.widthMinPixels,
    line.widthMaxPixels
  );

  tailLength = project_size_to_pixel(instanceTailLengths * line.widthScale, line.widthUnits);

  vec3 offset = vec3(
    getExtrusionOffset(target.xy - source.xy, positions.y, widthPixels),
    0.0
  );
  DECKGL_FILTER_SIZE(offset, geometry);
  DECKGL_FILTER_GL_POSITION(p, geometry);
  gl_Position = p + vec4(project_pixel_size_to_clipspace(offset.xy), 0.0, 0.0);

  pathLength = length(target_commonspace.xyz - source_commonspace.xyz);

  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);
}
`;
