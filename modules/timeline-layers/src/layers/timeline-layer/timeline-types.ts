// deck.gl-community
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

// ===== CORE DATA TYPES =====

export type TimelineClip = {
  id: string | number;
  startMs: number;
  endMs: number;
  color?: [number, number, number, number];
  label?: string;
  subtrackIndex?: number;
  [key: string]: unknown;
}

export type TimelineTrack = {
  id: string | number;
  clips: TimelineClip[];
  visible?: boolean;
  name?: string;
  [key: string]: unknown;
}

// ===== INTERNAL DATA TYPES =====

export type TrackWithSubtracks = {
  track: TimelineTrack;
  trackIndex: number;
  clips: TimelineClip[];
  subtrackCount: number;
}

export type TrackPosition = {
  y: number;
  height: number;
  subtrackCount: number;
}

export type TrackBackgroundData = {
  id: string;
  track: TimelineTrack;
  trackIndex: number;
  polygon: [number, number][];
  color: [number, number, number, number];
}

export type TrackLabelData = {
  text: string;
  position: [number, number, number];
}

export type ClipPolygonData = {
  id: string | number;
  clip: TimelineClip;
  track: TimelineTrack;
  clipIndex: number;
  trackIndex: number;
  subtrackIndex: number;
  polygon: [number, number][];
  color: [number, number, number, number];
  label: string;
  labelPosition: [number, number, number];
}

export type ClipLabelData = {
  text: string;
  position: [number, number, number];
}

export type SeparatorLineData = {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export type AxisLineData = {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export type AxisLabelData = {
  text: string;
  position: [number, number, number];
}

export type ScrubberLineData = {
  sourcePosition: [number, number];
  targetPosition: [number, number];
}

export type ScrubberHandleData = {
  id: string;
  polygon: [number, number][];
  color: [number, number, number, number];
}

export type ScrubberLabelData = {
  text: string;
  position: [number, number, number];
}

export type TimelineTick = {
  position: number;
  timeMs: number;
  label: string;
}

// ===== CALLBACK INFO TYPES =====

export type TimelineViewport = {
  startMs?: number;
  endMs?: number;
}

export type TimelineClipInfo = {
  clip: TimelineClip;
  track: TimelineTrack;
  clipIndex: number;
  trackIndex: number;
  subtrackIndex: number;
}

export type TimelineTrackInfo = {
  track: TimelineTrack;
  index: number;
}

export type TimelineScrubberInfo = {
  timeMs: number;
  isDragging: boolean;
}

export type TimelineViewportInfo = {
  startMs: number;
  endMs: number;
  zoomLevel: number;
}

// ===== FORMATTER TYPE =====

export type TimeAxisLabelFormatter = (timeMs: number) => string;

