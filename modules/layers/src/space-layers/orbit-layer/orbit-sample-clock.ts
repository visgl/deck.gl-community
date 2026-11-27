// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

/** Weight of the newest rate measurement in the smoothed rate. */
const SMOOTHING = 0.75;

/** Share of the seeded rate that the next frame's rate may differ by before it is a jump. */
const SEEDED_RATE_TOLERANCE = 0.5;

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
  /** True when the last update seeded the rate from a jump. */
  private seeded = false;

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
    // A jump is a step backward, or a step that differs from the expected step by more than
    // one sample interval of simulated time. A change of speed can report one jump too.
    // On a jump the rate is seeded from the observed step with no smoothing, so it cannot
    // latch to a stale value. A backward step seeds the rate as 0 (paused).
    const expected = this.rate * wallDelta;
    // The frame after a jump checks the seeded rate against the observed rate, relative to the
    // seed: a seed from a one-off step is wrong by a large factor, and a tolerance in simulated
    // time would hide that. A relative check also tolerates jitter in the wall time.
    const jumped =
      delta < 0 ||
      (this.seeded
        ? Math.abs(delta / wallDelta - this.rate) > SEEDED_RATE_TOLERANCE * Math.max(this.rate, 1)
        : Math.abs(delta - expected) > this.sampleIntervalMs * Math.max(this.rate, 1));
    this.seeded = jumped;
    if (jumped) {
      this.rate = delta < 0 ? 0 : delta / wallDelta;
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
