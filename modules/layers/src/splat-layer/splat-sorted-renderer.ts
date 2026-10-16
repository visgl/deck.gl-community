// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {createIterable, fp64LowPart, type Viewport} from '@deck.gl/core';
import {Buffer, type Device, type Framebuffer, type BufferLayout} from '@luma.gl/core';
import {Model, DynamicBuffer} from '@luma.gl/engine';
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
  instanceDeformation: 4
};
const ATTRIBUTE_ENTRIES = Object.entries(ATTRIBUTES);
const SORTED_PARAMETERS = {
  depthWriteEnabled: false,
  depthCompare: 'less-equal',
  blend: true,
  blendColorSrcFactor: 'src-alpha',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  cullMode: 'none'
} as const;
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
  },
  {
    name: 'coverage',
    byteStride: 12,
    stepMode: 'vertex',
    attributes: [{attribute: 'instanceCoverageWeight', format: 'float32x3', byteOffset: 0}]
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
  coverage: Float32Array;
  coverageWeights: number[];
  coverageDirty: boolean;
};

/** A viewport-wide permutation of the selected prepared Gaussians. The original source
 * models still own picking; this working buffer only changes color draw order.
 */
export class SplatSortedRenderer {
  private entries = new Map<string, Entry>();
  private visible: Entry[] = [];
  private models = new Map<string, Model>();
  private vertices?: DynamicBuffer;
  private indices?: DynamicBuffer;
  private coverage?: DynamicBuffer;
  private order: number[] = [];
  private depths = new Float64Array();
  private indexData = new Uint32Array();
  private drawGroups = new Uint32Array();
  private packed: Entry[] = [];
  private viewport!: Viewport;
  constructor(private device: Device) {}

  begin(viewport: Viewport) {
    this.viewport = viewport;
    this.visible = [];
  }

