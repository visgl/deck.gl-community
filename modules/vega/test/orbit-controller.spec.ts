// deck.gl-community
// SPDX-License-Identifier: MIT
import {expect, it, vi} from 'vitest';
import {LinearInterpolator, OrbitViewport} from '@deck.gl/core';
import {Timeline} from '@luma.gl/engine';
import {LinearInterpolator as CameraInterpolator} from '../src/deck.gl-classes/linear-interpolator';
import {createOrbitControllerClass} from '../src/deck.gl-classes/orbit-controller';

it('preserves controller identity and interpolates camera updates and interrupted return', () => {
  const Controller = createOrbitControllerClass({});
  const timeline = new Timeline();
  const onViewStateChange = vi.fn();
  const controller = new Controller({
    timeline,
    eventManager: null,
    makeViewport: props => new OrbitViewport(props),
    onViewStateChange,
    onStateChange: vi.fn()
  });
  const props = {
    id: 'OrbitView',
    x: 0,
    y: 0,
    width: 700,
    height: 420,
    target: [350, -210, 0] as [number, number, number],
    rotationOrbit: 0,
    rotationX: 90,
    zoom: -0.2
  };
  try {
    expect(controller.constructor).toBe(Controller);
    controller.setProps(props);
    controller.setProps({
      ...props,
      rotationOrbit: 25,
      rotationX: 30,
      zoom: -0.4,
      transitionDuration: 1200,
      transitionInterpolator: new LinearInterpolator([
        'target',
        'rotationOrbit',
        'rotationX',
        'zoom'
      ])
    });
    timeline.setTime(600);
    controller.updateTransition();
    expect(onViewStateChange.mock.lastCall![0].viewState.rotationX).toBeCloseTo(60);
    expect(onViewStateChange.mock.lastCall![0].viewState.rotationOrbit).toBeCloseTo(12.5);
    controller.setProps({
      ...props,
      transitionDuration: 1200,
      transitionInterpolator: new LinearInterpolator([
        'target',
        'rotationOrbit',
        'rotationX',
        'zoom'
      ])
    });
    timeline.setTime(1200);
    controller.updateTransition();
    expect(onViewStateChange.mock.lastCall![0].viewState.rotationX).toBeCloseTo(75);
    timeline.setTime(1800);
    controller.updateTransition();
    expect(onViewStateChange.mock.lastCall![0].viewState.rotationX).toBeCloseTo(90);
  } finally {
    controller.finalize();
  }
});

it('interpolates camera properties and lighting uniforms with their own property keys', () => {
  const interpolator = new CameraInterpolator<{lightingMix: number}>(['rotationX', 'zoom']);
  interpolator.layerStartProps = {lightingMix: 0};
  interpolator.layerEndProps = {lightingMix: 1};
  const camera = interpolator.interpolateProps(
    {rotationX: 90, zoom: -0.2},
    {rotationX: 30, zoom: -0.4},
    0.5
  );
  expect(camera.rotationX).toBe(60);
  expect(camera.zoom).toBeCloseTo(-0.3);
  expect(interpolator.layerInterpolatedProps.lightingMix).toBe(0.5);
});
