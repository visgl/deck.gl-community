// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {getDemoHistory, MAX_DEMO_HISTORY_BYTES} from './history-utils';
import {getFrameHistoryBytes} from '../../../modules/layers/src/volumetric-video-layer/frame-utils';

describe('demo video history limits', () => {
  it('blocks multi-GiB native history without changing the sampling grid', () => {
    const bytesPerFrame = getFrameHistoryBytes(1180, 2556, 1);
    const result = getDemoHistory(73, 1992, bytesPerFrame, 4612 * 1048576, 2048);
    expect(result.budget).toBe(MAX_DEMO_HISTORY_BYTES);
    expect(result.frameTrail).toBe(25);
    expect(result.limited).toBe(true);
    expect(result.capacity * bytesPerFrame).toBeLessThanOrEqual(result.budget);
  });
  it('allows the full video when its chosen sampling grid fits', () => {
    const result = getDemoHistory(1991, 1992, 120000, 512 * 1048576, 2048);
    expect(result).toEqual({
      frameTrail: 1991,
      capacity: 1992,
      budget: 512 * 1048576,
      limited: false
    });
  });
  it('bounds reservations by both the budget and the actual array-layer limit', () => {
    expect(getDemoHistory(1000, 1992, 1000, 512 * 1048576, 256).frameTrail).toBe(255);
    expect(getDemoHistory(48, 1992, 30 * 1048576, 512 * 1048576, 2048).capacity).toBe(17);
    expect(getDemoHistory(0, 1992, 30 * 1048576, 512 * 1048576, 2048).capacity).toBe(1);
  });
});
