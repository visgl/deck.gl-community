// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// import {Buffer, Transform} from '@luma.gl/core';
import {LineLayer} from '@deck.gl/layers';
import {window} from 'global';

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
  private animationFrame?: number;
  private offsets = new Float32Array(0);
  private speeds = new Float32Array(0);
  private lastUpdateTime = 0;
  private readonly _handleAnimate = () => this.animate();

  getShaders() {
    const projectModule = this.use64bitPositions() ? 'project64' : 'project32';
    return {vs, fs, modules: [projectModule, 'picking']};
  }

  initializeState() {
    super.initializeState();
    const attributeManager = this.getAttributeManager();
    attributeManager?.addInstanced({
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
      },
      instanceOffsets: {
        size: 1,
        transition: false,
        accessor: 'getOffset',
        defaultValue: 0,
        update: this.calculateInstanceOffsets
      }
    });
    this.setupTransformFeedback();
    this.animationFrame = window.requestAnimationFrame(this._handleAnimate);
  }

  animate() {
    const now = this.getCurrentTime();
    const deltaSeconds = (now - this.lastUpdateTime) / 1000;

    if (deltaSeconds > 0 && this.offsets.length > 0) {
      let needsRedraw = false;
      for (let index = 0; index < this.offsets.length; index++) {
        const speed = this.speeds[index];
        if (!speed) {
          continue;
        }

        const nextOffset = this.offsets[index] + speed * deltaSeconds;
        const wrappedOffset = nextOffset % 60;
        this.offsets[index] = Number.isFinite(wrappedOffset)
          ? wrappedOffset < 0
            ? wrappedOffset + 60
            : wrappedOffset
          : 0;
        needsRedraw = true;
      }

      if (needsRedraw) {
        const attributeManager = this.getAttributeManager();
        attributeManager?.invalidate('instanceOffsets');
        this.setNeedsRedraw();
      }
    }

    this.lastUpdateTime = now;
    this.animationFrame = window.requestAnimationFrame(this._handleAnimate);
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags} as any);
    const data = (props.data as unknown[]) ?? [];
    const dataLength = data.length;

    if (changeFlags.dataChanged) {
      this.resizeAnimationBuffers(dataLength, true);
      this.lastUpdateTime = this.getCurrentTime();
    } else if (this.offsets.length !== dataLength) {
      this.resizeAnimationBuffers(dataLength, false);
    }

    const speedChanged =
      changeFlags.dataChanged ||
      (changeFlags.updateTriggersChanged &&
        (changeFlags.updateTriggersChanged.all || changeFlags.updateTriggersChanged.getSpeed)) ||
      props.getSpeed !== oldProps.getSpeed;

    if (speedChanged) {
      this.updateSpeedsFromProps(props);
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
    if (typeof this.animationFrame === 'number') {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
    this.offsets = new Float32Array(0);
    this.speeds = new Float32Array(0);
  }

  setupTransformFeedback() {
    const data = (this.props.data as unknown[]) ?? [];
    this.resizeAnimationBuffers(data.length, true);
    this.updateSpeedsFromProps(this.props as any);
    this.lastUpdateTime = this.getCurrentTime();
  }

  draw({uniforms}) {
    super.draw({uniforms});
  }

  private resizeAnimationBuffers(length: number, resetOffsets: boolean) {
    if (length < 0) {
      return;
    }

    const attributeManager = this.getAttributeManager();
    if (!attributeManager) {
      this.offsets = new Float32Array(length);
      this.speeds = new Float32Array(length);
      return;
    }

    if (this.offsets.length !== length) {
      this.offsets = new Float32Array(length);
      this.speeds = new Float32Array(length);
      attributeManager.invalidate('instanceOffsets');
      this.setNeedsRedraw();
    } else if (resetOffsets) {
      this.offsets.fill(0);
      attributeManager.invalidate('instanceOffsets');
      this.setNeedsRedraw();
    }
  }

  private updateSpeedsFromProps(props: any) {
    const data = (props.data as unknown[]) ?? [];
    const accessor = props.getSpeed;

    if (this.speeds.length !== data.length) {
      this.resizeAnimationBuffers(data.length, false);
    }

    for (let index = 0; index < data.length; index++) {
      const value =
        typeof accessor === 'function'
          ? accessor(data[index], {index, data})
          : accessor;
      const numericValue = Number(value);
      this.speeds[index] = Number.isFinite(numericValue) ? numericValue : 0;
      if (!Number.isFinite(this.offsets[index])) {
        this.offsets[index] = 0;
      }
    }
  }

  private calculateInstanceOffsets(attribute: any, {numInstances}: {numInstances: number}) {
    if (!this.offsets.length || numInstances === 0) {
      attribute.constant = true;
      attribute.value = [0];
      return;
    }

    attribute.constant = false;

    if (this.offsets.length === numInstances) {
      attribute.value = this.offsets;
      return;
    }

    attribute.value = this.offsets.subarray(0, numInstances);
  }

  private getCurrentTime(): number {
    const perf = window?.performance;
    if (perf && typeof perf.now === 'function') {
      return perf.now.call(perf);
    }
    return Date.now();
  }
}

FlowPathLayer.layerName = 'FlowPathLayer';
(FlowPathLayer as any).defaultProps = defaultProps;
