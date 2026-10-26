// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {
  Layer,
  picking,
  project32,
  type Color,
  type DefaultProps,
  type LayerProps,
  type Position,
  type UpdateParameters,
  type Viewport
} from '@deck.gl/core';
import {Buffer, Texture} from '@luma.gl/core';
import {Model} from '@luma.gl/engine';
import {getSplatCapture, type SplatCapture} from './splat-capture';
import {SplatCaptureSorter} from './splat-capture-sort';
import {
  SPLAT_CAPTURE_FRAGMENT,
  SPLAT_CAPTURE_QUADS_PER_INSTANCE,
  SPLAT_CAPTURE_VERTEX,
  splatCaptureUniforms
} from './splat-capture-shaders';
import {getSplatCommonUnits} from './splat-culling';
import {getSplatTangentFrame} from './splat-globe';
import type {SplatSource} from './splat-source';

// Premultiplied back-to-front "over"; Gaussians test the scene's depth but write none.
const CAPTURE_PARAMETERS = {
  blend: true,
  blendColorOperation: 'add',
  blendColorSrcFactor: 'one',
  blendColorDstFactor: 'one-minus-src-alpha',
  blendAlphaOperation: 'add',
  blendAlphaSrcFactor: 'one',
  blendAlphaDstFactor: 'one-minus-src-alpha',
  depthWriteEnabled: false,
  depthCompare: 'less-equal',
  cullMode: 'none'
} as const;
const IDENTITY_FRAME = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Width of the draw-order texture, in Gaussians. */
const ORDER_WIDTH = 4096;
/** Two triangles per quad, numbered so a vertex's ID gives its quad and corner. */
const QUAD_INDICES = new Uint16Array(SPLAT_CAPTURE_QUADS_PER_INSTANCE * 6).map(
  (_, i) => Math.floor(i / 6) * 4 + [0, 1, 2, 2, 1, 3][i % 6]
);
const IDENTITY_TRANSFORM = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export type SplatCaptureLayerProps = LayerProps & {
  /** The owning row, returned by picking. */
  data: unknown[];
  source: SplatSource;
  /** Anchor in the layer's coordinate system; the capture's metres point east, north and up of it. */
  anchor?: Position;
  /** Source-local affine pose: a 3x3 column-major matrix, then a translation in metres. */
  transform?: number[];
  /** RGBA tint; alpha multiplies opacity. */
  tint?: Color;
  /** Draw at most this many Gaussians: the most important in view. */
  maxSplats?: number;
  kernelVariance?: number;
  alphaCutoff?: number;
  support?: number;
};

const defaultProps: DefaultProps<SplatCaptureLayerProps> = {
  data: {type: 'data', value: [], async: false},
  source: null,
  anchor: {type: 'array', value: [0, 0, 0], compare: true},
  transform: {type: 'array', value: IDENTITY_TRANSFORM, compare: true},
  tint: {type: 'color', value: [255, 255, 255, 255]},
  maxSplats: Infinity,
  kernelVariance: 0.3,
  alphaCutoff: 1 / 255,
  support: 3
};

/**
 * One scan drawn as depth-sorted instanced quads: the Gaussians live in a data texture, a worker
 * re-sorts their indices when the camera moves, and each frame draws the latest order.
 */
export class SplatCaptureLayer extends Layer<Required<SplatCaptureLayerProps>> {
  static layerName = 'SplatCaptureLayer';
  static defaultProps = defaultProps;
  declare state: {
    capture?: SplatCapture;
    texture?: Texture;
    harmonics?: Texture;
    indices?: Buffer;
    order?: Texture;
    model?: Model;
    sorter?: SplatCaptureSorter;
    /** Gaussians in the order buffer. */
    count: number;
    /** The last requested sort. */
    matrix?: Float64Array;
    budget: number;
    support?: number;
  };

  initializeState() {
    this.state = {count: 0, budget: 0};
  }

  getShaders() {
    return super.getShaders({
      vs: SPLAT_CAPTURE_VERTEX,
      fs: SPLAT_CAPTURE_FRAGMENT,
      modules: [project32, picking, splatCaptureUniforms]
    });
  }

  get isLoaded(): boolean {
    return super.isLoaded && (this.state.sorter?.settled ?? false);
  }

