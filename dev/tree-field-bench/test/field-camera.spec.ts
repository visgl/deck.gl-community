// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {OrbitViewport} from '@deck.gl/core';
import {expect, it} from 'vitest';
import {
  type FieldOrbitCamera,
  getFieldMaxZoom,
  getFieldOrbitDistance,
  limitFieldCamera,
  orbitFieldCamera
} from '../field-camera';

const WIDTH = 1163;
const HEIGHT = 654;
const FOVY = 50;
const PIVOT = [15, -22, 0] as const;
const CAMERA: FieldOrbitCamera = {
  target: [15, -22, 1.8],
  zoom: 6.5,
  rotationX: 15,
  rotationOrbit: 31
};
const viewport = (camera: FieldOrbitCamera) =>
  new OrbitViewport({width: WIDTH, height: HEIGHT, fovy: FOVY, orbitAxis: 'Z', ...camera});

it('uses the OrbitView focal length to keep the same minimum distance at different fields of view', () => {
  for (const fovy of [36.87, 50, 65]) {
    const zoom = getFieldMaxZoom(HEIGHT, fovy);
    const limited = limitFieldCamera({...CAMERA, zoom: 44}, CAMERA, HEIGHT, fovy);
    expect(limited.zoom).toBe(zoom);
    expect(getFieldOrbitDistance(zoom, HEIGHT, fovy)).toBeCloseTo(0.45, 10);
    const view = new OrbitViewport({
      width: WIDTH,
      height: HEIGHT,
      fovy,
      orbitAxis: 'Z',
      ...limited
    });
    const [x, y, z] = view.cameraPosition;
    expect(
      Math.hypot(x - CAMERA.target[0], y - CAMERA.target[1], z - CAMERA.target[2])
    ).toBeCloseTo(0.45, 8);
  }
});

it('keeps the planted base fixed while pitching and bearing change and stops at the ground', () => {
  const base = viewport(CAMERA).project([...PIVOT]);
  const tilted = orbitFieldCamera(
    CAMERA,
    {...CAMERA, rotationX: 72, rotationOrbit: -57},
    PIVOT,
    HEIGHT
  );
  const lowered = orbitFieldCamera(tilted, {...tilted, rotationX: -90}, PIVOT, HEIGHT);
  expect(tilted.rotationX).toBe(72);
  expect(lowered.rotationX).toBeGreaterThan(-90);
  expect(viewport(lowered).cameraPosition[2]).toBeGreaterThanOrEqual(0.05);
  expect(viewport(lowered).cameraPosition[2]).toBeLessThan(0.051);
  for (const camera of [tilted, lowered]) {
    const point = viewport(camera).project([...PIVOT]);
    expect(point[0]).toBeCloseTo(base[0], 6);
    expect(point[1]).toBeCloseTo(base[1], 6);
    expect(camera.zoom).toBe(CAMERA.zoom);
  }
});

it('retains cursor-derived horizontal placement and accepts a valid canopy orbit', () => {
  const previous = {...CAMERA, maxZoom: getFieldMaxZoom(HEIGHT)};
  const pan = {...previous, target: [13, -24, -1] as [number, number, number], rotationX: 0};
  const limited = limitFieldCamera(pan, previous, HEIGHT);
  expect(limited.target.slice(0, 2)).toEqual([13, -24]);
  expect(viewport(limited).cameraPosition[2]).toBeCloseTo(0.05, 10);
  expect(limited.maxZoom).toBe(previous.maxZoom);
  const leaf = {...previous, zoom: previous.maxZoom, rotationX: -87};
  expect(limitFieldCamera(leaf, previous, HEIGHT)).toBe(leaf);
  expect(limitFieldCamera({...leaf, zoom: Number.NaN}, previous, HEIGHT)).toBe(previous);
});
