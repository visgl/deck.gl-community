// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {OrbitViewState} from '@deck.gl/core';

/** Frame-rate-independent damping with a bounded angular step after a stalled frame. */
export function dampCamera(
  current: OrbitViewState,
  target: OrbitViewState,
  elapsedMs: number
): OrbitViewState {
  const elapsed = Math.min(32, Math.max(0, elapsedMs));
  const blend = 1 - Math.exp(-elapsed / 90);
  const orbitDelta =
    ((((target.rotationOrbit! - current.rotationOrbit! + 180) % 360) + 360) % 360) - 180;
  const limit = elapsed * 0.12;
  const step = (delta: number) => Math.max(-limit, Math.min(limit, delta * blend));
  return {
    ...target,
    // The damping loop owns motion; do not restart a second deck transition.
    transitionDuration: 0,
    rotationX: current.rotationX! + step(target.rotationX! - current.rotationX!),
    rotationOrbit: current.rotationOrbit! + step(orbitDelta),
    zoom: (current.zoom as number) + ((target.zoom as number) - (current.zoom as number)) * blend,
    target: current.target!.map(
      (value, index) => value + (target.target![index] - value) * blend
    ) as [number, number, number]
  };
}

export function isCameraSettled(current: OrbitViewState, target: OrbitViewState): boolean {
  const angle = Math.abs(
    ((((target.rotationOrbit! - current.rotationOrbit! + 180) % 360) + 360) % 360) - 180
  );
  return (
    angle < 0.005 &&
    Math.abs(target.rotationX! - current.rotationX!) < 0.005 &&
    Math.abs((target.zoom as number) - (current.zoom as number)) < 0.0001 &&
    current.target!.every((value, index) => Math.abs(value - target.target![index]) < 0.0001)
  );
}
