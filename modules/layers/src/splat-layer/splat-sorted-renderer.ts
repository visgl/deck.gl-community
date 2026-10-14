// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createIterable, fp64LowPart, type Viewport} from '@deck.gl/core';
import {Buffer, type Device, type Framebuffer, type BufferLayout} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {getSplatGeometry} from './splat-source';
import {getSplatTransform} from './splat-transform';
import {getSplatCommonUnits, getSplatProjectionKey} from './splat-culling';
import type {SplatPrimitiveLayer} from './splat-primitive-layer';

const ATTRIBUTES = {
  splatCorners: 2,
  splatCenters: 3,
  splatAxisX: 3,
  splatAxisY: 3,
  splatAxisZ: 3,
  splatColors: 4,
  splatNormals: 3,
  instancePositions: 3,
  instancePositions64Low: 3,
  instanceColors: 4,
  instanceModelMatrixCol0: 3,
  instanceModelMatrixCol1: 3,
  instanceModelMatrixCol2: 3,
  instanceTranslation: 3,
  instanceDeformation: 4,
  instanceCoverageWeight: 3
};
const STRIDE = Object.values(ATTRIBUTES).reduce((sum, size) => sum + size, 0);
const LAYOUT: BufferLayout[] = [
  {
    name: 'vertices',
    byteStride: STRIDE * 4,
    stepMode: 'vertex',
    attributes: Object.entries(ATTRIBUTES).map(([attribute, size], i, entries) => ({
      attribute,
      format: `float32x${size}` as 'float32x3',
      byteOffset: entries.slice(0, i).reduce((sum, [, n]) => sum + n, 0) * 4
    }))
  }
];
type Owner = {common: number[]; units: number[]; matrix: number[]; wind: number[]};
type Entry = {
  layer: SplatPrimitiveLayer;
  model: Model;
  key: string;
  vertices: Float32Array;
  owners: Owner[];
  count: number;
  offset: number;
  group: string;
};

/** A viewport-wide permutation of the selected prepared Gaussians. The original source
 * models still own picking and shadows; this working buffer only changes color draw order.
 */
export class SplatSortedRenderer {
  private entries = new Map<string, Entry>();
  private visible: Entry[] = [];
  private models = new Map<string, Model>();
  private vertices?: Buffer;
  private indices?: Buffer;
  private order: number[] = [];
  private depths = new Float64Array();
  private indexData = new Uint32Array();
  private packed: Entry[] = [];
  private viewport!: Viewport;
  constructor(private device: Device) {}

  begin(viewport: Viewport) {
    this.viewport = viewport;
    this.visible = [];
  }

  collect(layer: SplatPrimitiveLayer, model: Model) {
    // Attribute upload timestamps include accessor triggers, coverage fades and row diffs.
    const attributes = layer.getAttributeManager()!.getAttributes();
    const projectionKey = JSON.stringify([
      getSplatProjectionKey(this.viewport),
      layer.props.coordinateSystem,
      layer.props.coordinateOrigin,
      layer.props.modelMatrix
    ]);
    const key =
      projectionKey +
      Object.values(attributes)
        .map(
          a =>
            `${a.getBuffer()?.updateTimestamp}:${a.constant ? Array.from(a.value ?? []).join(',') : ''}`
        )
        .join('|');
    let entry = this.entries.get(layer.id);
    if (
      !entry ||
      entry.key !== key ||
      entry.layer.props.source !== layer.props.source ||
      entry.layer.props.data !== layer.props.data
    ) {
      entry = this.pack(layer, model, key);
      this.entries.set(layer.id, entry);
    }
    entry.layer = layer;
    entry.model = model;
    this.visible.push(entry);
  }

