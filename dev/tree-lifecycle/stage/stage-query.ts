// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/**
 * The stage's URL parameters, clock and loop checks as values. `stage.ts` reads the URL with these,
 * and `debug-settings.ts` reads and writes it with them, so a page with `capture` and one without
 * draw what the same URL says. The seam strip, `export.mjs --check-seam` and `--check-loop` judge
 * frames with the same numbers and rules. Pure, and without the debug panel's packages, as a
 * capture and the Node tools load it.
 *
 * Every time here is taken mod the cycle, as `getCycleSeconds` takes it: nothing clamps.
 */

import {CYCLE_SECONDS, getCycleSeconds, getTimeRate, LOOP} from '../story/beats';
import type {StoryWorld} from '../story/story-types';

/** Frames per second of the film, whose frames `t` in the URL is kept to. */
export const STAGE_FPS = 30;
/** A time this close to a frame, in frames, is that frame: what four decimals of a second lose. */
const FRAME_SNAP = 0.01;
/** Decimals of a second the URL keeps, which is enough to name any frame at 30 fps. */
const URL_DECIMALS = 4;

/** A switch such as `?finish=0`: off for `0`, on for anything else, and `fallback` when absent. */
export function parseSwitch(text: string | null, fallback: boolean): boolean {
  return text === null ? fallback : text !== '0';
}

/** Width over height of `9:16` or `0.5625`, or null for whatever the window is. */
export function parseAspect(text: string | null): number | null {
  if (!text) return null;
  const [width, height = '1'] = text.split(':');
  const aspect = Number(width) / Number(height);
  return aspect > 0 && Number.isFinite(aspect) ? aspect : null;
}

/** `TreeLayer.lodBias` of `?lodBias=`, or null for none, or for one that is not a number. */
export function parseLodBias(text: string | null): number | null {
  if (text === null || text.trim() === '') return null;
  const lodBias = Number(text);
  return Number.isFinite(lodBias) ? lodBias : null;
}

/** Device pixels per CSS pixel of `?dpr=`, or 1 for none, or for one that is not above 0. */
export function parseDevicePixels(text: string | null): number {
  const devicePixels = Number(text);
  return devicePixels > 0 && Number.isFinite(devicePixels) ? devicePixels : 1;
}

/**
 * The side of the swap `?world=end` or `?world=start` asks a second inside `LOOP.cover` to be
 * composed from, or null for the second's own.
 */
export function parseWorld(text: string | null): StoryWorld | null {
  return text === 'end' || text === 'start' ? text : null;
}

/**
 * The cycle second `?t=` names: any number, taken mod the cycle, and the frame it is within a
 * hundredth of a frame of, so a frame written to four decimals comes back as that frame. 0 for
 * none.
 */
export function parseStageSeconds(text: string | null, fps = STAGE_FPS): number {
  const seconds = Number(text);
  if (text === null || text.trim() === '' || !Number.isFinite(seconds)) return 0;
  const frame = Math.round(seconds * fps);
  const snapped = Math.abs(seconds * fps - frame) <= FRAME_SNAP ? frame / fps : seconds;
  return getCycleSeconds(snapped);
}

/** A cycle second as `?t=` keeps it: taken mod the cycle, to the frame, with no trailing zeros. */
export function formatStageSeconds(seconds: number): string {
  return String(Number(getCycleSeconds(seconds).toFixed(URL_DECIMALS)));
}

/**
 * The cycle second of frame `frame` of a run that starts at story second `from`, which may be past
 * the end of the cycle. A start on the frame grid is counted in whole frames, so every frame's time
 * is exact and wraps exactly: frame 81 from 61.3 s at 30 fps is cycle second 0, not 1e-14 either
 * side of the swap.
 */
export function getFrameSeconds(from: number, frame: number, fps: number): number {
  const first = Math.round(from * fps);
  if (Math.abs(first - from * fps) > 1e-6) return getCycleSeconds(from + frame / fps);
  const cycleFrames = CYCLE_SECONDS * fps;
  if (!Number.isInteger(cycleFrames)) return getCycleSeconds((first + frame) / fps);
  const wrapped = (first + frame) % cycleFrames;
  return (wrapped < 0 ? wrapped + cycleFrames : wrapped) / fps;
}

