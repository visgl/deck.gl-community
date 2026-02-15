// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
// Ported from https://github.com/ubilabs/outlined-path-layer (MIT license)

import type {Accessor, Color, DefaultProps, Unit} from '@deck.gl/core';
import {UNIT} from '@deck.gl/core';
import type {PathLayerProps} from '@deck.gl/layers';
import {PathLayer} from '@deck.gl/layers';
import {outlinedPathUniforms} from './outlined-path-uniforms';

import {fs} from './outlined-path-layer-fragment.glsl';
import {vs} from './outlined-path-layer-vertex.glsl';

export type OutlinedPathLayerProps<DataT = unknown> = PathLayerProps<DataT> & {
  /**
   * The rgba color of the outline in the format of `[r, g, b, [a]]`.
   * @default [0, 0, 0, 255]
   */
  getOutlineColor?: Accessor<DataT, Color>;
  /**
   * Width of each object's outline.
   * @default 0
   */
  getOutlineWidth?: Accessor<DataT, number>;
  /**
   * The units of the outline width, one of `'meters'`, `'common'`, and `'pixels'`.
   * @default 'pixels'
   */
  outlineWidthUnits?: Unit;
  /**
   * The minimum outline width in pixels.
   * @default 0
   */
  outlineMinPixels?: number;
  /**
   * The maximum outline width in pixels.
   * @default Number.MAX_SAFE_INTEGER
   */
  outlineMaxPixels?: number;
};

const defaultProps: DefaultProps<OutlinedPathLayerProps> = {
  ...PathLayer.defaultProps,
  getOutlineColor: {type: 'accessor', value: [0, 0, 0, 255]},
  getOutlineWidth: {type: 'accessor', value: 0},
  outlineWidthUnits: 'pixels',
  outlineMinPixels: {type: 'number', min: 0, value: 0},
  outlineMaxPixels: {type: 'number', min: 0, value: Number.MAX_SAFE_INTEGER}
};

export class OutlinedPathLayer<
  DataT = any,
  ExtraPropsT = Record<string, unknown>
> extends PathLayer<DataT, ExtraPropsT & Required<OutlinedPathLayerProps<DataT>>> {
  static layerName = 'OutlinedPathLayer';

  static defaultProps = defaultProps;

  getShaders() {
    const shaders = super.getShaders();

    return {
      ...shaders,
      vs,
      fs,
      modules: [...shaders.modules, outlinedPathUniforms]
    };
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager().addInstanced({
      instanceOutlineColors: {
        size: this.props.colorFormat.length,
        type: 'unorm8',
        transition: true,
        accessor: 'getOutlineColor',
        defaultValue: [0, 0, 0, 255]
      },
      instanceOutlineWidths: {
        size: 1,
        transition: true,
        accessor: 'getOutlineWidth',
        defaultValue: 0
      }
    });
  }

  draw({uniforms}: {uniforms: Record<string, unknown>}) {
    const {outlineWidthUnits, outlineMinPixels, outlineMaxPixels} = this.props;

    this.state.model.shaderInputs.setProps({
      outline: {
        outlineWidthUnits: UNIT[outlineWidthUnits],
        outlineMinPixels,
        outlineMaxPixels
      }
    });

    super.draw({uniforms});
  }
}