  collect(layer: SplatPrimitiveLayer, model: Model) {
    const attributes = layer.getAttributeManager()!.getAttributes();
    const ownerCount = layer.getNumInstances();
    const projectionKey = JSON.stringify([
      getSplatProjectionKey(this.viewport),
      layer.props.coordinateSystem,
      layer.props.coordinateOrigin,
      layer.props.modelMatrix
    ]);
    // GPU uploads may be deferred in a collection pass. Compare the small owner
    // pose arrays, not buffer timestamps, and keep changing optical weights separate.
    const pose: number[] = [];
    for (const [name, attribute] of Object.entries(attributes)) {
      const length = attribute.constant ? attribute.size : ownerCount * attribute.size;
      for (let i = 0; i < length; i++)
        if (name !== 'instanceWindData' || i % 7 !== 4) pose.push(attribute.value![i]);
    }
    const key = projectionKey + JSON.stringify(pose);
    let entry = this.entries.get(layer.id);
    if (!entry || entry.key !== key || entry.layer.props.source !== layer.props.source) {
      entry = this.pack(layer, model, key);
      this.entries.set(layer.id, entry);
    }
    entry.layer = layer;
    entry.model = model;
    const wind = attributes.instanceWindData.value!;
    const countPerOwner = layer.props.source.opacities.length;
    for (let owner = 0; owner < ownerCount; owner++) {
      const weight = wind[owner * 7 + 4];
      if (entry.coverageWeights[owner] === weight) continue;
      entry.coverageWeights[owner] = weight;
      entry.coverageDirty = true;
      for (
        let vertex = owner * countPerOwner * 4;
        vertex < (owner + 1) * countPerOwner * 4;
        vertex++
      ) {
        entry.coverage[vertex * 3] = weight;
        entry.coverage[vertex * 3 + 1] = wind[owner * 7 + 5];
        entry.coverage[vertex * 3 + 2] = wind[owner * 7 + 6];
      }
    }
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
        instanceColors: [
          ...layer.encodePickingColor(objectInfo.index),
          source.opticalDepths ? 1 : 0
        ],
        instanceModelMatrixCol0: matrix.slice(0, 3),
        instanceModelMatrixCol1: matrix.slice(3, 6),
        instanceModelMatrixCol2: matrix.slice(6, 9),
        instanceTranslation: matrix.slice(9, 12),
        instanceDeformation: wind.slice(0, 4)
      };
      // Copy whole attribute columns into the interleaved buffer. Avoid a temporary
      // typed-array view for every vertex/attribute during a refinement change.
      const base = cursor;
      let column = 0;
      for (const [name, size] of ATTRIBUTE_ENTRIES) {
        const constant = instance[name];
        const values = constant ?? geometry.attributes[name]!.value;
        for (let vertex = 0; vertex < countPerOwner * 4; vertex++) {
          const input = constant ? 0 : vertex * size;
          const output = base + vertex * STRIDE + column;
          for (let c = 0; c < size; c++)
            vertices[output + c] =
              name === 'splatColors'
                ? (values[input + c] * (color[c] ?? 255)) / 255
                : values[input + c];
        }
        column += size;
      }
      cursor += countPerOwner * 4 * STRIDE;
    }
    return {
      layer,
      model,
      key,
      vertices,
      owners,
      count: owners.length * countPerOwner,
      offset: 0,
      group: '',
      coverage: new Float32Array(owners.length * countPerOwner * 12),
      coverageWeights: [],
      coverageDirty: true
    };
  }

  render(target: Framebuffer, pixelRatio: number) {
    const active = new Set(this.visible.map(e => e.layer.id));
    for (const id of this.entries.keys()) if (!active.has(id)) this.entries.delete(id);
    const changed =
      this.packed.length !== this.visible.length ||
      this.visible.some((e, i) => e !== this.packed[i]);
    if (changed) {
      const previous = new Set(this.packed);
      this.packed = [...this.visible];
      const count = this.visible.reduce((sum, e) => sum + e.count, 0);
      this.order = Array.from({length: count}, (_, i) => i);
      this.depths = new Float64Array(count);
      this.indexData = new Uint32Array(count * 6);
      this.drawGroups = new Uint32Array(count);
      if (!count) return;
      // Keep model bindings stable through refinement. Only grow storage when
      // necessary, and upload owner ranges whose membership or offsets changed.
      const bytes = count * 4 * STRIDE * 4;
      let resized = false;
      if (!this.vertices) {
        this.vertices = new DynamicBuffer(this.device, {
          usage: Buffer.VERTEX | Buffer.COPY_DST,
          byteLength: Math.ceil(bytes * 1.5)
        });
        this.coverage = new DynamicBuffer(this.device, {
          usage: Buffer.VERTEX | Buffer.COPY_DST,
          byteLength: Math.ceil(count * 1.5) * 48
        });
        this.indices = new DynamicBuffer(this.device, {
          usage: Buffer.INDEX | Buffer.COPY_DST,
          indexType: 'uint32',
          byteLength: Math.ceil(count * 1.5) * 24
        });
        resized = true;
      } else if (this.vertices.byteLength < bytes) {
        this.vertices.ensureSize(Math.max(bytes, Math.ceil(this.vertices.byteLength * 1.5)));
        const capacity = Math.ceil(this.vertices.byteLength / (4 * STRIDE * 4));
        this.indices!.ensureSize(capacity * 24);
        this.coverage!.ensureSize(capacity * 48);
        resized = true;
      }
      let offset = 0;
      for (const entry of this.visible) {
        if (resized || !previous.has(entry) || entry.offset !== offset) {
          this.vertices.write(entry.vertices, offset * 4 * STRIDE * 4);
          this.coverage!.write(entry.coverage, offset * 48);
          entry.coverageDirty = false;
        }
        entry.offset = offset;
        offset += entry.count;
      }
    }
    if (!this.order.length) return;
    for (const entry of this.visible)
      if (entry.coverageDirty) {
        this.coverage!.write(entry.coverage, entry.offset * 48);
        entry.coverageDirty = false;
      }
    const groups = new Map<string, {entry: Entry; index: number; model: Model}>();
    const models: Model[] = [];
    const activeModels = new Set<string>();
    for (const entry of this.visible) {
      const uniforms = {...entry.model.shaderInputs.getUniformValues()};
      uniforms.splat = {...uniforms.splat, mode: 0, opticalDepthMode: 0};
      // Color is globally ordered; artificial deck layer offsets must not reorder it.
      uniforms.layer = {...uniforms.layer, layerIndex: 0};
      const bindings = entry.model.shaderInputs.getBindingValues();
      const shaders = entry.layer.getShaders();
      const parameters = {...entry.layer.props.parameters, ...SORTED_PARAMETERS};
      entry.group = JSON.stringify([
        uniforms,
        Object.entries(bindings).map(([k, v]) => [
          k,
          'id' in v ? v.id : 'buffer' in v ? [v.buffer.id, v.offset, v.size] : v
        ]),
        shaders.inject,
        shaders.defines,
        shaders.modules.map(m => m.name),
        Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b))
      ]);
      let group = groups.get(entry.group);
      if (!group) {
        // Uniform values change with the camera and wind. Shader/pipeline identity
        // does not; a source entering or leaving must not recompile this draw.
        const modelKey = JSON.stringify([
          shaders.vs,
          shaders.fs,
          shaders.source,
          shaders.inject,
          shaders.defines,
          shaders.modules.map(m => m.name),
          Object.entries(parameters).sort(([a], [b]) => a.localeCompare(b)),
          groups.size
        ]);
        let sortedModel = this.models.get(modelKey);
        if (!sortedModel) {
          sortedModel = new Model(this.device, {
            ...shaders,
            id: 'sorted-prepared-splats',
            vs: shaders.vs
              .replace(
                'out float vCoverageWeight;',
                'out float vCoverageWeight;\nflat out float vOpticalDepthMode;'
              )
              .replace('void main() {', 'void main() {\n  vOpticalDepthMode = instanceColors.a;')
              .replace('picking_getPickingColorFromInstanceID()', 'instanceColors.rgb')
              .replace('splatColors.rgb * instanceColors.rgb', 'splatColors.rgb')
              .replace('splatColors.a * instanceColors.a', 'splatColors.a'),
            fs: shaders.fs
              .replace(
                'in float vCoverageWeight;',
                'in float vCoverageWeight;\nflat in float vOpticalDepthMode;'
              )
              .replaceAll('splat.opticalDepthMode', 'vOpticalDepthMode'),
            source: shaders.source
              .replace(
                '@location(5) coverageWeight: f32',
                '@location(5) coverageWeight: f32,\n @location(6) @interpolate(flat) opticalDepthMode: f32'
              )
              .replace(
                ' var output: Varyings;',
                ' var output: Varyings;\n output.opticalDepthMode = attributes.instanceColors.a;'
              )
              .replaceAll('splat.opticalDepthMode', 'input.opticalDepthMode')
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
            attributes: {vertices: this.vertices!, coverage: this.coverage!},
            indexBuffer: this.indices!,
            parameters
          });
          this.models.set(modelKey, sortedModel);
        }
        // Evaluated uniforms are shared only when every shading input matches.
        sortedModel.shaderInputs.moduleUniforms = uniforms;
        sortedModel.shaderInputs.directBindings = bindings;
        group = {entry, index: groups.size, model: sortedModel};
        groups.set(entry.group, group);
        models.push(sortedModel);
        activeModels.add(modelKey);
      }
      this.drawGroups.fill(group.index, entry.offset, entry.offset + entry.count);
      this.updateDepths(entry);
    }
    for (const [key, model] of this.models)
      if (!activeModels.has(key)) {
        model.destroy();
        this.models.delete(key);
      }
    this.order.sort((a, b) => this.depths[b] - this.depths[a] || a - b);
    for (let i = 0; i < this.order.length; i++) {
      const v = this.order[i] * 4;
      const offset = i * 6;
      this.indexData[offset] = v;
      this.indexData[offset + 1] = v + 1;
      this.indexData[offset + 2] = v + 2;
      this.indexData[offset + 3] = v + 2;
      this.indexData[offset + 4] = v + 1;
      this.indexData[offset + 5] = v + 3;
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
    for (let first = 0; first < this.order.length; ) {
      const group = this.drawGroups[this.order[first]];
      let end = first + 1;
      while (end < this.order.length && this.drawGroups[this.order[end]] === group) end++;
      const model = models[group];
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
        const px = source.positions[i * 3],
          py = source.positions[i * 3 + 1],
          pz = source.positions[i * 3 + 2];
        let x = m[0] * px + m[3] * py + m[6] * pz + m[9],
          y = m[1] * px + m[4] * py + m[7] * pz + m[10];
        const z = m[2] * px + m[5] * py + m[8] * pz + m[11];
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
        const worldX = owner.common[0] + x * owner.units[0],
          worldY = owner.common[1] + y * owner.units[1],
          worldZ = owner.common[2] + z * owner.units[2];
        const clipZ =
          projection[2] * worldX +
          projection[6] * worldY +
          projection[10] * worldZ +
          projection[14];
        const clipW =
          projection[3] * worldX +
          projection[7] * worldY +
          projection[11] * worldZ +
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
    this.coverage?.destroy();
    this.entries.clear();
    this.packed = [];
    this.visible = [];
  }
}