  private pack(layer: SplatPrimitiveLayer, model: Model, key: string): Entry {
    const {source} = layer.props;
    const geometry = getSplatGeometry(source);
    const countPerOwner = source.opacities.length;
    const vertices = new Float32Array(layer.getNumInstances() * countPerOwner * 4 * STRIDE);
    const owners: Owner[] = [];
    const {iterable, objectInfo} = createIterable(layer.props.data);
    const get = (name: string, object: unknown) => {
      const accessor = layer.props[name];
      return typeof accessor === 'function' ? accessor(object, objectInfo) : accessor;
    };
    let cursor = 0;
    for (const object of iterable) {
      objectInfo.index++;
      const anchor = get('getPosition', object);
      const position = [anchor[0], anchor[1], anchor[2] ?? 0];
      const matrix = getSplatTransform(
        get('getOrientation', object),
        get('getScale', object),
        get('getTranslation', object),
        get('getTransformMatrix', object)
      );
      const [height, phase, flex] = get('getDeformation', object);
      const wind = [
        height,
        flex,
        Math.sin(phase),
        Math.cos(phase),
        Math.sin(phase * 1.7),
        Math.cos(phase * 1.7)
      ];
      const common = layer.projectPosition(position, {viewport: this.viewport, autoOffset: false});
      owners.push({common, units: getSplatCommonUnits(common, this.viewport), matrix, wind});
      const color = get('getColor', object);
      const instance = {
        instancePositions: position,
        instancePositions64Low: position.map(fp64LowPart),
        // Tint is baked into source color. These bytes retain the original owner highlight.
        instanceColors: [...layer.encodePickingColor(objectInfo.index), 1],
        instanceModelMatrixCol0: matrix.slice(0, 3),
        instanceModelMatrixCol1: matrix.slice(3, 6),
        instanceModelMatrixCol2: matrix.slice(6, 9),
        instanceTranslation: matrix.slice(9, 12),
        instanceDeformation: wind.slice(0, 4),
        instanceCoverageWeight: [get('getCoverageWeight', object), wind[4], wind[5]]
      };
      for (let vertex = 0; vertex < countPerOwner * 4; vertex++) {
        for (const [name, size] of Object.entries(ATTRIBUTES)) {
          const values =
            instance[name] ??
            geometry.attributes[name]!.value.subarray(vertex * size, (vertex + 1) * size);
          for (let c = 0; c < size; c++)
            vertices[cursor++] =
              name === 'splatColors' ? (values[c] * (color[c] ?? 255)) / 255 : values[c];
        }
      }
    }
    return {
      layer,
      model,
      key,
      vertices,
      owners,
      count: owners.length * countPerOwner,
      offset: 0,
      group: ''
    };
  }

