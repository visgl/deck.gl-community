// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  Buffer,
  type CommandEncoder,
  type Device,
  type RenderPass,
  type RenderPipelineParameters
} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {
  evaluateSplatSphericalHarmonics,
  projectSplatCovarianceToScreen,
  transformSplatPosition,
  type GPUPagedSplatPage,
  type GPUPagedSplatRendererProps
} from '@luma.gl/splats';

const VERTEX_SHADER = `#version 300 es
in vec4 centers;
in vec4 axes;
in vec4 colors;
out vec2 gaussian;
out vec4 color;
void main() {
  vec2 corners[4] = vec2[4](vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(1.,1.));
  vec2 corner = corners[gl_VertexID];
  float support = sqrt(8.) + .7 * max(colors.a - 1., 0.);
  gl_Position = vec4(centers.xy + (corner.x * axes.xy + corner.y * axes.zw) * centers.w, centers.zw);
  gaussian = corner * support;
  color = colors;
}`;
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 gaussian;
in vec4 color;
out vec4 fragColor;
void main() {
  float support = sqrt(8.) + .7 * max(color.a - 1., 0.);
  float radiusSquared = dot(gaussian, gaussian);
  if (radiusSquared > support * support) discard;
  float weight = exp(-.5 * radiusSquared);
  float alpha = color.a > 1. ? 1. - pow(max(1. - weight, 0.), exp((color.a * color.a - 1.) / 2.718281828459045)) : color.a * weight;
  if (alpha < .5 / 255.) discard;
  fragColor = vec4(max(color.rgb, vec3(0.)), min(alpha, 1.));
}`;

const PICKING_FRAGMENT_SHADER = FRAGMENT_SHADER.replace(
  'fragColor = vec4(max(color.rgb, vec3(0.)), min(alpha, 1.));',
  'fragColor = vec4(color.rgb, 1.);'
);
const WGSL_SHADER = `
struct Input { @location(0) centers: vec4<f32>, @location(1) axes: vec4<f32>, @location(2) colors: vec4<f32> };
struct Output { @builtin(position) position: vec4<f32>, @location(0) gaussian: vec2<f32>, @location(1) color: vec4<f32> };
@vertex fn vertexMain(input: Input, @builtin(vertex_index) index: u32) -> Output {
  let corners = array<vec2<f32>,4>(vec2(-1.,-1.), vec2(1.,-1.), vec2(-1.,1.), vec2(1.,1.));
  let corner = corners[index];
  let support = sqrt(8.) + .7 * max(input.colors.a - 1., 0.);
  var output: Output;
  output.position = vec4(input.centers.xy + (corner.x * input.axes.xy + corner.y * input.axes.zw) * input.centers.w, (input.centers.z + input.centers.w) * .5, input.centers.w);
  output.gaussian = corner * support;
  output.color = input.colors;
  return output;
}
@fragment fn fragmentMain(input: Output) -> @location(0) vec4<f32> {
  let support = sqrt(8.) + .7 * max(input.color.a - 1., 0.);
  let radiusSquared = dot(input.gaussian, input.gaussian);
  if (radiusSquared > support * support) {discard;}
  let weight = exp(-.5 * radiusSquared);
  let alpha = select(input.color.a * weight, 1. - pow(max(1. - weight, 0.), exp((input.color.a * input.color.a - 1.) / 2.718281828459045)), input.color.a > 1.);
  if (alpha < .5 / 255.) {discard;}
  return vec4(input.color.rgb, 1.);
}`;
export type SplatScenePage = GPUPagedSplatPage & {
  layerId?: string;
  ownerIndex?: number;
  pickingColor?: number[];
};

/** Exact globally sorted projected working records for WebGL2; source pages are never repacked. */
export class SplatCPUSceneRenderer {
  private pages: readonly SplatScenePage[] = [];
  private props: GPUPagedSplatRendererProps = {viewportSize: [1, 1]};
  private readonly model: Model;
  private buffer?: Buffer;
  constructor(
    private readonly device: Device,
    private readonly picking = false
  ) {
    this.model = new Model(device, {
      id: 'splat-scene-cpu',
      vs: VERTEX_SHADER,
      fs: picking ? PICKING_FRAGMENT_SHADER : FRAGMENT_SHADER,
      ...(device.type === 'webgpu'
        ? {
            source: WGSL_SHADER,
            colorAttachmentFormats: ['rgba8unorm'],
            shaderLayout: {
              attributes: [
                {name: 'centers', type: 'vec4<f32>', location: 0},
                {name: 'axes', type: 'vec4<f32>', location: 1},
                {name: 'colors', type: 'vec4<f32>', location: 2}
              ],
              bindings: []
            }
          }
        : {}),
      vertexCount: 4,
      instanceCount: 0,
      isInstanced: true,
      topology: 'triangle-strip',
      bufferLayout: [
        {
          name: 'projected',
          stepMode: 'instance',
          byteStride: 48,
          attributes: [
            {attribute: 'centers', byteOffset: 0, format: 'float32x4'},
            {attribute: 'axes', byteOffset: 16, format: 'float32x4'},
            {attribute: 'colors', byteOffset: 32, format: 'float32x4'}
          ]
        }
      ],
      parameters: {
        depthWriteEnabled: false,
        depthCompare: 'less-equal',
        blend: true,
        blendColorSrcFactor: 'src-alpha',
        blendColorDstFactor: 'one-minus-src-alpha',
        blendAlphaSrcFactor: 'one',
        blendAlphaDstFactor: 'one-minus-src-alpha'
      }
    });
  }
  setProps(props: Partial<GPUPagedSplatRendererProps>): void {
    Object.assign(this.props, props);
  }
  setFrontier(pages: readonly SplatScenePage[]): void {
    this.pages = pages;
  }
  prepare(encoder: CommandEncoder): undefined {
    const records: {depth: number; order: number; values: number[]}[] = [];
    const viewportSize = this.props.viewportSize ?? [1, 1];
    for (const page of this.pages) {
      const source = page.data.source;
      const matrix =
        page.modelViewProjectionMatrix ?? Array.from(this.props.modelViewProjectionMatrix ?? []);
      const camera = page.cameraPosition ?? this.props.cameraPosition ?? [0, 0, 0];
      const rows =
        page.activeRows ?? Uint32Array.from({length: page.data.length}, (_, index) => index);
      for (const row of rows) {
        const position = Array.from(source.positions.subarray(row * 3, row * 3 + 3)) as [
          number,
          number,
          number
        ];
        const clip = transformSplatPosition(matrix, position);
        if (clip[3] <= 1e-6 || clip[2] < -clip[3] || clip[2] > clip[3]) continue;
        const divisor = source.colors instanceof Uint8Array ? 255 : 1;
        let alpha = (source.opacities[row] * source.colors[row * 4 + 3]) / divisor;
        if (alpha > 1) alpha = Math.min(alpha * 4 - 3, 5);
        alpha *= page.alphaScale ?? 1;
        const projection = {
          position,
          scale: Array.from(source.scales.subarray(row * 3, row * 3 + 3)) as [
            number,
            number,
            number
          ],
          rotation: Array.from(source.rotations.subarray(row * 4, row * 4 + 4)) as [
            number,
            number,
            number,
            number
          ],
          modelViewProjectionMatrix: matrix,
          viewportSize
        };
        const original = projectSplatCovarianceToScreen(projection);
        const filtered = projectSplatCovarianceToScreen({
          ...projection,
          kernel2DSize: Math.sqrt(0.3)
        });
        alpha *= Math.sqrt(
          Math.abs(
            (original.axis0[0] * original.axis1[1] - original.axis0[1] * original.axis1[0]) /
              (filtered.axis0[0] * filtered.axis1[1] - filtered.axis0[1] * filtered.axis1[0])
          )
        );
        if (alpha < 0.5 / 255) continue;
        const support = Math.sqrt(8) + 0.7 * Math.max(alpha - 1, 0);
        const color = [0, 1, 2].map(channel => source.colors[row * 4 + channel] / divisor);
        const coefficients = source.sphericalHarmonics;
        const coefficientCount = coefficients ? coefficients.length / page.data.length : 0;
        let rgb = coefficients
          ? evaluateSplatSphericalHarmonics(
              color,
              coefficients.subarray(row * coefficientCount, (row + 1) * coefficientCount),
              position.map((value, axis) => value - camera[axis]),
              page.data.sphericalHarmonicsDegree
            )
          : color;
        rgb = rgb.map((value, axis) => value * (page.colorScale?.[axis] ?? 1));
        if (this.picking) rgb = page.pickingColor ?? [0, 0, 0];
        const axis0Scale = Math.min(support, 512 / Math.max(Math.hypot(...filtered.axis0), 1e-6));
        const axis1Scale = Math.min(support, 512 / Math.max(Math.hypot(...filtered.axis1), 1e-6));
        records.push({
          depth: clip[2] / clip[3],
          order: records.length,
          values: [
            ...clip,
            (filtered.axis0[0] * axis0Scale * 2) / viewportSize[0],
            (-filtered.axis0[1] * axis0Scale * 2) / viewportSize[1],
            (filtered.axis1[0] * axis1Scale * 2) / viewportSize[0],
            (-filtered.axis1[1] * axis1Scale * 2) / viewportSize[1],
            ...rgb,
            alpha
          ]
        });
      }
    }
    records.sort((a, b) => b.depth - a.depth || a.order - b.order);
    const values = new Float32Array(records.length * 12);
    for (let index = 0; index < records.length; index++)
      values.set(records[index].values, index * 12);
    if (!this.buffer || this.buffer.byteLength < values.byteLength) {
      this.buffer?.destroy();
      this.buffer = this.device.createBuffer({
        byteLength: Math.max(48, values.byteLength),
        usage: Buffer.VERTEX | Buffer.COPY_DST
      });
      this.model.setAttributes({projected: this.buffer});
    }
    if (values.length) this.buffer.write(values);
    this.model.setInstanceCount(records.length);
    this.model.predraw(encoder);
    return undefined;
  }
  draw(pass: RenderPass, parameters?: RenderPipelineParameters): void {
    if (parameters)
      this.model.setParameters({
        ...parameters,
        depthWriteEnabled: this.picking,
        depthCompare: 'less-equal'
      });
    this.model.draw(pass);
  }
  destroy(): void {
    this.model.destroy();
    this.buffer?.destroy();
  }
}
