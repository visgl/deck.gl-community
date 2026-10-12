// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {ScatterplotLayer, type ScatterplotLayerProps} from '@deck.gl/layers';
import type {Accessor, DefaultProps} from '@deck.gl/core';
import type {SymbolMark} from './interfaces';

type SymbolProps = {
  getAngle?: Accessor<SymbolMark, number>;
  getShape?: Accessor<SymbolMark, number>;
};

/** One instanced glyph morphs circle/square shape without fading positional counterparts. */
export class SymbolLayer extends ScatterplotLayer<SymbolMark, SymbolProps> {
  static layerName = 'SymbolLayer';
  static defaultProps: DefaultProps<SymbolProps & ScatterplotLayerProps<SymbolMark>> = {
    getAngle: {type: 'accessor', value: 0},
    getShape: {type: 'accessor', value: 0}
  };

  initializeState() {
    super.initializeState();
    this.getAttributeManager().addInstanced({
      instanceAngles: {size: 1, accessor: 'getAngle', transition: true},
      instanceShapes: {size: 1, accessor: 'getShape', transition: true}
    });
  }

  getShaders() {
    const shaders = super.getShaders();
    if (!shaders.fs.includes('length(unitPosition)')) {
      throw new Error('SymbolLayer requires the deck.gl 9.4 ScatterplotLayer shader.');
    }
    return {
      ...shaders,
      // The containing quad and picking are native ScatterplotLayer; interpolate circle/square distance.
      fs: shaders.fs.replace(
        'length(unitPosition)',
        'mix(length(unitPosition), max(abs(unitPosition.x), abs(unitPosition.y)), vSymbolShape)'
      ),
      inject: {
        ...shaders.inject,
        'vs:#decl': 'in float instanceAngles; in float instanceShapes; out float vSymbolShape;',
        'vs:#main-start': 'vSymbolShape = instanceShapes;',
        'fs:#decl': 'in float vSymbolShape;',
        'vs:DECKGL_FILTER_SIZE': `
          float c = cos(instanceAngles);
          float s = sin(instanceAngles);
          size.xy = mat2(c, s, -s, c) * size.xy;
        `
      }
    };
  }
}