/**
 * How much of a frame the shutter is open at cycle second `t`: `shutter` at full speed, closed down
 * by the time rate in slow motion, as a high-speed camera's is. At a rate of 0.12 a 180-degree
 * shutter is open 0.06 of a frame, so the fall and the dive are crisp where the camera, which moves
 * at story speed through them, would smear them. The rate is flat and equal across the swap, and so
 * is this.
 */
export function getFrameShutter(t: number, shutter: number): number {
  return shutter * getTimeRate(t);
}

/**
 * Where a cycle second stands in a playback window that starts at `from` and may run on past the
 * end of the cycle to `to`, as a range from 62 s to 2 s does (to 66): `from` plus the seconds from
 * `from` to it, forward round the cycle. At or past `to`, it is outside the window.
 */
export function getPlaybackPlace(seconds: number, window: {from: number; to: number}): number {
  return window.from + getCycleSeconds(seconds - window.from);
}

/** How two frames differ: what `getFrameDifference` measures. */
export type FrameDifference = {
  /** Mean absolute difference of the 8-bit red, green and blue values. */
  mad: number;
  /** Peak signal to noise ratio in dB, Infinity for frames that are the same. */
  psnr: number;
};

/**
 * How two RGBA frames of the same size differ, over all their rows or over rows `top` up to
 * `bottom`, as the seam and loop checks measure it. Alpha is left out.
 */
export function getFrameDifference(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  height: number,
  rows: readonly [top: number, bottom: number] = [0, height]
): FrameDifference {
  if (a.length !== b.length || a.length !== width * height * 4) {
    throw new Error(`Frames of ${a.length} and ${b.length} values are not ${width}x${height} RGBA`);
  }
  const top = Math.max(0, Math.min(height, Math.round(rows[0])));
  const bottom = Math.max(top, Math.min(height, Math.round(rows[1])));
  let absolute = 0;
  let squared = 0;
  for (let index = top * width * 4; index < bottom * width * 4; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const difference = a[index + channel] - b[index + channel];
      absolute += Math.abs(difference);
      squared += difference * difference;
    }
  }
  const values = (bottom - top) * width * 3;
  if (values === 0) return {mad: 0, psnr: Infinity};
  const meanSquared = squared / values;
  return {
    mad: absolute / values,
    psnr: meanSquared === 0 ? Infinity : 10 * Math.log10((255 * 255) / meanSquared)
  };
}

/**
 * Peak signal to noise ratio in dB of two 8-bit yuv420p frames of the same size, as they are
 * coded, over their Y, U and V samples together, as ffmpeg's `psnr` filter averages the planes:
 * Infinity for frames that are the same. The loop check ties an MP4 to its parts by it. The coded
 * planes, and not RGB: turned into RGB, a tv-range picture is stretched by 255/219 and each
 * channel takes in the chroma's error, so the same encode of the film reads about 4 dB lower.
 */
export function getYuvPsnr(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  width: number,
  height: number
): number {
  const samples = width * height + 2 * Math.ceil(width / 2) * Math.ceil(height / 2);
  if (a.length !== b.length || a.length !== samples) {
    throw new Error(
      `Frames of ${a.length} and ${b.length} values are not ${width}x${height} yuv420p`
    );
  }
  let squared = 0;
  for (let index = 0; index < samples; index++) {
    const difference = a[index] - b[index];
    squared += difference * difference;
  }
  const meanSquared = squared / samples;
  return meanSquared === 0 ? Infinity : 10 * Math.log10((255 * 255) / meanSquared);
}

/**
 * What `?seam=1` shows, in order: seam seconds either side of the swap, and the side of it each is
 * composed from.
 */
export const SEAM_VIEW: readonly {seam: number; world: StoryWorld}[] = [
  {seam: -2 / 30, world: 'end'},
  {seam: -1 / 60, world: 'end'},
  {seam: 1 / 60, world: 'start'},
  {seam: 2 / 30, world: 'start'}
];