  render(target: Framebuffer, pixelRatio: number) {
    const active = new Set(this.visible.map(e => e.layer.id));
    for (const id of this.entries.keys()) if (!active.has(id)) this.entries.delete(id);
    const changed =
      this.packed.length !== this.visible.length ||
      this.visible.some((e, i) => e !== this.packed[i]);
    if (changed) {
      for (const model of this.models.values()) model.destroy();
      this.models.clear();
      this.vertices?.destroy();
      this.indices?.destroy();
      this.packed = [...this.visible];
      const count = this.visible.reduce((sum, e) => sum + e.count, 0);
      this.order = Array.from({length: count}, (_, i) => i);
      this.depths = new Float64Array(count);
      this.indexData = new Uint32Array(count * 6);
      if (!count) {
        this.vertices = undefined;
        this.indices = undefined;
        return;
      }
      const data = new Float32Array(count * 4 * STRIDE);
      let offset = 0;
      for (const entry of this.visible) {
        entry.offset = offset;
        data.set(entry.vertices, offset * 4 * STRIDE);
        offset += entry.count;
      }
      this.vertices = this.device.createBuffer({data});
      this.indices = this.device.createBuffer({
        usage: Buffer.INDEX | Buffer.COPY_DST,
        data: this.indexData
      });
    }
    if (!this.order.length) return;
    const groups = new Map<string, Entry>();
    for (const entry of this.visible) {
      const uniforms = {...entry.model.shaderInputs.getUniformValues()};
      uniforms.splat = {...uniforms.splat, mode: 0};
      // Color is globally ordered; artificial deck layer offsets must not reorder it.
      uniforms.layer = {...uniforms.layer, layerIndex: 0};
      const bindings = entry.model.shaderInputs.getBindingValues();
      const shaders = entry.layer.getShaders();
      entry.group = JSON.stringify([
        uniforms,
        Object.entries(bindings).map(([k, v]) => [
          k,
          'id' in v ? v.id : 'buffer' in v ? [v.buffer.id, v.offset, v.size] : v
        ]),
        shaders.inject,
        shaders.defines,
        shaders.modules.map(m => m.name),
        entry.layer.props.parameters
      ]);
      groups.set(entry.group, entry);
      let sortedModel = this.models.get(entry.layer.id);
      if (!sortedModel) {
        sortedModel = new Model(this.device, {
          ...shaders,
          id: 'sorted-prepared-splats',
          vs: shaders.vs
            .replace('picking_getPickingColorFromInstanceID()', 'instanceColors.rgb')
            .replace('splatColors.rgb * instanceColors.rgb', 'splatColors.rgb')
            .replace('splatColors.a * instanceColors.a', 'splatColors.a'),
          source: shaders.source
            .replace(
              'picking_getPickingColorFromIndex(attributes.instanceIndex)',
              'attributes.instanceColors.rgb / 255.0'
            )
            .replace(
              'attributes.splatColors.rgb * attributes.instanceColors.rgb',
              'attributes.splatColors.rgb'
            )
            .replace(
              'attributes.splatColors.a * attributes.instanceColors.a',
              'attributes.splatColors.a'
            ),
          bufferLayout: LAYOUT,
          topology: 'triangle-list',
          isInstanced: false,
          attributes: {vertices: this.vertices!},
          indexBuffer: this.indices!,
          parameters: {
            ...entry.layer.props.parameters,
            depthWriteEnabled: false,
            depthCompare: 'less-equal',
            blend: true,
            blendColorSrcFactor: 'src-alpha',
            blendColorDstFactor: 'one-minus-src-alpha',
            blendAlphaSrcFactor: 'one',
            blendAlphaDstFactor: 'one-minus-src-alpha',
            cullMode: 'none'
          }
        });
        this.models.set(entry.layer.id, sortedModel);
      }
      // These are already evaluated module uniforms, not module input props.
      sortedModel.shaderInputs.moduleUniforms = uniforms;
      sortedModel.shaderInputs.directBindings = bindings;
      this.updateDepths(entry);
    }
    for (const [key, model] of this.models)
      if (!this.visible.some(e => e.layer.id === key)) {
        model.destroy();
        this.models.delete(key);
      }
    this.order.sort((a, b) => this.depths[b] - this.depths[a] || a - b);
    for (let i = 0; i < this.order.length; i++) {
      const v = this.order[i] * 4;
      this.indexData.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    this.indices!.write(this.indexData);
    const viewport = this.viewport;
    const pass = this.device.beginRenderPass({
      framebuffer: target,
      clearColor: [0, 0, 0, 0],
      clearDepth: false,
      parameters: {
        viewport: [
          Math.round(viewport.x * pixelRatio),
          Math.round((target.height / pixelRatio - viewport.y - viewport.height) * pixelRatio),
          Math.round(viewport.width * pixelRatio),
          Math.round(viewport.height * pixelRatio)
        ]
      }
    });
    const entryAt = (index: number) =>
      this.visible.find(e => index >= e.offset && index < e.offset + e.count)!;
    for (let first = 0; first < this.order.length; ) {
      const group = entryAt(this.order[first]).group;
      let end = first + 1;
      while (end < this.order.length && entryAt(this.order[end]).group === group) end++;
      const model = this.models.get(groups.get(group)!.layer.id)!;
      model.setDrawOffsets({firstVertex: first * 24, firstIndex: first * 6});
      model.setIndexCount((end - first) * 6);
      model.draw(pass);
      first = end;
    }
    pass.end();
    this.device.submit();
  }

  private updateDepths(entry: Entry) {
    const source = entry.layer.props.source;
    const uniforms = entry.model.shaderInputs.getUniformValues().splat!;
    const wave = uniforms.wave as number[];
    const strength = uniforms.strength as number;
    const projection = this.viewport.viewProjectionMatrix;
    const count = source.opacities.length;
    for (let ownerIndex = 0; ownerIndex < entry.owners.length; ownerIndex++) {
      const owner = entry.owners[ownerIndex],
        m = owner.matrix;
      for (let i = 0; i < count; i++) {
        const p = source.positions.subarray(i * 3, i * 3 + 3);
        let x = m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9],
          y = m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10];
        const z = m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11];
        if (strength) {
          const [height, flex, sin, cos, sinCrown, cosCrown] = owner.wind;
          const u = Math.max(0, Math.min(1, z / Math.max(height, 0.001)));
          const f = 0.5 * u * u * (3 - u),
            g = Math.max((u - 0.3) / 0.7, 0) ** 2;
          const bend =
            strength * flex * (wave[0] * cos + wave[1] * sin) * Math.max(height, 0.001) * f;
          const branch = 0.35 * strength * flex * (wave[2] * cosCrown + wave[3] * sinCrown) * g;
          const dx = bend + branch * (0.65 * x + 0.3 * y),
            dy = 0.45 * bend + branch * (-0.25 * x + 0.8 * y);
          x += dx;
          y += dy;
        }
        const world = [
          owner.common[0] + x * owner.units[0],
          owner.common[1] + y * owner.units[1],
          owner.common[2] + z * owner.units[2]
        ];
        const clipZ =
          projection[2] * world[0] +
          projection[6] * world[1] +
          projection[10] * world[2] +
          projection[14];
        const clipW =
          projection[3] * world[0] +
          projection[7] * world[1] +
          projection[11] * world[2] +
          projection[15];
        this.depths[entry.offset + ownerIndex * count + i] = clipZ / clipW;
      }
    }
  }

  destroy() {
    for (const model of this.models.values()) model.destroy();
    this.models.clear();
    this.vertices?.destroy();
    this.indices?.destroy();
    this.entries.clear();
    this.packed = [];
    this.visible = [];
  }
}
