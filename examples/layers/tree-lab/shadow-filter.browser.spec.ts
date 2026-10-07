// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Value: protects=thin shadow coverage survives fractional motion across shadow texels;
// fails_when=depth interpolation erases silhouettes before the shadow comparison;
// why_new=scene coverage tests do not isolate filtering order or subtexel motion; seam=shader source

import {expect, it} from 'vitest';
import {SHADOW_FILTER} from './tree-lighting';

it('preserves a thin shadow while its receiver moves between texels', () => {
  const canvas = document.createElement('canvas');
  canvas.width = 129;
  canvas.height = 1;
  const gl = canvas.getContext('webgl2')!;
  expect(gl).not.toBeNull();
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram()!;
  const texture = gl.createTexture()!;
  const vao = gl.createVertexArray()!;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    shaders.push(shader);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS), gl.getShaderInfoLog(shader)!).toBe(
      true
    );
    gl.attachShader(program, shader);
  };
  try {
    compile(
      gl.VERTEX_SHADER,
      `#version 300 es
      void main() {
        vec2 vertex = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
        gl_Position = vec4(vertex * 2.0 - 1.0, 0.0, 1.0);
      }`
    );
    compile(
      gl.FRAGMENT_SHADER,
      `#version 300 es
      precision highp float;
      uniform highp sampler2DShadow shadowMap;
      uniform float receiverDepth;
      out vec4 color;
      ${SHADOW_FILTER}
      void main() {
        float x = (5.5 + (gl_FragCoord.x - 0.5) / 32.0) / 16.0;
        float occlusion = shadow_getShadowWeight(vec3(x, 0.5, receiverDepth), shadowMap, 0.001);
        color = vec4(vec3(occlusion), 1.0);
      }`
    );
    gl.linkProgram(program);
    expect(gl.getProgramParameter(program, gl.LINK_STATUS), gl.getProgramInfoLog(program)!).toBe(
      true
    );
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // A single-texel blade at depth 0.5 against clear depth 1.0.
    // Native depth comparison samplers interpolate comparison results, never depths.
    const depths = new Float32Array(16 * 8).fill(1);
    for (let y = 0; y < 8; y++) depths[y * 16 + 7] = 0.5;
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT32F,
      16,
      8,
      0,
      gl.DEPTH_COMPONENT,
      gl.FLOAT,
      depths
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'shadowMap'), 0);
    gl.viewport(0, 0, canvas.width, 1);
    const curves: number[][] = [];
    for (const depth of [0.51, 0.9]) {
      gl.uniform1f(gl.getUniformLocation(program, 'receiverDepth'), depth);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const pixels = new Uint8Array(canvas.width * 4);
      gl.readPixels(0, 0, canvas.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      expect(gl.getError()).toBe(gl.NO_ERROR);
      const coverage = Array.from({length: canvas.width}, (_, x) => pixels[x * 4]);
      // The three-texel tent preserves fractional blade coverage between centers.
      expect(Math.abs(coverage[32] - 255 / 4)).toBeLessThanOrEqual(1);
      expect(Math.abs(coverage[64] - 255 / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(coverage[96] - 255 / 4)).toBeLessThanOrEqual(1);
      for (const value of coverage.slice(32, 97)) expect(value).toBeGreaterThanOrEqual(63);
      for (let x = 1; x < coverage.length; x++) {
        expect(Math.abs(coverage[x] - coverage[x - 1])).toBeLessThanOrEqual(3);
      }
      curves.push(coverage);
    }
    expect(curves[1]).toEqual(curves[0]);
  } finally {
    gl.deleteProgram(program);
    for (const shader of shaders) gl.deleteShader(shader);
    gl.deleteTexture(texture);
    gl.deleteVertexArray(vao);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
});