/**
 * The hidden swap's checks. At each of `seams`, a frame composed from the end world and one from the
 * start world, with the overlay and grain off, are at least `leastPsnr` dB alike. And every
 * sub-frame of every frame inside `LOOP.cover` is all rind: drawn over `clear`, which no layer
 * draws, it has none of it.
 */
export const SEAM_CHECK = {
  seams: [-1 / 60, 1 / 60] as const,
  leastPsnr: 42,
  clear: [255, 0, 255] as const
};

/**
 * A rule of `LOOP_CHECK` that a pair's measures and its neighbours' decide alone: `mad`, the MAD
 * rule, or `ssim`, the SSIM rule.
 */
export type PairRule = 'mad' | 'ssim';

/**
 * One of `LOOP_CHECK`'s rules: a `PairRule`, or `keyFrameDip`, the MP4's wrap's rule in place of
 * the SSIM rule, which the file's own key frames decide too.
 */
export type LoopRule = PairRule | 'keyFrameDip';

/**
 * How `export.mjs --check-loop` judges the file's own wrap, frame 1919 to frame 0, and the swap, 80
 * to 81: a pair of frames against the `neighbours` pairs either side of it, its 16 neighbouring
 * steps, over the whole frame and over the overlay's `band`, as fractions of the height: y 1090 to
 * 1560 of 1920. By the MAD rule its MAD is at least `madLeastRatio` and at most `madRatio` times
 * their median, so it neither freezes nor jumps, and by the SSIM rule its SSIM at least their
 * median less `ssimDrop`. `rules` says which rules gate each judgement.
 *
 * - `wrapPicture`, rule 1: the wrap's picture, as an export rendered it, decoded from the VP9 of
 *   its parts, by both rules. It gates wherever those are at hand: in an export, and with
 *   `--parts`.
 * - `wrapEncoded`, rule 2: the wrap as the MP4 has it, by the MAD rule and `keyFrameDip` in place
 *   of the SSIM rule, which is measured and reported only. The MP4's GOPs are closed, so its wrap
 *   is a step into the IDR frame at frame 0, and every step into an IDR frame dips in SSIM below
 *   its neighbours however smooth the picture is. So the wrap's dip below its neighbours' median
 *   may be as deep as the deepest of the file's own internal key-frame steps' below theirs, the
 *   steps into every IDR frame but frame 0, plus `keyFrameMargin`. With the parts at hand, each of
 *   those dips is the MP4's less the picture's own there, the encoder's share, so a dip that is the
 *   picture's, as the band's 0.25 at 1259 to 1260, does not widen the wrap's allowance; and it is
 *   never wider than the MP4's own dips make it. A wrap that is not a step into a key frame, as a
 *   short run's inside its one GOP, or one in a file with no other key-frame step, may dip no more
 *   than `ssimDrop`, as the SSIM rule has it.
 * - `swap`: the swap as the MP4 has it, by both rules, as the spec's section on the stage asks, so
 *   the rind's slide never jumps and its picture never softens. The spec's loop section names only
 *   the MAD rule for the swap; this keeps the stricter of the two.
 *
 * Across each pair, its two two-frame steps, from the frame before it to the frame after it and
 * from its first frame to the frame two on, 1918 to 0 and 1919 to 1 at the wrap, each have a MAD
 * at least `twoFrameLeastRatio` times the median of their 16 neighbouring two-frame steps', on the
 * picture where the parts are at hand and on the MP4 where not. Motion that runs back into a pair
 * and out of it again, a bounce, steps as far in one frame as it should, and the same either way,
 * so the MAD and SSIM rules miss it; but two frames apart it shows the same picture.
 *
 * An MP4 checked with an export's parts is held to them first: at each of `getTieFrames`, its
 * frame is at least `leastPartsPsnr` dB from theirs by `getYuvPsnr`, or they are not its parts.
 */
