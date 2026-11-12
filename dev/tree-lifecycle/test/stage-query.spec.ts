// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {describe, expect, it} from 'vitest';
import {DEFAULT_SHUTTER} from '../stage/accumulator';
import {
  formatStageSeconds,
  getCycleFrames,
  getDipSpread,
  getFrameDifference,
  getFrameSeconds,
  getFrameShutter,
  getKeyFrameSteps,
  getLoopPairs,
  getLoopVerdict,
  getNeighbourPairs,
  getPlaybackPlace,
  getSsimDip,
  getTieFrames,
  getTwoFrameSteps,
  getYuvPsnr,
  isCycleFile,
  judgeEncodedWrap,
  judgeFrameCount,
  judgeLoopPair,
  judgeSwap,
  judgeTie,
  judgeTwoFrameStep,
  judgeWrap,
  LOOP_CHECK,
  parseAspect,
  parseDevicePixels,
  parseLodBias,
  parseOnlyLayers,
  parseStageSeconds,
  parseSwitch,
  parseWorld,
  SEAM_CHECK,
  SEAM_VIEW,
  STAGE_FPS
} from '../stage/stage-query';
import {
  CYCLE_SECONDS,
  getCycleSeconds,
  getTimeRate,
  isInSeamWindow,
  LOOP,
  TIME_RATE_KEYS
} from '../story/beats';

const LAYER_NAMES = ['sky', 'ground', 'plain', 'trees', 'orange', 'seed', 'pot'];
const GROUPS = {props: ['orange', 'seed', 'pot']};
const CYCLE_FRAMES = CYCLE_SECONDS * STAGE_FPS;

describe('stage URL parameters', () => {
  it('reads a switch as off for 0 alone', () => {
    expect(parseSwitch(null, true)).toBe(true);
    expect(parseSwitch(null, false)).toBe(false);
    expect(parseSwitch('0', true)).toBe(false);
    expect(parseSwitch('1', false)).toBe(true);
    expect(parseSwitch('', false)).toBe(true);
  });

  it('reads an aspect as a ratio or as width:height, and nothing else', () => {
    expect(parseAspect('9:16')).toBeCloseTo(0.5625, 12);
    expect(parseAspect('0.5625')).toBeCloseTo(0.5625, 12);
    expect(parseAspect('16:9')).toBeCloseTo(16 / 9, 12);
    for (const text of [null, '', 'abc', '0', '-1', '1:0', '0:1']) {
      expect(parseAspect(text)).toBeNull();
    }
  });

  it('reads lodBias as a number, or as none for anything else', () => {
    expect(parseLodBias('-1.5')).toBe(-1.5);
    expect(parseLodBias('0')).toBe(0);
    for (const text of [null, '', ' ', 'abc', 'Infinity']) expect(parseLodBias(text)).toBeNull();
  });

  it('reads device pixels as a number above 0, or as 1', () => {
    expect(parseDevicePixels('2')).toBe(2);
    expect(parseDevicePixels('1.5')).toBe(1.5);
    for (const text of [null, '', '0', '-1', 'abc', 'Infinity']) {
      expect(parseDevicePixels(text)).toBe(1);
    }
  });

  it('reads only by layer and by group, in draw order, and says what it did not know', () => {
    expect(parseOnlyLayers('pot,sky', LAYER_NAMES, GROUPS)).toEqual({
      layers: ['sky', 'pot'],
      unknown: []
    });
    expect(parseOnlyLayers('props,trees,bogus,,', LAYER_NAMES, GROUPS)).toEqual({
      layers: ['trees', 'orange', 'seed', 'pot'],
      unknown: ['bogus']
    });
    expect(parseOnlyLayers('', LAYER_NAMES, GROUPS)).toEqual({layers: [], unknown: []});
  });

  it('reads a world as end or start, and anything else as the second deciding', () => {
    expect(parseWorld('end')).toBe('end');
    expect(parseWorld('start')).toBe('start');
    for (const text of [null, '', 'End', 'both', '1']) expect(parseWorld(text)).toBeNull();
  });
});

