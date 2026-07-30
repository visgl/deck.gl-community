// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {Device} from '@luma.gl/core';

/**
 * Releases a graphics device created by a browser test.
 *
 * Deck finalization destroys each test's WebGPU resources. The Playwright browser process owns
 * final WebGPU device teardown because explicitly destroying a Linux SwiftShader device can drop
 * the external WebGPU instance shared by parallel Vitest browser files.
 */
export function releaseBrowserTestDevice(device: Device | undefined): void {
  if (device?.type !== 'webgpu') {
    device?.destroy();
  }
}
