// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import type {TimelineClip, TimelineTrack} from '@deck.gl-community/timeline-layers';

/**
 * Generate random tracks with clips for demo purposes.
 */
export function generateRandomTracks(
  trackCount: number,
  clipsPerTrack: number,
  timelineStart: number,
  timelineEnd: number
): TimelineTrack[] {
  const colors: [number, number, number, number][] = [
    [80, 120, 160, 220],
    [120, 160, 180, 220],
    [100, 140, 120, 220],
    [140, 120, 140, 220],
    [160, 140, 100, 220],
    [120, 100, 140, 220],
    [100, 120, 120, 220],
    [140, 120, 100, 220]
  ];

  const tracks: TimelineTrack[] = [];

  for (let trackIdx = 0; trackIdx < trackCount; trackIdx++) {
    const clips: TimelineClip[] = [];

    for (let clipIdx = 0; clipIdx < clipsPerTrack; clipIdx++) {
      const duration = Math.random() * (timelineEnd - timelineStart) * 0.1;
      let startMs: number;

      // 30% chance of an overlapping clip (tests collision detection)
      if (clipIdx > 0 && Math.random() < 0.3) {
        const prevClip = clips[clips.length - 1];
        const overlapPoint =
          prevClip.startMs + (prevClip.endMs - prevClip.startMs) * (0.3 + Math.random() * 0.4);
        startMs = overlapPoint;
      } else {
        startMs = Math.random() * (timelineEnd - timelineStart - duration) + timelineStart;
      }

      clips.push({
        id: `track-${trackIdx}-clip-${clipIdx}`,
        startMs,
        endMs: startMs + duration,
        label: `Clip ${clipIdx + 1}`,
        color: colors[clipIdx % colors.length]
      });
    }

    tracks.push({
      id: trackIdx,
      name: `Track ${trackIdx + 1}`,
      visible: true,
      clips
    });
  }

  return tracks;
}