describe('stage seconds', () => {
  it('takes t mod the cycle, and never clamps it', () => {
    expect(parseStageSeconds(String(LOOP.fileStart))).toBe(LOOP.fileStart);
    expect(parseStageSeconds(String(LOOP.fileStart + CYCLE_SECONDS))).toBe(LOOP.fileStart);
    expect(parseStageSeconds(String(CYCLE_SECONDS))).toBe(0);
    expect(parseStageSeconds('-0.1')).toBeCloseTo(CYCLE_SECONDS - 0.1, 12);
    expect(parseStageSeconds('37.47')).toBe(37.47);
    for (const text of [null, '', ' ', 'abc']) expect(parseStageSeconds(text)).toBe(0);
  });

  it('keeps every frame of the cycle in the URL, exactly', () => {
    for (let frame = 0; frame < CYCLE_FRAMES; frame++) {
      const seconds = frame / STAGE_FPS;
      expect(parseStageSeconds(formatStageSeconds(seconds))).toBe(seconds);
    }
    expect(formatStageSeconds(1 / 30)).toBe('0.0333');
    expect(formatStageSeconds(LOOP.fileStart)).toBe('61.3');
    expect(formatStageSeconds(CYCLE_SECONDS)).toBe('0');
    expect(formatStageSeconds(-1 / 30)).toBe('63.9667');
  });

  it('counts the frames of a run in whole frames, wrapping exactly at the swap', () => {
    expect(getFrameSeconds(LOOP.fileStart, 0, STAGE_FPS)).toBe(LOOP.fileStart);
    const swap = Math.round((CYCLE_SECONDS - LOOP.fileStart) * STAGE_FPS);
    expect(getFrameSeconds(LOOP.fileStart, swap, STAGE_FPS)).toBe(0);
    expect(getFrameSeconds(LOOP.fileStart, swap - 1, STAGE_FPS)).toBe(
      (CYCLE_FRAMES - 1) / STAGE_FPS
    );
    expect(getFrameSeconds(LOOP.fileStart, CYCLE_FRAMES - 1, STAGE_FPS)).toBe(
      (Math.round(LOOP.fileStart * STAGE_FPS) - 1) / STAGE_FPS
    );
    expect(getFrameSeconds(LOOP.fileStart, CYCLE_FRAMES, STAGE_FPS)).toBe(LOOP.fileStart);
    expect(getFrameSeconds(LOOP.fileStart + CYCLE_SECONDS, 3, STAGE_FPS)).toBe(
      getFrameSeconds(LOOP.fileStart, 3, STAGE_FPS)
    );
    expect(getFrameSeconds(-1, 0, STAGE_FPS)).toBe(CYCLE_SECONDS - 1);
    // Off the frame grid, the time is added up and wrapped.
    expect(getFrameSeconds(63.99, 1, STAGE_FPS)).toBeCloseTo(63.99 + 1 / 30 - CYCLE_SECONDS, 12);
  });

  it('places a second in a playback window that may run past the end of the cycle', () => {
    const whole = {from: 0, to: CYCLE_SECONDS};
    expect(getPlaybackPlace(0, whole)).toBe(0);
    expect(getPlaybackPlace(63.9, whole)).toBe(63.9);
    const file = {from: LOOP.fileStart, to: LOOP.fileStart + CYCLE_SECONDS};
    expect(getPlaybackPlace(LOOP.fileStart, file)).toBe(LOOP.fileStart);
    expect(getPlaybackPlace(0, file)).toBeCloseTo(CYCLE_SECONDS, 12);
    expect(getPlaybackPlace(61.2, file)).toBeLessThan(file.to);
    // A range through the swap, from 62 s to 2 s.
    const seam = {from: 62, to: 66};
    expect(getPlaybackPlace(63, seam)).toBe(63);
    expect(getPlaybackPlace(1, seam)).toBe(65);
    expect(getPlaybackPlace(10, seam)).toBeGreaterThanOrEqual(seam.to);
  });
});

describe('frame differences', () => {
  const width = 4;
  const height = 3;
  const frame = (value: (index: number) => number) =>
    Uint8ClampedArray.from({length: width * height * 4}, (_, index) =>
      index % 4 === 3 ? 255 : value(index)
    );

  it('is nothing between a frame and itself', () => {
    const a = frame(index => index % 251);
    expect(getFrameDifference(a, a, width, height)).toEqual({mad: 0, psnr: Infinity});
  });

  it('measures the mean absolute difference and the PSNR of red, green and blue', () => {
    const a = frame(() => 100);
    const b = frame(() => 101);
    const {mad, psnr} = getFrameDifference(a, b, width, height);
    expect(mad).toBe(1);
    expect(psnr).toBeCloseTo(10 * Math.log10(255 * 255), 9);
    // Alpha is left out.
    const c = Uint8ClampedArray.from(a, (value, index) => (index % 4 === 3 ? 0 : value));
    expect(getFrameDifference(a, c, width, height).mad).toBe(0);
  });

  it('measures a band of rows alone', () => {
    const a = frame(() => 50);
    // Only the last row differs, by 30.
    const b = frame(index => (index >= 2 * width * 4 ? 80 : 50));
    expect(getFrameDifference(a, b, width, height, [0, 2]).mad).toBe(0);
    expect(getFrameDifference(a, b, width, height, [2, 3]).mad).toBe(30);
    expect(getFrameDifference(a, b, width, height).mad).toBe(10);
  });

  it('refuses frames of another size', () => {
    expect(() =>
      getFrameDifference(
        frame(() => 0),
        new Uint8Array(8),
        width,
        height
      )
    ).toThrow();
  });

  it('measures the PSNR of yuv420p frames over Y, U and V together, as coded', () => {
    // 4x2 luma and 2x1 of each chroma: 12 samples.
    const a = Uint8Array.from({length: 12}, (_, index) => 16 + index * 10);
    expect(getYuvPsnr(a, a, 4, 2)).toBe(Infinity);
    // Every sample a step of 1: an MSE of 1.
    const b = a.map(value => value + 1);
    expect(getYuvPsnr(a, b, 4, 2)).toBeCloseTo(10 * Math.log10(255 * 255), 9);
    // A step of 4 in one chroma sample alone is an MSE of 16 over the 12 samples together.
    const c = Uint8Array.from(a);
    c[11] += 4;
    expect(getYuvPsnr(a, c, 4, 2)).toBeCloseTo(10 * Math.log10((255 * 255 * 12) / 16), 9);
    // An odd size has chroma rounded up, as ffmpeg's rawvideo has it.
    expect(getYuvPsnr(new Uint8Array(9 + 2 * 4), new Uint8Array(9 + 2 * 4), 3, 3)).toBe(Infinity);
    expect(() => getYuvPsnr(a, new Uint8Array(12), 4, 4)).toThrow();
    expect(() => getYuvPsnr(a, new Uint8Array(11), 4, 2)).toThrow();
  });
});