export const LOOP_CHECK = {
  neighbours: 8,
  madRatio: 1.3,
  madLeastRatio: 0.5,
  ssimDrop: 0.01,
  keyFrameMargin: 0.005,
  twoFrameLeastRatio: 0.7,
  leastPartsPsnr: 35,
  band: [1090 / 1920, 1560 / 1920] as const,
  rules: {
    wrapPicture: ['mad', 'ssim'],
    wrapEncoded: ['mad', 'keyFrameDip'],
    swap: ['mad', 'ssim']
  } as const satisfies Record<string, readonly LoopRule[]>
};

/** The pairs of a run of frames the loop check judges, each by the index of its first frame. */
export type LoopPairs = {
  /** Whether the run is exactly one cycle, so its last frame runs on into its first. */
  cycle: boolean;
  /**
   * Where the file starts over: its last frame and its first, or, in a shorter run, the frame
   * before `LOOP.fileStart` and that frame. Null if the run has neither.
   */
  wrap: number | null;
  /** The pair across the swap, into cycle second 0, or null if the run does not cross it. */
  swap: number | null;
};

/** The frames of one cycle at `fps`: 1,920 at 30. */
export function getCycleFrames(fps: number): number {
  return Math.round(CYCLE_SECONDS * fps);
}

/** What the loop check knows of where a file came from, to tell whether it is one cycle. */
export type FileOrigin = {
  /** Whether an export wrote its comment. */
  commented: boolean;
  /** Whether that comment says `cycle=1`, as an export of `--cycle 1` writes. */
  cycle: boolean;
  /** Whether `--from` says where it starts. */
  fromGiven: boolean;
};

/**
 * Whether the loop check holds a file to exactly one cycle: one whose export wrote `cycle=1` in its
 * comment, or one with no export's comment checked without `--from`, which the check takes for the
 * film, one cycle from `LOOP.fileStart`. A run an export made of any other stretch says where it
 * starts in its comment and is held to nothing more.
 */
export function isCycleFile(file: FileOrigin): boolean {
  return file.commented ? file.cycle : !file.fromGiven;
}

/** Whether a file has the frames it must: exactly `getCycleFrames(fps)` if it is a cycle file. */
export type FrameCountJudgement = {
  frames: number;
  cycleFile: boolean;
  cycleFrames: number;
  pass: boolean;
};

/**
 * The loop check's first judgement of a file: a cycle file of 1,919 or 1,921 frames, as a frame
 * dropped or one too many makes, fails, as its last frame does not run on into its first, and the
 * pairs the check would judge in it are not its wrap.
 */
export function judgeFrameCount(
  frames: number,
  fps: number,
  cycleFile: boolean
): FrameCountJudgement {
  const cycleFrames = getCycleFrames(fps);
  return {frames, cycleFile, cycleFrames, pass: !cycleFile || frames === cycleFrames};
}

/** The wrap and the swap of `frames` frames from story second `from` at `fps`. */
export function getLoopPairs(from: number, frames: number, fps: number): LoopPairs {
  const cycle = frames === getCycleFrames(fps);
  const fileStart = getCycleSeconds(LOOP.fileStart);
  let wrap: number | null = cycle ? frames - 1 : null;
  let swap: number | null = null;
  for (let pair = 0; pair < (cycle ? frames : frames - 1); pair++) {
    const first = getFrameSeconds(from, pair, fps);
    const second = getFrameSeconds(from, pair + 1, fps);
    if (swap === null && second < first) swap = pair;
    if (wrap === null && Math.abs(second - fileStart) < 0.5 / fps) wrap = pair;
  }
  return {cycle, wrap, swap};
}

/**
 * The pairs either side of pair `pair`, `count` each way: round the ends of a run that is one
 * cycle, and only inside one that is not. With `span` 2 they are steps of two frames, from each
 * first frame to the frame two on, as `getTwoFrameSteps` has them.
 */
