// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {ScatterplotLayer, type ScatterplotLayerProps} from '@deck.gl/layers';
import type {Accessor, DefaultProps} from '@deck.gl/core';
import type {Polygon} from './interfaces';

type SquareProps = {getAngle?: Accessor<Polygon, number>; extruded?: boolean};

/** Instanced squares retain their mesh while GPU radius transitions shrink them to zero. */
export class SquareSymbolLayer extends ScatterplotLayer<Polygon, SquareProps> {
  static layerName = 'SquareSymbolLayer';
  static defaultProps: DefaultProps<SquareProps & ScatterplotLayerProps<Polygon>> = {
    getAngle: {type: 'accessor', value: 0},
    extruded: false
  };

  initializeState() {
    super.initializeState();
    this.getAttributeManager().addInstanced({
      instanceAngles: {size: 1, accessor: 'getAngle', transition: true}
    });
  }

  getShaders() {
    const shaders = super.getShaders();
    if (!shaders.fs.includes('length(unitPosition)')) {
      throw new Error('SquareSymbolLayer requires the deck.gl 9.4 ScatterplotLayer shader.');
    }
    return {
      ...shaders,
      // The containing quad and picking are native ScatterplotLayer; use square distance.
      fs: shaders.fs.replace(
        'length(unitPosition)',
        'max(abs(unitPosition.x), abs(unitPosition.y))'
      ),
      inject: {
        ...shaders.inject,
        'vs:#decl': 'in float instanceAngles;',
        'vs:DECKGL_FILTER_SIZE': `
          float c = cos(instanceAngles);
          float s = sin(instanceAngles);
          size.xy = mat2(c, s, -s, c) * size.xy;
        `
      }
    };
  }
}
