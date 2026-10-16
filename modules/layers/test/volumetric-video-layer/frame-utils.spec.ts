// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {VolumetricVideoLayer} from '../../src/volumetric-video-layer/volumetric-video-layer';
import {
  getFrameCapacity,
  getFrameHistoryBytes,
  getFrameSize,
  getFrameWindow
} from '../../src/volumetric-video-layer/frame-utils';

describe('video frame windows', () => {
  // Value: protects=nullable public history reservations pass deck validation;
  // fails_when=the advertised default or explicit null is rejected or invalid reservations pass;
  // why_new=frame capacity helpers bypass deck's public prop validator; seam=none
  it('validates automatic reservations and rejects invalid explicit history limits', () => {
    for (const props of [
      {video: null},
      {video: null, maxFrameTrail: null},
      {video: null, maxFrameTrail: 0},
      {video: null, maxFrameTrail: 64}
    ]) {
      const layer = new VolumetricVideoLayer(props);
      expect(() => layer.validateProps()).not.toThrow();
    }
    for (const maxFrameTrail of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const layer = new VolumetricVideoLayer({video: null, maxFrameTrail});
      expect(() => layer.validateProps()).toThrow(/maxFrameTrail/);
    }
  });

  it('includes the selected frame when there is no trail', () => {
    expect(getFrameWindow(23, 0, 120, 65)).toEqual({
      firstFrame: 23,
      currentFrame: 23,
      frameCount: 1
    });
  });
  it('does not wrap the trail across the beginning of the video', () => {
    expect(getFrameWindow(2, 48, 120, 65)).toEqual({firstFrame: 0, currentFrame: 2, frameCount: 3});
  });
  it('bounds both the source index and GPU history', () => {
    expect(getFrameWindow(500, 1000, 120, 8)).toEqual({
      firstFrame: 112,
      currentFrame: 119,
      frameCount: 8
    });
    expect(getFrameWindow(-20, 8, 120, 8)).toEqual({firstFrame: 0, currentFrame: 0, frameCount: 1});
    expect(getFrameWindow(Number.NaN, Number.NaN, 0, 8).frameCount).toBe(0);
  });
  it('sizes an automatic full-video trail without a 64 or 255 frame cap', () => {
    expect(getFrameCapacity(751, null, 752)).toBe(752);
    expect(getFrameCapacity(1000, null, 752)).toBe(752);
    expect(getFrameCapacity(751, 32, 752)).toBe(33);
    expect(getFrameCapacity(0, null, 752)).toBe(1);
    expect(getFrameCapacity(1000, 1000, 120)).toBe(120);
    expect(getFrameWindow(751, 751, 752, getFrameCapacity(751, null, 752))).toEqual({
      firstFrame: 0,
      currentFrame: 751,
      frameCount: 752
    });
  });
  it('accounts for odd-size mip levels and all resident frames in the memory budget', () => {
    expect(getFrameHistoryBytes(5, 3, 2)).toBe((15 * 8 + (15 + 2 + 1) * 4) * 2);
    expect(getFrameHistoryBytes(1, 1, 1)).toBe(12);
    expect(getFrameHistoryBytes(1, 1, 0)).toBe(0);
    expect(() => getFrameHistoryBytes(Number.NaN, 3, 1)).toThrow(RangeError);
  });
  it('retains every source pixel in native sampling mode', () => {
    expect(getFrameSize(1920, 1080, 0)).toEqual({width: 1920, height: 1080});
    expect(getFrameSize(1080, 1920, 0)).toEqual({width: 1080, height: 1920});
  });
  it('keeps aspect ratio and bounds portrait and landscape sampling', () => {
    expect(getFrameSize(1920, 1080, 128)).toEqual({width: 128, height: 72});
    expect(getFrameSize(1080, 1920, 128)).toEqual({width: 72, height: 128});
    expect(getFrameSize(32, 18, 128)).toEqual({width: 32, height: 18});
  });
});
