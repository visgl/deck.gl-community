// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {FirstPersonViewport, OrbitViewport} from '@deck.gl/core';
import {Timeline} from '@luma.gl/engine';
import {Matrix4} from '@math.gl/core';
import {SplatCameraController, CAMERA_PROPS, MODEL_MATRIX, getInitialViewState} from './camera';

describe('Coit world-space camera', () => {
  it('preserves the authored projection when switching from orbit to physical camera units', () => {
    const height = 720;
    const target: [number, number, number] = [0.0226670563, 0.0141479052, 0.1886351632];
    const offset = [-0.0858 - target[0], 0.1128 - target[1], 0.2203 - target[2]];
    const distance = Math.hypot(...offset);
    const oldViewport = new OrbitViewport({
      width: 1200,
      height,
      target,
      orbitAxis: 'Z',
      fovy: 75,
      rotationOrbit: (Math.atan2(-offset[0], -offset[1]) * 180) / Math.PI,
      rotationX: (Math.asin(offset[2] / distance) * 180) / Math.PI,
      zoom: Math.log2(height / (2 * Math.tan((75 * Math.PI) / 360)) / distance)
    });
    const viewport = new FirstPersonViewport({
      width: 1200,
      height,
      ...CAMERA_PROPS,
      ...getInitialViewState()
    });
    for (const point of [
      [0, 0, 0],
      [0.05, -0.1, 0.2]
    ]) {
      const oldPixel = oldViewport.project(
        Array.from(new Matrix4().rotateX(-Math.PI / 2).transformAsPoint(point))
      );
      const pixel = viewport.project(Array.from(MODEL_MATRIX.transformAsPoint(point)));
      expect(pixel[0]).toBeCloseTo(oldPixel[0], 6);
      expect(pixel[1]).toBeCloseTo(oldPixel[1], 6);
    }
    const sourceCamera = new Matrix4(MODEL_MATRIX)
      .invert()
      .transformAsPoint(viewport.cameraPosition);
    const sourceEye = new Matrix4()
      .rotateX(Math.PI / 2)
      .transformAsPoint([-0.0858, 0.1128, 0.2203]);
    sourceCamera.forEach((value, index) => expect(value).toBeCloseTo(sourceEye[index], 10));
  });

  it('moves through the old orbit pivot without shrinking the clip range', () => {
    const controller = new SplatCameraController({
      timeline: new Timeline(),
      eventManager: {on() {}, off() {}} as never,
      makeViewport: props => new FirstPersonViewport({...CAMERA_PROPS, ...props}),
      onViewStateChange() {},
      onStateChange() {}
    });
    const initial = {...getInitialViewState(), width: 1200, height: 720};
    let state = new controller.ControllerState({
      ...initial,
      makeViewport: props => new FirstPersonViewport({...CAMERA_PROPS, ...props})
    });
    const projections: number[][] = [];
    const eyes: number[][] = [Array.from(state.getViewportProps().position!)];
    const chained = state
      .zoomStart()
      .zoom({pos: [600, 360], scale: 2})
      .zoomEnd()
      .zoomIn();
    expect(
      Math.hypot(...chained.getViewportProps().position.map((value, axis) => value - eyes[0][axis]))
    ).toBeCloseTo(40, 8);
    expect(chained.getViewportProps().position[2]).toBeLessThan(eyes[0][2]);
    for (let step = 0; step < 12; step++) {
      const moved = state.zoom({pos: [600, 360], scale: 2});
      state = new controller.ControllerState({
        ...moved.getViewportProps(),
        makeViewport: props => new FirstPersonViewport({...CAMERA_PROPS, ...props})
      });
      const viewportProps = state.getViewportProps();
      const viewport = new FirstPersonViewport({
        ...CAMERA_PROPS,
        width: 1200,
        height: 720,
        position: [viewportProps.position[0], viewportProps.position[1], viewportProps.position[2]],
        bearing: viewportProps.bearing,
        pitch: viewportProps.pitch
      });
      eyes.push(Array.from(viewport.cameraPosition));
      projections.push(Array.from(viewport.projectionMatrix));
    }
    for (let index = 1; index < eyes.length; index++) {
      expect(
        Math.hypot(...eyes[index].map((value, axis) => value - eyes[index - 1][axis]))
      ).toBeCloseTo(20, 8);
      expect(eyes[index][2]).toBeLessThan(eyes[index - 1][2]);
    }
    expect(
      projections.every(matrix => matrix.every((value, axis) => value === projections[0][axis]))
    ).toBe(true);
    expect(eyes.at(-1)![0]).toBeGreaterThan(22.6670563);
    // The old orbit camera clipped a centered point one source unit beyond its pivot at zoom 20.
    const oldDeep = new OrbitViewport({
      width: 1200,
      height: 720,
      target: [0, 0, 0],
      orbitAxis: 'Z',
      zoom: 20,
      near: 0.01,
      far: 1000
    });
    expect(oldDeep.project([0, 1, 0])[2]).toBeGreaterThan(1);
    const physical = new FirstPersonViewport({
      width: 1200,
      height: 720,
      position: [0, 0, 0],
      bearing: 0,
      pitch: 0,
      ...CAMERA_PROPS
    });
    expect(physical.project([0, 1000, 0])[2]).toBeLessThan(1);
    controller.finalize();
  });
});
