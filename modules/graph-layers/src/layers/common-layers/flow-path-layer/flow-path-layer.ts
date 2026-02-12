// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// import {Buffer, Transform} from '@luma.gl/core';
import {LineLayer} from '@deck.gl/layers';

import {vs} from './flow-path-layer-vertex.glsl';
import {fs} from './flow-path-layer-fragment.glsl';
// import {tfvs} from './flow-path-layer-vertex-tf.glsl';

const defaultProps = {
  ...LineLayer.defaultProps,
  getWidth: {type: 'accessor', value: 1},
  getSpeed: {type: 'accessor', value: 0}
};

/* eslint-disable camelcase */
export class FlowPathLayer extends LineLayer {
  getShaders() {
    const projectModule = this.use64bitPositions() ? 'project64' : 'project32';
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
      animation: globalThis.window.requestAnimationFrame(this.animate.bind(this))
    });
  }

  animate() {
    const {transform} = this.state as any;
    if (transform) {
      transform.run();
      transform.swap();
    }
    this.setState({
      animation: window.requestAnimationFrame(this.animate.bind(this))
    });
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags} as any);
    const {speedsBuffer} = this.state as any;

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
      if (this.state.model) {
        (this.state.model as any).delete();
      }
      this.setState({model: this._getModel()});
      this.getAttributeManager().invalidateAll();
    }
  }

  finalizeState() {
    super.finalizeState(this.context);
    window.cancelAnimationFrame((this.state as any).animation);
  }

  setupTransformFeedback() {
    throw new Error('Not implemented');
    // const {gl} = this.context;
    // const elementCount = this.props.data && this.props.data.length;
    // if (elementCount) {
    //   const instanceOffsets = new Float32Array(elementCount);
    //   const instanceSpeeds = new Float32Array(elementCount);
    //   const offsetBuffer = new Buffer(gl, instanceOffsets);
    //   const speedsBuffer = new Buffer(gl, instanceSpeeds);

    //   this.setState({
    //     speedsBuffer,
    //     transform: new Transform(gl, {
    //       id: 'transform-offset',
    //       vs: tfvs,
    //       elementCount,
    //       sourceBuffers: {
    //         a_offset: offsetBuffer,
    //         a_speed: speedsBuffer
    //       },
    //       feedbackMap: {
    //         a_offset: 'v_offset'
    //       }
    //     })
    //   });
    // }
  }

  draw({uniforms}) {
    throw new Error('Not implemented');
    // const {transform} = this.state;
    // if (!transform) {
    //   return;
    // }

    // const {viewport} = this.context;
    // const {widthUnits, widthScale, widthMinPixels, widthMaxPixels} = this.props;

    // const widthMultiplier = widthUnits === 'pixels' ? viewport.distanceScales.metersPerPixel[2] : 1;

    // const offsetBuffer = transform.getBuffer('v_offset');
    // offsetBuffer.setAccessor({divisor: 1});

    // this.state.model
    //   .setAttributes({
    //     instanceOffsets: offsetBuffer
    //   })
    //   .setUniforms(
    //     Object.assign({}, uniforms, {
    //       widthScale: widthScale * widthMultiplier,
    //       widthMinPixels,
    //       widthMaxPixels
    //     })
    //   )
    //   .draw();

    // offsetBuffer.setAccessor({divisor: 0});
  }
}

FlowPathLayer.layerName = 'FlowPathLayer';
(FlowPathLayer as any).defaultProps = defaultProps;
