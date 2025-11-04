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
  getSpeed: {type: 'accessor', value: 0},
  getTailLength: {type: 'accessor', value: 1},
  getOffset: {type: 'accessor', value: 0}
};

/* eslint-disable camelcase */
export class FlowPathLayer extends LineLayer {
  private static readonly MIN_UPDATE_INTERVAL_MS = 1000 / 24;

  private animationFrame?: number;
  private offsets = new Float32Array(0);
  private speeds = new Float32Array(0);
  private lastUpdateTime = 0;
  private hasAnimatedEdges = false;
  private readonly _handleAnimate = () => this.animate();

  getShaders() {
    const shaders = super.getShaders();
    const modules = Array.isArray(shaders.modules) ? [...shaders.modules] : shaders.modules;
    return {...shaders, vs, fs, modules};
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
    this.initializeAnimationState();
    this.updateAnimationLoop();
  }

  animate() {
    // Mark the outstanding frame handle as consumed before scheduling another one.
    this.animationFrame = undefined;
    const now = this.getCurrentTime();
    const deltaMs = now - this.lastUpdateTime;

    if (deltaMs > 0 && deltaMs < FlowPathLayer.MIN_UPDATE_INTERVAL_MS) {
      this.updateAnimationLoop();
      return;
    }

    const deltaSeconds = deltaMs / 1000;

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
    this.updateAnimationLoop();
  }

  updateState({props, oldProps, changeFlags}) {
    super.updateState({props, oldProps, changeFlags} as any);
    const data = this.getDataArray(props);
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
      this.updateSpeedsFromProps(props, data);
    }
  }

  finalizeState() {
    super.finalizeState(this.context);
    this.cancelAnimationLoop();
    this.offsets = new Float32Array(0);
    this.speeds = new Float32Array(0);
    this.hasAnimatedEdges = false;
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

  private updateSpeedsFromProps(props: any, data: unknown[]) {
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

    if (data.length < this.offsets.length) {
      this.offsets.fill(0, data.length);
      this.speeds.fill(0, data.length);
    }

    this.hasAnimatedEdges = this.speeds.some((speed) => speed !== 0);
    this.updateAnimationLoop();
  }

  private calculateInstanceOffsets = (attribute: any, {numInstances}: {numInstances: number}) => {
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
  };

  private initializeAnimationState() {
    const data = this.getDataArray(this.props as any);
    this.resizeAnimationBuffers(data.length, true);
    this.updateSpeedsFromProps(this.props as any, data);
    this.lastUpdateTime = this.getCurrentTime();
    this.updateAnimationLoop();
  }

  private getDataArray(props: any): unknown[] {
    const {data} = props;
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data;
    }

    try {
      return Array.from(data as Iterable<unknown>);
    } catch (_error) {
      return [];
    }
  }

  private getCurrentTime(): number {
    const perf = window?.performance;
    if (perf && typeof perf.now === 'function') {
      return perf.now.call(perf);
    }
    return Date.now();
  }

  private updateAnimationLoop() {
    if (!this.hasAnimatedEdges) {
      this.cancelAnimationLoop();
      return;
    }

    if (typeof window?.requestAnimationFrame === 'function' && typeof this.animationFrame !== 'number') {
      this.animationFrame = window.requestAnimationFrame(this._handleAnimate);
    }
  }

  private cancelAnimationLoop() {
    if (typeof this.animationFrame === 'number' && typeof window?.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = undefined;
    }
  }
}

FlowPathLayer.layerName = 'FlowPathLayer';
(FlowPathLayer as any).defaultProps = defaultProps;
