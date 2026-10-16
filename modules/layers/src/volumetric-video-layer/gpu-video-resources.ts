// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device} from '@luma.gl/core';

/** Owns partially constructed luma resources so failed allocations cannot leak. */
export class GPUVideoResources {
  private resources: {destroy(): void}[] = [];

  add<T extends {destroy(): void}>(resource: T): T {
    this.resources.push(resource);
    return resource;
  }

  destroy(): void {
    for (const resource of this.resources.reverse()) resource.destroy();
    this.resources.length = 0;
  }
}

/** WebGL storage errors do not necessarily throw from a luma texture constructor.
 * Check at allocation/commit boundaries, never during a camera-only update.
 */
export function assertGPUVideoResources(device: Device): void {
  const gl = (device as Device & {gl: WebGL2RenderingContext}).gl;
  if (device.isLost) throw new Error('The GPU context was lost while preparing video history.');
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(
      error === gl.OUT_OF_MEMORY
        ? 'The GPU could not allocate this video history. Shorten the trail or choose lower sampling.'
        : `The GPU could not prepare video history (WebGL error ${error}). Shorten the trail or choose lower sampling.`
    );
  }
}
