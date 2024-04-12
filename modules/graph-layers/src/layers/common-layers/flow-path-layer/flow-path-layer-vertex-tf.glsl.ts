export const tfvs = /* glsl */`\
#define SHADER_NAME flow-path-layer-vertex-tf-shader

attribute float a_offset;
attribute float a_speed;
varying float v_offset;

void main(void) {
  v_offset = a_offset + a_speed;
}
`;
