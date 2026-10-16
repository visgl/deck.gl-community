// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Conservative demo ceiling, not a claim about total available GPU memory. */
export const MAX_DEMO_HISTORY_BYTES = 1024 * 1048576;

/** Fits a requested trail without reducing the chosen source-pixel sampling grid. */
export function getDemoHistory(
  requestedTrail: number,
  totalFrames: number,
  bytesPerFrame: number,
  maxTextureBytes: number,
  maxArrayLayers: number
): {frameTrail: number; capacity: number; budget: number; limited: boolean} {
  const budget = Math.min(MAX_DEMO_HISTORY_BYTES, Math.max(1, maxTextureBytes));
  const limit = Math.max(
    1,
    Math.min(totalFrames, maxArrayLayers, Math.floor(budget / bytesPerFrame))
  );
  const wanted = Math.max(0, Math.min(totalFrames - 1, Math.floor(requestedTrail)));
  const frameTrail = Math.min(wanted, limit - 1);
  return {
    frameTrail,
    capacity: Math.min(limit, 2 ** Math.ceil(Math.log2(frameTrail + 1))),
    budget,
    limited: frameTrail < wanted
  };
}