  /** Gaussians drawn by the latest order. */
  get drawnSplats(): number {
    return this.state.count;
  }

  updateState(params: UpdateParameters<this>) {
    super.updateState(params);
    if (params.props.source !== params.oldProps.source || params.changeFlags.extensionsChanged)
      this.build();
  }

  finalizeState(context: Parameters<Layer['finalizeState']>[0]) {
    super.finalizeState(context);
    this.release();
  }

  draw({shaderModuleProps, renderPass}) {
    const {model, capture} = this.state;
    if (!model || !capture) return;
    const pickingActive = shaderModuleProps.picking?.isActive;
    const {clipMatrix, cameraPosition} = this.getProjection(shaderModuleProps.project.viewport);
    if (!pickingActive) this.requestSort(clipMatrix);
    if (!this.state.count) return;
    const {tint, kernelVariance, alphaCutoff, support} = this.props;
    model.shaderInputs.setProps({
      splatCapture: {
        clipMatrix: Array.from(clipMatrix),
        cameraPosition,
        tint: [0, 1, 2, 3].map(channel => (tint[channel] ?? 255) / 255),
        count: this.state.count,
        shDegree: capture.shDegree,
        shTexels: capture.shTexels,
        pickingColor: this.encodePickingColor(0),
        kernelVariance,
        alphaCutoff,
        support,
        antialiased: capture.antialiased ? 1 : 0
      }
    });
    model.setInstanceCount(Math.ceil(this.state.count / SPLAT_CAPTURE_QUADS_PER_INSTANCE));
    // deck.gl applies the layer's parameters just before draw; the sorted blend goes on top.
    if (!pickingActive) model.setParameters({...model.parameters, ...CAPTURE_PARAMETERS});
    model.draw(renderPass);
  }

  private build() {
    this.release();
    const {device} = this.context;
    if (device.type !== 'webgl')
      throw new Error('SplatLayer draws captures with WebGL2 only for now.');
    const capture = getSplatCapture(this.props.source, device.limits.maxTextureDimension2D);
    const texture = device.createTexture({
      id: `${this.id}-splats`,
      format: 'rgba32uint',
      width: capture.width,
      height: capture.height,
      mipLevels: 1,
      usage: Texture.SAMPLE | Texture.COPY_DST,
      // shaders fetch exact texels; integer textures cannot filter
      sampler: {minFilter: 'nearest', magFilter: 'nearest'}
    });
    texture.writeData(capture.data);
    // a 1x1 stand-in keeps the binding valid without higher bands
    const harmonics = device.createTexture({
      id: `${this.id}-harmonics`,
      format: 'rgba32uint',
      width: capture.sh ? capture.shWidth : 1,
      height: capture.sh ? capture.shHeight : 1,
      mipLevels: 1,
      usage: Texture.SAMPLE | Texture.COPY_DST,
      sampler: {minFilter: 'nearest', magFilter: 'nearest'}
    });
    harmonics.writeData(capture.sh ?? new Uint32Array(4));
    const indices = device.createBuffer({
      usage: Buffer.INDEX,
      indexType: 'uint16',
      data: QUAD_INDICES
    });
    const order = device.createTexture({
      id: `${this.id}-order`,
      format: 'r32uint',
      width: ORDER_WIDTH,
      height: Math.max(1, Math.ceil(capture.count / ORDER_WIDTH)),
      mipLevels: 1,
      usage: Texture.SAMPLE | Texture.COPY_DST,
      sampler: {minFilter: 'nearest', magFilter: 'nearest'}
    });
    const model = new Model(device, {
      ...this.getShaders(),
      id: `${this.id}-capture`,
      bufferLayout: [],
      attributes: {},
      indexBuffer: indices,
      bindings: {splatData: texture, splatOrder: order, splatHarmonics: harmonics},
      topology: 'triangle-list',
      isInstanced: true,
      instanceCount: 0,
      parameters: CAPTURE_PARAMETERS
    });
    const sorter = new SplatCaptureSorter(
      capture.bounds,
      (sorted, count) => (this.getCurrentLayer() as this | null)?.receiveOrder(sorted, count),
      ORDER_WIDTH
    );
    this.setState({
      capture,
      texture,
      harmonics,
      indices,
      order,
      model,
      sorter,
      count: 0,
      matrix: undefined
    });
  }

