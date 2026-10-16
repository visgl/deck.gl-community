// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, it} from 'vitest';
import {dampCamera, isCameraSettled} from './camera-utils';

const camera = {
  target: [0, 0, 0] as [number, number, number],
  rotationX: 10,
  rotationOrbit: 0,
  zoom: 7
};
it('bounds the response to a sudden pointer jump or a stalled render frame', () => {
  const target = {...camera, rotationOrbit: 90, transitionDuration: 250};
  expect(dampCamera(camera, target, 16).transitionDuration).toBe(0);
  expect(dampCamera(camera, target, 16).rotationOrbit).toBeCloseTo(1.92);
  expect(dampCamera(camera, target, 500).rotationOrbit).toBeCloseTo(3.84);
});
it('takes the short path across the 360-degree boundary', () => {
  const result = dampCamera({...camera, rotationOrbit: 179}, {...camera, rotationOrbit: -179}, 16);
  expect(result.rotationOrbit).toBeGreaterThan(179);
  expect(result.rotationOrbit).toBeLessThan(180);
});
it('converges without overshoot and stops once settled', () => {
  const target = {...camera, rotationOrbit: 30, rotationX: 20, zoom: 8};
  let current = camera;
  for (let frame = 0; frame < 100; frame++) {
    const next = dampCamera(current, target, 16);
    expect(next.rotationOrbit).toBeGreaterThanOrEqual(current.rotationOrbit);
    expect(next.rotationOrbit).toBeLessThanOrEqual(target.rotationOrbit);
    current = next as typeof camera;
  }
  expect(isCameraSettled(current, target)).toBe(true);
});
