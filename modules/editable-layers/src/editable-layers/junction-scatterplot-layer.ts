// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {CompositeLayer, CompositeLayerProps, DefaultProps} from '@deck.gl/core';
import {ScatterplotLayer, ScatterplotLayerProps} from '@deck.gl/layers';

import {Color} from '../utils/types';

type JunctionScatterplotLayerProps = CompositeLayerProps &
  Omit<ScatterplotLayerProps, 'getFillColor'> & {
    getFillColor?: Color | ((d) => Color);
    getStrokeColor?: Color | ((d) => Color);
    getInnerRadius?: number | ((d) => number);
  };

export class JunctionScatterplotLayer extends CompositeLayer<JunctionScatterplotLayerProps> {
  static layerName = 'JunctionScatterplotLayer';
  static defaultProps: DefaultProps<JunctionScatterplotLayerProps> = {
    ...ScatterplotLayer.defaultProps,
    getFillColor: (d) => [0, 0, 0, 255],
    getStrokeColor: (d) => [255, 255, 255, 255],
    getInnerRadius: (d) => 1
  };

  renderLayers() {
    const {id, getFillColor, getStrokeColor, getInnerRadius, updateTriggers} = this.props;

    // data needs to be passed explicitly after deck.gl 5.3
    return [
      // the full circles
      new ScatterplotLayer<any>({
        ...this.props,
        id: `${id}-full`,
        data: this.props.data as any,
        getLineColor: getStrokeColor,
        updateTriggers: {
          ...updateTriggers,
          getStrokeColor: updateTriggers.getStrokeColor
        }
      }), // the inner part
      new ScatterplotLayer<any>({
        ...this.props,
        id: `${id}-inner`,
        data: this.props.data as any,
        getFillColor,
        getRadius: getInnerRadius,
        pickable: false,
        updateTriggers: {
          ...updateTriggers,
          getFillColor: updateTriggers.getFillColor,
          getRadius: updateTriggers.getInnerRadius
        }
      })
    ];
  }
}
