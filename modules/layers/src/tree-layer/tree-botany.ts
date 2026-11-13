// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors
import {Vector3} from '@math.gl/core';

export type TreePoint = [number, number, number];

/** Transport a frame along a tube without the discontinuous vertical-axis switch. */
export function getTreeFrames(path: TreePoint[]) {
  let previous: Vector3 | undefined;
  return path.map((point, index) => {
    const tangent = new Vector3(path[Math.min(path.length - 1, index + 1)])
      .subtract(path[Math.max(0, index - 1)])
      .normalize();
    const side = previous
      ? new Vector3(previous).subtract(new Vector3(tangent).scale(previous.dot(tangent)))
      : new Vector3(Math.abs(tangent.z) > 0.95 ? [1, 0, 0] : [0, 0, 1]).cross(tangent);
    if (side.len() < 1e-6) side.set(1, 0, 0).cross(tangent);
    side.normalize();
    previous = side;
    return {side, up: new Vector3(tangent).cross(side).normalize(), tangent};
  });
}
