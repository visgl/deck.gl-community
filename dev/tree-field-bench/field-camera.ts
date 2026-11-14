// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

export type FieldOrbitCamera = {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
};

const DEFAULT_FOVY = 50;
const RADIANS_PER_DEGREE = Math.PI / 180;
const MIN_ORBIT_DISTANCE = 0.45;
const MIN_EYE_HEIGHT = 0.05;

function getFocalLength(viewportHeight: number, fovy: number): number {
  return Math.max(1, viewportHeight) / (2 * Math.tan((fovy * RADIANS_PER_DEGREE) / 2));
}

/** Maximum zoom keeps the OrbitView eye at least 45 cm from its look target. */
export function getFieldMaxZoom(viewportHeight: number, fovy = DEFAULT_FOVY): number {
  return Math.log2(getFocalLength(viewportHeight, fovy) / MIN_ORBIT_DISTANCE);
}

export function getFieldOrbitDistance(
  zoom: number,
  viewportHeight: number,
  fovy = DEFAULT_FOVY
): number {
  return getFocalLength(viewportHeight, fovy) / 2 ** zoom;
}

/** Keep wheel, pan and explicit camera poses above the flat field at z = 0. */
export function limitFieldCamera<CameraT extends FieldOrbitCamera>(
  camera: CameraT,
  previous: CameraT,
  viewportHeight: number,
  fovy = DEFAULT_FOVY
): CameraT {
  if (
    !Number.isFinite(camera.zoom) ||
    !Number.isFinite(camera.rotationX) ||
    !Number.isFinite(camera.rotationOrbit) ||
    !camera.target.every(Number.isFinite)
  ) {
    return previous;
  }
  const zoom = Math.min(camera.zoom, getFieldMaxZoom(viewportHeight, fovy));
  const distance = getFieldOrbitDistance(zoom, viewportHeight, fovy);
  if (!Number.isFinite(distance) || distance <= 0) return previous;
  const [east, north, up] = camera.target;
  const eyeHeight = up + distance * Math.sin(camera.rotationX * RADIANS_PER_DEGREE);
  if (eyeHeight < MIN_EYE_HEIGHT) {
    return {...camera, zoom, target: [east, north, up + MIN_EYE_HEIGHT - eyeHeight]};
  }
  return zoom === camera.zoom ? camera : {...camera, zoom};
}

/** Rotate the eye and look target together about the planted pivot at a fixed screen position. */
export function orbitFieldCamera<CameraT extends FieldOrbitCamera>(
  previous: CameraT,
  next: CameraT,
  pivot: readonly [number, number, number],
  viewportHeight: number,
  fovy = DEFAULT_FOVY
): CameraT {
  const oldTilt = previous.rotationX * RADIANS_PER_DEGREE;
  const oldBearing = previous.rotationOrbit * RADIANS_PER_DEGREE;
  const newBearing = next.rotationOrbit * RADIANS_PER_DEGREE;
  const [x, y, z] = pivot;
  const east = previous.target[0] - x;
  const north = previous.target[1] - y;
  const up = previous.target[2] - z;
  const localEast = east * Math.cos(oldBearing) - north * Math.sin(oldBearing);
  const localNorth = east * Math.sin(oldBearing) + north * Math.cos(oldBearing);
  const distance = getFieldOrbitDistance(next.zoom, viewportHeight, fovy);
  const getEyeHeight = (angle: number) => {
    const tilt = angle * RADIANS_PER_DEGREE;
    const delta = oldTilt - tilt;
    return z + localNorth * Math.sin(delta) + up * Math.cos(delta) + distance * Math.sin(tilt);
  };
  let rotationX = next.rotationX;
  if (getEyeHeight(rotationX) < MIN_EYE_HEIGHT) {
    // Clamp along the drag so the eye stays above the field without moving the pivot on screen.
    let safe = previous.rotationX;
    let belowGround = rotationX;
    for (let step = 0; step < 16; step++) {
      const halfway = (safe + belowGround) * 0.5;
      if (getEyeHeight(halfway) < MIN_EYE_HEIGHT) belowGround = halfway;
      else safe = halfway;
    }
    rotationX = safe;
  }
  const delta = oldTilt - rotationX * RADIANS_PER_DEGREE;
  const nextNorth = localNorth * Math.cos(delta) - up * Math.sin(delta);
  return {
    ...next,
    rotationX,
    target: [
      x + localEast * Math.cos(newBearing) + nextNorth * Math.sin(newBearing),
      y - localEast * Math.sin(newBearing) + nextNorth * Math.cos(newBearing),
      z + localNorth * Math.sin(delta) + up * Math.cos(delta)
    ]
  };
}
