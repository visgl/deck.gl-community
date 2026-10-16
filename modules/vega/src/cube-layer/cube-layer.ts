// Copyright (c) 2015 - 2017 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

// Adapted from https://github.com/uber/deck.gl/blob/5.3-release/modules/layers/src/grid-cell-layer/grid-cell-layer.js

import {
  Layer,
  project32,
  gouraudMaterial,
  picking,
  type LayerProps,
  type UpdateParameters
} from '@deck.gl/core';
import {CubeGeometry, Model} from '@luma.gl/engine';
import type {ShaderModule} from '@luma.gl/shadertools';
import fs from './cube-layer-fragment-shader';
import vs from './cube-layer-vertex-shader';
import type {Cube} from '../interfaces';
import type {LinearInterpolator_Class} from '../deck.gl-classes/linear-interpolator';

export interface CubeLayerInterpolatedProps {
  lightingMix: number;
}
export type CubeLayerProps = LayerProps &
  CubeLayerInterpolatedProps & {
    data: Cube[];
    getColor?: (cube: Cube) => number[];
    getSize?: (cube: Cube) => number[];
    getPosition?: (cube: Cube) => number[];
    material?: any;
    interpolator?: LinearInterpolator_Class<CubeLayerInterpolatedProps>;
  };
const CUBE_UNIFORMS: ShaderModule = {
  name: 'cube',
  vs: 'uniform cubeUniforms { float lightingMix; } cube;',
  uniformTypes: {lightingMix: 'f32'}
};
export class CubeLayer extends Layer<CubeLayerProps> {
  static layerName = 'CubeLayer';
  static defaultProps = {
    lightingMix: 0.5,
    getSize: {type: 'accessor', value: (cube: Cube) => cube.size},
    getPosition: {type: 'accessor', value: (cube: Cube) => cube.position},
    getColor: {type: 'accessor', value: (cube: Cube) => cube.color},
    material: {ambient: 0.5, diffuse: 1}
  };
  declare state: {model?: Model};
  getShaders() {
    return super.getShaders({
      vs,
      fs,
      modules: [CUBE_UNIFORMS, project32, gouraudMaterial, picking]
    });
  }
  initializeState() {
    this.getAttributeManager().addInstanced({
      instancePositions: {size: 3, type: 'float64', transition: true, accessor: 'getPosition'},
      instanceSizes: {size: 3, transition: true, accessor: 'getSize'},
      instanceColors: {
        size: 4,
        type: 'uint8',
        transition: true,
        accessor: 'getColor',
        defaultValue: [255, 0, 255, 255]
      }
    });
  }
  updateState(parameters: UpdateParameters<this>) {
    super.updateState(parameters);
    if (!this.state.model || parameters.changeFlags.extensionsChanged) {
      this.state.model?.destroy();
      this.setState({
        model: new Model(this.context.device, {
          ...this.getShaders(),
          id: this.props.id,
          geometry: new CubeGeometry(),
          isInstanced: true,
          bufferLayout: this.getAttributeManager().getBufferLayouts()
        })
      });
      this.getAttributeManager().invalidateAll();
    }
  }
  draw() {
    const lightingMix =
      this.props.interpolator?.layerInterpolatedProps?.lightingMix ?? this.props.lightingMix;
    this.state.model.shaderInputs.setProps({cube: {lightingMix}});
    this.state.model.draw(this.context.renderPass);
  }
}
export {CubeLayer as CubeLayer_Class};
