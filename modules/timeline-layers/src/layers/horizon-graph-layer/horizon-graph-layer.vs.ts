// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export default `#version 300 es
#define SHADER_NAME horizon-graph-layer-vertex-shader

in vec3 positions;
in vec2 uv;

out vec2 v_uv;

void main(void) {
  geometry.worldPosition = positions;
  
  vec4 position_commonspace = project_position(vec4(positions.xy, 0.0, 1.0));
  gl_Position = project_common_position_to_clipspace(position_commonspace);
  geometry.position = position_commonspace;
  
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
  
  v_uv = uv;
}
`;