export function getNeighbourPairs(
  pair: number,
  frames: number,
  cycle: boolean,
  count = LOOP_CHECK.neighbours,
  span = 1
): number[] {
  const pairs = cycle ? frames : frames - span;
  const neighbours: number[] = [];
  for (let step = -count; step <= count; step++) {
    const index = pair + step;
    if (step === 0) continue;
    if (cycle) neighbours.push(((index % pairs) + pairs) % pairs);
    else if (index >= 0 && index < pairs) neighbours.push(index);
  }
  return neighbours;
}

/**
 * The two-frame steps across pair `pair`, by first frame, each to the frame two on: from the frame
 * before the pair to the frame after it, and from its first frame on. Across a cycle's wrap they
 * are 1918 to 0 and 1919 to 1, and across the swap 79 to 81 and 80 to 82. In a run that is not one
 * cycle, only those inside it.
 */
export function getTwoFrameSteps(pair: number, frames: number, cycle: boolean): number[] {
  const firsts = [pair - 1, pair];
  if (cycle) return firsts.map(first => ((first % frames) + frames) % frames);
  return firsts.filter(first => first >= 0 && first + 2 < frames);
}

/**
 * The frames by which the loop check holds an MP4 to an export's parts: its first, its middle and
 * its last, 0, 960 and 1919 of a cycle, and those of the wrap's and the swap's two-frame steps,
 * whose picture the parts stand in for. In order, each once.
 */
export function getTieFrames(frames: number, pairs: LoopPairs): number[] {
  const tied = new Set([0, Math.floor(frames / 2), frames - 1]);
  for (const pair of [pairs.wrap, pairs.swap]) {
    if (pair === null) continue;
    for (let frame = pair - 1; frame <= pair + 2; frame++) {
      if (pairs.cycle) tied.add(((frame % frames) + frames) % frames);
      else if (frame >= 0 && frame < frames) tied.add(frame);
    }
  }
  return [...tied].sort((a, b) => a - b);
}

/** How far an MP4 is from an export's parts at each of the frames that tie them. */
export type TieJudgement = {
  frames: {frame: number; psnr: number}[];
  /** The frame furthest from the parts', and its PSNR. */
  leastFrame: number;
  least: number;
  /** Whether every frame is at least `LOOP_CHECK.leastPartsPsnr` dB from theirs. */
  pass: boolean;
};

/**
 * Whether an MP4 is an encode of an export's parts: each of its frames at `getTieFrames` at least
 * `LOOP_CHECK.leastPartsPsnr` dB from theirs, by `getYuvPsnr`. The film's MP4 at 5 Mbps is 36.8 dB
 * or more from its VP9 at those frames, where the frame a step on is about 28 dB from it, and one
 * with only its top quarter a step on, about 32. Without frames, it ties nothing.
 */
export function judgeTie(frames: readonly {frame: number; psnr: number}[]): TieJudgement {
  const least = frames.reduce<{frame: number; psnr: number} | null>(
    (worst, frame) => (worst === null || frame.psnr < worst.psnr ? frame : worst),
    null
  );
  return {
    frames: [...frames],
    leastFrame: least?.frame ?? Number.NaN,
    least: least?.psnr ?? Number.NaN,
    pass: least !== null && frames.every(frame => frame.psnr >= LOOP_CHECK.leastPartsPsnr)
  };
}

/** How alike a pair of frames is: 8-bit MAD, and SSIM. */
export type PairMeasure = {mad: number; ssim: number};

/** A pair judged against its neighbours by `LOOP_CHECK`. */
export type PairJudgement = PairMeasure & {
  /** The least and the most its MAD may be: `madLeastRatio` and `madRatio` times their median. */
  madLeast: number;
  madLimit: number;
  ssimLimit: number;
  /** Whether it keeps the MAD rule and the SSIM rule, each whether it gates or not. */
  madPass: boolean;
  ssimPass: boolean;
  /** The rules that gate it. */
  rules: readonly LoopRule[];
  /** Whether it keeps every rule that gates it. */
  pass: boolean;
};

/** How deep a set of SSIM dips goes: how many, their median, 90th percentile and deepest. */
export type DipSpread = {count: number; median: number; p90: number; max: number};

