// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Weight of the newest rate measurement in the smoothed rate. */
const SMOOTHING = 0.75;

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
    const expected = this.rate * wallDelta;
    const tolerance = this.sampleIntervalMs * Math.max(Math.abs(this.rate), 1);
    const jumped =
      delta < 0 ||
      (Math.abs(delta - expected) > tolerance &&
        Math.abs(delta - expected) > 10 * Math.abs(expected));
    if (jumped) {
      this.rate = 0;
      return {rate: this.rate, jumped: true};
    }

    this.rate += SMOOTHING * (delta / wallDelta - this.rate);
    // A stopped clock gives exactly zero, not a decaying remainder.
    if (delta === 0 && Math.abs(this.rate) < 1e-6) {
      this.rate = 0;
    }
    return {rate: this.rate, jumped: false};
  }

  /** Returns the simulated time at which the next sample is wanted. */
  getNextSampleTime(currentTimeMs: number): number {
    return currentTimeMs + this.rate * this.sampleIntervalMs;
  }
}
