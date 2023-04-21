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

import {Buffer, Transform} from '@luma.gl/core';
import {LineLayer} from '@deck.gl/layers';
import {window} from 'global';

import vs from './flow-path-layer-vertex.glsl';
import fs from './flow-path-layer-fragment.glsl';
import tfvs from './flow-path-layer-vertex-tf.glsl';

const defaultProps = {
  ...LineLayer.defaultProps,
  getWidth: {type: 'accessor', value: 1},
  getSpeed: {type: 'accessor', value: 0}
};

/* eslint-disable camelcase */
export default class FlowPathLayer extends LineLayer {
  getShaders() {
    const projectModule = this.use64bitProjection() ? 'project64' : 'project32';
    return {vs, fs, modules: [projectModule, 'picking']};
  }

  initializeState() {
    super.initializeState();
    this.getAttributeManager().addInstanced({
      instanceSpeeds: {
        size: 1,
        transition: true,
        accessor: 'getSpeed',
        defaultValue: 0
      },
      instanceTailLengths: {
        size: 1,
        transition: true,
        accessor: 'getTailLength',
        defaultValue: 1
      }
    });
    this.setupTransformFeedback();
    this.setState({
      ...this.state,
      animation: window.requestAnimationFrame(this.animate.bind(this))
    });
  }

  animate() {
    const {transform} = this.state;
    if (transform) {
      transform.run();
      transform.swap();
    }
    this.setState({
      animation: window.requestAnimationFrame(this.animate.bind(this))
    });
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags});
    const {speedsBuffer} = this.state;

    const speedChanged =
      changeFlags.dataChanged ||
      props.fp64 !== oldProps.fp64 ||
      (changeFlags.updateTriggersChanged &&
        (changeFlags.updateTriggersChanged.all || changeFlags.updateTriggersChanged.getSpeed));

    if (speedChanged) {
      const speeds = new Float32Array(props.data.length);
      for (let i = 0; i < props.data.length; i++) {
        speeds[i] =
          typeof props.getSpeed === 'function' ? props.getSpeed(props.data[i]) : props.getSpeed;
      }
      speedsBuffer.subData({data: speeds});
    }

    if (props.fp64 !== oldProps.fp64) {
      const {gl} = this.context;
      if (this.state.model) {
        this.state.model.delete();
      }
      this.setState({model: this._getModel(gl)});
      this.getAttributeManager().invalidateAll();
    }
  }

  finalizeState() {
    super.finalizeState();
    window.cancelAnimationFrame(this.state.animation);
  }

  setupTransformFeedback() {
    const {gl} = this.context;
    const elementCount = this.props.data && this.props.data.length;
    if (elementCount) {
      const instanceOffsets = new Float32Array(elementCount);
      const instanceSpeeds = new Float32Array(elementCount);
      const offsetBuffer = new Buffer(gl, instanceOffsets);
      const speedsBuffer = new Buffer(gl, instanceSpeeds);

      this.setState({
        speedsBuffer,
        transform: new Transform(gl, {
          id: 'transform-offset',
          vs: tfvs,
          elementCount,
          sourceBuffers: {
            a_offset: offsetBuffer,
            a_speed: speedsBuffer
          },
          feedbackMap: {
            a_offset: 'v_offset'
          }
        })
      });
    }
  }

  draw({uniforms}) {
    const {transform} = this.state;
    if (!transform) {
      return;
    }

    const {viewport} = this.context;
    const {widthUnits, widthScale, widthMinPixels, widthMaxPixels} = this.props;

    const widthMultiplier = widthUnits === 'pixels' ? viewport.distanceScales.metersPerPixel[2] : 1;

    const offsetBuffer = transform.getBuffer('v_offset');
    offsetBuffer.setAccessor({divisor: 1});

    this.state.model
      .setAttributes({
        instanceOffsets: offsetBuffer
      })
      .setUniforms(
        Object.assign({}, uniforms, {
          widthScale: widthScale * widthMultiplier,
          widthMinPixels,
          widthMaxPixels
        })
      )
      .draw();

    offsetBuffer.setAccessor({divisor: 0});
  }
}

FlowPathLayer.layerName = 'FlowPathLayer';
FlowPathLayer.defaultProps = defaultProps;