  private release() {
    const {model, texture, harmonics, indices, order, sorter} = this.state;
    sorter?.destroy();
    model?.destroy();
    texture?.destroy();
    harmonics?.destroy();
    indices?.destroy();
    order?.destroy();
    this.state.model = undefined;
    this.state.sorter = undefined;
    this.state.count = 0;
  }

  private receiveOrder(sorted: Uint32Array, count: number) {
    const {order, sorter} = this.state;
    if (!order) return;
    // whole rows: the sorter pads each order to the texture width
    const rows = Math.ceil(count / ORDER_WIDTH);
    if (rows)
      order.writeData(sorted.subarray(0, rows * ORDER_WIDTH), {width: ORDER_WIDTH, height: rows});
    this.state.count = count;
    sorter?.recycle(sorted);
    this.setNeedsRedraw();
  }

  /** Sort again when the capture-to-clip transform or the budget changes. */
  private requestSort(matrix: Float64Array) {
    const {capture, sorter} = this.state;
    if (!capture || !sorter) return;
    const budget = Math.min(capture.count, this.props.maxSplats);
    const {support} = this.props;
    const previous = this.state.matrix;
    if (
      previous &&
      budget === this.state.budget &&
      support === this.state.support &&
      matrix.every((v, i) => v === previous[i])
    )
      return;
    this.state.matrix = matrix;
    this.state.budget = budget;
    this.state.support = support;
    sorter.sort(matrix, budget, support);
  }

  /**
   * Capture metres to clip space, composed in double precision: the vertex shader's only transform.
   * Also the camera in capture metres, for the view-dependent colour.
   */
  private getProjection(viewport: Viewport): {clipMatrix: Float64Array; cameraPosition: number[]} {
    const {anchor, transform: t} = this.props;
    const common = this.projectPosition([anchor[0], anchor[1], anchor[2] ?? 0], {
      viewport,
      autoOffset: false
    });
    const units = getSplatCommonUnits(common, viewport);
    const frame = getSplatTangentFrame(common, viewport) ?? IDENTITY_FRAME;
    // frame * diag(units): a capture metre along each axis, in common space
    const axes = [0, 1, 2].map(axis =>
      frame.slice(axis * 3, axis * 3 + 3).map(v => v * units[axis])
    );
    const toCommon = (x: number, y: number, z: number) =>
      [0, 1, 2].map(row => axes[0][row] * x + axes[1][row] * y + axes[2][row] * z);
    // columns of the capture-to-common affine map
    const linear = [0, 1, 2].map(column =>
      toCommon(t[column * 3], t[column * 3 + 1], t[column * 3 + 2])
    );
    const shift = toCommon(t[9], t[10], t[11]);
    const origin = [0, 1, 2].map(axis => common[axis] + shift[axis]);
    const local = new Float64Array(16);
    for (let column = 0; column < 3; column++) local.set(linear[column], column * 4);
    local.set([...origin, 1], 12);
    const projection = viewport.viewProjectionMatrix;
    const clipMatrix = new Float64Array(16);
    for (let column = 0; column < 4; column++)
      for (let row = 0; row < 4; row++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += projection[k * 4 + row] * local[column * 4 + k];
        clipMatrix[column * 4 + row] = sum;
      }
    const camera = viewport.cameraPosition;
    return {
      clipMatrix,
      cameraPosition: solve3(
        linear,
        [0, 1, 2].map(axis => camera[axis] - origin[axis])
      )
    };
  }
}

/** x with columns[0] * x0 + columns[1] * x1 + columns[2] * x2 = b, by Cramer's rule. */
function solve3(columns: number[][], b: number[]): number[] {
  const [a, c, e] = columns;
  const det = (u: number[], v: number[], w: number[]) =>
    u[0] * (v[1] * w[2] - v[2] * w[1]) -
    v[0] * (u[1] * w[2] - u[2] * w[1]) +
    w[0] * (u[1] * v[2] - u[2] * v[1]);
  const d = det(a, c, e) || 1;
  return [det(b, c, e) / d, det(a, b, e) / d, det(a, c, b) / d];
}
