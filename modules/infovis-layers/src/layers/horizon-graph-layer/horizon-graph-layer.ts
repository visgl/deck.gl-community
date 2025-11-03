// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {DefaultProps, LayerProps, Color, LayerContext, UpdateParameters} from '@deck.gl/core';
import {Layer, project32} from '@deck.gl/core';
import {Model, Geometry} from '@luma.gl/engine';
import vs from './horizon-graph-layer.vs';
import fs from './horizon-graph-layer.fs';
import {Texture} from '@luma.gl/core';
import {horizonLayerUniforms} from './horizon-graph-layer-uniforms';

export type _HorizonGraphLayerProps = {
  data: number[] | Float32Array;

  yAxisScale?: number;

  bands?: number;

  positiveColor?: Color;
  negativeColor?: Color;

  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type HorizonGraphLayerProps = _HorizonGraphLayerProps & LayerProps;

const defaultProps: DefaultProps<HorizonGraphLayerProps> = {
  yAxisScale: {type: 'number', value: 1000},

  bands: {type: 'number', value: 2},

  positiveColor: {type: 'color', value: [0, 128, 0]},
  negativeColor: {type: 'color', value: [0, 0, 255]},

  x: {type: 'number', value: 0},
  y: {type: 'number', value: 0},
  width: {type: 'number', value: 800},
  height: {type: 'number', value: 300}
};

export class HorizonGraphLayer<ExtraProps extends {} = {}> extends Layer<
  ExtraProps & Required<_HorizonGraphLayerProps>
> {
  static layerName = 'HorizonGraphLayer';
  static defaultProps = defaultProps;

  state: {
    model?: Model;
    dataTexture?: Texture;
    dataTextureSize?: number;
    dataTextureCount?: number;
  } = {};

  initializeState() {
    this.state = {};
  }

  getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [project32, horizonLayerUniforms]
    });
  }

  _createDataTexture(seriesData: Float32Array | number[]): {
    dataTexture: Texture;
    dataTextureSize: number;
    dataTextureCount: number;
  } {
    const _data = seriesData instanceof Float32Array ? seriesData : new Float32Array(seriesData);

    const {device} = this.context;
    const count = _data.length;

    let dataTextureSize = 32;
    while (count > dataTextureSize * dataTextureSize) {
      dataTextureSize *= 2;
    }

    // TODO: use the right way to only submit the minimum amount of data
    const data = new Float32Array(dataTextureSize * dataTextureSize);
    data.set(_data, 0);

    return {
      dataTexture: device.createTexture({
        data,
        format: 'r32float',
        dimension: '2d',
        width: dataTextureSize,
        height: dataTextureSize,
        sampler: {
          minFilter: 'nearest',
          magFilter: 'nearest',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge'
        }
      }),
      dataTextureSize,
      dataTextureCount: count
    };
  }

  _createModel() {
    const {x, y, width, height} = this.props;

    // Create a rectangle using triangle strip (4 vertices)
    // Order: bottom-left, bottom-right, top-left, top-right
    const positions = [
      x,
      y,
      0.0,

      x + width,
      y,
      0.0,

      x,
      y + height,
      0.0,

      x + width,
      y + height,
      0.0
    ];

    const uv = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0];

    const geometry = new Geometry({
      topology: 'triangle-strip',
      attributes: {
        positions: {value: new Float32Array(positions), size: 3},
        uv: {value: new Float32Array(uv), size: 2}
      }
    });

    return new Model(this.context.device, {
      ...this.getShaders(),
      geometry,
      bufferLayout: this.getAttributeManager().getBufferLayouts()
    });
  }

  updateState(params: UpdateParameters<Layer<ExtraProps & Required<_HorizonGraphLayerProps>>>) {
    super.updateState(params);

    const {changeFlags} = params;

    if (changeFlags.dataChanged) {
      this.state.dataTexture?.destroy();
      this.setState(this._createDataTexture(this.props.data));
    }

    if (changeFlags.extensionsChanged || changeFlags.propsChanged) {
      this.state.model?.destroy();
      this.setState({model: this._createModel()});
    }
  }

  draw() {
    const {model, dataTexture} = this.state;

    if (!model) {
      this.setState({model: this._createModel()});
      return;
    }

    if (!dataTexture) {
      this.setState(this._createDataTexture(this.props.data));
      return;
    }

    const {bands, yAxisScale, positiveColor, negativeColor} = this.props;

    model.shaderInputs.setProps({
      dataTexture: this.state.dataTexture,
      horizonLayer: {
        dataTextureSize: this.state.dataTextureSize,
        dataTextureSizeInv: 1.0 / this.state.dataTextureSize,
        dataTextureCount: this.state.dataTextureCount,

        bands,
        bandsInv: 1.0 / bands,
        yAxisScaleInv: 1.0 / yAxisScale,

        positiveColor: positiveColor.map((c) => c / 255),
        negativeColor: negativeColor.map((c) => c / 255)
      }
    });
    model.draw(this.context.renderPass);
  }

  finalizeState(context: LayerContext): void {
    this.state.model?.destroy();
    this.state.dataTexture?.destroy();
    super.finalizeState(context);
  }
}
