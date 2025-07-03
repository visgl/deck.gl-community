// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {DefaultProps, LayerProps, Color, LayerDataSource, Accessor} from '@deck.gl/core';
import {CompositeLayer} from '@deck.gl/core';
import {SolidPolygonLayer} from '@deck.gl/layers';
import {HorizonGraphLayer} from './horizon-graph-layer';

export type _MultiHorizonGraphLayerProps<DataT> = {
  data: LayerDataSource<DataT>;
  getSeries: Accessor<DataT, number[] | Float32Array>;
  getScale: Accessor<DataT, number>;

  bands?: number;

  positiveColor?: Color;
  negativeColor?: Color;

  dividerColor?: Color;
  dividerWidth?: number;

  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

export type MultiHorizonGraphLayerProps<DataT = unknown> = _MultiHorizonGraphLayerProps<DataT> &
  LayerProps;

const defaultProps: DefaultProps<MultiHorizonGraphLayerProps> = {
  getSeries: {type: 'accessor', value: (series: any) => series.values},
  getScale: {type: 'accessor', value: (series: any) => series.scale},

  bands: {type: 'number', value: 2},

  positiveColor: {type: 'color', value: [0, 128, 0]},
  negativeColor: {type: 'color', value: [0, 0, 255]},

  dividerColor: {type: 'color', value: [0, 0, 0]},
  dividerWidth: {type: 'number', value: 2},

  x: {type: 'number', value: 0},
  y: {type: 'number', value: 0},
  width: {type: 'number', value: 800},
  height: {type: 'number', value: 300}
};

export class MultiHorizonGraphLayer<DataT = any, ExtraProps extends {} = {}> extends CompositeLayer<
  ExtraProps & Required<_MultiHorizonGraphLayerProps<DataT>>
> {
  static layerName = 'MultiHorizonGraphLayer';
  static defaultProps = defaultProps;

  renderLayers() {
    const {
      data,
      getSeries,
      getScale,
      bands,
      positiveColor,
      negativeColor,
      dividerColor,
      dividerWidth,
      x,
      y,
      width,
      height
    } = this.props;

    const seriesCount = (data as any).length;

    if (!seriesCount) {
      return [];
    }

    // Calculate layout dimensions
    const totalDividerSpace = dividerWidth * (seriesCount + 1);
    const availableHeight = height - totalDividerSpace;
    const seriesHeight = availableHeight / seriesCount;

    const layers = [];

    // Create divider rectangles
    if (dividerWidth > 0) {
      const dividerData = [];

      // Top divider
      dividerData.push({
        polygon: [
          [x, y],
          [x + width, y],
          [x + width, y + dividerWidth],
          [x, y + dividerWidth]
        ]
      });

      // Dividers between series
      for (let i = 0; i < seriesCount - 1; i++) {
        const dividerY = y + dividerWidth + (i + 1) * seriesHeight + i * dividerWidth;
        dividerData.push({
          polygon: [
            [x, dividerY],
            [x + width, dividerY],
            [x + width, dividerY + dividerWidth],
            [x, dividerY + dividerWidth]
          ]
        });
      }

      // Bottom divider
      const bottomDividerY = y + height - dividerWidth;
      dividerData.push({
        polygon: [
          [x, bottomDividerY],
          [x + width, bottomDividerY],
          [x + width, y + height],
          [x, y + height]
        ]
      });

      layers.push(
        new SolidPolygonLayer({
          id: `${this.props.id}-dividers`,
          data: dividerData,
          getPolygon: (d: any) => d.polygon,
          getFillColor: dividerColor,
          pickable: false
        })
      );
    }

    // Create horizon graph layers for each series
    (data as any).forEach((series, index) => {
      const seriesData = (getSeries as any)(series);

      if (!seriesData || seriesData.length === 0) {
        return;
      }

      const seriesY = y + dividerWidth + index * (seriesHeight + dividerWidth);

      const yAxisScale = (getScale as any)(series);

      layers.push(
        new HorizonGraphLayer({
          id: `${this.props.id}-series-${index}`,
          data: seriesData,
          yAxisScale,
          bands,
          positiveColor,
          negativeColor,
          x,
          y: seriesY,
          width,
          height: seriesHeight
        })
      );
    });

    return layers;
  }
}