/** The MP4's wrap judged by rule 2: `PairJudgement`'s, and its SSIM dip against the key frames'. */
export type EncodedWrapJudgement = PairJudgement & {
  /** How far its SSIM is below its neighbours' median, as `getSsimDip` has it. */
  dip: number;
  /** How far it may be, and whether it is no further. */
  dipLimit: number;
  dipPass: boolean;
  /**
   * The MP4's dips at the file's internal key-frame steps, or null when there are none to judge by
   * and `dipLimit` is `ssimDrop`. Without the picture their deepest and `keyFrameMargin` are
   * `dipLimit`.
   */
  keyFrames: DipSpread | null;
  /**
   * With the picture, the encoder's share of each of those dips, the MP4's less the picture's
   * there, whose deepest and `keyFrameMargin` are `dipLimit` where that is less than by
   * `keyFrames`. Null without the picture.
   */
  encoderKeyFrames: DipSpread | null;
};

/** A judgement of a pair over the whole frame and over the overlay's band. */
export type LoopRegions<T> = {whole: T; band: T};

/** A two-frame step across a pair, judged against its neighbouring two-frame steps. */
export type TwoFrameJudgement = {
  mad: number;
  /** `twoFrameLeastRatio` times their median MAD, the least its MAD may be. */
  madLeast: number;
  pass: boolean;
};

/**
 * The verdict on the wrap: by both rules where its picture is at hand and by rule 2 where not, and
 * by its two-frame steps.
 */
export type WrapVerdict = {
  /** Rule 1, the picture from an export's VP9 parts, or null when they are not at hand. */
  picturePass: boolean | null;
  /** Rule 2, the MP4. */
  encodedPass: boolean;
  /** Its two-frame steps, on the picture where it is at hand and on the MP4 where not. */
  twoFramePass: boolean;
  /** Whether it keeps every rule judged. Without the picture, that is not all of them. */
  pass: boolean;
};

/** The verdict on the swap: by both rules on the MP4, and by its two-frame steps. */
export type SwapVerdict = {
  encodedPass: boolean;
  twoFramePass: boolean;
  pass: boolean;
};

/**
 * What the loop check finds of a file: `pass`, every rule kept, its picture's among them; `fail`, a
 * rule broken, or nothing to judge; and `encoded`, every rule on the MP4 kept, with its picture not
 * judged, as without an export's parts. `export.mjs` ends with exit code 0, 1 and 2 for them.
 */
export type LoopVerdict = 'pass' | 'fail' | 'encoded';

function getMedian(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The `share` quantile of values, between the two nearest ranks, as numpy's default has it. */
function getQuantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const place = share * (sorted.length - 1);
  const below = Math.floor(place);
  const above = Math.min(sorted.length - 1, below + 1);
  return sorted[below] + (sorted[above] - sorted[below]) * (place - below);
}

/**
 * Whether a pair steps as its neighbours do, no harder and not frozen, by those of `LOOP_CHECK`'s
 * pair rules in `rules`, both unless it says. Both are measured either way.
 */
export function judgeLoopPair(
  pair: PairMeasure,
  neighbours: readonly PairMeasure[],
  rules: readonly PairRule[] = LOOP_CHECK.rules.swap
): PairJudgement {
  const madMedian = getMedian(neighbours.map(neighbour => neighbour.mad));
  const madLeast = LOOP_CHECK.madLeastRatio * madMedian;
  const madLimit = LOOP_CHECK.madRatio * madMedian;
  const ssimLimit = getMedian(neighbours.map(neighbour => neighbour.ssim)) - LOOP_CHECK.ssimDrop;
  const madPass = pair.mad >= madLeast && pair.mad <= madLimit;
  const ssimPass = pair.ssim >= ssimLimit;
  const kept: Record<PairRule, boolean> = {mad: madPass, ssim: ssimPass};
  return {
    ...pair,
    madLeast,
    madLimit,
    ssimLimit,
    madPass,
    ssimPass,
    rules,
    pass: rules.length > 0 && rules.every(rule => kept[rule])
  };
}

