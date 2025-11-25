// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {TimelineClip} from './timeline-utils';

export interface ClipWithSubtrack extends TimelineClip {
  subtrackIndex: number;
}

/**
 * Detects overlapping clips and assigns them to subtracks
 * Uses a greedy algorithm to minimize the number of subtracks needed
 */
export function assignClipsToSubtracks(clips: TimelineClip[]): ClipWithSubtrack[] {
  if (clips.length === 0) return [];

  // Sort clips by start time
  const sortedClips = [...clips].sort((a, b) => a.startMs - b.startMs);

  // Track the end time of the last clip in each subtrack
  const subtrackEndTimes: number[] = [];
  const result: ClipWithSubtrack[] = [];

  for (const clip of sortedClips) {
    // Find the first subtrack where this clip can fit
    let assignedSubtrack = -1;

    for (let i = 0; i < subtrackEndTimes.length; i++) {
      if (clip.startMs >= subtrackEndTimes[i]) {
        // This clip doesn't overlap with the last clip in this subtrack
        assignedSubtrack = i;
        subtrackEndTimes[i] = clip.endMs;
        break;
      }
    }

    // If no existing subtrack works, create a new one
    if (assignedSubtrack === -1) {
      assignedSubtrack = subtrackEndTimes.length;
      subtrackEndTimes.push(clip.endMs);
    }

    result.push({
      ...clip,
      subtrackIndex: assignedSubtrack
    });
  }

  return result;
}

/**
 * Calculate the number of subtracks needed for a set of clips
 */
export function calculateSubtrackCount(clips: TimelineClip[]): number {
  if (clips.length === 0) return 1;
  const clipsWithSubtracks = assignClipsToSubtracks(clips);
  return Math.max(...clipsWithSubtracks.map(c => c.subtrackIndex)) + 1;
}
