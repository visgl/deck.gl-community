// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TimeAxisLabelFormatter, TimelineTick} from './timeline-types';

// ===== TIME FORMATTERS =====

export const timeAxisFormatters = {
  seconds: (timeMs: number): string => (timeMs / 1000).toFixed(1) + 's',
  timestamp: (timeMs: number): string => new Date(timeMs).toLocaleTimeString(),
  minutesSeconds: (timeMs: number): string => {
    const totalSeconds = Math.floor(timeMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  },
  hoursMinutesSeconds: (timeMs: number): string => {
    const totalSeconds = Math.floor(timeMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
};

// ===== TIMELINE HELPERS =====

/**
 * Generate timeline axis ticks
 */
export function generateTimelineTicks(
  startMs: number,
  endMs: number,
  timelineX: number,
  timelineWidth: number,
  tickCount: number,
  formatter: TimeAxisLabelFormatter
): TimelineTick[] {
  const ticks: TimelineTick[] = [];
  const timeRange = endMs - startMs;
  const step = timeRange / (tickCount - 1);

  for (let i = 0; i < tickCount; i++) {
    const timeMs = startMs + i * step;
    const position = timelineX + (i / (tickCount - 1)) * timelineWidth;
    const label = formatter(timeMs);

    ticks.push({position, timeMs, label});
  }

  return ticks;
}

/**
 * Convert mouse position to time
 */
export function positionToTime(
  x: number,
  timelineX: number,
  timelineWidth: number,
  startMs: number,
  endMs: number
): number {
  const ratio = (x - timelineX) / timelineWidth;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return startMs + clampedRatio * (endMs - startMs);
}

/**
 * Convert time to position
 */
export function timeToPosition(
  timeMs: number,
  timelineX: number,
  timelineWidth: number,
  startMs: number,
  endMs: number
): number {
  const timeRatio = (timeMs - startMs) / (endMs - startMs);
  const clampedRatio = Math.max(0, Math.min(1, timeRatio));
  return timelineX + clampedRatio * timelineWidth;
}