/**
 * Whether a two-frame step across a pair, one of `getTwoFrameSteps`, moves at least
 * `twoFrameLeastRatio` as far as its neighbouring two-frame steps do, by their median MAD. A bounce
 * shows the same picture two frames apart, and fails it. Without neighbours, it fails.
 */
export function judgeTwoFrameStep(
  step: {mad: number},
  neighbours: readonly {mad: number}[]
): TwoFrameJudgement {
  const madLeast =
    LOOP_CHECK.twoFrameLeastRatio * getMedian(neighbours.map(neighbour => neighbour.mad));
  return {mad: step.mad, madLeast, pass: step.mad >= madLeast};
}

/**
 * How far a step's SSIM is below the median of its neighbours' SSIM: more than 0 for a dip, and not
 * a number without neighbours.
 */
export function getSsimDip(pair: PairMeasure, neighbours: readonly PairMeasure[]): number {
  return getMedian(neighbours.map(neighbour => neighbour.ssim)) - pair.ssim;
}

/** The count, median, 90th percentile and deepest of `dips`, which are not none. */
export function getDipSpread(dips: readonly number[]): DipSpread {
  return {
    count: dips.length,
    median: getMedian(dips),
    p90: getQuantile(dips, 0.9),
    max: Math.max(...dips)
  };
}

/**
 * The internal key-frame steps of a run of `frames` frames, which rule 2 judges the MP4's wrap by:
 * the pairs, by first frame, into each of `keyFrames` but the wrap's own. In a file of one cycle
 * with an IDR frame every 60 frames they are 59, 119 and on to 1859, the steps into every IDR frame
 * but frame 0. Null when the wrap is not a step into a key frame, as in a short run whose wrap is
 * inside a GOP, or when the run has no wrap.
 */
export function getKeyFrameSteps(
  keyFrames: readonly number[],
  frames: number,
  cycle: boolean,
  wrap: number | null
): number[] | null {
  // The step into frame 0 is from the last frame in a cycle, and there is none in a shorter run.
  const getStep = (keyFrame: number) => (keyFrame > 0 ? keyFrame - 1 : cycle ? frames - 1 : null);
  if (wrap === null || !keyFrames.some(keyFrame => getStep(keyFrame) === wrap)) return null;
  return keyFrames.flatMap(keyFrame => {
    const step = getStep(keyFrame);
    return step === null || step === wrap ? [] : [step];
  });
}

/**
 * The MP4's wrap by rule 2: the MAD rule against its neighbours, and in place of the SSIM rule,
 * which is measured and reported only, an SSIM dip below its neighbours' median no deeper than the
 * deepest of `keyFrameDips`, the file's internal key-frame steps' below theirs, plus
 * `keyFrameMargin`. With no key-frame dips, null when the wrap is not a step into a key frame or
 * none when the file has no other, the dip may be no deeper than `ssimDrop`, as the SSIM rule has
 * it.
 *
 * With `pictureKeyFrameDips`, the picture's own dips at the same steps from an export's parts, in
 * the same order, each key-frame step's dip is the MP4's less the picture's there: the encoder's
 * share, so that a dip in the picture itself does not widen the allowance. The wrap's own
 * dip stays the MP4's, as a viewer sees it. And the allowance is never wider than by the MP4's own
 * dips, so the parts only ever narrow it.
 */
