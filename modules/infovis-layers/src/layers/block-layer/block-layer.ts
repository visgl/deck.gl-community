// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {
  Accessor,
  AccessorFunction,
  color,
  Color,
  DefaultProps,
  Layer,
  LayerDataSource,
  LayerProps,
  picking,
  Position,
  project32,
  UNIT,
  Unit,
  UpdateParameters
} from '@deck.gl/core';
import {Geometry, Model} from '@luma.gl/engine';

import fs from './block-layer-fragment.glsl';
import {BlockProps, blockUniforms} from './block-layer-uniforms';
import vs from './block-layer-vertex.glsl';

const DEFAULT_COLOR: [number, number, number, number] = [0, 0, 0, 255];

const defaultProps: DefaultProps<BlockLayerProps> = {
  sizeUnits: 'meters',
  widthMinPixels: {type: 'number', min: 0, value: 0},
  heightMinPixels: {type: 'number', min: 0, value: 0},
  sizeMaxPixels: {type: 'number', min: 0, value: Number.MAX_SAFE_INTEGER},

  lineWidthUnits: 'pixels',

  getPosition: {type: 'accessor', value: (x: any) => x.position},
  getSize: {type: 'accessor', value: [10, 10]},
  getLineWidth: {type: 'accessor', value: 1},
  getFillColor: {type: 'accessor', value: DEFAULT_COLOR},
  getLineColor: {type: 'accessor', value: DEFAULT_COLOR}
};

/** Properties supported by {@link BlockLayer}. */
export type BlockLayerProps<DataT = unknown> = _BlockLayerProps<DataT> & LayerProps;

/** Properties added by BlockLayer. */
type _BlockLayerProps<DataT> = {
  /** Data objects rendered as rectangular blocks. */
  data: LayerDataSource<DataT>;
  /**
   * The units of the block size, one of `'meters'`, `'common'`, and `'pixels'`.
   * @defaultValue 'meters'
   */
  sizeUnits?: Unit;

  /**
   * The minimum width in pixels. This prop can be used to prevent the block from getting too small when zoomed out.
   * @defaultValue 0
   */
  widthMinPixels?: number;
  /**
   * The minimum height in pixels. This prop can be used to prevent the block from getting too small when zoomed out.
   * @defaultValue 0
   */
  heightMinPixels?: number;
  /**
   * The maximum width or height in pixels. This prop can be used to prevent the block from getting too big when zoomed in.
   * @defaultValue Number.MAX_SAFE_INTEGER
   */
  sizeMaxPixels?: number;

  /**
   * The units of the stroke width, one of `'meters'`, `'common'`, and `'pixels'`.
   * @defaultValue 'pixels'
   */
  lineWidthUnits?: Unit;

  /**
   * The outline width of each object.
   * @defaultValue 1
   */
  getLineWidth?: Accessor<DataT, number>;

  /**
   * Method called to retrieve the position of each object.
   * @defaultValue object => object.position
   */
  getPosition?: AccessorFunction<DataT, Position>;
  /** Width and height of each block. @defaultValue [10, 10] */
  getSize?: Accessor<DataT, [number, number]>;
  /**
   * The rgba color is in the format of `[r, g, b, [a]]`
   * @defaultValue [0, 0, 0, 255]
   */
  getLineColor?: Accessor<DataT, Color>;
  /**
   * The rgba color is in the format of `[r, g, b, [a]]`
   * @defaultValue [0, 0, 0, 255]
   */
  getFillColor?: Accessor<DataT, Color>;
};

/** Renders axis-aligned rectangular blocks with fill and outline colors. */
export class BlockLayer<DataT = any, ExtraPropsT extends {} = {}> extends Layer<
  ExtraPropsT & Required<_BlockLayerProps<DataT>>
> {
  static override layerName = 'BlockLayer';
  static override defaultProps = defaultProps;

  override state: {
    model?: Model;
  } = {};

  override getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [project32, color, picking, blockUniforms]
    });
  }

  initializeState() {
    this.getAttributeManager()!.addInstanced({
      instancePositions: {
        size: 3,
        type: 'float64',
        fp64: this.use64bitPositions(),
        transition: true,
        accessor: 'getPosition'
      },
      instanceSizes: {
        size: 2,
        transition: true,
        accessor: 'getSize'
      },
      instanceLineWidths: {
        size: 1,
        transition: true,
        accessor: 'getLineWidth'
      },
      instanceLineColors: {
        size: this.props.colorFormat.length,
        type: 'unorm8',
        transition: true,
        accessor: 'getLineColor',
        defaultValue: DEFAULT_COLOR
      },
      instanceFillColors: {
        size: this.props.colorFormat.length,
        type: 'unorm8',
        transition: true,
        accessor: 'getFillColor',
        defaultValue: DEFAULT_COLOR
      }
    });
  }

  override updateState(params: UpdateParameters<this>): void {
    const {changeFlags} = params;
    super.updateState(params);
    if (changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.state.model = this._getModel();
      this.getAttributeManager()!.invalidateAll();
    }
  }

  override draw() {
    const {sizeUnits, widthMinPixels, heightMinPixels, sizeMaxPixels, lineWidthUnits} = this.props;
    const model = this.state.model!;
    const blockProps: BlockProps = {
      sizeUnits: UNIT[sizeUnits],
      widthMinPixels,
      heightMinPixels,
      sizeMaxPixels,
      lineWidthUnits: UNIT[lineWidthUnits]
    };
    model.shaderInputs.setProps({block: blockProps});
    model.draw(this.context.renderPass);
  }

  protected _getModel(): Model {
    // a square
    const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0];
    return new Model(this.context.device, {
      ...this.getShaders(),
      id: this.props.id,
      bufferLayout: this.getAttributeManager()!.getBufferLayouts(),
      geometry: new Geometry({
        topology: 'triangle-strip',
        attributes: {
          positions: new Float32Array(positions)
        }
      }),
      isInstanced: true
    });
  }
}
