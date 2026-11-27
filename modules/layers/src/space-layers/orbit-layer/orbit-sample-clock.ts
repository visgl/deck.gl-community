// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Weight of the newest rate measurement in the smoothed rate. */
const SMOOTHING = 0.75;

/** Largest playback speed (simulated ms per wall ms) that a single frame step may imply. */
const MAX_PLAUSIBLE_RATE = 100000;

/** Below this rate, a clock whose time did not change counts as stopped. */
const STOPPED_RATE = 1e-6;

/**
 * Estimates how fast the simulated clock runs from `currentTime` updates and tells when it
 * jumps. Samples are requested one `sampleIntervalMs` of wall time apart, so the next sample
 * is `rate * sampleIntervalMs` ahead of the current simulated time.
 */
export class OrbitSampleClock {
  private readonly sampleIntervalMs: number;
  private lastTimeMs: number | null = null;
  private lastWallMs = 0;
  private rate = 0;

  constructor(sampleIntervalMs: number) {
    this.sampleIntervalMs = sampleIntervalMs;
  }

  /**
   * Feeds one clock reading.
   * @param currentTimeMs simulated time, in milliseconds since the Unix epoch
   * @param wallMs wall clock time, such as `performance.now()`
   * @returns the smoothed rate (simulated ms per wall ms) and whether the time jumped
   */
  update(currentTimeMs: number, wallMs: number): {rate: number; jumped: boolean} {
    const previousTimeMs = this.lastTimeMs;
    const wallDelta = wallMs - this.lastWallMs;
    this.lastTimeMs = currentTimeMs;
    this.lastWallMs = wallMs;

    if (previousTimeMs === null || wallDelta <= 0) {
      return {rate: this.rate, jumped: false};
    }

    const delta = currentTimeMs - previousTimeMs;
    // A step backward is a jump. A step forward is a jump when it implies a speed that no
    // playback speed reaches; a smaller step is a change of speed that the rate follows.
    // The rate stays as it was on a jump, so the next frames are judged against the old speed.
    if (delta < 0 || delta > MAX_PLAUSIBLE_RATE * wallDelta) {
      return {rate: this.rate, jumped: true};
    }

    this.rate += SMOOTHING * (delta / wallDelta - this.rate);
    // A stopped clock gives exactly zero, not a decaying remainder.
    if (delta === 0 && Math.abs(this.rate) < STOPPED_RATE) {
      this.rate = 0;
    }
    return {rate: this.rate, jumped: false};
  }

  /** Returns the simulated time at which the next sample is wanted. */
  getNextSampleTime(currentTimeMs: number): number {
    return currentTimeMs + this.rate * this.sampleIntervalMs;
  }
}