export function judgeEncodedWrap(
  pair: PairMeasure,
  neighbours: readonly PairMeasure[],
  keyFrameDips: readonly number[] | null,
  pictureKeyFrameDips: readonly number[] | null = null
): EncodedWrapJudgement {
  const judged = judgeLoopPair(pair, neighbours, ['mad']);
  const dip = getSsimDip(pair, neighbours);
  const keyFrames = keyFrameDips?.length ? getDipSpread(keyFrameDips) : null;
  if (keyFrameDips && pictureKeyFrameDips && pictureKeyFrameDips.length !== keyFrameDips.length) {
    throw new Error(
      `${pictureKeyFrameDips.length} key-frame dips of the picture for ${keyFrameDips.length} steps`
    );
  }
  const encoderKeyFrames =
    keyFrames && keyFrameDips && pictureKeyFrameDips
      ? getDipSpread(
          keyFrameDips.map((keyFrameDip, step) => keyFrameDip - pictureKeyFrameDips[step])
        )
      : null;
  // The deepest key-frame dip the wrap's may match: the MP4's own, or with the picture the
  // encoder's share where that is less. A NaN in either stays NaN through Math.min, and fails it.
  const deepest = keyFrames ? Math.min(keyFrames.max, encoderKeyFrames?.max ?? Infinity) : null;
  const dipLimit = deepest === null ? LOOP_CHECK.ssimDrop : deepest + LOOP_CHECK.keyFrameMargin;
  const dipPass = dip <= dipLimit;
  const rules = LOOP_CHECK.rules.wrapEncoded;
  const kept: Record<LoopRule, boolean> = {
    mad: judged.madPass,
    ssim: judged.ssimPass,
    keyFrameDip: dipPass
  };
  return {
    ...judged,
    dip,
    dipLimit,
    dipPass,
    keyFrames,
    encoderKeyFrames,
    rules,
    pass: rules.every(rule => kept[rule])
  };
}

/** Whether every two-frame step across a pair keeps its rule, over the whole frame and the band. */
function isTwoFrameKept(twoFrame: readonly LoopRegions<TwoFrameJudgement>[]): boolean {
  return twoFrame.every(step => step.whole.pass && step.band.pass);
}

/**
 * The verdict on the wrap: rule 2 on the MP4, and rule 1 on its picture, from an export's VP9
 * parts, where that is at hand, each over the whole frame and the band, and its two-frame steps,
 * on the picture where it is at hand and on the MP4 where not. A picture that jumps fails it
 * however the MP4 does.
 */
export function judgeWrap(
  encoded: LoopRegions<EncodedWrapJudgement>,
  picture: LoopRegions<PairJudgement> | null,
  twoFrame: readonly LoopRegions<TwoFrameJudgement>[]
): WrapVerdict {
  const encodedPass = encoded.whole.pass && encoded.band.pass;
  const picturePass = picture ? picture.whole.pass && picture.band.pass : null;
  const twoFramePass = isTwoFrameKept(twoFrame);
  return {
    picturePass,
    encodedPass,
    twoFramePass,
    pass: encodedPass && picturePass !== false && twoFramePass
  };
}

/**
 * The verdict on the swap: both rules on the MP4, over the whole frame and the band, and its
 * two-frame steps, on the picture where it is at hand and on the MP4 where not.
 */
export function judgeSwap(
  encoded: LoopRegions<PairJudgement>,
  twoFrame: readonly LoopRegions<TwoFrameJudgement>[]
): SwapVerdict {
  const encodedPass = encoded.whole.pass && encoded.band.pass;
  const twoFramePass = isTwoFrameKept(twoFrame);
  return {encodedPass, twoFramePass, pass: encodedPass && twoFramePass};
}

/**
 * What the loop check finds, from whether each pair it judged kept every rule, and whether its
 * picture was judged, from an export's parts: a pass only with the picture, and without it, at
 * best `encoded`. No pairs, no pass.
 */
export function getLoopVerdict(passes: readonly boolean[], pictureJudged: boolean): LoopVerdict {
  if (passes.length === 0 || !passes.every(Boolean)) return 'fail';
  return pictureJudged ? 'pass' : 'encoded';
}

/**
 * The layers `?only=` names, by layer or by group such as `props`, in draw order, and the names it
 * has that are neither.
 */
export function parseOnlyLayers(
  text: string,
  layerNames: readonly string[],
  layerGroups: Readonly<Record<string, readonly string[]>>
): {layers: string[]; unknown: string[]} {
  const names = new Set(
    text
      .split(',')
      .filter(Boolean)
      .flatMap(name => layerGroups[name] ?? [name])
  );
  return {
    layers: layerNames.filter(name => names.has(name)),
    unknown: [...names].filter(name => !layerNames.includes(name))
  };
}