describe('the loop checks', () => {
  it('shows the seconds either side of the swap in order, each from its own side', () => {
    const seams = SEAM_VIEW.map(view => view.seam);
    expect(seams).toEqual([...seams].sort((a, b) => a - b));
    expect(SEAM_VIEW.map(view => view.world)).toEqual(['end', 'end', 'start', 'start']);
    for (const seam of SEAM_CHECK.seams) {
      expect(seams).toContain(seam);
      expect(isInSeamWindow(getCycleSeconds(seam), LOOP.cover)).toBe(true);
    }
  });

  it('finds the wrap and the swap of a file that is one cycle from the file start', () => {
    const frames = CYCLE_FRAMES;
    const pairs = getLoopPairs(LOOP.fileStart, frames, STAGE_FPS);
    expect(pairs).toEqual({cycle: true, wrap: frames - 1, swap: 80});
    // Frame 80 is the last of the end world, and 81 the first of the start world.
    expect(getFrameSeconds(LOOP.fileStart, 80, STAGE_FPS)).toBeCloseTo(CYCLE_SECONDS - 1 / 30, 12);
    expect(getFrameSeconds(LOOP.fileStart, 81, STAGE_FPS)).toBe(0);
    // Its neighbours run round the ends of the file.
    expect(getNeighbourPairs(frames - 1, frames, true)).toEqual([
      1911, 1912, 1913, 1914, 1915, 1916, 1917, 1918, 0, 1, 2, 3, 4, 5, 6, 7
    ]);
  });

  it('finds them in a short run around either, for a test', () => {
    // Two seconds about the file start, which wrap in the file and not in the story.
    expect(getLoopPairs(LOOP.fileStart - 1, 60, STAGE_FPS)).toEqual({
      cycle: false,
      wrap: 29,
      swap: null
    });
    // Two seconds about the swap.
    expect(getLoopPairs(CYCLE_SECONDS - 1, 60, STAGE_FPS)).toEqual({
      cycle: false,
      wrap: null,
      swap: 29
    });
    expect(getNeighbourPairs(2, 60, false)).toEqual([0, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('passes a pair that steps no harder than its neighbours, and fails one that jumps', () => {
    const neighbours = Array.from({length: 16}, (_, index) => ({
      mad: 2 + (index % 4) * 0.1,
      ssim: 0.95 + (index % 3) * 0.001
    }));
    const calm = judgeLoopPair({mad: 2.3, ssim: 0.948}, neighbours);
    expect(calm.pass).toBe(true);
    expect(calm.madLimit).toBeCloseTo(1.3 * 2.15, 12);
    expect(calm.ssimLimit).toBeCloseTo(0.951 - 0.01, 12);
    expect(judgeLoopPair({mad: 3, ssim: 0.95}, neighbours).pass).toBe(false);
    expect(judgeLoopPair({mad: 2, ssim: 0.9}, neighbours).pass).toBe(false);
    expect(judgeLoopPair({mad: 0, ssim: 1}, []).pass).toBe(false);
  });

  it("gates the swap and the wrap's picture each by both rules", () => {
    expect(LOOP_CHECK.rules).toEqual({
      wrapPicture: ['mad', 'ssim'],
      wrapEncoded: ['mad', 'keyFrameDip'],
      swap: ['mad', 'ssim']
    });
    const neighbours = Array.from({length: 16}, () => ({mad: 2, ssim: 0.95}));
    for (const rules of [LOOP_CHECK.rules.wrapPicture, LOOP_CHECK.rules.swap]) {
      // A pair whose SSIM sits under its neighbours' fails, though its MAD does not jump.
      const softer = judgeLoopPair({mad: 2.1, ssim: 0.9}, neighbours, rules);
      expect(softer).toMatchObject({pass: false, madPass: true, ssimPass: false});
      expect(softer.ssimLimit).toBeCloseTo(0.94, 12);
      // So does a jump, however alike its SSIM.
      expect(judgeLoopPair({mad: 3, ssim: 0.95}, neighbours, rules).pass).toBe(false);
      expect(judgeLoopPair({mad: 2.1, ssim: 0.945}, neighbours, rules).pass).toBe(true);
    }
    // A rule left out is still measured, and reported as kept or not.
    const madAlone = judgeLoopPair({mad: 2.1, ssim: 0.9}, neighbours, ['mad']);
    expect(madAlone).toMatchObject({pass: true, ssimPass: false, rules: ['mad']});
  });

  it("finds the file's internal key-frame steps when its wrap is a step into a key frame", () => {
    // One cycle with an IDR frame every 60: the wrap, 1919 to 0, is the step into frame 0's.
    const keyFrames = Array.from({length: CYCLE_FRAMES / 60}, (_, index) => index * 60);
    const steps = getKeyFrameSteps(keyFrames, CYCLE_FRAMES, true, CYCLE_FRAMES - 1);
    expect(steps).toHaveLength(31);
    expect(steps?.slice(0, 3)).toEqual([59, 119, 179]);
    expect(steps?.at(-1)).toBe(1859);
    expect(steps).not.toContain(CYCLE_FRAMES - 1);
    // A short run's wrap, 29 to 30, is inside its one GOP, so there is nothing to judge it by.
    expect(getKeyFrameSteps([0], 60, false, 29)).toBeNull();
    expect(getKeyFrameSteps([0, 60, 120], 180, false, 89)).toBeNull();
    expect(getKeyFrameSteps(keyFrames, CYCLE_FRAMES, true, null)).toBeNull();
    // A wrap into a key frame is never judged by itself: here it is the only key-frame step.
    expect(getKeyFrameSteps([0, 60], 120, false, 59)).toEqual([]);
    expect(getKeyFrameSteps([0, 60, 120], 180, false, 59)).toEqual([119]);
  });

  it('measures how far a step dips below its neighbours, and how deep a set of dips goes', () => {
    const neighbours = [0.7, 0.72, 0.74, 0.76].map(ssim => ({mad: 1, ssim}));
    expect(getSsimDip({mad: 1, ssim: 0.7}, neighbours)).toBeCloseTo(0.03, 12);
    expect(getSsimDip({mad: 1, ssim: 0.75}, neighbours)).toBeCloseTo(-0.02, 12);
    expect(getSsimDip({mad: 1, ssim: 0.7}, [])).toBeNaN();
    // 31 dips from 0 to 0.03: the 90th percentile is the 28th, as numpy's default has it.
    const dips = Array.from({length: 31}, (_, index) => index / 1000).reverse();
    const spread = getDipSpread(dips);
    expect(spread.count).toBe(31);
    expect(spread.median).toBeCloseTo(0.015, 12);
    expect(spread.p90).toBeCloseTo(0.027, 12);
    expect(spread.max).toBe(0.03);
    // Between ranks, it is interpolated.
    expect(getDipSpread([4, 1, 3, 2])).toEqual({count: 4, median: 2.5, p90: 3.7, max: 4});
  });

  it('fails a wrap whose picture jumps, whatever the MP4 does', () => {
    const neighbours = Array.from({length: 16}, (_, index) => ({
      mad: 9 + (index % 4) * 0.1,
      ssim: 0.73 + (index % 3) * 0.002
    }));
    // The MP4's wrap is just like its neighbours, and keeps rule 2 by a mile.
    const smooth = judgeEncodedWrap({mad: 9.1, ssim: 0.732}, neighbours, [0.01, 0.02, 0.03]);
    const encoded = {whole: smooth, band: smooth};
    expect(smooth.pass).toBe(true);
    const rules = LOOP_CHECK.rules.wrapPicture;
    const steady = judgeLoopPair({mad: 9.2, ssim: 0.73}, neighbours, rules);
    expect(steady.pass).toBe(true);
    // A picture that jumps, or one that softens, fails rule 1, and with it the wrap.
    for (const picture of [
      {mad: 12.5, ssim: 0.73},
      {mad: 9.2, ssim: 0.715}
    ]) {
      const jump = judgeLoopPair(picture, neighbours, rules);
      expect(jump.pass).toBe(false);
      for (const regions of [
        {whole: jump, band: steady},
        {whole: steady, band: jump}
      ]) {
        expect(judgeWrap(encoded, regions, [])).toEqual({
          picturePass: false,
          encodedPass: true,
          twoFramePass: true,
          pass: false
        });
      }
    }
    expect(judgeWrap(encoded, {whole: steady, band: steady}, []).pass).toBe(true);
    // Without the parts, the picture is not judged: the MP4 keeps every rule judged, and the check
    // can say no more than that.
    expect(judgeWrap(encoded, null, [])).toEqual({
      picturePass: null,
      encodedPass: true,
      twoFramePass: true,
      pass: true
    });
    expect(getLoopVerdict([judgeWrap(encoded, null, []).pass], false)).toBe('encoded');
  });

  it("fails an MP4 wrap that dips deeper than the file's own key-frame steps do", () => {
    const neighbours = Array.from({length: 16}, () => ({mad: 9, ssim: 0.77}));
    const keyFrameDips = [0.012, 0.0319, 0.014, 0.02, -0.003];
    // A dip of 0.03 fails the SSIM rule, which is reported only, and keeps rule 2.
    const within = judgeEncodedWrap({mad: 9.5, ssim: 0.74}, neighbours, keyFrameDips);
    expect(within).toMatchObject({
      pass: true,
      madPass: true,
      ssimPass: false,
      dipPass: true,
      rules: ['mad', 'keyFrameDip']
    });
    expect(within.dip).toBeCloseTo(0.03, 12);
    expect(within.dipLimit).toBeCloseTo(0.0319 + LOOP_CHECK.keyFrameMargin, 12);
    expect(within.keyFrames).toMatchObject({count: 5, median: 0.014, max: 0.0319});
    // Deeper than the deepest key-frame step and the margin, it fails, however the picture does.
    const deeper = judgeEncodedWrap({mad: 9.5, ssim: 0.73}, neighbours, keyFrameDips);
    expect(deeper).toMatchObject({pass: false, madPass: true, dipPass: false});
    const steady = judgeLoopPair({mad: 9, ssim: 0.77}, neighbours, LOOP_CHECK.rules.wrapPicture);
    expect(steady.pass).toBe(true);
    for (const encoded of [
      {whole: deeper, band: within},
      {whole: within, band: deeper}
    ]) {
      expect(judgeWrap(encoded, {whole: steady, band: steady}, [])).toEqual({
        picturePass: true,
        encodedPass: false,
        twoFramePass: true,
        pass: false
      });
    }
    // The MAD rule still gates the MP4's wrap, however small its dip.
    const jump = judgeEncodedWrap({mad: 12, ssim: 0.77}, neighbours, keyFrameDips);
    expect(jump).toMatchObject({pass: false, madPass: false, dipPass: true});
    // With no key-frame step to judge by, the dip may be no deeper than the SSIM rule allows.
    for (const none of [null, []]) {
      const alone = judgeEncodedWrap({mad: 9.5, ssim: 0.74}, neighbours, none);
      expect(alone).toMatchObject({pass: false, dipPass: false, keyFrames: null});
      expect(alone.dipLimit).toBe(LOOP_CHECK.ssimDrop);
      expect(judgeEncodedWrap({mad: 9.5, ssim: 0.765}, neighbours, none).pass).toBe(true);
    }
    // Nor does a wrap without neighbours keep it.
    expect(judgeEncodedWrap({mad: 0, ssim: 1}, [], keyFrameDips).pass).toBe(false);
  });

  it('fails a pair that freezes, by the MAD rule, wherever that rule gates', () => {
    // Medians of 8.875 in MAD, exactly, and 0.752 in SSIM.
    const neighbours = Array.from({length: 16}, (_, index) => ({
      mad: 8.5 + (index % 4) * 0.25,
      ssim: 0.75 + (index % 3) * 0.002
    }));
    const median = 8.875;
    for (const rules of [LOOP_CHECK.rules.wrapPicture, LOOP_CHECK.rules.swap]) {
      // The last frame the same as the first: no step at all, and as alike as a pair can be.
      const frozen = judgeLoopPair({mad: 0, ssim: 1}, neighbours, rules);
      expect(frozen).toMatchObject({pass: false, madPass: false, ssimPass: true});
      expect(frozen.madLeast).toBeCloseTo(LOOP_CHECK.madLeastRatio * median, 12);
      expect(frozen.madLimit).toBeCloseTo(LOOP_CHECK.madRatio * median, 12);
      // Under half its neighbours' median it froze; at half it did not.
      expect(judgeLoopPair({mad: 0.49 * median, ssim: 0.76}, neighbours, rules).pass).toBe(false);
      expect(judgeLoopPair({mad: 0.5 * median, ssim: 0.76}, neighbours, rules).pass).toBe(true);
    }
    // In the MP4 a repeated frame, encoded again, still steps a little, and as little fails rule 2.
    const repeated = judgeEncodedWrap({mad: 3.826, ssim: 0.8927}, neighbours, [0.02, 0.06]);
    expect(repeated).toMatchObject({pass: false, madPass: false, dipPass: true});
    expect(LOOP_CHECK.madLeastRatio).toBeLessThan(LOOP_CHECK.madRatio);
  });

  it('finds the two-frame steps across a pair, and theirs either side, in a cycle or a run', () => {
    const frames = CYCLE_FRAMES;
    expect(getTwoFrameSteps(frames - 1, frames, true)).toEqual([frames - 2, frames - 1]);
    expect(getTwoFrameSteps(80, frames, true)).toEqual([79, 80]);
    expect(getTwoFrameSteps(0, frames, true)).toEqual([frames - 1, 0]);
    // Their neighbours run round the ends of the file too, as steps of two frames.
    expect(getNeighbourPairs(frames - 2, frames, true, LOOP_CHECK.neighbours, 2)).toEqual([
      1910, 1911, 1912, 1913, 1914, 1915, 1916, 1917, 1919, 0, 1, 2, 3, 4, 5, 6
    ]);
    // Inside a run of 60, a step of two frames starts at frame 57 at the latest.
    expect(getTwoFrameSteps(29, 60, false)).toEqual([28, 29]);
    expect(getTwoFrameSteps(0, 60, false)).toEqual([0]);
    expect(getTwoFrameSteps(58, 60, false)).toEqual([57]);
    expect(getNeighbourPairs(55, 60, false, LOOP_CHECK.neighbours, 2)).toEqual([
      47, 48, 49, 50, 51, 52, 53, 54, 56, 57
    ]);
  });

  it('fails a two-frame step that shows the same picture, as a bounce does', () => {
    // A median of 12.95, as the film's two-frame steps about the wrap have.
    const neighbours = Array.from({length: 16}, (_, index) => ({mad: 12.8 + (index % 4) * 0.1}));
    const median = 12.95;
    const steady = judgeTwoFrameStep({mad: 13.2}, neighbours);
    expect(steady.pass).toBe(true);
    expect(steady.madLeast).toBeCloseTo(LOOP_CHECK.twoFrameLeastRatio * median, 12);
    // Motion that runs back into frame 0 and out again: 1919 and 1 are one picture, encoded twice.
    expect(judgeTwoFrameStep({mad: 3.73}, neighbours).pass).toBe(false);
    expect(judgeTwoFrameStep({mad: 0}, neighbours).pass).toBe(false);
    expect(judgeTwoFrameStep({mad: 0.69 * median}, neighbours).pass).toBe(false);
    expect(judgeTwoFrameStep({mad: 0.71 * median}, neighbours).pass).toBe(true);
    // Without neighbours, it fails.
    expect(judgeTwoFrameStep({mad: 13}, []).pass).toBe(false);
  });

  it('fails a wrap or a swap whose two-frame steps fail, over the whole frame or the band', () => {
    const neighbours = Array.from({length: 16}, () => ({mad: 9, ssim: 0.75}));
    const smooth = judgeEncodedWrap({mad: 9.2, ssim: 0.74}, neighbours, [0.02]);
    const encoded = {whole: smooth, band: smooth};
    const rules = LOOP_CHECK.rules.wrapPicture;
    const steady = judgeLoopPair({mad: 9.2, ssim: 0.745}, neighbours, rules);
    const picture = {whole: steady, band: steady};
    const twoFrameNeighbours = Array.from({length: 16}, () => ({mad: 13}));
    const moving = judgeTwoFrameStep({mad: 13.1}, twoFrameNeighbours);
    const bounced = judgeTwoFrameStep({mad: 0}, twoFrameNeighbours);
    const good = [
      {whole: moving, band: moving},
      {whole: moving, band: moving}
    ];
    for (const twoFrame of [
      [
        {whole: moving, band: moving},
        {whole: bounced, band: moving}
      ],
      [
        {whole: moving, band: bounced},
        {whole: moving, band: moving}
      ]
    ]) {
      expect(judgeWrap(encoded, picture, twoFrame)).toEqual({
        picturePass: true,
        encodedPass: true,
        twoFramePass: false,
        pass: false
      });
      expect(judgeWrap(encoded, null, twoFrame).pass).toBe(false);
      expect(judgeSwap(picture, twoFrame)).toEqual({
        encodedPass: true,
        twoFramePass: false,
        pass: false
      });
    }
    expect(judgeWrap(encoded, picture, good).pass).toBe(true);
    expect(judgeSwap(picture, good)).toEqual({encodedPass: true, twoFramePass: true, pass: true});
    // The swap keeps both rules on the MP4 as well.
    const softer = judgeLoopPair({mad: 9.2, ssim: 0.7}, neighbours, LOOP_CHECK.rules.swap);
    expect(judgeSwap({whole: steady, band: softer}, good)).toEqual({
      encodedPass: false,
      twoFramePass: true,
      pass: false
    });
  });

  it("narrows the MP4 wrap's allowance to the encoder's share of each key-frame step's dip", () => {
    const neighbours = Array.from({length: 16}, () => ({mad: 9, ssim: 0.77}));
    // The MP4's dips at its key-frame steps, one of them the picture's own, 0.25 of its 0.2812.
    const keyFrameDips = [0.019, 0.04, 0.2812, 0.03];
    const pictureDips = [0.015, 0.018, 0.25, 0.031];
    const wrap = {mad: 9.5, ssim: 0.77 - 0.0336};
    const encoded = judgeEncodedWrap(wrap, neighbours, keyFrameDips);
    expect(encoded.dipLimit).toBeCloseTo(0.2812 + LOOP_CHECK.keyFrameMargin, 12);
    expect(encoded.encoderKeyFrames).toBeNull();
    // The encoder's shares are 0.004, 0.022, 0.0312 and -0.001.
    const shared = judgeEncodedWrap(wrap, neighbours, keyFrameDips, pictureDips);
    expect(shared.encoderKeyFrames).toMatchObject({count: 4});
    expect(shared.encoderKeyFrames?.max).toBeCloseTo(0.0312, 12);
    expect(shared.keyFrames?.max).toBe(0.2812);
    expect(shared.dipLimit).toBeCloseTo(0.0312 + LOOP_CHECK.keyFrameMargin, 12);
    expect(shared.dip).toBeCloseTo(0.0336, 12);
    expect(shared).toMatchObject({pass: true, dipPass: true});
    // A wrap that dips as deep as the picture does at its own key frame keeps the MP4's own
    // allowance, and not the encoder's.
    const deep = {mad: 9.5, ssim: 0.77 - 0.1};
    expect(judgeEncodedWrap(deep, neighbours, keyFrameDips).pass).toBe(true);
    expect(judgeEncodedWrap(deep, neighbours, keyFrameDips, pictureDips)).toMatchObject({
      pass: false,
      dipPass: false
    });
    // Where the picture rises at a key frame, the encoder's share there is more than the MP4's
    // own dip, and the allowance is still no wider than by the MP4's own.
    const risen = judgeEncodedWrap(wrap, neighbours, [0.01, 0.02], [-0.05, 0]);
    expect(risen.encoderKeyFrames?.max).toBeCloseTo(0.06, 12);
    expect(risen.dipLimit).toBeCloseTo(0.02 + LOOP_CHECK.keyFrameMargin, 12);
    // With no key-frame step to judge by, the picture changes nothing.
    for (const none of [null, []]) {
      expect(judgeEncodedWrap(wrap, neighbours, none, none)).toMatchObject({
        keyFrames: null,
        encoderKeyFrames: null,
        dipLimit: LOOP_CHECK.ssimDrop
      });
    }
    // The picture's dips must be of the same steps, and a dip that is not a number fails it.
    expect(() => judgeEncodedWrap(wrap, neighbours, keyFrameDips, [0.01])).toThrow();
    const unmeasured = [0, 0, Number.NaN, 0];
    expect(judgeEncodedWrap(wrap, neighbours, keyFrameDips, unmeasured).pass).toBe(false);
  });

  it('ties an MP4 to its parts at its first, middle and last frames, and about its pairs', () => {
    const pairs = getLoopPairs(LOOP.fileStart, CYCLE_FRAMES, STAGE_FPS);
    expect(getTieFrames(CYCLE_FRAMES, pairs)).toEqual([0, 1, 79, 80, 81, 82, 960, 1918, 1919]);
    // A short run about the file start, whose wrap is 29 to 30.
    const run = getLoopPairs(LOOP.fileStart - 1, 60, STAGE_FPS);
    expect(getTieFrames(60, run)).toEqual([0, 28, 29, 30, 31, 59]);
    // A run with neither pair is still tied at its ends and its middle, and one with a pair at its
    // end by the frames it has.
    expect(getTieFrames(10, {cycle: false, wrap: null, swap: null})).toEqual([0, 5, 9]);
    expect(getTieFrames(10, {cycle: false, wrap: 8, swap: null})).toEqual([0, 5, 7, 8, 9]);
  });

  it('holds an MP4 to its parts at 35 dB, and says which frame is furthest from them', () => {
    // The film's MP4 against its own VP9, as measured.
    const film = [
      {frame: 0, psnr: 42.11},
      {frame: 960, psnr: 38.58},
      {frame: 1918, psnr: 36.87},
      {frame: 1919, psnr: 36.99}
    ];
    expect(judgeTie(film)).toMatchObject({pass: true, least: 36.87, leastFrame: 1918});
    // A frame of another picture is not of these parts: frame 0 repeated at 1919, as measured.
    const repeated = film.map(entry => (entry.frame === 1919 ? {frame: 1919, psnr: 27.59} : entry));
    expect(judgeTie(repeated)).toMatchObject({pass: false, least: 27.59, leastFrame: 1919});
    expect(judgeTie([{frame: 0, psnr: LOOP_CHECK.leastPartsPsnr}]).pass).toBe(true);
    expect(judgeTie([{frame: 0, psnr: Infinity}]).pass).toBe(true);
    expect(judgeTie([{frame: 0, psnr: Number.NaN}]).pass).toBe(false);
    // With no frames, nothing is tied.
    expect(judgeTie([]).pass).toBe(false);
  });

  it('holds a cycle file, and only a cycle file, to exactly one cycle of frames', () => {
    expect(getCycleFrames(STAGE_FPS)).toBe(CYCLE_FRAMES);
    expect(getCycleFrames(60)).toBe(2 * CYCLE_FRAMES);
    // An export of one cycle says so in its comment, and a run says where it starts instead.
    expect(isCycleFile({commented: true, cycle: true, fromGiven: false})).toBe(true);
    expect(isCycleFile({commented: true, cycle: true, fromGiven: true})).toBe(true);
    expect(isCycleFile({commented: true, cycle: false, fromGiven: false})).toBe(false);
    // A file with no export's comment is taken for the film, unless --from says where it starts.
    expect(isCycleFile({commented: false, cycle: false, fromGiven: false})).toBe(true);
    expect(isCycleFile({commented: false, cycle: false, fromGiven: true})).toBe(false);
    for (const frames of [CYCLE_FRAMES - 1, CYCLE_FRAMES + 1, CYCLE_FRAMES - 30, 60]) {
      expect(judgeFrameCount(frames, STAGE_FPS, true)).toEqual({
        frames,
        cycleFile: true,
        cycleFrames: CYCLE_FRAMES,
        pass: false
      });
      expect(judgeFrameCount(frames, STAGE_FPS, false).pass).toBe(true);
    }
    expect(judgeFrameCount(CYCLE_FRAMES, STAGE_FPS, true).pass).toBe(true);
    // Of 1,919 frames from the file start there is no wrap to judge, and of 1,921 the wrap found
    // is not the file's own, 1920 to 0.
    expect(getLoopPairs(LOOP.fileStart, CYCLE_FRAMES - 1, STAGE_FPS)).toMatchObject({
      cycle: false,
      wrap: null
    });
    expect(getLoopPairs(LOOP.fileStart, CYCLE_FRAMES + 1, STAGE_FPS)).toMatchObject({
      cycle: false,
      wrap: CYCLE_FRAMES - 1
    });
  });

  it('passes a check only with the picture judged, and says when it judged the MP4 alone', () => {
    expect(getLoopVerdict([true, true], true)).toBe('pass');
    expect(getLoopVerdict([true, true], false)).toBe('encoded');
    expect(getLoopVerdict([true, false], true)).toBe('fail');
    expect(getLoopVerdict([false], false)).toBe('fail');
    // With nothing to judge, it fails.
    expect(getLoopVerdict([], true)).toBe('fail');
    expect(getLoopVerdict([], false)).toBe('fail');
  });
});

describe('the shutter', () => {
  it('is open as long as asked at full speed', () => {
    for (const t of [5, 20, 36.2, 46.4, 57.6]) {
      expect(getFrameShutter(t, DEFAULT_SHUTTER)).toBe(DEFAULT_SHUTTER);
    }
    expect(getFrameShutter(20, 0)).toBe(0);
  });

  it('closes down by the time rate in the slow motion, as a high-speed camera does', () => {
    // At the spec's rate of 0.12 a 180-degree shutter is open 0.06 of a frame.
    const slowest = Math.min(...TIME_RATE_KEYS.map(([, rate]) => rate));
    expect(slowest).toBeLessThan(0.5);
    for (const seam of [LOOP.cover[0], -0.1, 0, 0.1, LOOP.cover[1]]) {
      const t = getCycleSeconds(seam);
      expect(getFrameShutter(t, DEFAULT_SHUTTER)).toBeCloseTo(DEFAULT_SHUTTER * slowest, 12);
    }
    // Never more than asked, and less through the ramps either side.
    for (let frame = 0; frame < CYCLE_FRAMES; frame++) {
      const t = frame / STAGE_FPS;
      const open = getFrameShutter(t, DEFAULT_SHUTTER);
      expect(open).toBeLessThanOrEqual(DEFAULT_SHUTTER);
      expect(open).toBeCloseTo(DEFAULT_SHUTTER * getTimeRate(t), 12);
    }
  });

  it('is the same either side of the swap, and steps through the file wrap as beside it', () => {
    for (const seam of [1 / 60, 1 / 30, LOOP.cover[1]]) {
      expect(getFrameShutter(getCycleSeconds(-seam), DEFAULT_SHUTTER)).toBeCloseTo(
        getFrameShutter(seam, DEFAULT_SHUTTER),
        12
      );
    }
    // The file's pairs round its wrap, 1919 to 0 among them, each a frame on one smooth ramp.
    const getStep = (pair: number) =>
      Math.abs(
        getFrameShutter(getFrameSeconds(LOOP.fileStart, pair, STAGE_FPS), DEFAULT_SHUTTER) -
          getFrameShutter(getFrameSeconds(LOOP.fileStart, pair + 1, STAGE_FPS), DEFAULT_SHUTTER)
      );
    const wrap = CYCLE_FRAMES - 1;
    const beside = getNeighbourPairs(wrap, CYCLE_FRAMES, true).map(getStep);
    expect(getStep(wrap)).toBeLessThanOrEqual(LOOP_CHECK.madRatio * Math.max(...beside));
  });
});
