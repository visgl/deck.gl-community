// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {expect, inject} from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    requireWebGPU: boolean;
    terrainWebGPU: boolean;
  }
}

/** Dedicated software-WebGPU CI must exercise a real adapter, never silently skip. */
export async function requireWebGPUAdapter(skip: (message: string) => void) {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter: () => Promise<{
          info: {isFallbackAdapter?: boolean; architecture?: string; vendor?: string};
        }>;
      };
    }
  ).gpu;
  const adapter = await gpu?.requestAdapter();
  if (inject('requireWebGPU')) {
    expect(adapter, 'The WebGPU CI adapter must be available').toBeTruthy();
    expect(
      adapter?.info.isFallbackAdapter || /swiftshader/i.test(adapter?.info.architecture ?? ''),
      'The required adapter must be software WebGPU'
    ).toBe(true);
  }
  if (!adapter) skip('This browser does not expose an available WebGPU adapter.');
}
